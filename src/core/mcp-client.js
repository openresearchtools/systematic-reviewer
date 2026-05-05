var SystematicReviewerMCPClient = (() => {
	const PROTOCOL_VERSION = "2025-11-25";
	const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
	const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
	const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
	const MIN_TIMEOUT_MS = 1000;
	const MAX_TIMEOUT_MS = 3600000;

	let reviewerRef = null;
	let connections = new Map();
	let stdioProbe = null;

	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function clampTimeout(value, fallback = DEFAULT_REQUEST_TIMEOUT_MS) {
		let next = Math.round(Number(value || 0) || 0);
		let base = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(Number(fallback || DEFAULT_REQUEST_TIMEOUT_MS) || DEFAULT_REQUEST_TIMEOUT_MS)));
		if (!Number.isFinite(next) || next <= 0) {
			return base;
		}
		return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, next));
	}

	function clone(value) {
		try {
			return JSON.parse(JSON.stringify(value === undefined ? null : value));
		}
		catch (_error) {
			return null;
		}
	}

	function envValue(name = "") {
		let key = optionalString(name);
		if (!key) {
			return "";
		}
		try {
			let env = Components.classes["@mozilla.org/process/environment;1"].getService(Components.interfaces.nsIEnvironment);
			return env.exists(key) ? String(env.get(key) || "") : "";
		}
		catch (_error) {
			return "";
		}
	}

	function subprocessModule() {
		if (stdioProbe) {
			return stdioProbe.module;
		}
		try {
			let imported = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
			let module = imported?.Subprocess || null;
			stdioProbe = {
				available: !!(module?.call && module?.pathSearch),
				module,
				error: "",
			};
		}
		catch (error) {
			stdioProbe = {
				available: false,
				module: null,
				error: error?.message || String(error),
			};
		}
		return stdioProbe.module;
	}

	function stdioAvailable() {
		subprocessModule();
		return stdioProbe?.available === true;
	}

	function stdioStatus() {
		subprocessModule();
		return {
			available: stdioProbe?.available === true,
			error: stdioProbe?.error || "",
		};
	}

	function normalizeSettings(reviewer, raw = null) {
		if (reviewer?._normalizeMCPClientSettings) {
			return reviewer._normalizeMCPClientSettings(raw || {});
		}
		return {
			servers: Array.isArray(raw?.servers) ? raw.servers : [],
		};
	}

	async function currentSettings(reviewer) {
		let settings = await reviewer._globalSettings();
		return normalizeSettings(reviewer, settings?.mcp_clients || {});
	}

	function enabledServers(settings = {}) {
		return (Array.isArray(settings?.servers) ? settings.servers : [])
			.filter((server) => server?.enabled === true && optionalString(server?.server_id));
	}

	function serializeServer(server = {}, status = null) {
		return {
			server_id: optionalString(server.server_id),
			label: optionalString(server.label || server.server_id),
			enabled: server.enabled === true,
			transport: optionalString(server.transport || "stdio"),
			request_timeout_ms: clampTimeout(server.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS),
			stdio: {
				command_set: !!optionalString(server.command),
				args_count: Array.isArray(server.args) ? server.args.length : 0,
				cwd_mode: optionalString(server.cwd_mode || "project_root"),
				cwd_set: !!optionalString(server.cwd),
				env_count: Array.isArray(server.env) ? server.env.length : 0,
				env_passthrough_count: Array.isArray(server.env_passthrough) ? server.env_passthrough.length : 0,
				startup_timeout_ms: clampTimeout(server.startup_timeout_ms, DEFAULT_STARTUP_TIMEOUT_MS),
			},
			streamable_http: {
				url: optionalString(server.url),
				headers_count: Array.isArray(server.headers) ? server.headers.length : 0,
				headers_from_env_count: Array.isArray(server.headers_from_env) ? server.headers_from_env.length : 0,
				bearer_token_env_set: !!optionalString(server.bearer_token_env),
			},
			status: status || null,
		};
	}

	function findConfiguredServer(settings = {}, serverID = "") {
		let target = optionalString(serverID);
		if (!target) {
			throw new Error("server_id is required.");
		}
		let server = (Array.isArray(settings?.servers) ? settings.servers : [])
			.find((entry) => optionalString(entry?.server_id) == target) || null;
		if (!server) {
			throw new Error(`External MCP server is not configured: ${target}`);
		}
		if (server.enabled !== true) {
			throw new Error(`External MCP server is disabled: ${target}`);
		}
		return server;
	}

	async function projectContextForCall(reviewer, args = {}) {
		let toolContext = args?.__sr_tool_context && typeof args.__sr_tool_context == "object"
			? args.__sr_tool_context
			: {};
		let project = toolContext?.project_context && typeof toolContext.project_context == "object"
			? toolContext.project_context
			: null;
		if (!project && reviewer?.currentProject) {
			project = reviewer.currentProject;
		}
		if (!project) {
			let settings = await reviewer._globalSettings().catch(() => null);
			project = settings?.last_project || null;
		}
		let projectID = optionalString(project?.projectID || project?.project_id);
		let projectRoot = optionalString(project?.projectRoot || project?.project_root);
		if (!projectRoot && projectID && reviewer?._projectsRoot && reviewer?._joinPath) {
			projectRoot = reviewer._joinPath(reviewer._projectsRoot(), projectID);
		}
		return {
			project_id: projectID,
			project_root: projectRoot,
			session_id: optionalString(toolContext?.session_id || project?.sessionID || project?.session_id),
		};
	}

	function interpolate(value = "", context = {}) {
		return String(value || "")
			.replaceAll("{project_root}", context.project_root || "")
			.replaceAll("{project_id}", context.project_id || "")
			.replaceAll("{session_id}", context.session_id || "");
	}

	function pathJoin(reviewer, root = "", child = "") {
		let base = optionalString(root);
		let leaf = optionalString(child);
		if (!leaf) {
			return base;
		}
		if (/^([A-Za-z]:[\\/]|\/|\\\\)/.test(leaf)) {
			return leaf;
		}
		return reviewer?._joinPath ? reviewer._joinPath(base, leaf) : `${base.replace(/[\\/]$/, "")}/${leaf}`;
	}

	async function executablePath(command = "") {
		let raw = optionalString(command);
		if (!raw) {
			throw new Error("stdio MCP command is required.");
		}
		if (/^([A-Za-z]:[\\/]|\/|\\\\)/.test(raw)) {
			return raw;
		}
		let module = subprocessModule();
		if (module?.pathSearch) {
			try {
				return await module.pathSearch(raw);
			}
			catch (_error) {}
		}
		return raw;
	}

	function stdioWorkdir(reviewer, server = {}, context = {}) {
		let mode = optionalString(server.cwd_mode || "project_root");
		if (mode == "process") {
			return "";
		}
		if (mode == "custom") {
			let custom = interpolate(server.cwd || "", context);
			if (!custom) {
				return context.project_root || "";
			}
			return pathJoin(reviewer, context.project_root || "", custom);
		}
		return context.project_root || "";
	}

	function stdioEnv(server = {}, context = {}) {
		let out = {};
		for (let key of Array.isArray(server.env_passthrough) ? server.env_passthrough : []) {
			let name = optionalString(key);
			if (!name) {
				continue;
			}
			let value = envValue(name);
			if (value) {
				out[name] = value;
			}
		}
		for (let entry of Array.isArray(server.env) ? server.env : []) {
			let key = optionalString(entry?.key);
			if (!key) {
				continue;
			}
			out[key] = interpolate(entry?.value || "", context);
		}
		return out;
	}

	function httpHeaders(server = {}) {
		let headers = {
			"Content-Type": "application/json",
			"Accept": "application/json, text/event-stream",
			"MCP-Protocol-Version": PROTOCOL_VERSION,
		};
		for (let entry of Array.isArray(server.headers) ? server.headers : []) {
			let key = optionalString(entry?.key);
			if (key) {
				headers[key] = String(entry?.value || "");
			}
		}
		for (let entry of Array.isArray(server.headers_from_env) ? server.headers_from_env : []) {
			let key = optionalString(entry?.key);
			let env = optionalString(entry?.env);
			if (!key || !env) {
				continue;
			}
			let value = envValue(env);
			if (value) {
				headers[key] = value;
			}
		}
		let bearerEnv = optionalString(server.bearer_token_env);
		if (bearerEnv) {
			let token = envValue(bearerEnv);
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}
		}
		return headers;
	}

	function parseEventStream(text = "", id = null) {
		let blocks = String(text || "").split(/\r?\n\r?\n/);
		let candidates = [];
		for (let block of blocks) {
			let data = [];
			for (let line of block.split(/\r?\n/)) {
				if (line.startsWith("data:")) {
					data.push(line.slice(5).trimStart());
				}
			}
			let joined = data.join("\n").trim();
			if (!joined || joined == "[DONE]") {
				continue;
			}
			try {
				candidates.push(JSON.parse(joined));
			}
			catch (_error) {}
		}
		if (id !== null && id !== undefined) {
			return candidates.find((entry) => String(entry?.id) == String(id)) || candidates[0] || null;
		}
		return candidates[0] || null;
	}

	async function fetchWithTimeout(url, options = {}, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
		let controller = typeof AbortController != "undefined" ? new AbortController() : null;
		let timer = null;
		if (controller) {
			options.signal = controller.signal;
			timer = setTimeout(() => controller.abort(), clampTimeout(timeoutMS));
		}
		try {
			return await fetch(url, options);
		}
		catch (error) {
			if (Zotero?.HTTP?.request) {
				return await zoteroHTTPFetch(url, options, timeoutMS, error);
			}
			throw error;
		}
		finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}

	async function zoteroHTTPFetch(url, options = {}, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS, originalError = null) {
		try {
			let request = await Zotero.HTTP.request(options.method || "GET", url, {
				headers: options.headers || {},
				body: options.body || null,
				timeout: clampTimeout(timeoutMS),
				responseType: "",
				successCodes: [200, 201, 202, 204, 400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504],
			});
			let status = Number(request?.status || 0) || 0;
			return {
				ok: status >= 200 && status < 300,
				status,
				statusText: String(request?.statusText || ""),
				headers: {
					get(name = "") {
						try {
							return request?.getResponseHeader?.(name) || "";
						}
						catch (_error) {
							return "";
						}
					},
				},
				body: null,
				text: async () => String(request?.responseText ?? request?.response ?? ""),
			};
		}
		catch (error) {
			if (originalError) {
				throw originalError;
			}
			throw error;
		}
	}

	async function textWithTimeout(response, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
		let timeout = clampTimeout(timeoutMS);
		let timer = null;
		return await Promise.race([
			response.text(),
			new Promise((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`MCP HTTP response body timed out after ${timeout}ms.`)), timeout);
			}),
		]).finally(() => {
			if (timer) {
				clearTimeout(timer);
			}
		});
	}

	async function readEventStreamMessage(response, id, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
		if (!response.body?.getReader || typeof TextDecoder == "undefined") {
			return parseEventStream(await textWithTimeout(response, timeoutMS), id);
		}
		let reader = response.body.getReader();
		let decoder = new TextDecoder();
		let buffer = "";
		let timeout = clampTimeout(timeoutMS);
		let timeoutError = new Error(`MCP HTTP event-stream response timed out after ${timeout}ms.`);
		try {
			while (true) {
				let timer = null;
				let read = await Promise.race([
					reader.read(),
					new Promise((_resolve, reject) => {
						timer = setTimeout(() => reject(timeoutError), timeout);
					}),
				]).finally(() => {
					if (timer) {
						clearTimeout(timer);
					}
				});
				if (read?.done) {
					return parseEventStream(buffer, id);
				}
				if (read?.value) {
					buffer += decoder.decode(read.value, { stream: true });
					let parsed = parseEventStream(buffer, id);
					if (parsed) {
						await reader.cancel().catch(() => null);
						return parsed;
					}
				}
			}
		}
		finally {
			try {
				reader.releaseLock?.();
			}
			catch (_error) {}
		}
	}

	class MCPConnection {
		constructor(reviewer, server, context = {}) {
			this.reviewer = reviewer;
			this.server = server;
			this.context = context;
			this.initialized = false;
			this.capabilities = {};
			this.serverInfo = {};
			this.lastUsed = Date.now();
			this.idleTimer = null;
		}

		async ensureInitialized() {
			this.touch();
			if (this.initialized) {
				return;
			}
			let result = await this.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: {
					name: "Systematic Reviewer",
					version: optionalString(this.reviewer?.version || ""),
				},
			}, this.server.startup_timeout_ms || this.server.request_timeout_ms);
			this.capabilities = result?.capabilities || {};
			this.serverInfo = result?.serverInfo || result?.server_info || {};
			this.initialized = true;
			await this.notify("notifications/initialized", {}).catch(() => null);
		}

		touch() {
			this.lastUsed = Date.now();
			if (this.idleTimer) {
				clearTimeout(this.idleTimer);
			}
			this.idleTimer = setTimeout(() => {
				this.close("idle timeout").catch(() => null);
			}, IDLE_TIMEOUT_MS);
		}

		async request(_method, _params = {}, _timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
			throw new Error("MCP connection transport is not implemented.");
		}

		async notify(_method, _params = {}) {}

		status() {
			return {
				connected: this.initialized,
				transport: optionalString(this.server.transport || "stdio"),
				last_used: this.lastUsed ? new Date(this.lastUsed).toISOString() : "",
				capabilities: Object.keys(this.capabilities || {}),
				server_info: this.serverInfo || {},
			};
		}

		async close(_reason = "") {
			if (this.idleTimer) {
				clearTimeout(this.idleTimer);
				this.idleTimer = null;
			}
			this.initialized = false;
		}
	}

	class StdioMCPConnection extends MCPConnection {
		constructor(reviewer, server, context = {}) {
			super(reviewer, server, context);
			this.proc = null;
			this.nextID = 1;
			this.pending = new Map();
			this.stdoutBuffer = "";
			this.closed = false;
			this.readLoop = null;
			this.stderrLog = "";
		}

		async start() {
			if (this.proc) {
				return;
			}
			let module = subprocessModule();
			if (!module?.call) {
				throw new Error(`Mozilla Subprocess is not available in this Zotero runtime${stdioProbe?.error ? `: ${stdioProbe.error}` : "."}`);
			}
			let command = await executablePath(this.server.command || "");
			let args = (Array.isArray(this.server.args) ? this.server.args : []).map((entry) => interpolate(entry, this.context));
			let workdir = stdioWorkdir(this.reviewer, this.server, this.context);
			let env = stdioEnv(this.server, this.context);
			let options = {
				command,
				arguments: args,
				stderr: "pipe",
			};
			if (workdir) {
				options.workdir = workdir;
			}
			if (Object.keys(env).length) {
				options.environment = env;
				options.environmentAppend = true;
			}
			this.proc = await module.call(options);
			this.closed = false;
			this.readLoop = this._readStdout();
			this._readStderr().catch(() => null);
		}

		async request(method, params = {}, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
			await this.start();
			this.touch();
			let id = this.nextID++;
			let payload = {
				jsonrpc: "2.0",
				id,
				method,
				params: params || {},
			};
			let timeout = clampTimeout(timeoutMS, this.server.request_timeout_ms);
			return await new Promise((resolve, reject) => {
				let timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new Error(`MCP stdio request timed out after ${timeout}ms: ${method}`));
				}, timeout);
				this.pending.set(id, { resolve, reject, timer, method });
				Promise.resolve(this.proc.stdin.write(`${JSON.stringify(payload)}\n`)).catch((error) => {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(error);
				});
			});
		}

		async notify(method, params = {}) {
			await this.start();
			await this.proc.stdin.write(`${JSON.stringify({
				jsonrpc: "2.0",
				method,
				params: params || {},
			})}\n`);
		}

		_handleMessage(message = {}) {
			if (message?.id === undefined || message?.id === null) {
				return;
			}
			let pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) {
				pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
				return;
			}
			pending.resolve(message.result);
		}

		async _readStdout() {
			try {
				while (!this.closed && this.proc?.stdout) {
					let chunk = await this.proc.stdout.readString();
					if (!chunk) {
						break;
					}
					this.stdoutBuffer += chunk;
					let parts = this.stdoutBuffer.split(/\r?\n/);
					this.stdoutBuffer = parts.pop() || "";
					for (let line of parts) {
						let raw = line.trim();
						if (!raw) {
							continue;
						}
						try {
							this._handleMessage(JSON.parse(raw));
						}
						catch (error) {
							this.reviewer?.log?.(`MCP stdio parse error from ${this.server.server_id}: ${error?.message || error}`);
						}
					}
				}
			}
			catch (error) {
				if (!this.closed) {
					this._rejectAll(error);
				}
			}
		}

		async _readStderr() {
			if (!this.proc?.stderr) {
				return;
			}
			while (!this.closed) {
				let chunk = await this.proc.stderr.readString();
				if (!chunk) {
					break;
				}
				this.stderrLog = `${this.stderrLog}${chunk}`.slice(-8000);
				this.reviewer?.log?.(`MCP ${this.server.server_id} stderr: ${String(chunk).trim()}`);
			}
		}

		_rejectAll(error) {
			for (let [id, pending] of this.pending.entries()) {
				clearTimeout(pending.timer);
				pending.reject(error);
				this.pending.delete(id);
			}
		}

		status() {
			return Object.assign(super.status(), {
				stderr_tail: this.stderrLog,
			});
		}

		async close(reason = "") {
			await super.close(reason);
			this.closed = true;
			this._rejectAll(new Error(`MCP stdio connection closed${reason ? `: ${reason}` : ""}`));
			try {
				this.proc?.stdin?.close?.();
			}
			catch (_error) {}
			try {
				this.proc?.kill?.();
			}
			catch (_error) {}
			try {
				this.proc?.stdout?.close?.();
			}
			catch (_error) {}
			try {
				this.proc?.stderr?.close?.();
			}
			catch (_error) {}
			this.proc = null;
		}
	}

	class HTTPMCPConnection extends MCPConnection {
		constructor(reviewer, server, context = {}) {
			super(reviewer, server, context);
			this.sessionID = "";
			this.nextID = 1;
		}

		async request(method, params = {}, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
			this.touch();
			let id = this.nextID++;
			let result = await this._post({
				jsonrpc: "2.0",
				id,
				method,
				params: params || {},
			}, id, timeoutMS);
			if (result?.error) {
				throw new Error(result.error.message || JSON.stringify(result.error));
			}
			return result?.result;
		}

		async notify(method, params = {}) {
			await this._post({
				jsonrpc: "2.0",
				method,
				params: params || {},
			}, null, this.server.request_timeout_ms).catch(() => null);
		}

		async _post(payload, id, timeoutMS = DEFAULT_REQUEST_TIMEOUT_MS) {
			let url = optionalString(this.server.url);
			if (!url) {
				throw new Error("Streamable HTTP MCP URL is required.");
			}
			let headers = httpHeaders(this.server);
			if (this.sessionID) {
				headers["MCP-Session-Id"] = this.sessionID;
			}
			let response = await fetchWithTimeout(url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			}, clampTimeout(timeoutMS, this.server.request_timeout_ms));
			let nextSessionID = response.headers?.get?.("MCP-Session-Id") || response.headers?.get?.("mcp-session-id") || "";
			if (nextSessionID) {
				this.sessionID = nextSessionID;
			}
			if (id === null && [200, 202, 204].includes(Number(response.status || 0))) {
				return {};
			}
			let contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
			if (contentType.includes("text/event-stream")) {
				if (!response.ok) {
					let errorText = await textWithTimeout(response, timeoutMS).catch(() => "");
					throw new Error(`MCP HTTP ${response.status}: ${errorText || response.statusText || "request failed"}`);
				}
				let parsed = await readEventStreamMessage(response, id, timeoutMS);
				if (!parsed) {
					throw new Error("MCP HTTP event-stream response did not include a JSON-RPC message.");
				}
				return parsed;
			}
			let text = await textWithTimeout(response, timeoutMS);
			if (!response.ok) {
				throw new Error(`MCP HTTP ${response.status}: ${text || response.statusText || "request failed"}`);
			}
			if (!text.trim()) {
				return {};
			}
			return JSON.parse(text);
		}

		status() {
			return Object.assign(super.status(), {
				session_id: this.sessionID ? "[active]" : "",
			});
		}

		async close(reason = "") {
			let sessionID = this.sessionID;
			await super.close(reason);
			this.sessionID = "";
			if (!sessionID) {
				return;
			}
			let url = optionalString(this.server.url);
			if (!url) {
				return;
			}
			let headers = httpHeaders(this.server);
			headers["MCP-Session-Id"] = sessionID;
			await fetchWithTimeout(url, { method: "DELETE", headers }, this.server.request_timeout_ms).catch(() => null);
		}
	}

	async function connectionFor(reviewer, server, args = {}) {
		reviewerRef = reviewer;
		let context = await projectContextForCall(reviewer, args || {});
		let key = optionalString(server.server_id);
		let existing = connections.get(key);
		if (existing) {
			existing.context = context;
			await existing.ensureInitialized();
			return existing;
		}
		let transport = optionalString(server.transport || "stdio");
		let connection = transport == "streamable_http"
			? new HTTPMCPConnection(reviewer, server, context)
			: new StdioMCPConnection(reviewer, server, context);
		connections.set(key, connection);
		try {
			await connection.ensureInitialized();
		}
		catch (error) {
			connections.delete(key);
			await connection.close("initialize failed").catch(() => null);
			throw error;
		}
		return connection;
	}

	async function serverConnection(reviewer, args = {}) {
		let settings = await currentSettings(reviewer);
		let server = findConfiguredServer(settings, args.server_id || args.serverID);
		let connection = await connectionFor(reviewer, server, args);
		return { settings, server, connection };
	}

	function capabilitySupported(connection, capability = "") {
		return !!connection?.capabilities?.[capability];
	}

	async function listTools(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		await connection.ensureInitialized();
		let result = await connection.request("tools/list", {}, args.timeout_ms || server.request_timeout_ms);
		return {
			ok: true,
			server_id: server.server_id,
			tools: Array.isArray(result?.tools) ? result.tools : [],
			next_cursor: optionalString(result?.nextCursor || result?.next_cursor),
		};
	}

	function scoreTool(tool = {}, query = "") {
		let q = optionalString(query).toLowerCase();
		if (!q) {
			return 1;
		}
		let haystack = `${tool.name || ""}\n${tool.description || ""}\n${JSON.stringify(tool.inputSchema || tool.input_schema || {})}`.toLowerCase();
		let score = 0;
		for (let token of q.split(/\s+/).filter(Boolean)) {
			if (String(tool.name || "").toLowerCase().includes(token)) {
				score += 10;
			}
			if (haystack.includes(token)) {
				score += 1;
			}
		}
		return score;
	}

	async function listServers(reviewer, args = {}) {
		let settings = await currentSettings(reviewer);
		let servers = Array.isArray(settings?.servers) ? settings.servers : [];
		let statusByID = getStatus(reviewer).servers || {};
		return {
			ok: true,
			stdio_available: stdioStatus().available,
			stdio_error: stdioStatus().error,
			server_count: servers.length,
			enabled_count: servers.filter((server) => server.enabled === true).length,
			servers: servers.map((server) => serializeServer(server, statusByID[server.server_id] || null)),
		};
	}

	async function inspectServer(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		await connection.ensureInitialized();
		let tools = [];
		let resources = [];
		let prompts = [];
		let errors = [];
		try {
			tools = (await connection.request("tools/list", {}, args.timeout_ms || server.request_timeout_ms))?.tools || [];
		}
		catch (error) {
			errors.push(`tools/list: ${error?.message || error}`);
		}
		if (capabilitySupported(connection, "resources")) {
			try {
				resources = (await connection.request("resources/list", {}, args.timeout_ms || server.request_timeout_ms))?.resources || [];
			}
			catch (error) {
				errors.push(`resources/list: ${error?.message || error}`);
			}
		}
		if (capabilitySupported(connection, "prompts")) {
			try {
				prompts = (await connection.request("prompts/list", {}, args.timeout_ms || server.request_timeout_ms))?.prompts || [];
			}
			catch (error) {
				errors.push(`prompts/list: ${error?.message || error}`);
			}
		}
		return {
			ok: !errors.length,
			server: serializeServer(server, connection.status()),
			capabilities: connection.capabilities || {},
			server_info: connection.serverInfo || {},
			tools,
			resources,
			prompts,
			errors,
		};
	}

	async function refreshServer(reviewer, args = {}) {
		await disconnectServer(reviewer, args).catch(() => null);
		return await inspectServer(reviewer, args);
	}

	async function disconnectServer(reviewer, args = {}) {
		let serverID = optionalString(args.server_id || args.serverID);
		if (!serverID) {
			throw new Error("server_id is required.");
		}
		let connection = connections.get(serverID);
		if (connection) {
			await connection.close("disconnect requested");
			connections.delete(serverID);
		}
		return {
			ok: true,
			server_id: serverID,
			disconnected: !!connection,
		};
	}

	async function searchTools(reviewer, args = {}) {
		let query = optionalString(args.query);
		let limit = Math.max(1, Math.min(100, Math.round(Number(args.limit || 25) || 25)));
		let result = await listTools(reviewer, args);
		let tools = (Array.isArray(result.tools) ? result.tools : [])
			.map((tool) => ({ tool, score: scoreTool(tool, query) }))
			.filter((entry) => entry.score > 0)
			.sort((left, right) => right.score - left.score || String(left.tool?.name || "").localeCompare(String(right.tool?.name || "")))
			.slice(0, limit)
			.map((entry) => entry.tool);
		return {
			ok: true,
			server_id: result.server_id,
			query,
			count: tools.length,
			tools,
		};
	}

	async function callTool(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		let name = optionalString(args.name || args.tool || args.tool_name || args.toolName);
		if (!name) {
			throw new Error("name is required.");
		}
		let toolArgs = args.arguments && typeof args.arguments == "object"
			? clone(args.arguments)
			: (args.args && typeof args.args == "object" ? clone(args.args) : {});
		let result = await connection.request("tools/call", {
			name,
			arguments: toolArgs || {},
		}, args.timeout_ms || server.request_timeout_ms);
		return {
			ok: true,
			server_id: server.server_id,
			name,
			result,
		};
	}

	async function listResources(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		if (!capabilitySupported(connection, "resources")) {
			return {
				ok: true,
				server_id: server.server_id,
				supported: false,
				resources: [],
				message: "This MCP server does not advertise resources.",
			};
		}
		let params = {};
		if (optionalString(args.cursor)) {
			params.cursor = optionalString(args.cursor);
		}
		let result = await connection.request("resources/list", params, args.timeout_ms || server.request_timeout_ms);
		return {
			ok: true,
			server_id: server.server_id,
			supported: true,
			resources: Array.isArray(result?.resources) ? result.resources : [],
			next_cursor: optionalString(result?.nextCursor || result?.next_cursor),
		};
	}

	async function readResource(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		if (!capabilitySupported(connection, "resources")) {
			throw new Error("This MCP server does not advertise resources.");
		}
		let uri = optionalString(args.uri);
		if (!uri) {
			throw new Error("uri is required.");
		}
		let result = await connection.request("resources/read", { uri }, args.timeout_ms || server.request_timeout_ms);
		return {
			ok: true,
			server_id: server.server_id,
			uri,
			result,
		};
	}

	async function listPrompts(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		if (!capabilitySupported(connection, "prompts")) {
			return {
				ok: true,
				server_id: server.server_id,
				supported: false,
				prompts: [],
				message: "This MCP server does not advertise prompts.",
			};
		}
		let params = {};
		if (optionalString(args.cursor)) {
			params.cursor = optionalString(args.cursor);
		}
		let result = await connection.request("prompts/list", params, args.timeout_ms || server.request_timeout_ms);
		return {
			ok: true,
			server_id: server.server_id,
			supported: true,
			prompts: Array.isArray(result?.prompts) ? result.prompts : [],
			next_cursor: optionalString(result?.nextCursor || result?.next_cursor),
		};
	}

	async function getPrompt(reviewer, args = {}) {
		let { server, connection } = await serverConnection(reviewer, args);
		if (!capabilitySupported(connection, "prompts")) {
			throw new Error("This MCP server does not advertise prompts.");
		}
		let name = optionalString(args.name || args.prompt || args.prompt_name || args.promptName);
		if (!name) {
			throw new Error("name is required.");
		}
		let promptArgs = args.arguments && typeof args.arguments == "object" ? clone(args.arguments) : {};
		let result = await connection.request("prompts/get", {
			name,
			arguments: promptArgs || {},
		}, args.timeout_ms || server.request_timeout_ms);
		return {
			ok: true,
			server_id: server.server_id,
			name,
			result,
		};
	}

	async function testServer(reviewer, serverConfig = {}, options = {}) {
		let normalized = normalizeSettings(reviewer, { servers: [serverConfig] }).servers[0];
		if (!normalized) {
			throw new Error("MCP server configuration is invalid.");
		}
		normalized.enabled = true;
		let context = await projectContextForCall(reviewer, options || {});
		let connection = normalized.transport == "streamable_http"
			? new HTTPMCPConnection(reviewer, normalized, context)
			: new StdioMCPConnection(reviewer, normalized, context);
		try {
			await connection.ensureInitialized();
			let tools = await connection.request("tools/list", {}, normalized.request_timeout_ms).catch((error) => ({ error: error?.message || String(error), tools: [] }));
			let resources = capabilitySupported(connection, "resources")
				? await connection.request("resources/list", {}, normalized.request_timeout_ms).catch((error) => ({ error: error?.message || String(error), resources: [] }))
				: { resources: [], supported: false };
			let prompts = capabilitySupported(connection, "prompts")
				? await connection.request("prompts/list", {}, normalized.request_timeout_ms).catch((error) => ({ error: error?.message || String(error), prompts: [] }))
				: { prompts: [], supported: false };
			return {
				ok: true,
				server_id: normalized.server_id,
				message: `Connected to ${normalized.label || normalized.server_id}.`,
				capabilities: connection.capabilities || {},
				server_info: connection.serverInfo || {},
				tools_count: Array.isArray(tools?.tools) ? tools.tools.length : 0,
				resources_count: Array.isArray(resources?.resources) ? resources.resources.length : 0,
				prompts_count: Array.isArray(prompts?.prompts) ? prompts.prompts.length : 0,
				tools_error: tools?.error || "",
				resources_error: resources?.error || "",
				prompts_error: prompts?.error || "",
			};
		}
		finally {
			await connection.close("test complete").catch(() => null);
		}
	}

	function getStatus(_reviewer = null) {
		let servers = {};
		for (let [serverID, connection] of connections.entries()) {
			servers[serverID] = connection.status();
		}
		return {
			stdio_available: stdioStatus().available,
			stdio_error: stdioStatus().error,
			connected_count: connections.size,
			servers,
		};
	}

	async function applySettings(settings = null, reviewer = null) {
		let normalized = normalizeSettings(reviewer || reviewerRef, settings || {});
		let enabled = new Set(enabledServers(normalized).map((server) => optionalString(server.server_id)));
		for (let [serverID, connection] of Array.from(connections.entries())) {
			if (!enabled.has(serverID)) {
				await connection.close("settings disabled").catch(() => null);
				connections.delete(serverID);
			}
		}
	}

	async function shutdown() {
		for (let [serverID, connection] of Array.from(connections.entries())) {
			await connection.close("shutdown").catch(() => null);
			connections.delete(serverID);
		}
	}

	return {
		listServers,
		inspectServer,
		refreshServer,
		disconnectServer,
		searchTools,
		callTool,
		listResources,
		readResource,
		listPrompts,
		getPrompt,
		testServer,
		getStatus,
		applySettings,
		shutdown,
		stdioAvailable,
	};
})();
