var SystematicReviewerProjectStorage = {
	async _openOrInitCollectionProject(collection, options = {}) {
		if (!this._isRootCollection(collection)) {
			throw new Error("Systematic Reviewer projects can only be created on top-level Zotero collections.");
		}
		let context = this._collectionProjectContext(collection);
		await this._ensureProjectRoot(context);
		let existingProjectItem = await this._resolveProjectItem(collection, "", false);
		let hadSettings = await this._pathExists(context.settingsPath);
		let hadManifest = await this._pathExists(context.manifestPath);
		let projectExists = hadSettings || hadManifest || !!existingProjectItem;
		let stored = projectExists ? await this._storedProjectMetadata(context) : { settings: {}, manifest: {}, projectType: "" };
		let explicitType = String(options.projectType || options.project_type || "").trim();
		let existingType = projectExists ? this._normalizeProjectType(stored.projectType || "") : "";
		let requestedType = explicitType ? this._normalizeProjectType(explicitType) : "";
		if (requestedType && existingType && requestedType != existingType) {
			throw new Error(`This collection is already initialized as ${this._projectTypeLabel(existingType)}.`);
		}
		let projectType = this._normalizeProjectType(existingType || requestedType || PROJECT_TYPE_SYSTEMATIC_REVIEW);
		let projectItem = existingProjectItem || await this._resolveProjectItem(collection, "", true, projectType);
		let projectOutputsItem = await this._resolveProjectOutputsItem(
			collection,
			stored.settings?.outputs_item_key || stored.manifest?.outputs_item_key || "",
			true,
			projectType
		);
		await this._ensureProjectScaffold(context, collection, projectItem, {
			projectType,
			projectOutputsItem,
			seedTemplatePack: !projectExists,
		});
		if (!projectExists) {
			await this._initializeProjectCollections(context, collection, projectItem, projectType, projectOutputsItem);
		}
		await this._reconcileCollectionProject(context, collection, projectItem, projectOutputsItem);
		let sessionID = await this._ensureActiveSession(context);
		let current = { context, collection, projectItem, sessionID, projectType };
		await this._reconcileProjectConversionAutomation(current, {
			reason: "project_open",
		});
		this._setCurrentProject(context, projectItem, sessionID, projectType);
		return current;
	},

	async _openExistingCollectionProject(collection, options = {}) {
		if (!this._isRootCollection(collection)) {
			throw new Error("Systematic Reviewer projects can only be opened on top-level Zotero collections.");
		}
		if (!(await this._collectionHasStoredProject(collection))) {
			throw new Error("This collection is not an initialized Systematic Reviewer or Custom Analysis project.");
		}
		return await this._openOrInitCollectionProject(collection, options || {});
	},

	_collectionProjectContext(collection) {
		let libraryID = collection.libraryID || Zotero.Libraries.userLibraryID;
		let projectID = `${libraryID}-${collection.key}`;
		let projectRoot = this._joinPath(this._storageRoot(), "projects", projectID);
		return {
			projectID,
			libraryID,
			collectionID: collection.id,
			collectionKey: collection.key,
			collectionName: collection.name,
			projectRoot,
			databasePath: this._joinPath(projectRoot, SQLITE_FILENAME),
			reportPath: this._joinPath(projectRoot, "REPORT.md"),
			logPath: this._joinPath(projectRoot, "log.txt"),
			settingsPath: this._joinPath(projectRoot, "settings.json"),
			manifestPath: this._joinPath(projectRoot, "project.json"),
			snapshotsDir: this._joinPath(projectRoot, "snapshots"),
			templatesDir: this._joinPath(projectRoot, "templates"),
			outputsDir: this._joinPath(projectRoot, "outputs"),
			conversionsDir: this._joinPath(projectRoot, "conversions"),
			jobsDir: this._joinPath(projectRoot, "jobs"),
			sessionsDir: this._joinPath(projectRoot, "sessions"),
			sourcesDir: this._joinPath(projectRoot, "sources"),
		};
	},

	_projectShellBaseLabel(projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW) {
		return this._normalizeProjectType(projectType) == PROJECT_TYPE_CUSTOM_ANALYSIS
			? "Systematic Reviewer Custom Analysis"
			: "Systematic Reviewer";
	},

	_projectShellItemTitle(collection, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW, itemKind = PROJECT_ITEM_KIND_PROJECT) {
		let base = this._projectShellBaseLabel(projectType);
		let collectionName = String(collection?.name || "").trim() || "Collection";
		return itemKind == PROJECT_ITEM_KIND_OUTPUTS
			? `${base} OUTPUTS - ${collectionName}`
			: `${base} - ${collectionName}`;
	},

	_projectShellItemExtra(collection, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW, itemKind = PROJECT_ITEM_KIND_PROJECT) {
		let normalizedKind = itemKind == PROJECT_ITEM_KIND_OUTPUTS ? PROJECT_ITEM_KIND_OUTPUTS : PROJECT_ITEM_KIND_PROJECT;
		let label = normalizedKind == PROJECT_ITEM_KIND_OUTPUTS ? "Outputs" : "Project";
		return [
			`Systematic Reviewer: ${label}`,
			`Project Type: ${this._normalizeProjectType(projectType)}`,
			`Collection Key: ${collection?.key || ""}`,
			`Collection Name: ${collection?.name || ""}`,
		].join("\n");
	},

	_systematicReviewerSoftwareCitationDefinition() {
		return {
			title: "Systematic Reviewer",
			doi: "10.5281/zenodo.20044491",
			doiURL: "https://doi.org/10.5281/zenodo.20044491",
			url: "https://systematicreviewer.com",
		};
	},

	_normalizeSoftwareCitationDOI(value = "") {
		let raw = String(value || "").trim();
		if (!raw) {
			return "";
		}
		try {
			if (Zotero?.Utilities?.cleanDOI) {
				raw = Zotero.Utilities.cleanDOI(raw) || raw;
			}
		}
		catch (_err) {}
		return String(raw || "")
			.trim()
			.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
			.replace(/^doi:\s*/i, "")
			.toLowerCase();
	},

	_itemHasSystematicReviewerSoftwareCitationDOI(item) {
		if (!item) {
			return false;
		}
		let definition = this._systematicReviewerSoftwareCitationDefinition();
		let expected = this._normalizeSoftwareCitationDOI(definition.doi);
		let candidates = [
			this._itemField(item, "DOI"),
			this._itemField(item, "doi"),
			this._itemField(item, "url"),
			this._itemField(item, "extra"),
		];
		return candidates.some((value) => this._normalizeSoftwareCitationDOI(value).includes(expected));
	},

	_isSystematicReviewerSoftwareCitationItem(item) {
		if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
			return false;
		}
		return this._itemHasSystematicReviewerSoftwareCitationDOI(item);
	},

	_systematicReviewerSoftwareCitationItemForKey(libraryID, itemKey = "") {
		let key = String(itemKey || "").trim();
		if (!key || !Zotero?.Items?.getByLibraryAndKey) {
			return null;
		}
		try {
			let item = Zotero.Items.getByLibraryAndKey(libraryID, key) || null;
			return item && !item.deleted ? item : null;
		}
		catch (_err) {
			return null;
		}
	},

	async _searchSystematicReviewerSoftwareCitationCandidates(libraryID, condition, operator, value) {
		let candidates = [];
		try {
			let search = new Zotero.Search();
			search.libraryID = libraryID;
			search.addCondition(condition, operator, value);
			let ids = await search.search();
			for (let id of ids || []) {
				let item = Zotero.Items.get(id);
				if (item && !item.deleted) {
					candidates.push(item);
				}
			}
		}
		catch (_err) {
			return [];
		}
		return candidates;
	},

	async _resolveSystematicReviewerSoftwareCitationItemByDOI(libraryID, itemKey = "") {
		let normalizedLibraryID = Number(libraryID || Zotero.Libraries.userLibraryID || 0) || 0;
		if (!normalizedLibraryID) {
			return null;
		}
		let explicitItem = this._systematicReviewerSoftwareCitationItemForKey(normalizedLibraryID, itemKey);
		if (explicitItem && this._itemHasSystematicReviewerSoftwareCitationDOI(explicitItem)) {
			return explicitItem;
		}
		let definition = this._systematicReviewerSoftwareCitationDefinition();
		let candidates = new Map();
		let addCandidates = (items = []) => {
			for (let item of items || []) {
				if (item?.id && !candidates.has(item.id)) {
					candidates.set(item.id, item);
				}
			}
		};
		addCandidates(await this._searchSystematicReviewerSoftwareCitationCandidates(normalizedLibraryID, "DOI", "is", definition.doi));
		addCandidates(await this._searchSystematicReviewerSoftwareCitationCandidates(normalizedLibraryID, "DOI", "contains", definition.doi));
		for (let item of candidates.values()) {
			if (this._itemHasSystematicReviewerSoftwareCitationDOI(item)) {
				return item;
			}
		}
		return null;
	},

	async _importSystematicReviewerSoftwareCitationItem(collection) {
		if (!collection) {
			return null;
		}
		let libraryID = collection.libraryID || Zotero.Libraries.userLibraryID;
		let definition = this._systematicReviewerSoftwareCitationDefinition();
		let identifier = { DOI: definition.doi };
		let translate = new Zotero.Translate.Search();
		translate.setIdentifier(identifier);
		let translators = await translate.getTranslators();
		if (!translators || !translators.length) {
			throw new Error("No Zotero translator is available for the Systematic Reviewer DOI.");
		}
		translate.setTranslator(translators);
		let items = await translate.translate({
			libraryID,
			collections: [collection.id],
			saveAttachments: false,
		});
		let itemList = Array.isArray(items) ? items.filter((item) => item && !item.deleted) : [];
		return itemList.find((item) => this._itemHasSystematicReviewerSoftwareCitationDOI(item)) || itemList[0] || null;
	},

	async _ensureSystematicReviewerSoftwareCitationCollection(item, collection) {
		if (!item || !collection) {
			return item;
		}
		let collections = [];
		try {
			collections = item.getCollections ? item.getCollections() : [];
		}
		catch (_err) {
			collections = [];
		}
		if (!collections.includes(collection.id)) {
			item.setCollections(Array.from(new Set([...collections, collection.id])));
			await item.saveTx();
		}
		return item;
	},

	async _ensureSystematicReviewerSoftwareCitationItem(collection, itemKey = "") {
		if (!collection) {
			throw new Error("Project collection is unavailable for the Systematic Reviewer citation.");
		}
		let libraryID = collection.libraryID || Zotero.Libraries.userLibraryID;
		let item = await this._resolveSystematicReviewerSoftwareCitationItemByDOI(libraryID, itemKey);
		if (!item) {
			item = await this._importSystematicReviewerSoftwareCitationItem(collection);
		}
		if (!item) {
			throw new Error("Zotero could not import the Systematic Reviewer DOI citation.");
		}
		return await this._ensureSystematicReviewerSoftwareCitationCollection(item, collection);
	},

	async _replaceSoftwareCitationItemKeyInReport(context, oldItemKey = "", currentItemKey = "") {
		let oldKey = String(oldItemKey || "").trim();
		let currentKey = String(currentItemKey || "").trim();
		if (!context?.reportPath || !oldKey || !currentKey || oldKey == currentKey) {
			return false;
		}
		let markdown = "";
		try {
			markdown = String(await this._readFileText(context.reportPath) || "");
		}
		catch (_err) {
			return false;
		}
		let next = markdown.split(`@[${oldKey}]`).join(`@[${currentKey}]`);
		if (next == markdown) {
			return false;
		}
		await this._writeTextFile(context.reportPath, next);
		return true;
	},

	_projectShellItemKind(item) {
		if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
			return "";
		}
		if (this._isSystematicReviewerSoftwareCitationItem(item)) {
			return "";
		}
		let title = this._itemField(item, "title");
		let extra = this._itemField(item, "extra");
		if (extra.includes("Systematic Reviewer: Outputs")) {
			return PROJECT_ITEM_KIND_OUTPUTS;
		}
		if (extra.includes("Systematic Reviewer: Project")) {
			return PROJECT_ITEM_KIND_PROJECT;
		}
		if (title == "Systematic Reviewer") {
			return PROJECT_ITEM_KIND_PROJECT;
		}
		return "";
	},

	_itemBelongsToProjectShell(item) {
		if (!item || item.deleted) {
			return false;
		}
		if (this._projectShellItemKind(item)) {
			return true;
		}
		if (!item.parentItemID) {
			return false;
		}
		let parentItem = Zotero.Items.get(item.parentItemID);
		return !!this._projectShellItemKind(parentItem);
	},

	async _ensureProjectShellItemMetadata(item, collection, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW, itemKind = PROJECT_ITEM_KIND_PROJECT) {
		if (!item || item.deleted) {
			return item;
		}
		let dirty = false;
		let desiredTitle = this._projectShellItemTitle(collection, projectType, itemKind);
		let desiredExtra = this._projectShellItemExtra(collection, projectType, itemKind);
		if (this._itemField(item, "title") != desiredTitle) {
			item.setField("title", desiredTitle);
			dirty = true;
		}
		if (this._itemField(item, "extra") != desiredExtra) {
			item.setField("extra", desiredExtra);
			dirty = true;
		}
		let collections = [];
		try {
			collections = item.getCollections ? item.getCollections() : [];
		}
		catch (_err) {
			collections = [];
		}
		if (!collections.includes(collection.id)) {
			item.setCollections(Array.from(new Set([...collections, collection.id])));
			dirty = true;
		}
		if (dirty) {
			await item.saveTx();
		}
		return item;
	},

	async _ensureProjectRoot(context) {
		for (let dir of [
			context.projectRoot,
			context.snapshotsDir,
			context.templatesDir,
			context.outputsDir,
			context.conversionsDir,
			context.jobsDir,
			context.sessionsDir,
			context.sourcesDir,
		]) {
			await this._ensureDirectory(dir);
		}
	},

	async _resolveProjectItem(collection, explicitKey = "", createIfMissing = false, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW) {
		let items = collection.getChildItems ? collection.getChildItems(false, false) : [];
		let fallback = null;
		for (let item of items) {
			if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
				continue;
			}
			let title = this._itemField(item, "title");
			let extra = this._itemField(item, "extra");
			if (explicitKey && item.key == explicitKey) {
				return createIfMissing
					? await this._ensureProjectShellItemMetadata(item, collection, projectType, PROJECT_ITEM_KIND_PROJECT)
					: item;
			}
			if (this._projectShellItemKind(item) == PROJECT_ITEM_KIND_PROJECT) {
				return createIfMissing
					? await this._ensureProjectShellItemMetadata(item, collection, projectType, PROJECT_ITEM_KIND_PROJECT)
					: item;
			}
			if (!fallback && title == "Systematic Reviewer") {
				fallback = item;
			}
		}
		if (fallback) {
			return createIfMissing
				? await this._ensureProjectShellItemMetadata(fallback, collection, projectType, PROJECT_ITEM_KIND_PROJECT)
				: fallback;
		}
		if (!createIfMissing) {
			return null;
		}

		let item = new Zotero.Item("document");
		item.libraryID = collection.libraryID || Zotero.Libraries.userLibraryID;
		item.setField("title", this._projectShellItemTitle(collection, projectType, PROJECT_ITEM_KIND_PROJECT));
		item.setField("extra", this._projectShellItemExtra(collection, projectType, PROJECT_ITEM_KIND_PROJECT));
		item.setCollections([collection.id]);
		await item.saveTx();
		return item;
	},

	async _resolveProjectOutputsItem(collection, explicitKey = "", createIfMissing = false, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW) {
		let items = collection.getChildItems ? collection.getChildItems(false, false) : [];
		for (let item of items) {
			if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
				continue;
			}
			if (explicitKey && item.key == explicitKey) {
				return createIfMissing
					? await this._ensureProjectShellItemMetadata(item, collection, projectType, PROJECT_ITEM_KIND_OUTPUTS)
					: item;
			}
			if (this._projectShellItemKind(item) == PROJECT_ITEM_KIND_OUTPUTS) {
				return createIfMissing
					? await this._ensureProjectShellItemMetadata(item, collection, projectType, PROJECT_ITEM_KIND_OUTPUTS)
					: item;
			}
		}
		if (!createIfMissing) {
			return null;
		}
		let item = new Zotero.Item("document");
		item.libraryID = collection.libraryID || Zotero.Libraries.userLibraryID;
		item.setField("title", this._projectShellItemTitle(collection, projectType, PROJECT_ITEM_KIND_OUTPUTS));
		item.setField("extra", this._projectShellItemExtra(collection, projectType, PROJECT_ITEM_KIND_OUTPUTS));
		item.setCollections([collection.id]);
		await item.saveTx();
		return item;
	},

	async _ensureDirectChildCollection(rootCollection, name) {
		let targetName = String(name || "").trim();
		if (!targetName) {
			return null;
		}
		for (let node of this._projectCollectionNodes(rootCollection)) {
			if (node?.parentKey == rootCollection.key && String(node?.collection?.name || "").trim().toLowerCase() == targetName.toLowerCase()) {
				return node.collection;
			}
		}
		let collection = new Zotero.Collection();
		collection.libraryID = rootCollection.libraryID;
		collection.name = targetName;
		collection.parentID = rootCollection.id;
		await collection.saveTx();
		return collection;
	},

	async _resolveCustomAnalysisDataCollection(rootCollection, options = {}) {
		if (!rootCollection) {
			return null;
		}
		let preferredName = String(CUSTOM_ANALYSIS_COLLECTION_NAME || "").trim();
		let legacyName = String(CUSTOM_ANALYSIS_LEGACY_COLLECTION_NAME || "").trim();
		let preferred = null;
		let legacy = null;
		for (let node of this._projectCollectionNodes(rootCollection)) {
			if (node?.parentKey != rootCollection.key || !node?.collection) {
				continue;
			}
			let nodeName = String(node.collection.name || "").trim().toLowerCase();
			if (!preferred && preferredName && nodeName == preferredName.toLowerCase()) {
				preferred = node.collection;
			}
			if (!legacy && legacyName && nodeName == legacyName.toLowerCase()) {
				legacy = node.collection;
			}
		}
		if (preferred) {
			return preferred;
		}
		if (legacy) {
			return legacy;
		}
		return options?.createMissing
			? await this._ensureDirectChildCollection(rootCollection, preferredName)
			: null;
	},

	async _moveDirectRootItems(rootCollection, targetCollection, excludeItemIDs = []) {
		if (!rootCollection || !targetCollection) {
			return 0;
		}
		let excluded = new Set((excludeItemIDs || []).filter(Boolean));
		let itemIDs = [];
		for (let item of rootCollection.getChildItems ? rootCollection.getChildItems(false, false) : []) {
			if (!item || item.deleted || excluded.has(item.id)) {
				continue;
			}
			itemIDs.push(item.id);
		}
		if (!itemIDs.length) {
			return 0;
		}
		await Zotero.DB.executeTransaction(async () => {
			await targetCollection.addItems(itemIDs);
			await rootCollection.removeItems(itemIDs);
		});
		return itemIDs.length;
	},

	async _initializeProjectCollections(context, collection, projectItem, projectType, projectOutputsItem = null) {
		let normalizedType = this._normalizeProjectType(projectType);
		if (normalizedType == PROJECT_TYPE_CUSTOM_ANALYSIS) {
			await this._resolveCustomAnalysisDataCollection(collection, {
				createMissing: true,
			});
			return;
		}
		let current = {
			context,
			collection,
			projectItem,
		};
		await SystematicReviewerWorkflowHarvest.ensureProjectCollections(this, current, {
			ensureAddedByUser: false,
		});
	},

	async _ensureProjectScaffold(context, collection, projectItem, options = {}) {
		let projectType = this._normalizeProjectType(options.projectType || options.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW);
		let projectOutputsItem = options.projectOutputsItem || options.project_outputs_item || null;
		let reportExists = await this._pathExists(context.reportPath);
		let settings = (await this._readJSONFile(context.settingsPath)) || {};
		let storedSoftwareCitationItemKey = String(settings.software_citation_item_key || "").trim();
		let softwareCitationItem = null;
		if (!reportExists || storedSoftwareCitationItemKey) {
			try {
				softwareCitationItem = await this._ensureSystematicReviewerSoftwareCitationItem(collection, storedSoftwareCitationItemKey);
				if (reportExists && storedSoftwareCitationItemKey && softwareCitationItem?.key) {
					await this._replaceSoftwareCitationItemKeyInReport(context, storedSoftwareCitationItemKey, softwareCitationItem.key);
				}
			}
			catch (error) {
				this.log(`software citation DOI import skipped: ${error?.message || error}`);
			}
		}
		if (!reportExists) {
			await this._writeTextFile(context.reportPath, this._defaultReportMarkdown(collection, projectType, {
				softwareCitationItemKey: softwareCitationItem?.key || storedSoftwareCitationItemKey || "",
			}));
		}
		if (!(await this._pathExists(context.logPath))) {
			await this._writeTextFile(context.logPath, this._defaultWorkflowLogMarkdown(collection, projectType));
		}

		settings.kind = "systematic-reviewer-settings";
		settings.version = 1;
		settings.collection = {
			library_id: context.libraryID,
			key: context.collectionKey,
			name: context.collectionName,
		};
		settings.project_type = projectType;
		settings.project_type_label = this._projectTypeLabel(projectType);
		settings.project_item_key = projectItem.key;
		settings.outputs_item_key = projectOutputsItem?.key || settings.outputs_item_key || "";
		settings.software_citation_item_key = softwareCitationItem?.key || storedSoftwareCitationItemKey || settings.software_citation_item_key || "";
		settings.collections = settings.collections && typeof settings.collections == "object" ? settings.collections : {};
		settings.database_path = context.databasePath;
		settings.report_path = context.reportPath;
		settings.log_path = context.logPath;
		settings.last_session_id = settings.last_session_id || "default";
		settings.editor = Object.assign(
			{},
			this._defaultEditorSettings(),
			settings.editor || {}
		);
		await this._writeJSONFile(context.settingsPath, settings);
		if (options.seedTemplatePack && SystematicReviewerWorkflowExtractionTemplates?.seedProjectTemplates) {
			await SystematicReviewerWorkflowExtractionTemplates.seedProjectTemplates(this, context, projectType);
		}

	},

	async _initializeStorage() {
		await this._ensureDirectory(this._storageRoot());
		await this._ensureDirectory(this._projectsRoot());
		await this._ensureDirectory(this._configRoot());
		await this._cleanupLegacyPluginState();
		await this._writeGlobalSettings();
	},

	async _cleanupLegacyPluginState() {
		try {
			let branch = Services.prefs.getBranch("extensions.zotero.panes.");
			for (let name of branch.getChildList("")) {
				if (name.includes("systematic-reviewer-sidecar")) {
					try {
						branch.clearUserPref(name);
					}
					catch (_err) {}
				}
			}
		}
		catch (_err) {}

		try {
			let pinned = Services.prefs.getStringPref("extensions.zotero.pinnedPane", "");
			if (pinned && pinned.includes("systematic-reviewer-sidecar")) {
				Services.prefs.clearUserPref("extensions.zotero.pinnedPane");
			}
		}
		catch (_err) {}
	},

	async _writeGlobalSettings() {
		let path = this._globalSettingsPath();
		let existingRaw = (await this._readJSONFile(path)) || {};
		let settings = this._normalizeGlobalSettings(existingRaw);
		settings.updated_at = new Date().toISOString();
		await this._writeGlobalSettingsRecord(path, settings, existingRaw);
	},

	async _recordLastProject(context, projectItem, sessionID, projectType = "") {
		let path = this._globalSettingsPath();
		let existingRaw = (await this._readJSONFile(path)) || {};
		let settings = this._normalizeGlobalSettings(existingRaw);
		let normalizedType = this._normalizeProjectType(projectType || await this._projectTypeForContext(context, ""));
			settings.last_project = {
				project_id: context.projectID,
				library_id: context.libraryID,
				collection_key: context.collectionKey,
				collection_name: context.collectionName,
				project_item_key: projectItem?.key || "",
				project_root: context.projectRoot,
				database_path: context.databasePath,
				project_type: normalizedType,
				last_session_id: sessionID || "default",
				updated_at: new Date().toISOString(),
		};
		settings.updated_at = new Date().toISOString();
		await this._writeGlobalSettingsRecord(path, settings, existingRaw);
	},

	_artifactAttachmentOwner(relativePath) {
		let normalized = String(relativePath || "").trim().toLowerCase();
		if (!normalized) {
			return PROJECT_ITEM_KIND_PROJECT;
		}
		if (normalized == "report.md") {
			return PROJECT_ITEM_KIND_OUTPUTS;
		}
		if (normalized.startsWith("outputs/") && (normalized.endsWith(".csv") || normalized.endsWith(".pdf"))) {
			return PROJECT_ITEM_KIND_OUTPUTS;
		}
		return PROJECT_ITEM_KIND_PROJECT;
	},

	_reconcileBatchSize(options = {}) {
		let parsed = Number(options?.batch_size || options?.batchSize || 12) || 12;
		return Math.max(1, Math.min(100, Math.round(parsed)));
	},

	async _yieldReconcileBatch(options = {}) {
		let current = options?.current || null;
		let jobID = String(options?.job_id || options?.jobID || "").trim();
		if (current && jobID && typeof this._throwIfJobCanceled == "function") {
			await this._throwIfJobCanceled(current, jobID);
		}
		if (typeof options?.onYield == "function") {
			await options.onYield();
		}
		if (typeof Zotero?.Promise?.delay == "function") {
			await Zotero.Promise.delay(0);
		}
	},

	async _reconcileCollectionProject(context, collection, projectItem, projectOutputsItem = null, options = {}) {
		let projectType = await this._projectTypeForContext(context, "");
		let outputsItem = projectOutputsItem || await this._resolveProjectOutputsItem(collection, "", true, projectType);
		await this._yieldReconcileBatch(options);
		let sourceLinks = await this._reconcileSourceLinks(context, collection, projectItem, options);
		await this._yieldReconcileBatch(options);
		let artifactFiles = this._listArtifactFiles(context.projectRoot);
		let mainArtifactFiles = artifactFiles.filter((file) => this._artifactAttachmentOwner(file.relativePath) != PROJECT_ITEM_KIND_OUTPUTS);
		let outputArtifactFiles = artifactFiles.filter((file) => this._artifactAttachmentOwner(file.relativePath) == PROJECT_ITEM_KIND_OUTPUTS);
		await this._yieldReconcileBatch(options);
		await this._reconcileProjectAttachments(projectItem, mainArtifactFiles, options);
		await this._yieldReconcileBatch(options);
		await this._reconcileProjectAttachments(outputsItem, outputArtifactFiles, options);
		let attachmentSnapshot = [
			...this._projectAttachmentSnapshot(projectItem, PROJECT_ITEM_KIND_PROJECT),
			...this._projectAttachmentSnapshot(outputsItem, PROJECT_ITEM_KIND_OUTPUTS),
		];
		let settings = (await this._readJSONFile(context.settingsPath)) || {};

			let manifest = {
				kind: "systematic-reviewer-project",
				version: 1,
					project_id: context.projectID,
					updated_at: new Date().toISOString(),
					project_type: projectType,
					root: {
						project_root: context.projectRoot,
						database_path: context.databasePath,
				},
			collection: {
				library_id: context.libraryID,
				key: context.collectionKey,
				name: context.collectionName,
			},
			collections: settings.collections || {},
			project_item_key: projectItem.key,
			outputs_item_key: outputsItem?.key || "",
			software_citation_item_key: settings.software_citation_item_key || "",
				report_path: "REPORT.md",
				log_path: "log.txt",
				settings_path: "settings.json",
				database_filename: SQLITE_FILENAME,
				files: attachmentSnapshot.map((file) => ({
				relative_path: file.relativePath,
				role: this._artifactRole(file.relativePath),
				owner: file.owner || PROJECT_ITEM_KIND_PROJECT,
				attachment_key: file.attachmentKey,
			})),
			source_links: sourceLinks,
		};
		await this._writeJSONFile(context.manifestPath, manifest);

		await this._syncProjectDatabase(
			context,
			collection,
			projectItem,
			attachmentSnapshot,
			sourceLinks,
			options
		);
	},

	_artifactRole(relativePath) {
		if (relativePath == "REPORT.md") {
			return "report";
		}
		if (relativePath == "log.txt") {
			return "log";
		}
		if (relativePath == "settings.json") {
			return "settings";
		}
		if (relativePath == "project.json") {
			return "manifest";
		}
		if (relativePath.startsWith("templates/")) {
			return "template";
		}
		if (relativePath.startsWith("outputs/")) {
			return "output";
		}
		return "artifact";
	},

	_projectAttachmentSnapshot(projectItem, owner = PROJECT_ITEM_KIND_PROJECT) {
		let snapshot = [];
		if (!projectItem || projectItem.deleted) {
			return snapshot;
		}
		for (let [relativePath, attachment] of this._existingProjectAttachments(projectItem).entries()) {
			snapshot.push({
				relativePath,
				owner,
				attachmentKey: attachment.key,
				title: this._itemField(attachment, "title") || relativePath,
				absolutePath: attachment.getFilePath ? (attachment.getFilePath() || "") : "",
			});
		}
		snapshot.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
		return snapshot;
	},

	async _reconcileProjectAttachments(projectItem, artifactFiles, options = {}) {
		let existing = this._existingProjectAttachments(projectItem);
		let expected = new Set();
		let batchSize = this._reconcileBatchSize(options);
		let processed = 0;
		for (let file of artifactFiles) {
			expected.add(file.relativePath);
			let expectedContentType = this._contentTypeForPath(file.absolutePath);
			let attachment = existing.get(file.relativePath) || null;
			if (attachment) {
				let currentPath = attachment.getFilePath ? attachment.getFilePath() : false;
				if (currentPath != file.absolutePath) {
					await attachment.relinkAttachmentFile(file.absolutePath);
				}
				let needsSave = false;
				if (this._itemField(attachment, "title") != file.relativePath) {
					attachment.setField("title", file.relativePath);
					needsSave = true;
				}
				if (expectedContentType && attachment.attachmentContentType != expectedContentType) {
					attachment.attachmentContentType = expectedContentType;
					needsSave = true;
				}
				if (needsSave) {
					await attachment.saveTx();
				}
				processed += 1;
				if (processed % batchSize === 0) {
					await this._yieldReconcileBatch(options);
				}
				continue;
			}
			await Zotero.Attachments.linkFromFile({
				file: file.absolutePath,
				parentItemID: projectItem.id,
				title: file.relativePath,
				contentType: expectedContentType,
			});
			processed += 1;
			if (processed % batchSize === 0) {
				await this._yieldReconcileBatch(options);
			}
		}

		for (let [title, attachment] of existing.entries()) {
			if (expected.has(title)) {
				continue;
			}
			await attachment.eraseTx();
			processed += 1;
			if (processed % batchSize === 0) {
				await this._yieldReconcileBatch(options);
			}
		}
	},

	_existingProjectAttachments(projectItem) {
		let out = new Map();
		let attachmentIDs = [];
		try {
			attachmentIDs = projectItem.getAttachments ? projectItem.getAttachments() : [];
		}
		catch (_err) {
			attachmentIDs = [];
		}
		let attachments = attachmentIDs.length ? Zotero.Items.get(attachmentIDs) : [];
		for (let attachment of attachments) {
			if (!attachment || attachment.deleted) {
				continue;
			}
			let title = this._itemField(attachment, "title");
			if (!title) {
				continue;
			}
			out.set(title, attachment);
		}
		return out;
	},

	async _reconcileSourceLinks(context, collection, projectItem, options = {}) {
		await this._ensureDirectory(context.sourcesDir);
		let expected = new Set();
		let sourceLinks = [];
		let items = collection.getChildItems ? collection.getChildItems(false, false) : [];
		let batchSize = this._reconcileBatchSize(options);
		let processed = 0;
		for (let item of items) {
			if (!item || item.deleted || item.id == projectItem.id || this._itemBelongsToProjectShell(item) || item.isNote?.() || item.isAnnotation?.()) {
				continue;
			}
			if (item.isAttachment?.()) {
				let linked = await this._linkSourceAttachment(context, item, item);
				if (linked) {
					expected.add(linked.file_name);
					sourceLinks.push(linked.payload);
				}
				processed += 1;
				if (processed % batchSize === 0) {
					await this._yieldReconcileBatch(options);
				}
				continue;
			}
			if (!item.getAttachments) {
				continue;
			}
			for (let attachmentID of item.getAttachments()) {
				let attachment = Zotero.Items.get(attachmentID);
				if (!attachment || attachment.deleted || attachment.isNote?.() || attachment.isAnnotation?.()) {
					continue;
				}
				let linked = await this._linkSourceAttachment(context, item, attachment);
				if (linked) {
					expected.add(linked.file_name);
					sourceLinks.push(linked.payload);
				}
				processed += 1;
				if (processed % batchSize === 0) {
					await this._yieldReconcileBatch(options);
				}
			}
			processed += 1;
			if (processed % batchSize === 0) {
				await this._yieldReconcileBatch(options);
			}
		}
		await this._yieldReconcileBatch(options);
		this._removeStaleChildren(context.sourcesDir, expected);
		sourceLinks.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
		return sourceLinks;
	},

	async _linkSourceAttachment(context, sourceItem, attachment) {
		let targetPath = attachment.getFilePath ? attachment.getFilePath() : false;
		if (!targetPath) {
			return null;
		}
		let baseName = this._basename(targetPath);
		let fileName = `${sourceItem.key || "item"}__${attachment.key || "attachment"}__${this._sanitizeFileName(baseName)}`;
		let destination = this._joinPath(context.sourcesDir, fileName);
		let linked = await this._ensureSourceLink(targetPath, destination);
		return {
			file_name: fileName,
			payload: {
				relative_path: `sources/${fileName}`,
				item_key: sourceItem.key || "",
				attachment_key: attachment.key || "",
				title: this._itemField(attachment, "title") || baseName,
				linked,
			},
		};
	},

	async _ensureSourceLink(targetPath, destinationPath) {
		let normalizedTarget = this._normalizeLocalPath(targetPath);
		let normalizedDestination = this._normalizeLocalPath(destinationPath);
		let parentPath = this._parentPath(normalizedDestination);
		if (parentPath) {
			await this._ensureDirectory(parentPath);
		}
		await this._removeIfExists(normalizedDestination);
		if (this._isWindowsPlatform()) {
			let command = `mklink "${normalizedDestination.replace(/"/g, '""')}" "${normalizedTarget.replace(/"/g, '""')}"`;
			let cmdPath = this._findExecutablePath("cmd", ["C:\\Windows\\System32\\cmd.exe"]) || "C:\\Windows\\System32\\cmd.exe";
			let exitCode = this._runProcess(cmdPath, ["/d", "/s", "/c", command]);
			if (exitCode === 0) {
				return true;
			}
		}
		else {
			let lnPath = this._findExecutablePath("ln", ["/bin/ln", "/usr/bin/ln"]) || "/bin/ln";
			let exitCode = this._runProcess(lnPath, ["-sfn", normalizedTarget, normalizedDestination]);
			if (exitCode === 0) {
				return true;
			}
		}
		this._copyFileToPath(normalizedTarget, normalizedDestination);
		return false;
	},

	_removeStaleChildren(folderPath, expectedNames) {
		let folder = this._nsIFile(folderPath);
		if (!folder.exists() || !folder.isDirectory()) {
			return;
		}
		let entries = folder.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (expectedNames.has(entry.leafName)) {
				continue;
			}
			try {
				entry.remove(false);
			}
			catch (_err) {}
		}
	},

	_listArtifactFiles(projectRoot) {
		let results = [];
		let root = this._nsIFile(projectRoot);
		if (!root.exists() || !root.isDirectory()) {
			return results;
		}

		let walk = (dir, prefix) => {
			let entries = dir.directoryEntries;
			while (entries.hasMoreElements()) {
				let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
				let name = entry.leafName;
				if (!name || name.startsWith(".")) {
					continue;
				}
					let relativePath = prefix ? `${prefix}/${name}` : name;
					if (entry.isDirectory()) {
						if (["sources", "sessions", "jobs", "conversions", "Snapshots"].includes(name)) {
							continue;
						}
						walk(entry, relativePath);
						continue;
					}
					if ([SQLITE_FILENAME, CONTROL_SQLITE_FILENAME].includes(name)) {
						continue;
					}
					results.push({
						absolutePath: entry.path,
						relativePath,
				});
			}
		};
		walk(root, "");
		results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
		return results;
	},

	_softwareCitationMethodsParagraph(itemKey = "") {
		let key = String(itemKey || "").trim();
		if (!key) {
			return "";
		}
		return `This report was prepared with support from Systematic Reviewer software, which assisted with project organization, evidence workflows, and report drafting; final interpretation and edits remain the responsibility of the project team @[${key}].`;
	},

	_defaultReportMarkdown(collection, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW, options = {}) {
		let softwareCitationParagraph = this._softwareCitationMethodsParagraph(options?.softwareCitationItemKey || options?.software_citation_item_key || "");
		if (this._normalizeProjectType(projectType) == PROJECT_TYPE_SYSTEMATIC_REVIEW) {
			return [
				`# ${collection.name}`,
				"",
				"<!-- sr:page-break -->",
				"",
				"<!-- sr:toc -->",
				"",
				"<!-- sr:page-break -->",
				"",
				"## Abstract",
				"",
				"## Introduction",
				"",
				"## Methods",
				"",
				...(softwareCitationParagraph ? [softwareCitationParagraph, ""] : []),
				"### Review Question",
				"",
				"### Eligibility Criteria",
				"",
				"### Search Strategy",
				"",
				"### Harvest Log",
				"",
				"### Screening Strategy",
				"",
				"### Full-Text Retrieval",
				"",
				"### Extraction Strategy",
				"",
				"<!-- sr:page-break -->",
				"",
				"[prisma](zotero://systematic-reviewer/prisma)",
				"",
				"PRISMA Flow Diagram. The PRISMA flow diagram for the systematic review detailing the database searches, the number of abstracts screened, and the full texts retrieved.",
				"",
				"<!-- sr:page-break -->",
				"",
				"## Results",
				"",
				"### Screening Results",
				"",
				"### Full-Text Results",
				"",
				"### Data Extraction",
				"",
				"### Explore Synthesis",
				"",
				"## Discussion",
				"",
				"<!-- sr:page-break -->",
				"",
				"[bibliography](zotero://systematic-reviewer/bibliography)",
				"",
				"<!-- sr:page-break -->",
				"",
				"## Appendices",
				"",
				"### Harvest Queries",
				"",
				"### Semantic Searches",
				"",
				"### Extraction Templates",
				"",
				"### Extraction Runs",
				"",
				"### Explore Outputs",
				"",
			].join("\n");
		}
		return [
			`# ${collection.name}`,
			"",
			"## Methods",
			"",
			...(softwareCitationParagraph ? [softwareCitationParagraph, ""] : []),
			"## Analysis",
			"",
			"Start the collection report here.",
			"",
			"- This file is the canonical `REPORT.md` for the current collection project.",
			"- The linked attachment under the `Systematic Reviewer OUTPUTS` item points at this same file.",
			"- Use `/Autodrive`, `/find`, `/explore`, `/status`, or `/help` in Automation chat for project work.",
			"",
		].join("\n");
	},

	_defaultWorkflowLogMarkdown(collection, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW) {
		let label = this._normalizeProjectType(projectType) == PROJECT_TYPE_CUSTOM_ANALYSIS
			? "Custom Analysis Workflow Log"
			: "Workflow Log";
		return [
			`# ${label}`,
			"",
			`Technical workflow summaries for ${String(collection?.name || "this project").trim() || "this project"} are collected here.`,
			"",
			"- Deterministic harvest, screening, PRISMA, full-text, extraction, explore, and related tool summaries append here.",
			"- Use this log plus saved artifacts to refresh canonical REPORT.md sections in user-facing prose after major workflow runs, while keeping this log technical and append-only.",
			"",
		].join("\n");
	},

	async _projectDB(context) {
		let existing = this.projectDBs.get(context.projectID);
		if (existing && !existing.closed) {
			return existing;
		}
		await this._ensureDirectory(this._parentPath(context.databasePath));
		let db = new Zotero.DBConnection(context.databasePath);
		await db.queryAsync("PRAGMA journal_mode = WAL");
		await db.queryAsync("PRAGMA synchronous = NORMAL");
		await db.queryAsync("PRAGMA foreign_keys = ON");
		await this._ensureDatabaseSchema(db);
		this.projectDBs.set(context.projectID, db);
		return db;
	},

	_invalidateProjectDB(contextOrProjectID) {
		let projectID = typeof contextOrProjectID == "string"
			? contextOrProjectID
			: contextOrProjectID?.projectID || "";
		if (!projectID) {
			return;
		}
		let db = this.projectDBs.get(projectID);
		if (db) {
			try {
				db.closeDatabase?.();
			}
			catch (_error) {}
			this.projectDBs.delete(projectID);
		}
		this.projectInspectionCache?.delete?.(projectID);
		this.projectItemKeyAliases.delete(projectID);
	},

	async _primeProjectItemKeyAliases(context) {
		let activeContext = context?.context || context;
		let projectID = String(activeContext?.projectID || "").trim();
		if (!projectID) {
			return new Map();
		}
		let db = await this._projectDB(activeContext);
		let rows = await db.queryAsync(
			`SELECT old_item_key, current_item_key
			 FROM item_key_aliases
			 ORDER BY old_item_key ASC`
		);
		let aliasMap = new Map();
		for (let row of rows || []) {
			let oldKey = String(row.old_item_key || "").trim();
			let currentKey = String(row.current_item_key || "").trim();
			if (!oldKey || !currentKey || oldKey == currentKey) {
				continue;
			}
			aliasMap.set(oldKey, currentKey);
		}
		this.projectItemKeyAliases.set(projectID, aliasMap);
		return aliasMap;
	},

	async _ensureTableColumns(db, tableName, columnDefinitions = []) {
		let table = String(tableName || "").trim();
		if (!table || !Array.isArray(columnDefinitions) || !columnDefinitions.length) {
			return;
		}
		let rows = await db.queryAsync(`PRAGMA table_info(${table})`);
		let existing = new Set((rows || []).map((row) => String(row.name || "").trim()).filter(Boolean));
		for (let definition of columnDefinitions) {
			let columnName = String(definition?.name || "").trim();
			let sql = String(definition?.sql || "").trim();
			if (!columnName || !sql || existing.has(columnName)) {
				continue;
			}
			await db.queryAsync(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
			existing.add(columnName);
		}
	},

	async _ensureDatabaseSchema(db) {
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS project_state (
				project_id TEXT PRIMARY KEY,
				schema_version INTEGER NOT NULL,
				library_id INTEGER NOT NULL,
				root_collection_key TEXT NOT NULL,
				root_collection_name TEXT NOT NULL,
				project_item_key TEXT NOT NULL,
				project_root TEXT NOT NULL,
				database_path TEXT NOT NULL,
				report_path TEXT NOT NULL,
				settings_path TEXT NOT NULL,
				manifest_path TEXT NOT NULL,
				last_session_id TEXT NOT NULL DEFAULT 'default',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS artifact_files (
				relative_path TEXT PRIMARY KEY,
				role TEXT NOT NULL,
				linked_attachment_key TEXT,
				linked_attachment_title TEXT,
				absolute_path TEXT,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS source_links (
				relative_path TEXT PRIMARY KEY,
				item_key TEXT NOT NULL,
				attachment_key TEXT NOT NULL,
				title TEXT,
				linked INTEGER NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS item_identities (
				paper_id TEXT PRIMARY KEY,
				item_key TEXT NOT NULL UNIQUE,
				openalex_id TEXT,
				doi TEXT,
				pmid TEXT,
				arxiv_id TEXT,
				isbn TEXT,
				citation_text TEXT NOT NULL DEFAULT '',
				title TEXT NOT NULL DEFAULT '',
				year TEXT NOT NULL DEFAULT '',
				abstract_note TEXT NOT NULL DEFAULT '',
				abstract_origin TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS item_key_aliases (
				old_item_key TEXT PRIMARY KEY,
				current_item_key TEXT NOT NULL,
				paper_id TEXT,
				reason TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS item_key_reconcile_candidates (
				paper_id TEXT PRIMARY KEY,
				previous_item_key TEXT NOT NULL,
				detected_item_key TEXT NOT NULL,
				reason TEXT,
				detected_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS sessions (
				session_id TEXT PRIMARY KEY,
				title TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				is_active INTEGER NOT NULL DEFAULT 0
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS session_messages (
				session_id TEXT NOT NULL,
				sequence_no INTEGER NOT NULL,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence_no)
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS session_state (
				session_id TEXT PRIMARY KEY,
				mode TEXT NOT NULL DEFAULT 'intake',
				status TEXT NOT NULL DEFAULT 'active',
				summary_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS session_events (
				session_id TEXT NOT NULL,
				sequence_no INTEGER NOT NULL,
				event_type TEXT NOT NULL,
				role TEXT NOT NULL,
				title TEXT,
				content TEXT,
				payload_json TEXT,
				created_at TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence_no)
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS item_vectors (
				item_key TEXT NOT NULL,
				vector_kind TEXT NOT NULL,
				vector_blob BLOB NOT NULL,
				dimensions INTEGER NOT NULL,
				model TEXT,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (item_key, vector_kind)
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS item_text_sources (
				item_key TEXT NOT NULL,
				source_key TEXT NOT NULL,
				source_text TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (item_key, source_key)
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS document_chunks (
				chunk_id TEXT PRIMARY KEY,
				item_key TEXT NOT NULL,
				attachment_key TEXT,
				relative_path TEXT,
				chunk_index INTEGER NOT NULL,
				text TEXT NOT NULL,
				page_label TEXT,
				section_label TEXT,
				start_offset INTEGER NOT NULL DEFAULT 0,
				end_offset INTEGER NOT NULL DEFAULT 0,
				token_count INTEGER,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS chunk_vectors (
				chunk_id TEXT NOT NULL,
				vector_kind TEXT NOT NULL,
				vector_blob BLOB NOT NULL,
				dimensions INTEGER NOT NULL,
				model TEXT,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (chunk_id, vector_kind)
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS jobs (
				job_id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				title TEXT NOT NULL,
				status TEXT NOT NULL,
				requested_mode TEXT,
				used_mode TEXT,
				library_id INTEGER NOT NULL,
				collection_key TEXT NOT NULL,
				parent_item_key TEXT,
				source_item_key TEXT NOT NULL,
				source_attachment_key TEXT NOT NULL,
				source_title TEXT,
				source_content_type TEXT,
				source_path TEXT NOT NULL,
				output_path TEXT,
				output_attachment_key TEXT,
				fallback_used INTEGER NOT NULL DEFAULT 0,
				progress_current INTEGER NOT NULL DEFAULT 0,
				progress_total INTEGER NOT NULL DEFAULT 0,
				cancel_requested INTEGER NOT NULL DEFAULT 0,
				error_message TEXT,
				metadata_json TEXT,
				created_at TEXT NOT NULL,
				started_at TEXT,
				finished_at TEXT,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS harvest_runs (
				run_id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'openalex',
				mode TEXT NOT NULL DEFAULT 'run',
				status TEXT NOT NULL,
				request_hash TEXT NOT NULL,
				request_json TEXT NOT NULL DEFAULT '{}',
				query TEXT NOT NULL DEFAULT '',
				query_mode TEXT NOT NULL DEFAULT '',
				pagination_mode TEXT NOT NULL DEFAULT '',
				summary_path TEXT NOT NULL DEFAULT '',
				ndjson_path TEXT NOT NULL DEFAULT '',
				job_id TEXT NOT NULL DEFAULT '',
				post_import_action TEXT NOT NULL DEFAULT 'none',
				attachment_fetch_mode TEXT NOT NULL DEFAULT 'included_only',
				stage TEXT NOT NULL DEFAULT 'fetch',
				cancel_requested INTEGER NOT NULL DEFAULT 0,
				total_fetched INTEGER NOT NULL DEFAULT 0,
				processed_candidates INTEGER NOT NULL DEFAULT 0,
				imported_count INTEGER NOT NULL DEFAULT 0,
				imported_item_count INTEGER NOT NULL DEFAULT 0,
				duplicate_count INTEGER NOT NULL DEFAULT 0,
				skipped_no_abstract INTEGER NOT NULL DEFAULT 0,
				skipped_no_supported_identifier INTEGER NOT NULL DEFAULT 0,
				skipped_pmcid_without_pmid INTEGER NOT NULL DEFAULT 0,
				converted_pmcid_count INTEGER NOT NULL DEFAULT 0,
				import_error_count INTEGER NOT NULL DEFAULT 0,
				attachment_fetch_attempted INTEGER NOT NULL DEFAULT 0,
				attachment_fetch_succeeded INTEGER NOT NULL DEFAULT 0,
				attachment_fetch_failed INTEGER NOT NULL DEFAULT 0,
				page_count INTEGER NOT NULL DEFAULT 0,
				last_cursor TEXT,
				last_page INTEGER,
				next_page INTEGER,
				import_line_index INTEGER NOT NULL DEFAULT 0,
				import_candidate_index INTEGER NOT NULL DEFAULT 0,
				fetch_completed_at TEXT,
				last_heartbeat_at TEXT,
				error_message TEXT,
				created_at TEXT NOT NULL,
				started_at TEXT,
				completed_at TEXT,
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS job_logs (
				job_id TEXT NOT NULL,
				sequence_no INTEGER NOT NULL,
				level TEXT NOT NULL,
				message TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (job_id, sequence_no)
			)
		`);
		await this._ensureTableColumns(db, "item_identities", [
			{ name: "citation_text", sql: "citation_text TEXT NOT NULL DEFAULT ''" },
			{ name: "title", sql: "title TEXT NOT NULL DEFAULT ''" },
			{ name: "year", sql: "year TEXT NOT NULL DEFAULT ''" },
			{ name: "abstract_note", sql: "abstract_note TEXT NOT NULL DEFAULT ''" },
			{ name: "abstract_origin", sql: "abstract_origin TEXT NOT NULL DEFAULT ''" },
		]);
		await this._ensureTableColumns(db, "harvest_runs", [
			{ name: "cancel_requested", sql: "cancel_requested INTEGER NOT NULL DEFAULT 0" },
		]);
		await this._ensureTableColumns(db, "jobs", [
			{ name: "cancel_requested", sql: "cancel_requested INTEGER NOT NULL DEFAULT 0" },
		]);
		await this._ensureTableColumns(db, "document_chunks", [
			{ name: "start_offset", sql: "start_offset INTEGER NOT NULL DEFAULT 0" },
			{ name: "end_offset", sql: "end_offset INTEGER NOT NULL DEFAULT 0" },
		]);

		for (let sql of [
			"CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_item_key ON item_identities(item_key)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_openalex ON item_identities(openalex_id)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_doi ON item_identities(doi)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_pmid ON item_identities(pmid)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_arxiv ON item_identities(arxiv_id)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_isbn ON item_identities(isbn)",
			"CREATE INDEX IF NOT EXISTS idx_item_identities_year ON item_identities(year)",
			"CREATE INDEX IF NOT EXISTS idx_item_key_aliases_current ON item_key_aliases(current_item_key)",
			"CREATE INDEX IF NOT EXISTS idx_item_key_aliases_paper ON item_key_aliases(paper_id)",
			"CREATE INDEX IF NOT EXISTS idx_item_key_candidates_previous ON item_key_reconcile_candidates(previous_item_key)",
			"CREATE INDEX IF NOT EXISTS idx_item_key_candidates_detected ON item_key_reconcile_candidates(detected_item_key)",
			"CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, sequence_no)",
			"CREATE INDEX IF NOT EXISTS idx_session_state_status ON session_state(status, updated_at)",
			"CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, sequence_no)",
			"CREATE INDEX IF NOT EXISTS idx_item_vectors_kind ON item_vectors(vector_kind)",
			"CREATE INDEX IF NOT EXISTS idx_item_vectors_kind_model ON item_vectors(vector_kind, model, item_key)",
			"CREATE INDEX IF NOT EXISTS idx_item_text_sources_source ON item_text_sources(source_key, item_key)",
			"CREATE INDEX IF NOT EXISTS idx_document_chunks_item ON document_chunks(item_key, chunk_index)",
			"CREATE INDEX IF NOT EXISTS idx_chunk_vectors_kind ON chunk_vectors(vector_kind)",
			"CREATE INDEX IF NOT EXISTS idx_chunk_vectors_kind_model ON chunk_vectors(vector_kind, model, chunk_id)",
			"CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at)",
			"CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON jobs(project_id, created_at)",
			"CREATE INDEX IF NOT EXISTS idx_jobs_source_attachment ON jobs(source_attachment_key)",
			"CREATE INDEX IF NOT EXISTS idx_harvest_runs_project_created ON harvest_runs(project_id, created_at)",
			"CREATE INDEX IF NOT EXISTS idx_harvest_runs_request_hash ON harvest_runs(request_hash, updated_at)",
			"CREATE INDEX IF NOT EXISTS idx_harvest_runs_status_updated ON harvest_runs(status, updated_at)",
			"CREATE INDEX IF NOT EXISTS idx_harvest_runs_job_id ON harvest_runs(job_id)",
			"CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id, sequence_no)"
		]) {
			await db.queryAsync(sql);
		}
		for (let sql of [
			"DROP TABLE IF EXISTS collection_items",
			"DROP TABLE IF EXISTS collections",
			"DROP TABLE IF EXISTS items"
		]) {
			try {
				await db.queryAsync(sql);
			}
			catch (_error) {}
		}
	},

	_projectCollectionNodes(rootCollection) {
		let nodes = [{
			collection: rootCollection,
			level: 0,
			parentKey: null,
			parentID: null,
			isRoot: 1,
		}];
		let descendents = [];
		try {
			descendents = rootCollection.getDescendents(false, "collection", false) || [];
		}
		catch (_err) {
			descendents = [];
		}
		for (let desc of descendents) {
			let collection = Zotero.Collections.get(desc.id);
			if (!collection || collection.deleted) {
				continue;
			}
			let parentCollection = desc.parent ? Zotero.Collections.get(desc.parent) : null;
			nodes.push({
				collection,
				level: desc.level || 0,
				parentKey: parentCollection?.key || rootCollection.key,
				parentID: parentCollection?.id || rootCollection.id,
				isRoot: 0,
			});
		}
		return nodes;
	},

	_collectionTreeNodes(rootCollection, options = {}) {
		if (!rootCollection || rootCollection.deleted) {
			return [];
		}
		let includeDescendants = options.includeDescendants !== false;
		let nodes = [{
			collection: rootCollection,
			level: 0,
			parentKey: rootCollection.parentID ? (Zotero.Collections.get(rootCollection.parentID)?.key || null) : null,
			parentID: rootCollection.parentID || null,
			isRoot: 1,
		}];
		if (!includeDescendants) {
			return nodes;
		}
		let descendents = [];
		try {
			descendents = rootCollection.getDescendents(false, "collection", false) || [];
		}
		catch (_err) {
			descendents = [];
		}
		for (let desc of descendents) {
			let collection = desc?.id ? Zotero.Collections.get(desc.id) : null;
			if (!collection || collection.deleted) {
				continue;
			}
			let parentCollection = desc.parent ? Zotero.Collections.get(desc.parent) : null;
			nodes.push({
				collection,
				level: Number(desc.level || 0) || 0,
				parentKey: parentCollection?.key || rootCollection.key,
				parentID: parentCollection?.id || rootCollection.id,
				isRoot: 0,
			});
		}
		return nodes;
	},

	_normalizeProjectScopeValue(value) {
		let raw = String(value || "").trim().toLowerCase();
		if (!raw || ["all", "project", "root", "main", "collection"].includes(raw)) {
			return "";
		}
		if (["pending", "unreviewed"].includes(raw)) {
			return "pending";
		}
		if (["included", "include"].includes(raw)) {
			return "included";
		}
		if (["excluded", "exclude"].includes(raw)) {
			return "excluded";
		}
		if (["excluded_ft", "excluded ft", "excluded-ft", "excludedft", "fulltext_excluded", "full_text_excluded"].includes(raw)) {
			return "excluded_ft";
		}
		if (raw == "maybe") {
			return "maybe";
		}
		return raw;
	},

	_projectScopeDescriptor(rootCollection, scopeSpec = null) {
		let nodes = this._projectCollectionNodes(rootCollection);
		let explicit =
			typeof scopeSpec == "string"
			|| !!(
				scopeSpec
				&& typeof scopeSpec == "object"
				&& (
					scopeSpec.scope !== undefined
					|| scopeSpec.review_scope !== undefined
					|| scopeSpec.reviewScope !== undefined
					|| scopeSpec.collection_key !== undefined
					|| scopeSpec.collectionKey !== undefined
					|| scopeSpec.scope_collection_key !== undefined
					|| scopeSpec.scopeCollectionKey !== undefined
					|| scopeSpec.collection_name !== undefined
					|| scopeSpec.collectionName !== undefined
					|| scopeSpec.scope_collection_name !== undefined
					|| scopeSpec.scopeCollectionName !== undefined
				)
			);
		let requestedScope = "";
		let requestedCollectionKey = "";
		let requestedCollectionName = "";
		if (typeof scopeSpec == "string") {
			requestedScope = scopeSpec;
		}
		else if (scopeSpec && typeof scopeSpec == "object") {
			requestedScope =
				scopeSpec.review_scope
				?? scopeSpec.reviewScope
				?? scopeSpec.scope
				?? "";
			requestedCollectionKey =
				scopeSpec.collection_key
				?? scopeSpec.collectionKey
				?? scopeSpec.scope_collection_key
				?? scopeSpec.scopeCollectionKey
				?? "";
			requestedCollectionName =
				scopeSpec.collection_name
				?? scopeSpec.collectionName
				?? scopeSpec.scope_collection_name
				?? scopeSpec.scopeCollectionName
				?? "";
		}
		let normalizedScope = this._normalizeProjectScopeValue(requestedScope);
		let normalizedCollectionKey = String(requestedCollectionKey || "").trim();
		let normalizedCollectionName = String(requestedCollectionName || "").trim().toLowerCase();
		let layout = this._projectWorkflowTreeInfo(rootCollection, nodes);
		let reviewTargets = layout.reviewTargets;
		let targetCollection = null;
		let scopeKind = "project";
		if (normalizedCollectionKey) {
			targetCollection = nodes.find((node) => node.collection?.key == normalizedCollectionKey)?.collection || null;
			scopeKind = "collection";
		}
		else if (normalizedCollectionName) {
			targetCollection = nodes.find((node) => String(node.collection?.name || "").trim().toLowerCase() == normalizedCollectionName)?.collection || null;
			scopeKind = "collection";
		}
		else if (normalizedScope) {
			targetCollection = reviewTargets[normalizedScope]
				|| nodes.find((node) => node.collection?.key == normalizedScope)?.collection
				|| nodes.find((node) => String(node.collection?.name || "").trim().toLowerCase() == normalizedScope)?.collection
				|| null;
			scopeKind = reviewTargets[normalizedScope] ? "review" : "collection";
		}
		if (!targetCollection) {
			if (explicit && (normalizedScope || normalizedCollectionKey || normalizedCollectionName)) {
				throw new Error("Requested subcollection scope was not found inside the current project collection tree.");
			}
			let scopedNodes = layout.isSystematicReviewTree
				? nodes.filter((node) => layout.isWorkflowNode(node.collection))
				: nodes;
			return {
				root_collection_key: rootCollection.key,
				root_collection_name: rootCollection.name,
				scope_kind: "project",
				scope_key: "",
				scope_name: rootCollection.name,
				scope_collection: rootCollection,
				nodes: scopedNodes,
			};
		}
		let allowedIDs = new Set([targetCollection.id]);
		try {
			for (let desc of targetCollection.getDescendents(false, "collection", false) || []) {
				if (desc?.id) {
					allowedIDs.add(desc.id);
				}
			}
		}
		catch (_error) {}
		return {
			root_collection_key: rootCollection.key,
			root_collection_name: rootCollection.name,
			scope_kind: scopeKind,
			scope_key: String(targetCollection.key || ""),
			scope_name: String(targetCollection.name || ""),
			scope_collection: targetCollection,
			nodes: nodes.filter((node) => allowedIDs.has(node.collection?.id)),
		};
	},

	async _eachCitableItemAcrossNodes(nodes = [], projectItem = null, options = {}, visitor = null) {
		let visit = typeof visitor == "function" ? visitor : null;
		if (!visit) {
			return 0;
		}
		let batchSize = Math.max(25, Number(options.batchSize || 0) || 250);
		let dedupe = options.dedupe !== false;
		let seen = dedupe ? new Set() : null;
		let yielded = 0;
		for (let node of nodes || []) {
			let collection = node?.collection || null;
			if (!collection?.id || collection.deleted) {
				continue;
			}
			let lastItemID = 0;
			while (true) {
				let rows = await Zotero.DB.queryAsync(
					`SELECT itemID
					 FROM collectionItems
					 WHERE collectionID=? AND itemID>?
					 ORDER BY itemID ASC
					 LIMIT ?`,
					[collection.id, lastItemID, batchSize]
				);
				if (!rows?.length) {
					break;
				}
				let batchIDs = rows
					.map((row) => Number(row?.itemID || 0) || 0)
					.filter(Boolean);
				lastItemID = batchIDs[batchIDs.length - 1] || lastItemID;
				if (!batchIDs.length) {
					break;
				}
				let batchItems = Zotero.Items.get(batchIDs) || [];
				for (let item of batchItems) {
					if (!item || item.deleted || !item.key) {
						continue;
					}
					if ((projectItem && item.id == projectItem.id) || this._itemBelongsToProjectShell(item)) {
						continue;
					}
					if (item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
						continue;
					}
					let itemKey = String(item.key || "").trim();
					if (!itemKey) {
						continue;
					}
					if (seen && seen.has(itemKey)) {
						continue;
					}
					if (seen) {
						seen.add(itemKey);
					}
					yielded += 1;
					let shouldContinue = await visit(item, Object.assign({}, node || {}, {
						collection,
						itemKey,
						index: yielded,
					}));
					if (shouldContinue === false) {
						return yielded;
					}
				}
				if (typeof Zotero?.Promise?.delay == "function") {
					await Zotero.Promise.delay(0);
				}
			}
		}
		return yielded;
	},

	async _eachCollectionCitableItem(rootCollection, projectItem = null, options = {}, visitor = null) {
		let nodes = this._collectionTreeNodes(rootCollection, {
			includeDescendants: options?.includeDescendants !== false,
		});
		return await this._eachCitableItemAcrossNodes(nodes, projectItem, options, visitor);
	},

	async _eachProjectCitableItem(rootCollection, projectItem, scopeSpec = null, visitor = null, options = {}) {
		let scope = this._projectScopeDescriptor(rootCollection, scopeSpec);
		return await this._eachCitableItemAcrossNodes(scope.nodes || [], projectItem, options, visitor);
	},

	_gatherProjectItems(nodes, projectItem) {
		let items = new Map();
		let memberships = [];
		let membershipKeys = new Set();

		let addMembership = (collectionKey, itemKey, isDirect) => {
			let key = `${collectionKey}::${itemKey}`;
			if (membershipKeys.has(key)) {
				return;
			}
			membershipKeys.add(key);
			memberships.push({
				collectionKey,
				itemKey,
				isDirect,
			});
		};

		let addItem = (item) => {
			if (!item || item.deleted || !item.key) {
				return;
			}
			if (item.id == projectItem.id || item.parentItemID == projectItem.id || this._itemBelongsToProjectShell(item)) {
				return;
			}
			if (item.isNote?.() || item.isAnnotation?.()) {
				return;
			}
			items.set(item.key, this._serializeItem(item));
		};

		for (let node of nodes) {
			let directItems = node.collection.getChildItems ? node.collection.getChildItems(false, false) : [];
			let directIDs = new Set(directItems.map((item) => item.id));
			for (let item of directItems) {
				if (!item || item.deleted || item.id == projectItem.id || this._itemBelongsToProjectShell(item) || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				addItem(item);
				addMembership(node.collection.key, item.key, 1);
				if (!item.isAttachment?.() && item.getAttachments) {
					for (let attachmentID of item.getAttachments()) {
						let attachment = Zotero.Items.get(attachmentID);
						if (!attachment || attachment.deleted || attachment.isNote?.() || attachment.isAnnotation?.()) {
							continue;
						}
						addItem(attachment);
						addMembership(node.collection.key, attachment.key, directIDs.has(attachment.id) ? 1 : 0);
					}
				}
			}
		}

		return { items, memberships };
	},

	_projectCitableItems(rootCollection, projectItem, scopeSpec = null) {
		let seen = new Set();
		let items = [];
		let scope = this._projectScopeDescriptor(rootCollection, scopeSpec);
		for (let node of scope.nodes) {
			let directItems = node.collection.getChildItems ? node.collection.getChildItems(false, false) : [];
			for (let item of directItems) {
				if (!item || item.deleted || !item.key) {
					continue;
				}
				if ((projectItem && item.id == projectItem.id) || this._itemBelongsToProjectShell(item)) {
					continue;
				}
				if (item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				if (seen.has(item.key)) {
					continue;
				}
				seen.add(item.key);
				items.push(item);
			}
		}
		items.sort((a, b) => this._itemField(a, "title").localeCompare(this._itemField(b, "title")));
		return items;
	},

	_serializeItem(item) {
		let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
		let creators = [];
		try {
			creators = item.getCreators ? item.getCreators() : [];
		}
		catch (_err) {
			creators = [];
		}
		let itemType = "";
		try {
			itemType = item.itemTypeID ? Zotero.ItemTypes.getName(item.itemTypeID) : "";
		}
		catch (_err) {
			itemType = "";
		}
		let zoteroURI = "";
		try {
			zoteroURI = Zotero.URI?.getItemURI ? Zotero.URI.getItemURI(item) : "";
		}
		catch (_err) {
			zoteroURI = "";
		}
		let filePath = "";
		try {
			filePath = item.isAttachment?.() && item.getFilePath ? (item.getFilePath() || "") : "";
		}
		catch (_err) {
			filePath = "";
		}
		return {
			itemKey: item.key,
			libraryID: item.libraryID || Zotero.Libraries.userLibraryID,
			itemID: item.id,
			parentItemKey: parentItem?.key || "",
			parentItemID: item.parentItemID || null,
			itemType: itemType || (item.isAttachment?.() ? "attachment" : "item"),
			title: this._itemField(item, "title"),
			publicationTitle: this._itemField(item, "publicationTitle"),
			abstractNote: this._itemField(item, "abstractNote"),
			creatorsJSON: JSON.stringify(creators),
			year: this._extractYear(this._itemField(item, "date")),
			doi: this._itemField(item, "DOI"),
			pmid: this._itemField(item, "PMID"),
			arxiv: this._itemField(item, "arXiv"),
			isbn: this._itemField(item, "ISBN"),
			openalexID: this._openAlexIDFromExtra(this._itemField(item, "extra")),
			paperID: this._paperIDFromExtra(this._itemField(item, "extra")),
			zoteroURI,
			isAttachment: item.isAttachment?.() ? 1 : 0,
			isNote: item.isNote?.() ? 1 : 0,
			contentType: item.attachmentContentType || "",
			filePath,
			attachmentLinkMode: item.isAttachment?.() && item.attachmentLinkMode !== undefined
				? item.attachmentLinkMode
				: null,
			updatedAt: new Date().toISOString(),
		};
	},

	async _syncProjectDatabase(context, collection, projectItem, attachmentSnapshot, sourceLinks, options = {}) {
		let db = await this._projectDB(context);
		let now = new Date().toISOString();
		let createdAt = (await this._dbValue(
			db,
			"SELECT created_at AS value FROM project_state WHERE project_id=?",
			[context.projectID]
		)) || now;
		let lastSessionID = await this._desiredSessionID(context, db);

		await db.executeTransaction(async () => {
			await db.queryAsync("DELETE FROM artifact_files");
			await db.queryAsync("DELETE FROM source_links");

			await db.queryAsync(
				`INSERT OR REPLACE INTO project_state (
					project_id, schema_version, library_id, root_collection_key, root_collection_name,
					project_item_key, project_root, database_path, report_path, settings_path,
					manifest_path, last_session_id, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					context.projectID,
					SQLITE_SCHEMA_VERSION,
					context.libraryID,
					context.collectionKey,
					context.collectionName,
					projectItem.key,
					context.projectRoot,
					context.databasePath,
					context.reportPath,
					context.settingsPath,
					context.manifestPath,
					lastSessionID,
					createdAt,
					now,
				]
			);

				for (let artifact of attachmentSnapshot) {
				await db.queryAsync(
					`INSERT OR REPLACE INTO artifact_files (
						relative_path, role, linked_attachment_key, linked_attachment_title,
						absolute_path, updated_at
					) VALUES (?, ?, ?, ?, ?, ?)`,
					[
						artifact.relativePath,
						this._artifactRole(artifact.relativePath),
						artifact.attachmentKey || null,
						artifact.title || artifact.relativePath,
						artifact.absolutePath || null,
						now,
					]
				);
			}

			for (let source of sourceLinks) {
				await db.queryAsync(
					`INSERT OR REPLACE INTO source_links (
						relative_path, item_key, attachment_key, title, linked, updated_at
					) VALUES (?, ?, ?, ?, ?, ?)`,
					[
						source.relative_path,
						source.item_key,
						source.attachment_key,
						source.title,
						source.linked ? 1 : 0,
						now,
					]
				);
			}

			});

			await this._ensureActiveSession(context);
			await this._yieldReconcileBatch(options);
		},
	};
