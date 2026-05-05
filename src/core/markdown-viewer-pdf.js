var SystematicReviewerMarkdownViewerPdf = {
	_jumpMarkdownViewerToPage(controller, pageNumber = 1) {
		let nextPage = Math.max(1, Number(pageNumber || 1) || 1);
		controller.currentPageNumber = nextPage;
		this._highlightMarkdownViewerPage(controller, nextPage);
		this._scrollMarkdownViewerToPage(controller, nextPage);
		this._updateMarkdownViewerPdfControls(controller);
		this._syncPdfFromMarkdownViewer(controller, nextPage);
		return nextPage;
	},

	_updateMarkdownViewerPdfControls(controller) {
		if (!controller?.els) {
			return;
		}
		let pdfReady = this._markdownViewerPdfReady(controller);
		let pdfApp = controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null;
		let pdfViewer = pdfApp?.pdfViewer || null;
		let pageCount = Number(
			pdfViewer?.pagesCount
			|| pdfApp?.pagesCount
			|| pdfApp?.pdfDocument?.numPages
			|| 0
		) || 0;
		let currentPage = Number(pdfApp?.page || controller?.currentPageNumber || 1) || 1;
		if (controller.els.pdfPageInput) {
			controller.els.pdfPageInput.value = `${Math.max(1, currentPage)}`;
			controller.els.pdfPageInput.disabled = !pdfReady;
		}
		if (controller.els.pdfPageTotal) {
			controller.els.pdfPageTotal.textContent = `/ ${pageCount || 0}`;
		}
		if (controller.els.pdfGoBtn) {
			controller.els.pdfGoBtn.disabled = !pdfReady;
		}
		if (controller.els.pdfFindBtn) {
			controller.els.pdfFindBtn.disabled = !pdfReady;
		}
		if (controller.els.pdfSearchInput) {
			controller.els.pdfSearchInput.disabled = !pdfReady;
		}
		if (controller.els.pdfFindPrevBtn) {
			controller.els.pdfFindPrevBtn.disabled = !pdfReady;
		}
		if (controller.els.pdfFindNextBtn) {
			controller.els.pdfFindNextBtn.disabled = !pdfReady;
		}
		if (controller.els.pdfFindCloseBtn) {
			controller.els.pdfFindCloseBtn.disabled = !pdfReady;
		}
	},

	async _adjustMarkdownViewerPdfZoom(controller, direction = 1) {
		let pdfApp = controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null;
		let pdfViewer = pdfApp?.pdfViewer || null;
		if (!pdfViewer) {
			return false;
		}
		let currentScale = Number(pdfViewer.currentScale || 0) || 1;
		let nextScale = direction > 0 ? currentScale * 1.15 : currentScale / 1.15;
		nextScale = Math.max(0.4, Math.min(4, nextScale));
		try {
			controller.pdfPresentationMode = "custom";
			controller.pdfCustomScale = nextScale;
			pdfViewer.currentScale = nextScale;
			Zotero.Promise.delay(120).then(() => {
				this._updateMarkdownViewerPdfControls(controller);
				if (controller?.pdfSearchQuery) {
					this._renderMarkdownViewerPdfSearchHighlights(controller).catch(() => {});
				}
			});
			return true;
		}
		catch (_err) {
			return false;
		}
	},

	_applyMarkdownViewerMarkdownZoom(controller) {
		let zoom = Math.max(70, Math.min(220, Number(controller?.markdownZoomPercent || 100) || 100));
		controller.markdownZoomPercent = zoom;
		let scale = zoom / 100;
		if (controller?.els?.markdownPreview) {
			controller.els.markdownPreview.style.setProperty("--sr-md-preview-scale", `${scale}`);
		}
		if (controller?.els?.rawEditor) {
			controller.els.rawEditor.style.fontSize = `${13 * scale}px`;
			controller.els.rawEditor.style.lineHeight = `${1.6 * scale}`;
		}
	},

	_adjustMarkdownViewerMarkdownZoom(controller, delta = 0) {
		controller.markdownZoomPercent = Math.max(70, Math.min(220, Number(controller?.markdownZoomPercent || 100) + Number(delta || 0)));
		this._applyMarkdownViewerMarkdownZoom(controller);
	},

	_markdownViewerPdfTransform(m1 = [], m2 = []) {
		return [
			m1[0] * m2[0] + m1[2] * m2[1],
			m1[1] * m2[0] + m1[3] * m2[1],
			m1[0] * m2[2] + m1[2] * m2[3],
			m1[1] * m2[2] + m1[3] * m2[3],
			m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
			m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
		];
	},

	_clearMarkdownViewerPdfSearchHighlights(controller) {
		let pdfDoc = controller?.pdfHandle?.readerWindow?.document || null;
		for (let node of Array.from(pdfDoc?.querySelectorAll?.(".sr-md-viewer-pdf-search-overlay") || [])) {
			try {
				node.remove();
			}
			catch (_err) {}
		}
	},

	async _renderMarkdownViewerPdfSearchHighlights(controller) {
		this._clearMarkdownViewerPdfSearchHighlights(controller);
		let query = String(controller?.pdfSearchQuery || controller?.els?.pdfSearchInput?.value || "").trim();
		let readerWindow = controller?.pdfHandle?.readerWindow || null;
		let app = readerWindow?.PDFViewerApplication || null;
		let viewer = app?.pdfViewer || null;
		let pdfDoc = readerWindow?.document || null;
		if (!query || !viewer || !pdfDoc) {
			return false;
		}
		let pageNumber = Number(app?.page || controller?.currentPageNumber || 1) || 1;
		let pageIndex = Math.max(0, pageNumber - 1);
		let pageView = viewer?._pages?.[pageIndex] || null;
		let pageNode = pdfDoc.querySelector(`.page[data-page-number="${pageNumber}"]`) || pageView?.div || null;
		if (!pageView?.pdfPage || !pageView?.viewport || !pageNode) {
			return false;
		}
		let token = `${pageNumber}:${query}:${Date.now()}`;
		controller.pdfSearchHighlightToken = token;
		let textContent = await pageView.pdfPage.getTextContent();
		if (controller.pdfSearchHighlightToken != token) {
			return false;
		}
		let viewport = pageView.viewport;
		let styles = textContent?.styles || {};
		let scale = Number(viewport?.scale || 1) || 1;
		let needle = query.toLocaleLowerCase();
		let overlay = pdfDoc.createElement("div");
		overlay.className = "sr-md-viewer-pdf-search-overlay";
		let matches = 0;
		for (let item of textContent?.items || []) {
			let text = String(item?.str || "");
			if (!text || !text.toLocaleLowerCase().includes(needle)) {
				continue;
			}
			let tx = this._markdownViewerPdfTransform(
				this._markdownViewerPdfTransform(viewport.transform, item.transform || [1, 0, 0, 1, 0, 0]),
				[1, 0, 0, -1, 0, 0]
			);
			let angle = Math.atan2(tx[1], tx[0]);
			let fontHeight = Math.hypot(tx[2], tx[3]);
			if (!fontHeight) {
				fontHeight = Math.abs(Number(item?.height || 0) * scale) || 0;
			}
			let width = Math.max(2, Math.abs(Number(item?.width || 0) * scale) || 0);
			if (!fontHeight || !width) {
				continue;
			}
			let style = styles[item.fontName] || {};
			let fontAscent = fontHeight;
			if (Number.isFinite(style.ascent)) {
				fontAscent = style.ascent * fontHeight;
			}
			else if (Number.isFinite(style.descent)) {
				fontAscent = (1 + style.descent) * fontHeight;
			}
			let hit = pdfDoc.createElement("div");
			hit.className = `sr-md-viewer-pdf-search-hit${matches == 0 ? " is-selected" : ""}`;
			hit.style.left = `${tx[4]}px`;
			hit.style.top = `${tx[5] - fontAscent}px`;
			hit.style.width = `${width}px`;
			hit.style.height = `${Math.max(2, fontHeight)}px`;
			if (Math.abs(angle) > 0.01) {
				hit.style.transform = `rotate(${angle}rad)`;
			}
			overlay.appendChild(hit);
			matches++;
		}
		if (!matches) {
			return false;
		}
		pageNode.appendChild(overlay);
		return true;
	},

	_markdownViewerPdfSearchAPI(controller) {
		let app = controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null;
		return {
			app,
			findBar: app?.findBar || null,
			findController: app?.findController || app?.pdfFindController || null,
			eventBus: app?.eventBus || null,
		};
	},

	_setMarkdownViewerPdfSearchUIVisible(controller, visible = true) {
		let nextVisible = !!visible;
		let wasVisible = controller?.els?.pdfFindBar?.hidden !== true;
		if (controller?.els?.pdfFindBar) {
			controller.els.pdfFindBar.hidden = !nextVisible;
		}
		if (controller?.els?.pdfFindBtn) {
			controller.els.pdfFindBtn.classList.toggle("sr-workspace-btn-primary", nextVisible);
		}
		if (nextVisible && !wasVisible) {
			try {
				controller?.els?.pdfSearchInput?.focus?.();
			}
			catch (_err) {}
		}
	},

	_scheduleMarkdownViewerPdfSearch(controller) {
		let win = controller?.doc?.defaultView || null;
		if (!win?.setTimeout) {
			return;
		}
		if (controller.pdfSearchTimer) {
			try {
				win.clearTimeout(controller.pdfSearchTimer);
			}
			catch (_err) {}
		}
		controller.pdfSearchTimer = win.setTimeout(() => {
			controller.pdfSearchTimer = null;
			this._runMarkdownViewerPdfFind(controller, {
				query: controller?.els?.pdfSearchInput?.value || "",
				direction: "next",
			}).catch((error) => this._showError(error));
		}, 180);
	},

	_markdownViewerPdfScrollContainer(controller) {
		return controller?.pdfHandle?.readerWindow?.document?.getElementById?.("viewerContainer") || null;
	},

	_markdownViewerPdfReady(controller) {
		let app = controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null;
		return !!(app?.pdfDocument || controller?.pdfHandle?.reader);
	},

	_updateMarkdownViewerHorizontalScrollControls(_controller) {
	},

	_markdownViewerShellReader(handle) {
		return handle?.reader?._internalReader || handle?.reader || null;
	},

	_markdownViewerShellDocument(handle) {
		return handle?.browser?.contentDocument || handle?.browser?.contentWindow?.document || null;
	},

	_findMarkdownViewerPdfFindToggle(handle) {
		let pdfDoc = handle?.readerWindow?.document || null;
		let pdfToggle = pdfDoc?.querySelector?.("#viewFindButton, button#viewFindButton");
		if (pdfToggle) {
			return pdfToggle;
		}
		let shellDoc = this._markdownViewerShellDocument(handle);
		if (!shellDoc) {
			return null;
		}
		return shellDoc.querySelector(".toolbar-button.find, button[title*='Find' i], button[aria-label*='Find' i]") || null;
	},

	_findMarkdownViewerPdfFindBar(handle) {
		let pdfDoc = handle?.readerWindow?.document || null;
		let pdfBar = pdfDoc?.querySelector?.("#findbar");
		if (pdfBar) {
			return pdfBar;
		}
		let shellDoc = this._markdownViewerShellDocument(handle);
		return shellDoc?.querySelector?.(".find-popup") || null;
	},

	async _goMarkdownViewerPdfToRequestedPage(controller) {
		let requested = Math.max(1, Number(controller?.els?.pdfPageInput?.value || 1) || 1);
		await this._navigateMarkdownViewerPdf(controller, requested);
		await Zotero.Promise.delay(120);
		this._updateMarkdownViewerPdfControls(controller);
	},

	async _waitForMarkdownViewerPdfLocation(controller, timeoutMs = 5000) {
		let startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			let app = controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null;
			let viewer = app?.pdfViewer || null;
			if (viewer && (viewer._location || Number(app?.page || 0) > 0 || Number(viewer?.currentPageNumber || 0) > 0)) {
				return { app, viewer };
			}
			await Zotero.Promise.delay(50);
		}
		return {
			app: controller?.pdfHandle?.readerWindow?.PDFViewerApplication || null,
			viewer: controller?.pdfHandle?.readerWindow?.PDFViewerApplication?.pdfViewer || null,
		};
	},

	_findMarkdownViewerPdfSearchField(handle) {
		let shellDoc = this._markdownViewerShellDocument(handle);
		let shellSelectors = [
			".find-popup input.toolbar-text-input",
			".find-popup input[type='text']",
			".find-popup input",
		];
		for (let selector of shellSelectors) {
			let field = shellDoc?.querySelector?.(selector);
			if (field) {
				return field;
			}
		}
		let pdfDoc = handle?.readerWindow?.document || null;
		let pdfSelectors = [
			"#findInput",
			"#findbar #findInput",
			"input[id='findInput']",
			"input[id*='find' i]",
			"input[placeholder*='find' i]",
			"input[aria-label*='find' i]",
			"input[title*='find' i]",
		];
		for (let selector of pdfSelectors) {
			let field = pdfDoc?.querySelector?.(selector);
			if (field) {
				return field;
			}
		}
		return null;
	},

	async _setMarkdownViewerPdfSearchQuery(handle, query) {
		let field = this._findMarkdownViewerPdfSearchField(handle);
		if (!field) {
			let shellReader = this._markdownViewerShellReader(handle);
			try {
				if (typeof shellReader?.toggleFindPopup == "function") {
					shellReader.toggleFindPopup({ open: true });
				}
			}
			catch (_err) {}
			await Zotero.Promise.delay(120);
			field = this._findMarkdownViewerPdfSearchField(handle);
		}
		if (!field) {
			return false;
		}
		let win = field.ownerDocument?.defaultView || handle?.readerWindow || null;
		field.focus?.();
		if (field.value !== query) {
			try {
				let setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set || null;
				if (setter) {
					setter.call(field, query);
				}
				else {
					field.value = query;
				}
			}
			catch (_err) {
				field.value = query;
			}
			for (let eventType of ["input", "change", "search"]) {
				try {
					field.dispatchEvent(new win.Event(eventType, { bubbles: true }));
				}
				catch (_err) {}
			}
		}
		return true;
	},

	async _stepMarkdownViewerPdfFind(handle, direction = "next") {
		let field = this._findMarkdownViewerPdfSearchField(handle);
		if (!field) {
			return false;
		}
		let pdfDoc = handle?.readerWindow?.document || null;
		let button = pdfDoc?.querySelector?.(
			String(direction || "").toLowerCase() == "prev"
				? "#findPreviousButton"
				: "#findNextButton"
		);
		if (button && typeof button.click == "function") {
			try {
				button.click();
				return true;
			}
			catch (_err) {}
		}
		let win = field.ownerDocument?.defaultView || null;
		if (!win?.KeyboardEvent) {
			return false;
		}
		let prev = String(direction || "").toLowerCase() == "prev";
		try {
			field.focus?.();
			field.dispatchEvent(new win.KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true,
				shiftKey: prev,
			}));
			field.dispatchEvent(new win.KeyboardEvent("keyup", {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true,
				shiftKey: prev,
			}));
			return true;
		}
		catch (_err) {
			return false;
		}
	},

	async _navigateMarkdownViewerPdf(controller, pageNumber = 1) {
		let handle = controller?.pdfHandle || null;
		if (!handle?.readerWindow) {
			return;
		}
		let targetPage = Math.max(1, Number(pageNumber || 1) || 1);
		let { app, viewer } = await this._waitForMarkdownViewerPdfLocation(controller);
		if (viewer?._location && handle.reader?.navigate) {
			try {
				await handle.reader.navigate({
					pageIndex: targetPage - 1,
				});
				return;
			}
			catch (_err) {}
		}
		if (app && "page" in app) {
			app.page = targetPage;
			return;
		}
		if (viewer && "currentPageNumber" in viewer) {
			viewer.currentPageNumber = targetPage;
			return;
		}
		await handle.reader.navigate({
			pageIndex: targetPage - 1,
		});
	},

	async _runMarkdownViewerPdfFind(controller, { query = "", direction = "next" } = {}) {
		let handle = controller?.pdfHandle || null;
		if (!handle?.readerWindow) {
			throw new Error("Embedded PDF preview is not ready.");
		}
		let nextQuery = String(query ?? controller?.els?.pdfSearchInput?.value ?? "").trim();
		this._setMarkdownViewerPdfSearchUIVisible(controller, true);
		if (controller?.els?.pdfSearchInput && controller.els.pdfSearchInput.value != nextQuery) {
			controller.els.pdfSearchInput.value = nextQuery;
		}
		if (!nextQuery) {
			controller.pdfSearchQuery = "";
			controller.lastPdfSearchQuery = "";
			this._dispatchMarkdownViewerPdfSearch(controller, "", { direction, repeat: false, highlightAll: false });
			this._clearMarkdownViewerPdfSearchHighlights(controller);
			return true;
		}
		let isRepeat = controller.lastPdfSearchQuery == nextQuery;
		controller.pdfSearchQuery = nextQuery;
		let applied = this._dispatchMarkdownViewerPdfSearch(controller, nextQuery, {
			direction,
			repeat: isRepeat,
			highlightAll: true,
		});
		if (!applied) {
			throw new Error("PDF search is not available in the embedded reader.");
		}
		controller.lastPdfSearchQuery = nextQuery;
		await Zotero.Promise.delay(isRepeat ? 220 : 420);
		await this._waitForMarkdownViewerPdfSearchHighlights(controller);
		this._updateMarkdownViewerPdfControls(controller);
		return true;
	},

	async _openMarkdownViewerPdfNativeFind(controller) {
		if (!controller?.pdfHandle?.readerWindow) {
			return false;
		}
		this._setMarkdownViewerPdfSearchUIVisible(controller, true);
		let button = this._findMarkdownViewerPdfFindToggle(controller?.pdfHandle || null);
		if (button && typeof button.click == "function") {
			try {
				button.click();
			}
			catch (_err) {}
		}
		await Zotero.Promise.delay(60);
		let field = this._findMarkdownViewerPdfSearchField(controller?.pdfHandle || null);
		try {
			field?.focus?.();
		}
		catch (_err) {}
		return true;
	},

	async _waitForMarkdownViewerPdfSearchHighlights(controller, {
			timeoutMs = 2500,
			intervalMs = 120,
		} = {}) {
			let startedAt = Date.now();
			let rendered = false;
			while (Date.now() - startedAt < timeoutMs) {
				rendered = await this._renderMarkdownViewerPdfSearchHighlights(controller);
				if (rendered) {
					return true;
				}
				await Zotero.Promise.delay(intervalMs);
			}
			return false;
		},
	
	
		_dispatchMarkdownViewerPdfSearch(controller, query, {
			direction = "next",
			repeat = false,
			highlightAll = true,
		} = {}) {
			let search = this._markdownViewerPdfSearchAPI(controller);
			let nextQuery = String(query || "").trim();
			let findPrevious = String(direction || "").toLowerCase() == "prev";
			let state = {
				query: nextQuery,
				phraseSearch: true,
				caseSensitive: false,
				entireWord: false,
				highlightAll: !!highlightAll && !!nextQuery,
				findPrevious,
				matchDiacritics: false,
			};
			if (search.findBar?.findField && typeof search.findBar?.dispatchEvent == "function") {
				try {
					search.findBar.open?.();
				}
				catch (_err) {}
				try {
					search.findBar.findField.value = nextQuery;
				}
				catch (_err) {}
				search.findBar.dispatchEvent(repeat ? "again" : "", findPrevious);
				if (!nextQuery) {
					try {
						search.findBar.close?.();
					}
					catch (_err) {}
				}
				return true;
			}
			if (typeof search.findController?.executeCommand == "function") {
				search.findController.executeCommand(repeat ? "findagain" : "find", state);
				return true;
			}
			if (typeof search.eventBus?.dispatch == "function") {
				search.eventBus.dispatch("find", {
					source: controller,
					type: repeat ? "again" : "",
					...state,
				});
				return true;
			}
			return false;
		},

};
