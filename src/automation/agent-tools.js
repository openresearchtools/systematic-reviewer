var SystematicReviewerTextFileToolsSource =
	typeof SystematicReviewerTextFileTools != "undefined"
		? SystematicReviewerTextFileTools
		: ((typeof module != "undefined" && module.exports) ? require("../core/text-file-tools.js") : null);

var SystematicReviewerAgentTools = (() => {
	const ENDPOINT_PREFIX = "/systematic-reviewer/agent";
	const SQLITE_FILENAME = "systematicreviewer.sqlite.db";
	const TEXT_FILE_TOOLS = SystematicReviewerTextFileToolsSource || {};
	// Some file-tool ideas here are adapted from opencode-style tool shapes,
	// but the shipped runtime surface is Zotero-native and intentionally concise.
	const TEXT_EXTENSIONS = new Set([
		".md",
		".markdown",
		".txt",
		".yaml",
		".yml",
		".json",
		".csv",
		".tsv",
	]);
	const EXTERNAL_RESULT_MAX_JSON_CHARS = 180000;
	const EXTERNAL_RESULT_BACKSTOP_MAX_DEPTH = 7;
	const EXTERNAL_RESULT_BACKSTOP_MAX_ARRAY_ITEMS = 80;
	const EXTERNAL_RESULT_BACKSTOP_MAX_OBJECT_KEYS = 120;
	const EXTERNAL_RESULT_BACKSTOP_MAX_STRING_LENGTH = 12000;
	const HEAVY_SCREENING_TOOL_IDS = new Set([
		"sr.screeningList",
		"sr.screeningSearch",
		"sr.screeningRunsCompare",
		"sr.screeningSaveEdits",
	]);
	const SURFACE_EXTERNAL = "external";
	const SURFACE_SESSION = "session";
	const SURFACE_MCP = "mcp";
	const SURFACE_DEV = "dev";
	const MCP_BROKER_TOOL_IDS = new Set([
		"sr.mcpListServers",
		"sr.mcpInspectServer",
		"sr.mcpRefreshServer",
		"sr.mcpDisconnectServer",
		"sr.mcpSearchTools",
		"sr.mcpCallTool",
		"sr.mcpListResources",
		"sr.mcpReadResource",
		"sr.mcpListPrompts",
		"sr.mcpGetPrompt",
	]);

	let reviewer = null;
	let registered = false;
	let httpRoutesRegistered = false;
	let baseToolRegistry = new Map();
	let sessionToolRegistry = new Map();
	let responsesCatalogs = {};

	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function embeddingsNamespacesVisible() {
		return !!reviewer?._hasConfiguredEmbeddingsModelSync?.();
	}

	function documentsFindDescription() {
		if (!embeddingsNamespacesVisible()) {
			return "Find relevant project full-text documents and chunks using native keyword retrieval. Returns concise markdown plus openable chunk metadata; does not write Screening columns. Keyword search works without embeddings.";
		}
		return "Find relevant project full-text documents and chunks using keyword or semantic retrieval. Returns concise markdown plus openable chunk metadata; does not write Screening columns. Semantic mode requires stored full-text embeddings for the current embeddings model; otherwise use keyword or run full-text embeddings first.";
	}

	function documentsFindModeShape() {
		if (!embeddingsNamespacesVisible()) {
			return "optional retrieval mode; use keyword. Keyword works without embeddings.";
		}
		return "optional retrieval mode: keyword | semantic. Use semantic only after full-text embeddings exist for the current embeddings model.";
	}

	function isEmbeddingsSemanticToolID(toolID = "") {
		let id = String(toolID || "").trim();
		return /^sr\.(embeddings|semantic)/i.test(id);
	}

	function isVisibleTool(tool = {}) {
		let id = String(tool?.id || "").trim();
		if (!id) {
			return false;
		}
		if (isEmbeddingsSemanticToolID(id) && !embeddingsNamespacesVisible()) {
			return false;
		}
		return true;
	}

	function isMCPBrokerToolID(toolID = "") {
		return MCP_BROKER_TOOL_IDS.has(String(toolID || "").trim());
	}

	function isVisibleToolForSurface(tool = {}, surface = SURFACE_EXTERNAL) {
		let id = String(tool?.id || "").trim();
		if (!isVisibleTool(tool)) {
			return false;
		}
		if (isMCPBrokerToolID(id)) {
			let normalized = normalizeToolSurface(surface);
			return normalized == SURFACE_SESSION || normalized == SURFACE_DEV;
		}
		return true;
	}

	function normalizeToolSurface(value = "") {
		let normalized = String(value || "").trim().toLowerCase();
		if (normalized == SURFACE_SESSION) {
			return SURFACE_SESSION;
		}
		if (normalized == SURFACE_DEV) {
			return SURFACE_DEV;
		}
		if (normalized == SURFACE_MCP) {
			return SURFACE_MCP;
		}
		return SURFACE_EXTERNAL;
	}

	function privilegedToolsModule() {
		if (typeof SystematicReviewerPrivilegedTools == "undefined") {
			return null;
		}
		return SystematicReviewerPrivilegedTools || null;
	}

	function sessionPrivilegedTools() {
		let module = privilegedToolsModule();
		if (!module?.getSessionTools || !reviewer) {
			return [];
		}
		try {
			let tools = module.getSessionTools(reviewer);
			return Array.isArray(tools) ? tools.filter(Boolean) : [];
		}
		catch (error) {
			reviewer?.log?.(`privileged session tools unavailable: ${error?.message || error}`);
			return [];
		}
	}

	function buildSessionToolRegistry() {
		let registry = new Map(baseToolRegistry);
		for (let tool of sessionPrivilegedTools()) {
			registry.set(tool.id, tool);
		}
		return registry;
	}

	function toolRegistryForSurface(surface = SURFACE_EXTERNAL) {
		let normalized = normalizeToolSurface(surface);
		return normalized == SURFACE_SESSION || normalized == SURFACE_DEV
			? sessionToolRegistry
			: baseToolRegistry;
	}

	function currentResponsesCatalog(options = {}) {
		let surface = normalizeToolSurface(options?.surface || options);
		responsesCatalogs[surface] = buildResponsesCatalog(surface);
		return responsesCatalogs[surface];
	}

	function rebuildResponsesCatalogs(options = {}) {
		sessionToolRegistry = buildSessionToolRegistry();
		responsesCatalogs = {};
		return currentResponsesCatalog(options?.surface || SURFACE_EXTERNAL);
	}

	function register(nextReviewer) {
		if (!nextReviewer) {
			return;
		}
		if (registered && reviewer === nextReviewer) {
			return;
		}
		unregister();
		reviewer = nextReviewer;
		baseToolRegistry = buildToolRegistry();
		sessionToolRegistry = buildSessionToolRegistry();
		responsesCatalogs = {};
		nextReviewer.agentTools = {
			list: (options = {}) => listTools(options),
			call: (toolID, args = {}, options = {}) => callTool(toolID, args, options),
			responsesCatalog: (options = {}) => currentResponsesCatalog(options),
			rebuild: (options = {}) => rebuildResponsesCatalogs(options),
		};
		registerHTTPEndpoints();
		let port = SystematicReviewerWorkflowServer?.getPort?.() || null;
		nextReviewer.log(`agent tools ready${port ? ` on 127.0.0.1:${port}` : ""}`);
		registered = true;
	}

	function unregister() {
		if (!registered && !reviewer) {
			return;
		}
		unregisterHTTPEndpoints();
		if (reviewer?.agentTools) {
			delete reviewer.agentTools;
		}
		baseToolRegistry = new Map();
		sessionToolRegistry = new Map();
		responsesCatalogs = {};
		reviewer = null;
		registered = false;
	}

	function registerHTTPEndpoints() {
		if (httpRoutesRegistered || !SystematicReviewerWorkflowServer?.registerEndpoint || !SystematicReviewerWorkflowServer?.isUnlocked?.()) {
			return;
		}
		SystematicReviewerWorkflowServer.registerEndpoint(`${ENDPOINT_PREFIX}/ping`, PingEndpoint, {
			access: "public",
			dev_only: true,
		});
		SystematicReviewerWorkflowServer.registerEndpoint(`${ENDPOINT_PREFIX}/tools`, ToolsListEndpoint, {
			access: "public",
			dev_only: true,
		});
		SystematicReviewerWorkflowServer.registerEndpoint(`${ENDPOINT_PREFIX}/tools/call`, ToolCallEndpoint, {
			access: "public",
			dev_only: true,
		});
		httpRoutesRegistered = true;
	}

	function unregisterHTTPEndpoints() {
		if (!httpRoutesRegistered || !SystematicReviewerWorkflowServer?.unregisterPathHandler) {
			httpRoutesRegistered = false;
			return;
		}
		for (let path of [
			`${ENDPOINT_PREFIX}/ping`,
			`${ENDPOINT_PREFIX}/tools`,
			`${ENDPOINT_PREFIX}/tools/call`,
		]) {
			SystematicReviewerWorkflowServer.unregisterPathHandler(path);
		}
		httpRoutesRegistered = false;
	}

	function refreshHTTPEndpoints() {
		if (SystematicReviewerWorkflowServer?.isUnlocked?.()) {
			registerHTTPEndpoints();
			return;
		}
		unregisterHTTPEndpoints();
	}

	function visibleToolDefinitions(surface = SURFACE_EXTERNAL) {
		return Array.from(toolRegistryForSurface(surface).values())
			.filter((tool) => isVisibleToolForSurface(tool, surface));
	}

	function listTools(options = {}) {
		let surface = normalizeToolSurface(options?.surface || options);
		return visibleToolDefinitions(surface)
			.map((tool) => ({
				id: tool.id,
				description: tool.description,
				args: Object.keys(tool.inputShape || {}),
				inputShape: tool.inputShape || null,
			}))
			.sort((a, b) => a.id.localeCompare(b.id));
	}

	function buildResponsesCatalog(surface = SURFACE_EXTERNAL) {
		let normalizedSurface = normalizeToolSurface(surface);
		let legacyTools = visibleToolDefinitions(normalizedSurface)
			.map((tool) => ({
				id: tool.id,
				description: tool.description,
				args: Object.keys(tool.inputShape || {}),
				inputShape: tool.inputShape || null,
			}));
		let catalog = SystematicReviewerResponsesToolCatalog.buildNamespaceCatalog(legacyTools, { reviewer });
		let flattened = SystematicReviewerResponsesToolCatalog.flattenedTools(catalog);
		let introText = SystematicReviewerResponsesToolCatalog.buildSessionPromptIntro(catalog);
		if (normalizedSurface == SURFACE_SESSION || normalizedSurface == SURFACE_DEV) {
			let privilegedIntro = optionalString(privilegedToolsModule()?.getSessionPromptIntro?.(reviewer) || "");
			if (privilegedIntro) {
				introText = `${introText}\n\n${privilegedIntro}`;
			}
		}
		return Object.assign({}, catalog, {
			flattened,
			tool_search: SystematicReviewerResponsesToolCatalog.toolSearchDefinition(),
			intro_text: introText,
		});
	}

	function buildToolExecutionArgs(args = {}, options = {}) {
		let normalized = args && typeof args == "object" && !Array.isArray(args)
			? Object.assign({}, args)
			: {};
		let projectContext = buildProjectContext(options?.projectContext || options?.project_context || null);
		let toolSurface = normalizeToolSurface(options?.surface || SURFACE_EXTERNAL);
		let projectID = String(
			options?.projectID
			|| options?.project_id
			|| projectContext?.projectID
			|| normalized.project_id
			|| normalized.projectID
			|| ""
		).trim();
		let sessionID = String(
			options?.sessionID
			|| options?.session_id
			|| projectContext?.sessionID
			|| normalized.session_id
			|| normalized.sessionID
			|| ""
		).trim();
		if (projectContext || projectID || sessionID || toolSurface) {
			normalized.__sr_tool_context = {
				project_context: projectContext || null,
				project_id: projectID,
				session_id: sessionID,
				tool_surface: toolSurface,
			};
		}
		return normalized;
	}

	function requestedToolSurface(args = {}) {
		return normalizeToolSurface(args?.__sr_tool_context?.tool_surface || SURFACE_EXTERNAL);
	}

	function isPlainObject(value) {
		return !!value && typeof value == "object" && !Array.isArray(value);
	}

	function safeJSONStringify(value) {
		try {
			return JSON.stringify(value);
		}
		catch (_error) {
			return "";
		}
	}

	function cloneJSONCompatibleValue(value, seen = null) {
		try {
			return JSON.parse(JSON.stringify(value));
		}
		catch (_error) {}
		if (value === null || value === undefined) {
			return value;
		}
		if (typeof value == "string" || typeof value == "number" || typeof value == "boolean") {
			return value;
		}
		if (typeof value == "bigint") {
			return String(value);
		}
		if (typeof value == "function") {
			return undefined;
		}
		if (value instanceof Date) {
			try {
				return value.toISOString();
			}
			catch (_error) {
				return String(value);
			}
		}
		if (typeof value != "object") {
			return String(value);
		}
		let active = seen || new WeakSet();
		if (active.has(value)) {
			return null;
		}
		active.add(value);
		if (Array.isArray(value)) {
			let out = value.map((entry) => {
				let cloned = cloneJSONCompatibleValue(entry, active);
				return cloned === undefined ? null : cloned;
			});
			active.delete(value);
			return out;
		}
		let out = {};
		for (let key of Object.keys(value)) {
			let cloned = cloneJSONCompatibleValue(value[key], active);
			if (cloned !== undefined) {
				out[key] = cloned;
			}
		}
		active.delete(value);
		return out;
	}

	function compactScreeningExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		delete result.records;
		return result;
	}

	function compactDescriptivesExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		delete result.scope_item_keys;
		delete result.analysis_item_keys;
		delete result.matched_item_keys;
		if (Array.isArray(result.numeric_stats)) {
			result.numeric_stats = result.numeric_stats.map((entry) => {
				if (!isPlainObject(entry)) {
					return entry;
				}
				delete entry.item_keys;
				return entry;
			});
		}
		if (Array.isArray(result.citations)) {
			result.citations = result.citations
				.map((entry) => {
					let token = isPlainObject(entry)
						? String(entry.token || "").trim()
						: String(entry || "").trim();
					return token ? { token } : null;
				})
				.filter(Boolean);
		}
		return result;
	}

	function compactExploreQueryExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		if (isPlainObject(result.result)) {
			delete result.result.results;
		}
		return result;
	}

	function compactExploreChatSummary(chat = {}) {
		if (!isPlainObject(chat)) {
			return chat;
		}
		let messageCount = Array.isArray(chat.messages) ? chat.messages.length : (Number(chat.message_count || 0) || 0);
		return {
			id: String(chat.id || "").trim(),
			name: String(chat.name || "").trim(),
			path: String(chat.path || "").trim(),
			markdown_path: String(chat.markdown_path || "").trim(),
			model: String(chat.model || "").trim(),
			runtime_role_id: String(chat.runtime_role_id || chat.role_id || "").trim(),
			runtime_preset_id: String(chat.runtime_preset_id || chat.preset_id || "").trim(),
			batch_context_tokens_override: Number(chat.batch_context_tokens_override || 0) || 0,
			origin: String(chat.origin || "").trim(),
			session_id: String(chat.session_id || chat.sessionID || "").trim(),
			scope_key: String(chat.scope_key || "").trim(),
			scope_name: String(chat.scope_name || "").trim(),
			row_count: Number(chat.row_count || 0) || 0,
			batch_count: Number(chat.batch_count || 0) || 0,
			message_count: messageCount,
			final_reply: String(chat.final_reply || "").trim(),
			created_at: String(chat.created_at || "").trim(),
			updated_at: String(chat.updated_at || "").trim(),
		};
	}

	function compactExploreChatRunExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		if (isPlainObject(result.chat)) {
			result.chat = compactExploreChatSummary(result.chat);
		}
		return result;
	}

	function compactSemanticInspectExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		if (Array.isArray(result.bands)) {
			result.bands = result.bands.map((entry) => {
				if (!isPlainObject(entry)) {
					return entry;
				}
				delete entry.samples;
				return entry;
			});
		}
		return result;
	}

	function compactExtractionResultsExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		delete result.items;
		return result;
	}

	function compactExtractionRunExternalResult(result = {}) {
		if (!isPlainObject(result)) {
			return result;
		}
		if (Array.isArray(result.failures)) {
			result.failure_preview = result.failures
				.slice(0, 5)
				.map((entry) => ({
					item_key: String(entry?.item_key || "").trim(),
					error: String(entry?.error || "").trim(),
				}))
				.filter((entry) => entry.item_key || entry.error);
		}
		delete result.successes;
		delete result.failures;
		return result;
	}

	function applyToolSpecificExternalCompaction(toolID = "", result = null) {
		let id = String(toolID || "").trim();
		if (!id || result === null || result === undefined) {
			return result;
		}
		if (HEAVY_SCREENING_TOOL_IDS.has(id)) {
			return compactScreeningExternalResult(result);
		}
		if (id == "sr.descriptivesRun") {
			return compactDescriptivesExternalResult(result);
		}
		if (id == "sr.exploreQuery") {
			return compactExploreQueryExternalResult(result);
		}
		if (id == "sr.exploreChatRun") {
			return compactExploreChatRunExternalResult(result);
		}
		if (id == "sr.semanticInspectScores") {
			return compactSemanticInspectExternalResult(result);
		}
		if (id == "sr.extractionResultsList") {
			return compactExtractionResultsExternalResult(result);
		}
		if (id == "sr.extractionRun" || id == "sr.extractionRunSingle") {
			return compactExtractionRunExternalResult(result);
		}
		return result;
	}

	function backstopCompactValue(value, depth = 0) {
		if (value === null || value === undefined) {
			return value;
		}
		if (typeof value == "string") {
			if (value.length <= EXTERNAL_RESULT_BACKSTOP_MAX_STRING_LENGTH) {
				return value;
			}
			return `${value.slice(0, EXTERNAL_RESULT_BACKSTOP_MAX_STRING_LENGTH)}... [truncated]`;
		}
		if (typeof value == "number" || typeof value == "boolean") {
			return value;
		}
		if (depth >= EXTERNAL_RESULT_BACKSTOP_MAX_DEPTH) {
			if (Array.isArray(value)) {
				return `[truncated array depth=${depth} items=${value.length}]`;
			}
			if (isPlainObject(value)) {
				return `[truncated object depth=${depth} keys=${Object.keys(value).length}]`;
			}
			return String(value);
		}
		if (Array.isArray(value)) {
			let limit = Math.min(value.length, EXTERNAL_RESULT_BACKSTOP_MAX_ARRAY_ITEMS);
			let out = value.slice(0, limit).map((entry) => backstopCompactValue(entry, depth + 1));
			if (value.length > limit) {
				out.push(`[truncated ${value.length - limit} additional items]`);
			}
			return out;
		}
		if (!isPlainObject(value)) {
			return cloneJSONCompatibleValue(value);
		}
		let keys = Object.keys(value);
		let limit = Math.min(keys.length, EXTERNAL_RESULT_BACKSTOP_MAX_OBJECT_KEYS);
		let out = {};
		for (let key of keys.slice(0, limit)) {
			out[key] = backstopCompactValue(value[key], depth + 1);
		}
		if (keys.length > limit) {
			out.__truncated_keys = keys.length - limit;
		}
		return out;
	}

	function applyExternalResultBackstop(result = null) {
		let serialized = safeJSONStringify(result);
		if (serialized && serialized.length <= EXTERNAL_RESULT_MAX_JSON_CHARS) {
			return result;
		}
		let compacted = backstopCompactValue(result, 0);
		let reason = serialized
			? `External result compacted after exceeding ${EXTERNAL_RESULT_MAX_JSON_CHARS} JSON chars.`
			: "External result compacted for JSON-safe transport.";
		if (isPlainObject(compacted)) {
			compacted.truncated = true;
			compacted.truncation_reason = reason;
			return compacted;
		}
		return {
			value: compacted,
			truncated: true,
			truncation_reason: reason,
		};
	}

	function shapeExternalToolResult(tool = {}, result = null) {
		if (result === null || result === undefined) {
			return result;
		}
		let shaped = cloneJSONCompatibleValue(result);
		shaped = applyToolSpecificExternalCompaction(tool?.id || "", shaped);
		return applyExternalResultBackstop(shaped);
	}

	async function callTool(toolID, args = {}, options = {}) {
		if (!reviewer) {
			throw new Error("Systematic Reviewer agent tools are not registered.");
		}
		let surface = normalizeToolSurface(options?.surface || SURFACE_EXTERNAL);
		let callArgs = buildToolExecutionArgs(args, options);
		let requested = String(toolID || "").trim();
		let catalog = currentResponsesCatalog({ surface });
		if (requested == "tool_search") {
			let namespace = String(callArgs?.namespace || "").trim();
			let query = String(callArgs?.query || "").trim();
			if (!namespace && !query) {
				throw new Error("tool_search requires at least one populated selector: namespace, query, or both.");
			}
			return SystematicReviewerResponsesToolCatalog.searchCatalog(catalog, callArgs || {});
		}
		let registry = toolRegistryForSurface(surface);
		let tool = registry.get(requested);
		if (!tool && catalog?.by_name?.[requested]?.legacy_id) {
			tool = registry.get(catalog.by_name[requested].legacy_id);
		}
		if (!tool || !isVisibleToolForSurface(tool, surface)) {
			if (isEmbeddingsSemanticToolID(requested) && !embeddingsNamespacesVisible()) {
				throw new Error("Embeddings model is not configured.");
			}
			if (isMCPBrokerToolID(requested)) {
				throw new Error("External MCP broker tools are available only to the in-app session agent and developer testing surface.");
			}
			throw new Error(`Unknown tool: ${toolID}`);
		}
		let result = await tool.execute(callArgs || {});
		return shapeExternalToolResult(tool, result);
	}

	function buildToolRegistry() {
		let registry = new Map();
		let define = (tool) => {
			registry.set(tool.id, tool);
			return tool;
		};

		define({
			id: "sr.getProjectContext",
			description: "Get storage roots and project context.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
			},
			execute: async (args = {}) => {
				let scope = await resolveRoot(args, { defaultRoot: "current_or_last_project", allowStorageRoot: true });
				let settings = await reviewer._globalSettings();
				return {
					ok: true,
					projectModel: "one project root per main collection; subcollections stay inside that project scope",
					serverPort: getServerPort(),
					storageRoot: reviewer._storageRoot(),
					projectsRoot: reviewer._projectsRoot(),
					allProjects: await reviewer._listStoredProjects(),
					currentProject: serializeProjectContext(buildProjectContext(reviewer.currentProject)),
					lastProject: serializeProjectContext(buildProjectContext(settings.last_project)),
					resolvedRoot: serializeScope(scope),
				};
			},
		});

		define({
			id: "sr.runtimeSettingsGet",
			description: "Get runtime settings and detected executors.",
			inputShape: {},
			execute: async () => ({
				ok: true,
				...(await reviewer.getPreferencePanePayload()),
			}),
		});

		define({
			id: "sr.runtimeSettingsSave",
			description: "Save runtime settings.",
			inputShape: {
				openalex_api_key: "optional OpenAlex API key",
				server_security: "{ mcp_enabled, mcp_api_key }",
				privileged_tools: "{ shell_enabled, browser_enabled, dev_tools_enabled, default_timeout_ms }",
				mcp_clients: "{ servers: [{ enabled, server_id, label, transport, command, args, env, env_passthrough, cwd_mode, cwd, url, bearer_token_env, headers, headers_from_env }] }",
				api_connections: "[{ id, label, runtime_type, base_url, api_key }]",
				runtime_roles: "{ session_chat, data_extraction, pdf_vlm, embeddings }",
				runtime_preferences: "{ use_agent_model_for_data_extraction }",
				pdf_markdown: "{ mode }",
			},
			execute: async (args = {}) => {
				let payload = {};
				if (Object.prototype.hasOwnProperty.call(args, "openalex_api_key")) {
					payload.openalex_api_key = String(args.openalex_api_key || "");
				}
				if (Object.prototype.hasOwnProperty.call(args, "server_security")) {
					payload.server_security = args.server_security && typeof args.server_security == "object" ? args.server_security : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "privileged_tools")) {
					payload.privileged_tools = args.privileged_tools && typeof args.privileged_tools == "object" ? args.privileged_tools : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "mcp_clients")) {
					payload.mcp_clients = args.mcp_clients && typeof args.mcp_clients == "object" ? args.mcp_clients : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "api_connections")) {
					payload.api_connections = Array.isArray(args.api_connections) ? args.api_connections : [];
				}
				if (Object.prototype.hasOwnProperty.call(args, "runtime_roles")) {
					payload.runtime_roles = args.runtime_roles && typeof args.runtime_roles == "object" ? args.runtime_roles : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "runtime_preferences")) {
					payload.runtime_preferences = args.runtime_preferences && typeof args.runtime_preferences == "object" ? args.runtime_preferences : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "pdf_markdown")) {
					payload.pdf_markdown = args.pdf_markdown && typeof args.pdf_markdown == "object" ? args.pdf_markdown : {};
				}
					return {
						ok: true,
						...(await reviewer.savePreferencePaneSettings(payload)),
					};
				},
			});

		define({
			id: "sr.runtimeInventoryScan",
			description: "Scan configured APIs, local APIs, and executors.",
			inputShape: {
				api_connections: "optional connection overrides for scan",
				runtime_roles: "optional role overrides for scan",
			},
			execute: async (args = {}) => {
				let payload = {};
				if (Object.prototype.hasOwnProperty.call(args, "api_connections")) {
					payload.api_connections = Array.isArray(args.api_connections) ? args.api_connections : [];
				}
				if (Object.prototype.hasOwnProperty.call(args, "runtime_roles")) {
					payload.runtime_roles = args.runtime_roles && typeof args.runtime_roles == "object" ? args.runtime_roles : {};
				}
				return {
					ok: true,
					...(await reviewer.scanPreferencePaneEndpoints(payload)),
				};
			},
		});

		define({
			id: "sr.mcpListServers",
			description: "List configured external MCP connectors. These are user-installed third-party MCP servers exposed lazily through this broker; their individual capabilities are not injected into the base tool catalog.",
			inputShape: {},
			execute: async (args = {}) => {
				if (typeof SystematicReviewerMCPClient == "undefined") {
					throw new Error("External MCP client runtime is not available.");
				}
				return await SystematicReviewerMCPClient.listServers(reviewer, args || {});
			},
		});

		define({
			id: "sr.mcpInspectServer",
			description: "Connect to one configured external MCP server and list its advertised tools, resources, prompts, server info, and capabilities.",
			inputShape: {
				server_id: "required configured MCP server id",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.inspectServer(reviewer, args || {}),
		});

		define({
			id: "sr.mcpRefreshServer",
			description: "Disconnect and reconnect one external MCP server, then inspect its current tools, resources, and prompts.",
			inputShape: {
				server_id: "required configured MCP server id",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.refreshServer(reviewer, args || {}),
		});

		define({
			id: "sr.mcpDisconnectServer",
			description: "Disconnect one external MCP server and clean up its HTTP session or stdio subprocess.",
			inputShape: {
				server_id: "required configured MCP server id",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.disconnectServer(reviewer, args || {}),
		});

		define({
			id: "sr.mcpSearchTools",
			description: "Search one configured external MCP server's advertised tool schemas by name, description, or input schema. Use this before calling third-party MCP tools.",
			inputShape: {
				server_id: "required configured MCP server id",
				query: "optional search query",
				limit: "optional result limit, default 25",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.searchTools(reviewer, args || {}),
		});

		define({
			id: "sr.mcpCallTool",
			description: "Call one tool on a configured external MCP server through the broker. The external server performs whatever actions its own tool implements under the user's OS/network permissions.",
			inputShape: {
				server_id: "required configured MCP server id",
				name: "required MCP tool name",
				arguments: "optional MCP tool arguments object",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.callTool(reviewer, args || {}),
		});

		define({
			id: "sr.mcpListResources",
			description: "List resources advertised by one configured external MCP server, when that server supports resources.",
			inputShape: {
				server_id: "required configured MCP server id",
				cursor: "optional pagination cursor returned by the server",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.listResources(reviewer, args || {}),
		});

		define({
			id: "sr.mcpReadResource",
			description: "Read one resource from a configured external MCP server by URI, when that server supports resources.",
			inputShape: {
				server_id: "required configured MCP server id",
				uri: "required MCP resource URI",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.readResource(reviewer, args || {}),
		});

		define({
			id: "sr.mcpListPrompts",
			description: "List prompts advertised by one configured external MCP server, when that server supports prompts.",
			inputShape: {
				server_id: "required configured MCP server id",
				cursor: "optional pagination cursor returned by the server",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.listPrompts(reviewer, args || {}),
		});

		define({
			id: "sr.mcpGetPrompt",
			description: "Get a prompt from a configured external MCP server by name, with optional prompt arguments.",
			inputShape: {
				server_id: "required configured MCP server id",
				name: "required MCP prompt name",
				arguments: "optional prompt arguments object",
				timeout_ms: "optional request timeout override in milliseconds",
			},
			execute: async (args = {}) => await SystematicReviewerMCPClient.getPrompt(reviewer, args || {}),
		});

		define({
			id: "sr.runtimeRoleTest",
			description: "Load and test one configured runtime role using the current or overridden settings, then release any plugin-managed LM Studio instance used only for the test.",
			inputShape: {
				role_id: "required: session_chat | data_extraction | pdf_vlm | embeddings",
				openalex_api_key: "optional OpenAlex API key override",
				api_connections: "optional connection overrides for the test",
				runtime_roles: "optional role overrides for the test",
				runtime_preferences: "optional runtime preference overrides for the test",
				pdf_markdown: "optional PDF markdown overrides for the test",
			},
			execute: async (args = {}) => {
				let payload = {};
				if (Object.prototype.hasOwnProperty.call(args, "openalex_api_key")) {
					payload.openalex_api_key = String(args.openalex_api_key || "");
				}
				if (Object.prototype.hasOwnProperty.call(args, "api_connections")) {
					payload.api_connections = Array.isArray(args.api_connections) ? args.api_connections : [];
				}
				if (Object.prototype.hasOwnProperty.call(args, "runtime_roles")) {
					payload.runtime_roles = args.runtime_roles && typeof args.runtime_roles == "object" ? args.runtime_roles : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "runtime_preferences")) {
					payload.runtime_preferences = args.runtime_preferences && typeof args.runtime_preferences == "object" ? args.runtime_preferences : {};
				}
				if (Object.prototype.hasOwnProperty.call(args, "pdf_markdown")) {
					payload.pdf_markdown = args.pdf_markdown && typeof args.pdf_markdown == "object" ? args.pdf_markdown : {};
				}
				return {
					ok: true,
					...(await reviewer.testPreferencePaneRuntimeRole(
						args.role_id || args.roleID || "",
						payload
					)),
				};
			},
		});

		define({
			id: "sr.workflowBootstrap",
			description: "Get workflow bootstrap state for the current collection project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("workflow.getBootstrap", args || {});
			},
		});

			define({
				id: "sr.manualRead",
				description: "Read packaged workflow manuals for the current project, including systematic-review stage guidance, action examples, and reporting expectations.",
			inputShape: {
				workflow: "optional workflow id such as systematic_review_full or custom_analysis",
				stage: "optional stage id such as harvest | screening | full_text_retrieval | extraction | report_writing",
				namespace: "optional namespace hint such as harvest | screening | semantic | full_text",
				action: "optional action id such as harvest_query | semantic_search | extraction_run",
				action_ids: "optional array of action ids",
				question: "optional free-text question to keep with the returned guidance bundle",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
					return await SystematicReviewerWorkflowCommands.call("manual.read", args || {});
				},
			});

			define({
				id: "sr.automationDocumentRender",
				description: "Render the Automation document surface for the current project without saving report changes.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					surface: "optional preview | native",
					markdown: "optional markdown override used only for render",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.render", args || {});
				},
			});

			define({
				id: "sr.automationDocumentSave",
				description: "Save the Automation document for the current project.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					markdown: "optional markdown to persist into REPORT.md",
					save_reason: "optional internal save reason such as manual-save | mode-switch-save | chat-send-save",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.save", args || {});
				},
			});

			define({
				id: "sr.automationDocumentRollbackList",
				description: "List REPORT.md rollback snapshots for the current project.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					include_current_matches: "optional boolean to include snapshots identical to the current saved report",
					limit: "optional snapshot limit, max 200",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.rollback.list", args || {});
				},
			});

			define({
				id: "sr.automationDocumentRollbackDiff",
				description: "Diff the current saved REPORT.md against one rollback snapshot.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					snapshot_id: "required rollback snapshot filename such as report-2026-04-20T10-22-11-123Z-manual-save.md",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.rollback.diff", args || {});
				},
			});

			define({
				id: "sr.automationDocumentRollbackRestore",
				description: "Restore REPORT.md from one rollback snapshot, first saving the overwritten current report into rollback history when needed.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					snapshot_id: "required rollback snapshot filename such as report-2026-04-20T10-22-11-123Z-manual-save.md",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.rollback.restore", args || {});
				},
			});

			define({
				id: "sr.automationDocumentEditorSettingsSave",
				description: "Save Automation document editor settings such as font, margins, style, or page numbering.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					settings: "{ font_family, font_size, citation_style, margin_inches, show_page_numbers }",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.editorSettings.save", args || {});
				},
			});

			define({
				id: "sr.automationDocumentExportPdf",
				description: "Export the current Automation document to PDF.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.exportPdf", args || {});
				},
			});

			define({
				id: "sr.automationDocumentExportPlainMarkdown",
				description: "Export the current Automation document as plain markdown.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.exportPlainMarkdown", args || {});
				},
			});

			define({
				id: "sr.automationDocumentImportImage",
				description: "Import one image into the Automation document assets folder for the current project.",
				inputShape: {
					project_id: "optional stored project id such as 1-ABCD1234",
					session_id: "optional session id",
					path: "required absolute image path",
					name: "optional stored asset name",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("automation.document.importImage", args || {});
				},
			});

		define({
			id: "sr.harvestOpenAlex",
			description: "Run an OpenAlex harvest into the current Zotero project's Harvest/OpenAlex subcollection using DOI, PMID, arXiv, ISBN, or PMCID-to-PMID import. Successful major harvest runs should leave an exact technical summary in log.txt and then refresh the canonical REPORT.md search-methods narrative from those saved facts.",
				inputShape: {
					query: "required OpenAlex search string",
					field: "optional: title_and_abstract | title | abstract | all",
					sort: "optional: relevance | date | citations",
					sortOrder: "optional: asc | desc",
				since: "optional YYYY-MM-DD",
				until: "optional YYYY-MM-DD",
					language: "optional ISO language code",
					type_default: "optional OpenAlex filter shorthand such as type:article",
					maxResults: "optional result limit",
					pageSize: "optional OpenAlex page size; Boolean default/max 200, semantic default/max 50",
					filters: "optional array of key=value filters",
					mustHaveAbstract: "optional boolean",
					attachment_fetch_mode: "optional: included_only | all | none",
					fetch_for_all: "optional boolean shortcut for attachment_fetch_mode=all",
					searchMode: "optional: limited | all | estimate",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				let mode = String(args.searchMode || args.search_mode || "").trim().toLowerCase();
				let commandID = mode == "estimate" ? "harvest.estimate" : "harvest.run";
				return await SystematicReviewerWorkflowCommands.call(commandID, args || {});
			},
		});

		define({
			id: "sr.harvestConfigGet",
			description: "Load Harvest query options, OpenAlex filter metadata, and current API-credit status for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.getConfig", args || {});
			},
		});

		define({
			id: "sr.harvestRateLimitGet",
			description: "Refresh the saved OpenAlex API-credit status for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.getRateLimit", args || {});
			},
		});

		define({
			id: "sr.harvestOutputsList",
			description: "List saved harvest summary reports for the current project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.listOutputs", args || {});
			},
		});

		define({
			id: "sr.harvestRunsList",
			description: "List recent harvest and harvest-estimate jobs for the current project.",
			inputShape: {
				limit: "optional job list limit",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.listRuns", args || {});
			},
		});

		define({
			id: "sr.harvestSourcesList",
			description: "List Harvest source subcollections plus the standard review target collections for the current project, including Pending, Included, Excluded, Excluded FT, and Duplicates.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.listSources", args || {});
			},
		});

		define({
			id: "sr.harvestMergeSource",
			description: "Copy one Harvest source subcollection into Pending with exact DOI, PMID, arXiv, and ISBN deduplication into Duplicates. For systematic-review projects, this also refreshes Pending title+abstract embeddings when an embeddings model is configured.",
			inputShape: {
				source_collection_key: "required Harvest child collection key",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.mergeSource", args || {});
			},
		});

		define({
			id: "sr.harvestMergeAllSources",
			description: "Merge every direct Harvest source subcollection into Pending with the existing exact-identifier deduplication rules. For systematic-review projects, this also refreshes Pending title+abstract embeddings when an embeddings model is configured.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.mergeAllSources", args || {});
			},
		});

		define({
			id: "sr.harvestOutputRead",
			description: "Read one saved harvest summary report for the current project.",
			inputShape: {
				path: "optional absolute file path returned by harvest outputs list",
				name: "optional file name inside the current project harvest outputs folder",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("harvest.readOutput", args || {});
			},
		});

		define({
			id: "sr.extractionTemplatesList",
			description: "List extraction templates for the current project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.templates.list", args || {});
			},
		});

		define({
			id: "sr.extractionTemplateLoad",
			description: "Load one extraction template for the current project.",
			inputShape: {
				path: "optional absolute template path",
				name: "optional template name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.templates.load", args || {});
			},
		});

		define({
			id: "sr.extractionTemplateSave",
			description: "Save or update an extraction template for the current project.",
			inputShape: {
				path: "optional existing template path",
				name: "template name",
				description: "optional description",
				system_prompt: "optional system prompt",
				format_instructions: "optional format instructions",
				fields: "[{ key, label, type, guidance, allow_null, choices, choice_guidance, min, max }]",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.templates.save", args || {});
			},
		});

		define({
			id: "sr.extractionTemplateExport",
			description: "Export one saved extraction template from the current project as YAML content.",
			inputShape: {
				path: "optional absolute template path",
				name: "optional template name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.templates.export", args || {});
			},
		});

		define({
			id: "sr.extractionTemplateImport",
			description: "Import one extraction template YAML payload into the current project.",
			inputShape: {
				content: "required YAML template content",
				name: "optional override template name",
				create_new: "optional boolean, defaults to true",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.templates.import", args || {});
			},
		});

		define({
			id: "sr.extractionTemplateBootstrapDefault",
			description: "Return the primary extraction template for the current project, or the first available project-local template.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.templates.bootstrapDefault", args || {});
			},
		});

		define({
			id: "sr.extractionSourcesList",
			description: "List available extraction text sources for the current project or one scoped subcollection, including retrieved Full Text markdown when it exists.",
			inputShape: {
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.sources.list", args || {});
			},
		});

		define({
			id: "sr.extractionResultsList",
			description: "List saved extraction results and recent extraction runs for the current project.",
			inputShape: {
				template_path: "optional template path filter",
				limit: "optional limit for results and runs",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.results.list", args || {});
			},
		});

		define({
			id: "sr.extractionRun",
			description: "Run extraction over the current project using one saved template and the data extraction role, including Full Text markdown extraction for retrieved studies. Successful runs should be followed by a refreshed REPORT.md extraction-methods/results narrative grounded in the saved log entry and run outputs.",
			inputShape: {
				template_path: "optional template path",
				template_name: "optional template name",
				source_key: "optional source key such as title_abstract, full_text, or extraction:population",
				scope: "optional scope key such as pending, included, excluded, or one project subcollection",
				collection_key: "optional explicit project subcollection key",
				collection_name: "optional explicit project subcollection name",
				selected_fields: "optional array of field keys to run",
				row_scope: "optional all | missing_fields",
				limit: "optional max record count",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.run", args || {});
			},
		});

		define({
			id: "sr.extractionRunSingle",
			description: "Run extraction for one project item using one saved template and the data extraction role.",
			inputShape: {
				item_key: "required project item key",
				template_path: "optional template path",
				template_name: "optional template name",
				source_key: "optional source key such as title_abstract, full_text, or extraction:population",
				selected_fields: "optional array of field keys to run",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.runSingle", args || {});
			},
		});

		define({
			id: "sr.extractionFieldsUpdate",
			description: "Save manual extraction field values for one record and template in the current project.",
			inputShape: {
				item_key: "required project item key",
				template_path: "optional template path",
				template_name: "optional template name",
				source_key: "optional source key",
				values: "{ field_key: value }",
				fields: "optional [{ field_key, value }]",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("extraction.updateFields", args || {});
			},
		});

		define({
			id: "sr.embeddingsSourcesList",
			description: "List available embedding text sources for the current project or one scoped subcollection.",
			inputShape: {
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("embeddings.listSources", args || {});
			},
		});

		define({
			id: "sr.embeddingsStoredList",
			description: "List stored embeddings for the current project.",
			inputShape: {
				project_id: "optional stored project id such as 1-ABCD1234",
				root: "current_or_last_project | current_project | last_project",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("embeddings.listStored", args || {});
			},
		});

		define({
			id: "sr.embeddingsRun",
			description: "Create embeddings for the current project or one scoped subcollection and store them in SQLite blobs. Keep report prose aligned only when embeddings are part of the stated review method or the user explicitly wants that method described.",
			inputShape: {
				source_key: "optional source key such as title_abstract | title | abstract_note | full_text",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
				resume: "optional boolean to skip rows already embedded with the current model",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("embeddings.run", args || {});
			},
		});

		define({
			id: "sr.embeddingsRefresh",
			description: "Refresh embeddings status for the current project or one scoped subcollection, including available scopes, sources, and stored vectors.",
			inputShape: {
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("embeddings.refresh", args || {});
			},
		});

		define({
			id: "sr.semanticConfigGet",
			description: "Load semantic-search scopes, compatible stored embedding sources, and existing semantic score columns for the current project.",
			inputShape: {
				scope: "optional scope alias such as pending | included | excluded | excluded_ft",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("semantic.getConfig", args || {});
			},
		});

		define({
			id: "sr.semanticSearch",
			description: "Run brute-force cosine semantic search over the current project using stored embeddings for the current embeddings model.",
			inputShape: {
				query: "semantic query text",
				search_name: "optional search name used for the saved score column",
				source_key: "optional vector source key such as title_abstract | title | abstract_note | full_text",
				vector_column: "optional explicit vector column",
				scope: "optional scope alias such as pending | included | excluded | excluded_ft",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
				limit: "optional result limit, or all for no limit",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("semantic.search", args || {});
			},
		});

		define({
			id: "sr.semanticScoreColumnsList",
			description: "List semantic score columns already written into Screening for the current project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("semantic.scoreColumns.list", args || {});
			},
		});

		define({
			id: "sr.semanticInspectScores",
			description: "Inspect one semantic score column with score bands, counts, and sampled titles/abstracts for the current project or one scoped subcollection.",
			inputShape: {
				score_column: "optional semantic score column key; defaults to the latest semantic score column",
				scope: "optional scope alias such as pending | included | excluded | excluded_ft",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
				sample_limit: "optional number of sampled records to return per score band",
				bands: "optional array of { label, min, max } score bands",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("semantic.inspectScores", args || {});
			},
		});

		define({
			id: "sr.semanticHitOpen",
			description: "Open one stored semantic full-text hit in the markdown side-by-side viewer.",
			inputShape: {
				item_key: "required project item key",
				column_key: "required semantic score or chunk column key",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("semantic.hit.open", args || {});
			},
		});

		define({
			id: "sr.semanticPreviewItem",
			description: "Load one semantic-search result item with its full abstract and saved extraction values.",
			inputShape: {
				item_key: "required project item key",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("semantic.previewItem", args || {});
			},
		});

		define({
			id: "sr.documentsConfigGet",
			description: "Load Find Arguments availability for the current project, including keyword backend and full-text vector readiness.",
			inputShape: {
				scope: "optional scope key such as pending, included, excluded, or one project subcollection",
				collection_key: "optional explicit project subcollection key",
				collection_name: "optional explicit project subcollection name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("documents.getConfig", args || {});
			},
		});

		define({
			id: "sr.documentsFind",
			description: documentsFindDescription(),
			inputShape: {
				query: "required search query",
				mode: documentsFindModeShape(),
				scope: "optional scope key such as pending, included, excluded, or one project subcollection",
				collection_key: "optional explicit project subcollection key",
				collection_name: "optional explicit project subcollection name",
				limit: "optional document limit, capped at 5",
				chunks_per_document: "optional chunks per document, capped at 2",
				session_id: "optional session id to receive the visible Find Arguments chat result",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("documents.find", args || {});
			},
		});

		define({
			id: "sr.documentsFindNext",
			description: "Load the next page of documents for a previous Find Arguments search_id.",
			inputShape: {
				search_id: "required search id returned by documents__find",
				limit: "optional document limit, capped at 5",
				session_id: "optional session id to receive the visible Find Arguments chat result",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("documents.find_next", args || {});
			},
		});

		define({
			id: "sr.documentsHitOpen",
			description: "Open one Find Arguments hit in the markdown/PDF viewer with the chunk text highlighted.",
			inputShape: {
				item_key: "required project item key",
				attachment_key: "optional markdown attachment key; can be resolved from search_id + item_key",
				search_id: "optional Find Arguments search id",
				chunk_index: "optional chunk index when resolving from search_id",
				highlight_text: "optional highlight text",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("documents.hit.open", args || {});
			},
		});

		define({
			id: "sr.projectDataSchema",
			description: "Safely inspect the current project data shape before reading rows. Returns scopes, row counts, column keys/origins, and warnings. Always call this before project_data__rows so you can choose a scope and explicit columns.",
			inputShape: {
				scope: "optional scope alias such as pending | included | excluded | excluded_ft",
				collection_key: "optional explicit in-project collection key",
				collection_name: "optional explicit in-project collection name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("project_data.schema", args || {});
			},
		});

		define({
			id: "sr.projectDataRows",
			description: "Inspect a paged window of project data rows. This is intentionally capped at 25 rows per call because large row dumps can blow the model context. Choose scope and columns first; use Explore for synthesis/write-up over many rows.",
			inputShape: {
				scope: "optional scope alias such as pending | included | excluded | excluded_ft",
				collection_key: "optional explicit in-project collection key",
				collection_name: "optional explicit in-project collection name",
				columns: "optional array of column keys/prompt keys/labels; only these plus item_key and citation_token are returned",
				limit: "optional row count; default 25, maximum 25",
				offset: "optional zero-based row offset for paging",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("project_data.rows", args || {});
			},
		});

		define({
			id: "sr.projectDataRow",
			description: "Inspect one project data row by item_key, optionally restricted to explicit columns. Prefer this over broad row pages when you already know the citation/item to inspect.",
			inputShape: {
				item_key: "required Zotero/project item key",
				scope: "optional scope alias such as pending | included | excluded | excluded_ft",
				collection_key: "optional explicit in-project collection key",
				collection_name: "optional explicit in-project collection name",
				columns: "optional array of column keys/prompt keys/labels",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("project_data.row", args || {});
			},
		});

		define({
			id: "sr.itemsCreate",
			description: "Create one manual Zotero item in an explicit in-project target collection. This mutates Zotero/project collections and never chooses a default target; provide collection_key, collection_name, scope, or harvest_source_name.",
			inputShape: {
				collection_key: "optional explicit in-project target collection key",
				collection_name: "optional explicit in-project target collection name",
				scope: "optional explicit project scope alias",
				harvest_source_name: "optional Harvest child source to create or reuse as the explicit target",
				item_type: "optional Zotero item type, defaults to journalArticle",
				title: "optional title",
				creators: "optional array of creators with creatorType/type, firstName/lastName or name",
				date: "optional date",
				year: "optional year/date fallback",
				abstract: "optional abstract",
				publication_title: "optional publication title",
				publisher: "optional publisher",
				url: "optional URL",
				DOI: "optional DOI",
				PMID: "optional PMID",
				PMCID: "optional PMCID",
				arXiv: "optional arXiv id",
				ISBN: "optional ISBN",
				extra: "optional Zotero Extra field",
				tags: "optional array of tags",
				notes: "optional string or array of child notes",
				fields: "optional object of additional Zotero fields",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.create", args || {});
			},
		});

		define({
			id: "sr.itemsCreateMany",
			description: "Create up to 50 manual Zotero items in one explicit in-project target collection. This mutates Zotero/project collections and does not deduplicate/upsert.",
			inputShape: {
				collection_key: "optional explicit in-project target collection key",
				collection_name: "optional explicit in-project target collection name",
				scope: "optional explicit project scope alias",
				harvest_source_name: "optional Harvest child source to create or reuse as the explicit target",
				items: "required array of up to 50 item objects using the same fields as items__create",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.create_many", args || {});
			},
		});

		define({
			id: "sr.itemsReadMetadata",
			description: "Read one existing Zotero item by item key as native Zotero item JSON, including the native fields Zotero exposes for that item type. Use only when allowed and asked by the user to inspect item metadata, or when you are working on imports of custom data into projects yourself and want better metadata support. Example call: {\"tool\":\"items__read_metadata\",\"args\":{\"item_key\":\"ITEMKEY\"}}",
			inputShape: {
				item_key: "required Zotero/project item key; this is only used to select the item",
				library_id: "optional Zotero library id; defaults to current project library",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.read_metadata", args || {});
			},
		});

		define({
			id: "sr.itemsWriteMetadata",
			description: "Write native Zotero metadata fields on one existing Zotero item by item key. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. The Zotero item key is immutable and cannot be changed. Example call: {\"tool\":\"items__write_metadata\",\"args\":{\"item_key\":\"ITEMKEY\",\"fields\":{\"title\":\"Example article title\",\"date\":\"2026\",\"DOI\":\"10.1000/example\"},\"creators\":[{\"creatorType\":\"author\",\"firstName\":\"Aurelia\",\"lastName\":\"Veridiana\"}]}}",
			inputShape: {
				item_key: "required Zotero/project item key; this selects the item and is not writable",
				library_id: "optional Zotero library id; defaults to current project library",
				fields: "optional object of Zotero native field names to values; unsupported fields are reported by Zotero",
				metadata: "optional alias object of Zotero native field names to values",
				creators: "optional array of Zotero creators with creatorType/type and firstName/lastName or name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.write_metadata", args || {});
			},
		});

		define({
			id: "sr.itemsWriteMetadataMany",
			description: "Write native Zotero metadata fields on up to 50 existing Zotero items by item key. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. Item keys are immutable and cannot be changed. Example call: {\"tool\":\"items__write_metadata_many\",\"args\":{\"items\":[{\"item_key\":\"ITEMKEY\",\"fields\":{\"date\":\"2026\"}}]}}",
			inputShape: {
				library_id: "optional Zotero library id; defaults to current project library",
				items: "required array of up to 50 item objects using the same fields as items__write_metadata",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.write_metadata_many", args || {});
			},
		});

		define({
			id: "sr.itemsUpdateMetadata",
			description: "Alias for items__write_metadata. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. The Zotero item key is immutable and cannot be changed. Example call: {\"tool\":\"items__update_metadata\",\"args\":{\"item_key\":\"ITEMKEY\",\"fields\":{\"date\":\"2026\",\"DOI\":\"10.1000/example\"}}}",
			inputShape: {
				item_key: "required Zotero/project item key; this selects the item and is not writable",
				library_id: "optional Zotero library id; defaults to current project library",
				fields: "optional object of Zotero native field names to values; unsupported fields are reported by Zotero",
				metadata: "optional alias object of Zotero native field names to values",
				creators: "optional array of Zotero creators with creatorType/type and firstName/lastName or name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.update_metadata", args || {});
			},
		});

		define({
			id: "sr.itemsUpdateMetadataMany",
			description: "Alias for items__write_metadata_many. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. Item keys are immutable and cannot be changed. Example call: {\"tool\":\"items__update_metadata_many\",\"args\":{\"items\":[{\"item_key\":\"ITEMKEY\",\"fields\":{\"date\":\"2026\"}}]}}",
			inputShape: {
				library_id: "optional Zotero library id; defaults to current project library",
				items: "required array of up to 50 item objects using the same fields as items__update_metadata",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.update_metadata_many", args || {});
			},
		});

		define({
			id: "sr.itemsImportIdentifiers",
			description: "Import DOI, PMID, PMCID, arXiv, or ISBN identifiers through Zotero translators into an explicit in-project target. This mutates Zotero/project collections; PMCID is resolved to PMID when possible.",
			inputShape: {
				collection_key: "optional explicit in-project target collection key",
				collection_name: "optional explicit in-project target collection name",
				scope: "optional explicit project scope alias",
				harvest_source_name: "optional Harvest child source to create or reuse as the explicit target",
				identifiers: "required array of identifier strings or objects { type, value }, max 50",
				post_import_action: "optional for systematic review Harvest targets: none | merge_to_pending | merge_to_pending_with_embeddings",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("items.import_identifiers", args || {});
			},
		});

		define({
			id: "sr.screeningList",
			description: "List screening records and current decisions for the active project or one scoped subcollection.",
			inputShape: {
				query: "optional text search over title, abstract, reason, notes, or DOI",
				decision: "optional include | exclude | unreviewed",
				limit: "optional page size",
				offset: "optional offset",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.list", args || {});
			},
		});

		define({
			id: "sr.screeningUpdate",
			description: "Move one screening item to a target subcollection and/or save screening notes, reason, and provenance.",
			inputShape: {
				item_key: "required project item key",
				decision: "optional include | exclude | unreviewed",
				target_collection_key: "optional explicit target subcollection key",
				target_collection_name: "optional explicit target subcollection name",
				reason: "optional concise reason",
				notes: "optional reviewer notes",
				source_type: "optional manual | automated | agent",
				source_detail: "optional action detail recorded with the move",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.update", args || {});
			},
		});

		define({
			id: "sr.screeningSearch",
			description: "Search screening records with paging, custom columns, and saved rules for the active project or one scoped subcollection.",
			inputShape: {
				query: "optional text search",
				decision: "optional include | exclude | unreviewed",
				limit: "optional page size",
				page: "optional page number",
				offset: "optional offset override",
				save_run: "optional boolean to save this search into the project screening outputs folder",
				name: "optional saved run label when save_run is true",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.search", args || {});
			},
		});

		define({
			id: "sr.screeningColumnsList",
			description: "List available built-in and custom screening columns for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.columns.list", args || {});
			},
		});

		define({
			id: "sr.screeningTableFromDatabase",
			description: "Build one static markdown table from scoped screening/database rows using ordered project columns, with citation markdown included by default.",
			inputShape: {
				columns: "required ordered column keys as a comma-separated string or array",
				include_citation_column: "optional boolean, defaults to true",
				scope: "optional scope alias such as included | pending | excluded | excluded_ft",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
				query: "optional text search over title, abstract, reason, notes, or DOI",
				decision: "optional include | exclude | unreviewed filter",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.tableFromDatabase", args || {});
			},
		});

		define({
			id: "sr.descriptivesRun",
			description: "Calculate descriptive screening statistics for one scope using optional rule-based matching and selected numeric stats columns. If rules are present, numeric stats run over the matched papers only; if rules are blank and stats columns are provided, the tool summarizes the whole selected scope. For broad or general descriptives over large scopes, leave include_item_keys false because citation keys are normally not needed for sample-level summary results. Use include_item_keys true for specific rule-filtered scopes where particular column values, contains-rules, or other narrow criteria likely produce a small subset and you need to show which papers support that analysis. If the review is small, including keys in every analysis is fine. For very large scopes that broadly represent an already-defined review sample, hundreds or thousands of keys usually add cost without improving a generic overview. Returned markdown always puts counts/statistics first and appends optional item-key details last so very large outputs preserve the result content before optional keys.",
			inputShape: {
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
				rules: "optional [{ column_key, operator, match_value }] used to define the matched subset",
				stats_columns: "optional string[] of screening column keys for mean | median | min | max | range; when provided without rules the tool summarizes the whole selected scope",
				match_mode: "optional and | or",
				include_item_keys: "optional boolean, default false; set true when a small/specific filtered subset needs exact item keys/citation tokens, or when the whole review is small enough that key detail is useful",
				save_output: "optional boolean",
				name: "optional saved artifact name stem when save_output is true",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("descriptives.run", args || {});
			},
		});

		define({
			id: "sr.descriptivesRunsList",
			description: "List saved descriptives markdown artifacts from the current project workflow outputs folder.",
			inputShape: {
				limit: "optional maximum number of saved descriptives runs to return",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("descriptives.runs.list", args || {});
			},
		});

		define({
			id: "sr.descriptivesRunLoad",
			description: "Load one saved descriptives markdown artifact by absolute path or file name from the current project workflow outputs folder.",
			inputShape: {
				path: "optional absolute saved-run path",
				name: "optional file name inside the current project descriptives outputs folder",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("descriptives.run.load", args || {});
			},
		});

		define({
			id: "sr.screeningCompleteTitleAbstract",
			description: "Summarize title/abstract screening completion and formalize the handoff to full-text retrieval. Successful stage completion should refresh the canonical REPORT.md study-selection narrative rather than appending a dated note.",
			inputShape: {
				scope: "optional screening scope, usually pending",
				collection_key: "optional explicit scope collection key",
				collection_name: "optional explicit scope collection name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.completeTitleAbstract", args || {});
			},
		});

		define({
			id: "sr.fullTextStartRetrieval",
			description: "Start Zotero full-text/PDF retrieval for the current Pending scope and record retrieval watch state.",
			inputShape: {
				scope: "optional scope alias, usually pending",
				collection_key: "optional explicit scope collection key",
				collection_name: "optional explicit scope collection name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("fullText.startRetrieval", args || {});
			},
		});

			define({
				id: "sr.fullTextStatus",
				description: "Inspect current full-text retrieval state, newly found PDFs, and quiet-window readiness for finalizing unretrieved items.",
			inputShape: {
				scope: "optional scope alias, usually pending",
				collection_key: "optional explicit scope collection key",
				collection_name: "optional explicit scope collection name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
					return await SystematicReviewerWorkflowCommands.call("fullText.status", args || {});
				},
			});

			define({
				id: "sr.fullTextListItems",
				description: "List retrieved and unretrieved full-text records for the current scope.",
				inputShape: {
					scope: "optional scope alias, usually pending",
					collection_key: "optional explicit scope collection key",
					collection_name: "optional explicit scope collection name",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("fullText.listItems", args || {});
				},
			});

			define({
				id: "sr.fullTextQueueConversions",
				description: "Queue markdown conversions for newly retrieved PDFs in the current full-text scope using the configured PDF mode.",
			inputShape: {
				scope: "optional scope alias, usually pending",
				collection_key: "optional explicit scope collection key",
				collection_name: "optional explicit scope collection name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
					return await SystematicReviewerWorkflowCommands.call("fullText.queueConversions", args || {});
				},
			});

			define({
				id: "sr.fullTextConversionStatus",
				description: "Inspect markdown conversion jobs for the current full-text scope.",
				inputShape: {
					scope: "optional scope alias, usually pending",
					collection_key: "optional explicit scope collection key",
					collection_name: "optional explicit scope collection name",
					limit: "optional conversion job limit",
				},
				execute: async (args = {}) => {
					if (!SystematicReviewerWorkflowCommands?.call) {
						throw new Error("Manual workflow commands are not registered.");
					}
					return await SystematicReviewerWorkflowCommands.call("fullText.conversionStatus", args || {});
				},
			});

		define({
			id: "sr.fullTextFinalizeUnretrieved",
			description: "Move unretrieved full-text records from Pending into Excluded with the PRISMA-ready full_text_not_retrieved reason. Successful completion should also refresh the relevant REPORT.md study-selection or PRISMA-adjacent narrative from the latest log facts.",
			inputShape: {
				scope: "optional scope alias, usually pending",
				collection_key: "optional explicit scope collection key",
				collection_name: "optional explicit scope collection name",
				notes: "optional note stored with the exclusion move",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("fullText.finalizeUnretrieved", args || {});
			},
		});

		define({
			id: "sr.fullTextCompleteInclusion",
			description: "After full-text eligibility exclusions are complete, move the remaining Pending items into Included and switch downstream scope to Included. Successful completion should refresh the canonical REPORT.md inclusion narrative from the latest log facts.",
			inputShape: {
				scope: "optional scope alias, usually pending",
				collection_key: "optional explicit scope collection key",
				collection_name: "optional explicit scope collection name",
				reason: "optional stored include reason",
				notes: "optional stored include note",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("fullText.completeInclusion", args || {});
			},
		});

		define({
			id: "sr.screeningItemOpen",
			description: "Select one screening item in the Zotero library pane.",
			inputShape: {
				item_key: "required project item key",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.item.open", args || {});
			},
		});

		define({
			id: "sr.screeningPdfOpen",
			description: "Open the first PDF attached to one screening item in Zotero.",
			inputShape: {
				item_key: "required project item key",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.pdf.open", args || {});
			},
		});

		define({
			id: "sr.screeningRunsList",
			description: "List saved screening-search payloads from the current project outputs folder.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.runs.list", args || {});
			},
		});

		define({
			id: "sr.screeningRunLoad",
			description: "Load one saved screening-search payload from the current project outputs folder.",
			inputShape: {
				path: "optional absolute saved-run path",
				name: "optional file name inside the current project screening outputs folder",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.runs.load", args || {});
			},
		});

		define({
			id: "sr.screeningRunsCompare",
			description: "Compare multiple saved screening-search payloads from the current project outputs folder.",
			inputShape: {
				paths: "array of absolute saved-run paths",
				names: "optional array of file names inside the current project screening outputs folder",
				limit: "optional page size for the combined result",
				page: "optional page number",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.runs.compare", args || {});
			},
		});

		define({
			id: "sr.screeningFiltersList",
			description: "List materialized screening filters and the Zotero subcollections they control.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.filters.list", args || {});
			},
		});

		define({
			id: "sr.screeningFilterMaterialize",
			description: "Create or resync one screening filter as a Zotero subcollection.",
			inputShape: {
				filter_id: "optional existing materialized filter id to resync",
				name: "required filter name when creating a new materialized filter",
				query: "optional text search",
				decision: "optional include | exclude | unreviewed",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit source subcollection key inside the current project tree",
				collection_name: "optional explicit source subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.filters.materialize", args || {});
			},
		});

		define({
			id: "sr.screeningFilterDelete",
			description: "Delete one materialized screening filter and optionally remove its Zotero subcollection.",
			inputShape: {
				filter_id: "required materialized filter id",
				delete_collection: "optional boolean, defaults to true",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.filters.delete", args || {});
			},
		});

		define({
			id: "sr.screeningBulkRun",
			description: "Apply one bulk screening action to matching scoped records and record the action as a job.",
			inputShape: {
				action_kind: "optional move | filter_copy",
				match_mode: "optional and | or",
				rules: "optional [{ column_key, operator, match_value }]",
				target_collection_key: "optional target subcollection key for move actions",
				target_collection_name: "optional target subcollection name for move actions",
				filter_name: "optional filter subcollection name for filter_copy actions",
				decision: "optional include | exclude | unreviewed",
				current_decision: "optional include | exclude | unreviewed scope filter before bulk apply",
				query: "optional text filter before bulk apply",
				reason: "optional reason saved with the bulk action",
				notes: "optional notes saved with the bulk action",
				limit: "optional max records to update",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.bulkRun", args || {});
			},
		});

		define({
			id: "sr.screeningSaveEdits",
			description: "Save batch screening edits including move targets, custom column values, notes, and reasons.",
			inputShape: {
				edits: "[{ item_key, decision, target_collection_key, target_collection_name, reason, notes, values: { column_key: value } }]",
				query: "optional list refresh query",
				decision_filter: "optional list refresh decision filter",
				limit: "optional list refresh page size",
				page: "optional list refresh page",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.saveEdits", args || {});
			},
		});

		define({
			id: "sr.screeningColumnCreate",
			description: "Create or update one custom screening column.",
			inputShape: {
				label: "required display label",
				column_key: "optional stable key",
				type: "optional text | number | boolean",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.columns.create", args || {});
			},
		});

		define({
			id: "sr.screeningColumnDelete",
			description: "Delete one custom screening column and all stored values for it.",
			inputShape: {
				column_key: "required stable column key",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.columns.delete", args || {});
			},
		});

		define({
			id: "sr.screeningCommentUpdate",
			description: "Save notes or reason text for one project item.",
			inputShape: {
				item_key: "required project item key",
				reason: "optional reason text",
				notes: "optional notes text",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.comments.update", args || {});
			},
		});

		define({
			id: "sr.screeningRuleUpdate",
			description: "Create, update, enable, disable, or delete one screening rule.",
			inputShape: {
				rule_id: "optional existing rule id",
				delete_rule_id: "optional rule id to delete",
				label: "rule label",
				column_key: "field key such as title, abstract_note, doi, or a custom column",
				operator: "contains | not_contains | equals | not_equals",
				match_value: "text to match",
				decision: "include | exclude",
				enabled: "optional boolean",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.rules.update", args || {});
			},
		});

		define({
			id: "sr.screeningRulesRecompute",
			description: "Apply saved screening rules to matching records and record the run as a job.",
			inputShape: {
				current_decision: "optional include | exclude | unreviewed filter before applying rules",
				query: "optional text filter before applying rules",
				limit: "optional max records to check",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("screening.rules.recompute", args || {});
			},
		});

		define({
			id: "sr.prismaGetState",
			description: "Load saved PRISMA state merged with current automatic counts for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("prisma.getState", args || {});
			},
		});

		define({
			id: "sr.prismaSaveState",
			description: "Save PRISMA labels, hidden nodes, options, and manual value overrides for the active project.",
			inputShape: {
				options: "optional object with previous, other, and metaAnalysis booleans",
				labels: "optional object mapping node ids to custom labels",
				hidden: "optional array of hidden node ids",
				overrides: "optional object mapping node ids to { override, value }",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("prisma.saveState", args || {});
			},
		});

		define({
			id: "sr.prismaCompute",
			description: "Compute PRISMA-style counts for the active project and append a deterministic PRISMA Compute artifact into log.txt. Successful computes should be followed by a refreshed canonical REPORT.md PRISMA section grounded in the new counts.",
			inputShape: {
				mode: "optional compute mode such as retrieval_found or column_equals",
				column: "optional dataset column name or label for column_equals mode",
				values: "optional array of expected values for column_equals mode",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("prisma.compute", args || {});
			},
		});

		define({
			id: "sr.prismaRender",
			description: "Build the current visible PRISMA node groups for the active project.",
			inputShape: {
				options: "optional transient PRISMA options object for preview rendering",
				labels: "optional transient node label overrides for preview rendering",
				hidden: "optional transient array of hidden node ids for preview rendering",
				overrides: "optional transient node overrides for preview rendering",
				fontFamily: "optional transient font stack override for preview rendering",
				fontSize: "optional transient font size override for preview rendering",
				cornerRadius: "optional transient corner radius override for preview rendering",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("prisma.render", args || {});
			},
		});

		define({
			id: "sr.prismaExport",
			description: "Export PRISMA state and a markdown summary into the current project outputs folder.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("prisma.export", args || {});
			},
		});

		define({
			id: "sr.jobsList",
			description: "List recent plugin jobs for the active project.",
			inputShape: {
				project_id: "optional stored project id such as 1-ABCD1234",
				limit: "optional job list limit",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				let runtime = args.project_id || args.projectID
					? await reviewer._resolveProjectByID(String(args.project_id || args.projectID || "").trim())
					: null;
				let payload = Object.assign({}, args || {});
				if (runtime?.context?.projectID) {
					payload.project_id = runtime.context.projectID;
				}
				return await SystematicReviewerWorkflowCommands.call("jobs.list", payload);
			},
		});

		define({
			id: "sr.jobLoad",
			description: "Load one plugin job and its logs for the active project.",
			inputShape: {
				project_id: "optional stored project id such as 1-ABCD1234",
				job_id: "optional job id, defaults to the latest job",
				log_limit: "optional log line limit",
				job_limit: "optional job list limit for resolving the latest job",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				let runtime = args.project_id || args.projectID
					? await reviewer._resolveProjectByID(String(args.project_id || args.projectID || "").trim())
					: null;
				let payload = Object.assign({}, args || {});
				if (runtime?.context?.projectID) {
					payload.project_id = runtime.context.projectID;
				}
				return await SystematicReviewerWorkflowCommands.call("jobs.load", payload);
			},
		});

		define({
			id: "sr.jobDelete",
			description: "Delete one plugin job and its logs from the current project history.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project",
				job_id: "required project job id",
			},
			execute: async (args = {}) => {
				let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
				let jobID = String(args.job_id || args.jobID || "").trim();
				if (!jobID) {
					throw new Error("job_id is required.");
				}
				let db = await reviewer._projectDB(runtime.context);
				await db.queryAsync(`DELETE FROM job_logs WHERE job_id=?`, [jobID]);
				await db.queryAsync(`DELETE FROM jobs WHERE job_id=?`, [jobID]);
				return {
					ok: true,
					root: serializeScope(scope),
					job_id: jobID,
				};
			},
		});

		define({
			id: "sr.exploreSnapshot",
			description: "Inspect report, sessions, jobs, and artifact files for the active project.",
			inputShape: {
				session_id: "optional session to preselect",
				job_id: "optional job to preselect",
				session_limit: "optional session list limit",
				job_limit: "optional job list limit",
				artifact_limit: "optional artifact list limit",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.snapshot", args || {});
			},
		});

		define({
			id: "sr.exploreConfigGet",
			description: "Load Explore scopes, available columns, chats, citation rules, and runtime choices for the active project.",
			inputShape: {
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.getConfig", args || {});
			},
		});

		define({
			id: "sr.exploreColumnsList",
			description: "List project data columns available to the native Explore query surface for the active project or one scoped subcollection.",
			inputShape: {
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.columns.list", args || {});
			},
		});

		define({
			id: "sr.exploreCitationsSuggest",
			description: "Suggest scoped Explore citation tokens in @[ITEMKEY] form for the active project or one scoped subcollection.",
			inputShape: {
				prefix: "optional token, title, year, or item-key filter text",
				scope: "optional scope alias such as included | excluded | excluded_ft | pending",
				collection_key: "optional explicit subcollection key inside the current project tree",
				collection_name: "optional explicit subcollection name inside the current project tree",
				limit: "optional maximum number of suggestions to return",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.citations.suggest", args || {});
			},
		});

		define({
			id: "sr.exploreQuery",
			description: "Run a native Explore query over project records with optional filters and saved output. For systematic-review synthesis, prefer save_run=true so the output is preserved in project files and report artifacts, then refresh the relevant REPORT.md results narrative from the saved output and log entry when the run is being used for reportable synthesis.",
			inputShape: {
				query: "optional free-text query",
				decision_filter: "optional decision filter: include | exclude | unreviewed",
				columns: "optional list of column keys to search",
				filters: "optional list of { column, operator, value } filters",
				limit: "optional result limit",
				save_run: "true to save the query output into project outputs/explore and create a job",
				name: "optional saved run name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.query", args || {});
			},
		});

		define({
			id: "sr.exploreExportCsv",
			description: "Export the current Explore query selection into a CSV file in the active project outputs folder.",
			inputShape: {
				query: "optional free-text query",
				decision_filter: "optional decision filter: include | exclude | unreviewed",
				filters: "optional list of { column, operator, value } filters",
				export_columns: "optional list of column keys to include in the CSV",
				limit: "optional export row limit",
				name: "optional export file name stem",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.exportCsv", args || {});
			},
		});

		define({
			id: "sr.exploreChatsList",
			description: "List saved Explore chats for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.chats.list", args || {});
			},
		});

		define({
			id: "sr.exploreChatCreate",
			description: "Create a new saved Explore chat for the active project.",
			inputShape: {
				name: "optional chat name",
				system_prompt: "optional system prompt override",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.chats.create", args || {});
			},
		});

		define({
			id: "sr.exploreChatLoad",
			description: "Load one saved Explore chat for the active project.",
			inputShape: {
				chat_id: "optional chat id",
				path: "optional chat file path",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.chats.load", args || {});
			},
		});

		define({
			id: "sr.exploreChatRun",
			description: "Run one Explore chat request over project rows and save the reply. Successful synthesis runs should refresh the relevant REPORT.md results narrative from the saved chat output and log entry while preserving citation tokens exactly.",
			inputShape: {
				prompt: "chat request to run over the selected project rows",
				chat_id: "optional existing chat id",
				name: "optional new chat name when chat_id is omitted",
				query: "optional row-selection query",
				decision_filter: "optional decision filter",
				filters: "optional row filters",
				limit: "optional row limit",
				row_limit: "optional explicit row limit alias",
				collection_key: "optional scoped subcollection key",
				collection_name: "optional scoped subcollection name",
				runtime_role_id: "optional role choice: session_chat or data_extraction",
				include_history: "include previous chat messages when true",
				system_prompt: "optional system prompt override",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.chats.run", args || {});
			},
		});

		define({
			id: "sr.exploreRun",
			description: "Run one Automation-native Explore analysis over one project scope using the active session runtime.",
			inputShape: {
				prompt: "required explore prompt containing @{column} references",
				collection_key: "optional scope key",
				chat_name: "optional saved run name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("automation.explore.run", args || {});
			},
		});

		define({
			id: "sr.exploreListRuns",
			description: "List saved Automation-native Explore runs for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("automation.explore.listRuns", args || {});
			},
		});

		define({
			id: "sr.exploreListBatches",
			description: "List saved batches for one Automation-native Explore run.",
			inputShape: {
				chat_id: "required explore run chat id",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("automation.explore.listBatches", args || {});
			},
		});

		define({
			id: "sr.exploreLoadBatch",
			description: "Load one saved batch output from an Automation-native Explore run.",
			inputShape: {
				chat_id: "required explore run chat id",
				batch_index: "required zero-based batch index",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("automation.explore.loadBatch", args || {});
			},
		});

		define({
			id: "sr.explorePublishAppendix",
			description: "Publish an Automation-native Explore summary or batch into report appendices.",
			inputShape: {
				chat_id: "required explore run chat id",
				mode: "summary or batch",
				batch_index: "required when mode=batch",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("automation.explore.publishAppendix", args || {});
			},
		});

		define({
			id: "sr.exploreRunsList",
			description: "List saved Explore query outputs for the active project.",
			inputShape: {},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.runs.list", args || {});
			},
		});

		define({
			id: "sr.exploreRunLoad",
			description: "Load one saved Explore query output for the active project.",
			inputShape: {
				path: "saved run path inside outputs/explore",
				name: "optional saved run file name",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.runs.load", args || {});
			},
		});

		define({
			id: "sr.exploreSessionLoad",
			description: "Load one saved session transcript and timeline for the active project.",
			inputShape: {
				session_id: "optional session id, defaults to the active session",
				transcript_limit: "optional transcript message limit",
				timeline_limit: "optional timeline event limit",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.session.load", args || {});
			},
		});

		define({
			id: "sr.exploreJobLoad",
			description: "Load one saved job and its logs for the active project.",
			inputShape: {
				job_id: "optional job id, defaults to the latest job",
				log_limit: "optional log line limit",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				return await SystematicReviewerWorkflowCommands.call("explore.job.load", args || {});
			},
		});

		define({
			id: "sr.projectList",
			description: "List stored collection projects.",
			inputShape: {},
			execute: async () => ({
				ok: true,
				projects: await reviewer._listStoredProjects(),
			}),
		});

		define({
			id: "sr.projectRevealFolder",
			description: "Reveal one stored project folder in the OS file browser.",
			inputShape: {
				project_id: "stored project id such as 1-ABCD1234",
			},
			execute: async (args = {}) => ({
				ok: true,
				...(await reviewer.revealPreferencePaneProject(args.project_id || args.projectID || "")),
			}),
		});

		define({
			id: "sr.projectDelete",
			description: "Delete one stored project root and its Systematic Reviewer item, with optional Zotero collection deletion.",
			inputShape: {
				project_id: "stored project id such as 1-ABCD1234",
				delete_collection: "optional boolean, also erase the Zotero collection container",
			},
			execute: async (args = {}) => ({
				ok: true,
				...(await reviewer.deletePreferencePaneProject({
					project_id: args.project_id || args.projectID || "",
					delete_collection: args.delete_collection === true,
				})),
			}),
		});

		define({
			id: "sr.projectOpen",
			description: "Open a stored project and activate a session.",
			inputShape: {
				project_id: "stored project id such as 1-ABCD1234",
				session_id: "optional session id to activate after opening",
			},
			execute: async (args = {}) => {
				let surface = requestedToolSurface(args);
				let runtime = await reviewer._openStoredProject(
					args.project_id || args.projectID || "",
					{ sessionID: args.session_id || args.sessionID || "" }
				);
				let result = await reviewer._sessionOpen(runtime, {
					sessionID: runtime.sessionID || args.session_id || args.sessionID || "",
					surface,
				});
				return {
					ok: true,
					project: serializeProjectContext(buildProjectContext(Object.assign({}, runtime.context, {
						sessionID: result?.session?.session_id || runtime.sessionID || "",
						projectType: runtime.projectType || runtime.context?.projectType || "",
					}))),
					...result,
				};
			},
		});

		define({
			id: "sr.projectBind",
			description: "Bind one existing stored project for automation clients and return the real project workspace paths, session, and first automation turn packet.",
			inputShape: {
				project_id: "optional stored project id such as 1-ABCD1234; defaults to the current or last project",
				new_session: "optional boolean to create a new session",
				session_id: "optional existing session id",
				title: "optional session title when creating a new session",
				objective: "optional initial objective passed into the first automation turn packet",
			},
			execute: async (args = {}) => {
				let surface = requestedToolSurface(args);
				let runtime = null;
				let projectID = String(args.project_id || args.projectID || "").trim();
				if (projectID) {
					runtime = await reviewer._openStoredProject(projectID, {
						sessionID: args.session_id || args.sessionID || "",
					});
				}
				else {
					runtime = (await reviewer._resolveCurrentProject?.()) || (await reviewer._restoreLastProjectSelection?.());
					if (!runtime) {
						throw new Error("projectBind requires project_id or an already open Systematic Reviewer / Custom Analysis project.");
					}
				}
				let session = await reviewer._sessionOpen(runtime, {
					sessionID: args.session_id || args.sessionID || runtime?.sessionID || "",
					newSession: !!args.new_session,
					title: args.title || "",
					surface,
				});
				let boundSessionID = session?.session?.session_id || runtime?.sessionID || "default";
				return {
					ok: true,
					project: serializeProjectContext(buildProjectContext(Object.assign({}, runtime.context, {
						sessionID: boundSessionID,
						projectType: runtime.projectType || runtime.context?.projectType || "",
					}))),
					collection: await serializeCollection(runtime?.collection || null),
					session: session?.session || null,
					session_status: await reviewer._sessionStatus(runtime, boundSessionID, { surface }),
				};
			},
		});

		define({
			id: "sr.uiOpenWorkspaceTab",
			description: "Open or focus the project-scoped Automation tab.",
			inputShape: {
				project_id: "optional stored project id; defaults to current project",
			},
			execute: async (args = {}) => {
				let current = args.project_id || args.projectID
					? await reviewer._resolveProjectByID(String(args.project_id || args.projectID || "").trim())
					: (await reviewer._resolveCurrentProject?.()) || (await reviewer._restoreLastProjectSelection?.());
				if (!current) {
					throw new Error("Open a collection project first.");
				}
				let tab = await reviewer._openWorkflowTab(null, current, { activeTab: "automation" });
				return {
					ok: true,
					tab_id: tab?.id || "",
					project_id: current.context.projectID,
				};
			},
		});

		define({
			id: "sr.uiOpenWorkflowTab",
			description: "Open or focus one project-scoped workflow tab.",
			inputShape: {
				project_id: "optional stored project id; defaults to current project",
			},
			execute: async (args = {}) => {
				let current = args.project_id || args.projectID
					? await reviewer._resolveProjectByID(String(args.project_id || args.projectID || "").trim())
					: (await reviewer._resolveCurrentProject?.()) || (await reviewer._restoreLastProjectSelection?.());
				if (!current) {
					throw new Error("Open a collection project first.");
				}
				let tab = await reviewer._openWorkflowTab(null, current);
				return {
					ok: true,
					tab_id: tab?.id || "",
					project_id: current.context.projectID,
				};
			},
		});

		define({
			id: "sr.uiOpenJobsTab",
			description: "Open or focus one project-scoped jobs tab.",
			inputShape: {
				project_id: "optional stored project id; defaults to current project",
			},
			execute: async (args = {}) => {
				let current = args.project_id || args.projectID
					? await reviewer._resolveProjectByID(String(args.project_id || args.projectID || "").trim())
					: (await reviewer._resolveCurrentProject?.()) || (await reviewer._restoreLastProjectSelection?.());
				if (!current) {
					throw new Error("Open a collection project first.");
				}
				let tab = await reviewer._openJobsTab(null, current);
				return {
					ok: true,
					tab_id: tab?.id || "",
					project_id: current.context.projectID,
				};
			},
		});

		define({
			id: "sr.uiOpenMarkdownViewerTab",
			description: "Open or focus one Systematic Reviewer markdown viewer tab for a markdown attachment.",
			inputShape: {
				attachment_key: "required markdown attachment key",
				library_id: "optional Zotero library id, defaults to user library",
			},
			execute: async (args = {}) => {
				let attachmentKey = String(args.attachment_key || args.attachmentKey || "").trim();
				if (!attachmentKey) {
					throw new Error("attachment_key is required.");
				}
				let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
				let tab = await reviewer.openMarkdownAttachmentViewer({
					libraryID,
					attachmentKey,
				});
				return {
					ok: true,
					tab_id: tab?.id || "",
					attachment_key: attachmentKey,
					library_id: libraryID,
				};
			},
		});

		define({
			id: "sr.itemConvertAttachment",
			description: "Queue one attachment for Systematic Reviewer markdown conversion against a selected collection or subcollection scope.",
			inputShape: {
				attachment_key: "required Zotero attachment key",
				collection_key: "required Zotero collection key representing the current selection",
				library_id: "optional Zotero library id, defaults to user library",
				mode: "optional: fast_with_vlm_fallback | fast | vlm",
			},
			execute: async (args = {}) => {
				let attachmentKey = String(args.attachment_key || args.attachmentKey || "").trim();
				let collectionKey = String(args.collection_key || args.collectionKey || "").trim();
				let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
				let mode = String(args.mode || "fast").trim() || "fast";
				if (!attachmentKey) {
					throw new Error("attachment_key is required.");
				}
				if (!collectionKey) {
					throw new Error("collection_key is required.");
				}
				let collection = reviewer._collectionByKey(libraryID, collectionKey);
				if (!collection) {
					throw new Error("Collection was not found.");
				}
				let attachment = Zotero.Items.getByLibraryAndKey(libraryID, attachmentKey);
				if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
					throw new Error("Attachment was not found.");
				}
				if (!reviewer._isSupportedConversionAttachment(attachment)) {
					throw new Error("Attachment is not a supported conversion source.");
				}
				let parentItem = attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : null;
				let path = attachment.getFilePath ? (attachment.getFilePath() || "") : "";
				if (!path) {
					throw new Error("Attachment file path is not available.");
				}
				let result = await reviewer._queueConversionSourcesForCollection(collection, [{
					attachment,
					parentItem,
					kind: reviewer._conversionKindForItem(attachment),
					path,
				}], mode, null);
				return {
					ok: true,
					project_id: result.runtime?.context?.projectID || "",
					project_collection_key: result.projectCollection?.key || "",
					selected_collection_key: collectionKey,
					jobs: result.jobs || [],
				};
			},
		});

		define({
			id: "sr.itemLinkFileAttachment",
			description: "Link one local file as a Zotero attachment under an existing parent item.",
			inputShape: {
				item_key: "required parent Zotero item key",
				path: "required absolute file path",
				library_id: "optional Zotero library id, defaults to user library",
				title: "optional attachment title override",
				content_type: "optional MIME type override",
			},
			execute: async (args = {}) => {
				let itemKey = String(args.item_key || args.itemKey || "").trim();
				let filePath = String(args.path || "").trim();
				let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
				if (!itemKey) {
					throw new Error("item_key is required.");
				}
				if (!filePath) {
					throw new Error("path is required.");
				}
				let item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
				if (!item || item.deleted || item.isAttachment?.()) {
					throw new Error("Parent item was not found.");
				}
				if (!(await reviewer._pathExists(filePath))) {
					throw new Error("Attachment file path does not exist.");
				}
				let contentType = String(args.content_type || args.contentType || reviewer._contentTypeForPath(filePath) || "").trim();
				let attachment = await Zotero.Attachments.linkFromFile({
					file: filePath,
					parentItemID: item.id,
					title: String(args.title || reviewer._leafName(filePath)),
					contentType: contentType || undefined,
				});
				return {
					ok: true,
					item_key: item.key,
					attachment_key: attachment?.key || "",
					attachment_id: attachment?.id || 0,
					path: attachment?.getFilePath?.() || filePath,
					content_type: String(attachment?.attachmentContentType || contentType || ""),
				};
			},
		});

		define({
			id: "sr.itemDelete",
			description: "Delete one Zotero item or attachment by key.",
			inputShape: {
				item_key: "required Zotero item key",
				library_id: "optional Zotero library id, defaults to user library",
			},
			execute: async (args = {}) => {
				let itemKey = String(args.item_key || args.itemKey || "").trim();
				let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
				if (!itemKey) {
					throw new Error("item_key is required.");
				}
				let item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
				if (!item || item.deleted) {
					throw new Error("Item was not found.");
				}
				let summary = {
					ok: true,
					item_key: item.key,
					item_id: item.id || 0,
					parent_item_key: item.parentItem?.key || "",
					is_attachment: !!item.isAttachment?.(),
				};
				await item.eraseTx();
				return summary;
			},
		});

		define({
			id: "sr.uiMoveTabToExternalWindow",
			description: "Move one open Systematic Reviewer tab into a new Zotero window.",
			inputShape: {
				tab_id: "required open Zotero tab id",
			},
			execute: async (args = {}) => {
				let tabID = String(args.tab_id || args.tabID || "").trim();
				if (!tabID) {
					throw new Error("tab_id is required.");
				}
				let win = reviewer._primaryWindow?.();
				if (!win?.Zotero_Tabs?._getTab) {
					throw new Error("Zotero tab API is not available.");
				}
				let tab = win.Zotero_Tabs._getTab(tabID)?.tab || null;
				if (!tab) {
					throw new Error("Tab was not found.");
				}
				let kind = reviewer._projectTabKindFromType(tab.type || "");
				if (!kind) {
					throw new Error("Tab is not a Systematic Reviewer tab.");
				}
				await reviewer._moveProjectTabToExternalWindow(win, tab, 0, kind);
				return {
					ok: true,
					tab_id: tabID,
					kind,
					project_id: tab?.data?.projectID || "",
					attachment_key: tab?.data?.attachmentKey || "",
				};
			},
		});

		define({
			id: "sr.uiCloseTab",
			description: "Close one open Systematic Reviewer tab by id across all Zotero main windows.",
			inputShape: {
				tab_id: "required open Zotero tab id",
			},
			execute: async (args = {}) => {
				let tabID = String(args.tab_id || args.tabID || "").trim();
				if (!tabID) {
					throw new Error("tab_id is required.");
				}
				for (let win of reviewer._mainWindows()) {
					if (!win?.Zotero_Tabs?._tabs) {
						continue;
					}
					let tab = win.Zotero_Tabs._tabs.find((candidate) => String(candidate?.id || "") == tabID) || null;
					if (!tab) {
						continue;
					}
					if (!reviewer._projectTabKindFromType(tab?.type || "")) {
						throw new Error("Tab is not a Systematic Reviewer tab.");
					}
					win.Zotero_Tabs.close(tabID);
					return {
						ok: true,
						tab_id: tabID,
					};
				}
				throw new Error("Tab was not found.");
			},
		});

		define({
			id: "sr.sessionList",
			description: "List sessions in a project.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project",
			},
			execute: async (args = {}) => {
				let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
				return {
					ok: true,
					root: serializeScope(scope),
					sessions: await reviewer._listProjectSessions(runtime.context),
				};
			},
		});

		define({
			id: "sr.sessionOpen",
			description: "Open or create a session.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project",
				session_id: "optional existing session id",
				newSession: "boolean",
				title: "optional title for a newly created session",
			},
			execute: async (args = {}) => {
				let surface = requestedToolSurface(args);
				let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
				let result = await reviewer._sessionOpen(runtime, {
					sessionID: args.session_id || args.sessionID || "",
					newSession: !!args.newSession,
					title: args.title || "",
					surface,
				});
				return {
					ok: true,
					root: serializeScope(scope),
					...result,
				};
			},
		});

			define({
				id: "sr.sessionStatus",
				description: "Get session state, transcript, and timeline.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project",
				session_id: "optional session id, defaults to the active session",
			},
			execute: async (args = {}) => {
				let surface = requestedToolSurface(args);
				let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
				let sessionID = String(args.session_id || args.sessionID || runtime.sessionID || "").trim();
				let result = sessionID
					? await reviewer._sessionStatus(runtime, sessionID, { surface })
					: await reviewer._sessionOpen(runtime, { surface });
				return {
					ok: true,
					root: serializeScope(scope),
					...result,
				};
				},
			});

			define({
				id: "sr.memoryRebuild",
				description: "Rebuild active-memory.txt from chronological memory.txt for the current project so future agent calls continue from durable project memory.",
				inputShape: {
					root: "current_or_last_project | current_project | last_project",
					session_id: "optional session id for status metadata",
				},
				execute: async (args = {}) => {
					let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
					let sessionID = String(args.session_id || args.sessionID || runtime.sessionID || "").trim()
						|| await reviewer._ensureActiveSession(runtime.context);
					let result = await reviewer._rebuildActiveMemory(runtime, sessionID, {});
					return {
						ok: true,
						root: serializeScope(scope),
						...result,
					};
				},
			});

			define({
				id: "sr.sessionMessage",
			description: "Send one message through the shared session router.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project",
				session_id: "optional session id, defaults to the active session",
				message: "user or agent message",
			},
			execute: async (args = {}) => {
				let surface = requestedToolSurface(args);
				let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
				let message = String(args.message || args.content || "").trim();
				if (!message) {
					throw new Error("sessionMessage requires a message.");
				}
				let result = await reviewer._sessionMessage(
					runtime,
					String(args.session_id || args.sessionID || runtime.sessionID || "").trim(),
					message,
					{ origin: "api", emitProgress: false, surface }
				);
				return {
					ok: true,
					root: serializeScope(scope),
					...result,
				};
			},
		});

		define({
			id: "sr.sessionNext",
			description: "Open a session or send a message in one call.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project",
				session_id: "optional session id",
				message: "optional user or agent message",
				newSession: "boolean",
				title: "optional title for a newly created session",
			},
			execute: async (args = {}) => {
				let surface = requestedToolSurface(args);
				let { scope, runtime } = await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" });
				let message = String(args.message || args.content || "").trim();
				let result = message
					? await reviewer._sessionMessage(
						runtime,
						String(args.session_id || args.sessionID || runtime.sessionID || "").trim(),
						message,
						{ origin: "api", emitProgress: false, surface }
					)
					: await reviewer._sessionOpen(runtime, {
						sessionID: args.session_id || args.sessionID || "",
						newSession: !!args.newSession,
						title: args.title || "",
						surface,
					});
				return {
					ok: true,
					root: serializeScope(scope),
					...result,
				};
			},
		});

		define({
			id: "sr.scopeList",
			description: "List valid backend scopes for the active or selected project binding.",
			inputShape: {
				project_id: "optional stored project id such as 1-ABCD1234",
				root: "current_or_last_project | current_project | last_project",
			},
			execute: async (args = {}) => {
				if (!SystematicReviewerWorkflowCommands?.call) {
					throw new Error("Manual workflow commands are not registered.");
				}
				let runtime = args.project_id || args.projectID
					? await reviewer._resolveProjectByID(String(args.project_id || args.projectID || "").trim())
					: (await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" })).runtime;
				let scope = args.project_id || args.projectID
					? {
						rootKind: "project_id",
						rootPath: runtime?.context?.projectRoot || "",
						projectContext: buildProjectContext(runtime?.context || null),
					}
					: (await resolveProjectRuntime(args, { defaultRoot: "current_or_last_project" })).scope;
				if (!runtime) {
					throw new Error("Project was not found.");
				}
				let result = await SystematicReviewerWorkflowCommands.call("automation.scope.list", {
					project_id: runtime.context.projectID,
				});
				return Object.assign({ root: serializeScope(scope) }, result);
			},
		});

		define({
			id: "sr.listDir",
			description: "List files under a root/path.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative directory path",
			},
			execute: async (args = {}) => {
				let scope = await resolveRoot(args, { defaultRoot: "current_or_last_project", allowStorageRoot: true });
				let relativePath = normalizeRelativePath(args.path || args.relativePath || "", { allowEmpty: true });
				let absolutePath = joinRelativePath(scope.rootPath, relativePath);
				let directory = reviewer._nsIFile(absolutePath);
				if (!directory.exists()) {
					throw new Error(`Directory does not exist: ${relativePath || "."}`);
				}
				if (!directory.isDirectory()) {
					throw new Error(`Path is not a directory: ${relativePath || "."}`);
				}
				let entries = [];
				let children = directory.directoryEntries;
				while (children.hasMoreElements()) {
					let child = children.getNext().QueryInterface(Components.interfaces.nsIFile);
					let childRelativePath = relativePath ? `${relativePath}/${child.leafName}` : child.leafName;
					entries.push(fileInfo(child, childRelativePath));
				}
				entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
				return {
					ok: true,
					root: serializeScope(scope),
					path: relativePath || "",
					entries,
				};
			},
		});

		define({
			id: "sr.readFile",
			description: "Read a text file, optionally by line range.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative file path",
				start_line: "optional 1-based first line to return",
				end_line: "optional 1-based last line to return",
				max_lines: "optional maximum number of lines to return from start_line",
				include_line_numbers: "optional boolean",
			},
			execute: async (args = {}) => {
				let target = await resolveTextFileTarget(args, { defaultRoot: "current_or_last_project" });
				let contents = await reviewer._readFileText(target.absolutePath);
				let selection = buildTextReadSelection(contents, args);
				let content = selection ? selection.content : contents;
				let result = {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: detectTextFormat(target.relativePath),
					contentType: reviewer._contentTypeForPath(target.absolutePath),
					content,
					size: content.length,
					totalSize: contents.length,
					contentHash: simpleHash(content),
				};
				if (selection) {
					result.selection = {
						startLine: selection.startLine,
						endLine: selection.endLine,
						totalLines: selection.totalLines,
						hasMoreBefore: selection.hasMoreBefore,
						hasMoreAfter: selection.hasMoreAfter,
					};
					result.lines = selection.lines;
					if (truthyFlag(args.include_line_numbers ?? args.includeLineNumbers)) {
						result.lineNumberedContent = selection.lineNumberedContent;
					}
				}
				if (result.format == "markdown") {
					let headings = extractMarkdownHeadings(contents);
					result.headings = selection
						? headings.filter((heading) => heading.line >= selection.startLine && heading.line <= selection.endLine)
						: headings;
				}
				if (result.format == "json" && !selection) {
					try {
						result.value = JSON.parse(contents);
					}
					catch (error) {
						result.parseError = error.message || String(error);
					}
				}
				return result;
			},
		});

		define({
			id: "sr.searchFile",
			description: "Search one project text or markdown file by literal text or regex and return capped line-numbered snippets. Use this before reading a whole REPORT.md/log.txt when you only need to find report markers, headings, or a phrase.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative file path",
				query: "required literal or regex search text",
				regex: "optional boolean; default false",
				case_sensitive: "optional boolean; default false",
				max_results: "optional result cap; default 20, maximum 50",
				before_lines: "optional context lines before each match; maximum 3",
				after_lines: "optional context lines after each match; maximum 3",
			},
			execute: async (args = {}) => {
				let target = await resolveTextFileTarget(args, { defaultRoot: "current_or_last_project" });
				let contents = await reviewer._readFileText(target.absolutePath);
				let query = String(args.query ?? args.pattern ?? "").trim();
				if (!query) {
					throw new Error("workspace__search_file requires a query.");
				}
				let maxResults = normalizeBoundedInteger(args.max_results ?? args.maxResults ?? args.limit, 20, 1, 50);
				let beforeLines = normalizeBoundedInteger(args.before_lines ?? args.beforeLines, 0, 0, 3);
				let afterLines = normalizeBoundedInteger(args.after_lines ?? args.afterLines, 0, 0, 3);
				let regex = truthyFlag(args.regex);
				let caseSensitive = truthyFlag(args.case_sensitive ?? args.caseSensitive);
				let search = searchTextLines(contents, query, {
					regex,
					caseSensitive,
					maxResults,
					beforeLines,
					afterLines,
				});
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: detectTextFormat(target.relativePath),
					query,
					regex,
					caseSensitive,
					matchCount: search.matchCount,
					returnedCount: search.matches.length,
					truncated: search.truncated,
					maxResults,
					matches: search.matches,
					contentHash: simpleHash(contents),
				};
			},
		});

		define({
			id: "sr.writeFile",
			description: "Write a text file.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative file path",
				content: "string",
			},
			execute: async (args = {}) => {
				let target = await resolveTextFileTarget(args, { defaultRoot: "current_or_last_project", requireExisting: false });
				let nextContent = coerceTextContent(args.content ?? args.contents);
				validateStructuredText(target.relativePath, nextContent);
				let previousContent = (await reviewer._pathExists(target.absolutePath))
					? await reviewer._readFileText(target.absolutePath)
					: null;
				await reviewer._writeTextFile(target.absolutePath, nextContent);
				await recordFileRevision(target.scope, target.relativePath, previousContent, nextContent, {
					action: "writeFile",
					details: {
						format: detectTextFormat(target.relativePath),
					},
				});
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: detectTextFormat(target.relativePath),
					contentHash: simpleHash(nextContent),
					size: nextContent.length,
					changed: previousContent !== nextContent,
				};
			},
		});

		define({
			id: "sr.patchFile",
			description: "Patch a text file with string or line operations.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative file path",
				operations: [
					"required array of patch operations such as { type: append | prepend | replace | insert_before | insert_after | replace_lines | delete_lines | insert_at_line, ... }",
				],
			},
			execute: async (args = {}) => {
				let target = await resolveTextFileTarget(args, { defaultRoot: "current_or_last_project" });
				let original = await reviewer._readFileText(target.absolutePath);
				let operations = normalizeOperations(args);
				let current = original;
				let applied = [];
				for (let operation of operations) {
					let result = applyTextOperation(current, operation);
					current = result.text;
					applied.push(result.summary);
				}
				validateStructuredText(target.relativePath, current);
				await reviewer._writeTextFile(target.absolutePath, current);
				await recordFileRevision(target.scope, target.relativePath, original, current, {
					action: "patchFile",
					details: {
						applied,
					},
				});
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: detectTextFormat(target.relativePath),
					applied,
					contentHash: simpleHash(current),
					size: current.length,
					changed: original !== current,
				};
			},
		});

		define({
			id: "sr.patchMarkdown",
			description: "Patch markdown-like files by section, heading path, line, or string operations.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative markdown path, defaults to REPORT.md and also accepts markdown-rendered .txt files such as log.txt",
				operations: [
					"required array of patch operations such as { type: replace_section | replace_section_body | append_section | prepend_section | delete_section, heading: Findings | headingPath: [\"Results\", \"Findings\"], content: \"...\" }",
				],
			},
			execute: async (args = {}) => {
				let normalizedArgs = Object.assign({}, args);
				if (!normalizedArgs.path && !normalizedArgs.relativePath) {
					normalizedArgs.path = "REPORT.md";
				}
				let target = await resolveMarkdownTarget(normalizedArgs, { defaultRoot: "current_or_last_project" });
				let original = await reviewer._readFileText(target.absolutePath);
				let operations = normalizeOperations(normalizedArgs);
				let current = original;
				let applied = [];
				for (let operation of operations) {
					let result = isMarkdownSectionOperation(operation.type)
						? applyMarkdownOperation(current, operation)
						: applyTextOperation(current, operation);
					current = result.text;
					applied.push(result.summary);
				}
				await reviewer._writeTextFile(target.absolutePath, current);
				await recordFileRevision(target.scope, target.relativePath, original, current, {
					action: "patchMarkdown",
					details: {
						applied,
					},
				});
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "markdown",
					applied,
					contentHash: simpleHash(current),
					size: current.length,
					changed: original !== current,
					headings: extractMarkdownHeadings(current),
				};
			},
		});

		define({
			id: "sr.readMarkdownHeadings",
			description: "List markdown headings from one markdown-like file without reading the whole body.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative markdown path, defaults to REPORT.md and also accepts markdown-rendered .txt files such as log.txt",
				max_depth: "optional maximum heading depth such as 2 or 3",
			},
			execute: async (args = {}) => {
				let normalizedArgs = Object.assign({}, args);
				if (!normalizedArgs.path && !normalizedArgs.relativePath) {
					normalizedArgs.path = "REPORT.md";
				}
				let target = await resolveMarkdownTarget(normalizedArgs, { defaultRoot: "current_or_last_project" });
				let content = await reviewer._readFileText(target.absolutePath);
				let headings = extractMarkdownHeadings(content);
				let maxDepth = Number(normalizedArgs.max_depth ?? normalizedArgs.maxDepth ?? 0) || 0;
				if (maxDepth > 0) {
					headings = headings.filter((heading) => Number(heading?.level || 0) <= maxDepth);
				}
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "markdown_headings",
					headingCount: headings.length,
					headings,
					contentHash: simpleHash(content),
				};
			},
		});

		define({
			id: "sr.readMarkdownSection",
			description: "Read one markdown heading section or a heading range from a markdown-like file.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative markdown path, defaults to REPORT.md and also accepts markdown-rendered .txt files such as log.txt",
				heading: "heading text to match at any level",
				headingPath: "[\"Top\", \"Child\"] for an exact heading path",
				to_heading: "optional end heading text after the start heading",
				to_heading_path: "optional exact end heading path",
				include_heading: "optional boolean, defaults true",
				include_end_heading: "optional boolean, defaults false",
				occurrence: "optional 1-based match number for repeated start headings",
				include_line_numbers: "optional boolean",
			},
			execute: async (args = {}) => {
				let normalizedArgs = Object.assign({}, args);
				if (!normalizedArgs.path && !normalizedArgs.relativePath) {
					normalizedArgs.path = "REPORT.md";
				}
				let target = await resolveMarkdownTarget(normalizedArgs, { defaultRoot: "current_or_last_project" });
				let content = await reviewer._readFileText(target.absolutePath);
				let section = readMarkdownSelection(content, normalizedArgs);
				if (!section) {
					throw new Error("The requested markdown heading section was not found.");
				}
				let result = {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "markdown_section",
					content: section.content,
					body: section.body,
					heading: section.heading,
					endHeading: section.endHeading || null,
					startLine: section.startLine,
					endLine: section.endLine,
					hasMoreBefore: section.hasMoreBefore,
					hasMoreAfter: section.hasMoreAfter,
					headings: section.headings,
					contentHash: simpleHash(section.content),
				};
				if (truthyFlag(args.include_line_numbers ?? args.includeLineNumbers)) {
					result.lineNumberedContent = buildLineNumberedContent(content, section.startLine, section.endLine);
				}
				return result;
			},
		});

		define({
			id: "sr.applyPatch",
			description: "Apply an opencode-style structured patch across one or more text files under the selected root.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				patch: "required patch text with *** Begin Patch / *** End Patch",
			},
			execute: async (args = {}) => {
				let scope = await resolveRoot(args, { defaultRoot: "current_or_last_project", allowStorageRoot: true });
				let patchText = coerceTextContent(args.patch ?? args.patchText ?? args.text);
				let parsed = parseStructuredPatch(patchText);
				let changes = [];
				for (let hunk of parsed.hunks) {
					changes.push(await prepareStructuredPatchChange(scope, hunk));
				}
				let applied = [];
				for (let change of changes) {
					let summary = await applyStructuredPatchChange(scope, change);
					applied.push(summary);
				}
				return {
					ok: true,
					root: serializeScope(scope),
					applied,
					fileCount: applied.length,
				};
			},
		});

		define({
			id: "sr.readJson",
			description: "Read a JSON file.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative .json file path",
			},
			execute: async (args = {}) => {
				let target = await resolveJsonTarget(args, { defaultRoot: "current_or_last_project" });
				let content = await reviewer._readFileText(target.absolutePath);
				let value = JSON.parse(content);
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "json",
					value,
					content,
				};
			},
		});

		define({
			id: "sr.writeJson",
			description: "Write a JSON file.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative .json file path",
				value: "{ ... }",
			},
			execute: async (args = {}) => {
				let target = await resolveJsonTarget(args, { defaultRoot: "current_or_last_project", requireExisting: false });
				let value = Object.prototype.hasOwnProperty.call(args || {}, "value")
					? args.value
					: args.json;
				if (value === undefined) {
					throw new Error("writeJson requires a value or json payload.");
				}
				let spaces = normalizeIndent(args.spaces);
				let nextContent = `${JSON.stringify(value, null, spaces)}\n`;
				let previousContent = (await reviewer._pathExists(target.absolutePath))
					? await reviewer._readFileText(target.absolutePath)
					: null;
				await reviewer._writeTextFile(target.absolutePath, nextContent);
				await recordFileRevision(target.scope, target.relativePath, previousContent, nextContent, {
					action: "writeJson",
					details: {
						spaces,
					},
				});
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "json",
					contentHash: simpleHash(nextContent),
					size: nextContent.length,
					changed: previousContent !== nextContent,
				};
			},
		});

		define({
			id: "sr.readYaml",
			description: "Read a YAML file.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative .yaml or .yml file path",
			},
			execute: async (args = {}) => {
				let target = await resolveYamlTarget(args, { defaultRoot: "current_or_last_project" });
				let content = await reviewer._readFileText(target.absolutePath);
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "yaml",
					content,
				};
			},
		});

		define({
			id: "sr.writeYaml",
			description: "Write a YAML file.",
			inputShape: {
				root: "current_or_last_project | current_project | last_project | storage_root",
				path: "relative .yaml or .yml file path",
				content: "string",
			},
			execute: async (args = {}) => {
				let target = await resolveYamlTarget(args, { defaultRoot: "current_or_last_project", requireExisting: false });
				let nextContent = coerceTextContent(args.content ?? args.contents);
				let previousContent = (await reviewer._pathExists(target.absolutePath))
					? await reviewer._readFileText(target.absolutePath)
					: null;
				await reviewer._writeTextFile(target.absolutePath, nextContent);
				await recordFileRevision(target.scope, target.relativePath, previousContent, nextContent, {
					action: "writeYaml",
					details: {},
				});
				return {
					ok: true,
					root: serializeScope(target.scope),
					path: target.relativePath,
					absolutePath: target.absolutePath,
					format: "yaml",
					contentHash: simpleHash(nextContent),
					size: nextContent.length,
					changed: previousContent !== nextContent,
				};
			},
		});

		return registry;
	}

	function PingEndpoint() {}
	PingEndpoint.prototype = {
		supportedMethods: ["GET"],
		supportedDataTypes: "*",
		init(_request) {
			return jsonResponse(200, {
				ok: true,
				namespace: reviewer?.namespace || "systematic-reviewer",
				version: reviewer?.version || null,
				serverPort: getServerPort(),
				endpoints: {
					ping: `${ENDPOINT_PREFIX}/ping`,
					tools: `${ENDPOINT_PREFIX}/tools`,
					call: `${ENDPOINT_PREFIX}/tools/call`,
				},
				toolCount: listTools({ surface: SURFACE_DEV }).length,
			});
		},
	};

	function ToolsListEndpoint() {}
	ToolsListEndpoint.prototype = {
		supportedMethods: ["GET"],
		supportedDataTypes: "*",
		init(_request) {
			return jsonResponse(200, {
				ok: true,
				serverPort: getServerPort(),
				tools: listTools({ surface: SURFACE_DEV }),
				responses_catalog: currentResponsesCatalog({ surface: SURFACE_DEV }),
			});
		},
	};

	function ToolCallEndpoint() {}
	ToolCallEndpoint.prototype = {
		supportedMethods: ["POST"],
		supportedDataTypes: ["application/json"],
		async init(options) {
			try {
				let toolID = String(options?.data?.tool || options?.data?.toolId || "").trim();
				if (!toolID) {
					return jsonResponse(400, {
						ok: false,
						error: "Request body must include a tool field.",
					});
				}
				let rawArgs = options?.data?.args;
				if (rawArgs === undefined && options?.data && Object.prototype.hasOwnProperty.call(options.data, "arguments")) {
					rawArgs = options.data.arguments;
				}
				let args = {};
				if (typeof rawArgs == "string") {
					try {
						args = JSON.parse(rawArgs);
					}
					catch (_err) {
						return jsonResponse(400, {
							ok: false,
							error: "Tool arguments must be valid JSON.",
						});
					}
				}
				else if (rawArgs && typeof rawArgs == "object") {
					args = rawArgs;
				}
				let result = await callTool(toolID, args, { surface: SURFACE_DEV });
				return jsonResponse(200, {
					ok: true,
					tool: toolID,
					result,
				});
			}
			catch (error) {
				return jsonResponse(400, {
					ok: false,
					error: error?.message || String(error),
				});
			}
		},
	};

	function jsonResponse(status, payload) {
		return [status, "application/json", `${JSON.stringify(payload, null, 2)}\n`];
	}

	async function resolveTextFileTarget(args = {}, options = {}) {
		let scope = await resolveRoot(args, options);
		let relativePath = normalizeRelativePath(args.path || args.relativePath || "", { allowEmpty: false });
		assertSupportedTextPath(relativePath);
		let absolutePath = joinRelativePath(scope.rootPath, relativePath);
		let file = reviewer._nsIFile(absolutePath);
		if (options.requireExisting !== false && !file.exists()) {
			throw new Error(`File does not exist: ${relativePath}`);
		}
		if (file.exists() && file.isDirectory()) {
			throw new Error(`Path is a directory: ${relativePath}`);
		}
		return {
			scope,
			relativePath,
			absolutePath,
		};
	}

	async function resolveMarkdownTarget(args = {}, options = {}) {
		let target = await resolveTextFileTarget(args, options);
		let extension = extensionForPath(target.relativePath);
		if (![".md", ".markdown", ".txt"].includes(extension)) {
			throw new Error(`Markdown tools require a .md, .markdown, or .txt path, received: ${target.relativePath}`);
		}
		return target;
	}

	async function resolveJsonTarget(args = {}, options = {}) {
		let target = await resolveTextFileTarget(args, options);
		if (extensionForPath(target.relativePath) != ".json") {
			throw new Error(`JSON tools require a .json path, received: ${target.relativePath}`);
		}
		return target;
	}

	async function resolveYamlTarget(args = {}, options = {}) {
		let target = await resolveTextFileTarget(args, options);
		let extension = extensionForPath(target.relativePath);
		if (![".yaml", ".yml"].includes(extension)) {
			throw new Error(`YAML tools require a .yaml or .yml path, received: ${target.relativePath}`);
		}
		return target;
	}

	async function resolveRoot(args = {}, options = {}) {
		let requestedRoot = String(args.root || args.scope || options.defaultRoot || "current_or_last_project").trim() || "current_or_last_project";
		if (requestedRoot == "project") {
			requestedRoot = "current_project";
		}

		if (requestedRoot == "storage_root") {
			return {
				rootKind: "storage_root",
				rootPath: reviewer._storageRoot(),
				projectContext: null,
			};
		}

		let toolContext = args?.__sr_tool_context && typeof args.__sr_tool_context == "object"
			? args.__sr_tool_context
			: null;
		let explicitProjectContext = buildProjectContext(
			options?.projectContext
			|| options?.project_context
			|| toolContext?.project_context
			|| null
		);
		if (!explicitProjectContext) {
			let explicitProjectID = String(
				options?.projectID
				|| options?.project_id
				|| toolContext?.project_id
				|| args?.project_id
				|| args?.projectID
				|| ""
			).trim();
			if (explicitProjectID) {
				let explicitSessionID = String(
					options?.sessionID
					|| options?.session_id
					|| toolContext?.session_id
					|| args?.session_id
					|| args?.sessionID
					|| ""
				).trim();
				let explicitRuntime = await reviewer._resolveProjectByID(explicitProjectID, {
					sessionID: explicitSessionID,
				});
				if (!explicitRuntime) {
					throw new Error(`Project ${explicitProjectID} is not available in Zotero.`);
				}
				explicitProjectContext = buildProjectContext(Object.assign({}, explicitRuntime.context, {
					sessionID: explicitSessionID || explicitRuntime.sessionID || "",
					projectType: explicitRuntime.projectType || explicitRuntime.context?.projectType || "",
				}));
			}
		}
		let currentProject = explicitProjectContext || buildProjectContext(reviewer.currentProject);
		let lastProject = buildProjectContext((await reviewer._globalSettings()).last_project);
		let projectContext = null;

		if (requestedRoot == "current_project") {
			projectContext = currentProject;
		}
		else if (requestedRoot == "last_project") {
			projectContext = explicitProjectContext || lastProject;
		}
		else if (requestedRoot == "current_or_last_project") {
			projectContext = currentProject || lastProject;
		}
		else {
			throw new Error(`Unsupported root: ${requestedRoot}`);
		}

		if (!projectContext) {
			throw new Error("No collection project is available yet. Open a project first or use root=storage_root.");
		}

		return {
			rootKind: requestedRoot,
			rootPath: projectContext.projectRoot,
			projectContext,
		};
	}

	async function resolveProjectRuntime(args = {}, options = {}) {
		let scope = await resolveRoot(args, options);
		if (!scope.projectContext) {
			throw new Error("A collection project is required for this tool.");
		}
		let runtime = await reviewer._resolveProjectReference(scope.projectContext);
		if (!runtime) {
			throw new Error("The resolved collection project is not available. Open it in Zotero first.");
		}
		return {
			scope,
			runtime,
		};
	}

	function buildProjectContext(raw) {
		if (!raw || typeof raw != "object") {
			return null;
		}
		let projectID = String(raw.projectID || raw.project_id || "").trim();
		if (!projectID) {
			return null;
		}
		let projectRoot = String(
			raw.projectRoot ||
			raw.project_root ||
			reviewer._joinPath(reviewer._projectsRoot(), projectID)
		).trim();
		let libraryID = Number(raw.libraryID ?? raw.library_id ?? 0) || 0;
		let collectionKey = String(raw.collectionKey || raw.collection_key || "").trim();
		let collectionName = String(raw.collectionName || raw.collection_name || "").trim();
			return {
				projectID,
				libraryID,
				collectionKey,
				collectionName,
				projectRoot,
				databasePath: String(raw.databasePath || raw.database_path || reviewer._joinPath(projectRoot, SQLITE_FILENAME)),
				reportPath: String(raw.reportPath || raw.report_path || reviewer._joinPath(projectRoot, "REPORT.md")),
				logPath: String(raw.logPath || raw.log_path || reviewer._joinPath(projectRoot, "log.txt")),
				settingsPath: String(raw.settingsPath || raw.settings_path || reviewer._joinPath(projectRoot, "settings.json")),
				manifestPath: String(raw.manifestPath || raw.manifest_path || reviewer._joinPath(projectRoot, "project.json")),
				projectItemKey: String(raw.projectItemKey || raw.project_item_key || "").trim(),
				sessionID: String(raw.sessionID || raw.session_id || raw.last_session_id || "default"),
				projectType: String(raw.projectType || raw.project_type || "").trim(),
			};
	}

	function serializeProjectContext(context) {
		if (!context) {
			return null;
		}
			return {
				projectID: context.projectID,
				libraryID: context.libraryID,
				collectionKey: context.collectionKey,
				collectionName: context.collectionName,
				projectRoot: context.projectRoot,
				databasePath: context.databasePath,
				reportPath: context.reportPath,
				logPath: context.logPath || "",
				settingsPath: context.settingsPath,
				manifestPath: context.manifestPath,
				projectItemKey: context.projectItemKey || "",
				sessionID: context.sessionID,
				projectType: context.projectType || "",
			};
	}

	async function serializeCollection(collection) {
		if (!collection) {
			return null;
		}
		let context = reviewer._collectionProjectContext(collection);
		let project = reviewer._storedProjectMetadata ? await reviewer._storedProjectMetadata(context) : null;
		let projectID = String(project?.settings?.project_id || project?.manifest?.project_id || context?.projectID || "").trim();
		let hasProject = reviewer._collectionHasStoredProject
			? await reviewer._collectionHasStoredProject(collection)
			: false;
		return {
			library_id: collection.libraryID || 0,
			collection_id: collection.id || 0,
			collection_key: String(collection.key || ""),
			name: String(collection.name || ""),
			parent_collection_key: collection.parentKey || "",
			project_id: projectID,
			project_type: project?.projectType || "",
			has_project: hasProject,
		};
	}

	async function listCollections({ libraryID = 0, includeSubcollections = false } = {}) {
		let libraries = libraryID
			? [Zotero.Libraries.get(Number(libraryID) || 0)].filter(Boolean)
			: (Zotero.Libraries.getAll?.() || []).filter((library) => library && !library.isFeed);
		let out = [];
		for (let library of libraries) {
			let collections = includeSubcollections
				? (Zotero.Collections.getByLibrary(library.libraryID, true) || [])
				: (Zotero.Collections.getByLibrary(library.libraryID, false) || []);
			for (let collection of collections) {
				if (!collection) {
					continue;
				}
				out.push(Object.assign({
					library_name: String(library.name || ""),
					library_type: String(library.libraryType || ""),
				}, await serializeCollection(collection)));
			}
		}
		return out.sort((left, right) =>
			String(left.library_name || "").localeCompare(String(right.library_name || ""))
			|| String(left.name || "").localeCompare(String(right.name || ""))
			|| String(left.collection_key || "").localeCompare(String(right.collection_key || ""))
		);
	}

	function serializeScope(scope) {
		return {
			rootKind: scope.rootKind,
			rootPath: scope.rootPath,
			project: serializeProjectContext(scope.projectContext),
		};
	}

	function normalizeRelativePath(input, options = {}) {
		let raw = String(input || "").trim();
		if (!raw) {
			if (options.allowEmpty) {
				return "";
			}
			throw new Error("A relative path is required.");
		}
		if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
			throw new Error("Only relative paths are allowed.");
		}
		let normalized = raw.replaceAll("\\", "/");
		let segments = normalized.split("/").filter(Boolean);
		if (!segments.length && options.allowEmpty) {
			return "";
		}
		for (let segment of segments) {
			if (segment == "." || segment == "..") {
				throw new Error("Path traversal is not allowed.");
			}
		}
		return segments.join("/");
	}

	function joinRelativePath(rootPath, relativePath) {
		if (!relativePath) {
			return rootPath;
		}
		return reviewer._joinPath(rootPath, relativePath);
	}

	function extensionForPath(path) {
		let fileName = String(path || "").toLowerCase();
		let index = fileName.lastIndexOf(".");
		return index >= 0 ? fileName.slice(index) : "";
	}

	function detectTextFormat(path) {
		let extension = extensionForPath(path);
		if (extension == ".md" || extension == ".markdown") {
			return "markdown";
		}
		if (extension == ".yaml" || extension == ".yml") {
			return "yaml";
		}
		if (extension == ".json") {
			return "json";
		}
		if (extension == ".csv") {
			return "csv";
		}
		if (extension == ".tsv") {
			return "tsv";
		}
		return "text";
	}

	function assertSupportedTextPath(relativePath) {
		let extension = extensionForPath(relativePath);
		if (!TEXT_EXTENSIONS.has(extension)) {
			throw new Error(`Unsupported file type for agent text tools: ${relativePath}`);
		}
	}

	function validateStructuredText(relativePath, content) {
		if (extensionForPath(relativePath) == ".json") {
			JSON.parse(content);
		}
	}

	function coerceTextContent(value) {
		if (typeof value == "string") {
			return value;
		}
		if (value === null || value === undefined) {
			throw new Error("A string content payload is required.");
		}
		return String(value);
	}

	function normalizeOperations(args = {}) {
		let operations = Array.isArray(args.operations)
			? args.operations
			: (args.operation ? [args.operation] : []);
		if (!operations.length) {
			throw new Error("At least one patch operation is required.");
		}
		return operations.map((operation) => {
			if (!operation || typeof operation != "object") {
				throw new Error("Patch operations must be objects.");
			}
			let type = String(operation.type || "").trim();
			if (!type) {
				throw new Error("Each patch operation requires a type.");
			}
			return Object.assign({}, operation, { type });
		});
	}

	function truthyFlag(value) {
		if (typeof value == "boolean") {
			return value;
		}
		let normalized = String(value || "").trim().toLowerCase();
		return ["1", "true", "yes", "on"].includes(normalized);
	}

	function normalizeBoundedInteger(value, fallback, min, max) {
		let number = Number.parseInt(String(value ?? ""), 10);
		if (!Number.isFinite(number)) {
			number = Number(fallback);
		}
		if (!Number.isFinite(number)) {
			number = Number(min);
		}
		return Math.max(Number(min), Math.min(Number(max), Math.round(number)));
	}

	function compactSearchSnippet(line = "", column = 1, maxChars = 260) {
		let text = String(line || "").replace(/\s+/g, " ").trim();
		if (text.length <= maxChars) {
			return text;
		}
		let zeroColumn = Math.max(0, Number(column || 1) - 1);
		let windowStart = Math.max(0, zeroColumn - Math.floor(maxChars / 3));
		let windowEnd = Math.min(text.length, windowStart + maxChars);
		if (windowEnd - windowStart < maxChars) {
			windowStart = Math.max(0, windowEnd - maxChars);
		}
		let prefix = windowStart > 0 ? "..." : "";
		let suffix = windowEnd < text.length ? "..." : "";
		return `${prefix}${text.slice(windowStart, windowEnd).trim()}${suffix}`;
	}

	function searchTextLines(contents = "", query = "", options = {}) {
		let lines = String(contents || "").split(/\r\n|\n|\r/);
		let maxResults = normalizeBoundedInteger(options.maxResults, 20, 1, 50);
		let beforeLines = normalizeBoundedInteger(options.beforeLines, 0, 0, 3);
		let afterLines = normalizeBoundedInteger(options.afterLines, 0, 0, 3);
		let caseSensitive = !!options.caseSensitive;
		let regex = !!options.regex;
		let matcher = null;
		let literalNeedle = "";
		if (regex) {
			let flags = caseSensitive ? "" : "i";
			try {
				matcher = new RegExp(String(query || ""), flags);
			}
			catch (error) {
				throw new Error(`Invalid regular expression for workspace__search_file: ${error?.message || String(error)}`);
			}
		}
		else {
			literalNeedle = caseSensitive ? String(query || "") : String(query || "").toLowerCase();
		}
		let matches = [];
		let matchCount = 0;
		for (let index = 0; index < lines.length; index += 1) {
			let line = String(lines[index] || "");
			let column = 0;
			if (regex) {
				let match = line.match(matcher);
				if (!match) {
					continue;
				}
				column = Number(match.index || 0) + 1;
			}
			else {
				let haystack = caseSensitive ? line : line.toLowerCase();
				let found = haystack.indexOf(literalNeedle);
				if (found < 0) {
					continue;
				}
				column = found + 1;
			}
			matchCount += 1;
			if (matches.length >= maxResults) {
				continue;
			}
			let before = [];
			for (let beforeIndex = Math.max(0, index - beforeLines); beforeIndex < index; beforeIndex += 1) {
				before.push({
					line: beforeIndex + 1,
					text: compactSearchSnippet(lines[beforeIndex], 1, 220),
				});
			}
			let after = [];
			for (let afterIndex = index + 1; afterIndex <= Math.min(lines.length - 1, index + afterLines); afterIndex += 1) {
				after.push({
					line: afterIndex + 1,
					text: compactSearchSnippet(lines[afterIndex], 1, 220),
				});
			}
			matches.push({
				line: index + 1,
				column,
				text: compactSearchSnippet(line, column, 320),
				before,
				after,
			});
		}
		return {
			matchCount,
			matches,
			truncated: matchCount > matches.length,
		};
	}

	function buildTextReadSelection(contents, args = {}) {
		let hasSelection = [
			"start_line",
			"startLine",
			"end_line",
			"endLine",
			"max_lines",
			"maxLines",
			"limit",
		].some((key) => Object.prototype.hasOwnProperty.call(args || {}, key));
		if (!hasSelection) {
			return null;
		}
		return TEXT_FILE_TOOLS.sliceTextByLines(contents, {
			startLine: args.start_line ?? args.startLine,
			endLine: args.end_line ?? args.endLine,
			maxLines: args.max_lines ?? args.maxLines ?? args.limit,
		});
	}

	function buildLineNumberedContent(contents, startLine, endLine) {
		return TEXT_FILE_TOOLS.sliceTextByLines(contents, { startLine, endLine }).lineNumberedContent;
	}

	function readMarkdownSelection(markdown, args = {}) {
		return TEXT_FILE_TOOLS.readMarkdownRange(markdown, {
			heading: args.heading,
			headingPath: args.headingPath ?? args.heading_path,
			toHeading: args.toHeading ?? args.to_heading,
			toHeadingPath: args.toHeadingPath ?? args.to_heading_path,
			includeHeading: args.includeHeading ?? args.include_heading,
			includeEndHeading: args.includeEndHeading ?? args.include_end_heading,
			occurrence: args.occurrence,
			level: args.level,
			toOccurrence: args.toOccurrence ?? args.to_occurrence,
			toLevel: args.toLevel ?? args.to_level,
		});
	}

	function parseStructuredPatch(patchText) {
		if (typeof TEXT_FILE_TOOLS.parseStructuredPatch != "function") {
			throw new Error("Structured patch support is not available.");
		}
		return TEXT_FILE_TOOLS.parseStructuredPatch(patchText);
	}

	async function prepareStructuredPatchChange(scope, hunk) {
		let relativePath = normalizeRelativePath(hunk.path || "", { allowEmpty: false });
		assertSupportedTextPath(relativePath);
		let absolutePath = joinRelativePath(scope.rootPath, relativePath);
		let file = reviewer._nsIFile(absolutePath);
		if (hunk.type == "add") {
			if (file.exists()) {
				throw new Error(`Cannot add a file that already exists: ${relativePath}`);
			}
			let nextContent = coerceTextContent(hunk.content);
			validateStructuredText(relativePath, nextContent);
			return {
				type: "add",
				relativePath,
				absolutePath,
				targetRelativePath: relativePath,
				targetAbsolutePath: absolutePath,
				original: null,
				nextContent,
			};
		}
		if (!file.exists()) {
			throw new Error(`File does not exist: ${relativePath}`);
		}
		if (file.isDirectory()) {
			throw new Error(`Path is a directory: ${relativePath}`);
		}
		let original = await reviewer._readFileText(absolutePath);
		if (hunk.type == "delete") {
			return {
				type: "delete",
				relativePath,
				absolutePath,
				targetRelativePath: relativePath,
				targetAbsolutePath: absolutePath,
				original,
				nextContent: null,
			};
		}
		let derived = TEXT_FILE_TOOLS.deriveUpdatedTextFromChunks(
			original,
			relativePath,
			Array.isArray(hunk.chunks) ? hunk.chunks : []
		);
		let targetRelativePath = relativePath;
		let targetAbsolutePath = absolutePath;
		if (hunk.movePath) {
			targetRelativePath = normalizeRelativePath(hunk.movePath, { allowEmpty: false });
			assertSupportedTextPath(targetRelativePath);
			targetAbsolutePath = joinRelativePath(scope.rootPath, targetRelativePath);
			if (targetRelativePath != relativePath && reviewer._pathExists(targetAbsolutePath)) {
				throw new Error(`Cannot move onto an existing file: ${targetRelativePath}`);
			}
		}
		let nextContent = TEXT_FILE_TOOLS.restoreLineEndings(
			derived.content,
			TEXT_FILE_TOOLS.detectLineEnding(original)
		);
		validateStructuredText(targetRelativePath, nextContent);
		return {
			type: targetRelativePath != relativePath ? "move" : "update",
			relativePath,
			absolutePath,
			targetRelativePath,
			targetAbsolutePath,
			original,
			nextContent,
		};
	}

	async function applyStructuredPatchChange(scope, change) {
		if (change.type == "add") {
			await reviewer._writeTextFile(change.targetAbsolutePath, change.nextContent);
			await recordFileRevision(scope, change.targetRelativePath, null, change.nextContent, {
				action: "applyPatch",
				details: { type: "add" },
			});
			return {
				type: "add",
				path: change.targetRelativePath,
				absolutePath: change.targetAbsolutePath,
				format: detectTextFormat(change.targetRelativePath),
				contentHash: simpleHash(change.nextContent),
				size: change.nextContent.length,
			};
		}
		if (change.type == "delete") {
			await reviewer._removeIfExists(change.absolutePath);
			await recordFileRevision(scope, change.relativePath, change.original, null, {
				action: "applyPatch",
				details: { type: "delete" },
			});
			return {
				type: "delete",
				path: change.relativePath,
				absolutePath: change.absolutePath,
				format: detectTextFormat(change.relativePath),
				contentHash: null,
				size: 0,
			};
		}
		if (change.type == "move") {
			await reviewer._writeTextFile(change.targetAbsolutePath, change.nextContent);
			await reviewer._removeIfExists(change.absolutePath);
			await recordFileRevision(scope, change.relativePath, change.original, null, {
				action: "applyPatch",
				details: {
					type: "move_from",
					toPath: change.targetRelativePath,
				},
			});
			await recordFileRevision(scope, change.targetRelativePath, null, change.nextContent, {
				action: "applyPatch",
				details: {
					type: "move_to",
					fromPath: change.relativePath,
				},
			});
			return {
				type: "move",
				path: change.targetRelativePath,
				fromPath: change.relativePath,
				absolutePath: change.targetAbsolutePath,
				format: detectTextFormat(change.targetRelativePath),
				contentHash: simpleHash(change.nextContent),
				size: change.nextContent.length,
			};
		}
		await reviewer._writeTextFile(change.absolutePath, change.nextContent);
		await recordFileRevision(scope, change.relativePath, change.original, change.nextContent, {
			action: "applyPatch",
			details: { type: "update" },
		});
		return {
			type: "update",
			path: change.relativePath,
			absolutePath: change.absolutePath,
			format: detectTextFormat(change.relativePath),
			contentHash: simpleHash(change.nextContent),
			size: change.nextContent.length,
			changed: change.original !== change.nextContent,
		};
	}

	function applyTextOperation(text, operation) {
		switch (operation.type) {
			case "append":
				return applyAppendOperation(text, operation);
			case "prepend":
				return applyPrependOperation(text, operation);
			case "replace":
				return applyReplaceOperation(text, operation);
			case "insert_before":
				return applyInsertOperation(text, operation, false);
			case "insert_after":
				return applyInsertOperation(text, operation, true);
			case "replace_lines":
				return applyReplaceLinesOperation(text, operation);
			case "delete_lines":
				return applyDeleteLinesOperation(text, operation);
			case "insert_at_line":
				return applyInsertAtLineOperation(text, operation);
			default:
				throw new Error(`Unsupported text patch operation: ${operation.type}`);
		}
	}

	function decomposeEditableLines(text) {
		let original = String(text || "");
		let normalized = TEXT_FILE_TOOLS.normalizeNewlines(original);
		let parts = TEXT_FILE_TOOLS.decomposeText(normalized);
		return {
			lineEnding: TEXT_FILE_TOOLS.detectLineEnding(original),
			lines: normalized === "" ? [] : parts.lines.slice(),
			hadTrailingNewline: parts.hadTrailingNewline,
		};
	}

	function finalizeEditableLines(state) {
		let normalized = TEXT_FILE_TOOLS.recomposeText(
			state.lines,
			state.lines.length ? state.hadTrailingNewline : false
		);
		return TEXT_FILE_TOOLS.restoreLineEndings(normalized, state.lineEnding);
	}

	function normalizeRequiredLineNumber(value, label) {
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1) {
			throw new Error(`${label} must be a positive integer.`);
		}
		return parsed;
	}

	function normalizeExistingLineRange(operation, totalLines) {
		if (!totalLines) {
			throw new Error(`${operation.type} requires a non-empty file.`);
		}
		let startLine = normalizeRequiredLineNumber(operation.startLine ?? operation.start_line ?? operation.line, "startLine");
		let endLine = normalizeRequiredLineNumber(operation.endLine ?? operation.end_line ?? operation.line ?? startLine, "endLine");
		if (startLine > totalLines || endLine > totalLines) {
			throw new Error(`${operation.type} line range ${startLine}-${endLine} is outside the file.`);
		}
		if (endLine < startLine) {
			throw new Error(`${operation.type} endLine must be greater than or equal to startLine.`);
		}
		return { startLine, endLine };
	}

	function applyAppendOperation(text, operation) {
		let addition = coerceTextContent(operation.text ?? operation.content);
		return {
			text: `${text}${addition}`,
			summary: {
				type: "append",
				appendedLength: addition.length,
			},
		};
	}

	function applyPrependOperation(text, operation) {
		let addition = coerceTextContent(operation.text ?? operation.content);
		return {
			text: `${addition}${text}`,
			summary: {
				type: "prepend",
				prependedLength: addition.length,
			},
		};
	}

	function applyReplaceOperation(text, operation) {
		let needle = coerceTextContent(operation.find ?? operation.match ?? operation.oldText);
		if (!needle.length) {
			throw new Error("replace operations require a non-empty find string.");
		}
		let replacement = coerceTextContent(operation.replace ?? operation.newText ?? "");
		let all = !!operation.all;
		let count = countOccurrences(text, needle);
		if (!count) {
			throw new Error(`replace target not found: ${needle}`);
		}
		let expectedCount = normalizeExpectedCount(operation.expectedCount);
		if (expectedCount !== null && count != expectedCount) {
			throw new Error(`replace expected ${expectedCount} matches but found ${count}.`);
		}
		let nextText;
		if (all) {
			nextText = text.split(needle).join(replacement);
		}
		else {
			let index = text.indexOf(needle);
			nextText = `${text.slice(0, index)}${replacement}${text.slice(index + needle.length)}`;
			count = 1;
		}
		return {
			text: nextText,
			summary: {
				type: "replace",
				matchCount: count,
			},
		};
	}

	function applyInsertOperation(text, operation, after) {
		let needle = coerceTextContent(operation.find ?? operation.match ?? operation.anchor);
		if (!needle.length) {
			throw new Error(`${operation.type} operations require a non-empty find string.`);
		}
		let insertion = coerceTextContent(operation.text ?? operation.content);
		let all = !!operation.all;
		let count = countOccurrences(text, needle);
		if (!count) {
			throw new Error(`${operation.type} target not found: ${needle}`);
		}
		let expectedCount = normalizeExpectedCount(operation.expectedCount);
		if (expectedCount !== null && count != expectedCount) {
			throw new Error(`${operation.type} expected ${expectedCount} matches but found ${count}.`);
		}
		let nextText;
		if (all) {
			nextText = after
				? text.split(needle).join(`${needle}${insertion}`)
				: text.split(needle).join(`${insertion}${needle}`);
		}
		else {
			let index = text.indexOf(needle);
			let insertionPoint = after ? index + needle.length : index;
			nextText = `${text.slice(0, insertionPoint)}${insertion}${text.slice(insertionPoint)}`;
			count = 1;
		}
		return {
			text: nextText,
			summary: {
				type: operation.type,
				matchCount: count,
			},
		};
	}

	function applyReplaceLinesOperation(text, operation) {
		let state = decomposeEditableLines(text);
		let range = normalizeExistingLineRange(operation, state.lines.length);
		let replacement = TEXT_FILE_TOOLS.decomposeText(
			coerceTextContent(operation.text ?? operation.content ?? "")
		).lines;
		state.lines.splice(range.startLine - 1, range.endLine - range.startLine + 1, ...replacement);
		return {
			text: finalizeEditableLines(state),
			summary: {
				type: "replace_lines",
				startLine: range.startLine,
				endLine: range.endLine,
				insertedLineCount: replacement.length,
			},
		};
	}

	function applyDeleteLinesOperation(text, operation) {
		let state = decomposeEditableLines(text);
		let range = normalizeExistingLineRange(operation, state.lines.length);
		state.lines.splice(range.startLine - 1, range.endLine - range.startLine + 1);
		return {
			text: finalizeEditableLines(state),
			summary: {
				type: "delete_lines",
				startLine: range.startLine,
				endLine: range.endLine,
				deletedLineCount: range.endLine - range.startLine + 1,
			},
		};
	}

	function applyInsertAtLineOperation(text, operation) {
		let state = decomposeEditableLines(text);
		let line = normalizeRequiredLineNumber(operation.line, "line");
		let position = String(operation.position || "before").trim().toLowerCase();
		if (!["before", "after"].includes(position)) {
			throw new Error(`insert_at_line position must be 'before' or 'after'. Received: ${operation.position}`);
		}
		let maxLine = state.lines.length + 1;
		if (line > maxLine) {
			throw new Error(`insert_at_line line ${line} is outside the file.`);
		}
		if (position == "after" && line == maxLine) {
			throw new Error("insert_at_line cannot insert after the virtual line beyond the end of the file.");
		}
		let insertion = TEXT_FILE_TOOLS.decomposeText(
			coerceTextContent(operation.text ?? operation.content)
		).lines;
		let insertionIndex = position == "after" ? line : Math.max(0, line - 1);
		state.lines.splice(insertionIndex, 0, ...insertion);
		return {
			text: finalizeEditableLines(state),
			summary: {
				type: "insert_at_line",
				line,
				position,
				insertedLineCount: insertion.length,
			},
		};
	}

	function isMarkdownSectionOperation(type) {
		return [
			"replace_section",
			"replace_section_body",
			"append_section",
			"prepend_section",
			"delete_section",
		].includes(String(type || ""));
	}

	function applyMarkdownOperation(markdown, operation) {
		switch (operation.type) {
			case "replace_section":
				return applyMarkdownSectionOperation(markdown, operation);
			case "replace_section_body":
				return applyMarkdownSectionBodyOperation(markdown, operation);
			case "append_section":
				return applyMarkdownSectionAppendOperation(markdown, operation);
			case "prepend_section":
				return applyMarkdownSectionPrependOperation(markdown, operation);
			case "delete_section":
				return applyMarkdownSectionDeleteOperation(markdown, operation);
			default:
				throw new Error(`Unsupported markdown patch operation: ${operation.type}`);
		}
	}

	function applyMarkdownSectionOperation(markdown, operation) {
		let section = findMarkdownSection(markdown, operation);
		let headingPath = section?.heading?.path || normalizeHeadingPath(operation.headingPath || operation.heading);
		if (!headingPath.length) {
			throw new Error("replace_section requires a heading or headingPath.");
		}
		let includeHeading = !!operation.includeHeading;
		let level = normalizeMarkdownLevel(operation.level, headingPath.length || 2);
		let rawContent = coerceTextContent(operation.content ?? operation.body ?? "");
		if (section && !includeHeading) {
			rawContent = preserveSystematicReviewerBlocks(rawContent, section.body);
		}
		let replacementText = buildMarkdownSectionText(section, headingPath, rawContent, {
			includeHeading,
			level,
		});
		if (section) {
			let nextMarkdown = `${markdown.slice(0, section.startOffset)}${replacementText}${markdown.slice(section.endOffset)}`;
			return {
				text: normalizeMarkdownDocument(nextMarkdown),
				summary: {
					type: "replace_section",
					headingPath,
					created: false,
				},
			};
		}
		if (operation.create === false) {
			throw new Error(`Markdown section not found: ${headingPath.join(" > ")}`);
		}
		let separator = markdown.trimEnd() ? "\n\n" : "";
		let nextMarkdown = `${markdown.trimEnd()}${separator}${replacementText}`;
		return {
			text: normalizeMarkdownDocument(nextMarkdown),
			summary: {
				type: "replace_section",
				headingPath,
				created: true,
			},
		};
	}

	function applyMarkdownSectionBodyOperation(markdown, operation) {
		let section = requireMarkdownSection(markdown, operation, "replace_section_body");
		let rawContent = preserveSystematicReviewerBlocks(
			coerceTextContent(operation.content ?? operation.body ?? ""),
			section.body
		);
		let replacementText = buildMarkdownSectionText(section, section.heading.path, rawContent, {
			includeHeading: false,
			level: section.heading.level,
		});
		return {
			text: normalizeMarkdownDocument(
				`${markdown.slice(0, section.startOffset)}${replacementText}${markdown.slice(section.endOffset)}`
			),
			summary: {
				type: "replace_section_body",
				headingPath: section.heading.path,
			},
		};
	}

	function applyMarkdownSectionAppendOperation(markdown, operation) {
		let section = requireMarkdownSection(markdown, operation, "append_section");
		let addition = normalizeMarkdownBodyText(operation.content ?? operation.text ?? operation.body);
		let nextBody = [normalizeMarkdownBodyText(section.body), addition].filter(Boolean).join("\n\n");
		let replacementText = buildMarkdownSectionText(section, section.heading.path, nextBody, {
			includeHeading: false,
			level: section.heading.level,
		});
		return {
			text: normalizeMarkdownDocument(
				`${markdown.slice(0, section.startOffset)}${replacementText}${markdown.slice(section.endOffset)}`
			),
			summary: {
				type: "append_section",
				headingPath: section.heading.path,
				appendedLength: addition.length,
			},
		};
	}

	function applyMarkdownSectionPrependOperation(markdown, operation) {
		let section = requireMarkdownSection(markdown, operation, "prepend_section");
		let addition = normalizeMarkdownBodyText(operation.content ?? operation.text ?? operation.body);
		let nextBody = [addition, normalizeMarkdownBodyText(section.body)].filter(Boolean).join("\n\n");
		let replacementText = buildMarkdownSectionText(section, section.heading.path, nextBody, {
			includeHeading: false,
			level: section.heading.level,
		});
		return {
			text: normalizeMarkdownDocument(
				`${markdown.slice(0, section.startOffset)}${replacementText}${markdown.slice(section.endOffset)}`
			),
			summary: {
				type: "prepend_section",
				headingPath: section.heading.path,
				prependedLength: addition.length,
			},
		};
	}

	function applyMarkdownSectionDeleteOperation(markdown, operation) {
		let section = requireMarkdownSection(markdown, operation, "delete_section");
		return {
			text: normalizeMarkdownDocument(
				`${markdown.slice(0, section.startOffset)}${markdown.slice(section.endOffset)}`
			),
			summary: {
				type: "delete_section",
				headingPath: section.heading.path,
			},
		};
	}

	function requireMarkdownSection(markdown, operation, label) {
		let section = findMarkdownSection(markdown, operation);
		if (!section) {
			let headingPath = normalizeHeadingPath(operation.headingPath || operation.heading);
			throw new Error(`${label} could not find markdown section: ${headingPath.join(" > ") || "(missing heading)"}`);
		}
		return section;
	}

	function buildMarkdownSectionText(existingSection, headingPath, content, options = {}) {
		let normalizedContent = normalizeMarkdownBodyText(content);
		if (options.includeHeading) {
			return `${normalizedContent}\n`;
		}
		let headingLine = existingSection?.headingLine || `${"#".repeat(options.level || 2)} ${headingPath[headingPath.length - 1]}`;
		if (!normalizedContent) {
			return `${headingLine}\n`;
		}
		return `${headingLine}\n\n${normalizedContent}\n`;
	}

	function extractSystematicReviewerBlocks(content) {
		let text = String(content || "");
		let blockRe = /<!--\s*systematic-reviewer:([a-z0-9-]+):start\s*-->[\s\S]*?<!--\s*systematic-reviewer:\1:end\s*-->/gi;
		let blocks = [];
		let match = null;
		while ((match = blockRe.exec(text))) {
			blocks.push({
				marker: String(match[1] || "").trim().toLowerCase(),
				text: String(match[0] || "").trim(),
			});
		}
		return blocks;
	}

	function preserveSystematicReviewerBlocks(nextContent, existingContent) {
		let nextText = normalizeMarkdownBodyText(nextContent);
		let preserved = [];
		for (let block of extractSystematicReviewerBlocks(existingContent)) {
			if (!block?.marker || !block?.text) {
				continue;
			}
			let startMarker = `<!-- systematic-reviewer:${block.marker}:start -->`;
			if (nextText.includes(startMarker)) {
				continue;
			}
			preserved.push(block.text);
		}
		return [nextText, ...preserved].filter(Boolean).join("\n\n");
	}

	function normalizeMarkdownDocument(markdown) {
		let normalized = String(markdown || "").replace(/\r\n?/g, "\n");
		normalized = normalized.replace(/\n{3,}/g, "\n\n");
		return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
	}

	function normalizeMarkdownBodyText(content) {
		return String(content || "").replace(/\r\n?/g, "\n").trim();
	}

	function extractMarkdownHeadings(markdown) {
		return TEXT_FILE_TOOLS.extractMarkdownHeadings(markdown);
	}

	function findMarkdownSection(markdown, query) {
		return TEXT_FILE_TOOLS.findMarkdownSection(markdown, query);
	}

	function normalizeHeadingPath(input) {
		return TEXT_FILE_TOOLS.normalizeHeadingPath(input);
	}

	function normalizeHeadingLabel(value) {
		return TEXT_FILE_TOOLS.normalizeHeadingLabel(value);
	}

	function normalizeExpectedCount(value) {
		if (value === undefined || value === null || value === "") {
			return null;
		}
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 0) {
			throw new Error(`Invalid expectedCount: ${value}`);
		}
		return parsed;
	}

	function normalizeMarkdownLevel(value, fallback) {
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
			return Math.max(1, Math.min(6, fallback || 2));
		}
		return parsed;
	}

	function normalizeIndent(value) {
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) {
			return 2;
		}
		return parsed;
	}

	function countOccurrences(text, needle) {
		let count = 0;
		let offset = 0;
		while (needle && offset <= text.length) {
			let index = text.indexOf(needle, offset);
			if (index == -1) {
				break;
			}
			count += 1;
			offset = index + needle.length;
		}
		return count;
	}

	function simpleHash(text) {
		let hash = 2166136261;
		let value = String(text || "");
		for (let index = 0; index < value.length; index++) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
	}

	async function recordFileRevision(scope, relativePath, beforeText, afterText, meta = {}) {
		if (!scope?.projectContext) {
			return;
		}
		if (beforeText === afterText) {
			return;
		}
		let db = await reviewer._projectDB(scope.projectContext);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS file_revisions (
				revision_id TEXT PRIMARY KEY,
				relative_path TEXT NOT NULL,
				actor TEXT NOT NULL,
				action TEXT NOT NULL,
				session_id TEXT NOT NULL,
				base_hash TEXT,
				new_hash TEXT,
				details_json TEXT,
				created_at TEXT NOT NULL
			)
		`);
		let revisionID = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		await db.queryAsync(
			`INSERT INTO file_revisions (
				revision_id,
				relative_path,
				actor,
				action,
				session_id,
				base_hash,
				new_hash,
				details_json,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				revisionID,
				relativePath,
				"agent_api",
				String(meta.action || "update"),
				scope.projectContext.sessionID || "default",
				beforeText === null || beforeText === undefined ? null : simpleHash(beforeText),
				afterText === null || afterText === undefined ? null : simpleHash(afterText),
				JSON.stringify(meta.details || {}),
				new Date().toISOString(),
			]
		);
	}

	function fileInfo(file, relativePath) {
		return {
			name: file.leafName,
			relativePath,
			absolutePath: file.path,
			kind: file.isDirectory() ? "directory" : "file",
			size: file.isDirectory() ? null : file.fileSize,
			modifiedAt: new Date(file.lastModifiedTime).toISOString(),
		};
	}

	function getServerPort() {
		return SystematicReviewerWorkflowServer?.getPort?.() || null;
	}

	return {
		register,
		unregister,
		refreshHTTPEndpoints,
		listTools,
		callTool,
	};
})();
