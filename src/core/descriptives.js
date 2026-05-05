var SystematicReviewerWorkflowDescriptives = (() => {
	const CATEGORY = "descriptives";
	const DEFAULT_RUN_KIND = "descriptives-run";
	const DEFAULT_RUNS_LIMIT = 20;
	const MAX_RUNS_LIMIT = 200;

	function optionalString(value) {
		return String(value || "").trim();
	}

	function normalizeLimit(value, fallback = DEFAULT_RUNS_LIMIT, max = MAX_RUNS_LIMIT) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return fallback;
		}
		return Math.max(1, Math.min(max, Math.round(parsed)));
	}

	function toPercent(part = 0, total = 0) {
		let safeTotal = Number(total || 0) || 0;
		if (safeTotal <= 0) {
			return 0;
		}
		return (Number(part || 0) || 0) / safeTotal * 100;
	}

	function formatPercent(value = 0) {
		let numeric = Number(value || 0);
		if (!Number.isFinite(numeric)) {
			numeric = 0;
		}
		return `${numeric.toFixed(1)}%`;
	}

	function formatStatisticNumber(value) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			return "-";
		}
		if (Math.abs(numeric - Math.round(numeric)) < 1e-9) {
			return String(Math.round(numeric));
		}
		return String(Number(numeric.toFixed(2)));
	}

	function markdownCellText(value = "") {
		return String(value || "")
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => optionalString(line))
			.join("<br />")
			.replace(/\\/g, "\\\\")
			.replace(/\|/g, "\\|");
	}

	function markdownTableFromRows(columns = [], rows = []) {
		if (!Array.isArray(columns) || !columns.length) {
			return "";
		}
		let header = `| ${columns.map((column) => markdownCellText(column)).join(" | ")} |`;
		let align = `| ${columns.map(() => "---").join(" | ")} |`;
		let out = [header, align];
		for (let row of rows || []) {
			out.push(`| ${(row || []).map((cell) => markdownCellText(cell)).join(" | ")} |`);
		}
		return `${out.join("\n")}\n`;
	}

	function scopeLabel(scope = {}) {
		return optionalString(
			scope?.collection_name
			|| scope?.scope_name
			|| scope?.label
			|| scope?.scope
			|| "Selected scope"
		);
	}

	function scopeNameMatches(entry = {}, expected = "") {
		let wanted = optionalString(expected).toLowerCase();
		if (!wanted) {
			return false;
		}
		return [
			entry?.collection_name,
			entry?.label,
			entry?.scope,
			entry?.scope_kind,
		].some((value) => optionalString(value).toLowerCase() == wanted);
	}

	function defaultScopeName(current = null) {
		return String(current?.projectType || "") == String(PROJECT_TYPE_CUSTOM_ANALYSIS || "")
			? String(CUSTOM_ANALYSIS_COLLECTION_NAME || "Data")
			: "Included";
	}

	function payloadHasExplicitScope(payload = {}) {
		return !!(
			optionalString(payload?.scope)
			|| optionalString(payload?.collection_key)
			|| optionalString(payload?.collection_name)
			|| optionalString(payload?.collectionKey)
			|| optionalString(payload?.collectionName)
		);
	}

	function withDefaultScope(reviewer, current, payload = {}) {
		let next = Object.assign({}, payload || {});
		if (payloadHasExplicitScope(next)) {
			return next;
		}
		let scopes = SystematicReviewerWorkflowScreening.availableScopes(reviewer, current) || [];
		if (!scopes.length) {
			return next;
		}
		let preferred = scopes.find((entry) => scopeNameMatches(entry, defaultScopeName(current))) || scopes[0] || null;
		if (!preferred) {
			return next;
		}
		if (preferred.collection_key && !optionalString(next.collection_key)) {
			next.collection_key = String(preferred.collection_key || "");
		}
		if (preferred.collection_name && !optionalString(next.collection_name)) {
			next.collection_name = String(preferred.collection_name || "");
		}
		if ((preferred.scope_kind || preferred.scope) && !optionalString(next.scope)) {
			next.scope = String(preferred.scope_kind || preferred.scope || "");
		}
		return next;
	}

	function booleanFlag(value, fallback = false) {
		if (value === true || value === false) {
			return value;
		}
		let raw = optionalString(value).toLowerCase();
		if (!raw) {
			return fallback;
		}
		if (["true", "1", "yes", "y"].includes(raw)) {
			return true;
		}
		if (["false", "0", "no", "n"].includes(raw)) {
			return false;
		}
		return fallback;
	}

	function logicLabel(matchMode = "and") {
		return matchMode == "or" ? "Any rule (OR)" : "All rules (AND)";
	}

	function artifactRoot(reviewer, context) {
		if (!context) {
			return "";
		}
		let workflowRoot = typeof SystematicReviewerWorkflowArtifacts?.workflowDir == "function"
			? SystematicReviewerWorkflowArtifacts.workflowDir(reviewer, context)
			: "";
		return workflowRoot ? reviewer._joinPath(workflowRoot, CATEGORY) : "";
	}

	function listArtifactFiles(reviewer, dirPath = "") {
		let dir = reviewer._nsIFile(dirPath);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let out = [];
		let entries = dir.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.isFile?.() || entry.leafName.startsWith(".") || !/\.txt$/i.test(entry.leafName)) {
				continue;
			}
			out.push(entry);
		}
		return out.sort((left, right) => (right.lastModifiedTime || 0) - (left.lastModifiedTime || 0));
	}

	function serializeFileEntry(file) {
		return {
			name: file.leafName,
			path: file.path,
			mtime: file.lastModifiedTime || 0,
			size: file.fileSize || 0,
		};
	}

	function resolveArtifactPath(reviewer, context, payload = {}) {
		let root = artifactRoot(reviewer, context);
		let requestedPath = optionalString(payload.path);
		let requestedName = optionalString(payload.name);
		let resolvedPath = requestedPath || (requestedName ? reviewer._joinPath(root, requestedName) : "");
		if (!resolvedPath) {
			throw new Error("Provide a saved descriptives run path or file name.");
		}
		let prefix = root.endsWith("/") ? root : `${root}/`;
		if (resolvedPath != root && !resolvedPath.startsWith(prefix)) {
			throw new Error("Saved descriptives run must be inside the current project descriptives outputs folder.");
		}
		if (!reviewer._pathExists(resolvedPath)) {
			throw new Error("Saved descriptives run was not found.");
		}
		return resolvedPath;
	}

	function ruleValueRequired(operator = "") {
		return !["empty", "not_empty"].includes(optionalString(operator).toLowerCase());
	}

	function normalizeStatsColumns(payload = {}) {
		let raw = payload?.stats_columns ?? payload?.statsColumns ?? [];
		if (typeof raw == "string") {
			raw = raw.split(",");
		}
		let out = [];
		let seen = new Set();
		for (let entry of Array.isArray(raw) ? raw : []) {
			let key = optionalString(entry?.column_key || entry?.columnKey || entry);
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(key);
		}
		return out;
	}

	function includeItemKeysRequested(payload = {}) {
		return booleanFlag(
			payload?.include_item_keys
				?? payload?.includeItemKeys
				?? payload?.return_item_keys
				?? payload?.returnItemKeys
				?? payload?.include_citation_tokens
				?? payload?.includeCitationTokens,
			false
		);
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

	function citationTokenForKeys(keys = []) {
		let itemKeys = uniqueItemKeys(keys);
		return itemKeys.length ? `@[${itemKeys.join(",")}]` : "";
	}

	function buildCitationEntry(itemKeys = [], recordsByKey = new Map()) {
		let keys = uniqueItemKeys(itemKeys);
		let token = citationTokenForKeys(keys);
		if (!token) {
			return null;
		}
		return {
			token,
			item_keys: keys.slice(),
			labels: keys.map((itemKey) => {
				let record = recordsByKey.get(itemKey) || {};
				return {
					item_key: itemKey,
					citation_text: optionalString(record?.citation_text || record?.title || itemKey),
					title: optionalString(record?.title),
					year: optionalString(record?.year),
				};
			}),
		};
	}

	function collectCitationEntries(entries = []) {
		let out = [];
		let seen = new Set();
		for (let entry of entries || []) {
			let token = optionalString(entry?.token);
			if (!token || seen.has(token)) {
				continue;
			}
			seen.add(token);
			out.push(entry);
		}
		return out;
	}

	function medianValue(values = []) {
		if (!Array.isArray(values) || !values.length) {
			return null;
		}
		let sorted = values.slice().sort((left, right) => left - right);
		let middle = Math.floor(sorted.length / 2);
		if (sorted.length % 2) {
			return sorted[middle];
		}
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}

	function numericStatsForColumn(records = [], columnKey = "", label = "", recordsByKey = new Map(), options = {}) {
		let includeItemKeys = !!(options?.include_item_keys || options?.includeItemKeys);
		let numericEntries = [];
		for (let record of records || []) {
			let numeric = SystematicReviewerWorkflowScreening.extractNumericValue(
				SystematicReviewerWorkflowScreening.recordValue(record, columnKey)
			);
			if (numeric === null) {
				continue;
			}
			numericEntries.push({
				item_key: optionalString(record?.item_key),
				value: numeric,
			});
		}
		let values = numericEntries
			.map((entry) => entry.value)
			.filter((value) => Number.isFinite(value))
			.sort((left, right) => left - right);
		let numericValueCount = values.length;
		let rowTotal = Array.isArray(records) ? records.length : 0;
		let min = numericValueCount ? values[0] : null;
		let max = numericValueCount ? values[values.length - 1] : null;
		let sum = values.reduce((acc, value) => acc + value, 0);
		let itemKeys = includeItemKeys ? uniqueItemKeys(numericEntries) : [];
		let result = {
			column_key: columnKey,
			label: optionalString(label || columnKey),
			row_total: rowTotal,
			numeric_value_count: numericValueCount,
			non_numeric_count: Math.max(0, rowTotal - numericValueCount),
			mean: numericValueCount ? sum / numericValueCount : null,
			median: medianValue(values),
			min,
			max,
			range: numericValueCount ? max - min : null,
		};
		if (includeItemKeys) {
			result.item_keys = itemKeys;
			result.citation_token = citationTokenForKeys(itemKeys);
			result.citation = buildCitationEntry(itemKeys, recordsByKey);
		}
		return result;
	}

	async function prepareRun(reviewer, current, payload = {}) {
		let context = current?.context || null;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let scopedPayload = withDefaultScope(reviewer, current, payload || {});
		let allColumns = await SystematicReviewerWorkflowScreening.listAllColumnDefinitions(reviewer, context);
		let availableColumns = new Map(
			(allColumns || [])
				.map((column) => {
					let key = optionalString(column?.column_key || column?.key);
					return key ? [key, column] : null;
				})
				.filter(Boolean)
		);
		let rawRules = Array.isArray(scopedPayload.rules) ? scopedPayload.rules : [];
		let rules = rawRules
			.map((entry) => SystematicReviewerWorkflowScreening.normalizeActionRule(entry))
			.filter((rule) => {
				if (!optionalString(rule?.column_key) || !optionalString(rule?.operator)) {
					return false;
				}
				return !ruleValueRequired(rule.operator) || !!optionalString(rule.match_value);
			});
		for (let rule of rules) {
			if (!availableColumns.has(rule.column_key)) {
				throw new Error(`Unknown descriptives column: ${rule.column_key}`);
			}
		}
		let statsColumns = normalizeStatsColumns(scopedPayload);
		for (let columnKey of statsColumns) {
			if (!availableColumns.has(columnKey)) {
				throw new Error(`Unknown descriptives stats column: ${columnKey}`);
			}
		}
		if (!rules.length && !statsColumns.length) {
			throw new Error("Provide at least one complete descriptives rule or one stats column.");
		}
		let matchMode = SystematicReviewerWorkflowScreening.normalizeMatchMode(
			scopedPayload.match_mode || scopedPayload.matchMode || "and"
		);
		let dynamicColumns = await SystematicReviewerWorkflowScreening.listDynamicColumnCatalog(reviewer, context);
		let merged = await SystematicReviewerWorkflowScreening.mergedState(reviewer, current, scopedPayload, {
			columns: dynamicColumns,
		});
		return {
			payload: scopedPayload,
			rules,
			stats_columns: statsColumns,
			match_mode: matchMode,
			scope: merged?.scope || null,
			records: Array.isArray(merged?.records) ? merged.records : [],
			available_columns: availableColumns,
		};
	}

	function renderItemKeyDetailsMarkdown(details = {}) {
		let lines = [];
		let addTokenLine = (label, token) => {
			let value = optionalString(token);
			if (value) {
				lines.push(`- ${label}: ${value}`);
			}
		};
		addTokenLine("Scope citation token", details.scope_citation_token);
		addTokenLine("Analysis citation token", details.analysis_citation_token);
		addTokenLine("Matched citation token", details.matched_citation_token);
		for (let entry of Array.isArray(details.numeric_stats) ? details.numeric_stats : []) {
			addTokenLine(`${optionalString(entry?.label || entry?.column_key || "Numeric column")} numeric values`, entry?.citation_token);
		}
		if (!lines.length) {
			return "";
		}
		return [
			"### Item Key Details",
			"",
			"Item key and citation-token details are included because item-key output was requested. They are appended after the descriptive results so broad summaries keep the result content first.",
			"",
			lines.join("\n"),
			"",
		].join("\n");
	}

	function renderMarkdown(result = {}) {
		let scopeName = scopeLabel(result.scope || {});
		let parts = ["## Descriptive Statistics", ""];
		if (Array.isArray(result.rules) && result.rules.length) {
			let modeLabel = logicLabel(result.match_mode);
			let matchedPercentLabel = formatPercent(result.matched_percent);
			let unmatchedPercentLabel = formatPercent(result.unmatched_percent);
			let hasNumericStats = Array.isArray(result.numeric_stats) && result.numeric_stats.length > 0;
			let criteriaRows = (result.rules || []).map((rule) => {
				let column = result.available_columns?.get?.(rule.column_key) || {};
				return [
					optionalString(column?.label || rule.column_key),
					optionalString(rule.operator),
					["empty", "not_empty"].includes(optionalString(rule.operator)) ? "-" : optionalString(rule.match_value),
				];
			});
			let resultsRows = [
				["Scope total", String(result.scope_total)],
				["Matched", String(result.matched_total)],
				["Matched percent", matchedPercentLabel],
				["Unmatched", String(result.unmatched_total)],
				["Unmatched percent", unmatchedPercentLabel],
			];
			let summaryLine = `Matched ${Number(result.matched_total || 0) || 0} of ${Number(result.scope_total || 0) || 0} papers in ${scopeName} (${matchedPercentLabel}) using ${modeLabel}.`;
			if (hasNumericStats) {
				summaryLine += " Numeric statistics below use those matched papers only.";
			}
			parts.push(summaryLine, "");
			parts.push(
				"### Criteria",
				"",
				markdownTableFromRows(["Column", "Operator", "Value"], criteriaRows).trimEnd(),
				"",
				"### Results",
				"",
				markdownTableFromRows(["Metric", "Value"], resultsRows).trimEnd(),
				""
			);
		}
		else {
			let statsCount = Array.isArray(result.stats_columns) ? result.stats_columns.length : 0;
			let summaryLine = `Analyzed ${Number(result.analysis_total || 0) || 0} papers in ${scopeName} for numeric summaries across ${statsCount} selected column${statsCount == 1 ? "" : "s"}.`;
			parts.push(summaryLine, "");
		}
		if (Array.isArray(result.numeric_stats) && result.numeric_stats.length) {
			let numericRows = result.numeric_stats.map((entry) => [
				optionalString(entry.label || entry.column_key),
				String(Number(entry.row_total || 0) || 0),
				String(Number(entry.numeric_value_count || 0) || 0),
				String(Number(entry.non_numeric_count || 0) || 0),
				formatStatisticNumber(entry.mean),
				formatStatisticNumber(entry.median),
				formatStatisticNumber(entry.min),
				formatStatisticNumber(entry.max),
				formatStatisticNumber(entry.range),
			]);
			parts.push(
				`### Numeric Statistics${Array.isArray(result.rules) && result.rules.length ? " (Matched papers only)" : " (Selected scope)"}`,
				"",
				markdownTableFromRows(
					["Column", "Rows", "Numeric values", "Non-numeric", "Mean", "Median", "Min", "Max", "Range"],
					numericRows
				).trimEnd(),
				""
			);
		}
		if (result.include_item_keys && result.item_key_details) {
			let itemKeyMarkdown = renderItemKeyDetailsMarkdown(result.item_key_details);
			if (itemKeyMarkdown) {
				parts.push(itemKeyMarkdown.trimEnd(), "");
			}
		}
		return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
	}

	async function run({ reviewer, current, payload = {} }) {
		let prepared = await prepareRun(reviewer, current, payload);
		let includeItemKeys = includeItemKeysRequested(payload);
		let scopeRecords = prepared.records || [];
		let hasRules = Array.isArray(prepared.rules) && prepared.rules.length > 0;
		let matchedRecords = hasRules
			? scopeRecords.filter((record) =>
				SystematicReviewerWorkflowScreening.matchesRuleSet(record, prepared.rules, prepared.match_mode)
			)
			: [];
		let analysisRecords = hasRules ? matchedRecords : scopeRecords;
		let scopeItemKeys = includeItemKeys ? uniqueItemKeys(scopeRecords) : [];
		let matchedItemKeys = includeItemKeys ? uniqueItemKeys(matchedRecords) : [];
		let analysisItemKeys = includeItemKeys ? uniqueItemKeys(analysisRecords) : [];
		let recordsByKey = includeItemKeys
			? new Map(
				scopeRecords
					.map((record) => {
						let itemKey = optionalString(record?.item_key);
						return itemKey ? [itemKey, record] : null;
					})
					.filter(Boolean)
			)
			: new Map();
		let numericStats = (prepared.stats_columns || []).map((columnKey) => {
			let column = prepared.available_columns.get(columnKey) || {};
			return numericStatsForColumn(analysisRecords, columnKey, column?.label || columnKey, recordsByKey, {
				includeItemKeys,
			});
		});
		let scopeTotal = scopeRecords.length;
		let matchedTotal = matchedRecords.length;
		let unmatchedTotal = Math.max(0, scopeTotal - matchedTotal);
		let matchedPercent = toPercent(matchedTotal, scopeTotal);
		let unmatchedPercent = toPercent(unmatchedTotal, scopeTotal);
		let itemKeyDetails = null;
		if (includeItemKeys) {
			itemKeyDetails = {
				scope_item_keys: scopeItemKeys,
				scope_citation_token: citationTokenForKeys(scopeItemKeys),
				analysis_item_keys: analysisItemKeys,
				analysis_citation_token: citationTokenForKeys(analysisItemKeys),
				numeric_stats: numericStats.map((entry) => ({
					column_key: entry.column_key,
					label: entry.label,
					item_keys: Array.isArray(entry.item_keys) ? entry.item_keys.slice() : [],
					citation_token: optionalString(entry.citation_token),
				})),
				citations: collectCitationEntries([
					buildCitationEntry(scopeItemKeys, recordsByKey),
					buildCitationEntry(matchedItemKeys, recordsByKey),
					buildCitationEntry(analysisItemKeys, recordsByKey),
					...numericStats.map((entry) => entry.citation),
				]),
			};
			if (hasRules) {
				Object.assign(itemKeyDetails, {
					matched_item_keys: matchedItemKeys,
					matched_citation_token: citationTokenForKeys(matchedItemKeys),
				});
			}
		}
		let response = {
			ok: true,
			mode: hasRules ? "filtered" : "whole_column",
			scope: prepared.scope,
			rules: prepared.rules,
			match_mode: prepared.match_mode,
			logic_label: logicLabel(prepared.match_mode),
			stats_columns: prepared.stats_columns.slice(),
			include_item_keys: includeItemKeys,
			analysis_total: analysisRecords.length,
			numeric_stats: numericStats.map((entry) => ({
				column_key: entry.column_key,
				label: entry.label,
				row_total: entry.row_total,
				numeric_value_count: entry.numeric_value_count,
				non_numeric_count: entry.non_numeric_count,
				mean: entry.mean,
				median: entry.median,
				min: entry.min,
				max: entry.max,
				range: entry.range,
			})),
		};
		if (hasRules) {
			Object.assign(response, {
				scope_total: scopeTotal,
				matched_total: matchedTotal,
				unmatched_total: unmatchedTotal,
				matched_percent: matchedPercent,
				unmatched_percent: unmatchedPercent,
			});
		}
		let markdown = renderMarkdown(Object.assign({}, response, {
			available_columns: prepared.available_columns,
			item_key_details: itemKeyDetails,
		}));
		response.markdown = markdown;
		if (booleanFlag(payload?.save_output ?? payload?.saveOutput, false)) {
			let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
				category: CATEGORY,
				kind: optionalString(payload?.name) || DEFAULT_RUN_KIND,
				extension: "txt",
				content: markdown,
			});
			response.saved_artifact = artifact;
			response.path = artifact?.path || "";
		}
		if (itemKeyDetails) {
			response.item_key_details = itemKeyDetails;
		}
		return response;
	}

	async function listSavedRuns(reviewer, context, payload = {}) {
		let root = artifactRoot(reviewer, context);
		if (!root || !reviewer._pathExists(root)) {
			return [];
		}
		let limit = normalizeLimit(payload.limit, DEFAULT_RUNS_LIMIT, MAX_RUNS_LIMIT);
		return listArtifactFiles(reviewer, root)
			.slice(0, limit)
			.map((file) => ({
				name: file.leafName,
				saved_at: file.lastModifiedTime ? new Date(file.lastModifiedTime).toISOString() : "",
				path: file.path,
				entry: serializeFileEntry(file),
			}));
	}

	async function loadSavedRun({ reviewer, current, payload = {} }) {
		let context = current?.context || null;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let path = resolveArtifactPath(reviewer, context, payload);
		let file = reviewer._nsIFile(path);
		let markdown = String(await reviewer._readFileText(path) || "");
		return {
			ok: true,
			name: file?.leafName || optionalString(payload?.name),
			saved_at: file?.lastModifiedTime ? new Date(file.lastModifiedTime).toISOString() : "",
			path,
			entry: file ? serializeFileEntry(file) : null,
			markdown,
			content: markdown,
		};
	}

	return {
		run,
		listSavedRuns,
		loadSavedRun,
	};
})();
