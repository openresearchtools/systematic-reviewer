var SystematicReviewerMarkdownOnlyViewerHost = {
	_markdownOnlyViewerReferenceData(raw, overrides = {}) {
		if (!raw) {
			return null;
		}
		let libraryID = Number(
			overrides.libraryID
			?? overrides.library_id
			?? raw.libraryID
			?? raw.library_id
			?? raw.attachment?.libraryID
			?? raw.item?.libraryID
			?? 0
		) || 0;
		let attachmentKey = String(
			overrides.attachmentKey
			|| overrides.attachment_key
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
				|| overrides.parent_item_key
				|| raw.parentItemKey
				|| raw.parent_item_key
				|| raw.parentItem?.key
				|| ""
			).trim(),
			pdfAttachmentKey: String(
				overrides.pdfAttachmentKey
				|| overrides.pdf_attachment_key
				|| raw.pdfAttachmentKey
				|| raw.pdf_attachment_key
				|| raw.pdfAttachment?.key
				|| ""
			).trim(),
			highlightText: String(
				overrides.highlightText
				|| overrides.highlight_text
				|| raw.highlightText
				|| raw.highlight_text
				|| ""
			).trim(),
			searchQuery: String(
				overrides.searchQuery
				|| overrides.search_query
				|| raw.searchQuery
				|| raw.search_query
				|| ""
			).trim(),
			title: String(
				overrides.title
				|| raw.title
				|| raw.attachmentTitle
				|| raw.attachment_title
				|| ""
			).trim(),
		};
	},

	_markdownOnlyViewerItemField(item, field) {
		try {
			if (this?._itemField) {
				return String(this._itemField(item, field) || "");
			}
			return String(item?.getField?.(field) || "");
		}
		catch (_err) {
			return "";
		}
	},

	_markdownOnlyViewerLeafName(path = "") {
		let raw = String(path || "");
		return raw.split(/[\\/]/).pop() || raw;
	},

	_markdownOnlyViewerDisplayTitle(title = "", path = "") {
		let rawTitle = String(title || "").trim();
		let leaf = this._markdownOnlyViewerLeafName(path);
		let value = rawTitle || leaf || "Markdown";
		return value.length > 80 ? `${value.slice(0, 77)}...` : value;
	},

	_markdownOnlyViewerTitle(viewerRef = null) {
		let ref = this._markdownOnlyViewerReferenceData(viewerRef);
		if (!ref) {
			return "Markdown Viewer";
		}
		if (ref.title) {
			return ref.title;
		}
		let item = Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.attachmentKey);
		let path = "";
		try {
			path = String(item?.getFilePath?.() || "");
		}
		catch (_err) {}
		let title = this._markdownOnlyViewerDisplayTitle(
			this._markdownOnlyViewerItemField(item, "title") || item?.key || "",
			path
		);
		return `${title || "Markdown"} - Systematic Reviewer`;
	},

	_markdownOnlyViewerTabSpec(viewerRef = null) {
		let viewer = this._markdownOnlyViewerReferenceData(viewerRef) || null;
		return {
			id: viewer ? `${this.markdownOnlyViewerTabID}-${viewer.libraryID}-${viewer.attachmentKey}` : this.markdownOnlyViewerTabID,
			type: this.markdownOnlyViewerTabType,
			title: this._markdownOnlyViewerTitle(viewer),
			viewerRef: viewer,
		};
	},

	_findMarkdownOnlyViewerTab(win, viewerRef = null) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._markdownOnlyViewerTabSpec(viewerRef);
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

	_findMarkdownOnlyViewerTabAnywhere(viewerRef = null) {
		for (let win of this._mainWindows()) {
			let existing = this._findMarkdownOnlyViewerTab(win, viewerRef);
			if (existing) {
				return existing;
			}
		}
		return null;
	},

	async _openMarkdownOnlyViewerTab(targetWin = null, viewerRef = null) {
		let spec = this._markdownOnlyViewerTabSpec(viewerRef);
		if (!spec.viewerRef) {
			throw new Error("Markdown attachment reference is required.");
		}
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		if (!win.Zotero_Tabs || typeof win.Zotero_Tabs.add != "function") {
			throw new Error("Zotero tab workspace API is unavailable in this window.");
		}
		let existing = targetWin
			? this._findMarkdownOnlyViewerTab(win, spec.viewerRef)
			: this._findMarkdownOnlyViewerTabAnywhere(spec.viewerRef);
		if (existing) {
			await this._mountMarkdownOnlyViewerTab(existing.win, existing.container, spec.viewerRef);
			existing.win.Zotero_Tabs.select(existing.id);
			existing.win.focus();
			return existing;
		}
		let tabRef = win.Zotero_Tabs.add({
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
				searchQuery: spec.viewerRef.searchQuery || "",
				title: spec.title,
			},
			select: true,
			onClose: () => {
				let host = tabRef?.container?._systematicReviewerMount || tabRef?.container || null;
				let controller = host?._systematicReviewerAttachmentViewerController || null;
				if (controller?.destroy) {
					controller.destroy();
				}
			},
		});
		await this._mountMarkdownOnlyViewerTab(win, tabRef.container, spec.viewerRef);
		return tabRef;
	},

	async _mountMarkdownOnlyViewerTab(win, container, viewerRef = null) {
		let spec = this._markdownOnlyViewerTabSpec(viewerRef);
		container._systematicReviewerTabID = spec.id;
		this._mountAttachmentViewerBrowser(win, container, spec.viewerRef, "markdown", spec.id);
	},

	_markdownOnlyViewerHasSiblingPDF(item) {
		if (!item || !item.isAttachment?.()) {
			return false;
		}
		let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
		if (typeof this._findSiblingPDFAttachment == "function") {
			return !!this._findSiblingPDFAttachment(parentItem, item.key || "");
		}
		if (!parentItem?.getAttachments) {
			return false;
		}
		for (let attachmentID of parentItem.getAttachments() || []) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment || attachment.deleted || !attachment.isAttachment?.() || attachment.key == item.key) {
				continue;
			}
			let contentType = String(attachment.attachmentContentType || "").toLowerCase();
			let filePath = String(attachment.getFilePath ? attachment.getFilePath() || "" : "").toLowerCase();
			if (contentType == "application/pdf" || filePath.endsWith(".pdf")) {
				return true;
			}
		}
		return false;
	},

	async _openMarkdownAttachmentBestViewer(targetWin = null, viewerRef = null) {
		let ref = this._markdownOnlyViewerReferenceData(viewerRef);
		if (!ref) {
			throw new Error("Markdown attachment reference is missing.");
		}
		let attachment = Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.attachmentKey);
		if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
			throw new Error("Markdown attachment could not be found in Zotero.");
		}
		if (this._markdownOnlyViewerHasSiblingPDF(attachment)) {
			return await this._openMarkdownViewerTab(targetWin, ref);
		}
		return await this._openMarkdownOnlyViewerTab(targetWin, ref);
	},

	async _maybeOpenMarkdownAttachmentViewer(item, _params = {}) {
		let isMarkdown = typeof this._isMarkdownAttachmentItem == "function"
			? this._isMarkdownAttachmentItem(item)
			: this._isMarkdownOnlyAttachmentItem(item);
		if (!isMarkdown) {
			return false;
		}
		await this._openMarkdownAttachmentBestViewer(null, {
			libraryID: item.libraryID,
			attachmentKey: item.key || "",
			parentItemKey: item.parentItem?.key || "",
			title: `${this._markdownOnlyViewerItemField(item, "title") || item.key || "Markdown"} - Systematic Reviewer`,
		});
		return true;
	},

	async openMarkdownAttachmentViewer({ libraryID = 0, attachmentKey = "", attachment_key = "" } = {}) {
		let nextLibraryID = Number(libraryID || 0) || Zotero.Libraries.userLibraryID;
		let nextAttachmentKey = String(attachmentKey || attachment_key || "").trim();
		if (!nextAttachmentKey) {
			throw new Error("attachment_key is required.");
		}
		return await this._openMarkdownAttachmentBestViewer(null, {
			libraryID: nextLibraryID,
			attachmentKey: nextAttachmentKey,
		});
	},

	_isMarkdownOnlyAttachmentItem(item) {
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
};
