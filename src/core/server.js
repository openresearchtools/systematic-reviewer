var { HttpServer } = ChromeUtils.importESModule("chrome://remote/content/server/httpd.sys.mjs");

var SystematicReviewerWorkflowServer = (() => {
	const ENDPOINT_PREFIX = "/systematic-reviewer/workflow";
	const AUTOMATION_CHAT_STREAM_PATH = `${ENDPOINT_PREFIX}/automation/chat/stream`;
	const APP_HOST = "127.0.0.1";
	const APP_PUBLIC_HOST = "localhost";
	const APP_PREFERRED_PORT = 23129;
	const UI_COOKIE_NAME = "sr_workflow_ui";
	const UI_COOKIE_PATH = `${ENDPOINT_PREFIX}/`;
	const UI_LAUNCH_TOKEN_PARAM = "sr_launch_token";
	const UI_LAUNCH_TOKEN_TTL_MS = 2 * 60 * 1000;
	const UI_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
	const STATUS_TEXT = Object.freeze({
		200: "OK",
		201: "Created",
		202: "Accepted",
		204: "No Content",
		400: "Bad Request",
		401: "Unauthorized",
		403: "Forbidden",
		404: "Not Found",
		405: "Method Not Allowed",
		500: "Internal Server Error",
		504: "Gateway Timeout",
	});

	const ASSET_DEFINITIONS = [
		{ path: `${ENDPOINT_PREFIX}/ui/index.html`, asset: "ui/index.html", type: "text/html; charset=utf-8", access: "ui_launch" },
		{ path: `${ENDPOINT_PREFIX}/ui/attachment-viewer.html`, asset: "ui/attachment-viewer.html", type: "text/html; charset=utf-8", access: "ui_launch" },
		{ path: `${ENDPOINT_PREFIX}/ui/attachment-viewer.css`, asset: "ui/attachment-viewer.css", type: "text/css; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/attachment-viewer.js`, asset: "ui/attachment-viewer.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/styles.css`, asset: "ui/styles.css", type: "text/css; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/prefs.css`, asset: "ui/prefs/prefs.css", type: "text/css; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/document-style-presets.js`, asset: "core/document-style-presets.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/native-markdown.js`, asset: "core/native-markdown.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/table-fragmentation.js`, asset: "core/table-fragmentation.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/prisma-renderer.js`, asset: "core/prisma-renderer.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/simple-markdown.js`, asset: "core/simple-markdown.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/prefs-controller.js`, asset: "ui/prefs-controller.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/host.js`, asset: "ui/host.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/app.js`, asset: "ui/app.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/deferred-load.js`, asset: "ui/deferred-load.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/searchable-autocomplete.js`, asset: "ui/searchable-autocomplete.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/explore-markdown.js`, asset: "ui/explore-markdown.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/text-utils.js`, asset: "ui/text-utils.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/automation.js`, asset: "ui/automation.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/harvest.js`, asset: "ui/harvest.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/embeddings.js`, asset: "ui/embeddings.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/semantic.js`, asset: "ui/semantic.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/extraction.js`, asset: "ui/extraction.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/screening.js`, asset: "ui/screening.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
		{ path: `${ENDPOINT_PREFIX}/ui/prisma.js`, asset: "ui/prisma.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
			{ path: `${ENDPOINT_PREFIX}/ui/explore.js`, asset: "ui/explore.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
			{ path: `${ENDPOINT_PREFIX}/ui/settings.js`, asset: "ui/settings.js", type: "application/javascript; charset=utf-8", access: "ui_session" },
			{ path: `${ENDPOINT_PREFIX}/about/manifest.json`, asset: "manifest.json", type: "application/json; charset=utf-8", access: "ui_session" },
			{ path: `${ENDPOINT_PREFIX}/about/license.txt`, asset: "LICENSE", type: "text/plain; charset=utf-8", access: "ui_session" },
			{ path: `${ENDPOINT_PREFIX}/about/third-party-notices.txt`, asset: "licenses/THIRD_PARTY_NOTICES.txt", type: "text/plain; charset=utf-8", access: "ui_session" },
			{ path: `${ENDPOINT_PREFIX}/about/third-party-licenses.txt`, asset: "licenses/LICENSES.txt", type: "text/plain; charset=utf-8", access: "ui_session" },
		];

	let reviewer = null;
	let registered = false;
	let appServer = null;
	let routeRegistry = new Map();
	let serverPort = 0;
	let unlocked = false;
	let devServerEnabled = false;
	let internalServiceToken = "";
	let uiLaunchTokens = new Map();
	let uiSessions = new Map();

	function devBundlePresent() {
		if (typeof SystematicReviewerBootstrapOptionalBundles != "undefined") {
			return SystematicReviewerBootstrapOptionalBundles?.dev_tools_bundle_present !== false;
		}
		return typeof SystematicReviewerOptionalDevRuntime != "undefined"
			|| typeof SystematicReviewerAgentDevTools != "undefined";
	}

	function normalizePrivilegedToolSettings(raw = null) {
		let source = raw && typeof raw == "object" ? raw : {};
		return {
			dev_tools_enabled: source.dev_tools_enabled === true,
		};
	}

	function computeUnlockedMode() {
		return devBundlePresent() && devServerEnabled;
	}

	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function statusText(status = 200) {
		return STATUS_TEXT[Number(status) || 200] || "OK";
	}

	function nextToken(prefix = "sr") {
		let uuid = String(Services.uuid.generateUUID()).replace(/[{}]/g, "").toLowerCase();
		return `${prefix}-${uuid}`;
	}

	function expireEntries(store, now = Date.now()) {
		for (let [key, entry] of store.entries()) {
			let expiresAt = Number(entry?.expires_at || 0) || 0;
			if (expiresAt && expiresAt <= now) {
				store.delete(key);
			}
		}
	}

	function resetTokenState() {
		uiLaunchTokens = new Map();
		uiSessions = new Map();
		internalServiceToken = nextToken("srsvc");
	}

	function currentServiceToken() {
		if (!internalServiceToken) {
			internalServiceToken = nextToken("srsvc");
		}
		return internalServiceToken;
	}

	function mintUILaunchToken(meta = {}) {
		let token = nextToken("srlaunch");
		uiLaunchTokens.set(token, {
			token,
			meta: meta && typeof meta == "object" ? Object.assign({}, meta) : {},
			created_at: new Date().toISOString(),
			expires_at: Date.now() + UI_LAUNCH_TOKEN_TTL_MS,
		});
		return token;
	}

	function createUISession(meta = {}) {
		let token = nextToken("srsession");
		uiSessions.set(token, {
			token,
			meta: meta && typeof meta == "object" ? Object.assign({}, meta) : {},
			created_at: new Date().toISOString(),
			expires_at: Date.now() + UI_SESSION_TTL_MS,
		});
		return token;
	}

	function queryParams(request) {
		let raw = optionalString(request?.queryString || "");
		return new URLSearchParams(raw);
	}

	function requestPath(request) {
		let raw = optionalString(request?.path || "");
		let idx = raw.indexOf("?");
		return idx >= 0 ? raw.slice(0, idx) : raw;
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
			"Cookie",
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
			let raw = scriptable.read(length) || "";
			if (!raw) {
				return "";
			}
			let bytes = new Uint8Array(raw.length);
			for (let index = 0; index < raw.length; index += 1) {
				bytes[index] = raw.charCodeAt(index) & 0xff;
			}
			return new TextDecoder("utf-8").decode(bytes);
		}
		finally {
			try {
				scriptable.close();
			}
			catch (_error) {}
		}
	}

	function readRequestJSON(request) {
		let raw = optionalString(readRequestBody(request));
		if (!raw) {
			return {};
		}
		return JSON.parse(raw);
	}

	function parseCookies(value = "") {
		let cookies = {};
		for (let entry of String(value || "").split(";")) {
			let idx = entry.indexOf("=");
			if (idx <= 0) {
				continue;
			}
			let key = decodeURIComponent(entry.slice(0, idx).trim());
			let rawValue = entry.slice(idx + 1).trim();
			if (!key) {
				continue;
			}
			try {
				cookies[key] = decodeURIComponent(rawValue);
			}
			catch (_error) {
				cookies[key] = rawValue;
			}
		}
		return cookies;
	}

	function bearerToken(request) {
		let raw = readKnownHeader(request, "Authorization");
		let match = raw.match(/^Bearer\s+(.+)$/i);
		return optionalString(match?.[1] || "");
	}

	function uiSessionTokenFromRequest(request) {
		let cookies = parseCookies(readKnownHeader(request, "Cookie"));
		return optionalString(cookies[UI_COOKIE_NAME] || "");
	}

	function validateUISessionToken(token = "") {
		expireEntries(uiSessions);
		let clean = optionalString(token);
		if (!clean) {
			return null;
		}
		let session = uiSessions.get(clean) || null;
		if (!session) {
			return null;
		}
		session.expires_at = Date.now() + UI_SESSION_TTL_MS;
		return session;
	}

	function consumeLaunchToken(request) {
		expireEntries(uiLaunchTokens);
		let clean = optionalString(queryParams(request).get(UI_LAUNCH_TOKEN_PARAM) || "");
		if (!clean) {
			return null;
		}
		let entry = uiLaunchTokens.get(clean) || null;
		if (!entry) {
			return null;
		}
		uiLaunchTokens.delete(clean);
		return entry;
	}

	function uiSessionCookieValue(token = "") {
		let clean = optionalString(token);
		if (!clean) {
			return "";
		}
		return `${UI_COOKIE_NAME}=${encodeURIComponent(clean)}; Max-Age=${Math.round(UI_SESSION_TTL_MS / 1000)}; Path=${UI_COOKIE_PATH}; HttpOnly; SameSite=Strict`;
	}

	function isAuthorizedForAccess(request, access = "ui_session") {
		let kind = optionalString(access || "ui_session") || "ui_session";
		if (kind == "public") {
			return unlocked ? { ok: true, mode: "dev" } : { ok: true, mode: "public" };
		}
		let session = validateUISessionToken(uiSessionTokenFromRequest(request));
		if (kind == "ui_launch") {
			if (session) {
				return { ok: true, mode: "ui_session", session };
			}
			let launch = consumeLaunchToken(request);
			if (!launch) {
				return { ok: false, status: 403, message: "Systematic Reviewer UI must be opened from Zotero." };
			}
			return {
				ok: true,
				mode: "ui_launch",
				launch,
				session_token: createUISession(launch.meta || {}),
			};
		}
		if (kind == "service") {
			if (bearerToken(request) == currentServiceToken()) {
				return { ok: true, mode: "service" };
			}
			return unlocked
				? { ok: true, mode: "dev" }
				: { ok: false, status: 401, message: "Missing or invalid internal service token." };
		}
		if (session) {
			return { ok: true, mode: "ui_session", session };
		}
		if (kind == "ui_or_service") {
			if (bearerToken(request) == currentServiceToken()) {
				return { ok: true, mode: "service" };
			}
			return unlocked
				? { ok: true, mode: "dev" }
				: { ok: false, status: 401, message: "Missing or invalid UI session or internal service token." };
		}
		return unlocked
			? { ok: true, mode: "dev" }
			: { ok: false, status: 403, message: "Systematic Reviewer UI session is required." };
	}

	function baseResponseHeaders(contentType = "application/json; charset=utf-8", extra = {}) {
		return Object.assign({
			"Content-Type": contentType,
			"Cache-Control": "no-cache",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Requested-With, MCP-Protocol-Version, MCP-Session-Id",
			"Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
		}, extra || {});
	}

	function writeResponse(response, request, status = 200, headers = {}, body = "") {
		response.setStatusLine(request?.httpVersion || "1.1", status, statusText(status));
		for (let [name, value] of Object.entries(headers || {})) {
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

	function sendJSON(response, request, status = 200, payload = {}, extraHeaders = {}) {
		writeResponse(
			response,
			request,
			status,
			baseResponseHeaders("application/json; charset=utf-8", extraHeaders),
			`${JSON.stringify(payload || {}, null, 2)}\n`
		);
	}

	function sendText(response, request, status = 200, contentType = "text/plain; charset=utf-8", body = "", extraHeaders = {}) {
		writeResponse(response, request, status, baseResponseHeaders(contentType, extraHeaders), body);
	}

	function sendEmpty(response, request, status = 204, extraHeaders = {}) {
		writeResponse(response, request, status, baseResponseHeaders("text/plain; charset=utf-8", extraHeaders), "");
	}

	function sendError(response, request, status = 400, message = "", code = "invalid_request_error", extraHeaders = {}) {
		sendJSON(response, request, status, {
			error: {
				message: optionalString(message) || "Unknown error.",
				type: optionalString(code) || "invalid_request_error",
			},
		}, extraHeaders);
	}

	function openAsyncUTF8Writer(response) {
		let stream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
			.createInstance(Components.interfaces.nsIConverterOutputStream);
		response.processAsync();
		stream.init(response.bodyOutputStream, "UTF-8", 1024, "?".charCodeAt(0));
		return stream;
	}

	function closeAsyncWriter(response, writer) {
		try {
			writer?.close?.();
		}
		catch (_error) {}
		try {
			response.finish();
		}
		catch (_error) {}
	}

	async function writeSSEEvent(writer, payload = {}) {
		try {
			writer.writeString(`data: ${JSON.stringify(payload)}\n\n`);
			try {
				writer.flush?.();
			}
			catch (_error) {}
		}
		catch (_error) {}
	}

	function readZipEntry(zipFilePath, entryPath) {
		let zipFile = reviewer._nsIFile(zipFilePath);
		let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
			.createInstance(Components.interfaces.nsIZipReader);
		let converter = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
			.createInstance(Components.interfaces.nsIConverterInputStream);
		try {
			zipReader.open(zipFile);
			if (!zipReader.hasEntry(entryPath)) {
				throw new Error(`Missing packaged asset: ${entryPath}`);
			}
			let stream = zipReader.getInputStream(entryPath);
			converter.init(
				stream,
				"UTF-8",
				0,
				Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER
			);
			let out = "";
			let chunk = {};
			while (converter.readString(0xffffffff, chunk) > 0) {
				out += chunk.value;
			}
			return out;
		}
		finally {
			try {
				converter.close();
			}
			catch (_err) {}
			try {
				zipReader.close();
			}
			catch (_err) {}
		}
	}

	async function readAssetText(assetPath) {
		let root = String(reviewer?.rootURI || "");
		if (root.startsWith("jar:")) {
			let match = root.match(/^jar:(file:[^!]+)!\/?$/);
			if (match?.[1]) {
				let fileURL = Services.io.newURI(match[1]).QueryInterface(Components.interfaces.nsIFileURL);
				return readZipEntry(fileURL.file.path, assetPath);
			}
		}
		if (root.startsWith("file:")) {
			let fileURL = Services.io
				.newURI(`${root}${assetPath}`)
				.QueryInterface(Components.interfaces.nsIFileURL);
			return await reviewer._readFileText(fileURL.file.path);
		}
		throw new Error(`Unsupported extension root URI: ${root}`);
	}

	function bindLoopback(server, preferredPort = APP_PREFERRED_PORT) {
		try {
			server.start(preferredPort);
		}
		catch (_error) {
			server.start(-1);
		}
	}

	function getBaseURL() {
		return serverPort ? `http://${APP_PUBLIC_HOST}:${serverPort}` : "";
	}

	function getStreamBaseURL() {
		return getBaseURL();
	}

	function serverStatus() {
		let devBundle = devBundlePresent();
		return {
			running: !!serverPort,
			host: APP_HOST,
			port: Number(serverPort || 0) || 0,
			base_url: getBaseURL(),
			preferred_port: APP_PREFERRED_PORT,
			mode: unlocked ? "unlocked" : "locked",
			mode_label: unlocked
				? "Developer tools unlocked"
				: "Locked",
			dev_bundle_present: devBundle,
			dev_tools_enabled: !!devServerEnabled,
			internal_only: !unlocked,
		};
	}

	function applySettings(raw = null) {
		let settings = normalizePrivilegedToolSettings(raw);
		devServerEnabled = settings.dev_tools_enabled === true;
		unlocked = computeUnlockedMode();
	}

	function localExecRoleBasePath(roleID = "") {
		let cleanRoleID = String(roleID || "").trim();
		if (!cleanRoleID) {
			throw new Error("roleID is required.");
		}
		return `${ENDPOINT_PREFIX}/runtime/roles/${cleanRoleID}`;
	}

	function localExecResponsesPath(roleID = "") {
		return `${localExecRoleBasePath(roleID)}/responses`;
	}

	function workflowLaunchURLToken(meta = {}) {
		return mintUILaunchToken(meta);
	}

	function createEndpointPathHandler(EndpointCtor) {
		return async function endpointPathHandler(request, response) {
			let endpoint = new EndpointCtor();
			let method = optionalString(request?.method || "GET").toUpperCase();
			let supportedMethods = Array.isArray(endpoint?.supportedMethods) ? endpoint.supportedMethods.map((entry) => optionalString(entry).toUpperCase()).filter(Boolean) : [];
			if (supportedMethods.length && !supportedMethods.includes(method)) {
				sendError(response, request, 405, "Endpoint does not support method.");
				return;
			}
			let payload = undefined;
			if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
				let raw = readRequestBody(request);
				if (raw) {
					let contentType = readKnownHeader(request, "Content-Type").toLowerCase();
					if (contentType.includes("application/json")) {
						try {
							payload = JSON.parse(raw);
						}
						catch (error) {
							sendError(response, request, 400, error?.message || "Request body must be valid JSON.");
							return;
						}
					}
					else {
						payload = raw;
					}
				}
			}
			let result = await endpoint.init({
				method,
				headers: readRequestHeaders(request),
				data: payload,
				query: queryParams(request),
				path: requestPath(request),
				httpVersion: request?.httpVersion || "1.1",
			});
			if (Array.isArray(result) && result.length >= 3) {
				let [status, headersOrType, body] = result;
				if (headersOrType && typeof headersOrType == "object" && !Array.isArray(headersOrType)) {
					writeResponse(response, request, status, headersOrType, body);
					return;
				}
				sendText(response, request, status, String(headersOrType || "text/plain; charset=utf-8"), body);
				return;
			}
			sendJSON(response, request, 200, result || {});
		};
	}

	function registerPathHandler(path = "", handler = null, options = {}) {
		let cleanPath = optionalString(path);
		if (!cleanPath || typeof handler != "function") {
			return;
		}
		routeRegistry.set(cleanPath, {
			handler,
			options: Object.assign({}, options || {}),
		});
		if (appServer) {
			appServer.registerPathHandler(cleanPath, createRegisteredRouteHandler(cleanPath));
		}
	}

	function registerEndpoint(path = "", EndpointCtor = null, options = {}) {
		if (!EndpointCtor) {
			return;
		}
		registerPathHandler(path, createEndpointPathHandler(EndpointCtor), options);
	}

	function unregisterPathHandler(path = "") {
		let cleanPath = optionalString(path);
		if (!cleanPath) {
			return;
		}
		routeRegistry.delete(cleanPath);
		if (appServer) {
			appServer.registerPathHandler(cleanPath, function RemovedRouteHandler(request, response) {
				sendError(response, request, 404, "Not found.", "not_found");
			});
		}
	}

	function createRegisteredRouteHandler(path = "") {
		return function registeredRouteHandler(request, response) {
			let route = routeRegistry.get(optionalString(path)) || null;
			let run = async () => {
				if (!route?.handler) {
					sendError(response, request, 404, "Not found.", "not_found");
					return;
				}
				let method = optionalString(request?.method || "GET").toUpperCase();
				let access = optionalString(route?.options?.access || "ui_or_service") || "ui_or_service";
				if (!(route?.options?.dev_only) || unlocked) {
					if (method != "OPTIONS") {
						let auth = isAuthorizedForAccess(request, access);
						if (!auth.ok) {
							sendError(response, request, Number(auth.status || 403) || 403, auth.message || "Forbidden.", "access_denied");
							return;
						}
						request._srAccess = auth;
					}
				}
				else {
					sendError(response, request, 404, "Not found.", "not_found");
					return;
				}
				await route.handler(request, response);
			};
			if (route?.options?.managed_async) {
				run().catch((error) => {
					sendError(response, request, 500, error?.message || String(error), "internal_error");
				});
				return;
			}
			response.processAsync();
			Promise.resolve(run())
				.catch((error) => {
					sendError(response, request, 500, error?.message || String(error), "internal_error");
				})
				.finally(() => {
					try {
						response.finish();
					}
					catch (_error) {}
				});
		};
	}

	function startServer() {
		stopServer();
		appServer = new HttpServer();
		for (let path of routeRegistry.keys()) {
			appServer.registerPathHandler(path, createRegisteredRouteHandler(path));
		}
		bindLoopback(appServer, APP_PREFERRED_PORT);
		serverPort = Number(appServer?.identity?.primaryPort || 0) || 0;
		if (reviewer && serverPort) {
			reviewer.log(`workflow app server ready on ${APP_HOST}:${serverPort} (${unlocked ? "unlocked" : "locked"})`);
		}
	}

	function stopServer() {
		if (!appServer) {
			serverPort = 0;
			return;
		}
		try {
			appServer.stop();
		}
		catch (_error) {}
		appServer = null;
		serverPort = 0;
	}

	function registerCoreRoutes() {
		registerEndpoint(`${ENDPOINT_PREFIX}/ping`, PingEndpoint, { access: "ui_or_service" });
		registerEndpoint(`${ENDPOINT_PREFIX}/commands/list`, CommandsListEndpoint, { access: "ui_or_service" });
		registerEndpoint(`${ENDPOINT_PREFIX}/commands/call`, CommandCallEndpoint, { access: "ui_or_service" });
		registerPathHandler(AUTOMATION_CHAT_STREAM_PATH, handleAutomationChatStreamRequest, { access: "ui_or_service", managed_async: true });
		for (let roleID of ["session_chat", "data_extraction"]) {
			registerPathHandler(localExecResponsesPath(roleID), createLocalExecResponsesPathHandler(roleID), { access: "service", managed_async: true });
		}
		for (let entry of ASSET_DEFINITIONS) {
			registerPathHandler(entry.path, createAssetPathHandler(entry), { access: entry.access || "ui_session" });
		}
	}

	function register(nextReviewer) {
		if (!nextReviewer) {
			return;
		}
		unregister();
		reviewer = nextReviewer;
		applySettings(nextReviewer.cachedGlobalSettings?.privileged_tools || null);
		resetTokenState();
		registerCoreRoutes();
		startServer();
		registered = true;
	}

	function unregister() {
		stopServer();
		routeRegistry = new Map();
		resetTokenState();
		reviewer = null;
		registered = false;
		unlocked = false;
		devServerEnabled = false;
	}

	function createAssetPathHandler(entry = {}) {
		return async function assetPathHandler(request, response) {
			let method = optionalString(request?.method || "GET").toUpperCase();
			if (method == "OPTIONS") {
				sendEmpty(response, request, 204);
				return;
			}
			if (method != "GET") {
				sendError(response, request, 405, "Endpoint does not support method.");
				return;
			}
			let access = request?._srAccess || null;
			let extraHeaders = {};
			if ((entry.access || "") == "ui_launch" && access?.session_token) {
				extraHeaders["Set-Cookie"] = uiSessionCookieValue(access.session_token);
			}
			try {
				sendText(response, request, 200, entry.type, await readAssetText(entry.asset), extraHeaders);
			}
			catch (error) {
				sendText(response, request, 500, "text/plain; charset=utf-8", `Asset load failed: ${error?.message || String(error)}\n`, extraHeaders);
			}
		};
	}

	function jsonResponse(status, payload) {
		return [status, "application/json; charset=utf-8", `${JSON.stringify(payload, null, 2)}\n`];
	}

	function textResponse(status, type, body) {
		return [status, type, body];
	}

	function errorResponse(status, message, code = "invalid_request_error") {
		return jsonResponse(status, {
			error: {
				message: optionalString(message) || "Unknown error.",
				type: optionalString(code) || "invalid_request_error",
			},
		});
	}

	function PingEndpoint() {}
	PingEndpoint.prototype = {
		supportedMethods: ["GET"],
		supportedDataTypes: ["application/json"],
		init(_request) {
			return jsonResponse(200, {
				ok: true,
				base_url: getBaseURL(),
				namespace: reviewer?.namespace || "systematic-reviewer",
				endpoints: {
					ping: `${ENDPOINT_PREFIX}/ping`,
					commands_list: `${ENDPOINT_PREFIX}/commands/list`,
					commands_call: `${ENDPOINT_PREFIX}/commands/call`,
					ui: `${ENDPOINT_PREFIX}/ui/index.html`,
				},
			});
		},
	};

	function CommandsListEndpoint() {}
	CommandsListEndpoint.prototype = {
		supportedMethods: ["GET"],
		supportedDataTypes: ["application/json"],
		init(_request) {
			return jsonResponse(200, {
				ok: true,
				commands: SystematicReviewerWorkflowCommands.list(),
			});
		},
	};

	function CommandCallEndpoint() {}
	CommandCallEndpoint.prototype = {
		supportedMethods: ["POST"],
		supportedDataTypes: ["application/json"],
		async init(options) {
			try {
				let commandID = String(
					options?.data?.command ||
					options?.data?.commandId ||
					options?.data?.tool ||
					""
				).trim();
				if (!commandID) {
					return jsonResponse(400, {
						ok: false,
						error: "Request body must include command.",
					});
				}
				let payload = options?.data?.payload;
				if (payload === undefined && Object.prototype.hasOwnProperty.call(options?.data || {}, "args")) {
					payload = options.data.args;
				}
				if (typeof payload == "string") {
					payload = JSON.parse(payload || "{}");
				}
				let result = await SystematicReviewerWorkflowCommands.call(commandID, payload || {});
				return jsonResponse(200, {
					ok: true,
					command: commandID,
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

	async function handleAutomationChatStreamRequest(request, response) {
		let method = optionalString(request?.method || "POST").toUpperCase();
		if (method == "OPTIONS") {
			sendEmpty(response, request, 204);
			return;
		}
		if (method != "POST") {
			sendError(response, request, 400, "Endpoint does not support method.");
			return;
		}
		let payload = {};
		try {
			payload = readRequestJSON(request);
		}
		catch (error) {
			sendError(response, request, 400, error?.message || "Request body must be valid JSON.");
			return;
		}
		response.setStatusLine(request.httpVersion || "1.1", 200, "OK");
		for (let [name, value] of Object.entries(baseResponseHeaders("text/event-stream; charset=utf-8", {
			"Cache-Control": "no-cache, no-transform",
			"Connection": "keep-alive",
		}))) {
			response.setHeader(name, String(value), false);
		}
		let writer = openAsyncUTF8Writer(response);
		try {
			let result = await SystematicReviewerWorkflowCommands.streamAutomationChat(payload || {}, {
				onEvent: async (event) => {
					await writeSSEEvent(writer, event || {});
				},
			});
			await writeSSEEvent(writer, {
				type: "stream.complete",
				result,
			});
		}
		catch (error) {
			await writeSSEEvent(writer, {
				type: "stream.error",
				error: {
					message: error?.message || String(error),
				},
			});
		}
		finally {
			closeAsyncWriter(response, writer);
		}
	}

	function createLocalExecResponsesPathHandler(roleID) {
		return async function localExecResponsesPathHandler(request, response) {
			let method = optionalString(request?.method || "POST").toUpperCase();
			if (method == "OPTIONS") {
				sendEmpty(response, request, 204);
				return;
			}
			if (method != "POST") {
				sendError(response, request, 400, "Endpoint does not support method.");
				return;
			}
			let payload = {};
			try {
				payload = readRequestJSON(request);
			}
			catch (error) {
				sendError(response, request, 400, error?.message || "Request body must be valid JSON.");
				return;
			}
			if (!payload || typeof payload != "object") {
				sendError(response, request, 400, "Request body must be valid JSON.");
				return;
			}
			if (payload.stream !== true) {
				try {
					let result = await reviewer._handleLocalExecResponsesRequest(roleID, payload);
					sendJSON(response, request, 200, result);
				}
				catch (error) {
					let message = error?.message || String(error);
					let lowered = String(message || "").toLowerCase();
					let status = lowered.includes("not configured") || lowered.includes("not installed") || lowered.includes("runtime type")
						? 400
						: lowered.includes("timed out")
							? 504
							: 500;
					sendError(response, request, status, message, status == 504 ? "timeout_error" : "invalid_request_error");
				}
				return;
			}
			response.setStatusLine(request.httpVersion || "1.1", 200, "OK");
			for (let [name, value] of Object.entries(baseResponseHeaders("text/event-stream; charset=utf-8", {
				"Cache-Control": "no-cache, no-transform",
				"Connection": "keep-alive",
			}))) {
				response.setHeader(name, String(value), false);
			}
			let writer = openAsyncUTF8Writer(response);
			try {
				await reviewer._handleLocalExecResponsesStreamRequest(roleID, payload, {
					onEvent: async (event) => {
						await writeSSEEvent(writer, event || {});
					},
				});
			}
			catch (error) {
				await writeSSEEvent(writer, {
					type: "response.error",
					error: {
						message: error?.message || String(error),
					},
				});
			}
			finally {
				closeAsyncWriter(response, writer);
			}
		};
	}

	return {
		register,
		unregister,
		applySettings,
		registerPathHandler,
		unregisterPathHandler,
		registerEndpoint,
		getBaseURL,
		getStreamBaseURL,
		getPort: () => Number(serverPort || 0) || 0,
		getStatus: () => serverStatus(),
		isUnlocked: () => !!unlocked,
		getInternalServiceToken: () => currentServiceToken(),
		mintUILaunchToken: (meta = {}) => workflowLaunchURLToken(meta || {}),
			localExecRoleBasePath,
			localExecResponsesPath,
			automationChatStreamPath: AUTOMATION_CHAT_STREAM_PATH,
			basePath: ENDPOINT_PREFIX,
		};
})();
