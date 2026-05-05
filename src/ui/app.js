import { invoke, readEventStream } from "./host.js";
import { cleanDisplayText, compactStatusText } from "./text-utils.js";

const LOCATION = typeof window != "undefined" ? new URL(window.location.href) : null;
const REQUESTED_ACTIVE_TAB = String(LOCATION?.searchParams?.get("active_tab") || "").trim();
const REQUESTED_TAB_ID = String(LOCATION?.searchParams?.get("tab_id") || "").trim();

const TAB_LOADERS = new Map([
  ["settings", () => import("./settings.js").then((module) => module.createSettingsTab)],
  ["automation", () => import("./automation.js").then((module) => module.createAutomationTab)],
  ["harvest", () => import("./harvest.js").then((module) => module.createHarvestTab)],
  ["embeddings", () => import("./embeddings.js").then((module) => module.createEmbeddingsTab)],
  ["semantic", () => import("./semantic.js").then((module) => module.createSemanticTab)],
  ["extraction", () => import("./extraction.js").then((module) => module.createExtractionTab)],
  ["screening", () => import("./screening.js").then((module) => module.createScreeningTab)],
]);

const TAB_FACTORIES = new Map();
const STATIC_TAB_LABELS = new Map([
  ["settings", "Settings"],
  ["automation", "Writer"],
  ["harvest", "Harvest"],
  ["embeddings", "Embeddings"],
  ["semantic", "Semantic Search"],
  ["extraction", "Extraction"],
  ["screening", "Screening"],
]);

const state = {
  bootstrap: null,
  activeTab: "automation",
  requestedActiveTab: REQUESTED_ACTIVE_TAB,
  sharedScopeKey: "",
  initializedUIState: false,
  status: { text: "Loading workflow...", tone: "" },
  activeController: null,
  tabContextMenu: null,
  renderToken: 0,
  chromeUpdateScheduled: false,
};
let uiAppearanceSyncPromise = null;
let statusTooltipNode = null;

function applyUIAppearance(appearance = {}) {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  const fontScale = Number(appearance?.font_scale || appearance?.fontScale || 1) || 1;
  root.style.setProperty("--mw-ui-scale", String(fontScale));
  root.dataset.zoteroFontScale = String(fontScale);
}

function normalizePreviewPageTheme(value = "") {
  return String(value || "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

async function refreshUIAppearance() {
  if (uiAppearanceSyncPromise) {
    return uiAppearanceSyncPromise;
  }
  uiAppearanceSyncPromise = (async () => {
    try {
      const result = await invoke("workflow.getUIAppearance");
      applyUIAppearance(result?.ui_appearance || result || {});
    }
    finally {
      uiAppearanceSyncPromise = null;
    }
  })();
  return uiAppearanceSyncPromise;
}

function createNode(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.textContent !== undefined) {
    node.textContent = options.textContent;
  }
  if (options.html !== undefined) {
    node.innerHTML = options.html;
  }
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value));
      }
    });
  }
  if (options.children) {
    for (const child of options.children) {
      if (child) {
        node.appendChild(child);
      }
    }
  }
  return node;
}

function ensureStatusTooltipNode() {
  if (statusTooltipNode && statusTooltipNode.isConnected) {
    return statusTooltipNode;
  }
  statusTooltipNode = createNode("div", {
    className: "mw-status-tooltip",
    attrs: {
      hidden: "hidden",
      role: "tooltip",
    },
  });
  document.body.appendChild(statusTooltipNode);
  return statusTooltipNode;
}

function positionStatusTooltip(anchor) {
  const tooltip = ensureStatusTooltipNode();
  if (!anchor || !tooltip || tooltip.hidden) {
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  const tipRect = tooltip.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + gap;
  if (top + tipRect.height + 8 > viewportHeight) {
    top = Math.max(8, rect.top - tipRect.height - gap);
  }
  if (left + tipRect.width + 8 > viewportWidth) {
    left = Math.max(8, viewportWidth - tipRect.width - 8);
  }
  tooltip.style.left = `${Math.round(Math.max(8, left))}px`;
  tooltip.style.top = `${Math.round(Math.max(8, top))}px`;
}

function showStatusTooltip(anchor) {
  const text = cleanDisplayText(anchor?.getAttribute?.("data-status-full") || anchor?.textContent || "");
  if (!text) {
    return;
  }
  const tooltip = ensureStatusTooltipNode();
  tooltip.textContent = text;
  tooltip.hidden = false;
  positionStatusTooltip(anchor);
  window.requestAnimationFrame(() => positionStatusTooltip(anchor));
}

function hideStatusTooltip() {
  if (statusTooltipNode) {
    statusTooltipNode.hidden = true;
  }
}

function bindStatusTooltip(node) {
  if (!node || node.dataset.statusTooltipBound === "true") {
    return;
  }
  node.dataset.statusTooltipBound = "true";
  node.addEventListener("mouseenter", () => showStatusTooltip(node));
  node.addEventListener("mousemove", () => positionStatusTooltip(node));
  node.addEventListener("mouseleave", hideStatusTooltip);
  node.addEventListener("focus", () => showStatusTooltip(node));
  node.addEventListener("blur", hideStatusTooltip);
}

function currentTabLabel() {
  const tabs = Array.isArray(state.bootstrap?.tabs) ? state.bootstrap.tabs : [];
  const activeID = String(state.activeTab || "").trim();
  return String(
    tabs.find((tab) => String(tab?.id || "") === activeID)?.label
    || STATIC_TAB_LABELS.get(activeID)
    || "Writer"
  );
}

function fallbackTabID(visibleTabs = []) {
  const tabs = Array.isArray(visibleTabs) ? visibleTabs.map((entry) => String(entry || "")).filter(Boolean) : [];
  if (!tabs.length) {
    return "settings";
  }
  if (tabs.includes("harvest")) {
    return "harvest";
  }
  if (tabs.includes("automation")) {
    return "automation";
  }
  return tabs[0] || "automation";
}

async function syncHostTitle() {
  const projectName = String(state.bootstrap?.project?.collection_name || "").trim();
  const tabLabel = currentTabLabel();
  const title = projectName && tabLabel ? `${projectName} - ${tabLabel}` : projectName || tabLabel || "Writer";
  try {
    document.title = title;
  }
  catch (_error) {}
  try {
    await invoke("workflow.tabTitle.set", {
      tab_id: REQUESTED_TAB_ID,
      active_tab: state.activeTab,
    });
  }
  catch (_error) {}
}

function setStatus(text, tone = "") {
  state.status = { text, tone };
  updateStatusNode();
}

function updateStatusNode() {
  const node = document.querySelector(".mw-status");
  if (!node) {
    return;
  }
  const full = cleanDisplayText(state.status.text);
  node.className = `mw-status${state.status.tone ? ` ${state.status.tone}` : ""}`;
  node.textContent = compactStatusText(full);
  node.title = full;
  node.setAttribute("aria-label", full);
  node.setAttribute("data-status-full", full);
  node.setAttribute("tabindex", "0");
  bindStatusTooltip(node);
}

function settingsChromeState() {
  if (state.activeTab !== "settings") {
    return null;
  }
  const controller = state.activeController;
  if (!controller || typeof controller.getChromeState != "function") {
    return null;
  }
  return controller.getChromeState() || null;
}

async function resolveTabFactory(tabID) {
  const key = String(tabID || "").trim();
  if (!key) {
    return null;
  }
  if (TAB_FACTORIES.has(key)) {
    return TAB_FACTORIES.get(key);
  }
  const loader = TAB_LOADERS.get(key);
  if (!loader) {
    return null;
  }
  const factory = await loader();
  if (typeof factory == "function") {
    TAB_FACTORIES.set(key, factory);
    return factory;
  }
  return null;
}

async function refreshSharedWorkflowUIState() {
  if (!state.bootstrap?.project?.project_id) {
    return state.bootstrap?.workflow_ui || {};
  }
  const result = await invoke("workflow.uiState.get", {});
  const uiState = result?.ui_state || {};
  state.bootstrap.workflow_ui = uiState;
  state.sharedScopeKey = String(uiState.last_scope_key || "");
  return uiState;
}

async function saveWorkflowUIState(payload = {}) {
  if (!state.bootstrap?.project?.project_id) {
    if (Object.prototype.hasOwnProperty.call(payload, "last_scope_key")) {
      state.sharedScopeKey = String(payload.last_scope_key || "");
    }
    return state.bootstrap?.workflow_ui || {};
  }
  const result = await invoke("workflow.uiState.save", payload);
  const uiState = result?.ui_state || {};
  state.bootstrap.workflow_ui = uiState;
  if (Object.prototype.hasOwnProperty.call(payload, "last_scope_key")) {
    state.sharedScopeKey = String(uiState.last_scope_key || "");
  }
  return uiState;
}

function readTabJobID(tabID = state.activeTab) {
  return String(state.bootstrap?.workflow_ui?.tab_jobs?.[String(tabID || "").trim()] || "").trim();
}

async function rememberTabJobID(jobID = "", tabID = state.activeTab) {
  let cleanTabID = String(tabID || "").trim();
  if (!cleanTabID) {
    return "";
  }
  let cleanJobID = String(jobID || "").trim();
  let nextJobs = Object.assign({}, state.bootstrap?.workflow_ui?.tab_jobs || {});
  nextJobs[cleanTabID] = cleanJobID;
  let nextUIState = await saveWorkflowUIState({
    tab_jobs: nextJobs,
    tab_id: cleanTabID,
    last_job_id: cleanJobID,
  });
  return String(nextUIState?.tab_jobs?.[cleanTabID] || "").trim();
}

async function refreshActiveTab() {
  await refreshSharedWorkflowUIState().catch(() => {});
  const controller = state.activeController;
  if (controller && typeof controller.refresh == "function") {
    await controller.refresh({ manual: true });
    updateStatusNode();
    return;
  }
  await render();
}

async function refreshBootstrap({ quiet = false } = {}) {
  if (!quiet) {
    setStatus("Loading workflow...");
  }
  try {
    state.bootstrap = await invoke("workflow.getBootstrap");
    document.documentElement.dataset.theme = state.bootstrap?.theme || "dark";
    applyUIAppearance(state.bootstrap?.ui_appearance || {});
    const visibleTabs = (state.bootstrap?.tabs || []).map((tab) => String(tab.id || "")).filter(Boolean);
    const workflowUI = state.bootstrap?.workflow_ui || {};
    if (!state.initializedUIState) {
      state.sharedScopeKey = String(workflowUI.last_scope_key || "");
      const requestedTab = state.requestedActiveTab && (visibleTabs.includes(state.requestedActiveTab) || state.requestedActiveTab === "settings")
        ? state.requestedActiveTab
        : "";
      const storedTab = String(workflowUI.active_tab || "");
      state.activeTab = requestedTab
        || (storedTab && visibleTabs.includes(storedTab) ? storedTab : "")
        || (!state.bootstrap?.project ? "settings" : fallbackTabID(visibleTabs));
      state.initializedUIState = true;
      if ((requestedTab || storedTab) && state.bootstrap?.project?.project_id) {
        saveWorkflowUIState({ active_tab: state.activeTab }).catch((error) => {
          setStatus(error?.message || String(error), "is-error");
        });
      }
    }
    else if (
      !TAB_LOADERS.has(state.activeTab)
      || (state.activeTab !== "settings" && !visibleTabs.includes(state.activeTab))
    ) {
      state.activeTab = state.bootstrap?.project ? fallbackTabID(visibleTabs) : "settings";
    }
    await render();
    syncHostTitle().catch(() => {});
    setStatus(state.bootstrap?.project || state.activeTab == "settings" ? "Ready." : "Open a collection project.", state.bootstrap?.project || state.activeTab == "settings" ? "is-ready" : "");
  }
  catch (error) {
    await render();
    setStatus(error?.message || String(error), "is-error");
  }
}

async function canLeaveActiveTab(reason = "tab-switch") {
  const controller = state.activeController;
  if (!controller || typeof controller.canDeactivate != "function") {
    return true;
  }
  try {
    return (await controller.canDeactivate(reason)) !== false;
  }
  catch (error) {
    setStatus(error?.message || String(error), "is-error");
    return false;
  }
}

function cleanupActiveTab() {
  const controller = state.activeController;
  state.activeController = null;
  if (controller && typeof controller.destroy == "function") {
    try {
      controller.destroy();
    }
    catch (_error) {}
  }
}

async function switchTab(nextTab) {
  if (!nextTab || nextTab === state.activeTab) {
    return;
  }
  if (!(await canLeaveActiveTab("tab-switch"))) {
    return;
  }
  await refreshSharedWorkflowUIState().catch((error) => {
    setStatus(error?.message || String(error), "is-error");
  });
  cleanupActiveTab();
  state.activeTab = nextTab;
  await render();
  syncHostTitle().catch(() => {});
  saveWorkflowUIState({ active_tab: nextTab }).catch((error) => {
    setStatus(error?.message || String(error), "is-error");
  });
}

function ensureTabContextMenu() {
  if (state.tabContextMenu?.isConnected) {
    return state.tabContextMenu;
  }
  const menu = createNode("div", { className: "mw-tab-context-menu" });
  menu.style.display = "none";
  const action = createNode("button", {
    className: "mw-button",
    textContent: "Open in New Tab",
    attrs: { type: "button", "data-workflow-open-new-tab": "true" },
  });
  action.addEventListener("click", async () => {
    const targetKind = String(menu.dataset.targetKind || "tab").trim() || "tab";
    const tabID = String(menu.dataset.tabId || "").trim();
    closeTabContextMenu();
    try {
      if (targetKind === "settings") {
        await invoke("workflow.settings.open", {
          new_tab: true,
        });
        setStatus("Opened Settings in a new tab.", "is-ready");
        return;
      }
      if (targetKind === "jobs") {
        await invoke("workflow.jobs.open", {
          new_tab: true,
        });
        setStatus("Opened Jobs in a new tab.", "is-ready");
        return;
      }
      if (!tabID) {
        return;
      }
      await invoke("workflow.openTab", {
        tab_id: tabID,
        new_tab: true,
      });
      setStatus(`Opened ${tabID} in a new tab.`, "is-ready");
    }
    catch (error) {
      setStatus(error?.message || String(error), "is-error");
    }
  });
  menu.appendChild(action);
  document.body.appendChild(menu);
  state.tabContextMenu = menu;
  return menu;
}

function closeTabContextMenu() {
  if (!state.tabContextMenu) {
    return;
  }
  state.tabContextMenu.style.display = "none";
  delete state.tabContextMenu.dataset.tabId;
  delete state.tabContextMenu.dataset.targetKind;
}

function openTabContextMenu(event, options = {}) {
  const menu = ensureTabContextMenu();
  const targetKind = String(options?.kind || "tab").trim() || "tab";
  menu.dataset.targetKind = targetKind;
  if (targetKind === "tab") {
    menu.dataset.tabId = String(options?.tabId || "");
  }
  else {
    delete menu.dataset.tabId;
  }
  menu.style.display = "flex";
  menu.style.position = "absolute";
  menu.style.left = `${Math.round(event.pageX)}px`;
  menu.style.top = `${Math.round(event.pageY)}px`;
}

function renderTabs() {
  const tabs = (state.bootstrap?.tabs || []).filter((tab) => TAB_LOADERS.has(String(tab?.id || "")));
  return createNode("div", {
    className: "mw-tabs",
    children: tabs.map((tab) =>
      createNode("button", {
        className: `mw-tab${state.activeTab === tab.id ? " is-active" : ""}`,
        textContent: tab.label,
        attrs: { type: "button", "data-tab": tab.id },
      })
    ),
  });
}

function renderSettingsSections(chromeState = null) {
  const tabs = Array.isArray(chromeState?.tabs) ? chromeState.tabs : [];
  return createNode("div", {
    className: "mw-tabs",
    children: tabs.map((tab) =>
      createNode("button", {
        className: `mw-tab${String(chromeState?.active_tab || "") === String(tab?.id || "") ? " is-active" : ""}`,
        textContent: String(tab?.label || tab?.id || ""),
        attrs: {
          type: "button",
          "data-settings-section": String(tab?.id || ""),
        },
      })
    ),
  });
}

function buildChrome() {
  const isSettingsView = state.activeTab === "settings";
  const settingsChrome = settingsChromeState();
  const jobsButton = createNode("button", {
    className: "mw-button",
    textContent: "Jobs",
    attrs: {
      type: "button",
      "data-workflow-open-jobs": "true",
      ...(state.bootstrap?.project ? {} : { disabled: "disabled" }),
    },
  });
  const statusNode = createNode("div", {
    className: `mw-status${state.status.tone ? ` ${state.status.tone}` : ""}`,
    textContent: compactStatusText(state.status.text),
    attrs: {
      title: cleanDisplayText(state.status.text),
      "aria-label": cleanDisplayText(state.status.text),
      "data-status-full": cleanDisplayText(state.status.text),
      tabindex: "0",
    },
  });
  bindStatusTooltip(statusNode);

  if (isSettingsView && settingsChrome) {
    return createNode("section", {
      className: "mw-chrome",
      children: [
        createNode("div", {
          className: "mw-topbar",
          children: [
	            renderSettingsSections(settingsChrome),
	            createNode("div", {
	              className: "mw-topbar-meta",
	              children: [
	                createNode("button", {
	                  className: "mw-button",
		                  textContent: "Reload",
                  attrs: {
                    type: "button",
                    "data-workflow-refresh-tab": "true",
                    ...(settingsChrome.refresh_disabled ? { disabled: "disabled" } : {}),
                  },
                }),
                createNode("button", {
                  className: "mw-button",
                  textContent: "Save",
                  attrs: {
                    type: "button",
                    "data-settings-save": "true",
                    ...(settingsChrome.save_disabled ? { disabled: "disabled" } : {}),
                  },
                }),
                statusNode,
              ],
            }),
          ],
        }),
      ],
    });
  }

	  const refreshButton = createNode("button", {
	    className: "mw-button",
	    textContent: "Reload",
    attrs: {
      type: "button",
      "data-workflow-refresh-tab": "true",
      ...((state.bootstrap?.project || isSettingsView) ? {} : { disabled: "disabled" }),
    },
  });
  const settingsButton = createNode("button", {
    className: `mw-button${isSettingsView ? " is-active" : ""}`,
    textContent: "Settings",
    attrs: {
      type: "button",
      "data-workflow-open-settings": "true",
    },
  });
  return createNode("section", {
    className: "mw-chrome",
    children: [
      createNode("div", {
        className: "mw-topbar",
        children: [
          renderTabs(),
          createNode("div", {
            className: "mw-topbar-meta",
            children: [
              settingsButton,
              refreshButton,
              jobsButton,
              statusNode,
            ],
          }),
        ],
      }),
    ],
  });
}

function bindChrome(root) {
  root.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      closeTabContextMenu();
      await switchTab(button.getAttribute("data-tab") || "automation");
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTabContextMenu(event, {
        kind: "tab",
        tabId: button.getAttribute("data-tab") || "",
      });
    });
  });
  root.querySelectorAll("[data-settings-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeController?.setActiveSection?.(button.getAttribute("data-settings-section") || "runtime");
    });
  });
  root.querySelectorAll("[data-settings-save='true']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await state.activeController?.save?.();
      }
      catch (error) {
        setStatus(error?.message || String(error), "is-error");
      }
    });
  });
  root.querySelectorAll("[data-workflow-open-jobs='true']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await invoke("workflow.jobs.open", { new_tab: true });
        setStatus("Opened Jobs tab.", "is-ready");
      }
      catch (error) {
        setStatus(error?.message || String(error), "is-error");
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTabContextMenu(event, {
        kind: "jobs",
      });
    });
  });
  root.querySelectorAll("[data-workflow-open-settings='true']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.activeTab === "settings" && !state.bootstrap?.project) {
        return;
      }
      try {
        await invoke("workflow.settings.open", {});
        setStatus("Opened Settings tab.", "is-ready");
      }
      catch (error) {
        setStatus(error?.message || String(error), "is-error");
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTabContextMenu(event, {
        kind: "settings",
      });
    });
  });
  root.querySelectorAll("[data-workflow-refresh-tab='true']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await refreshActiveTab();
        setStatus(`${currentTabLabel()} refreshed.`, "is-ready");
      }
      catch (error) {
        setStatus(error?.message || String(error), "is-error");
      }
    });
  });
}

function refreshChrome() {
  const root = document.getElementById("workflow-app");
  if (!root) {
    return;
  }
  const chrome = buildChrome();
  const existingChrome = root.querySelector(".mw-chrome");
  if (existingChrome && existingChrome.parentNode === root) {
    root.replaceChild(chrome, existingChrome);
  }
  else {
    root.insertBefore(chrome, root.firstChild || null);
  }
  bindChrome(root);
  updateStatusNode();
}

function requestChromeUpdate() {
  if (state.chromeUpdateScheduled) {
    return;
  }
  state.chromeUpdateScheduled = true;
  window.setTimeout(() => {
    state.chromeUpdateScheduled = false;
    refreshChrome();
  }, 0);
}

async function renderPanel() {
  const factory = await resolveTabFactory(state.activeTab)
    || await resolveTabFactory(state.bootstrap?.project ? "automation" : "settings")
    || await resolveTabFactory("automation")
    || await resolveTabFactory("harvest");
  if (typeof factory != "function") {
    state.activeController = null;
    return createNode("div", {
      className: "mw-empty",
      textContent: "This tab could not be loaded.",
    });
  }
  const panelResult = await factory({
    bootstrap: state.bootstrap,
    setStatus,
    refreshBootstrap,
    refreshActiveTab,
    invoke,
    readEventStream,
    createNode,
    requestChromeUpdate,
    getSharedScopeKey: () => String(state.sharedScopeKey || ""),
    readSharedScopeKey: async () => {
      await refreshSharedWorkflowUIState().catch(() => {});
      return String(state.sharedScopeKey || "");
    },
    rememberScopeKey: async (scopeKey = "") => {
      state.sharedScopeKey = String(scopeKey || "").trim();
      await saveWorkflowUIState({ last_scope_key: state.sharedScopeKey });
      return state.sharedScopeKey;
    },
    switchTab: async (tabID = "") => {
      await switchTab(String(tabID || "").trim());
      return state.activeTab;
    },
    readTabJobID: (tabID = state.activeTab) => readTabJobID(tabID),
    rememberTabJobID: async (jobID = "", tabID = state.activeTab) => rememberTabJobID(jobID, tabID),
  });
  if (panelResult && panelResult.node) {
    state.activeController = panelResult;
    return panelResult.node;
  }
  state.activeController = null;
  return panelResult;
}

async function render() {
  const root = document.getElementById("workflow-app");
  if (!root) {
    return;
  }
  const token = ++state.renderToken;
  let panel = null;
  try {
    panel = await renderPanel();
  }
  catch (error) {
    const message = error?.message || String(error);
    setStatus(message, "is-error");
    panel = createNode("div", {
      className: "mw-empty",
      textContent: `Could not load ${currentTabLabel()}: ${cleanDisplayText(message)}`,
    });
  }
  if (token !== state.renderToken) {
    return;
  }
  const stack = createNode("div", {
    className: "mw-panel-stack",
    children: [
      createNode("div", {
        className: "mw-empty",
        textContent: "Loading tab...",
      }),
    ],
  });
  root.replaceChildren(buildChrome(), stack);
  bindChrome(root);
  stack.replaceChildren(panel);
}

document.addEventListener("click", (event) => {
  if (state.tabContextMenu && !state.tabContextMenu.contains(event.target)) {
    closeTabContextMenu();
  }
}, true);

window.addEventListener("systematic-reviewer-ui-appearance-change", (event) => {
  applyUIAppearance(event?.detail || {});
});

window.addEventListener("systematic-reviewer-preview-page-theme-change", (event) => {
  const theme = normalizePreviewPageTheme(event?.detail?.preview_page_theme || event?.detail?.pageTheme || "");
  if (!state.bootstrap) {
    state.bootstrap = {};
  }
  state.bootstrap.preview_page_theme = theme;
  if (state.activeController && typeof state.activeController.setPreviewPageTheme == "function") {
    state.activeController.setPreviewPageTheme(theme);
  }
});

window.addEventListener("focus", () => {
  refreshUIAppearance().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshUIAppearance().catch(() => {});
  }
});

window.addEventListener("beforeunload", (event) => {
  const controller = state.activeController;
  if (!controller || typeof controller.hasPendingChanges != "function") {
    return;
  }
  if (!controller.hasPendingChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
});

refreshBootstrap().catch((error) => setStatus(error?.message || String(error), "is-error"));
