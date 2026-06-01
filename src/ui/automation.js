import { cleanDisplayText, compactStatusText } from "./text-utils.js";
import { hasMarkdownTable, renderExploreMarkdown } from "./explore-markdown.js";
import { createPrismaSurface } from "./prisma.js";
import { createSearchablePlaceholderAutocomplete } from "./searchable-autocomplete.js";

const AUTOMATION_MARKDOWN_CLIPBOARD_MIME = "application/x-systematic-reviewer-markdown";

const AUTOMATION_WORKSPACE_CSS = `
.mw-automation-panel {
  padding: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  height: 100%;
}
.mw-automation-host {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.sr-workspace-root {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  --sr-font-family: Georgia;
  --sr-font-size: 12px;
  --sr-line-height: 1.6;
  --sr-page-view-scale: 1;
  --sr-page-gap: 22px;
  --sr-paragraph-align: left;
  --sr-paragraph-indent: 0in;
  --sr-sidebar-width: 360px;
  --sr-sidebar-min-width: 240px;
  --sr-splitter-size: 8px;
}
.sr-workspace-root,
.sr-workspace-root * { box-sizing: border-box; }
.sr-workspace-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--sr-splitter-size) minmax(var(--sr-sidebar-min-width), var(--sr-sidebar-width));
  gap: 0;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.sr-workspace-shell.is-resizing {
  cursor: col-resize;
  user-select: none;
}
.sr-workspace-shell > * {
  min-width: 0;
  min-height: 0;
}
.sr-workspace-main,
.sr-workspace-sidebar > .sr-workspace-card,
.sr-workspace-card {
  background: var(--mw-panel);
  border: 0;
}
.sr-workspace-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 0;
  background: transparent;
}
.sr-workspace-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  max-width: none;
  min-width: var(--sr-sidebar-min-width);
  width: auto;
  height: 100%;
  overflow: hidden;
}
.sr-workspace-divider {
  position: relative;
  width: 100%;
  min-width: 0;
  cursor: col-resize;
}
.sr-workspace-divider::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-50%);
  background: color-mix(in srgb, var(--mw-border) 92%, transparent);
}
.sr-workspace-divider::after {
  content: "";
  position: absolute;
  inset: 0;
  background: transparent;
}
.sr-workspace-shell.is-resizing .sr-workspace-divider::before,
.sr-workspace-divider:hover::before {
  background: var(--mw-accent);
}
.sr-workspace-sidebar > .sr-workspace-card {
  flex: 1 1 auto;
  height: 100%;
  overflow: hidden;
}
.sr-workspace-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.sr-workspace-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--mw-border);
}
.sr-chat-card-header {
  border-bottom: 0;
}
.sr-workspace-card-title { font-size: var(--mw-font-13); font-weight: 600; }
.sr-workspace-card-body {
  padding: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
  background: transparent;
  overflow: hidden;
}
.sr-workspace-main .sr-workspace-card-body { background: transparent; }
.sr-workspace-topbar {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:8px;
  padding:6px 8px;
  background: var(--mw-panel);
  border:0;
  border-bottom:1px solid var(--mw-border);
}
.sr-workspace-topbar-copy { display:flex; flex-direction:column; gap:4px; min-width:0; }
.sr-workspace-title { font-size: var(--mw-font-13); font-weight: 700; }
.sr-workspace-path { color: var(--mw-muted); }
.sr-workspace-toolbar,
.sr-mode-tabs,
.sr-chat-actions { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.sr-editor-toolbar,
.sr-editor-settings,
.sr-chat-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-width: 0;
  overflow: visible;
  white-space: normal;
}
.sr-editor-toolbar {
  flex: 1 1 auto;
  width: 100%;
  align-content: flex-start;
}
.sr-editor-toolbar > *,
.sr-editor-settings > * {
  flex-shrink: 0;
  min-width: 0;
}
.sr-editor-toolbar[hidden],
.sr-editor-settings[hidden],
.sr-editor-toolbar [hidden],
.sr-chat-command-menu[hidden] {
  display: none !important;
}
.sr-editor-toolbar-strip,
.sr-editor-footer-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--mw-border);
}
.sr-editor-toolbar-strip {
  background: var(--mw-panel);
  flex-direction: row;
}
.sr-editor-toolbar-strip > * {
  flex: 0 1 auto;
  min-width: 0;
}
.sr-editor-settings {
  flex: 1 1 auto;
}
.sr-editor-footer-strip {
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 0;
  border-top: 1px solid var(--mw-border);
  background: var(--mw-panel);
  flex: 0 0 auto;
  min-height: calc(var(--mw-control-height, 28px) + 4px);
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  box-sizing: border-box;
}
.sr-editor-footer-strip > * { flex-shrink:0; min-width:0; }
.sr-editor-footer-main {
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
  flex:1 1 auto;
}
.sr-editor-footer-actions {
  display:inline-flex;
  align-items:center;
  gap:6px;
  min-width:0;
  flex:0 0 auto;
  border:0;
  overflow:visible;
}
.sr-editor-footer-zoom,
.sr-chat-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sr-editor-footer-zoom {
  flex: 1 1 auto;
  min-width: 210px;
  min-height: var(--mw-control-height, 28px);
  justify-content: flex-end;
  flex-wrap: nowrap;
  font-size: var(--mw-font-13);
}
.sr-citation-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.sr-mode-tabs {
  display: inline-flex;
  flex-wrap: nowrap;
  min-width: max-content;
  min-height: var(--mw-control-height, 28px);
  border: 1px solid var(--mw-border);
  border-radius: var(--mw-radius-sm, 4px) !important;
  padding: 1px;
  background: var(--mw-panel);
  overflow: visible;
  margin-right: 0;
  gap: 2px;
  box-sizing: border-box;
}
.sr-mode-tab,
.sr-workspace-btn,
.sr-workspace-send,
.sr-context-menu-item,
.sr-editor-select,
.sr-editor-input,
.sr-editor-size,
.sr-editor-range,
.sr-workspace-chat-input,
.sr-workspace-raw,
.sr-field-input {
  min-height: var(--mw-control-height, 28px);
  border: 1px solid var(--mw-border);
  background: var(--mw-panel);
  color: var(--mw-text);
  font: inherit;
  border-radius: var(--mw-radius-sm, 4px);
}
.sr-editor-select,
.sr-editor-input,
.sr-editor-size,
.sr-workspace-chat-input,
.sr-field-input {
  background: var(--mw-control-bg, var(--mw-panel));
}
.sr-workspace-btn,
.sr-workspace-send,
.sr-context-menu-item,
.sr-mode-tab {
  padding: 0 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sr-workspace-btn,
.sr-workspace-send,
.sr-editor-select,
.sr-editor-input,
.sr-editor-size { min-height:var(--mw-control-height, 28px); padding:2px 8px; font-size:var(--mw-font-13); }
.sr-editor-command-select { min-width:92px; width:92px; flex:0 0 92px; }
.sr-layout-select { min-width:96px; width:96px; flex:0 0 96px; }
.sr-page-number-select { min-width:150px; width:150px; flex:0 0 150px; }
.sr-font-select { min-width:170px; width:170px; max-width:170px; flex:0 0 170px; }
.sr-citation-style-select { min-width:220px; width:220px; max-width:220px; flex:0 0 220px; }
.sr-mode-tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--mw-text);
  white-space: nowrap;
  border-radius: var(--mw-radius-sm, 4px) !important;
}
.sr-mode-tabs .sr-mode-tab {
  min-height: calc(var(--mw-control-height, 28px) - 4px);
  padding-top: 0;
  padding-bottom: 0;
}
.sr-mode-tab.active,
.sr-workspace-btn-primary,
.sr-workspace-send {
  background: var(--mw-primary-bg, var(--mw-accent));
  border-color: var(--mw-primary-border, var(--mw-accent));
  color: var(--mw-primary-text, #fff);
}
.sr-mode-tab.active:hover,
.sr-workspace-btn-primary:hover,
.sr-workspace-send:hover {
  background: var(--mw-primary-hover-bg, var(--mw-primary-bg, var(--mw-accent)));
  border-color: var(--mw-primary-hover-border, var(--mw-primary-border, var(--mw-accent)));
}
.sr-mode-tab:not(.active):hover {
  border-color: var(--mw-border);
  background: var(--mw-control-soft-bg, var(--mw-panel));
}
.sr-citation-action {
  border-color: rgba(166, 52, 64, 0.78);
  background: color-mix(in srgb, rgba(166, 52, 64, 0.14) 100%, var(--mw-panel));
}
.sr-editor-footer-button {
  border:1px solid var(--mw-border);
  border-radius:var(--mw-radius-sm, 4px) !important;
  background:var(--mw-panel);
  min-height:var(--mw-control-height, 28px);
}
.sr-editor-footer-button.sr-workspace-btn-primary,
.sr-editor-footer-button.sr-editor-save-dirty {
  background:#d6781a;
  border-color:#d6781a;
  color:#ffffff;
}
.sr-editor-footer-button.sr-workspace-btn-primary:hover,
.sr-editor-footer-button.sr-editor-save-dirty:hover {
  background:#b86310;
  border-color:#b86310;
  color:#ffffff;
}
.sr-editor-footer-actions .sr-editor-footer-button:first-child {
  border-left:1px solid var(--mw-border);
}
.sr-editor-select, .sr-editor-input, .sr-editor-size, .sr-field-input { padding:0 8px; }
.sr-editor-range-wrap {
  --sr-range-percent: 50%;
  position: relative;
  width: 132px;
  height: var(--mw-control-height, 28px);
  flex: 0 0 132px;
}
.sr-editor-range {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: auto;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  appearance: none;
  -moz-appearance: none;
  opacity: 0;
  cursor: pointer;
}
.sr-editor-range-track,
.sr-editor-range-thumb-visual {
  position: absolute;
  pointer-events: none;
}
.sr-editor-range-track {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  transform: translateY(-50%);
  background: color-mix(in srgb, var(--mw-text) 22%, transparent);
}
.sr-editor-range-thumb-visual {
  left: var(--sr-range-percent);
  top: 50%;
  width: 6px;
  height: 16px;
  transform: translate(-50%, -50%);
  background: var(--mw-zoom-thumb-bg, color-mix(in srgb, var(--mw-text, #303743) 78%, var(--mw-panel, #ffffff)));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--mw-text) 12%, transparent);
}
.sr-editor-range::-moz-range-track {
  height: 1px;
  background: transparent;
  border: 0;
}
.sr-editor-range::-moz-range-thumb {
  -moz-appearance: none;
  width: 4px;
  height: 18px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  opacity: 0;
}
.sr-editor-range::-moz-range-progress {
  background: transparent;
  border: 0;
}
.sr-editor-range::-webkit-slider-runnable-track {
  height: 1px;
  background: transparent;
  border: 0;
}
.sr-editor-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 4px;
  height: 18px;
  margin-top: -8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.sr-editor-range-value, .sr-editor-footer-label, .sr-editor-style-note { color: var(--mw-muted); }
.sr-workspace-status { min-height:var(--mw-control-height, 28px); inline-size:10ch; max-inline-size:10ch; padding:0 8px; display:inline-flex; align-items:center; justify-content:flex-start; border:0; background:transparent; color: var(--mw-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:0 0 10ch; box-sizing:border-box; cursor:help; font-size:var(--mw-font-12); }
.sr-workspace-status.ready { color: var(--mw-success); }
.sr-workspace-status.error { color: var(--mw-error); }
.mw-status-tooltip { position:fixed; z-index:2147483000; max-width:min(560px, calc(100vw - 16px)); padding:5px 8px; border:1px solid var(--mw-border); background:var(--mw-panel); color:var(--mw-text); box-shadow:0 8px 24px rgba(0,0,0,0.18); font-size:var(--mw-font-12); line-height:1.35; white-space:normal; overflow-wrap:anywhere; pointer-events:none; }
.mw-status-tooltip[hidden] { display:none; }
.sr-workspace-preview,
.sr-workspace-native {
  display: flex;
  flex-direction: column;
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: transparent;
  font-family: var(--sr-font-family), Georgia, serif;
  font-size: var(--sr-font-size);
  line-height: var(--sr-line-height);
  color: var(--mw-text);
  padding: 0;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.sr-workspace-raw {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  resize: none;
  border: 0;
  outline: none;
  background: var(--mw-raw-editor-bg, var(--mw-panel-soft));
  color: var(--mw-text);
  padding: 8px;
  font: 13px/1.45 ui-monospace, "SFMono-Regular", Menlo, monospace;
  overflow: auto;
  box-sizing: border-box;
  overscroll-behavior: contain;
  scrollbar-gutter: stable both-edges;
}
.sr-workspace-card-body > [data-automation-surface][hidden] {
  display: none !important;
}
.sr-workspace-chat-messages {
  display:flex;
  flex-direction:column;
  gap:6px;
  flex: 1 1 auto;
  min-height:0;
  max-height:none;
  overflow:auto;
  padding: 8px;
  background: var(--mw-panel);
  overscroll-behavior: contain;
  scrollbar-gutter: stable both-edges;
}
.sr-workspace-message {
  display:flex;
  flex-direction:column;
  gap:4px;
  align-self:flex-start;
  width:min(100%, 72ch);
  max-width:min(100%, 72ch);
  min-width:0;
  font-size:var(--mw-font-13);
  line-height:1.35;
}
.sr-workspace-message-user {
  align-self:flex-end;
  width:auto;
  border:0;
  background: color-mix(in srgb, var(--mw-accent-soft) 75%, var(--mw-panel) 25%);
  padding:6px 8px;
}
.sr-workspace-message-assistant {
  border:0;
  background:transparent;
  padding:0;
}
.sr-workspace-message-event {
  border:0;
  background:transparent;
  padding:0;
  gap:0;
}
.sr-workspace-message-status {
  border:0;
  background:transparent;
  padding:0;
}
.sr-workspace-message-system { }
.sr-workspace-message-tool { }
.sr-workspace-message-thinking { }
.sr-workspace-message-live-plan { }
.sr-workspace-message-live-status { }
.sr-workspace-message-live-output { }
.sr-workspace-message-placeholder { opacity:0.86; }
.sr-workspace-message-role,
.sr-workspace-message-title { display:none; }
.sr-workspace-message-details { display:block; }
.sr-workspace-message-summary {
  cursor:pointer;
  font-size:inherit;
  font-weight:600;
  list-style:none;
  display:flex;
  align-items:center;
  gap:4px;
  min-height:22px;
  padding:2px 0;
  border:0;
  background:transparent;
}
.sr-workspace-message-summary::before {
  content: ">";
  flex:0 0 auto;
  font-size:var(--mw-font-10);
  color:var(--mw-muted);
  transform-origin:center;
  transition:transform 120ms ease;
}
.sr-workspace-message-details[open] .sr-workspace-message-summary::before {
  transform:rotate(90deg);
}
.sr-workspace-message-summary::-webkit-details-marker { display:none; }
.sr-workspace-message-details-body {
  margin:3px 0 6px 12px;
  padding:6px 8px;
  border:0;
  border-left:1px solid var(--mw-border);
  background: color-mix(in srgb, var(--mw-panel-soft) 94%, var(--mw-panel) 6%);
}
.sr-workspace-message-thinking .sr-workspace-message-summary,
.sr-workspace-message-thinking .sr-workspace-message-details-body {
  background:transparent;
}
.sr-workspace-message-tool .sr-workspace-message-summary,
.sr-workspace-message-tool .sr-workspace-message-details-body {
  background:transparent;
}
.sr-workspace-message-text { white-space:pre-wrap; word-break:break-word; }
.sr-workspace-message-assistant .sr-workspace-message-text {
  font-size:inherit;
  line-height:1.45;
}
.sr-workspace-message-status .sr-workspace-message-text,
.sr-workspace-message-live-status .sr-workspace-message-text {
  display:inline-flex;
  align-items:center;
  width:auto;
  max-width:100%;
  padding:3px 6px;
  border:0;
  background: color-mix(in srgb, var(--mw-panel-soft) 92%, var(--mw-panel) 8%);
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
}
.sr-workspace-message-live-status .sr-workspace-message-text {
  border-left:1px solid var(--mw-border);
}
.sr-workspace-message-live-plan .sr-workspace-message-summary,
.sr-workspace-message-live-plan .sr-workspace-message-details-body {
  background: color-mix(in srgb, var(--mw-panel-soft) 96%, var(--mw-panel) 4%);
  border-color: color-mix(in srgb, var(--mw-accent) 32%, var(--mw-border) 68%);
}
.sr-workspace-message-live-plan .sr-workspace-message-summary {
  padding:3px 0;
}
.sr-workspace-message-live-reasoning .sr-workspace-message-title {
  display:block;
  margin:0 0 6px 0;
  font-size:var(--mw-font-12);
  font-weight:600;
}
.sr-workspace-message-live-reasoning .sr-workspace-message-text {
  padding:6px 8px;
  border:0;
  border-left:1px solid var(--mw-border);
  background: color-mix(in srgb, var(--mw-panel-soft) 95%, var(--mw-panel) 5%);
}
.sr-workspace-message-live-output .sr-workspace-message-text {
  font-size:var(--mw-font-12);
  color:var(--mw-muted);
}
.sr-workspace-message-markdown {
  max-width:100%;
}
.sr-workspace-message-explore {
  width:min(100%, 88ch);
  max-width:min(100%, 88ch);
  padding:6px 8px;
  border:0;
  border-left:1px solid var(--mw-border);
  background: color-mix(in srgb, var(--mw-panel-soft) 96%, var(--mw-panel) 4%);
  gap:6px;
}
.sr-workspace-message-explore .sr-workspace-message-title {
  display:block;
  font-size:var(--mw-font-12);
  font-weight:600;
}
.sr-workspace-message-explore .mw-explore-markdown {
  display:flex;
  flex-direction:column;
  gap:6px;
}
.sr-workspace-message-explore .mw-explore-markdown p,
.sr-workspace-message-explore .mw-explore-markdown h1,
.sr-workspace-message-explore .mw-explore-markdown h2,
.sr-workspace-message-explore .mw-explore-markdown h3,
.sr-workspace-message-explore .mw-explore-markdown h4,
.sr-workspace-message-explore .mw-explore-markdown h5,
.sr-workspace-message-explore .mw-explore-markdown h6 {
  margin:0;
}
.sr-workspace-message-explore .mw-explore-table-wrap {
  overflow:auto;
}
.sr-workspace-message-explore .mw-explore-table-wrap table {
  width:100%;
  border-collapse:collapse;
}
.sr-workspace-message-explore .mw-explore-table-wrap th,
.sr-workspace-message-explore .mw-explore-table-wrap td {
  border:1px solid var(--mw-border);
  padding:4px 6px;
  vertical-align:top;
}
	.sr-workspace-message-explore .mw-explore-citation {
	  color:var(--mw-accent);
	}
	.sr-workspace-message-model-input {
	  width:min(100%, 98ch);
	  max-width:100%;
	  padding:6px 8px;
	  border-left:1px solid color-mix(in srgb, var(--mw-accent) 42%, var(--mw-border) 58%);
	  background:color-mix(in srgb, var(--mw-panel-soft) 97%, var(--mw-panel) 3%);
	}
	.sr-model-input-preview-summary {
	  color:var(--mw-text);
	}
	.sr-model-input-preview-meta {
	  margin:4px 0 6px 12px;
	  color:var(--mw-muted);
	  font-size:var(--mw-font-11);
	  line-height:1.35;
	  white-space:normal;
	}
	.sr-model-input-preview-sections {
	  display:flex;
	  flex-direction:column;
	  gap:6px;
	  margin-left:12px;
	}
	.sr-model-input-preview-section {
	  border:1px solid var(--mw-border);
	  border-radius:7px !important;
	  background:var(--mw-panel);
	  overflow:hidden;
	}
	.sr-model-input-preview-section-summary {
	  cursor:pointer;
	  padding:5px 7px;
	  font-size:var(--mw-font-11);
	  font-weight:600;
	  color:var(--mw-text);
	}
	.sr-model-input-preview-text {
	  box-sizing:border-box;
	  display:block;
	  width:100%;
	  min-height:220px;
	  max-height:460px;
	  resize:vertical;
	  border:0;
	  border-top:1px solid var(--mw-border);
	  background:var(--mw-control-bg);
	  color:var(--mw-text);
	  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	  font-size:var(--mw-font-11);
	  line-height:1.35;
	  padding:8px;
	  white-space:pre;
	  overflow:auto;
	}
	.sr-workspace-message .mw-explore-markdown {
  display:flex;
  flex-direction:column;
  gap:6px;
  max-width:100%;
}
.sr-workspace-message .mw-explore-markdown p,
.sr-workspace-message .mw-explore-markdown h1,
.sr-workspace-message .mw-explore-markdown h2,
.sr-workspace-message .mw-explore-markdown h3,
.sr-workspace-message .mw-explore-markdown h4,
.sr-workspace-message .mw-explore-markdown h5,
.sr-workspace-message .mw-explore-markdown h6 {
  margin:0;
}
.sr-workspace-message .mw-explore-table-wrap {
  max-width:100%;
  overflow-x:auto;
  overflow-y:hidden;
  padding-bottom:2px;
}
.sr-workspace-message .mw-explore-table-wrap table {
  width:max-content;
  min-width:100%;
  max-width:none;
  border-collapse:collapse;
}
.sr-workspace-message .mw-explore-table-wrap th,
.sr-workspace-message .mw-explore-table-wrap td {
  border:1px solid var(--mw-border);
  padding:4px 6px;
  vertical-align:top;
}
.sr-workspace-message .mw-explore-citation {
  color:var(--mw-accent);
}
.sr-workspace-chat-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 0 0 auto;
  position: relative;
  gap: 6px;
  padding: 0 8px 8px;
  border-top: 0;
  background: var(--mw-panel);
}
.sr-workspace-chat-input {
  width:100%;
  min-height:60px;
  padding:6px 8px;
  resize:vertical;
  background: var(--mw-control-bg, var(--mw-panel-soft));
}
.sr-chat-command-menu {
  position:absolute;
  left:8px;
  right:8px;
  bottom:calc(100% + 6px);
  display:flex;
  flex-direction:column;
  max-height:220px;
  overflow:auto;
  border:1px solid var(--mw-border);
  background:var(--mw-panel);
  z-index:80;
}
.sr-chat-command-item {
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:2px;
  padding:5px 8px;
  border:0;
  border-bottom:1px solid var(--mw-border);
  background:transparent;
  color:var(--mw-text);
  text-align:left;
  cursor:pointer;
}
.sr-chat-command-item:last-child {
  border-bottom:0;
}
.sr-chat-command-item.active,
.sr-chat-command-item:hover {
  background: color-mix(in srgb, var(--mw-accent-soft) 60%, var(--mw-panel) 40%);
}
.sr-chat-command-title {
  font-weight:600;
}
.sr-chat-command-description,
.sr-chat-run-status {
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
}
.sr-chat-run-status { display:none !important; }
.sr-chat-budget-strip {
  display:flex;
  align-items:center;
  flex:0 0 auto;
  min-width:max-content;
}
.sr-chat-explore-strip {
  display:grid;
  grid-template-columns:minmax(0, 1fr);
  gap:6px;
  padding:6px 8px;
  border:0;
  border-top:1px solid var(--mw-border);
  background:var(--mw-panel-soft);
}
.sr-chat-explore-strip[hidden] {
  display:none !important;
}
.sr-chat-explore-top {
  display:grid;
  grid-template-columns:minmax(0, 1fr) auto;
  align-items:flex-start;
  gap:6px 8px;
}
.sr-chat-explore-copy {
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:0;
  cursor:help;
}
.sr-chat-explore-summary {
  font-size:var(--mw-font-12);
  font-weight:600;
  color:var(--mw-text);
  line-height:1.35;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:100%;
  display:block;
}
.sr-chat-explore-columns-preview {
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
  line-height:1.4;
  display:block;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:100%;
}
.sr-chat-explore-status {
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
  line-height:1.4;
}
.sr-chat-explore-status[hidden] {
  display:none !important;
}
.sr-chat-explore-status.is-error {
  color:#b42318;
}
.sr-chat-explore-scope-field {
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:180px;
}
.sr-chat-explore-confirm {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px 8px;
  flex-wrap:wrap;
  padding-top:6px;
  border-top:1px solid var(--mw-border);
}
.sr-chat-explore-confirm[hidden] {
  display:none !important;
}
.sr-chat-explore-confirm-copy {
  font-size:var(--mw-font-11);
  color:var(--mw-text);
  line-height:1.4;
}
.sr-chat-explore-confirm-actions {
  display:flex;
  align-items:center;
  gap:6px;
  margin-left:auto;
}
.sr-chat-find-strip {
  gap:6px;
}
.sr-chat-find-controls {
  display:flex;
  flex-wrap:wrap;
  align-items:flex-start;
  justify-content:space-between;
  gap:6px 8px;
}
.sr-chat-find-mode {
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
}
.sr-chat-find-chip {
  min-height:24px;
  padding:2px 8px;
}
.sr-chat-find-chip.active {
  border-color:var(--mw-accent);
  background:color-mix(in srgb, var(--mw-accent-soft) 72%, var(--mw-panel) 28%);
  color:var(--mw-text);
}
.sr-chat-find-chip[disabled] {
  opacity:0.55;
  cursor:not-allowed;
}
.sr-chat-find-results {
  display:flex;
  flex-direction:column;
  gap:6px;
}
.sr-chat-find-card {
  display:flex;
  flex-direction:column;
  gap:6px;
  padding:6px 8px;
  border:0;
  border-top:1px solid var(--mw-border);
  background:color-mix(in srgb, var(--mw-panel) 72%, var(--mw-panel-soft) 28%);
}
.sr-chat-find-title {
  font-weight:600;
}
.sr-chat-find-meta,
.sr-chat-find-breadcrumb,
.sr-chat-find-score {
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
}
.sr-chat-find-chunks {
  display:flex;
  flex-direction:column;
  gap:6px;
}
.sr-chat-find-chunk {
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:5px 6px;
  border-left:2px solid color-mix(in srgb, var(--mw-accent) 36%, var(--mw-border) 64%);
  background:color-mix(in srgb, var(--mw-panel-soft) 92%, var(--mw-panel) 8%);
}
.sr-chat-find-actions {
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  align-items:center;
}
.sr-chat-autodrive-strip {
  gap:6px;
}
.sr-chat-autodrive-grid {
  display:grid;
  grid-template-columns:1fr;
  gap:6px;
}
.sr-chat-autodrive-row {
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
}
.sr-chat-autodrive-row-label {
  font-size:var(--mw-font-11);
  font-weight:600;
  color:var(--mw-muted);
  min-width:74px;
}
.sr-chat-autodrive-count {
  width:72px;
  min-height:24px;
}
.sr-chat-autodrive-reviewer-select {
  min-width:220px;
}
.sr-chat-autodrive-prompt-tabs {
  display:flex;
  gap:4px;
  align-items:center;
}
.sr-chat-autodrive-prompt-tab {
  min-height:24px;
}
.sr-chat-autodrive-prompt-tab.active {
  color:var(--mw-accent);
  border-color:color-mix(in srgb, var(--mw-accent) 45%, var(--mw-border) 55%);
  background:color-mix(in srgb, var(--mw-accent) 10%, var(--mw-panel) 90%);
}
.sr-chat-autodrive-prompt {
  width:100%;
  min-height:104px;
  resize:vertical;
  box-sizing:border-box;
  font:inherit;
  font-size:var(--mw-font-12);
  color:var(--mw-text);
  background:var(--mw-control-bg, #fff);
  border:1px solid var(--mw-border);
  border-radius:var(--mw-radius-sm, 4px);
  padding:6px 8px;
}
.sr-chat-autodrive-prompt[hidden] {
  display:none;
}
.sr-chat-autodrive-actions {
  display:flex;
  flex-wrap:wrap;
  justify-content:flex-end;
  gap:6px;
}
.sr-workspace-message-autodrive {
  border-left:3px solid color-mix(in srgb, var(--mw-accent) 55%, var(--mw-border) 45%);
}
.sr-workspace-message-autodrive-reviewer {
  border-left:3px solid #2f8f5b;
  background:color-mix(in srgb, #2f8f5b 10%, var(--mw-panel) 90%);
}
.sr-chat-footer-row {
  display:grid;
  grid-template-columns:minmax(0, 1fr) auto;
  align-items:center;
  gap:6px;
  min-width:0;
  width:100%;
}
.sr-chat-footer-left,
.sr-chat-footer-right {
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
}
.sr-chat-footer-left {
  flex:1 1 auto;
  overflow:hidden;
}
.sr-chat-footer-right {
  flex:0 0 auto;
  margin-left:auto;
  gap:4px;
}
.sr-chat-model-trigger {
  flex:0 0 auto;
  min-width:0;
  max-width:none;
  overflow:visible;
  text-overflow:clip;
  white-space:nowrap;
}
.sr-chat-reasoning-select {
  flex:0 0 auto;
  min-width:96px;
  max-width:none;
  width:100%;
  min-height:var(--mw-control-height, 28px);
}
.sr-chat-reasoning-custom {
  flex:0 0 auto;
  min-width:104px;
  max-width:none;
  width:100%;
  min-height:var(--mw-control-height, 28px);
}
.sr-chat-model-dialog-field {
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:0;
}
.sr-field-label-row {
  position:relative;
  display:inline-flex;
  align-items:center;
  gap:6px;
  min-width:0;
}
.sr-chat-hint-wrap {
  position:relative;
  display:inline-flex;
  align-items:center;
  flex:0 0 auto;
}
.sr-chat-hint {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:18px;
  height:18px;
  min-width:18px;
  min-height:18px;
  padding:0;
  border:1px solid var(--mw-border);
  border-radius:5px !important;
  background:var(--mw-control-bg);
  color:var(--mw-muted);
  font:inherit;
  font-size:var(--mw-font-11);
  font-weight:700;
  line-height:1;
}
.sr-chat-hint.is-open,
.sr-chat-hint:hover,
.sr-chat-hint:focus-visible {
  background:color-mix(in srgb, var(--mw-accent) 12%, var(--mw-panel) 88%);
  border-color:color-mix(in srgb, var(--mw-accent) 35%, var(--mw-border) 65%);
  color:var(--mw-text);
}
.sr-chat-hint-popover {
  position:absolute;
  top:calc(100% + 6px);
  left:0;
  z-index:120;
  min-width:220px;
  max-width:330px;
  padding:6px 8px;
  border:1px solid var(--mw-border);
  border-radius:8px !important;
  background:var(--mw-control-bg);
  box-shadow:0 8px 22px rgba(0,0,0,0.16);
  color:var(--mw-text);
  font-size:inherit;
  font-weight:400;
  line-height:1.35;
}
.sr-chat-hint-popover[hidden] {
  display:none !important;
}
.sr-chat-token-widget {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:0 0 auto;
  min-width:52px;
  min-height:28px;
  padding:0 8px;
  border:1px solid var(--mw-border);
  border-radius:7px !important;
  background:var(--mw-control-bg);
  color:var(--mw-text);
  cursor:pointer;
  user-select:none;
  white-space:nowrap;
  overflow:visible;
  gap:4px;
  box-shadow:0 1px 2px rgba(0,0,0,0.04);
}
.sr-chat-token-widget.is-warning {
  border-color: color-mix(in srgb, var(--mw-accent) 65%, var(--mw-border) 35%);
  color: var(--mw-accent);
}
.sr-chat-token-widget-label {
  font-size:var(--mw-font-10);
  color:var(--mw-muted);
  font-weight:600;
  white-space:nowrap;
}
.sr-chat-token-widget-percent {
  font-size:var(--mw-font-12);
  font-weight:600;
  line-height:1;
  color:var(--mw-text);
  white-space:nowrap;
}
.sr-chat-token-widget-sub {
  font-size:var(--mw-font-10);
  color:var(--mw-muted);
  white-space:nowrap;
  display:none;
}
.sr-chat-inline-popover-layer {
  position:absolute;
  inset:0;
  pointer-events:none;
  overflow:hidden;
  z-index:60;
}
.sr-chat-inline-popover {
  position:absolute;
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:300px;
  max-width:min(430px, calc(100% - 16px));
  padding:12px;
  border:1px solid var(--mw-border);
  border-radius:10px !important;
  background:var(--mw-panel);
  box-shadow:0 8px 24px rgba(0,0,0,0.18);
  pointer-events:auto;
  z-index:80;
  font-size:var(--mw-font-13);
  line-height:1.35;
}
.sr-chat-inline-popover-title {
  font-size:inherit;
  font-weight:600;
  color:var(--mw-text);
}
.sr-chat-inline-popover-copy {
  font-size:inherit;
  line-height:1.35;
  color:var(--mw-muted);
}
.sr-chat-inline-popover-body {
  display:flex;
  flex-direction:column;
  gap:6px;
}
.sr-chat-inline-popover [hidden] {
  display:none !important;
}
.sr-chat-inline-popover-actions {
  display:flex;
  justify-content:flex-end;
  gap:6px;
  margin-top:2px;
}
.sr-chat-token-tooltip-title {
  font-size:var(--mw-font-16);
  font-weight:600;
  color:var(--mw-text);
}
.sr-chat-context-summary {
  display:flex;
  flex-direction:column;
  gap:2px;
  align-items:center;
  padding:4px 0 8px;
  border-bottom:1px solid var(--mw-border);
}
.sr-chat-context-summary-label {
  font-size:var(--mw-font-12);
  color:var(--mw-muted);
}
.sr-chat-context-summary-main {
  font-size:var(--mw-font-18);
  font-weight:700;
  color:var(--mw-text);
}
.sr-chat-context-summary-sub {
  font-size:var(--mw-font-12);
  color:var(--mw-muted);
}
.sr-chat-context-meter {
  width:100%;
  height:7px;
  border-radius:999px;
  background:var(--mw-panel-soft);
  overflow:hidden;
  border:1px solid var(--mw-border);
}
.sr-chat-context-meter-fill {
  height:100%;
  width:0%;
  background:var(--mw-accent);
}
.sr-chat-context-meter-fill.is-warning {
  background:color-mix(in srgb, var(--mw-accent) 70%, #c45 30%);
}
.sr-chat-context-breakdown {
  display:flex;
  flex-direction:column;
  gap:5px;
}
.sr-chat-context-payloads {
  display:flex;
  flex-direction:column;
  gap:6px;
  padding-top:4px;
  border-top:1px solid var(--mw-border);
}
.sr-chat-context-payload {
  border:1px solid var(--mw-border);
  border-radius:7px !important;
  background:var(--mw-panel-soft);
  overflow:hidden;
}
.sr-chat-context-payload summary {
  cursor:pointer;
  padding:5px 7px;
  font-size:var(--mw-font-11);
  font-weight:600;
  color:var(--mw-text);
}
.sr-chat-context-payload-text {
  box-sizing:border-box;
  width:100%;
  min-height:160px;
  max-height:320px;
  resize:vertical;
  border:0;
  border-top:1px solid var(--mw-border);
  background:var(--mw-control-bg);
  color:var(--mw-text);
  font:inherit;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:var(--mw-font-11);
  line-height:1.35;
  padding:7px;
  white-space:pre;
}
.sr-chat-token-tooltip-line {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
  white-space:nowrap;
}
.sr-chat-token-tooltip-line strong {
  color:var(--mw-text);
  font-weight:600;
}
.sr-chat-queue-list {
  display:flex;
  flex-direction:column;
  gap:2px;
  max-height:84px;
  overflow:auto;
}
.sr-chat-queue-item {
  display:grid;
  grid-template-columns:minmax(0, 1fr) auto;
  align-items:center;
  gap:6px;
  min-width:0;
  padding:1px 0;
  border:0;
  background:transparent;
}
.sr-chat-queue-item.is-steer {
  color:var(--mw-text);
}
.sr-chat-queue-copy {
  flex:1 1 auto;
  min-width:0;
  display:flex;
  align-items:center;
  gap:7px;
}
.sr-chat-queue-meta {
  display:flex;
  align-items:center;
  gap:0;
  flex:0 0 auto;
}
.sr-chat-queue-badge {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:0;
  border:0;
  background:transparent;
  color:var(--mw-muted);
  font-size:inherit;
  font-weight:600;
  letter-spacing:0;
  text-transform:none;
}
.sr-chat-queue-item.is-steer .sr-chat-queue-badge {
  color:var(--mw-accent);
}
.sr-chat-queue-text {
  font-size:inherit;
  line-height:1.35;
  color:var(--mw-muted);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.sr-chat-queue-actions {
  display:flex;
  align-items:center;
  gap:2px;
  flex:0 0 auto;
  flex-wrap:nowrap;
}
.sr-chat-queue-btn {
  min-height:22px;
  padding:0 8px;
  font-size:inherit;
  border:0;
  background:transparent;
  color:var(--mw-muted);
}
.sr-chat-queue-btn:hover,
.sr-chat-queue-btn:focus-visible {
  background: color-mix(in srgb, var(--mw-panel-soft) 78%, transparent);
}
.sr-chat-queue-btn-pill {
  border:0;
  border-radius:999px;
  background: color-mix(in srgb, var(--mw-panel-soft) 90%, var(--mw-panel) 10%);
  color:var(--mw-text);
  padding:0 10px;
}
.sr-chat-queue-btn-pill:hover,
.sr-chat-queue-btn-pill:focus-visible {
  background: color-mix(in srgb, var(--mw-panel-soft) 76%, var(--mw-panel) 24%);
}
.sr-workspace-stop {
  min-height:28px;
  padding:3px 8px;
  font-size:var(--mw-font-12);
  border:1px solid color-mix(in srgb, var(--mw-accent) 52%, var(--mw-border) 48%);
  background:var(--mw-panel);
  color:var(--mw-accent);
}
.sr-workspace-stop:hover,
.sr-workspace-stop:focus-visible {
  background: color-mix(in srgb, var(--mw-accent-soft) 60%, var(--mw-panel) 40%);
}
.sr-chat-actions {
  display:flex;
  flex-direction:column;
  gap:6px;
  min-width:0;
}
.sr-chat-card-header {
  justify-content:flex-end;
}
.sr-chat-header-actions {
  flex:1 1 auto;
  justify-content:flex-end;
  flex-wrap:nowrap;
  overflow:hidden;
}
.sr-chat-header-actions > .sr-workspace-btn {
  flex:0 0 auto;
}
.sr-chat-session-select {
  flex:1 1 auto;
  width:220px;
  min-width:0;
  max-width:220px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
[data-automation-status="true"][hidden],
.sr-editor-status-probe[hidden] {
  display:none !important;
}
.sr-workspace-empty { font-size: var(--mw-font-12); color: var(--mw-muted); }
.sr-doc-host {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  position: relative;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  overflow: auto;
}
.sr-doc-host > .sr-markdown-document,
.sr-doc-host > .sr-native-root {
  flex: 0 0 auto;
  width: max-content;
  min-width: 0;
  max-width: none;
  min-height: 0;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  color: #1d2024;
  border: 0;
  box-shadow: none;
}
.sr-overlay-host { position:fixed; inset:0; pointer-events:none; z-index:2000; }
.sr-overlay-host > * { pointer-events:auto; }
.sr-dialog-backdrop {
  position:fixed; inset:0; background:rgba(0,0,0,0.35);
  display:flex; align-items:center; justify-content:center; padding:20px;
}
.sr-dialog {
  width:min(1100px, 96vw);
  max-height:min(760px, 92vh);
  overflow:visible;
  background:var(--mw-panel);
  border:1px solid var(--mw-border);
  border-radius:10px !important;
  display:flex;
  flex-direction:column;
  font-size:var(--mw-font-13);
  line-height:1.35;
}
.sr-dialog-header,
.sr-dialog-footer {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:10px 12px;
  border-bottom:1px solid var(--mw-border);
  background:var(--mw-panel);
}
.sr-dialog-header {
  border-top-left-radius:9px !important;
  border-top-right-radius:9px !important;
}
.sr-dialog-footer {
  border-top:1px solid var(--mw-border);
  border-bottom:0;
  border-bottom-left-radius:9px !important;
  border-bottom-right-radius:9px !important;
}
.sr-dialog-body {
  display:grid;
  grid-template-columns:minmax(0, 1fr) 320px;
  gap:10px;
  padding:10px 12px 12px;
  min-height:0;
  background:var(--mw-panel);
  overflow:auto;
}
.sr-dialog-main,
.sr-dialog-side {
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  min-height:0;
}
.sr-chat-model-dialog {
  width:min(420px, 92vw);
  max-height:none;
}
.sr-chat-model-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  padding:8px;
}
.sr-chat-model-dialog .sr-dialog-footer {
  justify-content:flex-end;
}
.sr-chat-model-note {
  font-size:inherit;
  line-height:1.35;
  color:var(--mw-text);
}
.sr-dialog-selection,
.sr-dialog-results {
  border:0;
  background:var(--mw-panel-soft);
}
.sr-dialog-selection {
  display:flex;
  flex-direction:column;
  gap:6px;
  padding:6px;
  min-height:120px;
  max-height:220px;
  overflow:auto;
}
.sr-dialog-selection-empty,
.sr-dialog-subtitle { color: var(--mw-muted); font-size:inherit; }
.sr-dialog-chip {
  display:inline-flex;
  align-items:center;
  gap:6px;
  max-width:100%;
  padding:6px 10px;
  border:0;
  background:var(--mw-panel);
  font-size:var(--mw-font-12);
}
.sr-dialog-chip-label {
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.sr-dialog-chip-remove {
  border:0;
  background:transparent;
  color:var(--mw-muted);
  padding:0;
  cursor:pointer;
  min-width:16px;
  min-height:auto;
}
.sr-dialog-results {
  display:flex;
  flex-direction:column;
  min-height:0;
  overflow:hidden;
}
.sr-dialog-results-header,
.sr-dialog-row {
  display:grid;
  grid-template-columns:minmax(220px, 1.05fr) 72px minmax(280px, 1.95fr) 40px;
  gap:8px;
}
.sr-dialog-results-header > *,
.sr-dialog-row > * {
  min-width:0;
}
.sr-dialog-results-header {
  align-items:center;
  padding:8px 10px;
  border-bottom:1px solid var(--mw-border);
  font-size:var(--mw-font-11);
  font-weight:700;
  letter-spacing:0.04em;
  text-transform:uppercase;
  color:var(--mw-muted);
}
.sr-dialog-sort-header {
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:0;
  border:0;
  background:transparent;
  color:inherit;
  font:inherit;
  letter-spacing:inherit;
  text-transform:inherit;
  cursor:pointer;
  min-height:auto;
}
.sr-dialog-sort-header:hover,
.sr-dialog-sort-header:focus-visible {
  color:var(--mw-text);
}
.sr-dialog-list {
  display:flex;
  flex-direction:column;
  gap:0;
  max-height:520px;
  overflow:auto;
}
.sr-dialog-row {
  align-items:start;
  padding:10px;
  border-top:1px solid var(--mw-border);
  background:var(--mw-panel-soft);
  cursor:pointer;
}
.sr-dialog-row.selected {
  border-color:var(--mw-accent);
  background:color-mix(in srgb, var(--mw-accent-soft) 45%, var(--mw-panel-soft));
}
.sr-dialog-col-title {
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:3px;
}
.sr-dialog-col-meta,
.sr-dialog-item-subtitle {
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
}
.sr-dialog-col-meta {
  min-width:0;
  display:flex;
  align-items:center;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.sr-dialog-col-authors,
.sr-dialog-item-subtitle {
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  overflow-wrap:anywhere;
  word-break:break-word;
}
.sr-dialog-col-authors {
  display:block;
}
.sr-dialog-col-action {
  display:flex;
  align-items:center;
  justify-content:flex-end;
}
.sr-dialog-item-title {
  min-width:0;
  font-size:var(--mw-font-13);
  font-weight:600;
  overflow-wrap:anywhere;
  word-break:break-word;
}
.sr-dialog-add {
  min-width:28px;
  min-height:28px;
  padding:0;
  font-size:var(--mw-font-13);
  line-height:1;
}
.sr-context-menu { position:fixed; min-width:220px; background:var(--mw-panel); border:1px solid var(--mw-border); border-radius:var(--mw-radius-sm, 4px); display:flex; flex-direction:column; z-index:2100; }
.sr-context-menu-separator { border-top:1px solid var(--mw-border); margin:4px 0; }
.sr-context-menu-item { justify-content:flex-start; padding:8px 10px; border:0; border-bottom:1px solid var(--mw-border); min-height:auto; }
.sr-context-menu-item:last-child { border-bottom:0; }
.sr-context-menu-item.is-active-danger {
  border-color: rgba(166, 52, 64, 0.78);
  background: color-mix(in srgb, rgba(166, 52, 64, 0.14) 100%, var(--mw-panel));
}
.sr-context-menu-item.is-active-accent {
  border-color: var(--mw-accent);
  background: color-mix(in srgb, var(--mw-accent-soft) 100%, var(--mw-panel));
}
.sr-context-menu-item.is-checked {
  background: color-mix(in srgb, var(--mw-accent-soft) 100%, var(--mw-panel));
  box-shadow: inset 3px 0 0 var(--mw-accent);
}
.sr-citation-chip, .sr-citation-ref {
  background: var(--mw-accent-soft);
  border:1px solid var(--mw-border);
  padding:1px 4px;
  display:inline-flex;
  align-items:center;
}
.sr-field-label {
  display:flex;
  flex-direction:column;
  gap:4px;
  font-size:inherit;
  font-weight:600;
  color:var(--mw-muted);
}
.sr-editor-settings .sr-field-label {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.sr-dialog-side .sr-field-label {
  align-items: stretch;
}
.sr-dialog-heading {
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
}
.sr-dialog-title { font-size:inherit; font-weight:600; }
.sr-dialog-close { min-width:30px; padding:0; font-size:inherit; }
.sr-dialog-results-header,
.sr-dialog-chip,
.sr-dialog-col-meta,
.sr-dialog-item-subtitle,
.sr-dialog-item-title,
.sr-dialog-add,
.sr-find-panel-title,
.sr-find-panel-subtitle,
.sr-find-panel-status,
.sr-link-status,
.sr-chat-model-note {
  font-size:inherit;
  line-height:1.35;
}
.sr-citation-dialog {
  width:min(1100px, 96vw);
  height:min(760px, 92vh);
}
.sr-citation-dialog .sr-dialog-body {
  flex:1 1 auto;
  min-height:0;
  overflow:hidden;
}
.sr-citation-dialog .sr-dialog-main {
  overflow:hidden;
}
.sr-citation-dialog .sr-dialog-side {
  overflow:auto;
  padding-right:2px;
}
.sr-citation-dialog .sr-dialog-results {
  flex:1 1 auto;
}
.sr-citation-dialog .sr-dialog-list {
  flex:1 1 auto;
  max-height:none;
}
.sr-citation-dialog .sr-dialog-selection {
  max-height:220px;
}
.sr-dialog-select,
.sr-properties-dialog select,
.sr-export-dialog select,
.sr-find-dialog select,
.sr-find-panel select,
.sr-database-table-dialog select,
.sr-image-dialog input {
  display:block;
  width:100%;
  min-width:0;
  min-height:28px;
  height:28px;
  max-height:28px;
  padding:0 8px;
  flex:0 0 auto;
  align-self:stretch;
  box-sizing:border-box;
  border:1px solid var(--mw-border);
  border-radius:var(--mw-radius-sm, 4px);
  background:var(--mw-control-bg, var(--mw-panel));
  color:var(--mw-text);
  appearance:auto;
  -moz-appearance:menulist;
}
.sr-properties-dialog {
  width:min(460px, 92vw);
}
.sr-properties-dialog .sr-dialog-body,
.sr-image-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px;
}
.sr-properties-dialog .sr-dialog-body {
  max-height:min(420px, calc(92vh - 128px));
  overflow-y:auto;
  overflow-x:hidden;
}
.sr-properties-form {
  display:flex;
  flex-direction:column;
  gap:8px;
}
.sr-properties-form .sr-field-label,
.sr-export-form .sr-field-label,
.sr-find-form .sr-field-label {
  width:100%;
  min-width:0;
  align-items:stretch;
}
.sr-export-dialog {
  width:min(520px, 92vw);
  max-height:none;
}
.sr-export-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px;
}
.sr-image-dialog {
  width:min(360px, 92vw);
}
.sr-prisma-editor-dialog {
  width:min(1480px, calc(100vw - 24px));
  height:min(920px, calc(100vh - 24px));
  max-height:calc(100vh - 24px);
}
.sr-prisma-editor-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  min-height:0;
  overflow:auto;
  padding:10px 12px 12px;
}
.sr-prisma-editor-dialog .mw-prisma-surface.is-embedded {
  flex:1 1 auto;
  min-height:0;
}
.sr-prisma-editor-dialog .mw-prisma-surface.is-embedded .mw-prisma-canvas-wrap {
  min-height:0;
}
.sr-prisma-editor-dialog .mw-prisma-surface.is-embedded .mw-prisma-canvas,
.sr-prisma-editor-dialog .mw-prisma-surface.is-embedded .mw-prisma-canvas svg,
.sr-prisma-editor-dialog .mw-prisma-surface.is-embedded .mw-prisma-svg {
  min-height:0;
}
.sr-export-form {
  display:flex;
  flex-direction:column;
  gap:8px;
}
.sr-export-field-row {
  display:flex;
  align-items:flex-end;
  gap:8px;
}
.sr-export-field-row .sr-field-label {
  flex:1 1 auto;
}
.sr-export-help-trigger {
  min-width:30px;
  padding:0;
}
.sr-export-help-copy {
  margin:2px 0 0;
  color:var(--mw-muted);
  font-size:var(--mw-font-11);
  line-height:1.35;
}
.sr-log-dialog {
  width:min(1120px, calc(100vw - 24px));
  max-height:calc(100vh - 24px);
}
.sr-log-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  min-height:0;
  overflow:hidden;
  padding:8px;
}
.sr-log-surface {
  overflow:auto;
  border:0;
  border-top:1px solid var(--mw-border);
  background:var(--mw-panel);
  padding:8px;
  max-height:min(68vh, 720px);
}
.sr-log-surface .mw-explore-markdown,
.sr-log-surface .mw-explore-markdown p,
.sr-log-surface .mw-explore-markdown li,
.sr-log-surface .mw-explore-markdown td,
.sr-log-surface .mw-explore-markdown th {
  overflow-wrap:anywhere;
  word-break:break-word;
}
	.sr-log-surface .mw-explore-citation {
	  overflow-wrap:anywhere;
	  word-break:break-word;
	}
	.sr-log-empty {
	  color:var(--mw-muted);
	  font-size:var(--mw-font-12);
	}
	.sr-memory-tabs {
	  display:flex;
	  flex-wrap:wrap;
	  gap:4px;
	  align-items:center;
	}
	.sr-memory-tab {
	  min-height:28px;
	}
	.sr-memory-tab.active {
	  color:var(--mw-accent);
	  border-color:color-mix(in srgb, var(--mw-accent) 45%, var(--mw-border) 55%);
	  background:color-mix(in srgb, var(--mw-accent) 10%, var(--mw-panel) 90%);
	}
	.sr-rollback-dialog {
	  width:min(1480px, calc(100vw - 24px));
	  max-height:calc(100vh - 24px);
	}
.sr-rollback-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  min-height:0;
  overflow:hidden;
  padding:8px;
}
.sr-rollback-controls {
  display:grid;
  grid-template-columns:minmax(280px, 640px) minmax(0, 1fr);
  gap:8px;
  align-items:end;
}
.sr-rollback-controls .sr-field-label {
  width:100%;
  min-width:0;
  align-items:stretch;
}
.sr-rollback-current-meta,
.sr-rollback-note {
  min-height:16px;
  color:var(--mw-muted);
  font-size:var(--mw-font-11);
  line-height:1.35;
}
.sr-rollback-current-meta {
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.sr-rollback-surface {
  display:flex;
  flex-direction:column;
  min-height:0;
}
.sr-rollback-diff-scroll {
  overflow:auto;
  border:0;
  border-top:1px solid var(--mw-border);
  background:var(--mw-panel);
  max-height:min(62vh, 640px);
}
.sr-rollback-rows {
  min-width:920px;
}
.sr-rollback-grid-head,
.sr-rollback-row {
  display:grid;
  grid-template-columns:56px minmax(0, 1fr) 56px minmax(0, 1fr);
}
.sr-rollback-grid-head {
  position:sticky;
  top:0;
  z-index:1;
  border-bottom:1px solid var(--mw-border);
  background:var(--mw-panel);
}
.sr-rollback-grid-head > div {
  padding:8px 10px;
  font-size:var(--mw-font-11);
  color:var(--mw-muted);
}
.sr-rollback-row + .sr-rollback-row {
  border-top:1px solid color-mix(in srgb, var(--mw-border) 72%, transparent);
}
.sr-rollback-line-number {
  padding:5px 6px 5px 4px;
  text-align:right;
  color:var(--mw-muted);
  font-size:var(--mw-font-11);
  line-height:1.35;
  font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  user-select:none;
  background:color-mix(in srgb, var(--mw-border) 8%, transparent);
}
.sr-rollback-code {
  min-height:28px;
  padding:5px 6px;
  white-space:pre-wrap;
  word-break:break-word;
  line-height:1.35;
  color:var(--mw-text);
  font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
.sr-rollback-row.is-removed .sr-rollback-code-left,
.sr-rollback-row.is-changed .sr-rollback-code-left {
  background:rgba(194, 62, 68, 0.08);
}
.sr-rollback-row.is-added .sr-rollback-code-right,
.sr-rollback-row.is-changed .sr-rollback-code-right {
  background:rgba(38, 150, 83, 0.10);
}
.sr-rollback-row.is-removed .sr-rollback-line-number-left,
.sr-rollback-row.is-changed .sr-rollback-line-number-left {
  background:rgba(194, 62, 68, 0.12);
}
.sr-rollback-row.is-added .sr-rollback-line-number-right,
.sr-rollback-row.is-changed .sr-rollback-line-number-right {
  background:rgba(38, 150, 83, 0.14);
}
.sr-rollback-segment {
  border-radius:4px;
}
.sr-rollback-segment.is-removed {
  background:rgba(194, 62, 68, 0.24);
}
.sr-rollback-segment.is-added {
  background:rgba(38, 150, 83, 0.28);
}
.sr-rollback-confirm-layer {
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  background:rgba(0,0,0,0.18);
}
.sr-rollback-confirm {
  width:min(460px, 92vw);
  max-height:none;
}
.sr-rollback-confirm .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px;
}
@media (max-width: 900px) {
  .sr-rollback-controls {
    grid-template-columns:minmax(0, 1fr);
  }
  .sr-rollback-rows {
    min-width:760px;
  }
}
.sr-find-dialog {
  width:min(520px, 92vw);
  max-height:none;
}
.sr-find-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px;
}
.sr-find-form {
  display:flex;
  flex-direction:column;
  gap:8px;
}
.sr-find-row {
  display:grid;
  grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);
  gap:10px;
}
.sr-find-actions {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
.sr-find-status {
  color:var(--mw-muted);
  font-size:var(--mw-font-11);
  min-height:16px;
}
.sr-find-floating-shell {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2050;
}
.sr-find-panel {
  position: fixed;
  width: min(410px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--mw-panel);
  border: 1px solid var(--mw-border);
  border-radius: 10px !important;
  box-shadow: 0 8px 28px rgba(15, 18, 24, 0.22);
  pointer-events: auto;
}
.sr-find-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--mw-border);
  cursor: move;
  user-select: none;
}
.sr-find-panel-heading {
  min-width: 0;
}
.sr-find-panel-title {
  font-size: var(--mw-font-13);
  font-weight: 600;
  color: var(--mw-text);
}
.sr-find-panel-subtitle {
  margin-top: 2px;
  color: var(--mw-muted);
  font-size: var(--mw-font-11);
  line-height: 1.35;
}
.sr-find-panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
}
.sr-find-panel .sr-field-label {
  width: 100%;
  min-width: 0;
  align-items: stretch;
}
.sr-find-panel-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}
.sr-find-panel-matchcase {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  color: var(--mw-text);
  font-size: var(--mw-font-12);
}
.sr-find-panel-matchcase input {
  margin: 0;
}
.sr-find-panel-actions,
.sr-find-panel-replace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sr-find-panel-actions {
  justify-content: space-between;
}
.sr-find-panel-status {
  color: var(--mw-muted);
  font-size: var(--mw-font-11);
  line-height: 1.4;
  min-height: 16px;
}
.sr-find-highlight-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 3;
}
.sr-find-highlight {
  position: absolute;
  background: rgba(255, 230, 77, 0.38);
  border-radius: 2px;
}
.sr-find-highlight.is-active {
  background: rgba(255, 196, 0, 0.56);
  box-shadow: 0 0 0 1px rgba(214, 146, 0, 0.28);
}
.sr-link-dialog {
  width:min(520px, 92vw);
  max-height:none;
}
.sr-link-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px;
}
.sr-link-form {
  display:flex;
  flex-direction:column;
  gap:8px;
}
.sr-link-status {
  color:var(--mw-muted);
  font-size:var(--mw-font-11);
  min-height:16px;
}
.sr-database-table-dialog {
  width:min(1120px, 96vw);
  height:min(760px, 92vh);
}
.sr-database-table-dialog .sr-dialog-body {
  display:flex;
  flex-direction:column;
  gap:8px;
  min-height:0;
  padding:8px;
  overflow:hidden;
}
.sr-database-table-scope-row {
  display:grid;
  grid-template-columns:minmax(0, 1fr);
  gap:8px;
  flex:0 0 auto;
}
.sr-database-table-dialog .mw-screening-columns-modal-layout {
  flex:1 1 auto;
  min-height:0;
}
.sr-database-table-dialog .mw-screening-column-palette,
.sr-database-table-dialog .mw-screening-column-composer {
  min-height:0;
}
.sr-database-table-dialog .mw-screening-column-composer-zone,
.sr-database-table-dialog .mw-screening-column-groups {
  min-height:0;
  overflow:auto;
}
.sr-database-table-note {
  color:var(--mw-muted);
  font-size:var(--mw-font-11);
}
@media (max-width: 1180px) {
  .sr-editor-footer-strip {
    flex-wrap:nowrap;
    white-space:nowrap;
    overflow-x:auto;
  }
  .sr-editor-footer-main {
    width:auto;
    min-width:max-content;
  }
  .sr-editor-footer-zoom {
    width:auto;
    min-width:250px;
    justify-content:flex-end;
  }
  .sr-dialog-body { grid-template-columns: 1fr; }
  .sr-citation-dialog .sr-dialog-body {
    grid-template-columns:minmax(0, 1fr) 320px;
  }
  .sr-dialog-results-header,
  .sr-dialog-row { grid-template-columns:minmax(180px, 1fr) 72px minmax(220px, 1.6fr) 40px; }
}
`;

function ensureAutomationWorkspaceStyles(doc) {
  if (!doc || doc.getElementById("sr-automation-workspace-style")) {
    return;
  }
  const style = doc.createElement("style");
  style.id = "sr-automation-workspace-style";
  style.textContent = AUTOMATION_WORKSPACE_CSS;
  doc.head.appendChild(style);
}

function optionalString(value) {
  return String(value || "").trim();
}

function uniqueColumnKeys(values = []) {
  const seen = new Set();
  const next = [];
  for (const value of values || []) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(key);
  }
  return next;
}

function removeColumnKey(values = [], targetKey = "") {
  const cleanTarget = String(targetKey || "").trim();
  return uniqueColumnKeys(values).filter((key) => key !== cleanTarget);
}

function insertColumnKey(values = [], targetKey = "", index = 0) {
  const cleanTarget = String(targetKey || "").trim();
  if (!cleanTarget) {
    return uniqueColumnKeys(values);
  }
  const next = removeColumnKey(values, cleanTarget);
  const insertionIndex = Math.max(0, Math.min(next.length, Number(index || 0) || 0));
  next.splice(insertionIndex, 0, cleanTarget);
  return next;
}

function createButton(label, className = "sr-workspace-btn", attrs = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = cleanDisplayText(label);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      button.setAttribute(key, String(value));
    }
  });
  return button;
}

function createSelect(className = "sr-editor-select") {
  const select = document.createElement("select");
  select.className = className;
  return select;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = String(value ?? "");
  option.textContent = cleanDisplayText(label ?? value ?? "");
  return option;
}

function createNode(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.textContent !== undefined) {
    node.textContent = cleanDisplayText(options.textContent, { multiline: true, trim: false });
  }
  if (options.html !== undefined) {
    node.innerHTML = String(options.html || "");
  }
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value));
      }
    });
  }
  if (options.style && typeof options.style === "object") {
    Object.entries(options.style).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        node.style[key] = String(value);
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

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function citationMapFromRenderState(renderState = {}) {
  const map = new Map();
  for (const entry of Array.isArray(renderState?.citations) ? renderState.citations : []) {
    map.set(String(entry?.token || ""), entry || {});
  }
  return map;
}

function formatElapsedTime(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function messageUsesDetails(message = {}) {
  return new Set([
    "assistant_stream_status",
    "thinking",
    "responses_reasoning",
    "tool_call",
    "tool_result",
    "tool_error",
    "action_call",
    "action_result",
    "action_error",
    "function_call",
    "function_call_output",
    "system_tools",
    "collection_inspection",
    "system_prompt",
    "truncated_context",
  ]).has(String(message?.event_type || ""));
}

function isStatusLineMessage(message = {}) {
  return new Set([
    "assistant_status",
    "tool_call_pending",
    "tool_waiting",
    "assistant_resume",
  ]).has(String(message?.event_type || ""));
}

function isPlainAssistantMessage(message = {}) {
  return !messageUsesDetails(message)
    && !isStatusLineMessage(message)
    && String(message?.role || "assistant") !== "user"
    && !["tool", "system"].includes(String(message?.role || ""));
}

function isUserMessage(message = {}) {
  return String(message?.role || "") === "user" && !messageUsesDetails(message) && !isAutodriveReviewerMirror(message);
}

function isAutodriveReviewerMirror(message = {}) {
  const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
  return !!payload.autodrive_reviewer_mirror;
}

function messageRoleLabel(message = {}) {
  if (isAutodriveReviewerMirror(message)) {
    return "Auto Drive Reviewer";
  }
  if (message.role === "user") {
    return "User";
  }
  if (message.role === "tool") {
    return "Tool";
  }
  if (message.role === "system") {
    return "Session";
  }
  return "Systematic Reviewer";
}

function messageTitleText(message = {}) {
  if (message.title) {
    return String(message.title);
  }
  switch (String(message.event_type || "")) {
    case "thinking":
    case "responses_reasoning":
      return "Reasoning";
    case "assistant_stream_status":
      return "Planning Next Step";
    case "tool_call":
      return "Tool Call";
    case "tool_result":
      return "Tool Result";
    case "tool_error":
      return "Tool Error";
    case "action_call":
      return "Action Call";
    case "action_result":
      return "Action Result";
    case "action_error":
      return "Action Error";
    case "function_call":
      return "Function Call";
    case "function_call_output":
      return "Function Output";
    case "system_tools":
      return "Available Tools";
    case "collection_inspection":
      return "Collection Inspection";
    case "system_prompt":
      return "Pinned Prompt Context";
    case "truncated_context":
      return "Truncated Context";
    case "assistant_question":
      return "Next Step";
    case "tool_call_pending":
      return "Calling Tool";
    case "tool_waiting":
      return "Waiting For Tool Output";
    case "assistant_resume":
      return "Assistant Resumed";
    default:
      return "";
  }
}

function serializeTimelineEntry(entry = {}) {
  const role = String(entry?.role || "system").trim().toUpperCase() || "SYSTEM";
  const eventType = String(entry?.event_type || "").trim();
  const title = String(entry?.title || "").trim();
  const content = String(entry?.content || "").trim();
  const rawPayload = eventType === "documents_find" && entry?.payload && typeof entry.payload === "object" && !Array.isArray(entry.payload)
    ? {
        search_id: entry.payload.search_id || "",
        query: entry.payload.query || "",
        mode: entry.payload.mode || "",
        keyword_backend: entry.payload.keyword_backend || "",
        model: entry.payload.model || "",
        scope: entry.payload.scope || null,
        has_more: !!entry.payload.has_more,
        next_offset: Number(entry.payload.next_offset || 0) || 0,
        returned_documents: Number(entry.payload.returned_documents || 0) || 0,
        total_documents: Number(entry.payload.total_documents || 0) || 0,
      }
    : entry?.payload;
  let payload = "";
  if (rawPayload !== undefined && rawPayload !== null) {
    try {
      payload = JSON.stringify(rawPayload, null, 2);
    }
    catch (_error) {
      payload = String(rawPayload);
    }
  }
  return [
    `${role}${eventType ? ` [${eventType}]` : ""}${title ? ` ${title}` : ""}`.trim(),
    content,
    payload,
  ].filter(Boolean).join("\n");
}

function truncateText(value, limit = 6000) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function parseJSONText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  }
  catch (_error) {
    return null;
  }
}

function formatToolSearchOutput(result = {}) {
  const namespaces = Array.isArray(result?.namespaces) ? result.namespaces : [];
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  const parts = [];
  if (String(result?.namespace || "").trim()) {
    parts.push(`Namespace: ${String(result.namespace || "").trim()}`);
  }
  if (String(result?.namespace_description || "").trim()) {
    parts.push(String(result.namespace_description || "").trim());
  }
  if (namespaces.length) {
    parts.push([
      "Namespaces:",
      ...namespaces.map((entry) => {
        const count = Number(entry?.tool_count || 0) || 0;
        return `- ${String(entry?.id || "").trim()}: ${String(entry?.description || "").trim()}${count ? ` (${count} tools)` : ""}`;
      }),
    ].join("\n"));
  }
  if (tools.length) {
    parts.push([
      "Tools:",
      ...tools.map((tool) => {
        const args = Array.isArray(tool?.arguments)
          ? tool.arguments.map((entry) => String(entry?.name || "").trim()).filter(Boolean)
          : [];
        const signature = args.length
          ? `${String(tool?.name || "").trim()}(${args.join(", ")})`
          : `${String(tool?.name || "").trim()}()`;
        const description = String(tool?.description || "").trim();
        return `- ${signature}: ${description}`;
      }),
    ].join("\n"));
  }
  if (String(result?.hint || "").trim()) {
    parts.push(String(result.hint || "").trim());
  }
  return parts.filter(Boolean).join("\n\n");
}

function formatFunctionEventBody(message = {}) {
  const eventType = String(message?.event_type || "").trim();
  if (!["function_call", "function_call_output"].includes(eventType)) {
    return "";
  }
  const payload = message?.payload && typeof message.payload == "object" ? message.payload : {};
  const parts = [];
  if (String(message?.content || "").trim()) {
    parts.push(String(message.content || "").trim());
  }
  if (eventType === "function_call") {
    const argumentsText = typeof payload?.arguments === "string"
      ? payload.arguments
      : JSON.stringify(payload?.arguments || {}, null, 2);
    if (String(argumentsText || "").trim()) {
      parts.push(`Arguments\n${String(argumentsText || "").trim()}`);
    }
    return parts.filter(Boolean).join("\n\n");
  }
  const parsedOutput = parseJSONText(payload?.output);
  if (parsedOutput && (Array.isArray(parsedOutput?.tools) || Array.isArray(parsedOutput?.namespaces))) {
    const toolSearchBody = formatToolSearchOutput(parsedOutput);
    if (toolSearchBody) {
      parts.push(toolSearchBody);
      return parts.filter(Boolean).join("\n\n");
    }
  }
  const outputText = parsedOutput
    ? JSON.stringify(parsedOutput, null, 2)
    : String(payload?.output || "").trim();
  if (outputText) {
    parts.push(outputText);
  }
  return parts.filter(Boolean).join("\n\n");
}

function chatMessageKey(message = {}) {
  if (String(message?._live_key || "").trim()) {
    return `live:${String(message._live_key || "").trim()}`;
  }
  const sequence = Number(message?.sequence_no || 0) || 0;
  const eventType = String(message?.event_type || "").trim();
  const createdAt = String(message?.created_at || "").trim();
  const title = String(message?.title || "").trim();
  if (sequence) {
    return `entry:${sequence}:${eventType}`;
  }
  return `synthetic:${eventType}:${createdAt}:${title}:${String(message?.content || "").slice(0, 40)}`;
}

function messageBodyText(message = {}) {
  let content = String(message?.content || "");
  if (String(message?.event_type || "") === "responses_reasoning") {
    return content;
  }
  if (["function_call", "function_call_output"].includes(String(message?.event_type || ""))) {
    return formatFunctionEventBody(message);
  }
  if (String(message?.event_type || "") === "truncated_context") {
    const entries = Array.isArray(message?.payload?.entries) ? message.payload.entries : [];
    const formatted = entries.map((entry) => serializeTimelineEntry(entry)).filter(Boolean).join("\n\n-----\n\n");
    return formatted
      ? `${content}\n\n${formatted}`
      : content;
  }
  if (!content && message?.payload !== undefined && message?.payload !== null) {
    try {
      content = JSON.stringify(message.payload, null, 2);
    }
    catch (_error) {
      content = String(message.payload);
    }
  }
  if (message.payload && messageUsesDetails(message)) {
    let payloadPreview = "";
    try {
      payloadPreview = truncateText(JSON.stringify(message.payload, null, 2), 6000);
    }
    catch (_error) {
      payloadPreview = "";
    }
    if (payloadPreview) {
      return content ? `${content}\n\n${payloadPreview}` : payloadPreview;
    }
  }
  return content;
}

function renderedChatMessages(messages = [], state = {}) {
  const source = Array.isArray(messages) ? messages.slice() : [];
	  if (state?.optimisticUserMessage) {
    const seen = source.some((entry) =>
      String(entry?.role || "") === "user"
      && String(entry?.content || "") === String(state.optimisticUserMessage.content || "")
      && Number(entry?.sequence_no || 0) > Number(state.chatRun?.sequenceBase || 0)
    );
    if (!seen) {
	      source.push({ ...state.optimisticUserMessage });
	    }
	  }
	  if (Array.isArray(state?.promptPreviewRows) && state.promptPreviewRows.length) {
	    source.push(...state.promptPreviewRows.map((entry) => ({ ...entry })));
	  }
	  if (Array.isArray(state?.liveProgressRows) && state.liveProgressRows.length) {
    source.push(...state.liveProgressRows.map((entry) => ({ ...entry })));
  }
  if (state?.liveAssistantMessage?.content) {
    source.push({ ...state.liveAssistantMessage });
  }
  const completedRun = state?.lastCompletedRun || null;
  if (completedRun?.sequenceBase !== undefined && completedRun?.durationLabel) {
    const insertIndex = source.findIndex((entry) =>
      ["assistant_final", "responses_message"].includes(String(entry?.event_type || ""))
      && Number(entry?.sequence_no || 0) > Number(completedRun.sequenceBase || 0)
    );
    const durationEntry = {
      role: "system",
      event_type: "assistant_status",
      title: `Time spent on task: ${completedRun.durationLabel}`,
      content: `Time spent on task: ${completedRun.durationLabel}`,
      synthetic: true,
    };
    if (insertIndex >= 0) {
      source.splice(insertIndex, 0, durationEntry);
    }
    else if (!state?.chatRun || state.chatRun.status !== "running") {
      source.push(durationEntry);
    }
  }
  if (state?.chatRun?.status === "running") {
    source.push({
      role: "system",
      event_type: "assistant_status",
      title: `Time spent on task: ${formatElapsedTime(state.chatRun.elapsedMs || 0)}`,
      content: `Time spent on task: ${formatElapsedTime(state.chatRun.elapsedMs || 0)}`,
      synthetic: true,
    });
  }
  return source;
}

function sessionTitleLabel(session = {}) {
  const rawTitle = String(session?.title || "").trim();
  if (rawTitle && !/^(untitled|new session)$/i.test(rawTitle)) {
    return rawTitle;
  }
  try {
    const value = String(session?.updated_at || session?.created_at || "").trim();
    const date = value ? new Date(value) : new Date();
    if (!Number.isNaN(date.getTime())) {
      return `Session ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  catch (_error) {}
  return "Session";
}

function renderNativeHTML(markdown, state) {
  const renderState = state.renderState || {};
  const citationMap = citationMapFromRenderState(renderState);
  const citationHTMLByToken = new Map();
  for (const [token, preview] of citationMap.entries()) {
    citationHTMLByToken.set(token, String(preview?.html || ""));
  }
  return SystematicReviewerNativeMarkdown.renderEditorHTML(markdown, {
    settings: state.editorSettings,
    citationHTMLByToken,
    bibliographyHTML: renderState.bibliography_html || "",
    prismaHTML: renderState.prisma_html || "",
    baseURL: String(renderState.base_url || state.baseURL || "").trim(),
  });
}

function prismaPlaceholderToken() {
  return String(SystematicReviewerNativeMarkdown.PRISMA_PLACEHOLDER_MARKDOWN || "").trim();
}

function prismaScaffoldDescription() {
  return "PRISMA Flow Diagram. The PRISMA flow diagram for the systematic review detailing the database searches, the number of abstracts screened, and the full texts retrieved.";
}

function pageBreakBlock() {
  return { type: "page-break" };
}

function tocSectionBlocks() {
  return [
    pageBreakBlock(),
    { type: "toc" },
    pageBreakBlock(),
  ];
}

function prismaScaffoldMarkdown() {
  return SystematicReviewerNativeMarkdown.serializeBlocks(prismaScaffoldBlocks());
}

function prismaScaffoldBlocks() {
  const token = prismaPlaceholderToken();
  return [
    pageBreakBlock(),
    { type: "prisma" },
    { type: "paragraph", text: prismaScaffoldDescription() },
    pageBreakBlock(),
  ].filter((block) => !(block?.type === "prisma" && !token));
}

function bibliographySectionBlocks() {
  return [
    pageBreakBlock(),
    { type: "bibliography" },
    pageBreakBlock(),
  ];
}

function prismaFallbackHTML(message = "PRISMA diagram is not available.") {
  return `<div class="sr-prisma-empty" data-sr-prisma="true">${escapeHTML(String(message || "PRISMA diagram is not available."))}</div>`;
}

function prismaPageContext(markdown = "") {
  try {
    const pages = SystematicReviewerNativeMarkdown.paginateBlocks(
      SystematicReviewerNativeMarkdown.parseMarkdown(markdown || "")
    );
    for (const page of pages || []) {
      const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
      const prismaIndex = blocks.findIndex((block) => block?.type === "prisma");
      if (prismaIndex >= 0) {
        return {
          layout: String(page?.layout || "portrait").toLowerCase() === "landscape" ? "landscape" : "portrait",
          before: blocks.slice(0, prismaIndex),
          after: blocks.slice(prismaIndex + 1),
        };
      }
    }
  }
  catch (_error) {}
  return {
    layout: "portrait",
    before: [],
    after: [],
  };
}

function prismaReportFitBox(markdown = "", options = {}) {
  const editorSettings = SystematicReviewerNativeMarkdown.normalizeSettings(options?.editorSettings || {});
  return SystematicReviewerPrismaRenderer.computeReportFitBox(
    prismaPageContext(markdown),
    {
      marginInches: Number(editorSettings?.printMarginInches || 1) || 1,
    }
  );
}

function renderPrismaFigureHTML(prismaState = null, options = {}) {
  if (!prismaState?.diagram) {
    return prismaFallbackHTML();
  }
  try {
    const sourceMarkdown = typeof options?.markdown === "string" ? options.markdown : "";
    const fitBox = Object.prototype.hasOwnProperty.call(options || {}, "fitBox")
      ? options.fitBox
      : prismaReportFitBox(sourceMarkdown, { editorSettings: options?.editorSettings });
    return SystematicReviewerPrismaRenderer.renderFigureHTML(prismaState.diagram, prismaState, {
      doc: options?.doc || document,
      figureClass: "sr-prisma-figure",
      ...(fitBox ? { fitBox } : {}),
    });
  }
  catch (error) {
    return prismaFallbackHTML(error?.message || String(error));
  }
}

function normalizeTableCell(cell) {
  return SystematicReviewerNativeMarkdown.normalizeTableCell(cell);
}

function inlineMarkdownFromNode(node) {
  return SystematicReviewerNativeMarkdown.inlineMarkdownFromNode(node);
}

function nativeTableBlockFromElement(el) {
  return SystematicReviewerNativeMarkdown.tableBlockFromElement(el);
}

function editorNodeToBlocks(node) {
  return SystematicReviewerNativeMarkdown.blocksFromEditorNode(node);
}

function focusEditableStart(editable) {
  if (!editable) {
    return;
  }
  editable.focus();
  if (editable.tagName?.toLowerCase() === "textarea") {
    editable.setSelectionRange(0, 0);
    return;
  }
  const selection = editable.ownerDocument.defaultView.getSelection();
  const range = editable.ownerDocument.createRange();
  range.selectNodeContents(editable);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusEditableEnd(editable) {
  if (!editable) {
    return;
  }
  editable.focus();
  if (editable.tagName?.toLowerCase() === "textarea") {
    const end = String(editable.value || "").length;
    editable.setSelectionRange(end, end);
    return;
  }
  const selection = editable.ownerDocument.defaultView.getSelection();
  const range = editable.ownerDocument.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertHTMLAtSelection(doc, html, fallback = null) {
  try {
    const selection = doc.defaultView.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) {
      fallback?.();
      return;
    }
    range.deleteContents();
    const fragment = range.createContextualFragment(html);
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  catch (_error) {
    fallback?.();
  }
}

function currentSelectionRange(doc) {
  try {
    const selection = doc.defaultView.getSelection();
    if (!selection || !selection.rangeCount) {
      return null;
    }
    return selection.getRangeAt(0);
  }
  catch (_error) {
    return null;
  }
}

function selectNodeContents(doc, node) {
  if (!doc || !node) {
    return false;
  }
  try {
    const selection = doc.defaultView.getSelection();
    if (!selection) {
      return false;
    }
    const range = doc.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  catch (_error) {
    return false;
  }
}

export async function createAutomationTab(ctx) {
  ensureAutomationWorkspaceStyles(document);

  const panel = createNode("section", {
    className: "mw-tab-panel mw-automation-panel",
  });
  const host = createNode("div", { className: "mw-automation-host sr-workspace-root" });
  const styleNode = document.createElement("style");
  host.appendChild(styleNode);

  const newSessionBtn = createButton("New Session", "sr-workspace-btn", { "data-automation-action": "new-session" });
  const status = createNode("div", { className: "sr-workspace-status sr-editor-status-probe", textContent: "", attrs: { "data-automation-status": "true", hidden: "hidden", tabindex: "0" } });
  const statusTooltip = createNode("div", { className: "mw-status-tooltip", attrs: { hidden: "hidden", role: "tooltip" } });
  document.body.appendChild(statusTooltip);

  const modePreviewBtn = createButton("Preview", "sr-mode-tab active", { "data-automation-mode": "preview" });
  const modeNativeBtn = createButton("Editor", "sr-mode-tab", { "data-automation-mode": "native" });
  const modeRawBtn = createButton("Raw", "sr-mode-tab", { "data-automation-mode": "raw" });

  const toolbarLinkBtn = createButton("Link");
  const toolbarBulletBtn = createButton("Bullet");
  const toolbarNumberBtn = createButton("Number");
  const toolbarTableBtn = createButton("Table");
  const toolbarImageBtn = createButton("Image");
  const toolbarPageBreakBtn = createButton("Page Break");
  const toolbarTOCBtn = createButton("TOC", "sr-workspace-btn sr-citation-action");
  const toolbarPrismaBtn = createButton("PRISMA", "sr-workspace-btn sr-citation-action");
  const toolbarCiteBtn = createButton("Cite", "sr-workspace-btn sr-citation-action");
  const toolbarBibliographyBtn = createButton("Bibliography", "sr-workspace-btn sr-citation-action");
	  const saveBtn = createButton("Save", "sr-workspace-btn sr-editor-footer-button sr-workspace-btn-primary", { "data-automation-action": "save" });
	  const exportBtn = createButton("Export", "sr-workspace-btn sr-editor-footer-button");
	  const logBtn = createButton("Log", "sr-workspace-btn sr-editor-footer-button");
	  const memoryBtn = createButton("Memory", "sr-workspace-btn sr-editor-footer-button");
	  const rollbackBtn = createButton("Rollback", "sr-workspace-btn sr-editor-footer-button");
	  const propertiesBtn = createButton("Properties", "sr-workspace-btn sr-editor-footer-button");

  const headingSelect = createSelect("sr-editor-select sr-editor-command-select");
  headingSelect.append(
    createOption("", "Heading"),
    createOption("1", "H1"),
    createOption("2", "H2"),
    createOption("3", "H3"),
    createOption("4", "H4"),
    createOption("5", "H5"),
  );
  const formatSelect = createSelect("sr-editor-select sr-editor-command-select");
  formatSelect.append(
    createOption("", "Format"),
    createOption("bold", "Bold"),
    createOption("italic", "Italic"),
    createOption("underline", "Underline"),
  );
  const layoutSelect = createSelect("sr-editor-select sr-layout-select");
  layoutSelect.append(
    createOption("", "Layout"),
    createOption("portrait", "Portrait"),
    createOption("landscape", "Landscape"),
  );
  const fontSelect = createSelect("sr-editor-select sr-font-select");
  const fontSizeSelect = createSelect("sr-editor-size");
  const citationStyleSelect = createSelect("sr-editor-select sr-citation-style-select");
  const marginSelect = createSelect("sr-editor-select");
  const pageNumbersSelect = createSelect("sr-editor-select sr-page-number-select");
  pageNumbersSelect.append(
    createOption("false", "No page numbers"),
    createOption("true", "Page numbers"),
  );
  const bulletStyleSelect = createSelect("sr-editor-select");
  bulletStyleSelect.append(
    createOption("disc", "Disc"),
    createOption("circle", "Circle"),
    createOption("square", "Square"),
  );
  const sessionSelect = createSelect("sr-editor-select");
  sessionSelect.classList.add("sr-chat-session-select");
  sessionSelect.setAttribute("data-automation-session-select", "true");
  const pageViewScaleRange = document.createElement("input");
  pageViewScaleRange.type = "range";
  pageViewScaleRange.min = "70";
  pageViewScaleRange.max = "150";
  pageViewScaleRange.step = "5";
  pageViewScaleRange.className = "sr-editor-range";
  const pageViewScaleSlider = createNode("div", {
    className: "sr-editor-range-wrap",
    children: [
      createNode("div", { className: "sr-editor-range-track" }),
      createNode("div", { className: "sr-editor-range-thumb-visual" }),
      pageViewScaleRange,
    ],
  });
  const pageViewScaleValue = createNode("span", { className: "sr-editor-range-value", textContent: "100%" });
  const stylePresetNote = createNode("span", { className: "sr-editor-style-note" });
  [
    headingSelect,
    formatSelect,
    toolbarLinkBtn,
    toolbarBulletBtn,
    toolbarNumberBtn,
    toolbarTableBtn,
    toolbarImageBtn,
    layoutSelect,
    fontSelect,
    fontSizeSelect,
    citationStyleSelect,
    stylePresetNote,
    marginSelect,
    pageNumbersSelect,
  ].forEach((node) => node.classList?.add?.("sr-mode-native-or-preview"));
  [
    headingSelect,
    formatSelect,
    toolbarLinkBtn,
    toolbarBulletBtn,
    toolbarNumberBtn,
    toolbarTableBtn,
    toolbarImageBtn,
    layoutSelect,
  ].forEach((node) => node.classList?.add?.("sr-mode-native-only"));
  [
    toolbarPageBreakBtn,
    toolbarTOCBtn,
    toolbarPrismaBtn,
    toolbarCiteBtn,
    toolbarBibliographyBtn,
  ].forEach((node) => node.classList?.add?.("sr-mode-native-or-raw"));
  [
	    saveBtn,
	    exportBtn,
	    logBtn,
	    memoryBtn,
	    rollbackBtn,
	    propertiesBtn,
	  ].forEach((node) => node.classList?.add?.("sr-mode-always"));

  const preview = createNode("div", { className: "sr-workspace-preview", attrs: { "data-automation-surface": "preview" } });
  const nativeEditor = createNode("div", { className: "sr-workspace-native", attrs: { hidden: "hidden", "data-automation-surface": "native" } });
  const rawEditor = document.createElement("textarea");
  rawEditor.className = "sr-workspace-raw";
  rawEditor.hidden = true;
  rawEditor.spellcheck = false;
  rawEditor.setAttribute("data-automation-surface", "raw");

  const chatMessages = createNode("div", { className: "sr-workspace-chat-messages", attrs: { "data-automation-chat-log": "true" } });
  const chatInput = document.createElement("textarea");
  chatInput.className = "sr-workspace-chat-input";
  chatInput.rows = 3;
  chatInput.placeholder = "Ask the agent what to do next, or continue this collection session.";
  const chatCommandMenu = createNode("div", { className: "sr-chat-command-menu", attrs: { hidden: "hidden" } });
  const chatExploreScopeSelect = createSelect("sr-editor-select");
  chatExploreScopeSelect.setAttribute("aria-label", "Explore scope");
  const chatExploreSummary = createNode("div", { className: "sr-chat-explore-summary" });
  const chatExploreColumnsPreview = createNode("div", { className: "sr-chat-explore-columns-preview" });
  const chatExploreStatus = createNode("div", { className: "sr-chat-explore-status" });
  const chatExploreConfirmCopy = createNode("div", { className: "sr-chat-explore-confirm-copy" });
  const chatExploreContinueBtn = createButton("Continue", "sr-workspace-btn sr-workspace-btn-primary", { type: "button" });
  const chatExploreCancelBtn = createButton("Cancel", "sr-workspace-btn", { type: "button" });
  const chatExploreCopy = createNode("div", {
    className: "sr-chat-explore-copy",
    attrs: { "data-automation-chat-explore-copy": "true" },
    children: [
      chatExploreSummary,
      chatExploreColumnsPreview,
      chatExploreStatus,
    ],
  });
  const chatExploreConfirm = createNode("div", {
    className: "sr-chat-explore-confirm",
    attrs: { hidden: "hidden" },
    children: [
      chatExploreConfirmCopy,
      createNode("div", {
        className: "sr-chat-explore-confirm-actions",
        children: [chatExploreCancelBtn, chatExploreContinueBtn],
      }),
    ],
  });
  const chatExploreStrip = createNode("div", {
    className: "sr-chat-explore-strip",
    attrs: { hidden: "hidden", "data-automation-chat-explore": "true" },
    children: [
      createNode("div", {
        className: "sr-chat-explore-top",
        children: [
          chatExploreCopy,
          createNode("label", {
            className: "sr-chat-explore-scope-field",
            children: [
              createNode("span", { textContent: "Scope" }),
              chatExploreScopeSelect,
            ],
          }),
        ],
      }),
      chatExploreConfirm,
    ],
  });
  const chatFindModeKeywordBtn = createButton("Keyword", "sr-workspace-btn sr-chat-find-chip active", {
    type: "button",
    "aria-pressed": "true",
    "data-automation-chat-find-mode": "keyword",
  });
  const chatFindModeSemanticBtn = createButton("Semantic", "sr-workspace-btn sr-chat-find-chip", {
    type: "button",
    "aria-pressed": "false",
    "data-automation-chat-find-mode": "semantic",
  });
  const chatFindScopeSelect = createSelect("sr-editor-select");
  chatFindScopeSelect.setAttribute("aria-label", "Find Arguments scope");
  const chatFindSummary = createNode("div", { className: "sr-chat-explore-summary" });
  const chatFindQueryPreview = createNode("div", { className: "sr-chat-explore-columns-preview" });
  const chatFindStatus = createNode("div", { className: "sr-chat-explore-status" });
  const chatFindStrip = createNode("div", {
    className: "sr-chat-explore-strip sr-chat-find-strip",
    attrs: { hidden: "hidden", "data-automation-chat-find": "true" },
    children: [
      createNode("div", {
        className: "sr-chat-find-controls",
        children: [
          createNode("div", {
            className: "sr-chat-explore-copy",
            children: [
              chatFindSummary,
              chatFindQueryPreview,
              chatFindStatus,
            ],
          }),
          createNode("div", {
            className: "sr-chat-find-mode",
            children: [chatFindModeKeywordBtn, chatFindModeSemanticBtn],
          }),
          createNode("label", {
            className: "sr-chat-explore-scope-field",
            children: [
              createNode("span", { textContent: "Scope" }),
              chatFindScopeSelect,
            ],
          }),
        ],
      }),
    ],
  });
  const chatAutodriveSummary = createNode("div", { className: "sr-chat-explore-summary" });
  const chatAutodrivePreview = createNode("div", { className: "sr-chat-explore-columns-preview" });
  const chatAutodriveStatus = createNode("div", { className: "sr-chat-explore-status" });
  const chatAutodriveCountInput = document.createElement("input");
  chatAutodriveCountInput.type = "number";
  chatAutodriveCountInput.min = "1";
  chatAutodriveCountInput.max = "20";
  chatAutodriveCountInput.step = "1";
  chatAutodriveCountInput.value = "3";
  chatAutodriveCountInput.className = "sr-editor-input sr-chat-autodrive-count";
  chatAutodriveCountInput.setAttribute("aria-label", "Auto Drive turns");
  const chatAutodriveCountButtons = [1, 3, 5, 10].map((count) => createButton(String(count), "sr-workspace-btn sr-chat-find-chip", {
    type: "button",
    "data-automation-autodrive-count": String(count),
  }));
  const chatAutodriveReviewerSelect = createSelect("sr-editor-select sr-chat-autodrive-reviewer-select");
  chatAutodriveReviewerSelect.setAttribute("aria-label", "Auto Drive reviewer mode");
  chatAutodriveReviewerSelect.append(
    createOption("done_blocked", "When agent says done/blocked"),
    createOption("every_turn", "After every turn"),
    createOption("final_turn", "Final check only")
  );
  const chatAutodriveAgentPromptTab = createButton("Agent prompt", "sr-workspace-btn sr-chat-autodrive-prompt-tab active", {
    type: "button",
    "aria-pressed": "true",
    "data-automation-autodrive-prompt-tab": "agent",
  });
  const chatAutodriveReviewerPromptTab = createButton("Reviewer prompt", "sr-workspace-btn sr-chat-autodrive-prompt-tab", {
    type: "button",
    "aria-pressed": "false",
    "data-automation-autodrive-prompt-tab": "reviewer",
  });
  const chatAutodrivePrompt = document.createElement("textarea");
  chatAutodrivePrompt.className = "sr-chat-autodrive-prompt";
  chatAutodrivePrompt.placeholder = "Auto Drive agent prompt";
  chatAutodrivePrompt.spellcheck = true;
  const chatAutodriveReviewerPrompt = document.createElement("textarea");
  chatAutodriveReviewerPrompt.className = "sr-chat-autodrive-prompt";
  chatAutodriveReviewerPrompt.placeholder = "Auto Drive reviewer prompt";
  chatAutodriveReviewerPrompt.spellcheck = true;
  chatAutodriveReviewerPrompt.hidden = true;
  const chatAutodriveStartBtn = createButton("Start Auto Drive", "sr-workspace-btn sr-workspace-btn-primary", { type: "button" });
  const chatAutodriveStopBtn = createButton("Stop Auto Drive", "sr-workspace-btn", { type: "button", hidden: "hidden" });
  const chatAutodriveCancelBtn = createButton("Cancel", "sr-workspace-btn", { type: "button" });
  const chatAutodriveStrip = createNode("div", {
    className: "sr-chat-explore-strip sr-chat-autodrive-strip",
    attrs: { hidden: "hidden", "data-automation-chat-autodrive": "true" },
    children: [
      createNode("div", {
        className: "sr-chat-explore-copy",
        children: [
          chatAutodriveSummary,
          chatAutodrivePreview,
          chatAutodriveStatus,
        ],
      }),
      createNode("div", {
        className: "sr-chat-autodrive-grid",
        children: [
          createNode("div", {
            className: "sr-chat-autodrive-row",
            children: [
              createNode("span", { className: "sr-chat-autodrive-row-label", textContent: "Turns" }),
              ...chatAutodriveCountButtons,
              chatAutodriveCountInput,
            ],
          }),
          createNode("div", {
            className: "sr-chat-autodrive-row",
            children: [
              createNode("span", { className: "sr-chat-autodrive-row-label", textContent: "Reviewer" }),
              chatAutodriveReviewerSelect,
            ],
          }),
          createNode("div", {
            className: "sr-chat-autodrive-prompt-tabs",
            children: [chatAutodriveAgentPromptTab, chatAutodriveReviewerPromptTab],
          }),
          chatAutodrivePrompt,
          chatAutodriveReviewerPrompt,
          createNode("div", {
            className: "sr-chat-autodrive-actions",
            children: [chatAutodriveCancelBtn, chatAutodriveStopBtn, chatAutodriveStartBtn],
          }),
        ],
      }),
    ],
  });
  const chatRunStatus = createNode("div", { className: "sr-chat-run-status" });
  const chatBudgetStrip = createNode("div", { className: "sr-chat-budget-strip" });
  const chatModelBtn = createButton("Model", "sr-workspace-btn sr-chat-model-trigger", {
    type: "button",
    "data-automation-chat-model-button": "true",
  });
  const chatReasoningSelect = createSelect("sr-editor-select sr-chat-reasoning-select");
  chatReasoningSelect.setAttribute("data-automation-chat-reasoning-select", "true");
  chatReasoningSelect.hidden = true;
  chatReasoningSelect.append(
    createOption("", "Default"),
    createOption("none", "None"),
    createOption("minimal", "Minimal"),
    createOption("low", "Low"),
    createOption("medium", "Medium"),
    createOption("high", "High"),
    createOption("xhigh", "XHigh"),
    createOption("__custom__", "Custom..."),
  );
  const chatReasoningCustomInput = document.createElement("input");
  chatReasoningCustomInput.className = "sr-editor-input sr-chat-reasoning-custom";
  chatReasoningCustomInput.type = "text";
  chatReasoningCustomInput.placeholder = "(e.g. xhigh)";
  chatReasoningCustomInput.hidden = true;
  chatReasoningCustomInput.spellcheck = false;
  chatReasoningCustomInput.setAttribute("data-automation-chat-reasoning-custom", "true");
  const chatOpenCodeModelSelect = createSelect("sr-editor-select sr-chat-opencode-model-select");
  chatOpenCodeModelSelect.setAttribute("data-automation-chat-opencode-model-select", "true");
  chatOpenCodeModelSelect.hidden = true;
  chatOpenCodeModelSelect.appendChild(createOption("", "Default set in OpenCode"));
  const chatModelSelect = createSelect("sr-editor-select");
  chatModelSelect.classList.add("sr-chat-model-select");
  chatModelSelect.setAttribute("data-automation-chat-model-select", "true");
  chatModelSelect.disabled = true;
  chatModelSelect.appendChild(createOption("", "Loading chat models..."));
  const chatModelNote = createNode("div", {
    className: "sr-chat-model-note",
    attrs: { "data-automation-chat-model-note": "true" },
  });
  chatModelNote.textContent = "Loading configured chat models...";
  const chatModelSelectDock = createNode("div", {
    attrs: { hidden: "hidden", "data-automation-chat-model-dock": "true" },
    children: [chatModelSelect, chatOpenCodeModelSelect, chatReasoningSelect, chatReasoningCustomInput, chatModelNote],
  });
  const stopBtn = createButton("Stop", "sr-workspace-btn sr-workspace-stop", {
    type: "button",
    hidden: "hidden",
    "data-automation-action": "stop",
  });
  const sendBtn = createButton("Send", "sr-workspace-send", { "data-automation-action": "send", type: "submit" });
  const chatQueueList = createNode("div", {
    className: "sr-chat-queue-list",
    attrs: { hidden: "hidden", "data-automation-chat-queue": "true" },
  });
  const chatPopoverLayer = createNode("div", {
    className: "sr-chat-inline-popover-layer",
    attrs: { "data-automation-chat-popovers": "true" },
  });
  const overlayHost = createNode("div", { className: "sr-overlay-host" });
  const workspaceDivider = createNode("div", { className: "sr-workspace-divider", attrs: { "data-automation-divider": "true", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize chat panel" } });

  const workspaceCard = createNode("div", {
    className: "sr-workspace-card sr-workspace-main",
    children: [
      createNode("div", {
        className: "sr-workspace-card-body",
        children: [preview, nativeEditor, rawEditor],
      }),
    ],
  });

  const chatCard = createNode("div", {
    className: "sr-workspace-card",
    children: [
      createNode("div", {
        className: "sr-workspace-card-header sr-chat-card-header",
        children: [
          createNode("div", {
            className: "sr-chat-header-actions",
            children: [sessionSelect, newSessionBtn],
          }),
        ],
      }),
      createNode("div", {
        className: "sr-workspace-card-body",
        children: [
          chatMessages,
          createNode("form", {
            className: "sr-workspace-chat-form",
            children: [
              chatCommandMenu,
              chatQueueList,
              chatInput,
              chatExploreStrip,
              chatFindStrip,
              chatAutodriveStrip,
              chatModelSelectDock,
              createNode("div", {
                className: "sr-chat-actions",
                children: [
                  createNode("div", {
                    className: "sr-chat-footer-row",
                    children: [
                      createNode("div", {
                        className: "sr-chat-footer-left",
                        children: [chatModelBtn, chatBudgetStrip],
                      }),
                      createNode("div", {
                        className: "sr-chat-footer-right",
                        children: [stopBtn, sendBtn],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          chatPopoverLayer,
        ],
      }),
    ],
  });

  const footer = createNode("div", {
    className: "sr-editor-footer-strip",
    children: [
      createNode("div", {
        className: "sr-editor-footer-main",
        children: [
          createNode("div", { className: "sr-mode-tabs", children: [modePreviewBtn, modeNativeBtn, modeRawBtn] }),
	          createNode("div", {
	            className: "sr-editor-footer-actions",
	            children: [propertiesBtn, saveBtn, exportBtn, logBtn, memoryBtn, rollbackBtn],
	          }),
          createNode("div", {
            className: "sr-editor-footer-zoom",
            children: [
              createNode("span", { className: "sr-editor-footer-label", textContent: "Zoom" }),
              pageViewScaleSlider,
              pageViewScaleValue,
            ],
          }),
        ],
      }),
    ],
  });

  const shell = createNode("div", {
    className: "sr-workspace-shell",
    children: [
      workspaceCard,
      workspaceDivider,
      createNode("div", { className: "sr-workspace-sidebar", children: [chatCard] }),
    ],
  });

  host.append(shell, footer, status, overlayHost);
  panel.appendChild(host);
  const chatForm = chatCard.querySelector("form");

  const state = {
    doc: document,
    bootstrap: null,
    renderState: null,
    editorSettings: SystematicReviewerNativeMarkdown.normalizeSettings({}),
    mode: "preview",
    markdown: "",
    markdownRevision: 0,
    lastSavedMarkdown: "",
    settingsRevision: 0,
    dirty: false,
    nativeDirty: false,
    activeEditable: null,
    nativeActiveEditable: null,
    lastSelectionState: null,
    tableSelection: null,
    tableDrag: null,
    suppressNextTableClick: false,
    contextMenuState: null,
    citationCatalog: [],
    citationCatalogPromise: null,
    citationChipLabelCache: new Map(),
    citationChipLabelPromiseCache: new Map(),
    exploreColumnOptions: [],
    exploreColumnOptionsPromise: null,
    chatExploreColumns: [],
    chatExploreScopes: [],
    chatExploreScopesPromise: null,
    chatExploreScopeLoading: false,
    chatExploreScopeError: "",
    chatExploreSelectedScopeKey: "",
    chatExploreScopeOptionsSignature: "",
    chatExploreHasUserSelectedScope: false,
    chatExploreConfirming: false,
    chatFindMode: "keyword",
    chatFindScopes: [],
    chatFindScopesPromise: null,
    chatFindScopeLoading: false,
    chatFindScopeError: "",
    chatFindSelectedScopeKey: "",
    chatFindScopeOptionsSignature: "",
    chatFindHasUserSelectedScope: false,
    chatFindConfig: null,
    chatFindConfigPromise: null,
    chatFindConfigLoading: false,
    chatFindConfigError: "",
    chatAutodriveDefaults: null,
    chatAutodriveDefaultsPromise: null,
    chatAutodriveDefaultsLoading: false,
    chatAutodriveDefaultsError: "",
    chatAutodrivePromptTouched: false,
    chatAutodriveReviewerPromptTouched: false,
    chatAutodrivePromptTab: "agent",
    chatAutodriveCount: 3,
    chatAutodriveReviewerMode: "done_blocked",
    exploreBatchCache: new Map(),
    baseURL: "",
    overlay: null,
    findPanel: null,
    findPanelSession: {
      query: "",
      replaceText: "",
      matchCase: false,
      scopeMode: "document",
    },
    findPanelPosition: null,
    destroyed: false,
    renderToken: 0,
    reflowFrame: 0,
    reflowing: false,
    reflowTimers: { preview: 0, native: 0 },
    pendingReflows: new Set(),
    renderedSignature: { preview: "", native: "" },
    sidebarWidthPx: 360,
    splitDrag: null,
    localCommands: [],
    commandMenu: { open: false, items: [], selectedIndex: 0, token: "" },
    chatRun: null,
    lastCompletedRun: null,
    chatPollTimer: 0,
    chatClockTimer: 0,
    sessionContextHydrationToken: 0,
    optimisticUserMessage: null,
    queuedDraft: null,
    chatPopover: null,
    chatPopoverTimer: 0,
	    chatStreamAbortController: null,
	    liveAssistantMessage: null,
	    liveProgressRows: [],
	    promptPreviewRows: [],
	    chatDetailState: new Map(),
    previewModeLocked: false,
    previewRefreshTimer: 0,
    previewRefreshToken: 0,
    previewRefreshInFlight: false,
    pendingPreviewRefresh: false,
    tocRefreshTimer: 0,
    pendingPreviewRefreshForce: false,
    runReportBaselineHash: "",
    lastRenderedReportHash: "",
    previewProgrammaticScroll: false,
    nativeProgrammaticScroll: false,
    nativeBlurReflowTimer: 0,
    pendingCitationCaret: null,
    chatProgrammaticScroll: false,
    chatAutoFollowLocked: false,
    chatLastScrollTop: 0,
    nativeMutationObserver: null,
  };
  state.els = {
    preview,
    nativeEditor,
    rawEditor,
    fontSelect,
    fontSizeSelect,
    citationStyleSelect,
    stylePresetNote,
    marginSelect,
    pageNumbersSelect,
    bulletStyleSelect,
    propertiesBtn,
    saveBtn,
	    exportBtn,
	    logBtn,
	    memoryBtn,
	    rollbackBtn,
    sessionSelect,
    pageViewScaleRange,
    pageViewScaleValue,
    overlayHost,
    chatMessages,
    chatRunStatus,
    chatBudgetStrip,
    chatModelBtn,
    stopBtn,
    chatReasoningSelect,
    chatReasoningCustomInput,
    chatOpenCodeModelSelect,
    chatModelSelect,
    chatModelSelectDock,
    chatModelNote,
    chatQueueList,
    chatCommandMenu,
    chatPopoverLayer,
    workspaceDivider,
  };

  const chatPlaceholderAutocomplete = createSearchablePlaceholderAutocomplete(ctx, {
    getOptions: () => (Array.isArray(state.exploreColumnOptions) ? state.exploreColumnOptions : []).filter((entry) =>
      !["item_key", "citation_token"].includes(String(entry?.key || "").trim())
    ),
    ensureOptions: async () => {
      if (Array.isArray(state.exploreColumnOptions) && state.exploreColumnOptions.length) {
        return;
      }
      if (!state.exploreColumnOptionsPromise) {
        state.exploreColumnOptionsPromise = ctx.invoke("workflow.options.exploreColumns.list", {})
          .then((result) => {
            state.exploreColumnOptions = Array.isArray(result?.columns) ? result.columns : [];
            return state.exploreColumnOptions;
          })
          .finally(() => {
            state.exploreColumnOptionsPromise = null;
          });
      }
      await state.exploreColumnOptionsPromise;
    },
    searchPlaceholder: "Filter columns...",
    metaLabel: "columns",
    emptyText: "No columns match this filter.",
    metaText: (entry) => [String(entry?.label || ""), String(entry?.origin || "")]
      .filter(Boolean)
      .join(" - "),
  });
  chatPlaceholderAutocomplete.attach(chatInput);

  function positionStatusTooltip(anchor) {
    if (!anchor || !statusTooltip || statusTooltip.hidden) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    statusTooltip.style.left = "0px";
    statusTooltip.style.top = "0px";
    const tipRect = statusTooltip.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + gap;
    if (top + tipRect.height + 8 > viewportHeight) {
      top = Math.max(8, rect.top - tipRect.height - gap);
    }
    if (left + tipRect.width + 8 > viewportWidth) {
      left = Math.max(8, viewportWidth - tipRect.width - 8);
    }
    statusTooltip.style.left = `${Math.round(Math.max(8, left))}px`;
    statusTooltip.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  function showStatusTooltip(anchor) {
    const fullMessage = cleanDisplayText(anchor?.getAttribute?.("data-status-full") || anchor?.textContent || "");
    if (!fullMessage) {
      return;
    }
    statusTooltip.textContent = fullMessage;
    statusTooltip.hidden = false;
    positionStatusTooltip(anchor);
    window.requestAnimationFrame(() => positionStatusTooltip(anchor));
  }

  function hideStatusTooltip() {
    statusTooltip.hidden = true;
  }

  status.addEventListener("mouseenter", () => showStatusTooltip(status));
  status.addEventListener("mousemove", () => positionStatusTooltip(status));
  status.addEventListener("mouseleave", hideStatusTooltip);
  status.addEventListener("focus", () => showStatusTooltip(status));
  status.addEventListener("blur", hideStatusTooltip);

  function setStatus(message, tone = "") {
    const fullMessage = cleanDisplayText(message);
    status.className = `sr-workspace-status${tone ? ` ${tone}` : ""}`;
    status.textContent = compactStatusText(fullMessage);
    status.title = fullMessage;
    status.setAttribute("aria-label", fullMessage);
    status.setAttribute("data-status-full", fullMessage);
    status.setAttribute("tabindex", "0");
    ctx.setStatus?.(fullMessage, tone === "error" ? "is-error" : (tone === "ready" ? "is-ready" : ""));
  }

  function automationPromptHasExplorePlaceholders(text = "") {
    return /@\{[A-Za-z_][A-Za-z0-9_:-]*\}/.test(automationExplorePromptText(text));
  }

  function automationPromptExploreColumnKeys(text = "") {
    const source = automationExplorePromptText(text);
    const pattern = /@\{([A-Za-z_][A-Za-z0-9_:-]*)\}/g;
    const seen = new Set();
    const keys = [];
    let match = null;
    while ((match = pattern.exec(source))) {
      const key = String(match[1] || "").trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      keys.push(key);
    }
    return keys;
  }

  function automationPromptIsFindDraft(text = "") {
    return /^\/find(?:\s|$)/i.test(String(text || "").trimStart());
  }

  function automationPromptIsAutodriveDraft(text = "") {
    return /^\/autodrive(?:\s|$)/i.test(String(text || "").trimStart());
  }

  function automationPromptIsExploreDraft(text = "") {
    return /^\/explore(?:\s|$)/i.test(String(text || "").trimStart());
  }

  function automationExplorePromptText(text = "") {
    return String(text || "").trimStart().replace(/^\/explore(?:\s+|$)/i, "").trim();
  }

  function automationFindDraftInfo(text = "") {
    let query = String(text || "").trimStart().replace(/^\/find(?:\s+|$)/i, "").trim();
    let mode = String(state.chatFindMode || "keyword").trim().toLowerCase();
    let explicitMode = "";
    let modeMatch = query.match(/^(keyword|semantic)\b/i);
    if (modeMatch) {
      mode = String(modeMatch[1] || "keyword").trim().toLowerCase();
      explicitMode = mode;
      query = query.slice(modeMatch[0].length).trim();
    }
    if (!["keyword", "semantic"].includes(mode)) {
      mode = "keyword";
    }
    return { mode, query, explicitMode };
  }

  function normalizeAutomationAutodriveCount(value) {
    let numeric = Math.round(Number(value || 0) || 0);
    if (!numeric) {
      numeric = 3;
    }
    return Math.max(1, Math.min(20, numeric));
  }

  function normalizeAutomationAutodriveReviewerMode(value = "") {
    const clean = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["every", "each", "every_turn", "after_every_turn", "after_each_turn"].includes(clean)) {
      return "every_turn";
    }
    if (["final", "final_turn", "final_check", "at_final_turn"].includes(clean)) {
      return "final_turn";
    }
    return "done_blocked";
  }

  function automationAutodriveReviewerModeLabel(mode = "") {
    const normalized = normalizeAutomationAutodriveReviewerMode(mode);
    if (normalized === "every_turn") {
      return "after every turn";
    }
    if (normalized === "final_turn") {
      return "on the final turn";
    }
    return "when the agent says done or blocked";
  }

  function defaultAutomationExploreScopeKey(scopes = []) {
    const available = Array.isArray(scopes) ? scopes : [];
    if (!available.length) {
      return "";
    }
    const remembered = String(state.bootstrap?.current_project?.session?.last_explore_scope_key || "").trim();
    if (remembered && available.some((entry) => String(entry?.collection_key || "").trim() === remembered)) {
      return remembered;
    }
    const currentProjectType = String(
      state.bootstrap?.current_project?.project_type
      || state.bootstrap?.current_project?.projectType
      || ""
    ).trim().toLowerCase();
    if (currentProjectType === "systematic_review") {
      const included = available.find((entry) => String(entry?.collection_name || "").trim().toLowerCase() === "included");
      if (included?.collection_key) {
        return String(included.collection_key).trim();
      }
    }
    return String(available[0]?.collection_key || "").trim();
  }

  function defaultAutomationFindScopeKey(scopes = []) {
    const available = Array.isArray(scopes) ? scopes : [];
    if (!available.length) {
      return "";
    }
    const currentProjectType = String(
      state.bootstrap?.current_project?.project_type
      || state.bootstrap?.current_project?.projectType
      || ""
    ).trim().toLowerCase();
    if (currentProjectType === "systematic_review") {
      const included = available.find((entry) => String(entry?.collection_name || "").trim().toLowerCase() === "included");
      if (included?.collection_key) {
        return String(included.collection_key).trim();
      }
    }
    return String(available[0]?.collection_key || "").trim();
  }

  function syncAutomationExploreScopeSelection(options = {}) {
    const scopes = Array.isArray(state.chatExploreScopes) ? state.chatExploreScopes : [];
    if (!scopes.length) {
      state.chatExploreSelectedScopeKey = "";
      return "";
    }
    const validKeys = new Set(
      scopes
        .map((entry) => String(entry?.collection_key || "").trim())
        .filter(Boolean)
    );
    let nextKey = String(state.chatExploreSelectedScopeKey || chatExploreScopeSelect.value || "").trim();
    if (!state.chatExploreHasUserSelectedScope || options.forceDefault || !validKeys.has(nextKey)) {
      nextKey = defaultAutomationExploreScopeKey(scopes);
      if (!validKeys.has(nextKey)) {
        nextKey = String(scopes[0]?.collection_key || "").trim();
      }
    }
    state.chatExploreSelectedScopeKey = nextKey;
    return nextKey;
  }

  function currentAutomationExploreScopeKey() {
    return String(chatExploreScopeSelect.value || state.chatExploreSelectedScopeKey || "").trim();
  }

  function currentAutomationExploreScopeLabel() {
    const scopeKey = currentAutomationExploreScopeKey();
    if (!scopeKey) {
      return "";
    }
    const match = (Array.isArray(state.chatExploreScopes) ? state.chatExploreScopes : [])
      .find((entry) => String(entry?.collection_key || "").trim() === scopeKey);
    return String(match?.collection_name || match?.collection_key || scopeKey).trim();
  }

  async function ensureAutomationExploreScopes(options = {}) {
    if (Array.isArray(state.chatExploreScopes) && state.chatExploreScopes.length && !options.force) {
      syncAutomationExploreScopeSelection();
      return state.chatExploreScopes;
    }
    if (state.chatExploreScopesPromise) {
      return await state.chatExploreScopesPromise;
    }
    state.chatExploreScopeLoading = true;
    state.chatExploreScopeError = "";
    renderChatExploreComposer();
    state.chatExploreScopesPromise = ctx.invoke("automation.scope.list", {})
      .then((result) => {
        const scopes = Array.isArray(result?.scopes) ? result.scopes.slice() : [];
        if (!scopes.length) {
          throw new Error("No project scopes are available for Explore.");
        }
        state.chatExploreScopes = scopes;
        syncAutomationExploreScopeSelection({ forceDefault: !!options.forceDefault });
        return scopes;
      })
      .catch((error) => {
        state.chatExploreScopes = [];
        state.chatExploreSelectedScopeKey = "";
        state.chatExploreScopeError = error?.message || String(error);
        throw error;
      })
      .finally(() => {
        state.chatExploreScopeLoading = false;
        state.chatExploreScopesPromise = null;
        renderChatExploreComposer();
      });
    return await state.chatExploreScopesPromise;
  }

  function syncAutomationFindScopeSelection(options = {}) {
    const scopes = Array.isArray(state.chatFindScopes) ? state.chatFindScopes : [];
    if (!scopes.length) {
      state.chatFindSelectedScopeKey = "";
      return "";
    }
    const validKeys = new Set(
      scopes
        .map((entry) => String(entry?.collection_key || "").trim())
        .filter(Boolean)
    );
    let nextKey = String(state.chatFindSelectedScopeKey || chatFindScopeSelect.value || "").trim();
    if (!state.chatFindHasUserSelectedScope || options.forceDefault || !validKeys.has(nextKey)) {
      nextKey = defaultAutomationFindScopeKey(scopes);
      if (!validKeys.has(nextKey)) {
        nextKey = String(scopes[0]?.collection_key || "").trim();
      }
    }
    state.chatFindSelectedScopeKey = nextKey;
    return nextKey;
  }

  function currentAutomationFindScopeKey() {
    return String(chatFindScopeSelect.value || state.chatFindSelectedScopeKey || "").trim();
  }

  function currentAutomationFindScopeLabel() {
    const scopeKey = currentAutomationFindScopeKey();
    if (!scopeKey) {
      return "";
    }
    const match = (Array.isArray(state.chatFindScopes) ? state.chatFindScopes : [])
      .find((entry) => String(entry?.collection_key || "").trim() === scopeKey);
    return String(match?.collection_name || match?.collection_key || scopeKey).trim();
  }

  async function ensureAutomationFindScopes(options = {}) {
    if (Array.isArray(state.chatFindScopes) && state.chatFindScopes.length && !options.force) {
      syncAutomationFindScopeSelection();
      return state.chatFindScopes;
    }
    if (state.chatFindScopesPromise) {
      return await state.chatFindScopesPromise;
    }
    state.chatFindScopeLoading = true;
    state.chatFindScopeError = "";
    renderChatFindComposer();
    state.chatFindScopesPromise = ctx.invoke("automation.scope.list", {})
      .then((result) => {
        const scopes = Array.isArray(result?.scopes) ? result.scopes.slice() : [];
        if (!scopes.length) {
          throw new Error("No project scopes are available for Find Arguments.");
        }
        state.chatFindScopes = scopes;
        syncAutomationFindScopeSelection({ forceDefault: !!options.forceDefault });
        return scopes;
      })
      .catch((error) => {
        state.chatFindScopes = [];
        state.chatFindSelectedScopeKey = "";
        state.chatFindScopeError = error?.message || String(error);
        throw error;
      })
      .finally(() => {
        state.chatFindScopeLoading = false;
        state.chatFindScopesPromise = null;
        renderChatFindComposer();
      });
    return await state.chatFindScopesPromise;
  }

  function currentAutomationFindSemanticState() {
    const config = state.chatFindConfig && typeof state.chatFindConfig === "object" ? state.chatFindConfig : null;
    const configured = !!config?.embeddings_model_configured;
    const available = !!config?.semantic_available;
    const reason = String(config?.semantic_unavailable_reason || "").trim();
    return {
      configured,
      available,
      loading: !!state.chatFindConfigLoading || !!state.chatFindConfigPromise,
      error: String(state.chatFindConfigError || "").trim(),
      reason,
      show: configured,
      disabled: configured && !available,
    };
  }

  async function ensureAutomationFindConfig(options = {}) {
    if (state.chatFindConfig && !options.force) {
      return state.chatFindConfig;
    }
    if (state.chatFindConfigPromise) {
      return await state.chatFindConfigPromise;
    }
    state.chatFindConfigLoading = true;
    state.chatFindConfigError = "";
    renderChatFindComposer();
    const payload = {};
    const scopeKey = currentAutomationFindScopeKey();
    if (scopeKey) {
      payload.collection_key = scopeKey;
    }
    state.chatFindConfigPromise = ctx.invoke("documents.getConfig", payload)
      .then((result) => {
        state.chatFindConfig = result || {};
        return state.chatFindConfig;
      })
      .catch((error) => {
        state.chatFindConfig = null;
        state.chatFindConfigError = error?.message || String(error);
        throw error;
      })
      .finally(() => {
        state.chatFindConfigLoading = false;
        state.chatFindConfigPromise = null;
        renderChatFindComposer();
      });
    return await state.chatFindConfigPromise;
  }

  async function ensureAutomationAutodriveDefaults(options = {}) {
    if (state.chatAutodriveDefaults && !options.force) {
      return state.chatAutodriveDefaults;
    }
    if (state.chatAutodriveDefaultsPromise) {
      return await state.chatAutodriveDefaultsPromise;
    }
    state.chatAutodriveDefaultsLoading = true;
    state.chatAutodriveDefaultsError = "";
    renderChatAutodriveComposer();
    state.chatAutodriveDefaultsPromise = ctx.invoke("automation.autodrive.prompt_defaults", {
      session_id: sessionSelect.value,
    })
      .then((result) => {
        state.chatAutodriveDefaults = result || {};
        const defaultCount = normalizeAutomationAutodriveCount(result?.default_count || state.chatAutodriveCount || 3);
        state.chatAutodriveCount = defaultCount;
        chatAutodriveCountInput.value = String(defaultCount);
        state.chatAutodriveReviewerMode = normalizeAutomationAutodriveReviewerMode(result?.default_reviewer_mode || state.chatAutodriveReviewerMode);
        if (!state.chatAutodrivePromptTouched) {
          chatAutodrivePrompt.value = String(result?.prompt_text || "");
        }
        if (!state.chatAutodriveReviewerPromptTouched) {
          chatAutodriveReviewerPrompt.value = String(result?.reviewer_prompt_text || "");
        }
        return state.chatAutodriveDefaults;
      })
      .catch((error) => {
        state.chatAutodriveDefaults = null;
        state.chatAutodriveDefaultsError = error?.message || String(error);
        throw error;
      })
      .finally(() => {
        state.chatAutodriveDefaultsLoading = false;
        state.chatAutodriveDefaultsPromise = null;
        renderChatAutodriveComposer();
      });
    return await state.chatAutodriveDefaultsPromise;
  }

  function renderChatExploreComposer() {
    const message = optionalString(chatInput.value);
    const isSlashDraft = automationPromptIsExploreDraft(message);
    const columns = automationPromptExploreColumnKeys(message);
    state.chatExploreColumns = columns;
    const isExploreDraft = isSlashDraft || columns.length > 0;
    if (!isExploreDraft) {
      state.chatExploreConfirming = false;
      state.chatExploreHasUserSelectedScope = false;
      state.chatExploreSelectedScopeKey = "";
      state.chatExploreScopeOptionsSignature = "";
      state.chatExploreScopeError = "";
      closeChatPopover("explore-draft");
      chatExploreStrip.hidden = true;
      chatExploreConfirm.hidden = true;
      chatExploreSummary.textContent = "";
      chatExploreSummary.removeAttribute("title");
      chatExploreColumnsPreview.textContent = "";
      chatExploreColumnsPreview.removeAttribute("title");
      chatExploreStatus.textContent = "";
      chatExploreStatus.hidden = true;
      chatExploreStatus.classList.remove("is-error");
      chatExploreConfirmCopy.textContent = "";
      return;
    }
    if (!state.chatExploreScopes.length && !state.chatExploreScopesPromise && !state.chatExploreScopeError) {
      void ensureAutomationExploreScopes().catch(() => {});
    }
    const selectedScopeKey = syncAutomationExploreScopeSelection();
    const selectedScopeLabel = currentAutomationExploreScopeLabel() || "Select scope";
    const summaryKeys = columns.slice(0, 3).map((key) => `@{${key}}`);
    const remainder = Math.max(0, columns.length - summaryKeys.length);
    chatExploreStrip.hidden = false;
    chatExploreSummary.textContent = `Run Explore over scope ${selectedScopeLabel}`;
    chatExploreSummary.title = `Run Explore over scope ${selectedScopeLabel}`;
    const previewText = !columns.length
      ? "Add one or more Explore columns with @{column_key}."
      : (columns.length === 1
        ? `1 column: ${summaryKeys[0]}`
        : `${columns.length} columns: ${summaryKeys.join(", ")}${remainder ? ` +${remainder} more` : ""}`);
    chatExploreColumnsPreview.textContent = previewText;
    chatExploreColumnsPreview.title = columns.map((key) => `@{${key}}`).join(", ");
    if (state.chatExploreScopes.length) {
      const optionsSignature = state.chatExploreScopes
        .map((entry) => `${String(entry?.collection_key || "").trim()}:${String(entry?.collection_name || entry?.collection_key || "").trim()}`)
        .join("|");
      if (optionsSignature !== state.chatExploreScopeOptionsSignature) {
        chatExploreScopeSelect.replaceChildren(...state.chatExploreScopes.map((entry) =>
          createOption(entry.collection_key, entry.collection_name || entry.collection_key)
        ));
        state.chatExploreScopeOptionsSignature = optionsSignature;
      }
      if (selectedScopeKey && chatExploreScopeSelect.value !== selectedScopeKey) {
        chatExploreScopeSelect.value = selectedScopeKey;
      }
    }
    else {
      const emptyLabel = state.chatExploreScopeLoading ? "Loading scopes..." : (state.chatExploreScopeError ? "Scope unavailable" : "No scopes available");
      if (state.chatExploreScopeOptionsSignature !== `empty:${emptyLabel}`) {
        chatExploreScopeSelect.replaceChildren(createOption("", emptyLabel));
        state.chatExploreScopeOptionsSignature = `empty:${emptyLabel}`;
      }
      if (chatExploreScopeSelect.value) {
        chatExploreScopeSelect.value = "";
      }
    }
    chatExploreScopeSelect.disabled = !!state.chatExploreScopeLoading || !!state.chatExploreScopesPromise || !!state.chatExploreScopeError || !state.chatExploreScopes.length;
    const showStatus = !!state.chatExploreScopeError || !!state.chatExploreScopeLoading || !!state.chatExploreScopesPromise;
    chatExploreStatus.hidden = !showStatus;
    chatExploreStatus.classList.toggle("is-error", !!state.chatExploreScopeError);
    chatExploreStatus.textContent = state.chatExploreScopeError
      ? state.chatExploreScopeError
      : ((state.chatExploreScopeLoading || state.chatExploreScopesPromise)
        ? "Loading the default Explore scope..."
        : "");
    chatExploreConfirm.hidden = !state.chatExploreConfirming;
    chatExploreConfirmCopy.textContent = state.chatExploreScopeError
      ? "Fix the Explore scope before sending."
      : ((state.chatExploreScopeLoading || state.chatExploreScopesPromise)
        ? "Loading scopes..."
        : `This Explore prompt will run on scope “${selectedScopeLabel}”. Continue?`);
    chatExploreContinueBtn.disabled = !!state.chatExploreScopeLoading || !!state.chatExploreScopesPromise || !!state.chatExploreScopeError || !selectedScopeKey;
  }

  function renderChatFindComposer() {
    const message = optionalString(chatInput.value);
    const isFindDraft = automationPromptIsFindDraft(message);
    if (!isFindDraft) {
      state.chatFindScopeError = "";
      chatFindStrip.hidden = true;
      chatFindSummary.textContent = "";
      chatFindSummary.removeAttribute("title");
      chatFindQueryPreview.textContent = "";
      chatFindQueryPreview.removeAttribute("title");
      chatFindStatus.textContent = "";
      chatFindStatus.hidden = true;
      chatFindStatus.classList.remove("is-error");
      return;
    }
    const draft = automationFindDraftInfo(message);
    if (draft.mode && draft.mode !== state.chatFindMode) {
      state.chatFindMode = draft.mode;
    }
    if (!state.chatFindScopes.length && !state.chatFindScopesPromise && !state.chatFindScopeLoading && !state.chatFindScopeError) {
      void ensureAutomationFindScopes().catch(() => {});
    }
    if (!state.chatFindConfig && !state.chatFindConfigPromise && !state.chatFindConfigLoading && !state.chatFindConfigError) {
      void ensureAutomationFindConfig().catch(() => {});
    }
    const selectedScopeKey = syncAutomationFindScopeSelection();
    const selectedScopeLabel = currentAutomationFindScopeLabel() || "Select scope";
    const semantic = currentAutomationFindSemanticState();
    if (state.chatFindMode === "semantic" && !semantic.available) {
      state.chatFindMode = "keyword";
    }
    chatFindStrip.hidden = false;
    chatFindModeKeywordBtn.classList.toggle("active", state.chatFindMode === "keyword");
    chatFindModeSemanticBtn.classList.toggle("active", state.chatFindMode === "semantic");
    chatFindModeKeywordBtn.setAttribute("aria-pressed", state.chatFindMode === "keyword" ? "true" : "false");
    chatFindModeSemanticBtn.setAttribute("aria-pressed", state.chatFindMode === "semantic" ? "true" : "false");
    chatFindModeSemanticBtn.hidden = !semantic.show;
    chatFindModeSemanticBtn.disabled = !!semantic.disabled;
    chatFindModeSemanticBtn.title = semantic.disabled
      ? (semantic.reason || "Run full-text embeddings first to use Semantic Find Arguments.")
      : "";
    chatFindSummary.textContent = `Find Arguments by ${state.chatFindMode === "semantic" ? "semantic" : "keyword"} search in ${selectedScopeLabel}`;
    chatFindSummary.title = chatFindSummary.textContent;
    chatFindQueryPreview.textContent = draft.query
      ? `Query: ${draft.query}`
      : "Type the search query after /find.";
    chatFindQueryPreview.title = chatFindQueryPreview.textContent;
    if (state.chatFindScopes.length) {
      const optionsSignature = state.chatFindScopes
        .map((entry) => `${String(entry?.collection_key || "").trim()}:${String(entry?.collection_name || entry?.collection_key || "").trim()}`)
        .join("|");
      if (optionsSignature !== state.chatFindScopeOptionsSignature) {
        chatFindScopeSelect.replaceChildren(...state.chatFindScopes.map((entry) =>
          createOption(entry.collection_key, entry.collection_name || entry.collection_key)
        ));
        state.chatFindScopeOptionsSignature = optionsSignature;
      }
      if (selectedScopeKey && chatFindScopeSelect.value !== selectedScopeKey) {
        chatFindScopeSelect.value = selectedScopeKey;
      }
    }
    else {
      const emptyLabel = state.chatFindScopeLoading ? "Loading scopes..." : (state.chatFindScopeError ? "Scope unavailable" : "No scopes available");
      if (state.chatFindScopeOptionsSignature !== `empty:${emptyLabel}`) {
        chatFindScopeSelect.replaceChildren(createOption("", emptyLabel));
        state.chatFindScopeOptionsSignature = `empty:${emptyLabel}`;
      }
      if (chatFindScopeSelect.value) {
        chatFindScopeSelect.value = "";
      }
    }
    chatFindScopeSelect.disabled = !!state.chatFindScopeLoading || !!state.chatFindScopesPromise || !!state.chatFindScopeError || !state.chatFindScopes.length;
    const semanticStatus = semantic.error
      || (semantic.loading ? "Checking Semantic Find availability..." : "")
      || (semantic.disabled ? semantic.reason : "");
    const showStatus = !!state.chatFindScopeError || !!state.chatFindScopeLoading || !!state.chatFindScopesPromise || !!semanticStatus;
    chatFindStatus.hidden = !showStatus;
    chatFindStatus.classList.toggle("is-error", !!state.chatFindScopeError || !!semantic.error);
    chatFindStatus.textContent = state.chatFindScopeError
      ? state.chatFindScopeError
      : ((state.chatFindScopeLoading || state.chatFindScopesPromise)
        ? "Loading Find Arguments scopes..."
        : semanticStatus);
  }

  function renderChatAutodriveComposer() {
    const message = optionalString(chatInput.value);
    const isAutodriveDraft = automationPromptIsAutodriveDraft(message);
    if (!isAutodriveDraft) {
      chatAutodriveStrip.hidden = true;
      chatAutodriveSummary.textContent = "";
      chatAutodrivePreview.textContent = "";
      chatAutodriveStatus.textContent = "";
      chatAutodriveStatus.hidden = true;
      chatAutodriveStatus.classList.remove("is-error");
      return;
    }
    if (!state.chatAutodriveDefaults && !state.chatAutodriveDefaultsPromise && !state.chatAutodriveDefaultsLoading && !state.chatAutodriveDefaultsError) {
      void ensureAutomationAutodriveDefaults().catch(() => {});
    }
    const count = normalizeAutomationAutodriveCount(chatAutodriveCountInput.value || state.chatAutodriveCount || 3);
    state.chatAutodriveCount = count;
    if (String(chatAutodriveCountInput.value || "") !== String(count)) {
      chatAutodriveCountInput.value = String(count);
    }
    const reviewerMode = normalizeAutomationAutodriveReviewerMode(state.chatAutodriveReviewerMode);
    state.chatAutodriveReviewerMode = reviewerMode;
    if (chatAutodriveReviewerSelect.value !== reviewerMode) {
      chatAutodriveReviewerSelect.value = reviewerMode;
    }
    chatAutodriveCountButtons.forEach((button) => {
      const active = Number(button.getAttribute("data-automation-autodrive-count") || 0) === count;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const defaults = state.chatAutodriveDefaults || {};
    if (defaults && !state.chatAutodrivePromptTouched && !optionalString(chatAutodrivePrompt.value)) {
      chatAutodrivePrompt.value = String(defaults?.prompt_text || "");
    }
    if (defaults && !state.chatAutodriveReviewerPromptTouched && !optionalString(chatAutodriveReviewerPrompt.value)) {
      chatAutodriveReviewerPrompt.value = String(defaults?.reviewer_prompt_text || "");
    }
    const promptTab = String(state.chatAutodrivePromptTab || "agent").trim() === "reviewer" ? "reviewer" : "agent";
    state.chatAutodrivePromptTab = promptTab;
    [
      [chatAutodriveAgentPromptTab, "agent"],
      [chatAutodriveReviewerPromptTab, "reviewer"],
    ].forEach(([button, value]) => {
      const active = promptTab === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    chatAutodrivePrompt.hidden = promptTab !== "agent";
    chatAutodriveReviewerPrompt.hidden = promptTab !== "reviewer";
    const projectType = String(defaults?.project_type || state.bootstrap?.current_project?.entry?.project_type || "").trim();
    const customAnalysis = projectType === "custom_analysis";
    const promptText = optionalString(chatAutodrivePrompt.value);
    const promptMissing = customAnalysis && !promptText;
    const running = String(state.chatRun?.status || "").trim() === "running";
    chatAutodriveStrip.hidden = false;
    chatAutodriveSummary.textContent = `Auto Drive ${count} turn${count === 1 ? "" : "s"}`;
    chatAutodrivePreview.textContent = `Reviewer checks ${automationAutodriveReviewerModeLabel(reviewerMode)}.`;
    const statusText = state.chatAutodriveDefaultsError
      || (state.chatAutodriveDefaultsLoading || state.chatAutodriveDefaultsPromise ? "Loading Auto Drive prompt..." : "")
      || (promptMissing ? "Custom analysis Auto Drive needs a prompt." : "")
      || (running ? "A session is already running. Stop it before starting Auto Drive." : "");
    chatAutodriveStatus.hidden = !statusText;
    chatAutodriveStatus.classList.toggle("is-error", !!state.chatAutodriveDefaultsError || promptMissing);
    chatAutodriveStatus.textContent = statusText;
    chatAutodriveStartBtn.disabled = !!state.chatAutodriveDefaultsLoading
      || !!state.chatAutodriveDefaultsPromise
      || !!state.chatAutodriveDefaultsError
      || promptMissing
      || running;
    chatAutodriveStopBtn.hidden = true;
    chatAutodriveStopBtn.disabled = true;
  }

  async function submitAutomationChatMessage(message, payload = null) {
    chatInput.value = "";
    state.chatExploreConfirming = false;
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
    closeCommandMenu();
    try {
      if (state.chatRun?.status === "running") {
        await queueChatMessage(message, "queued", payload);
        renderChatBudget();
        setStatus("Message queued. It will run after the current task finishes unless you mark it as steer.", "ready");
        return;
      }
      await beginChatStream(message, payload || {});
    }
	  catch (error) {
	      chatInput.value = message;
	      state.chatExploreConfirming = automationPromptIsExploreDraft(message) || automationPromptHasExplorePlaceholders(message);
	      chatInput.focus();
      chatInput.setSelectionRange(message.length, message.length);
      state.optimisticUserMessage = null;
      clearLiveChatTransientState();
      setChatRun(null);
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      renderChatExploreComposer();
      renderChatFindComposer();
      renderChatAutodriveComposer();
      setStatus(error?.message || String(error), "error");
    }
  }

  async function continueAutomationExplorePrompt() {
    const message = optionalString(chatInput.value);
    const explorePrompt = automationExplorePromptText(message);
    if (!message || !automationPromptHasExplorePlaceholders(message)) {
      state.chatExploreConfirming = false;
      renderChatExploreComposer();
      if (automationPromptIsExploreDraft(message)) {
        setStatus("Add one or more Explore columns with @{column_key}, then submit /explore again.", "error");
      }
      return;
    }
    if (!state.chatExploreScopes.length || state.chatExploreScopesPromise) {
      try {
        await ensureAutomationExploreScopes();
      }
      catch (error) {
        state.chatExploreScopeError = error?.message || String(error);
        renderChatExploreComposer();
        return;
      }
    }
    const scopeKey = currentAutomationExploreScopeKey();
    if (!scopeKey) {
      state.chatExploreScopeError = "Choose an Explore scope before sending.";
      renderChatExploreComposer();
      return;
    }
    await submitAutomationChatMessage(explorePrompt, {
      explore_scope_key: scopeKey,
    });
  }

  async function runAutomationFindPrompt() {
    const message = optionalString(chatInput.value);
    if (!message || !automationPromptIsFindDraft(message)) {
      return;
    }
    const draft = automationFindDraftInfo(message);
    state.chatFindMode = draft.mode || state.chatFindMode || "keyword";
    if (!draft.query) {
      state.chatFindScopeError = "Type a Find Arguments query after /find.";
      renderChatFindComposer();
      setStatus("Type a Find Arguments query after /find.", "error");
      return;
    }
    if (!state.chatFindScopes.length || state.chatFindScopesPromise) {
      try {
        await ensureAutomationFindScopes();
      }
      catch (error) {
        state.chatFindScopeError = error?.message || String(error);
        renderChatFindComposer();
        return;
      }
    }
    try {
      await ensureAutomationFindConfig();
    }
    catch (error) {
      state.chatFindConfigError = error?.message || String(error);
      renderChatFindComposer();
      return;
    }
    const semantic = currentAutomationFindSemanticState();
    if ((draft.explicitMode === "semantic" || state.chatFindMode === "semantic") && !semantic.available) {
      state.chatFindMode = "keyword";
      const reason = semantic.reason || semantic.error || "Semantic Find is unavailable. Keyword search works without full-text embeddings.";
      state.chatFindScopeError = "";
      renderChatFindComposer();
      setStatus(reason, "error");
      return;
    }
    const scopeKey = currentAutomationFindScopeKey();
    if (!scopeKey) {
      state.chatFindScopeError = "Choose a Find Arguments scope before searching.";
      renderChatFindComposer();
      return;
    }
    closeCommandMenu();
    chatInput.disabled = true;
    sendBtn.disabled = true;
    setStatus("Running Find Arguments...", "ready");
    try {
      const result = await ctx.invoke("documents.find", {
        query: draft.query,
        mode: state.chatFindMode,
        collection_key: scopeKey,
        limit: 5,
        chunks_per_document: 2,
        session_id: sessionSelect.value,
      });
      chatInput.value = "";
      state.chatFindScopeError = "";
      renderChatFindComposer();
      await refreshBootstrap();
      const count = Number(result?.returned_documents || 0) || 0;
      setStatus(`Find Arguments returned ${count} document${count === 1 ? "" : "s"}.`, "ready");
    }
    catch (error) {
      setStatus(error?.message || String(error), "error");
      renderChatFindComposer();
    }
    finally {
      chatInput.disabled = false;
      sendBtn.disabled = false;
      chatInput.focus();
      renderChatBudget();
    }
  }

  async function startAutomationAutodrivePrompt() {
    const message = optionalString(chatInput.value);
    if (!message || !automationPromptIsAutodriveDraft(message)) {
      return;
    }
    try {
      await ensureAutomationAutodriveDefaults();
    }
    catch (error) {
      state.chatAutodriveDefaultsError = error?.message || String(error);
      renderChatAutodriveComposer();
      setStatus(error?.message || String(error), "error");
      return;
    }
    const count = normalizeAutomationAutodriveCount(chatAutodriveCountInput.value || state.chatAutodriveCount || 3);
    const reviewerMode = normalizeAutomationAutodriveReviewerMode(state.chatAutodriveReviewerMode);
    const prompt = optionalString(chatAutodrivePrompt.value);
    const reviewerPrompt = optionalString(chatAutodriveReviewerPrompt.value);
    const projectType = String(state.chatAutodriveDefaults?.project_type || state.bootstrap?.current_project?.entry?.project_type || "").trim();
    if (projectType === "custom_analysis" && !prompt) {
      state.chatAutodriveDefaultsError = "";
      renderChatAutodriveComposer();
      setStatus("Custom analysis Auto Drive needs a prompt.", "error");
      return;
    }
    closeCommandMenu();
    setStatus("Starting Auto Drive...", "ready");
    try {
      await prepareDocumentForChatRun();
      chatInput.value = "";
      state.chatAutodrivePromptTouched = false;
      state.chatAutodriveReviewerPromptTouched = false;
      renderChatAutodriveComposer();
      const result = await ctx.invoke("automation.autodrive.begin", {
        session_id: sessionSelect.value,
        count,
        reviewer_mode: reviewerMode,
        prompt,
        reviewer_prompt: reviewerPrompt,
      });
      applyChatSnapshot(result || {});
      if (result?.run) {
        setChatRun(result.run);
        setStatus("Auto Drive running...", "ready");
        pollChatRun(result.run.run_id).catch((error) => setStatus(error?.message || String(error), "error"));
      }
    }
    catch (error) {
      chatInput.value = "/Autodrive";
      state.chatAutodrivePromptTouched = true;
      state.chatAutodriveReviewerPromptTouched = true;
      renderChatAutodriveComposer();
      setStatus(error?.message || String(error), "error");
    }
  }

  function nextFrame(callback) {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(callback);
      return;
    }
    window.setTimeout(callback, 0);
  }

  function waitForNextFrame() {
    return new Promise((resolve) => {
      nextFrame(resolve);
    });
  }

  async function flushChatStreamFrame(force = false) {
    const now = Date.now();
    const lastYield = Number(state.chatLastPaintYieldMs || 0) || 0;
    if (!force && now - lastYield < 33) {
      return;
    }
    await waitForNextFrame();
    state.chatLastPaintYieldMs = Date.now();
  }

  function withProgrammaticPreviewScroll(callback) {
    state.previewProgrammaticScroll = true;
    try {
      callback?.();
    }
    finally {
      nextFrame(() => {
        state.previewProgrammaticScroll = false;
      });
    }
  }

  function withProgrammaticNativeScroll(callback) {
    state.nativeProgrammaticScroll = true;
    try {
      callback?.();
    }
    finally {
      nextFrame(() => {
        state.nativeProgrammaticScroll = false;
      });
    }
  }

  function previewScrollNode() {
    if (!preview) {
      return null;
    }
    return preview.querySelector(".sr-doc-host") || preview;
  }

  function nativeScrollNode() {
    if (!nativeEditor) {
      return null;
    }
    return nativeEditor.querySelector(".sr-doc-host") || nativeEditor;
  }

  function withProgrammaticChatScroll(callback) {
    state.chatProgrammaticScroll = true;
    try {
      callback?.();
    }
    finally {
      nextFrame(() => {
        state.chatProgrammaticScroll = false;
        state.chatLastScrollTop = Number(chatMessages.scrollTop || 0) || 0;
      });
    }
  }

  function capturePreviewScrollState() {
    if (!preview || preview.hidden) {
      return null;
    }
    let scrollNode = previewScrollNode();
    if (!scrollNode) {
      return null;
    }
    let pageSheets = Array.from(preview.querySelectorAll(".sr-page-sheet[data-sr-page-index]"));
    if (!pageSheets.length) {
      return {
        scrollTop: Number(scrollNode.scrollTop || 0) || 0,
        pageIndex: 0,
        relativeOffset: 0,
      };
    }
    let containerRect = scrollNode.getBoundingClientRect();
    let chosen = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let sheet of pageSheets) {
      let rect = sheet.getBoundingClientRect();
      let visible = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;
      let distance = Math.abs(rect.top - containerRect.top);
      if (!visible && chosen) {
        continue;
      }
      if (distance < bestDistance || !chosen) {
        chosen = sheet;
        bestDistance = distance;
      }
    }
    let target = chosen || pageSheets[0];
    return {
      scrollTop: Number(scrollNode.scrollTop || 0) || 0,
      pageIndex: Number(target?.getAttribute?.("data-sr-page-index") || 0) || 0,
      relativeOffset: Math.max(0, (Number(scrollNode.scrollTop || 0) || 0) - (Number(target?.offsetTop || 0) || 0)),
    };
  }

  function restorePreviewScrollState(snapshot = null) {
    if (!snapshot || !preview || preview.hidden) {
      return;
    }
    let scrollNode = previewScrollNode();
    if (!scrollNode) {
      return;
    }
    let maxScrollTop = Math.max(0, (Number(scrollNode.scrollHeight || 0) || 0) - (Number(scrollNode.clientHeight || 0) || 0));
    let targetScrollTop = Math.max(0, Number(snapshot.scrollTop || 0) || 0);
    let pageIndex = Number(snapshot.pageIndex || 0) || 0;
    if (pageIndex > 0) {
      let pageSheets = Array.from(preview.querySelectorAll(".sr-page-sheet[data-sr-page-index]"));
      let target = pageSheets.find((sheet) => Number(sheet?.getAttribute?.("data-sr-page-index") || 0) === pageIndex) || null;
      if (!target && pageSheets.length) {
        target = pageSheets.reduce((best, sheet) => {
          if (!best) {
            return sheet;
          }
          let bestIndex = Number(best.getAttribute("data-sr-page-index") || 0) || 0;
          let sheetIndex = Number(sheet.getAttribute("data-sr-page-index") || 0) || 0;
          return Math.abs(sheetIndex - pageIndex) < Math.abs(bestIndex - pageIndex) ? sheet : best;
        }, null);
      }
      if (target) {
        targetScrollTop = (Number(target.offsetTop || 0) || 0) + Math.max(0, Number(snapshot.relativeOffset || 0) || 0);
      }
    }
    withProgrammaticPreviewScroll(() => {
      scrollNode.scrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
    });
  }

  function restorePreviewScrollStateAfterLayout(snapshot = null) {
    if (!snapshot) {
      return;
    }
    restorePreviewScrollState(snapshot);
    nextFrame(() => {
      restorePreviewScrollState(snapshot);
      window.setTimeout(() => restorePreviewScrollState(snapshot), 0);
    });
  }

  function captureNativeScrollState() {
    if (!nativeEditor || nativeEditor.hidden) {
      return null;
    }
    let scrollNode = nativeScrollNode();
    if (!scrollNode) {
      return null;
    }
    let pageSheets = Array.from(nativeEditor.querySelectorAll(".sr-page-sheet[data-sr-page-index], .sr-editor-section[data-sr-page-index]"));
    if (!pageSheets.length) {
      return {
        scrollTop: Number(scrollNode.scrollTop || 0) || 0,
        pageIndex: 0,
        relativeOffset: 0,
      };
    }
    let containerRect = scrollNode.getBoundingClientRect();
    let chosen = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let sheet of pageSheets) {
      let rect = sheet.getBoundingClientRect();
      let visible = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;
      let distance = Math.abs(rect.top - containerRect.top);
      if (!visible && chosen) {
        continue;
      }
      if (distance < bestDistance || !chosen) {
        chosen = sheet;
        bestDistance = distance;
      }
    }
    let target = chosen || pageSheets[0];
    return {
      scrollTop: Number(scrollNode.scrollTop || 0) || 0,
      pageIndex: Number(target?.getAttribute?.("data-sr-page-index") || 0) || 0,
      relativeOffset: Math.max(0, (Number(scrollNode.scrollTop || 0) || 0) - (Number(target?.offsetTop || 0) || 0)),
    };
  }

  function restoreNativeScrollState(snapshot = null) {
    if (!snapshot || !nativeEditor || nativeEditor.hidden) {
      return;
    }
    let scrollNode = nativeScrollNode();
    if (!scrollNode) {
      return;
    }
    let maxScrollTop = Math.max(0, (Number(scrollNode.scrollHeight || 0) || 0) - (Number(scrollNode.clientHeight || 0) || 0));
    let targetScrollTop = Math.max(0, Number(snapshot.scrollTop || 0) || 0);
    let pageIndex = Number(snapshot.pageIndex || 0) || 0;
    if (pageIndex > 0) {
      let pageSheets = Array.from(nativeEditor.querySelectorAll(".sr-page-sheet[data-sr-page-index], .sr-editor-section[data-sr-page-index]"));
      let target = pageSheets.find((sheet) => Number(sheet?.getAttribute?.("data-sr-page-index") || 0) === pageIndex) || null;
      if (!target && pageSheets.length) {
        target = pageSheets.reduce((best, sheet) => {
          if (!best) {
            return sheet;
          }
          let bestIndex = Number(best.getAttribute("data-sr-page-index") || 0) || 0;
          let sheetIndex = Number(sheet.getAttribute("data-sr-page-index") || 0) || 0;
          return Math.abs(sheetIndex - pageIndex) < Math.abs(bestIndex - pageIndex) ? sheet : best;
        }, null);
      }
      if (target) {
        targetScrollTop = (Number(target.offsetTop || 0) || 0) + Math.max(0, Number(snapshot.relativeOffset || 0) || 0);
      }
    }
    withProgrammaticNativeScroll(() => {
      scrollNode.scrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
    });
  }

  function isChatNearBottom(threshold = 24) {
    let remaining = (Number(chatMessages.scrollHeight || 0) || 0)
      - ((Number(chatMessages.scrollTop || 0) || 0) + (Number(chatMessages.clientHeight || 0) || 0));
    return remaining <= threshold;
  }

  function restoreChatScrollTop(scrollTop = 0) {
    let maxScrollTop = Math.max(0, (Number(chatMessages.scrollHeight || 0) || 0) - (Number(chatMessages.clientHeight || 0) || 0));
    withProgrammaticChatScroll(() => {
      chatMessages.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(scrollTop || 0) || 0));
    });
  }

  function scrollChatToBottom() {
    withProgrammaticChatScroll(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function clearPreviewRefreshTimer() {
    if (state.previewRefreshTimer) {
      window.clearTimeout(state.previewRefreshTimer);
      state.previewRefreshTimer = 0;
    }
  }

  function clearNativeBlurReflowTimer() {
    if (state.nativeBlurReflowTimer) {
      window.clearTimeout(state.nativeBlurReflowTimer);
      state.nativeBlurReflowTimer = 0;
    }
  }

	  function clearLiveChatTransientState() {
	    state.liveAssistantMessage = null;
	    state.liveProgressRows = [];
	    state.chatLastPaintYieldMs = 0;
    for (const key of Array.from(state.chatDetailState.keys())) {
      if (String(key || "").startsWith("live:")) {
        state.chatDetailState.delete(key);
	    }
	  }

	  function clearPromptPreviewRows() {
	    state.promptPreviewRows = [];
	    for (const key of Array.from(state.chatDetailState.keys())) {
	      if (String(key || "").startsWith("prompt-preview:")) {
	        state.chatDetailState.delete(key);
	      }
	    }
	  }
  }

  function upsertLiveProgressRow(key, entry = {}) {
    const liveKey = String(key || "").trim();
    if (!liveKey) {
      return;
    }
    const nextEntry = {
      ...entry,
      synthetic: true,
      _live_key: liveKey,
    };
    const rows = Array.isArray(state.liveProgressRows) ? state.liveProgressRows.slice() : [];
    const index = rows.findIndex((row) => String(row?._live_key || "") === liveKey);
    if (index >= 0) {
      rows[index] = {
        ...rows[index],
        ...nextEntry,
      };
    }
    else {
      rows.push(nextEntry);
    }
    state.liveProgressRows = rows;
  }

  function removeLiveProgressRows(predicate) {
    if (typeof predicate != "function") {
      return;
    }
    const rows = Array.isArray(state.liveProgressRows) ? state.liveProgressRows : [];
    state.liveProgressRows = rows.filter((row) => !predicate(row));
  }

  function removeLiveProgressRow(key = "") {
    const liveKey = String(key || "").trim();
    if (!liveKey) {
      return;
    }
    removeLiveProgressRows((row) => String(row?._live_key || "") === liveKey);
  }

	  function removeLiveToolProgress(callID = "") {
	    const target = String(callID || "").trim();
	    if (!target) {
	      return;
	    }
	    removeLiveProgressRows((row) => String(row?.payload?.call_id || "") === target);
	  }

	  function upsertPromptPreviewRow(event = {}) {
	    const step = Math.max(1, Number(event?.step || 0) || 1);
	    const liveKey = `prompt-preview:${step}`;
	    const budget = event?.chat_budget && typeof event.chat_budget === "object" ? event.chat_budget : {};
	    const row = {
	      role: "system",
	      event_type: "model_input_preview",
	      title: `Model Input Step ${step}`,
	      content: "Exact model input prepared for this step.",
	      synthetic: true,
	      _live_key: liveKey,
	      payload: {
	        step,
	        stateful: !!event?.stateful,
	        model: String(event?.model || "").trim(),
	        previous_response_id: String(event?.previous_response_id || "").trim(),
	        input_text: String(event?.input_text || ""),
	        instructions_text: String(event?.instructions_text || ""),
	        head_text: String(event?.head_text || ""),
	        active_memory_text: String(event?.active_memory_text || ""),
	        tool_schema_text: String(event?.tool_schema_text || ""),
	        prompt_text: String(event?.prompt_text || ""),
	        chat_budget: budget,
	      },
	    };
	    const rows = Array.isArray(state.promptPreviewRows) ? state.promptPreviewRows.slice() : [];
	    const index = rows.findIndex((entry) => String(entry?._live_key || "") === liveKey);
	    if (index >= 0) {
	      rows[index] = row;
	    }
	    else {
	      rows.push(row);
	    }
	    state.promptPreviewRows = rows;
	  }

  function applySidebarWidth(widthPx) {
    const shellWidth = Math.max(0, Math.round(shell.getBoundingClientRect().width || 0));
    const hostStyles = window.getComputedStyle(host);
    const shellStyles = window.getComputedStyle(shell);
    const minWidth = Math.max(180, Number.parseFloat(hostStyles.getPropertyValue("--sr-sidebar-min-width")) || 240);
    const splitterSize = Math.max(0, Number.parseFloat(hostStyles.getPropertyValue("--sr-splitter-size")) || 10);
    const gapSize = Math.max(0, Number.parseFloat(shellStyles.columnGap || shellStyles.gap || "0") || 0);
    const reservedMainWidth = 220;
    const shellChromeWidth = splitterSize + (gapSize * Math.max(0, shell.children.length - 1));
    const maxWidth = shellWidth > 0
      ? Math.max(minWidth, shellWidth - reservedMainWidth - shellChromeWidth)
      : 620;
    const nextWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(Number(widthPx || state.sidebarWidthPx || 360))));
    state.sidebarWidthPx = nextWidth;
    host.style.setProperty("--sr-sidebar-width", `${nextWidth}px`);
    if (state.findPanel?.applyPosition && state.findPanelPosition) {
      state.findPanel.applyPosition(state.findPanelPosition.left, state.findPanelPosition.top);
    }
    scheduleFindPanelRefresh({
      preserveIndex: true,
      delay: 0,
      renderOnly: true,
    });
  }

  function updateToolbarVisibility() {
    return;
  }

  function updateSessionSelectTitle() {
    const selected = sessionSelect.selectedOptions?.[0] || null;
    sessionSelect.title = String(selected?.textContent || "").trim();
  }

  function updateEditorSelectTitles() {
    fontSelect.title = String(fontSelect.selectedOptions?.[0]?.textContent || "").trim();
    citationStyleSelect.title = String(citationStyleSelect.selectedOptions?.[0]?.textContent || "").trim();
  }

  function clearChatPollTimer() {
    if (state.chatPollTimer) {
      window.clearTimeout(state.chatPollTimer);
      state.chatPollTimer = 0;
    }
  }

  function clearChatClockTimer() {
    if (state.chatClockTimer) {
      window.clearInterval(state.chatClockTimer);
      state.chatClockTimer = 0;
    }
  }

  function updateChatRunStatus() {
    const run = state.chatRun;
    if (!run) {
      chatRunStatus.textContent = "";
      return;
    }
    const label = run.status === "running"
      ? `Working... ${formatElapsedTime(run.elapsedMs || 0)}`
      : run.status === "error"
        ? `Run failed after ${formatElapsedTime(run.elapsedMs || 0)}`
        : `Time spent on task: ${formatElapsedTime(run.elapsedMs || 0)}`;
    chatRunStatus.textContent = label;
  }

  function startChatClock() {
    clearChatClockTimer();
    if (!state.chatRun || state.chatRun.status !== "running") {
      updateChatRunStatus();
      return;
    }
    updateChatRunStatus();
    state.chatClockTimer = window.setInterval(() => {
      if (!state.chatRun || state.chatRun.status !== "running") {
        clearChatClockTimer();
        updateChatRunStatus();
        return;
      }
      state.chatRun.elapsedMs = Date.now() - state.chatRun.startedAtMs;
      updateChatRunStatus();
      renderChat(Array.isArray(state.renderState?.chat_history) ? state.renderState.chat_history : (state.bootstrap?.chat_history || []));
    }, 1000);
  }

	  function currentProject() {
	    return state.bootstrap?.current_project || null;
	  }

	  function previewEditorPageTheme() {
	    const appTheme = String(ctx.bootstrap?.theme || state.bootstrap?.theme || "").trim().toLowerCase();
	    if (appTheme !== "dark") {
	      return "light";
	    }
	    return String(state.bootstrap?.preview_page_theme || ctx.bootstrap?.preview_page_theme || "light").trim().toLowerCase() === "dark"
	      ? "dark"
	      : "light";
	  }

  function setZoomSliderPercent(percent) {
    if (!pageViewScaleSlider?.style) {
      return;
    }
    const clamped = Math.max(70, Math.min(150, Number(percent || 100)));
    const normalized = ((clamped - 70) / 80) * 100;
    pageViewScaleSlider.style.setProperty("--sr-range-percent", `${normalized}%`);
  }

  function automationEditorSettingsPayload(settings = {}, overrides = null) {
    const payload = Object.assign({}, settings || {});
    delete payload.citationStylePreset;
    delete payload.citationStylePresetLabel;
    delete payload.citationStyleLayoutLabel;
    payload.headingScale = null;
    payload.headingScales = null;
    payload.headingStyles = null;
    return Object.assign(payload, overrides || {});
  }

  function updateDocumentStyles() {
    styleNode.textContent = [
	      SystematicReviewerNativeMarkdown.createDocumentCSS({
	        settings: state.editorSettings,
	        theme: previewEditorPageTheme(),
	        printMode: false,
	      }),
      ".sr-page-sheet-body * { color: inherit; }",
      ".sr-page-editor-body .sr-block-editable, .sr-page-editor-body .sr-native-table-cell { min-height: 1.3em; outline: none; }",
    ].join("\n");
    host.style.setProperty("--sr-font-family", state.editorSettings.fontFamily || "Georgia");
    host.style.setProperty("--sr-font-size", `${Number(state.editorSettings.fontSizePx || 12)}px`);
    host.style.setProperty("--sr-line-height", String(Number(state.editorSettings.lineHeight || 1.6)));
    host.style.setProperty("--sr-page-view-scale", String(Number(state.editorSettings.pageViewScale || 1)));
    host.style.setProperty("--sr-page-gap", `${Math.max(16, Math.round(22 * Number(state.editorSettings.pageViewScale || 1)))}px`);
    host.style.setProperty("--sr-paragraph-align", state.editorSettings.paragraphAlign || "left");
    host.style.setProperty("--sr-paragraph-indent", `${Number(state.editorSettings.paragraphIndentInches || 0)}in`);
    for (let level = 1; level <= 6; level += 1) {
      host.style.setProperty(`--sr-heading-${level}-scale`, String(Number(state.editorSettings.headingScales?.[level] || 1)));
    }
    setZoomSliderPercent(Math.round(Number(state.editorSettings.pageViewScale || 1) * 100));
    scheduleSurfaceReflow("preview");
    scheduleSurfaceReflow("native");
  }

  function populateEditorControls(meta = {}) {
    const fonts = Array.isArray(meta.font_families) ? meta.font_families : [];
    const citationStyles = Array.isArray(meta.citation_styles) ? meta.citation_styles : [];
    const margins = Array.isArray(meta.margins) ? meta.margins : [0.5, 0.75, 1, 1.25, 1.5];
    if (!fontSelect.childElementCount) {
      fonts.forEach((font) => fontSelect.appendChild(createOption(font, font)));
    }
    if (!fontSizeSelect.childElementCount) {
      [10, 11, 12, 13, 14, 16, 18].forEach((size) => fontSizeSelect.appendChild(createOption(String(size), `${size}px`)));
    }
    if (!citationStyleSelect.childElementCount) {
      citationStyles.forEach((entry) => citationStyleSelect.appendChild(createOption(entry.style_id, entry.label)));
      if (!citationStyleSelect.childElementCount) {
        citationStyleSelect.appendChild(createOption("http://www.zotero.org/styles/apa", "APA"));
      }
    }
    if (!marginSelect.childElementCount) {
      margins.forEach((margin) => marginSelect.appendChild(createOption(String(margin), `${margin}" margins`)));
    }
    fontSelect.value = state.editorSettings.fontFamily || fontSelect.value || "Georgia";
    fontSizeSelect.value = String(state.editorSettings.fontSizePx || 12);
    citationStyleSelect.value = state.editorSettings.citationStyleID || citationStyleSelect.value || "http://www.zotero.org/styles/apa";
    marginSelect.value = String(state.editorSettings.printMarginInches || 1);
    pageNumbersSelect.value = state.editorSettings.printPageNumbers ? "true" : "false";
    bulletStyleSelect.value = state.editorSettings.bulletStyle || bulletStyleSelect.value || "disc";
    pageViewScaleRange.value = String(Math.round(Number(state.editorSettings.pageViewScale || 1) * 100));
    pageViewScaleValue.textContent = `${pageViewScaleRange.value}%`;
    setZoomSliderPercent(pageViewScaleRange.value);
    stylePresetNote.textContent = "";
    stylePresetNote.hidden = !stylePresetNote.textContent.trim();
    updateEditorSelectTitles();
  }

  function populateSessionControls(sessions = [], activeSessionID = "") {
    sessionSelect.replaceChildren();
    if (!Array.isArray(sessions) || !sessions.length) {
      sessionSelect.appendChild(createOption("default", "Session"));
      sessionSelect.value = "default";
      updateSessionSelectTitle();
      return;
    }
    for (const session of sessions) {
      sessionSelect.appendChild(createOption(session.session_id, sessionTitleLabel(session)));
    }
    sessionSelect.value = activeSessionID || sessions[0].session_id;
    updateSessionSelectTitle();
  }

  function chatPresetCatalog() {
    return Array.isArray(state.bootstrap?.runtime_options?.chat_presets)
      ? state.bootstrap.runtime_options.chat_presets
      : [];
  }

  function selectedChatPreset() {
    const options = chatPresetCatalog();
    const runtimeState = chatRuntimeState();
    const selectedPresetID = String(runtimeState?.chat_preset_id || "default").trim() || "default";
    return options.find((entry) => String(entry?.preset_id || "") === selectedPresetID) || options[0] || null;
  }

  function chatRuntimeState() {
    return state.bootstrap?.current_project?.session_runtime_state
      || state.bootstrap?.runtime_state
      || {};
  }

  function normalizeReasoningEffortToken(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized && normalized !== "default" ? normalized : "";
  }

  function reasoningHintText() {
    return "Default sends no reasoning field at all. Built-in options send an explicit reasoning effort token. Different models and providers support different values or none at all. If you are unsure, leave this on Default.";
  }

  function reasoningSelectValue(value = "") {
    const normalized = normalizeReasoningEffortToken(value);
    return !normalized || ["none", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)
      ? normalized
      : "__custom__";
  }

  function chatReasoningOverrideEffort() {
    return normalizeReasoningEffortToken(chatRuntimeState()?.chat_reasoning_effort || "");
  }

  function selectedChatReasoningEffort() {
    return chatReasoningOverrideEffort()
      || normalizeReasoningEffortToken(selectedChatPreset()?.reasoning_effort || "");
  }

  function isOpenCodePreset(preset = null) {
    return String(preset?.runtime_type || preset?.runtimeType || "").trim() === "local_exec"
      && String(preset?.executor_id || preset?.executorID || "").trim() === "opencode";
  }

  function openCodeModelOptions(preset = null) {
    return Array.isArray(preset?.model_options) ? preset.model_options : [];
  }

  function selectedOpenCodeModelID(preset = null) {
    const runtimeState = chatRuntimeState();
    return String(runtimeState?.chat_model_override || preset?.model || "").trim();
  }

  function selectedOpenCodeModel(preset = null) {
    const modelID = selectedOpenCodeModelID(preset);
    if (!modelID) {
      return null;
    }
    return openCodeModelOptions(preset)
      .find((entry) => String(entry?.id || "").trim() === modelID) || null;
  }

  function openCodeReasoningOptions(model = null) {
    return Array.isArray(model?.reasoning_options)
      ? model.reasoning_options.map((entry) => normalizeReasoningEffortToken(entry)).filter(Boolean)
      : [];
  }

  function openCodeReasoningHintText() {
    return "OpenCode reasoning choices are model-specific variants reported by OpenCode. If the selected model advertises no variants, no variant is sent.";
  }

  function pendingMessages() {
    if (Array.isArray(state.bootstrap?.pending_messages)) {
      return state.bootstrap.pending_messages.slice();
    }
    if (Array.isArray(state.bootstrap?.current_project?.pending_messages)) {
      return state.bootstrap.current_project.pending_messages.slice();
    }
    return [];
  }

  function updatePendingMessagesState(entries = []) {
    const nextEntries = Array.isArray(entries) ? entries.slice() : [];
    const nextSteer = nextEntries.filter((entry) => String(entry?.mode || "").trim() === "steer");
    const nextQueued = nextEntries.filter((entry) => String(entry?.mode || "").trim() !== "steer");
    const patchBudget = (budget) => {
      if (!budget || typeof budget !== "object") {
        return budget || null;
      }
      return {
        ...budget,
        pending_message_count: nextEntries.length,
        pending_message_tokens: pendingMessageTokens(nextEntries),
        pending_steer_count: nextSteer.length,
        pending_steer_tokens: pendingMessageTokens(nextSteer),
        pending_queued_count: nextQueued.length,
        pending_queued_tokens: pendingMessageTokens(nextQueued),
      };
    };
    state.bootstrap = {
      ...(state.bootstrap || {}),
      pending_messages: nextEntries,
      chat_budget: patchBudget(state.bootstrap?.chat_budget),
    };
    if (state.bootstrap?.current_project) {
      state.bootstrap.current_project.pending_messages = nextEntries;
      state.bootstrap.current_project.chat_budget = patchBudget(state.bootstrap.current_project.chat_budget);
    }
  }

  function removePendingMessageState(queueID = "") {
    const targetID = String(queueID || "").trim();
    if (!targetID) {
      return false;
    }
    const currentEntries = pendingMessages();
    const nextEntries = currentEntries.filter((entry) => String(entry?.queue_id || "").trim() !== targetID);
    if (nextEntries.length === currentEntries.length) {
      return false;
    }
    updatePendingMessagesState(nextEntries);
    renderChatQueue();
    renderChatBudget();
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
    return true;
  }

  function updateChatModelControls() {
    const options = chatPresetCatalog();
    chatModelSelect.replaceChildren();
    if (!options.length) {
      chatModelSelect.appendChild(createOption("", "No chat models configured"));
      chatModelSelect.disabled = true;
      chatModelNote.textContent = "Configure Agent Model in Settings first.";
      chatModelBtn.disabled = true;
      chatModelBtn.textContent = "Model";
      chatModelBtn.title = "No chat models configured";
      chatReasoningSelect.hidden = true;
      chatReasoningSelect.disabled = true;
      chatReasoningSelect.value = "";
      chatOpenCodeModelSelect.hidden = true;
      chatOpenCodeModelSelect.disabled = true;
      chatOpenCodeModelSelect.replaceChildren(createOption("", "Default set in OpenCode"));
      chatReasoningCustomInput.hidden = true;
      chatReasoningCustomInput.disabled = true;
      chatReasoningCustomInput.value = "";
      syncChatModelPopoverFields();
      return;
    }
    const runtimeState = chatRuntimeState();
    const selectedPresetID = String(runtimeState?.chat_preset_id || "default").trim() || "default";
    for (const option of options) {
      chatModelSelect.appendChild(createOption(option.preset_id, option.label || option.short_label || option.preset_id));
    }
    chatModelSelect.value = selectedPresetID;
    const runLocked = state.chatRun?.status === "running";
    chatModelSelect.disabled = runLocked;
    chatModelBtn.disabled = runLocked;
    const selected = options.find((entry) => String(entry?.preset_id || "") === selectedPresetID) || options[0] || null;
    const notes = [];
    if (String(selected?.state_mode || "").trim() === "stateful") {
      notes.push("Stateful mode keeps server-side conversation state. Switching away from it resets that chain, and switching between stateful and other models is not supported.");
    }
    notes.push("Switching from a larger-context model to a smaller-context model increases error rates.");
    chatModelNote.textContent = notes.join(" ");
    chatModelBtn.textContent = "Model";
    chatModelBtn.title = selected?.label || selected?.model_label || selected?.short_label || selected?.preset_id || "Change chat model";
    const runtimeType = String(selected?.runtime_type || selected?.runtimeType || "").trim();
    const selectedIsOpenCode = isOpenCodePreset(selected);
    chatOpenCodeModelSelect.replaceChildren();
    chatOpenCodeModelSelect.appendChild(createOption("", "Default set in OpenCode"));
    if (selectedIsOpenCode) {
      for (const model of openCodeModelOptions(selected)) {
        const suffix = [];
        if (Number(model?.safe_context_window || 0) > 0) {
          suffix.push(`${Number(model.safe_context_window).toLocaleString()} context budget`);
        }
        const variants = openCodeReasoningOptions(model);
        if (variants.length) {
          suffix.push(`variants ${variants.join("/")}`);
        }
        chatOpenCodeModelSelect.appendChild(createOption(
          model.id,
          suffix.length ? `${model.id} - ${suffix.join(", ")}` : model.id,
        ));
      }
    }
    chatOpenCodeModelSelect.hidden = !selectedIsOpenCode;
    chatOpenCodeModelSelect.disabled = !selectedIsOpenCode || runLocked;
    chatOpenCodeModelSelect.value = selectedIsOpenCode ? selectedOpenCodeModelID(selected) : "";
    if (selectedIsOpenCode && chatOpenCodeModelSelect.value !== selectedOpenCodeModelID(selected)) {
      chatOpenCodeModelSelect.value = "";
    }
    const selectedOCModel = selectedIsOpenCode ? selectedOpenCodeModel(selected) : null;
    const openCodeVariants = selectedIsOpenCode ? openCodeReasoningOptions(selectedOCModel) : [];
    if (selectedIsOpenCode) {
      chatReasoningSelect.replaceChildren(createOption("", "Default"));
      for (const variant of openCodeVariants) {
        chatReasoningSelect.appendChild(createOption(variant, variant.slice(0, 1).toUpperCase() + variant.slice(1)));
      }
    }
    else {
      chatReasoningSelect.replaceChildren(
        createOption("", "Default"),
        createOption("none", "None"),
        createOption("minimal", "Minimal"),
        createOption("low", "Low"),
        createOption("medium", "Medium"),
        createOption("high", "High"),
        createOption("xhigh", "XHigh"),
        createOption("__custom__", "Custom..."),
      );
    }
    const supportsReasoning = selectedIsOpenCode
      ? openCodeVariants.length > 0
      : (!!selected?.supports_reasoning && ["local_api", "external_api"].includes(runtimeType));
    const effectiveReasoning = supportsReasoning ? selectedChatReasoningEffort() : "";
    const selectValue = selectedIsOpenCode
      ? (openCodeVariants.includes(effectiveReasoning) ? effectiveReasoning : "")
      : reasoningSelectValue(effectiveReasoning);
    chatReasoningSelect.hidden = !supportsReasoning;
    chatReasoningSelect.disabled = !supportsReasoning || runLocked;
    chatReasoningSelect.value = supportsReasoning ? selectValue : "";
    chatReasoningSelect.title = chatReasoningSelect.value
      ? String(chatReasoningSelect.selectedOptions?.[0]?.textContent || "").trim()
      : "Default";
    chatReasoningCustomInput.hidden = selectedIsOpenCode || !supportsReasoning || selectValue !== "__custom__";
    chatReasoningCustomInput.disabled = selectedIsOpenCode || !supportsReasoning || runLocked || selectValue !== "__custom__";
    chatReasoningCustomInput.value = !selectedIsOpenCode && selectValue === "__custom__" ? effectiveReasoning : "";
    syncChatModelPopoverFields();
  }

function estimateTextTokens(value = "") {
	    const text = String(value || "").replace(/\s+/g, " ").trim();
	    if (!text) {
	      return 0;
	    }
	    const words = text.split(/\s+/).filter(Boolean).length;
	    const lines = text.split(/\r?\n/).length;
	    return Math.max(1, Math.round((text.length / 4) + (words * 0.12) + (lines * 0.35)));
	  }

	  function formatCompactTokens(value) {
	    const number = Math.max(0, Number(value || 0) || 0);
	    if (number >= 1000000) {
	      return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}m`;
	    }
	    if (number >= 1000) {
	      return `${Math.round(number / 1000)}k`;
	    }
	    return String(number);
	  }

  function applyChatBudget(nextBudget = null) {
    if (!nextBudget || typeof nextBudget != "object") {
      return;
    }
    const hydrated = hydrateChatBudget(nextBudget);
    state.bootstrap = {
      ...(state.bootstrap || {}),
      chat_budget: hydrated,
    };
    if (state.bootstrap?.current_project) {
      state.bootstrap.current_project.chat_budget = hydrated;
    }
    renderChatBudget();
  }

  function currentPromptProjection() {
    return state.bootstrap?.prompt_projection
      || state.bootstrap?.current_project?.prompt_projection
      || null;
  }

  function hydrateChatBudget(budget = null) {
    if (!budget || typeof budget !== "object") {
      return budget || null;
    }
    const projection = currentPromptProjection();
    if (!projection || typeof projection !== "object") {
      return budget;
    }
    return {
      ...budget,
      head_text: budget.head_text !== undefined ? budget.head_text : String(projection.head_text || ""),
      active_memory_text: budget.active_memory_text !== undefined ? budget.active_memory_text : String(projection.active_memory_text || ""),
      tool_schema_text: budget.tool_schema_text !== undefined ? budget.tool_schema_text : String(projection.tool_schema_text || ""),
      prompt_text: budget.prompt_text !== undefined ? budget.prompt_text : String(projection.prompt_text || ""),
      head_tokens: Number(budget.head_tokens || projection.head_tokens || 0) || 0,
      active_memory_tokens: Number(budget.active_memory_tokens || projection.active_memory_tokens || 0) || 0,
      tool_schema_tokens: Number(budget.tool_schema_tokens || projection.tool_schema_tokens || 0) || 0,
      truncation_notice_tokens: Number(budget.truncation_notice_tokens || projection.truncation_notice_tokens || 0) || 0,
      raw_history_tokens: Number(budget.raw_history_tokens || projection.raw_history_tokens || 0) || 0,
    };
  }

  function currentChatBudget() {
    const budget = state.bootstrap?.chat_budget
      || state.bootstrap?.current_project?.chat_budget
      || null;
    if (!budget || budget.synthetic) {
      return null;
    }
    return hydrateChatBudget(budget);
  }

  function pendingMessageTokens(entries = []) {
    const items = Array.isArray(entries) ? entries : [];
    return items.reduce((sum, entry) => {
      return sum + estimateTextTokens(`USER [${String(entry?.mode || "queued")}]\n${String(entry?.content || "")}`);
    }, 0);
  }

  function queuePreviewText(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function clearChatPopoverTimer() {
    if (state.chatPopoverTimer) {
      window.clearTimeout(state.chatPopoverTimer);
      state.chatPopoverTimer = 0;
    }
  }

  function restoreChatModelSelectDock() {
    if (!chatModelSelectDock.contains(chatModelSelect)) {
      chatModelSelectDock.appendChild(chatModelSelect);
    }
    if (!chatModelSelectDock.contains(chatOpenCodeModelSelect)) {
      chatModelSelectDock.appendChild(chatOpenCodeModelSelect);
    }
    if (!chatModelSelectDock.contains(chatReasoningSelect)) {
      chatModelSelectDock.appendChild(chatReasoningSelect);
    }
    if (!chatModelSelectDock.contains(chatReasoningCustomInput)) {
      chatModelSelectDock.appendChild(chatReasoningCustomInput);
    }
  }

  function syncChatModelPopoverFields() {
    const node = state.chatPopover?.kind === "model" ? state.chatPopover.node : null;
    if (!node) {
      return;
    }
    const reasoningField = node.querySelector("[data-automation-chat-reasoning-field]");
    const customField = node.querySelector("[data-automation-chat-reasoning-custom-field]");
    const openCodeModelField = node.querySelector("[data-automation-chat-opencode-model-field]");
    if (openCodeModelField) {
      openCodeModelField.hidden = !!chatOpenCodeModelSelect.hidden;
    }
    if (reasoningField) {
      reasoningField.hidden = !!chatReasoningSelect.hidden;
    }
    if (customField) {
      const showCustom = !chatReasoningSelect.hidden && String(chatReasoningSelect.value || "") === "__custom__";
      chatReasoningCustomInput.hidden = !showCustom;
      customField.hidden = !showCustom;
    }
  }

  function closeChatPopover(kind = "") {
    clearChatPopoverTimer();
    if (!state.chatPopover) {
      restoreChatModelSelectDock();
      return;
    }
    if (kind && state.chatPopover.kind !== kind) {
      return;
    }
    const onClose = state.chatPopover.onClose;
    const popover = state.chatPopover.node;
    state.chatPopover = null;
    popover?.remove?.();
    onClose?.();
  }

  function scheduleChatPopoverClose(kind = "", delay = 120) {
    clearChatPopoverTimer();
    state.chatPopoverTimer = window.setTimeout(() => {
      closeChatPopover(kind);
    }, Math.max(0, Number(delay || 0) || 0));
  }

  function positionChatPopover(popover, anchor) {
    if (!popover || !anchor) {
      return;
    }
    const layerRect = chatPopoverLayer.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height || !anchorRect.width) {
      return;
    }
    popover.style.left = "8px";
    popover.style.top = "8px";
    const popRect = popover.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, layerRect.width - popRect.width - margin);
    let left = anchorRect.left - layerRect.left;
    if ((left + popRect.width + margin) > layerRect.width) {
      left = anchorRect.right - layerRect.left - popRect.width;
    }
    left = Math.max(margin, Math.min(maxLeft, left));
    let top = anchorRect.top - layerRect.top - popRect.height - margin;
    if (top < margin) {
      top = anchorRect.bottom - layerRect.top + margin;
    }
    const maxTop = Math.max(margin, layerRect.height - popRect.height - margin);
    top = Math.max(margin, Math.min(maxTop, top));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function openChatPopover(kind, anchor, build, options = {}) {
    if (!anchor || typeof build != "function") {
      return null;
    }
    if (state.chatPopover?.kind === kind && state.chatPopover?.anchor === anchor) {
      return state.chatPopover.node || null;
    }
    closeChatPopover();
    const popover = createNode("div", {
      className: "sr-chat-inline-popover",
      attrs: {
        "data-automation-chat-popover": kind,
      },
    });
    const content = build();
    if (Array.isArray(content)) {
      popover.append(...content.filter(Boolean));
    }
    else if (content) {
      popover.append(content);
    }
    chatPopoverLayer.appendChild(popover);
    state.chatPopover = {
      kind,
      anchor,
      node: popover,
      onClose: typeof options.onClose == "function" ? options.onClose : null,
    };
    if (options.autoClose) {
      popover.addEventListener("mouseenter", () => clearChatPopoverTimer());
      popover.addEventListener("mouseleave", () => scheduleChatPopoverClose(kind));
    }
    positionChatPopover(popover, anchor);
    window.requestAnimationFrame(() => positionChatPopover(popover, anchor));
    if (typeof options.onOpen == "function") {
      options.onOpen(popover);
    }
    return popover;
  }

  function createChatPopoverHint(text = "", label = "More information") {
    const button = createButton("?", "sr-chat-hint", {
      type: "button",
      "aria-label": label,
      "aria-expanded": "false",
    });
    const popover = createNode("span", {
      className: "sr-chat-hint-popover",
      textContent: text,
      attrs: { hidden: "hidden" },
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !!popover.hidden;
      popover.hidden = !open;
      button.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
      if (state.chatPopover?.kind === "model" && state.chatPopover?.node) {
        positionChatPopover(state.chatPopover.node, chatModelBtn);
      }
    });
    return createNode("span", {
      className: "sr-chat-hint-wrap",
      children: [button, popover],
    });
  }

  async function saveChatModelPopover() {
    try {
      if (!chatReasoningSelect.hidden && String(chatReasoningSelect.value || "") === "__custom__") {
        await applyChatReasoningOverride(chatReasoningCustomInput.value);
      }
      closeChatPopover("model");
      setStatus("Chat model saved.", "ready");
    }
    catch (error) {
      updateChatModelControls();
      setStatus(error?.message || String(error), "error");
    }
  }

  function openChatModelPopover() {
    if (chatModelBtn.disabled) {
      return;
    }
    if (state.chatPopover?.kind === "model" && state.chatPopover?.anchor === chatModelBtn) {
      closeChatPopover("model");
      return;
    }
    const popover = openChatPopover("model", chatModelBtn, () => {
      const modelLabel = createNode("label", {
        className: "sr-field-label",
        textContent: "Chat model",
        children: [chatModelSelect],
      });
      const openCodeModelLabel = createNode("label", {
        className: "sr-field-label",
        textContent: "OpenCode model",
        attrs: { "data-automation-chat-opencode-model-field": "true" },
        children: [chatOpenCodeModelSelect],
      });
      openCodeModelLabel.hidden = chatOpenCodeModelSelect.hidden;
      const reasoningLabel = createNode("label", {
        className: "sr-field-label",
        attrs: { "data-automation-chat-reasoning-field": "true" },
        children: [
          createNode("span", {
            className: "sr-field-label-row",
            children: [
              createNode("span", { textContent: "Reasoning" }),
              createChatPopoverHint(isOpenCodePreset(selectedChatPreset()) ? openCodeReasoningHintText() : reasoningHintText(), "Reasoning help"),
            ],
          }),
          chatReasoningSelect,
        ],
      });
      reasoningLabel.hidden = chatReasoningSelect.hidden;
      const customReasoningLabel = createNode("label", {
        className: "sr-field-label",
        textContent: "Custom reasoning",
        attrs: { "data-automation-chat-reasoning-custom-field": "true" },
        children: [chatReasoningCustomInput],
      });
      customReasoningLabel.hidden = chatReasoningSelect.hidden || String(chatReasoningSelect.value || "") !== "__custom__";
      const modelSaveBtn = createButton("Save", "sr-workspace-btn sr-workspace-btn-primary", { type: "button" });
      modelSaveBtn.addEventListener("click", () => {
        saveChatModelPopover().catch((error) => setStatus(error?.message || String(error), "error"));
      });
      return createNode("div", {
        className: "sr-chat-inline-popover-body",
        children: [
          createNode("div", {
            className: "sr-chat-inline-popover-title",
            textContent: "Change model",
          }),
          createNode("div", {
            className: "sr-chat-inline-popover-copy",
            textContent: chatModelNote.textContent,
          }),
          modelLabel,
          openCodeModelLabel,
          reasoningLabel,
          customReasoningLabel,
          createNode("div", {
            className: "sr-chat-inline-popover-actions",
            children: [modelSaveBtn],
          }),
        ],
      });
    }, {
      onClose: () => {
        restoreChatModelSelectDock();
      },
    });
    if (popover) {
      chatModelSelect.focus();
    }
  }

  function openChatExploreDraftPopover() {
    const summary = String(chatExploreSummary.title || chatExploreSummary.textContent || "").trim();
    const columnsText = String(chatExploreColumnsPreview.title || chatExploreColumnsPreview.textContent || "").trim();
    if (chatExploreStrip.hidden || (!summary && !columnsText)) {
      return null;
    }
    return openChatPopover("explore-draft", chatExploreCopy, () => createNode("div", {
      className: "sr-chat-inline-popover-body",
      children: [
        createNode("div", {
          className: "sr-chat-inline-popover-title",
          textContent: "Explore prompt",
        }),
        summary
          ? createNode("div", {
              className: "sr-chat-inline-popover-copy",
              textContent: summary,
            })
          : null,
        columnsText
          ? createNode("div", {
              className: "sr-chat-inline-popover-copy",
              textContent: columnsText,
            })
          : null,
      ].filter(Boolean),
    }), {
      autoClose: true,
    });
  }

  function renderChatQueue() {
    const items = pendingMessages();
    chatQueueList.replaceChildren();
    chatQueueList.hidden = items.length === 0;
    if (!items.length) {
      return;
    }
    for (const entry of items) {
      const mode = String(entry?.mode || "queued").trim() === "steer" ? "steer" : "queued";
      const text = String(entry?.content || "").trim();
      const row = createNode("div", {
        className: `sr-chat-queue-item${mode === "steer" ? " is-steer" : ""}`,
        attrs: {
          "data-automation-chat-queue-id": String(entry?.queue_id || ""),
          "data-automation-chat-queue-mode": mode,
        },
        children: [
          createNode("div", {
            className: "sr-chat-queue-copy",
            children: [
              createNode("div", {
                className: "sr-chat-queue-meta",
                children: [
                  createNode("span", {
                    className: "sr-chat-queue-badge",
                    textContent: "->",
                  }),
                ],
              }),
              createNode("div", {
                className: "sr-chat-queue-text",
                attrs: { title: text },
                textContent: queuePreviewText(text),
              }),
            ],
          }),
          createNode("div", {
            className: "sr-chat-queue-actions",
            children: [
              (() => {
                const button = createButton(mode === "steer" ? "Queued" : "Steer", "sr-workspace-btn sr-chat-queue-btn sr-chat-queue-btn-pill", {
                  type: "button",
                  "data-automation-chat-queue-action": "steer",
                });
                button.addEventListener("click", async () => {
                  try {
                    const result = await ctx.invoke("automation.chat.queue.update", {
                      session_id: sessionSelect.value,
                      queue_id: entry.queue_id,
                      mode: mode === "steer" ? "queued" : "steer",
                    });
                    if (state.bootstrap?.current_project) {
                      state.bootstrap.current_project.session_runtime_state = result?.runtime_state || state.bootstrap.current_project.session_runtime_state;
                    }
                    state.bootstrap = {
                      ...(state.bootstrap || {}),
                      pending_messages: Array.isArray(result?.pending_messages) ? result.pending_messages : pendingMessages(),
                    };
                    if (state.bootstrap?.current_project) {
                      state.bootstrap.current_project.pending_messages = Array.isArray(result?.pending_messages)
                        ? result.pending_messages
                        : pendingMessages();
                    }
                    renderChatQueue();
                    renderChatBudget();
                    setStatus(mode === "steer" ? "Steer message moved back to normal order." : "Queued message will be inserted at the next assistant boundary.", "ready");
                  }
                  catch (error) {
                    setStatus(error?.message || String(error), "error");
                  }
                });
                return button;
              })(),
              (() => {
                const button = createButton("Edit", "sr-workspace-btn sr-chat-queue-btn", {
                  type: "button",
                  "data-automation-chat-queue-action": "edit",
                });
                button.addEventListener("click", async () => {
                  try {
                    await ctx.invoke("automation.chat.queue.remove", {
                      session_id: sessionSelect.value,
                      queue_id: entry.queue_id,
                    });
                    chatInput.value = text;
                    chatInput.focus();
                    chatInput.setSelectionRange(text.length, text.length);
                    await refreshBootstrap();
                    updateCommandMenu();
                    renderChatBudget();
                    setStatus("Queued message moved back into the composer.", "ready");
                  }
                  catch (error) {
                    setStatus(error?.message || String(error), "error");
                  }
                });
                return button;
              })(),
              (() => {
                const button = createButton("Remove", "sr-workspace-btn sr-chat-queue-btn", {
                  type: "button",
                  "data-automation-chat-queue-action": "remove",
                });
                button.addEventListener("click", async () => {
                  try {
                    await ctx.invoke("automation.chat.queue.remove", {
                      session_id: sessionSelect.value,
                      queue_id: entry.queue_id,
                    });
                    await refreshBootstrap();
                    setStatus("Queued message removed.", "ready");
                  }
                  catch (error) {
                    setStatus(error?.message || String(error), "error");
                  }
                });
                return button;
              })(),
            ],
          }),
        ],
      });
      chatQueueList.appendChild(row);
    }
  }

  function openChatBudgetPopover(widget, details = {}) {
    const formatTokens = (value) => {
      const number = Math.max(0, Number(value || 0) || 0);
      if (number >= 1000000) {
        return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}m`;
      }
      if (number >= 1000) {
        return `${Math.round(number / 1000)}k`;
      }
      return String(number);
    };
    const buildLine = (label, value) => createNode("div", {
      className: "sr-chat-token-tooltip-line",
      children: [
        createNode("span", { textContent: label }),
        createNode("strong", { textContent: value }),
      ],
    });
		    const percent = Math.max(0, Math.min(999, Number(details.percent || 0) || 0));
		    const meterPercent = Math.max(0, Math.min(100, percent));
		    const targetPercent = Number(details.targetInputBudget || 0) > 0
		      ? Math.max(0, Math.min(999, Math.round(((Number(details.usedNextSend || 0) || 0) / (Number(details.targetInputBudget || 0) || 1)) * 100)))
		      : 0;
		    const targetRemaining = Math.max(0, (Number(details.targetInputBudget || 0) || 0) - (Number(details.usedNextSend || 0) || 0));
	    openChatPopover("budget", widget, () => createNode("div", {
      className: "sr-chat-inline-popover-body",
      children: [
        createNode("div", {
          className: "sr-chat-context-summary",
          children: [
            createNode("div", {
              className: "sr-chat-context-summary-label",
              textContent: "Context window",
            }),
            createNode("div", {
              className: "sr-chat-context-summary-main",
              textContent: details.stateful ? "Provider managed" : `${percent}% full`,
            }),
	            createNode("div", {
	              className: "sr-chat-context-summary-sub",
	              children: details.stateful
	                ? [
	                    createNode("div", { textContent: `${formatTokens(details.usedNextSend || 0)} visible tokens + provider history` }),
	                  ]
	                : [
	                    createNode("div", { textContent: `${formatTokens(details.windowUsedTokens || 0)} / ${formatTokens(details.contextWindow || 0)} total context` }),
	                    createNode("div", { textContent: `${formatTokens(details.usedNextSend || 0)} / ${formatTokens(details.targetInputBudget || details.inputBudget || 0)} send target` }),
	                  ],
	            }),
            createNode("div", {
              className: "sr-chat-context-meter",
              children: [
                createNode("div", {
                  className: `sr-chat-context-meter-fill${details.wouldTruncate ? " is-warning" : ""}`,
                  style: { width: `${meterPercent}%` },
                }),
              ],
            }),
          ],
        }),
        createNode("div", {
	          className: "sr-chat-context-breakdown",
	          children: [
	            buildLine("Context used", details.stateful ? "Provider managed" : `${formatTokens(details.windowUsedTokens || 0)} / ${formatTokens(details.contextWindow || 0)}`),
	            buildLine("Next send", details.stateful ? "Provider managed" : `${formatTokens(details.usedNextSend || 0)} / ${formatTokens(details.targetInputBudget || details.inputBudget || 0)} target`),
	            buildLine("System + active memory", `${formatTokens(details.headTokens || 0)} total`),
            buildLine("Active memory", formatTokens(details.activeMemoryTokens || 0)),
            buildLine("Tool schemas", formatTokens(details.toolSchemaTokens || 0)),
	            buildLine("Selected history", formatTokens(details.selectedHistoryTokens || 0)),
	            buildLine("Truncation notice", formatTokens(details.truncationNoticeTokens || 0)),
	            buildLine("Raw history", formatTokens(details.rawHistoryTokens || 0)),
	            buildLine("Draft message", formatTokens(details.draftTokens || 0)),
	            buildLine("Steer next", `${details.steerCount || 0} / ${formatTokens(details.steerTokens || 0)}`),
	            buildLine("Queued after this", `${details.queuedCount || 0} / ${formatTokens(details.queuedTokens || 0)}`),
		            buildLine("Input budget", details.stateful ? "Provider managed" : formatTokens(details.inputBudget || 0)),
		            !details.stateful ? buildLine("Send target", `${formatTokens(details.targetInputBudget || 0)} (${targetPercent}% used)`) : null,
	            !details.stateful ? buildLine("Target room", formatTokens(targetRemaining)) : null,
	            buildLine("Reserved output", formatTokens(details.maxOutput || 0)),
            buildLine("Safe cap / window", `${formatTokens(details.safeCap || 0)} / ${formatTokens(details.contextWindow || 0)}`),
            buildLine("Omitted entries", String(details.omittedCount || 0)),
            buildLine("Memory update", details.compactionStatus || "Idle"),
            buildLine("Middle truncation", details.stateful
              ? "Provider managed"
              : (details.wouldTruncate
                ? `Active${details.omittedCount ? ` (${details.omittedCount} hidden)` : ""}`
                : "Off")),
          ],
        }),
	        createNode("div", {
	          className: "sr-chat-context-payloads",
	          children: [
	            createNode("div", {
	              className: "sr-chat-inline-popover-copy",
	              textContent: "The exact model input is shown as a Model input block in the chat for the current run.",
	            }),
	          ],
	        }),
      ],
    }), {
      autoClose: true,
    });
  }

  function renderChatBudget() {
    const budget = currentChatBudget();
    const draftText = String(chatInput.value || "").trim();
    const draftTokens = draftText
      ? estimateTextTokens(`USER [user_message]\n${draftText}`)
      : 0;
    const pending = pendingMessages();
    if (state.chatPopover?.kind === "budget") {
      closeChatPopover("budget");
    }
    chatBudgetStrip.replaceChildren();
    if (!budget) {
      return;
    }
    const contextWindow = Number(budget.context_window || 0) || 0;
    const maxOutput = Number(budget.max_output_tokens || 0) || 0;
    const safeCap = Number(budget.safe_cap_tokens || 0) || 0;
    const formatTokens = (value) => {
      const number = Math.max(0, Number(value || 0) || 0);
      if (number >= 1000000) {
        return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}m`;
      }
      if (number >= 1000) {
        return `${Math.round(number / 1000)}k`;
      }
      return String(number);
    };
    const pendingSteerCount = Number(budget?.pending_steer_count || 0) || pending.filter((entry) => String(entry?.mode || "") === "steer").length;
    const pendingQueuedCount = Number(budget?.pending_queued_count || 0) || pending.filter((entry) => String(entry?.mode || "") !== "steer").length;
    const pendingSteerTokens = Number(budget?.pending_steer_tokens || 0) || pendingMessageTokens(pending.filter((entry) => String(entry?.mode || "") === "steer"));
    const pendingQueuedTokens = Number(budget?.pending_queued_tokens || 0) || pendingMessageTokens(pending.filter((entry) => String(entry?.mode || "") !== "steer"));
    if (budget.stateful) {
      const details = {
        stateful: true,
        promptNow: "Managed by runtime",
        draftTokens,
        steerCount: pendingSteerCount,
        steerTokens: pendingSteerTokens,
        queuedCount: pendingQueuedCount,
        queuedTokens: pendingQueuedTokens,
	        contextWindow,
	        maxOutput,
	        safeCap,
	        headTokens: Number(budget.head_tokens || 0) || 0,
	        activeMemoryTokens: Number(budget.active_memory_tokens || 0) || 0,
	        toolSchemaTokens: Number(budget.tool_schema_tokens || 0) || 0,
	        truncationNoticeTokens: Number(budget.truncation_notice_tokens || 0) || 0,
	        selectedHistoryTokens: Math.max(0, (Number(budget.estimated_input_tokens || 0) || 0) - (Number(budget.head_tokens || 0) || 0) - (Number(budget.tool_schema_tokens || 0) || 0) - (Number(budget.truncation_notice_tokens || 0) || 0)),
	        rawHistoryTokens: Number(budget.raw_history_tokens || 0) || 0,
	        compactionStatus: String(budget?.compaction_status?.message || budget?.compaction_status?.status || "Idle").trim() || "Idle",
		        inputBudget: "Managed by runtime",
		        usedNextSend: Number(budget.estimated_input_tokens || 0) || 0,
		        windowUsedTokens: Number(budget.estimated_input_tokens || 0) || 0,
		        percent: 0,
	        headText: String(budget.head_text || ""),
	        activeMemoryText: String(budget.active_memory_text || ""),
	        toolSchemaText: String(budget.tool_schema_text || ""),
	        promptText: String(budget.prompt_text || ""),
        wouldTruncate: false,
	        omittedCount: Number(budget.omitted_count || 0) || 0,
	        targetInputBudget: 0,
	      };
      const widget = createButton("", "sr-chat-token-widget", {
        "aria-label": "Stateful context widget",
        "data-automation-chat-budget-widget": "true",
      });
      widget.appendChild(createNode("span", { className: "sr-chat-token-widget-percent", textContent: "Stateful" }));
      widget.addEventListener("mouseenter", () => openChatBudgetPopover(widget, details));
      widget.addEventListener("mouseleave", () => scheduleChatPopoverClose("budget"));
      widget.addEventListener("focus", () => openChatBudgetPopover(widget, details));
      widget.addEventListener("blur", () => scheduleChatPopoverClose("budget"));
      widget.addEventListener("click", (event) => {
        event.preventDefault();
        if (state.chatPopover?.kind === "budget" && state.chatPopover?.anchor === widget) {
          closeChatPopover("budget");
          return;
        }
        openChatBudgetPopover(widget, details);
      });
      chatBudgetStrip.appendChild(widget);
      return;
    }
	    const currentPromptTokens = Number(budget.estimated_input_tokens || 0) || 0;
	    const estimated = currentPromptTokens + draftTokens + pendingSteerTokens;
		    const inputBudget = Number(budget.input_budget_tokens || 0) || 0;
		    const targetInputBudget = Number(budget.target_input_budget_tokens || 0) || 0;
		    const wouldTruncate = (targetInputBudget ? estimated > targetInputBudget : estimated > inputBudget) || !!budget.truncated;
		    const windowUsedTokens = estimated + maxOutput;
			    const percentBase = contextWindow > 0 ? contextWindow : (safeCap > 0 ? safeCap : inputBudget);
		    const percent = percentBase > 0
		      ? Math.max(0, Math.min(999, Math.round((windowUsedTokens / percentBase) * 100)))
	      : 0;
    const details = {
      stateful: false,
      promptNow: currentPromptTokens,
      draftTokens,
      steerCount: pendingSteerCount,
      steerTokens: pendingSteerTokens,
      queuedCount: pendingQueuedCount,
      queuedTokens: pendingQueuedTokens,
	      contextWindow,
	      maxOutput,
	      safeCap,
	      headTokens: Number(budget.head_tokens || 0) || 0,
	      activeMemoryTokens: Number(budget.active_memory_tokens || 0) || 0,
	      toolSchemaTokens: Number(budget.tool_schema_tokens || 0) || 0,
	      truncationNoticeTokens: Number(budget.truncation_notice_tokens || 0) || 0,
	      selectedHistoryTokens: Math.max(0, currentPromptTokens - (Number(budget.head_tokens || 0) || 0) - (Number(budget.tool_schema_tokens || 0) || 0) - (Number(budget.truncation_notice_tokens || 0) || 0)),
	      rawHistoryTokens: Number(budget.raw_history_tokens || 0) || 0,
	      compactionStatus: String(budget?.compaction_status?.message || budget?.compaction_status?.status || "Idle").trim() || "Idle",
		      inputBudget,
			      targetInputBudget,
		      usedNextSend: estimated,
		      windowUsedTokens,
	      percent,
      headText: String(budget.head_text || ""),
      activeMemoryText: String(budget.active_memory_text || ""),
      toolSchemaText: String(budget.tool_schema_text || ""),
      promptText: String(budget.prompt_text || ""),
      wouldTruncate,
      omittedCount: Number(budget.omitted_count || 0) || 0,
    };
	    const widget = createButton("", `sr-chat-token-widget${wouldTruncate ? " is-warning" : ""}`, {
		      "aria-label": `${percent}% of the model context window is planned for this send`,
	      "data-automation-chat-budget-widget": "true",
	    });
    widget.appendChild(createNode("span", { className: "sr-chat-token-widget-percent", textContent: `${percent}%` }));
    widget.addEventListener("mouseenter", () => openChatBudgetPopover(widget, details));
    widget.addEventListener("mouseleave", () => scheduleChatPopoverClose("budget"));
    widget.addEventListener("focus", () => openChatBudgetPopover(widget, details));
    widget.addEventListener("blur", () => scheduleChatPopoverClose("budget"));
    widget.addEventListener("click", (event) => {
      event.preventDefault();
      if (state.chatPopover?.kind === "budget" && state.chatPopover?.anchor === widget) {
        closeChatPopover("budget");
        return;
      }
      openChatBudgetPopover(widget, details);
    });
    chatBudgetStrip.appendChild(widget);
  }

  function applyChatSnapshot(result = {}) {
    clearLiveChatTransientState();
    if (state.bootstrap?.current_project) {
      state.bootstrap.current_project.active_session_id = result?.active_session_id || state.bootstrap.current_project.active_session_id;
    }
    const nextPendingMessages = Array.isArray(result?.pending_messages) ? result.pending_messages : pendingMessages();
    const rawHistory = Array.isArray(result?.chat_history_raw) ? result.chat_history_raw : (state.bootstrap?.chat_history_raw || []);
    const uiHistory = rawHistory.length
      ? rawHistory
      : (Array.isArray(result?.chat_history) ? result.chat_history : (state.bootstrap?.chat_history || []));
    state.bootstrap = {
      ...(state.bootstrap || {}),
      chat_history: uiHistory,
      chat_history_raw: rawHistory,
      sessions: Array.isArray(result?.sessions) ? result.sessions : (state.bootstrap?.sessions || []),
      chat_budget: result?.chat_budget || state.bootstrap?.chat_budget || null,
      prompt_projection: result?.prompt_projection || state.bootstrap?.prompt_projection || null,
      pending_messages: nextPendingMessages,
    };
    if (state.bootstrap?.current_project) {
      state.bootstrap.current_project.chat_budget = result?.chat_budget || state.bootstrap.current_project.chat_budget || null;
      state.bootstrap.current_project.pending_messages = nextPendingMessages;
    }
    updatePendingMessagesState(nextPendingMessages);
    if (result?.session && state.bootstrap?.current_project) {
      state.bootstrap.current_project.session = result.session;
    }
    if (result?.runtime_state && state.bootstrap?.current_project) {
      state.bootstrap.current_project.session_runtime_state = result.runtime_state;
    }
    const incomingReportHash = String(result?.report_hash || "").trim();
    if (incomingReportHash && incomingReportHash !== state.lastRenderedReportHash && state.mode === "preview") {
      schedulePreviewRefresh({ force: true, delayMs: 0 });
    }
    populateSessionControls(Array.isArray(result?.sessions) ? result.sessions : state.bootstrap?.sessions || [], result?.active_session_id || sessionSelect.value);
    updateChatModelControls();
    renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
    renderChatQueue();
    renderChatBudget();
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
  }

  function scheduleSessionContextHydration(bootstrap = null) {
    if (!bootstrap?.current_project || !bootstrap?.session_context_deferred) {
      return;
    }
    const projectID = String(bootstrap?.current_project?.entry?.project_id || "").trim();
    const sessionID = String(bootstrap?.current_project?.active_session_id || sessionSelect.value || "").trim();
    if (!sessionID) {
      return;
    }
    const token = ++state.sessionContextHydrationToken;
    window.setTimeout(() => {
      if (state.destroyed || token !== state.sessionContextHydrationToken) {
        return;
      }
      ctx.invoke("automation.session.ensure_context", {
        project_id: projectID,
        session_id: sessionID,
      }).then((result) => {
        if (state.destroyed || token !== state.sessionContextHydrationToken) {
          return;
        }
        const activeProjectID = String(state.bootstrap?.current_project?.entry?.project_id || "").trim();
        const activeSessionID = String(state.bootstrap?.current_project?.active_session_id || sessionSelect.value || "").trim();
        if ((projectID && activeProjectID && projectID !== activeProjectID) || (activeSessionID && activeSessionID !== sessionID)) {
          return;
        }
        applyChatSnapshot(result || {});
      }).catch((error) => {
        if (!state.destroyed && token === state.sessionContextHydrationToken) {
          setStatus(error?.message || String(error), "error");
        }
      });
    }, 0);
  }

  function appendChatTimelineEntry(entry = null) {
    if (!entry || typeof entry != "object") {
      return;
    }
    const visible = Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history.slice() : [];
    const raw = Array.isArray(state.bootstrap?.chat_history_raw) ? state.bootstrap.chat_history_raw.slice() : visible.slice();
    visible.push(entry);
    raw.push(entry);
    let nextBudget = currentChatBudget();
    if (nextBudget && !nextBudget.stateful && !entry?.context_excluded) {
      nextBudget = {
        ...nextBudget,
        estimated_input_tokens: (Number(nextBudget.estimated_input_tokens || 0) || 0)
          + estimateTextTokens(serializeTimelineEntry(entry)),
      };
    }
    state.bootstrap = {
      ...(state.bootstrap || {}),
      chat_history: visible,
      chat_history_raw: raw,
      chat_budget: nextBudget || state.bootstrap?.chat_budget || null,
    };
    if (state.bootstrap?.current_project && nextBudget) {
      state.bootstrap.current_project.chat_budget = nextBudget;
    }
    renderChat(visible);
    renderChatBudget();
  }

  function currentChatStreamURL() {
    const base = String(state.bootstrap?.stream_base_url || "").trim();
    return base
      ? `${base}/systematic-reviewer/workflow/automation/chat/stream`
      : "";
  }

  async function handleChatStreamEvent(event = {}) {
    const type = String(event?.type || "").trim();
    if (!type) {
      return;
    }
    if (type === "run.started") {
      setChatRun(event.run || null);
      return;
    }
	    if (type === "chat.budget") {
	      applyChatBudget(event?.chat_budget || null);
	      return;
	    }
	    if (type === "prompt.preview") {
	      applyChatBudget(event?.chat_budget || null);
	      upsertPromptPreviewRow(event || {});
	      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
	      await flushChatStreamFrame(true);
	      return;
	    }
		    if (type === "model.retry") {
	      const retryIndex = Math.max(1, Number(event?.retry_index || 0) || 1);
      const maxRetries = Math.max(1, Number(event?.max_retries || 0) || 5);
      const retryDelayMs = Math.max(0, Number(event?.retry_delay_ms || 0) || 0);
      const delayLabel = retryDelayMs >= 1000 ? ` in ${Math.round(retryDelayMs / 1000)}s` : "";
      clearLiveChatTransientState();
      upsertLiveProgressRow("model-retry", {
        role: "system",
        event_type: "assistant_status",
        title: "Retrying Model Call",
        content: `Retrying model call ${retryIndex}/${maxRetries}${delayLabel}.`,
      });
      setStatus(`Retrying model call ${retryIndex}/${maxRetries}${delayLabel}...`, "");
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
	      await flushChatStreamFrame(true);
	      return;
	    }
			    if (type === "memory.compaction.started" || type === "memory.compaction.retry" || type === "memory.compaction.completed" || type === "memory.compaction.failed" || type === "memory.compaction.warning" || type === "memory.compaction.stopped") {
			      const memory = event?.memory && typeof event.memory === "object" ? event.memory : {};
			      const isStarted = type === "memory.compaction.started";
			      const isRetry = type === "memory.compaction.retry";
			      const isFailed = type === "memory.compaction.failed";
		      const isWarning = type === "memory.compaction.warning";
		      const isStopped = type === "memory.compaction.stopped";
			      const message = String(memory?.message || (isStarted ? "Updating active memory..." : isRetry ? "Retrying active memory..." : isFailed ? "Active memory update failed" : isWarning ? "Active memory is empty" : isStopped ? "Active memory update stopped" : "Active memory updated")).trim();
		      const nextBudget = currentChatBudget();
		      if (nextBudget) {
		        const activeMemoryTokens = Math.max(0, Number(memory?.active_memory_tokens || 0) || 0);
		        const previousActiveMemoryTokens = Math.max(0, Number(nextBudget.active_memory_tokens || 0) || 0);
		        const activeMemoryDelta = activeMemoryTokens > previousActiveMemoryTokens
		          ? activeMemoryTokens - previousActiveMemoryTokens
		          : 0;
		        applyChatBudget({
		          ...nextBudget,
		          compaction_status: memory,
		          ...(activeMemoryTokens ? { active_memory_tokens: activeMemoryTokens } : {}),
		          ...(activeMemoryDelta ? { head_tokens: (Number(nextBudget.head_tokens || 0) || 0) + activeMemoryDelta } : {}),
		        });
		      }
			      upsertLiveProgressRow("memory-compaction", {
			        role: "system",
			        event_type: "assistant_status",
			        title: isStarted ? "Updating Active Memory" : (isRetry ? "Retrying Active Memory" : (isFailed ? "Active Memory Update Failed" : (isWarning ? "Active Memory Empty" : (isStopped ? "Active Memory Update Stopped" : "Active Memory Updated")))),
			        content: message,
			      });
		      setStatus(message, isFailed ? "error" : "");
	      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
	      await flushChatStreamFrame(true);
			      if (!isStarted && !isRetry) {
	        window.setTimeout(() => {
	          removeLiveProgressRow("memory-compaction");
	          renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
	        }, 1800);
	      }
	      return;
	    }
	    if (type === "assistant.delta") {
	      removeLiveProgressRow("model-retry");
      const transport = String(event?.transport || "").trim();
      if (transport === "native-structured") {
        state.liveAssistantMessage = null;
        removeLiveProgressRow("assistant-resumed");
        upsertLiveProgressRow("assistant-stream-planner", {
          role: "system",
          event_type: "assistant_stream_status",
          title: "Preparing Reply",
          content: "Formatting the next assistant reply.",
        });
        renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
        await flushChatStreamFrame();
        return;
      }
      if (transport.includes("text")) {
        const nextPlannerText = String(event?.text || "");
        if (!nextPlannerText) {
          return;
        }
        state.liveAssistantMessage = null;
        removeLiveProgressRow("assistant-resumed");
        upsertLiveProgressRow("assistant-stream-planner", {
          role: "system",
          event_type: "assistant_stream_status",
          title: "Planning Next Step",
          content: nextPlannerText,
        });
        renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
        await flushChatStreamFrame();
        return;
      }
      const nextText = String(event?.text || state.liveAssistantMessage?.content || "");
      if (!nextText) {
        return;
      }
      removeLiveProgressRow("assistant-stream-planner");
      removeLiveProgressRow("assistant-resumed");
      state.liveAssistantMessage = {
        role: "assistant",
        event_type: "assistant_live",
        content: nextText,
        synthetic: true,
      };
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      await flushChatStreamFrame();
      return;
    }
    if (type === "responses.reasoning.delta") {
      removeLiveProgressRow("model-retry");
      const nextText = String(event?.text || "") || "Reasoning...";
      removeLiveProgressRow("assistant-resumed");
      upsertLiveProgressRow("responses-reasoning", {
        role: "assistant",
        event_type: "responses_reasoning",
        title: "Reasoning",
        content: nextText,
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      await flushChatStreamFrame();
      return;
    }
    if (type === "tool.call.started") {
      const callID = String(event?.call_id || "").trim();
      const name = String(event?.name || "tool").trim() || "tool";
      removeLiveProgressRow("model-retry");
      removeLiveProgressRow("assistant-stream-planner");
      removeLiveProgressRow("assistant-resumed");
      upsertLiveProgressRow(`tool-start:${callID}`, {
        role: "tool",
        event_type: "function_call",
        title: `Calling ${name}`,
        content: `Calling ${name}.`,
        payload: {
          type: "function_call",
          call_id: callID,
          name,
          arguments: String(event?.arguments_text || "").trim() || "{}",
        },
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "tool.call.delta") {
      const callID = String(event?.call_id || "").trim();
      const name = String(event?.name || "tool").trim() || "tool";
      removeLiveProgressRow("model-retry");
      upsertLiveProgressRow(`tool-start:${callID}`, {
        role: "tool",
        event_type: "function_call",
        title: `Calling ${name}`,
        content: `Calling ${name}.`,
        payload: {
          type: "function_call",
          call_id: callID,
          name,
          arguments: String(event?.arguments_text || "").trim() || "{}",
        },
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "tool.call.waiting") {
      const callID = String(event?.call_id || "").trim();
      const name = String(event?.name || "tool").trim() || "tool";
      removeLiveProgressRow("model-retry");
      removeLiveProgressRow(`tool-start:${callID}`);
      upsertLiveProgressRow(`tool-wait:${callID}`, {
        role: "tool",
        event_type: "function_call_output",
        title: `Waiting for ${name}`,
        content: `Waiting for tool output from ${name}`,
        payload: {
          type: "function_call_output",
          call_id: callID,
          name,
          output: "",
        },
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "assistant.resumed") {
      removeLiveProgressRow("model-retry");
      removeLiveProgressRow("assistant-stream-planner");
      upsertLiveProgressRow("assistant-resumed", {
        role: "system",
        event_type: "assistant_stream_status",
        title: "Assistant Resumed",
        content: "Assistant resumed after tool output.",
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "explore.run.started") {
      removeLiveProgressRow("assistant-stream-planner");
      removeLiveProgressRow("assistant-resumed");
      upsertLiveProgressRow("explore-run-status", {
        role: "system",
        event_type: "assistant_status",
        title: "Explore Started",
        content: `Running Explore over ${Number(event?.run?.row_count || 0) || 0} rows in ${Number(event?.run?.batch_count || 0) || 0} batch(es).`,
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "explore.batch.completed") {
      const batch = event?.batch && typeof event.batch === "object" ? event.batch : null;
      if (!batch) {
        return;
      }
      upsertLiveProgressRow(`explore-batch:${Number(batch.batch_index || 0) || 0}`, {
        role: "assistant",
        event_type: "explore_batch_live",
        title: `Explore Batch ${Number(batch.batch_index || 0) + 1}`,
        content: String(batch?.content || ""),
        payload: batch,
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "codex.agent_message") {
      const text = truncateText(String(event?.text || "").replace(/\s+/g, " ").trim(), 180);
      if (!text) {
        return;
      }
      removeLiveProgressRow("model-retry");
      removeLiveProgressRow("assistant-resumed");
      upsertLiveProgressRow("codex-agent-status", {
        role: "system",
        event_type: "assistant_status",
        content: `Codex CLI: ${text}`,
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "codex.command.started") {
      const itemID = String(event?.item_id || "").trim() || "current";
      const command = truncateText(String(event?.command || "").replace(/\s+/g, " ").trim(), 140);
      if (!command) {
        return;
      }
      removeLiveProgressRow("model-retry");
      upsertLiveProgressRow(`codex-command:${itemID}`, {
        role: "system",
        event_type: "assistant_status",
        content: `Running ${command}`,
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "codex.command.completed") {
      const itemID = String(event?.item_id || "").trim() || "current";
      const command = truncateText(String(event?.command || "").replace(/\s+/g, " ").trim(), 120);
      const output = truncateText(String(event?.output || "").replace(/\s+/g, " ").trim(), 80);
      upsertLiveProgressRow(`codex-command:${itemID}`, {
        role: "system",
        event_type: "assistant_status",
        content: output
          ? `Finished ${command}: ${output}`
          : `Finished ${command}`,
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      return;
    }
    if (type === "responses.reasoning.started") {
      removeLiveProgressRow("model-retry");
      removeLiveProgressRow("assistant-resumed");
      upsertLiveProgressRow("responses-reasoning", {
        role: "assistant",
        event_type: "responses_reasoning",
        title: "Reasoning",
        content: "Reasoning...",
      });
      renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
      await flushChatStreamFrame(true);
      return;
    }
    if (type === "timeline.entry") {
      const entry = event?.entry && typeof event.entry == "object" ? event.entry : null;
      if (!entry) {
        return;
      }
      if (String(entry?.role || "") === "user") {
        state.optimisticUserMessage = null;
      }
      else {
        state.liveAssistantMessage = null;
      }
      if (String(entry?.event_type || "") === "function_call") {
        removeLiveToolProgress(String(entry?.payload?.call_id || "").trim());
      }
      if (String(entry?.event_type || "") === "function_call_output") {
        removeLiveToolProgress(String(entry?.payload?.call_id || "").trim());
      }
      if (["assistant_final", "thinking", "assistant_status"].includes(String(entry?.event_type || ""))) {
        removeLiveProgressRow("model-retry");
        removeLiveProgressRow("assistant-stream-planner");
        removeLiveProgressRow("assistant-resumed");
        removeLiveProgressRow("codex-agent-status");
        removeLiveProgressRow("explore-run-status");
      }
      if (["responses_message", "responses_reasoning"].includes(String(entry?.event_type || ""))) {
        removeLiveProgressRow("model-retry");
        removeLiveProgressRow("assistant-stream-planner");
        removeLiveProgressRow("assistant-resumed");
        removeLiveProgressRow("responses-reasoning");
        removeLiveProgressRow("codex-agent-status");
        removeLiveProgressRow("explore-run-status");
      }
      removePendingMessageState(String(entry?.payload?.queue_id || "").trim());
      appendChatTimelineEntry(entry);
      if (String(entry?.event_type || "") === "function_call_output" && state.previewModeLocked) {
        if (state.mode === "preview") {
          schedulePreviewRefresh({ force: true, delayMs: 250 });
        }
      }
      return;
    }
    if (type === "report.updated") {
      const nextHash = String(event?.report_hash || "").trim();
      if (nextHash) {
        state.latestReportHash = nextHash;
      }
      if (state.mode === "preview") {
        schedulePreviewRefresh({ force: true, delayMs: 0 });
      }
      return;
    }
    if (type === "stream.complete") {
      const finishedRun = state.chatRun ? { ...state.chatRun } : null;
      const resultStatus = String(event?.result?.run?.status || finishedRun?.status || "").trim();
      if (finishedRun?.startedAtMs) {
        state.lastCompletedRun = {
          runID: finishedRun.runID || finishedRun.run_id || "",
          sequenceBase: Number(finishedRun.sequenceBase || finishedRun.sequence_base || 0) || 0,
          durationLabel: formatElapsedTime(Math.max(0, Date.now() - finishedRun.startedAtMs)),
        };
      }
      state.optimisticUserMessage = null;
      clearLiveChatTransientState();
      applyChatSnapshot(event?.result || {});
      setChatRun(null);
      if (state.mode === "preview") {
        schedulePreviewRefresh({ force: true });
      }
	      if (resultStatus === "canceled") {
	        setStatus("Session stopped", "ready");
	        return;
	      }
	      if (resultStatus === "error") {
	        setStatus(event?.result?.run?.error || "Session run failed", "error");
	        return;
	      }
	      const startedQueuedRun = await processNextQueuedMessage({ mode: "queued" });
	      if (!startedQueuedRun) {
	        setStatus("Session updated", "ready");
	      }
	      return;
	    }
	    if (type === "stream.error") {
	      state.optimisticUserMessage = null;
	      clearLiveChatTransientState();
	      if (event?.result) {
	        applyChatSnapshot(event.result || {});
	      }
	      setChatRun(null);
	      if (state.mode === "preview") {
	        schedulePreviewRefresh({ force: true });
	      }
      setStatus(event?.error?.message || "Session run failed", "error");
    }
  }

  async function beginChatStream(message, options = {}) {
    const streamURL = currentChatStreamURL();
    if (!streamURL || typeof ctx.readEventStream != "function") {
      await beginChatRun(message, options);
      return;
    }
	    await prepareDocumentForChatRun();
	    state.lastCompletedRun = null;
	    closeChatPopover();
	    clearPromptPreviewRows();
	    state.optimisticUserMessage = {
      role: "user",
      content: message,
      event_type: "user_message",
      sequence_no: Number(state.chatRun?.sequenceBase || 0) + 1,
      local: true,
    };
    clearLiveChatTransientState();
    renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
    const controller = new AbortController();
    state.chatStreamAbortController = controller;
    const rawHistory = Array.isArray(state.bootstrap?.chat_history_raw) ? state.bootstrap.chat_history_raw : [];
    setChatRun({
      runID: `automation-stream-ui-${Date.now()}`,
      status: "running",
      sequenceBase: Number(rawHistory[rawHistory.length - 1]?.sequence_no || 0) || 0,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      elapsedMs: 0,
    });
    setStatus("Running session...", "");
    try {
      await ctx.readEventStream(streamURL, {
        session_id: sessionSelect.value,
        message,
        explore_scope_key: String(options?.explore_scope_key || options?.exploreScopeKey || "").trim(),
      }, async (event) => {
        await handleChatStreamEvent(event || {});
      }, {
        signal: controller.signal,
      });
    }
    catch (error) {
      if (controller.signal.aborted || state.destroyed) {
        return;
      }
      state.optimisticUserMessage = null;
      clearLiveChatTransientState();
      setChatRun(null);
      throw error;
    }
    finally {
      if (state.chatStreamAbortController === controller) {
        state.chatStreamAbortController = null;
      }
    }
  }

  async function stopActiveChatRun(options = {}) {
    clearChatPollTimer();
    const runID = String(state.chatRun?.runID || state.chatRun?.run_id || "").trim();
    const controller = state.chatStreamAbortController || null;
    let result = null;
    try {
      result = await ctx.invoke("automation.chat.stop", {
        run_id: runID,
        session_id: sessionSelect.value,
      });
    }
    finally {
      if (!result?.stopped) {
        controller?.abort?.();
      }
      if (state.chatStreamAbortController === controller) {
        state.chatStreamAbortController = null;
      }
    }
    state.optimisticUserMessage = null;
    clearLiveChatTransientState();
    state.lastCompletedRun = null;
    if (result) {
      applyChatSnapshot(result);
      setChatRun(result?.run || null);
      if (state.mode === "preview") {
        schedulePreviewRefresh({ force: true });
      }
    }
    else {
      setChatRun(null);
      if (state.mode === "preview") {
        schedulePreviewRefresh({ force: true });
      }
    }
    if (!options?.silent) {
      setStatus("Session stopped", "ready");
    }
    return true;
  }

  function exploreBatchCacheKey(chatID = "", batchIndex = 0) {
    return `${String(chatID || "").trim()}::${Number(batchIndex || 0) || 0}`;
  }

  async function ensureExploreBatchLoaded(chatID = "", batchIndex = 0) {
    const cacheKey = exploreBatchCacheKey(chatID, batchIndex);
    const cached = state.exploreBatchCache.get(cacheKey);
    if (cached?.status === "ready") {
      return cached.value;
    }
    if (cached?.status === "loading" && cached.promise) {
      return await cached.promise;
    }
    const promise = ctx.invoke("automation.explore.loadBatch", {
      chat_id: chatID,
      batch_index: batchIndex,
    }).then((result) => {
      state.exploreBatchCache.set(cacheKey, {
        status: "ready",
        value: result,
      });
      return result;
    }).catch((error) => {
      state.exploreBatchCache.set(cacheKey, {
        status: "error",
        error: error?.message || String(error),
      });
      throw error;
    });
    state.exploreBatchCache.set(cacheKey, {
      status: "loading",
      promise,
    });
    return await promise;
  }

	  function renderExploreChatMessage(message = {}) {
    const eventType = String(message?.event_type || "").trim();
    if (!["explore_run", "explore_batch_live"].includes(eventType)) {
      return null;
    }
    const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
    const wrapper = createNode("div", {
      className: "sr-workspace-message sr-workspace-message-event sr-workspace-message-explore",
    });
    const title = createNode("div", {
      className: "sr-workspace-message-title",
      textContent: cleanDisplayText(
        String(message?.title || (eventType === "explore_run" ? "Explore Run" : "Explore Batch")).trim()
      ),
    });
    wrapper.appendChild(title);
    if (String(message?.content || "").trim()) {
      wrapper.appendChild(createNode("div", {
        className: "sr-workspace-message-text",
        textContent: String(message.content || "").trim(),
      }));
    }
    if (eventType === "explore_batch_live") {
      const batchMessage = {
        citations: Array.isArray(payload?.citations) ? payload.citations : [],
      };
      wrapper.appendChild(renderExploreMarkdown(String(payload?.content || ""), batchMessage, {}));
      return wrapper;
    }
    const chatID = String(payload?.chat_id || "").trim();
    const batches = Array.isArray(payload?.batches) ? payload.batches : [];
    const meta = createNode("div", {
      className: "sr-workspace-message-text",
      textContent: [
        String(payload?.scope_name || "").trim() ? `Scope: ${String(payload.scope_name || "").trim()}` : "",
        Number(payload?.row_count || 0) ? `Rows: ${Number(payload.row_count || 0)}` : "",
        Number(payload?.batch_count || 0) ? `Batches: ${Number(payload.batch_count || 0)}` : "",
      ].filter(Boolean).join(" | "),
    });
    wrapper.appendChild(meta);
    if (batches.length) {
      const batchList = createNode("div", {
        className: "sr-workspace-message-text",
      });
      batches.forEach((batch) => {
        const batchIndex = Number(batch?.batch_index || 0) || 0;
        const detailsKey = `explore-batch-open:${chatID}:${batchIndex}`;
        const details = createNode("details", {
          className: "sr-workspace-message-details",
        });
        details.open = !!state.chatDetailState.get(detailsKey);
        details.addEventListener("toggle", async () => {
          state.chatDetailState.set(detailsKey, !!details.open);
          if (!details.open || !chatID) {
            return;
          }
          try {
            await ensureExploreBatchLoaded(chatID, batchIndex);
            renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
          }
          catch (error) {
            setStatus(error?.message || String(error), "error");
          }
        });
        const summary = createNode("summary", {
          className: "sr-workspace-message-summary",
          textContent: `Batch ${batchIndex + 1}${Number(batch?.row_count || 0) ? ` (${Number(batch.row_count || 0)} rows)` : ""}`,
        });
        details.appendChild(summary);
        const cache = state.exploreBatchCache.get(exploreBatchCacheKey(chatID, batchIndex));
        if (details.open) {
          if (cache?.status === "ready") {
            details.appendChild(renderExploreMarkdown(String(cache.value?.content || ""), {
              citations: Array.isArray(cache.value?.citations) ? cache.value.citations : [],
            }, {}));
          }
          else if (cache?.status === "error") {
            details.appendChild(createNode("div", {
              className: "sr-workspace-message-details-body sr-workspace-message-text",
              textContent: String(cache.error || "Could not load batch."),
            }));
          }
          else {
            details.appendChild(createNode("div", {
              className: "sr-workspace-message-details-body sr-workspace-message-text",
              textContent: "Loading batch...",
            }));
          }
        }
        batchList.appendChild(details);
      });
      wrapper.appendChild(batchList);
    }
	    return wrapper;
	  }

	  function promptPreviewTextarea(text = "") {
	    const textarea = createNode("textarea", {
	      className: "sr-model-input-preview-text",
	      attrs: {
	        readonly: "readonly",
	        spellcheck: "false",
	      },
	    });
	    textarea.value = String(text || "");
	    return textarea;
	  }

	  function promptPreviewSection(label = "", text = "", options = {}) {
	    const value = String(text || "").trim();
	    if (!value) {
	      return null;
	    }
	    const details = createNode("details", {
	      className: "sr-model-input-preview-section",
	    });
	    details.open = options.open !== false;
	    details.appendChild(createNode("summary", {
	      className: "sr-model-input-preview-section-summary",
	      textContent: label,
	    }));
	    details.appendChild(promptPreviewTextarea(value));
	    return details;
	  }

	  function renderModelInputPreviewMessage(message = {}) {
	    if (String(message?.event_type || "").trim() !== "model_input_preview") {
	      return null;
	    }
	    const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
	    const budget = payload?.chat_budget && typeof payload.chat_budget === "object" ? payload.chat_budget : {};
	    const step = Number(payload?.step || 0) || 0;
	    const estimated = Number(budget.estimated_input_tokens || budget.used_input_tokens || 0) || 0;
	    const target = Number(budget.target_input_budget_tokens || 0) || 0;
	    const inputBudget = Number(budget.input_budget_tokens || 0) || 0;
	    const over = Math.max(0, Number(budget.over_budget_tokens || 0) || (target && estimated > target ? estimated - target : 0));
	    const stateful = !!payload.stateful;
	    const wrapper = createNode("div", {
	      className: "sr-workspace-message sr-workspace-message-event sr-workspace-message-model-input",
	    });
	    const detailsKey = chatMessageKey(message);
	    const details = createNode("details", {
	      className: "sr-workspace-message-details sr-model-input-preview",
	      attrs: {
	        "data-chat-message-key": detailsKey,
	      },
	    });
	    details.open = state.chatDetailState.has(detailsKey) ? !!state.chatDetailState.get(detailsKey) : true;
	    details.addEventListener("toggle", () => {
	      state.chatDetailState.set(detailsKey, !!details.open);
	    });
	    details.appendChild(createNode("summary", {
	      className: "sr-workspace-message-summary sr-model-input-preview-summary",
	      textContent: [
	        `Model input${step ? ` step ${step}` : ""}`,
	        stateful ? "stateful" : "stateless",
	        target ? `${formatCompactTokens(estimated)} / ${formatCompactTokens(target)} target` : `${formatCompactTokens(estimated)} tokens`,
	        over ? `${formatCompactTokens(over)} over` : "",
	      ].filter(Boolean).join(" | "),
	    }));
	    details.appendChild(createNode("div", {
	      className: "sr-model-input-preview-meta",
	      textContent: [
	        String(payload?.model || "").trim() ? `Model: ${String(payload.model || "").trim()}` : "",
	        inputBudget ? `Input budget: ${formatCompactTokens(inputBudget)}` : "",
	        target ? `Send target: ${formatCompactTokens(target)}` : "",
	        `System + active memory: ${formatCompactTokens(budget.head_tokens || 0)}`,
	        `Tool schemas: ${formatCompactTokens(budget.tool_schema_tokens || 0)}`,
	        `Selected history: ${formatCompactTokens(Math.max(0, estimated - (Number(budget.head_tokens || 0) || 0) - (Number(budget.tool_schema_tokens || 0) || 0) - (Number(budget.truncation_notice_tokens || 0) || 0)))}`,
	        `Omitted entries: ${Number(budget.omitted_count || 0) || 0}`,
	      ].filter(Boolean).join(" | "),
	    }));
	    const sections = [
	      promptPreviewSection(
	        stateful ? "Actual model input payload" : "Actual serialized prompt sent as input",
	        String(payload?.input_text || payload?.prompt_text || ""),
	        { open: true }
	      ),
	      promptPreviewSection("System instructions plus active memory", String(payload?.head_text || payload?.instructions_text || ""), { open: false }),
	      promptPreviewSection("Injected active memory only", String(payload?.active_memory_text || ""), { open: false }),
	      promptPreviewSection("Advertised tool schemas", String(payload?.tool_schema_text || ""), { open: false }),
	    ].filter(Boolean);
	    if (sections.length) {
	      details.appendChild(createNode("div", {
	        className: "sr-model-input-preview-sections",
	        children: sections,
	      }));
	    }
	    wrapper.appendChild(details);
	    return wrapper;
	  }

	  function renderAutodriveMessage(message = {}) {
    const eventType = String(message?.event_type || "").trim();
    if (!["autodrive_prompt", "autodrive_reviewer"].includes(eventType)) {
      return null;
    }
    const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
    const isReviewer = eventType === "autodrive_reviewer";
    const wrapper = createNode("div", {
      className: `sr-workspace-message sr-workspace-message-event sr-workspace-message-autodrive${isReviewer ? " sr-workspace-message-autodrive-reviewer" : ""}`,
    });
    const turnIndex = Number(payload?.turn_index || 0) || 0;
    const totalTurns = Number(payload?.total_turns || 0) || 0;
    wrapper.appendChild(createNode("div", {
      className: "sr-workspace-message-title",
      textContent: cleanDisplayText(String(message?.title || (isReviewer ? "Auto Drive Reviewer" : "Auto Drive")).trim()),
    }));
    if (isReviewer) {
      const decision = String(payload?.decision || "").trim();
      const summary = String(payload?.summary || message?.content || "").trim();
      const nextPrompt = String(payload?.next_prompt || "").trim();
      wrapper.appendChild(createNode("div", {
        className: "sr-chat-find-meta",
        textContent: [
          decision ? `Decision: ${decision}` : "",
          turnIndex && totalTurns ? `Turn ${turnIndex}/${totalTurns}` : "",
        ].filter(Boolean).join(" | ") || "Reviewer check",
      }));
      if (summary) {
        wrapper.appendChild(createNode("div", {
          className: "sr-workspace-message-text",
          textContent: summary,
        }));
      }
      if (nextPrompt) {
        wrapper.appendChild(createNode("div", {
          className: "sr-chat-find-breadcrumb",
          textContent: `Next: ${nextPrompt}`,
        }));
      }
      return wrapper;
    }
    wrapper.appendChild(createNode("div", {
      className: "sr-chat-find-meta",
      textContent: [
        turnIndex && totalTurns ? `Turn ${turnIndex}/${totalTurns}` : "",
        payload?.reviewer_mode_label ? `Reviewer: ${String(payload.reviewer_mode_label || "").trim()}` : "",
      ].filter(Boolean).join(" | ") || "Auto Drive prompt sent",
    }));
    const preview = String(payload?.prompt_preview || "").trim();
    if (preview) {
      const details = createNode("details", { className: "sr-workspace-message-details" });
      details.appendChild(createNode("summary", {
        className: "sr-workspace-message-summary",
        textContent: "Prompt preview",
      }));
      details.appendChild(createNode("div", {
        className: "sr-workspace-message-details-body sr-workspace-message-text",
        textContent: preview,
      }));
      wrapper.appendChild(details);
    }
    return wrapper;
  }

  function renderDocumentsFindMessage(message = {}) {
    const eventType = String(message?.event_type || "").trim();
    if (eventType !== "documents_find") {
      return null;
    }
    const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const searchID = String(payload?.search_id || "").trim();
    const wrapper = createNode("div", {
      className: "sr-workspace-message sr-workspace-message-event sr-workspace-message-explore sr-workspace-message-documents",
    });
    wrapper.appendChild(createNode("div", {
      className: "sr-workspace-message-title",
      textContent: cleanDisplayText(String(message?.title || "Find Arguments").trim()),
    }));
    const query = String(payload?.query || "").trim();
    const metaParts = [
      String(payload?.mode || "").trim() ? `Mode: ${String(payload.mode || "").trim()}` : "",
      query ? `Query: ${query}` : "",
      payload?.scope?.collection_name ? `Scope: ${String(payload.scope.collection_name || "").trim()}` : "",
      String(payload?.keyword_backend || "").trim() ? `Keyword: ${String(payload.keyword_backend || "").trim()}` : "",
      Number(payload?.total_documents || 0) ? `${Number(payload.total_documents || 0)} document${Number(payload.total_documents || 0) === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    wrapper.appendChild(createNode("div", {
      className: "sr-chat-find-meta",
      textContent: metaParts.join(" | ") || "Find Arguments results",
    }));
    if (!results.length) {
      wrapper.appendChild(createNode("div", {
        className: "sr-workspace-message-text",
        textContent: String(message?.content || "No matching full-text chunks were found.").trim(),
      }));
      return wrapper;
    }
    const resultList = createNode("div", { className: "sr-chat-find-results" });
    let cardIndex = 0;
    results.forEach((doc) => {
      const itemKey = String(doc?.item_key || "").trim();
      const citation = String(doc?.citation_token || (itemKey ? `@[${itemKey}]` : "")).trim();
      (Array.isArray(doc?.chunks) ? doc.chunks : []).forEach((chunk, chunkIndex) => {
        const crumb = [
          String(chunk?.relative_path || chunk?.markdown_path || "").trim(),
          String(chunk?.page_label || "").trim(),
          Array.isArray(chunk?.heading_path) && chunk.heading_path.length
            ? chunk.heading_path.map((part) => String(part || "").trim()).filter(Boolean).join(" > ")
            : String(chunk?.section_label || "").trim(),
        ].filter(Boolean).join(" | ");
        cardIndex += 1;
        const card = createNode("div", { className: "sr-chat-find-card" });
        card.appendChild(createNode("div", {
          className: "sr-chat-find-title",
          textContent: `${cardIndex}. ${citation || "Chunk"}`.trim(),
        }));
        const chunkNode = createNode("div", { className: "sr-chat-find-chunk" });
        chunkNode.appendChild(createNode("div", {
          className: "sr-workspace-message-text",
          textContent: String(chunk?.excerpt || chunk?.snippet || "").trim(),
        }));
        if (crumb) {
          chunkNode.appendChild(createNode("div", {
            className: "sr-chat-find-breadcrumb",
            textContent: crumb,
          }));
        }
        const actions = createNode("div", { className: "sr-chat-find-actions" });
        const openBtn = createButton("Open", "sr-workspace-btn sr-chat-queue-btn", { type: "button" });
        openBtn.addEventListener("click", async () => {
          try {
            await ctx.invoke("documents.hit.open", {
              search_id: searchID,
              item_key: itemKey,
              attachment_key: String(chunk?.attachment_key || "").trim(),
              chunk_index: Number(chunk?.chunk_index ?? chunkIndex) || 0,
              chunk_id: String(chunk?.chunk_id || "").trim(),
              page_label: String(chunk?.page_label || "").trim(),
              search_query: query,
              highlight_text: String(chunk?.highlight_text || chunk?.excerpt || "").trim(),
            });
            setStatus("Opened Find Arguments hit.", "ready");
          }
          catch (error) {
            setStatus(error?.message || String(error), "error");
          }
        });
        actions.appendChild(openBtn);
        const copyBtn = createButton("Copy", "sr-workspace-btn sr-chat-queue-btn", { type: "button" });
        copyBtn.addEventListener("click", async () => {
          const text = [
            citation,
            String(chunk?.excerpt || chunk?.snippet || "").trim(),
            crumb,
          ].filter(Boolean).join("\n");
          try {
            await writeClipboardText(text);
            setStatus("Find Arguments excerpt copied.", "ready");
          }
          catch (error) {
            setStatus(error?.message || String(error), "error");
          }
        });
        actions.appendChild(copyBtn);
        chunkNode.appendChild(actions);
        const longExcerpt = String(chunk?.long_excerpt || "").trim();
        if (longExcerpt && longExcerpt !== String(chunk?.excerpt || "").trim()) {
          const detailsKey = `documents-find:${searchID}:${itemKey}:${String(chunk?.chunk_index ?? chunkIndex)}`;
          const details = createNode("details", { className: "sr-workspace-message-details" });
          details.open = !!state.chatDetailState.get(detailsKey);
          details.addEventListener("toggle", () => {
            state.chatDetailState.set(detailsKey, !!details.open);
          });
          details.appendChild(createNode("summary", {
            className: "sr-workspace-message-summary",
            textContent: "Longer excerpt",
          }));
          details.appendChild(createNode("div", {
            className: "sr-workspace-message-details-body sr-workspace-message-text",
            textContent: longExcerpt,
          }));
          chunkNode.appendChild(details);
        }
        card.appendChild(chunkNode);
        resultList.appendChild(card);
      });
    });
    wrapper.appendChild(resultList);
    if (payload?.has_more && searchID) {
      const loadMore = createButton("Load more", "sr-workspace-btn sr-workspace-btn-primary", { type: "button" });
      loadMore.addEventListener("click", async () => {
        try {
          loadMore.disabled = true;
          setStatus("Loading more Find Arguments results...", "ready");
          await ctx.invoke("documents.find_next", {
            search_id: searchID,
            limit: 5,
            session_id: sessionSelect.value,
          });
          await refreshBootstrap();
          setStatus("Loaded more Find Arguments results.", "ready");
        }
        catch (error) {
          loadMore.disabled = false;
          setStatus(error?.message || String(error), "error");
        }
      });
      wrapper.appendChild(createNode("div", {
        className: "sr-chat-find-actions",
        children: [loadMore],
      }));
    }
    return wrapper;
  }

  function renderChat(messages = []) {
    const previousScrollTop = Number(chatMessages.scrollTop || 0) || 0;
    const shouldAutoFollow = !state.chatAutoFollowLocked;
    chatMessages.replaceChildren();
	    const source = Array.isArray(messages) && messages.length
	      ? messages
	      : [{
	          role: "assistant",
	          content: "Continue the collection session here, use /Autodrive for managed continuation, /find for document arguments, /explore for scoped synthesis, /memory to rebuild active memory, or /status for project state.",
	          placeholder: true,
	          event_type: "assistant_question",
	        }];
    const list = renderedChatMessages(source, state);
    for (const message of list) {
	      const customNode = renderModelInputPreviewMessage(message) || renderAutodriveMessage(message) || renderDocumentsFindMessage(message) || renderExploreChatMessage(message);
      if (customNode) {
        chatMessages.appendChild(customNode);
        continue;
      }
      const role = String(message?.role || "assistant").trim() || "assistant";
      const eventType = String(message?.event_type || "");
      const placeholder = !!message?.placeholder;
      const reviewerMirror = isAutodriveReviewerMirror(message);
      const isLiveReasoning =
        eventType === "responses_reasoning"
        && !!String(message?._live_key || "").trim();
      const className = [
        "sr-workspace-message",
        isPlainAssistantMessage(message) ? "sr-workspace-message-assistant" : "",
        isStatusLineMessage(message) ? "sr-workspace-message-status" : "",
        messageUsesDetails(message) ? "sr-workspace-message-event" : "",
        role === "user" && !reviewerMirror ? "sr-workspace-message-user" : "",
        role === "system" ? "sr-workspace-message-system" : "",
        role === "tool" ? "sr-workspace-message-tool" : "",
        reviewerMirror ? "sr-workspace-message-autodrive-reviewer" : "",
        ["thinking", "responses_reasoning"].includes(eventType) ? "sr-workspace-message-thinking" : "",
        eventType === "assistant_stream_status" ? "sr-workspace-message-live-plan" : "",
        isLiveReasoning ? "sr-workspace-message-live-reasoning" : "",
        ["tool_call_pending", "tool_waiting", "assistant_resume"].includes(eventType) ? "sr-workspace-message-live-status" : "",
        eventType === "assistant_live" ? "sr-workspace-message-live-output" : "",
        placeholder ? "sr-workspace-message-placeholder" : "",
      ].filter(Boolean).join(" ");
      const wrapper = createNode("div", { className });
      const roleText = messageRoleLabel(message);
      const titleText = messageTitleText(message);
      const bodyText = messageBodyText(message);
      if (isLiveReasoning) {
        wrapper.appendChild(createNode("div", {
          className: "sr-workspace-message-title",
          textContent: titleText || roleText,
        }));
        wrapper.appendChild(createNode("div", {
          className: "sr-workspace-message-text",
          textContent: bodyText || "Reasoning...",
        }));
      }
      else if (messageUsesDetails(message)) {
        const messageKey = chatMessageKey(message);
        const details = createNode("details", {
          className: "sr-workspace-message-details",
          attrs: {
            "data-chat-message-key": messageKey,
          },
          children: [
            createNode("summary", {
              className: "sr-workspace-message-summary",
              textContent: titleText || roleText,
            }),
            createNode("div", {
              className: "sr-workspace-message-details-body sr-workspace-message-text",
              textContent: bodyText,
            }),
          ],
        });
        const rememberedOpen = state.chatDetailState.has(messageKey)
          ? !!state.chatDetailState.get(messageKey)
          : null;
        const autoOpenCurrentRunEntry =
          rememberedOpen === null
          && !!String(message?._live_key || "").trim();
        details.open = rememberedOpen === null ? !!autoOpenCurrentRunEntry : rememberedOpen;
        details.addEventListener("toggle", () => {
          state.chatDetailState.set(messageKey, !!details.open);
        });
        wrapper.appendChild(details);
      }
      else {
        if (!isUserMessage(message) && !isPlainAssistantMessage(message) && titleText && titleText !== roleText) {
          wrapper.appendChild(createNode("div", {
            className: "sr-workspace-message-title",
            textContent: titleText,
          }));
        }
        if (hasMarkdownTable(bodyText)) {
          const markdown = renderExploreMarkdown(bodyText, message, {});
          markdown.classList.add("sr-workspace-message-markdown");
          wrapper.appendChild(markdown);
        }
        else {
          wrapper.appendChild(createNode("div", {
            className: "sr-workspace-message-text",
            textContent: bodyText,
          }));
        }
      }
      chatMessages.appendChild(wrapper);
    }
    if (shouldAutoFollow) {
      scrollChatToBottom();
    }
    else {
      restoreChatScrollTop(previousScrollTop);
    }
    renderChatBudget();
  }

  function closeCommandMenu() {
    state.commandMenu = { open: false, items: [], selectedIndex: 0, token: "" };
    chatCommandMenu.hidden = true;
    chatCommandMenu.replaceChildren();
  }

  function renderCommandMenu() {
    const menuState = state.commandMenu || {};
    if (!menuState.open || !Array.isArray(menuState.items) || !menuState.items.length) {
      closeCommandMenu();
      return;
    }
    chatCommandMenu.replaceChildren(
      ...menuState.items.map((entry, index) => {
        const button = createNode("button", {
          className: `sr-chat-command-item${index === menuState.selectedIndex ? " active" : ""}`,
          attrs: {
            type: "button",
            "data-command": entry.command,
          },
          children: [
            createNode("div", { className: "sr-chat-command-title", textContent: entry.command }),
            createNode("div", { className: "sr-chat-command-description", textContent: entry.description || entry.label || "" }),
          ],
        });
        button.addEventListener("click", () => {
          insertSlashCommand(entry.command);
        });
        return button;
      })
    );
    chatCommandMenu.hidden = false;
  }

  function currentSlashToken() {
    const value = String(chatInput.value || "");
    const caret = Number(chatInput.selectionStart ?? value.length);
    const before = value.slice(0, caret);
    const currentLine = before.split("\n").pop() || "";
    if (!currentLine.startsWith("/") || /\s/.test(currentLine.slice(1))) {
      return "";
    }
    return currentLine;
  }

  function updateCommandMenu() {
    const token = currentSlashToken();
    if (!token) {
      closeCommandMenu();
      return;
    }
    const query = token.toLowerCase();
    const items = (Array.isArray(state.localCommands) ? state.localCommands : [])
      .filter((entry) => String(entry?.command || "").toLowerCase().startsWith(query))
      .slice(0, 8);
    if (!items.length) {
      closeCommandMenu();
      return;
    }
    state.commandMenu = {
      open: true,
      items,
      selectedIndex: Math.min(state.commandMenu.selectedIndex || 0, items.length - 1),
      token,
    };
    renderCommandMenu();
  }

  function insertSlashCommand(command) {
    const cleanCommand = String(command || "").trim();
    const insertedCommand = ["/find", "/explore"].includes(cleanCommand.toLowerCase()) ? `${cleanCommand} ` : cleanCommand;
    const value = String(chatInput.value || "");
    const caret = Number(chatInput.selectionStart ?? value.length);
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const lineStart = before.lastIndexOf("\n") + 1;
    const currentLine = before.slice(lineStart);
    if (!currentLine.startsWith("/")) {
      return;
    }
    const nextBefore = `${before.slice(0, lineStart)}${insertedCommand}`;
    chatInput.value = `${nextBefore}${after}`;
    const nextCaret = nextBefore.length;
    chatInput.focus();
    chatInput.setSelectionRange(nextCaret, nextCaret);
    closeCommandMenu();
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
  }

  function setChatRun(nextRun = null) {
    let startingRun = nextRun && String(nextRun?.status || "").trim() === "running"
      && String(state.chatRun?.status || "").trim() !== "running";
    state.chatRun = nextRun ? { ...nextRun } : null;
    if (state.chatRun) {
      state.chatRun.sequenceBase = Number(state.chatRun.sequence_base || state.chatRun.sequenceBase || 0) || 0;
      state.chatRun.runID = state.chatRun.run_id || state.chatRun.runID || "";
      state.chatRun.startedAtMs = Date.parse(state.chatRun.started_at || "") || Date.now();
      state.chatRun.elapsedMs = Number(state.chatRun.elapsed_ms || 0) || Math.max(0, Date.now() - state.chatRun.startedAtMs);
    }
    updateChatRunStatus();
    renderChatBudget();
    if (startingRun) {
      state.chatAutoFollowLocked = false;
      state.runReportBaselineHash = state.lastRenderedReportHash;
    }
    if (state.chatRun?.status === "running") {
      state.previewModeLocked = true;
      stopBtn.hidden = false;
      stopBtn.disabled = false;
      sendBtn.disabled = false;
      sessionSelect.disabled = true;
      newSessionBtn.disabled = true;
      chatModelBtn.disabled = true;
      chatReasoningSelect.disabled = true;
      chatReasoningCustomInput.disabled = true;
      chatInput.disabled = false;
      closeChatPopover();
      updateModeControlAvailability();
      startChatClock();
      return;
    }
    state.previewModeLocked = false;
    state.runReportBaselineHash = "";
    clearChatClockTimer();
    stopBtn.hidden = true;
    stopBtn.disabled = true;
    sendBtn.disabled = false;
    sessionSelect.disabled = false;
    newSessionBtn.disabled = false;
    updateModeControlAvailability();
    updateChatModelControls();
  }

  async function pollChatRun(runID = "") {
    clearChatPollTimer();
    if (!runID || state.destroyed) {
      return;
    }
    try {
      let completionTone = "";
      let completionMessage = "";
      const result = await ctx.invoke("automation.chat.poll", {
        run_id: runID,
        session_id: sessionSelect.value,
      });
      if (state.destroyed || !state.chatRun || (state.chatRun.runID || state.chatRun.run_id) !== runID) {
        return;
      }
      if (state.bootstrap?.current_project) {
        state.bootstrap.current_project.active_session_id = result?.active_session_id || state.bootstrap.current_project.active_session_id;
      }
      applyChatSnapshot(result || {});
      if (result?.run) {
        setChatRun(result.run);
      }
      if (result?.run?.status === "running") {
        state.chatPollTimer = window.setTimeout(() => {
          pollChatRun(runID).catch((error) => setStatus(error?.message || String(error), "error"));
        }, 350);
        return;
      }
      state.optimisticUserMessage = null;
      if (result?.run?.status === "complete") {
        const durationLabel = formatElapsedTime(result.run.elapsed_ms || 0);
        state.lastCompletedRun = {
          runID,
          sequenceBase: Number(result.run.sequence_base || 0) || 0,
          durationLabel,
        };
        completionTone = "ready";
        completionMessage = String(result?.run?.kind || "") === "autodrive"
          ? (String(result?.run?.autodrive?.status_message || "").trim() || "Auto Drive finished")
          : "Session updated";
      }
      else if (result?.run?.status === "canceled") {
        completionTone = "ready";
        completionMessage = String(result?.run?.kind || "") === "autodrive" ? "Auto Drive stopped" : "Session stopped";
      }
      else if (result?.run?.status === "error") {
        state.lastCompletedRun = {
          runID,
          sequenceBase: Number(result.run.sequence_base || 0) || 0,
          durationLabel: formatElapsedTime(result.run.elapsed_ms || 0),
        };
        completionTone = "error";
        completionMessage = result.run.error || "Session run failed";
      }
      setChatRun(result?.run || null);
      if (state.mode === "preview") {
        await refreshPreviewFromDisk({ force: true }).catch((error) => setStatus(error?.message || String(error), "error"));
      }
      let startedQueuedRun = false;
      if (result?.run?.status === "complete" && (!state.chatRun?.status || state.chatRun.status !== "running")) {
        startedQueuedRun = await processNextQueuedMessage({ mode: "queued" });
      }
      if (completionMessage && !startedQueuedRun) {
        setStatus(completionMessage, completionTone);
      }
    }
    catch (error) {
      setChatRun(null);
      state.optimisticUserMessage = null;
      setStatus(error?.message || String(error), "error");
    }
  }

  async function beginChatRun(message, options = {}) {
	    await prepareDocumentForChatRun();
	    state.lastCompletedRun = null;
	    clearLiveChatTransientState();
	    clearPromptPreviewRows();
	    closeChatPopover();
    state.optimisticUserMessage = {
      role: "user",
      content: message,
      event_type: "user_message",
      sequence_no: Number(state.chatRun?.sequenceBase || 0) + 1,
      local: true,
    };
    renderChat(Array.isArray(state.bootstrap?.chat_history) ? state.bootstrap.chat_history : []);
    const result = await ctx.invoke("automation.chat.begin", {
      message,
      session_id: sessionSelect.value,
      explore_scope_key: String(options?.explore_scope_key || options?.exploreScopeKey || "").trim(),
    });
    applyChatSnapshot(result || {});
    if (result?.run) {
      setChatRun(result.run);
      setStatus("Running session...", "");
      pollChatRun(result.run.run_id).catch((error) => setStatus(error?.message || String(error), "error"));
    }
  }

  async function queueChatMessage(message, mode = "queued", payload = null) {
    const result = await ctx.invoke("automation.chat.queue.add", {
      session_id: sessionSelect.value,
      message,
      mode,
      payload: payload && typeof payload === "object" ? payload : null,
    });
    applyChatSnapshot(result || {});
    return result?.queue_message || null;
  }

  async function processNextQueuedMessage(options = {}) {
    if (state.destroyed || state.chatRun?.status === "running") {
      return false;
    }
    const mode = String(options?.mode || "queued").trim() || "queued";
    const result = await ctx.invoke("automation.chat.queue.consume_next", {
      session_id: sessionSelect.value,
      mode,
    });
    applyChatSnapshot(result || {});
    const next = result?.queue_message || null;
    if (!next?.content) {
      return false;
    }
    try {
      await beginChatStream(String(next.content || ""), next?.payload || {});
      return true;
    }
    catch (error) {
      await ctx.invoke("automation.chat.queue.add", {
        session_id: sessionSelect.value,
        message: String(next.content || ""),
        mode: String(next.mode || "queued"),
        payload: next?.payload && typeof next.payload === "object" ? next.payload : null,
      }).catch(() => {});
      await refreshBootstrap().catch(() => {});
      throw error;
    }
  }

  function setActiveEditable(editable) {
    state.activeEditable = editable || state.activeEditable || null;
    state.nativeActiveEditable = editable || state.nativeActiveEditable || null;
    return editable || null;
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

  async function readClipboardText() {
    try {
      return String(await navigator.clipboard.readText() || "");
    }
    catch (_error) {
      return "";
    }
  }

  function isMacBackwardDeleteKey(event) {
    return /mac/i.test(String(navigator?.platform || ""))
      && event?.key === "Delete"
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey;
  }

  function activePageBody() {
    return state.nativeActiveEditable?.closest?.(".sr-page-editor-body")
      || nativeEditor.querySelector(".sr-page-editor-body")
      || null;
  }

  function activePageSheet() {
    return activePageBody()?.closest?.(".sr-editor-section, .sr-page-sheet")
      || nativeEditor.querySelector(".sr-editor-section, .sr-page-sheet")
      || null;
  }

  function selectionBoundaryEditableFromRange(range, edge = "start") {
    if (!range) {
      return null;
    }
    const node = edge === "end" ? range.endContainer : range.startContainer;
    return node?.nodeType === 3
      ? node.parentNode?.closest?.("[data-sr-editable='true']") || node.parentNode
      : node?.closest?.("[data-sr-editable='true']") || null;
  }

  function rangeBoundaryIsInsideEditor(range, root = nativeEditor) {
    if (!range || !root) {
      return false;
    }
    const startNode = range.startContainer?.nodeType === 3
      ? range.startContainer.parentNode
      : range.startContainer;
    const endNode = range.endContainer?.nodeType === 3
      ? range.endContainer.parentNode
      : range.endContainer;
    return !!(
      startNode?.isConnected
      && endNode?.isConnected
      && root.contains(startNode)
      && root.contains(endNode)
    );
  }

  function textOffsetWithinEditable(editable, container, offset) {
    if (!editable || !container) {
      return null;
    }
    try {
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.setEnd(container, offset);
      return Math.max(0, String(range.toString() || "").length);
    }
    catch (_error) {
      return null;
    }
  }

  function textOffsetsForRange(editable, range) {
    if (!editable || !range) {
      return null;
    }
    const startEditable = selectionBoundaryEditableFromRange(range, "start");
    const endEditable = selectionBoundaryEditableFromRange(range, "end");
    if (startEditable !== editable || endEditable !== editable) {
      return null;
    }
    const start = textOffsetWithinEditable(editable, range.startContainer, range.startOffset);
    const end = textOffsetWithinEditable(editable, range.endContainer, range.endOffset);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
    return {
      start: Math.max(0, start),
      end: Math.max(0, end),
    };
  }

  function rangeBoundaryFromTextOffset(editable, requestedOffset) {
    const targetOffset = Math.max(0, Number(requestedOffset || 0) || 0);
    if (!editable) {
      return null;
    }
    try {
      const walker = document.createTreeWalker(editable, 4, null);
      let seen = 0;
      let lastText = null;
      let node = walker.nextNode();
      while (node) {
        lastText = node;
        const length = String(node.nodeValue || "").length;
        if (targetOffset <= seen + length) {
          return {
            node,
            offset: Math.max(0, Math.min(length, targetOffset - seen)),
          };
        }
        seen += length;
        node = walker.nextNode();
      }
      if (lastText) {
        return {
          node: lastText,
          offset: String(lastText.nodeValue || "").length,
        };
      }
      return {
        node: editable,
        offset: Math.max(0, editable.childNodes?.length || 0),
      };
    }
    catch (_error) {
      return null;
    }
  }

  function rangeFromSelectionOffsets(selectionState) {
    if (!selectionState?.editable?.isConnected) {
      return null;
    }
    if (selectionState.textStartOffset === null || selectionState.textEndOffset === null) {
      return null;
    }
    const start = Number(selectionState.textStartOffset);
    const end = Number(selectionState.textEndOffset);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
    const startBoundary = rangeBoundaryFromTextOffset(selectionState.editable, start);
    const endBoundary = rangeBoundaryFromTextOffset(selectionState.editable, Math.max(start, end));
    if (!startBoundary || !endBoundary) {
      return null;
    }
    try {
      const range = document.createRange();
      range.setStart(startBoundary.node, startBoundary.offset);
      range.setEnd(endBoundary.node, endBoundary.offset);
      return range;
    }
    catch (_error) {
      return null;
    }
  }

  function citationBoundaryRange(citationNode, side = "after") {
    const target = citationNode?.closest?.(".sr-citation-chip");
    if (!target?.isConnected) {
      return null;
    }
    try {
      const range = document.createRange();
      if (String(side || "after") === "before") {
        range.setStartBefore(target);
      }
      else {
        range.setStartAfter(target);
      }
      range.collapse(true);
      return range;
    }
    catch (_error) {
      return null;
    }
  }

  function citationSideFromPointerEvent(chip, event) {
    if (!chip || !event) {
      return "after";
    }
    try {
      const rect = chip.getBoundingClientRect();
      const midpoint = rect.left + (rect.width / 2);
      return Number(event.clientX) <= midpoint ? "before" : "after";
    }
    catch (_error) {
      return "after";
    }
  }

  function captureEditorSelectionState(target) {
    let editable = target?.closest?.("[data-sr-editable='true']") || state.nativeActiveEditable || null;
    const citationNode = target?.closest?.(".sr-citation-chip") || null;
    const sectionMarker = target?.closest?.(".sr-section-separator") || null;
    const next = {
      target: target || null,
      editable,
      citationNode,
      sectionMarker,
      citationSide: state.pendingCitationCaret?.node === citationNode
        ? String(state.pendingCitationCaret?.side || "after")
        : null,
      tocBlock: target?.closest?.("[data-block-type='toc']") || null,
      bibliographyBlock: target?.closest?.("[data-block-type='bibliography']") || null,
      prismaBlock: target?.closest?.("[data-block-type='prisma']") || null,
      codeBlock: target?.closest?.(".sr-block-code[data-sr-code-root='true'], .sr-native-block[data-block-type='code']") || null,
      imageBlock: target?.closest?.("[data-block-type='image']") || null,
      tableCell: target?.closest?.(".sr-native-table-cell, td, th") || null,
      pageSheet: target?.closest?.(".sr-editor-section, .sr-page-sheet") || activePageSheet(),
      range: null,
      textareaStart: null,
      textareaEnd: null,
      textStartOffset: null,
      textEndOffset: null,
    };
    if (editable?.tagName?.toLowerCase() === "textarea") {
      next.textareaStart = editable.selectionStart ?? 0;
      next.textareaEnd = editable.selectionEnd ?? next.textareaStart;
      return next;
    }
    try {
      const selection = document.defaultView.getSelection();
      if (!selection || !selection.rangeCount) {
        return next;
      }
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer?.nodeType === 3
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
      if (nativeEditor.contains(container)) {
        next.range = range.cloneRange();
        const startEditable = selectionBoundaryEditableFromRange(range, "start");
        const endEditable = selectionBoundaryEditableFromRange(range, "end");
        if (!editable || (startEditable && editable !== startEditable && editable !== endEditable)) {
          next.editable = startEditable || endEditable || editable;
        }
        const offsets = textOffsetsForRange(next.editable, range);
        if (offsets) {
          next.textStartOffset = offsets.start;
          next.textEndOffset = offsets.end;
        }
      }
    }
    catch (_error) {}
    return next;
  }

  function restoreEditorSelectionState(selectionState) {
    if (!selectionState) {
      return;
    }
    if (selectionState.editable) {
      setActiveEditable(selectionState.editable);
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      selectionState.editable.focus();
      if (selectionState.textareaStart !== null && selectionState.textareaEnd !== null) {
        selectionState.editable.setSelectionRange(selectionState.textareaStart, selectionState.textareaEnd);
      }
      return;
    }
    try {
      const selection = document.defaultView.getSelection();
      if (!selection) {
        return;
      }
      selectionState.editable?.focus?.();
      selection.removeAllRanges();
      const range = citationBoundaryRange(selectionState.citationNode, selectionState.citationSide || "after")
        || rangeFromSelectionOffsets(selectionState)
        || (rangeBoundaryIsInsideEditor(selectionState.range) ? selectionState.range : null);
      if (range) {
        selection.addRange(range);
      }
    }
    catch (_error) {}
  }

  function editorHasSelection(selectionState) {
    if (!selectionState) {
      return false;
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      return (selectionState.textareaEnd ?? 0) > (selectionState.textareaStart ?? 0);
    }
    return !!(selectionState.range && !selectionState.range.collapsed);
  }

  function editorSelectionText(selectionState) {
    if (!selectionState) {
      return "";
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      const value = selectionState.editable.value || "";
      const start = selectionState.textareaStart ?? 0;
      const end = selectionState.textareaEnd ?? start;
      return value.slice(start, end);
    }
    if (selectionState.range && !selectionState.range.collapsed) {
      return String(selectionState.range.toString() || "");
    }
    if (selectionState.citationNode) {
      return selectionState.citationNode.getAttribute("data-sr-markdown") || selectionState.citationNode.textContent || "";
    }
    return "";
  }

  function isUsableEditorSelectionState(selectionState) {
    if (!selectionState) {
      return false;
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      return selectionState.editable.isConnected
        && selectionState.textareaStart !== null
        && selectionState.textareaEnd !== null;
    }
    if (!selectionState.editable?.isConnected || !nativeEditor.contains(selectionState.editable)) {
      return false;
    }
    if (selectionState.textStartOffset !== null
      && selectionState.textEndOffset !== null
      && Number.isFinite(Number(selectionState.textStartOffset))
      && Number.isFinite(Number(selectionState.textEndOffset))) {
      return true;
    }
    if (selectionState.range) {
      return rangeBoundaryIsInsideEditor(selectionState.range);
    }
    return !!selectionState.citationNode?.isConnected;
  }

  function currentInsertionState() {
    const focused = document.activeElement || null;
    if (!nativeEditor.contains(focused) && isUsableEditorSelectionState(state.lastSelectionState)) {
      return state.lastSelectionState;
    }
    const live = captureEditorSelectionState(
      focused || state.nativeActiveEditable || nativeEditor.querySelector(".sr-page-editor-body")
    );
    if (isUsableEditorSelectionState(live) && (live?.range || live?.citationNode || live?.textareaStart !== null)) {
      return live;
    }
    return isUsableEditorSelectionState(state.lastSelectionState) ? state.lastSelectionState : live;
  }

  function rememberDocumentInsertionState() {
    const next = currentInsertionState();
    if (isUsableEditorSelectionState(next)) {
      state.lastSelectionState = next;
    }
    return next;
  }

  function rememberLiveEditorSelection(target = null) {
    const next = captureEditorSelectionState(
      target || document.activeElement || state.nativeActiveEditable || nativeEditor
    );
    if (isUsableEditorSelectionState(next) && (next.range || next.citationNode || next.textareaStart !== null)) {
      state.lastSelectionState = next;
    }
    return next;
  }

  function isCodeTextarea(editable) {
    return editable?.tagName?.toLowerCase() === "textarea"
      && editable.getAttribute?.("data-sr-code") === "true";
  }

  function autosizeCodeTextarea(textarea) {
    if (!isCodeTextarea(textarea)) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(128, textarea.scrollHeight || 0)}px`;
  }

  function autosizeCodeTextareas(root = nativeEditor) {
    Array.from(root?.querySelectorAll?.("textarea[data-sr-code='true']") || []).forEach((textarea) => {
      autosizeCodeTextarea(textarea);
    });
  }

  function setEditableMarkdown(editable, markdownText) {
    if (!editable) {
      return;
    }
    if (editable.tagName?.toLowerCase() === "textarea") {
      editable.value = String(markdownText || "");
      autosizeCodeTextarea(editable);
      return;
    }
    const html = SystematicReviewerNativeMarkdown.renderInlineHTML(markdownText || "", {
      renderCitation: (citation) => citationChipHTML(citation),
      renderLink: ({ label, href }) => `<a href="${escapeHTML(href)}">${escapeHTML(label)}</a>`,
    });
    editable.innerHTML = html || "<br />";
  }

  function markNativeEditorDirty({ immediate = false } = {}) {
    state.nativeDirty = true;
    state.dirty = true;
    syncNativeMarkdownBufferFromEditor();
    state.renderedSignature.preview = "";
    saveBtn.classList.toggle("sr-workspace-btn-primary", true);
    scheduleGeneratedTOCRefresh();
    scheduleFindPanelRefresh({
      preserveIndex: true,
      delay: 80,
    });
    if (state.mode === "native" && immediate) {
      scheduleSurfaceReflow("native", {
        immediate: true,
        delay: 0,
      });
    }
  }

  function nativeMutationTargetIsEditable(node) {
    const target = node?.nodeType === 3 ? node.parentNode : node;
    if (!target || !nativeEditor.contains(target)) {
      return false;
    }
    if (target.closest?.(".sr-find-highlight-layer,[data-sr-editable='false'],.sr-block-static")) {
      return false;
    }
    return !!target.closest?.("[data-sr-editable='true']");
  }

  function nativeMutationNodeContainsEditable(node) {
    const target = node?.nodeType === 3 ? node.parentNode : node;
    if (!target || !nativeEditor.contains(target)) {
      return false;
    }
    if (target.closest?.(".sr-find-highlight-layer,[data-sr-editable='false'],.sr-block-static")) {
      return false;
    }
    return !!(target.closest?.("[data-sr-editable='true']") || target.querySelector?.("[data-sr-editable='true']"));
  }

  function nativeMutationTouchesEditable(mutation) {
    if (nativeMutationTargetIsEditable(mutation?.target)) {
      return true;
    }
    for (const node of Array.from(mutation?.addedNodes || [])) {
      if (nativeMutationNodeContainsEditable(node)) {
        return true;
      }
    }
    for (const node of Array.from(mutation?.removedNodes || [])) {
      if (nativeMutationNodeContainsEditable(node)) {
        return true;
      }
    }
    return false;
  }

  function reconnectNativeMutationObserver() {
    if (!state.nativeMutationObserver || state.destroyed) {
      return;
    }
    state.nativeMutationObserver.observe(nativeEditor, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function withNativeMutationObserverPaused(callback) {
    const observer = state.nativeMutationObserver;
    if (!observer) {
      return callback();
    }
    observer.disconnect();
    try {
      return callback();
    }
    finally {
      observer.takeRecords?.();
      reconnectNativeMutationObserver();
    }
  }

  function installNativeMutationObserver() {
    if (state.nativeMutationObserver || typeof MutationObserver !== "function") {
      return;
    }
    state.nativeMutationObserver = new MutationObserver((mutations) => {
      if (state.destroyed || state.reflowing || state.mode !== "native") {
        return;
      }
      if (!mutations.some(nativeMutationTouchesEditable)) {
        return;
      }
      markNativeEditorDirty();
    });
    reconnectNativeMutationObserver();
  }

  function refreshGeneratedTOCBlocks() {
    const tocBlocks = Array.from(nativeEditor.querySelectorAll("[data-block-type='toc']"));
    if (!tocBlocks.length) {
      return;
    }
    const blocks = SystematicReviewerNativeMarkdown.collectNativeEditorBlocks(nativeEditor);
    const outline = SystematicReviewerNativeMarkdown.buildDocumentOutline(blocks);
	  const html = SystematicReviewerNativeMarkdown.renderTOCBlockHTML(outline, { includePageNumbers: false });
	  tocBlocks.forEach((block, index) => {
	    if (index > 0) {
	      block.remove();
	      return;
      }
      const holder = block.querySelector(".sr-block-static, .sr-block-editable") || block;
	      holder.innerHTML = html;
	      holder.setAttribute("contenteditable", "false");
	      holder.setAttribute("data-sr-editable", "false");
	      holder.setAttribute("data-sr-markdown", String(SystematicReviewerNativeMarkdown.TOC_PLACEHOLDER_MARKDOWN || "<!-- sr:toc -->"));
	      SystematicReviewerNativeMarkdown.layoutRenderedTOCRows(holder);
	    });
	  }

	  function scheduleGeneratedTOCRefresh(delay = 80) {
    if (state.tocRefreshTimer) {
      window.clearTimeout(state.tocRefreshTimer);
      state.tocRefreshTimer = 0;
    }
    state.tocRefreshTimer = window.setTimeout(() => {
      state.tocRefreshTimer = 0;
      refreshGeneratedTOCBlocks();
    }, Math.max(0, Number(delay || 0) || 0));
  }

  function escapedAnchorSelector(anchor = "") {
    const value = String(anchor || "").trim();
    if (!value) {
      return "";
    }
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }

  function findAnchorTargetInSurface(surfaceRoot, anchor = "") {
    const value = String(anchor || "").trim();
    if (!surfaceRoot || !value) {
      return null;
    }
    const escaped = escapedAnchorSelector(value);
    return surfaceRoot.querySelector(`[data-sr-anchor="${escaped}"]`) || surfaceRoot.querySelector(`#${escaped}`) || null;
  }

  function navigateToInternalAnchor(surfaceRoot, anchor = "") {
    const target = findAnchorTargetInSurface(surfaceRoot, anchor);
    if (!target) {
      return false;
    }
    target.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }

  function pageSheetSource(sheet) {
    return sheet?.getAttribute?.("data-sr-page-source") === "auto" ? "auto" : "manual";
  }

  function pageSheetLayout(sheet) {
    return sheet?.getAttribute?.("data-sr-layout") === "landscape" ? "landscape" : "portrait";
  }

  function isWhitespaceNode(node) {
    return node?.nodeType === 3 && !String(node.textContent || "").trim();
  }

  function pageBodyNodes(body) {
    return Array.from(body?.childNodes || []).filter((node) => {
      if (!node) {
        return false;
      }
      if (node.nodeType === 1) {
        return true;
      }
      return !isWhitespaceNode(node);
    });
  }

  function isEmptyParagraphNode(node) {
    if (!node?.matches?.(".sr-native-block[data-block-type='paragraph']")) {
      return false;
    }
    const editable = node.querySelector(".sr-block-editable");
    return !String(inlineMarkdownFromNode(editable) || "").trim();
  }

  function pruneEditableBrowserBreaks(editable) {
    if (!editable || editable.tagName?.toLowerCase() === "textarea") {
      return false;
    }
    let changed = false;
    Array.from(editable.querySelectorAll("br")).forEach((node) => {
      if (node.getAttribute("data-sr-hard-break") === "true") {
        return;
      }
      node.remove();
      changed = true;
    });
    const hasMeaningfulText = String(editable.textContent || "").replace(/[\u200B\u2060\uFEFF]/g, "").trim().length > 0;
    const hasMeaningfulNode = !!editable.querySelector("img,.sr-citation-chip,br[data-sr-hard-break='true']");
    if (!hasMeaningfulText && !hasMeaningfulNode && String(editable.innerHTML || "").trim().toLowerCase() !== "<br>") {
      editable.innerHTML = "<br />";
      changed = true;
    }
    return changed;
  }

  function ensureEditablePageBodyContent(body) {
    if (!body) {
      return null;
    }
    body.classList.add("sr-page-editor-body");
    body.setAttribute("data-sr-page-body", "true");
    body.setAttribute("contenteditable", "true");
    body.setAttribute("spellcheck", "true");
    if (!pageBodyNodes(body).length) {
      const paragraph = createEmptyParagraphBlock();
      body.appendChild(paragraph);
      return paragraph;
    }
    return body.querySelector(".sr-native-block") || body.firstElementChild || null;
  }

  function stripLeadingEmptyParagraph(body) {
    if (!body) {
      return;
    }
    const first = pageBodyNodes(body)[0] || null;
    if (isEmptyParagraphNode(first) && pageBodyNodes(body).length > 1) {
      first.remove();
    }
  }

  function prismaFigureHostNode(figure) {
    return figure?.closest?.(".sr-native-block") || figure || null;
  }

  function isBibliographyContinuationNode(node) {
    return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() === "bibliography";
  }

  function bibliographyDisplayRoot(node) {
    if (node?.matches?.(".sr-bibliography-block[data-sr-bibliography-root='true']")) {
      return node;
    }
    return node?.querySelector?.(".sr-bibliography-block[data-sr-bibliography-root='true']") || null;
  }

  function isBibliographyDisplayNode(node) {
    return !!bibliographyDisplayRoot(node);
  }

  function bibliographyHeadingElement(root) {
    return root?.querySelector?.(":scope > .sr-bibliography-heading")
      || root?.querySelector?.(":scope > h2")
      || null;
  }

  function bibliographyFlowElement(root) {
    if (!root) {
      return null;
    }
    let flow = root.querySelector(":scope > .sr-bibliography-flow");
    if (!flow) {
      flow = document.createElement("div");
      flow.className = "sr-bibliography-flow";
      const movable = Array.from(root.childNodes || []).filter((child) => child !== bibliographyHeadingElement(root));
      if (movable.length) {
        flow.append(...movable);
      }
      root.appendChild(flow);
    }
    let body = flow.querySelector(":scope > .csl-bib-body");
    if (!body) {
      body = document.createElement("div");
      body.className = "csl-bib-body";
      body.append(...Array.from(flow.childNodes || []));
      flow.replaceChildren(body);
    }
    return body;
  }

  function bibliographyEntryNodes(node) {
    const root = bibliographyDisplayRoot(node);
    const body = bibliographyFlowElement(root);
    return Array.from(body?.children || []).filter((child) => child?.matches?.(".csl-entry"));
  }

  function cloneBibliographyEntries(nodes = []) {
    const entries = [];
    for (const sourceNode of nodes) {
      for (const entry of bibliographyEntryNodes(sourceNode)) {
        entries.push(entry.cloneNode(true));
      }
    }
    return entries;
  }

  function setBibliographyContinuationState(node, continuation = false) {
    if (!node) {
      return;
    }
    if (continuation) {
      node.setAttribute("data-sr-generated-continuation", "bibliography");
    }
    else {
      node.removeAttribute("data-sr-generated-continuation");
    }
    const root = bibliographyDisplayRoot(node);
    if (!root) {
      return;
    }
    root.classList.toggle("is-continuation", continuation);
    if (continuation) {
      node.removeAttribute("id");
      node.removeAttribute("data-sr-anchor");
      root.removeAttribute("id");
      root.removeAttribute("data-sr-anchor");
    }
  }

  function setBibliographyNodeEntries(node, entries = [], { continuation = false } = {}) {
    const root = bibliographyDisplayRoot(node);
    if (!root) {
      return false;
    }
    setBibliographyContinuationState(node, continuation);
    let heading = bibliographyHeadingElement(root);
    if (continuation) {
      heading?.remove?.();
      heading = null;
    }
    else if (!heading) {
      heading = document.createElement("h2");
      heading.className = "sr-bibliography-heading";
      heading.textContent = "Bibliography";
      root.insertBefore(heading, root.firstChild || null);
    }
    const body = bibliographyFlowElement(root);
    body.replaceChildren(...entries.map((entry) => entry.cloneNode(true)));
    return true;
  }

  function createBibliographyContinuationNode(sourceNode) {
    const clone = sourceNode?.cloneNode?.(true) || null;
    if (!clone) {
      return null;
    }
    setBibliographyNodeEntries(clone, [], { continuation: true });
    return clone;
  }

  function bibliographyEntryCount(node) {
    return bibliographyEntryNodes(node).length;
  }

  function appendBibliographyEntry(node, entry) {
    const root = bibliographyDisplayRoot(node);
    const body = bibliographyFlowElement(root);
    if (!body || !entry) {
      return;
    }
    body.appendChild(entry);
  }

  function removeLastBibliographyEntry(node) {
    const entries = bibliographyEntryNodes(node);
    const last = entries[entries.length - 1] || null;
    if (!last) {
      return null;
    }
    return last.parentNode?.removeChild?.(last) || last;
  }

  function isTOCContinuationNode(node) {
    return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() === "toc";
  }

  function tocDisplayRoot(node) {
    if (node?.matches?.(".sr-toc-block[data-sr-toc-root='true']")) {
      return node;
    }
    return node?.querySelector?.(".sr-toc-block[data-sr-toc-root='true']") || null;
  }

  function isTOCDisplayNode(node) {
    return !!tocDisplayRoot(node);
  }

  function tocHeadingElement(root) {
    return root?.querySelector?.(":scope > .sr-toc-heading")
      || root?.querySelector?.(":scope > h1")
      || null;
  }

  function tocFlowElement(root) {
    if (!root) {
      return null;
    }
    let flow = root.querySelector(":scope > .sr-toc-flow");
    if (!flow) {
      flow = document.createElement("div");
      flow.className = "sr-toc-flow";
      const movable = Array.from(root.childNodes || []).filter((child) => child !== tocHeadingElement(root));
      if (movable.length) {
        flow.append(...movable);
      }
      root.appendChild(flow);
    }
    return flow;
  }

  function tocEntryNodes(node) {
    const root = tocDisplayRoot(node);
    const flow = tocFlowElement(root);
    return Array.from(flow?.children || []).filter((child) => child?.matches?.(".sr-toc-entry"));
  }

  function cloneTOCEntries(nodes = []) {
    const entries = [];
    for (const sourceNode of nodes) {
      for (const entry of tocEntryNodes(sourceNode)) {
        entries.push(entry.cloneNode(true));
      }
    }
    return entries;
  }

  function setTOCContinuationState(node, continuation = false) {
    if (!node) {
      return;
    }
    if (continuation) {
      node.setAttribute("data-sr-generated-continuation", "toc");
    }
    else {
      node.removeAttribute("data-sr-generated-continuation");
    }
    const root = tocDisplayRoot(node);
    if (!root) {
      return;
    }
    root.classList.toggle("is-continuation", continuation);
    if (continuation) {
      root.removeAttribute("id");
      root.removeAttribute("data-sr-anchor");
    }
  }

  function setTOCNodeEntries(node, entries = [], { continuation = false } = {}) {
    const root = tocDisplayRoot(node);
    if (!root) {
      return false;
    }
    setTOCContinuationState(node, continuation);
    let heading = tocHeadingElement(root);
    if (continuation) {
      heading?.remove?.();
      heading = null;
    }
    else if (!heading) {
      heading = document.createElement("h1");
      heading.className = "sr-toc-heading";
      heading.textContent = "Table of Contents";
      root.insertBefore(heading, root.firstChild || null);
    }
    const flow = tocFlowElement(root);
    flow.replaceChildren(...entries.map((entry) => entry.cloneNode(true)));
    return true;
  }

  function createTOCContinuationNode(sourceNode) {
    const clone = sourceNode?.cloneNode?.(true) || null;
    if (!clone) {
      return null;
    }
    setTOCNodeEntries(clone, [], { continuation: true });
    return clone;
  }

  function appendTOCEntry(node, entry) {
    const root = tocDisplayRoot(node);
    const flow = tocFlowElement(root);
    if (!flow || !entry) {
      return;
    }
    flow.appendChild(entry);
  }

  function removeLastTOCEntry(node) {
    const entries = tocEntryNodes(node);
    const last = entries[entries.length - 1] || null;
    if (!last) {
      return null;
    }
    return last.parentNode?.removeChild?.(last) || last;
  }

  function preferredCodeSplitLength(text = "", maxLength = 0) {
    const upperBound = Math.max(0, Math.min(String(text || "").length, Number(maxLength || 0) || 0));
    if (upperBound <= 0) {
      return 0;
    }
    const newlineBreak = String(text || "").lastIndexOf("\n", upperBound - 1);
    const trailingLength = upperBound - (newlineBreak + 1);
    if (newlineBreak >= 0 && (trailingLength <= 24 || newlineBreak + 1 >= Math.floor(upperBound * 0.92))) {
      return newlineBreak + 1;
    }
    return upperBound;
  }

  function isCodeContinuationNode(node) {
    return typeof SystematicReviewerNativeMarkdown.isCodeContinuationNode === "function"
      ? SystematicReviewerNativeMarkdown.isCodeContinuationNode(node)
      : String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() === "code";
  }

  function isCodeDisplayNode(node) {
    return !!SystematicReviewerNativeMarkdown.codeDisplayRoot?.(node);
  }

  function resetPreviewCodeSourceNode(node) {
    return typeof SystematicReviewerNativeMarkdown.resetCodeSourceNode === "function"
      ? SystematicReviewerNativeMarkdown.resetCodeSourceNode(node)
      : node;
  }

  function createPreviewCodeContinuationNode(sourceNode, text = "") {
    return typeof SystematicReviewerNativeMarkdown.createCodeContinuationNode === "function"
      ? SystematicReviewerNativeMarkdown.createCodeContinuationNode(sourceNode, text)
      : null;
  }

  function codeTextFromDisplayNode(node) {
    return typeof SystematicReviewerNativeMarkdown.codeTextFromNode === "function"
      ? SystematicReviewerNativeMarkdown.codeTextFromNode(node)
      : "";
  }

  function appendPreviewCodeNode(node, currentSheet, currentBody, { editable = false } = {}) {
    if (!node) {
      return { currentSheet, currentBody };
    }
    prepareBodyForFlowAppend(currentBody, editable);
    currentBody.appendChild(node);
    if (!editable && bodyOverflows(currentBody) && pageBodyNodes(currentBody).length > 1) {
      node.remove();
      currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
      currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
      prepareBodyForFlowAppend(currentBody, editable);
      currentBody.appendChild(node);
    }
    return { currentSheet, currentBody };
  }

  function maxFittingCodePrefixLength(text = "", currentBody = null, sourceNode = null) {
    const source = String(text || "");
    if (!source || !currentBody || !sourceNode) {
      return 0;
    }
    let low = 1;
    let high = source.length;
    let best = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const fragmentNode = createPreviewCodeContinuationNode(sourceNode, source.slice(0, middle));
      if (!fragmentNode) {
        break;
      }
      prepareBodyForFlowAppend(currentBody, false);
      currentBody.appendChild(fragmentNode);
      const fits = !bodyOverflows(currentBody);
      fragmentNode.remove();
      if (fits) {
        best = middle;
        low = middle + 1;
      }
      else {
        high = middle - 1;
      }
    }
    return best;
  }

  function paginateCodeGroup(groupNodes, currentSheet, currentBody, { editable = false } = {}) {
    const canonicalNode = resetPreviewCodeSourceNode(groupNodes[0] || null);
    if (!canonicalNode || editable) {
      return appendPreviewCodeNode(canonicalNode, currentSheet, currentBody, { editable });
    }
    const sourceText = codeTextFromDisplayNode(canonicalNode);
    if (!sourceText) {
      return appendPreviewCodeNode(canonicalNode, currentSheet, currentBody, { editable });
    }
    canonicalNode.style.display = "none";
    canonicalNode.setAttribute("aria-hidden", "true");
    canonicalNode.setAttribute("data-sr-code-fragment-source", "true");
    prepareBodyForFlowAppend(currentBody, editable);
    currentBody.appendChild(canonicalNode);
    let activeSheet = currentSheet;
    let activeBody = currentBody;
    let remaining = sourceText;
    while (remaining.length) {
      let fittingLength = maxFittingCodePrefixLength(remaining, activeBody, canonicalNode);
      if (fittingLength <= 0) {
        activeSheet = nextAutoContinuationSheet(activeSheet, { editable }) || activeSheet;
        activeBody = activeSheet.querySelector(".sr-page-sheet-body") || activeBody;
        fittingLength = maxFittingCodePrefixLength(remaining, activeBody, canonicalNode);
        if (fittingLength <= 0) {
          fittingLength = remaining.length;
        }
      }
      const splitLength = preferredCodeSplitLength(remaining, fittingLength) || fittingLength;
      const fragmentNode = createPreviewCodeContinuationNode(canonicalNode, remaining.slice(0, splitLength));
      if (!fragmentNode) {
        break;
      }
      prepareBodyForFlowAppend(activeBody, editable);
      activeBody.appendChild(fragmentNode);
      remaining = remaining.slice(splitLength);
      if (remaining.length) {
        activeSheet = nextAutoContinuationSheet(activeSheet, { editable }) || activeSheet;
        activeBody = activeSheet.querySelector(".sr-page-sheet-body") || activeBody;
      }
    }
    return { currentSheet: activeSheet, currentBody: activeBody };
  }

  function isTableContinuationNode(node) {
    return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() === "table";
  }

  function tableDisplayRoot(node) {
    if (node?.matches?.(".sr-table-block")) {
      return node;
    }
    return node?.querySelector?.(".sr-table-block") || null;
  }

  function isTableDisplayNode(node) {
    return !!tableDisplayRoot(node);
  }

  function resetPreviewTableSourceNode(node) {
    const root = tableDisplayRoot(node);
    if (!root) {
      return null;
    }
    root.style.display = "";
    root.removeAttribute("aria-hidden");
    root.removeAttribute("data-sr-table-fragment-source");
    return root;
  }

  function appendPreviewTableNode(node, currentSheet, currentBody, { editable = false } = {}) {
    if (!node) {
      return { currentSheet, currentBody };
    }
    prepareBodyForFlowAppend(currentBody, editable);
    currentBody.appendChild(node);
    if (!editable && bodyOverflows(currentBody) && pageBodyNodes(currentBody).length > 1) {
      node.remove();
      currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
      currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
      prepareBodyForFlowAppend(currentBody, editable);
      currentBody.appendChild(node);
    }
    return { currentSheet, currentBody };
  }

  function previewTableGroupID(node) {
    const root = tableDisplayRoot(node);
    if (!root) {
      return `table-${Date.now()}`;
    }
    let current = String(root.getAttribute("data-sr-table-group") || "").trim();
    if (!current) {
      current = `table-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      root.setAttribute("data-sr-table-group", current);
    }
    return current;
  }

  function paginateTableGroup(groupNodes, currentSheet, currentBody, { editable = false } = {}) {
    const canonicalNode = resetPreviewTableSourceNode(groupNodes[0] || null);
    if (!canonicalNode || editable || !SystematicReviewerTableFragmentation?.buildRenderedTableFragmentPlan) {
      return appendPreviewTableNode(canonicalNode, currentSheet, currentBody, { editable });
    }

    const visiblePrecedingNodes = pageBodyNodes(currentBody).filter((node) =>
      node !== canonicalNode
      && !isBibliographyContinuationNode(node)
      && !isTableContinuationNode(node)
    );
    let pageBodyBox = SystematicReviewerTableFragmentation.measurePageBodyUsableBox(currentBody, {
      precedingNodes: visiblePrecedingNodes,
      printMarginInches: Number(state.editorSettings?.printMarginInches || 1),
    });
    if (!pageBodyBox) {
      return appendPreviewTableNode(canonicalNode, currentSheet, currentBody, { editable });
    }

    let plan = SystematicReviewerTableFragmentation.buildRenderedTableFragmentPlan(canonicalNode, {
      groupId: previewTableGroupID(canonicalNode),
      pageBody: currentBody,
      pageBodyBox,
      firstPageAvailableHeight: pageBodyBox.remainingHeight,
      followingPageHeight: pageBodyBox.contentHeight,
      printMarginInches: Number(state.editorSettings?.printMarginInches || 1),
    });

    if (plan?.startOnNextPage && pageBodyBox.occupiedHeight > 0.5) {
      currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
      currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
      pageBodyBox = SystematicReviewerTableFragmentation.measurePageBodyUsableBox(currentBody, {
        precedingNodes: pageBodyNodes(currentBody).filter((node) =>
          !isBibliographyContinuationNode(node) && !isTableContinuationNode(node)
        ),
        printMarginInches: Number(state.editorSettings?.printMarginInches || 1),
      });
      plan = SystematicReviewerTableFragmentation.buildRenderedTableFragmentPlan(canonicalNode, {
        groupId: previewTableGroupID(canonicalNode),
        pageBody: currentBody,
        pageBodyBox,
        firstPageAvailableHeight: pageBodyBox?.remainingHeight,
        followingPageHeight: pageBodyBox?.contentHeight,
        printMarginInches: Number(state.editorSettings?.printMarginInches || 1),
      });
    }

    if (!plan?.fragments?.length) {
      return appendPreviewTableNode(canonicalNode, currentSheet, currentBody, { editable });
    }

    canonicalNode.style.display = "none";
    canonicalNode.setAttribute("aria-hidden", "true");
    canonicalNode.setAttribute("data-sr-table-fragment-source", "true");
    prepareBodyForFlowAppend(currentBody, editable);
    currentBody.appendChild(canonicalNode);

    let activeSheet = currentSheet;
    let activeBody = currentBody;
    for (let index = 0; index < plan.fragments.length; index += 1) {
      if (index > 0) {
        activeSheet = nextAutoContinuationSheet(activeSheet, { editable }) || activeSheet;
        activeBody = activeSheet.querySelector(".sr-page-sheet-body") || activeBody;
      }
      prepareBodyForFlowAppend(activeBody, editable);
      const fragmentNode = SystematicReviewerTableFragmentation.renderTableFragmentNode(plan.fragments[index], { document });
      if (fragmentNode) {
        activeBody.appendChild(fragmentNode);
      }
    }

    return { currentSheet: activeSheet, currentBody: activeBody };
  }

  function prepareBodyForFlowAppend(body, editable = false) {
    if (!editable) {
      return;
    }
    const currentNodes = pageBodyNodes(body);
    if (currentNodes.length === 1 && isEmptyParagraphNode(currentNodes[0])) {
      body.replaceChildren();
    }
  }

  function bodyOverflows(body) {
    return !!(body && body.clientHeight > 0 && body.scrollHeight > body.clientHeight + 2);
  }

  function paginateTOCGroup(groupNodes, currentSheet, currentBody, { editable = false } = {}) {
    const canonicalNode = groupNodes[0] || null;
    if (!canonicalNode) {
      return { currentSheet, currentBody };
    }
    const allEntries = cloneTOCEntries(groupNodes);
    if (!allEntries.length) {
      prepareBodyForFlowAppend(currentBody, editable);
      currentBody.appendChild(canonicalNode);
      return { currentSheet, currentBody };
    }

    setTOCNodeEntries(canonicalNode, [], { continuation: false });
    prepareBodyForFlowAppend(currentBody, editable);
    currentBody.appendChild(canonicalNode);
    let activeNode = canonicalNode;

    for (const entry of allEntries) {
      appendTOCEntry(activeNode, entry.cloneNode(true));
      if (!bodyOverflows(currentBody)) {
        continue;
      }
      const entryCount = tocEntryNodes(activeNode).length;
      if (entryCount === 1) {
        const currentNodes = pageBodyNodes(currentBody);
        if (currentNodes.length === 1) {
          continue;
        }
        activeNode.remove();
        currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
        currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
        prepareBodyForFlowAppend(currentBody, editable);
        currentBody.appendChild(activeNode);
        continue;
      }
      const overflowEntry = removeLastTOCEntry(activeNode);
      currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
      currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
      activeNode = createTOCContinuationNode(canonicalNode) || canonicalNode;
      prepareBodyForFlowAppend(currentBody, editable);
      currentBody.appendChild(activeNode);
      if (overflowEntry) {
        appendTOCEntry(activeNode, overflowEntry);
      }
    }

    return { currentSheet, currentBody };
  }

  function paginateBibliographyGroup(groupNodes, currentSheet, currentBody, { editable = false } = {}) {
    const canonicalNode = groupNodes[0] || null;
    if (!canonicalNode) {
      return { currentSheet, currentBody };
    }
    const allEntries = cloneBibliographyEntries(groupNodes);
    if (!allEntries.length) {
      prepareBodyForFlowAppend(currentBody, editable);
      currentBody.appendChild(canonicalNode);
      return { currentSheet, currentBody };
    }

    setBibliographyNodeEntries(canonicalNode, [], { continuation: false });
    prepareBodyForFlowAppend(currentBody, editable);
    currentBody.appendChild(canonicalNode);
    let activeNode = canonicalNode;

    for (const entry of allEntries) {
      appendBibliographyEntry(activeNode, entry.cloneNode(true));
      if (!bodyOverflows(currentBody)) {
        continue;
      }
      const entryCount = bibliographyEntryCount(activeNode);
      if (entryCount === 1) {
        const currentNodes = pageBodyNodes(currentBody);
        if (currentNodes.length === 1) {
          continue;
        }
        activeNode.remove();
        currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
        currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
        prepareBodyForFlowAppend(currentBody, editable);
        currentBody.appendChild(activeNode);
        continue;
      }
      const overflowEntry = removeLastBibliographyEntry(activeNode);
      currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
      currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
      activeNode = createBibliographyContinuationNode(canonicalNode) || canonicalNode;
      prepareBodyForFlowAppend(currentBody, editable);
      currentBody.appendChild(activeNode);
      if (overflowEntry) {
        appendBibliographyEntry(activeNode, overflowEntry);
      }
    }

    return { currentSheet, currentBody };
  }

  function prismaFigureIntrinsicSize(figure) {
    const directWidth = Number(figure?.getAttribute?.("data-sr-prisma-width") || figure?.dataset?.srPrismaWidth || 0);
    const directHeight = Number(figure?.getAttribute?.("data-sr-prisma-height") || figure?.dataset?.srPrismaHeight || 0);
    if (Number.isFinite(directWidth) && directWidth > 0 && Number.isFinite(directHeight) && directHeight > 0) {
      return { width: directWidth, height: directHeight };
    }
    const svg = figure?.querySelector?.("svg");
    const svgWidth = Number(svg?.getAttribute?.("data-sr-prisma-intrinsic-width") || svg?.getAttribute?.("width") || 0);
    const svgHeight = Number(svg?.getAttribute?.("data-sr-prisma-intrinsic-height") || svg?.getAttribute?.("height") || 0);
    return {
      width: Number.isFinite(svgWidth) && svgWidth > 0 ? svgWidth : 1200,
      height: Number.isFinite(svgHeight) && svgHeight > 0 ? svgHeight : 1400,
    };
  }

  function prismaFigureReportScalePercent(figure) {
    const raw = Number(figure?.getAttribute?.("data-sr-prisma-report-scale") || figure?.dataset?.srPrismaReportScale || 100);
    if (!Number.isFinite(raw)) {
      return 100;
    }
    return Math.max(50, Math.min(160, Math.round(raw)));
  }

  function prismaFigureRenderedScale(figure) {
    const raw = Number(figure?.getAttribute?.("data-sr-prisma-scale") || figure?.dataset?.srPrismaScale || 0);
    if (!Number.isFinite(raw) || raw <= 0) {
      return 1;
    }
    return Math.max(0.05, raw);
  }

  function fitPrismaFiguresInBody(body) {
    if (!body || !body.clientWidth) {
      return;
    }
    const pageViewScale = Math.max(0.65, Math.min(1.75, Number(state.editorSettings?.pageViewScale || 1) || 1));
    const figures = Array.from(body.querySelectorAll(".sr-prisma-figure[data-sr-prisma='true']"));
    figures.forEach((figure) => {
      const size = prismaFigureIntrinsicSize(figure);
      const effectiveScale = prismaFigureRenderedScale(figure);
      const displayWidth = size.width * effectiveScale * pageViewScale;
      figure.style.width = `${Math.round(Math.max(1, displayWidth))}px`;
      figure.style.maxWidth = "100%";
      figure.style.setProperty("--sr-prisma-effective-scale", String(effectiveScale));
    });
  }

  function createAutoPageSheet(layout = "portrait", { editable = false } = {}) {
    const sheet = document.createElement("section");
    sheet.className = "sr-page-sheet";
    sheet.setAttribute("data-sr-layout", layout === "landscape" ? "landscape" : "portrait");
    sheet.setAttribute("data-sr-page-source", "auto");
    const body = document.createElement("div");
    body.className = editable ? "sr-page-sheet-body sr-page-editor-body" : "sr-page-sheet-body";
    if (editable) {
      body.setAttribute("data-sr-page-body", "true");
      body.setAttribute("contenteditable", "true");
      body.setAttribute("spellcheck", "true");
      body.appendChild(createEmptyParagraphBlock());
    }
    sheet.appendChild(body);
    return { sheet, body };
  }

  function nextAutoContinuationSheet(sheet, { editable = false } = {}) {
    if (!sheet) {
      return null;
    }
    const layout = pageSheetLayout(sheet);
    let next = sheet.nextElementSibling || null;
    while (next && !next.classList?.contains("sr-page-sheet")) {
      next = next.nextElementSibling || null;
    }
    if (next && pageSheetSource(next) === "auto") {
      next.setAttribute("data-sr-layout", layout);
      return next;
    }
    const created = createAutoPageSheet(layout, { editable });
    sheet.after(created.sheet);
    return created.sheet;
  }

  function refreshPageSheetIndices(root) {
    Array.from(root?.querySelectorAll?.(".sr-page-sheet, .sr-editor-section") || []).forEach((sheet, index) => {
      sheet.setAttribute("data-sr-page-index", String(index + 1));
    });
  }

  function removeEmptyAutoPages(root, { editable = false } = {}) {
    let removed = false;
    for (const sheet of Array.from(root?.querySelectorAll?.(".sr-page-sheet[data-sr-page-source='auto']") || [])) {
      const body = sheet.querySelector(".sr-page-sheet-body");
      const nodes = pageBodyNodes(body);
      const empty = editable
        ? !nodes.length || (nodes.length === 1 && isEmptyParagraphNode(nodes[0]))
        : !nodes.length;
      if (empty) {
        sheet.remove();
        removed = true;
      }
    }
    if (removed) {
      refreshPageSheetIndices(root);
    }
    return removed;
  }

  function repaginateSurface(surface) {
    if (state.destroyed || state.reflowing || !["preview", "native"].includes(surface)) {
      return;
    }
    const editable = surface === "native";
    const hostSurface = editable ? nativeEditor : preview;
    const root = hostSurface.querySelector(editable ? ".sr-native-root" : ".sr-markdown-document");
    if (!root || hostSurface.hidden || panel.hidden) {
      return;
    }
    if (editable) {
      withNativeMutationObserverPaused(() => ensureNativeSurfaceReady());
      scheduleFindPanelRefresh({
        preserveIndex: true,
        delay: 0,
        renderOnly: true,
      });
      return;
    }
	    state.reflowing = true;
	    const preservedPreviewScroll = capturePreviewScrollState();
	    try {
	      SystematicReviewerNativeMarkdown.layoutRenderedTOCRows(root);
	      const allSheets = Array.from(root.querySelectorAll(".sr-page-sheet"));
      const manualSheets = allSheets.filter((sheet) => pageSheetSource(sheet) !== "auto");
      const baseSheets = manualSheets.length ? manualSheets : allSheets.slice(0, 1);
      for (const sheet of baseSheets) {
        if (!sheet?.isConnected) {
          continue;
        }
        const groupSheets = [sheet];
        let cursor = sheet.nextElementSibling;
        while (cursor?.classList?.contains("sr-page-sheet") && pageSheetSource(cursor) === "auto") {
          groupSheets.push(cursor);
          cursor = cursor.nextElementSibling;
        }
        const flowNodes = [];
        for (const groupSheet of groupSheets) {
          const body = groupSheet.querySelector(".sr-page-sheet-body");
          if (!body) {
            continue;
          }
          const nodes = pageBodyNodes(body);
          const skipPlaceholder =
            editable
            && pageSheetSource(groupSheet) === "auto"
            && nodes.length === 1
            && isEmptyParagraphNode(nodes[0]);
          if (skipPlaceholder) {
            continue;
          }
          flowNodes.push(...nodes);
        }
        const firstBody = sheet.querySelector(".sr-page-sheet-body");
        if (!firstBody) {
          continue;
        }
        firstBody.replaceChildren();
        groupSheets.slice(1).forEach((groupSheet) => groupSheet.remove());
        let currentSheet = sheet;
        let currentBody = firstBody;
        if (!flowNodes.length) {
          if (editable) {
            ensureEditablePageBodyContent(currentBody);
          }
          continue;
        }
        for (let index = 0; index < flowNodes.length; index += 1) {
          const node = flowNodes[index];
          if (isTOCContinuationNode(node)) {
            continue;
          }
          if (isTOCDisplayNode(node)) {
            const tocGroup = [node];
            while ((index + 1) < flowNodes.length && isTOCContinuationNode(flowNodes[index + 1])) {
              tocGroup.push(flowNodes[index + 1]);
              index += 1;
            }
            const paginated = paginateTOCGroup(tocGroup, currentSheet, currentBody, { editable });
            currentSheet = paginated.currentSheet;
            currentBody = paginated.currentBody;
            continue;
          }
          if (isBibliographyContinuationNode(node)) {
            continue;
          }
          if (isBibliographyDisplayNode(node)) {
            const bibliographyGroup = [node];
            while ((index + 1) < flowNodes.length && isBibliographyContinuationNode(flowNodes[index + 1])) {
              bibliographyGroup.push(flowNodes[index + 1]);
              index += 1;
            }
            const paginated = paginateBibliographyGroup(bibliographyGroup, currentSheet, currentBody, { editable });
            currentSheet = paginated.currentSheet;
            currentBody = paginated.currentBody;
            continue;
          }
          if (isTableDisplayNode(node)) {
            const tableGroup = [node];
            while ((index + 1) < flowNodes.length && isTableContinuationNode(flowNodes[index + 1])) {
              tableGroup.push(flowNodes[index + 1]);
              index += 1;
            }
            const paginated = paginateTableGroup(tableGroup, currentSheet, currentBody, { editable });
            currentSheet = paginated.currentSheet;
            currentBody = paginated.currentBody;
            continue;
          }
          if (isCodeContinuationNode(node)) {
            continue;
          }
          if (isCodeDisplayNode(node)) {
            const codeGroup = [node];
            while ((index + 1) < flowNodes.length && isCodeContinuationNode(flowNodes[index + 1])) {
              codeGroup.push(flowNodes[index + 1]);
              index += 1;
            }
            const paginated = paginateCodeGroup(codeGroup, currentSheet, currentBody, { editable });
            currentSheet = paginated.currentSheet;
            currentBody = paginated.currentBody;
            continue;
          }
          if (editable) {
            prepareBodyForFlowAppend(currentBody, editable);
          }
          currentBody.appendChild(node);
          fitPrismaFiguresInBody(currentBody);
          const overflow = bodyOverflows(currentBody);
          const currentNodes = pageBodyNodes(currentBody);
          if (overflow && currentNodes.length > 1) {
            node.remove();
            currentSheet = nextAutoContinuationSheet(currentSheet, { editable }) || currentSheet;
            currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
            if (editable) {
              prepareBodyForFlowAppend(currentBody, editable);
            }
            currentBody.appendChild(node);
            fitPrismaFiguresInBody(currentBody);
          }
        }
        if (editable) {
          ensureEditablePageBodyContent(currentBody);
        }
      }
      removeEmptyAutoPages(root, { editable });
      refreshPageSheetIndices(root);
      SystematicReviewerNativeMarkdown.markWrappedProseTableCells(root);
      SystematicReviewerNativeMarkdown.updateRenderedTOCPageNumbers(root);
      if (preservedPreviewScroll) {
        restorePreviewScrollStateAfterLayout(preservedPreviewScroll);
      }
      scheduleFindPanelRefresh({
        preserveIndex: true,
        delay: 0,
        renderOnly: true,
      });
    }
    finally {
      state.reflowing = false;
    }
  }

  function clearSurfaceReflowTimer(surface) {
    const timer = state.reflowTimers?.[surface] || 0;
    if (timer) {
      window.clearTimeout(timer);
      state.reflowTimers[surface] = 0;
    }
  }

  function scheduleSurfaceReflow(surface, { immediate = false, delay = 0 } = {}) {
    if (!["preview", "native"].includes(surface) || state.destroyed) {
      return;
    }
    clearSurfaceReflowTimer(surface);
    const run = () => {
      state.reflowTimers[surface] = 0;
      state.pendingReflows.add(surface);
      if (state.reflowFrame) {
        return;
      }
      const runner = () => {
        state.reflowFrame = 0;
        const surfaces = Array.from(state.pendingReflows);
        state.pendingReflows.clear();
        for (const target of surfaces) {
          repaginateSurface(target);
        }
      };
      const requestFrame = typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 16);
      state.reflowFrame = requestFrame(runner);
    };
    if (immediate || delay <= 0) {
      run();
      return;
    }
    state.reflowTimers[surface] = window.setTimeout(run, Math.max(0, Number(delay || 0)));
  }

  function selectionRangeWithinEditable(editable) {
    if (!editable || editable.tagName?.toLowerCase() === "textarea") {
      return null;
    }
    try {
      const selection = document.defaultView.getSelection();
      if (!selection || !selection.rangeCount) {
        return null;
      }
      const range = selection.getRangeAt(0);
      const startContainer = range.startContainer?.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;
      const endContainer = range.endContainer?.nodeType === 3 ? range.endContainer.parentNode : range.endContainer;
      if (editable.contains(startContainer) && editable.contains(endContainer)) {
        return range.cloneRange();
      }
    }
    catch (_error) {}
    return null;
  }

  function splitEditableAtSelection(editable) {
    const full = String(inlineMarkdownFromNode(editable) || "").replace(/\u00a0/g, " ");
    const range = selectionRangeWithinEditable(editable);
    if (!range) {
      return { before: full, after: "", full, collapsed: true };
    }
    const beforeRange = editable.ownerDocument.createRange();
    beforeRange.selectNodeContents(editable);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = editable.ownerDocument.createRange();
    afterRange.selectNodeContents(editable);
    afterRange.setStart(range.endContainer, range.endOffset);
    const beforeHolder = document.createElement("div");
    const afterHolder = document.createElement("div");
    beforeHolder.appendChild(beforeRange.cloneContents());
    afterHolder.appendChild(afterRange.cloneContents());
    return {
      before: String(inlineMarkdownFromNode(beforeHolder) || "").replace(/\u00a0/g, " "),
      after: String(inlineMarkdownFromNode(afterHolder) || "").replace(/\u00a0/g, " "),
      full,
      collapsed: range.collapsed,
    };
  }

  function createEmptyParagraphBlock() {
    const wrapper = document.createElement("section");
    wrapper.className = "sr-native-block sr-block-paragraph";
    wrapper.setAttribute("data-block-type", "paragraph");
    const editable = document.createElement("div");
    editable.className = "sr-block-editable";
    editable.setAttribute("contenteditable", "true");
    editable.setAttribute("data-sr-editable", "true");
    editable.innerHTML = "<br />";
    wrapper.appendChild(editable);
    return wrapper;
  }

  function createParagraphBlock(markdownText = "") {
    const block = createEmptyParagraphBlock();
    setEditableMarkdown(block.querySelector(".sr-block-editable"), markdownText);
    return block;
  }

  function createHeadingBlock(level = 2, markdownText = "") {
    const wrapper = document.createElement("section");
    wrapper.className = "sr-native-block sr-block-heading";
    wrapper.setAttribute("data-block-type", "heading");
    wrapper.setAttribute("data-level", String(Math.max(1, Math.min(6, Number(level || 2) || 2))));
    const editable = document.createElement("div");
    editable.className = "sr-block-editable";
    editable.setAttribute("contenteditable", "true");
    editable.setAttribute("data-sr-editable", "true");
    setEditableMarkdown(editable, markdownText);
    wrapper.appendChild(editable);
    return wrapper;
  }

  function createParagraphBlockWithHTML(html = "") {
    const block = createEmptyParagraphBlock();
    block.querySelector(".sr-block-editable").innerHTML = html || "<br />";
    return block;
  }

  function prepareInsertedNativeBlock(node) {
    if (!node?.querySelectorAll) {
      return node;
    }
    Array.from(node.querySelectorAll(".sr-block-editable,.sr-native-table-cell")).forEach((target) => {
      const blockType = target.closest?.("[data-block-type]")?.getAttribute?.("data-block-type") || "";
      const readOnly = ["bibliography", "prisma"].includes(blockType) || target.getAttribute("data-sr-editable") === "false";
      target.setAttribute("contenteditable", readOnly ? "false" : "true");
      target.setAttribute("data-sr-editable", readOnly ? "false" : "true");
      if (!readOnly && !String(target.innerHTML || "").trim()) {
        target.innerHTML = "<br />";
      }
    });
    Array.from(node.querySelectorAll(".sr-citation-chip")).forEach((chip) => {
      chip.setAttribute("contenteditable", "false");
      chip.setAttribute("data-sr-editable", "false");
    });
    autosizeCodeTextareas(node);
    return node;
  }

  function renderNativeBlockNode(block, index = Date.now()) {
    if (!block) {
      return null;
    }
    const replacement = document.createElement("div");
    replacement.innerHTML = renderNativeHTML(SystematicReviewerNativeMarkdown.serializeBlocks([block]), state);
    const body = replacement.querySelector(".sr-page-editor-body") || replacement.querySelector(".sr-page-sheet-body");
    const node = body?.querySelector?.(".sr-native-block") || replacement.querySelector(".sr-native-block");
    if (node) {
      node.setAttribute("data-index", String(index));
      prepareInsertedNativeBlock(node);
    }
    return node || null;
  }

  function rerenderNativeImageBlock(block, imageData = null) {
    if (!block?.isConnected) {
      return null;
    }
    const nextImage = imageData || SystematicReviewerNativeMarkdown.blocksFromEditorNode(block)[0];
    if (!nextImage || nextImage.type !== "image") {
      return block;
    }
    const nextBlock = renderNativeBlockNode(nextImage, Number(block.getAttribute("data-index") || Date.now()) || Date.now());
    if (!nextBlock) {
      return block;
    }
    block.replaceWith(nextBlock);
    return nextBlock;
  }

  function createListItemRow(markdownText = "", ordered = false, index = 0, level = 0) {
    const row = document.createElement("div");
    row.className = "sr-native-list-item";
    setListItemLevel(row, level);
    const marker = document.createElement("div");
    marker.className = "sr-native-list-marker";
    marker.setAttribute("contenteditable", "false");
    marker.textContent = ordered ? `${index + 1}.` : "•";
    row.append(marker, (() => {
      const editable = document.createElement("div");
      editable.className = "sr-block-editable";
      editable.setAttribute("contenteditable", "true");
      editable.setAttribute("data-sr-editable", "true");
      setEditableMarkdown(editable, markdownText);
      return editable;
    })());
    return row;
  }

  function listItemLevel(row) {
    return Math.max(0, Number(row?.getAttribute?.("data-level") || row?.dataset?.level || 0) || 0);
  }

  function setListItemLevel(row, level) {
    if (!row) {
      return;
    }
    const normalized = Math.max(0, Math.min(8, Number(level || 0) || 0));
    row.setAttribute("data-level", String(normalized));
    row.style.setProperty("--sr-list-level", String(normalized));
  }

  function listBlockHasExplicitStyle(listBlock) {
    return String(
      listBlock?.getAttribute?.("data-list-style-explicit")
      || listBlock?.getAttribute?.("data-sr-list-style-explicit")
      || ""
    ).trim().toLowerCase() === "true";
  }

  function setListBlockStyleAttributes(listBlock, normalizedList) {
    if (!listBlock || !normalizedList) {
      return;
    }
    const resolvedStyle = String(
      normalizedList.resolvedListStyle
      || normalizedList.listStyle
      || (normalizedList.ordered ? "decimal" : (state.editorSettings?.bulletStyle || "disc"))
    ).trim();
    const explicit = normalizedList.hasExplicitListStyle ? "true" : "false";
    listBlock.setAttribute("data-list-style", resolvedStyle);
    listBlock.setAttribute("data-sr-list-style", resolvedStyle);
    listBlock.setAttribute("data-list-style-explicit", explicit);
    listBlock.setAttribute("data-sr-list-style-explicit", explicit);
  }

  function renumberListBlock(listBlock) {
    if (!listBlock) {
      return;
    }
    const ordered = listBlock.getAttribute("data-list-kind") === "ol";
    const listStyle = listBlockHasExplicitStyle(listBlock)
      ? String(listBlock.getAttribute("data-list-style") || listBlock.getAttribute("data-sr-list-style") || "").trim()
      : "";
    const rows = Array.from(listBlock.querySelectorAll(".sr-native-list-item"));
    const normalizedList = SystematicReviewerNativeMarkdown.normalizeListBlock({
      type: "list",
      ordered,
      items: rows.map((row) => ({
        text: inlineMarkdownFromNode(row.querySelector(".sr-block-editable") || row).trim(),
        level: listItemLevel(row),
      })),
      listStyle,
    }, {
      settings: state.editorSettings,
    });
    const items = normalizedList.items;
    const markerStyle = normalizedList.resolvedListStyle;
    setListBlockStyleAttributes(listBlock, normalizedList);
    const orderedLabels = ordered ? SystematicReviewerNativeMarkdown.orderedListMarkerLabels(items, markerStyle) : [];
    const unorderedMarker = markerStyle === "square"
      ? "▪"
      : (markerStyle === "circle" ? "◦" : "•");
    rows.forEach((row, index) => {
      setListItemLevel(row, items[index]?.level || 0);
      const marker = row.querySelector(".sr-native-list-marker");
      if (marker) {
        marker.textContent = ordered ? (orderedLabels[index] || `${index + 1}.`) : unorderedMarker;
      }
    });
  }

  function tableCellDescriptor(cell) {
    if (!cell) {
      return null;
    }
    return {
      section: cell.getAttribute("data-sr-table-section") || (cell.tagName === "TH" ? "header" : "body"),
      rowIndex: Number(cell.getAttribute("data-row-index") || 0),
      columnIndex: Number(cell.getAttribute("data-column-index") || 0),
      colspan: Math.max(1, Number(cell.getAttribute("data-colspan") || cell.colSpan || 1)),
    };
  }

  function normalizeTableSelectionCells(cells) {
    const seen = new Set();
    return (cells || [])
      .filter(Boolean)
      .map((cell) => ({
        section: cell.section || "body",
        rowIndex: Number(cell.rowIndex || 0),
        columnIndex: Number(cell.columnIndex || 0),
        colspan: Math.max(1, Number(cell.colspan || 1)),
      }))
      .filter((cell) => {
        const key = `${cell.section}:${cell.rowIndex}:${cell.columnIndex}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort((left, right) =>
        left.section.localeCompare(right.section)
        || left.rowIndex - right.rowIndex
        || left.columnIndex - right.columnIndex
      );
  }

  function tableCellElementFromDescriptor(table, descriptor) {
    if (!table || !descriptor) {
      return null;
    }
    const exact = table.querySelector(
      `${descriptor.section === "header" ? "th" : "td"}[data-sr-table-section="${descriptor.section}"][data-row-index="${descriptor.rowIndex}"][data-column-index="${descriptor.columnIndex}"]`
    );
    if (exact) {
      return exact;
    }
    return Array.from(table.querySelectorAll(`${descriptor.section === "header" ? "th" : "td"}[data-sr-table-section="${descriptor.section}"][data-row-index="${descriptor.rowIndex}"]`))
      .find((cell) => {
        const start = Number(cell.getAttribute("data-column-index") || 0);
        const span = Math.max(1, Number(cell.getAttribute("data-colspan") || cell.colSpan || 1));
        return descriptor.columnIndex >= start && descriptor.columnIndex < start + span;
      }) || null;
  }

  function tableCellDescriptorEquals(left, right) {
    return !!left && !!right
      && left.section === right.section
      && Number(left.rowIndex) === Number(right.rowIndex)
      && Number(left.columnIndex) === Number(right.columnIndex);
  }

  function tableSelectionContains(cells, descriptor) {
    return (cells || []).some((cell) => tableCellDescriptorEquals(cell, descriptor));
  }

  function clearTableSelection() {
    state.tableSelection = null;
    for (const cell of Array.from(nativeEditor.querySelectorAll(".sr-table-cell-selected"))) {
      cell.classList.remove("sr-table-cell-selected");
    }
  }

  function applyTableSelectionClasses() {
    for (const cell of Array.from(nativeEditor.querySelectorAll(".sr-table-cell-selected"))) {
      cell.classList.remove("sr-table-cell-selected");
    }
    const selection = state.tableSelection;
    if (!selection?.table) {
      return;
    }
    for (const descriptor of selection.cells || []) {
      tableCellElementFromDescriptor(selection.table, descriptor)?.classList?.add("sr-table-cell-selected");
    }
  }

  function setTableSelection(table, cells, anchor = null) {
    if (!table || !(cells || []).length) {
      clearTableSelection();
      return;
    }
    const normalized = normalizeTableSelectionCells(cells);
    state.tableSelection = {
      table,
      tableBlock: table.closest(".sr-block-table") || null,
      cells: normalized,
      anchor: anchor || normalized[0] || null,
    };
    applyTableSelectionClasses();
  }

  function tableCellsInRange(table, anchor, target) {
    if (!table || !anchor || !target) {
      return [];
    }
    if (anchor.section !== target.section || anchor.rowIndex !== target.rowIndex) {
      return [target];
    }
    const start = Math.min(anchor.columnIndex, target.columnIndex);
    const end = Math.max(anchor.columnIndex + anchor.colspan - 1, target.columnIndex + target.colspan - 1);
    return Array.from(table.querySelectorAll(`${anchor.section === "header" ? "th" : "td"}[data-sr-table-section="${anchor.section}"][data-row-index="${anchor.rowIndex}"]`))
      .map((cell) => tableCellDescriptor(cell))
      .filter((cell) => cell && cell.columnIndex <= end && (cell.columnIndex + cell.colspan - 1) >= start);
  }

  function updateTableSelectionFromInteraction(cell, event) {
    const table = cell?.closest?.("table");
    const descriptor = tableCellDescriptor(cell);
    if (!table || !descriptor) {
      clearTableSelection();
      return;
    }
    const current = state.tableSelection;
    const sameTable = current?.table === table;
    if (event?.shiftKey && sameTable && current?.anchor) {
      setTableSelection(table, tableCellsInRange(table, current.anchor, descriptor), current.anchor);
      return;
    }
    if ((event?.metaKey || event?.ctrlKey) && sameTable) {
      let nextCells = current.cells.slice();
      if (tableSelectionContains(nextCells, descriptor) && nextCells.length > 1) {
        nextCells = nextCells.filter((candidate) => !tableCellDescriptorEquals(candidate, descriptor));
      }
      else if (!tableSelectionContains(nextCells, descriptor)) {
        nextCells.push(descriptor);
      }
      setTableSelection(table, nextCells, current.anchor || descriptor);
      return;
    }
    setTableSelection(table, [descriptor], descriptor);
  }

  function selectedTableCellsForTarget(cell) {
    const table = cell?.closest?.("table");
    const descriptor = tableCellDescriptor(cell);
    const current = state.tableSelection;
    if (table && descriptor && current?.table === table && tableSelectionContains(current.cells, descriptor)) {
      return current.cells.slice();
    }
    return descriptor ? [descriptor] : [];
  }

  function beginTableDragSelection(cell) {
    const table = cell?.closest?.("table");
    const descriptor = tableCellDescriptor(cell);
    if (!table || !descriptor) {
      state.tableDrag = null;
      return;
    }
    state.suppressNextTableClick = false;
    state.tableDrag = {
      table,
      anchor: descriptor,
    };
  }

  function updateTableDragSelection(cell) {
    const drag = state.tableDrag;
    const table = cell?.closest?.("table");
    const descriptor = tableCellDescriptor(cell);
    if (!drag || !table || !descriptor || drag.table !== table) {
      return;
    }
    if (!tableCellDescriptorEquals(drag.anchor, descriptor)) {
      state.suppressNextTableClick = true;
    }
    setTableSelection(table, tableCellsInRange(table, drag.anchor, descriptor), drag.anchor);
  }

  function endTableDragSelection() {
    state.tableDrag = null;
  }

  function focusTableCellDescriptor(table, descriptor, { atEnd = false } = {}) {
    const cell = tableCellElementFromDescriptor(table, descriptor);
    const editable = cell?.querySelector?.(".sr-native-table-cell");
    if (!editable) {
      return null;
    }
    setActiveEditable(editable);
    if (atEnd) {
      focusEditableEnd(editable);
    }
    else {
      focusEditableStart(editable);
    }
    return editable;
  }

  function replaceNativeTableBlock(oldBlock, block, { focusCell = null, selectionCells = null } = {}) {
    const replacement = document.createElement("div");
    const renderState = {
      ...state,
      renderState: state.renderState || {},
    };
    replacement.innerHTML = renderNativeHTML(SystematicReviewerNativeMarkdown.serializeBlocks([SystematicReviewerNativeMarkdown.normalizeTableBlock(block)]), renderState);
    const newBlock = replacement.querySelector(".sr-block-table");
    if (!newBlock || !oldBlock?.parentNode) {
      return oldBlock;
    }
    newBlock.setAttribute("data-index", oldBlock.getAttribute("data-index") || String(Date.now()));
    oldBlock.replaceWith(newBlock);
    ensureNativeSurfaceReady();
    const table = newBlock.querySelector("table");
    if (selectionCells?.length) {
      setTableSelection(table, selectionCells, focusCell || selectionCells[0]);
    }
    else {
      clearTableSelection();
    }
    if (focusCell) {
      focusTableCellDescriptor(table, focusCell, { atEnd: true });
    }
    markNativeEditorDirty();
    return newBlock;
  }

  function insertColumnIntoTableBlock(block, boundaryIndex) {
    return SystematicReviewerNativeMarkdown.insertColumnIntoTableBlock(block, boundaryIndex);
  }

  function insertRowIntoTableBlock(block, rowIndex) {
    return SystematicReviewerNativeMarkdown.insertRowIntoTableBlock(block, rowIndex);
  }

  function deleteRowFromTableBlock(block, rowIndex) {
    return SystematicReviewerNativeMarkdown.deleteRowFromTableBlock(block, rowIndex);
  }

  function deleteColumnFromTableBlock(block, columnIndex) {
    return SystematicReviewerNativeMarkdown.deleteColumnFromTableBlock(block, columnIndex);
  }

  function applyAlignmentToTableBlock(block, cells, align) {
    return SystematicReviewerNativeMarkdown.applyAlignmentToTableBlock(block, cells, align);
  }

  function canMergeTableCells(cells) {
    return SystematicReviewerNativeMarkdown.canMergeTableCells(cells);
  }

  function mergeTableCellsInBlock(block, cells) {
    return SystematicReviewerNativeMarkdown.mergeTableCellsInBlock(block, cells);
  }

  function lastEditableInNode(node) {
    if (!node?.querySelectorAll) {
      return null;
    }
    const editables = Array.from(node.querySelectorAll("[data-sr-editable='true']"));
    return editables[editables.length - 1] || null;
  }

  function firstEditableInNode(node) {
    return node?.querySelector?.("[data-sr-editable='true']") || null;
  }

  function focusNearestEditableFromBlock(block) {
    const body = block?.closest?.(".sr-page-editor-body");
    let previous = block?.previousElementSibling || null;
    while (previous) {
      const editable = lastEditableInNode(previous);
      if (editable) {
        setActiveEditable(editable);
        focusEditableEnd(editable);
        return editable;
      }
      previous = previous.previousElementSibling;
    }
    let next = block?.nextElementSibling || null;
    while (next) {
      const editable = firstEditableInNode(next);
      if (editable) {
        setActiveEditable(editable);
        focusEditableStart(editable);
        return editable;
      }
      next = next.nextElementSibling;
    }
    const paragraph = ensureTrailingEditableParagraph(body);
    setActiveEditable(paragraph || state.nativeActiveEditable);
    focusEditableEnd(paragraph);
    return paragraph;
  }

  function focusNextTableCell(editable) {
    const cell = editable?.closest?.("td, th");
    const row = cell?.parentElement;
    const table = row?.closest?.("table");
    if (!cell || !row || !table) {
      return;
    }
    const descriptor = tableCellDescriptor(cell);
    if (!descriptor) {
      return;
    }
    let block = table.closest(".sr-block-table");
    const tableBlock = nativeTableBlockFromElement(block);
    let nextDescriptor = null;
    if (descriptor.section === "header") {
      nextDescriptor = { section: "body", rowIndex: 0, columnIndex: descriptor.columnIndex, colspan: 1 };
    }
    else if (descriptor.rowIndex + 1 < tableBlock.rows.length) {
      nextDescriptor = { section: "body", rowIndex: descriptor.rowIndex + 1, columnIndex: descriptor.columnIndex, colspan: 1 };
    }
    else {
      const nextBlock = insertRowIntoTableBlock(tableBlock, tableBlock.rows.length);
      block = replaceNativeTableBlock(block, nextBlock, {
        focusCell: { section: "body", rowIndex: nextBlock.rows.length - 1, columnIndex: descriptor.columnIndex, colspan: 1 },
        selectionCells: [{ section: "body", rowIndex: nextBlock.rows.length - 1, columnIndex: descriptor.columnIndex, colspan: 1 }],
      });
      return block;
    }
    setTableSelection(table, [nextDescriptor], nextDescriptor);
    focusTableCellDescriptor(table, nextDescriptor);
  }

  function ensureTrailingEditableParagraph(pageBody) {
    if (!pageBody) {
      return null;
    }
    const children = Array.from(pageBody.children).filter(Boolean);
    const last = children[children.length - 1] || null;
    const lastEditable = last?.querySelector?.(".sr-block-editable");
    const isBlankParagraph =
      last?.classList?.contains("sr-block-paragraph")
      && lastEditable
      && !String(lastEditable.textContent || "").trim()
      && !last.querySelector("img,table,figure");
    if (isBlankParagraph) {
      return lastEditable;
    }
    const paragraphBlock = createEmptyParagraphBlock();
    pageBody.appendChild(paragraphBlock);
    return paragraphBlock.querySelector(".sr-block-editable");
  }

  function insertHTMLIntoActiveEditable(html, fallback, selectionState = null) {
    const effectiveState = selectionState || currentInsertionState();
    const editable = effectiveState?.editable || state.nativeActiveEditable;
    if (!editable) {
      fallback?.();
      return;
    }
    restoreEditorSelectionState(effectiveState);
    try {
      const selection = document.defaultView.getSelection();
      let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!range && document.activeElement !== editable) {
        editable.focus();
      }
      const pageBody = editable.closest?.(".sr-page-editor-body") || activePageBody();
      const container = range?.commonAncestorContainer?.nodeType === 3
        ? range.commonAncestorContainer.parentNode
        : range?.commonAncestorContainer || null;
      const rangeWithinContext = !!(
        range
        && container
        && nativeEditor.contains(container)
        && (
          container === editable
          || editable.contains?.(container)
          || pageBody?.contains?.(container)
        )
      );
      if (!rangeWithinContext) {
        range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      range.deleteContents();
      const fragment = range.createContextualFragment(html);
      const lastNode = fragment.lastChild;
      range.insertNode(fragment);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      state.lastSelectionState = captureEditorSelectionState(editable);
    }
    catch (_error) {
      fallback?.();
    }
  }

  function splitPlainTextIntoParagraphLines(text = "") {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .split(/\n+/)
      .map((part) => String(part || "").trim())
      .filter(Boolean);
  }

  function ensureParagraphEditableAfterBlock(block) {
    if (!block) {
      return null;
    }
    const next = block.nextElementSibling;
    if (isEmptyParagraphNode(next)) {
      return next.querySelector(".sr-block-editable");
    }
    const paragraph = createEmptyParagraphBlock();
    block.after(paragraph);
    return paragraph.querySelector(".sr-block-editable");
  }

  function insertParagraphBlocksAfterBlock(block, lines = []) {
    if (!block || !Array.isArray(lines) || !lines.length) {
      return null;
    }
    let anchor = block;
    let reusableNext = block.nextElementSibling;
    let lastEditable = null;
    lines.forEach((line, index) => {
      let paragraph = null;
      if (index === 0 && isEmptyParagraphNode(reusableNext)) {
        paragraph = reusableNext;
        setEditableMarkdown(paragraph.querySelector(".sr-block-editable"), line);
      }
      else {
        paragraph = createParagraphBlock(line);
        anchor.after(paragraph);
      }
      anchor = paragraph;
      lastEditable = paragraph.querySelector(".sr-block-editable");
      reusableNext = paragraph.nextElementSibling;
    });
    return lastEditable;
  }

  function insertHardBreakIntoEditable(editable, selectionState = null) {
    if (!editable || editable.tagName?.toLowerCase() === "textarea") {
      return false;
    }
    const effectiveState = selectionState || captureEditorSelectionState(editable);
    insertHTMLIntoActiveEditable(
      '<br data-sr-hard-break="true">',
      () => {
        editable.focus();
        editable.insertAdjacentHTML("beforeend", '<br data-sr-hard-break="true">');
        focusEditableEnd(editable);
      },
      effectiveState
    );
    return true;
  }

  function insertPlainTextIntoNativeEditor(selectionState, text) {
    const source = String(text || "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
    if (!source) {
      return false;
    }
    let effectiveState = isUsableEditorSelectionState(selectionState) ? selectionState : currentInsertionState();
    if (selectionSpansMultipleEditables(effectiveState)) {
      deleteEditorSelection(effectiveState);
      effectiveState = currentInsertionState();
    }
    const editable = effectiveState?.editable || state.nativeActiveEditable;
    if (!editable) {
      return false;
    }
    if (editable.tagName?.toLowerCase() === "textarea") {
      insertTextIntoEditor(effectiveState, source);
      autosizeCodeTextarea(editable);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(editable);
      return true;
    }
    if (!source.includes("\n")) {
      insertTextIntoEditor(effectiveState, source);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(editable);
      return true;
    }
    if (editable.classList?.contains("sr-native-table-cell")) {
      insertTextIntoEditor(effectiveState, source.replace(/\s*\n+\s*/g, " "));
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(editable);
      return true;
    }
    const lines = splitPlainTextIntoParagraphLines(source);
    if (!lines.length) {
      return false;
    }
    restoreEditorSelectionState(effectiveState);
    const listItem = editable.closest(".sr-native-list-item");
    if (listItem) {
      const split = splitEditableAtSelection(editable);
      const listBlock = editable.closest("[data-block-type='list']");
      const ordered = listBlock?.getAttribute("data-list-kind") === "ol";
      const level = listItemLevel(listItem);
      setEditableMarkdown(editable, `${split.before}${lines[0]}`);
      let anchor = listItem;
      for (let index = 1; index < lines.length; index += 1) {
        const rowText = index === lines.length - 1
          ? `${lines[index]}${split.after}`
          : lines[index];
        const row = createListItemRow(rowText, ordered, 0, level);
        anchor.after(row);
        anchor = row;
      }
      if (lines.length === 1) {
        setEditableMarkdown(editable, `${split.before}${lines[0]}${split.after}`);
      }
      renumberListBlock(listBlock);
      const nextEditable = anchor.querySelector(".sr-block-editable") || editable;
      setActiveEditable(nextEditable || state.nativeActiveEditable);
      focusEditableEnd(nextEditable);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(nextEditable);
      return true;
    }
    const contextEditable = editable.matches?.(".sr-table-context, .sr-figure-context") ? editable : null;
    const contextBlock = contextEditable?.closest?.(".sr-native-block") || null;
    if (contextEditable && contextBlock) {
      const split = splitEditableAtSelection(editable);
      setEditableMarkdown(editable, `${split.before}${lines[0]}${split.after}`);
      const nextEditable = insertParagraphBlocksAfterBlock(contextBlock, lines.slice(1)) || editable;
      setActiveEditable(nextEditable || state.nativeActiveEditable);
      focusEditableEnd(nextEditable);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(nextEditable);
      return true;
    }
    const blockType = editable.closest(".sr-native-block")?.getAttribute("data-block-type") || "";
    if (["paragraph", "heading"].includes(blockType)) {
      const blocks = lines.map((line) => ({ type: "paragraph", text: line }));
      const nextMarkdown = buildNativeMarkdownWithInsertedBlocks(blocks, effectiveState);
      rebuildNativeEditorFromMarkdown(nextMarkdown);
      state.lastSelectionState = rememberDocumentInsertionState();
      return true;
    }
    insertTextIntoEditor(effectiveState, source.replace(/\s*\n+\s*/g, " "));
    markNativeEditorDirty();
    state.lastSelectionState = captureEditorSelectionState(editable);
    return true;
  }

  function focusNearestEditableForPageClick(pageBody, event) {
    if (!pageBody) {
      return null;
    }
    const blocks = Array.from(pageBody.children || []).filter((child) => child?.classList?.contains("sr-native-block"));
    if (!blocks.length) {
      const paragraph = ensureTrailingEditableParagraph(pageBody);
      if (paragraph) {
        focusEditableEnd(paragraph);
      }
      return paragraph;
    }
    const y = Number(event?.clientY || 0);
    const firstRect = blocks[0].getBoundingClientRect();
    if (y < firstRect.top - 10) {
      const firstEditable = firstEditableInNode(blocks[0]);
      if (firstEditable) {
        focusEditableStart(firstEditable);
      }
      return firstEditable;
    }
    const lastBlock = blocks[blocks.length - 1];
    const lastRect = lastBlock.getBoundingClientRect();
    if (y > lastRect.bottom + 14) {
      const paragraph = ensureTrailingEditableParagraph(pageBody);
      if (paragraph) {
        focusEditableEnd(paragraph);
      }
      return paragraph;
    }
    let closestBlock = blocks[0];
    let closestRect = blocks[0].getBoundingClientRect();
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBlock = block;
        closestRect = rect;
      }
    }
    const editable = lastEditableInNode(closestBlock) || firstEditableInNode(closestBlock);
    if (!editable) {
      return null;
    }
    if (y <= closestRect.top + 6) {
      focusEditableStart(editable);
    }
    else {
      focusEditableEnd(editable);
    }
    return editable;
  }

  function selectionSpansMultipleEditables(selectionState) {
    const range = selectionState?.range || null;
    if (!range || range.collapsed) {
      return false;
    }
    const startEditable = selectionBoundaryEditableFromRange(range, "start");
    const endEditable = selectionBoundaryEditableFromRange(range, "end");
    return !!(startEditable && endEditable && startEditable !== endEditable);
  }

  function normalizeNativeEditorAfterMutation(preferredEditable = null) {
    const blocks = serializeNativeBlocks();
    state.markdown = SystematicReviewerNativeMarkdown.serializeBlocks(blocks);
    state.renderState = {
      ...(state.renderState || {}),
      native_html: renderNativeHTML(state.markdown, state),
    };
    nativeEditor.innerHTML = state.renderState.native_html;
    ensureNativeSurfaceReady();
    const preferredBlock = preferredEditable?.closest?.(".sr-native-block") || null;
    const blockIndex = preferredBlock
      ? Array.from(nativeEditor.querySelectorAll(".sr-native-block")).indexOf(preferredBlock)
      : -1;
    const blockNodes = Array.from(nativeEditor.querySelectorAll(".sr-native-block"));
    const targetBlock = blockIndex >= 0
      ? blockNodes[Math.min(Math.max(blockIndex, 0), Math.max(blockNodes.length - 1, 0))]
      : null;
    const nextEditable =
      targetBlock?.querySelector?.("[data-sr-editable='true']")
      || nativeEditor.querySelector("[data-sr-editable='true']");
    setActiveEditable(nextEditable || state.nativeActiveEditable);
    if (nextEditable) {
      focusEditableStart(nextEditable);
    }
  }

  function replaceSelectedTextInTextarea(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = `${before}${text}${after}`;
    const nextPos = before.length + text.length;
    textarea.focus();
    textarea.setSelectionRange(nextPos, nextPos);
  }

  function insertIntoTextarea(textarea, insertText) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = `${before}${insertText}${after}`;
    const nextPos = before.length + insertText.length;
    textarea.setSelectionRange(nextPos, nextPos);
    textarea.focus();
  }

  function insertStructuredMarkdownIntoTextarea(textarea, markdownText = "") {
    if (!textarea) {
      return;
    }
    const text = String(markdownText || "").trim();
    if (!text) {
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const needsLeadingGap = before && !before.endsWith("\n\n");
    const needsTrailingGap = after && !after.startsWith("\n\n");
    const insertText = `${needsLeadingGap ? (before.endsWith("\n") ? "\n" : "\n\n") : ""}${text}${needsTrailingGap ? (after.startsWith("\n") ? "\n" : "\n\n") : ""}`;
    replaceSelectedTextInTextarea(textarea, insertText);
  }

  function captureRawSelectionState() {
    return {
      target: rawEditor,
      editable: rawEditor,
      textareaStart: rawEditor.selectionStart ?? 0,
      textareaEnd: rawEditor.selectionEnd ?? rawEditor.selectionStart ?? 0,
    };
  }

  function selectedTextInTextarea(textarea) {
    if (!textarea) {
      return "";
    }
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    return String(textarea.value || "").slice(start, end);
  }

  function replaceTextareaRange(textarea, start, end, text, nextSelectionStart = null, nextSelectionEnd = null) {
    if (!textarea) {
      return;
    }
    const value = String(textarea.value || "");
    const safeStart = Math.max(0, Math.min(value.length, Number(start || 0)));
    const safeEnd = Math.max(safeStart, Math.min(value.length, Number(end ?? safeStart)));
    textarea.value = `${value.slice(0, safeStart)}${text}${value.slice(safeEnd)}`;
    const selectionStart = nextSelectionStart === null ? safeStart + String(text || "").length : nextSelectionStart;
    const selectionEnd = nextSelectionEnd === null ? selectionStart : nextSelectionEnd;
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
  }

  function wrapSelectedTextInTextarea(textarea, prefix, suffix = prefix, fallbackText = "") {
    if (!textarea) {
      return;
    }
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const selected = String(textarea.value || "").slice(start, end);
    const inner = selected || fallbackText;
    const wrapped = `${prefix}${inner}${suffix}`;
    const nextStart = start + prefix.length;
    const nextEnd = nextStart + inner.length;
    replaceTextareaRange(textarea, start, end, wrapped, nextStart, nextEnd);
  }

  function selectedLineRangeInTextarea(textarea) {
    const value = String(textarea?.value || "");
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? start;
    const lineStart = Math.max(0, value.lastIndexOf("\n", Math.max(0, start - 1)) + 1);
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd < 0) {
      lineEnd = value.length;
    }
    const selectedValue = value.slice(lineStart, lineEnd);
    return {
      value,
      start,
      end,
      lineStart,
      lineEnd,
      lines: selectedValue.split("\n"),
    };
  }

  function updateSelectedLinesInTextarea(textarea, updater) {
    const range = selectedLineRangeInTextarea(textarea);
    const updatedLines = updater((range.lines || []).slice(), range) || range.lines;
    const replacement = Array.isArray(updatedLines) ? updatedLines.join("\n") : String(updatedLines || "");
    replaceTextareaRange(textarea, range.lineStart, range.lineEnd, replacement);
  }

  function applyHeadingToRawSelection(level = 0) {
    updateSelectedLinesInTextarea(rawEditor, (lines) => lines.map((line) => {
      const stripped = String(line || "").replace(/^#{1,6}\s+/, "");
      if (level <= 0) {
        return stripped;
      }
      return `${"#".repeat(Math.max(1, Math.min(6, Number(level || 1) || 1)))} ${stripped}`.trimEnd();
    }));
    markDirty();
  }

  function applyInlineFormatToRawSelection(command = "") {
    if (command === "bold") {
      wrapSelectedTextInTextarea(rawEditor, "**", "**", "text");
    }
    else if (command === "italic") {
      wrapSelectedTextInTextarea(rawEditor, "*", "*", "text");
    }
    else if (command === "underline") {
      wrapSelectedTextInTextarea(rawEditor, "<u>", "</u>", "text");
    }
    else {
      return;
    }
    markDirty();
  }

  function applyListToRawSelection(ordered = false) {
    updateSelectedLinesInTextarea(rawEditor, (lines) => lines.map((line, index) => {
      const stripped = String(line || "").replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1");
      const indentMatch = String(line || "").match(/^(\s*)/);
      const indent = indentMatch?.[1] || "";
      const prefix = ordered ? `${index + 1}.` : "-";
      return `${indent}${prefix} ${stripped.trimStart()}`.trimEnd();
    }));
    markDirty();
  }

  function currentRawSectionBounds() {
    const value = String(rawEditor.value || "");
    const start = rawEditor.selectionStart ?? 0;
    const before = value.slice(0, start);
    const pageBreak = String(SystematicReviewerNativeMarkdown.PAGE_BREAK_MARKDOWN || "<!-- sr:page-break -->");
    const previousBreak = before.lastIndexOf(pageBreak);
    const sectionStart = previousBreak >= 0 ? previousBreak + pageBreak.length : 0;
    const nextBreak = value.indexOf(pageBreak, start);
    const sectionEnd = nextBreak >= 0 ? nextBreak : value.length;
    return { value, sectionStart, sectionEnd };
  }

  function applyPageLayoutToRawSelection(layout = "portrait") {
    const nextLayout = String(layout || "").toLowerCase() === "landscape" ? "landscape" : "";
    if (!nextLayout) {
      return;
    }
    const { value, sectionStart, sectionEnd } = currentRawSectionBounds();
    const section = value.slice(sectionStart, sectionEnd);
    const layoutComment = "<!-- sr:page-layout:landscape -->";
    const layoutMatch = section.match(/^\s*<!--\s*sr:page-layout:landscape\s*-->\s*\n?/i);
    let replacement = section;
    if (layoutMatch) {
      replacement = section.replace(/^\s*<!--\s*sr:page-layout:landscape\s*-->\s*\n?/i, `${layoutComment}\n`);
    }
    else {
      replacement = `${layoutComment}\n${section.replace(/^\n+/, "")}`;
    }
    replaceTextareaRange(rawEditor, sectionStart, sectionEnd, replacement);
    markDirty();
  }

  function mergeProtectedRanges(ranges = []) {
    const normalized = (ranges || [])
      .map((range) => ({
        start: Math.max(0, Number(range?.start || 0) || 0),
        end: Math.max(0, Number(range?.end || 0) || 0),
      }))
      .filter((range) => range.end > range.start)
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const range of normalized) {
      const previous = merged[merged.length - 1] || null;
      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
        continue;
      }
      previous.end = Math.max(previous.end, range.end);
    }
    return merged;
  }

  function protectedMarkdownRanges(sourceText = "") {
    const source = String(sourceText || "");
    const ranges = [];
    const citationRe = /@\[[^\]\r\n]*\](?:\{[\s\S]*?\})?/g;
    const structuralCommentRe = /<!--\s*sr:[\s\S]*?-->/gi;
    const pageMarkerLineRe = /^\s*<[-]{1,2}page\d+[-]{1,2}>\s*$/gim;
    let match = null;
    while ((match = citationRe.exec(source))) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    while ((match = structuralCommentRe.exec(source))) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    while ((match = pageMarkerLineRe.exec(source))) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    const protectedTokens = [
      String(SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN || "").trim(),
      String(SystematicReviewerNativeMarkdown.PRISMA_PLACEHOLDER_MARKDOWN || "").trim(),
      String(SystematicReviewerNativeMarkdown.PAGE_BREAK_MARKDOWN || "").trim(),
    ].filter(Boolean);
    for (const token of protectedTokens) {
      let index = source.indexOf(token);
      while (index >= 0) {
        ranges.push({
          start: index,
          end: index + token.length,
        });
        index = source.indexOf(token, index + token.length);
      }
    }
    return mergeProtectedRanges(ranges);
  }

  function rangeIntersectsProtected(start, end, protectedRanges = []) {
    return (protectedRanges || []).some((range) => start < range.end && end > range.start);
  }

  function literalFindMatches(sourceText = "", queryText = "", options = {}) {
    const source = String(sourceText || "");
    const query = String(queryText || "");
    if (!query) {
      return [];
    }
    const scopeStart = Math.max(0, Math.min(source.length, Number(options?.scopeStart || 0) || 0));
    const scopeEnd = Math.max(scopeStart, Math.min(source.length, Number(options?.scopeEnd ?? source.length) || source.length));
    const matchCase = !!options?.matchCase;
    const protectedRanges = Array.isArray(options?.protectedRanges)
      ? options.protectedRanges
      : protectedMarkdownRanges(source);
    const haystack = matchCase ? source : source.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    const matches = [];
    let searchIndex = scopeStart;
    while (searchIndex <= scopeEnd - needle.length) {
      const found = haystack.indexOf(needle, searchIndex);
      if (found < 0 || found >= scopeEnd) {
        break;
      }
      const end = found + needle.length;
      if (end <= scopeEnd && !rangeIntersectsProtected(found, end, protectedRanges)) {
        matches.push({ start: found, end });
      }
      searchIndex = found + Math.max(needle.length, 1);
    }
    return matches;
  }

  function setTextareaSelection(textarea, start, end, { focus = true } = {}) {
    if (!textarea) {
      return;
    }
    if (focus) {
      textarea.focus();
    }
    textarea.setSelectionRange(Math.max(0, Number(start || 0) || 0), Math.max(0, Number(end || 0) || 0));
  }

  function resolveFindSelectionScope(selectionState = null) {
    const markdown = currentMarkdown();
    if (state.mode === "raw") {
      const start = rawEditor.selectionStart ?? 0;
      const end = rawEditor.selectionEnd ?? start;
      if (end > start) {
        return {
          available: true,
          start,
          end,
          label: "Selected text",
        };
      }
      return {
        available: false,
        start: 0,
        end: markdown.length,
        label: "Whole document",
      };
    }
    if (selectionState && editorHasSelection(selectionState)) {
      const selectedMarkdown = selectionMarkdownFromState(selectionState);
      const selectedText = String(selectedMarkdown || "").trim();
      if (selectedText) {
        const start = markdown.indexOf(selectedText);
        if (start >= 0) {
          return {
            available: true,
            start,
            end: start + selectedText.length,
            label: "Selected text",
          };
        }
      }
    }
    return {
      available: false,
      start: 0,
      end: markdown.length,
      label: "Whole document",
    };
  }

  function isFindPanelOverlay(overlay = state.overlay) {
    return !!(overlay?.getAttribute?.("data-sr-overlay-type") === "find-panel");
  }

  function clearFindHighlightLayer(surface) {
    const scrollNode = surface === "native"
      ? nativeScrollNode()
      : (surface === "preview" ? previewScrollNode() : null);
    scrollNode?.querySelector?.(`.sr-find-highlight-layer[data-sr-surface="${surface}"]`)?.remove?.();
  }

  function clearAllFindHighlightLayers() {
    clearFindHighlightLayer("preview");
    clearFindHighlightLayer("native");
  }

  function findVisibleTextMatches(rootNode, queryText = "", { matchCase = false } = {}) {
    const root = rootNode || null;
    const query = String(queryText || "");
    if (!root || !query) {
      return [];
    }
    const needle = matchCase ? query : query.toLowerCase();
    const matches = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node?.parentNode;
        if (!parent || !root.contains(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!String(node.textContent || "").trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest?.(".sr-citation-chip,[data-block-type='bibliography'],[data-block-type='prisma'],[data-sr-editable='false'],.sr-find-highlight-layer,script,style")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let textNode = walker.nextNode();
    while (textNode) {
      const source = String(textNode.textContent || "");
      const haystack = matchCase ? source : source.toLowerCase();
      let searchFrom = 0;
      while (searchFrom <= haystack.length - needle.length) {
        const found = haystack.indexOf(needle, searchFrom);
        if (found < 0) {
          break;
        }
        const range = document.createRange();
        range.setStart(textNode, found);
        range.setEnd(textNode, found + query.length);
        const rects = Array.from(range.getClientRects())
          .filter((rect) => Number(rect.width || 0) > 0 && Number(rect.height || 0) > 0)
          .map((rect) => ({
            left: Number(rect.left || 0) || 0,
            top: Number(rect.top || 0) || 0,
            width: Number(rect.width || 0) || 0,
            height: Number(rect.height || 0) || 0,
          }));
        if (rects.length) {
          matches.push({ rects });
        }
        searchFrom = found + Math.max(needle.length, 1);
      }
      textNode = walker.nextNode();
    }
    return matches;
  }

  function renderFindHighlights(dialogState = null) {
    clearAllFindHighlightLayers();
    if (!dialogState?.query || !dialogState?.matches?.length) {
      return [];
    }
    const surface = surfaceForMode(state.mode);
    if (!["preview", "native"].includes(surface)) {
      return [];
    }
    const scrollNode = surface === "native" ? nativeScrollNode() : previewScrollNode();
    const root = surface === "native"
      ? nativeEditor.querySelector(".sr-native-root")
      : preview.querySelector(".sr-markdown-document");
    if (!scrollNode || !root || scrollNode.hidden || root.hidden) {
      return [];
    }
    const allVisible = findVisibleTextMatches(root, dialogState.query, {
      matchCase: !!dialogState.matchCase,
    });
    const offset = Math.max(0, Number(dialogState.globalMatchOffset || 0) || 0);
    const visibleMatches = allVisible.slice(offset, offset + dialogState.matches.length);
    if (!visibleMatches.length) {
      dialogState.visibleSurface = {
        surface,
        matches: [],
      };
      return [];
    }
    const scrollRect = scrollNode.getBoundingClientRect();
    const layer = createNode("div", {
      className: "sr-find-highlight-layer",
      attrs: {
        "data-sr-surface": surface,
      },
    });
    const layerWidth = Math.max(Number(scrollNode.scrollWidth || 0) || 0, Number(scrollNode.clientWidth || 0) || 0);
    const layerHeight = Math.max(Number(scrollNode.scrollHeight || 0) || 0, Number(scrollNode.clientHeight || 0) || 0);
    layer.style.width = `${layerWidth}px`;
    layer.style.height = `${layerHeight}px`;
    const normalized = visibleMatches.map((match, index) => {
      const rects = (match.rects || []).map((rect) => ({
        left: rect.left - scrollRect.left + (Number(scrollNode.scrollLeft || 0) || 0),
        top: rect.top - scrollRect.top + (Number(scrollNode.scrollTop || 0) || 0),
        width: rect.width,
        height: rect.height,
      }));
      let union = null;
      rects.forEach((rect) => {
        const node = createNode("div", {
          className: `sr-find-highlight${index === dialogState.activeIndex ? " is-active" : ""}`,
        });
        node.style.left = `${rect.left}px`;
        node.style.top = `${rect.top}px`;
        node.style.width = `${rect.width}px`;
        node.style.height = `${rect.height}px`;
        layer.appendChild(node);
        if (!union) {
          union = {
            left: rect.left,
            top: rect.top,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
          };
        }
        else {
          union.left = Math.min(union.left, rect.left);
          union.top = Math.min(union.top, rect.top);
          union.right = Math.max(union.right, rect.left + rect.width);
          union.bottom = Math.max(union.bottom, rect.top + rect.height);
        }
      });
      return {
        rects,
        union: union
          ? {
              left: union.left,
              top: union.top,
              width: Math.max(0, union.right - union.left),
              height: Math.max(0, union.bottom - union.top),
            }
          : null,
      };
    });
    scrollNode.appendChild(layer);
    dialogState.visibleSurface = {
      surface,
      matches: normalized,
    };
    return normalized;
  }

  function revealActiveFindMatch(dialogState = null, { restorePanelFocus = false } = {}) {
    if (!dialogState?.matches?.length || dialogState.activeIndex < 0 || dialogState.activeIndex >= dialogState.matches.length) {
      return false;
    }
    const focusTarget = restorePanelFocus && state.findPanel?.panel?.contains?.(restorePanelFocus)
      ? restorePanelFocus
      : null;
    if (state.mode === "raw") {
      const match = dialogState.matches[dialogState.activeIndex];
      setTextareaSelection(rawEditor, match.start, match.end);
      rawEditor.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      if (focusTarget) {
        nextFrame(() => {
          try {
            focusTarget.focus({ preventScroll: true });
          }
          catch (_error) {}
        });
      }
      return true;
    }
    const surface = surfaceForMode(state.mode);
    if (!["preview", "native"].includes(surface)) {
      return false;
    }
    const visibleMatches = renderFindHighlights(dialogState);
    const target = visibleMatches[dialogState.activeIndex]?.union || null;
    const scrollNode = surface === "native" ? nativeScrollNode() : previewScrollNode();
    if (!target || !scrollNode) {
      return false;
    }
    const applyScroll = surface === "native" ? withProgrammaticNativeScroll : withProgrammaticPreviewScroll;
    applyScroll(() => {
      const nextTop = Math.max(0, target.top - ((Number(scrollNode.clientHeight || 0) || 0) / 2) + (target.height / 2));
      const nextLeft = Math.max(0, target.left - ((Number(scrollNode.clientWidth || 0) || 0) / 2) + (target.width / 2));
      scrollNode.scrollTop = nextTop;
      scrollNode.scrollLeft = nextLeft;
    });
    if (focusTarget) {
      nextFrame(() => {
        try {
          focusTarget.focus({ preventScroll: true });
        }
        catch (_error) {}
      });
    }
    return true;
  }

  function scheduleFindPanelRefresh(options = {}) {
    const panelState = state.findPanel;
    if (!panelState || state.destroyed) {
      clearAllFindHighlightLayers();
      return;
    }
    const delay = Math.max(0, Number(options?.delay ?? 60) || 0);
    if (panelState.refreshTimer) {
      window.clearTimeout(panelState.refreshTimer);
      panelState.refreshTimer = 0;
    }
    const run = () => {
      panelState.refreshTimer = 0;
      panelState.refresh?.({
        preserveIndex: options?.preserveIndex !== false,
        renderOnly: !!options?.renderOnly,
      });
    };
    if (delay <= 0) {
      run();
      return;
    }
    panelState.refreshTimer = window.setTimeout(run, delay);
  }

  async function applyMarkdownMutation(nextMarkdown = "", options = {}) {
    const source = String(nextMarkdown || "");
    state.markdown = source;
    rawEditor.value = source;
    state.markdownRevision += 1;
    state.dirty = true;
    state.nativeDirty = false;
    saveBtn.classList.toggle("sr-workspace-btn-primary", true);
    invalidateRenderedSurfaces();
    if (Number.isFinite(options?.selectionStart) && Number.isFinite(options?.selectionEnd)) {
      setTextareaSelection(rawEditor, options.selectionStart, options.selectionEnd);
    }
    await refreshCitationDependentRendering(source);
    const renderState = await syncInMemoryRenderState(source, { preservePreviewScroll: true });
    if (state.mode === "native" && renderState) {
      const mounted = applyRenderState(renderState, { surfaces: ["native"] });
      state.renderedSignature.native = mounted.native ? currentRenderSignature() : "";
    }
  }

  async function openFindReplaceDialog(selectionState = null) {
    closeOverlay();
    clearAllFindHighlightLayers();
    const sessionState = Object.assign({
      query: "",
      replaceText: "",
      matchCase: false,
      scopeMode: "document",
    }, state.findPanelSession || {});
    const initialSelectionScope = resolveFindSelectionScope(selectionState);
    const overlay = createNode("div", {
      className: "sr-find-floating-shell",
      attrs: { "data-sr-overlay-type": "find-panel" },
    });
    const dialog = createNode("div", {
      className: "sr-find-panel",
      attrs: { role: "dialog", "aria-modal": "false", "aria-label": "Find and replace" },
    });
    const findInput = document.createElement("input");
    findInput.type = "search";
    findInput.className = "sr-field-input";
    findInput.placeholder = "Find";
    findInput.value = String(sessionState.query || "");
    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.className = "sr-field-input";
    replaceInput.placeholder = "Replace";
    replaceInput.value = String(sessionState.replaceText || "");
    const scopeSelect = createSelect("sr-editor-select sr-find-panel-select");
    scopeSelect.appendChild(createOption("document", "Whole document"));
    if (initialSelectionScope.available) {
      scopeSelect.appendChild(createOption("selection", "Selected text"));
      scopeSelect.value = sessionState.scopeMode === "selection" ? "selection" : "document";
    }
    else {
      scopeSelect.value = "document";
    }
    const matchCaseToggle = document.createElement("input");
    matchCaseToggle.type = "checkbox";
    matchCaseToggle.checked = !!sessionState.matchCase;
    const statusNode = createNode("div", { className: "sr-find-panel-status" });
    const prevBtn = createButton("Previous");
    const nextBtn = createButton("Next");
    const replaceBtn = createButton("Replace");
    const replaceAllBtn = createButton("Replace All");
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", { type: "button", "aria-label": "Close find panel" });
    const dialogState = {
      query: String(findInput.value || ""),
      replaceText: String(replaceInput.value || ""),
      matchCase: !!matchCaseToggle.checked,
      scopeMode: scopeSelect.value || "document",
      selectedScope: initialSelectionScope.available ? { ...initialSelectionScope } : null,
      matches: [],
      allMatches: [],
      activeIndex: -1,
      globalMatchOffset: 0,
      visibleSurface: { surface: "", matches: [] },
    };

    const rememberSession = () => {
      state.findPanelSession = {
        query: String(findInput.value || ""),
        replaceText: String(replaceInput.value || ""),
        matchCase: !!matchCaseToggle.checked,
        scopeMode: String(scopeSelect.value || "document"),
      };
    };

    const currentScopeBounds = () => {
      if (dialogState.scopeMode === "selection" && dialogState.selectedScope?.available) {
        return {
          start: dialogState.selectedScope.start,
          end: dialogState.selectedScope.end,
          label: "Selected text",
        };
      }
      return {
        start: 0,
        end: String(currentMarkdown() || "").length,
        label: "Whole document",
      };
    };

    const refreshMatches = ({ preserveIndex = false, renderOnly = false } = {}) => {
      dialogState.scopeMode = String(scopeSelect.value || "document");
      dialogState.matchCase = !!matchCaseToggle.checked;
      rememberSession();
      if (renderOnly) {
        renderFindHighlights(dialogState);
        return;
      }
      dialogState.query = String(findInput.value || "");
      dialogState.replaceText = String(replaceInput.value || "");
      const markdown = currentMarkdown();
      const scope = currentScopeBounds();
      dialogState.allMatches = literalFindMatches(markdown, dialogState.query, {
        matchCase: dialogState.matchCase,
      });
      dialogState.matches = literalFindMatches(markdown, dialogState.query, {
        matchCase: dialogState.matchCase,
        scopeStart: scope.start,
        scopeEnd: scope.end,
      });
      dialogState.globalMatchOffset = dialogState.matches.length
        ? Math.max(0, dialogState.allMatches.findIndex((entry) => entry.start === dialogState.matches[0].start && entry.end === dialogState.matches[0].end))
        : 0;
      if (!dialogState.query) {
        dialogState.activeIndex = -1;
        statusNode.textContent = "Enter text to search.";
      }
      else if (!dialogState.matches.length) {
        dialogState.activeIndex = -1;
        statusNode.textContent = `No matches in ${scope.label.toLowerCase()}.`;
      }
      else {
        dialogState.activeIndex = preserveIndex && dialogState.activeIndex >= 0
          ? Math.min(dialogState.activeIndex, dialogState.matches.length - 1)
          : 0;
        statusNode.textContent = `${dialogState.activeIndex + 1} of ${dialogState.matches.length} matches in ${scope.label.toLowerCase()}.`;
      }
      const hasMatches = dialogState.matches.length > 0;
      prevBtn.disabled = !hasMatches;
      nextBtn.disabled = !hasMatches;
      replaceBtn.disabled = !hasMatches;
      replaceAllBtn.disabled = !hasMatches;
      renderFindHighlights(dialogState);
    };

    const stepMatch = (direction = 1) => {
      if (!dialogState.matches.length) {
        refreshMatches({ preserveIndex: true });
        return;
      }
      const priorPanelFocus = dialog.contains(document.activeElement) ? document.activeElement : null;
      const total = dialogState.matches.length;
      dialogState.activeIndex = (dialogState.activeIndex + direction + total) % total;
      const scope = currentScopeBounds();
      statusNode.textContent = `${dialogState.activeIndex + 1} of ${total} matches in ${scope.label.toLowerCase()}.`;
      revealActiveFindMatch(dialogState, {
        restorePanelFocus: priorPanelFocus,
      });
    };

    const replaceCurrentMatch = async () => {
      if (dialogState.activeIndex < 0 || dialogState.activeIndex >= dialogState.matches.length) {
        return;
      }
      const priorPanelFocus = dialog.contains(document.activeElement) ? document.activeElement : null;
      const markdown = currentMarkdown();
      const match = dialogState.matches[dialogState.activeIndex];
      const nextMarkdown = `${markdown.slice(0, match.start)}${dialogState.replaceText}${markdown.slice(match.end)}`;
      const delta = dialogState.replaceText.length - (match.end - match.start);
      if (dialogState.scopeMode === "selection" && dialogState.selectedScope?.available) {
        dialogState.selectedScope.end += delta;
      }
      await applyMarkdownMutation(nextMarkdown, {
        selectionStart: match.start,
        selectionEnd: match.start + dialogState.replaceText.length,
      });
      refreshMatches({ preserveIndex: true });
      revealActiveFindMatch(dialogState, {
        restorePanelFocus: priorPanelFocus,
      });
    };

    const replaceAllMatches = async () => {
      if (!dialogState.matches.length) {
        return;
      }
      const priorPanelFocus = dialog.contains(document.activeElement) ? document.activeElement : null;
      let nextMarkdown = currentMarkdown();
      let delta = 0;
      for (let index = dialogState.matches.length - 1; index >= 0; index -= 1) {
        const match = dialogState.matches[index];
        nextMarkdown = `${nextMarkdown.slice(0, match.start)}${dialogState.replaceText}${nextMarkdown.slice(match.end)}`;
        delta += dialogState.replaceText.length - (match.end - match.start);
      }
      if (dialogState.scopeMode === "selection" && dialogState.selectedScope?.available) {
        dialogState.selectedScope.end += delta;
      }
      await applyMarkdownMutation(nextMarkdown);
      refreshMatches({ preserveIndex: false });
      if (priorPanelFocus) {
        nextFrame(() => {
          try {
            priorPanelFocus.focus({ preventScroll: true });
          }
          catch (_error) {}
        });
      }
    };

    dialog.append(
      createNode("div", {
        className: "sr-find-panel-header",
        children: [
          createNode("div", {
            className: "sr-find-panel-heading",
            children: [
              createNode("div", { className: "sr-find-panel-title", textContent: "Find and replace" }),
              createNode("div", { className: "sr-find-panel-subtitle", textContent: "Search stays in markdown, highlights matches on screen, and skips citations plus SR structural tokens." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-find-panel-body",
        children: [
          createNode("label", { className: "sr-field-label", textContent: "Find", children: [findInput] }),
          createNode("label", { className: "sr-field-label", textContent: "Replace", children: [replaceInput] }),
          createNode("div", {
            className: "sr-find-panel-row",
            children: [
              createNode("label", { className: "sr-field-label", textContent: "Scope", children: [scopeSelect] }),
              createNode("label", {
                className: "sr-find-panel-matchcase",
                children: [matchCaseToggle, document.createTextNode("Match case")],
              }),
            ],
          }),
          statusNode,
          createNode("div", {
            className: "sr-find-panel-actions",
            children: [
              createNode("div", {
                className: "sr-find-panel-replace-actions",
                children: [prevBtn, nextBtn],
              }),
              createNode("div", {
                className: "sr-find-panel-replace-actions",
                children: [replaceBtn, replaceAllBtn],
              }),
            ],
          }),
        ],
      }),
    );

    const resultPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (state.overlay === overlay) {
          closeOverlay();
          return;
        }
        overlay.__srCleanup?.();
        overlay.remove();
      };
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (state.findPanel?.overlay === overlay) {
          if (state.findPanel.refreshTimer) {
            window.clearTimeout(state.findPanel.refreshTimer);
          }
          state.findPanel = null;
        }
        clearAllFindHighlightLayers();
        window.removeEventListener("keydown", keyHandler, true);
        window.removeEventListener("mousemove", dragMoveHandler, true);
        window.removeEventListener("mouseup", dragEndHandler, true);
        resolve(null);
      };
      overlay.__srCleanup = cleanup;

      const hostBounds = () => host?.getBoundingClientRect?.() || {
        left: 8,
        top: 8,
        right: window.innerWidth - 8,
        bottom: window.innerHeight - 8,
      };
      const clampPosition = (left, top) => {
        const bounds = hostBounds();
        const width = Math.max(300, Number(dialog.offsetWidth || 0) || 410);
        const height = Math.max(180, Number(dialog.offsetHeight || 0) || 240);
        const minLeft = Math.max(8, Math.round(bounds.left) + 8);
        const minTop = Math.max(8, Math.round(bounds.top) + 8);
        const maxLeft = Math.max(minLeft, Math.round(bounds.right - width - 8));
        const maxTop = Math.max(minTop, Math.round(bounds.bottom - height - 8));
        return {
          left: Math.min(maxLeft, Math.max(minLeft, Math.round(left))),
          top: Math.min(maxTop, Math.max(minTop, Math.round(top))),
        };
      };
      const applyPanelPosition = (left, top) => {
        const next = clampPosition(left, top);
        dialog.style.left = `${next.left}px`;
        dialog.style.top = `${next.top}px`;
        state.findPanelPosition = next;
      };
      const dragState = {
        active: false,
        offsetX: 0,
        offsetY: 0,
      };
      const dragMoveHandler = (event) => {
        if (!dragState.active) {
          return;
        }
        applyPanelPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
      };
      const dragEndHandler = () => {
        dragState.active = false;
      };
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && String(event.key || "").toLowerCase() === "g") {
          event.preventDefault();
          stepMatch(event.shiftKey ? -1 : 1);
          return;
        }
        if (event.key === "Enter" && event.target === findInput) {
          event.preventDefault();
          stepMatch(event.shiftKey ? -1 : 1);
        }
      };
      closeBtn.addEventListener("click", () => finish(), { once: true });
      findInput.addEventListener("input", () => {
        rememberSession();
        scheduleFindPanelRefresh({
          preserveIndex: false,
          delay: 90,
        });
      });
      replaceInput.addEventListener("input", () => {
        dialogState.replaceText = String(replaceInput.value || "");
        rememberSession();
      });
      scopeSelect.addEventListener("change", () => refreshMatches({ preserveIndex: false }));
      matchCaseToggle.addEventListener("change", () => refreshMatches({ preserveIndex: false }));
      prevBtn.addEventListener("click", () => stepMatch(-1));
      nextBtn.addEventListener("click", () => stepMatch(1));
      replaceBtn.addEventListener("click", () => replaceCurrentMatch().catch((error) => setStatus(error?.message || String(error), "error")));
      replaceAllBtn.addEventListener("click", () => replaceAllMatches().catch((error) => setStatus(error?.message || String(error), "error")));
      dialog.querySelector(".sr-find-panel-header")?.addEventListener("mousedown", (event) => {
        if (event.button !== 0) {
          return;
        }
        if (event.target?.closest?.("button,input,select,textarea")) {
          return;
        }
        const rect = dialog.getBoundingClientRect();
        dragState.active = true;
        dragState.offsetX = event.clientX - rect.left;
        dragState.offsetY = event.clientY - rect.top;
        event.preventDefault();
      });
      window.addEventListener("keydown", keyHandler, true);
      window.addEventListener("mousemove", dragMoveHandler, true);
      window.addEventListener("mouseup", dragEndHandler, true);
      state.findPanel = {
        overlay,
        panel: dialog,
        dialogState,
        refreshTimer: 0,
        refresh(options = {}) {
          refreshMatches(options);
        },
        applyPosition(left, top) {
          applyPanelPosition(left, top);
        },
      };
      nextFrame(() => {
        const preferred = state.findPanelPosition || (() => {
          const bounds = hostBounds();
          return {
            left: bounds.right - Math.max(300, Number(dialog.offsetWidth || 0) || 410) - 24,
            top: bounds.top + 24,
          };
        })();
        applyPanelPosition(preferred.left, preferred.top);
      });
    });

    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    refreshMatches({ preserveIndex: false });
    findInput.focus();
    findInput.select();
    return await resultPromise;
  }

  function focusExistingPrismaToken() {
    const token = prismaPlaceholderToken();
    const source = String(rawEditor.value || "");
    const index = source.indexOf(token);
    if (index < 0) {
      return false;
    }
    rawEditor.focus();
    rawEditor.setSelectionRange(index, index + token.length);
    return true;
  }

  function focusExistingTOCToken() {
    const token = String(SystematicReviewerNativeMarkdown.TOC_PLACEHOLDER_MARKDOWN || "").trim();
    const source = String(rawEditor.value || "");
    const index = source.indexOf(token);
    if (index < 0) {
      return false;
    }
    rawEditor.focus();
    rawEditor.setSelectionRange(index, index + token.length);
    return true;
  }

  function focusExistingBibliographyToken() {
    const token = String(SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN || "").trim();
    const source = String(rawEditor.value || "");
    const index = source.indexOf(token);
    if (index < 0) {
      return false;
    }
    rawEditor.focus();
    rawEditor.setSelectionRange(index, index + token.length);
    return true;
  }

  function focusExistingPrismaBlock(block = null) {
    const existingBlock = block || nativeEditor.querySelector("[data-block-type='prisma']");
    if (!existingBlock) {
      return false;
    }
    existingBlock.scrollIntoView({ block: "center", inline: "nearest" });
    const focusTarget = existingBlock.querySelector(".sr-block-editable") || existingBlock;
    try {
      focusTarget.setAttribute("tabindex", "-1");
      focusTarget.focus({ preventScroll: true });
    }
    catch (_error) {}
    try {
      const selection = document.defaultView.getSelection();
      const range = document.createRange();
      range.selectNodeContents(focusTarget);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    catch (_error) {}
    return true;
  }

  function focusExistingTOCBlock(block = null) {
    const existingBlock = block || nativeEditor.querySelector("[data-block-type='toc']");
    if (!existingBlock) {
      return false;
    }
    existingBlock.scrollIntoView({ block: "center", inline: "nearest" });
    const focusTarget = existingBlock.querySelector(".sr-block-static, .sr-block-editable") || existingBlock;
    try {
      focusTarget.setAttribute("tabindex", "-1");
      focusTarget.focus({ preventScroll: true });
    }
    catch (_error) {}
    return true;
  }

  function focusExistingBibliographyBlock(block = null) {
    const existingBlock = block || nativeEditor.querySelector("[data-block-type='bibliography']");
    if (!existingBlock) {
      return false;
    }
    existingBlock.scrollIntoView({ block: "center", inline: "nearest" });
    const focusTarget = existingBlock.querySelector(".sr-block-editable") || existingBlock;
    try {
      focusTarget.setAttribute("tabindex", "-1");
      focusTarget.focus({ preventScroll: true });
    }
    catch (_error) {}
    try {
      const selection = document.defaultView.getSelection();
      const range = document.createRange();
      range.selectNodeContents(focusTarget);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    catch (_error) {}
    return true;
  }

  function headingText(block = null) {
    return String(block?.type === "heading" ? block.text || "" : "").trim();
  }

  function isAppendixHeadingBlock(block = null) {
    return block?.type === "heading" && /^appendix(?:es)?\b/i.test(headingText(block));
  }

  function isBibliographyHeadingBlock(block = null) {
    return block?.type === "heading" && /^bibliography$/i.test(headingText(block));
  }

  function isPrismaHeadingBlock(block = null) {
    return block?.type === "heading" && /^prisma$/i.test(headingText(block));
  }

  function findFirstBlockIndex(blocks = [], predicate = () => false) {
    return Array.isArray(blocks) ? blocks.findIndex((block) => predicate(block)) : -1;
  }

  function insertSingletonSectionIntoBlocks(sourceBlocks = [], kind = "bibliography") {
    const blocks = Array.isArray(sourceBlocks) ? sourceBlocks.slice() : [];
    if (kind === "bibliography") {
      const existingBibliographyIndex = findFirstBlockIndex(blocks, (block) => block?.type === "bibliography");
      if (existingBibliographyIndex >= 0) {
        return { blocks, inserted: false, kind };
      }
      const appendixIndex = findFirstBlockIndex(blocks, isAppendixHeadingBlock);
      const insertionIndex = appendixIndex >= 0 ? appendixIndex : blocks.length;
      blocks.splice(insertionIndex, 0, ...bibliographySectionBlocks());
      return { blocks, inserted: true, kind };
    }
    if (kind === "prisma") {
      const existingPrismaIndex = findFirstBlockIndex(blocks, (block) => block?.type === "prisma");
      if (existingPrismaIndex >= 0) {
        return { blocks, inserted: false, kind };
      }
      const bibliographyIndex = findFirstBlockIndex(blocks, (block) => block?.type === "bibliography");
      const appendixIndex = findFirstBlockIndex(blocks, isAppendixHeadingBlock);
      let insertionIndex = blocks.length;
      if (bibliographyIndex >= 0) {
        insertionIndex = bibliographyIndex;
      }
      else if (appendixIndex >= 0) {
        insertionIndex = appendixIndex;
      }
      blocks.splice(insertionIndex, 0, ...prismaScaffoldBlocks());
      return { blocks, inserted: true, kind };
    }
    return { blocks, inserted: false, kind };
  }

  async function ensurePrismaRenderHTML(markdown = "") {
    const existingHTML = String(state.renderState?.prisma_html || "").trim();
    if (existingHTML) {
      return existingHTML;
    }
    try {
      const prismaState = await ctx.invoke("prisma.getState");
      const html = renderPrismaFigureHTML(prismaState, {
        markdown: typeof markdown === "string" ? markdown : state.markdown,
        editorSettings: state.editorSettings,
        doc: document,
      });
      state.renderState = {
        ...(state.renderState || {}),
        prisma_html: html,
      };
      return html;
    }
    catch (error) {
      const html = prismaFallbackHTML(error?.message || String(error));
      state.renderState = {
        ...(state.renderState || {}),
        prisma_html: html,
      };
      return html;
    }
  }

  function applyPrismaHTMLToMountedSurfaces(prismaHTML) {
    const normalizedHTML = String(prismaHTML || "").trim() || prismaFallbackHTML();
    state.renderState = {
      ...(state.renderState || {}),
      prisma_html: normalizedHTML,
      preview_html: "",
      native_html: "",
    };
    state.renderedSignature.preview = "";
    state.renderedSignature.native = "";

    const parsed = document.createElement("div");
    parsed.innerHTML = normalizedHTML;
    const parsedNode = parsed.firstElementChild;

    Array.from(nativeEditor.querySelectorAll("[data-block-type='prisma'] .sr-block-editable")).forEach((container) => {
      container.innerHTML = normalizedHTML;
    });
    ensureNativeSurfaceReady();

    if (parsedNode) {
      Array.from(preview.querySelectorAll(".sr-prisma-figure[data-sr-prisma='true'], .sr-prisma-empty[data-sr-prisma='true']")).forEach((node) => {
        node.replaceWith(parsedNode.cloneNode(true));
      });
    }

    scheduleSurfaceReflow("native", { immediate: true, delay: 0 });
    if (preview.querySelector(".sr-page-sheet, .sr-prisma-figure[data-sr-prisma='true'], .sr-prisma-empty[data-sr-prisma='true']")) {
      scheduleSurfaceReflow("preview", { immediate: true, delay: 0 });
    }
  }

  async function openPrismaEditorDialog(prismaBlock = null) {
    if (!prismaBlock) {
      return;
    }
    closeOverlay();
    const prismaController = createPrismaSurface({
      createNode,
      invoke: ctx.invoke,
      setStatus,
    }, {
      embedded: true,
      onStateSaved: async (prismaState) => {
        const html = renderPrismaFigureHTML(prismaState, {
          markdown: currentMarkdown(),
          editorSettings: state.editorSettings,
          doc: document,
        });
        applyPrismaHTMLToMountedSurfaces(html);
        await ensureRenderedSurface("preview", null, {
          preservePreviewScroll: true,
        });
      },
    });
    const prismaNode = prismaController?.node || null;
    if (!prismaNode) {
      return;
    }
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", {
      type: "button",
      "aria-label": "Close PRISMA editor",
    });
    const dialog = createNode("div", {
      className: "sr-dialog sr-prisma-editor-dialog",
      children: [
        createNode("div", {
          className: "sr-dialog-header",
          children: [
            createNode("div", {
              className: "sr-dialog-heading",
              children: [
                createNode("div", { className: "sr-dialog-title", textContent: "Edit PRISMA" }),
                createNode("div", {
                  className: "sr-dialog-subtitle",
                  textContent: "Adjust PRISMA settings, refresh or save the diagram, export PNG, and right-click diagram nodes to edit them.",
                }),
              ],
            }),
            closeBtn,
          ],
        }),
        createNode("div", {
          className: "sr-dialog-body sr-prisma-editor-dialog-body",
          children: [prismaNode],
        }),
      ],
    });
    let settled = false;
    overlay.__srCleanup = () => {
      try {
        prismaController?.destroy?.();
      }
      catch (_error) {}
    };
    const keyHandler = (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        closeDialog();
      }
    };
    const closeDialog = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("keydown", keyHandler, true);
      closeOverlay();
    };
    closeBtn.addEventListener("click", () => closeDialog(), { once: true });
    overlay.addEventListener("click", (overlayEvent) => {
      if (overlayEvent.target === overlay) {
        closeDialog();
      }
    });
    window.addEventListener("keydown", keyHandler, true);
    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    const initialFocus =
      prismaNode.querySelector("button, input, select, textarea, [tabindex]")
      || closeBtn;
    initialFocus?.focus?.();
  }

  function rebuildNativeEditorFromMarkdown(markdown, { focusPrisma = false } = {}) {
    state.markdown = String(markdown || "");
    state.markdownRevision += 1;
    state.dirty = true;
    state.nativeDirty = true;
    saveBtn.classList.toggle("sr-workspace-btn-primary", true);
    invalidateRenderedSurfaces();
    nativeEditor.innerHTML = renderNativeHTML(state.markdown, state);
    ensureNativeSurfaceReady();
    scheduleSurfaceReflow("native", {
      immediate: true,
      delay: 0,
    });
    if (focusPrisma) {
      const focusLater = () => {
        if (state.destroyed) {
          return;
        }
        focusExistingPrismaBlock();
      };
      if (typeof window.requestAnimationFrame == "function") {
        window.requestAnimationFrame(focusLater);
      }
      else {
        window.setTimeout(focusLater, 0);
      }
    }
  }

  function buildNativeMarkdownWithInsertedBlocks(blocksToInsert = [], selectionState = null) {
    const targetBlock =
      selectionState?.editable?.closest?.(".sr-native-block")
      || selectionState?.sectionMarker
      || selectionState?.target?.closest?.(".sr-native-block")
      || null;
    const insertBlocks = Array.isArray(blocksToInsert) ? blocksToInsert.slice() : [];
    const nextBlocks = [];
    let inserted = false;

    const insertScaffold = () => {
      if (inserted) {
        return;
      }
      nextBlocks.push(...insertBlocks);
      inserted = true;
    };

    for (const body of Array.from(nativeEditor.querySelectorAll(".sr-editor-section-body, .sr-page-editor-body, .sr-page-sheet-body"))) {
      for (const node of Array.from(body?.childNodes || [])) {
        if (node !== targetBlock) {
          nextBlocks.push(...SystematicReviewerNativeMarkdown.blocksFromEditorNode(node));
          continue;
        }
        if (selectionState?.sectionMarker && node === selectionState.sectionMarker) {
          nextBlocks.push(...SystematicReviewerNativeMarkdown.blocksFromEditorNode(node));
          insertScaffold();
          continue;
        }
        const blockType = targetBlock?.getAttribute?.("data-block-type") || "";
        if (["paragraph", "heading"].includes(blockType) && selectionState?.editable) {
          const split = splitEditableAtSelection(selectionState.editable);
          const before = String(split.before || "");
          const after = String(split.after || "");
          if (blockType === "heading" && String(before || "").trim()) {
            nextBlocks.push({
              type: "heading",
              level: Math.max(1, Math.min(6, Number(targetBlock.getAttribute("data-level") || 1) || 1)),
              text: before,
            });
          }
          else if (blockType === "paragraph" && String(before || "").trim()) {
            nextBlocks.push({ type: "paragraph", text: before });
          }
          insertScaffold();
          if (String(after || "").trim()) {
            nextBlocks.push({ type: "paragraph", text: after });
          }
          continue;
        }
        nextBlocks.push(...SystematicReviewerNativeMarkdown.blocksFromEditorNode(node));
        insertScaffold();
      }
    }

    if (!inserted) {
      insertScaffold();
    }
    return SystematicReviewerNativeMarkdown.serializeBlocks(nextBlocks);
  }

  function buildNativeMarkdownWithPrismaScaffold(selectionState = null) {
    return buildNativeMarkdownWithInsertedBlocks(prismaScaffoldBlocks(), selectionState);
  }

  function deleteBackwardInTextarea(textarea) {
    if (!textarea) {
      return false;
    }
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    if (start === end && start <= 0) {
      return false;
    }
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    if (start !== end) {
      textarea.value = `${textarea.value.slice(0, start)}${after}`;
      textarea.setSelectionRange(start, start);
      return true;
    }
    const nextPos = Math.max(0, start - 1);
    textarea.value = `${before.slice(0, -1)}${after}`;
    textarea.setSelectionRange(nextPos, nextPos);
    return true;
  }

  function deleteBackwardInEditable(editable) {
    if (!editable || editable.tagName?.toLowerCase() === "textarea") {
      return false;
    }
    try {
      const selection = document.defaultView.getSelection();
      if (!selection || !selection.rangeCount) {
        return false;
      }
      const range = selection.getRangeAt(0);
      const common = range.commonAncestorContainer?.nodeType === 3
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
      if (common && common !== editable && !editable.contains(common)) {
        return false;
      }
      if (!range.collapsed) {
        range.deleteContents();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      if (typeof selection.modify === "function") {
        const snapshot = range.cloneRange();
        selection.modify("extend", "backward", "character");
        if (!selection.rangeCount) {
          selection.removeAllRanges();
          selection.addRange(snapshot);
          return false;
        }
        const deleteRange = selection.getRangeAt(0);
        const deleteCommon = deleteRange.commonAncestorContainer?.nodeType === 3
          ? deleteRange.commonAncestorContainer.parentNode
          : deleteRange.commonAncestorContainer;
        if (deleteCommon && deleteCommon !== editable && !editable.contains(deleteCommon)) {
          selection.removeAllRanges();
          selection.addRange(snapshot);
          return false;
        }
        deleteRange.deleteContents();
        selection.removeAllRanges();
        selection.addRange(deleteRange);
        return true;
      }
      if (range.startContainer?.nodeType === 3 && range.startOffset > 0) {
        range.startContainer.deleteData(range.startOffset - 1, 1);
        range.setStart(range.startContainer, range.startOffset - 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
    }
    catch (_error) {}
    return false;
  }

  async function refreshCitationDependentRendering(markdown = null) {
    const sourceMarkdown = typeof markdown === "string" ? markdown : currentMarkdown();
    try {
      const previewState = await ctx.invoke("automation.citation.preview", {
        markdown: sourceMarkdown,
        editor_settings: automationEditorSettingsPayload(state.editorSettings),
      });
      state.renderState = {
        ...(state.renderState || {}),
        citations: Array.isArray(previewState?.citations) ? previewState.citations : [],
        bibliography_html: previewState?.bibliography_html || `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`,
        bibliography_text: previewState?.bibliography_text || "Bibliography",
      };
      const citationMap = citationMapFromRenderState(state.renderState);
      Array.from(nativeEditor.querySelectorAll(".sr-citation-chip")).forEach((node) => {
        const token = String(node.getAttribute("data-sr-markdown") || "").trim();
        const preview = token ? citationMap.get(token) : null;
        if (preview?.html) {
          node.innerHTML = String(preview.html || "");
        }
      });
      Array.from(nativeEditor.querySelectorAll(".sr-block-bibliography > .sr-block-editable,[data-block-type='bibliography'] .sr-block-editable")).forEach((block) => {
        block.setAttribute("data-sr-markdown", SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN);
        block.innerHTML = String(state.renderState?.bibliography_html || "");
      });
    }
    catch (_error) {}
    invalidateRenderedSurfaces();
  }

  async function syncInMemoryRenderState(markdown = null, options = {}) {
    const sourceMarkdown = typeof markdown === "string" ? markdown : currentMarkdown();
    const token = ++state.renderToken;
    const renderState = await ctx.invoke("automation.document.render", {
      markdown: sourceMarkdown,
      editor_settings: automationEditorSettingsPayload(state.editorSettings),
      surface: "both",
    });
    if (state.destroyed || token !== state.renderToken) {
      return null;
    }
    state.renderState = Object.assign({}, state.renderState || {}, renderState || {});
    state.baseURL = String(renderState?.base_url || state.baseURL || "");
    state.lastRenderedReportHash = String(renderState?.report_hash || state.lastRenderedReportHash || "");
    const signature = currentRenderSignature();
    const mountedSurfaces = applyRenderState(renderState, {
      surfaces: ["preview"],
      preservePreviewScroll: state.mode === "preview" && !!options?.preservePreviewScroll,
    });
    state.renderedSignature.preview = mountedSurfaces.preview ? signature : "";
    state.renderedSignature.native = mountedSurfaces.native ? signature : "";
    return renderState;
  }

  async function ensureSingleCitationPreview(choice) {
    try {
      const previewState = await ctx.invoke("automation.citation.preview", {
        markdown: currentMarkdown(),
        citation: choice,
        editor_settings: automationEditorSettingsPayload(state.editorSettings),
      });
      const entry = previewState?.citation || null;
      if (!entry?.token) {
        return;
      }
      const citations = Array.isArray(state.renderState?.citations) ? state.renderState.citations.slice() : [];
      const index = citations.findIndex((citation) => String(citation?.token || "") === entry.token);
      if (index >= 0) {
        citations[index] = { ...(citations[index] || {}), ...entry };
      }
      else {
        citations.push(entry);
      }
      if (Array.isArray(choice?.keys) && choice.keys.length === 1) {
        state.citationChipLabelCache.set(
          citationChipLabelCacheKey(choice.keys[0]),
          String(entry.text || "").trim() || fallbackCitationChipLabel(choice.keys[0]),
        );
      }
      state.renderState = {
        ...(state.renderState || {}),
        citations,
      };
    }
    catch (_error) {}
  }

  function insertPageSheetAfter(layout = "portrait") {
    const currentSheet = activePageSheet();
    if (!currentSheet) {
      return null;
    }
    const sheet = document.createElement("div");
    sheet.className = "sr-page-sheet";
    sheet.setAttribute("data-sr-layout", layout);
    sheet.setAttribute("data-sr-page-source", "manual");
    const body = document.createElement("div");
    body.className = "sr-page-sheet-body sr-page-editor-body";
    body.setAttribute("data-sr-page-body", "true");
    body.setAttribute("contenteditable", "true");
    body.setAttribute("spellcheck", "true");
    body.appendChild(createEmptyParagraphBlock());
    sheet.appendChild(body);
    currentSheet.after(sheet);
    refreshPageSheetIndices(nativeEditor);
    const paragraph = body.querySelector(".sr-block-editable");
    setActiveEditable(paragraph);
    focusEditableEnd(paragraph);
    return body;
  }

  function applyHeadingToActiveBlock(level) {
    if (state.mode !== "native") {
      setMode("native");
    }
    const insertionState = currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const editable = activeEditable();
    const block = editable?.closest?.(".sr-native-block");
    if (!editable || !block || ["table", "image"].includes(block.getAttribute("data-block-type"))) {
      return;
    }
    const nextLevel = Number(level || 0);
    if (nextLevel <= 0) {
      block.setAttribute("data-block-type", "paragraph");
      block.className = "sr-native-block sr-block-paragraph";
      block.removeAttribute("data-level");
    }
    else {
      block.setAttribute("data-block-type", "heading");
      block.className = "sr-native-block sr-block-heading";
      block.setAttribute("data-level", String(Math.max(1, Math.min(6, nextLevel || 1))));
    }
    markNativeEditorDirty();
  }

  function nativeExecCommand(command) {
    if (state.mode !== "native") {
      setMode("native");
    }
    const insertionState = currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const editable = activeEditable();
    editable?.focus?.();
    try {
      document.execCommand(command, false, null);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(editable || nativeEditor);
    }
    catch (_error) {}
  }

  function insertListBlock(ordered) {
    if (state.mode !== "native") {
      setMode("native");
    }
    const insertionState = currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const body = insertionState?.editable?.closest?.(".sr-page-editor-body") || activePageBody();
    const currentBlock = insertionState?.editable?.closest?.(".sr-native-block");
    if (!body) {
      return;
    }
    const currentType = currentBlock?.getAttribute?.("data-block-type") || "";
    if (currentBlock && ["paragraph", "heading"].includes(currentType)) {
      const currentText = inlineMarkdownFromNode(insertionState?.editable || currentBlock.querySelector(".sr-block-editable")).trim();
      const listNode = document.createElement("div");
      listNode.className = "sr-native-block sr-block-list";
      listNode.setAttribute("data-block-type", "list");
      listNode.setAttribute("data-list-kind", ordered ? "ol" : "ul");
      const listRoot = document.createElement("div");
      listRoot.className = "sr-native-list";
      listRoot.appendChild(createListItemRow(currentText, ordered, 0, 0));
      listNode.appendChild(listRoot);
      setListBlockStyleAttributes(listNode, SystematicReviewerNativeMarkdown.normalizeListBlock({
        type: "list",
        ordered,
        items: [{ text: currentText, level: 0 }],
      }, {
        settings: state.editorSettings,
      }));
      const paragraphNode = createParagraphBlock("");
      currentBlock.replaceWith(listNode);
      listNode.after(paragraphNode);
      renumberListBlock(listNode);
      const firstItem = listNode.querySelector(".sr-block-editable");
      setActiveEditable(firstItem || paragraphNode.querySelector(".sr-block-editable"));
      focusEditableEnd(activeEditable());
      markNativeEditorDirty();
      return;
    }
    const listNode = document.createElement("div");
    listNode.className = "sr-native-block sr-block-list";
    listNode.setAttribute("data-block-type", "list");
    listNode.setAttribute("data-list-kind", ordered ? "ol" : "ul");
    const listRoot = document.createElement("div");
    listRoot.className = "sr-native-list";
    listRoot.appendChild(createListItemRow("", ordered, 0, 0));
    listNode.appendChild(listRoot);
    setListBlockStyleAttributes(listNode, SystematicReviewerNativeMarkdown.normalizeListBlock({
      type: "list",
      ordered,
      items: [{ text: "", level: 0 }],
    }, {
      settings: state.editorSettings,
    }));
    const paragraphNode = createParagraphBlock("");
    if (currentBlock && currentBlock.parentNode === body) {
      currentBlock.after(listNode, paragraphNode);
    }
    else {
      body.append(listNode, paragraphNode);
    }
    renumberListBlock(listNode);
    const firstItem = listNode.querySelector(".sr-block-editable");
    setActiveEditable(firstItem || paragraphNode.querySelector(".sr-block-editable"));
    focusEditableEnd(activeEditable());
    markNativeEditorDirty();
  }

  function insertTableBlock() {
    const rowCount = Math.max(1, Math.min(20, Number(window.prompt("How many data rows?", "3") || "3") || 3));
    const columnCount = Math.max(1, Math.min(20, Number(window.prompt("How many columns?", "3") || "3") || 3));
    const block = {
      type: "table",
      header: Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`),
      alignments: Array.from({ length: columnCount }, () => "left"),
      rows: Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ({ text: "", colspan: 1 }))),
      captionAbove: "",
      noteBelow: "",
    };
    if (state.mode === "raw") {
      insertIntoTextarea(rawEditor, `${SystematicReviewerNativeMarkdown.serializeBlocks([block])}\n`);
      markDirty();
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const insertionState = currentInsertionState();
    const tableNode = renderNativeBlockNode(block, Date.now());
    const paragraphNode = createEmptyParagraphBlock();
    const body = insertionState?.editable?.closest?.(".sr-page-editor-body") || activePageBody();
    const currentBlock = insertionState?.editable?.closest?.(".sr-native-block");
    if (!body || !tableNode) {
      return;
    }
    if (currentBlock && currentBlock.parentNode === body) {
      currentBlock.after(tableNode, paragraphNode);
    }
    else {
      body.append(tableNode, paragraphNode);
    }
    const firstCell = tableNode.querySelector(".sr-native-table-cell");
    if (firstCell) {
      setActiveEditable(firstCell);
      focusEditableEnd(firstCell);
    }
    else {
      const paragraphEditable = paragraphNode.querySelector(".sr-block-editable");
      setActiveEditable(paragraphEditable || state.nativeActiveEditable);
      focusEditableEnd(paragraphEditable);
    }
    state.lastSelectionState = captureEditorSelectionState(activeEditable() || tableNode);
    markNativeEditorDirty();
  }

  async function loadDatabaseTableBuilderOptions() {
    const [scopeResult, columnsResult] = await Promise.all([
      ctx.invoke("automation.scope.list", {}),
      ctx.invoke("screening.columns.list", {}),
    ]);
    const scopes = Array.isArray(scopeResult?.scopes) ? scopeResult.scopes.slice() : [];
    const columns = Array.isArray(columnsResult?.columns) ? columnsResult.columns.slice() : [];
    if (!columns.some((column) => String(column?.key || "").trim() === "citation_markdown")) {
      columns.unshift({
        key: "citation_markdown",
        label: "Citation (@[itemkey])",
        group: "Default",
        origin: "virtual",
        editable: false,
        visible: true,
      });
    }
    return { scopes, columns };
  }

  function defaultDatabaseTableScopeKey(scopes = []) {
    const projectType = String(
      state.bootstrap?.current_project?.entry?.project_type
      || state.bootstrap?.current_project?.project_type
      || state.bootstrap?.current_project?.projectType
      || ""
    ).trim().toLowerCase();
    if (["systematic_review", "systematic-review"].includes(projectType)) {
      const included = scopes.find((entry) => String(entry?.collection_name || "").trim().toLowerCase() === "included");
      if (included?.collection_key) {
        return String(included.collection_key);
      }
    }
    if (["custom_analysis", "custom-analysis", "analysis", "custom"].includes(projectType)) {
      const dataScope = scopes.find((entry) => String(entry?.collection_name || "").trim().toLowerCase() === "data");
      if (dataScope?.collection_key) {
        return String(dataScope.collection_key);
      }
    }
    return String(scopes[0]?.collection_key || "").trim();
  }

  async function openDatabaseTableDialog() {
    closeOverlay();
    const { scopes, columns } = await loadDatabaseTableBuilderOptions();
    if (!scopes.length) {
      throw new Error("No project scopes are available for database tables.");
    }
    if (!columns.length) {
      throw new Error("No database columns are available for database tables.");
    }
    const columnsByKey = new Map(
      columns
        .map((column) => {
          const key = String(column?.key || column?.column_key || "").trim();
          return key ? [key, column] : null;
        })
        .filter(Boolean)
    );
    let draftVisibleKeys = columnsByKey.has("citation_markdown") ? ["citation_markdown"] : [];
    let draftVisibleSet = new Set(draftVisibleKeys);
    let dragState = {
      active: false,
      sourceKey: "",
      insertionIndex: null,
      pointerX: 0,
      pointerY: 0,
    };
    let dragCleanup = null;
    let autoScrollFrame = 0;
    const byGroup = new Map();
    for (const column of columns) {
      const group = optionalString(column?.group || "Other") || "Other";
      if (!byGroup.has(group)) {
        byGroup.set(group, []);
      }
      byGroup.get(group).push(column);
    }

    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", { className: "sr-dialog sr-database-table-dialog", attrs: { role: "dialog", "aria-modal": "true" } });
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", { type: "button", "aria-label": "Close database table dialog" });
    const cancelBtn = createButton("Cancel");
    const insertBtn = createButton("Insert Table", "sr-workspace-btn sr-workspace-btn-primary");
    const scopeSelect = createSelect("sr-editor-select sr-dialog-select");
    scopeSelect.replaceChildren(...scopes.map((entry) => createOption(entry.collection_key, entry.collection_name || entry.collection_key)));
    const defaultScopeKey = defaultDatabaseTableScopeKey(scopes);
    scopeSelect.value = Array.from(scopeSelect.options).some((option) => option.value === defaultScopeKey)
      ? defaultScopeKey
      : String(scopes[0]?.collection_key || "");
    const palette = createNode("div", { className: "mw-screening-column-palette" });
    const groupsRoot = createNode("div", { className: "mw-screening-column-groups" });
    palette.appendChild(groupsRoot);
    const composerLabel = createNode("div", { className: "mw-screening-column-composer-title", textContent: "Table column order" });
    const composerHint = createNode("div", {
      className: "mw-screening-column-composer-hint",
      textContent: "Tick a column to add it, or drag it into position. Citation (@[itemkey]) can be placed anywhere in the table.",
    });
    const composerZone = createNode("div", { className: "mw-screening-column-composer-zone" });
    const validation = createNode("div", { className: "mw-screening-column-validation" });
    const composer = createNode("div", {
      className: "mw-screening-column-composer",
      children: [composerLabel, composerHint, composerZone, validation],
    });

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
      composerLabel.textContent = `Table column order (${draftVisibleKeys.length})`;
      validation.textContent = isEmpty
        ? "Choose at least one column before inserting a database table."
        : "Drag columns to reorder them, or use the - button to remove them.";
      validation.className = `mw-screening-column-validation${isEmpty ? " is-error" : ""}`;
      insertBtn.disabled = isEmpty;
    }

    function renderGroups() {
      const scrollTop = palette.scrollTop || 0;
      const groups = Array.from(byGroup.entries()).map(([group, entries]) =>
        createNode("div", {
          className: "mw-screening-column-group",
          children: [
            createNode("div", {
              className: "mw-screening-column-group-title",
              textContent: group,
            }),
            ...entries.map((column) => {
              const key = String(column?.key || column?.column_key || "").trim();
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = draftVisibleSet.has(key);
              checkbox.addEventListener("change", () => {
                draftVisibleKeys = checkbox.checked
                  ? insertColumnKey(draftVisibleKeys, key, draftVisibleKeys.length)
                  : removeColumnKey(draftVisibleKeys, key);
                syncDraftState();
                renderGroups();
                renderComposer();
                updateValidation();
              });
              const row = createNode("div", {
                className: `mw-screening-column-option${draftVisibleSet.has(key) ? " is-selected" : ""}`,
                attrs: { "data-screening-column-option": key },
                children: [
                  checkbox,
                  createNode("div", {
                    className: "mw-screening-column-option-text",
                    children: [
                      createNode("div", {
                        className: "mw-screening-column-option-label",
                        textContent: optionalString(column?.label || key),
                      }),
                      createNode("div", {
                        className: "mw-screening-column-option-meta",
                        textContent: [key, optionalString(column?.origin || "")].filter(Boolean).join(" - "),
                      }),
                    ],
                  }),
                ],
              });
              attachDragStart(row, key);
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
      return Math.max(0, Math.min(length, Number(index)));
    }

    function createInsertMarker() {
      return createNode("div", { className: "mw-screening-column-insert-marker" });
    }

    function renderComposer() {
      const shownKeys = displayedComposerKeys();
      const insertionIndex = dragState.active
        ? clampInsertionIndex(dragState.insertionIndex, shownKeys.length)
        : null;
      const scrollTop = composerZone.scrollTop || 0;
      const children = [];
      if (!shownKeys.length && insertionIndex === null) {
        children.push(createNode("div", {
          className: "mw-screening-column-composer-empty",
          textContent: "No table columns yet. Tick or drag columns from the list.",
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
        const column = columnsByKey.get(key) || {};
        const label = optionalString(column?.label || key);
        const removeBtn = createButton("-", "mw-screening-column-chip-remove", {
          "aria-label": `Remove ${label}`,
        });
        removeBtn.addEventListener("click", () => {
          draftVisibleKeys = removeColumnKey(draftVisibleKeys, key);
          syncDraftState();
          renderGroups();
          renderComposer();
          updateValidation();
        });
        const chipBody = createNode("div", {
          className: "mw-screening-column-chip-body",
          children: [
            createNode("span", { className: "mw-screening-column-chip-label", textContent: label }),
            createNode("span", { className: "mw-screening-column-chip-meta", textContent: key }),
          ],
        });
        attachDragStart(chipBody, key);
        children.push(createNode("div", {
          className: "mw-screening-column-chip",
          attrs: {
            "data-screening-composer-chip": "true",
            "data-screening-column-key": key,
          },
          children: [chipBody, removeBtn],
        }));
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
      const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!inside) {
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
          row = { top: chipRect.top, bottom: chipRect.bottom, items: [] };
          rows.push(row);
        }
        row.bottom = Math.max(row.bottom, chipRect.bottom);
        row.items.push(chipRect);
      }
      rows.sort((left, right) => left.top - right.top);
      let offset = 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const isMatch = clientY <= row.bottom || rowIndex === rows.length - 1;
        if (!isMatch) {
          offset += row.items.length;
          continue;
        }
        for (let itemIndex = 0; itemIndex < row.items.length; itemIndex += 1) {
          const chipRect = row.items[itemIndex];
          const midpoint = chipRect.left + (chipRect.width / 2);
          if (clientX < midpoint) {
            return offset + itemIndex;
          }
        }
        return offset + row.items.length;
      }
      return chips.length;
    }

    function stopComposerAutoScroll() {
      if (!autoScrollFrame) {
        return;
      }
      const view = panel.ownerDocument?.defaultView || window;
      view.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = 0;
    }

    function clearDrag() {
      stopComposerAutoScroll();
      dragState = {
        active: false,
        sourceKey: "",
        insertionIndex: null,
        pointerX: 0,
        pointerY: 0,
      };
      renderComposer();
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
      clearDrag();
      updateValidation();
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
        if (canScroll && rect.width && rect.height && dragState.pointerX >= rect.left && dragState.pointerX <= rect.right) {
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
          dragState = Object.assign({}, dragState, { insertionIndex: nextInsertionIndex });
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

    function attachDragStart(node, key) {
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

    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: "Insert table from database" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Build a detached markdown table from project rows and current screening columns." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [
          createNode("div", {
            className: "sr-database-table-scope-row",
            children: [
              createNode("label", {
                className: "sr-field-label",
                textContent: "Scope",
                children: [scopeSelect],
              }),
              createNode("div", {
                className: "sr-database-table-note",
                textContent: "The inserted table is plain markdown with no live database link after insertion.",
              }),
            ],
          }),
          createNode("div", {
            className: "mw-screening-columns-modal-layout",
            children: [palette, composer],
          }),
        ],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          createNode("div", { className: "sr-dialog-subtitle", textContent: "Citation (@[itemkey]) is available as a virtual column and can be reordered like any other column." }),
          createNode("div", { className: "sr-workspace-toolbar", children: [cancelBtn, insertBtn] }),
        ],
      }),
    );

    const resultPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          dragCleanup?.();
        }
        catch (_error) {}
        stopComposerAutoScroll();
        window.removeEventListener("keydown", keyHandler, true);
        closeOverlay();
        resolve(value);
      };
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };
      cancelBtn.addEventListener("click", () => finish(null), { once: true });
      closeBtn.addEventListener("click", () => finish(null), { once: true });
      insertBtn.addEventListener("click", () => finish({
        scopeKey: scopeSelect.value,
        columnKeys: draftVisibleKeys.slice(),
      }), { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          finish(null);
        }
      }, { once: true });
      window.addEventListener("keydown", keyHandler, true);
    });

    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    renderGroups();
    renderComposer();
    updateValidation();
    scopeSelect.focus();
    return await resultPromise;
  }

  async function insertTableFromDatabase(selectionState = null) {
    const preservedSelection = state.mode === "raw"
      ? selectionState
      : (isUsableEditorSelectionState(selectionState) ? selectionState : rememberDocumentInsertionState());
    if (state.mode !== "raw" && isUsableEditorSelectionState(preservedSelection)) {
      state.lastSelectionState = preservedSelection;
    }
    const choice = await openDatabaseTableDialog();
    if (!choice?.scopeKey || !Array.isArray(choice?.columnKeys) || !choice.columnKeys.length) {
      return false;
    }
    const result = await ctx.invoke("screening.tableFromDatabase", {
      collection_key: choice.scopeKey,
      columns: choice.columnKeys,
      include_citation_column: choice.columnKeys.includes("citation_markdown"),
    });
    const markdown = String(result?.markdown || "").trim();
    if (!markdown) {
      throw new Error("The database table builder did not return any markdown.");
    }
    if (state.mode === "raw") {
      insertIntoTextarea(rawEditor, `${markdown}\n`);
      markDirty();
      return true;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    let insertionState = isUsableEditorSelectionState(preservedSelection) ? preservedSelection : currentInsertionState();
    if (!isUsableEditorSelectionState(insertionState)) {
      const fallbackEditable = Array.from((activePageBody() || nativeEditor).querySelectorAll?.("[data-sr-editable='true']") || []).pop() || null;
      if (fallbackEditable) {
        setActiveEditable(fallbackEditable);
        focusEditableEnd(fallbackEditable);
        insertionState = captureEditorSelectionState(fallbackEditable);
        if (isUsableEditorSelectionState(insertionState)) {
          state.lastSelectionState = insertionState;
        }
      }
    }
    await insertMarkdownIntoEditor(insertionState || currentInsertionState(), markdown);
    setStatus(
      Number(result?.row_count || 0) === 0
        ? "Inserted database table with headers only."
        : `Inserted database table (${Number(result?.row_count || 0)} row${Number(result?.row_count || 0) === 1 ? "" : "s"}).`,
      "ready"
    );
    return true;
  }

  function insertPageBreakBlock(selectionState = null) {
    if (state.mode === "raw") {
      insertIntoTextarea(rawEditor, `${SystematicReviewerNativeMarkdown.PAGE_BREAK_MARKDOWN}\n`);
      markDirty();
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const insertionState = selectionState || currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const nextMarkdown = buildNativeMarkdownWithInsertedBlocks([{ type: "page-break" }], insertionState);
    rebuildNativeEditorFromMarkdown(nextMarkdown);
    state.lastSelectionState = rememberDocumentInsertionState();
  }

  function insertPageLayoutBlock(layout, selectionState = null) {
    if (state.mode !== "native") {
      setMode("native");
    }
    const nextLayout = String(layout || "").toLowerCase() === "landscape" ? "landscape" : "";
    if (!nextLayout) {
      return;
    }
    const insertionState = selectionState || currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const nextMarkdown = buildNativeMarkdownWithInsertedBlocks([{ type: "page-layout", layout: "landscape" }], insertionState);
    rebuildNativeEditorFromMarkdown(nextMarkdown);
    state.lastSelectionState = rememberDocumentInsertionState();
  }

  async function insertImageBlock() {
    const result = await ctx.invoke("automation.document.importImage", {});
    if (result?.canceled || !result?.relative_path) {
      return;
    }
    const imageBlock = {
      type: "image",
      alt: result.relative_path,
      src: result.relative_path,
      captionAbove: "",
      noteBelow: "",
    };
    if (state.mode === "raw") {
      insertIntoTextarea(rawEditor, `${SystematicReviewerNativeMarkdown.serializeBlocks([imageBlock])}\n`);
      markDirty();
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const insertionState = currentInsertionState();
    const imageNode = renderNativeBlockNode(imageBlock, Date.now());
    const paragraphBlock = createParagraphBlock("");
    const body = insertionState?.editable?.closest?.(".sr-page-editor-body") || activePageBody();
    const currentBlock = insertionState?.editable?.closest?.(".sr-native-block");
    if (!body || !imageNode) {
      return;
    }
    if (currentBlock && currentBlock.parentNode === body) {
      currentBlock.after(imageNode, paragraphBlock);
    }
    else {
      body.append(imageNode, paragraphBlock);
    }
    const paragraph = paragraphBlock.querySelector(".sr-block-editable");
    setActiveEditable(paragraph || state.nativeActiveEditable);
    focusEditableEnd(paragraph);
    state.lastSelectionState = captureEditorSelectionState(paragraph || imageNode);
    markNativeEditorDirty();
    await syncInMemoryRenderState(currentMarkdown(), { preservePreviewScroll: true })
      .then(() => {
        if (imageNode?.isConnected) {
          rerenderNativeImageBlock(imageNode, imageBlock);
        }
      })
      .catch(() => {});
  }

  function currentListBlock(selectionState = null) {
    const target = selectionState?.editable?.closest?.(".sr-block-list")
      || selectionState?.target?.closest?.(".sr-block-list")
      || state.nativeActiveEditable?.closest?.(".sr-block-list")
      || null;
    return target;
  }

  function applyListStyleToNativeSelection(listStyle = "") {
    const selectionState = currentInsertionState();
    const listBlock = currentListBlock(selectionState);
    if (!listBlock) {
      return false;
    }
    const ordered = listBlock.getAttribute("data-list-kind") === "ol";
    const normalizedList = SystematicReviewerNativeMarkdown.normalizeListBlock({
      type: "list",
      ordered,
      items: Array.from(listBlock.querySelectorAll(".sr-native-list-item")).map((row) => ({
        text: inlineMarkdownFromNode(row.querySelector(".sr-block-editable") || row).trim(),
        level: listItemLevel(row),
      })),
      listStyle,
    }, {
      settings: state.editorSettings,
    });
    setListBlockStyleAttributes(listBlock, normalizedList);
    renumberListBlock(listBlock);
    markNativeEditorDirty();
    return true;
  }

  async function openImageResizeDialog(imageBlock = null) {
    const img = imageBlock?.querySelector?.("img");
    if (!img) {
      return null;
    }
    const current = Math.max(
      10,
      Math.min(
        100,
        Number(
          imageBlock.querySelector("figure")?.getAttribute("data-sr-display-width")
          || img.getAttribute("data-sr-display-width")
          || 100
        ) || 100
      )
    );
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", { className: "sr-dialog sr-image-dialog", attrs: { role: "dialog", "aria-modal": "true" } });
    const widthInput = document.createElement("input");
    widthInput.className = "sr-editor-input";
    widthInput.type = "number";
    widthInput.min = "10";
    widthInput.max = "100";
    widthInput.step = "5";
    widthInput.value = String(current);
    const cancelBtn = createButton("Cancel");
    const saveBtn = createButton("Save", "sr-workspace-btn sr-workspace-btn-primary");
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", {
      type: "button",
      "aria-label": "Close image resize dialog",
    });
    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: "Resize image" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Set image width as a percent of the page text area." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [
          createNode("label", {
            className: "sr-field-label",
            textContent: "Width (%)",
            children: [widthInput],
          }),
        ],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          createNode("div", { className: "sr-dialog-subtitle", textContent: "Images scale proportionally and keep their aspect ratio." }),
          createNode("div", { className: "sr-workspace-toolbar", children: [cancelBtn, saveBtn] }),
        ],
      }),
    );
    const resultPromise = new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (state.overlay === overlay) {
          state.overlay = null;
        }
        window.removeEventListener("keydown", keyHandler, true);
        overlay.remove();
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };
      cancelBtn.addEventListener("click", () => finish(null), { once: true });
      closeBtn.addEventListener("click", () => finish(null), { once: true });
      saveBtn.addEventListener("click", () => finish(Math.max(10, Math.min(100, Number(widthInput.value || current) || current))), { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          finish(null);
        }
      }, { once: true });
      window.addEventListener("keydown", keyHandler, true);
    });
    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    widthInput.focus();
    widthInput.select();
    return await resultPromise;
  }

  async function resizeImageBlock(imageBlock = null) {
    const block = imageBlock || currentInsertionState()?.imageBlock || null;
    if (!block) {
      return;
    }
    const width = await openImageResizeDialog(block);
    if (!width) {
      return;
    }
    const currentImage = SystematicReviewerNativeMarkdown.blocksFromEditorNode(block)[0];
    if (!currentImage || currentImage.type !== "image") {
      return;
    }
    const nextBlock = renderNativeBlockNode({
      ...currentImage,
      displayWidthPercent: width,
    }, Date.now());
    if (!nextBlock) {
      return;
    }
    block.replaceWith(nextBlock);
    markNativeEditorDirty();
    state.lastSelectionState = captureEditorSelectionState(nextBlock);
    await syncInMemoryRenderState(currentMarkdown(), { preservePreviewScroll: true })
      .then(() => {
        const refreshedBlock = rerenderNativeImageBlock(nextBlock, {
          ...currentImage,
          displayWidthPercent: width,
        });
        if (refreshedBlock?.isConnected) {
          state.lastSelectionState = captureEditorSelectionState(refreshedBlock);
        }
      })
      .catch(() => {});
  }

  async function insertLinkFromDialog() {
    const insertionState = currentInsertionState();
    const selected = state.mode === "raw"
      ? selectedTextInTextarea(rawEditor).trim()
      : editorSelectionText(insertionState).trim();
    const url = String(window.prompt("Link URL", "https://") || "").trim();
    if (!url) {
      return;
    }
    const label = selected || String(window.prompt("Link text", "Link") || "").trim();
    if (!label) {
      return;
    }
    const markdown = `[${label}](${url})`;
    if (state.mode === "raw") {
      insertIntoTextarea(rawEditor, markdown);
      markDirty();
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const anchorHTML = `<a href="${escapeHTML(url)}">${escapeHTML(label)}</a>`;
    insertHTMLIntoActiveEditable(anchorHTML, () => {
      const body = activePageBody();
      if (body) {
        body.appendChild(createParagraphBlockWithHTML(anchorHTML));
      }
    }, insertionState);
    markNativeEditorDirty();
    state.lastSelectionState = captureEditorSelectionState(activeEditable() || nativeEditor);
  }

  async function insertBibliographyPlaceholder() {
    const sourceMarkdown = currentMarkdown();
    const sourceBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(sourceMarkdown);
    const existingBibliographyIndex = findFirstBlockIndex(sourceBlocks, (block) => block?.type === "bibliography");
    if (state.mode === "raw") {
      const next = insertSingletonSectionIntoBlocks(sourceBlocks, "bibliography");
      if (!next.inserted) {
        focusExistingBibliographyToken();
        setStatus("Bibliography is already in the report.", "ready");
        return;
      }
      rawEditor.value = SystematicReviewerNativeMarkdown.serializeBlocks(next.blocks);
      markDirty();
      focusExistingBibliographyToken();
      setStatus("Inserted Bibliography section.", "ready");
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const existingBlock = nativeEditor.querySelector("[data-block-type='bibliography']");
    if (existingBlock) {
      focusExistingBibliographyBlock(existingBlock);
      setStatus("Bibliography is already in the report.", "ready");
      return;
    }
    if (existingBibliographyIndex >= 0) {
      focusExistingBibliographyBlock();
      setStatus("Bibliography is already in the report.", "ready");
      return;
    }
    const insertionState = currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const nextMarkdown = buildNativeMarkdownWithInsertedBlocks(bibliographySectionBlocks(), insertionState);
    rebuildNativeEditorFromMarkdown(nextMarkdown);
    await refreshCitationDependentRendering(nextMarkdown);
    state.lastSelectionState = rememberDocumentInsertionState();
    if (typeof window.requestAnimationFrame == "function") {
      window.requestAnimationFrame(() => focusExistingBibliographyBlock());
    }
    else {
      window.setTimeout(() => focusExistingBibliographyBlock(), 0);
    }
    setStatus("Inserted Bibliography section.", "ready");
  }

  async function insertTOCPlaceholder() {
    const sourceMarkdown = currentMarkdown();
    const sourceBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(sourceMarkdown);
    const existingTOCIndex = findFirstBlockIndex(sourceBlocks, (block) => block?.type === "toc");
    if (state.mode === "raw") {
      if (existingTOCIndex >= 0) {
        focusExistingTOCToken();
        setStatus("Table of Contents is already in the report.", "ready");
        return;
      }
      insertStructuredMarkdownIntoTextarea(
        rawEditor,
        SystematicReviewerNativeMarkdown.serializeBlocks(tocSectionBlocks()),
      );
      markDirty();
      focusExistingTOCToken();
      setStatus("Inserted Table of Contents.", "ready");
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const existingBlock = nativeEditor.querySelector("[data-block-type='toc']");
    if (existingBlock) {
      focusExistingTOCBlock(existingBlock);
      setStatus("Table of Contents is already in the report.", "ready");
      return;
    }
    if (existingTOCIndex >= 0) {
      focusExistingTOCBlock();
      setStatus("Table of Contents is already in the report.", "ready");
      return;
    }
    const insertionState = currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const nextMarkdown = buildNativeMarkdownWithInsertedBlocks(tocSectionBlocks(), insertionState);
    rebuildNativeEditorFromMarkdown(nextMarkdown);
    state.lastSelectionState = rememberDocumentInsertionState();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => focusExistingTOCBlock());
    }
    else {
      window.setTimeout(() => focusExistingTOCBlock(), 0);
    }
    setStatus("Inserted Table of Contents.", "ready");
  }

  async function insertPrismaPlaceholder() {
    const token = prismaPlaceholderToken();
    if (!token) {
      return;
    }
    const sourceMarkdown = currentMarkdown();
    const sourceBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(sourceMarkdown);
    const existingPrismaIndex = findFirstBlockIndex(sourceBlocks, (block) => block?.type === "prisma");
    if (state.mode === "raw") {
      const next = insertSingletonSectionIntoBlocks(sourceBlocks, "prisma");
      if (!next.inserted) {
        focusExistingPrismaToken();
        setStatus("PRISMA diagram is already in the report.", "ready");
        return;
      }
      rawEditor.value = SystematicReviewerNativeMarkdown.serializeBlocks(next.blocks);
      markDirty();
      focusExistingPrismaToken();
      setStatus("Inserted PRISMA section.", "ready");
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const existingBlock = nativeEditor.querySelector("[data-block-type='prisma']");
    if (existingBlock) {
      focusExistingPrismaBlock(existingBlock);
      setStatus("PRISMA diagram is already in the report.", "ready");
      return;
    }
    if (existingPrismaIndex >= 0) {
      focusExistingPrismaBlock();
      setStatus("PRISMA diagram is already in the report.", "ready");
      return;
    }
    const insertionState = currentInsertionState();
    restoreEditorSelectionState(insertionState);
    const nextMarkdown = buildNativeMarkdownWithInsertedBlocks(prismaScaffoldBlocks(), insertionState);
    await ensurePrismaRenderHTML(nextMarkdown);
    rebuildNativeEditorFromMarkdown(nextMarkdown, { focusPrisma: true });
    await refreshCitationDependentRendering(nextMarkdown);
    state.lastSelectionState = rememberDocumentInsertionState();
    setStatus("Inserted PRISMA section.", "ready");
  }

  async function editCitationFromNode(citationNode) {
    const parsed = SystematicReviewerNativeMarkdown.parseCitationMarkdown(citationNode?.getAttribute?.("data-sr-markdown") || "");
    if (!parsed) {
      return;
    }
    const choice = await openCitationDialog(parsed);
    if (!choice?.keys?.length) {
      return;
    }
    await ensureSingleCitationPreview(choice);
    const replacement = citationChipHTML(choice);
    citationNode.outerHTML = replacement;
    markNativeEditorDirty();
    await refreshCitationDependentRendering();
  }

  function isCitationSpacerNode(node) {
    return node?.nodeType === 3 && /^[\u200B\u2060\uFEFF\s]*$/.test(String(node.nodeValue || ""));
  }

  async function removeCitationNode(citationNode) {
    const chip = citationNode?.closest?.(".sr-citation-chip") || citationNode || null;
    if (!chip?.isConnected) {
      return false;
    }
    const parent = chip.parentNode || null;
    const previousSibling = chip.previousSibling || null;
    const nextSibling = chip.nextSibling || null;
    chip.remove();
    if (parent && isCitationSpacerNode(previousSibling) && isCitationSpacerNode(nextSibling)) {
      const previousText = String(previousSibling.nodeValue || "");
      const nextText = String(nextSibling.nodeValue || "");
      if (!previousText.trim() && !nextText.trim()) {
        nextSibling.remove();
        previousSibling.remove();
      }
      else if (!previousText.trim()) {
        previousSibling.remove();
      }
      else if (!nextText.trim()) {
        nextSibling.remove();
      }
    }
    else {
      if (isCitationSpacerNode(previousSibling) && !String(previousSibling.nodeValue || "").trim()) {
        previousSibling.remove();
      }
      if (isCitationSpacerNode(nextSibling) && !String(nextSibling.nodeValue || "").trim()) {
        nextSibling.remove();
      }
    }
    const fallbackEditable = parent?.closest?.("[data-sr-editable='true']") || state.nativeActiveEditable || null;
    if (fallbackEditable) {
      setActiveEditable(fallbackEditable);
      state.lastSelectionState = captureEditorSelectionState(fallbackEditable);
    }
    markNativeEditorDirty();
    await refreshCitationDependentRendering();
    return true;
  }

  async function editRawTableForCell(cell) {
    const block = cell?.closest?.(".sr-block-table");
    const target = nativeTableBlockFromElement(block);
    if (!target) {
      return;
    }
    rawEditor.value = SystematicReviewerNativeMarkdown.serializeBlocks([target]).trim();
    setMode("raw");
    rawEditor.focus();
    rawEditor.select();
  }

  function tableContextState(selectionState) {
    const tableCell = selectionState?.tableCell?.closest?.("td, th") || null;
    const descriptor = tableCellDescriptor(tableCell);
    const table = tableCell?.closest?.("table") || null;
    const tableBlock = tableCell?.closest?.(".sr-block-table") || null;
    if (!tableCell || !descriptor || !table || !tableBlock) {
      return null;
    }
    const selectedCells = selectedTableCellsForTarget(tableCell);
    return {
      tableCell,
      descriptor,
      table,
      tableBlock,
      selectedCells,
      canMerge: canMergeTableCells(selectedCells),
    };
  }

  function closeEditorContextMenu() {
    const contextState = state.contextMenuState;
    if (!contextState) {
      return;
    }
    try {
      contextState.cleanup?.();
    }
    catch (_error) {}
    try {
      if (Array.isArray(contextState.menus)) {
        contextState.menus.forEach((menu) => menu?.remove?.());
      }
      else {
        contextState.menu?.remove?.();
      }
    }
    catch (_error) {}
    state.contextMenuState = null;
  }

  function removeBibliographyBlock(block = null) {
    return removeGeneratedSectionBlock(block, {
      type: "bibliography",
    });
  }

  function removeTOCBlock(block = null) {
    return removeGeneratedSectionBlock(block, {
      type: "toc",
    });
  }

  function isPageBreakMarkerNode(node = null) {
    return !!node?.matches?.(".sr-section-separator[data-sr-marker='page-break']");
  }

  function isPrismaScaffoldDescriptionNode(node = null) {
    if (node?.getAttribute?.("data-block-type") !== "paragraph") {
      return false;
    }
    return String(inlineMarkdownFromNode(node.querySelector(".sr-block-editable")) || "").trim() === prismaScaffoldDescription();
  }

  function removeGeneratedSectionBlock(block = null, options = {}) {
    const type = String(options?.type || "").trim();
    const selector = type ? `[data-block-type='${type}']` : "";
    const existingBlock = block || (selector ? nativeEditor.querySelector(selector) : null);
    if (!existingBlock) {
      return false;
    }
    const body = existingBlock.closest(".sr-page-editor-body");
    let firstNode = existingBlock;
    let lastNode = existingBlock;
    const previousNode = existingBlock.previousElementSibling;
    if (isPageBreakMarkerNode(previousNode)) {
      firstNode = previousNode;
    }
    const directNextNode = existingBlock.nextElementSibling;
    if (type === "prisma" && isPrismaScaffoldDescriptionNode(directNextNode)) {
      lastNode = directNextNode;
    }
    const trailingNode = lastNode.nextElementSibling;
    if (isPageBreakMarkerNode(trailingNode)) {
      lastNode = trailingNode;
    }
    const previousOutside = firstNode.previousElementSibling;
    const nextOutside = lastNode.nextElementSibling;
    let cursor = firstNode;
    while (cursor) {
      const next = cursor.nextElementSibling;
      cursor.remove();
      if (cursor === lastNode) {
        break;
      }
      cursor = next;
    }
    const nextEditable =
      previousOutside?.querySelector?.("[data-sr-editable='true']")
      || nextOutside?.querySelector?.("[data-sr-editable='true']")
      || body?.querySelector?.("[data-sr-editable='true']")
      || ensureTrailingEditableParagraph(body);
    setActiveEditable(nextEditable || state.nativeActiveEditable);
    if (nextEditable?.getAttribute?.("data-sr-editable") === "true") {
      focusEditableEnd(nextEditable);
    }
    markNativeEditorDirty();
    return true;
  }

  function removeTableBlock(tableBlock = null) {
    const existingBlock = tableBlock || currentInsertionState()?.tableCell?.closest?.(".sr-block-table") || null;
    if (!existingBlock) {
      return false;
    }
    const body = existingBlock.closest(".sr-page-editor-body");
    const nextBlock = existingBlock.nextElementSibling;
    const previousBlock = existingBlock.previousElementSibling;
    existingBlock.remove();
    let nextEditable =
      previousBlock?.querySelector?.("[data-sr-editable='true']")
      || nextBlock?.querySelector?.("[data-sr-editable='true']")
      || body?.querySelector?.("[data-sr-editable='true']")
      || null;
    if (!nextEditable && body) {
      nextEditable = ensureTrailingEditableParagraph(body);
    }
    setActiveEditable(nextEditable || state.nativeActiveEditable);
    if (nextEditable?.getAttribute?.("data-sr-editable") === "true") {
      focusEditableEnd(nextEditable);
    }
    clearTableSelection();
    markNativeEditorDirty();
    return true;
  }

  function removeCodeBlock(codeBlock = null) {
    const existingBlock = codeBlock
      || currentInsertionState()?.codeBlock
      || state.nativeActiveEditable?.closest?.(".sr-block-code[data-sr-code-root='true'], .sr-native-block[data-block-type='code']")
      || null;
    if (!existingBlock) {
      return false;
    }
    const body = existingBlock.closest(".sr-page-editor-body");
    const nextBlock = existingBlock.nextElementSibling;
    const previousBlock = existingBlock.previousElementSibling;
    existingBlock.remove();
    let nextEditable =
      previousBlock?.querySelector?.("[data-sr-editable='true']")
      || nextBlock?.querySelector?.("[data-sr-editable='true']")
      || body?.querySelector?.("[data-sr-editable='true']")
      || null;
    if (!nextEditable && body) {
      nextEditable = ensureTrailingEditableParagraph(body);
    }
    setActiveEditable(nextEditable || state.nativeActiveEditable);
    if (nextEditable?.getAttribute?.("data-sr-editable") === "true") {
      if (nextEditable.tagName?.toLowerCase() === "textarea") {
        nextEditable.focus();
        const end = String(nextEditable.value || "").length;
        nextEditable.setSelectionRange(end, end);
      } else {
        focusEditableEnd(nextEditable);
      }
    }
    markNativeEditorDirty();
    return true;
  }

  function selectionHTMLFromState(selectionState) {
    if (!selectionState) {
      return "";
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      const text = editorSelectionText(selectionState);
      return text ? `<pre><code>${escapeHTML(text)}</code></pre>` : "";
    }
    if (selectionState.citationNode && !editorHasSelection(selectionState)) {
      return selectionState.citationNode.outerHTML || "";
    }
    if (!selectionState.range || selectionState.range.collapsed) {
      return "";
    }
    const holder = document.createElement("div");
    holder.appendChild(selectionState.range.cloneContents());
    return holder.innerHTML || "";
  }

  function selectionMarkdownFromState(selectionState) {
    if (!selectionState) {
      return "";
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      return editorSelectionText(selectionState);
    }
    if (selectionState.citationNode && !editorHasSelection(selectionState)) {
      return selectionState.citationNode.getAttribute("data-sr-markdown") || selectionState.citationNode.textContent || "";
    }
    if (!selectionState.range || selectionState.range.collapsed) {
      return "";
    }
    const holder = document.createElement("div");
    holder.appendChild(selectionState.range.cloneContents());
    const blockNodes = Array.from(holder.childNodes || []).filter((node) =>
      node?.nodeType === 1
      && (
        node.classList?.contains?.("sr-native-block")
        || /^(?:section|p|h[1-6]|ul|ol|table|figure|div)$/i.test(String(node.tagName || ""))
      )
    );
    if (blockNodes.length) {
      const blocks = blockNodes.flatMap((node) => SystematicReviewerNativeMarkdown.blocksFromEditorNode(node));
      if (blocks.length) {
        return SystematicReviewerNativeMarkdown.serializeBlocks(blocks).trim();
      }
    }
    return Array.from(holder.childNodes || [])
      .map((node) => SystematicReviewerNativeMarkdown.inlineMarkdownFromNode(node))
      .join("")
      .trim();
  }

  function buildInlineHTMLFromMarkdown(markdown = "") {
    const paragraphNode = renderNativeBlockNode({ type: "paragraph", text: markdown }, Date.now());
    return paragraphNode?.querySelector?.(".sr-block-editable")?.innerHTML || escapeHTML(String(markdown || ""));
  }

  function looksLikeAutomationMarkdown(text = "") {
    const source = String(text || "");
    return /@\[[A-Za-z0-9]/.test(source)
      || /^!\[[^\]]*\]\([^)]+\)$/m.test(source)
      || /^\s*<!--\s*sr:(?:block-meta|page-break|page-layout:)/m.test(source)
      || /^\s{0,8}(?:[-*+]|\d+\.)\s+/m.test(source)
      || /^\s*\|.+\|\s*$/m.test(source);
  }

  function isCitationShortcut(event) {
    const key = String(event?.key || "").toLowerCase();
    if (/mac/i.test(navigator.platform || "")) {
      return !!event?.metaKey && !!event?.altKey && key === "c";
    }
    return !!event?.ctrlKey && !!event?.altKey && key === "a";
  }

  async function insertMarkdownIntoEditor(selectionState, markdown) {
    const source = String(markdown || "").trim();
    if (!source) {
      return false;
    }
    const blocks = SystematicReviewerNativeMarkdown.parseMarkdown(source);
    if (!blocks.length) {
      return false;
    }
    if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
      const html = buildInlineHTMLFromMarkdown(blocks[0].text || source);
      insertHTMLIntoActiveEditable(html, () => {
        const body = selectionState?.editable?.closest?.(".sr-page-editor-body") || activePageBody();
        if (body) {
          const paragraphBlock = createParagraphBlockWithHTML(html);
          body.appendChild(paragraphBlock);
          const editable = paragraphBlock.querySelector(".sr-block-editable");
          setActiveEditable(editable || state.nativeActiveEditable);
          focusEditableEnd(editable);
        }
      }, selectionState);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(activeEditable() || selectionState?.editable || nativeEditor);
      await refreshCitationDependentRendering();
      return true;
    }
    const nextMarkdown = buildNativeMarkdownWithInsertedBlocks(blocks, selectionState);
    rebuildNativeEditorFromMarkdown(nextMarkdown);
    await refreshCitationDependentRendering(nextMarkdown);
    state.lastSelectionState = rememberDocumentInsertionState();
    return true;
  }

  async function performEditorContextAction(selectionState, action) {
    if (!selectionState) {
      return;
    }
    if (action === "remove-page-break" || action === "remove-landscape-marker") {
      const marker = selectionState.sectionMarker || selectionState.target?.closest?.(".sr-section-separator") || null;
      const markerType = marker?.getAttribute?.("data-sr-marker") || "";
      if (!marker) {
        return;
      }
      if (action === "remove-page-break" && markerType !== "page-break") {
        return;
      }
      if (action === "remove-landscape-marker" && markerType !== "page-layout") {
        return;
      }
      marker.remove();
      const nextMarkdown = SystematicReviewerNativeMarkdown.serializeBlocks(
        SystematicReviewerNativeMarkdown.collectNativeEditorBlocks(nativeEditor)
      );
      rebuildNativeEditorFromMarkdown(nextMarkdown);
      state.lastSelectionState = rememberDocumentInsertionState();
      return;
    }
    if (action === "insert-or-edit-citation") {
      if (selectionState.citationNode) {
        await editCitationFromNode(selectionState.citationNode);
      }
      else {
        await handleCitationInsert(null, selectionState);
      }
      return;
    }
    if (action.startsWith("heading-")) {
      const level = action === "heading-paragraph"
        ? 0
        : Number(action.replace("heading-", "") || 0);
      applyHeadingToActiveBlock(level);
      return;
    }
    if (action.startsWith("format-")) {
      nativeExecCommand(action.replace("format-", ""));
      return;
    }
    if (action.startsWith("layout-")) {
      const layout = action.replace("layout-", "");
      if (layout === "landscape") {
        insertPageLayoutBlock(layout, selectionState);
      }
      return;
    }
    if (action === "insert-link") {
      await insertLinkFromDialog();
      return;
    }
    if (action === "insert-table-empty") {
      insertTableBlock();
      return;
    }
    if (action === "insert-table-database") {
      await insertTableFromDatabase(selectionState);
      return;
    }
    if (action === "insert-image") {
      await insertImageBlock();
      return;
    }
    if (action === "insert-page-break") {
      insertPageBreakBlock(selectionState);
      return;
    }
    if (action === "insert-toc") {
      await insertTOCPlaceholder();
      return;
    }
    if (action === "insert-prisma") {
      await insertPrismaPlaceholder();
      return;
    }
    if (action === "insert-bibliography") {
      await insertBibliographyPlaceholder();
      return;
    }
    if (action === "remove-toc" && selectionState?.tocBlock) {
      removeTOCBlock(selectionState.tocBlock);
      return;
    }
    if (action === "resize-image" && selectionState?.imageBlock) {
      await resizeImageBlock(selectionState.imageBlock);
      return;
    }
    if (action === "copy") {
      const text = selectionMarkdownFromState(selectionState);
      if (text) {
        await writeClipboardText(text);
      }
      return;
    }
    if (action === "cut") {
      if (selectionState.citationNode && !editorHasSelection(selectionState)) {
        const text = selectionState.citationNode.getAttribute("data-sr-markdown") || selectionState.citationNode.textContent || "";
        if (text) {
          await writeClipboardText(text);
        }
        await removeCitationNode(selectionState.citationNode);
        return;
      }
      const text = selectionMarkdownFromState(selectionState);
      if (text) {
        await writeClipboardText(text);
      }
      deleteEditorSelection(selectionState);
      markNativeEditorDirty();
      return;
    }
    if (action === "paste") {
      const text = await readClipboardText();
      if (!text) {
        return;
      }
      if (!await insertMarkdownIntoEditor(selectionState, text)) {
        insertPlainTextIntoNativeEditor(selectionState, text);
      }
      return;
    }
    if (action === "select-all") {
      selectAllInNativeEditor();
      return;
    }
    if (action === "find") {
      await openFindReplaceDialog(selectionState);
      return;
    }
    if (action === "edit-citation") {
      await editCitationFromNode(selectionState.citationNode);
      return;
    }
    if (action === "delete-citation" && selectionState?.citationNode) {
      await removeCitationNode(selectionState.citationNode);
      return;
    }
    if (action === "remove-bibliography" && selectionState?.bibliographyBlock) {
      if (removeBibliographyBlock(selectionState.bibliographyBlock)) {
        await refreshCitationDependentRendering();
      }
      return;
    }
    if (action === "remove-prisma" && selectionState?.prismaBlock) {
      removeGeneratedSectionBlock(selectionState.prismaBlock, { type: "prisma" });
      return;
    }
    if (action === "delete-code-block" && selectionState?.codeBlock) {
      removeCodeBlock(selectionState.codeBlock);
      return;
    }
    if (action === "table-delete" && selectionState?.tableCell) {
      removeTableBlock(selectionState.tableCell.closest?.(".sr-block-table") || null);
      return;
    }
    if (action === "edit-prisma" && selectionState?.prismaBlock) {
      await openPrismaEditorDialog(selectionState.prismaBlock);
      return;
    }
    const tableContext = tableContextState(selectionState);
    if (!tableContext) {
      return;
    }
    if (action === "table-row-above" || action === "table-row-below") {
      const current = nativeTableBlockFromElement(tableContext.tableBlock);
      const targetRowIndex = action === "table-row-above"
        ? (tableContext.descriptor.section === "body" ? tableContext.descriptor.rowIndex : 0)
        : (tableContext.descriptor.section === "body" ? tableContext.descriptor.rowIndex + 1 : 0);
      const next = insertRowIntoTableBlock(current, targetRowIndex);
      replaceNativeTableBlock(tableContext.tableBlock, next, {
        focusCell: { section: "body", rowIndex: targetRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 },
        selectionCells: [{ section: "body", rowIndex: targetRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 }],
      });
      return;
    }
    if (action === "table-row-delete") {
      const current = nativeTableBlockFromElement(tableContext.tableBlock);
      const targetRowIndex = tableContext.descriptor.section === "body" ? tableContext.descriptor.rowIndex : 0;
      const next = deleteRowFromTableBlock(current, targetRowIndex);
      const nextRowIndex = Math.max(0, Math.min((next.rows?.length || 1) - 1, targetRowIndex));
      replaceNativeTableBlock(tableContext.tableBlock, next, {
        focusCell: { section: "body", rowIndex: nextRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 },
        selectionCells: [{ section: "body", rowIndex: nextRowIndex, columnIndex: tableContext.descriptor.columnIndex, colspan: 1 }],
      });
      return;
    }
    if (action === "table-column-left" || action === "table-column-right") {
      const current = nativeTableBlockFromElement(tableContext.tableBlock);
      const boundaryIndex = action === "table-column-left"
        ? tableContext.descriptor.columnIndex
        : tableContext.descriptor.columnIndex + tableContext.descriptor.colspan;
      const next = insertColumnIntoTableBlock(current, boundaryIndex);
      replaceNativeTableBlock(tableContext.tableBlock, next, {
        focusCell: {
          section: tableContext.descriptor.section === "header" ? "header" : "body",
          rowIndex: tableContext.descriptor.section === "header" ? 0 : tableContext.descriptor.rowIndex,
          columnIndex: boundaryIndex,
          colspan: 1,
        },
        selectionCells: [{
          section: tableContext.descriptor.section === "header" ? "header" : "body",
          rowIndex: tableContext.descriptor.section === "header" ? 0 : tableContext.descriptor.rowIndex,
          columnIndex: boundaryIndex,
          colspan: 1,
        }],
      });
      return;
    }
    if (action === "table-column-delete") {
      const current = nativeTableBlockFromElement(tableContext.tableBlock);
      const next = deleteColumnFromTableBlock(current, tableContext.descriptor.columnIndex);
      const nextColumnIndex = Math.max(0, Math.min(Math.max(0, next.columnCount - 1), tableContext.descriptor.columnIndex));
      replaceNativeTableBlock(tableContext.tableBlock, next, {
        focusCell: {
          section: tableContext.descriptor.section === "header" ? "header" : "body",
          rowIndex: tableContext.descriptor.section === "header" ? 0 : tableContext.descriptor.rowIndex,
          columnIndex: nextColumnIndex,
          colspan: 1,
        },
        selectionCells: [{
          section: tableContext.descriptor.section === "header" ? "header" : "body",
          rowIndex: tableContext.descriptor.section === "header" ? 0 : tableContext.descriptor.rowIndex,
          columnIndex: nextColumnIndex,
          colspan: 1,
        }],
      });
      return;
    }
    if (["table-align-left", "table-align-center", "table-align-right"].includes(action)) {
      const align = action.replace("table-align-", "");
      const current = nativeTableBlockFromElement(tableContext.tableBlock);
      const next = applyAlignmentToTableBlock(current, tableContext.selectedCells, align);
      replaceNativeTableBlock(tableContext.tableBlock, next, {
        focusCell: tableContext.descriptor,
        selectionCells: tableContext.selectedCells,
      });
      return;
    }
    if (action === "table-merge") {
      const current = nativeTableBlockFromElement(tableContext.tableBlock);
      const next = mergeTableCellsInBlock(current, tableContext.selectedCells);
      if (!next) {
        return;
      }
      const focusCell = {
        section: "body",
        rowIndex: tableContext.selectedCells[0].rowIndex,
        columnIndex: tableContext.selectedCells[0].columnIndex,
        colspan: tableContext.selectedCells.reduce((sum, cell) => sum + cell.colspan, 0),
      };
      replaceNativeTableBlock(tableContext.tableBlock, next, {
        focusCell,
        selectionCells: [focusCell],
      });
      return;
    }
    if (action === "edit-raw-table") {
      await editRawTableForCell(selectionState.tableCell);
    }
  }

  async function performRawContextAction(selectionState, action) {
    if (!selectionState) {
      return;
    }
    if (action === "copy") {
      const text = selectedTextInTextarea(rawEditor);
      if (text) {
        await writeClipboardText(text);
      }
      return;
    }
    if (action === "cut") {
      const text = selectedTextInTextarea(rawEditor);
      if (text) {
        await writeClipboardText(text);
      }
      replaceSelectedTextInTextarea(rawEditor, "");
      markDirty();
      return;
    }
    if (action === "paste") {
      const text = await readClipboardText();
      if (!text) {
        return;
      }
      replaceSelectedTextInTextarea(rawEditor, text);
      markDirty();
      return;
    }
    if (action === "insert-or-edit-citation") {
      await handleCitationInsert();
      return;
    }
    if (action.startsWith("heading-")) {
      const level = action === "heading-paragraph"
        ? 0
        : Number(action.replace("heading-", "") || 0);
      applyHeadingToRawSelection(level);
      return;
    }
    if (action.startsWith("format-")) {
      applyInlineFormatToRawSelection(action.replace("format-", ""));
      return;
    }
    if (action.startsWith("layout-")) {
      applyPageLayoutToRawSelection(action.replace("layout-", ""));
      return;
    }
    if (action === "insert-link") {
      await insertLinkFromDialog();
      return;
    }
    if (action === "insert-table-empty") {
      insertTableBlock();
      return;
    }
    if (action === "insert-table-database") {
      await insertTableFromDatabase(selectionState);
      return;
    }
    if (action === "insert-image") {
      await insertImageBlock();
      return;
    }
    if (action === "insert-page-break") {
      insertPageBreakBlock();
      return;
    }
    if (action === "insert-toc") {
      await insertTOCPlaceholder();
      return;
    }
    if (action === "insert-prisma") {
      await insertPrismaPlaceholder();
      return;
    }
    if (action === "insert-bibliography") {
      await insertBibliographyPlaceholder();
      return;
    }
    if (action === "select-all") {
      selectAllInRawEditor();
      return;
    }
    if (action === "find") {
      await openFindReplaceDialog(selectionState);
    }
  }

  function documentHasPrismaSection() {
    return String(currentMarkdown() || "").includes(prismaPlaceholderToken());
  }

  function documentHasTOCSection() {
    return String(currentMarkdown() || "").includes(String(SystematicReviewerNativeMarkdown.TOC_PLACEHOLDER_MARKDOWN || "").trim());
  }

  function documentHasBibliographySection() {
    return String(currentMarkdown() || "").includes(String(SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN || "").trim());
  }

  function headingMenuActionIDForBlock(block = null) {
    const type = String(block?.getAttribute?.("data-block-type") || "").trim().toLowerCase();
    if (type === "heading") {
      const level = Math.max(1, Math.min(6, Number(block?.getAttribute?.("data-level") || 1) || 1));
      return `heading-${level}`;
    }
    if (type === "paragraph") {
      return "heading-paragraph";
    }
    return "";
  }

  function headingMenuActionIDForNativeSelection(selectionState = null) {
    const targetBlock = selectionState?.target?.closest?.(".sr-native-block[data-block-type]");
    const editableBlock = selectionState?.editable?.closest?.(".sr-native-block[data-block-type]");
    return headingMenuActionIDForBlock(targetBlock || editableBlock || null);
  }

  function headingMenuActionIDForRawSelection(selectionState = null) {
    const textarea = selectionState?.editable?.tagName?.toLowerCase() === "textarea"
      ? selectionState.editable
      : rawEditor;
    const value = String(textarea?.value || "");
    const start = Math.max(0, Math.min(value.length, Number(selectionState?.textareaStart ?? textarea?.selectionStart ?? 0) || 0));
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndRaw = value.indexOf("\n", start);
    const lineEnd = lineEndRaw >= 0 ? lineEndRaw : value.length;
    const line = value.slice(lineStart, lineEnd);
    const match = line.match(/^#{1,6}\s+/);
    return match ? `heading-${match[0].trim().length}` : "heading-paragraph";
  }

  function createHeadingMenuItems(activeID = "") {
    const checkedID = String(activeID || "").trim();
    return [
      { id: "heading-paragraph", label: "Paragraph" },
      { separator: true },
      { id: "heading-1", label: "H1" },
      { id: "heading-2", label: "H2" },
      { id: "heading-3", label: "H3" },
      { id: "heading-4", label: "H4" },
      { id: "heading-5", label: "H5" },
      { id: "heading-6", label: "H6" },
    ].map((item) => item?.id ? { ...item, checked: item.id === checkedID } : item);
  }

  function createEditMenuItems(selectionState, mode = "native") {
    const hasSelection = mode === "native"
      ? (editorHasSelection(selectionState) || !!selectionState?.citationNode)
      : ((selectionState?.textareaEnd ?? 0) > (selectionState?.textareaStart ?? 0));
    return [
      { id: "copy", label: "Copy", disabled: !hasSelection },
      { id: "cut", label: "Cut", disabled: !hasSelection },
      { id: "paste", label: "Paste" },
      { id: "find", label: "Find..." },
      { id: "select-all", label: "Select All" },
    ];
  }

  function createFormatMenuItems(selectionState, mode = "native") {
    const hasSelection = mode === "native"
      ? editorHasSelection(selectionState)
      : ((selectionState?.textareaEnd ?? 0) > (selectionState?.textareaStart ?? 0));
    return [
      { id: "format-bold", label: "Bold", disabled: !hasSelection },
      { id: "format-italic", label: "Italic", disabled: !hasSelection },
      { id: "format-underline", label: "Underline", disabled: !hasSelection },
    ];
  }

  function createInsertMenuItems() {
    return [
      { id: "insert-link", label: "Link" },
      {
        label: "Table",
        children: [
          { id: "insert-table-empty", label: "Empty Table" },
          { id: "insert-table-database", label: "From Database" },
        ],
      },
      { id: "insert-image", label: "Image" },
      { id: "insert-page-break", label: "Page Break" },
      {
        id: "insert-toc",
        label: "Table of Contents",
        tone: documentHasTOCSection() ? "danger" : "",
      },
      {
        id: "insert-prisma",
        label: "PRISMA",
        tone: documentHasPrismaSection() ? "danger" : "",
      },
      {
        id: "insert-bibliography",
        label: "Bibliography",
        tone: documentHasBibliographySection() ? "danger" : "",
      },
    ];
  }

  function createLayoutMenuItems() {
    return [
      { id: "layout-landscape", label: "Landscape Section" },
    ];
  }

  function createNativeContextMenuItems(selectionState) {
    const items = [
      {
        id: "insert-or-edit-citation",
        label: "Insert/Edit Citation...",
        tone: selectionState?.citationNode ? "accent" : "",
      },
      { label: "Edit", children: createEditMenuItems(selectionState, "native") },
      { label: "Insert", children: createInsertMenuItems() },
      { label: "Heading", children: createHeadingMenuItems(headingMenuActionIDForNativeSelection(selectionState)) },
      { label: "Format", children: createFormatMenuItems(selectionState, "native") },
      { label: "Layout", children: createLayoutMenuItems() },
    ];
    const contextItems = [];
    if (selectionState?.sectionMarker?.matches?.(".sr-section-separator[data-sr-marker='page-break']")) {
      contextItems.push({ id: "remove-page-break", label: "Remove Page Break" });
    }
    if (selectionState?.sectionMarker?.matches?.(".sr-section-separator[data-sr-marker='page-layout']")) {
      contextItems.push({ id: "remove-landscape-marker", label: "Remove Landscape Marker" });
    }
    if (selectionState?.imageBlock) {
      if (contextItems.length) {
        contextItems.push({ separator: true });
      }
      contextItems.push({ id: "resize-image", label: "Resize Image..." });
    }
    if (selectionState?.bibliographyBlock) {
      if (contextItems.length && !contextItems[contextItems.length - 1]?.separator) {
        contextItems.push({ separator: true });
      }
      contextItems.push({ id: "remove-bibliography", label: "Remove Bibliography" });
    }
    if (selectionState?.tocBlock) {
      if (contextItems.length && !contextItems[contextItems.length - 1]?.separator) {
        contextItems.push({ separator: true });
      }
      contextItems.push({ id: "remove-toc", label: "Remove Table of Contents" });
    }
    if (selectionState?.prismaBlock) {
      if (contextItems.length && !contextItems[contextItems.length - 1]?.separator) {
        contextItems.push({ separator: true });
      }
      contextItems.push(
        { id: "edit-prisma", label: "Edit PRISMA..." },
        { id: "remove-prisma", label: "Remove PRISMA" },
      );
    }
    if (selectionState?.codeBlock) {
      if (contextItems.length && !contextItems[contextItems.length - 1]?.separator) {
        contextItems.push({ separator: true });
      }
      contextItems.push({ id: "delete-code-block", label: "Delete Code Block", tone: "danger" });
    }
    if (selectionState?.citationNode) {
      if (contextItems.length && !contextItems[contextItems.length - 1]?.separator) {
        contextItems.push({ separator: true });
      }
      contextItems.push({ id: "delete-citation", label: "Delete Citation", tone: "danger" });
    }
    const tableContext = tableContextState(selectionState);
    if (tableContext) {
      if (contextItems.length) {
        contextItems.push({ separator: true });
      }
      contextItems.push(
        { id: "table-row-above", label: "Insert Row Above" },
        { id: "table-row-below", label: "Insert Row Below" },
        { id: "table-row-delete", label: "Delete Row" },
        { separator: true },
        { id: "table-column-left", label: "Insert Column Left" },
        { id: "table-column-right", label: "Insert Column Right" },
        { id: "table-column-delete", label: "Delete Column" },
        { separator: true },
        { id: "table-merge", label: "Merge Cells", disabled: !tableContext.canMerge },
        { separator: true },
        { id: "table-align-left", label: "Align Column Left" },
        { id: "table-align-center", label: "Align Column Center" },
        { id: "table-align-right", label: "Align Column Right" },
        { separator: true },
        { id: "edit-raw-table", label: "Edit Raw Table..." },
        { separator: true },
        { id: "table-delete", label: "Delete Table", tone: "danger" },
      );
    }
    if (contextItems.length) {
      items.push({ separator: true }, ...contextItems);
    }
    return items;
  }

  function createRawContextMenuItems(selectionState) {
    return [
      { id: "insert-or-edit-citation", label: "Insert/Edit Citation..." },
      { label: "Edit", children: createEditMenuItems(selectionState, "raw") },
      { label: "Insert", children: createInsertMenuItems() },
      { label: "Heading", children: createHeadingMenuItems(headingMenuActionIDForRawSelection(selectionState)) },
      { label: "Format", children: createFormatMenuItems(selectionState, "raw") },
      { label: "Layout", children: createLayoutMenuItems() },
    ];
  }

  function openAutomationContextMenu(items, { left = 8, top = 8, onSelect } = {}) {
    closeEditorContextMenu();
    const visibleItems = (items || []).filter((item) => item && item.hidden !== true);
    if (!visibleItems.length) {
      return;
    }
    const menus = [];
    const positionMenu = (menu, x, y) => {
      const maxLeft = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = `${Math.max(8, Math.min(x, maxLeft))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, maxTop))}px`;
    };
    const renderLevel = (levelItems, x, y, depth = 0) => {
      const menu = createNode("div", { className: "sr-context-menu" });
      menu.addEventListener("contextmenu", (menuEvent) => {
        menuEvent.preventDefault();
        menuEvent.stopPropagation();
      }, true);
      menu.addEventListener("mousedown", (menuEvent) => menuEvent.stopPropagation(), true);
      for (const item of levelItems) {
        if (item.separator) {
          menu.appendChild(createNode("div", { className: "sr-context-menu-separator" }));
          continue;
        }
        const button = createButton(item.children?.length ? `${item.label} >` : item.label, "sr-context-menu-item");
        if (item.tone === "danger") {
          button.classList.add("is-active-danger");
        }
        else if (item.tone === "accent") {
          button.classList.add("is-active-accent");
        }
        if (item.checked) {
          button.classList.add("is-checked");
          button.setAttribute("aria-checked", "true");
        }
        if (item.disabled) {
          button.disabled = true;
        }
        else {
          button.addEventListener("mousedown", (menuEvent) => {
            menuEvent.preventDefault();
            menuEvent.stopPropagation();
          });
          if (item.children?.length) {
            const openChild = (menuEvent) => {
              menuEvent.preventDefault();
              menuEvent.stopPropagation();
              while (menus.length > depth + 1) {
                menus.pop()?.remove?.();
              }
              const rect = button.getBoundingClientRect();
              renderLevel(item.children, rect.right + 4, rect.top, depth + 1);
            };
            button.addEventListener("click", openChild);
            button.addEventListener("mouseenter", openChild);
          }
          else {
            button.addEventListener("click", async (menuEvent) => {
              menuEvent.preventDefault();
              menuEvent.stopPropagation();
              closeEditorContextMenu();
              await onSelect?.(item.id);
            });
          }
        }
        menu.appendChild(button);
      }
      overlayHost.appendChild(menu);
      positionMenu(menu, x, y);
      menus[depth] = menu;
      return menu;
    };
    renderLevel(visibleItems, left, top, 0);
    const closeHandler = (closeEvent) => {
      const closeTarget = closeEvent.target?.nodeType === 3 ? closeEvent.target.parentNode : closeEvent.target;
      if (closeTarget && menus.some((menu) => menu?.contains?.(closeTarget))) {
        return;
      }
      closeEditorContextMenu();
    };
    const keyHandler = (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        closeEditorContextMenu();
      }
    };
    window.addEventListener("mousedown", closeHandler, true);
    window.addEventListener("scroll", closeHandler, true);
    window.addEventListener("keydown", keyHandler, true);
    state.contextMenuState = {
      menus,
      cleanup: () => {
        window.removeEventListener("mousedown", closeHandler, true);
        window.removeEventListener("scroll", closeHandler, true);
        window.removeEventListener("keydown", keyHandler, true);
      },
    };
  }

  async function openEditorContextMenu(event, target) {
    if (state.mode !== "native") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selectionState = captureEditorSelectionState(target);
    if (selectionState.editable) {
      setActiveEditable(selectionState.editable);
    }
    openAutomationContextMenu(createNativeContextMenuItems(selectionState), {
      left: event.clientX,
      top: event.clientY,
      onSelect: async (action) => {
        await performEditorContextAction(selectionState, action);
      },
    });
  }

  async function openRawContextMenu(event) {
    if (state.mode !== "raw") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selectionState = captureRawSelectionState();
    openAutomationContextMenu(createRawContextMenuItems(selectionState), {
      left: event.clientX,
      top: event.clientY,
      onSelect: async (action) => {
        await performRawContextAction(selectionState, action);
      },
    });
  }

  function selectAllInNativeEditor() {
    const root = nativeEditor.querySelector(".sr-native-root") || nativeEditor.querySelector(".sr-doc-host") || nativeEditor;
    if (!root) {
      return false;
    }
    const selected = selectNodeContents(document, root);
    if (selected) {
      rememberLiveEditorSelection(root);
      state.lastSelectionState = captureEditorSelectionState(root);
    }
    return selected;
  }

  function selectAllInRawEditor() {
    rawEditor.focus();
    rawEditor.select();
    state.lastSelectionState = captureRawSelectionState();
    return true;
  }

  function deleteEditorSelection(selectionState) {
    if (!selectionState) {
      return;
    }
    if (selectionState.editable?.tagName?.toLowerCase() === "textarea") {
      replaceSelectedTextInTextarea(selectionState.editable, "");
      return;
    }
    const normalizeAfter = selectionSpansMultipleEditables(selectionState);
    const preferredEditable = selectionBoundaryEditableFromRange(selectionState.range, "start") || selectionState.editable || null;
    restoreEditorSelectionState(selectionState);
    try {
      const selection = document.defaultView.getSelection();
      if (selection?.deleteFromDocument) {
        selection.deleteFromDocument();
      }
      else {
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
        range?.deleteContents?.();
      }
    }
    catch (_error) {
      try {
        document.execCommand("delete", false, null);
      }
      catch (_error2) {}
    }
    if (state.mode === "native" && normalizeAfter) {
      normalizeNativeEditorAfterMutation(preferredEditable);
    }
  }

  function insertTextIntoEditor(selectionState, text) {
    if (selectionState?.editable?.tagName?.toLowerCase() === "textarea") {
      replaceSelectedTextInTextarea(selectionState.editable, text);
      return;
    }
    restoreEditorSelectionState(selectionState);
    try {
      if (document.execCommand("insertText", false, text)) {
        return;
      }
    }
    catch (_error) {}
    try {
      const selection = document.defaultView.getSelection();
      if (!selection || !selection.rangeCount) {
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    catch (_error) {}
  }

  function selectedListRowsFromState(listBlock, selectionState) {
    if (!listBlock || !selectionState?.range) {
      return [];
    }
    const startEditable = selectionBoundaryEditableFromRange(selectionState.range, "start");
    const endEditable = selectionBoundaryEditableFromRange(selectionState.range, "end");
    const startRow = startEditable?.closest?.(".sr-native-list-item") || null;
    const endRow = endEditable?.closest?.(".sr-native-list-item") || null;
    if (!startRow || !endRow || startRow.closest("[data-block-type='list']") !== listBlock || endRow.closest("[data-block-type='list']") !== listBlock) {
      return [];
    }
    const rows = Array.from(listBlock.querySelectorAll(".sr-native-list-item"));
    const startIndex = rows.indexOf(startRow);
    const endIndex = rows.indexOf(endRow);
    if (startIndex < 0 || endIndex < 0) {
      return [];
    }
    return rows.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
  }

  function handleNativeSelectionDeletionKey(event, selectionState) {
    const backwardDelete = event.key === "Backspace" || isMacBackwardDeleteKey(event);
    const forwardDelete = event.key === "Delete" && !backwardDelete;
    if ((!backwardDelete && !forwardDelete) || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (!editorHasSelection(selectionState)) {
      return false;
    }
    event.preventDefault();
    deleteEditorSelection(selectionState);
    markNativeEditorDirty();
    state.lastSelectionState = captureEditorSelectionState(state.nativeActiveEditable || selectionState?.editable || nativeEditor);
    return true;
  }

  function handleNativeTabKey(event, editable, selectionState = null) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || !editable || editable.tagName?.toLowerCase() === "textarea" || editable.classList?.contains("sr-native-table-cell")) {
      return false;
    }
    const listItem = editable.closest(".sr-native-list-item");
    const listBlock = editable.closest("[data-block-type='list']");
    if (!listItem || !listBlock) {
      return false;
    }
    event.preventDefault();
    let rows = selectedListRowsFromState(listBlock, selectionState);
    if (!rows.length) {
      rows = [listItem];
    }
    const allRows = Array.from(listBlock.querySelectorAll(".sr-native-list-item"));
    for (const row of rows) {
      const currentLevel = listItemLevel(row);
      let nextLevel = Math.max(0, currentLevel + (event.shiftKey ? -1 : 1));
      const rowIndex = allRows.indexOf(row);
      const previousRow = rowIndex > 0 ? allRows[rowIndex - 1] : null;
      const maxLevel = previousRow ? listItemLevel(previousRow) + 1 : 0;
      nextLevel = Math.min(nextLevel, maxLevel);
      setListItemLevel(row, nextLevel);
    }
    renumberListBlock(listBlock);
    setActiveEditable(editable);
    state.lastSelectionState = captureEditorSelectionState(editable);
    markNativeEditorDirty();
    return true;
  }

  function handleNativeEnterKey(event, editable, pageBody) {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (editable?.classList?.contains("sr-native-table-cell")) {
      event.preventDefault();
      focusNextTableCell(editable);
      return true;
    }
    if (!editable || editable.tagName?.toLowerCase() === "textarea") {
      return false;
    }
    if (event.shiftKey) {
      event.preventDefault();
      if (insertHardBreakIntoEditable(editable, captureEditorSelectionState(editable))) {
        markNativeEditorDirty();
        state.lastSelectionState = captureEditorSelectionState(editable);
        return true;
      }
      return false;
    }
    const contextEditable = editable.matches?.(".sr-table-context, .sr-figure-context") ? editable : null;
    const contextBlock = contextEditable?.closest?.(".sr-native-block") || null;
    if (contextEditable && contextBlock) {
      event.preventDefault();
      const nextEditable = ensureParagraphEditableAfterBlock(contextBlock);
      setActiveEditable(nextEditable || state.nativeActiveEditable);
      focusEditableStart(nextEditable);
      state.lastSelectionState = captureEditorSelectionState(nextEditable || contextEditable);
      markNativeEditorDirty();
      return true;
    }
    const listItem = editable.closest(".sr-native-list-item");
    if (listItem) {
      event.preventDefault();
      const split = splitEditableAtSelection(editable);
      const listBlock = editable.closest("[data-block-type='list']");
      const ordered = listBlock?.getAttribute("data-list-kind") === "ol";
      if (!String(split.before || "").trim() && !String(split.after || "").trim()) {
        const paragraph = createParagraphBlock("");
        listBlock?.after?.(paragraph);
        listItem.remove();
        if (listBlock && !listBlock.querySelector(".sr-native-list-item")) {
          listBlock.remove();
        }
        else {
          renumberListBlock(listBlock);
        }
        const nextEditable = paragraph.querySelector(".sr-block-editable");
        setActiveEditable(nextEditable || state.nativeActiveEditable);
        focusEditableStart(nextEditable);
        markNativeEditorDirty();
        return true;
      }
      setEditableMarkdown(editable, split.before);
      const newItem = createListItemRow(split.after, ordered, 0, listItemLevel(listItem));
      listItem.after(newItem);
      renumberListBlock(listBlock);
      const nextEditable = newItem.querySelector(".sr-block-editable");
      setActiveEditable(nextEditable || state.nativeActiveEditable);
      focusEditableStart(nextEditable);
      markNativeEditorDirty();
      return true;
    }
    const block = editable.closest(".sr-native-block");
    const blockType = block?.getAttribute("data-block-type") || "";
    if (!block || !["paragraph", "heading"].includes(blockType)) {
      return false;
    }
    event.preventDefault();
    const split = splitEditableAtSelection(editable);
    const newBlock = createParagraphBlock(split.after);
    if (blockType === "heading" && split.collapsed && !split.before && split.after === split.full) {
      block.before(newBlock);
    }
    else {
      setEditableMarkdown(editable, split.before);
      if (blockType === "heading" && !String(split.before || "").trim()) {
        block.setAttribute("data-block-type", "paragraph");
        block.className = "sr-native-block sr-block-paragraph";
        block.removeAttribute("data-level");
      }
      block.after(newBlock);
    }
    const nextEditable = newBlock.querySelector(".sr-block-editable");
    setActiveEditable(nextEditable || state.nativeActiveEditable);
    focusEditableStart(nextEditable);
    markNativeEditorDirty();
    return true;
  }

  function handleNativeDeletionKey(event, editable) {
    const backwardDelete = event.key === "Backspace" || isMacBackwardDeleteKey(event);
    const forwardDelete = event.key === "Delete" && !backwardDelete;
    if ((!backwardDelete && !forwardDelete) || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (!editable || editable.tagName?.toLowerCase() === "textarea" || editable.classList?.contains("sr-native-table-cell")) {
      return false;
    }
    const range = selectionRangeWithinEditable(editable);
    if (range && !range.collapsed) {
      return false;
    }
    const hasMeaningfulContent = String(inlineMarkdownFromNode(editable) || "").trim().length > 0;
    if (hasMeaningfulContent) {
      return false;
    }
    const listItem = editable.closest(".sr-native-list-item");
    if (listItem) {
      event.preventDefault();
      const listBlock = editable.closest("[data-block-type='list']");
      const body = listBlock?.closest?.(".sr-page-editor-body") || activePageBody();
      listItem.remove();
      if (listBlock && !listBlock.querySelector(".sr-native-list-item")) {
        const paragraph = createParagraphBlock("");
        if (body) {
          listBlock.after(paragraph);
        }
        listBlock?.remove?.();
        const nextEditable = paragraph.querySelector(".sr-block-editable");
        setActiveEditable(nextEditable || state.nativeActiveEditable);
        focusEditableStart(nextEditable);
      }
      else {
        renumberListBlock(listBlock);
        focusNearestEditableFromBlock(listBlock);
      }
      markNativeEditorDirty();
      return true;
    }
    const block = editable.closest(".sr-native-block");
    const type = block?.getAttribute("data-block-type") || "";
    if (!block || !["paragraph", "heading"].includes(type)) {
      return false;
    }
    event.preventDefault();
    const body = block.closest(".sr-page-editor-body");
    let nextFocus = focusNearestEditableFromBlock(block);
    block.remove();
    if (!body?.querySelector?.("[data-sr-editable='true']")) {
      const paragraph = createParagraphBlock("");
      body?.appendChild(paragraph);
      nextFocus = paragraph.querySelector(".sr-block-editable");
      focusEditableStart(nextFocus);
    }
    setActiveEditable(nextFocus || state.nativeActiveEditable);
    markNativeEditorDirty();
    return true;
  }

  function ensureNativeSurfaceReady() {
    const pageBodies = Array.from(nativeEditor.querySelectorAll(".sr-editor-section-body, .sr-page-sheet-body"));
    pageBodies.forEach((body) => {
      body.classList.add("sr-page-editor-body");
      body.setAttribute("data-sr-page-body", "true");
      if (!body.querySelector("[data-sr-editable='true']")) {
        const paragraph = document.createElement("section");
        paragraph.className = "sr-native-block sr-block-paragraph";
        paragraph.setAttribute("data-block-type", "paragraph");
        const editable = document.createElement("div");
        editable.className = "sr-block-editable";
        editable.innerHTML = "<br />";
        paragraph.appendChild(editable);
        body.appendChild(paragraph);
      }
    });
    Array.from(nativeEditor.querySelectorAll(".sr-block-editable,.sr-native-table-cell")).forEach((node) => {
      const blockType = node.closest?.("[data-block-type]")?.getAttribute?.("data-block-type") || "";
      const readOnly = ["bibliography", "prisma", "toc"].includes(blockType) || node.getAttribute("data-sr-editable") === "false";
      node.setAttribute("contenteditable", readOnly ? "false" : "true");
      node.setAttribute("data-sr-editable", readOnly ? "false" : "true");
      if (!readOnly && !String(node.innerHTML || "").trim()) {
        node.innerHTML = "<br />";
      }
    });
    Array.from(nativeEditor.querySelectorAll(".sr-citation-chip")).forEach((node) => {
      node.setAttribute("contenteditable", "false");
      node.setAttribute("data-sr-editable", "false");
    });
    Array.from(nativeEditor.querySelectorAll(".sr-editor-section, .sr-page-sheet")).forEach((sheet) => {
      const body = sheet.querySelector(".sr-editor-section-body") || sheet.querySelector(".sr-page-sheet-body");
      const hasLandscapeMarker = !!body?.querySelector?.(".sr-section-separator[data-sr-marker='page-layout'][data-sr-layout='landscape']");
      const inferredLayout = sheet.classList.contains("sr-editor-section")
        ? (hasLandscapeMarker ? "landscape" : "portrait")
        : (sheet.getAttribute("data-sr-layout") === "landscape" ? "landscape" : "portrait");
      sheet.setAttribute("data-sr-layout", inferredLayout);
      sheet.setAttribute("data-sr-page-source", sheet.getAttribute("data-sr-page-source") === "auto" ? "auto" : "manual");
    });
    Array.from(nativeEditor.querySelectorAll(".sr-native-block")).forEach((block, index) => {
      block.dataset.blockIndex = String(index);
    });
    autosizeCodeTextareas(nativeEditor);
    refreshPageSheetIndices(nativeEditor);
    SystematicReviewerNativeMarkdown.markWrappedProseTableCells(nativeEditor);
    setActiveEditable(nativeEditor.querySelector("[data-sr-editable='true']") || null);
  }

  function applyRenderState(renderState = null, options = {}) {
    state.renderState = renderState || state.renderState || null;
    const mounted = { preview: false, native: false };
    const preservePreviewScroll = !!options?.preservePreviewScroll;
    const previewScrollState = preservePreviewScroll ? capturePreviewScrollState() : null;
    if (state.renderState && typeof state.renderState == "object") {
      state.baseURL = String(state.renderState?.base_url || state.baseURL || "");
      state.lastRenderedReportHash = String(state.renderState?.report_hash || state.lastRenderedReportHash || "");
    }
    if (!state.renderState) {
      preview.innerHTML = `<div class="sr-workspace-empty">No REPORT.md is available yet.</div>`;
      withNativeMutationObserverPaused(() => {
        nativeEditor.innerHTML = `<div class="sr-workspace-empty">No markdown document is available yet.</div>`;
      });
      if (previewScrollState) {
        restorePreviewScrollStateAfterLayout(previewScrollState);
      }
      return mounted;
    }
    const requestedSurfaces = new Set(
      Array.isArray(options?.surfaces) && options.surfaces.length
        ? options.surfaces
        : (state.mode === "raw" ? [] : [surfaceForMode(state.mode)].filter(Boolean))
    );
    if (requestedSurfaces.has("preview")
      && Object.prototype.hasOwnProperty.call(state.renderState, "preview_html")
      && state.renderState.preview_html) {
      preview.innerHTML = String(state.renderState.preview_html || "");
      mounted.preview = true;
      scheduleSurfaceReflow("preview");
    }
    if (requestedSurfaces.has("native")
      && Object.prototype.hasOwnProperty.call(state.renderState, "native_html")
      && state.renderState.native_html) {
      withNativeMutationObserverPaused(() => {
        nativeEditor.innerHTML = String(state.renderState.native_html || "");
        ensureNativeSurfaceReady();
      });
      if (state.mode === "native") {
        scheduleSurfaceReflow("native");
      }
      mounted.native = true;
    }
    if (previewScrollState && mounted.preview) {
      restorePreviewScrollStateAfterLayout(previewScrollState);
    }
    if (mounted.preview || mounted.native) {
      scheduleFindPanelRefresh({
        preserveIndex: true,
        delay: 0,
      });
    }
    return mounted;
  }

  function currentRenderSignature() {
    return `${Number(state.markdownRevision || 0)}:${Number(state.settingsRevision || 0)}`;
  }

  function surfaceForMode(mode = state.mode) {
    const nextMode = String(mode || "").trim();
    if (nextMode === "preview" || nextMode === "native") {
      return nextMode;
    }
    return "";
  }

  function invalidateRenderedSurfaces() {
    state.renderedSignature.preview = "";
    state.renderedSignature.native = "";
  }

  function renderedStateHasSurface(renderState, surface) {
    if (!renderState) {
      return false;
    }
    if (surface === "preview") {
      return Object.prototype.hasOwnProperty.call(renderState, "preview_html") && !!renderState.preview_html;
    }
    if (surface === "native") {
      return Object.prototype.hasOwnProperty.call(renderState, "native_html") && !!renderState.native_html;
    }
    return false;
  }

  async function ensureRenderedSurface(surface, providedState = null, options = {}) {
    if (!["preview", "native"].includes(surface)) {
      return;
    }
    const signature = currentRenderSignature();
    const hydratedState = renderedStateHasSurface(providedState, surface) ? providedState : null;
    if (!hydratedState && state.renderedSignature[surface] === signature) {
      return;
    }
    let renderState = hydratedState;
    if (!renderState) {
      const token = ++state.renderToken;
      let payload = {
        editor_settings: automationEditorSettingsPayload(state.editorSettings),
        surface,
      };
      if (!options?.readFromDisk) {
        payload.markdown = currentMarkdown();
      }
      renderState = await ctx.invoke("automation.document.render", payload);
      if (state.destroyed || token !== state.renderToken) {
        return;
      }
    }
    state.renderState = Object.assign({}, state.renderState || {}, renderState || {});
    state.baseURL = String(renderState?.base_url || state.baseURL || "");
    state.lastRenderedReportHash = String(renderState?.report_hash || state.lastRenderedReportHash || "");
    applyRenderState(renderState, {
      surfaces: [surface],
      preservePreviewScroll: surface === "preview" && !!options?.preservePreviewScroll,
    });
    state.renderedSignature[surface] = signature;
  }

  function serializeNativeBlocks() {
    return SystematicReviewerNativeMarkdown.collectNativeEditorBlocks(nativeEditor);
  }

  function syncNativeMarkdownBufferFromEditor() {
    if (!nativeEditor?.querySelector?.(".sr-native-root")) {
      return state.markdown;
    }
    const nextMarkdown = SystematicReviewerNativeMarkdown.serializeBlocks(serializeNativeBlocks());
    if (String(nextMarkdown || "") !== String(state.markdown || "")) {
      state.markdown = String(nextMarkdown || "");
      state.markdownRevision += 1;
      rawEditor.value = state.markdown;
    }
    return state.markdown;
  }

  function currentMarkdown() {
    if (state.mode === "raw") {
      return rawEditor.value;
    }
    if (state.mode === "native" || state.nativeDirty) {
      return syncNativeMarkdownBufferFromEditor();
    }
    return state.markdown;
  }

  function hasPendingDocumentChanges() {
    if (state.dirty || state.nativeDirty) {
      return true;
    }
    if (!state.bootstrap?.current_project) {
      return false;
    }
    return String(currentMarkdown() || "") !== String(state.lastSavedMarkdown || "");
  }

  async function savePendingDocument(options = {}) {
    if (!hasPendingDocumentChanges()) {
      return null;
    }
    return await saveDocument(options);
  }

  function markDirty() {
    state.dirty = true;
    state.markdownRevision += 1;
    if (state.mode === "native") {
      state.nativeDirty = true;
      state.renderedSignature.preview = "";
    }
    else {
      invalidateRenderedSurfaces();
    }
    if (state.mode !== "raw") {
      rawEditor.value = currentMarkdown();
    }
    scheduleFindPanelRefresh({
      preserveIndex: true,
      delay: 80,
    });
    saveBtn.classList.toggle("sr-workspace-btn-primary", true);
  }

  function clearDirty(markdown) {
    state.dirty = false;
    state.nativeDirty = false;
    state.markdown = String(markdown ?? state.markdown ?? "");
    state.markdownRevision += 1;
    state.lastSavedMarkdown = state.markdown;
    rawEditor.value = state.markdown;
    const signature = currentRenderSignature();
    if (state.mode === "native") {
      state.renderedSignature.native = signature;
    }
    else if (state.mode === "preview") {
      state.renderedSignature.preview = signature;
    }
    else {
      invalidateRenderedSurfaces();
    }
    saveBtn.classList.toggle("sr-workspace-btn-primary", false);
  }

  function keepDirtyAfterStaleSave(persistedMarkdown) {
    state.dirty = true;
    state.lastSavedMarkdown = String(persistedMarkdown ?? "");
    if (state.mode === "native") {
      state.nativeDirty = true;
      state.renderedSignature.preview = "";
    }
    else {
      invalidateRenderedSurfaces();
    }
    saveBtn.classList.toggle("sr-workspace-btn-primary", true);
  }

  function setMode(mode) {
    const nextMode = ["preview", "native", "raw"].includes(mode) ? mode : "preview";
    const sourceMarkdown = currentMarkdown();
    state.mode = nextMode;
    preview.hidden = state.mode !== "preview";
    nativeEditor.hidden = state.mode !== "native";
    rawEditor.hidden = state.mode !== "raw";
    modePreviewBtn.classList.toggle("active", state.mode === "preview");
    modeNativeBtn.classList.toggle("active", state.mode === "native");
    modeRawBtn.classList.toggle("active", state.mode === "raw");
    updateToolbarVisibility();
    if (state.mode === "raw") {
      rawEditor.value = sourceMarkdown;
      rawEditor.focus();
    }
    else if (state.mode === "native") {
      activeEditable()?.focus?.();
    }
    if (state.mode === "native") {
      scheduleSurfaceReflow("native");
    }
    else if (state.mode === "preview") {
      scheduleSurfaceReflow("preview");
    }
    scheduleFindPanelRefresh({
      preserveIndex: true,
      delay: 0,
    });
  }

  async function saveDocument(options = {}) {
    const silent = !!options?.silent;
    const saveReason = String(options?.saveReason || "");
    const surface = String(options?.surface || "").trim();
    const markdown = currentMarkdown();
    const requestedSurface = ["preview", "native"].includes(surface)
      ? surface
      : (Object.prototype.hasOwnProperty.call(options || {}, "surface") ? "" : surfaceForMode(state.mode));
    const result = await ctx.invoke("automation.document.save", {
      markdown,
      editor_settings: automationEditorSettingsPayload(state.editorSettings),
      surface: requestedSurface,
      save_reason: saveReason,
    });
    const persistedMarkdown = Object.prototype.hasOwnProperty.call(result || {}, "markdown")
      ? String(result.markdown || "")
      : String(markdown || "");
    const saveStillMatchesEditor = String(currentMarkdown() || "") === persistedMarkdown;
    if (saveStillMatchesEditor) {
      clearDirty(persistedMarkdown);
    }
    else {
      keepDirtyAfterStaleSave(persistedMarkdown);
    }
    state.baseURL = String(result?.base_url || state.baseURL || "");
    state.lastRenderedReportHash = String(result?.report_hash || state.lastRenderedReportHash || "");
    if (requestedSurface && saveStillMatchesEditor) {
      await ensureRenderedSurface(requestedSurface, result);
    }
    if (!silent) {
      setStatus("REPORT.md saved", "ready");
    }
    return result;
  }

  async function switchMode(nextMode) {
    if (state.chatRun?.status === "running" && nextMode !== "preview") {
      setStatus("Preview stays available while the session is running. Editor and Raw unlock when the run stops.", "ready");
      return;
    }
    if (state.mode === nextMode) {
      return;
    }
    let savedResult = null;
    if (state.bootstrap?.current_project) {
      const saveSurface = surfaceForMode(nextMode);
      savedResult = await saveDocument({
        silent: true,
        surface: saveSurface,
        saveReason: "mode-switch-save",
      });
    }
    const surface = surfaceForMode(nextMode);
    if (surface) {
      await ensureRenderedSurface(surface, savedResult, {
        preservePreviewScroll: surface === "preview",
      });
    }
    setMode(nextMode);
    if (nextMode === "raw" && !(state.dirty || state.nativeDirty)) {
      rawEditor.value = state.markdown;
    }
  }

  function updateModeControlAvailability() {
    let running = state.chatRun?.status === "running";
    modePreviewBtn.disabled = false;
    modeNativeBtn.disabled = running;
    modeRawBtn.disabled = running;
  }

  function applyReadOnlyPreviewRefresh(renderState = null, options = {}) {
    if (!renderState || typeof renderState != "object") {
      return false;
    }
    state.baseURL = String(renderState?.base_url || state.baseURL || "");
    state.lastRenderedReportHash = String(renderState?.report_hash || state.lastRenderedReportHash || "");
    state.renderState = Object.assign({}, state.renderState || {}, renderState || {});
    applyRenderState(renderState, {
      surfaces: ["preview"],
      preservePreviewScroll: !!options?.preservePreviewScroll,
    });
    if (Object.prototype.hasOwnProperty.call(renderState, "markdown")) {
      clearDirty(String(renderState.markdown || ""));
    }
    state.renderedSignature.preview = currentRenderSignature();
    return true;
  }

  async function refreshPreviewFromDisk(options = {}) {
    if (state.destroyed || state.mode !== "preview" || state.dirty || state.nativeDirty) {
      return false;
    }
    if (state.previewRefreshInFlight) {
      state.pendingPreviewRefresh = true;
      state.pendingPreviewRefreshForce = state.pendingPreviewRefreshForce || !!options?.force;
      return false;
    }
    state.previewRefreshInFlight = true;
    clearPreviewRefreshTimer();
    const token = ++state.previewRefreshToken;
    try {
      const renderState = await ctx.invoke("automation.document.render", {
        editor_settings: automationEditorSettingsPayload(state.editorSettings),
        surface: "preview",
      });
      if (state.destroyed || token !== state.previewRefreshToken) {
        return false;
      }
      const nextHash = String(renderState?.report_hash || "").trim();
      const shouldApply = !!options?.force || !nextHash || nextHash !== state.lastRenderedReportHash;
      if (!shouldApply) {
        state.baseURL = String(renderState?.base_url || state.baseURL || "");
        state.lastRenderedReportHash = nextHash || state.lastRenderedReportHash;
        return false;
      }
      applyReadOnlyPreviewRefresh(renderState, {
        preservePreviewScroll: true,
      });
      return true;
    }
    finally {
      state.previewRefreshInFlight = false;
      if (state.pendingPreviewRefresh && !state.destroyed) {
        const rerunForce = state.pendingPreviewRefreshForce;
        state.pendingPreviewRefresh = false;
        state.pendingPreviewRefreshForce = false;
        refreshPreviewFromDisk({ force: rerunForce }).catch((error) => setStatus(error?.message || String(error), "error"));
      }
    }
  }

  function schedulePreviewRefresh(options = {}) {
    if (state.destroyed || state.mode !== "preview") {
      return;
    }
    if (state.previewRefreshInFlight) {
      state.pendingPreviewRefresh = true;
      state.pendingPreviewRefreshForce = state.pendingPreviewRefreshForce || !!options?.force;
      return;
    }
    clearPreviewRefreshTimer();
    state.previewRefreshTimer = window.setTimeout(() => {
      state.previewRefreshTimer = 0;
      refreshPreviewFromDisk({
        force: !!options?.force,
      }).catch((error) => setStatus(error?.message || String(error), "error"));
    }, Math.max(0, Number(options?.delayMs || 0) || 0));
  }

  async function prepareDocumentForChatRun() {
    if (state.destroyed) {
      return;
    }
    if (hasPendingDocumentChanges()) {
      await savePendingDocument({
        silent: true,
        surface: "",
        saveReason: "chat-send-save",
      });
    }
    if (state.mode !== "preview") {
      await ensureRenderedSurface("preview", null, {
        preservePreviewScroll: true,
      });
      setMode("preview");
    }
    else if (!state.renderedSignature.preview) {
      await ensureRenderedSurface("preview", null, {
        preservePreviewScroll: true,
      });
    }
  }

  function closeOverlay() {
    if (state.overlay) {
      try {
        state.overlay.__srCleanup?.();
      }
      catch (_error) {}
      state.overlay.remove();
      state.overlay = null;
    }
  }

  function setEditableHTML(editable, html) {
    if (!editable) {
      return;
    }
    editable.innerHTML = html || "<br />";
  }

  function activeEditable() {
    const focused = document.activeElement;
    if (nativeEditor.contains(focused) && focused?.getAttribute?.("data-sr-editable") === "true") {
      setActiveEditable(focused);
    }
    return state.nativeActiveEditable || state.activeEditable || nativeEditor.querySelector("[data-sr-editable='true']") || null;
  }

  function citationCatalogEntry(itemKey = "") {
    const target = String(itemKey || "").trim();
    if (!target) {
      return null;
    }
    return state.citationCatalog.find((item) => String(item?.item_key || "").trim() === target) || null;
  }

  function citationChipLabelCacheKey(itemKey = "") {
    return [
      String(state.editorSettings?.citationStyleID || "").trim(),
      String(state.editorSettings?.citationLocale || "").trim(),
      String(itemKey || "").trim(),
    ].join("::");
  }

  function fallbackCitationChipLabel(itemKey = "") {
    const entry = citationCatalogEntry(itemKey);
    if (!entry) {
      return String(itemKey || "").trim();
    }
    const authorText = optionalString(entry.authors);
    const yearText = optionalString(entry.year);
    if (authorText && yearText) {
      return `${authorText} (${yearText})`;
    }
    return authorText || yearText || optionalString(entry.title) || String(itemKey || "").trim();
  }

  function compareCitationText(left = "", right = "") {
    return String(left || "").localeCompare(String(right || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }

  function citationYearValue(entry = null) {
    const raw = String(entry?.year || "").trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function defaultCitationCatalogCompare(left = {}, right = {}) {
    const authorCompare = compareCitationText(left?.authors, right?.authors);
    if (authorCompare) {
      return authorCompare;
    }
    const leftYear = citationYearValue(left);
    const rightYear = citationYearValue(right);
    if (leftYear !== null || rightYear !== null) {
      if (leftYear === null) {
        return 1;
      }
      if (rightYear === null) {
        return -1;
      }
      if (leftYear !== rightYear) {
        return leftYear - rightYear;
      }
    }
    else {
      const rawYearCompare = compareCitationText(left?.year, right?.year);
      if (rawYearCompare) {
        return rawYearCompare;
      }
    }
    const titleCompare = compareCitationText(left?.title, right?.title);
    if (titleCompare) {
      return titleCompare;
    }
    return compareCitationText(left?.item_key, right?.item_key);
  }

  function compareCitationCatalogEntries(left = {}, right = {}, sortState = {}) {
    const key = String(sortState?.key || "authors").trim() || "authors";
    const direction = String(sortState?.direction || "asc").trim() === "desc" ? -1 : 1;
    let primary = 0;
    if (key === "year") {
      const leftYear = citationYearValue(left);
      const rightYear = citationYearValue(right);
      if (leftYear !== null || rightYear !== null) {
        if (leftYear === null) {
          primary = 1;
        }
        else if (rightYear === null) {
          primary = -1;
        }
        else {
          primary = leftYear - rightYear;
        }
      }
      else {
        primary = compareCitationText(left?.year, right?.year);
      }
    }
    else if (key === "title") {
      primary = compareCitationText(left?.title, right?.title);
    }
    else {
      primary = compareCitationText(left?.authors, right?.authors);
    }
    if (primary) {
      return primary * direction;
    }
    return defaultCitationCatalogCompare(left, right);
  }

  async function ensureCitationChipLabel(itemKey = "", options = {}) {
    const cleanKey = String(itemKey || "").trim();
    if (!cleanKey) {
      return "";
    }
    const cacheKey = citationChipLabelCacheKey(cleanKey);
    if (state.citationChipLabelCache.has(cacheKey)) {
      return String(state.citationChipLabelCache.get(cacheKey) || "");
    }
    if (state.citationChipLabelPromiseCache.has(cacheKey)) {
      return await state.citationChipLabelPromiseCache.get(cacheKey);
    }
    const promise = ctx.invoke("automation.citation.preview", {
      citation: { keys: [cleanKey] },
      editor_settings: automationEditorSettingsPayload(state.editorSettings),
    })
      .then((result) => {
        const label = String(result?.citation?.text || "").trim() || fallbackCitationChipLabel(cleanKey);
        state.citationChipLabelCache.set(cacheKey, label);
        options?.onResolve?.(label);
        return label;
      })
      .catch(() => {
        const fallback = fallbackCitationChipLabel(cleanKey);
        state.citationChipLabelCache.set(cacheKey, fallback);
        return fallback;
      })
      .finally(() => {
        state.citationChipLabelPromiseCache.delete(cacheKey);
      });
    state.citationChipLabelPromiseCache.set(cacheKey, promise);
    return await promise;
  }

  async function openCitationDialog(existingCitation = null) {
    closeOverlay();
    await ensureCitationCatalogLoaded();
    const catalog = Array.isArray(state.citationCatalog) ? state.citationCatalog : [];
    let selectedKeys = Array.from(new Set(
      (Array.isArray(existingCitation?.keys) ? existingCitation.keys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean)
    ));
    const sortState = {
      key: "authors",
      direction: "asc",
    };
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", { className: "sr-dialog sr-citation-dialog" });
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "sr-field-input";
    searchInput.placeholder = "Search title, author, year, or journal";
    const resultsStatus = createNode("div", { className: "sr-dialog-subtitle" });
    const headerButtons = new Map();
    const createSortHeader = (key, label) => {
      const button = createNode("button", {
        className: "sr-dialog-sort-header",
        textContent: label,
        attrs: { type: "button" },
      });
      button.addEventListener("click", () => {
        if (sortState.key === key) {
          sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
        }
        else {
          sortState.key = key;
          sortState.direction = "asc";
        }
        updateSortHeaders();
        renderResults();
      });
      headerButtons.set(key, button);
      return createNode("div", { children: [button] });
    };
    const resultsHeader = createNode("div", {
      className: "sr-dialog-results-header",
      children: [
        createSortHeader("authors", "Authors"),
        createSortHeader("year", "Year"),
        createSortHeader("title", "Title"),
        createNode("div", { textContent: "" }),
      ],
    });
    const resultsList = createNode("div", { className: "sr-dialog-list" });
    const selectionBar = createNode("div", { className: "sr-dialog-selection" });
    const prefixInput = document.createElement("input");
    prefixInput.className = "sr-field-input";
    prefixInput.type = "text";
    prefixInput.placeholder = "Optional prefix";
    prefixInput.value = existingCitation?.prefix || "";
    const locatorInput = document.createElement("input");
    locatorInput.className = "sr-field-input";
    locatorInput.type = "text";
    locatorInput.placeholder = "(e.g. p. 12)";
    locatorInput.value = existingCitation?.locator || "";
    const suffixInput = document.createElement("input");
    suffixInput.className = "sr-field-input";
    suffixInput.type = "text";
    suffixInput.placeholder = "Optional suffix";
    suffixInput.value = existingCitation?.suffix || "";
    const insertBtn = createButton(existingCitation ? "Save Citation" : "Insert Citation", "sr-workspace-btn sr-workspace-btn-primary");
    const cancelBtn = createButton("Cancel");
    const selectedCountLabel = createNode("div", { className: "sr-dialog-subtitle", textContent: `Selected items: ${selectedKeys.length}` });

    function updateSortHeaders() {
      for (const [key, button] of headerButtons.entries()) {
        const active = sortState.key === key;
        let label = key === "authors" ? "Authors" : (key === "year" ? "Year" : "Title");
        if (active) {
          if (key === "year") {
            label = `${label} (${sortState.direction === "desc" ? "New-Old" : "Old-New"})`;
          }
          else {
            label = `${label} (${sortState.direction === "desc" ? "Z-A" : "A-Z"})`;
          }
        }
        button.textContent = label;
      }
    }

    function queueSelectedChipLabel(itemKey) {
      ensureCitationChipLabel(itemKey, {
        onResolve: () => {
          if (state.overlay === overlay && selectedKeys.includes(itemKey)) {
            renderSelection();
          }
        },
      }).catch(() => {});
    }

    function toggleSelectedKey(itemKey) {
      const cleanKey = String(itemKey || "").trim();
      if (!cleanKey) {
        return;
      }
      if (selectedKeys.includes(cleanKey)) {
        selectedKeys = selectedKeys.filter((key) => key !== cleanKey);
      }
      else {
        selectedKeys.push(cleanKey);
        queueSelectedChipLabel(cleanKey);
      }
      renderSelection();
      renderResults();
    }

    function renderSelection() {
      selectionBar.replaceChildren();
      selectedCountLabel.textContent = `Selected items: ${selectedKeys.length}`;
      if (!selectedKeys.length) {
        selectionBar.appendChild(createNode("div", { className: "sr-dialog-selection-empty", textContent: "No selected items" }));
        insertBtn.disabled = true;
        return;
      }
      insertBtn.disabled = false;
      for (const key of selectedKeys) {
        const item = citationCatalogEntry(key);
        const cachedLabel = state.citationChipLabelCache.get(citationChipLabelCacheKey(key));
        const label = String(cachedLabel || fallbackCitationChipLabel(key) || item?.title || key);
        if (!cachedLabel) {
          queueSelectedChipLabel(key);
        }
        const chip = createNode("div", {
          className: "sr-dialog-chip",
          children: [
            createNode("div", { className: "sr-dialog-chip-label", textContent: label }),
            (() => {
              const removeBtn = createButton("x", "sr-dialog-chip-remove", { "aria-label": "Remove citation item" });
              removeBtn.addEventListener("click", (event) => {
                event.preventDefault();
                toggleSelectedKey(key);
              });
              return removeBtn;
            })(),
          ],
        });
        selectionBar.appendChild(chip);
      }
    }

    function renderResults() {
      const q = optionalString(searchInput.value).toLowerCase();
      const filtered = (q
        ? catalog.filter((entry) => `${entry.authors} ${entry.year} ${entry.title} ${entry.publication_title}`.toLowerCase().includes(q))
        : catalog.slice())
        .sort((left, right) => compareCitationCatalogEntries(left, right, sortState));
      const visibleRows = filtered.slice(0, 250);
      resultsList.replaceChildren();
      resultsStatus.textContent = filtered.length > 250
        ? `Showing 250 of ${filtered.length} papers.`
        : `${filtered.length} paper${filtered.length === 1 ? "" : "s"} available.`;
      visibleRows.forEach((entry) => {
        const selected = selectedKeys.includes(entry.item_key);
        const row = createNode("div", {
          className: `sr-dialog-row${selected ? " selected" : ""}`,
          children: [
            createNode("div", { className: "sr-dialog-col-meta sr-dialog-col-authors", textContent: entry.authors || "No author" }),
            createNode("div", { className: "sr-dialog-col-meta", textContent: entry.year || "n.d." }),
            createNode("div", {
              className: "sr-dialog-col-title",
              children: [
                createNode("div", { className: "sr-dialog-item-title", textContent: entry.title || "(Untitled)" }),
                createNode("div", { className: "sr-dialog-item-subtitle", textContent: entry.publication_title || "" }),
              ],
            }),
            (() => {
              const addBtn = createButton(selected ? "-" : "+", "sr-workspace-btn sr-dialog-add", {
                "aria-label": selected ? "Remove citation item" : "Add citation item",
              });
              addBtn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleSelectedKey(entry.item_key);
              });
              return createNode("div", { className: "sr-dialog-col-action", children: [addBtn] });
            })(),
          ],
        });
        row.addEventListener("click", () => {
          toggleSelectedKey(entry.item_key);
        });
        resultsList.appendChild(row);
      });
    }

    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: existingCitation ? "Edit Citation" : "Add Citation" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Only papers from this project and its subcollections are available here." }),
            ],
          }),
          createButton("X", "sr-workspace-btn sr-dialog-close", { "aria-label": "Close" }),
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [
          createNode("div", {
            className: "sr-dialog-main",
            children: [
              searchInput,
              resultsStatus,
              createNode("div", {
                className: "sr-dialog-results",
                children: [resultsHeader, resultsList],
              }),
            ],
          }),
          createNode("div", {
            className: "sr-dialog-side",
            children: [
              selectionBar,
              selectedCountLabel,
              createNode("label", { className: "sr-field-label", textContent: "Prefix", children: [prefixInput] }),
              createNode("label", { className: "sr-field-label", textContent: "Locator", children: [locatorInput] }),
              createNode("label", { className: "sr-field-label", textContent: "Suffix", children: [suffixInput] }),
            ],
          }),
        ],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          createNode("div", { className: "sr-dialog-subtitle", textContent: "Click a row or use + / - to add and remove papers." }),
          createNode("div", { className: "sr-workspace-toolbar", children: [cancelBtn, insertBtn] }),
        ],
      }),
    );
    const closeBtn = dialog.querySelector(".sr-dialog-header button:last-child");
    const resultPromise = new Promise((resolve) => {
      let settled = false;
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          resolveDialog(null);
        }
      };
      const resolveDialog = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("keydown", keyHandler, true);
        closeOverlay();
        resolve(value);
      };
      insertBtn.addEventListener("click", () => {
        const next = {
          keys: selectedKeys.slice(),
          prefix: optionalString(prefixInput.value),
          locator: optionalString(locatorInput.value),
          suffix: optionalString(suffixInput.value),
        };
        resolveDialog(next);
      }, { once: true });
      cancelBtn.addEventListener("click", () => resolveDialog(null), { once: true });
      closeBtn?.addEventListener("click", () => resolveDialog(null), { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          resolveDialog(null);
        }
      }, { once: true });
      window.addEventListener("keydown", keyHandler, true);
    });
    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    searchInput.addEventListener("input", renderResults);
    updateSortHeaders();
    renderSelection();
    renderResults();
    searchInput.focus();
    return await resultPromise;
  }

  async function ensureCitationCatalogLoaded() {
    if (Array.isArray(state.citationCatalog) && state.citationCatalog.length) {
      return state.citationCatalog;
    }
    if (!state.citationCatalogPromise) {
      state.citationCatalogPromise = ctx.invoke("automation.citation.catalog", {})
        .then((result) => {
          state.citationCatalog = Array.isArray(result?.items) ? result.items.slice() : [];
          return state.citationCatalog;
        })
        .finally(() => {
          state.citationCatalogPromise = null;
        });
    }
    return await state.citationCatalogPromise;
  }

  function citationChipHTML(choice) {
    const token = SystematicReviewerNativeMarkdown.makeCitationMarkdown(choice || {});
    const preview = citationMapFromRenderState(state.renderState || {}).get(token) || null;
    const labels = (choice?.keys || []).map((key) => {
      const cached = state.citationChipLabelCache.get(citationChipLabelCacheKey(key));
      return cached || fallbackCitationChipLabel(key) || key;
    }).filter(Boolean).join("; ");
    return `&#8203;<span class="sr-citation-chip" contenteditable="false" data-sr-editable="false" data-sr-markdown="${escapeHTML(token)}">${preview?.html || escapeHTML(labels || token)}</span>&#8203;`;
  }

  async function insertCitation(choice, preservedSelectionState = null) {
    if (!choice?.keys?.length) {
      return;
    }
    const token = SystematicReviewerNativeMarkdown.makeCitationMarkdown(choice);
    if (state.mode === "raw") {
      insertIntoTextarea(rawEditor, token);
      markDirty();
      return;
    }
    if (state.mode !== "native") {
      setMode("native");
    }
    const selectionState = preservedSelectionState || currentInsertionState();
    await ensureSingleCitationPreview(choice);
    restoreEditorSelectionState(selectionState);
    const editable = selectionState?.editable?.isConnected ? selectionState.editable : activeEditable();
    const range = currentSelectionRange(document);
    const container = range?.commonAncestorContainer?.nodeType === 3
      ? range.commonAncestorContainer.parentNode
      : range?.commonAncestorContainer || null;
    if (editable && (!range || !container || !(editable === container || editable.contains(container)))) {
      focusEditableEnd(editable);
    }
    const html = citationChipHTML(choice);
    insertHTMLIntoActiveEditable(html, () => {
      const body = selectionState?.editable?.closest?.(".sr-page-editor-body") || activePageBody();
      if (body) {
        const paragraphBlock = createParagraphBlockWithHTML(html);
        body.appendChild(paragraphBlock);
        const fallbackEditable = paragraphBlock.querySelector(".sr-block-editable");
        setActiveEditable(fallbackEditable || state.nativeActiveEditable);
        focusEditableEnd(fallbackEditable);
      }
    }, selectionState);
    markNativeEditorDirty();
    state.lastSelectionState = captureEditorSelectionState(activeEditable() || editable || nativeEditor);
    await refreshCitationDependentRendering();
  }

  async function refreshBootstrap(bootstrapPayload = null) {
    const bootstrap = bootstrapPayload || await ctx.invoke("automation.getBootstrap", {});
    const preserveDirtyDocument = hasPendingDocumentChanges();
    const incomingMarkdown = String(bootstrap?.workspace_document?.markdown || "");
    const incomingRenderState = bootstrap?.render_state || null;
    state.bootstrap = bootstrap;
    if (Array.isArray(state.bootstrap?.chat_history_raw) && state.bootstrap.chat_history_raw.length) {
      state.bootstrap.chat_history = state.bootstrap.chat_history_raw;
    }
    state.citationCatalog = Array.isArray(bootstrap?.citation_catalog) ? bootstrap.citation_catalog.slice() : [];
    state.localCommands = Array.isArray(bootstrap?.local_commands) ? bootstrap.local_commands.slice() : [];
    state.baseURL = String(bootstrap?.workspace_document?.base_url || "");
    state.editorSettings = SystematicReviewerNativeMarkdown.normalizeSettings(
      automationEditorSettingsPayload(bootstrap?.current_project?.settings?.editor || {})
    );
    state.settingsRevision += 1;
    populateEditorControls(bootstrap?.editor_meta || {});
    populateSessionControls(Array.isArray(bootstrap?.sessions) ? bootstrap.sessions : [], bootstrap?.current_project?.active_session_id || "");
    updateChatModelControls();
    if (bootstrap?.run) {
      setChatRun(bootstrap.run);
      if (String(bootstrap?.run?.status || "").trim() === "running" && !state.chatStreamAbortController) {
        clearChatPollTimer();
        state.chatPollTimer = window.setTimeout(() => {
          pollChatRun(String(bootstrap?.run?.run_id || bootstrap?.run?.runID || "").trim()).catch((error) =>
            setStatus(error?.message || String(error), "error")
          );
        }, 0);
      }
    }
    else if (!state.chatStreamAbortController) {
      setChatRun(null);
    }
    renderChat(Array.isArray(bootstrap?.chat_history) ? bootstrap.chat_history : []);
    renderChatQueue();
    renderChatBudget();
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
    applySidebarWidth(state.sidebarWidthPx);
    updateDocumentStyles();
    if (!preserveDirtyDocument) {
      state.renderState = incomingRenderState;
      state.lastRenderedReportHash = String(incomingRenderState?.report_hash || state.lastRenderedReportHash || "");
      state.markdown = incomingMarkdown;
      state.markdownRevision += 1;
      state.lastSavedMarkdown = state.markdown;
      rawEditor.value = state.markdown;
      let mountedSurfaces = { preview: false, native: false };
      if (state.renderState) {
        mountedSurfaces = applyRenderState(state.renderState);
      }
      setMode(state.mode);
      clearDirty(state.markdown);
      const signature = currentRenderSignature();
      state.renderedSignature.preview = mountedSurfaces.preview ? signature : "";
      state.renderedSignature.native = mountedSurfaces.native ? signature : "";
    }
    else if (!state.renderState && incomingRenderState) {
      state.renderState = incomingRenderState;
      state.lastRenderedReportHash = String(incomingRenderState?.report_hash || state.lastRenderedReportHash || "");
      if (state.mode !== "raw") {
        let mountedSurfaces = applyRenderState(state.renderState);
        const signature = currentRenderSignature();
        state.renderedSignature.preview = mountedSurfaces.preview ? signature : state.renderedSignature.preview;
        state.renderedSignature.native = mountedSurfaces.native ? signature : state.renderedSignature.native;
      }
    }
    setStatus(bootstrap?.current_project ? "Writer ready." : "Open a collection project first.", bootstrap?.current_project ? "ready" : "");
    updateModeControlAvailability();
    const activeSurface = surfaceForMode(state.mode);
    if (bootstrap?.current_project && activeSurface && !state.renderedSignature[activeSurface]) {
      const runRender = () => {
        if (state.destroyed) {
          return;
        }
        ensureRenderedSurface(activeSurface, state.renderState).catch((error) => setStatus(error?.message || String(error), "error"));
      };
      const schedule = typeof window.requestAnimationFrame == "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0);
      schedule(runRender);
    }
    scheduleSessionContextHydration(bootstrap);
  }

  function applySettingValue(name, value) {
    state.editorSettings = SystematicReviewerNativeMarkdown.normalizeSettings(
      automationEditorSettingsPayload(state.editorSettings, {
        [name]: value,
      })
    );
    state.settingsRevision += 1;
    updateDocumentStyles();
  }

  async function persistEditorSettings() {
    const previousEditorSettings = SystematicReviewerNativeMarkdown.normalizeSettings(
      automationEditorSettingsPayload(state.editorSettings || {})
    );
    const previousCitationStyleID = String(previousEditorSettings.citationStyleID || "").trim();
    const previousCitationLocale = String(previousEditorSettings.citationLocale || "").trim();
    state.editorSettings = SystematicReviewerNativeMarkdown.normalizeSettings(
      automationEditorSettingsPayload(state.editorSettings, {
        fontFamily: fontSelect.value || state.editorSettings.fontFamily,
        fontSizePx: Number(fontSizeSelect.value || state.editorSettings.fontSizePx || 12),
        pageViewScale: Number(pageViewScaleRange.value || 100) / 100,
        citationStyleID: citationStyleSelect.value || state.editorSettings.citationStyleID,
        printMarginInches: Number(marginSelect.value || state.editorSettings.printMarginInches || 1),
        printPageNumbers: pageNumbersSelect.value === "true",
        bulletStyle: bulletStyleSelect.value || state.editorSettings.bulletStyle || "disc",
      })
    );
    state.settingsRevision += 1;
    const requestedSurface = surfaceForMode(state.mode);
    const renderSurface = requestedSurface ? "both" : requestedSurface;
    const result = await ctx.invoke("automation.document.editorSettings.save", {
      editor_settings: automationEditorSettingsPayload(state.editorSettings),
      markdown: currentMarkdown(),
      surface: renderSurface,
    });
    state.editorSettings = SystematicReviewerNativeMarkdown.normalizeSettings(
      automationEditorSettingsPayload(result?.settings || state.editorSettings || {})
    );
    const nextCitationStyleID = String(state.editorSettings.citationStyleID || "").trim();
    const nextCitationLocale = String(state.editorSettings.citationLocale || "").trim();
    if (previousCitationStyleID !== nextCitationStyleID || previousCitationLocale !== nextCitationLocale) {
      state.citationChipLabelCache.clear();
      state.citationChipLabelPromiseCache.clear();
    }
    updateDocumentStyles();
    if (result && typeof result === "object") {
      state.renderState = Object.assign({}, state.renderState || {}, result);
      state.baseURL = String(result?.base_url || state.baseURL || "");
      state.lastRenderedReportHash = String(result?.report_hash || state.lastRenderedReportHash || "");
    }
    state.markdown = Object.prototype.hasOwnProperty.call(result || {}, "markdown")
      ? String(result?.markdown || "")
      : currentMarkdown();
    state.markdownRevision += 1;
    invalidateRenderedSurfaces();
    if (requestedSurface) {
      await ensureRenderedSurface(requestedSurface, result);
    }
  }

  function cloneSelectOptionsInto(target, source) {
    target.replaceChildren();
    Array.from(source?.options || []).forEach((option) => {
      target.appendChild(createOption(option.value, option.textContent || option.label || option.value));
    });
  }

  async function showPropertiesDialog() {
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", { className: "sr-dialog sr-properties-dialog", attrs: { role: "dialog", "aria-modal": "true" } });
    const modalFontSelect = createSelect("sr-editor-select sr-font-select");
    const modalFontSizeSelect = createSelect("sr-editor-size");
    const modalCitationStyleSelect = createSelect("sr-editor-select sr-citation-style-select");
    const modalMarginSelect = createSelect("sr-editor-select");
    const modalPageNumbersSelect = createSelect("sr-editor-select sr-page-number-select");
    const modalBulletStyleSelect = createSelect("sr-editor-select");
    cloneSelectOptionsInto(modalFontSelect, fontSelect);
    cloneSelectOptionsInto(modalFontSizeSelect, fontSizeSelect);
    cloneSelectOptionsInto(modalCitationStyleSelect, citationStyleSelect);
    cloneSelectOptionsInto(modalMarginSelect, marginSelect);
    cloneSelectOptionsInto(modalPageNumbersSelect, pageNumbersSelect);
    cloneSelectOptionsInto(modalBulletStyleSelect, bulletStyleSelect);
    modalFontSelect.value = fontSelect.value;
    modalFontSizeSelect.value = fontSizeSelect.value;
    modalCitationStyleSelect.value = citationStyleSelect.value;
    modalMarginSelect.value = marginSelect.value;
    modalPageNumbersSelect.value = pageNumbersSelect.value;
    modalBulletStyleSelect.value = bulletStyleSelect.value;
    const cancelBtn = createButton("Cancel");
    const savePropertiesBtn = createButton("Save", "sr-workspace-btn sr-workspace-btn-primary");
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", {
      type: "button",
      "aria-label": "Close properties dialog",
    });
    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: "Document properties" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Adjust the Writer document-wide formatting and print settings." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [
          createNode("div", {
            className: "sr-properties-form",
            children: [
              createNode("label", { className: "sr-field-label", textContent: "Font", children: [modalFontSelect] }),
              createNode("label", { className: "sr-field-label", textContent: "Font size", children: [modalFontSizeSelect] }),
              createNode("label", { className: "sr-field-label", textContent: "Citation style", children: [modalCitationStyleSelect] }),
              createNode("label", { className: "sr-field-label", textContent: "Margins", children: [modalMarginSelect] }),
              createNode("label", { className: "sr-field-label", textContent: "Page numbers", children: [modalPageNumbersSelect] }),
              createNode("label", { className: "sr-field-label", textContent: "Bullet style", children: [modalBulletStyleSelect] }),
            ],
          }),
        ],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          createNode("div", { className: "sr-dialog-subtitle", textContent: "These settings affect Editor, Preview, and exports." }),
          createNode("div", { className: "sr-workspace-toolbar", children: [cancelBtn, savePropertiesBtn] }),
        ],
      }),
    );
    const resultPromise = new Promise((resolve) => {
      let settled = false;
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (state.overlay === overlay) {
          state.overlay = null;
        }
        window.removeEventListener("keydown", keyHandler, true);
        overlay.remove();
        resolve(value);
      };
      cancelBtn.addEventListener("click", () => finish(null), { once: true });
      closeBtn.addEventListener("click", () => finish(null), { once: true });
      savePropertiesBtn.addEventListener("click", () => finish({
        fontFamily: modalFontSelect.value || fontSelect.value,
        fontSizePx: Number(modalFontSizeSelect.value || fontSizeSelect.value || 12),
        citationStyleID: modalCitationStyleSelect.value || citationStyleSelect.value,
        printMarginInches: Number(modalMarginSelect.value || marginSelect.value || 1),
        printPageNumbers: modalPageNumbersSelect.value === "true",
        bulletStyle: modalBulletStyleSelect.value || bulletStyleSelect.value || "disc",
      }), { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          finish(null);
        }
      }, { once: true });
      window.addEventListener("keydown", keyHandler, true);
    });
    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    modalFontSelect.focus();
    const next = await resultPromise;
    if (!next) {
      return null;
    }
    fontSelect.value = next.fontFamily;
    fontSizeSelect.value = String(next.fontSizePx);
    citationStyleSelect.value = next.citationStyleID;
    marginSelect.value = String(next.printMarginInches);
    pageNumbersSelect.value = next.printPageNumbers ? "true" : "false";
    bulletStyleSelect.value = next.bulletStyle;
    updateEditorSelectTitles();
    await persistEditorSettings();
    return next;
  }

  async function handleSessionSwitch() {
    await savePendingDocument({ silent: true, surface: "", saveReason: "mode-switch-save" });
    clearChatPollTimer();
    clearChatClockTimer();
    if (state.chatRun?.status === "running") {
      await stopActiveChatRun({ silent: true });
    }
    state.chatStreamAbortController?.abort?.();
    state.chatStreamAbortController = null;
    state.lastCompletedRun = null;
    state.optimisticUserMessage = null;
    clearLiveChatTransientState();
    closeChatPopover();
    setChatRun(null);
    const bootstrap = await ctx.invoke("automation.session.switch", { session_id: sessionSelect.value });
    await refreshBootstrap(bootstrap);
    setStatus("Session switched", "ready");
  }

  host.addEventListener("input", (event) => {
    if (event.target === rawEditor) {
      markDirty();
      return;
    }
    if (nativeEditor.contains(event.target)) {
      const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
      const editable = target?.closest?.("[data-sr-editable='true']") || state.nativeActiveEditable;
      if (editable && editable.tagName?.toLowerCase() !== "textarea") {
        pruneEditableBrowserBreaks(editable);
      }
      autosizeCodeTextarea(isCodeTextarea(editable) ? editable : target?.closest?.("textarea[data-sr-code='true']"));
      setActiveEditable(editable || state.nativeActiveEditable);
      markNativeEditorDirty();
      state.lastSelectionState = captureEditorSelectionState(editable || target);
    }
  });

  nativeEditor.addEventListener("focusin", (event) => {
    clearNativeBlurReflowTimer();
    const editable = event.target?.closest?.("[data-sr-editable='true']");
    if (editable) {
      setActiveEditable(editable);
    }
    rememberLiveEditorSelection(event.target?.nodeType === 3 ? event.target.parentNode : event.target);
  });

  nativeEditor.addEventListener("focusout", () => {
    clearNativeBlurReflowTimer();
    state.nativeBlurReflowTimer = window.setTimeout(() => {
      state.nativeBlurReflowTimer = 0;
      if (state.destroyed || state.mode !== "native" || !state.nativeDirty) {
        return;
      }
      if (state.overlay && !isFindPanelOverlay()) {
        return;
      }
      if (nativeEditor.contains(document.activeElement)) {
        return;
      }
      scheduleSurfaceReflow("native", {
        immediate: true,
        delay: 0,
      });
    }, 120);
  });

  nativeEditor.addEventListener("dblclick", async (event) => {
    const chip = event.target?.closest?.(".sr-citation-chip");
    if (!chip) {
      return;
    }
    await editCitationFromNode(chip);
  });

  nativeEditor.addEventListener("beforeinput", (event) => {
    const inputType = String(event.inputType || "");
    if (inputType !== "insertParagraph" && inputType !== "insertLineBreak") {
      return;
    }
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const editable = target?.closest?.("[data-sr-editable='true']") || state.nativeActiveEditable;
    const pageBody = target?.closest?.(".sr-page-editor-body") || editable?.closest?.(".sr-page-editor-body");
    if (!editable || !pageBody || editable.tagName?.toLowerCase() === "textarea") {
      return;
    }
    const handled = handleNativeEnterKey({
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: inputType === "insertLineBreak" || !!event.shiftKey,
      preventDefault: () => event.preventDefault(),
    }, editable, pageBody);
    if (handled) {
      event.preventDefault();
    }
  }, true);

  nativeEditor.addEventListener("keydown", async (event) => {
    const key = String(event.key || "").toLowerCase();
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const pageBody = target?.closest?.(".sr-page-editor-body");
    const editable = target?.closest?.("[data-sr-editable='true']");
    if (editable) {
      setActiveEditable(editable);
    }
    if (isCitationShortcut(event)) {
      event.preventDefault();
      await handleCitationInsert().catch((error) => setStatus(error?.message || String(error), "error"));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "f") {
      event.preventDefault();
      const selectionState = captureEditorSelectionState(target === pageBody ? state.nativeActiveEditable || target : target);
      await openFindReplaceDialog(selectionState || currentInsertionState()).catch((error) => setStatus(error?.message || String(error), "error"));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      await saveDocument({ silent: false, saveReason: "manual-save" });
      return;
    }
    if (!pageBody) {
      return;
    }
    let selectionState = captureEditorSelectionState(target === pageBody ? state.nativeActiveEditable || target : target);
    if (selectionState?.citationNode) {
      restoreEditorSelectionState(selectionState);
      selectionState = captureEditorSelectionState(selectionState.editable || selectionState.citationNode || target);
    }
    if (handleNativeSelectionDeletionKey(event, selectionState)) {
      return;
    }
    if (handleNativeTabKey(event, editable, selectionState)) {
      return;
    }
    if (event.key === "Enter" && target === pageBody && !selectionState?.range) {
      event.preventDefault();
      const paragraph = ensureTrailingEditableParagraph(pageBody);
      focusEditableEnd(paragraph || pageBody);
      setActiveEditable(paragraph || state.nativeActiveEditable);
      markNativeEditorDirty();
      return;
    }
    if (handleNativeEnterKey(event, editable, pageBody)) {
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && target === pageBody && !selectionState?.range) {
      event.preventDefault();
      const paragraph = ensureTrailingEditableParagraph(pageBody);
      focusEditableEnd(paragraph || pageBody);
      setActiveEditable(paragraph || state.nativeActiveEditable);
      return;
    }
    if (handleNativeDeletionKey(event, editable)) {
      return;
    }
    const backwardDelete = event.key === "Backspace" || isMacBackwardDeleteKey(event);
    if (backwardDelete && editable && !editable.classList?.contains("sr-native-table-cell")) {
      if (deleteBackwardInEditable(editable)) {
        event.preventDefault();
        markNativeEditorDirty();
        state.lastSelectionState = captureEditorSelectionState(editable);
      }
    }
  });

  rawEditor.addEventListener("keydown", async (event) => {
    const key = String(event.key || "").toLowerCase();
    if (isCitationShortcut(event)) {
      event.preventDefault();
      await handleCitationInsert().catch((error) => setStatus(error?.message || String(error), "error"));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "f") {
      event.preventDefault();
      await openFindReplaceDialog(captureRawSelectionState()).catch((error) => setStatus(error?.message || String(error), "error"));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      await saveDocument({ silent: false, saveReason: "manual-save" });
      return;
    }
    if (isMacBackwardDeleteKey(event)) {
      event.preventDefault();
      if (deleteBackwardInTextarea(rawEditor)) {
        markDirty();
      }
    }
  });

  rawEditor.addEventListener("contextmenu", (event) => {
    openRawContextMenu(event).catch((error) => setStatus(error?.message || String(error), "error"));
  });

  nativeEditor.addEventListener("mousedown", (event) => {
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const chip = target?.closest?.(".sr-citation-chip") || null;
    state.pendingCitationCaret = chip
      ? {
          node: chip,
          side: citationSideFromPointerEvent(chip, event),
        }
      : null;
    const editable = target?.closest?.("[data-sr-editable='true']");
    if (editable) {
      setActiveEditable(editable);
    }
    const tableCell = target?.closest?.("td, th");
    if (event.button === 0 && tableCell?.closest?.(".sr-block-table")) {
      beginTableDragSelection(tableCell);
      updateTableSelectionFromInteraction(tableCell, event);
    }
    else {
      endTableDragSelection();
    }
  });

  nativeEditor.addEventListener("mousemove", (event) => {
    if (!(event.buttons & 1) || !state.tableDrag) {
      return;
    }
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const tableCell = target?.closest?.("td, th");
    if (tableCell?.closest?.(".sr-block-table")) {
      updateTableDragSelection(tableCell);
    }
  });

  nativeEditor.addEventListener("mouseup", (event) => {
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    rememberLiveEditorSelection(target);
    endTableDragSelection();
  });

  nativeEditor.addEventListener("keyup", (event) => {
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    rememberLiveEditorSelection(target);
  });

  nativeEditor.addEventListener("copy", async (event) => {
    if (state.mode !== "native") {
      return;
    }
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const selectionState = captureEditorSelectionState(target);
    if (!editorHasSelection(selectionState) && !selectionState.citationNode) {
      return;
    }
    const text = selectionMarkdownFromState(selectionState);
    if (!text) {
      return;
    }
    const html = selectionHTMLFromState(selectionState);
    event.preventDefault();
    let wroteStructuredClipboard = false;
    try {
      event.clipboardData?.setData(AUTOMATION_MARKDOWN_CLIPBOARD_MIME, text);
      event.clipboardData?.setData("text/plain", text);
      if (html) {
        event.clipboardData?.setData("text/html", html);
      }
      wroteStructuredClipboard = true;
    }
    catch (_error) {}
    if (!wroteStructuredClipboard) {
      await writeClipboardText(text);
    }
  });

  nativeEditor.addEventListener("cut", async (event) => {
    if (state.mode !== "native") {
      return;
    }
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const selectionState = captureEditorSelectionState(target);
    if (!editorHasSelection(selectionState) && !selectionState.citationNode) {
      return;
    }
    const text = selectionMarkdownFromState(selectionState);
    const html = selectionHTMLFromState(selectionState);
    if (text) {
      let wroteStructuredClipboard = false;
      try {
        event.clipboardData?.setData(AUTOMATION_MARKDOWN_CLIPBOARD_MIME, text);
        event.clipboardData?.setData("text/plain", text);
        if (html) {
          event.clipboardData?.setData("text/html", html);
        }
        wroteStructuredClipboard = true;
      }
      catch (_error) {}
      if (!wroteStructuredClipboard) {
        await writeClipboardText(text);
      }
    }
    event.preventDefault();
    deleteEditorSelection(selectionState);
    markNativeEditorDirty();
    state.lastSelectionState = captureEditorSelectionState(state.nativeActiveEditable || target);
  });

  nativeEditor.addEventListener("paste", async (event) => {
    if (state.mode !== "native") {
      return;
    }
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const selectionState = captureEditorSelectionState(target);
    let text = "";
    let internalMarkdown = "";
    try {
      internalMarkdown = event.clipboardData?.getData(AUTOMATION_MARKDOWN_CLIPBOARD_MIME) || "";
      text = event.clipboardData?.getData("text/plain") || "";
    }
    catch (_error) {}
    if (!internalMarkdown && !text) {
      text = await readClipboardText();
    }
    if (!internalMarkdown && !text) {
      return;
    }
    event.preventDefault();
    if (internalMarkdown) {
      await insertMarkdownIntoEditor(selectionState, internalMarkdown);
    }
    else if (looksLikeAutomationMarkdown(text)) {
      if (!await insertMarkdownIntoEditor(selectionState, text)) {
        insertPlainTextIntoNativeEditor(selectionState, text);
      }
    }
    else {
      insertPlainTextIntoNativeEditor(selectionState, text);
    }
    state.lastSelectionState = captureEditorSelectionState(state.nativeActiveEditable || target);
  });

  preview.addEventListener("click", (event) => {
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const link = target?.closest?.("a[href^='#']") || null;
    const href = String(link?.getAttribute?.("href") || "").trim();
    if (!link || !href.startsWith("#")) {
      return;
    }
    event.preventDefault();
    navigateToInternalAnchor(preview, href.slice(1));
  });

  nativeEditor.addEventListener("click", (event) => {
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const link = target?.closest?.("a[href^='#']") || null;
    const href = String(link?.getAttribute?.("href") || "").trim();
    if (link && href.startsWith("#")) {
      event.preventDefault();
      event.stopPropagation();
      navigateToInternalAnchor(nativeEditor, href.slice(1));
      return;
    }
    const chip = target?.closest?.(".sr-citation-chip") || null;
    if (chip) {
      const selectionState = captureEditorSelectionState(chip);
      restoreEditorSelectionState(selectionState);
      state.lastSelectionState = captureEditorSelectionState(selectionState.editable || chip);
      return;
    }
    const liveRange = currentSelectionRange(document);
    const liveContainer = liveRange?.commonAncestorContainer?.nodeType === 3
      ? liveRange.commonAncestorContainer.parentNode
      : liveRange?.commonAncestorContainer || null;
    const hasLiveEditorSelection = !!(
      liveRange
      && !liveRange.collapsed
      && liveContainer
      && nativeEditor.contains(liveContainer)
    );
    const tableCell = target?.closest?.("td, th");
    if (hasLiveEditorSelection && !tableCell) {
      state.lastSelectionState = captureEditorSelectionState(state.nativeActiveEditable || target);
      return;
    }
    if (tableCell?.closest?.(".sr-block-table")) {
      if (state.suppressNextTableClick) {
        state.suppressNextTableClick = false;
        state.lastSelectionState = captureEditorSelectionState(target);
        return;
      }
      updateTableSelectionFromInteraction(tableCell, event);
    }
    else if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      state.suppressNextTableClick = false;
      clearTableSelection();
    }
    const pageBody = target?.closest?.(".sr-page-editor-body");
    if (!pageBody) {
      return;
    }
    if (target === pageBody) {
      if (liveRange && !liveRange.collapsed && liveContainer && nativeEditor.contains(liveContainer)) {
        state.lastSelectionState = captureEditorSelectionState(state.nativeActiveEditable || target);
        return;
      }
      const editable = focusNearestEditableForPageClick(pageBody, event);
      setActiveEditable(editable || state.nativeActiveEditable);
    }
    state.lastSelectionState = captureEditorSelectionState(target === pageBody ? state.nativeActiveEditable || target : target);
  });

  nativeEditor.addEventListener("contextmenu", (event) => {
    const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
    const tableCell = target?.closest?.("td, th");
    if (tableCell?.closest?.(".sr-block-table")) {
      const descriptor = tableCellDescriptor(tableCell);
      const table = tableCell.closest("table");
      const current = state.tableSelection;
      if (!(current?.table === table && tableSelectionContains(current.cells, descriptor))) {
        setTableSelection(table, [descriptor], descriptor);
      }
    }
    openEditorContextMenu(event, target).catch((error) => setStatus(error?.message || String(error), "error"));
  });

  const handleWindowMouseUp = () => {
    endTableDragSelection();
  };
  window.addEventListener("mouseup", handleWindowMouseUp, true);
  const handleWindowResize = () => {
    applySidebarWidth(state.sidebarWidthPx);
    if (state.chatPopover?.node && state.chatPopover?.anchor) {
      positionChatPopover(state.chatPopover.node, state.chatPopover.anchor);
    }
    if (state.findPanel?.applyPosition && state.findPanelPosition) {
      state.findPanel.applyPosition(state.findPanelPosition.left, state.findPanelPosition.top);
    }
    scheduleFindPanelRefresh({
      preserveIndex: true,
      delay: 0,
      renderOnly: true,
    });
  };
  window.addEventListener("resize", handleWindowResize, true);
  const handleWindowPointerDown = (event) => {
    const target = event?.target;
    if (!state.chatPopover?.node) {
      return;
    }
    if (state.chatPopover.node.contains(target) || state.chatPopover.anchor?.contains?.(target)) {
      return;
    }
    closeChatPopover();
  };
  window.addEventListener("mousedown", handleWindowPointerDown, true);
  const handleWindowKeyDown = (event) => {
    if (event.key === "Escape") {
      closeChatPopover();
    }
  };
  window.addEventListener("keydown", handleWindowKeyDown, true);
  const handleDocumentSelectionChange = () => {
    if (state.destroyed || state.mode !== "native") {
      return;
    }
    const range = currentSelectionRange(document);
    const container = range?.commonAncestorContainer?.nodeType === 3
      ? range.commonAncestorContainer.parentNode
      : range?.commonAncestorContainer || null;
    if (container && nativeEditor.contains(container)) {
      rememberLiveEditorSelection(container);
    }
  };
  document.addEventListener("selectionchange", handleDocumentSelectionChange, true);

  newSessionBtn.addEventListener("click", async () => {
    await savePendingDocument({ silent: true, surface: "", saveReason: "mode-switch-save" });
    clearChatPollTimer();
    clearChatClockTimer();
    if (state.chatRun?.status === "running") {
      await stopActiveChatRun({ silent: true });
    }
    state.chatStreamAbortController?.abort?.();
    state.chatStreamAbortController = null;
    state.lastCompletedRun = null;
    state.optimisticUserMessage = null;
    clearLiveChatTransientState();
    closeChatPopover();
    setChatRun(null);
    const bootstrap = await ctx.invoke("automation.session.new", {});
    await refreshBootstrap(bootstrap);
    setStatus("New session started", "ready");
  });
  modePreviewBtn.addEventListener("click", () => switchMode("preview").catch((error) => setStatus(error?.message || String(error), "error")));
  modeNativeBtn.addEventListener("click", () => switchMode("native").catch((error) => setStatus(error?.message || String(error), "error")));
  modeRawBtn.addEventListener("click", () => switchMode("raw").catch((error) => setStatus(error?.message || String(error), "error")));
  saveBtn.addEventListener("click", () => saveDocument({ silent: false, saveReason: "manual-save" }).catch((error) => setStatus(error?.message || String(error), "error")));
  async function queueDocumentExport(commandID, tabID, fallbackMessage, extraPayload = {}) {
    await savePendingDocument({ silent: true, surface: "", saveReason: "manual-save" });
    const result = await ctx.invoke(commandID, Object.assign({
      markdown: currentMarkdown(),
      editor_settings: automationEditorSettingsPayload(state.editorSettings),
      detach: true,
    }, extraPayload || {}));
    if (result?.canceled) {
      return;
    }
    if (result?.job_id) {
      await Promise.resolve(ctx.rememberTabJobID?.(result.job_id || "", tabID)).catch(() => {});
    }
    setStatus(result?.message || fallbackMessage, "ready");
  }

  async function showExportDialog() {
    closeOverlay();
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", { className: "sr-dialog sr-export-dialog" });
    const formatSelect = createSelect("sr-editor-select");
    formatSelect.append(
      createOption("pdf", "PDF"),
      createOption("docx", "DOCX"),
      createOption("md", "Plain MD"),
    );
    const citationModeSelect = createSelect("sr-editor-select");
    citationModeSelect.append(
      createOption("linked", "Linked citations"),
      createOption("unlinked", "Unlinked citations"),
    );
    citationModeSelect.value = "linked";
    const citationModeField = createNode("label", {
      className: "sr-field-label",
      textContent: "Citation mode",
      children: [citationModeSelect],
    });
    const citationHelpBtn = createButton("?", "sr-workspace-btn sr-export-help-trigger", {
      type: "button",
      "aria-label": "Citation mode help",
    });
    let helpPopover = null;
    const closeHelpPopover = () => {
      try {
        helpPopover?.remove?.();
      }
      catch (_error) {}
      helpPopover = null;
    };
    const toggleHelpPopover = () => {
      if (helpPopover) {
        closeHelpPopover();
        return;
      }
      helpPopover = createNode("div", {
        className: "sr-chat-inline-popover",
        children: [
          createNode("div", {
            className: "sr-chat-inline-popover-body",
            children: [
              createNode("div", {
                className: "sr-chat-inline-popover-title",
                textContent: "Citation modes",
              }),
              createNode("div", {
                className: "sr-chat-inline-popover-copy",
                textContent: "Linked citations keep Zotero-manageable citations for Word or LibreOffice on the same machine or account. Unlinked citations export final text for sharing, but later citation edits are manual.",
              }),
            ],
          }),
        ],
      });
      overlayHost.appendChild(helpPopover);
      positionChatPopover(helpPopover, citationHelpBtn);
    };
    const citationRow = createNode("div", {
      className: "sr-export-field-row",
      children: [citationModeField, citationHelpBtn],
    });
    const note = createNode("div", {
      className: "sr-export-help-copy",
      textContent: "PDF keeps the current print layout. DOCX preserves structure, sections, and styles in a Word-native file.",
    });
    const exportForm = createNode("div", {
      className: "sr-export-form",
      children: [
        createNode("label", {
          className: "sr-field-label",
          textContent: "Format",
          children: [formatSelect],
        }),
        note,
      ],
    });
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", { type: "button", "aria-label": "Close export dialog" });
    const cancelBtn = createButton("Cancel");
    const submitBtn = createButton("Export", "sr-workspace-btn sr-workspace-btn-primary");
    const syncFields = () => {
      const isDocx = String(formatSelect.value || "pdf") === "docx";
      const citationRowMounted = citationRow.parentNode === exportForm;
      if (isDocx && !citationRowMounted) {
        exportForm.insertBefore(citationRow, note);
      }
      if (!isDocx && citationRowMounted) {
        citationRow.remove();
      }
      if (!isDocx) {
        closeHelpPopover();
      }
    };
    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: "Export report" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Choose the export format and any format-specific options." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [exportForm],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          createNode("div", { className: "sr-dialog-subtitle", textContent: "Exports run in Jobs so you can keep working." }),
          createNode("div", { className: "sr-workspace-toolbar", children: [cancelBtn, submitBtn] }),
        ],
      }),
    );
    syncFields();
    const resultPromise = new Promise((resolve) => {
      let settled = false;
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          resolveDialog(null);
        }
      };
      const resolveDialog = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        closeHelpPopover();
        window.removeEventListener("keydown", keyHandler, true);
        closeOverlay();
        resolve(value);
      };
      cancelBtn.addEventListener("click", () => resolveDialog(null), { once: true });
      closeBtn.addEventListener("click", () => resolveDialog(null), { once: true });
      submitBtn.addEventListener("click", () => resolveDialog({
        format: String(formatSelect.value || "pdf"),
        citationMode: String(citationModeSelect.value || "linked"),
      }), { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          resolveDialog(null);
        }
      }, { once: true });
      formatSelect.addEventListener("change", syncFields);
      citationHelpBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleHelpPopover();
      });
      window.addEventListener("keydown", keyHandler, true);
    });
    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    state.overlay = overlay;
    formatSelect.focus();
    return await resultPromise;
  }

  function rollbackShortHash(value = "") {
    return String(value || "").trim().replace(/^fnv1a:/i, "").slice(0, 8);
  }

  function rollbackReasonLabel(value = "") {
    const normalized = cleanDisplayText(String(value || "").replace(/[-_]+/g, " "), { multiline: false });
    if (!normalized) {
      return "Snapshot";
    }
    return normalized.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function rollbackTimestampLabel(value = "") {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    try {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString([], {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
    }
    catch (_error) {}
    return raw;
  }

  function rollbackSnapshotLabel(snapshot = {}) {
    const stamp = rollbackTimestampLabel(snapshot?.created_at || snapshot?.modified_at || "");
    const reason = rollbackReasonLabel(snapshot?.reason || "");
    if (stamp && reason) {
      return `${stamp} - ${reason}`;
    }
    return stamp || reason || String(snapshot?.snapshot_id || "Rollback snapshot");
  }

  function rollbackSnapshotMeta(snapshot = {}) {
    const bits = [];
    const lines = Number(snapshot?.line_count || 0) || 0;
    if (lines) {
      bits.push(`${lines} ${lines === 1 ? "line" : "lines"}`);
    }
    const hash = rollbackShortHash(snapshot?.content_hash || "");
    if (hash) {
      bits.push(hash);
    }
    const snapshotID = String(snapshot?.snapshot_id || "").trim();
    if (snapshotID) {
      bits.push(snapshotID);
    }
    return bits.join(" | ");
  }

  function rollbackCurrentMeta(snapshot = {}) {
    const bits = [];
    const modified = rollbackTimestampLabel(snapshot?.modified_at || snapshot?.created_at || "");
    if (modified) {
      bits.push(`Saved ${modified}`);
    }
    const lines = Number(snapshot?.line_count || 0) || 0;
    if (lines) {
      bits.push(`${lines} ${lines === 1 ? "line" : "lines"}`);
    }
    const hash = rollbackShortHash(snapshot?.content_hash || "");
    if (hash) {
      bits.push(hash);
    }
    return bits.join(" | ");
  }

  function rollbackSummaryText(summary = {}) {
    const added = Number(summary?.added_lines || 0) || 0;
    const removed = Number(summary?.removed_lines || 0) || 0;
    const changed = Number(summary?.changed_lines || 0) || 0;
    const rows = Number(summary?.total_rows || 0) || 0;
    return `${added} added | ${removed} removed | ${changed} changed | ${rows} rows`;
  }

  function fillRollbackCodeCell(cell, side = {}) {
    cell.replaceChildren();
    const segments = Array.isArray(side?.segments) && side.segments.length
      ? side.segments
      : (String(side?.text || "")
        ? [{ kind: "equal", text: String(side.text || "") }]
        : []);
    for (const segment of segments) {
      const text = String(segment?.text || "");
      if (!text) {
        continue;
      }
      const kind = String(segment?.kind || "equal").trim() || "equal";
      if (kind === "added" || kind === "removed") {
        cell.appendChild(createNode("span", {
          className: `sr-rollback-segment is-${kind}`,
          textContent: text,
        }));
      }
      else {
        cell.appendChild(document.createTextNode(text));
      }
    }
  }

  function createRollbackRow(row = {}) {
    const type = String(row?.type || "equal").trim() || "equal";
    const left = row?.left && typeof row.left === "object" ? row.left : {};
    const right = row?.right && typeof row.right === "object" ? row.right : {};
    const leftCode = createNode("div", { className: "sr-rollback-code sr-rollback-code-left" });
    const rightCode = createNode("div", { className: "sr-rollback-code sr-rollback-code-right" });
    fillRollbackCodeCell(leftCode, left);
    fillRollbackCodeCell(rightCode, right);
    return createNode("div", {
      className: `sr-rollback-row is-${type}`,
      children: [
        createNode("div", {
          className: "sr-rollback-line-number sr-rollback-line-number-left",
          textContent: Number.isInteger(left?.line_number) ? String(left.line_number) : "",
        }),
        leftCode,
        createNode("div", {
          className: "sr-rollback-line-number sr-rollback-line-number-right",
          textContent: Number.isInteger(right?.line_number) ? String(right.line_number) : "",
        }),
        rightCode,
      ],
    });
  }

  async function showLogDialog() {
    const result = await ctx.invoke("automation.document.log.read", {});
    closeOverlay();
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", {
      className: "sr-dialog sr-log-dialog",
      attrs: { role: "dialog", "aria-modal": "true" },
    });
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", {
      type: "button",
      "aria-label": "Close workflow log",
    });
    const dismissBtn = createButton("Close");
    const pathCopy = createNode("div", {
      className: "sr-dialog-subtitle",
      textContent: String(result?.path || "log.txt"),
    });
    const footerCopy = createNode("div", {
      className: "sr-dialog-subtitle",
      textContent: `${Number(result?.headings?.length || 0) || 0} heading${Number(result?.headings?.length || 0) === 1 ? "" : "s"} loaded from log.txt.`,
    });
    const surface = createNode("div", { className: "sr-log-surface" });
    const markdown = String(result?.markdown || "");
    if (markdown.trim()) {
      surface.appendChild(renderExploreMarkdown(markdown, {
        citations: Array.isArray(result?.citations) ? result.citations : [],
      }, {
        showRawCitationTokens: true,
      }));
    }
    else {
      surface.appendChild(createNode("div", {
        className: "sr-log-empty",
        textContent: "No workflow log entries yet.",
      }));
    }

    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: "Workflow log" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Deterministic workflow summaries now append to log.txt instead of REPORT.md." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [
          pathCopy,
          surface,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          footerCopy,
          createNode("div", { className: "sr-workspace-toolbar", children: [dismissBtn] }),
        ],
      }),
    );

    return await new Promise((resolve) => {
      let settled = false;
      const resolveDialog = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("keydown", keyHandler, true);
        closeOverlay();
        resolve(value);
      };
      const keyHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          resolveDialog(null);
        }
      };
      closeBtn.addEventListener("click", () => resolveDialog(null), { once: true });
      dismissBtn.addEventListener("click", () => resolveDialog(null), { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          resolveDialog(null);
        }
      });
      window.addEventListener("keydown", keyHandler, true);
      overlay.appendChild(dialog);
      overlayHost.appendChild(overlay);
      state.overlay = overlay;
      closeBtn.focus();
    });
	  }

	  async function showMemoryDialog() {
	    const result = await ctx.invoke("automation.document.memory.read", {});
	    closeOverlay();
	    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
	    const dialog = createNode("div", {
	      className: "sr-dialog sr-log-dialog sr-memory-dialog",
	      attrs: { role: "dialog", "aria-modal": "true" },
	    });
	    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", {
	      type: "button",
	      "aria-label": "Close memory",
	    });
	    const dismissBtn = createButton("Close");
	    const pathCopy = createNode("div", { className: "sr-dialog-subtitle" });
	    const footerCopy = createNode("div", { className: "sr-dialog-subtitle" });
	    const surface = createNode("div", { className: "sr-log-surface" });
	    const activeTabBtn = createButton("Active memory", "sr-workspace-btn sr-memory-tab active", {
	      type: "button",
	      "aria-selected": "true",
	    });
	    const fullTabBtn = createButton("Full memory", "sr-workspace-btn sr-memory-tab", {
	      type: "button",
	      "aria-selected": "false",
	    });
	    const tabs = createNode("div", {
	      className: "sr-memory-tabs",
	      attrs: { role: "tablist", "aria-label": "Memory file" },
	      children: [activeTabBtn, fullTabBtn],
	    });
	    let memoryResult = result || {};
	    const files = {
	      active: {
	        button: activeTabBtn,
	        file: memoryResult?.active || {},
	        label: "active-memory.txt",
	        empty: "No active memory has been compacted yet.",
	      },
	      full: {
	        button: fullTabBtn,
	        file: memoryResult?.full || {},
	        label: "memory.txt",
	        empty: "No chronological turn memory entries yet.",
	      },
	    };
	    let activeMemoryTab = "active";
	    const renderMemoryTab = (key = "active") => {
	      activeMemoryTab = key;
	      let selected = files[key] || files.active;
	      for (let [tabKey, tab] of Object.entries(files)) {
	        let active = tabKey == key;
	        tab.button.classList.toggle("active", active);
	        tab.button.setAttribute("aria-selected", active ? "true" : "false");
	      }
	      let file = selected.file || {};
		      let markdown = String(file.markdown || "");
		      let headings = Number(file?.headings?.length || 0) || 0;
		      pathCopy.textContent = String(file.path || selected.label);
		      let footerText = `${headings} heading${headings === 1 ? "" : "s"} loaded from ${selected.label}; ${Number(file.size || markdown.length || 0) || 0} characters.`;
		      if (key === "active" && memoryResult?.active_memory_rebuild?.ok === false) {
		        footerText += ` Automatic rebuild failed: ${String(memoryResult.active_memory_rebuild.error || "unknown error")}`;
		      }
		      else if (key === "active" && memoryResult?.active_memory_rebuild?.ok === true) {
		        footerText += " Active memory was rebuilt automatically.";
		      }
		      footerCopy.textContent = footerText;
	      surface.replaceChildren();
	      if (markdown.trim()) {
	        surface.appendChild(renderExploreMarkdown(markdown, {
	          citations: [],
	        }, {
	          showRawCitationTokens: true,
	        }));
	      }
	      else {
	        surface.appendChild(createNode("div", {
	          className: "sr-log-empty",
	          textContent: selected.empty,
	        }));
	      }
	    };
	    activeTabBtn.addEventListener("click", () => renderMemoryTab("active"));
	    fullTabBtn.addEventListener("click", () => renderMemoryTab("full"));
	    renderMemoryTab("active");

	    dialog.append(
	      createNode("div", {
	        className: "sr-dialog-header",
	        children: [
	          createNode("div", {
	            className: "sr-dialog-heading",
	            children: [
	              createNode("div", { className: "sr-dialog-title", textContent: "Memory" }),
	              createNode("div", { className: "sr-dialog-subtitle", textContent: "Inspect active-memory.txt and the full chronological memory.txt." }),
	            ],
	          }),
	          closeBtn,
	        ],
	      }),
	      createNode("div", {
	        className: "sr-dialog-body",
	        children: [
	          pathCopy,
	          tabs,
	          surface,
	        ],
	      }),
	      createNode("div", {
	        className: "sr-dialog-footer",
	        children: [
	          footerCopy,
	          createNode("div", { className: "sr-workspace-toolbar", children: [dismissBtn] }),
	        ],
	      }),
	    );

	    return await new Promise((resolve) => {
	      let settled = false;
	      const resolveDialog = (value) => {
	        if (settled) {
	          return;
	        }
	        settled = true;
	        window.removeEventListener("keydown", keyHandler, true);
	        closeOverlay();
	        resolve(value);
	      };
	      const keyHandler = (event) => {
	        if (event.key === "Escape") {
	          event.preventDefault();
	          resolveDialog(null);
	        }
	      };
	      closeBtn.addEventListener("click", () => resolveDialog(null), { once: true });
	      dismissBtn.addEventListener("click", () => resolveDialog(null), { once: true });
	      overlay.addEventListener("click", (event) => {
	        if (event.target === overlay) {
	          resolveDialog(null);
	        }
	      });
	      window.addEventListener("keydown", keyHandler, true);
	      overlay.appendChild(dialog);
	      overlayHost.appendChild(overlay);
	      state.overlay = overlay;
	      closeBtn.focus();
	    });
	  }

	  async function showRollbackDialog() {
	    await savePendingDocument({
	      silent: true,
      saveReason: "manual-save",
    });
    const listResult = await ctx.invoke("automation.document.rollback.list", {});
    const snapshots = Array.isArray(listResult?.snapshots) ? listResult.snapshots.slice() : [];
    closeOverlay();
    const overlay = createNode("div", { className: "sr-dialog-backdrop" });
    const dialog = createNode("div", {
      className: "sr-dialog sr-rollback-dialog",
      attrs: { role: "dialog", "aria-modal": "true" },
    });
    const snapshotSelect = createSelect("sr-editor-select");
    snapshotSelect.setAttribute("aria-label", "Rollback snapshot");
    const statusCopy = createNode("div", { className: "sr-rollback-current-meta" });
    const diffRows = createNode("div", { className: "sr-rollback-rows" });
    const diffScroll = createNode("div", {
      className: "sr-rollback-diff-scroll",
      attrs: { hidden: "hidden" },
      children: [diffRows],
    });
    const noteCopy = createNode("div", {
      className: "sr-rollback-note",
      attrs: { hidden: "hidden" },
    });
    const footerCopy = createNode("div", {
      className: "sr-dialog-subtitle",
      textContent: "Compare the current saved report against one older rollback snapshot.",
    });
    const closeBtn = createButton("X", "sr-workspace-btn sr-dialog-close", {
      type: "button",
      "aria-label": "Close rollback dialog",
    });
    const cancelBtn = createButton("Close");
    const restoreBtn = createButton("Restore This Version", "sr-workspace-btn sr-workspace-btn-primary");
    let settled = false;
    let loading = false;
    let restoring = false;
    let loadToken = 0;
    let activeDiff = null;
    let confirmLayer = null;
    let confirmCleanup = null;

    const renderGrid = (rows = []) => {
      const children = [
        createNode("div", {
          className: "sr-rollback-grid-head",
          children: [
            createNode("div", { textContent: "#" }),
            createNode("div", { textContent: "Rollback snapshot" }),
            createNode("div", { textContent: "#" }),
            createNode("div", { textContent: "Current REPORT.md" }),
          ],
        }),
      ];
      for (const row of Array.isArray(rows) ? rows : []) {
        children.push(createRollbackRow(row));
      }
      diffRows.replaceChildren(...children);
    };

    const syncButtons = () => {
      const disabled = restoring;
      closeBtn.disabled = disabled;
      cancelBtn.disabled = disabled;
      snapshotSelect.disabled = disabled || loading || !snapshots.length;
      restoreBtn.disabled = disabled || loading || !activeDiff?.snapshot?.snapshot_id;
    };

    const renderEmpty = (message) => {
      diffScroll.hidden = true;
      noteCopy.hidden = false;
      noteCopy.textContent = message;
      activeDiff = null;
      footerCopy.textContent = snapshots.length
        ? "Choose a rollback snapshot to compare with the current saved report."
        : "No older rollbacks are available yet. Save more report revisions and they will appear here.";
      syncButtons();
    };

    const renderDiff = (result = {}) => {
      activeDiff = result && typeof result === "object" ? result : null;
      diffScroll.hidden = false;
      noteCopy.hidden = true;
      noteCopy.textContent = "";
      const currentMeta = rollbackCurrentMeta(activeDiff?.current || {});
      statusCopy.textContent = currentMeta ? `Current report: ${currentMeta}` : "Current report";
      footerCopy.textContent = rollbackSummaryText(activeDiff?.summary || {});
      renderGrid(activeDiff?.rows || []);
      syncButtons();
    };

    const loadDiff = async (snapshotID = "") => {
      const requestedID = String(snapshotID || "").trim();
      if (!requestedID) {
        renderEmpty("Choose a rollback snapshot to compare.");
        return;
      }
      const token = ++loadToken;
      loading = true;
      statusCopy.textContent = "Loading rollback diff...";
      noteCopy.hidden = false;
      noteCopy.textContent = "Loading rollback diff...";
      footerCopy.textContent = activeDiff
        ? rollbackSummaryText(activeDiff?.summary || {})
        : "Preparing raw markdown comparison...";
      syncButtons();
      if (!activeDiff) {
        diffScroll.hidden = true;
      }
      try {
        const result = await ctx.invoke("automation.document.rollback.diff", {
          snapshot_id: requestedID,
        });
        if (token !== loadToken || settled) {
          return;
        }
        loading = false;
        renderDiff(result || {});
      }
      catch (error) {
        if (token !== loadToken || settled) {
          return;
        }
        loading = false;
        statusCopy.textContent = error?.message || String(error);
        footerCopy.textContent = "Rollback diff failed.";
        if (activeDiff) {
          noteCopy.hidden = false;
          noteCopy.textContent = error?.message || String(error);
          syncButtons();
        }
        else {
          renderEmpty(error?.message || String(error));
        }
      }
    };

    const showRestoreConfirmation = async (snapshot = {}) => {
      if (typeof confirmCleanup === "function") {
        confirmCleanup();
      }
      if (confirmLayer) {
        try {
          confirmLayer.remove();
        }
        catch (_error) {}
        confirmLayer = null;
      }
      return await new Promise((resolve) => {
        let finished = false;
        const layer = createNode("div", { className: "sr-rollback-confirm-layer" });
        const confirmDialog = createNode("div", {
          className: "sr-dialog sr-rollback-confirm",
          attrs: { role: "alertdialog", "aria-modal": "true" },
        });
        const keepBtn = createButton("Cancel");
        const confirmBtn = createButton("Restore", "sr-workspace-btn sr-workspace-btn-primary");
        const keyHandler = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        };
        const finish = (value) => {
          if (finished) {
            return;
          }
          finished = true;
          confirmCleanup = null;
          window.removeEventListener("keydown", keyHandler, true);
          try {
            layer.remove();
          }
          catch (_error) {}
          if (confirmLayer === layer) {
            confirmLayer = null;
          }
          resolve(value);
        };
        confirmDialog.append(
          createNode("div", {
            className: "sr-dialog-header",
            children: [
              createNode("div", {
                className: "sr-dialog-heading",
                children: [
                  createNode("div", { className: "sr-dialog-title", textContent: "Restore rollback?" }),
                  createNode("div", { className: "sr-dialog-subtitle", textContent: rollbackSnapshotLabel(snapshot) }),
                ],
              }),
            ],
          }),
          createNode("div", {
            className: "sr-dialog-body",
            children: [
              createNode("div", {
                textContent: "This will replace the current saved REPORT.md with the selected rollback snapshot.",
              }),
              createNode("div", {
                className: "sr-dialog-subtitle",
                textContent: "Before overwrite, the current report will be written to rollback history when needed so it can be restored too.",
              }),
            ],
          }),
          createNode("div", {
            className: "sr-dialog-footer",
            children: [
              createNode("div", { className: "sr-dialog-subtitle", textContent: rollbackSnapshotMeta(snapshot) }),
              createNode("div", { className: "sr-workspace-toolbar", children: [keepBtn, confirmBtn] }),
            ],
          }),
        );
        keepBtn.addEventListener("click", () => finish(false), { once: true });
        confirmBtn.addEventListener("click", () => finish(true), { once: true });
        layer.addEventListener("click", (event) => {
          if (event.target === layer) {
            finish(false);
          }
        }, { once: true });
        window.addEventListener("keydown", keyHandler, true);
        confirmCleanup = () => {
          if (!finished) {
            finish(false);
          }
        };
        layer.appendChild(confirmDialog);
        overlay.appendChild(layer);
        confirmLayer = layer;
        confirmBtn.focus();
      });
    };

    dialog.append(
      createNode("div", {
        className: "sr-dialog-header",
        children: [
          createNode("div", {
            className: "sr-dialog-heading",
            children: [
              createNode("div", { className: "sr-dialog-title", textContent: "Rollback report" }),
              createNode("div", { className: "sr-dialog-subtitle", textContent: "Compare the current saved REPORT.md against one older snapshot and restore when needed." }),
            ],
          }),
          closeBtn,
        ],
      }),
      createNode("div", {
        className: "sr-dialog-body",
        children: [
          createNode("div", {
            className: "sr-rollback-controls",
            children: [
              createNode("label", {
                className: "sr-field-label",
                children: [
                  createNode("span", { textContent: "Compare against" }),
                  snapshotSelect,
                ],
              }),
              statusCopy,
            ],
          }),
          noteCopy,
          createNode("div", {
            className: "sr-rollback-surface",
            children: [diffScroll],
          }),
        ],
      }),
      createNode("div", {
        className: "sr-dialog-footer",
        children: [
          footerCopy,
          createNode("div", { className: "sr-workspace-toolbar", children: [cancelBtn, restoreBtn] }),
        ],
      }),
    );

    const resultPromise = new Promise((resolve) => {
      const keyHandler = (event) => {
        if (event.key === "Escape" && !confirmLayer && !restoring) {
          event.preventDefault();
          resolveDialog(null);
        }
      };
      const resolveDialog = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("keydown", keyHandler, true);
        closeOverlay();
        resolve(value);
      };
      closeBtn.addEventListener("click", () => {
        if (!restoring) {
          resolveDialog(null);
        }
      }, { once: true });
      cancelBtn.addEventListener("click", () => {
        if (!restoring) {
          resolveDialog(null);
        }
      }, { once: true });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay && !confirmLayer && !restoring) {
          resolveDialog(null);
        }
      });
      snapshotSelect.addEventListener("change", () => {
        loadDiff(snapshotSelect.value).catch((error) => {
          statusCopy.textContent = error?.message || String(error);
          footerCopy.textContent = "Rollback diff failed.";
          renderEmpty(error?.message || String(error));
        });
      });
      restoreBtn.addEventListener("click", async () => {
        if (!activeDiff?.snapshot?.snapshot_id || restoring) {
          return;
        }
        const confirmed = await showRestoreConfirmation(activeDiff.snapshot);
        if (!confirmed) {
          return;
        }
        restoring = true;
        statusCopy.textContent = "Restoring rollback snapshot...";
        footerCopy.textContent = "Saving the overwritten report into rollback history if needed.";
        syncButtons();
        try {
          const restored = await ctx.invoke("automation.document.rollback.restore", {
            snapshot_id: activeDiff.snapshot.snapshot_id,
          });
          let refreshError = null;
          await refreshBootstrap().catch((error) => {
            refreshError = error;
          });
          if (refreshError) {
            setStatus(`REPORT.md restored from ${rollbackSnapshotLabel(restored?.snapshot || activeDiff.snapshot)}, but the tab did not refresh automatically.`, "error");
          }
          else {
            setStatus(`REPORT.md restored from ${rollbackSnapshotLabel(restored?.snapshot || activeDiff.snapshot)}.`, "ready");
          }
          resolveDialog(restored || null);
        }
        catch (error) {
          restoring = false;
          statusCopy.textContent = error?.message || String(error);
          footerCopy.textContent = "Restore failed.";
          syncButtons();
          setStatus(error?.message || String(error), "error");
        }
      });
      window.addEventListener("keydown", keyHandler, true);
    });

    snapshotSelect.replaceChildren();
    if (snapshots.length) {
      for (const snapshot of snapshots) {
        snapshotSelect.appendChild(createOption(
          String(snapshot?.snapshot_id || ""),
          rollbackSnapshotLabel(snapshot)
        ));
      }
      snapshotSelect.value = String(snapshots[0]?.snapshot_id || "");
      statusCopy.textContent = `Loaded ${snapshots.length} rollback snapshot${snapshots.length === 1 ? "" : "s"}.`;
    }
    else {
      snapshotSelect.appendChild(createOption("", "No older rollbacks available"));
      statusCopy.textContent = "No older rollbacks are available yet.";
    }
    overlay.appendChild(dialog);
    overlayHost.appendChild(overlay);
    overlay.__srCleanup = () => {
      if (typeof confirmCleanup === "function") {
        confirmCleanup();
      }
    };
    state.overlay = overlay;
    syncButtons();
    if (snapshots.length) {
      await loadDiff(snapshotSelect.value);
      snapshotSelect.focus();
    }
    else {
      renderEmpty("No older rollbacks are available yet. Save more report revisions and they will appear here.");
      closeBtn.focus();
    }
    return await resultPromise;
  }

  exportBtn.addEventListener("click", () => {
    showExportDialog()
      .then((selection) => {
        if (!selection) {
          return null;
        }
        const format = String(selection.format || "pdf");
        const citationMode = String(selection.citationMode || "linked");
        const commandID = format === "docx"
          ? "automation.document.exportDocx.saveAs"
          : (format === "md"
            ? "automation.document.exportPlainMarkdown.saveAs"
            : "automation.document.exportPdf.saveAs");
        const fallbackMessage =
          format === "docx"
            ? `DOCX export queued (${citationMode === "linked" ? "linked" : "unlinked"} citations). Track progress in Jobs.`
            : (format === "md"
              ? "Markdown export queued. Track progress in Jobs."
              : "PDF export queued. Track progress in Jobs.");
        return queueDocumentExport(
          commandID,
          "automation",
          fallbackMessage,
          format === "docx"
            ? { format, citation_mode: citationMode }
            : { format }
        );
      })
      .catch((error) => setStatus(error?.message || String(error), "error"));
  });

	  logBtn.addEventListener("click", () => {
	    showLogDialog().catch((error) => setStatus(error?.message || String(error), "error"));
	  });

	  memoryBtn.addEventListener("click", () => {
	    showMemoryDialog().catch((error) => setStatus(error?.message || String(error), "error"));
	  });

	  rollbackBtn.addEventListener("click", () => {
	    showRollbackDialog().catch((error) => setStatus(error?.message || String(error), "error"));
	  });

  propertiesBtn.addEventListener("click", () => {
    showPropertiesDialog().catch((error) => setStatus(error?.message || String(error), "error"));
  });

  headingSelect.addEventListener("change", () => {
    const level = Number(headingSelect.value || 0);
    headingSelect.value = "";
    if (level > 0) {
      applyHeadingToActiveBlock(level);
    }
  });

  formatSelect.addEventListener("change", () => {
    const command = optionalString(formatSelect.value).toLowerCase();
    formatSelect.value = "";
    if (!command) {
      return;
    }
    nativeExecCommand(command);
  });

  toolbarLinkBtn.addEventListener("click", () => insertLinkFromDialog().catch((error) => setStatus(error?.message || String(error), "error")));

  toolbarBulletBtn.addEventListener("click", () => insertListBlock(false));
  toolbarNumberBtn.addEventListener("click", () => insertListBlock(true));
  toolbarTableBtn.addEventListener("click", () => insertTableBlock());
  toolbarPageBreakBtn.addEventListener("click", () => insertPageBreakBlock());
  toolbarTOCBtn.addEventListener("click", () => insertTOCPlaceholder().catch((error) => setStatus(error?.message || String(error), "error")));
  toolbarPrismaBtn.addEventListener("click", () => insertPrismaPlaceholder().catch((error) => setStatus(error?.message || String(error), "error")));
  layoutSelect.addEventListener("change", () => {
    const layout = optionalString(layoutSelect.value).toLowerCase();
    layoutSelect.value = "";
    if (!layout) {
      return;
    }
    insertPageLayoutBlock(layout);
  });
  toolbarImageBtn.addEventListener("click", () => insertImageBlock().catch((error) => setStatus(error?.message || String(error), "error")));

  async function handleCitationInsert(existingCitation = null, preservedSelectionState = null) {
    const insertionState = preservedSelectionState || rememberDocumentInsertionState();
    const choice = await openCitationDialog(existingCitation);
    if (choice?.keys?.length) {
      await insertCitation(choice, insertionState);
    }
  }
  toolbarCiteBtn.addEventListener("pointerdown", () => {
    rememberDocumentInsertionState();
  }, true);
  toolbarCiteBtn.addEventListener("mousedown", (event) => {
    rememberDocumentInsertionState();
    event.preventDefault();
  }, true);
  toolbarCiteBtn.addEventListener("click", () => handleCitationInsert().catch((error) => setStatus(error?.message || String(error), "error")));
  toolbarBibliographyBtn.addEventListener("click", () => insertBibliographyPlaceholder().catch((error) => setStatus(error?.message || String(error), "error")));

  fontSelect.addEventListener("change", () => {
    updateEditorSelectTitles();
    persistEditorSettings().catch((error) => setStatus(error?.message || String(error), "error"));
  });
  fontSizeSelect.addEventListener("change", () => persistEditorSettings().catch((error) => setStatus(error?.message || String(error), "error")));
  citationStyleSelect.addEventListener("change", () => {
    updateEditorSelectTitles();
    persistEditorSettings().catch((error) => setStatus(error?.message || String(error), "error"));
  });
  marginSelect.addEventListener("change", () => persistEditorSettings().catch((error) => setStatus(error?.message || String(error), "error")));
  pageNumbersSelect.addEventListener("change", () => persistEditorSettings().catch((error) => setStatus(error?.message || String(error), "error")));
  pageViewScaleRange.addEventListener("input", () => {
    pageViewScaleValue.textContent = `${pageViewScaleRange.value}%`;
    setZoomSliderPercent(pageViewScaleRange.value);
    applySettingValue("pageViewScale", Number(pageViewScaleRange.value || 100) / 100);
  });
  pageViewScaleRange.addEventListener("change", () => persistEditorSettings().catch((error) => setStatus(error?.message || String(error), "error")));

  sessionSelect.addEventListener("change", () => {
    updateSessionSelectTitle();
    state.chatExploreScopes = [];
    state.chatExploreSelectedScopeKey = "";
    state.chatExploreScopeOptionsSignature = "";
    state.chatExploreHasUserSelectedScope = false;
    state.chatExploreScopeError = "";
    state.chatExploreConfirming = false;
    state.chatFindScopes = [];
    state.chatFindSelectedScopeKey = "";
    state.chatFindScopeOptionsSignature = "";
    state.chatFindHasUserSelectedScope = false;
    state.chatFindScopeError = "";
    state.chatFindConfig = null;
    state.chatFindConfigError = "";
    state.chatAutodriveDefaults = null;
    state.chatAutodriveDefaultsError = "";
    state.chatAutodrivePromptTouched = false;
    state.chatAutodriveReviewerPromptTouched = false;
    state.chatAutodrivePromptTab = "agent";
    chatAutodrivePrompt.value = "";
    chatAutodriveReviewerPrompt.value = "";
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
    handleSessionSwitch().catch((error) => setStatus(error?.message || String(error), "error"));
  });
  chatModelBtn.addEventListener("click", () => {
    openChatModelPopover();
  });
  chatModelSelect.addEventListener("change", async () => {
    try {
      const presetID = String(chatModelSelect.value || "default").trim() || "default";
      const result = await ctx.invoke("automation.chat.runtime.set", {
        session_id: sessionSelect.value,
        preset_id: presetID,
      });
      if (state.bootstrap?.current_project) {
        state.bootstrap.current_project.session_runtime_state = result?.runtime_state || state.bootstrap.current_project.session_runtime_state;
      }
      if (result?.runtime_options) {
        state.bootstrap = {
          ...(state.bootstrap || {}),
          runtime_options: result.runtime_options,
        };
      }
      await refreshBootstrap();
      updateChatModelControls();
      if (state.chatPopover?.kind === "model") {
        syncChatModelPopoverFields();
        positionChatPopover(state.chatPopover.node, chatModelBtn);
      }
      setStatus("Chat model updated.", "ready");
    }
    catch (error) {
      setStatus(error?.message || String(error), "error");
      updateChatModelControls();
    }
  });
  chatOpenCodeModelSelect.addEventListener("change", async () => {
    try {
      const presetID = String(chatModelSelect.value || chatRuntimeState()?.chat_preset_id || "default").trim() || "default";
      const result = await ctx.invoke("automation.chat.runtime.set", {
        session_id: sessionSelect.value,
        preset_id: presetID,
        model: String(chatOpenCodeModelSelect.value || "").trim(),
      });
      if (state.bootstrap?.current_project) {
        state.bootstrap.current_project.session_runtime_state = result?.runtime_state || state.bootstrap.current_project.session_runtime_state;
      }
      if (result?.runtime_options) {
        state.bootstrap = {
          ...(state.bootstrap || {}),
          runtime_options: result.runtime_options,
        };
      }
      await refreshBootstrap();
      updateChatModelControls();
      if (state.chatPopover?.kind === "model") {
        syncChatModelPopoverFields();
        positionChatPopover(state.chatPopover.node, chatModelBtn);
      }
      setStatus(String(chatOpenCodeModelSelect.value || "").trim()
        ? "OpenCode model override updated."
        : "OpenCode model override reset.", "ready");
    }
    catch (error) {
      updateChatModelControls();
      setStatus(error?.message || String(error), "error");
    }
  });
  async function applyChatReasoningOverride(nextValue = "") {
    const result = await ctx.invoke("automation.chat.runtime.set", {
      session_id: sessionSelect.value,
      preset_id: String(chatModelSelect.value || chatRuntimeState()?.chat_preset_id || "default").trim() || "default",
      reasoning_effort: normalizeReasoningEffortToken(nextValue),
    });
    if (state.bootstrap?.current_project) {
      state.bootstrap.current_project.session_runtime_state = result?.runtime_state || state.bootstrap.current_project.session_runtime_state;
    }
    if (result?.runtime_options) {
      state.bootstrap = {
        ...(state.bootstrap || {}),
        runtime_options: result.runtime_options,
      };
    }
    updateChatModelControls();
  }
  chatReasoningSelect.addEventListener("change", async () => {
    try {
      if (String(chatReasoningSelect.value || "") === "__custom__") {
        const nextCustomValue = reasoningSelectValue(selectedChatReasoningEffort()) === "__custom__"
          ? selectedChatReasoningEffort()
          : "";
        chatReasoningCustomInput.hidden = false;
        chatReasoningCustomInput.disabled = false;
        chatReasoningCustomInput.value = nextCustomValue;
        syncChatModelPopoverFields();
        chatReasoningCustomInput.focus();
        chatReasoningCustomInput.select();
        setStatus("Enter a custom reasoning token for this chat session.", "ready");
        return;
      }
      await applyChatReasoningOverride(chatReasoningSelect.value);
      setStatus(String(chatReasoningSelect.value || "").trim()
        ? "Reasoning effort updated."
        : "Reasoning effort reset to default.", "ready");
    }
    catch (error) {
      updateChatModelControls();
      setStatus(error?.message || String(error), "error");
    }
  });
  chatReasoningCustomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      chatReasoningCustomInput.blur();
    }
  });
  chatReasoningCustomInput.addEventListener("change", async () => {
    try {
      await applyChatReasoningOverride(chatReasoningCustomInput.value);
      setStatus(normalizeReasoningEffortToken(chatReasoningCustomInput.value)
        ? "Reasoning effort updated."
        : "Reasoning effort reset to default.", "ready");
    }
    catch (error) {
      updateChatModelControls();
      setStatus(error?.message || String(error), "error");
    }
  });
  stopBtn.addEventListener("click", () => {
    stopActiveChatRun().catch((error) => setStatus(error?.message || String(error), "error"));
  });

  chatForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = optionalString(chatInput.value);
    if (!message) {
      return;
    }
	  if (automationPromptIsFindDraft(message)) {
	      await runAutomationFindPrompt();
	      return;
	    }
    if (automationPromptIsAutodriveDraft(message)) {
      await startAutomationAutodrivePrompt();
      return;
    }
	    if (automationPromptIsExploreDraft(message) || automationPromptHasExplorePlaceholders(message)) {
	      closeCommandMenu();
	      if (!automationPromptHasExplorePlaceholders(message)) {
	        state.chatExploreConfirming = false;
	        state.chatExploreScopeError = "Add one or more Explore columns with @{column_key}.";
	        renderChatExploreComposer();
	        return;
	      }
	      state.chatExploreConfirming = true;
	      state.chatExploreScopeError = "";
      renderChatExploreComposer();
      if (!state.chatExploreScopes.length && !state.chatExploreScopesPromise) {
        void ensureAutomationExploreScopes().catch(() => {});
      }
      return;
    }
    await submitAutomationChatMessage(message, null);
  });
  chatInput.addEventListener("keydown", (event) => {
    if (state.commandMenu.open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const total = state.commandMenu.items.length || 1;
      state.commandMenu.selectedIndex = (state.commandMenu.selectedIndex + direction + total) % total;
      renderCommandMenu();
      return;
    }
    if (state.commandMenu.open && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      const item = state.commandMenu.items[state.commandMenu.selectedIndex] || state.commandMenu.items[0];
      if (item?.command) {
        insertSlashCommand(item.command);
      }
      return;
    }
    if (state.commandMenu.open && event.key === "Escape") {
      event.preventDefault();
      closeCommandMenu();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm?.requestSubmit();
    }
  });
  chatInput.addEventListener("input", () => updateCommandMenu());
  chatInput.addEventListener("input", () => renderChatBudget());
  chatInput.addEventListener("input", () => {
    state.chatExploreConfirming = false;
    state.chatExploreScopeError = "";
    renderChatExploreComposer();
    renderChatFindComposer();
    renderChatAutodriveComposer();
  });
  chatInput.addEventListener("click", () => updateCommandMenu());
  chatExploreScopeSelect.addEventListener("change", () => {
    state.chatExploreSelectedScopeKey = String(chatExploreScopeSelect.value || "").trim();
    state.chatExploreHasUserSelectedScope = true;
    state.chatExploreScopeError = "";
    renderChatExploreComposer();
  });
  chatFindModeKeywordBtn.addEventListener("click", () => {
    state.chatFindMode = "keyword";
    chatInput.value = String(chatInput.value || "").replace(/^(\s*\/find)\s+(?:keyword|semantic)(?=\s|$)\s*/i, "$1 ");
    renderChatFindComposer();
    chatInput.focus();
  });
  chatFindModeSemanticBtn.addEventListener("click", () => {
    const semantic = currentAutomationFindSemanticState();
    if (!semantic.available) {
      setStatus(semantic.reason || semantic.error || "Run full-text embeddings first to use Semantic Find Arguments. Keyword search works without this.", "error");
      renderChatFindComposer();
      chatInput.focus();
      return;
    }
    state.chatFindMode = "semantic";
    chatInput.value = String(chatInput.value || "").replace(/^(\s*\/find)\s+(?:keyword|semantic)(?=\s|$)\s*/i, "$1 ");
    renderChatFindComposer();
    chatInput.focus();
  });
  chatFindScopeSelect.addEventListener("change", () => {
    state.chatFindSelectedScopeKey = String(chatFindScopeSelect.value || "").trim();
    state.chatFindHasUserSelectedScope = true;
    state.chatFindScopeError = "";
    state.chatFindConfig = null;
    state.chatFindConfigError = "";
    renderChatFindComposer();
  });
  chatAutodriveCountButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const count = normalizeAutomationAutodriveCount(button.getAttribute("data-automation-autodrive-count") || 3);
      state.chatAutodriveCount = count;
      chatAutodriveCountInput.value = String(count);
      renderChatAutodriveComposer();
      chatInput.focus();
    });
  });
  chatAutodriveReviewerSelect.addEventListener("change", () => {
    state.chatAutodriveReviewerMode = normalizeAutomationAutodriveReviewerMode(chatAutodriveReviewerSelect.value || "");
    renderChatAutodriveComposer();
    chatInput.focus();
  });
  [chatAutodriveAgentPromptTab, chatAutodriveReviewerPromptTab].forEach((button) => {
    button.addEventListener("click", () => {
      state.chatAutodrivePromptTab = String(button.getAttribute("data-automation-autodrive-prompt-tab") || "agent").trim() === "reviewer"
        ? "reviewer"
        : "agent";
      renderChatAutodriveComposer();
      (state.chatAutodrivePromptTab === "reviewer" ? chatAutodriveReviewerPrompt : chatAutodrivePrompt).focus();
    });
  });
  chatAutodriveCountInput.addEventListener("input", () => {
    state.chatAutodriveCount = normalizeAutomationAutodriveCount(chatAutodriveCountInput.value || 3);
    renderChatAutodriveComposer();
  });
  chatAutodrivePrompt.addEventListener("input", () => {
    state.chatAutodrivePromptTouched = true;
    renderChatAutodriveComposer();
  });
  chatAutodriveReviewerPrompt.addEventListener("input", () => {
    state.chatAutodriveReviewerPromptTouched = true;
    renderChatAutodriveComposer();
  });
  chatAutodriveCancelBtn.addEventListener("click", () => {
    chatInput.value = "";
    state.chatAutodrivePromptTouched = false;
    state.chatAutodriveReviewerPromptTouched = false;
    state.chatAutodrivePromptTab = "agent";
    renderChatAutodriveComposer();
    chatInput.focus();
  });
  chatAutodriveStopBtn.addEventListener("click", () => {
    stopActiveChatRun().catch((error) => setStatus(error?.message || String(error), "error"));
  });
  chatAutodriveStartBtn.addEventListener("click", () => {
    startAutomationAutodrivePrompt().catch((error) => setStatus(error?.message || String(error), "error"));
  });
  chatExploreCancelBtn.addEventListener("click", () => {
    state.chatExploreConfirming = false;
    state.chatExploreScopeError = "";
    renderChatExploreComposer();
    chatInput.focus();
  });
  chatExploreContinueBtn.addEventListener("click", () => {
    continueAutomationExplorePrompt().catch((error) => setStatus(error?.message || String(error), "error"));
  });
  chatExploreCopy.addEventListener("mouseenter", () => {
    openChatExploreDraftPopover();
  });
  chatExploreCopy.addEventListener("mouseleave", () => {
    scheduleChatPopoverClose("explore-draft");
  });
  chatExploreCopy.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.chatPopover?.kind === "explore-draft" && state.chatPopover?.anchor === chatExploreCopy) {
      closeChatPopover("explore-draft");
      return;
    }
    openChatExploreDraftPopover();
  });
  chatMessages.addEventListener("scroll", () => {
    const currentTop = Number(chatMessages.scrollTop || 0) || 0;
    const delta = currentTop - (Number(state.chatLastScrollTop || 0) || 0);
    state.chatLastScrollTop = currentTop;
    if (state.chatProgrammaticScroll) {
      return;
    }
    if (state.chatRun?.status === "running" && (delta < -4 || !isChatNearBottom())) {
      state.chatAutoFollowLocked = true;
    }
  });

  workspaceDivider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    workspaceDivider.setPointerCapture?.(event.pointerId);
    state.splitDrag = {
      pointerId: event.pointerId,
    };
    shell.classList.add("is-resizing");
  });

  workspaceDivider.addEventListener("pointermove", (event) => {
    if (!state.splitDrag) {
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    const nextWidth = shellRect.right - event.clientX - 10;
    applySidebarWidth(nextWidth);
  });

  workspaceDivider.addEventListener("pointerup", (event) => {
    if (!state.splitDrag) {
      return;
    }
    workspaceDivider.releasePointerCapture?.(event.pointerId);
    state.splitDrag = null;
    shell.classList.remove("is-resizing");
  });

  workspaceDivider.addEventListener("pointercancel", () => {
    state.splitDrag = null;
    shell.classList.remove("is-resizing");
  });

  installNativeMutationObserver();
  refreshBootstrap().catch((error) => setStatus(error?.message || String(error), "error"));

	  return {
	    node: panel,
	    setPreviewPageTheme(theme = "light") {
	      const next = String(theme || "").trim().toLowerCase() === "dark" ? "dark" : "light";
	      if (!state.bootstrap) {
	        state.bootstrap = {};
	      }
	      state.bootstrap.preview_page_theme = next;
	      if (ctx.bootstrap) {
	        ctx.bootstrap.preview_page_theme = next;
	      }
	      updateDocumentStyles();
	    },
	    hasPendingChanges() {
      return hasPendingDocumentChanges();
    },
    async canDeactivate() {
      await savePendingDocument({ silent: true, surface: "", saveReason: "mode-switch-save" });
      return true;
    },
    destroy() {
      state.destroyed = true;
      closeOverlay();
      clearPreviewRefreshTimer();
      clearNativeBlurReflowTimer();
      clearSurfaceReflowTimer("preview");
      clearSurfaceReflowTimer("native");
      if (state.reflowFrame) {
        if (typeof window.cancelAnimationFrame === "function") {
          window.cancelAnimationFrame(state.reflowFrame);
        }
        else {
          window.clearTimeout(state.reflowFrame);
        }
        state.reflowFrame = 0;
      }
      state.pendingReflows.clear();
      clearChatPollTimer();
      clearChatClockTimer();
      state.chatStreamAbortController?.abort?.();
      state.chatStreamAbortController = null;
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
      window.removeEventListener("resize", handleWindowResize, true);
      window.removeEventListener("mousedown", handleWindowPointerDown, true);
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      document.removeEventListener("selectionchange", handleDocumentSelectionChange, true);
      closeEditorContextMenu();
      closeChatPopover();
      closeOverlay();
      closeCommandMenu();
      state.nativeMutationObserver?.disconnect?.();
      state.nativeMutationObserver = null;
      statusTooltip.remove();
      state.renderState = null;
      state.lastSelectionState = null;
      state.nativeActiveEditable = null;
    },
  };
}
