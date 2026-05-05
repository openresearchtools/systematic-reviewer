var SystematicReviewerAttachmentViewerRouter = {
	_installZoteroPaneAttachmentOpenOverride(win) {
		let pane = win?.ZoteroPane;
		if (!pane?.viewAttachment) {
			return;
		}
		let state = this.windowState.get(win) || {};
		if (state.originalZoteroPaneViewAttachment) {
			return;
		}
		let originalViewAttachment = pane.viewAttachment;
		let reviewer = this;
		let override = async function (itemIDs, event, noLocateOnMissing, extraData) {
			try {
				let ids = Array.isArray(itemIDs) ? itemIDs.slice() : [itemIDs];
				if (ids.length == 1) {
					let itemID = Number(ids[0] || 0) || 0;
					let item = itemID ? await Zotero.Items.getAsync(itemID) : null;
					if (reviewer._isAttachmentTextualViewerCandidate(item)) {
						try {
							if (await reviewer._maybeOpenAttachmentTextualViewer(item, extraData || {})) {
								try {
									Zotero.Notifier.trigger("open", "file", item.id);
								}
								catch (_notifyError) {}
								return;
							}
							throw new Error("No Systematic Reviewer attachment viewer accepted this file.");
						}
						catch (error) {
							reviewer._showError?.(error);
							reviewer.log(`textual attachment ZoteroPane open failed: ${error}`);
							return;
						}
					}
				}
			}
			catch (error) {
				reviewer.log(`textual attachment ZoteroPane open skipped: ${error}`);
			}
			return await originalViewAttachment.apply(this, arguments);
		};
		pane.viewAttachment = override;
		this.windowState.set(win, Object.assign({}, state, {
			originalZoteroPaneViewAttachment: originalViewAttachment,
			zoteroPaneViewAttachmentOverride: override,
			zoteroPaneForViewAttachmentOverride: pane,
		}));
	},

	_restoreZoteroPaneAttachmentOpenOverride(win) {
		let state = this.windowState.get(win) || {};
		let pane = state.zoteroPaneForViewAttachmentOverride || win?.ZoteroPane;
		if (pane && state.originalZoteroPaneViewAttachment && pane.viewAttachment === state.zoteroPaneViewAttachmentOverride) {
			try {
				pane.viewAttachment = state.originalZoteroPaneViewAttachment;
			}
			catch (_err) {}
		}
		if (state.originalZoteroPaneViewAttachment || state.zoteroPaneViewAttachmentOverride) {
			delete state.originalZoteroPaneViewAttachment;
			delete state.zoteroPaneViewAttachmentOverride;
			delete state.zoteroPaneForViewAttachmentOverride;
			this.windowState.set(win, state);
		}
	},

	_installFileHandlerOverrides() {
		if (this.originalFileHandlersOpen || !Zotero.FileHandlers?.open) {
			return;
		}
		let originalOpen = Zotero.FileHandlers.open;
		let reviewer = this;
		this.originalFileHandlersOpen = originalOpen;
		Zotero.FileHandlers.open = async function (...args) {
			let item = args[0] || null;
			let params = args[1] || {};
			if (reviewer._isAttachmentTextualViewerCandidate(item)) {
				try {
					if (await reviewer._maybeOpenAttachmentTextualViewer(item, params || {})) {
						return true;
					}
					throw new Error("No Systematic Reviewer attachment viewer accepted this file.");
				}
				catch (error) {
					reviewer._showError?.(error);
					reviewer.log(`textual attachment viewer failed: ${error}`);
					return true;
				}
			}
			return await originalOpen.apply(this, args);
		};
	},

	_restoreFileHandlerOverrides() {
		if (!this.originalFileHandlersOpen || !Zotero.FileHandlers) {
			this.originalFileHandlersOpen = null;
			return;
		}
		Zotero.FileHandlers.open = this.originalFileHandlersOpen;
		this.originalFileHandlersOpen = null;
	},

	_isPDFViewerRouterAttachment(item) {
		if (!item || item.deleted || !item.isAttachment?.()) {
			return false;
		}
		let contentType = String(item.attachmentContentType || "").toLowerCase();
		if (contentType == "application/pdf") {
			return true;
		}
		let filePath = "";
		try {
			filePath = String(item.getFilePath ? item.getFilePath() || "" : "").toLowerCase();
		}
		catch (_err) {}
		return filePath.endsWith(".pdf");
	},

	_isAttachmentTextualViewerCandidate(item) {
		if (!item || item.deleted || !item.isAttachment?.() || this._isPDFViewerRouterAttachment(item)) {
			return false;
		}
		if (this._isMarkdownAttachmentItem?.(item) || this._isMarkdownOnlyAttachmentItem?.(item)) {
			return true;
		}
		if (this._isCSVAttachmentViewerItem?.(item)) {
			return true;
		}
		if (this._isTextAttachmentViewerItem?.(item)) {
			return true;
		}
		return false;
	},

	async _maybeOpenAttachmentTextualViewer(item, params = {}) {
		if (!this._isAttachmentTextualViewerCandidate(item)) {
			return false;
		}
		if (await this._maybeOpenMarkdownAttachmentViewer?.(item, params || {})) {
			return true;
		}
		if (await this._maybeOpenCSVAttachmentViewer?.(item, params || {})) {
			return true;
		}
		if (await this._maybeOpenTextAttachmentViewer?.(item, params || {})) {
			return true;
		}
		return false;
	},

	async _openAttachmentTextualViewerByKey({
		libraryID = 0,
		attachmentKey = "",
		attachment_key = "",
		parentItemKey = "",
		parent_item_key = "",
		title = "",
		highlightText = "",
		highlight_text = "",
		pdfSearchQuery = "",
		pdf_search_query = "",
		searchQuery = "",
		search_query = "",
		pageNumber = 0,
		page_number = 0,
	} = {}) {
		let nextLibraryID = Number(libraryID || 0) || Zotero.Libraries.userLibraryID;
		let nextAttachmentKey = String(attachmentKey || attachment_key || "").trim();
		if (!nextAttachmentKey) {
			throw new Error("attachment_key is required.");
		}

		let attachment = Zotero.Items.getByLibraryAndKey(nextLibraryID, nextAttachmentKey);
		if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
			throw new Error("Attachment could not be found in Zotero.");
		}
		if (this._isPDFViewerRouterAttachment(attachment)) {
			return "";
		}

		let baseRef = {
			libraryID: nextLibraryID,
			attachmentKey: nextAttachmentKey,
			parentItemKey: parentItemKey || parent_item_key || "",
			title,
			highlightText: highlightText || highlight_text || "",
			pdfSearchQuery: pdfSearchQuery || pdf_search_query || "",
			searchQuery: searchQuery || search_query || highlightText || highlight_text || "",
			pageNumber: Number(pageNumber || page_number || 0) || 0,
		};

		if (this._isMarkdownAttachmentItem?.(attachment)) {
			if (typeof this._openMarkdownAttachmentBestViewer == "function") {
				await this._openMarkdownAttachmentBestViewer(null, baseRef);
			}
			else {
				await this._openMarkdownViewerTab(null, baseRef);
			}
			return "markdown";
		}

		if (this._isCSVAttachmentViewerItem?.(attachment)) {
			await this._openCSVAttachmentViewerTab(null, baseRef);
			return "csv";
		}

		if (this._isTextAttachmentViewerItem?.(attachment)) {
			await this._openTextAttachmentViewerTab(null, baseRef);
			return "text";
		}

		return "";
	},
};
