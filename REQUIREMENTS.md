# Functional and Non-Functional Requirements

## Functional Requirements (FRs)

### Data Extraction
- Export open tabs from Chrome and Firefox into a JSON backup file.
- Import/restore tabs from a JSON backup into Chrome and Firefox.
- Ingest tab JSON and normalize fields (url, title, browser, window, domain).
- Crawl URLs and extract readable text for each tab.
- Generate summaries with a local LLM (Ollama or GGUF backend).
- Generate embeddings with a local model to power similarity and clustering.

### Graph Construction
- Build a knowledge graph JSON with tabs, groups, and edges.
- Deduplicate tabs using canonical URLs and near-duplicate text (SimHash).
- Compute pairwise similarity (Jaccard on keywords or cosine on embeddings).
- Clamp all similarity scores to [0, 1].

### Clustering
- Cluster tabs using Louvain community detection (default).
- Fall back to legacy Union-Find + mutual KNN clustering with `--no-louvain`.
- Support resolution parameter for Louvain to control cluster granularity.
- Compute and expose modularity score Q for cluster quality measurement.
- Label groups using PageRank-weighted TF-IDF keywords.

### Node Importance
- Compute PageRank scores for all tabs based on the similarity graph.
- Sort tabs within groups by PageRank (most important first).
- Use PageRank weights in group label generation.

### Graph Exploration
- Provide a TUI to browse groups, tabs, and summaries.
- Provide a graph view in the TUI with neighbor navigation.
- Support fuzzy search, #tag filtering, and @domain filtering.
- Open grouped tabs in Chrome and Firefox on demand.

### Chrome Extension
- Live tab tracking with content extraction.
- Navigation edge tracking (including SPA navigations).
- Real-time Louvain clustering with PageRank in the extension.
- Group actions: open all, close all, copy links.
- Live/closed/stale tab indicators.
- Keyboard navigation (j/k/Enter/o).
- Configurable settings (server URL, auto-rebuild, stale threshold).
- First-run onboarding experience.
- Toast notifications for all user actions.
- Import/export compatible with CLI JSON format.

### Server and Integration
- FastAPI server with health, insights, and sync endpoints.
- MCP server for Claude Desktop integration.
- Obsidian vault export with linked markdown notes.
- Cache summaries/embeddings for reuse across runs.

## Non-Functional Requirements (NFRs)
- Local-first processing: summaries, embeddings, and clustering run locally by default.
- Privacy: no telemetry; network access only for fetching URLs and optional Ollama calls.
- Cross-platform: graph build and TUI run on macOS, Windows, and Linux.
- Performance: handle 100+ tabs comfortably; O(n log n) Louvain vs O(n^2) legacy clustering.
- Reliability: continue on partial failures (fetch/summary/embed); record errors per tab.
- Usability: CLI commands are simple and discoverable; extension is fully keyboard-driven.
- Maintainability: graph output is JSON with a stable schema and versioning.
- Security: do not execute page scripts unless JS mode is explicitly enabled.
