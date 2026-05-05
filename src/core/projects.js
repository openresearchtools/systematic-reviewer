var SystematicReviewerProjects = {
	async _resolveProjectReference(projectRef = null) {
		let reference = projectRef || this.currentProject;
		if (!reference?.collectionKey && !reference?.collection_key) {
			return null;
		}
		let collection = this._collectionByKey(
			reference.libraryID || reference.library_id,
			reference.collectionKey || reference.collection_key
		);
		if (!collection) {
			return null;
		}
		let context = this._collectionProjectContext(collection);
		let projectItem = await this._resolveProjectItem(
			collection,
			reference.projectItemKey || reference.project_item_key || "",
			false
		);
		if (!projectItem) {
			return null;
		}
		let settings = (await this._readJSONFile(context.settingsPath)) || {};
		let projectType = this._normalizeProjectType(
			reference.projectType
			|| reference.project_type
			|| settings.project_type
			|| ""
		);
		return {
			context,
			collection,
			projectItem,
			sessionID: reference.sessionID || reference.session_id || reference.last_session_id || "default",
			settings,
			projectType,
		};
	},


	async _resolveCurrentProject() {
		return this._resolveProjectReference(this.currentProject);
	},


	async _restoreLastProjectSelection() {
		let settings = await this._globalSettings();
		let reference = settings.last_project || null;
		if (!reference) {
			return null;
		}
		let restored = await this._resolveProjectReference(reference);
		if (!restored) {
			return null;
		}
			this._setCurrentProject(
				restored.context,
				restored.projectItem,
				reference.last_session_id || reference.sessionID || reference.session_id || "default",
				restored.projectType
			);
		return restored;
	},


	async _listStoredProjects() {
		let root = this._nsIFile(this._projectsRoot());
		if (!root.exists() || !root.isDirectory()) {
			return [];
		}
		let results = [];
		let entries = root.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.leafName || !entry.isDirectory() || entry.leafName.startsWith(".")) {
				continue;
			}
			let project = await this._readStoredProject(entry.path);
			if (project) {
				results.push(project);
			}
		}
		results.sort((left, right) =>
			String(right.updated_at || "").localeCompare(String(left.updated_at || "")) ||
			String(left.collection_name || left.project_id).localeCompare(String(right.collection_name || right.project_id))
		);
		return results;
	},


	async _readStoredProject(projectRoot) {
		let manifestPath = this._joinPath(projectRoot, "project.json");
		let settingsPath = this._joinPath(projectRoot, "settings.json");
		let manifest = (await this._readJSONFile(manifestPath)) || {};
		let settings = (await this._readJSONFile(settingsPath)) || {};
		let projectID = String(
			manifest.project_id ||
			settings.project_id ||
			this._basename(projectRoot)
		).trim();
		if (!projectID) {
			return null;
		}
		let libraryID = Number(
			manifest?.collection?.library_id ??
			settings?.collection?.library_id ??
			this._parseProjectID(projectID)?.libraryID ??
			0
		) || 0;
		let collectionKey = String(
			manifest?.collection?.key ||
			settings?.collection?.key ||
			this._parseProjectID(projectID)?.collectionKey ||
			""
		).trim();
			let context = {
				projectID,
				libraryID,
				collectionKey,
				collectionName: String(manifest?.collection?.name || settings?.collection?.name || "").trim(),
				projectRoot,
				databasePath: await this._resolveStoredProjectPath(
					projectRoot,
					[
						manifest.database_path,
						settings.database_path,
						manifest.database_filename,
						SQLITE_FILENAME,
					],
					SQLITE_FILENAME
				),
				reportPath: await this._resolveStoredProjectPath(
					projectRoot,
					[
						manifest.report_path,
						settings.report_path,
						"REPORT.md",
					],
					"REPORT.md"
				),
				logPath: await this._resolveStoredProjectPath(
					projectRoot,
					[
						manifest.log_path,
						settings.log_path,
						"log.txt",
					],
					"log.txt"
				),
				settingsPath: await this._resolveStoredProjectPath(
					projectRoot,
					[
						manifest.settings_path,
						settings.settings_path,
						"settings.json",
					],
					"settings.json"
				),
				manifestPath: await this._resolveStoredProjectPath(
					projectRoot,
					[
						manifest.manifest_path,
						"project.json",
					],
					"project.json"
				),
				snapshotsDir: this._joinPath(projectRoot, "snapshots"),
				projectItemKey: String(manifest.project_item_key || settings.project_item_key || "").trim(),
				outputsItemKey: String(manifest.outputs_item_key || settings.outputs_item_key || "").trim(),
				sessionID: String(settings.last_session_id || manifest.last_session_id || "default"),
				projectType: this._normalizeProjectType(settings.project_type || manifest.project_type || ""),
			};
		let sessionCount = 0;
		let latestSession = null;
		let counts = {
			items: 0,
			attachments: 0,
			artifacts: 0,
		};
		let updatedAt = String(manifest.updated_at || settings.updated_at || "").trim();
			if (await this._pathExists(context.databasePath)) {
				try {
					let db = await this._projectDB(context);
					let summary = await this._projectSessionSummary(context);
					sessionCount = summary.count;
					latestSession = summary.latest;
				counts = await this._projectCounts(context);
				let dbUpdated = await this._dbValue(
					db,
					"SELECT updated_at AS value FROM project_state WHERE project_id=? LIMIT 1",
					[context.projectID]
				);
				updatedAt = String(dbUpdated || updatedAt || "").trim();
			}
			catch (error) {
				this.log(`stored project summary skipped for ${context.projectID}: ${error}`);
			}
		}
		let collection = libraryID && collectionKey ? this._collectionByKey(libraryID, collectionKey) : null;
				return {
					project_id: context.projectID,
					library_id: context.libraryID,
					collection_key: context.collectionKey,
					collection_name: context.collectionName || collection?.name || this._basename(projectRoot) || context.projectID,
				project_root: context.projectRoot,
					project_item_key: context.projectItemKey || "",
					outputs_item_key: context.outputsItemKey || "",
					report_path: context.reportPath,
					log_path: context.logPath || this._joinPath(projectRoot, "log.txt"),
					settings_path: context.settingsPath,
					database_path: context.databasePath,
					project_type: context.projectType,
					last_session_id: latestSession?.session_id || context.sessionID || "default",
				session_count: sessionCount,
			latest_session: latestSession,
			counts,
			available_in_zotero: !!collection,
			updated_at: updatedAt || "",
		};
	},

	_pathCandidateFromStoredValue(projectRoot, value, candidates, seen) {
		let raw = this._normalizeLocalPath(value);
		if (!raw) {
			return;
		}
		let push = (path, portable) => {
			let normalized = this._normalizeLocalPath(path);
			if (!normalized || seen.has(normalized)) {
				return;
			}
			seen.add(normalized);
			candidates.push({
				path: normalized,
				portable: portable === true,
			});
		};
		if (this._isAbsolutePath(raw)) {
			push(raw, false);
			let leaf = "";
			try {
				leaf = this._basename(raw);
			}
			catch (_err) {
				leaf = "";
			}
			if (leaf) {
				push(this._joinPath(projectRoot, leaf), true);
			}
			return;
		}
		push(this._joinPath(projectRoot, raw), true);
	},

	async _resolveStoredProjectPath(projectRoot, values = [], fallbackRelative = "") {
		let candidates = [];
		let seen = new Set();
		for (let value of Array.isArray(values) ? values : [values]) {
			this._pathCandidateFromStoredValue(projectRoot, value, candidates, seen);
		}
		if (fallbackRelative) {
			this._pathCandidateFromStoredValue(projectRoot, fallbackRelative, candidates, seen);
		}
		for (let candidate of candidates) {
			if (await this._pathExists(candidate.path)) {
				return candidate.path;
			}
		}
		let portable = candidates.find((candidate) => candidate.portable);
		if (portable?.path) {
			return portable.path;
		}
		return candidates[0]?.path || this._joinPath(projectRoot, fallbackRelative || "");
	},


	_parseProjectID(projectID) {
		let match = String(projectID || "").trim().match(/^(\d+)-([A-Z0-9]+)$/i);
		if (!match) {
			return null;
		}
		return {
			libraryID: Number(match[1]) || 0,
			collectionKey: match[2],
		};
	},


	async _openStoredProject(projectID, options = {}) {
		let target = String(projectID || "").trim();
		if (!target) {
			throw new Error("project_id is required.");
		}
		let stored = (await this._listStoredProjects()).find((entry) => entry.project_id == target);
		if (!stored) {
			throw new Error(`Unknown stored project: ${target}`);
		}
		if (!stored.available_in_zotero) {
			throw new Error(`Stored project ${target} is not currently available in Zotero.`);
		}
		let collection = this._collectionByKey(stored.library_id, stored.collection_key);
		if (!collection) {
			throw new Error(`Stored project ${target} could not resolve its Zotero collection.`);
		}
			let context = this._collectionProjectContext(collection);
			let projectItem = await this._resolveProjectItem(
				collection,
				stored.project_item_key || "",
				true,
				stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW
			);
			let projectOutputsItem = await this._resolveProjectOutputsItem(
				collection,
				stored.outputs_item_key || "",
				true,
				stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW
			);
			await this._ensureProjectScaffold(context, collection, projectItem, {
				projectType: stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW,
				projectOutputsItem,
			});
			await this._reconcileCollectionProject(context, collection, projectItem, projectOutputsItem);
			let sessionID = String(options.sessionID || options.session_id || stored.last_session_id || "default").trim() || "default";
			let current = {
				context,
				collection,
				projectItem,
				sessionID,
				projectType: stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW,
			};
			await this._reconcileProjectConversionAutomation(current, {
				reason: "project_open",
			});
			this._setCurrentProject(context, projectItem, sessionID, stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW);
			return current;
		},


	async _projectCounts(context) {
		let db = await this._projectDB(context);
		let collection = this._collectionByKey(context.libraryID, context.collectionKey);
		let projectType = await this._projectTypeForContext(context, PROJECT_TYPE_SYSTEMATIC_REVIEW);
		let projectItemKey = this.currentProject?.projectID == context.projectID
			? this.currentProject.projectItemKey || ""
			: ((await this._dbValue(
				db,
				"SELECT project_item_key AS value FROM project_state WHERE project_id=? LIMIT 1",
				[context.projectID]
			)) || "");
		let projectItem = collection && projectItemKey
			? Zotero.Items.getByLibraryAndKey(context.libraryID, projectItemKey)
			: null;
		let outputsItem = collection
			? await this._resolveProjectOutputsItem(collection, "", false, projectType)
			: null;
		let collectionNodes = collection ? this._projectCollectionNodes(collection) : [];
		let layout = collection ? this._projectWorkflowTreeInfo(collection, collectionNodes) : null;
		let allProjectItemKeys = new Set();
		let allAttachmentKeys = new Set();
		let workflowItemKeys = new Set();
		let collectCollectionKeys = (targetCollection, options = {}) => {
			let includeDescendants = options.includeDescendants !== false;
			let itemKeys = new Set();
			let attachmentKeys = new Set();
			if (!targetCollection) {
				return {
					itemKeys,
					attachmentKeys,
				};
			}
			let targetNodes = [];
			if (includeDescendants) {
				let targetID = Number(targetCollection.id || 0) || 0;
				targetNodes = collectionNodes.filter((node) => {
					let currentCollection = node?.collection || null;
					return currentCollection?.id == targetID
						|| (targetID && this._collectionHasAncestor(currentCollection, targetID));
				});
			}
			else {
				targetNodes = collectionNodes.filter((node) => node?.collection?.id == targetCollection.id);
			}
			for (let node of targetNodes) {
				let directItems = node.collection.getChildItems ? node.collection.getChildItems(false, false) : [];
				for (let item of directItems) {
					if (!item || item.deleted || item.id == projectItem?.id || item.id == outputsItem?.id || item.isNote?.() || item.isAnnotation?.()) {
						continue;
					}
					if (item.isAttachment?.()) {
						if (item.key) {
							attachmentKeys.add(item.key);
						}
						continue;
					}
					if (item.key) {
						itemKeys.add(item.key);
					}
					if (!item.getAttachments) {
						continue;
					}
					for (let attachmentID of item.getAttachments()) {
						let attachment = Zotero.Items.get(attachmentID);
						if (!attachment || attachment.deleted || attachment.isNote?.() || attachment.isAnnotation?.() || !attachment.key) {
							continue;
						}
						attachmentKeys.add(attachment.key);
					}
				}
			}
			return {
				itemKeys,
				attachmentKeys,
			};
		};
		let allCollections = collectCollectionKeys(collection, { includeDescendants: true });
		allProjectItemKeys = allCollections.itemKeys;
		allAttachmentKeys = allCollections.attachmentKeys;
		let countedNodes = layout?.isSystematicReviewTree
			? collectionNodes.filter((node) => layout.isWorkflowNode(node.collection))
			: collectionNodes;
		for (let node of countedNodes) {
			let nodeCounts = collectCollectionKeys(node?.collection || null, { includeDescendants: false });
			for (let itemKey of nodeCounts.itemKeys) {
				workflowItemKeys.add(itemKey);
			}
		}
		let directChildren = layout?.directChildren || new Map();
		let harvestChildren = layout?.harvestRoot
			? this._projectDirectChildrenMap(layout.harvestRoot, collectionNodes)
			: new Map();
		let summarizeCollection = (targetCollection) => {
			let counts = collectCollectionKeys(targetCollection, { includeDescendants: true });
			return {
				items: counts.itemKeys.size,
				attachments: counts.attachmentKeys.size,
			};
		};
		let pendingCounts = summarizeCollection(layout?.reviewTargets?.pending || null);
		let includedCounts = summarizeCollection(layout?.reviewTargets?.included || null);
		let excludedCounts = summarizeCollection(layout?.reviewTargets?.excluded || null);
		let excludedFTCounts = summarizeCollection(layout?.reviewTargets?.excluded_ft || null);
		let maybeCounts = summarizeCollection(layout?.reviewTargets?.maybe || null);
		let duplicatesCounts = summarizeCollection(layout?.duplicates || null);
		let harvestCounts = summarizeCollection(layout?.harvestRoot || null);
		let openAlexCounts = summarizeCollection(harvestChildren.get(String(HARVEST_OPENALEX_COLLECTION_NAME).toLowerCase()) || null);
		let addedByUserCounts = summarizeCollection(harvestChildren.get(String(HARVEST_ADDED_BY_USER_COLLECTION_NAME).toLowerCase()) || null);
		return {
			collections: countedNodes.length,
			total: allProjectItemKeys.size,
			items: allProjectItemKeys.size,
			attachments: allAttachmentKeys.size,
			workflow_items: workflowItemKeys.size,
			pending: pendingCounts.items,
			included: includedCounts.items,
			excluded: excludedCounts.items,
			excluded_ft: excludedFTCounts.items,
			maybe: maybeCounts.items,
			duplicates: duplicatesCounts.items,
			harvest: harvestCounts.items,
			openalex: openAlexCounts.items,
			added_by_user: addedByUserCounts.items,
			artifacts:
				(projectItem ? this._projectAttachmentSnapshot(projectItem, PROJECT_ITEM_KIND_PROJECT).length : 0)
				+ (outputsItem ? this._projectAttachmentSnapshot(outputsItem, PROJECT_ITEM_KIND_OUTPUTS).length : 0),
			source_links: this._countFilesRecursive(context.sourcesDir),
		};
	},


	_collectionNoteCount(collection, projectItem) {
		let count = 0;
		for (let node of this._projectCollectionNodes(collection)) {
			let directItems = node.collection.getChildItems ? node.collection.getChildItems(false, false) : [];
			for (let item of directItems) {
				if (!item || item.deleted || item.id == projectItem?.id) {
					continue;
				}
				if (item.isNote?.()) {
					count += 1;
				}
			}
		}
		return count;
	},


	_likelyTopicSignals(collection, projectItem, limit = 6) {
		let stopwords = new Set([
			"about", "above", "after", "again", "against", "among", "between", "because", "being", "both",
			"could", "data", "during", "each", "from", "have", "into", "item", "items", "method", "methods",
			"more", "most", "other", "paper", "papers", "review", "reviews", "should", "study", "studies",
			"than", "that", "their", "them", "there", "these", "they", "this", "those", "using", "used",
			"with", "within", "without", "were", "where", "which", "while", "would"
		]);
		let counts = new Map();
		for (let item of this._projectCitableItems(collection, projectItem).slice(0, 180)) {
			let text = `${this._itemField(item, "title")} ${this._itemField(item, "abstractNote")}`.toLowerCase();
			let matches = text.match(/[a-z][a-z-]{3,}/g) || [];
			for (let token of matches) {
				if (stopwords.has(token) || /^\d/.test(token)) {
					continue;
				}
				counts.set(token, (counts.get(token) || 0) + 1);
			}
		}
		return Array.from(counts.entries())
			.filter(([, count]) => count > 1)
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
			.slice(0, limit)
			.map(([token]) => token);
	},


	_countFilesRecursive(rootPath, matcher = null) {
		let root = this._nsIFile(rootPath);
		if (!root.exists() || !root.isDirectory()) {
			return 0;
		}
		let count = 0;
		let visit = (dir, prefix = "") => {
			let entries = dir.directoryEntries;
			while (entries.hasMoreElements()) {
				let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
				if (!entry?.leafName || entry.leafName.startsWith(".")) {
					continue;
				}
				let relativePath = prefix ? `${prefix}/${entry.leafName}` : entry.leafName;
				if (entry.isDirectory()) {
					visit(entry, relativePath);
					continue;
				}
				if (!matcher || matcher(relativePath, entry)) {
					count += 1;
				}
			}
		};
		visit(root);
		return count;
	},


	_classifyProjectInspection(inspection) {
		if (!inspection.items && !inspection.attachments && !inspection.source_files) {
			return "fresh";
		}
		if (inspection.markdown_conversions || inspection.chunk_rows || inspection.jobs_total || inspection.templates > 1 || inspection.has_existing_report) {
			return "advanced";
		}
		return "partially_populated";
	},


	async _inspectProjectSession(current, options = {}) {
		let cacheKey = String(current?.context?.projectID || "").trim();
		let force = options?.force === true;
		let nowMs = Date.now();
		if (!force && cacheKey) {
			let cached = this.projectInspectionCache?.get(cacheKey) || null;
			if (cached && (nowMs - (Number(cached.at) || 0)) < 1000) {
				return Object.assign({}, cached.value);
			}
		}
		let counts = await this._projectCounts(current.context);
		let db = await this._projectDB(current.context);
		let reportExists = await this._pathExists(current.context.reportPath);
		let reportText = reportExists ? await this._readFileText(current.context.reportPath) : "";
		let reportTrimmed = reportText.trim();
		let projectSettings = (await this._readJSONFile(current.context.settingsPath)) || {};
		let projectType = this._normalizeProjectType(
			current.projectType
			|| current.context?.projectType
			|| projectSettings.project_type
			|| PROJECT_TYPE_SYSTEMATIC_REVIEW
		);
		let defaultReport = this._defaultReportMarkdown(current.collection, projectType, {
			softwareCitationItemKey: projectSettings.software_citation_item_key || "",
		}).trim();
		let inspection = {
			project_state: "fresh",
			items: counts.items || 0,
			attachments: counts.attachments || 0,
			notes: this._collectionNoteCount(current.collection, current.projectItem),
			source_files: this._countFilesRecursive(current.context.sourcesDir),
			markdown_conversions: this._countFilesRecursive(current.context.conversionsDir, (relativePath) => /\.(md|markdown)$/i.test(relativePath)),
			templates: this._countFilesRecursive(current.context.templatesDir, (relativePath) => /\.(json|ya?ml|md|txt)$/i.test(relativePath)),
			outputs: this._countFilesRecursive(current.context.outputsDir),
			chunk_rows: (await this._dbValue(db, "SELECT COUNT(*) AS value FROM document_chunks")) || 0,
			jobs_total: (await this._dbValue(db, "SELECT COUNT(*) AS value FROM jobs")) || 0,
			sessions_total: (await this._dbValue(db, "SELECT COUNT(*) AS value FROM sessions")) || 0,
			has_report_file: !!reportExists,
			has_existing_report: !!(reportTrimmed && reportTrimmed != defaultReport),
			report_word_count: reportTrimmed ? reportTrimmed.split(/\s+/).filter(Boolean).length : 0,
			has_existing_review_runs: (((await this._dbValue(db, "SELECT COUNT(*) AS value FROM jobs")) || 0) > 0),
			likely_topic_signals: this._likelyTopicSignals(current.collection, current.projectItem, 6),
			report_path: current.context.reportPath,
			log_path: current.context.logPath || this._joinPath(current.context.projectRoot, "log.txt"),
			project_root: current.context.projectRoot,
		};
		inspection.project_state = this._classifyProjectInspection(inspection);
		if (cacheKey && this.projectInspectionCache) {
			this.projectInspectionCache.set(cacheKey, {
				at: nowMs,
				value: Object.assign({}, inspection),
			});
		}
		return inspection;
	},

	_scheduleCurrentProjectRefresh() {
		let generation = ++this.reconcileGeneration;
		Zotero.Promise.delay(900).then(() => {
			if (!this.initialized || generation != this.reconcileGeneration) {
				return;
			}
			this._refreshCurrentProjectFromCollections().catch((error) => {
				this.log(`current project refresh skipped: ${error}`);
			});
		});
	},

	async _refreshCurrentProjectFromCollections(options = {}) {
		let autoQueueConversions = options.autoQueueConversions !== false;
		if (!this.currentProject?.collectionKey) {
			return;
		}
		let collection = this._collectionByKey(
			this.currentProject.libraryID,
			this.currentProject.collectionKey
		);
		if (!collection) {
			return;
		}
		let context = this._collectionProjectContext(collection);
		let projectItem = await this._resolveProjectItem(
			collection,
			this.currentProject.projectItemKey || "",
			false,
			this.currentProject?.projectType || PROJECT_TYPE_SYSTEMATIC_REVIEW
		);
		if (!projectItem) {
			return;
		}
		let projectOutputsItem = await this._resolveProjectOutputsItem(
			collection,
			"",
			true,
			this.currentProject?.projectType || PROJECT_TYPE_SYSTEMATIC_REVIEW
		);
			await this._ensureProjectScaffold(context, collection, projectItem, {
				projectType: this.currentProject?.projectType || PROJECT_TYPE_SYSTEMATIC_REVIEW,
				projectOutputsItem,
			});
			await this._reconcileCollectionProject(context, collection, projectItem, projectOutputsItem);
			if (autoQueueConversions) {
				await this._reconcileProjectConversionAutomation({
					context,
					collection,
					projectItem,
				}, {
					reason: options.reason || "project_refresh",
				});
			}
			this._setCurrentProject(
				context,
				projectItem,
				this.currentProject?.sessionID || null,
				this.currentProject?.projectType || PROJECT_TYPE_SYSTEMATIC_REVIEW
			);
		await this._refreshAllControllers();
	},

	_collectionByKey(libraryID, collectionKey) {
		if (!collectionKey) {
			return null;
		}
		try {
			return Zotero.Collections.getByLibraryAndKey(
				libraryID || Zotero.Libraries.userLibraryID,
				collectionKey
			);
		}
			catch (_err) {
				return null;
			}
		},

	_itemByKey(libraryID, itemKey) {
		let normalizedKey = String(itemKey || "").trim();
		if (!normalizedKey) {
			return null;
		}
		try {
			return Zotero.Items.getByLibraryAndKey(
				libraryID || Zotero.Libraries.userLibraryID,
				normalizedKey
			) || null;
		}
		catch (_err) {
			return null;
		}
	},

	_itemByKey(libraryID, itemKey) {
		let normalizedKey = String(itemKey || "").trim();
		if (!normalizedKey) {
			return null;
		}
		try {
			return Zotero.Items.getByLibraryAndKey(
				libraryID || Zotero.Libraries.userLibraryID,
				normalizedKey
			) || null;
		}
		catch (_err) {
			return null;
		}
	},

	_isRootCollection(collection) {
		if (!collection) {
			return false;
		}
		return !(collection.parentKey || collection.parentID);
	},

	_collectionParent(collection) {
		if (!collection) {
			return null;
		}
		let parentID = Number(collection.parentID || 0) || 0;
		if (parentID) {
			try {
				return Zotero.Collections.get(parentID) || null;
			}
			catch (_err) {}
		}
		let parentKey = String(collection.parentKey || "").trim();
		if (parentKey) {
			return this._collectionByKey(
				collection.libraryID || Zotero.Libraries.userLibraryID,
				parentKey
			);
		}
		return null;
	},

	_rootCollectionForCollection(collection) {
		if (!collection) {
			return null;
		}
		let current = collection;
		let seen = new Set();
		while (current && !this._isRootCollection(current)) {
			let key = String(current.key || current.id || "");
			if (key && seen.has(key)) {
				break;
			}
			if (key) {
				seen.add(key);
			}
			let parent = this._collectionParent(current);
			if (!parent || parent == current) {
				break;
			}
			current = parent;
		}
		return current || collection;
	},

	_normalizeProjectType(value) {
		let raw = String(value || "").trim().toLowerCase();
		if (!raw || ["systematic_review", "systematic-review", "review"].includes(raw)) {
			return PROJECT_TYPE_SYSTEMATIC_REVIEW;
		}
		if (["custom", "custom_analysis", "custom-analysis", "analysis"].includes(raw)) {
			return PROJECT_TYPE_CUSTOM_ANALYSIS;
		}
		return PROJECT_TYPE_SYSTEMATIC_REVIEW;
	},

	_projectTypeLabel(projectType) {
		return this._normalizeProjectType(projectType) == PROJECT_TYPE_CUSTOM_ANALYSIS
			? "Custom Analysis"
			: "Systematic Review";
	},

	async _storedProjectMetadata(context) {
		let settings = (await this._readJSONFile(context.settingsPath)) || {};
		let manifest = (await this._readJSONFile(context.manifestPath)) || {};
		let projectType = String(settings.project_type || manifest.project_type || "").trim();
		return {
			settings,
			manifest,
			projectType,
		};
	},

	async _projectTypeForContext(context, fallback = "") {
		let stored = await this._storedProjectMetadata(context);
		let raw = String(stored.projectType || fallback || "").trim();
		return raw ? this._normalizeProjectType(raw) : "";
	},

	async _collectionHasStoredProject(collection) {
		if (!collection) {
			return false;
		}
		let context = this._collectionProjectContext(collection);
		if (await this._pathExists(context.settingsPath) || await this._pathExists(context.manifestPath)) {
			return true;
		}
		return !!(await this._resolveProjectItem(collection, "", false));
	},

	async _projectCollectionForItemTools(collection) {
		if (!collection) {
			return null;
		}
		let rootCollection = this._rootCollectionForCollection(collection);
		if (!rootCollection) {
			return null;
		}
		return await this._collectionHasStoredProject(rootCollection)
			? rootCollection
			: null;
	},

	_projectDirectChildrenMap(rootCollection, nodes = null) {
		let directChildren = new Map();
		for (let node of nodes || this._projectCollectionNodes(rootCollection)) {
			if (node?.collection?.key && node.parentKey == rootCollection.key) {
				directChildren.set(String(node.collection.name || "").trim().toLowerCase(), node.collection);
			}
		}
		return directChildren;
	},

	_collectionHasAncestor(collection, ancestorID) {
		let targetID = Number(ancestorID || 0) || 0;
		if (!collection?.id || !targetID) {
			return false;
		}
		let current = collection;
		while (current) {
			if (current.id == targetID) {
				return true;
			}
			if (!current.parentID) {
				break;
			}
			current = Zotero.Collections.get(current.parentID) || null;
		}
		return false;
	},

	_projectWorkflowTreeInfo(rootCollection, nodes = null) {
		let allNodes = nodes || this._projectCollectionNodes(rootCollection);
		let directChildren = this._projectDirectChildrenMap(rootCollection, allNodes);
		let reviewTargets = {
			pending: directChildren.get("pending") || null,
			included: directChildren.get("included") || null,
			excluded: directChildren.get("excluded") || null,
			excluded_ft: directChildren.get("excluded ft") || null,
			maybe: directChildren.get("maybe") || null,
		};
		let harvestRoot = directChildren.get(String(HARVEST_COLLECTION_NAME).toLowerCase()) || null;
		let duplicates = directChildren.get(String(DUPLICATES_COLLECTION_NAME).toLowerCase()) || null;
		let filters = directChildren.get("filters") || null;
		let workflowMarkers = [
			harvestRoot,
			duplicates,
			reviewTargets.pending,
			reviewTargets.included,
			reviewTargets.excluded,
			reviewTargets.excluded_ft,
		].filter(Boolean);
		let isSystematicReviewTree = workflowMarkers.length >= 2;
		let isWorkflowNode = (collection) => {
			if (!collection) {
				return false;
			}
			if (!isSystematicReviewTree) {
				return true;
			}
			if (harvestRoot?.id && this._collectionHasAncestor(collection, harvestRoot.id)) {
				return false;
			}
			if (duplicates?.id && this._collectionHasAncestor(collection, duplicates.id)) {
				return false;
			}
			return true;
		};
		return {
			nodes: allNodes,
			directChildren,
			reviewTargets,
			harvestRoot,
			duplicates,
			filters,
			isSystematicReviewTree,
			isWorkflowNode,
		};
	},

	async _selectedHarvestSourceProjectInfo(win) {
		let selectedCollection = this._selectedCollection(win || this._primaryWindow());
		if (!selectedCollection) {
			return null;
		}
		let rootCollection = this._rootCollectionForCollection(selectedCollection);
		if (!rootCollection || rootCollection.id == selectedCollection.id) {
			return null;
		}
		if (!(await this._collectionHasStoredProject(rootCollection))) {
			return null;
		}
		let context = this._collectionProjectContext(rootCollection);
		let projectType = await this._projectTypeForContext(context, "");
		if (projectType != PROJECT_TYPE_SYSTEMATIC_REVIEW) {
			return null;
		}
		let layout = this._projectWorkflowTreeInfo(rootCollection);
		if (!layout.harvestRoot?.id || selectedCollection.parentID != layout.harvestRoot.id) {
			return null;
		}
		return {
			rootCollection,
			sourceCollection: selectedCollection,
		};
	},

	_projectReferenceData(raw, overrides = {}) {
		if (!raw) {
			return null;
		}
		let context = raw.context || raw;
		let projectID = String(overrides.projectID || context.projectID || raw.projectID || raw.project_id || "").trim();
		if (!projectID) {
			return null;
		}
		return {
			projectID,
			libraryID: Number(overrides.libraryID ?? context.libraryID ?? raw.libraryID ?? raw.library_id ?? 0) || 0,
			collectionKey: String(overrides.collectionKey || context.collectionKey || raw.collectionKey || raw.collection_key || "").trim(),
			collectionName: String(overrides.collectionName || context.collectionName || raw.collectionName || raw.collection_name || "").trim(),
			projectItemKey: String(
				overrides.projectItemKey
				|| raw.projectItem?.key
				|| raw.projectItemKey
				|| raw.project_item_key
				|| ""
			).trim(),
			outputsItemKey: String(
				overrides.outputsItemKey
				|| raw.outputsItem?.key
				|| raw.outputsItemKey
				|| raw.outputs_item_key
				|| ""
			).trim(),
			sessionID: String(
				overrides.sessionID
				|| raw.sessionID
				|| raw.session_id
				|| raw.last_session_id
				|| "default"
			).trim() || "default",
			projectType: this._normalizeProjectType(
				overrides.projectType
				|| raw.projectType
				|| raw.project_type
				|| PROJECT_TYPE_SYSTEMATIC_REVIEW
			),
		};
	},

	async _resolveProjectByID(projectID, options = {}) {
		let target = String(projectID || "").trim();
		if (!target) {
			return null;
		}
		let stored = (await this._listStoredProjects()).find((entry) => entry.project_id == target) || null;
		let reference = stored
			? {
				projectID: stored.project_id,
				libraryID: stored.library_id,
				collectionKey: stored.collection_key,
				collectionName: stored.collection_name,
				projectItemKey: stored.project_item_key || "",
				outputsItemKey: stored.outputs_item_key || "",
				sessionID: options.sessionID || options.session_id || stored.last_session_id || "default",
				projectType: stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW,
			}
			: null;
		if (!reference) {
			let parsed = this._parseProjectID(target);
			if (!parsed) {
				return null;
			}
			reference = {
				projectID: target,
				libraryID: parsed.libraryID,
				collectionKey: parsed.collectionKey,
				sessionID: options.sessionID || options.session_id || "default",
				projectType: PROJECT_TYPE_SYSTEMATIC_REVIEW,
			};
		}
		return await this._resolveProjectReference(reference);
	},

	async _resolveControllerProject(controller, { restoreIfMissing = true } = {}) {
		let current = await this._resolveProjectReference(controller?.projectRef || null);
		if (!current && restoreIfMissing) {
			current = await this._resolveCurrentProject();
			if (!current) {
				current = await this._restoreLastProjectSelection();
			}
		}
		if (current && controller) {
			controller.projectRef = this._projectReferenceData(current);
		}
		return current;
	},

	_projectTabSpec(kind, projectRef = null) {
		let project = this._projectReferenceData(projectRef) || null;
		let baseID =
			kind == "jobs"
				? this.jobsTabID
				: (kind == "settings" ? this.settingsTabID : this.workflowTabID);
		let type =
			kind == "jobs"
				? this.jobsTabType
				: this.workflowTabType;
			let defaultTitle =
				kind == "jobs"
					? "Jobs - Systematic Reviewer"
					: (kind == "settings" ? "Settings - Systematic Reviewer" : "Writer");
		let title = kind == "jobs"
			? defaultTitle
			: (kind == "settings"
				? defaultTitle
				: (project?.collectionName
				? `${defaultTitle} - ${project.collectionName}`
				: defaultTitle));
		return {
			id: kind == "jobs"
				? baseID
				: (kind == "settings" ? baseID : (project?.projectID ? `${baseID}-${project.projectID}` : baseID)),
			type,
			title,
			projectID: kind == "jobs" || kind == "settings" ? "" : (project?.projectID || ""),
			projectRef: project,
		};
	},

	_workflowTabLabel(activeTab = "", projectType = "") {
		let tabID = String(activeTab || "").trim();
		let hit = SystematicReviewerWorkflowManifest?.getViewDefinition?.(tabID)
			|| (SystematicReviewerWorkflowManifest?.listTabs?.(projectType || "") || []).find((entry) => String(entry?.id || "").trim() == tabID)
			|| null;
			return String(hit?.label || (tabID == "settings" ? "Settings" : "Writer")).trim();
	},

	_workflowTabTitle(projectRef = null, activeTab = "") {
		let project = this._projectReferenceData(projectRef) || null;
		let projectLabel = String(project?.collectionName || "").trim();
		let tabLabel = this._workflowTabLabel(activeTab, project?.projectType || "");
		if (!projectLabel && String(activeTab || "").trim() == "settings") {
			return "Settings - Systematic Reviewer";
		}
		if (projectLabel && tabLabel) {
			return `${projectLabel} - ${tabLabel}`;
		}
			return projectLabel || tabLabel || "Writer";
	},

	async _renameSystematicTabByID(tabID = "", title = "") {
		let nextTabID = String(tabID || "").trim();
		let nextTitle = String(title || "").trim();
		if (!nextTabID || !nextTitle) {
			return false;
		}
		for (let win of this._mainWindows()) {
			try {
				if (win?.Zotero_Tabs?._tabs?.some((candidate) => String(candidate?.id || "") == nextTabID)) {
					if (typeof win.Zotero_Tabs.rename == "function") {
						await win.Zotero_Tabs.rename(nextTabID, nextTitle);
						return true;
					}
				}
			}
			catch (_error) {}
		}
		return false;
	},

	_setCurrentProject(context, projectItem, sessionID = null, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW) {
		let normalizedType = this._normalizeProjectType(projectType);
		this.currentProject = {
			projectID: context.projectID,
			libraryID: context.libraryID,
			collectionKey: context.collectionKey,
			collectionName: context.collectionName,
			projectItemKey: projectItem?.key || "",
			sessionID: sessionID || "default",
			projectType: normalizedType,
		};
		this._recordLastProject(context, projectItem, sessionID || "default", normalizedType).catch((error) => {
			this.log(`failed to record last project: ${error}`);
		});
	},
};
