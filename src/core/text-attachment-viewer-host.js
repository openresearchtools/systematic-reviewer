var SystematicReviewerTextAttachmentViewerHost = {
	_textAttachmentViewerReferenceData(raw, overrides = {}) {
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

	_textAttachmentViewerItemField(item, field) {
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

	_textAttachmentViewerLeafName(path = "") {
		let raw = String(path || "");
		return raw.split(/[\\/]/).pop() || raw;
	},

	_textAttachmentViewerDisplayTitle(title = "", path = "") {
		let rawTitle = String(title || "").trim();
		let leaf = this._textAttachmentViewerLeafName(path);
		let value = rawTitle || leaf || "Text";
		return value.length > 80 ? `${value.slice(0, 77)}...` : value;
	},

	_textAttachmentViewerTitle(viewerRef = null) {
		let ref = this._textAttachmentViewerReferenceData(viewerRef);
		if (!ref) {
			return "Text Viewer";
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
		let title = this._textAttachmentViewerDisplayTitle(
			this._textAttachmentViewerItemField(item, "title") || item?.key || "",
			path
		);
		return `${title || "Text"} - Systematic Reviewer`;
	},

	_textAttachmentViewerTabSpec(viewerRef = null) {
		let viewer = this._textAttachmentViewerReferenceData(viewerRef) || null;
		return {
			id: viewer ? `${this.textAttachmentViewerTabID}-${viewer.libraryID}-${viewer.attachmentKey}` : this.textAttachmentViewerTabID,
			type: this.textAttachmentViewerTabType,
			title: this._textAttachmentViewerTitle(viewer),
			viewerRef: viewer,
		};
	},

	_findTextAttachmentViewerTab(win, viewerRef = null) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._textAttachmentViewerTabSpec(viewerRef);
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

	_findTextAttachmentViewerTabAnywhere(viewerRef = null) {
		for (let win of this._mainWindows()) {
			let existing = this._findTextAttachmentViewerTab(win, viewerRef);
			if (existing) {
				return existing;
			}
		}
		return null;
	},

	async _openTextAttachmentViewerTab(targetWin = null, viewerRef = null) {
		let spec = this._textAttachmentViewerTabSpec(viewerRef);
		if (!spec.viewerRef) {
			throw new Error("Text attachment reference is required.");
		}
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		if (!win) {
			throw new Error("No Zotero window is available.");
		}
		if (!win.Zotero_Tabs || typeof win.Zotero_Tabs.add != "function") {
			throw new Error("Zotero tab workspace API is unavailable in this window.");
		}
		let existing = targetWin
			? this._findTextAttachmentViewerTab(win, spec.viewerRef)
			: this._findTextAttachmentViewerTabAnywhere(spec.viewerRef);
		if (existing) {
			await this._mountTextAttachmentViewerTab(existing.win, existing.container, spec.viewerRef);
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
		await this._mountTextAttachmentViewerTab(win, tabRef.container, spec.viewerRef);
		return tabRef;
	},

	_attachmentViewerWebURL(kind = "text", viewerRef = null, tabID = "") {
		let ref = kind == "csv"
			? this._csvAttachmentViewerReferenceData(viewerRef)
			: kind == "markdown"
				? this._markdownOnlyViewerReferenceData(viewerRef)
				: this._textAttachmentViewerReferenceData(viewerRef);
		if (!ref) {
			throw new Error("Attachment reference is missing.");
		}
		let baseURL = SystematicReviewerWorkflowServer?.getBaseURL?.() || "";
		if (!baseURL) {
			throw new Error("Systematic Reviewer app server is not available.");
		}
		let url = new URL(`${baseURL}${SystematicReviewerWorkflowServer.basePath}/ui/attachment-viewer.html`);
		url.searchParams.set("viewer_type", kind);
		url.searchParams.set("library_id", String(ref.libraryID));
		url.searchParams.set("attachment_key", ref.attachmentKey);
		if (tabID) {
			url.searchParams.set("tab_id", tabID);
		}
		if (ref.searchQuery) {
			url.searchParams.set("search_query", ref.searchQuery);
		}
		if (ref.highlightText) {
			url.searchParams.set("highlight_text", ref.highlightText);
		}
		let launchToken = SystematicReviewerWorkflowServer?.mintUILaunchToken?.({
			viewer_type: kind,
			library_id: ref.libraryID,
			attachment_key: ref.attachmentKey,
			tab_id: tabID,
		}) || "";
		if (launchToken) {
			url.searchParams.set("sr_launch_token", launchToken);
		}
		return url.toString();
	},

	_mountAttachmentViewerBrowser(win, container, viewerRef = null, kind = "text", tabID = "") {
		let doc = win?.document;
		if (!doc || !container) {
			throw new Error("Attachment viewer tab could not be mounted.");
		}
		let url = this._attachmentViewerWebURL(kind, viewerRef, tabID);
		let mount = container._systematicReviewerMount;
		let mustRebuild = !mount || !mount.isConnected || mount._systematicReviewerInstanceToken !== this.instanceToken;
		if (mustRebuild) {
			if (mount?._systematicReviewerAttachmentViewerController?.destroy) {
				mount._systematicReviewerAttachmentViewerController.destroy();
			}
			mount = this._html ? this._html(doc, "div") : doc.createElementNS(HTML_NS, "div");
			mount.style.display = "flex";
			mount.style.flex = "1";
			mount.style.width = "100%";
			mount.style.height = "100%";
			mount.style.minWidth = "0";
			mount.style.minHeight = "0";
			mount.style.overflow = "hidden";
			mount._systematicReviewerInstanceToken = this.instanceToken;
			container.replaceChildren(mount);
			container._systematicReviewerMount = mount;
		}
		let controller = mount._systematicReviewerAttachmentViewerController;
		if (!controller) {
			controller = {
				kind: `${kind}-attachment-web-viewer`,
				body: mount,
				appBody: mount,
				hostContainer: mount,
				parentWin: win,
				tabID,
				destroy: () => {
					try {
						controller.browser?.remove?.();
					}
					catch (_err) {}
					try {
						mount.replaceChildren();
					}
					catch (_err) {}
					try {
						if (mount._systematicReviewerAttachmentViewerController === controller) {
							delete mount._systematicReviewerAttachmentViewerController;
						}
					}
					catch (_err) {}
				},
			};
			mount._systematicReviewerAttachmentViewerController = controller;
		}
		let browser = controller.browser || mount._systematicReviewerBrowser || null;
		if (!browser || !browser.isConnected) {
			mount.replaceChildren();
			browser = doc.createXULElement("browser");
			browser.setAttribute("type", "content");
			browser.setAttribute("remote", "false");
			browser.setAttribute("maychangeremoteness", "false");
			browser.style.flex = "1";
			browser.style.width = "100%";
			browser.style.height = "100%";
			browser.style.minWidth = "0";
			browser.style.minHeight = "0";
			browser.style.border = "0";
			browser.style.background = "transparent";
			mount.appendChild(browser);
			controller.browser = browser;
			mount._systematicReviewerBrowser = browser;
		}
		let currentURL = "";
		try {
			currentURL = String(browser?.currentURI?.spec || browser?.getAttribute?.("src") || "").trim();
		}
		catch (_err) {}
		if (currentURL != url) {
			try {
				if (typeof browser?.loadURI == "function") {
					browser.loadURI(Services.io.newURI(url), {
						triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
					});
				}
				else {
					browser.setAttribute("src", url);
				}
			}
			catch (_err) {
				browser.setAttribute("src", url);
			}
		}
		return controller;
	},

	async _mountTextAttachmentViewerTab(win, container, viewerRef = null) {
		let spec = this._textAttachmentViewerTabSpec(viewerRef);
		container._systematicReviewerTabID = spec.id;
		this._mountAttachmentViewerBrowser(win, container, spec.viewerRef, "text", spec.id);
	},

	_isTextAttachmentViewerItem(item) {
		if (!item || item.deleted || !item.isAttachment?.()) {
			return false;
		}
		let contentType = String(item.attachmentContentType || "").toLowerCase();
		if (this._isTextAttachmentViewerContentType(contentType)) {
			return true;
		}
		let filePath = String(item.getFilePath ? item.getFilePath() || "" : "").toLowerCase();
		return this._isTextAttachmentViewerPath(filePath);
	},

	_isTextAttachmentViewerContentType(contentType = "") {
		let type = String(contentType || "").trim().toLowerCase();
		if (!type) {
			return false;
		}
		if (type == "text/markdown" || type == "text/x-markdown" || type == "text/csv" || type == "application/csv") {
			return false;
		}
		if (
			type == "text/plain"
			|| type.startsWith("text/x-")
			|| type == "application/json"
			|| type == "application/ld+json"
			|| type == "application/x-ndjson"
			|| type == "application/xml"
			|| type == "application/x-yaml"
			|| type == "application/yaml"
		) {
			return true;
		}
		return type.startsWith("text/") && type != "text/html";
	},

	_isTextAttachmentViewerPath(path = "") {
		let raw = String(path || "").trim().toLowerCase();
		let leaf = this._textAttachmentViewerLeafName(raw);
		if (!leaf) {
			return false;
		}
		if ([
			"dockerfile", "makefile", "rakefile", "gemfile", "podfile", "justfile",
			".gitignore", ".gitattributes", ".dockerignore", ".editorconfig", ".npmrc",
			".rhistory", ".rprofile", ".env",
		].includes(leaf) || leaf.startsWith(".env.")) {
			return true;
		}
		return [
			".txt", ".text", ".log",
			".py", ".pyw", ".r", ".rscript", ".rmd", ".qmd", ".rproj",
			".json", ".jsonl", ".ndjson", ".ipynb",
			".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
			".html", ".htm", ".xhtml", ".vue", ".svelte",
			".css", ".scss", ".sass", ".less",
			".yaml", ".yml", ".toml", ".xml", ".sql", ".graphql", ".gql",
			".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
			".dockerfile", ".containerfile",
		].some((extension) => leaf.endsWith(extension));
	},

	async _maybeOpenTextAttachmentViewer(item, _params = {}) {
		if (!this._isTextAttachmentViewerItem(item)) {
			return false;
		}
		let filePath = item.getFilePathAsync
			? await item.getFilePathAsync().catch(() => "")
			: (item.getFilePath ? item.getFilePath() || "" : "");
		let title = this._textAttachmentViewerDisplayTitle(
			this._textAttachmentViewerItemField(item, "title") || item.key,
			filePath
		);
		await this._openTextAttachmentViewerTab(null, {
			libraryID: item.libraryID,
			attachmentKey: item.key || "",
			parentItemKey: item.parentItem?.key || "",
			title: `${title || "Text"} - Systematic Reviewer`,
		});
		return true;
	},

	async openTextAttachmentViewer({ libraryID = 0, attachmentKey = "", attachment_key = "" } = {}) {
		let nextLibraryID = Number(libraryID || 0) || Zotero.Libraries.userLibraryID;
		let nextAttachmentKey = String(attachmentKey || attachment_key || "").trim();
		if (!nextAttachmentKey) {
			throw new Error("attachment_key is required.");
		}
		return await this._openTextAttachmentViewerTab(null, {
			libraryID: nextLibraryID,
			attachmentKey: nextAttachmentKey,
		});
	},
};
