var SystematicReviewerCSVAttachmentViewerHost = {
	_csvAttachmentViewerReferenceData(raw, overrides = {}) {
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
			title: String(
				overrides.title
				|| raw.title
				|| raw.attachmentTitle
				|| raw.attachment_title
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
		};
	},

	_csvAttachmentViewerItemField(item, field) {
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

	_csvAttachmentViewerLeafName(path = "") {
		let raw = String(path || "");
		return raw.split(/[\\/]/).pop() || raw;
	},

	_csvAttachmentViewerDisplayTitle(title = "", path = "") {
		let rawTitle = String(title || "").trim();
		let leaf = this._csvAttachmentViewerLeafName(path);
		let value = rawTitle || leaf || "CSV";
		return value.length > 80 ? `${value.slice(0, 77)}...` : value;
	},

	_csvAttachmentViewerTitle(viewerRef = null) {
		let ref = this._csvAttachmentViewerReferenceData(viewerRef);
		if (!ref) {
			return "CSV Viewer";
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
		let title = this._csvAttachmentViewerDisplayTitle(
			this._csvAttachmentViewerItemField(item, "title") || item?.key || "",
			path
		);
		return `${title || "CSV"} - Systematic Reviewer`;
	},

	_csvAttachmentViewerTabSpec(viewerRef = null) {
		let viewer = this._csvAttachmentViewerReferenceData(viewerRef) || null;
		return {
			id: viewer ? `${this.csvAttachmentViewerTabID}-${viewer.libraryID}-${viewer.attachmentKey}` : this.csvAttachmentViewerTabID,
			type: this.csvAttachmentViewerTabType,
			title: this._csvAttachmentViewerTitle(viewer),
			viewerRef: viewer,
		};
	},

	_findCSVAttachmentViewerTab(win, viewerRef = null) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._csvAttachmentViewerTabSpec(viewerRef);
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

	_findCSVAttachmentViewerTabAnywhere(viewerRef = null) {
		for (let win of this._mainWindows()) {
			let existing = this._findCSVAttachmentViewerTab(win, viewerRef);
			if (existing) {
				return existing;
			}
		}
		return null;
	},

	async _openCSVAttachmentViewerTab(targetWin = null, viewerRef = null) {
		let spec = this._csvAttachmentViewerTabSpec(viewerRef);
		if (!spec.viewerRef) {
			throw new Error("CSV attachment reference is required.");
		}
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		if (!win.Zotero_Tabs || typeof win.Zotero_Tabs.add != "function") {
			throw new Error("Zotero tab workspace API is unavailable in this window.");
		}
		let existing = targetWin
			? this._findCSVAttachmentViewerTab(win, spec.viewerRef)
			: this._findCSVAttachmentViewerTabAnywhere(spec.viewerRef);
		if (existing) {
			await this._mountCSVAttachmentViewerTab(existing.win, existing.container, spec.viewerRef);
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
		await this._mountCSVAttachmentViewerTab(win, tabRef.container, spec.viewerRef);
		return tabRef;
	},

	async _mountCSVAttachmentViewerTab(win, container, viewerRef = null) {
		let spec = this._csvAttachmentViewerTabSpec(viewerRef);
		container._systematicReviewerTabID = spec.id;
		this._mountAttachmentViewerBrowser(win, container, spec.viewerRef, "csv", spec.id);
	},

	_isCSVAttachmentViewerItem(item) {
		if (!item || item.deleted || !item.isAttachment?.()) {
			return false;
		}
		let contentType = String(item.attachmentContentType || "").toLowerCase();
		if (contentType == "text/csv" || contentType == "application/csv") {
			return true;
		}
		let filePath = String(item.getFilePath ? item.getFilePath() || "" : "").toLowerCase();
		return filePath.endsWith(".csv");
	},

	async _maybeOpenCSVAttachmentViewer(item, _params = {}) {
		if (!this._isCSVAttachmentViewerItem(item)) {
			return false;
		}
		let filePath = item.getFilePathAsync
			? await item.getFilePathAsync().catch(() => "")
			: (item.getFilePath ? item.getFilePath() || "" : "");
		let title = this._csvAttachmentViewerDisplayTitle(
			this._csvAttachmentViewerItemField(item, "title") || item.key,
			filePath
		);
		await this._openCSVAttachmentViewerTab(null, {
			libraryID: item.libraryID,
			attachmentKey: item.key || "",
			parentItemKey: item.parentItem?.key || "",
			title: `${title || "CSV"} - Systematic Reviewer`,
		});
		return true;
	},

	async openCSVAttachmentViewer({ libraryID = 0, attachmentKey = "", attachment_key = "" } = {}) {
		let nextLibraryID = Number(libraryID || 0) || Zotero.Libraries.userLibraryID;
		let nextAttachmentKey = String(attachmentKey || attachment_key || "").trim();
		if (!nextAttachmentKey) {
			throw new Error("attachment_key is required.");
		}
		return await this._openCSVAttachmentViewerTab(null, {
			libraryID: nextLibraryID,
			attachmentKey: nextAttachmentKey,
		});
	},
};
