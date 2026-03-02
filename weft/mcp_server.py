"""MCP Server for Weft — exposes browsing context to AI assistants."""

import json
import os
import time
from collections import Counter
from typing import Dict, List, Optional

from fastmcp import FastMCP
from weft.describe_graph import generate_insights, load_graph

GRAPH_PATH = os.environ.get("WEFT_GRAPH_PATH", "weft_graph.json")

mcp = FastMCP("Weft Browsing Memory")


def _load() -> Dict:
    return load_graph(GRAPH_PATH)


def _tab_summary(tab: Dict) -> Dict:
    """Compact representation of a tab for tool responses."""
    return {
        "id": tab.get("id"),
        "title": tab.get("title", ""),
        "url": tab.get("url", ""),
        "domain": tab.get("domain", ""),
        "keywords": tab.get("keywords", []),
        "summary": tab.get("summary", ""),
        "group_id": tab.get("group_id"),
        "pagerank": tab.get("pagerank", 0),
    }


# ============ RESOURCES ============


@mcp.resource("browsing://insights")
def get_insights() -> str:
    """Get a browsing memory report: top research topics, key themes, top sources, and graph quality metrics."""
    graph = _load()
    return generate_insights(graph)


@mcp.resource("browsing://groups")
def get_groups() -> str:
    """Get all knowledge clusters with labels, sizes, top keywords, and quality metrics.

    Each group includes its top-3 keywords by PageRank weight and the domains it spans.
    """
    graph = _load()
    groups = graph.get("groups", [])
    tabs = graph.get("tabs", [])
    tab_map = {t["id"]: t for t in tabs}

    result = []
    for g in sorted(groups, key=lambda x: x.get("size", 0), reverse=True):
        group_tabs = [tab_map[tid] for tid in g.get("tab_ids", []) if tid in tab_map]
        domains = Counter(t.get("domain", "") for t in group_tabs if t.get("domain"))
        keywords = Counter()
        for t in group_tabs:
            for kw in t.get("keywords", []):
                keywords[kw] += 1

        result.append({
            "id": g["id"],
            "label": g.get("label", ""),
            "size": g.get("size", 0),
            "top_keywords": [k for k, _ in keywords.most_common(5)],
            "top_domains": [d for d, _ in domains.most_common(3)],
        })

    return json.dumps(result, indent=2)


@mcp.resource("browsing://stats")
def get_stats() -> str:
    """Get graph statistics: tab count, group count, edge count, modularity score, and clustering method."""
    graph = _load()
    stats = graph.get("stats", {})
    return json.dumps({
        "tab_count": stats.get("tab_count", 0),
        "group_count": stats.get("group_count", 0),
        "edge_count": stats.get("edge_count", 0),
        "duplicates": stats.get("duplicates", 0),
        "modularity": stats.get("modularity", 0),
        "clustering": stats.get("clustering", "unknown"),
    }, indent=2)


# ============ TOOLS ============


@mcp.tool()
def search_knowledge(query: str, max_results: int = 10) -> str:
    """Search browsing history by topic. Matches against titles, summaries, keywords, and URLs.
    Results are ranked by relevance (keyword overlap + PageRank).

    Args:
        query: Natural language search (e.g. "python async", "react hooks", "machine learning papers")
        max_results: Maximum results to return (default 10)
    """
    graph = _load()
    query_lower = query.lower()
    query_terms = set(query_lower.split())

    scored = []
    for tab in graph.get("tabs", []):
        if tab.get("duplicate_of") is not None:
            continue

        title = (tab.get("title") or "").lower()
        summary = (tab.get("summary") or "").lower()
        url = (tab.get("url") or "").lower()
        keywords = [k.lower() for k in tab.get("keywords", [])]
        all_text = f"{title} {summary} {' '.join(keywords)} {url}"

        score = 0.0

        if query_lower in title:
            score += 3.0
        elif query_lower in all_text:
            score += 1.0

        keyword_set = set(keywords)
        overlap = query_terms & keyword_set
        score += len(overlap) * 2.0

        for term in query_terms:
            if term in title:
                score += 1.5
            elif term in summary:
                score += 0.5

        if score == 0:
            continue

        pr = tab.get("pagerank", 0)
        score += pr * 10.0

        scored.append((_tab_summary(tab), round(score, 3)))

    scored.sort(key=lambda x: x[1], reverse=True)
    results = [{"score": s, **t} for t, s in scored[:max_results]]

    return json.dumps({
        "query": query,
        "count": len(results),
        "results": results,
    }, indent=2)


@mcp.tool()
def get_group_details(group_id: int) -> str:
    """Get all tabs in a knowledge cluster, sorted by PageRank (most important first).

    Includes a synthesized summary of what the cluster is about.

    Args:
        group_id: The numeric ID of the group to retrieve.
    """
    graph = _load()
    groups = {g["id"]: g for g in graph.get("groups", [])}
    group = groups.get(group_id)

    if not group:
        return json.dumps({"error": f"Group {group_id} not found."})

    tab_map = {t["id"]: t for t in graph.get("tabs", [])}
    group_tabs = [tab_map[tid] for tid in group.get("tab_ids", []) if tid in tab_map]
    group_tabs.sort(key=lambda t: t.get("pagerank", 0), reverse=True)

    domains = Counter(t.get("domain", "") for t in group_tabs if t.get("domain"))
    keywords = Counter()
    for t in group_tabs:
        for kw in t.get("keywords", []):
            keywords[kw] += 1

    summary_parts = []
    summary_parts.append(f"Cluster '{group.get('label', '')}' with {len(group_tabs)} tabs.")
    if domains:
        top_domains = [f"{d} ({c})" for d, c in domains.most_common(3)]
        summary_parts.append(f"Spans: {', '.join(top_domains)}.")
    if keywords:
        top_kw = [k for k, _ in keywords.most_common(5)]
        summary_parts.append(f"Key topics: {', '.join(top_kw)}.")

    return json.dumps({
        "group": {
            "id": group["id"],
            "label": group.get("label", ""),
            "size": len(group_tabs),
            "summary": " ".join(summary_parts),
            "top_keywords": [k for k, _ in keywords.most_common(8)],
            "top_domains": [d for d, _ in domains.most_common(5)],
        },
        "tabs": [_tab_summary(t) for t in group_tabs],
    }, indent=2)


@mcp.tool()
def get_tab_neighbors(tab_id: int, max_neighbors: int = 10) -> str:
    """Get the graph neighborhood of a specific tab — all directly connected tabs.

    Shows similarity and navigation connections, sorted by edge weight.

    Args:
        tab_id: The numeric ID of the tab.
        max_neighbors: Maximum neighbors to return (default 10).
    """
    graph = _load()
    tab_map = {t["id"]: t for t in graph.get("tabs", [])}
    target = tab_map.get(tab_id)

    if not target:
        return json.dumps({"error": f"Tab {tab_id} not found."})

    neighbors = []
    for edge in graph.get("edges", []):
        connected_id = None
        if edge.get("source") == tab_id:
            connected_id = edge.get("target")
        elif edge.get("target") == tab_id:
            connected_id = edge.get("source")

        if connected_id is not None and connected_id in tab_map:
            neighbors.append({
                **_tab_summary(tab_map[connected_id]),
                "edge_weight": edge.get("weight", 0),
                "edge_type": edge.get("reason", "similarity"),
            })

    neighbors.sort(key=lambda x: x["edge_weight"], reverse=True)

    return json.dumps({
        "tab": _tab_summary(target),
        "neighbor_count": len(neighbors),
        "neighbors": neighbors[:max_neighbors],
    }, indent=2)


@mcp.tool()
def find_recent_tabs(hours: float = 2.0, max_results: int = 20) -> str:
    """Find tabs from your recent browsing history within a time window.

    Args:
        hours: How many hours back to look (default 2.0).
        max_results: Maximum results to return (default 20).
    """
    graph = _load()
    cutoff = time.time() - (hours * 3600)
    cutoff_ms = cutoff * 1000

    recent = []
    for tab in graph.get("tabs", []):
        if tab.get("duplicate_of") is not None:
            continue

        timestamp = tab.get("lastAccessed") or tab.get("createdAt") or 0
        if timestamp > 1e12:
            ts_seconds = timestamp / 1000
        else:
            ts_seconds = timestamp

        if ts_seconds >= cutoff:
            entry = _tab_summary(tab)
            entry["last_active"] = timestamp
            recent.append(entry)

    recent.sort(key=lambda x: x.get("last_active", 0), reverse=True)

    return json.dumps({
        "hours": hours,
        "count": len(recent[:max_results]),
        "tabs": recent[:max_results],
    }, indent=2)


@mcp.tool()
def find_stale_tabs(stale_hours: float = 24.0, max_results: int = 30) -> str:
    """Find tabs that haven't been accessed recently — candidates for cleanup.

    Returns tabs sorted by staleness (oldest first).

    Args:
        stale_hours: Consider tabs stale if not accessed in this many hours (default 24).
        max_results: Maximum results to return (default 30).
    """
    graph = _load()
    now = time.time()
    threshold = now - (stale_hours * 3600)
    threshold_ms = threshold * 1000

    stale = []
    for tab in graph.get("tabs", []):
        if tab.get("duplicate_of") is not None:
            continue

        timestamp = tab.get("lastAccessed") or tab.get("createdAt") or 0
        if timestamp == 0:
            continue

        if timestamp > 1e12:
            ts_seconds = timestamp / 1000
        else:
            ts_seconds = timestamp

        if ts_seconds < threshold:
            hours_ago = round((now - ts_seconds) / 3600, 1)
            entry = _tab_summary(tab)
            entry["hours_since_accessed"] = hours_ago
            stale.append(entry)

    stale.sort(key=lambda x: x.get("hours_since_accessed", 0), reverse=True)

    return json.dumps({
        "stale_threshold_hours": stale_hours,
        "count": len(stale[:max_results]),
        "tabs": stale[:max_results],
    }, indent=2)


@mcp.tool()
def find_related_to_topic(topic: str, max_results: int = 15) -> str:
    """Find tabs and clusters related to a topic. Searches across groups and expands
    results by following graph edges from matching tabs.

    More comprehensive than search_knowledge — this follows the graph structure
    to find related content you might not have found with keyword search alone.

    Args:
        topic: A topic or question (e.g. "database optimization", "React state management")
        max_results: Maximum results to return (default 15)
    """
    graph = _load()
    topic_lower = topic.lower()
    topic_terms = set(topic_lower.split())
    tabs = graph.get("tabs", [])
    tab_map = {t["id"]: t for t in tabs}
    edges = graph.get("edges", [])

    adj: Dict[int, List[int]] = {}
    for edge in edges:
        s, t = edge.get("source"), edge.get("target")
        adj.setdefault(s, []).append(t)
        adj.setdefault(t, []).append(s)

    seed_scores: Dict[int, float] = {}
    for tab in tabs:
        if tab.get("duplicate_of") is not None:
            continue

        tid = tab["id"]
        title = (tab.get("title") or "").lower()
        keywords = [k.lower() for k in tab.get("keywords", [])]
        summary = (tab.get("summary") or "").lower()

        score = 0.0
        keyword_set = set(keywords)
        overlap = topic_terms & keyword_set
        score += len(overlap) * 2.0
        for term in topic_terms:
            if term in title:
                score += 1.5
            elif term in summary:
                score += 0.5

        if score > 0:
            seed_scores[tid] = score

    expanded: Dict[int, float] = dict(seed_scores)
    for tid, score in seed_scores.items():
        for neighbor_id in adj.get(tid, []):
            if neighbor_id not in expanded or expanded[neighbor_id] < score * 0.5:
                expanded[neighbor_id] = max(expanded.get(neighbor_id, 0), score * 0.5)

    ranked = sorted(expanded.items(), key=lambda x: x[1], reverse=True)

    results = []
    seen_groups = set()
    related_groups = []

    for tid, score in ranked[:max_results]:
        tab = tab_map.get(tid)
        if not tab:
            continue
        entry = _tab_summary(tab)
        entry["relevance_score"] = round(score, 3)
        entry["is_direct_match"] = tid in seed_scores
        results.append(entry)

        gid = tab.get("group_id")
        if gid is not None and gid not in seen_groups:
            seen_groups.add(gid)
            for g in graph.get("groups", []):
                if g["id"] == gid:
                    related_groups.append({"id": gid, "label": g.get("label", ""), "size": g.get("size", 0)})
                    break

    return json.dumps({
        "topic": topic,
        "tab_count": len(results),
        "related_groups": related_groups,
        "tabs": results,
    }, indent=2)


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
