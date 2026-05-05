var HTML_NS = "http://www.w3.org/1999/xhtml";

var SYSTEMATIC_REVIEWER_WORKSPACE_CSS = `
.sr-workspace-root {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 100%;
	padding: 14px;
	box-sizing: border-box;
	color: #e7e7ea;
	font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sr-workspace-topbar,
.sr-workspace-card {
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 14px;
	background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
	box-shadow: 0 14px 38px rgba(0,0,0,0.18);
}

.sr-workspace-topbar {
	padding: 14px;
}

.sr-workspace-brand {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: #8abaff;
}

.sr-workspace-title {
	margin-top: 5px;
	font-size: 18px;
	font-weight: 700;
	line-height: 1.2;
}

.sr-workspace-path {
	margin-top: 4px;
	font-size: 11px;
	color: #a6a8af;
	word-break: break-word;
}

.sr-workspace-toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 12px;
}

.sr-workspace-btn,
.sr-workspace-send {
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 10px;
	background: #2a2b30;
	color: #f3f3f5;
	padding: 8px 11px;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}

.sr-workspace-btn:hover,
.sr-workspace-send:hover {
	border-color: rgba(138,186,255,0.6);
}

.sr-workspace-btn-primary,
.sr-workspace-send {
	background: linear-gradient(180deg, rgba(108,170,255,0.95), rgba(86,145,236,0.95));
	color: #091322;
	border-color: rgba(138,186,255,0.7);
}

.sr-workspace-btn[disabled],
.sr-workspace-send[disabled] {
	opacity: 0.6;
	cursor: default;
}

.sr-workspace-status {
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	justify-content: flex-start;
	inline-size: 10ch;
	max-inline-size: 10ch;
	flex: 0 0 10ch;
	box-sizing: border-box;
	min-height: 32px;
	padding: 0 12px;
	border-radius: 999px;
	border: 1px solid rgba(255,255,255,0.1);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: #abb0b9;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	cursor: help;
}

.sr-workspace-status.ready {
	color: #73cb92;
	border-color: rgba(115,203,146,0.45);
}

.sr-workspace-status.error {
	color: #ff9b9b;
	border-color: rgba(255,155,155,0.45);
}

.sr-workspace-shell {
	display: grid;
	grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.95fr);
	gap: 12px;
	align-items: start;
	min-height: 0;
}

.sr-workspace-sidebar {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 0;
}

.sr-workspace-card-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 14px;
	border-bottom: 1px solid rgba(255,255,255,0.06);
}

.sr-workspace-card-title {
	font-size: 14px;
	font-weight: 700;
}

.sr-workspace-card-subtitle {
	margin-top: 4px;
	font-size: 11px;
	color: #a6a8af;
}

.sr-workspace-card-body {
	padding: 14px;
}

.sr-workspace-preview {
	min-height: 500px;
	max-height: calc(100vh - 250px);
	overflow: auto;
}

.sr-workspace-editor {
	width: 100%;
	min-height: 500px;
	max-height: calc(100vh - 250px);
	resize: vertical;
	border: 0;
	outline: none;
	border-radius: 8px;
	background: #17181a;
	color: #ededee;
	padding: 12px;
	font: 13px/1.6 ui-monospace, "SFMono-Regular", Menlo, monospace;
}

.sr-workspace-preview[hidden],
.sr-workspace-editor[hidden] {
	display: none !important;
}

.sr-workspace-preview h1,
.sr-workspace-preview h2,
.sr-workspace-preview h3,
.sr-workspace-preview h4 {
	line-height: 1.2;
	margin-top: 1.35em;
	margin-bottom: 0.55em;
}

.sr-workspace-preview h1:first-child,
.sr-workspace-preview h2:first-child,
.sr-workspace-preview h3:first-child {
	margin-top: 0;
}

.sr-workspace-preview p,
.sr-workspace-preview li {
	line-height: 1.65;
	color: #e7e7e8;
}

.sr-workspace-preview img {
	max-width: 100%;
	height: auto;
	border-radius: 10px;
}

.sr-workspace-preview pre {
	overflow: auto;
	padding: 10px 12px;
	border-radius: 8px;
	background: #151619;
	border: 1px solid rgba(255,255,255,0.08);
	font-family: inherit;
	font-size: inherit;
	line-height: inherit;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	word-break: break-word;
}

.sr-workspace-preview code {
	background: rgba(255,255,255,0.08);
	padding: 0.15em 0.35em;
	border-radius: 6px;
	font-family: inherit;
	font-size: inherit;
	line-height: inherit;
}

.sr-workspace-preview pre code {
	background: transparent;
	padding: 0;
	border-radius: 0;
}

.sr-workspace-table-scroll {
	overflow-x: auto;
	margin: 12px 0;
	padding-bottom: 2px;
}

.sr-workspace-preview table {
	border-collapse: collapse;
	min-width: 100%;
	white-space: nowrap;
}

.sr-workspace-preview th,
.sr-workspace-preview td {
	border: 1px solid rgba(255,255,255,0.1);
	padding: 8px 10px;
	text-align: left;
	vertical-align: top;
}

.sr-workspace-chat-messages {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-height: 280px;
	max-height: calc(100vh - 360px);
	overflow: auto;
}

.sr-workspace-message {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border-radius: 12px;
	background: rgba(255,255,255,0.04);
	border: 1px solid rgba(255,255,255,0.06);
}

.sr-workspace-message-user {
	background: rgba(106,166,255,0.12);
	border-color: rgba(106,166,255,0.24);
}

.sr-workspace-message-system {
	background: rgba(255,255,255,0.025);
	border-style: dashed;
}

.sr-workspace-message-tool {
	background: rgba(194,168,120,0.12);
	border-color: rgba(194,168,120,0.2);
}

.sr-workspace-message-thinking {
	background: rgba(150,150,255,0.08);
	border-color: rgba(150,150,255,0.16);
}

.sr-workspace-message-placeholder {
	opacity: 0.78;
}

.sr-workspace-message-role {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: #8abaff;
}

.sr-workspace-message-text {
	white-space: pre-wrap;
	word-break: break-word;
}

.sr-workspace-message-title {
	font-size: 12px;
	font-weight: 600;
}

.sr-workspace-message-details {
	display: block;
}

.sr-workspace-message-summary {
	cursor: pointer;
	font-size: 12px;
	font-weight: 600;
}

.sr-workspace-chat-form {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 10px;
	margin-top: 12px;
}

.sr-workspace-chat-input {
	min-height: 96px;
	resize: vertical;
	border-radius: 10px;
	border: 1px solid rgba(255,255,255,0.1);
	background: #17181a;
	color: #ededee;
	padding: 10px 12px;
	outline: none;
	font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sr-workspace-empty {
	font-size: 12px;
	color: #a6a8af;
}

.sr-jobs-root {
	--sr-bg: var(--mw-panel, #eeeeee);
	--sr-panel: var(--mw-panel, #eeeeee);
	--sr-panel-alt: var(--mw-panel, #eeeeee);
	--sr-panel-soft: var(--mw-panel-soft, #eeeeee);
	--sr-border: var(--mw-border, #d3d3d3);
	--sr-border-strong: var(--mw-border, #d3d3d3);
	--sr-fg: var(--mw-text, #202124);
	--sr-fg-soft: var(--mw-text, #202124);
	--sr-muted: var(--mw-muted, #6b6f76);
	--sr-input: var(--mw-control-bg, #ffffff);
	--sr-code: var(--mw-control-bg, #ffffff);
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 100%;
	padding: 14px;
	box-sizing: border-box;
	color: #e7e7ea;
	font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sr-jobs-grid {
	display: grid;
	grid-template-columns: minmax(340px, 0.95fr) minmax(0, 1.4fr);
	gap: 12px;
	min-height: 0;
}

.sr-jobs-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-height: calc(100vh - 240px);
	overflow: auto;
}

.sr-jobs-item {
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 12px;
	background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
	padding: 12px;
	cursor: pointer;
}

.sr-jobs-item.selected {
	border-color: rgba(138,186,255,0.72);
	box-shadow: 0 0 0 1px rgba(138,186,255,0.25) inset;
}

.sr-jobs-item-top,
.sr-jobs-detail-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}

.sr-jobs-item-title {
	font-size: 13px;
	font-weight: 700;
}

.sr-jobs-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 3px 8px;
	border-radius: 999px;
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	border: 1px solid rgba(255,255,255,0.08);
	color: #d7d9de;
}

.sr-jobs-badge.queued {
	color: #dbd08a;
	border-color: rgba(219,208,138,0.34);
}

.sr-jobs-badge.running {
	color: #8abaff;
	border-color: rgba(138,186,255,0.48);
}

.sr-jobs-badge.succeeded {
	color: #73cb92;
	border-color: rgba(115,203,146,0.45);
}

.sr-jobs-badge.partial {
	color: #f3aa4a;
	border-color: rgba(243,170,74,0.42);
}

.sr-jobs-badge.failed {
	color: #ff9b9b;
	border-color: rgba(255,155,155,0.48);
}

.sr-jobs-badge.canceled {
	color: #c8a5ff;
	border-color: rgba(200,165,255,0.42);
}

.sr-jobs-meta {
	margin-top: 8px;
	font-size: 11px;
	color: #a6a8af;
}

.sr-jobs-detail {
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 14px;
	background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015));
	min-height: calc(100vh - 240px);
	display: flex;
	flex-direction: column;
}

.sr-jobs-detail-body {
	padding: 14px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 0;
}

.sr-jobs-logbox {
	min-height: 260px;
	max-height: calc(100vh - 360px);
	overflow: auto;
	border-radius: 10px;
	background: #16171a;
	border: 1px solid rgba(255,255,255,0.08);
	padding: 12px;
	font: 12px/1.5 ui-monospace, "SFMono-Regular", Menlo, monospace;
	white-space: pre-wrap;
	word-break: break-word;
}

.sr-jobs-summary {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

@media (max-width: 1240px) {
	.sr-workspace-shell {
		grid-template-columns: 1fr;
	}
	.sr-jobs-grid {
		grid-template-columns: 1fr;
	}
}
`;

var SYSTEMATIC_REVIEWER_WORKSPACE_CSS_V2 = `
.sr-workspace-root {
	--sr-font-family: Georgia;
	--sr-font-size: 12px;
	--sr-line-height: 1.6;
	--sr-paragraph-align: left;
	--sr-paragraph-indent: 0in;
	--sr-heading-1-scale: 1.96;
	--sr-heading-2-scale: 1.62;
	--sr-heading-3-scale: 1.35;
	--sr-heading-4-scale: 1.08;
	--sr-heading-5-scale: 1;
	--sr-heading-6-scale: 1;
	--sr-border-width: 1px;
	--sr-radius-sm: 4px;
	--sr-accent: AccentColor;
	--sr-accent-soft: color-mix(in srgb, var(--sr-accent) 18%, transparent);
	display: grid;
	grid-template-rows: minmax(0, 1fr) auto;
	gap: 6px;
	height: 100%;
	min-height: 0;
	width: 100%;
	padding: 8px;
	box-sizing: border-box;
	font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	color: var(--sr-fg);
	background: var(--sr-bg);
	overflow: hidden;
}

.sr-workspace-root.theme-dark,
.sr-jobs-root.theme-dark,
.sr-md-viewer-root.theme-dark,
.sr-dialog.theme-dark,
.sr-merge-notice.theme-dark,
.sr-context-menu.theme-dark {
	--mw-ui-scale: 1;
	--mw-control-height: calc(2.15rem * var(--mw-ui-scale));
	--mw-font: menu;
	--mw-bg: #1e1e1e;
	--mw-panel: #2e2e2e;
	--mw-panel-soft: #2e2e2e;
	--mw-text: #f2f4f8;
	--mw-muted: #b1b1b1;
	--mw-border: #4a4a4a;
	--mw-accent: #0a84ff;
	--mw-accent-soft: rgba(10, 132, 255, 0.18);
	--mw-primary-bg: #0065d3;
	--mw-primary-border: #0a74de;
	--mw-primary-text: #f7fbff;
	--mw-primary-hover-bg: #0a74de;
	--mw-primary-hover-border: #2f8dff;
	--mw-control-bg: #1e1e1e;
	--mw-control-soft-bg: #1e1e1e;
	--mw-radius-sm: 4px;
	--sr-border-width: 1px;
	--sr-radius-sm: var(--mw-radius-sm);
	--sr-accent: var(--mw-accent);
	--sr-accent-soft: var(--mw-accent-soft);
	--sr-bg: #1e1e1e;
	--sr-panel: #2a2d31;
	--sr-panel-alt: #32363b;
	--sr-panel-soft: #2d3035;
	--sr-border: #42474f;
	--sr-border-strong: #505660;
	--sr-fg: #f2f4f7;
	--sr-fg-soft: #d6d9de;
	--sr-muted: #a2a8b2;
	--sr-input: #1a1c1f;
	--sr-code: #16181b;
	--sr-chip: #32363b;
	--sr-doc-chrome: transparent;
}

.sr-workspace-root.theme-light,
.sr-jobs-root.theme-light,
.sr-md-viewer-root.theme-light,
.sr-dialog.theme-light,
.sr-merge-notice.theme-light,
.sr-context-menu.theme-light {
	--mw-ui-scale: 1;
	--mw-control-height: calc(2.15rem * var(--mw-ui-scale));
	--mw-font: menu;
	--mw-bg: #eeeeee;
	--mw-panel: #eeeeee;
	--mw-panel-soft: #eeeeee;
	--mw-text: #202124;
	--mw-muted: #6b6f76;
	--mw-border: #d3d3d3;
	--mw-accent: #0065d3;
	--mw-accent-soft: rgba(0, 101, 211, 0.14);
	--mw-primary-bg: #0065d3;
	--mw-primary-border: #0a74de;
	--mw-primary-text: #ffffff;
	--mw-primary-hover-bg: #0a74de;
	--mw-primary-hover-border: #2f8dff;
	--mw-control-bg: #ffffff;
	--mw-control-soft-bg: #f8f8f8;
	--mw-radius-sm: 4px;
	--sr-border-width: 1px;
	--sr-radius-sm: var(--mw-radius-sm);
	--sr-accent: var(--mw-accent);
	--sr-accent-soft: var(--mw-accent-soft);
	--sr-bg: #f0f0f0;
	--sr-panel: #f0f0f0;
	--sr-panel-alt: #f0f0f0;
	--sr-panel-soft: #f0f0f0;
	--sr-border: #c7ced8;
	--sr-border-strong: #b3bdca;
	--sr-fg: #1e232a;
	--sr-fg-soft: #1b1f23;
	--sr-muted: #687384;
	--sr-input: #ffffff;
	--sr-code: #f0f0f0;
	--sr-chip: #f0f0f0;
	--sr-doc-chrome: transparent;
}

.sr-workspace-root button,
.sr-workspace-root input,
.sr-workspace-root select,
.sr-workspace-root textarea,
.sr-jobs-root button,
.sr-jobs-root input,
.sr-jobs-root select,
.sr-md-viewer-root button,
.sr-md-viewer-root input,
.sr-md-viewer-root select,
.sr-md-viewer-root textarea,
.sr-dialog button,
.sr-dialog input,
.sr-dialog select,
.sr-dialog textarea,
.sr-merge-notice button {
	font: inherit;
}

.sr-workspace-topbar,
.sr-workspace-card,
.sr-jobs-detail,
.sr-jobs-item,
.sr-dialog {
	border: var(--sr-border-width) solid var(--sr-border);
	border-radius: var(--sr-radius-sm);
	background: var(--sr-panel);
	box-shadow: none;
}

.sr-workspace-topbar {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
	padding: 6px 8px;
}

.sr-workspace-topbar-copy {
	min-width: 0;
	flex: 1 1 auto;
}

.sr-workspace-title {
	margin-top: 0;
	font-size: 15px;
	font-weight: 600;
	line-height: 1.25;
}

.sr-workspace-path {
	margin-top: 3px;
	font-size: 11px;
	color: var(--sr-muted);
	word-break: break-word;
}

.sr-workspace-toolbar,
.sr-editor-toolbar,
.sr-editor-settings {
	display: flex;
	flex-wrap: nowrap;
	gap: 6px;
	align-items: center;
	overflow-x: auto;
	overflow-y: hidden;
	white-space: nowrap;
}

.sr-workspace-toolbar {
	flex-wrap: wrap;
	overflow: visible;
	white-space: normal;
}

.sr-editor-toolbar > *,
.sr-editor-settings > * {
	flex-shrink: 0;
}

.sr-editor-toolbar[hidden],
.sr-editor-settings[hidden] {
	display: none !important;
}

.sr-workspace-toolbar {
	margin-top: 0;
	flex: 0 0 auto;
}

.sr-workspace-btn,
.sr-workspace-send,
.sr-editor-select,
.sr-editor-size {
	border: var(--sr-border-width) solid var(--sr-border-strong);
	border-radius: var(--sr-radius-sm);
	background: var(--sr-panel-alt);
	color: var(--sr-fg);
	padding: 3px 8px;
	min-height: 28px;
	font-size: 12px;
	cursor: pointer;
}

.sr-editor-command-select {
	min-width: 92px;
	width: 92px;
	flex: 0 0 92px;
}

.sr-layout-select {
	min-width: 96px;
	width: 96px;
	flex: 0 0 96px;
}

.sr-workspace-btn:hover,
.sr-workspace-send:hover,
.sr-editor-select:hover,
.sr-editor-size:hover,
.sr-editor-range:hover {
	border-color: var(--sr-accent);
}

.sr-citation-action {
	border-color: rgba(166, 52, 64, 0.78);
	background: color-mix(in srgb, rgba(166, 52, 64, 0.14) 100%, var(--sr-panel-alt));
}

.sr-citation-action:hover {
	border-color: rgba(196, 68, 82, 0.92);
}

.sr-editor-range-wrap {
	--sr-range-percent: 50%;
	position: relative;
	width: 168px;
	height: 18px;
	flex: 0 0 168px;
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
	accent-color: var(--sr-accent);
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
	background: color-mix(in srgb, var(--sr-fg) 22%, transparent);
}

.sr-editor-range-thumb-visual {
	left: var(--sr-range-percent);
	top: 50%;
	width: 6px;
	height: 18px;
	transform: translate(-50%, -50%);
	background: #0a84ff;
	background: var(--sr-accent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--sr-fg) 12%, transparent);
}

.sr-editor-range-value {
	min-width: 46px;
	font-size: 11px;
	color: var(--sr-muted);
}

.sr-workspace-btn-primary,
.sr-workspace-send {
	background: color-mix(in srgb, var(--sr-accent) 16%, var(--sr-panel-alt));
	border-color: color-mix(in srgb, var(--sr-accent) 55%, var(--sr-border-strong));
}

.sr-workspace-btn[disabled],
.sr-workspace-send[disabled] {
	opacity: 0.55;
	cursor: default;
}

.sr-workspace-status {
	display: inline-flex;
	align-items: center;
	justify-content: flex-start;
	inline-size: 10ch;
	max-inline-size: 10ch;
	flex: 0 0 10ch;
	box-sizing: border-box;
	min-height: 28px;
	padding: 0 8px;
	border: var(--sr-border-width) solid var(--sr-border);
	border-radius: var(--sr-radius-sm);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--sr-muted);
	background: var(--sr-panel-soft);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	cursor: help;
}

.sr-workspace-status.ready { color: #26883e; border-color: rgba(38,136,62,0.35); }
.sr-workspace-status.error { color: #b83232; border-color: rgba(184,50,50,0.35); }

.sr-merge-notice-host {
	position: fixed;
	right: 16px;
	bottom: 16px;
	z-index: 2147483000;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	pointer-events: none;
}

.sr-merge-notice {
	width: min(420px, calc(100vw - 32px));
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 6px;
	background: Canvas;
	color: FieldText;
	box-shadow: 0 8px 24px color-mix(in srgb, black 14%, transparent);
	pointer-events: auto;
}

.sr-merge-notice-copy {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.sr-merge-notice-title {
	margin: 0;
	font-size: 14px;
	font-weight: 700;
	line-height: 1.3;
}

.sr-merge-notice-text {
	margin: 0;
	color: var(--sr-muted);
	font-size: 12px;
	line-height: 1.45;
}

.sr-merge-notice-actions {
	display: flex;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 8px;
}

.sr-workspace-shell {
	display: grid;
	grid-template-columns: minmax(0, 1fr) clamp(300px, 30vw, 420px);
	gap: 10px;
	align-items: stretch;
	flex: 1 1 auto;
	min-height: 0;
	height: 100%;
	overflow: hidden;
}

.sr-workspace-main {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
	flex-direction: column;
	height: auto;
	overflow: hidden;
	border: 0;
	background: transparent;
}

.sr-workspace-sidebar {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-height: 0;
	max-width: none;
	min-width: 300px;
	width: auto;
	overflow: hidden;
}

.sr-workspace-sidebar > .sr-workspace-card {
	flex: 1 1 auto;
	height: auto;
	overflow: hidden;
}

.sr-workspace-card {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: auto;
	overflow: hidden;
}

.sr-workspace-card-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 10px;
	padding: 10px 12px;
	border-bottom: var(--sr-border-width) solid var(--sr-border);
}

.sr-workspace-card-title {
	font-size: 14px;
	font-weight: 600;
}

.sr-workspace-card-subtitle {
	margin-top: 3px;
	font-size: 11px;
	color: var(--sr-muted);
}

.sr-workspace-card-body {
	padding: 0;
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	background: transparent;
	overflow: hidden;
}

.sr-workspace-main .sr-workspace-card-body {
	background: transparent;
}

.sr-editor-toolbar-strip {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px 12px;
	border-bottom: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel);
}

.sr-editor-footer-strip {
	display: flex;
	flex-wrap: nowrap;
	align-items: center;
	gap: 10px;
	padding: 8px 12px;
	border: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel);
	flex: 0 0 auto;
	min-height: 42px;
	box-sizing: border-box;
	overflow-x: auto;
	overflow-y: hidden;
	white-space: nowrap;
}

.sr-editor-footer-strip > * {
	min-width: 0;
	flex-shrink: 0;
}

.sr-editor-footer-strip .sr-workspace-status {
	margin-left: auto;
}

.sr-editor-footer-zoom,
.sr-chat-header-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.sr-editor-footer-zoom {
	margin-left: 0;
	flex: 1 1 auto;
	min-width: 250px;
	justify-content: flex-end;
	flex-wrap: nowrap;
}

.sr-editor-footer-label {
	font-size: 11px;
	color: var(--sr-muted);
	white-space: nowrap;
}

.sr-editor-style-note {
	font-size: 11px;
	color: var(--sr-muted);
	white-space: nowrap;
}

.sr-citation-actions {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.sr-mode-tabs {
	display: inline-flex;
	border: var(--sr-border-width) solid var(--sr-border);
	border-radius: var(--sr-radius-sm);
	overflow: hidden;
}

.sr-mode-tab {
	border: 0;
	border-right: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel-alt);
	color: var(--sr-fg);
	padding: 6px 12px;
	cursor: pointer;
	font-size: 12px;
	min-height: 30px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	white-space: nowrap;
}

.sr-mode-tab:last-child {
	border-right: 0;
}

.sr-mode-tab.active {
	background: color-mix(in srgb, var(--sr-accent) 18%, var(--sr-panel));
}

.sr-workspace-preview,
.sr-workspace-native {
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	height: auto;
	max-height: none;
	overflow: auto;
	font-family: var(--sr-font-family), Georgia, serif;
	font-size: var(--sr-font-size);
	line-height: var(--sr-line-height);
	color: var(--sr-fg);
	background: transparent;
	padding: 0;
}

.sr-workspace-preview {
	display: block;
}

.sr-workspace-native {
	display: block;
}

.sr-workspace-raw {
	width: 100%;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	height: auto;
	max-height: none;
	resize: none;
	border: 0;
	outline: none;
	border-radius: var(--sr-radius-sm);
	background: var(--sr-input);
	color: var(--sr-fg);
	padding: 12px;
	font: 13px/1.6 ui-monospace, "SFMono-Regular", Menlo, monospace;
	overflow: auto;
	box-sizing: border-box;
}

.sr-workspace-preview[hidden],
.sr-workspace-native[hidden],
.sr-workspace-raw[hidden] { display: none !important; }

.sr-doc-host {
	width: 100%;
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	justify-content: center;
	align-items: flex-start;
	padding: 0;
	box-sizing: border-box;
	background: transparent;
	overflow: auto;
}

.sr-doc-host > .sr-markdown-document,
.sr-doc-host > .sr-native-root {
	width: max-content;
	min-width: 0;
	max-width: none;
	min-height: 0;
	margin: 0;
	padding: 0;
	box-sizing: border-box;
	background: transparent;
	color: #1d2024;
	border: 0;
	box-shadow: none;
}

.sr-page-stack {
	display: flex;
	flex-direction: column;
	gap: var(--sr-page-gap);
	align-items: center;
	min-width: 0;
	min-height: 0;
	padding-bottom: 0;
	background: transparent;
}

.sr-page-sheet {
	position: relative;
	background: transparent;
	flex: 0 0 auto;
}

.sr-page-sheet-body {
	width: calc(210mm * var(--sr-page-view-scale));
	max-width: none;
	min-height: calc(297mm * var(--sr-page-view-scale));
	margin: 0 auto;
	padding:
		calc(20mm * var(--sr-page-view-scale))
		calc(18mm * var(--sr-page-view-scale))
		calc(20mm * var(--sr-page-view-scale))
		calc(20mm * var(--sr-page-view-scale));
	box-sizing: border-box;
	background: #ffffff;
	color: #1d2024;
	border: 0;
	box-shadow: none;
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale));
}

.sr-page-editor-body {
	width: 100%;
	min-height: 100%;
	outline: none;
	color: #1d2024;
	caret-color: #1d2024;
	cursor: text;
	white-space: normal;
}

.sr-page-editor-body:focus {
	outline: none;
}

.sr-page-editor-body > *:first-child {
	margin-top: 0;
}

.sr-page-editor-body > *:last-child {
	margin-bottom: 0;
}

.sr-page-sheet[data-sr-layout="landscape"] .sr-page-sheet-body {
	width: calc(297mm * var(--sr-page-view-scale));
	min-height: calc(210mm * var(--sr-page-view-scale));
}

.sr-page-sheet-meta {
	display: none;
}

.sr-markdown-document,
.sr-native-root,
.sr-page-sheet-body {
	color: #1d2024;
}

.sr-page-sheet-body h1,
.sr-page-sheet-body h2,
.sr-page-sheet-body h3,
.sr-page-sheet-body h4,
.sr-page-sheet-body h5 {
	line-height: 1.2;
	margin-top: 1.1em;
	margin-bottom: 0.45em;
	font-weight: 700;
	color: #1d2024;
}

.sr-page-sheet-body h1:first-child,
.sr-page-sheet-body h2:first-child,
.sr-page-sheet-body h3:first-child { margin-top: 0; }

.sr-page-sheet-body p,
.sr-page-sheet-body li {
	line-height: var(--sr-line-height);
	color: #1d2024;
	text-align: var(--sr-paragraph-align);
	text-align-last: auto;
}

.sr-page-sheet-body p {
	text-indent: var(--sr-paragraph-indent);
}

.sr-page-sheet-body td,
.sr-page-sheet-body th {
	line-height: var(--sr-line-height);
	color: #1d2024;
	text-align: left;
}

.sr-page-sheet-body img {
	max-width: 100%;
	height: auto;
	display: block;
}

.sr-page-sheet-body pre {
	overflow: auto;
	padding: 10px 12px;
	border-radius: 0;
	background: #f5f6f8;
	border: var(--sr-border-width) solid #d3d8df;
	font-family: inherit;
	font-size: inherit;
	line-height: inherit;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	word-break: break-word;
}

.sr-page-sheet-body code {
	background: #f1f3f6;
	padding: 0.15em 0.35em;
	border-radius: 0;
	font-family: inherit;
	font-size: inherit;
	line-height: inherit;
	color: #1d2024;
}

.sr-page-sheet-body pre code {
	background: transparent;
	padding: 0;
	border-radius: 0;
}

.sr-workspace-table-scroll {
	overflow-x: auto;
	margin: 12px 0 14px;
	padding-bottom: 2px;
}

.sr-page-sheet-body table,
.sr-native-table {
	border-collapse: collapse;
	min-width: 100%;
	width: 100%;
	background: #ffffff;
	color: #1d2024;
	table-layout: fixed;
}

.sr-page-sheet-body th,
.sr-page-sheet-body td,
.sr-native-table th,
.sr-native-table td {
	border: var(--sr-border-width) solid #cfd5dc;
	padding: 6px 8px;
	text-align: left;
	vertical-align: top;
}

.sr-native-root {
	font-family: var(--sr-font-family), Georgia, serif;
	font-size: var(--sr-font-size);
	line-height: var(--sr-line-height);
}

.sr-native-block {
	border: 0;
	background: transparent;
	color: #1d2024;
}

.sr-native-block-header {
	display: none;
}

.sr-block-editable {
	padding: 0;
	margin: 0 0 0.85em;
	outline: none;
	white-space: pre-wrap;
	word-break: break-word;
	min-height: 1.35em;
	color: #1d2024 !important;
	background: transparent !important;
	border: 0;
	box-shadow: none;
	caret-color: #1d2024;
	-moz-appearance: none;
	appearance: none;
}

.sr-block-editable:focus {
	outline: 1px solid rgba(10,132,255,0.32);
	outline-offset: 2px;
}

.sr-block-paragraph > .sr-block-editable {
	line-height: var(--sr-line-height);
	text-align: var(--sr-paragraph-align);
	text-align-last: auto;
	text-indent: var(--sr-paragraph-indent);
}

.sr-native-list-item > .sr-block-editable {
	line-height: var(--sr-line-height);
	text-align: var(--sr-paragraph-align);
	text-align-last: auto;
}

.sr-block-heading[data-level="1"] .sr-block-editable {
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale) * var(--sr-heading-1-scale));
	font-weight: 700;
	margin-top: 0;
	margin-bottom: 0.45em;
}

.sr-block-heading[data-level="2"] .sr-block-editable {
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale) * var(--sr-heading-2-scale));
	font-weight: 700;
	margin-bottom: 0.4em;
}

.sr-block-heading[data-level="3"] .sr-block-editable {
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale) * var(--sr-heading-3-scale));
	font-weight: 700;
	margin-bottom: 0.35em;
}

.sr-block-heading[data-level="4"] .sr-block-editable {
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale) * var(--sr-heading-4-scale));
	font-weight: 700;
	margin-bottom: 0.3em;
}

.sr-block-heading[data-level="5"] .sr-block-editable {
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale) * var(--sr-heading-5-scale));
	font-weight: 700;
	margin-bottom: 0.25em;
}

.sr-block-heading[data-level="6"] .sr-block-editable {
	font-size: calc(var(--sr-font-size) * var(--sr-page-view-scale) * var(--sr-heading-6-scale));
	font-weight: 700;
	margin-bottom: 0.25em;
}

.sr-native-list {
	display: flex;
	flex-direction: column;
	margin: 0 0 0.9em;
}

.sr-native-list-item {
	display: grid;
	grid-template-columns: 28px minmax(0, 1fr);
	border-top: 0;
}

.sr-native-list-item:first-child { border-top: 0; }

.sr-native-list-marker {
	display: flex;
	align-items: flex-start;
	justify-content: center;
	padding-top: 2px;
	color: #1d2024;
}

.sr-native-table-cell {
	min-width: 120px;
	min-height: 22px;
	padding: 2px;
	outline: none;
	color: #1d2024 !important;
	background: transparent !important;
}

.sr-native-table-cell:focus { box-shadow: inset 0 0 0 1px var(--sr-accent); }

.sr-native-table-shell,
.sr-table-block,
.sr-figure-block {
	break-inside: avoid-page;
	page-break-inside: avoid;
}

.sr-table-context,
.sr-figure-context {
	margin: 0 0 6px;
	min-height: 1.35em;
}

.sr-table-note,
.sr-figure-note {
	margin-top: 7px;
	margin-bottom: 0.2em;
	font-size: 11px;
	color: var(--sr-muted);
	text-align: left;
}

.sr-page-editor-body .sr-native-table th,
.sr-page-editor-body .sr-native-table td {
	box-shadow: inset 0 0 0 0.5px rgba(143,152,163,0.28);
}

.sr-page-editor-body .sr-native-table th.sr-table-cell-selected,
.sr-page-editor-body .sr-native-table td.sr-table-cell-selected {
	box-shadow: inset 0 0 0 2px rgba(10,132,255,0.45);
}

.sr-native-image {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 0 0 0.9em;
}

.sr-native-image img { max-width: 100%; height: auto; }

.sr-page-marker {
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 0 0 8px;
	color: var(--sr-muted);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.sr-page-marker::before,
.sr-page-marker::after {
	content: "";
	flex: 1 1 auto;
	height: 1px;
	background: var(--sr-border-strong);
}

.sr-citation-ref,
.sr-citation-chip {
	display: inline;
	padding: 0;
	background: transparent;
	border: 0;
	color: inherit;
	text-decoration: underline;
	text-decoration-style: dotted;
	text-underline-offset: 0.12em;
}

.sr-citation-chip { cursor: pointer; }

.sr-bibliography-placeholder {
	display: block;
	margin-top: 1.4em;
	padding-top: 0.75em;
	border-top: var(--sr-border-width) dashed var(--sr-border-strong);
	color: var(--sr-muted);
}

.sr-workspace-chat-messages {
	display: flex;
	flex-direction: column;
	gap: 8px;
	flex: 1 1 auto;
	min-height: 0;
	height: auto;
	max-height: none;
	overflow: auto;
	padding: 12px;
}

.sr-workspace-message {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 10px;
	border-radius: var(--sr-radius-sm);
	background: var(--sr-panel-alt);
	border: var(--sr-border-width) solid var(--sr-border);
}

.sr-workspace-message-user {
	background: color-mix(in srgb, var(--sr-accent) 14%, var(--sr-panel-alt));
	border-color: color-mix(in srgb, var(--sr-accent) 35%, var(--sr-border));
}

.sr-workspace-message-system {
	background: color-mix(in srgb, var(--sr-panel) 80%, var(--sr-panel-alt));
	border-style: dashed;
}

.sr-workspace-message-tool {
	background: color-mix(in srgb, #c2a878 14%, var(--sr-panel-alt));
	border-color: color-mix(in srgb, #c2a878 34%, var(--sr-border));
}

.sr-workspace-message-thinking {
	background: color-mix(in srgb, var(--sr-accent-soft) 14%, var(--sr-panel-alt));
	border-color: color-mix(in srgb, var(--sr-accent-soft) 30%, var(--sr-border));
}

.sr-workspace-message-placeholder { opacity: 0.85; }

.sr-workspace-bottom-spacer {
	flex: 1 1 auto;
}

.sr-session-select {
	min-width: 180px;
	max-width: 280px;
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

.sr-workspace-message-role {
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--sr-accent);
}

.sr-workspace-message-text {
	white-space: pre-wrap;
	word-break: break-word;
}

.sr-workspace-message-title {
	font-size: 12px;
	font-weight: 600;
}

.sr-workspace-message-details {
	display: block;
}

.sr-workspace-message-summary {
	cursor: pointer;
	font-size: 12px;
	font-weight: 600;
}

.sr-workspace-chat-form {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 8px;
	padding: 0 12px 12px;
	border-top: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel);
}

.sr-workspace-chat-input {
	min-height: 72px;
	resize: vertical;
	border-radius: var(--sr-radius-sm);
	border: var(--sr-border-width) solid var(--sr-border-strong);
	background: var(--sr-input);
	color: var(--sr-fg);
	padding: 6px 8px;
	outline: none;
	font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sr-chat-actions {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 8px;
}

.sr-workspace-empty {
	font-size: 12px;
	color: var(--sr-muted);
}

.sr-dialog-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0,0,0,0.35);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	z-index: 99999;
}

.sr-dialog {
	width: min(1100px, 96vw);
	max-height: min(760px, 92vh);
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.sr-dialog-collection-picker {
	width: min(760px, 92vw);
	max-height: min(680px, 88vh);
	border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 6px;
	background: Canvas;
	color: FieldText;
	box-shadow: 0 10px 26px color-mix(in srgb, black 16%, transparent);
}

.sr-dialog-import-followup {
	width: min(520px, 92vw);
	max-height: min(420px, 82vh);
	border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 6px;
	background: Canvas;
	color: FieldText;
	box-shadow: 0 10px 26px color-mix(in srgb, black 16%, transparent);
}

.sr-dialog-header,
.sr-dialog-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 10px 12px;
	border-bottom: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel);
}

.sr-dialog-footer {
	border-top: var(--sr-border-width) solid var(--sr-border);
	border-bottom: 0;
}

.sr-dialog-body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 320px;
	gap: 10px;
	padding: 10px 12px 12px;
	min-height: 0;
	background: var(--sr-panel);
}

.sr-dialog-sidebar {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-height: 0;
}

.sr-dialog-main {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	min-height: 0;
}

.sr-dialog-collection-tree,
.sr-dialog-selection,
.sr-dialog-results {
	border: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel-alt);
}

.sr-dialog-collection-tree {
	padding: 8px;
}

.sr-dialog-collection-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border: var(--sr-border-width) solid color-mix(in srgb, var(--sr-accent) 24%, var(--sr-border));
	background: color-mix(in srgb, var(--sr-accent) 10%, var(--sr-panel-alt));
}

.sr-dialog-selection {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 8px;
	min-height: 120px;
	max-height: 220px;
	overflow: auto;
}

.sr-dialog-selection-empty {
	font-size: 12px;
	color: var(--sr-muted);
	padding: 4px 2px;
}

.sr-dialog-chip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 100%;
	padding: 6px 10px;
	border: var(--sr-border-width) solid var(--sr-border-strong);
	background: var(--sr-panel);
	font-size: 12px;
}

.sr-dialog-chip-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sr-dialog-chip-remove {
	border: 0;
	background: transparent;
	color: var(--sr-muted);
	padding: 0;
	cursor: pointer;
	min-width: 16px;
}

.sr-dialog-results {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.sr-dialog-results-header {
	display: grid;
	grid-template-columns: 220px 72px minmax(0, 1fr) 40px;
	gap: 12px;
	padding: 8px 10px;
	border-bottom: var(--sr-border-width) solid var(--sr-border);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--sr-fg-soft);
}

.sr-dialog-list {
	display: flex;
	flex-direction: column;
	gap: 0;
	max-height: 520px;
	overflow: auto;
}

.sr-dialog-collection-picker .sr-dialog-body {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px 12px 12px;
	background: Canvas;
}

.sr-dialog-collection-picker .sr-dialog-header,
.sr-dialog-collection-picker .sr-dialog-footer {
	background: Canvas;
	border-color: color-mix(in srgb, currentColor 10%, transparent);
}

.sr-dialog-collection-picker .sr-dialog-title {
	font-size: 14px;
	font-weight: 700;
	color: FieldText;
}

.sr-dialog-collection-picker .sr-dialog-subtitle,
.sr-dialog-import-followup .sr-dialog-subtitle {
	color: var(--fill-secondary, #5b6168);
}

.sr-dialog-collection-picker .sr-field-input,
.sr-dialog-import-followup .sr-field-input {
	border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	border-radius: 4px;
	background: Field;
	color: FieldText;
	padding: 6px 8px;
	font: menu;
}

.sr-dialog-collection-picker .sr-workspace-btn,
.sr-dialog-import-followup .sr-workspace-btn {
	border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	border-radius: 6px;
	background: Canvas;
	color: FieldText;
	font: menu;
	font-weight: 600;
	box-shadow: none;
}

.sr-dialog-collection-picker .sr-workspace-btn:hover,
.sr-dialog-import-followup .sr-workspace-btn:hover {
	border-color: color-mix(in srgb, AccentColor 28%, transparent);
	background: color-mix(in srgb, Canvas 94%, AccentColor 6%);
}

.sr-dialog-collection-picker .sr-workspace-btn-primary,
.sr-dialog-import-followup .sr-workspace-btn-primary {
	background: color-mix(in srgb, AccentColor 12%, Canvas 88%);
	border-color: color-mix(in srgb, AccentColor 28%, transparent);
	color: FieldText;
}

.sr-dialog-import-followup .sr-dialog-body {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	background: Canvas;
}

.sr-dialog-import-followup .sr-dialog-header,
.sr-dialog-import-followup .sr-dialog-footer {
	background: Canvas;
	border-color: color-mix(in srgb, currentColor 10%, transparent);
}

.sr-dialog-import-followup .sr-dialog-title {
	font-size: 14px;
	font-weight: 700;
	color: FieldText;
}

.sr-dialog-import-followup .sr-field-label {
	font-size: 12px;
	color: FieldText;
}

.sr-import-followup-description,
.sr-import-followup-notes {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 6px;
	background: color-mix(in srgb, Canvas 96%, currentColor 4%);
}

.sr-import-followup-description-title {
	font-size: 12px;
	font-weight: 600;
	color: FieldText;
}

.sr-import-followup-description-text,
.sr-import-followup-note {
	font-size: 11px;
	color: var(--fill-secondary, #5b6168);
}

.sr-import-picker-list {
	min-height: 320px;
	max-height: min(380px, 46vh);
	border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	border-radius: 6px;
	background: Canvas;
}

.sr-import-picker-item {
	padding: 0;
	border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent);
}

.sr-import-picker-item:first-child {
	border-top: 0;
}

.sr-import-picker-item[selected="true"] {
	background: color-mix(in srgb, AccentColor 10%, Canvas 90%);
}

.sr-import-picker-item-row {
	display: flex;
	align-items: flex-start;
	gap: 2px;
	min-width: 0;
}

.sr-import-picker-item-check {
	margin: 8px 0 0 8px;
}

.sr-import-picker-item-box {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	padding: 9px 10px;
}

.sr-import-picker-title {
	font-size: 13px;
	font-weight: 600;
	color: FieldText;
}

.sr-import-picker-meta,
.sr-import-picker-empty {
	font-size: 11px;
	color: var(--fill-secondary, #5b6168);
}

.sr-import-picker-checkbox {
	margin: 0;
}

.sr-import-picker-summary {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
	border-radius: 6px;
	background: color-mix(in srgb, Canvas 96%, currentColor 4%);
}

.sr-import-picker-summary-title {
	font-size: 12px;
	font-weight: 600;
	color: FieldText;
}

.sr-import-picker-summary-meta {
	font-size: 11px;
	color: var(--fill-secondary, #5b6168);
}

.sr-import-picker-summary-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-height: min(180px, 24vh);
	overflow: auto;
	padding-top: 2px;
}

.sr-import-picker-summary-item {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding-top: 6px;
	border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent);
}

.sr-import-picker-summary-item:first-child {
	padding-top: 0;
	border-top: 0;
}

.sr-import-picker-summary-item-title {
	font-size: 11px;
	font-weight: 600;
	color: FieldText;
}

.sr-import-picker-summary-item-meta {
	font-size: 11px;
	color: var(--fill-secondary, #5b6168);
}

.sr-dialog-row {
	display: grid;
	grid-template-columns: 220px 72px minmax(0, 1fr) 40px;
	gap: 12px;
	padding: 10px;
	border-top: var(--sr-border-width) solid var(--sr-border);
	background: var(--sr-panel-alt);
	cursor: pointer;
}

.sr-dialog-row.selected {
	border-color: var(--sr-accent);
	background: color-mix(in srgb, var(--sr-accent) 12%, var(--sr-panel-alt));
}

.sr-dialog-col-title {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.sr-dialog-side {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-height: 0;
}

.sr-dialog-item-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--sr-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sr-dialog-item-subtitle,
.sr-dialog-col-meta {
	font-size: 11px;
	color: var(--sr-muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sr-dialog-col-meta {
	display: flex;
	align-items: center;
}

.sr-dialog-col-action {
	display: flex;
	align-items: center;
	justify-content: flex-end;
}

.sr-dialog-add {
	min-width: 28px;
	min-height: 28px;
	padding: 0;
	font-size: 18px;
	line-height: 1;
}

.sr-dialog-meta {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 11px;
	color: var(--sr-muted);
}

.sr-dialog-side {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.sr-field-label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 11px;
	font-weight: 600;
	color: var(--sr-fg-soft);
}

.sr-field-input {
	border: var(--sr-border-width) solid var(--sr-border-strong);
	border-radius: var(--sr-radius-sm);
	background: var(--sr-input);
	color: var(--sr-fg);
	padding: 4px 6px;
}

.sr-dialog-heading {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.sr-dialog-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--sr-fg);
}

.sr-dialog-subtitle {
	font-size: 11px;
	color: var(--sr-muted);
}

.sr-dialog-close {
	min-width: 30px;
	padding: 0;
	font-size: 16px;
	line-height: 1;
}

.sr-context-menu {
	position: fixed;
	min-width: 220px;
	display: flex;
	flex-direction: column;
	padding: 4px 0;
	border: var(--sr-border-width) solid var(--sr-border-strong);
	border-radius: var(--sr-radius-sm);
	background: var(--sr-panel);
	color: var(--sr-fg);
	font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	box-shadow: 0 10px 22px rgba(0,0,0,0.22);
	z-index: 100000;
}

.sr-context-menu-item {
	appearance: none;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	width: 100%;
	padding: 7px 12px;
	border: 0;
	background: transparent;
	color: var(--sr-fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.sr-context-menu-item:hover,
.sr-context-menu-item:focus {
	background: color-mix(in srgb, var(--sr-accent) 12%, var(--sr-panel));
	outline: none;
}

.sr-context-menu-item[disabled] {
	color: var(--sr-muted);
	cursor: default;
	background: transparent;
}

.sr-context-menu-separator {
	height: 1px;
	margin: 4px 0;
	background: var(--sr-border);
}

.sr-overlay-host {
	position: fixed;
	inset: 0;
	pointer-events: none;
	z-index: 100000;
}

.sr-overlay-host > * {
	pointer-events: auto;
}

.sr-jobs-root {
	display: flex;
	flex-direction: column;
	gap: 0;
	flex: 1 1 auto;
	height: 100%;
	min-height: 0;
	padding: 0;
	box-sizing: border-box;
	overflow: hidden;
	font: var(--mw-font, menu);
	line-height: 1.35;
	color: var(--mw-text, var(--sr-fg));
	background: var(--mw-panel, var(--sr-panel));
}

.sr-jobs-root button,
.sr-jobs-root input,
.sr-jobs-root select,
.sr-jobs-root textarea {
	font: inherit;
	color: var(--mw-text, var(--sr-fg));
}

.sr-jobs-root button,
.sr-jobs-root .sr-workspace-btn {
	appearance: none;
	border: 1px solid var(--mw-border, var(--sr-border));
	border-radius: var(--mw-radius-sm, var(--sr-radius-sm));
	background: var(--mw-panel, var(--sr-panel));
	color: var(--mw-text, var(--sr-fg));
	min-height: var(--mw-control-height, 28px);
	padding: 0 9px;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font: inherit;
	font-size: inherit;
	letter-spacing: 0;
	text-transform: none;
}

.sr-jobs-root button:hover,
.sr-jobs-root .sr-workspace-btn:hover {
	border-color: var(--mw-accent, var(--sr-accent));
}

.sr-jobs-root button[disabled],
.sr-jobs-root .sr-workspace-btn[disabled] {
	opacity: 0.55;
	cursor: default;
}

.sr-jobs-root .sr-workspace-status {
	min-height: var(--mw-control-height, 28px);
	padding: 0 8px;
	border: 0;
	border-radius: 0;
	background: transparent;
	color: var(--mw-muted, var(--sr-muted));
	font: inherit;
	font-size: inherit;
	font-weight: 400;
	letter-spacing: 0;
	text-transform: none;
}

.sr-jobs-root .sr-workspace-status.ready { color: #26883e; }
.sr-jobs-root .sr-workspace-status.error { color: #b83232; }

.sr-jobs-topbar {
	align-items: center;
	flex-wrap: nowrap;
	overflow-x: auto;
	border: 0;
	border-bottom: var(--sr-border-width) solid var(--mw-border, var(--sr-border));
	border-radius: 0;
	padding: 6px 8px;
	background: var(--mw-panel, var(--sr-panel));
}

.sr-jobs-grid {
	display: grid;
	grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
	gap: 0;
	flex: 1 1 auto;
	height: 100%;
	min-height: 0;
	overflow: hidden;
}

.sr-jobs-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-height: 0;
	overflow: auto;
	padding: 8px;
	border-right: var(--sr-border-width) solid var(--mw-border, var(--sr-border));
	background: var(--mw-panel, var(--sr-panel));
	box-sizing: border-box;
}

.sr-jobs-item {
	padding: 8px;
	cursor: pointer;
	user-select: text;
	-moz-user-select: text;
	border: 1px solid var(--mw-border, var(--sr-border));
	border-radius: var(--mw-radius-sm, var(--sr-radius-sm));
	background: var(--mw-control-bg, var(--sr-input));
	color: var(--mw-text, var(--sr-fg));
}
.sr-jobs-item.selected {
	border-color: var(--mw-primary-border, var(--sr-accent));
	box-shadow: inset 0 0 0 1px var(--mw-accent-soft, var(--sr-accent-soft));
}
.sr-jobs-item-top,
.sr-jobs-detail-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sr-jobs-item-title { font-size: inherit; font-weight: 600; }
.sr-jobs-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-height: 22px;
	padding: 0 7px;
	border-radius: var(--mw-radius-sm, var(--sr-radius-sm));
	font-size: inherit;
	font-weight: 600;
	text-transform: none;
	letter-spacing: 0;
	border: var(--sr-border-width) solid var(--mw-border, var(--sr-border));
	background: var(--mw-control-soft-bg, var(--sr-panel-soft));
	color: var(--mw-muted, var(--sr-fg-soft));
}
.sr-jobs-summary {
	display: flex;
	flex: 1 1 auto;
	flex-wrap: nowrap;
	gap: 6px;
	min-width: 0;
	overflow-x: auto;
	overflow-y: hidden;
}
.sr-jobs-summary-pill {
	min-height: var(--mw-control-height, 28px);
	padding: 0 8px;
	flex: 0 0 auto;
}
.sr-jobs-badge.queued { color: #8f7200; }
.sr-jobs-badge.running { color: var(--mw-accent, var(--sr-accent)); }
.sr-jobs-badge.succeeded { color: #26883e; }
.sr-jobs-badge.partial { color: #b46100; }
.sr-jobs-badge.failed { color: #b83232; }
.sr-jobs-badge.canceled { color: #7a52b7; }
.sr-jobs-meta { margin-top: 6px; font-size: inherit; color: var(--mw-muted, var(--sr-muted)); }
.sr-jobs-detail {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	overflow: hidden;
	user-select: text;
	-moz-user-select: text;
	border: 0;
	border-radius: 0;
	background: var(--mw-panel, var(--sr-panel));
}
.sr-jobs-detail-body {
	padding: 8px;
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	gap: 10px;
	min-height: 0;
	overflow: hidden;
}
.sr-jobs-harvest-note {
	padding: 8px;
	border: var(--sr-border-width) solid color-mix(in srgb, var(--mw-accent, var(--sr-accent)) 28%, var(--mw-border, var(--sr-border)));
	border-radius: var(--mw-radius-sm, var(--sr-radius-sm));
	background: color-mix(in srgb, var(--mw-accent, var(--sr-accent)) 7%, var(--mw-panel, var(--sr-panel)));
	color: var(--mw-text, var(--sr-fg-soft));
	font-size: inherit;
	line-height: 1.35;
}
.sr-jobs-logbox {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	border-radius: var(--mw-radius-sm, var(--sr-radius-sm));
	background: var(--mw-control-bg, var(--sr-code));
	border: var(--sr-border-width) solid var(--mw-border, var(--sr-border));
	padding: 8px;
	font: 12px/1.5 ui-monospace, "SFMono-Regular", Menlo, monospace;
	white-space: pre;
	word-break: normal;
	user-select: text;
	-moz-user-select: text;
	cursor: text;
}

@media (max-width: 1240px) {
	.sr-workspace-shell {
		grid-template-columns: 1fr;
		grid-template-rows: minmax(0, 1fr) minmax(240px, 0.46fr);
	}
	.sr-workspace-sidebar { max-width: none; min-width: 0; width: 100%; }
	.sr-editor-footer-zoom { min-width: 220px; }
	.sr-dialog-body { grid-template-columns: 1fr; }
	.sr-dialog-results-header,
	.sr-dialog-row { grid-template-columns: minmax(0, 1fr) 120px 88px 46px; }
}

@media (max-width: 900px) {
	.sr-editor-style-note {
		display: none;
	}
	.sr-session-select {
		min-width: 132px;
		max-width: 180px;
	}
}
`;

var SYSTEMATIC_REVIEWER_MARKDOWN_VIEWER_CSS = `
.sr-md-viewer-root {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	width: 100%;
	padding: 12px;
	box-sizing: border-box;
	font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	color: var(--sr-fg);
	background: var(--sr-bg);
	overflow: hidden;
}

.sr-md-viewer-pane {
	border: var(--sr-border-width) solid var(--sr-border);
	border-radius: 0;
	background: var(--sr-panel);
	box-shadow: none;
}

	.sr-md-viewer-header-tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.sr-md-viewer-header-tools-end {
		justify-content: flex-end;
	}

.sr-md-viewer-pdf-page {
	width: 68px;
	min-width: 68px;
	text-align: right;
}

.sr-md-viewer-pdf-page-total {
	font-size: 11px;
	color: var(--sr-muted);
	white-space: nowrap;
}

	.sr-md-viewer-pdf-search {
		width: 200px;
		min-width: 140px;
	}

	.sr-md-viewer-findbar {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1 1 240px;
	}

.sr-md-viewer-findbar[hidden] {
	display: none !important;
}

.sr-md-viewer-findbar .sr-md-viewer-pdf-search {
	flex: 1 1 200px;
	width: auto;
	min-width: 120px;
}

.sr-md-viewer-status {
	white-space: nowrap;
}

	.sr-md-viewer-shell {
		display: grid;
		grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);
		gap: 10px;
		flex: 1 1 auto;
			min-height: 0;
			height: 100%;
			overflow: hidden;
		}

	.sr-md-viewer-root.sr-md-viewer-no-pdf .sr-md-viewer-shell {
		grid-template-columns: minmax(0, 1fr);
	}

	.sr-md-viewer-root.sr-md-viewer-no-pdf .sr-md-viewer-pdf-pane {
		display: none !important;
	}

		.sr-md-viewer-pane {
	display: flex;
	flex-direction: column;
	min-height: 0;
	min-width: 0;
	overflow: hidden;
}

	.sr-md-viewer-pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 10px;
		border-bottom: var(--sr-border-width) solid var(--sr-border);
		font-size: 12px;
		font-weight: 600;
	}

	.sr-md-viewer-pane-header-main {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1 1 auto;
	}

.sr-md-viewer-pane-body,
.sr-md-viewer-markdown-scroll {
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
}

.sr-md-viewer-pane-body {
	position: relative;
	display: flex;
	flex-direction: column;
	background: var(--sr-panel-alt);
	overflow: hidden;
}

.sr-md-viewer-pdf-host {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	overflow: hidden;
}

.sr-md-viewer-pdf-host browser {
	flex: 1 1 auto;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	min-height: 0;
	border: 0;
}

.sr-md-viewer-placeholder {
	display: flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	inset: 0;
	z-index: 1;
	padding: 18px;
	text-align: center;
	color: var(--sr-muted);
	background: var(--sr-panel-alt);
}

.sr-md-viewer-placeholder[hidden] {
	display: none !important;
}

.sr-md-viewer-markdown-scroll {
	overflow-x: scroll;
	overflow-y: auto;
	scrollbar-gutter: stable both-edges;
	padding: 12px;
	box-sizing: border-box;
	background: var(--sr-panel-alt);
	--sr-md-preview-scale: 1;
}

.sr-md-viewer-editor {
	display: block;
	width: 100%;
	height: 100%;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	padding: 12px;
	border: 0;
	outline: none;
	resize: none;
	box-sizing: border-box;
	background: var(--sr-input);
	color: var(--sr-fg);
	font: 13px/1.6 ui-monospace, "SFMono-Regular", Menlo, monospace;
	overflow: auto;
	scrollbar-gutter: stable both-edges;
}

.sr-md-viewer-editor[hidden],
.sr-md-viewer-markdown-scroll[hidden] {
	display: none !important;
}

.sr-simple-md-stack {
	display: flex;
	flex-direction: column;
	gap: 14px;
	width: max-content;
	min-width: calc(100% * var(--sr-md-preview-scale));
}

.sr-simple-md-page {
	width: calc(960px * var(--sr-md-preview-scale));
	max-width: none;
	border: var(--sr-border-width) solid var(--sr-border);
	background: #ffffff;
	color: #1d2024;
	box-shadow: none;
	font-size: calc(13px * var(--sr-md-preview-scale));
}

.sr-simple-md-page.is-active {
	border-color: var(--sr-accent);
	box-shadow: inset 0 0 0 1px var(--sr-accent-soft);
}

.sr-md-viewer-match {
	background: rgba(255, 221, 87, 0.45);
	outline: 1px solid rgba(201, 138, 0, 0.75);
	box-shadow: inset 0 0 0 1px rgba(201, 138, 0, 0.25);
}

.sr-simple-md-page-header {
	padding: 8px 12px;
	border-bottom: 1px solid #d4dae1;
	background: #f4f6f8;
	color: #5a6470;
	font-size: calc(11px * var(--sr-md-preview-scale));
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.sr-simple-md-page-body {
	padding: 16px 18px;
	font-family: Georgia, "Times New Roman", serif;
	font-size: inherit;
	line-height: 1.65;
	color: #1d2024;
}

.sr-simple-md-page-body h1,
.sr-simple-md-page-body h2,
.sr-simple-md-page-body h3,
.sr-simple-md-page-body h4,
.sr-simple-md-page-body h5,
.sr-simple-md-page-body h6 {
	margin: 1.05em 0 0.45em;
	line-height: 1.2;
	font-weight: 700;
}

.sr-simple-md-page-body h1:first-child,
.sr-simple-md-page-body h2:first-child,
.sr-simple-md-page-body h3:first-child {
	margin-top: 0;
}

.sr-simple-md-page-body h1 { font-size: 1.9em; }
.sr-simple-md-page-body h2 { font-size: 1.55em; }
.sr-simple-md-page-body h3 { font-size: 1.3em; }
.sr-simple-md-page-body h4 { font-size: 1.14em; }
.sr-simple-md-page-body h5 { font-size: 1.02em; }
.sr-simple-md-page-body h6 { font-size: 0.95em; }

.sr-simple-md-page-body p,
.sr-simple-md-page-body li {
	margin: 0 0 0.8em;
}

.sr-simple-md-page-body ul,
.sr-simple-md-page-body ol {
	padding-left: 1.5em;
}

.sr-simple-md-page-body img {
	max-width: 100%;
	height: auto;
	display: block;
}

.sr-simple-md-page-body pre {
	overflow-x: auto;
	overflow-y: auto;
	padding: 10px 12px;
	background: #f4f6f8;
	border: 1px solid #d4dae1;
	font-family: inherit;
	font-size: inherit;
	line-height: inherit;
	white-space: pre;
	overflow-wrap: normal;
	word-break: normal;
}

.sr-simple-md-page-body code {
	font-family: inherit;
	font-size: inherit;
	line-height: inherit;
	background: #f1f3f6;
	padding: 0.15em 0.35em;
}

.sr-simple-md-page-body pre code {
	background: transparent;
	padding: 0;
}

.sr-simple-md-table-scroll {
	overflow-x: auto;
	padding-bottom: 2px;
	margin: 12px 0 14px;
}

.sr-simple-md-table {
	width: 100%;
	min-width: max-content;
	border-collapse: collapse;
	table-layout: auto;
}

.sr-simple-md-table th,
.sr-simple-md-table td {
	border: 1px solid #cfd5dc;
	padding: 7px 9px;
	text-align: left;
	vertical-align: top;
	white-space: nowrap;
}

.sr-simple-md-table th[data-sr-align="center"],
.sr-simple-md-table td[data-sr-align="center"] {
	text-align: center;
}

.sr-simple-md-table th[data-sr-align="right"],
.sr-simple-md-table td[data-sr-align="right"] {
	text-align: right;
}

.sr-simple-md-table th {
	background: #f4f6f8;
	font-weight: 700;
}

	`;

var SQLITE_SCHEMA_VERSION = 5;
var SQLITE_FILENAME = "systematicreviewer.sqlite.db";
var CONTROL_SQLITE_FILENAME = "systematicreviewer.control.sqlite.db";
var PROJECT_TYPE_SYSTEMATIC_REVIEW = "systematic_review";
var PROJECT_TYPE_CUSTOM_ANALYSIS = "custom_analysis";
var CUSTOM_ANALYSIS_COLLECTION_NAME = "Data";
var CUSTOM_ANALYSIS_LEGACY_COLLECTION_NAME = "Systematic Review Custom Analysis";
var HARVEST_COLLECTION_NAME = "Harvest";
var HARVEST_OPENALEX_COLLECTION_NAME = "OpenAlex";
var HARVEST_ADDED_BY_USER_COLLECTION_NAME = "Added by user";
var DUPLICATES_COLLECTION_NAME = "Duplicates";
var PROJECT_ITEM_KIND_PROJECT = "project";
var PROJECT_ITEM_KIND_OUTPUTS = "outputs";
var OPENALEX_EXTRA_LABEL = "OpenAlex";
var PAPER_ID_EXTRA_LABEL = "Systematic Reviewer Paper ID";
var ABSTRACT_ORIGIN_EXTRA_LABEL = "Systematic Reviewer Abstract Origin";
var OPENALEX_API_BASE_URL = "https://api.openalex.org";
var DEFAULT_CITATION_STYLE_ID = "http://www.zotero.org/styles/apa";
var MIN_COMPLETE_ABSTRACT_LENGTH = 100;
var READER_HTML_URL = "resource://zotero/reader/reader.html";
var READER_PREVIEW_TIMEOUT_MS = 60000;
