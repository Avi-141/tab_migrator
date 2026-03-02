/**
 * Weft Sidepanel Application
 * Main UI logic for the extension sidepanel.
 */

// State
let graphData = { tabs: [], edges: [], groups: [] };
let cy = null;
let selectedTab = null;
let searchQuery = "";
let cachedInsights = null;
let searchHistory = [];
let serverOnline = false;
let settings = { serverUrl: "http://localhost:8000", autoRebuild: true, staleHours: 24 };
let focusedGroupIndex = -1;
let focusedTabIndex = -1;
const MAX_SEARCH_HISTORY = 8;
const STALE_MS_DEFAULT = 24 * 60 * 60 * 1000;

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
  btnSettings: document.getElementById("btn-settings"),
  fileInput: document.getElementById("file-input"),
  statsTabs: document.getElementById("stats-tabs"),
  statsGroups: document.getElementById("stats-groups"),
  statsEdges: document.getElementById("stats-edges"),
  cyContainer: document.getElementById("cy"),
  searchHistory: document.getElementById("search-history"),
  detailsRelated: document.getElementById("details-related"),
  sessionTimeline: document.getElementById("session-timeline"),
  timelineChart: document.getElementById("timeline-chart"),
  connectionStatus: document.getElementById("connection-status"),
  settingsView: document.getElementById("settings-view"),
  settingServerUrl: document.getElementById("setting-server-url"),
  settingAutoRebuild: document.getElementById("setting-auto-rebuild"),
  settingStaleHours: document.getElementById("setting-stale-hours"),
  btnSaveSettings: document.getElementById("btn-save-settings"),
  btnClearData: document.getElementById("btn-clear-data"),
  toastContainer: document.getElementById("toast-container")
};

// ============ TOAST NOTIFICATIONS ============

function showToast(message, type = "info", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("exiting");
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ============ INITIALIZATION ============

async function init() {
  await loadSettings();
  await loadGraphData();
  loadSearchHistory();
  setupEventListeners();
  initCytoscape();
  checkServerStatus();

  const hasOnboarded = localStorage.getItem("weft_onboarded");
  if (!hasOnboarded && graphData.tabs.length === 0) {
    renderOnboarding();
  } else {
    if (graphData.tabs.length > 0 && (graphData.edges.length === 0 || graphData.groups.length === 0)) {
      await refreshGraph();
    }
    renderGroups();
  }
  updateStats();

  setInterval(checkServerStatus, 30000);
}

async function loadSettings() {
  try {
    const stored = localStorage.getItem("weft_settings");
    if (stored) {
      settings = { ...settings, ...JSON.parse(stored) };
    }
  } catch (e) { /* use defaults */ }

  elements.settingServerUrl.value = settings.serverUrl;
  elements.settingAutoRebuild.checked = settings.autoRebuild;
  elements.settingStaleHours.value = settings.staleHours;
}

function saveSettings() {
  settings.serverUrl = elements.settingServerUrl.value.replace(/\/+$/, "") || "http://localhost:8000";
  settings.autoRebuild = elements.settingAutoRebuild.checked;
  settings.staleHours = parseInt(elements.settingStaleHours.value) || 24;
  localStorage.setItem("weft_settings", JSON.stringify(settings));
  chrome.storage.local.set({ weft_auto_rebuild: settings.autoRebuild });
  showToast("Settings saved", "success");
  checkServerStatus();
}

async function loadGraphData() {
  try {
    graphData = await chrome.runtime.sendMessage({ type: "GET_GRAPH_DATA" });
  } catch (e) {
    graphData = { tabs: [], edges: [], groups: [] };
  }
}

async function checkServerStatus() {
  try {
    const resp = await fetch(`${settings.serverUrl}/health`, { signal: AbortSignal.timeout(3000) });
    serverOnline = resp.ok;
  } catch (e) {
    serverOnline = false;
  }
  elements.connectionStatus.className = `connection-dot ${serverOnline ? "online" : "offline"}`;
  elements.connectionStatus.title = serverOnline ? `Server: connected (${settings.serverUrl})` : "Server: offline";
}

// ============ EVENT LISTENERS ============

function setupEventListeners() {
  elements.viewGroups.addEventListener("click", () => switchView("groups"));
  elements.viewGraph.addEventListener("click", () => switchView("graph"));
  elements.viewInsights.addEventListener("click", () => switchView("insights"));
  elements.btnFetchInsights.addEventListener("click", fetchInsights);
  elements.btnSettings.addEventListener("click", () => switchView("settings"));

  elements.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    applySearch();
  });

  elements.searchInput.addEventListener("focus", () => {
    if (searchHistory.length > 0) {
      renderSearchHistory();
      elements.searchHistory.classList.remove("hidden");
    }
  });

  elements.searchInput.addEventListener("blur", () => {
    setTimeout(() => { elements.searchHistory.classList.add("hidden"); }, 200);
  });

  elements.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      addToSearchHistory(searchQuery.trim());
      elements.searchHistory.classList.add("hidden");
    }
  });

  elements.detailsClose.addEventListener("click", hideDetails);
  elements.btnOpenTab.addEventListener("click", openSelectedTab);

  elements.btnRefresh.addEventListener("click", refreshGraph);
  elements.btnImport.addEventListener("click", () => elements.fileInput.click());
  elements.btnExport.addEventListener("click", exportGraph);
  elements.fileInput.addEventListener("change", handleFileImport);

  elements.btnZoomIn = document.getElementById("btn-zoom-in");
  elements.btnZoomOut = document.getElementById("btn-zoom-out");
  elements.btnFit = document.getElementById("btn-fit");
  elements.btnZoomIn.addEventListener("click", () => zoomGraph(1.3));
  elements.btnZoomOut.addEventListener("click", () => zoomGraph(0.7));
  elements.btnFit.addEventListener("click", fitGraph);

  elements.btnSaveSettings.addEventListener("click", saveSettings);
  elements.btnClearData.addEventListener("click", async () => {
    if (confirm("Clear all Weft data? This cannot be undone.")) {
      await chrome.runtime.sendMessage({ type: "CLEAR_ALL" });
      await loadGraphData();
      renderGroups();
      updateStats();
      showToast("All data cleared", "info");
    }
  });

  document.addEventListener("keydown", handleKeydown);
}

function handleKeydown(e) {
  const inInput = document.activeElement === elements.searchInput ||
                  document.activeElement.tagName === "INPUT";

  if (e.key === "Escape") {
    if (!elements.detailsPanel.classList.contains("hidden")) {
      hideDetails();
    } else if (elements.settingsView.classList.contains("active")) {
      switchView("groups");
    } else if (inInput) {
      elements.searchInput.blur();
    }
    return;
  }

  if (inInput) return;

  switch (e.key) {
    case "/":
      e.preventDefault();
      elements.searchInput.focus();
      break;
    case "g":
      e.preventDefault();
      switchView("groups");
      break;
    case "v":
      e.preventDefault();
      switchView("graph");
      break;
    case "i":
      e.preventDefault();
      switchView("insights");
      break;
    case "r":
      e.preventDefault();
      refreshGraph();
      break;
    case "j":
      e.preventDefault();
      navigateGroups(1);
      break;
    case "k":
      e.preventDefault();
      navigateGroups(-1);
      break;
    case "Enter":
      e.preventDefault();
      toggleFocusedGroup();
      break;
    case "o":
      e.preventDefault();
      openFocusedTab();
      break;
  }
}

// ============ KEYBOARD NAVIGATION ============

function navigateGroups(direction) {
  if (!elements.groupsView.classList.contains("active")) return;

  const cards = document.querySelectorAll(".group-card");
  if (!cards.length) return;

  document.querySelectorAll(".group-card.focused").forEach(c => c.classList.remove("focused"));
  document.querySelectorAll(".tab-item.focused").forEach(t => t.classList.remove("focused"));

  const expandedCard = cards[focusedGroupIndex];
  if (expandedCard && expandedCard.classList.contains("expanded")) {
    const tabItems = expandedCard.querySelectorAll(".tab-item");
    if (tabItems.length > 0) {
      const newTabIndex = focusedTabIndex + direction;
      if (newTabIndex >= 0 && newTabIndex < tabItems.length) {
        focusedTabIndex = newTabIndex;
        tabItems[focusedTabIndex].classList.add("focused");
        tabItems[focusedTabIndex].scrollIntoView({ block: "nearest" });
        cards[focusedGroupIndex].classList.add("focused");
        return;
      }
      if (newTabIndex < 0) {
        focusedTabIndex = -1;
        cards[focusedGroupIndex].classList.add("focused");
        cards[focusedGroupIndex].scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }

  focusedTabIndex = -1;
  focusedGroupIndex = Math.max(0, Math.min(cards.length - 1, focusedGroupIndex + direction));
  cards[focusedGroupIndex].classList.add("focused");
  cards[focusedGroupIndex].scrollIntoView({ block: "nearest" });
}

function toggleFocusedGroup() {
  const cards = document.querySelectorAll(".group-card");
  if (focusedGroupIndex < 0 || focusedGroupIndex >= cards.length) return;
  const card = cards[focusedGroupIndex];

  if (focusedTabIndex >= 0) {
    const tabItems = card.querySelectorAll(".tab-item");
    if (tabItems[focusedTabIndex]) {
      const tabId = tabItems[focusedTabIndex].dataset.tabId;
      const tab = graphData.tabs.find(t => t.id === tabId);
      if (tab) switchToOrOpenTab(tab);
    }
    return;
  }

  card.classList.toggle("expanded");
  if (card.classList.contains("expanded")) {
    focusedTabIndex = -1;
  }
}

function openFocusedTab() {
  const cards = document.querySelectorAll(".group-card");
  if (focusedGroupIndex < 0 || focusedGroupIndex >= cards.length) return;
  const card = cards[focusedGroupIndex];

  if (focusedTabIndex >= 0) {
    const tabItems = card.querySelectorAll(".tab-item");
    if (tabItems[focusedTabIndex]) {
      const tabId = tabItems[focusedTabIndex].dataset.tabId;
      const tab = graphData.tabs.find(t => t.id === tabId);
      if (tab) switchToOrOpenTab(tab);
    }
  }
}

// ============ VIEW MANAGEMENT ============

function switchView(view) {
  const views = ["groupsView", "graphView", "insightsView", "settingsView"];
  const buttons = ["viewGroups", "viewGraph", "viewInsights"];

  views.forEach(v => elements[v].classList.remove("active"));
  buttons.forEach(b => elements[b].classList.remove("active"));

  if (view === "groups") {
    elements.groupsView.classList.add("active");
    elements.viewGroups.classList.add("active");
  } else if (view === "graph") {
    elements.graphView.classList.add("active");
    elements.viewGraph.classList.add("active");
    renderGraph();
  } else if (view === "insights") {
    elements.insightsView.classList.add("active");
    elements.viewInsights.classList.add("active");
    renderSessionTimeline();
    fetchInsights();
  } else if (view === "settings") {
    elements.settingsView.classList.add("active");
  }
}

// ============ ONBOARDING ============

function renderOnboarding() {
  elements.groupsList.innerHTML = `
    <div class="onboarding">
      <svg class="onboarding-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <h2>Welcome to Weft</h2>
      <p>Your browsing, organized into a knowledge graph. Weft clusters your tabs by topic and maps how they connect.</p>
      <button class="btn btn-primary" id="btn-onboard-scan">Scan My Tabs</button>
      <div class="onboarding-features">
        <div class="onboarding-feature">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <span>Auto-clusters tabs by topic</span>
        </div>
        <div class="onboarding-feature">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m-10-10h4m12 0h4"/></svg>
          <span>Visual knowledge graph</span>
        </div>
        <div class="onboarding-feature">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>100% local and private</span>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-onboard-scan").addEventListener("click", async () => {
    localStorage.setItem("weft_onboarded", "1");
    await refreshGraph();
  });
}

// ============ INSIGHTS ============

async function fetchInsights() {
  const content = elements.insightsContent;

  if (cachedInsights) {
    const age = Math.round((Date.now() - cachedInsights.timestamp) / 60000);
    content.innerHTML = `<div class="stale-notice">Last updated ${age} min ago</div>` + cachedInsights.html;
  } else {
    content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const syncPayload = {
      tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active }))
    };

    const syncResponse = await fetch(`${settings.serverUrl}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syncPayload),
      signal: AbortSignal.timeout(8000)
    });

    if (!syncResponse.ok) throw new Error("Sync failed");
    const syncResult = await syncResponse.json();
    const html = renderMarkdown(syncResult.insights);
    cachedInsights = { html, timestamp: Date.now() };
    content.innerHTML = html;
  } catch (e) {
    const offlineInsights = generateOfflineInsights();
    if (offlineInsights) {
      const html = renderMarkdown(offlineInsights);
      cachedInsights = { html, timestamp: Date.now() };
      content.innerHTML = `<div class="stale-notice">Offline mode &mdash; run <code>weft serve</code> for richer insights</div>` + html;
    } else {
      content.innerHTML = `
        <div class="placeholder-text">
          <p>No browsing data yet.</p>
          <p class="small-text">Browse some tabs to build your knowledge graph.</p>
        </div>`;
    }
  }
}

function renderMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  let listType = "ul";

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
    } else if (line.startsWith("## ")) {
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith("### ")) {
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
    } else if (line.startsWith("- ")) {
      if (inList && listType !== "ul") { html += `</${listType}>`; inList = false; }
      if (!inList) { html += "<ul>"; inList = true; listType = "ul"; }
      html += `<li>${formatInline(line.slice(2))}</li>`;
    } else if (line.match(/^\d+\.\s/)) {
      if (inList && listType !== "ol") { html += `</${listType}>`; inList = false; }
      if (!inList) { html += "<ol>"; inList = true; listType = "ol"; }
      html += `<li>${formatInline(line.replace(/^\d+\.\s/, ""))}</li>`;
    } else {
      if (inList) { html += `</${listType}>`; inList = false; }
      if (line.trim()) html += `<p>${formatInline(line)}</p>`;
    }
  }
  if (inList) html += `</${listType}>`;
  return html;
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function generateOfflineInsights() {
  if (!graphData.tabs.length) return null;

  const activeTabs = graphData.tabs.filter(t => !t.duplicateOf);
  const tabCount = activeTabs.length;
  const groupCount = graphData.groups.length;
  const openCount = activeTabs.filter(t => t.chromeTabId).length;
  const staleThreshold = Date.now() - (settings.staleHours * 60 * 60 * 1000);
  const staleCount = activeTabs.filter(t => {
    const lastUsed = t.lastAccessed || t.createdAt;
    return lastUsed && lastUsed < staleThreshold && t.chromeTabId;
  }).length;

  const sortedGroups = [...graphData.groups].sort((a, b) =>
    (b.size || b.tabIds?.length || 0) - (a.size || a.tabIds?.length || 0));
  const topGroups = sortedGroups.slice(0, 5);

  const keywordCounts = {};
  for (const tab of graphData.tabs) {
    for (const kw of (tab.keywords || [])) {
      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);

  const domainCounts = {};
  for (const tab of graphData.tabs) {
    if (tab.domain) domainCounts[tab.domain] = (domainCounts[tab.domain] || 0) + 1;
  }
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d);

  const lines = [
    "# Browsing Memory Report",
    `**${tabCount} tabs** tracked | **${openCount} open** | **${groupCount} clusters**` +
      (staleCount > 0 ? ` | **${staleCount} stale**` : ""),
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

  lines.push("", "## Key Themes");
  if (topKeywords.length) {
    lines.push(topKeywords.map(k => `\`${k}\``).join(", "));
  } else {
    lines.push("_Not enough data for themes._");
  }

  lines.push("", "## Top Sources");
  for (const d of topDomains) lines.push(`- ${d}`);

  return lines.join("\n");
}

// ============ GROUPS VIEW ============

function renderGroups() {
  const groups = getFilteredGroups();
  focusedGroupIndex = -1;
  focusedTabIndex = -1;

  if (groups.length === 0) {
    const hasOnboarded = localStorage.getItem("weft_onboarded");
    if (!hasOnboarded && graphData.tabs.length === 0) {
      renderOnboarding();
    } else {
      elements.groupsList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12h8M12 8v8"/>
          </svg>
          <h3>${searchQuery ? "No matches" : "No groups yet"}</h3>
          <p>${searchQuery ? "Try a different search term" : "Browse some pages to start building your knowledge graph"}</p>
        </div>`;
    }
    return;
  }

  const staleThreshold = Date.now() - (settings.staleHours * 60 * 60 * 1000);

  elements.groupsList.innerHTML = groups.map(group => {
    const tabs = getTabsForGroup(group.id);
    const openCount = tabs.filter(t => t.chromeTabId).length;

    return `
      <div class="group-card" data-group-id="${group.id}">
        <div class="group-header">
          <svg class="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="group-label">${escapeHtml(group.label)}</span>
          <div class="group-meta">
            ${openCount > 0 ? `<span class="group-size" style="background:#065f46;color:#a7f3d0">${openCount} open</span>` : ""}
            <span class="group-size">${tabs.length}</span>
          </div>
        </div>
        <div class="group-actions">
          <button class="btn btn-ghost group-action-open" data-group-id="${group.id}" title="Open all tabs">Open All</button>
          <button class="btn btn-ghost group-action-close" data-group-id="${group.id}" title="Close open tabs">Close</button>
          <button class="btn btn-ghost group-action-copy" data-group-id="${group.id}" title="Copy all links">Copy Links</button>
        </div>
        <div class="group-tabs">
          ${tabs.map(tab => {
            const isOpen = !!tab.chromeTabId;
            const lastUsed = tab.lastAccessed || tab.createdAt;
            const isStale = isOpen && lastUsed && lastUsed < staleThreshold;
            const dotClass = isOpen ? (isStale ? "stale" : "") : "closed";
            const staleLabel = isStale ? formatTimeAgo(lastUsed) : "";

            return `
            <div class="tab-item" data-tab-id="${tab.id}" data-chrome-id="${tab.chromeTabId || ""}">
              <span class="tab-live-dot ${dotClass}" title="${isOpen ? (isStale ? "Stale" : "Open") : "Closed"}"></span>
              <img class="tab-favicon" src="${getFaviconUrl(tab.url)}" alt="" onerror="this.style.display='none'">
              <div class="tab-info">
                <div class="tab-title">${escapeHtml(tab.title || tab.url)}</div>
                <div class="tab-domain">${escapeHtml(tab.domain)}</div>
              </div>
              ${isStale ? `<span class="tab-stale-badge">${staleLabel}</span>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");

  // Group header click -> expand/collapse
  document.querySelectorAll(".group-card .group-header").forEach(header => {
    header.addEventListener("click", () => {
      header.closest(".group-card").classList.toggle("expanded");
    });
  });

  // Tab click -> switch to that tab or show details
  document.querySelectorAll(".tab-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = item.dataset.tabId;
      const tab = graphData.tabs.find(t => t.id === tabId);
      if (tab) switchToOrOpenTab(tab);
    });
  });

  // Group actions
  document.querySelectorAll(".group-action-open").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openGroupTabs(btn.dataset.groupId);
    });
  });

  document.querySelectorAll(".group-action-close").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeGroupTabs(btn.dataset.groupId);
    });
  });

  document.querySelectorAll(".group-action-copy").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyGroupLinks(btn.dataset.groupId);
    });
  });
}

// ============ GROUP ACTIONS ============

async function switchToOrOpenTab(tab) {
  if (tab.chromeTabId) {
    try {
      await chrome.tabs.update(tab.chromeTabId, { active: true });
      const t = await chrome.tabs.get(tab.chromeTabId);
      if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
      return;
    } catch (e) {
      // Tab no longer exists, fall through to open
    }
  }
  chrome.tabs.create({ url: tab.url });
}

async function openGroupTabs(groupId) {
  const tabs = getTabsForGroup(groupId);
  if (tabs.length > 8) {
    if (!confirm(`Open ${tabs.length} tabs?`)) return;
  }
  for (const tab of tabs) {
    if (!tab.chromeTabId) {
      chrome.tabs.create({ url: tab.url, active: false });
    }
  }
  showToast(`Opened ${tabs.filter(t => !t.chromeTabId).length} tabs`, "success");
}

async function closeGroupTabs(groupId) {
  const tabs = getTabsForGroup(groupId);
  const openTabs = tabs.filter(t => t.chromeTabId);
  if (openTabs.length === 0) {
    showToast("No open tabs in this group", "info");
    return;
  }
  if (openTabs.length > 3) {
    if (!confirm(`Close ${openTabs.length} tabs?`)) return;
  }
  const ids = openTabs.map(t => t.chromeTabId).filter(Boolean);
  try {
    await chrome.tabs.remove(ids);
    showToast(`Closed ${ids.length} tabs`, "success");
    setTimeout(async () => {
      await loadGraphData();
      renderGroups();
      updateStats();
    }, 500);
  } catch (e) {
    showToast("Failed to close some tabs", "error");
  }
}

async function copyGroupLinks(groupId) {
  const tabs = getTabsForGroup(groupId);
  const links = tabs.map(t => t.url).join("\n");
  try {
    await navigator.clipboard.writeText(links);
    showToast(`Copied ${tabs.length} links`, "success");
  } catch (e) {
    showToast("Failed to copy links", "error");
  }
}

function getTabsForGroup(groupId) {
  const group = graphData.groups.find(g => g.id === groupId);
  if (!group) return [];
  const tabs = group.tabIds.map(id => graphData.tabs.find(t => t.id === id)).filter(Boolean);
  tabs.sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0));
  return tabs;
}

function getFilteredGroups() {
  const sortBySize = (a, b) => {
    const aSize = a.size || a.tabIds?.length || 0;
    const bSize = b.size || b.tabIds?.length || 0;
    return bSize - aSize;
  };

  if (!searchQuery) return [...graphData.groups].sort(sortBySize);

  const query = searchQuery.toLowerCase();
  const keywordMatch = query.match(/#(\w+)/);
  const domainMatch = query.match(/@(\w+)/);
  const fuzzyQuery = query.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();

  return graphData.groups.filter(group => {
    const tabs = getTabsForGroup(group.id);

    if (domainMatch) {
      if (!tabs.some(t => t.domain && t.domain.includes(domainMatch[1]))) return false;
    }
    if (keywordMatch) {
      if (!tabs.some(t => t.keywords && t.keywords.some(k => k.includes(keywordMatch[1])))) return false;
    }
    if (fuzzyQuery) {
      const matchesLabel = group.label.toLowerCase().includes(fuzzyQuery);
      const matchesTabs = tabs.some(t =>
        (t.title && t.title.toLowerCase().includes(fuzzyQuery)) ||
        (t.url && t.url.toLowerCase().includes(fuzzyQuery)));
      if (!matchesLabel && !matchesTabs) return false;
    }
    return true;
  }).sort(sortBySize);
}

// ============ GRAPH VIEW ============

function initCytoscape() {
  cy = cytoscape({
    container: elements.cyContainer,
    style: [
      { selector: "node", style: {
        "background-color": "data(color)", "label": "", "width": "data(size)",
        "height": "data(size)", "border-width": 2, "border-color": "data(color)", "border-opacity": 0.3
      }},
      { selector: "node:active, node:grabbed", style: {
        "label": "data(label)", "font-size": "11px", "color": "#eaeaea",
        "text-valign": "bottom", "text-margin-y": 8, "text-background-color": "#1a1a2e",
        "text-background-opacity": 0.85, "text-background-padding": "4px",
        "text-max-width": "120px", "text-wrap": "ellipsis", "z-index": 999
      }},
      { selector: "node:selected", style: {
        "label": "data(label)", "font-size": "11px", "color": "#ffffff",
        "text-valign": "bottom", "text-margin-y": 8, "text-background-color": "#e94560",
        "text-background-opacity": 0.95, "text-background-padding": "4px",
        "text-max-width": "150px", "text-wrap": "ellipsis", "border-width": 3,
        "border-color": "#ff6b6b", "border-opacity": 1, "width": 30, "height": 30, "z-index": 1000
      }},
      { selector: "edge", style: {
        "width": "data(width)", "line-color": "#4a5568", "curve-style": "bezier", "opacity": 0.4
      }},
      { selector: "edge[reason = 'navigation']", style: {
        "line-color": "#34d399", "target-arrow-shape": "triangle",
        "target-arrow-color": "#34d399", "arrow-scale": 0.6, "opacity": 0.7
      }},
      { selector: "edge:selected", style: { "opacity": 1, "width": 3, "line-color": "#60a5fa" }},
      { selector: "node.hover", style: {
        "label": "data(label)", "font-size": "10px", "color": "#eaeaea",
        "text-valign": "bottom", "text-margin-y": 6, "text-background-color": "#16213e",
        "text-background-opacity": 0.9, "text-background-padding": "3px"
      }}
    ],
    layout: { name: "preset" },
    wheelSensitivity: 0.2, minZoom: 0.3, maxZoom: 4
  });

  cy.on("tap", "node", (e) => {
    const tab = graphData.tabs.find(t => t.id === e.target.data().id);
    if (tab) showDetails(tab);
  });
  cy.on("mouseover", "node", (e) => e.target.addClass("hover"));
  cy.on("mouseout", "node", (e) => e.target.removeClass("hover"));
  cy.on("tap", (e) => { if (e.target === cy) hideDetails(); });
}

function zoomGraph(factor) {
  if (!cy) return;
  cy.animate({ zoom: { level: cy.zoom() * factor, position: { x: cy.width() / 2, y: cy.height() / 2 } }, duration: 150 });
}

function fitGraph() {
  if (!cy) return;
  cy.animate({ fit: { padding: 30 }, duration: 200 });
}

const GROUP_COLORS = [
  "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444",
  "#ec4899", "#6366f1", "#84cc16", "#f97316", "#14b8a6"
];

function getGroupColor(groupId) {
  if (!groupId) return "#6b7280";
  const index = parseInt(groupId.replace(/\D/g, "")) || 0;
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function renderGraph() {
  if (!cy) return;
  const filteredTabs = getFilteredTabs();

  const nodes = filteredTabs.map(tab => ({
    data: { id: tab.id, label: truncate(tab.title || tab.domain || "Untitled", 30), color: getGroupColor(tab.groupId), size: 20 }
  }));

  const tabIds = new Set(filteredTabs.map(t => t.id));
  const edges = graphData.edges
    .filter(e => tabIds.has(e.source) && tabIds.has(e.target))
    .map(edge => ({
      data: { id: `${edge.source}-${edge.target}`, source: edge.source, target: edge.target,
              weight: edge.weight, reason: edge.reason, width: edge.reason === "navigation" ? 2 : 1 }
    }));

  cy.elements().remove();
  cy.add([...nodes, ...edges]);

  cy.layout({
    name: "cose", animate: false, randomize: true,
    nodeRepulsion: () => 6000, idealEdgeLength: () => 120, edgeElasticity: () => 100,
    nestingFactor: 1.2, gravity: 0.4, numIter: 200, initialTemp: 300,
    coolingFactor: 0.95, minTemp: 1.0, nodeDimensionsIncludeLabels: true, padding: 40
  }).run();

  cy.fit(undefined, 40);
}

function getFilteredTabs() {
  if (!searchQuery) return graphData.tabs.filter(t => !t.duplicateOf);

  const query = searchQuery.toLowerCase();
  const keywordMatch = query.match(/#(\w+)/);
  const domainMatch = query.match(/@(\w+)/);
  const fuzzyQuery = query.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();

  return graphData.tabs.filter(tab => {
    if (tab.duplicateOf) return false;
    if (domainMatch && (!tab.domain || !tab.domain.includes(domainMatch[1]))) return false;
    if (keywordMatch && (!tab.keywords || !tab.keywords.some(k => k.includes(keywordMatch[1])))) return false;
    if (fuzzyQuery) {
      const m = (tab.title && tab.title.toLowerCase().includes(fuzzyQuery)) ||
                (tab.url && tab.url.toLowerCase().includes(fuzzyQuery));
      if (!m) return false;
    }
    return true;
  });
}

// ============ SEARCH ============

function applySearch() {
  if (elements.graphView.classList.contains("active")) renderGraph();
  else renderGroups();
}

// ============ DETAILS PANEL ============

function showDetails(tab) {
  selectedTab = tab;
  elements.detailsTitle.textContent = tab.title || tab.url;
  elements.detailsUrl.textContent = tab.url;
  elements.detailsUrl.href = tab.url;
  elements.detailsDomain.textContent = tab.domain;

  elements.detailsKeywords.innerHTML = (tab.keywords || [])
    .map(k => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join("");

  const group = graphData.groups.find(g => g.id === tab.groupId);
  elements.detailsGroup.textContent = group ? group.label : "Ungrouped";

  renderRelatedTabs(tab);
  elements.detailsPanel.classList.remove("hidden");

  if (cy && elements.graphView.classList.contains("active")) {
    cy.$("node").unselect();
    const node = cy.$(`#${CSS.escape(tab.id)}`);
    if (node.length) {
      node.select();
      cy.animate({ center: { eles: node }, duration: 300 });
    }
  }
}

function hideDetails() {
  selectedTab = null;
  elements.detailsPanel.classList.add("hidden");
  if (cy) cy.$("node").unselect();
}

function openSelectedTab() {
  if (selectedTab) switchToOrOpenTab(selectedTab);
}

// ============ ACTIONS ============

async function refreshGraph() {
  elements.btnRefresh.disabled = true;
  elements.btnRefresh.innerHTML = '<div class="spinner"></div>';

  if (elements.groupsView.classList.contains("active")) {
    elements.groupsList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: "REBUILD_GRAPH" });
    if (result.success) {
      await loadGraphData();
      renderGroups();
      if (elements.graphView.classList.contains("active")) renderGraph();
      updateStats();
      const mod = result.stats.modularity != null ? ` (Q=${result.stats.modularity})` : "";
      showToast(`Graph rebuilt: ${result.stats.groups} groups, ${result.stats.edges} edges${mod}`, "success");
    }
  } catch (e) {
    showToast("Failed to rebuild graph", "error");
  } finally {
    elements.btnRefresh.disabled = false;
    elements.btnRefresh.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6M1 20v-6h6"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>`;
  }
}

async function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await chrome.runtime.sendMessage({ type: "IMPORT_GRAPH", data });

    if (result.success) {
      await loadGraphData();
      renderGroups();
      if (elements.graphView.classList.contains("active")) renderGraph();
      updateStats();
      showToast(`Imported ${result.imported.tabs} tabs, ${result.imported.groups} groups`, "success");
    } else {
      showToast("Import failed: " + result.error, "error");
    }
  } catch (e) {
    showToast("Import failed: invalid JSON file", "error");
  }
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
    showToast("Graph exported", "success");
  } catch (e) {
    showToast("Export failed", "error");
  }
}

// ============ HELPERS ============

function updateStats() {
  const tabs = graphData.tabs.filter(t => !t.duplicateOf);
  elements.statsTabs.querySelector("span").textContent = `${tabs.length} tabs`;
  elements.statsGroups.querySelector("span").textContent = `${graphData.groups.length} groups`;
  elements.statsEdges.querySelector("span").textContent = `${graphData.edges.length} edges`;
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
  } catch { return ""; }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ============ SEARCH HISTORY ============

function loadSearchHistory() {
  try {
    const stored = localStorage.getItem("weft_search_history");
    if (stored) searchHistory = JSON.parse(stored);
  } catch (e) { searchHistory = []; }
}

function saveSearchHistory() {
  try { localStorage.setItem("weft_search_history", JSON.stringify(searchHistory)); } catch (e) { /* ignore */ }
}

function addToSearchHistory(query) {
  searchHistory = searchHistory.filter(q => q !== query);
  searchHistory.unshift(query);
  if (searchHistory.length > MAX_SEARCH_HISTORY) searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY);
  saveSearchHistory();
}

function clearSearchHistory() {
  searchHistory = [];
  saveSearchHistory();
  elements.searchHistory.classList.add("hidden");
}
window.clearSearchHistory = clearSearchHistory;

function renderSearchHistory() {
  if (!searchHistory.length) { elements.searchHistory.classList.add("hidden"); return; }

  elements.searchHistory.innerHTML = `
    <div class="search-history-header">
      <span>Recent searches</span>
      <button class="search-history-clear" onclick="clearSearchHistory()">Clear</button>
    </div>
    <div class="search-history-items">
      ${searchHistory.map(q => `<span class="search-history-item" data-query="${escapeHtml(q)}">${escapeHtml(q)}</span>`).join("")}
    </div>`;

  elements.searchHistory.querySelectorAll(".search-history-item").forEach(item => {
    item.addEventListener("click", () => {
      elements.searchInput.value = item.dataset.query;
      searchQuery = item.dataset.query;
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

    if (edge.source === tabId) connectedId = edge.target;
    else if (edge.target === tabId) connectedId = edge.source;

    if (connectedId && !seen.has(connectedId)) {
      seen.add(connectedId);
      const tab = graphData.tabs.find(t => t.id === connectedId);
      if (tab) related.push({ tab, weight: edge.weight || 0, reason });
    }
  }

  related.sort((a, b) => b.weight - a.weight);
  return related.slice(0, 5);
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
          ${reason === "navigation" ? "&#8594; Navigated" : `~ ${Math.round(weight * 100)}% similar`}
        </div>
      </div>
    </div>`).join("");

  elements.detailsRelated.querySelectorAll(".related-tab-item").forEach(item => {
    item.addEventListener("click", () => {
      const t = graphData.tabs.find(t => t.id === item.dataset.tabId);
      if (t) showDetails(t);
    });
  });
}

// ============ SESSION TIMELINE ============

function renderSessionTimeline() {
  if (!graphData.tabs.length) {
    elements.timelineChart.innerHTML = '<div class="timeline-empty">No activity data yet</div>';
    return;
  }

  const activityData = [];
  const tabsWithTime = graphData.tabs.filter(t => t.lastAccessed || t.createdAt);

  if (tabsWithTime.length > 0) {
    const hourBuckets = {};
    for (const tab of tabsWithTime) {
      const time = tab.lastAccessed || tab.createdAt;
      const hourKey = `${new Date(time).getHours()}:00`;
      hourBuckets[hourKey] = (hourBuckets[hourKey] || 0) + 1;
    }
    for (let h = 0; h < 24; h++) {
      const key = `${h}:00`;
      activityData.push({ label: key, count: hourBuckets[key] || 0 });
    }
  } else {
    const sortedGroups = [...graphData.groups].sort((a, b) =>
      (b.size || b.tabIds?.length || 0) - (a.size || a.tabIds?.length || 0));
    for (const group of sortedGroups.slice(0, 12)) {
      activityData.push({ label: truncate(group.label, 15), count: group.size || group.tabIds?.length || 0, groupId: group.id });
    }
  }

  if (!activityData.length) {
    elements.timelineChart.innerHTML = '<div class="timeline-empty">No activity data</div>';
    return;
  }

  const maxCount = Math.max(...activityData.map(d => d.count), 1);

  elements.timelineChart.innerHTML = `
    <div class="timeline-chart" style="display:flex;align-items:flex-end;gap:2px;height:40px;">
      ${activityData.map(d => {
        const height = Math.max(4, (d.count / maxCount) * 100);
        return `<div class="timeline-bar" style="height:${height}%;" data-group-id="${d.groupId || ''}">
          <div class="timeline-bar-tooltip">${escapeHtml(d.label)}: ${d.count} tabs</div>
        </div>`;
      }).join("")}
    </div>
    <div class="timeline-labels">
      <span>${escapeHtml(activityData[0]?.label || "")}</span>
      <span>${escapeHtml(activityData[activityData.length - 1]?.label || "")}</span>
    </div>`;

  elements.timelineChart.querySelectorAll(".timeline-bar[data-group-id]").forEach(bar => {
    const groupId = bar.dataset.groupId;
    if (groupId) {
      bar.addEventListener("click", () => {
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
