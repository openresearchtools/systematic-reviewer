var SystematicReviewerWindowHost = {
	_registerWindowListener() {
		if (this.windowListener) {
			return;
		}
		let self = this;
		this.windowListener = {
			onOpenWindow(xulWindow) {
				let win = self._domWindowFromXulWindow(xulWindow);
				if (!win) {
					return;
				}
				win.addEventListener("load", () => {
					if (self._isMainZoteroWindow(win)) {
						self._installIntoWindow(win);
					}
				}, { once: true });
			},
			onCloseWindow(xulWindow) {
				let win = self._domWindowFromXulWindow(xulWindow);
				if (win) {
					self._teardownWindow(win);
				}
			},
			onWindowTitleChange() {},
		};
		Services.wm.addListener(this.windowListener);
	},

	_unregisterWindowListener() {
		if (!this.windowListener) {
			return;
		}
		try {
			Services.wm.removeListener(this.windowListener);
		}
		catch (_err) {}
		this.windowListener = null;
	},

	_installIntoExistingWindows() {
		for (let win of this._mainWindows()) {
			this._installIntoWindow(win);
		}
	},

	_installIntoWindow(win) {
		if (!this._isMainZoteroWindow(win)) {
			return;
		}
			win.SystematicReviewerWindowBridge = {
				openSettingsTab: (options = {}) => this._openSettingsTab(win, options || {}),
			};
			this._installZoteroPaneAttachmentOpenOverride(win);
			this._registerCustomTabHooks(win);
		let doc = win.document;
		let popup = doc.getElementById("zotero-collectionmenu");
		if (popup && !doc.getElementById(this.collectionMenuId)) {
			let separator = doc.createXULElement("menuseparator");
			separator.id = this.collectionMenuSeparatorId;
			let menu = doc.createXULElement("menu");
			menu.id = this.collectionMenuId;
			menu.setAttribute("label", "Systematic Reviewer");
			let submenu = doc.createXULElement("menupopup");
			submenu.id = this.collectionMenuPopupId;

			let systematicItem = doc.createXULElement("menuitem");
			systematicItem.id = this.collectionMenuSystematicId;
			systematicItem.setAttribute("label", "Systematic Review");
			systematicItem.addEventListener("command", () => {
				this._activateSelectedCollectionProjectAction(win, {
					projectType: PROJECT_TYPE_SYSTEMATIC_REVIEW,
				}).catch((error) => this._showError(error));
			});

			let customItem = doc.createXULElement("menuitem");
			customItem.id = this.collectionMenuCustomId;
			customItem.setAttribute("label", "Custom Analysis");
			customItem.addEventListener("command", () => {
				this._activateSelectedCollectionProjectAction(win, {
					projectType: PROJECT_TYPE_CUSTOM_ANALYSIS,
				}).catch((error) => this._showError(error));
			});

			let importItem = doc.createXULElement("menuitem");
			importItem.id = this.collectionMenuImportId;
			importItem.setAttribute("label", "Import...");
			importItem.addEventListener("command", () => {
				this._openSelectedProjectImportDialog(win).catch((error) => this._showError(error));
			});

			let mergeHarvestItem = doc.createXULElement("menuitem");
			mergeHarvestItem.id = this.collectionMenuMergeHarvestId;
			mergeHarvestItem.setAttribute("label", "Merge into Pending");
			mergeHarvestItem.addEventListener("command", () => {
				this._mergeSelectedHarvestCollectionIntoPending(win).catch((error) => this._showError(error));
			});

			submenu.append(systematicItem, customItem, importItem, mergeHarvestItem);
			menu.appendChild(submenu);

			let popupHandler = (event) => {
				// popupshowing bubbles from the Systematic Reviewer submenu. Only
				// recalculate state for Zotero's top-level collection popup; otherwise
				// opening our submenu can race the parent menu and hide it on Linux.
				if (event.target !== event.currentTarget) {
					return;
				}
				let state = this.windowState.get(win) || {};
				let updateID = Number(state.collectionMenuUpdateID || 0) + 1;
				this.windowState.set(win, Object.assign({}, state, {
					collectionMenuUpdateID: updateID,
				}));
				this._updateCollectionMenuState(win, updateID)
					.catch((error) => this.log(`failed to update collection menu state: ${error}`));
			};
			popup.addEventListener("popupshowing", popupHandler);
			popup.appendChild(separator);
			popup.appendChild(menu);
			this.windowState.set(win, Object.assign({}, this.windowState.get(win), {
				popup,
				popupHandler,
			}));
		}

		let itemPopup = doc.getElementById("zotero-itemmenu");
			if (itemPopup && !doc.getElementById(this.itemMenuId)) {
			let separator = doc.createXULElement("menuseparator");
			separator.id = this.itemMenuSeparatorId;

			let menu = doc.createXULElement("menu");
			menu.id = this.itemMenuId;
			menu.setAttribute("label", "Systematic Reviewer Convert");
			let submenu = doc.createXULElement("menupopup");

			let autoItem = doc.createXULElement("menuitem");
			autoItem.id = this.itemMenuAutoId;
			autoItem.setAttribute("label", this._configuredPdfConversionMenuLabel(this._configuredPdfConversionModeSync()));
			autoItem.addEventListener("command", () => {
				this._configuredPdfConversionMode()
					.then((mode) => this._queueSelectedItemsForConversion(win, mode))
					.catch((error) => this._showError(error));
			});

			let fastItem = doc.createXULElement("menuitem");
			fastItem.id = this.itemMenuFastId;
			fastItem.setAttribute("label", "FAST");
			fastItem.addEventListener("command", () => {
				this._queueSelectedItemsForConversion(win, "fast").catch((error) => this._showError(error));
			});

			let vlmItem = doc.createXULElement("menuitem");
			vlmItem.id = this.itemMenuVlmId;
			vlmItem.setAttribute("label", "VLM");
			vlmItem.addEventListener("command", () => {
				this._queueSelectedItemsForConversion(win, "vlm").catch((error) => this._showError(error));
			});

			let jobsItem = doc.createXULElement("menuitem");
			jobsItem.id = this.itemMenuJobsId;
			jobsItem.setAttribute("label", "Open Jobs");
			jobsItem.addEventListener("command", () => {
				this._openJobsTab(win).catch((error) => this._showError(error));
			});

			submenu.append(autoItem, fastItem, vlmItem, jobsItem);
			menu.appendChild(submenu);

			let itemPopupHandler = (event) => {
				if (event.target !== event.currentTarget) {
					return;
				}
				this._updateItemMenuState(win);
			};
			itemPopup.addEventListener("popupshowing", itemPopupHandler);
			itemPopup.appendChild(separator);
			itemPopup.appendChild(menu);
			this.windowState.set(win, Object.assign({}, this.windowState.get(win), {
				itemPopup,
				itemPopupHandler,
				}));
			}

			let viewPopup = this._viewMenuPopup(doc);
			if (viewPopup && !doc.getElementById(this.viewMenuId)) {
				let separator = doc.createXULElement("menuseparator");
				separator.id = this.viewMenuSeparatorId;

				let menu = doc.createXULElement("menu");
				menu.id = this.viewMenuId;
				menu.setAttribute("label", "Systematic Reviewer");
				let submenu = doc.createXULElement("menupopup");
				submenu.id = this.viewMenuPopupId;

				let lightItem = doc.createXULElement("menuitem");
				lightItem.id = this.viewMenuLightPreviewEditorId;
				lightItem.setAttribute("label", "Light Preview/Editor page");
				lightItem.setAttribute("type", "radio");
				lightItem.setAttribute("name", "systematic-reviewer-preview-editor-page-theme");
				lightItem.addEventListener("command", () => {
					this._setPreviewEditorPageThemeFromMenu(win, "light").catch((error) => this._showError(error));
				});

				let darkItem = doc.createXULElement("menuitem");
				darkItem.id = this.viewMenuDarkPreviewEditorId;
				darkItem.setAttribute("label", "Dark Preview/Editor page");
				darkItem.setAttribute("type", "radio");
				darkItem.setAttribute("name", "systematic-reviewer-preview-editor-page-theme");
				darkItem.addEventListener("command", () => {
					this._setPreviewEditorPageThemeFromMenu(win, "dark").catch((error) => this._showError(error));
				});

				submenu.append(lightItem, darkItem);
				menu.appendChild(submenu);

				let viewPopupHandler = (event) => {
					if (event.target !== event.currentTarget) {
						return;
					}
					this._updateViewMenuState(win);
				};
				viewPopup.addEventListener("popupshowing", viewPopupHandler);
				viewPopup.appendChild(separator);
				viewPopup.appendChild(menu);
				this.windowState.set(win, Object.assign({}, this.windowState.get(win), {
					viewPopup,
					viewPopupHandler,
				}));
				this._updateViewMenuState(win);
			}

		},

		_viewMenuPopup(doc) {
			return doc?.getElementById?.("menu_viewPopup")
				|| doc?.getElementById?.("view-menu-popup")
				|| doc?.getElementById?.("viewMenuPopup")
				|| doc?.querySelector?.("menupopup#menu_viewPopup, menu#view-menu menupopup, menu[label='View'] menupopup")
				|| null;
		},

		_updateViewMenuState(win) {
			let doc = win?.document || null;
			let isDark = this._themeClassForWindow(win) == "theme-dark";
			let menu = doc?.getElementById?.(this.viewMenuId) || null;
			let separator = doc?.getElementById?.(this.viewMenuSeparatorId) || null;
			if (menu) {
				menu.hidden = !isDark;
			}
			if (separator) {
				separator.hidden = !isDark;
			}
			let theme = this._previewEditorPageTheme?.() || "light";
			let lightItem = doc?.getElementById?.(this.viewMenuLightPreviewEditorId) || null;
			let darkItem = doc?.getElementById?.(this.viewMenuDarkPreviewEditorId) || null;
			if (lightItem) {
				if (theme == "light") {
					lightItem.setAttribute("checked", "true");
				}
				else {
					lightItem.removeAttribute("checked");
				}
			}
			if (darkItem) {
				if (theme == "dark") {
					darkItem.setAttribute("checked", "true");
				}
				else {
					darkItem.removeAttribute("checked");
				}
			}
		},

		async _setPreviewEditorPageThemeFromMenu(win, theme) {
			let nextTheme = this._normalizePreviewEditorPageTheme(theme);
			let path = this._globalSettingsPath();
			let existingRaw = (await this._readJSONFile(path)) || {};
			let existing = this._normalizeGlobalSettings(existingRaw);
			let next = this._normalizeGlobalSettings(Object.assign({}, existing, {
				editor: Object.assign({}, existing.editor || {}, {
					preview_page_theme: nextTheme,
				}),
				updated_at: new Date().toISOString(),
			}));
			await this._writeGlobalSettingsRecord(path, next, existingRaw);
			this._setCachedGlobalSettings(next);
			this._dispatchPreviewEditorPageTheme(nextTheme);
			this._updateViewMenuState(win);
		},

		_dispatchPreviewEditorPageTheme(theme) {
			for (let browser of this._collectWorkflowBrowsers?.() || []) {
				let doc = this._workflowBrowserDocument?.(browser) || null;
				let win = doc?.defaultView || null;
				try {
					if (win?.CustomEvent) {
						win.dispatchEvent(new win.CustomEvent("systematic-reviewer-preview-page-theme-change", {
							detail: { preview_page_theme: this._normalizePreviewEditorPageTheme(theme) },
						}));
					}
				}
				catch (_error) {}
			}
		},

	_resolveMergeNoticeWindow(targetWin = null) {
		let win = targetWin && this._isMainZoteroWindow(targetWin) ? targetWin : this._primaryWindow();
		return this._isMainZoteroWindow(win) ? win : null;
	},

	_dismissMergeWarningNotice(targetWin = null) {
		let win = targetWin?.document ? targetWin : this._resolveMergeNoticeWindow(targetWin);
		let host = win?.document?.getElementById?.("systematic-reviewer-merge-notice-host") || null;
		if (host) {
			try {
				host.remove();
			}
			catch (_error) {}
		}
	},

	async _showMergeWarningNotice(targetWin = null, projectRef = null, options = {}) {
		let win = this._resolveMergeNoticeWindow(targetWin);
		if (!win?.document) {
			return null;
		}
		let doc = win.document;
		this._ensureWorkspaceStyles(doc);
		let themeClass = this._themeClassForWindow(win);
		let host = doc.getElementById("systematic-reviewer-merge-notice-host");
		if (!host) {
			host = this._html(doc, "div", {
				className: "sr-merge-notice-host",
				attrs: { id: "systematic-reviewer-merge-notice-host" },
			});
			doc.documentElement.appendChild(host);
		}
		let sourceCount = Math.max(0, Number(options.sourceCount || 0) || 0);
		let notice = this._html(doc, "div", {
			className: `sr-merge-notice ${themeClass}`.trim(),
			attrs: {
				role: "status",
				"aria-live": "polite",
			},
			children: [
				this._html(doc, "div", {
					className: "sr-merge-notice-copy",
					children: [
						this._html(doc, "div", {
							className: "sr-merge-notice-title",
							text: sourceCount > 1 ? `Merge queued for ${sourceCount} Harvest sources` : "Merge queued",
						}),
						this._html(doc, "div", {
							className: "sr-merge-notice-text",
							text: "Merge jobs across collections are resource-intensive and deduplicate items across multiple identifiers. Zotero may become briefly unresponsive while the job runs. Keep Zotero open until the Jobs tab shows the merge is finished.",
						}),
					],
				}),
				this._html(doc, "div", {
					className: "sr-merge-notice-actions",
					children: [
						this._html(doc, "button", {
							className: "sr-workspace-btn sr-workspace-btn-primary",
							text: "Open Jobs",
							attrs: { type: "button" },
						}),
						this._html(doc, "button", {
							className: "sr-workspace-btn",
							text: "Dismiss",
							attrs: { type: "button" },
						}),
					],
				}),
			],
		});
		let [openJobsBtn, dismissBtn] = Array.from(notice.querySelectorAll("button"));
		let close = () => this._dismissMergeWarningNotice(win);
		dismissBtn?.addEventListener("click", close);
		openJobsBtn?.addEventListener("click", () => {
			this._openJobsTab(win, projectRef || null).catch((error) => this._showError(error));
			close();
		});
		host.replaceChildren(notice);
		return notice;
	},

	_teardownWindow(win) {
		if (win?.SystematicReviewerWindowBridge) {
			try {
				delete win.SystematicReviewerWindowBridge;
			}
			catch (_err) {
				try {
					win.SystematicReviewerWindowBridge = null;
				}
				catch (_innerErr) {}
			}
		}
		let state = this.windowState.get(win);
			if (state?.popup && state.popupHandler) {
				try {
					state.popup.removeEventListener("popupshowing", state.popupHandler);
				}
				catch (_err) {}
			}
			this._restoreZoteroPaneAttachmentOpenOverride(win);
				if (state?.itemPopup && state.itemPopupHandler) {
				try {
					state.itemPopup.removeEventListener("popupshowing", state.itemPopupHandler);
				}
				catch (_err) {}
			}
			if (state?.viewPopup && state.viewPopupHandler) {
				try {
					state.viewPopup.removeEventListener("popupshowing", state.viewPopupHandler);
				}
				catch (_err) {}
			}
			this._dismissMergeWarningNotice(win);
			for (let id of [
					this.collectionMenuId,
				this.collectionMenuSeparatorId,
				this.collectionMenuPopupId,
				this.collectionMenuSystematicId,
				this.collectionMenuCustomId,
				this.collectionMenuImportId,
				this.collectionMenuMergeHarvestId,
					this.itemMenuId,
					this.itemMenuSeparatorId,
					this.viewMenuId,
					this.viewMenuSeparatorId,
					this.viewMenuPopupId,
					this.viewMenuLightPreviewEditorId,
					this.viewMenuDarkPreviewEditorId,
					this.toolsMenuSeparatorId,
				this.toolsMenuSemanticSearchId,
			]) {
			let node = win?.document?.getElementById(id);
			if (node) {
				try {
					node.remove();
				}
				catch (_err) {}
			}
		}
		this.windowState.delete(win);
	},

	_registerCustomTabHooks(win) {
		let tabs = win?.Zotero_Tabs;
		if (!tabs?.tabHooks?.moveToNewWindow) {
			return;
		}
		tabs.tabHooks.moveToNewWindow.systematic = async (tab, tabIndex) => {
			let kind = this._projectTabKindForTab(tab);
			if (!kind) {
				return;
			}
			await this._moveProjectTabToExternalWindow(win, tab, tabIndex, kind);
		};
		if (tabs.tabHooks.restoreState) {
			tabs.tabHooks.restoreState.systematic = async (tab) => {
				try {
					let type = String(tab?.type || "").trim();
					let data = tab?.data || {};
					if (type == this.workflowTabType) {
						let activeTab = String(data?.activeTab || data?.active_tab || "").trim();
						let projectID = String(data?.projectID || data?.project_id || "").trim();
						if (!projectID && activeTab == "settings") {
							await this._openWorkflowTab(win, null, { activeTab: "settings" });
						}
						else if (projectID) {
							let resolved = await this._resolveProjectByID(projectID, {
								sessionID: String(data?.sessionID || data?.session_id || "default").trim() || "default",
							});
							if (resolved) {
								await this._openWorkflowTab(win, resolved, { activeTab: activeTab || "automation" });
							}
						}
					}
					else if (type == this.jobsTabType) {
						let projectID = String(data?.projectID || data?.project_id || "").trim();
						if (projectID) {
							let resolved = await this._resolveProjectByID(projectID, {
								sessionID: String(data?.sessionID || data?.session_id || "default").trim() || "default",
							});
							if (resolved) {
								await this._openJobsTab(win, resolved);
							}
						}
						else {
							await this._openJobsTab(win, null);
						}
					}
				}
				catch (error) {
					this.log(`custom tab restore skipped: ${error}`);
				}
				return {
					itemID: null,
				};
			};
		}
	},

	_projectTabKindForTab(tab = null) {
		if (String(tab?.id || "").trim() == this.settingsTabID) {
			return "settings";
		}
		if (
			tab?.type == this.workflowTabType
			&& !String(tab?.data?.projectID || tab?.data?.project_id || "").trim()
			&& String(tab?.data?.activeTab || "").trim() == "settings"
		) {
			return "settings";
		}
		return this._projectTabKindFromType(tab?.type || "");
	},

	_projectTabKindFromType(type = "") {
		if (type == this.workspaceTabType) {
			return "manual";
		}
		if (type == this.jobsTabType) {
			return "jobs";
		}
		if (type == this.workflowTabType) {
			return "manual";
		}
		if (type == this.markdownViewerTabType) {
			return "markdown_viewer";
		}
		if (type == this.markdownOnlyViewerTabType) {
			return "markdown_only_viewer";
		}
		if (type == this.textAttachmentViewerTabType) {
			return "text_attachment_viewer";
		}
		if (type == this.csvAttachmentViewerTabType) {
			return "csv_attachment_viewer";
		}
		return "";
	},

	async _moveProjectTabToExternalWindow(sourceWin, tab, _tabIndex, kind = "") {
		let nextKind = kind || this._projectTabKindForTab(tab);
		if (!nextKind || !tab?.id) {
			return;
		}
		if (nextKind == "markdown_viewer") {
			let viewerRef = this._markdownViewerReferenceData(tab?.data || null);
			if (!viewerRef) {
				throw new Error("Markdown viewer tab is missing its attachment reference.");
			}
			let targetWin = await this._openNewMainZoteroWindow();
			await this._openMarkdownViewerTab(targetWin, viewerRef);
			sourceWin?.Zotero_Tabs?.close?.(tab.id);
			targetWin?.focus?.();
			return;
		}
		if (nextKind == "markdown_only_viewer") {
			let viewerRef = this._markdownOnlyViewerReferenceData(tab?.data || null);
			if (!viewerRef) {
				throw new Error("Markdown viewer tab is missing its attachment reference.");
			}
			let targetWin = await this._openNewMainZoteroWindow();
			await this._openMarkdownOnlyViewerTab(targetWin, viewerRef);
			sourceWin?.Zotero_Tabs?.close?.(tab.id);
			targetWin?.focus?.();
			return;
		}
			if (nextKind == "text_attachment_viewer") {
				let viewerRef = this._textAttachmentViewerReferenceData(tab?.data || null);
				if (!viewerRef) {
					throw new Error("Text viewer tab is missing its attachment reference.");
				}
				let targetWin = await this._openNewMainZoteroWindow();
				await this._openTextAttachmentViewerTab(targetWin, viewerRef);
				sourceWin?.Zotero_Tabs?.close?.(tab.id);
				targetWin?.focus?.();
				return;
			}
			if (nextKind == "csv_attachment_viewer") {
				let viewerRef = this._csvAttachmentViewerReferenceData(tab?.data || null);
				if (!viewerRef) {
					throw new Error("CSV viewer tab is missing its attachment reference.");
				}
				let targetWin = await this._openNewMainZoteroWindow();
				await this._openCSVAttachmentViewerTab(targetWin, viewerRef);
				sourceWin?.Zotero_Tabs?.close?.(tab.id);
				targetWin?.focus?.();
				return;
			}
			let projectRef = this._projectReferenceData(tab?.data?.projectRef || tab?.data || null);
		let projectID = String(projectRef?.projectID || tab?.data?.projectID || tab?.data?.project_id || "").trim();
		if (nextKind == "settings") {
			let targetWin = await this._openNewMainZoteroWindow();
			await this._openSettingsTab(targetWin);
			sourceWin?.Zotero_Tabs?.close?.(tab.id);
			targetWin?.focus?.();
			return;
		}
		if (!projectID) {
			throw new Error("Project tab is missing its project reference.");
		}
		let resolved = await this._resolveProjectByID(projectID, {
			sessionID: projectRef?.sessionID || tab?.data?.sessionID || tab?.data?.session_id || "default",
		});
		if (!resolved) {
			throw new Error(`Project is no longer available: ${projectID}`);
		}
		let targetWin = await this._openNewMainZoteroWindow();
		if (nextKind == "jobs") {
			await this._openJobsTab(targetWin, resolved);
		}
		else if (nextKind == "manual") {
			let manualState = this._inspectWorkflowTabState(sourceWin, tab);
			await this._openWorkflowTab(targetWin, resolved, {
				activeTab: manualState.activeTab,
			});
		}
		else {
			throw new Error(`Unsupported project tab kind: ${nextKind}`);
		}
		sourceWin?.Zotero_Tabs?.close?.(tab.id);
		targetWin?.focus?.();
	},

	_inspectWorkflowTabState(win, tab = null) {
		if (!win?.Zotero_Tabs || !tab || tab.type != this.workflowTabType) {
			return {
				activeTab: String(tab?.data?.activeTab || "").trim(),
				scopeKey: "",
				url: "",
			};
		}
		let container = null;
		try {
			container = typeof win.Zotero_Tabs.getTabContent == "function"
				? win.Zotero_Tabs.getTabContent(tab.id)
				: win.document.getElementById(tab.id);
		}
		catch (_error) {}
		let mount = container?._systematicReviewerMount || container || null;
		let browser = mount?._systematicReviewerBrowser || null;
		let doc = null;
		try {
			doc = browser?.contentDocument || browser?.contentWindow?.document || null;
		}
		catch (_error) {}
		let activeTab = "";
		let scopeKey = "";
		if (doc) {
			try {
				activeTab = String(
					doc.querySelector?.(".mw-tab.is-active")?.getAttribute?.("data-tab")
					|| tab?.data?.activeTab
					|| ""
				).trim();
			}
			catch (_error) {}
			try {
				let scopeSelect = doc.querySelector?.(
					"select[data-screening-scope='true'], select[data-extraction-scope-select='true'], select[data-semantic-scope-select='true'], select[data-explore-scope-select='true'], select[data-embeddings-scope-select='true']"
				) || null;
				scopeKey = String(scopeSelect?.value || "").trim();
			}
			catch (_error) {}
		}
		let url = "";
		try {
			url = String(browser?.currentURI?.spec || browser?.getAttribute?.("src") || "").trim();
		}
		catch (_error) {}
		if (!activeTab && url) {
			try {
				activeTab = String(new URL(url).searchParams.get("active_tab") || "").trim();
			}
			catch (_error) {}
		}
		return {
			activeTab,
			scopeKey,
			url,
		};
	},

	async _openNewMainZoteroWindow() {
		let owner = this._primaryWindow();
		if (!owner || typeof owner.open != "function") {
			throw new Error("No Zotero window is available.");
		}
		let existing = new Set(this._mainWindows());
		let chromeURI = (typeof AppConstants != "undefined" && AppConstants?.BROWSER_CHROME_URL)
			? AppConstants.BROWSER_CHROME_URL
			: "chrome://zotero/content/zoteroPane.xhtml";
		owner.open(chromeURI, "_blank", "chrome,all,dialog=no,resizable=yes");
		let win = null;
		await new Promise((resolve, reject) => {
			let settled = false;
			let finish = (callback) => {
				if (settled) {
					return;
				}
				settled = true;
				callback();
			};
			let checkReady = () => {
				if (settled) {
					return;
				}
				let next = this._mainWindows().find((candidate) =>
					!existing.has(candidate)
					&& this._isMainZoteroWindow(candidate)
					&& candidate?.Zotero_Tabs?.add
					&& candidate?.Zotero_Tabs?._tabBarRef?.current
					&& candidate?.document?.getElementById?.("tabs-deck")
				) || null;
				if (next) {
					win = next;
					finish(() => resolve());
				}
			};
			let intervalID = setInterval(checkReady, 100);
			let timeoutID = setTimeout(() => {
				try {
					clearInterval(intervalID);
				}
				catch (_err) {}
				finish(() => reject(new Error("Timed out waiting for the Zotero window to initialize.")));
			}, 30000);
			checkReady();
		});
		if (!win) {
			throw new Error("Failed to open a new Zotero window.");
		}
		return win;
	},

	_projectTabEntries(projectID = "") {
		let target = String(projectID || "").trim();
		let entries = [];
		for (let win of this._mainWindows()) {
			let tabs = win?.Zotero_Tabs?._tabs || [];
			for (let tab of tabs) {
				let kind = this._projectTabKindForTab(tab);
				if (!kind || !tab?.id) {
					continue;
				}
				let tabProjectID = String(tab?.data?.projectID || tab?.data?.project_id || "").trim();
				if (target && tabProjectID != target) {
					continue;
				}
				entries.push({
					win,
					tabID: tab.id,
					projectID: tabProjectID,
					kind,
				});
			}
		}
		return entries;
	},

	_closeProjectTabs(projectID = "") {
		let closed = 0;
		for (let entry of this._projectTabEntries(projectID)) {
			try {
				entry.win?.Zotero_Tabs?.close?.(entry.tabID);
				closed += 1;
			}
			catch (_err) {}
		}
		return closed;
	},
};
