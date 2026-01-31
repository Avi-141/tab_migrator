"""MCP Server for Weft."""

import json
import os
from typing import List, Optional

from fastmcp import FastMCP
from weft.describe_graph import generate_insights, load_graph

# Initialize MCP Server
mcp = FastMCP("Weft Browsing Memory")

@mcp.resource("browsing://insights")
def get_insights() -> str:
    """Get a simulated memory report and insights from your browsing history."""
    graph = load_graph()
    return generate_insights(graph)

@mcp.resource("browsing://groups")
def get_groups() -> str:
    """Get a list of all knowledge clusters/groups."""
    graph = load_graph()
    groups = graph.get("groups", [])
    # Simplified view
    simple_groups = [
        {"id": g["id"], "label": g["label"], "size": g["size"], "tab_ids": g["tab_ids"]}
        for g in groups
    ]
    return json.dumps(simple_groups, indent=2)

@mcp.tool()
def search_knowledge(query: str) -> str:
    """Search your browsing history for a specific topic or keyword.
    
    Args:
        query: The search query (e.g. "python async", "react hooks", "github copilot")
    """
    graph = load_graph()
    query = query.lower()
    results = []
    
    # Simple search implementation
    for tab in graph.get("tabs", []):
        text = (tab.get("title", "") + " " + tab.get("summary", "") + " " + " ".join(tab.get("keywords", []))).lower()
        if query in text:
            results.append({
                "title": tab.get("title"),
                "url": tab.get("url"),
                "summary": tab.get("summary"),
                "group": tab.get("group_id")
            })
            
    # Limit results
    return json.dumps(results[:10], indent=2)

@mcp.tool()
def get_group_details(group_id: int) -> str:
    """Get all tabs and details for a specific knowledge cluster/group.
    
    Args:
        group_id: The ID of the group to retrieve.
    """
    graph = load_graph()
    groups = {g["id"]: g for g in graph.get("groups", [])}
    group = groups.get(group_id)
    
    if not group:
        return f"Group {group_id} not found."
        
    # Enrich with tab details
    tab_map = {t["id"]: t for t in graph.get("tabs", [])}
    
    detailed_tabs = []
    for tid in group.get("tab_ids", []):
        t = tab_map.get(tid)
        if t:
            detailed_tabs.append({
                "title": t.get("title"),
                "url": t.get("url"),
                "summary": t.get("summary")
            })
            
    return json.dumps({
        "group": group,
        "tabs": detailed_tabs
    }, indent=2)

def main():
    """Run the MCP server."""
    mcp.run()

if __name__ == "__main__":
    main()
