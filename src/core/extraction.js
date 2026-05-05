var SystematicReviewerWorkflowExtraction = (() => {
	const DEFAULT_LIMIT = 25;
	const DEFAULT_RESULTS_LIMIT = 25;
	const BUILTIN_SOURCE_KEYS = Object.freeze(["title_abstract", "title", "abstract_note", "full_text"]);
	const DEFAULT_ROW_ATTEMPTS = 10;
	const PLACEHOLDER_TOKEN_RE = /@\{([A-Za-z_][A-Za-z0-9_:-]*)\}/g;
	const EMPTY_PLACEHOLDER = Symbol("empty_placeholder");
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
	const BUILTIN_ROW_PLACEHOLDER_COLUMNS = Object.freeze([
		{ key: "item_key", label: "Item key", origin: "builtin", search: false },
		{ key: "citation_text", label: "Citation", origin: "builtin", search: true, aliases: ["citation", "author_year"] },
		{ key: "title", label: "Title", origin: "builtin", search: true },
		{ key: "year", label: "Year", origin: "builtin", search: true },
		{ key: "abstract_note", label: "Abstract", origin: "builtin", search: true, aliases: ["abstract"] },
		{ key: "full-text", label: "Full Text Markdown", origin: "builtin", search: true, aliases: ["full_text", "fulltext"] },
		{ key: "doi", label: "DOI", origin: "builtin", search: true },
		{ key: "openalex_id", label: "OpenAlex ID", origin: "builtin", search: true },
		{ key: "zotero_uri", label: "Zotero URI", origin: "builtin", search: false },
	]);
	const EXTRACTION_RUNTIME_PLACEHOLDER_COLUMNS = Object.freeze([
		{ key: "source_key", label: "Source key", origin: "runtime", search: true },
		{ key: "source_label", label: "Source label", origin: "runtime", search: true },
		{ key: "source_text", label: "Source text", origin: "runtime", search: true },
	]);

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

	function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = 500) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return fallback;
		}
		return Math.max(1, Math.min(max, Math.round(parsed)));
	}

	function normalizeSourceKey(value) {
		let key = String(value || "").trim().toLowerCase();
		if (!key || key == "title+abstract") {
			return "title_abstract";
		}
		if (key == "abstract") {
			return "abstract_note";
		}
		if (["full text", "full-text", "markdown", "markdown_text", "pdf_markdown"].includes(key)) {
			return "full_text";
		}
		return key;
	}

	function normalizePlaceholderKey(value) {
		let normalized = optionalString(value).toLowerCase();
		let aliases = {
			"item-key": "item_key",
			"citation-text": "citation_text",
			"author-year": "citation_text",
			"abstract-note": "abstract_note",
			"full-text": "full_text",
			"fulltext": "full_text",
			"openalex-id": "openalex_id",
			"zotero-uri": "zotero_uri",
			"source-key": "source_key",
			"source-label": "source_label",
			"source-text": "source_text",
		};
		return aliases[normalized] || normalized;
	}

	function placeholderNamesFromTexts(texts = []) {
		let names = [];
		let seen = new Set();
		for (let text of Array.isArray(texts) ? texts : []) {
			for (let match of String(text || "").matchAll(PLACEHOLDER_TOKEN_RE)) {
				let name = normalizePlaceholderKey(match?.[1]);
				if (!name || seen.has(name)) {
					continue;
				}
				seen.add(name);
				names.push(name);
			}
		}
		return names;
	}

	function templatePlaceholderNames(template = {}, fields = []) {
		let texts = [
			template?.system_prompt,
			template?.format_instructions,
			...(Array.isArray(fields)
				? fields.flatMap((field) => [
					field?.guidance || "",
					...Object.values(field?.choice_guidance && typeof field.choice_guidance == "object" ? field.choice_guidance : {}),
				])
				: []),
		];
		return placeholderNamesFromTexts(texts);
	}

	function placeholderText(value) {
		if (value === EMPTY_PLACEHOLDER) {
			return "";
		}
		if (value === null || value === undefined) {
			return "(not available)";
		}
		if (typeof value == "number" || typeof value == "boolean") {
			return String(value);
		}
		if (Array.isArray(value) || (value && typeof value == "object")) {
			try {
				let serialized = JSON.stringify(value, null, 2);
				return serialized && serialized.trim() ? serialized : "(not available)";
			}
			catch (_error) {
				return "(not available)";
			}
		}
		let text = String(value).trim();
		return text || "(not available)";
	}

	function interpolateTemplateText(text = "", values = {}) {
		let source = String(text || "");
		return source.replace(PLACEHOLDER_TOKEN_RE, (match, rawName, offset) => {
			let name = normalizePlaceholderKey(rawName);
			let replacement = placeholderText(values?.[name]);
			let lineStart = source.lastIndexOf("\n", Number(offset || 0) - 1) + 1;
			let prefix = source.slice(lineStart, Number(offset || 0));
			if (/^[ \t]+$/.test(prefix) && replacement.includes("\n")) {
				replacement = replacement.replace(/\n/g, `\n${prefix}`);
			}
			return replacement;
		});
	}

	async function runWithConcurrency(items = [], concurrency = 1, worker) {
		let nextIndex = 0;
		let workers = Array.from({ length: Math.max(1, Math.min(items.length || 1, Number(concurrency || 1) || 1)) }, () => (async () => {
			while (true) {
				let index = nextIndex;
				nextIndex += 1;
				if (index >= items.length) {
					return;
				}
				await worker(items[index], index);
			}
		})());
		await Promise.all(workers);
	}

	function sourceLabel(key) {
		let sourceKey = normalizeSourceKey(key);
		if (sourceKey == "title_abstract") {
			return "Title + Abstract";
		}
		if (sourceKey == "title") {
			return "Title";
		}
		if (sourceKey == "abstract_note") {
			return "Abstract";
		}
		if (sourceKey == "full_text") {
			return "Full Text";
		}
		if (sourceKey.startsWith("extraction:")) {
			return `Extraction: ${sourceKey.slice("extraction:".length).replace(/_/g, " ")}`;
		}
		return sourceKey.replace(/_/g, " ");
	}

	function roleAllowsInlineAPI(reviewer, runtimeRoles, roleID) {
		let role = runtimeRoles?.[roleID] || reviewer?._defaultRuntimeRole?.(roleID) || {};
		return ["local_api", "external_api"].includes(String(role.runtime_type || "").trim());
	}

	function extractionAttemptDiagnostic(runtime = {}, client = {}, completion = null) {
		let runtimeRoleID = optionalString(runtime?.roleID || runtime?.role_id);
		let runtimeType = optionalString(client?.runtimeType || client?.runtime_type || runtime?.runtime_type);
		let presetID = optionalString(runtime?.preset_id || runtime?.presetID || "default") || "default";
		let finishReason = optionalString(
			completion?.finishReason
			|| completion?.finish_reason
			|| completion?.status
		);
		let outputChars = String(completion?.text || "").length;
		return [
			`runtime_role_id=${runtimeRoleID || "(unknown)"}`,
			`runtime_type=${runtimeType || "(unknown)"}`,
			`preset_id=${presetID}`,
			`finish_reason=${finishReason || "(none)"}`,
			`eos_reached=${completion?.eosReached === true ? "true" : "false"}`,
			`truncated=${completion?.truncated === true ? "true" : "false"}`,
			`output_chars=${outputChars}`,
		].join(", ");
	}

	async function requestExtractionCompletion(client = {}, request = {}, runtimeConfig = {}, runtimeMeta = {}, signal = null) {
		let runtimeType = optionalString(client?.runtimeType || client?.runtime_type);
		if (runtimeType == "local_exec") {
			let reasoningEffort = optionalString(client?.reasoningEffort || runtimeMeta?.reasoning_effort || "");
			let result = await SystematicReviewerPDFMarkdown.requestResponses(
				{
					baseUrl: client.baseUrl || client.base_url,
					streamBaseUrl: client.streamBaseUrl || "",
					model: client.model,
					apiKey: client.apiKey || client.api_key || "",
					timeoutMs: client.timeoutMs || client.timeout_ms || 120000,
					runtimeType,
					roleID: client.roleID || runtimeMeta?.roleID || runtimeMeta?.role_id || "",
					reasoningEffort,
					maxOutputTokens: Number(client.maxOutputTokens || client.max_output_tokens || 0) || 0,
				},
				{
					model: client.model,
					input: String(request?.inputText || "").trim(),
					instructions: optionalString(request?.instructions || "") || undefined,
					max_output_tokens: Number(client.maxOutputTokens || client.max_output_tokens || runtimeConfig?.nPredict || 0) || 10000,
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
			request.messages,
			runtimeConfig,
			false,
			{
				inputText: request.inputText,
				instructions: request.instructions,
				signal: signal || null,
			}
		);
	}

	async function resolveExtractionRuntime(reviewer, payload = {}) {
		let config = await reviewer._conversionConfig();
		let apiConnections = config.apiConnections || [];
		let runtimeRoles = reviewer._normalizeRuntimeRoles
			? reviewer._normalizeRuntimeRoles(config.runtimeRoles || {}, apiConnections, null)
			: (config.runtimeRoles || {});
		let preferences = config.runtimePreferences || {};
		let chatRole = runtimeRoles?.session_chat || {};
		let extractionRole = runtimeRoles?.data_extraction || {};
		let preferredRoleID = preferences.use_agent_model_for_data_extraction ? "session_chat" : "data_extraction";
		let fallbackRoleID = preferredRoleID == "session_chat" ? "data_extraction" : "session_chat";
		let labels = {
			session_chat: "Agent Model",
			data_extraction: "Data Extraction Engine",
		};
		let requestedPresetID = optionalString(payload.runtime_preset_id || payload.runtimePresetID || payload.model_preset_id || payload.modelPresetID);
		let requestedRoleID = optionalString(payload.runtime_role_id || payload.runtimeRoleID);
		let roles = {
			session_chat: chatRole,
			data_extraction: extractionRole,
		};
		let kinds = {
			session_chat: "chat",
			data_extraction: "extraction",
		};
		let issues = [];
		for (let roleID of [requestedRoleID || preferredRoleID, requestedRoleID ? "" : fallbackRoleID].filter(Boolean)) {
			let role = roles[roleID] || {};
			if (!roleAllowsInlineAPI(reviewer, runtimeRoles, roleID)) {
				try {
					reviewer._assertRoleExecutionReady(roleID, config, labels[roleID]);
				}
				catch (error) {
					issues.push(String(error?.message || error || "").trim() || `${labels[roleID]} is not configured.`);
					continue;
				}
			}
			let endpoint = reviewer._materializeEndpointFromRole
				? reviewer._materializeEndpointFromRole(kinds[roleID], role, reviewer._findConnectionByID(apiConnections, role.connection_id))
				: null;
			let fallbackClient = roleID == "session_chat" ? config.chatClient : config.extractionClient;
			let effectiveClient = {
				baseUrl: String(endpoint?.base_url || fallbackClient?.baseUrl || "").trim(),
				model: String(endpoint?.model || fallbackClient?.model || "").trim(),
				apiKind: String(endpoint?.api_kind || fallbackClient?.apiKind || "auto").trim() || "auto",
				apiKey: String(endpoint?.api_key || fallbackClient?.apiKey || "").trim(),
				timeoutMs: Number(endpoint?.timeout_ms || fallbackClient?.timeoutMs || 120000) || 120000,
			};
			let prepared = null;
			try {
				prepared = await reviewer._prepareRoleAPIClient(roleID, effectiveClient, config, {
					presetID: requestedPresetID,
				});
			}
			catch (error) {
				issues.push(String(error?.message || error || "").trim() || `${labels[roleID]} is not configured.`);
				continue;
			}
			let preparedClient = prepared?.client || effectiveClient;
			if (!preparedClient.baseUrl || !preparedClient.model) {
				issues.push(`${labels[roleID]} is not configured.`);
				continue;
			}
			if (["local_api", "external_api"].includes(String(preparedClient.runtimeType || role.runtime_type || "").trim())) {
				reviewer._assertConfiguredAIEndpoint("extraction", preparedClient);
			}
			return {
				config,
				roleID,
				label: labels[roleID],
				client: preparedClient,
				release: prepared.release || (async () => {}),
				preset_id: String(preparedClient?.presetID || requestedPresetID || "default").trim() || "default",
				preset_label: String(preparedClient?.presetLabel || "").trim(),
			};
		}
		throw new Error(issues.join(" ") || "No supported runtime role is configured for extraction.");
	}

	async function listRuntimeOptions(reviewer, current) {
		let config = await reviewer._conversionConfig();
		let defaultRoleID = config?.runtimePreferences?.use_agent_model_for_data_extraction
			? "session_chat"
			: "data_extraction";
		let roleLabels = {
			session_chat: "Agent Model",
			data_extraction: "Data Extraction",
		};
		let defaultDetailLabel = (preset = {}) => {
			let runtimeType = optionalString(preset?.runtime_type);
			let parts = [];
			if (runtimeType == "local_exec") {
				let executorLabel = optionalString(preset?.executor_label || preset?.executor_id);
				let model = optionalString(preset?.model);
				if (executorLabel) {
					parts.push(executorLabel);
				}
				if (model && model != executorLabel) {
					parts.push(model);
				}
			}
			else {
				let connectionLabel = optionalString(preset?.connection_label);
				let model = optionalString(preset?.model);
				if (connectionLabel) {
					parts.push(connectionLabel);
				}
				if (model && model != connectionLabel) {
					parts.push(model);
				}
			}
			if (!parts.length) {
				let label = optionalString(preset?.label || preset?.model_label || preset?.short_label);
				label = label.replace(/^Default\s*-\s*/i, "").trim();
				if (label && label.toLowerCase() != "default") {
					parts.push(label);
				}
			}
			return parts.join(" - ");
		};
		let roles = ["session_chat", "data_extraction"];
		let presets = [];
		if (reviewer._listRuntimePresetOptions) {
			for (let roleID of roles) {
				for (let preset of reviewer._listRuntimePresetOptions(roleID, config) || []) {
					let presetID = optionalString(preset?.preset_id || "default") || "default";
					let isDefault = presetID == "default";
					let roleLabel = roleLabels[roleID] || roleID;
					let defaultDetail = isDefault ? defaultDetailLabel(preset) : "";
					let baseLabel = isDefault
						? `Default (${roleLabel})${defaultDetail ? `: ${defaultDetail}` : ""}`
						: `${roleLabel}: ${optionalString(preset?.label || preset?.short_label || presetID) || presetID}`;
					presets.push(Object.assign({}, preset || {}, {
						runtime_role_id: roleID,
						runtime_preset_id: presetID,
						choice_id: `${roleID}::${presetID}`,
						label: baseLabel,
					}));
				}
			}
		}
		let defaultChoiceID = `${defaultRoleID}::default`;
		return {
			default_role_id: defaultRoleID,
			default_preset_id: "default",
			default_choice_id: defaultChoiceID,
			default_label: defaultRoleID == "session_chat" ? "Default (Agent Model)" : "Default (Data Extraction)",
			presets,
		};
	}

	async function listRuntimeSelectorOptions(reviewer, current) {
		return {
			ok: true,
			runtime_options: await listRuntimeOptions(reviewer, current),
		};
	}

	function stripThinkContent(text = "") {
		let cleaned = String(text || "");
		cleaned = cleaned.replace(/<\s*think\b[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi, "");
		let strayClose = cleaned.toLowerCase().lastIndexOf("</think>");
		if (strayClose >= 0) {
			cleaned = cleaned.slice(strayClose + "</think>".length);
		}
		return cleaned.trim();
	}

	function extractJSONObjectPayload(text = "") {
		let cleaned = stripThinkContent(text);
		if (!cleaned) {
			throw new Error("The model returned an empty response.");
		}
		let containers = [];
		let stack = [];
		let start = -1;
		let inString = false;
		let escape = false;
		for (let index = 0; index < cleaned.length; index += 1) {
			let char = cleaned[index];
			if (inString) {
				if (escape) {
					escape = false;
					continue;
				}
				if (char == "\\") {
					escape = true;
					continue;
				}
				if (char == "\"") {
					inString = false;
				}
				continue;
			}
			if (char == "\"") {
				inString = true;
				continue;
			}
			if (char == "{" || char == "[") {
				if (!stack.length) {
					start = index;
				}
				stack.push(char);
				continue;
			}
			if (char != "}" && char != "]") {
				continue;
			}
			if (!stack.length) {
				continue;
			}
			let open = stack[stack.length - 1];
			let validPair = (open == "{" && char == "}") || (open == "[" && char == "]");
			if (!validPair) {
				throw new Error("The model returned malformed JSON.");
			}
			stack.pop();
			if (!stack.length && start >= 0) {
				containers.push({
					type: open == "{" ? "object" : "array",
					text: cleaned.slice(start, index + 1),
				});
				start = -1;
			}
		}
		if (stack.length) {
			throw new Error("The model response ended before the JSON finished.");
		}
		if (!containers.length) {
			throw new Error("No JSON object was found in the completed model response.");
		}
		if (containers.some((container) => container.type != "object")) {
			throw new Error("The model returned a non-object JSON block.");
		}
		let merged = {};
		for (let container of containers) {
			let parsed = JSON.parse(container.text);
			if (!parsed || typeof parsed != "object" || Array.isArray(parsed)) {
				throw new Error("The model returned a non-object JSON payload.");
			}
			merged = Object.assign(merged, parsed);
		}
		return merged;
	}

	function fieldValueFromParsedObject(field, parsedObject) {
		let key = optionalString(field?.key);
		if (!key || !parsedObject || typeof parsedObject != "object" || Array.isArray(parsedObject)) {
			return { present: false, valid: false, value: null };
		}
		if (!Object.prototype.hasOwnProperty.call(parsedObject, key)) {
			return { present: false, valid: false, value: null };
		}
		let rawValue = parsedObject[key];
		if (rawValue === null) {
			return {
				present: true,
				valid: !!field?.allow_null,
				value: null,
			};
		}
		let normalized = normalizeFieldValue(field, rawValue);
		if (normalized === null) {
			return {
				present: true,
				valid: false,
				value: null,
			};
		}
		return {
			present: true,
			valid: true,
			value: normalized,
		};
	}

	function parseStoredValue(entry = null) {
		if (!entry) {
			return null;
		}
		try {
			return JSON.parse(String(entry.value_json || "null"));
		}
		catch (_error) {
			return null;
		}
	}

	function pendingFieldsForRecord(record, selectedFields, templatePath, extractionMap, rowScope = "all") {
		if (rowScope != "missing_fields") {
			return selectedFields.slice();
		}
		return (selectedFields || []).filter((field) => {
			let existing = extractionMap.get(`${record.item_key}::${field.key}`) || null;
			return !existing || existing.template_path != templatePath;
		});
	}

	function existingResolvedFieldValues(record, selectedFields, templatePath, extractionMap, rowScope = "all") {
		let resolved = new Map();
		if (rowScope != "missing_fields") {
			return resolved;
		}
		for (let field of selectedFields || []) {
			let existing = extractionMap.get(`${record.item_key}::${field.key}`) || null;
			if (!existing || existing.template_path != templatePath) {
				continue;
			}
			resolved.set(field.key, parseStoredValue(existing));
		}
		return resolved;
	}

	function fieldChoiceGuidanceValue(field = {}, placeholderValues = {}) {
		let guidance = field?.choice_guidance && typeof field.choice_guidance == "object"
			? field.choice_guidance
			: {};
		let next = {};
		for (let [choice, note] of Object.entries(guidance)) {
			let cleanChoice = optionalString(choice);
			let cleanNote = interpolateTemplateText(note || "", placeholderValues);
			if (!cleanChoice || !cleanNote) {
				continue;
			}
			next[cleanChoice] = cleanNote;
		}
		return Object.keys(next).length ? next : null;
	}

	function renderFieldPromptBlock(field = {}, fieldBlockTemplate = "", placeholderValues = {}) {
		let choiceGuidance = fieldChoiceGuidanceValue(field, placeholderValues);
		let fieldValues = Object.assign({}, placeholderValues, {
			field_key: optionalString(field?.key),
			field_label: optionalString(field?.label || field?.key),
			field_type: optionalString(field?.type || "string") || "string",
			field_guidance: optionalString(interpolateTemplateText(field?.guidance || "", placeholderValues)) || EMPTY_PLACEHOLDER,
			field_allow_null: field?.allow_null ? "true" : "false",
			field_choices: Array.isArray(field?.choices) && field.choices.length ? JSON.stringify(field.choices) : EMPTY_PLACEHOLDER,
			field_choice_guidance: choiceGuidance ? JSON.stringify(choiceGuidance, null, 2) : EMPTY_PLACEHOLDER,
		});
		return interpolateTemplateText(fieldBlockTemplate || "", fieldValues).trim();
	}

	function normalizeBoolean(value) {
		if (value === null || value === undefined || value === "") {
			return null;
		}
		if (typeof value == "boolean") {
			return value;
		}
		let text = String(value).trim().toLowerCase();
		if (!text || text == "null" || text == "unknown" || text == "na" || text == "n/a") {
			return null;
		}
		if (["true", "yes", "1"].includes(text)) {
			return true;
		}
		if (["false", "no", "0"].includes(text)) {
			return false;
		}
		return null;
	}

	function normalizeEnum(value, field) {
		if (value === null || value === undefined || value === "") {
			return null;
		}
		let choices = Array.isArray(field?.choices) ? field.choices.map((entry) => optionalString(entry)) : [];
		if (!choices.length) {
			return optionalString(value) || null;
		}
		let text = optionalString(value);
		if (!text) {
			return null;
		}
		let exact = choices.find((entry) => entry == text);
		if (exact) {
			return exact;
		}
		let lower = text.toLowerCase();
		let ci = choices.find((entry) => entry.toLowerCase() == lower);
		return ci || null;
	}

	function normalizeNumber(value) {
		if (value === null || value === undefined || value === "") {
			return null;
		}
		let numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	}

	function normalizeFieldValue(field, rawValue) {
		let type = optionalString(field?.type || "string").toLowerCase();
		if (rawValue === null || rawValue === undefined || rawValue === "") {
			return null;
		}
		if (type == "number") {
			return normalizeNumber(rawValue);
		}
		if (type == "boolean") {
			return normalizeBoolean(rawValue);
		}
		if (type == "enum") {
			return normalizeEnum(rawValue, field);
		}
		let text = typeof rawValue == "string"
			? rawValue.trim()
			: JSON.stringify(rawValue);
		return text || null;
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

	async function ensureSchema(reviewer, context) {
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS extraction_runs (
				run_id TEXT PRIMARY KEY,
				job_id TEXT,
				template_path TEXT NOT NULL,
				template_name TEXT NOT NULL,
				source_key TEXT NOT NULL,
				model TEXT NOT NULL,
				item_total INTEGER NOT NULL DEFAULT 0,
				item_succeeded INTEGER NOT NULL DEFAULT 0,
				item_failed INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS extraction_values (
				item_key TEXT NOT NULL,
				template_path TEXT NOT NULL,
				template_name TEXT NOT NULL,
				field_key TEXT NOT NULL,
				field_label TEXT NOT NULL,
				field_type TEXT NOT NULL,
				source_key TEXT NOT NULL,
				value_json TEXT NOT NULL,
				value_text TEXT,
				status TEXT NOT NULL DEFAULT 'ok',
				error_message TEXT,
				model TEXT NOT NULL,
				run_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (item_key, template_path, field_key)
			)`
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_extraction_values_template_field ON extraction_values(template_path, field_key)"
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_extraction_values_source_field ON extraction_values(source_key, field_key)"
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_extraction_values_field_updated_item ON extraction_values(field_key, updated_at, item_key)"
		);
	}

	function buildSourceText(record, sourceKey, extractedValueMap = null) {
		let key = normalizeSourceKey(sourceKey);
		if (key == "title_abstract") {
			return [record.title, record.abstract_note].filter(Boolean).join("\n\n").trim();
		}
		if (key == "title") {
			return optionalString(record.title);
		}
		if (key == "abstract_note") {
			return optionalString(record.abstract_note);
		}
		if (key.startsWith("extraction:")) {
			let fieldKey = key.slice("extraction:".length);
			return optionalString(extractedValueMap?.get(`${record.item_key}::${fieldKey}`)?.value_text || "");
		}
		return "";
	}

	async function preferredFullTextSourceForRecord(reviewer, current, record = {}, sourceMap = null) {
		let itemKey = optionalString(record?.item_key);
		if (!itemKey) {
			return null;
		}
		if (sourceMap instanceof Map && sourceMap.has(itemKey)) {
			return sourceMap.get(itemKey) || null;
		}
		let context = current?.context;
		let item = context?.libraryID && Zotero?.Items?.getByLibraryAndKey
			? Zotero.Items.getByLibraryAndKey(context.libraryID, itemKey)
			: null;
		if (!item || item.deleted) {
			return null;
		}
		return SystematicReviewerWorkflowRAG?.preferredMarkdownSourceForItem
			? await SystematicReviewerWorkflowRAG.preferredMarkdownSourceForItem(reviewer, item)
			: null;
	}

	async function buildFullTextSourceMap(reviewer, current, records = []) {
		let map = new Map();
		for (let record of Array.isArray(records) ? records : []) {
			let itemKey = optionalString(record?.item_key);
			if (!itemKey || map.has(itemKey)) {
				continue;
			}
			let source = await preferredFullTextSourceForRecord(reviewer, current, record, null);
			if (!source?.markdown_path) {
				continue;
			}
			map.set(itemKey, {
				attachment_key: optionalString(source?.attachment_key),
				markdown_path: optionalString(source?.markdown_path),
				relative_path: optionalString(source?.relative_path),
				title: optionalString(source?.title),
			});
		}
		return map;
	}

	async function readFullTextSourceText(reviewer, source = null) {
		if (!source?.markdown_path) {
			return "";
		}
		try {
			return String(await reviewer._readFileText(source.markdown_path) || "").trim();
		}
		catch (_error) {
			return "";
		}
	}

	async function sourceTextForRecord(reviewer, current, record = {}, sourceKey = "title_abstract", extractedValueMap = null, options = {}) {
		let key = normalizeSourceKey(sourceKey);
		if (key == "full_text") {
			let source = options?.fullTextEntry || await preferredFullTextSourceForRecord(reviewer, current, record, options?.fullTextSourceMap || null);
			return readFullTextSourceText(reviewer, source);
		}
		return buildSourceText(record, key, extractedValueMap);
	}

	async function extractionValueRows(reviewer, context) {
		await ensureSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				item_key,
				template_path,
				template_name,
				field_key,
				field_label,
				field_type,
				source_key,
				value_json,
				COALESCE(value_text, '') AS value_text,
				status,
				COALESCE(error_message, '') AS error_message,
				model,
				run_id,
				created_at,
				updated_at
			 FROM extraction_values
			 ORDER BY updated_at DESC, item_key ASC, field_key ASC`
		);
		return (rows || []).map((row) => ({
			item_key: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key")),
			template_path: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_path")),
			template_name: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_name")),
			field_key: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_key")),
			field_label: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_label")),
			field_type: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_type")),
			source_key: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_key")),
			value_json: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_json") || "null"),
			value_text: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text") || ""),
			status: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "status")) || "ok",
			error_message: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "error_message") || ""),
			model: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "model")),
			run_id: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "run_id")),
			created_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at") || ""),
			updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
		}));
	}

	async function extractionValueMap(reviewer, context) {
		let rows = await extractionValueRows(reviewer, context);
		let map = new Map();
		for (let row of rows) {
			let id = `${row.item_key}::${row.field_key}`;
			if (!map.has(id)) {
				map.set(id, row);
			}
		}
		return map;
	}

	function scopeDescriptor(reviewer, current, payload = {}) {
		return SystematicReviewerWorkflowEmbeddings.scopeDescriptor
			? SystematicReviewerWorkflowEmbeddings.scopeDescriptor(reviewer, current, payload)
			: null;
	}

	async function itemRecords(reviewer, current, payload = {}) {
		return SystematicReviewerWorkflowEmbeddings.projectItemRows(reviewer, current, payload);
	}

	async function listSources(reviewer, current, payload = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let records = await itemRecords(reviewer, current, payload);
		let allowedItemKeys = new Set(records.map((record) => optionalString(record.item_key)).filter(Boolean));
		let scopeRequested = !!(
			SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload
			&& SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload(payload)
		);
		let extractedValueLookup = await extractionValueMap(reviewer, context);
		let extracted = await extractionValueRows(reviewer, context);
		let extractedCounts = new Map();
		for (let row of extracted) {
			if ((scopeRequested || allowedItemKeys.size) && !allowedItemKeys.has(optionalString(row.item_key))) {
				continue;
			}
			let key = `extraction:${row.field_key}`;
			let bucket = extractedCounts.get(key) || new Set();
			if (row.value_text) {
				bucket.add(row.item_key);
			}
			extractedCounts.set(key, bucket);
		}
		let builtin = [];
		for (let key of BUILTIN_SOURCE_KEYS) {
			let sourceTexts = normalizeSourceKey(key) == "full_text"
				? await buildFullTextSourceMap(reviewer, current, records)
				: new Map(
					records
						.map((record) => [optionalString(record?.item_key), buildSourceText(record, key, extractedValueLookup)])
						.filter(([itemKey, text]) => itemKey && text)
						.map(([itemKey]) => [itemKey, true])
				);
			builtin.push({
				key,
				label: sourceLabel(key),
				item_count: sourceTexts.size,
				source_type: "builtin",
			});
		}
		let extractedSources = Array.from(extractedCounts.entries())
			.map(([key, items]) => ({
				key,
				label: sourceLabel(key),
				item_count: items.size,
				source_type: "extraction",
			}))
			.sort((left, right) => left.label.localeCompare(right.label));
		return builtin.concat(extractedSources);
	}

	async function listSourceOptions(reviewer, current, payload = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		let extracted = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				field_key,
				MAX(field_label) AS field_label,
				COUNT(DISTINCT item_key) AS item_count,
				MAX(updated_at) AS updated_at
			 FROM extraction_values
			 WHERE COALESCE(value_text, '') <> ''
			 GROUP BY field_key
			 ORDER BY LOWER(COALESCE(MAX(field_label), field_key)) ASC, field_key ASC`
		);
		let builtin = BUILTIN_SOURCE_KEYS.map((key) => ({
			key,
			label: sourceLabel(key),
			source_type: "builtin",
		}));
		let extractedSources = (extracted || []).map((row) => {
			let fieldKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_key"));
			return {
				key: `extraction:${fieldKey}`,
				label: `Extraction: ${optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_label")) || fieldKey}`,
				item_count: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_count") || 0) || 0,
				updated_at: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at")),
				source_type: "extraction",
			};
		});
		return {
			ok: true,
			scope: scopeDescriptor(reviewer, current, payload),
			sources: builtin.concat(extractedSources),
		};
	}

	function extractionMetadataColumnKey(fieldKey = "", metadataKey = "") {
		let normalizedField = optionalString(fieldKey);
		let normalizedMeta = optionalString(metadataKey);
		return normalizedField && normalizedMeta
			? `extraction_meta:${normalizedField}:${normalizedMeta}`
			: "";
	}

	function normalizePlaceholderColumn(entry = {}) {
		let key = optionalString(entry?.key);
		if (!key) {
			return null;
		}
		return {
			key,
			prompt_key: key,
			label: optionalString(entry?.label || key) || key,
			origin: optionalString(entry?.origin || "builtin"),
			search: entry?.search !== false,
			aliases: Array.isArray(entry?.aliases)
				? entry.aliases.map((value) => optionalString(value)).filter(Boolean)
				: [],
		};
	}

	async function sharedRowPlaceholderCatalog(reviewer, current) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await SystematicReviewerWorkflowScreening.ensureSchema(reviewer, context);
		await ensureSchema(reviewer, context);
		let dynamicColumns = await SystematicReviewerWorkflowScreening.listDynamicColumnCatalog(reviewer, context);
		let dynamicEntries = (dynamicColumns || []).map((column) => {
			let key = optionalString(column?.key || column?.column_key);
			let label = optionalString(column?.label || key) || key;
			let origin = optionalString(column?.origin || "");
			if (!key) {
				return null;
			}
			if (origin == "screening") {
				label = `Screening: ${label}`;
			}
			else if (origin == "extraction") {
				label = `Extraction: ${label}`;
			}
			else if (origin == "extraction_metadata") {
				label = `Extraction metadata: ${label}`;
			}
			return normalizePlaceholderColumn({
				key,
				label,
				origin,
				search: true,
			});
		}).filter(Boolean);
		return BUILTIN_ROW_PLACEHOLDER_COLUMNS.map(normalizePlaceholderColumn).filter(Boolean).concat(dynamicEntries);
	}

	async function templateColumnCatalog(reviewer, current) {
		return (await sharedRowPlaceholderCatalog(reviewer, current))
			.concat(EXTRACTION_RUNTIME_PLACEHOLDER_COLUMNS.map(normalizePlaceholderColumn).filter(Boolean));
	}

	async function listColumnOptions(reviewer, current) {
		return {
			ok: true,
			columns: await templateColumnCatalog(reviewer, current),
		};
	}

	async function placeholderValuesForRecord(reviewer, current, record = {}, columns = [], placeholderNames = [], options = {}) {
		let context = current?.context;
		let names = new Set((placeholderNames || []).map((value) => normalizePlaceholderKey(value)).filter(Boolean));
		let itemKey = optionalString(record?.item_key);
		if (!context || !itemKey || !names.size) {
			return {};
		}
		let filteredColumns = (columns || []).filter((entry) => {
			let candidates = [optionalString(entry?.key), ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
				.map((value) => normalizePlaceholderKey(value))
				.filter(Boolean);
			return candidates.some((value) => names.has(value));
		});
		let values = {
			item_key: optionalString(record?.item_key),
			citation_text: optionalString(record?.citation_text),
			citation: optionalString(record?.citation_text),
			author_year: optionalString(record?.citation_text),
			title: optionalString(record?.title),
			year: optionalString(record?.year),
			abstract_note: optionalString(record?.abstract_note),
			abstract: optionalString(record?.abstract_note),
			doi: optionalString(record?.doi),
			openalex_id: optionalString(record?.openalex_id),
			zotero_uri: optionalString(record?.zotero_uri),
			source_key: normalizeSourceKey(options?.sourceKey || ""),
			source_label: sourceLabel(options?.sourceKey || ""),
			source_text: String(options?.sourceText || "").trim(),
		};
		if (!filteredColumns.length) {
			return values;
		}
		let screeningKeys = filteredColumns
			.filter((entry) => optionalString(entry?.origin) == "screening")
			.map((entry) => optionalString(entry?.key).replace(/^screening:/, ""))
			.filter(Boolean);
		let extractionValueKeys = filteredColumns
			.filter((entry) => optionalString(entry?.origin) == "extraction")
			.map((entry) => optionalString(entry?.key).replace(/^extraction:/, ""))
			.filter(Boolean);
		let extractionMetadataSpecs = filteredColumns
			.filter((entry) => optionalString(entry?.origin) == "extraction_metadata")
			.map((entry) => {
				let match = optionalString(entry?.key).match(/^extraction_meta:([^:]+):(.+)$/);
				return match
					? {
						field_key: optionalString(match[1]),
						metadata_key: optionalString(match[2]),
					}
					: null;
			})
			.filter(Boolean);
		let screeningValues = new Map();
		let extractionValues = new Map();
		if (screeningKeys.length) {
			let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`SELECT item_key, column_key, COALESCE(value_text, '') AS value_text
				 FROM screening_column_values
				 WHERE item_key = ?
				   AND column_key IN (${screeningKeys.map(() => "?").join(", ")})`,
				[itemKey].concat(screeningKeys)
			);
			for (let row of rows || []) {
				let columnKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key"));
				if (!columnKey) {
					continue;
				}
				screeningValues.set(`screening:${columnKey}`, String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text") || ""));
			}
		}
		let requestedFieldKeys = Array.from(new Set(
			extractionValueKeys.concat(extractionMetadataSpecs.map((entry) => optionalString(entry?.field_key))).filter(Boolean)
		));
		if (requestedFieldKeys.length) {
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
				 WHERE item_key = ?
				   AND field_key IN (${requestedFieldKeys.map(() => "?").join(", ")})
				 ORDER BY updated_at DESC, item_key ASC, field_key ASC`,
				[itemKey].concat(requestedFieldKeys)
			);
			let seen = new Set();
			for (let row of rows || []) {
				let fieldKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "field_key"));
				if (!fieldKey) {
					continue;
				}
				let dedupeKey = `${fieldKey}`;
				if (seen.has(dedupeKey)) {
					continue;
				}
				seen.add(dedupeKey);
				extractionValues.set(`extraction:${fieldKey}`, {
					value_text: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text") || ""),
					template_name: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_name")),
					template_path: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_path")),
					source_key: normalizeSourceKey(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_key")),
					status: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "status")),
					error_message: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "error_message") || ""),
					model: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "model")),
					run_id: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "run_id")),
					created_at: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at")),
					updated_at: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at")),
				});
			}
		}
		for (let entry of filteredColumns) {
			let value = "";
			let origin = optionalString(entry?.origin);
			let key = optionalString(entry?.key);
			if (origin == "builtin") {
				value = String(values[normalizePlaceholderKey(key)] || "");
			}
			else if (origin == "screening") {
				value = String(screeningValues.get(key) || "");
			}
			else if (origin == "extraction") {
				value = String(extractionValues.get(key)?.value_text || "");
			}
			else if (origin == "extraction_metadata") {
				let match = key.match(/^extraction_meta:([^:]+):(.+)$/);
				let metadataKey = optionalString(match?.[2]);
				value = String(extractionValues.get(`extraction:${optionalString(match?.[1])}`)?.[metadataKey] || "");
			}
			values[normalizePlaceholderKey(key)] = value;
			for (let alias of Array.isArray(entry?.aliases) ? entry.aliases : []) {
				values[normalizePlaceholderKey(alias)] = value;
			}
		}
		if (names.has("full_text")) {
			let fullText = "";
			let fullTextEntry = options?.fullTextEntry || null;
			if (normalizeSourceKey(options?.sourceKey || "") == "full_text" && values.source_text) {
				fullText = values.source_text;
			}
			if (!fullText) {
				if (!fullTextEntry?.markdown_path) {
					fullTextEntry = await preferredFullTextSourceForRecord(
						reviewer,
						current,
						record,
						options?.fullTextSourceMap || null
					);
				}
				fullText = await readFullTextSourceText(reviewer, fullTextEntry);
			}
			values.full_text = fullText;
			values["full-text"] = fullText;
			values.fulltext = fullText;
		}
		return values;
	}

	function renderRequestedFieldPrompt(field = {}, placeholderValues = {}) {
		let lines = [];
		let key = optionalString(field?.key);
		let type = optionalString(field?.type || "string") || "string";
		let guidance = interpolateTemplateText(field?.guidance || "", placeholderValues).trim();
		if (!key) {
			return "";
		}
		lines.push(`Key: ${key}`);
		lines.push(`Type: ${type}`);
		lines.push(`Allow null: ${field?.allow_null ? "yes" : "no"}`);
		if (Array.isArray(field?.choices) && field.choices.length) {
			lines.push(`Choices: ${field.choices.join(", ")}`);
		}
		if (field?.choice_guidance && typeof field.choice_guidance == "object" && Object.keys(field.choice_guidance).length) {
			lines.push("Choice guidance:");
			for (let [choice, note] of Object.entries(field.choice_guidance)) {
				let cleanChoice = optionalString(choice);
				let cleanNote = interpolateTemplateText(note || "", placeholderValues).trim();
				if (!cleanChoice || !cleanNote) {
					continue;
				}
				lines.push(`- ${cleanChoice}: ${cleanNote}`);
			}
		}
		lines.push("Guidance:");
		lines.push(guidance || "(no guidance)");
		return lines.join("\n").trim();
	}

	function buildExtractionRequest(template, selectedFields, sourceText, record, sourceKey, placeholderValues = {}, placeholderNames = []) {
		let runtimeValues = Object.assign({}, placeholderValues, {
			source_key: normalizeSourceKey(sourceKey),
			source_label: sourceLabel(sourceKey),
			source_text: String(sourceText || ""),
		});
		let instructions = interpolateTemplateText(template?.system_prompt || "", runtimeValues).trim();
		let fieldLines = (selectedFields || [])
			.map((field) => renderRequestedFieldPrompt(field, runtimeValues))
			.filter(Boolean)
			.join("\n\n");
		let formatInstructions = interpolateTemplateText(template?.format_instructions || "", runtimeValues).trim();
		let names = new Set((placeholderNames || []).map((value) => normalizePlaceholderKey(value)).filter(Boolean));
		let sourceAlreadyInTemplate = names.has("source_text")
			|| (normalizeSourceKey(sourceKey) == "full_text" && names.has("full_text"));
		let inputParts = [fieldLines, formatInstructions];
		if (!sourceAlreadyInTemplate && sourceText) {
			inputParts.push(String(sourceText || ""));
		}
		let inputText = inputParts.filter(Boolean).join("\n\n").trim();
		if (!instructions && !inputText) {
			throw new Error("This extraction template is empty.");
		}
		let messages = [];
		if (instructions) {
			messages.push({
				role: "system",
				content: instructions,
			});
		}
		if (inputText) {
			messages.push({
				role: "user",
				content: inputText,
			});
		}
		return {
			instructions,
			inputText,
			messages,
		};
	}

	function normalizeSelectedFields(template, payload = {}) {
		let templateFields = Array.isArray(template?.fields) ? template.fields : [];
		let selected = Array.isArray(payload.selected_fields || payload.selectedFields)
			? payload.selected_fields || payload.selectedFields
			: [];
		let set = new Set(selected.map((entry) => optionalString(entry)).filter(Boolean));
		if (!set.size) {
			return templateFields.slice();
		}
		return templateFields.filter((field) => set.has(field.key));
	}

	async function writeExtractionValues(reviewer, context, values = []) {
		await ensureSchema(reviewer, context);
		for (let entry of values) {
			await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`INSERT OR REPLACE INTO extraction_values (
					item_key,
					template_path,
					template_name,
					field_key,
					field_label,
					field_type,
					source_key,
					value_json,
					value_text,
					status,
					error_message,
					model,
					run_id,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					entry.item_key,
					entry.template_path,
					entry.template_name,
					entry.field_key,
					entry.field_label,
					entry.field_type,
					entry.source_key,
					entry.value_json,
					entry.value_text,
					entry.status,
					entry.error_message,
					entry.model,
					entry.run_id,
					entry.created_at,
					entry.updated_at,
				]
			);
		}
	}

	function recordsMissingAnyField(records, selectedFields, templatePath, extractionMap) {
		let requiredKeys = selectedFields.map((field) => field.key);
		return records.filter((record) =>
			requiredKeys.some((fieldKey) => !extractionMap.has(`${record.item_key}::${fieldKey}`) || extractionMap.get(`${record.item_key}::${fieldKey}`)?.template_path != templatePath)
		);
	}

	function filterRecordsByItemKey(records, itemKey) {
		let wanted = optionalString(itemKey);
		if (!wanted) {
			return records;
		}
		return records.filter((record) => record.item_key == wanted);
	}

	async function listResults({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		let limit = normalizeLimit(payload.limit, DEFAULT_RESULTS_LIMIT, 200);
		let template = payload.template_path
			? await SystematicReviewerWorkflowExtractionTemplates.loadTemplate(reviewer, context, { path: payload.template_path })
			: null;
		let templatePath = optionalString(template?.path || payload.template_path);
		let values = await extractionValueRows(reviewer, context);
		let records = await itemRecords(reviewer, current, payload);
		let allowedKeys = new Set(records.map((entry) => entry.item_key));
		let scopeRequested = !!(
			SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload
			&& SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload(payload)
		);
		let byItem = new Map();
		for (let row of values) {
			if ((scopeRequested || allowedKeys.size) && !allowedKeys.has(row.item_key)) {
				continue;
			}
			if (templatePath && row.template_path != templatePath) {
				continue;
			}
			let bucket = byItem.get(row.item_key);
			if (!bucket) {
				let source = records.find((entry) => entry.item_key == row.item_key) || { item_key: row.item_key };
				bucket = {
					item_key: row.item_key,
					title: source.title || "",
					year: source.year || "",
					doi: source.doi || "",
					values: [],
					updated_at: row.updated_at,
				};
				byItem.set(row.item_key, bucket);
			}
			bucket.values.push({
				field_key: row.field_key,
				field_label: row.field_label,
				field_type: row.field_type,
				value_text: row.value_text,
				status: row.status,
				error_message: row.error_message,
				updated_at: row.updated_at,
			});
			if (row.updated_at > bucket.updated_at) {
				bucket.updated_at = row.updated_at;
			}
		}
		let items = Array.from(byItem.values())
			.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
			.slice(0, limit);
		let runQuery = `SELECT
				run_id,
				job_id,
				template_path,
				template_name,
				source_key,
				model,
				item_total,
				item_succeeded,
				item_failed,
				created_at,
				updated_at
			 FROM extraction_runs`;
		let runParams = [];
		if (templatePath) {
			runQuery += ` WHERE template_path = ?`;
			runParams.push(templatePath);
		}
		runQuery += ` ORDER BY created_at DESC LIMIT ?`;
		runParams.push(limit);
		let runRows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			runQuery,
			runParams
		);
		let runs = (runRows || []).map((row) => ({
			run_id: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "run_id")),
			job_id: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "job_id")),
			template_path: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_path")),
			template_name: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "template_name")),
			source_key: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "source_key")),
			model: optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "model")),
			item_total: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_total") || 0) || 0,
			item_succeeded: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_succeeded") || 0) || 0,
			item_failed: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_failed") || 0) || 0,
			created_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "created_at") || ""),
			updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
		}));
		return {
			ok: true,
			items,
			runs,
			total_items: byItem.size,
			scope: scopeDescriptor(reviewer, current, payload),
			available_scopes: SystematicReviewerWorkflowEmbeddings.availableScopes
				&& payload?.include_available_scopes !== false
				? SystematicReviewerWorkflowEmbeddings.availableScopes(reviewer, current, {
					purpose: "extraction",
				})
				: [],
		};
	}

	async function updateFields({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		let template = await SystematicReviewerWorkflowExtractionTemplates.loadTemplate(reviewer, context, {
			path: payload.template_path || payload.path || "",
			name: payload.template_name || payload.name || "",
		});
		if (!template?.path) {
			throw new Error("This project has no extraction templates.");
		}
		let fieldEntries = [];
		if (payload.values && typeof payload.values == "object" && !Array.isArray(payload.values)) {
			fieldEntries = Object.entries(payload.values).map(([fieldKey, value]) => ({
				field_key: fieldKey,
				value,
			}));
		}
		else if (Array.isArray(payload.fields)) {
			fieldEntries = payload.fields.map((entry) => ({
				field_key: optionalString(entry.field_key || entry.key),
				value: entry.value,
			}));
		}
		if (!fieldEntries.length) {
			throw new Error("Provide one or more extraction field values.");
		}
		let fieldMap = new Map((Array.isArray(template.fields) ? template.fields : []).map((field) => [field.key, field]));
		let existingRows = (await extractionValueRows(reviewer, context))
			.filter((row) => row.item_key == itemKey && row.template_path == template.path);
		let existingByField = new Map(existingRows.map((row) => [row.field_key, row]));
		let sourceKey = normalizeSourceKey(payload.source_key || payload.sourceKey || existingRows[0]?.source_key || "title_abstract");
		let updatedAt = new Date().toISOString();
		let runID = optionalString(payload.run_id || payload.runID) || `extract-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		let values = [];
		for (let entry of fieldEntries) {
			let fieldKey = optionalString(entry.field_key);
			if (!fieldKey) {
				continue;
			}
			let field = fieldMap.get(fieldKey) || null;
			let existing = existingByField.get(fieldKey) || null;
			if (!field && !existing) {
				throw new Error(`Unknown extraction field: ${fieldKey}`);
			}
			let normalizedValue = normalizeFieldValue(
				field || { type: existing?.field_type || "string", choices: existing?.choices || [] },
				entry.value
			);
			values.push({
				item_key: itemKey,
				template_path: template.path,
				template_name: template.name,
				field_key: fieldKey,
				field_label: field?.label || existing?.field_label || fieldKey,
				field_type: field?.type || existing?.field_type || "string",
				source_key: sourceKey,
				value_json: JSON.stringify(normalizedValue),
				value_text: valueText(normalizedValue),
				status: "ok",
				error_message: "",
				model: optionalString(payload.model || existing?.model || "manual"),
				run_id: runID,
				created_at: existing?.created_at || updatedAt,
				updated_at: updatedAt,
			});
		}
		if (!values.length) {
			throw new Error("No valid extraction field values were provided.");
		}
		await writeExtractionValues(reviewer, context, values);
		let result = await listResults({
			reviewer,
			current,
			payload: {
				template_path: template.path,
				limit: 500,
			},
		});
		let item = (result.items || []).find((entry) => entry.item_key == itemKey) || null;
		return {
			ok: true,
			item_key: itemKey,
			template_path: template.path,
			template_name: template.name,
			updated_fields: values.map((entry) => ({
				field_key: entry.field_key,
				field_label: entry.field_label,
				field_type: entry.field_type,
				value_text: entry.value_text,
			})),
			item,
		};
	}

	function markdownHeadingBlock(title = "", lines = []) {
		return [
			`#### ${String(title || "Entry").trim()}`,
			"",
			...(Array.isArray(lines) ? lines : []).map((line) => String(line || "")),
		].join("\n").trim();
	}

	function compactFieldGuidance(value = "", limit = 180) {
		let text = String(value || "").replace(/\s+/g, " ").trim();
		if (!text) {
			return "";
		}
		if (text.length <= limit) {
			return text;
		}
		return `${text.slice(0, Math.max(1, limit - 1)).trim()}...`;
	}

	function selectedFieldDetails(fields = []) {
		return (Array.isArray(fields) ? fields : [])
			.map((field) => {
				let key = optionalString(field?.key);
				if (!key) {
					return null;
				}
				return {
					key,
					label: optionalString(field?.label || key),
					type: optionalString(field?.type || "string"),
					guidance: compactFieldGuidance(field?.guidance || field?.description || ""),
				};
			})
			.filter(Boolean);
	}

	function extractionFieldIntentLines(details = []) {
		let lines = [];
		for (let detail of (Array.isArray(details) ? details : [])) {
			let guidance = optionalString(detail?.guidance);
			let label = optionalString(detail?.label || detail?.key);
			let type = optionalString(detail?.type || "string");
			if (guidance) {
				lines.push(`- Field intent: ${label} (${optionalString(detail?.key)}, ${type}) - ${guidance}`);
			}
			else {
				lines.push(`- Field intent: ${label} (${optionalString(detail?.key)}, ${type})`);
			}
		}
		return lines;
	}

	async function recordExtractionRunArtifact(reviewer, current, result = {}) {
		if (!current?.context || !SystematicReviewerWorkflowArtifacts?.writeArtifact) {
			return null;
		}
		let fieldDetails = Array.isArray(result?.selected_field_details)
			? result.selected_field_details
			: [];
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
			category: "extraction",
			kind: "extraction-run",
			extension: "md",
			content: markdownHeadingBlock(
				`${new Date().toISOString()} Extraction Run`,
				[
					`- Template: ${String(result?.template_name || result?.template_path || "template").trim()}`,
					`- Scope: ${String(result?.scope?.label || result?.scope?.collection_name || result?.scope?.collection_key || "").trim() || "(project scope)"}`,
					`- Source: ${String(result?.source_label || result?.source_key || "").trim() || "(unknown source)"}`,
					`- Runtime role: ${String(result?.runtime_role_label || result?.runtime_role_id || "").trim() || "(not recorded)"}`,
					`- Model: ${String(result?.model || "").trim() || "(not recorded)"}`,
					String(result?.model_preset_label || result?.model_preset_id || "").trim() ? `- Model preset: ${String(result?.model_preset_label || result?.model_preset_id || "").trim()}` : "",
					`- Row scope: ${String(result?.row_scope || "").trim() || "(not recorded)"}`,
					`- Selected fields: ${(Array.isArray(result?.selected_fields) ? result.selected_fields : []).join(", ") || "(all template fields)"}`,
					...extractionFieldIntentLines(fieldDetails),
					`- Total items: ${Number(result?.item_total || 0) || 0}`,
					`- Succeeded: ${Number(result?.item_succeeded || 0) || 0}`,
					`- Failed: ${Number(result?.item_failed || 0) || 0}`,
				].filter(Boolean)
			),
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "extraction",
			headingPath: ["Methods", "Extraction Strategy"],
			marker: "extraction-strategy",
			emptyLabel: "No extraction activity has been logged yet.",
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "extraction",
			headingPath: ["Results", "Data Extraction"],
			marker: "data-extraction-results",
			emptyLabel: "No extraction results have been logged yet.",
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "extraction",
			headingPath: ["Appendices", "Extraction Runs"],
			marker: "extraction-runs",
			emptyLabel: "No extraction runs have been logged yet.",
		});
		return artifact;
	}

	async function queueExtraction({ reviewer, current, payload = {}, single = false, options = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		let template = await SystematicReviewerWorkflowExtractionTemplates.loadTemplate(reviewer, context, {
			path: payload.template_path || payload.path || "",
			name: payload.template_name || payload.name || "",
		});
		if (!template?.path) {
			throw new Error("This project has no extraction templates.");
		}
		let selectedFields = normalizeSelectedFields(template, payload);
		if (!selectedFields.length) {
			throw new Error("Choose at least one extraction field.");
		}
		let fieldDetails = selectedFieldDetails(selectedFields);
		let sourceKey = normalizeSourceKey(payload.source_key || payload.text_source || "title_abstract");
		let runtime = await resolveExtractionRuntime(reviewer, payload);
		try {
			let extractionScope = scopeDescriptor(reviewer, current, payload);
			let queuePayload = Object.assign({}, payload || {}, {
				template_path: template.path,
				template_name: template.name,
				source_key: sourceKey,
				row_scope: single ? "single_item" : (payload.row_scope || payload.rowScope || ""),
				include_available_scopes: false,
			});
			if (extractionScope?.scope) {
				queuePayload.scope = extractionScope.scope;
			}
			if (extractionScope?.collection_key) {
				queuePayload.collection_key = extractionScope.collection_key;
			}
			if (extractionScope?.collection_name) {
				queuePayload.collection_name = extractionScope.collection_name;
			}
			let jobKind = single ? "manual_extraction_single" : "manual_extraction";
			let job = await reviewer._queueWorkflowJob(current, {
				prefix: single ? "extract-one" : "extract",
				kind: jobKind,
				title: `${single ? "Extract record" : "Extraction"}: ${template.name}`,
				requested_mode: sourceKey,
				used_mode: String(runtime?.client?.model || ""),
				source_title: `${context.collectionName} / ${sourceLabel(sourceKey)}`,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: queuePayload,
					template_path: template.path,
					template_name: template.name,
					source_key: sourceKey,
					selected_fields: selectedFields.map((field) => field.key),
					scope: extractionScope,
					model: String(runtime?.client?.model || ""),
					model_preset_id: String(runtime?.preset_id || "default").trim() || "default",
					model_preset_label: String(runtime?.preset_label || "").trim(),
					single: !!single,
					queue_origin: String(options.queue_origin || "").trim(),
				},
				targetWin: options.targetWin || null,
				openJobsTab: options.openJobsTab === true,
				refreshControllers: options.refreshControllers !== false,
			});
			return {
				ok: true,
				queued: true,
				job_id: job.job_id,
				job_kind: jobKind,
				message: "Job started. Track progress in Jobs.",
				template_path: template.path,
				template_name: template.name,
				source_key: sourceKey,
				source_label: sourceLabel(sourceKey),
				runtime_role_id: String(runtime?.roleID || "").trim(),
				runtime_role_label: String(runtime?.label || "").trim(),
				model: String(runtime?.client?.model || ""),
				model_preset_id: String(runtime?.preset_id || "default").trim() || "default",
				model_preset_label: String(runtime?.preset_label || "").trim(),
				scope: extractionScope,
				row_scope: single ? "single_item" : (payload.row_scope || payload.rowScope || ""),
				selected_fields: selectedFields.map((field) => field.key),
				selected_field_details: fieldDetails,
				single: !!single,
			};
		}
		finally {
			await runtime.release?.();
		}
	}

	async function runExtraction({ reviewer, current, payload = {}, single = false }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		let template = await SystematicReviewerWorkflowExtractionTemplates.loadTemplate(reviewer, context, {
			path: payload.template_path || payload.path || "",
			name: payload.template_name || payload.name || "",
		});
		if (!template?.path) {
			throw new Error("This project has no extraction templates.");
		}
		let selectedFields = normalizeSelectedFields(template, payload);
		if (!selectedFields.length) {
			throw new Error("Choose at least one extraction field.");
		}
		let fieldDetails = selectedFieldDetails(selectedFields);
		let sourceKey = normalizeSourceKey(payload.source_key || payload.text_source || "title_abstract");
		let runtime = await resolveExtractionRuntime(reviewer, payload);
		let existingJobID = optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
		if (!existingJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: single ? "extract-one" : "extract",
				kind: single ? "manual_extraction_single" : "manual_extraction",
				title: `${single ? "Extract record" : "Extraction"}: ${template.name}`,
				requested_mode: sourceKey,
				used_mode: sourceKey,
				source_title: `${context.collectionName} / ${sourceLabel(sourceKey)}`,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}, {
						template_path: template.path,
						template_name: template.name,
						source_key: sourceKey,
					}),
					template_path: template.path,
					template_name: template.name,
					source_key: sourceKey,
					selected_fields: selectedFields.map((field) => field.key),
					scope: scopeDescriptor(reviewer, current, payload),
					single: !!single,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Extraction job started. Track progress in Jobs.",
			});
		}
		let job = { job_id: existingJobID };
		try {
			let config = runtime.config;
			let client = runtime.client;
			let extractionScope = scopeDescriptor(reviewer, current, payload);
			let allRecords = await itemRecords(reviewer, current, payload);
			let extractionMap = await extractionValueMap(reviewer, context);
			let rowScope = optionalString(payload.row_scope || payload.rowScope).toLowerCase() || (single ? "single_item" : "missing_fields");
			let targetRecords = allRecords.slice();
			if (rowScope == "single_item" || single) {
				targetRecords = filterRecordsByItemKey(targetRecords, payload.item_key || payload.itemKey);
				if (!targetRecords.length) {
					throw new Error("item_key did not match a record in this collection.");
				}
			}
			else if (rowScope == "missing_fields") {
				targetRecords = recordsMissingAnyField(targetRecords, selectedFields, template.path, extractionMap);
			}
			if (payload.limit !== undefined && payload.limit !== null && payload.limit !== "") {
				targetRecords = targetRecords.slice(0, normalizeLimit(payload.limit, DEFAULT_LIMIT, 500));
			}
			let fullTextSourceMap = normalizeSourceKey(sourceKey) == "full_text"
				? await buildFullTextSourceMap(reviewer, current, targetRecords)
				: null;
			let withText = targetRecords.filter((record) => {
				if (normalizeSourceKey(sourceKey) == "full_text") {
					return fullTextSourceMap?.has(optionalString(record?.item_key));
				}
				return !!buildSourceText(record, sourceKey, extractionMap);
			});
			if (!withText.length) {
				throw new Error(`No records have usable text for ${sourceLabel(sourceKey)}.`);
			}

			let now = new Date().toISOString();
			let runID = `extract-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`INSERT INTO extraction_runs (
					run_id,
					job_id,
					template_path,
					template_name,
					source_key,
					model,
					item_total,
					item_succeeded,
					item_failed,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
				[
					runID,
					job.job_id,
					template.path,
					template.name,
					sourceKey,
					String(client.model || ""),
					withText.length,
					now,
					now,
				]
			);

			let successes = [];
			let failures = [];
			let completedCount = 0;
			let placeholderCatalog = [];
			let placeholderNames = templatePlaceholderNames(template, selectedFields);
			if (placeholderNames.length) {
				placeholderCatalog = await sharedRowPlaceholderCatalog(reviewer, current);
			}
			await runWithConcurrency(withText, Number(client?.parallelRequests || 1) || 1, async (record, index) => {
				let rowScopeKey = optionalString(payload.row_scope || payload.rowScope).toLowerCase() || (single ? "single_item" : "missing_fields");
				let resolvedValues = existingResolvedFieldValues(record, selectedFields, template.path, extractionMap, rowScopeKey);
				let remainingFields = pendingFieldsForRecord(record, selectedFields, template.path, extractionMap, rowScopeKey);
				if (!remainingFields.length) {
					completedCount += 1;
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						completedCount,
						withText.length,
						`Processed ${completedCount}/${withText.length} extraction rows.`
					);
					return;
				}
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					job.job_id,
					index,
					withText.length,
					`Extracting ${index + 1}/${withText.length}: ${record.title || record.item_key}`
				);
				try {
					let fullTextEntry = normalizeSourceKey(sourceKey) == "full_text"
						? (fullTextSourceMap?.get(optionalString(record?.item_key)) || null)
						: null;
					let sourceText = String(await sourceTextForRecord(reviewer, current, record, sourceKey, extractionMap, {
						fullTextEntry,
						fullTextSourceMap,
					}) || "").trim();
					if (!sourceText) {
						throw new Error(`No usable text for ${sourceLabel(sourceKey)}.`);
					}
					let placeholderValues = placeholderNames.length
						? await placeholderValuesForRecord(reviewer, current, record, placeholderCatalog, placeholderNames, {
							sourceKey,
							sourceText,
							fullTextEntry,
							fullTextSourceMap,
						})
						: {};
					let lastError = "";
					for (let attempt = 1; attempt <= DEFAULT_ROW_ATTEMPTS && remainingFields.length; attempt += 1) {
						await reviewer._throwIfJobCanceled?.(current, job.job_id);
						let completion = null;
						let attemptDiagnostic = "";
						try {
							let request = buildExtractionRequest(template, remainingFields, sourceText, record, sourceKey, placeholderValues, placeholderNames);
							completion = await requestExtractionCompletion(
								client,
								request,
								config.runtime,
								runtime,
								null
							);
							attemptDiagnostic = extractionAttemptDiagnostic(runtime, client, completion);
							if (!completion?.eosReached || completion?.truncated) {
								throw new Error(
									`The model response was incomplete (eos_reached=${completion?.eosReached === true ? "true" : "false"}, truncated=${completion?.truncated === true ? "true" : "false"}). ${attemptDiagnostic}`
								);
							}
							let parsed = extractJSONObjectPayload(completion?.text || "");
							let accepted = [];
							let unresolved = [];
							for (let field of remainingFields) {
								let resolved = fieldValueFromParsedObject(field, parsed);
								if (resolved.present && resolved.valid) {
									accepted.push({
										field,
										value: resolved.value,
									});
								}
								else {
									unresolved.push(field);
								}
							}
							if (!accepted.length) {
								throw new Error("The completed JSON response did not contain any valid values for the requested fields.");
							}
							let updatedAt = new Date().toISOString();
							let values = accepted.map((entry) => ({
								item_key: record.item_key,
								template_path: template.path,
								template_name: template.name,
								field_key: entry.field.key,
								field_label: entry.field.label || entry.field.key,
								field_type: entry.field.type || "string",
								source_key: sourceKey,
								value_json: JSON.stringify(entry.value),
								value_text: valueText(entry.value),
								status: "ok",
								error_message: "",
								model: String(client.model || ""),
								model_preset_id: String(runtime.preset_id || "default").trim() || "default",
								run_id: runID,
								created_at: updatedAt,
								updated_at: updatedAt,
							}));
							await writeExtractionValues(reviewer, context, values);
							for (let entry of values) {
								extractionMap.set(`${entry.item_key}::${entry.field_key}`, entry);
								resolvedValues.set(entry.field_key, JSON.parse(entry.value_json));
							}
							remainingFields = unresolved;
							if (remainingFields.length) {
								lastError = `Missing fields after attempt ${attempt}/${DEFAULT_ROW_ATTEMPTS}: ${remainingFields.map((field) => field.key).join(", ")}.`;
								await SystematicReviewerWorkflowJobs.log(
									reviewer,
									current,
									job.job_id,
									"warn",
									`Partial extraction for ${record.item_key}; retrying missing fields: ${remainingFields.map((field) => field.key).join(", ")}.`
								);
							}
						}
						catch (error) {
							lastError = error?.message || String(error);
							if (attemptDiagnostic && !lastError.includes("runtime_role_id=")) {
								lastError = `${lastError} ${attemptDiagnostic}`.trim();
							}
							if (attempt < DEFAULT_ROW_ATTEMPTS) {
								await SystematicReviewerWorkflowJobs.log(
									reviewer,
									current,
									job.job_id,
									"warn",
									`Extraction retry ${attempt}/${DEFAULT_ROW_ATTEMPTS} for ${record.item_key}: ${lastError}`
								);
							}
						}
					}
					if (remainingFields.length) {
						failures.push({
							item_key: record.item_key,
							title: record.title || "",
							error: lastError || `Missing fields: ${remainingFields.map((field) => field.key).join(", ")}`,
							missing_fields: remainingFields.map((field) => field.key),
							resolved_fields: Array.from(resolvedValues.keys()),
						});
						await SystematicReviewerWorkflowJobs.log(
							reviewer,
							current,
							job.job_id,
							"error",
							`Extraction finished with unresolved fields for ${record.item_key}: ${remainingFields.map((field) => field.key).join(", ")}. ${lastError || ""}`.trim()
						);
					}
					else {
						successes.push({
							item_key: record.item_key,
							title: record.title || "",
							values: Object.fromEntries(selectedFields.map((field) => [field.key, resolvedValues.get(field.key) ?? null])),
						});
						await SystematicReviewerWorkflowJobs.log(
							reviewer,
							current,
							job.job_id,
							"info",
							`Extracted ${selectedFields.length} fields for ${record.item_key}.`
						);
					}
				}
				catch (error) {
					let errorMessage = error?.message || String(error);
					failures.push({
						item_key: record.item_key,
						title: record.title || "",
						error: errorMessage,
					});
					await SystematicReviewerWorkflowJobs.log(
						reviewer,
						current,
						job.job_id,
						"error",
						`Extraction failed for ${record.item_key}: ${errorMessage}`.trim()
					);
				}
				completedCount += 1;
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					job.job_id,
					completedCount,
					withText.length,
					`Processed ${completedCount}/${withText.length} extraction rows.`
				);
			});

			let finishedAt = new Date().toISOString();
			await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`UPDATE extraction_runs
				 SET item_succeeded=?,
				     item_failed=?,
				     updated_at=?
				 WHERE run_id=?`,
				[
					successes.length,
					failures.length,
					finishedAt,
					runID,
				]
			);
			await SystematicReviewerWorkflowJobs.progress(
				reviewer,
				current,
				job.job_id,
				withText.length,
				withText.length,
				`Finished extraction for ${withText.length} records.`
			);
			let result = {
				ok: true,
				run_id: runID,
				job_id: job.job_id,
				template_path: template.path,
				template_name: template.name,
				source_key: sourceKey,
				source_label: sourceLabel(sourceKey),
				runtime_role_id: String(runtime.roleID || "").trim(),
				runtime_role_label: String(runtime.label || "").trim(),
				runtime_type: String(client.runtimeType || client.runtime_type || "").trim(),
				model: String(client.model || ""),
				model_preset_id: String(runtime.preset_id || "default").trim() || "default",
				model_preset_label: String(runtime.preset_label || "").trim(),
				scope: extractionScope,
				row_scope: rowScope,
				selected_fields: selectedFields.map((field) => field.key),
				selected_field_details: fieldDetails,
				item_total: withText.length,
				item_succeeded: successes.length,
				item_failed: failures.length,
				successes,
				failures,
			};
			let completionSummary = {
				used_mode: String(client.model || ""),
				output_path: context.databasePath,
				progress_current: withText.length,
				progress_total: withText.length,
				message: `Extraction finished. ${successes.length} succeeded, ${failures.length} failed.`,
				metadata: Object.assign({}, result, {
					selected_fields: selectedFields.map((field) => field.key),
				}),
			};
			if (failures.length && successes.length) {
				await SystematicReviewerWorkflowJobs.partial(reviewer, current, job.job_id, completionSummary);
			}
			else if (failures.length) {
				await SystematicReviewerWorkflowJobs.fail(
					reviewer,
					current,
					job.job_id,
					new Error(`Extraction finished. ${successes.length} succeeded, ${failures.length} failed.`),
					{
						progress_current: withText.length,
						progress_total: withText.length,
						metadata: Object.assign({}, result, {
							selected_fields: selectedFields.map((field) => field.key),
						}),
					}
				);
			}
			else {
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, completionSummary);
			}
			if (existingJobID) {
				await recordExtractionRunArtifact(reviewer, current, result).catch((error) => {
					reviewer?.log?.(`extraction artifact write skipped: ${error}`);
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
		finally {
			await runtime.release?.();
		}
	}

	return {
		ensureSchema,
		listSources,
		sharedRowPlaceholderCatalog,
		listColumnOptions,
		listSourceOptions,
		listRuntimeOptions,
		listRuntimeSelectorOptions,
		listResults,
		updateFields,
		queueExtraction,
		runExtraction,
	};
})();
