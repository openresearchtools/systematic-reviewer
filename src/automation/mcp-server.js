var { HttpServer } = ChromeUtils.importESModule("chrome://remote/content/server/httpd.sys.mjs");

	var SystematicReviewerMCPServer = (() => {
	const ENDPOINT_PREFIX = "/systematic-reviewer/mcp";
	const MCP_HOST = "127.0.0.1";
	const MCP_PUBLIC_HOST = "localhost";
	const MCP_PREFERRED_PORT = 23139;
	const DEFAULT_PROTOCOL_VERSION = "2025-11-25";
	const MID_PROTOCOL_VERSION = "2025-06-18";
	const LEGACY_PROTOCOL_VERSION = "2025-03-26";
	const EARLY_PROTOCOL_VERSION = "2024-11-05";
	const SUPPORTED_PROTOCOL_VERSIONS = new Set([
		DEFAULT_PROTOCOL_VERSION,
		MID_PROTOCOL_VERSION,
		LEGACY_PROTOCOL_VERSION,
		EARLY_PROTOCOL_VERSION,
	]);
	const SUPPLEMENTAL_TOOL_DEFINITIONS = Object.freeze([
		{
			name: "sr_project_bind",
			description: "Bind one existing stored project and cache the active project and session inside this MCP session.",
			inputSchema: {
				type: "object",
				properties: {
					project_id: { type: "string" },
					new_session: { type: "boolean" },
					session_id: { type: "string" },
					title: { type: "string" },
					objective: { type: "string" },
				},
			},
		},
		{
			name: "sr_project_status",
			description: "Return the current project and session binding for this MCP session.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "sr_scope_list",
			description: "List valid scopes for the bound project.",
			inputSchema: {
				type: "object",
				properties: {
					project_id: { type: "string" },
				},
			},
		},
		{
			name: "sr_jobs_list",
			description: "List jobs for the bound project.",
			inputSchema: {
				type: "object",
				properties: {
					project_id: { type: "string" },
					limit: { type: "number" },
				},
			},
		},
		{
			name: "sr_report_read",
			description: "Read REPORT.md for the bound project directly from the real project workspace.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
	]);

	let reviewer = null;
	let registered = false;
	let server = null;
	let serverPort = 0;
	let enabled = false;
	let apiKey = "";
	let sessions = new Map();
	let internalAutomationSessions = new Map();

	function optionalString(value) {
		return String(value || "").trim();
	}

	function readKnownHeader(request, name = "") {
		let clean = optionalString(name);
		if (!clean || !request?.getHeader) {
			return "";
		}
		try {
			return optionalString(request.getHeader(clean));
		}
		catch (_error) {
			return "";
		}
	}

	function readRequestHeaders(request) {
		let out = {};
		for (let name of [
			"Authorization",
			"Accept",
			"Origin",
			"Content-Type",
			"Content-Length",
			"MCP-Session-Id",
			"MCP-Protocol-Version",
		]) {
			let value = readKnownHeader(request, name);
			if (value) {
				out[name] = value;
			}
		}
		return out;
	}

	function readRequestBody(request) {
		let length = 0;
		try {
			length = Number(request.getHeader("Content-Length") || 0) || 0;
		}
		catch (_error) {
			length = 0;
		}
		if (!length) {
			return "";
		}
		let scriptable = Components.classes["@mozilla.org/scriptableinputstream;1"]
			.createInstance(Components.interfaces.nsIScriptableInputStream);
		scriptable.init(request.bodyInputStream);
		try {
			return scriptable.read(length) || "";
		}
		finally {
			try {
				scriptable.close();
			}
			catch (_error) {}
		}
	}

	function bearerToken(request) {
		let raw = readKnownHeader(request, "Authorization");
		let match = raw.match(/^Bearer\s+(.+)$/i);
		return optionalString(match?.[1] || "");
	}

	function bindLoopback(httpServer, preferredPort = MCP_PREFERRED_PORT) {
		try {
			httpServer.start(preferredPort);
		}
		catch (_error) {
			httpServer.start(-1);
		}
	}

	function statusText(status = 200) {
		let known = {
			200: "OK",
			202: "Accepted",
			204: "No Content",
			400: "Bad Request",
			401: "Unauthorized",
			403: "Forbidden",
			404: "Not Found",
			405: "Method Not Allowed",
			500: "Internal Server Error",
		};
		return known[Number(status) || 200] || "OK";
	}

	function corsResponseHeaders(request = null) {
		let origin = readKnownHeader(request, "Origin");
		let allowOrigin = allowedOrigin(origin) && origin ? origin : "*";
		return {
			"Access-Control-Allow-Origin": allowOrigin,
			"Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Requested-With, MCP-Protocol-Version, MCP-Session-Id",
			"Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
		};
	}

	function writeHTTPResponse(response, request, status = 200, headers = {}, body = "") {
		response.setStatusLine(request?.httpVersion || "1.1", status, statusText(status));
		let finalHeaders = Object.assign({}, corsResponseHeaders(request), headers || {});
		for (let [name, value] of Object.entries(finalHeaders || {})) {
			if (value !== undefined && value !== null && value !== "") {
				response.setHeader(name, String(value), false);
			}
		}
		let writer = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
			.createInstance(Components.interfaces.nsIConverterOutputStream);
		writer.init(
			response.bodyOutputStream,
			"UTF-8",
			0,
			Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER
		);
		writer.writeString(body === undefined || body === null ? "" : String(body));
	}

	function applyServerSettings(raw = null) {
		let source = raw && typeof raw == "object" ? raw : {};
		enabled = source.mcp_enabled === true;
		apiKey = optionalString(source.mcp_api_key || "");
		if (!registered) {
			return;
		}
		if (enabled) {
			ensureServer();
		}
		else {
			stopServer();
		}
	}

	async function syncFromReviewerSettings() {
		let settings = (await reviewer?._globalSettings?.().catch(() => null)) || {};
		applyServerSettings(settings?.server_security || null);
	}

	function protocolVersionForRequest(requestVersion = "", session = null) {
		let raw = optionalString(requestVersion || session?.protocol_version || "");
		if (!raw) {
			return DEFAULT_PROTOCOL_VERSION;
		}
		if (!SUPPORTED_PROTOCOL_VERSIONS.has(raw)) {
			throw new Error(`Unsupported MCP protocol version: ${raw}`);
		}
		return raw;
	}

	function nextSessionID(prefix = "srmcp") {
		let uuid = String(Services.uuid.generateUUID()).replace(/[{}]/g, "").toLowerCase();
		return `${prefix}-${uuid}`;
	}

	function emptyBinding() {
		return {
			project_id: "",
			session_id: "",
			project_root: "",
			database_path: "",
			report_path: "",
			settings_path: "",
			manifest_path: "",
			collection_name: "",
			collection_key: "",
			project_type: "",
		};
	}

	function canonicalToolCatalog() {
		if (reviewer?.agentTools?.responsesCatalog) {
			return reviewer.agentTools.responsesCatalog({ surface: "mcp" }) || {};
		}
		return {
			top_level: [],
			namespaces: [],
			flattened: [],
		};
	}

	function mcpToolDefinitions() {
		let catalog = canonicalToolCatalog();
		let dynamicTools = [];
		if (catalog?.tool_search?.name) {
			dynamicTools.push({
				name: String(catalog.tool_search.name || "").trim(),
				description: String(catalog.tool_search.description || "").trim(),
				inputSchema: catalog.tool_search.parameters && typeof catalog.tool_search.parameters == "object"
					? catalog.tool_search.parameters
					: {
						type: "object",
						properties: {},
						additionalProperties: false,
					},
			});
		}
		for (let tool of Array.isArray(catalog?.flattened) ? catalog.flattened : []) {
			if (!tool?.name) {
				continue;
			}
			dynamicTools.push({
				name: String(tool.name || "").trim(),
				description: String(tool.full_description || tool.description || "").trim(),
				inputSchema: tool.parameters && typeof tool.parameters == "object"
					? tool.parameters
					: {
						type: "object",
						properties: {},
						additionalProperties: false,
					},
			});
		}
		return SUPPLEMENTAL_TOOL_DEFINITIONS.concat(dynamicTools)
			.filter((entry) => entry?.name)
			.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
	}

	function serializeBinding(binding = {}) {
		return {
			project_id: optionalString(binding.project_id),
			session_id: optionalString(binding.session_id),
			project_root: optionalString(binding.project_root),
			database_path: optionalString(binding.database_path),
			report_path: optionalString(binding.report_path),
			settings_path: optionalString(binding.settings_path),
			manifest_path: optionalString(binding.manifest_path),
			collection_name: optionalString(binding.collection_name),
			collection_key: optionalString(binding.collection_key),
			project_type: optionalString(binding.project_type),
		};
	}

	function createSession(options = {}) {
		let session = {
			session_id: nextSessionID(options.prefix || "srmcp"),
			created_at: new Date().toISOString(),
			initialized: false,
			protocol_version: protocolVersionForRequest(options.protocol_version || ""),
			client_info: null,
			client_capabilities: {},
			binding: emptyBinding(),
			internal: !!options.internal,
		};
		sessions.set(session.session_id, session);
		return session;
	}

	function getSession(sessionID = "") {
		return sessions.get(optionalString(sessionID)) || null;
	}

	function sessionHeaders(session = null, protocolVersion = "", extra = {}) {
		let headers = Object.assign({}, extra || {});
		let resolvedProtocol = protocolVersionForRequest(protocolVersion || "", session);
		headers["MCP-Protocol-Version"] = resolvedProtocol;
		if (session?.session_id) {
			headers["MCP-Session-Id"] = session.session_id;
		}
		return headers;
	}

	function jsonResponse(status, payload, session = null, protocolVersion = "", extraHeaders = {}) {
		let headers = sessionHeaders(session, protocolVersion, Object.assign({
			"Content-Type": "application/json; charset=utf-8",
		}, extraHeaders || {}));
		return [status, headers, `${JSON.stringify(payload, null, 2)}\n`];
	}

	function emptyResponse(status, session = null, protocolVersion = "", extraHeaders = {}) {
		return [status, sessionHeaders(session, protocolVersion, extraHeaders || {}), ""];
	}

	function acceptsEventStream(headers = {}) {
		let raw = optionalString(headers?.accept || headers?.Accept || "");
		return raw.toLowerCase().includes("text/event-stream");
	}

	function sseResponse(status, payload, session = null, protocolVersion = "", extraHeaders = {}) {
		let headers = sessionHeaders(session, protocolVersion, Object.assign({
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"Connection": "keep-alive",
		}, extraHeaders || {}));
		let body = "";
		if (payload !== null && payload !== undefined) {
			body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
		}
		return [status, headers, body];
	}

	function jsonrpcSuccess(id, result) {
		return {
			jsonrpc: "2.0",
			id,
			result,
		};
	}

	function jsonrpcError(id, code, message, data = null) {
		let payload = {
			jsonrpc: "2.0",
			id: id === undefined ? null : id,
			error: {
				code,
				message: optionalString(message) || "Unknown MCP error",
			},
		};
		if (data !== null && data !== undefined) {
			payload.error.data = data;
		}
		return payload;
	}

	function isNotification(message = {}) {
		return message && typeof message == "object"
			&& message.id === undefined
			&& optionalString(message.method);
	}

	function allowedOrigin(origin = "") {
		let raw = optionalString(origin);
		if (!raw) {
			return true;
		}
		if (raw == "null") {
			return true;
		}
		try {
			let url = new URL(raw);
			if (["127.0.0.1", "localhost"].includes(url.hostname)) {
				return true;
			}
			if (["app:", "file:"].includes(url.protocol)) {
				return true;
			}
			return false;
		}
		catch (_error) {
			return false;
		}
	}

	function validateOrigin(headers = {}) {
		let origin = optionalString(headers?.origin || headers?.Origin || "");
		if (!origin) {
			return;
		}
		if (!allowedOrigin(origin)) {
			throw new Error(`Forbidden Origin: ${origin}`);
		}
	}

	function updateBindingFromPayload(session, payload = {}) {
		if (!session) {
			return;
		}
		let project = payload?.project || payload?.turn?.project || null;
		let turnSession = payload?.session || payload?.turn?.session || null;
		if (project && typeof project == "object") {
			session.binding.project_id = optionalString(project.projectID || project.project_id || session.binding.project_id);
			session.binding.project_root = optionalString(project.projectRoot || project.project_root || session.binding.project_root);
			session.binding.database_path = optionalString(project.databasePath || project.database_path || session.binding.database_path);
			session.binding.report_path = optionalString(project.reportPath || project.report_path || session.binding.report_path);
			session.binding.settings_path = optionalString(project.settingsPath || project.settings_path || session.binding.settings_path);
			session.binding.manifest_path = optionalString(project.manifestPath || project.manifest_path || session.binding.manifest_path);
			session.binding.collection_name = optionalString(project.collectionName || project.collection_name || session.binding.collection_name);
			session.binding.collection_key = optionalString(project.collectionKey || project.collection_key || session.binding.collection_key);
			session.binding.project_type = optionalString(project.projectType || project.project_type || session.binding.project_type);
		}
		if (turnSession && typeof turnSession == "object") {
			session.binding.session_id = optionalString(turnSession.session_id || session.binding.session_id);
		}
	}

	function boundArgs(session, args = {}) {
		let next = Object.assign({}, args || {});
		if (session?.binding?.project_id && !optionalString(next.project_id || next.projectID || "")) {
			next.project_id = session.binding.project_id;
		}
		if (session?.binding?.session_id && !optionalString(next.session_id || next.sessionID || "")) {
			next.session_id = session.binding.session_id;
		}
		return next;
	}

	async function executeTool(session, toolName, args = {}) {
		let name = optionalString(toolName);
		if (!name) {
			throw new Error("tools/call requires a tool name.");
		}
		if (name == "sr_project_status") {
			return {
				ok: true,
				binding: serializeBinding(session?.binding || {}),
			};
		}
		if (name == "sr_report_read") {
			let reportPath = optionalString(args.path || session?.binding?.report_path || "");
			if (!reportPath) {
				throw new Error("No report is bound. Call sr_project_bind first.");
			}
			return {
				ok: true,
				report_path: reportPath,
				content: await reviewer._readFileText(reportPath),
			};
		}
		let mapped = "";
		if (name == "sr_project_bind") {
			mapped = "sr.projectBind";
		}
		else if (name == "sr_scope_list") {
			mapped = "sr.scopeList";
		}
		else if (name == "sr_jobs_list") {
			mapped = "sr.jobsList";
		}
		else {
			mapped = name;
		}
		let result = await reviewer.agentTools.call(mapped, boundArgs(session, args), { surface: "mcp" });
		updateBindingFromPayload(session, result);
		return result;
	}

	function initializeResult(protocolVersion = "") {
		let resolved = protocolVersionForRequest(protocolVersion);
		return {
			protocolVersion: resolved,
			capabilities: {
				tools: {
					listChanged: false,
				},
			},
			serverInfo: {
				name: reviewer?.namespace || "systematic-reviewer",
				version: reviewer?.version || "0.0.0",
			},
		};
	}

	async function handleMessage(message = {}, requestMeta = {}) {
		if (!message || typeof message != "object") {
			return {
				status: 400,
				payload: jsonrpcError(null, -32600, "Invalid JSON-RPC message."),
				session: null,
				protocolVersion: protocolVersionForRequest(requestMeta.protocolVersion || ""),
			};
		}
		let method = optionalString(message.method);
		let sessionHeader = optionalString(requestMeta.sessionID || "");
		let session = sessionHeader ? getSession(sessionHeader) : null;
		let protocolVersion = protocolVersionForRequest(requestMeta.protocolVersion || "", session);

		if (method == "initialize") {
			if (!message?.params || typeof message.params != "object") {
				return {
					status: 400,
					payload: jsonrpcError(message.id, -32602, "initialize requires params."),
					session: null,
					protocolVersion,
				};
			}
			let negotiated = protocolVersionForRequest(
				message.params.protocolVersion || requestMeta.protocolVersion || DEFAULT_PROTOCOL_VERSION
			);
			let nextSession = session || createSession({
				internal: !!requestMeta.internal,
				protocol_version: negotiated,
				prefix: requestMeta.internal ? "srmcp-int" : "srmcp",
			});
			nextSession.initialized = true;
			nextSession.protocol_version = negotiated;
			nextSession.client_info = message.params.clientInfo || null;
			nextSession.client_capabilities = message.params.capabilities || {};
			return {
				status: 200,
				payload: jsonrpcSuccess(message.id, initializeResult(negotiated)),
				session: nextSession,
				protocolVersion: negotiated,
			};
		}

		if (!sessionHeader) {
			return {
				status: 400,
				payload: jsonrpcError(message.id, -32000, "MCP-Session-Id is required after initialization."),
				session: null,
				protocolVersion,
			};
		}
		if (!session) {
			return {
				status: 404,
				payload: jsonrpcError(message.id, -32001, `Unknown MCP session: ${sessionHeader}`),
				session: null,
				protocolVersion,
			};
		}

		if (method == "notifications/initialized") {
			return {
				status: 202,
				payload: null,
				session,
				protocolVersion,
			};
		}
		if (method == "ping") {
			return {
				status: 200,
				payload: jsonrpcSuccess(message.id, {}),
				session,
				protocolVersion,
			};
		}
		if (method == "tools/list") {
			return {
				status: 200,
				payload: jsonrpcSuccess(message.id, {
					tools: mcpToolDefinitions(),
				}),
				session,
				protocolVersion,
			};
		}
		if (method == "tools/call") {
			let name = optionalString(message?.params?.name || "");
			let args = message?.params?.arguments;
			if (args === undefined || args === null) {
				args = {};
			}
			if (typeof args == "string") {
				try {
					args = JSON.parse(args);
				}
				catch (_error) {
					args = {};
				}
			}
			if (!args || typeof args != "object" || Array.isArray(args)) {
				args = {};
			}
			try {
				let result = await executeTool(session, name, args);
				return {
					status: 200,
					payload: jsonrpcSuccess(message.id, {
						content: [{
							type: "text",
							text: JSON.stringify(result, null, 2),
						}],
						structuredContent: result,
						isError: false,
					}),
					session,
					protocolVersion,
				};
			}
			catch (error) {
				return {
					status: 200,
					payload: jsonrpcSuccess(message.id, {
						content: [{
							type: "text",
							text: error?.message || String(error),
						}],
						isError: true,
					}),
					session,
					protocolVersion,
				};
			}
		}
		return {
			status: 404,
			payload: jsonrpcError(message.id, -32601, `Method not found: ${method}`),
			session,
			protocolVersion,
		};
	}

	async function invokeInternal(message = {}, options = {}) {
		let sessionID = optionalString(options.sessionID || "");
		let session = sessionID ? getSession(sessionID) : null;
		let response = await handleMessage(message, {
			internal: true,
			sessionID,
			protocolVersion: optionalString(options.protocolVersion || session?.protocol_version || DEFAULT_PROTOCOL_VERSION),
		});
		return {
			status: response.status,
			headers: sessionHeaders(response.session, response.protocolVersion),
			payload: response.payload,
			session: response.session,
		};
	}

	async function ensureInternalAutomationSession(current, sessionID, options = {}) {
		let projectID = optionalString(current?.context?.projectID || "");
		let stableSessionID = optionalString(sessionID || "");
		if (!projectID || !stableSessionID) {
			throw new Error("Internal MCP automation binding requires projectID and sessionID.");
		}
		let key = `${projectID}|${stableSessionID}`;
		let existingID = internalAutomationSessions.get(key) || "";
		let existingSession = existingID ? getSession(existingID) : null;
		if (existingSession) {
			return {
				mcp_session_id: existingSession.session_id,
				session: existingSession,
			};
		}
		let initialize = await invokeInternal({
			jsonrpc: "2.0",
			id: nextSessionID("mcp-init"),
			method: "initialize",
			params: {
				protocolVersion: DEFAULT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: {
					name: "systematic-reviewer-internal-agent",
					version: reviewer?.version || "0.0.0",
				},
			},
		});
		let nextSession = initialize.session;
		if (!nextSession?.session_id) {
			throw new Error("Failed to initialize internal MCP session.");
		}
		await invokeInternal({
			jsonrpc: "2.0",
			method: "notifications/initialized",
		}, {
			sessionID: nextSession.session_id,
		});
		await invokeInternal({
			jsonrpc: "2.0",
			id: nextSessionID("mcp-bind"),
			method: "tools/call",
			params: {
				name: "sr_project_bind",
				arguments: {
					project_id: projectID,
					session_id: stableSessionID,
					objective: optionalString(options.objective || ""),
					title: optionalString(options.title || ""),
				},
			},
		}, {
			sessionID: nextSession.session_id,
		});
		internalAutomationSessions.set(key, nextSession.session_id);
		return {
			mcp_session_id: nextSession.session_id,
			session: nextSession,
		};
	}

	async function callInternalTool(current, sessionID, toolName, args = {}, options = {}) {
		let ensured = await ensureInternalAutomationSession(current, sessionID, options);
		let response = await invokeInternal({
			jsonrpc: "2.0",
			id: nextSessionID("mcp-call"),
			method: "tools/call",
			params: {
				name: toolName,
				arguments: args || {},
			},
		}, {
			sessionID: ensured.mcp_session_id,
		});
		let result = response?.payload?.result || null;
		if (result?.isError) {
			let text = Array.isArray(result?.content) && result.content.length
				? optionalString(result.content[0]?.text || "")
				: "Unknown MCP tool error";
			throw new Error(text || "Unknown MCP tool error");
		}
		return result?.structuredContent || null;
	}

	function authorizationValid(request) {
		if (!apiKey) {
			return true;
		}
		return bearerToken(request) == apiKey;
	}

	function ensureServer() {
		if (!registered || !enabled || server) {
			return;
		}
		server = new HttpServer();
		server.registerPathHandler(ENDPOINT_PREFIX, function MCPPathHandler(request, response) {
			response.processAsync();
			Promise.resolve(mcpHTTPPathHandler(request, response))
				.finally(() => {
					try {
						response.finish();
					}
					catch (_error) {}
				});
		});
		bindLoopback(server, MCP_PREFERRED_PORT);
		serverPort = Number(server?.identity?.primaryPort || 0) || 0;
		reviewer?.log?.(`mcp server ready on ${MCP_HOST}:${serverPort}${apiKey ? " (bearer protected)" : " (no key)"}`);
	}

	function stopServer() {
		if (!server) {
			serverPort = 0;
			return;
		}
		try {
			server.stop();
		}
		catch (_error) {}
		server = null;
		serverPort = 0;
		sessions = new Map();
		internalAutomationSessions = new Map();
	}

	function status() {
		return {
			enabled: !!enabled,
			running: !!serverPort,
			host: MCP_HOST,
			port: Number(serverPort || 0) || 0,
			preferred_port: MCP_PREFERRED_PORT,
			base_url: serverPort ? `http://${MCP_PUBLIC_HOST}:${serverPort}${ENDPOINT_PREFIX}` : "",
			api_key_set: !!apiKey,
			auth_mode: apiKey ? "bearer" : "none",
		};
	}

	async function mcpHTTPPathHandler(request, response) {
		let headers = readRequestHeaders(request);
		try {
			validateOrigin(headers || {});
			if (!authorizationValid(request)) {
				let unauthorized = jsonResponse(401, jsonrpcError(null, -32000, "Missing or invalid MCP bearer token."), null, "");
				writeHTTPResponse(response, request, unauthorized[0], unauthorized[1], unauthorized[2]);
				return;
			}
			let method = optionalString(request?.method || "GET").toUpperCase();
			let requestSessionID = optionalString(headers?.["MCP-Session-Id"] || headers?.["mcp-session-id"] || "");
			let requestProtocol = optionalString(headers?.["MCP-Protocol-Version"] || headers?.["mcp-protocol-version"] || "");
			if (method == "OPTIONS") {
				let tuple = emptyResponse(204, getSession(requestSessionID), requestProtocol, {
					"Allow": "POST, GET, DELETE, OPTIONS",
				});
				writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
				return;
			}
			if (method == "GET") {
				let tuple = emptyResponse(405, getSession(requestSessionID), requestProtocol, {
					"Allow": "POST, DELETE, OPTIONS",
				});
				writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
				return;
			}
			if (method == "DELETE") {
				if (!requestSessionID) {
					let tuple = jsonResponse(400, jsonrpcError(null, -32000, "MCP-Session-Id is required for DELETE."), null, requestProtocol);
					writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
					return;
				}
				let session = getSession(requestSessionID);
				if (!session) {
					let tuple = emptyResponse(404, null, requestProtocol);
					writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
					return;
				}
				sessions.delete(requestSessionID);
				for (let [key, value] of internalAutomationSessions.entries()) {
					if (value == requestSessionID) {
						internalAutomationSessions.delete(key);
					}
				}
				let tuple = emptyResponse(204, null, session?.protocol_version || requestProtocol);
				writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
				return;
			}
			let body = readRequestBody(request);
			let parsed = body ? JSON.parse(body || "{}") : {};
			if (!parsed || typeof parsed != "object") {
				let tuple = jsonResponse(400, jsonrpcError(null, -32600, "Request body must be one JSON-RPC message."), null, requestProtocol);
				writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
				return;
			}
			let handled = await handleMessage(parsed, {
				headers,
				sessionID: requestSessionID,
				protocolVersion: requestProtocol,
				internal: false,
			});
			let tuple = isNotification(parsed)
				? emptyResponse(handled.status || 202, handled.session, handled.protocolVersion)
				: (acceptsEventStream(headers || {})
					? sseResponse(handled.status || 200, handled.payload, handled.session, handled.protocolVersion)
					: jsonResponse(handled.status || 200, handled.payload, handled.session, handled.protocolVersion));
			writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
		}
		catch (error) {
			let tuple = jsonResponse(400, jsonrpcError(null, -32000, error?.message || String(error)));
			writeHTTPResponse(response, request, tuple[0], tuple[1], tuple[2]);
		}
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
		sessions = new Map();
		internalAutomationSessions = new Map();
		nextReviewer.mcpServer = {
			listTools: () => mcpToolDefinitions(),
			invokeInternal,
			callInternalTool,
			ensureInternalAutomationSession,
			getStatus: () => status(),
			applySettings: (value = null) => applyServerSettings(value),
		};
		registered = true;
		applyServerSettings(nextReviewer.cachedGlobalSettings?.server_security || null);
		syncFromReviewerSettings().catch((error) => reviewer?.log?.(`mcp settings sync skipped: ${error}`));
	}

	function unregister() {
		stopServer();
		if (reviewer?.mcpServer) {
			delete reviewer.mcpServer;
		}
		reviewer = null;
		registered = false;
		enabled = false;
		apiKey = "";
	}

	return {
		register,
		unregister,
		basePath: ENDPOINT_PREFIX,
		listTools: () => mcpToolDefinitions(),
		invokeInternal,
		callInternalTool,
		ensureInternalAutomationSession,
		getStatus: () => status(),
		applySettings: (value = null) => applyServerSettings(value),
	};
})();
