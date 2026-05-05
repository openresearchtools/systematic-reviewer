var SystematicReviewerPrivilegedTools = (() => {
	const DEFAULT_TIMEOUT_MS = 300000;
	const MIN_TIMEOUT_MS = 1000;
	const MAX_TIMEOUT_MS = 3600000;

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
			browser_enabled: source.browser_enabled === true,
			dev_tools_enabled: source.dev_tools_enabled === true,
			default_timeout_ms: normalizeTimeoutMs(reviewer, source.default_timeout_ms, DEFAULT_TIMEOUT_MS),
		};
	}

	function shellModule() {
		if (typeof SystematicReviewerPrivilegedShellTools == "undefined") {
			return null;
		}
		return SystematicReviewerPrivilegedShellTools || null;
	}

	function browserModule() {
		if (typeof SystematicReviewerPrivilegedBrowserTools == "undefined") {
			return null;
		}
		return SystematicReviewerPrivilegedBrowserTools || null;
	}

	function getStatus(reviewer) {
		let settings = normalizeSettings(reviewer);
		let shell = shellModule();
		let browser = browserModule();
		return {
			loaded: true,
			shell_loaded: !!shell,
			shell_enabled: settings.shell_enabled === true,
			default_timeout_ms: settings.default_timeout_ms,
			shell_namespace_available: settings.shell_enabled === true && !!shell,
			browser_loaded: !!browser,
			browser_enabled: settings.browser_enabled === true,
			browser_namespace_available: settings.browser_enabled === true && !!browser,
		};
	}

	function applySettings(_raw = null, _reviewer = null) {
		return true;
	}

	function getSessionTools(reviewer) {
		let settings = normalizeSettings(reviewer);
		let tools = [];
		let shell = shellModule();
		let browser = browserModule();
		if (settings.shell_enabled === true && shell?.getSessionTools) {
			let shellTools = shell.getSessionTools(reviewer);
			if (Array.isArray(shellTools)) {
				tools.push(...shellTools.filter(Boolean));
			}
		}
		if (settings.browser_enabled === true && browser?.getSessionTools) {
			let browserTools = browser.getSessionTools(reviewer);
			if (Array.isArray(browserTools)) {
				tools.push(...browserTools.filter(Boolean));
			}
		}
		return tools;
	}

	function getSessionPromptIntro(reviewer) {
		let settings = normalizeSettings(reviewer);
		let sections = [];
		let shell = shellModule();
		let browser = browserModule();
		if (settings.shell_enabled === true && shell?.getSessionPromptIntro) {
			let shellIntro = String(shell.getSessionPromptIntro(reviewer) || "").trim();
			if (shellIntro) {
				sections.push(shellIntro);
			}
		}
		if (settings.browser_enabled === true && browser?.getSessionPromptIntro) {
			let browserIntro = String(browser.getSessionPromptIntro(reviewer) || "").trim();
			if (browserIntro) {
				sections.push(browserIntro);
			}
		}
		return sections.join("\n\n").trim();
	}

	return {
		applySettings,
		getSessionTools,
		getSessionPromptIntro,
		getStatus,
	};
})();
