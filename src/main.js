var SystematicReviewer = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,
	windowListener: null,
	windowState: new WeakMap(),
	paneControllers: new Set(),
	projectDBs: new Map(),
	projectItemKeyAliases: new Map(),
	projectInspectionCache: new Map(),
	currentProject: null,
	pendingJobQueue: [],
	jobPumpRunning: false,
	jobPumpScheduled: false,
	activeJobRunners: new Map(),
	jobResourceLeases: new Map(),
	jobWaitReasons: new Map(),
	jobRecoveryAttempts: new Map(),
	notifierObserverID: null,
	uiFontSizeObserverID: null,
	settingsOpenObserver: null,
	reconcileGeneration: 0,
	instanceToken: null,
	cachedGlobalSettings: null,
	preferencePaneID: null,
	namespace: "systematic-reviewer",
	collectionMenuId: "systematic-reviewer-collection-menu",
	collectionMenuSeparatorId: "systematic-reviewer-collection-separator",
	collectionMenuPopupId: "systematic-reviewer-collection-popup",
	collectionMenuSystematicId: "systematic-reviewer-collection-systematic-review",
	collectionMenuCustomId: "systematic-reviewer-collection-custom-analysis",
	collectionMenuImportId: "systematic-reviewer-collection-import",
	collectionMenuMergeHarvestId: "systematic-reviewer-collection-merge-harvest",
	itemMenuId: "systematic-reviewer-item-menu",
	itemMenuSeparatorId: "systematic-reviewer-item-separator",
	itemMenuAutoId: "systematic-reviewer-item-convert-auto",
	itemMenuFastId: "systematic-reviewer-item-convert-fast",
	itemMenuVlmId: "systematic-reviewer-item-convert-vlm",
		itemMenuJobsId: "systematic-reviewer-item-open-jobs",
		viewMenuId: "systematic-reviewer-view-menu",
		viewMenuSeparatorId: "systematic-reviewer-view-separator",
		viewMenuPopupId: "systematic-reviewer-view-popup",
		viewMenuLightPreviewEditorId: "systematic-reviewer-view-light-preview-editor",
		viewMenuDarkPreviewEditorId: "systematic-reviewer-view-dark-preview-editor",
		toolsMenuSeparatorId: "systematic-reviewer-tools-separator",
	toolsMenuSemanticSearchId: "systematic-reviewer-tools-semantic-search",
	workspaceTabType: "systematic-reviewer-workspace",
	jobsTabID: "systematic-reviewer-jobs-tab",
	jobsTabType: "systematic-reviewer-jobs",
	workflowTabID: "systematic-reviewer-workflow-tab",
	settingsTabID: "systematic-reviewer-settings-tab",
	settingsOpenObserverTopic: "systematic-reviewer-open-settings-tab",
		workflowTabType: "systematic-reviewer-workflow",
		markdownViewerTabID: "systematic-reviewer-markdown-viewer-tab",
		markdownViewerTabType: "systematic-reviewer-markdown-viewer",
		markdownOnlyViewerTabID: "systematic-reviewer-markdown-only-viewer-tab",
		markdownOnlyViewerTabType: "systematic-reviewer-markdown-only-viewer",
		textAttachmentViewerTabID: "systematic-reviewer-text-attachment-viewer-tab",
		textAttachmentViewerTabType: "systematic-reviewer-text-attachment-viewer",
		csvAttachmentViewerTabID: "systematic-reviewer-csv-attachment-viewer-tab",
		csvAttachmentViewerTabType: "systematic-reviewer-csv-attachment-viewer",
		originalFileHandlersOpen: null,
	runtimeClientLeases: {},
	runtimeClientLeaseIdleMs: 10000,

	async init({ id, version, rootURI }) {
		if (this.initialized) {
			return;
		}
		this.id = id;
			this.version = version;
			this.rootURI = rootURI;
			this.runtimeClientLeases = {};
			this.jobRecoveryAttempts = new Map();
			this.harvestImportRecoveryWatchdogGeneration = 0;
			this.harvestImportRecoveryLocks = new Set();
			this.instanceToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
				await this._initializeStorage();
				await this._globalSettings().catch(() => null);
				SystematicReviewerWorkflowCommands?.register?.(this);
				SystematicReviewerWorkflowServer?.register?.(this);
				SystematicReviewerAgentTools?.register?.(this);
				SystematicReviewerMCPServer?.register?.(this);
				Zotero.SystematicReviewer = this;
		try {
			await this._restoreLastProjectSelection();
		}
		catch (error) {
			this.log(`last project restore skipped: ${error}`);
		}
		await this._registerPreferencePane();
		try {
			await Zotero.Styles.init();
		}
		catch (error) {
			this.log(`style init skipped: ${error}`);
		}
		this._registerNotifierObserver();
		this._registerUIFontObserver();
		this._registerSettingsOpenObserver();
		this._registerWindowListener();
	this._installIntoExistingWindows();
			this._refreshWorkflowBrowserAppearance();
			this._installFileHandlerOverrides();
			await this._reconcileJobsAfterRestart?.().catch((error) => {
				this.log(`job restart reconciliation skipped: ${error}`);
			});
			this._scheduleJobPump();
			this.initialized = true;
			this._scheduleHarvestImportRecoveryWatchdog?.();
		this.log("sqlite collection workspace plugin ready");
	},

		shutdown() {
			if (!this.initialized) {
				return;
			}
			this._restoreFileHandlerOverrides();
					this._unregisterPreferencePane();
					this._unregisterNotifierObserver();
					this._unregisterUIFontObserver();
					this._unregisterSettingsOpenObserver();
				SystematicReviewerMCPClient?.shutdown?.();
				SystematicReviewerMCPServer?.unregister?.();
				SystematicReviewerWorkflowServer?.unregister?.();
				SystematicReviewerWorkflowCommands?.unregister?.();
				SystematicReviewerAgentTools?.unregister?.();
		for (let win of this._mainWindows()) {
			this._teardownWindow(win);
		}
		this._unregisterWindowListener();
		for (let controller of Array.from(this.paneControllers)) {
			if (controller?.body) {
				this._destroyController(controller.body);
			}
		}
			for (let db of this.projectDBs.values()) {
				try {
					db.closeDatabase?.();
				}
				catch (_err) {}
			}
		this.pendingJobQueue = [];
		this.jobPumpRunning = false;
		this.jobPumpScheduled = false;
		this._stopHarvestImportRecoveryWatchdog?.();
		this.activeJobRunners = new Map();
		this.jobResourceLeases = new Map();
		this.jobWaitReasons = new Map();
		this.jobRecoveryAttempts = new Map();
		this.runtimeClientLeases = {};
					this.projectDBs.clear();
					this.projectInspectionCache.clear();
					this.cachedGlobalSettings = null;
					this.currentProject = null;
		if (Zotero.SystematicReviewer === this) {
			delete Zotero.SystematicReviewer;
		}
		this.initialized = false;
	},

	log(message) {
		Zotero.debug(`Systematic Reviewer: ${message}`);
	},

























































	};

Object.assign(
	SystematicReviewer,
	SystematicReviewerPrefsHost,
	SystematicReviewerWorkflowBrowserAppearance,
	SystematicReviewerWorkflowHost,
	SystematicReviewerDBUtils,
	SystematicReviewerProjects,
	SystematicReviewerSessions,
	SystematicReviewerAutomationRunner,
	SystematicReviewerCitations,
	SystematicReviewerMarkdownRendering,
	SystematicReviewerEditorSettings,
	SystematicReviewerAttachmentViewerRouter,
	SystematicReviewerItemIdentity,
	SystematicReviewerJobsHost,
	SystematicReviewerJobsRuntime,
		SystematicReviewerNativeEditor,
		SystematicReviewerMarkdownViewerHost,
		SystematicReviewerMarkdownViewerPdf,
		SystematicReviewerMarkdownOnlyViewerHost,
		SystematicReviewerTextAttachmentViewerHost,
		SystematicReviewerCSVAttachmentViewerHost,
		SystematicReviewerObservers,
	SystematicReviewerPlatformUtils,
	SystematicReviewerProjectEntry,
	SystematicReviewerProjectStorage,
	SystematicReviewerRuntimeSettings,
	SystematicReviewerLocalExecResponsesBridge,
	SystematicReviewerTabLocator,
	SystematicReviewerWindowHost,
	SystematicReviewerWorkspaceController
);
