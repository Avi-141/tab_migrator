# Weft

**Local-first knowledge graph for your browsing.**

Weft turns browser tabs into a searchable, clustered knowledge graph using Louvain community detection and PageRank. No cloud. No accounts. Everything runs on your machine.

**Think:** Obsidian graph view, but for the web you already have open.

[![PyPI](https://img.shields.io/pypi/v/weft-graph)](https://pypi.org/project/weft-graph/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)

---

## Why Weft

You have 80 tabs open. Some are related. Some are duplicates. You can't remember what you were researching yesterday.

Weft fixes this:
- **Clusters tabs by topic** using graph algorithms, not manual folders
- **Deduplicates** with URL canonicalization + SimHash near-duplicate detection
- **Tracks navigation** so "A led to B" is a first-class relationship
- **Runs locally** — your browsing data never leaves your machine

---

## Two Ways to Use Weft

| | Chrome Extension | CLI (Python) |
|---|---|---|
| **Best for** | Live tracking, visual exploration | Batch processing, scripting, MCP |
| **Graph View** | Interactive sidepanel with Cytoscape.js | Terminal UI with Textual |
| **Clustering** | Real-time Louvain | Configurable Louvain or Union-Find |
| **Install** | Load unpacked extension | `pip install weft-graph` |

---

## Chrome Extension

Live knowledge graph that tracks your browsing in real-time.

![Weft Extension Demo](https://raw.githubusercontent.com/Avi-141/weft/main/extension-demo.gif)

### Features

- **Live Tab Tracking** — captures tabs as you browse, extracts content automatically
- **Louvain Clustering** — groups related pages using community detection, not arbitrary thresholds
- **PageRank Sorting** — most important tabs surface to the top of each group
- **Navigation Edges** — tracks how you move between pages, including SPA navigations
- **Graph Visualization** — interactive Cytoscape.js graph with color-coded clusters
- **Smart Search** — fuzzy text, `#keyword`, and `@domain` filters with search history
- **Group Actions** — open all, close all, or copy links for any cluster
- **Live Tab Indicators** — see which tabs are open, closed, or stale at a glance
- **Stale Tab Detection** — highlights tabs you haven't touched in 24+ hours
- **Keyboard Navigation** — full `j/k/Enter/o` navigation, vim-style
- **Settings** — configurable server URL, auto-rebuild, stale threshold
- **Onboarding** — guided first-run experience
- **Import/Export** — JSON format compatible with CLI
- **Offline Insights** — browsing report works without the server

### Install Extension

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select the `extension/` folder
5. Click the Weft icon to open the sidepanel

### Keyboard Shortcuts (Extension)

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `g` / `v` / `i` | Switch to Groups / Graph / Insights |
| `r` | Rebuild graph |
| `j` / `k` | Navigate groups and tabs |
| `Enter` | Expand group or open tab |
| `o` | Open focused tab |
| `Esc` | Close panel / exit settings |

---

## CLI Tool

Batch processing, terminal UI, API server, and MCP integration.

![Weft CLI Demo](https://raw.githubusercontent.com/Avi-141/weft/main/demo.gif)

### Install CLI

```bash
pip install weft-graph
```

Or from source:

```bash
git clone https://github.com/Avi-141/weft.git
cd weft
pip install -e .
```

### Quick Start

```bash
# Build knowledge graph from browser tabs
weft weave

# Explore in terminal UI
weft explore

# Start API + MCP server
weft serve
```

### Commands

#### `weft weave`

Extracts tabs from browsers and builds a knowledge graph.

```bash
# Default: all browsers, Louvain clustering
weft weave

# Chrome only, fast mode (no crawling)
weft weave --browser chrome --no-crawl

# With LLM summaries (requires Ollama)
weft weave --summarize

# Legacy clustering (Union-Find + mutual KNN)
weft weave --no-louvain

# Tighter clusters
weft weave --louvain-resolution 1.5

# Looser clusters
weft weave --louvain-resolution 0.7
```

#### `weft explore`

Interactive TUI for browsing your knowledge graph.

```bash
weft explore
weft explore my_graph.json
```

#### `weft insights`

Print a markdown report of your browsing: top topics, key themes, domain breakdown.

```bash
weft insights
```

#### `weft serve`

Run the API and MCP server for real-time extension sync and Claude Desktop integration.

```bash
weft serve
# Runs at http://localhost:8000
```

#### `weft install-mcp` (macOS)

Configure Claude Desktop to talk to Weft via MCP.

```bash
weft install-mcp
```

Then ask Claude: *"What was I researching about distributed systems?"*

#### `weft export-obsidian`

Export knowledge clusters as linked markdown notes to your Obsidian vault.

```bash
weft export-obsidian "/path/to/vault"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    DATA SOURCES                      │
│  Chrome (AppleScript)  Firefox (sessionstore)        │
│  Chrome Extension (live capture via chrome.tabs)     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                  EXTRACT + ANALYZE                   │
│  HTTP crawl (requests + trafilatura)                 │
│  Content script DOM extraction (extension)           │
│  Keyword extraction (TF) + SimHash fingerprinting    │
│  Optional: LLM summaries + embeddings (Ollama)       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                    DEDUPLICATE                        │
│  Canonical URL normalization (strip tracking, www)   │
│  SimHash near-duplicate detection (same domain)      │
│  Union-Find to merge duplicate sets                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              CLUSTER (LOUVAIN + PAGERANK)             │
│  Similarity matrix (Jaccard or cosine + domain)      │
│  Louvain community detection (modularity Q)          │
│  PageRank for node importance scoring                │
│  PageRank-weighted TF-IDF group labeling             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   GRAPH OUTPUT                        │
│  { tabs, groups, edges, stats }                      │
│  schema_version: 1                                   │
│  modularity score + clustering method in stats       │
└──────┬───────────┬────────────┬─────────────────────┘
       │           │            │
       ▼           ▼            ▼
  CLI / TUI    Extension    Server / MCP
  (Textual)   (Cytoscape)   (FastAPI)
```

---

## Algorithms

### Louvain Community Detection

Weft uses the [Louvain method](https://en.wikipedia.org/wiki/Louvain_method) for clustering tabs. Instead of forcing tabs together by domain or arbitrary thresholds, Louvain optimizes **modularity** — finding groups where internal similarity is denser than expected by chance.

**How it works:**
1. Build a weighted graph from the similarity matrix (edges above threshold)
2. Start with each tab in its own community
3. For each tab, compute the modularity gain of moving it to each neighbor's community
4. Move it to the community with the highest gain (if positive)
5. Repeat until no single move improves modularity

**Resolution parameter:** Controls cluster granularity. Default is 1.0. Values >1.0 produce smaller, tighter clusters. Values <1.0 produce larger, looser ones.

**Modularity Q:** A score from -0.5 to 1.0 measuring cluster quality. Values above 0.3 indicate meaningful community structure. Weft reports this in graph stats and the extension UI.

### PageRank

Each tab gets a [PageRank](https://en.wikipedia.org/wiki/PageRank) score based on its position in the similarity graph. Tabs that are highly connected to other important tabs rank higher.

**Used for:**
- **Sorting** — tabs within each group are ordered by importance
- **Labeling** — group labels are generated using PageRank-weighted TF-IDF, so the label reflects the most central content in the cluster, not just the most frequent words

### Similarity

| Mode | Method | When |
|------|--------|------|
| Default | Jaccard similarity on extracted keywords | Always available |
| Embeddings | Cosine similarity on vector embeddings | With `--summarize` (Ollama) |
| Domain bonus | +0.25 for same-domain tabs | Always applied |

All scores are clamped to [0, 1].

### Deduplication

Two-stage deduplication using Union-Find:

1. **Canonical URL** — normalize URLs (strip tracking params, www, fragments) and merge exact matches
2. **SimHash** — 64-bit locality-sensitive hash of page content; tabs with Hamming distance ≤ 3 on the same domain are merged as near-duplicates

### Edge Types

| Type | Description | Weight |
|------|-------------|--------|
| Similarity | Tabs with related content | 0–1.0 (Jaccard/cosine) |
| Similarity+Domain | Similar content + same domain | 0–1.0 |
| Navigation | User clicked from A to B | 1.0 |

---

## MCP Integration

Weft exposes your browsing context to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

**Resources:**
- `browsing://insights` — browsing memory report with top topics, themes, sources
- `browsing://groups` — all clusters with labels, keywords, domains, sizes
- `browsing://stats` — graph metrics: tab count, modularity, clustering method

**Tools:**
- `search_knowledge(query)` — ranked search across titles, summaries, keywords, URLs. Scores by keyword overlap + PageRank.
- `get_group_details(group_id)` — cluster deep-dive: synthesized summary, tabs sorted by PageRank, top keywords and domains
- `get_tab_neighbors(tab_id)` — graph neighborhood: all tabs connected by similarity or navigation edges, with edge weights
- `find_recent_tabs(hours)` — temporal query: tabs active within the last N hours
- `find_stale_tabs(stale_hours)` — cleanup candidates: tabs not accessed in N+ hours, sorted by staleness
- `find_related_to_topic(topic)` — topic expansion: finds direct keyword matches, then follows graph edges to discover related content you wouldn't find by search alone

```bash
# Install MCP for Claude Desktop
weft install-mcp

# Start the server
weft serve
```

Example prompts for Claude:
- *"What was I researching about Python async?"*
- *"Show me tabs related to database optimization"*
- *"What have I been browsing in the last 2 hours?"*
- *"Find stale tabs I should close"*
- *"What's connected to the React hooks guide I was reading?"*

---

## Requirements

### Extension
- Chrome or Chromium browser

### CLI
- Python 3.9+
- macOS or Windows
- Chrome and/or Firefox

### Optional

```bash
# LLM summaries (embedding-based clustering)
brew install ollama
ollama pull llama3.1:8b
ollama pull nomic-embed-text
weft weave --summarize

# Firefox tab export
pip install lz4

# JS-heavy page rendering
pip install playwright
```

---

## Privacy

Weft is **fully local**:
- Extension stores data in IndexedDB (browser-local)
- CLI stores data in local JSON files
- No analytics, no telemetry, no cloud sync
- Network access only for fetching URLs you provide and optional Ollama calls on localhost

---

## License

MIT
