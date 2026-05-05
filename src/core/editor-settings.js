var SystematicReviewerEditorSettings = {
	_setWorkspaceSettingsInBootstrap(controller, editorSettings) {
		if (!controller.bootstrap) {
			controller.bootstrap = {};
		}
		if (!controller.bootstrap.current_project) {
			controller.bootstrap.current_project = {};
		}
		if (!controller.bootstrap.current_project.settings) {
			controller.bootstrap.current_project.settings = {};
		}
		let defaults = this._defaultEditorSettings();
		controller.bootstrap.current_project.settings.editor = SystematicReviewerNativeMarkdown.normalizeSettings(
			Object.assign(
				{
					pageViewScale: defaults.pageViewScale,
					citationStyleID: defaults.citationStyleID,
					citationLocale: defaults.citationLocale,
					printPageNumbers: defaults.printPageNumbers,
				},
				editorSettings || {}
			)
		);
	},

	_themeClassForWindow(win) {
		try {
			return win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "theme-dark" : "theme-light";
		}
		catch (_err) {
			return "theme-dark";
		}
	},

	_applyControllerTheme(controller) {
		let theme = this._themeClassForWindow(controller?.doc?.defaultView);
		controller.root?.classList?.remove("theme-dark", "theme-light");
		controller.root?.classList?.add(theme);
	},

	_listSystemFontNames() {
		try {
			let enumerator = Components.classes["@mozilla.org/gfx/fontenumerator;1"]
				.getService(Components.interfaces.nsIFontEnumerator);
			let fonts = enumerator.EnumerateAllFonts({});
			if (Array.isArray(fonts) && fonts.length) {
				return fonts.filter(Boolean).slice(0, 400);
			}
		}
		catch (_err) {}
		return [
			"Georgia",
			"Times New Roman",
			"Times",
			"Charter",
			"Palatino",
			"Helvetica",
			"Arial",
			"Verdana",
			"Trebuchet MS",
			"Menlo",
			"Courier New",
		];
	},

	_selectedCitationStyleLabel(select) {
		let selected = select?.selectedOptions?.[0] || null;
		let text = String(selected?.textContent || "").trim();
		return text || "selected Zotero style";
	},

	_ensureSelectContainsValue(select, value, label = null) {
		if (!select || value === undefined || value === null || value === "") {
			return;
		}
		let normalized = String(value);
		if (Array.from(select.options || []).some((option) => option.value == normalized)) {
			return;
		}
		select.appendChild(this._html(select.ownerDocument, "option", {
			text: label || normalized,
			attrs: { value: normalized },
		}));
	},

	_setZoomSliderPercent(controller, percent) {
		let slider = controller?.els?.pageViewScaleSlider || null;
		if (!slider?.style) {
			return;
		}
		let clamped = Math.max(70, Math.min(150, Number(percent || 100)));
		let normalized = ((clamped - 70) / 80) * 100;
		slider.style.setProperty("--sr-range-percent", `${normalized}%`);
	},

	_populateEditorSettingsControls(controller, currentProject) {
		let settings = this._workspaceSettings(controller);
		let { fontSelect, fontSizeSelect, pageViewScaleRange, pageViewScaleValue, citationStyleSelect, stylePresetNote, marginSelect, pageNumbersCheckbox } = controller.els;

		if (!fontSelect.childElementCount) {
			for (let font of this._listSystemFontNames()) {
				fontSelect.appendChild(this._html(controller.doc, "option", {
					text: font,
					attrs: { value: font },
				}));
			}
		}
			if (!fontSizeSelect.childElementCount) {
				for (let size of [10, 11, 12, 13, 14, 16, 18]) {
					fontSizeSelect.appendChild(this._html(controller.doc, "option", {
						text: `${size}px`,
						attrs: { value: String(size) },
					}));
				}
			}
			if (!marginSelect.childElementCount) {
			for (let margin of [0.5, 0.75, 1, 1.25, 1.5]) {
				marginSelect.appendChild(this._html(controller.doc, "option", {
					text: `${margin}" margins`,
					attrs: { value: String(margin) },
				}));
			}
		}
		if (!citationStyleSelect.childElementCount) {
			let styles = [];
			try {
				styles = Zotero.Styles?.getVisible?.() || [];
			}
			catch (_err) {
				styles = [];
			}
			if (!styles.length) {
				citationStyleSelect.appendChild(this._html(controller.doc, "option", {
					text: "APA",
					attrs: { value: this._defaultEditorSettings().citationStyleID },
				}));
			}
			else {
				for (let style of styles) {
					citationStyleSelect.appendChild(this._html(controller.doc, "option", {
						text: style.title,
						attrs: { value: style.styleID },
					}));
				}
			}
		}

		this._ensureSelectContainsValue(fontSelect, settings.fontFamily, settings.fontFamily);
		this._ensureSelectContainsValue(fontSizeSelect, String(settings.fontSizePx), `${settings.fontSizePx}px`);
			fontSelect.value = settings.fontFamily || this._defaultEditorSettings().fontFamily;
			fontSizeSelect.value = String(settings.fontSizePx || this._defaultEditorSettings().fontSizePx);
				pageViewScaleRange.value = String(Math.round(Number(settings.pageViewScale || this._defaultEditorSettings().pageViewScale) * 100));
				pageViewScaleValue.textContent = `${pageViewScaleRange.value}%`;
				this._setZoomSliderPercent(controller, pageViewScaleRange.value);
				citationStyleSelect.value = settings.citationStyleID || this._defaultEditorSettings().citationStyleID;
			marginSelect.value = String(settings.printMarginInches || this._defaultEditorSettings().printMarginInches);
			pageNumbersCheckbox.checked = !!settings.printPageNumbers;
		stylePresetNote.textContent = this._styleLayoutNote(controller, citationStyleSelect);
	},

	_applyEditorSettingsToRoot(controller) {
		let settings = this._workspaceSettings(controller);
		controller.root.style.setProperty("--sr-font-family", settings.fontFamily || this._defaultEditorSettings().fontFamily);
		controller.root.style.setProperty("--sr-font-size", `${Number(settings.fontSizePx || this._defaultEditorSettings().fontSizePx)}px`);
		controller.root.style.setProperty("--sr-line-height", String(Number(settings.lineHeight || this._defaultEditorSettings().lineHeight || 1.6)));
		controller.root.style.setProperty("--sr-paragraph-align", settings.paragraphAlign || "left");
		controller.root.style.setProperty("--sr-paragraph-indent", `${Number(settings.paragraphIndentInches || 0)}in`);
		controller.root.style.setProperty("--sr-page-view-scale", String(Number(settings.pageViewScale || this._defaultEditorSettings().pageViewScale)));
		controller.root.style.setProperty("--sr-page-gap", `${Math.max(16, Math.round(22 * Number(settings.pageViewScale || this._defaultEditorSettings().pageViewScale)))}px`);
		for (let level = 1; level <= 6; level += 1) {
			let fallback = this._defaultEditorSettings().headingScales?.[level] || SystematicReviewerNativeMarkdown.DEFAULT_HEADING_SCALES[level];
			controller.root.style.setProperty(`--sr-heading-${level}-scale`, String(Number(settings.headingScales?.[level] || fallback)));
		}
		this._ensureWorkspaceDocumentStyles(controller);
	},

		async _updateEditorPreferences(controller, { applyStylePreset = false } = {}) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			return;
		}
		let settings = (await this._readJSONFile(current.context.settingsPath)) || {};
		let nextEditor = Object.assign({}, settings.editor || {}, {
			fontFamily: controller.els.fontSelect.value || this._defaultEditorSettings().fontFamily,
			fontSizePx: Number(controller.els.fontSizeSelect.value || this._defaultEditorSettings().fontSizePx),
			pageViewScale: Number(controller.els.pageViewScaleRange.value || Math.round(this._defaultEditorSettings().pageViewScale * 100)) / 100,
			citationStyleID: controller.els.citationStyleSelect.value || this._defaultEditorSettings().citationStyleID,
			printMarginInches: Number(controller.els.marginSelect.value || this._defaultEditorSettings().printMarginInches),
			printPageNumbers: !!controller.els.pageNumbersCheckbox.checked,
		});
		if (applyStylePreset) {
			let preset = SystematicReviewerNativeMarkdown.resolveCitationStylePreset(nextEditor.citationStyleID);
			nextEditor.fontFamily = preset.fontFamily;
			nextEditor.fontSizePx = preset.fontSizePx;
			nextEditor.lineHeight = preset.lineHeight;
			nextEditor.paragraphAlign = preset.paragraphAlign;
			nextEditor.paragraphIndentInches = preset.paragraphIndentInches;
			nextEditor.headingScales = Object.assign({}, preset.headingScales);
			nextEditor.headingStyles = Object.assign({}, preset.headingStyles);
			nextEditor.tableStyle = preset.tableStyle;
			nextEditor.printMarginInches = preset.marginInches;
			this._ensureSelectContainsValue(controller.els.fontSelect, preset.fontFamily, preset.fontFamily);
			this._ensureSelectContainsValue(controller.els.fontSizeSelect, String(preset.fontSizePx), `${preset.fontSizePx}px`);
			controller.els.fontSelect.value = preset.fontFamily;
			controller.els.fontSizeSelect.value = String(preset.fontSizePx);
			controller.els.marginSelect.value = String(preset.marginInches);
			if (controller.els.stylePresetNote) {
				controller.els.stylePresetNote.textContent = this._styleLayoutNote(controller, controller.els.citationStyleSelect, nextEditor.citationStyleID);
			}
		}
		settings.editor = SystematicReviewerNativeMarkdown.normalizeSettings(nextEditor);
		await this._writeJSONFile(current.context.settingsPath, settings);
		this._setWorkspaceSettingsInBootstrap(controller, settings.editor);
		this._invalidateCitationRenderCaches(controller);
			if (controller.els.stylePresetNote) {
				controller.els.stylePresetNote.textContent = this._styleLayoutNote(controller, controller.els.citationStyleSelect, settings.editor.citationStyleID);
			}
			this._applyEditorSettingsToRoot(controller);
			let markdown = this._serializeControllerMarkdown(controller);
			controller.els.rawEditor.value = markdown;
			controller.nativeBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(markdown);
			controller.nativeDirty = false;
			if (controller.mode == "preview") {
				controller.els.preview.innerHTML = this._renderMarkdownHTML(markdown, controller);
				this._decoratePreview(controller.els.preview);
				controller.previewStale = false;
				this._clearNativeSurface(controller);
			}
			else if (controller.mode == "native") {
				this._renderNativeEditor(controller);
				this._refreshNativeBibliographyBlocks(controller, markdown);
				this._clearPreviewSurface(controller);
				controller.previewStale = true;
			}
			else {
				controller.previewStale = true;
				this._clearPreviewSurface(controller);
				this._clearNativeSurface(controller);
			}
		},


};
