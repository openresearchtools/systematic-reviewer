var SystematicReviewerTabLocator = {
	async _workspaceDocument(context, options = {}) {
		if (!(await this._pathExists(context.reportPath))) {
			return null;
		}
		let markdown = await this._readFileText(context.reportPath);
		let document = {
			path: context.reportPath,
			markdown,
		};
		if (options?.includeHTML !== false) {
			document.html = this._renderMarkdownHTML(markdown);
		}
		return document;
	},

	_findJobsTab(win, projectRef = null) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._projectTabSpec("jobs", null);
		let tab = null;
		try {
			if (typeof win.Zotero_Tabs._getTab == "function") {
				tab = win.Zotero_Tabs._getTab(spec.id)?.tab || null;
			}
		}
		catch (_err) {}
		if (!tab) {
			tab = win.Zotero_Tabs._tabs?.find((candidate) =>
				candidate.id == spec.id
				|| candidate?.type == spec.type
				|| candidate.id == this.jobsTabID
			) || null;
		}
		if (!tab) {
			return null;
		}
		let container = null;
		try {
			container = typeof win.Zotero_Tabs.getTabContent == "function"
				? win.Zotero_Tabs.getTabContent(tab.id)
				: win.document.getElementById(tab.id);
		}
		catch (_err) {}
		return container ? { id: tab.id, container } : null;
	},

	_findWorkflowTab(win, projectRef = null) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._projectTabSpec("manual", projectRef);
		let tab = null;
		try {
			if (typeof win.Zotero_Tabs._getTab == "function") {
				tab = win.Zotero_Tabs._getTab(spec.id)?.tab || null;
			}
		}
		catch (_err) {}
		if (!tab) {
			tab = win.Zotero_Tabs._tabs?.find((candidate) =>
				candidate.id == spec.id
				|| (spec.projectID && candidate?.type == spec.type && candidate?.data?.projectID == spec.projectID)
				|| (!spec.projectID && candidate.id == this.workflowTabID)
			) || null;
		}
		if (!tab) {
			return null;
		}
		let container = null;
		try {
			container = typeof win.Zotero_Tabs.getTabContent == "function"
				? win.Zotero_Tabs.getTabContent(tab.id)
				: win.document.getElementById(tab.id);
		}
		catch (_err) {}
		return container ? { id: tab.id, container } : null;
	},

	_findSettingsTab(win) {
		if (!win?.Zotero_Tabs) {
			return null;
		}
		let spec = this._projectTabSpec("settings", null);
		let tab = null;
		try {
			if (typeof win.Zotero_Tabs._getTab == "function") {
				tab = win.Zotero_Tabs._getTab(spec.id)?.tab || null;
			}
		}
		catch (_err) {}
		if (!tab) {
			tab = win.Zotero_Tabs._tabs?.find((candidate) =>
				candidate.id == spec.id
				|| (
					candidate?.type == spec.type
					&& !String(candidate?.data?.projectID || candidate?.data?.project_id || "").trim()
					&& String(candidate?.data?.activeTab || "").trim() == "settings"
				)
			) || null;
		}
		if (!tab) {
			return null;
		}
		let container = null;
		try {
			container = typeof win.Zotero_Tabs.getTabContent == "function"
				? win.Zotero_Tabs.getTabContent(tab.id)
				: win.document.getElementById(tab.id);
		}
		catch (_err) {}
		return container ? { id: tab.id, container } : null;
	},
};
