import { renderExploreMarkdown } from "./explore-markdown.js";
import { cleanDisplayText } from "./text-utils.js";

const ALL_SCREENING_SCOPES = "__all_screening_scopes__";

function field(ctx, label, input, options = {}) {
  return ctx.createNode("label", {
    className: `mw-field${options.full ? " full" : ""}`,
    children: [
      ctx.createNode("span", { textContent: label }),
      input,
    ],
  });
}

function button(ctx, label, options = {}) {
  return ctx.createNode("button", {
    className: options.className || "mw-button",
    textContent: label,
    attrs: Object.assign({ type: "button" }, options.attrs || {}),
  });
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeText(value = "", multiline = false) {
  return cleanDisplayText(value || "", { multiline, trim: true });
}

async function writeClipboardText(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  }
  catch (_error) {
    return false;
  }
}

function uniqueColumnKeys(values = []) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(values) ? values : []) {
    const key = String(entry || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function removeColumnKey(values = [], targetKey = "") {
  const nextKey = String(targetKey || "").trim();
  return uniqueColumnKeys(values).filter((entry) => entry !== nextKey);
}

function insertColumnKey(values = [], targetKey = "", index = 0) {
  const nextKey = String(targetKey || "").trim();
  if (!nextKey) {
    return uniqueColumnKeys(values);
  }
  const next = removeColumnKey(values, nextKey);
  const at = Math.max(0, Math.min(Number(index || 0), next.length));
  next.splice(at, 0, nextKey);
  return next;
}

function defaultVisibleColumnKeys(result = {}) {
  const explicit = Array.isArray(result.visible_columns) ? result.visible_columns : null;
  if (explicit && explicit.length) {
    return explicit.slice();
  }
  return (Array.isArray(result.all_columns) ? result.all_columns : [])
    .filter((column) => column?.visible !== false)
    .map((column) => String(column.key || column.column_key || "").trim())
    .filter(Boolean);
}

function columnDefinition(result = {}, columnKey = "") {
  const allColumns = Array.isArray(result.all_columns) ? result.all_columns : [];
  return allColumns.find((column) => String(column.key || column.column_key || "") === String(columnKey || "")) || null;
}

function columnLabel(result = {}, columnKey = "") {
  const column = columnDefinition(result, columnKey);
  return normalizeText(column?.label || columnKey);
}

function isEditableColumn(result = {}, columnKey = "") {
  if (columnKey === "comments" || columnKey === "reason") {
    return true;
  }
  const column = columnDefinition(result, columnKey);
  return !!column?.editable;
}

function columnType(result = {}, columnKey = "") {
  const column = columnDefinition(result, columnKey);
  return String(column?.type || "text").toLowerCase();
}

function supportsFullTextOpen(columnKey = "") {
  return String(columnKey || "").toLowerCase().endsWith("_chunk");
}

function selectedScopeEntry(result = {}, scopeKey = "") {
  const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
  return scopes.find((entry) => String(entry.collection_key || "") === String(scopeKey || "")) || null;
}

function currentScopeValue(record = {}, pendingEdit = null) {
  if (pendingEdit?.target_collection_key) {
    return String(pendingEdit.target_collection_key || "");
  }
  return String(record.review_collection_key || record.decision_target_collection_key || "");
}

function fullTextStateForRecord(record = {}) {
  const attachments = record?.attachments || {};
  const explicit = String(attachments.full_text_state || "").trim().toLowerCase();
  if (explicit === "markdown_ready" || explicit === "pdf_only" || explicit === "missing") {
    return explicit;
  }
  if (attachments.has_markdown) {
    return "markdown_ready";
  }
  if (attachments.has_pdf || attachments.has_full_text) {
    return "pdf_only";
  }
  return "missing";
}

function recordCellValue(record = {}, pendingEdit = null, columnKey = "") {
  if (columnKey === "comments") {
    if (pendingEdit && Object.prototype.hasOwnProperty.call(pendingEdit, "notes")) {
      return String(pendingEdit.notes || "");
    }
    return String(record.comments || record.notes || "");
  }
  if (columnKey === "reason") {
    if (pendingEdit && Object.prototype.hasOwnProperty.call(pendingEdit, "reason")) {
      return String(pendingEdit.reason || "");
    }
    return String(record.reason || "");
  }
  if (pendingEdit?.values && Object.prototype.hasOwnProperty.call(pendingEdit.values, columnKey)) {
    return String(pendingEdit.values[columnKey] || "");
  }
  if (record.custom_values && Object.prototype.hasOwnProperty.call(record.custom_values, columnKey)) {
    return String(record.custom_values[columnKey] || "");
  }
  return String(record[columnKey] || "");
}

function isRuleValueRequired(operator = "") {
  return !["empty", "not_empty"].includes(String(operator || "").toLowerCase());
}

function createRuleDraft(result = {}, seed = {}) {
  const defaultColumnKey = String(
    seed.column_key
    || seed.columnKey
    || result.field_options?.[0]?.key
    || "title"
  );
  return {
    column_key: defaultColumnKey,
    operator: String(seed.operator || "contains"),
    match_value: String(seed.match_value || seed.matchValue || ""),
  };
}

function defaultColumnWidth(columnKey = "") {
  if (columnKey === "abstract_note") {
    return 460;
  }
  if (columnKey === "title") {
    return 280;
  }
  if (columnKey === "comments" || columnKey === "reason") {
    return 220;
  }
  if (columnKey === "citation_text") {
    return 210;
  }
  return 170;
}

function pageInfoText(result = {}) {
  return `Page ${Number(result.page || 1)} / ${Number(result.page_count || 1)}`;
}

function normalizeRowDisplayMode(value = "", fallback = "expanded") {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "collapsed" || mode === "expanded" ? mode : fallback;
}

function normalizeGridZoomPercent(value = "", fallback = 100) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(70, Math.min(150, Math.round(parsed / 5) * 5));
}

export function createScreeningTab(ctx) {
  const panel = ctx.createNode("section", {
    className: "mw-tab-panel mw-screening-panel",
  });

  const state = {
    result: null,
    scopeKey: String(ctx.getSharedScopeKey?.() || ""),
    limit: 25,
    page: 1,
    sortBy: "",
    order: "asc",
    editMode: false,
    dirtyEdits: new Map(),
    visibleColumns: [],
    columnWidths: {},
    rowDisplayMode: "expanded",
    gridZoomPercent: 100,
    valueTemplates: [],
    activeCellKey: "",
    scrollTop: 0,
    scrollLeft: 0,
    editSaveButtonNode: null,
    gridZoomSliderWrapNode: null,
    gridZoomSliderNode: null,
    gridZoomValueNode: null,
    dirtyUiFrame: 0,
    gridZoomPersistTimer: 0,
    renderCleanups: [],
    contextMenu: null,
    modalOverlay: null,
    inlinePopover: null,
    inlinePopoverTimer: 0,
    templatePopup: null,
    templateTarget: null,
    activeResizeColumn: "",
    justResizedColumn: "",
    destroyed: false,
  };

  function createScreeningHelpPopover(registerCleanup, title = "", lines = []) {
    const wrap = ctx.createNode("div", { className: "mw-help-wrap" });
    const helpButton = ctx.createNode("button", {
      className: "mw-help-button",
      textContent: "?",
      attrs: { type: "button", "aria-expanded": "false", "aria-label": title || "More information" },
    });
    const popover = ctx.createNode("div", {
      className: "mw-help-popover",
      attrs: { hidden: "hidden", role: "dialog" },
      children: [
        title
          ? ctx.createNode("div", {
            className: "mw-help-popover-title",
            textContent: title,
          })
          : null,
        ctx.createNode("div", {
          className: "mw-card-stack",
          children: (Array.isArray(lines) ? lines : []).map((line) => ctx.createNode("div", {
            textContent: line,
          })),
        }),
      ].filter(Boolean),
    });
    const close = () => {
      popover.hidden = true;
      helpButton.setAttribute("aria-expanded", "false");
    };
    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (popover.hidden) {
        popover.hidden = false;
        helpButton.setAttribute("aria-expanded", "true");
      }
      else {
        close();
      }
    };
    const onDocumentClick = (event) => {
      if (!wrap.contains(event.target)) {
        close();
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
      }
    };
    helpButton.addEventListener("click", toggle);
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    if (typeof registerCleanup === "function") {
      registerCleanup(() => {
        document.removeEventListener("click", onDocumentClick);
        document.removeEventListener("keydown", onKeyDown);
      });
    }
    wrap.append(helpButton, popover);
    return wrap;
  }

  function hasPendingChanges() {
    return state.dirtyEdits.size > 0;
  }

  function dirtyFieldCount() {
    let total = 0;
    for (const edit of state.dirtyEdits.values()) {
      if (Object.prototype.hasOwnProperty.call(edit, "notes")) {
        total += 1;
      }
      if (Object.prototype.hasOwnProperty.call(edit, "reason")) {
        total += 1;
      }
      total += Object.keys(edit.values || {}).length;
      if (
        Object.prototype.hasOwnProperty.call(edit, "target_collection_key")
        || Object.prototype.hasOwnProperty.call(edit, "target_collection_name")
      ) {
        total += 1;
      }
    }
    return total;
  }

  function dirtyEditFor(itemKey) {
    return state.dirtyEdits.get(String(itemKey || "")) || null;
  }

  function hasDirtyMove(edit = null) {
    return !!edit && (
      Object.prototype.hasOwnProperty.call(edit, "target_collection_key")
      || Object.prototype.hasOwnProperty.call(edit, "target_collection_name")
    );
  }

  function isDirtyColumnEdit(edit = null, columnKey = "") {
    if (!edit) {
      return false;
    }
    if (columnKey === "comments") {
      return Object.prototype.hasOwnProperty.call(edit, "notes");
    }
    if (columnKey === "reason") {
      return Object.prototype.hasOwnProperty.call(edit, "reason");
    }
    return !!(edit.values && Object.prototype.hasOwnProperty.call(edit.values, columnKey));
  }

  function syncEditSaveButton() {
    const node = state.editSaveButtonNode;
    if (!node || !node.isConnected) {
      return;
    }
	    const pendingFieldCount = dirtyFieldCount();
	    node.textContent = state.editMode
	      ? (pendingFieldCount > 0 ? `Save (${pendingFieldCount})` : "Save")
	      : "Edit";
    node.className = `mw-button ${state.editMode ? "mw-screening-save-button" : "mw-screening-edit-button"}`;
  }

  function scheduleDirtyUiSync() {
    if (state.dirtyUiFrame) {
      return;
    }
    state.dirtyUiFrame = window.requestAnimationFrame(() => {
      state.dirtyUiFrame = 0;
      syncEditSaveButton();
    });
  }

  function registerRenderCleanup(cleanup) {
    if (typeof cleanup !== "function") {
      return;
    }
    state.renderCleanups.push(cleanup);
  }

  function runRenderCleanups() {
    const cleanups = Array.isArray(state.renderCleanups) ? state.renderCleanups.splice(0) : [];
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      }
      catch (_error) {}
    });
  }

  function applyGridZoomStyles() {
    panel.style.setProperty("--mw-screening-grid-scale", String(Number(state.gridZoomPercent || 100) / 100));
  }

  function syncGridZoomControls() {
    const normalized = normalizeGridZoomPercent(state.gridZoomPercent, 100);
    if (state.gridZoomSliderWrapNode?.style) {
      const percent = ((normalized - 70) / 80) * 100;
      state.gridZoomSliderWrapNode.style.setProperty("--mw-screening-grid-zoom-percent", `${percent}%`);
    }
    if (state.gridZoomSliderNode) {
      state.gridZoomSliderNode.value = String(normalized);
    }
    if (state.gridZoomValueNode) {
      state.gridZoomValueNode.textContent = `${normalized}%`;
    }
  }

  async function persistGridZoomNow() {
    if (state.gridZoomPersistTimer) {
      window.clearTimeout(state.gridZoomPersistTimer);
      state.gridZoomPersistTimer = 0;
    }
    await persistPreference("grid_zoom_percent", normalizeGridZoomPercent(state.gridZoomPercent, 100));
  }

  function scheduleGridZoomPersist() {
    if (state.gridZoomPersistTimer) {
      window.clearTimeout(state.gridZoomPersistTimer);
    }
    state.gridZoomPersistTimer = window.setTimeout(() => {
      state.gridZoomPersistTimer = 0;
      void persistGridZoomNow().catch((error) => {
        ctx.setStatus(error?.message || String(error), "is-error");
      });
    }, 180);
  }

  function setGridZoomPercent(value, options = {}) {
    state.gridZoomPercent = normalizeGridZoomPercent(value, state.gridZoomPercent || 100);
    applyGridZoomStyles();
    syncGridZoomControls();
    if (!options.persist) {
      return;
    }
    if (options.immediate) {
      void persistGridZoomNow().catch((error) => {
        ctx.setStatus(error?.message || String(error), "is-error");
      });
      return;
    }
    scheduleGridZoomPersist();
  }

  function syncRowDirtyState(itemKey) {
    const key = String(itemKey || "");
    const edit = dirtyEditFor(key);
    const row = panel.querySelector(`[data-screening-row="${key}"]`);
    row?.classList.toggle("is-dirty", !!edit);
    const actionsCell = panel.querySelector(`[data-screening-actions-row="${key}"]`);
    actionsCell?.classList.toggle("is-edited", hasDirtyMove(edit));
  }

  function syncCellDirtyState(itemKey, columnKey) {
    const key = `${String(itemKey || "")}::${String(columnKey || "")}`;
    const edit = dirtyEditFor(itemKey);
    const cell = panel.querySelector(`[data-screening-cell="${key}"]`);
    cell?.classList.toggle("is-edited", isDirtyColumnEdit(edit, columnKey));
    syncRowDirtyState(itemKey);
  }

  function ensureDirtyEdit(itemKey) {
    const key = String(itemKey || "");
    let edit = state.dirtyEdits.get(key);
    if (!edit) {
      edit = {
        item_key: key,
        values: {},
      };
      state.dirtyEdits.set(key, edit);
    }
    return edit;
  }

  function pruneDirtyEdit(itemKey) {
    const key = String(itemKey || "");
    const edit = state.dirtyEdits.get(key);
    if (!edit) {
      return;
    }
    const hasValues = edit.values && Object.keys(edit.values).length > 0;
    const hasNotes = Object.prototype.hasOwnProperty.call(edit, "notes");
    const hasReason = Object.prototype.hasOwnProperty.call(edit, "reason");
    const hasMove = !!String(edit.target_collection_key || "").trim() || !!String(edit.target_collection_name || "").trim();
    if (!hasValues && !hasNotes && !hasReason && !hasMove) {
      state.dirtyEdits.delete(key);
    }
  }

  function queueValueEdit(itemKey, columnKey, value) {
    const edit = ensureDirtyEdit(itemKey);
    const nextValue = String(value || "");
    const record = (Array.isArray(state.result?.records) ? state.result.records : [])
      .find((entry) => String(entry.item_key || "") === String(itemKey || "")) || null;
    const originalValue = String(recordCellValue(record || {}, null, columnKey) || "");
    if (columnKey === "comments") {
      if (nextValue === originalValue) {
        delete edit.notes;
      }
      else {
        edit.notes = nextValue;
      }
    }
    else if (columnKey === "reason") {
      if (nextValue === originalValue) {
        delete edit.reason;
      }
      else {
        edit.reason = nextValue;
      }
    }
    else {
      if (nextValue === originalValue) {
        delete edit.values[columnKey];
      }
      else {
        edit.values[columnKey] = nextValue;
      }
    }
    pruneDirtyEdit(itemKey);
    syncCellDirtyState(itemKey, columnKey);
    scheduleDirtyUiSync();
  }

  function queueMoveEdit(itemKey, collectionKey, collectionName) {
    const nextKey = String(collectionKey || "");
    const nextName = String(collectionName || "");
    const record = (Array.isArray(state.result?.records) ? state.result.records : [])
      .find((entry) => String(entry.item_key || "") === String(itemKey || "")) || null;
    const currentKey = String(record?.review_collection_key || record?.decision_target_collection_key || "");
    if (nextKey && nextKey === currentKey) {
      const existing = state.dirtyEdits.get(String(itemKey || ""));
      if (existing) {
        delete existing.target_collection_key;
        delete existing.target_collection_name;
        pruneDirtyEdit(itemKey);
      }
      syncRowDirtyState(itemKey);
      scheduleDirtyUiSync();
      return;
    }
    const edit = ensureDirtyEdit(itemKey);
    edit.target_collection_key = nextKey;
    edit.target_collection_name = nextName;
    pruneDirtyEdit(itemKey);
    syncRowDirtyState(itemKey);
    scheduleDirtyUiSync();
  }

  function captureGridPosition() {
    const scrollNode = panel.querySelector("[data-screening-grid-scroll='true']");
    if (!scrollNode) {
      return;
    }
    state.scrollTop = scrollNode.scrollTop || 0;
    state.scrollLeft = scrollNode.scrollLeft || 0;
  }

  function restoreGridPosition() {
    const scrollNode = panel.querySelector("[data-screening-grid-scroll='true']");
    if (!scrollNode) {
      return;
    }
    scrollNode.scrollTop = state.scrollTop || 0;
    scrollNode.scrollLeft = state.scrollLeft || 0;
  }

  function closeTemplatePopup() {
    if (!state.templatePopup) {
      return;
    }
    state.templatePopup.style.display = "none";
    state.templateTarget = null;
  }

  function closeContextMenu() {
    if (!state.contextMenu) {
      return;
    }
    state.contextMenu.style.display = "none";
  }

  function closeInlinePopover() {
    if (state.inlinePopoverTimer) {
      window.clearTimeout(state.inlinePopoverTimer);
      state.inlinePopoverTimer = 0;
    }
    if (!state.inlinePopover) {
      return;
    }
    if (typeof state.inlinePopover.cleanup === "function") {
      try {
        state.inlinePopover.cleanup();
      }
      catch (_error) {}
    }
    state.inlinePopover.node?.remove?.();
    state.inlinePopover = null;
  }

  function positionInlinePopover(popover, anchor) {
    if (!popover || !anchor?.isConnected) {
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    popover.style.left = "8px";
    popover.style.top = "8px";
    const popRect = popover.getBoundingClientRect();
    const gutter = 8;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    let left = anchorRect.left;
    if (left + popRect.width > viewWidth - gutter) {
      left = Math.max(gutter, viewWidth - popRect.width - gutter);
    }
    let top = anchorRect.bottom + 8;
    if (top + popRect.height > viewHeight - gutter) {
      top = anchorRect.top - popRect.height - 8;
    }
    if (top < gutter) {
      top = gutter;
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function openInlinePopover(anchor, content, options = {}) {
    closeInlinePopover();
    const popover = ctx.createNode("div", {
      className: `mw-screening-inline-popover${options.className ? ` ${options.className}` : ""}`,
    });
    if (Array.isArray(content)) {
      popover.append(...content.filter(Boolean));
    }
    else if (content) {
      popover.append(content);
    }
    popover.addEventListener("pointerdown", (event) => event.stopPropagation());
    popover.addEventListener("mousedown", (event) => event.stopPropagation());
    popover.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(popover);
    positionInlinePopover(popover, anchor);
    window.requestAnimationFrame(() => positionInlinePopover(popover, anchor));
    state.inlinePopover = {
      node: popover,
      anchor,
      cleanup: options.cleanup || null,
    };
    if (options.autoCloseMs) {
      state.inlinePopoverTimer = window.setTimeout(() => {
        closeInlinePopover();
      }, Number(options.autoCloseMs) || 2200);
    }
    return popover;
  }

  function openTransientNotice(anchor, message) {
    return openInlinePopover(anchor, ctx.createNode("div", {
      className: "mw-screening-inline-notice",
      textContent: message,
    }), {
      className: "is-notice",
      autoCloseMs: 2600,
    });
  }

  function closeModal() {
    closeInlinePopover();
    if (!state.modalOverlay) {
      return;
    }
    const overlay = state.modalOverlay;
    if (typeof overlay.__screeningCleanup === "function") {
      try {
        overlay.__screeningCleanup();
      }
      catch (_error) {}
    }
    overlay.remove();
    state.modalOverlay = null;
  }

  function mountModal(title, bodyNode, footerButtons = [], options = {}) {
    closeModal();
    const titleNode = ctx.createNode("div", {
      className: "mw-screening-modal-title",
      textContent: title,
    });
    const footer = ctx.createNode("div", {
      className: "mw-screening-modal-footer",
      children: footerButtons,
    });
    const modal = ctx.createNode("div", {
      className: `mw-screening-modal${options.wide ? " is-wide" : ""}`,
      children: [
        ctx.createNode("div", {
          className: "mw-screening-modal-header",
          children: [
            titleNode,
            button(ctx, "Close", { attrs: { "data-screening-modal-close": "true" } }),
          ],
        }),
        ctx.createNode("div", {
          className: `mw-screening-modal-body${options.bodyClassName ? ` ${options.bodyClassName}` : ""}`,
          children: [bodyNode],
        }),
        footer,
      ],
    });
    const overlay = ctx.createNode("div", {
      className: "mw-screening-modal-overlay",
      children: [modal],
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && options.closeOnOverlay !== false) {
        closeModal();
      }
    });
    modal.querySelector("[data-screening-modal-close='true']")?.addEventListener("click", () => closeModal());
    document.body.appendChild(overlay);
    state.modalOverlay = overlay;
    return { overlay, modal };
  }

  async function persistPreference(key, value) {
    await ctx.invoke("screening.preferences.save", {
      key,
      value,
    });
  }

  async function persistSortPreference(sortBy = "", order = "asc") {
    await persistPreference("sort_by", String(sortBy || "").trim() || "item_key");
    await persistPreference("sort_order", String(order || "").trim() === "desc" ? "desc" : "asc");
  }

  async function loadValueTemplates() {
    const payload = await ctx.invoke("screening.valueTemplates.list", {});
    state.valueTemplates = Array.isArray(payload?.values) ? payload.values.map((entry) => normalizeText(entry)).filter(Boolean) : [];
  }

  async function refreshState(options = {}) {
    if (state.destroyed) {
      return;
    }
    if (!options.quiet) {
      ctx.setStatus("Loading Screening workspace...");
    }
    try {
      if (options.captureScroll !== false) {
        captureGridPosition();
      }
      const payload = {
        limit: options.limit || state.limit || 25,
        page: options.page || state.page || 1,
      };
      const requestedSortBy = String(options.sortBy || state.sortBy || "").trim();
      if (requestedSortBy) {
        payload.sort_by = requestedSortBy;
      }
      if (requestedSortBy || options.order) {
        payload.order = options.order || state.order || "asc";
      }
      const scopeKey = Object.prototype.hasOwnProperty.call(options, "scopeKey")
        ? String(options.scopeKey || "")
        : String(state.scopeKey || "");
      if (scopeKey) {
        payload.collection_key = scopeKey;
      }
      const result = await ctx.invoke("screening.search", payload);
      state.result = result;
      state.scopeKey = String(scopeKey || result?.scope?.collection_key || "");
      state.limit = Number(result?.limit || payload.limit || 25) || 25;
      state.page = Number(result?.page || payload.page || 1) || 1;
      state.sortBy = String(result?.sort_by || payload.sort_by || "item_key");
      state.order = String(result?.order || payload.order || "asc");
      state.rowDisplayMode = normalizeRowDisplayMode(result?.row_display_mode, state.rowDisplayMode || "expanded");
      state.gridZoomPercent = normalizeGridZoomPercent(result?.grid_zoom_percent, state.gridZoomPercent || 100);
      if (!state.visibleColumns.length) {
        state.visibleColumns = defaultVisibleColumnKeys(result);
      }
      if (!Object.keys(state.columnWidths || {}).length && result?.column_widths && typeof result.column_widths === "object") {
        state.columnWidths = Object.assign({}, result.column_widths);
      }
      if (!state.valueTemplates.length) {
        await loadValueTemplates();
      }
      applyGridZoomStyles();
      render();
      restoreGridPosition();
      ctx.setStatus("Screening ready.", "is-ready");
    }
    catch (error) {
      const message = String(error?.message || error || "");
      if (
        options.allowScopeReset !== false
        && state.scopeKey
        && message.includes("Requested subcollection scope was not found inside the current project collection tree.")
      ) {
        state.scopeKey = "";
        await Promise.resolve(ctx.rememberScopeKey?.("")).catch(() => {});
        return await refreshState(Object.assign({}, options, {
          scopeKey: "",
          allowScopeReset: false,
        }));
      }
      render();
      ctx.setStatus(error?.message || String(error), "is-error");
    }
  }

  function allVisibleColumns() {
    const keys = Array.isArray(state.visibleColumns) && state.visibleColumns.length
      ? state.visibleColumns.slice()
      : defaultVisibleColumnKeys(state.result || {});
    return keys.filter((key, index) => !!key && keys.indexOf(key) === index);
  }

  async function saveEdits() {
    if (!hasPendingChanges()) {
      state.editMode = false;
      render();
      ctx.setStatus("Edit mode closed.", "is-ready");
      return true;
    }
    captureGridPosition();
    ctx.setStatus("Saving screening changes...");
    const edits = Array.from(state.dirtyEdits.values()).map((entry) => cloneJSON(entry));
    try {
      await ctx.invoke("screening.saveEdits", {
        edits,
        limit: state.limit,
        page: state.page,
        sort_by: state.sortBy,
        order: state.order,
        ...(state.scopeKey ? { collection_key: state.scopeKey } : {}),
      });
      state.dirtyEdits.clear();
      state.editMode = false;
      await refreshState({ quiet: true });
      ctx.setStatus("Screening changes saved.", "is-ready");
      return true;
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
      return false;
    }
  }

  function promptUnsavedChanges(reason = "") {
    return new Promise((resolve) => {
      const body = ctx.createNode("div", {
        className: "mw-panel-stack",
        children: [
          ctx.createNode("div", {
            textContent: "You have unsaved screening changes.",
          }),
          ctx.createNode("div", {
            className: "mw-note",
            textContent: reason ? `Before ${reason}, choose whether to save or discard them.` : "Choose whether to save or discard them.",
          }),
        ],
      });
      const saveButton = button(ctx, "Save", { className: "mw-button primary" });
      const discardButton = button(ctx, "Discard");
      const cancelButton = button(ctx, "Cancel");
      mountModal("Unsaved Changes", body, [cancelButton, discardButton, saveButton]);
      cancelButton.addEventListener("click", () => {
        closeModal();
        resolve("cancel");
      });
      discardButton.addEventListener("click", () => {
        closeModal();
        resolve("discard");
      });
      saveButton.addEventListener("click", () => {
        closeModal();
        resolve("save");
      });
    });
  }

  async function confirmPendingChanges(reason = "") {
    if (!hasPendingChanges()) {
      return true;
    }
    const choice = await promptUnsavedChanges(reason);
    if (choice === "cancel") {
      return false;
    }
    if (choice === "discard") {
      state.dirtyEdits.clear();
      state.editMode = false;
      render();
      ctx.setStatus("Unsaved changes discarded.", "is-ready");
      return true;
    }
    if (choice === "save") {
      return await saveEdits();
    }
    return false;
  }

  async function changeScope(nextScopeKey) {
    if (!(await confirmPendingChanges("changing scope"))) {
      render();
      return;
    }
    state.scopeKey = String(nextScopeKey || "");
    try {
      await Promise.resolve(ctx.rememberScopeKey?.(state.scopeKey || ""));
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
    }
    state.page = 1;
    state.scrollTop = 0;
    state.scrollLeft = 0;
    await refreshState({ scopeKey: state.scopeKey, page: 1 });
  }

  async function changePage(nextPage) {
    const parsed = Math.max(1, Number(nextPage || 1) || 1);
    if (parsed === state.page) {
      render();
      return;
    }
    if (!(await confirmPendingChanges("changing page"))) {
      render();
      return;
    }
    state.page = parsed;
    await refreshState({ page: parsed });
  }

  async function changeLimit(nextLimit) {
    const parsed = Math.max(10, Number(nextLimit || 25) || 25);
    if (!(await confirmPendingChanges("changing rows per page"))) {
      render();
      return;
    }
    state.limit = parsed;
    state.page = 1;
    await refreshState({ limit: parsed, page: 1 });
  }

  async function refreshScreening() {
    if (!(await confirmPendingChanges("refreshing screening"))) {
      render();
      return;
    }
    await refreshState();
  }

  function currentRowDisplayMode() {
    return state.editMode ? "expanded" : normalizeRowDisplayMode(state.rowDisplayMode, "expanded");
  }

  async function setRowDisplayMode(nextMode) {
    const normalized = normalizeRowDisplayMode(nextMode, state.rowDisplayMode || "expanded");
    if (normalized === state.rowDisplayMode) {
      render();
      return;
    }
    captureGridPosition();
    state.rowDisplayMode = normalized;
    render();
    restoreGridPosition();
    try {
      await persistPreference("row_display_mode", normalized);
      ctx.setStatus(
        normalized === "collapsed" ? "Screening rows collapsed." : "Screening rows expanded.",
        "is-ready",
      );
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
    }
  }

  function buildScrollableOptionPicker(options = [], initialValue = "", registerCleanup = null, config = {}) {
    let currentValue = String(initialValue || options?.[0]?.key || "");
    let isOpen = false;
    let query = "";
    let shouldFocusSearch = false;
    let isDisabled = false;
    const root = ctx.createNode("div", {
      className: `mw-screening-option-picker${config.rootClassName ? ` ${config.rootClassName}` : ""}`,
    });
    const trigger = button(ctx, "", {
      className: `mw-screening-option-picker-trigger${config.triggerClassName ? ` ${config.triggerClassName}` : ""}`,
      attrs: {
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      },
    });
    const menu = ctx.createNode("div", {
      className: `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}`,
      attrs: { role: "listbox" },
    });
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = String(config.searchPlaceholder || "Filter columns...");
    searchInput.className = "mw-screening-option-picker-search";
    const head = ctx.createNode("div", {
      className: "mw-screening-option-picker-head",
      children: [searchInput],
    });
    const meta = ctx.createNode("div", {
      className: "mw-screening-option-picker-meta",
    });
    const list = ctx.createNode("div", {
      className: "mw-screening-option-picker-list",
    });
    document.body.appendChild(menu);
    head.append(meta);
    menu.append(head, list);

    function selectedOption() {
      return options.find((entry) => String(entry.key || "") === String(currentValue || "")) || options[0] || null;
    }

    function filteredOptions() {
      const normalizedQuery = String(query || "").trim().toLowerCase();
      if (!normalizedQuery) {
        return options.slice();
      }
      return options.filter((entry) => {
        const label = String(entry?.label || "").toLowerCase();
        const key = String(entry?.key || "").toLowerCase();
        return label.includes(normalizedQuery) || key.includes(normalizedQuery);
      });
    }

    function positionMenu() {
      if (!isOpen || !trigger.isConnected || !menu.isConnected) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      menu.style.left = "8px";
      menu.style.top = "8px";
      menu.style.minWidth = `${Math.max(220, Math.round(rect.width))}px`;
      const menuRect = menu.getBoundingClientRect();
      let left = rect.left;
      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }
      let top = rect.bottom + 4;
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - 4);
      }
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    }

    function closePicker() {
      if (!isOpen) {
        return;
      }
      isOpen = false;
      shouldFocusSearch = false;
      renderPicker();
    }

    function renderMenuOptions() {
      const visibleOptions = filteredOptions();
      meta.textContent = typeof config.metaText === "function"
        ? String(config.metaText(visibleOptions.length, options.length) || "")
        : `${visibleOptions.length} of ${options.length} ${String(config.metaLabel || "columns")}`;
      list.replaceChildren(...visibleOptions.map((entry) => {
        const key = String(entry.key || "");
        const item = ctx.createNode("button", {
          className: `mw-screening-option-picker-item${key === currentValue ? " is-selected" : ""}`,
          attrs: {
            type: "button",
            role: "option",
            "aria-selected": key === currentValue ? "true" : "false",
            disabled: isDisabled ? "true" : null,
          },
          children: [
            ctx.createNode("span", {
              className: "mw-screening-option-picker-item-label",
              textContent: entry.label || key,
            }),
            config.showKey !== false && key && String(entry.label || "").trim() !== key
              ? ctx.createNode("span", {
                  className: "mw-screening-option-picker-item-key",
                  textContent: key,
                })
              : null,
          ].filter(Boolean),
        });
        item.addEventListener("click", () => {
          if (isDisabled) {
            return;
          }
          const changed = key !== currentValue;
          currentValue = key;
          closePicker();
          if (changed && typeof config.onChange === "function") {
            void config.onChange(currentValue);
          }
        });
        return item;
      }));
      if (!visibleOptions.length) {
        list.appendChild(ctx.createNode("div", {
          className: "mw-screening-option-picker-empty",
          textContent: String(config.emptyText || "No columns match this filter."),
        }));
      }
    }

    function renderPicker() {
      const selected = selectedOption();
      trigger.textContent = selected?.label || selected?.key || "Choose";
      trigger.className = `mw-button mw-screening-option-picker-trigger${config.triggerClassName ? ` ${config.triggerClassName}` : ""}${isOpen ? " is-open" : ""}`;
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      trigger.disabled = isDisabled;
      searchInput.disabled = isDisabled;
      menu.className = `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}${isOpen ? " is-open" : ""}`;
      renderMenuOptions();
      if (isOpen) {
        window.requestAnimationFrame(() => {
          positionMenu();
          if (shouldFocusSearch) {
            shouldFocusSearch = false;
            searchInput.focus();
            searchInput.select();
          }
        });
      }
    }

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDisabled) {
        return;
      }
      if (!isOpen) {
        query = "";
        searchInput.value = "";
        shouldFocusSearch = true;
      }
      isOpen = !isOpen;
      renderPicker();
    });

    searchInput.addEventListener("input", () => {
      query = String(searchInput.value || "");
      renderMenuOptions();
      if (isOpen) {
        window.requestAnimationFrame(() => positionMenu());
      }
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        trigger.focus();
      }
      else if (event.key === "Enter") {
        const first = filteredOptions()[0];
        if (first?.key) {
          event.preventDefault();
          const changed = String(first.key || "") !== currentValue;
          currentValue = String(first.key || "");
          closePicker();
          if (changed && typeof config.onChange === "function") {
            void config.onChange(currentValue);
          }
        }
      }
    });

    const outsideHandler = (event) => {
      if (!root.contains(event.target) && !menu.contains(event.target)) {
        closePicker();
      }
    };
    document.addEventListener("mousedown", outsideHandler, true);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    if (typeof registerCleanup === "function") {
      registerCleanup(() => {
        document.removeEventListener("mousedown", outsideHandler, true);
        window.removeEventListener("resize", positionMenu);
        window.removeEventListener("scroll", positionMenu, true);
        menu.remove();
      });
    }

    root.append(trigger);
    renderPicker();
    return {
      node: root,
      getValue: () => currentValue,
      setValue: (value) => {
        currentValue = String(value || "");
        renderPicker();
      },
      setDisabled: (nextDisabled) => {
        isDisabled = !!nextDisabled;
        if (isDisabled) {
          closePicker();
        }
        renderPicker();
      },
      close: closePicker,
    };
  }

  function buildMultiOptionPicker(options = [], initialValues = [], registerCleanup = null, config = {}) {
    const root = ctx.createNode("div", {
      className: `mw-screening-option-picker${config.rootClassName ? ` ${config.rootClassName}` : ""}`,
    });
    const trigger = ctx.createNode("button", {
      className: `mw-button mw-screening-option-picker-trigger${config.triggerClassName ? ` ${config.triggerClassName}` : ""}`,
      attrs: {
        type: "button",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      },
    });
    const menu = ctx.createNode("div", {
      className: `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}`,
      attrs: {
        role: "listbox",
        "aria-multiselectable": "true",
      },
    });
    let selectedKeys = uniqueColumnKeys(initialValues);
    let query = "";
    let isOpen = false;
    let shouldFocusSearch = false;
    let isDisabled = false;
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = config.searchPlaceholder || "Filter columns";
    searchInput.className = "mw-screening-option-picker-search";
    const clearButton = button(ctx, "Clear all", {
      className: "mw-button mw-screening-option-picker-clear",
    });
    const meta = ctx.createNode("div", {
      className: "mw-screening-option-picker-meta",
    });
    const metaRow = ctx.createNode("div", {
      className: "mw-screening-option-picker-meta-row",
      children: [meta, clearButton],
    });
    const head = ctx.createNode("div", {
      className: "mw-screening-option-picker-head",
      children: [searchInput, metaRow],
    });
    const list = ctx.createNode("div", {
      className: "mw-screening-option-picker-list",
    });
    document.body.appendChild(menu);
    menu.append(head, list);

    function filteredOptions() {
      const normalizedQuery = String(query || "").trim().toLowerCase();
      if (!normalizedQuery) {
        return options.slice();
      }
      return options.filter((entry) => {
        const label = String(entry?.label || "").toLowerCase();
        const key = String(entry?.key || "").toLowerCase();
        return label.includes(normalizedQuery) || key.includes(normalizedQuery);
      });
    }

    function selectedOptions() {
      return options.filter((entry) => selectedKeys.includes(String(entry?.key || "")));
    }

    function selectionSummary() {
      const selected = selectedOptions();
      if (!selected.length) {
        return String(config.placeholder || "Choose columns");
      }
      if (selected.length === 1) {
        return selected[0]?.label || selected[0]?.key || "1 selected";
      }
      if (selected.length === 2) {
        return selected
          .map((entry) => entry?.label || entry?.key || "")
          .filter(Boolean)
          .join(", ");
      }
      const first = selected[0]?.label || selected[0]?.key || "";
      const second = selected[1]?.label || selected[1]?.key || "";
      return [first, second].filter(Boolean).join(", ") + ` +${selected.length - 2}`;
    }

    function positionMenu() {
      if (!isOpen || !trigger.isConnected || !menu.isConnected) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      menu.style.left = "8px";
      menu.style.top = "8px";
      menu.style.minWidth = `${Math.max(260, Math.round(rect.width))}px`;
      const menuRect = menu.getBoundingClientRect();
      let left = rect.left;
      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }
      let top = rect.bottom + 4;
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - 4);
      }
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    }

    function closePicker() {
      if (!isOpen) {
        return;
      }
      isOpen = false;
      shouldFocusSearch = false;
      renderPicker();
    }

    function toggleKey(key = "") {
      const normalizedKey = String(key || "");
      if (!normalizedKey) {
        return;
      }
      if (selectedKeys.includes(normalizedKey)) {
        selectedKeys = removeColumnKey(selectedKeys, normalizedKey);
      }
      else {
        selectedKeys = insertColumnKey(selectedKeys, normalizedKey, selectedKeys.length);
      }
      renderPicker();
      if (typeof config.onChange === "function") {
        void config.onChange(selectedKeys.slice());
      }
    }

    function renderMenuOptions() {
      const visibleOptions = filteredOptions();
      meta.textContent = `${selectedKeys.length} selected · ${visibleOptions.length} of ${options.length} ${String(config.metaLabel || "columns")}`;
      clearButton.disabled = isDisabled || !selectedKeys.length;
      list.replaceChildren(...visibleOptions.map((entry) => {
        const key = String(entry.key || "");
        const selected = selectedKeys.includes(key);
        const item = ctx.createNode("button", {
          className: `mw-screening-option-picker-item${selected ? " is-selected" : ""}`,
          attrs: {
            type: "button",
            role: "option",
            "aria-selected": selected ? "true" : "false",
            disabled: isDisabled ? "true" : null,
          },
          children: [
            ctx.createNode("span", {
              className: `mw-screening-option-picker-check${selected ? " is-selected" : ""}`,
              attrs: { "aria-hidden": "true" },
              textContent: selected ? "✓" : "",
            }),
            ctx.createNode("span", {
              className: "mw-screening-option-picker-item-copy",
              children: [
                ctx.createNode("span", {
                  className: "mw-screening-option-picker-item-label",
                  textContent: entry.label || key,
                }),
                config.showKey !== false && key && String(entry.label || "").trim() !== key
                  ? ctx.createNode("span", {
                      className: "mw-screening-option-picker-item-key",
                      textContent: key,
                    })
                  : null,
              ].filter(Boolean),
            }),
          ].filter(Boolean),
        });
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isDisabled) {
            return;
          }
          toggleKey(key);
        });
        return item;
      }));
      if (!visibleOptions.length) {
        list.appendChild(ctx.createNode("div", {
          className: "mw-screening-option-picker-empty",
          textContent: String(config.emptyText || "No columns match this filter."),
        }));
      }
    }

    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDisabled || !selectedKeys.length) {
        return;
      }
      selectedKeys = [];
      renderPicker();
      if (typeof config.onChange === "function") {
        void config.onChange(selectedKeys.slice());
      }
    });

    function renderPicker() {
      trigger.textContent = selectionSummary();
      trigger.className = `mw-button mw-screening-option-picker-trigger${config.triggerClassName ? ` ${config.triggerClassName}` : ""}${isOpen ? " is-open" : ""}`;
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      trigger.disabled = isDisabled;
      searchInput.disabled = isDisabled;
      menu.className = `mw-screening-option-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}${isOpen ? " is-open" : ""}`;
      renderMenuOptions();
      if (isOpen) {
        window.requestAnimationFrame(() => {
          positionMenu();
          if (shouldFocusSearch) {
            shouldFocusSearch = false;
            searchInput.focus();
            searchInput.select();
          }
        });
      }
    }

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDisabled) {
        return;
      }
      if (!isOpen) {
        query = "";
        searchInput.value = "";
        shouldFocusSearch = true;
      }
      isOpen = !isOpen;
      renderPicker();
    });

    searchInput.addEventListener("input", () => {
      query = String(searchInput.value || "");
      renderMenuOptions();
      if (isOpen) {
        window.requestAnimationFrame(() => positionMenu());
      }
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        trigger.focus();
      }
      else if (event.key === "Enter") {
        const first = filteredOptions()[0];
        if (first?.key) {
          event.preventDefault();
          toggleKey(String(first.key || ""));
        }
      }
    });

    const outsideHandler = (event) => {
      if (!root.contains(event.target) && !menu.contains(event.target)) {
        closePicker();
      }
    };
    document.addEventListener("mousedown", outsideHandler, true);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    if (typeof registerCleanup === "function") {
      registerCleanup(() => {
        document.removeEventListener("mousedown", outsideHandler, true);
        window.removeEventListener("resize", positionMenu);
        window.removeEventListener("scroll", positionMenu, true);
        menu.remove();
      });
    }

    root.append(trigger);
    renderPicker();
    return {
      node: root,
      getValues: () => selectedKeys.slice(),
      setValues: (values) => {
        selectedKeys = uniqueColumnKeys(values);
        renderPicker();
      },
      setDisabled: (nextDisabled) => {
        isDisabled = !!nextDisabled;
        if (isDisabled) {
          closePicker();
        }
        renderPicker();
      },
      close: closePicker,
    };
  }

  function buildRuleRow(result, draft = {}, options = {}) {
    const row = ctx.createNode("div", {
      className: "mw-screening-rule-row",
    });
    const fieldOptions = Array.isArray(result.field_options) ? result.field_options : [];
    const fieldPicker = buildScrollableOptionPicker(
      fieldOptions.map((option) => ({
        key: option.key,
        label: option.label,
      })),
      String(draft.column_key || fieldOptions?.[0]?.key || "title"),
      options.registerCleanup,
    );

    const operatorSelect = document.createElement("select");
    [
      ["contains", "Contains"],
      ["not_contains", "Does not contain"],
      ["equals", "Equals"],
      ["not_equals", "Does not equal"],
      ["gt", "Greater than"],
      ["gte", "Greater than or equal"],
      ["lt", "Less than"],
      ["lte", "Less than or equal"],
      ["empty", "Is empty"],
      ["not_empty", "Is not empty"],
    ].forEach(([value, label]) => operatorSelect.appendChild(ctx.createNode("option", {
      attrs: { value },
      textContent: label,
    })));
    operatorSelect.value = String(draft.operator || "contains");

    const matchInput = document.createElement("input");
    matchInput.type = "text";
    matchInput.placeholder = "Match value";
    matchInput.value = String(draft.match_value || "");
    const removeButton = button(ctx, "Remove");

    const syncMatchState = () => {
      matchInput.disabled = !isRuleValueRequired(operatorSelect.value);
      if (matchInput.disabled) {
        matchInput.value = "";
      }
    };
    syncMatchState();
    operatorSelect.addEventListener("change", syncMatchState);
    removeButton.addEventListener("click", () => {
      row.remove();
      if (typeof options.onRemove === "function") {
        options.onRemove();
      }
    });

    row.append(
      field(ctx, "Column", fieldPicker.node),
      field(ctx, "Operator", operatorSelect),
      field(ctx, "Value", matchInput),
      ctx.createNode("div", {
        className: "mw-screening-rule-row-actions",
        children: [removeButton],
      }),
    );
    row.collect = () => ({
      column_key: String(fieldPicker.getValue() || ""),
      operator: String(operatorSelect.value || "contains"),
      match_value: isRuleValueRequired(operatorSelect.value) ? String(matchInput.value || "") : "",
    });
    return row;
  }

  function openBulkActionsModal(options = {}) {
    const result = state.result || {};
    const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
    const scopeSelect = document.createElement("select");
    scopeSelect.setAttribute("aria-label", "Scope");
    for (const entry of scopes) {
      scopeSelect.appendChild(ctx.createNode("option", {
        attrs: { value: entry.collection_key || "" },
        textContent: entry.label || entry.collection_name || entry.collection_key || "",
      }));
    }
    const modalScopeKey = scopes.some((entry) => String(entry.collection_key || "") === String(state.scopeKey || ""))
      ? String(state.scopeKey || "")
      : String(scopes[0]?.collection_key || "");
    scopeSelect.value = modalScopeKey;
    const presetAction = String(options.actionKind || "move");
    const actionSelect = document.createElement("select");
    actionSelect.appendChild(ctx.createNode("option", {
      attrs: { value: "move" },
      textContent: "Move items",
    }));
    actionSelect.appendChild(ctx.createNode("option", {
      attrs: { value: "filter_copy" },
      textContent: "Create a filter",
    }));
    actionSelect.value = presetAction === "filter_copy" ? "filter_copy" : "move";

    const matchModeSelect = document.createElement("select");
    matchModeSelect.appendChild(ctx.createNode("option", { attrs: { value: "and" }, textContent: "AND" }));
    matchModeSelect.appendChild(ctx.createNode("option", { attrs: { value: "or" }, textContent: "OR" }));
    matchModeSelect.value = "and";

    const targetSelect = document.createElement("select");
    for (const target of Array.isArray(result.decision_targets) ? result.decision_targets : []) {
      targetSelect.appendChild(ctx.createNode("option", {
        attrs: { value: target.collection_key || "" },
        textContent: target.label || target.collection_name || target.collection_key || "",
      }));
    }
    const filterNameInput = document.createElement("input");
    filterNameInput.type = "text";
    filterNameInput.placeholder = "(e.g. High confidence)";
    const reasonInput = document.createElement("textarea");
    reasonInput.rows = 3;
    reasonInput.placeholder = "Optional reason saved with the move";
    const notesInput = document.createElement("textarea");
    notesInput.rows = 3;
    notesInput.placeholder = "Optional notes saved with the move";

    const rulesContainer = ctx.createNode("div", { className: "mw-screening-bulk-rules-list" });
    const addRuleButton = button(ctx, "Add rule");
    const initialRules = Array.isArray(options.rules) && options.rules.length
      ? options.rules.map((rule) => createRuleDraft(result, rule))
      : [createRuleDraft(result, options.presetColumnKey ? { column_key: options.presetColumnKey } : {})];

    const cleanupFns = new Set();
    function registerCleanup(cleanup) {
      if (typeof cleanup === "function") {
        cleanupFns.add(cleanup);
      }
    }

    function addRuleRow(seed = {}) {
      const row = buildRuleRow(result, seed, { registerCleanup });
      rulesContainer.appendChild(row);
      return row;
    }
    initialRules.forEach((rule) => addRuleRow(rule));
    addRuleButton.addEventListener("click", () => addRuleRow(createRuleDraft(result, {})));

    const moveFields = ctx.createNode("div", {
      className: "mw-screening-bulk-modal-section",
      children: [
        field(ctx, "Target subcollection", targetSelect),
        field(ctx, "Reason", reasonInput, { full: true }),
        field(ctx, "Notes", notesInput, { full: true }),
      ],
    });
    const filterFields = ctx.createNode("div", {
      className: "mw-screening-bulk-modal-section",
      children: [
        field(ctx, "Filter name", filterNameInput),
        ctx.createNode("div", {
          className: "mw-note",
          textContent: "Create a filter copies matching items into Filters without moving them from the current scope.",
        }),
      ],
    });
    const actionFields = ctx.createNode("div", { className: "mw-screening-bulk-modal-section" });

    function syncActionFields() {
      const isFilter = actionSelect.value === "filter_copy";
      actionFields.replaceChildren(isFilter ? filterFields : moveFields);
      submitButton.textContent = isFilter ? "Create Filter" : "Move Items";
    }

    const body = ctx.createNode("div", {
      className: "mw-screening-bulk-modal-layout",
      children: [
        ctx.createNode("div", {
          className: "mw-grid",
          children: [
            field(ctx, "Scope", scopeSelect),
            field(ctx, "Action", actionSelect),
            field(ctx, "Combine rules", matchModeSelect),
          ],
        }),
        actionFields,
        ctx.createNode("div", {
          className: "mw-screening-bulk-rules",
          children: [
            ctx.createNode("div", {
              className: "mw-screening-summary-head",
              children: [
                ctx.createNode("h3", { textContent: "Rules" }),
                addRuleButton,
              ],
            }),
            rulesContainer,
          ],
        }),
      ],
    });

    const cancelButton = button(ctx, "Cancel");
    const submitButton = button(ctx, "Move Items", { className: "mw-button primary" });
    const { overlay } = mountModal(options.title || "Bulk Actions", body, [cancelButton, submitButton], { wide: true });
    overlay.__screeningCleanup = () => {
      for (const cleanup of cleanupFns) {
        try {
          cleanup();
        }
        catch (_error) {}
      }
      cleanupFns.clear();
    };
    syncActionFields();
    cancelButton.addEventListener("click", () => closeModal());
    actionSelect.addEventListener("change", syncActionFields);

    submitButton.addEventListener("click", async () => {
      const rules = Array.from(rulesContainer.children)
        .map((row) => typeof row.collect === "function" ? row.collect() : null)
        .filter(Boolean)
        .filter((rule) => String(rule.column_key || "").trim() && String(rule.operator || "").trim());
      if (!rules.length) {
        ctx.setStatus("Add at least one rule.", "is-error");
        return;
      }
      if (actionSelect.value === "filter_copy" && !String(filterNameInput.value || "").trim()) {
        ctx.setStatus("Filter name is required.", "is-error");
        return;
      }
      if (actionSelect.value === "move" && !String(targetSelect.value || "").trim()) {
        ctx.setStatus("Choose a target subcollection.", "is-error");
        return;
      }
      closeModal();
      ctx.setStatus(actionSelect.value === "filter_copy"
        ? "Creating filter..."
        : "Applying bulk move...");
      try {
        const selectedScopeKey = String(scopeSelect.value || state.scopeKey || "");
        await ctx.invoke("screening.bulkRun", {
          action_kind: actionSelect.value,
          match_mode: matchModeSelect.value,
          rules,
          reason: reasonInput.value,
          notes: notesInput.value,
          filter_name: filterNameInput.value,
          target_collection_key: targetSelect.value,
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
          limit: 0,
          sort_by: state.sortBy,
          order: state.order,
        });
        state.scopeKey = selectedScopeKey;
        state.page = 1;
        await Promise.resolve(ctx.rememberScopeKey?.(selectedScopeKey)).catch(() => {});
        await refreshState({ quiet: true, scopeKey: selectedScopeKey, page: 1 });
        ctx.setStatus(actionSelect.value === "filter_copy" ? "Filter created." : "Bulk move complete.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
  }

  function openDescriptivesModal() {
    const result = state.result || {};
    const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
    const fieldOptions = Array.isArray(result.field_options) ? result.field_options : [];
    if (!scopes.length) {
      ctx.setStatus("No Screening scopes are available for descriptives.", "is-error");
      return;
    }
    if (!fieldOptions.length) {
      ctx.setStatus("No Screening columns are available for descriptives.", "is-error");
      return;
    }

    const cleanupFns = new Set();
    function registerCleanup(cleanup) {
      if (typeof cleanup === "function") {
        cleanupFns.add(cleanup);
      }
    }

    const modalScopeKey = scopes.some((entry) => String(entry.collection_key || "") === String(state.scopeKey || ""))
      ? String(state.scopeKey || "")
      : String(scopes[0]?.collection_key || "");
    const scopePicker = buildScrollableOptionPicker(
      scopes.map((entry) => ({
        key: entry.collection_key || "",
        label: entry.label || entry.collection_name || entry.collection_key || "",
      })),
      modalScopeKey,
      registerCleanup,
      {
        rootClassName: "mw-screening-scope-picker",
        triggerClassName: "mw-screening-scope-picker-trigger",
        menuClassName: "mw-screening-scope-picker-menu",
        searchPlaceholder: "Filter scopes...",
        emptyText: "No scopes match this filter.",
        metaLabel: "scopes",
        showKey: false,
      },
    );
    scopePicker.node.setAttribute("data-screening-scope", "true");
    scopePicker.node.querySelector("button")?.setAttribute("aria-label", "Descriptives scope");

    const matchModePicker = buildScrollableOptionPicker(
      [
        { key: "and", label: "All rules (AND)" },
        { key: "or", label: "Any rule (OR)" },
      ],
      "and",
      registerCleanup,
      {
        searchPlaceholder: "Filter logic...",
        emptyText: "No logic options match this filter.",
        metaLabel: "options",
        showKey: false,
      },
    );
    matchModePicker.node.querySelector("button")?.setAttribute("aria-label", "Combine rules");

    const rulesContainer = ctx.createNode("div", { className: "mw-screening-bulk-rules-list" });
    const rulesEmptyNote = ctx.createNode("div", {
      className: "mw-note",
      textContent: "Optional. Add one or more rules to narrow the scope before calculating. If you leave rules blank, selected stats columns summarize the whole chosen scope.",
    });
    const addRuleButton = button(ctx, "Add rule");
    const statsPicker = buildMultiOptionPicker(
      fieldOptions.map((option) => ({
        key: option.key,
        label: option.label,
      })),
      [],
      registerCleanup,
      {
        placeholder: "Choose stats columns",
        metaLabel: "columns",
      },
    );
    const includeItemKeysInput = ctx.createNode("input", {
      attrs: { type: "checkbox" },
    });
    const includeItemKeysRow = ctx.createNode("div", {
      className: "mw-harvest-help-row",
      children: [
        ctx.createNode("label", {
          className: "mw-inline-field",
          children: [
            ctx.createNode("span", { textContent: "Include item keys" }),
            includeItemKeysInput,
          ],
        }),
        createScreeningHelpPopover(registerCleanup, "Item key output", [
          "Leave this off for broad or general descriptive summaries so counts, percentages, numeric statistics, and markdown results come back first without thousands of citation keys.",
          "Turn it on for specific rule-filtered scopes where particular column values, contains-rules, or other narrow criteria likely produce a small subset and you need to show which papers support that analysis.",
          "If the whole review is small, including item keys in every analysis is usually fine.",
          "For very large scopes that broadly represent an already-defined review sample, hundreds or thousands of keys usually add cost without improving a generic overview.",
          "When enabled, item-key and citation-token details are appended after the results so very large outputs truncate the optional key appendix before they truncate the actual result.",
        ]),
      ],
    });
    let lastMarkdown = "";
    let lastCitations = [];
    const combineRulesField = field(ctx, "Combine rules", matchModePicker.node);

    function syncRuleUi() {
      const ruleCount = Array.from(rulesContainer.children).length;
      rulesEmptyNote.hidden = ruleCount > 0;
      combineRulesField.hidden = ruleCount < 2;
    }

    function addRuleRow(seed = {}) {
      const row = buildRuleRow(result, seed, {
        registerCleanup,
        onRemove: syncRuleUi,
      });
      rulesContainer.appendChild(row);
      syncRuleUi();
      return row;
    }

    addRuleButton.addEventListener("click", () => addRuleRow(createRuleDraft(result, {})));
    syncRuleUi();

    const resultPanel = ctx.createNode("div", {
      className: "mw-screening-descriptives-results",
      children: [
        ctx.createNode("div", {
          className: "mw-note",
          textContent: "Add rules, stats columns, or both, then run Calculate.",
        }),
      ],
    });

    function renderDescriptivesResult(payload = null) {
      lastMarkdown = String(payload?.markdown || "");
      lastCitations = Array.isArray(payload?.citations)
        ? payload.citations
        : (Array.isArray(payload?.item_key_details?.citations) ? payload.item_key_details.citations : []);
      copyButton.disabled = !lastMarkdown;
      if (!lastMarkdown) {
        resultPanel.replaceChildren(ctx.createNode("div", {
          className: "mw-note",
          textContent: "Add rules, stats columns, or both, then run Calculate.",
        }));
        return;
      }
      const content = ctx.createNode("div", {
        className: "mw-screening-descriptives-rendered",
        children: [
          renderExploreMarkdown(lastMarkdown, { citations: lastCitations }, { showRawCitationTokens: true }),
        ],
      });
      if (payload?.saved_artifact?.file_name || payload?.saved_artifact?.path) {
        content.appendChild(ctx.createNode("div", {
          className: "mw-note",
          textContent: payload?.saved_artifact?.file_name
            ? `Saved as ${payload.saved_artifact.file_name}`
            : "Saved to the project descriptives outputs folder.",
        }));
      }
      resultPanel.replaceChildren(content);
    }

    const body = ctx.createNode("div", {
      className: "mw-screening-bulk-modal-layout",
      children: [
        ctx.createNode("div", {
          className: "mw-grid",
          children: [
            field(ctx, "Scope", scopePicker.node),
            combineRulesField,
          ],
        }),
        ctx.createNode("div", {
          className: "mw-screening-bulk-rules",
          children: [
            ctx.createNode("div", {
              className: "mw-screening-summary-head",
              children: [
                ctx.createNode("h3", { textContent: "Rules" }),
                addRuleButton,
              ],
            }),
            rulesEmptyNote,
            rulesContainer,
          ],
        }),
        ctx.createNode("div", {
          className: "mw-screening-bulk-modal-section",
          children: [
            field(ctx, "Stats columns", statsPicker.node, { full: true }),
            includeItemKeysRow,
            ctx.createNode("div", {
              className: "mw-note",
              textContent: "Optional. Choose one or more columns for mean, median, min, max, and range. If rules are set, numeric stats use the matched papers only. If rules are blank, selected stats columns summarize the whole chosen scope.",
            }),
          ],
        }),
        ctx.createNode("div", {
          className: "mw-screening-bulk-modal-section",
          children: [
            ctx.createNode("div", {
              className: "mw-screening-summary-head",
              children: [
                ctx.createNode("h3", { textContent: "Results" }),
              ],
            }),
            resultPanel,
          ],
        }),
      ],
    });

    const cancelButton = button(ctx, "Cancel");
    const copyButton = button(ctx, "Copy Markdown");
    copyButton.disabled = true;
    const calculateButton = button(ctx, "Calculate", { className: "mw-button primary" });
    const { overlay } = mountModal("Descriptives", body, [cancelButton, copyButton, calculateButton], { wide: true });
    overlay.__screeningCleanup = () => {
      for (const cleanup of cleanupFns) {
        try {
          cleanup();
        }
        catch (_error) {}
      }
      cleanupFns.clear();
    };

    function setPending(nextPending) {
      calculateButton.disabled = !!nextPending;
      copyButton.disabled = !!nextPending || !lastMarkdown;
      cancelButton.disabled = !!nextPending;
      addRuleButton.disabled = !!nextPending;
      scopePicker.setDisabled(!!nextPending);
      matchModePicker.setDisabled(!!nextPending);
      statsPicker.setDisabled(!!nextPending);
      includeItemKeysInput.disabled = !!nextPending;
      Array.from(rulesContainer.querySelectorAll("input, textarea, select, button")).forEach((node) => {
        node.disabled = !!nextPending;
      });
    }

    cancelButton.addEventListener("click", () => closeModal());
    copyButton.addEventListener("click", async () => {
      if (!lastMarkdown) {
        return;
      }
      const ok = await writeClipboardText(lastMarkdown);
      if (ok) {
        openTransientNotice(copyButton, "Markdown copied.");
        ctx.setStatus("Copied descriptives markdown.", "is-ready");
      }
      else {
        ctx.setStatus("Clipboard write failed.", "is-error");
      }
    });

    calculateButton.addEventListener("click", async () => {
      const rules = Array.from(rulesContainer.children)
        .map((row) => typeof row.collect === "function" ? row.collect() : null)
        .filter(Boolean)
        .filter((rule) => String(rule.column_key || "").trim() && String(rule.operator || "").trim())
        .filter((rule) => {
          if (!isRuleValueRequired(rule.operator)) {
            return true;
          }
          return !!String(rule.match_value || "").trim();
        });
      const statsColumns = statsPicker.getValues();
      if (!rules.length && !statsColumns.length) {
        ctx.setStatus("Add at least one complete rule or select at least one stats column.", "is-error");
        return;
      }
      setPending(true);
      ctx.setStatus("Calculating descriptive statistics...");
      try {
        const selectedScopeKey = String(scopePicker.getValue() || "");
        const payload = await ctx.invoke("descriptives.run", {
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
          match_mode: matchModePicker.getValue(),
          rules,
          stats_columns: statsColumns,
          include_item_keys: !!includeItemKeysInput.checked,
          save_output: true,
        });
        renderDescriptivesResult(payload || {});
        ctx.setStatus("Descriptive statistics ready.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
      finally {
        setPending(false);
      }
    });
  }

  function openExportModal() {
    const result = state.result || {};
    const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
    if (!scopes.length) {
      ctx.setStatus("No Screening scopes are available to export.", "is-error");
      return;
    }
    const scopeSelect = document.createElement("select");
    scopeSelect.setAttribute("aria-label", "Export scope");
    scopeSelect.appendChild(ctx.createNode("option", {
      attrs: { value: ALL_SCREENING_SCOPES },
      textContent: "All screening scopes",
    }));
    for (const entry of scopes) {
      scopeSelect.appendChild(ctx.createNode("option", {
        attrs: { value: entry.collection_key || "" },
        textContent: entry.label || entry.collection_name || entry.collection_key || "",
      }));
    }
    const defaultScopeKey = scopes.some((entry) => String(entry.collection_key || "") === String(state.scopeKey || ""))
      ? String(state.scopeKey || "")
      : String(scopes[0]?.collection_key || "");
    scopeSelect.value = defaultScopeKey || ALL_SCREENING_SCOPES;

    const exportModeSelect = document.createElement("select");
    exportModeSelect.setAttribute("aria-label", "Export mode");
    exportModeSelect.appendChild(ctx.createNode("option", {
      attrs: { value: "current_view" },
      textContent: "Current view",
    }));
    exportModeSelect.appendChild(ctx.createNode("option", {
      attrs: { value: "all_columns" },
      textContent: "Export all",
    }));
    exportModeSelect.value = "current_view";

    const body = ctx.createNode("div", {
      className: "mw-panel-stack",
      children: [
        ctx.createNode("div", {
          className: "mw-grid",
          children: [
            field(ctx, "Scope", scopeSelect),
            field(ctx, "Export", exportModeSelect),
          ],
        }),
        ctx.createNode("div", {
          className: "mw-note",
          textContent: "Current view exports the selected Screening scope with the current visible-column order. All screening scopes means the same scope list shown in this Screening dropdown. Export all keeps the same rows and includes every Screening column, with Scope prepended first.",
        }),
      ],
    });

    const cancelButton = button(ctx, "Cancel");
    const exportButton = button(ctx, "Export", { className: "mw-button primary" });
    mountModal("Export Screening CSV", body, [cancelButton, exportButton]);
    cancelButton.addEventListener("click", () => closeModal());
    exportButton.addEventListener("click", async () => {
      const selectedScopeKey = String(scopeSelect.value || "");
      closeModal();
      ctx.setStatus("Preparing Screening CSV export...");
      try {
        const payload = {
          export_mode: exportModeSelect.value === "all_columns" ? "all_columns" : "current_view",
          query: "",
          decision_filter: "",
          sort_by: state.sortBy,
          order: state.order,
          visible_columns: allVisibleColumns(),
          detach: true,
        };
        if (selectedScopeKey === ALL_SCREENING_SCOPES) {
          payload.scope_mode = "all";
        } else if (selectedScopeKey) {
          payload.collection_key = selectedScopeKey;
          await Promise.resolve(ctx.rememberScopeKey?.(selectedScopeKey)).catch(() => {});
        }
        const queued = await ctx.invoke("screening.exportCsv.saveAs", payload);
        if (queued?.canceled) {
          ctx.setStatus("Screening CSV export canceled.", "is-ready");
          return;
        }
        ctx.setStatus(queued?.message || "Screening CSV export queued. Track progress in Jobs.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
  }

  function openCreateColumnModal() {
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "(e.g. Screening decision)";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.placeholder = "(e.g. column_key)";
    const typeSelect = document.createElement("select");
    [
      ["text", "Text"],
      ["number", "Number"],
      ["boolean", "Boolean"],
    ].forEach(([value, label]) => typeSelect.appendChild(ctx.createNode("option", {
      attrs: { value },
      textContent: label,
    })));
    const body = ctx.createNode("div", {
      className: "mw-grid",
      children: [
        field(ctx, "Label", labelInput),
        field(ctx, "Key", keyInput),
        field(ctx, "Type", typeSelect),
      ],
    });
    const cancelButton = button(ctx, "Cancel");
    const createButton = button(ctx, "Create", { className: "mw-button primary" });
    mountModal("Create Column", body, [cancelButton, createButton]);
    cancelButton.addEventListener("click", () => closeModal());
    createButton.addEventListener("click", async () => {
      closeModal();
      ctx.setStatus("Saving screening column...");
      try {
        const saved = await ctx.invoke("screening.columns.create", {
          label: labelInput.value,
          column_key: keyInput.value,
          type: typeSelect.value,
        });
        const key = String(saved?.column?.column_key || "");
        if (key && !state.visibleColumns.includes(key)) {
          state.visibleColumns = state.visibleColumns.concat([key]);
          await persistPreference("visible_columns", state.visibleColumns);
        }
        await refreshState({ quiet: true });
        ctx.setStatus("Screening column saved.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
  }

  function openVisibleColumnsModal() {
    const columns = Array.isArray(state.result?.all_columns) ? state.result.all_columns : [];
    const columnsByKey = new Map(
      columns
        .map((column) => {
          const key = String(column.key || column.column_key || "").trim();
          return key ? [key, column] : null;
        })
        .filter(Boolean)
    );
    let draftVisibleKeys = uniqueColumnKeys(allVisibleColumns()).filter((key) => columnsByKey.has(key));
    let draftVisibleSet = new Set(draftVisibleKeys);
    let dragState = {
      active: false,
      sourceKey: "",
      sourceType: "",
      insertionIndex: null,
      pointerX: 0,
      pointerY: 0,
    };
    const byGroup = new Map();
    for (const column of columns) {
      const group = normalizeText(column.group || "Other") || "Other";
      if (!byGroup.has(group)) {
        byGroup.set(group, []);
      }
      byGroup.get(group).push(column);
    }
    const palette = ctx.createNode("div", {
      className: "mw-screening-column-palette",
    });
    const groupsRoot = ctx.createNode("div", {
      className: "mw-screening-column-groups",
    });
    palette.appendChild(groupsRoot);
    const composerLabel = ctx.createNode("div", {
      className: "mw-screening-column-composer-title",
      textContent: "Shown column order",
    });
    const composerHint = ctx.createNode("div", {
      className: "mw-screening-column-composer-hint",
      textContent: "Tick a column to add it to the end, or drag it here to place it exactly where you want it.",
    });
    const composerZone = ctx.createNode("div", {
      className: "mw-screening-column-composer-zone",
    });
    const validation = ctx.createNode("div", {
      className: "mw-screening-column-validation",
    });
    const composer = ctx.createNode("div", {
      className: "mw-screening-column-composer",
      children: [
        composerLabel,
        composerHint,
        composerZone,
        validation,
      ],
    });
    const body = ctx.createNode("div", {
      className: "mw-screening-columns-modal-layout",
      children: [palette, composer],
    });
    const cancelButton = button(ctx, "Cancel");
    const saveButton = button(ctx, "Save", { className: "mw-button primary" });
    const { overlay } = mountModal("Show Columns", body, [cancelButton, saveButton], {
      wide: true,
      bodyClassName: "mw-screening-columns-modal-body",
    });
    let dragCleanup = null;
    let autoScrollFrame = 0;

    function syncDraftState() {
      draftVisibleKeys = uniqueColumnKeys(draftVisibleKeys).filter((key) => columnsByKey.has(key));
      draftVisibleSet = new Set(draftVisibleKeys);
    }

    function displayedComposerKeys() {
      if (dragState.active && draftVisibleSet.has(dragState.sourceKey)) {
        return draftVisibleKeys.filter((key) => key !== dragState.sourceKey);
      }
      return draftVisibleKeys.slice();
    }

    function updateValidation() {
      const isEmpty = draftVisibleKeys.length === 0;
      composerLabel.textContent = `Shown column order (${draftVisibleKeys.length})`;
      validation.textContent = isEmpty
        ? "Select at least one column to keep the Screening table usable."
        : "Drag shown columns to reorder them, or use the - button to remove them.";
      validation.className = `mw-screening-column-validation${isEmpty ? " is-error" : ""}`;
      saveButton.disabled = isEmpty;
    }

    function renderGroups() {
      const scrollTop = palette.scrollTop || 0;
      const groups = Array.from(byGroup.entries()).map(([group, entries]) =>
        ctx.createNode("div", {
          className: "mw-screening-column-group",
          children: [
            ctx.createNode("div", {
              className: "mw-screening-column-group-title",
              textContent: group,
            }),
            ...entries.map((column) => {
              const key = String(column.key || column.column_key || "").trim();
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = draftVisibleSet.has(key);
              checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                  draftVisibleKeys = insertColumnKey(draftVisibleKeys, key, draftVisibleKeys.length);
                }
                else {
                  draftVisibleKeys = removeColumnKey(draftVisibleKeys, key);
                }
                syncDraftState();
                renderGroups();
                renderComposer();
                updateValidation();
              });
              const textWrap = ctx.createNode("div", {
                className: "mw-screening-column-option-text",
                children: [
                  ctx.createNode("div", {
                    className: "mw-screening-column-option-label",
                    textContent: normalizeText(column.label || key),
                  }),
                  ctx.createNode("div", {
                    className: "mw-screening-column-option-meta",
                    textContent: key,
                  }),
                ],
              });
              const row = ctx.createNode("div", {
                className: `mw-screening-column-option${draftVisibleSet.has(key) ? " is-selected" : ""}`,
                attrs: { "data-screening-column-option": key },
                children: [checkbox, textWrap],
              });
              attachDragStart(row, key, "group-list");
              return row;
            }),
          ],
        })
      );
      groupsRoot.replaceChildren(...groups);
      palette.scrollTop = scrollTop;
    }

    function clampInsertionIndex(index, length) {
      if (!Number.isFinite(Number(index))) {
        return length;
      }
      return Math.max(0, Math.min(Number(index), length));
    }

    function createInsertMarker() {
      return ctx.createNode("div", {
        className: "mw-screening-column-insert-marker",
      });
    }

    function renderComposer() {
      const shownKeys = displayedComposerKeys();
      const insertionIndex = dragState.active
        ? clampInsertionIndex(dragState.insertionIndex, shownKeys.length)
        : null;
      const scrollTop = composerZone.scrollTop || 0;
      const children = [];
      if (!shownKeys.length && insertionIndex === null) {
        children.push(ctx.createNode("div", {
          className: "mw-screening-column-composer-empty",
          textContent: "No visible columns yet. Tick or drag columns from the list above.",
        }));
      }
      for (let index = 0; index <= shownKeys.length; index += 1) {
        if (insertionIndex === index) {
          children.push(createInsertMarker());
        }
        if (index >= shownKeys.length) {
          continue;
        }
        const key = shownKeys[index];
        const label = columnLabel(state.result || {}, key);
        const chipLabel = ctx.createNode("span", {
          className: "mw-screening-column-chip-label",
          textContent: label,
        });
        const chipMeta = ctx.createNode("span", {
          className: "mw-screening-column-chip-meta",
          textContent: key,
        });
        const chipBody = ctx.createNode("div", {
          className: "mw-screening-column-chip-body",
          children: [chipLabel, chipMeta],
        });
        const removeButton = button(ctx, "-", {
          className: "mw-screening-column-chip-remove",
          attrs: { "aria-label": `Remove ${label}` },
        });
        removeButton.addEventListener("click", () => {
          draftVisibleKeys = removeColumnKey(draftVisibleKeys, key);
          syncDraftState();
          renderGroups();
          renderComposer();
          updateValidation();
        });
        const chip = ctx.createNode("div", {
          className: "mw-screening-column-chip",
          attrs: {
            "data-screening-composer-chip": "true",
            "data-screening-column-key": key,
          },
          children: [chipBody, removeButton],
        });
        attachDragStart(chipBody, key, "shown-chip");
        children.push(chip);
      }
      composerZone.className = `mw-screening-column-composer-zone${dragState.active ? " is-drag-active" : ""}`;
      composerZone.replaceChildren(...children);
      composerZone.scrollTop = scrollTop;
    }

    function resolveInsertionIndex(clientX, clientY) {
      const rect = composerZone.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return draftVisibleKeys.length;
      }
      const insideComposer = (
        clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      );
      if (!insideComposer) {
        return null;
      }
      const chips = Array.from(composerZone.querySelectorAll("[data-screening-composer-chip='true']"));
      if (!chips.length) {
        return 0;
      }
      const rows = [];
      for (const chip of chips) {
        const chipRect = chip.getBoundingClientRect();
        let row = rows.find((entry) => Math.abs(entry.top - chipRect.top) < 8);
        if (!row) {
          row = {
            top: chipRect.top,
            bottom: chipRect.bottom,
            items: [],
          };
          rows.push(row);
        }
        row.bottom = Math.max(row.bottom, chipRect.bottom);
        row.items.push(chipRect);
      }
      rows.sort((left, right) => left.top - right.top);
      let offset = 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const rowLength = row.items.length;
        const isMatch = clientY <= row.bottom || rowIndex === rows.length - 1;
        if (!isMatch) {
          offset += rowLength;
          continue;
        }
        for (let itemIndex = 0; itemIndex < row.items.length; itemIndex += 1) {
          const chipRect = row.items[itemIndex];
          const midpoint = chipRect.left + (chipRect.width / 2);
          if (clientX < midpoint) {
            return offset + itemIndex;
          }
        }
        return offset + rowLength;
      }
      return chips.length;
    }

    function finishDrag(clientX, clientY) {
      if (!dragState.active) {
        return;
      }
      stopComposerAutoScroll();
      const insertionIndex = resolveInsertionIndex(clientX, clientY);
      if (insertionIndex !== null) {
        draftVisibleKeys = insertColumnKey(displayedComposerKeys(), dragState.sourceKey, insertionIndex);
        syncDraftState();
        renderGroups();
      }
      dragState = {
        active: false,
        sourceKey: "",
        sourceType: "",
        insertionIndex: null,
        pointerX: 0,
        pointerY: 0,
      };
      renderComposer();
      updateValidation();
    }

    function clearDrag() {
      stopComposerAutoScroll();
      dragState = {
        active: false,
        sourceKey: "",
        sourceType: "",
        insertionIndex: null,
        pointerX: 0,
        pointerY: 0,
      };
      renderComposer();
    }

    function stopComposerAutoScroll() {
      if (!autoScrollFrame) {
        return;
      }
      const view = panel.ownerDocument?.defaultView || window;
      view.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = 0;
    }

    function scheduleComposerAutoScroll() {
      if (autoScrollFrame) {
        return;
      }
      const view = panel.ownerDocument?.defaultView || window;
      const tick = () => {
        autoScrollFrame = 0;
        if (!dragState.active) {
          return;
        }
        let shouldRender = false;
        const rect = composerZone.getBoundingClientRect();
        const canScroll = composerZone.scrollHeight > composerZone.clientHeight + 1;
        if (
          canScroll
          && rect.width
          && rect.height
          && dragState.pointerX >= rect.left
          && dragState.pointerX <= rect.right
        ) {
          const threshold = Math.min(48, Math.max(24, rect.height * 0.2));
          let delta = 0;
          if (dragState.pointerY < rect.top + threshold) {
            delta = -Math.ceil((rect.top + threshold - dragState.pointerY) / 4);
          }
          else if (dragState.pointerY > rect.bottom - threshold) {
            delta = Math.ceil((dragState.pointerY - (rect.bottom - threshold)) / 4);
          }
          delta = Math.max(-18, Math.min(18, delta));
          if (delta) {
            const maxScrollTop = Math.max(0, composerZone.scrollHeight - composerZone.clientHeight);
            const previousScrollTop = composerZone.scrollTop || 0;
            composerZone.scrollTop = Math.max(0, Math.min(maxScrollTop, previousScrollTop + delta));
            shouldRender = composerZone.scrollTop !== previousScrollTop;
          }
        }
        const nextInsertionIndex = resolveInsertionIndex(dragState.pointerX, dragState.pointerY);
        if (nextInsertionIndex !== dragState.insertionIndex) {
          dragState = Object.assign({}, dragState, {
            insertionIndex: nextInsertionIndex,
          });
          shouldRender = true;
        }
        if (shouldRender) {
          renderComposer();
        }
        if (dragState.active) {
          autoScrollFrame = view.requestAnimationFrame(tick);
        }
      };
      autoScrollFrame = view.requestAnimationFrame(tick);
    }

    function attachDragStart(node, key, sourceType) {
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target?.closest("input, button")) {
          return;
        }
        event.preventDefault();
        const doc = panel.ownerDocument || document;
        const startX = event.clientX;
        const startY = event.clientY;
        let started = false;
        const onMove = (moveEvent) => {
          const pointerX = moveEvent.clientX;
          const pointerY = moveEvent.clientY;
          if (!started) {
            const dx = Math.abs(pointerX - startX);
            const dy = Math.abs(pointerY - startY);
            if (dx < 6 && dy < 6) {
              return;
            }
            started = true;
            dragState = {
              active: true,
              sourceKey: key,
              sourceType,
              insertionIndex: resolveInsertionIndex(pointerX, pointerY),
              pointerX,
              pointerY,
            };
            scheduleComposerAutoScroll();
          }
          else {
            dragState = Object.assign({}, dragState, {
              insertionIndex: resolveInsertionIndex(pointerX, pointerY),
              pointerX,
              pointerY,
            });
          }
          renderComposer();
        };
        const onUp = (upEvent) => {
          doc.removeEventListener("pointermove", onMove, true);
          doc.removeEventListener("pointerup", onUp, true);
          doc.removeEventListener("pointercancel", onCancel, true);
          dragCleanup = null;
          if (!started) {
            return;
          }
          finishDrag(upEvent.clientX, upEvent.clientY);
        };
        const onCancel = () => {
          doc.removeEventListener("pointermove", onMove, true);
          doc.removeEventListener("pointerup", onUp, true);
          doc.removeEventListener("pointercancel", onCancel, true);
          dragCleanup = null;
          if (started) {
            clearDrag();
          }
        };
        dragCleanup = () => {
          doc.removeEventListener("pointermove", onMove, true);
          doc.removeEventListener("pointerup", onUp, true);
          doc.removeEventListener("pointercancel", onCancel, true);
          dragCleanup = null;
          if (started) {
            clearDrag();
          }
        };
        doc.addEventListener("pointermove", onMove, true);
        doc.addEventListener("pointerup", onUp, true);
        doc.addEventListener("pointercancel", onCancel, true);
      });
    }

    overlay.__screeningCleanup = () => {
      if (typeof dragCleanup === "function") {
        dragCleanup();
      }
    };

    syncDraftState();
    renderGroups();
    renderComposer();
    updateValidation();
    cancelButton.addEventListener("click", () => closeModal());
    saveButton.addEventListener("click", async () => {
      captureGridPosition();
      try {
        await persistPreference("visible_columns", draftVisibleKeys);
        state.visibleColumns = draftVisibleKeys.slice();
        closeModal();
        await refreshState({ quiet: true });
        ctx.setStatus("Visible columns saved.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
  }

  function openValueTemplatesModal() {
    const textarea = document.createElement("textarea");
    textarea.rows = 12;
    textarea.value = state.valueTemplates.join("\n");
    const body = ctx.createNode("div", {
      className: "mw-panel-stack",
      children: [
        field(ctx, "Templates", textarea, { full: true }),
        ctx.createNode("div", {
          className: "mw-note",
          textContent: "Type [ while editing Comments, Reason, or custom text columns to insert one of these snippets.",
        }),
      ],
    });
    const cancelButton = button(ctx, "Cancel");
    const saveButton = button(ctx, "Save", { className: "mw-button primary" });
    mountModal("Value Templates", body, [cancelButton, saveButton]);
    cancelButton.addEventListener("click", () => closeModal());
    saveButton.addEventListener("click", async () => {
      closeModal();
      try {
        const values = String(textarea.value || "")
          .split(/\r?\n/)
          .map((entry) => normalizeText(entry))
          .filter(Boolean);
        const saved = await ctx.invoke("screening.valueTemplates.save", { values });
        state.valueTemplates = Array.isArray(saved?.values) ? saved.values : values;
        ctx.setStatus("Value templates saved.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
  }

  function attachTemplatePopup(input, itemKey, columnKey) {
    const popup = state.templatePopup;
    if (!popup) {
      return;
    }

    function queryInfo() {
      const caret = Number(input.selectionStart || 0);
      const before = String(input.value || "").slice(0, caret);
      const match = before.match(/\[([^\[\]\n]{0,80})$/);
      if (!match) {
        return null;
      }
      return {
        start: caret - match[0].length,
        end: caret,
        query: String(match[1] || "").trim().toLowerCase(),
      };
    }

    function renderSuggestions() {
      const info = queryInfo();
      if (!info) {
        closeTemplatePopup();
        return;
      }
      const options = state.valueTemplates.filter((entry) =>
        !info.query || String(entry || "").toLowerCase().includes(info.query)
      );
      if (!options.length) {
        closeTemplatePopup();
        return;
      }
      popup.replaceChildren(
        ctx.createNode("div", {
          className: "mw-screening-template-popup-head",
          textContent: "Templates",
        }),
        ctx.createNode("div", {
          className: "mw-screening-template-popup-list",
          children: options.map((entry) => {
            const option = ctx.createNode("button", {
              className: "mw-screening-template-option",
              textContent: entry,
              attrs: { type: "button" },
            });
            option.addEventListener("click", () => {
              const latest = queryInfo();
              if (!latest) {
                closeTemplatePopup();
                return;
              }
              const nextValue = String(input.value || "");
              const replacement = `[${entry}]`;
              input.value = `${nextValue.slice(0, latest.start)}${replacement}${nextValue.slice(latest.end)}`;
              const caret = latest.start + replacement.length;
              input.focus();
              input.setSelectionRange(caret, caret);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              closeTemplatePopup();
            });
            return option;
          }),
        }),
      );
      const rect = input.getBoundingClientRect();
      popup.style.display = "flex";
      popup.style.left = `${Math.round(rect.left)}px`;
      popup.style.top = `${Math.round(rect.bottom + 4)}px`;
      popup.style.width = `${Math.max(220, Math.round(rect.width))}px`;
      state.templateTarget = input;
    }

    input.addEventListener("input", renderSuggestions);
    input.addEventListener("keyup", renderSuggestions);
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (document.activeElement && popup.contains(document.activeElement)) {
          return;
        }
        closeTemplatePopup();
      }, 50);
    });
  }

  function inlineField(label, input, className = "") {
    return ctx.createNode("label", {
      className: `mw-inline-field${className ? ` ${className}` : ""}`,
      children: [
        ctx.createNode("span", { textContent: label }),
        input,
      ],
    });
  }

  function renderPagination(position = "top") {
    const wrapper = ctx.createNode("div", {
      className: "mw-screening-pagination-bar",
      attrs: { "data-screening-pagination": position },
    });
    const rowsSelect = document.createElement("select");
    rowsSelect.setAttribute("data-screening-limit", position);
    [10, 25, 50, 100].forEach((value) => rowsSelect.appendChild(ctx.createNode("option", {
      attrs: { value },
      textContent: String(value),
    })));
    rowsSelect.value = String(state.limit || 25);
    rowsSelect.addEventListener("change", async () => {
      await changeLimit(rowsSelect.value);
    });

    const pageInput = document.createElement("input");
    pageInput.type = "number";
    pageInput.min = "1";
    pageInput.step = "1";
    pageInput.value = String(state.result?.page || state.page || 1);
    pageInput.className = "mw-screening-page-input";
    pageInput.setAttribute("data-screening-page", position);
    const goButton = button(ctx, "Go", {
      attrs: { "data-screening-page-go": position },
    });
    goButton.addEventListener("click", async () => {
      await changePage(pageInput.value);
    });
    pageInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await changePage(pageInput.value);
      }
    });
    pageInput.addEventListener("blur", async () => {
      if (String(pageInput.value || "") !== String(state.result?.page || 1)) {
        await changePage(pageInput.value);
      }
    });

    const prevButton = button(ctx, "Prev", {
      attrs: { "data-screening-page-prev": position },
    });
    prevButton.disabled = Number(state.result?.page || 1) <= 1;
    prevButton.addEventListener("click", async () => {
      await changePage(Math.max(1, Number(state.result?.page || 1) - 1));
    });

    const nextButton = button(ctx, "Next", {
      attrs: { "data-screening-page-next": position },
    });
    nextButton.disabled = Number(state.result?.page || 1) >= Number(state.result?.page_count || 1);
    nextButton.addEventListener("click", async () => {
      await changePage(Math.min(Number(state.result?.page_count || 1), Number(state.result?.page || 1) + 1));
    });

    const metaGroup = ctx.createNode("div", {
      className: "mw-meta",
      children: [
        ctx.createNode("div", {
          className: "mw-badge mw-screening-page-pill",
          textContent: pageInfoText(state.result || {}),
          attrs: { "data-screening-page-info": position },
        }),
        ctx.createNode("div", {
          className: "mw-badge mw-screening-page-pill",
          textContent: `${Number(state.result?.total_records || 0)} rows`,
        }),
      ],
    });

    const trailingChildren = [metaGroup];
    if (position === "bottom") {
      const zoomRange = document.createElement("input");
      zoomRange.type = "range";
      zoomRange.min = "70";
      zoomRange.max = "150";
      zoomRange.step = "5";
      zoomRange.value = String(normalizeGridZoomPercent(state.gridZoomPercent, 100));
      zoomRange.className = "mw-screening-grid-zoom-range";
      const zoomSlider = ctx.createNode("div", {
        className: "mw-screening-grid-zoom-slider",
        children: [
          ctx.createNode("div", { className: "mw-screening-grid-zoom-track" }),
          ctx.createNode("div", { className: "mw-screening-grid-zoom-thumb" }),
          zoomRange,
        ],
      });
      const zoomValue = ctx.createNode("span", {
        className: "mw-screening-grid-zoom-value",
        textContent: `${zoomRange.value}%`,
      });
      zoomRange.addEventListener("input", () => {
        setGridZoomPercent(zoomRange.value, { persist: true });
      });
      zoomRange.addEventListener("change", () => {
        setGridZoomPercent(zoomRange.value, { persist: true, immediate: true });
      });
      state.gridZoomSliderWrapNode = zoomSlider;
      state.gridZoomSliderNode = zoomRange;
      state.gridZoomValueNode = zoomValue;
      trailingChildren.push(
        ctx.createNode("div", {
          className: "mw-screening-grid-zoom",
          children: [
            ctx.createNode("span", {
              className: "mw-screening-grid-zoom-label",
              textContent: "Zoom",
            }),
            zoomSlider,
            zoomValue,
          ],
        }),
      );
    }

    wrapper.append(
      ctx.createNode("div", {
        className: "mw-screening-page-controls",
        children: [
          inlineField("Rows per page", rowsSelect),
          inlineField("Page", pageInput),
          goButton,
          prevButton,
          nextButton,
        ],
      }),
      ctx.createNode("div", {
        className: "mw-screening-pagination-side",
        children: trailingChildren,
      }),
    );
    return wrapper;
  }

  function autoGrowTextarea(textarea, minHeight = 56) {
    if (!textarea) {
      return;
    }
    const nextMinHeight = Math.max(36, Number(minHeight || 56) || 56);
    const maxHeight = Math.max(nextMinHeight, Math.min(320, Math.round((window.innerHeight || 800) * 0.4)));
    textarea.style.minHeight = `${nextMinHeight}px`;
    textarea.style.height = "auto";
    const targetHeight = Math.min(Math.max(textarea.scrollHeight || nextMinHeight, nextMinHeight), maxHeight);
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY = (textarea.scrollHeight || 0) > targetHeight + 1 ? "auto" : "hidden";
  }

  function buildCompactActions(record, fullTextState, onOpenItem, onOpenFullTextForAnchor) {
    const moveHint = ctx.createNode("div", {
      className: "mw-screening-move-field is-disabled mw-screening-move-compact-wrap",
      attrs: {
        "data-disabled-hint": "To make screening decisions, turn Edit mode on.",
        title: "To make screening decisions, turn Edit mode on.",
      },
      children: [
        ctx.createNode("div", {
          className: "mw-screening-move-compact",
          textContent: "Move",
          attrs: { tabindex: "0" },
        }),
      ],
    });

    const openItemButton = button(ctx, "Item", {
      className: "mw-button mw-screening-compact-action-button",
      attrs: { "data-screening-open-item": record.item_key || "" },
    });
    openItemButton.addEventListener("click", onOpenItem);

    const fullTextLabel = fullTextState === "pdf_only" ? "Full-Text!" : "Full-Text";
    const openFullTextButton = button(ctx, fullTextLabel, {
      className: `mw-button mw-screening-compact-action-button mw-screening-fulltext-button${fullTextState === "pdf_only" ? " is-warning" : ""}${fullTextState === "missing" ? " is-missing" : ""}`,
      attrs: Object.assign(
        { "data-screening-open-fulltext": record.item_key || "" },
        fullTextState === "missing" ? { "aria-disabled": "true" } : {}
      ),
    });
    openFullTextButton.addEventListener("click", () => onOpenFullTextForAnchor(openFullTextButton));
    const fullTextWrap = ctx.createNode("div", {
      className: "mw-screening-fulltext-wrap",
      attrs: fullTextState === "pdf_only"
        ? {
            "data-fulltext-hint": "Item has a full-text PDF but no converted markdown. Click Open item, then reconvert the PDF or choose a different conversion mode.",
          }
        : {},
      children: [openFullTextButton],
    });

    return ctx.createNode("div", {
      className: "mw-screening-actions-inline",
      children: [moveHint, openItemButton, fullTextWrap],
    });
  }

  function renderCellEditor(record, columnKey) {
    const edit = dirtyEditFor(record.item_key);
    const type = columnType(state.result || {}, columnKey);
    let input = null;
    if (type === "boolean") {
      input = document.createElement("select");
      [
        ["", ""],
        ["true", "true"],
        ["false", "false"],
      ].forEach(([value, label]) => input.appendChild(ctx.createNode("option", {
        attrs: { value },
        textContent: label,
      })));
      input.value = String(recordCellValue(record, edit, columnKey) || "");
      input.addEventListener("change", () => queueValueEdit(record.item_key, columnKey, input.value));
    }
    else if (type === "number") {
      input = document.createElement("input");
      input.type = "number";
      input.value = String(recordCellValue(record, edit, columnKey) || "");
      input.addEventListener("input", () => queueValueEdit(record.item_key, columnKey, input.value));
    }
    else {
      input = document.createElement("textarea");
      input.rows = 1;
      input.value = String(recordCellValue(record, edit, columnKey) || "");
      input.addEventListener("input", () => queueValueEdit(record.item_key, columnKey, input.value));
      attachTemplatePopup(input, record.item_key, columnKey);
      input.classList.add("is-textarea");
      const minHeight = columnKey === "comments" || columnKey === "reason" ? 78 : 56;
      const resize = () => autoGrowTextarea(input, minHeight);
      input.addEventListener("input", resize);
      input.addEventListener("focus", resize);
      window.requestAnimationFrame(resize);
    }
    input.className = `mw-screening-cell-input${input.tagName === "TEXTAREA" ? " is-textarea" : ""}`;
    input.setAttribute("data-screening-cell", `${record.item_key}::${columnKey}`);
    input.addEventListener("focus", () => {
      state.activeCellKey = `${record.item_key}::${columnKey}`;
    });
    input.addEventListener("blur", () => {
      if (state.activeCellKey === `${record.item_key}::${columnKey}`) {
        state.activeCellKey = "";
      }
    });
    return input;
  }

  function renderCell(record, columnKey) {
    const edit = dirtyEditFor(record.item_key);
    const isDirty = !!edit && (
      (columnKey === "comments" && Object.prototype.hasOwnProperty.call(edit, "notes"))
      || (columnKey === "reason" && Object.prototype.hasOwnProperty.call(edit, "reason"))
      || !!(edit.values && Object.prototype.hasOwnProperty.call(edit.values, columnKey))
    );
    const editable = state.editMode && isEditableColumn(state.result || {}, columnKey);
    const type = columnType(state.result || {}, columnKey);
    const isTextEditable = editable && type === "text";
    const td = ctx.createNode("td", {
      className: `mw-screening-grid-cell${editable ? " is-editable" : ""}${isTextEditable ? " is-text-editor" : ""}${isDirty ? " is-edited" : ""}${state.activeCellKey === `${record.item_key}::${columnKey}` ? " is-active" : ""}`,
      attrs: {
        "data-screening-cell": `${record.item_key}::${columnKey}`,
        "data-screening-column": columnKey,
      },
    });
    if (editable) {
      const editor = renderCellEditor(record, columnKey);
      td.appendChild(editor);
      td.addEventListener("click", (event) => {
        if (event.target !== td) {
          return;
        }
        if (typeof editor.focus === "function") {
          editor.focus();
        }
      });
      return td;
    }
    td.appendChild(ctx.createNode("div", {
      className: `mw-screening-cell-content${currentRowDisplayMode() === "collapsed" ? " is-collapsed" : " is-expanded"}`,
      textContent: normalizeText(recordCellValue(record, edit, columnKey), true),
    }));
    if (supportsFullTextOpen(columnKey)) {
      td.addEventListener("contextmenu", (event) => showCellContextMenu(event, record, columnKey));
    }
    return td;
  }

  async function applySelectedScope(selectedScopeKey, options = {}) {
    state.scopeKey = String(selectedScopeKey || "");
    state.page = Number(options.page || 1) || 1;
    state.scrollTop = 0;
    state.scrollLeft = 0;
    try {
      await Promise.resolve(ctx.rememberScopeKey?.(state.scopeKey || ""));
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
    }
    await refreshState({
      quiet: options.quiet !== false,
      scopeKey: state.scopeKey,
      page: state.page,
    });
  }

  function openMissingFullTextPopover(anchor, record = {}) {
    const statusLine = ctx.createNode("div", {
      className: "mw-screening-inline-popover-status",
      textContent: "This item does not have full text.",
    });
    const buttonRow = ctx.createNode("div", {
      className: "mw-screening-inline-popover-actions",
    });
    let isBusy = false;

    function setBusy(nextBusy) {
      isBusy = !!nextBusy;
      buttonRow.querySelectorAll("button").forEach((node) => {
        node.disabled = isBusy;
      });
    }

    function bindPopoverAction(node, handler) {
      node.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      node.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isBusy) {
          return;
        }
        await handler(event);
      });
    }

    function closeButton() {
      const close = button(ctx, "Close");
      bindPopoverAction(close, async () => {
        closeInlinePopover();
      });
      return close;
    }

    const attemptButton = button(ctx, "Attempt to find full text", {
      className: "mw-button primary",
    });
    const uploadButton = button(ctx, "Upload full text");

    bindPopoverAction(attemptButton, async () => {
      setBusy(true);
      statusLine.textContent = "Trying Zotero full-text retrieval...";
      try {
        const result = await ctx.invoke("screening.item.fulltext.find", {
          item_key: record.item_key,
        });
        if (!result?.found) {
          setBusy(false);
          statusLine.textContent = "Full text not found.";
          uploadButton.disabled = false;
          buttonRow.replaceChildren(uploadButton, closeButton());
          return;
        }
        closeInlinePopover();
        await refreshState({ quiet: true });
        ctx.setStatus("Full text found. Markdown conversion queued.", "is-ready");
      }
      catch (error) {
        statusLine.textContent = error?.message || String(error);
        setBusy(false);
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });

    bindPopoverAction(uploadButton, async () => {
      setBusy(true);
      statusLine.textContent = "Opening file picker...";
      try {
        const result = await ctx.invoke("screening.item.fulltext.upload", {
          item_key: record.item_key,
        });
        if (result?.canceled) {
          statusLine.textContent = "This item does not have full text.";
          setBusy(false);
          return;
        }
        closeInlinePopover();
        await refreshState({ quiet: true });
        ctx.setStatus("Full text uploaded. Markdown conversion queued.", "is-ready");
      }
      catch (error) {
        statusLine.textContent = error?.message || String(error);
        setBusy(false);
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });

    buttonRow.append(attemptButton, uploadButton, closeButton());
    return openInlinePopover(anchor, [
      statusLine,
      buttonRow,
    ]);
  }

  function openScopeDecisionsModal() {
    const result = state.result || {};
    const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
    const scopeSelect = document.createElement("select");
    scopeSelect.setAttribute("aria-label", "Scope");
    for (const entry of scopes) {
      scopeSelect.appendChild(ctx.createNode("option", {
        attrs: { value: entry.collection_key || "" },
        textContent: entry.label || entry.collection_name || entry.collection_key || "",
      }));
    }
    scopeSelect.value = scopes.some((entry) => String(entry.collection_key || "") === String(state.scopeKey || ""))
      ? String(state.scopeKey || "")
      : String(scopes[0]?.collection_key || "");

    const actionSelect = document.createElement("select");
    actionSelect.appendChild(ctx.createNode("option", {
      attrs: { value: "move" },
      textContent: "Move all items to another scope",
    }));
    actionSelect.appendChild(ctx.createNode("option", {
      attrs: { value: "filter_copy" },
      textContent: "Create filter from this whole scope",
    }));

    const targetSelect = document.createElement("select");
    for (const target of Array.isArray(result.decision_targets) ? result.decision_targets : []) {
      targetSelect.appendChild(ctx.createNode("option", {
        attrs: { value: target.collection_key || "" },
        textContent: target.label || target.collection_name || target.collection_key || "",
      }));
    }
    const filterNameInput = document.createElement("input");
    filterNameInput.type = "text";
    filterNameInput.placeholder = "(e.g. Retrieval-ready survivors)";
    const reasonInput = document.createElement("textarea");
    reasonInput.rows = 3;
    reasonInput.placeholder = "Optional reason saved with the move";
    const notesInput = document.createElement("textarea");
    notesInput.rows = 3;
    notesInput.placeholder = "Optional notes saved with the move";

    const actionFields = ctx.createNode("div", { className: "mw-panel-stack" });
    const moveFields = ctx.createNode("div", {
      className: "mw-panel-stack",
      children: [
        field(ctx, "Target subcollection", targetSelect),
        field(ctx, "Reason", reasonInput, { full: true }),
        field(ctx, "Notes", notesInput, { full: true }),
      ],
    });
    const filterFields = ctx.createNode("div", {
      className: "mw-panel-stack",
      children: [
        field(ctx, "Filter name", filterNameInput),
        ctx.createNode("div", {
          className: "mw-note",
          textContent: "This copies the selected scope into Filters without moving the items.",
        }),
      ],
    });

    function syncActionFields() {
      const isFilter = actionSelect.value === "filter_copy";
      actionFields.replaceChildren(isFilter ? filterFields : moveFields);
      submitButton.textContent = isFilter ? "Create Filter" : "Move Scope";
    }

    const body = ctx.createNode("div", {
      className: "mw-panel-stack",
      children: [
        ctx.createNode("div", {
          className: "mw-grid",
          children: [
            field(ctx, "Scope", scopeSelect),
            field(ctx, "Action", actionSelect),
          ],
        }),
        actionFields,
      ],
    });

    const cancelButton = button(ctx, "Cancel");
    const submitButton = button(ctx, "Move Scope", { className: "mw-button primary" });
    mountModal("Scope decisions", body, [cancelButton, submitButton]);
    syncActionFields();
    cancelButton.addEventListener("click", () => closeModal());
    actionSelect.addEventListener("change", syncActionFields);

    submitButton.addEventListener("click", async () => {
      const selectedScopeKey = String(scopeSelect.value || state.scopeKey || "");
      if (actionSelect.value === "move" && !String(targetSelect.value || "").trim()) {
        ctx.setStatus("Choose a target subcollection.", "is-error");
        return;
      }
      if (actionSelect.value === "filter_copy" && !String(filterNameInput.value || "").trim()) {
        ctx.setStatus("Filter name is required.", "is-error");
        return;
      }
      if (!(await confirmPendingChanges("running scope decisions"))) {
        return;
      }
      closeModal();
      ctx.setStatus(actionSelect.value === "filter_copy" ? "Creating scope filter..." : "Moving scope items...");
      try {
        await ctx.invoke("screening.bulkRun", {
          action_kind: actionSelect.value,
          match_mode: "and",
          rules: [],
          reason: reasonInput.value,
          notes: notesInput.value,
          filter_name: filterNameInput.value,
          target_collection_key: targetSelect.value,
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
          limit: 0,
          sort_by: state.sortBy,
          order: state.order,
        });
        await applySelectedScope(selectedScopeKey, { quiet: true, page: 1 });
        ctx.setStatus(actionSelect.value === "filter_copy" ? "Scope filter created." : "Scope move complete.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
  }

  function openScopeFullTextModal() {
    const result = state.result || {};
    const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
    const scopeSelect = document.createElement("select");
    scopeSelect.setAttribute("aria-label", "Scope");
    for (const entry of scopes) {
      scopeSelect.appendChild(ctx.createNode("option", {
        attrs: { value: entry.collection_key || "" },
        textContent: entry.label || entry.collection_name || entry.collection_key || "",
      }));
    }
    scopeSelect.value = scopes.some((entry) => String(entry.collection_key || "") === String(state.scopeKey || ""))
      ? String(state.scopeKey || "")
      : String(scopes[0]?.collection_key || "");

    const summaryNode = ctx.createNode("div", {
      className: "mw-screening-scope-fulltext-summary",
      textContent: "Loading scope summary...",
    });
    const closeButtonNode = button(ctx, "Close");
    const retrievalButton = button(ctx, "Find full text for this scope", {
      className: "mw-button primary",
    });
    const excludeButton = button(ctx, "Move items without full text to Excluded");
    let latestSummary = null;

    async function loadSummary() {
      const selectedScopeKey = String(scopeSelect.value || "");
      summaryNode.textContent = "Loading scope summary...";
      try {
        latestSummary = await ctx.invoke("screening.scope.fulltext.status", {
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
        });
        summaryNode.replaceChildren(
          ctx.createNode("div", {
            className: "mw-screening-scope-fulltext-summary-grid",
            children: [
              ctx.createNode("div", { textContent: `Markdown ready: ${Number(latestSummary?.markdown_ready_count || 0) || 0}` }),
              ctx.createNode("div", { textContent: `PDF only: ${Number(latestSummary?.pdf_only_count || 0) || 0}` }),
              ctx.createNode("div", { textContent: `Missing full text: ${Number(latestSummary?.missing_full_text_count || 0) || 0}` }),
              ctx.createNode("div", { textContent: `Missing markdown: ${Number(latestSummary?.missing_markdown_count || 0) || 0}` }),
              ctx.createNode("div", { textContent: `Retrieval active: ${latestSummary?.retrieval_active ? "Yes" : "No"}` }),
              ctx.createNode("div", { textContent: `Conversion jobs: queued ${Number(latestSummary?.conversion_queued_count || 0) || 0}, running ${Number(latestSummary?.conversion_running_count || 0) || 0}, failed ${Number(latestSummary?.conversion_failed_count || 0) || 0}` }),
            ],
          }),
        );
      }
      catch (error) {
        latestSummary = null;
        summaryNode.textContent = error?.message || String(error);
      }
    }

    const body = ctx.createNode("div", {
      className: "mw-panel-stack",
      children: [
        field(ctx, "Scope", scopeSelect),
        summaryNode,
      ],
    });
    mountModal("Full text", body, [closeButtonNode, excludeButton, retrievalButton]);
    closeButtonNode.addEventListener("click", () => closeModal());
    scopeSelect.addEventListener("change", () => {
      void loadSummary();
    });
    retrievalButton.addEventListener("click", async () => {
      const selectedScopeKey = String(scopeSelect.value || state.scopeKey || "");
      if (!(await confirmPendingChanges("starting scope full-text retrieval"))) {
        return;
      }
      ctx.setStatus("Starting full-text retrieval...");
      try {
        await ctx.invoke("fullText.startRetrieval", {
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
          detach: true,
        });
        await applySelectedScope(selectedScopeKey, { quiet: true, page: 1 });
        await loadSummary();
        ctx.setStatus("Scope full-text retrieval started. Track progress in Jobs.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
    excludeButton.addEventListener("click", async () => {
      const selectedScopeKey = String(scopeSelect.value || state.scopeKey || "");
      try {
        const summary = latestSummary || await ctx.invoke("screening.scope.fulltext.status", {
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
        });
        const hasActiveWork = !!summary?.retrieval_active
          || Number(summary?.conversion_queued_count || 0) > 0
          || Number(summary?.conversion_running_count || 0) > 0;
        if (hasActiveWork) {
          const confirmed = window.confirm(
            "Full-text retrieval or markdown conversion is still running for this scope. Items without markdown may still be processing. Continue moving markdown-missing items to Excluded?"
          );
          if (!confirmed) {
            return;
          }
        }
        if (!(await confirmPendingChanges("moving markdown-missing items to Excluded"))) {
          return;
        }
        ctx.setStatus("Moving markdown-missing items to Excluded...");
        await ctx.invoke("screening.scope.fulltext.excludeMissingMarkdown", {
          ...(selectedScopeKey ? { collection_key: selectedScopeKey } : {}),
        });
        closeModal();
        await applySelectedScope(selectedScopeKey, { quiet: true, page: 1 });
        ctx.setStatus("Items without markdown full text moved to Excluded.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
    void loadSummary();
  }

  function applyColumnWidth(columnKey, width) {
    const nextWidth = Math.max(120, Number(width || defaultColumnWidth(columnKey)) || defaultColumnWidth(columnKey));
    panel.querySelectorAll(`col[data-screening-col='${columnKey}']`).forEach((node) => {
      node.style.width = `${nextWidth}px`;
      node.style.minWidth = `${nextWidth}px`;
      node.style.maxWidth = `${nextWidth}px`;
    });
    panel.querySelectorAll(`th[data-screening-header='${columnKey}']`).forEach((node) => {
      node.style.width = `${nextWidth}px`;
      node.style.minWidth = `${nextWidth}px`;
      node.style.maxWidth = `${nextWidth}px`;
    });
    panel.querySelectorAll(`td[data-screening-column='${columnKey}']`).forEach((node) => {
      node.style.width = `${nextWidth}px`;
      node.style.minWidth = `${nextWidth}px`;
      node.style.maxWidth = `${nextWidth}px`;
    });
  }

  function startColumnResize(columnKey, startWidth, event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (event.pointerId !== undefined && typeof event.target?.setPointerCapture === "function") {
        event.target.setPointerCapture(event.pointerId);
      }
    }
    catch (_error) {}
    const originX = event.clientX;
    const nextWidths = Object.assign({}, state.columnWidths);
    const doc = panel.ownerDocument || document;
    const view = doc.defaultView || window;
    state.activeResizeColumn = columnKey;
    function onMove(moveEvent) {
      const nextWidth = Math.max(120, Math.round(startWidth + (moveEvent.clientX - originX)));
      nextWidths[columnKey] = nextWidth;
      state.columnWidths = nextWidths;
      applyColumnWidth(columnKey, nextWidth);
    }
    async function onUp() {
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("mouseup", onUp, true);
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerup", onUp, true);
      view.removeEventListener("mousemove", onMove, true);
      view.removeEventListener("mouseup", onUp, true);
      view.removeEventListener("pointermove", onMove, true);
      view.removeEventListener("pointerup", onUp, true);
      state.activeResizeColumn = "";
      panel.querySelectorAll(".mw-screening-grid-table").forEach((node) => {
        node.style.cursor = "";
      });
      state.justResizedColumn = columnKey;
      view.setTimeout(() => {
        if (state.justResizedColumn === columnKey) {
          state.justResizedColumn = "";
        }
      }, 0);
      try {
        await persistPreference("column_widths", state.columnWidths);
      }
      catch (_error) {}
    }
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("mouseup", onUp, true);
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerup", onUp, true);
    view.addEventListener("mousemove", onMove, true);
    view.addEventListener("mouseup", onUp, true);
    view.addEventListener("pointermove", onMove, true);
    view.addEventListener("pointerup", onUp, true);
  }

  function showActionsHeaderContextMenu(event) {
    event.preventDefault();
    closeContextMenu();
    const menu = state.contextMenu;
    if (!menu) {
      return;
    }
    menu.replaceChildren(
      (() => {
        const item = button(ctx, "Scope decisions...", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", () => {
          closeContextMenu();
          openScopeDecisionsModal();
        });
        return item;
      })(),
      (() => {
        const item = button(ctx, "Full text...", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", () => {
          closeContextMenu();
          openScopeFullTextModal();
        });
        return item;
      })(),
    );
    menu.style.display = "flex";
    menu.style.left = `${Math.round(event.clientX)}px`;
    menu.style.top = `${Math.round(event.clientY)}px`;
  }

  function showHeaderContextMenu(event, columnKey) {
    if (String(columnKey || "") === "actions") {
      showActionsHeaderContextMenu(event);
      return;
    }
    event.preventDefault();
    closeContextMenu();
    const menu = state.contextMenu;
    if (!menu) {
      return;
    }
    menu.replaceChildren(
      (() => {
        const item = button(ctx, "Sort ascending", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", async () => {
          closeContextMenu();
          state.sortBy = columnKey;
          state.order = "asc";
          await persistSortPreference(columnKey, "asc");
          await refreshState({ sortBy: columnKey, order: "asc" });
        });
        return item;
      })(),
      (() => {
        const item = button(ctx, "Sort descending", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", async () => {
          closeContextMenu();
          state.sortBy = columnKey;
          state.order = "desc";
          await persistSortPreference(columnKey, "desc");
          await refreshState({ sortBy: columnKey, order: "desc" });
        });
        return item;
      })(),
      ctx.createNode("div", { className: "mw-screening-context-separator" }),
      (() => {
        const item = button(ctx, "Create decision...", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", () => {
          closeContextMenu();
          openBulkActionsModal({
            title: `Create decision from ${columnLabel(state.result || {}, columnKey)}`,
            actionKind: "move",
            presetColumnKey: columnKey,
          });
        });
        return item;
      })(),
      (() => {
        const item = button(ctx, "Create filter...", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", () => {
          closeContextMenu();
          openBulkActionsModal({
            title: `Create filter from ${columnLabel(state.result || {}, columnKey)}`,
            actionKind: "filter_copy",
            presetColumnKey: columnKey,
          });
        });
        return item;
      })(),
    );
    menu.style.display = "flex";
    menu.style.left = `${Math.round(event.clientX)}px`;
    menu.style.top = `${Math.round(event.clientY)}px`;
  }

  function showCellContextMenu(event, record, columnKey) {
    if (!supportsFullTextOpen(columnKey)) {
      return;
    }
    const value = normalizeText(recordCellValue(record, dirtyEditFor(record.item_key), columnKey), true);
    if (!value) {
      return;
    }
    event.preventDefault();
    closeContextMenu();
    const menu = state.contextMenu;
    if (!menu) {
      return;
    }
    menu.replaceChildren(
      (() => {
        const item = button(ctx, "Show in Full Text", {
          className: "mw-screening-context-item",
        });
        item.addEventListener("click", async () => {
          closeContextMenu();
          try {
            await ctx.invoke("screening.fulltext.open", {
              item_key: record.item_key,
              column_key: columnKey,
            });
            ctx.setStatus("Full text opened.", "is-ready");
          }
          catch (error) {
            ctx.setStatus(error?.message || String(error), "is-error");
          }
        });
        return item;
      })()
    );
    menu.style.display = "flex";
    menu.style.left = `${Math.round(event.clientX)}px`;
    menu.style.top = `${Math.round(event.clientY)}px`;
  }

  function renderGrid() {
    const rowDisplayMode = currentRowDisplayMode();
    const visibleColumns = allVisibleColumns();
    const records = Array.isArray(state.result?.records) ? state.result.records : [];
    const table = ctx.createNode("table", {
      className: `mw-screening-grid-table is-${rowDisplayMode}`,
    });
    const colgroup = document.createElement("colgroup");
    for (const key of visibleColumns) {
      const width = Number(state.columnWidths[key] || defaultColumnWidth(key));
      const col = document.createElement("col");
      col.setAttribute("data-screening-col", key);
      col.style.width = `${width}px`;
      col.style.minWidth = `${width}px`;
      col.style.maxWidth = `${width}px`;
      colgroup.appendChild(col);
    }
    const actionsCol = document.createElement("col");
    actionsCol.style.width = "260px";
    colgroup.appendChild(actionsCol);
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const columnAtResizeBoundary = (event) => {
      const threshold = 10;
      const clientX = Number(event.clientX || 0);
      for (let index = 0; index < visibleColumns.length; index += 1) {
        const key = visibleColumns[index];
        const th = headRow.children[index];
        if (!th) {
          continue;
        }
        const rect = th.getBoundingClientRect();
        if (Math.abs(clientX - rect.right) <= threshold) {
          return key;
        }
      }
      return "";
    };
    const resizeColumnAtTableBoundary = (event) => {
      if (state.activeResizeColumn || event.button > 0) {
        return;
      }
      const key = columnAtResizeBoundary(event);
      if (key) {
        startColumnResize(key, Number(state.columnWidths[key] || defaultColumnWidth(key)), event);
      }
    };
    const updateResizeCursor = (event) => {
      if (state.activeResizeColumn) {
        table.style.cursor = "col-resize";
        return;
      }
      table.style.cursor = columnAtResizeBoundary(event) ? "col-resize" : "";
    };
    table.addEventListener("pointerdown", resizeColumnAtTableBoundary, true);
    table.addEventListener("mousedown", resizeColumnAtTableBoundary, true);
    table.addEventListener("pointermove", updateResizeCursor, true);
    table.addEventListener("mousemove", updateResizeCursor, true);
    table.addEventListener("mouseleave", () => {
      if (!state.activeResizeColumn) {
        table.style.cursor = "";
      }
    });
    for (const key of visibleColumns) {
      const width = Number(state.columnWidths[key] || defaultColumnWidth(key));
      const th = ctx.createNode("th", {
        className: `mw-screening-grid-head${key === "actions" ? " actions" : ""}`,
        attrs: {
          "data-screening-header": key,
          "data-sort-order": state.sortBy === key ? state.order : "",
        },
      });
      th.style.width = `${width}px`;
      th.style.minWidth = `${width}px`;
      th.style.maxWidth = `${width}px`;
      const sortOrder = state.sortBy === key ? String(state.order || "") : "";
      const headerWrap = ctx.createNode("div", {
        className: "mw-screening-head-wrap",
        children: [
          ctx.createNode("span", {
            className: "mw-screening-head-label",
            textContent: columnLabel(state.result || {}, key),
          }),
          sortOrder
            ? ctx.createNode("span", {
                className: "mw-screening-head-sort",
                textContent: sortOrder === "asc" ? "^" : "v",
              })
            : null,
        ].filter(Boolean),
      });
      th.appendChild(headerWrap);
      th.addEventListener("click", async () => {
        if (state.activeResizeColumn === key || state.justResizedColumn === key) {
          return;
        }
        const nextOrder = state.sortBy === key && state.order === "asc" ? "desc" : "asc";
        state.sortBy = key;
        state.order = nextOrder;
        await persistSortPreference(key, nextOrder);
        await refreshState({ sortBy: key, order: nextOrder });
      });
      th.addEventListener("contextmenu", (event) => showHeaderContextMenu(event, key));
      headRow.appendChild(th);
    }
    const actionsHeader = ctx.createNode("th", {
      className: "mw-screening-grid-head actions",
    });
    actionsHeader.appendChild(ctx.createNode("div", {
      className: "mw-screening-head-wrap",
      children: [
        ctx.createNode("span", {
          className: "mw-screening-head-label",
          textContent: "Actions",
        }),
      ],
    }));
    actionsHeader.addEventListener("contextmenu", (event) => showActionsHeaderContextMenu(event));
    headRow.appendChild(actionsHeader);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const record of records) {
      const tr = document.createElement("tr");
      tr.className = `mw-screening-grid-row is-${rowDisplayMode}`;
      tr.setAttribute("data-screening-row", String(record.item_key || ""));
      if (dirtyEditFor(record.item_key)) {
        tr.classList.add("is-dirty");
      }
      for (const key of visibleColumns) {
        const width = Number(state.columnWidths[key] || defaultColumnWidth(key));
        const cell = renderCell(record, key);
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
        tr.appendChild(cell);
      }

      const pending = dirtyEditFor(record.item_key);
      const moveSelect = document.createElement("select");
      moveSelect.setAttribute("data-screening-move", record.item_key || "");
      moveSelect.className = "mw-screening-move-select";
      moveSelect.disabled = !state.editMode;
      moveSelect.appendChild(ctx.createNode("option", {
        attrs: { value: "" },
        textContent: "Move to...",
      }));
      for (const entry of Array.isArray(state.result?.decision_targets) ? state.result.decision_targets : []) {
        moveSelect.appendChild(ctx.createNode("option", {
          attrs: { value: entry.collection_key || "" },
          textContent: entry.label || entry.collection_name || entry.collection_key || "",
        }));
      }
      moveSelect.value = currentScopeValue(record, pending);
      moveSelect.addEventListener("change", () => {
        const option = moveSelect.selectedOptions?.[0] || null;
        queueMoveEdit(record.item_key, moveSelect.value, option?.textContent || "");
      });
      const moveField = field(ctx, "Move to", moveSelect);
      const moveFieldWrap = ctx.createNode("div", {
        className: `mw-screening-move-field${state.editMode ? "" : " is-disabled"}`,
        attrs: state.editMode
          ? {}
          : {
              "data-disabled-hint": "To make screening decisions, turn Edit mode on.",
              title: "To make screening decisions, turn Edit mode on.",
            },
        children: [moveField],
      });

      const openItemButton = button(ctx, "Open item", {
        attrs: { "data-screening-open-item": record.item_key || "" },
      });
      const onOpenItem = async () => {
        try {
          await ctx.invoke("screening.item.open", { item_key: record.item_key });
          ctx.setStatus("Zotero item opened.", "is-ready");
        }
        catch (error) {
          ctx.setStatus(error?.message || String(error), "is-error");
        }
      };
      openItemButton.addEventListener("click", onOpenItem);

      const fullTextState = fullTextStateForRecord(record);
      const fullTextLabel = fullTextState === "pdf_only" ? "Open Full-Text!" : "Open Full-Text";
      const openFullTextButton = button(ctx, fullTextLabel, {
        className: `mw-button mw-screening-fulltext-button${fullTextState === "pdf_only" ? " is-warning" : ""}${fullTextState === "missing" ? " is-missing" : ""}`,
        attrs: Object.assign(
          { "data-screening-open-fulltext": record.item_key || "" },
          fullTextState === "missing" ? { "aria-disabled": "true" } : {}
        ),
      });
      const fullTextWrap = ctx.createNode("div", {
        className: "mw-screening-fulltext-wrap",
        attrs: fullTextState === "pdf_only"
          ? {
              "data-fulltext-hint": "Item has a full-text PDF but no converted markdown. Click Open item, then reconvert the PDF or choose a different conversion mode.",
            }
          : {},
        children: [openFullTextButton],
      });
      const handleOpenFullText = async (anchorNode = openFullTextButton) => {
        try {
          if (fullTextState === "missing") {
            openMissingFullTextPopover(anchorNode, record);
            return;
          }
          if (fullTextState === "pdf_only") {
            await ctx.invoke("screening.pdf.open", { item_key: record.item_key });
            openTransientNotice(anchorNode, "PDF opened. Converted markdown is still missing.");
            ctx.setStatus("PDF opened. Converted markdown is still missing.", "is-ready");
            return;
          }
          await ctx.invoke("screening.item.fulltext.open", { item_key: record.item_key });
          ctx.setStatus("Full text opened.", "is-ready");
        }
        catch (error) {
          ctx.setStatus(error?.message || String(error), "is-error");
        }
      };
      openFullTextButton.addEventListener("click", () => handleOpenFullText(openFullTextButton));

      const actionsCell = ctx.createNode("td", {
        className: `mw-screening-grid-cell actions${rowDisplayMode === "collapsed" ? " is-collapsed" : " is-expanded"}${hasDirtyMove(dirtyEditFor(record.item_key)) ? " is-edited" : ""}`,
        attrs: { "data-screening-actions-row": record.item_key || "" },
        children: rowDisplayMode === "collapsed"
          ? [
              buildCompactActions(record, fullTextState, onOpenItem, handleOpenFullText),
            ]
          : [
              moveFieldWrap,
              ctx.createNode("div", {
                className: "mw-actions",
                children: [openItemButton, fullTextWrap],
              }),
            ],
      });
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return ctx.createNode("div", {
      className: `mw-screening-grid-card is-${rowDisplayMode}`,
      children: [
        ctx.createNode("div", {
          className: "mw-screening-grid-scroll",
          attrs: { "data-screening-grid-scroll": "true" },
          children: [
            records.length
              ? table
              : ctx.createNode("div", {
                  className: "mw-screening-empty",
                  textContent: "No rows in the current scope.",
                }),
          ],
        }),
        renderPagination("bottom"),
      ],
    });
  }

  function render() {
    runRenderCleanups();
    state.gridZoomSliderWrapNode = null;
    state.gridZoomSliderNode = null;
    state.gridZoomValueNode = null;
    const result = state.result || {};
    const scopes = Array.isArray(result.available_scopes) ? result.available_scopes : [];
    const currentScopeKey = String(state.scopeKey || "");
    const scopePicker = buildScrollableOptionPicker(
      scopes.map((entry) => ({
        key: entry.collection_key || "",
        label: entry.label || entry.collection_name || entry.collection_key || "",
      })),
      scopes.some((entry) => String(entry.collection_key || "") === currentScopeKey)
        ? currentScopeKey
        : String(scopes[0]?.collection_key || ""),
      registerRenderCleanup,
      {
        rootClassName: "mw-screening-scope-picker",
        triggerClassName: "mw-screening-scope-picker-trigger",
        menuClassName: "mw-screening-scope-picker-menu",
        searchPlaceholder: "Filter scopes...",
        emptyText: "No scopes match this filter.",
        metaLabel: "scopes",
        showKey: false,
        onChange: async (nextValue) => {
          await changeScope(nextValue);
        },
      },
    );
    scopePicker.node.setAttribute("data-screening-scope", "true");
    scopePicker.node.querySelector("button")?.setAttribute("aria-label", "Scope");

    const pendingFieldCount = dirtyFieldCount();
	    const editSaveButton = button(
	      ctx,
	      state.editMode ? (pendingFieldCount > 0 ? `Save (${pendingFieldCount})` : "Save") : "Edit",
      {
        className: `mw-button ${state.editMode ? "mw-screening-save-button" : "mw-screening-edit-button"}`,
        attrs: { "data-screening-action": "edit-toggle" },
      },
    );
    state.editSaveButtonNode = editSaveButton;
    editSaveButton.addEventListener("click", async () => {
      if (!state.editMode) {
        state.editMode = true;
        render();
        ctx.setStatus("Edit mode enabled.", "is-ready");
        return;
      }
      await saveEdits();
    });

	    const bulkButton = button(ctx, "Decisions / Filters", {
      attrs: { "data-screening-action": "bulk-actions" },
    });
    bulkButton.addEventListener("click", () => openBulkActionsModal({ title: "Decisions / Filters" }));

	    const descriptivesButton = button(ctx, "Descriptives", {
      attrs: { "data-screening-action": "descriptives" },
    });
    descriptivesButton.addEventListener("click", () => openDescriptivesModal());

	    const createColumnButton = button(ctx, "Create Column", {
      attrs: { "data-screening-action": "create-column" },
    });
    createColumnButton.addEventListener("click", () => openCreateColumnModal());

	    const showColumnsButton = button(ctx, "Show Columns", {
      attrs: { "data-screening-action": "show-columns" },
    });
    showColumnsButton.addEventListener("click", () => openVisibleColumnsModal());

	    const exportButton = button(ctx, "Export", {
      attrs: { "data-screening-action": "export" },
    });
    exportButton.addEventListener("click", () => openExportModal());

	    const valueTemplatesButton = button(ctx, "Value Templates", {
      attrs: { "data-screening-action": "value-templates" },
    });
    valueTemplatesButton.addEventListener("click", () => openValueTemplatesModal());

	    const refreshButton = button(ctx, "Refresh", {
      attrs: { "data-screening-action": "refresh" },
    });
    refreshButton.addEventListener("click", async () => {
      await refreshScreening();
    });

	    const rowModeButton = button(ctx, state.rowDisplayMode === "collapsed" ? "Expand" : "Collapse", {
      attrs: { "data-screening-action": "row-mode-toggle" },
    });
    rowModeButton.addEventListener("click", async () => {
      await setRowDisplayMode(state.rowDisplayMode === "collapsed" ? "expanded" : "collapsed");
    });

    panel.replaceChildren(
      ctx.createNode("div", {
        className: "mw-screening-toolbar",
        children: [
          ctx.createNode("div", {
            className: "mw-field mw-screening-toolbar-scope",
            children: [scopePicker.node],
          }),
          editSaveButton,
          rowModeButton,
          bulkButton,
          descriptivesButton,
          createColumnButton,
          showColumnsButton,
          exportButton,
          valueTemplatesButton,
          refreshButton,
        ],
      }),
      renderGrid(),
    );
    applyGridZoomStyles();
    syncGridZoomControls();
    syncEditSaveButton();
    restoreGridPosition();
  }

  state.contextMenu = ctx.createNode("div", {
    className: "mw-screening-context-menu",
  });
  document.body.appendChild(state.contextMenu);
  state.templatePopup = ctx.createNode("div", {
    className: "mw-screening-template-popup",
  });
  document.body.appendChild(state.templatePopup);

  const outsideClickHandler = (event) => {
    if (state.contextMenu && !state.contextMenu.contains(event.target)) {
      closeContextMenu();
    }
    if (state.inlinePopover && !state.inlinePopover.node?.contains(event.target) && event.target !== state.inlinePopover.anchor) {
      closeInlinePopover();
    }
    if (state.templatePopup && state.templateTarget && !state.templatePopup.contains(event.target) && event.target !== state.templateTarget) {
      closeTemplatePopup();
    }
  };
  document.addEventListener("click", outsideClickHandler, true);

  Promise.resolve(ctx.readSharedScopeKey?.())
    .catch(() => String(ctx.getSharedScopeKey?.() || ""))
    .then((scopeKey) => {
      state.scopeKey = String(scopeKey || state.scopeKey || "");
      return refreshState({ scopeKey: state.scopeKey });
    })
    .catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });

  return {
    node: panel,
    hasPendingChanges,
    canDeactivate: async (reason = "") => {
      return await confirmPendingChanges(reason || "leaving Screening");
    },
    destroy: () => {
      state.destroyed = true;
      if (state.dirtyUiFrame) {
        window.cancelAnimationFrame(state.dirtyUiFrame);
        state.dirtyUiFrame = 0;
      }
      if (state.gridZoomPersistTimer) {
        window.clearTimeout(state.gridZoomPersistTimer);
        state.gridZoomPersistTimer = 0;
      }
      runRenderCleanups();
      document.removeEventListener("click", outsideClickHandler, true);
      closeModal();
      closeContextMenu();
      closeInlinePopover();
      closeTemplatePopup();
      state.contextMenu?.remove();
      state.templatePopup?.remove();
    },
  };
}
