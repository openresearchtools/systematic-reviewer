var SystematicReviewerWorkflowScreening = (() => {
	const DEFAULT_LIMIT = 50;
	const DEFAULT_LOG_LIMIT = 40;
	const BATCH_WRITE_SIZE = 1000;
	const EXPORT_SCAN_BATCH_SIZE = 25;
	const CSV_UTF8_BOM = "\uFEFF";
	const CSV_ROW_SEPARATOR = "\r\n";
	const FILTER_FOLDER_NAME = "Filters";
	const VALUE_TEMPLATE_FILE_NAME = "screening-value-templates.json";
	const VALID_OPERATORS = new Set([
		"contains",
		"not_contains",
		"equals",
		"not_equals",
		"gt",
		"gte",
		"lt",
		"lte",
		"empty",
		"not_empty",
	]);
	const REVIEW_COLLECTIONS = Object.freeze({
		pending: { key: "pending", label: "Pending", decision: "" },
		included: { key: "included", label: "Included", decision: "include" },
		excluded: { key: "excluded", label: "Excluded", decision: "exclude" },
		excluded_ft: { key: "excluded_ft", label: "Excluded FT", decision: "exclude" },
		maybe: { key: "maybe", label: "Maybe", decision: "maybe" },
	});
	const REVIEW_COLLECTION_ORDER = Object.freeze([
		REVIEW_COLLECTIONS.excluded_ft,
		REVIEW_COLLECTIONS.included,
		REVIEW_COLLECTIONS.excluded,
		REVIEW_COLLECTIONS.maybe,
		REVIEW_COLLECTIONS.pending,
	]);
	const BASE_FIELD_KEYS = Object.freeze([
		["citation_text", "Citation"],
		["title", "Title"],
		["abstract_note", "Abstract"],
		["doi", "DOI"],
		["year", "Year"],
		["reason", "Reason"],
		["notes", "Notes"],
	]);
	const EXTRACTION_VALUE_PREFIX = "extraction:";
	const EXTRACTION_METADATA_PREFIX = "extraction_meta:";
	const EXTRACTION_METADATA_DEFINITIONS = Object.freeze([
		{ key: "template_name", label: "Template", type: "text" },
		{ key: "template_path", label: "Template path", type: "text" },
		{ key: "source_key", label: "Source", type: "text" },
		{ key: "status", label: "Status", type: "text" },
		{ key: "error_message", label: "Error", type: "text" },
		{ key: "model", label: "Model", type: "text" },
		{ key: "run_id", label: "Run ID", type: "text" },
		{ key: "created_at", label: "Created", type: "text" },
		{ key: "updated_at", label: "Updated", type: "text" },
	]);
	const TABLE_FROM_DATABASE_CITATION_COLUMN_KEY = "citation_markdown";

	function optionalString(value) {
		return String(value || "").trim();
	}

	function existingJobID(payload = {}) {
		return optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
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

	function normalizeNewlines(value) {
		return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	}

	function stripInvisibleTextControls(input) {
		return [...String(input || "")]
			.filter((ch) => {
				if (ch === "\n" || ch === "\t") {
					return true;
				}
				let code = ch.codePointAt(0) || 0;
				if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
					return false;
				}
				return !["\uFEFF", "\u200B", "\u200C", "\u200D", "\u2060"].includes(ch);
			})
			.join("");
	}

	function mojibakeScore(input) {
		let text = String(input || "");
		let score = 0;
		for (let ch of text) {
			if (ch == "\uFFFD") {
				score += 5;
				continue;
			}
			if ("ÃÂâ".includes(ch)) {
				score += 2;
			}
		}
		if (/Ã.|Â.|â./.test(text)) {
			score += 6;
		}
		return score;
	}

	function attemptUTF8Repair(input) {
		let source = String(input || "");
		if (!/[ÃÂâ]/.test(source) || typeof TextDecoder != "function") {
			return source;
		}
		try {
			let bytes = Uint8Array.from(Array.from(source, (ch) => {
				let code = ch.codePointAt(0) || 63;
				return code <= 255 ? code : 63;
			}));
			let decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
			return mojibakeScore(decoded) < mojibakeScore(source) ? decoded : source;
		}
		catch (_error) {
			return source;
		}
	}

	function repairCommonMojibake(input) {
		let replacements = [
			["Ã¯Â»Â¿", ""],
			["Ã¢â‚¬â„¢", "\u2019"],
			["Ã¢â‚¬Ëœ", "\u2018"],
			["Ã¢â‚¬Å“", "\u201C"],
			["Ã¢â‚¬\u009d", "\u201D"],
			["Ã¢â‚¬â€œ", "\u2013"],
			["Ã¢â‚¬â€\u009d", "\u2014"],
			["Ã¢â‚¬Â¦", "\u2026"],
			["Ã¢â‚¬Â¢", "\u2022"],
			["Ã‚ ", " "],
			["Ã‚", ""],
			["â€™", "\u2019"],
			["â€˜", "\u2018"],
			["â€œ", "\u201C"],
			["â€\u009d", "\u201D"],
			["â€“", "\u2013"],
			["â€”", "\u2014"],
			["â€¦", "\u2026"],
			["â€¢", "\u2022"],
			["Â±", "\u00B1"],
			["Â·", "\u00B7"],
			["âˆ’", "\u2212"],
			["â‰¤", "\u2264"],
			["â‰¥", "\u2265"],
			["â‰ˆ", "\u2248"],
			["âˆš", "\u221A"],
			["â†’", "\u2192"],
			["â‡’", "\u21D2"],
		];
		let text = String(input || "");
		for (let [bad, good] of replacements) {
			text = text.replaceAll(bad, good);
		}
		return text;
	}

	function sanitizeUTF8Text(value, { trim = true } = {}) {
		let text = normalizeNewlines(value);
		text = stripInvisibleTextControls(text).replaceAll("\u00A0", " ");
		text = attemptUTF8Repair(text);
		text = repairCommonMojibake(text);
		text = stripInvisibleTextControls(text);
		text = text
			.split("\n")
			.map((line) => line.replace(/[ \t]+$/g, ""))
			.join("\n");
		return trim ? text.trim() : text;
	}

	function cleanText(value) {
		return optionalString(sanitizeUTF8Text(value, { trim: true }));
	}

	function cleanBlockText(value) {
		return sanitizeUTF8Text(value, { trim: true });
	}

	function currentContext(currentOrContext) {
		return currentOrContext?.context || currentOrContext;
	}

	function normalizeDecision(value) {
		let raw = String(value || "").trim().toLowerCase();
		if (!raw || raw == "unreviewed" || raw == "pending") {
			return "";
		}
		if (raw == "include" || raw == "included") {
			return "include";
		}
		if (raw == "exclude" || raw == "excluded") {
			return "exclude";
		}
		if (raw == "maybe") {
			return "maybe";
		}
		throw new Error("Decision must be include, exclude, maybe, or unreviewed.");
	}

	function normalizeDecisionFilter(value) {
		let raw = String(value || "").trim().toLowerCase();
		if (!raw) {
			return null;
		}
		if (raw == "unreviewed" || raw == "pending") {
			return "";
		}
		return normalizeDecision(raw);
	}

	function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = 1000) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return fallback;
		}
		return Math.max(1, Math.min(max, Math.round(parsed)));
	}

	function normalizeOffset(value) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return 0;
		}
		return Math.max(0, Math.round(parsed));
	}

	function normalizePage(value) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return 1;
		}
		return Math.max(1, Math.round(parsed));
	}

	function normalizeOperator(value) {
		let raw = optionalString(value || "contains").toLowerCase();
		if (!VALID_OPERATORS.has(raw)) {
			throw new Error("Rule operator must be contains, not_contains, equals, not_equals, gt, gte, lt, lte, empty, or not_empty.");
		}
		return raw;
	}

	function normalizeColumnKey(value) {
		let key = optionalString(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
		if (!key) {
			throw new Error("Column key is required.");
		}
		if (BASE_FIELD_KEYS.some(([fieldKey]) => fieldKey == key)) {
			throw new Error("That key is reserved by a built-in screening field.");
		}
		return key;
	}

	function normalizeColumnType(value) {
		let type = optionalString(value || "text").toLowerCase() || "text";
		if (!["text", "number", "boolean"].includes(type)) {
			throw new Error("Column type must be text, number, or boolean.");
		}
		return type;
	}

	function normalizeDecisionSourceType(value, fallback = "manual") {
		let raw = optionalString(value || fallback).toLowerCase() || fallback;
		if (!["manual", "automated", "agent"].includes(raw)) {
			return fallback;
		}
		return raw;
	}

	function normalizeActionKind(value, fallback = "move") {
		let raw = optionalString(value || fallback).toLowerCase() || fallback;
		if (["filter", "filter_copy", "create_filter"].includes(raw)) {
			return "filter_copy";
		}
		return "move";
	}

	function normalizeRowDisplayMode(value, fallback = "expanded") {
		let raw = optionalString(value || fallback).toLowerCase() || fallback;
		if (raw != "expanded" && raw != "collapsed") {
			return fallback;
		}
		return raw;
	}

	function normalizeGridZoomPercent(value, fallback = 100) {
		let parsed = Number(value || 0);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			parsed = fallback;
		}
		let rounded = Math.round(parsed / 5) * 5;
		return Math.max(70, Math.min(150, rounded || fallback));
	}

	function normalizeMatchMode(value, fallback = "and") {
		let raw = optionalString(value || fallback).toLowerCase() || fallback;
		return raw == "or" ? "or" : "and";
	}

	function normalizeOrder(value, fallback = "asc") {
		let raw = optionalString(value || fallback).toLowerCase() || fallback;
		return raw == "desc" ? "desc" : "asc";
	}

	function normalizeSortKey(value, fallback = "item_key") {
		let key = optionalString(value || fallback) || fallback;
		if (key == "itemkey" || key == "item-key" || key == "zotero_key" || key == "zotero-item-key" || key == "zotero_item_key") {
			return "item_key";
		}
		return key;
	}

	function extractNumericValue(value) {
		if (typeof value == "number" && Number.isFinite(value)) {
			return value;
		}
		let text = optionalString(value).replace(/\u2212/g, "-");
		if (!text) {
			return null;
		}
		text = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
		let match = text.match(/[+-]?(?:\d+\.\d+|\d+\.?|\.\d+|\d+)/);
		if (!match?.[0]) {
			return null;
		}
		let raw = Number(match[0]);
		return Number.isFinite(raw) ? raw : null;
	}

	function asNumber(value) {
		return extractNumericValue(value);
	}

	function chunkArray(items = [], size = BATCH_WRITE_SIZE) {
		let out = [];
		for (let index = 0; index < items.length; index += size) {
			out.push(items.slice(index, index + size));
		}
		return out;
	}

	function uniqueItemKeys(entries = []) {
		let out = [];
		let seen = new Set();
		for (let entry of entries || []) {
			let itemKey = typeof entry == "string"
				? optionalString(entry)
				: optionalString(entry?.item_key);
			if (!itemKey || seen.has(itemKey)) {
				continue;
			}
			seen.add(itemKey);
			out.push(itemKey);
		}
		return out;
	}

	function previewText(text) {
		let value = cleanText(text).replace(/\s+/g, " ");
		if (!value) {
			return "";
		}
		return value.length > 280 ? `${value.slice(0, 277)}...` : value;
	}

	function nowStamp() {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	function sanitizeSlug(reviewer, value, fallback = "screening-search") {
		let base = String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return reviewer._sanitizeFileName(base || fallback);
	}

	function outputRoot(reviewer, context) {
		return reviewer._joinPath(context.outputsDir, "screening");
	}

	function csvEscape(value) {
		let text = normalizeNewlines(String(value ?? ""));
		return /[",\n\r]/.test(text)
			? `"${text.replace(/"/g, "\"\"")}"`
			: text;
	}

	async function appendTextFile(reviewer, path, text = "") {
		let content = String(text || "");
		if (!content) {
			return;
		}
		let parent = reviewer._parentPath(path);
		if (parent) {
			await reviewer._ensureDirectory(parent);
		}
		let file = reviewer._nsIFile(path);
		let fos = Components.classes["@mozilla.org/network/file-output-stream;1"]
			.createInstance(Components.interfaces.nsIFileOutputStream);
		fos.init(file, 0x02 | 0x08 | 0x10, 0o664, 0);
		let stream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
			.createInstance(Components.interfaces.nsIConverterOutputStream);
		stream.init(fos, "UTF-8", 4096, "?".charCodeAt(0));
		stream.writeString(content);
		stream.close();
	}

	async function openTextAppender(reviewer, path) {
		let parent = reviewer._parentPath(path);
		if (parent) {
			await reviewer._ensureDirectory(parent);
		}
		let file = reviewer._nsIFile(path);
		let fos = Components.classes["@mozilla.org/network/file-output-stream;1"]
			.createInstance(Components.interfaces.nsIFileOutputStream);
		fos.init(file, 0x02 | 0x08 | 0x10, 0o664, 0);
		let stream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
			.createInstance(Components.interfaces.nsIConverterOutputStream);
		stream.init(fos, "UTF-8", 4096, "?".charCodeAt(0));
		return {
			write(text = "") {
				let content = String(text || "");
				if (!content) {
					return;
				}
				stream.writeString(content);
			},
			close() {
				try {
					stream.close();
				}
				catch (_error) {}
			},
		};
	}

	function reportDirectoryPath(reviewer, context) {
		return optionalString(reviewer?._parentPath?.(optionalString(context?.reportPath || "")))
			|| optionalString(context?.projectRoot || "");
	}

	function ensureCSVExtension(path = "") {
		let next = optionalString(path);
		if (!next) {
			return "";
		}
		return /\.csv$/i.test(next) ? next : `${next}.csv`;
	}

	async function uniqueFilePath(reviewer, path = "") {
		let nextPath = ensureCSVExtension(path);
		if (!nextPath) {
			return "";
		}
		if (!(await reviewer._pathExists(nextPath))) {
			return nextPath;
		}
		let parent = reviewer._parentPath(nextPath);
		let baseName = reviewer._basename(nextPath);
		let match = String(baseName || "").match(/^(.*?)(\.[^.]+)?$/);
		let stem = optionalString(match?.[1] || "");
		let ext = optionalString(match?.[2] || "") || ".csv";
		let counter = 2;
		let candidate = nextPath;
		while (await reviewer._pathExists(candidate)) {
			candidate = reviewer._joinPath(parent, `${stem}-${counter}${ext}`);
			counter += 1;
		}
		return candidate;
	}

	function defaultExportCSVFileName(reviewer, current) {
		let base = sanitizeSlug(
			reviewer,
			current?.context?.collectionName || current?.collection?.name || "screening-export",
			"screening-export"
		);
		return `${base}-${nowStamp()}.csv`;
	}

	async function defaultExportCSVPath(reviewer, current) {
		let context = current?.context || null;
		if (!context) {
			return "";
		}
		let root = reportDirectoryPath(reviewer, context);
		if (!root) {
			throw new Error("Current project directory could not be resolved.");
		}
		return await uniqueFilePath(
			reviewer,
			reviewer._joinPath(root, defaultExportCSVFileName(reviewer, current))
		);
	}

	async function forEachScopedItemKeyBatch(reviewer, current, payload = {}, options = {}) {
		let batchSize = Math.max(1, Number(options.batchSize || EXPORT_SCAN_BATCH_SIZE) || EXPORT_SCAN_BATCH_SIZE);
		let onBatch = typeof options.onBatch == "function" ? options.onBatch : null;
		let scope = scopeDescriptor(reviewer, current, payload)
			|| (typeof reviewer?._projectScopeDescriptor == "function"
				? reviewer._projectScopeDescriptor(current?.collection || null, resolvedScopeSpec(reviewer, current, payload))
				: null);
		let buffer = [];
		let total = 0;
		let flush = async () => {
			if (!buffer.length || !onBatch) {
				buffer = [];
				return;
			}
			let batch = buffer.slice();
			buffer = [];
			await onBatch(batch, {
				scope,
				total,
			});
		};
		if (typeof reviewer?._eachProjectCitableItem == "function" && current?.collection) {
			await reviewer._eachProjectCitableItem(
				current.collection,
				current.projectItem || null,
				resolvedScopeSpec(reviewer, current, payload),
				async (_item, info = {}) => {
					let itemKey = optionalString(info?.itemKey);
					if (!itemKey) {
						return true;
					}
					buffer.push(itemKey);
					total += 1;
					if (buffer.length >= batchSize) {
						await flush();
					}
					return true;
				},
				{
					batchSize,
					dedupe: true,
				}
			);
			await flush();
			return {
				scope,
				total,
			};
		}
		let nodes = Array.isArray(scope?.nodes) ? scope.nodes : [];
		let seen = new Set();
		for (let node of nodes) {
			let directItems = node?.collection?.getChildItems ? node.collection.getChildItems(false, false) : [];
			for (let item of directItems || []) {
				if (!item || item.deleted || !item.key) {
					continue;
				}
				if ((current?.projectItem && item.id == current.projectItem.id) || reviewer?._itemBelongsToProjectShell?.(item)) {
					continue;
				}
				if (item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				let itemKey = optionalString(item.key);
				if (!itemKey || seen.has(itemKey)) {
					continue;
				}
				seen.add(itemKey);
				buffer.push(itemKey);
				total += 1;
				if (buffer.length >= batchSize) {
					await flush();
					await Zotero.Promise.delay(0);
				}
			}
		}
		await flush();
		return {
			scope,
			total,
		};
	}

	function serializeFileEntry(file) {
		return {
			name: file.leafName,
			path: file.path,
			mtime: file.lastModifiedTime || 0,
			size: file.fileSize || 0,
		};
	}

	function listFiles(reviewer, path, predicate = null) {
		let root = reviewer._nsIFile(path);
		if (!root.exists() || !root.isDirectory()) {
			return [];
		}
		let out = [];
		let entries = root.directoryEntries;
		while (entries.hasMoreElements()) {
			let file = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!predicate || predicate(file)) {
				out.push(file);
			}
		}
		return out;
	}

	function randomSuffix() {
		return Math.random().toString(36).slice(2, 8);
	}

	function ruleID() {
		return `screen-rule-${Date.now().toString(36)}-${randomSuffix()}`;
	}

	function filterID() {
		return `screen-filter-${Date.now().toString(36)}-${randomSuffix()}`;
	}

	function normalizeActionRule(rule = {}, fallbackColumnKey = "") {
		let columnKey = optionalString(rule.column_key || rule.columnKey || fallbackColumnKey);
		if (!columnKey) {
			throw new Error("Rule field is required.");
		}
		let operator = normalizeOperator(rule.operator || "contains");
		let matchValue = cleanBlockText(rule.match_value ?? rule.matchValue ?? "");
		if (!matchValue && !["empty", "not_empty"].includes(operator)) {
			throw new Error(`Rule match value is required for ${columnKey}.`);
		}
		return {
			column_key: columnKey,
			operator,
			match_value: matchValue,
		};
	}

	function parseStoredActionRules(value = "", fallbackRule = null) {
		let parsed = [];
		try {
			let raw = JSON.parse(String(value || "[]"));
			if (Array.isArray(raw)) {
				parsed = raw;
			}
		}
		catch (_error) {
			parsed = [];
		}
		let cleaned = [];
		for (let entry of parsed) {
			try {
				cleaned.push(normalizeActionRule(entry));
			}
			catch (_error) {}
		}
		if (!cleaned.length && fallbackRule?.column_key) {
			try {
				cleaned.push(normalizeActionRule(fallbackRule));
			}
			catch (_error) {}
		}
		return cleaned;
	}

	function normalizeActionRules(payload = {}, fallbackColumnKey = "") {
		let rawRules = Array.isArray(payload.rules) ? payload.rules : [];
		if (!rawRules.length) {
			let legacyColumnKey = optionalString(payload.column_key || payload.columnKey || fallbackColumnKey);
			if (legacyColumnKey) {
				rawRules = [{
					column_key: legacyColumnKey,
					operator: payload.operator || "contains",
					match_value: payload.match_value ?? payload.matchValue ?? "",
				}];
			}
		}
		return rawRules.map((entry) => normalizeActionRule(entry));
	}

	function serializeActionRules(rules = []) {
		let cleaned = [];
		for (let entry of rules || []) {
			try {
				cleaned.push(normalizeActionRule(entry));
			}
			catch (_error) {}
		}
		return JSON.stringify(cleaned);
	}

	function matchesRuleSet(record, rules = [], matchMode = "and") {
		if (!Array.isArray(rules) || !rules.length) {
			return true;
		}
		if (normalizeMatchMode(matchMode) == "or") {
			return rules.some((rule) => operatorMatches(recordValue(record, rule.column_key), rule.operator, rule.match_value));
		}
		return rules.every((rule) => operatorMatches(recordValue(record, rule.column_key), rule.operator, rule.match_value));
	}

	function describeRuleSet(rules = [], matchMode = "and") {
		let parts = [];
		for (let rule of rules || []) {
			let operator = optionalString(rule.operator);
			let needsValue = !["empty", "not_empty"].includes(operator);
			parts.push(
				needsValue
					? `${rule.column_key} ${operator} ${cleanText(rule.match_value)}`
					: `${rule.column_key} ${operator}`
			);
		}
		if (!parts.length) {
			return "whole current scope";
		}
		return parts.join(normalizeMatchMode(matchMode) == "or" ? " OR " : " AND ");
	}

	function reviewBucketForDecision(decision) {
		if (decision == "include") {
			return REVIEW_COLLECTIONS.included;
		}
		if (decision == "exclude") {
			return REVIEW_COLLECTIONS.excluded;
		}
		if (decision == "maybe") {
			return REVIEW_COLLECTIONS.maybe;
		}
		return REVIEW_COLLECTIONS.pending;
	}

	async function reviewCollections(reviewer, current, { createMissing = false, includeMaybe = false } = {}) {
		let root = current?.collection || null;
		if (!root) {
			throw new Error("Open a collection project first.");
		}
		let directChildren = new Map();
		for (let node of reviewer?._projectCollectionNodes?.(root) || []) {
			if (node?.collection?.key && node.parentKey == root.key) {
				directChildren.set(String(node.collection.name || "").trim().toLowerCase(), node.collection);
			}
		}
		let out = {
			root,
			pending: directChildren.get("pending") || null,
			included: directChildren.get("included") || null,
			excluded: directChildren.get("excluded") || null,
			excluded_ft: directChildren.get("excluded ft") || null,
			maybe: directChildren.get("maybe") || null,
		};
		if (!createMissing) {
			return out;
		}
		let required = [
			REVIEW_COLLECTIONS.pending,
			REVIEW_COLLECTIONS.included,
			REVIEW_COLLECTIONS.excluded,
			REVIEW_COLLECTIONS.excluded_ft,
		];
		if (includeMaybe) {
			required.push(REVIEW_COLLECTIONS.maybe);
		}
		for (let definition of required) {
			if (out[definition.key]) {
				continue;
			}
			let collection = new Zotero.Collection();
			collection.libraryID = root.libraryID;
			collection.name = definition.label;
			collection.parentID = root.id;
			await collection.saveTx();
			out[definition.key] = collection;
		}
		return out;
	}

	async function filterFolder(reviewer, current, { createMissing = false } = {}) {
		let root = current?.collection || null;
		if (!root) {
			throw new Error("Open a collection project first.");
		}
		let folder = null;
		for (let node of reviewer?._projectCollectionNodes?.(root) || []) {
			if (node?.parentKey == root.key && String(node?.collection?.name || "").trim().toLowerCase() == FILTER_FOLDER_NAME.toLowerCase()) {
				folder = node.collection;
				break;
			}
		}
		if (!folder && createMissing) {
			folder = new Zotero.Collection();
			folder.libraryID = root.libraryID;
			folder.name = FILTER_FOLDER_NAME;
			folder.parentID = root.id;
			await folder.saveTx();
		}
		return folder;
	}

	function itemReviewState(item, buckets) {
		let collectionIDs = new Set();
		try {
			for (let collectionID of item?.getCollections?.() || []) {
				collectionIDs.add(collectionID);
			}
		}
		catch (_error) {}
		for (let definition of REVIEW_COLLECTION_ORDER) {
			let collection = buckets?.[definition.key] || null;
			if (collection?.id && collectionIDs.has(collection.id)) {
				return {
					review_stage: definition.key,
					review_collection_key: String(collection.key || ""),
					review_collection_name: definition.label,
					decision: definition.decision,
				};
			}
		}
		return pendingReviewState();
	}

	async function moveItemToReviewBucket({ reviewer, current, itemKey, bucket }) {
		let item = requireRecordItem(current, itemKey);
		let buckets = await reviewCollections(reviewer, current, {
			createMissing: true,
			includeMaybe: bucket?.key == REVIEW_COLLECTIONS.maybe.key,
		});
		let existingCollectionIDs = [];
		try {
			existingCollectionIDs = item.getCollections?.() || [];
		}
		catch (_error) {
			existingCollectionIDs = [];
		}
		let reviewCollectionIDs = new Set(
			Object.values(REVIEW_COLLECTIONS)
				.map((definition) => buckets?.[definition.key]?.id || null)
				.filter(Boolean)
		);
		let nextCollectionIDs = existingCollectionIDs.filter((collectionID) => !reviewCollectionIDs.has(collectionID));
		let targetCollection = buckets?.[bucket?.key] || null;
		if (targetCollection?.id && !nextCollectionIDs.includes(targetCollection.id)) {
			nextCollectionIDs.push(targetCollection.id);
		}
		item.setCollections(Array.from(new Set(nextCollectionIDs)));
		await item.saveTx();
		return itemReviewState(item, buckets);
	}

	function isDecisionTargetCollection(reviewer, root, layout, collection) {
		if (!collection?.id || !root?.id) {
			return false;
		}
		if (collection.id == root.id) {
			return false;
		}
		if (!layout?.isWorkflowNode?.(collection)) {
			return false;
		}
		if (layout?.filters?.id && reviewer?._collectionHasAncestor?.(collection, layout.filters.id)) {
			return false;
		}
		return true;
	}

	async function resolveDecisionTargetCollection({ reviewer, current, collectionKey = "", collectionName = "" }) {
		let root = current?.collection || null;
		if (!root) {
			throw new Error("Open a collection project first.");
		}
		let nodes = reviewer?._projectCollectionNodes?.(root) || [];
		let layout = reviewer?._projectWorkflowTreeInfo?.(root, nodes) || null;
		let target = null;
		let requestedKey = optionalString(collectionKey);
		let requestedName = optionalString(collectionName).toLowerCase();
		if (requestedKey) {
			target = nodes.find((node) => String(node?.collection?.key || "") == requestedKey)?.collection || null;
		}
		else if (requestedName) {
			target = nodes.find((node) => String(node?.collection?.name || "").trim().toLowerCase() == requestedName)?.collection || null;
		}
		if (!target) {
			throw new Error("Target subcollection was not found inside the current project.");
		}
		if (!isDecisionTargetCollection(reviewer, root, layout, target)) {
			throw new Error("Only workflow subcollections can be used for screening move decisions.");
		}
		return target;
	}

	function decisionTargetLayout(reviewer, current) {
		let root = current?.collection || null;
		if (!root) {
			throw new Error("Open a collection project first.");
		}
		let nodes = reviewer?._projectCollectionNodes?.(root) || [];
		let layout = reviewer?._projectWorkflowTreeInfo?.(root, nodes) || null;
		let decisionTargets = (nodes || [])
			.map((node) => node?.collection || null)
			.filter((collection) => isDecisionTargetCollection(reviewer, root, layout, collection));
		return {
			root,
			nodes,
			layout,
			decisionTargets,
		};
	}

	async function removeItemsFromCollectionBatch({ current, itemKeys = [], targetCollection }) {
		let keys = uniqueItemKeys(itemKeys);
		if (!targetCollection?.id || !keys.length) {
			return {
				removed_count: 0,
			};
		}
		let itemIDs = [];
		for (let itemKey of keys) {
			let item = recordItem(current, itemKey);
			if (!item?.id) {
				continue;
			}
			let existingCollectionIDs = [];
			try {
				existingCollectionIDs = item.getCollections?.() || [];
			}
			catch (_error) {
				existingCollectionIDs = [];
			}
			if (!existingCollectionIDs.includes(targetCollection.id)) {
				continue;
			}
			itemIDs.push(item.id);
		}
		if (!itemIDs.length) {
			return {
				removed_count: 0,
			};
		}
		let removeItems = async () => {
			await Zotero.DB.executeTransaction(async () => {
				await targetCollection.removeItems(itemIDs);
			});
		};
		if (Zotero.SystematicReviewer?._withZoteroWriteLease) {
			await Zotero.SystematicReviewer._withZoteroWriteLease(current?.context || null, removeItems, {
				ownerKey: `screening-remove:${targetCollection.id}:${Math.random().toString(36).slice(2, 8)}`,
			});
		}
		else {
			await removeItems();
		}
		return {
			removed_count: itemIDs.length,
		};
	}

	async function copyItemsToCollectionBatch({ current, itemKeys = [], targetCollection }) {
		let keys = uniqueItemKeys(itemKeys);
		if (!targetCollection?.id || !keys.length) {
			return {
				added_count: 0,
				target_collection_key: String(targetCollection?.key || ""),
				target_collection_name: String(targetCollection?.name || ""),
			};
		}
		let itemIDs = [];
		for (let itemKey of keys) {
			let item = recordItem(current, itemKey);
			if (!item?.id) {
				continue;
			}
			let existingCollectionIDs = [];
			try {
				existingCollectionIDs = item.getCollections?.() || [];
			}
			catch (_error) {
				existingCollectionIDs = [];
			}
			if (existingCollectionIDs.includes(targetCollection.id)) {
				continue;
			}
			itemIDs.push(item.id);
		}
		if (itemIDs.length) {
			let addItems = async () => {
				await Zotero.DB.executeTransaction(async () => {
					await targetCollection.addItems(itemIDs);
				});
			};
			if (Zotero.SystematicReviewer?._withZoteroWriteLease) {
				await Zotero.SystematicReviewer._withZoteroWriteLease(current?.context || null, addItems, {
					ownerKey: `screening-copy:${targetCollection.id}:${Math.random().toString(36).slice(2, 8)}`,
				});
			}
			else {
				await addItems();
			}
		}
		return {
			added_count: itemIDs.length,
			target_collection_key: String(targetCollection.key || ""),
			target_collection_name: String(targetCollection.name || ""),
		};
	}

	async function moveItemsToTargetCollectionBatch({ reviewer, current, itemKeys = [], targetCollection, layoutInfo = null }) {
		let keys = uniqueItemKeys(itemKeys);
		if (!keys.length) {
			return {
				moved_count: 0,
				target_collection_key: String(targetCollection?.key || ""),
				target_collection_name: String(targetCollection?.name || ""),
			};
		}
		let info = layoutInfo || decisionTargetLayout(reviewer, current);
		let { root, layout, decisionTargets } = info;
		if (!root || !targetCollection?.id) {
			throw new Error("Target subcollection is required.");
		}
		if (!isDecisionTargetCollection(reviewer, root, layout, targetCollection)) {
			throw new Error("Only workflow subcollections can be used for screening move decisions.");
		}
		let additions = [];
		let removals = new Map();
		for (let itemKey of keys) {
			let item = recordItem(current, itemKey);
			if (!item?.id) {
				continue;
			}
			let existingCollectionIDs = [];
			try {
				existingCollectionIDs = item.getCollections?.() || [];
			}
			catch (_error) {
				existingCollectionIDs = [];
			}
			let existingSet = new Set(existingCollectionIDs || []);
			if (!existingSet.has(targetCollection.id)) {
				additions.push(item.id);
			}
			for (let collection of decisionTargets || []) {
				if (!collection?.id || collection.id == targetCollection.id || !existingSet.has(collection.id)) {
					continue;
				}
				if (!removals.has(collection.id)) {
					removals.set(collection.id, []);
				}
				removals.get(collection.id).push(item.id);
			}
		}
		if (additions.length || removals.size) {
			let moveItems = async () => {
				await Zotero.DB.executeTransaction(async () => {
					if (additions.length) {
						await targetCollection.addItems(additions);
					}
					for (let [collectionID, itemIDs] of removals) {
						if (!itemIDs.length) {
							continue;
						}
						let collection = Zotero.Collections.get(collectionID);
						if (!collection) {
							continue;
						}
						await collection.removeItems(itemIDs);
					}
				});
			};
			if (reviewer?._withZoteroWriteLease) {
				await reviewer._withZoteroWriteLease(current?.context || null, moveItems, {
					ownerKey: `screening-move:${targetCollection.id}:${Math.random().toString(36).slice(2, 8)}`,
				});
			}
			else {
				await moveItems();
			}
		}
		return {
			moved_count: keys.length,
			target_collection_key: String(targetCollection.key || ""),
			target_collection_name: String(targetCollection.name || ""),
		};
	}

	async function moveItemToTargetCollection({ reviewer, current, itemKey, targetCollection }) {
		if (!current?.collection || !targetCollection) {
			throw new Error("Target subcollection is required.");
		}
		let item = requireRecordItem(current, itemKey);
		await moveItemsToTargetCollectionBatch({
			reviewer,
			current,
			itemKeys: [itemKey],
			targetCollection,
		});
		return {
			review_state: itemReviewState(item, await reviewCollections(reviewer, current, {
				createMissing: false,
				includeMaybe: true,
			})),
			target_collection_key: String(targetCollection.key || ""),
			target_collection_name: String(targetCollection.name || ""),
		};
	}

	async function copyItemToCollection({ current, itemKey, targetCollection }) {
		requireRecordItem(current, itemKey);
		return await copyItemsToCollectionBatch({
			current,
			itemKeys: [itemKey],
			targetCollection,
		});
	}

	async function executeBatchWrites(reviewer, context, statements = []) {
		if (!Array.isArray(statements) || !statements.length) {
			return;
		}
		let db = await reviewer._projectDB(context);
		let runner = async () => {
			await db.executeTransaction(async () => {
				for (let statement of statements) {
					if (!statement?.sql) {
						continue;
					}
					await db.queryAsync(statement.sql, statement.params || []);
				}
			});
		};
		if (reviewer?._withProjectDBWriteLease) {
			await reviewer._withProjectDBWriteLease(context, runner, {
				ownerKey: `screening-batch:${context?.projectID || "project"}:${Math.random().toString(36).slice(2, 8)}`,
			});
			return;
		}
		await runner();
	}

	async function ensureTableColumns(reviewer, context, tableName, definitions = []) {
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`PRAGMA table_info(${tableName})`
		);
		let existing = new Set((rows || []).map((row) => String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "name") || "")));
		for (let definition of definitions || []) {
			if (!definition?.name || existing.has(definition.name)) {
				continue;
			}
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				`ALTER TABLE ${tableName} ADD COLUMN ${definition.sql}`
			);
			existing.add(definition.name);
		}
	}

	async function ensureSchema(reviewer, context) {
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS screening_decisions (
				item_key TEXT PRIMARY KEY,
				decision TEXT NOT NULL,
				reason TEXT,
				notes TEXT,
				updated_at TEXT NOT NULL
			)`
		);
		await ensureTableColumns(reviewer, context, "screening_decisions", [
			{ name: "target_collection_key", sql: "target_collection_key TEXT NOT NULL DEFAULT ''" },
			{ name: "target_collection_name", sql: "target_collection_name TEXT NOT NULL DEFAULT ''" },
			{ name: "source_type", sql: "source_type TEXT NOT NULL DEFAULT ''" },
			{ name: "source_detail", sql: "source_detail TEXT NOT NULL DEFAULT ''" },
		]);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_screening_decisions_decision ON screening_decisions(decision)"
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS screening_columns (
				column_key TEXT PRIMARY KEY,
				label TEXT NOT NULL,
				type TEXT NOT NULL DEFAULT 'text',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS screening_column_values (
				item_key TEXT NOT NULL,
				column_key TEXT NOT NULL,
				value_text TEXT,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (item_key, column_key)
			)`
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_screening_column_values_column ON screening_column_values(column_key)"
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS screening_rules (
				rule_id TEXT PRIMARY KEY,
				label TEXT NOT NULL,
				column_key TEXT NOT NULL,
				operator TEXT NOT NULL,
				match_value TEXT NOT NULL,
				decision TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`
		);
		await ensureTableColumns(reviewer, context, "screening_rules", [
			{ name: "target_collection_key", sql: "target_collection_key TEXT NOT NULL DEFAULT ''" },
			{ name: "target_collection_name", sql: "target_collection_name TEXT NOT NULL DEFAULT ''" },
		]);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_screening_rules_enabled ON screening_rules(enabled)"
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS screening_filters (
				filter_id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				query_text TEXT NOT NULL DEFAULT '',
				decision_filter TEXT NOT NULL DEFAULT '',
				source_scope TEXT NOT NULL DEFAULT '',
				source_collection_key TEXT NOT NULL DEFAULT '',
				source_collection_name TEXT NOT NULL DEFAULT '',
				column_key TEXT NOT NULL DEFAULT '',
				operator TEXT NOT NULL DEFAULT '',
				match_value TEXT NOT NULL DEFAULT '',
				match_mode TEXT NOT NULL DEFAULT 'and',
				rules_json TEXT NOT NULL DEFAULT '[]',
				tracking_column_key TEXT NOT NULL DEFAULT '',
				tracking_column_label TEXT NOT NULL DEFAULT '',
				materialized_collection_key TEXT NOT NULL DEFAULT '',
				materialized_collection_name TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				last_materialized_at TEXT NOT NULL DEFAULT ''
			)`
		);
		await ensureTableColumns(reviewer, context, "screening_filters", [
			{ name: "column_key", sql: "column_key TEXT NOT NULL DEFAULT ''" },
			{ name: "operator", sql: "operator TEXT NOT NULL DEFAULT ''" },
			{ name: "match_value", sql: "match_value TEXT NOT NULL DEFAULT ''" },
			{ name: "match_mode", sql: "match_mode TEXT NOT NULL DEFAULT 'and'" },
			{ name: "rules_json", sql: "rules_json TEXT NOT NULL DEFAULT '[]'" },
			{ name: "tracking_column_key", sql: "tracking_column_key TEXT NOT NULL DEFAULT ''" },
			{ name: "tracking_column_label", sql: "tracking_column_label TEXT NOT NULL DEFAULT ''" },
		]);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_screening_filters_updated ON screening_filters(updated_at DESC)"
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS screening_preferences (
				key TEXT PRIMARY KEY,
				value_json TEXT NOT NULL DEFAULT '',
				updated_at TEXT NOT NULL
			)`
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"DROP TABLE IF EXISTS screening_export_stage"
		);
		await repairStoredUTF8Artifacts(reviewer, context);
	}

	async function repairStoredUTF8Artifacts(reviewer, context) {
		let markers = ["Â", "Ã", "â"];
		let repairedFlag = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"SELECT value_json FROM screening_preferences WHERE key='utf8_repair_v1'"
		);
		if (String(SystematicReviewerWorkflowEmbeddings.rowValue(repairedFlag?.[0], "value_json") || "") == "true") {
			return;
		}
		let columnRows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT column_key, label FROM screening_columns
			 WHERE instr(label, ?) > 0 OR instr(label, ?) > 0 OR instr(label, ?) > 0`,
			markers
		);
		for (let row of columnRows || []) {
			let columnKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || "");
			let label = cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "label") || "");
			if (!columnKey || !label) {
				continue;
			}
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				"UPDATE screening_columns SET label=?, updated_at=? WHERE column_key=?",
				[label, new Date().toISOString(), columnKey]
			);
		}
		let filterRows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT filter_id, name, source_scope, source_collection_name, tracking_column_label, materialized_collection_name
			 FROM screening_filters
			 WHERE instr(name, ?) > 0 OR instr(name, ?) > 0 OR instr(name, ?) > 0
			    OR instr(source_scope, ?) > 0 OR instr(source_scope, ?) > 0 OR instr(source_scope, ?) > 0
			    OR instr(source_collection_name, ?) > 0 OR instr(source_collection_name, ?) > 0 OR instr(source_collection_name, ?) > 0
			    OR instr(tracking_column_label, ?) > 0 OR instr(tracking_column_label, ?) > 0 OR instr(tracking_column_label, ?) > 0
			    OR instr(materialized_collection_name, ?) > 0 OR instr(materialized_collection_name, ?) > 0 OR instr(materialized_collection_name, ?) > 0`,
			[
				...markers,
				...markers,
				...markers,
				...markers,
				...markers,
			]
		);
		for (let row of filterRows || []) {
			let filterID = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "filter_id") || "");
			if (!filterID) {
				continue;
			}
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				`UPDATE screening_filters
				 SET name=?, source_scope=?, source_collection_name=?, tracking_column_label=?, materialized_collection_name=?, updated_at=?
				 WHERE filter_id=?`,
				[
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "name") || ""),
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_scope") || ""),
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_collection_name") || ""),
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "tracking_column_label") || ""),
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "materialized_collection_name") || ""),
					new Date().toISOString(),
					filterID,
				]
			);
		}
		let decisionRows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT item_key, reason, notes, target_collection_name, source_detail
			 FROM screening_decisions
			 WHERE instr(reason, ?) > 0 OR instr(reason, ?) > 0 OR instr(reason, ?) > 0
			    OR instr(notes, ?) > 0 OR instr(notes, ?) > 0 OR instr(notes, ?) > 0
			    OR instr(target_collection_name, ?) > 0 OR instr(target_collection_name, ?) > 0 OR instr(target_collection_name, ?) > 0
			    OR instr(source_detail, ?) > 0 OR instr(source_detail, ?) > 0 OR instr(source_detail, ?) > 0`,
			[
				...markers,
				...markers,
				...markers,
				...markers,
			]
		);
		for (let row of decisionRows || []) {
			let itemKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key") || "");
			if (!itemKey) {
				continue;
			}
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				`UPDATE screening_decisions
				 SET reason=?, notes=?, target_collection_name=?, source_detail=?, updated_at=?
				 WHERE item_key=?`,
				[
					cleanBlockText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "reason") || ""),
					cleanBlockText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "notes") || ""),
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "target_collection_name") || ""),
					cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_detail") || ""),
					new Date().toISOString(),
					itemKey,
				]
			);
		}
		let valueRows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT item_key, column_key, value_text
			 FROM screening_column_values
			 WHERE instr(value_text, ?) > 0 OR instr(value_text, ?) > 0 OR instr(value_text, ?) > 0`,
			markers
		);
		for (let row of valueRows || []) {
			let itemKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key") || "");
			let columnKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || "");
			if (!itemKey || !columnKey) {
				continue;
			}
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				"UPDATE screening_column_values SET value_text=?, updated_at=? WHERE item_key=? AND column_key=?",
				[
					cleanBlockText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text") || ""),
					new Date().toISOString(),
					itemKey,
					columnKey,
				]
			);
		}
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			"INSERT OR REPLACE INTO screening_preferences(key, value_json, updated_at) VALUES ('utf8_repair_v1', 'true', ?)",
			[new Date().toISOString()]
		);
	}

	async function getPreference(reviewer, context, key, fallback = null) {
		await ensureSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"SELECT value_json FROM screening_preferences WHERE key=?",
			[key]
		);
		let raw = String(SystematicReviewerWorkflowEmbeddings.rowValue(rows?.[0], "value_json") || "");
		if (!raw) {
			return fallback;
		}
		try {
			return JSON.parse(raw);
		}
		catch (_error) {
			return fallback;
		}
	}

	async function setPreference(reviewer, context, key, value) {
		await ensureSchema(reviewer, context);
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			`INSERT OR REPLACE INTO screening_preferences (
				key, value_json, updated_at
			) VALUES (?, ?, ?)`,
			[key, JSON.stringify(value ?? null), new Date().toISOString()]
		);
		return value;
	}

	function valueTemplatePath(reviewer, context) {
		let projectRoot = currentContext(context)?.projectRoot || "";
		return projectRoot && VALUE_TEMPLATE_FILE_NAME
			? reviewer._joinPath(projectRoot, VALUE_TEMPLATE_FILE_NAME)
			: "";
	}

	async function listValueTemplates(reviewer, context) {
		let path = valueTemplatePath(reviewer, context);
		if (!path || !reviewer._pathExists(path)) {
			return { values: [], path };
		}
		let parsed = await reviewer._readJSONFile(path).catch(() => ({}));
		let values = Array.isArray(parsed?.values) ? parsed.values : [];
		let cleaned = [];
		let seen = new Set();
		for (let value of values) {
			let text = cleanText(value);
			if (!text || seen.has(text)) {
				continue;
			}
			seen.add(text);
			cleaned.push(text);
		}
		return { values: cleaned, path };
	}

	async function saveValueTemplates(reviewer, context, values = []) {
		let path = valueTemplatePath(reviewer, context);
		if (!path) {
			throw new Error("Project path is unavailable.");
		}
		let cleaned = [];
		let seen = new Set();
		for (let value of values || []) {
			let text = cleanText(value);
			if (!text || seen.has(text)) {
				continue;
			}
			seen.add(text);
			cleaned.push(text);
		}
		await reviewer._writeJSONFile(path, { values: cleaned });
		return { values: cleaned, path };
	}

	async function addValueTemplateValue(reviewer, context, value) {
		let text = optionalString(value);
		if (!text) {
			throw new Error("value is required");
		}
		let existing = await listValueTemplates(reviewer, context);
		let values = Array.isArray(existing.values) ? existing.values.slice() : [];
		if (!values.includes(text)) {
			values.push(text);
		}
		return await saveValueTemplates(reviewer, context, values);
	}

	function scopeDescriptor(reviewer, current, payload = {}) {
		return SystematicReviewerWorkflowEmbeddings.scopeDescriptor
			? SystematicReviewerWorkflowEmbeddings.scopeDescriptor(reviewer, current, payload)
			: null;
	}

	function resolvedScopeSpec(reviewer, current, payload = {}) {
		let explicit = SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload
			? SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload(payload)
			: null;
		if (explicit) {
			return explicit;
		}
		let fallback = SystematicReviewerWorkflowEmbeddings.defaultScopeEntry
			? SystematicReviewerWorkflowEmbeddings.defaultScopeEntry(reviewer, current)
			: null;
		if (!fallback?.collection_key) {
			return null;
		}
		return {
			scope: String(fallback.scope_kind || ""),
			collection_key: String(fallback.collection_key || ""),
			collection_name: String(fallback.collection_name || ""),
		};
	}

	function scopedProjectItems(reviewer, current, payload = {}) {
		let collection = current?.collection || null;
		let projectItem = current?.projectItem || null;
		if (!collection || typeof reviewer?._projectCitableItems != "function") {
			return [];
		}
		return reviewer._projectCitableItems(
			collection,
			projectItem,
			resolvedScopeSpec(reviewer, current, payload)
		);
	}

	function scopedProjectItemKeys(reviewer, current, payload = {}) {
		let collection = current?.collection || null;
		let projectItem = current?.projectItem || null;
		let scope = scopeDescriptor(reviewer, current, payload)
			|| (typeof reviewer?._projectScopeDescriptor == "function"
				? reviewer._projectScopeDescriptor(collection, resolvedScopeSpec(reviewer, current, payload))
				: null);
		let nodes = Array.isArray(scope?.nodes) ? scope.nodes : [];
		let seen = new Set();
		let itemKeys = [];
		for (let node of nodes) {
			let directItems = node?.collection?.getChildItems ? node.collection.getChildItems(false, false) : [];
			for (let item of directItems) {
				if (!item || item.deleted || !item.key) {
					continue;
				}
				if ((projectItem && item.id == projectItem.id) || reviewer?._itemBelongsToProjectShell?.(item)) {
					continue;
				}
				if (item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				let itemKey = optionalString(item.key);
				if (!itemKey || seen.has(itemKey)) {
					continue;
				}
				seen.add(itemKey);
				itemKeys.push(itemKey);
			}
		}
		return {
			itemKeys,
			scope,
		};
	}

	async function scopedIdentityMap(reviewer, current, itemKeys = []) {
		let context = current?.context;
		if (!context || typeof reviewer?._projectItemIdentityMap != "function") {
			return new Map();
		}
		let cleanKeys = Array.from(new Set((itemKeys || []).map((itemKey) => optionalString(itemKey)).filter(Boolean)));
		return await reviewer._projectItemIdentityMap(context, cleanKeys);
	}

	function itemTextField(reviewer, item, field = "") {
		return typeof reviewer?._itemField == "function"
			? String(reviewer._itemField(item, field) || "")
			: String(item?.getField?.(field) || "");
	}

	function itemYear(reviewer, item, identity = null) {
		return cleanText(identity?.year || reviewer?._extractYear?.(itemTextField(reviewer, item, "date")) || "");
	}

	function itemAbstract(reviewer, item, identity = null) {
		return cleanBlockText(identity?.abstract_note || itemTextField(reviewer, item, "abstractNote"));
	}

	function itemOpenAlexID(reviewer, item, identity = null) {
		return cleanText(
			identity?.openalex_id
			|| reviewer?._openAlexIDFromExtra?.(itemTextField(reviewer, item, "extra"))
			|| ""
		);
	}

	function itemPaperID(reviewer, item, identity = null) {
		return cleanText(
			identity?.paper_id
			|| reviewer?._paperIDFromExtra?.(itemTextField(reviewer, item, "extra"))
			|| ""
		);
	}

	function pendingReviewState() {
		return {
			review_stage: REVIEW_COLLECTIONS.pending.key,
			review_collection_key: "",
			review_collection_name: REVIEW_COLLECTIONS.pending.label,
			decision: "",
		};
	}

	async function reviewStateByItemKey(reviewer, current, options = {}) {
		let root = current?.collection || null;
		if (!root) {
			return new Map();
		}
		let requestedKeys = Array.isArray(options.itemKeys)
			? new Set(options.itemKeys.map((itemKey) => optionalString(itemKey)).filter(Boolean))
			: null;
		if (requestedKeys && !requestedKeys.size) {
			return new Map();
		}
		let nodes = reviewer?._projectCollectionNodes?.(root) || [];
		let buckets = await reviewCollections(reviewer, current, {
			createMissing: false,
			includeMaybe: true,
		});
		let out = new Map();
		if (typeof reviewer?._eachCollectionCitableItem == "function") {
			let visitorBatchSize = Math.max(25, Math.min(BATCH_WRITE_SIZE, EXPORT_SCAN_BATCH_SIZE));
			for (let definition of REVIEW_COLLECTION_ORDER) {
				let bucket = buckets?.[definition.key] || null;
				if (!bucket?.id) {
					continue;
				}
				let stopped = false;
				await reviewer._eachCollectionCitableItem(
					bucket,
					current?.projectItem || null,
					{
						includeDescendants: true,
						batchSize: visitorBatchSize,
						dedupe: true,
					},
					async (_item, info = {}) => {
						let itemKey = optionalString(info?.itemKey);
						if (!itemKey || out.has(itemKey) || (requestedKeys && !requestedKeys.has(itemKey))) {
							return true;
						}
						out.set(itemKey, {
							review_stage: definition.key,
							review_collection_key: String(bucket.key || ""),
							review_collection_name: definition.label,
							decision: definition.decision,
						});
						if (requestedKeys && out.size >= requestedKeys.size) {
							stopped = true;
							return false;
						}
						return true;
					}
				);
				if (stopped) {
					return out;
				}
			}
			return out;
		}
		for (let definition of REVIEW_COLLECTION_ORDER) {
			let bucket = buckets?.[definition.key] || null;
			if (!bucket?.id) {
				continue;
			}
			for (let node of nodes) {
				let collection = node?.collection || null;
				if (!collection?.id || !reviewer?._collectionHasAncestor?.(collection, bucket.id)) {
					continue;
				}
				let directItems = collection.getChildItems ? collection.getChildItems(false, false) : [];
				for (let item of directItems) {
					if (!item || item.deleted || !item.key) {
						continue;
					}
					if ((current?.projectItem && item.id == current.projectItem.id) || reviewer?._itemBelongsToProjectShell?.(item)) {
						continue;
					}
						if (item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
							continue;
						}
						let itemKey = optionalString(item.key);
						if (!itemKey || out.has(itemKey) || (requestedKeys && !requestedKeys.has(itemKey))) {
							continue;
						}
						out.set(itemKey, {
							review_stage: definition.key,
						review_collection_key: String(bucket.key || ""),
						review_collection_name: definition.label,
							decision: definition.decision,
						});
						if (requestedKeys && out.size >= requestedKeys.size) {
							return out;
						}
					}
				}
			}
			return out;
		}

	async function fallbackRecordMap(reviewer, current, itemKeys = [], { includeAbstracts = false } = {}) {
		let out = new Map();
		for (let itemKey of itemKeys || []) {
			let item = recordItem(current, itemKey);
			if (!item) {
				continue;
			}
			out.set(itemKey, {
				title: cleanBlockText(itemTextField(reviewer, item, "title")),
				abstract_note: includeAbstracts ? cleanBlockText(itemTextField(reviewer, item, "abstractNote")) : "",
				year: cleanText(reviewer?._extractYear?.(itemTextField(reviewer, item, "date")) || ""),
				doi: cleanText(itemTextField(reviewer, item, "DOI")),
				pmid: cleanText(itemTextField(reviewer, item, "PMID")),
				openalex_id: cleanText(reviewer?._openAlexIDFromExtra?.(itemTextField(reviewer, item, "extra")) || ""),
				paper_id: cleanText(reviewer?._paperIDFromExtra?.(itemTextField(reviewer, item, "extra")) || ""),
				zotero_uri: cleanText(Zotero.URI?.getItemURI ? Zotero.URI.getItemURI(item) : ""),
			});
		}
		return out;
	}

	function mergedStateRequirements(columns = [], payload = {}, options = {}) {
		let sortBy = normalizeSortKey(payload.sort_by || payload.sortBy || "item_key");
		let query = optionalString(payload.query);
		let allCustomColumnKeys = (columns || []).map((column) => optionalString(column?.column_key)).filter(Boolean);
		let customColumnKeys = new Set(
			!!options.includeAllCustomValues
				? allCustomColumnKeys
				: Array.from(new Set((options.customColumnKeys || []).map((key) => optionalString(key)).filter(Boolean)))
		);
		let includeAbstracts = !!options.includeAbstracts;
		let rules = Array.isArray(options.rules) ? options.rules : normalizeActionRules(payload);
		let knownCustomColumns = new Set(allCustomColumnKeys);
		let consumeField = (fieldKey = "") => {
			let normalized = optionalString(fieldKey);
			if (!normalized) {
				return;
			}
			if (normalized == "abstract_note") {
				includeAbstracts = true;
			}
			if (knownCustomColumns.has(normalized)) {
				customColumnKeys.add(normalized);
			}
		};
		if (query) {
			includeAbstracts = true;
			for (let columnKey of allCustomColumnKeys) {
				customColumnKeys.add(columnKey);
			}
		}
		consumeField(sortBy);
		for (let rule of rules || []) {
			consumeField(rule?.column_key);
		}
		return {
			includeAbstracts,
			customColumnKeys: Array.from(customColumnKeys),
			rules,
		};
	}

	async function collectionRecords(reviewer, current, payload = {}, options = {}) {
		let includeAbstracts = !!options.includeAbstracts;
		let scoped = Array.isArray(options.itemKeys)
			? {
				itemKeys: Array.from(new Set((options.itemKeys || []).map((itemKey) => optionalString(itemKey)).filter(Boolean))),
				scope: scopeDescriptor(reviewer, current, payload),
			}
			: scopedProjectItemKeys(reviewer, current, payload);
		let itemKeys = scoped.itemKeys || [];
		let identities = await scopedIdentityMap(reviewer, current, itemKeys);
		let missingKeys = itemKeys.filter((itemKey) => !identities.has(itemKey));
		let fallbacks = missingKeys.length
			? await fallbackRecordMap(reviewer, current, missingKeys, { includeAbstracts })
			: new Map();
		return itemKeys.map((itemKey) => {
			let identity = identities.get(itemKey) || null;
			let fallback = fallbacks.get(itemKey) || null;
			let title = cleanBlockText(identity?.title || fallback?.title || "");
			let year = cleanText(identity?.year || fallback?.year || "");
			let abstractNote = includeAbstracts ? cleanBlockText(identity?.abstract_note || fallback?.abstract_note || "") : "";
			return {
				item_key: itemKey,
				citation_token: itemKey ? `@[${itemKey}]` : "",
				citation_text: cleanBlockText(identity?.citation_text || ""),
				paper_id: cleanText(identity?.paper_id || fallback?.paper_id || ""),
				openalex_id: cleanText(identity?.openalex_id || fallback?.openalex_id || ""),
				title,
				abstract_note: abstractNote,
				abstract_origin: includeAbstracts ? cleanText(identity?.abstract_origin || (abstractNote ? "Zotero" : "")) : "",
				year,
				doi: cleanText(identity?.doi || fallback?.doi || ""),
				pmid: cleanText(identity?.pmid || fallback?.pmid || ""),
				updated_at: cleanText(identity?.updated_at || ""),
				zotero_uri: cleanText(fallback?.zotero_uri || ""),
			};
		});
	}

	function attachmentSummaryForItem(reviewer, item) {
		let summary = {
			attachment_count: 0,
			pdf_count: 0,
			has_pdf: false,
			pdf_attachment_key: "",
			pdf_attachment_title: "",
			pdf_attachment_id: null,
			has_markdown: false,
			markdown_attachment_key: "",
			markdown_attachment_title: "",
			has_full_text: false,
			full_text_state: "missing",
		};
		if (!item?.getAttachments) {
			return summary;
		}
		let attachmentIDs = [];
		try {
			attachmentIDs = item.getAttachments() || [];
		}
		catch (_error) {
			attachmentIDs = [];
		}
		for (let attachmentID of attachmentIDs) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
				continue;
			}
			summary.attachment_count += 1;
			let contentType = optionalString(attachment.attachmentContentType).toLowerCase();
			let filePath = optionalString(attachment.getFilePath ? attachment.getFilePath() : "").toLowerCase();
			let isPdf = contentType == "application/pdf" || filePath.endsWith(".pdf");
			if (!isPdf) {
				continue;
			}
			summary.pdf_count += 1;
			if (!summary.has_pdf) {
				summary.has_pdf = true;
				summary.pdf_attachment_key = optionalString(attachment.key);
				summary.pdf_attachment_title = optionalString(
					reviewer?._itemField ? reviewer._itemField(attachment, "title") : attachment.getField?.("title")
				) || "PDF";
				summary.pdf_attachment_id = attachment.id || null;
			}
		}
		summary.has_full_text = !!summary.has_pdf;
		summary.full_text_state = summary.has_pdf ? "pdf_only" : "missing";
		return summary;
	}

	function fullTextStateFromSummary(summary = {}) {
		if (summary?.has_markdown) {
			return "markdown_ready";
		}
		if (summary?.has_pdf) {
			return "pdf_only";
		}
		return "missing";
	}

	async function fullTextSummaryForItem(reviewer, item) {
		let summary = attachmentSummaryForItem(reviewer, item);
		if (!item || !SystematicReviewerWorkflowRAG?.preferredMarkdownSourceForItem) {
			summary.full_text_state = fullTextStateFromSummary(summary);
			return summary;
		}
		try {
			let markdownSource = await SystematicReviewerWorkflowRAG.preferredMarkdownSourceForItem(reviewer, item);
			if (markdownSource?.attachment_key) {
				summary.has_markdown = true;
				summary.markdown_attachment_key = optionalString(markdownSource.attachment_key);
				summary.markdown_attachment_title = optionalString(markdownSource.title || markdownSource.relative_path || "Markdown");
			}
		}
		catch (error) {
			reviewer?.log?.(`screening full-text summary skipped for ${item?.key || "item"}: ${error}`);
		}
		summary.has_full_text = !!(summary.has_pdf || summary.has_markdown);
		summary.full_text_state = fullTextStateFromSummary(summary);
		return summary;
	}

	async function attachmentFilePath(attachment) {
		if (!attachment) {
			return "";
		}
		if (attachment.getFilePathAsync) {
			return String((await attachment.getFilePathAsync()) || "");
		}
		if (attachment.getFilePath) {
			return String(attachment.getFilePath() || "");
		}
		return "";
	}

	function isPdfAttachmentItem(attachment, filePath = "") {
		if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
			return false;
		}
		let contentType = optionalString(attachment.attachmentContentType).toLowerCase();
		return contentType == "application/pdf" || String(filePath || "").toLowerCase().endsWith(".pdf");
	}

	async function pdfSourcesForItem(item) {
		let sources = [];
		if (!item?.getAttachments) {
			return sources;
		}
		for (let attachmentID of item.getAttachments() || []) {
			let attachment = Zotero.Items.get(attachmentID);
			let filePath = await attachmentFilePath(attachment);
			if (!isPdfAttachmentItem(attachment, filePath) || !filePath) {
				continue;
			}
			sources.push({
				attachment,
				parentItem: item,
				kind: "pdf",
				path: filePath,
			});
		}
		return sources;
	}

	async function queueMarkdownConversionsForSources(reviewer, current, sources = []) {
		let cleanSources = (sources || []).filter((source) => optionalString(source?.attachment?.key) && optionalString(source?.path));
		if (!current?.context || !cleanSources.length || !reviewer?._enqueueConversionSources) {
			return {
				ok: true,
				requested_mode: "",
				queued_count: 0,
				jobs: [],
			};
		}
		let existingKeys = reviewer?._existingConversionSourceKeys
			? await reviewer._existingConversionSourceKeys(current.context)
			: new Set();
		let queuedSources = [];
		for (let source of cleanSources) {
			let key = optionalString(source?.attachment?.key);
			if (!key || existingKeys.has(key)) {
				continue;
			}
			if (reviewer?._conversionSourceHasUsableTextAttachment && await reviewer._conversionSourceHasUsableTextAttachment(source)) {
				continue;
			}
			queuedSources.push(source);
		}
		let config = reviewer?._conversionConfig ? await reviewer._conversionConfig().catch(() => null) : null;
		let requestedMode = optionalString(config?.pdf_markdown?.mode || config?.pdfMarkdown?.mode || "") || "fast";
		if (!queuedSources.length) {
			return {
				ok: true,
				requested_mode: requestedMode,
				queued_count: 0,
				jobs: [],
			};
		}
		let result = await reviewer._enqueueConversionSources(current, queuedSources, requestedMode, {
			openJobsTab: false,
			refreshControllers: false,
		});
		return {
			ok: true,
			requested_mode: requestedMode,
			queued_count: Array.isArray(result?.jobs) ? result.jobs.length : 0,
			jobs: Array.isArray(result?.jobs) ? result.jobs : [],
		};
	}

	async function queueMarkdownConversionsForItem(reviewer, current, item) {
		return await queueMarkdownConversionsForSources(reviewer, current, await pdfSourcesForItem(item));
	}

	async function addAvailableFilesForSingleItem(item) {
		if (!item || !Zotero.Attachments?.addAvailableFiles) {
			return {
				ok: false,
				attempted: item ? 1 : 0,
				succeeded: 0,
				failed: item ? [{ item_key: optionalString(item?.key), message: "PDF retrieval is unavailable in this Zotero build." }] : [],
			};
		}
		try {
			await Zotero.Attachments.addAvailableFiles([item]);
			return {
				ok: true,
				attempted: 1,
				succeeded: 1,
				failed: [],
			};
		}
		catch (error) {
			return {
				ok: false,
				attempted: 1,
				succeeded: 0,
				failed: [{
					item_key: optionalString(item?.key),
					message: error?.message || String(error),
				}],
			};
		}
	}

	async function pickPdfFile(reviewer, current, payload = {}) {
		let sourcePath = optionalString(payload.source_path || payload.sourcePath || "");
		if (sourcePath) {
			if (!(await reviewer._pathExists(sourcePath))) {
				throw new Error(`PDF file does not exist: ${sourcePath}`);
			}
			return reviewer._nsIFile(sourcePath);
		}
		let win = reviewer?._primaryWindow?.() || null;
		if (!win?.document) {
			throw new Error("A Zotero window is required to choose a PDF.");
		}
		let fakeController = { doc: win.document };
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		reviewer._initFilePicker(fp, fakeController, "Choose full-text PDF", Components.interfaces.nsIFilePicker.modeOpen);
		fp.appendFilter("PDF", "*.pdf");
		let result = await new Promise((resolve) => fp.open(resolve));
		if (result != Components.interfaces.nsIFilePicker.returnOK || !fp.file) {
			return null;
		}
		return fp.file;
	}

	async function uploadFullTextPdf({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("Provide an item key.");
		}
		let item = requireRecordItem(current, itemKey);
		let picked = await pickPdfFile(reviewer, current, payload || {});
		if (!picked) {
			return {
				ok: true,
				canceled: true,
			};
		}
		if (!/\.pdf$/i.test(String(picked.leafName || ""))) {
			throw new Error("Choose a PDF file.");
		}
		if (!Zotero.Attachments?.importFromFile) {
			throw new Error("Stored-copy PDF import is unavailable in this Zotero build.");
		}
		let attachment = await Zotero.Attachments.importFromFile({
			file: picked,
			parentItemID: item.id,
			libraryID: context.libraryID,
		});
		let conversionQueue = await queueMarkdownConversionsForSources(reviewer, current, await pdfSourcesForItem(item));
		let summary = await fullTextSummaryForItem(reviewer, item);
		return {
			ok: true,
			item_key: item.key || itemKey,
			item_id: item.id || null,
			attachment_key: optionalString(attachment?.key || ""),
			attachment_title: optionalString(reviewer?._itemField?.(attachment, "title") || picked.leafName || "PDF"),
			conversion_queue: conversionQueue,
			attachments: summary,
			full_text_state: summary.full_text_state || fullTextStateFromSummary(summary),
		};
	}

	async function findItemFullText({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("Provide an item key.");
		}
		let item = requireRecordItem(current, itemKey);
		let before = await fullTextSummaryForItem(reviewer, item);
		let fetchSummary = await addAvailableFilesForSingleItem(item);
		let after = await fullTextSummaryForItem(reviewer, item);
		let found = !before.has_pdf && after.has_pdf;
		let conversionQueue = found
			? await queueMarkdownConversionsForItem(reviewer, current, item)
			: {
				ok: true,
				requested_mode: "",
				queued_count: 0,
				jobs: [],
			};
		return {
			ok: true,
			item_key: item.key || itemKey,
			item_id: item.id || null,
			found,
			fetch_summary: fetchSummary,
			conversion_queue: conversionQueue,
			attachments: after,
			full_text_state: after.full_text_state || fullTextStateFromSummary(after),
		};
	}

	async function inspectScopeFullText({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let scoped = scopedProjectItemKeys(reviewer, current, payload || {});
		let markdownReadyItemKeys = [];
		let pdfOnlyItemKeys = [];
		let missingItemKeys = [];
		for (let itemKey of scoped.itemKeys || []) {
			let item = recordItem(current, itemKey);
			let summary = await fullTextSummaryForItem(reviewer, item);
			let state = summary.full_text_state || fullTextStateFromSummary(summary);
			if (state == "markdown_ready") {
				markdownReadyItemKeys.push(itemKey);
			}
			else if (state == "pdf_only") {
				pdfOnlyItemKeys.push(itemKey);
			}
			else {
				missingItemKeys.push(itemKey);
			}
		}
		let retrievalStatus = SystematicReviewerWorkflowFullText?.status
			? await SystematicReviewerWorkflowFullText.status({ reviewer, current, payload: payload || {} }).catch(() => ({}))
			: {};
		let conversionStatus = SystematicReviewerWorkflowFullText?.conversionStatus
			? await SystematicReviewerWorkflowFullText.conversionStatus({ reviewer, current, payload: payload || {} }).catch(() => ({}))
			: {};
		return {
			ok: true,
			scope: scoped.scope || {},
			requested_count: Number(scoped.itemKeys?.length || 0) || 0,
			markdown_ready_count: markdownReadyItemKeys.length,
			pdf_only_count: pdfOnlyItemKeys.length,
			missing_full_text_count: missingItemKeys.length,
			missing_markdown_count: pdfOnlyItemKeys.length + missingItemKeys.length,
			markdown_ready_item_keys: markdownReadyItemKeys,
			pdf_only_item_keys: pdfOnlyItemKeys,
			missing_full_text_item_keys: missingItemKeys,
			missing_markdown_item_keys: pdfOnlyItemKeys.concat(missingItemKeys),
			with_pdf_count: Number(retrievalStatus?.with_pdf_count || 0) || 0,
			missing_pdf_count: Number(retrievalStatus?.missing_pdf_count || 0) || 0,
			retrieval_active: retrievalStatus?.active === true,
			retrieval_idle_ready: retrievalStatus?.idle_ready === true,
			watch_job_id: optionalString(retrievalStatus?.watch_job_id || ""),
			conversion_queued_count: Number(conversionStatus?.queued_count || 0) || 0,
			conversion_running_count: Number(conversionStatus?.running_count || 0) || 0,
			conversion_succeeded_count: Number(conversionStatus?.succeeded_count || 0) || 0,
			conversion_failed_count: Number(conversionStatus?.failed_count || 0) || 0,
		};
	}

	async function excludeMissingMarkdownInScope({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let inspection = await inspectScopeFullText({ reviewer, current, payload: payload || {} });
		let itemKeys = uniqueItemKeys(inspection.missing_markdown_item_keys || []);
		let targets = await reviewCollections(reviewer, current, {
			createMissing: false,
		});
		let excludedCollection = targets?.excluded || null;
		if (!excludedCollection?.key) {
			throw new Error("Excluded collection is unavailable.");
		}
		let reasonCode = optionalString(payload.reason_code || payload.reasonCode || SystematicReviewerWorkflowFullText?.NOT_RETRIEVED_REASON || "full_text_not_retrieved");
		let notes = cleanBlockText(payload.notes || "Markdown full text was not available for this scope.");
		let sourceType = normalizeDecisionSourceType(payload.source_type || payload.sourceType || "automated", "automated");
		let sourceDetail = cleanBlockText(payload.source_detail || payload.sourceDetail || "full_text_missing_markdown_scope");
		let layoutInfo = decisionTargetLayout(reviewer, current);
		let processed = 0;
		for (let batch of chunkArray(itemKeys, BATCH_WRITE_SIZE)) {
			await moveItemsToTargetCollectionBatch({
				reviewer,
				current,
				itemKeys: batch,
				targetCollection: excludedCollection,
				layoutInfo,
			});
			let statements = batch.map((itemKey) => ({
				sql: `INSERT OR REPLACE INTO screening_decisions (
					item_key,
					decision,
					reason,
					notes,
					target_collection_key,
					target_collection_name,
					source_type,
					source_detail,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				params: [
					itemKey,
					"exclude",
					reasonCode,
					notes,
					String(excludedCollection.key || ""),
					String(excludedCollection.name || ""),
					sourceType,
					sourceDetail,
					new Date().toISOString(),
				],
			}));
			await executeBatchWrites(reviewer, context, statements);
			processed += batch.length;
		}
		return {
			ok: true,
			scope: inspection.scope || {},
			moved_count: processed,
			item_keys: itemKeys,
			reason_code: reasonCode,
			target_collection_key: String(excludedCollection.key || ""),
			target_collection_name: String(excludedCollection.name || ""),
		};
	}

	function recordItem(current, itemKey) {
		let context = current?.context;
		if (!context || !itemKey) {
			return null;
		}
		try {
			return Zotero.Items.getByLibraryAndKey(context.libraryID, itemKey) || null;
		}
		catch (_error) {
			return null;
		}
	}

	function requireRecordItem(current, itemKey) {
		let item = recordItem(current, itemKey);
		if (!item) {
			throw new Error("Project item was not found in Zotero.");
		}
		return item;
	}

	function requirePdfAttachment(reviewer, item) {
		let summary = attachmentSummaryForItem(reviewer, item);
		if (!summary.has_pdf || !summary.pdf_attachment_id) {
			throw new Error("No PDF attachment is available for this item.");
		}
		let attachment = Zotero.Items.get(summary.pdf_attachment_id);
		if (!attachment || attachment.deleted) {
			throw new Error("The PDF attachment could not be loaded.");
		}
		return {
			attachment,
			summary,
		};
	}

	async function decisionsMap(reviewer, context, options = {}) {
		await ensureSchema(reviewer, context);
		let itemKeys = Array.isArray(options.itemKeys)
			? Array.from(new Set(options.itemKeys.map((value) => optionalString(value)).filter(Boolean)))
			: [];
		let out = new Map();
		let keyBatches = itemKeys.length ? chunkArray(itemKeys, BATCH_WRITE_SIZE) : [null];
		for (let keyBatch of keyBatches) {
			let where = [];
			let params = [];
			if (Array.isArray(keyBatch) && keyBatch.length) {
				where.push(`item_key IN (${keyBatch.map(() => "?").join(", ")})`);
				params.push(...keyBatch);
			}
			let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`SELECT
					item_key,
					COALESCE(decision, '') AS decision,
					COALESCE(reason, '') AS reason,
					COALESCE(notes, '') AS notes,
					COALESCE(target_collection_key, '') AS target_collection_key,
					COALESCE(target_collection_name, '') AS target_collection_name,
					COALESCE(source_type, '') AS source_type,
					COALESCE(source_detail, '') AS source_detail,
					updated_at
				 FROM screening_decisions
				 ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
				 ORDER BY updated_at DESC, item_key ASC`,
				params
			);
			for (let row of rows || []) {
				let itemKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key") || "");
				out.set(itemKey, {
					item_key: itemKey,
					decision: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "decision") || ""),
					reason: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "reason") || ""),
					notes: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "notes") || ""),
					target_collection_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "target_collection_key") || ""),
					target_collection_name: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "target_collection_name") || ""),
					source_type: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_type") || ""),
					source_detail: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_detail") || ""),
					updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
				});
			}
		}
		return out;
	}

	async function listColumns(reviewer, context) {
		await ensureSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT column_key, label, type, created_at, updated_at
			 FROM screening_columns
			 ORDER BY label COLLATE NOCASE ASC, column_key ASC`
		);
		return (rows || []).map((row) => ({
			column_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || ""),
			label: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "label") || ""),
			type: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "type") || "text"),
			created_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at") || ""),
			updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
		}));
	}

	async function listExtractionColumnCatalog(reviewer, context) {
		await ensureSchema(reviewer, context);
		await SystematicReviewerWorkflowExtraction.ensureSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				field_key,
				MAX(field_label) AS field_label,
				MAX(field_type) AS field_type,
				MAX(updated_at) AS updated_at
			 FROM extraction_values
			 GROUP BY field_key
			 ORDER BY LOWER(COALESCE(MAX(field_label), field_key)) ASC, field_key ASC`
		);
		let out = [];
		for (let row of rows || []) {
			let fieldKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_key"));
			if (!fieldKey) {
				continue;
			}
			let label = cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_label") || fieldKey);
			let type = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_type") || "text") || "text";
			let updatedAt = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at"));
			let valueColumnKey = extractionValueColumnKey(fieldKey);
			out.push({
				key: valueColumnKey,
				column_key: valueColumnKey,
				label,
				type,
				group: "Extraction",
				editable: false,
				visible: false,
				field_key: fieldKey,
				origin: "extraction",
				updated_at: updatedAt,
			});
			for (let metadata of EXTRACTION_METADATA_DEFINITIONS) {
				let metadataColumnKey = extractionMetadataColumnKey(fieldKey, metadata.key);
				out.push({
					key: metadataColumnKey,
					column_key: metadataColumnKey,
					label: `${label} ${metadata.label}`,
					type: metadata.type,
					group: "Extraction metadata",
					editable: false,
					visible: false,
					field_key: fieldKey,
					metadata_key: metadata.key,
					origin: "extraction_metadata",
					updated_at: updatedAt,
				});
			}
		}
		return out;
	}

	async function listDynamicColumnCatalog(reviewer, context) {
		let [manualColumns, extractionColumns] = await Promise.all([
			listColumns(reviewer, context),
			listExtractionColumnCatalog(reviewer, context),
		]);
		let manual = (manualColumns || []).map((column) => ({
			key: optionalString(column?.column_key),
			column_key: optionalString(column?.column_key),
			label: cleanText(column?.label || column?.column_key || ""),
			type: optionalString(column?.type || "text") || "text",
			group: "Manual",
			editable: true,
			visible: false,
			created_at: optionalString(column?.created_at),
			updated_at: optionalString(column?.updated_at),
			origin: "screening",
		}));
		return manual.concat(extractionColumns || []);
	}

	async function listAllColumnDefinitions(reviewer, context) {
		return builtinColumnDefinitions().concat(await listDynamicColumnCatalog(reviewer, context));
	}

	async function listRules(reviewer, context) {
		await ensureSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				rule_id,
				label,
				column_key,
				operator,
				match_value,
				decision,
				COALESCE(target_collection_key, '') AS target_collection_key,
				COALESCE(target_collection_name, '') AS target_collection_name,
				enabled,
				created_at,
				updated_at
			 FROM screening_rules
			 ORDER BY updated_at DESC, label COLLATE NOCASE ASC`
		);
		return (rows || []).map((row) => ({
			rule_id: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "rule_id") || ""),
			label: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "label") || ""),
			column_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || ""),
			operator: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "operator") || "contains"),
			match_value: cleanBlockText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "match_value") || ""),
			decision: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "decision") || ""),
			target_collection_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "target_collection_key") || ""),
			target_collection_name: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "target_collection_name") || ""),
			enabled: !!Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "enabled") || 0),
			created_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at") || ""),
			updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
		}));
	}

	function scopeSnapshot(payload = {}, descriptor = null) {
		return {
			scope: optionalString(
				payload.review_scope
				?? payload.reviewScope
				?? payload.scope
				?? payload.collection_scope
				?? payload.collectionScope
			),
			collection_key: optionalString(
				payload.collection_key
				?? payload.collectionKey
				?? payload.scope_collection_key
				?? payload.scopeCollectionKey
			) || optionalString(descriptor?.scope_key),
			collection_name: optionalString(
				payload.collection_name
				?? payload.collectionName
				?? payload.scope_collection_name
				?? payload.scopeCollectionName
			) || optionalString(descriptor?.scope_name),
		};
	}

	function scopeSummaryLabel(snapshot = {}) {
		if (snapshot.collection_name) {
			return snapshot.collection_name;
		}
		if (snapshot.scope) {
			return snapshot.scope;
		}
		return "Project collection";
	}

	function scopeLabel(name = "", count = 0, prefix = "") {
		return `${String(prefix || "")}${cleanText(name)} (${Number(count || 0) || 0})`;
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
				let itemKey = cleanText(item.key || "");
				if (itemKey) {
					seen.add(itemKey);
				}
			}
		}
		return seen.size;
	}

	function workflowCollectionRank(name = "") {
		let normalized = cleanText(name).toLowerCase();
		switch (normalized) {
			case "pending":
				return 1;
			case "included":
				return 2;
			case "excluded":
				return 3;
			case "excluded ft":
				return 4;
			case "duplicates":
				return 5;
			default:
				return 50;
		}
	}

	function availableScopes(reviewer, current) {
		let entries = SystematicReviewerWorkflowEmbeddings?.availableScopes
			? SystematicReviewerWorkflowEmbeddings.availableScopes(reviewer, current, {
				purpose: "screening",
			})
			: [];
		return (entries || []).slice().sort((left, right) => {
			if (left?.is_root) {
				return -1;
			}
			if (right?.is_root) {
				return 1;
			}
			let kindCompare = workflowCollectionRank(left?.collection_name) - workflowCollectionRank(right?.collection_name);
			if (kindCompare) {
				return kindCompare;
			}
			return String(left?.label || "").localeCompare(String(right?.label || ""), undefined, { sensitivity: "base", numeric: true });
		});
	}

	function availableDecisionTargets(reviewer, current) {
		let root = current?.collection || null;
		if (!root || !reviewer?._projectCollectionNodes) {
			return [];
		}
		let nodes = reviewer._projectCollectionNodes(root) || [];
		let layout = reviewer?._projectWorkflowTreeInfo?.(root, nodes) || null;
		return (nodes || [])
			.filter((node) => node?.collection && isDecisionTargetCollection(reviewer, root, layout, node.collection))
			.map((node) => ({
				collection_key: String(node.collection.key || ""),
				collection_name: cleanText(node.collection.name || ""),
				label: node.level > 1 ? `${"- ".repeat(Math.max(0, node.level - 1))}${cleanText(node.collection.name || "")}` : cleanText(node.collection.name || ""),
				depth: node.level || 1,
			}))
			.sort((left, right) => {
				let rankCompare = workflowCollectionRank(left?.collection_name) - workflowCollectionRank(right?.collection_name);
				if (rankCompare) {
					return rankCompare;
				}
				return String(left.label || "").localeCompare(String(right.label || ""), undefined, { sensitivity: "base", numeric: true });
			});
	}

	function extractionValueColumnKey(fieldKey = "") {
		let normalized = optionalString(fieldKey);
		return normalized ? `${EXTRACTION_VALUE_PREFIX}${normalized}` : "";
	}

	function extractionMetadataColumnKey(fieldKey = "", metadataKey = "") {
		let normalizedField = optionalString(fieldKey);
		let normalizedMeta = optionalString(metadataKey);
		return normalizedField && normalizedMeta
			? `${EXTRACTION_METADATA_PREFIX}${normalizedField}:${normalizedMeta}`
			: "";
	}

	function parseExtractionColumnKey(columnKey = "") {
		let normalized = optionalString(columnKey);
		if (!normalized) {
			return null;
		}
		if (normalized.startsWith(EXTRACTION_VALUE_PREFIX)) {
			let fieldKey = optionalString(normalized.slice(EXTRACTION_VALUE_PREFIX.length));
			return fieldKey
				? {
					kind: "value",
					field_key: fieldKey,
					column_key: normalized,
				}
				: null;
		}
		if (!normalized.startsWith(EXTRACTION_METADATA_PREFIX)) {
			return null;
		}
		let body = normalized.slice(EXTRACTION_METADATA_PREFIX.length);
		let separator = body.indexOf(":");
		if (separator <= 0) {
			return null;
		}
		let fieldKey = optionalString(body.slice(0, separator));
		let metadataKey = optionalString(body.slice(separator + 1));
		return fieldKey && metadataKey
			? {
				kind: "metadata",
				field_key: fieldKey,
				metadata_key: metadataKey,
				column_key: normalized,
			}
			: null;
	}

	function extractionSourceLabel(sourceKey = "") {
		let normalized = optionalString(sourceKey).toLowerCase();
		if (normalized == "title_abstract") {
			return "Title + Abstract";
		}
		if (normalized == "title") {
			return "Title";
		}
		if (normalized == "abstract_note") {
			return "Abstract";
		}
		if (normalized == "full_text") {
			return "Full Text";
		}
		if (normalized.startsWith("extraction:")) {
			return `Extraction: ${normalized.slice("extraction:".length).replace(/_/g, " ")}`;
		}
		return normalized ? normalized.replace(/_/g, " ") : "";
	}

	function builtinColumnDefinitions() {
		return [
			{ key: "citation_text", label: "Citation", type: "text", group: "Default", editable: false, visible: true },
			{ key: "title", label: "Title", type: "text", group: "Default", editable: false, visible: true },
			{ key: "abstract_note", label: "Abstract", type: "text", group: "Default", editable: false, visible: true },
			{ key: "comments", label: "Comments", type: "text", group: "Manual", editable: true, visible: true },
			{ key: "reason", label: "Reason", type: "text", group: "Decisions", editable: true, visible: false },
			{ key: "year", label: "Year", type: "number", group: "Metadata", editable: false, visible: false },
			{ key: "doi", label: "DOI", type: "text", group: "Metadata", editable: false, visible: false },
			{ key: "pmid", label: "PMID", type: "text", group: "Metadata", editable: false, visible: false },
			{ key: "openalex_id", label: "OpenAlex", type: "text", group: "Metadata", editable: false, visible: false },
			{ key: "abstract_origin", label: "Abstract origin", type: "text", group: "Metadata", editable: false, visible: false },
			{ key: "updated_at", label: "Last updated", type: "text", group: "Metadata", editable: false, visible: false },
			{ key: "item_key", label: "Item key", type: "text", group: "Metadata", editable: false, visible: false },
			{ key: "decision_target_collection_name", label: "Current location", type: "text", group: "Decisions", editable: false, visible: false },
			{ key: "decision_source_type", label: "Decision source", type: "text", group: "Decisions", editable: false, visible: false },
			{ key: "decision_source_detail", label: "Decision detail", type: "text", group: "Decisions", editable: false, visible: false },
			{ key: "decision_updated_at", label: "Decision updated", type: "text", group: "Decisions", editable: false, visible: false },
		];
	}

	function exportModeValue(payload = {}) {
		let raw = optionalString(payload.export_mode || payload.exportMode || "current_view").toLowerCase();
		return raw == "all_columns" ? "all_columns" : "current_view";
	}

	function exportScopeModeValue(payload = {}) {
		let raw = optionalString(payload.scope_mode || payload.scopeMode || "").toLowerCase();
		return raw == "all" ? "all" : "single";
	}

	function exportAllColumnDefinitions(columns = []) {
		let builtins = builtinColumnDefinitions().map((column) => ({
			key: optionalString(column?.key),
			label: cleanText(column?.label || column?.key || ""),
			type: optionalString(column?.type || "text") || "text",
			column_key: "",
		}));
		let customs = (columns || []).map((column) => ({
			key: optionalString(column?.key || column?.column_key),
			label: cleanText(column?.label || column?.key || column?.column_key || ""),
			type: optionalString(column?.type || "text") || "text",
			column_key: optionalString(column?.column_key || column?.key),
		}));
		return builtins.concat(customs).filter((column) => !!column.key);
	}

	async function currentViewExportColumnKeys(reviewer, context, payload = {}, allColumns = []) {
		let explicit = Array.isArray(payload.visible_columns)
			? payload.visible_columns
			: (Array.isArray(payload.visibleColumns) ? payload.visibleColumns : null);
		let stored = explicit && explicit.length
			? explicit
			: await getPreference(reviewer, context, "visible_columns", null);
		let requested = Array.isArray(stored) && stored.length
			? stored
			: allColumns.filter((column) => column?.visible !== false).map((column) => column?.key || column?.column_key || "");
		let allowed = new Set(allColumns.map((column) => optionalString(column?.key || column?.column_key)).filter(Boolean));
		let out = [];
		let seen = new Set();
		for (let entry of requested || []) {
			let key = optionalString(entry);
			if (!key || seen.has(key) || !allowed.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(key);
		}
		return out;
	}

	async function exportColumnDefinitions(reviewer, context, payload = {}, columns = []) {
		let allColumns = exportAllColumnDefinitions(columns);
		let mode = exportModeValue(payload);
		let defs = [];
		if (mode == "all_columns") {
			defs = allColumns;
		}
		else {
			let currentKeys = await currentViewExportColumnKeys(reviewer, context, payload, builtinColumnDefinitions().concat(
				(columns || []).map((column) => ({
					key: optionalString(column?.column_key),
					label: cleanText(column?.label || column?.column_key || ""),
					type: optionalString(column?.type || "text") || "text",
					visible: false,
					column_key: optionalString(column?.column_key),
				}))
			));
			let byKey = new Map(allColumns.map((column) => [optionalString(column.key), column]));
			defs = currentKeys.map((key) => byKey.get(optionalString(key))).filter(Boolean);
		}
		return [{
			key: "__scope__",
			label: "Scope",
			type: "text",
			column_key: "",
		}].concat(defs);
	}

	function resolveExportScopeEntries(reviewer, current, payload = {}) {
		let scopes = availableScopes(reviewer, current);
		if (!scopes.length) {
			throw new Error("No Screening scopes are available to export.");
		}
		if (exportScopeModeValue(payload) == "all") {
			return scopes;
		}
		let requested = optionalString(
			payload.collection_key
			?? payload.collectionKey
			?? payload.scope_collection_key
			?? payload.scopeCollectionKey
		);
		if (requested) {
			let match = scopes.find((entry) => optionalString(entry?.collection_key) == requested) || null;
			if (!match) {
				throw new Error("Requested Screening export scope was not found inside the current project collection tree.");
			}
			return [match];
		}
		let fallback = resolvedScopeSpec(reviewer, current, payload);
		if (fallback?.collection_key) {
			let match = scopes.find((entry) => optionalString(entry?.collection_key) == optionalString(fallback.collection_key)) || null;
			if (match) {
				return [match];
			}
		}
		return [scopes[0]];
	}

	function exportPayloadForScope(payload = {}, scopeEntry = null) {
		let next = Object.assign({}, payload || {});
		delete next.scope_mode;
		delete next.scopeMode;
		delete next.collection_name;
		delete next.collectionName;
		delete next.scope_collection_name;
		delete next.scopeCollectionName;
		next.collection_key = optionalString(scopeEntry?.collection_key);
		return next;
	}

	function exportRowCellValue(record = {}, column = {}, scopeEntry = null) {
		let key = optionalString(column?.key);
		if (!key) {
			return "";
		}
		if (key == "__scope__") {
			return cleanText(scopeEntry?.collection_name || scopeEntry?.label || scopeEntry?.collection_key || "");
		}
		return recordValue(record, key);
	}

	function exportCSVLine(record = {}, columns = [], scopeEntry = null) {
		return (columns || []).map((column) =>
			csvEscape(exportRowCellValue(record, column, scopeEntry))
		).join(",");
	}

	async function filterRows(reviewer, context) {
		await ensureSchema(reviewer, context);
		return await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				filter_id,
				name,
				query_text,
				decision_filter,
				source_scope,
				source_collection_key,
				source_collection_name,
				COALESCE(column_key, '') AS column_key,
				COALESCE(operator, '') AS operator,
				COALESCE(match_value, '') AS match_value,
				COALESCE(match_mode, 'and') AS match_mode,
				COALESCE(rules_json, '[]') AS rules_json,
				COALESCE(tracking_column_key, '') AS tracking_column_key,
				COALESCE(tracking_column_label, '') AS tracking_column_label,
				materialized_collection_key,
				materialized_collection_name,
				created_at,
				updated_at,
				last_materialized_at
			 FROM screening_filters
			 ORDER BY updated_at DESC, name COLLATE NOCASE ASC`
		);
	}

	async function listMaterializedFilters(reviewer, current) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let rows = await filterRows(reviewer, context);
		let collectionsByKey = new Map();
		for (let node of reviewer?._projectCollectionNodes?.(current.collection) || []) {
			if (node?.collection?.key) {
				collectionsByKey.set(String(node.collection.key), node.collection);
			}
		}
		return (rows || []).map((row) => {
			let collectionKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "materialized_collection_key") || "");
			let collectionName = cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "materialized_collection_name") || "");
			let collection = collectionKey ? collectionsByKey.get(collectionKey) || null : null;
			let fallbackRule = {
				column_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || ""),
				operator: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "operator") || ""),
				match_value: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "match_value") || ""),
			};
			return {
				filter_id: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "filter_id") || ""),
				name: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "name") || ""),
				query: cleanBlockText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "query_text") || ""),
				decision_filter: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "decision_filter") || ""),
				source_scope: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_scope") || ""),
				source_collection_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_collection_key") || ""),
				source_collection_name: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_collection_name") || ""),
				column_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || ""),
				operator: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "operator") || ""),
				match_value: cleanBlockText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "match_value") || ""),
				match_mode: normalizeMatchMode(SystematicReviewerWorkflowEmbeddings.rowValue(row, "match_mode") || "and"),
				rules: parseStoredActionRules(SystematicReviewerWorkflowEmbeddings.rowValue(row, "rules_json") || "[]", fallbackRule),
				tracking_column_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "tracking_column_key") || ""),
				tracking_column_label: cleanText(SystematicReviewerWorkflowEmbeddings.rowValue(row, "tracking_column_label") || ""),
				collection_key: collectionKey,
				collection_name: cleanText(collection?.name || collectionName),
				exists_in_zotero: !!collection,
				item_count: collection ? collectionRecordCount(collection) : 0,
				created_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at") || ""),
				updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
				last_materialized_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "last_materialized_at") || ""),
			};
		});
	}

	async function columnValueMap(reviewer, context, options = {}) {
		await ensureSchema(reviewer, context);
		let itemKeys = Array.isArray(options.itemKeys)
			? Array.from(new Set(options.itemKeys.map((value) => optionalString(value)).filter(Boolean)))
			: [];
		let columnKeys = Array.isArray(options.columnKeys)
			? Array.from(new Set(options.columnKeys.map((value) => optionalString(value)).filter(Boolean)))
			: [];
		let out = new Map();
		let manualColumnKeys = columnKeys.filter((columnKey) => !parseExtractionColumnKey(columnKey));
		let extractionSpecs = columnKeys
			.map((columnKey) => parseExtractionColumnKey(columnKey))
			.filter(Boolean);
		let itemBatches = itemKeys.length ? chunkArray(itemKeys, BATCH_WRITE_SIZE) : [null];
		let columnBatches = manualColumnKeys.length > BATCH_WRITE_SIZE
			? chunkArray(manualColumnKeys, BATCH_WRITE_SIZE)
			: [manualColumnKeys];
		for (let itemBatch of itemBatches) {
			for (let columnBatch of columnBatches) {
				if (!Array.isArray(columnBatch) || !columnBatch.length) {
					continue;
				}
				let where = [];
				let params = [];
				if (Array.isArray(itemBatch) && itemBatch.length) {
					where.push(`item_key IN (${itemBatch.map(() => "?").join(", ")})`);
					params.push(...itemBatch);
				}
				if (Array.isArray(columnBatch) && columnBatch.length) {
					where.push(`column_key IN (${columnBatch.map(() => "?").join(", ")})`);
					params.push(...columnBatch);
				}
				let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
					reviewer,
					context,
					`SELECT item_key, column_key, COALESCE(value_text, '') AS value_text, updated_at
					 FROM screening_column_values
					 ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
					 ORDER BY updated_at DESC, item_key ASC, column_key ASC`,
					params
				);
				for (let row of rows || []) {
					let itemKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key") || "");
					let columnKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || "");
					out.set(`${itemKey}::${columnKey}`, {
						item_key: itemKey,
						column_key: columnKey,
						value_text: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text") || ""),
						updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
					});
				}
			}
		}
		if (!extractionSpecs.length) {
			return out;
		}
		await SystematicReviewerWorkflowExtraction.ensureSchema(reviewer, context);
		let requestedFieldKeys = Array.from(new Set(extractionSpecs.map((spec) => optionalString(spec?.field_key)).filter(Boolean)));
		let specsByFieldKey = new Map();
		for (let spec of extractionSpecs) {
			let fieldKey = optionalString(spec?.field_key);
			if (!fieldKey) {
				continue;
			}
			if (!specsByFieldKey.has(fieldKey)) {
				specsByFieldKey.set(fieldKey, []);
			}
			specsByFieldKey.get(fieldKey).push(spec);
		}
		let fieldBatches = requestedFieldKeys.length > BATCH_WRITE_SIZE
			? chunkArray(requestedFieldKeys, BATCH_WRITE_SIZE)
			: [requestedFieldKeys];
		for (let itemBatch of itemBatches) {
			for (let fieldBatch of fieldBatches) {
				if (!Array.isArray(fieldBatch) || !fieldBatch.length) {
					continue;
				}
				let where = [];
				let params = [];
				if (Array.isArray(itemBatch) && itemBatch.length) {
					where.push(`item_key IN (${itemBatch.map(() => "?").join(", ")})`);
					params.push(...itemBatch);
				}
				where.push(`field_key IN (${fieldBatch.map(() => "?").join(", ")})`);
				params.push(...fieldBatch);
				let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
					reviewer,
					context,
					`SELECT
						item_key,
						field_key,
						template_path,
						template_name,
						source_key,
						COALESCE(value_text, '') AS value_text,
						COALESCE(status, '') AS status,
						COALESCE(error_message, '') AS error_message,
						COALESCE(model, '') AS model,
						COALESCE(run_id, '') AS run_id,
						created_at,
						updated_at
					 FROM extraction_values
					 WHERE ${where.join(" AND ")}
					 ORDER BY updated_at DESC, item_key ASC, field_key ASC`,
					params
				);
				let latestByFieldItem = new Map();
				for (let row of rows || []) {
					let itemKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key"));
					let fieldKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_key"));
					let dedupeKey = `${itemKey}::${fieldKey}`;
					if (!itemKey || !fieldKey || latestByFieldItem.has(dedupeKey)) {
						continue;
					}
					latestByFieldItem.set(dedupeKey, {
						item_key: itemKey,
						field_key: fieldKey,
						template_path: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_path")),
						template_name: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_name")),
						source_key: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_key")),
						value_text: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text") || ""),
						status: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "status")),
						error_message: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "error_message") || ""),
						model: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "model")),
						run_id: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "run_id")),
						created_at: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at")),
						updated_at: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at")),
					});
				}
				for (let row of latestByFieldItem.values()) {
					for (let spec of specsByFieldKey.get(row.field_key) || []) {
						let valueText = "";
						if (spec.kind == "value") {
							valueText = row.value_text;
						}
						else if (spec.kind == "metadata") {
							if (spec.metadata_key == "template_name") {
								valueText = row.template_name;
							}
							else if (spec.metadata_key == "template_path") {
								valueText = row.template_path;
							}
							else if (spec.metadata_key == "source_key") {
								valueText = extractionSourceLabel(row.source_key);
							}
							else if (spec.metadata_key == "status") {
								valueText = row.status;
							}
							else if (spec.metadata_key == "error_message") {
								valueText = row.error_message;
							}
							else if (spec.metadata_key == "model") {
								valueText = row.model;
							}
							else if (spec.metadata_key == "run_id") {
								valueText = row.run_id;
							}
							else if (spec.metadata_key == "created_at") {
								valueText = row.created_at;
							}
							else if (spec.metadata_key == "updated_at") {
								valueText = row.updated_at;
							}
						}
						out.set(`${row.item_key}::${spec.column_key}`, {
							item_key: row.item_key,
							column_key: spec.column_key,
							value_text: String(valueText || ""),
							updated_at: row.updated_at,
						});
					}
				}
			}
		}
		return out;
	}

	function summarize(records = []) {
		let summary = {
			total_records: records.length,
			included_count: 0,
			excluded_count: 0,
			maybe_count: 0,
			reviewed_count: 0,
			pending_count: 0,
		};
		for (let record of records) {
			let decision = String(record.decision || "");
			if (decision == "include") {
				summary.included_count += 1;
				summary.reviewed_count += 1;
			}
			else if (decision == "exclude") {
				summary.excluded_count += 1;
				summary.reviewed_count += 1;
			}
			else if (decision == "maybe") {
				summary.maybe_count += 1;
				summary.reviewed_count += 1;
			}
			else {
				summary.pending_count += 1;
			}
		}
		return summary;
	}

	function recordValue(record, key) {
		let field = optionalString(key);
		if (!field) {
			return "";
		}
		if (field == "comments") {
			return optionalString(record.notes);
		}
		if (Object.prototype.hasOwnProperty.call(record, field)) {
			return optionalString(record[field]);
		}
		if (record.custom_values && Object.prototype.hasOwnProperty.call(record.custom_values, field)) {
			return optionalString(record.custom_values[field]);
		}
		return "";
	}

	function tableFromDatabaseVirtualColumnDefinition() {
		return {
			key: TABLE_FROM_DATABASE_CITATION_COLUMN_KEY,
			column_key: TABLE_FROM_DATABASE_CITATION_COLUMN_KEY,
			label: "Citation",
			type: "text",
			group: "Default",
			editable: false,
			visible: true,
			origin: "virtual",
		};
	}

	function normalizeTableColumnKeys(payload = {}) {
		let raw = payload?.columns
			?? payload?.column_keys
			?? payload?.columnKeys
			?? payload?.column_order
			?? payload?.columnOrder
			?? [];
		if (typeof raw == "string") {
			raw = raw
				.split(/[\n,|]+/)
				.map((entry) => optionalString(entry))
				.filter(Boolean);
		}
		if (!Array.isArray(raw)) {
			raw = [];
		}
		let out = [];
		let seen = new Set();
		for (let entry of raw) {
			let key = optionalString(
				typeof entry == "string"
					? entry
					: (entry?.column_key || entry?.columnKey || entry?.key || entry?.id || "")
			);
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(key);
		}
		return out;
	}

	function includeCitationMarkdownColumn(payload = {}) {
		if (payload?.include_citation_column === false || payload?.includeCitationColumn === false) {
			return false;
		}
		return true;
	}

	function markdownTableCellText(value = "") {
		return String(value || "")
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => cleanBlockText(line))
			.join("<br />")
			.replace(/\\/g, "\\\\")
			.replace(/\|/g, "\\|");
	}

	function markdownTableFromRows(columns = [], rows = []) {
		if (!Array.isArray(columns) || !columns.length) {
			return "";
		}
		let header = `| ${columns.map((column) => markdownTableCellText(column?.label || column?.key || "")).join(" | ")} |`;
		let align = `| ${columns.map(() => "---").join(" | ")} |`;
		let lines = [header, align];
		for (let row of rows || []) {
			lines.push(`| ${row.map((cell) => markdownTableCellText(cell)).join(" | ")} |`);
		}
		return `${lines.join("\n")}\n`;
	}

	async function tableFromDatabase({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let selectedColumns = normalizeTableColumnKeys(payload || {});
		if (includeCitationMarkdownColumn(payload) && !selectedColumns.includes(TABLE_FROM_DATABASE_CITATION_COLUMN_KEY)) {
			selectedColumns.unshift(TABLE_FROM_DATABASE_CITATION_COLUMN_KEY);
		}
		if (!selectedColumns.length) {
			throw new Error("At least one table column is required.");
		}
		let dynamicColumns = await listDynamicColumnCatalog(reviewer, context);
		let availableColumns = builtinColumnDefinitions()
			.concat(dynamicColumns || [])
			.concat([tableFromDatabaseVirtualColumnDefinition()]);
		let availableByKey = new Map(
			availableColumns.map((column) => [optionalString(column?.column_key || column?.key), column]).filter(([key]) => !!key)
		);
		for (let columnKey of selectedColumns) {
			if (!availableByKey.has(columnKey)) {
				throw new Error(`Unknown screening column: ${columnKey}`);
			}
		}
		let matchedRecords = [];
		let scan = await scanScopedRecords(reviewer, current, payload || {}, {
			columns: dynamicColumns,
			onBatch: async (records = []) => {
				matchedRecords.push(...(records || []).map((record) => Object.assign({}, record, {
					custom_values: Object.assign({}, record?.custom_values || {}),
				})));
			},
		});
		let filteredRecords = filterRecords(matchedRecords, payload || {});
		let dataColumns = dynamicColumns.filter((column) => selectedColumns.includes(optionalString(column?.column_key || column?.key)));
		let hydrated = await hydratePageRecords(reviewer, current, filteredRecords, dataColumns, {
			ensureIdentities: true,
		});
		let resolvedColumns = selectedColumns.map((columnKey) => {
			let meta = availableByKey.get(columnKey) || {};
			return {
				key: columnKey,
				column_key: columnKey,
				label: cleanText(meta?.label || meta?.key || columnKey),
				type: optionalString(meta?.type || "text") || "text",
				group: cleanText(meta?.group || ""),
				origin: optionalString(meta?.origin || ""),
			};
		});
		let rows = hydrated.map((record) => resolvedColumns.map((column) => {
			if (column.key == TABLE_FROM_DATABASE_CITATION_COLUMN_KEY) {
				let itemKey = optionalString(record?.item_key);
				return itemKey ? `@[${itemKey}]` : "";
			}
			return recordValue(record, column.key);
		}));
		return {
			ok: true,
			scope: scan.scope,
			row_count: hydrated.length,
			columns: resolvedColumns,
			markdown: markdownTableFromRows(resolvedColumns, rows),
		};
	}

	function operatorMatches(value, operator, matchValue) {
		let leftText = optionalString(value);
		let rightText = optionalString(matchValue);
		let leftLower = leftText.toLowerCase();
		let rightLower = rightText.toLowerCase();
		if (operator == "empty") {
			return !leftText;
		}
		if (operator == "not_empty") {
			return !!leftText;
		}
		if (operator == "contains") {
			return !!rightLower && leftLower.includes(rightLower);
		}
		if (operator == "not_contains") {
			return !!rightLower && !leftLower.includes(rightLower);
		}
		if (operator == "equals") {
			return leftLower == rightLower;
		}
		if (operator == "not_equals") {
			return leftLower != rightLower;
		}
		let leftNumber = asNumber(leftText);
		let rightNumber = asNumber(rightText);
		if (leftNumber === null || rightNumber === null) {
			return false;
		}
		if (operator == "gt") {
			return leftNumber > rightNumber;
		}
		if (operator == "gte") {
			return leftNumber >= rightNumber;
		}
		if (operator == "lt") {
			return leftNumber < rightNumber;
		}
		if (operator == "lte") {
			return leftNumber <= rightNumber;
		}
		return false;
	}

	function recordMatchesFilters(record, payload = {}) {
		let query = String(payload.query || "").trim().toLowerCase();
		let decisionFilter = normalizeDecisionFilter(payload.decision || payload.decision_filter || payload.decisionFilter || "");
		if (query) {
			let customValues = Object.values(record.custom_values || {}).join("\n");
			let haystack = [
				record.item_key,
				record.citation_text,
				record.title,
				record.abstract_note,
				record.reason,
				record.notes,
				record.doi,
				record.pmid,
				record.openalex_id,
				record.year,
				record.decision_target_collection_name,
				record.decision_source_type,
				record.decision_source_detail,
				customValues,
			].filter(Boolean).join("\n").toLowerCase();
			if (!haystack.includes(query)) {
				return false;
			}
		}
		if (decisionFilter !== null && String(record.decision || "") != decisionFilter) {
			return false;
		}
		return true;
	}

	function compareRecords(left, right, payload = {}) {
		let sortBy = normalizeSortKey(payload.sort_by || payload.sortBy || "item_key");
		let order = normalizeOrder(payload.order || "asc");
		let leftValue = recordValue(left, sortBy);
		let rightValue = recordValue(right, sortBy);
		let textOnlySort = sortBy == "citation_text" || sortBy == "item_key";
		if (textOnlySort) {
			leftValue = cleanBlockText(leftValue || left?.title || left?.item_key || "");
			rightValue = cleanBlockText(rightValue || right?.title || right?.item_key || "");
		}
		let leftNumber = textOnlySort ? null : asNumber(leftValue);
		let rightNumber = textOnlySort ? null : asNumber(rightValue);
		let compare = 0;
		if (leftNumber !== null && rightNumber !== null) {
			compare = leftNumber - rightNumber;
		}
		else {
			compare = String(leftValue || "").localeCompare(String(rightValue || ""), undefined, { numeric: true, sensitivity: "base" });
		}
		if (!compare) {
			compare = String(left.title || "").localeCompare(String(right.title || ""), undefined, { numeric: true, sensitivity: "base" })
				|| String(left.item_key || "").localeCompare(String(right.item_key || ""), undefined, { numeric: true, sensitivity: "base" });
		}
		return order == "desc" ? compare * -1 : compare;
	}

	async function mergedState(reviewer, current, payload = {}, options = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let columns = Array.isArray(options.columns) ? options.columns : await listDynamicColumnCatalog(reviewer, context);
		let requirements = mergedStateRequirements(columns, payload, options);
		let recordRows = await collectionRecords(reviewer, current, payload, {
			itemKeys: Array.isArray(options.itemKeys) ? options.itemKeys : null,
			includeAbstracts: requirements.includeAbstracts,
		});
		let itemKeys = recordRows.map((row) => row.item_key);
		let decisions = await decisionsMap(reviewer, context, { itemKeys });
		let rules = Array.isArray(options.rules) ? options.rules : await listRules(reviewer, context);
		let values = requirements.customColumnKeys.length
			? await columnValueMap(reviewer, context, {
				itemKeys,
				columnKeys: requirements.customColumnKeys,
			})
			: new Map();
		let reviewStates = options.reviewStates instanceof Map
			? options.reviewStates
			: await reviewStateByItemKey(reviewer, current, { itemKeys });
		let records = recordRows.map((row) => {
			let overlay = decisions.get(String(row.item_key || "")) || null;
			let item = options.includeAttachments ? recordItem(current, row.item_key) : null;
			let attachments = options.includeAttachments ? attachmentSummaryForItem(reviewer, item) : null;
			let reviewState = reviewStates.get(String(row.item_key || "")) || pendingReviewState();
			let customValues = {};
			for (let column of columns) {
				if (!requirements.customColumnKeys.includes(column.column_key)) {
					continue;
				}
				let cell = values.get(`${row.item_key}::${column.column_key}`) || null;
				customValues[column.column_key] = cleanBlockText(cell?.value_text || "");
			}
			return Object.assign({}, row, {
				decision: reviewState.decision,
				review_stage: reviewState.review_stage,
				review_collection_key: reviewState.review_collection_key,
				review_collection_name: reviewState.review_collection_name,
				decision_target_collection_key: String(overlay?.target_collection_key || reviewState.review_collection_key || ""),
				decision_target_collection_name: cleanText(overlay?.target_collection_name || reviewState.review_collection_name || ""),
				decision_source_type: cleanText(overlay?.source_type || ""),
				decision_source_detail: cleanBlockText(overlay?.source_detail || ""),
				decision_updated_at: String(overlay?.updated_at || ""),
				reason: cleanBlockText(overlay?.reason || ""),
				notes: cleanBlockText(overlay?.notes || ""),
				comments: cleanBlockText(overlay?.notes || ""),
				abstract_preview: previewText(row.abstract_note),
				custom_values: customValues,
				attachments: attachments || {
					attachment_count: 0,
					pdf_count: 0,
					has_pdf: false,
					pdf_attachment_key: "",
					pdf_attachment_title: "",
					pdf_attachment_id: null,
					has_markdown: false,
					markdown_attachment_key: "",
					markdown_attachment_title: "",
					has_full_text: false,
				},
			});
		});
		return {
			records,
			columns,
			rules,
			scope: scopeDescriptor(reviewer, current, payload),
		};
	}

	async function hydratePageRecords(reviewer, current, records = [], columns = [], options = {}) {
		let context = current?.context;
		if (!context || !Array.isArray(records) || !records.length) {
			return [];
		}
		let itemKeys = Array.from(new Set(records.map((record) => optionalString(record?.item_key)).filter(Boolean)));
		let items = itemKeys
			.map((itemKey) => [itemKey, recordItem(current, itemKey)])
			.filter(([, item]) => !!item)
			.map((entry) => entry[1]);
		let ensureIdentities = !!options.ensureIdentities;
		let identityByItemKey = ensureIdentities && typeof reviewer?._ensureProjectItemIdentities == "function"
			? await reviewer._ensureProjectItemIdentities(context, items)
			: await scopedIdentityMap(reviewer, current, itemKeys);
		let fallbackByItemKey = await fallbackRecordMap(
			reviewer,
			current,
			itemKeys.filter((itemKey) => !identityByItemKey.has(itemKey)),
			{ includeAbstracts: true }
		);
		let pageValues = await columnValueMap(reviewer, context, {
			itemKeys,
			columnKeys: columns.map((column) => optionalString(column?.column_key)).filter(Boolean),
		});
		let attachmentSummaryByItemKey = new Map(
			await Promise.all(itemKeys.map(async (itemKey) => {
				let item = recordItem(current, itemKey);
				return [itemKey, await fullTextSummaryForItem(reviewer, item)];
			}))
		);
		let recordsByKey = new Map(records.map((record) => [optionalString(record?.item_key), record]));
		let out = [];
		for (let itemKey of itemKeys) {
			let item = recordItem(current, itemKey);
			let record = recordsByKey.get(itemKey) || null;
			if (!item || !record) {
				continue;
			}
			let identity = identityByItemKey.get(itemKey) || null;
			let fallback = fallbackByItemKey.get(itemKey) || null;
			let title = cleanBlockText(identity?.title || fallback?.title || itemTextField(reviewer, item, "title"));
			let abstractNote = cleanBlockText(identity?.abstract_note || fallback?.abstract_note || itemTextField(reviewer, item, "abstractNote"));
			let year = cleanText(identity?.year || fallback?.year || reviewer?._extractYear?.(itemTextField(reviewer, item, "date")) || record.year || "");
			let customValues = Object.assign({}, record.custom_values || {});
			for (let column of columns || []) {
				let cell = pageValues.get(`${itemKey}::${column.column_key}`) || null;
				if (cell) {
					customValues[column.column_key] = cleanBlockText(cell.value_text || "");
				}
			}
			out.push(Object.assign({}, record, {
				citation_text: cleanBlockText(identity?.citation_text || record.citation_text || ""),
				paper_id: cleanText(identity?.paper_id || fallback?.paper_id || record.paper_id || ""),
				openalex_id: cleanText(identity?.openalex_id || fallback?.openalex_id || record.openalex_id || ""),
				title,
				abstract_note: abstractNote,
				abstract_origin: cleanText(identity?.abstract_origin || (abstractNote ? "Zotero" : "")),
				year,
				doi: cleanText(identity?.doi || fallback?.doi || itemTextField(reviewer, item, "DOI") || record.doi || ""),
				pmid: cleanText(identity?.pmid || fallback?.pmid || itemTextField(reviewer, item, "PMID") || record.pmid || ""),
				zotero_uri: cleanText(fallback?.zotero_uri || (Zotero.URI?.getItemURI ? Zotero.URI.getItemURI(item) : record.zotero_uri || "")),
				updated_at: cleanText(identity?.updated_at || record.updated_at || ""),
				abstract_preview: previewText(abstractNote),
				custom_values: customValues,
				attachments: attachmentSummaryByItemKey.get(itemKey) || attachmentSummaryForItem(reviewer, item),
			}));
		}
		return out;
	}

	async function hydrateExportRecords(reviewer, current, records = [], columns = []) {
		let context = current?.context;
		if (!context || !Array.isArray(records) || !records.length) {
			return [];
		}
		let customColumnKeys = (columns || [])
			.map((column) => optionalString(column?.column_key))
			.filter(Boolean);
		let itemKeys = Array.from(new Set(records.map((record) => optionalString(record?.item_key)).filter(Boolean)));
		let items = itemKeys
			.map((itemKey) => [itemKey, recordItem(current, itemKey)])
			.filter(([, item]) => !!item)
			.map((entry) => entry[1]);
		let identityByItemKey = typeof reviewer?._ensureProjectItemIdentities == "function"
			? await reviewer._ensureProjectItemIdentities(context, items)
			: await scopedIdentityMap(reviewer, current, itemKeys);
		let fallbackByItemKey = await fallbackRecordMap(
			reviewer,
			current,
			itemKeys.filter((itemKey) => !identityByItemKey.has(itemKey)),
			{ includeAbstracts: true }
		);
		let pageValues = customColumnKeys.length
			? await columnValueMap(reviewer, context, {
				itemKeys,
				columnKeys: customColumnKeys,
			})
			: new Map();
		let recordsByKey = new Map(records.map((record) => [optionalString(record?.item_key), record]));
		let out = [];
		for (let itemKey of itemKeys) {
			let item = recordItem(current, itemKey);
			let record = recordsByKey.get(itemKey) || null;
			if (!item || !record) {
				continue;
			}
			let identity = identityByItemKey.get(itemKey) || null;
			let fallback = fallbackByItemKey.get(itemKey) || null;
			let title = cleanBlockText(identity?.title || fallback?.title || itemTextField(reviewer, item, "title"));
			let abstractNote = cleanBlockText(identity?.abstract_note || fallback?.abstract_note || itemTextField(reviewer, item, "abstractNote"));
			let year = cleanText(identity?.year || fallback?.year || reviewer?._extractYear?.(itemTextField(reviewer, item, "date")) || record.year || "");
			let customValues = Object.assign({}, record.custom_values || {});
			for (let column of columns || []) {
				let columnKey = optionalString(column?.column_key);
				if (!columnKey) {
					continue;
				}
				let cell = pageValues.get(`${itemKey}::${columnKey}`) || null;
				if (cell) {
					customValues[columnKey] = cleanBlockText(cell.value_text || "");
				}
			}
			out.push(Object.assign({}, record, {
				citation_text: cleanBlockText(identity?.citation_text || record.citation_text || ""),
				paper_id: cleanText(identity?.paper_id || fallback?.paper_id || record.paper_id || ""),
				openalex_id: cleanText(identity?.openalex_id || fallback?.openalex_id || record.openalex_id || ""),
				title,
				abstract_note: abstractNote,
				abstract_origin: cleanText(identity?.abstract_origin || (abstractNote ? "Zotero" : "")),
				year,
				doi: cleanText(identity?.doi || fallback?.doi || itemTextField(reviewer, item, "DOI") || record.doi || ""),
				pmid: cleanText(identity?.pmid || fallback?.pmid || itemTextField(reviewer, item, "PMID") || record.pmid || ""),
				zotero_uri: cleanText(fallback?.zotero_uri || (Zotero.URI?.getItemURI ? Zotero.URI.getItemURI(item) : record.zotero_uri || "")),
				updated_at: cleanText(identity?.updated_at || record.updated_at || ""),
				abstract_preview: previewText(abstractNote),
				custom_values: customValues,
			}));
		}
		return out;
	}

	function exportNeedsCitationText(columns = []) {
		return (columns || []).some((column) => optionalString(column?.key) == "citation_text");
	}

	async function prepareExportStageRecords(reviewer, current, records = [], columns = []) {
		let needsCitationText = exportNeedsCitationText(columns);
		if (!needsCitationText) {
			return records;
		}
		let itemKeys = uniqueItemKeys(records);
		let recordsByKey = new Map((records || []).map((record) => [optionalString(record?.item_key), record]));
		let items = itemKeys
			.map((itemKey) => recordItem(current, itemKey))
			.filter(Boolean);
		let identityByItemKey = await scopedIdentityMap(reviewer, current, itemKeys);
		let generatedCitationByItemKey = typeof reviewer?._renderItemCitationTextMap == "function"
			? reviewer._renderItemCitationTextMap(items.filter((item) => {
				let itemKey = optionalString(item?.key);
				let identity = identityByItemKey.get(itemKey) || null;
				let record = recordsByKey.get(itemKey) || null;
				return !cleanBlockText(identity?.citation_text || record?.citation_text || "");
			}))
			: new Map();
		return (records || []).map((record) => {
			let itemKey = optionalString(record?.item_key);
			let identity = identityByItemKey.get(itemKey) || null;
			return Object.assign({}, record, {
				citation_text: cleanBlockText(
					identity?.citation_text
					|| record?.citation_text
					|| generatedCitationByItemKey.get(itemKey)
					|| ""
				),
			});
		});
	}

	async function recordByItemKey(reviewer, current, payload = {}, itemKey = "") {
		let context = current?.context;
		let cleanKey = optionalString(itemKey);
		if (!context || !cleanKey) {
			return cleanKey ? { item_key: cleanKey } : null;
		}
		let columns = await listDynamicColumnCatalog(reviewer, context);
		let state = await mergedState(reviewer, current, payload, {
			columns,
			itemKeys: [cleanKey],
			includeAllCustomValues: true,
			includeAbstracts: true,
		});
		let hydrated = await hydratePageRecords(reviewer, current, state.records, columns, {
			ensureIdentities: true,
		});
		return hydrated.find((row) => String(row?.item_key || "") == cleanKey)
			|| state.records.find((row) => String(row?.item_key || "") == cleanKey)
			|| { item_key: cleanKey };
	}

	function filterRecords(records = [], payload = {}) {
		let filtered = records.filter((row) => recordMatchesFilters(row, payload));
		filtered.sort((left, right) => compareRecords(left, right, payload));
		return filtered;
	}

	async function scanScopedRecords(reviewer, current, payload = {}, options = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let scoped = scopedProjectItemKeys(reviewer, current, payload);
		let columns = Array.isArray(options.columns) ? options.columns : await listDynamicColumnCatalog(reviewer, context);
		let rules = Array.isArray(options.rules) ? options.rules : await listRules(reviewer, context);
		let onRecord = typeof options.onRecord == "function" ? options.onRecord : null;
		let onBatch = typeof options.onBatch == "function" ? options.onBatch : null;
		let scanned = 0;
		for (let itemKeyBatch of chunkArray(scoped.itemKeys, BATCH_WRITE_SIZE)) {
			let state = await mergedState(reviewer, current, payload, {
				itemKeys: itemKeyBatch,
				columns,
				rules,
			});
			let matchedRecords = state.records.filter((record) => recordMatchesFilters(record, payload));
			for (let record of matchedRecords) {
				if (onRecord) {
					await onRecord(record, {
						scanned,
						total: scoped.itemKeys.length,
						scope: scoped.scope,
						columns,
						rules,
					});
				}
			}
			scanned += itemKeyBatch.length;
			if (onBatch) {
				await onBatch(matchedRecords, {
					scanned,
					total: scoped.itemKeys.length,
					scope: scoped.scope,
					columns,
					rules,
				});
			}
		}
		return {
			itemKeys: scoped.itemKeys,
			scope: scoped.scope,
			columns,
			rules,
		};
	}

	async function listRecords({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let dynamicColumns = await listDynamicColumnCatalog(reviewer, context);
		let hasExplicitSortBy = Object.prototype.hasOwnProperty.call(payload || {}, "sort_by")
			|| Object.prototype.hasOwnProperty.call(payload || {}, "sortBy");
		let hasExplicitOrder = Object.prototype.hasOwnProperty.call(payload || {}, "order")
			|| Object.prototype.hasOwnProperty.call(payload || {}, "sort_order")
			|| Object.prototype.hasOwnProperty.call(payload || {}, "sortOrder");
		let storedSortBy = hasExplicitSortBy ? "" : optionalString(await getPreference(reviewer, context, "sort_by", ""));
		let storedOrder = hasExplicitOrder ? "" : optionalString(await getPreference(reviewer, context, "sort_order", ""));
		let sortBy = normalizeSortKey(payload.sort_by || payload.sortBy || storedSortBy || "item_key", "item_key");
		let order = normalizeOrder(payload.order || payload.sort_order || payload.sortOrder || storedOrder || "asc");
		let effectivePayload = Object.assign({}, payload || {}, {
			sort_by: sortBy,
			order,
		});
		let { records, columns, rules, scope } = await mergedState(reviewer, current, effectivePayload, {
			columns: dynamicColumns,
		});
		let filtered = filterRecords(records, effectivePayload);
		let limit = normalizeLimit(payload.limit);
		let page = normalizePage(payload.page);
		let offset = Object.prototype.hasOwnProperty.call(payload, "offset")
			? normalizeOffset(payload.offset)
			: (page - 1) * limit;
		let pageCount = Math.max(1, Math.ceil(filtered.length / limit) || 1);
		let currentPage = Math.min(pageCount, Math.floor(offset / limit) + 1);
		let summary = summarize(filtered);
		let builtinColumns = builtinColumnDefinitions();
		let allColumns = builtinColumns.concat(columns || []);
		let visibleColumns = await getPreference(reviewer, context, "visible_columns", null);
		let columnWidths = await getPreference(reviewer, context, "column_widths", {});
		let rowDisplayMode = normalizeRowDisplayMode(await getPreference(reviewer, context, "row_display_mode", "expanded"), "expanded");
		let gridZoomPercent = normalizeGridZoomPercent(await getPreference(reviewer, context, "grid_zoom_percent", 100), 100);
		let pageRecords = filtered.slice(offset, offset + limit);
		let pageColumnKeySet = new Set(
			(Array.isArray(visibleColumns) && visibleColumns.length
				? visibleColumns
				: allColumns.filter((column) => column?.visible !== false).map((column) => column?.key || column?.column_key || "")
			).map((entry) => optionalString(entry)).filter(Boolean)
		);
		let sortColumn = (columns || []).find((column) => optionalString(column?.key || column?.column_key) == sortBy) || null;
		let hydrationColumns = (columns || []).filter((column) => pageColumnKeySet.has(optionalString(column?.key || column?.column_key)));
		if (sortColumn && !hydrationColumns.includes(sortColumn)) {
			hydrationColumns.push(sortColumn);
		}
		let hydratedRecords = await hydratePageRecords(reviewer, current, pageRecords, hydrationColumns, {
			ensureIdentities: true,
		});
		let fieldOptions = uniqueBy(
			BASE_FIELD_KEYS.map(([key, label]) => ({ key, label }))
				.concat((columns || []).map((column) => ({
					key: optionalString(column?.key || column?.column_key),
					label: cleanText(column?.label || column?.key || column?.column_key || ""),
				}))),
			(entry) => optionalString(entry?.key)
		).filter((entry) => !!entry?.key);
		return {
			ok: true,
			query: String(payload.query || "").trim(),
			decision_filter: normalizeDecisionFilter(payload.decision || payload.decision_filter || payload.decisionFilter || ""),
			sort_by: sortBy,
			order,
			total_records: filtered.length,
			limit,
			offset,
			page: currentPage,
			page_count: pageCount,
			summary,
			scope,
			available_scopes: availableScopes(reviewer, current),
			decision_targets: availableDecisionTargets(reviewer, current),
			materialized_filters: await listMaterializedFilters(reviewer, current),
			columns,
			all_columns: allColumns,
			visible_columns: Array.isArray(visibleColumns) ? visibleColumns : null,
			column_widths: columnWidths && typeof columnWidths == "object" ? columnWidths : {},
			row_display_mode: rowDisplayMode,
			grid_zoom_percent: gridZoomPercent,
			rules,
			field_options: fieldOptions,
			records: hydratedRecords,
		};
	}

	async function listSavedRuns(reviewer, context) {
		let root = outputRoot(reviewer, context);
		if (!reviewer._pathExists(root)) {
			return [];
		}
		let files = listFiles(reviewer, root, (file) => file.isFile() && file.leafName.endsWith(".json"))
			.sort((a, b) => (b.lastModifiedTime || 0) - (a.lastModifiedTime || 0));
		let out = [];
		for (let file of files) {
			let parsed = await reviewer._readJSONFile(file.path);
			let result = parsed?.result && typeof parsed.result == "object" ? parsed.result : {};
			out.push({
				name: optionalString(parsed?.name) || file.leafName,
				saved_at: optionalString(parsed?.saved_at),
				query: optionalString(result?.query),
				decision_filter: optionalString(result?.decision_filter),
				total_records: Number(result?.total_records || 0) || 0,
				page: Number(result?.page || 1) || 1,
				limit: Number(result?.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT,
				entry: serializeFileEntry(file),
			});
		}
		return out;
	}

	function resolveSavedRunPath(reviewer, context, payload = {}) {
		let root = outputRoot(reviewer, context);
		let requestedPath = optionalString(payload.path);
		let requestedName = optionalString(payload.name);
		let resolvedPath = requestedPath || (requestedName ? reviewer._joinPath(root, requestedName) : "");
		if (!resolvedPath) {
			throw new Error("Provide a saved screening run path or file name.");
		}
		let prefix = root.endsWith("/") ? root : `${root}/`;
		if (resolvedPath != root && !resolvedPath.startsWith(prefix)) {
			throw new Error("Saved screening run must be inside the current project screening outputs folder.");
		}
		if (!reviewer._pathExists(resolvedPath)) {
			throw new Error("Saved screening run was not found.");
		}
		return resolvedPath;
	}

	async function loadSavedRun({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let path = resolveSavedRunPath(reviewer, context, payload);
		let parsed = await reviewer._readJSONFile(path);
		if (!parsed || typeof parsed != "object") {
			throw new Error("Saved screening run file is invalid.");
		}
		let entry = serializeFileEntry(reviewer._nsIFile(path));
		return {
			ok: true,
			name: optionalString(parsed.name) || entry.name,
			saved_at: optionalString(parsed.saved_at),
			path,
			entry,
			result: parsed.result && typeof parsed.result == "object" ? parsed.result : {},
		};
	}

	async function openItem({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("Provide an item key.");
		}
		let item = requireRecordItem(current, itemKey);
		let win = reviewer?._primaryWindow?.() || null;
		if (!win?.ZoteroPane?.selectItem) {
			throw new Error("Zotero item selection is unavailable in this window.");
		}
		await win.ZoteroPane.selectItem(item.id, {
			noTabSwitch: false,
			noWindowRestore: false,
		});
		try {
			win.focus();
		}
		catch (_error) {}
		return {
			ok: true,
			item_key: item.key || itemKey,
			item_id: item.id || null,
			title: optionalString(reviewer?._itemField?.(item, "title")),
			zotero_uri: optionalString(Zotero.URI?.getItemURI ? Zotero.URI.getItemURI(item) : ""),
		};
	}

	async function openPdf({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("Provide an item key.");
		}
		let item = requireRecordItem(current, itemKey);
		let { attachment, summary } = requirePdfAttachment(reviewer, item);
		let win = reviewer?._primaryWindow?.() || null;
		if (win?.ZoteroPane?.viewPDF) {
			await win.ZoteroPane.viewPDF(attachment.id);
		}
		else if (Zotero.Reader?.open) {
			await Zotero.Reader.open(attachment.id, null, {
				openInBackground: false,
				allowDuplicate: false,
				preventJumpback: false,
			});
		}
		else {
			throw new Error("Zotero PDF reader is unavailable in this window.");
		}
		try {
			win?.focus?.();
		}
		catch (_error) {}
		return {
			ok: true,
			item_key: item.key || itemKey,
			item_id: item.id || null,
			pdf_attachment_key: summary.pdf_attachment_key,
			pdf_attachment_id: summary.pdf_attachment_id,
			pdf_attachment_title: summary.pdf_attachment_title,
		};
	}

	async function openFullText({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("Provide an item key.");
		}
		let item = requireRecordItem(current, itemKey);
		let summary = attachmentSummaryForItem(reviewer, item);
		let markdownSource = null;
		if (SystematicReviewerWorkflowRAG?.preferredMarkdownSourceForItem) {
			try {
				markdownSource = await SystematicReviewerWorkflowRAG.preferredMarkdownSourceForItem(reviewer, item);
			}
			catch (error) {
				reviewer?.log?.(`screening open full-text markdown lookup failed for ${itemKey}: ${error}`);
			}
		}
			if (markdownSource?.attachment_key) {
				try {
					let viewerMode = reviewer._openAttachmentTextualViewerByKey
						? await reviewer._openAttachmentTextualViewerByKey({
							libraryID: context.libraryID,
							attachmentKey: markdownSource.attachment_key,
							parentItemKey: item.key || itemKey,
							title: `${optionalString(reviewer?._itemField?.(item, "title")) || itemKey} - Full Text Viewer`,
						})
						: "";
					if (!viewerMode && reviewer._openMarkdownViewerTab) {
						await reviewer._openMarkdownViewerTab(null, {
							libraryID: context.libraryID,
							attachmentKey: markdownSource.attachment_key,
							parentItemKey: item.key || itemKey,
							title: `${optionalString(reviewer?._itemField?.(item, "title")) || itemKey} - Markdown Viewer`,
						});
						viewerMode = "markdown";
					}
					if (!viewerMode) {
						throw new Error("The selected full-text attachment could not be opened.");
					}
					return {
						ok: true,
						item_key: item.key || itemKey,
						item_id: item.id || null,
						mode: viewerMode,
						markdown_attachment_key: optionalString(markdownSource.attachment_key),
						markdown_attachment_title: optionalString(markdownSource.title || markdownSource.relative_path || ""),
					pdf_attachment_key: summary.pdf_attachment_key,
					pdf_attachment_id: summary.pdf_attachment_id,
					pdf_attachment_title: summary.pdf_attachment_title,
				};
			}
			catch (error) {
				if (!summary.has_pdf) {
					throw error;
				}
				reviewer?.log?.(`screening open full-text markdown viewer fallback for ${itemKey}: ${error}`);
			}
		}
		if (summary.has_pdf) {
			let pdfResult = await openPdf({ reviewer, current, payload });
			return Object.assign({}, pdfResult, {
				mode: "pdf",
			});
		}
		throw new Error("No PDF or markdown full text is available for this item.");
	}

	function uniqueBy(items = [], keyFn) {
		let map = new Map();
		for (let item of items || []) {
			let key = keyFn(item);
			if (!key || map.has(key)) {
				continue;
			}
			map.set(key, item);
		}
		return Array.from(map.values());
	}

	function mergeComparedRecords(selectedRuns = []) {
		let combined = new Map();
		for (let run of selectedRuns) {
			let runName = optionalString(run.name) || "Saved screening run";
			let runPath = optionalString(run.path);
			let records = Array.isArray(run?.result?.records) ? run.result.records : [];
			for (let row of records) {
				let itemKey = optionalString(row?.item_key || row?.itemKey);
				if (!itemKey) {
					continue;
				}
				let existing = combined.get(itemKey) || null;
				if (!existing) {
					combined.set(itemKey, Object.assign({}, row, {
						matched_runs: [runName],
						matched_run_paths: runPath ? [runPath] : [],
						matched_run_count: 1,
					}));
					continue;
				}
				let names = new Set(Array.isArray(existing.matched_runs) ? existing.matched_runs : []);
				names.add(runName);
				let paths = new Set(Array.isArray(existing.matched_run_paths) ? existing.matched_run_paths : []);
				if (runPath) {
					paths.add(runPath);
				}
				let merged = Object.assign({}, existing, {
					custom_values: Object.assign({}, existing.custom_values || {}, row.custom_values || {}),
					matched_runs: Array.from(names),
					matched_run_paths: Array.from(paths),
					matched_run_count: names.size,
				});
				if (String(row.updated_at || "") > String(existing.updated_at || "")) {
					merged.updated_at = row.updated_at;
				}
				if (String(row.decision_updated_at || "") > String(existing.decision_updated_at || "")) {
					merged.decision = row.decision;
					merged.reason = row.reason;
					merged.notes = row.notes;
					merged.decision_updated_at = row.decision_updated_at;
				}
				combined.set(itemKey, merged);
			}
		}
		return Array.from(combined.values()).sort((left, right) =>
			Number(right.matched_run_count || 0) - Number(left.matched_run_count || 0)
			|| String(left.title || "").localeCompare(String(right.title || ""))
			|| String(left.item_key || "").localeCompare(String(right.item_key || ""))
		);
	}

	function unionColumns(results = []) {
		let items = [];
		for (let result of results) {
			items.push(...(Array.isArray(result?.columns) ? result.columns : []));
		}
		return uniqueBy(items, (entry) => optionalString(entry?.column_key));
	}

	function unionRules(results = []) {
		let items = [];
		for (let result of results) {
			items.push(...(Array.isArray(result?.rules) ? result.rules : []));
		}
		return uniqueBy(items, (entry) => optionalString(entry?.rule_id));
	}

	function unionFieldOptions(results = []) {
		let items = [];
		for (let result of results) {
			items.push(...(Array.isArray(result?.field_options) ? result.field_options : []));
		}
		return uniqueBy(items, (entry) => optionalString(entry?.key));
	}

	async function compareSavedRuns({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let requestedPaths = Array.isArray(payload.paths)
			? payload.paths
			: Array.isArray(payload.names)
				? payload.names
				: [payload.path || payload.name].filter(Boolean);
		if (!requestedPaths.length) {
			throw new Error("Select one or more saved screening runs to compare.");
		}
		let selectedRuns = [];
		for (let requested of requestedPaths) {
			let byPath = typeof requested == "string" && requested.includes("/");
			let loaded = await loadSavedRun({
				reviewer,
				current,
				payload: byPath ? { path: requested } : { name: requested },
			});
			selectedRuns.push({
				name: loaded.name,
				path: loaded.path,
				saved_at: loaded.saved_at,
				entry: loaded.entry,
				result: loaded.result || {},
			});
		}
		let results = selectedRuns.map((entry) => entry.result || {});
		let records = mergeComparedRecords(selectedRuns);
		let limit = normalizeLimit(payload.limit, records.length || DEFAULT_LIMIT);
		let page = normalizePage(payload.page);
		let offset = Object.prototype.hasOwnProperty.call(payload, "offset")
			? normalizeOffset(payload.offset)
			: (page - 1) * limit;
		let pageCount = Math.max(1, Math.ceil(records.length / limit) || 1);
		let currentPage = Math.min(pageCount, Math.floor(offset / limit) + 1);
		return {
			ok: true,
			query: "",
			decision_filter: null,
			total_records: records.length,
			limit,
			offset,
			page: currentPage,
			page_count: pageCount,
			summary: summarize(records),
			columns: unionColumns(results),
			rules: unionRules(results),
			field_options: unionFieldOptions(results),
			records: records.slice(offset, offset + limit),
			compare: {
				selected_count: selectedRuns.length,
				raw_record_count: selectedRuns.reduce((total, entry) => total + (Array.isArray(entry.result?.records) ? entry.result.records.length : 0), 0),
				selected_runs: selectedRuns.map((entry) => ({
					name: entry.name,
					path: entry.path,
					saved_at: entry.saved_at,
					total_records: Number(entry.result?.total_records || entry.result?.records?.length || 0) || 0,
					query: optionalString(entry.result?.query),
					decision_filter: optionalString(entry.result?.decision_filter),
				})),
			},
		};
	}

	async function upsertFilterDefinition(reviewer, context, definition = {}) {
		await ensureSchema(reviewer, context);
		let now = new Date().toISOString();
		let nextID = optionalString(definition.filter_id) || filterID();
		let existing = (await filterRows(reviewer, context)).find((entry) =>
			String(SystematicReviewerWorkflowEmbeddings.rowValue(entry, "filter_id") || "") == nextID
		) || null;
		let rules = Array.isArray(definition.rules)
			? definition.rules
			: parseStoredActionRules(definition.rules_json || "", {
				column_key: definition.column_key,
				operator: definition.operator,
				match_value: definition.match_value,
			});
		let firstRule = rules[0] || {
			column_key: optionalString(definition.column_key),
			operator: optionalString(definition.operator),
			match_value: cleanBlockText(definition.match_value),
		};
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			`INSERT OR REPLACE INTO screening_filters (
				filter_id,
				name,
				query_text,
				decision_filter,
				source_scope,
				source_collection_key,
				source_collection_name,
				column_key,
				operator,
				match_value,
				match_mode,
				rules_json,
				tracking_column_key,
				tracking_column_label,
				materialized_collection_key,
				materialized_collection_name,
				created_at,
				updated_at,
				last_materialized_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				nextID,
				cleanText(definition.name),
				cleanBlockText(definition.query),
				cleanText(definition.decision_filter),
				cleanText(definition.source_scope),
				optionalString(definition.source_collection_key),
				cleanText(definition.source_collection_name),
				optionalString(firstRule.column_key),
				optionalString(firstRule.operator),
				cleanBlockText(firstRule.match_value),
				normalizeMatchMode(definition.match_mode || definition.matchMode || "and"),
				serializeActionRules(rules),
				optionalString(definition.tracking_column_key || definition.trackingColumnKey),
				cleanText(definition.tracking_column_label || definition.trackingColumnLabel),
				optionalString(definition.collection_key),
				cleanText(definition.collection_name),
				optionalString(existing ? SystematicReviewerWorkflowEmbeddings.rowValue(existing, "created_at") : "") || now,
				now,
				optionalString(definition.last_materialized_at) || now,
			]
		);
		return nextID;
	}

	async function ensureFilterTrackingColumn(reviewer, context, filterInfo = {}) {
		let filterName = cleanText(filterInfo.name) || "Filter";
		let trackingColumnKey = optionalString(filterInfo.tracking_column_key || filterInfo.trackingColumnKey);
		let trackingColumnLabel = cleanText(filterInfo.tracking_column_label || filterInfo.trackingColumnLabel) || `Filter - ${filterName}`;
		if (!trackingColumnKey) {
			let suffix = optionalString(filterInfo.filter_id || filterInfo.filterID || filterID());
			trackingColumnKey = normalizeColumnKey(`filter_${suffix}`);
		}
		await upsertColumnDefinition(reviewer, context, trackingColumnKey, trackingColumnLabel, "text");
		return {
			column_key: trackingColumnKey,
			label: trackingColumnLabel,
		};
	}

	function filterTrackingValue({ name = "", rules = [], matchMode = "and" } = {}) {
		let filterName = cleanText(name) || "Filter";
		let detail = describeRuleSet(rules, matchMode);
		return detail == "whole current scope"
			? `Created by filter ${filterName}`
			: `Created by filter ${filterName}: ${detail}`;
	}

	async function syncFilterTrackingColumn(reviewer, context, scopeRecords = [], matchedRecords = [], columnKey = "", valueText = "") {
		let scopeKeys = uniqueItemKeys(scopeRecords);
		let matchedKeys = new Set(uniqueItemKeys(matchedRecords));
		for (let batch of chunkArray(scopeKeys, BATCH_WRITE_SIZE)) {
			let statements = [];
			for (let itemKey of batch) {
				if (matchedKeys.has(itemKey)) {
					statements.push({
						sql: `INSERT OR REPLACE INTO screening_column_values (
							item_key, column_key, value_text, updated_at
						) VALUES (?, ?, ?, ?)`,
						params: [itemKey, columnKey, cleanBlockText(valueText), new Date().toISOString()],
					});
				}
				else {
					statements.push({
						sql: "DELETE FROM screening_column_values WHERE item_key=? AND column_key=?",
						params: [itemKey, columnKey],
					});
				}
			}
			await executeBatchWrites(reviewer, context, statements);
		}
	}

	async function resolveMaterializedFilterTarget(reviewer, current, payload = {}) {
		let context = current?.context;
		let stored = await listMaterializedFilters(reviewer, current);
		let requestedID = optionalString(payload.filter_id || payload.filterID);
		let requestedKey = optionalString(payload.collection_key || payload.collectionKey);
		let requestedName = optionalString(payload.name);
		let existing = requestedID
			? stored.find((entry) => entry.filter_id == requestedID) || null
			: requestedKey
				? stored.find((entry) => entry.collection_key == requestedKey) || null
				: requestedName
					? stored.find((entry) => entry.name == requestedName) || null
					: null;
		let folder = await filterFolder(reviewer, current, { createMissing: true });
		let target = null;
		let desiredName = optionalString(payload.name) || optionalString(existing?.name);
		if (!desiredName) {
			throw new Error("Filter name is required.");
		}
		if (existing?.collection_key) {
			for (let node of reviewer?._projectCollectionNodes?.(current.collection) || []) {
				if (String(node?.collection?.key || "") == existing.collection_key) {
					target = node.collection;
					break;
				}
			}
		}
		if (!target) {
			for (let node of reviewer?._projectCollectionNodes?.(current.collection) || []) {
				if (node?.parentKey == folder.key && String(node?.collection?.name || "").trim() == desiredName) {
					target = node.collection;
					break;
				}
			}
		}
		if (!target) {
			target = new Zotero.Collection();
			target.libraryID = current.collection.libraryID;
			target.name = desiredName;
			target.parentID = folder.id;
			await target.saveTx();
		}
		return {
			existing,
			target,
			filter_id: existing?.filter_id || requestedID || filterID(),
			name: desiredName,
		};
	}

	async function materializeFilter({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let requestedID = optionalString(payload.filter_id || payload.filterID);
		let stored = requestedID
			? (await listMaterializedFilters(reviewer, current)).find((entry) => entry.filter_id == requestedID) || null
			: null;
		let sourcePayload = {
			query: Object.prototype.hasOwnProperty.call(payload, "query") ? payload.query : stored?.query || "",
			decision: Object.prototype.hasOwnProperty.call(payload, "decision")
				? payload.decision
				: Object.prototype.hasOwnProperty.call(payload, "decision_filter")
					? payload.decision_filter
					: stored?.decision_filter || "",
			scope: Object.prototype.hasOwnProperty.call(payload, "scope") ? payload.scope : stored?.source_scope || "",
			collection_key: Object.prototype.hasOwnProperty.call(payload, "collection_key")
				? payload.collection_key
				: stored?.source_collection_key || "",
			collection_name: Object.prototype.hasOwnProperty.call(payload, "collection_name")
				? payload.collection_name
				: stored?.source_collection_name || "",
			match_mode: Object.prototype.hasOwnProperty.call(payload, "match_mode")
				? payload.match_mode
				: Object.prototype.hasOwnProperty.call(payload, "matchMode")
					? payload.matchMode
					: stored?.match_mode || "and",
			rules: Array.isArray(payload.rules)
				? payload.rules
				: Array.isArray(stored?.rules)
					? stored.rules
					: [],
			column_key: Object.prototype.hasOwnProperty.call(payload, "column_key")
				? payload.column_key
				: stored?.column_key || "",
			operator: Object.prototype.hasOwnProperty.call(payload, "operator")
				? payload.operator
				: stored?.operator || "",
			match_value: Object.prototype.hasOwnProperty.call(payload, "match_value")
				? payload.match_value
				: stored?.match_value || "",
		};
		let rules = normalizeActionRules(sourcePayload);
		let matchMode = normalizeMatchMode(sourcePayload.match_mode || "and");
		let scopeItemKeys = [];
		let filteredItemKeys = [];
		let scan = await scanScopedRecords(reviewer, current, sourcePayload, {
			rules,
			onRecord: async (record) => {
				scopeItemKeys.push(record.item_key);
				if (matchesRuleSet(record, rules, matchMode)) {
					filteredItemKeys.push(record.item_key);
				}
			},
		});
		let targetInfo = await resolveMaterializedFilterTarget(reviewer, current, {
			filter_id: requestedID,
			collection_key: payload.target_collection_key || payload.targetCollectionKey || stored?.collection_key || "",
			name: optionalString(payload.name) || stored?.name || "",
		});
		let targetCollection = targetInfo.target;
		let allowedKeys = new Set(filteredItemKeys);
		let currentMembers = [];
		try {
			currentMembers = targetCollection.getChildItems(false, false) || [];
		}
		catch (_error) {
			currentMembers = [];
		}
		let addedCount = 0;
		let removedCount = 0;
		let currentKeys = new Set();
		for (let item of currentMembers) {
			if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.() || !item.key) {
				continue;
			}
			currentKeys.add(item.key);
		}
		let removeItemKeys = Array.from(currentKeys).filter((itemKey) => !allowedKeys.has(itemKey));
		let addItemKeys = filteredItemKeys.filter((itemKey) => !currentKeys.has(itemKey));
		for (let batch of chunkArray(removeItemKeys, BATCH_WRITE_SIZE)) {
			let result = await removeItemsFromCollectionBatch({
				current,
				itemKeys: batch,
				targetCollection,
			});
			removedCount += Number(result.removed_count || 0) || 0;
		}
		for (let batch of chunkArray(addItemKeys, BATCH_WRITE_SIZE)) {
			let result = await copyItemsToCollectionBatch({
				current,
				itemKeys: batch,
				targetCollection,
			});
			addedCount += Number(result.added_count || 0) || 0;
		}
		let scopeInfo = scopeSnapshot(sourcePayload, scan.scope || null);
		let materializedAt = new Date().toISOString();
		let trackingColumn = await ensureFilterTrackingColumn(reviewer, context, {
			filter_id: targetInfo.filter_id,
			name: targetInfo.name,
			tracking_column_key: stored?.tracking_column_key || "",
			tracking_column_label: stored?.tracking_column_label || "",
		});
		await syncFilterTrackingColumn(
			reviewer,
			context,
			scopeItemKeys,
			filteredItemKeys,
			trackingColumn.column_key,
			filterTrackingValue({ name: targetInfo.name, rules, matchMode })
		);
		let nextFilterID = await upsertFilterDefinition(reviewer, context, {
			filter_id: targetInfo.filter_id,
			name: targetInfo.name,
			query: sourcePayload.query,
			decision_filter: sourcePayload.decision,
			source_scope: scopeInfo.scope,
			source_collection_key: scopeInfo.collection_key,
			source_collection_name: scopeInfo.collection_name,
			rules,
			match_mode: matchMode,
			tracking_column_key: trackingColumn.column_key,
			tracking_column_label: trackingColumn.label,
			collection_key: String(targetCollection.key || ""),
			collection_name: String(targetCollection.name || targetInfo.name || ""),
			last_materialized_at: materializedAt,
		});
		let filters = await listMaterializedFilters(reviewer, current);
		let filter = filters.find((entry) => entry.filter_id == nextFilterID) || null;
			return {
				ok: true,
				filter_id: nextFilterID,
				filter,
				matched_count: filteredItemKeys.length,
				added_count: addedCount,
				removed_count: removedCount,
			materialized_at: materializedAt,
			available_scopes: availableScopes(reviewer, current),
			materialized_filters: filters,
		};
	}

	async function deleteMaterializedFilter({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let requestedID = optionalString(payload.filter_id || payload.filterID);
		if (!requestedID) {
			throw new Error("filter_id is required.");
		}
		let filters = await listMaterializedFilters(reviewer, current);
		let existing = filters.find((entry) => entry.filter_id == requestedID) || null;
		if (!existing) {
			throw new Error("Materialized screening filter was not found.");
		}
		if (payload.delete_collection !== false && existing.collection_key) {
			for (let node of reviewer?._projectCollectionNodes?.(current.collection) || []) {
				if (String(node?.collection?.key || "") == existing.collection_key) {
					await node.collection.eraseTx();
					break;
				}
			}
		}
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			"DELETE FROM screening_filters WHERE filter_id=?",
			[requestedID]
		);
		if (existing.tracking_column_key) {
			let siblings = filters.filter((entry) =>
				entry.filter_id != requestedID
				&& String(entry.tracking_column_key || "") == String(existing.tracking_column_key || "")
			);
			if (!siblings.length) {
				await deleteColumnDefinition(reviewer, context, existing.tracking_column_key);
			}
		}
		return {
			ok: true,
			filter_id: requestedID,
			materialized_filters: await listMaterializedFilters(reviewer, current),
			available_scopes: availableScopes(reviewer, current),
		};
	}

	async function saveRun({ reviewer, current, payload = {}, result = null }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let nextResult = result && typeof result == "object"
			? result
			: await listRecords({ reviewer, current, payload: payload || {} });
		let root = outputRoot(reviewer, context);
		await reviewer._ensureDirectory(root);
		let stamp = nowStamp();
		let query = optionalString(nextResult.query || payload.query);
		let decision = optionalString(nextResult.decision_filter || payload.decision || payload.decision_filter);
		let name = optionalString(payload.name)
			|| (query ? `Screening ${query}` : decision ? `Screening ${decision}` : `Screening ${stamp}`);
		let slug = sanitizeSlug(reviewer, name, "screening-search");
		let path = reviewer._joinPath(root, `${stamp}-${slug}.json`);
		let saved = {
			project_id: context.projectID,
			project_root: context.projectRoot,
			name,
			saved_at: new Date().toISOString(),
			result: nextResult,
		};
		await reviewer._writeJSONFile(path, saved);
		return {
			ok: true,
			name,
			path,
			entry: serializeFileEntry(reviewer._nsIFile(path)),
			result: nextResult,
			runs: await listSavedRuns(reviewer, context),
		};
	}

	async function upsertDecision(reviewer, context, itemKey, decision, reason, notes, metadata = {}) {
		await ensureSchema(reviewer, context);
		let now = new Date().toISOString();
		let nextDecision = optionalString(decision);
		let nextReason = cleanBlockText(reason);
		let nextNotes = cleanBlockText(notes);
		let nextTargetCollectionKey = optionalString(metadata.target_collection_key || metadata.targetCollectionKey);
		let nextTargetCollectionName = cleanText(metadata.target_collection_name || metadata.targetCollectionName);
		let nextSourceType = normalizeDecisionSourceType(metadata.source_type || metadata.sourceType || "manual");
		let nextSourceDetail = cleanBlockText(metadata.source_detail || metadata.sourceDetail);
		let hasPayload = !!(
			nextDecision
			|| nextReason
			|| nextNotes
			|| nextTargetCollectionKey
			|| nextTargetCollectionName
			|| nextSourceDetail
		);
		if (!hasPayload) {
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				"DELETE FROM screening_decisions WHERE item_key=?",
				[itemKey]
			);
			return;
		}
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			`INSERT OR REPLACE INTO screening_decisions (
				item_key,
				decision,
				reason,
				notes,
				target_collection_key,
				target_collection_name,
				source_type,
				source_detail,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				itemKey,
				nextDecision,
				nextReason,
				nextNotes,
				nextTargetCollectionKey,
				nextTargetCollectionName,
				nextSourceType,
				nextSourceDetail,
				now,
			]
		);
	}

	async function writeColumnValue(reviewer, context, itemKey, columnKey, valueText) {
			let now = new Date().toISOString();
			let cleanedValue = cleanBlockText(valueText);
			if (!optionalString(cleanedValue)) {
				await SystematicReviewerWorkflowEmbeddings.executeWrite(
					reviewer,
					context,
					"DELETE FROM screening_column_values WHERE item_key=? AND column_key=?",
				[itemKey, columnKey]
			);
			return;
		}
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				`INSERT OR REPLACE INTO screening_column_values (
				item_key, column_key, value_text, updated_at
			) VALUES (?, ?, ?, ?)`,
			[itemKey, columnKey, cleanedValue, now]
		);
	}

	async function resolveEditMoveTarget({ reviewer, current, edit = {}, fallbackDecision = "" }) {
		let hasExplicitTargetCollectionKey = edit?.has_explicit_target_collection_key === true
			|| Object.prototype.hasOwnProperty.call(edit, "target_collection_key")
			|| Object.prototype.hasOwnProperty.call(edit, "targetCollectionKey")
			|| Object.prototype.hasOwnProperty.call(edit, "move_to_collection_key")
			|| Object.prototype.hasOwnProperty.call(edit, "moveToCollectionKey");
		let hasExplicitTargetCollectionName = edit?.has_explicit_target_collection_name === true
			|| Object.prototype.hasOwnProperty.call(edit, "target_collection_name")
			|| Object.prototype.hasOwnProperty.call(edit, "targetCollectionName")
			|| Object.prototype.hasOwnProperty.call(edit, "move_to_collection_name")
			|| Object.prototype.hasOwnProperty.call(edit, "moveToCollectionName");
		let hasExplicitDecision = edit?.has_explicit_decision === true
			|| Object.prototype.hasOwnProperty.call(edit, "decision");
		let targetCollectionKey = hasExplicitTargetCollectionKey
			? optionalString(edit.target_collection_key || edit.targetCollectionKey || edit.move_to_collection_key || edit.moveToCollectionKey)
			: "";
		let targetCollectionName = hasExplicitTargetCollectionName
			? optionalString(edit.target_collection_name || edit.targetCollectionName || edit.move_to_collection_name || edit.moveToCollectionName)
			: "";
		if (targetCollectionKey || targetCollectionName) {
			return await resolveDecisionTargetCollection({
				reviewer,
				current,
				collectionKey: targetCollectionKey,
				collectionName: targetCollectionName,
			});
		}
		if (!hasExplicitDecision) {
			return null;
		}
		let decision = Object.prototype.hasOwnProperty.call(edit, "decision")
			? normalizeDecision(edit.decision)
			: normalizeDecision(fallbackDecision);
		if (!decision) {
			return null;
		}
		let buckets = await reviewCollections(reviewer, current, {
			createMissing: true,
		});
		return buckets?.[reviewBucketForDecision(decision)?.key] || null;
	}

	async function decisionForTargetCollection(reviewer, current, targetCollection) {
		if (!targetCollection?.key) {
			return "";
		}
		let buckets = await reviewCollections(reviewer, current, {
			createMissing: false,
		});
		for (let definition of Object.values(REVIEW_COLLECTIONS)) {
			let bucket = buckets?.[definition.key] || null;
			if (bucket?.key && bucket.key == targetCollection.key) {
				return definition.decision || "";
			}
		}
		return "";
	}

	async function upsertColumnDefinition(reviewer, context, columnKey, label, type = "text") {
		await ensureSchema(reviewer, context);
		let nextKey = normalizeColumnKey(columnKey || label);
		let nextLabel = cleanText(label);
		if (!nextLabel) {
			throw new Error("Column label is required.");
		}
		let nextType = normalizeColumnType(type);
		let existing = (await listColumns(reviewer, context)).find((column) => column.column_key == nextKey) || null;
		let now = new Date().toISOString();
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				`INSERT OR REPLACE INTO screening_columns (
				column_key, label, type, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?)`,
			[
				nextKey,
				nextLabel,
				nextType,
				existing?.created_at || now,
				now,
			]
		);
		return {
			column_key: nextKey,
			label: nextLabel,
			type: nextType,
			created_at: existing?.created_at || now,
			updated_at: now,
		};
	}

	async function deleteColumnDefinition(reviewer, context, columnKey, options = {}) {
		await ensureSchema(reviewer, context);
		let nextKey = normalizeColumnKey(columnKey);
		if (!nextKey) {
			throw new Error("column_key is required.");
		}
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			"DELETE FROM screening_column_values WHERE column_key=?",
			[nextKey]
		);
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			"DELETE FROM screening_columns WHERE column_key=?",
			[nextKey]
		);
		if (options.remove_preferences !== false) {
			let visibleColumns = await getPreference(reviewer, context, "visible_columns", null);
			if (Array.isArray(visibleColumns)) {
				await setPreference(
					reviewer,
					context,
					"visible_columns",
					visibleColumns.filter((entry) => String(entry || "") != nextKey)
				);
			}
			let columnWidths = await getPreference(reviewer, context, "column_widths", {});
			if (columnWidths && typeof columnWidths == "object" && Object.prototype.hasOwnProperty.call(columnWidths, nextKey)) {
				let nextWidths = Object.assign({}, columnWidths);
				delete nextWidths[nextKey];
				await setPreference(reviewer, context, "column_widths", nextWidths);
			}
		}
		return {
			ok: true,
			column_key: nextKey,
			columns: await listColumns(reviewer, context),
		};
	}

	async function updateDecision({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		let decision = Object.prototype.hasOwnProperty.call(payload, "decision")
			? normalizeDecision(payload.decision)
			: "";
		let reason = cleanBlockText(payload.reason);
		let notes = cleanBlockText(payload.notes);
		let targetCollection = await resolveEditMoveTarget({
			reviewer,
			current,
			edit: payload,
			fallbackDecision: decision,
		});
		let effectiveDecision = decision;
		if (targetCollection) {
			await moveItemToTargetCollection({
				reviewer,
				current,
				itemKey,
				targetCollection,
			});
			if (!effectiveDecision) {
				effectiveDecision = await decisionForTargetCollection(reviewer, current, targetCollection);
			}
		}
		await upsertDecision(reviewer, context, itemKey, effectiveDecision, reason, notes, {
			target_collection_key: String(targetCollection?.key || ""),
			target_collection_name: String(targetCollection?.name || ""),
			source_type: payload.source_type || payload.sourceType || "manual",
			source_detail: payload.source_detail || payload.sourceDetail || "Manual screening move",
		});
		let listing = await listRecords({
			reviewer,
			current,
			payload: Object.assign({}, payload || {}, { limit: 1, page: 1 }),
		});
		let updated = await recordByItemKey(reviewer, current, payload || {}, itemKey);
		return {
			ok: true,
			item_key: itemKey,
			record: updated,
			summary: listing.summary,
		};
	}

	async function searchRecords({ reviewer, current, payload = {} }) {
		let result = await listRecords({ reviewer, current, payload: payload || {} });
		if (payload.save_run !== true && payload.saveRun !== true) {
			return result;
		}
		let saved = await saveRun({
			reviewer,
			current,
			payload: payload || {},
			result,
		});
		return Object.assign({}, result, {
			saved_run: {
				name: saved.name,
				path: saved.path,
				entry: saved.entry,
			},
			saved_runs: saved.runs,
		});
	}

	async function exportCSV({ reviewer, current, payload = {}, options = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let customColumns = await listDynamicColumnCatalog(reviewer, context);
		let scopeEntries = resolveExportScopeEntries(reviewer, current, payload);
		let exportMode = exportModeValue(payload);
		let scopeMode = exportScopeModeValue(payload) == "all" ? "all" : "single";
		let columnDefs = await exportColumnDefinitions(reviewer, context, payload, customColumns);
		let requestedJobID = existingJobID(payload);
		let resolvedOutputPath = ensureCSVExtension(
			optionalString(options.outputPath || options.output_path || "")
			|| optionalString(payload.__resolved_output_path || payload.__resolvedOutputPath || "")
			|| ""
		);
		if (!resolvedOutputPath) {
			resolvedOutputPath = await defaultExportCSVPath(reviewer, current);
		}
		let job = requestedJobID ? { job_id: requestedJobID } : null;
		if (!job?.job_id) {
			let storedPayload = Object.assign({}, payload || {}, {
				export_mode: exportMode,
				scope_mode: scopeMode,
				visible_columns: Array.isArray(payload.visible_columns)
					? payload.visible_columns.slice()
					: (Array.isArray(payload.visibleColumns) ? payload.visibleColumns.slice() : undefined),
			});
			delete storedPayload.output_path;
			delete storedPayload.outputPath;
			return await reviewer._launchWorkflowJob(current, {
				prefix: "screen-export",
				kind: "manual_screening_export_csv",
				title: `Screening export: ${context.collectionName || "CSV"}`,
				requested_mode: scopeMode == "all"
					? "all_screening_scopes"
					: cleanText(scopeEntries[0]?.collection_name || scopeEntries[0]?.label || scopeEntries[0]?.collection_key || "screening_scope"),
				used_mode: exportMode,
				source_title: context.collectionName || "Screening",
				source_path: context.projectRoot,
				output_path: resolvedOutputPath,
				metadata: {
					payload: storedPayload,
					scope_mode: scopeMode,
					export_mode: exportMode,
					scope_count: scopeEntries.length,
					column_count: columnDefs.length,
					output_path: resolvedOutputPath,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				refreshControllers: false,
				message: "Screening CSV export queued. Track progress in Jobs.",
			});
		}
		let rowCount = 0;
		let processedItemCount = 0;
		let exportCustomColumnKeys = columnDefs
			.map((column) => optionalString(column?.column_key))
			.filter(Boolean);
		let includeAbstractsForExport = columnDefs.some((column) => optionalString(column?.key) == "abstract_note");
		let appender = null;
		let exportReviewStates = await reviewStateByItemKey(reviewer, current);
		try {
			let header = columnDefs.map((column) => csvEscape(column?.label || column?.key || "")).join(",");
			await reviewer._ensureDirectory(reviewer._parentPath(resolvedOutputPath));
			await reviewer._writeTextFile(resolvedOutputPath, `${CSV_UTF8_BOM}${header}${CSV_ROW_SEPARATOR}`);
			appender = await openTextAppender(reviewer, resolvedOutputPath);
			for (let scopeIndex = 0; scopeIndex < scopeEntries.length; scopeIndex += 1) {
				await reviewer._throwIfJobCanceled?.(current, job.job_id);
				let scopeEntry = scopeEntries[scopeIndex];
				let scopePayload = exportPayloadForScope(payload, scopeEntry);
				let scopeName = cleanText(scopeEntry?.collection_name || scopeEntry?.label || scopeEntry?.collection_key || `Scope ${scopeIndex + 1}`);
				let batchRequirements = mergedStateRequirements(customColumns, scopePayload, {
					customColumnKeys: exportCustomColumnKeys,
					includeAbstracts: includeAbstractsForExport,
					rules: [],
				});
				let scopeScanned = 0;
				let scopeExported = 0;
				await forEachScopedItemKeyBatch(reviewer, current, scopePayload, {
					batchSize: EXPORT_SCAN_BATCH_SIZE,
					onBatch: async (itemKeyBatch) => {
						await reviewer._throwIfJobCanceled?.(current, job.job_id);
						scopeScanned += itemKeyBatch.length;
						processedItemCount += itemKeyBatch.length;
						let state = await mergedState(reviewer, current, scopePayload, {
							itemKeys: itemKeyBatch,
							columns: customColumns,
							rules: [],
							includeAllCustomValues: exportMode == "all_columns",
							customColumnKeys: batchRequirements.customColumnKeys,
							includeAbstracts: batchRequirements.includeAbstracts,
							reviewStates: exportReviewStates,
						});
						let matchedRecords = state.records.filter((record) => recordMatchesFilters(record, scopePayload));
						let preparedRecords = await prepareExportStageRecords(reviewer, current, matchedRecords, columnDefs);
						if (preparedRecords.length) {
							let chunk = `${preparedRecords.map((record) => exportCSVLine(record, columnDefs, scopeEntry)).join(CSV_ROW_SEPARATOR)}${CSV_ROW_SEPARATOR}`;
							appender.write(chunk);
							rowCount += preparedRecords.length;
							scopeExported += preparedRecords.length;
						}
						await SystematicReviewerWorkflowJobs.progress(
							reviewer,
							current,
							job.job_id,
							rowCount,
							Math.max(rowCount, processedItemCount),
							`Exported ${scopeExported} rows from ${scopeName} (${scopeScanned} scanned)`
						);
						await Zotero.Promise.delay(0);
					},
				});
				if (!scopeExported) {
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						rowCount,
						Math.max(rowCount, processedItemCount),
						`Finished ${scopeName} (${scopeIndex + 1}/${scopeEntries.length})`
					);
				}
			}
			let result = {
				ok: true,
				job_id: job.job_id,
				path: resolvedOutputPath,
				row_count: rowCount,
				scope_count: scopeEntries.length,
				column_count: columnDefs.length,
				export_mode: exportMode,
				scope_mode: scopeMode,
			};
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: exportMode,
				output_path: resolvedOutputPath,
				progress_current: rowCount,
				progress_total: Math.max(rowCount, processedItemCount),
				message: `Exported ${rowCount} screening rows to CSV.`,
				metadata: {
					row_count: rowCount,
					scope_count: scopeEntries.length,
					column_count: columnDefs.length,
					export_mode: exportMode,
					scope_mode: scopeMode,
					path: resolvedOutputPath,
				},
			});
			return result;
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
		finally {
			try {
				appender?.close?.();
			}
			catch (_error) {}
		}
	}

	async function exportCSVSaveAs({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let win = reviewer?._primaryWindow?.() || null;
		if (!win?.document) {
			throw new Error("A Zotero window is required to choose where to save the Screening CSV.");
		}
		let fakeController = { doc: win.document };
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		reviewer._initFilePicker(fp, fakeController, "Export Screening CSV", Components.interfaces.nsIFilePicker.modeSave);
		fp.defaultExtension = "csv";
		fp.defaultString = defaultExportCSVFileName(reviewer, current);
		fp.appendFilter("CSV", "*.csv");
		let displayDirectory = reportDirectoryPath(reviewer, context);
		if (displayDirectory && await reviewer._pathExists(displayDirectory)) {
			try {
				fp.displayDirectory = reviewer._nsIFile(displayDirectory);
			}
			catch (_error) {}
		}
		let result = await new Promise((resolve) => fp.open(resolve));
		if ((result != Components.interfaces.nsIFilePicker.returnOK && result != Components.interfaces.nsIFilePicker.returnReplace) || !fp.file) {
			return { ok: true, canceled: true };
		}
		return await exportCSV({
			reviewer,
			current,
			payload: Object.assign({}, payload || {}, {
				detach: true,
			}),
			options: {
				outputPath: ensureCSVExtension(fp.file.path),
			},
		});
	}

	async function createColumn({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let label = cleanText(payload.label);
		if (!label) {
			throw new Error("Column label is required.");
		}
		let column = await upsertColumnDefinition(
			reviewer,
			context,
			payload.column_key || payload.key || label,
			label,
			payload.type || "text"
		);
		return {
			ok: true,
			column,
			columns: await listColumns(reviewer, context),
		};
	}

	async function deleteColumn({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let columnKey = optionalString(payload.column_key || payload.columnKey || payload.key);
		if (!columnKey) {
			throw new Error("column_key is required.");
		}
		return await deleteColumnDefinition(reviewer, context, columnKey);
	}

	async function updateComment({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		let existing = (await decisionsMap(reviewer, context)).get(itemKey) || {
			decision: "",
			reason: "",
			notes: "",
			target_collection_key: "",
			target_collection_name: "",
			source_type: "manual",
			source_detail: "",
		};
		let notes = Object.prototype.hasOwnProperty.call(payload, "notes")
			? cleanBlockText(payload.notes)
			: existing.notes;
		let reason = Object.prototype.hasOwnProperty.call(payload, "reason")
			? cleanBlockText(payload.reason)
			: existing.reason;
			await upsertDecision(reviewer, context, itemKey, existing.decision || "", reason, notes, {
				target_collection_key: existing.target_collection_key,
				target_collection_name: existing.target_collection_name,
				source_type: existing.source_type || "manual",
				source_detail: existing.source_detail || "",
			});
		let listing = await listRecords({
			reviewer,
			current,
			payload: Object.assign({}, payload || {}, { limit: 1, page: 1 }),
		});
		let updated = await recordByItemKey(reviewer, current, payload || {}, itemKey);
		return {
			ok: true,
			item_key: itemKey,
			record: updated,
			summary: listing.summary,
		};
	}

	async function saveEdits({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let edits = Array.isArray(payload.edits) ? payload.edits : [];
		if (!edits.length) {
			throw new Error("Provide one or more screening edits.");
		}
		let columns = await listColumns(reviewer, context);
		let validColumns = new Set(columns.map((column) => column.column_key));
		let decisions = await decisionsMap(reviewer, context);
		let normalizedEdits = edits
			.map((edit) => {
				let itemKey = optionalString(edit.item_key || edit.itemKey);
				if (!itemKey) {
					return null;
				}
				let existing = decisions.get(itemKey) || {
					decision: "",
					reason: "",
					notes: "",
					target_collection_key: "",
					target_collection_name: "",
					source_type: "manual",
					source_detail: "",
				};
				let values = edit.values && typeof edit.values == "object" ? edit.values : {};
				let hasExplicitDecision = Object.prototype.hasOwnProperty.call(edit, "decision");
				let explicitTargetCollectionKey = optionalString(
					edit.target_collection_key || edit.targetCollectionKey || edit.move_to_collection_key || edit.moveToCollectionKey
				);
				let explicitTargetCollectionName = cleanText(
					edit.target_collection_name || edit.targetCollectionName || edit.move_to_collection_name || edit.moveToCollectionName
				);
				for (let columnKey of Object.keys(values)) {
					if (!validColumns.has(columnKey)) {
						throw new Error(`Unknown screening column: ${columnKey}`);
					}
				}
				let cleanedValues = {};
				for (let [columnKey, rawValue] of Object.entries(values || {})) {
					cleanedValues[columnKey] = cleanBlockText(rawValue);
				}
				return {
					item_key: itemKey,
					decision: hasExplicitDecision
						? normalizeDecision(edit.decision)
						: existing.decision || "",
					reason: Object.prototype.hasOwnProperty.call(edit, "reason")
						? cleanBlockText(edit.reason)
						: existing.reason,
					notes: Object.prototype.hasOwnProperty.call(edit, "notes")
						? cleanBlockText(edit.notes ?? edit.comments)
						: Object.prototype.hasOwnProperty.call(edit, "comments")
							? cleanBlockText(edit.comments)
							: existing.notes,
					values: cleanedValues,
					source_type: normalizeDecisionSourceType(edit.source_type || edit.sourceType || existing.source_type || "manual"),
					source_detail: cleanBlockText(edit.source_detail || edit.sourceDetail || existing.source_detail || "Manual screening edit"),
					target_collection_key: explicitTargetCollectionKey || ((!hasExplicitDecision && !explicitTargetCollectionName) ? existing.target_collection_key : ""),
					target_collection_name: explicitTargetCollectionName || ((!hasExplicitDecision && !explicitTargetCollectionKey) ? existing.target_collection_name : ""),
					has_explicit_decision: hasExplicitDecision,
					has_explicit_target_collection_key: !!explicitTargetCollectionKey,
					has_explicit_target_collection_name: !!explicitTargetCollectionName,
				};
			})
			.filter(Boolean);
		if (!normalizedEdits.length) {
			throw new Error("Provide one or more screening edits.");
		}
		let totalCells = normalizedEdits.reduce((total, edit) =>
			total
				+ (Object.prototype.hasOwnProperty.call(edit, "reason") ? 1 : 0)
				+ (Object.prototype.hasOwnProperty.call(edit, "notes") ? 1 : 0)
				+ Object.keys(edit.values || {}).length
				+ ((edit.target_collection_key || edit.target_collection_name || edit.decision) ? 1 : 0),
		0);
		let requestedJobID = existingJobID(payload);
		let job = requestedJobID ? { job_id: requestedJobID } : null;
		if (!job?.job_id) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "screen-save",
				kind: "manual_screening_save",
				title: "Save screening edits",
				requested_mode: optionalString(payload.scope || payload.collection_key || payload.collection_name || ""),
				used_mode: "batched_edits",
				source_title: context.collectionName,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}),
					row_count: normalizedEdits.length,
					cell_count: totalCells,
					batch_size: BATCH_WRITE_SIZE,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				refreshControllers: false,
				message: "Screening save queued. Track progress in Jobs.",
			});
		}
		let processed = 0;
		try {
			for (let batch of chunkArray(normalizedEdits, BATCH_WRITE_SIZE)) {
				await reviewer._throwIfJobCanceled?.(current, job.job_id);
				let statements = [];
				let moveGroups = new Map();
				for (let edit of batch) {
					let targetCollection = await resolveEditMoveTarget({
						reviewer,
						current,
						edit,
						fallbackDecision: edit.decision,
					});
					if (targetCollection) {
						edit.target_collection_key = String(targetCollection.key || "");
						edit.target_collection_name = String(targetCollection.name || "");
						let groupKey = String(targetCollection.key || "");
						if (!moveGroups.has(groupKey)) {
							moveGroups.set(groupKey, {
								targetCollection,
								itemKeys: [],
							});
						}
						moveGroups.get(groupKey).itemKeys.push(edit.item_key);
					}
				}
				for (let group of moveGroups.values()) {
					await moveItemsToTargetCollectionBatch({
						reviewer,
						current,
						itemKeys: group.itemKeys,
						targetCollection: group.targetCollection,
					});
				}
				for (let edit of batch) {
					let decisionPayload = {
						target_collection_key: edit.target_collection_key,
						target_collection_name: edit.target_collection_name,
						source_type: edit.source_type,
						source_detail: edit.source_detail,
					};
					let hasDecisionPayload = !!(
						edit.decision
						|| edit.reason
						|| edit.notes
						|| decisionPayload.target_collection_key
						|| decisionPayload.target_collection_name
						|| decisionPayload.source_detail
					);
					if (hasDecisionPayload) {
						statements.push({
							sql: `INSERT OR REPLACE INTO screening_decisions (
								item_key,
								decision,
								reason,
								notes,
								target_collection_key,
								target_collection_name,
								source_type,
								source_detail,
								updated_at
							) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
							params: [
								edit.item_key,
								edit.decision || "",
								edit.reason || "",
								edit.notes || "",
								decisionPayload.target_collection_key || "",
								decisionPayload.target_collection_name || "",
								decisionPayload.source_type || "manual",
								decisionPayload.source_detail || "",
								new Date().toISOString(),
							],
						});
					}
					else {
						statements.push({
							sql: "DELETE FROM screening_decisions WHERE item_key=?",
							params: [edit.item_key],
						});
					}
					for (let [columnKey, valueText] of Object.entries(edit.values || {})) {
						let valueString = optionalString(valueText);
						if (!valueString) {
							statements.push({
								sql: "DELETE FROM screening_column_values WHERE item_key=? AND column_key=?",
								params: [edit.item_key, columnKey],
							});
						}
						else {
							statements.push({
								sql: `INSERT OR REPLACE INTO screening_column_values (
									item_key, column_key, value_text, updated_at
								) VALUES (?, ?, ?, ?)`,
								params: [edit.item_key, columnKey, valueString, new Date().toISOString()],
							});
						}
					}
					processed += 1;
				}
				await executeBatchWrites(reviewer, context, statements);
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					job.job_id,
					processed,
					normalizedEdits.length,
					`Saved ${processed}/${normalizedEdits.length} screening rows`
				);
			}
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: "batched_edits",
				output_path: context.databasePath,
				progress_current: normalizedEdits.length,
				progress_total: normalizedEdits.length,
				message: `Saved screening edits for ${normalizedEdits.length} rows.`,
				metadata: {
					row_count: normalizedEdits.length,
					cell_count: totalCells,
				},
			});
			let listing = await listRecords({
				reviewer,
				current,
				payload: Object.assign({}, payload || {}, {
					query: payload.query || "",
					decision: payload.decision || "",
					limit: payload.limit || DEFAULT_LIMIT,
					page: payload.page || 1,
				}),
			});
		return {
			ok: true,
			job_id: job.job_id,
			saved_count: normalizedEdits.length,
			saved_cells: totalCells,
			summary: listing.summary,
			records: listing.records,
			columns: listing.columns,
		};
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
	}

	function matchRule(rule, record) {
		if (!rule?.enabled) {
			return false;
		}
		let value = recordValue(record, rule.column_key);
		return operatorMatches(value, rule.operator, rule.match_value);
	}

	async function updateRules({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		if (payload.delete_rule_id || payload.deleteRuleID) {
			let ruleIDValue = optionalString(payload.delete_rule_id || payload.deleteRuleID);
				await SystematicReviewerWorkflowEmbeddings.executeWrite(
					reviewer,
					context,
					"DELETE FROM screening_rules WHERE rule_id=?",
				[ruleIDValue]
			);
			return {
				ok: true,
				deleted_rule_id: ruleIDValue,
				rules: await listRules(reviewer, context),
			};
		}
		let label = cleanText(payload.label);
		let columnKey = optionalString(payload.column_key || payload.columnKey);
		let matchValue = cleanBlockText(payload.match_value || payload.matchValue);
		let decision = optionalString(payload.decision) ? normalizeDecision(payload.decision) : "";
		if (!label) {
			throw new Error("Rule label is required.");
		}
		if (!columnKey) {
			throw new Error("Rule field is required.");
		}
		if (!BASE_FIELD_KEYS.some(([key]) => key == columnKey)) {
			let columns = await listDynamicColumnCatalog(reviewer, context);
			if (!columns.some((column) => optionalString(column?.column_key || column?.key) == columnKey)) {
				throw new Error(`Unknown screening field: ${columnKey}`);
			}
		}
		if (!matchValue && !["empty", "not_empty"].includes(optionalString(payload.operator).toLowerCase())) {
			throw new Error("Rule match value is required.");
		}
		let operator = normalizeOperator(payload.operator);
		let existing = payload.rule_id || payload.ruleID
			? (await listRules(reviewer, context)).find((rule) => rule.rule_id == optionalString(payload.rule_id || payload.ruleID)) || null
			: null;
		let targetCollection = null;
		if (optionalString(payload.target_collection_key || payload.targetCollectionKey || payload.target_collection_name || payload.targetCollectionName)) {
			targetCollection = await resolveDecisionTargetCollection({
				reviewer,
				current,
				collectionKey: payload.target_collection_key || payload.targetCollectionKey || "",
				collectionName: payload.target_collection_name || payload.targetCollectionName || "",
			});
		}
		if (!decision && !targetCollection) {
			throw new Error("Rule decision or target subcollection is required.");
		}
		let now = new Date().toISOString();
		let ruleIDValue = existing?.rule_id || optionalString(payload.rule_id || payload.ruleID) || ruleID();
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				`INSERT OR REPLACE INTO screening_rules (
				rule_id, label, column_key, operator, match_value, decision, target_collection_key, target_collection_name, enabled, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				ruleIDValue,
				label,
				columnKey,
				operator,
				matchValue,
				decision,
				String(targetCollection?.key || payload.target_collection_key || payload.targetCollectionKey || existing?.target_collection_key || ""),
				String(targetCollection?.name || payload.target_collection_name || payload.targetCollectionName || existing?.target_collection_name || ""),
				payload.enabled === false ? 0 : 1,
				existing?.created_at || now,
				now,
			]
		);
		return {
			ok: true,
			rule_id: ruleIDValue,
			rules: await listRules(reviewer, context),
		};
	}

	async function bulkRun({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let actionKind = normalizeActionKind(payload.action_kind || payload.actionKind || "move");
		let targetDecision = optionalString(payload.decision) ? normalizeDecision(payload.decision) : "";
		let currentDecisionRaw = optionalString(payload.current_decision || payload.currentDecision || "");
		let currentDecision = currentDecisionRaw ? normalizeDecision(currentDecisionRaw) : "";
		let rules = normalizeActionRules(payload);
		let matchMode = normalizeMatchMode(payload.match_mode || payload.matchMode || "and");
		let ruleSummary = describeRuleSet(rules, matchMode);
		let reason = cleanBlockText(payload.reason || (ruleSummary != "whole current scope" ? `Bulk decision on ${ruleSummary}` : `Bulk ${targetDecision || "scope"}`));
		let notes = cleanBlockText(payload.notes || "");
		let rawLimit = Number(payload.limit || 0) || 0;
		let targetCollection = null;
		let targetInfo = null;
		if (actionKind == "filter_copy") {
			targetInfo = await resolveMaterializedFilterTarget(reviewer, current, {
				filter_id: payload.filter_id || payload.filterID || "",
				collection_key: payload.target_collection_key || payload.targetCollectionKey || "",
				name: payload.filter_name || payload.filterName || payload.name || "",
			});
			targetCollection = targetInfo.target;
		}
		else if (optionalString(payload.target_collection_key || payload.targetCollectionKey || payload.target_collection_name || payload.targetCollectionName)) {
			targetCollection = await resolveDecisionTargetCollection({
				reviewer,
				current,
				collectionKey: payload.target_collection_key || payload.targetCollectionKey || "",
				collectionName: payload.target_collection_name || payload.targetCollectionName || "",
			});
		}
		else if (targetDecision) {
			targetCollection = await resolveEditMoveTarget({
				reviewer,
				current,
				edit: { decision: targetDecision },
				fallbackDecision: targetDecision,
			});
		}
		if (!targetCollection) {
			throw new Error(actionKind == "filter_copy"
				? "Bulk filter copy requires a filter target name."
				: "Bulk screening move requires a target subcollection or decision.");
		}
		let requestedJobID = existingJobID(payload);
		let job = requestedJobID ? { job_id: requestedJobID } : null;
		if (!job?.job_id) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "screen-bulk",
				kind: actionKind == "filter_copy" ? "manual_screening_filter" : "manual_screening_bulk",
				title: actionKind == "filter_copy"
					? `Filter copy: ${targetCollection.name || "filter"}`
					: `Bulk screening: ${targetCollection.name || targetDecision || "move"}`,
				requested_mode: currentDecision || "all",
				used_mode: actionKind == "filter_copy"
					? `filter:${targetCollection.name || "copy"}`
					: targetCollection.name || targetDecision || "move",
				source_title: context.collectionName,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}, {
						target_collection_key: String(targetCollection.key || ""),
						target_collection_name: String(targetCollection.name || ""),
					}),
					query: optionalString(payload.query || ""),
					current_decision: currentDecisionRaw,
					target_decision: targetDecision,
					target_collection_key: String(targetCollection.key || ""),
					target_collection_name: String(targetCollection.name || ""),
					match_mode: matchMode,
					rules_json: serializeActionRules(rules),
					action_kind: actionKind,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				refreshControllers: false,
				message: actionKind == "filter_copy"
					? "Screening filter job queued. Track progress in Jobs."
					: "Screening bulk move queued. Track progress in Jobs.",
			});
		}
		try {
			let layoutInfo = actionKind == "move"
				? decisionTargetLayout(reviewer, current)
				: null;
			let scopedItemKeys = [];
			let matchedRecords = [];
			let matchedItemKeys = [];
			let scan = await scanScopedRecords(reviewer, current, payload || {}, {
				rules,
				onBatch: async (records, progress) => {
					await reviewer._throwIfJobCanceled?.(current, job.job_id);
					for (let record of records) {
						if (actionKind == "filter_copy") {
							scopedItemKeys.push(record.item_key);
						}
						if (!matchesRuleSet(record, rules, matchMode)) {
							continue;
						}
						if (rawLimit > 0) {
							matchedRecords.push(record);
						}
						else {
							matchedItemKeys.push(record.item_key);
						}
					}
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						Number(progress.scanned || 0) || 0,
						Number(progress.total || 0) || 0,
						`Scanned ${Number(progress.scanned || 0) || 0}/${Number(progress.total || 0) || 0} scoped records`
					);
				},
			});
			if (rawLimit > 0) {
				matchedRecords.sort((left, right) => compareRecords(left, right, payload));
			}
			let targets = rawLimit > 0
				? matchedRecords.slice(0, rawLimit)
				: matchedItemKeys.map((itemKey) => ({ item_key: itemKey }));
			let targetItemKeys = uniqueItemKeys(targets);
			let filterMaterializedAt = new Date().toISOString();
			let processed = 0;
			if (actionKind == "filter_copy") {
				for (let batch of chunkArray(targetItemKeys, BATCH_WRITE_SIZE)) {
					await reviewer._throwIfJobCanceled?.(current, job.job_id);
					await copyItemsToCollectionBatch({
						current,
						itemKeys: batch,
						targetCollection,
					});
					processed += batch.length;
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						processed,
						targetItemKeys.length,
						`Copied ${processed}/${targetItemKeys.length} records`
					);
				}
			}
			else {
				let effectiveDecision = targetDecision || await decisionForTargetCollection(reviewer, current, targetCollection);
				let sourceType = normalizeDecisionSourceType(payload.source_type || payload.sourceType || "automated", "automated");
				let sourceDetail = cleanBlockText(payload.source_detail || payload.sourceDetail || `Bulk move: ${ruleSummary} -> ${targetCollection.name || targetDecision}`);
				for (let batch of chunkArray(targetItemKeys, BATCH_WRITE_SIZE)) {
					await reviewer._throwIfJobCanceled?.(current, job.job_id);
					await moveItemsToTargetCollectionBatch({
						reviewer,
						current,
						itemKeys: batch,
						targetCollection,
						layoutInfo,
					});
					let statements = batch.map((itemKey) => ({
						sql: `INSERT OR REPLACE INTO screening_decisions (
							item_key,
							decision,
							reason,
							notes,
							target_collection_key,
							target_collection_name,
							source_type,
							source_detail,
							updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						params: [
							itemKey,
							effectiveDecision,
							reason,
							notes,
							String(targetCollection.key || ""),
							String(targetCollection.name || ""),
							sourceType,
							sourceDetail,
							new Date().toISOString(),
						],
					}));
					await executeBatchWrites(reviewer, context, statements);
					processed += batch.length;
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						processed,
						targetItemKeys.length,
						`Updated ${processed}/${targetItemKeys.length} records`
					);
				}
			}
			if (actionKind == "filter_copy") {
				let trackingColumn = await ensureFilterTrackingColumn(reviewer, context, {
					filter_id: targetInfo?.filter_id || payload.filter_id || payload.filterID || "",
					name: targetInfo?.name || payload.filter_name || payload.filterName || payload.name || targetCollection.name || "Filter",
					tracking_column_key: payload.tracking_column_key || payload.trackingColumnKey || "",
					tracking_column_label: payload.tracking_column_label || payload.trackingColumnLabel || "",
				});
				await syncFilterTrackingColumn(
					reviewer,
					context,
					scopedItemKeys,
					targetItemKeys,
					trackingColumn.column_key,
					filterTrackingValue({
						name: targetInfo?.name || targetCollection.name || "Filter",
						rules,
						matchMode,
						})
					);
					let scopeInfo = scopeSnapshot(payload || {}, scan.scope || null);
					let nextFilterID = await upsertFilterDefinition(reviewer, context, {
						filter_id: targetInfo?.filter_id || payload.filter_id || payload.filterID || "",
						name: cleanText(payload.filter_name || payload.filterName || payload.name || targetInfo?.name || targetCollection.name || "Filter"),
					query: cleanBlockText(payload.query || ""),
					decision_filter: currentDecisionRaw,
					source_scope: scopeInfo.scope,
					source_collection_key: scopeInfo.collection_key,
					source_collection_name: scopeInfo.collection_name,
					rules,
					match_mode: matchMode,
					tracking_column_key: trackingColumn.column_key,
					tracking_column_label: trackingColumn.label,
					collection_key: String(targetCollection.key || ""),
					collection_name: cleanText(targetCollection.name || ""),
					last_materialized_at: filterMaterializedAt,
				});
					await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
						used_mode: `filter:${targetCollection.name || "copy"}`,
						output_path: context.databasePath,
						progress_current: targetItemKeys.length,
						progress_total: targetItemKeys.length,
						message: `Copied ${targetItemKeys.length} records into ${targetCollection.name || "Filter"}.`,
						metadata: {
							updated_count: targetItemKeys.length,
							filter_id: nextFilterID,
							target_collection_key: String(targetCollection.key || ""),
							target_collection_name: String(targetCollection.name || ""),
					},
				});
					return {
						ok: true,
						job_id: job.job_id,
						updated_count: targetItemKeys.length,
						filter_id: nextFilterID,
						materialized_filters: await listMaterializedFilters(reviewer, current),
						summary: (await listRecords({
						reviewer,
						current,
						payload: Object.assign({}, payload || {}, { limit: DEFAULT_LIMIT, page: 1 }),
					})).summary,
				};
			}
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
					used_mode: targetCollection.name || targetDecision || "move",
					output_path: context.databasePath,
					progress_current: targetItemKeys.length,
					progress_total: targetItemKeys.length,
					message: `Bulk screening finished. Updated ${targetItemKeys.length} records.`,
					metadata: {
						updated_count: targetItemKeys.length,
						target_decision: targetDecision,
						target_collection_key: String(targetCollection.key || ""),
						target_collection_name: String(targetCollection.name || ""),
				},
			});
			let listing = await listRecords({
				reviewer,
				current,
				payload: Object.assign({}, payload || {}, { limit: DEFAULT_LIMIT, page: 1 }),
			});
				return {
					ok: true,
					job_id: job.job_id,
					updated_count: targetItemKeys.length,
					summary: listing.summary,
				};
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
	}

	async function recomputeRules({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let rules = (await listRules(reviewer, context)).filter((rule) => rule.enabled);
		let currentDecisionRaw = optionalString(payload.current_decision || payload.currentDecision || "");
		let currentDecision = currentDecisionRaw ? normalizeDecision(currentDecisionRaw) : "";
		let rawLimit = Number(payload.limit || 0) || 0;
		let resolvedRules = [];
		for (let rule of rules) {
			let nextDecision = optionalString(rule.decision) ? normalizeDecision(rule.decision) : "";
			let targetCollection = await resolveEditMoveTarget({
				reviewer,
				current,
				edit: {
					decision: nextDecision,
					target_collection_key: rule.target_collection_key,
					target_collection_name: rule.target_collection_name,
				},
				fallbackDecision: nextDecision,
			});
			let effectiveDecision = nextDecision || await decisionForTargetCollection(reviewer, current, targetCollection);
			resolvedRules.push(Object.assign({}, rule, {
				effective_decision: effectiveDecision,
				targetCollection,
			}));
		}
		let requestedJobID = existingJobID(payload);
		let job = requestedJobID ? { job_id: requestedJobID } : null;
		if (!job?.job_id) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "screen-rules",
				kind: "manual_screening_rules",
				title: "Apply screening rules",
				requested_mode: currentDecision || "all",
				used_mode: "rules",
				source_title: context.collectionName,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}),
					rule_count: rules.length,
					query: optionalString(payload.query || ""),
					current_decision: currentDecisionRaw,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				refreshControllers: false,
				message: "Screening rule job queued. Track progress in Jobs.",
			});
		}
		let updated = [];
		try {
			let candidateRecords = [];
			let targetGroups = new Map();
			let checkedRecordsCount = 0;
			let scan = await scanScopedRecords(reviewer, current, payload || {}, {
				rules,
				onBatch: async (records, progress) => {
					await reviewer._throwIfJobCanceled?.(current, job.job_id);
					checkedRecordsCount += records.length;
					if (rawLimit > 0) {
						candidateRecords.push(...records);
					}
					else {
						for (let record of records) {
							let matched = resolvedRules.find((rule) => matchRule(rule, record)) || null;
							if (!matched) {
								continue;
							}
							let targetKey = String(matched.targetCollection?.key || "");
							if (!targetGroups.has(targetKey)) {
								targetGroups.set(targetKey, {
									rule: matched,
									itemKeys: [],
									statements: [],
								});
							}
							let group = targetGroups.get(targetKey);
							group.itemKeys.push(record.item_key);
							group.statements.push({
								sql: `INSERT OR REPLACE INTO screening_decisions (
									item_key,
									decision,
									reason,
									notes,
									target_collection_key,
									target_collection_name,
									source_type,
									source_detail,
									updated_at
								) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
								params: [
									record.item_key,
									matched.effective_decision,
									`Rule: ${matched.label}`,
									record.notes || "",
									String(matched.targetCollection?.key || ""),
									String(matched.targetCollection?.name || ""),
									"automated",
									`Rule match: ${matched.label}`,
									new Date().toISOString(),
								],
							});
							updated.push({
								item_key: record.item_key,
								rule_id: matched.rule_id,
								label: matched.label,
								decision: matched.decision,
							});
						}
					}
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						Number(progress.scanned || 0) || 0,
						Number(progress.total || 0) || 0,
						`Checked ${Number(progress.scanned || 0) || 0}/${Number(progress.total || 0) || 0} scoped records`
					);
				},
			});
			let targets = [];
			if (rawLimit > 0) {
				candidateRecords.sort((left, right) => compareRecords(left, right, payload));
				targets = candidateRecords.slice(0, rawLimit);
				for (let record of targets) {
					let matched = resolvedRules.find((rule) => matchRule(rule, record)) || null;
					if (!matched) {
						continue;
					}
					let targetKey = String(matched.targetCollection?.key || "");
					if (!targetGroups.has(targetKey)) {
						targetGroups.set(targetKey, {
							rule: matched,
							itemKeys: [],
							statements: [],
						});
					}
					let group = targetGroups.get(targetKey);
					group.itemKeys.push(record.item_key);
					group.statements.push({
						sql: `INSERT OR REPLACE INTO screening_decisions (
							item_key,
							decision,
							reason,
							notes,
							target_collection_key,
							target_collection_name,
							source_type,
							source_detail,
							updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						params: [
							record.item_key,
							matched.effective_decision,
							`Rule: ${matched.label}`,
							record.notes || "",
							String(matched.targetCollection?.key || ""),
							String(matched.targetCollection?.name || ""),
							"automated",
							`Rule match: ${matched.label}`,
							new Date().toISOString(),
						],
					});
					updated.push({
						item_key: record.item_key,
						rule_id: matched.rule_id,
						label: matched.label,
						decision: matched.decision,
					});
				}
				}
				let processed = 0;
			for (let group of targetGroups.values()) {
				for (let itemKeyBatch of chunkArray(group.itemKeys, BATCH_WRITE_SIZE)) {
					await reviewer._throwIfJobCanceled?.(current, job.job_id);
					let statementBatch = group.statements.splice(0, itemKeyBatch.length);
					await moveItemsToTargetCollectionBatch({
						reviewer,
						current,
						itemKeys: itemKeyBatch,
						targetCollection: group.rule.targetCollection,
					});
					await executeBatchWrites(reviewer, context, statementBatch);
					processed += itemKeyBatch.length;
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						processed,
						updated.length,
						`Applied ${processed}/${updated.length} rule updates`
					);
				}
			}
				let checkedCount = rawLimit > 0 ? targets.length : checkedRecordsCount;
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: "rules",
				output_path: context.databasePath,
				progress_current: updated.length,
				progress_total: updated.length,
				message: `Rule recompute finished. Updated ${updated.length} records.`,
				metadata: {
					updated_count: updated.length,
					rule_count: rules.length,
				},
			});
			let listing = await listRecords({
				reviewer,
				current,
				payload: Object.assign({}, payload || {}, { limit: DEFAULT_LIMIT, page: 1 }),
			});
			return {
				ok: true,
				job_id: job.job_id,
				rule_count: rules.length,
				checked_count: checkedCount,
				updated_count: updated.length,
				updated,
				summary: listing.summary,
			};
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
	}

	async function summaryState({ reviewer, current }) {
		let result = await listRecords({ reviewer, current, payload: { limit: 1, page: 1 } });
		return {
			ok: true,
			summary: result.summary,
		};
	}

	async function completeTitleAbstractStage({ reviewer, current, payload = {} }) {
		let result = await listRecords({
			reviewer,
			current,
			payload: Object.assign({}, payload || {}, { limit: 1, page: 1 }),
		});
		let rawSummary = result?.summary || {};
		let summary = Object.assign({}, rawSummary, {
			total: Number(rawSummary?.total_records || 0) || 0,
			pending: Number(rawSummary?.pending_count || 0) || 0,
			included: Number(rawSummary?.included_count || 0) || 0,
			excluded: Number(rawSummary?.excluded_count || 0) || 0,
			maybe: Number(rawSummary?.maybe_count || 0) || 0,
			reviewed: Number(rawSummary?.reviewed_count || 0) || 0,
		});
		return {
			ok: true,
			stage: "title_abstract_screening",
			scope: result.scope,
			summary,
			available_scopes: availableScopes(reviewer, current),
			next_recommended_stage: "full_text_retrieval",
			note: "Title/abstract screening is complete when excluded items have been moved out of Pending and remaining survivors stay in Pending for retrieval.",
		};
	}

	return {
		ensureSchema,
		reviewCollections,
		mergedState,
		availableScopes,
		availableDecisionTargets,
		normalizeActionRule,
		normalizeMatchMode,
		extractNumericValue,
		matchesRuleSet,
		operatorMatches,
		recordValue,
		upsertColumnDefinition,
		deleteColumnDefinition,
		upsertDecision,
		writeColumnValue,
		listValueTemplates,
		saveValueTemplates,
		addValueTemplateValue,
		getPreference,
		setPreference,
		listColumns,
		listDynamicColumnCatalog,
		listAllColumnDefinitions,
		listRecords,
		searchRecords,
		listSavedRuns,
		loadSavedRun,
		compareSavedRuns,
		listMaterializedFilters,
		materializeFilter,
		deleteMaterializedFilter,
		openItem,
		openPdf,
		openFullText,
		fullTextSummaryForItem,
		pdfSourcesForItem,
		queueMarkdownConversionsForSources,
		findItemFullText,
		uploadFullTextPdf,
		inspectScopeFullText,
		excludeMissingMarkdownInScope,
		saveRun,
		updateDecision,
		createColumn,
		deleteColumn,
		updateComment,
		saveEdits,
		updateRules,
		recomputeRules,
		bulkRun,
		tableFromDatabase,
		exportCSV,
		exportCSVSaveAs,
		summaryState,
		completeTitleAbstractStage,
	};
})();
