"""FastAPI server for Weft."""

import json
import os
from typing import Dict, List, Optional
from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from weft.describe_graph import generate_insights, load_graph

app = FastAPI(title="Weft Server")

# Enable CORS for browser extension
# SECURITY NOTE: In production, restrict allow_origins to your specific extension ID:
#   allow_origins=["chrome-extension://YOUR_EXTENSION_ID"]
# Using "*" is acceptable for local-only use but exposes the API to any origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Server port (set via environment or CLI)
SERVER_PORT = int(os.environ.get("WEFT_SERVER_PORT", "8000"))

GRAPH_PATH = os.environ.get("WEFT_GRAPH_PATH", "weft_graph.json")

class Tab(BaseModel):
    id: int
    url: str
    title: str
    active: bool = False

class SyncRequest(BaseModel):
    tabs: List[Tab]

@app.get("/insights")
async def get_insights():
    """Get insights report."""
    graph = load_graph(GRAPH_PATH)
    return generate_insights(graph)

@app.post("/sync")
async def sync_tabs(request: SyncRequest):
    """Sync tabs from browser and return updated insights."""
    from weft.export.graph import build_tab_graph
    from weft.utils.text import extract_keywords
    from weft.utils.url import normalize_domain

    # Load existing graph
    graph = load_graph(GRAPH_PATH)
    
    # Process incoming active tabs
    active_tabs = []
    seen_urls = set()
    
    # Convert request tabs to graph format
    for t in request.tabs:
        if not t.url or t.url in seen_urls:
            continue
        seen_urls.add(t.url)
        
        # Simple extraction for real-time speed
        domain = normalize_domain(t.url)
        keywords = extract_keywords(t.title or "", 5)
        
        active_tabs.append({
            "id": f"active_{t.id}",
            "url": t.url,
            "title": t.title,
            "domain": domain,
            "keywords": keywords,
            "summary": "", # No realtime summary for speed
            "group_id": -1
        })

    # Merge into a temporary graph for insights
    # We prioritize active tabs for "Current Session" feel
    # But for stats we want total history too.
    # Let's just append them to the list of tabs in memory
    
    # Check if these tabs are already in graph to avoid duplicates
    existing_urls = {t.get("url") for t in graph.get("tabs", [])}
    new_tabs = [t for t in active_tabs if t["url"] not in existing_urls]
    
    # Add to graph
    graph["tabs"].extend(new_tabs)
    
    # Recalculate basic stats effectively
    graph["stats"]["tab_count"] = len(graph["tabs"])
    
    return {
        "status": "ok", 
        "tab_count": len(request.tabs),
        "insights": generate_insights(graph)
    }

@app.get("/health")
async def health():
    return {"status": "ok"}
