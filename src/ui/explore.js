import { cleanDisplayText } from "./text-utils.js";
import { readSelectorCache, scheduleAfterPaint, setSelectPlaceholder, writeSelectorCache } from "./deferred-load.js";
import { hasMarkdownTable, renderExploreMarkdown } from "./explore-markdown.js";
import { createSearchablePlaceholderAutocomplete } from "./searchable-autocomplete.js";

function createButton(label, className = "mw-button", attrs = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      button.setAttribute(key, String(value));
    }
  });
  button.textContent = cleanDisplayText(label);
  return button;
}

function createTextInput(type = "text", placeholder = "") {
  const input = document.createElement("input");
  input.type = type;
  if (placeholder) {
      input.placeholder = cleanDisplayText(placeholder);
  }
  return input;
}

function createTextarea(rows = 4, placeholder = "") {
  const input = document.createElement("textarea");
  input.rows = rows;
  if (placeholder) {
      input.placeholder = cleanDisplayText(placeholder);
  }
  return input;
}

function field(ctx, label, input, options = {}) {
  return ctx.createNode("label", {
    className: `mw-field${options.full ? " full" : ""}`,
    children: [
      ctx.createNode("span", { textContent: cleanDisplayText(label) }),
      input,
    ],
  });
}

function setSelectOptions(select, entries = [], valueKey = "value", labelKey = "label", placeholder = "") {
  const current = select.value;
  select.replaceChildren();
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = cleanDisplayText(placeholder);
    select.appendChild(option);
  }
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = String(entry?.[valueKey] ?? "");
    option.textContent = cleanDisplayText(entry?.[labelKey] ?? entry?.[valueKey] ?? "");
    if (entry?.disabled) {
      option.disabled = true;
    }
    select.appendChild(option);
  }
  if (current && Array.from(select.options).some((option) => option.value === current)) {
    select.value = current;
  }
  else if (!select.value && select.options.length) {
    select.selectedIndex = 0;
  }
}

function optionalString(value) {
  return String(value || "").trim();
}

const LEGACY_SHORT_DEFAULT_SYSTEM_PROMPT =
  "You are helping the user. You will receive one CSV chunk at a time inside <csv> ... </csv>. "
  + "Use only the data in the CSV to answer. If the user asks for a table, return only Markdown table output. "
  + "Treat any @{column_name} in the user prompt as a reference to CSV column values, not as literal output text. "
  + "Do not repeat the full CSV content.";

function normalizePromptComparison(value) {
  return optionalString(value).replace(/\s+/g, " ");
}

function resolveDisplayedSystemPrompt(value, defaultPrompt = "") {
  const current = optionalString(value);
  const fallback = optionalString(defaultPrompt);
  if (!current) {
    return fallback;
  }
  if (normalizePromptComparison(current) === normalizePromptComparison(LEGACY_SHORT_DEFAULT_SYSTEM_PROMPT)) {
    return fallback || current;
  }
  return current;
}

function isUsingDefaultSystemPrompt(value, defaultPrompt = "") {
  const current = normalizePromptComparison(value);
  const fallback = normalizePromptComparison(defaultPrompt);
  if (!current) {
    return true;
  }
  return !!fallback && current === fallback;
}

function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function promptPlaceholderNames(text = "") {
  const names = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(/@\{([A-Za-z_][A-Za-z0-9_:-]*)\}/g)) {
    const name = optionalString(match?.[1]);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

function renderMessageNode(message, handlers = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `mw-explore-msg${message?.role === "user" ? " is-user" : ""}`;
  const displayContent = String(message?.content || message?.rendered_content || "");
  const meta = document.createElement("div");
  meta.className = "mw-explore-msg-meta";
  const parts = [];
  parts.push(message?.role === "user" ? "User" : message?.summary ? "Summary" : "Assistant");
  if (message?.batch !== null && message?.batch !== undefined && !Number.isNaN(Number(message.batch))) {
    parts.push(`Batch ${Number(message.batch) + 1}`);
  }
  if (Number(message?.row_count || 0) > 0) {
    parts.push(`${Number(message.row_count)} rows`);
  }
  if (Array.isArray(message?.column_keys) && message.column_keys.length) {
    parts.push(`Columns: ${message.column_keys.map((entry) => cleanDisplayText(entry)).join(", ")}`);
  }
  if (message?.runtime_label) {
    parts.push(message.runtime_label);
  }
  meta.textContent = parts.map((entry) => cleanDisplayText(entry)).join(" - ");
  wrapper.appendChild(meta);

  if (message?.thinking) {
    const details = document.createElement("details");
    details.className = "mw-explore-thinking";
    const summary = document.createElement("summary");
    summary.textContent = "Thinking";
    const pre = document.createElement("pre");
    pre.textContent = String(message.thinking || "");
    details.append(summary, pre);
    wrapper.appendChild(details);
  }

  wrapper.appendChild(renderExploreMarkdown(displayContent, message, handlers));

  if (message?.role !== "user" && hasMarkdownTable(displayContent)) {
    const actions = document.createElement("div");
    actions.className = "mw-explore-msg-actions";
    const save = createButton("Save table to CSV");
    save.addEventListener("click", () => {
      handlers.onSaveTable?.(String(message?.rendered_content || message?.content || ""));
    });
    actions.appendChild(save);
    wrapper.appendChild(actions);
  }
  return wrapper;
}

export function createExploreTab(ctx) {
  const panel = ctx.createNode("section", { className: "mw-tab-panel mw-explore-panel" });

  const chatSelect = document.createElement("select");
  chatSelect.setAttribute("data-explore-chat-select", "true");
  const newChatButton = createButton("New exploration", "mw-button", { "data-explore-action": "new-chat" });
  const refreshChatsButton = createButton("Refresh", "mw-button", { "data-explore-action": "refresh-chats" });
  const chatPath = ctx.createNode("div", { className: "mw-muted mw-small mw-explore-chat-path", attrs: { "data-explore-chat-path": "true" } });

  const scopeSelect = document.createElement("select");
  scopeSelect.setAttribute("data-explore-scope-select", "true");

  const promptInput = createTextarea(4, "Ask questions using @{citation}, @{title}, or other project columns.");
  promptInput.setAttribute("data-explore-prompt", "true");
  const columnsHint = ctx.createNode("div", { className: "mw-note mw-small" });

  const includeHistoryInput = document.createElement("input");
  includeHistoryInput.type = "checkbox";
  includeHistoryInput.checked = true;
  includeHistoryInput.setAttribute("data-explore-include-history", "true");
  const sendButton = createButton("Run", "mw-button primary", { "data-explore-action": "send-chat" });
  const chatLog = ctx.createNode("div", { className: "mw-explore-chat-log", attrs: { "data-explore-chat-log": "true" } });

  const advancedDetails = document.createElement("details");
  advancedDetails.className = "mw-explore-advanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.className = "mw-explore-advanced-summary";
  const advancedSummaryMain = ctx.createNode("span", { className: "mw-explore-advanced-title", textContent: "Advanced" });
  const advancedSummaryMeta = ctx.createNode("span", { className: "mw-explore-advanced-meta", textContent: "Default model and system prompt" });
  advancedSummary.append(advancedSummaryMain, advancedSummaryMeta);

  const modelSelect = document.createElement("select");
  modelSelect.setAttribute("data-explore-model-select", "true");
  const modelInfo = ctx.createNode("div", { className: "mw-note" });

  const systemPromptInput = createTextarea(4, "Leave blank to use the bundled Explore system prompt");
  systemPromptInput.setAttribute("data-explore-system-prompt", "true");

  const batchContextInput = createTextInput("number", "Auto");
  batchContextInput.setAttribute("data-explore-batch-context-override", "true");
  batchContextInput.min = "0";
  batchContextInput.step = "1000";
  const batchHelpButton = createButton("?", "mw-button mw-explore-help-button", {
    "data-explore-batch-context-help": "true",
    "aria-label": "Batch context override help",
  });

  const budgetButton = createButton("Budget", "mw-button mw-explore-budget-widget", {
    "data-explore-budget-widget": "true",
    "aria-label": "Explore context budget details",
  });
  const budgetLabel = ctx.createNode("span", { className: "mw-explore-budget-widget-label", textContent: "Budget" });
  const budgetValue = ctx.createNode("span", { className: "mw-explore-budget-widget-value", textContent: "Auto" });
  budgetButton.replaceChildren(budgetLabel, budgetValue);

  const inlinePopover = document.createElement("div");
  inlinePopover.className = "mw-explore-inline-popover";
  inlinePopover.hidden = true;
  document.body.appendChild(inlinePopover);

  const citationOverlay = document.createElement("div");
  citationOverlay.className = "mw-explore-citation-overlay";
  citationOverlay.hidden = true;
  document.body.appendChild(citationOverlay);

  const state = {
    config: null,
    chats: [],
    chat: null,
    columns: [],
    scopeKey: String(ctx.getSharedScopeKey?.() || ""),
    modelChoices: [],
    selectedModelChoiceID: "",
    destroyed: false,
    activeOverlayTarget: null,
    activePopoverTarget: null,
    cancelAfterPaint: null,
    settingsSaveTimer: 0,
    suspendSettingsSync: false,
  };
  const projectID = String(ctx.bootstrap?.project?.project_id || ctx.bootstrap?.project?.collection_name || "project");

  const placeholderAutocomplete = createSearchablePlaceholderAutocomplete(ctx, {
    getOptions: () => (Array.isArray(state.columns) ? state.columns : []).filter((entry) => {
      const key = String(entry?.key || "").trim();
      return key && key !== "item_key" && key !== "citation_token";
    }),
    ensureOptions: async () => {
      if (!state.columns.length) {
        const result = await ctx.invoke("explore.columns.list", {});
        state.columns = Array.isArray(result?.columns) ? result.columns : [];
        writeSelectorCache(projectID, "explore:columns:list", "", { columns: state.columns });
      }
      return state.columns;
    },
    searchPlaceholder: "Filter columns...",
    emptyText: "No columns match this filter.",
    metaLabel: "columns",
    menuClassName: "mw-explore-placeholder-menu",
    metaText: (entry) => {
      const key = String(entry?.key || "").trim();
      const label = String(entry?.label || "").trim();
      return key && label && key !== label ? key : "";
    },
  });
  placeholderAutocomplete.attach(promptInput);
  placeholderAutocomplete.attach(systemPromptInput);

  function positionFloatingBox(box, anchor) {
    const rect = anchor.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 6;
    box.style.left = "0px";
    box.style.top = "0px";
    box.hidden = false;
    const boxRect = box.getBoundingClientRect();
    const maxLeft = window.scrollX + window.innerWidth - boxRect.width - 8;
    const maxTop = window.scrollY + window.innerHeight - boxRect.height - 8;
    if (left > maxLeft) {
      left = Math.max(window.scrollX + 8, maxLeft);
    }
    if (top > maxTop) {
      top = Math.max(window.scrollY + 8, rect.top + window.scrollY - boxRect.height - 6);
    }
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }

  function hideCitationOverlay() {
    citationOverlay.hidden = true;
    citationOverlay.replaceChildren();
    state.activeOverlayTarget = null;
  }

  function hideInlinePopover() {
    inlinePopover.hidden = true;
    inlinePopover.replaceChildren();
    state.activePopoverTarget = null;
  }

  function showInlinePopover(anchor, title, lines = []) {
    const nodes = [
      title
        ? ctx.createNode("div", {
            className: "mw-explore-inline-popover-title",
            textContent: title,
          })
        : null,
      ...lines.map((line) => ctx.createNode("div", {
        className: "mw-explore-token-tooltip-line",
        textContent: cleanDisplayText(line),
      })),
    ].filter(Boolean);
    inlinePopover.replaceChildren(...nodes);
    inlinePopover.hidden = false;
    positionFloatingBox(inlinePopover, anchor);
    state.activePopoverTarget = anchor;
  }

  function currentModelChoice() {
    return state.modelChoices.find((entry) => String(entry?.choice_id || "") === state.selectedModelChoiceID)
      || state.modelChoices.find((entry) => entry?.is_default)
      || state.modelChoices[0]
      || null;
  }

  function splitModelChoiceID(value = "") {
    const [roleID, presetID] = String(value || "").split("::");
    return {
      runtime_role_id: String(roleID || "").trim(),
      runtime_preset_id: String(presetID || "default").trim() || "default",
    };
  }

  function normalizedBatchOverride() {
    const parsed = Number(batchContextInput.value || 0) || 0;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return Math.max(0, Math.round(parsed));
  }

  function budgetMetrics() {
    const choice = currentModelChoice();
    const contextWindow = Number(choice?.context_tokens || 0) || 0;
    const reserveTokens = Number(choice?.reserve_tokens || 0) || 0;
    const effectiveSystemPrompt = resolveDisplayedSystemPrompt(
      systemPromptInput.value,
      state.config?.default_system_prompt || "",
    );
    const historyMessages = includeHistoryInput.checked ? (state.chat?.messages || []) : [];
    const historyTokens = historyMessages.reduce((total, entry) =>
      total + estimateTokens(entry?.content || "") + estimateTokens(entry?.thinking || ""), 0);
    const systemTokens = estimateTokens(effectiveSystemPrompt);
    const draftPromptTokens = estimateTokens(promptInput.value || "");
    const override = normalizedBatchOverride();
    const batchContextWindow = override || contextWindow;
    const effectiveBatchBudget = Math.max(batchContextWindow - reserveTokens - historyTokens - systemTokens - draftPromptTokens, 0);
    const baseUsed = historyTokens + systemTokens + draftPromptTokens;
    const pct = batchContextWindow
      ? Math.min(100, Math.round((baseUsed / Math.max(batchContextWindow, 1)) * 100))
      : 0;
    return {
      choice,
      historyTokens,
      systemTokens,
      draftPromptTokens,
      contextWindow,
      reserveTokens,
      batchContextWindow,
      effectiveBatchBudget,
      override,
      finalSummaryContextWindow: contextWindow,
      pct,
    };
  }

  function renderBudgetWidget() {
    const metrics = budgetMetrics();
    if (!metrics.choice) {
      budgetValue.textContent = "Unavailable";
      modelInfo.textContent = "Configure an Explore-usable model preset in Settings.";
      return;
    }
    modelInfo.textContent = metrics.choice.inline_api_available === false
      ? `${metrics.choice.label}: ${metrics.choice.unavailable_reason || "Not configured"}`
      : `${metrics.choice.label}: ${metrics.choice.model || metrics.choice.model_label || "Configured model"}`;
    budgetValue.textContent = metrics.contextWindow
      ? `${metrics.effectiveBatchBudget.toLocaleString()} left`
      : "Auto";
    budgetButton.classList.toggle("is-warning", !!metrics.contextWindow && metrics.effectiveBatchBudget <= 0);
  }

  function renderPromptHints() {
    const placeholders = promptPlaceholderNames(promptInput.value || "");
    columnsHint.textContent = placeholders.length
      ? `Columns: ${placeholders.join(", ")}`
      : "Type @{ to insert readable row values such as @{citation}, @{title}, or extraction/manual columns.";
  }

  function renderAdvancedSummary() {
    const choice = currentModelChoice();
    const parts = [];
    if (choice?.label) {
      parts.push(choice.label);
    }
    if (normalizedBatchOverride()) {
      parts.push(`Batch override ${normalizedBatchOverride().toLocaleString()} tok`);
    }
    else {
      parts.push("Full preset context");
    }
    if (!isUsingDefaultSystemPrompt(systemPromptInput.value, state.config?.default_system_prompt || "")) {
      parts.push("Custom system prompt");
    }
    advancedSummaryMeta.textContent = parts.join(" | ") || "Default model and system prompt";
  }

  function populateScopeChoices() {
    const scopes = Array.isArray(state.config?.available_scopes) ? state.config.available_scopes : [];
    setSelectOptions(scopeSelect, scopes.map((entry) => ({
      value: entry.collection_key || "",
      label: entry.label || entry.collection_name || "Scope",
    })), "value", "label");
    if (!state.scopeKey) {
      state.scopeKey = state.config?.default_scope_key || scopes[0]?.collection_key || "";
    }
    scopeSelect.value = state.scopeKey;
    state.scopeKey = scopeSelect.value || "";
  }

  function populateModelChoices() {
    const entries = (state.modelChoices || []).map((entry) => ({
      value: entry.choice_id,
      label: entry.model ? `${entry.label} - ${entry.model}` : entry.label,
      disabled: false,
    }));
    setSelectOptions(modelSelect, entries, "value", "label");
    if (!state.selectedModelChoiceID) {
      state.selectedModelChoiceID = state.config?.default_model_choice_id || entries[0]?.value || "";
    }
    if (state.selectedModelChoiceID) {
      modelSelect.value = state.selectedModelChoiceID;
    }
    renderAdvancedSummary();
    renderBudgetWidget();
  }

  function renderChatPath() {
    chatPath.replaceChildren();
    if (!state.chat?.path && !state.chat?.markdown_path) {
      return;
    }
    const nodes = [];
    if (state.chat?.path) {
      nodes.push(ctx.createNode("div", { textContent: `Chat JSON: ${state.chat.path}` }));
    }
    if (state.chat?.markdown_path) {
      nodes.push(ctx.createNode("div", { textContent: `Final Markdown: ${state.chat.markdown_path}` }));
    }
    chatPath.append(...nodes);
  }

  function renderChat() {
    chatLog.replaceChildren();
    const messages = Array.isArray(state.chat?.messages) ? state.chat.messages : [];
    if (!messages.length) {
      chatLog.appendChild(ctx.createNode("div", {
        className: "mw-muted",
        textContent: state.chat ? "No messages yet. Ask a question to start." : "Select or create an exploration.",
      }));
      return;
    }
    messages.forEach((message) => {
      chatLog.appendChild(renderMessageNode(message, {
        onShowCitation(target, citation) {
          citationOverlay.replaceChildren(
            ctx.createNode("div", { className: "mw-explore-citation-overlay-title", textContent: citation.token || "" }),
            ...((citation.labels || []).map((entry) =>
              ctx.createNode("div", {
                className: "mw-explore-citation-overlay-row",
                children: [
                  ctx.createNode("div", { className: "mw-explore-citation-overlay-main", textContent: entry.citation_text || entry.item_key || "" }),
                  entry.title ? ctx.createNode("div", { className: "mw-explore-citation-overlay-sub", textContent: entry.title }) : null,
                ].filter(Boolean),
              })
            )),
          );
          citationOverlay.hidden = false;
          positionFloatingBox(citationOverlay, target);
          state.activeOverlayTarget = target;
        },
        async onSaveTable(content) {
          try {
            const result = await ctx.invoke("explore.tables.saveCsv", { content });
            ctx.setStatus(result.path ? `Explore table saved: ${result.path}` : "Explore table saved.", "is-ready");
          }
          catch (error) {
            ctx.setStatus(error?.message || String(error), "is-error");
          }
        },
      }));
    });
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function refreshChats(selectID = "") {
    const result = await ctx.invoke("explore.chats.list", {});
    state.chats = Array.isArray(result?.chats) ? result.chats : [];
    setSelectOptions(chatSelect, state.chats.map((entry) => ({
      value: entry.id,
      label: entry.name || entry.id,
    })), "value", "label");
    if (selectID && state.chats.some((entry) => entry.id === selectID)) {
      chatSelect.value = selectID;
    }
    else if (state.chat?.id && state.chats.some((entry) => entry.id === state.chat.id)) {
      chatSelect.value = state.chat.id;
    }
  }

  function suspendSettingsSync(fn) {
    state.suspendSettingsSync = true;
    try {
      fn();
    }
    finally {
      state.suspendSettingsSync = false;
    }
  }

  function scheduleSettingsSync() {
    if (state.destroyed || state.suspendSettingsSync || !state.chat?.id) {
      return;
    }
    clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = window.setTimeout(() => {
      if (state.destroyed || !state.chat?.id) {
        return;
      }
      const choice = splitModelChoiceID(modelSelect.value || state.selectedModelChoiceID);
      ctx.invoke("explore.chats.update", {
        chat_id: state.chat.id,
        system_prompt: optionalString(systemPromptInput.value) || "",
        runtime_role_id: choice.runtime_role_id,
        runtime_preset_id: choice.runtime_preset_id,
        batch_context_tokens_override: normalizedBatchOverride(),
      }).then((result) => {
        if (!state.destroyed && result?.chat) {
          state.chat = result.chat;
          renderChatPath();
        }
      }).catch((error) => {
        if (!state.destroyed) {
          ctx.setStatus(error?.message || String(error), "is-error");
        }
      });
    }, 220);
  }

  async function loadChat(chatID) {
    if (!chatID) {
      state.chat = null;
      suspendSettingsSync(() => {
        systemPromptInput.value = state.config?.default_system_prompt || "";
        batchContextInput.value = "";
      });
      renderChatPath();
      renderChat();
      renderPromptHints();
      renderAdvancedSummary();
      renderBudgetWidget();
      return;
    }
    const result = await ctx.invoke("explore.chats.load", { chat_id: chatID });
    state.chat = result?.chat || null;
    chatSelect.value = state.chat?.id || "";
    suspendSettingsSync(() => {
      systemPromptInput.value = resolveDisplayedSystemPrompt(
        state.chat?.system_prompt || "",
        state.config?.default_system_prompt || "",
      );
      batchContextInput.value = state.chat?.batch_context_tokens_override
        ? String(state.chat.batch_context_tokens_override)
        : "";
      state.selectedModelChoiceID = `${state.chat?.runtime_role_id || ""}::${state.chat?.runtime_preset_id || "default"}`;
      if (!state.modelChoices.some((entry) => String(entry.choice_id || "") === state.selectedModelChoiceID)) {
        state.selectedModelChoiceID = state.config?.default_model_choice_id || state.modelChoices[0]?.choice_id || "";
      }
      if (state.selectedModelChoiceID) {
        modelSelect.value = state.selectedModelChoiceID;
      }
    });
    renderChatPath();
    renderChat();
    renderPromptHints();
    renderAdvancedSummary();
    renderBudgetWidget();
  }

  async function loadConfig({ preserveChat = true, manual = false } = {}) {
    if (manual) {
      ctx.setStatus("Refreshing Explore...");
    }
    const result = await ctx.invoke("explore.getConfig", {});
    state.config = result || {};
    state.columns = Array.isArray(result?.columns) ? result.columns : [];
    state.modelChoices = Array.isArray(result?.model_choices) ? result.model_choices : [];
    writeSelectorCache(projectID, "explore:columns:list", "", { columns: state.columns });
    writeSelectorCache(projectID, "explore:model-choices:list", "", { model_choices: state.modelChoices });
    writeSelectorCache(projectID, "explore:scopes:list", "", {
      scopes: Array.isArray(state.config?.available_scopes) ? state.config.available_scopes : [],
    });
    placeholderAutocomplete.refresh();
    if (!preserveChat || !state.chat?.id) {
      state.chat = null;
    }
    populateScopeChoices();
    populateModelChoices();
    await refreshChats(state.chat?.id || "");
    if (state.chat?.id && state.chats.some((entry) => entry.id === state.chat.id)) {
      await loadChat(state.chat.id);
    }
    else if (!state.chat && state.chats.length) {
      await loadChat(state.chats[0].id);
    }
    else {
      suspendSettingsSync(() => {
        systemPromptInput.value = state.config?.default_system_prompt || "";
        batchContextInput.value = "";
      });
      renderChatPath();
      renderChat();
      renderPromptHints();
      renderAdvancedSummary();
      renderBudgetWidget();
    }
    if (manual) {
      ctx.setStatus("Explore refreshed.", "is-ready");
    }
  }

  async function createChatSession() {
    const suggestedName = `Explore ${new Date().toLocaleString()}`;
    const name = window.prompt("New exploration name", suggestedName);
    if (name === null) {
      return;
    }
    const choice = splitModelChoiceID(modelSelect.value || state.selectedModelChoiceID);
    const result = await ctx.invoke("explore.chats.create", {
      name: optionalString(name) || suggestedName,
      system_prompt: optionalString(systemPromptInput.value) || state.config?.default_system_prompt || "",
      runtime_role_id: choice.runtime_role_id,
      runtime_preset_id: choice.runtime_preset_id,
      batch_context_tokens_override: normalizedBatchOverride(),
    });
    await refreshChats(result?.chat?.id || "");
    await loadChat(result?.chat?.id || "");
    ctx.setStatus("Explore chat created.", "is-ready");
  }

  async function runChat() {
    const prompt = optionalString(promptInput.value);
    if (!prompt) {
      ctx.setStatus("Enter a prompt first.", "is-error");
      return;
    }
    if (!state.chat?.id) {
      ctx.setStatus("Create or select an exploration first.", "is-error");
      return;
    }
    sendButton.disabled = true;
    try {
      const choice = splitModelChoiceID(modelSelect.value || state.selectedModelChoiceID);
      ctx.setStatus("Running Explore chat...", "");
      const result = await ctx.invoke("explore.chats.run", {
        chat_id: state.chat.id,
        prompt,
        system_prompt: optionalString(systemPromptInput.value) || "",
        include_history: !!includeHistoryInput.checked,
        collection_key: state.scopeKey,
        runtime_role_id: choice.runtime_role_id,
        runtime_preset_id: choice.runtime_preset_id,
        batch_context_tokens_override: normalizedBatchOverride(),
      });
      state.chat = result?.chat || null;
      promptInput.value = "";
      await refreshChats(state.chat?.id || "");
      renderChatPath();
      renderPromptHints();
      renderChat();
      renderAdvancedSummary();
      renderBudgetWidget();
      ctx.setStatus("Explore chat reply saved.", "is-ready");
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
    }
    finally {
      sendButton.disabled = false;
    }
  }

  const handleDocumentClick = (event) => {
    if (state.activeOverlayTarget && !citationOverlay.contains(event.target) && !state.activeOverlayTarget.contains(event.target)) {
      hideCitationOverlay();
    }
    if (state.activePopoverTarget && !inlinePopover.contains(event.target) && !state.activePopoverTarget.contains(event.target)) {
      hideInlinePopover();
    }
  };

  document.addEventListener("click", handleDocumentClick);

  newChatButton.addEventListener("click", () => {
    createChatSession().catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  refreshChatsButton.addEventListener("click", () => {
    loadConfig({ preserveChat: true, manual: true }).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  chatSelect.addEventListener("change", () => {
    loadChat(chatSelect.value).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  scopeSelect.addEventListener("change", () => {
    state.scopeKey = scopeSelect.value || "";
    Promise.resolve(ctx.rememberScopeKey?.(state.scopeKey || "")).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  modelSelect.addEventListener("change", () => {
    state.selectedModelChoiceID = modelSelect.value || state.selectedModelChoiceID;
    renderAdvancedSummary();
    renderBudgetWidget();
    scheduleSettingsSync();
  });
  systemPromptInput.addEventListener("input", () => {
    renderAdvancedSummary();
    renderBudgetWidget();
    scheduleSettingsSync();
  });
  batchContextInput.addEventListener("input", () => {
    renderAdvancedSummary();
    renderBudgetWidget();
    scheduleSettingsSync();
  });
  batchHelpButton.addEventListener("click", (event) => {
    event.preventDefault();
    showInlinePopover(batchHelpButton, "Batch context override", [
      "Leave this blank to use the selected preset's full context window for CSV chunking.",
      "Set a smaller value only when a model behaves better with shorter batches.",
      "Final multi-batch synthesis still uses the preset's full context window.",
    ]);
  });
  budgetButton.addEventListener("click", (event) => {
    event.preventDefault();
    const metrics = budgetMetrics();
    showInlinePopover(budgetButton, "Explore budget", [
      `History tokens: ${metrics.historyTokens.toLocaleString()}`,
      `System prompt tokens: ${metrics.systemTokens.toLocaleString()}`,
      `Draft prompt tokens: ${metrics.draftPromptTokens.toLocaleString()}`,
      `Selected preset context: ${metrics.contextWindow.toLocaleString()}`,
      `Reserved output: ${metrics.reserveTokens.toLocaleString()}`,
      `Active batch override: ${metrics.override ? metrics.override.toLocaleString() : "none"}`,
      `Effective batch budget: ${metrics.effectiveBatchBudget.toLocaleString()}`,
      `Final-summary context: ${metrics.finalSummaryContextWindow.toLocaleString()}`,
    ]);
  });
  promptInput.addEventListener("input", () => {
    hideCitationOverlay();
    renderPromptHints();
    renderBudgetWidget();
  });
  promptInput.addEventListener("keyup", () => {
    renderPromptHints();
    renderBudgetWidget();
  });
  includeHistoryInput.addEventListener("change", () => {
    renderBudgetWidget();
  });
  sendButton.addEventListener("click", () => {
    runChat().catch(() => {});
  });

  const advancedBody = ctx.createNode("div", {
    className: "mw-explore-advanced-body",
    children: [
      ctx.createNode("div", {
        className: "mw-explore-advanced-grid",
        children: [
          field(ctx, "Model", modelSelect),
          ctx.createNode("div", {
            className: "mw-explore-batch-field",
            children: [
              field(ctx, "Batch context override", ctx.createNode("div", {
                className: "mw-explore-inline-field",
                children: [batchContextInput, batchHelpButton],
              })),
            ],
          }),
          budgetButton,
        ],
      }),
      modelInfo,
      field(ctx, "System prompt", systemPromptInput, { full: true }),
    ],
  });
  advancedDetails.append(advancedSummary, advancedBody);

  panel.append(
    ctx.createNode("div", {
      className: "mw-explore-toolbar",
      children: [
        ctx.createNode("div", {
          className: "mw-explore-session-row",
          children: [
            ctx.createNode("div", {
              className: "mw-explore-session-controls",
              children: [
                field(ctx, "Session", ctx.createNode("div", {
                  className: "mw-explore-session-inline",
                  children: [chatSelect, newChatButton, refreshChatsButton],
                }), { full: true }),
                chatPath,
              ],
            }),
            field(ctx, "Scope", scopeSelect),
          ],
        }),
        advancedDetails,
      ],
    }),
    ctx.createNode("div", {
      className: "mw-explore-body",
      children: [
        chatLog,
        ctx.createNode("div", {
          className: "mw-explore-input",
          children: [
            field(ctx, "Prompt", promptInput, { full: true }),
            ctx.createNode("div", {
              className: "mw-explore-hints",
              children: [columnsHint],
            }),
            ctx.createNode("div", {
              className: "mw-explore-actions",
              children: [
                ctx.createNode("label", {
                  className: "mw-pill-toggle",
                  children: [includeHistoryInput, ctx.createNode("span", { textContent: "Include chat history" })],
                }),
                sendButton,
              ],
            }),
          ],
        }),
      ],
    }),
  );

  const cachedScopes = readSelectorCache(projectID, "explore:scopes:list", "");
  const cachedColumns = readSelectorCache(projectID, "explore:columns:list", "");
  const cachedModels = readSelectorCache(projectID, "explore:model-choices:list", "");
  if (cachedScopes?.scopes) {
    state.config = Object.assign({}, state.config || {}, { available_scopes: cachedScopes.scopes });
    populateScopeChoices();
  }
  else {
    setSelectPlaceholder(scopeSelect, "Loading scopes...");
  }
  if (cachedColumns?.columns) {
    state.columns = cachedColumns.columns;
    placeholderAutocomplete.refresh();
  }
  if (cachedModels?.model_choices) {
    state.modelChoices = cachedModels.model_choices;
    populateModelChoices();
  }
  else {
    setSelectPlaceholder(modelSelect, "Loading model presets...");
  }
  renderPromptHints();
  renderBudgetWidget();

  state.cancelAfterPaint = scheduleAfterPaint(() => {
    Promise.resolve(ctx.readSharedScopeKey?.())
      .catch(() => String(ctx.getSharedScopeKey?.() || ""))
      .then((scopeKey) => {
        state.scopeKey = String(scopeKey || state.scopeKey || "");
        return loadConfig({ preserveChat: false, manual: false });
      })
      .catch((error) => {
        ctx.setStatus(error?.message || String(error), "is-error");
      });
  });

  return {
    node: panel,
    refresh: async () => {
      await loadConfig({ preserveChat: true, manual: true });
    },
    destroy() {
      if (state.destroyed) {
        return;
      }
      state.destroyed = true;
      clearTimeout(state.settingsSaveTimer);
      state.cancelAfterPaint?.();
      document.removeEventListener("click", handleDocumentClick);
      placeholderAutocomplete.destroy();
      hideCitationOverlay();
      hideInlinePopover();
      citationOverlay.remove();
      inlinePopover.remove();
    },
  };
}
