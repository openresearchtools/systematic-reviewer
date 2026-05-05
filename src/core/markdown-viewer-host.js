var SystematicReviewerMarkdownViewerHost = {
	_markdownViewerReferenceData(raw, overrides = {}) {
		if (!raw) {
			return null;
		}
		let libraryID = Number(
			overrides.libraryID
			?? raw.libraryID
			?? raw.library_id
			?? raw.attachment?.libraryID
			?? raw.item?.libraryID
			?? 0
		) || 0;
		let attachmentKey = String(
			overrides.attachmentKey
			|| raw.attachmentKey
			|| raw.attachment_key
			|| raw.markdownAttachmentKey
			|| raw.markdown_attachment_key
			|| raw.attachment?.key
			|| raw.item?.key
			|| ""
		).trim();
		if (!libraryID || !attachmentKey) {
			return null;
		}
		return {
			libraryID,
			attachmentKey,
			parentItemKey: String(
				overrides.parentItemKey
				|| raw.parentItemKey
				|| raw.parent_item_key
				|| raw.parentItem?.key
				|| ""
			).trim(),
			pdfAttachmentKey: String(
				overrides.pdfAttachmentKey
				|| raw.pdfAttachmentKey
				|| raw.pdf_attachment_key
				|| raw.pdfAttachment?.key
				|| ""
				).trim(),
				highlightText: String(
					overrides.highlightText
					|| raw.highlightText
					|| raw.highlight_text
					|| ""
				).trim(),
				pdfSearchQuery: String(
					overrides.pdfSearchQuery
					|| raw.pdfSearchQuery
					|| raw.pdf_search_query
					|| ""
				).trim(),
				searchQuery: String(
					overrides.searchQuery
					|| raw.searchQuery
					|| raw.search_query
					|| ""
				).trim(),
				pageNumber: Number(
					overrides.pageNumber
					?? raw.pageNumber
					?? raw.page_number
					?? 0
				) || 0,
				title: String(
					overrides.title
					|| raw.title
				|| raw.attachmentTitle
				|| raw.attachment_title
				|| ""
			).trim(),
		};
	},

	_markdownViewerTabSpec(viewerRef = null) {
		let viewer = this._markdownViewerReferenceData(viewerRef) || null;
		let baseTitle = String(viewer?.title || "").trim() || "Markdown Viewer";
		return {
			id: viewer ? `${this.markdownViewerTabID}-${viewer.libraryID}-${viewer.attachmentKey}` : this.markdownViewerTabID,
			type: this.markdownViewerTabType,
			title: baseTitle,
			viewerRef: viewer,
		};
	},

	_findMarkdownViewerTab(win, viewerRef = null) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._markdownViewerTabSpec(viewerRef);
		let tab = null;
		try {
			if (typeof win.Zotero_Tabs._getTab == "function") {
				tab = win.Zotero_Tabs._getTab(spec.id)?.tab || null;
			}
		}
		catch (_err) {}
		if (!tab) {
			tab = win.Zotero_Tabs._tabs?.find((candidate) =>
				candidate.id == spec.id
				|| (
					candidate?.type == spec.type
					&& String(candidate?.data?.libraryID || candidate?.data?.library_id || "").trim() == String(spec.viewerRef?.libraryID || "")
					&& String(candidate?.data?.attachmentKey || candidate?.data?.attachment_key || "").trim() == String(spec.viewerRef?.attachmentKey || "")
				)
			) || null;
		}
		if (!tab) {
			return null;
		}
		let container = null;
		try {
			container = typeof win.Zotero_Tabs.getTabContent == "function"
				? win.Zotero_Tabs.getTabContent(tab.id)
				: win.document.getElementById(tab.id);
		}
		catch (_err) {}
		return container ? { id: tab.id, container, win, tab } : null;
	},

	_findMarkdownViewerTabAnywhere(viewerRef = null) {
		for (let win of this._mainWindows()) {
			let existing = this._findMarkdownViewerTab(win, viewerRef);
			if (existing) {
				return existing;
			}
		}
		return null;
	},

	async _openMarkdownViewerTab(targetWin = null, viewerRef = null) {
		let spec = this._markdownViewerTabSpec(viewerRef);
		if (!spec.viewerRef) {
			throw new Error("Markdown attachment reference is required.");
		}
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		if (!win) {
			throw new Error("No Zotero window is available");
		}
		if (!win.Zotero_Tabs || typeof win.Zotero_Tabs.add != "function") {
			throw new Error("Zotero tab workspace API is unavailable in this window");
		}
		let existing = targetWin
			? this._findMarkdownViewerTab(win, spec.viewerRef)
			: this._findMarkdownViewerTabAnywhere(spec.viewerRef);
		if (existing) {
			await this._mountMarkdownViewerTab(existing.win, existing.container, spec.viewerRef);
			existing.win.Zotero_Tabs.select(existing.id);
			existing.win.focus();
			return existing;
		}

		let tabRef = null;
		tabRef = win.Zotero_Tabs.add({
			id: spec.id,
			type: spec.type,
			title: spec.title,
			data: {
				pluginID: this.id,
				libraryID: spec.viewerRef.libraryID,
				attachmentKey: spec.viewerRef.attachmentKey,
				parentItemKey: spec.viewerRef.parentItemKey,
				pdfAttachmentKey: spec.viewerRef.pdfAttachmentKey,
				highlightText: spec.viewerRef.highlightText || "",
				pdfSearchQuery: spec.viewerRef.pdfSearchQuery || "",
				title: spec.viewerRef.title,
			},
			select: true,
			onClose: () => {
				let mount = tabRef?.container?._systematicReviewerMount || tabRef?.container;
				if (mount) {
					this._destroyController(mount);
				}
			},
		});
		await this._mountMarkdownViewerTab(win, tabRef.container, spec.viewerRef);
		return tabRef;
	},

	async _mountMarkdownViewerTab(win, container, viewerRef = null) {
		let doc = win?.document;
		if (!doc || !container) {
			throw new Error("Markdown viewer tab could not be mounted");
		}
		this._ensureMarkdownViewerStyles(doc);

		let mount = container._systematicReviewerMount;
		let mustRebuild = !mount || !mount.isConnected;
		if (!mustRebuild && mount._systematicReviewerInstanceToken !== this.instanceToken) {
			this._destroyController(mount);
			mustRebuild = true;
		}
			if (mustRebuild) {
				mount = this._html(doc, "div", { className: "sr-md-viewer-mount" });
				container.replaceChildren(mount);
				container._systematicReviewerMount = mount;
				mount._systematicReviewerInstanceToken = this.instanceToken;
		}
		let spec = this._markdownViewerTabSpec(viewerRef);
		mount._systematicReviewerTabID = spec.id;

		let controller = mount._systematicReviewerController;
		if (!controller) {
			controller = this._createMarkdownViewerController(doc, mount, { hostType: "tab" });
			mount._systematicReviewerController = controller;
			this.paneControllers.add(controller);
		}
		controller.viewerRef = spec.viewerRef;
		await this._refreshMarkdownViewerController(controller);
	},

	_ensureMarkdownViewerStyles(doc) {
		if (!doc || doc.getElementById("systematic-reviewer-markdown-viewer-style")) {
			return;
		}
		let style = doc.createElementNS(HTML_NS, "style");
		style.id = "systematic-reviewer-markdown-viewer-style";
		style.textContent = `
.sr-md-viewer-root.theme-dark {
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
.sr-md-viewer-root.theme-light {
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
.sr-md-viewer-root button,
.sr-md-viewer-root input,
.sr-md-viewer-root select,
	.sr-md-viewer-root textarea {
		font: inherit;
	}
	.sr-md-viewer-mount {
		display: flex;
		flex: 1 1 auto;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		background: transparent;
		overflow: hidden;
	}
	.sr-md-viewer-root .sr-workspace-btn {
	border: var(--sr-border-width) solid var(--sr-border-strong);
	border-radius: var(--sr-radius-sm);
	background: var(--sr-panel-alt);
	color: var(--sr-fg);
	padding: 3px 8px;
	min-height: 28px;
	font-size: 12px;
	cursor: pointer;
}
.sr-md-viewer-root .sr-workspace-btn:hover {
	border-color: var(--sr-accent);
}
.sr-md-viewer-root .sr-workspace-btn-primary {
	background: color-mix(in srgb, var(--sr-accent) 16%, var(--sr-panel-alt));
	border-color: color-mix(in srgb, var(--sr-accent) 55%, var(--sr-border-strong));
}
.sr-md-viewer-root .sr-workspace-btn[disabled] {
	opacity: 0.55;
	cursor: default;
}
.sr-md-viewer-root .sr-field-input {
	border: var(--sr-border-width) solid var(--sr-border-strong);
	border-radius: var(--sr-radius-sm);
	background: var(--sr-input);
	color: var(--sr-fg);
	padding: 4px 6px;
}
.sr-md-viewer-root .sr-workspace-status {
	display: inline-flex;
	align-items: center;
	justify-content: flex-start;
	inline-size: 10ch;
	max-inline-size: 10ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 11px;
	color: var(--sr-muted);
}
${SYSTEMATIC_REVIEWER_MARKDOWN_VIEWER_CSS}
.sr-md-viewer-shell {
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
}
`;
		doc.documentElement.appendChild(style);
	},

	_createMarkdownViewerController(doc, body, { hostType = "tab" } = {}) {
		let root = this._html(doc, "div", { className: "sr-md-viewer-root theme-dark" });
		let previewBtn = this._html(doc, "button", {
			className: "sr-workspace-btn sr-workspace-btn-primary",
			text: "Preview",
			attrs: { type: "button" },
		});
		let rawBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Edit",
			attrs: { type: "button" },
		});
		let saveBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Save",
			attrs: { type: "button" },
		});
		let status = this._html(doc, "div", {
			className: "sr-workspace-status sr-md-viewer-status",
			text: "Ready",
		});
		let pdfLabel = this._html(doc, "div", { text: "PDF" });
		let pdfZoomOutBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "-",
			attrs: { type: "button", title: "Zoom out PDF" },
		});
		let pdfZoomInBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "+",
			attrs: { type: "button", title: "Zoom in PDF" },
		});
		let pdfPageInput = this._html(doc, "input", {
			className: "sr-field-input sr-md-viewer-pdf-page",
			attrs: {
				type: "number",
				min: "1",
				step: "1",
				inputmode: "numeric",
				value: "1",
				"aria-label": "PDF page number",
			},
		});
		let pdfPageTotal = this._html(doc, "div", {
			className: "sr-md-viewer-pdf-page-total",
			text: "/ 0",
		});
		let pdfGoBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Go",
			attrs: { type: "button" },
		});
		let pdfFindBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Find",
			attrs: { type: "button", title: "Find text in PDF" },
		});
		let pdfSearchInput = this._html(doc, "input", {
			className: "sr-field-input sr-md-viewer-pdf-search",
			attrs: {
				type: "search",
				placeholder: "Find in PDF",
				"aria-label": "Find text in PDF",
			},
		});
		let pdfFindPrevBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Prev",
			attrs: { type: "button", title: "Find previous match" },
		});
		let pdfFindNextBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Next",
			attrs: { type: "button", title: "Find next match" },
		});
		let pdfFindCloseBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Close",
			attrs: { type: "button", title: "Close search" },
		});
		let pdfFindBar = this._html(doc, "div", {
			className: "sr-md-viewer-findbar",
			attrs: { hidden: "hidden" },
			children: [pdfSearchInput, pdfFindPrevBtn, pdfFindNextBtn, pdfFindCloseBtn],
		});
		let pdfHeader = this._html(doc, "div", {
			className: "sr-md-viewer-pane-header",
			children: [
				this._html(doc, "div", {
					className: "sr-md-viewer-pane-header-main",
					children: [pdfLabel],
				}),
				this._html(doc, "div", {
					className: "sr-md-viewer-header-tools",
					children: [pdfZoomOutBtn, pdfZoomInBtn, pdfPageInput, pdfPageTotal, pdfGoBtn, pdfFindBtn, pdfFindBar],
				}),
			],
		});
		let pdfHost = this._html(doc, "div", { className: "sr-md-viewer-pdf-host" });
		let pdfPlaceholder = this._html(doc, "div", {
			className: "sr-md-viewer-placeholder",
			text: "No associated PDF is available for this markdown attachment.",
		});
		let pdfPaneBody = this._html(doc, "div", {
			className: "sr-md-viewer-pane-body",
			children: [pdfHost, pdfPlaceholder],
		});
		let pdfPane = this._html(doc, "section", {
			className: "sr-md-viewer-pane sr-md-viewer-pdf-pane",
			children: [pdfHeader, pdfPaneBody],
		});
		let mdLabel = this._html(doc, "div", { text: "Markdown" });
		let mdZoomOutBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "-",
			attrs: { type: "button", title: "Zoom out markdown" },
		});
		let mdZoomInBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "+",
			attrs: { type: "button", title: "Zoom in markdown" },
		});
		let mdHeader = this._html(doc, "div", {
			className: "sr-md-viewer-pane-header",
			children: [
					this._html(doc, "div", {
						className: "sr-md-viewer-pane-header-main",
						children: [mdLabel],
					}),
				this._html(doc, "div", {
					className: "sr-md-viewer-header-tools sr-md-viewer-header-tools-end",
					children: [mdZoomOutBtn, mdZoomInBtn, previewBtn, rawBtn, saveBtn, status],
				}),
			],
		});
		let markdownPreview = this._html(doc, "div", { className: "sr-md-viewer-markdown-scroll" });
		let rawEditor = this._html(doc, "textarea", {
			className: "sr-md-viewer-editor",
			attrs: { spellcheck: "false", hidden: "hidden", wrap: "off" },
		});
		let markdownPane = this._html(doc, "section", {
			className: "sr-md-viewer-pane sr-md-viewer-markdown-pane",
			children: [
				mdHeader,
				this._html(doc, "div", {
					className: "sr-md-viewer-pane-body",
					children: [markdownPreview, rawEditor],
				}),
			],
		});
		let shell = this._html(doc, "div", {
			className: "sr-md-viewer-shell",
			children: [pdfPane, markdownPane],
		});

		root.append(shell);
		body.replaceChildren(root);

			let controller = {
				kind: "markdown-viewer",
			hostType,
			doc,
			body,
			root,
			viewerRef: null,
			mode: "preview",
			documentPath: "",
			lastSavedMarkdown: "",
			markdownZoomPercent: 100,
			dirty: false,
			saving: false,
				currentPageNumber: 1,
				highlightText: "",
				pdfSearchQuery: "",
				lastPdfSearchQuery: "",
				pdfPresentationMode: "fit-width",
			pdfCustomScale: 0,
			suppressMarkdownSyncUntil: 0,
			suppressPdfSyncUntil: 0,
			pdfHandle: null,
			instanceToken: this.instanceToken,
			refresh: () => this._refreshMarkdownViewerController(controller),
			els: {
				previewBtn,
				rawBtn,
				saveBtn,
				status,
				shell,
				pdfPane,
				markdownPane,
				pdfLabel,
				pdfZoomOutBtn,
				pdfZoomInBtn,
				pdfPageInput,
				pdfPageTotal,
				pdfGoBtn,
				pdfFindBtn,
				pdfFindBar,
				pdfSearchInput,
				pdfFindPrevBtn,
				pdfFindNextBtn,
					pdfFindCloseBtn,
					pdfHost,
					pdfPlaceholder,
					markdownPreview,
				mdZoomOutBtn,
				mdZoomInBtn,
				rawEditor,
			},
		};

		previewBtn.addEventListener("click", () => {
			this._setMarkdownViewerMode(controller, "preview");
		});
		rawBtn.addEventListener("click", () => {
			this._setMarkdownViewerMode(controller, "raw");
		});
		saveBtn.addEventListener("click", () => {
			this._saveMarkdownViewer(controller).catch((error) => this._showError(error));
		});
		pdfZoomOutBtn.addEventListener("click", () => {
			this._adjustMarkdownViewerPdfZoom(controller, -1).catch((error) => this._showError(error));
		});
		pdfZoomInBtn.addEventListener("click", () => {
			this._adjustMarkdownViewerPdfZoom(controller, 1).catch((error) => this._showError(error));
		});
		pdfGoBtn.addEventListener("click", () => {
			this._goMarkdownViewerPdfToRequestedPage(controller).catch((error) => this._showError(error));
		});
		pdfPageInput.addEventListener("keydown", (event) => {
			if (event.key == "Enter") {
				event.preventDefault();
				this._goMarkdownViewerPdfToRequestedPage(controller).catch((error) => this._showError(error));
			}
		});
		pdfFindBtn.addEventListener("click", () => {
			this._openMarkdownViewerPdfNativeFind(controller).catch((error) => this._showError(error));
		});
		pdfSearchInput.addEventListener("input", () => {
			controller.lastPdfSearchQuery = "";
			this._scheduleMarkdownViewerPdfSearch(controller);
		});
		pdfSearchInput.addEventListener("keydown", (event) => {
			if (event.key == "Enter") {
				event.preventDefault();
				this._runMarkdownViewerPdfFind(controller, {
					query: pdfSearchInput.value || "",
					direction: event.shiftKey ? "prev" : "next",
				}).catch((error) => this._showError(error));
			}
			else if (event.key == "Escape") {
				event.preventDefault();
				controller.pdfSearchQuery = "";
				controller.lastPdfSearchQuery = "";
				pdfSearchInput.value = "";
				this._dispatchMarkdownViewerPdfSearch(controller, "", { direction: "next", repeat: false, highlightAll: false });
				this._clearMarkdownViewerPdfSearchHighlights(controller);
				this._setMarkdownViewerPdfSearchUIVisible(controller, false);
				pdfFindBtn.focus();
			}
		});
		pdfFindPrevBtn.addEventListener("click", () => {
			this._runMarkdownViewerPdfFind(controller, {
				query: pdfSearchInput.value || "",
				direction: "prev",
			}).catch((error) => this._showError(error));
		});
		pdfFindNextBtn.addEventListener("click", () => {
			this._runMarkdownViewerPdfFind(controller, {
				query: pdfSearchInput.value || "",
				direction: "next",
			}).catch((error) => this._showError(error));
		});
		pdfFindCloseBtn.addEventListener("click", () => {
			controller.pdfSearchQuery = "";
			controller.lastPdfSearchQuery = "";
			pdfSearchInput.value = "";
			this._dispatchMarkdownViewerPdfSearch(controller, "", { direction: "next", repeat: false, highlightAll: false });
			this._clearMarkdownViewerPdfSearchHighlights(controller);
			this._setMarkdownViewerPdfSearchUIVisible(controller, false);
			pdfFindBtn.focus();
		});
		mdZoomOutBtn.addEventListener("click", () => {
			this._adjustMarkdownViewerMarkdownZoom(controller, -10);
		});
			mdZoomInBtn.addEventListener("click", () => {
				this._adjustMarkdownViewerMarkdownZoom(controller, 10);
			});
			markdownPreview.addEventListener("scroll", () => {
				this._handleMarkdownViewerPreviewScroll(controller);
			}, { passive: true });
		rawEditor.addEventListener("input", () => {
			controller.dirty = rawEditor.value !== controller.lastSavedMarkdown;
			this._setMarkdownViewerStatus(
				controller,
				controller.dirty ? "Unsaved changes" : "Saved",
				controller.dirty ? "" : "ready"
			);
		});
		rawEditor.addEventListener("keydown", (event) => {
			if ((event.metaKey || event.ctrlKey) && String(event.key || "").toLowerCase() == "s") {
				event.preventDefault();
				this._saveMarkdownViewer(controller).catch((error) => this._showError(error));
			}
		});
		root.addEventListener("keydown", (event) => {
			let key = String(event.key || "").toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key == "f") {
				event.preventDefault();
				this._openMarkdownViewerPdfNativeFind(controller).catch((error) => this._showError(error));
			}
		}, true);
		this._applyMarkdownViewerMarkdownZoom(controller);
		this._updateMarkdownViewerPdfControls(controller);
		return controller;
	},

	async _refreshMarkdownViewerController(controller) {
		let hadBootstrap = !!controller.bootstrap;
		if (!hadBootstrap) {
			this._setMarkdownViewerStatus(controller, "Loading markdown...");
		}
		try {
			let payload = await this._buildMarkdownViewerPayload(controller?.viewerRef || null);
			controller.bootstrap = payload;
			controller.viewerRef = this._markdownViewerReferenceData(payload.viewer_ref || controller.viewerRef || null);
			this._applyMarkdownViewerPayload(controller, payload);
			if (!hadBootstrap) {
				this._setMarkdownViewerStatus(controller, "Ready", "ready");
			}
		}
		catch (error) {
			this._setMarkdownViewerStatus(controller, "Viewer failed", "error");
			this._setMarkdownViewerHostTitle(controller, "Markdown Viewer");
			controller.els.markdownPreview.innerHTML =
				`<div class="sr-workspace-empty">${this._escapeHTML(error?.message || String(error))}</div>`;
			controller.els.rawEditor.value = "";
			this._cleanupMarkdownViewerPdfHandle(controller);
			controller.els.pdfPlaceholder.hidden = false;
			controller.els.pdfPlaceholder.textContent = "PDF preview is unavailable.";
		}
	},

	async _buildMarkdownViewerPayload(viewerRef = null) {
		let ref = this._markdownViewerReferenceData(viewerRef);
		if (!ref) {
			throw new Error("Markdown attachment reference is missing.");
		}
		let attachment = Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.attachmentKey);
		if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
			throw new Error("Markdown attachment could not be found in Zotero.");
		}
		let markdownPath = attachment.getFilePathAsync
			? await attachment.getFilePathAsync()
			: (attachment.getFilePath ? attachment.getFilePath() : "");
		if (!markdownPath) {
			throw new Error("Markdown attachment file was not found on disk.");
		}
		let markdown = await this._readFileText(markdownPath);
		let parentItem = attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : null;
		let pdfAttachment = this._findSiblingPDFAttachment(parentItem, attachment.key || "");
			let attachmentTitle = this._itemField(attachment, "title") || this._leafName(markdownPath);
			let windowTitle = `${attachmentTitle || "Markdown"} - Systematic Reviewer`;
			return {
				viewer_ref: {
					libraryID: ref.libraryID,
					attachmentKey: attachment.key || ref.attachmentKey,
					parentItemKey: parentItem?.key || ref.parentItemKey || "",
					pdfAttachmentKey: pdfAttachment?.key || "",
					highlightText: ref.highlightText || "",
					pdfSearchQuery: ref.pdfSearchQuery || ref.highlightText || "",
					searchQuery: ref.searchQuery || "",
					pageNumber: Number(ref.pageNumber || 0) || 0,
					title: windowTitle,
				},
			attachment,
			parent_item: parentItem,
				parent_title: parentItem ? this._itemField(parentItem, "title") : "",
			attachment_title: attachmentTitle,
			markdown_path: markdownPath,
			markdown,
				pdf_attachment: pdfAttachment,
				highlight_text: ref.highlightText || "",
				pdf_search_query: ref.pdfSearchQuery || ref.highlightText || "",
				page_number: Number(ref.pageNumber || 0) || 0,
				window_title: windowTitle,
			path_line: pdfAttachment
				? `${markdownPath} | PDF: ${this._itemField(pdfAttachment, "title") || this._leafName(pdfAttachment.getFilePath?.() || "")}`
				: markdownPath,
		};
	},

	async _setMarkdownViewerHostTitle(controller, title) {
		let nextTitle = String(title || "Markdown Viewer");
		try {
			controller.doc.title = nextTitle;
		}
		catch (_err) {}
		try {
			let win = controller?.doc?.defaultView;
			let tabID = controller?.body?._systematicReviewerTabID;
			if (tabID && win?.Zotero_Tabs?.rename) {
				await win.Zotero_Tabs.rename(tabID, nextTitle);
			}
		}
		catch (_err) {}
	},

	_setMarkdownViewerStatus(controller, text, tone = "") {
		if (!controller?.els?.status) {
			return;
		}
		controller.els.status.textContent = String(text || "Ready");
		controller.els.status.classList.remove("ready", "error");
		if (tone) {
			controller.els.status.classList.add(tone);
		}
	},

	_highlightMarkdownViewerPage(controller, pageNumber = 1) {
		for (let page of Array.from(controller.els.markdownPreview.querySelectorAll(".sr-simple-md-page"))) {
			page.classList.toggle(
				"is-active",
				Number(page.getAttribute("data-sr-page-index") || 0) == Number(pageNumber || 0)
			);
		}
	},

	_handleMarkdownViewerPreviewScroll(controller) {
		if (!controller?.els?.markdownPreview) {
			return;
		}
		if (Date.now() < (controller.suppressMarkdownSyncUntil || 0)) {
			return;
		}
		let nextPage = this._visibleMarkdownViewerPage(controller);
		if (!nextPage || nextPage == controller.currentPageNumber) {
			return;
		}
		controller.currentPageNumber = nextPage;
		this._highlightMarkdownViewerPage(controller, nextPage);
		this._syncPdfFromMarkdownViewer(controller, nextPage);
	},

	_visibleMarkdownViewerPage(controller) {
		let viewport = controller?.els?.markdownPreview;
		if (!viewport) {
			return 1;
		}
		let viewportRect = viewport.getBoundingClientRect();
		let bestPage = 1;
		let bestRatio = -1;
		for (let page of Array.from(viewport.querySelectorAll(".sr-simple-md-page"))) {
			let rect = page.getBoundingClientRect();
			let height = Math.max(rect.height, 1);
			let visible = Math.max(0, Math.min(rect.bottom, viewportRect.bottom) - Math.max(rect.top, viewportRect.top));
			let ratio = visible / height;
			if (ratio > bestRatio) {
				bestRatio = ratio;
				bestPage = Number(page.getAttribute("data-sr-page-index") || 1) || 1;
			}
		}
		return bestPage;
	},

	_syncPdfFromMarkdownViewer(controller, pageNumber = 1) {
		if (!this._markdownViewerPdfReady(controller)) {
			return;
		}
		controller.suppressPdfSyncUntil = Date.now() + 450;
		this._navigateMarkdownViewerPdf(controller, pageNumber).catch((error) => {
			this.log(`markdown viewer PDF sync failed: ${error}`);
		});
	},

	_syncMarkdownViewerFromPdf(controller, pageNumber = 1) {
		controller.suppressMarkdownSyncUntil = Date.now() + 450;
		controller.currentPageNumber = Math.max(1, Number(pageNumber || 1) || 1);
		this._highlightMarkdownViewerPage(controller, controller.currentPageNumber);
		this._scrollMarkdownViewerToPage(controller, controller.currentPageNumber);
		this._updateMarkdownViewerPdfControls(controller);
		this._updateMarkdownViewerHorizontalScrollControls(controller);
	},

	_scrollMarkdownViewerToPage(controller, pageNumber = 1) {
		let viewport = controller?.els?.markdownPreview;
		if (!viewport) {
			return;
		}
		let target = viewport.querySelector(`.sr-simple-md-page[data-sr-page-index="${CSS.escape(String(pageNumber))}"]`);
		if (!target) {
			return;
		}
		let viewportRect = viewport.getBoundingClientRect();
		let targetRect = target.getBoundingClientRect();
		let offsetTop = viewport.scrollTop + (targetRect.top - viewportRect.top);
		viewport.scrollTo({
			top: Math.max(0, offsetTop - 6),
			behavior: "smooth",
		});
	},

	_isLocalAbsolutePathLike(value = "") {
		let raw = String(value || "").trim();
		return /^[A-Za-z]:[\\/]/.test(raw)
			|| /^\\\\[^\\]+\\[^\\]+/.test(raw)
			|| /^\/[A-Za-z]:[\\/]/.test(raw);
	},

	_resolveMarkdownViewerAssetURL(controller, rawPath) {
		let source = String(rawPath || "").trim();
		if (!source) {
			return "";
		}
		if (/^(?:[a-z]+:|\/\/)/i.test(source) && !this._isLocalAbsolutePathLike(source)) {
			return source;
		}
		let documentPath = controller?.documentPath || "";
		if (!documentPath) {
			return source;
		}
		try {
			let absolutePath = this._joinPath(this._parentPath(documentPath), source);
			return Services.io.newFileURI(this._nsIFile(absolutePath)).spec;
		}
		catch (_err) {
			return source;
		}
	},

	_findSiblingPDFAttachment(parentItem, excludeKey = "") {
		if (!parentItem?.getAttachments) {
			return null;
		}
		for (let attachmentID of parentItem.getAttachments() || []) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
				continue;
			}
			if (excludeKey && attachment.key == excludeKey) {
				continue;
			}
			let contentType = String(attachment.attachmentContentType || "").toLowerCase();
			let filePath = String(attachment.getFilePath ? attachment.getFilePath() || "" : "").toLowerCase();
			if (contentType == "application/pdf" || filePath.endsWith(".pdf")) {
				return attachment;
			}
		}
		return null;
	},

	_createMarkdownViewerBrowser(win, host) {
		if (!win?.document?.createXULElement || !host) {
			throw new Error("Markdown viewer PDF host is unavailable.");
		}
		let browser = win.document.createXULElement("browser");
		browser.setAttribute("class", "reader");
		browser.setAttribute("flex", "1");
		browser.setAttribute("type", "content");
		browser.setAttribute("primary", "true");
		browser.setAttribute("transparent", "true");
		browser.setAttribute("remote", "false");
		browser.setAttribute("tooltip", "html-tooltip");
		browser.setAttribute("src", READER_HTML_URL);
		browser.style.flex = "1";
		browser.style.width = "100%";
		browser.style.minHeight = "0";
		browser.style.border = "0";
		host.replaceChildren(browser);
		return browser;
	},

	_waitForBrowserLoad(browser, expectedURL = READER_HTML_URL, timeoutMs = READER_PREVIEW_TIMEOUT_MS) {
		let ownerWindow = browser?.ownerGlobal || browser?.ownerDocument?.defaultView || null;
		return new Promise((resolve, reject) => {
			let settled = false;
			let finish = (error) => {
				if (settled) {
					return;
				}
				settled = true;
				try {
					browser?.removeEventListener?.("load", onLoad, true);
				}
				catch (_err) {}
				if (timer != null && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				if (error) {
					reject(error);
					return;
				}
				resolve();
			};
			let onLoad = () => {
				try {
					let currentURL = browser?.contentWindow?.location?.href || browser?.currentURI?.spec || "";
					let readyState = browser?.contentDocument?.readyState || "";
					if ((!expectedURL || currentURL == expectedURL || String(currentURL).startsWith(expectedURL)) && readyState == "complete") {
						finish(null);
					}
				}
				catch (_err) {}
			};
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => finish(new Error("Timed out waiting for the embedded PDF reader to load.")), timeoutMs)
				: null;
			try {
				let currentURL = browser?.contentWindow?.location?.href || browser?.currentURI?.spec || "";
				let readyState = browser?.contentDocument?.readyState || "";
				if ((!expectedURL || currentURL == expectedURL || String(currentURL).startsWith(expectedURL)) && readyState == "complete") {
					finish(null);
					return;
				}
			}
			catch (_err) {}
			browser.addEventListener("load", onLoad, true);
		});
	},

	_waitForMarkdownViewerPDFJSReady(browser, timeoutMs = READER_PREVIEW_TIMEOUT_MS) {
		let ownerWindow = browser?.ownerGlobal || browser?.ownerDocument?.defaultView || Zotero.getMainWindow?.() || null;
		return new Promise((resolve, reject) => {
			let settled = false;
			let finish = (error, payload = null) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer != null && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				if (error) {
					reject(error);
					return;
				}
				resolve(payload);
			};
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => finish(new Error("Timed out waiting for the embedded PDF viewer.")), timeoutMs)
				: null;
			let poll = () => {
				try {
					let readerWindow = browser?.contentWindow || null;
					let pdfDocument = readerWindow?.PDFViewerApplication?.pdfDocument || null;
					if (readerWindow && pdfDocument) {
						finish(null, { readerWindow, pdfDocument });
						return;
					}
				}
				catch (_err) {}
				if (!settled && ownerWindow?.setTimeout) {
					ownerWindow.setTimeout(poll, 50);
				}
			};
			poll();
		});
	},

	_injectMarkdownViewerPDFBrowserStyles(readerWindow = null) {
		let doc = readerWindow?.document || null;
		if (!doc || doc.getElementById("sr-md-viewer-pdf-browser-style")) {
			return;
		}
		let style = doc.createElement("style");
		style.id = "sr-md-viewer-pdf-browser-style";
		style.textContent = `
#toolbarContainer,
#secondaryToolbar,
#sidebarContainer,
#editorModeButtons,
#editorModeSeparator,
#toolbarSidebar,
#toolbarViewerMiddle,
#toolbarViewerRight,
#findbar {
	display: none !important;
}
#outerContainer.sidebarOpen #viewerContainer,
#outerContainer #viewerContainer {
	top: 0 !important;
	inset-inline-start: 0 !important;
}
#viewerContainer {
	overflow: auto !important;
	scrollbar-gutter: stable both-edges;
}
.pdfViewer .page {
	position: relative;
}
.sr-md-viewer-pdf-search-overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 6;
}
.sr-md-viewer-pdf-search-hit {
	position: absolute;
	border-radius: 2px;
	transform-origin: 0 0;
	background: rgba(255, 230, 96, 0.35);
	box-shadow: inset 0 0 0 1px rgba(255, 208, 0, 0.4);
}
.sr-md-viewer-pdf-search-hit.is-selected {
	background: rgba(255, 191, 0, 0.55);
	box-shadow: inset 0 0 0 1px rgba(255, 145, 0, 0.7);
}
`;
		doc.head?.appendChild(style);
	},

	_updateMarkdownViewerPdfPresentation(controller, reader = null) {
		reader = reader || controller?.pdfHandle?.reader || null;
		let app = controller?.pdfHandle?.readerWindow?.PDFViewerApplication
			|| reader?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication
			|| null;
		let viewer = app?.pdfViewer || null;
		let doc = controller?.pdfHandle?.readerWindow?.document
			|| reader?._internalReader?._primaryView?._iframeWindow?.document
			|| null;
		let viewerContainer = doc?.getElementById?.("viewerContainer") || null;
		if (!viewer) {
			return false;
		}
		try {
			if (controller?.pdfPresentationMode == "custom" && Number(controller?.pdfCustomScale || 0) > 0) {
				viewer.currentScale = Number(controller.pdfCustomScale);
			}
			else {
				viewer.currentScaleValue = "page-width";
			}
		}
		catch (_err) {}
		try {
			viewer.scrollMode = 0;
		}
		catch (_err) {}
		try {
			if (viewerContainer) {
				viewerContainer.style.overflow = "auto";
				viewerContainer.style.scrollbarGutter = "stable both-edges";
				viewerContainer.style.scrollbarWidth = "auto";
			}
		}
		catch (_err) {}
		return true;
	},

	_enableMarkdownViewerPdfTextLayer(readerWindow = null) {
		let viewer = readerWindow?.PDFViewerApplication?.pdfViewer || null;
		if (!viewer) {
			return false;
		}
		let changed = false;
		try {
			if ("textLayerMode" in viewer && viewer.textLayerMode !== 1) {
				viewer.textLayerMode = 1;
				changed = true;
			}
		}
		catch (_err) {}
		try {
			if ("_textLayerMode" in viewer && viewer._textLayerMode !== 1) {
				viewer._textLayerMode = 1;
				changed = true;
			}
		}
		catch (_err) {}
		if (!changed) {
			return false;
		}
		try {
			viewer.refresh?.();
		}
		catch (_err) {}
		try {
			viewer.update?.();
		}
		catch (_err) {}
		return true;
	},

	async _loadMarkdownViewerPdfPreview(controller, pdfAttachment = null) {
		if (!controller?.els?.pdfHost) {
			return;
		}
		if (!pdfAttachment) {
			this._cleanupMarkdownViewerPdfHandle(controller);
			controller.els.pdfPlaceholder.hidden = false;
			controller.els.pdfPlaceholder.textContent = "No associated PDF is available for this markdown attachment.";
			this._updateMarkdownViewerPdfControls(controller);
			return;
		}
		if (controller.pdfHandle?.attachmentID == pdfAttachment.id && this._markdownViewerPdfReady(controller)) {
			controller.els.pdfPlaceholder.hidden = true;
			this._updateMarkdownViewerPdfControls(controller);
			return;
		}
		this._cleanupMarkdownViewerPdfHandle(controller);
		let win = controller.doc.defaultView;
		let browser = this._createMarkdownViewerBrowser(win, controller.els.pdfHost);
		let pdfPath = pdfAttachment.getFilePathAsync
			? await pdfAttachment.getFilePathAsync()
			: (pdfAttachment.getFilePath ? pdfAttachment.getFilePath() : "");
		if (!pdfPath) {
			throw new Error(`PDF file was not found for ${pdfAttachment.key || pdfAttachment.id}`);
		}
		let pdfURL = Services.io.newFileURI(this._nsIFile(pdfPath)).spec;
		controller.els.pdfPlaceholder.hidden = false;
		controller.els.pdfPlaceholder.textContent = "Loading PDF preview...";
		await this._waitForBrowserLoad(browser, READER_HTML_URL);
		let reader = await Zotero.Reader.openPreview(pdfAttachment.id, browser);
		let opened = await reader._open({});
		if (!opened) {
			throw new Error(`Embedded PDF preview failed to open for ${pdfAttachment.key || pdfAttachment.id}`);
		}
		let readerWindow = reader?._internalReader?._primaryView?._iframeWindow || null;
		if (!readerWindow?.PDFViewerApplication) {
			throw new Error("Embedded PDF.js application was not available.");
		}
		await readerWindow.PDFViewerApplication?.pdfViewer?.firstPagePromise;
		this._injectMarkdownViewerPDFBrowserStyles(readerWindow);
		controller.pdfHandle = {
			browser,
			reader,
			readerWindow,
			attachmentID: pdfAttachment.id,
			attachmentKey: pdfAttachment.key || "",
			pageHandler: null,
			scrollHandler: null,
		};
		this._updateMarkdownViewerPdfPresentation(controller, null);
		this._attachMarkdownViewerPdfEvents(controller);
			controller.els.pdfPlaceholder.hidden = true;
			controller.els.pdfPlaceholder.textContent = "";
			this._updateMarkdownViewerPdfControls(controller);
			this._updateMarkdownViewerHorizontalScrollControls(controller);
			if (controller.pdfSearchQuery) {
				this._runMarkdownViewerPdfFind(controller, {
					query: controller.pdfSearchQuery,
					direction: "next",
				}).catch(() => {});
			}
			if ((controller.currentPageNumber || 1) > 1) {
				this._syncPdfFromMarkdownViewer(controller, controller.currentPageNumber || 1);
			}
		},

	_attachMarkdownViewerPdfEvents(controller) {
		let handle = controller?.pdfHandle;
		let eventBus = handle?.readerWindow?.PDFViewerApplication?.eventBus || null;
		if (!handle || !eventBus || typeof eventBus.on != "function") {
			return;
		}
		handle.pageHandler = (event = {}) => {
			if (Date.now() < (controller.suppressPdfSyncUntil || 0)) {
				return;
			}
			let pageNumber = Number(event.pageNumber || handle.readerWindow?.PDFViewerApplication?.page || 1) || 1;
			this._updateMarkdownViewerPdfControls(controller);
			this._updateMarkdownViewerHorizontalScrollControls(controller);
			if (controller?.pdfSearchQuery) {
				this._renderMarkdownViewerPdfSearchHighlights(controller).catch(() => {});
			}
			if (pageNumber == controller.currentPageNumber) {
				return;
			}
			this._syncMarkdownViewerFromPdf(controller, pageNumber);
		};
		eventBus.on("pagechanging", handle.pageHandler);
		let pdfScroller = this._markdownViewerPdfScrollContainer(controller);
		if (pdfScroller?.addEventListener) {
			handle.scrollHandler = () => {
				this._updateMarkdownViewerHorizontalScrollControls(controller);
			};
			pdfScroller.addEventListener("scroll", handle.scrollHandler, { passive: true });
		}
	},

	_cleanupMarkdownViewerPdfHandle(controller) {
		let handle = controller?.pdfHandle || null;
		controller.pdfSearchHighlightToken = "";
		this._clearMarkdownViewerPdfSearchHighlights(controller);
		if (!handle) {
			return;
		}
		try {
			let eventBus = handle.readerWindow?.PDFViewerApplication?.eventBus || null;
			if (handle.pageHandler && eventBus && typeof eventBus.off == "function") {
				eventBus.off("pagechanging", handle.pageHandler);
			}
		}
		catch (_err) {}
		try {
			let pdfScroller = handle.readerWindow?.document?.getElementById?.("viewerContainer") || null;
			if (handle.scrollHandler && pdfScroller?.removeEventListener) {
				pdfScroller.removeEventListener("scroll", handle.scrollHandler, { passive: true });
			}
		}
		catch (_err) {}
		try {
			handle.reader?.uninit?.();
		}
		catch (_err) {}
		try {
			handle.browser?.remove?.();
		}
		catch (_err) {}
		controller.pdfHandle = null;
		this._updateMarkdownViewerPdfControls(controller);
	},

	_isMarkdownAttachmentItem(item) {
		if (!item || item.deleted || !item.isAttachment?.()) {
			return false;
		}
		let contentType = String(item.attachmentContentType || "").toLowerCase();
		if (contentType == "text/markdown" || contentType == "text/x-markdown") {
			return true;
		}
		let filePath = String(item.getFilePath ? item.getFilePath() || "" : "").toLowerCase();
		return filePath.endsWith(".md") || filePath.endsWith(".markdown");
	},

	async _maybeOpenMarkdownAttachmentViewer(item, _params = {}) {
		if (!this._isMarkdownAttachmentItem(item)) {
			return false;
		}
		if (typeof this._openMarkdownAttachmentBestViewer != "function") {
			return false;
		}
		await this._openMarkdownAttachmentBestViewer(null, {
				libraryID: item.libraryID,
				attachmentKey: item.key || "",
				parentItemKey: item.parentItem?.key || "",
				title: `${this._itemField(item, "title") || item.key || "Markdown"} - Systematic Reviewer`,
			});
		return true;
	},

	async openMarkdownAttachmentViewer({ libraryID = 0, attachmentKey = "", attachment_key = "" } = {}) {
		let nextLibraryID = Number(libraryID || 0) || Zotero.Libraries.userLibraryID;
		let nextAttachmentKey = String(attachmentKey || attachment_key || "").trim();
		if (!nextAttachmentKey) {
			throw new Error("attachment_key is required.");
		}
		return await this._openMarkdownViewerTab(null, {
			libraryID: nextLibraryID,
			attachmentKey: nextAttachmentKey,
		});
	},

	async _saveMarkdownViewer(controller) {
		if (!controller?.documentPath) {
			throw new Error("Markdown file path is unavailable.");
		}
		let nextMarkdown = controller.els.rawEditor.value || "";
		controller.saving = true;
		this._setMarkdownViewerStatus(controller, "Saving...");
		try {
			await this._writeTextFile(controller.documentPath, nextMarkdown);
			controller.lastSavedMarkdown = nextMarkdown;
			controller.dirty = false;
			this._renderMarkdownViewerPreview(controller, nextMarkdown);
			this._setMarkdownViewerStatus(controller, "Saved", "ready");
			if (controller.mode == "preview") {
				controller.els.rawEditor.value = nextMarkdown;
			}
		}
		finally {
			controller.saving = false;
		}
	},

		_applyMarkdownViewerPayload(controller, payload) {
			this._applyControllerTheme(controller);
			this._setMarkdownViewerHostTitle(controller, payload.window_title || "Markdown Viewer");
			let hasPDF = !!payload.pdf_attachment;
			controller.root?.classList?.toggle?.("sr-md-viewer-no-pdf", !hasPDF);
			if (controller.els.pdfPane) {
				controller.els.pdfPane.hidden = !hasPDF;
			}
			controller.els.pdfLabel.textContent = "PDF";
			controller.highlightText = String(payload.highlight_text || payload.viewer_ref?.highlightText || "").trim();
			controller.searchQuery = String(payload.viewer_ref?.searchQuery || payload.search_query || "").trim();
			controller.highlightTerms = controller.searchQuery || controller.highlightText || "";
			controller.pdfSearchQuery = String(payload.pdf_search_query || payload.viewer_ref?.pdfSearchQuery || controller.highlightText || "").trim();
			let requestedPage = Number(payload.viewer_ref?.pageNumber || payload.page_number || 0) || 0;
			if (requestedPage > 0) {
				controller.currentPageNumber = requestedPage;
			}
			controller.lastPdfSearchQuery = "";
			let markdownChanged =
			controller.documentPath != payload.markdown_path
			|| (!controller.dirty && controller.lastSavedMarkdown !== payload.markdown);
		controller.documentPath = payload.markdown_path || "";
		if (markdownChanged || !controller.lastSavedMarkdown) {
			controller.lastSavedMarkdown = payload.markdown || "";
			if (!controller.dirty) {
				controller.els.rawEditor.value = payload.markdown || "";
			}
			this._renderMarkdownViewerPreview(controller, payload.markdown || "");
		}

			if (hasPDF) {
				this._loadMarkdownViewerPdfPreview(controller, payload.pdf_attachment || null).catch((error) => {
					this._cleanupMarkdownViewerPdfHandle(controller);
					controller.els.pdfPlaceholder.hidden = false;
					controller.els.pdfPlaceholder.textContent = `Could not load PDF preview: ${error?.message || String(error)}`;
				});
			}
			else {
				this._cleanupMarkdownViewerPdfHandle(controller);
				controller.els.pdfPlaceholder.hidden = false;
				controller.els.pdfPlaceholder.textContent = "No associated PDF is available for this markdown attachment.";
				this._updateMarkdownViewerPdfControls(controller);
				this._updateMarkdownViewerHorizontalScrollControls(controller);
			}
	},

		_setMarkdownViewerMode(controller, mode = "preview") {
		controller.mode = mode == "raw" ? "raw" : "preview";
		if (controller.mode == "preview") {
			this._renderMarkdownViewerPreview(controller, controller.els.rawEditor.value || controller.lastSavedMarkdown || "");
		}
		controller.els.markdownPreview.hidden = controller.mode == "raw";
		controller.els.rawEditor.hidden = controller.mode != "raw";
		controller.els.previewBtn.classList.toggle("sr-workspace-btn-primary", controller.mode != "raw");
		controller.els.rawBtn.classList.toggle("sr-workspace-btn-primary", controller.mode == "raw");
		if (controller.mode == "raw") {
			controller.els.rawEditor.focus();
		}
			this._updateMarkdownViewerPdfControls(controller);
			this._updateMarkdownViewerHorizontalScrollControls(controller);
		},

		_normalizeMarkdownViewerHighlightText(value = "") {
			return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
		},

		_clearMarkdownViewerTextHighlights(controller) {
			for (let node of Array.from(controller?.els?.markdownPreview?.querySelectorAll?.(".sr-md-viewer-match") || [])) {
				node.classList.remove("sr-md-viewer-match");
			}
		},

		_applyMarkdownViewerTextHighlight(controller, value = "") {
			this._clearMarkdownViewerTextHighlights(controller);
			let query = this._normalizeMarkdownViewerHighlightText(value);
			if (!query || !controller?.els?.markdownPreview) {
				return false;
			}
			let selectors = [
				".sr-simple-md-page h1",
				".sr-simple-md-page h2",
				".sr-simple-md-page h3",
				".sr-simple-md-page h4",
				".sr-simple-md-page h5",
				".sr-simple-md-page h6",
				".sr-simple-md-page p",
				".sr-simple-md-page li",
				".sr-simple-md-page td",
				".sr-simple-md-page th",
				".sr-simple-md-page blockquote",
				".sr-simple-md-page pre",
				".sr-simple-md-page figcaption",
			];
			let nodes = Array.from(controller.els.markdownPreview.querySelectorAll(selectors.join(", ")));
			let target = nodes.find((node) => this._normalizeMarkdownViewerHighlightText(node.textContent || "").includes(query)) || null;
			if (!target) {
				let terms = this._normalizeMarkdownViewerHighlightText(controller.highlightTerms || controller.searchQuery || "")
					.split(/\s+/)
					.map((term) => term.trim())
					.filter((term) => term.length >= 3);
				if (!terms.length) {
					terms = query.split(/\s+/)
						.map((term) => term.trim())
						.filter((term) => term.length >= 4)
						.slice(0, 8);
				}
				let best = null;
				for (let node of nodes) {
					let text = this._normalizeMarkdownViewerHighlightText(node.textContent || "");
					if (!text) {
						continue;
					}
					let score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
					if (score > 0 && (!best || score > best.score)) {
						best = { node, score };
					}
				}
				target = best?.node || null;
			}
			if (!target) {
				return false;
			}
			target.classList.add("sr-md-viewer-match");
			let page = target.closest(".sr-simple-md-page");
			let pageNumber = Number(page?.getAttribute("data-sr-page-index") || controller.currentPageNumber || 1) || 1;
			controller.currentPageNumber = pageNumber;
			this._highlightMarkdownViewerPage(controller, pageNumber);
			try {
				target.scrollIntoView({ block: "center", behavior: "smooth" });
			}
			catch (_err) {}
			return true;
		},

		_renderMarkdownViewerPreview(controller, markdown) {
			let currentPage = Math.max(1, Number(controller.currentPageNumber || 1) || 1);
			controller.els.markdownPreview.innerHTML = SystematicReviewerSimpleMarkdown.renderDocumentHTML(markdown, {
				resolveAssetURL: (rawPath) => this._resolveMarkdownViewerAssetURL(controller, rawPath),
			});
			controller.currentPageNumber = currentPage;
			controller.suppressMarkdownSyncUntil = 0;
			this._highlightMarkdownViewerPage(controller, currentPage);
			let highlighted = this._applyMarkdownViewerTextHighlight(controller, controller.highlightText || "");
			if (!highlighted) {
				this._scrollMarkdownViewerToPage(controller, currentPage);
			}
			this._updateMarkdownViewerHorizontalScrollControls(controller);
			if (this._markdownViewerPdfReady(controller)) {
				this._syncPdfFromMarkdownViewer(controller, currentPage);
			}
		},










































































































};
