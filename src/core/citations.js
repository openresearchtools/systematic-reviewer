var SystematicReviewerCitations = {
	_projectCitationScope(controller) {
		let zotero = controller?.bootstrap?.current_project?.zotero || null;
		if (!zotero?.collection_key) {
			return { collection: null, projectItem: null, items: [], itemMap: new Map() };
		}
		let projectID = String(controller?.projectRef?.projectID || controller?.bootstrap?.current_project?.entry?.project_id || "").trim();
		let cacheKey = `${zotero.library_id || ""}:${zotero.collection_key}:${zotero.project_item_key || ""}:${projectID}:${this.reconcileGeneration}`;
		if (controller._projectCitationScopeCache?.key == cacheKey) {
			return controller._projectCitationScopeCache.value;
		}
		let collection = this._collectionByKey(zotero.library_id, zotero.collection_key);
		let projectItem = zotero.project_item_key
			? Zotero.Items.getByLibraryAndKey(zotero.library_id, zotero.project_item_key)
			: null;
		let items = collection ? this._projectCitableItems(collection, projectItem) : [];
		let itemMap = new Map(items.map((item) => [item.key, item]));
		let aliasMap = this.projectItemKeyAliases.get(projectID) || new Map();
		for (let [oldKey, currentKey] of aliasMap.entries()) {
			if (!oldKey || !currentKey || itemMap.has(oldKey)) {
				continue;
			}
			let liveItem = itemMap.get(currentKey) || this._itemByKey(zotero.library_id, currentKey);
			if (liveItem && !liveItem.deleted) {
				itemMap.set(oldKey, liveItem);
			}
		}
		let value = { collection, projectItem, items, itemMap };
		controller._projectCitationScopeCache = { key: cacheKey, value };
		return value;
	},

	_workspaceCitationCacheNamespace(controller) {
		let zotero = controller?.bootstrap?.current_project?.zotero || {};
		let settings = this._workspaceSettings(controller);
		return [
			zotero.library_id || "",
			zotero.collection_key || "",
			zotero.project_item_key || "",
			settings.citationStyleID || "",
			settings.citationLocale || Zotero.locale || "",
		].join("|");
	},

	_lookupCitationItem(controller, key) {
		let normalizedKey = String(key || "").trim();
		if (!normalizedKey) {
			return null;
		}
		let scope = this._projectCitationScope(controller);
		if (scope.itemMap.has(normalizedKey)) {
			return scope.itemMap.get(normalizedKey);
		}
		let libraryID = controller?.bootstrap?.current_project?.zotero?.library_id || null;
		if (!libraryID) {
			return null;
		}
		try {
			let direct = Zotero.Items.getByLibraryAndKey(libraryID, normalizedKey) || null;
			if (direct && !direct.deleted) {
				return direct;
			}
			let projectID = String(controller?.projectRef?.projectID || controller?.bootstrap?.current_project?.entry?.project_id || "").trim();
			let aliasMap = this.projectItemKeyAliases.get(projectID) || new Map();
			let seen = new Set();
			let currentKey = normalizedKey;
			for (let depth = 0; depth < 12; depth += 1) {
				if (!currentKey || seen.has(currentKey)) {
					break;
				}
				seen.add(currentKey);
				currentKey = String(aliasMap.get(currentKey) || "").trim();
				if (!currentKey) {
					break;
				}
				let aliased = Zotero.Items.getByLibraryAndKey(libraryID, currentKey) || null;
				if (aliased && !aliased.deleted) {
					return aliased;
				}
			}
			return null;
		}
		catch (_err) {
			return null;
		}
	},

	_ensureWorkspaceCitationCaches(controller) {
		let namespace = this._workspaceCitationCacheNamespace(controller);
		if (controller.renderCacheNamespace != namespace) {
			controller.renderCacheNamespace = namespace;
			controller.citationHTMLCache = new Map();
			controller.bibliographyHTMLCache = new Map();
			controller.citationPreviewEngine = null;
			controller.bibliographyPreviewEngine = null;
			controller.citationTextEngine = null;
			controller.bibliographyTextEngine = null;
		}
		return {
			citationHTMLCache: controller.citationHTMLCache,
			bibliographyHTMLCache: controller.bibliographyHTMLCache,
			};
		},

	_invalidateCitationRenderCaches(controller) {
		if (!controller) {
			return;
		}
		controller.renderCacheNamespace = "";
		controller.citationHTMLCache = new Map();
		controller.bibliographyHTMLCache = new Map();
		controller.citationPreviewEngine = null;
		controller.bibliographyPreviewEngine = null;
		controller.citationTextEngine = null;
		controller.bibliographyTextEngine = null;
	},

	_refreshNativeBibliographyBlocks(controller, markdown = null) {
		let root = controller?.els?.nativeEditor;
		if (!root || controller.mode != "native") {
			return;
		}
		let blocks = Array.from(root.querySelectorAll(".sr-block-bibliography > .sr-block-editable"));
		if (!blocks.length) {
			return;
		}
		let sourceMarkdown = typeof markdown == "string" ? markdown : this._serializeControllerMarkdown(controller);
		let bibliographyHTML = this._renderBibliographyHTML(controller, sourceMarkdown)
			|| `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`;
		for (let block of blocks) {
			block.setAttribute("data-sr-markdown", SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN);
			block.innerHTML = bibliographyHTML;
		}
	},

	_refreshCitationDependentRendering(controller, markdown = null) {
		this._invalidateCitationRenderCaches(controller);
		if (controller?.mode == "native") {
			this._refreshNativeBibliographyBlocks(controller, markdown);
		}
		if (controller) {
			controller.previewStale = true;
		}
	},

		_workspaceCiteProcEngine(controller, kind = "citation", format = "html") {
			this._ensureWorkspaceCitationCaches(controller);
			let engineKey = kind == "bibliography"
				? (format == "text" ? "bibliographyTextEngine" : "bibliographyPreviewEngine")
				: (format == "text" ? "citationTextEngine" : "citationPreviewEngine");
			if (controller[engineKey]) {
				return controller[engineKey];
			}
			let settings = this._workspaceSettings(controller);
			let style = Zotero.Styles.get(settings.citationStyleID) || Zotero.Styles.get(this._defaultEditorSettings().citationStyleID);
			if (!style) {
				return null;
			}
			controller[engineKey] = style.getCiteProc(settings.citationLocale || Zotero.locale, format, { cache: false });
			return controller[engineKey];
		},

	_citationChipHTML(controller, citation) {
		let normalized = Object.assign({}, citation || {});
		let markdown = SystematicReviewerNativeMarkdown.makeCitationMarkdown(normalized);
		let label = this._formatCitationHTML(controller, normalized, "cite");
		return `&#8203;<span class="sr-citation-chip" contenteditable="false" data-sr-editable="false" data-sr-markdown="${this._escapeHTML(markdown)}">${this._xmlSafeHTMLFragment(label)}</span>&#8203;`;
	},

	_citationInfoFromNode(node) {
		let target = node?.closest?.(".sr-citation-chip, .sr-citation-ref");
		if (!target) {
			return null;
		}
		let markdown = target.getAttribute("data-sr-markdown") || "";
		let info = SystematicReviewerNativeMarkdown.parseCitationMarkdown(markdown);
		if (!info) {
			return null;
		}
		return Object.assign({ node: target }, info);
	},

	_formatCitationHTML(controller, citation, fallbackLabel = "cite") {
		try {
			let caches = this._ensureWorkspaceCitationCaches(controller);
				let cacheKey = SystematicReviewerNativeMarkdown.makeCitationMarkdown(citation || {});
				if (cacheKey && caches.citationHTMLCache.has(cacheKey)) {
				return caches.citationHTMLCache.get(cacheKey);
			}
			let items = (citation.keys || [])
				.map((key) => this._lookupCitationItem(controller, key))
				.filter(Boolean);
				if (!items.length) {
					return this._escapeHTML(fallbackLabel);
				}
				let engine = this._workspaceCiteProcEngine(controller, "citation");
				if (!engine) {
					return this._escapeHTML(fallbackLabel);
				}
				engine.updateItems(items.map((item) => item.id));
				let citationItems = items.map((item) => ({ id: item.id }));
				if (citation.prefix) {
					citationItems[0].prefix = citation.prefix;
			}
			if (citation.locator) {
				citationItems[citationItems.length - 1].locator = citation.locator;
			}
			if (citation.suffix) {
				citationItems[citationItems.length - 1].suffix = citation.suffix;
			}
			let rendered = engine.previewCitationCluster({ citationItems, properties: {} }, [], [], "html") || this._escapeHTML(fallbackLabel);
			caches.citationHTMLCache.set(cacheKey, rendered);
			return rendered;
		}
		catch (_err) {
			return this._escapeHTML(fallbackLabel);
		}
	},

	_formatCitationText(controller, citation, fallbackLabel = "cite") {
		try {
			let items = (citation.keys || [])
				.map((key) => this._lookupCitationItem(controller, key))
				.filter(Boolean);
			if (!items.length) {
				return String(fallbackLabel || "cite");
			}
			let engine = this._workspaceCiteProcEngine(controller, "citation", "text");
			if (!engine) {
				return String(fallbackLabel || "cite");
			}
			engine.updateItems(items.map((item) => item.id));
			let citationItems = items.map((item) => ({ id: item.id }));
			if (citation.prefix) {
				citationItems[0].prefix = citation.prefix;
			}
			if (citation.locator) {
				citationItems[citationItems.length - 1].locator = citation.locator;
			}
			if (citation.suffix) {
				citationItems[citationItems.length - 1].suffix = citation.suffix;
			}
			return String(engine.previewCitationCluster({ citationItems, properties: {} }, [], [], "text") || fallbackLabel || "cite").trim();
		}
		catch (_err) {
			return String(fallbackLabel || "cite");
		}
	},

	_renderBibliographyHTML(controller, markdown) {
		try {
			let caches = this._ensureWorkspaceCitationCaches(controller);
			let citations = SystematicReviewerNativeMarkdown.extractCitations(markdown);
			let seen = new Set();
			let items = [];
			for (let citation of citations) {
				for (let key of citation.keys) {
					let item = this._lookupCitationItem(controller, key);
					if (item && !seen.has(item.id)) {
						seen.add(item.id);
						items.push(item);
					}
				}
			}
				if (!items.length) {
					return `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`;
				}
				let cacheKey = items.map((item) => item.id).sort((a, b) => a - b).join(",");
				if (caches.bibliographyHTMLCache.has(cacheKey)) {
					return caches.bibliographyHTMLCache.get(cacheKey);
				}
				let engine = this._workspaceCiteProcEngine(controller, "bibliography");
				if (!engine) {
					return `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`;
				}
				engine.updateItems(items.map((item) => item.id));
				let rendered = Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, "html", false);
				let wrapped = `<section class="sr-bibliography-block" data-sr-bibliography-root="true"><h2 class="sr-bibliography-heading">Bibliography</h2><div class="sr-bibliography-flow">${rendered}</div></section>`;
				caches.bibliographyHTMLCache.set(cacheKey, wrapped);
			return wrapped;
		}
		catch (_err) {
			return `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`;
		}
	},

	_renderBibliographyText(controller, markdown) {
		try {
			let citations = SystematicReviewerNativeMarkdown.extractCitations(markdown);
			let seen = new Set();
			let items = [];
			for (let citation of citations) {
				for (let key of citation.keys) {
					let item = this._lookupCitationItem(controller, key);
					if (item && !seen.has(item.id)) {
						seen.add(item.id);
						items.push(item);
					}
				}
			}
			if (!items.length) {
				return "Bibliography";
			}
			let engine = this._workspaceCiteProcEngine(controller, "bibliography", "text");
			if (!engine) {
				return "Bibliography";
			}
			engine.updateItems(items.map((item) => item.id));
			return String(Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, "text", false) || "Bibliography").trim();
		}
		catch (_err) {
			return "Bibliography";
		}
	},

	_renderItemCitationTextMap(items = [], styleID = DEFAULT_CITATION_STYLE_ID, locale = "") {
		let itemList = Array.from(
			new Map(
				(items || [])
					.filter((item) => item && !item.deleted && !!item.key && !!item.id)
					.map((item) => [String(item.key || "").trim(), item])
			).values()
		);
		let rendered = new Map();
		if (!itemList.length) {
			return rendered;
		}
		try {
			let style = Zotero.Styles.get(styleID) || Zotero.Styles.get(DEFAULT_CITATION_STYLE_ID);
			if (!style) {
				return rendered;
			}
			let engine = style.getCiteProc(locale || Zotero.locale || "", "text", { cache: false });
			engine.updateItems(itemList.map((item) => item.id));
			for (let item of itemList) {
				let text = String(
					engine.previewCitationCluster(
						{ citationItems: [{ id: item.id }], properties: {} },
						[],
						[],
						"text"
					) || ""
				).trim();
				if (text) {
					rendered.set(String(item.key || "").trim(), text);
				}
			}
		}
		catch (_error) {}
		return rendered;
	},
};
