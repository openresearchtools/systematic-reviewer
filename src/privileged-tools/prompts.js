var SystematicReviewerPrivilegedPrompts = (() => {
	function sessionShellIntro() {
		return [
			"Privileged tools:",
			"- The shell namespace is not available through MCP. When privileged shell tools are enabled and developer tools are unlocked, the localhost developer testing surface mirrors the same allowed shell tools as the in-app session agent.",
			"- Use shell__run for real shell work that needs the local machine.",
			"- shell__run accepts command, optional cwd, optional timeout_ms, and optional shell.",
			"- shell__run defaults to the currently bound project workspace, but that workspace default does not itself prevent system-wide effects.",
			"- Treat shell__run as granting whatever machine access the current user account and operating-system sandbox allow.",
			"- Include timeout_ms explicitly when a command may run longer than the configured default timeout.",
			"- On Windows the default shell is PowerShell unless shell: \"cmd\" is requested.",
			"- Prefer setting cwd explicitly to the intended project folder before running commands that create or modify files.",
		].join("\n");
	}

	return {
		sessionShellIntro,
	};
})();
