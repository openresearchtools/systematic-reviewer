var SystematicReviewerWorkflowHost = {
	async _openWorkspaceTab(targetWin = null, projectRef = null) {
		return await this._openWorkflowTab(targetWin, projectRef, { activeTab: "automation" });
	},

	async _openSettingsTab(targetWin = null, options = {}) {
		return await this._openWorkflowTab(targetWin, null, Object.assign({}, options || {}, {
			activeTab: "settings",
		}));
	},

	async _openJobsTab(targetWin = null, projectRef = null, options = {}) {
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		if (!win) {
			throw new Error("No Zotero window is available");
		}
		if (!win.Zotero_Tabs || typeof win.Zotero_Tabs.add != "function") {
			throw new Error("Zotero tab jobs API is unavailable in this window");
		}
		let spec = this._projectTabSpec("jobs", projectRef);
		let forceNew = !!(options?.forceNew || options?.force_new || options?.newTab || options?.new_tab);

		let existing = forceNew ? null : this._findJobsTab(win, spec.projectRef);
		if (existing) {
			await this._mountJobsTab(win, existing.container, spec.projectRef);
			win.Zotero_Tabs.select(existing.id);
			win.focus();
			return existing;
		}

		let tabRef = null;
		tabRef = win.Zotero_Tabs.add({
			id: forceNew ? `${spec.id}-${Date.now().toString(36)}` : spec.id,
			type: spec.type,
			title: spec.title,
			data: {
				pluginID: this.id,
				projectID: spec.projectID,
				projectRef: spec.projectRef,
			},
			select: true,
			onClose: () => {
				let mount = tabRef?.container?._systematicReviewerMount || tabRef?.container;
				if (mount) {
					this._destroyController(mount);
				}
			},
		});
		await this._mountJobsTab(win, tabRef.container, spec.projectRef);
		win.Zotero_Tabs.select(tabRef.id);
		win.focus();
		return tabRef;
	},

	async _openWorkflowTab(targetWin = null, projectRef = null, options = {}) {
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		if (!win) {
			throw new Error("No Zotero window is available");
		}
		if (!win.Zotero_Tabs || typeof win.Zotero_Tabs.add != "function") {
			throw new Error("Zotero tab workspace API is unavailable in this window");
		}
		let activeTab = String(options?.activeTab || options?.active_tab || "").trim();
		let kind = !projectRef && activeTab == "settings" ? "settings" : "manual";
		let spec = this._projectTabSpec(kind, projectRef);
		let forceNew = !!(options?.forceNew || options?.force_new || options?.newTab || options?.new_tab);

		let existing = forceNew
			? null
			: (kind == "settings" ? this._findSettingsTab(win) : this._findWorkflowTab(win, spec.projectRef));
		if (existing) {
			await this._mountWorkflowTab(win, existing.container, spec.projectRef, { activeTab, tabID: existing.id });
			await this._renameSystematicTabByID(existing.id, this._workflowTabTitle(spec.projectRef, activeTab));
			win.Zotero_Tabs.select(existing.id);
			win.focus();
			return existing;
		}

		let tabRef = null;
		tabRef = win.Zotero_Tabs.add({
			id: forceNew ? `${spec.id}-${Date.now().toString(36)}` : spec.id,
			type: spec.type,
			title: this._workflowTabTitle(spec.projectRef, activeTab),
			data: {
				pluginID: this.id,
				projectID: spec.projectID,
				projectRef: spec.projectRef,
				activeTab,
			},
			select: true,
			onClose: () => {
				let mount = tabRef?.container?._systematicReviewerMount || tabRef?.container;
				if (mount) {
					this._destroyController(mount);
				}
			},
		});
		await this._mountWorkflowTab(win, tabRef.container, spec.projectRef, { activeTab, tabID: tabRef.id });
		win.Zotero_Tabs.select(tabRef.id);
		win.focus();
		return tabRef;
	},

		_workflowURL(projectRef = null, options = {}) {
		let baseURL = SystematicReviewerWorkflowServer?.getBaseURL?.() || "";
		if (!baseURL) {
			throw new Error("Systematic Reviewer app server is not available");
		}
		let url = new URL(`${baseURL}${SystematicReviewerWorkflowServer.basePath}/ui/index.html`);
		let project = this._projectReferenceData(projectRef);
		if (project?.projectID) {
			url.searchParams.set("project_id", project.projectID);
		}
		let activeTab = String(options?.activeTab || options?.active_tab || "").trim();
		if (activeTab) {
			url.searchParams.set("active_tab", activeTab);
		}
		let tabID = String(options?.tabID || options?.tab_id || "").trim();
		if (tabID) {
			url.searchParams.set("tab_id", tabID);
		}
		let launchToken = SystematicReviewerWorkflowServer?.mintUILaunchToken?.({
			project_id: project?.projectID || "",
			active_tab: activeTab,
			tab_id: tabID,
		}) || "";
		if (launchToken) {
			url.searchParams.set("sr_launch_token", launchToken);
		}
			return url.toString();
		},

		_workflowHostBackground(win = null) {
			return this._themeClassForWindow(win) == "theme-dark" ? "#1e1e1e" : "#eeeeee";
		},

		async _mountWorkflowTab(win, container, projectRef = null, options = {}) {
		let doc = win?.document;
		if (!doc || !container) {
			throw new Error("Workflow tab could not be mounted");
		}
		container.style.padding = "0";
		container.style.margin = "0";
		container.style.display = "flex";
		container.style.flex = "1";
		container.style.width = "100%";
		container.style.minHeight = "0";
		container.style.height = "100%";
			let hostBackground = this._workflowHostBackground(win);
			container.style.background = hostBackground;

		let mount = container._systematicReviewerMount;
		let mustRebuild = !mount || !mount.isConnected;
		if (mustRebuild) {
			mount = this._html(doc, "div");
			mount.style.display = "flex";
			mount.style.flex = "1";
			mount.style.width = "100%";
			mount.style.minHeight = "0";
			mount.style.height = "100%";
				mount.style.background = hostBackground;
				container.replaceChildren(mount);
				container._systematicReviewerMount = mount;
			}
			else {
				mount.style.background = hostBackground;
			}
		let activeTab = String(options?.activeTab || options?.active_tab || "").trim();
		let kind = !projectRef && activeTab == "settings" ? "settings" : "manual";
		let spec = this._projectTabSpec(kind, projectRef);
		let url = this._workflowURL(spec.projectRef, options || {});
		let tabID = String(options?.tabID || options?.tab_id || mount?._systematicReviewerTabID || spec.id).trim();
		let nextProjectID = spec.projectID || "";
		let browser = mount._systematicReviewerBrowser || null;
		let browserNeedsReset =
			!browser
			|| !browser.isConnected
			|| mount._systematicReviewerProjectID != nextProjectID;
		mount._systematicReviewerTabID = tabID || spec.id;
		mount._systematicReviewerProjectRef = spec.projectRef;
		mount._systematicReviewerProjectID = nextProjectID;
		if (browserNeedsReset) {
			mount.replaceChildren();
			browser = doc.createXULElement("browser");
			browser.setAttribute("type", "content");
			browser.setAttribute("remote", "false");
			browser.setAttribute("maychangeremoteness", "false");
			browser.style.flex = "1";
			browser.style.width = "100%";
				browser.style.minHeight = "0";
				browser.style.border = "0";
				browser.style.background = hostBackground;
				mount.appendChild(browser);
				mount._systematicReviewerBrowser = browser;
			}
			else {
				browser.style.background = hostBackground;
			}
		if (!browser._systematicReviewerWorkflowAppearanceListener) {
			let reviewer = this;
			let listener = () => {
				reviewer._applyWorkflowBrowserAppearance(browser);
			};
			browser.addEventListener("load", listener, true);
			browser._systematicReviewerWorkflowAppearanceListener = listener;
		}
		let currentURL = "";
		try {
			currentURL = String(browser?.currentURI?.spec || browser?.getAttribute?.("src") || "").trim();
		}
		catch (_error) {}
		if (currentURL != url) {
			try {
				if (typeof browser?.loadURI == "function") {
					browser.loadURI(
						Services.io.newURI(url),
						{
							triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
						}
					);
				}
				else {
					browser.setAttribute("src", url);
				}
			}
			catch (_error) {
				browser.setAttribute("src", url);
			}
		}
		this._applyWorkflowBrowserAppearance(browser);
	},
};
