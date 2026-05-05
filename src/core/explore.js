var SystematicReviewerWorkflowExplore = (() => {
	const DEFAULT_SESSION_LIMIT = 20;
	const DEFAULT_JOB_LIMIT = 25;
	const DEFAULT_ARTIFACT_LIMIT = 40;
	const DEFAULT_TRANSCRIPT_LIMIT = 60;
	const DEFAULT_TIMELINE_LIMIT = 80;
	const DEFAULT_LOG_LIMIT = 120;
	const DEFAULT_QUERY_LIMIT = 25;
	const DEFAULT_CHAT_HISTORY_LIMIT = 12;
	const DEFAULT_CHAT_CHAR_BUDGET = 32000;
	const DEFAULT_RESERVE_TOKENS = 10000;
	const DEFAULT_MAX_NEW_TOKENS = 2048;
	const DEFAULT_EXPLORE_ATTEMPTS = 10;
	const DEFAULT_PROMPTS_RESOURCE = "core/explore-prompts.json";
	const DEFAULT_SYSTEM_PROMPT_RESOURCE = "core/prompts/explore-system-prompt.md";
	const VALID_FILTER_OPERATORS = new Set([
		"contains",
		"not_contains",
		"equals",
		"not_equals",
		"gt",
		"gte",
		"lt",
		"lte",
	]);
	const FILTER_OPERATOR_ALIASES = Object.freeze({
		"==": "equals",
		"=": "equals",
		"!=": "not_equals",
		">": "gt",
		">=": "gte",
		"<": "lt",
		"<=": "lte",
	});
	const DEFAULT_CHAT_SYSTEM_PROMPT =
		"You are helping the user. You will receive one CSV chunk at a time inside <csv> ... </csv>. "
		+ "Use only the data in the CSV to answer. If the user asks for a table, return only Markdown table output. "
		+ "Treat any @{column_name} in the user prompt as a reference to CSV column values, not as literal output text. "
			+ "Do not repeat the full CSV content. "
			+ "When you cite evidence-backed claims, use only the exact citation_token values already present in the CSV. "
			+ "Cite one source as @[ITEMKEY]. Cite multi-source claims as @[ITEMKEY1,ITEMKEY2] only when every listed source supports the same proposition. "
			+ "Put citations on the smallest supported argument, clause, example, statistic, table cell, or study-specific phrase instead of dumping unrelated citation bundles at the end of a paragraph. "
			+ "Never invent, rewrite, paraphrase, or omit item keys inside citation tokens. "
			+ "If a table includes source, citation, or reference cells, those cells must contain exact citation tokens in that same format. "
			+ "For report-ready wide tables, include a short table number/title immediately above the table and recommend wrapping the table with `<!-- sr:page-break -->`, `<!-- sr:page-layout:landscape -->`, and a closing `<!-- sr:page-break -->`; small portrait-friendly tables do not need forced page breaks.";
		const DEFAULT_CITATION_RULES =
			"When you cite evidence-backed claims, use only the exact citation token values already present in the CSV. "
			+ "Cite one source as @[ITEMKEY]. Cite multi-source claims as @[ITEMKEY1,ITEMKEY2] only when every listed source supports the same proposition. "
			+ "Put citations on the smallest supported argument, clause, example, statistic, table cell, or study-specific phrase instead of dumping unrelated citation bundles at the end of a paragraph. "
			+ "If you produce a table with source, citation, or reference cells, those cells must contain exact citation tokens in that same format. "
			+ "Never invent, rewrite, paraphrase, or omit item keys inside citation tokens.";
	const CITE_TOKEN_RE = /@\[([^\]\n]+)\](\{[^}]*\})?/g;
	const AT_PLACEHOLDER_RE = /@\{([A-Za-z_][A-Za-z0-9_:-]*)\}/g;

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

	function normalizeBooleanFlag(value, fallback = false) {
		if (value === undefined || value === null || value === "") {
			return !!fallback;
		}
		if (typeof value == "boolean") {
			return value;
		}
		let text = optionalString(value).toLowerCase();
		if (!text) {
			return !!fallback;
		}
		if (["true", "1", "yes", "y", "on"].includes(text)) {
			return true;
		}
		if (["false", "0", "no", "n", "off"].includes(text)) {
			return false;
		}
		return !!fallback;
	}

	function normalizeLimit(value, fallback, max = 500) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return fallback;
		}
		return Math.max(1, Math.min(max, Math.round(parsed)));
	}

	function normalizeOperator(value) {
		let operator = optionalString(value || "contains").toLowerCase();
		operator = FILTER_OPERATOR_ALIASES[operator] || operator;
		if (!VALID_FILTER_OPERATORS.has(operator)) {
			throw new Error("Filter operator must be contains, not_contains, equals, not_equals, gt, gte, lt, or lte.");
		}
		return operator;
	}

	function normalizeDecisionFilter(value) {
		let raw = optionalString(value || "").toLowerCase();
		if (!raw || raw == "all" || raw == "any") {
			return "";
		}
		if (["include", "exclude", "maybe", "unreviewed"].includes(raw)) {
			return raw;
		}
		throw new Error("Decision filter must be include, exclude, maybe, or unreviewed.");
	}

	function previewText(text, maxLength = 360) {
		let value = String(text || "").trim().replace(/\s+/g, " ");
		if (!value) {
			return "";
		}
		return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
	}

	function countWords(text) {
		let value = String(text || "").trim();
		if (!value) {
			return 0;
		}
		return value.split(/\s+/).filter(Boolean).length;
	}

	function nowStamp() {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	function sanitizeSlug(reviewer, value, fallback = "explore") {
		let base = String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return reviewer._sanitizeFileName(base || fallback);
	}

	function rowValue(row, name) {
		return SystematicReviewerWorkflowEmbeddings.rowValue(row, name);
	}

	function outputRoot(reviewer, context) {
		return reviewer._joinPath(context.outputsDir, "explore");
	}

	function chatRoot(reviewer, context) {
		return reviewer._joinPath(outputRoot(reviewer, context), "chats");
	}

	function markdownRoot(reviewer, context) {
		return outputRoot(reviewer, context);
	}

	function markdownRunPath(reviewer, context, name) {
		let stamp = nowStamp();
		let slug = sanitizeSlug(reviewer, name, "explore-run");
		return reviewer._joinPath(markdownRoot(reviewer, context), `${stamp}-${slug}.md`);
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

	function sessionIDFromPayload(payload = {}, current, sessions = []) {
		let requested = String(payload.session_id || payload.sessionID || "").trim();
		if (requested && sessions.some((entry) => entry.session_id == requested)) {
			return requested;
		}
		let active = sessions.find((entry) => entry.is_active);
		if (active?.session_id) {
			return active.session_id;
		}
		if (current?.sessionID && sessions.some((entry) => entry.session_id == current.sessionID)) {
			return current.sessionID;
		}
		return sessions[0]?.session_id || "";
	}

	function jobIDFromPayload(payload = {}, jobs = []) {
		let requested = String(payload.job_id || payload.jobID || "").trim();
		if (requested && jobs.some((entry) => entry.job_id == requested)) {
			return requested;
		}
		return jobs[0]?.job_id || "";
	}

	function tokenizeQuery(value) {
		return Array.from(new Set((String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])));
	}

	function valueText(value) {
		if (value === null || value === undefined) {
			return "";
		}
		if (typeof value == "string") {
			return value;
		}
		if (typeof value == "number" || typeof value == "boolean") {
			return String(value);
		}
		try {
			return JSON.stringify(value);
		}
		catch (_error) {
			return String(value);
		}
	}

	function estimateTokens(text) {
		if (!text) {
			return 0;
		}
		return Math.max(1, Math.ceil(String(text).length / 4));
	}

	function estimateMessagesTokens(messages = []) {
		let total = 0;
		for (let message of Array.isArray(messages) ? messages : []) {
			if (!message || typeof message != "object") {
				continue;
			}
			total += estimateTokens(String(message.content || ""));
			total += estimateTokens(String(message.thinking || ""));
		}
		return total;
	}

	function normalizeContextOverride(value) {
		let parsed = Number(value || 0) || 0;
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return 0;
		}
		return Math.max(0, Math.round(parsed));
	}

	function numericValue(value) {
		let text = optionalString(value);
		if (!text) {
			return null;
		}
		let numeric = Number(text);
		return Number.isFinite(numeric) ? numeric : null;
	}

	function formatCell(value) {
		if (value === null || value === undefined) {
			return "";
		}
		if (typeof value == "number" && Number.isNaN(value)) {
			return "";
		}
		if (Array.isArray(value) || (value && typeof value == "object")) {
			try {
				return JSON.stringify(value);
			}
			catch (_error) {
				return String(value);
			}
		}
		return String(value);
	}

	function splitThinkBlocks(text) {
		let raw = String(text || "");
		if (!raw) {
			return { visible: "", thinking: "" };
		}
		let thoughts = [];
		let visible = raw.replace(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/gi, (_match, group) => {
			let chunk = String(group || "").trim();
			if (chunk) {
				thoughts.push(chunk);
			}
			return "";
		});
		return {
			visible: visible.trim(),
			thinking: thoughts.join("\n\n").trim(),
		};
	}

	function extractColumnPlaceholders(texts = []) {
		let names = [];
		let seen = new Set();
		for (let text of Array.isArray(texts) ? texts : []) {
			if (typeof text != "string" || !text.includes("@{")) {
				continue;
			}
			for (let match of text.matchAll(AT_PLACEHOLDER_RE)) {
				let name = optionalString(match?.[1]);
				if (!name || seen.has(name)) {
					continue;
				}
				seen.add(name);
				names.push(name);
			}
		}
		return names;
	}

	function hasColumnPlaceholders(texts = []) {
		return extractColumnPlaceholders(texts).length > 0;
	}

	function parseCitationTokens(text = "") {
		let out = [];
		let seen = new Set();
		for (let match of String(text || "").matchAll(CITE_TOKEN_RE)) {
			let raw = optionalString(match?.[0]);
			let keys = optionalString(match?.[1])
				.split(",")
				.map((value) => optionalString(value))
				.filter(Boolean);
			if (!raw || !keys.length || seen.has(raw)) {
				continue;
			}
			seen.add(raw);
			out.push({
				token: raw,
				keys,
				attributes: optionalString(match?.[2]),
			});
		}
		return out;
	}

	function promptSummary(prompt = "", max = 220) {
		return previewText(String(prompt || "").replace(/\s+/g, " ").trim(), max);
	}

	function safeParseJSON(text, fallback) {
		try {
			return JSON.parse(text);
		}
		catch (_error) {
			return fallback;
		}
	}

	function baseColumnDefinitions() {
		return [
			{ key: "citation_token", prompt_key: "citation_token", label: "Citation token", origin: "builtin", search: false },
			{ key: "item_key", prompt_key: "item_key", label: "Item key", origin: "builtin", search: false },
			{ key: "citation_text", prompt_key: "citation_text", label: "Citation", origin: "builtin", search: true },
			{ key: "title", prompt_key: "title", label: "Title", origin: "builtin", search: true },
			{ key: "publication_title", prompt_key: "publication_title", label: "Publication title", origin: "builtin", search: true },
			{ key: "abstract_note", prompt_key: "abstract_note", label: "Abstract", origin: "builtin", search: true },
			{ key: "abstract_origin", prompt_key: "abstract_origin", label: "Abstract origin", origin: "builtin", search: true },
			{ key: "year", prompt_key: "year", label: "Year", origin: "builtin", search: true },
			{ key: "doi", prompt_key: "doi", label: "DOI", origin: "builtin", search: true },
			{ key: "decision", prompt_key: "decision", label: "Decision", origin: "screening", search: true },
			{ key: "reason", prompt_key: "reason", label: "Reason", origin: "screening", search: true },
			{ key: "notes", prompt_key: "notes", label: "Notes", origin: "screening", search: true },
			{ key: "zotero_uri", prompt_key: "zotero_uri", label: "Zotero URI", origin: "builtin", search: false },
		];
	}

	function scopeDescriptor(reviewer, current, payload = {}) {
		return SystematicReviewerWorkflowEmbeddings.scopeDescriptor
			? SystematicReviewerWorkflowEmbeddings.scopeDescriptor(reviewer, current, payload)
			: null;
	}

	async function collectionRecords(reviewer, current, payload = {}, options = {}) {
		let result = await SystematicReviewerWorkflowEmbeddings.projectItemRows(reviewer, current, payload, options);
		let rows = Array.isArray(result) ? result : result?.rows || [];
		let mapped = rows.map((row) => ({
			item_key: row.item_key,
			citation_token: row.citation_token,
			citation_text: row.citation_text,
			openalex_id: row.openalex_id,
			title: row.title,
			publication_title: row.publication_title,
			abstract_note: row.abstract_note,
			abstract_origin: row.abstract_origin,
			year: row.year,
			doi: row.doi,
			zotero_uri: row.zotero_uri,
		}));
		return Array.isArray(result) ? mapped : Object.assign({}, result || {}, { rows: mapped });
	}

	async function readBundledResourceText(reviewer, assetPath = "") {
		let base = String(reviewer?.rootURI || "").trim();
		let resourcePath = optionalString(assetPath);
		if (!base || !resourcePath) {
			return "";
		}
		try {
			let response = await fetch(`${base}${resourcePath}`);
			if (!response?.ok) {
				throw new Error(`HTTP ${response?.status || 0}`);
			}
			return String(await response.text() || "");
		}
		catch (_error) {
			return "";
		}
	}

	async function readBundledPromptResource(reviewer) {
		let defaultSystemPrompt = optionalString(
			await readBundledResourceText(reviewer, DEFAULT_SYSTEM_PROMPT_RESOURCE)
		) || DEFAULT_CHAT_SYSTEM_PROMPT;
		let rawJSON = await readBundledResourceText(reviewer, DEFAULT_PROMPTS_RESOURCE);
		if (!rawJSON) {
			return {
				default_system_prompt: defaultSystemPrompt,
				citation_rules: DEFAULT_CITATION_RULES,
			};
		}
		let parsed = safeParseJSON(rawJSON, {});
		return {
			default_system_prompt: optionalString(parsed?.default_system_prompt) || defaultSystemPrompt,
			citation_rules: optionalString(parsed?.citation_rules) || DEFAULT_CITATION_RULES,
			chunk_user_template: optionalString(parsed?.chunk_user_template),
			summary_prompt_markdown: String(parsed?.summary_prompt_markdown || ""),
			summary_prompt_json: String(parsed?.summary_prompt_json || ""),
		};
	}

	function scopeChoices(reviewer, current) {
		return SystematicReviewerWorkflowEmbeddings?.availableScopes
			? SystematicReviewerWorkflowEmbeddings.availableScopes(reviewer, current, {
				purpose: "explore",
			})
			: [];
	}

	function scopePayloadForCollectionKey(collectionKey = "") {
		let nextKey = optionalString(collectionKey);
		if (!nextKey) {
			return {};
		}
		return {
			collection_key: nextKey,
		};
	}

	function citationIndex(rows = []) {
		let byToken = new Map();
		let byKey = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(row?.item_key);
			let token = optionalString(row?.citation_token) || (itemKey ? `@[${itemKey}]` : "");
			if (!itemKey || !token) {
				continue;
			}
			let entry = {
				token,
				item_keys: [itemKey],
				citation_text: optionalString(row?.citation_text || row?.title || itemKey),
				title: optionalString(row?.title),
				year: optionalString(row?.year),
				item_key: itemKey,
			};
			byKey.set(itemKey, entry);
			byToken.set(token, entry);
		}
		return { byToken, byKey };
	}

	function resolveCitationMetadataFromText(text = "", index = null) {
		let resolved = [];
		let seen = new Set();
		for (let token of parseCitationTokens(text)) {
			let labels = token.keys.map((itemKey) => {
				let entry = index?.byKey?.get(itemKey) || null;
				return {
					item_key: itemKey,
					citation_text: optionalString(entry?.citation_text || itemKey),
					title: optionalString(entry?.title),
					year: optionalString(entry?.year),
				};
			});
			if (seen.has(token.token)) {
				continue;
			}
			seen.add(token.token);
			resolved.push({
				token: token.token,
				item_keys: token.keys.slice(),
				labels,
			});
		}
		return resolved;
	}

	function renderCitationText(text = "", index = null) {
		let citations = resolveCitationMetadataFromText(text, index);
		if (!citations.length) {
			return String(text || "");
		}
		let rendered = String(text || "");
		for (let citation of citations) {
			let label = citation.labels.map((entry) => entry.citation_text || entry.item_key).filter(Boolean).join("; ");
			rendered = rendered.split(citation.token).join(label || citation.token);
		}
		return rendered;
	}

	function buildChatMessage(entry = {}, index = null) {
		let rawContent = String(entry.content || "");
		let split = splitThinkBlocks(rawContent);
		let visible = split.visible || rawContent.trim();
		let citations = Array.isArray(entry.citations) && entry.citations.length
			? entry.citations
			: resolveCitationMetadataFromText(visible, index);
		let renderedContent = String(entry.rendered_content || renderCitationText(visible, index) || visible);
		return {
			role: optionalString(entry.role) || "assistant",
			content: visible,
			raw_content: rawContent,
			rendered_content: renderedContent,
			citations,
			thinking: optionalString(entry.thinking || split.thinking),
			created_at: optionalString(entry.created_at) || new Date().toISOString(),
			query: optionalString(entry.query),
			decision_filter: optionalString(entry.decision_filter),
			row_count: Number(entry.row_count || 0) || 0,
			column_keys: Array.isArray(entry.column_keys) ? entry.column_keys.map((value) => optionalString(value)).filter(Boolean) : [],
			csv_path: optionalString(entry.csv_path),
			model: optionalString(entry.model),
			summary: !!entry.summary,
			batch: entry.batch === null || entry.batch === undefined ? null : Number(entry.batch),
			runtime_role_id: optionalString(entry.runtime_role_id || entry.role_id),
			runtime_label: optionalString(entry.runtime_label),
			scope: entry.scope || null,
		};
	}

	function interpolationTemplate(template = "", values = {}) {
		return String(template || "").replace(/\{([a-z_]+)\}/gi, (_match, key) => String(values?.[key] ?? ""));
	}

	async function screeningState(reviewer, current, payload = {}, options = {}) {
		let merged = await SystematicReviewerWorkflowScreening.mergedState(reviewer, current, payload, {
			itemKeys: Array.isArray(options?.itemKeys) ? options.itemKeys : null,
			columns: Array.isArray(options?.columns) ? options.columns : null,
		});
		let decisions = new Map();
		let values = new Map();
		for (let record of merged.records || []) {
			let itemKey = optionalString(record?.item_key);
			if (!itemKey) {
				continue;
			}
			decisions.set(itemKey, {
				decision: optionalString(record.decision),
				reason: String(record.reason || ""),
				notes: String(record.notes || ""),
			});
			let bucket = {};
			for (let column of merged.columns || []) {
				let columnKey = optionalString(column?.column_key);
				if (!columnKey) {
					continue;
				}
				bucket[`screening:${columnKey}`] = String(record.custom_values?.[columnKey] || "");
			}
			values.set(itemKey, bucket);
		}
		let columns = (merged.columns || []).map((column) => ({
			key: `screening:${optionalString(column.column_key)}`,
			prompt_key: optionalString(column.column_key),
			label: `Screening: ${optionalString(column.label) || optionalString(column.column_key)}`,
			origin: "screening",
			search: true,
		}));
		return { decisions, columns, values };
	}

	async function extractionState(reviewer, context, allowedItemKeys = null) {
		await SystematicReviewerWorkflowExtraction.ensureSchema(reviewer, context);
		let metadataFields = [
			["template_name", "Template"],
			["template_path", "Template path"],
			["source_key", "Source"],
			["status", "Status"],
			["error_message", "Error"],
			["model", "Model"],
			["run_id", "Run ID"],
			["created_at", "Created"],
			["updated_at", "Updated"],
		];
		let allowed = allowedItemKeys instanceof Set ? allowedItemKeys : null;
		let allowedList = allowed ? Array.from(allowed).filter(Boolean) : [];
		let queryKeys = allowedList.length > 0 && allowedList.length <= 500 ? allowedList : [];
		let where = queryKeys.length ? `WHERE item_key IN (${queryKeys.map(() => "?").join(", ")})` : "";
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				item_key,
				field_key,
				field_label,
				template_name,
				template_path,
				source_key,
				COALESCE(value_text, '') AS value_text,
				COALESCE(status, '') AS status,
				COALESCE(error_message, '') AS error_message,
				COALESCE(model, '') AS model,
				COALESCE(run_id, '') AS run_id,
				created_at,
				updated_at
			 FROM extraction_values
			 ${where}
			 ORDER BY updated_at DESC, item_key ASC, field_key ASC`,
			queryKeys
		);
		let columnsByKey = new Map();
		let values = new Map();
		let seen = new Set();
		for (let row of rows || []) {
			let itemKey = optionalString(rowValue(row, "item_key"));
			let fieldKey = optionalString(rowValue(row, "field_key"));
			if (!itemKey || !fieldKey || (allowed && allowed.size && !allowed.has(itemKey))) {
				continue;
			}
			let exploreKey = `extraction:${fieldKey}`;
			if (!columnsByKey.has(exploreKey)) {
				let fieldLabel = optionalString(rowValue(row, "field_label")) || fieldKey;
				columnsByKey.set(exploreKey, {
					key: exploreKey,
					prompt_key: exploreKey,
					label: `Extraction: ${fieldLabel}`,
					origin: "extraction",
					search: true,
				});
				for (let [metadataKey, metadataLabel] of metadataFields) {
					let metaColumnKey = `extraction_meta:${fieldKey}:${metadataKey}`;
					columnsByKey.set(metaColumnKey, {
						key: metaColumnKey,
						prompt_key: metaColumnKey,
						label: `Extraction metadata: ${fieldLabel} ${metadataLabel}`,
						origin: "extraction_metadata",
						search: true,
					});
				}
			}
			let dedupeKey = `${itemKey}::${exploreKey}`;
			if (seen.has(dedupeKey)) {
				continue;
			}
			seen.add(dedupeKey);
			let bucket = values.get(itemKey);
			if (!bucket) {
				bucket = {};
				values.set(itemKey, bucket);
			}
			bucket[exploreKey] = String(rowValue(row, "value_text") || "");
			bucket[`extraction_meta:${fieldKey}:template_name`] = optionalString(rowValue(row, "template_name"));
			bucket[`extraction_meta:${fieldKey}:template_path`] = optionalString(rowValue(row, "template_path"));
			bucket[`extraction_meta:${fieldKey}:source_key`] = optionalString(rowValue(row, "source_key"));
			bucket[`extraction_meta:${fieldKey}:status`] = optionalString(rowValue(row, "status"));
			bucket[`extraction_meta:${fieldKey}:error_message`] = String(rowValue(row, "error_message") || "");
			bucket[`extraction_meta:${fieldKey}:model`] = optionalString(rowValue(row, "model"));
			bucket[`extraction_meta:${fieldKey}:run_id`] = optionalString(rowValue(row, "run_id"));
			bucket[`extraction_meta:${fieldKey}:created_at`] = optionalString(rowValue(row, "created_at"));
			bucket[`extraction_meta:${fieldKey}:updated_at`] = optionalString(rowValue(row, "updated_at"));
		}
		return {
			columns: Array.from(columnsByKey.values()),
			values,
		};
	}

	async function dataset(reviewer, current, payload = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let baseRows = await collectionRecords(reviewer, current, payload);
		let allowedItemKeys = new Set(baseRows.map((record) => String(record.item_key || "")).filter(Boolean));
		let [screening, extraction] = await Promise.all([
			screeningState(reviewer, current, payload),
			extractionState(reviewer, context, allowedItemKeys),
		]);
		let columns = baseColumnDefinitions()
			.concat(screening.columns)
			.concat(extraction.columns);
		let rows = baseRows.map((record) => {
			let decision = screening.decisions.get(record.item_key) || {};
			let next = Object.assign({}, record, {
				decision: String(decision.decision || ""),
				reason: String(decision.reason || ""),
				notes: String(decision.notes || ""),
			});
			Object.assign(next, screening.values.get(record.item_key) || {});
			Object.assign(next, extraction.values.get(record.item_key) || {});
			return next;
		});
		return {
			columns: applyPromptKeys(columns),
			rows,
			scope: scopeDescriptor(reviewer, current, payload),
		};
	}

	function applyPromptKeys(columns = []) {
		let used = new Set();
		return (columns || []).map((column) => {
			let next = Object.assign({}, column || {});
			let promptKey = optionalString(next.prompt_key || next.promptKey || next.key);
			if (!promptKey) {
				promptKey = optionalString(next.key);
			}
			let normalized = promptKey.toLowerCase();
			if (!normalized || used.has(normalized)) {
				promptKey = optionalString(next.key);
				normalized = promptKey.toLowerCase();
			}
			if (normalized && used.has(normalized)) {
				let suffix = 2;
				let candidate = `${promptKey}_${suffix}`;
				while (used.has(candidate.toLowerCase())) {
					suffix += 1;
					candidate = `${promptKey}_${suffix}`;
				}
				promptKey = candidate;
				normalized = candidate.toLowerCase();
			}
			if (normalized) {
				used.add(normalized);
			}
			next.prompt_key = promptKey || optionalString(next.key);
			return next;
		});
	}

	function columnAliasMap(columns = []) {
		let aliases = new Map();
		for (let column of columns) {
			let key = optionalString(column?.key).toLowerCase();
			let promptKey = optionalString(column?.prompt_key || column?.promptKey).toLowerCase();
			let label = optionalString(column?.label).toLowerCase();
			if (key) {
				aliases.set(key, column.key);
			}
			if (promptKey) {
				aliases.set(promptKey, column.key);
			}
			if (label) {
				aliases.set(label, column.key);
			}
		}
		return aliases;
	}

	function resolveColumnKey(rawValue, columns = [], aliases = null) {
		let value = optionalString(rawValue).toLowerCase();
		if (!value) {
			return "";
		}
		let nextAliases = aliases || columnAliasMap(columns);
		return nextAliases.get(value) || "";
	}

	function normalizeFilters(filters, columns = []) {
		let aliases = columnAliasMap(columns);
		let out = [];
		for (let filter of Array.isArray(filters) ? filters : []) {
			let columnKey = resolveColumnKey(filter?.column || filter?.key, columns, aliases);
			if (!columnKey) {
				throw new Error(`Unknown filter column '${filter?.column || filter?.key || ""}'.`);
			}
			out.push({
				column: columnKey,
				operator: normalizeOperator(filter?.operator || filter?.op),
				value: valueText(filter?.value),
			});
		}
		return out;
	}

	function matchesFilter(row, filter) {
		let actualText = valueText(row?.[filter.column]);
		let actual = actualText.toLowerCase();
		let expectedText = valueText(filter.value);
		let expected = expectedText.toLowerCase();
		if (filter.operator == "contains") {
			return actual.includes(expected);
		}
		if (filter.operator == "not_contains") {
			return !actual.includes(expected);
		}
		if (filter.operator == "equals") {
			return actual == expected;
		}
		if (filter.operator == "not_equals") {
			return actual != expected;
		}
		let left = numericValue(actualText);
		let right = numericValue(expectedText);
		if (left === null || right === null) {
			return false;
		}
		if (filter.operator == "gt") {
			return left > right;
		}
		if (filter.operator == "gte") {
			return left >= right;
		}
		if (filter.operator == "lt") {
			return left < right;
		}
		if (filter.operator == "lte") {
			return left <= right;
		}
		return true;
	}

	function selectedSearchColumns(columns, payload = {}) {
		let requested = Array.isArray(payload.columns)
			? payload.columns
			: (Array.isArray(payload.search_columns) ? payload.search_columns : []);
		if (!requested.length) {
			return columns.filter((column) => column.search !== false).map((column) => column.key);
		}
		let aliases = columnAliasMap(columns);
		return requested
			.map((entry) => resolveColumnKey(entry, columns, aliases))
			.filter(Boolean);
	}

	function preferredChatColumns(columns = [], searchColumns = []) {
		let available = new Set(columns.map((column) => column.key));
		let keys = [];
		let append = (key) => {
			if (!key || !available.has(key) || keys.includes(key)) {
				return;
			}
			keys.push(key);
		};
		["item_key", "citation_text", "title", "year", "decision", "abstract_note"].forEach(append);
		for (let key of searchColumns || []) {
			append(key);
		}
		return keys;
	}

	function preferredExploreColumns(columns = [], promptColumns = []) {
		let available = new Set(columns.map((column) => column.key));
		let keys = [];
		let append = (key) => {
			if (!key || !available.has(key) || keys.includes(key)) {
				return;
			}
			keys.push(key);
		};
		["citation_token", "citation_text", "title"].forEach(append);
		for (let key of promptColumns || []) {
			append(key);
		}
		return keys;
	}

	function matchQuery(row, queryText, tokens = [], searchColumns = [], columns = []) {
		if (!tokens.length && !queryText) {
			return {
				ok: true,
				score: 0,
				matched_columns: [],
			};
		}
		let phrase = optionalString(queryText).toLowerCase();
		let foundTokens = new Set();
		let matchedColumns = [];
		let score = 0;
		let columnSet = new Set(searchColumns);
		for (let column of columns) {
			if (!columnSet.has(column.key)) {
				continue;
			}
			let text = valueText(row?.[column.key]).toLowerCase();
			if (!text) {
				continue;
			}
			let matchedHere = false;
			if (phrase && text.includes(phrase)) {
				score += 3;
				matchedHere = true;
			}
			for (let token of tokens) {
				if (text.includes(token)) {
					foundTokens.add(token);
					score += 1;
					matchedHere = true;
				}
			}
			if (matchedHere) {
				matchedColumns.push(column.label || column.key);
			}
		}
		return {
			ok: tokens.every((token) => foundTokens.has(token)),
			score,
			matched_columns: matchedColumns,
		};
	}

	function summaryValues(row, columns = [], matchedColumnLabels = []) {
		let wanted = ["decision", "reason", "notes"];
		let labels = new Set(matchedColumnLabels || []);
		let selected = [];
		for (let column of columns) {
			let value = valueText(row?.[column.key]);
			if (!value) {
				continue;
			}
			if (
				wanted.includes(column.key)
				|| column.origin == "screening"
				|| column.origin == "extraction"
				|| labels.has(column.label || column.key)
			) {
				selected.push({
					key: column.key,
					label: column.label || column.key,
					value_text: value,
					origin: column.origin || "builtin",
				});
			}
		}
		return selected.slice(0, 8);
	}

	function selectionState(data, payload = {}) {
		let columns = data?.columns || [];
		let rows = data?.rows || [];
		let queryText = optionalString(payload.query);
		let tokens = tokenizeQuery(queryText);
		let searchColumns = selectedSearchColumns(columns, payload);
		let filters = [];
		let decisionFilter = "";
		let filtered = [];
		for (let row of rows) {
			let match = matchQuery(row, queryText, tokens, searchColumns, columns);
			if (!match.ok) {
				continue;
			}
			filtered.push(Object.assign({}, row, {
				match_score: match.score,
				matched_columns: match.matched_columns,
			}));
		}
		filtered.sort((left, right) => {
			let scoreDelta = Number(right.match_score || 0) - Number(left.match_score || 0);
			if (scoreDelta) {
				return scoreDelta;
			}
			return String(left.title || "").localeCompare(String(right.title || "")) || String(left.item_key || "").localeCompare(String(right.item_key || ""));
		});
		return {
			queryText,
			filters,
			searchColumns,
			decisionFilter,
			rows,
			columns,
			filtered,
			scope: data?.scope || null,
		};
	}

	function buildQueryResult(selection, limit) {
		let results = selection.filtered.slice(0, limit).map((row) => ({
			item_key: row.item_key,
			citation_text: row.citation_text,
			title: row.title,
			abstract_preview: previewText(row.abstract_note || "", 420),
			year: row.year,
			doi: row.doi,
			zotero_uri: row.zotero_uri,
			decision: row.decision || "unreviewed",
			reason: row.reason || "",
			notes: row.notes || "",
			match_score: row.match_score || 0,
			matched_columns: row.matched_columns || [],
			values: summaryValues(row, selection.columns, row.matched_columns || []),
		}));
		return {
			query: selection.queryText,
			decision_filter: selection.decisionFilter || "",
			filters: selection.filters,
			search_columns: selection.searchColumns,
			total_rows: selection.rows.length,
			filtered_rows: selection.filtered.length,
			total_results: results.length,
			columns: selection.columns,
			scope: selection.scope || null,
			results,
		};
	}

	function saveRunPath(reviewer, context, name) {
		let stamp = nowStamp();
		let slug = sanitizeSlug(reviewer, name, "explore-query");
		return reviewer._joinPath(outputRoot(reviewer, context), `${stamp}-${slug}.json`);
	}

	async function saveRunMarkdown(reviewer, context, name, content) {
		let path = markdownRunPath(reviewer, context, name);
		await reviewer._ensureDirectory(markdownRoot(reviewer, context));
		await reviewer._writeTextFile(path, `${String(content || "").replace(/\s+$/, "")}\n`);
		return path;
	}

	async function saveBatchMarkdown(reviewer, context, name, batchIndex, content) {
		let suffix = `batch-${String(Number(batchIndex || 0) + 1).padStart(2, "0")}`;
		return await saveRunMarkdown(reviewer, context, `${name} ${suffix}`, content);
	}

	function exportCSVPath(reviewer, context, name) {
		let stamp = nowStamp();
		let slug = sanitizeSlug(reviewer, name, "explore-query");
		return reviewer._joinPath(outputRoot(reviewer, context), `${stamp}-${slug}.csv`);
	}

	function resolveSavedRunPath(reviewer, context, payload = {}) {
		let root = outputRoot(reviewer, context);
		let requestedPath = optionalString(payload.path);
		let requestedName = optionalString(payload.name);
		let resolvedPath = requestedPath || (requestedName ? reviewer._joinPath(root, requestedName) : "");
		if (!resolvedPath) {
			throw new Error("Provide a saved explore run path or file name.");
		}
		let prefix = root.endsWith("/") ? root : `${root}/`;
		if (resolvedPath != root && !resolvedPath.startsWith(prefix)) {
			throw new Error("Saved explore run must be inside the current project explore outputs folder.");
		}
		if (!reviewer._pathExists(resolvedPath)) {
			throw new Error("Saved explore run was not found.");
		}
		return resolvedPath;
	}

	function normalizeChatID(value) {
		return String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function chatFilePath(reviewer, context, chatID) {
		return reviewer._joinPath(chatRoot(reviewer, context), `${chatID}.json`);
	}

	function resolveChatPath(reviewer, context, payload = {}) {
		let root = chatRoot(reviewer, context);
		let requestedPath = optionalString(payload.path);
		let requestedID = normalizeChatID(payload.chat_id || payload.chatID || payload.id);
		let resolvedPath = requestedPath || (requestedID ? chatFilePath(reviewer, context, requestedID) : "");
		if (!resolvedPath) {
			throw new Error("Provide a chat id or chat path.");
		}
		let prefix = root.endsWith("/") ? root : `${root}/`;
		if (resolvedPath != root && !resolvedPath.startsWith(prefix)) {
			throw new Error("Explore chat must be inside the current project explore chats folder.");
		}
		if (!reviewer._pathExists(resolvedPath)) {
			throw new Error("Explore chat was not found.");
		}
		return resolvedPath;
	}

	function normalizeStoredChatMessages(messages = []) {
		return (Array.isArray(messages) ? messages : [])
			.filter((entry) => entry && typeof entry == "object")
			.map((entry) => ({
				role: optionalString(entry.role) || "assistant",
				content: String(entry.content || ""),
				rendered_content: String(entry.rendered_content || ""),
				thinking: String(entry.thinking || ""),
				created_at: optionalString(entry.created_at) || new Date().toISOString(),
				query: optionalString(entry.query),
				decision_filter: optionalString(entry.decision_filter),
				row_count: Number(entry.row_count || entry.rows || 0) || 0,
				column_keys: Array.isArray(entry.column_keys)
					? entry.column_keys.map((value) => optionalString(value)).filter(Boolean)
					: (Array.isArray(entry.columns) ? entry.columns.map((value) => optionalString(value)).filter(Boolean) : []),
				csv_path: optionalString(entry.csv_path),
				model: optionalString(entry.model),
				summary: !!entry.summary,
				batch: entry.batch === null || entry.batch === undefined ? null : Number(entry.batch),
				artifact_path: optionalString(entry.artifact_path),
				scope_key: optionalString(entry.scope_key),
				scope_name: optionalString(entry.scope_name),
				run_id: optionalString(entry.run_id),
				runtime_role_id: optionalString(entry.runtime_role_id || entry.role_id),
				runtime_label: optionalString(entry.runtime_label),
				scope: entry.scope || null,
				citations: Array.isArray(entry.citations)
					? entry.citations.map((citation) => ({
						token: optionalString(citation?.token),
						item_keys: Array.isArray(citation?.item_keys)
							? citation.item_keys.map((value) => optionalString(value)).filter(Boolean)
							: [],
						labels: Array.isArray(citation?.labels)
							? citation.labels.map((label) => ({
								item_key: optionalString(label?.item_key),
								citation_text: optionalString(label?.citation_text),
								title: optionalString(label?.title),
								year: optionalString(label?.year),
							}))
							: [],
					}))
					: [],
			}));
	}

	async function saveChat(reviewer, context, chat) {
		let chatID = normalizeChatID(chat?.id || chat?.name || `explore-${Date.now()}`) || `explore-${Date.now().toString(36)}`;
		let path = chatFilePath(reviewer, context, chatID);
		let payload = {
			id: chatID,
			name: optionalString(chat?.name) || chatID,
			system_prompt: optionalString(chat?.system_prompt) || DEFAULT_CHAT_SYSTEM_PROMPT,
			messages: normalizeStoredChatMessages(chat?.messages || []),
			model: optionalString(chat?.model),
			runtime_role_id: optionalString(chat?.runtime_role_id || chat?.role_id),
			runtime_preset_id: optionalString(chat?.runtime_preset_id || chat?.preset_id),
			batch_context_tokens_override: normalizeContextOverride(chat?.batch_context_tokens_override),
			markdown_path: optionalString(chat?.markdown_path),
			origin: optionalString(chat?.origin),
			session_id: optionalString(chat?.session_id || chat?.sessionID),
			scope_key: optionalString(chat?.scope_key),
			scope_name: optionalString(chat?.scope_name),
			row_count: Number(chat?.row_count || 0) || 0,
			batch_count: Number(chat?.batch_count || 0) || 0,
			final_reply: String(chat?.final_reply || ""),
			created_at: optionalString(chat?.created_at) || new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		await reviewer._ensureDirectory(chatRoot(reviewer, context));
		await reviewer._writeJSONFile(path, payload);
		return Object.assign({}, payload, { path });
	}

	async function loadChatFile(reviewer, context, payload = {}) {
		let path = resolveChatPath(reviewer, context, payload);
		let parsed = await reviewer._readJSONFile(path);
		if (!parsed || typeof parsed != "object") {
			throw new Error("Explore chat file is invalid.");
		}
		return Object.assign({}, parsed, {
			id: normalizeChatID(parsed.id || reviewer._basename(path).replace(/\.json$/i, "")),
			name: optionalString(parsed.name) || normalizeChatID(parsed.id || reviewer._basename(path).replace(/\.json$/i, "")),
			system_prompt: optionalString(parsed.system_prompt) || DEFAULT_CHAT_SYSTEM_PROMPT,
			messages: normalizeStoredChatMessages(parsed.messages || []),
			model: optionalString(parsed.model),
			runtime_role_id: optionalString(parsed.runtime_role_id || parsed.role_id),
			runtime_preset_id: optionalString(parsed.runtime_preset_id || parsed.preset_id),
			batch_context_tokens_override: normalizeContextOverride(parsed.batch_context_tokens_override),
			markdown_path: optionalString(parsed.markdown_path),
			origin: optionalString(parsed.origin),
			session_id: optionalString(parsed.session_id || parsed.sessionID),
			scope_key: optionalString(parsed.scope_key),
			scope_name: optionalString(parsed.scope_name),
			row_count: Number(parsed.row_count || 0) || 0,
			batch_count: Number(parsed.batch_count || 0) || 0,
			final_reply: String(parsed.final_reply || ""),
			path,
			created_at: optionalString(parsed.created_at),
			updated_at: optionalString(parsed.updated_at),
		});
	}

	async function decorateChat(reviewer, current, chat) {
		let rows = await SystematicReviewerWorkflowEmbeddings.projectItemRows(reviewer, current, {});
		let index = citationIndex(rows || []);
		return Object.assign({}, chat || {}, {
			messages: normalizeStoredChatMessages(chat?.messages || []).map((entry) => buildChatMessage(entry, index)),
		});
	}

	async function updateChat({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let existing = await loadChatFile(reviewer, context, payload);
		let saved = await saveChat(reviewer, context, Object.assign({}, existing, {
			system_prompt: payload.system_prompt !== undefined
				? optionalString(payload.system_prompt || payload.systemPrompt)
				: existing.system_prompt,
			runtime_role_id: payload.runtime_role_id !== undefined
				? optionalString(payload.runtime_role_id || payload.runtimeRoleID)
				: existing.runtime_role_id,
			runtime_preset_id: payload.runtime_preset_id !== undefined
				? optionalString(payload.runtime_preset_id || payload.runtimePresetID)
				: existing.runtime_preset_id,
			batch_context_tokens_override: payload.batch_context_tokens_override !== undefined
				? normalizeContextOverride(payload.batch_context_tokens_override)
				: existing.batch_context_tokens_override,
		}));
		return {
			ok: true,
			chat: await decorateChat(reviewer, current, saved),
		};
	}

	async function createChat({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let prompts = await readBundledPromptResource(reviewer);
		let baseName = optionalString(payload.name) || `Explore ${new Date().toLocaleString()}`;
		let baseID = normalizeChatID(payload.chat_id || payload.chatID || baseName) || `explore-${Date.now().toString(36)}`;
		let chatID = baseID;
		let counter = 1;
		while (reviewer._pathExists(chatFilePath(reviewer, context, chatID))) {
			counter += 1;
			chatID = `${baseID}-${counter}`;
		}
		let saved = await saveChat(reviewer, context, {
			id: chatID,
			name: baseName,
			system_prompt: optionalString(payload.system_prompt || payload.systemPrompt) || prompts.default_system_prompt || DEFAULT_CHAT_SYSTEM_PROMPT,
			messages: [],
			model: "",
			runtime_role_id: optionalString(payload.runtime_role_id),
			runtime_preset_id: optionalString(payload.runtime_preset_id),
			batch_context_tokens_override: normalizeContextOverride(payload.batch_context_tokens_override),
		});
		return {
			ok: true,
			chat: await decorateChat(reviewer, current, saved),
		};
	}

	async function listChats(reviewer, context) {
		let root = chatRoot(reviewer, context);
		if (!reviewer._pathExists(root)) {
			return [];
		}
		let files = listFiles(reviewer, root, (file) => file.isFile() && file.leafName.endsWith(".json"))
			.sort((a, b) => (b.lastModifiedTime || 0) - (a.lastModifiedTime || 0));
		let out = [];
		for (let file of files) {
			let parsed = await reviewer._readJSONFile(file.path);
			let messages = normalizeStoredChatMessages(parsed?.messages || []);
			let lastMessage = messages[messages.length - 1] || null;
			out.push({
				id: normalizeChatID(parsed?.id || file.leafName.replace(/\.json$/i, "")),
				name: optionalString(parsed?.name) || file.leafName.replace(/\.json$/i, ""),
				system_prompt: optionalString(parsed?.system_prompt),
				model: optionalString(parsed?.model),
				runtime_role_id: optionalString(parsed?.runtime_role_id || parsed?.role_id),
				runtime_preset_id: optionalString(parsed?.runtime_preset_id || parsed?.preset_id),
				batch_context_tokens_override: normalizeContextOverride(parsed?.batch_context_tokens_override),
				markdown_path: optionalString(parsed?.markdown_path),
				origin: optionalString(parsed?.origin),
				session_id: optionalString(parsed?.session_id || parsed?.sessionID),
				scope_key: optionalString(parsed?.scope_key),
				scope_name: optionalString(parsed?.scope_name),
				row_count: Number(parsed?.row_count || 0) || 0,
				batch_count: Number(parsed?.batch_count || 0) || 0,
				final_reply: String(parsed?.final_reply || ""),
				message_count: messages.length,
				last_message_preview: previewText(lastMessage?.rendered_content || lastMessage?.content || "", 220),
				updated_at: optionalString(parsed?.updated_at || parsed?.created_at),
				entry: serializeFileEntry(file),
			});
		}
		return out;
	}

	function csvEscape(value) {
		let text = valueText(value);
		if (/[",\n]/.test(text)) {
			return `"${text.replace(/"/g, "\"\"")}"`;
		}
		return text;
	}

	function exportColumnDefinitions(columns = [], payload = {}) {
		let requested = Array.isArray(payload.export_columns)
			? payload.export_columns
			: (Array.isArray(payload.columns) ? payload.columns : []);
		let aliases = columnAliasMap(columns);
		let picked = requested.length
			? requested
				.map((entry) => resolveColumnKey(entry, columns, aliases))
				.filter(Boolean)
			: columns.map((column) => column.key);
		let usedHeaders = new Set();
		return picked.map((key) => {
			let column = columns.find((entry) => entry.key == key) || { key, label: key };
			let header = optionalString(column.label || column.key) || column.key;
			if (usedHeaders.has(header)) {
				header = `${header} (${column.key})`;
			}
			usedHeaders.add(header);
			return {
				key: column.key,
				header,
			};
		});
	}

	function chatColumnDefinitions(columns = [], requestedKeys = []) {
		let pickedKeys = Array.isArray(requestedKeys) && requestedKeys.length
			? requestedKeys.filter(Boolean)
			: columns.map((column) => column.key);
		let usedHeaders = new Set();
		return pickedKeys.map((key) => {
			let column = columns.find((entry) => entry.key == key) || { key, prompt_key: key };
			let header = optionalString(column.prompt_key || column.promptKey || column.key) || column.key;
			let normalized = header.toLowerCase();
			if (!header || usedHeaders.has(normalized)) {
				header = optionalString(column.key) || header || "column";
				normalized = header.toLowerCase();
			}
			if (usedHeaders.has(normalized)) {
				let suffix = 2;
				let candidate = `${header}_${suffix}`;
				while (usedHeaders.has(candidate.toLowerCase())) {
					suffix += 1;
					candidate = `${header}_${suffix}`;
				}
				header = candidate;
				normalized = header.toLowerCase();
			}
			usedHeaders.add(normalized);
			return {
				key: column.key,
				header,
				label: optionalString(column.label || column.key),
			};
		});
	}

	function buildCSVText(rows = [], columnKeys = [], charBudget = DEFAULT_CHAT_CHAR_BUDGET) {
		let header = columnKeys.join(",");
		let parts = [header];
		let included = [];
		for (let row of rows) {
			let line = columnKeys.map((key) => csvEscape(row?.[key])).join(",");
			let nextText = `${parts.join("\n")}\n${line}`;
			if (nextText.length > charBudget && included.length) {
				break;
			}
			parts.push(line);
			included.push(row);
			if (nextText.length > charBudget) {
				break;
			}
		}
		return {
			text: parts.join("\n"),
			included_rows: included,
			truncated: included.length < rows.length,
		};
	}

	function buildExportCSVText(rows = [], columnDefs = []) {
		let header = columnDefs.map((entry) => csvEscape(entry.header)).join(",");
		let parts = [header];
		for (let row of rows) {
			parts.push(columnDefs.map((entry) => csvEscape(row?.[entry.key])).join(","));
		}
		return parts.join("\n");
	}

	function buildCSVChunks(rows = [], columnDefs = [], options = {}) {
		let baseTokens = Math.max(0, Number(options.base_tokens || 0) || 0);
		let promptTokens = Math.max(0, Number(options.prompt_tokens || 0) || 0);
		let contextTokens = Math.max(0, Number(options.context_tokens || 0) || 0);
		let reserveTokens = Math.max(0, Number(options.reserve_tokens || 0) || 0);
		let budget = Math.max(1, contextTokens - reserveTokens - baseTokens - promptTokens);
		let headerLine = columnDefs.map((entry) => csvEscape(entry.header)).join(",") + "\n";
		let headerTokens = estimateTokens(headerLine);
		let chunks = [];
		let currentLines = [headerLine.trimEnd()];
		let currentRows = [];
		let currentTokens = headerTokens;
		let truncatedAny = false;
		let flush = () => {
			if (currentRows.length) {
				chunks.push({
					text: `${currentLines.join("\n")}\n`,
					rows: currentRows.slice(),
				});
			}
			currentLines = [headerLine.trimEnd()];
			currentRows = [];
			currentTokens = headerTokens;
		};
		for (let row of rows || []) {
			let line = columnDefs.map((entry) => csvEscape(row?.[entry.key])).join(",");
			let lineTokens = estimateTokens(line);
			if (currentTokens + lineTokens > budget) {
				if (!currentRows.length) {
					let maxChars = Math.max(32, budget * 4);
					let truncatedCells = columnDefs.map((entry) => {
						let text = valueText(row?.[entry.key]);
						if (text.length > maxChars) {
							truncatedAny = true;
							return `${text.slice(0, Math.max(0, maxChars - 15))} ...[truncated]`;
						}
						return text;
					});
					line = truncatedCells.map((value) => csvEscape(value)).join(",");
					lineTokens = estimateTokens(line);
					currentLines.push(line);
					currentRows.push(row);
					currentTokens += lineTokens;
					flush();
					continue;
				}
				flush();
			}
			currentLines.push(line);
			currentRows.push(row);
			currentTokens += lineTokens;
		}
		flush();
		return {
			chunks,
			truncated: truncatedAny,
		};
	}

	async function writeChatContextCSV(reviewer, context, chatID, rows = [], columnDefs = []) {
		let path = reviewer._joinPath(chatRoot(reviewer, context), `${chatID}-${nowStamp()}-context.csv`);
		let csvText = buildExportCSVText(rows, columnDefs);
		await reviewer._writeTextFile(path, `${csvText}\n`);
		return path;
	}

	function roleAllowsInlineAPI(reviewer, runtimeRoles, roleID) {
		let role = runtimeRoles?.[roleID] || reviewer?._defaultRuntimeRole?.(roleID) || {};
		return ["local_api", "external_api"].includes(String(role.runtime_type || "").trim());
	}

	function exploreCompletionDiagnostic(runtime = {}, completion = null, split = null) {
		let client = runtime?.client || {};
		let finishReason = optionalString(
			completion?.finishReason
			|| completion?.finish_reason
			|| completion?.status
		);
		return [
			`runtime_role_id=${optionalString(runtime?.roleID || runtime?.role_id) || "(unknown)"}`,
			`runtime_type=${optionalString(client?.runtimeType || client?.runtime_type) || "(unknown)"}`,
			`preset_id=${optionalString(runtime?.preset_id || runtime?.presetID || "default") || "default"}`,
			`finish_reason=${finishReason || "(none)"}`,
			`eos_reached=${completion?.eosReached === true ? "true" : "false"}`,
			`truncated=${completion?.truncated === true ? "true" : "false"}`,
			`output_chars=${String(completion?.text || "").length}`,
			`visible_chars=${String(split?.visible || "").trim().length}`,
		].join(", ");
	}

	async function requestExploreCompletion(runtime = {}, messages = [], signal = null) {
		let client = runtime?.client || {};
		let runtimeConfig = runtime?.config?.runtime || {};
		let runtimeType = optionalString(client?.runtimeType || client?.runtime_type);
		let inputText = messages
			.map((message) => `${String(message?.role || "user").toUpperCase()}:\n${String(message?.content || "")}`)
			.join("\n\n");
		if (runtimeType == "local_exec") {
			let reasoningEffort = optionalString(client?.reasoningEffort || runtime?.reasoning_effort || "");
			let instructions = messages
				.filter((message) => String(message?.role || "").trim().toLowerCase() == "system")
				.map((message) => String(message?.content || "").trim())
				.filter(Boolean)
				.join("\n\n")
				.trim();
			let inputMessages = messages
				.filter((message) => String(message?.role || "").trim().toLowerCase() != "system")
				.map((message) => ({
					role: String(message?.role || "user").trim() || "user",
					content: String(message?.content || ""),
				}));
			let result = await SystematicReviewerPDFMarkdown.requestResponses(
				{
					baseUrl: client.baseUrl || client.base_url,
					streamBaseUrl: client.streamBaseUrl || "",
					model: client.model,
					apiKey: client.apiKey || client.api_key || "",
					timeoutMs: client.timeoutMs || client.timeout_ms || 120000,
					runtimeType,
					roleID: client.roleID || runtime?.roleID || runtime?.role_id || "",
					reasoningEffort,
					maxOutputTokens: Number(client.maxOutputTokens || client.max_output_tokens || 0) || 0,
				},
				{
					model: client.model,
					input: inputMessages.length ? inputMessages : inputText,
					instructions: instructions || undefined,
					max_output_tokens: Number(client.maxOutputTokens || client.max_output_tokens || runtimeConfig?.nPredict || 0) || DEFAULT_MAX_NEW_TOKENS,
					stream: true,
					store: false,
					reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
				},
				{
					signal: signal || null,
				}
			);
			return {
				text: String(result?.text || "").trim(),
				eosReached: result?.eosReached === true,
				truncated: result?.truncated === true,
				finishReason: optionalString(result?.finishReason || result?.finish_reason),
				responseID: optionalString(result?.responseID || result?.response_id),
			};
		}
		return await SystematicReviewerPDFMarkdown.requestTextChat(
			client,
			messages,
			runtimeConfig,
			false,
			{
				inputText,
				signal: signal || null,
			}
		);
	}

	function validateExploreCompletion(phaseLabel = "", runtime = {}, completion = null) {
		let split = splitThinkBlocks(String(completion?.text || ""));
		let visible = String(split?.visible || "").trim();
		let diagnostic = exploreCompletionDiagnostic(runtime, completion, { visible });
		if (!completion?.eosReached || completion?.truncated) {
			throw new Error(
				`${phaseLabel || "Explore generation"} returned an incomplete response (eos_reached=${completion?.eosReached === true ? "true" : "false"}, truncated=${completion?.truncated === true ? "true" : "false"}). ${diagnostic}`
			);
		}
		if (!visible) {
			throw new Error(`${phaseLabel || "Explore generation"} returned no visible output after stripping think blocks. ${diagnostic}`);
		}
		return {
			split: {
				visible,
				thinking: String(split?.thinking || "").trim(),
			},
			diagnostic,
		};
	}

	async function runExploreCompletionWithRetries({
		phaseLabel = "Explore generation",
		runtime = {},
		messages = [],
		attemptLimit = DEFAULT_EXPLORE_ATTEMPTS,
		onLog = null,
		signal = null,
	}) {
		let lastError = "";
		for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
			try {
				let completion = await requestExploreCompletion(runtime, messages, signal || null);
				let validated = validateExploreCompletion(phaseLabel, runtime, completion);
				if (attempt > 1 && typeof onLog == "function") {
					await Promise.resolve(onLog("info", `${phaseLabel} succeeded after ${attempt} attempts.`));
				}
				return {
					completion,
					split: validated.split,
					diagnostic: validated.diagnostic,
					attempts_used: attempt,
					retry_count: attempt - 1,
				};
			}
			catch (error) {
				lastError = error?.message || String(error);
				if (attempt < attemptLimit && typeof onLog == "function") {
					await Promise.resolve(onLog("warn", `${phaseLabel} retry ${attempt}/${attemptLimit}: ${lastError}`));
				}
			}
		}
		throw new Error(`${phaseLabel} failed after ${attemptLimit} attempts. ${lastError}`.trim());
	}

	function resolveRuntimeContextTokens(role = {}) {
		let value = Number(role?.context_window || role?.lmstudio_context_length || role?.context_tokens || 0) || 0;
		return value > 0 ? value : 0;
	}

	function resolveRuntimeReserveTokens(role = {}) {
		let value = Number(role?.max_output_tokens || 0) || 0;
		return value > 0 ? value : DEFAULT_RESERVE_TOKENS;
	}

	function modelChoiceID(roleID, presetID) {
		let role = optionalString(roleID);
		let preset = optionalString(presetID || "default") || "default";
		return `${role}::${preset}`;
	}

	async function buildRuntimeChoices(reviewer, config = null) {
		let effectiveConfig = config || await reviewer._conversionConfig();
		let apiConnections = effectiveConfig.apiConnections || [];
		let runtimeRoles = reviewer._normalizeRuntimeRoles
			? reviewer._normalizeRuntimeRoles(effectiveConfig.runtimeRoles || {}, apiConnections, null)
			: (effectiveConfig.runtimeRoles || {});
		let preferences = effectiveConfig.runtimePreferences || {};
		let roleIDs = preferences.use_agent_model_for_data_extraction
			? ["session_chat"]
			: ["session_chat", "data_extraction"];
		let labels = {
			session_chat: "Agent model",
			data_extraction: "Data extraction model",
		};
		return roleIDs.map((roleID) => {
			let role = runtimeRoles?.[roleID] || reviewer?._defaultRuntimeRole?.(roleID) || {};
			let kind = roleID == "data_extraction" ? "extraction" : "chat";
			let connection = reviewer._findConnectionByID(apiConnections, role.connection_id) || null;
			let endpoint = reviewer._materializeEndpointFromRole
				? reviewer._materializeEndpointFromRole(kind, role, connection)
				: null;
			let fallbackClient = roleID == "data_extraction" ? effectiveConfig.extractionClient : effectiveConfig.chatClient;
			let model = optionalString(endpoint?.model || fallbackClient?.model || role.model);
			let runtimeType = optionalString(role.runtime_type || "");
			let availableInline = false;
			let unavailableReason = "";
			if (roleAllowsInlineAPI(reviewer, runtimeRoles, roleID)) {
				availableInline = !!optionalString(endpoint?.base_url || fallbackClient?.baseUrl)
					&& !!model;
			}
			else {
				try {
					reviewer._assertRoleExecutionReady(roleID, effectiveConfig, labels[roleID]);
					availableInline = true;
				}
				catch (error) {
					unavailableReason = String(error?.message || error || "").trim();
				}
			}
			if (!availableInline && !unavailableReason) {
				if (runtimeType == "local_exec") {
					unavailableReason = "This role is not ready for Explore chat yet.";
				}
				else if (runtimeType == "external_agent") {
					unavailableReason = "This role is owned by an external agent client.";
				}
				else {
					unavailableReason = "This role is not configured.";
				}
			}
			return {
				role_id: roleID,
				label: labels[roleID] || roleID,
				runtime_type: runtimeType,
				model,
				connection_label: optionalString(connection?.label),
				context_tokens: resolveRuntimeContextTokens(role),
				reserve_tokens: resolveRuntimeReserveTokens(role),
				max_output_tokens: Number(role?.max_output_tokens || 0) || 0,
				inline_api_available: availableInline,
				unavailable_reason: unavailableReason,
			};
		});
	}

	async function buildModelChoices(reviewer, config = null) {
		let effectiveConfig = config || await reviewer._conversionConfig();
		let preferences = effectiveConfig.runtimePreferences || {};
		let roleIDs = preferences.use_agent_model_for_data_extraction
			? ["session_chat"]
			: ["session_chat", "data_extraction"];
		let roleLabels = {
			session_chat: "Agent model",
			data_extraction: "Data extraction model",
		};
		let out = [];
		for (let roleID of roleIDs) {
			let presets = reviewer._listRuntimePresetOptions
				? reviewer._listRuntimePresetOptions(roleID, effectiveConfig)
				: [];
			if (!Array.isArray(presets) || !presets.length) {
				let runtimeChoices = await buildRuntimeChoices(reviewer, effectiveConfig);
				let fallback = runtimeChoices.find((entry) => entry.role_id == roleID);
				if (!fallback) {
					continue;
				}
				out.push({
					choice_id: modelChoiceID(roleID, "default"),
					role_id: roleID,
					preset_id: "default",
					label: fallback.model ? `${fallback.label} - ${fallback.model}` : fallback.label,
					model_label: fallback.model || fallback.label,
					model: fallback.model,
					runtime_type: fallback.runtime_type,
					context_tokens: fallback.context_tokens,
					reserve_tokens: fallback.reserve_tokens,
					max_output_tokens: fallback.max_output_tokens,
					inline_api_available: fallback.inline_api_available !== false,
					unavailable_reason: fallback.unavailable_reason || "",
					is_default: true,
				});
				continue;
			}
			for (let preset of presets) {
				let presetID = optionalString(preset?.preset_id || preset?.id || "default") || "default";
				let label = optionalString(preset?.label || preset?.short_label || preset?.model_label || preset?.model)
					|| `${roleLabels[roleID] || roleID}${presetID != "default" ? ` - ${presetID}` : ""}`;
				out.push({
					choice_id: modelChoiceID(roleID, presetID),
					role_id: roleID,
					preset_id: presetID,
					label,
					short_label: optionalString(preset?.short_label || label),
					model_label: optionalString(preset?.model_label || preset?.model || label),
					model: optionalString(preset?.model),
					runtime_type: optionalString(preset?.runtime_type),
					context_tokens: Number(preset?.context_window || 0) || 0,
					reserve_tokens: Number(preset?.max_output_tokens || 0) || DEFAULT_RESERVE_TOKENS,
					max_output_tokens: Number(preset?.max_output_tokens || 0) || 0,
					inline_api_available: preset?.state_mode != "unavailable",
					unavailable_reason: optionalString(preset?.state_mode == "unavailable" ? (preset?.connection_label || "Not configured") : ""),
					connection_label: optionalString(preset?.connection_label),
					parallel_requests: Number(preset?.parallel_requests || 0) || 0,
					reasoning_effort: optionalString(preset?.reasoning_effort),
					is_default: !!preset?.is_default,
				});
			}
		}
		return out;
	}

	async function resolveExploreRuntime(reviewer, payload = {}) {
		let config = await reviewer._conversionConfig();
		let apiConnections = config.apiConnections || [];
		let runtimeRoles = reviewer._normalizeRuntimeRoles
			? reviewer._normalizeRuntimeRoles(config.runtimeRoles || {}, apiConnections, null)
			: (config.runtimeRoles || {});
		let preferences = config.runtimePreferences || {};
		let roleID = optionalString(payload.runtime_role_id || payload.role_id || payload.runtimeRoleID);
		if (!roleID) {
			roleID = preferences.use_agent_model_for_data_extraction ? "session_chat" : "data_extraction";
		}
		if (!["session_chat", "data_extraction"].includes(roleID)) {
			throw new Error("runtime_role_id must be session_chat or data_extraction.");
		}
		let role = runtimeRoles?.[roleID] || {};
		let presetID = optionalString(payload.runtime_preset_id || payload.runtimePresetID || payload.model_preset_id || payload.modelPresetID);
		let label = roleID == "data_extraction" ? "Data Extraction Engine" : "Agent Model";
		let inlineCapable = roleAllowsInlineAPI(reviewer, runtimeRoles, roleID);
		if (!inlineCapable) {
			reviewer._assertRoleExecutionReady(roleID, config, label);
		}
		let connection = reviewer._findConnectionByID(apiConnections, role.connection_id) || null;
		let endpoint = reviewer._materializeEndpointFromRole
			? reviewer._materializeEndpointFromRole(roleID == "data_extraction" ? "extraction" : "chat", role, connection)
			: null;
		let fallbackClient = roleID == "data_extraction" ? config.extractionClient : config.chatClient;
		let effectiveClient = {
			baseUrl: String(endpoint?.base_url || fallbackClient?.baseUrl || "").trim(),
			model: String(endpoint?.model || fallbackClient?.model || "").trim(),
			apiKind: String(endpoint?.api_kind || fallbackClient?.apiKind || "auto").trim() || "auto",
			apiKey: String(endpoint?.api_key || fallbackClient?.apiKey || "").trim(),
			timeoutMs: Number(endpoint?.timeout_ms || fallbackClient?.timeoutMs || 120000) || 120000,
			maxOutputTokens: Number(role?.max_output_tokens || fallbackClient?.maxOutputTokens || 0) || 0,
		};
		let prepared = await reviewer._prepareRoleAPIClient(roleID, effectiveClient, config, {
			presetID,
		});
		let preparedClient = prepared.client || effectiveClient;
		let preparedRuntimeType = optionalString(preparedClient.runtimeType || role.runtime_type || "");
		if (!preparedClient.model) {
			throw new Error(`${label} is not configured.`);
		}
		if (inlineCapable || ["local_api", "external_api"].includes(preparedRuntimeType)) {
			reviewer._assertConfiguredAIEndpoint("chat", preparedClient);
		}
		return {
			config,
			roleID,
			label,
			role,
			client: preparedClient,
			release: prepared.release || (async () => {}),
			context_tokens: resolveRuntimeContextTokens(role),
			reserve_tokens: resolveRuntimeReserveTokens(role),
			preset_id: String(prepared?.client?.presetID || presetID || "default").trim() || "default",
			preset_label: String(prepared?.client?.presetLabel || "").trim(),
		};
	}

	async function resolveExploreChatClient(reviewer) {
		return await resolveExploreRuntime(reviewer, {});
	}

	async function listArtifacts(reviewer, context, limit = DEFAULT_ARTIFACT_LIMIT) {
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				relative_path,
				role,
				COALESCE(linked_attachment_key, '') AS linked_attachment_key,
				COALESCE(linked_attachment_title, '') AS linked_attachment_title,
				COALESCE(absolute_path, '') AS absolute_path,
				updated_at
			 FROM artifact_files
			 ORDER BY updated_at DESC, relative_path ASC
			 LIMIT ?`,
			[normalizeLimit(limit, DEFAULT_ARTIFACT_LIMIT, 200)]
		);
		return (rows || []).map((row) => ({
			relative_path: String(rowValue(row, "relative_path") || ""),
			role: String(rowValue(row, "role") || ""),
			linked_attachment_key: String(rowValue(row, "linked_attachment_key") || ""),
			linked_attachment_title: String(rowValue(row, "linked_attachment_title") || ""),
			absolute_path: String(rowValue(row, "absolute_path") || ""),
			updated_at: String(rowValue(row, "updated_at") || ""),
		}));
	}

	async function artifactSummary(reviewer, context) {
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT role, COUNT(*) AS count
			 FROM artifact_files
			 GROUP BY role
			 ORDER BY count DESC, role ASC`
		);
		let byRole = {};
		let total = 0;
		for (let row of rows || []) {
			let role = String(rowValue(row, "role") || "artifact");
			let count = Number(rowValue(row, "count") || 0) || 0;
			byRole[role] = count;
			total += count;
		}
		return {
			total,
			by_role: byRole,
		};
	}

	async function summarizeSessions(reviewer, context, limit = DEFAULT_SESSION_LIMIT) {
		let sessions = await reviewer._listProjectSessions(context);
		let max = normalizeLimit(limit, DEFAULT_SESSION_LIMIT, 100);
		let out = [];
		for (let session of sessions.slice(0, max)) {
			let transcript = await reviewer._loadSessionMessages(context, session.session_id);
			let lastMessage = transcript[transcript.length - 1] || null;
			out.push(Object.assign({}, session, {
				message_count: transcript.length,
				last_message_role: String(lastMessage?.role || ""),
				last_message_preview: previewText(lastMessage?.content || "", 220),
				last_message_at: String(lastMessage?.created_at || session.updated_at || ""),
			}));
		}
		return out;
	}

	async function buildReportState(reviewer, current, inspection = null) {
		let context = current?.context;
		let report = await reviewer._workspaceDocument(context);
		let markdown = report?.markdown || "";
		let wordCount = inspection?.report_word_count || countWords(markdown);
		return {
			path: context?.reportPath || "",
			exists: !!report,
			word_count: wordCount,
			preview: previewText(markdown, 1000),
			markdown_excerpt: markdown ? markdown.slice(0, 2000) : "",
		};
	}

	async function loadSessionDetail({ reviewer, current, payload = {}, sessions = null }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let sessionRows = sessions || await summarizeSessions(
			reviewer,
			context,
			payload.session_limit || payload.limit || DEFAULT_SESSION_LIMIT
		);
		let sessionID = sessionIDFromPayload(payload, current, sessionRows);
		if (!sessionID) {
			return {
				ok: true,
				selected_session_id: "",
				session: null,
			};
		}
		let transcriptLimit = normalizeLimit(
			payload.transcript_limit || payload.transcriptLimit,
			DEFAULT_TRANSCRIPT_LIMIT,
			400
		);
		let timelineLimit = normalizeLimit(
			payload.timeline_limit || payload.timelineLimit,
			DEFAULT_TIMELINE_LIMIT,
			500
		);
		let transcript = await reviewer._loadSessionMessages(context, sessionID);
		let timeline = await reviewer._loadSessionTimeline(context, sessionID);
		let sessionSummary = sessionRows.find((entry) => entry.session_id == sessionID) || null;
		let state = await reviewer._loadSessionState(context, sessionID);
		return {
			ok: true,
			selected_session_id: sessionID,
			session: Object.assign({}, sessionSummary || {}, {
				state,
				transcript_total: transcript.length,
				timeline_total: timeline.length,
				transcript: transcript.slice(Math.max(0, transcript.length - transcriptLimit)),
				timeline: timeline.slice(Math.max(0, timeline.length - timelineLimit)),
			}),
		};
	}

	async function loadJobDetail({ reviewer, current, payload = {}, jobs = null }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let jobRows = Array.isArray(jobs)
			? jobs
			: await reviewer._listJobs(
				context,
				normalizeLimit(payload.job_limit || payload.limit, DEFAULT_JOB_LIMIT, 200)
			);
		let jobID = jobIDFromPayload(payload, jobRows);
		if (!jobID) {
			return {
				ok: true,
				selected_job_id: "",
				job: null,
			};
		}
		let logLimit = normalizeLimit(payload.log_limit || payload.logLimit, DEFAULT_LOG_LIMIT, 500);
		let job = jobRows.find((entry) => entry.job_id == jobID) || null;
		let logs = await reviewer._jobLogs(context, jobID, logLimit);
		let logCount = reviewer?._jobLogCount
			? await reviewer._jobLogCount(context, jobID)
			: logs.length;
		return {
			ok: true,
			selected_job_id: jobID,
			job: Object.assign({}, job || {}, {
				log_count: logCount,
				logs,
			}),
		};
	}

	async function listColumns({ reviewer, current, payload = {} }) {
		let columns = await projectDataColumnCatalog(reviewer, current);
		let scopes = scopeChoices(reviewer, current);
		let scope = scopeDescriptor(reviewer, current, payload);
		return {
			ok: true,
			columns,
			total_rows: projectDataScopeCount(scopes, scope),
			total_rows_known: projectDataScopeCount(scopes, scope) !== null,
			scope: scope || null,
		};
	}

	function normalizeProjectDataLimit(value) {
		let numeric = Math.round(Number(value || 0) || 0);
		if (!numeric) {
			numeric = 25;
		}
		return Math.max(1, Math.min(25, numeric));
	}

	function normalizeProjectDataOffset(value) {
		let numeric = Math.round(Number(value || 0) || 0);
		return Math.max(0, numeric);
	}

	function projectDataWarnings() {
		return [
			"Project data inspection is paged so it cannot dump an entire database into the model context.",
			"Call project_data__schema first, then request only the scope and columns you need.",
			"Use project_data__rows in windows of at most 25 rows and page with offset when needed.",
			"For synthesis or write-up across many rows, use Explore instead of asking the main agent to summarize large row dumps directly.",
		];
	}

	async function projectDataColumnCatalog(reviewer, current) {
		let context = current?.context;
		let columns = baseColumnDefinitions().slice();
		let seen = new Set(columns.map((column) => optionalString(column.key)).filter(Boolean));
		if (!context || !SystematicReviewerWorkflowScreening?.listDynamicColumnCatalog) {
			return applyPromptKeys(columns);
		}
		let dynamicColumns = await SystematicReviewerWorkflowScreening.listDynamicColumnCatalog(reviewer, context).catch(() => []);
		for (let column of dynamicColumns || []) {
			let origin = optionalString(column?.origin || "");
			let rawKey = optionalString(column?.key || column?.column_key);
			let key = origin == "screening" ? `screening:${rawKey}` : rawKey;
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			let label = optionalString(column?.label || rawKey || key) || key;
			if (origin == "screening") {
				label = `Screening: ${label}`;
			}
			else if (origin == "extraction") {
				label = `Extraction: ${label}`;
			}
			else if (origin == "extraction_metadata") {
				label = `Extraction metadata: ${label}`;
			}
			columns.push({
				key,
				prompt_key: origin == "screening" ? rawKey : key,
				label,
				origin: origin || "custom",
				search: true,
			});
		}
		return applyPromptKeys(columns);
	}

	async function projectDataColumnCatalogForRows(reviewer, current, payload = {}) {
		let baseColumns = applyPromptKeys(baseColumnDefinitions());
		let requested = normalizeProjectDataColumnRequest(payload);
		if (!requested.length) {
			return baseColumns;
		}
		let aliases = columnAliasMap(baseColumns);
		let allBase = requested.every((key) =>
			!!resolveColumnKey(key, baseColumns, aliases)
			|| baseColumns.some((column) => column.key == optionalString(key))
		);
		return allBase ? baseColumns : await projectDataColumnCatalog(reviewer, current);
	}

	function projectDataScopeCount(scopes = [], scope = null) {
		if (!scope) {
			return null;
		}
		let scopeKey = optionalString(scope.scope_key || scope.collection_key);
		let scopeName = optionalString(scope.scope_name || scope.collection_name).toLowerCase();
		let match = (scopes || []).find((entry) => {
			let entryKey = optionalString(entry?.collection_key);
			let entryName = optionalString(entry?.collection_name).toLowerCase();
			return (scopeKey && entryKey == scopeKey) || (scopeName && entryName == scopeName);
		});
		if (!match || match.item_count === null || match.item_count === undefined) {
			return null;
		}
		return Number(match.item_count || 0) || 0;
	}

	function requiredFieldsForProjectDataColumns(columnKeys = []) {
		let fields = new Set(["title"]);
		if (columnKeys.includes("abstract_note") || columnKeys.includes("abstract_origin")) {
			fields.add("abstract_note");
		}
		if (columnKeys.includes("publication_title")) {
			fields.add("publication_title");
		}
		return Array.from(fields);
	}

	async function hydrateProjectDataRows(reviewer, current, payload = {}, rows = [], columns = [], columnKeys = []) {
		let context = current?.context;
		if (!context || !rows.length) {
			return rows;
		}
		let selected = new Set(columnKeys || []);
		let selectedColumns = (columns || []).filter((column) => selected.has(column.key));
		let itemKeys = rows.map((row) => optionalString(row?.item_key)).filter(Boolean);
		let needsScreening = selectedColumns.some((column) => optionalString(column?.origin) == "screening");
		let needsExtraction = selectedColumns.some((column) => {
			let origin = optionalString(column?.origin);
			return origin == "extraction" || origin == "extraction_metadata";
		});
		let [screening, extraction] = await Promise.all([
			needsScreening
				? screeningState(reviewer, current, payload, { itemKeys })
				: Promise.resolve({ decisions: new Map(), values: new Map() }),
			needsExtraction
				? extractionState(reviewer, context, new Set(itemKeys))
				: Promise.resolve({ values: new Map() }),
		]);
		return rows.map((record) => {
			let decision = screening.decisions?.get(record.item_key) || {};
			let next = Object.assign({}, record);
			if (needsScreening) {
				Object.assign(next, {
					decision: String(decision.decision || ""),
					reason: String(decision.reason || ""),
					notes: String(decision.notes || ""),
				});
				Object.assign(next, screening.values?.get(record.item_key) || {});
			}
			if (needsExtraction) {
				Object.assign(next, extraction.values?.get(record.item_key) || {});
			}
			return next;
		});
	}

	function normalizeProjectDataColumnRequest(payload = {}) {
		if (Array.isArray(payload.columns)) {
			return payload.columns;
		}
		if (typeof payload.columns == "string") {
			return payload.columns.split(",").map((entry) => entry.trim()).filter(Boolean);
		}
		return [];
	}

	function selectedProjectDataColumns(columns = [], payload = {}, options = {}) {
		let aliases = columnAliasMap(columns);
		let requested = normalizeProjectDataColumnRequest(payload);
		let required = ["item_key", "citation_token"];
		let defaultColumns = ["citation_token", "title", "year", "decision"];
		let keys = [];
		let append = (key) => {
			let resolved = resolveColumnKey(key, columns, aliases) || optionalString(key);
			if (!resolved || keys.includes(resolved)) {
				return;
			}
			if (columns.some((column) => column.key == resolved)) {
				keys.push(resolved);
			}
		};
		for (let key of required) {
			append(key);
		}
		if (requested.length) {
			for (let key of requested) {
				if (!resolveColumnKey(key, columns, aliases) && !columns.some((column) => column.key == optionalString(key))) {
					throw new Error(`Unknown project data column '${key}'. Call project_data__schema for available columns.`);
				}
				append(key);
			}
		}
		else if (options?.singleRow) {
			for (let column of columns) {
				append(column.key);
			}
		}
		else {
			for (let key of defaultColumns) {
				append(key);
			}
		}
		return keys;
	}

	function serializeProjectDataColumns(columns = []) {
		return (columns || []).map((column) => ({
			key: optionalString(column.key),
			prompt_key: optionalString(column.prompt_key || column.promptKey || column.key),
			label: optionalString(column.label || column.key),
			origin: optionalString(column.origin || "builtin"),
			search: column.search !== false,
		}));
	}

	function serializeProjectDataRow(row = {}, columns = [], columnKeys = []) {
		let byKey = new Map((columns || []).map((column) => [column.key, column]));
		let values = {};
		for (let key of columnKeys || []) {
			values[key] = valueText(row?.[key]);
		}
		return {
			item_key: optionalString(row?.item_key),
			citation_token: optionalString(row?.citation_token) || (row?.item_key ? `@[${row.item_key}]` : ""),
			values,
			columns: (columnKeys || []).map((key) => {
				let column = byKey.get(key) || {};
				return {
					key,
					label: optionalString(column.label || key),
					origin: optionalString(column.origin || "builtin"),
				};
			}),
		};
	}

	async function projectDataSchema({ reviewer, current, payload = {} }) {
		let columns = await projectDataColumnCatalog(reviewer, current);
		let scopes = scopeChoices(reviewer, current);
		let scope = scopeDescriptor(reviewer, current, payload);
		let rowCount = projectDataScopeCount(scopes, scope);
		return {
			ok: true,
			namespace: "project_data",
			warnings: projectDataWarnings(),
			scope: scope || null,
			available_scopes: scopes,
			row_count: rowCount,
			row_count_known: rowCount !== null,
			columns: serializeProjectDataColumns(columns),
			default_limit: 25,
			max_limit: 25,
			recommended_next: "Choose a scope and explicit columns, then call project_data__rows with limit <= 25. Use Explore for multi-row synthesis.",
		};
	}

	async function projectDataRows({ reviewer, current, payload = {} }) {
		if (payload.limit !== undefined && payload.limit !== null && String(payload.limit).trim() !== "" && Number(payload.limit) > 25) {
			throw new Error("project_data__rows limit is capped at 25. Page with offset for more rows.");
		}
		let limit = normalizeProjectDataLimit(payload.limit);
		let offset = normalizeProjectDataOffset(payload.offset);
		let columns = await projectDataColumnCatalogForRows(reviewer, current, payload);
		let columnKeys = selectedProjectDataColumns(columns, payload);
		let page = await collectionRecords(reviewer, current, payload, {
			returnPage: true,
			offset,
			limit,
			stopAfterPage: true,
			requiredFields: requiredFieldsForProjectDataColumns(columnKeys),
		});
		let hydratedRows = await hydrateProjectDataRows(
			reviewer,
			current,
			payload,
			page.rows || [],
			columns,
			columnKeys
		);
		let rows = hydratedRows.map((row) =>
			serializeProjectDataRow(row, columns, columnKeys)
		);
		let knownTotal = page.total_rows_known === true ? Number(page.total_rows || 0) || 0 : null;
		let nextOffset = offset + rows.length;
		return {
			ok: true,
			warnings: projectDataWarnings(),
			scope: scopeDescriptor(reviewer, current, payload) || null,
			offset,
			limit,
			max_limit: 25,
			returned: rows.length,
			total_rows: knownTotal,
			total_rows_known: knownTotal !== null,
			scanned_rows: Number(page.scanned_rows || nextOffset) || nextOffset,
			has_more: page.has_more === true,
			next_offset: nextOffset,
			requested_columns: columnKeys,
			columns: serializeProjectDataColumns(columns).filter((column) => columnKeys.includes(column.key)),
			rows,
		};
	}

	async function projectDataRow({ reviewer, current, payload = {} }) {
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		let data = await dataset(reviewer, current, payload);
		let row = data.rows.find((entry) => optionalString(entry?.item_key) == itemKey) || null;
		if (!row) {
			throw new Error(`Item ${itemKey} was not found in the selected project scope.`);
		}
		let columnKeys = selectedProjectDataColumns(data.columns, payload, { singleRow: true });
		return {
			ok: true,
			warnings: projectDataWarnings(),
			scope: data.scope || null,
			row: serializeProjectDataRow(row, data.columns, columnKeys),
			requested_columns: columnKeys,
			columns: serializeProjectDataColumns(data.columns).filter((column) => columnKeys.includes(column.key)),
		};
	}

	async function listColumnCatalog({ reviewer, current }) {
		let sharedColumns = await SystematicReviewerWorkflowExtraction.sharedRowPlaceholderCatalog(reviewer, current);
		let extras = [
			{ key: "citation_token", prompt_key: "citation_token", label: "Citation token", origin: "builtin", search: false },
			{ key: "abstract_origin", prompt_key: "abstract_origin", label: "Abstract origin", origin: "builtin", search: true },
			{ key: "decision", prompt_key: "decision", label: "Decision", origin: "screening", search: true },
			{ key: "reason", prompt_key: "reason", label: "Reason", origin: "screening", search: true },
			{ key: "notes", prompt_key: "notes", label: "Notes", origin: "screening", search: true },
		];
		let columns = applyPromptKeys(sharedColumns.concat(extras));
		return {
			ok: true,
			columns,
		};
	}

	async function listRuntimeChoiceOptions({ reviewer }) {
		let config = await reviewer._conversionConfig();
		let runtimeChoices = await buildRuntimeChoices(reviewer, config);
		let modelChoices = await buildModelChoices(reviewer, config);
		return {
			ok: true,
			runtime_choices: runtimeChoices,
			model_choices: modelChoices,
			show_runtime_choice: runtimeChoices.length > 1,
			default_runtime_role_id: runtimeChoices[0]?.role_id || "session_chat",
			default_model_choice_id: modelChoices.find((entry) => entry.is_default)?.choice_id || modelChoices[0]?.choice_id || "",
		};
	}

	function defaultScopeKey(scopes = []) {
		let pending = (scopes || []).find((entry) => /pending/i.test(String(entry?.collection_name || "")));
		return String(pending?.collection_key || scopes?.[0]?.collection_key || "");
	}

	async function getConfig({ reviewer, current, payload = {} }) {
		let prompts = await readBundledPromptResource(reviewer);
		let scopes = scopeChoices(reviewer, current);
		let runtimeChoices = await buildRuntimeChoices(reviewer);
		let modelChoices = await buildModelChoices(reviewer);
		let catalog = await listColumnCatalog({ reviewer, current });
		return {
			ok: true,
			available_scopes: scopes,
			default_scope_key: optionalString(payload.collection_key)
				|| optionalString(current?.settings?.workflow_ui?.last_scope_key)
				|| defaultScopeKey(scopes),
			columns: (catalog.columns || []).map((column) => ({
				key: optionalString(column.key),
				prompt_key: optionalString(column.prompt_key || column.promptKey || column.key),
				label: optionalString(column.label || column.key),
				origin: optionalString(column.origin),
				search: column.search !== false,
				aliases: Array.isArray(column.aliases) ? column.aliases.map((value) => optionalString(value)).filter(Boolean) : [],
			})),
			chats: await listChats(reviewer, current.context),
			runtime_choices: runtimeChoices,
			model_choices: modelChoices,
			show_runtime_choice: runtimeChoices.length > 1,
			default_runtime_role_id: runtimeChoices[0]?.role_id || "session_chat",
			default_model_choice_id: modelChoices.find((entry) => entry.is_default)?.choice_id || modelChoices[0]?.choice_id || "",
			default_system_prompt: prompts.default_system_prompt || DEFAULT_CHAT_SYSTEM_PROMPT,
			citation_rules: prompts.citation_rules || DEFAULT_CITATION_RULES,
		};
	}

	async function suggestCitations({ reviewer, current, payload = {} }) {
		let prefix = optionalString(payload.prefix).toLowerCase();
		let data = await dataset(reviewer, current, payload);
		let selection = selectionState(data, payload);
		let limit = normalizeLimit(payload.limit, 12, 50);
		let out = [];
		for (let row of selection.filtered || []) {
			let token = optionalString(row.citation_token) || `@[${optionalString(row.item_key)}]`;
			let label = optionalString(row.citation_text || row.title || row.item_key);
			let title = optionalString(row.title);
			let year = optionalString(row.year);
			let haystack = [token, label, title, optionalString(row.item_key)].join(" ").toLowerCase();
			if (prefix && !haystack.includes(prefix)) {
				continue;
			}
			out.push({
				item_key: optionalString(row.item_key),
				token,
				label,
				title,
				year,
			});
			if (out.length >= limit) {
				break;
			}
		}
		return {
			ok: true,
			citations: out,
		};
	}

	function markdownTableToCSVRows(text = "") {
		let lines = String(text || "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.includes("|"));
		if (lines.length < 2) {
			throw new Error("No Markdown table was found.");
		}
		let headerLine = lines[0];
		if (!headerLine.includes("|")) {
			throw new Error("Invalid Markdown table header.");
		}
		let headers = headerLine
			.trim()
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((cell) => cell.trim());
		let bodyStart = 1;
		if (lines[1] && /^\s*\|?\s*:?-{3,}/.test(lines[1])) {
			bodyStart = 2;
		}
		let rows = [];
		for (let index = bodyStart; index < lines.length; index += 1) {
			let raw = lines[index];
			if (!raw.trim()) {
				continue;
			}
			let cells = raw
				.trim()
				.replace(/^\||\|$/g, "")
				.split("|")
				.map((cell) => cell.trim());
			while (cells.length < headers.length) {
				cells.push("");
			}
			rows.push(cells.slice(0, headers.length));
		}
		if (!rows.length) {
			throw new Error("No Markdown table rows were found.");
		}
		return { headers, rows };
	}

	async function saveTableCSV({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let content = String(payload.content || "").trim();
		if (!content) {
			throw new Error("content is required.");
		}
		let { headers, rows } = markdownTableToCSVRows(content);
		await reviewer._ensureDirectory(outputRoot(reviewer, context));
		let path = exportCSVPath(reviewer, context, optionalString(payload.name) || "Explore Table");
		let parts = [headers.map((value) => csvEscape(value)).join(",")];
		for (let row of rows) {
			parts.push(row.map((value) => csvEscape(value)).join(","));
		}
		await reviewer._writeTextFile(path, `${parts.join("\n")}\n`);
		return {
			ok: true,
			path,
			row_count: rows.length,
			headers,
		};
	}

	async function query({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let requestedJobID = existingJobID(payload);
		let saveRun = normalizeBooleanFlag(payload.save_run ?? payload.saveRun, false);
		let queuedName = optionalString(payload.name) || optionalString(payload.query) || "Explore Query";
		if (saveRun && !requestedJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "explore",
				kind: "manual_explore_query",
				title: `Explore Query: ${queuedName}`,
				requested_mode: "explore_query",
				used_mode: "explore_query",
				source_title: current?.collection?.name || context.collectionName || "Explore",
				source_path: context.projectRoot,
				metadata: {
					payload: Object.assign({}, payload || {}),
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Explore query started. Track progress in Jobs.",
			});
		}
		let selection = selectionState(await dataset(reviewer, current, payload), payload);
		let limit = normalizeLimit(payload.limit, DEFAULT_QUERY_LIMIT, 200);
		let name = optionalString(payload.name) || selection.queryText || "Explore Query";
		let job = requestedJobID ? { job_id: requestedJobID } : null;

		if (saveRun && job?.job_id) {
			await SystematicReviewerWorkflowJobs.log(
				reviewer,
				current,
				job.job_id,
				"info",
				`Running explore query over ${selection.rows.length} project records.`
			);
		}

		try {
			let result = buildQueryResult(selection, limit);

			let path = "";
			let savedRuns = null;
			if (saveRun) {
				await reviewer._ensureDirectory(outputRoot(reviewer, context));
				path = saveRunPath(reviewer, context, name);
				await reviewer._writeJSONFile(path, {
					project_id: context.projectID,
					project_root: context.projectRoot,
					name,
					saved_at: new Date().toISOString(),
					payload: {
						query: selection.queryText,
						decision_filter: selection.decisionFilter || "",
						filters: selection.filters,
						columns: selection.searchColumns,
						limit,
						scope: selection.scope || null,
					},
					result,
				});
				savedRuns = await listSavedRuns(reviewer, context);
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
					used_mode: "explore_query",
					output_path: path,
					progress_current: result.total_results,
					progress_total: selection.filtered.length,
					message: `Explore query saved ${result.total_results} result rows.`,
					metadata: {
						query: selection.queryText,
						decision_filter: selection.decisionFilter || "",
						filter_count: selection.filters.length,
						search_column_count: selection.searchColumns.length,
						result_count: result.total_results,
						saved_path: path,
						scope: selection.scope || null,
					},
				});
			}

			return {
				ok: true,
				job_id: job?.job_id || "",
				name,
				path,
				result,
				saved_runs: savedRuns,
				scope: selection.scope || null,
			};
		}
		catch (error) {
			if (job?.job_id) {
				await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			}
			throw error;
		}
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
			out.push({
				name: optionalString(parsed?.name) || file.leafName,
				saved_at: optionalString(parsed?.saved_at),
				query: optionalString(parsed?.payload?.query),
				decision_filter: optionalString(parsed?.payload?.decision_filter),
				filter_count: Array.isArray(parsed?.payload?.filters) ? parsed.payload.filters.length : 0,
				result_count: Number(parsed?.result?.filtered_rows || parsed?.result?.total_results || 0) || 0,
				scope: parsed?.result?.scope || parsed?.payload?.scope || null,
				entry: serializeFileEntry(file),
			});
		}
		return out;
	}

	async function loadSavedRun({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let path = resolveSavedRunPath(reviewer, context, payload);
		let parsed = await reviewer._readJSONFile(path);
		if (!parsed || typeof parsed != "object") {
			throw new Error("Saved explore run file is invalid.");
		}
		let entry = serializeFileEntry(reviewer._nsIFile(path));
		return {
			ok: true,
			name: optionalString(parsed.name) || entry.name,
			path,
			entry,
			saved_at: optionalString(parsed.saved_at),
			payload: parsed.payload && typeof parsed.payload == "object" ? parsed.payload : {},
			result: parsed.result && typeof parsed.result == "object" ? parsed.result : {},
		};
	}

	async function exportCSV({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let requestedJobID = existingJobID(payload);
		let queuedName = optionalString(payload.name) || optionalString(payload.query) || "Explore Query";
		if (!requestedJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "explore",
				kind: "manual_explore_export_csv",
				title: `Explore Export: ${queuedName}`,
				requested_mode: "explore_export_csv",
				used_mode: "explore_export_csv",
				source_title: current?.collection?.name || context.collectionName || "Explore",
				source_path: context.projectRoot,
				metadata: {
					payload: Object.assign({}, payload || {}),
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Explore CSV export started. Track progress in Jobs.",
			});
		}
		let selection = selectionState(await dataset(reviewer, current, payload), payload);
		let rowLimit = normalizeLimit(payload.limit, selection.filtered.length || DEFAULT_QUERY_LIMIT, 5000);
		let rows = selection.filtered.slice(0, rowLimit);
		let name = optionalString(payload.name) || selection.queryText || "Explore Query";
		let columnDefs = exportColumnDefinitions(selection.columns, payload);
		if (!columnDefs.length) {
			throw new Error("No Explore columns are available to export.");
		}
		let job = { job_id: requestedJobID };
		try {
			await reviewer._ensureDirectory(outputRoot(reviewer, context));
			let path = exportCSVPath(reviewer, context, name);
			let csvText = buildExportCSVText(rows, columnDefs);
			await reviewer._writeTextFile(path, `${csvText}\n`);
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: "explore_export_csv",
				output_path: path,
				progress_current: rows.length,
				progress_total: selection.filtered.length,
				message: `Explore CSV export saved ${rows.length} rows.`,
				metadata: {
					query: selection.queryText,
					decision_filter: selection.decisionFilter || "",
					filter_count: selection.filters.length,
					exported_rows: rows.length,
					matched_rows: selection.filtered.length,
					column_count: columnDefs.length,
					saved_path: path,
					scope: selection.scope || null,
				},
			});
			return {
				ok: true,
				job_id: job.job_id,
				path,
				name,
				row_count: rows.length,
				matched_rows: selection.filtered.length,
				column_count: columnDefs.length,
				columns: columnDefs.map((entry) => entry.key),
				headers: columnDefs.map((entry) => entry.header),
				scope: selection.scope || null,
			};
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
	}

	function selectedPromptColumns(selection, prompt, systemPrompt) {
		let placeholderColumns = extractColumnPlaceholders([prompt, systemPrompt]);
		let aliases = columnAliasMap(selection.columns || []);
		let requestedKeys = placeholderColumns
			.map((entry) => resolveColumnKey(entry, selection.columns || [], aliases))
			.filter(Boolean);
		return preferredExploreColumns(selection.columns || [], requestedKeys);
	}

	function buildEffectiveSystemPrompt(basePrompt, promptResource) {
		return optionalString(basePrompt)
			|| promptResource.default_system_prompt
			|| DEFAULT_CHAT_SYSTEM_PROMPT;
	}

	function buildChunkPrompt(promptResource, prompt, csvText, index, total, rowCount, columnDefs = []) {
		let template = optionalString(promptResource.chunk_user_template)
			|| "{prompt}\n\nCSV chunk {index}/{total} (rows={rows}, cols={cols}):\n<csv>\n{csv}\n</csv>";
		return interpolationTemplate(template, {
			prompt: String(prompt || "").trim(),
			index: index + 1,
			total,
			rows: rowCount,
			cols: columnDefs.length,
			csv: String(csvText || "").trimEnd(),
		});
	}

	function buildSummaryPrompt(promptResource, prompt, combinedText, summaryJSON = false) {
		let template = summaryJSON
			? String(promptResource.summary_prompt_json || "")
			: String(promptResource.summary_prompt_markdown || "");
		if (!template) {
				template = summaryJSON
					? "Combine the batch responses into ONE JSON object only: {\"summary\": \"...\", \"highlights\": [...], \"gaps\": [...]}.\n\nUse exact citation tokens from the batch outputs. Use a multi-key citation only when every listed item supports the same finding.\n\nOriginal prompt:\n{prompt}\n\nBatch responses:\n{combined}"
					: "You ran the following prompt in multiple batches. Combine the answers into a concise synthesis while preserving exact citation tokens on the smallest supported claim, clause, example, statistic, table cell, or study-specific phrase.\n\nOriginal prompt:\n{prompt}\n\nBatch responses:\n{combined}";
		}
		return interpolationTemplate(template, {
			prompt: String(prompt || "").trim(),
			combined: String(combinedText || "").trim(),
		});
	}

	async function executeExploreChatRun({
		reviewer,
		current,
		payload = {},
		prompts = null,
		rawChat = null,
		runtime = null,
		includeHistoryDefault = true,
		onProgress = null,
		abortSignal = null,
		decorateChatMessages = true,
		onLog = null,
	}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let prompt = optionalString(payload.prompt);
		if (!prompt) {
			throw new Error("Prompt is required.");
		}
		let promptResource = prompts || await readBundledPromptResource(reviewer);
		let selection = selectionState(await dataset(reviewer, current, payload), payload);
		let rowLimit = Number(payload.row_limit || payload.rowLimit || payload.limit || 0) || 0;
		let selectedRows = selection.filtered.slice(0, Math.max(1, rowLimit || selection.filtered.length));
		if (!selectedRows.length) {
			throw new Error("No project rows matched the current Explore scope.");
		}
		let runtimeOwned = false;
		let effectiveRuntime = runtime;
		try {
			let chatRecord = rawChat;
			if (!chatRecord) {
				if (optionalString(payload.chat_id || payload.chatID || payload.id || payload.path)) {
					chatRecord = await loadChatFile(reviewer, context, payload);
				}
				else {
					let created = await createChat({
						reviewer,
						current,
						payload: {
							name: optionalString(payload.chat_name || payload.chatName || payload.name) || `Explore ${new Date().toLocaleString()}`,
							system_prompt: optionalString(payload.system_prompt || payload.systemPrompt) || promptResource.default_system_prompt || DEFAULT_CHAT_SYSTEM_PROMPT,
							runtime_role_id: optionalString(payload.runtime_role_id || payload.runtimeRoleID),
							runtime_preset_id: optionalString(payload.runtime_preset_id || payload.runtimePresetID),
							batch_context_tokens_override: normalizeContextOverride(payload.batch_context_tokens_override || payload.batchContextTokensOverride),
						},
					});
					chatRecord = await loadChatFile(reviewer, context, { chat_id: created?.chat?.id || "" });
				}
			}
			let storedHistory = normalizeStoredChatMessages(chatRecord?.messages || []);
			let chatMessages = storedHistory.slice();
			let runtimeRoleID = optionalString(payload.runtime_role_id || payload.runtimeRoleID || chatRecord?.runtime_role_id);
			let runtimePresetID = optionalString(payload.runtime_preset_id || payload.runtimePresetID || chatRecord?.runtime_preset_id);
			let batchContextOverride = normalizeContextOverride(
				payload.batch_context_tokens_override
				?? payload.batchContextTokensOverride
				?? chatRecord?.batch_context_tokens_override
			);
			if (!effectiveRuntime) {
				effectiveRuntime = await resolveExploreRuntime(reviewer, {
					runtime_role_id: runtimeRoleID,
					runtime_preset_id: runtimePresetID,
				});
				runtimeOwned = true;
			}
			let systemPrompt = optionalString(
				payload.system_prompt
				|| payload.systemPrompt
				|| chatRecord?.system_prompt
				|| promptResource.default_system_prompt
			) || DEFAULT_CHAT_SYSTEM_PROMPT;
			let effectiveSystemPrompt = buildEffectiveSystemPrompt(systemPrompt, promptResource);
			let includeHistory = normalizeBooleanFlag(
				payload.include_history ?? payload.includeHistory,
				includeHistoryDefault
			);
			let historyLimit = normalizeLimit(payload.history_limit || payload.historyLimit, DEFAULT_CHAT_HISTORY_LIMIT, 50);
			let history = includeHistory
				? storedHistory.slice(Math.max(0, storedHistory.length - historyLimit))
				: [];
			let baseMessages = [
				{ role: "system", content: effectiveSystemPrompt },
				...history
					.filter((entry) => entry.role == "user" || entry.role == "assistant")
					.map((entry) => ({ role: entry.role, content: entry.content })),
			];
			let promptColumnKeys = selectedPromptColumns(selection, prompt, systemPrompt);
			let columnDefs = chatColumnDefinitions(selection.columns, promptColumnKeys);
			if (!columnDefs.length) {
				throw new Error("No Explore columns are available for this prompt.");
			}
			let csvPath = await writeChatContextCSV(reviewer, context, chatRecord.id, selectedRows, columnDefs);
			let baseTokens = estimateMessagesTokens(baseMessages);
			let promptTokens = estimateTokens(prompt);
			let contextTokens = Math.max(1, Number(effectiveRuntime?.context_tokens || 0) || 0);
			if (!contextTokens) {
				throw new Error("The selected Explore runtime does not have a context length configured.");
			}
			let reserveTokens = Math.max(1, Number(
				payload.reserve_tokens
				|| payload.reserveTokens
				|| effectiveRuntime?.reserve_tokens
				|| 0
			) || 0);
			if (contextTokens - reserveTokens - baseTokens - promptTokens <= 0) {
				throw new Error("Prompt and chat history exceed the selected Explore runtime context window.");
			}
			let chunkInfo = buildCSVChunks(selectedRows, columnDefs, {
				base_tokens: baseTokens,
				prompt_tokens: promptTokens,
				context_tokens: batchContextOverride || contextTokens,
				reserve_tokens: reserveTokens,
			});
			if (!chunkInfo.chunks.length) {
				throw new Error("No Explore CSV chunk could fit inside the configured context window.");
			}
			let scopeKey = optionalString(selection?.scope?.collection_key);
			let scopeName = optionalString(selection?.scope?.collection_name);
			let runID = chatRecord.id;
			let userMessage = {
				role: "user",
				content: prompt,
				created_at: new Date().toISOString(),
				query: selection.queryText,
				row_count: selectedRows.length,
				column_keys: columnDefs.map((entry) => entry.header),
				csv_path: csvPath,
				model: "",
				scope: selection.scope || null,
				scope_key: scopeKey,
				scope_name: scopeName,
				run_id: runID,
				runtime_role_id: effectiveRuntime.roleID,
				runtime_label: effectiveRuntime.label,
			};
			chatMessages.push(userMessage);
			await Promise.resolve(onProgress?.({
				type: "run.started",
				chat_id: chatRecord.id,
				chat_name: chatRecord.name,
				scope: selection.scope || null,
				row_count: selectedRows.length,
				batch_count: chunkInfo.chunks.length,
				column_keys: columnDefs.map((entry) => entry.header),
				csv_path: csvPath,
			}));
			let batchOutputs = new Array(chunkInfo.chunks.length);
			let completedBatches = 0;
			let concurrency = Math.max(1, Number(effectiveRuntime?.client?.parallelRequests || 1) || 1);
			let nextBatchIndex = 0;
			let citationMeta = citationIndex(selectedRows);
			let retrySummary = {
				attempt_limit: DEFAULT_EXPLORE_ATTEMPTS,
				batch_retry_count: 0,
				summary_retry_count: 0,
				retried_batches: [],
				summary_attempts: 0,
				reply_source: "",
			};
			let workers = Array.from({ length: Math.min(concurrency, Math.max(1, chunkInfo.chunks.length)) }, () => (async () => {
				while (true) {
					let index = nextBatchIndex;
					nextBatchIndex += 1;
					if (index >= chunkInfo.chunks.length) {
						return;
					}
					let chunk = chunkInfo.chunks[index];
					let userChunkPrompt = buildChunkPrompt(promptResource, prompt, chunk.text, index, chunkInfo.chunks.length, chunk.rows.length, columnDefs);
					let messages = baseMessages.concat([{ role: "user", content: userChunkPrompt }]);
					let phaseLabel = `Explore batch ${index + 1}/${chunkInfo.chunks.length}`;
					let completionResult = await runExploreCompletionWithRetries({
						phaseLabel,
						runtime: effectiveRuntime,
						messages,
						attemptLimit: DEFAULT_EXPLORE_ATTEMPTS,
						onLog,
						signal: abortSignal || null,
					});
					let split = completionResult.split;
					if (completionResult.retry_count > 0) {
						retrySummary.batch_retry_count += completionResult.retry_count;
						retrySummary.retried_batches.push({
							batch_index: index,
							attempts_used: completionResult.attempts_used,
							retry_count: completionResult.retry_count,
						});
					}
					let artifactPath = split.visible
						? await saveBatchMarkdown(reviewer, context, chatRecord.name || "Explore Batch", index, split.visible)
						: "";
					let assistantMessage = {
						role: "assistant",
						content: split.visible,
						thinking: split.thinking,
						created_at: new Date().toISOString(),
						query: selection.queryText,
						row_count: chunk.rows.length,
						column_keys: columnDefs.map((entry) => entry.header),
						csv_path: csvPath,
						model: String(effectiveRuntime?.client?.model || ""),
						scope: selection.scope || null,
						scope_key: scopeKey,
						scope_name: scopeName,
						summary: false,
						batch: index,
						artifact_path: artifactPath,
						run_id: runID,
						runtime_role_id: effectiveRuntime.roleID,
						runtime_label: effectiveRuntime.label,
						model_preset_id: String(effectiveRuntime?.preset_id || "default").trim() || "default",
						model_preset_label: String(effectiveRuntime?.preset_label || "").trim(),
						citations: resolveCitationMetadataFromText(split.visible, citationMeta),
					};
					batchOutputs[index] = assistantMessage;
					chatMessages.push(assistantMessage);
					completedBatches += 1;
					await Promise.resolve(onProgress?.({
						type: "batch.completed",
						chat_id: chatRecord.id,
						chat_name: chatRecord.name,
						batch_index: index,
						batch_count: chunkInfo.chunks.length,
						completed_batches: completedBatches,
						artifact_path: artifactPath,
						message: assistantMessage,
					}));
				}
			})());
			await Promise.all(workers);
			batchOutputs = batchOutputs.filter(Boolean);
			let summaryResult = null;
			let summaryArtifactPath = "";
			let shouldSummarise = payload.summarise_batches === undefined && payload.summariseBatches === undefined
				? chunkInfo.chunks.length > 1
				: normalizeBooleanFlag(payload.summarise_batches ?? payload.summariseBatches, false);
			let summaryJSON = normalizeBooleanFlag(payload.summary_json ?? payload.summaryJson, false);
			if (shouldSummarise && batchOutputs.length > 1) {
				let combined = batchOutputs.map((entry, index) => `Batch ${index + 1}:\n${entry.content}`).join("\n\n");
				let summaryPrompt = buildSummaryPrompt(promptResource, prompt, combined, summaryJSON);
				let messages = baseMessages.concat([{ role: "user", content: summaryPrompt }]);
				let summaryResultRecord = await runExploreCompletionWithRetries({
					phaseLabel: "Explore summary",
					runtime: effectiveRuntime,
					messages,
					attemptLimit: DEFAULT_EXPLORE_ATTEMPTS,
					onLog,
					signal: abortSignal || null,
				});
				let split = summaryResultRecord.split;
				retrySummary.summary_attempts = summaryResultRecord.attempts_used;
				retrySummary.summary_retry_count = summaryResultRecord.retry_count;
				let summaryMessage = {
					role: "assistant",
					content: split.visible,
					thinking: split.thinking,
					created_at: new Date().toISOString(),
					query: selection.queryText,
					row_count: selectedRows.length,
					column_keys: columnDefs.map((entry) => entry.header),
					csv_path: csvPath,
					model: String(effectiveRuntime?.client?.model || ""),
					scope: selection.scope || null,
					scope_key: scopeKey,
					scope_name: scopeName,
					summary: true,
					batch: null,
					run_id: runID,
					runtime_role_id: effectiveRuntime.roleID,
					runtime_label: effectiveRuntime.label,
					citations: resolveCitationMetadataFromText(split.visible, citationIndex(selectedRows)),
				};
				chatMessages.push(summaryMessage);
				summaryResult = summaryMessage.content;
				summaryArtifactPath = summaryResult
					? await saveRunMarkdown(reviewer, context, `${chatRecord.name || "Explore Summary"} summary`, summaryResult)
					: "";
				await Promise.resolve(onProgress?.({
					type: "summary.completed",
					chat_id: chatRecord.id,
					chat_name: chatRecord.name,
					artifact_path: summaryArtifactPath,
					message: summaryMessage,
				}));
			}
			let finalReply = "";
			if (summaryResult) {
				finalReply = optionalString(summaryResult);
				retrySummary.reply_source = "summary";
			}
			else if (batchOutputs.length == 1) {
				finalReply = optionalString(batchOutputs[0]?.content);
				retrySummary.reply_source = "single_batch";
			}
			else {
				finalReply = batchOutputs
					.map((entry) => optionalString(entry?.content))
					.filter(Boolean)
					.join("\n\n")
					.trim();
				retrySummary.reply_source = "combined_batches";
			}
			if (!finalReply) {
				throw new Error("Explore run completed generation but produced no final inline reply.");
			}
			let markdownPath = finalReply
				? await saveRunMarkdown(reviewer, context, chatRecord.name || optionalString(payload.name) || "Explore Run", finalReply)
				: "";
			let saved = await saveChat(reviewer, context, {
				id: chatRecord.id,
				name: chatRecord.name,
				system_prompt: systemPrompt,
				model: String(effectiveRuntime?.client?.model || ""),
				runtime_role_id: effectiveRuntime.roleID,
				runtime_preset_id: effectiveRuntime.preset_id,
				batch_context_tokens_override: batchContextOverride,
				markdown_path: markdownPath,
				origin: optionalString(payload.origin) || optionalString(chatRecord?.origin) || "explore",
				session_id: optionalString(payload.session_id || payload.sessionID || chatRecord?.session_id),
				scope_key: scopeKey,
				scope_name: scopeName,
				row_count: selectedRows.length,
				batch_count: chunkInfo.chunks.length,
				final_reply: finalReply,
				created_at: chatRecord.created_at,
				messages: chatMessages,
			});
			let decorated = decorateChatMessages
				? await decorateChat(reviewer, current, saved)
				: Object.assign({}, saved);
			let batches = batchOutputs.map((entry) => ({
				batch_index: Number(entry?.batch || 0) || 0,
				row_count: Number(entry?.row_count || 0) || 0,
				artifact_path: optionalString(entry?.artifact_path),
				created_at: optionalString(entry?.created_at),
			}));
			await Promise.resolve(onProgress?.({
				type: "run.completed",
				chat_id: saved.id,
				chat_name: saved.name,
				markdown_path: markdownPath,
				summary_path: summaryArtifactPath,
				reply: finalReply,
				batches,
				scope: selection.scope || null,
			}));
			return {
				ok: true,
				chat: decorated,
				completion_status: "success",
				reply: finalReply,
				reply_source: retrySummary.reply_source,
				markdown_path: markdownPath,
				summary_path: summaryArtifactPath,
				batches,
				retry_summary: retrySummary,
				selection: {
					query: selection.queryText,
					filters: selection.filters,
					search_columns: selection.searchColumns,
					row_count: selectedRows.length,
					matched_rows: selection.filtered.length,
					csv_path: csvPath,
					truncated: chunkInfo.truncated,
					scope: selection.scope || null,
					column_keys: columnDefs.map((entry) => entry.header),
					batch_count: chunkInfo.chunks.length,
					batch_context_tokens_override: batchContextOverride,
					context_tokens: contextTokens,
				},
				runtime: {
					role_id: effectiveRuntime.roleID,
					label: effectiveRuntime.label,
					model: String(effectiveRuntime?.client?.model || ""),
					preset_id: String(effectiveRuntime?.preset_id || "default").trim() || "default",
					preset_label: String(effectiveRuntime?.preset_label || "").trim(),
				},
			};
		}
		finally {
			if (runtimeOwned) {
				await effectiveRuntime?.release?.();
			}
		}
	}

	async function loadChat({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let chat = await loadChatFile(reviewer, context, payload);
		return {
			ok: true,
			chat: await decorateChat(reviewer, current, chat),
		};
	}

	async function runChat({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let prompt = optionalString(payload.prompt);
		if (!prompt) {
			throw new Error("Prompt is required.");
		}
		let requestedJobID = existingJobID(payload);
		let queuedName = optionalString(payload.chat_name || payload.chatName || payload.name) || "Explore Chat";
		if (!requestedJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "explore",
				kind: "manual_explore_chat",
				title: `Explore Chat: ${queuedName}`,
				requested_mode: "explore_chat",
				used_mode: "explore_chat",
				source_title: current?.collection?.name || context.collectionName || "Explore",
				source_path: context.projectRoot,
				output_path: context.projectRoot,
				metadata: {
					payload: Object.assign({}, payload || {}),
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Explore chat started. Track progress in Jobs.",
			});
		}
		let runtime = null;
		try {
			let job = { job_id: requestedJobID };
			try {
				runtime = await resolveExploreRuntime(reviewer, {
					runtime_role_id: optionalString(payload.runtime_role_id || payload.runtimeRoleID),
					runtime_preset_id: optionalString(payload.runtime_preset_id || payload.runtimePresetID),
				});
				let result = await executeExploreChatRun({
					reviewer,
					current,
					payload: Object.assign({}, payload || {}, {
						origin: "explore",
					}),
					runtime,
					includeHistoryDefault: true,
					onLog: async (level, message) => {
						await SystematicReviewerWorkflowJobs.log(
							reviewer,
							current,
							job.job_id,
							level || "info",
							String(message || "").trim()
						);
					},
				});
				let selectedRows = Number(result?.selection?.row_count || 0) || 0;
				let batchCount = Number(result?.selection?.batch_count || 0) || 0;
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					job.job_id,
					"info",
					`Explore chat completed ${selectedRows} rows in ${batchCount} batch(es) using ${String(runtime.client?.model || runtime.label || "chat model")}.`
				);
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
					used_mode: String(runtime.client?.model || ""),
					output_path: result?.markdown_path || result?.chat?.path,
					progress_current: selectedRows,
					progress_total: selectedRows,
					message: `Explore chat reply saved for ${String(result?.chat?.name || queuedName).trim()}.`,
					metadata: {
						chat_id: result?.chat?.id || "",
						chat_path: result?.chat?.path || "",
						markdown_path: result?.markdown_path || "",
						csv_path: result?.selection?.csv_path || "",
						row_count: selectedRows,
						truncated: !!result?.selection?.truncated,
						batch_count: batchCount,
						completion_status: String(result?.completion_status || ""),
						reply_source: String(result?.reply_source || ""),
						retry_summary: result?.retry_summary || null,
						scope: result?.selection?.scope || null,
						runtime_role_id: runtime.roleID,
						runtime_preset_id: runtime.preset_id,
						batch_context_tokens_override: Number(result?.selection?.batch_context_tokens_override || 0) || 0,
					},
				});
				return Object.assign({}, result, {
					job_id: job.job_id,
				});
			}
			catch (error) {
				await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
				throw error;
			}
		}
		finally {
			await runtime.release?.();
		}
	}

	async function runAutomationChat({ reviewer, current, payload = {}, runtime = null, onProgress = null }) {
		let effectivePayload = Object.assign({}, payload || {}, {
			origin: "automation",
			include_history: false,
		});
		return await executeExploreChatRun({
			reviewer,
			current,
			payload: effectivePayload,
			runtime,
			includeHistoryDefault: false,
			onProgress,
			abortSignal: payload?.abortSignal || null,
			decorateChatMessages: false,
		});
	}

	async function listAutomationRuns({ reviewer, current, payload = {} }) {
		let chats = await listChats(reviewer, current?.context);
		let origin = optionalString(payload.origin || "automation");
		return {
			ok: true,
			runs: (Array.isArray(chats) ? chats : []).filter((entry) =>
				!origin || optionalString(entry?.origin) == origin
			),
		};
	}

	async function listAutomationBatches({ reviewer, current, payload = {} }) {
		let chat = await loadChatFile(reviewer, current?.context, payload);
		let messages = normalizeStoredChatMessages(chat?.messages || []);
		let batches = messages
			.filter((entry) => entry.batch !== null && entry.batch !== undefined && !entry.summary)
			.sort((left, right) => Number(left.batch || 0) - Number(right.batch || 0))
			.map((entry) => ({
				batch_index: Number(entry.batch || 0) || 0,
				row_count: Number(entry.row_count || 0) || 0,
				artifact_path: optionalString(entry.artifact_path),
				created_at: optionalString(entry.created_at),
			}));
		return {
			ok: true,
			chat_id: chat.id,
			chat_name: chat.name,
			batches,
		};
	}

	async function loadAutomationBatch({ reviewer, current, payload = {} }) {
		let chat = await loadChatFile(reviewer, current?.context, payload);
		let batchIndex = Number(payload.batch_index ?? payload.batchIndex ?? payload.index);
		if (!Number.isFinite(batchIndex) || batchIndex < 0) {
			throw new Error("batch_index is required.");
		}
		let messages = normalizeStoredChatMessages(chat?.messages || []);
		let entry = messages.find((message) => Number(message?.batch || 0) === Math.round(batchIndex) && !message?.summary) || null;
		if (!entry) {
			throw new Error("Explore batch was not found.");
		}
		return {
			ok: true,
			chat_id: chat.id,
			chat_name: chat.name,
			batch_index: Number(entry.batch || 0) || 0,
			row_count: Number(entry.row_count || 0) || 0,
			content: String(entry.content || ""),
			artifact_path: optionalString(entry.artifact_path),
			citations: Array.isArray(entry.citations) ? entry.citations : [],
			scope: entry.scope || null,
			scope_key: optionalString(entry.scope_key),
			scope_name: optionalString(entry.scope_name),
			created_at: optionalString(entry.created_at),
		};
	}

	async function snapshot({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let inspection = await reviewer._inspectProjectSession(current);
		let counts = await reviewer._projectCounts(context);
		let sessions = await summarizeSessions(
			reviewer,
			context,
			payload.session_limit || payload.limit || DEFAULT_SESSION_LIMIT
		);
		let jobs = await reviewer._listJobs(
			context,
			normalizeLimit(payload.job_limit || payload.limit, DEFAULT_JOB_LIMIT, 200)
		);
		let [sessionState, jobState, artifacts, artifactsInfo, report] = await Promise.all([
			loadSessionDetail({ reviewer, current, payload, sessions }),
			loadJobDetail({ reviewer, current, payload, jobs }),
			listArtifacts(reviewer, context, payload.artifact_limit || DEFAULT_ARTIFACT_LIMIT),
			artifactSummary(reviewer, context),
			buildReportState(reviewer, current, inspection),
		]);
		return {
			ok: true,
			project_id: context.projectID,
			collection_name: current?.collection?.name || context.collectionName || "",
			counts,
			inspection,
			report,
			sessions,
			selected_session_id: sessionState.selected_session_id,
			session: sessionState.session,
			jobs,
			selected_job_id: jobState.selected_job_id,
			job: jobState.job,
			artifacts,
			artifact_summary: artifactsInfo,
		};
	}

	return {
		getConfig,
		hasColumnPlaceholders,
		listColumnCatalog,
		listRuntimeChoiceOptions,
		projectDataSchema,
		projectDataRows,
		projectDataRow,
		suggestCitations,
		saveTableCSV,
		snapshot,
		loadSessionDetail,
		loadJobDetail,
		listColumns,
		query,
		listChats,
		createChat,
		loadChat,
		updateChat,
		runChat,
		runAutomationChat,
		listAutomationRuns,
		listAutomationBatches,
		loadAutomationBatch,
		listSavedRuns,
		loadSavedRun,
		exportCSV,
		listArtifacts,
		artifactSummary,
	};
})();
