"""Export Weft graph to Obsidian vault."""

import os
from typing import Dict, List, Set
from datetime import datetime
from weft.utils.text import clean_filename


def build_group_adjacency(graph: Dict) -> Dict[int, List[tuple]]:
    """Build adjacency map between groups based on edges."""
    edges = graph.get("edges", [])
    tabs = graph.get("tabs", [])
    groups = graph.get("groups", [])

    # Map tab IDs to group IDs
    tab_to_group = {}
    for group in groups:
        gid = group.get("id")
        for tid in group.get("tab_ids", []):
            tab_to_group[tid] = gid

    # Aggregate edge weights between groups
    weights: Dict[tuple, float] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source is None or target is None:
            continue
        ga = tab_to_group.get(source)
        gb = tab_to_group.get(target)
        if ga is None or gb is None or ga == gb:
            continue
        key = (min(ga, gb), max(ga, gb))
        weights[key] = weights.get(key, 0.0) + float(edge.get("weight", 0.0))

    # Build adjacency list
    adjacency: Dict[int, List[tuple]] = {}
    for (ga, gb), weight in weights.items():
        if ga not in adjacency:
            adjacency[ga] = []
        if gb not in adjacency:
            adjacency[gb] = []
        adjacency[ga].append((gb, weight))
        adjacency[gb].append((ga, weight))

    # Sort by weight (strongest connections first)
    for gid in adjacency:
        adjacency[gid].sort(key=lambda t: t[1], reverse=True)

    return adjacency


def export_to_obsidian(graph: Dict, vault_path: str):
    """Export the graph as a folder of markdown files in an Obsidian vault."""

    # Base directory in the vault
    export_dir = os.path.join(vault_path, "Weft Browsing")
    os.makedirs(export_dir, exist_ok=True)

    groups = graph.get("groups", [])
    tabs = graph.get("tabs", [])
    edges = graph.get("edges", [])

    # Build group adjacency for related links
    adjacency = build_group_adjacency(graph)

    # Map group IDs to labels for linking
    group_id_to_label = {g["id"]: g.get("label", "Untitled Group") for g in groups}
    group_id_to_safe_title = {g["id"]: clean_filename(g.get("label", "Untitled Group")) for g in groups}

    # Track existing files for deduplication
    existing_files: Set[str] = set()
    for f in os.listdir(export_dir):
        if f.endswith(".md"):
            existing_files.add(f)

    # Helper to find tabs for a group
    def get_tabs_for_group(group_id):
        tab_ids = next((g["tab_ids"] for g in groups if g["id"] == group_id), [])
        return [t for t in tabs if t["id"] in tab_ids]

    written_count = 0
    updated_count = 0
    exported_files = []

    for group in groups:
        title = group.get("label", "Untitled Group")
        safe_title = clean_filename(title)
        group_tabs = get_tabs_for_group(group["id"])
        filename = f"{safe_title}.md"
        file_path = os.path.join(export_dir, filename)

        # Check if file already exists (deduplication)
        is_update = filename in existing_files

        # Frontmatter
        frontmatter = [
            "---",
            f"type: browsing-cluster",
            f"date: {datetime.now().strftime('%Y-%m-%d')}",
            f"url_count: {len(group_tabs)}",
            f"tags: [weft, browsing]",
            "---",
            ""
        ]

        # Content
        content = [
            f"# {title}",
            "",
            "## Tabs",
            ""
        ]

        for tab in group_tabs:
            tab_title = tab.get("title") or tab.get("url")
            content.append(f"- [{tab_title}]({tab['url']})")
            if tab.get("summary"):
                content.append(f"  - {tab['summary']}")

        content.append("")
        content.append("## Related")
        content.append("")

        # Add links to related groups using edge data
        related_groups = adjacency.get(group["id"], [])[:5]  # Top 5 related
        if related_groups:
            for related_id, weight in related_groups:
                related_label = group_id_to_label.get(related_id, "Unknown")
                related_safe = group_id_to_safe_title.get(related_id, "Unknown")
                content.append(f"- [[{related_safe}|{related_label}]]")
        else:
            content.append("_No related clusters found._")

        with open(file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(frontmatter + content))

        exported_files.append((safe_title, title, len(group_tabs)))

        if is_update:
            updated_count += 1
        else:
            written_count += 1

    # Generate index file
    index_content = [
        "---",
        "type: weft-index",
        f"date: {datetime.now().strftime('%Y-%m-%d')}",
        f"cluster_count: {len(groups)}",
        "tags: [weft, browsing, index]",
        "---",
        "",
        "# Weft Browsing Index",
        "",
        f"**Total Clusters:** {len(groups)} | **Total Tabs:** {len(tabs)}",
        "",
        "## Clusters",
        ""
    ]

    # Sort by tab count (largest first)
    exported_files.sort(key=lambda x: x[2], reverse=True)
    for safe_title, title, tab_count in exported_files:
        index_content.append(f"- [[{safe_title}|{title}]] ({tab_count} tabs)")

    index_path = os.path.join(export_dir, "Index.md")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write("\n".join(index_content))

    print(f"Exported {written_count} new clusters, updated {updated_count} existing clusters")
    print(f"Index created at {index_path}")
