import { invoke } from "./host.js";

const params = new URL(window.location.href).searchParams;
const state = {
  kind: normalizeKind(params.get("viewer_type")),
  libraryID: Number(params.get("library_id") || 0) || 0,
  attachmentKey: String(params.get("attachment_key") || "").trim(),
  content: "",
  savedContent: "",
  lineEnding: "\n",
  mode: "view",
  zoom: 100,
  wrap: false,
  rows: [[""]],
  columnWidths: [],
  selectedCell: null,
  matches: [],
  activeMatch: -1,
  dirty: false,
};

const els = {
  root: document.getElementById("app"),
  viewer: document.getElementById("viewer"),
  editor: document.getElementById("editor"),
  csvGrid: document.getElementById("csv-grid"),
  csvEditToolbar: document.getElementById("csv-edit-toolbar"),
  findInput: document.getElementById("find-input"),
  findPrev: document.getElementById("find-prev"),
  findNext: document.getElementById("find-next"),
  zoomOut: document.getElementById("zoom-out"),
  zoomIn: document.getElementById("zoom-in"),
  wrapButton: document.getElementById("wrap-button"),
  viewButton: document.getElementById("view-button"),
  editButton: document.getElementById("edit-button"),
  saveButton: document.getElementById("save-button"),
  addRow: document.getElementById("add-row"),
  addColumn: document.getElementById("add-column"),
  deleteRow: document.getElementById("delete-row"),
  deleteColumn: document.getElementById("delete-column"),
  status: document.getElementById("status"),
  matchStatus: document.getElementById("match-status"),
};

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return ["markdown", "csv", "text"].includes(kind) ? kind : "text";
}

function setStatus(text, tone = "") {
  els.status.textContent = String(text || "Ready");
  els.status.classList.toggle("ready", tone === "ready");
  els.status.classList.toggle("error", tone === "error");
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function columnLabel(index) {
  let value = Math.max(0, Number(index || 0));
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function normalizeRows(rows) {
  const next = Array.isArray(rows) && rows.length ? rows : [[""]];
  const width = Math.max(1, ...next.map((row) => Array.isArray(row) ? row.length : 0));
  return next.map((row) => {
    const copy = Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [];
    while (copy.length < width) {
      copy.push("");
    }
    return copy;
  });
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === "\"") {
        if (input[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        }
        else {
          quoted = false;
        }
      }
      else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "" || !rows.length) {
    rows.push(row);
  }
  return normalizeRows(rows);
}

function serializeCSV(rows, lineEnding = "\n") {
  return normalizeRows(rows).map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
  }).join(",")).join(lineEnding);
}

function setDirty(value) {
  state.dirty = !!value;
  if (state.dirty) {
    setStatus("Unsaved changes");
  }
  else {
    setStatus("Ready", "ready");
  }
}

function applyZoom() {
  els.root.style.setProperty("--sr-av-scale", String(Math.max(0.6, Math.min(2.4, state.zoom / 100))));
}

function applyWrap() {
  els.root.classList.toggle("wrap-lines", !!state.wrap);
  if (els.wrapButton) {
    els.wrapButton.classList.toggle("primary", !!state.wrap);
    els.wrapButton.setAttribute("aria-pressed", state.wrap ? "true" : "false");
  }
  els.editor.setAttribute("wrap", state.wrap ? "soft" : "off");
}

function setMode(mode) {
  state.mode = mode === "edit" ? "edit" : "view";
  els.viewButton.classList.toggle("primary", state.mode === "view");
  els.editButton.classList.toggle("primary", state.mode === "edit");
  if (els.wrapButton) {
    els.wrapButton.hidden = state.kind === "csv";
  }
  els.csvEditToolbar.hidden = !(state.kind === "csv" && state.mode === "edit");
  if (state.kind === "csv") {
    els.viewer.hidden = true;
    els.editor.hidden = true;
    els.csvGrid.hidden = false;
    renderCSV();
  }
  else {
    els.csvGrid.hidden = true;
    els.viewer.hidden = state.mode !== "view";
    els.editor.hidden = state.mode !== "edit";
    if (state.mode === "view") {
      renderDocument();
    }
    else {
      els.editor.focus();
    }
  }
  updateFind();
}

function renderDocument() {
  const content = String(els.editor.value ?? state.content ?? "");
  if (state.kind === "markdown") {
    let html = "";
    try {
      html = window.SystematicReviewerSimpleMarkdown?.renderPageHTML
        ? window.SystematicReviewerSimpleMarkdown.renderPageHTML(content)
        : `<pre>${escapeHTML(content)}</pre>`;
    }
    catch (_error) {
      html = `<pre>${escapeHTML(content)}</pre>`;
    }
    els.viewer.className = "sr-av-viewer";
    els.viewer.innerHTML = `<article class="sr-av-markdown-document">${html}</article>`;
    return;
  }
  els.viewer.className = "sr-av-viewer text-mode";
  const pre = document.createElement("pre");
  pre.className = "sr-av-text-pre";
  pre.textContent = content;
  els.viewer.replaceChildren(pre);
}

function renderCSV() {
  state.rows = normalizeRows(state.rows);
  const colCount = Math.max(1, ...state.rows.map((row) => row.length));
  while (state.columnWidths.length < colCount) {
    state.columnWidths.push(220);
  }
  const table = document.createElement("table");
  table.className = "sr-av-csv-table";
  const colgroup = document.createElement("colgroup");
  const rowHeadCol = document.createElement("col");
  rowHeadCol.style.width = "48px";
  colgroup.append(rowHeadCol);
  for (let col = 0; col < colCount; col += 1) {
    const item = document.createElement("col");
    item.style.width = `${Math.max(60, Number(state.columnWidths[col] || 220))}px`;
    colgroup.append(item);
  }
  table.append(colgroup);
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "sr-av-csv-row-header";
  headerRow.append(corner);
  for (let col = 0; col < colCount; col += 1) {
    const th = document.createElement("th");
    th.className = "sr-av-csv-column-header";
    th.textContent = columnLabel(col);
    const resizer = document.createElement("span");
    resizer.className = "sr-av-csv-resizer";
    resizer.addEventListener("pointerdown", (event) => startColumnResize(event, col));
    th.append(resizer);
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (let rowIndex = 0; rowIndex < state.rows.length; rowIndex += 1) {
    const tr = document.createElement("tr");
    const rowHead = document.createElement("td");
    rowHead.className = "sr-av-csv-row-header";
    rowHead.textContent = String(rowIndex + 1);
    tr.append(rowHead);
    for (let col = 0; col < colCount; col += 1) {
      const td = document.createElement("td");
      td.className = "sr-av-csv-cell";
      td.dataset.row = String(rowIndex);
      td.dataset.col = String(col);
      td.textContent = state.rows[rowIndex]?.[col] ?? "";
      if (state.mode === "edit") {
        td.setAttribute("contenteditable", "true");
        td.addEventListener("input", () => {
          state.rows[rowIndex][col] = td.textContent || "";
          setDirty(true);
        });
        td.addEventListener("paste", (event) => {
          event.preventDefault();
          const text = event.clipboardData?.getData("text/plain") || "";
          document.execCommand("insertText", false, text);
        });
        td.addEventListener("keydown", handleCSVCellKeydown);
      }
      td.addEventListener("focus", () => {
        state.selectedCell = { row: rowIndex, col };
        updateCSVSelection();
      });
      td.addEventListener("click", () => {
        state.selectedCell = { row: rowIndex, col };
        updateCSVSelection();
      });
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  els.csvGrid.replaceChildren(table);
  updateCSVSelection();
}

function updateCSVSelection() {
  els.csvGrid.querySelectorAll(".sr-av-csv-cell.selected").forEach((node) => node.classList.remove("selected"));
  if (!state.selectedCell) {
    return;
  }
  const cell = els.csvGrid.querySelector(`[data-row="${state.selectedCell.row}"][data-col="${state.selectedCell.col}"]`);
  cell?.classList.add("selected");
}

function handleCSVCellKeydown(event) {
  if (event.key !== "Tab") {
    return;
  }
  event.preventDefault();
  const row = Number(event.currentTarget.dataset.row || 0) || 0;
  const col = Number(event.currentTarget.dataset.col || 0) || 0;
  let nextCol = col + (event.shiftKey ? -1 : 1);
  let nextRow = row;
  if (nextCol < 0) {
    nextRow = Math.max(0, row - 1);
    nextCol = Math.max(0, state.rows[0].length - 1);
  }
  if (nextCol >= state.rows[0].length) {
    nextRow = Math.min(state.rows.length - 1, row + 1);
    nextCol = 0;
  }
  els.csvGrid.querySelector(`[data-row="${nextRow}"][data-col="${nextCol}"]`)?.focus();
}

function startColumnResize(event, col) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = Math.max(60, Number(state.columnWidths[col] || 220));
  const pointerID = event.pointerId;
  try {
    event.currentTarget.setPointerCapture?.(pointerID);
  }
  catch (_error) {}
  const move = (moveEvent) => {
    state.columnWidths[col] = Math.max(60, startWidth + (moveEvent.clientX - startX));
    const tableCol = els.csvGrid.querySelector(`colgroup col:nth-child(${col + 2})`);
    if (tableCol) {
      tableCol.style.width = `${state.columnWidths[col]}px`;
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
}

function currentSearchRoot() {
  if (state.kind === "csv") {
    return els.csvGrid;
  }
  return state.mode === "edit" ? els.editor : els.viewer;
}

function updateFind(options = {}) {
  const query = String(els.findInput.value || "").trim();
  state.matches = [];
  state.activeMatch = -1;
  els.matchStatus.textContent = "";
  if (!query) {
    if (state.mode === "view" && state.kind !== "csv") {
      renderDocument();
    }
    return;
  }
  if (state.kind === "csv") {
    const lower = query.toLowerCase();
    state.rows.forEach((row, rowIndex) => {
      row.forEach((cell, col) => {
        if (String(cell || "").toLowerCase().includes(lower)) {
          state.matches.push({ row: rowIndex, col });
        }
      });
    });
    if (state.matches.length) {
      state.activeMatch = options.keepActive ? Math.min(state.activeMatch, state.matches.length - 1) : 0;
      focusCSVMatch();
    }
    els.matchStatus.textContent = state.matches.length ? `1 / ${state.matches.length}` : "0 / 0";
    return;
  }
  if (state.mode === "edit") {
    const haystack = String(els.editor.value || "").toLowerCase();
    const needle = query.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      state.matches.push({ index, length: query.length });
      index = haystack.indexOf(needle, index + Math.max(1, query.length));
    }
    if (state.matches.length) {
      state.activeMatch = 0;
      focusTextAreaMatch();
    }
    els.matchStatus.textContent = state.matches.length ? `1 / ${state.matches.length}` : "0 / 0";
    return;
  }
  highlightViewer(query);
}

function highlightViewer(query) {
  renderDocument();
  const root = currentSearchRoot();
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node);
    node = walker.nextNode();
  }
  const re = new RegExp(regexEscape(query), "ig");
  for (const textNode of textNodes) {
    const text = textNode.nodeValue || "";
    if (!re.test(text)) {
      continue;
    }
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let match = null;
    while ((match = re.exec(text))) {
      if (match.index > cursor) {
        frag.append(document.createTextNode(text.slice(cursor, match.index)));
      }
      const mark = document.createElement("mark");
      mark.className = "sr-av-find-hit";
      mark.textContent = match[0];
      frag.append(mark);
      cursor = match.index + match[0].length;
      state.matches.push({ node: mark });
    }
    if (cursor < text.length) {
      frag.append(document.createTextNode(text.slice(cursor)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  if (state.matches.length) {
    state.activeMatch = 0;
    focusViewerMatch();
  }
  els.matchStatus.textContent = state.matches.length ? `1 / ${state.matches.length}` : "0 / 0";
}

function moveFind(delta) {
  if (!state.matches.length) {
    updateFind();
    return;
  }
  state.activeMatch = (state.activeMatch + delta + state.matches.length) % state.matches.length;
  if (state.kind === "csv") {
    focusCSVMatch();
  }
  else if (state.mode === "edit") {
    focusTextAreaMatch();
  }
  else {
    focusViewerMatch();
  }
  els.matchStatus.textContent = `${state.activeMatch + 1} / ${state.matches.length}`;
}

function focusViewerMatch() {
  els.viewer.querySelectorAll("mark.sr-av-find-hit.active").forEach((node) => node.classList.remove("active"));
  const item = state.matches[state.activeMatch];
  const node = item?.node;
  if (!node) {
    return;
  }
  node.classList.add("active");
  node.scrollIntoView({ block: "center", inline: "center" });
}

function focusTextAreaMatch() {
  const item = state.matches[state.activeMatch];
  if (!item) {
    return;
  }
  els.editor.focus();
  els.editor.setSelectionRange(item.index, item.index + item.length);
}

function focusCSVMatch() {
  const item = state.matches[state.activeMatch];
  if (!item) {
    return;
  }
  state.selectedCell = { row: item.row, col: item.col };
  updateCSVSelection();
  const cell = els.csvGrid.querySelector(`[data-row="${item.row}"][data-col="${item.col}"]`);
  cell?.scrollIntoView({ block: "center", inline: "center" });
  cell?.focus?.();
}

async function loadAttachment() {
  setStatus("Loading...");
  const payload = await invoke("attachmentViewer.load", {
    library_id: state.libraryID,
    attachment_key: state.attachmentKey,
    viewer_type: state.kind,
  });
  state.kind = normalizeKind(payload.kind || state.kind);
  state.content = String(payload.content || "");
  state.savedContent = state.content;
  state.lineEnding = payload.line_ending || (state.content.includes("\r\n") ? "\r\n" : "\n");
  document.title = payload.window_title || payload.title || "Systematic Reviewer Attachment Viewer";
  els.findInput.placeholder = state.kind === "csv" ? "Find cell" : "Find";
  els.viewButton.textContent = state.kind === "markdown" ? "Preview" : "View";
  els.editor.value = state.content;
  if (state.kind === "csv") {
    state.rows = parseCSV(state.content);
  }
  const initialFind = String(params.get("search_query") || params.get("highlight_text") || "").trim();
  if (initialFind) {
    els.findInput.value = initialFind;
  }
  setMode("view");
  setDirty(false);
  setStatus("Ready", "ready");
}

async function saveAttachment() {
  let content = "";
  if (state.kind === "csv") {
    content = serializeCSV(state.rows, state.lineEnding);
  }
  else {
    content = String(els.editor.value || "");
  }
  setStatus("Saving...");
  await invoke("attachmentViewer.save", {
    library_id: state.libraryID,
    attachment_key: state.attachmentKey,
    viewer_type: state.kind,
    content,
  });
  state.content = content;
  state.savedContent = content;
  if (state.kind !== "csv") {
    els.editor.value = content;
  }
  setDirty(false);
  setStatus("Saved", "ready");
}

function addRow() {
  const width = Math.max(1, state.rows[0]?.length || 1);
  state.rows.push(Array.from({ length: width }, () => ""));
  setDirty(true);
  renderCSV();
}

function addColumn() {
  state.rows = normalizeRows(state.rows).map((row) => row.concat(""));
  state.columnWidths.push(220);
  setDirty(true);
  renderCSV();
}

function deleteRow() {
  if (!state.selectedCell || state.rows.length <= 1) {
    return;
  }
  state.rows.splice(state.selectedCell.row, 1);
  state.selectedCell.row = Math.min(state.selectedCell.row, state.rows.length - 1);
  setDirty(true);
  renderCSV();
}

function deleteColumn() {
  if (!state.selectedCell || (state.rows[0]?.length || 0) <= 1) {
    return;
  }
  const col = state.selectedCell.col;
  state.rows.forEach((row) => row.splice(col, 1));
  state.columnWidths.splice(col, 1);
  state.selectedCell.col = Math.min(col, (state.rows[0]?.length || 1) - 1);
  setDirty(true);
  renderCSV();
}

function wireEvents() {
  els.viewButton.addEventListener("click", () => setMode("view"));
  els.editButton.addEventListener("click", () => setMode("edit"));
  els.saveButton.addEventListener("click", () => saveAttachment().catch((error) => {
    setStatus(error?.message || String(error), "error");
  }));
  els.zoomOut.addEventListener("click", () => {
    state.zoom = Math.max(50, state.zoom - 10);
    applyZoom();
  });
  els.zoomIn.addEventListener("click", () => {
    state.zoom = Math.min(240, state.zoom + 10);
    applyZoom();
  });
  els.wrapButton?.addEventListener("click", () => {
    state.wrap = !state.wrap;
    applyWrap();
    if (state.mode === "view" && state.kind !== "csv") {
      renderDocument();
      updateFind({ keepActive: true });
    }
  });
  els.findInput.addEventListener("input", () => updateFind());
  els.findPrev.addEventListener("click", () => moveFind(-1));
  els.findNext.addEventListener("click", () => moveFind(1));
  els.editor.addEventListener("input", () => setDirty(true));
  els.addRow.addEventListener("click", addRow);
  els.addColumn.addEventListener("click", addColumn);
  els.deleteRow.addEventListener("click", deleteRow);
  els.deleteColumn.addEventListener("click", deleteColumn);
  window.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      saveAttachment().catch((error) => setStatus(error?.message || String(error), "error"));
    }
    if ((event.metaKey || event.ctrlKey) && key === "f") {
      event.preventDefault();
      els.findInput.focus();
      els.findInput.select();
    }
  }, true);
}

wireEvents();
applyZoom();
applyWrap();
loadAttachment().catch((error) => {
  setStatus(error?.message || String(error), "error");
  els.viewer.className = "sr-av-viewer";
  els.viewer.innerHTML = `<div class="sr-av-error">${escapeHTML(error?.message || String(error))}</div>`;
});
