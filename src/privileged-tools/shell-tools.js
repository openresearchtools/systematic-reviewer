var SystematicReviewerPrivilegedShellTools = (() => {
	const DEFAULT_TIMEOUT_MS = 300000;
	const MIN_TIMEOUT_MS = 1000;
	const MAX_TIMEOUT_MS = 3600000;

	function optionalString(value) {
		return String(value || "").trim();
	}

	function normalizeTimeoutMs(reviewer, value, fallback = DEFAULT_TIMEOUT_MS) {
		if (reviewer?._normalizePrivilegedToolTimeout) {
			return reviewer._normalizePrivilegedToolTimeout(value, fallback);
		}
		let next = Math.round(Number(value || 0) || 0);
		let defaultValue = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(Number(fallback || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)));
		if (!Number.isFinite(next) || next <= 0) {
			return defaultValue;
		}
		return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, next));
	}

	function normalizeSettings(reviewer, raw = null) {
		if (reviewer?._normalizePrivilegedToolSettings) {
			return reviewer._normalizePrivilegedToolSettings(raw || reviewer?._globalSettingsSync?.()?.privileged_tools || null);
		}
		let source = raw && typeof raw == "object" ? raw : {};
		return {
			shell_enabled: source.shell_enabled === true,
			default_timeout_ms: normalizeTimeoutMs(reviewer, source.default_timeout_ms, DEFAULT_TIMEOUT_MS),
		};
	}

	function quoteForPOSIX(value = "") {
		return `'${String(value || "").replace(/'/g, `'\"'\"'`)}'`;
	}

	function quoteForPowerShell(value = "") {
		return `'${String(value || "").replace(/'/g, "''")}'`;
	}

	function quoteForCmd(value = "") {
		return `"${String(value || "").replace(/"/g, "\"\"")}"`;
	}

	function commandWithWorkingDirectory(command = "", shellMode = "sh", cwd = "") {
		let body = String(command || "");
		if (!cwd) {
			return body;
		}
		if (shellMode == "powershell") {
			return `Set-Location -LiteralPath ${quoteForPowerShell(cwd)}; ${body}`;
		}
		if (shellMode == "cmd") {
			return `cd /d ${quoteForCmd(cwd)} && ${body}`;
		}
		return `cd ${quoteForPOSIX(cwd)} && ${body}`;
	}

	function resolveShellSpec(reviewer, requestedShell = "auto") {
		let requested = optionalString(requestedShell).toLowerCase() || "auto";
		let windows = reviewer?._isWindowsPlatform?.() === true;
		let mode = requested;
		if (mode == "auto") {
			mode = windows ? "powershell" : "sh";
		}
		let binaryPath = "";
		let argsPrefix = [];
		if (mode == "powershell") {
			binaryPath = reviewer?._findExecutablePath?.("powershell", [
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
				"C:\\Program Files\\PowerShell\\6\\pwsh.exe",
			]) || reviewer?._findExecutablePath?.("pwsh", [
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
				"C:\\Program Files\\PowerShell\\6\\pwsh.exe",
			]) || "";
			argsPrefix = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
		}
		else if (mode == "cmd") {
			binaryPath = reviewer?._findExecutablePath?.("cmd", [
				"C:\\Windows\\System32\\cmd.exe",
			]) || "";
			argsPrefix = ["/d", "/s", "/c"];
		}
		else if (mode == "bash") {
			binaryPath = reviewer?._findExecutablePath?.("bash", [
				"/bin/bash",
				"/usr/bin/bash",
				"C:\\Program Files\\Git\\bin\\bash.exe",
				"C:\\Program Files\\Git\\usr\\bin\\bash.exe",
			]) || "";
			argsPrefix = ["-lc"];
		}
		else if (mode == "sh") {
			binaryPath = reviewer?._findExecutablePath?.("sh", [
				"/bin/sh",
				"/usr/bin/sh",
				"C:\\Program Files\\Git\\bin\\sh.exe",
				"C:\\Program Files\\Git\\usr\\bin\\sh.exe",
			]) || "";
			argsPrefix = ["-lc"];
		}
		else {
			throw new Error(`Unsupported shell override: ${requestedShell}`);
		}
		if (!binaryPath) {
			throw new Error(`Requested shell is unavailable on this machine: ${mode}`);
		}
		return {
			mode,
			binaryPath,
			argsPrefix,
		};
	}

	function wrappedCommand(command = "", shellMode = "sh", cwd = "", stdoutPath = "", stderrPath = "") {
		let body = commandWithWorkingDirectory(command, shellMode, cwd);
		if (shellMode == "powershell") {
			return `& { ${body} } 1> ${quoteForPowerShell(stdoutPath)} 2> ${quoteForPowerShell(stderrPath)}`;
		}
		if (shellMode == "cmd") {
			return `(${body}) 1> ${quoteForCmd(stdoutPath)} 2> ${quoteForCmd(stderrPath)}`;
		}
		return `{ ${body}; } 1> ${quoteForPOSIX(stdoutPath)} 2> ${quoteForPOSIX(stderrPath)}`;
	}

	function comparablePath(reviewer, path = "") {
		let normalized = optionalString(path).replace(/\\/g, "/").replace(/\/+$/g, "");
		return reviewer?._isWindowsPlatform?.() === true
			? normalized.toLowerCase()
			: normalized;
	}

	function normalizeDirectoryPath(reviewer, path = "", label = "Working directory") {
		let file = reviewer._nsIFile(path);
		if (!file.exists() || !file.isDirectory()) {
			throw new Error(`${label} is not a folder: ${path}`);
		}
		let normalized = file.clone();
		try {
			normalized.normalize();
		}
		catch (_error) {}
		return normalized.path;
	}

	function isInsideRoot(reviewer, rootPath = "", candidatePath = "") {
		let root = comparablePath(reviewer, rootPath);
		let candidate = comparablePath(reviewer, candidatePath);
		if (!root || !candidate) {
			return false;
		}
		return candidate == root || candidate.startsWith(`${root}/`);
	}

	async function resolveProjectRoot(reviewer, args = {}) {
		let projectRoot = optionalString(args?.__sr_tool_context?.project_context?.projectRoot || "");
		if (projectRoot) {
			return projectRoot;
		}
		let projectID = optionalString(
			args?.__sr_tool_context?.project_id
			|| args?.project_id
			|| args?.projectID
			|| ""
		);
		if (projectID && reviewer?._resolveProjectByID) {
			let runtime = await reviewer._resolveProjectByID(projectID, {
				sessionID: args?.__sr_tool_context?.session_id || args?.session_id || args?.sessionID || "",
			});
			projectRoot = optionalString(runtime?.context?.projectRoot || "");
			if (projectRoot) {
				return projectRoot;
			}
		}
		let currentRuntime = await reviewer?._resolveCurrentProject?.();
		projectRoot = optionalString(currentRuntime?.context?.projectRoot || "");
		if (projectRoot) {
			return projectRoot;
		}
		return "";
	}

	async function resolveWorkingDirectory(reviewer, args = {}) {
		let requested = optionalString(args.cwd || "");
		let projectRoot = await resolveProjectRoot(reviewer, args);
		if (!projectRoot) {
			throw new Error("shell__run requires a bound project workspace.");
		}
		let normalizedProjectRoot = normalizeDirectoryPath(reviewer, projectRoot, "Project root");
		let cwd = requested || normalizedProjectRoot;
		if (!reviewer?._isAbsolutePath?.(cwd)) {
			cwd = reviewer._joinPath(normalizedProjectRoot, cwd);
		}
		if (!(await reviewer._pathExists(cwd))) {
			throw new Error(`Working directory does not exist: ${cwd}`);
		}
		let normalizedCwd = normalizeDirectoryPath(reviewer, cwd);
		if (!isInsideRoot(reviewer, normalizedProjectRoot, normalizedCwd)) {
			throw new Error("shell__run cwd must stay inside the bound project workspace.");
		}
		return normalizedCwd;
	}

	async function executeShellTool(reviewer, args = {}) {
		let command = String(args.command || "").trim();
		if (!command) {
			throw new Error("shell__run requires command.");
		}
		let settings = normalizeSettings(reviewer);
		let cwd = await resolveWorkingDirectory(reviewer, args);
		let timeoutMs = normalizeTimeoutMs(reviewer, args.timeout_ms, settings.default_timeout_ms);
		let spec = resolveShellSpec(reviewer, args.shell || "auto");
		let tempRoot = reviewer._joinPath(reviewer._configRoot(), "privileged-shell");
		await reviewer._ensureDirectory(tempRoot);
		let token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		let stdoutPath = reviewer._joinPath(tempRoot, `shell-${token}.stdout.txt`);
		let stderrPath = reviewer._joinPath(tempRoot, `shell-${token}.stderr.txt`);
		let exitCode = null;
		let timedOut = false;
		let executionError = null;
		try {
			exitCode = await reviewer._runProcessAsync(
				spec.binaryPath,
				spec.argsPrefix.concat([wrappedCommand(command, spec.mode, cwd, stdoutPath, stderrPath)]),
				{ timeoutMs }
			);
		}
		catch (error) {
			executionError = error;
			let message = optionalString(error?.message || error);
			timedOut = /timed out/i.test(message) || String(error?.name || "") == "AbortError";
		}
		let stdout = await reviewer._readFileText(stdoutPath).catch(() => "");
		let stderr = await reviewer._readFileText(stderrPath).catch(() => "");
		await reviewer._removeIfExists(stdoutPath);
		await reviewer._removeIfExists(stderrPath);
		if (executionError && !timedOut) {
			throw executionError;
		}
		if (timedOut && !stderr.trim()) {
			stderr = `Process timed out after ${timeoutMs} ms.`;
		}
		return {
			ok: !timedOut && exitCode === 0,
			command,
			cwd,
			shell: spec.mode,
			timeout_ms: timeoutMs,
			exit_code: exitCode,
			stdout,
			stderr,
			timed_out: timedOut,
		};
	}

	function shellToolDefinition(reviewer) {
		return {
			id: "sr.shellRun",
			description: "Run one privileged local shell command. Commands default to the bound project workspace, but the command can still invoke globally installed tools and cause effects outside that workspace. When developer tools are unlocked, the localhost developer testing surface mirrors the same allowed shell tool. Use timeout_ms to override the default timeout for longer commands.",
			inputShape: {
				command: "required string shell command to run",
				project_id: "optional stored project id for developer testing when no session-bound project context is already active",
				cwd: "optional project-relative or in-project absolute working directory; defaults to the bound project root",
				timeout_ms: "optional integer milliseconds override for this call",
				shell: "optional: auto | sh | bash | powershell | cmd",
			},
			execute: async (args = {}) => await executeShellTool(reviewer, args),
		};
	}

	function getSessionTools(reviewer) {
		let settings = normalizeSettings(reviewer);
		let tools = [];
		if (settings.shell_enabled === true) {
			tools.push(shellToolDefinition(reviewer));
		}
		return tools;
	}

	function getSessionPromptIntro(_reviewer = null) {
		if (typeof SystematicReviewerPrivilegedPrompts == "undefined") {
			return "";
		}
		return optionalString(SystematicReviewerPrivilegedPrompts?.sessionShellIntro?.() || "");
	}

	return {
		getSessionTools,
		getSessionPromptIntro,
	};
})();
