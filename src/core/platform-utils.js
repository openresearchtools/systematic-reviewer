var SystematicReviewerPlatformUtils = {
	_contentTypeForPath(path) {
		let lower = String(path).toLowerCase();
		if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
			return "text/markdown";
		}
		if (lower.endsWith(".pdf")) {
			return "application/pdf";
		}
		if (lower.endsWith(".csv")) {
			return "text/csv";
		}
		if (lower.endsWith(".json")) {
			return "application/json";
		}
		if (lower.endsWith(".svg")) {
			return "image/svg+xml";
		}
		if (lower.endsWith(".png")) {
			return "image/png";
		}
		if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
			return "image/jpeg";
		}
		if (lower.endsWith(".html")) {
			return "text/html";
		}
		if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
			return "application/yaml";
		}
		if (lower.endsWith(".txt")) {
			return "text/plain";
		}
		return "application/octet-stream";
	},

	_storageRoot() {
		return this._joinPath(Zotero.DataDirectory.dir, this.namespace);
	},

	_projectsRoot() {
		return this._joinPath(this._storageRoot(), "projects");
	},

	_configRoot() {
		return this._joinPath(this._storageRoot(), "config");
	},

	_globalSettingsPath() {
		return this._joinPath(this._configRoot(), "settings.json");
	},

	_pathExists(path) {
		try {
			return this._nsIFile(path).exists();
		}
		catch (_err) {
			return false;
		}
	},

	async _readFileText(path) {
		return await Zotero.File.getContentsAsync(path);
	},

	async _writeTextFile(path, contents) {
		let parent = this._parentPath(path);
		if (parent) {
			await this._ensureDirectory(parent);
		}
		await Zotero.File.putContentsAsync(path, contents);
	},

	async _writeBinaryFile(path, bytes) {
		let parent = this._parentPath(path);
		if (parent) {
			await this._ensureDirectory(parent);
		}
		if (typeof IOUtils != "undefined" && IOUtils?.write) {
			await IOUtils.write(path, bytes);
			return;
		}
		let file = this._nsIFile(path);
		let output = Components.classes["@mozilla.org/network/file-output-stream;1"]
			.createInstance(Components.interfaces.nsIFileOutputStream);
		output.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
		let binary = Components.classes["@mozilla.org/binaryoutputstream;1"]
			.createInstance(Components.interfaces.nsIBinaryOutputStream);
		binary.setOutputStream(output);
		binary.writeByteArray(Array.from(bytes), bytes.length);
		binary.close();
		output.close();
	},

	async _writeJSONFile(path, payload) {
		await this._writeTextFile(path, `${JSON.stringify(payload, null, 2)}\n`);
	},

	async _readJSONFile(path) {
		if (!(await this._pathExists(path))) {
			return null;
		}
		try {
			return JSON.parse(await this._readFileText(path));
		}
		catch (_err) {
			return null;
		}
	},

	_normalizeLocalPath(path) {
		let raw = String(path || "").trim();
		if (!raw) {
			return "";
		}
		if (
			(raw.startsWith('"') && raw.endsWith('"'))
			|| (raw.startsWith("'") && raw.endsWith("'"))
		) {
			raw = raw.slice(1, -1).trim();
		}
		if (/^file:/i.test(raw)) {
			try {
				return Services.io.newURI(raw).QueryInterface(Components.interfaces.nsIFileURL).file.path;
			}
			catch (_err) {}
		}
		if (/^\\\\\?\\UNC\\/i.test(raw)) {
			return `\\\\${raw.slice(8)}`;
		}
		if (/^\\\\\?\\[A-Za-z]:[\\/]/.test(raw)) {
			return raw.slice(4);
		}
		if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
			return raw.slice(1);
		}
		return raw;
	},

	_isWindowsPlatform() {
		try {
			return String(Services.appinfo?.OS || "").toUpperCase() == "WINNT";
		}
		catch (_err) {
			return false;
		}
	},

	_isAbsolutePath(path) {
		let raw = this._normalizeLocalPath(path);
		return !!raw && (
			/^[A-Za-z]:[\\/]/.test(raw)
			|| /^\\\\[^\\]+\\[^\\]+/.test(raw)
			|| raw.startsWith("/")
		);
	},

	_joinPath(basePath, ...parts) {
		let file = this._nsIFile(basePath);
		for (let part of parts) {
			if (part === undefined || part === null || part === "") {
				continue;
			}
			let normalized = this._normalizeLocalPath(part);
			if (!normalized) {
				continue;
			}
			if (this._isAbsolutePath(normalized)) {
				file = this._nsIFile(normalized);
				continue;
			}
			for (let segment of normalized.split(/[\\/]+/).filter(Boolean)) {
				file.append(segment);
			}
		}
		return file.path;
	},

	_parentPath(path) {
		let file = this._nsIFile(path);
		return file.parent ? file.parent.path : null;
	},

	_basename(path) {
		let normalized = this._normalizeLocalPath(path);
		if (!normalized) {
			return "";
		}
		let trimmed = normalized.replace(/[\\/]+$/g, "");
		if (!trimmed) {
			return "";
		}
		let segments = trimmed.split(/[\\/]+/).filter(Boolean);
		if (!segments.length) {
			return trimmed;
		}
		let leaf = segments[segments.length - 1];
		if (/^[A-Za-z]:$/.test(leaf) && segments.length > 1) {
			return segments[segments.length - 2] || "";
		}
		return leaf;
	},

	_sanitizeFileName(name) {
		return String(name || "")
			.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
			.replace(/\s+/g, " ")
			.trim() || "file";
	},

	_simpleContentHash(text) {
		let hash = 2166136261;
		let value = String(text || "");
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
	},

	_projectSnapshotsDir(context = {}) {
		return String(context?.snapshotsDir || "").trim()
			|| this._joinPath(context?.projectRoot || "", "snapshots");
	},

	_snapshotReasonSlug(reason = "") {
		let slug = String(reason || "").trim().toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return slug || "snapshot";
	},

	_countTextLines(text = "") {
		let normalized = String(text || "").replace(/\r\n?/g, "\n");
		if (!normalized) {
			return 0;
		}
		if (normalized.endsWith("\n")) {
			normalized = normalized.slice(0, -1);
		}
		return normalized ? normalized.split("\n").length : 0;
	},

	_parseReportSnapshotName(name = "") {
		let raw = String(name || "").trim();
		let match = raw.match(/^report-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z?)(?:-(.+?))?\.md$/i);
		if (!match) {
			return {
				snapshot_id: raw,
				stamp: "",
				created_at: "",
				reason: "snapshot",
			};
		}
		let stamp = String(match[1] || "").trim();
		let stampMatch = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?(Z)?$/);
		let createdAt = "";
		if (stampMatch) {
			let iso = `${stampMatch[1]}T${stampMatch[2]}:${stampMatch[3]}:${stampMatch[4]}${stampMatch[5] ? `.${stampMatch[5]}` : ""}${stampMatch[6] || "Z"}`;
			let parsed = new Date(iso);
			if (!Number.isNaN(parsed.getTime())) {
				createdAt = parsed.toISOString();
			}
		}
		return {
			snapshot_id: raw,
			stamp,
			created_at: createdAt,
			reason: String(match[2] || "").trim() || "snapshot",
		};
	},

	async _readReportMarkdown(context = {}) {
		let reportPath = String(context?.reportPath || "").trim();
		if (!reportPath || !(await this._pathExists(reportPath))) {
			return "";
		}
		return await this._readFileText(reportPath);
	},

	async _reportContentHash(context = {}, options = {}) {
		let markdown = Object.prototype.hasOwnProperty.call(options || {}, "markdown")
			? String(options?.markdown || "")
			: await this._readReportMarkdown(context);
		return this._simpleContentHash(markdown);
	},

	async _pruneReportSnapshots(context = {}, options = {}) {
		let limit = Math.max(1, Number(options?.limit || 50) || 50);
		let snapshotsDir = this._projectSnapshotsDir(context);
		if (!snapshotsDir || !(await this._pathExists(snapshotsDir))) {
			return [];
		}
		let dir = this._nsIFile(snapshotsDir);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let snapshots = [];
		let entries = dir.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.isFile?.()) {
				continue;
			}
			let name = String(entry.leafName || "").trim();
			if (!/^report-.*\.md$/i.test(name)) {
				continue;
			}
			snapshots.push({
				name,
				path: entry.path,
			});
		}
		snapshots.sort((left, right) => String(right.name || "").localeCompare(String(left.name || "")));
		for (let entry of snapshots.slice(limit)) {
			await this._removeIfExists(entry.path);
		}
		return snapshots.slice(0, limit).map((entry) => entry.path);
	},

	async _writeReportSnapshot(context = {}, markdown = "", reason = "", options = {}) {
		let projectRoot = String(context?.projectRoot || "").trim();
		if (!projectRoot) {
			return "";
		}
		let snapshotsDir = this._projectSnapshotsDir(context);
		await this._ensureDirectory(snapshotsDir);
		let stamp = new Date().toISOString().replace(/[:.]/g, "-");
		let snapshotPath = this._joinPath(
			snapshotsDir,
			`report-${stamp}-${this._snapshotReasonSlug(reason)}.md`
		);
		await this._writeTextFile(snapshotPath, String(markdown || ""));
		await this._pruneReportSnapshots(context, {
			limit: Number(options?.limit || 50) || 50,
		});
		return snapshotPath;
	},

	async _snapshotReportFromDisk(context = {}, reason = "", options = {}) {
		let markdown = await this._readReportMarkdown(context);
		return await this._writeReportSnapshot(context, markdown, reason, options);
	},

	async _reportSnapshotMetadata(context = {}, snapshotPath = "", options = {}) {
		let path = String(snapshotPath || "").trim();
		if (!path || !(await this._pathExists(path))) {
			return null;
		}
		let file = this._nsIFile(path);
		if (!file.exists() || !file.isFile()) {
			return null;
		}
		let parsed = this._parseReportSnapshotName(file.leafName);
		let content = await this._readFileText(path);
		let metadata = {
			snapshot_id: parsed.snapshot_id,
			name: file.leafName,
			path,
			reason: parsed.reason,
			created_at: parsed.created_at || new Date(file.lastModifiedTime).toISOString(),
			modified_at: new Date(file.lastModifiedTime).toISOString(),
			content_hash: this._simpleContentHash(content),
			line_count: this._countTextLines(content),
			size: Number(file.fileSize || 0) || 0,
		};
		if (options?.include_content || options?.includeContent) {
			metadata.content = content;
		}
		return metadata;
	},

	async _listReportSnapshots(context = {}, options = {}) {
		let limit = Math.max(1, Number(options?.limit || 50) || 50);
		let snapshotsDir = this._projectSnapshotsDir(context);
		if (!snapshotsDir || !(await this._pathExists(snapshotsDir))) {
			return [];
		}
		let dir = this._nsIFile(snapshotsDir);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let entries = [];
		let children = dir.directoryEntries;
		while (children.hasMoreElements()) {
			let child = children.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!child?.isFile?.()) {
				continue;
			}
			let name = String(child.leafName || "").trim();
			if (!/^report-.*\.md$/i.test(name)) {
				continue;
			}
			let metadata = await this._reportSnapshotMetadata(context, child.path, options);
			if (metadata) {
				entries.push(metadata);
			}
		}
		entries.sort((left, right) => {
			let rightTime = Date.parse(String(right?.created_at || right?.modified_at || "")) || 0;
			let leftTime = Date.parse(String(left?.created_at || left?.modified_at || "")) || 0;
			if (rightTime != leftTime) {
				return rightTime - leftTime;
			}
			return String(right?.name || "").localeCompare(String(left?.name || ""));
		});
		return entries.slice(0, limit);
	},

	async _resolveReportSnapshot(context = {}, snapshotID = "", options = {}) {
		let normalizedID = String(snapshotID || "").trim();
		if (!normalizedID) {
			return null;
		}
		let snapshotsDir = this._projectSnapshotsDir(context);
		if (!snapshotsDir || !(await this._pathExists(snapshotsDir))) {
			return null;
		}
		let name = this._basename(normalizedID);
		if (!name || name.includes("/") || name.includes("\\")) {
			return null;
		}
		let path = this._joinPath(snapshotsDir, name);
		if (!(await this._pathExists(path))) {
			return null;
		}
		return await this._reportSnapshotMetadata(context, path, options);
	},

	async _ensureDirectory(path) {
		let file = this._nsIFile(path);
		if (file.exists()) {
			return path;
		}
		if (file.parent && !file.parent.exists()) {
			await this._ensureDirectory(file.parent.path);
		}
		file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
		return path;
	},

	async _removeIfExists(path) {
		try {
			let file = this._nsIFile(path);
			if (file.exists()) {
				file.remove(false);
			}
		}
		catch (_err) {}
	},

	async _removePathRecursiveIfExists(path) {
		try {
			let file = this._nsIFile(path);
			if (file.exists()) {
				file.remove(true);
			}
		}
		catch (_err) {}
	},

	_copyFileToPath(sourcePath, destinationPath) {
		let source = this._nsIFile(sourcePath);
		let destination = this._nsIFile(destinationPath);
		if (destination.parent && !destination.parent.exists()) {
			destination.parent.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
		}
		source.copyTo(destination.parent, destination.leafName);
	},

	_nsIFile(path) {
		let normalized = this._normalizeLocalPath(path);
		let file = Components.classes["@mozilla.org/file/local;1"]
			.createInstance(Components.interfaces.nsIFile);
		file.initWithPath(normalized);
		return file;
	},

	_runProcess(binaryPath, args) {
		try {
			let file = this._nsIFile(binaryPath);
			let process = Components.classes["@mozilla.org/process/util;1"]
				.createInstance(Components.interfaces.nsIProcess);
			process.init(file);
			process.run(true, args, args.length);
			return process.exitValue;
		}
		catch (error) {
			this.log(`Process failed for ${binaryPath}: ${error}`);
			return -1;
		}
	},

	_runProcessAsync(binaryPath, args, options = {}) {
		return new Promise((resolve, reject) => {
			let finished = false;
			let process = null;
			let timeoutMs = Math.max(0, Number(options?.timeoutMs || 0) || 0);
			let timeoutHandle = null;
			let abortSignal = options?.signal || null;
			let abortListener = null;
			let makeAbortError = (message = "Process aborted.") => {
				let error = new Error(String(message || "Process aborted."));
				error.name = "AbortError";
				return error;
			};
			let finish = (callback) => {
				if (finished) {
					return;
				}
				finished = true;
				if (timeoutHandle) {
					try {
						timeoutHandle.cancel();
					}
					catch (_err) {}
					timeoutHandle = null;
				}
				if (abortSignal && abortListener && typeof abortSignal.removeEventListener == "function") {
					try {
						abortSignal.removeEventListener("abort", abortListener);
					}
					catch (_err) {}
					abortListener = null;
				}
				callback();
			};
			try {
				if (abortSignal?.aborted) {
					finish(() => reject(makeAbortError()));
					return;
				}
				let file = this._nsIFile(binaryPath);
				process = Components.classes["@mozilla.org/process/util;1"]
					.createInstance(Components.interfaces.nsIProcess);
				process.init(file);
				if (abortSignal && typeof abortSignal.addEventListener == "function") {
					abortListener = () => {
						if (finished) {
							return;
						}
						try {
							process?.kill?.();
						}
						catch (_err) {}
						finish(() => reject(makeAbortError()));
					};
					abortSignal.addEventListener("abort", abortListener, { once: true });
				}
				process.runAsync(
					args,
					args.length,
					{
						observe: (_subject, _topic, _data) => {
							finish(() => resolve(process.exitValue));
						},
					},
					false
				);
				if (timeoutMs > 0) {
					timeoutHandle = Zotero.Promise.delay(timeoutMs).then(() => {
						if (finished) {
							return;
						}
						try {
							process.kill();
						}
						catch (_err) {}
						finish(() => reject(new Error(`Process timed out after ${timeoutMs} ms.`)));
					});
				}
			}
			catch (error) {
				finish(() => {
					this.log(`Async process failed for ${binaryPath}: ${error}`);
					reject(error);
				});
			}
		});
	},

	_escapeHTML(value) {
		return String(value)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;");
	},

	_showError(error) {
		let message = error?.message || String(error);
		Zotero.logError(error);
		try {
			let promptService = Services.prompt;
			let win = this._primaryWindow();
			promptService.alert(win, "Systematic Reviewer", message);
		}
		catch (_err) {
			this.log(`Error: ${message}`);
		}
	},

	_mainWindows() {
		let out = [];
		let enumerator = Services.wm.getEnumerator("navigator:browser");
		while (enumerator.hasMoreElements()) {
			let win = enumerator.getNext();
			try {
				if (this._isMainZoteroWindow(win)) {
					out.push(win);
				}
			}
			catch (_err) {}
		}
		return out;
	},

	_primaryWindow() {
		let win = Services.wm.getMostRecentWindow("navigator:browser");
		return this._isMainZoteroWindow(win) ? win : this._mainWindows()[0] || null;
	},

	_isMainZoteroWindow(win) {
		return !!(
			win &&
			!win.closed &&
			win.document &&
			win.document.documentElement &&
			win.document.documentElement.id == "main-window"
		);
	},

	_domWindowFromXulWindow(xulWindow) {
		try {
			return xulWindow.docShell.domWindow;
		}
		catch (_err) {
			return null;
		}
	},
};
