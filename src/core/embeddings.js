var SystematicReviewerWorkflowEmbeddings = (() => {
	const DEFAULT_BATCH_SIZE = 32;
	const IDENTITY_HYDRATION_BATCH_SIZE = 100;
	const SCOPE_ITEM_REF_BATCH_SIZE = 250;
	const METADATA_IDENTITY_FALLBACK_BATCH_SIZE = 25;
	const METADATA_DB_WRITE_BATCH_SIZE = 25;
	const FULL_TEXT_DOCUMENT_BATCH_SIZE = 10;
	const FULL_TEXT_CHUNK_WRITE_BATCH_SIZE = 25;
	const EMBEDDINGS_JOB_START_DELAY_MS = 220;
	const BUILTIN_SOURCE_KEYS = new Set([
		"title_abstract",
		"title",
		"abstract_note",
		"full_text",
	]);
	const BUILTIN_SOURCE_ORDER = new Map([
		["title_abstract", 0],
		["title", 1],
		["abstract_note", 2],
		["full_text", 3],
	]);
	const CitationMarkdown =
		typeof SystematicReviewerNativeMarkdown != "undefined"
			? SystematicReviewerNativeMarkdown
			: null;

	function normalizeKey(value) {
		let raw = String(value || "").trim().toLowerCase();
		if (!raw || raw == "title+abstract") {
			return "title_abstract";
		}
		if (raw == "abstract") {
			return "abstract_note";
		}
		if (raw == "vector") {
			return "title_abstract";
		}
		if (raw.startsWith("embedding:")) {
			return raw.slice("embedding:".length);
		}
		return raw;
	}

	function vectorKindForSource(sourceKey) {
		let key = normalizeKey(sourceKey);
		if (!key || key == "title_abstract") {
			return "vector";
		}
		if (key == "title") {
			return "embedding:title";
		}
		if (key == "abstract_note") {
			return "embedding:abstract_note";
		}
		return `embedding:${key.replace(/[^a-z0-9:_-]+/g, "_").replace(/^_+|_+$/g, "") || "field"}`;
	}

	function sourceKeyFromVectorKind(vectorKind) {
		let value = String(vectorKind || "").trim().toLowerCase();
		if (!value || value == "vector") {
			return "title_abstract";
		}
		if (value == "embedding:title") {
			return "title";
		}
		if (value == "embedding:abstract_note") {
			return "abstract_note";
		}
		if (value.startsWith("embedding:")) {
			return value.slice("embedding:".length);
		}
		return value;
	}

	function humanizeKey(value = "") {
		let text = String(value || "")
			.trim()
			.replace(/[_:-]+/g, " ");
		if (!text) {
			return "Text";
		}
		return text.replace(/\b\w/g, (char) => char.toUpperCase());
	}

	function sourceDescriptor(sourceKey = "") {
		let key = normalizeKey(sourceKey);
		if (!key || BUILTIN_SOURCE_KEYS.has(key)) {
			return {
				key: key || "title_abstract",
				family: "builtin",
			};
		}
		if (key.startsWith("screening:")) {
			let columnKey = key.slice("screening:".length);
			return {
				key,
				family: "screening",
				column_key: columnKey,
				local_key: columnKey,
			};
		}
		if (key.startsWith("extraction:")) {
			let fieldKey = key.slice("extraction:".length);
			return {
				key,
				family: "extraction",
				field_key: fieldKey,
				local_key: fieldKey,
			};
		}
		return {
			key,
			family: "custom",
			local_key: key,
		};
	}

	function sourceLabel(sourceKey, options = {}) {
		let descriptor = sourceDescriptor(sourceKey);
		let key = descriptor.key;
		if (key == "title_abstract") {
			return "Title + Abstract";
		}
		if (key == "title") {
			return "Title";
		}
		if (key == "abstract_note") {
			return "Abstract";
		}
		if (key == "full_text") {
			return "Full Text";
		}
		let explicitLabel = optionalString(options?.label);
		if (descriptor.family == "screening") {
			return `Screening: ${explicitLabel || humanizeKey(descriptor.column_key)}`;
		}
		if (descriptor.family == "extraction") {
			return `Extraction: ${explicitLabel || humanizeKey(descriptor.field_key)}`;
		}
		return explicitLabel || humanizeKey(descriptor.local_key || key || "text");
	}

	function sourceTextFields(sourceKey) {
		let descriptor = sourceDescriptor(sourceKey);
		let key = descriptor.key;
		if (key == "title_abstract") {
			return ["title", "abstract_note"];
		}
		if (key == "title") {
			return ["title"];
		}
		if (key == "abstract_note") {
			return ["abstract_note"];
		}
		if (key == "full_text") {
			return ["full_text"];
		}
		return [descriptor.local_key || key];
	}

	function sourceFamilyOrder(sourceKey = "") {
		let family = sourceDescriptor(sourceKey).family;
		if (family == "builtin") {
			return 0;
		}
		if (family == "screening") {
			return 1;
		}
		if (family == "extraction") {
			return 2;
		}
		return 3;
	}

	function compareSourceEntries(left = {}, right = {}) {
		let familyDiff = sourceFamilyOrder(left?.key) - sourceFamilyOrder(right?.key);
		if (familyDiff) {
			return familyDiff;
		}
		if (sourceDescriptor(left?.key).family == "builtin" && sourceDescriptor(right?.key).family == "builtin") {
			return (Number(BUILTIN_SOURCE_ORDER.get(String(left?.key || ""))) || 99)
				- (Number(BUILTIN_SOURCE_ORDER.get(String(right?.key || ""))) || 99);
		}
		return String(left?.label || left?.key || "").localeCompare(String(right?.label || right?.key || ""))
			|| String(left?.key || "").localeCompare(String(right?.key || ""));
	}

	function buildSourceEntry(sourceKey, count = null, options = {}) {
		let descriptor = sourceDescriptor(sourceKey);
		let entry = {
			key: descriptor.key,
			label: sourceLabel(descriptor.key, options),
			text_fields: sourceTextFields(descriptor.key),
			vector_column: vectorKindForSource(descriptor.key),
			family: descriptor.family,
		};
		if (descriptor.column_key) {
			entry.column_key = descriptor.column_key;
		}
		if (descriptor.field_key) {
			entry.field_key = descriptor.field_key;
		}
		let searchParts = [
			entry.label,
			entry.key,
			options?.label,
			options?.field_label,
			options?.column_label,
		].map((value) => optionalString(value)).filter(Boolean);
		if (searchParts.length) {
			entry.search_text = Array.from(new Set(searchParts)).join(" ");
		}
		if (count !== null && count !== undefined) {
			entry.item_count = Number(count || 0) || 0;
		}
		return entry;
	}

	function lightweightSourceEntry(sourceKey) {
		let entry = buildSourceEntry(sourceKey);
		delete entry.item_count;
		return entry;
	}

	function summarizeSourceKey(sourceKey) {
		return sourceLabel(sourceKey);
	}

	function optionalString(value) {
		return String(value || "").trim();
	}

	function waitForJobCompletion(payload = {}, defaultWait = true) {
		if (payload?.wait_for_completion === true || payload?.waitForCompletion === true || payload?.await_completion === true) {
			return true;
		}
		if (payload?.wait_for_completion === false || payload?.waitForCompletion === false || payload?.await_completion === false) {
			return false;
		}
		if (payload?.detach === true || payload?.background === true || payload?.queue_only === true || payload?.queueOnly === true) {
			return false;
		}
		return defaultWait;
	}

	function currentContext(currentOrContext) {
		return currentOrContext?.context || currentOrContext;
	}

	function projectType(reviewer, current) {
		let raw = current?.storedProject?.projectType || current?.projectType || "";
		if (typeof reviewer?._normalizeProjectType == "function") {
			return reviewer._normalizeProjectType(raw);
		}
		return optionalString(raw);
	}

	function isSystematicReviewTree(reviewer, current) {
		let root = current?.collection || null;
		if (!root || typeof reviewer?._projectWorkflowTreeInfo != "function") {
			return false;
		}
		let layout = reviewer._projectWorkflowTreeInfo(root) || null;
		return !!layout?.isSystematicReviewTree;
	}

	function isSystematicReviewProject(reviewer, current) {
		return isSystematicReviewTree(reviewer, current) || projectType(reviewer, current) == "systematic_review";
	}

	function collectionRecordCount(collection, { includeDescendants = false } = {}) {
		if (!collection) {
			return 0;
		}
		let collections = [collection];
		if (includeDescendants) {
			try {
				for (let desc of collection.getDescendents(false, "collection", false) || []) {
					let next = desc?.id ? Zotero.Collections.get(desc.id) : null;
					if (next && !next.deleted) {
						collections.push(next);
					}
				}
			}
			catch (_error) {}
		}
		let seen = new Set();
		for (let currentCollection of collections) {
			for (let item of currentCollection.getChildItems(false, false) || []) {
				if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				let itemKey = optionalString(item.key);
				if (itemKey) {
					seen.add(itemKey);
				}
			}
		}
		return seen.size;
	}

	function scopeLabel(name = "", count = 0, prefix = "") {
		return `${String(prefix || "")}${optionalString(name)} (${Number(count || 0) || 0})`;
	}

	function scopeLabelWithoutCount(name = "", prefix = "") {
		return `${String(prefix || "")}${optionalString(name)}`.trim();
	}

	function normalizeScopePurpose(value = "") {
		let raw = String(value || "").trim().toLowerCase();
		if (["semantic", "semantic_search", "semantic-search"].includes(raw)) {
			return "semantic";
		}
		if (["explore"].includes(raw)) {
			return "explore";
		}
		if (["extraction", "extract"].includes(raw)) {
			return "extraction";
		}
		if (["screening"].includes(raw)) {
			return "screening";
		}
		return "embeddings";
	}

	function scopePurposeFromPayload(payload = {}) {
		return normalizeScopePurpose(
			payload?.purpose
			|| payload?.scope_purpose
			|| payload?.scopePurpose
			|| payload?.tab_id
			|| payload?.tabID
			|| "embeddings"
		);
	}

	function scopeSpecFromPayload(payload = {}) {
		if (!payload || typeof payload != "object") {
			return null;
		}
		let scope =
			payload.review_scope
			?? payload.reviewScope
			?? payload.collection_scope
			?? payload.collectionScope
			?? payload.scope
			?? "";
		let collectionKey =
			payload.collection_key
			?? payload.collectionKey
			?? payload.scope_collection_key
			?? payload.scopeCollectionKey
			?? "";
		let collectionName =
			payload.collection_name
			?? payload.collectionName
			?? payload.scope_collection_name
			?? payload.scopeCollectionName
			?? "";
		if (!scope && !collectionKey && !collectionName) {
			return null;
		}
		return {
			scope,
			collection_key: collectionKey,
			collection_name: collectionName,
		};
	}

	function defaultScopeEntry(reviewer, current) {
		let scopes = availableScopes(reviewer, current);
		let preferredScopeKey = optionalString(
			current?.settings?.workflow_ui?.last_scope_key
			|| current?.settings?.workflow_ui?.lastScopeKey
			|| current?.settings?.workflowUI?.last_scope_key
			|| current?.settings?.workflowUI?.lastScopeKey
		);
		if (preferredScopeKey) {
			let preferred = scopes.find((entry) => optionalString(entry?.collection_key) == preferredScopeKey);
			if (preferred) {
				return preferred;
			}
		}
		return scopes.find((entry) => optionalString(entry?.collection_name).toLowerCase() == "pending")
			|| scopes[0]
			|| null;
	}

	function resolvedScopeSpec(reviewer, current, payload = {}) {
		let explicit = scopeSpecFromPayload(payload);
		if (explicit) {
			return explicit;
		}
		if (!isSystematicReviewProject(reviewer, current)) {
			return null;
		}
		let fallback = defaultScopeEntry(reviewer, current);
		if (!fallback?.collection_key) {
			return null;
		}
		return {
			scope: String(fallback.scope_kind || ""),
			collection_key: String(fallback.collection_key || ""),
			collection_name: String(fallback.collection_name || ""),
		};
	}

	function scopeDescriptor(reviewer, current, payload = {}) {
		let collection = current?.collection || null;
		if (!collection || !reviewer?._projectScopeDescriptor) {
			return null;
		}
		return reviewer._projectScopeDescriptor(collection, resolvedScopeSpec(reviewer, current, payload));
	}

	async function projectConnection(reviewer, context) {
		let db = await reviewer._projectDB(context);
		let conn = db._getConnection?.() || await db._getConnectionAsync?.();
		if (!conn?.execute) {
			throw new Error("Project SQLite connection is unavailable.");
		}
		return { db, conn };
	}

	function rowValue(row, name) {
		if (!row) {
			return undefined;
		}
		try {
			return row.getResultByName(name);
		}
		catch (_error) {}
		try {
			return row[name];
		}
		catch (_error) {}
		return undefined;
	}

	async function executeRows(reviewer, context, sql, params = []) {
		let { conn } = await projectConnection(reviewer, context);
		let runner = async () => (await conn.execute(sql, params)) || [];
		if (!sqlNeedsProjectDBWriteLease(sql) || !reviewer?._withProjectDBWriteLease) {
			return await runner();
		}
		return await reviewer._withProjectDBWriteLease(context, runner, {
			ownerKey: `project-db:${context?.projectID || "project"}:${Math.random().toString(36).slice(2, 8)}`,
		});
	}

	async function executeWrite(reviewer, context, sql, params = []) {
		let { db } = await projectConnection(reviewer, context);
		let runner = async () => {
			await db.executeTransaction(async () => {
				await db.queryAsync(sql, params);
			});
		};
		if (!reviewer?._withProjectDBWriteLease) {
			await runner();
			return;
		}
		await reviewer._withProjectDBWriteLease(context, runner, {
			ownerKey: `project-db:${context?.projectID || "project"}:${Math.random().toString(36).slice(2, 8)}`,
		});
	}

	async function checkpointProjectDB(reviewer, context) {
		try {
			await executeRows(reviewer, context, "PRAGMA wal_checkpoint(TRUNCATE)");
		}
		catch (_error) {}
	}

	function chunkArray(items = [], size = SCOPE_ITEM_REF_BATCH_SIZE) {
		let out = [];
		let chunkSize = Math.max(1, Number(size || 0) || 1);
		for (let index = 0; index < items.length; index += chunkSize) {
			out.push(items.slice(index, index + chunkSize));
		}
		return out;
	}

	function sqlNeedsProjectDBWriteLease(sql = "") {
		let normalized = String(sql || "").trim().replace(/^[\s(;]+/, "").toUpperCase();
		if (!normalized) {
			return false;
		}
		return !normalized.startsWith("SELECT") && !normalized.startsWith("WITH");
	}

	async function projectSourceDefinitions(reviewer, currentOrContext) {
		let context = currentContext(currentOrContext);
		if (!context) {
			return [];
		}
		try {
			if (typeof SystematicReviewerWorkflowScreening?.ensureSchema == "function") {
				await SystematicReviewerWorkflowScreening.ensureSchema(reviewer, context);
			}
		}
		catch (_error) {}
		try {
			if (typeof SystematicReviewerWorkflowExtraction?.ensureSchema == "function") {
				await SystematicReviewerWorkflowExtraction.ensureSchema(reviewer, context);
			}
		}
		catch (_error) {}
		let out = [
			lightweightSourceEntry("title_abstract"),
			lightweightSourceEntry("title"),
			lightweightSourceEntry("abstract_note"),
			lightweightSourceEntry("full_text"),
		];
		let screeningRows = await executeRows(
			reviewer,
			context,
			`SELECT column_key, label
			 FROM screening_columns
			 WHERE LOWER(COALESCE(type, ''))='text'
			 ORDER BY LOWER(COALESCE(label, column_key)) ASC, column_key ASC`
		).catch(() => []);
		for (let row of screeningRows || []) {
			let columnKey = optionalString(rowValue(row, "column_key"));
			if (!columnKey) {
				continue;
			}
			out.push(buildSourceEntry(`screening:${columnKey}`, null, {
				label: optionalString(rowValue(row, "label")) || columnKey,
				column_label: optionalString(rowValue(row, "label")) || columnKey,
			}));
		}
		let extractionRows = await executeRows(
			reviewer,
			context,
			`SELECT
				field_key,
				MIN(COALESCE(field_label, '')) AS field_label,
				MIN(LOWER(COALESCE(field_type, ''))) AS field_type
			 FROM extraction_values
			 WHERE COALESCE(value_text, '') <> ''
			   AND LOWER(COALESCE(field_type, '')) != 'boolean'
			 GROUP BY field_key
			 ORDER BY LOWER(COALESCE(field_label, field_key)) ASC, field_key ASC`
		).catch(() => []);
		for (let row of extractionRows || []) {
			let fieldKey = optionalString(rowValue(row, "field_key"));
			if (!fieldKey) {
				continue;
			}
			out.push(buildSourceEntry(`extraction:${fieldKey}`, null, {
				label: optionalString(rowValue(row, "field_label")) || fieldKey,
				field_label: optionalString(rowValue(row, "field_label")) || fieldKey,
			}));
		}
		return out.sort(compareSourceEntries);
	}

	async function sourceLabelLookup(reviewer, currentOrContext) {
		let map = new Map();
		for (let entry of await projectSourceDefinitions(reviewer, currentOrContext)) {
			map.set(String(entry.key || ""), String(entry.label || entry.key || ""));
		}
		return map;
	}

	async function scopedItemRefs(reviewer, current, payload = {}, options = {}) {
		let collection = current?.collection || null;
		let projectItem = current?.projectItem || null;
		if (!collection || !projectItem) {
			return options?.returnPage === true
				? { refs: [], offset: 0, limit: 0, returned: 0, scanned_rows: 0, total_rows: 0, total_rows_known: true, has_more: false }
				: [];
		}
		let pageLimit = Math.max(0, Math.round(Number(options?.limit || 0) || 0));
		let pageOffset = Math.max(0, Math.round(Number(options?.offset || 0) || 0));
		let returnPage = options?.returnPage === true;
		let stopAfterPage = returnPage && options?.stopAfterPage !== false && pageLimit > 0;
		let scopeSpec = resolvedScopeSpec(reviewer, current, payload);
		let out = [];
		let scannedRows = 0;
		let hasMore = false;
		let addRef = (entry) => {
			scannedRows += 1;
			if (pageLimit > 0) {
				if (scannedRows <= pageOffset) {
					return true;
				}
				if (out.length < pageLimit) {
					out.push(entry);
					return true;
				}
				hasMore = true;
				return !stopAfterPage;
			}
			out.push(entry);
			return true;
		};
		if (typeof reviewer?._eachProjectCitableItem == "function") {
			await reviewer._eachProjectCitableItem(
				collection,
				projectItem,
				scopeSpec,
				async (item, info = {}) => {
					let itemKey = optionalString(info?.itemKey || item?.key);
					let itemID = Number(item?.id || 0) || 0;
					if (!itemKey || !itemID) {
						return true;
					}
					return addRef({
						item_key: itemKey,
						item_id: itemID,
					});
				},
				{
					batchSize: Math.max(25, Number(options.batchSize || 0) || SCOPE_ITEM_REF_BATCH_SIZE),
				}
			);
			return returnPage
				? {
					refs: out,
					offset: pageOffset,
					limit: pageLimit || out.length,
					returned: out.length,
					scanned_rows: scannedRows,
					total_rows: hasMore ? null : scannedRows,
					total_rows_known: !hasMore,
					has_more: hasMore,
				}
				: out;
		}
		let items = reviewer?._projectCitableItems
			? reviewer._projectCitableItems(collection, projectItem, scopeSpec)
			: [];
		let refs = (items || []).map((item) => ({
			item_key: optionalString(item?.key),
			item_id: Number(item?.id || 0) || 0,
		})).filter((entry) => entry.item_key && entry.item_id);
		if (!returnPage || pageLimit <= 0) {
			return refs;
		}
		let pageRefs = refs.slice(pageOffset, pageOffset + pageLimit);
		return {
			refs: pageRefs,
			offset: pageOffset,
			limit: pageLimit,
			returned: pageRefs.length,
			scanned_rows: refs.length,
			total_rows: refs.length,
			total_rows_known: true,
			has_more: pageOffset + pageRefs.length < refs.length,
		};
	}

	async function loadIdentityRowsByItemKey(reviewer, context, itemKeys = []) {
		let keys = Array.from(new Set((itemKeys || []).map((value) => optionalString(value)).filter(Boolean)));
		if (!keys.length) {
			return new Map();
		}
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT
				paper_id,
				item_key,
				openalex_id,
				doi,
				pmid,
				arxiv_id,
				isbn,
				citation_text,
				title,
				year,
				abstract_note,
				abstract_origin
			 FROM item_identities
			 WHERE item_key IN (${keys.map(() => "?").join(", ")})`,
			keys
		);
		let out = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(rowValue(row, "item_key"));
			if (!itemKey) {
				continue;
			}
			out.set(itemKey, {
				paper_id: optionalString(rowValue(row, "paper_id")),
				item_key: itemKey,
				openalex_id: optionalString(rowValue(row, "openalex_id")),
				doi: optionalString(rowValue(row, "doi")),
				pmid: optionalString(rowValue(row, "pmid")),
				arxiv_id: optionalString(rowValue(row, "arxiv_id")),
				isbn: optionalString(rowValue(row, "isbn")),
				citation_text: optionalString(rowValue(row, "citation_text")),
				title: optionalString(rowValue(row, "title")),
				year: optionalString(rowValue(row, "year")),
				abstract_note: optionalString(rowValue(row, "abstract_note")),
				abstract_origin: optionalString(rowValue(row, "abstract_origin")),
			});
		}
		return out;
	}

	function identityRequiresHydration(identity = null, requiredFields = []) {
		if (!identity) {
			return true;
		}
		let fields = Array.isArray(requiredFields) ? requiredFields : [];
		if (fields.includes("title") && !optionalString(identity?.title)) {
			return true;
		}
		if (fields.includes("abstract_note") && !optionalString(identity?.abstract_note)) {
			return true;
		}
		if (fields.includes("publication_title")) {
			return true;
		}
		return false;
	}

	function buildRecordFromSources(itemKey = "", identity = null, serialized = null) {
		let abstractNote = optionalString(identity?.abstract_note || serialized?.abstractNote || "");
		return {
			item_key: itemKey,
			citation_token: CitationMarkdown?.makeCitationMarkdown
				? CitationMarkdown.makeCitationMarkdown({ keys: [itemKey] })
				: `@[${itemKey}]`,
			citation_text: optionalString(identity?.citation_text),
			paper_id: optionalString(identity?.paper_id || serialized?.paperID),
			openalex_id: optionalString(identity?.openalex_id || serialized?.openalexID),
			title: optionalString(identity?.title || serialized?.title),
			publication_title: optionalString(serialized?.publicationTitle),
			abstract_note: abstractNote,
			abstract_origin: optionalString(identity?.abstract_origin || (abstractNote ? "Zotero" : "")),
			year: optionalString(identity?.year || serialized?.year),
			doi: optionalString(identity?.doi || serialized?.doi),
			pmid: optionalString(identity?.pmid || serialized?.pmid),
			arxiv: optionalString(identity?.arxiv_id || serialized?.arxiv),
			isbn: optionalString(identity?.isbn || serialized?.isbn),
			creators_json: optionalString(serialized?.creatorsJSON),
			zotero_uri: optionalString(serialized?.zoteroURI),
		};
	}

	async function loadMetadataRowsForRefs(reviewer, current, refs = [], options = {}) {
		let context = current?.context || null;
		if (!context || !refs.length) {
			return [];
		}
		let requiredFields = Array.isArray(options?.requiredFields) ? options.requiredFields : [];
		let itemKeys = refs.map((entry) => entry.item_key);
		let identityByKey = await loadIdentityRowsByItemKey(reviewer, context, itemKeys);
		let missingRefs = refs.filter((entry) => identityRequiresHydration(identityByKey.get(entry.item_key) || null, requiredFields));
		let serializedByKey = new Map();
		if (missingRefs.length) {
			let items = Zotero.Items.get(missingRefs.map((entry) => Number(entry?.item_id || 0) || 0).filter(Boolean)) || [];
			let usableItems = items.filter((item) =>
				item
				&& !item.deleted
				&& !!item.key
				&& !item.isAttachment?.()
				&& !item.isNote?.()
				&& !item.isAnnotation?.()
			);
			if (usableItems.length) {
				let hydrated = reviewer?._ensureProjectItemIdentitiesBatched
					? await reviewer._ensureProjectItemIdentitiesBatched(
						context,
						usableItems,
						null,
						METADATA_IDENTITY_FALLBACK_BATCH_SIZE
					)
					: reviewer?._ensureProjectItemIdentities
						? await reviewer._ensureProjectItemIdentities(context, usableItems)
						: new Map();
				for (let [itemKey, identity] of (hydrated || new Map()).entries()) {
					identityByKey.set(String(itemKey || ""), {
						paper_id: optionalString(identity?.paper_id),
						item_key: optionalString(itemKey),
						openalex_id: optionalString(identity?.openalex_id),
						doi: optionalString(identity?.doi),
						pmid: optionalString(identity?.pmid),
						arxiv_id: optionalString(identity?.arxiv_id),
						isbn: optionalString(identity?.isbn),
						citation_text: optionalString(identity?.citation_text),
						title: optionalString(identity?.title),
						year: optionalString(identity?.year),
						abstract_note: optionalString(identity?.abstract_note),
						abstract_origin: optionalString(identity?.abstract_origin),
					});
				}
				if (typeof reviewer?._serializeItem == "function") {
					for (let item of usableItems) {
						serializedByKey.set(String(item.key || ""), reviewer._serializeItem(item));
					}
				}
			}
		}
		return refs.map((entry) =>
			buildRecordFromSources(
				String(entry.item_key || ""),
				identityByKey.get(String(entry.item_key || "")) || null,
				serializedByKey.get(String(entry.item_key || "")) || null
			)
		);
	}

	async function projectItemRows(reviewer, current, payload = {}, options = {}) {
		let batchSize = normalizeBatchSize(options?.batchSize || SCOPE_ITEM_REF_BATCH_SIZE);
		let page = options?.returnPage === true
			? await scopedItemRefs(reviewer, current, payload, {
				batchSize,
				offset: options?.offset,
				limit: options?.limit,
				returnPage: true,
				stopAfterPage: options?.stopAfterPage,
			})
			: null;
		let refs = page
			? page.refs || []
			: await scopedItemRefs(reviewer, current, payload, {
			batchSize,
		});
		if (!refs.length) {
			return page ? Object.assign({}, page, { rows: [] }) : [];
		}
		let requiredFields = Array.isArray(options?.requiredFields) ? options.requiredFields : ["title"];
		let rows = [];
		for (let batch of chunkArray(refs, batchSize)) {
			rows.push(...(await loadMetadataRowsForRefs(reviewer, current, batch, {
				requiredFields,
			})));
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		return page ? Object.assign({}, page, { rows }) : rows;
	}

	async function existingModelsByItemKey(reviewer, context, vectorKind, itemKeys = []) {
		let keys = Array.from(new Set((itemKeys || []).map((value) => optionalString(value)).filter(Boolean)));
		if (!keys.length) {
			return new Map();
		}
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT item_key, COALESCE(model, '') AS existing_model
			 FROM item_vectors
			 WHERE vector_kind=?
			   AND item_key IN (${keys.map(() => "?").join(", ")})`,
			[vectorKind, ...keys]
		);
		let out = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(rowValue(row, "item_key"));
			if (itemKey) {
				out.set(itemKey, optionalString(rowValue(row, "existing_model")));
			}
		}
		return out;
	}

	async function screeningTextsByItemKey(reviewer, context, columnKey = "", itemKeys = []) {
		let keys = Array.from(new Set((itemKeys || []).map((value) => optionalString(value)).filter(Boolean)));
		if (!columnKey || !keys.length) {
			return new Map();
		}
		try {
			if (typeof SystematicReviewerWorkflowScreening?.ensureSchema == "function") {
				await SystematicReviewerWorkflowScreening.ensureSchema(reviewer, context);
			}
		}
		catch (_error) {}
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT item_key, COALESCE(value_text, '') AS value_text
			 FROM screening_column_values
			 WHERE column_key=?
			   AND item_key IN (${keys.map(() => "?").join(", ")})`,
			[columnKey, ...keys]
		).catch(() => []);
		let out = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(rowValue(row, "item_key"));
			let valueText = optionalString(rowValue(row, "value_text"));
			if (itemKey && valueText) {
				out.set(itemKey, valueText);
			}
		}
		return out;
	}

	async function extractionTextsByItemKey(reviewer, context, fieldKey = "", itemKeys = []) {
		let keys = Array.from(new Set((itemKeys || []).map((value) => optionalString(value)).filter(Boolean)));
		if (!fieldKey || !keys.length) {
			return new Map();
		}
		try {
			if (typeof SystematicReviewerWorkflowExtraction?.ensureSchema == "function") {
				await SystematicReviewerWorkflowExtraction.ensureSchema(reviewer, context);
			}
		}
		catch (_error) {}
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT
				item_key,
				COALESCE(value_text, '') AS value_text,
				updated_at
			 FROM extraction_values
			 WHERE field_key=?
			   AND COALESCE(value_text, '') <> ''
			   AND LOWER(COALESCE(field_type, '')) != 'boolean'
			   AND COALESCE(status, 'ok')='ok'
			   AND item_key IN (${keys.map(() => "?").join(", ")})
			 ORDER BY item_key ASC, updated_at DESC, template_path ASC`,
			[fieldKey, ...keys]
		).catch(() => []);
		let out = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(rowValue(row, "item_key"));
			if (!itemKey || out.has(itemKey)) {
				continue;
			}
			let valueText = optionalString(rowValue(row, "value_text"));
			if (valueText) {
				out.set(itemKey, valueText);
			}
		}
		return out;
	}

	async function sourceTextsByItemKey(reviewer, current, source = null, refs = []) {
		let descriptor = sourceDescriptor(source?.key || "");
		let context = current?.context || null;
		let itemKeys = refs.map((entry) => entry.item_key);
		if (!context || !descriptor.key || !itemKeys.length) {
			return new Map();
		}
		if (descriptor.family == "builtin") {
			let rows = await loadMetadataRowsForRefs(reviewer, current, refs, {
				requiredFields: sourceTextFields(descriptor.key),
			});
			return new Map(rows.map((row) => [String(row.item_key || ""), recordText(row, descriptor.key)]));
		}
		if (descriptor.family == "screening") {
			return await screeningTextsByItemKey(reviewer, context, descriptor.column_key, itemKeys);
		}
		if (descriptor.family == "extraction") {
			return await extractionTextsByItemKey(reviewer, context, descriptor.field_key, itemKeys);
		}
		return new Map();
	}

	async function writeEmbeddedItemSlices(reviewer, context, sourceKey, vectorKind, model, entries = [], options = {}) {
		let db = await reviewer._projectDB(context);
		let batchSize = normalizeBatchSize(options?.batchSize || METADATA_DB_WRITE_BATCH_SIZE);
		for (let batch of chunkArray(entries, batchSize)) {
			let updatedAt = new Date().toISOString();
			await db.executeTransaction(async () => {
				for (let entry of batch || []) {
					await db.queryAsync(
						`INSERT OR REPLACE INTO item_text_sources (
							item_key, source_key, source_text, updated_at
						) VALUES (?, ?, ?, ?)`,
						[
							entry.item_key,
							sourceKey,
							entry.text,
							updatedAt,
						]
					);
					await db.queryAsync(
						`INSERT OR REPLACE INTO item_vectors (
							item_key, vector_kind, vector_blob, dimensions, model, updated_at
						) VALUES (?, ?, ${vectorBlobLiteral(entry.vector)}, ?, ?, ?)`,
						[
							entry.item_key,
							vectorKind,
							entry.vector.length,
							model,
							updatedAt,
						]
					);
				}
			});
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
	}

	function normalizeBatchSize(value) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return DEFAULT_BATCH_SIZE;
		}
		return Math.max(1, Math.round(parsed));
	}

	function embeddingsEndpoint(baseUrl) {
		let base = String(baseUrl || "").trim().replace(/\/+$/, "");
		if (!base) {
			return "";
		}
		return base.endsWith("/v1") ? `${base}/embeddings` : `${base}/v1/embeddings`;
	}

	function authorizationHeaders(reviewer, apiKey = "") {
		if (reviewer?._authorizationHeaders) {
			return reviewer._authorizationHeaders(apiKey || "");
		}
		let value = String(apiKey || "").trim();
		return value ? { authorization: `Bearer ${value}` } : {};
	}

	async function postJSON(url, payload, timeoutMs = 120000, headers = {}) {
		let AbortCtor = globalThis.AbortController || null;
		let controller = AbortCtor ? new AbortCtor() : null;
		let timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
		try {
			let response = await fetch(url, {
				method: "POST",
				headers: Object.assign(
					{
						accept: "application/json",
						"content-type": "application/json",
					},
					headers || {}
				),
				body: JSON.stringify(payload || {}),
				...(controller ? { signal: controller.signal } : {}),
			});
			let text = await response.text();
			let parsed = {};
			try {
				parsed = text ? JSON.parse(text) : {};
			}
			catch (_error) {
				parsed = {};
			}
			if (!response.ok) {
				throw new Error(parsed?.error?.message || parsed?.error || text || `HTTP ${response.status}`);
			}
			return parsed;
		}
		finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}

	function normalizeVector(vector = [], normalize = true) {
		if (!normalize || !Array.isArray(vector) || !vector.length) {
			return Array.isArray(vector) ? vector.map((value) => Number(value || 0)) : [];
		}
		let sum = 0;
		let out = vector.map((value) => {
			let number = Number(value || 0);
			sum += number * number;
			return number;
		});
		let norm = Math.sqrt(sum);
		if (!norm || !Number.isFinite(norm)) {
			return out;
		}
		return out.map((value) => value / norm);
	}

	function vectorToBlob(vector = []) {
		let typed = new Float32Array(vector.length);
		for (let index = 0; index < vector.length; index += 1) {
			typed[index] = Number(vector[index] || 0);
		}
		return new Uint8Array(typed.buffer.slice(0));
	}

	function bytesToHex(bytes) {
		let out = "";
		for (let index = 0; index < bytes.length; index += 1) {
			out += bytes[index].toString(16).padStart(2, "0");
		}
		return out;
	}

	function vectorBlobLiteral(vector = []) {
		let bytes = vectorToBlob(vector);
		return `X'${bytesToHex(bytes)}'`;
	}

	function blobToVector(blob) {
		if (!blob) {
			return [];
		}
		let bytes = null;
		if (blob instanceof Uint8Array) {
			bytes = blob;
		}
		else if (blob instanceof ArrayBuffer) {
			bytes = new Uint8Array(blob);
		}
		else if (Array.isArray(blob)) {
			bytes = Uint8Array.from(blob);
		}
		else if (typeof blob == "string") {
			let out = new Uint8Array(blob.length);
			for (let index = 0; index < blob.length; index += 1) {
				out[index] = blob.charCodeAt(index) & 0xff;
			}
			bytes = out;
		}
		if (!bytes || !bytes.byteLength) {
			return [];
		}
		let start = bytes.byteOffset || 0;
		let end = start + bytes.byteLength;
		let slice = bytes.buffer.slice(start, end);
		let floats = new Float32Array(slice);
		return Array.from(floats);
	}

	function recordText(record, sourceKey) {
		let key = normalizeKey(sourceKey);
		let title = String(record?.title || "").trim();
		let abstractNote = String(record?.abstract_note || "").trim();
		if (key == "title_abstract") {
			return [title, abstractNote].filter(Boolean).join("\n\n").trim();
		}
		if (key == "title") {
			return title;
		}
		if (key == "abstract_note") {
			return abstractNote;
		}
		return String(record?.[key] || "").trim();
	}

	function serializeStatusRow(row = {}, sourceLabels = new Map()) {
		let vectorKind = String(row.vector_kind || "");
		let sourceKey = sourceKeyFromVectorKind(vectorKind);
		return {
			source_key: sourceKey,
			source_label: sourceLabels.get(sourceKey) || summarizeSourceKey(sourceKey),
			vector_column: vectorKind,
			spec: String(row.model || "").trim() || summarizeSourceKey(sourceKey),
			model: String(row.model || "").trim(),
			vector_count: Number(row.vector_count || 0) || 0,
			vector_dim: Number(row.vector_dim || 0) || 0,
			last_updated: String(row.last_updated || ""),
		};
	}

	async function countSourcesForRefs(reviewer, current, refs = [], payload = {}) {
		let context = current?.context || null;
		let titleCount = 0;
		let abstractCount = 0;
		let customCounts = new Map();
		if (!context || !refs.length) {
			return {
				totalItems: 0,
				titleCount,
				abstractCount,
				fullTextCount: 0,
				customCounts,
			};
		}
		for (let batch of chunkArray(refs, SCOPE_ITEM_REF_BATCH_SIZE)) {
			let itemKeys = batch.map((entry) => entry.item_key);
			let metadataRows = await loadMetadataRowsForRefs(reviewer, current, batch, {
				requiredFields: ["title"],
			});
			for (let row of metadataRows || []) {
				if (optionalString(row?.title)) {
					titleCount += 1;
				}
				if (optionalString(row?.abstract_note)) {
					abstractCount += 1;
				}
			}
			let screeningRows = await executeRows(
				reviewer,
				context,
				`SELECT column_key, COUNT(*) AS item_count
				 FROM screening_column_values
				 WHERE COALESCE(value_text, '') <> ''
				   AND item_key IN (${itemKeys.map(() => "?").join(", ")})
				 GROUP BY column_key`,
				itemKeys
			).catch(() => []);
			for (let row of screeningRows || []) {
				let columnKey = optionalString(rowValue(row, "column_key"));
				if (!columnKey) {
					continue;
				}
				let sourceKey = `screening:${columnKey}`;
				customCounts.set(
					sourceKey,
					(Number(customCounts.get(sourceKey) || 0) || 0) + (Number(rowValue(row, "item_count")) || 0)
				);
			}
			let extractionRows = await executeRows(
				reviewer,
				context,
				`SELECT item_key, field_key
				 FROM extraction_values
				 WHERE COALESCE(value_text, '') <> ''
				   AND LOWER(COALESCE(field_type, '')) != 'boolean'
				   AND COALESCE(status, 'ok')='ok'
				   AND item_key IN (${itemKeys.map(() => "?").join(", ")})
				 ORDER BY field_key ASC, item_key ASC, updated_at DESC, template_path ASC`,
				itemKeys
			).catch(() => []);
			let extractionSeen = new Set();
			for (let row of extractionRows || []) {
				let itemKey = optionalString(rowValue(row, "item_key"));
				let fieldKey = optionalString(rowValue(row, "field_key"));
				if (!itemKey || !fieldKey) {
					continue;
				}
				let seenKey = `${fieldKey}::${itemKey}`;
				if (extractionSeen.has(seenKey)) {
					continue;
				}
				extractionSeen.add(seenKey);
				let sourceKey = `extraction:${fieldKey}`;
				customCounts.set(sourceKey, (Number(customCounts.get(sourceKey) || 0) || 0) + 1);
			}
		}
		let fullTextCount = SystematicReviewerWorkflowRAG?.countAvailableDocuments
			? await SystematicReviewerWorkflowRAG.countAvailableDocuments(reviewer, current, payload, {
				refs,
			})
			: 0;
		return {
			totalItems: refs.length,
			titleCount,
			abstractCount,
			fullTextCount,
			customCounts,
		};
	}

	async function listSources(reviewer, current, payload = {}) {
		let refs = await scopedItemRefs(reviewer, current, payload, {
			batchSize: SCOPE_ITEM_REF_BATCH_SIZE,
		});
		let definitions = await projectSourceDefinitions(reviewer, currentContext(current));
		let counts = await countSourcesForRefs(reviewer, current, refs, payload);
		let out = [];
		if (counts.totalItems > 0) {
			out.push(buildSourceEntry("title_abstract", counts.totalItems));
		}
		if (counts.titleCount > 0) {
			out.push(buildSourceEntry("title", counts.titleCount));
		}
		if (counts.abstractCount > 0) {
			out.push(buildSourceEntry("abstract_note", counts.abstractCount));
		}
		if (counts.fullTextCount > 0) {
			out.push(buildSourceEntry("full_text", counts.fullTextCount));
		}
		for (let entry of definitions || []) {
			let descriptor = sourceDescriptor(entry.key || "");
			if (descriptor.family == "builtin") {
				continue;
			}
			let count = Number(counts.customCounts.get(String(entry.key || "")) || 0) || 0;
			if (!count) {
				continue;
			}
			out.push(buildSourceEntry(entry.key, count, {
				label: entry.label,
				field_label: entry.field_label,
				column_label: entry.column_label,
			}));
		}
		return out.sort(compareSourceEntries);
	}

	async function listStored(reviewer, currentOrContext) {
		let context = currentContext(currentOrContext);
		await checkpointProjectDB(reviewer, context);
		let sourceLabels = await sourceLabelLookup(reviewer, context);
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT
				vector_kind,
				model,
				MAX(dimensions) AS vector_dim,
				COUNT(*) AS vector_count,
				MAX(updated_at) AS last_updated
			 FROM item_vectors
			 GROUP BY vector_kind, model
			 ORDER BY vector_kind ASC, model ASC`
		);
		let out = (rows || []).map((row) => serializeStatusRow({
			vector_kind: rowValue(row, "vector_kind"),
			model: rowValue(row, "model"),
			vector_dim: rowValue(row, "vector_dim"),
			vector_count: rowValue(row, "vector_count"),
			last_updated: rowValue(row, "last_updated"),
		}, sourceLabels));
		if (SystematicReviewerWorkflowRAG?.listStoredStatus) {
			out.push(...(await SystematicReviewerWorkflowRAG.listStoredStatus(reviewer, context)));
		}
		return out;
	}

	async function listSourceOptions(reviewer, current, payload = {}) {
		let currentModel = await currentEmbeddingsModel(reviewer).catch(() => "");
		let sources = current?.collection
			? await projectSourceDefinitions(reviewer, currentContext(current))
			: [];
		return {
			ok: true,
			scope: scopeDescriptor(reviewer, current, payload),
			current_model: currentModel,
			sources,
		};
	}

	async function hydrateSourceOptions(reviewer, current, payload = {}) {
		return {
			ok: true,
			scope: scopeDescriptor(reviewer, current, payload),
			sources: await listSources(reviewer, current, payload),
		};
	}

	async function listStoredOptions(reviewer, currentOrContext) {
		return {
			ok: true,
			stored: await listStored(reviewer, currentOrContext),
		};
	}

	async function storageSummary(reviewer, currentOrContext, vectorKind = "", model = "") {
		let context = currentContext(currentOrContext);
		if (String(vectorKind || "") == String(SystematicReviewerWorkflowRAG?.FULL_TEXT_VECTOR_KIND || "embedding:full_text")) {
			return await SystematicReviewerWorkflowRAG.storageSummary(
				reviewer,
				context,
				vectorKind,
				model
			);
		}
		await checkpointProjectDB(reviewer, context);
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT
				COUNT(*) AS total_rows,
				SUM(CASE WHEN vector_kind = ? THEN 1 ELSE 0 END) AS vector_kind_rows,
				SUM(CASE WHEN vector_kind = ? AND COALESCE(model, '') = ? THEN 1 ELSE 0 END) AS matching_rows,
				MAX(CASE WHEN vector_kind = ? THEN length(vector_blob) ELSE 0 END) AS max_blob_bytes
			 FROM item_vectors`,
			[
				vectorKind,
				vectorKind,
				String(model || ""),
				vectorKind,
			]
		);
		let row = rows?.[0] || null;
		return {
			total_rows: Number(rowValue(row, "total_rows") || 0) || 0,
			vector_kind_rows: Number(rowValue(row, "vector_kind_rows") || 0) || 0,
			matching_rows: Number(rowValue(row, "matching_rows") || 0) || 0,
			max_blob_bytes: Number(rowValue(row, "max_blob_bytes") || 0) || 0,
		};
	}

	function isHiddenWorkflowScopeCollection(reviewer, layout, collection, purpose = "embeddings") {
		if (!collection) {
			return true;
		}
		if (layout?.isSystematicReviewTree && !layout?.isWorkflowNode?.(collection)) {
			return true;
		}
		let lowerName = optionalString(collection.name).toLowerCase();
		let shadowedWorkflowScopes = [
			layout?.reviewTargets?.pending,
			layout?.reviewTargets?.included,
			layout?.reviewTargets?.excluded,
			layout?.reviewTargets?.excluded_ft,
			layout?.reviewTargets?.maybe,
			layout?.duplicates,
			layout?.harvestRoot,
			layout?.filters,
		].filter(Boolean);
		for (let target of shadowedWorkflowScopes) {
			if (!target?.id || target.id == collection.id) {
				continue;
			}
			if (
				optionalString(target.name).toLowerCase() == lowerName
				&& reviewer?._collectionHasAncestor?.(collection, target.id)
			) {
				return true;
			}
		}
		if (lowerName == "harvest") {
			return true;
		}
		if (purpose != "screening" && lowerName == "duplicates") {
			return true;
		}
		if (layout?.harvestRoot?.id && reviewer?._collectionHasAncestor?.(collection, layout.harvestRoot.id)) {
			return true;
		}
		if (
			purpose != "screening"
			&& layout?.duplicates?.id
			&& reviewer?._collectionHasAncestor?.(collection, layout.duplicates.id)
		) {
			return true;
		}
		return false;
	}

	function buildScopeEntries(reviewer, current, payload = {}, { includeCounts = true } = {}) {
		let root = current?.collection || null;
		if (!root || !reviewer?._projectCollectionNodes) {
			return [];
		}
		let purpose = scopePurposeFromPayload(payload);
		let layout = reviewer?._projectWorkflowTreeInfo?.(root) || null;
		let filterFolder = layout?.filters || null;
		let entries = isSystematicReviewProject(reviewer, current)
			? []
			: [{
				scope_kind: "project",
				collection_key: "",
				collection_name: optionalString(root.name),
				label: includeCounts
					? scopeLabel(optionalString(root.name), collectionRecordCount(root, { includeDescendants: true }))
					: scopeLabelWithoutCount(optionalString(root.name)),
				depth: 0,
				is_root: true,
				item_count: includeCounts ? collectionRecordCount(root, { includeDescendants: true }) : null,
			}];
		for (let node of reviewer._projectCollectionNodes(root) || []) {
			if (!node?.collection || node.isRoot) {
				continue;
			}
			let collection = node.collection;
			if (filterFolder?.key && collection.key == filterFolder.key) {
				continue;
			}
			if (isHiddenWorkflowScopeCollection(reviewer, layout, collection, purpose)) {
				continue;
			}
			let name = optionalString(collection.name);
			let scopeKind = "collection";
			if (filterFolder?.key && node.parentKey == filterFolder.key) {
				scopeKind = "filter";
			}
			else if (node.parentKey == root.key) {
				scopeKind = "review";
			}
			let prefix = scopeKind == "filter"
				? "Filter - "
				: node.level > 1
					? `${"- ".repeat(Math.max(0, node.level - 1))}`
					: "";
			let count = includeCounts ? collectionRecordCount(collection, { includeDescendants: true }) : null;
			entries.push({
				scope_kind: scopeKind,
				collection_key: String(collection.key || ""),
				collection_name: name,
				label: includeCounts
					? scopeLabel(name, count, prefix)
					: scopeLabelWithoutCount(name, prefix),
				depth: node.level,
				is_root: false,
				item_count: count,
			});
		}
		return entries;
	}

	function lightweightScopes(reviewer, current, payload = {}) {
		return buildScopeEntries(reviewer, current, payload || {}, {
			includeCounts: false,
		});
	}

	async function hydrateScopes(reviewer, current, payload = {}) {
		let root = current?.collection || null;
		let baseScopes = Array.isArray(payload?.scopes) && payload.scopes.length
			? payload.scopes
			: lightweightScopes(reviewer, current, payload || {});
		return baseScopes.map((entry) => {
			let collection = !entry?.collection_key
				? root
				: reviewer?._collectionByKey?.(current?.context?.libraryID || 0, entry.collection_key) || null;
			let prefix = "";
			if (String(entry?.scope_kind || "") == "filter") {
				prefix = "Filter - ";
			}
			else if (Number(entry?.depth || 0) > 1) {
				prefix = `${"- ".repeat(Math.max(0, Number(entry.depth || 0) - 1))}`;
			}
			let count = collection ? collectionRecordCount(collection, { includeDescendants: true }) : 0;
			return Object.assign({}, entry, {
				item_count: count,
				label: scopeLabel(optionalString(entry?.collection_name || root?.name || ""), count, prefix),
			});
		});
	}

	async function refreshState(reviewer, current, payload = {}) {
		let includeStored = payload?.include_stored !== false;
		let includeAvailableScopes = payload?.include_available_scopes !== false;
		return {
			ok: true,
			sources: await listSources(reviewer, current, payload),
			stored: includeStored ? await listStored(reviewer, current) : [],
			scope: scopeDescriptor(reviewer, current, payload),
			available_scopes: includeAvailableScopes ? availableScopes(reviewer, current, payload) : [],
		};
	}

	function availableScopes(reviewer, current, payload = {}) {
		return buildScopeEntries(reviewer, current, payload || {}, {
			includeCounts: true,
		});
	}

	function resolveSelectedSource(sourceList, payload = {}) {
		let requested =
			payload.source_key ||
			payload.sourceKey ||
			payload.source ||
			payload.text_source ||
			payload.textSource ||
			payload.vector_column ||
			payload.vectorColumn ||
			"";
		let requestedKey = normalizeKey(requested || sourceKeyFromVectorKind(requested));
		let match = sourceList.find((entry) => entry.key == requestedKey || entry.vector_column == requested);
		if (requestedKey || requested) {
			return match || null;
		}
		return sourceList[0] || null;
	}

	async function currentEmbeddingsModel(reviewer) {
		let config = await reviewer._conversionConfig();
		let role = config?.runtimeRoles?.embeddings || {};
		let runtimeType = String(role?.runtime_type || "").trim();
		let model = String(role?.model || "").trim();
		if (!model) {
			return "";
		}
		if (runtimeType == "local_exec") {
			let executor = reviewer._localExecExecutor ? reviewer._localExecExecutor(role) : null;
			return executor?.installed && executor?.binary_path ? model : "";
		}
		if (!["local_api", "external_api"].includes(runtimeType)) {
			return "";
		}
		let connection = reviewer._findConnectionByID
			? reviewer._findConnectionByID(config?.apiConnections || [], role?.connection_id || "")
			: null;
		if (String(connection?.base_url || "").trim()) {
			return model;
		}
		return String(config?.embeddingsClient?.baseUrl || "").trim() ? model : "";
	}

	async function resolveEmbeddingsClient(reviewer) {
		let config = await reviewer._conversionConfig();
		reviewer._assertRoleExecutionReady("embeddings", config, "Embeddings");
		let prepared = await reviewer._prepareRoleAPIClient("embeddings", config.embeddingsClient, config);
		let normalized = reviewer._assertConfiguredAIEndpoint("embeddings", prepared?.client || config.embeddingsClient);
		let client = {
			baseUrl: normalized.base_url,
			model: normalized.model,
			apiKind: normalized.api_kind || "auto",
			apiKey: normalized.api_key || "",
			timeoutMs: normalized.timeout_ms || 120000,
		};
		let logicalModel = String(config?.runtimeRoles?.embeddings?.model || client.model || "").trim();
		return {
			config,
			client,
			logicalModel,
			defaultBatchSize: normalizeBatchSize(config?.runtimeRoles?.embeddings?.embeddings_batch_size || DEFAULT_BATCH_SIZE),
			release: prepared.release || (async () => {}),
		};
	}

	async function embedTexts(reviewer, client, texts = []) {
		if (!Array.isArray(texts) || !texts.length) {
			return [];
		}
		let url = embeddingsEndpoint(client.baseUrl);
		if (!url) {
			throw new Error("Embeddings endpoint is not configured.");
		}
		let json = await postJSON(
			url,
			{
				input: texts,
				model: client.model,
			},
			Math.max(120000, Number(client.timeoutMs || 0) || 0),
			authorizationHeaders(reviewer, client.apiKey || "")
		);
		let data = Array.isArray(json?.data) ? json.data : [];
		let vectors = data
			.map((entry) => Array.isArray(entry?.embedding) ? entry.embedding.map((value) => Number(value || 0)) : null)
			.filter((entry) => Array.isArray(entry));
		if (vectors.length != texts.length) {
			throw new Error(`Embeddings API returned ${vectors.length} vectors for ${texts.length} inputs.`);
		}
		return vectors;
	}

	async function loadEmbeddingRows(reviewer, current, vectorKind, payload = {}) {
		let context = currentContext(current);
		await checkpointProjectDB(reviewer, context);
		let rows = (await projectItemRows(reviewer, current, payload))
			.sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")) || String(left.item_key || "").localeCompare(String(right.item_key || "")));
		let modelRows = await executeRows(
			reviewer,
			context,
			`SELECT item_key, COALESCE(model, '') AS existing_model
			 FROM item_vectors
			 WHERE vector_kind=?`,
			[vectorKind]
		);
		let existingByKey = new Map(modelRows.map((entry) => [
			String(rowValue(entry, "item_key") || ""),
			String(rowValue(entry, "existing_model") || ""),
		]));
		return rows.map((row) => Object.assign({}, row, {
			existing_model: existingByKey.get(String(row.item_key || "")) || "",
		}));
	}

	function markdownHeadingBlock(title = "", lines = []) {
		return [
			`#### ${String(title || "Entry").trim()}`,
			"",
			...(Array.isArray(lines) ? lines : []).map((line) => String(line || "")),
		].join("\n").trim();
	}

	async function recordEmbeddingsRunArtifact(reviewer, current, result = {}) {
		if (!current?.context) {
			return null;
		}
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
			category: "embeddings",
			kind: "embeddings-run",
			extension: "md",
			content: markdownHeadingBlock(
				`${new Date().toISOString()} Embeddings Run`,
				[
					`- Source: ${String(result?.source_label || result?.source_key || "title_abstract").trim()}`,
					`- Model: ${String(result?.model || "").trim() || "(not recorded)"}`,
					`- Scope: ${String(result?.scope?.label || result?.scope?.collection_name || result?.scope?.collection_key || "").trim() || "(project scope)"}`,
					`- Total candidate items: ${Number(result?.total_items || 0) || 0}`,
					`- Embedded: ${Number(result?.embedded || 0) || 0}`,
					`- Skipped existing: ${Number(result?.skipped_existing || 0) || 0}`,
					`- Skipped empty: ${Number(result?.skipped_empty || 0) || 0}`,
				]
			),
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "embeddings",
			headingPath: ["Methods", "Evidence Search"],
			marker: "embedding-runs",
			emptyLabel: "No embeddings activity has been logged yet.",
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "embeddings",
			headingPath: ["Appendices", "Embedding Runs"],
			marker: "embedding-runs-appendix",
			emptyLabel: "No embeddings runs have been logged yet.",
		});
		return artifact;
	}

	async function queueEmbeddings({ reviewer, current, payload = {}, options = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let scope = scopeDescriptor(reviewer, current, payload);
		let optionState = await listSourceOptions(reviewer, current, payload || {});
		let source = resolveSelectedSource(optionState.sources || [], payload || {});
		if (!source?.key) {
			throw new Error("No embedding source is available for this collection.");
		}
		let clientState = await resolveEmbeddingsClient(reviewer);
		try {
			let batchSize = normalizeBatchSize(clientState.defaultBatchSize || DEFAULT_BATCH_SIZE);
			let resume = payload.resume !== false;
			let queuePayload = Object.assign({}, payload || {}, {
				source_key: source.key,
				resume,
			});
			if (scope?.scope) {
				queuePayload.scope = scope.scope;
			}
			if (scope?.collection_key) {
				queuePayload.collection_key = scope.collection_key;
			}
			if (scope?.collection_name) {
				queuePayload.collection_name = scope.collection_name;
			}
			let job = await reviewer._queueWorkflowJob(current, {
				prefix: "embed",
				kind: "manual_embeddings",
				title: `Create embeddings: ${source.label}`,
				requested_mode: source.key,
				used_mode: clientState.logicalModel || source.key,
				source_title: `${current.collection?.name || "Collection"} / ${source.label}`,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: queuePayload,
					source_key: source.key,
					source_label: source.label,
					vector_column: source.vector_column,
					model: clientState.logicalModel,
					batch_size: batchSize,
					resume,
					scope,
					queue_origin: String(options.queue_origin || "").trim(),
				},
				startDelayMs: EMBEDDINGS_JOB_START_DELAY_MS,
				targetWin: options.targetWin || null,
				openJobsTab: options.openJobsTab === true,
				refreshControllers: options.refreshControllers !== false,
			});
			return {
				ok: true,
				queued: true,
				job_id: job.job_id,
				job_kind: "manual_embeddings",
				job,
				source_key: source.key,
				source_label: source.label,
				vector_column: source.vector_column,
				model: clientState.logicalModel,
				batch_size: batchSize,
				resume,
				scope,
				message: "Job started. Track progress in Jobs.",
			};
		}
		finally {
			await clientState.release?.();
		}
	}

	async function runEmbeddings({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let state = {
			scope: scopeDescriptor(reviewer, current, payload),
			sources: (await listSourceOptions(reviewer, current, payload || {})).sources || [],
		};
		let source = resolveSelectedSource(state.sources || [], payload || {});
		if (!source?.key) {
			throw new Error("No embedding source is available for this collection.");
		}
		let existingJobID = optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
		let resume = payload.resume !== false;
		if (!existingJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "embed",
				kind: "manual_embeddings",
				title: `Create embeddings: ${source.label}`,
				requested_mode: source.key,
				used_mode: source.key,
				source_title: `${current.collection?.name || "Collection"} / ${source.label}`,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}, { source_key: source.key, resume }),
					source_key: source.key,
					source_label: source.label,
					vector_column: source.vector_column,
					scope: state.scope,
					resume,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Embeddings job started. Track progress in Jobs.",
			});
		}
		let job = { job_id: existingJobID };
		let clientState = await resolveEmbeddingsClient(reviewer);
		try {
			let batchSize = normalizeBatchSize(clientState.defaultBatchSize || DEFAULT_BATCH_SIZE);
			let normalize = true;
			let vectorKind = source.vector_column;
			let logicalModel = clientState.logicalModel;
			if (source.key == "full_text") {
				return await SystematicReviewerWorkflowRAG.runEmbeddings({
					reviewer,
					current,
					payload,
					source,
					clientState,
					state,
				});
			}
			try {
				let refs = await scopedItemRefs(reviewer, current, payload, {
					batchSize,
				});
				let totalRows = refs.length;
				let skippedExisting = 0;
				let skippedEmpty = 0;
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					job.job_id,
					"info",
					`Scanning ${totalRows} scoped items for ${source.label} using ${logicalModel || clientState.client.model}.`
				);

				let embedded = 0;
				let processed = 0;
				for (let refBatch of chunkArray(refs, batchSize)) {
					await reviewer._throwIfJobCanceled?.(current, job.job_id);
					let itemKeys = refBatch.map((entry) => entry.item_key);
					let existingByKey = resume
						? await existingModelsByItemKey(reviewer, context, vectorKind, itemKeys)
						: new Map();
					let textsByKey = await sourceTextsByItemKey(reviewer, current, source, refBatch);
					let candidates = [];
					for (let ref of refBatch) {
						let itemKey = String(ref.item_key || "");
						let text = optionalString(textsByKey.get(itemKey));
						if (!text) {
							skippedEmpty += 1;
							continue;
						}
						if (resume && logicalModel && existingByKey.get(itemKey) == logicalModel) {
							skippedExisting += 1;
							continue;
						}
						candidates.push({
							item_key: itemKey,
							text,
						});
					}
					for (let candidateBatch of chunkArray(candidates, batchSize)) {
						await reviewer._throwIfJobCanceled?.(current, job.job_id);
						let vectors = await embedTexts(
							reviewer,
							clientState.client,
							candidateBatch.map((entry) => entry.text)
						);
						let writeEntries = [];
						for (let index = 0; index < candidateBatch.length; index += 1) {
							let vector = normalizeVector(vectors[index] || [], normalize);
							if (!vector.length) {
								continue;
							}
							writeEntries.push({
								item_key: candidateBatch[index].item_key,
								text: candidateBatch[index].text,
								vector,
							});
						}
						if (writeEntries.length) {
							await writeEmbeddedItemSlices(
								reviewer,
								context,
								source.key,
								vectorKind,
								logicalModel,
								writeEntries,
								{ batchSize }
							);
							embedded += writeEntries.length;
						}
					}
					processed += refBatch.length;
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						processed,
						totalRows,
						`Embedded ${embedded} after scanning ${processed} / ${totalRows}`
					);
				}
				await checkpointProjectDB(reviewer, context);

				let stored = await listStored(reviewer, context);
				let storage = await storageSummary(reviewer, context, vectorKind, logicalModel);
				let matchingStatus = stored.find((entry) => entry.vector_column == vectorKind && entry.model == logicalModel) || null;
				let result = {
					ok: true,
					job_id: job.job_id,
					source_key: source.key,
					source_label: source.label,
					vector_column: vectorKind,
					model: logicalModel,
					total_items: totalRows,
					embedded,
					skipped_existing: skippedExisting,
					skipped_empty: skippedEmpty,
					batch_size: batchSize,
					resume,
					normalize,
					stored_status: matchingStatus,
					storage,
					scope: state.scope,
				};
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
					used_mode: logicalModel || source.key,
					output_path: context.databasePath,
					progress_current: embedded,
					progress_total: totalRows,
					metadata: result,
					message: `Stored ${embedded} embeddings for ${source.label}.`,
				});
				if (existingJobID) {
					await recordEmbeddingsRunArtifact(reviewer, current, result).catch((error) => {
						reviewer?.log?.(`embeddings artifact write skipped: ${error}`);
					});
				}
				return result;
			}
			catch (error) {
				if (job?.job_id) {
					await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
				}
				throw error;
			}
		}
		finally {
			await clientState.release?.();
		}
	}

	return {
		listSources,
		listSourceOptions,
		hydrateSourceOptions,
		listStored,
		listStoredOptions,
		refreshState,
		availableScopes,
		lightweightScopes,
		hydrateScopes,
		defaultScopeEntry,
		queueEmbeddings,
		runEmbeddings,
		currentEmbeddingsModel,
		resolveEmbeddingsClient,
		storageSummary,
		checkpointProjectDB,
		executeRows,
		executeWrite,
		rowValue,
		vectorKindForSource,
		sourceKeyFromVectorKind,
		sourceLabel,
		sourceTextFields,
		scopeSpecFromPayload,
		scopeDescriptor,
		vectorToBlob,
			vectorBlobLiteral,
			blobToVector,
			normalizeVector,
			normalizeBatchSize,
			SCOPE_ITEM_REF_BATCH_SIZE,
			FULL_TEXT_DOCUMENT_BATCH_SIZE,
			FULL_TEXT_CHUNK_WRITE_BATCH_SIZE,
		scopedItemRefs,
		projectItemRows,
		recordText,
		embedTexts,
	};
})();
