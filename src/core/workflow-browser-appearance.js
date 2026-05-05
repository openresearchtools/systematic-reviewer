var SystematicReviewerWorkflowBrowserAppearance = {
	_workflowUIFontScale() {
		let value = Number(Zotero?.Prefs?.get?.("fontSize") || 1) || 1;
		if (!Number.isFinite(value) || value <= 0) {
			return 1;
		}
		return Math.max(0.7, Math.min(2, value));
	},

	_workflowUIAppearance() {
		return {
			font_scale: this._workflowUIFontScale(),
		};
	},

	_workflowBrowserDocument(browser) {
		try {
			return browser?.contentDocument
				|| browser?.contentWindow?.document
				|| browser?.browsingContext?.currentWindowGlobal?.document
				|| null;
		}
		catch (_error) {
			return null;
		}
	},

	_isWorkflowBrowser(browser) {
		let url = "";
		try {
			url = String(
				browser?.currentURI?.spec
				|| browser?.contentWindow?.location?.href
				|| browser?.getAttribute?.("src")
				|| ""
			).trim();
		}
		catch (_error) {}
		return !!url && url.includes(`${SystematicReviewerWorkflowServer?.basePath || "/systematic-reviewer/workflow"}/ui/index.html`);
	},

	_applyWorkflowDocumentAppearance(doc) {
		let root = doc?.documentElement || null;
		if (!root) {
			return false;
		}
		let appearance = this._workflowUIAppearance();
		let scale = Number(appearance.font_scale || 1) || 1;
		root.style.setProperty("--mw-ui-scale", String(scale));
		root.setAttribute("data-zotero-font-scale", String(scale));
		let win = doc.defaultView || null;
		try {
			if (win?.CustomEvent) {
				win.dispatchEvent(new win.CustomEvent("systematic-reviewer-ui-appearance-change", {
					detail: appearance,
				}));
			}
		}
		catch (_error) {}
		return true;
	},

	_applyWorkflowBrowserAppearance(browser) {
		if (!browser || !this._isWorkflowBrowser(browser)) {
			return false;
		}
		return this._applyWorkflowDocumentAppearance(this._workflowBrowserDocument(browser));
	},

	_collectWorkflowBrowsers() {
		let browsers = [];
		for (let win of this._mainWindows()) {
			let tabs = Array.isArray(win?.Zotero_Tabs?._tabs) ? win.Zotero_Tabs._tabs : [];
			for (let tab of tabs) {
				if (tab?.type != this.workflowTabType) {
					continue;
				}
				let container = null;
				try {
					container = typeof win.Zotero_Tabs.getTabContent == "function"
						? win.Zotero_Tabs.getTabContent(tab.id)
						: win.document.getElementById(tab.id);
				}
				catch (_error) {}
				let browser = container?._systematicReviewerMount?._systematicReviewerBrowser || null;
				if (browser && !browsers.includes(browser)) {
					browsers.push(browser);
				}
			}
		}
		return browsers;
	},

	_refreshWorkflowBrowserAppearance() {
		for (let browser of this._collectWorkflowBrowsers()) {
			this._applyWorkflowBrowserAppearance(browser);
		}
	},
};
