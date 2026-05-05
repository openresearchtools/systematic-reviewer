var SystematicReviewerAgentDevTools = (() => {
	const ENDPOINT_PREFIX = "/systematic-reviewer/dev";

	let reviewer = null;
	let registered = false;
	let httpRoutesRegistered = false;
	let toolRegistry = new Map();

	function register(nextReviewer) {
		if (!nextReviewer) {
			return;
		}
		if (registered && reviewer === nextReviewer) {
			return;
		}
		unregister();
		reviewer = nextReviewer;
		toolRegistry = buildToolRegistry();
		registerHTTPEndpoints();
		registered = true;
		reviewer.log("dev localhost tools ready");
	}

	function unregister() {
		if (!registered && !reviewer) {
			return;
		}
		unregisterHTTPEndpoints();
		toolRegistry = new Map();
		reviewer = null;
		registered = false;
	}

	function registerHTTPEndpoints() {
		if (httpRoutesRegistered || !SystematicReviewerWorkflowServer?.registerEndpoint || !SystematicReviewerWorkflowServer?.isUnlocked?.()) {
			return;
		}
		SystematicReviewerWorkflowServer.registerEndpoint(`${ENDPOINT_PREFIX}/ping`, PingEndpoint, {
			access: "public",
			dev_only: true,
		});
		SystematicReviewerWorkflowServer.registerEndpoint(`${ENDPOINT_PREFIX}/tools`, ToolsListEndpoint, {
			access: "public",
			dev_only: true,
		});
		SystematicReviewerWorkflowServer.registerEndpoint(`${ENDPOINT_PREFIX}/tools/call`, ToolCallEndpoint, {
			access: "public",
			dev_only: true,
		});
		httpRoutesRegistered = true;
	}

	function unregisterHTTPEndpoints() {
		if (!httpRoutesRegistered || !SystematicReviewerWorkflowServer?.unregisterPathHandler) {
			httpRoutesRegistered = false;
			return;
		}
		for (let path of [
			`${ENDPOINT_PREFIX}/ping`,
			`${ENDPOINT_PREFIX}/tools`,
			`${ENDPOINT_PREFIX}/tools/call`,
		]) {
			SystematicReviewerWorkflowServer.unregisterPathHandler(path);
		}
		httpRoutesRegistered = false;
	}

	function refreshHTTPEndpoints() {
		if (SystematicReviewerWorkflowServer?.isUnlocked?.()) {
			registerHTTPEndpoints();
			return;
		}
		unregisterHTTPEndpoints();
	}

	function listTools() {
		return Array.from(toolRegistry.values())
			.map((tool) => ({
				id: tool.id,
				description: tool.description,
				args: Object.keys(tool.inputShape || {}),
				inputShape: tool.inputShape || null,
			}))
			.sort((a, b) => a.id.localeCompare(b.id));
	}

	async function callTool(toolID, args = {}) {
		if (!reviewer) {
			throw new Error("Systematic Reviewer dev tools are not registered.");
		}
		let tool = toolRegistry.get(String(toolID || ""));
		if (!tool) {
			throw new Error(`Unknown dev tool: ${toolID}`);
		}
		return await tool.execute(args || {});
	}

	function buildToolRegistry() {
		let registry = new Map();
		let define = (tool) => {
			registry.set(tool.id, tool);
			return tool;
		};

		define({
			id: "srdev.zoteroCreateItems",
			description: "Dev-only: create disposable Zotero items in one collection for installed-plugin smoke tests.",
			inputShape: {
				collection_key: "required target Zotero collection key",
				library_id: "optional Zotero library id",
				items: "required array of item definitions",
			},
			execute: async (args = {}) => {
				let collection = resolveCollectionTarget(args);
				let itemDefinitions = Array.isArray(args.items) ? args.items : [];
				if (!itemDefinitions.length) {
					throw new Error("items must be a non-empty array.");
				}
				let created = [];
				for (let definition of itemDefinitions) {
					let itemType = String(definition?.item_type || definition?.itemType || "journalArticle").trim() || "journalArticle";
					let item = new Zotero.Item(itemType);
					item.libraryID = collection.libraryID;
					item.setCollections([collection.id]);
					for (let [fieldName, fieldValue] of Object.entries({
						title: definition?.title,
						DOI: definition?.doi,
						PMID: definition?.pmid,
						arXiv: definition?.arxiv,
						ISBN: definition?.isbn,
						date: definition?.date,
						abstractNote: definition?.abstract,
						extra: definition?.extra,
					})) {
						if (fieldValue === undefined || fieldValue === null || String(fieldValue).trim() === "") {
							continue;
						}
						item.setField(fieldName, String(fieldValue));
					}
					await item.saveTx();
					created.push(serializeZoteroItem(item));
				}
				return {
					ok: true,
					collection: serializeCollectionLite(collection),
					items: created,
				};
			},
		});

		define({
			id: "srdev.zoteroItemSummary",
			description: "Dev-only: inspect live Zotero item fields and collection memberships by key.",
			inputShape: {
				item_key: "optional one Zotero item key",
				item_keys: "optional array of Zotero item keys",
				library_id: "optional Zotero library id",
			},
			execute: async (args = {}) => {
				let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
				let itemKeys = normalizeItemKeys(args);
				if (!itemKeys.length) {
					throw new Error("item_key or item_keys is required.");
				}
				let items = itemKeys.map((key) => {
					let item = Zotero.Items.getByLibraryAndKey(libraryID, key);
					if (!item || item.deleted) {
						return {
							item_key: key,
							found: false,
						};
					}
					return Object.assign({
						found: true,
					}, serializeZoteroItem(item));
				});
				return {
					ok: true,
					library_id: libraryID,
					items,
				};
			},
		});

		define({
			id: "srdev.zoteroEraseItems",
			description: "Dev-only: erase disposable Zotero items by key.",
			inputShape: {
				item_key: "optional one Zotero item key",
				item_keys: "optional array of Zotero item keys",
				library_id: "optional Zotero library id",
				ignore_missing: "optional boolean, defaults to true",
			},
			execute: async (args = {}) => {
				let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
				let ignoreMissing = args.ignore_missing !== false;
				let itemKeys = normalizeItemKeys(args);
				if (!itemKeys.length) {
					throw new Error("item_key or item_keys is required.");
				}
				let erased = [];
				let missing = [];
				for (let itemKey of itemKeys) {
					let item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
					if (!item || item.deleted) {
						missing.push(itemKey);
						if (!ignoreMissing) {
							throw new Error(`Item ${itemKey} was not found.`);
						}
						continue;
					}
					await item.eraseTx();
					erased.push(itemKey);
				}
				return {
					ok: true,
					library_id: libraryID,
					erased,
					missing,
				};
			},
		});

		define({
			id: "srdev.uiOpenAttachmentDefault",
			description: "Dev-only: open one markdown attachment through the in-app markdown viewer path.",
			inputShape: {
				attachment_key: "required markdown attachment key",
				library_id: "optional Zotero library id",
			},
			execute: async (args = {}) => {
				let item = resolveAttachmentItem(args);
				let opened = await reviewer._maybeOpenMarkdownAttachmentViewer(item, {});
				if (!opened) {
					throw new Error("Attachment did not resolve to the markdown viewer path.");
				}
				let hit = resolveMarkdownViewer(args);
				return Object.assign({
					opened: true,
				}, markdownViewerControllerState(hit.controller, hit.tab));
			},
		});

		define({
			id: "srdev.uiMarkdownViewerState",
			description: "Dev-only: inspect the live state of one markdown viewer tab.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				return markdownViewerControllerState(hit.controller, hit.tab);
			},
		});

		define({
			id: "srdev.uiMarkdownViewerGoToPage",
			description: "Dev-only: drive the markdown pane to one page and sync PDF.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
				page: "required page number",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				let page = reviewer._jumpMarkdownViewerToPage(hit.controller, Number(args.page || 1) || 1);
				await Zotero.Promise.delay(120);
				return Object.assign({
					requested_page: page,
				}, markdownViewerControllerState(hit.controller, hit.tab));
			},
		});

		define({
			id: "srdev.uiMarkdownViewerPdfGoToPage",
			description: "Dev-only: drive the embedded PDF pane to one page and sync markdown.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
				page: "required page number",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				await reviewer._navigateMarkdownViewerPdf(hit.controller, Number(args.page || 1) || 1);
				await Zotero.Promise.delay(200);
				return markdownViewerControllerState(hit.controller, hit.tab);
			},
		});

		define({
			id: "srdev.uiMarkdownViewerSetRaw",
			description: "Dev-only: replace raw markdown editor content in one markdown viewer tab.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
				content: "required raw markdown content",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				setMarkdownViewerRawContent(hit.controller, String(args.content || ""));
				return markdownViewerControllerState(hit.controller, hit.tab);
			},
		});

		define({
			id: "srdev.uiMarkdownViewerSave",
			description: "Dev-only: save the active raw markdown editor content back to disk.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				await reviewer._saveMarkdownViewer(hit.controller);
				return markdownViewerControllerState(hit.controller, hit.tab);
			},
		});

		define({
			id: "srdev.uiMarkdownViewerBrowserDebug",
			description: "Dev-only: inspect the embedded PDF browser state for one dual markdown viewer tab.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				let browser = hit.controller?.pdfHandle?.browser || hit.controller?.els?.pdfHost?.querySelector?.("browser") || null;
				let win = browser?.contentWindow || null;
				let doc = browser?.contentDocument || win?.document || null;
				return {
					ok: true,
					browser_present: !!browser,
					current_uri: String(browser?.currentURI?.spec || ""),
					content_title: String(browser?.contentTitle || ""),
					window_href: String(win?.location?.href || ""),
					doc_title: String(doc?.title || ""),
					doc_ready_state: String(doc?.readyState || ""),
					doc_content_type: String(doc?.contentType || ""),
					pdfjs_present: !!win?.PDFViewerApplication,
					pdfjs_keys: Object.keys(win?.PDFViewerApplication || {}).slice(0, 80),
				};
			},
		});

		define({
			id: "srdev.uiMarkdownViewerFind",
			description: "Dev-only: click the dual viewer Find UI and drive the visible PDF search controls.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
				query: "optional search text; omit to just open the native find popup",
				direction: "optional next or prev",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				hit.controller?.els?.pdfFindBtn?.click?.();
				await Zotero.Promise.delay(120);
				let query = String(args.query || "");
				if (query) {
					let field = hit.controller?.els?.pdfSearchInput || null;
					if (!field) {
						throw new Error("Visible PDF search field is not available.");
					}
					field.focus?.();
					field.value = query;
					let win = field.ownerDocument?.defaultView || null;
					for (let eventType of ["input", "change", "search"]) {
						field.dispatchEvent?.(new win.Event(eventType, { bubbles: true }));
					}
					await Zotero.Promise.delay(350);
					if (String(args.direction || "next").toLowerCase() == "prev") {
						hit.controller?.els?.pdfFindPrevBtn?.click?.();
					}
					else {
						hit.controller?.els?.pdfFindNextBtn?.click?.();
					}
				}
				await Zotero.Promise.delay(300);
				return markdownViewerControllerState(hit.controller, hit.tab);
			},
		});

		define({
			id: "srdev.uiMarkdownViewerFindDebug",
			description: "Dev-only: inspect live embedded PDF search capabilities in the dual markdown viewer tab.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				let handle = hit.controller?.pdfHandle || null;
				let shellReader = reviewer._markdownViewerShellReader(handle);
				let app = handle?.readerWindow?.PDFViewerApplication || null;
				let viewer = app?.pdfViewer || null;
				let pageIndex = Math.max(0, (Number(app?.page || 1) || 1) - 1);
				let pageView = viewer?._pages?.[pageIndex] || null;
				let search = reviewer._markdownViewerPdfSearchAPI(hit.controller);
				let collectKeys = (obj) => Object.keys(obj || {}).filter((key) => /find/i.test(key)).sort();
				let collectTextKeys = (obj) => Object.keys(obj || {}).filter((key) => /text|layer/i.test(key)).sort();
				return {
					ok: true,
					app_find_keys: collectKeys(app),
					viewer_text_keys: collectTextKeys(viewer),
					viewer_text_layer_mode: viewer?.textLayerMode,
					page_view_text_keys: collectTextKeys(pageView),
					page_view_has_text_layer: !!pageView?.textLayer,
					page_view_has_text_layer_div: !!pageView?.textLayer?.div,
					layer_properties_text_keys: collectTextKeys(viewer?._layerProperties),
					find_bar_type: typeof app?.findBar,
					find_bar_keys: collectKeys(app?.findBar),
					find_bar_open_type: typeof app?.findBar?.open,
					find_bar_close_type: typeof app?.findBar?.close,
					find_bar_dispatch_type: typeof app?.findBar?.dispatchEvent,
					find_bar_field_present: !!app?.findBar?.findField,
					find_controller_type: typeof search.findController,
					find_controller_execute_type: typeof search.findController?.executeCommand,
					find_controller_keys: collectKeys(search.findController),
					event_bus_dispatch_type: typeof search.eventBus?.dispatch,
					shell_reader_find_keys: collectKeys(shellReader),
					shell_reader_state_find_keys: collectKeys(shellReader?._state),
				};
			},
		});

		define({
			id: "srdev.uiMarkdownViewerPdfDomDebug",
			description: "Dev-only: inspect current embedded PDF page DOM in the dual markdown viewer tab.",
			inputShape: {
				attachment_key: "optional markdown attachment key",
				library_id: "optional Zotero library id",
				tab_id: "optional markdown viewer tab id",
			},
			execute: async (args = {}) => {
				let hit = resolveMarkdownViewer(args);
				let pdfDoc = hit.controller?.pdfHandle?.readerWindow?.document || null;
				let pageNumber = Number(hit.controller?.pdfHandle?.readerWindow?.PDFViewerApplication?.page || 1) || 1;
				let pageNode = pdfDoc?.querySelector?.(`.page[data-page-number="${pageNumber}"]`) || null;
				let textLayer = pageNode?.querySelector?.(".textLayer") || null;
				return {
					ok: true,
					page: pageNumber,
					page_present: !!pageNode,
					text_layer_present: !!textLayer,
					text_span_count: Number(textLayer?.querySelectorAll?.("span")?.length || 0) || 0,
					highlight_count: Number(pageNode?.querySelectorAll?.(".highlight, .sr-md-viewer-pdf-search-hit")?.length || 0) || 0,
					selected_highlight_count: Number(pageNode?.querySelectorAll?.(".highlight.selected, .sr-md-viewer-pdf-search-hit.is-selected")?.length || 0) || 0,
					text_layer_html: String(textLayer?.innerHTML || "").slice(0, 4000),
				};
			},
		});

		define({
			id: "srdev.uiAllWindowsList",
			description: "Dev-only: list open Zotero main windows and Systematic Reviewer tab placement.",
			inputShape: {},
			execute: async () => ({
				ok: true,
				windows: summarizeWindows(),
			}),
		});

		define({
			id: "srdev.uiWorkflowState",
			description: "Dev-only: inspect one live workflow tab's applied UI scale and computed font sizes.",
			inputShape: {
				project_id: "optional project id",
				tab_id: "optional workflow tab id",
			},
			execute: async (args = {}) => {
				let hit = resolveWorkflow(args);
				let doc = workflowDocument(hit);
				let win = doc?.defaultView || null;
				let root = doc?.documentElement || null;
				let body = doc?.body || null;
				let activeTab = doc?.querySelector?.(".mw-tab.is-active") || null;
				let status = doc?.querySelector?.(".mw-status") || null;
				let automationPreviewBody = doc?.querySelector?.(".sr-page-body, .sr-page-editor-body, .sr-simple-md-page-body") || null;
				let styleOf = (node) => {
					try {
						return node && win ? win.getComputedStyle(node) : null;
					}
					catch (_error) {
						return null;
					}
				};
				return {
					ok: true,
					tab_id: String(hit.tab?.id || ""),
					project_id: String(hit.tab?.data?.projectID || hit.tab?.data?.project_id || ""),
					url: String(hit.browser?.currentURI?.spec || ""),
					doc_ready_state: String(doc?.readyState || ""),
					doc_title: String(doc?.title || ""),
					body_text_preview: String(body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400),
					html_preview: String(root?.outerHTML || "").slice(0, 1200),
					automation_chat_present: !!doc?.querySelector?.("[data-automation-chat-log='true']"),
					scale_var: String(root?.style?.getPropertyValue?.("--mw-ui-scale") || ""),
					root_font_scale_attr: String(root?.getAttribute?.("data-zotero-font-scale") || ""),
					body_font_size: String(styleOf(body)?.fontSize || ""),
					active_tab: String(activeTab?.getAttribute?.("data-tab") || ""),
					tab_font_size: String(styleOf(activeTab)?.fontSize || ""),
					status_font_size: String(styleOf(status)?.fontSize || ""),
					automation_document_font_size: String(styleOf(automationPreviewBody)?.fontSize || ""),
				};
			},
		});

		define({
			id: "srdev.uiZoteroFontSizeAction",
			description: "Dev-only: invoke Zotero's native View -> Font Size Bigger/Smaller/Reset handler in the primary window.",
			inputShape: {
				action: "required bigger | smaller | reset",
				repeat: "optional repeat count for bigger/smaller",
			},
			execute: async (args = {}) => {
				let action = String(args.action || "").trim().toLowerCase();
				if (!["bigger", "smaller", "reset"].includes(action)) {
					throw new Error("action must be bigger, smaller, or reset.");
				}
				let repeat = Math.max(1, Math.min(10, Number(args.repeat || 1) || 1));
				let win = reviewer._primaryWindow();
				let standalone = win?.ZoteroStandalone || null;
				let doc = win?.document || null;
				let sizes = ["0.77", "0.85", "0.92", "1.00", "1.08", "1.15", "1.23"];
				let applyViaPrefs = () => {
					for (let index = 0; index < repeat; index += 1) {
						if (action == "reset") {
							Zotero.Prefs.clear("fontSize");
							continue;
						}
						let fontSize = String(Zotero.Prefs.get("fontSize") || "1.00");
						let nextSize = fontSize;
						if (action == "bigger") {
							for (let size of sizes) {
								if (size > fontSize) {
									nextSize = size;
									break;
								}
							}
						}
						else {
							for (let sizeIndex = sizes.length - 1; sizeIndex >= 0; sizeIndex -= 1) {
								if (fontSize > sizes[sizeIndex]) {
									nextSize = sizes[sizeIndex];
									break;
								}
							}
						}
						Zotero.Prefs.set("fontSize", nextSize);
					}
				};
				if (standalone?.onViewMenuItemClick && doc?.getElementById) {
					let menuItem = doc.getElementById(`view-menuitem-font-size-${action}`);
					if (menuItem) {
						if (typeof standalone.onViewMenuOpen == "function") {
							try {
								standalone.onViewMenuOpen({ target: { id: "view-menu" } });
							}
							catch (_error) {}
						}
						for (let index = 0; index < repeat; index += 1) {
							standalone.onViewMenuItemClick({ originalTarget: menuItem });
						}
					}
					else {
						applyViaPrefs();
					}
				}
				else {
					applyViaPrefs();
				}
				await Zotero.Promise.delay(50);
				return {
					ok: true,
					action,
					repeat,
					font_size_pref: String(Zotero.Prefs.get("fontSize") || "1.00"),
				};
			},
		});

		define({
			id: "srdev.uiCloseExternalWindows",
			description: "Dev-only: close non-primary Zotero windows that only contain Systematic Reviewer tabs.",
			inputShape: {},
			execute: async () => {
				let primary = reviewer._primaryWindow();
				let closed = [];
				for (let win of reviewer._mainWindows()) {
					if (!win || win === primary || win.closed) {
						continue;
					}
					let summary = summarizeWindow(win);
					let tabs = Array.isArray(summary.tabs) ? summary.tabs : [];
					let nonSrTabs = tabs.filter((tab) => !tab.kind);
					let onlyLibraryPlusSr = nonSrTabs.every((tab) => String(tab.type || "") === "library");
					if (!summary.sr_tab_count || !onlyLibraryPlusSr) {
						continue;
					}
					let windowTitle = summary.title;
					try {
						win.close();
						closed.push({
							title: windowTitle,
							tab_count: summary.tab_count,
							sr_tab_count: summary.sr_tab_count,
						});
					}
					catch (_err) {}
				}
				return {
					ok: true,
					closed,
					remaining: summarizeWindows(),
				};
			},
		});

		define({
			id: "srdev.uiAutomationOpen",
			description: "Dev-only: open the real Automation workspace tab and return a rendered chat/UI snapshot.",
			inputShape: {
				project_id: "optional stored project id",
				tab_id: "optional workflow tab id",
				new_tab: "optional boolean to force a fresh workflow tab",
				timeout_ms: "optional wait timeout in milliseconds",
			},
			execute: async (args = {}) => {
				let resolved = await resolveAutomationWorkflow(args, { open: true });
				return await automationChatSnapshot(resolved.current, resolved.hit, {
					action: "open",
				});
			},
		});

		define({
			id: "srdev.uiAutomationChatState",
			description: "Dev-only: inspect the live rendered Automation chat UI, including visible messages, queue rows, model controls, and run status.",
			inputShape: {
				project_id: "optional stored project id",
				tab_id: "optional workflow tab id",
				open_if_missing: "optional boolean, defaults to true",
				timeout_ms: "optional wait timeout in milliseconds",
			},
			execute: async (args = {}) => {
				let resolved = await resolveAutomationWorkflow(args, {
					open: args.open_if_missing !== false,
				});
				return await automationChatSnapshot(resolved.current, resolved.hit, {
					action: "inspect",
				});
			},
		});

		define({
			id: "srdev.uiAutomationChatNewSession",
			description: "Dev-only: click New Session in the real Automation tab and return the refreshed rendered chat snapshot.",
			inputShape: {
				project_id: "optional stored project id",
				tab_id: "optional workflow tab id",
				timeout_ms: "optional wait timeout in milliseconds",
			},
			execute: async (args = {}) => {
				let resolved = await resolveAutomationWorkflow(args, { open: true });
				let before = await automationChatSnapshot(resolved.current, resolved.hit);
				let button = resolved.doc?.querySelector?.("[data-automation-action='new-session']") || null;
				if (!button) {
					throw new Error("Automation New Session button was not found.");
				}
				triggerClick(button);
				return await waitForAutomationSnapshot(
					resolved.current,
					resolved.hit,
					(snapshot) => String(snapshot?.session_id || "").trim()
						&& String(snapshot?.session_id || "").trim() != String(before?.session_id || "").trim(),
					{
						timeoutMs: automationTimeoutMs(args),
						description: "Automation new session",
						extra: { action: "new_session" },
					}
				);
			},
		});

		define({
			id: "srdev.uiAutomationChatSelectModel",
			description: "Dev-only: set the Automation session chat preset and optional reasoning effort through the live Automation UI controls.",
			inputShape: {
				project_id: "optional stored project id",
				tab_id: "optional workflow tab id",
				preset_id: "required chat preset id such as default or session_chat-preset-1",
				reasoning_effort: "optional Default | Low | Medium | High",
				timeout_ms: "optional wait timeout in milliseconds",
			},
			execute: async (args = {}) => {
				let resolved = await resolveAutomationWorkflow(args, { open: true });
				let presetID = String(args.preset_id || args.presetID || "").trim();
				if (!presetID) {
					throw new Error("preset_id is required.");
				}
				let modelSelect = resolved.doc?.querySelector?.("[data-automation-chat-model-select='true']") || null;
				if (!modelSelect) {
					throw new Error("Automation model selector was not found.");
				}
				let validPreset = Array.from(modelSelect.options || []).some((option) => String(option?.value || "").trim() == presetID);
				if (!validPreset) {
					throw new Error(`Automation chat preset ${presetID} was not found in the live UI.`);
				}
				if (modelSelect.disabled) {
					throw new Error("Automation model selector is disabled while a run is active.");
				}
				setFormValue(modelSelect, presetID);
				dispatchChange(modelSelect);
				let snapshot = await waitForAutomationSnapshot(
					resolved.current,
					resolved.hit,
					(next) => String(next?.selected_preset_id || "").trim() == presetID,
					{
						timeoutMs: automationTimeoutMs(args),
						description: "Automation model change",
						extra: { action: "set_model" },
					}
				);
				if (Object.prototype.hasOwnProperty.call(args || {}, "reasoning_effort") || Object.prototype.hasOwnProperty.call(args || {}, "reasoningEffort")) {
					let requested = normalizeReasoningEffort(args.reasoning_effort ?? args.reasoningEffort);
					let reasoningSelect = resolved.doc?.querySelector?.("[data-automation-chat-reasoning-select='true']") || null;
					if (!reasoningSelect || reasoningSelect.hidden || reasoningSelect.disabled) {
						if (requested) {
							throw new Error("Reasoning effort is not available for the selected live Automation preset.");
						}
						return snapshot;
					}
					setFormValue(reasoningSelect, requested);
					dispatchChange(reasoningSelect);
					snapshot = await waitForAutomationSnapshot(
						resolved.current,
						resolved.hit,
						(next) => String(next?.reasoning_value || "").trim().toLowerCase() == requested,
						{
							timeoutMs: automationTimeoutMs(args),
							description: "Automation reasoning change",
							extra: { action: "set_reasoning" },
						}
					);
				}
				return snapshot;
			},
		});

		define({
			id: "srdev.uiAutomationChatSend",
			description: "Dev-only: drive the real Automation chat composer/send button and wait for started, live, or complete UI state.",
			inputShape: {
				project_id: "optional stored project id",
				tab_id: "optional workflow tab id",
				message: "required user message to put in the live Automation composer",
				wait_for: "optional started | live | complete, defaults to started",
				timeout_ms: "optional wait timeout in milliseconds",
			},
			execute: async (args = {}) => {
				let message = String(args.message || args.content || "").trim();
				if (!message) {
					throw new Error("message is required.");
				}
				let waitFor = normalizeAutomationWaitFor(args.wait_for || args.waitFor || "started");
				let resolved = await resolveAutomationWorkflow(args, { open: true });
				let before = await automationChatSnapshot(resolved.current, resolved.hit);
				let input = resolved.doc?.querySelector?.(".sr-workspace-chat-input") || null;
				let sendButton = resolved.doc?.querySelector?.("[data-automation-action='send']") || null;
				if (!input || !sendButton) {
					throw new Error("Automation chat composer controls were not found.");
				}
				if (input.disabled || sendButton.disabled) {
					throw new Error("Automation chat send controls are disabled.");
				}
				setTextAreaValue(input, message);
				triggerClick(sendButton);
				return await waitForAutomationSnapshot(
					resolved.current,
					resolved.hit,
					(snapshot) => automationWaitSatisfied(waitFor, before, snapshot),
					{
						timeoutMs: automationTimeoutMs(args),
						description: `Automation chat ${waitFor}`,
						extra: {
							action: "send",
							wait_for: waitFor,
							requested_message: message,
						},
					}
				);
			},
		});

		define({
			id: "srdev.uiAutomationChatStop",
			description: "Dev-only: click Stop in the real Automation chat UI and wait until the run is no longer active.",
			inputShape: {
				project_id: "optional stored project id",
				tab_id: "optional workflow tab id",
				timeout_ms: "optional wait timeout in milliseconds",
			},
			execute: async (args = {}) => {
				let resolved = await resolveAutomationWorkflow(args, { open: true });
				let stopButton = resolved.doc?.querySelector?.("[data-automation-action='stop']") || null;
				if (!stopButton || stopButton.hidden || stopButton.disabled) {
					return await automationChatSnapshot(resolved.current, resolved.hit, {
						action: "stop",
						stopped: false,
					});
				}
				triggerClick(stopButton);
				return await waitForAutomationSnapshot(
					resolved.current,
					resolved.hit,
					(snapshot) => !snapshotIndicatesRunning(snapshot),
					{
						timeoutMs: automationTimeoutMs(args),
						description: "Automation chat stop",
						extra: {
							action: "stop",
							stopped: true,
						},
					}
				);
			},
		});

			define({
				id: "srdev.agentSessionSend",
				description: "Dev-only: send one message through the shared agent session router and return the full debug session bundle.",
				inputShape: {
					project_id: "optional stored project id",
					session_id: "optional existing session id",
					new_session: "optional boolean to create a new session first",
					title: "optional new session title",
					message: "required chat message",
					objective: "optional objective override for the returned turn packet",
				},
				execute: async (args = {}) => {
					let message = String(args.message || args.content || "").trim();
					if (!message) {
						throw new Error("message is required.");
					}
					let resolved = await resolveSessionRuntime(args, { allowCreate: true });
					await reviewer._sessionMessage(
						resolved.current,
						resolved.sessionID,
						message,
						{ origin: "api", emitProgress: false, surface: "external" }
					);
					return await sessionDebugBundle(resolved.current, resolved.sessionID, {
						objective: args.objective || message,
					});
				},
			});

			define({
				id: "srdev.agentSessionInspect",
				description: "Dev-only: inspect one full agent session including transcript, timeline, and persisted session files.",
				inputShape: {
					project_id: "optional stored project id",
					session_id: "optional existing session id",
					objective: "optional objective override for the returned turn packet",
				},
				execute: async (args = {}) => {
					let resolved = await resolveSessionRuntime(args, { allowCreate: false });
					return await sessionDebugBundle(resolved.current, resolved.sessionID, {
						objective: args.objective || "",
					});
				},
			});

			return registry;
		}

	function normalizeRuntimeRoleID(value = "") {
		let roleID = String(value || "").trim();
		return ["session_chat", "data_extraction", "pdf_vlm", "embeddings"].includes(roleID) ? roleID : "";
	}

	function normalizeItemKeys(args = {}) {
		let itemKeys = [];
		let single = String(args.item_key || args.itemKey || "").trim();
		if (single) {
			itemKeys.push(single);
		}
		if (Array.isArray(args.item_keys)) {
			for (let value of args.item_keys) {
				let clean = String(value || "").trim();
				if (clean) {
					itemKeys.push(clean);
				}
			}
		}
		return Array.from(new Set(itemKeys));
	}

	function resolveCollectionTarget(args = {}) {
		let collectionKey = String(args.collection_key || args.collectionKey || "").trim();
		let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
		if (!collectionKey) {
			throw new Error("collection_key is required.");
		}
		let collection = reviewer._collectionByKey(libraryID, collectionKey);
		if (!collection) {
			throw new Error("Collection was not found.");
		}
		return collection;
	}

	function serializeCollectionLite(collection) {
		if (!collection) {
			return null;
		}
		return {
			library_id: Number(collection.libraryID || 0) || 0,
			collection_id: Number(collection.id || 0) || 0,
			collection_key: String(collection.key || ""),
			name: String(collection.name || ""),
			parent_collection_key: String(collection.parentKey || ""),
		};
	}

	function serializeZoteroItem(item) {
		let collectionIDs = [];
		try {
			collectionIDs = item?.getCollections?.() || [];
		}
		catch (_error) {
			collectionIDs = [];
		}
		let collections = collectionIDs
			.map((collectionID) => Zotero.Collections.get(collectionID))
			.filter(Boolean)
			.map((collection) => serializeCollectionLite(collection));
		return {
			item_id: Number(item?.id || 0) || 0,
			item_key: String(item?.key || ""),
			item_type: String(item?.itemType || item?.itemTypeID || ""),
			title: String(item?.getField?.("title") || ""),
			doi: String(item?.getField?.("DOI") || ""),
			pmid: String(item?.getField?.("PMID") || ""),
			arxiv: String(item?.getField?.("arXiv") || ""),
			isbn: String(item?.getField?.("ISBN") || ""),
			date: String(item?.getField?.("date") || ""),
			extra: String(item?.getField?.("extra") || ""),
			collections,
			collection_keys: collections.map((entry) => entry.collection_key).filter(Boolean),
		};
	}

		async function buildRuntimeTestConfig(payload = {}) {
		let existing = await reviewer._globalSettings();
		let legacyEndpoints = reviewer._normalizeAIEndpointSettings(
			existing.ai_endpoints || existing.model_endpoints || existing.endpoints || null,
			existing.openai_compatible || null
		);
		let apiConnections = reviewer._normalizeAPIConnections(
			payload.api_connections || existing.api_connections || null,
			legacyEndpoints
		);
		let runtimeRoles = reviewer._normalizeRuntimeRoles(
			payload.runtime_roles || existing.runtime_roles || null,
			apiConnections,
			legacyEndpoints
		);
		let runtimePreferences = reviewer._normalizeRuntimePreferences(
			payload.runtime_preferences || existing.runtime_preferences || null
		);
		apiConnections = await reviewer._refreshLocalConnectionModelCaches(apiConnections);
		let pdfMarkdown = reviewer._normalizePdfMarkdownSettings(
			payload.pdf_markdown || existing.pdf_markdown || null
		);
		let normalizedEndpoints = reviewer._materializeAIEndpointsFromRuntimeRoles(
			apiConnections,
			runtimeRoles,
			legacyEndpoints,
			runtimePreferences
		);
		reviewer._validateAIEndpointSettings(normalizedEndpoints);
		reviewer._validateRuntimeRoles(runtimeRoles, apiConnections);
		reviewer._validateRuntimeRoleModelCapabilities(runtimeRoles, apiConnections);
		let settings = reviewer._normalizeGlobalSettings(Object.assign({}, existing, {
			api_connections: apiConnections,
			runtime_roles: runtimeRoles,
			runtime_preferences: runtimePreferences,
			ai_endpoints: normalizedEndpoints,
			pdf_markdown: pdfMarkdown,
		}));
			return reviewer._buildConversionConfigFromSettings(settings);
		}

		function serializeProjectContext(context) {
			if (!context) {
				return null;
			}
			return {
				projectID: String(context.projectID || ""),
				libraryID: Number(context.libraryID || 0) || 0,
				collectionKey: String(context.collectionKey || ""),
				collectionName: String(context.collectionName || ""),
				projectRoot: String(context.projectRoot || ""),
				databasePath: String(context.databasePath || ""),
				reportPath: String(context.reportPath || ""),
				settingsPath: String(context.settingsPath || ""),
				manifestPath: String(context.manifestPath || ""),
				sessionsDir: String(context.sessionsDir || ""),
				projectType: String(context.projectType || ""),
			};
		}

		async function resolveProjectRuntime(args = {}) {
			let projectID = String(args.project_id || args.projectID || "").trim();
			if (projectID) {
				let runtime = await reviewer._resolveProjectByID(projectID, {
					sessionID: args.session_id || args.sessionID || "",
				});
				if (!runtime) {
					throw new Error(`Project ${projectID} was not found.`);
				}
				return runtime;
			}
			let runtime = (await reviewer._resolveCurrentProject?.()) || (await reviewer._restoreLastProjectSelection?.());
			if (!runtime) {
				throw new Error("Open a collection project first.");
			}
			return runtime;
		}

		async function resolveSessionRuntime(args = {}, options = {}) {
			let allowCreate = options.allowCreate !== false;
			let current = await resolveProjectRuntime(args);
			let requestedSessionID = String(args.session_id || args.sessionID || current?.sessionID || "").trim();
			let needsNewSession = allowCreate && !!(args.new_session || args.newSession);
			let sessionID = requestedSessionID;
			if (needsNewSession || !sessionID) {
				let opened = await reviewer._sessionOpen(current, {
					sessionID,
					newSession: needsNewSession,
					title: String(args.title || "").trim(),
					surface: "external",
				});
				sessionID = String(opened?.session?.session_id || sessionID || "").trim();
			}
			if (!sessionID) {
				sessionID = await reviewer._ensureActiveSession(current.context);
			}
			await reviewer._activateSessionContext(current, sessionID);
			current.sessionID = sessionID;
			return {
				current,
				sessionID,
			};
		}

		async function readOptionalJSON(path = "") {
			if (!path || !(await reviewer._pathExists(path))) {
				return null;
			}
			return await reviewer._readJSONFile(path).catch(() => null);
		}

		async function readOptionalText(path = "") {
			if (!path || !(await reviewer._pathExists(path))) {
				return "";
			}
			return await reviewer._readFileText(path).catch(() => "");
		}

		async function sessionDebugBundle(current, sessionID, options = {}) {
			let context = current?.context;
			let objective = String(options.objective || "").trim();
			let transcript = await reviewer._loadSessionMessages(context, sessionID);
			let timeline = await reviewer._loadSessionTimeline(context, sessionID);
			let session = await reviewer._loadSessionState(context, sessionID);
			let inspection = await reviewer._inspectProjectSession(current);
			let sessionDir = reviewer._joinPath(context.sessionsDir, sessionID);
			let files = {
				meta_path: reviewer._joinPath(sessionDir, "session.json"),
				history_path: reviewer._joinPath(sessionDir, "chat_history.json"),
				trace_path: reviewer._joinPath(sessionDir, "session_trace.json"),
				session_meta: await readOptionalJSON(reviewer._joinPath(sessionDir, "session.json")),
				chat_history: await readOptionalJSON(reviewer._joinPath(sessionDir, "chat_history.json")),
				session_trace: await readOptionalJSON(reviewer._joinPath(sessionDir, "session_trace.json")),
			};
			return {
				ok: true,
				project: serializeProjectContext(context),
				session,
				inspection,
				transcript,
				timeline,
				transcript_count: transcript.length,
				timeline_count: timeline.length,
				tool_events: timeline.filter((entry) => {
					let eventType = String(entry?.event_type || "");
					return String(entry?.role || "") == "tool"
						|| /tool|action_|function_call/.test(eventType)
						|| eventType == "function_call_output";
				}),
				files,
				objective,
			};
		}

	function resolveAttachmentItem(args = {}) {
		let attachmentKey = String(args.attachment_key || args.attachmentKey || "").trim();
		let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
		if (!attachmentKey) {
			throw new Error("attachment_key is required.");
		}
		let item = Zotero.Items.getByLibraryAndKey(libraryID, attachmentKey);
		if (!item || item.deleted || !item.isAttachment?.()) {
			throw new Error("Attachment was not found.");
		}
		return item;
	}

	function resolveMarkdownViewer(args = {}) {
		let tabID = String(args.tab_id || args.tabID || "").trim();
		let attachmentKey = String(args.attachment_key || args.attachmentKey || "").trim();
		let libraryID = Number(args.library_id || args.libraryID || Zotero.Libraries.userLibraryID) || Zotero.Libraries.userLibraryID;
		let hit = findMarkdownViewerController({
			tabID,
			attachmentKey,
			libraryID,
		});
		if (!hit?.controller) {
			throw new Error("Markdown viewer tab was not found.");
		}
		return hit;
	}

	function resolveWorkflow(args = {}) {
		let tabID = String(args.tab_id || args.tabID || "").trim();
		let projectID = String(args.project_id || args.projectID || "").trim();
		let hit = findWorkflowTab({
			tabID,
			projectID,
		});
		if (!hit?.browser) {
			throw new Error("Manual workflow tab was not found.");
		}
		return hit;
	}

	function automationTimeoutMs(args = {}) {
		return Math.max(500, Number(args.timeout_ms || args.timeoutMs || 15000) || 15000);
	}

	function normalizeReasoningEffort(value = "") {
		let next = String(value || "").trim().toLowerCase();
		if (!["", "default", "low", "medium", "high"].includes(next)) {
			throw new Error("reasoning_effort must be Default, Low, Medium, or High.");
		}
		return next == "default" ? "" : next;
	}

	function normalizeAutomationWaitFor(value = "") {
		let next = String(value || "").trim().toLowerCase();
		return ["started", "live", "complete"].includes(next) ? next : "started";
	}

	async function waitForCondition(predicate, options = {}) {
		let timeoutMs = Math.max(250, Number(options.timeoutMs || 5000) || 5000);
		let intervalMs = Math.max(25, Number(options.intervalMs || 80) || 80);
		let deadline = Date.now() + timeoutMs;
		let lastError = null;
		while (Date.now() <= deadline) {
			try {
				let result = await predicate();
				if (result) {
					return result;
				}
			}
			catch (error) {
				lastError = error;
			}
			await Zotero.Promise.delay(intervalMs);
		}
		if (lastError) {
			throw lastError;
		}
		let description = String(options.description || "condition").trim() || "condition";
		throw new Error(`Timed out waiting for ${description}.`);
	}

	async function resolveAutomationWorkflow(args = {}, options = {}) {
		let current = await resolveProjectRuntime(args);
		let timeoutMs = automationTimeoutMs(args);
		let tabID = String(args.tab_id || args.tabID || "").trim();
		let open = options.open !== false;
		if (open) {
			let opened = await reviewer._openWorkflowTab(null, current, {
				activeTab: "automation",
				forceNew: !!(args.new_tab || args.newTab || args.force_new || args.forceNew || options.forceNew),
			});
			tabID = String(opened?.id || tabID || "").trim();
		}
		let resolved = await waitForCondition(() => {
			let found = findWorkflowTab({
				tabID,
				projectID: current?.context?.projectID || "",
			});
			if (!found?.browser) {
				return null;
			}
			let doc = workflowDocument(found);
			return {
				current,
				hit: found,
				doc,
				win: doc?.defaultView || found.browser?.contentWindow || null,
			};
		}, {
			timeoutMs,
			description: "Automation workflow tab",
		});
		await waitForWorkflowBrowserLoad(resolved?.hit || null, timeoutMs).catch(() => null);
		let refreshed = refreshWorkflowHit(resolved?.hit || null, current);
		let doc = workflowDocument(refreshed);
		return {
			current,
			hit: refreshed,
			doc,
			win: doc?.defaultView || refreshed?.browser?.contentWindow || null,
		};
	}

	function workflowDocument(hit = null) {
		try {
			return reviewer?._workflowBrowserDocument?.(hit?.browser)
				|| hit?.browser?.contentDocument
				|| hit?.browser?.contentWindow?.document
				|| hit?.browser?.browsingContext?.currentWindowGlobal?.document
				|| null;
		}
		catch (_error) {
			return null;
		}
	}

	function workflowWindow(hit = null) {
		return workflowDocument(hit)?.defaultView || hit?.browser?.contentWindow || null;
	}

	function safeValue(read, fallback = null) {
		try {
			return read();
		}
		catch (_error) {
			return fallback;
		}
	}

	function refreshWorkflowHit(hit = null, current = null) {
		let tabID = String(hit?.tab?.id || "").trim();
		let projectID = String(current?.context?.projectID || hit?.tab?.data?.projectID || hit?.tab?.data?.project_id || "").trim();
		return findWorkflowTab({
			tabID,
			projectID,
		}) || hit;
	}

	function waitForWorkflowBrowserLoad(hit = null, timeoutMs = 15000) {
		let browser = hit?.browser || null;
		if (!browser) {
			return Promise.resolve();
		}
		let ownerWindow = browser?.ownerGlobal || browser?.ownerDocument?.defaultView || null;
		let ready = () => {
			let currentURL = String(safeValue(() => browser?.contentWindow?.location?.href || browser?.currentURI?.spec || browser?.getAttribute?.("src") || "", "") || "").trim();
			let readyState = String(safeValue(() => reviewer?._workflowBrowserDocument?.(browser)?.readyState || "", "") || "").trim();
			return !!currentURL && currentURL.includes("/systematic-reviewer/workflow/ui/index.html") && readyState == "complete";
		};
		return new Promise((resolve) => {
			let settled = false;
			let finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				try {
					browser?.removeEventListener?.("load", onLoad, true);
				}
				catch (_error) {}
				if (timer && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				resolve();
			};
			let onLoad = () => {
				if (ready()) {
					finish();
				}
			};
			if (ready()) {
				finish();
				return;
			}
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => finish(), Math.max(250, Number(timeoutMs || 15000) || 15000))
				: null;
			try {
				browser?.addEventListener?.("load", onLoad, true);
			}
			catch (_error) {
				finish();
			}
		});
	}

	function triggerClick(node) {
		if (!node) {
			throw new Error("Requested Automation control was not found.");
		}
		node.focus?.();
		node.click?.();
	}

	function setFormValue(node, value = "") {
		if (!node) {
			throw new Error("Requested Automation form control was not found.");
		}
		node.focus?.();
		node.value = String(value || "");
	}

	function dispatchChange(node) {
		if (!node) {
			return;
		}
		let win = node.ownerDocument?.defaultView || null;
		node.dispatchEvent?.(new win.Event("input", { bubbles: true }));
		node.dispatchEvent?.(new win.Event("change", { bubbles: true }));
	}

	function setTextAreaValue(node, value = "") {
		setFormValue(node, value);
		let win = node.ownerDocument?.defaultView || null;
		node.dispatchEvent?.(new win.Event("input", { bubbles: true }));
	}

	function selectTextForNode(node, selector = "", fallback = "") {
		return String(node?.querySelector?.(selector)?.textContent || fallback || "").replace(/\s+/g, " ").trim();
	}

	function automationQueueRows(doc = null) {
		return Array.from(safeValue(() => doc?.querySelectorAll?.("[data-automation-chat-queue-id]") || [], []) || []).map((node) => ({
			queue_id: String(node?.getAttribute?.("data-automation-chat-queue-id") || "").trim(),
			mode: String(node?.getAttribute?.("data-automation-chat-queue-mode") || "").trim(),
			text: selectTextForNode(node, ".sr-chat-queue-text"),
			actions: Array.from(node?.querySelectorAll?.("[data-automation-chat-queue-action]") || []).map((button) =>
				String(button?.getAttribute?.("data-automation-chat-queue-action") || "").trim()
			).filter(Boolean),
		}));
	}

	function automationRenderedMessages(doc = null) {
		return Array.from(safeValue(() => doc?.querySelectorAll?.(".sr-workspace-message") || [], []) || []).map((node, index) => {
			let details = node?.querySelector?.(".sr-workspace-message-details") || null;
			let summary = details?.querySelector?.(".sr-workspace-message-summary") || null;
			let bodyNode = details?.querySelector?.(".sr-workspace-message-details-body")
				|| node?.querySelector?.(".sr-workspace-message-text")
				|| null;
			let titleNode = !details ? node?.querySelector?.(".sr-workspace-message-title") : null;
			return {
				index,
				class_name: String(node?.className || "").trim(),
				title: String(summary?.textContent || titleNode?.textContent || "").replace(/\s+/g, " ").trim(),
				body: String(bodyNode?.textContent || "").replace(/\s+/g, " ").trim(),
				open: !!details?.open,
				uses_details: !!details,
				live: String(node?.className || "").includes("live"),
				reasoning: String(node?.className || "").includes("thinking"),
				tool: String(node?.className || "").includes("tool"),
				status: String(node?.className || "").includes("status"),
			};
		});
	}

	function snapshotIndicatesRunning(snapshot = {}) {
		return snapshot?.stop_button?.visible === true
			|| /working/i.test(String(snapshot?.run_status || ""));
	}

	function automationWaitSatisfied(waitFor = "started", before = {}, after = {}) {
		let beforeMessageCount = Number(before?.message_count || 0) || 0;
		if (waitFor == "complete") {
			return !snapshotIndicatesRunning(after)
				&& (Number(after?.message_count || 0) || 0) >= beforeMessageCount;
		}
		if (waitFor == "live") {
			return snapshotIndicatesRunning(after)
				&& ((Number(after?.open_detail_count || 0) || 0) > 0
					|| (Number(after?.live_message_count || 0) || 0) > 0);
		}
		return snapshotIndicatesRunning(after);
	}

	async function automationChatSnapshot(current, hit, extra = {}) {
		hit = refreshWorkflowHit(hit, current);
		let doc = workflowDocument(hit);
		let bootstrap = null;
		try {
			bootstrap = await SystematicReviewerWorkflowCommands.call("automation.getBootstrap", {
				project_id: current?.context?.projectID || "",
				tab_id: String(hit?.tab?.id || "").trim(),
			});
		}
		catch (_error) {
			bootstrap = null;
		}
		if (!doc) {
			return Object.assign({
				ok: true,
				project: serializeProjectContext(current?.context),
				tab_id: String(hit?.tab?.id || "").trim(),
				project_id: String(current?.context?.projectID || "").trim(),
				active_tab: "",
				url: String(safeValue(() => hit?.browser?.currentURI?.spec || "", "") || "").trim(),
				doc_available: false,
				doc_ready_state: "",
				doc_title: "",
				automation_rendered: false,
				body_text_preview: "",
				html_preview: "",
				session_id: "",
				session_options: [],
				status_text: "",
				run_status: "",
				input_value: "",
				send_button: {
					label: "",
					disabled: false,
					visible: false,
				},
				stop_button: {
					label: "",
					disabled: false,
					visible: false,
				},
				model_button_label: "",
				selected_preset_id: "",
				model_options: [],
				reasoning_visible: false,
				reasoning_disabled: false,
				reasoning_value: "",
				queue: [],
				queue_count: 0,
				message_count: 0,
				open_detail_count: 0,
				live_message_count: 0,
				rendered_messages: [],
				backend: bootstrap ? {
					active_session_id: String(bootstrap?.current_project?.active_session_id || "").trim(),
					runtime_state: bootstrap?.current_project?.session_runtime_state || null,
					chat_budget: bootstrap?.chat_budget || null,
					runtime_options: bootstrap?.runtime_options || null,
				} : null,
			}, extra || {});
		}
		let sessionSelect = safeValue(() => doc.querySelector?.("[data-automation-session-select='true']") || null, null);
		let modelSelect = safeValue(() => doc.querySelector?.("[data-automation-chat-model-select='true']") || null, null);
		let reasoningSelect = safeValue(() => doc.querySelector?.("[data-automation-chat-reasoning-select='true']") || null, null);
		let modelButton = safeValue(() => doc.querySelector?.("[data-automation-chat-model-button='true']") || null, null);
		let sendButton = safeValue(() => doc.querySelector?.("[data-automation-action='send']") || null, null);
		let stopButton = safeValue(() => doc.querySelector?.("[data-automation-action='stop']") || null, null);
		let runStatus = safeValue(() => doc.querySelector?.(".sr-chat-run-status") || null, null);
		let statusNode = safeValue(() => doc.querySelector?.("[data-automation-status='true']") || null, null);
		let input = safeValue(() => doc.querySelector?.(".sr-workspace-chat-input") || null, null);
		let queue = automationQueueRows(doc);
		let messages = automationRenderedMessages(doc);
		let openDetailCount = messages.filter((entry) => entry.open).length;
		let liveMessageCount = messages.filter((entry) => entry.live).length;
		let activeTab = String(safeValue(() => doc.querySelector?.(".mw-tab.is-active")?.getAttribute?.("data-tab") || "", "") || "").trim();
		let automationRendered = !!safeValue(() => doc.querySelector?.("[data-automation-chat-log='true']"), null);
		return Object.assign({
			ok: true,
			project: serializeProjectContext(current?.context),
			tab_id: String(hit?.tab?.id || "").trim(),
			project_id: String(current?.context?.projectID || "").trim(),
			active_tab: activeTab,
			url: String(safeValue(() => hit?.browser?.currentURI?.spec || "", "") || "").trim(),
			doc_available: true,
			doc_ready_state: String(safeValue(() => doc?.readyState || "", "") || ""),
			doc_title: String(safeValue(() => doc?.title || "", "") || ""),
			automation_rendered: automationRendered,
			body_text_preview: String(safeValue(() => doc?.body?.textContent || "", "") || "").replace(/\s+/g, " ").trim().slice(0, 400),
			html_preview: String(safeValue(() => doc?.documentElement?.outerHTML || "", "") || "").slice(0, 1200),
			session_id: String(sessionSelect?.value || "").trim(),
			session_options: Array.from(sessionSelect?.options || []).map((option) => ({
				value: String(option?.value || "").trim(),
				label: String(option?.textContent || "").replace(/\s+/g, " ").trim(),
			})),
			status_text: String(statusNode?.textContent || "").replace(/\s+/g, " ").trim(),
			run_status: String(runStatus?.textContent || "").replace(/\s+/g, " ").trim(),
			input_value: String(input?.value || ""),
			send_button: {
				label: String(sendButton?.textContent || "").replace(/\s+/g, " ").trim(),
				disabled: !!sendButton?.disabled,
				visible: !!sendButton && sendButton.hidden !== true,
			},
			stop_button: {
				label: String(stopButton?.textContent || "").replace(/\s+/g, " ").trim(),
				disabled: !!stopButton?.disabled,
				visible: !!stopButton && stopButton.hidden !== true,
			},
			model_button_label: String(modelButton?.textContent || "").replace(/\s+/g, " ").trim(),
			selected_preset_id: String(modelSelect?.value || "").trim(),
			model_options: Array.from(modelSelect?.options || []).map((option) => ({
				value: String(option?.value || "").trim(),
				label: String(option?.textContent || "").replace(/\s+/g, " ").trim(),
			})),
			reasoning_visible: !!reasoningSelect && reasoningSelect.hidden !== true,
			reasoning_disabled: !!reasoningSelect?.disabled,
			reasoning_value: String(reasoningSelect?.value || "").trim(),
			queue,
			queue_count: queue.length,
			message_count: messages.length,
			open_detail_count: openDetailCount,
			live_message_count: liveMessageCount,
			rendered_messages: messages,
			backend: bootstrap ? {
				active_session_id: String(bootstrap?.current_project?.active_session_id || "").trim(),
				runtime_state: bootstrap?.current_project?.session_runtime_state || null,
				chat_budget: bootstrap?.chat_budget || null,
				runtime_options: bootstrap?.runtime_options || null,
			} : null,
		}, extra || {});
	}

	async function waitForAutomationSnapshot(current, hit, predicate, options = {}) {
		return await waitForCondition(async () => {
			let snapshot = await automationChatSnapshot(current, hit, options.extra || {});
			return await predicate(snapshot) ? snapshot : null;
		}, {
			timeoutMs: Number(options.timeoutMs || 0) || 0,
			description: String(options.description || "Automation UI state").trim(),
		});
	}

	function findWorkflowTab({ tabID = "", projectID = "" } = {}) {
		let nextTabID = String(tabID || "").trim();
		let nextProjectID = String(projectID || "").trim();
		for (let win of reviewer._mainWindows()) {
			let tabs = win?.Zotero_Tabs?._tabs || [];
			for (let tab of tabs) {
				if (tab?.type != reviewer.workflowTabType) {
					continue;
				}
				if (nextTabID && tab.id != nextTabID) {
					continue;
				}
				if (!nextTabID && nextProjectID && String(tab?.data?.projectID || tab?.data?.project_id || "").trim() != nextProjectID) {
					continue;
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
				if (!browser) {
					continue;
				}
				return { win, tab, container, mount, browser };
			}
		}
		return null;
	}

	function findMarkdownViewerController({ tabID = "", attachmentKey = "", libraryID = 0 } = {}) {
		let nextTabID = String(tabID || "").trim();
		let nextAttachmentKey = String(attachmentKey || "").trim();
		let nextLibraryID = Number(libraryID || 0) || 0;
		for (let win of reviewer._mainWindows()) {
			let tabs = win?.Zotero_Tabs?._tabs || [];
			for (let tab of tabs) {
				if (tab?.type != reviewer.markdownViewerTabType) {
					continue;
				}
				if (nextTabID && tab.id != nextTabID) {
					continue;
				}
				if (!nextTabID && nextAttachmentKey && String(tab?.data?.attachmentKey || "").trim() != nextAttachmentKey) {
					continue;
				}
				if (!nextTabID && nextLibraryID && Number(tab?.data?.libraryID || 0) != nextLibraryID) {
					continue;
				}
				let container = null;
				try {
					container = typeof win.Zotero_Tabs.getTabContent == "function"
						? win.Zotero_Tabs.getTabContent(tab.id)
						: win.document.getElementById(tab.id);
				}
				catch (_err) {}
				let mount = container?._systematicReviewerMount || container || null;
				let controller = mount?._systematicReviewerController || null;
				if (!controller) {
					continue;
				}
				return { win, tab, container, mount, controller };
			}
		}
		return null;
	}

	function markdownViewerControllerState(controller, tab = null) {
		let pages = Array.from(controller?.els?.markdownPreview?.querySelectorAll?.(".sr-simple-md-page") || []);
		let shellReader = reviewer._markdownViewerShellReader(controller?.pdfHandle || null);
		let nativeFindBar = reviewer._findMarkdownViewerPdfFindBar(controller?.pdfHandle || null);
		let nativeFindField = reviewer._findMarkdownViewerPdfSearchField(controller?.pdfHandle || null);
		let shellFindState =
			shellReader?._state?.primaryViewFindState
			|| shellReader?._state?.findState
			|| shellReader?._view?._findState
			|| null;
		let pdfApp = controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null;
		let pdfViewer = pdfApp?.pdfViewer || null;
		let pdfScroller = reviewer._markdownViewerPdfScrollContainer(controller);
		let pdfDoc = controller?.pdfHandle?.readerWindow?.document || null;
		let markdownScroller = controller?.mode == "raw"
			? controller?.els?.rawEditor
			: controller?.els?.markdownPreview;
		let pdfPageCount = Number(
			pdfViewer?.pagesCount
			|| pdfApp?.pagesCount
			|| pdfApp?.pdfDocument?.numPages
			|| 0
		) || 0;
		let firstPageBody = controller?.els?.markdownPreview?.querySelector?.(".sr-simple-md-page-body");
		let previewFontSize = 0;
		try {
			previewFontSize = Number.parseFloat(controller?.doc?.defaultView?.getComputedStyle(firstPageBody)?.fontSize || "0") || 0;
		}
		catch (_err) {}
		return {
			ok: true,
			tab_id: String(tab?.id || controller?.body?._systematicReviewerTabID || ""),
			title: String(tab?.title || controller?.doc?.title || ""),
			mode: String(controller?.mode || "preview"),
			document_path: String(controller?.documentPath || ""),
			markdown_zoom_percent: Number(controller?.markdownZoomPercent || 100) || 100,
			dirty: controller?.dirty === true,
			saving: controller?.saving === true,
			current_page: Number(controller?.currentPageNumber || 1) || 1,
			preview_page_count: pages.length,
			active_preview_page: Number(
				controller?.els?.markdownPreview
					?.querySelector?.(".sr-simple-md-page.is-active")
					?.getAttribute?.("data-sr-page-index")
				|| controller?.currentPageNumber
				|| 1
			) || 1,
			preview_hidden: controller?.els?.markdownPreview?.hidden === true,
			preview_height: Number(controller?.els?.markdownPreview?.clientHeight || 0) || 0,
			preview_font_size: previewFontSize,
			raw_length: Number(controller?.els?.rawEditor?.value?.length || 0) || 0,
			raw_hidden: controller?.els?.rawEditor?.hidden === true,
			raw_editor_height: Number(controller?.els?.rawEditor?.clientHeight || 0) || 0,
			raw_editor_scroll_height: Number(controller?.els?.rawEditor?.scrollHeight || 0) || 0,
			markdown_highlight_count: Number(
				controller?.els?.markdownPreview?.querySelectorAll?.(".sr-md-viewer-match")?.length || 0
			) || 0,
			viewer_findbar_open: controller?.els?.pdfFindBar?.hidden !== true,
			viewer_find_query: String(controller?.els?.pdfSearchInput?.value || ""),
			native_find_button_present: !!reviewer._findMarkdownViewerPdfFindToggle(controller?.pdfHandle || null),
			native_find_popup_open: !!nativeFindBar && !nativeFindBar.classList?.contains?.("hidden") && nativeFindBar.hidden !== true,
			native_find_input_present: !!nativeFindField,
			native_find_query: String(shellFindState?.query || nativeFindField?.value || ""),
			native_find_active: shellFindState?.active === true || !!String(nativeFindField?.value || "").trim(),
			native_find_index: Number(shellFindState?.index ?? -1),
			native_find_result_page: Number(
				shellFindState?.result?.annotation?.position?.pageIndex
				?? ((String(nativeFindField?.value || "").trim() && Number(pdfApp?.page || 0) > 0) ? Number(pdfApp?.page || 1) - 1 : -1)
			),
			pdf_search_query: String(
				nativeFindField?.value
				|| controller?.pdfSearchQuery
				|| ""
			),
			pdf_loaded: !!controller?.pdfHandle?.reader,
			pdf_attachment_key: String(controller?.pdfHandle?.attachmentKey || controller?.viewerRef?.pdfAttachmentKey || ""),
			pdf_page: Number(pdfApp?.page || 1) || 1,
			pdf_page_count: pdfPageCount,
			pdf_scale: Number(pdfViewer?.currentScale || 0) || 0,
			pdf_highlight_count: Number(pdfDoc?.querySelectorAll?.(".highlight, .sr-md-viewer-pdf-search-hit")?.length || 0) || 0,
			pdf_selected_highlight_count: Number(pdfDoc?.querySelectorAll?.(".highlight.selected, .sr-md-viewer-pdf-search-hit.is-selected")?.length || 0) || 0,
			pdf_host_width: Number(controller?.els?.pdfHost?.clientWidth || 0) || 0,
			pdf_host_height: Number(controller?.els?.pdfHost?.clientHeight || 0) || 0,
			pdf_horizontal_scroll_max: Math.max(
				0,
				(Number(pdfScroller?.scrollWidth || 0) || 0) - (Number(pdfScroller?.clientWidth || 0) || 0)
			),
			markdown_horizontal_scroll_max: Math.max(
				0,
				(Number(markdownScroller?.scrollWidth || 0) || 0) - (Number(markdownScroller?.clientWidth || 0) || 0)
			),
			pdf_placeholder_hidden: controller?.els?.pdfPlaceholder?.hidden === true,
			pdf_placeholder: String(controller?.els?.pdfPlaceholder?.textContent || ""),
			status: String(controller?.els?.status?.textContent || ""),
		};
	}

	function setMarkdownViewerRawContent(controller, content = "") {
		if (!controller?.els?.rawEditor) {
			throw new Error("Markdown viewer editor is not available.");
		}
		reviewer._setMarkdownViewerMode(controller, "raw");
		controller.els.rawEditor.value = String(content || "");
		controller.dirty = controller.els.rawEditor.value !== controller.lastSavedMarkdown;
		reviewer._setMarkdownViewerStatus(
			controller,
			controller.dirty ? "Unsaved changes" : "Saved",
			controller.dirty ? "" : "ready"
		);
	}

	function summarizeWindows() {
		return reviewer._mainWindows().map((win) => summarizeWindow(win));
	}

	function summarizeWindow(win) {
		let primary = reviewer._primaryWindow();
		let tabs = Array.isArray(win?.Zotero_Tabs?._tabs) ? win.Zotero_Tabs._tabs : [];
		let serializedTabs = tabs.map((tab) => {
			let kind = tabKind(tab);
			let manualState = kind == "manual"
				? reviewer._inspectWorkflowTabState(win, tab)
				: { activeTab: "", scopeKey: "", url: "" };
			return {
				id: String(tab?.id || ""),
				type: String(tab?.type || ""),
				title: String(tab?.title || ""),
				kind,
				project_id: String(tab?.data?.projectID || tab?.data?.project_id || ""),
				attachment_key: String(tab?.data?.attachmentKey || ""),
				active_tab: String(manualState.activeTab || ""),
				scope_key: String(manualState.scopeKey || ""),
				url: String(manualState.url || ""),
			};
		});
		let srTabCount = serializedTabs.filter((tab) => !!tab.kind).length;
		return {
			title: String(win?.document?.title || ""),
			is_primary: win === primary,
			tab_count: serializedTabs.length,
			sr_tab_count: srTabCount,
			tabs: serializedTabs,
		};
	}

	function tabKind(tab) {
		let type = String(tab?.type || "");
		if (type == reviewer.markdownViewerTabType) {
			return "markdown_viewer";
		}
		return reviewer._projectTabKindFromType(type) || "";
	}

	function PingEndpoint() {}
	PingEndpoint.prototype = {
		supportedMethods: ["GET"],
		supportedDataTypes: "*",
		init(_request) {
			return jsonResponse(200, {
				ok: true,
				namespace: reviewer?.namespace || "systematic-reviewer",
				version: reviewer?.version || null,
				endpoints: {
					ping: `${ENDPOINT_PREFIX}/ping`,
					tools: `${ENDPOINT_PREFIX}/tools`,
					call: `${ENDPOINT_PREFIX}/tools/call`,
				},
				toolCount: toolRegistry.size,
			});
		},
	};

	function ToolsListEndpoint() {}
	ToolsListEndpoint.prototype = {
		supportedMethods: ["GET"],
		supportedDataTypes: "*",
		init(_request) {
			return jsonResponse(200, {
				ok: true,
				tools: listTools(),
			});
		},
	};

	function ToolCallEndpoint() {}
	ToolCallEndpoint.prototype = {
		supportedMethods: ["POST"],
		supportedDataTypes: ["application/json"],
		async init(options) {
			try {
				let toolID = String(options?.data?.tool || options?.data?.toolId || "").trim();
				if (!toolID) {
					return jsonResponse(400, {
						ok: false,
						error: "Request body must include a tool field.",
					});
				}
				let rawArgs = options?.data?.args;
				if (rawArgs === undefined && options?.data && Object.prototype.hasOwnProperty.call(options.data, "arguments")) {
					rawArgs = options.data.arguments;
				}
				let args = {};
				if (typeof rawArgs == "string") {
					args = JSON.parse(rawArgs);
				}
				else if (rawArgs && typeof rawArgs == "object") {
					args = rawArgs;
				}
				let result = await callTool(toolID, args);
				return jsonResponse(200, {
					ok: true,
					tool: toolID,
					result,
				});
			}
			catch (error) {
				return jsonResponse(400, {
					ok: false,
					error: error?.message || String(error),
				});
			}
		},
	};

	function jsonResponse(status, payload) {
		return [status, "application/json", `${JSON.stringify(payload, null, 2)}\n`];
	}

	return {
		register,
		unregister,
		refreshHTTPEndpoints,
		listTools,
		callTool,
	};
})();

var SystematicReviewerOptionalDevRuntime = {
	startup(reviewer) {
		SystematicReviewerAgentDevTools?.register?.(reviewer);
	},
	shutdown() {
		SystematicReviewerAgentDevTools?.unregister?.();
	},
};
