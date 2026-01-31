/**
 * Weft Sidepanel Application
 * Main UI logic for the extension sidepanel.
 */

// State
let graphData = { tabs: [], edges: [], groups: [] };
let cy = null; // Cytoscape instance
let selectedTab = null;
let searchQuery = "";
let cachedInsights = null; // { content: string, timestamp: number }
let searchHistory = []; // Array of recent search queries
const MAX_SEARCH_HISTORY = 8;

// DOM Elements
const elements = {
  searchInput: document.getElementById("search-input"),
  groupsList: document.getElementById("groups-list"),
  groupsView: document.getElementById("groups-view"),
  graphView: document.getElementById("graph-view"),
  viewGroups: document.getElementById("view-groups"),
  viewGraph: document.getElementById("view-graph"),
  viewInsights: document.getElementById("view-insights"),
  insightsView: document.getElementById("insights-view"),
  insightsContent: document.getElementById("insights-content"),
  btnFetchInsights: document.getElementById("btn-fetch-insights"),
  detailsPanel: document.getElementById("details-panel"),
  detailsTitle: document.getElementById("details-title"),
  detailsUrl: document.getElementById("details-url"),
  detailsDomain: document.getElementById("details-domain"),
  detailsKeywords: document.getElementById("details-keywords"),
  detailsGroup: document.getElementById("details-group"),
  detailsClose: document.getElementById("details-close"),
  btnOpenTab: document.getElementById("btn-open-tab"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnImport: document.getElementById("btn-import"),
  btnExport: document.getElementById("btn-export"),
  btnZoomIn: document.getElementById("btn-zoom-in"),
  btnZoomOut: document.getElementById("btn-zoom-out"),
  btnFit: document.getElementById("btn-fit"),
  fileInput: document.getElementById("file-input"),
  statsTabs: document.getElementById("stats-tabs"),
  statsGroups: document.getElementById("stats-groups"),
  statsEdges: document.getElementById("stats-edges"),
  cyContainer: document.getElementById("cy"),
  searchHistory: document.getElementById("search-history"),
  detailsRelated: document.getElementById("details-related"),
  sessionTimeline: document.getElementById("session-timeline"),
  timelineChart: document.getElementById("timeline-chart")
};

// ============ INITIALIZATION ============

async function init() {
  // Load graph data
  await loadGraphData();

  // Load search history from storage
  loadSearchHistory();

  // Set up event listeners
  setupEventListeners();

  // Initialize Cytoscape
  initCytoscape();

  // Auto-rebuild if we have tabs but no edges/groups
  if (graphData.tabs.length > 0 && (graphData.edges.length === 0 || graphData.groups.length === 0)) {
    console.log("[Weft] Auto-rebuilding graph on first load...");
    await refreshGraph();
  }

  // Render initial view
  renderGroups();
  updateStats();
}

async function loadGraphData() {
  try {
    graphData = await chrome.runtime.sendMessage({ type: "GET_GRAPH_DATA" });
  } catch (e) {
    console.error("Failed to load graph data:", e);
    graphData = { tabs: [], edges: [], groups: [] };
  }
}

function setupEventListeners() {
  // View toggle
  elements.viewGroups.addEventListener("click", () => switchView("groups"));
  elements.viewGraph.addEventListener("click", () => switchView("graph"));
  elements.viewInsights.addEventListener("click", () => switchView("insights"));
  elements.btnFetchInsights.addEventListener("click", fetchInsights);

  // Search
  elements.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    applySearch();
  });

  // Search input focus - show history
  elements.searchInput.addEventListener("focus", () => {
    if (searchHistory.length > 0) {
      renderSearchHistory();
      elements.searchHistory.classList.remove("hidden");
    }
  });

  // Search input blur - hide history (with delay for clicks)
  elements.searchInput.addEventListener("blur", () => {
    setTimeout(() => {
      elements.searchHistory.classList.add("hidden");
    }, 200);
  });

  // Search input enter - save to history
  elements.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      addToSearchHistory(searchQuery.trim());
      elements.searchHistory.classList.add("hidden");
    }
  });

  // Details panel
  elements.detailsClose.addEventListener("click", hideDetails);
  elements.btnOpenTab.addEventListener("click", openSelectedTab);

  // Actions
  elements.btnRefresh.addEventListener("click", refreshGraph);
  elements.btnImport.addEventListener("click", () => elements.fileInput.click());
  elements.btnExport.addEventListener("click", exportGraph);
  elements.fileInput.addEventListener("change", handleFileImport);

  // Zoom controls
  elements.btnZoomIn.addEventListener("click", () => zoomGraph(1.3));
  elements.btnZoomOut.addEventListener("click", () => zoomGraph(0.7));
  elements.btnFit.addEventListener("click", fitGraph);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideDetails();
    } else if (e.key === "/" && document.activeElement !== elements.searchInput) {
      e.preventDefault();
      elements.searchInput.focus();
    } else if (e.key === "i" && document.activeElement !== elements.searchInput) {
      e.preventDefault();
      switchView("insights");
    } else if (e.key === "g" && document.activeElement !== elements.searchInput) {
      e.preventDefault();
      switchView("groups");
    } else if (e.key === "v" && document.activeElement !== elements.searchInput) {
      e.preventDefault();
      switchView("graph");
    }
  });
}

// ============ VIEW MANAGEMENT ============

function switchView(view) {
  if (view === "groups") {
    elements.groupsView.classList.add("active");
    elements.graphView.classList.remove("active");
    elements.insightsView.classList.remove("active");
    elements.viewGroups.classList.add("active");
    elements.viewGraph.classList.remove("active");
    elements.viewInsights.classList.remove("active");
  } else if (view === "graph") {
    elements.groupsView.classList.remove("active");
    elements.graphView.classList.add("active");
    elements.insightsView.classList.remove("active");
    elements.viewGroups.classList.remove("active");
    elements.viewGraph.classList.add("active");
    elements.viewInsights.classList.remove("active");
    renderGraph();
  } else if (view === "insights") {
    elements.groupsView.classList.remove("active");
    elements.graphView.classList.remove("active");
    elements.insightsView.classList.add("active");
    elements.viewGroups.classList.remove("active");
    elements.viewGraph.classList.remove("active");
    elements.viewInsights.classList.add("active");
    // Render session timeline
    renderSessionTimeline();
    // Auto-fetch if first time or stale?
    // For now, let user click refresh or auto fetch
    fetchInsights();
  }
}

async function fetchInsights() {
  const content = elements.insightsContent;

  // Show cached insights with stale indicator if available
  if (cachedInsights) {
    const age = Math.round((Date.now() - cachedInsights.timestamp) / 60000);
    content.innerHTML = `<div class="stale-notice">Last updated ${age} min ago</div>` + cachedInsights.html;
  } else {
    content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  try {
    // 1. Get current tabs
    const tabs = await chrome.tabs.query({ currentWindow: true });

    // 2. Sync tabs to server
    const syncPayload = {
      tabs: tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active
      }))
    };

    const syncResponse = await fetch("http://localhost:8000/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syncPayload)
    });

    if (!syncResponse.ok) throw new Error("Sync failed");
    const syncResult = await syncResponse.json();

    // 3. Render returned insights
    const html = renderMarkdown(syncResult.insights);

    // Cache the result
    cachedInsights = { html, timestamp: Date.now() };
    content.innerHTML = html;
  } catch (e) {
    // Fallback to offline insights from local graph data
    const offlineInsights = generateOfflineInsights();
    if (offlineInsights) {
      const html = renderMarkdown(offlineInsights);
      // Cache the offline result too
      cachedInsights = { html, timestamp: Date.now() };
      content.innerHTML = html;
    } else {
      content.innerHTML = `
        <div class="placeholder-text">
          <p>No browsing data yet.</p>
          <p class="small-text">Browse some tabs to build your knowledge graph.</p>
        </div>
      `;
    }
  }
}

/**
 * Render markdown to HTML with proper list wrapping.
 */
function renderMarkdown(text) {
  if (!text) return "";

  const lines = text.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    // Headers
    if (line.startsWith("# ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
    } else if (line.startsWith("## ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith("### ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
    } else if (line.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${formatInline(line.slice(2))}</li>`;
    } else if (line.match(/^\d+\.\s/)) {
      // Numbered list item
      if (!inList) { html += "<ol>"; inList = true; }
      html += `<li>${formatInline(line.replace(/^\d+\.\s/, ""))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) {
        html += `<p>${formatInline(line)}</p>`;
      }
    }
  }
  if (inList) html += "</ul>";

  return html;
}

/**
 * Format inline markdown (bold, code, etc.)
 */
function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Generate insights from local graph data when server is unavailable.
 */
function generateOfflineInsights() {
  if (!graphData.tabs.length) return null;

  const tabCount = graphData.tabs.filter(t => !t.duplicateOf).length;
  const groupCount = graphData.groups.length;

  // Get top groups
  const sortedGroups = [...graphData.groups].sort((a, b) => (b.size || b.tabIds?.length || 0) - (a.size || a.tabIds?.length || 0));
  const topGroups = sortedGroups.slice(0, 5);

  // Get top keywords
  const keywordCounts = {};
  for (const tab of graphData.tabs) {
    for (const kw of (tab.keywords || [])) {
      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Get top domains
  const domainCounts = {};
  for (const tab of graphData.tabs) {
    if (tab.domain) {
      domainCounts[tab.domain] = (domainCounts[tab.domain] || 0) + 1;
    }
  }
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);

  // Build report
  const lines = [
    "# Browsing Memory Report",
    `**Tabs tracked:** ${tabCount} | **Knowledge Clusters:** ${groupCount}`,
    "",
    "## Top Research Topics"
  ];

  if (topGroups.length) {
    topGroups.forEach((g, i) => {
      const size = g.size || g.tabIds?.length || 0;
      lines.push(`${i + 1}. **${g.label}** (${size} items)`);
    });
  } else {
    lines.push("_No clusters found yet._");
  }

  lines.push("");
  lines.push("## Key Themes");
  if (topKeywords.length) {
    lines.push(topKeywords.map(k => `\`${k}\``).join(", "));
  } else {
    lines.push("_Not enough data for themes._");
  }

  lines.push("");
  lines.push("## Top Sources");
  for (const d of topDomains) {
    lines.push(`- ${d}`);
  }

  return lines.join("\n");
}

// ============ GROUPS VIEW ============

function renderGroups() {
  const groups = getFilteredGroups();

  if (groups.length === 0) {
    elements.groupsList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12h8M12 8v8"/>
        </svg>
        <h3>No groups yet</h3>
        <p>Browse some pages to start building your knowledge graph</p>
      </div>
    `;
    return;
  }

  elements.groupsList.innerHTML = groups.map(group => {
    const tabs = getTabsForGroup(group.id);
    return `
      <div class="group-card" data-group-id="${group.id}">
        <div class="group-header">
          <span class="group-label">${escapeHtml(group.label)}</span>
          <span class="group-size">${tabs.length}</span>
        </div>
        <div class="group-tabs">
          ${tabs.map(tab => `
            <div class="tab-item" data-tab-id="${tab.id}">
              <img class="tab-favicon" src="${getFaviconUrl(tab.url)}" alt="" onerror="this.style.display='none'">
              <div class="tab-info">
                <div class="tab-title">${escapeHtml(tab.title || tab.url)}</div>
                <div class="tab-domain">${escapeHtml(tab.domain)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Add click handlers
  document.querySelectorAll(".group-card").forEach(card => {
    card.querySelector(".group-header").addEventListener("click", () => {
      card.classList.toggle("expanded");
    });
  });

  document.querySelectorAll(".tab-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = item.dataset.tabId;
      const tab = graphData.tabs.find(t => t.id === tabId);
      if (tab) {
        showDetails(tab);
      }
    });
  });
}

function getTabsForGroup(groupId) {
  const group = graphData.groups.find(g => g.id === groupId);
  if (!group) return [];
  return group.tabIds
    .map(id => graphData.tabs.find(t => t.id === id))
    .filter(Boolean);
}

function getFilteredGroups() {
  // Sort by size (handling undefined)
  const sortBySize = (a, b) => {
    const aSize = a.size || a.tabIds?.length || 0;
    const bSize = b.size || b.tabIds?.length || 0;
    return bSize - aSize;
  };

  if (!searchQuery) {
    return [...graphData.groups].sort(sortBySize);
  }

  const query = searchQuery.toLowerCase();
  const keywordMatch = query.match(/#(\w+)/);
  const domainMatch = query.match(/@(\w+)/);
  const fuzzyQuery = query.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();

  return graphData.groups.filter(group => {
    const tabs = getTabsForGroup(group.id);

    // Domain filter
    if (domainMatch) {
      const domainQuery = domainMatch[1];
      if (!tabs.some(t => t.domain && t.domain.includes(domainQuery))) {
        return false;
      }
    }

    // Keyword filter
    if (keywordMatch) {
      const keyword = keywordMatch[1];
      if (!tabs.some(t => t.keywords && t.keywords.some(k => k.includes(keyword)))) {
        return false;
      }
    }

    // Fuzzy filter
    if (fuzzyQuery) {
      const matchesLabel = group.label.toLowerCase().includes(fuzzyQuery);
      const matchesTabs = tabs.some(t =>
        (t.title && t.title.toLowerCase().includes(fuzzyQuery)) ||
        (t.url && t.url.toLowerCase().includes(fuzzyQuery))
      );
      if (!matchesLabel && !matchesTabs) {
        return false;
      }
    }

    return true;
  }).sort(sortBySize);
}

// ============ GRAPH VIEW ============

function initCytoscape() {
  cy = cytoscape({
    container: elements.cyContainer,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "label": "",
          "width": "data(size)",
          "height": "data(size)",
          "border-width": 2,
          "border-color": "data(color)",
          "border-opacity": 0.3
        }
      },
      {
        selector: "node:active, node:grabbed",
        style: {
          "label": "data(label)",
          "font-size": "11px",
          "color": "#eaeaea",
          "text-valign": "bottom",
          "text-margin-y": 8,
          "text-background-color": "#1a1a2e",
          "text-background-opacity": 0.85,
          "text-background-padding": "4px",
          "text-max-width": "120px",
          "text-wrap": "ellipsis",
          "z-index": 999
        }
      },
      {
        selector: "node:selected",
        style: {
          "label": "data(label)",
          "font-size": "11px",
          "color": "#ffffff",
          "text-valign": "bottom",
          "text-margin-y": 8,
          "text-background-color": "#e94560",
          "text-background-opacity": 0.95,
          "text-background-padding": "4px",
          "text-max-width": "150px",
          "text-wrap": "ellipsis",
          "border-width": 3,
          "border-color": "#ff6b6b",
          "border-opacity": 1,
          "width": 30,
          "height": 30,
          "z-index": 1000
        }
      },
      {
        selector: "edge",
        style: {
          "width": "data(width)",
          "line-color": "#4a5568",
          "curve-style": "bezier",
          "opacity": 0.4
        }
      },
      {
        selector: "edge[reason = 'navigation']",
        style: {
          "line-color": "#34d399",
          "target-arrow-shape": "triangle",
          "target-arrow-color": "#34d399",
          "arrow-scale": 0.6,
          "opacity": 0.7
        }
      },
      {
        selector: "edge:selected",
        style: {
          "opacity": 1,
          "width": 3,
          "line-color": "#60a5fa"
        }
      },
      {
        selector: "node.hover",
        style: {
          "label": "data(label)",
          "font-size": "10px",
          "color": "#eaeaea",
          "text-valign": "bottom",
          "text-margin-y": 6,
          "text-background-color": "#16213e",
          "text-background-opacity": 0.9,
          "text-background-padding": "3px"
        }
      }
    ],
    layout: { name: "preset" },
    wheelSensitivity: 0.2,
    minZoom: 0.3,
    maxZoom: 4
  });

  // Node click handler
  cy.on("tap", "node", (e) => {
    const nodeData = e.target.data();
    const tab = graphData.tabs.find(t => t.id === nodeData.id);
    if (tab) {
      showDetails(tab);
    }
  });

  // Hover to show labels
  cy.on("mouseover", "node", (e) => {
    e.target.addClass("hover");
  });

  cy.on("mouseout", "node", (e) => {
    e.target.removeClass("hover");
  });

  // Background click to deselect
  cy.on("tap", (e) => {
    if (e.target === cy) {
      hideDetails();
    }
  });
}

/**
 * Zoom the graph by a factor.
 * @param {number} factor - Zoom multiplier (>1 to zoom in, <1 to zoom out)
 */
function zoomGraph(factor) {
  if (!cy) return;
  const currentZoom = cy.zoom();
  const newZoom = currentZoom * factor;
  cy.animate({
    zoom: {
      level: newZoom,
      position: { x: cy.width() / 2, y: cy.height() / 2 }
    },
    duration: 150
  });
}

/**
 * Fit the graph to the viewport.
 */
function fitGraph() {
  if (!cy) return;
  cy.animate({
    fit: { padding: 30 },
    duration: 200
  });
}

// Color palette for groups
const GROUP_COLORS = [
  "#8b5cf6", // Purple
  "#06b6d4", // Cyan
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#ef4444", // Red
  "#ec4899", // Pink
  "#6366f1", // Indigo
  "#84cc16", // Lime
  "#f97316", // Orange
  "#14b8a6", // Teal
];

function getGroupColor(groupId) {
  if (!groupId) return "#6b7280"; // Gray for ungrouped
  const index = parseInt(groupId.replace(/\D/g, "")) || 0;
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function renderGraph() {
  if (!cy) return;

  const filteredTabs = getFilteredTabs();

  // Build tab nodes
  const nodes = filteredTabs.map(tab => ({
    data: {
      id: tab.id,
      label: truncate(tab.title || tab.domain || "Untitled", 30),
      color: getGroupColor(tab.groupId),
      size: 20
    }
  }));

  // Build edges between tabs
  const tabIds = new Set(filteredTabs.map(t => t.id));
  const edges = graphData.edges
    .filter(e => tabIds.has(e.source) && tabIds.has(e.target))
    .map(edge => ({
      data: {
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        reason: edge.reason,
        width: edge.reason === "navigation" ? 2 : 1
      }
    }));

  // Update graph
  cy.elements().remove();
  cy.add([...nodes, ...edges]);

  // Apply layout
  cy.layout({
    name: "cose",
    animate: false,
    randomize: true,
    nodeRepulsion: function (node) { return 6000; },
    idealEdgeLength: function (edge) { return 120; },
    edgeElasticity: function (edge) { return 100; },
    nestingFactor: 1.2,
    gravity: 0.4,
    numIter: 200,
    initialTemp: 300,
    coolingFactor: 0.95,
    minTemp: 1.0,
    nodeDimensionsIncludeLabels: true,
    padding: 40
  }).run();

  cy.fit(undefined, 40);
}

function getFilteredTabs() {
  if (!searchQuery) {
    return graphData.tabs.filter(t => !t.duplicateOf);
  }

  const query = searchQuery.toLowerCase();
  const keywordMatch = query.match(/#(\w+)/);
  const domainMatch = query.match(/@(\w+)/);
  const fuzzyQuery = query.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();

  return graphData.tabs.filter(tab => {
    if (tab.duplicateOf) return false;

    // Domain filter
    if (domainMatch) {
      const domainQuery = domainMatch[1];
      if (!tab.domain || !tab.domain.includes(domainQuery)) {
        return false;
      }
    }

    // Keyword filter
    if (keywordMatch) {
      const keyword = keywordMatch[1];
      if (!tab.keywords || !tab.keywords.some(k => k.includes(keyword))) {
        return false;
      }
    }

    // Fuzzy filter
    if (fuzzyQuery) {
      const matchesTitle = tab.title && tab.title.toLowerCase().includes(fuzzyQuery);
      const matchesUrl = tab.url && tab.url.toLowerCase().includes(fuzzyQuery);
      if (!matchesTitle && !matchesUrl) {
        return false;
      }
    }

    return true;
  });
}

// ============ SEARCH ============

function applySearch() {
  const isGraphView = elements.graphView.classList.contains("active");
  if (isGraphView) {
    renderGraph();
  } else {
    renderGroups();
  }
}

// ============ DETAILS PANEL ============

function showDetails(tab) {
  selectedTab = tab;

  elements.detailsTitle.textContent = tab.title || tab.url;
  elements.detailsUrl.textContent = tab.url;
  elements.detailsUrl.href = tab.url;
  elements.detailsDomain.textContent = tab.domain;

  // Keywords
  elements.detailsKeywords.innerHTML = (tab.keywords || [])
    .map(k => `<span class="keyword-tag">${escapeHtml(k)}</span>`)
    .join("");

  // Group
  const group = graphData.groups.find(g => g.id === tab.groupId);
  elements.detailsGroup.textContent = group ? group.label : "Ungrouped";

  // Related tabs
  renderRelatedTabs(tab);

  elements.detailsPanel.classList.remove("hidden");

  // Highlight in graph if visible
  if (cy && elements.graphView.classList.contains("active")) {
    cy.$("node").unselect();
    const node = cy.$(`#${CSS.escape(tab.id)}`);
    if (node.length) {
      node.select();
      cy.animate({
        center: { eles: node },
        duration: 300
      });
    }
  }
}

function hideDetails() {
  selectedTab = null;
  elements.detailsPanel.classList.add("hidden");
  if (cy) {
    cy.$("node").unselect();
  }
}

function openSelectedTab() {
  if (selectedTab && selectedTab.url) {
    chrome.tabs.create({ url: selectedTab.url });
  }
}

// ============ ACTIONS ============

async function refreshGraph() {
  elements.btnRefresh.disabled = true;
  elements.btnRefresh.innerHTML = '<div class="spinner"></div>';

  // Show loading state in groups view
  if (elements.groupsView.classList.contains("active")) {
    elements.groupsList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: "REBUILD_GRAPH" });
    if (result.success) {
      await loadGraphData();
      renderGroups();
      if (elements.graphView.classList.contains("active")) {
        renderGraph();
      }
      updateStats();
    }
  } catch (e) {
    console.error("Failed to refresh graph:", e);
  } finally {
    elements.btnRefresh.disabled = false;
    elements.btnRefresh.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6M1 20v-6h6"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    `;
  }
}

async function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    const result = await chrome.runtime.sendMessage({
      type: "IMPORT_GRAPH",
      data
    });

    if (result.success) {
      await loadGraphData();
      renderGroups();
      if (elements.graphView.classList.contains("active")) {
        renderGraph();
      }
      updateStats();
      alert(`Imported ${result.imported.tabs} tabs, ${result.imported.groups} groups`);
    } else {
      alert("Import failed: " + result.error);
    }
  } catch (e) {
    console.error("Import failed:", e);
    alert("Import failed: Invalid JSON file");
  }

  // Reset file input
  elements.fileInput.value = "";
}

async function exportGraph() {
  try {
    const data = await chrome.runtime.sendMessage({ type: "EXPORT_GRAPH" });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `weft_graph_${new Date().toISOString().split("T")[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Export failed:", e);
    alert("Export failed");
  }
}

// ============ HELPERS ============

function updateStats() {
  const tabs = graphData.tabs.filter(t => !t.duplicateOf);
  const domains = new Set(tabs.map(t => t.domain)).size;
  elements.statsTabs.textContent = `${tabs.length} tabs`;
  elements.statsGroups.textContent = `${domains} domains`;
  elements.statsEdges.textContent = `${graphData.groups.length} groups`;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, maxLength) {
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}

function getFaviconUrl(url) {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return "";
  }
}

// ============ SEARCH HISTORY ============

function loadSearchHistory() {
  try {
    const stored = localStorage.getItem("weft_search_history");
    if (stored) {
      searchHistory = JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load search history:", e);
    searchHistory = [];
  }
}

function saveSearchHistory() {
  try {
    localStorage.setItem("weft_search_history", JSON.stringify(searchHistory));
  } catch (e) {
    console.error("Failed to save search history:", e);
  }
}

function addToSearchHistory(query) {
  // Remove if already exists (to move to front)
  searchHistory = searchHistory.filter(q => q !== query);
  // Add to front
  searchHistory.unshift(query);
  // Limit size
  if (searchHistory.length > MAX_SEARCH_HISTORY) {
    searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY);
  }
  saveSearchHistory();
}

function clearSearchHistory() {
  searchHistory = [];
  saveSearchHistory();
  elements.searchHistory.classList.add("hidden");
}

// Expose to global for onclick handler
window.clearSearchHistory = clearSearchHistory;

function renderSearchHistory() {
  if (!searchHistory.length) {
    elements.searchHistory.classList.add("hidden");
    return;
  }

  elements.searchHistory.innerHTML = `
    <div class="search-history-header">
      <span>Recent searches</span>
      <button class="search-history-clear" onclick="clearSearchHistory()">Clear</button>
    </div>
    <div class="search-history-items">
      ${searchHistory.map(q => `
        <span class="search-history-item" data-query="${escapeHtml(q)}">${escapeHtml(q)}</span>
      `).join("")}
    </div>
  `;

  // Add click handlers
  elements.searchHistory.querySelectorAll(".search-history-item").forEach(item => {
    item.addEventListener("click", () => {
      const query = item.dataset.query;
      elements.searchInput.value = query;
      searchQuery = query;
      applySearch();
      elements.searchHistory.classList.add("hidden");
    });
  });
}

// ============ RELATED TABS ============

function getRelatedTabs(tabId) {
  const related = [];
  const seen = new Set();

  for (const edge of graphData.edges) {
    let connectedId = null;
    let reason = edge.reason || "similarity";

    if (edge.source === tabId) {
      connectedId = edge.target;
    } else if (edge.target === tabId) {
      connectedId = edge.source;
    }

    if (connectedId && !seen.has(connectedId)) {
      seen.add(connectedId);
      const tab = graphData.tabs.find(t => t.id === connectedId);
      if (tab) {
        related.push({
          tab,
          weight: edge.weight || 0,
          reason
        });
      }
    }
  }

  // Sort by weight (strongest connections first)
  related.sort((a, b) => b.weight - a.weight);
  return related.slice(0, 5); // Top 5 related
}

function renderRelatedTabs(tab) {
  const related = getRelatedTabs(tab.id);

  if (!related.length) {
    elements.detailsRelated.innerHTML = '<span class="no-related-tabs">No connected tabs</span>';
    return;
  }

  elements.detailsRelated.innerHTML = related.map(({ tab: relatedTab, reason, weight }) => `
    <div class="related-tab-item" data-tab-id="${relatedTab.id}">
      <img class="related-tab-favicon" src="${getFaviconUrl(relatedTab.url)}" alt="" onerror="this.style.display='none'">
      <div class="related-tab-info">
        <div class="related-tab-title">${escapeHtml(relatedTab.title || relatedTab.url)}</div>
        <div class="related-tab-reason ${reason}">
          ${reason === "navigation" ? "→ Navigated" : `~ ${Math.round(weight * 100)}% similar`}
        </div>
      </div>
    </div>
  `).join("");

  // Add click handlers
  elements.detailsRelated.querySelectorAll(".related-tab-item").forEach(item => {
    item.addEventListener("click", () => {
      const relatedTabId = item.dataset.tabId;
      const relatedTab = graphData.tabs.find(t => t.id === relatedTabId);
      if (relatedTab) {
        showDetails(relatedTab);
      }
    });
  });
}

// ============ SESSION TIMELINE ============

function renderSessionTimeline() {
  if (!graphData.tabs.length) {
    elements.timelineChart.innerHTML = '<div class="timeline-empty">No activity data yet</div>';
    return;
  }

  // Group tabs by time buckets (using addedAt or lastAccessed if available)
  // Since we may not have timestamps, we'll use domain distribution as a proxy
  // Or group count distribution

  // Build activity data from groups (clusters)
  const activityData = [];

  // If tabs have timestamps, use them
  const tabsWithTime = graphData.tabs.filter(t => t.addedAt || t.lastAccessed);

  if (tabsWithTime.length > 0) {
    // Group by hour
    const hourBuckets = {};
    for (const tab of tabsWithTime) {
      const time = tab.addedAt || tab.lastAccessed;
      const date = new Date(time);
      const hourKey = `${date.getHours()}:00`;
      hourBuckets[hourKey] = (hourBuckets[hourKey] || 0) + 1;
    }

    // Create 24-hour timeline
    for (let h = 0; h < 24; h++) {
      const key = `${h}:00`;
      activityData.push({
        label: key,
        count: hourBuckets[key] || 0
      });
    }
  } else {
    // Fallback: show group distribution as activity proxy
    const sortedGroups = [...graphData.groups].sort((a, b) =>
      (b.size || b.tabIds?.length || 0) - (a.size || a.tabIds?.length || 0)
    );

    // Take top groups as "activity buckets"
    const topGroups = sortedGroups.slice(0, 12);
    for (const group of topGroups) {
      activityData.push({
        label: truncate(group.label, 15),
        count: group.size || group.tabIds?.length || 0,
        groupId: group.id
      });
    }
  }

  if (!activityData.length) {
    elements.timelineChart.innerHTML = '<div class="timeline-empty">No activity data</div>';
    return;
  }

  const maxCount = Math.max(...activityData.map(d => d.count), 1);

  elements.timelineChart.innerHTML = `
    <div class="timeline-chart" style="display: flex; align-items: flex-end; gap: 2px; height: 40px;">
      ${activityData.map(d => {
        const height = Math.max(4, (d.count / maxCount) * 100);
        return `
          <div class="timeline-bar" style="height: ${height}%;" data-group-id="${d.groupId || ''}">
            <div class="timeline-bar-tooltip">${escapeHtml(d.label)}: ${d.count} tabs</div>
          </div>
        `;
      }).join("")}
    </div>
    <div class="timeline-labels">
      <span>${escapeHtml(activityData[0]?.label || '')}</span>
      <span>${escapeHtml(activityData[activityData.length - 1]?.label || '')}</span>
    </div>
  `;

  // Add click handlers for group-based timeline
  elements.timelineChart.querySelectorAll(".timeline-bar[data-group-id]").forEach(bar => {
    const groupId = bar.dataset.groupId;
    if (groupId) {
      bar.addEventListener("click", () => {
        // Filter to show this group
        const group = graphData.groups.find(g => g.id === groupId);
        if (group) {
          elements.searchInput.value = group.label;
          searchQuery = group.label;
          applySearch();
          switchView("groups");
        }
      });
    }
  });
}

// ============ START ============

document.addEventListener("DOMContentLoaded", init);
