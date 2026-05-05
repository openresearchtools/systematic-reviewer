var SystematicReviewer;
var SystematicReviewerBootstrapOptionalBundles = {
	privileged_tools_loaded: false,
	shell_tools_loaded: false,
	browser_tools_loaded: false,
	dev_tools_loaded: false,
	dev_tools_bundle_present: true,
};

function _log(msg) {
	Zotero.debug(`Systematic Reviewer: ${msg}`);
}

function install() {
	_log("Installed");
}

function _isMissingOptionalSubScriptError(error) {
	let text = `${String(error?.name || "")} ${String(error?.message || error || "")}`;
	return /NS_ERROR_FILE_NOT_FOUND/i.test(text)
		|| /not found/i.test(text)
		|| /No such file/i.test(text)
		|| /can't access script/i.test(text);
}

function _privilegedSettingsPath() {
	let file = Components.classes["@mozilla.org/file/local;1"]
		.createInstance(Components.interfaces.nsIFile);
	file.initWithPath(Zotero.DataDirectory.dir);
	for (let part of ["systematic-reviewer", "config", "settings.json"]) {
		file.append(part);
	}
	return file.path;
}

function _readBootstrapTextFile(path) {
	try {
		let file = Components.classes["@mozilla.org/file/local;1"]
			.createInstance(Components.interfaces.nsIFile);
		file.initWithPath(path);
		if (!file.exists() || !file.isFile()) {
			return "";
		}
		let input = Components.classes["@mozilla.org/network/file-input-stream;1"]
			.createInstance(Components.interfaces.nsIFileInputStream);
		let converter = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
			.createInstance(Components.interfaces.nsIConverterInputStream);
		input.init(file, 0x01, 0, 0);
		converter.init(input, "UTF-8", 0, 0);
		let data = "";
		let chunk = {};
		while (converter.readString(0xffffffff, chunk) > 0) {
			data += chunk.value || "";
		}
		try {
			converter.close();
		}
		catch (_error) {}
		try {
			input.close();
		}
		catch (_error) {}
		return data;
	}
	catch (_error) {
		return "";
	}
}

async function _readBootstrapPrivilegedSettings() {
	let defaults = {
		shell_enabled: false,
		browser_enabled: false,
		dev_tools_enabled: false,
		default_timeout_ms: 300000,
	};
	let path = _privilegedSettingsPath();
	try {
		let raw = _readBootstrapTextFile(path);
		if (!raw && typeof IOUtils != "undefined" && IOUtils?.readUTF8) {
			raw = await IOUtils.readUTF8(path);
		}
		else if (!raw && typeof Zotero != "undefined" && Zotero?.File?.getContentsAsync) {
			raw = await Zotero.File.getContentsAsync(path);
		}
		if (!raw) {
			return defaults;
		}
		let parsed = JSON.parse(String(raw || ""));
		let privileged = parsed?.privileged_tools && typeof parsed.privileged_tools == "object"
			? parsed.privileged_tools
			: {};
		let legacyServerSecurity = parsed?.server_security && typeof parsed.server_security == "object"
			? parsed.server_security
			: {};
		return {
			shell_enabled: privileged.shell_enabled === true,
			browser_enabled: privileged.browser_enabled === true,
			dev_tools_enabled: privileged.dev_tools_enabled === true || legacyServerSecurity.dev_server_enabled === true,
			default_timeout_ms: Number(privileged.default_timeout_ms || defaults.default_timeout_ms) || defaults.default_timeout_ms,
		};
	}
	catch (_error) {}
	return defaults;
}

function _optionalSubScriptExists(rootURI, relativePath) {
	try {
		let uri = Services.io.newURI(String(rootURI || "") + String(relativePath || ""));
		let scheme = String(uri?.scheme || "").toLowerCase();
		if (scheme == "file") {
			let fileURI = uri.QueryInterface(Components.interfaces.nsIFileURL);
			return fileURI.file?.exists?.() === true;
		}
		if (scheme == "jar") {
			let jarURI = uri.QueryInterface(Components.interfaces.nsIJARURI);
			let jarFile = jarURI?.JARFile?.QueryInterface(Components.interfaces.nsIFileURL)?.file || null;
			let entry = String(jarURI?.JAREntry || "").replace(/^\/+/, "");
			if (!jarFile?.exists?.() || !entry) {
				return false;
			}
			let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
				.createInstance(Components.interfaces.nsIZipReader);
			try {
				zipReader.open(jarFile);
				return zipReader.hasEntry(entry);
			}
			finally {
				try {
					zipReader.close();
				}
				catch (_error) {}
			}
		}
	}
	catch (_error) {}
	return false;
}

async function _loadPrivilegedToolingBundle(rootURI, settings = null) {
	settings = settings || await _readBootstrapPrivilegedSettings();
	if (settings.shell_enabled !== true && settings.browser_enabled !== true) {
		_log("privileged tools bundle not loaded");
		return;
	}
	try {
		Services.scriptloader.loadSubScript(rootURI + "privileged-tools/registry.js");
		if (settings.shell_enabled === true) {
			Services.scriptloader.loadSubScript(rootURI + "privileged-tools/prompts.js");
			Services.scriptloader.loadSubScript(rootURI + "privileged-tools/shell-tools.js");
		}
		SystematicReviewerBootstrapOptionalBundles.privileged_tools_loaded = true;
		SystematicReviewerBootstrapOptionalBundles.shell_tools_loaded = settings.shell_enabled === true;
		_log("privileged tools bundle loaded");
	}
	catch (error) {
		if (_isMissingOptionalSubScriptError(error)) {
			_log("privileged tools bundle requested but not found");
			return;
		}
		throw error;
	}
}

async function _loadPrivilegedBrowserBundle(rootURI, settings = null) {
	settings = settings || await _readBootstrapPrivilegedSettings();
	if (settings.browser_enabled !== true) {
		_log("privileged browser bundle not loaded");
		return;
	}
	try {
		Services.scriptloader.loadSubScript(rootURI + "privileged-tools/browser/prompts.js");
		Services.scriptloader.loadSubScript(rootURI + "privileged-tools/browser/controller.js");
		Services.scriptloader.loadSubScript(rootURI + "privileged-tools/browser/tools.js");
		SystematicReviewerBootstrapOptionalBundles.browser_tools_loaded = true;
		_log("privileged browser bundle loaded");
	}
	catch (error) {
		if (_isMissingOptionalSubScriptError(error)) {
			_log("privileged browser bundle requested but not found");
			return;
		}
		throw error;
	}
}

async function _loadOptionalDevToolingBundle(rootURI, settings = null) {
	settings = settings || await _readBootstrapPrivilegedSettings();
	SystematicReviewerBootstrapOptionalBundles.dev_tools_bundle_present = _optionalSubScriptExists(rootURI, "dev/agent-dev-tools.js");
	if (settings.dev_tools_enabled !== true) {
		_log("dev tooling bundle not loaded");
		return;
	}
	try {
		Services.scriptloader.loadSubScript(rootURI + "dev/agent-dev-tools.js");
		SystematicReviewerBootstrapOptionalBundles.dev_tools_loaded = true;
		_log("dev tooling bundle loaded");
	}
	catch (error) {
		SystematicReviewerBootstrapOptionalBundles.dev_tools_bundle_present = false;
		if (_isMissingOptionalSubScriptError(error)) {
			_log("dev tooling bundle requested but not found");
			return;
		}
		throw error;
	}
}

async function startup({ id, version, rootURI }) {
	_log(`Starting ${version}`);
	try {
		let privilegedSettings = await _readBootstrapPrivilegedSettings();
		SystematicReviewerBootstrapOptionalBundles.privileged_tools_loaded = false;
		SystematicReviewerBootstrapOptionalBundles.shell_tools_loaded = false;
		SystematicReviewerBootstrapOptionalBundles.browser_tools_loaded = false;
		SystematicReviewerBootstrapOptionalBundles.dev_tools_loaded = false;
		Services.scriptloader.loadSubScript(rootURI + "core/constants.js");
		Services.scriptloader.loadSubScript(rootURI + "core/text-file-tools.js");
		Services.scriptloader.loadSubScript(rootURI + "core/manifest.js");
		Services.scriptloader.loadSubScript(rootURI + "core/search-options.js");
		Services.scriptloader.loadSubScript(rootURI + "core/workflow-artifacts.js");
		Services.scriptloader.loadSubScript(rootURI + "core/openalex.js");
			Services.scriptloader.loadSubScript(rootURI + "core/jobs.js");
			Services.scriptloader.loadSubScript(rootURI + "core/harvest.js");
			Services.scriptloader.loadSubScript(rootURI + "core/embeddings.js");
			Services.scriptloader.loadSubScript(rootURI + "core/full-text-rag.js");
		Services.scriptloader.loadSubScript(rootURI + "core/document-search.js");
		Services.scriptloader.loadSubScript(rootURI + "core/semantic-search.js");
		Services.scriptloader.loadSubScript(rootURI + "core/full-text-workflow.js");
		Services.scriptloader.loadSubScript(rootURI + "core/extraction-templates.js");
		Services.scriptloader.loadSubScript(rootURI + "core/extraction.js");
		Services.scriptloader.loadSubScript(rootURI + "core/screening.js");
		Services.scriptloader.loadSubScript(rootURI + "core/descriptives.js");
		Services.scriptloader.loadSubScript(rootURI + "core/prisma-renderer.js");
		Services.scriptloader.loadSubScript(rootURI + "core/prisma.js");
		Services.scriptloader.loadSubScript(rootURI + "core/explore.js");
		Services.scriptloader.loadSubScript(rootURI + "core/prefs-host.js");
		Services.scriptloader.loadSubScript(rootURI + "core/workflow-browser-appearance.js");
		Services.scriptloader.loadSubScript(rootURI + "core/workflow-host.js");
		Services.scriptloader.loadSubScript(rootURI + "core/db-utils.js");
		Services.scriptloader.loadSubScript(rootURI + "core/token-budget.js");
		Services.scriptloader.loadSubScript(rootURI + "core/projects.js");
		Services.scriptloader.loadSubScript(rootURI + "core/sessions.js");
		Services.scriptloader.loadSubScript(rootURI + "core/citations.js");
		Services.scriptloader.loadSubScript(rootURI + "core/markdown-rendering.js");
		Services.scriptloader.loadSubScript(rootURI + "core/editor-settings.js");
		Services.scriptloader.loadSubScript(rootURI + "core/attachment-viewer-router.js");
		Services.scriptloader.loadSubScript(rootURI + "core/item-identity.js");
		Services.scriptloader.loadSubScript(rootURI + "core/jobs-host.js");
		Services.scriptloader.loadSubScript(rootURI + "core/jobs-runtime.js");
			Services.scriptloader.loadSubScript(rootURI + "core/native-editor.js");
			Services.scriptloader.loadSubScript(rootURI + "core/markdown-viewer-host.js");
			Services.scriptloader.loadSubScript(rootURI + "core/markdown-viewer-pdf.js");
			Services.scriptloader.loadSubScript(rootURI + "core/markdown-only-viewer-host.js");
			Services.scriptloader.loadSubScript(rootURI + "core/text-attachment-viewer-host.js");
			Services.scriptloader.loadSubScript(rootURI + "core/csv-attachment-viewer-host.js");
			Services.scriptloader.loadSubScript(rootURI + "core/observers.js");
		Services.scriptloader.loadSubScript(rootURI + "core/platform-utils.js");
		Services.scriptloader.loadSubScript(rootURI + "core/project-entry.js");
		Services.scriptloader.loadSubScript(rootURI + "core/project-storage.js");
		Services.scriptloader.loadSubScript(rootURI + "core/runtime-settings.js");
		Services.scriptloader.loadSubScript(rootURI + "core/mcp-client.js");
		Services.scriptloader.loadSubScript(rootURI + "core/local-exec-responses-bridge.js");
		Services.scriptloader.loadSubScript(rootURI + "core/chat-completions-responses-bridge.js");
		Services.scriptloader.loadSubScript(rootURI + "core/tab-locator.js");
		Services.scriptloader.loadSubScript(rootURI + "core/window-host.js");
		Services.scriptloader.loadSubScript(rootURI + "core/workspace-controller.js");
		Services.scriptloader.loadSubScript(rootURI + "automation/docs-loader.js");
		Services.scriptloader.loadSubScript(rootURI + "automation/responses-tool-catalog.js");
		Services.scriptloader.loadSubScript(rootURI + "automation/sliding-context.js");
		Services.scriptloader.loadSubScript(rootURI + "automation/runner.js");
		Services.scriptloader.loadSubScript(rootURI + "core/commands.js");
		Services.scriptloader.loadSubScript(rootURI + "core/server.js");
		Services.scriptloader.loadSubScript(rootURI + "core/document-style-presets.js");
		Services.scriptloader.loadSubScript(rootURI + "core/native-markdown.js");
		Services.scriptloader.loadSubScript(rootURI + "core/table-fragmentation.js");
		Services.scriptloader.loadSubScript(rootURI + "core/save-pdf.js");
		Services.scriptloader.loadSubScript(rootURI + "core/save-docx.js");
		Services.scriptloader.loadSubScript(rootURI + "core/simple-markdown.js");
		Services.scriptloader.loadSubScript(rootURI + "core/pdf-markdown-native.js");
		await _loadPrivilegedToolingBundle(rootURI, privilegedSettings);
		await _loadPrivilegedBrowserBundle(rootURI, privilegedSettings);
		Services.scriptloader.loadSubScript(rootURI + "automation/agent-tools.js");
		Services.scriptloader.loadSubScript(rootURI + "automation/mcp-server.js");
		await _loadOptionalDevToolingBundle(rootURI, privilegedSettings);
		Services.scriptloader.loadSubScript(rootURI + "automation/session-agent.js");
		Services.scriptloader.loadSubScript(rootURI + "main.js");
		await SystematicReviewer.init({ id, version, rootURI });
		if (typeof SystematicReviewerOptionalDevRuntime != "undefined") {
			SystematicReviewerOptionalDevRuntime?.startup?.(SystematicReviewer);
		}
	}
	catch (error) {
		Zotero.logError(error);
		try {
			Services.prompt.alert(null, "Systematic Reviewer startup failed", error?.message || String(error));
		}
		catch (_err) {}
		throw error;
	}
}

function shutdown() {
	_log("Shutting down");
	try {
		if (typeof SystematicReviewerOptionalDevRuntime != "undefined") {
			SystematicReviewerOptionalDevRuntime?.shutdown?.();
		}
	}
	catch (error) {
		Zotero.logError(error);
	}
	SystematicReviewer?.shutdown();
	SystematicReviewer = undefined;
}

function onMainWindowLoad(data = {}) {
	try {
		let win = data?.window || data;
		SystematicReviewer?._installIntoWindow?.(win);
	}
	catch (error) {
		Zotero.logError(error);
	}
}

function onMainWindowUnload(data = {}) {
	try {
		let win = data?.window || data;
		SystematicReviewer?._teardownWindow?.(win);
	}
	catch (error) {
		Zotero.logError(error);
	}
}

function uninstall() {
	_log("Uninstalled");
}
