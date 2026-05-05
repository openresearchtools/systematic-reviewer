var SystematicReviewerMarkdownRendering = {
	_workspaceSettings(controller) {
		let defaults = this._defaultEditorSettings();
		return SystematicReviewerNativeMarkdown.normalizeSettings(
			Object.assign(
				{
					pageViewScale: defaults.pageViewScale,
					citationStyleID: defaults.citationStyleID,
					citationLocale: defaults.citationLocale,
					printPageNumbers: defaults.printPageNumbers,
				},
				controller?.bootstrap?.current_project?.settings?.editor || {}
			)
		);
	},

	_workspaceDocumentExtraCSS(theme = "light") {
		let textColor = String(theme || "").trim().toLowerCase() == "dark" ? "#f2f4f8" : "#1d2024";
		return [
			`.sr-page-sheet-body, .sr-page-sheet-body * { color: ${textColor} !important; }`,
			`.sr-page-sheet-body .sr-block-editable, .sr-page-sheet-body .sr-block-static, .sr-page-sheet-body .sr-native-table-cell { background: transparent !important; color: ${textColor} !important; border: 0 !important; box-shadow: none !important; }`,
			".sr-page-sheet-body .sr-block-editable:focus, .sr-page-sheet-body .sr-native-table-cell:focus { outline: 1px solid rgba(10,132,255,0.30); outline-offset: 2px; }",
			".sr-page-sheet-body .sr-native-block { background: transparent !important; border: 0 !important; box-shadow: none !important; }",
			".sr-page-sheet-body .sr-native-image, .sr-page-sheet-body .sr-native-table-wrap { background: transparent !important; }",
		].join("\n");
	},

	_ensureWorkspaceDocumentStyles(controller) {
		let doc = controller?.doc;
		if (!doc) {
			return;
		}
		let appTheme = this._themeClassForWindow(doc.defaultView) == "theme-dark" ? "dark" : "light";
		let theme = appTheme == "dark" ? (this._previewEditorPageTheme?.() || "light") : "light";
		let style = doc.getElementById("systematic-reviewer-workspace-document-style");
		if (!style) {
			style = doc.createElementNS(HTML_NS, "style");
			style.id = "systematic-reviewer-workspace-document-style";
			doc.documentElement.appendChild(style);
		}
		style.textContent = [
			SystematicReviewerNativeMarkdown.createDocumentCSS({
					settings: this._workspaceSettings(controller),
					theme,
					printMode: false,
				}),
				this._workspaceDocumentExtraCSS(theme),
		].join("\n");
	},

	_scheduleWorkspaceAutosave(controller) {
		if (controller.autosaveTimer) {
			controller.doc.defaultView.clearTimeout(controller.autosaveTimer);
			controller.autosaveTimer = null;
		}
		controller.documentDirty = true;
	},

	_isLocalAbsolutePathLike(value = "") {
		let raw = String(value || "").trim();
		return /^[A-Za-z]:[\\/]/.test(raw)
			|| /^\\\\[^\\]+\\[^\\]+/.test(raw)
			|| /^\/[A-Za-z]:[\\/]/.test(raw);
	},

	_resolveWorkspaceAssetURL(controller, rawPath) {
		let source = String(rawPath || "").trim();
		if (!source) {
			return "";
		}
		if (/^(?:[a-z]+:|\/\/)/i.test(source) && !this._isLocalAbsolutePathLike(source)) {
			return source;
		}
		let documentPath = controller?.documentPath || "";
		if (!documentPath) {
			return source;
		}
		try {
			let absolutePath = this._joinPath(this._parentPath(documentPath), source);
			return Services.io.newFileURI(this._nsIFile(absolutePath)).spec;
		}
		catch (_err) {
			return source;
		}
	},

	_overlayHost(controller) {
		return controller?.els?.overlayHost || controller?.doc?.body || controller?.doc?.documentElement || controller?.body || null;
	},

	_pickerWindowForController(controller) {
		if (controller?.hostType == "window" && controller?.doc?.defaultView) {
			return controller.doc.defaultView;
		}
		return this._primaryWindow() || controller?.doc?.defaultView || null;
	},

	_pickerBrowsingContextForController(controller) {
		let win = this._pickerWindowForController(controller);
		return win?.browsingContext || controller?.doc?.browsingContext || null;
	},

	_initFilePicker(filePicker, controller, title, mode) {
		let browsingContext = this._pickerBrowsingContextForController(controller);
		if (browsingContext) {
			try {
				filePicker.init(browsingContext, title, mode);
				return;
			}
			catch (_err) {}
		}
		try {
			filePicker.init(null, title, mode);
			return;
		}
		catch (_err) {}
		filePicker.init(this._pickerWindowForController(controller), title, mode);
	},

	_renderMarkdownHTML(markdown, controller = null) {
		let activeController = controller?.els ? controller : null;
		let bodyHTML = SystematicReviewerNativeMarkdown.renderHTML(markdown, {
			settings: activeController ? this._workspaceSettings(activeController) : this._defaultEditorSettings(),
			renderCitation: (citation, label) => {
				let markdownToken = SystematicReviewerNativeMarkdown.makeCitationMarkdown(citation);
				let formatted = activeController
					? this._formatCitationHTML(activeController, citation, label)
					: this._escapeHTML(label || "cite");
				return `<span class="sr-citation-ref" data-sr-markdown="${this._escapeHTML(markdownToken)}">${this._xmlSafeHTMLFragment(formatted)}</span>`;
			},
			renderBibliography: (source) => activeController
				? this._xmlSafeHTMLFragment(this._renderBibliographyHTML(activeController, source))
				: `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`,
			renderPrisma: () => activeController?.prismaHTML
				? this._xmlSafeHTMLFragment(activeController.prismaHTML)
				: `<div class="sr-prisma-empty" data-sr-prisma="true">PRISMA diagram is not available.</div>`,
			resolveAssetURL: (assetPath) => this._resolveWorkspaceAssetURL(activeController, assetPath),
		});
		return this._xmlSafeHTMLFragment(`<div class="sr-doc-host">${bodyHTML}</div>`);
	},

	_clearPreviewSurface(controller) {
		if (controller?.els?.preview) {
			controller.els.preview.replaceChildren();
		}
	},

	_clearNativeSurface(controller) {
		if (controller?.els?.nativeEditor) {
			controller.els.nativeEditor.replaceChildren();
		}
	},

	async _exportWorkspacePdf(controller) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			throw new Error("Open a collection project first");
		}
		await this._saveMarkdown(controller, { silent: true });
		let settings = this._workspaceSettings(controller);
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		this._initFilePicker(fp, controller, "Save REPORT.md as PDF", Components.interfaces.nsIFilePicker.modeSave);
		fp.defaultExtension = "pdf";
		fp.defaultString = `${this._sanitizeFileName(current.context.collectionName || "REPORT")}.pdf`;
		fp.appendFilter("PDF", "*.pdf");
		let result = await new Promise((resolve) => fp.open(resolve));
		if (result != Components.interfaces.nsIFilePicker.returnOK && result != Components.interfaces.nsIFilePicker.returnReplace) {
			return;
		}
		let outputPath = fp.file.path;
		let markdown = await this._readFileText(current.context.reportPath);
		let paginatedBodyHTML = SystematicReviewerNativeMarkdown.renderPaginatedPrintDocumentHTML(markdown, {
				settings,
				explicitPageFooters: true,
				strict: true,
				strictTables: true,
				wrapPrintSections: true,
				document: controller?.doc,
				theme: this._themeClassForWindow(controller.doc.defaultView) == "theme-dark" ? "dark" : "light",
			renderCitation: (citation, label) => {
				let markdownToken = SystematicReviewerNativeMarkdown.makeCitationMarkdown(citation);
				let formatted = this._formatCitationHTML(controller, citation, label);
				return `<span class="sr-citation-chip" data-sr-markdown="${this._escapeHTML(markdownToken)}">${formatted}</span>`;
			},
			renderBibliography: (source) => this._renderBibliographyHTML(controller, source),
			renderPrisma: () => controller?.prismaExportHTML
				|| controller?.prismaHTML
				|| `<div class="sr-prisma-empty" data-sr-prisma="true">PRISMA diagram is not available.</div>`,
			resolveAssetURL: (assetPath) => this._resolveWorkspaceAssetURL(controller, assetPath),
		});
		let html = SystematicReviewerNativeMarkdown.createPrintHTML({
			title: current.context.collectionName,
			bodyHTML: paginatedBodyHTML,
			settings,
			baseURL: Services.io.newFileURI(this._nsIFile(this._parentPath(current.context.reportPath))).spec,
			theme: this._themeClassForWindow(controller.doc.defaultView) == "theme-dark" ? "dark" : "light",
			nativeMode: false,
		});
		await this._printHTMLToPDF(controller.doc.defaultView, html, outputPath, settings);
		let exportDir = this._joinPath(current.context.outputsDir, "report-exports");
		await this._ensureDirectory(exportDir);
		let exportStamp = new Date().toISOString().replace(/[:.]/g, "-");
		let archivedPath = this._joinPath(
			exportDir,
			`${exportStamp}-${this._sanitizeFileName(current.context.collectionName || "REPORT")}.pdf`
		);
		if (archivedPath != outputPath) {
			await this._removeIfExists(archivedPath);
			this._copyFileToPath(outputPath, archivedPath);
		}
		await this._reconcileCollectionProject(current.context, current.collection, current.projectItem);
		this._setStatus(controller, `Saved PDF ${this._basename(outputPath)}`, "ready");
	},

	_renderPlainCitationMarkdown(controller, markdown) {
		let source = String(markdown || "");
		let bibliographyText = this._renderBibliographyText(controller, source);
		source = SystematicReviewerNativeMarkdown.replaceCitationMarkdown(source, (citation, rawToken) => {
			return this._formatCitationText(controller, citation, rawToken || "cite");
		});
		return source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
			if (SystematicReviewerNativeMarkdown.isBibliographyURL(href)) {
				return bibliographyText;
			}
			return _match;
		});
	},

	async _exportWorkspaceRenderedMarkdown(controller) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			throw new Error("Open a collection project first");
		}
		await this._saveMarkdown(controller, { silent: true });
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		this._initFilePicker(fp, controller, "Save REPORT.md as plain rendered Markdown", Components.interfaces.nsIFilePicker.modeSave);
		fp.defaultExtension = "md";
		fp.defaultString = `${this._sanitizeFileName(current.context.collectionName || "REPORT")}-plain.md`;
		fp.appendFilter("Markdown", "*.md");
		let result = await new Promise((resolve) => fp.open(resolve));
		if (result != Components.interfaces.nsIFilePicker.returnOK && result != Components.interfaces.nsIFilePicker.returnReplace) {
			return;
		}
		let outputPath = fp.file.path;
		let markdown = await this._readFileText(current.context.reportPath);
		let plainMarkdown = this._renderPlainCitationMarkdown(controller, markdown);
		await this._writeTextFile(outputPath, plainMarkdown);
		this._setStatus(controller, `Saved ${this._basename(outputPath)}`, "ready");
	},

	async _printHTMLToPDF(win, html, outputPath, settings) {
		if (!SystematicReviewerSavePDF?.saveHTMLToPDF) {
			throw new Error("Native PDF export is not available.");
		}
		await SystematicReviewerSavePDF.saveHTMLToPDF({
			win,
			html,
			outputPath,
			settings,
		});
	},

	_xmlSafeHTMLFragment(html) {
		let value = String(html || "");
		let namedEntities = {
			nbsp: "&#160;",
			ndash: "&#8211;",
			mdash: "&#8212;",
			ldquo: "&#8220;",
			rdquo: "&#8221;",
			lsquo: "&#8216;",
			rsquo: "&#8217;",
			hellip: "&#8230;",
			amp: "&amp;",
			lt: "&lt;",
			gt: "&gt;",
			quot: "&quot;",
			apos: "&#39;",
		};
		value = value.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => namedEntities[name] || match);
		value = value.replace(/<br(?=>|\s)([^>]*)>/gi, "<br$1 />");
		value = value.replace(/<hr(?=>|\s)([^>]*)>/gi, "<hr$1 />");
		value = value.replace(/<img([^>]*?)>/gi, (match, attrs) => {
			return /\/\s*>$/.test(match) ? match : `<img${attrs} />`;
		});
		return value;
	},

	_renderWorkspace(controller, documentPayload) {
		if (!documentPayload) {
			controller.documentPath = null;
			controller.els.preview.innerHTML = `<div class="sr-workspace-empty">No REPORT.md is available yet.</div>`;
			controller.els.rawEditor.value = "";
			controller.els.nativeEditor.replaceChildren(
				this._html(controller.doc, "div", {
					className: "sr-workspace-empty",
					text: "No markdown document is available yet.",
				})
			);
			controller.nativeBlocks = [];
			return;
		}
		controller.documentPath = documentPayload.path || null;
		let markdown = documentPayload.markdown || "";
		controller.lastSavedMarkdown = markdown;
		controller.els.rawEditor.value = markdown;
		controller.nativeBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(markdown);
		this._invalidateCitationRenderCaches(controller);
		controller.nativeDirty = false;
		controller.documentDirty = false;
		if (controller.mode == "native") {
			controller.previewStale = true;
			this._clearPreviewSurface(controller);
			this._renderNativeEditor(controller);
		}
		else if (controller.mode == "preview") {
			controller.previewStale = false;
			controller.els.preview.innerHTML = this._renderMarkdownHTML(markdown, controller);
			this._decoratePreview(controller.els.preview);
			this._clearNativeSurface(controller);
		}
		else {
			controller.previewStale = true;
			this._clearPreviewSurface(controller);
			this._clearNativeSurface(controller);
		}
	},

	_renderNativeEditor(controller) {
		let blocks = controller.nativeBlocks || [];
		let outline = SystematicReviewerNativeMarkdown.buildDocumentOutline(blocks);
		let host = this._html(controller.doc, "div", { className: "sr-doc-host" });
		let root = this._html(controller.doc, "div", {
			className: "sr-native-root sr-section-stack",
			attrs: {
				contenteditable: "true",
				spellcheck: "true",
				"data-sr-page-numbers": "false",
			},
		});
		let sections = SystematicReviewerNativeMarkdown.sectionizeBlocks(blocks);
		let firstEditable = null;
		if (!sections.length) {
			sections = [{ layout: "portrait", blocks: [] }];
		}
		sections.forEach((section, sectionIndex) => {
			let sheet = this._html(controller.doc, "section", {
				className: "sr-editor-section",
				attrs: {
					"data-sr-layout": section.layout || "portrait",
					"data-sr-page-index": String(sectionIndex + 1),
					"data-sr-page-source": "manual",
				},
			});
			let body = this._html(controller.doc, "div", {
				className: "sr-editor-section-body sr-page-sheet-body sr-page-editor-body",
				attrs: {
					"data-sr-page-body": "true",
					contenteditable: "true",
					spellcheck: "true",
				},
			});
			let contentBlocks = 0;
			for (let block of section.blocks || []) {
				if (!block) {
					continue;
				}
				let blockNode = this._renderNativeBlock(controller, block, `${sectionIndex}-${contentBlocks}`, outline);
				if (!blockNode) {
					continue;
				}
				body.appendChild(blockNode);
				if (!firstEditable) {
					firstEditable = blockNode.querySelector?.("[data-sr-editable='true']");
				}
				if (!["page-break", "page-layout"].includes(block.type)) {
					contentBlocks += 1;
				}
			}
			if (!contentBlocks) {
				let paragraphBlock = this._createEmptyParagraphBlock(controller);
				body.appendChild(paragraphBlock);
				firstEditable = firstEditable || paragraphBlock.querySelector(".sr-block-editable");
			}
			sheet.appendChild(body);
			root.appendChild(sheet);
		});
		host.appendChild(root);
		controller.els.nativeEditor.replaceChildren(host);
		SystematicReviewerNativeMarkdown.markWrappedProseTableCells(controller.els.nativeEditor);
		controller.tableSelection = null;
		controller.nativeActiveEditable =
			firstEditable
			|| controller.els.nativeEditor.querySelector("[data-sr-editable='true']")
			|| controller.els.nativeEditor.querySelector(".sr-page-editor-body")
			|| null;
	},

	_renderNativeSeparator(controller, markerType, label, attrs = {}) {
		let doc = controller.doc;
		let separator = this._html(doc, "div", {
			className: "sr-section-separator",
			attrs: Object.assign({
				contenteditable: "false",
				"data-sr-editable": "false",
				"data-sr-marker": markerType,
			}, attrs || {}),
		});
		separator.appendChild(this._html(doc, "span", { text: label }));
		return separator;
	},

	_renderNativeBlock(controller, block, index, outline = null) {
		let doc = controller.doc;
		let wrapper = this._html(doc, "div", {
			className: `sr-native-block sr-block-${block.type}`,
			attrs: {
				"data-block-type": block.type,
				"data-index": String(index),
			},
		});
		let blockIndex = Number(outline?.blockIndexByRef?.get?.(block) ?? -1);
		let anchor = blockIndex >= 0 ? String(outline?.blockAnchorByIndex?.get?.(blockIndex) || "").trim() : "";
		let generatedSectionAnchor = anchor;
		let applyAnchor = (node, value) => {
			let clean = String(value || "").trim();
			if (!node || !clean) {
				return;
			}
			node.setAttribute("id", clean);
			node.setAttribute("data-sr-anchor", clean);
		};
		if (block.type == "toc" && outline?.firstIndices?.toc >= 0 && blockIndex != outline.firstIndices.toc) {
			return null;
		}
		if (block.type == "bibliography" || block.type == "prisma") {
			if (outline?.firstIndices?.[block.type] >= 0 && blockIndex != outline.firstIndices[block.type]) {
				return null;
			}
			if (outline?.generatedHeadingReuseByIndex?.has?.(blockIndex)) {
				generatedSectionAnchor = "";
			}
		}
		if (block.type == "page-marker") {
			wrapper.setAttribute("data-page", String(block.page || 1));
			wrapper.appendChild(this._html(doc, "div", {
				className: "sr-page-marker",
				attrs: { contenteditable: "false" },
				children: [this._html(doc, "span", { text: `Page ${block.page || 1}` })],
			}));
			return wrapper;
		}
		if (block.type == "page-break") {
			return this._renderNativeSeparator(controller, "page-break", "Page Break");
		}
		if (block.type == "page-layout") {
			if ((block.layout || "portrait") != "landscape") {
				return null;
			}
			return this._renderNativeSeparator(controller, "page-layout", "Landscape Section", {
				"data-sr-layout": "landscape",
			});
		}
		if (block.type == "bibliography") {
			let placeholder = this._html(doc, "div", {
				className: "sr-block-editable",
				attrs: {
					contenteditable: "false",
					"data-sr-editable": "false",
					"data-sr-markdown": SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN,
				},
			});
			let markdown = "";
			try {
				markdown = SystematicReviewerNativeMarkdown.serializeBlocks(controller.nativeBlocks || []);
			}
			catch (_err) {}
			let bibliographyHTML = this._renderBibliographyHTML(controller, markdown);
			placeholder.innerHTML = this._xmlSafeHTMLFragment(
				bibliographyHTML || `<span class="sr-bibliography-placeholder" data-sr-bibliography="true" data-sr-markdown="${this._escapeHTML(SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN)}">Bibliography</span>`
			);
			applyAnchor(wrapper, generatedSectionAnchor);
			wrapper.append(placeholder);
			return wrapper;
		}
		if (block.type == "toc") {
			let placeholder = this._html(doc, "div", {
				className: "sr-block-editable sr-block-static",
				attrs: {
					contenteditable: "false",
					"data-sr-editable": "false",
					"data-sr-markdown": SystematicReviewerNativeMarkdown.TOC_PLACEHOLDER_MARKDOWN,
				},
			});
			placeholder.innerHTML = SystematicReviewerNativeMarkdown.renderTOCBlockHTML(outline, { includePageNumbers: false });
			applyAnchor(wrapper, anchor);
			wrapper.append(placeholder);
			return wrapper;
		}
		if (block.type == "prisma") {
			let placeholder = this._html(doc, "div", {
				className: "sr-block-editable sr-block-static",
				attrs: {
					contenteditable: "false",
					"data-sr-editable": "false",
					"data-sr-markdown": SystematicReviewerNativeMarkdown.PRISMA_PLACEHOLDER_MARKDOWN,
				},
			});
			placeholder.innerHTML = this._xmlSafeHTMLFragment(
				controller?.prismaHTML || `<div class="sr-prisma-empty" data-sr-prisma="true">PRISMA diagram is not available.</div>`
			);
			applyAnchor(wrapper, generatedSectionAnchor);
			wrapper.append(placeholder);
			return wrapper;
		}
		if (block.type == "table") {
			return this._renderNativeTableBlock(controller, block, index);
		}
		if (block.type == "image") {
			return this._renderNativeImageBlock(controller, block, index);
		}
		if (block.type == "list") {
			wrapper.setAttribute("data-list-kind", block.ordered ? "ol" : "ul");
			let listRoot = this._html(doc, "div", {
				className: "sr-native-list",
			});
			let items = SystematicReviewerNativeMarkdown.normalizeListItems(block.items || []);
			let orderedLabels = block.ordered ? SystematicReviewerNativeMarkdown.orderedListMarkerLabels(items) : [];
			items.forEach((item, itemIndex) => {
				let itemRow = this._html(doc, "div", { className: "sr-native-list-item" });
				this._setListItemLevel(itemRow, item.level || 0);
				itemRow.append(
					this._html(doc, "div", {
						className: "sr-native-list-marker",
						attrs: { contenteditable: "false" },
						text: block.ordered ? (orderedLabels[itemIndex] || `${itemIndex + 1}.`) : "•",
					}),
					this._editableNode(controller, item.text || "")
				);
				listRoot.appendChild(itemRow);
			});
			wrapper.appendChild(listRoot);
			return wrapper;
		}
		if (block.type == "code") {
			let codeText = String(block.text || "");
			let lang = String(block.lang || "").trim();
			let rows = Math.max(6, Math.min(24, codeText.replace(/\r\n?/g, "\n").split("\n").length + 1));
			wrapper.append(
				this._html(doc, "div", {
					className: "sr-code-block-shell",
					children: [
						this._html(doc, "textarea", {
							className: "sr-code-block-input",
							text: codeText,
							attrs: {
								rows: String(rows),
								spellcheck: "false",
								wrap: "soft",
								"data-sr-code": "true",
								"data-sr-editable": "true",
								"data-sr-code-lang": lang,
							},
						}),
					],
				})
			);
			wrapper.setAttribute("data-sr-code-root", "true");
			wrapper.setAttribute("data-sr-code-lang", lang);
			return wrapper;
		}
		let level = block.level || 0;
		if (block.type == "heading") {
			wrapper.classList.add("sr-block-heading");
			wrapper.setAttribute("data-level", String(level));
			applyAnchor(wrapper, anchor);
		}
		wrapper.append(this._editableNode(controller, block.text || ""));
		return wrapper;
	},

	_tableContextEditableNode(controller, markdownText, attrs = {}, extraClass = "sr-table-context") {
		let node = this._editableNode(controller, markdownText || "", extraClass);
		for (let [name, value] of Object.entries(attrs || {})) {
			node.setAttribute(name, value);
		}
		return node;
	},

	_renderNativeImageBlock(controller, block, index) {
		let doc = controller.doc;
		let displaySrc = this._resolveWorkspaceAssetURL(controller, block.src || "");
		let settings = this._workspaceSettings(controller);
		return this._html(doc, "div", {
			className: "sr-native-block sr-block-image",
			attrs: {
				"data-block-type": "image",
				"data-index": String(index),
			},
			children: [
				this._html(doc, "figure", {
					className: "sr-native-image",
					attrs: { "data-sr-table-style": settings.citationStylePreset || "standard" },
					children: [
						this._tableContextEditableNode(controller, block.captionAbove || "", { "data-sr-figure-caption": "true" }, "sr-figure-context sr-figure-caption"),
						this._html(doc, "img", {
							attrs: {
								src: displaySrc,
								alt: block.alt || "",
								"data-sr-original-src": block.src || "",
							},
						}),
						this._tableContextEditableNode(controller, block.noteBelow || "", { "data-sr-figure-note": "true" }, "sr-figure-context sr-figure-note"),
					],
				}),
			],
		});
	},

	_renderNativeTableBlock(controller, block, index) {
		let doc = controller.doc;
		let tableBlock = SystematicReviewerNativeMarkdown.normalizeTableBlock(block);
		let settings = this._workspaceSettings(controller);
		let wrapper = this._html(doc, "div", {
			className: "sr-native-block sr-block-table",
			attrs: {
				"data-block-type": "table",
				"data-index": String(index),
				"data-sr-table-style": settings.citationStylePreset || "standard",
			},
		});
		let table = this._html(doc, "table", { className: "sr-native-table" });
		let thead = this._html(doc, "thead");
		let headerRow = this._html(doc, "tr");
		for (let columnIndex = 0; columnIndex < tableBlock.header.length; columnIndex += 1) {
			let cell = tableBlock.header[columnIndex];
			let th = this._html(doc, "th");
			let align = tableBlock.alignments[columnIndex] || "left";
			th.setAttribute("data-sr-align", align);
			th.setAttribute("data-sr-table-section", "header");
			th.setAttribute("data-row-index", "0");
			th.setAttribute("data-column-index", String(columnIndex));
			th.setAttribute("data-colspan", "1");
			th.appendChild(this._editableNode(controller, cell, "sr-native-table-cell"));
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		let tbody = this._html(doc, "tbody");
		for (let rowIndex = 0; rowIndex < tableBlock.rows.length; rowIndex += 1) {
			let row = tableBlock.rows[rowIndex];
			let tr = this._html(doc, "tr");
			let columnIndex = 0;
			for (let cell of row || []) {
				let td = this._html(doc, "td");
				let normalizedCell = SystematicReviewerNativeMarkdown.normalizeTableCell(cell);
				let align = tableBlock.alignments[columnIndex] || "left";
				td.setAttribute("data-sr-align", align);
				td.setAttribute("data-sr-table-section", "body");
				td.setAttribute("data-row-index", String(rowIndex));
				td.setAttribute("data-column-index", String(columnIndex));
				td.setAttribute("data-colspan", String(normalizedCell.colspan || 1));
				if ((normalizedCell.colspan || 1) > 1) {
					td.colSpan = normalizedCell.colspan;
				}
				td.appendChild(this._editableNode(controller, normalizedCell.text || "", "sr-native-table-cell"));
				tr.appendChild(td);
				columnIndex += normalizedCell.colspan || 1;
			}
			tbody.appendChild(tr);
		}
		table.append(thead, tbody);
		wrapper.append(
			this._html(doc, "div", {
				className: "sr-native-table-shell",
				children: [
					this._tableContextEditableNode(controller, tableBlock.captionAbove || "", { "data-sr-table-caption": "true" }, "sr-table-context sr-table-caption"),
					this._html(doc, "div", {
						className: "sr-native-table-wrap",
						children: [table],
					}),
					this._tableContextEditableNode(controller, tableBlock.noteBelow || "", { "data-sr-table-note": "true" }, "sr-table-context sr-table-note"),
				],
			})
		);
		return wrapper;
	},

	_editableNode(controller, markdownText, extraClass = "") {
		let node = this._html(controller.doc, "div", {
			className: `sr-block-editable ${extraClass}`.trim(),
			attrs: {
				contenteditable: "true",
				"data-sr-editable": "true",
			},
		});
		let html = this._contentEditableHTMLFromMarkdown(controller, markdownText);
		node.innerHTML = html || "<br />";
		return node;
	},

	_contentEditableHTMLFromMarkdown(controller, markdownText) {
		return this._xmlSafeHTMLFragment(SystematicReviewerNativeMarkdown.renderInlineHTML(markdownText, {
			renderCitation: (citation) => {
				return this._citationChipHTML(controller, citation);
			},
			renderLink: ({ label, href }) => `<a href="${this._escapeHTML(href)}">${this._escapeHTML(label)}</a>`,
		}));
	},

	_collectNativeBlocks(controller) {
		return SystematicReviewerNativeMarkdown.collectNativeEditorBlocks(controller?.els?.nativeEditor);
	},

	_nativeTableBlockFromElement(el) {
		return SystematicReviewerNativeMarkdown.tableBlockFromElement(el);
	},

	_editorNodeToBlocks(node) {
		return SystematicReviewerNativeMarkdown.blocksFromEditorNode(node);
	},

	_inlineMarkdownFromNode(node) {
		return SystematicReviewerNativeMarkdown.inlineMarkdownFromNode(node);
	},

	_serializeControllerMarkdown(controller) {
		if (controller.mode == "raw") {
			return controller.els.rawEditor.value;
		}
		if (controller.mode == "native" || controller.nativeDirty) {
			controller.nativeBlocks = this._collectNativeBlocks(controller);
			return SystematicReviewerNativeMarkdown.serializeBlocks(controller.nativeBlocks);
		}
		return controller.els.rawEditor.value;
	},

	_activateWorkspaceSurface(controller, mode) {
		if (mode == "preview") {
			let markdown = controller.mode == "raw" ? controller.els.rawEditor.value : this._serializeControllerMarkdown(controller);
			controller.els.preview.innerHTML = this._renderMarkdownHTML(markdown, controller);
			this._decoratePreview(controller.els.preview);
			controller.previewStale = false;
			this._clearNativeSurface(controller);
			return;
		}
		if (mode == "native") {
			let markdown = controller.mode == "raw" ? controller.els.rawEditor.value : this._serializeControllerMarkdown(controller);
			controller.nativeBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(markdown);
			controller.nativeDirty = false;
			this._renderNativeEditor(controller);
			this._clearPreviewSurface(controller);
			controller.previewStale = true;
			return;
		}
		if (mode == "raw") {
			this._clearPreviewSurface(controller);
			this._clearNativeSurface(controller);
			controller.previewStale = true;
		}
	},

	_setWorkspaceMode(controller, mode) {
		let nextMode = ["preview", "native", "raw"].includes(mode) ? mode : "preview";
		if (controller.mode == "native" && nextMode != "native" && controller.nativeDirty) {
			let markdown = this._serializeControllerMarkdown(controller);
			controller.els.rawEditor.value = markdown;
			controller.nativeDirty = false;
			controller.previewStale = true;
		}
		this._activateWorkspaceSurface(controller, nextMode);
		controller.mode = nextMode;
		controller.els.modePreviewBtn.classList.toggle("active", nextMode == "preview");
		controller.els.modeNativeBtn.classList.toggle("active", nextMode == "native");
		controller.els.modeRawBtn.classList.toggle("active", nextMode == "raw");
			controller.els.preview.toggleAttribute("hidden", nextMode != "preview");
			controller.els.nativeEditor.toggleAttribute("hidden", nextMode != "native");
			controller.els.rawEditor.toggleAttribute("hidden", nextMode != "raw");
			controller.els.editorToolbar?.toggleAttribute("hidden", nextMode == "raw");
			controller.els.rawToolbar?.toggleAttribute("hidden", nextMode != "raw");
			controller.els.editorSettings?.toggleAttribute("hidden", nextMode == "raw");
		},

	_decoratePreview(container) {
		for (let table of Array.from(container.querySelectorAll("table"))) {
			if (table.parentElement?.classList?.contains("sr-workspace-table-scroll")) {
				continue;
			}
			let wrapper = this._html(container.ownerDocument, "div", { className: "sr-workspace-table-scroll" });
			table.parentNode.insertBefore(wrapper, table);
			wrapper.appendChild(table);
		}
		SystematicReviewerNativeMarkdown.markWrappedProseTableCells(container);
	},

	_decoratePreview(container) {
		for (let table of Array.from(container.querySelectorAll("table"))) {
			if (table.parentElement?.classList?.contains("sr-workspace-table-scroll")) {
				continue;
			}
			let wrapper = this._html(container.ownerDocument, "div", { className: "sr-workspace-table-scroll" });
			table.parentNode.insertBefore(wrapper, table);
			wrapper.appendChild(table);
		}
		SystematicReviewerNativeMarkdown.markWrappedProseTableCells(container);
	},

	_renderChat(controller, messages) {
		let box = controller.els.chatMessages;
		box.replaceChildren();
		let list = messages && messages.length ? messages : [
			{
				role: "assistant",
				content: "Continue the collection session here, use /find for document arguments, /explore for scoped synthesis, or /status for project state.",
				placeholder: true,
				event_type: "assistant_question",
			},
		];
		for (let message of list) {
			box.appendChild(this._messageNode(controller.doc, message));
		}
		box.scrollTop = box.scrollHeight;
	},

	_messageNode(doc, message) {
		let role = message.role || "assistant";
		let eventType = message.event_type || "";
		let placeholder = !!message.placeholder;
		let classes = ["sr-workspace-message"];
		if (role == "user") {
			classes.push("sr-workspace-message-user");
		}
		if (role == "system") {
			classes.push("sr-workspace-message-system");
		}
		if (role == "tool") {
			classes.push("sr-workspace-message-tool");
		}
		if (eventType == "thinking") {
			classes.push("sr-workspace-message-thinking");
		}
		if (placeholder) {
			classes.push("sr-workspace-message-placeholder");
		}
		let wrapper = this._html(doc, "div", {
			className: classes.join(" "),
		});
		let roleText = this._messageRoleLabel(message);
		let titleText = this._messageTitleText(message);
		let bodyText = this._messageBodyText(message);
		wrapper.appendChild(this._html(doc, "div", {
			className: "sr-workspace-message-role",
			text: roleText,
		}));
		if (this._messageUsesDetails(message)) {
			let details = this._html(doc, "details", {
				className: "sr-workspace-message-details",
			});
			let summary = this._html(doc, "summary", {
				className: "sr-workspace-message-summary",
				text: titleText || roleText,
			});
			let body = this._html(doc, "div", {
				className: "sr-workspace-message-text",
				text: bodyText,
			});
			details.append(summary, body);
			wrapper.appendChild(details);
		}
		else {
			if (titleText && titleText != roleText) {
				wrapper.appendChild(this._html(doc, "div", {
					className: "sr-workspace-message-title",
					text: titleText,
				}));
			}
			wrapper.appendChild(this._html(doc, "div", {
				className: "sr-workspace-message-text",
				text: bodyText,
			}));
		}
		return wrapper;
	},

		_messageUsesDetails(message) {
			return new Set([
				"thinking",
				"responses_reasoning",
				"tool_call",
				"tool_result",
				"tool_error",
				"action_call",
				"action_result",
				"action_error",
				"function_call",
				"function_call_output",
				"system_tools",
				"collection_inspection",
				"assistant_status",
				"system_prompt",
				"truncated_context",
			]).has(message.event_type);
		},

	_messageRoleLabel(message) {
		if (message.role == "user") {
			return "User";
		}
		if (message.role == "tool") {
			return "Tool";
		}
		if (message.role == "system") {
			return "Session";
		}
		return "Systematic Reviewer";
	},

	_messageTitleText(message) {
		if (message.title) {
			return message.title;
		}
			switch (message.event_type) {
				case "thinking":
				case "responses_reasoning":
					return "Reasoning";
				case "tool_call":
					return "Tool Call";
				case "tool_result":
					return "Tool Result";
				case "tool_error":
					return "Tool Error";
				case "action_call":
					return "Action Call";
				case "action_result":
					return "Action Result";
				case "action_error":
					return "Action Error";
				case "function_call":
					return "Function Call";
				case "function_call_output":
					return "Function Output";
				case "system_tools":
					return "Available Tools";
			case "collection_inspection":
				return "Collection Inspection";
				case "system_prompt":
					return "Pinned Prompt Context";
				case "truncated_context":
					return "Truncated Context";
			case "assistant_question":
				return "Next Step";
			default:
				return "";
		}
	},

	_messageBodyText(message) {
		let content = String(message.content || "");
		if (message.event_type == "responses_reasoning") {
			return content;
		}
		if (message.event_type == "truncated_context") {
			let entries = Array.isArray(message?.payload?.entries) ? message.payload.entries : [];
			let formatted = entries
				.map((entry) => SystematicReviewerTokenBudget.serializeTimelineEntry(entry))
				.filter(Boolean)
				.join("\n\n-----\n\n");
			return formatted ? `${content}\n\n${formatted}` : content;
		}
		if (!content && message.payload !== undefined && message.payload !== null) {
			try {
				content = JSON.stringify(message.payload, null, 2);
			}
			catch (_err) {
				content = String(message.payload);
			}
		}
		if (message.payload && this._messageUsesDetails(message)) {
			let payloadPreview = "";
			try {
				payloadPreview = this._truncateText(JSON.stringify(message.payload, null, 2), 6000);
			}
			catch (_err) {
				payloadPreview = "";
			}
			if (payloadPreview) {
				return content ? `${content}\n\n${payloadPreview}` : payloadPreview;
			}
		}
		return content;
	},

	_populateSessionControls(controller, sessions, activeSessionID) {
		let select = controller.els.sessionSelect;
		if (!select) {
			return;
		}
		select.replaceChildren();
		if (!sessions.length) {
			select.appendChild(this._html(controller.doc, "option", {
				text: "Session",
				attrs: { value: "default" },
			}));
			select.value = "default";
			return;
		}
		for (let session of sessions) {
			let title = session.title || session.session_id || "Session";
			if (!session.title || session.title == "New Session") {
				title = this._sessionTitleFromDate(session.updated_at);
			}
			let meta = [session.mode || "", session.status == "running" ? "running" : ""].filter(Boolean).join(" - ");
			select.appendChild(this._html(controller.doc, "option", {
				text: meta ? `${title} - ${meta}` : title,
				attrs: { value: session.session_id },
			}));
		}
		select.value = activeSessionID || sessions[0].session_id;
	},

	_populateProjectControls(controller, projects, activeProjectID) {
		let select = controller.els.projectSelect;
		if (!select) {
			return;
		}
		select.replaceChildren();
		if (!projects.length) {
			select.appendChild(this._html(controller.doc, "option", {
				text: "No stored projects",
				attrs: { value: "" },
			}));
			select.value = "";
			return;
		}
		for (let project of projects) {
			let title = project.collection_name || project.project_id || "Project";
			let meta = [
				project.session_count ? `${project.session_count} sessions` : "",
				project.available_in_zotero ? "" : "missing in Zotero",
			].filter(Boolean).join(" - ");
			select.appendChild(this._html(controller.doc, "option", {
				text: meta ? `${title} - ${meta}` : title,
				attrs: { value: project.project_id },
			}));
		}
		select.value = activeProjectID || projects[0].project_id;
	},

	_sessionTitleFromDate(value) {
		try {
			let date = value ? new Date(value) : new Date();
			if (!Number.isNaN(date.getTime())) {
				return `Session ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
			}
		}
		catch (_err) {}
		return "Session";
	},

	_normalizeSessionTitle(value) {
		let text = String(value || "").trim().replace(/\s+/g, " ");
		if (!text) {
			return "";
		}
		return text.slice(0, 96);
	},

	_normalizeSessionMode(value) {
		let normalized = String(value || "").trim().toLowerCase();
		if (["intake", "systematic_review", "workspace_task"].includes(normalized)) {
			return normalized;
		}
		return "intake";
	},

	_normalizeSessionStatus(value) {
		let normalized = String(value || "").trim().toLowerCase();
		if (["active", "waiting_for_user", "running", "complete"].includes(normalized)) {
			return normalized;
		}
		return "active";
	},

	async _saveMarkdown(controller, { silent = false } = {}) {
		if (controller.saving) {
			return;
		}
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			return;
		}
		controller.saving = true;
		try {
			let markdown = this._serializeControllerMarkdown(controller);
			if (markdown === controller.lastSavedMarkdown) {
				controller.documentDirty = false;
				if (!silent) {
					this._setStatus(controller, "REPORT.md saved", "ready");
				}
				return;
			}
			await this._writeTextFile(current.context.reportPath, markdown);
			let documentPayload = {
				path: current.context.reportPath,
				markdown,
				html: controller.mode == "native" ? "" : this._renderMarkdownHTML(markdown, controller),
			};
			if (controller.bootstrap) {
				controller.bootstrap.workspace_document = documentPayload;
				if (!controller.bootstrap.current_project) {
					controller.bootstrap.current_project = {};
				}
				controller.bootstrap.current_project.settings = (await this._readJSONFile(current.context.settingsPath)) || {};
			}
			controller.documentPath = current.context.reportPath;
			controller.lastSavedMarkdown = markdown;
			controller.documentDirty = false;
			if (controller.mode == "native") {
				controller.nativeDirty = false;
				controller.previewStale = true;
			}
			else {
				controller.els.preview.innerHTML = documentPayload.html;
				this._decoratePreview(controller.els.preview);
				controller.previewStale = false;
			}
			if (controller.mode != "raw") {
				controller.els.rawEditor.value = markdown;
			}
			if (controller.mode == "preview") {
				controller.nativeBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(markdown);
				controller.nativeDirty = false;
			}
			if (!silent) {
				this._setStatus(controller, "REPORT.md saved", "ready");
			}
		}
		finally {
			controller.saving = false;
		}
	},

	async _previewMarkdown(controller) {
		await this._saveMarkdown(controller, { silent: true });
		this._setWorkspaceMode(controller, "preview");
	},
};
