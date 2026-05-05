var SystematicReviewerWorkspaceController = {
	async _buildWorkspacePayload(projectRef = null, options = {}) {
		let current = await this._resolveProjectReference(projectRef || null);
		if (!current && !projectRef) {
			current = await this._resolveCurrentProject();
			if (!current) {
				current = await this._restoreLastProjectSelection();
			}
		}
		if (!current) {
			return {
				current_project: null,
				project_catalog: await this._listStoredProjects(),
				workspace_document: null,
				chat_history: [],
				chat_history_raw: [],
				chat_budget: null,
				pending_messages: [],
				sessions: [],
				session_tool_catalog: this._sessionToolCatalog(),
			};
		}
		let includeProjectCounts = options?.includeProjectCounts !== false && options?.includeCounts !== false;
		let sessionStatus = await this._sessionOpen(current, {
			sessionID: current.sessionID || "default",
			surface: options?.surface || "session",
			ensureWelcome: options?.ensureWelcome,
			ensureSessionWelcome: options?.ensureSessionWelcome,
			includeInspection: options?.includeInspection,
			includeSessionInspection: options?.includeSessionInspection,
			includePromptProjection: options?.includePromptProjection,
			includeSessionPromptProjection: options?.includeSessionPromptProjection,
		});
		let sessionID = sessionStatus.session.session_id;
		let projectCatalog = (await this._listStoredProjects()).filter((entry) => entry.project_id == current.context.projectID);
		if (!projectCatalog.length) {
			projectCatalog = [{
				project_id: current.context.projectID,
				library_id: current.context.libraryID,
				collection_key: current.context.collectionKey,
				collection_name: current.context.collectionName,
				project_item_key: current.projectItem.key,
				outputs_item_key: ((await this._readJSONFile(current.context.settingsPath)) || {}).outputs_item_key || "",
				project_type: current.projectType,
				last_session_id: sessionID,
			}];
		}
		let projectSettings = (await this._readJSONFile(current.context.settingsPath)) || {};
		return {
			current_project: {
					entry: {
						project_id: current.context.projectID,
						name: current.context.collectionName,
						path: current.context.projectRoot,
						database_path: current.context.databasePath,
						project_type: current.projectType,
					},
				zotero: {
					library_id: current.context.libraryID,
					collection_key: current.context.collectionKey,
					collection_name: current.context.collectionName,
					project_item_key: current.projectItem.key,
					outputs_item_key: projectSettings.outputs_item_key || "",
				},
				counts: includeProjectCounts ? await this._projectCounts(current.context) : null,
				settings: projectSettings,
				active_session_id: sessionID,
				session: sessionStatus.session,
				session_runtime_state: sessionStatus.runtime_state || null,
				session_inspection: sessionStatus.inspection,
				chat_budget: sessionStatus.chat_budget || null,
				pending_messages: sessionStatus.pending_messages || [],
			},
			project_catalog: projectCatalog,
			workspace_document: await this._workspaceDocument(current.context, {
				includeHTML: options?.includeDocumentHTML !== false,
			}),
			sessions: sessionStatus.sessions,
			chat_history: sessionStatus.timeline || sessionStatus.visible_timeline,
			chat_history_visible: sessionStatus.visible_timeline || [],
			chat_history_raw: sessionStatus.timeline,
			chat_budget: sessionStatus.chat_budget || null,
			pending_messages: sessionStatus.pending_messages || [],
			prompt_projection: sessionStatus.prompt_projection || null,
			session_tool_catalog: sessionStatus.tool_catalog,
		};
	},

	async _refreshController(controller) {
		if (controller?.kind == "jobs") {
			return this._refreshJobsController(controller);
		}
		if (controller?.kind == "markdown-viewer") {
			return this._refreshMarkdownViewerController(controller);
		}
		let hadBootstrap = !!controller.bootstrap;
		if (!hadBootstrap) {
			this._setStatus(controller, "Loading project...");
		}
		try {
			let payload = await this._buildWorkspacePayload(controller?.projectRef || null);
			controller.bootstrap = payload;
			if (payload.current_project) {
				controller.projectRef = this._projectReferenceData(payload.current_project.zotero || {}, {
					projectID: payload.current_project.entry.project_id,
					libraryID: payload.current_project.zotero?.library_id || 0,
					collectionKey: payload.current_project.zotero?.collection_key || "",
					collectionName: payload.current_project.zotero?.collection_name || payload.current_project.entry.name || "",
					projectItemKey: payload.current_project.zotero?.project_item_key || "",
					sessionID: payload.current_project.active_session_id || "default",
					projectType: payload.current_project.entry.project_type || "",
				});
				let current = await this._resolveProjectReference(controller.projectRef || null);
				if (current?.context) {
					await this._primeProjectItemKeyAliases(current.context);
				}
			}
			this._applyWorkspacePayload(controller, payload);
			if (!hadBootstrap || !payload.current_project) {
				this._setStatus(
					controller,
					payload.current_project ? "Ready" : this._projectOpenStatusLabel(),
					payload.current_project ? "ready" : ""
				);
			}
		}
		catch (error) {
			this._setStatus(controller, "Workspace failed", "error");
			this._renderChat(controller, []);
			controller.els.preview.innerHTML =
				`<div class="sr-workspace-empty">Failed to load project workspace: ${this._escapeHTML(error?.message || String(error))}</div>`;
		}
	},

	_applyWorkspacePayload(controller, payload) {
		let currentProject = payload.current_project || null;
		let zotero = currentProject?.zotero || {};
		let counts = currentProject?.counts || null;
		let workspaceTitle = zotero.collection_name || currentProject?.entry?.name || "Systematic Reviewer";
		controller.els.title.textContent =
			workspaceTitle;
		controller.els.path.textContent = currentProject
			? `${counts?.items || 0} items | ${counts?.attachments || 0} attachments`
			: this._projectOpenHintText();
			this._setWorkspaceHostTitle(controller, currentProject ? `${workspaceTitle} - Systematic Reviewer` : "Systematic Reviewer");
			this._applyControllerTheme(controller);
			this._ensureWorkspaceCitationCaches(controller);
			this._populateEditorSettingsControls(controller, currentProject);
			this._populateProjectControls(controller, payload.project_catalog || [], currentProject?.entry?.project_id || "");
			this._populateSessionControls(controller, payload.sessions || [], currentProject?.active_session_id || "");
			this._applyEditorSettingsToRoot(controller);
		this._renderChat(controller, payload.chat_history || []);
		let nextDocument = payload.workspace_document || null;
		let incomingPath = nextDocument?.path || null;
		let mustSwapDocument = controller.documentPath !== incomingPath || (!controller.documentDirty && !controller.saving);
		if (mustSwapDocument) {
			this._renderWorkspace(controller, nextDocument);
		}
	},

	async _setWorkspaceHostTitle(controller, title) {
		let nextTitle = String(title || "Systematic Reviewer");
		try {
			controller.doc.title = nextTitle;
		}
		catch (_err) {}
		try {
			let win = controller?.doc?.defaultView;
			let tabID = controller?.body?._systematicReviewerTabID;
			if (tabID && win?.Zotero_Tabs?.rename) {
				await win.Zotero_Tabs.rename(tabID, nextTitle);
			}
		}
		catch (_err) {}
	},

	_setStatus(controller, text, tone = "") {
		let el = controller.els.status;
		el.textContent = text;
		el.classList.remove("ready", "error");
		if (tone) {
			el.classList.add(tone);
		}
	},

	_setEditing(controller, editing) {
		this._setWorkspaceMode(controller, editing ? "native" : "preview");
	},

	async _switchProject(controller, projectID) {
		let target = String(projectID || "").trim();
		if (!target) {
			return;
		}
		let current = await this._openStoredProject(target);
		controller.projectRef = this._projectReferenceData(current);
		await this._refreshController(controller);
		this._setStatus(controller, "Project switched", "ready");
	},

	async _switchWorkspaceMode(controller, mode) {
		let nextMode = ["preview", "native", "raw"].includes(mode) ? mode : "preview";
		if (controller.mode == nextMode) {
			return;
		}
		if (controller.documentDirty || controller.nativeDirty) {
			await this._saveMarkdown(controller, { silent: true });
		}
		this._setWorkspaceMode(controller, nextMode);
	},
};
