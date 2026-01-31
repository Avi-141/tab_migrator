"""Logic for generating insights and summaries from the graph."""

import json
import os
from typing import Dict, List, Optional
import textwrap

def load_graph(path: str = "weft_graph.json") -> Dict:
    """Load graph from JSON file."""
    if not os.path.exists(path):
        return {"tabs": [], "groups": [], "edges": [], "stats": {}}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def get_top_keywords(graph: Dict, limit: int = 10) -> List[str]:
    """Extract top keywords across the entire graph."""
    keyword_counts: Dict[str, int] = {}
    for tab in graph.get("tabs", []):
        for kw in tab.get("keywords", []):
            keyword_counts[kw] = keyword_counts.get(kw, 0) + 1
    
    return [k for k, _ in sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True)[:limit]]

def get_top_domains(graph: Dict, limit: int = 5) -> List[str]:
    """Extract top domains by tab count."""
    domain_counts: Dict[str, int] = {}
    for tab in graph.get("tabs", []):
        domain = tab.get("domain", "")
        if domain:
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
            
    return [k for k, _ in sorted(domain_counts.items(), key=lambda x: x[1], reverse=True)[:limit]]

def generate_insights(graph: Dict, use_emoji: bool = True) -> str:
    """Generate a markdown report of browsing insights.

    Args:
        graph: The knowledge graph dictionary
        use_emoji: Whether to include emoji in headings (default True)
    """
    stats = graph.get("stats", {})
    tab_count = stats.get("tab_count", 0)
    group_count = stats.get("group_count", 0)

    # Top Groups
    groups = graph.get("groups", [])
    # Sort by size
    sorted_groups = sorted(groups, key=lambda g: g.get("size", 0), reverse=True)
    top_groups = sorted_groups[:5]

    top_keywords = get_top_keywords(graph)
    top_domains = get_top_domains(graph)

    # Emoji prefixes (or empty strings if disabled)
    e_brain = "🧠 " if use_emoji else ""
    e_target = "🎯 " if use_emoji else ""
    e_key = "🔑 " if use_emoji else ""
    e_globe = "🌐 " if use_emoji else ""

    report = []
    report.append(f"# {e_brain}Browsing Memory Report")
    report.append(f"**Tabs tracked:** {tab_count} | **Knowledge Clusters:** {group_count}")
    report.append("")

    report.append(f"## {e_target}Top Research Topics")
    if top_groups:
        for i, group in enumerate(top_groups, 1):
            label = group.get("label", "Unknown Cluster")
            size = group.get("size", 0)
            report.append(f"{i}. **{label}** ({size} items)")
    else:
        report.append("_No clusters found yet._")
    report.append("")

    report.append(f"## {e_key}Key Themes")
    if top_keywords:
        report.append(", ".join([f"`{k}`" for k in top_keywords]))
    else:
        report.append("_Not enough data for themes._")
    report.append("")

    report.append(f"## {e_globe}Top Sources")
    if top_domains:
        for d in top_domains:
            report.append(f"- {d}")

    return "\n".join(report)
