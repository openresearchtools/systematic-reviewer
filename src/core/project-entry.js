var SystematicReviewerProjectEntry = {
	_projectOpenHintText() {
		return "Right-click My Library and choose Systematic Reviewer to create a new project, or right-click an existing Systematic Reviewer / Custom Analysis collection to open it.";
	},

	_projectOpenStatusLabel() {
		return "Open from My Library or existing project";
	},

	_normalizeConfiguredPdfConversionMode(mode = "") {
		let normalized = String(mode || "").trim();
		return ["fast", "vlm", "fast_with_vlm_fallback"].includes(normalized)
			? normalized
			: "fast";
	},

	_configuredPdfConversionModeSync() {
		let settings = typeof this._globalSettingsSync == "function"
			? this._globalSettingsSync()
			: null;
		return this._normalizeConfiguredPdfConversionMode(
			settings?.pdf_markdown?.mode || settings?.pdfMarkdown?.mode || ""
		);
	},

	async _configuredPdfConversionMode() {
		let config = typeof this._conversionConfig == "function"
			? await this._conversionConfig().catch(() => null)
			: null;
		return this._normalizeConfiguredPdfConversionMode(
			config?.pdf_markdown?.mode || config?.pdfMarkdown?.mode || ""
		);
	},

	_configuredPdfConversionMenuLabel(mode = "") {
		let normalized = this._normalizeConfiguredPdfConversionMode(mode);
		if (normalized == "fast") {
			return "Configured (FAST)";
		}
		if (normalized == "vlm") {
			return "Configured (VLM)";
		}
		return "Configured (FAST -> VLM)";
	},

	async _updateCollectionMenuState(win, updateID = null) {
		let item = win.document.getElementById(this.collectionMenuId);
		let separator = win.document.getElementById(this.collectionMenuSeparatorId);
		let systematicItem = win.document.getElementById(this.collectionMenuSystematicId);
		let customItem = win.document.getElementById(this.collectionMenuCustomId);
		let importItem = win.document.getElementById(this.collectionMenuImportId);
		let mergeHarvestItem = win.document.getElementById(this.collectionMenuMergeHarvestId);
		let selection = await this._selectedCollectionMenuContext(win);
		if (updateID !== null && this.windowState.get(win)?.collectionMenuUpdateID !== updateID) {
			return;
		}
		let visible = !!(
			selection?.isPersonalLibraryRoot
			|| selection?.projectAvailable
			|| selection?.harvestSelection
		);
		let systematicAvailable = !!(
			selection?.isPersonalLibraryRoot
			|| (selection?.projectAvailable && selection?.projectType == PROJECT_TYPE_SYSTEMATIC_REVIEW)
		);
		let customAvailable = !!(
			selection?.isPersonalLibraryRoot
			|| (selection?.projectAvailable && selection?.projectType == PROJECT_TYPE_CUSTOM_ANALYSIS)
		);
		let importAvailable = !!selection?.projectAvailable;
		let mergeAvailable = !!selection?.harvestSelection;
		if (item) {
			item.hidden = !visible;
		}
		if (separator) {
			separator.hidden = !visible;
		}
		if (systematicItem) {
			systematicItem.hidden = !visible || !systematicAvailable;
			systematicItem.disabled = !visible || !systematicAvailable;
			systematicItem.setAttribute(
				"label",
				selection?.isPersonalLibraryRoot ? "New Systematic Review" : "Open Systematic Review"
			);
		}
		if (customItem) {
			customItem.hidden = !visible || !customAvailable;
			customItem.disabled = !visible || !customAvailable;
			customItem.setAttribute(
				"label",
				selection?.isPersonalLibraryRoot ? "Custom Analysis" : "Open Custom Analysis"
			);
		}
		if (importItem) {
			importItem.hidden = !importAvailable;
			importItem.disabled = !importAvailable;
			importItem.setAttribute("label", "Import...");
		}
		if (mergeHarvestItem) {
			mergeHarvestItem.hidden = !mergeAvailable;
			mergeHarvestItem.disabled = !mergeAvailable;
			mergeHarvestItem.setAttribute("label", "Merge into Pending");
		}
	},

	_updateItemMenuState(win) {
		let menu = win.document.getElementById(this.itemMenuId);
		let separator = win.document.getElementById(this.itemMenuSeparatorId);
		let autoItem = win.document.getElementById(this.itemMenuAutoId);
		let fastItem = win.document.getElementById(this.itemMenuFastId);
		let vlmItem = win.document.getElementById(this.itemMenuVlmId);
		let jobsItem = win.document.getElementById(this.itemMenuJobsId);
		let collection = this._selectedCollection(win);
		let sources = this._selectedConvertibleSources(win);
		let visible = !!(collection && sources.length);
		let hasPdf = sources.some((source) => source.kind == "pdf");
		if (menu) {
			menu.hidden = !visible;
		}
		if (separator) {
			separator.hidden = !visible;
		}
		if (autoItem) {
			autoItem.hidden = !visible;
			autoItem.disabled = !visible;
			autoItem.setAttribute("label", this._configuredPdfConversionMenuLabel(this._configuredPdfConversionModeSync()));
		}
		if (fastItem) {
			fastItem.hidden = !visible;
			fastItem.disabled = !hasPdf;
		}
		if (vlmItem) {
			vlmItem.hidden = !visible;
			vlmItem.disabled = !visible;
		}
		if (jobsItem) {
			jobsItem.hidden = !visible;
			jobsItem.disabled = !visible;
		}
	},

	_selectedCollectionTreeRow(win) {
		let pane = win?.ZoteroPane;
		if (!pane) {
			return null;
		}
		// Zotero 10 removed the singular getter after adding multi-row selection.
		// Prefer the plural API when available, but retain the legacy fallback so
		// the same build continues to work on Zotero 7-9.
		if (typeof pane.getCollectionTreeRows == "function") {
			try {
				let rows = pane.getCollectionTreeRows() || [];
				return rows.length == 1 ? rows[0] : null;
			}
			catch (_err) {
				return null;
			}
		}
		try {
			return pane.getCollectionTreeRow?.() || null;
		}
		catch (_err) {
			return null;
		}
	},

	_selectedCollection(win) {
		let row = this._selectedCollectionTreeRow(win);
		if (!row || typeof row.isCollection != "function" || !row.isCollection()) {
			return null;
		}
		return row.ref || null;
	},

	_selectedItems(win) {
		try {
			return win?.ZoteroPane?.getSelectedItems?.() || [];
		}
		catch (_err) {
			return [];
		}
	},

	_libraryIDForTreeRow(row) {
		if (!row?.ref) {
			return 0;
		}
		return Number(row.ref.libraryID || row.ref.id || row.ref.libraryId || 0) || 0;
	},

	_isPersonalLibraryRootRow(row) {
		return !!(
			row
			&& typeof row.isLibrary == "function"
			&& row.isLibrary()
			&& this._libraryIDForTreeRow(row) == (Number(Zotero.Libraries.userLibraryID || 0) || 0)
		);
	},

	async _selectedCollectionMenuContext(win) {
		let row = this._selectedCollectionTreeRow(win || this._primaryWindow());
		let collection = row && typeof row.isCollection == "function" && row.isCollection()
			? (row.ref || null)
			: null;
		let isPersonalLibraryRoot = this._isPersonalLibraryRootRow(row);
		let rootCollection = collection && this._isRootCollection(collection) ? collection : null;
		let projectAvailable = false;
		let projectType = "";
		if (rootCollection) {
			projectAvailable = await this._collectionHasStoredProject(rootCollection);
			if (projectAvailable) {
				let context = this._collectionProjectContext(rootCollection);
				projectType = await this._projectTypeForContext(context, PROJECT_TYPE_SYSTEMATIC_REVIEW);
			}
		}
		let harvestSelection = (!isPersonalLibraryRoot && !rootCollection)
			? await this._selectedHarvestSourceProjectInfo(win || this._primaryWindow())
			: null;
		return {
			row,
			collection,
			rootCollection,
			isPersonalLibraryRoot,
			projectAvailable,
			projectType,
			harvestSelection,
		};
	},

	_displayTemporaryMessage(win, message) {
		if (!message || !win?.ZoteroPane?.displayTemporaryMessage) {
			return;
		}
		try {
			win.ZoteroPane.displayTemporaryMessage(String(message));
		}
		catch (_error) {}
	},

	_promptForText(win, title, message, defaultValue = "") {
		let promptService = Services.prompt;
		let input = { value: String(defaultValue || "") };
		let check = { value: false };
		let accepted = false;
		try {
			accepted = promptService.prompt(win || this._primaryWindow(), title, message, input, null, check);
		}
		catch (_error) {
			accepted = false;
		}
		return accepted ? String(input.value || "") : null;
	},

	_normalizeChoiceEntries(choices = []) {
		return (choices || [])
			.map((choice) => {
				if (choice && typeof choice == "object" && !Array.isArray(choice)) {
					return {
						label: String(choice.label || choice.value || "").trim(),
						value: String(choice.value || choice.label || "").trim(),
					};
				}
				let text = String(choice || "").trim();
				return { label: text, value: text };
			})
			.filter((choice) => choice.label && choice.value);
	},

	_clampChoiceIndex(choiceCount, defaultIndex = 0) {
		return Math.max(
			0,
			Math.min(
				Math.max(0, Number(choiceCount || 0) - 1),
				Number(defaultIndex || 0) || 0
			)
		);
	},

	_promptForChoice(win, title, message, choices = [], options = {}) {
		let normalizedChoices = this._normalizeChoiceEntries(choices);
		if (!normalizedChoices.length) {
			return "";
		}
		let promptService = Services.prompt;
		let targetWin = win || this._primaryWindow();
		let defaultIndex = this._clampChoiceIndex(normalizedChoices.length, options?.defaultIndex || 0);
		let selected = { value: defaultIndex };
		try {
			if (options?.forceTextFallback !== true && typeof promptService.select == "function") {
				let accepted = promptService.select(
					targetWin,
					title,
					message,
					normalizedChoices.length,
					normalizedChoices.map((choice) => choice.label),
					selected
				);
				return accepted ? String(normalizedChoices[selected.value]?.value || "") : "";
			}
		}
		catch (_error) {}
		if (normalizedChoices.length <= 2 && typeof promptService.confirmEx == "function") {
			try {
				let flags =
					promptService.BUTTON_POS_0 * promptService.BUTTON_TITLE_IS_STRING
					+ promptService.BUTTON_POS_1 * promptService.BUTTON_TITLE_IS_STRING
					+ promptService.BUTTON_POS_2 * promptService.BUTTON_TITLE_CANCEL;
				let result = promptService.confirmEx(
					targetWin,
					title,
					message,
					flags,
					normalizedChoices[0]?.label || "",
					normalizedChoices[1]?.label || "",
					null,
					null,
					{}
				);
				if (result >= 0 && result < normalizedChoices.length) {
					return String(normalizedChoices[result]?.value || "");
				}
			}
			catch (_error) {}
		}
		let previous = String(defaultIndex + 1);
		let menuLines = normalizedChoices.map((choice, index) => `${index + 1}. ${choice.label}`);
		while (true) {
			let value = this._promptForText(
				targetWin,
				title,
				[
					String(message || "").trim(),
					"",
					...menuLines,
					"",
					`Enter a number from 1 to ${normalizedChoices.length}.`,
				].filter(Boolean).join("\n"),
				previous
			);
			if (value === null) {
				return "";
			}
			let trimmed = String(value || "").trim();
			let index = Number(trimmed);
			if (Number.isInteger(index) && index >= 1 && index <= normalizedChoices.length) {
				return String(normalizedChoices[index - 1]?.value || "");
			}
			this._alertPrompt(targetWin, `Enter a number from 1 to ${normalizedChoices.length}.`);
			previous = trimmed || previous;
		}
	},

	_alertPrompt(win, message) {
		try {
			Services.prompt.alert(win || this._primaryWindow(), "Systematic Reviewer", String(message || ""));
		}
		catch (_error) {
			this._showError(message);
		}
	},

	_topLevelCollectionNameExists(libraryID, name) {
		let targetName = String(name || "").trim().toLowerCase();
		if (!libraryID || !targetName) {
			return false;
		}
		for (let collection of Zotero.Collections.getByLibrary(libraryID, false, false) || []) {
			if (!collection || collection.deleted || collection.parentID || collection.parentKey) {
				continue;
			}
			if (String(collection.name || "").trim().toLowerCase() == targetName) {
				return true;
			}
		}
		return false;
	},

	async _promptForNewProjectCollectionName(win, projectType) {
		let projectLabel = this._projectTypeLabel(projectType || PROJECT_TYPE_SYSTEMATIC_REVIEW);
		let libraryID = Number(Zotero.Libraries.userLibraryID || 0) || 0;
		let previous = "";
		while (true) {
			let value = this._promptForText(
				win,
				"Systematic Reviewer",
				`Name for the new ${projectLabel} collection:`,
				previous
			);
			if (value === null) {
				return "";
			}
			let trimmed = String(value || "").trim();
			if (!trimmed) {
				this._alertPrompt(win, "Collection name is required.");
				previous = "";
				continue;
			}
			if (this._topLevelCollectionNameExists(libraryID, trimmed)) {
				this._alertPrompt(win, `A top-level collection named "${trimmed}" already exists in My Library.`);
				previous = trimmed;
				continue;
			}
			return trimmed;
		}
	},

	_collectionPathSegments(collection) {
		let segments = [];
		let current = this._collectionParent(collection);
		let seen = new Set();
		while (current) {
			let key = String(current.key || current.id || "");
			if (key && seen.has(key)) {
				break;
			}
			if (key) {
				seen.add(key);
			}
			segments.unshift(String(current.name || "").trim());
			current = this._collectionParent(current);
		}
		return segments.filter(Boolean);
	},

	_collectionPathLabel(collection) {
		let segments = this._collectionPathSegments(collection);
		return segments.length ? segments.join(" > ") : "Top-level collection";
	},

	_collectionIsInsideTree(collection, rootCollection) {
		if (!collection?.id || !rootCollection?.id) {
			return false;
		}
		return collection.id == rootCollection.id || this._collectionHasAncestor(collection, rootCollection.id);
	},

	_directChildCollectionByName(rootCollection, name) {
		let targetName = String(name || "").trim().toLowerCase();
		if (!rootCollection || !targetName) {
			return null;
		}
		for (let node of this._projectCollectionNodes(rootCollection)) {
			if (
				node?.collection?.key
				&& node.parentKey == rootCollection.key
				&& String(node.collection.name || "").trim().toLowerCase() == targetName
			) {
				return node.collection;
			}
		}
		return null;
	},

	_chunkValues(values = [], batchSize = 100) {
		let size = Math.max(1, Number(batchSize || 0) || 100);
		let chunks = [];
		for (let offset = 0; offset < values.length; offset += size) {
			chunks.push(values.slice(offset, offset + size));
		}
		return chunks;
	},

	_isSupportedConversionAttachment(item) {
		if (!item || item.deleted || !item.isAttachment?.()) {
			return false;
		}
		let contentType = String(item.attachmentContentType || "").toLowerCase();
		if (contentType == "application/pdf" || contentType == "image/png" || contentType == "image/jpeg") {
			return true;
		}
		let filePath = item.getFilePath ? (item.getFilePath() || "") : "";
		let lower = String(filePath).toLowerCase();
		return lower.endsWith(".pdf") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
	},

	_conversionKindForItem(item) {
		let contentType = String(item?.attachmentContentType || "").toLowerCase();
		let filePath = item?.getFilePath ? (item.getFilePath() || "") : "";
		let lower = String(filePath).toLowerCase();
		if (contentType == "application/pdf" || lower.endsWith(".pdf")) {
			return "pdf";
		}
		if (
			contentType == "image/png" ||
			contentType == "image/jpeg" ||
			lower.endsWith(".png") ||
			lower.endsWith(".jpg") ||
			lower.endsWith(".jpeg")
		) {
			return "image";
		}
		return "";
	},

	_selectedConvertibleSources(win) {
		let items = this._selectedItems(win);
		let sources = [];
		let seen = new Set();
		let addSource = (attachment, parentItem) => {
			if (!attachment || !this._isSupportedConversionAttachment(attachment)) {
				return;
			}
			let key = attachment.key || `${attachment.id}`;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			sources.push({
				attachment,
				parentItem: parentItem || null,
				kind: this._conversionKindForItem(attachment),
				path: attachment.getFilePath ? (attachment.getFilePath() || "") : "",
			});
		};

		for (let item of items) {
			if (!item || item.deleted) {
				continue;
			}
			if (item.isAttachment?.()) {
				let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
				addSource(item, parentItem);
				continue;
			}
			if (!item.getAttachments) {
				continue;
			}
			for (let attachmentID of item.getAttachments()) {
				let attachment = Zotero.Items.get(attachmentID);
				addSource(attachment, item);
			}
		}
		return sources.filter((source) => source.path);
	},

	_projectConversionSources(rootCollection, projectItem, { pdfOnly = false } = {}) {
		if (!rootCollection) {
			return [];
		}
		let sources = [];
		let seen = new Set();
		let addSource = (attachment, parentItem) => {
			if (!attachment || attachment.deleted || this._itemBelongsToProjectShell(attachment)) {
				return;
			}
			if (!this._isSupportedConversionAttachment(attachment)) {
				return;
			}
			let kind = this._conversionKindForItem(attachment);
			if (pdfOnly && kind != "pdf") {
				return;
			}
			let path = attachment.getFilePath ? (attachment.getFilePath() || "") : "";
			if (!path) {
				return;
			}
			let key = attachment.key || `${attachment.id}`;
			if (!key || seen.has(key)) {
				return;
			}
			seen.add(key);
			sources.push({
				attachment,
				parentItem: parentItem || null,
				kind,
				path,
			});
		};

		for (let node of this._projectCollectionNodes(rootCollection)) {
			let directItems = node.collection.getChildItems ? node.collection.getChildItems(false, false) : [];
			for (let item of directItems) {
				if (!item || item.deleted || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				if ((projectItem && item.id == projectItem.id) || this._itemBelongsToProjectShell(item)) {
					continue;
				}
				if (item.isAttachment?.()) {
					let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
					addSource(item, parentItem);
					continue;
				}
				if (!item.getAttachments) {
					continue;
				}
				for (let attachmentID of item.getAttachments()) {
					let attachment = Zotero.Items.get(attachmentID);
					addSource(attachment, item);
				}
			}
		}
		return sources;
	},

	async _activateSelectedCollectionProjectAction(win, options = {}) {
		let selection = await this._selectedCollectionMenuContext(win || this._primaryWindow());
		if (selection?.isPersonalLibraryRoot) {
			return await this._createSelectedCollectionProject(win, options || {});
		}
		if (selection?.rootCollection && selection?.projectAvailable) {
			return await this._openSelectedCollectionProject(win, options || {});
		}
		throw new Error(this._projectOpenHintText());
	},

	async _openSelectedCollectionProject(win, options = {}) {
		let selection = await this._selectedCollectionMenuContext(win || this._primaryWindow());
		if (!selection?.rootCollection || !selection?.projectAvailable) {
			throw new Error(this._projectOpenHintText());
		}
		let current = await this._openExistingCollectionProject(selection.rootCollection, options || {});
		await this._openWorkflowTab(win || this._primaryWindow(), current, { activeTab: "automation" });
		await this._refreshAllControllers();
		return current;
	},

	async _createSelectedCollectionProject(win, options = {}) {
		let selection = await this._selectedCollectionMenuContext(win || this._primaryWindow());
		if (!selection?.isPersonalLibraryRoot) {
			throw new Error("New Systematic Reviewer projects can only be created from My Library.");
		}
		let projectType = this._normalizeProjectType(options?.projectType || options?.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW);
		let name = await this._promptForNewProjectCollectionName(win || this._primaryWindow(), projectType);
		if (!name) {
			return null;
		}
		let collection = new Zotero.Collection();
		collection.libraryID = Number(Zotero.Libraries.userLibraryID || 0) || 0;
		collection.name = name;
		await collection.saveTx();
		let current = await this._openOrInitCollectionProject(collection, {
			projectType,
		});
		await this._openWorkflowTab(win || this._primaryWindow(), current, { activeTab: "automation" });
		await this._refreshAllControllers();
		this._displayTemporaryMessage(win || this._primaryWindow(), `Created ${this._projectTypeLabel(projectType)} "${name}".`);
		return current;
	},

	async _importCollectionEntriesForProject(current) {
		let entries = [];
		let targetRoot = current?.collection || null;
		let projectRootCache = new Map();
		for (let library of Zotero.Libraries.getAll() || []) {
			let libraryID = Number(library?.libraryID || library?.id || 0) || 0;
			if (!libraryID) {
				continue;
			}
			let libraryName = String(library?.name || libraryID || "Library").trim() || "Library";
			for (let collection of Zotero.Collections.getByLibrary(libraryID, true, false) || []) {
				if (!collection || collection.deleted) {
					continue;
				}
				if (targetRoot && this._collectionIsInsideTree(collection, targetRoot)) {
					continue;
				}
				let rootCollection = this._rootCollectionForCollection(collection) || collection;
				let rootID = Number(rootCollection?.id || 0) || 0;
				let isProjectRoot = false;
				if (rootID) {
					if (!projectRootCache.has(rootID)) {
						projectRootCache.set(rootID, await this._collectionHasStoredProject(rootCollection));
					}
					isProjectRoot = projectRootCache.get(rootID) === true;
				}
				let pathSegments = this._collectionPathSegments(collection);
				let pathLabel = pathSegments.length ? pathSegments.join(" > ") : "Top-level collection";
				let collectionName = String(collection.name || "").trim() || "(Untitled)";
				let fullPathSegments = [...pathSegments, collectionName];
				let fullPathLabel = fullPathSegments.join(" > ");
				let isTopLevel = !(collection.parentID || collection.parentKey);
				let directItems = this._collectImportSourceItems(collection, {
					includeDescendants: false,
				});
				let treeItems = this._collectImportSourceItems(collection, {
					includeDescendants: true,
				});
				let directItemIDs = directItems
					.map((item) => this._importItemIdentity(item))
					.filter(Boolean);
				let treeItemIDs = treeItems
					.map((item) => this._importItemIdentity(item))
					.filter(Boolean);
				entries.push({
					collection,
					key: String(collection.key || ""),
					libraryID,
					libraryName,
					name: collectionName,
					pathSegments,
					pathLabel,
					fullPathSegments,
					fullPathLabel,
					depth: pathSegments.length,
					isTopLevel,
					typeLabel: isProjectRoot ? "Project" : (isTopLevel ? "Top" : "Sub"),
					isProjectRoot,
					direct_item_ids: directItemIDs,
					tree_item_ids: treeItemIDs,
					direct_item_count: directItemIDs.length,
					tree_item_count: treeItemIDs.length,
					searchText: `${libraryName} ${fullPathLabel} ${pathLabel}`.toLowerCase(),
				});
			}
		}
		entries.sort((left, right) =>
			String(left.libraryName || "").localeCompare(String(right.libraryName || ""))
			|| String(left.fullPathLabel || "").localeCompare(String(right.fullPathLabel || ""))
		);
		return entries;
	},

	_importItemIdentity(item) {
		let libraryID = Number(item?.libraryID || 0) || 0;
		let key = String(item?.key || "").trim();
		if (libraryID && key) {
			return `${libraryID}:${key}`;
		}
		let id = Number(item?.id || 0) || 0;
		return id ? `id:${id}` : "";
	},

	_collectImportSourceItems(sourceCollection, { includeDescendants = false } = {}) {
		if (!sourceCollection) {
			return [];
		}
		let collections = [sourceCollection];
		if (includeDescendants && sourceCollection.getDescendents) {
			for (let desc of sourceCollection.getDescendents(false, "collection", false) || []) {
				let collection = Zotero.Collections.get(Number(desc?.id || 0) || 0);
				if (collection && !collection.deleted) {
					collections.push(collection);
				}
			}
		}
		let items = [];
		let seenIDs = new Set();
		let addItem = (item) => {
			if (!item || item.deleted || item.isNote?.() || item.isAnnotation?.()) {
				return;
			}
			let target = item;
			if (item.isAttachment?.() && item.parentItemID) {
				let parentItem = Zotero.Items.get(item.parentItemID);
				if (parentItem && !parentItem.deleted && !parentItem.isNote?.() && !parentItem.isAnnotation?.()) {
					target = parentItem;
				}
			}
			if (!target || target.deleted || target.isNote?.() || target.isAnnotation?.() || this._itemBelongsToProjectShell(target)) {
				return;
			}
			let id = Number(target.id || 0) || 0;
			if (!id || seenIDs.has(id)) {
				return;
			}
			seenIDs.add(id);
			items.push(target);
		};
		for (let collection of collections) {
			let directItems = collection.getChildItems ? collection.getChildItems(false, false) : [];
			for (let item of directItems) {
				addItem(item);
			}
		}
		return items;
	},

	_collectImportSourceItemsFromCollections(sourceCollections = [], { includeDescendants = false } = {}) {
		let items = [];
		let seenIdentities = new Set();
		for (let sourceCollection of sourceCollections || []) {
			if (!sourceCollection) {
				continue;
			}
			for (let item of this._collectImportSourceItems(sourceCollection, {
				includeDescendants,
			})) {
				let identity = this._importItemIdentity(item);
				if (!identity || seenIdentities.has(identity)) {
					continue;
				}
				seenIdentities.add(identity);
				items.push(item);
			}
		}
		return items;
	},

	async _addItemsToCollection(targetCollection, items = []) {
		let itemIDs = [];
		for (let item of items || []) {
			let id = Number(item?.id || 0) || 0;
			if (id) {
				itemIDs.push(id);
			}
		}
		let uniqueItemIDs = Array.from(new Set(itemIDs));
		await Zotero.DB.executeTransaction(async () => {
			for (let chunk of this._chunkValues(uniqueItemIDs, 100)) {
				if (chunk.length) {
					await targetCollection.addItems(chunk);
				}
			}
		});
		return itemIDs.length;
	},

	async _hydrateImportedProjectItems(current, items = []) {
		let itemList = (items || []).filter((item) =>
			item
			&& !item.deleted
			&& !item.isAttachment?.()
			&& !item.isNote?.()
			&& !item.isAnnotation?.()
		);
		if (!current?.context || !itemList.length) {
			return new Map();
		}
		if (typeof this._ensureProjectItemIdentitiesBatched == "function") {
			return await this._ensureProjectItemIdentitiesBatched(current.context, itemList, null, 25);
		}
		if (typeof this._ensureProjectItemIdentities == "function") {
			return await this._ensureProjectItemIdentities(current.context, itemList);
		}
		return new Map();
	},

	_reloadImportedItems(items = []) {
		let reloaded = [];
		let seen = new Set();
		for (let item of items || []) {
			if (!item || item.deleted) {
				continue;
			}
			let key = String(item.key || "").trim();
			let libraryID = Number(item.libraryID || 0) || 0;
			let identity = key ? `${libraryID}:${key}` : String(Number(item.id || 0) || 0);
			if (!identity || identity == "0" || seen.has(identity)) {
				continue;
			}
			seen.add(identity);
			let fresh = null;
			if (libraryID && key && Zotero.Items.getByLibraryAndKey) {
				fresh = Zotero.Items.getByLibraryAndKey(libraryID, key) || null;
			}
			if (!fresh) {
				let id = Number(item.id || 0) || 0;
				fresh = id ? (Zotero.Items.get(id) || null) : null;
			}
			if (fresh && !fresh.deleted) {
				reloaded.push(fresh);
			}
		}
		return reloaded;
	},

	async _copyImportItemToLibrary(item, targetLibraryID) {
		if (!item || item.deleted || !targetLibraryID) {
			return null;
		}
		let existingLinked = typeof item.getLinkedItem == "function"
			? await item.getLinkedItem(targetLibraryID, true).catch(() => null)
			: null;
		if (existingLinked) {
			if (!item.isAttachment?.()) {
				await this._syncLinkedImportAttachments(item, existingLinked, targetLibraryID);
			}
			return existingLinked;
		}
		if (item.isAttachment?.()) {
			if (item.parentItemID) {
				return null;
			}
			if (item.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
				return null;
			}
			return await Zotero.Attachments.copyAttachmentToLibrary(item, targetLibraryID);
		}
		let newItem = item.clone(targetLibraryID, { skipTags: false });
		let newItemID = await newItem.save({
			skipSelect: true,
		});
		await newItem.addLinkedItem(item);
		let targetLibrary = Zotero.Libraries.get(targetLibraryID);
		let canCopyFiles = !!targetLibrary?.filesEditable;
		for (let attachment of Zotero.Items.get(item.getAttachments?.() || []) || []) {
			if (!attachment || attachment.deleted || attachment.isNote?.() || attachment.isAnnotation?.()) {
				continue;
			}
			let linkMode = attachment.attachmentLinkMode;
			if (linkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
				continue;
			}
			if (linkMode != Zotero.Attachments.LINK_MODE_LINKED_URL && !canCopyFiles) {
				continue;
			}
			await Zotero.Attachments.copyAttachmentToLibrary(attachment, targetLibraryID, newItemID);
		}
		return Zotero.Items.get(newItemID) || null;
	},

	_importAttachmentSignature(attachment) {
		if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
			return "";
		}
		let contentType = String(attachment.attachmentContentType || "").trim().toLowerCase();
		let title = String(this._itemField?.(attachment, "title") || attachment.getField?.("title") || "").trim().toLowerCase();
		let filename = String(attachment.attachmentFilename || "").trim().toLowerCase();
		return [contentType, title, filename].join("::");
	},

	async _syncLinkedImportAttachments(sourceItem, targetItem, targetLibraryID) {
		if (!sourceItem?.getAttachments || !targetItem?.id || !targetLibraryID) {
			return 0;
		}
		let targetLibrary = Zotero.Libraries.get(targetLibraryID);
		let canCopyFiles = !!targetLibrary?.filesEditable;
		let existingSignatures = new Set();
		for (let targetAttachment of Zotero.Items.get(targetItem.getAttachments?.() || []) || []) {
			let signature = this._importAttachmentSignature(targetAttachment);
			if (signature) {
				existingSignatures.add(signature);
			}
		}
		let copied = 0;
		for (let attachment of Zotero.Items.get(sourceItem.getAttachments?.() || []) || []) {
			if (!attachment || attachment.deleted || !attachment.isAttachment?.() || attachment.isNote?.() || attachment.isAnnotation?.()) {
				continue;
			}
			let linkMode = attachment.attachmentLinkMode;
			if (linkMode == Zotero.Attachments.LINK_MODE_LINKED_FILE) {
				continue;
			}
			if (linkMode != Zotero.Attachments.LINK_MODE_LINKED_URL && !canCopyFiles) {
				continue;
			}
			let alreadyLinked = typeof attachment.getLinkedItem == "function"
				? await attachment.getLinkedItem(targetLibraryID, true).catch(() => null)
				: null;
			if (alreadyLinked && !alreadyLinked.deleted) {
				let signature = this._importAttachmentSignature(alreadyLinked);
				if (signature) {
					existingSignatures.add(signature);
				}
				continue;
			}
			let signature = this._importAttachmentSignature(attachment);
			if (signature && existingSignatures.has(signature)) {
				continue;
			}
			await Zotero.Attachments.copyAttachmentToLibrary(attachment, targetLibraryID, targetItem.id);
			if (signature) {
				existingSignatures.add(signature);
			}
			copied += 1;
		}
		return copied;
	},

	async _importCollectionSourceIntoProject(current, targetCollection, sourceCollection, { includeDescendants = false } = {}) {
		return await this._importCollectionSourcesIntoProject(current, targetCollection, [sourceCollection], {
			includeDescendants,
		});
	},

	async _importCollectionSourcesIntoProject(current, targetCollection, sourceCollections = [], { includeDescendants = false } = {}) {
		if (!current?.context || !targetCollection) {
			throw new Error("Import target is unavailable.");
		}
		let normalizedCollections = [];
		let seenCollections = new Set();
		for (let sourceCollection of sourceCollections || []) {
			if (!sourceCollection) {
				continue;
			}
			let collectionKey = String(sourceCollection.key || sourceCollection.id || "").trim();
			if (!collectionKey || seenCollections.has(collectionKey)) {
				continue;
			}
			if (this._collectionIsInsideTree(sourceCollection, current.collection)) {
				throw new Error("Choose source collections outside this project collection tree.");
			}
			seenCollections.add(collectionKey);
			normalizedCollections.push(sourceCollection);
		}
		if (!normalizedCollections.length) {
			throw new Error("Choose at least one source collection to import.");
		}
		let sourceItems = this._collectImportSourceItemsFromCollections(normalizedCollections, {
			includeDescendants,
		});
		if (!sourceItems.length) {
			return {
				ok: true,
				importedItems: [],
				importedCount: 0,
				sourceCollections: normalizedCollections,
				copiedAcrossLibraries: false,
			};
		}
		let importedItems = [];
		let sameLibraryItems = [];
		let crossLibraryItems = [];
		for (let item of sourceItems) {
			if (Number(item?.libraryID || 0) == Number(targetCollection.libraryID || 0)) {
				sameLibraryItems.push(item);
			}
			else {
				crossLibraryItems.push(item);
			}
		}
		if (sameLibraryItems.length) {
			await this._addItemsToCollection(targetCollection, sameLibraryItems);
			importedItems.push(...sameLibraryItems);
		}
		if (crossLibraryItems.length) {
			let copiedItems = [];
			for (let item of crossLibraryItems) {
				let copied = await this._copyImportItemToLibrary(item, targetCollection.libraryID);
				if (copied) {
					copiedItems.push(copied);
				}
			}
			if (copiedItems.length) {
				await this._addItemsToCollection(targetCollection, copiedItems);
				importedItems.push(...copiedItems);
			}
		}
		return {
			ok: true,
			importedItems,
			importedCount: importedItems.length,
			sourceCollections: normalizedCollections,
			copiedAcrossLibraries: crossLibraryItems.length > 0,
		};
	},

	async _listImportTranslators() {
		let translation = new Zotero.Translate.Import();
		let translators = await translation.getTranslators();
		return Array.isArray(translators) ? translators.filter(Boolean) : [];
	},

	async _pickImportFile(win) {
		let targetWin = win || this._primaryWindow();
		if (!targetWin?.document) {
			throw new Error("A Zotero window is required to choose an import file.");
		}
		let fakeController = { doc: targetWin.document };
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		this._initFilePicker(fp, fakeController, "Import into Project", Components.interfaces.nsIFilePicker.modeOpen);
		fp.appendFilters(fp.filterAll);
		let seenFilters = new Set();
		let translators = await this._listImportTranslators();
		for (let translator of translators) {
			let label = String(translator?.label || "").trim();
			let target = String(translator?.target || "").trim();
			let key = `${label}::${target}`;
			if (!label || !target || seenFilters.has(key)) {
				continue;
			}
			seenFilters.add(key);
			fp.appendFilter(label, `*.${target}`);
		}
		let result = await new Promise((resolve) => fp.open(resolve));
		if (result != Components.interfaces.nsIFilePicker.returnOK || !fp.file) {
			return null;
		}
		return fp.file;
	},

	_fileImportDefaultName(file) {
		let leafName = String(file?.leafName || "").trim();
		if (!leafName) {
			return "";
		}
		return leafName.replace(/\.[^.]+$/, "").trim();
	},

	async _importFileSourceIntoProject(current, targetCollection, file) {
		if (!current?.context || !targetCollection || !file) {
			throw new Error("Import target is unavailable.");
		}
		let translation = new Zotero.Translate.Import();
		translation.setLocation(file);
		let translators = await translation.getTranslators();
		if (!translators || !translators.length) {
			throw new Error("No Zotero importer supports the selected file.");
		}
		translation.setTranslator(translators[0]);
		let notifierQueue = new Zotero.Notifier.Queue();
		try {
			await translation.translate({
				libraryID: current.context.libraryID,
				collections: [targetCollection.id],
				saveOptions: {
					notifierQueue,
				},
			});
		}
		finally {
			await Zotero.Notifier.commit(notifierQueue);
		}
		let importedItems = Array.isArray(translation.newItems) ? translation.newItems.filter(Boolean) : [];
		return {
			ok: true,
			importedItems,
			importedCount: importedItems.length,
			translatorLabel: String(translators[0]?.label || "").trim(),
		};
	},

	async _queueImportedMarkdownConversions(current, importedItems = []) {
		let screening = SystematicReviewerWorkflowScreening || null;
		if (
			!current?.context
			|| !screening?.fullTextSummaryForItem
			|| !screening?.pdfSourcesForItem
			|| !screening?.queueMarkdownConversionsForSources
		) {
			return {
				ok: true,
				requested_mode: "",
				queued_count: 0,
				jobs: [],
			};
		}
		let sources = [];
		let seenAttachmentKeys = new Set();
		let addSource = (source) => {
			let attachmentKey = String(source?.attachment?.key || "").trim();
			let sourcePath = String(source?.path || "").trim();
			if (!attachmentKey || !sourcePath || seenAttachmentKeys.has(attachmentKey)) {
				return;
			}
			seenAttachmentKeys.add(attachmentKey);
			sources.push(source);
		};
		for (let item of importedItems || []) {
			if (!item || item.deleted || item.isNote?.() || item.isAnnotation?.()) {
				continue;
			}
			if (item.isAttachment?.()) {
				if (item.parentItemID || this._conversionKindForItem(item) != "pdf") {
					continue;
				}
				let path = item.getFilePath ? (item.getFilePath() || "") : "";
				if (!path) {
					continue;
				}
				addSource({
					attachment: item,
					parentItem: null,
					kind: "pdf",
					path,
				});
				continue;
			}
			let summary = await screening.fullTextSummaryForItem(this, item);
			if (String(summary?.full_text_state || "").trim() != "pdf_only") {
				continue;
			}
			for (let source of await screening.pdfSourcesForItem(item)) {
				addSource(source);
			}
		}
		if (!sources.length) {
			return {
				ok: true,
				requested_mode: "",
				queued_count: 0,
				jobs: [],
			};
		}
		return await screening.queueMarkdownConversionsForSources(this, current, sources);
	},

	_promptForImportSourceType(win, current) {
		let projectLabel = this._projectTypeLabel(current?.projectType || "");
		return this._promptForChoice(
			win,
			"Systematic Reviewer",
			`Import into ${String(current?.collection?.name || current?.context?.collectionName || projectLabel || "project").trim() || "project"} from:`,
			[
				{ label: "Collection", value: "collection" },
				{ label: "File", value: "file" },
			],
			{ defaultIndex: 0 }
		);
	},

	async _promptForHarvestSourceName(win, current, defaultValue = "") {
		let previous = String(defaultValue || "").trim();
		while (true) {
			let value = this._promptForText(
				win || this._primaryWindow(),
				"Systematic Reviewer",
				"Harvest source name:",
				previous
			);
			if (value === null) {
				return "";
			}
			let trimmed = String(value || "").trim();
			if (!trimmed) {
				this._alertPrompt(win, "Harvest source name is required.");
				previous = "";
				continue;
			}
			let projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(this, current, {
				ensureAddedByUser: false,
			});
			let harvestRoot = projectCollections?.harvest?.root || null;
			if (harvestRoot && this._directChildCollectionByName(harvestRoot, trimmed)) {
				this._alertPrompt(win, `Harvest already has a source named "${trimmed}".`);
				previous = trimmed;
				continue;
			}
			return trimmed;
		}
	},

	_manualImportPostImportActionDescription(action = "", options = {}) {
		let destinationLabel = String(options?.destinationLabel || "the imported Harvest source").trim()
			|| "the imported Harvest source";
		switch (String(action || "").trim().toLowerCase()) {
			case "merge_all_embed":
				return "Move every Harvest source into Pending, deduplicate exact matches into Duplicates, then create title + abstract embeddings.";
			case "merge_all":
				return "Move every Harvest source into Pending and deduplicate exact matches into Duplicates without creating embeddings.";
			case "merge_imported_embed":
				return `Move only ${destinationLabel} into Pending, deduplicate exact matches into Duplicates, then create title + abstract embeddings.`;
			case "merge_imported":
				return `Move only ${destinationLabel} into Pending and deduplicate exact matches into Duplicates without creating embeddings.`;
			case "none":
			default:
				return `Leave records in ${destinationLabel} so you can review and merge later.`;
		}
	},

	async _openManualImportPostImportActionDialog(win, current, options = {}) {
		let dialogWin = win || this._primaryWindow();
		if (!dialogWin?.document) {
			return "";
		}
		this._ensureWorkspaceStyles(dialogWin.document);
		let doc = dialogWin.document;
		let themeClass = this._themeClassForWindow(dialogWin);
		let embeddingsReady = options?.embeddingsReady === true;
		let normalizedChoices = this._normalizeChoiceEntries(options?.choices || []);
		if (!normalizedChoices.length) {
			return "";
		}
		let defaultIndex = this._clampChoiceIndex(normalizedChoices.length, options?.defaultIndex || 0);
		let destinationLabel = String(options?.destinationLabel || "Harvest").trim() || "Harvest";
		let defaultValue = String(
			normalizedChoices[defaultIndex]?.value
			|| normalizedChoices[0]?.value
			|| ""
		).trim();
		return await new Promise((resolve) => {
			let backdrop = this._html(doc, "div", { className: `sr-dialog-backdrop ${themeClass}` });
			let dialog = this._html(doc, "div", { className: `sr-dialog sr-dialog-import-followup ${themeClass}` });
			let closeBtn = this._html(doc, "button", {
				className: "sr-workspace-btn sr-dialog-close",
				text: "X",
				attrs: { type: "button", "aria-label": "Close" },
			});
			let actionSelect = this._html(doc, "select", {
				className: "sr-field-input",
				attrs: { "aria-label": "Upon importing merge to Pending?" },
			});
			for (let choice of normalizedChoices) {
				actionSelect.appendChild(this._html(doc, "option", {
					text: choice.label,
					attrs: { value: choice.value },
				}));
			}
			actionSelect.value = defaultValue;
			if (actionSelect.value != defaultValue && normalizedChoices[0]?.value) {
				actionSelect.value = normalizedChoices[0].value;
			}
			let descriptionTitle = this._html(doc, "div", {
				className: "sr-import-followup-description-title",
				text: "",
			});
			let descriptionText = this._html(doc, "div", {
				className: "sr-import-followup-description-text",
				text: "",
			});
			let descriptionBox = this._html(doc, "div", {
				className: "sr-import-followup-description",
				children: [descriptionTitle, descriptionText],
			});
			let notes = this._html(doc, "div", {
				className: "sr-import-followup-notes",
				children: [
					!embeddingsReady
						? this._html(doc, "div", {
							className: "sr-import-followup-note",
							text: "Embed options are hidden until an Embeddings model is set up in Settings.",
						})
						: null,
					this._html(doc, "div", {
						className: "sr-import-followup-note",
						text: "These embeddings are used for Semantic Search and semantic screening.",
					}),
				].filter(Boolean),
			});
			let cancelBtn = this._html(doc, "button", {
				className: "sr-workspace-btn",
				text: "Cancel",
				attrs: { type: "button" },
			});
			let continueBtn = this._html(doc, "button", {
				className: "sr-workspace-btn sr-workspace-btn-primary",
				text: "Continue",
				attrs: { type: "button" },
			});
			let updateDescription = () => {
				let selectedValue = String(actionSelect.value || defaultValue || "").trim();
				let selectedChoice = normalizedChoices.find((choice) => choice.value == selectedValue) || normalizedChoices[0];
				descriptionTitle.textContent = selectedChoice?.label || "Choose an option";
				descriptionText.textContent = this._manualImportPostImportActionDescription(selectedValue, {
					destinationLabel,
				});
			};
			let close = (result = "") => {
				doc.defaultView.removeEventListener("keydown", keyHandler, true);
				backdrop.remove();
				resolve(String(result || ""));
			};
			let accept = () => {
				let selectedValue = String(actionSelect.value || "").trim();
				if (!selectedValue) {
					return;
				}
				close(selectedValue);
			};
			let keyHandler = (event) => {
				if (event.key == "Escape") {
					event.preventDefault();
					close("");
					return;
				}
				if (
					event.key == "Enter"
					&& !event.defaultPrevented
					&& !event.metaKey
					&& !event.ctrlKey
					&& !event.altKey
					&& event.target !== actionSelect
					&& event.target !== cancelBtn
				) {
					event.preventDefault();
					accept();
				}
			};
			doc.defaultView.addEventListener("keydown", keyHandler, true);
			backdrop.addEventListener("click", (event) => {
				if (event.target === backdrop) {
					close("");
				}
			});
			closeBtn.addEventListener("click", () => close(""));
			cancelBtn.addEventListener("click", () => close(""));
			continueBtn.addEventListener("click", accept);
			actionSelect.addEventListener("change", updateDescription);
			dialog.append(
				this._html(doc, "div", {
					className: "sr-dialog-header",
					children: [
						this._html(doc, "div", {
							className: "sr-dialog-heading",
							children: [
								this._html(doc, "div", {
									className: "sr-dialog-title",
									text: "Import follow-up",
								}),
								this._html(doc, "div", {
									className: "sr-dialog-subtitle",
									text: `Choose what should happen right after the manual import into ${destinationLabel} finishes.`,
								}),
							],
						}),
						closeBtn,
					],
				}),
				this._html(doc, "div", {
					className: "sr-dialog-body",
					children: [
						this._html(doc, "label", {
							className: "sr-field-label",
							text: "Upon importing merge to Pending?",
							children: [actionSelect],
						}),
						descriptionBox,
						notes,
					],
				}),
				this._html(doc, "div", {
					className: "sr-dialog-footer",
					children: [
						this._html(doc, "div", {
							className: "sr-dialog-subtitle",
							text: `Imported records land in ${destinationLabel} first.`,
						}),
						this._html(doc, "div", {
							className: "sr-workspace-toolbar",
							children: [cancelBtn, continueBtn],
						}),
					],
				})
			);
			backdrop.appendChild(dialog);
			doc.documentElement.appendChild(backdrop);
			updateDescription();
			dialogWin.setTimeout(() => {
				actionSelect.focus();
			}, 0);
		});
	},

	async _promptForManualImportPostImportAction(win, current, options = {}) {
		if (this._normalizeProjectType(current?.projectType || "") != PROJECT_TYPE_SYSTEMATIC_REVIEW) {
			return "none";
		}
		let embeddingsReady = SystematicReviewerWorkflowHarvest?.embeddingsAvailable
			? await SystematicReviewerWorkflowHarvest.embeddingsAvailable(this).catch(() => false)
			: !!(await this._hasConfiguredEmbeddingsModel?.().catch(() => false));
		let defaultAction = SystematicReviewerWorkflowHarvest?.normalizePostImportAction
			? SystematicReviewerWorkflowHarvest.normalizePostImportAction(
				options?.defaultAction || "",
				embeddingsReady,
				{ context: "manual_import" }
			)
			: (embeddingsReady ? "merge_all_embed" : "merge_all");
		let choices = SystematicReviewerWorkflowHarvest?.postImportActionOptions
			? SystematicReviewerWorkflowHarvest.postImportActionOptions(embeddingsReady, {
				context: "manual_import",
			})
			: [
				{ value: embeddingsReady ? "merge_all_embed" : "merge_all", label: embeddingsReady ? "Merge All & Embed" : "Merge All" },
				{ value: embeddingsReady ? "merge_imported_embed" : "merge_imported", label: embeddingsReady ? "Merge Imported Source Only & Embed" : "Merge Imported Source Only" },
				{ value: "none", label: "Do not merge" },
			];
		let helpLines = SystematicReviewerWorkflowHarvest?.postImportActionHelpLines
			? SystematicReviewerWorkflowHarvest.postImportActionHelpLines({
				context: "manual_import",
				embeddingsReady,
			})
			: [];
		let defaultIndex = Math.max(0, choices.findIndex((choice) => choice?.value == defaultAction));
		let sourceLabel = String(options?.sourceName || "").trim();
		let destinationLabel = sourceLabel ? `Harvest/${sourceLabel}` : "Harvest";
		let selected = await this._openManualImportPostImportActionDialog(
			win || this._primaryWindow(),
			current,
			{
				choices,
				defaultIndex,
				destinationLabel,
				embeddingsReady,
				helpLines,
			}
		);
		if (!selected) {
			return "";
		}
		return SystematicReviewerWorkflowHarvest?.normalizePostImportAction
			? SystematicReviewerWorkflowHarvest.normalizePostImportAction(
				selected,
				embeddingsReady,
				{ context: "manual_import" }
			)
			: String(selected || "").trim().toLowerCase();
	},

	_manualImportDefaultPostImportAction(value = "") {
		let action = String(value || "").trim().toLowerCase();
		if (action == "merge_openalex_embed") {
			return "merge_imported_embed";
		}
		if (action == "merge_openalex") {
			return "merge_imported";
		}
		return action;
	},

	async _currentProjectTypeForImport(current) {
		let normalized = this._normalizeProjectType(current?.projectType || "");
		if (normalized) {
			return normalized;
		}
		if (current?.context && typeof this._projectTypeForContext == "function") {
			return this._normalizeProjectType(
				await this._projectTypeForContext(current.context, PROJECT_TYPE_SYSTEMATIC_REVIEW)
			);
		}
		return PROJECT_TYPE_SYSTEMATIC_REVIEW;
	},

	async _runManualImportPostImportFollowup(current, targetInfo, action = "", options = {}) {
		let followup = {
			post_import_action: String(action || "").trim().toLowerCase(),
			merge_queue: null,
			merge_queue_error: "",
			embeddings_job: null,
			embeddings_skipped_reason: "",
			embeddings_error: "",
		};
		let currentProjectType = await this._currentProjectTypeForImport(current);
		if (currentProjectType != PROJECT_TYPE_SYSTEMATIC_REVIEW) {
			return followup;
		}
		let embeddingsReady = SystematicReviewerWorkflowHarvest?.embeddingsAvailable
			? await SystematicReviewerWorkflowHarvest.embeddingsAvailable(this).catch(() => false)
			: !!(await this._hasConfiguredEmbeddingsModel?.().catch(() => false));
		let normalizedAction = SystematicReviewerWorkflowHarvest?.normalizePostImportAction
			? SystematicReviewerWorkflowHarvest.normalizePostImportAction(
				followup.post_import_action,
				embeddingsReady,
				{ context: "manual_import" }
			)
			: followup.post_import_action;
		followup.post_import_action = normalizedAction;
		if (!normalizedAction || normalizedAction == "none") {
			return followup;
		}
		try {
			let mergeQueue = null;
			if (normalizedAction == "merge_all_embed" || normalizedAction == "merge_all") {
				mergeQueue = await SystematicReviewerWorkflowHarvest.queueMergeAllSourcesIntoPending({
					reviewer: this,
					current,
					payload: {
						with_embeddings: normalizedAction == "merge_all_embed",
					},
					options: {
						sourceCollection: targetInfo?.targetCollection || null,
						targetWin: options.targetWin || null,
						openJobsTab: false,
						refreshControllers: false,
						showMergeNotice: true,
						queue_origin: "project.import",
					},
				});
			}
			else if (normalizedAction == "merge_imported_embed" || normalizedAction == "merge_imported") {
				let sourceCollectionKey = String(targetInfo?.targetCollection?.key || "").trim();
				if (!sourceCollectionKey) {
					throw new Error("The imported Harvest source is not available for merge.");
				}
				let queued = await SystematicReviewerWorkflowHarvest.queueMergeSourceIntoPending({
					reviewer: this,
					current,
					payload: {
						source_collection_key: sourceCollectionKey,
						with_embeddings: normalizedAction == "merge_imported_embed",
					},
					options: {
						sourceCollection: targetInfo?.targetCollection || null,
						targetWin: options.targetWin || null,
						openJobsTab: false,
						refreshControllers: false,
						showMergeNotice: true,
						queue_origin: "project.import",
					},
				});
				mergeQueue = {
					ok: true,
					queued: !!queued?.queued,
					with_embeddings: !!queued?.with_embeddings,
					merged_sources: queued?.queued ? 1 : 0,
					jobs: queued?.job ? [queued.job] : [],
					results: [queued],
					auto_followup: queued?.auto_followup || null,
					message: queued?.message || "",
				};
			}
			followup.merge_queue = mergeQueue;
			followup.embeddings_job = mergeQueue?.auto_followup?.embeddings_job || null;
			followup.embeddings_skipped_reason = mergeQueue?.auto_followup?.embeddings_skipped_reason || "";
			followup.embeddings_error = mergeQueue?.auto_followup?.embeddings_error || "";
		}
		catch (error) {
			followup.merge_queue_error = String(error?.message || error || "").trim();
		}
		return followup;
	},

	async _openCollectionImportPickerDialog(win, current) {
		let dialogWin = win || this._primaryWindow();
		if (!dialogWin?.document) {
			throw new Error("A Zotero window is required for collection import.");
		}
		this._ensureWorkspaceStyles(dialogWin.document);
		let doc = dialogWin.document;
		let themeClass = this._themeClassForWindow(dialogWin);
		let collectionEntries = await this._importCollectionEntriesForProject(current);
		if (!collectionEntries.length) {
			this._alertPrompt(dialogWin, "No eligible Zotero collections are available to import from.");
			return null;
		}
		let entryMap = new Map(collectionEntries.map((entry) => [entry.key, entry]));
		let projectName = String(current?.collection?.name || current?.context?.collectionName || "Project").trim() || "Project";
		let state = {
			focusedKey: "",
			checkedKeys: new Set(),
			includeSubcollections: true,
		};
		let renderFrame = 0;
		return await new Promise((resolve) => {
			let backdrop = this._html(doc, "div", { className: `sr-dialog-backdrop ${themeClass}` });
			let dialog = this._html(doc, "div", { className: `sr-dialog sr-dialog-collection-picker ${themeClass}` });
			let searchInput = this._html(doc, "input", {
				className: "sr-field-input",
				attrs: { type: "search", placeholder: "Search library, path, or collection name" },
			});
			let countLabel = this._html(doc, "div", {
				className: "sr-dialog-subtitle",
				text: "",
			});
			let selectionSummary = this._html(doc, "div", {
				className: "sr-import-picker-summary",
			});
			let list = doc.createXULElement("richlistbox");
			list.className = "sr-import-picker-list";
			list.setAttribute("flex", "1");
			let includeCheckbox = doc.createXULElement("checkbox");
			includeCheckbox.className = "sr-import-picker-checkbox";
			includeCheckbox.setAttribute("native", "true");
			includeCheckbox.setAttribute("label", "Include subcollections");
			includeCheckbox.checked = true;
			let closeBtn = this._html(doc, "button", {
				className: "sr-workspace-btn sr-dialog-close",
				text: "X",
				attrs: { type: "button", "aria-label": "Close" },
			});
			let cancelBtn = this._html(doc, "button", {
				className: "sr-workspace-btn",
				text: "Cancel",
				attrs: { type: "button" },
			});
			let continueBtn = this._html(doc, "button", {
				className: "sr-workspace-btn sr-workspace-btn-primary",
				text: "Continue",
				attrs: { type: "button" },
			});
			let filteredEntries = () => {
				let query = String(searchInput.value || "").trim().toLowerCase();
				return query
					? collectionEntries.filter((entry) => entry.searchText.includes(query))
					: collectionEntries.slice();
			};
			let checkedEntries = () => collectionEntries.filter((entry) => state.checkedKeys.has(entry.key));
			let effectiveItemIDsForEntry = (entry) => state.includeSubcollections
				? (entry.tree_item_ids || [])
				: (entry.direct_item_ids || []);
			let effectiveCountForEntry = (entry) => state.includeSubcollections
				? Number(entry.tree_item_count || 0)
				: Number(entry.direct_item_count || 0);
			let updateContinueState = () => {
				continueBtn.disabled = state.checkedKeys.size < 1;
			};
			let updateSelectionSummary = () => {
				let entries = checkedEntries();
				if (!entries.length) {
					selectionSummary.replaceChildren(
						this._html(doc, "div", {
							className: "sr-import-picker-summary-title",
							text: "No import sources selected yet.",
						}),
						this._html(doc, "div", {
							className: "sr-import-picker-summary-meta",
							text: "Tick one or more parent collections or subcollections. Include subcollections applies to every checked source.",
						})
					);
					return;
				}
				let uniqueIDs = new Set();
				let summaryItems = entries.map((entry) => {
					let pathBits = [entry.libraryName];
					if (entry.pathLabel && entry.pathLabel != "Top-level collection") {
						pathBits.push(entry.pathLabel);
					}
					pathBits.push(entry.name);
					for (let itemID of effectiveItemIDsForEntry(entry)) {
						uniqueIDs.add(itemID);
					}
					return this._html(doc, "div", {
						className: "sr-import-picker-summary-item",
						children: [
							this._html(doc, "div", {
								className: "sr-import-picker-summary-item-title",
								text: `${pathBits.join(" / ")} - ${effectiveCountForEntry(entry)} item${effectiveCountForEntry(entry) == 1 ? "" : "s"}`,
							}),
							this._html(doc, "div", {
								className: "sr-import-picker-summary-item-meta",
								text: `${Number(entry.direct_item_count || 0)} direct; ${Number(entry.tree_item_count || 0)} tree`,
							}),
						],
					});
				});
				selectionSummary.replaceChildren(
					this._html(doc, "div", {
						className: "sr-import-picker-summary-title",
						text: `${entries.length} source${entries.length == 1 ? "" : "s"} selected`,
					}),
					this._html(doc, "div", {
						className: "sr-import-picker-summary-meta",
						text: `${uniqueIDs.size} unique importable item${uniqueIDs.size == 1 ? "" : "s"} total. ${state.includeSubcollections ? "Import scope: selected collections and their subcollections" : "Import scope: selected collections only"}`,
					}),
					this._html(doc, "div", {
						className: "sr-import-picker-summary-list",
						children: summaryItems,
					})
				);
			};
			let toggleCheckedKey = (key, nextValue = null, options = {}) => {
				let normalizedKey = String(key || "").trim();
				if (!normalizedKey || !entryMap.has(normalizedKey)) {
					return;
				}
				let shouldCheck = nextValue === null ? !state.checkedKeys.has(normalizedKey) : nextValue === true;
				if (shouldCheck) {
					state.checkedKeys.add(normalizedKey);
				}
				else {
					state.checkedKeys.delete(normalizedKey);
				}
				updateContinueState();
				updateSelectionSummary();
				if (options.rerender) {
					scheduleRender();
				}
			};
			let syncSelectionFromList = () => {
				state.focusedKey = String(list.selectedItem?.getAttribute?.("data-key") || "");
			};
			let renderList = () => {
				let filtered = filteredEntries();
				let visible = filtered.length;
				let displayEntries = filtered.slice(0, 250);
				list.replaceChildren();
				if (!displayEntries.length) {
					let emptyItem = doc.createXULElement("richlistitem");
					emptyItem.className = "sr-import-picker-empty";
					emptyItem.disabled = true;
					let label = doc.createXULElement("label");
					label.setAttribute("value", "No collections match that search.");
					emptyItem.appendChild(label);
					list.appendChild(emptyItem);
					list.selectedIndex = -1;
					state.focusedKey = "";
					countLabel.textContent = "No collections found.";
					updateContinueState();
					updateSelectionSummary();
					return;
				}
				for (let entry of displayEntries) {
					let item = doc.createXULElement("richlistitem");
					item.className = "sr-import-picker-item";
					item.setAttribute("value", String(entry.key || ""));
					item.setAttribute("data-key", String(entry.key || ""));
					let row = doc.createXULElement("hbox");
					row.className = "sr-import-picker-item-row";
					row.setAttribute("align", "start");
					let itemCheckbox = doc.createXULElement("checkbox");
					itemCheckbox.className = "sr-import-picker-item-check";
					itemCheckbox.setAttribute("native", "true");
					itemCheckbox.checked = state.checkedKeys.has(entry.key);
					itemCheckbox.addEventListener("click", (event) => {
						event.stopPropagation();
					});
					itemCheckbox.addEventListener("dblclick", (event) => {
						event.stopPropagation();
					});
					itemCheckbox.addEventListener("command", (event) => {
						event.stopPropagation();
						toggleCheckedKey(entry.key, itemCheckbox.checked === true);
					});
					let box = doc.createXULElement("vbox");
					box.className = "sr-import-picker-item-box";
					box.style.paddingInlineStart = `${8 + Math.min(Number(entry.depth || 0), 6) * 18}px`;
					let title = doc.createXULElement("label");
					title.className = "sr-import-picker-title";
					title.setAttribute("value", String(entry.name || "(Untitled)"));
					title.setAttribute("crop", "end");
					let meta = doc.createXULElement("label");
					meta.className = "sr-import-picker-meta";
					let parts = [
						String(entry.libraryName || "").trim(),
						entry.isProjectRoot
							? "Project root"
							: (entry.isTopLevel ? "Top-level collection" : "Subcollection"),
					].filter(Boolean);
					let pathLabel = String(entry.fullPathLabel || entry.pathLabel || "").trim();
					if (pathLabel) {
						parts.push(pathLabel);
					}
					parts.push(`${Number(entry.direct_item_count || 0)} direct`);
					parts.push(`${Number(entry.tree_item_count || 0)} tree`);
					meta.setAttribute("value", parts.join("  |  "));
					meta.setAttribute("crop", "end");
					box.append(title, meta);
					row.append(itemCheckbox, box);
					item.appendChild(row);
					list.appendChild(item);
				}
				let selectedItem = null;
				if (state.focusedKey) {
					for (let item of list.children) {
						if (item?.getAttribute?.("data-key") == state.focusedKey) {
							selectedItem = item;
							break;
						}
					}
				}
				if (!selectedItem && displayEntries.length) {
					selectedItem = list.getItemAtIndex(0);
				}
				if (selectedItem) {
					list.selectItem(selectedItem);
					state.focusedKey = String(selectedItem.getAttribute("data-key") || "");
				}
				else {
					list.selectedIndex = -1;
					state.focusedKey = "";
				}
				updateContinueState();
				if (visible > displayEntries.length) {
					countLabel.textContent = `Showing ${displayEntries.length} of ${visible} matching collections. Refine the search to narrow the list.`;
				}
				else {
					countLabel.textContent = `${visible} matching collection${visible == 1 ? "" : "s"}.`;
				}
				updateSelectionSummary();
			};
			let scheduleRender = () => {
				if (renderFrame) {
					doc.defaultView.cancelAnimationFrame(renderFrame);
				}
				renderFrame = doc.defaultView.requestAnimationFrame(() => {
					renderFrame = 0;
					renderList();
				});
			};
			let close = (result = null) => {
				if (renderFrame) {
					doc.defaultView.cancelAnimationFrame(renderFrame);
					renderFrame = 0;
				}
				doc.defaultView.removeEventListener("keydown", keyHandler, true);
				backdrop.remove();
				resolve(result);
			};
			let acceptSelection = () => {
				let entries = checkedEntries();
				if (!entries.length) {
					return;
				}
				close({
					sources: entries.map((entry) => ({
						collection: entry.collection,
						key: entry.key,
						name: entry.name,
						pathLabel: entry.pathLabel,
						libraryName: entry.libraryName,
					})),
					includeSubcollections: state.includeSubcollections === true,
				});
			};
			let keyHandler = (event) => {
				if (event.key == "Escape") {
					event.preventDefault();
					close(null);
				}
			};
			doc.defaultView.addEventListener("keydown", keyHandler, true);
			backdrop.addEventListener("click", (event) => {
				if (event.target === backdrop) {
					close(null);
				}
			});
			searchInput.addEventListener("input", scheduleRender);
			searchInput.addEventListener("keydown", (event) => {
				if (event.key == "ArrowDown" && Number(list.itemCount || list.children.length || 0)) {
					event.preventDefault();
					list.focus();
					if (!list.selectedItem && list.getItemAtIndex(0)) {
						list.selectItem(list.getItemAtIndex(0));
						syncSelectionFromList();
					}
				}
				if (event.key == "Enter") {
					if (state.checkedKeys.size) {
						event.preventDefault();
						acceptSelection();
						return;
					}
					if (Number(list.itemCount || list.children.length || 0) == 1) {
						let first = list.getItemAtIndex(0);
						let firstKey = String(first?.getAttribute?.("data-key") || "");
						if (first && !first.disabled && firstKey) {
							list.selectItem(first);
							syncSelectionFromList();
							toggleCheckedKey(firstKey, true);
							acceptSelection();
						}
					}
				}
			});
			list.addEventListener("select", syncSelectionFromList);
			list.addEventListener("dblclick", () => {
				let focusedKey = String(list.selectedItem?.getAttribute?.("data-key") || "");
				if (focusedKey) {
					toggleCheckedKey(focusedKey, null, { rerender: true });
				}
			});
			list.addEventListener("keydown", (event) => {
				if (event.key == "Enter") {
					event.preventDefault();
					if (state.checkedKeys.size) {
						acceptSelection();
					}
				}
				if (event.key == " " || event.key == "Spacebar") {
					let focusedKey = String(list.selectedItem?.getAttribute?.("data-key") || "");
					if (focusedKey) {
						event.preventDefault();
						toggleCheckedKey(focusedKey, null, { rerender: true });
					}
				}
			});
			includeCheckbox.addEventListener("command", () => {
				state.includeSubcollections = includeCheckbox.checked === true;
				updateSelectionSummary();
			});
			closeBtn.addEventListener("click", () => close(null));
			cancelBtn.addEventListener("click", () => close(null));
			continueBtn.addEventListener("click", acceptSelection);
			dialog.append(
				this._html(doc, "div", {
					className: "sr-dialog-header",
					children: [
						this._html(doc, "div", {
							className: "sr-dialog-heading",
							children: [
								this._html(doc, "div", {
									className: "sr-dialog-title",
									text: `Import Collection into ${projectName}`,
								}),
								this._html(doc, "div", {
									className: "sr-dialog-subtitle",
									text: "Choose one or more Zotero collections or specific subcollections to use as import sources.",
								}),
							],
						}),
						closeBtn,
					],
				}),
				this._html(doc, "div", {
					className: "sr-dialog-body",
					children: [
						this._html(doc, "div", {
							className: "sr-dialog-main",
							children: [
								searchInput,
								countLabel,
								list,
								includeCheckbox,
								selectionSummary,
							],
						}),
					],
				}),
				this._html(doc, "div", {
					className: "sr-dialog-footer",
					children: [
						this._html(doc, "div", {
							className: "sr-dialog-subtitle",
							text: "The source collections stay unchanged. Tick one or more parent collections or subcollections, then decide whether to include descendants.",
						}),
						this._html(doc, "div", {
							className: "sr-workspace-toolbar",
							children: [cancelBtn, continueBtn],
						}),
					],
				})
			);
			backdrop.appendChild(dialog);
			doc.documentElement.appendChild(backdrop);
			renderList();
			searchInput.focus();
			searchInput.select();
		});
	},

	async _createProjectImportTarget(current, options = {}) {
		if (!current?.collection || !current?.context) {
			throw new Error("Project runtime is unavailable for import.");
		}
		let currentProjectType = await this._currentProjectTypeForImport(current);
		if (currentProjectType != PROJECT_TYPE_SYSTEMATIC_REVIEW) {
			let dataCollection = await this._resolveCustomAnalysisDataCollection(current.collection, {
				createMissing: true,
			});
			if (!dataCollection) {
				throw new Error("Custom Analysis data collection is unavailable.");
			}
			return {
				targetCollection: dataCollection,
				destinationLabel: String(dataCollection.name || current.collection.name || ""),
				created: false,
			};
		}
		let sourceName = String(options?.sourceName || "").trim();
		if (!sourceName) {
			throw new Error("Harvest source name is required.");
		}
		let projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(this, current, {
			ensureAddedByUser: false,
		});
		let harvestRoot = projectCollections?.harvest?.root || null;
		if (!harvestRoot) {
			throw new Error("Harvest collection is unavailable.");
		}
		if (this._directChildCollectionByName(harvestRoot, sourceName)) {
			throw new Error(`Harvest already has a source named "${sourceName}".`);
		}
		let targetCollection = new Zotero.Collection();
		targetCollection.libraryID = harvestRoot.libraryID;
		targetCollection.name = sourceName;
		targetCollection.parentID = harvestRoot.id;
		await targetCollection.saveTx();
		return {
			targetCollection,
			destinationLabel: `Harvest/${sourceName}`,
			created: true,
		};
	},

	async _cleanupImportTarget(targetInfo = null) {
		let targetCollection = targetInfo?.targetCollection || null;
		if (!targetInfo?.created || !targetCollection?.id) {
			return;
		}
		let directItems = targetCollection.getChildItems ? targetCollection.getChildItems(false, false) : [];
		if (directItems.length) {
			return;
		}
		let childCollections = targetCollection.getChildCollections ? targetCollection.getChildCollections(false, false) : [];
		if (childCollections.length) {
			return;
		}
		try {
			await targetCollection.eraseTx();
		}
		catch (_error) {}
	},

	async _openProjectImportDialog(win, current, options = {}) {
		let dialogWin = win || this._primaryWindow();
		if (!dialogWin?.document) {
			throw new Error("A Zotero window is required for import.");
		}
		if (!current?.collection || !current?.context) {
			throw new Error("Open an existing Systematic Reviewer or Custom Analysis project collection first.");
		}
		let currentProjectType = await this._currentProjectTypeForImport(current);
		let projectName = String(current.collection?.name || current.context?.collectionName || "Project").trim() || "Project";
		let sourceType = this._promptForImportSourceType(dialogWin, current);
		if (!sourceType) {
			return null;
		}
		let requestedPostImportAction = this._manualImportDefaultPostImportAction(
			options?.post_import_action ?? options?.postImportAction ?? ""
		);
		let targetInfo = null;
		let postImportAction = "none";
		try {
			let importResult = null;
			let defaultSourceName = "";
			if (sourceType == "collection") {
				let collectionSource = await this._openCollectionImportPickerDialog(dialogWin, current);
				let selectedSources = Array.isArray(collectionSource?.sources)
					? collectionSource.sources.filter((entry) => entry?.collection)
					: [];
				if (!selectedSources.length) {
					return null;
				}
				defaultSourceName = selectedSources.length == 1
					? String(selectedSources[0].name || selectedSources[0].collection?.name || "").trim()
					: "Imported collections";
				let sourceName = currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW
					? await this._promptForHarvestSourceName(dialogWin, current, defaultSourceName)
					: "";
				if (currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW && !sourceName) {
					return null;
				}
				postImportAction = currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW
					? await this._promptForManualImportPostImportAction(dialogWin, current, {
						sourceName,
						defaultAction: requestedPostImportAction,
					})
					: "none";
				if (currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW && !postImportAction) {
					return null;
				}
				targetInfo = await this._createProjectImportTarget(current, {
					sourceName,
				});
				importResult = await this._importCollectionSourcesIntoProject(
					current,
					targetInfo.targetCollection,
					selectedSources.map((entry) => entry.collection),
					{
						includeDescendants: collectionSource.includeSubcollections === true,
					}
				);
			}
			else if (sourceType == "file") {
				let file = await this._pickImportFile(dialogWin);
				if (!file) {
					return null;
				}
				defaultSourceName = this._fileImportDefaultName(file);
				let sourceName = currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW
					? await this._promptForHarvestSourceName(dialogWin, current, defaultSourceName)
					: "";
				if (currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW && !sourceName) {
					return null;
				}
				postImportAction = currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW
					? await this._promptForManualImportPostImportAction(dialogWin, current, {
						sourceName,
						defaultAction: requestedPostImportAction,
					})
					: "none";
				if (currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW && !postImportAction) {
					return null;
				}
				targetInfo = await this._createProjectImportTarget(current, {
					sourceName,
				});
				importResult = await this._importFileSourceIntoProject(
					current,
					targetInfo.targetCollection,
					file
				);
			}
			else {
				return null;
			}
				if (!Number(importResult?.importedCount || 0)) {
					await this._cleanupImportTarget(targetInfo);
				}
				let refreshedImportedItems = this._reloadImportedItems(importResult?.importedItems || []);
				await this._hydrateImportedProjectItems(
					current,
					refreshedImportedItems
				);
				let conversionQueue = await this._queueImportedMarkdownConversions(
					current,
					refreshedImportedItems
				);
			let postImportFollowup = Number(importResult?.importedCount || 0) && currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW
				? await this._runManualImportPostImportFollowup(current, targetInfo, postImportAction, {
					targetWin: dialogWin,
				})
				: {
					post_import_action: String(postImportAction || "none").trim().toLowerCase(),
					merge_queue: null,
					merge_queue_error: "",
					embeddings_job: null,
					embeddings_skipped_reason: "",
					embeddings_error: "",
				};
			await this._refreshAllControllers();
			let message = Number(importResult?.importedCount || 0)
				? `Imported ${Number(importResult.importedCount || 0)} item${Number(importResult.importedCount || 0) == 1 ? "" : "s"} into ${targetInfo?.destinationLabel || projectName}.`
				: "No eligible items were imported.";
			if (Number(conversionQueue?.queued_count || 0)) {
				message += ` Queued ${Number(conversionQueue.queued_count || 0)} markdown conversion job${Number(conversionQueue.queued_count || 0) == 1 ? "" : "s"}.`;
			}
			if (currentProjectType == PROJECT_TYPE_SYSTEMATIC_REVIEW && Number(importResult?.importedCount || 0)) {
				if (String(postImportFollowup?.post_import_action || "") == "none") {
					message += " Imported records remain in Harvest so you can review and merge later.";
				}
				else if (postImportFollowup?.merge_queue_error) {
					message += ` Merge follow-up error: ${String(postImportFollowup.merge_queue_error || "").trim()}`;
				}
				else if (postImportFollowup?.merge_queue?.queued) {
					if (String(postImportFollowup.post_import_action || "").startsWith("merge_imported")) {
						message += ` Queued merge of ${targetInfo?.destinationLabel || "the imported Harvest source"} into Pending.`;
					}
					else {
						message += ` Queued merge of ${Number(postImportFollowup.merge_queue.merged_sources || 0)} Harvest source${Number(postImportFollowup.merge_queue.merged_sources || 0) == 1 ? "" : "s"} into Pending.`;
					}
				}
				else if (postImportFollowup?.merge_queue?.message) {
					message += ` ${String(postImportFollowup.merge_queue.message || "").trim()}`;
				}
				if (postImportFollowup?.embeddings_job) {
					message += " Queued Pending title + abstract embeddings.";
				}
				else if (postImportFollowup?.merge_queue?.auto_followup?.queued_after_merge) {
					message += " Pending title + abstract embeddings will queue after merge completes.";
				}
				else if (postImportFollowup?.embeddings_skipped_reason) {
					message += ` ${String(postImportFollowup.embeddings_skipped_reason || "").trim()}`;
				}
				else if (postImportFollowup?.embeddings_error) {
					message += ` Embeddings error: ${String(postImportFollowup.embeddings_error || "").trim()}`;
				}
			}
			this._displayTemporaryMessage(dialogWin, message);
			return {
				ok: true,
				context: options || {},
				import_result: importResult,
				conversion_queue: conversionQueue,
				post_import_followup: postImportFollowup,
				target: targetInfo,
			};
		}
		catch (error) {
			await this._cleanupImportTarget(targetInfo);
			throw error;
		}
	},

	async _openSelectedProjectImportDialog(win) {
		let selection = await this._selectedCollectionMenuContext(win || this._primaryWindow());
		if (!selection?.rootCollection || !selection?.projectAvailable) {
			throw new Error("Select an existing Systematic Reviewer or Custom Analysis project collection first.");
		}
		let current = await this._openExistingCollectionProject(selection.rootCollection, {
			projectType: selection.projectType || PROJECT_TYPE_SYSTEMATIC_REVIEW,
		});
		return await this._openProjectImportDialog(win, current, {
			source: "collection_menu",
		});
	},

	async _mergeSelectedHarvestCollectionIntoPending(win) {
		if (!SystematicReviewerWorkflowHarvest?.mergeSourceIntoPending) {
			throw new Error("Harvest workflow is not registered.");
		}
		let selection = await this._selectedHarvestSourceProjectInfo(win || this._primaryWindow());
		if (!selection?.rootCollection || !selection?.sourceCollection) {
			throw new Error("Select one Harvest source subcollection inside a Systematic Review project first.");
		}
		let current = await this._openExistingCollectionProject(selection.rootCollection, {
			projectType: PROJECT_TYPE_SYSTEMATIC_REVIEW,
		});
		let result = await SystematicReviewerWorkflowCommands.call("harvest.mergeSource", {
			project_id: current.context.projectID,
			source_collection_key: String(selection.sourceCollection.key || ""),
		});
		if (result?.queued && this._showMergeWarningNotice) {
			await this._showMergeWarningNotice(win || this._primaryWindow(), current, {
				sourceCount: 1,
			}).catch(() => null);
		}
		if (!result?.queued) {
			await this._refreshAllControllers();
		}
		if (win?.ZoteroPane?.displayTemporaryMessage) {
			let summary = result?.queued
				? `Queued backend merge${result?.auto_followup?.embeddings_job ? " and auto-embeddings" : ""} for ${String(result.source_collection_name || selection.sourceCollection.name || "Harvest source").trim()}.`
				: `Merged ${Number(result.merged_count || 0)} into Pending. ${Number(result.duplicate_count || 0)} sent to Duplicates.`;
			try {
				win.ZoteroPane.displayTemporaryMessage(summary);
			}
			catch (_error) {}
		}
		return result;
	},
};
