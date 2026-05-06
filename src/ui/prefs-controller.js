var HTML_NS = "http://www.w3.org/1999/xhtml";

var ENGINE_ROLES = [
	{
		id: "session_chat",
		label: "Agent Model",
		help: "Default model for chat, planning, tools, and report writing.",
	},
	{
		id: "data_extraction",
		label: "Data Extraction",
		help: "Default model for extraction and per-paper analysis.",
	},
	{
		id: "pdf_vlm",
		label: "PDF Conversion",
		help: "Pick the PDF mode and the vision model used when a mode needs vision.",
	},
	{
		id: "embeddings",
		label: "Embeddings",
		help: "Default model for semantic search.",
	},
];

var RUNTIME_TYPE_OPTIONS = {
	local_api: "Responses endpoint",
	external_api: "Responses endpoint",
	local_exec: "Installed CLI Runtime",
};

var PROTOCOL_OPTIONS = {
	responses: "Responses API",
	chat_completions: "Chat Completions API",
};

var PDF_MODE_OPTIONS = {
	fast: "Fast PDF",
	vlm: "PDF VLM only",
	fast_with_vlm_fallback: "Fast PDF + VLM fallback",
};

var OPENRESEARCHTOOLS_MODEL_EXAMPLES = {
	session_chat: {
		note: "Example local agent models:",
		links: [
			{
				label: "openresearchtools/Qwen3.6-35B-A3B-GGUF",
				href: "https://huggingface.co/openresearchtools/Qwen3.6-35B-A3B-GGUF",
			},
			{
				label: "openresearchtools/Qwen3.6-27B-GGUF",
				href: "https://huggingface.co/openresearchtools/Qwen3.6-27B-GGUF",
			},
		],
	},
	data_extraction: {
		note: "For complex extraction, use the Agent Model suggestions. For straightforward extraction that does not need enhanced thinking, these instruct variants are examples:",
		links: [
			{
				label: "openresearchtools/Qwen3.6-27B-instruct-GGUF",
				href: "https://huggingface.co/openresearchtools/Qwen3.6-27B-instruct-GGUF/tree/main",
			},
			{
				label: "openresearchtools/Qwen3.6-35B-A3B-Instruct-GGUF",
				href: "https://huggingface.co/openresearchtools/Qwen3.6-35B-A3B-Instruct-GGUF",
			},
		],
	},
	pdf_vlm: {
		note: "Example PDF/VLM model:",
		links: [
			{
				label: "openresearchtools/Qwen3.5-4B-Instruct-GGUF",
				href: "https://huggingface.co/openresearchtools/Qwen3.5-4B-Instruct-GGUF",
			},
		],
	},
	embeddings: {
		note: "Example embeddings model:",
		links: [
			{
				label: "openresearchtools/Qwen3-Embedding-8B-GGUF",
				href: "https://huggingface.co/openresearchtools/Qwen3-Embedding-8B-GGUF",
			},
		],
	},
};

var TAB_ORDER = ["runtime", "harvest", "editorPreview", "projects", "servers", "privileged", "about"];
var TAB_LABELS = {
	runtime: "Runtime",
	harvest: "Harvest",
	editorPreview: "Editor/Preview",
	projects: "Projects",
	servers: "MCP Servers",
	privileged: "Privileged Tools",
	about: "About",
};

var ABOUT_DOCUMENTS = {
	license: {
		title: "Systematic Reviewer License",
		file: "LICENSE",
		url: "/systematic-reviewer/workflow/about/license.txt",
	},
	thirdPartyNotices: {
		title: "Third-Party Notices",
		file: "licenses/THIRD_PARTY_NOTICES.txt",
		url: "/systematic-reviewer/workflow/about/third-party-notices.txt",
	},
	thirdPartyLicenses: {
		title: "Third-Party Licenses",
		file: "licenses/LICENSES.txt",
		url: "/systematic-reviewer/workflow/about/third-party-licenses.txt",
	},
};

function createInitialState() {
	return {
		dirty: false,
		loading: false,
		saving: false,
		scanning: false,
		changeGeneration: 0,
		autosaveBlockedGeneration: 0,
		testingRole: "",
		roleTestResults: {},
			activeTab: "runtime",
			activeHint: "",
			theme: "light",
			editor: { preview_page_theme: "light" },
			runtimeRoles: {},
		roleEditors: {},
		runtimePreferences: {},
		pdfMarkdown: {},
		openAlexApiKey: "",
		serverSecurity: { mcp_enabled: false, mcp_api_key: "" },
		privilegedTools: { shell_enabled: false, browser_enabled: false, default_timeout_ms: 300000, dev_tools_enabled: false },
		mcpClients: { servers: [] },
		mcpClientTestResults: {},
		mcpImportOpen: false,
		mcpImportText: "",
		mcpImportError: "",
		serverStatus: { app: {}, mcp: {} },
		privilegedStatus: {
			loaded: false,
			shell_loaded: false,
			shell_namespace_available: false,
			browser_loaded: false,
			browser_namespace_available: false,
			dev_tools_loaded: false,
			dev_tools_bundle_present: true,
		},
		privilegedConfirmDialog: null,
		apiConnections: [],
		projects: [],
		projectDeleteDialog: null,
		aboutVersion: "",
		aboutDocument: null,
		reconcilingProjectID: "",
		scanResults: [],
		scanErrors: [],
		detectedExecutors: [],
		defaults: {},
		appliedPrivilegedTools: { shell_enabled: false, browser_enabled: false, default_timeout_ms: 300000, dev_tools_enabled: false },
	};
}

var SystematicReviewerSharedSettingsControllerPrototype = {
	root: null,
	started: false,
	observer: null,
	autosaveTimer: null,
	options: null,
	state: null,
	els: null,

	init(rootNode = null) {
		let root = rootNode?.currentTarget || rootNode?.target || rootNode || this._getRoot();
		if (!root) {
			return;
		}
		if (this.started && this.root == root) {
			return;
		}
		this.root = root;
		this.started = true;
		this._ensureShell(root);
		if (this.observer) {
			try {
				this.observer.disconnect();
			}
			catch (_err) {}
			this.observer = null;
		}
		this._bind(root);
		this.refresh().catch((error) => this._reportError(error));
	},

	_getRoot() {
		try {
			return window?.document?.getElementById("systematic-reviewer-preferences") || null;
		}
		catch (_err) {
			return null;
		}
	},

	_doc() {
		return this.root?.ownerDocument || window?.document || null;
	},

	_service() {
		return this.options?.service || null;
	},

	_usesExternalChrome() {
		return String(this.options?.chromeMode || "").trim() == "external";
	},

	_ensureShell(root) {
		if (!root || root.querySelector(".sr-pref-root")) {
			return;
		}
		let externalChrome = this._usesExternalChrome();
		root.replaceChildren(this._node("div", {
			className: "sr-pref-root",
			children: [
				...(
					externalChrome
						? []
						: [
							this._node("div", {
								className: "sr-pref-toolbar",
								children: [
										this._node("button", {
											textContent: "Reload",
											attrs: { id: "sr-pref-reload", type: "button" },
									}),
									this._node("button", {
										textContent: "Save",
										attrs: { id: "sr-pref-save", type: "button" },
									}),
									this._node("div", {
										className: "sr-pref-status",
										textContent: "Loading settings...",
										attrs: { id: "sr-pref-status" },
									}),
								],
							}),
							this._node("div", {
								className: "sr-pref-tabs",
								children: [
										this._node("button", {
											className: "sr-pref-tab is-active",
											textContent: "Runtime",
											attrs: { id: "sr-pref-tab-runtime", type: "button" },
										}),
											this._node("button", {
												className: "sr-pref-tab",
												textContent: "Harvest",
												attrs: { id: "sr-pref-tab-harvest", type: "button" },
											}),
											this._node("button", {
												className: "sr-pref-tab",
												textContent: "Editor/Preview",
												attrs: { id: "sr-pref-tab-editor-preview", type: "button" },
											}),
											this._node("button", {
												className: "sr-pref-tab",
												textContent: "Projects",
										attrs: { id: "sr-pref-tab-projects", type: "button" },
									}),
									this._node("button", {
										className: "sr-pref-tab",
										textContent: "MCP Servers",
										attrs: { id: "sr-pref-tab-servers", type: "button" },
									}),
										this._node("button", {
											className: "sr-pref-tab",
											textContent: "Privileged Tools",
											attrs: { id: "sr-pref-tab-privileged", type: "button" },
										}),
										this._node("button", {
											className: "sr-pref-tab",
											textContent: "About",
											attrs: { id: "sr-pref-tab-about", type: "button" },
										}),
									],
								}),
						]
				),
					this._node("div", {
						className: "sr-pref-panel is-active",
						attrs: { id: "sr-pref-panel-runtime" },
						children: [
							this._node("div", {
								className: "sr-pref-runtime-layout",
								children: [
									this._node("div", {
										className: "sr-pref-stack sr-pref-runtime-left",
										attrs: { id: "sr-pref-runtime-options" },
										children: [
											this._node("div", { className: "sr-pref-empty", textContent: "Loading runtime settings..." }),
										],
									}),
									this._node("div", {
										className: "sr-pref-runtime-right",
										children: [
											this._node("div", {
												className: "sr-pref-stack",
												attrs: { id: "sr-pref-main-engine" },
												children: [
													this._node("div", { className: "sr-pref-empty", textContent: "Loading Agent Model settings..." }),
												],
											}),
											this._node("div", {
												className: "sr-pref-stack",
												attrs: { id: "sr-pref-extraction-engine" },
												children: [
													this._node("div", { className: "sr-pref-empty", textContent: "Loading Data Extraction settings..." }),
												],
											}),
											this._node("div", {
												className: "sr-pref-stack",
												attrs: { id: "sr-pref-pdf-engine" },
												children: [
													this._node("div", { className: "sr-pref-empty", textContent: "Loading PDF settings..." }),
												],
											}),
											this._node("div", {
												className: "sr-pref-stack",
												attrs: { id: "sr-pref-embeddings-engine" },
												children: [
													this._node("div", { className: "sr-pref-empty", textContent: "Loading Embeddings settings..." }),
												],
											}),
										],
									}),
								],
							}),
						],
					}),
						this._node("div", {
							className: "sr-pref-panel",
							attrs: { id: "sr-pref-panel-harvest" },
						children: [
							this._node("div", {
								className: "sr-pref-stack",
								attrs: { id: "sr-pref-harvest-options" },
								children: [
									this._node("div", { className: "sr-pref-empty", textContent: "Loading Harvest settings..." }),
								],
							}),
							],
						}),
						this._node("div", {
							className: "sr-pref-panel",
							attrs: { id: "sr-pref-panel-editor-preview" },
							children: [
								this._node("div", {
									className: "sr-pref-stack",
									attrs: { id: "sr-pref-editor-preview-options" },
									children: [
										this._node("div", { className: "sr-pref-empty", textContent: "Loading Editor/Preview settings..." }),
									],
								}),
							],
						}),
						this._node("div", {
						className: "sr-pref-panel",
						attrs: { id: "sr-pref-panel-projects" },
					children: [
						this._node("section", {
							className: "sr-pref-card",
							children: [
								this._node("div", {
									className: "sr-pref-card-head",
									children: [
										this._cardTitleWithHint("Projects", "Project actions", "projects-panel-actions", {
											headingTag: "h2",
											hintContent: this._projectsHintContent(),
										}),
										this._node("p", { textContent: "Review stored Systematic Review and Custom Analysis projects, open their folders, queue a per-project reconcile job, or delete them." }),
									],
								}),
								this._node("div", {
									className: "sr-pref-stack",
									attrs: { id: "sr-pref-projects-list" },
									children: [
										this._node("div", { className: "sr-pref-empty", textContent: "Loading project list..." }),
									],
								}),
							],
						}),
					],
				}),
				this._node("div", {
					className: "sr-pref-panel",
					attrs: { id: "sr-pref-panel-servers" },
					children: [
						this._node("div", {
							className: "sr-pref-stack",
							attrs: { id: "sr-pref-servers-options" },
							children: [
								this._node("div", { className: "sr-pref-empty", textContent: "Loading server settings..." }),
							],
						}),
					],
				}),
					this._node("div", {
						className: "sr-pref-panel",
						attrs: { id: "sr-pref-panel-privileged" },
						children: [
							this._node("div", {
							className: "sr-pref-stack",
							attrs: { id: "sr-pref-privileged-options" },
							children: [
								this._node("div", { className: "sr-pref-empty", textContent: "Loading privileged tool settings..." }),
							],
							}),
						],
					}),
					this._node("div", {
						className: "sr-pref-panel",
						attrs: { id: "sr-pref-panel-about" },
						children: [
							this._node("div", {
								className: "sr-pref-stack",
								attrs: { id: "sr-pref-about-options" },
								children: [
									this._node("div", { className: "sr-pref-empty", textContent: "Loading About settings..." }),
								],
							}),
						],
					}),
				],
			}));
		},

	_bind(root) {
		let contentRoot = root.querySelector(".sr-pref-root") || root;
			this.els = {
				status: contentRoot.querySelector("#sr-pref-status"),
				save: contentRoot.querySelector("#sr-pref-save"),
				reload: contentRoot.querySelector("#sr-pref-reload"),
					scan: contentRoot.querySelector("#sr-pref-scan"),
					tabRuntime: contentRoot.querySelector("#sr-pref-tab-runtime"),
					tabHarvest: contentRoot.querySelector("#sr-pref-tab-harvest"),
					tabEditorPreview: contentRoot.querySelector("#sr-pref-tab-editor-preview"),
					tabProjects: contentRoot.querySelector("#sr-pref-tab-projects"),
					tabServers: contentRoot.querySelector("#sr-pref-tab-servers"),
					tabPrivileged: contentRoot.querySelector("#sr-pref-tab-privileged"),
					tabAbout: contentRoot.querySelector("#sr-pref-tab-about"),
					panelRuntime: contentRoot.querySelector("#sr-pref-panel-runtime"),
					panelHarvest: contentRoot.querySelector("#sr-pref-panel-harvest"),
					panelEditorPreview: contentRoot.querySelector("#sr-pref-panel-editor-preview"),
					panelProjects: contentRoot.querySelector("#sr-pref-panel-projects"),
					panelServers: contentRoot.querySelector("#sr-pref-panel-servers"),
					panelPrivileged: contentRoot.querySelector("#sr-pref-panel-privileged"),
					panelAbout: contentRoot.querySelector("#sr-pref-panel-about"),
					runtimeOptions: contentRoot.querySelector("#sr-pref-runtime-options"),
					harvestOptions: contentRoot.querySelector("#sr-pref-harvest-options"),
					editorPreviewOptions: contentRoot.querySelector("#sr-pref-editor-preview-options"),
					serversOptions: contentRoot.querySelector("#sr-pref-servers-options"),
				privilegedOptions: contentRoot.querySelector("#sr-pref-privileged-options"),
				aboutOptions: contentRoot.querySelector("#sr-pref-about-options"),
			connectionList: contentRoot.querySelector("#sr-pref-connection-list"),
			executorList: contentRoot.querySelector("#sr-pref-executor-list"),
			scanMeta: contentRoot.querySelector("#sr-pref-scan-meta"),
			scanResults: contentRoot.querySelector("#sr-pref-scan-results"),
			mainEngine: contentRoot.querySelector("#sr-pref-main-engine"),
			extractionEngine: contentRoot.querySelector("#sr-pref-extraction-engine"),
			pdfEngine: contentRoot.querySelector("#sr-pref-pdf-engine"),
			embeddingsEngine: contentRoot.querySelector("#sr-pref-embeddings-engine"),
			projectsList: contentRoot.querySelector("#sr-pref-projects-list"),
		};

		this.els.save?.addEventListener("click", () => this.save());
			this.els.reload?.addEventListener("click", () => this.refresh());
				this.els.scan?.addEventListener("click", () => this.scan());
				this.els.tabRuntime?.addEventListener("click", () => this._setActiveTab("runtime"));
				this.els.tabHarvest?.addEventListener("click", () => this._setActiveTab("harvest"));
				this.els.tabEditorPreview?.addEventListener("click", () => this._setActiveTab("editorPreview"));
				this.els.tabProjects?.addEventListener("click", () => this._setActiveTab("projects"));
			this.els.tabServers?.addEventListener("click", () => this._setActiveTab("servers"));
			this.els.tabPrivileged?.addEventListener("click", () => this._setActiveTab("privileged"));
			this.els.tabAbout?.addEventListener("click", () => this._setActiveTab("about"));
		contentRoot.addEventListener("click", (event) => this._onDelegatedClick(event));
		contentRoot.addEventListener("change", (event) => this._onDelegatedChange(event));
		contentRoot.addEventListener("input", (event) => this._onDelegatedInput(event));
		contentRoot.addEventListener("focusout", () => this._onDelegatedFocusOut());
		this._renderToolbarState();
		this._renderTabs();
	},

	_reportError(error) {
		try {
			this.options?.logError?.(error);
		}
		catch (_err) {
			try {
				console.error(error);
			}
			catch (_consoleErr) {}
		}
		this._setStatus(error?.message || String(error), "error");
	},

	_markDirty(flag) {
		if (flag) {
			this.state.changeGeneration = (Number(this.state.changeGeneration || 0) || 0) + 1;
			this.state.autosaveBlockedGeneration = 0;
		}
		else {
			this.state.autosaveBlockedGeneration = 0;
		}
		this.state.dirty = !!flag;
		this._renderToolbarState();
		if (flag) {
			this._scheduleAutosave();
		}
	},

	_autosaveDelayMs() {
		return 1600;
	},

	_scheduleAutosave() {
		if (this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole) {
			return;
		}
		if (this._isAutosaveBlockedByFocusedEditor()) {
			return;
		}
		if (this._hasIncompleteAPIRoleSelections()) {
			return;
		}
		if ((Number(this.state.autosaveBlockedGeneration || 0) || 0) == (Number(this.state.changeGeneration || 0) || 0)) {
			return;
		}
		if (this.autosaveTimer) {
			clearTimeout(this.autosaveTimer);
		}
		this.autosaveTimer = setTimeout(() => {
			this.autosaveTimer = null;
			if (
				this.state.dirty &&
					!this.state.loading &&
					!this.state.saving &&
					!this.state.scanning &&
					!this.state.testingRole &&
					!this._isAutosaveBlockedByFocusedEditor() &&
					!this._hasIncompleteAPIRoleSelections() &&
					(Number(this.state.autosaveBlockedGeneration || 0) || 0) != (Number(this.state.changeGeneration || 0) || 0)
				) {
					this.save({ auto: true }).catch((error) => this._reportError(error));
				}
		}, this._autosaveDelayMs());
	},

	_renderToolbarState() {
		if (this.els.save) {
			this.els.save.disabled = this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole || !this.state.dirty;
		}
		if (this.els.reload) {
			this.els.reload.disabled = this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole;
		}
			if (this.els.scan) {
				this.els.scan.disabled = this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole;
			}
			let scanDisabled = this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole;
			let contentRoot = this.root?.querySelector?.(".sr-pref-root") || this.root;
			contentRoot?.querySelectorAll?.("button[data-action='scan-runtimes']").forEach((button) => {
				button.disabled = scanDisabled;
			});
			this._notifyChromeChange();
		},

	_notifyChromeChange() {
		try {
			this.options?.onChromeChange?.(this.getChromeState());
		}
		catch (_err) {}
	},

	_setStatus(message, tone = "") {
		if (!this.els.status) {
			try {
				this.options?.onStatus?.(String(message || ""), tone);
			}
			catch (_err) {}
			return;
		}
		this.els.status.textContent = String(message || "");
		this.els.status.classList.remove("ready", "error");
		if (tone) {
			this.els.status.classList.add(tone);
		}
		try {
			this.options?.onStatus?.(String(message || ""), tone);
		}
		catch (_err) {}
	},

	_clone(value) {
		return JSON.parse(JSON.stringify(value));
	},

	_formatTimeoutMinutes(timeoutMs, fallbackMs = 1200000) {
		let value = Number(timeoutMs || 0);
		let safeMs = Number.isFinite(value) && value > 0 ? value : fallbackMs;
		let minutes = Math.max(1, Math.round(safeMs / 60000));
		return String(minutes);
	},

	_builtinReasoningEffortOptions() {
		return ["none", "minimal", "low", "medium", "high", "xhigh"];
	},

	_normalizeReasoningEffort(value = "", allowCustom = true) {
		let normalized = String(value || "").trim().toLowerCase();
		if (!normalized || normalized == "default") {
			return "";
		}
		if (this._builtinReasoningEffortOptions().includes(normalized)) {
			return normalized;
		}
		return allowCustom ? normalized : "";
	},

	_reasoningSelectValue(value = "") {
		let normalized = this._normalizeReasoningEffort(value, true);
		return !normalized || this._builtinReasoningEffortOptions().includes(normalized)
			? normalized
			: "__custom__";
	},

	_reasoningOptionList() {
		return [
			{ value: "", label: "Default" },
			{ value: "none", label: "None" },
			{ value: "minimal", label: "Minimal" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
			{ value: "xhigh", label: "XHigh" },
			{ value: "__custom__", label: "Custom..." },
		];
	},

		_reasoningHint() {
			return "Default sends no reasoning field at all. Built-in options send an explicit reasoning effort token. Different models and providers support different values or none at all. If you are unsure, leave this on Default.";
		},

		_normalizePreviewEditorPageTheme(value = "") {
			return String(value || "").trim().toLowerCase() == "dark" ? "dark" : "light";
		},

		_editorPreviewPageTheme() {
			return this._normalizePreviewEditorPageTheme(this.state.editor?.preview_page_theme);
		},

		_availableTabs() {
			let theme = String(this.state.theme || "").trim().toLowerCase();
			return theme == "dark" ? TAB_ORDER.slice() : TAB_ORDER.filter((tabID) => tabID != "editorPreview");
		},

		_setEditorPreviewPageTheme(value = "light") {
			this.state.editor = Object.assign({}, this.state.editor || {}, {
				preview_page_theme: this._normalizePreviewEditorPageTheme(value),
			});
			this._markDirty(true);
			this._renderAll();
		},

		_isTypingControl(node) {
		if (!node || typeof node.closest != "function") {
			return false;
		}
		let field = node.closest("input, textarea, [contenteditable='true']");
		if (!field) {
			return false;
		}
		if (field.matches("textarea, [contenteditable='true']")) {
			return true;
		}
		let type = String(field.getAttribute("type") || field.type || "text").trim().toLowerCase();
		return ["", "text", "password", "url", "number", "search", "email"].includes(type);
	},

	_isAutosaveBlockedByFocusedEditor() {
		let doc = this._doc();
		let active = doc?.activeElement || null;
		return !!active && this.root?.contains(active) && this._isTypingControl(active);
	},

	_commitFocusedConnectionField() {
		let doc = this._doc();
		let target = doc?.activeElement || null;
		if (!target || !this.root?.contains(target) || target?.dataset?.connectionIndex == null || !target?.dataset?.field) {
			return;
		}
		let index = Number(target.dataset.connectionIndex || -1);
		let field = String(target.dataset.field || "");
		let connection = this.state.apiConnections?.[index];
		if (!connection) {
			return;
		}
		let rawValue = target.type == "checkbox" ? !!target.checked : target.value;
		let nextValue = field == "base_url"
			? this._normalizeURL(rawValue)
			: field == "api_key"
				? String(rawValue || "").trim()
				: String(rawValue || "").trim();
		let currentValue = field == "base_url"
			? this._normalizeURL(connection.base_url || "")
			: field == "api_key"
				? String(connection.api_key || "").trim()
				: String(connection?.[field] || "").trim();
		if (nextValue == currentValue) {
			return;
		}
		this._updateConnectionField(index, field, rawValue, false);
	},

	_hasIncompleteAPIRoleSelections() {
		for (let roleDef of ENGINE_ROLES) {
			let role = this.state.runtimeRoles?.[roleDef.id];
			if (this._roleHasIncompleteAPIPair(roleDef.id, role)) {
				return true;
			}
			for (let preset of Array.isArray(role?.model_presets) ? role.model_presets : []) {
				if (this._roleHasIncompleteAPIPair(roleDef.id, preset)) {
					return true;
				}
			}
		}
		return false;
	},

	_roleHasIncompleteAPIPair(roleID, role) {
		let entry = role && typeof role == "object" ? role : null;
		if (!entry) {
			return false;
		}
		if (roleID == "data_extraction" && this.state.runtimePreferences?.use_agent_model_for_data_extraction) {
			return false;
		}
		if (roleID == "pdf_vlm" && String(this.state.pdfSettings?.mode || "").trim() == "fast") {
			return false;
		}
		let runtimeType = String(entry.runtime_type || "").trim();
		if (!["local_api", "external_api"].includes(runtimeType)) {
			return false;
		}
		let hasConnection = !!String(entry.connection_id || "").trim();
		let hasModel = !!String(entry.model || "").trim();
		return hasConnection !== hasModel;
	},

	_onDelegatedFocusOut() {
		let doc = this._doc();
		let active = doc?.activeElement || null;
		if (active && this.root?.contains(active) && this._isTypingControl(active)) {
			return;
		}
		if (this.state.dirty) {
			this._scheduleAutosave();
		}
	},

		_applyPayload(payload) {
			let settings = payload?.settings || {};
			let defaults = payload?.defaults || {};
			this.state.defaults = this._clone(defaults || {});
			this.state.theme = String(payload?.theme || "").trim().toLowerCase() == "dark" ? "dark" : "light";
			this.state.editor = Object.assign(
				{ preview_page_theme: "light" },
				defaults?.editor || {},
				settings?.editor || {}
			);
			this.state.editor.preview_page_theme = this._normalizePreviewEditorPageTheme(this.state.editor.preview_page_theme);
			if (!this._availableTabs().includes(this.state.activeTab)) {
				this.state.activeTab = "runtime";
			}
			let runtimeRoles = {};
		for (let role of ENGINE_ROLES) {
			runtimeRoles[role.id] = Object.assign({}, defaults?.runtime_roles?.[role.id] || {}, settings?.runtime_roles?.[role.id] || {});
		}
		this.state.runtimeRoles = runtimeRoles;
		this.state.roleEditors = {};
		this.state.runtimePreferences = Object.assign(
			{ use_agent_model_for_data_extraction: true, saved_executor_ids: [], executor_model_cache: {} },
			defaults?.runtime_preferences || {},
			settings?.runtime_preferences || {}
		);
		this.state.runtimePreferences.executor_model_cache = this._clone(this.state.runtimePreferences.executor_model_cache || {});
		let savedExecutorIDs = new Set(
			Array.isArray(this.state.runtimePreferences?.saved_executor_ids)
				? this.state.runtimePreferences.saved_executor_ids.map((value) => String(value || "").trim()).filter(Boolean)
				: []
		);
		for (let role of Object.values(runtimeRoles || {})) {
			if (role?.runtime_type == "local_exec" && role?.executor_id) {
				savedExecutorIDs.add(String(role.executor_id || "").trim());
			}
		}
		this.state.runtimePreferences.saved_executor_ids = Array.from(savedExecutorIDs);
		this.state.pdfMarkdown = Object.assign({}, defaults?.pdf_markdown || {}, settings?.pdf_markdown || {});
		this.state.openAlexApiKey = String(settings?.openalex_api_key || defaults?.openalex_api_key || "").trim();
		this.state.serverSecurity = Object.assign(
			{ mcp_enabled: false, mcp_api_key: "" },
			defaults?.server_security || {},
			settings?.server_security || {}
		);
		this.state.privilegedTools = Object.assign(
			{ shell_enabled: false, browser_enabled: false, default_timeout_ms: 300000, dev_tools_enabled: false },
			defaults?.privileged_tools || {},
			settings?.privileged_tools || {}
		);
		this.state.mcpClients = this._normalizeMCPClientsState(Object.assign(
			{ servers: [] },
			defaults?.mcp_clients || {},
			settings?.mcp_clients || {}
		));
		this.state.mcpClientTestResults = {};
		this.state.appliedPrivilegedTools = this._clone(this.state.privilegedTools);
		this.state.serverStatus = this._clone(payload?.server_status || { app: {}, mcp: {} });
		this.state.privilegedStatus = this._clone(payload?.privileged_status || {
			loaded: false,
			shell_loaded: false,
			shell_namespace_available: false,
			browser_loaded: false,
			browser_namespace_available: false,
			dev_tools_loaded: false,
			dev_tools_bundle_present: true,
		});
		this.state.apiConnections = Array.isArray(settings.api_connections) ? this._clone(settings.api_connections) : [];
		this.state.projects = Array.isArray(payload?.projects) ? this._clone(payload.projects) : [];
		this.state.projectDeleteDialog = null;
		this.state.privilegedConfirmDialog = null;
		this.state.reconcilingProjectID = "";
		this.state.testingRole = "";
		this.state.roleTestResults = {};
		this.state.scanErrors = [];
		this.state.detectedExecutors = Array.isArray(payload?.detected_executors)
			? this._clone(payload.detected_executors).filter((entry) => entry.installed)
			: [];
		this._syncRolesWithConnections();
		this._syncRoleEditors(false);
		this._renderAll();
		this._markDirty(false);
	},

	_collectSettings() {
		let runtimeRoles = this._clone(this.state.runtimeRoles);
		let runtimePreferences = this._clone(this.state.runtimePreferences);
		let pdfMarkdown = this._clone(this.state.pdfMarkdown);
		let apiConnections = this._clone(this.state.apiConnections).filter((connection) =>
			!!this._normalizeURL(connection?.base_url || "")
		);
		return {
			runtime_roles: runtimeRoles,
			runtime_preferences: runtimePreferences,
				pdf_markdown: pdfMarkdown,
				editor: this._clone(this.state.editor || { preview_page_theme: "light" }),
				openalex_api_key: String(this.state.openAlexApiKey || "").trim(),
			server_security: this._clone(this.state.serverSecurity || { mcp_enabled: false, mcp_api_key: "" }),
			privileged_tools: this._clone(this.state.privilegedTools || { shell_enabled: false, browser_enabled: false, default_timeout_ms: 300000, dev_tools_enabled: false }),
			mcp_clients: this._normalizeMCPClientsState(this.state.mcpClients || { servers: [] }),
			api_connections: apiConnections,
		};
	},

	_draftConnections() {
		return this._clone(this.state.apiConnections).filter((connection) =>
			!this._normalizeURL(connection?.base_url || "")
		);
	},

	_restoreDraftConnections(drafts = []) {
		let source = Array.isArray(drafts) ? drafts : [];
		if (!source.length) {
			return;
		}
		let existingIDs = new Set((this.state.apiConnections || []).map((connection) => String(connection?.id || "").trim()).filter(Boolean));
		let changed = false;
		for (let entry of source) {
			let draft = Object.assign({}, entry || {});
			let currentID = String(draft.id || "").trim();
			if (!currentID || existingIDs.has(currentID)) {
				draft.id = this._nextConnectionID();
				currentID = String(draft.id || "").trim();
			}
			existingIDs.add(currentID);
			this.state.apiConnections.push(draft);
			changed = true;
		}
		if (changed) {
			this._renderAll();
			this._renderToolbarState();
		}
	},

	async refresh() {
		let service = this._service();
		if (!service?.getPreferencePanePayload) {
			throw new Error("Systematic Reviewer preference service is not available");
		}
		this.state.loading = true;
		this._renderToolbarState();
		this._setStatus("Loading settings.");
		try {
			let payload = await service.getPreferencePanePayload();
			this._applyPayload(payload);
				await this._autoScanOnLoad();
			this._setStatus("Settings loaded.", "ready");
		}
		finally {
			this.state.loading = false;
			this._renderToolbarState();
		}
	},

	async _autoScanOnLoad() {
		let service = this._service();
		if (!service?.scanPreferencePaneEndpoints) {
			return;
		}
		try {
			let payload = await service.scanPreferencePaneEndpoints(this._collectSettings());
			this.state.scanResults = Array.isArray(payload?.api_results) ? this._clone(payload.api_results) : [];
			this.state.scanErrors = Array.isArray(payload?.api_errors) ? this._clone(payload.api_errors) : [];
			if (payload?.runtime_preferences?.executor_model_cache) {
				this.state.runtimePreferences.executor_model_cache = this._clone(payload.runtime_preferences.executor_model_cache || {});
			}
			this.state.detectedExecutors = Array.isArray(payload?.detected_executors)
				? this._clone(payload.detected_executors).filter((entry) => entry.installed)
				: [];
			this._syncConnectionsFromScanResults(this.state.scanResults);
			this._syncRoleEditors(true);
			this._renderAll();
		}
		catch (error) {
			try {
				this.options?.logError?.(error);
			}
			catch (_err) {
				try {
					console.error(error);
				}
				catch (_consoleErr) {}
			}
		}
	},

	async save(options = {}) {
		let service = this._service();
		if (!service?.savePreferencePaneSettings) {
			throw new Error("Systematic Reviewer preference service is not available");
		}
		this._commitFocusedConnectionField();
		let auto = options?.auto === true;
		let draftConnections = this._draftConnections();
		let saveGeneration = Number(this.state.changeGeneration || 0) || 0;
		let privilegedRestartRequired = this._privilegedRestartRequired();
		this.state.saving = true;
		this._renderToolbarState();
		this._setStatus("Saving settings.");
		try {
			let payload = await service.savePreferencePaneSettings(this._collectSettings());
			this.state.autosaveBlockedGeneration = 0;
			let currentGeneration = Number(this.state.changeGeneration || 0) || 0;
			let hasNewerChanges = currentGeneration != saveGeneration;
			if (!hasNewerChanges) {
				if (!(auto && this._isAutosaveBlockedByFocusedEditor())) {
					this._applyPayload(payload);
					this._restoreDraftConnections(draftConnections);
				}
				else {
					this.state.dirty = false;
				}
				this._setStatus(
					privilegedRestartRequired
						? "Settings saved. Fully close and reopen Zotero to apply privileged tool loading changes."
						: "Settings saved.",
					"ready"
				);
			}
			else {
				this._setStatus(
					privilegedRestartRequired
						? "Settings saved. Fully close and reopen Zotero to apply privileged tool loading changes. More changes are still pending."
						: "Settings saved. More changes are still pending.",
					"ready"
				);
			}
		}
		catch (error) {
			let currentGeneration = Number(this.state.changeGeneration || 0) || 0;
			if (auto && currentGeneration == saveGeneration) {
				this.state.autosaveBlockedGeneration = saveGeneration;
				try {
					this.options?.logError?.(error);
				}
				catch (_err) {
					try {
						console.error(error);
					}
					catch (_consoleErr) {}
				}
				this._setStatus(error?.message || String(error), "error");
			}
			else {
				this._reportError(error);
			}
		}
		finally {
			this.state.saving = false;
			this._renderToolbarState();
		}
	},

	async scan() {
		let service = this._service();
		if (!service?.scanPreferencePaneEndpoints) {
			throw new Error("Systematic Reviewer preference service is not available");
		}
		this._commitFocusedConnectionField();
		this.state.scanning = true;
		this._renderToolbarState();
		this._setStatus("Scanning local runtimes.");
		try {
			let payload = await service.scanPreferencePaneEndpoints(Object.assign({}, this._collectSettings(), {
				include_executor_models: true,
			}));
			this.state.scanResults = Array.isArray(payload?.api_results) ? this._clone(payload.api_results) : [];
			this.state.scanErrors = Array.isArray(payload?.api_errors) ? this._clone(payload.api_errors) : [];
			let previousRuntimePreferences = JSON.stringify(this.state.runtimePreferences?.executor_model_cache || {});
			if (payload?.runtime_preferences?.executor_model_cache) {
				this.state.runtimePreferences.executor_model_cache = this._clone(payload.runtime_preferences.executor_model_cache || {});
			}
			this.state.detectedExecutors = Array.isArray(payload?.detected_executors)
				? this._clone(payload.detected_executors).filter((entry) => entry.installed)
				: [];
			this._syncConnectionsFromScanResults(this.state.scanResults);
			this._syncRoleEditors(true);
			this._renderAll();
			if (previousRuntimePreferences != JSON.stringify(this.state.runtimePreferences?.executor_model_cache || {})) {
				this._markDirty(true);
			}
			this._setStatus(
				`Found ${this.state.scanResults.length} model API${this.state.scanResults.length == 1 ? "" : "s"} and ${this.state.detectedExecutors.length} installed CLI runtime${this.state.detectedExecutors.length == 1 ? "" : "s"}.`,
				"ready"
			);
		}
		catch (error) {
			this._reportError(error);
		}
		finally {
			this.state.scanning = false;
			this._renderToolbarState();
			if (this.state.dirty) {
				this._scheduleAutosave();
			}
		}
	},

		setActiveSection(tabID) {
			this._setActiveTab(tabID);
			return this.getChromeState();
		},

		setPreviewPageTheme(theme = "light") {
			this.state.editor = Object.assign({}, this.state.editor || {}, {
				preview_page_theme: this._normalizePreviewEditorPageTheme(theme),
			});
			this._renderEditorPreviewPanel();
			return this.state.editor.preview_page_theme;
		},

		getChromeState() {
			let refreshDisabled = this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole;
			let tabs = this._availableTabs();
			return {
					active_tab: this.state.activeTab,
					tabs: tabs.map((tabID) => ({
						id: tabID,
						label: TAB_LABELS[tabID] || tabID,
					})),
			refresh_disabled: refreshDisabled,
			scan_disabled: refreshDisabled,
			save_disabled: refreshDisabled || !this.state.dirty,
		};
	},

		_setActiveTab(tabID) {
			let tabs = this._availableTabs();
			let next = tabs.includes(tabID) ? tabID : "runtime";
			this.state.activeTab = next;
			this._renderTabs();
		},

		_renderTabs() {
			let tabs = this._availableTabs();
			if (!tabs.includes(this.state.activeTab)) {
				this.state.activeTab = tabs.includes("runtime") ? "runtime" : (tabs[0] || "runtime");
			}
			let available = new Set(tabs);
			for (let tabID of TAB_ORDER) {
				let isAvailable = available.has(tabID);
				let active = isAvailable && this.state.activeTab == tabID;
				let tabKey = `tab${tabID.charAt(0).toUpperCase()}${tabID.slice(1)}`;
				let panelKey = `panel${tabID.charAt(0).toUpperCase()}${tabID.slice(1)}`;
				if (this.els[tabKey]) {
					this.els[tabKey].hidden = !isAvailable;
				}
				if (this.els[panelKey]) {
					this.els[panelKey].hidden = !isAvailable;
				}
				this.els[tabKey]?.classList.toggle("is-active", active);
				this.els[panelKey]?.classList.toggle("is-active", active);
			}
		this._notifyChromeChange();
	},

		_onDelegatedClick(event) {
			let link = event.target?.closest?.("a[href]");
			if (link) {
				let href = String(link.getAttribute("href") || link.href || "").trim();
			if (href) {
				event.preventDefault();
				event.stopPropagation();
				Promise.resolve(this._openURL(href)).catch((error) => this._reportError(error));
			}
			return;
		}
			let button = event.target?.closest?.("button[data-action]");
			if (!button) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			let action = String(button.dataset.action || "");
			if (action == "scan-runtimes") {
				this.scan().catch((error) => this._reportError(error));
				return;
			}
			if (action == "remove-connection") {
			this._removeConnection(Number(button.dataset.connectionIndex || -1));
			return;
		}
		if (action == "add-connection") {
			this._addConnection();
			return;
		}
		if (action == "add-discovered-connection") {
			this._addDiscoveredConnection(Number(button.dataset.resultIndex || -1));
			return;
		}
		if (action == "add-saved-executor") {
			this._addSavedExecutor(String(button.dataset.executorId || ""));
			this._setStatus("Added detected CLI runtime.", "ready");
			return;
		}
		if (action == "remove-saved-executor") {
			this._removeSavedExecutor(String(button.dataset.executorId || ""));
			this._setStatus("Removed saved CLI runtime.", "ready");
			return;
		}
		if (action == "apply-scan-model") {
			this._applyScanModel(Number(button.dataset.resultIndex || -1), String(button.dataset.modelId || ""), String(button.dataset.role || ""));
			return;
		}
		if (action == "apply-executor") {
			this._applyExecutor(String(button.dataset.executorId || ""), String(button.dataset.role || ""));
			return;
		}
	if (action == "add-role-preset") {
		this._addRolePreset(String(button.dataset.role || ""));
		return;
	}
	if (action == "remove-role-preset") {
		this._removeRolePreset(String(button.dataset.role || ""), String(button.dataset.presetId || ""));
		return;
	}
	if (action == "about-open-document") {
		this._openAboutDocument(String(button.dataset.aboutDocument || "")).catch((error) => this._reportError(error));
		return;
	}
	if (action == "about-close-document") {
		this.state.aboutDocument = null;
		this._renderAboutPanel();
		return;
	}
	if (action == "about-copy-document") {
		this._copyAboutDocument().catch((error) => this._reportError(error));
		return;
	}
		if (action == "toggle-hint") {
			let hintID = String(button.dataset.hintId || "");
			this.state.activeHint = this.state.activeHint == hintID ? "" : hintID;
			this._renderAll();
				return;
			}
			if (action == "set-preview-page-theme") {
				this._setEditorPreviewPageTheme(button.dataset.previewPageTheme || "light");
				return;
			}
			if (action == "test-role") {
			this.testRole(String(button.dataset.role || "")).catch((error) => this._reportError(error));
			return;
		}
		if (action == "project-open-folder") {
			this._openProjectFolder(String(button.dataset.projectId || "")).catch((error) => this._reportError(error));
			return;
		}
		if (action == "project-open") {
			this._openProject(String(button.dataset.projectId || "")).catch((error) => this._reportError(error));
			return;
		}
		if (action == "project-reconcile") {
			this._reconcileProject(String(button.dataset.projectId || "")).catch((error) => this._reportError(error));
			return;
		}
		if (action == "project-delete-prompt") {
			this._openProjectDeleteDialog(String(button.dataset.projectId || ""));
			return;
		}
		if (action == "project-delete-cancel") {
			this._closeProjectDeleteDialog();
			return;
		}
		if (action == "project-delete-confirm") {
			this._confirmProjectDelete().catch((error) => this._reportError(error));
			return;
		}
		if (action == "privileged-confirm-cancel") {
			this._closePrivilegedConfirmDialog();
			return;
		}
		if (action == "privileged-confirm-enable") {
			this._confirmPrivilegedToolEnable({ restartNow: false }).catch((error) => this._reportError(error));
			return;
		}
		if (action == "privileged-confirm-enable-restart") {
			this._confirmPrivilegedToolEnable({ restartNow: true }).catch((error) => this._reportError(error));
			return;
		}
		if (action == "privileged-confirm-disable-later") {
			this._confirmPrivilegedToolDisable({ restartNow: false }).catch((error) => this._reportError(error));
			return;
		}
		if (action == "privileged-confirm-disable-restart") {
			this._confirmPrivilegedToolDisable({ restartNow: true }).catch((error) => this._reportError(error));
			return;
		}
		if (action == "generate-mcp-key") {
			this._setServerSecurityField("mcp_api_key", this._generateSecurityKey(), true);
			this._setStatus("Generated a new MCP API key.", "ready");
			return;
		}
		if (action == "clear-mcp-key") {
			this._setServerSecurityField("mcp_api_key", "", true);
			this._setStatus("Cleared the MCP API key.", "ready");
			return;
		}
		if (action == "copy-mcp-key") {
			this._copyTextToClipboard(String(this.state.serverSecurity?.mcp_api_key || "").trim(), "MCP API key copied.").catch((error) => this._reportError(error));
			return;
		}
		if (action == "copy-mcp-endpoint") {
			this._copyTextToClipboard(String(this.state.serverStatus?.mcp?.base_url || "").trim(), "MCP endpoint copied.").catch((error) => this._reportError(error));
			return;
		}
		if (action == "copy-mcp-json") {
			this._copySystematicReviewerMCPJSON().catch((error) => this._reportError(error));
			return;
		}
		if (action == "add-mcp-client") {
			this._addMCPClient();
			return;
		}
		if (action == "show-mcp-import") {
			this.state.mcpImportOpen = true;
			this.state.mcpImportError = "";
			this._renderAll();
			return;
		}
		if (action == "cancel-mcp-import") {
			this.state.mcpImportOpen = false;
			this.state.mcpImportText = "";
			this.state.mcpImportError = "";
			this._renderAll();
			return;
		}
		if (action == "import-mcp-json") {
			this._importMCPJSON();
			return;
		}
		if (action == "remove-mcp-client") {
			this._removeMCPClient(Number(button.dataset.mcpClientIndex || -1));
			return;
		}
		if (action == "test-mcp-client") {
			this._testMCPClient(Number(button.dataset.mcpClientIndex || -1)).catch((error) => this._reportError(error));
			return;
		}
		if (action == "add-mcp-client-array") {
			this._addMCPClientArrayEntry(Number(button.dataset.mcpClientIndex || -1), String(button.dataset.arrayField || ""));
			return;
		}
		if (action == "remove-mcp-client-array") {
			this._removeMCPClientArrayEntry(Number(button.dataset.mcpClientIndex || -1), String(button.dataset.arrayField || ""), Number(button.dataset.arrayIndex || -1));
			return;
		}
	},

	_onDelegatedChange(event) {
		let target = event.target;
		if (target?.dataset?.privilegedConfirmField) {
			this._updatePrivilegedConfirmDialog(String(target.dataset.privilegedConfirmField || ""), target.type == "checkbox" ? !!target.checked : target.value);
			return;
		}
		if (target?.dataset?.generalSetting) {
			this._updateGeneralSettingFromTarget(target, true);
			return;
		}
		if (target?.dataset?.runtimePref) {
			this._updateRuntimePreference(String(target.dataset.runtimePref || ""), target.type == "checkbox" ? !!target.checked : target.value, true);
			return;
		}
		if (target?.dataset?.role && target?.dataset?.field) {
			let value = target.type == "checkbox" ? !!target.checked : target.value;
			this._updateRoleField(String(target.dataset.role || ""), String(target.dataset.field || ""), value, true, String(target.dataset.presetId || "default"));
			return;
		}
		if (target?.dataset?.pdfSetting) {
			this._updatePdfSetting(String(target.dataset.pdfSetting || ""), target.value, true);
			return;
		}
		if (target?.dataset?.connectionIndex != null && target?.dataset?.field) {
			this._updateConnectionField(Number(target.dataset.connectionIndex || -1), String(target.dataset.field || ""), target.value, true);
			return;
		}
		if (target?.dataset?.mcpClientIndex != null) {
			if (target?.dataset?.arrayField) {
				this._updateMCPClientArrayEntry(
					Number(target.dataset.mcpClientIndex || -1),
					String(target.dataset.arrayField || ""),
					Number(target.dataset.arrayIndex || -1),
					String(target.dataset.arrayKey || ""),
					target.type == "checkbox" ? !!target.checked : target.value,
					true
				);
				return;
			}
			if (target?.dataset?.field) {
				this._updateMCPClientField(
					Number(target.dataset.mcpClientIndex || -1),
					String(target.dataset.field || ""),
					target.type == "checkbox" ? !!target.checked : target.value,
					true
				);
				return;
			}
		}
		if (target?.dataset?.mcpImportJson != null) {
			this.state.mcpImportText = String(target.value || "");
			this.state.mcpImportError = "";
			return;
		}
		if (target?.dataset?.projectDeleteField == "delete_collection") {
			this._updateProjectDeleteDialog(!!target.checked);
		}
	},

	_onDelegatedInput(event) {
		let target = event.target;
		if (target?.dataset?.privilegedConfirmField) {
			this._updatePrivilegedConfirmDialog(String(target.dataset.privilegedConfirmField || ""), target.type == "checkbox" ? !!target.checked : target.value);
			return;
		}
		if (target?.dataset?.generalSetting) {
			if (target.type == "checkbox") {
				return;
			}
			this._updateGeneralSettingFromTarget(target, false);
			return;
		}
		if (target?.dataset?.runtimePref) {
			this._updateRuntimePreference(String(target.dataset.runtimePref || ""), target.type == "checkbox" ? !!target.checked : target.value, false);
			return;
		}
		if (target?.dataset?.role && target?.dataset?.field) {
			this._updateRoleField(String(target.dataset.role || ""), String(target.dataset.field || ""), target.value, false, String(target.dataset.presetId || "default"));
			return;
		}
		if (target?.dataset?.pdfSetting) {
			this._updatePdfSetting(String(target.dataset.pdfSetting || ""), target.value, false);
			return;
		}
		if (target?.dataset?.connectionIndex != null && target?.dataset?.field) {
			this._updateConnectionField(Number(target.dataset.connectionIndex || -1), String(target.dataset.field || ""), target.value, false);
			return;
		}
		if (target?.dataset?.mcpClientIndex != null) {
			if (target?.dataset?.arrayField) {
				this._updateMCPClientArrayEntry(
					Number(target.dataset.mcpClientIndex || -1),
					String(target.dataset.arrayField || ""),
					Number(target.dataset.arrayIndex || -1),
					String(target.dataset.arrayKey || ""),
					target.type == "checkbox" ? !!target.checked : target.value,
					false
				);
				return;
			}
			if (target?.dataset?.field) {
				this._updateMCPClientField(
					Number(target.dataset.mcpClientIndex || -1),
					String(target.dataset.field || ""),
					target.type == "checkbox" ? !!target.checked : target.value,
					false
				);
				return;
			}
		}
		if (target?.dataset?.mcpImportJson != null) {
			this.state.mcpImportText = String(target.value || "");
			this.state.mcpImportError = "";
			return;
		}
	},

	_updateGeneralSettingFromTarget(target, shouldRender) {
		let field = String(target?.dataset?.generalSetting || "").trim();
		let value = target?.type == "checkbox" ? !!target.checked : target?.value;
		if (target?.type == "checkbox" && this._isPrivilegedConfirmationField(field)) {
			let currentlyEnabled = this._privilegedToolFieldEnabled(field);
			if (value === true && !currentlyEnabled) {
				this._openPrivilegedConfirmDialog(field, "enable");
				return;
			}
			if (value === false && currentlyEnabled) {
				this._openPrivilegedConfirmDialog(field, "disable");
				return;
			}
		}
		this._updateGeneralSetting(field, value, shouldRender);
	},

	_updateRoleField(roleID, field, value, shouldRender, presetID = "default") {
		let role = this._rolePreset(roleID, presetID);
		let editor = this._roleEditor(roleID, presetID);
		if (!role) {
			return;
		}
		this._clearRoleTestResult(roleID);
		if (field == "runtime_choice") {
			let choice = String(value || "").trim();
			if (choice.startsWith("exec:")) {
				let executorID = choice.slice(5).trim();
				role.runtime_type = "local_exec";
				role.executor_id = executorID;
				role.connection_id = "";
				role.model = "";
				role.reasoning_effort = "";
				role.api_kind = "responses";
				if (editor) {
					editor.model_mode = "select";
					editor.reasoning_mode = "";
					editor.custom_reasoning = "";
				}
				this._addSavedExecutor(executorID);
			}
			else if (choice.startsWith("api:")) {
				let connectionID = choice.slice(4).trim();
				let connection = this._findConnection(connectionID);
				if (String(role.connection_id || "").trim() != connectionID) {
					role.model = "";
				}
				role.executor_id = "";
				role.connection_id = connectionID;
				role.runtime_type = connection?.runtime_type || "local_api";
				role.api_kind = "responses";
				if (connection && !this._modelsForRoleConnection(roleID, connection).length) {
					this._scanConfiguredRuntimeModels({
						connectionID,
						statusMessage: `Loading models from ${connection.label || connection.base_url || "selected runtime"}.`,
					}).catch((error) => this._reportError(error));
				}
			}
			else {
				role.executor_id = "";
				role.connection_id = "";
				role.model = "";
				role.runtime_type = "local_api";
				role.api_kind = "responses";
			}
		}
		else if (field == "manual_model") {
			if (editor) {
				editor.manual_model = String(value || "");
				editor.model_mode = "manual";
				role.model = String(value || "").trim();
			}
		}
		else if (field == "model_choice") {
			let selectedRuntimeChoice = this._runtimeChoiceForRole(roleID, role);
			let selectedRuntime = this._runtimeChoicesForRole(roleID).find((entry) => entry.key == selectedRuntimeChoice) || null;
			if (editor) {
				if (String(value || "") == "__manual__") {
					editor.model_mode = "manual";
					role.model = String(editor.manual_model || role.model || "").trim();
				}
				else {
					editor.model_mode = "select";
					role.model = String(value || "").trim();
				}
			}
			else {
				role.model = String(value || "").trim();
			}
			if (selectedRuntime?.kind == "exec" && this._executorIsOpenCode(selectedRuntime.executor)) {
				let model = this._openCodeModelForRole(roleID, role, selectedRuntime.executor);
				this._applyOpenCodeModelDefaults(roleID, role, model);
				if (editor) {
					editor.reasoning_mode = "";
					editor.custom_reasoning = "";
				}
			}
		}
		else if (field == "detected_model") {
			role.model = String(value || "").trim();
		}
		else if (field == "timeout_ms") {
			let raw = String(value ?? "").trim();
			if (!raw) {
				if (shouldRender && !(Number(role.timeout_ms || 0) > 0)) {
					role.timeout_ms = 1200000;
				}
			}
			else {
				let timeoutMinutes = Number(raw);
				if (Number.isFinite(timeoutMinutes) && timeoutMinutes > 0) {
					role.timeout_ms = Math.max(60000, Math.round(timeoutMinutes) * 60000);
				}
				else if (shouldRender) {
					role.timeout_ms = 1200000;
				}
			}
		}
		else if (field == "label") {
			role.label = String(value || "");
		}
		else if (field == "legacy_chat_completions") {
			role.api_kind = value ? "chat_completions" : "responses";
		}
		else if (field == "state_mode") {
			role.state_mode = String(value || "").trim() == "stateful" ? "stateful" : "stateless";
		}
		else if (field == "parallel_requests") {
			let next = Math.round(Number(value || 0));
			role.parallel_requests = roleID == "embeddings"
				? 0
				: (Number.isFinite(next) && next > 0 ? next : Math.max(1, Number(role.parallel_requests || 1) || 1));
		}
		else if (field == "independent_resources") {
			role.independent_resources = String(value || "").trim() == "yes";
		}
		else if (field == "context_window") {
			let next = Math.round(Number(value || 0));
			role.context_window = roleID == "embeddings"
				? 0
				: (Number.isFinite(next) && next > 0 ? next : role.context_window);
		}
		else if (field == "max_output_tokens") {
			let next = Math.round(Number(value || 0));
			if (roleID == "embeddings") {
				role.max_output_tokens = 0;
			}
			else {
				role.max_output_tokens = Number.isFinite(next) && next > 0 ? next : role.max_output_tokens;
			}
		}
		else if (field == "reasoning_effort_choice") {
			let nextMode = String(value || "").trim();
			let selectedRuntimeChoice = this._runtimeChoiceForRole(roleID, role);
			let selectedRuntime = this._runtimeChoicesForRole(roleID).find((entry) => entry.key == selectedRuntimeChoice) || null;
			let isOpenCode = selectedRuntime?.kind == "exec" && this._executorIsOpenCode(selectedRuntime.executor);
			let selectedOpenCodeModel = isOpenCode
				? this._openCodeModelForRole(roleID, role, selectedRuntime.executor)
				: null;
			let normalizedMode = isOpenCode
				? (this._openCodeReasoningOptions(selectedOpenCodeModel).includes(nextMode) ? nextMode : "")
				: (nextMode == "__custom__"
					? "__custom__"
					: this._normalizeReasoningEffort(nextMode, false));
			if (editor) {
				editor.reasoning_mode = normalizedMode;
			}
			role.reasoning_effort = !isOpenCode && normalizedMode == "__custom__"
				? this._normalizeReasoningEffort(editor?.custom_reasoning || "", true)
				: normalizedMode;
		}
		else if (field == "reasoning_effort_custom") {
			let normalized = this._normalizeReasoningEffort(value, true);
			if (editor) {
				editor.reasoning_mode = "__custom__";
				editor.custom_reasoning = normalized;
			}
			role.reasoning_effort = normalized;
		}
		else if (field == "embeddings_batch_size") {
			let next = Math.round(Number(value || 0));
			role.embeddings_batch_size = Number.isFinite(next) && next > 0 ? next : role.embeddings_batch_size;
		}
		else {
			role[field] = String(value || "").trim();
		}
		this._syncRolesWithConnections();
		this._syncRoleEditors(true);
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
	},

	_updatePdfSetting(field, value, shouldRender) {
		this._clearRoleTestResult("pdf_vlm");
		if (field == "mode") {
			this.state.pdfMarkdown.mode = String(value || "").trim();
		}
		else {
			this.state.pdfMarkdown[field] = String(value || "").trim();
		}
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
	},

	_updateGeneralSetting(field, value, shouldRender) {
		if (field == "openalex_api_key") {
			this.state.openAlexApiKey = String(value || "").trim();
			this._markDirty(true);
			if (shouldRender) {
				this._renderAll();
			}
			return;
		}
		if (field == "mcp_enabled" || field == "mcp_api_key") {
			this._setServerSecurityField(field, value, shouldRender);
			return;
		}
		if (field == "shell_enabled" || field == "browser_enabled" || field == "default_timeout_ms" || field == "dev_tools_enabled") {
			this._setPrivilegedToolsField(field, value, shouldRender);
			return;
		}
	},

	_setServerSecurityField(field, value, shouldRender) {
		if (!this.state.serverSecurity) {
			this.state.serverSecurity = { mcp_enabled: false, mcp_api_key: "" };
		}
		if (field == "mcp_enabled") {
			this.state.serverSecurity.mcp_enabled = !!value;
		}
		else if (field == "mcp_api_key") {
			this.state.serverSecurity.mcp_api_key = String(value || "").trim();
		}
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
	},

	_setPrivilegedToolsField(field, value, shouldRender) {
		if (!this.state.privilegedTools) {
			this.state.privilegedTools = { shell_enabled: false, browser_enabled: false, default_timeout_ms: 300000, dev_tools_enabled: false };
		}
		if (field == "shell_enabled") {
			this.state.privilegedTools.shell_enabled = !!value;
		}
		else if (field == "browser_enabled") {
			this.state.privilegedTools.browser_enabled = !!value;
		}
		else if (field == "dev_tools_enabled") {
			this.state.privilegedTools.dev_tools_enabled = !!value;
		}
		else if (field == "default_timeout_ms") {
			let raw = String(value ?? "").trim();
			if (!raw) {
				this.state.privilegedTools.default_timeout_ms = 300000;
			}
			else {
				let next = Math.round(Number(raw) || 0);
				this.state.privilegedTools.default_timeout_ms = Number.isFinite(next) && next > 0
					? Math.max(1, Math.min(60, next)) * 60000
					: 300000;
			}
		}
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
	},

	_isPrivilegedConfirmationField(field = "") {
		return field == "shell_enabled" || field == "browser_enabled" || field == "dev_tools_enabled";
	},

	_privilegedToolFieldEnabled(field = "") {
		if (field == "shell_enabled") {
			return this.state.privilegedTools?.shell_enabled === true;
		}
		if (field == "browser_enabled") {
			return this.state.privilegedTools?.browser_enabled === true;
		}
		if (field == "dev_tools_enabled") {
			return this.state.privilegedTools?.dev_tools_enabled === true;
		}
		return false;
	},

	_openPrivilegedConfirmDialog(field = "", mode = "enable") {
		let info = this._privilegedToolInfo(field);
		if (!info) {
			return;
		}
		this.state.privilegedConfirmDialog = {
			field,
			mode: mode == "disable" ? "disable" : "enable",
			accepted: false,
		};
		this._renderAll();
	},

	_closePrivilegedConfirmDialog() {
		this.state.privilegedConfirmDialog = null;
		this._renderAll();
	},

	_updatePrivilegedConfirmDialog(field = "", value = false) {
		if (!this.state.privilegedConfirmDialog) {
			return;
		}
		if (field == "accepted") {
			this.state.privilegedConfirmDialog.accepted = !!value;
			this._renderAll();
		}
	},

	async _confirmPrivilegedToolEnable(options = {}) {
		let dialog = this.state.privilegedConfirmDialog || null;
		let field = String(dialog?.field || "").trim();
		let info = this._privilegedToolInfo(field);
		if (!info || dialog?.mode == "disable" || !dialog?.accepted) {
			return;
		}
		this.state.privilegedConfirmDialog = null;
		this._setPrivilegedToolsField(field, true, false);
		if (options?.restartNow === true) {
			await this._saveSettingsAndRestartZotero();
			return;
		}
		this._renderAll();
		this._setStatus(`${info.shortLabel} enabled in settings. Save and fully close and reopen Zotero to load it.`, "ready");
	},

	async _confirmPrivilegedToolDisable(options = {}) {
		let dialog = this.state.privilegedConfirmDialog || null;
		let field = String(dialog?.field || "").trim();
		let info = this._privilegedToolInfo(field);
		if (!info || dialog?.mode != "disable") {
			return;
		}
		this.state.privilegedConfirmDialog = null;
		this._setPrivilegedToolsField(field, false, false);
		if (options?.restartNow === true) {
			await this._saveSettingsAndRestartZotero();
			return;
		}
		this._renderAll();
		this._setStatus(`${info.shortLabel} disabled in settings. Fully close and reopen Zotero to unload it.`, "ready");
	},

	async _saveSettingsAndRestartZotero() {
		let service = this._service();
		if (!service?.savePreferencePaneSettings || !service?.restartZotero) {
			throw new Error("Systematic Reviewer restart service is not available.");
		}
		let draftConnections = this._draftConnections();
		this.state.saving = true;
		this._renderToolbarState();
		this._setStatus("Saving settings before restarting Zotero.");
		try {
			let payload = await service.savePreferencePaneSettings(this._collectSettings());
			this._applyPayload(payload);
			this._restoreDraftConnections(draftConnections);
			this._setStatus("Restarting Zotero to load restart-gated tools.", "ready");
			await service.restartZotero();
		}
		finally {
			this.state.saving = false;
			this._renderToolbarState();
		}
	},

	_normalizeMCPClientID(value = "", fallback = "mcp_server") {
		let raw = String(value || fallback || "mcp_server").trim();
		let normalized = raw
			.toLowerCase()
			.replace(/[^a-z0-9_.-]+/g, "_")
			.replace(/^_+|_+$/g, "");
		return normalized || fallback || "mcp_server";
	},

	_newMCPClient() {
		let index = (this.state.mcpClients?.servers || []).length + 1;
		return {
			enabled: false,
			server_id: this._normalizeMCPClientID(`mcp_server_${index}`),
			label: `MCP Server ${index}`,
			transport: "stdio",
			request_timeout_ms: 120000,
			startup_timeout_ms: 30000,
			command: "",
			args: [],
			cwd_mode: "project_root",
			cwd: "",
			env: [],
			env_passthrough: [],
			url: "",
			bearer_token_env: "",
			headers: [],
			headers_from_env: [],
		};
	},

	_normalizeMCPClientsState(raw = {}) {
		let source = raw && typeof raw == "object" ? raw : {};
		let servers = Array.isArray(source.servers) ? source.servers : [];
		let seen = new Set();
		return {
			servers: servers.map((entry, index) => {
				let server = Object.assign({}, this._newMCPClient(), entry || {});
				server.enabled = server.enabled === true;
				server.transport = String(server.transport || "").trim() == "streamable_http" ? "streamable_http" : "stdio";
				server.label = String(server.label || server.name || server.server_id || `MCP Server ${index + 1}`).trim();
				let baseID = this._normalizeMCPClientID(server.server_id || server.id || server.label || `mcp_server_${index + 1}`, `mcp_server_${index + 1}`);
				let nextID = baseID;
				let suffix = 2;
				while (seen.has(nextID)) {
					nextID = `${baseID}_${suffix}`;
					suffix += 1;
				}
				seen.add(nextID);
				server.server_id = nextID;
				server.request_timeout_ms = this._timeoutSecondsToMs(Math.max(1, Math.round(Number(server.request_timeout_ms || 120000) / 1000) || 120), 120000);
				server.startup_timeout_ms = this._timeoutSecondsToMs(Math.max(1, Math.round(Number(server.startup_timeout_ms || 30000) / 1000) || 30), 30000);
				server.args = Array.isArray(server.args) ? server.args.map((value) => String(value || "")) : [];
				server.env = Array.isArray(server.env) ? server.env.map((row) => ({ key: String(row?.key || ""), value: String(row?.value || "") })) : [];
				server.env_passthrough = Array.isArray(server.env_passthrough) ? server.env_passthrough.map((value) => String(value || "")) : [];
				server.headers = Array.isArray(server.headers) ? server.headers.map((row) => ({ key: String(row?.key || ""), value: String(row?.value || "") })) : [];
				server.headers_from_env = Array.isArray(server.headers_from_env) ? server.headers_from_env.map((row) => ({ key: String(row?.key || ""), env: String(row?.env || row?.value || "") })) : [];
				server.cwd_mode = ["project_root", "custom", "process"].includes(String(server.cwd_mode || "")) ? String(server.cwd_mode) : "project_root";
				server.command = String(server.command || "");
				server.cwd = String(server.cwd || "");
				server.url = String(server.url || "");
				server.bearer_token_env = String(server.bearer_token_env || "");
				return server;
			}),
		};
	},

	_timeoutSecondsToMs(value, fallbackMS = 120000) {
		let seconds = Math.round(Number(value || 0) || 0);
		if (!Number.isFinite(seconds) || seconds <= 0) {
			return fallbackMS;
		}
		return Math.max(1000, Math.min(3600000, seconds * 1000));
	},

	_mcpServers() {
		if (!this.state.mcpClients) {
			this.state.mcpClients = { servers: [] };
		}
		if (!Array.isArray(this.state.mcpClients.servers)) {
			this.state.mcpClients.servers = [];
		}
		return this.state.mcpClients.servers;
	},

	_addMCPClient() {
		this._mcpServers().push(this._newMCPClient());
		this._markDirty(true);
		this._renderAll();
	},

	_mcpObjectRows(raw = {}) {
		if (Array.isArray(raw)) {
			return raw
				.map((entry) => ({
					key: String(entry?.key || entry?.name || "").trim(),
					value: String(entry?.value || "").trim(),
				}))
				.filter((entry) => entry.key);
		}
		if (!raw || typeof raw != "object") {
			return [];
		}
		return Object.entries(raw)
			.map(([key, value]) => ({
				key: String(key || "").trim(),
				value: value === undefined || value === null ? "" : String(value),
			}))
			.filter((entry) => entry.key);
	},

	_mcpStringArray(raw) {
		if (Array.isArray(raw)) {
			return raw.map((value) => String(value || "")).filter((value) => value.trim());
		}
		if (typeof raw == "string" && raw.trim()) {
			return [raw.trim()];
		}
		return [];
	},

	_mcpClientFromImportedConfig(name = "", raw = {}) {
		if (!raw || typeof raw != "object" || Array.isArray(raw)) {
			throw new Error(`MCP server ${name || "entry"} must be a JSON object.`);
		}
		let label = String(raw.label || raw.name || name || "").trim();
		let serverID = this._normalizeMCPClientID(raw.server_id || raw.id || label || name || "mcp_server");
		let type = String(raw.type || raw.transport || "").trim().toLowerCase();
		let command = String(raw.command || "").trim();
		let url = String(raw.url || raw.serverUrl || raw.server_url || "").trim();
		let isHTTP = type == "http" || type == "streamable_http" || (!!url && type != "stdio");
		let isStdio = type == "stdio" || (!isHTTP && !!command);
		if (!isHTTP && !isStdio) {
			throw new Error(`MCP server ${label || serverID} must include either command for stdio or url for Streamable HTTP.`);
		}
		if (type && !["stdio", "http", "streamable_http"].includes(type)) {
			throw new Error(`MCP server ${label || serverID} uses unsupported transport "${type}". Use stdio or Streamable HTTP.`);
		}
		let server = Object.assign({}, this._newMCPClient(), {
			enabled: false,
			server_id: serverID,
			label: label || serverID,
			transport: isHTTP ? "streamable_http" : "stdio",
			command,
			args: this._mcpStringArray(raw.args),
			env: this._mcpObjectRows(raw.env),
			env_passthrough: this._mcpStringArray(raw.env_passthrough || raw.envPassthrough),
			url,
			headers: this._mcpObjectRows(raw.headers),
			bearer_token_env: String(raw.bearer_token_env || raw.bearerTokenEnv || "").trim(),
		});
		if (raw.cwd !== undefined && raw.cwd !== null && String(raw.cwd || "").trim()) {
			server.cwd_mode = "custom";
			server.cwd = String(raw.cwd || "").trim();
		}
		if (server.transport == "stdio" && !server.command) {
			throw new Error(`MCP server ${server.label || server.server_id} is stdio but has no command.`);
		}
		if (server.transport == "streamable_http" && !server.url) {
			throw new Error(`MCP server ${server.label || server.server_id} is Streamable HTTP but has no url.`);
		}
		return server;
	},

	_serversFromMCPImportJSON(text = "") {
		let rawText = String(text || "").trim();
		if (!rawText) {
			throw new Error("Paste an MCP JSON config before importing.");
		}
		let parsed;
		try {
			parsed = JSON.parse(rawText);
		}
		catch (error) {
			throw new Error(`MCP JSON could not be parsed: ${error?.message || String(error)}`);
		}
		if (!parsed || typeof parsed != "object" || Array.isArray(parsed)) {
			throw new Error("MCP JSON must be an object.");
		}
		let entries = [];
		if (parsed.mcpServers && typeof parsed.mcpServers == "object" && !Array.isArray(parsed.mcpServers)) {
			entries = Object.entries(parsed.mcpServers);
		}
		else {
			let fallbackName = parsed.server_id || parsed.id || parsed.name || parsed.label || `mcp_server_${this._mcpServers().length + 1}`;
			entries = [[fallbackName, parsed]];
		}
		let servers = entries
			.map(([name, entry]) => this._mcpClientFromImportedConfig(name, entry))
			.filter(Boolean);
		if (!servers.length) {
			throw new Error("No MCP servers were found in the pasted JSON.");
		}
		return servers;
	},

	_importMCPJSON() {
		try {
			let imported = this._serversFromMCPImportJSON(this.state.mcpImportText || "");
			this.state.mcpClients = this._normalizeMCPClientsState({
				servers: this._mcpServers().concat(imported),
			});
			this.state.mcpImportOpen = false;
			this.state.mcpImportText = "";
			this.state.mcpImportError = "";
			this._markDirty(true);
			this._renderAll();
			this._setStatus(`Imported ${imported.length} MCP connector${imported.length == 1 ? "" : "s"}. Review and enable before saving.`, "ready");
		}
		catch (error) {
			this.state.mcpImportError = error?.message || String(error);
			this._renderAll();
			this._setStatus(this.state.mcpImportError, "error");
		}
	},

	async _copySystematicReviewerMCPJSON() {
		let mcpStatus = this.state.serverStatus?.mcp || {};
		let endpoint = String(mcpStatus?.base_url || "").trim();
		if (!mcpStatus?.running || !endpoint) {
			this._setStatus("Enable the MCP server and save settings before copying MCP JSON.", "error");
			return;
		}
		let server = {
			type: "http",
			url: endpoint,
		};
		let key = String(this.state.serverSecurity?.mcp_api_key || "").trim();
		if (key) {
			server.headers = {
				Authorization: `Bearer ${key}`,
			};
		}
		await this._copyTextToClipboard(JSON.stringify({
			mcpServers: {
				"systematic-reviewer": server,
			},
		}, null, 2), "Systematic Reviewer MCP JSON copied.");
	},

	_removeMCPClient(index) {
		let servers = this._mcpServers();
		if (index < 0 || index >= servers.length) {
			return;
		}
		servers.splice(index, 1);
		this._markDirty(true);
		this._renderAll();
	},

	_updateMCPClientField(index, field, value, shouldRender) {
		let server = this._mcpServers()[index];
		if (!server) {
			return;
		}
		if (field == "enabled") {
			server.enabled = !!value;
		}
		else if (field == "server_id") {
			server.server_id = this._normalizeMCPClientID(value, server.server_id || `mcp_server_${index + 1}`);
		}
		else if (field == "transport") {
			server.transport = String(value || "").trim() == "streamable_http" ? "streamable_http" : "stdio";
		}
		else if (field == "request_timeout_ms" || field == "startup_timeout_ms") {
			server[field] = this._timeoutSecondsToMs(value, field == "startup_timeout_ms" ? 30000 : 120000);
		}
		else if (field == "cwd_mode") {
			server.cwd_mode = ["project_root", "custom", "process"].includes(String(value || "")) ? String(value || "") : "project_root";
		}
		else {
			server[field] = String(value || "");
		}
		delete this.state.mcpClientTestResults?.[server.server_id];
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
	},

	_emptyMCPArrayEntry(field = "") {
		if (field == "env" || field == "headers") {
			return { key: "", value: "" };
		}
		if (field == "headers_from_env") {
			return { key: "", env: "" };
		}
		return "";
	},

	_addMCPClientArrayEntry(index, field) {
		let server = this._mcpServers()[index];
		if (!server || !["args", "env", "env_passthrough", "headers", "headers_from_env"].includes(field)) {
			return;
		}
		if (!Array.isArray(server[field])) {
			server[field] = [];
		}
		server[field].push(this._emptyMCPArrayEntry(field));
		this._markDirty(true);
		this._renderAll();
	},

	_removeMCPClientArrayEntry(index, field, arrayIndex) {
		let server = this._mcpServers()[index];
		if (!server || !Array.isArray(server[field]) || arrayIndex < 0 || arrayIndex >= server[field].length) {
			return;
		}
		server[field].splice(arrayIndex, 1);
		this._markDirty(true);
		this._renderAll();
	},

	_updateMCPClientArrayEntry(index, field, arrayIndex, key, value, shouldRender) {
		let server = this._mcpServers()[index];
		if (!server || !Array.isArray(server[field]) || arrayIndex < 0 || arrayIndex >= server[field].length) {
			return;
		}
		if (field == "args" || field == "env_passthrough") {
			server[field][arrayIndex] = String(value || "");
		}
		else {
			let entry = server[field][arrayIndex] && typeof server[field][arrayIndex] == "object" ? server[field][arrayIndex] : {};
			entry[key || "value"] = String(value || "");
			server[field][arrayIndex] = entry;
		}
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
	},

	async _testMCPClient(index) {
		let server = this._mcpServers()[index];
		if (!server) {
			return;
		}
		let service = this._service();
		if (!service?.testPreferencePaneMCPClient) {
			throw new Error("MCP connector test service is not available.");
		}
		let serverID = String(server.server_id || "").trim();
		this.state.mcpClientTestResults[serverID] = { ok: null, message: "Testing MCP connector." };
		this._renderAll();
		this._setStatus(`Testing ${server.label || serverID}.`, "ready");
		try {
			let result = await service.testPreferencePaneMCPClient(this._clone(server), this._collectSettings());
			this.state.mcpClientTestResults[serverID] = {
				ok: true,
				message: String(result?.message || `Connected to ${server.label || serverID}.`).trim(),
				result,
			};
			this._setStatus(this.state.mcpClientTestResults[serverID].message, "ready");
		}
		catch (error) {
			let message = error?.message || String(error);
			this.state.mcpClientTestResults[serverID] = { ok: false, message };
			this._setStatus(message, "error");
		}
		this._renderAll();
	},

	_privilegedRestartRequired() {
		let currentShell = !!this.state.privilegedTools?.shell_enabled;
		let appliedShell = !!this.state.appliedPrivilegedTools?.shell_enabled;
		let currentBrowser = !!this.state.privilegedTools?.browser_enabled;
		let appliedBrowser = !!this.state.appliedPrivilegedTools?.browser_enabled;
		let currentDevTools = !!this.state.privilegedTools?.dev_tools_enabled;
		let appliedDevTools = !!this.state.appliedPrivilegedTools?.dev_tools_enabled;
		return currentShell != appliedShell || currentBrowser != appliedBrowser || currentDevTools != appliedDevTools;
	},

	_updateRuntimePreference(field, value, shouldRender) {
		if (field == "use_agent_model_for_data_extraction") {
			this.state.runtimePreferences.use_agent_model_for_data_extraction = !!value;
			this._markDirty(true);
			if (shouldRender) {
				this._renderAll();
			}
			return;
		}
		if (field == "saved_executor_ids") {
			this.state.runtimePreferences.saved_executor_ids = Array.isArray(value)
				? Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean)))
				: [];
			this._markDirty(true);
			if (shouldRender) {
				this._renderAll();
			}
		}
	},

	_savedExecutorIDs() {
		return Array.isArray(this.state.runtimePreferences?.saved_executor_ids)
			? Array.from(new Set(this.state.runtimePreferences.saved_executor_ids.map((value) => String(value || "").trim()).filter(Boolean)))
			: [];
	},

	_executorIsSaved(executorID = "") {
		let id = String(executorID || "").trim();
		return !!id && this._savedExecutorIDs().includes(id);
	},

	_addSavedExecutor(executorID = "") {
		let id = String(executorID || "").trim();
		if (!id || this._executorIsSaved(id)) {
			return;
		}
		let saved = this._savedExecutorIDs();
		saved.push(id);
		this._updateRuntimePreference("saved_executor_ids", saved, true);
	},

	_removeSavedExecutor(executorID = "") {
		let id = String(executorID || "").trim();
		if (!id) {
			return;
		}
		for (let role of Object.values(this.state.runtimeRoles || {})) {
			if (role?.runtime_type == "local_exec" && String(role?.executor_id || "").trim() == id) {
				role.executor_id = "";
				role.model = "";
				role.runtime_type = "local_api";
			}
		}
		this._updateRuntimePreference(
			"saved_executor_ids",
			this._savedExecutorIDs().filter((entry) => entry != id),
			true
		);
	},

	_updateConnectionField(index, field, value, shouldRender) {
		let connection = this.state.apiConnections?.[index];
		if (!connection) {
			return;
		}
		this._clearAllRoleTestResults();
		if (field == "base_url") {
			connection.base_url = this._normalizeURL(value);
			connection.models_cache = [];
			if (connection.base_url) {
				connection.runtime_type = this._connectionTypeFromURL(connection.base_url);
				connection.label = this._deriveProviderLabelForBaseURL(connection.base_url);
			}
		}
		else if (field == "api_key") {
			connection.api_key = String(value || "").trim();
			connection.models_cache = [];
		}
		else {
			connection[field] = String(value || "").trim();
		}
		this._syncRolesWithConnections();
		this._markDirty(true);
		if (shouldRender) {
			this._renderAll();
		}
		if (shouldRender && ["base_url", "api_key"].includes(field) && connection.base_url) {
			this._scanConfiguredRuntimeModels({
				connectionID: String(connection.id || ""),
				statusMessage: `Loading models from ${connection.label || connection.base_url}.`,
			}).catch((error) => this._reportError(error));
		}
	},

	_nextConnectionID(runtimeType) {
		let index = 1;
		let existing = new Set(this.state.apiConnections.map((connection) => String(connection.id || "")));
		while (existing.has(`endpoint-${index}`)) {
			index += 1;
		}
		return `endpoint-${index}`;
	},

	_addConnection() {
		let count = this.state.apiConnections.length + 1;
		this.state.apiConnections.push({
			id: this._nextConnectionID(),
			label: `Endpoint ${count}`,
			runtime_type: "local_api",
			base_url: "",
			api_kind: "responses",
			api_key: "",
			models_cache: [],
		});
		this.state.activeTab = "runtime";
		this._markDirty(true);
		this._renderAll();
	},

	_removeConnection(index) {
		if (index < 0 || index >= this.state.apiConnections.length) {
			return;
		}
		let removed = this.state.apiConnections.splice(index, 1)[0];
		for (let role of Object.values(this.state.runtimeRoles)) {
			if (role.connection_id == removed?.id) {
				role.connection_id = "";
				role.model = "";
			}
		}
		this._markDirty(true);
		this._renderAll();
	},

	_findConnection(connectionID) {
		let id = String(connectionID || "").trim();
		return this.state.apiConnections.find((connection) => String(connection.id || "").trim() == id) || null;
	},

	_normalizeURL(value) {
		return String(value || "").trim().replace(/\/+$/, "");
	},

	_isLoopbackHost(hostname = "") {
		let host = String(hostname || "").trim().toLowerCase();
		return ["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(host);
	},

	_endpointIdentity(baseURL = "") {
		let normalized = this._normalizeURL(baseURL);
		if (!normalized) {
			return "";
		}
		try {
			let parsed = new URL(normalized);
			let host = this._isLoopbackHost(parsed.hostname) ? "loopback" : String(parsed.hostname || "").toLowerCase();
			let port = Number(parsed.port || (parsed.protocol == "https:" ? 443 : 80)) || 0;
			let path = String(parsed.pathname || "/").replace(/\/+$/, "") || "/";
			return `${host}:${port}:${path}`;
		}
		catch (_error) {
			return normalized;
		}
	},

	_findMatchingConnectionForScanResult(result) {
		let endpointIdentity = this._endpointIdentity(result?.base_url || "");
		return this.state.apiConnections.find((connection) => this._endpointIdentity(connection.base_url) == endpointIdentity) || null;
	},

	_syncConnectionsFromScanResults(results = []) {
		let changed = false;
		for (let connection of this.state.apiConnections || []) {
			let match = (results || []).find((result) =>
				this._endpointIdentity(result?.base_url || "") == this._endpointIdentity(connection?.base_url || "")
			);
			if (!match) {
				continue;
			}
			let nextModels = Array.isArray(match?.models) ? this._clone(match.models) : [];
			let previousModels = Array.isArray(connection?.models_cache) ? connection.models_cache : [];
			if (JSON.stringify(previousModels) != JSON.stringify(nextModels)) {
				connection.models_cache = nextModels;
				changed = true;
			}
		}
		return changed;
	},

	async _scanConfiguredRuntimeModels({ connectionID = "", statusMessage = "" } = {}) {
		let service = this._service();
		if (!service?.scanPreferencePaneEndpoints) {
			return;
		}
		if (this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole) {
			return;
		}
		let requestedConnection = connectionID ? this._findConnection(connectionID) : null;
		if (connectionID && (!requestedConnection || !this._normalizeURL(requestedConnection.base_url || ""))) {
			return;
		}
		this.state.scanning = true;
		this._renderToolbarState();
		if (statusMessage) {
			this._setStatus(statusMessage);
		}
		try {
			let payload = await service.scanPreferencePaneEndpoints(this._collectSettings());
			this.state.scanResults = Array.isArray(payload?.api_results) ? this._clone(payload.api_results) : [];
			this.state.scanErrors = Array.isArray(payload?.api_errors) ? this._clone(payload.api_errors) : [];
			this.state.detectedExecutors = Array.isArray(payload?.detected_executors)
				? this._clone(payload.detected_executors).filter((entry) => entry.installed)
				: [];
			this._syncConnectionsFromScanResults(this.state.scanResults);
			this._syncRoleEditors(true);
			this._renderAll();
			if (statusMessage) {
				let matchedResult = requestedConnection
					? this.state.scanResults.find((result) =>
						this._endpointIdentity(result?.base_url || "") == this._endpointIdentity(requestedConnection.base_url || "")
					)
					: null;
				if (matchedResult) {
					let count = Array.isArray(matchedResult?.models) ? matchedResult.models.length : 0;
					this._setStatus(
						`Loaded ${count} model${count == 1 ? "" : "s"} from ${matchedResult.provider || requestedConnection?.label || requestedConnection?.base_url || "runtime"}.`,
						"ready"
					);
				}
				else {
					let scanError = (this.state.scanErrors || []).find((entry) =>
						String(entry?.connection_id || "").trim() == String(connectionID || "").trim() ||
						this._endpointIdentity(entry?.base_url || "") == this._endpointIdentity(requestedConnection?.base_url || "")
					);
					this._setStatus(
						String(scanError?.message || "No models were returned by the configured runtime."),
						scanError ? "error" : "ready"
					);
				}
			}
		}
		catch (error) {
			this._reportError(error);
		}
		finally {
			this.state.scanning = false;
			this._renderToolbarState();
			if (this.state.dirty) {
				this._scheduleAutosave();
			}
		}
	},

	_ensureConnectionFromScanResult(result) {
		let existing = this._findMatchingConnectionForScanResult(result);
		if (existing) {
			existing.label = String(result?.provider || existing.label || "").trim() || existing.label;
			existing.runtime_type = result?.runtime_type == "external_api" ? "external_api" : "local_api";
			existing.api_kind = "responses";
			existing.models_cache = Array.isArray(result?.models) ? this._clone(result.models) : (existing.models_cache || []);
			return existing.id;
		}
		let runtimeType = result?.runtime_type == "external_api" ? "external_api" : "local_api";
		let connection = {
			id: this._nextConnectionID(runtimeType),
			label: String(result?.provider || "").trim() || `Endpoint ${this.state.apiConnections.length + 1}`,
			runtime_type: runtimeType,
			base_url: this._normalizeURL(result?.base_url || ""),
			api_kind: "responses",
			api_key: "",
			models_cache: Array.isArray(result?.models) ? this._clone(result.models) : [],
		};
		this.state.apiConnections.push(connection);
		return connection.id;
	},

	_addDiscoveredConnection(resultIndex) {
		let result = this.state.scanResults?.[resultIndex];
		if (!result) {
			return;
		}
		let connectionID = this._ensureConnectionFromScanResult(result);
		this.state.activeTab = "runtime";
		this._markDirty(true);
		this._renderAll();
		this._setStatus(`Saved endpoint ${connectionID}.`, "ready");
	},

	_applyScanModel(resultIndex, modelID, roleID) {
		let result = this.state.scanResults?.[resultIndex];
		let role = this.state.runtimeRoles?.[roleID];
		if (!result || !role) {
			return;
		}
		let model = Array.isArray(result.models) ? result.models.find((entry) => String(entry?.id || "") == modelID) : null;
		if (!model) {
			return;
		}
		let nextConnectionID = this._ensureConnectionFromScanResult(result);
		role.runtime_type = result.runtime_type == "external_api" ? "external_api" : "local_api";
		role.connection_id = nextConnectionID;
		role.model = model.id;
		role.api_kind = "responses";
		this._clearRoleTestResult(roleID);
		this._syncRolesWithConnections();
		this._markDirty(true);
		this._renderAll();
		this._setStatus(`${model.id} set as the default for ${this._roleLabel(roleID)}.`, "ready");
	},

	_applyExecutor(executorID, roleID) {
		let role = this.state.runtimeRoles?.[roleID];
		let executor = this.state.detectedExecutors.find((entry) => entry.id == executorID) || null;
		if (!role || !executor) {
			return;
		}
		role.runtime_type = "local_exec";
		role.executor_id = executor.id;
		this._clearRoleTestResult(roleID);
		this._markDirty(true);
		this._renderAll();
		this._setStatus(`${executor.label} set as the default for ${this._roleLabel(roleID)}.`, "ready");
	},

	async testRole(roleID) {
		let requestedRoleID = String(roleID || "").trim();
		if (!requestedRoleID) {
			throw new Error("role is required.");
		}
		let service = this._service();
		if (!service?.testPreferencePaneRuntimeRole) {
			throw new Error("Systematic Reviewer runtime test service is not available");
		}
		this.state.testingRole = requestedRoleID;
		this._clearRoleTestResult(requestedRoleID);
		this._renderToolbarState();
		this._renderAll();
		this._setStatus(`Testing ${this._roleLabel(requestedRoleID)}.`, "ready");
		try {
			let result = await service.testPreferencePaneRuntimeRole(requestedRoleID, this._collectSettings());
			this._recordRoleTestResult(requestedRoleID, true, String(result?.message || ""));
			this._setStatus(String(result?.message || `${this._roleLabel(requestedRoleID)} test succeeded.`), "ready");
		}
		catch (error) {
			let message = error?.message || String(error);
			this._recordRoleTestResult(requestedRoleID, false, message);
			this._setStatus(message, "error");
		}
		finally {
			this.state.testingRole = "";
			this._renderToolbarState();
			this._renderAll();
		}
	},

	_clearRoleTestResult(roleID) {
		if (!roleID) {
			return;
		}
		if (!this.state.roleTestResults) {
			this.state.roleTestResults = {};
		}
		delete this.state.roleTestResults[roleID];
	},

	_clearAllRoleTestResults() {
		this.state.roleTestResults = {};
	},

	_recordRoleTestResult(roleID, ok, message = "") {
		if (!roleID) {
			return;
		}
		this.state.roleTestResults[roleID] = {
			ok: !!ok,
			message: String(message || "").trim(),
		};
	},

	_roleTestResult(roleID) {
		return this.state.roleTestResults?.[roleID] || null;
	},

	_rolePresetKey(roleID, presetID = "default") {
		return `${String(roleID || "").trim()}::${String(presetID || "default").trim() || "default"}`;
	},

	_rolePresetEntries(roleID) {
		let role = this.state.runtimeRoles?.[roleID] || {};
		let presets = Array.isArray(role?.model_presets) ? role.model_presets : [];
		return [{
			preset_id: "default",
			role,
			is_default: true,
		}].concat(presets.map((preset) => ({
			preset_id: String(preset?.preset_id || "").trim() || "",
			role: preset,
			is_default: false,
		})).filter((entry) => entry.preset_id));
	},

	_rolePreset(roleID, presetID = "default") {
		if (String(presetID || "").trim() == "default") {
			return this.state.runtimeRoles?.[roleID] || null;
		}
		let role = this.state.runtimeRoles?.[roleID] || {};
		return (Array.isArray(role?.model_presets) ? role.model_presets : [])
			.find((entry) => String(entry?.preset_id || "").trim() == String(presetID || "").trim()) || null;
	},

	_addRolePreset(roleID) {
		let role = this.state.runtimeRoles?.[roleID];
		if (!role || !Array.isArray(role.model_presets)) {
			return;
		}
		let count = role.model_presets.length;
		let basePresetID = `${roleID}-preset-${count + 1}`;
		let seen = new Set(role.model_presets.map((entry) => String(entry?.preset_id || "").trim()).filter(Boolean));
		let nextPresetID = basePresetID;
		let suffix = count + 1;
		while (seen.has(nextPresetID)) {
			suffix += 1;
			nextPresetID = `${roleID}-preset-${suffix}`;
		}
			role.model_presets.push({
				preset_id: nextPresetID,
				label: `Model ${role.model_presets.length + 1}`,
				runtime_type: role.runtime_type || "local_api",
				connection_id: role.connection_id || "",
				executor_id: role.executor_id || "",
				model: role.model || "",
				api_kind: "responses",
				timeout_ms: role.timeout_ms || 1200000,
				context_window: roleID == "embeddings" ? 0 : (role.context_window || 32000),
				max_output_tokens: roleID == "embeddings" ? 0 : (role.max_output_tokens || 10000),
				reasoning_effort: this._normalizeReasoningEffort(role.reasoning_effort || "", true),
				state_mode: roleID == "session_chat" ? "stateless" : "",
				parallel_requests: roleID == "embeddings" ? 0 : (role.parallel_requests || 1),
				independent_resources: !!role.independent_resources,
			});
		this._syncRolesWithConnections();
		this._syncRoleEditors(true);
		this._markDirty(true);
		this._renderAll();
	},

	_removeRolePreset(roleID, presetID = "") {
		let role = this.state.runtimeRoles?.[roleID];
		if (!role || !Array.isArray(role.model_presets)) {
			return;
		}
		role.model_presets = role.model_presets.filter((entry) => String(entry?.preset_id || "").trim() != String(presetID || "").trim());
		delete this.state.roleEditors[this._rolePresetKey(roleID, presetID)];
		this._markDirty(true);
		this._renderAll();
	},

	_syncRolePresetWithConnections(roleID, preset) {
		if (!preset || !preset.connection_id) {
			return;
		}
		let connection = this._findConnection(preset.connection_id);
		if (!connection) {
			preset.connection_id = "";
			preset.model = "";
			return;
		}
		if (preset.runtime_type != "local_exec") {
			preset.runtime_type = connection.runtime_type;
		}
	},

	_syncRolesWithConnections() {
		for (let roleDef of ENGINE_ROLES) {
			let role = this.state.runtimeRoles?.[roleDef.id];
			if (!role) {
				continue;
			}
			this._syncRolePresetWithConnections(roleDef.id, role);
			for (let preset of Array.isArray(role?.model_presets) ? role.model_presets : []) {
				this._syncRolePresetWithConnections(roleDef.id, preset);
			}
		}
	},

	_modelsForRoleConnection(roleID, connection) {
		let cached = Array.isArray(connection?.models_cache) ? connection.models_cache : [];
		let detected = (this.state.scanResults || []).find((result) =>
			this._endpointIdentity(result?.base_url || "") == this._endpointIdentity(connection?.base_url || "")
		);
		let models = Array.isArray(detected?.models) ? detected.models : cached;
		return (models || []).filter((model) => this._modelSupportsRole(model, roleID));
	},

	_runtimeChoicesForRole(roleID) {
		let choices = (this.state.apiConnections || [])
			.filter((connection) => this._normalizeURL(connection?.base_url || ""))
			.map((connection) => ({
				key: `api:${String(connection.id || "").trim()}`,
				kind: "api",
				label: `${connection.label || this._deriveProviderLabelForBaseURL(connection.base_url)} - ${connection.base_url || ""}`,
				connection,
			}));
		if (this._roleAllowsExec(roleID)) {
			for (let executorID of this._savedExecutorIDs()) {
				let executor = (this.state.detectedExecutors || []).find((entry) => String(entry?.id || "").trim() == executorID) || null;
				if (!executor) {
					continue;
				}
				choices.push({
					key: `exec:${executorID}`,
					kind: "exec",
					label: executor.label || executor.id || executorID,
					executor,
				});
			}
		}
		return choices;
	},

	_runtimeChoiceForRole(roleID, role) {
		if (this._roleUsesExecutor(roleID, role) && role?.executor_id) {
			return `exec:${String(role.executor_id || "").trim()}`;
		}
		if (role?.connection_id) {
			return `api:${String(role.connection_id || "").trim()}`;
		}
		return "";
	},

	_roleEditor(roleID, presetID = "default") {
		let key = this._rolePresetKey(roleID, presetID);
		if (!this.state.roleEditors?.[key]) {
			this._syncRoleEditors(false);
		}
		return this.state.roleEditors?.[key] || null;
	},

	_syncRoleEditors(preserveExisting = true) {
		let next = {};
		for (let roleDef of ENGINE_ROLES) {
			let roleID = roleDef.id;
			for (let entry of this._rolePresetEntries(roleID)) {
				let role = entry.role || {};
				let connection = this._findConnection(role.connection_id || "");
				let models = connection ? this._modelsForRoleConnection(roleID, connection) : [];
				let key = this._rolePresetKey(roleID, entry.preset_id);
				let previous = preserveExisting ? (this.state.roleEditors?.[key] || {}) : {};
				let roleModel = String(role?.model || "").trim();
				let inferredMode = this._roleUsesExecutor(roleID, role)
					? "select"
					: (roleModel && models.some((model) => String(model?.id || "") == roleModel) ? "select" : "manual");
				let modelMode = String(previous.model_mode || "").trim();
				if (!modelMode) {
					modelMode = inferredMode;
				}
				if (modelMode != "manual" && modelMode != "select") {
					modelMode = inferredMode;
				}
				let roleReasoning = this._normalizeReasoningEffort(role?.reasoning_effort || "", true);
				let reasoningMode = String(previous.reasoning_mode || "").trim();
				let executor = this._roleUsesExecutor(roleID, role)
					? (this.state.detectedExecutors || []).find((entry) => String(entry?.id || "").trim() == String(role?.executor_id || "").trim()) || null
					: null;
				if (this._executorIsOpenCode(executor)) {
					let selectedModel = this._openCodeModelForRole(roleID, role, executor);
					let openCodeOptions = this._openCodeReasoningOptions(selectedModel);
					if (!openCodeOptions.includes(roleReasoning)) {
						roleReasoning = "";
					}
					reasoningMode = openCodeOptions.includes(reasoningMode) ? reasoningMode : roleReasoning;
				}
				else {
					if (!reasoningMode) {
						reasoningMode = this._reasoningSelectValue(roleReasoning);
					}
					if (reasoningMode != "__custom__" && !this._builtinReasoningEffortOptions().includes(reasoningMode)) {
						reasoningMode = this._reasoningSelectValue(roleReasoning);
					}
				}
				next[key] = {
					model_mode: modelMode,
					manual_model: Object.prototype.hasOwnProperty.call(previous, "manual_model")
						? String(previous.manual_model || "")
						: roleModel,
					reasoning_mode: reasoningMode,
					custom_reasoning: Object.prototype.hasOwnProperty.call(previous, "custom_reasoning")
						? this._normalizeReasoningEffort(previous.custom_reasoning || "", true)
						: (this._reasoningSelectValue(roleReasoning) == "__custom__" ? roleReasoning : ""),
				};
			}
		}
		this.state.roleEditors = next;
	},

	_deriveProviderLabelForBaseURL(baseURL = "") {
		let normalized = this._normalizeURL(baseURL);
		if (!normalized) {
			return "Manual endpoint";
		}
		let detected = (this.state.scanResults || []).find((result) => this._endpointIdentity(result?.base_url || "") == this._endpointIdentity(normalized));
		if (detected?.provider) {
			return detected.provider;
		}
		try {
			let parsed = new URL(normalized);
			return parsed.hostname || "Manual endpoint";
		}
		catch (_error) {
			return "Manual endpoint";
		}
	},

	_roleLabel(roleID) {
		return ENGINE_ROLES.find((entry) => entry.id == roleID)?.label || roleID;
	},

	_runtimeTypeLabel(runtimeType) {
		return RUNTIME_TYPE_OPTIONS[runtimeType] || runtimeType;
	},

	_protocolLabel(apiKind) {
		let normalized = String(apiKind || "").trim();
		if (!normalized || normalized == "auto") {
			return PROTOCOL_OPTIONS.responses;
		}
		return PROTOCOL_OPTIONS[normalized] || normalized;
	},

	_roleUsesExecutor(roleID, role) {
		return (roleID == "session_chat" || roleID == "data_extraction") && role.runtime_type == "local_exec";
	},

	_roleAllowsExec(roleID) {
		return roleID == "session_chat" || roleID == "data_extraction";
	},

	_roleSupportsPresetCatalog(roleID) {
		return roleID == "session_chat" || roleID == "data_extraction";
	},

	_apiConnectionChoices(roleID = "") {
		return this.state.apiConnections.map((connection) => ({
			value: connection.id,
			label: `${connection.label} - ${connection.base_url || "(set endpoint URL below)"}`,
		}));
	},

	_roleModelLabel(roleID) {
		if (roleID == "data_extraction") {
			return "Extraction model";
		}
		if (roleID == "pdf_vlm") {
			return "PDF/VLM model";
		}
		if (roleID == "embeddings") {
			return "Embedding model";
		}
		return "Model";
	},

	_roleModelPlaceholder(roleID) {
		if (roleID == "data_extraction") {
			return "Pick a detected model or type the exact model ID";
		}
		if (roleID == "pdf_vlm") {
			return "Pick a detected model or type the exact model ID";
		}
		if (roleID == "embeddings") {
			return "Pick a detected embeddings model or type the exact model ID";
		}
		return "Pick a detected model or type the exact model ID";
	},

	_roleConfiguredViaAPI(roleID, role) {
		return !this._roleUsesExecutor(roleID, role);
	},

	_connectionOptions(runtimeType) {
		return this.state.apiConnections.filter((connection) => connection.runtime_type == runtimeType);
	},

	_scanResultMatchesConnection(result, connection) {
		return this._endpointIdentity(result?.base_url) == this._endpointIdentity(connection?.base_url);
	},

		_modelSupportsRole(model, roleID) {
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

		_executorIsOpenCode(executor = null) {
			return String(executor?.id || executor || "").trim() == "opencode";
		},

		_openCodeModelsForRole(roleID, executor = null) {
			let models = Array.isArray(executor?.models_cache)
				? executor.models_cache
				: [];
			return models.filter((model) => this._modelSupportsRole(model, roleID));
		},

		_openCodeModelForRole(roleID, role, executor = null) {
			let modelID = String(role?.model || "").trim();
			if (!modelID || modelID.startsWith("local-exec/")) {
				return null;
			}
			return this._openCodeModelsForRole(roleID, executor)
				.find((entry) => String(entry?.id || "").trim() == modelID) || null;
		},

		_openCodeReasoningOptions(model = null) {
			return Array.isArray(model?.reasoning_options)
				? model.reasoning_options.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
				: [];
		},

		_openCodeReasoningOptionList(model = null) {
			return [
				{ value: "", label: "Default" },
				...this._openCodeReasoningOptions(model).map((value) => ({
					value,
					label: value.slice(0, 1).toUpperCase() + value.slice(1),
				})),
			];
		},

		_openCodeModelOptionLabel(model = {}) {
			let parts = [String(model?.id || "").trim()].filter(Boolean);
			let suffix = [];
			let context = Number(model?.safe_context_window || 0) || 0;
			let variants = this._openCodeReasoningOptions(model);
			if (context > 0) {
				suffix.push(`${context.toLocaleString()} context budget`);
			}
			if (variants.length) {
				suffix.push(`variants ${variants.join("/")}`);
			}
			return suffix.length ? `${parts.join("")} - ${suffix.join(", ")}` : parts.join("");
		},

		_openCodeModelHint() {
			return "OpenCode models and providers come from OpenCode's advertised provider/model catalog. Run Scan local runtimes to refresh the cached list.";
		},

		_openCodeReasoningHint() {
			return "OpenCode reasoning choices are model-specific variants reported by OpenCode. If a selected model advertises no variants, the plugin sends no variant.";
		},

		_applyOpenCodeModelDefaults(roleID, role, model = null) {
			if (!role || !model) {
				if (role) {
					role.reasoning_effort = "";
				}
				return;
			}
			if (roleID != "embeddings" && Number(model.safe_context_window || 0) > 0) {
				role.context_window = Number(model.safe_context_window || 0) || role.context_window;
			}
			let options = this._openCodeReasoningOptions(model);
			if (!options.includes(String(role.reasoning_effort || "").trim().toLowerCase())) {
				role.reasoning_effort = "";
			}
		},

	_modelsForConnection(connection, roleID) {
		let out = [];
		let seen = new Set();
		let push = (models) => {
			for (let model of models || []) {
				let id = String(model?.id || "").trim();
				if (!id || seen.has(id) || !this._modelSupportsRole(model, roleID)) {
					continue;
				}
				seen.add(id);
				out.push(model);
			}
		};
		push(connection?.models_cache);
		for (let result of this.state.scanResults || []) {
			if (this._scanResultMatchesConnection(result, connection)) {
				push(result.models);
			}
		}
		out.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
		return out;
	},

	_preferredScanResults(providerID = "") {
		let results = Array.isArray(this.state.scanResults) ? this.state.scanResults.slice() : [];
		let requested = String(providerID || "").trim().toLowerCase();
		if (requested) {
			results = results.filter((result) => String(result?.provider || "").trim().toLowerCase() == requested);
		}
		results.sort((a, b) => {
			let aKey = `${a?.source == "configured" ? "0" : "1"}:${String(a?.provider || "").toLowerCase()}:${String(a?.host || "").toLowerCase()}:${Number(a?.port || 0) || 0}`;
			let bKey = `${b?.source == "configured" ? "0" : "1"}:${String(b?.provider || "").toLowerCase()}:${String(b?.host || "").toLowerCase()}:${Number(b?.port || 0) || 0}`;
			return aKey.localeCompare(bKey);
		});
		return results;
	},

	_scanModelMetaText(model) {
		let parts = [];
		let owner = String(model?.owned_by || model?.publisher || "").trim();
		if (owner) {
			parts.push(`owned by ${owner}`);
		}
		if (model?.format) {
			parts.push(`format ${String(model.format || "").toUpperCase()}`);
		}
		if (model?.quantization_name) {
			parts.push(`quant ${model.quantization_name}`);
		}
		if (model?.params_string) {
			parts.push(String(model.params_string || ""));
		}
		if (Number(model?.default_context_length || 0) > 0) {
			parts.push(`default ctx ${Number(model.default_context_length || 0).toLocaleString()}`);
		}
		if (Number(model?.max_context_length || 0) > 0) {
			parts.push(`max ctx ${Number(model.max_context_length || 0).toLocaleString()}`);
		}
		let instances = Array.isArray(model?.loaded_instances) ? model.loaded_instances.filter((entry) => entry?.id) : [];
		if (instances.length == 1) {
			let current = instances[0];
			parts.push(`loaded as ${current.id}`);
			if (current.context_length) {
				parts.push(`ctx ${Number(current.context_length || 0).toLocaleString()}`);
			}
			if (current.eval_batch_size) {
				parts.push(`batch ${current.eval_batch_size}`);
			}
			if (current.parallel) {
				parts.push(`parallel ${current.parallel}`);
			}
			if (Number(current.num_experts || 0) > 0) {
				parts.push(`experts ${current.num_experts}`);
			}
		}
		else if (instances.length > 1) {
			parts.push(`${instances.length} loaded instances`);
		}
		return parts.join(" - ");
	},

	_roleSummary(roleID, role) {
		if (roleID == "data_extraction" && this.state.runtimePreferences.use_agent_model_for_data_extraction) {
			return "Separate extraction settings are saved, but Agent Model is currently used for extraction.";
		}
		if (this._roleUsesExecutor(roleID, role)) {
			let executor = this.state.detectedExecutors.find((entry) => entry.id == role.executor_id) || null;
			if (!executor) {
				return "Choose the detected runtime to use as the default.";
			}
			let parts = [`Default: ${executor.label}`];
			if (this._executorIsOpenCode(executor)) {
				parts.push(role.model ? role.model : "OpenCode default");
			}
			else {
				parts.push("CLI default");
			}
			if (roleID != "embeddings" && Number(role.context_window || 0) > 0) {
				parts.push(`ctx ${Number(role.context_window).toLocaleString()}`);
			}
			return `${parts.join(" / ")}.`;
		}
		let connection = this._findConnection(role.connection_id);
		if (!connection || !role.model) {
			return this._roleNotConfiguredText(roleID);
		}
		let parts = [`Default: ${connection.label}`, role.model];
		if (roleID != "embeddings" && Number(role.context_window || 0) > 0) {
			parts.push(`ctx ${Number(role.context_window).toLocaleString()}`);
		}
		if (roleID == "embeddings" && Number(role.embeddings_batch_size || 0) > 0) {
			parts.push(`batch ${Number(role.embeddings_batch_size).toLocaleString()}`);
		}
		else if (roleID != "embeddings" && Number(role.max_output_tokens || 0) > 0) {
			parts.push(`max out ${Number(role.max_output_tokens).toLocaleString()}`);
		}
		return `${parts.join(" / ")}.`;
	},

		_pdfModeSummary(mode) {
			if (mode == "fast") {
				return "Fast PDF uses text extraction only. Use it for digital PDFs. It does not preserve figure or table layout, and it does not handle scanned pages.";
			}
			if (mode == "vlm") {
				return "PDF VLM uses a vision model for every conversion. Use it for scans, figures, tables, and layout-aware extraction.";
			}
			return "Fast PDF starts with text extraction, then uses a vision model only when a fallback is needed.";
		},

	_rolePresetHeading(roleID) {
		return this._roleLabel(roleID);
	},

	_roleNotConfiguredText(roleID) {
		if (roleID == "pdf_vlm") {
			return "No default PDF vision model is set. Leave PDF mode on Fast to skip vision, or pick one runtime and one model here.";
		}
		if (roleID == "embeddings") {
			return "No default embeddings model is set. Leave it blank to skip embeddings for now, or pick one runtime and one model here.";
		}
		if (roleID == "data_extraction") {
			return "No default extraction model is set. Pick one runtime and one model here, or keep extraction linked to Agent Model.";
		}
		return "No default agent model is set. Pick one runtime and one model here.";
	},

	_roleContextHint(roleID) {
		if (roleID == "embeddings") {
			return "";
		}
		return "Enter the real context length you actually loaded in LM Studio, Ollama, or your remote provider. This is used for app-side token budgeting and stateless sliding-window truncation. If the actual loaded value and the value you set here differ, requests and long automations can get stuck.";
	},

	_roleModelHint(roleID) {
		if (roleID == "pdf_vlm") {
			return "Pick the PDF/VLM model id exactly as your provider exposes it, or select one from the scanned models list.";
		}
		if (roleID == "embeddings") {
			return "Pick the embeddings model id exactly as your provider exposes it, or select one from the scanned models list.";
		}
		return "Pick the model id exactly as your provider exposes it, or select one from the scanned models list.";
	},

		_roleRecommendationText(roleID) {
			if (roleID == "session_chat" || roleID == "data_extraction") {
				return "Use the newest and largest tool-calling model your hardware can run reliably. Good examples include Qwen 3.5 30B+, GPT OSS 20B or 120B, Gemma 4, or Nemotron Super 120B-class models.";
			}
			if (roleID == "pdf_vlm") {
				return "For PDF VLM use a vision-capable model that your hardware can fit. In LM Studio you can search the repo/model directly. In Ollama, pull the equivalent model with the normal `ollama pull <model>` command.";
			}
			if (roleID == "embeddings") {
				return "Use a dedicated embeddings model such as Qwen3 Embedding 8B. In LM Studio search the repo/model directly. In Ollama, pull the equivalent model with the normal `ollama pull <model>` command.";
			}
			return "";
		},

	_parallelRequestsHint(roleID) {
		if (roleID == "pdf_vlm") {
			return "How many PDF vision requests this model/runtime can handle at once. The plugin will queue anything beyond this limit.";
		}
		return "How many requests this model/runtime can handle at once. The plugin queues anything above this limit.";
	},

	_independentResourcesHint() {
		return "Choose Yes if this model does not compete with other configured models for device resources and can run alongside them. Choose No if it shares the same on-device resources and should block other non-independent model presets while it is busy.";
	},

		_stateModeHint() {
			return "Stateful means the server keeps the conversation chain and the plugin sends only new turns plus system updates. Stateless means the plugin resends the chat context and manages the sliding window locally. In our local-runtime testing, stateless mode usually performs better than stateful. Installed CLI runtimes are stateless only.";
		},

		_hintContentFromBlocks(blocks) {
			return this._node("span", {
				className: "sr-pref-hint-content",
				children: (Array.isArray(blocks) ? blocks : [])
					.map((text) => String(text || "").trim())
					.filter(Boolean)
					.map((text) => this._node("span", {
						className: "sr-pref-hint-block",
						textContent: text,
					})),
			});
		},

		_runtimeSetupHintContent() {
			return this._hintContentFromBlocks([
				"Scan for common local runtimes, add Responses API runtimes manually, and manage installed CLI runtimes. Saved runtimes are used by the model defaults on the right.",
				"Provider and model names shown here are examples only. Systematic Reviewer is not affiliated with detected runtimes or providers.",
			]);
		},

		_detectedRuntimeHintContent() {
			return this._hintContentFromBlocks([
				"Use + to add a detected runtime into your saved list. APIs will then be scanned for models, including protected endpoints if you add an API key.",
			]);
		},

		_detectedCLIHintContent() {
			return this._hintContentFromBlocks([
				"Use + to add an installed CLI runtime into your saved list.",
				"Using a CLI runtime gives that CLI and its model or tooling local access on your machine with the permissions of your user account. Depending on the CLI, it may be able to read and write files, run commands, and access local services. Only use CLI runtimes you trust, ideally in sandboxed environments.",
				"If you use external APIs, hosted providers, or CLI runtimes, especially subscription-based services, it is your responsibility to confirm that the provider terms allow use from external applications and permit the intended review, automation, and data-extraction workflows.",
			]);
		},

		_openAlexAPIHintContent() {
			return this._hintContentFromBlocks([
				"OpenAlex is an open scholarly metadata index covering works, authors, sources, institutions, topics, funders, and related research metadata.",
				"Systematic Reviewer uses OpenAlex in Harvest to search scholarly records, collect candidate studies, and add metadata-backed items into the project workflow.",
				"An API key is optional for the UI itself, but adding a free OpenAlex key is recommended for normal project harvesting because it identifies the app's requests and gives access to OpenAlex's higher authenticated rate limits.",
				"Systematic Reviewer is not affiliated with OpenAlex. Check the OpenAlex documentation linked below for account, authentication, and rate-limit details.",
			]);
		},

		_projectsHintContent() {
			return this._hintContentFromBlocks([
				"The Projects list shows stored Systematic Reviewer project folders that the plugin knows about. This Settings view is project-independent, so it can manage projects even when another project is open.",
				"Open project opens that stored project in the project workspace. It is disabled when the linked Zotero collection is missing.",
				"Open folder reveals the project folder on disk, including the project database, settings, report, log, snapshots, outputs, templates, and other project-managed files.",
				"Reconcile queues a background job to repair and refresh the stored project links, Zotero project artifacts, and workflow files from the project metadata. Use it after restoring a project folder or when project artifacts look out of date. Track progress in Jobs.",
				"Delete opens a confirmation dialog before permanently deleting the plugin-managed project folder, database, outputs, templates, and Systematic Reviewer project/output items. The optional checkbox also removes the Zotero collection container; library items remain unless you remove them separately.",
			]);
		},

		_systematicReviewerMCPServerHintContent() {
			return this._hintContentFromBlocks([
				"This controls Systematic Reviewer's own optional MCP server. It exposes the plugin's configured MCP endpoint so trusted local agent clients can connect to this Zotero project environment.",
				"Enable MCP server starts the local endpoint when settings are saved and the runtime is available. MCP status, preferred port, and live port show what is currently running.",
				"MCP API key is optional. Leave it blank to allow local MCP callers without bearer authentication, or set a key to require Authorization: Bearer <key> on every MCP request.",
				"Generate key creates a new bearer key. Copy key copies that key. Clear key removes it. Copy endpoint copies the current endpoint URL. Copy MCP JSON copies a client configuration block for connecting to this built-in server.",
				"Use this only with agent clients you trust. If you expose a local automation endpoint, the connected client can request the plugin actions made available by that server.",
			]);
		},

		_externalMCPConnectorsHintContent() {
			return this._hintContentFromBlocks([
				"External MCP connectors are user-added third-party MCP servers. They are separate from Systematic Reviewer's own MCP server.",
				"Enabled external MCPs can provide tools, resources, or prompts to the session agent and developer testing surface through the connector broker.",
				"Third-party MCP servers run according to their own implementation. Depending on the server, transport, credentials, and your operating-system permissions, they may read or write files, run commands, access local services, call remote APIs, or send data outside the machine.",
				"Stdio MCPs start a local process. The default stdio working directory is the current project root, but that is only a starting folder, not an operating-system sandbox.",
				"Streamable HTTP MCPs send requests to the configured URL with the headers or bearer-token environment variable you provide. Review the server's documentation and only enable MCPs you trust.",
				"Add MCP connector creates a blank disabled connector. Import MCP JSON imports config blocks from another client or README and leaves imported servers disabled so you can review them before saving.",
			]);
		},

		_privilegedShellWarningBlocks() {
			return [
				"These tools are not recommended on systems that own or can access secure data. Shell commands default to running from the currently bound project workspace, but that does not itself contain the agent to the project.",
				"An agent can still write scripts, execute them, call globally installed tools such as Python, shells, package managers, or other binaries, and direct those tools to act outside the workspace.",
				"In practice, enabling shell tools grants the agent whatever system-wide access your user account and operating-system sandbox allow. Privileged shell tools can also be vulnerable to prompt injection or unsafe instruction-following.",
				"The shell namespace is not available to the MCP server. In Systematic Reviewer, privileged shell access is intended for the in-app session agent when loaded at startup.",
				"Shell commands default to the currently bound project workspace, and when developer tools are also enabled the localhost developer testing surface mirrors the same allowed tool set so you can test what the app agent can actually use. That workspace default is only a starting location, not a full safety boundary.",
				"If you enable shell tools, prefer high-capability models with stronger prompt-security behavior and use them only in sandboxed environments. This software is provided without warranties. Nothing here is legal, security, or compliance advice. Consult your IT or security team before using any software.",
			];
		},

		_privilegedBrowserWarningBlocks() {
			return [
				"These tools are privileged. They can open arbitrary websites, follow links, interact with live pages, and save webpage evidence into the current project.",
				"For transient browsing they are useful for research, docs lookup, and finding instructions. For durable save they create a Zotero webpage item plus attachments automatically inside the project flow.",
				"Saved pages default to Harvest/Web with the normal merge-to-Pending follow-up in systematic-review projects, and to Data in custom-analysis projects.",
				"Browser tools are not available to the MCP server. When developer tools are also enabled, the localhost developer testing surface mirrors the same allowed browser tool set so you can test what the in-app agent can actually use.",
				"Treat these tools with the same caution as any agent browsing capability on a machine you care about, especially on systems with sensitive sessions, accounts, local files, or secure data.",
			];
		},

		_privilegedDeveloperWarningBlocks() {
			return [
				"When enabled and restarted, developer tools unlock localhost developer inspection and the dev-only HTTP tooling surface for testing.",
				"That developer testing surface mirrors the in-app agent's allowed tools, so if privileged shell tools or privileged browser tools are enabled and loaded they will also be callable there.",
				"It widens the external control surface and should be treated as privileged. Keep developer tools and privileged tool namespaces off unless you understand the risks and are working in a sandboxed environment.",
			];
		},

		_privilegedToolInfo(field = "") {
			if (field == "shell_enabled") {
				return {
					title: "Enable privileged shell tools?",
					shortLabel: "Privileged shell tools",
					heading: "Privileged shell tools",
					help: "These tools let the in-app agent run local shell commands with your OS user privileges. Keep them off unless you explicitly want that capability.",
					blocks: this._privilegedShellWarningBlocks(),
				};
			}
			if (field == "browser_enabled") {
				return {
					title: "Enable privileged browser tools?",
					shortLabel: "Privileged browser tools",
					heading: "Privileged browser tools",
					help: "These tools let the in-app agent browse live webpages, read documentation, and save webpages into the current project using Zotero-native save flows.",
					blocks: this._privilegedBrowserWarningBlocks(),
				};
			}
			if (field == "dev_tools_enabled") {
				return {
					title: "Unlock developer tools?",
					shortLabel: "Developer tools",
					heading: "Unlock developer tools",
					help: "Enable localhost developer inspection and control tooling for testing. This is also a privileged, restart-gated capability.",
					blocks: this._privilegedDeveloperWarningBlocks(),
				};
			}
			return null;
		},

		_privilegedToolHintContent(field = "") {
			let info = this._privilegedToolInfo(field);
			return this._hintContentFromBlocks(info?.blocks || []);
		},

		_roleRecommendationHintContent(roleID) {
			let example = OPENRESEARCHTOOLS_MODEL_EXAMPLES[String(roleID || "").trim()] || null;
			let compatibilityText = String(roleID || "").trim() == "embeddings"
				? "These converted GGUF embeddings examples are for runtimes that support llama.cpp-based engines and expose an OpenAI-compatible embeddings endpoint such as /v1/embeddings, for example LM Studio."
				: "These converted GGUF model examples are for runtimes that support llama.cpp-based engines and expose OpenAI-compatible Responses APIs, for example LM Studio.";
			let children = [
				this._node("span", {
					className: "sr-pref-hint-block",
					textContent: this._roleRecommendationText(roleID),
					}),
				];
				if (example && Array.isArray(example.links) && example.links.length) {
					children.push(this._node("span", {
						className: "sr-pref-hint-block",
						textContent: String(example.note || "Example models:").trim(),
					}));
					let links = [];
					for (let index = 0; index < example.links.length; index += 1) {
						let entry = example.links[index];
						links.push(this._node("a", {
							textContent: String(entry.label || entry.href || "").trim(),
							attrs: { href: String(entry.href || "").trim() },
						}));
					}
					children.push(this._node("span", {
						className: "sr-pref-hint-links",
						children: links,
					}));
				}
			children.push(this._node("span", {
				className: "sr-pref-hint-block",
				textContent: compatibilityText,
			}));
			if (roleID == "session_chat" || roleID == "data_extraction") {
				children.push(this._node("span", {
					className: "sr-pref-hint-block",
					textContent: "If you use external APIs, hosted providers, or CLI runtimes, especially subscription-based services, it is your responsibility to confirm that the provider terms allow use from external applications and permit the intended review, automation, and data-extraction workflows.",
				}));
			}
			children.push(this._node("span", {
				className: "sr-pref-hint-block",
				textContent: "Note: Systematic Reviewer is not affiliated with LM Studio, Hugging Face, the Qwen team, upstream model providers, or runtime providers. These are just example models.",
			}));
				return this._node("span", {
					className: "sr-pref-hint-content",
					children,
				});
			},

		_legacyChatCompletionsHintContent(roleID = "") {
			let blocks = [
				"Most models should stay on Responses.",
				"Turn this on only when your provider says this specific model uses legacy Chat Completions, or when the model is not available through Responses.",
				"This applies only to this model preset, not the whole runtime.",
			];
			if (roleID == "session_chat" || roleID == "data_extraction") {
				blocks.push("Agent and extraction workflows still require the selected model/provider to support tool calls.");
			}
			if (roleID == "pdf_vlm") {
				blocks.push("For PDF/VLM, use this only when the vision model is exposed through Chat Completions.");
			}
			return this._hintContentFromBlocks(blocks);
		},

		_renderPresetRuntimeFields(roleID, role, presetID = "default", options = {}) {
		let editor = this._roleEditor(roleID, presetID) || {
			model_mode: "select",
			manual_model: String(role?.model || ""),
		};
		let runtimeChoices = this._runtimeChoicesForRole(roleID);
		let runtimeChoice = this._runtimeChoiceForRole(roleID, role);
		let selectedRuntime = runtimeChoices.find((entry) => entry.key == runtimeChoice) || null;
		let selectedConnection = selectedRuntime?.kind == "api" ? selectedRuntime.connection : null;
		let selectedModels = selectedConnection ? this._modelsForRoleConnection(roleID, selectedConnection) : [];
		let roleModel = String(role?.model || "").trim();
		let modelChoiceValue = editor.model_mode == "manual"
			? "__manual__"
			: (roleModel && selectedModels.some((entry) => String(entry?.id || "") == roleModel) ? roleModel : "");
		let attrs = (field) => ({
			"data-role": roleID,
			"data-field": field,
			"data-preset-id": presetID,
		});
		let fields = [];
		if (!options.isDefault) {
			fields.push(this._inputField(
				this._fieldLabel("Preset name", "Short label shown in chat/extraction selectors for this saved model preset.", `${roleID}:${presetID}:label`),
				"text",
				String(role?.label || ""),
				Object.assign({
						placeholder: "(e.g. Large context)",
					spellcheck: "false",
				}, attrs("label"))
			));
		}
		fields.push(this._selectField(
			this._fieldLabel("Runtime", "Choose one saved runtime. Add APIs or CLIs in the Runtimes block above if the one you want is missing.", `${roleID}:${presetID}:runtime-choice`),
			runtimeChoice,
			[
				{ value: "", label: runtimeChoices.length ? "Choose a runtime" : "Add a runtime above first" },
				...runtimeChoices.map((entry) => ({ value: entry.key, label: entry.label })),
			],
			attrs("runtime_choice")
		));
		if (selectedRuntime?.kind == "exec") {
			if (this._executorIsOpenCode(selectedRuntime.executor)) {
				let openCodeModels = this._openCodeModelsForRole(roleID, selectedRuntime.executor);
				let selectedOpenCodeModel = this._openCodeModelForRole(roleID, role, selectedRuntime.executor);
				let openCodeModelValue = selectedOpenCodeModel ? selectedOpenCodeModel.id : "";
				fields.push(this._selectField(
					this._fieldLabel("Model", this._openCodeModelHint(), `${roleID}:${presetID}:opencode-model`),
					openCodeModelValue,
					[
						{ value: "", label: "Default set in OpenCode" },
						...openCodeModels.map((entry) => ({
							value: entry.id,
							label: this._openCodeModelOptionLabel(entry),
						})),
					],
					attrs("model_choice")
				));
				if (!openCodeModels.length) {
					let error = String(selectedRuntime.executor?.models_error || "").trim();
					fields.push(this._note(error || "Run Scan local runtimes to load OpenCode's provider/model catalog."));
				}
				let openCodeReasoningOptions = this._openCodeReasoningOptions(selectedOpenCodeModel);
				if (roleID != "embeddings" && selectedOpenCodeModel && openCodeReasoningOptions.length) {
					let reasoningValue = openCodeReasoningOptions.includes(String(role?.reasoning_effort || "").trim().toLowerCase())
						? String(role.reasoning_effort || "").trim().toLowerCase()
						: "";
					let reasoningSelect = this._node("select", {
						attrs: Object.assign({}, attrs("reasoning_effort_choice")),
						children: this._openCodeReasoningOptionList(selectedOpenCodeModel).map((entry) => this._node("option", {
							textContent: entry.label,
							attrs: { value: entry.value },
						})),
					});
					reasoningSelect.value = reasoningValue;
					fields.push(this._field(
						this._fieldLabel("Reasoning", this._openCodeReasoningHint(), `${roleID}:${presetID}:opencode-reasoning`),
						reasoningSelect
					));
				}
			}
			else {
				fields.push(this._readonlyField(
					this._fieldLabel("Model", "For Codex CLI, model selection is controlled by Codex CLI/default Codex settings and is not enumerated by the plugin.", `${roleID}:${presetID}:cli-model`),
					`Default set in ${selectedRuntime.executor?.label || "selected CLI"}`
				));
			}
		}
		else if (selectedRuntime?.kind == "api") {
			fields.push(this._selectField(
				this._fieldLabel(this._roleModelLabel(roleID), this._roleModelHint(roleID), `${roleID}:${presetID}:model-choice`),
				modelChoiceValue,
				[
					{ value: "", label: selectedModels.length ? "Choose a scanned model" : "No scanned models yet" },
					...selectedModels.map((entry) => ({
						value: entry.id,
						label: this._detectedModelOptionLabel(entry),
					})),
					{ value: "__manual__", label: "Type model manually" },
				],
				attrs("model_choice")
			));
			if (modelChoiceValue == "__manual__" || !selectedModels.length) {
				fields.push(this._inputField(
					this._fieldLabel(this._roleModelLabel(roleID), this._roleModelHint(roleID), `${roleID}:${presetID}:manual-model`),
					"text",
					String(editor.manual_model || roleModel || ""),
					Object.assign({
							placeholder: roleID == "embeddings" ? "(e.g. qwen3-embedding-8b)" : "(e.g. qwen3.5-30b-a3b-instruct)",
						spellcheck: "false",
					}, attrs("manual_model"))
				));
			}
			if (!selectedModels.length) {
				fields.push(this._note("No scanned models are cached for this runtime yet. Run Scan local runtimes or type the model name manually."));
			}
			if (roleID != "embeddings") {
				fields.push(this._checkboxField(
					this._node("span", {
						className: "sr-pref-label",
						children: [
							this._node("span", { textContent: "Use legacy Chat Completions endpoint" }),
							this._hint("Legacy Chat Completions endpoint", `${roleID}:${presetID}:legacy-chat-completions`, {
								content: this._legacyChatCompletionsHintContent(roleID),
							}),
						],
					}),
					String(role?.api_kind || "").trim() == "chat_completions",
					attrs("legacy_chat_completions")
				));
			}
			if (roleID != "embeddings") {
				let reasoningValue = this._normalizeReasoningEffort(role?.reasoning_effort || "", true);
				let reasoningSelectValue = String(editor.reasoning_mode || "").trim() || this._reasoningSelectValue(reasoningValue);
				let reasoningCustomValue = this._normalizeReasoningEffort(editor.custom_reasoning || "", true)
					|| (reasoningSelectValue == "__custom__" ? reasoningValue : "");
				let reasoningControls = [
					this._node("select", {
						attrs: Object.assign({}, attrs("reasoning_effort_choice")),
						children: this._reasoningOptionList().map((entry) => this._node("option", {
							textContent: entry.label,
							attrs: { value: entry.value },
						})),
					}),
				];
				reasoningControls[0].value = reasoningSelectValue;
				if (reasoningSelectValue == "__custom__") {
					reasoningControls.push(this._node("input", {
						attrs: Object.assign({
							type: "text",
							value: reasoningCustomValue,
								placeholder: "(e.g. minimal or xhigh)",
							spellcheck: "false",
						}, attrs("reasoning_effort_custom")),
					}));
				}
				fields.push(this._field(
					this._fieldLabel("Reasoning", this._reasoningHint(), `${roleID}:${presetID}:reasoning`),
					this._node("div", {
						className: "sr-pref-inline-controls",
						children: reasoningControls,
					})
				));
			}
		}
		else {
			fields.push(this._note("Choose a runtime above to unlock the model picker."));
		}
		fields.push(this._inputField(
			this._fieldLabel("Timeout (minutes)", "How long the plugin waits for the selected runtime before failing the request. Enter minutes here; the plugin converts them internally to milliseconds.", `${roleID}:${presetID}:timeout`),
			"number",
			this._formatTimeoutMinutes(role.timeout_ms || 1200000),
			Object.assign({
				min: "1",
				step: "1",
			}, attrs("timeout_ms"))
		));
		if (roleID == "session_chat") {
			let stateModeOptions = selectedRuntime?.kind == "exec"
				? [{ value: "stateless", label: "Stateless" }]
				: [
					{ value: "stateless", label: "Stateless" },
					{ value: "stateful", label: "Stateful" },
				];
			fields.push(this._selectField(
				this._fieldLabel("State mode", this._stateModeHint(), `${roleID}:${presetID}:state-mode`),
				String(role.state_mode || "stateless"),
				stateModeOptions,
				attrs("state_mode")
			));
		}
		if (roleID == "embeddings") {
			fields.push(this._inputField(
				this._fieldLabel("Embeddings batch size", "Texts per embeddings request. This is our own batching value, not a provider load setting.", `${roleID}:${presetID}:batch`),
				"number",
				String(role.embeddings_batch_size || 32),
				Object.assign({
					min: "1",
					step: "1",
				}, attrs("embeddings_batch_size"))
			));
			fields.push(this._selectField(
				this._fieldLabel("Independent resources", this._independentResourcesHint(), `${roleID}:${presetID}:independent`),
				role.independent_resources ? "yes" : "no",
				[
					{ value: "no", label: "No" },
					{ value: "yes", label: "Yes" },
				],
				attrs("independent_resources")
			));
		}
		else {
			fields.push(this._inputField(
				this._fieldLabel("Parallel requests", this._parallelRequestsHint(roleID), `${roleID}:${presetID}:parallel`),
				"number",
				String(role.parallel_requests || 1),
				Object.assign({
					min: "1",
					step: "1",
				}, attrs("parallel_requests"))
			));
			fields.push(this._selectField(
				this._fieldLabel("Independent resources", this._independentResourcesHint(), `${roleID}:${presetID}:independent`),
				role.independent_resources ? "yes" : "no",
				[
					{ value: "no", label: "No" },
					{ value: "yes", label: "Yes" },
				],
				attrs("independent_resources")
			));
			fields.push(this._inputField(
				this._fieldLabel("Context window assumption", this._roleContextHint(roleID), `${roleID}:${presetID}:context`),
				"number",
				String(role.context_window || ""),
				Object.assign({
					min: "1024",
					step: "1024",
				}, attrs("context_window"))
			));
			if (roleID != "embeddings" && selectedRuntime?.kind != "exec") {
				fields.push(this._inputField(
					this._fieldLabel("Max output tokens", "Maximum response tokens the plugin should budget for one reply.", `${roleID}:${presetID}:max-output`),
					"number",
					String(role.max_output_tokens || 10000),
					Object.assign({
						min: "1",
						step: "1",
					}, attrs("max_output_tokens"))
				));
			}
		}
		return this._node("div", {
			className: "sr-pref-fields",
			children: fields,
		});
	},

		_projectTypeLabel(projectType) {
			return String(projectType || "").trim() == "custom_analysis"
				? "Custom Analysis"
				: "Systematic Review";
		},

		_projectID(project = {}) {
			return String(project?.project_id || project?.projectID || project?.id || "").trim();
		},

		_projectName(project = {}) {
			return String(project?.collection_name || project?.collectionName || project?.project_id || project?.projectID || "Project").trim();
		},

		_projectAvailableInZotero(project = {}) {
			return project?.available_in_zotero === true || project?.availableInZotero === true;
		},

	_formatProjectTimestamp(value) {
		let raw = String(value || "").trim();
		if (!raw) {
			return "Unknown";
		}
		try {
			return new Date(raw).toLocaleString();
		}
		catch (_err) {
			return raw;
		}
	},

		_openProjectDeleteDialog(projectID) {
			let target = String(projectID || "").trim();
			let project = (this.state.projects || []).find((entry) => this._projectID(entry) == target) || null;
			if (!project) {
				this._setStatus("Could not find that stored project in the Settings project list.", "error");
				return;
			}
			this.state.projectDeleteDialog = {
				projectID: this._projectID(project),
				project,
				deleteCollection: false,
			};
			this._renderProjectsPanel();
		},

	_closeProjectDeleteDialog() {
		this.state.projectDeleteDialog = null;
		this._renderProjectsPanel();
	},

	_updateProjectDeleteDialog(deleteCollection) {
		if (!this.state.projectDeleteDialog) {
			return;
		}
		this.state.projectDeleteDialog.deleteCollection = !!deleteCollection;
		this._renderProjectsPanel();
	},

	async _openProjectFolder(projectID) {
		let service = this._service();
		if (!service?.revealPreferencePaneProject) {
			throw new Error("Systematic Reviewer preference service is not available");
		}
		let result = await service.revealPreferencePaneProject(projectID);
		this._setStatus(`Opened ${result?.project_root || "project folder"}.`, "ready");
	},

		async _openProject(projectID) {
			let service = this._service();
			if (!service?.openPreferencePaneProject) {
				throw new Error("Systematic Reviewer preference service is not available");
			}
			let project = (this.state.projects || []).find((entry) => this._projectID(entry) == String(projectID || "").trim());
			await service.openPreferencePaneProject(projectID);
			this._setStatus(`Opened ${project ? this._projectName(project) : projectID || "project"}.`, "ready");
		},

	async _reconcileProject(projectID) {
		let service = this._service();
		if (!service?.reconcilePreferencePaneProject) {
			throw new Error("Systematic Reviewer preference service is not available");
		}
		let target = String(projectID || "").trim();
		if (!target) {
			return;
		}
			let project = (this.state.projects || []).find((entry) => this._projectID(entry) == target) || null;
			this.state.reconcilingProjectID = target;
			this._renderProjectsPanel();
			this._setStatus(`Queuing reconcile for ${project ? this._projectName(project) : target}.`);
			try {
				let result = await service.reconcilePreferencePaneProject(target);
				this._setStatus(
					`Queued reconcile for ${project ? this._projectName(project) : target}${result?.job_id ? ` as ${result.job_id}` : ""}. Track progress in Jobs.`,
					"ready"
				);
		}
		finally {
			this.state.reconcilingProjectID = "";
			this._renderProjectsPanel();
		}
	},

	async _confirmProjectDelete() {
		let service = this._service();
		if (!service?.deletePreferencePaneProject) {
			throw new Error("Systematic Reviewer preference service is not available");
		}
		let dialog = this.state.projectDeleteDialog;
		if (!dialog?.projectID) {
			return;
		}
		this.state.loading = true;
		this._renderToolbarState();
		this._setStatus("Deleting project.");
		try {
			let payload = await service.deletePreferencePaneProject({
				project_id: dialog.projectID,
				delete_collection: !!dialog.deleteCollection,
			});
				this._applyPayload(payload);
				this._setStatus(
					`Deleted ${dialog.project ? this._projectName(dialog.project) : dialog.projectID}.${dialog.deleteCollection ? " Collection removed from Zotero." : ""}`,
					"ready"
				);
		}
		finally {
			this.state.loading = false;
			this._renderToolbarState();
		}
	},

		_renderProjectsPanel() {
			if (!this.els.projectsList) {
				return;
			}
				let list = this.els.projectsList;
				this.root?.querySelector?.("[data-project-delete-dialog-root='true']")?.remove?.();
				this._syncStaticHint("projects-panel-actions", () => this._projectsHintContent());
				list.replaceChildren();
			let projects = Array.isArray(this.state.projects) ? this.state.projects : [];
			if (!projects.length) {
				list.appendChild(this._node("div", {
					className: "sr-pref-empty",
				textContent: "No stored Systematic Reviewer projects yet.",
			}));
			return;
			}
			for (let project of projects) {
				let projectID = this._projectID(project);
				let projectName = this._projectName(project);
				let availableInZotero = this._projectAvailableInZotero(project);
				let isReconciling = projectID && this.state.reconcilingProjectID == projectID;
				let metaParts = [
					this._projectTypeLabel(project?.project_type || ""),
					availableInZotero ? "Available in Zotero" : "Collection missing in Zotero",
			];
			list.appendChild(this._node("section", {
				className: "sr-pref-project-card",
				children: [
					this._node("div", {
						className: "sr-pref-project-head",
						children: [
							this._node("div", {
									className: "sr-pref-card-head",
									children: [
										this._node("h3", { textContent: projectName }),
										this._node("p", { textContent: metaParts.join(" - ") }),
									],
								}),
							this._node("div", {
								className: "sr-pref-apply-actions",
								children: [
									this._node("button", {
										textContent: "Open project",
										attrs: {
												type: "button",
												"data-action": "project-open",
												"data-project-id": projectID,
												...(availableInZotero ? {} : { disabled: "disabled" }),
											},
										}),
									this._node("button", {
										textContent: "Open folder",
										attrs: {
											type: "button",
											"data-action": "project-open-folder",
											"data-project-id": projectID,
										},
									}),
									this._node("button", {
										textContent: isReconciling ? "Queuing..." : "Reconcile",
										attrs: {
												type: "button",
												"data-action": "project-reconcile",
												"data-project-id": projectID,
												...(availableInZotero && !isReconciling ? {} : { disabled: "disabled" }),
											},
										}),
									this._node("button", {
										textContent: "Delete",
										className: "sr-pref-button-danger",
										attrs: {
											type: "button",
											"data-action": "project-delete-prompt",
											"data-project-id": projectID,
										},
									}),
								],
							}),
						],
					}),
					this._node("div", {
						className: "sr-pref-project-paths",
						children: [
							this._readonlyField("Project folder", project?.project_root || "", true),
							this._readonlyField("Database", project?.database_path || "", true),
							this._readonlyField("Report", project?.report_path || "", true),
							this._readonlyField("Updated", this._formatProjectTimestamp(project?.updated_at || ""), true),
						],
					}),
				],
				}));
			}
			if (this.state.projectDeleteDialog?.project) {
				let project = this.state.projectDeleteDialog.project;
				let modalRoot = this._node("div", {
					className: "sr-pref-modal-backdrop",
					attrs: { "data-project-delete-dialog-root": "true" },
					children: [
						this._node("section", {
							className: "sr-pref-modal",
							attrs: {
								role: "dialog",
								"aria-modal": "true",
								"aria-label": `Delete ${this._projectName(project)}?`,
							},
							children: [
								this._node("div", {
									className: "sr-pref-card-head",
									children: [
										this._node("h3", { textContent: `Delete ${this._projectName(project)}?` }),
										this._node("p", {
											textContent: "This permanently deletes the project database, project folder, outputs, templates, and the Systematic Reviewer project item with its linked workflow artifacts. Save any outputs elsewhere first if you need to keep them.",
										}),
								],
							}),
							this._checkboxField(
								"Also delete the Zotero collection container for this project. Items remain in the library unless you remove them separately.",
								!!this.state.projectDeleteDialog.deleteCollection,
								{ "data-project-delete-field": "delete_collection" }
							),
							this._node("div", {
								className: "sr-pref-modal-actions",
								children: [
									this._node("button", {
										textContent: "Cancel",
										attrs: { type: "button", "data-action": "project-delete-cancel" },
									}),
									this._node("button", {
										textContent: "Delete project",
										className: "sr-pref-button-danger",
										attrs: { type: "button", "data-action": "project-delete-confirm" },
									}),
								],
							}),
							],
						}),
					],
				});
				(this.root?.querySelector?.(".sr-pref-root") || list).appendChild(modalRoot);
				modalRoot.querySelector?.("[data-action='project-delete-cancel']")?.focus?.();
			}
		},

		_renderAll() {
			this._renderTabs();
			this._renderToolbarState();
				this._renderMainOptions();
				this._renderHarvestPanel();
				this._renderEditorPreviewPanel();
				this._renderServersPanel();
				this._renderPrivilegedToolsPanel();
				this._renderAboutPanel();
		this._renderRolePanel("session_chat", this.els.mainEngine);
		this._renderRolePanel("data_extraction", this.els.extractionEngine);
		this._renderRolePanel("pdf_vlm", this.els.pdfEngine);
		this._renderRolePanel("embeddings", this.els.embeddingsEngine);
		this._renderProjectsPanel();
		},

		_renderAboutPanel() {
			if (!this.els.aboutOptions) {
				return;
			}
			if (!this.state.aboutVersion && !this.aboutVersionPromise) {
				this._loadAboutVersion().catch((error) => this._reportError(error));
			}
			let version = String(this.state.aboutVersion || "").trim() || "Unknown";
			let documentState = this.state.aboutDocument || null;
			let documentBlock = null;
			if (documentState) {
				let body = documentState.loading
					? this._node("div", { className: "sr-pref-empty", textContent: "Loading bundled text..." })
					: documentState.error
						? this._node("div", { className: "sr-pref-empty", textContent: documentState.error })
						: this._node("pre", {
							className: "sr-pref-about-document-text",
							textContent: documentState.text || "",
						});
				documentBlock = this._node("section", {
					className: "sr-pref-card sr-pref-about-document",
					children: [
						this._node("div", {
							className: "sr-pref-card-row",
							children: [
								this._node("div", {
									className: "sr-pref-card-head",
									children: [
										this._node("h3", { textContent: documentState.title || "Bundled document" }),
										this._node("p", { textContent: documentState.file ? `Bundled file: ${documentState.file}` : "Bundled file" }),
									],
								}),
								this._node("div", {
									className: "sr-pref-apply-actions",
									children: [
										this._node("button", {
											textContent: "Copy",
											attrs: { type: "button", "data-action": "about-copy-document" },
										}),
										this._node("button", {
											textContent: "Close",
											attrs: { type: "button", "data-action": "about-close-document" },
										}),
									],
								}),
							],
						}),
						body,
					],
				});
			}
			this.els.aboutOptions.replaceChildren(this._node("section", {
				className: "sr-pref-card",
				children: [
					this._node("div", {
						className: "sr-pref-card-head",
						children: [
							this._node("h2", { textContent: "About Systematic Reviewer" }),
							this._node("p", {
								textContent: "Systematic Reviewer is a third-party extension for Zotero that turns a library collection into a project workspace for screening, extraction, semantic search, report development, and traceable research workflows.",
							}),
						],
					}),
					this._node("div", {
						className: "sr-pref-fields",
						children: [
							this._readonlyField("Version", version, false),
							this._field("Manual", this._node("a", {
								textContent: "systematicreviewer.com/manual/install/",
								attrs: { href: "https://systematicreviewer.com/manual/install/" },
							}), true),
						],
					}),
					this._node("div", {
						className: "sr-pref-about-actions",
						children: [
							this._node("button", {
								textContent: "View app license",
								attrs: { type: "button", "data-action": "about-open-document", "data-about-document": "license" },
							}),
							this._node("button", {
								textContent: "View third-party notices",
								attrs: { type: "button", "data-action": "about-open-document", "data-about-document": "thirdPartyNotices" },
							}),
							this._node("button", {
								textContent: "View third-party licenses",
								attrs: { type: "button", "data-action": "about-open-document", "data-about-document": "thirdPartyLicenses" },
							}),
						],
					}),
					documentBlock,
				],
			}));
		},

		async _loadAboutVersion() {
			if (this.aboutVersionPromise) {
				return this.aboutVersionPromise;
			}
			this.aboutVersionPromise = (async () => {
				try {
					let response = await fetch("/systematic-reviewer/workflow/about/manifest.json", {
						credentials: "same-origin",
					});
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}
					let manifest = await response.json();
					this.state.aboutVersion = String(manifest?.version || "").trim();
					this._renderAboutPanel();
				}
				catch (error) {
					this.state.aboutVersion = "Unavailable";
					this._renderAboutPanel();
					throw error;
				}
				finally {
					this.aboutVersionPromise = null;
				}
			})();
			return this.aboutVersionPromise;
		},

		async _openAboutDocument(docID = "") {
			let key = String(docID || "").trim();
			let entry = ABOUT_DOCUMENTS[key];
			if (!entry) {
				throw new Error("Unknown bundled document.");
			}
			this.state.aboutDocument = {
				id: key,
				title: entry.title,
				file: entry.file,
				text: "",
				loading: true,
				error: "",
			};
			this._renderAboutPanel();
			try {
				let response = await fetch(entry.url, { credentials: "same-origin" });
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				this.state.aboutDocument = {
					id: key,
					title: entry.title,
					file: entry.file,
					text: await response.text(),
					loading: false,
					error: "",
				};
				this._renderAboutPanel();
			}
			catch (error) {
				this.state.aboutDocument = {
					id: key,
					title: entry.title,
					file: entry.file,
					text: "",
					loading: false,
					error: `Could not load bundled document: ${error?.message || String(error)}`,
				};
				this._renderAboutPanel();
			}
		},

		async _copyAboutDocument() {
			let text = String(this.state.aboutDocument?.text || "");
			if (!text.trim()) {
				throw new Error("No bundled document text is loaded.");
			}
			await this._copyTextToClipboard(text, "Bundled document copied.");
		},

		_renderEditorPreviewPanel() {
			if (!this.els.editorPreviewOptions) {
				return;
			}
			this.els.editorPreviewOptions.replaceChildren();
			if (String(this.state.theme || "").trim().toLowerCase() != "dark") {
				this.els.editorPreviewOptions.appendChild(this._node("div", {
					className: "sr-pref-empty",
					textContent: "Editor/Preview page color controls are available when Zotero is in dark mode.",
				}));
				return;
			}
			let pageTheme = this._editorPreviewPageTheme();
			let choice = (value, label) => this._node("button", {
				className: `sr-pref-toggle-button${pageTheme == value ? " is-active" : ""}`,
				textContent: label,
				attrs: {
					type: "button",
					"data-action": "set-preview-page-theme",
					"data-preview-page-theme": value,
					"aria-pressed": pageTheme == value ? "true" : "false",
				},
			});
			this.els.editorPreviewOptions.appendChild(this._node("section", {
				className: "sr-pref-role-card",
				children: [
					this._node("div", {
						className: "sr-pref-card-head",
						children: [
							this._node("h3", { textContent: "Preview/Editor page" }),
							this._node("p", { textContent: "Controls only the on-screen Writer preview and editor page in dark mode. Export output remains unchanged." }),
						],
					}),
					this._node("div", {
						className: "sr-pref-theme-choice",
						children: [
							choice("light", "Light page"),
							choice("dark", "Dark page"),
						],
					}),
				],
			}));
		},

			_renderMainOptions() {
			if (!this.els.runtimeOptions) {
				return;
			}
		this.els.runtimeOptions.replaceChildren();
		let savedExecutorIDs = this._savedExecutorIDs();
			let savedExecutors = savedExecutorIDs
				.map((id) => (this.state.detectedExecutors || []).find((entry) => String(entry?.id || "").trim() == id) || null)
				.filter(Boolean);
			let scanDisabled = this.state.loading || this.state.saving || this.state.scanning || !!this.state.testingRole;
			this.els.runtimeOptions.append(
				this._node("section", {
					className: "sr-pref-role-card",
					children: [
						this._node("div", {
							className: "sr-pref-card-head",
							children: [
								this._cardTitleWithHint("Runtimes", "Runtime setup", "runtime-setup", {
									hintContent: this._runtimeSetupHintContent(),
								}),
								this._node("div", {
									className: "sr-pref-apply-actions",
									children: [
										this._node("button", {
											textContent: this.state.scanning ? "Scanning..." : "Scan local runtimes",
											attrs: {
												type: "button",
												"data-action": "scan-runtimes",
												...(scanDisabled ? { disabled: "disabled" } : {}),
											},
										}),
									],
								}),
							],
						}),
					this._node("div", {
						className: "sr-pref-stack",
						children: [
							...(this.state.apiConnections.length || savedExecutors.length
								? []
								: [this._node("div", { className: "sr-pref-empty", textContent: "No saved runtimes yet." })]),
							...this.state.apiConnections.map((connection, index) => this._node("section", {
								className: "sr-pref-runtime-card",
								children: [
									this._node("div", {
										className: "sr-pref-card-row",
										children: [
											this._node("div", {
												className: "sr-pref-card-head",
												children: [
													this._node("h3", { textContent: connection.label || this._deriveProviderLabelForBaseURL(connection.base_url) || `Runtime ${index + 1}` }),
													this._node("p", { textContent: "Saved Responses runtime" }),
												],
											}),
											this._node("button", {
												textContent: "Remove",
												attrs: {
													type: "button",
													"data-action": "remove-connection",
													"data-connection-index": String(index),
												},
											}),
										],
									}),
									this._node("div", {
										className: "sr-pref-fields",
										children: [
											this._inputField("API URL", "url", connection.base_url || "", {
													placeholder: "(e.g. http://127.0.0.1:1234/v1)",
												"data-connection-index": String(index),
												"data-field": "base_url",
											}, true),
											this._inputField("API key", "password", connection.api_key || "", {
												placeholder: "optional",
												autocomplete: "new-password",
												"data-connection-index": String(index),
												"data-field": "api_key",
											}, true),
										],
									}),
								],
							})),
							...savedExecutors.map((entry) => this._node("section", {
								className: "sr-pref-runtime-card",
								children: [
									this._node("div", {
										className: "sr-pref-card-row",
										children: [
											this._node("div", {
												className: "sr-pref-card-head",
												children: [
													this._node("h3", { textContent: entry.label || entry.id }),
													this._node("p", { textContent: entry.binary_path || entry.command || "Saved CLI runtime" }),
												],
											}),
											this._node("button", {
												textContent: "Remove",
												attrs: {
													type: "button",
													"data-action": "remove-saved-executor",
													"data-executor-id": String(entry.id || ""),
												},
											}),
										],
									}),
								],
							})),
							this._node("div", {
								className: "sr-pref-apply-actions",
								children: [
									this._node("button", {
										textContent: "Add runtime",
										attrs: { type: "button", "data-action": "add-connection" },
									}),
								],
							}),
							this._node("div", {
								className: "sr-pref-card-head",
								children: [
									this._cardTitleWithHint("Detected runtimes", "Detected API runtimes", "runtime-detected-apis", {
										hintContent: this._detectedRuntimeHintContent(),
									}),
								],
							}),
							...((this.state.scanResults || []).length
								? (this.state.scanResults || []).map((result, index) => {
									let saved = !!this._findMatchingConnectionForScanResult(result);
									return this._node("section", {
										className: "sr-pref-endpoint",
										children: [
											this._node("div", {
												className: "sr-pref-endpoint-head",
												children: [
													this._node("div", { className: "sr-pref-endpoint-title", textContent: result.provider || "Detected runtime" }),
													this._node("div", { className: `sr-pref-endpoint-badge${saved ? " is-good" : ""}`, textContent: saved ? "added" : "detected" }),
													saved
														? this._node("span", { className: "sr-pref-endpoint-badge is-good", textContent: "saved" })
														: this._node("button", {
															textContent: "+",
															attrs: {
																type: "button",
																"data-action": "add-discovered-connection",
																"data-result-index": String(index),
																"aria-label": `Add ${result.provider || "runtime"}`,
															},
														}),
												],
											}),
											this._node("p", { className: "sr-pref-endpoint-meta", textContent: result.base_url || "" }),
										],
									});
								})
								: [this._node("div", { className: "sr-pref-empty", textContent: "No detected API runtimes yet. Run Scan local runtimes." })]),
							this._node("div", {
								className: "sr-pref-card-head",
								children: [
									this._cardTitleWithHint("Detected installed CLI runtimes", "Detected CLI runtimes", "runtime-detected-clis", {
										hintContent: this._detectedCLIHintContent(),
									}),
								],
							}),
							...((this.state.detectedExecutors || []).length
								? (this.state.detectedExecutors || []).map((entry) => {
									let saved = this._executorIsSaved(entry.id);
									return this._node("section", {
										className: "sr-pref-endpoint",
										children: [
											this._node("div", {
												className: "sr-pref-endpoint-head",
												children: [
													this._node("div", { className: "sr-pref-endpoint-title", textContent: entry.label || entry.id }),
													this._node("div", { className: `sr-pref-endpoint-badge${saved ? " is-good" : ""}`, textContent: saved ? "added" : "detected" }),
													saved
														? this._node("span", { className: "sr-pref-endpoint-badge is-good", textContent: "saved" })
														: this._node("button", {
															textContent: "+",
															attrs: {
																type: "button",
																"data-action": "add-saved-executor",
																"data-executor-id": String(entry.id || ""),
																"aria-label": `Add ${entry.label || entry.id}`,
															},
														}),
												],
											}),
											this._node("p", { className: "sr-pref-endpoint-meta", textContent: entry.binary_path || entry.command || "" }),
										],
										});
									})
								: [this._node("div", { className: "sr-pref-empty", textContent: "No detected installed CLI runtimes yet." })]),
						],
					}),
				],
				})
			);
		},

		_renderHarvestPanel() {
			if (!this.els.harvestOptions) {
				return;
			}
			this.els.harvestOptions.replaceChildren(
				this._node("section", {
					className: "sr-pref-role-card",
					children: [
						this._node("div", {
							className: "sr-pref-card-head",
							children: [
								this._cardTitleWithHint("OpenAlex API", "OpenAlex API", "harvest-openalex-api", {
									hintContent: this._openAlexAPIHintContent(),
								}),
								this._node("p", { textContent: "Used by Harvest. Add a free API key for normal project harvesting and higher OpenAlex rate limits." }),
							],
						}),
						this._inputField(
							"OpenAlex API key",
							"password",
							this.state.openAlexApiKey || "",
							{ "data-general-setting": "openalex_api_key", autocomplete: "new-password", spellcheck: "false" }
						),
						this._openAlexKeyNote(),
					],
				})
			);
		},

		_mcpTimeoutSeconds(value, fallback = 120000) {
		let ms = Number(value || fallback) || fallback;
		return String(Math.max(1, Math.round(ms / 1000)));
	},

	_mcpWorkflowOrigin() {
		let fallback = "http://localhost:23129";
		let base = String(this.state.serverStatus?.app?.base_url || "").trim();
		if (!base) {
			return fallback;
		}
		try {
			return new URL(base).origin || fallback;
		}
		catch (_error) {
			let match = base.match(/^(https?:\/\/[^/]+)/i);
			return match ? match[1] : fallback;
		}
	},

	_renderMCPArrayRows(clientIndex, field, rows = [], options = {}) {
		let entries = Array.isArray(rows) ? rows : [];
		let children = [];
		for (let index = 0; index < entries.length; index += 1) {
			let entry = entries[index];
			let rowChildren = [];
			if (field == "args" || field == "env_passthrough") {
				rowChildren.push(this._node("input", {
					attrs: {
						type: "text",
						value: String(entry || ""),
						placeholder: options.placeholder || "",
						"data-mcp-client-index": String(clientIndex),
						"data-array-field": field,
						"data-array-index": String(index),
						"data-array-key": "value",
						spellcheck: "false",
					},
				}));
			}
			else {
				let valueKey = field == "headers_from_env" ? "env" : "value";
				rowChildren.push(this._node("input", {
					attrs: {
						type: "text",
						value: String(entry?.key || ""),
						placeholder: options.keyPlaceholder || "Key",
						"data-mcp-client-index": String(clientIndex),
						"data-array-field": field,
						"data-array-index": String(index),
						"data-array-key": "key",
						spellcheck: "false",
					},
				}));
				rowChildren.push(this._node("input", {
					attrs: {
						type: "text",
						value: String(entry?.[valueKey] || ""),
						placeholder: options.valuePlaceholder || (valueKey == "env" ? "Environment variable" : "Value"),
						"data-mcp-client-index": String(clientIndex),
						"data-array-field": field,
						"data-array-index": String(index),
						"data-array-key": valueKey,
						spellcheck: "false",
					},
				}));
			}
			rowChildren.push(this._node("button", {
				textContent: "Remove",
				attrs: {
					type: "button",
					"data-action": "remove-mcp-client-array",
					"data-mcp-client-index": String(clientIndex),
					"data-array-field": field,
					"data-array-index": String(index),
				},
			}));
			children.push(this._node("div", {
				className: "sr-pref-inline-row",
				children: rowChildren,
			}));
		}
		children.push(this._node("button", {
			textContent: options.addLabel || "Add row",
			attrs: {
				type: "button",
				"data-action": "add-mcp-client-array",
				"data-mcp-client-index": String(clientIndex),
				"data-array-field": field,
			},
		}));
		return this._node("div", {
			className: "sr-pref-field sr-pref-field-full",
			children: [
				this._node("span", { textContent: options.label || field }),
				this._node("div", {
					className: "sr-pref-repeatable",
					children,
				}),
			],
		});
	},

	_renderMCPClientCard(server, index) {
		let transport = String(server?.transport || "stdio") == "streamable_http" ? "streamable_http" : "stdio";
		let serverID = String(server?.server_id || "").trim();
		let testResult = this.state.mcpClientTestResults?.[serverID] || null;
		let status = this.state.serverStatus?.mcp_clients?.servers?.[serverID] || null;
		let statusText = status?.connected
			? `Connected${status.transport ? ` (${status.transport})` : ""}`
			: (testResult?.message || "Not connected");
		let transportFields = transport == "streamable_http"
			? [
					this._inputField("URL", "text", server.url || "", { "data-mcp-client-index": String(index), "data-field": "url", placeholder: "(e.g. https://mcp.example.com/mcp)", spellcheck: "false" }, true),
					this._inputField("Bearer token env var", "text", server.bearer_token_env || "", { "data-mcp-client-index": String(index), "data-field": "bearer_token_env", placeholder: "(e.g. MCP_BEARER_TOKEN)", spellcheck: "false" }, true),
				this._renderMCPArrayRows(index, "headers", server.headers, { label: "Headers", addLabel: "Add header", keyPlaceholder: "Header", valuePlaceholder: "Value" }),
				this._renderMCPArrayRows(index, "headers_from_env", server.headers_from_env, { label: "Headers from environment", addLabel: "Add environment header", keyPlaceholder: "Header", valuePlaceholder: "Environment variable" }),
				this._node("p", {
					className: "sr-pref-note sr-pref-field-full",
					textContent: `CORS is configured on the Streamable HTTP MCP server or proxy, not in these request header rows. For browser-style local clients, that server should return Access-Control-Allow-Origin: ${this._mcpWorkflowOrigin()} (or * for local testing), Access-Control-Allow-Headers: Content-Type, Accept, Authorization, MCP-Protocol-Version, MCP-Session-Id, and Access-Control-Allow-Methods: POST, DELETE, OPTIONS. Stdio MCPs do not use CORS.`,
				}),
			]
			: [
					this._inputField("Command", "text", server.command || "", { "data-mcp-client-index": String(index), "data-field": "command", placeholder: "(e.g. python or uvx)", spellcheck: "false" }, true),
				this._selectField("Working directory", server.cwd_mode || "project_root", [
					{ value: "project_root", label: "Current project root" },
					{ value: "custom", label: "Custom path" },
					{ value: "process", label: "Zotero process default" },
				], { "data-mcp-client-index": String(index), "data-field": "cwd_mode" }),
					this._inputField("Custom cwd", "text", server.cwd || "", { "data-mcp-client-index": String(index), "data-field": "cwd", placeholder: "(e.g. {project_root}/tools)", spellcheck: "false" }),
				this._inputField("Startup timeout (seconds)", "number", this._mcpTimeoutSeconds(server.startup_timeout_ms, 30000), { "data-mcp-client-index": String(index), "data-field": "startup_timeout_ms", min: "1", max: "3600", step: "1" }),
					this._renderMCPArrayRows(index, "args", server.args, { label: "Arguments", addLabel: "Add argument", placeholder: "(e.g. --flag or {project_root})" }),
				this._renderMCPArrayRows(index, "env", server.env, { label: "Environment variables", addLabel: "Add environment variable", keyPlaceholder: "Key", valuePlaceholder: "Value" }),
					this._renderMCPArrayRows(index, "env_passthrough", server.env_passthrough, { label: "Environment variable passthrough", addLabel: "Add variable", placeholder: "(e.g. PATH)" }),
			];
		return this._node("section", {
			className: "sr-pref-role-card",
			children: [
				this._node("div", {
					className: "sr-pref-card-head",
					children: [
						this._node("h3", { textContent: server.label || serverID || `MCP Server ${index + 1}` }),
						this._node("p", { textContent: statusText }),
					],
				}),
				this._checkboxField("Enabled", !!server.enabled, { "data-mcp-client-index": String(index), "data-field": "enabled" }),
				this._node("div", {
					className: "sr-pref-fields",
					children: [
							this._inputField("Name", "text", server.label || "", { "data-mcp-client-index": String(index), "data-field": "label", placeholder: "(e.g. MCP server name)" }),
							this._inputField("Server id", "text", server.server_id || "", { "data-mcp-client-index": String(index), "data-field": "server_id", placeholder: "(e.g. mcp_server)", spellcheck: "false" }),
						this._selectField("Transport", transport, [
							{ value: "stdio", label: "STDIO" },
							{ value: "streamable_http", label: "Streamable HTTP" },
						], { "data-mcp-client-index": String(index), "data-field": "transport" }),
						this._inputField("Request timeout (seconds)", "number", this._mcpTimeoutSeconds(server.request_timeout_ms, 120000), { "data-mcp-client-index": String(index), "data-field": "request_timeout_ms", min: "1", max: "3600", step: "1" }),
						...transportFields,
					],
				}),
				testResult ? this._node("p", {
					className: `sr-pref-note sr-pref-field-full${testResult.ok === false ? " is-error" : ""}`,
					textContent: testResult.message || "",
				}) : null,
				this._node("div", {
					className: "sr-pref-apply-actions",
					children: [
						this._node("button", {
							textContent: "Test",
							attrs: { type: "button", "data-action": "test-mcp-client", "data-mcp-client-index": String(index) },
						}),
						this._node("button", {
							textContent: "Remove",
							attrs: { type: "button", "data-action": "remove-mcp-client", "data-mcp-client-index": String(index) },
						}),
					],
				}),
			].filter(Boolean),
		});
	},

	_renderMCPImportPanel() {
		if (!this.state.mcpImportOpen) {
			return null;
		}
		return this._node("section", {
			className: "sr-pref-role-card sr-pref-import-card",
			children: [
				this._node("div", {
					className: "sr-pref-card-head",
					children: [
						this._node("h3", { textContent: "Import MCP JSON" }),
						this._node("p", { textContent: "Paste an MCP config block from a README or another client. Imported servers are added disabled so you can review them first." }),
					],
				}),
				this._field("MCP JSON", this._node("textarea", {
					textContent: this.state.mcpImportText || "",
					attrs: {
						rows: "10",
						spellcheck: "false",
							placeholder: '(e.g.\n{\n  "mcpServers": {\n    "example": {\n      "type": "stdio",\n      "command": "python",\n      "args": ["-m", "example_mcp"]\n    }\n  }\n})',
						"data-mcp-import-json": "true",
					},
				}), true),
				this.state.mcpImportError ? this._node("p", {
					className: "sr-pref-note sr-pref-field-full is-error",
					textContent: this.state.mcpImportError,
				}) : null,
				this._node("div", {
					className: "sr-pref-apply-actions",
					children: [
						this._node("button", {
							textContent: "Import",
							attrs: { type: "button", "data-action": "import-mcp-json" },
						}),
						this._node("button", {
							textContent: "Cancel",
							attrs: { type: "button", "data-action": "cancel-mcp-import" },
						}),
					],
				}),
			].filter(Boolean),
		});
	},

	_renderPrivilegedConfirmDialog() {
		this.root?.querySelector?.("[data-privileged-confirm-dialog-root='true']")?.remove?.();
		let dialog = this.state.privilegedConfirmDialog || null;
		let info = this._privilegedToolInfo(String(dialog?.field || ""));
		if (!dialog || !info) {
			return;
		}
		let mode = dialog.mode == "disable" ? "disable" : "enable";
		let accepted = dialog.accepted === true;
		let title = mode == "disable" ? `Disable ${info.shortLabel}?` : info.title;
		let modalRoot = this._node("div", {
			className: "sr-pref-modal-backdrop",
			attrs: { "data-privileged-confirm-dialog-root": "true" },
			children: [
				this._node("section", {
					className: "sr-pref-modal",
					attrs: {
						role: "dialog",
						"aria-modal": "true",
						"aria-label": title,
					},
					children: [
						this._node("div", {
							className: "sr-pref-card-head",
							children: [
								this._node("h3", { textContent: title }),
								this._node("p", {
									textContent: mode == "disable"
										? "Disabling this feature updates settings now, but the loaded tool code is only unloaded after Zotero restarts."
										: "Please confirm that you understand the risks before enabling this tool namespace.",
								}),
							],
						}),
						...(mode == "disable"
							? [
								this._node("p", {
									className: "sr-pref-copy",
									textContent: "Restart later keeps the current Zotero session running; the feature stays loaded until you fully close and reopen Zotero. Restart now saves settings and restarts Zotero immediately.",
								}),
							]
							: [
								this._node("div", {
									className: "sr-pref-modal-warning",
									children: (info.blocks || []).map((text) => this._node("p", {
										className: "sr-pref-copy",
										textContent: text,
									})),
								}),
								this._checkboxField(
									"I understand the risks explained here.",
									accepted,
									{ "data-privileged-confirm-field": "accepted" }
								),
							]),
						this._node("div", {
							className: "sr-pref-modal-actions",
							children: [
								this._node("button", {
									textContent: "Cancel",
									attrs: { type: "button", "data-action": "privileged-confirm-cancel" },
								}),
								...(mode == "disable"
									? [
										this._node("button", {
											textContent: "Restart later",
											attrs: { type: "button", "data-action": "privileged-confirm-disable-later" },
										}),
										this._node("button", {
											textContent: "Restart now",
											attrs: { type: "button", "data-action": "privileged-confirm-disable-restart" },
										}),
									]
									: [
										this._node("button", {
											textContent: "Enable, restart later",
											attrs: Object.assign(
												{ type: "button", "data-action": "privileged-confirm-enable" },
												accepted ? {} : { disabled: "disabled" }
											),
										}),
										this._node("button", {
											textContent: "Enable and restart now",
											attrs: Object.assign(
												{ type: "button", "data-action": "privileged-confirm-enable-restart" },
												accepted ? {} : { disabled: "disabled" }
											),
										}),
									]),
							],
						}),
					],
				}),
			],
		});
		(this.root?.querySelector?.(".sr-pref-root") || this.root || this.els.privilegedOptions).appendChild(modalRoot);
		modalRoot.querySelector?.("[data-action='privileged-confirm-cancel']")?.focus?.();
	},

	_renderServersPanel() {
		if (!this.els.serversOptions) {
			return;
		}
		this.els.serversOptions.replaceChildren();
		let mcpStatus = this.state.serverStatus?.mcp || {};
		let mcpSummary = mcpStatus?.running
			? `${mcpStatus.auth_mode == "bearer" ? "Bearer protected" : "No key"} - ${mcpStatus.base_url || ""}`
			: (this.state.serverSecurity?.mcp_enabled ? "Enabled but not running" : "Disabled");
		let mcpClientStatus = this.state.serverStatus?.mcp_clients || {};
		let servers = this._mcpServers();
		let builtInServerSection = this._node("section", {
				className: "sr-pref-role-card",
				children: [
					this._node("div", {
						className: "sr-pref-card-head",
						children: [
							this._cardTitleWithHint("Systematic Reviewer MCP server", "Systematic Reviewer MCP server", "systematic-reviewer-mcp-server", {
								hintContent: this._systematicReviewerMCPServerHintContent(),
							}),
						],
					}),
					this._checkboxField(
						"Enable MCP server",
						!!this.state.serverSecurity?.mcp_enabled,
						{ "data-general-setting": "mcp_enabled" }
					),
					this._node("div", {
						className: "sr-pref-fields",
						children: [
							this._readonlyField("MCP status", mcpSummary, true),
							this._readonlyField("MCP preferred port", String(mcpStatus?.preferred_port || 23139), false),
							this._readonlyField("MCP live port", String(mcpStatus?.port || 0) || "0", false),
						],
					}),
					this._inputField(
						"MCP API key",
						"password",
						this.state.serverSecurity?.mcp_api_key || "",
						{ "data-general-setting": "mcp_api_key", autocomplete: "new-password", spellcheck: "false", placeholder: "optional bearer key" },
						true
					),
					this._node("div", {
						className: "sr-pref-apply-actions",
						children: [
							this._node("button", {
								textContent: "Generate key",
								attrs: { type: "button", "data-action": "generate-mcp-key" },
							}),
							this._node("button", {
								textContent: "Copy key",
								attrs: { type: "button", "data-action": "copy-mcp-key" },
							}),
							this._node("button", {
								textContent: "Clear key",
								attrs: { type: "button", "data-action": "clear-mcp-key" },
							}),
							this._node("button", {
								textContent: "Copy endpoint",
								attrs: { type: "button", "data-action": "copy-mcp-endpoint" },
							}),
							this._node("button", {
								textContent: "Copy MCP JSON",
								attrs: { type: "button", "data-action": "copy-mcp-json" },
							}),
						],
					}),
				],
			});
		let externalConnectorSection = this._node("section", {
				className: "sr-pref-role-card",
				children: [
					this._node("div", {
						className: "sr-pref-card-head",
						children: [
							this._cardTitleWithHint("External MCP connectors", "External MCP connectors", "external-mcp-connectors", {
								hintContent: this._externalMCPConnectorsHintContent(),
							}),
						],
					}),
					this._node("div", {
						className: "sr-pref-fields",
						children: [
							this._readonlyField("Stdio support", mcpClientStatus?.stdio_available ? "Available" : (mcpClientStatus?.stdio_error || "Unavailable"), true),
							this._readonlyField("Connected MCPs", String(mcpClientStatus?.connected_count || 0), false),
						],
					}),
					this._node("div", {
						className: "sr-pref-apply-actions",
						children: [
							this._node("button", {
								textContent: "Add MCP connector",
								attrs: { type: "button", "data-action": "add-mcp-client" },
							}),
							this._node("button", {
								textContent: "Import MCP JSON",
								attrs: { type: "button", "data-action": "show-mcp-import" },
							}),
						],
					}),
					this._renderMCPImportPanel(),
					servers.length
						? this._node("div", {
							className: "sr-pref-stack",
							children: servers.map((server, index) => this._renderMCPClientCard(server, index)),
						})
						: this._node("div", { className: "sr-pref-empty", textContent: "No external MCP connectors configured yet." }),
				],
			});
		this.els.serversOptions.append(
			this._node("div", {
				className: "sr-pref-mcp-layout",
				children: [
					this._node("div", {
						className: "sr-pref-stack sr-pref-mcp-left",
						children: [builtInServerSection],
					}),
					this._node("div", {
						className: "sr-pref-stack sr-pref-mcp-right",
						children: [externalConnectorSection],
					}),
				],
			})
		);
	},

	_renderPrivilegedToolsPanel() {
		if (!this.els.privilegedOptions) {
			return;
		}
		this.els.privilegedOptions.replaceChildren();
		let appStatus = this.state.serverStatus?.app || {};
		let desiredShellEnabled = this.state.privilegedTools?.shell_enabled === true;
		let desiredBrowserEnabled = this.state.privilegedTools?.browser_enabled === true;
		let timeoutMinutes = this._formatTimeoutMinutes(this.state.privilegedTools?.default_timeout_ms || 300000, 300000);
		let shellLoaded = this.state.privilegedStatus?.shell_loaded === true;
		let browserLoaded = this.state.privilegedStatus?.browser_loaded === true;
		let shellRestartRequired = desiredShellEnabled != shellLoaded;
		let browserRestartRequired = desiredBrowserEnabled != browserLoaded;
		let devBundlePresent = this.state.privilegedStatus?.dev_tools_bundle_present !== false;
		let desiredDevToolsEnabled = this.state.privilegedTools?.dev_tools_enabled === true;
		let loadedDevTools = this.state.privilegedStatus?.dev_tools_loaded === true;
		let devToolsRestartRequired = desiredDevToolsEnabled != loadedDevTools;
		let shellStatus = desiredShellEnabled
			? (shellLoaded ? "Loaded for this Zotero session." : "Enabled in settings. Fully close and reopen Zotero to load it.")
			: (shellLoaded ? "Loaded in this Zotero session. Fully close and reopen Zotero to unload it." : "Disabled.");
		let shellNamespaceStatus = shellLoaded && this.state.privilegedStatus?.shell_namespace_available
			? (loadedDevTools
				? "Available to the in-app session agent and the localhost developer testing surface."
				: "Available to the in-app session agent only.")
			: "Not currently loaded.";
		let browserStatus = desiredBrowserEnabled
			? (browserLoaded ? "Loaded for this Zotero session." : "Enabled in settings. Fully close and reopen Zotero to load it.")
			: (browserLoaded ? "Loaded in this Zotero session. Fully close and reopen Zotero to unload it." : "Disabled.");
		let browserNamespaceStatus = browserLoaded && this.state.privilegedStatus?.browser_namespace_available
			? (loadedDevTools
				? "Available to the in-app session agent and the localhost developer testing surface."
				: "Available to the in-app session agent only.")
			: "Not currently loaded.";
		let appSummary = appStatus?.running
			? `${appStatus.base_url || ""} (${appStatus?.internal_only ? "internal" : "localhost testing enabled"})`
			: "Not running";
		let developerToolsStatus = !devBundlePresent
			? "Unavailable (dev bundle not installed)"
			: (desiredDevToolsEnabled
				? (loadedDevTools
					? "Unlocked for localhost testing in this Zotero session."
					: "Enabled in settings. Fully close and reopen Zotero to unlock developer tools.")
				: (loadedDevTools
					? "Loaded in this Zotero session. Fully close and reopen Zotero to lock developer tools."
					: "Locked in this Zotero session."));
		let shellInfo = this._privilegedToolInfo("shell_enabled");
		let browserInfo = this._privilegedToolInfo("browser_enabled");
		let developerInfo = this._privilegedToolInfo("dev_tools_enabled");
		let shellSection = this._node("section", {
			className: "sr-pref-role-card",
			children: [
				this._node("div", {
					className: "sr-pref-card-head",
					children: [
						this._cardTitleWithHint(shellInfo.heading, shellInfo.help, "privileged-shell-tools", {
							hintContent: this._privilegedToolHintContent("shell_enabled"),
						}),
						this._node("p", { textContent: shellInfo.help }),
					],
				}),
				this._checkboxField(
					"Enable privileged shell tools",
					desiredShellEnabled,
					{ "data-general-setting": "shell_enabled" }
				),
				this._node("div", {
					className: "sr-pref-fields",
					children: [
						this._readonlyField("Shell namespace", shellNamespaceStatus, true),
						this._readonlyField("Current load state", shellStatus, true),
						this._inputField(
							"Default shell timeout (minutes)",
							"number",
							String(timeoutMinutes),
							{
								min: "1",
								max: "60",
								step: "1",
								"data-general-setting": "default_timeout_ms",
							},
							false
						),
					],
				}),
				this._node("p", {
					className: "sr-pref-copy",
					textContent: shellRestartRequired
						? "Restart required: fully close and reopen Zotero to apply privileged shell tool loading changes."
						: "Changing only the default timeout updates future shell calls immediately if the privileged shell module is already loaded. Enabling or disabling privileged shell tools still requires a full Zotero close and reopen.",
				}),
			],
		});
		let browserSection = this._node("section", {
			className: "sr-pref-role-card",
			children: [
				this._node("div", {
					className: "sr-pref-card-head",
					children: [
						this._cardTitleWithHint(browserInfo.heading, browserInfo.help, "privileged-browser-tools", {
							hintContent: this._privilegedToolHintContent("browser_enabled"),
						}),
						this._node("p", { textContent: browserInfo.help }),
					],
				}),
				this._checkboxField(
					"Enable privileged browser tools",
					desiredBrowserEnabled,
					{ "data-general-setting": "browser_enabled" }
				),
				this._node("div", {
					className: "sr-pref-fields",
					children: [
						this._readonlyField("Browser namespace", browserNamespaceStatus, true),
						this._readonlyField("Current load state", browserStatus, true),
					],
				}),
				this._node("p", {
					className: "sr-pref-copy",
					textContent: browserRestartRequired
						? "Restart required: fully close and reopen Zotero to apply privileged browser tool loading changes."
						: "Browser-tool loading changes take effect only after a full Zotero close and reopen.",
				}),
			],
		});
		let developerSection = this._node("section", {
			className: "sr-pref-role-card",
			children: [
				this._node("div", {
					className: "sr-pref-card-head",
					children: [
						this._cardTitleWithHint(developerInfo.heading, developerInfo.help, "privileged-developer-tools", {
							hintContent: this._privilegedToolHintContent("dev_tools_enabled"),
						}),
						this._node("p", {
							textContent: devBundlePresent
								? developerInfo.help
								: "The developer-tools bundle is not installed in this build, so this toggle stays unavailable.",
						}),
					],
				}),
				this._checkboxField(
					"Unlock developer tools",
					desiredDevToolsEnabled,
					Object.assign(
						{ "data-general-setting": "dev_tools_enabled" },
						devBundlePresent ? {} : { disabled: "disabled" }
					)
				),
				this._node("div", {
					className: "sr-pref-fields",
					children: [
						this._readonlyField("App server", appSummary, true),
						this._readonlyField("Developer tools", developerToolsStatus, true),
						this._readonlyField("App preferred port", String(appStatus?.preferred_port || 23129), false),
						this._readonlyField("App live port", String(appStatus?.port || 0) || "0", false),
					],
				}),
				this._node("p", {
					className: "sr-pref-copy",
					textContent: devToolsRestartRequired
						? "Restart required: fully close and reopen Zotero to apply developer-tool loading changes."
						: "Developer-tool loading changes take effect only after a full Zotero close and reopen.",
				}),
			],
		});
		this.els.privilegedOptions.append(
			this._node("div", {
				className: "sr-pref-privileged-layout",
				children: [
					this._node("div", {
						className: "sr-pref-stack sr-pref-privileged-left",
						children: [shellSection, browserSection],
					}),
					this._node("div", {
						className: "sr-pref-stack sr-pref-privileged-right",
						children: [developerSection],
					}),
				],
			})
		);
		this._renderPrivilegedConfirmDialog();
	},

	_renderRolePanel(roleID, container) {
		if (!container) {
			return;
		}
		container.replaceChildren();
		let roleDef = ENGINE_ROLES.find((entry) => entry.id == roleID);
		if (!roleDef) {
			return;
		}
		let role = this.state.runtimeRoles?.[roleDef.id] || {};
		let pdfMode = this.state.pdfMarkdown.mode || "fast";
		let pdfNeedsVLM = roleID != "pdf_vlm" || pdfMode != "fast";
		let extractionLinked = roleID == "data_extraction" && this.state.runtimePreferences.use_agent_model_for_data_extraction;
		let card = this._node("section", { className: "sr-pref-role-card" });
			card.appendChild(this._node("div", {
				className: "sr-pref-card-head",
				children: [
					this._cardTitleWithHint(
						this._rolePresetHeading(roleID),
						this._roleRecommendationText(roleID),
						`${roleID}:recommendation`,
						{ hintContent: this._roleRecommendationHintContent(roleID) }
					),
				],
			}));
			let body = this._node("div", { className: "sr-pref-stack" });
		if (roleDef.id == "pdf_vlm") {
			body.appendChild(this._node("div", {
				className: "sr-pref-fields",
				children: [this._selectField(
				this._fieldLabel("PDF mode", "Fast PDF is text only. Use a VLM mode for scans, figures, tables, or layout recovery.", `${roleID}:pdf-mode`),
				pdfMode,
				Object.entries(PDF_MODE_OPTIONS).map(([value, label]) => ({ value, label })),
				{ "data-pdf-setting": "mode" }
				)],
			}));
		}
		if (roleID == "data_extraction" && extractionLinked) {
			body.appendChild(this._note("Data Extraction currently uses Agent Model. Turn off the checkbox in Agent Model to choose a separate extraction default."));
		}
		if ((roleID != "data_extraction" || !extractionLinked) && pdfNeedsVLM) {
			body.appendChild(this._node("div", {
				className: "sr-pref-card-head",
				children: [this._node("h3", { textContent: "Default" })],
			}));
			body.appendChild(this._renderPresetRuntimeFields(roleID, role, "default", { isDefault: true }));
			if (this._roleSupportsPresetCatalog(roleID)) {
				let presets = Array.isArray(role?.model_presets) ? role.model_presets : [];
				if (presets.length) {
					body.appendChild(this._node("div", {
						className: "sr-pref-card-head",
						children: [this._node("h3", { textContent: "Additional models" })],
					}));
				}
				for (let preset of presets) {
					let presetID = String(preset?.preset_id || "").trim();
					if (!presetID) {
						continue;
					}
					body.appendChild(this._node("section", {
						className: "sr-pref-runtime-card",
						children: [
							this._node("div", {
								className: "sr-pref-card-row",
								children: [
									this._node("div", {
										className: "sr-pref-card-head",
										children: [
											this._node("h3", { textContent: String(preset?.label || "Saved model").trim() || "Saved model" }),
											this._node("p", { textContent: "Available for chat or extraction model switching." }),
										],
									}),
									this._node("button", {
										textContent: "Remove",
										attrs: {
											type: "button",
											"data-action": "remove-role-preset",
											"data-role": roleID,
											"data-preset-id": presetID,
										},
									}),
								],
							}),
							this._renderPresetRuntimeFields(roleID, preset, presetID, { isDefault: false }),
						],
					}));
				}
				body.appendChild(this._node("div", {
					className: "sr-pref-apply-actions",
					children: [
						this._node("button", {
							textContent: "Add model",
							attrs: {
								type: "button",
								"data-action": "add-role-preset",
								"data-role": roleID,
							},
						}),
					],
				}));
			}
		}
		if (roleID == "session_chat") {
			body.appendChild(this._checkboxField(
				"Use Agent Model for extraction by default",
				!!this.state.runtimePreferences.use_agent_model_for_data_extraction,
				{ "data-runtime-pref": "use_agent_model_for_data_extraction" }
			));
		}
		if (roleDef.id == "pdf_vlm" && !pdfNeedsVLM) {
			body.appendChild(this._note("Fast PDF is active. Vision model settings are saved but not used unless you switch modes."));
		}
		card.appendChild(body);
		if (roleDef.id == "pdf_vlm") {
			card.appendChild(this._node("p", {
				className: "sr-pref-summary",
				textContent: this._pdfModeSummary(pdfMode),
			}));
		}
		card.appendChild(this._node("p", {
			className: "sr-pref-summary",
			textContent: roleDef.id == "pdf_vlm" && !pdfNeedsVLM
				? "Fast PDF is the current default. No vision model is required unless you switch modes."
				: extractionLinked
				? this._roleSummary(roleDef.id, role)
				: (role.model || this._roleUsesExecutor(roleDef.id, role))
				? this._roleSummary(roleDef.id, role)
				: this._roleNotConfiguredText(roleDef.id),
		}));
		container.appendChild(card);
	},

	_detectedModelMeta(model) {
			let parts = [];
			if (model.label && model.label != model.id) {
				parts.push(model.label);
		}
		if (model.owned_by) {
			parts.push(`owned by ${model.owned_by}`);
		}
			if (model.default_context_length) {
				parts.push(`default ${model.default_context_length.toLocaleString()} ctx`);
			}
			if (model.loaded && model.loaded_context_length) {
				parts.push(`loaded at ${model.loaded_context_length.toLocaleString()} ctx`);
			}
			else if (model.max_context_length) {
				parts.push(`max ${model.max_context_length.toLocaleString()} ctx`);
			}
			if (Array.isArray(model.loaded_instances) && model.loaded_instances.length > 1) {
				parts.push(`${model.loaded_instances.length} loaded instances`);
			}
			return parts.join(" - ") || "reported by scan";
		},

	_detectedModelOptionLabel(model) {
		let suffix = [];
		if (model.engine) {
			suffix.push(model.engine);
		}
		if (model.loaded && model.loaded_context_length) {
			suffix.push(`loaded ${model.loaded_context_length.toLocaleString()} ctx`);
		}
		return suffix.length ? `${model.id} - ${suffix.join(", ")}` : model.id;
	},

	_scanResultSourceLabel(result) {
		if (this._findMatchingConnectionForScanResult(result)) {
			return "Saved endpoint";
		}
		return result?.runtime_type == "external_api" ? "Detected endpoint" : "Detected runtime";
	},

	_renderConnections() {
		if (!this.els.connectionList) {
			return;
		}
		this.els.connectionList.replaceChildren();
		if (!this.state.apiConnections.length) {
			this.els.connectionList.appendChild(this._node("div", {
				className: "sr-pref-empty",
				textContent: "No saved Responses endpoints yet.",
			}));
			return;
		}
		this.state.apiConnections.forEach((connection, index) => {
			let card = this._node("section", { className: "sr-pref-connection-card" });
			card.appendChild(this._node("div", {
				className: "sr-pref-card-row",
				children: [
					this._node("div", {
						className: "sr-pref-card-head",
						children: [
							this._node("h3", { textContent: connection.label || `Connection ${index + 1}` }),
							this._node("p", { textContent: "Saved Responses endpoint. Local or remote is inferred from the URL." }),
						],
					}),
					this._node("button", {
						textContent: "Remove",
						attrs: {
							type: "button",
							"data-action": "remove-connection",
							"data-connection-index": String(index),
						},
					}),
				],
			}));
			let fields = this._node("div", { className: "sr-pref-fields" });
				fields.appendChild(this._inputField("Label", "text", connection.label || "", {
					placeholder: "(e.g. Local runtime)",
				"data-connection-index": String(index),
				"data-field": "label",
			}));
			fields.appendChild(this._inputField("Base URL", "url", connection.base_url || "", {
					placeholder: "(e.g. http://127.0.0.1:1234/v1)",
				"data-connection-index": String(index),
				"data-field": "base_url",
			}, true));
			fields.appendChild(this._inputField("API key", "password", connection.api_key || "", {
				placeholder: "Optional bearer token",
				autocomplete: "new-password",
				"data-connection-index": String(index),
				"data-field": "api_key",
			}, true));
			card.appendChild(fields);
			this.els.connectionList.appendChild(card);
		});
	},

	_renderExecutors() {
		if (!this.els.executorList) {
			return;
		}
		this.els.executorList.replaceChildren();
		if (!this.state.detectedExecutors.length) {
			this.els.executorList.appendChild(this._node("div", {
				className: "sr-pref-empty",
				textContent: "No installed CLI runtimes were detected.",
			}));
			return;
		}
		for (let entry of this.state.detectedExecutors) {
			let actions = this._node("div", { className: "sr-pref-apply-actions" });
			actions.appendChild(this._node("button", {
				textContent: "Use for Agent Model",
				attrs: {
					type: "button",
					"data-action": "apply-executor",
					"data-executor-id": entry.id,
					"data-role": "session_chat",
				},
			}));
			this.els.executorList.appendChild(this._node("section", {
				className: "sr-pref-endpoint",
				children: [
					this._node("div", {
						className: "sr-pref-endpoint-head",
						children: [
							this._node("div", { className: "sr-pref-endpoint-title", textContent: entry.label || entry.id }),
							this._node("div", { className: "sr-pref-endpoint-badge is-good", textContent: "installed" }),
						],
					}),
					this._node("p", { className: "sr-pref-endpoint-meta", textContent: entry.binary_path || entry.command || "" }),
					actions,
				],
			}));
		}
	},

	_renderScanResults() {
		if (this.els.scanMeta) {
			this.els.scanMeta.textContent = this.state.scanResults.length
				? `Reachable APIs found: ${this.state.scanResults.length}. Use a compatible detected model to configure Main Engine, PDF / Vision, or Embeddings in one step.`
				: "No scan has been run yet.";
		}
		if (!this.els.scanResults) {
			return;
		}
		this.els.scanResults.replaceChildren();
		if (!this.state.scanResults.length) {
			this.els.scanResults.appendChild(this._node("div", {
				className: "sr-pref-empty",
				textContent: "Run Scan local runtimes to list local model APIs.",
			}));
			return;
		}
		for (let resultIndex = 0; resultIndex < this.state.scanResults.length; resultIndex += 1) {
			let result = this.state.scanResults[resultIndex];
			let card = this._node("section", { className: "sr-pref-endpoint" });
			let existingConnection = this._findMatchingConnectionForScanResult(result);
			let headerChildren = [
				this._node("div", { className: "sr-pref-endpoint-title", textContent: result.provider || "Model API" }),
				this._node("div", { className: "sr-pref-endpoint-badge", textContent: this._protocolLabel(result.api_kind || "auto") }),
				this._node("div", { className: `sr-pref-endpoint-badge${existingConnection ? " is-good" : ""}`, textContent: this._scanResultSourceLabel(result) }),
			];
			if (!existingConnection) {
				headerChildren.push(this._node("button", {
					textContent: "Save endpoint",
					attrs: {
						type: "button",
						"data-action": "add-discovered-connection",
						"data-result-index": String(resultIndex),
					},
				}));
			}
			card.appendChild(this._node("div", { className: "sr-pref-endpoint-head", children: headerChildren }));
			card.appendChild(this._node("p", { className: "sr-pref-endpoint-meta", textContent: result.base_url || "" }));
			let modelsWrap = this._node("div", { className: "sr-pref-models" });
			for (let model of result.models || []) {
				let actions = this._node("div", { className: "sr-pref-apply-actions" });
				for (let roleDef of ENGINE_ROLES) {
					if (!this._modelSupportsRole(model, roleDef.id)) {
						continue;
					}
					actions.appendChild(this._node("button", {
						textContent: `Use for ${roleDef.label}`,
						attrs: {
							type: "button",
							"data-action": "apply-scan-model",
							"data-result-index": String(resultIndex),
							"data-model-id": String(model.id || ""),
							"data-role": roleDef.id,
						},
					}));
				}
				let badges = this._node("div", { className: "sr-pref-model-badges" });
				if (model.capabilities?.text) {
					badges.appendChild(this._node("div", { className: "sr-pref-model-badge", textContent: "text" }));
				}
				if (model.capabilities?.vlm) {
					badges.appendChild(this._node("div", { className: "sr-pref-model-badge", textContent: "vision" }));
				}
				if (model.capabilities?.embeddings) {
					badges.appendChild(this._node("div", { className: "sr-pref-model-badge", textContent: "embeddings" }));
				}
				modelsWrap.appendChild(this._node("div", {
					className: "sr-pref-model",
					children: [
						this._node("div", {
							className: "sr-pref-model-main",
							children: [
								this._node("div", { className: "sr-pref-model-id", textContent: model.id || "(unnamed model)" }),
								this._node("p", { className: "sr-pref-model-meta", textContent: this._scanModelMetaText(model) || "reported by scan" }),
								badges,
							],
						}),
						actions,
					],
				}));
			}
			card.appendChild(modelsWrap);
			this.els.scanResults.appendChild(card);
		}
	},

		_syncStaticHint(hintID = "", contentFactory = null) {
			let id = String(hintID || "").trim();
			if (!id) {
				return;
			}
			let root = this.root?.querySelector?.(".sr-pref-root") || this.root;
			let button = root?.querySelector?.(`button[data-action="toggle-hint"][data-hint-id="${id}"]`) || null;
			let wrap = button?.closest?.(".sr-pref-hint-wrap") || null;
			if (!button || !wrap) {
				return;
			}
			wrap.querySelector?.(".sr-pref-hint-popover")?.remove?.();
			let expanded = this.state.activeHint == id;
			button.classList.toggle("is-open", expanded);
			button.setAttribute("aria-expanded", expanded ? "true" : "false");
			if (!expanded) {
				return;
			}
			let popover = this._node("span", { className: "sr-pref-hint-popover" });
			let content = typeof contentFactory == "function" ? contentFactory() : null;
			for (let child of (Array.isArray(content) ? content : [content])) {
				if (child) {
					popover.appendChild(child);
				}
			}
			wrap.appendChild(popover);
		},

			_hint(text, hintID = "", options = {}) {
			let labelText = String(options.label || (typeof text == "string" ? text : "") || "").trim();
			let id = String(hintID || labelText || "").trim();
			let expanded = !!id && this.state.activeHint == id;
			let children = [
				this._node("button", {
					className: `sr-pref-hint${expanded ? " is-open" : ""}`,
				textContent: "?",
				attrs: {
						type: "button",
						"data-action": "toggle-hint",
						"data-hint-id": id,
						"aria-label": labelText || "More information",
						"aria-expanded": expanded ? "true" : "false",
					},
				}),
			];
			if (expanded) {
				let popover = this._node("span", { className: "sr-pref-hint-popover" });
				let content = options.content || null;
				if (content) {
					for (let child of (Array.isArray(content) ? content : [content])) {
						if (child) {
							popover.appendChild(child);
						}
					}
				}
				else {
					popover.textContent = labelText;
				}
				children.push(popover);
			}
			return this._node("span", {
				className: "sr-pref-hint-wrap",
			children,
		});
	},

	_fieldLabel(label, hint = "", hintID = "") {
		let children = [this._node("span", { textContent: String(label || "") })];
		if (hint) {
			children.push(this._hint(hint, hintID || `${String(label || "").trim()}::${String(hint || "").trim()}`));
		}
		return this._node("span", {
			className: "sr-pref-label",
			children,
		});
	},

		_cardTitleWithHint(title, hint = "", hintID = "", options = {}) {
			let headingTag = String(options.headingTag || "").trim().toLowerCase() == "h2" ? "h2" : "h3";
			let children = [
				this._node(headingTag, { textContent: String(title || "") }),
			];
			if (hint) {
				children.push(this._hint(hint, hintID || `${String(title || "").trim()}::header`, {
					content: options.hintContent || null,
				}));
			}
			return this._node("div", {
			className: "sr-pref-card-title",
			children,
		});
	},

	_note(text) {
		return this._node("p", {
			className: "sr-pref-note sr-pref-field-full",
			textContent: text,
		});
	},

	_openAlexKeyNote() {
		let doc = this._doc();
			return this._node("p", {
				className: "sr-pref-note sr-pref-field-full",
				children: [
					doc.createTextNode("Create a free account and get a key in "),
					this._node("a", {
						textContent: "OpenAlex API settings",
						attrs: { href: "https://openalex.org/settings/api" },
					}),
					doc.createTextNode(". See "),
					this._node("a", {
						textContent: "rate limits and authentication",
						attrs: { href: "https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication" },
					}),
					doc.createTextNode(" or the "),
					this._node("a", {
						textContent: "API overview",
						attrs: { href: "https://docs.openalex.org/how-to-use-the-api/api-overview" },
					}),
					doc.createTextNode("."),
				],
			});
		},

	_generateSecurityKey() {
		let pieces = [];
		if (globalThis.crypto?.getRandomValues) {
			let bytes = new Uint8Array(24);
			globalThis.crypto.getRandomValues(bytes);
			for (let entry of bytes) {
				pieces.push(entry.toString(16).padStart(2, "0"));
			}
			return pieces.join("");
		}
		for (let index = 0; index < 48; index += 1) {
			pieces.push(Math.floor(Math.random() * 16).toString(16));
		}
		return pieces.join("");
	},

	async _copyTextToClipboard(text = "", successMessage = "Copied.") {
		let value = String(text || "").trim();
		if (!value) {
			throw new Error("Nothing to copy.");
		}
		await navigator.clipboard.writeText(value);
		this._setStatus(successMessage, "ready");
	},

	_readonlyField(label, value, fullWidth = false) {
		return this._field(label, this._node("div", {
			className: "sr-pref-readonly",
			textContent: value,
		}), fullWidth);
	},

	_checkboxField(label, checked, attrs = {}) {
		let input = this._node("input", {
			attrs: Object.assign({ type: "checkbox" }, attrs),
		});
		input.checked = !!checked;
		return this._node("label", {
			className: "sr-pref-field sr-pref-field-full sr-pref-checkbox",
			children: [
				input,
				typeof label == "string" ? this._node("span", { textContent: label }) : label,
			],
		});
	},

	_selectField(label, value, options, attrs = {}) {
		let select = this._node("select", { attrs });
		for (let option of options || []) {
			select.appendChild(this._node("option", { textContent: option.label, attrs: { value: option.value } }));
		}
		select.value = value;
		return this._field(label, select);
	},

	_inputField(label, type, value, attrs = {}, fullWidth = false) {
		let input = this._node("input", { attrs: Object.assign({ type, value }, attrs) });
		return this._field(label, input, fullWidth);
	},

	_field(label, control, fullWidth = false) {
		let labelNode = typeof label == "string"
			? this._node("span", { textContent: label })
			: label;
		return this._node("label", {
			className: `sr-pref-field${fullWidth ? " sr-pref-field-full" : ""}`,
			children: [labelNode, control],
		});
	},

	_node(tagName, options = {}) {
		let doc = this._doc();
		if (!doc) {
			throw new Error("Preference pane document is unavailable");
		}
		let node = doc.createElementNS(HTML_NS, tagName);
		if (options.className) {
			node.className = options.className;
		}
		if (options.textContent != null) {
			node.textContent = options.textContent;
		}
		for (let [name, value] of Object.entries(options.attrs || {})) {
			node.setAttribute(name, value);
		}
		for (let child of options.children || []) {
			if (child) {
				node.appendChild(child);
			}
		}
		return node;
	},

	_openURL(href = "") {
		let target = String(href || "").trim();
		if (!target) {
			return;
		}
		if (typeof this.options?.openURL == "function") {
			return this.options.openURL(target);
		}
		if (typeof window != "undefined" && typeof window.open == "function") {
			window.open(target, "_blank", "noopener");
		}
	},

	hasPendingChanges() {
		return !!(
			this.state?.dirty
			|| this.state?.saving
			|| this.state?.scanning
			|| this.state?.testingRole
		);
	},

	async canDeactivate() {
		if (this.state?.saving || this.state?.scanning || this.state?.testingRole) {
			return false;
		}
		if (!this.state?.dirty) {
			return true;
		}
		if (this._isAutosaveBlockedByFocusedEditor()) {
			return false;
		}
		try {
			await this.save();
		}
		catch (error) {
			this._reportError(error);
		}
		return !this.state?.dirty && !this.state?.saving;
	},

	destroy() {
		if (this.autosaveTimer) {
			clearTimeout(this.autosaveTimer);
			this.autosaveTimer = null;
		}
		if (this.observer) {
			try {
				this.observer.disconnect();
			}
			catch (_err) {}
			this.observer = null;
		}
		this.started = false;
		this.root = null;
		this.els = {};
	},
};

function createController(options = {}) {
	let controller = Object.create(SystematicReviewerSharedSettingsControllerPrototype);
	controller.root = null;
	controller.started = false;
	controller.observer = null;
	controller.autosaveTimer = null;
	controller.options = Object.assign({}, options || {});
	controller.state = createInitialState();
	controller.els = {};
	return controller;
}

if (typeof globalThis != "undefined") {
	globalThis.SystematicReviewerSharedSettingsUI = {
		createController,
		ENGINE_ROLES,
		RUNTIME_TYPE_OPTIONS,
		PROTOCOL_OPTIONS,
		PDF_MODE_OPTIONS,
		TAB_ORDER,
	};
}
