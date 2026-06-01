var SystematicReviewerRuntimeSettings = {
	async savePreferencePaneSettings(payload = {}) {
		let path = this._globalSettingsPath();
		let existingRaw = (await this._readJSONFile(path)) || {};
		let existing = this._normalizeGlobalSettings(existingRaw);
		this._validateRuntimeRoleRequestPayload(payload.runtime_roles);
		let legacyEndpoints = this._normalizeAIEndpointSettings(
			existing.ai_endpoints || existing.model_endpoints || existing.endpoints || null,
			existing.openai_compatible || null
		);
		let apiConnections = this._normalizeAPIConnections(
			payload.api_connections || existing.api_connections || null,
			legacyEndpoints
		);
		apiConnections = await this._refreshLocalConnectionModelCaches(apiConnections);
		let runtimeRoles = this._normalizeRuntimeRoles(
			payload.runtime_roles || existing.runtime_roles || null,
			apiConnections,
			legacyEndpoints
		);
		let runtimePreferences = this._normalizeRuntimePreferences(
			payload.runtime_preferences || existing.runtime_preferences || null
		);
		let serverSecurity = this._normalizeServerSecuritySettings(
			payload.server_security || existing.server_security || null
		);
		let privilegedTools = this._normalizePrivilegedToolSettings(
			payload.privileged_tools || existing.privileged_tools || null
		);
		let mcpClients = this._normalizeMCPClientSettings(
			payload.mcp_clients || existing.mcp_clients || null
		);
			let pdfMarkdown = this._normalizePdfMarkdownSettings(
				payload.pdf_markdown || existing.pdf_markdown || null
			);
			let normalizedEndpoints = this._materializeAIEndpointsFromRuntimeRoles(
				apiConnections,
				runtimeRoles,
			legacyEndpoints,
			runtimePreferences
		);
		this._validateAIEndpointSettings(normalizedEndpoints);
		this._validateRuntimeRoles(runtimeRoles, apiConnections, runtimePreferences, pdfMarkdown);
		this._validateRuntimeRoleModelCapabilities(runtimeRoles, apiConnections, runtimePreferences, pdfMarkdown);
			let next = Object.assign({}, existing, {
				api_connections: apiConnections,
					runtime_roles: runtimeRoles,
					runtime_preferences: runtimePreferences,
					server_security: serverSecurity,
					privileged_tools: privilegedTools,
					mcp_clients: mcpClients,
					ai_endpoints: normalizedEndpoints,
					pdf_markdown: pdfMarkdown,
					editor: this._normalizeEditorSettings(payload.editor || existing.editor || null),
					agent_runtime_catalog: this._defaultAgentRuntimeCatalog(),
				openalex_api_key: String(
					payload.openalex_api_key !== undefined ? payload.openalex_api_key : (existing.openalex_api_key || "")
				).trim(),
		});
		next = this._normalizeGlobalSettings(next);
		next.updated_at = new Date().toISOString();
			await this._writeGlobalSettingsRecord(path, next, existingRaw);
			this._setCachedGlobalSettings(next);
			this._dispatchPreviewEditorPageTheme?.(next.editor?.preview_page_theme || "light");
			SystematicReviewerMCPServer?.applySettings?.(next.server_security || null);
		await SystematicReviewerMCPClient?.applySettings?.(next.mcp_clients || null, this);
		if (typeof SystematicReviewerPrivilegedTools != "undefined") {
			SystematicReviewerPrivilegedTools?.applySettings?.(next.privileged_tools || null, this);
		}
		this.agentTools?.rebuild?.();
		return this.getPreferencePanePayload();
	},

	async scanPreferencePaneEndpoints(payload = {}) {
		let existing = await this._globalSettings();
		let legacyEndpoints = this._normalizeAIEndpointSettings(
			existing.ai_endpoints || null,
			existing.openai_compatible || null
		);
		let runtimePreferences = this._normalizeRuntimePreferences(
			payload.runtime_preferences || existing.runtime_preferences || null
		);
		let apiConnections = this._normalizeAPIConnections(
			payload.api_connections || existing.api_connections || null,
			legacyEndpoints
		);
		let scan = await this._scanAPIConnectionsDetailed(apiConnections);
		if (payload?.include_executor_models === true || payload?.includeExecutorModels === true) {
			runtimePreferences = await this._refreshExecutorModelCaches(runtimePreferences, {
				opencode: true,
			});
		}
		return {
			scanned_at: new Date().toISOString(),
			api_results: scan.results,
			api_errors: scan.errors,
			runtime_preferences: runtimePreferences,
			detected_executors: this._scanInstalledExecutors(runtimePreferences),
			agent_runtime_catalog: this._defaultAgentRuntimeCatalog(),
		};
	},

	async revealPreferencePaneProject(projectID = "") {
		let target = String(projectID || "").trim();
		if (!target) {
			throw new Error("project_id is required.");
		}
		let stored = (await this._listStoredProjects()).find((entry) => entry.project_id == target) || null;
		if (!stored) {
			throw new Error(`Unknown stored project: ${target}`);
		}
		if (!(await this._pathExists(stored.project_root || ""))) {
			throw new Error("Project folder was not found on disk.");
		}
		this._openFileExternally(stored.project_root);
		return {
			ok: true,
			project_id: stored.project_id,
			project_root: stored.project_root,
		};
	},

	async deletePreferencePaneProject({ projectID = "", project_id = "", deleteCollection = false, delete_collection = false } = {}) {
		let target = String(projectID || project_id || "").trim();
		if (!target) {
			throw new Error("project_id is required.");
		}
		let stored = (await this._listStoredProjects()).find((entry) => entry.project_id == target) || null;
		if (!stored) {
			throw new Error(`Unknown stored project: ${target}`);
		}
		let shouldDeleteCollection = deleteCollection === true || delete_collection === true;
		let collection = stored.available_in_zotero
			? this._collectionByKey(stored.library_id, stored.collection_key)
			: null;
		let projectItem = stored.project_item_key
			? Zotero.Items.getByLibraryAndKey(stored.library_id, stored.project_item_key)
			: null;
		let outputsItem = stored.outputs_item_key
			? Zotero.Items.getByLibraryAndKey(stored.library_id, stored.outputs_item_key)
			: null;
		if (!outputsItem && collection) {
			outputsItem = await this._resolveProjectOutputsItem(
				collection,
				"",
				false,
				stored.project_type || PROJECT_TYPE_SYSTEMATIC_REVIEW
			);
		}
		if (projectItem && !projectItem.deleted) {
			await this._eraseProjectItemAndChildren(projectItem);
		}
		if (outputsItem && !outputsItem.deleted && outputsItem.id != projectItem?.id) {
			await this._eraseProjectItemAndChildren(outputsItem);
		}
		this._closeProjectTabs(target);
		this._invalidateProjectDB(target);
		if (await this._pathExists(stored.project_root || "")) {
			await this._removePathRecursiveIfExists(stored.project_root);
		}
		if (shouldDeleteCollection && collection) {
			await collection.eraseTx();
		}
		await this._clearDeletedProjectReferences(target);
		return await this.getPreferencePanePayload();
	},

	_defaultOpenAICompatibleConfig() {
		return {
			base_url: "",
			model: "",
			api_kind: "auto",
			api_key: "",
			timeout_ms: 120000,
		};
	},

	_defaultAgentRuntimeCatalog() {
		return [
			{
				id: "codex",
				label: "Codex",
				mode: "external_agent",
				summary: "External Codex session drives the same localhost tool surface and persistent collection sessions.",
			},
			{
				id: "opencode",
				label: "OpenCode",
				mode: "external_agent",
				summary: "External OpenCode session drives the same localhost tool surface and persistent collection sessions.",
			},
			{
				id: "custom",
				label: "Custom MCP / client",
				mode: "external_agent",
				summary: "Any other external runtime can drive the same localhost tool surface and persistent collection sessions.",
			},
		];
	},

	_defaultAgentExecutionCatalog() {
		return this._defaultAgentRuntimeCatalog();
	},

	_defaultServerSecuritySettings() {
		return {
			mcp_enabled: false,
			mcp_api_key: "",
		};
	},

	_defaultPrivilegedToolSettings() {
		return {
			shell_enabled: false,
			browser_enabled: false,
			default_timeout_ms: 300000,
			dev_tools_enabled: false,
		};
	},

	_defaultMCPClientSettings() {
		return {
			servers: [],
		};
	},

	_defaultRuntimeRole(roleID) {
		let defaults = {
			session_chat: {
				runtime_type: "local_api",
				connection_id: "",
				model: "",
				api_kind: "responses",
				timeout_ms: 1200000,
				reasoning_effort: "",
				executor_id: "",
				agent_runtime_id: "codex",
				context_window: 120000,
				max_output_tokens: 10000,
				embeddings_batch_size: 0,
				parallel_requests: 1,
				independent_resources: false,
				state_mode: "stateless",
				model_presets: [],
			},
			data_extraction: {
				runtime_type: "local_api",
				connection_id: "",
				model: "",
				api_kind: "responses",
				timeout_ms: 1200000,
				reasoning_effort: "",
				executor_id: "",
				agent_runtime_id: "codex",
				context_window: 32000,
				max_output_tokens: 10000,
				embeddings_batch_size: 0,
				parallel_requests: 1,
				independent_resources: false,
				state_mode: "",
				model_presets: [],
			},
			pdf_vlm: {
				runtime_type: "local_api",
				connection_id: "",
				model: "",
				api_kind: "responses",
				timeout_ms: 1200000,
				reasoning_effort: "",
				executor_id: "",
				context_window: 30000,
				max_output_tokens: 10000,
				embeddings_batch_size: 0,
				parallel_requests: 1,
				independent_resources: false,
				state_mode: "",
				model_presets: [],
			},
			embeddings: {
				runtime_type: "local_api",
				connection_id: "",
				model: "",
				api_kind: "responses",
				timeout_ms: 1200000,
				reasoning_effort: "",
				executor_id: "",
				context_window: 0,
				max_output_tokens: 0,
				embeddings_batch_size: 32,
				parallel_requests: 0,
				independent_resources: false,
				state_mode: "",
				model_presets: [],
			},
		};
		return Object.assign({}, defaults[roleID] || defaults.session_chat);
	},

	_defaultRuntimeRoles() {
		return {
			session_chat: this._defaultRuntimeRole("session_chat"),
			data_extraction: this._defaultRuntimeRole("data_extraction"),
			pdf_vlm: this._defaultRuntimeRole("pdf_vlm"),
			embeddings: this._defaultRuntimeRole("embeddings"),
		};
	},

	_roleSupportsPresetCatalog(roleID = "") {
		return ["session_chat", "data_extraction"].includes(String(roleID || "").trim());
	},

	_defaultRolePresetStateMode(roleID = "") {
		return roleID == "session_chat" ? "stateless" : "";
	},

	_normalizeRoleStateMode(roleID = "", value = "", fallback = "") {
		if (roleID != "session_chat") {
			return "";
		}
		let next = String(value || "").trim().toLowerCase();
		if (!["stateful", "stateless"].includes(next)) {
			next = String(fallback || "").trim().toLowerCase();
		}
		return ["stateful", "stateless"].includes(next) ? next : "stateless";
	},

	_normalizeParallelRequests(roleID = "", value, fallback = 1) {
		if (roleID == "embeddings") {
			return 0;
		}
		return this._normalizePositiveInteger(value, Math.max(1, Number(fallback || 1) || 1));
	},

	_builtinReasoningEffortOptions() {
		return ["none", "minimal", "low", "medium", "high", "xhigh"];
	},

	_normalizeReasoningEffort(value = "", options = {}) {
		let normalized = String(value || "").trim().toLowerCase();
		if (!normalized || normalized == "default") {
			return "";
		}
		if (this._builtinReasoningEffortOptions().includes(normalized)) {
			return normalized;
		}
		return options?.allowCustom === false ? "" : normalized;
	},

	_runtimeRoleSupportsReasoning(roleID = "", runtimeType = "") {
		return String(roleID || "").trim() != "embeddings"
			&& ["local_api", "external_api"].includes(String(runtimeType || "").trim());
	},

	_runtimeRoleSupportsOpenCodeReasoning(roleID = "", runtimeType = "", executorID = "") {
		let role = String(roleID || "").trim();
		return role != "embeddings"
			&& ["session_chat", "data_extraction"].includes(role)
			&& String(runtimeType || "").trim() == "local_exec"
			&& String(executorID || "").trim() == "opencode";
	},

	_normalizeRuntimeRoleAPIKind(roleID = "", runtimeType = "", value = "") {
		let role = String(roleID || "").trim();
		let type = String(runtimeType || "").trim();
		if (role == "embeddings" || !["local_api", "external_api"].includes(type)) {
			return "responses";
		}
		return String(value || "").trim() == "chat_completions" ? "chat_completions" : "responses";
	},

	_defaultRuntimeModelPreset(roleID = "", index = 0) {
		let defaults = this._defaultRuntimeRole(roleID);
		return {
			preset_id: `${String(roleID || "preset").trim() || "preset"}-preset-${index + 1}`,
			label: "",
			runtime_type: defaults.runtime_type,
			connection_id: defaults.connection_id,
			executor_id: defaults.executor_id,
			model: defaults.model,
			api_kind: defaults.api_kind || "responses",
			timeout_ms: defaults.timeout_ms,
			reasoning_effort: defaults.reasoning_effort || "",
			context_window: defaults.context_window,
			max_output_tokens: defaults.max_output_tokens,
			state_mode: this._defaultRolePresetStateMode(roleID),
			parallel_requests: defaults.parallel_requests,
			independent_resources: !!defaults.independent_resources,
		};
	},

	_normalizeRuntimeModelPreset(roleID = "", raw, apiConnections, index = 0) {
		let defaults = this._defaultRuntimeModelPreset(roleID, index);
		let merged = Object.assign({}, defaults, raw || {});
		let runtimeType = this._normalizeRuntimeTypeForRole(
			roleID,
			merged.runtime_type || merged.runtimeType || defaults.runtime_type
		);
		if (!["local_api", "external_api", "local_exec"].includes(runtimeType)) {
			runtimeType = defaults.runtime_type;
		}
		let requestedConnectionID = String(merged.connection_id || merged.connectionID || "").trim();
		let resolvedConnection = ["local_api", "external_api"].includes(runtimeType)
			? this._findConnectionByID(apiConnections, requestedConnectionID) || null
			: null;
		return {
			preset_id: String(merged.preset_id || merged.presetID || defaults.preset_id).trim() || defaults.preset_id,
			label: String(merged.label || "").trim(),
			runtime_type: runtimeType,
			connection_id: ["local_api", "external_api"].includes(runtimeType)
				? String(resolvedConnection?.id || "").trim()
				: "",
			executor_id: runtimeType == "local_exec"
				? String(merged.executor_id || merged.executorID || "").trim()
				: "",
			model: String(merged.model || merged.custom_model || merged.customModel || "").trim(),
			api_kind: this._normalizeRuntimeRoleAPIKind(
				roleID,
				runtimeType,
				merged.api_kind ?? merged.apiKind ?? defaults.api_kind
			),
			timeout_ms: this._normalizeEndpointTimeout(merged.timeout_ms, defaults.timeout_ms),
			reasoning_effort: this._runtimeRoleSupportsOpenCodeReasoning(roleID, runtimeType, merged.executor_id || merged.executorID)
				? this._normalizeOpenCodeVariantID(merged.reasoning_effort ?? merged.reasoningEffort)
				: this._runtimeRoleSupportsReasoning(roleID, runtimeType)
				? this._normalizeReasoningEffort(merged.reasoning_effort ?? merged.reasoningEffort, { allowCustom: true })
				: "",
			context_window: roleID == "embeddings"
				? 0
				: this._normalizePositiveInteger(
					merged.context_window ?? merged.contextWindow,
					defaults.context_window || 0
				),
			max_output_tokens: roleID == "embeddings"
				? 0
				: this._normalizePositiveInteger(
					merged.max_output_tokens ?? merged.maxOutputTokens,
					defaults.max_output_tokens || 10000
				),
			state_mode: runtimeType == "local_exec"
				? "stateless"
				: this._normalizeRoleStateMode(roleID, merged.state_mode ?? merged.stateMode, defaults.state_mode),
			parallel_requests: this._normalizeParallelRequests(
				roleID,
				merged.parallel_requests ?? merged.parallelRequests,
				defaults.parallel_requests || 1
			),
			independent_resources: this._normalizeBoolean(
				merged.independent_resources ?? merged.independentResources,
				defaults.independent_resources
			),
		};
	},

	_normalizeRuntimeModelPresets(roleID = "", raw, apiConnections) {
		if (!this._roleSupportsPresetCatalog(roleID)) {
			return [];
		}
		let source = Array.isArray(raw) ? raw : [];
		let seen = new Set();
		let out = [];
		for (let index = 0; index < source.length; index += 1) {
			let preset = this._normalizeRuntimeModelPreset(roleID, source[index], apiConnections || [], index);
			let key = String(preset.preset_id || "").trim() || `preset-${index + 1}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(preset);
		}
		return out;
	},

	_roleAsRuntimePreset(roleID = "", role = {}, options = {}) {
		let defaults = this._defaultRuntimeRole(roleID);
		let source = Object.assign({}, defaults, role || {});
		return {
			preset_id: String(options.preset_id || "default").trim() || "default",
			label: String(options.label || "Default").trim() || "Default",
			runtime_type: String(source.runtime_type || defaults.runtime_type).trim() || defaults.runtime_type,
			connection_id: String(source.connection_id || "").trim(),
			executor_id: String(source.executor_id || "").trim(),
			model: String(source.model || "").trim(),
			api_kind: this._normalizeRuntimeRoleAPIKind(
				roleID,
				source.runtime_type || defaults.runtime_type,
				source.api_kind ?? source.apiKind ?? defaults.api_kind
			),
			timeout_ms: this._normalizeEndpointTimeout(source.timeout_ms, defaults.timeout_ms),
			reasoning_effort: this._runtimeRoleSupportsOpenCodeReasoning(roleID, source.runtime_type || defaults.runtime_type, source.executor_id || source.executorID)
				? this._normalizeOpenCodeVariantID(source.reasoning_effort ?? source.reasoningEffort)
				: this._runtimeRoleSupportsReasoning(roleID, source.runtime_type || defaults.runtime_type)
				? this._normalizeReasoningEffort(source.reasoning_effort ?? source.reasoningEffort, { allowCustom: true })
				: "",
			context_window: roleID == "embeddings" ? 0 : this._normalizePositiveInteger(source.context_window, defaults.context_window || 0),
			max_output_tokens: roleID == "embeddings" ? 0 : this._normalizePositiveInteger(source.max_output_tokens, defaults.max_output_tokens || 10000),
			state_mode: this._normalizeRoleStateMode(roleID, source.state_mode, defaults.state_mode),
			parallel_requests: this._normalizeParallelRequests(roleID, source.parallel_requests, defaults.parallel_requests || 1),
			independent_resources: this._normalizeBoolean(source.independent_resources, defaults.independent_resources),
			is_default: true,
		};
	},

	_rolePresetCatalog(roleID = "", runtimeRoles = null, apiConnections = null, legacyEndpoints = null) {
		let roles = this._normalizeRuntimeRoles(runtimeRoles || this._defaultRuntimeRoles(), apiConnections || [], legacyEndpoints);
		let role = roles?.[roleID] || this._defaultRuntimeRole(roleID);
		let catalog = [this._roleAsRuntimePreset(roleID, role, { preset_id: "default", label: "Default" })];
		if (this._roleSupportsPresetCatalog(roleID)) {
			for (let preset of this._normalizeRuntimeModelPresets(roleID, role.model_presets || [], apiConnections || [])) {
				catalog.push(Object.assign({}, preset, { is_default: false }));
			}
		}
		return catalog;
	},

	_resolveRolePreset(roleID = "", runtimeRoles = null, apiConnections = null, legacyEndpoints = null, presetID = "") {
		let catalog = this._rolePresetCatalog(roleID, runtimeRoles, apiConnections, legacyEndpoints);
		let wanted = String(presetID || "").trim();
		if (!wanted || wanted == "default") {
			return catalog[0] || null;
		}
		return catalog.find((preset) => String(preset?.preset_id || "").trim() == wanted) || null;
	},

	_runtimePresetConnection(preset = {}, apiConnections = []) {
		if (!["local_api", "external_api"].includes(String(preset?.runtime_type || "").trim())) {
			return null;
		}
		return this._findConnectionByID(apiConnections || [], preset?.connection_id || "") || null;
	},

	_runtimePresetExecutor(preset = {}) {
		if (String(preset?.runtime_type || "").trim() != "local_exec") {
			return null;
		}
		return this._localExecExecutor(preset) || null;
	},

	_runtimePresetSupportsReasoning(roleID = "", preset = {}) {
		return this._runtimeRoleSupportsReasoning(roleID, preset?.runtime_type || "");
	},

	_runtimePresetLabel(roleID = "", preset = {}, apiConnections = []) {
		let cleanRoleID = String(roleID || "").trim();
		let isDefault = String(preset?.preset_id || "").trim() == "default" || !!preset?.is_default;
		let label = String(preset?.label || "").trim();
		let baseLabel = label || (isDefault ? "Default" : "Preset");
		if (String(preset?.runtime_type || "").trim() == "local_exec") {
			let executor = this._runtimePresetExecutor(preset);
			let executorLabel = String(executor?.label || preset?.executor_id || "CLI").trim();
			return `${baseLabel} - ${executorLabel}`;
		}
		let connection = this._runtimePresetConnection(preset, apiConnections);
		let connectionLabel = String(connection?.label || "").trim();
		let model = String(preset?.model || "").trim();
		let parts = [baseLabel];
		if (connectionLabel) {
			parts.push(connectionLabel);
		}
		if (model) {
			parts.push(model);
		}
		return parts.join(" - ");
	},

		_runtimePresetSummary(roleID = "", preset = {}, apiConnections = [], runtimePreferences = null) {
			let connection = this._runtimePresetConnection(preset, apiConnections);
			let executor = this._runtimePresetExecutor(preset);
			let runtimeType = String(preset?.runtime_type || "").trim();
			let apiKind = this._normalizeRuntimeRoleAPIKind(roleID, runtimeType, preset?.api_kind ?? preset?.apiKind);
			let model = String(preset?.model || "").trim();
			let isOpenCode = runtimeType == "local_exec" && String(executor?.id || preset?.executor_id || "").trim() == "opencode";
		let openCodeModels = isOpenCode
			? this._openCodeModelsForRole(roleID, runtimePreferences)
			: [];
		let selectedOpenCodeModel = isOpenCode
			? this._findOpenCodeModel(model, runtimePreferences)
			: null;
		let openCodeReasoningOptions = selectedOpenCodeModel
			? this._openCodeReasoningOptionsForModel(selectedOpenCodeModel)
			: [];
		return {
			preset_id: String(preset?.preset_id || "default").trim() || "default",
			label: this._runtimePresetLabel(roleID, preset, apiConnections),
			short_label: String(preset?.label || "").trim() || (String(preset?.preset_id || "").trim() == "default" ? "Default" : "Preset"),
				runtime_type: runtimeType,
				connection_id: String(preset?.connection_id || "").trim(),
				connection_label: String(connection?.label || "").trim(),
				base_url: String(connection?.base_url || "").trim(),
				api_kind: apiKind,
				executor_id: String(preset?.executor_id || "").trim(),
				executor_label: String(executor?.label || "").trim(),
			model,
			model_label: model || String(executor?.label || "").trim() || this._runtimePresetLabel(roleID, preset, apiConnections),
			timeout_ms: Number(preset?.timeout_ms || 0) || 0,
			reasoning_effort: isOpenCode
				? (openCodeReasoningOptions.includes(this._normalizeOpenCodeVariantID(preset?.reasoning_effort ?? preset?.reasoningEffort))
					? this._normalizeOpenCodeVariantID(preset?.reasoning_effort ?? preset?.reasoningEffort)
					: "")
				: (this._runtimeRoleSupportsReasoning(roleID, runtimeType)
				? this._normalizeReasoningEffort(preset?.reasoning_effort ?? preset?.reasoningEffort, { allowCustom: true })
					: ""),
			context_window: Number(preset?.context_window || 0) || 0,
			max_output_tokens: Number(preset?.max_output_tokens || 0) || 0,
				state_mode: apiKind == "chat_completions"
					? "stateless"
					: this._normalizeRoleStateMode(roleID, preset?.state_mode, this._defaultRolePresetStateMode(roleID)),
			parallel_requests: this._normalizeParallelRequests(roleID, preset?.parallel_requests, 1),
			independent_resources: !!preset?.independent_resources,
			supports_reasoning: isOpenCode ? openCodeReasoningOptions.length > 0 : this._runtimePresetSupportsReasoning(roleID, preset),
			model_options: openCodeModels.map((entry) => this._openCodeModelOptionSummary(entry)).filter((entry) => entry.id),
			reasoning_options: isOpenCode ? openCodeReasoningOptions : [],
			safe_context_window: selectedOpenCodeModel ? Number(selectedOpenCodeModel.safe_context_window || 0) || 0 : 0,
			safe_max_output_tokens: selectedOpenCodeModel ? Number(selectedOpenCodeModel.safe_max_output_tokens || 0) || 0 : 0,
			supports_streaming: runtimeType == "local_exec" || ["local_api", "external_api"].includes(runtimeType),
			is_default: !!preset?.is_default || String(preset?.preset_id || "").trim() == "default",
		};
	},

	_listRuntimePresetOptions(roleID = "", config = null, options = {}) {
		let effectiveConfig = config || {};
		let apiConnections = effectiveConfig.apiConnections || [];
		let runtimeRoles = effectiveConfig.runtimeRoles || this._defaultRuntimeRoles();
		let runtimePreferences = effectiveConfig.runtimePreferences || this._defaultRuntimePreferences();
		let presetCatalog = this._rolePresetCatalog(
			roleID,
			runtimeRoles,
			apiConnections,
			options.legacyEndpoints || null
		);
		return presetCatalog.map((preset) => this._runtimePresetSummary(roleID, preset, apiConnections, runtimePreferences));
	},

	_runtimeSchedulerKey(roleID = "", preset = {}, connection = null, executor = null) {
		let runtimeType = String(preset?.runtime_type || "").trim();
		let model = String(preset?.model || "").trim();
		if (runtimeType == "local_exec") {
			return `exec:${String(executor?.id || preset?.executor_id || roleID || "local_exec").trim()}:${model || "default"}`;
		}
		let baseURL = this._normalizeURLValue(connection?.base_url || "");
		let identity = this._scanCandidateDedupKey({
			base_url: baseURL,
			api_kind: "responses",
		});
		return `${runtimeType || "api"}:${identity}:${model || roleID || "model"}`;
	},

	_defaultRuntimePreferences() {
		return {
			use_agent_model_for_data_extraction: true,
			saved_executor_ids: [],
			executor_model_cache: {},
		};
	},

	_normalizeOpenCodeVariantID(value = "") {
		let normalized = String(value || "").trim().toLowerCase();
		if (!normalized || normalized == "default") {
			return "";
		}
		return normalized;
	},

	_normalizeOpenCodeVariants(raw = null) {
		let values = [];
		if (Array.isArray(raw)) {
			values = raw;
		}
		else if (raw && typeof raw == "object") {
			values = Object.keys(raw);
		}
		return Array.from(new Set(
			values
				.map((value) => this._normalizeOpenCodeVariantID(value))
				.filter(Boolean)
		));
	},

	_normalizeOpenCodeModelEntry(raw = null, fallbackID = "") {
		let source = raw && typeof raw == "object" ? raw : {};
		let providerID = String(source.provider_id || source.providerID || "").trim();
		let modelID = String(source.model_id || source.modelID || source.id || "").trim();
		let fullID = String(source.full_id || source.fullID || source.model || source.model_id_full || "").trim();
		let fallback = String(fallbackID || "").trim();
		if (!fullID && fallback.includes("/")) {
			fullID = fallback;
		}
		if (!providerID && fullID.includes("/")) {
			providerID = fullID.split("/")[0] || "";
		}
		if (!modelID && fullID.includes("/")) {
			modelID = fullID.slice(fullID.indexOf("/") + 1);
		}
		if (!fullID && providerID && modelID) {
			fullID = `${providerID}/${modelID}`;
		}
		if (!fullID && modelID) {
			fullID = modelID;
		}
		if (!fullID) {
			return null;
		}
		let capabilitiesSource = source.capabilities && typeof source.capabilities == "object"
			? source.capabilities
			: {};
		let inputCapabilities = capabilitiesSource.input && typeof capabilitiesSource.input == "object"
			? capabilitiesSource.input
			: {};
		let limitSource = source.limit && typeof source.limit == "object"
			? source.limit
			: (source.limits && typeof source.limits == "object" ? source.limits : {});
		let contextLimit = Number(source.context_limit || source.contextLimit || limitSource.context || 0) || 0;
		let inputLimit = Number(source.input_limit || source.inputLimit || limitSource.input || 0) || 0;
		let outputLimit = Number(source.output_limit || source.outputLimit || limitSource.output || 0) || 0;
		let variants = this._normalizeOpenCodeVariants(
			source.variants !== undefined ? source.variants : source.reasoning_options
		);
		let safeContextBase = contextLimit || inputLimit || 0;
		return {
			id: fullID,
			label: String(source.label || source.name || fullID).trim() || fullID,
			provider_id: providerID,
			model_id: modelID || fullID,
			capabilities: {
				text: inputCapabilities.text !== false,
				vlm: !!(inputCapabilities.image || inputCapabilities.pdf || capabilitiesSource.vlm),
				embeddings: !!(capabilitiesSource.embeddings || inputCapabilities.embedding),
				reasoning: !!capabilitiesSource.reasoning,
				toolcall: !!capabilitiesSource.toolcall,
			},
			limit: {
				context: contextLimit,
				input: inputLimit,
				output: outputLimit,
			},
			safe_context_window: safeContextBase > 0 ? Math.floor(safeContextBase * 0.85) : 0,
			safe_max_output_tokens: outputLimit > 0 ? Math.floor(outputLimit * 0.85) : 0,
			variants,
			reasoning_options: variants,
		};
	},

	_normalizeOpenCodeModelCache(raw = null) {
		let source = raw && typeof raw == "object" ? raw : {};
		let seen = new Set();
		let models = [];
		for (let entry of Array.isArray(source.models) ? source.models : []) {
			let normalized = this._normalizeOpenCodeModelEntry(entry);
			if (!normalized || seen.has(normalized.id)) {
				continue;
			}
			seen.add(normalized.id);
			models.push(normalized);
		}
		models.sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
		return {
			scanned_at: String(source.scanned_at || source.scannedAt || "").trim(),
			error: String(source.error || "").trim(),
			models,
		};
	},

	_normalizeExecutorModelCache(raw = null) {
		let source = raw && typeof raw == "object" ? raw : {};
		let out = {};
		if (source.opencode !== undefined || source.OpenCode !== undefined) {
			out.opencode = this._normalizeOpenCodeModelCache(source.opencode || source.OpenCode);
		}
		return out;
	},

	_defaultExecutorCatalog() {
		let opencodePaths = [];
		let home = this._environmentValue("HOME") || this._environmentValue("USERPROFILE");
		if (home) {
			opencodePaths.push(this._joinPath(home, ".opencode", "bin", this._isWindowsPlatform() ? "opencode.exe" : "opencode"));
			opencodePaths.push(this._joinPath(home, ".opencode", "bin", this._isWindowsPlatform() ? "opencode.cmd" : "opencode"));
		}
		return [
			{
				id: "codex",
				label: "Codex CLI",
				command: "codex",
				absolute_paths: ["/Applications/Codex.app/Contents/Resources/codex"],
				args: ["exec", "--skip-git-repo-check"],
			},
			{
				id: "opencode",
				label: "OpenCode",
				command: "opencode",
				absolute_paths: opencodePaths,
				args: [],
			},
		];
	},

	_defaultAPIConnection(type = "local_api", index = 0) {
		let runtimeType = this._normalizeConnectionType(type);
		return {
			id: `endpoint-${index + 1}`,
			label: `Endpoint ${index + 1}`,
			runtime_type: runtimeType,
			base_url: "",
			api_kind: "responses",
			api_key: "",
			models_cache: [],
		};
	},

	_normalizeConnectionType(type) {
		let value = String(type || "").trim().toLowerCase();
		return value == "external_api" ? "external_api" : "local_api";
	},

	_connectionTypeFromURL(baseURL) {
		let parsed = this._parseEndpointURL(baseURL);
		let host = String(parsed?.host || "").toLowerCase();
		return ["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(host)
			? "local_api"
			: "external_api";
	},

	_parseOllamaParameterTextValue(parametersText = "", name = "") {
		let key = String(name || "").trim();
		if (!key) {
			return 0;
		}
		let match = String(parametersText || "").match(new RegExp(`(?:^|\\n)\\s*${key}\\s+(\\d+)`, "i"));
		return Number(match?.[1] || 0) || 0;
	},

	_ollamaModelInfoContextLength(modelInfo = {}) {
		let info = modelInfo && typeof modelInfo == "object" ? modelInfo : {};
		for (let [key, value] of Object.entries(info)) {
			if (String(key || "").toLowerCase().endsWith(".context_length")) {
				let numeric = Number(value || 0) || 0;
				if (numeric > 0) {
					return numeric;
				}
			}
		}
		return 0;
	},

	_normalizeDiscoveredModelEntry(raw) {
		if (!raw || typeof raw != "object") {
			return null;
		}
		let id = String(raw.id || raw.model || raw.name || "").trim();
		if (!id) {
			return null;
		}
		let capabilities = this._discoveredModelCapabilities(raw, id);
		let loadedInstances = Array.isArray(raw.loaded_instances)
			? raw.loaded_instances
				.map((entry) => ({
					id: String(entry?.id || "").trim(),
					context_length: Number(entry?.config?.context_length || 0) || 0,
					eval_batch_size: Number(entry?.config?.eval_batch_size || 0) || 0,
					parallel: Number(entry?.config?.parallel || 0) || 0,
					num_experts: Number(entry?.config?.num_experts || 0) || 0,
					flash_attention: !!entry?.config?.flash_attention,
					offload_kv_cache_to_gpu: !!entry?.config?.offload_kv_cache_to_gpu,
				}))
				.filter((entry) => entry.id)
			: [];
		return {
			id,
			label: String(raw.display_name || raw.name || id).trim() || id,
			type: String(raw.type || "").trim().toLowerCase(),
			publisher: String(raw.publisher || raw.owned_by || raw.ownedBy || "").trim(),
			owned_by: String(raw.owned_by || raw.ownedBy || "").trim(),
			engine: String(raw.compatibility_type || raw.format || raw.details?.format || "").trim().toLowerCase(),
			format: String(raw.format || raw.compatibility_type || raw.details?.format || "").trim().toLowerCase(),
			params_string: String(raw.params_string || raw.paramsString || raw.details?.parameter_size || "").trim(),
			quantization_name: String(raw.quantization?.name || raw.quantization || raw.details?.quantization_level || "").trim(),
			loaded:
				String(raw.state || "").trim().toLowerCase() == "loaded" ||
				(Array.isArray(raw.loaded_instances) && raw.loaded_instances.length > 0),
			loaded_context_length:
				Number(raw.loaded_context_length || raw.loaded_instances?.[0]?.config?.context_length || 0) || 0,
			default_context_length:
				Number(raw.default_context_length || 0) ||
				this._parseOllamaParameterTextValue(raw.parameters || "", "num_ctx") ||
				0,
			max_context_length:
				Number(raw.max_context_length || 0) ||
				this._ollamaModelInfoContextLength(raw.model_info || {}) ||
				0,
			current_load: loadedInstances[0] || null,
			loaded_instances: loadedInstances,
			parent_model: String(raw.parent_model || raw.details?.parent_model || "").trim(),
			size_bytes: Number(raw.size || 0) || 0,
			capabilities: {
				text: !!capabilities.text,
				vlm: !!capabilities.vlm,
				embeddings: !!capabilities.embeddings,
			},
		};
	},

	_normalizeAPIConnection(raw, fallbackType = "local_api", index = 0) {
		let defaults = this._defaultAPIConnection(fallbackType, index);
		let merged = Object.assign({}, defaults, raw || {});
		let baseURL = String(merged.base_url || merged.baseUrl || "").trim().replace(/\/+$/, "");
		let runtimeType = baseURL
			? this._connectionTypeFromURL(baseURL)
			: this._normalizeConnectionType(
				merged.runtime_type || merged.type || fallbackType || defaults.runtime_type
			);
		let modelsCache = Array.isArray(merged.models_cache)
			? merged.models_cache
				.map((entry) => this._normalizeDiscoveredModelEntry(entry))
				.filter(Boolean)
			: [];
		return {
			id: String(merged.id || defaults.id).trim() || defaults.id,
			label: String(merged.label || "").trim() || defaults.label,
			runtime_type: runtimeType,
			base_url: baseURL,
			api_kind: "responses",
			api_key: this._decodeStoredSecret(String(merged.api_key || merged.apiKey || "").trim()),
			models_cache: modelsCache,
		};
	},

	_findConnectionByID(connections, connectionID) {
		let id = String(connectionID || "").trim();
		if (!id) {
			return null;
		}
		for (let connection of connections || []) {
			let aliases = Array.isArray(connection?.alias_ids) ? connection.alias_ids.map((entry) => String(entry || "").trim()) : [];
			if (String(connection?.id || "").trim() == id || aliases.includes(id)) {
				return connection;
			}
		}
		return null;
	},

	_findConnectionForEndpoint(connections, endpointConfig) {
		let normalized = this._normalizeAIEndpointConfig("chat", endpointConfig || {});
		if (!normalized.base_url) {
			return null;
		}
		let normalizedBaseKey = this._scanCandidateDedupKey({
			base_url: normalized.base_url,
			api_kind: "responses",
		});
		let normalizedAPIKey = String(normalized.api_key || "").trim();
		for (let connection of connections || []) {
			if (
				this._scanCandidateDedupKey({
					base_url: connection?.base_url || "",
					api_kind: "responses",
				}) == normalizedBaseKey &&
				String(connection?.api_key || "").trim() == normalizedAPIKey
			) {
				return connection;
			}
		}
		return null;
	},

	_deriveLegacyConnectionsFromEndpoints(endpoints) {
		let out = [];
		let seen = new Set();
		for (let kind of ["chat", "extraction", "vlm", "embeddings"]) {
			let config = this._normalizeAIEndpointConfig(kind, endpoints?.[kind] || {});
			if (!config.base_url) {
				continue;
			}
			let runtimeType = this._connectionTypeFromURL(config.base_url);
			let key = `${config.base_url.replace(/\/+$/, "")}::${config.api_key || ""}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			let defaultConnection = this._defaultAPIConnection(runtimeType, out.length);
			out.push(this._normalizeAPIConnection({
				id: defaultConnection.id,
				label: this._deriveProviderNameFromURL(config.base_url),
				runtime_type: runtimeType,
				base_url: config.base_url,
				api_kind: config.api_kind || "auto",
				api_key: config.api_key || "",
			}, runtimeType, out.length));
		}
		return out;
	},

	_normalizeAPIConnections(raw, legacyEndpoints = null) {
		let source = Array.isArray(raw) ? raw : null;
		let connections = source
			? source.map((entry, index) => this._normalizeAPIConnection(entry, entry?.runtime_type || "local_api", index))
			: this._deriveLegacyConnectionsFromEndpoints(legacyEndpoints);
		let seen = new Set();
		let deduped = [];
		for (let index = 0; index < connections.length; index += 1) {
			let connection = this._normalizeAPIConnection(connections[index], connections[index]?.runtime_type || "local_api", index);
			if (!connection.base_url) {
				continue;
			}
			let identityKey = this._scanCandidateDedupKey(connection);
			let key = `${identityKey}::${connection.api_key || ""}`;
			if (seen.has(key)) {
				let kept = deduped.find((entry) => `${this._scanCandidateDedupKey(entry)}::${entry.api_key || ""}` == key) || null;
				if (kept && connection.id && connection.id != kept.id) {
					kept.alias_ids = Array.isArray(kept.alias_ids) ? kept.alias_ids : [];
					if (!kept.alias_ids.includes(connection.id)) {
						kept.alias_ids.push(connection.id);
					}
				}
				continue;
			}
			seen.add(key);
			deduped.push(connection);
		}
		return deduped;
	},

	_normalizeRuntimeTypeForRole(roleID, runtimeType) {
		let value = String(runtimeType || "").trim();
		let allowed = ["session_chat", "data_extraction"].includes(roleID)
			? ["local_api", "external_api", "local_exec", "external_agent"]
			: ["local_api", "external_api"];
		return allowed.includes(value) ? value : this._defaultRuntimeRole(roleID).runtime_type;
	},

	_normalizeRuntimeRole(roleID, raw, apiConnections, legacyEndpoints = null) {
		let defaults = this._defaultRuntimeRole(roleID);
		let kind =
			roleID == "session_chat"
				? "chat"
				: roleID == "data_extraction"
					? "extraction"
					: roleID == "pdf_vlm"
						? "vlm"
						: "embeddings";
		let legacy = this._normalizeAIEndpointConfig(kind, legacyEndpoints?.[kind] || {});
		let legacyConnection = this._findConnectionForEndpoint(apiConnections, legacy);
		let fallback = legacy.base_url
			? {
				runtime_type: legacyConnection?.runtime_type || this._connectionTypeFromURL(legacy.base_url),
				connection_id: legacyConnection?.id || "",
				model: legacy.model || "",
				api_kind: "responses",
				timeout_ms: legacy.timeout_ms || defaults.timeout_ms,
			}
			: {};
		let merged = Object.assign({}, defaults, fallback, raw || {});
		let runtimeType = this._normalizeRuntimeTypeForRole(
			roleID,
			merged.runtime_type || merged.runtimeType || defaults.runtime_type
		);
		let requestedConnectionID = String(merged.connection_id || merged.connectionID || "").trim();
		let requestedModel = String(merged.model || merged.custom_model || merged.customModel || "").trim();
		let shouldInferConnection = !!requestedConnectionID || !!requestedModel || !!String(fallback.connection_id || "").trim();
		let resolvedConnection = ["local_api", "external_api"].includes(runtimeType)
			? this._findConnectionByID(apiConnections, requestedConnectionID) ||
				this._findConnectionByID(apiConnections, fallback.connection_id || "") ||
				(shouldInferConnection && apiConnections.length == 1 ? apiConnections[0] : null)
			: null;
		let contextWindow = roleID == "embeddings"
			? 0
			: this._normalizePositiveInteger(
				merged.context_window ??
				merged.contextWindow ??
				merged.lmstudio_context_length ??
				merged.lmStudioContextLength ??
				merged.context_tokens ??
				merged.contextTokens,
				defaults.context_window || 0
			);
		let executorID = String(merged.executor_id || merged.executorID || "").trim();
		return {
			runtime_type: runtimeType,
			connection_id: ["local_api", "external_api"].includes(runtimeType)
				? String(resolvedConnection?.id || "").trim()
				: requestedConnectionID,
			model: requestedModel,
			api_kind: this._normalizeRuntimeRoleAPIKind(
				roleID,
				runtimeType,
				merged.api_kind ?? merged.apiKind ?? defaults.api_kind
			),
			timeout_ms: this._normalizeEndpointTimeout(merged.timeout_ms, defaults.timeout_ms),
			reasoning_effort: this._runtimeRoleSupportsOpenCodeReasoning(roleID, runtimeType, executorID)
				? this._normalizeOpenCodeVariantID(merged.reasoning_effort ?? merged.reasoningEffort)
				: this._runtimeRoleSupportsReasoning(roleID, runtimeType)
				? this._normalizeReasoningEffort(merged.reasoning_effort ?? merged.reasoningEffort, { allowCustom: true })
				: "",
			executor_id: executorID,
			agent_runtime_id: String(merged.agent_runtime_id || merged.agentRuntimeID || defaults.agent_runtime_id || "").trim(),
			context_window: contextWindow,
			max_output_tokens: roleID == "embeddings"
				? 0
				: this._normalizePositiveInteger(
					merged.max_output_tokens ?? merged.maxOutputTokens,
					defaults.max_output_tokens || 10000
				),
			embeddings_batch_size: roleID == "embeddings"
				? this._normalizePositiveInteger(
					merged.embeddings_batch_size ?? merged.embeddingsBatchSize,
					defaults.embeddings_batch_size || 32
				)
				: 0,
			parallel_requests: this._normalizeParallelRequests(
				roleID,
				merged.parallel_requests ?? merged.parallelRequests,
				defaults.parallel_requests || 1
			),
			independent_resources: this._normalizeBoolean(
				merged.independent_resources ?? merged.independentResources,
				defaults.independent_resources
			),
			state_mode: runtimeType == "local_exec"
				? "stateless"
				: this._normalizeRoleStateMode(
					roleID,
					merged.state_mode ?? merged.stateMode,
					defaults.state_mode
				),
			model_presets: this._normalizeRuntimeModelPresets(
				roleID,
				merged.model_presets ?? merged.modelPresets,
				apiConnections
			),
		};
	},

	_normalizeRuntimeRoles(raw, apiConnections, legacyEndpoints = null) {
		let source = raw && typeof raw == "object" ? raw : {};
		return {
			session_chat: this._normalizeRuntimeRole("session_chat", source.session_chat, apiConnections, legacyEndpoints),
			data_extraction: this._normalizeRuntimeRole("data_extraction", source.data_extraction, apiConnections, legacyEndpoints),
			pdf_vlm: this._normalizeRuntimeRole("pdf_vlm", source.pdf_vlm, apiConnections, legacyEndpoints),
			embeddings: this._normalizeRuntimeRole("embeddings", source.embeddings, apiConnections, legacyEndpoints),
		};
	},

	_materializeEndpointFromRole(kind, role, connection) {
		let empty = this._defaultAIEndpointConfig(kind);
		if (!role || !connection) {
			return empty;
		}
		if (!["local_api", "external_api"].includes(role.runtime_type)) {
			return empty;
		}
		if (!connection.base_url || !role.model) {
			return empty;
		}
		return this._normalizeAIEndpointConfig(kind, {
			base_url: connection.base_url,
			model: role.model,
			api_kind: this._normalizeRuntimeRoleAPIKind(kind == "chat" ? "session_chat" : kind == "extraction" ? "data_extraction" : kind == "vlm" ? "pdf_vlm" : "embeddings", role.runtime_type, role.api_kind),
			api_key: connection.api_key || "",
			timeout_ms: role.timeout_ms || 120000,
		});
	},

	_materializeAIEndpointsFromRuntimeRoles(apiConnections, runtimeRoles, legacyEndpoints = null, runtimePreferences = null) {
		let normalizedRoles = this._normalizeRuntimeRoles(runtimeRoles, apiConnections, legacyEndpoints);
		let preferences = this._normalizeRuntimePreferences(runtimePreferences);
		return {
			chat: this._materializeEndpointFromRole(
				"chat",
				normalizedRoles.session_chat,
				this._findConnectionByID(apiConnections, normalizedRoles.session_chat.connection_id)
			),
			extraction: this._materializeEndpointFromRole(
				"extraction",
				preferences.use_agent_model_for_data_extraction ? normalizedRoles.session_chat : normalizedRoles.data_extraction,
				this._findConnectionByID(
					apiConnections,
					preferences.use_agent_model_for_data_extraction
						? normalizedRoles.session_chat.connection_id
						: normalizedRoles.data_extraction.connection_id
				)
			),
			vlm: this._materializeEndpointFromRole(
				"vlm",
				normalizedRoles.pdf_vlm,
				this._findConnectionByID(apiConnections, normalizedRoles.pdf_vlm.connection_id)
			),
			embeddings: this._materializeEndpointFromRole(
				"embeddings",
				normalizedRoles.embeddings,
				this._findConnectionByID(apiConnections, normalizedRoles.embeddings.connection_id)
			),
		};
	},

	_defaultAIEndpointConfig(kind = "chat") {
		let legacy = this._defaultOpenAICompatibleConfig();
		return Object.assign({}, legacy, {
			model: kind == "embeddings" ? "" : legacy.model,
		});
	},

	_defaultAIEndpointSettings() {
		return {
			chat: this._defaultAIEndpointConfig("chat"),
			extraction: this._defaultAIEndpointConfig("extraction"),
			vlm: this._defaultAIEndpointConfig("vlm"),
			embeddings: this._defaultAIEndpointConfig("embeddings"),
		};
	},

	_defaultPdfMarkdownRuntimeSettings() {
		return {
			mode: "fast",
			n_predict: 5000,
			n_ctx: 32768,
			n_batch: 2048,
			n_ubatch: 2048,
			n_parallel: 4,
			n_threads: 8,
			n_threads_batch: 8,
			scale: 2.0,
			oversample: 1.5,
			max_retries: 2,
			pdf_prompt: SystematicReviewerPDFMarkdown.DEFAULT_VLM_PROMPT,
			image_prompt: SystematicReviewerPDFMarkdown.DEFAULT_IMAGE_VLM_PROMPT,
		};
	},

	_normalizePdfMarkdownMode(value) {
		let mode = String(value || "").trim();
		return ["fast", "vlm", "fast_with_vlm_fallback"].includes(mode)
			? mode
			: "fast";
	},

	_defaultEditorSettings() {
		return SystematicReviewerNativeMarkdown.normalizeSettings({
			pageViewScale: 1,
				citationStyleID: "http://www.zotero.org/styles/apa",
				citationLocale: Zotero.Prefs.get("export.lastLocale") || "",
				printPageNumbers: true,
				preview_page_theme: "light",
			});
		},

	_normalizeEndpointTimeout(value, fallback = 120000) {
		let timeout = Math.round(Number(value));
		return Number.isFinite(timeout) && timeout >= 1000 ? timeout : fallback;
	},

	_normalizePositiveInteger(value, fallback = 0) {
		let next = Math.round(Number(value));
		return Number.isFinite(next) && next > 0 ? next : fallback;
	},

	_normalizeNonNegativeInteger(value, fallback = 0) {
		let next = Math.round(Number(value));
		return Number.isFinite(next) && next >= 0 ? next : fallback;
	},

	_normalizeBoolean(value, fallback = false) {
		return value === undefined || value === null ? !!fallback : !!value;
	},

	_normalizeAIEndpointConfig(kind, raw, fallback = null) {
		let defaults = this._defaultAIEndpointConfig(kind);
		let merged = Object.assign({}, defaults, fallback || {}, raw || {});
		let apiKind = String(merged.api_kind || merged.apiKind || "auto").trim() || "auto";
		if (!["auto", "responses", "chat_completions"].includes(apiKind)) {
			apiKind = "auto";
		}
		return {
			base_url: String(merged.base_url || merged.baseUrl || "").trim(),
			model: String(merged.model || "").trim(),
			api_kind: apiKind,
			api_key: this._decodeStoredSecret(String(merged.api_key || merged.apiKey || "").trim()),
			timeout_ms: this._normalizeEndpointTimeout(
				merged.timeout_ms !== undefined ? merged.timeout_ms : merged.timeoutMs,
				defaults.timeout_ms
			),
		};
	},

	_normalizeAIEndpointSettings(raw, legacySource = null) {
		let defaults = this._defaultAIEndpointSettings();
		let legacy = this._normalizeAIEndpointConfig("chat", legacySource || {}, defaults.chat);
		let source = raw && typeof raw == "object" ? raw : {};
		return {
			chat: this._normalizeAIEndpointConfig("chat", source.chat || source.text || source.responses || legacy, legacy),
			extraction: this._normalizeAIEndpointConfig("extraction", source.extraction || source.data_extraction || legacy, legacy),
			vlm: this._normalizeAIEndpointConfig("vlm", source.vlm || source.vision || legacy, legacy),
			embeddings: this._normalizeAIEndpointConfig("embeddings", source.embeddings || legacy, legacy),
		};
	},

	_normalizeRuntimePreferences(raw) {
		let defaults = this._defaultRuntimePreferences();
		let source = raw && typeof raw == "object" ? raw : {};
		return {
			use_agent_model_for_data_extraction: this._normalizeBoolean(
				source.use_agent_model_for_data_extraction,
				defaults.use_agent_model_for_data_extraction
			),
			saved_executor_ids: Array.isArray(source.saved_executor_ids)
				? Array.from(new Set(source.saved_executor_ids.map((value) => String(value || "").trim()).filter(Boolean)))
				: [],
			executor_model_cache: this._normalizeExecutorModelCache(source.executor_model_cache || {}),
		};
	},

	_normalizePdfMarkdownSettings(raw) {
		let normalized = Object.assign(
			{},
			this._defaultPdfMarkdownRuntimeSettings(),
			raw || {}
		);
		normalized.mode = this._normalizePdfMarkdownMode(normalized.mode);
		return normalized;
	},

		_normalizePreviewEditorPageTheme(value) {
			return String(value || "").trim().toLowerCase() == "dark" ? "dark" : "light";
		},

		_normalizeEditorSettings(raw) {
			let source = raw && typeof raw == "object" ? raw : {};
			let normalized = SystematicReviewerNativeMarkdown.normalizeSettings(
				Object.assign({}, this._defaultEditorSettings(), source)
			);
			normalized.preview_page_theme = this._normalizePreviewEditorPageTheme(
				source.preview_page_theme !== undefined
					? source.preview_page_theme
					: (source.previewPageTheme !== undefined ? source.previewPageTheme : normalized.preview_page_theme)
			);
			return normalized;
		},

		_previewEditorPageTheme(settings = null) {
			let effective = settings
				? this._normalizeGlobalSettings(settings)
				: this._globalSettingsSync();
			return this._normalizePreviewEditorPageTheme(effective?.editor?.preview_page_theme);
		},

	_normalizeServerSecuritySettings(raw) {
		let merged = Object.assign({}, this._defaultServerSecuritySettings(), raw || {});
		return {
			mcp_enabled: merged.mcp_enabled === true,
			mcp_api_key: this._decodeStoredSecret(String(merged.mcp_api_key || "").trim()),
		};
	},

	_normalizePrivilegedToolTimeout(value, fallback = 300000) {
		let next = Math.round(Number(value || 0) || 0);
		let defaultValue = Math.max(1000, Math.min(3600000, Math.round(Number(fallback || 300000) || 300000)));
		if (!Number.isFinite(next) || next <= 0) {
			return defaultValue;
		}
		return Math.max(1000, Math.min(3600000, next));
	},

	_normalizePrivilegedToolSettings(raw) {
		let defaults = this._defaultPrivilegedToolSettings();
		let merged = Object.assign({}, defaults, raw || {});
		return {
			shell_enabled: merged.shell_enabled === true,
			browser_enabled: merged.browser_enabled === true,
			default_timeout_ms: this._normalizePrivilegedToolTimeout(
				merged.default_timeout_ms !== undefined ? merged.default_timeout_ms : merged.defaultTimeoutMs,
				defaults.default_timeout_ms
			),
			dev_tools_enabled: merged.dev_tools_enabled === true,
		};
	},

	_normalizeMCPClientID(value = "", fallback = "mcp_server") {
		let raw = String(value || fallback || "mcp_server").trim();
		let normalized = raw
			.toLowerCase()
			.replace(/[^a-z0-9_.-]+/g, "_")
			.replace(/^_+|_+$/g, "");
		return normalized || fallback || "mcp_server";
	},

	_normalizeMCPClientPairArray(value = [], keyName = "key", valueName = "value") {
		let source = Array.isArray(value) ? value : [];
		let out = [];
		for (let entry of source) {
			let key = String(entry?.[keyName] || entry?.key || "").trim();
			if (!key) {
				continue;
			}
			out.push(Object.assign({}, entry || {}, {
				[keyName]: key,
				[valueName]: String(entry?.[valueName] || entry?.value || "").trim(),
			}));
		}
		return out;
	},

	_normalizeMCPClientStringArray(value = []) {
		let source = Array.isArray(value) ? value : [];
		return source.map((entry) => String(entry || "").trim()).filter(Boolean);
	},

	_normalizeMCPClientServer(raw = {}, index = 0) {
		if (!raw || typeof raw != "object") {
			return null;
		}
		let source = Object.assign({}, raw || {});
		let stdio = source.stdio && typeof source.stdio == "object" ? source.stdio : {};
		let http = source.streamable_http && typeof source.streamable_http == "object" ? source.streamable_http : {};
		let label = String(source.label || source.name || source.server_id || `MCP Server ${index + 1}`).trim();
		let serverID = this._normalizeMCPClientID(source.server_id || source.id || label || `mcp_server_${index + 1}`, `mcp_server_${index + 1}`);
		let transport = String(source.transport || "stdio").trim().toLowerCase();
		if (!["stdio", "streamable_http"].includes(transport)) {
			transport = "stdio";
		}
		let cwdMode = String(source.cwd_mode || stdio.cwd_mode || "project_root").trim();
		if (!["project_root", "custom", "process"].includes(cwdMode)) {
			cwdMode = "project_root";
		}
		return {
			enabled: source.enabled === true,
			server_id: serverID,
			label: label || serverID,
			transport,
			request_timeout_ms: this._normalizePrivilegedToolTimeout(
				source.request_timeout_ms !== undefined ? source.request_timeout_ms : source.requestTimeoutMs,
				120000
			),
			startup_timeout_ms: this._normalizePrivilegedToolTimeout(
				source.startup_timeout_ms !== undefined ? source.startup_timeout_ms : source.startupTimeoutMs,
				30000
			),
			command: String(source.command || stdio.command || "").trim(),
			args: this._normalizeMCPClientStringArray(source.args || source.arguments || stdio.args || stdio.arguments || []),
			cwd_mode: cwdMode,
			cwd: String(source.cwd || stdio.cwd || "").trim(),
			env: this._normalizeMCPClientPairArray(source.env || stdio.env || [], "key", "value"),
			env_passthrough: this._normalizeMCPClientStringArray(source.env_passthrough || source.envPassthrough || stdio.env_passthrough || stdio.envPassthrough || []),
			url: String(source.url || http.url || "").trim(),
			bearer_token_env: String(source.bearer_token_env || source.bearerTokenEnv || http.bearer_token_env || http.bearerTokenEnv || "").trim(),
			headers: this._normalizeMCPClientPairArray(source.headers || http.headers || [], "key", "value"),
			headers_from_env: this._normalizeMCPClientPairArray(source.headers_from_env || source.headersFromEnv || http.headers_from_env || http.headersFromEnv || [], "key", "env"),
		};
	},

	_normalizeMCPClientSettings(raw) {
		let source = raw && typeof raw == "object" ? raw : {};
		let servers = Array.isArray(source.servers)
			? source.servers
			: (Array.isArray(raw) ? raw : []);
		let seen = new Set();
		let normalized = [];
		for (let index = 0; index < servers.length; index += 1) {
			let server = this._normalizeMCPClientServer(servers[index], index);
			if (!server) {
				continue;
			}
			let baseID = server.server_id;
			let nextID = baseID;
			let suffix = 2;
			while (seen.has(nextID)) {
				nextID = `${baseID}_${suffix}`;
				suffix += 1;
			}
			server.server_id = nextID;
			seen.add(nextID);
			normalized.push(server);
		}
		return {
			servers: normalized,
		};
	},

	_normalizeGlobalSettings(raw) {
		let base = raw && typeof raw == "object" ? raw : {};
		let legacyEndpoints = this._normalizeAIEndpointSettings(
			base.ai_endpoints || base.model_endpoints || base.endpoints || null,
			base.openai_compatible || null
		);
		if (Number(base.version || 0) < 3) {
			legacyEndpoints = this._clearLegacyAutoEndpointSettings(legacyEndpoints);
		}
		let apiConnections = this._normalizeAPIConnections(base.api_connections || null, legacyEndpoints);
		let runtimeRoles = this._normalizeRuntimeRoles(base.runtime_roles || null, apiConnections, legacyEndpoints);
		let runtimePreferences = this._normalizeRuntimePreferences(base.runtime_preferences || null);
		let serverSecurity = this._normalizeServerSecuritySettings(base.server_security || null);
		let privilegedSource = Object.assign({}, base.privileged_tools || null);
		if (privilegedSource.dev_tools_enabled === undefined && base?.server_security?.dev_server_enabled === true) {
			privilegedSource.dev_tools_enabled = true;
		}
		let privilegedTools = this._normalizePrivilegedToolSettings(privilegedSource);
		let mcpClients = this._normalizeMCPClientSettings(base.mcp_clients || null);
		let aiEndpoints = this._materializeAIEndpointsFromRuntimeRoles(apiConnections, runtimeRoles, legacyEndpoints, runtimePreferences);
		return Object.assign({}, base, {
			kind: "systematic-reviewer-global-settings",
			version: 10,
			namespace: this.namespace,
			storage_root: this._storageRoot(),
			projects_root: this._projectsRoot(),
			api_connections: apiConnections,
			runtime_roles: runtimeRoles,
			runtime_preferences: runtimePreferences,
			server_security: serverSecurity,
			privileged_tools: privilegedTools,
			mcp_clients: mcpClients,
			ai_endpoints: aiEndpoints,
			openai_compatible: Object.assign({}, aiEndpoints.chat),
			agent_runtime_catalog: this._defaultAgentRuntimeCatalog(),
			agent_execution_catalog: this._defaultAgentExecutionCatalog(),
			pdf_markdown: this._normalizePdfMarkdownSettings(base.pdf_markdown),
			editor: this._normalizeEditorSettings(base.editor),
			openalex_api_key: this._decodeStoredSecret(String(base.openalex_api_key || "").trim()),
		});
	},

	_clearLegacyAutoEndpointSettings(aiEndpoints) {
		let cleared = {};
		for (let kind of ["chat", "extraction", "vlm", "embeddings"]) {
			let config = this._normalizeAIEndpointConfig(kind, aiEndpoints?.[kind] || {});
			cleared[kind] = this._looksLikeLegacyAutoEndpointConfig(config)
				? this._defaultAIEndpointConfig(kind)
				: config;
		}
		return cleared;
	},

	_looksLikeLegacyAutoEndpointConfig(config) {
		let normalized = this._normalizeAIEndpointConfig("chat", config || {});
		return (
			normalized.base_url == "http://127.0.0.1:1234/v1" &&
			normalized.model == "qwen3.5-2b" &&
			normalized.api_kind == "auto" &&
			!normalized.api_key
		);
	},

	_validateAIEndpointSettings(endpoints) {
		for (let kind of ["chat", "extraction", "vlm", "embeddings"]) {
			let config = this._normalizeAIEndpointConfig(kind, endpoints?.[kind] || {});
			let hasBase = !!config.base_url;
			let hasModel = !!config.model;
			if (hasBase !== hasModel) {
				throw new Error(`${kind} endpoint must include both a base URL and a model, or leave both blank.`);
			}
			if (!hasBase) {
				continue;
			}
			try {
				let url = new URL(config.base_url);
				if (!["http:", "https:"].includes(url.protocol)) {
					throw new Error("unsupported protocol");
				}
			}
			catch (_err) {
				throw new Error(`${kind} endpoint base URL is invalid: ${config.base_url}`);
			}
		}
	},

	_validateRuntimeRoles(runtimeRoles, apiConnections, runtimePreferences = null, pdfMarkdown = null) {
		let preferences = this._normalizeRuntimePreferences(runtimePreferences);
		let labels = {
			session_chat: "Session / Chat",
			data_extraction: "Data Extraction",
			pdf_vlm: "PDF / Conversion",
			embeddings: "Embeddings",
		};
		let validateResolved = (roleID, role, label) => {
			if (["local_api", "external_api"].includes(role.runtime_type)) {
				let hasConnection = !!role.connection_id;
				let hasModel = !!role.model;
				if (hasConnection !== hasModel) {
					throw new Error(`${label} must include both a connection and a model, or leave both blank.`);
				}
				if (!hasConnection) {
					return;
				}
				let connection = this._findConnectionByID(apiConnections, role.connection_id);
				if (!connection) {
					throw new Error(`${label} references a missing API connection.`);
				}
				if (connection.runtime_type != role.runtime_type) {
					throw new Error(`${label} must use a ${role.runtime_type == "external_api" ? "external" : "local"} API connection.`);
				}
				return;
			}
			if (role.runtime_type == "local_exec" && !role.executor_id) {
				throw new Error(`${label} is set to Local Exec but no executor is selected.`);
			}
			if (role.runtime_type == "external_agent" && !role.agent_runtime_id) {
				throw new Error(`${label} is set to External Agent but no agent runtime is selected.`);
			}
		};
		for (let roleID of ["session_chat", "data_extraction", "pdf_vlm", "embeddings"]) {
			if (roleID == "data_extraction" && preferences.use_agent_model_for_data_extraction) {
				continue;
			}
			if (roleID == "pdf_vlm" && !this._pdfModeNeedsVisionModel(pdfMarkdown)) {
				continue;
			}
			let role = this._normalizeRuntimeRole(roleID, runtimeRoles?.[roleID] || {}, apiConnections || [], null);
			let label = labels[roleID] || roleID;
			validateResolved(roleID, role, label);
			if (this._roleSupportsPresetCatalog(roleID)) {
				let presets = this._normalizeRuntimeModelPresets(roleID, role.model_presets || [], apiConnections || []);
				for (let index = 0; index < presets.length; index += 1) {
					validateResolved(roleID, Object.assign({}, role, presets[index]), `${label} preset ${index + 1}`);
				}
			}
		}
	},

	_validateRuntimeRoleModelCapabilities(runtimeRoles, apiConnections, runtimePreferences = null, pdfMarkdown = null) {
		let preferences = this._normalizeRuntimePreferences(runtimePreferences);
		let labels = {
			session_chat: "Agent Model",
			data_extraction: "Data Extraction",
			pdf_vlm: "PDF / Vision Engine",
			embeddings: "Embeddings Engine",
		};
		let validateResolved = (roleID, role, label) => {
			if (!["local_api", "external_api"].includes(role.runtime_type) || !role.connection_id || !role.model) {
				return;
			}
			let connection = this._findConnectionByID(apiConnections, role.connection_id);
			if (!connection) {
				return;
			}
			let models = Array.isArray(connection.models_cache)
				? connection.models_cache
					.map((entry) => this._normalizeDiscoveredModelEntry(entry))
					.filter(Boolean)
				: [];
			if (!models.length) {
				return;
			}
				let model = models.find((entry) => String(entry?.id || "") == String(role.model || ""));
				if (!model) {
					return;
				}
				if (!this._roleSupportsDiscoveredModel(roleID, model)) {
					if (roleID == "pdf_vlm") {
						return;
					}
					if (roleID == "embeddings") {
						throw new Error(`${label} requires an embedding model.`);
					}
				throw new Error(`${label} requires a text-capable or vision-capable model.`);
			}
		};
		for (let roleID of ["session_chat", "data_extraction", "pdf_vlm", "embeddings"]) {
			if (roleID == "data_extraction" && preferences.use_agent_model_for_data_extraction) {
				continue;
			}
			if (roleID == "pdf_vlm" && !this._pdfModeNeedsVisionModel(pdfMarkdown)) {
				continue;
			}
			let role = this._normalizeRuntimeRole(roleID, runtimeRoles?.[roleID] || {}, apiConnections || [], null);
			validateResolved(roleID, role, labels[roleID] || roleID);
			if (this._roleSupportsPresetCatalog(roleID)) {
				let presets = this._normalizeRuntimeModelPresets(roleID, role.model_presets || [], apiConnections || []);
				for (let index = 0; index < presets.length; index += 1) {
					validateResolved(roleID, Object.assign({}, role, presets[index]), `${labels[roleID] || roleID} preset ${index + 1}`);
				}
			}
		}
	},

	_validateRuntimeRoleRequestPayload(runtimeRoles) {
		if (!runtimeRoles || typeof runtimeRoles != "object") {
			return;
		}
		let allowed = {
			session_chat: new Set(["local_api", "external_api", "local_exec", "external_agent"]),
			data_extraction: new Set(["local_api", "external_api", "local_exec", "external_agent"]),
			pdf_vlm: new Set(["local_api", "external_api"]),
			embeddings: new Set(["local_api", "external_api"]),
		};
		let labels = {
			session_chat: "Main Engine",
			data_extraction: "Data Extraction Engine",
			pdf_vlm: "PDF / Vision Engine",
			embeddings: "Embeddings Engine",
		};
		for (let [roleID, rule] of Object.entries(allowed)) {
			let requested = runtimeRoles?.[roleID];
			if (!requested || typeof requested != "object") {
				continue;
			}
			if (!Object.prototype.hasOwnProperty.call(requested, "runtime_type")) {
				continue;
			}
			let value = String(requested.runtime_type || "").trim();
			if (value && !rule.has(value)) {
				throw new Error(`${labels[roleID] || roleID} does not support ${value}.`);
			}
		}
	},

	_pdfModeNeedsVisionModel(pdfMarkdown = null) {
		let mode = String(pdfMarkdown?.mode || "").trim();
		return mode != "fast";
	},

	_roleSupportsDiscoveredModel(roleID, model) {
		let capabilities = model?.capabilities || {};
		if (roleID == "session_chat" || roleID == "data_extraction") {
			return !!capabilities.text || !!capabilities.vlm;
		}
		if (roleID == "pdf_vlm") {
			return true;
		}
		if (roleID == "embeddings") {
			return !!capabilities.embeddings;
		}
		return false;
	},

	async _refreshLocalConnectionModelCaches(apiConnections) {
		let normalized = (apiConnections || []).map((connection, index) =>
			this._normalizeAPIConnection(connection, connection?.runtime_type || "local_api", index)
		);
		let scannable = normalized.filter((connection) => {
			if (!["local_api", "external_api"].includes(connection.runtime_type) || !connection.base_url) {
				return false;
			}
			return true;
		});
		if (!scannable.length) {
			return normalized;
		}
		let scanResults = await this._scanAPIConnections(scannable);
		return normalized.map((connection) => {
			let match = scanResults.find((result) =>
				(result.connection_id && result.connection_id == connection.id) ||
				(this._normalizeURLValue(result.base_url) == this._normalizeURLValue(connection.base_url))
			);
			if (!match || !Array.isArray(match.models) || !match.models.length) {
				return connection;
			}
			return Object.assign({}, connection, {
				models_cache: match.models
					.map((entry) => this._normalizeDiscoveredModelEntry(entry))
					.filter(Boolean),
			});
		});
	},

	_normalizeURLValue(value) {
		return String(value || "").trim().replace(/\/+$/, "");
	},

	_isLoopbackHost(hostname = "") {
		let host = String(hostname || "").trim().toLowerCase();
		return ["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(host);
	},

	_connectionIsLMStudio(connection) {
		if (!connection?.base_url) {
			return false;
		}
		return this._deriveProviderNameFromURL(connection.base_url) == "LM Studio" ||
			String(connection.label || "").trim().toLowerCase() == "lm studio";
	},

	_connectionIsOllama(connection) {
		if (!connection?.base_url) {
			return false;
		}
		return this._deriveProviderNameFromURL(connection.base_url) == "Ollama" ||
			String(connection.label || "").trim().toLowerCase() == "ollama";
	},

	_ollamaRootURL(baseURL = "") {
		let normalized = this._normalizeURLValue(baseURL || "");
		if (!normalized) {
			return "";
		}
		return normalized.replace(/\/v1$/, "");
	},

	async _showOllamaModel(rootURL = "", modelID = "", apiKey = "") {
		let normalizedRoot = this._ollamaRootURL(rootURL);
		let normalizedModel = String(modelID || "").trim();
		if (!normalizedRoot || !normalizedModel) {
			return null;
		}
		try {
			let response = await this._postJSONWithTimeout(
				`${normalizedRoot}/api/show`,
				{ model: normalizedModel },
				120000,
				this._authorizationHeaders(apiKey || ""),
				"Ollama model details"
			);
			return response && typeof response == "object"
				? Object.assign({}, response, {
					id: normalizedModel,
					name: normalizedModel,
				})
				: null;
		}
		catch (_error) {
			return null;
		}
	},

	_scanCandidateDedupKey(candidate = {}) {
		let baseURL = this._normalizeURLValue(candidate?.base_url || "");
		let parsed = this._parseEndpointURL(baseURL);
		if (!parsed) {
			return `${baseURL}::${String(candidate?.api_kind || "auto")}`;
		}
		let path = "/";
		try {
			path = new URL(baseURL).pathname || "/";
		}
		catch (_error) {}
		let host = this._isLoopbackHost(parsed.host) ? "loopback" : String(parsed.host || "").toLowerCase();
		return `${host}:${Number(parsed.port || 0) || 0}:${path.replace(/\/+$/, "") || "/"}::${String(candidate?.api_kind || "auto")}`;
	},

	async _postJSONWithTimeout(url, payload, timeoutMs = 30000, headers = {}, errorLabel = "Request") {
		let requestHeaders = Object.assign(
			{
				"content-type": "application/json",
				accept: "application/json",
			},
			headers || {}
		);
		let abortOptions = this._fetchAbortOptions(timeoutMs);
		try {
			let response = await fetch(url, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify(payload || {}),
				...(abortOptions.signal ? { signal: abortOptions.signal } : {}),
			});
			if (!response.ok) {
				let body = "";
				try {
					body = await response.text();
				}
			catch (_err) {}
					throw new Error(`${errorLabel} failed (${response.status}). ${body || response.statusText}`.trim());
			}
			let text = await response.text();
			return text ? JSON.parse(text) : {};
		}
		catch (error) {
			throw new Error(error?.message || String(error));
		}
		finally {
			abortOptions.__cleanup();
		}
	},

	_fetchAbortOptions(timeoutMs = 0) {
		let AbortCtor = globalThis.AbortController || null;
		let controller = AbortCtor ? new AbortCtor() : null;
		let timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
		return controller
			? {
				signal: controller.signal,
				__cleanup: () => {
					if (timer) {
						clearTimeout(timer);
					}
				},
			}
				: {
					__cleanup: () => {},
				};
	},

	_clonePreparedAPIClient(baseClient, overrides = {}) {
		return Object.assign({}, baseClient || {}, overrides || {});
	},

	async _prepareRoleAPIClient(roleID, baseClient, config, options = {}) {
		let apiConnections = config?.apiConnections || [];
		let runtimeRoles = config?.runtimeRoles || this._defaultRuntimeRoles();
		let resolvedPreset = this._resolveRolePreset(
			roleID,
			runtimeRoles,
			apiConnections,
			null,
			options?.presetID || options?.preset_id || ""
		) || this._roleAsRuntimePreset(roleID, runtimeRoles?.[roleID] || this._defaultRuntimeRole(roleID), {
			preset_id: "default",
			label: "Default",
		});
		let role = Object.assign(
			{},
			this._defaultRuntimeRole(roleID),
			runtimeRoles?.[roleID] || {},
			resolvedPreset || {}
		);
		let stateMode = this._normalizeRoleStateMode(roleID, role.state_mode, this._defaultRolePresetStateMode(roleID));
		let parallelRequests = this._normalizeParallelRequests(roleID, role.parallel_requests, 1);
		let independentResources = !!role.independent_resources;
		let reasoningEffort = this._runtimeRoleSupportsReasoning(roleID, role.runtime_type)
			? this._normalizeReasoningEffort(role.reasoning_effort, { allowCustom: true })
			: "";
		if (role.runtime_type == "local_exec") {
			stateMode = "stateless";
			let executor = this._localExecExecutor(role);
			if (!executor?.installed || !executor?.binary_path) {
				throw new Error(`${roleID} local executor is not installed.`);
			}
			let runtimePreferences = config?.runtimePreferences || this._defaultRuntimePreferences();
			let effectiveModel = this._localExecModelIdentifier(roleID, executor);
			let effectiveContextWindow = Number(role.context_window || 0) || 0;
			let effectiveMaxOutputTokens = Number(role.max_output_tokens || baseClient?.maxOutputTokens || 0) || 0;
			let effectiveReasoningOptions = [];
			if (String(executor?.id || "").trim() == "opencode") {
				let requestedModel = String(options?.modelOverride || options?.model_override || "").trim();
				let roleModel = String(role.model || "").trim();
				let selectedModelID = requestedModel || roleModel;
				let selectedModel = this._findOpenCodeModel(selectedModelID, runtimePreferences);
				if (selectedModelID && !selectedModelID.startsWith("local-exec/") && !selectedModel) {
					throw new Error(`OpenCode model is not in the scanned catalog: ${selectedModelID}. Run Scan local runtimes before using it.`);
				}
				if (selectedModel) {
					effectiveModel = selectedModel.id;
					role.model = selectedModel.id;
					effectiveReasoningOptions = this._openCodeReasoningOptionsForModel(selectedModel);
					if (Number(selectedModel.safe_context_window || 0) > 0) {
						effectiveContextWindow = Number(selectedModel.safe_context_window || 0) || effectiveContextWindow;
					}
					if (Number(selectedModel.safe_max_output_tokens || 0) > 0) {
						effectiveMaxOutputTokens = Number(selectedModel.safe_max_output_tokens || 0) || effectiveMaxOutputTokens;
					}
				}
				else {
					role.model = "";
				}
				let requestedReasoning = this._normalizeOpenCodeVariantID(options?.reasoningEffort || options?.reasoning_effort || role.reasoning_effort || "");
				reasoningEffort = requestedReasoning && effectiveReasoningOptions.includes(requestedReasoning)
					? requestedReasoning
					: "";
			}
			let rolePath = SystematicReviewerWorkflowServer?.localExecRoleBasePath?.(roleID) || "";
			let baseServerURL = SystematicReviewerWorkflowServer?.getBaseURL?.() || "";
			let streamServerURL = SystematicReviewerWorkflowServer?.getStreamBaseURL?.() || "";
			let internalServiceToken = SystematicReviewerWorkflowServer?.getInternalServiceToken?.() || "";
			let baseUrl = rolePath && baseServerURL
				? `${baseServerURL}${rolePath}`
				: this._localExecResponsesBaseURL(roleID);
			let streamBaseUrl = rolePath && streamServerURL
				? `${streamServerURL}${rolePath}`
				: baseUrl;
			if (!baseUrl) {
				throw new Error("Local execution responses endpoint is unavailable.");
			}
			let schedulerPreset = Object.assign({}, resolvedPreset || {}, {
				model: role.model || effectiveModel,
			});
			return {
					client: this._clonePreparedAPIClient(baseClient || {}, {
						runtimeType: "local_exec",
						roleID,
						baseUrl,
						streamBaseUrl,
					model: effectiveModel,
					apiKind: "responses",
					apiKey: internalServiceToken,
					timeoutMs: Number(role.timeout_ms || baseClient?.timeoutMs || 120000) || 120000,
						maxOutputTokens: effectiveMaxOutputTokens,
						executorID: executor.id,
						executorPath: executor.binary_path,
						executorArgs: Array.isArray(executor.args) ? executor.args.slice() : [],
						contextWindow: effectiveContextWindow,
						stateMode,
					parallelRequests,
					independentResources,
					reasoningEffort,
					openCodeReasoningOptions: effectiveReasoningOptions,
					presetID: String(resolvedPreset?.preset_id || "default").trim() || "default",
					presetLabel: this._runtimePresetLabel(roleID, resolvedPreset, apiConnections),
					schedulerKey: this._runtimeSchedulerKey(roleID, schedulerPreset, null, executor),
				}),
				summaryPatch: null,
				release: async () => {},
			};
		}
		if (!["local_api", "external_api"].includes(role.runtime_type) || !role.connection_id || !role.model) {
			return {
				client: this._clonePreparedAPIClient(baseClient || {}),
				summaryPatch: null,
				release: async () => {},
			};
		}
		let connection = this._findConnectionByID(apiConnections, role.connection_id);
		if (!connection) {
			return {
				client: this._clonePreparedAPIClient(baseClient || {}),
				summaryPatch: null,
				release: async () => {},
			};
		}
			let apiKind = this._normalizeRuntimeRoleAPIKind(roleID, role.runtime_type, role.api_kind);
			if (apiKind == "chat_completions") {
				stateMode = "stateless";
			}
			let desiredClient = this._clonePreparedAPIClient(baseClient || {}, {
				baseUrl: this._normalizeURLValue(baseClient?.baseUrl || connection.base_url || ""),
				model: String(role.model || baseClient?.model || "").trim(),
				apiKind,
				apiKey: String(baseClient?.apiKey || connection.api_key || "").trim(),
			timeoutMs: Number(baseClient?.timeoutMs || role.timeout_ms || 120000) || 120000,
			maxOutputTokens: Number(role.max_output_tokens || baseClient?.maxOutputTokens || 0) || 0,
			contextWindow: Number(role.context_window || 0) || 0,
			stateMode,
			parallelRequests,
			independentResources,
			reasoningEffort,
			presetID: String(resolvedPreset?.preset_id || "default").trim() || "default",
			presetLabel: this._runtimePresetLabel(roleID, resolvedPreset, apiConnections),
			schedulerKey: this._runtimeSchedulerKey(roleID, resolvedPreset, connection, null),
		});
		return {
			client: desiredClient,
			summaryPatch: null,
			release: async () => {},
		};
	},

	_assertConfiguredAIEndpoint(kind, config) {
		let normalized = this._normalizeAIEndpointConfig(kind, config || {});
		if (!normalized.base_url || !normalized.model) {
			throw new Error(`${kind} endpoint is not configured. Set both a base URL and a model in Zotero Settings - Systematic Reviewer.`);
		}
		return normalized;
	},

	async _globalSettings() {
		let settings = (await this._readJSONFile(this._globalSettingsPath())) || {};
		return this._setCachedGlobalSettings(settings);
	},

	_setCachedGlobalSettings(settings = {}) {
		this.cachedGlobalSettings = this._normalizeGlobalSettings(settings || {});
		return this.cachedGlobalSettings;
	},

	_globalSettingsSync() {
		if (this.cachedGlobalSettings) {
			return this._normalizeGlobalSettings(this.cachedGlobalSettings);
		}
		return this._normalizeGlobalSettings({});
	},

	_hasConfiguredEmbeddingsModelSync(settings = null) {
		let effective = settings
			? this._normalizeGlobalSettings(settings)
			: this._globalSettingsSync();
		let config = this._buildConversionConfigFromSettings(effective);
		let role = config?.runtimeRoles?.embeddings || this._defaultRuntimeRole("embeddings");
		let runtimeType = String(role?.runtime_type || "").trim();
		let model = String(role?.model || config?.embeddingsClient?.model || "").trim();
		if (!model) {
			return false;
		}
		if (runtimeType == "local_exec") {
			let executor = this._localExecExecutor(role);
			return !!(executor?.installed && executor?.binary_path);
		}
		if (!["local_api", "external_api"].includes(runtimeType)) {
			return false;
		}
		let connection = this._findConnectionByID(config?.apiConnections || [], role?.connection_id || "") || null;
		if (String(connection?.base_url || "").trim()) {
			return true;
		}
		return !!String(config?.embeddingsClient?.baseUrl || "").trim();
	},

	async _hasConfiguredEmbeddingsModel() {
		let settings = await this._globalSettings();
		return this._hasConfiguredEmbeddingsModelSync(settings);
	},

	_buildConversionConfigFromSettings(settings) {
		let endpointSettings = settings.ai_endpoints || this._defaultAIEndpointSettings();
		let runtimeRoles = settings.runtime_roles || this._defaultRuntimeRoles();
		let runtimeSettings = settings.pdf_markdown || {};
		let toClient = (config, roleID) => {
			let role = runtimeRoles?.[roleID] || this._defaultRuntimeRole(roleID);
			return {
			baseUrl: config.base_url,
			model: config.model,
			apiKind: config.api_kind || "auto",
			apiKey: config.api_key || "",
			timeoutMs: config.timeout_ms || 120000,
			reasoningEffort: this._runtimeRoleSupportsReasoning(roleID, role.runtime_type)
				? this._normalizeReasoningEffort(role.reasoning_effort, { allowCustom: true })
				: "",
			maxOutputTokens: Number(role?.max_output_tokens || 0) || 0,
		};
		};
		return {
			runtimeRoles,
			runtimePreferences: settings.runtime_preferences || this._defaultRuntimePreferences(),
			apiConnections: settings.api_connections || [],
			pdf_markdown: Object.assign({}, runtimeSettings),
			pdfMarkdown: Object.assign({}, runtimeSettings),
			chatClient: toClient(endpointSettings.chat || this._defaultAIEndpointConfig("chat"), "session_chat"),
			extractionClient: toClient(endpointSettings.extraction || this._defaultAIEndpointConfig("extraction"), "data_extraction"),
			vlmClient: toClient(endpointSettings.vlm || this._defaultAIEndpointConfig("vlm"), "pdf_vlm"),
			embeddingsClient: toClient(endpointSettings.embeddings || this._defaultAIEndpointConfig("embeddings"), "embeddings"),
			runtime: {
				nPredict: runtimeSettings.n_predict,
				nCtx: runtimeSettings.n_ctx,
				nBatch: runtimeSettings.n_batch,
				nUbatch: runtimeSettings.n_ubatch,
				nParallel: runtimeSettings.n_parallel,
				nThreads: runtimeSettings.n_threads,
				nThreadsBatch: runtimeSettings.n_threads_batch,
				scale: runtimeSettings.scale,
				oversample: runtimeSettings.oversample,
				maxRetries: runtimeSettings.max_retries,
			},
			pdfPrompt: runtimeSettings.pdf_prompt || SystematicReviewerPDFMarkdown.DEFAULT_VLM_PROMPT,
			imagePrompt: runtimeSettings.image_prompt || SystematicReviewerPDFMarkdown.DEFAULT_IMAGE_VLM_PROMPT,
		};
	},

	async _conversionConfig() {
		let settings = await this._globalSettings();
		return this._buildConversionConfigFromSettings(settings);
	},

		async testPreferencePaneRuntimeRole(roleID = "", payload = {}) {
		let requestedRoleID = String(roleID || payload?.role_id || payload?.roleID || "").trim();
		if (!requestedRoleID || !["session_chat", "data_extraction", "pdf_vlm", "embeddings"].includes(requestedRoleID)) {
			throw new Error("role_id must be one of session_chat, data_extraction, pdf_vlm, or embeddings.");
		}
		let existing = await this._globalSettings();
		let legacyEndpoints = this._normalizeAIEndpointSettings(
			existing.ai_endpoints || existing.model_endpoints || existing.endpoints || null,
			existing.openai_compatible || null
		);
		let apiConnections = this._normalizeAPIConnections(
			payload.api_connections || existing.api_connections || null,
			legacyEndpoints
		);
		let runtimeRoles = this._normalizeRuntimeRoles(
			payload.runtime_roles || existing.runtime_roles || null,
			apiConnections,
			legacyEndpoints
		);
		let runtimePreferences = this._normalizeRuntimePreferences(
			payload.runtime_preferences || existing.runtime_preferences || null
		);
		let serverSecurity = this._normalizeServerSecuritySettings(
			payload.server_security || existing.server_security || null
		);
		let pdfMarkdown = this._normalizePdfMarkdownSettings(
			payload.pdf_markdown || existing.pdf_markdown || null
		);
		let normalizedEndpoints = this._materializeAIEndpointsFromRuntimeRoles(
			apiConnections,
			runtimeRoles,
			legacyEndpoints,
			runtimePreferences
		);
		this._validateAIEndpointSettings(normalizedEndpoints);
		this._validateRuntimeRoles(runtimeRoles, apiConnections, runtimePreferences, pdfMarkdown);
		this._validateRuntimeRoleModelCapabilities(runtimeRoles, apiConnections, runtimePreferences, pdfMarkdown);
		let settings = this._normalizeGlobalSettings(Object.assign({}, existing, {
			api_connections: apiConnections,
			runtime_roles: runtimeRoles,
			runtime_preferences: runtimePreferences,
			server_security: serverSecurity,
			ai_endpoints: normalizedEndpoints,
			pdf_markdown: pdfMarkdown,
		}));
		let config = this._buildConversionConfigFromSettings(settings);
		let effectiveRoleID =
			requestedRoleID == "data_extraction" && settings?.runtime_preferences?.use_agent_model_for_data_extraction
				? "session_chat"
				: requestedRoleID;
			return await this._testRuntimeRole(requestedRoleID, effectiveRoleID, config);
		},

		async testPreferencePaneMCPClient(serverConfig = {}, payload = {}) {
			if (typeof SystematicReviewerMCPClient == "undefined" || !SystematicReviewerMCPClient?.testServer) {
				throw new Error("External MCP client runtime is not available.");
			}
			return await SystematicReviewerMCPClient.testServer(this, serverConfig || {}, payload || {});
		},

		async _testRuntimeRole(requestedRoleID, effectiveRoleID, config) {
		let labels = {
			session_chat: "Agent Model",
			data_extraction: "Data Extraction",
			pdf_vlm: "PDF Conversion",
			embeddings: "Embeddings",
		};
		let requested = String(requestedRoleID || "").trim();
		let effective = String(effectiveRoleID || requested || "").trim() || requested;
		let role = config?.runtimeRoles?.[effective] || this._defaultRuntimeRole(effective);
		let effectiveLabel = labels[effective] || effective;
		let purposeLabel = requested == "data_extraction" && effective == "session_chat"
			? "Data Extraction (via Agent Model)"
			: (labels[requested] || effectiveLabel || requested);
		this._assertRoleExecutionReady(effective, config, purposeLabel);
		let baseClient = effective == "session_chat"
			? config.chatClient
			: effective == "data_extraction"
				? config.extractionClient
				: effective == "pdf_vlm"
					? config.vlmClient
					: config.embeddingsClient;
		let connection = this._findConnectionByID(config?.apiConnections || [], role.connection_id) || null;
		let beforeConnections = connection?.base_url
			? await this._refreshLocalConnectionModelCaches(config.apiConnections || [])
			: (config.apiConnections || []);
		let prepared = await this._prepareRoleAPIClient(effective, baseClient, Object.assign({}, config, {
			apiConnections: beforeConnections,
		}));
		let client = null;
		let responsePreview = "";
		let vectorCount = 0;
		let vectorDimensions = 0;
		let batchSize = 0;
		let batchCount = 0;
		try {
			let preparedClient = prepared?.client || baseClient || {};
			let runtimeType = String(preparedClient?.runtimeType || role.runtime_type || "").trim();
			if (runtimeType == "local_exec") {
				client = Object.assign({}, preparedClient || {});
				if (!String(client.baseUrl || "").trim() || !String(client.model || "").trim()) {
					throw new Error(`${purposeLabel} local executor is not configured.`);
				}
			}
			else {
				client = this._assertConfiguredAIEndpoint(
					effective == "session_chat"
						? "chat"
						: effective == "data_extraction"
							? "extraction"
							: effective == "pdf_vlm"
								? "vlm"
								: "embeddings",
					preparedClient
				);
			}
			if (effective == "embeddings") {
				let endpoint = String(client.base_url || "").replace(/\/+$/, "").endsWith("/v1")
					? `${String(client.base_url || "").replace(/\/+$/, "")}/embeddings`
					: `${String(client.base_url || "").replace(/\/+$/, "")}/v1/embeddings`;
				batchSize = Math.max(1, Number(role?.embeddings_batch_size || 32) || 32);
				batchCount = 2;
				let inputs = Array.from({ length: batchSize * batchCount }, (_value, index) => `w${index + 1}`);
				for (let start = 0; start < inputs.length; start += batchSize) {
					let chunk = inputs.slice(start, start + batchSize);
					let json = await this._postJSONWithTimeout(
						endpoint,
						{
							model: client.model,
							input: chunk,
						},
						Math.max(120000, Number(client.timeout_ms || 0) || 0),
						this._authorizationHeaders(client.api_key || "")
					);
					let data = Array.isArray(json?.data) ? json.data : [];
					if (data.length != chunk.length) {
						throw new Error(`Embeddings test returned ${data.length} vectors for ${chunk.length} inputs.`);
					}
					vectorCount += data.length;
					let currentDimensions = Array.isArray(data[0]?.embedding) ? data[0].embedding.length : 0;
					if (!currentDimensions) {
						throw new Error("Embeddings test returned an empty vector.");
					}
					if (!vectorDimensions) {
						vectorDimensions = currentDimensions;
					}
					else if (vectorDimensions != currentDimensions) {
						throw new Error(`Embeddings test returned inconsistent vector dimensions: ${vectorDimensions} and ${currentDimensions}.`);
					}
				}
				if (!vectorDimensions) {
					throw new Error("Embeddings test returned an empty vector.");
				}
			}
			else if (effective == "pdf_vlm") {
				let result = await SystematicReviewerPDFMarkdown.requestVisionMarkdown(
					{
						baseUrl: client.base_url || client.baseUrl,
						model: client.model,
						apiKind: client.api_kind || client.apiKind || "auto",
						apiKey: client.api_key || client.apiKey || "",
						timeoutMs: client.timeout_ms || client.timeoutMs || 120000,
						reasoningEffort: String(prepared?.client?.reasoningEffort || "").trim(),
						maxOutputTokens: Number(prepared?.client?.maxOutputTokens || 0) || 0,
					},
					"Reply with exactly HELLO.",
					"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAIAAABr1yBdAAABCklEQVR42u3TAQkAAAzDsPk3vdk4PJFQaAqPRQIMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA2AAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAyAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGgDsGN3mWYzUr4PsAAAAASUVORK5CYII=",
					Object.assign({}, config.runtime || {}, { nPredict: 64 }),
					false
				);
				responsePreview = String(result?.markdown || "").trim();
				if (!responsePreview) {
					throw new Error("PDF conversion model returned an empty reply.");
				}
			}
			else {
				let runtimeType = String(client.runtimeType || "").trim();
				let requestClient = {
					baseUrl: client.base_url || client.baseUrl,
					streamBaseUrl: client.streamBaseUrl || "",
					model: client.model,
					apiKind: client.api_kind || client.apiKind || "auto",
					apiKey: client.api_key || client.apiKey || "",
					timeoutMs: client.timeout_ms || client.timeoutMs || 120000,
					reasoningEffort: String(prepared?.client?.reasoningEffort || "").trim(),
					maxOutputTokens: Number(prepared?.client?.maxOutputTokens || 0) || 0,
					runtimeType,
					roleID: client.roleID || "",
				};
				let result = runtimeType == "local_exec"
					? await SystematicReviewerPDFMarkdown.requestResponses(
						requestClient,
						{
							model: requestClient.model,
							input: "Reply with exactly HELLO.",
							max_output_tokens: Number(requestClient.maxOutputTokens || 0) || 64,
							stream: true,
							store: false,
							reasoning: requestClient.reasoningEffort
								? { effort: requestClient.reasoningEffort }
								: undefined,
						}
					)
					: await SystematicReviewerPDFMarkdown.requestTextChat(
						requestClient,
						[{ role: "user", content: "Reply with exactly HELLO." }],
						Object.assign({}, config.runtime || {}, { nPredict: 64 }),
						false
					);
				responsePreview = String(result?.text || "").trim();
				if (!responsePreview) {
					throw new Error(`${purposeLabel} test returned an empty reply.`);
				}
			}
		}
		finally {
			await prepared.release?.({ immediate: true });
		}
		let finalConnections = connection?.base_url
			? await this._refreshLocalConnectionModelCaches(config.apiConnections || [])
			: (config.apiConnections || []);
		let finalConnection = this._findConnectionByID(finalConnections, role.connection_id) || connection;
		return {
			ok: true,
			role_id: requested || effective,
			effective_role_id: effective,
			effective_role_label: effectiveLabel,
			label: purposeLabel,
			runtime_type: role.runtime_type,
			connection_id: role.connection_id || "",
			connection_label: String(finalConnection?.label || connection?.label || "").trim(),
			model: String(role.model || "").trim(),
			resolved_model: String(prepared?.client?.model || client?.model || role.model || "").trim(),
			response_preview: responsePreview ? responsePreview.slice(0, 240) : "",
			vector_count: vectorCount,
			vector_dimensions: vectorDimensions,
			batch_size: batchSize,
			batch_count: batchCount,
			message: effective == "embeddings"
				? `${purposeLabel} test succeeded with ${vectorCount} vectors of ${vectorDimensions} dimensions across ${batchCount} batches of ${batchSize}.`
				: `${purposeLabel} test succeeded.`,
		};
	},

	_assertRoleExecutionReady(roleID, config, purposeLabel) {
		let role = config?.runtimeRoles?.[roleID] || this._defaultRuntimeRole(roleID);
		if (role.runtime_type == "local_exec") {
			let executor = this._localExecExecutor(role);
			if (!executor?.installed || !executor?.binary_path) {
				let name = executor?.label || role.executor_id || "the selected CLI runtime";
				throw new Error(`${purposeLabel} local executor is not installed: ${name}.`);
			}
			if (!["session_chat", "data_extraction"].includes(roleID)) {
				throw new Error(`${purposeLabel} does not support local executor mode yet.`);
			}
			return;
		}
		if (role.runtime_type == "external_agent") {
			throw new Error(`${purposeLabel} is owned by an external agent client. Use that client against the localhost tool surface, or switch ${purposeLabel} back to a model API in Zotero Settings - Systematic Reviewer.`);
		}
	},

	_assertSessionChatExecutionReady(config) {
		this._assertRoleExecutionReady("session_chat", config, "Chat Engine");
		let role = config?.runtimeRoles?.session_chat || this._defaultRuntimeRole("session_chat");
		if (role.runtime_type == "local_exec") {
			return;
		}
		this._assertConfiguredAIEndpoint("chat", config.chatClient);
	},

	_discoveredModelCapabilities(raw, modelID) {
		let heuristic = this._classifyDiscoveredModel(modelID);
		let explicit = raw?.capabilities && typeof raw.capabilities == "object" ? raw.capabilities : {};
		let values = [];
		let collect = (value) => {
			if (Array.isArray(value)) {
				for (let entry of value) {
					collect(entry);
				}
				return;
			}
			if (value && typeof value == "object") {
				for (let nested of Object.values(value)) {
					collect(nested);
				}
				return;
			}
			if (value !== undefined && value !== null) {
				values.push(String(value).toLowerCase());
			}
		};
		collect(raw?.modalities);
		collect(raw?.input_modalities);
		collect(raw?.output_modalities);
		collect(raw?.capabilities);
		collect(raw?.architecture);
		collect(raw?.type);
		collect(raw?.task);
		collect(raw?.tasks);
		collect(raw?.object);
		collect(raw?.details?.family);
		collect(raw?.details?.families);
		let hints = values.join(" ");
		let embeddings =
			!!explicit.embeddings ||
			/(^|\b)(embedding|embeddings|embed|bge|e5)(\b|$)/.test(hints) ||
			heuristic.embeddings;
		let vlm =
			!!explicit.vlm ||
			!!explicit.vision ||
			/(^|\b)(vision|image|images|multimodal|mmproj|vlm|llava|pixtral|internvl|molmo)(\b|$)/.test(hints) ||
			heuristic.vlm;
		let text = Object.prototype.hasOwnProperty.call(explicit, "text")
			? !!explicit.text
			: !embeddings;
		if (vlm) {
			text = true;
		}
		return { text, vlm, embeddings };
	},

	_classifyDiscoveredModel(modelID) {
		let value = String(modelID || "").toLowerCase();
		let embeddings =
			value.includes("embedding") ||
			value.includes("embed") ||
			value.includes("bge") ||
			value.includes("e5") ||
			value.includes("nomic-embed") ||
			value.includes("mxbai-embed");
		let vlm =
			value.includes("vision") ||
			value.includes("-vl") ||
			value.includes("vl-") ||
			value.includes("qwen-vl") ||
			value.includes("qwen2.5-vl") ||
			value.includes("qwen3-vl") ||
			value.includes("qwen3.5-vl") ||
			value.includes("llava") ||
			value.includes("pixtral") ||
			value.includes("internvl") ||
			value.includes("cpm-v") ||
			value.includes("gpt-4o") ||
			value.includes("molmo");
		return {
			text: !embeddings,
			vlm,
			embeddings,
		};
	},

	_localModelScanCandidates() {
		let hosts = ["127.0.0.1", "localhost", "0.0.0.0"];
		let candidates = [];
		let addOpenAICompatible = (provider, ports, basePaths) => {
			for (let host of hosts) {
				for (let port of ports) {
					for (let basePath of basePaths) {
						let baseURL = `http://${host}:${port}${basePath}`;
						candidates.push({
							kind: "openai",
							provider,
							host,
							port,
							base_url: baseURL,
							api_kind: "responses",
						});
					}
				}
			}
		};
		addOpenAICompatible("LM Studio", [1234], ["/v1"]);
		addOpenAICompatible("Ollama", [11434], ["/v1"]);
		addOpenAICompatible("MLX / local server", [8080, 8081], ["/v1"]);
		addOpenAICompatible("vLLM / local server", [8000], ["/v1", ""]);
		addOpenAICompatible("llama.cpp / local server", [8080, 8081], ["/v1", ""]);
		addOpenAICompatible("OpenAI-compatible local server", [3000, 4000, 5000], ["/v1"]);
		return candidates;
	},

	_configuredModelScanCandidates(endpoints) {
		let candidates = [];
		let seen = new Set();
		for (let kind of ["chat", "extraction", "vlm", "embeddings"]) {
			let config = this._normalizeAIEndpointConfig(kind, endpoints?.[kind] || {});
			if (!config.base_url) {
				continue;
			}
			let parsed = this._parseEndpointURL(config.base_url);
			if (!parsed) {
				continue;
			}
			let key = `${parsed.base_url}::${config.api_kind || "auto"}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			candidates.push({
				kind: "openai",
				provider: this._deriveProviderNameFromURL(parsed.base_url),
				host: parsed.host,
				port: parsed.port,
				base_url: parsed.base_url,
				api_kind: config.api_kind || "auto",
				source: "configured",
			});
		}
		return candidates;
	},

	_parseEndpointURL(baseURL) {
		try {
			let parsed = new URL(String(baseURL || "").trim());
			return {
				host: parsed.hostname || "",
				port: Number(parsed.port || (parsed.protocol == "https:" ? 443 : 80)) || 0,
				base_url: String(baseURL || "").trim().replace(/\/+$/, ""),
			};
		}
		catch (_err) {
			return null;
		}
	},

	_deriveProviderNameFromURL(baseURL) {
		let parsed = this._parseEndpointURL(baseURL);
		let host = String(parsed?.host || "").toLowerCase();
		let port = Number(parsed?.port || 0) || 0;
		if (port == 1234) {
			return "LM Studio";
		}
		if (port == 11434) {
			return "Ollama";
		}
		if (port == 8000) {
			return "vLLM / local server";
		}
		if ([8080, 8081].includes(port)) {
			return "MLX / local server";
		}
		if (host == "127.0.0.1" || host == "localhost" || host == "0.0.0.0") {
			return "OpenAI-compatible local server";
		}
		if (host.includes("openai.com")) {
			return "OpenAI";
		}
		if (host.includes("openrouter.ai")) {
			return "OpenRouter";
		}
		if (host.includes("groq.com")) {
			return "Groq";
		}
		if (host.includes("together.xyz")) {
			return "Together";
		}
		if (host.includes("fireworks.ai")) {
			return "Fireworks";
		}
		return parsed?.host || "Configured endpoint";
	},

	_authorizationHeaders(apiKey = "") {
		let value = String(apiKey || "").trim();
		return value ? { authorization: `Bearer ${value}` } : {};
	},

	_secretStoragePrefix() {
		return "srsecret:v1:";
	},

	_secretStorageSeed() {
		return `${this.namespace}|${Zotero.DataDirectory.dir}|settings`;
	},

	_textToBytes(value) {
		let source = String(value || "");
		if (typeof TextEncoder == "function") {
			return Array.from(new TextEncoder().encode(source));
		}
		return Array.from(source).map((entry) => entry.charCodeAt(0) & 0xff);
	},

	_bytesToText(bytes) {
		let source = Array.isArray(bytes) ? bytes : [];
		if (typeof TextDecoder == "function") {
			return new TextDecoder().decode(new Uint8Array(source));
		}
		return source.map((entry) => String.fromCharCode(Number(entry) & 0xff)).join("");
	},

	_cloneJSON(value) {
		if (value === undefined) {
			return undefined;
		}
		return JSON.parse(JSON.stringify(value));
	},

	_encodeBytesBase64(bytes) {
		let source = Array.isArray(bytes) ? bytes : [];
		let binary = source.map((entry) => String.fromCharCode(Number(entry) & 0xff)).join("");
		return btoa(binary);
	},

	_decodeBytesBase64(value) {
		let binary = atob(String(value || ""));
		let out = [];
		for (let index = 0; index < binary.length; index += 1) {
			out.push(binary.charCodeAt(index) & 0xff);
		}
		return out;
	},

	_encodeStoredSecret(value = "") {
		let secret = String(value || "").trim();
		if (!secret) {
			return "";
		}
		let prefix = this._secretStoragePrefix();
		if (secret.startsWith(prefix)) {
			return secret;
		}
		let secretBytes = this._textToBytes(secret);
		let seedBytes = this._textToBytes(this._secretStorageSeed());
		if (!seedBytes.length) {
			return secret;
		}
		let out = [];
		for (let index = 0; index < secretBytes.length; index += 1) {
			out.push(secretBytes[index] ^ seedBytes[index % seedBytes.length]);
		}
		return `${prefix}${this._encodeBytesBase64(out)}`;
	},

	_decodeStoredSecret(value = "") {
		let raw = String(value || "").trim();
		let prefix = this._secretStoragePrefix();
		if (!raw || !raw.startsWith(prefix)) {
			return raw;
		}
		try {
			let encoded = raw.slice(prefix.length);
			let secretBytes = this._decodeBytesBase64(encoded);
			let seedBytes = this._textToBytes(this._secretStorageSeed());
			if (!seedBytes.length) {
				return "";
			}
			let out = [];
			for (let index = 0; index < secretBytes.length; index += 1) {
				out.push(secretBytes[index] ^ seedBytes[index % seedBytes.length]);
			}
			return String(this._bytesToText(out) || "").trim();
		}
		catch (_err) {
			return "";
		}
	},

	_sanitizeStoredAIEndpointSecrets(aiEndpoints) {
		let source = aiEndpoints && typeof aiEndpoints == "object" ? aiEndpoints : {};
		let out = {};
		for (let kind of ["chat", "extraction", "vlm", "embeddings"]) {
			let config = this._normalizeAIEndpointConfig(kind, source[kind] || {});
			out[kind] = Object.assign({}, config, { api_key: "" });
		}
		return out;
	},

	_prepareGlobalSettingsForStorage(settings, existingRaw = null) {
		let normalized = this._normalizeGlobalSettings(settings || {});
		let raw = existingRaw && typeof existingRaw == "object" ? Object.assign({}, existingRaw) : {};
		raw.api_connections = (normalized.api_connections || []).map((connection, index) => {
			let next = this._normalizeAPIConnection(connection, connection?.runtime_type || "local_api", index);
			return Object.assign({}, next, {
				api_key: this._encodeStoredSecret(next.api_key || ""),
			});
		});
		raw.runtime_roles = this._cloneJSON(normalized.runtime_roles || {});
		raw.runtime_preferences = this._cloneJSON(normalized.runtime_preferences || {});
		raw.server_security = Object.assign({}, normalized.server_security || this._defaultServerSecuritySettings(), {
			mcp_api_key: this._encodeStoredSecret(normalized?.server_security?.mcp_api_key || ""),
		});
		raw.privileged_tools = this._cloneJSON(normalized.privileged_tools || this._defaultPrivilegedToolSettings());
		raw.mcp_clients = this._cloneJSON(normalized.mcp_clients || this._defaultMCPClientSettings());
		raw.pdf_markdown = this._cloneJSON(normalized.pdf_markdown || {});
		raw.agent_runtime_catalog = this._cloneJSON(normalized.agent_runtime_catalog || {});
		raw.agent_execution_catalog = this._cloneJSON(normalized.agent_execution_catalog || {});
		raw.editor = this._cloneJSON(normalized.editor || {});
		raw.last_project = this._cloneJSON(normalized.last_project || null);
		raw.ai_endpoints = this._sanitizeStoredAIEndpointSecrets(normalized.ai_endpoints || {});
		raw.openai_compatible = Object.assign({}, raw.ai_endpoints.chat || this._defaultAIEndpointConfig("chat"), {
			api_key: "",
		});
		raw.openalex_api_key = this._encodeStoredSecret(normalized.openalex_api_key || "");
		raw.kind = normalized.kind;
		raw.version = normalized.version;
		raw.namespace = normalized.namespace;
		raw.storage_root = normalized.storage_root;
		raw.projects_root = normalized.projects_root;
		raw.updated_at = normalized.updated_at || new Date().toISOString();
		return raw;
	},

	async _writeGlobalSettingsRecord(path, settings, existingRaw = null) {
		await this._writeJSONFile(path, this._prepareGlobalSettingsForStorage(settings, existingRaw));
	},

	async _fetchJSONWithTimeout(url, timeoutMs = 5000, options = {}) {
		let result = await this._fetchJSONResultWithTimeout(url, timeoutMs, options);
		return result.ok ? result.json : null;
	},

	async _fetchJSONResultWithTimeout(url, timeoutMs = 5000, options = {}) {
		let headers = Object.assign(
			{ accept: "application/json" },
			options.headers && typeof options.headers == "object" ? options.headers : {}
		);
		let abortOptions = this._fetchAbortOptions(timeoutMs);
		try {
			let response = await fetch(url, {
				method: String(options.method || "GET").toUpperCase(),
				headers,
				...(abortOptions.signal ? { signal: abortOptions.signal } : {}),
			});
			let text = await response.text();
			if (!response.ok) {
				return {
					ok: false,
					status: Number(response.status || 0) || 0,
					statusText: String(response.statusText || "").trim(),
					text,
					error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`.trim(),
				};
			}
			if (!text) {
				return {
					ok: true,
					status: Number(response.status || 0) || 0,
					statusText: String(response.statusText || "").trim(),
					text: "",
					json: {},
				};
			}
			try {
				return {
					ok: true,
					status: Number(response.status || 0) || 0,
					statusText: String(response.statusText || "").trim(),
					text,
					json: JSON.parse(text),
				};
			}
			catch (error) {
				return {
					ok: false,
					status: Number(response.status || 0) || 0,
					statusText: String(response.statusText || "").trim(),
					text,
					error: error?.message || String(error),
				};
			}
		}
		catch (error) {
			return {
				ok: false,
				status: 0,
				statusText: "",
				text: "",
				error: error?.message || String(error),
			};
		}
		finally {
			abortOptions.__cleanup();
		}
	},

	_scanErrorMessage(url = "", result = null, fallback = "") {
		let target = String(url || "").trim();
		let reason = String(result?.error || fallback || "Request failed.").trim();
		let status = Number(result?.status || 0) || 0;
		let text = String(result?.text || "").trim().replace(/\s+/g, " ");
		let summary = status
			? `${target} failed with HTTP ${status}${reason ? `: ${reason}` : ""}`
			: `${target} failed: ${reason}`;
		if (text) {
			summary += ` Body: ${text.slice(0, 220)}`;
		}
		return summary;
	},

	_normalizeDiscoveredModels(models, ownedBy = "") {
		let out = [];
		let seen = new Set();
		for (let model of models || []) {
			let id = String(model?.id || model?.model || model?.name || "").trim();
			if (!id || seen.has(id)) {
				continue;
			}
			seen.add(id);
			out.push({
				id,
				label: String(model?.display_name || model?.name || id).trim() || id,
				owned_by: String(model?.owned_by || ownedBy || "").trim(),
				engine: String(model?.compatibility_type || model?.format || model?.details?.format || "").trim().toLowerCase(),
				loaded:
					String(model?.state || "").trim().toLowerCase() == "loaded" ||
					(Array.isArray(model?.loaded_instances) && model.loaded_instances.length > 0),
				loaded_context_length:
					Number(model?.loaded_context_length || model?.loaded_instances?.[0]?.config?.context_length || 0) || 0,
				default_context_length:
					Number(model?.default_context_length || 0) ||
					this._parseOllamaParameterTextValue(model?.parameters || "", "num_ctx") ||
					0,
				max_context_length:
					Number(model?.max_context_length || 0) ||
					this._ollamaModelInfoContextLength(model?.model_info || {}) ||
					0,
				current_load: Array.isArray(model?.loaded_instances) && model.loaded_instances.length
					? {
						id: String(model.loaded_instances[0]?.id || "").trim(),
						context_length: Number(model.loaded_instances[0]?.config?.context_length || 0) || 0,
						eval_batch_size: Number(model.loaded_instances[0]?.config?.eval_batch_size || 0) || 0,
						parallel: Number(model.loaded_instances[0]?.config?.parallel || 0) || 0,
						num_experts: Number(model.loaded_instances[0]?.config?.num_experts || 0) || 0,
						flash_attention: !!model.loaded_instances[0]?.config?.flash_attention,
						offload_kv_cache_to_gpu: !!model.loaded_instances[0]?.config?.offload_kv_cache_to_gpu,
					}
					: null,
				loaded_instances: Array.isArray(model?.loaded_instances)
					? model.loaded_instances.map((entry) => ({
						id: String(entry?.id || "").trim(),
						context_length: Number(entry?.config?.context_length || 0) || 0,
						eval_batch_size: Number(entry?.config?.eval_batch_size || 0) || 0,
						parallel: Number(entry?.config?.parallel || 0) || 0,
						num_experts: Number(entry?.config?.num_experts || 0) || 0,
						flash_attention: !!entry?.config?.flash_attention,
						offload_kv_cache_to_gpu: !!entry?.config?.offload_kv_cache_to_gpu,
					})).filter((entry) => entry.id)
					: [],
				parent_model: String(model?.parent_model || model?.details?.parent_model || "").trim(),
				params_string: String(model?.params_string || model?.paramsString || model?.details?.parameter_size || "").trim(),
				quantization_name: String(model?.quantization?.name || model?.quantization || model?.details?.quantization_level || "").trim(),
				size_bytes: Number(model?.size || 0) || 0,
				capabilities: this._discoveredModelCapabilities(model, id),
			});
		}
		return out;
	},

	async _discoverOpenAICompatibleModels(candidate) {
		let baseURL = String(candidate.base_url || "").replace(/\/+$/, "");
		let response = await this._fetchJSONResultWithTimeout(
			`${baseURL}/models`,
			5000,
			{ headers: this._authorizationHeaders(candidate.api_key || "") }
		);
		if (!response.ok) {
			return {
				result: null,
				error: this._scanErrorMessage(`${baseURL}/models`, response),
			};
		}
		let json = response.json;
		let models = this._normalizeDiscoveredModels(json?.data || [], candidate.provider);
		if (!models.length) {
			return {
				result: null,
				error: `${baseURL}/models returned no usable model ids.`,
			};
		}
		return {
			result: {
				provider: candidate.provider,
				host: candidate.host,
				port: candidate.port,
				base_url: baseURL,
				api_kind: candidate.api_kind || "auto",
				detection: "openai_models",
				source: candidate.source || "scan",
				connection_id: String(candidate.connection_id || "").trim(),
				runtime_type: candidate.runtime_type || this._connectionTypeFromURL(baseURL),
				models,
			},
			error: "",
		};
	},

	async _discoverLMStudioModels(candidate) {
		let baseURL = String(candidate.base_url || "").replace(/\/+$/, "");
		let rootURL = baseURL.replace(/\/v1$/, "");
		let v0Response = await this._fetchJSONResultWithTimeout(
			`${rootURL}/api/v0/models`,
			5000,
			{ headers: this._authorizationHeaders(candidate.api_key || "") }
		);
		let v1 = null;
		let v1Response = await this._fetchJSONResultWithTimeout(
			`${rootURL}/api/v1/models`,
			5000,
			{ headers: this._authorizationHeaders(candidate.api_key || "") }
		);
		if (v1Response.ok) {
			v1 = v1Response.json;
		}
		let json = v0Response.ok ? v0Response.json : null;
		let v1Models = Array.isArray(v1?.models) ? v1.models : [];
		let byID = new Map();
		for (let model of v1Models) {
			let baseID = String(model?.key || model?.id || model?.name || "").trim();
			if (baseID) {
				byID.set(baseID, model);
			}
			for (let instance of model?.loaded_instances || []) {
				let instanceID = String(instance?.id || "").trim();
				if (!instanceID) {
					continue;
				}
				byID.set(instanceID, Object.assign({}, model, {
					key: instanceID,
					display_name: instanceID,
					name: instanceID,
					loaded_instances: [instance],
					state: "loaded",
					loaded_context_length: Number(instance?.config?.context_length || 0) || 0,
				}));
			}
		}
		let mergedModels = (json?.data || []).map((entry) => {
			let id = String(entry?.id || entry?.model || entry?.name || "").trim();
			let match = byID.get(id) || null;
			return match ? Object.assign({}, entry, match) : entry;
		});
		let models = this._normalizeDiscoveredModels(mergedModels, candidate.provider || "LM Studio");
		if (!models.length) {
			let errors = [];
			if (!v0Response.ok) {
				errors.push(this._scanErrorMessage(`${rootURL}/api/v0/models`, v0Response));
			}
			if (!v1Response.ok) {
				errors.push(this._scanErrorMessage(`${rootURL}/api/v1/models`, v1Response));
			}
			if (!errors.length) {
				errors.push(`${rootURL}/api/v0/models returned no usable model ids.`);
			}
			return {
				result: null,
				error: errors.join(" | "),
			};
		}
		return {
			result: {
				provider: candidate.provider || "LM Studio",
				host: candidate.host,
				port: candidate.port,
				base_url: baseURL,
				api_kind: candidate.api_kind || "auto",
				detection: "lmstudio_models",
				source: candidate.source || "scan",
				connection_id: String(candidate.connection_id || "").trim(),
				runtime_type: candidate.runtime_type || this._connectionTypeFromURL(baseURL),
				models,
			},
			error: "",
		};
	},

	async _discoverOllamaModels(candidate) {
		let baseURL = String(candidate.base_url || "").replace(/\/+$/, "");
		let rootURL = this._ollamaRootURL(baseURL || `http://${candidate.host}:${candidate.port}`);
		let response = await this._fetchJSONResultWithTimeout(
			`${rootURL}/api/tags`,
			5000,
			{ headers: this._authorizationHeaders(candidate.api_key || "") }
		);
		if (!response.ok) {
			return {
				result: null,
				error: this._scanErrorMessage(`${rootURL}/api/tags`, response),
			};
		}
		let json = response.json;
		let tagModels = Array.isArray(json?.models) ? json.models : [];
		let enrichedModels = await Promise.all(tagModels.map(async (entry) => {
			let modelID = String(entry?.model || entry?.name || "").trim();
			if (!modelID) {
				return entry;
			}
			let details = await this._showOllamaModel(rootURL, modelID, candidate.api_key || "");
			return details ? Object.assign({}, entry, details) : entry;
		}));
		let models = this._normalizeDiscoveredModels(enrichedModels, "ollama");
		if (!models.length) {
			return {
				result: null,
				error: `${rootURL}/api/tags returned no usable model ids.`,
			};
		}
		return {
			result: {
				provider: "Ollama",
				host: candidate.host,
				port: candidate.port,
				base_url: `${rootURL}/v1`,
				api_kind: "responses",
				detection: "ollama_tags",
				source: candidate.source || "scan",
				connection_id: String(candidate.connection_id || "").trim(),
				runtime_type: candidate.runtime_type || "local_api",
				models,
			},
			error: "",
		};
	},

	async _scanLocalModelEndpoints() {
		return this._scanModelEndpoints(this._defaultAIEndpointSettings());
	},

	async _scanAPIConnections(apiConnections) {
		let scan = await this._scanAPIConnectionsDetailed(apiConnections);
		return scan.results;
	},

	async _scanAPIConnectionsDetailed(apiConnections) {
		let configuredCandidates = [];
		for (let connection of apiConnections || []) {
			let normalized = this._normalizeAPIConnection(connection, connection?.runtime_type || "local_api", configuredCandidates.length);
			if (!normalized.base_url) {
				continue;
			}
			let parsed = this._parseEndpointURL(normalized.base_url);
			if (!parsed) {
				continue;
			}
			configuredCandidates.push({
				kind: "openai",
				provider: normalized.label || this._deriveProviderNameFromURL(parsed.base_url),
				host: parsed.host,
				port: parsed.port,
				base_url: parsed.base_url,
				api_kind: normalized.api_kind || "auto",
				api_key: normalized.api_key || "",
				connection_id: normalized.id,
				runtime_type: normalized.runtime_type,
				source: "configured",
			});
		}
		let discoveredCandidates = this._localModelScanCandidates().map((candidate) => Object.assign({}, candidate, {
			connection_id: "",
			runtime_type: "local_api",
			source: "discovered",
		}));
		let candidates = [];
		let seen = new Set();
		for (let candidate of [...configuredCandidates, ...discoveredCandidates]) {
			let key = this._scanCandidateDedupKey(candidate);
			if (!candidate.base_url || seen.has(key)) {
				continue;
			}
			seen.add(key);
			candidates.push(candidate);
		}
		let outcomes = await Promise.all(candidates.map(async (candidate) => {
			let errors = [];
			let providerName = String(candidate.provider || "").toLowerCase();
			if (providerName == "lm studio") {
				let lmStudioResult = await this._discoverLMStudioModels(candidate);
				if (lmStudioResult?.result) {
					return {
						candidate,
						result: lmStudioResult.result,
						error: "",
					};
				}
				if (lmStudioResult?.error) {
					errors.push(lmStudioResult.error);
				}
			}
			if (providerName == "ollama") {
				let ollamaResult = await this._discoverOllamaModels(candidate);
				if (ollamaResult?.result) {
					return {
						candidate,
						result: ollamaResult.result,
						error: "",
					};
				}
				if (ollamaResult?.error) {
					errors.push(ollamaResult.error);
				}
			}
			let openAIResult = await this._discoverOpenAICompatibleModels(candidate);
			if (openAIResult?.result) {
				return {
					candidate,
					result: openAIResult.result,
					error: "",
				};
			}
			if (openAIResult?.error) {
				errors.push(openAIResult.error);
			}
			return {
				candidate,
				result: null,
				error: errors.filter(Boolean).join(" | "),
			};
		}));
		let out = [];
		let seenResults = new Set();
		let scanErrors = [];
		for (let outcome of outcomes) {
			let result = outcome?.result || null;
				if (!result) {
					if (outcome?.candidate?.source == "configured") {
						scanErrors.push({
							connection_id: String(outcome.candidate.connection_id || "").trim(),
							base_url: String(outcome.candidate.base_url || "").trim(),
							provider: String(outcome.candidate.provider || "").trim(),
							message: String(outcome.error || `No models were returned by ${outcome?.candidate?.base_url || "the configured runtime"}, and no transport reported a usable response.`).trim(),
						});
					}
					continue;
				}
			let modelKey = (result.models || []).map((model) => model.id).join("|");
			let key = result.connection_id
				? `configured::${result.connection_id}::${modelKey}`
				: result.runtime_type == "local_api"
					? `local_scan::${result.provider}:${result.port}:${result.detection || ""}:${modelKey}`
					: `remote_scan::${result.base_url || ""}::${modelKey}`;
			if (seenResults.has(key)) {
				continue;
			}
			seenResults.add(key);
			out.push(result);
		}
		out.sort((a, b) => {
			let aKey = `${a.source == "configured" ? "0" : "1"}:${this._localHostPreference(a.host)}:${a.provider}:${a.host}:${a.port}`;
			let bKey = `${b.source == "configured" ? "0" : "1"}:${this._localHostPreference(b.host)}:${b.provider}:${b.host}:${b.port}`;
			return aKey.localeCompare(bKey);
		});
		return {
			results: out,
			errors: scanErrors,
		};
	},

	_localHostPreference(hostname = "") {
		let host = String(hostname || "").toLowerCase();
		if (host == "127.0.0.1") {
			return "0";
		}
		if (host == "localhost") {
			return "1";
		}
		if (host == "0.0.0.0") {
			return "2";
		}
		return "3";
	},

	async _scanModelEndpoints(endpoints) {
		let candidates = [
			...this._configuredModelScanCandidates(endpoints),
			...this._localModelScanCandidates(),
		];
		let dedupedCandidates = [];
		let seenCandidates = new Set();
		for (let candidate of candidates) {
			let key = this._scanCandidateDedupKey(candidate);
			if (!candidate.base_url || seenCandidates.has(key)) {
				continue;
			}
			seenCandidates.add(key);
			dedupedCandidates.push(candidate);
		}
		let results = await Promise.all(
			dedupedCandidates.map(async (candidate) => {
				let providerName = String(candidate.provider || "").toLowerCase();
				if (providerName == "lm studio") {
					let lmStudioResult = await this._discoverLMStudioModels(candidate);
					if (lmStudioResult) {
						return lmStudioResult;
					}
				}
				if (providerName == "ollama") {
					let ollamaResult = await this._discoverOllamaModels(candidate);
					if (ollamaResult) {
						return ollamaResult;
					}
				}
				let openAIResult = await this._discoverOpenAICompatibleModels(candidate);
				if (openAIResult) {
					return openAIResult;
				}
				return null;
			})
		);
		let deduped = [];
		let seen = new Set();
		for (let result of results) {
			if (!result) {
				continue;
			}
			let key = [
				result.provider,
				result.port,
				result.detection || "",
				(result.models || []).map((model) => model.id).join("|"),
			].join("::");
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			deduped.push(result);
		}
		deduped.sort((a, b) =>
			`${a.provider}:${a.host}:${a.port}`.localeCompare(`${b.provider}:${b.host}:${b.port}`)
		);
		return deduped;
	},

		_environmentPATHEntries() {
			try {
				let raw = this._environmentValue("PATH");
			let separator = this._isWindowsPlatform() ? ";" : ":";
			return raw.split(separator).map((entry) => String(entry || "").trim()).filter(Boolean);
		}
		catch (_err) {
			return [];
			}
		},

		_environmentValue(name = "") {
			let key = String(name || "").trim();
			if (!key) {
				return "";
			}
			try {
				let env = Components.classes["@mozilla.org/process/environment;1"]
					.getService(Components.interfaces.nsIEnvironment);
				return env.exists(key) ? String(env.get(key) || "").trim() : "";
			}
			catch (_err) {
				return "";
			}
		},

		_fallbackExecutableSearchDirs() {
			if (this._isWindowsPlatform()) {
				let dirs = [];
				let localAppData = this._environmentValue("LOCALAPPDATA");
				let userProfile = this._environmentValue("USERPROFILE");
				if (localAppData) {
					dirs.push(this._joinPath(localAppData, "Microsoft", "WindowsApps"));
				}
				if (userProfile) {
					dirs.push(this._joinPath(userProfile, ".cargo", "bin"));
				}
				return dirs;
			}
			let dirs = [
				"/opt/homebrew/bin",
				"/usr/local/bin",
				"/usr/bin",
				"/bin",
			];
			let home = this._environmentValue("HOME");
			if (home) {
				dirs.push(
					this._joinPath(home, ".local", "bin"),
					this._joinPath(home, "bin"),
					this._joinPath(home, ".cargo", "bin")
				);
			}
			return dirs;
		},

		_isWindowsPlatform() {
			try {
				return String(Services.appinfo?.OS || "").toUpperCase() == "WINNT";
			}
			catch (_err) {
			return false;
		}
	},

	_windowsExecutableExtensions() {
		let out = [""];
		try {
			if (!this._isWindowsPlatform()) {
				return out;
			}
			let env = Components.classes["@mozilla.org/process/environment;1"]
				.getService(Components.interfaces.nsIEnvironment);
			let raw = env.exists("PATHEXT") ? String(env.get("PATHEXT") || "") : "";
			for (let entry of raw.split(";")) {
				let clean = String(entry || "").trim().toLowerCase();
				if (!clean) {
					continue;
				}
				if (!clean.startsWith(".")) {
					clean = `.${clean}`;
				}
				if (!out.includes(clean)) {
					out.push(clean);
				}
			}
		}
		catch (_err) {}
		for (let ext of [".exe", ".cmd", ".bat", ".com"]) {
			if (!out.includes(ext)) {
				out.push(ext);
			}
		}
		return out;
	},

		_findExecutablePath(command = "", absolutePaths = []) {
			let normalizedCommand = String(command || "").trim();
			if (!normalizedCommand) {
				return "";
			}
			let windows = this._isWindowsPlatform();
			let extensions = this._windowsExecutableExtensions();
			let seen = new Set();
			let pushCandidate = (list, value) => {
				let clean = String(value || "").trim();
				if (!clean) {
					return;
				}
				let key = windows ? clean.toLowerCase() : clean;
				if (seen.has(key)) {
					return;
				}
				seen.add(key);
				list.push(clean);
			};
			let appendCandidate = (list, value) => {
				let clean = String(value || "").trim();
				if (!clean) {
					return;
				}
				pushCandidate(list, clean);
				if (!windows) {
					return;
				}
				let lower = clean.toLowerCase();
				if (/\.[a-z0-9]+$/i.test(lower)) {
				return;
			}
				for (let ext of extensions) {
					if (!ext) {
						continue;
					}
					pushCandidate(list, `${clean}${ext}`);
				}
			};
			let candidates = [];
			for (let entry of absolutePaths || []) {
				appendCandidate(candidates, entry);
			}
			for (let entry of this._environmentPATHEntries()) {
				appendCandidate(candidates, this._joinPath(entry, normalizedCommand));
			}
			for (let entry of this._fallbackExecutableSearchDirs()) {
				appendCandidate(candidates, this._joinPath(entry, normalizedCommand));
			}
			for (let candidate of candidates) {
				try {
					let file = this._nsIFile(candidate);
					if (file.exists() && !file.isDirectory()) {
					return file.path;
				}
			}
			catch (_err) {}
		}
		return "";
	},

		_openCodeModelSupportsRole(model = {}, roleID = "") {
			let capabilities = model?.capabilities || {};
			let role = String(roleID || "").trim();
			if (role == "session_chat" || role == "data_extraction") {
				return !!capabilities.text || !!capabilities.vlm;
			}
			if (role == "pdf_vlm") {
				return true;
			}
			if (role == "embeddings") {
				return !!capabilities.embeddings;
			}
			return false;
		},

		_openCodeModelCatalog(runtimePreferences = null) {
			let preferences = this._normalizeRuntimePreferences(runtimePreferences);
			return this._normalizeOpenCodeModelCache(preferences.executor_model_cache?.opencode || null).models || [];
		},

		_openCodeModelsForRole(roleID = "", runtimePreferences = null) {
			return this._openCodeModelCatalog(runtimePreferences)
				.filter((model) => this._openCodeModelSupportsRole(model, roleID));
		},

		_findOpenCodeModel(modelID = "", runtimePreferences = null) {
			let wanted = String(modelID || "").trim();
			if (!wanted || wanted.startsWith("local-exec/")) {
				return null;
			}
			return this._openCodeModelCatalog(runtimePreferences)
				.find((model) => String(model?.id || "").trim() == wanted) || null;
		},

		_openCodeReasoningOptionsForModel(model = null) {
			return Array.isArray(model?.reasoning_options)
				? model.reasoning_options.map((value) => this._normalizeOpenCodeVariantID(value)).filter(Boolean)
				: [];
		},

		_openCodeModelOptionSummary(model = {}) {
			return {
				id: String(model?.id || "").trim(),
				label: String(model?.label || model?.id || "").trim(),
				provider: String(model?.provider_id || "").trim(),
				provider_id: String(model?.provider_id || "").trim(),
				model_id: String(model?.model_id || "").trim(),
				capabilities: Object.assign({}, model?.capabilities || {}),
				limit: Object.assign({}, model?.limit || {}),
				variants: Array.isArray(model?.variants) ? model.variants.slice() : [],
				reasoning_options: this._openCodeReasoningOptionsForModel(model),
				safe_context_window: Number(model?.safe_context_window || 0) || 0,
				safe_max_output_tokens: Number(model?.safe_max_output_tokens || 0) || 0,
			};
		},

		_collectOpenCodeJSONBlock(lines = [], startIndex = 0) {
			let jsonLines = [];
			let depth = 0;
			let started = false;
			for (let index = startIndex; index < lines.length; index += 1) {
				let line = String(lines[index] || "");
				if (!started && !line.trim().startsWith("{")) {
					continue;
				}
				started = true;
				jsonLines.push(line);
				let inString = false;
				let escaped = false;
				for (let ch of line) {
					if (escaped) {
						escaped = false;
						continue;
					}
					if (ch == "\\") {
						escaped = true;
						continue;
					}
					if (ch == "\"") {
						inString = !inString;
						continue;
					}
					if (inString) {
						continue;
					}
					if (ch == "{") {
						depth += 1;
					}
					else if (ch == "}") {
						depth -= 1;
					}
				}
				if (started && depth <= 0) {
					return {
						text: jsonLines.join("\n"),
						nextIndex: index + 1,
					};
				}
			}
			return null;
		},

		_parseOpenCodeVerboseModels(output = "") {
			let lines = String(output || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
			let entries = [];
			for (let index = 0; index < lines.length; index += 1) {
				let header = String(lines[index] || "").trim();
				if (!header || header.startsWith("{") || !header.includes("/")) {
					continue;
				}
				let block = this._collectOpenCodeJSONBlock(lines, index + 1);
				if (!block?.text) {
					continue;
				}
				try {
					let parsed = JSON.parse(block.text);
					let normalized = this._normalizeOpenCodeModelEntry(parsed, header);
					if (normalized) {
						entries.push(normalized);
					}
					index = block.nextIndex - 1;
				}
				catch (_error) {}
			}
			let seen = new Set();
			return entries.filter((entry) => {
				let id = String(entry?.id || "").trim();
				if (!id || seen.has(id)) {
					return false;
				}
				seen.add(id);
				return true;
			}).sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
		},

		async _scanOpenCodeExecutorModels(executor = {}) {
			let scannedAt = new Date().toISOString();
			if (!executor?.installed || !executor?.binary_path) {
				return {
					scanned_at: scannedAt,
					error: "OpenCode is not installed.",
					models: [],
				};
			}
			let tempRoot = this._joinPath(this._configRoot(), "local-exec");
			await this._ensureDirectory(tempRoot);
			let token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			let outputPath = this._joinPath(tempRoot, `opencode-models-${token}.jsonl`);
			let errorPath = this._joinPath(tempRoot, `opencode-models-${token}.stderr.txt`);
			let commandParts = [
				...(this._isWindowsPlatform() ? [] : ["exec"]),
				this._shellQuote(executor.binary_path),
				"models",
				"--verbose",
				"--pure",
				">",
				this._shellQuote(outputPath),
				"2>",
				this._shellQuote(errorPath),
			];
			try {
				let exitCode = await this._runShellCommandAsync(commandParts.join(" "), {
					timeoutMs: 45000,
				});
				let output = await this._readFileText(outputPath).catch(() => "");
				let stderr = await this._readFileText(errorPath).catch(() => "");
				if (exitCode !== 0) {
					return {
						scanned_at: scannedAt,
						error: `OpenCode model scan failed with exit code ${exitCode}.${stderr ? ` ${stderr.trim()}` : ""}`.trim(),
						models: [],
					};
				}
				return {
					scanned_at: scannedAt,
					error: "",
					models: this._parseOpenCodeVerboseModels(output),
				};
			}
			finally {
				await this._removeIfExists(outputPath);
				await this._removeIfExists(errorPath);
			}
		},

		async _refreshExecutorModelCaches(runtimePreferences = null, options = {}) {
			let preferences = this._normalizeRuntimePreferences(runtimePreferences);
			let next = Object.assign({}, preferences, {
				executor_model_cache: Object.assign({}, preferences.executor_model_cache || {}),
			});
			if (options?.opencode === true) {
				let executor = this._scanInstalledExecutors(preferences)
					.find((entry) => String(entry?.id || "").trim() == "opencode") || null;
				next.executor_model_cache.opencode = await this._scanOpenCodeExecutorModels(executor || {});
			}
			return this._normalizeRuntimePreferences(next);
		},

		_scanInstalledExecutors(runtimePreferences = null) {
			let preferences = this._normalizeRuntimePreferences(runtimePreferences);
			let caches = preferences.executor_model_cache || {};
			return this._defaultExecutorCatalog().map((entry) => {
			let binaryPath = this._findExecutablePath(entry.command, entry.absolute_paths || []);
			let out = {
				id: entry.id,
				label: entry.label,
				mode: "local_exec",
				command: entry.command,
				args: Array.isArray(entry.args) ? entry.args.slice() : [],
				installed: !!binaryPath,
				binary_path: binaryPath,
			};
			if (entry.id == "opencode") {
				let cache = this._normalizeOpenCodeModelCache(caches.opencode || null);
				out.models_cache = cache.models;
				out.models_scanned_at = cache.scanned_at;
				out.models_error = cache.error;
			}
			return out;
			});
		},

		_localExecExecutor(role = {}) {
			let executorID = String(role?.executor_id || "").trim();
			if (!executorID) {
				return null;
			}
			let scanned = this._scanInstalledExecutors().find((entry) => entry.id == executorID) || null;
			let frozenPath = String(role?.executor_path || role?.executorPath || role?.binary_path || role?.binaryPath || "").trim();
			let frozenArgs = Array.isArray(role?.executor_args)
				? role.executor_args.slice()
				: (Array.isArray(role?.executorArgs) ? role.executorArgs.slice() : null);
			if (!frozenPath && !frozenArgs) {
				return scanned;
			}
			let base = scanned || {
				id: executorID,
				label: executorID,
				command: executorID,
				installed: !!frozenPath,
			};
			return Object.assign({}, base, {
				binary_path: frozenPath || base.binary_path || "",
				installed: !!(frozenPath || base.binary_path),
				...(frozenArgs ? { args: frozenArgs } : {}),
			});
		},

		_shellQuote(value = "") {
			if (this._isWindowsPlatform()) {
				return this._windowsShellQuote(value);
			}
			let text = String(value || "");
			return `'${text.replace(/'/g, `'\"'\"'`)}'`;
		},

		_windowsShellQuote(value = "") {
			let text = String(value || "");
			return `"${text.replace(/"/g, "\"\"").replace(/%/g, "%%")}"`;
		},

		_shellCommandSpec(commandText = "") {
			let command = String(commandText || "");
			if (this._isWindowsPlatform()) {
				return {
					binaryPath: this._findExecutablePath("cmd", ["C:\\Windows\\System32\\cmd.exe"]) || "C:\\Windows\\System32\\cmd.exe",
					args: ["/d", "/s", "/c", command],
				};
			}
			return {
				binaryPath: this._findExecutablePath("sh", ["/bin/sh", "/usr/bin/sh"]) || "/bin/sh",
				args: ["-lc", command],
			};
		},

		_runShellCommandAsync(commandText = "", options = {}) {
			let spec = this._shellCommandSpec(commandText);
			return this._runProcessAsync(spec.binaryPath, spec.args, options || {});
		},

		_localExecModelIdentifier(roleID = "", executor = null) {
			let cleanRoleID = String(roleID || "").trim() || "session_chat";
			let executorID = String(executor?.id || executor?.label || "local-exec").trim() || "local-exec";
			return `local-exec/${executorID}/${cleanRoleID}`;
		},

		_normalizeLocalExecReasoningEffort(value = "", executor = null) {
			let normalized = String(value || "").trim().toLowerCase();
			if (["low", "medium", "high", "xhigh"].includes(normalized)) {
				return normalized;
			}
			if (String(executor?.id || "").trim() == "codex") {
				return "medium";
			}
			return "";
		},

		_localExecHasConfigOverride(args = [], key = "") {
			let wanted = String(key || "").trim().toLowerCase();
			if (!wanted) {
				return false;
			}
			for (let index = 0; index < args.length; index += 1) {
				let current = String(args[index] || "").trim();
				if (!["-c", "--config"].includes(current)) {
					continue;
				}
				let next = String(args[index + 1] || "").trim().toLowerCase();
				if (next.startsWith(`${wanted}=`)) {
					return true;
				}
			}
			return false;
		},

		async _runLocalExecText(roleID, role, promptText, options = {}) {
			let executor = this._localExecExecutor(role);
			if (!executor?.installed || !executor?.binary_path) {
				throw new Error(`${roleID} local executor is not installed.`);
			}
			if (["codex", "opencode"].includes(String(executor?.id || "").trim())) {
				return await this._runLocalExecTextStream(roleID, role, promptText, {
					cwd: options.cwd || "",
					timeoutMs: options.timeoutMs,
					reasoningEffort: options.reasoningEffort || "",
					outputSchema: options.outputSchema && typeof options.outputSchema == "object"
						? options.outputSchema
						: null,
					signal: options?.signal || null,
				});
			}
			let tempRoot = this._joinPath(this._configRoot(), "local-exec");
			await this._ensureDirectory(tempRoot);
			let token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			let promptPath = this._joinPath(tempRoot, `${roleID}-${token}.prompt.txt`);
			let outputPath = this._joinPath(tempRoot, `${roleID}-${token}.output.txt`);
			let errorPath = this._joinPath(tempRoot, `${roleID}-${token}.stderr.txt`);
			let schema = options.outputSchema && typeof options.outputSchema == "object"
				? options.outputSchema
				: null;
			let schemaPath = schema ? this._joinPath(tempRoot, `${roleID}-${token}.schema.json`) : "";
			let cwd = String(options.cwd || "").trim() || tempRoot;
			await this._writeTextFile(promptPath, String(promptText || ""));
			if (schemaPath) {
				await this._writeJSONFile(schemaPath, schema);
			}
			let rawArgs = Array.isArray(executor.args) ? executor.args.slice() : [];
			let skipNextValue = false;
			let args = rawArgs.filter((entry) => {
				if (skipNextValue) {
					skipNextValue = false;
					return false;
				}
				let value = String(entry || "").trim();
				if (!value) {
					return false;
				}
				if (["--json", "--output-schema", "--output-last-message", "-o"].includes(value)) {
					if (["--output-schema", "--output-last-message", "-o"].includes(value)) {
						skipNextValue = true;
					}
					return false;
				}
				return true;
			});
			let hasArg = (flag) => args.some((entry) => String(entry || "").trim() == flag);
			let hasDisableFeature = (feature) => {
				for (let index = 0; index < args.length; index += 1) {
					if (String(args[index] || "").trim() != "--disable") {
						continue;
					}
					if (String(args[index + 1] || "").trim() == String(feature || "").trim()) {
						return true;
					}
				}
				return false;
			};
			let isCodexExecutor = String(executor?.id || "").trim() == "codex";
			let reasoningEffort = this._normalizeLocalExecReasoningEffort(options?.reasoningEffort || "", executor);
			let hasReasoningOverride = this._localExecHasConfigOverride(args, "model_reasoning_effort");
			let reasoningConfigValue = this._isWindowsPlatform()
				? `model_reasoning_effort=${reasoningEffort}`
				: `model_reasoning_effort="${reasoningEffort}"`;
			let cmdParts = [
				...(this._isWindowsPlatform() ? [] : ["exec"]),
				this._shellQuote(executor.binary_path),
				...args.map((entry) => this._shellQuote(entry)),
				...(reasoningEffort && !hasReasoningOverride ? ["-c", this._shellQuote(reasoningConfigValue)] : []),
				...(isCodexExecutor && !hasDisableFeature("shell_tool") ? ["--disable", "shell_tool"] : []),
				...(isCodexExecutor && !hasDisableFeature("plugins") ? ["--disable", "plugins"] : []),
				...(isCodexExecutor && !hasDisableFeature("shell_snapshot") ? ["--disable", "shell_snapshot"] : []),
				...(hasArg("--dangerously-bypass-approvals-and-sandbox") ? [] : ["--dangerously-bypass-approvals-and-sandbox"]),
				...(hasArg("--skip-git-repo-check") ? [] : ["--skip-git-repo-check"]),
				...(hasArg("--ephemeral") ? [] : ["--ephemeral"]),
				"-C",
				this._shellQuote(cwd),
				...(schemaPath ? ["--output-schema", this._shellQuote(schemaPath)] : []),
				"-o",
				this._shellQuote(outputPath),
				"-",
				"<",
				this._shellQuote(promptPath),
				"2>",
				this._shellQuote(errorPath),
			];
			let timeoutMs = Math.max(
				30000,
				Number(options.timeoutMs || role.timeout_ms || 120000) || 120000
			);
			let exitCode = await this._runShellCommandAsync(cmdParts.join(" "), {
				timeoutMs,
			});
			let output = await this._readFileText(outputPath).catch(() => "");
			let stderr = await this._readFileText(errorPath).catch(() => "");
			await this._removeIfExists(promptPath);
			await this._removeIfExists(outputPath);
			await this._removeIfExists(errorPath);
			await this._removeIfExists(schemaPath);
			if (exitCode !== 0) {
				throw new Error(`Local executor failed with exit code ${exitCode}.${stderr ? ` ${stderr.trim()}` : ""}`.trim());
			}
			let text = String(output || "").trim();
			if (!text) {
				throw new Error(`Local executor returned no output.${stderr ? ` ${stderr.trim()}` : ""}`.trim());
			}
			return {
				text,
				responseID: "",
			};
		},

		_openCodeConfig() {
			return {
				$schema: "https://opencode.ai/config.json",
				autoupdate: false,
				share: "disabled",
				snapshot: false,
				permission: {
					read: "allow",
					edit: "deny",
					bash: "deny",
					glob: "deny",
					grep: "deny",
					list: "deny",
					lsp: "deny",
					task: "deny",
					skill: "deny",
					todoread: "deny",
					todowrite: "deny",
					webfetch: "deny",
					websearch: "deny",
					codesearch: "deny",
					question: "deny",
					external_directory: "deny",
					doom_loop: "deny",
				},
			};
		},

		_openCodeEnvAssignments(configPath = "") {
			let values = this._openCodeEnvObject(configPath);
			let parts = [];
			for (let [name, value] of Object.entries(values)) {
				if (this._isWindowsPlatform()) {
					parts.push(`set "${name}=${String(value || "").replace(/"/g, "\"\"")}"`);
				}
				else {
					parts.push(`${name}=${this._shellQuote(value)}`);
				}
			}
			return parts;
		},

		_openCodeEnvObject(configPath = "") {
			return {
				OPENCODE_CONFIG: String(configPath || ""),
				OPENCODE_DISABLE_AUTOUPDATE: "1",
				OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
				OPENCODE_DISABLE_CLAUDE_CODE: "1",
				OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1",
				OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
				OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
				OPENCODE_CLIENT: "systematic-reviewer",
			};
		},

		_openCodeSubprocessModule() {
			try {
				let imported = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
				return imported?.Subprocess || null;
			}
			catch (_error) {
				return null;
			}
		},

		async _runOpenCodeSubprocessStream(binaryPath = "", args = [], options = {}) {
			let module = this._openCodeSubprocessModule();
			if (!module?.call) {
				throw new Error("Mozilla Subprocess is not available for OpenCode streaming.");
			}
			let proc = null;
			let stdoutText = "";
			let stderrText = "";
			let finished = false;
			let timeoutHandle = null;
			let abortListener = null;
			let abortSignal = options?.signal || null;
			let makeAbortError = (message = "OpenCode process aborted.") => {
				let error = new Error(String(message || "OpenCode process aborted."));
				error.name = "AbortError";
				return error;
			};
			let cleanup = () => {
				if (timeoutHandle) {
					try {
						timeoutHandle.cancel();
					}
					catch (_error) {}
					timeoutHandle = null;
				}
				if (abortSignal && abortListener && typeof abortSignal.removeEventListener == "function") {
					try {
						abortSignal.removeEventListener("abort", abortListener);
					}
					catch (_error) {}
					abortListener = null;
				}
			};
			let kill = () => {
				try {
					proc?.kill?.();
				}
				catch (_error) {}
			};
			if (abortSignal?.aborted) {
				throw makeAbortError();
			}
			let commandPath = String(binaryPath || "");
			let commandArgs = (Array.isArray(args) ? args : []).map((entry) => String(entry || ""));
			if (this._isWindowsPlatform() && /\.(?:cmd|bat)$/i.test(commandPath)) {
				let scriptCommand = [
					this._windowsShellQuote(commandPath),
					...commandArgs.map((entry) => this._windowsShellQuote(entry)),
				].join(" ");
				commandPath = this._findExecutablePath("cmd", ["C:\\Windows\\System32\\cmd.exe"]) || "C:\\Windows\\System32\\cmd.exe";
				commandArgs = ["/d", "/s", "/c", scriptCommand];
			}
			let callOptions = {
				command: commandPath,
				arguments: commandArgs,
				stdout: "pipe",
				stderr: "pipe",
			};
			if (options?.cwd) {
				callOptions.workdir = String(options.cwd || "");
			}
			if (options?.environment && typeof options.environment == "object") {
				callOptions.environment = options.environment;
				callOptions.environmentAppend = true;
			}
			proc = await module.call(callOptions);
			let stdoutLoop = (async () => {
				while (proc?.stdout) {
					let chunk = await proc.stdout.readString();
					if (!chunk) {
						break;
					}
					stdoutText += chunk;
					await options?.onStdout?.(chunk, stdoutText);
				}
			})();
			let stderrLoop = (async () => {
				while (proc?.stderr) {
					let chunk = await proc.stderr.readString();
					if (!chunk) {
						break;
					}
					stderrText = `${stderrText}${chunk}`.slice(-12000);
					await options?.onStderr?.(chunk, stderrText);
				}
			})();
			let waitPromise = Promise.resolve(proc.wait()).then((result) => {
				finished = true;
				return Number(result?.exitCode ?? result ?? 0) || 0;
			});
			let racers = [waitPromise];
			let timeoutMs = Math.max(0, Number(options?.timeoutMs || 0) || 0);
			if (timeoutMs > 0) {
				racers.push(Zotero.Promise.delay(timeoutMs).then(() => {
					if (!finished) {
						kill();
						throw new Error(`OpenCode executor timed out after ${timeoutMs} ms.`);
					}
					return 0;
				}));
			}
			if (abortSignal && typeof abortSignal.addEventListener == "function") {
				racers.push(new Promise((_resolve, reject) => {
					abortListener = () => {
						if (!finished) {
							kill();
						}
						reject(makeAbortError());
					};
					abortSignal.addEventListener("abort", abortListener, { once: true });
				}));
			}
			try {
				let exitCode = await Promise.race(racers);
				await stdoutLoop.catch(() => null);
				await stderrLoop.catch(() => null);
				return {
					exitCode,
					stdout: stdoutText,
					stderr: stderrText,
				};
			}
			finally {
				cleanup();
			}
		},

		_openCodeMessageFromPrompt(promptText = "", schema = null) {
			let text = String(promptText || "").trim();
			if (schema && typeof schema == "object" && !text.includes("BEGIN_SYSTEMATIC_REVIEWER_RESPONSES_REQUEST")) {
				let schemaText = "{}";
				try {
					schemaText = JSON.stringify(schema);
				}
				catch (_error) {}
				let schemaIntro = text.includes("BEGIN_SYSTEMATIC_REVIEWER_TOOL_PLAN")
					? "The JSON object between BEGIN_SYSTEMATIC_REVIEWER_TOOL_PLAN and END_SYSTEMATIC_REVIEWER_TOOL_PLAN must satisfy this exact schema:"
					: "Return JSON that satisfies this exact schema:";
				text = [
					text,
					"SYSTEM:",
					schemaIntro,
					schemaText,
				].filter(Boolean).join("\n\n");
			}
			return text;
		},

		_openCodeTextDeltaFromEvent(parsed = {}) {
			let type = String(parsed?.type || "").trim();
			let part = parsed?.part && typeof parsed.part == "object" ? parsed.part : {};
			let partType = String(part?.type || "").trim();
			if (["text", "output_text", "assistant_message"].includes(type) || ["text", "output_text", "assistant_message"].includes(partType)) {
				return String(part?.text || part?.content || parsed?.text || parsed?.content || "");
			}
			if (type == "message" || type == "agent_message") {
				if (typeof parsed?.message == "string") {
					return String(parsed.message || "");
				}
				return String(parsed?.text || parsed?.content || "");
			}
			if (Array.isArray(parsed?.parts)) {
				return parsed.parts
					.map((entry) => {
						let entryType = String(entry?.type || "").trim();
						if (!["text", "output_text", "assistant_message"].includes(entryType)) {
							return "";
						}
						return String(entry?.text || entry?.content || "");
					})
					.filter(Boolean)
					.join("");
			}
			let message = parsed?.message && typeof parsed.message == "object" ? parsed.message : null;
			if (message) {
				if (typeof message.text == "string" || typeof message.content == "string") {
					return String(message.text || message.content || "");
				}
				if (Array.isArray(message.content)) {
					return message.content
						.map((entry) => String(entry?.text || entry?.content || ""))
						.filter(Boolean)
						.join("");
				}
			}
			if (typeof parsed?.delta == "string" && /text|message/.test(type)) {
				return String(parsed.delta || "");
			}
			return "";
		},

		_openCodeReasoningDeltaFromEvent(parsed = {}) {
			let type = String(parsed?.type || "").trim().toLowerCase();
			let part = parsed?.part && typeof parsed.part == "object" ? parsed.part : {};
			let partType = String(part?.type || "").trim().toLowerCase();
			if (["thinking", "reasoning"].includes(type) || ["thinking", "reasoning"].includes(partType)) {
				return String(part?.text || part?.content || parsed?.text || parsed?.content || parsed?.delta || "");
			}
			if ((type.includes("thinking") || type.includes("reasoning")) && typeof parsed?.delta == "string") {
				return String(parsed.delta || "");
			}
			return "";
		},

		_openCodeTokenUsageFromEvent(parsed = {}) {
			let part = parsed?.part && typeof parsed.part == "object" ? parsed.part : {};
			let tokens = part?.tokens && typeof part.tokens == "object" ? part.tokens : null;
			if (!tokens) {
				return null;
			}
			return {
				total: Number(tokens.total || 0) || 0,
				input: Number(tokens.input || 0) || 0,
				output: Number(tokens.output || 0) || 0,
				reasoning: Number(tokens.reasoning || 0) || 0,
			};
		},

		async _runOpenCodeExecTextStream(roleID, role, executor, promptText, options = {}) {
			let tempRoot = this._joinPath(this._configRoot(), "local-exec");
			await this._ensureDirectory(tempRoot);
			let token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			let promptPath = this._joinPath(tempRoot, `${roleID}-${token}.opencode-prompt.txt`);
			let configPath = this._joinPath(tempRoot, `${roleID}-${token}.opencode-config.json`);
			let outputPath = this._joinPath(tempRoot, `${roleID}-${token}.opencode-output.jsonl`);
			let errorPath = this._joinPath(tempRoot, `${roleID}-${token}.opencode-stderr.txt`);
			let schema = options.outputSchema && typeof options.outputSchema == "object"
				? options.outputSchema
				: null;
			let cwd = String(options.cwd || "").trim() || tempRoot;
			await this._writeTextFile(promptPath, this._openCodeMessageFromPrompt(promptText, schema));
			await this._writeJSONFile(configPath, this._openCodeConfig());
			let rawArgs = Array.isArray(executor.args) ? executor.args.slice() : [];
			let skipNextValue = false;
			let args = rawArgs.filter((entry) => {
				if (skipNextValue) {
					skipNextValue = false;
					return false;
				}
				let value = String(entry || "").trim();
				if (!value) {
					return false;
				}
				if ([
					"run",
					"--format",
					"--dir",
					"--file",
					"--attach",
					"--port",
					"--password",
					"--continue",
					"-c",
					"--session",
					"-s",
					"--model",
					"-m",
					"--variant",
					"--fork",
					"--share",
				].includes(value)) {
					if (["--format", "--dir", "--file", "--attach", "--port", "--password", "--session", "-s", "--model", "-m", "--variant"].includes(value)) {
						skipNextValue = true;
					}
					return false;
				}
				return true;
			});
			let hasArg = (flag) => args.some((entry) => String(entry || "").trim() == flag);
			let model = String(role?.model || "").trim();
			if (model.startsWith("local-exec/")) {
				model = "";
			}
			let settings = await this._globalSettings().catch(() => null);
			let runtimePreferences = settings?.runtime_preferences || this._defaultRuntimePreferences();
			let selectedModel = model ? this._findOpenCodeModel(model, runtimePreferences) : null;
			if (model && !selectedModel) {
				throw new Error(`OpenCode model is not in the scanned catalog: ${model}. Run Scan local runtimes before using it.`);
			}
			let requestedReasoningEffort = this._normalizeOpenCodeVariantID(options?.reasoningEffort || role?.reasoning_effort || "");
			let reasoningOptions = selectedModel ? this._openCodeReasoningOptionsForModel(selectedModel) : [];
			let reasoningEffort = selectedModel && reasoningOptions.includes(requestedReasoningEffort)
				? requestedReasoningEffort
				: "";
			let processArgs = [
				"run",
				"--format",
				"json",
				...(hasArg("--pure") ? [] : ["--pure"]),
				...(hasArg("--thinking") ? [] : ["--thinking"]),
				"--dir",
				cwd,
				...(model && !hasArg("--model") && !hasArg("-m") ? ["--model", model] : []),
				...(reasoningEffort && !hasArg("--variant") ? ["--variant", reasoningEffort] : []),
				...args,
			];
			let commandCore = [
				...(this._isWindowsPlatform() ? [] : ["exec"]),
				this._shellQuote(executor.binary_path),
				...processArgs.map((entry) => this._shellQuote(entry)),
				"<",
				this._shellQuote(promptPath),
				">",
				this._shellQuote(outputPath),
				"2>",
				this._shellQuote(errorPath),
			].join(" ");
			let envParts = this._openCodeEnvAssignments(configPath);
			let commandText = this._isWindowsPlatform()
				? [...envParts, commandCore].join(" && ")
				: [...envParts, commandCore].join(" ");
			let timeoutMs = Math.max(
				30000,
				Number(options.timeoutMs || role.timeout_ms || 120000) || 120000
			);
			let lineState = { buffer: "" };
			let streamedText = "";
			let reasoningText = "";
			let usage = null;
			let processOutputChunk = async (chunk = "", flush = false) => {
				lineState.buffer = `${String(lineState.buffer || "")}${String(chunk || "")}`
					.replace(/\r\n/g, "\n")
					.replace(/\r/g, "\n");
				let lines = lineState.buffer.split("\n");
				if (flush) {
					lineState.buffer = "";
				}
				else {
					lineState.buffer = lines.pop() || "";
				}
				for (let line of lines) {
					let parsed = this._parseLocalExecJSONEvent(line);
					if (!parsed) {
						continue;
					}
					let nextUsage = this._openCodeTokenUsageFromEvent(parsed);
					if (nextUsage) {
						usage = nextUsage;
					}
					let reasoningDelta = this._openCodeReasoningDeltaFromEvent(parsed);
					if (reasoningDelta) {
						reasoningText += reasoningDelta;
						await options?.onEvent?.({
							type: "local_exec.reasoning_delta",
							item_id: String(parsed?.part?.id || "").trim(),
							delta: reasoningDelta,
							text: reasoningText.trim(),
							raw: parsed,
						});
						continue;
					}
					let deltaText = this._openCodeTextDeltaFromEvent(parsed);
					if (deltaText) {
						if (!streamedText) {
							deltaText = deltaText.replace(/^\s+/, "");
						}
						streamedText += deltaText;
						if (options?.onDelta) {
							await options.onDelta(deltaText, streamedText);
						}
						if (!options?.onDelta || schema) {
							await options?.onEvent?.({
								type: "local_exec.agent_message",
								item_id: String(parsed?.part?.id || "").trim(),
								text: streamedText.trim(),
								raw: parsed,
							});
						}
						continue;
					}
					await options?.onEvent?.({
						type: "local_exec.event",
						event: parsed,
					});
				}
			};
			let diagnosticSuffix = (stderr = "", output = "") => {
				let advertised = options?.advertisedTools && typeof options.advertisedTools == "object"
					? options.advertisedTools
					: {};
				let names = Array.isArray(advertised?.names)
					? advertised.names.map((entry) => String(entry || "").trim()).filter(Boolean)
					: [];
				let stderrSnippet = String(stderr || "").replace(/\s+/g, " ").trim().slice(0, 600);
				let outputSnippet = String(output || "").replace(/\s+/g, " ").trim().slice(0, 600);
				let parts = [
					`model=${model || "OpenCode default"}`,
					`advertised_tools=${Number(advertised?.count || names.length || 0) || 0}`,
				];
				if (names.length) {
					parts.push(`tool_names=${names.join(",")}`);
				}
				if (stderrSnippet) {
					parts.push(`stderr=${stderrSnippet}`);
				}
				if (outputSnippet) {
					parts.push(`stdout=${outputSnippet}`);
				}
				return parts.join("; ");
			};
			try {
				let completed = false;
				let exitCode = -1;
				let processError = null;
				let emitted = "";
				let processPromise = this._runShellCommandAsync(commandText, {
					timeoutMs,
					signal: options?.signal || null,
				}).then((code) => {
					exitCode = Number(code || 0) || 0;
					completed = true;
				}).catch((error) => {
					processError = error;
					completed = true;
				});
				let processCurrentOutput = async (flush = false) => {
					let outputText = await this._readFileText(outputPath).catch(() => "");
					if (outputText.length <= emitted.length) {
						if (flush) {
							await processOutputChunk("", true);
						}
						return outputText;
					}
					let delta = outputText.slice(emitted.length);
					emitted = outputText;
					await processOutputChunk(delta, flush);
					return outputText;
				};
				while (!completed) {
					await processCurrentOutput(false);
					await Zotero.Promise.delay(120);
				}
				await processPromise.catch(() => {});
				let output = await processCurrentOutput(true);
				let stderr = await this._readFileText(errorPath).catch(() => "");
				if (processError) {
					throw processError;
				}
				if (exitCode === -15 || exitCode === 143) {
					let error = new Error("OpenCode process aborted.");
					error.name = "AbortError";
					throw error;
				}
				if (exitCode !== 0) {
					throw new Error(`OpenCode executor failed with exit code ${exitCode}. ${diagnosticSuffix(stderr, output)}`.trim());
				}
				let text = String(streamedText || "").trim();
				if (!text) {
					throw new Error(`OpenCode executor returned no output. ${diagnosticSuffix(stderr, output)}`.trim());
				}
				return {
					text,
					responseID: "",
					usage,
				};
			}
			finally {
				await this._removeIfExists(promptPath);
				await this._removeIfExists(configPath);
				await this._removeIfExists(outputPath);
				await this._removeIfExists(errorPath);
			}
		},

		_localExecJSONEventLines(state, chunk = "") {
			let nextState = state && typeof state == "object"
				? state
				: { buffer: "" };
			nextState.buffer = `${String(nextState.buffer || "")}${String(chunk || "")}`;
			let lines = nextState.buffer.split(/\r?\n/);
			nextState.buffer = lines.pop() || "";
			return {
				state: nextState,
				lines,
			};
		},

		_parseLocalExecJSONEvent(line = "") {
			let text = String(line || "").trim();
			if (!text) {
				return null;
			}
			try {
				let parsed = JSON.parse(text);
				return parsed && typeof parsed == "object" ? parsed : null;
			}
			catch (_error) {
				return null;
			}
		},

		async _runLocalExecTextStream(roleID, role, promptText, options = {}) {
			let executor = this._localExecExecutor(role);
			if (!executor?.installed || !executor?.binary_path) {
				throw new Error(`${roleID} local executor is not installed.`);
			}
			if (String(executor?.id || "").trim() == "opencode") {
				return await this._runOpenCodeExecTextStream(roleID, role, executor, promptText, options);
			}
			let tempRoot = this._joinPath(this._configRoot(), "local-exec");
			await this._ensureDirectory(tempRoot);
			let token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			let promptPath = this._joinPath(tempRoot, `${roleID}-${token}.prompt.txt`);
			let streamPath = this._joinPath(tempRoot, `${roleID}-${token}.stream.txt`);
			let outputPath = this._joinPath(tempRoot, `${roleID}-${token}.output.txt`);
			let errorPath = this._joinPath(tempRoot, `${roleID}-${token}.stderr.txt`);
			let schema = options.outputSchema && typeof options.outputSchema == "object"
				? options.outputSchema
				: null;
			let schemaPath = schema ? this._joinPath(tempRoot, `${roleID}-${token}.schema.json`) : "";
			let cwd = String(options.cwd || "").trim() || tempRoot;
			await this._writeTextFile(promptPath, String(promptText || ""));
			if (schemaPath) {
				await this._writeJSONFile(schemaPath, schema);
			}
			let rawArgs = Array.isArray(executor.args) ? executor.args.slice() : [];
			let structuredStream = String(executor?.id || "").trim() == "codex";
			let skipNextValue = false;
			let args = rawArgs.filter((entry) => {
				if (skipNextValue) {
					skipNextValue = false;
					return false;
				}
				let value = String(entry || "").trim();
				if (!value) {
					return false;
				}
				if (["--json", "--output-schema", "--output-last-message", "-o"].includes(value)) {
					if (["--output-schema", "--output-last-message", "-o"].includes(value)) {
						skipNextValue = true;
					}
					return false;
				}
				return true;
			});
			let hasArg = (flag) => args.some((entry) => String(entry || "").trim() == flag);
			let hasDisableFeature = (feature) => {
				for (let index = 0; index < args.length; index += 1) {
					if (String(args[index] || "").trim() != "--disable") {
						continue;
					}
					if (String(args[index + 1] || "").trim() == String(feature || "").trim()) {
						return true;
					}
				}
				return false;
			};
			let isCodexExecutor = String(executor?.id || "").trim() == "codex";
			let reasoningEffort = this._normalizeLocalExecReasoningEffort(options?.reasoningEffort || "", executor);
			let hasReasoningOverride = this._localExecHasConfigOverride(args, "model_reasoning_effort");
			let reasoningConfigValue = this._isWindowsPlatform()
				? `model_reasoning_effort=${reasoningEffort}`
				: `model_reasoning_effort="${reasoningEffort}"`;
			let cmdParts = [
				...(this._isWindowsPlatform() ? [] : ["exec"]),
				this._shellQuote(executor.binary_path),
				...args.map((entry) => this._shellQuote(entry)),
				...(reasoningEffort && !hasReasoningOverride ? ["-c", this._shellQuote(reasoningConfigValue)] : []),
				...(isCodexExecutor && !hasDisableFeature("shell_tool") ? ["--disable", "shell_tool"] : []),
				...(isCodexExecutor && !hasDisableFeature("plugins") ? ["--disable", "plugins"] : []),
				...(isCodexExecutor && !hasDisableFeature("shell_snapshot") ? ["--disable", "shell_snapshot"] : []),
				...(structuredStream && !hasArg("--json") ? ["--json"] : []),
				...(hasArg("--dangerously-bypass-approvals-and-sandbox") ? [] : ["--dangerously-bypass-approvals-and-sandbox"]),
				...(hasArg("--skip-git-repo-check") ? [] : ["--skip-git-repo-check"]),
				...(hasArg("--ephemeral") ? [] : ["--ephemeral"]),
				"-C",
				this._shellQuote(cwd),
				...(schemaPath ? ["--output-schema", this._shellQuote(schemaPath)] : []),
				...(schemaPath ? ["-o", this._shellQuote(outputPath)] : []),
				"-",
				"<",
				this._shellQuote(promptPath),
				">",
				this._shellQuote(streamPath),
				"2>",
				this._shellQuote(errorPath),
			];
			let timeoutMs = Math.max(
				30000,
				Number(options.timeoutMs || role.timeout_ms || 120000) || 120000
			);
			let completed = false;
			let exitCode = -1;
			let processError = null;
			let processPromise = this._runShellCommandAsync(cmdParts.join(" "), {
				timeoutMs,
				signal: options?.signal || null,
			}).then((code) => {
				exitCode = code;
				completed = true;
			}).catch((error) => {
				processError = error;
				completed = true;
			});
			let emitted = "";
			let streamedText = "";
			let processedStructuredLines = 0;
			let processOutput = async (output, allowTrailingPartialLine = false) => {
				let outputText = String(output || "");
				if (outputText.length <= emitted.length) {
					return;
				}
				let previousText = emitted;
				emitted = outputText;
				if (!structuredStream) {
					let delta = outputText.startsWith(previousText)
						? outputText.slice(previousText.length)
						: outputText;
					streamedText = emitted;
					await options?.onDelta?.(delta, emitted);
					return;
				}
				let normalized = outputText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
				let lines = normalized.split("\n");
				if (lines.length && lines[lines.length - 1] === "") {
					lines.pop();
				}
				else if (!allowTrailingPartialLine) {
					lines.pop();
				}
				if (lines.length <= processedStructuredLines) {
					return;
				}
				for (let line of lines.slice(processedStructuredLines)) {
					let parsed = this._parseLocalExecJSONEvent(line);
					if (!parsed) {
						continue;
					}
					let type = String(parsed?.type || "").trim();
					if (!type) {
						continue;
					}
					let item = parsed?.item && typeof parsed.item == "object" ? parsed.item : {};
					let itemType = String(item?.type || "").trim();
					if (type == "item.completed" && itemType == "agent_message") {
						let nextText = String(item?.text || "").trim();
						if (nextText) {
							streamedText = nextText;
							await options?.onEvent?.({
								type: "local_exec.agent_message",
								item_id: String(item?.id || "").trim(),
								text: nextText,
								raw: parsed,
							});
						}
						continue;
					}
					if (type == "item.started" && itemType == "command_execution") {
						await options?.onEvent?.({
							type: "local_exec.command.started",
							item_id: String(item?.id || "").trim(),
							command: String(item?.command || "").trim(),
							raw: parsed,
						});
						continue;
					}
					if (type == "item.completed" && itemType == "command_execution") {
						await options?.onEvent?.({
							type: "local_exec.command.completed",
							item_id: String(item?.id || "").trim(),
							command: String(item?.command || "").trim(),
							output: String(item?.aggregated_output || ""),
							exit_code: Number(item?.exit_code || 0) || 0,
							raw: parsed,
						});
						continue;
					}
					await options?.onEvent?.({
						type: "local_exec.event",
						event: parsed,
					});
				}
				processedStructuredLines = lines.length;
			};
			try {
				while (!completed) {
					let output = await this._readFileText(streamPath).catch(() => "");
					await processOutput(output, false);
					await Zotero.Promise.delay(120);
				}
				await processPromise.catch(() => {});
				let output = await this._readFileText(streamPath).catch(() => "");
				await processOutput(output, true);
				let stderr = await this._readFileText(errorPath).catch(() => "");
				if (processError) {
					throw processError;
				}
				if (exitCode !== 0) {
					throw new Error(`Local executor failed with exit code ${exitCode}.${stderr ? ` ${stderr.trim()}` : ""}`.trim());
				}
				let structuredOutput = schemaPath
					? await this._readFileText(outputPath).catch(() => "")
					: "";
				let text = structuredStream
					? String(schemaPath ? structuredOutput : streamedText || "").trim()
					: String(output || "").trim();
				if (!text) {
					throw new Error(`Local executor returned no output.${stderr ? ` ${stderr.trim()}` : ""}`.trim());
				}
				return {
					text,
					responseID: "",
				};
			}
			finally {
				await this._removeIfExists(promptPath);
				await this._removeIfExists(streamPath);
				await this._removeIfExists(outputPath);
				await this._removeIfExists(errorPath);
				await this._removeIfExists(schemaPath);
			}
		},

		async getPreferencePanePayload() {
			let settings = await this._globalSettings();
			let bootstrapStatus = typeof SystematicReviewerBootstrapOptionalBundles != "undefined"
				? SystematicReviewerBootstrapOptionalBundles
				: {};
			let privilegedStatus = typeof SystematicReviewerPrivilegedTools != "undefined"
				? (SystematicReviewerPrivilegedTools?.getStatus?.(this) || {})
				: {
					loaded: false,
					shell_loaded: false,
					shell_namespace_available: false,
					browser_loaded: false,
					browser_namespace_available: false,
				};
			privilegedStatus = Object.assign({}, privilegedStatus, {
				dev_tools_loaded: bootstrapStatus?.dev_tools_loaded === true,
				dev_tools_bundle_present: bootstrapStatus?.dev_tools_bundle_present !== false,
			});
				return {
					theme: this._themeClassForWindow(this._primaryWindow?.()) == "theme-dark" ? "dark" : "light",
					settings: {
						runtime_roles: settings.runtime_roles,
						runtime_preferences: settings.runtime_preferences,
						api_connections: settings.api_connections,
						ai_endpoints: settings.ai_endpoints,
						pdf_markdown: settings.pdf_markdown,
						editor: settings.editor || this._defaultEditorSettings(),
						agent_runtime_catalog: settings.agent_runtime_catalog,
						openalex_api_key: settings.openalex_api_key || "",
						server_security: settings.server_security || this._defaultServerSecuritySettings(),
					privileged_tools: settings.privileged_tools || this._defaultPrivilegedToolSettings(),
					mcp_clients: settings.mcp_clients || this._defaultMCPClientSettings(),
				},
			projects: await this._listStoredProjects(),
				server_status: {
					app: SystematicReviewerWorkflowServer?.getStatus?.() || {},
					mcp: SystematicReviewerMCPServer?.getStatus?.() || {},
					mcp_clients: SystematicReviewerMCPClient?.getStatus?.(this) || {},
				},
				privileged_status: privilegedStatus,
				defaults: {
					runtime_roles: this._defaultRuntimeRoles(),
					runtime_preferences: this._defaultRuntimePreferences(),
						api_connections: [],
						ai_endpoints: this._defaultAIEndpointSettings(),
						pdf_markdown: this._defaultPdfMarkdownRuntimeSettings(),
						editor: this._defaultEditorSettings(),
						agent_runtime_catalog: this._defaultAgentRuntimeCatalog(),
						openalex_api_key: "",
					server_security: this._defaultServerSecuritySettings(),
					privileged_tools: this._defaultPrivilegedToolSettings(),
					mcp_clients: this._defaultMCPClientSettings(),
				},
			detected_executors: this._scanInstalledExecutors(settings.runtime_preferences),
		};
	},


























};
