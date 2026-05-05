var SystematicReviewerAutomationDocs = (() => {
	const REGISTRY_PATH = "automation/docs/registry.json";
	let cachedRoot = "";
	let cachedRegistry = null;
	let cachedDocs = new Map();

	function optionalString(value) {
		return String(value || "").trim();
	}

	function cacheKey(reviewer, assetPath) {
		return `${optionalString(reviewer?.rootURI)}|${optionalString(assetPath)}`;
	}

	function readZipEntry(reviewer, zipFilePath, entryPath) {
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
			catch (_error) {}
			try {
				zipReader.close();
			}
			catch (_error) {}
		}
	}

	async function readAssetText(reviewer, assetPath) {
		let root = optionalString(reviewer?.rootURI);
		if (!root) {
			throw new Error("Systematic Reviewer root URI is unavailable.");
		}
		if (root.startsWith("jar:")) {
			let match = root.match(/^jar:(file:[^!]+)!\/?$/);
			if (match?.[1]) {
				let fileURL = Services.io.newURI(match[1]).QueryInterface(Components.interfaces.nsIFileURL);
				return readZipEntry(reviewer, fileURL.file.path, assetPath);
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

	async function loadRegistry(reviewer) {
		let root = optionalString(reviewer?.rootURI);
		if (cachedRegistry && cachedRoot == root) {
			return cachedRegistry;
		}
		let raw = await readAssetText(reviewer, REGISTRY_PATH);
		cachedRoot = root;
		cachedRegistry = JSON.parse(String(raw || "{}"));
		cachedDocs = new Map();
		return cachedRegistry;
	}

	async function loadDocText(reviewer, assetPath) {
		let key = cacheKey(reviewer, assetPath);
		if (cachedDocs.has(key)) {
			return cachedDocs.get(key);
		}
		let text = await readAssetText(reviewer, assetPath);
		cachedDocs.set(key, text);
		return text;
	}

	async function resolveEntry(reviewer, groupKey, entryID) {
		let registry = await loadRegistry(reviewer);
		let entries = Array.isArray(registry?.[groupKey]) ? registry[groupKey] : [];
		let entry = entries.find((candidate) => optionalString(candidate?.id) == optionalString(entryID)) || null;
		if (!entry) {
			return null;
		}
		return {
			id: optionalString(entry.id),
			title: optionalString(entry.title || entry.id),
			path: optionalString(entry.path),
			markdown: await loadDocText(reviewer, optionalString(entry.path)),
		};
	}

	async function loadSharedDocs(reviewer) {
		let registry = await loadRegistry(reviewer);
		let entries = Array.isArray(registry?.shared) ? registry.shared : [];
		let out = [];
		for (let entry of entries) {
			let resolved = await resolveEntry(reviewer, "shared", entry?.id);
			if (resolved) {
				out.push(resolved);
			}
		}
		return out;
	}

	async function bundle(reviewer, options = {}) {
		let workflowID = optionalString(options.workflow_id || options.workflowID);
		let stageID = optionalString(options.stage_id || options.stageID);
		let actionIDs = Array.isArray(options.action_ids || options.actionIDs)
			? (options.action_ids || options.actionIDs).map((entry) => optionalString(entry)).filter(Boolean)
			: [];
		let shared = await loadSharedDocs(reviewer);
		let workflow = workflowID ? await resolveEntry(reviewer, "workflows", workflowID) : null;
		let stage = stageID ? await resolveEntry(reviewer, "stages", stageID) : null;
		let actions = [];
		for (let actionID of actionIDs) {
			let resolved = await resolveEntry(reviewer, "actions", actionID);
			if (resolved) {
				actions.push(resolved);
			}
		}
		let registry = await loadRegistry(reviewer);
		return {
			version: Number(registry?.version || 1) || 1,
			shared,
			workflow,
			stage,
			actions,
		};
	}

	return {
		readAssetText,
		loadRegistry,
		resolveEntry,
		bundle,
	};
})();
