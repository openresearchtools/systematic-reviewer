var SystematicReviewerDocumentStylesSource =
	typeof SystematicReviewerDocumentStyles != "undefined"
		? SystematicReviewerDocumentStyles
		: ((typeof module != "undefined" && module.exports) ? require("./document-style-presets.js") : null);

var SystematicReviewerNativeMarkdown = (() => {
	const DOCUMENT_STYLE_SOURCE = SystematicReviewerDocumentStylesSource || {};
	const DEFAULT_EDITOR_SETTINGS = {
		fontFamily: "Georgia",
		fontSizePx: 12,
		pageViewScale: 1,
		citationStyleID: "http://www.zotero.org/styles/apa",
		citationLocale: "",
		headingScales: null,
		headingStyles: null,
		lineHeight: 1.6,
		paragraphAlign: "justify",
		paragraphIndentInches: 0,
		tableStyle: "standard",
			bulletStyle: "disc",
			printMarginInches: 1,
			printPageNumbers: true,
			preview_page_theme: "light",
		};
	const DEFAULT_HEADING_SCALES = Object.freeze(DOCUMENT_STYLE_SOURCE.DEFAULT_HEADING_SCALES || {
		1: 1.96,
		2: 1.62,
		3: 1.35,
		4: 1.08,
		5: 1.0,
		6: 1.0,
	});
	const DEFAULT_HEADING_STYLES = Object.freeze(DOCUMENT_STYLE_SOURCE.DEFAULT_HEADING_STYLES || {
		1: Object.freeze({ align: "left", weight: 700, italic: false, transform: "none" }),
		2: Object.freeze({ align: "left", weight: 700, italic: false, transform: "none" }),
		3: Object.freeze({ align: "left", weight: 700, italic: false, transform: "none" }),
		4: Object.freeze({ align: "left", weight: 700, italic: false, transform: "none" }),
		5: Object.freeze({ align: "left", weight: 700, italic: false, transform: "none" }),
		6: Object.freeze({ align: "left", weight: 700, italic: false, transform: "none" }),
	});
	const CITATION_STYLE_PRESETS = Object.freeze(
		Array.isArray(DOCUMENT_STYLE_SOURCE.CITATION_STYLE_PRESETS)
			? DOCUMENT_STYLE_SOURCE.CITATION_STYLE_PRESETS.slice()
			: []
	);

	const PAGE_MARKER_RE = /^\s*<[-]{1,2}page(\d+)[-]{1,2}>\s*$/i;
	const PAGE_BREAK_RE = /^\s*<!--\s*sr:page-break\s*-->\s*$/i;
	const PAGE_LAYOUT_RE = /^\s*<!--\s*sr:page-layout:landscape\s*-->\s*$/i;
	const TOC_PLACEHOLDER_RE = /^\s*<!--\s*sr:toc\s*-->\s*$/i;
	const BLOCK_META_RE = /^\s*<!--\s*sr:block-meta\s+(.+?)\s*-->\s*$/i;
	const PAGE_BREAK_MARKDOWN = "<!-- sr:page-break -->";
	const TOC_PLACEHOLDER_MARKDOWN = "<!-- sr:toc -->";
	const BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN =
		"[bibliography](zotero://systematic-reviewer/bibliography)";
	const PRISMA_PLACEHOLDER_MARKDOWN =
		"[prisma](zotero://systematic-reviewer/prisma)";
	const HARD_BREAK_MARKDOWN = "\\" + "\n";
	const HARD_BREAK_TOKEN = "\u0000SRHARD\u0000";

	function normalizeNewlines(value) {
		return String(value || "").replace(/\r\n?/g, "\n");
	}

	function escapeHTML(value) {
		return String(value || "")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;");
	}

	function xmlSafeHTMLFragment(html) {
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
		value = value.replace(/<img([^>]*?)>/gi, (match, attrs) => (/\/\s*>$/.test(match) ? match : `<img${attrs} />`));
		return value;
	}

	function isLikelyProseTableCellText(text = "") {
		let value = String(text || "").replace(/\s+/g, " ").trim();
		if (!value) {
			return false;
		}
		let words = value.split(/\s+/).filter(Boolean);
		if (words.length < 3) {
			return false;
		}
		return /[A-Za-z]/.test(value);
	}

	function lineBoxCountForNode(node) {
		let doc = node?.ownerDocument || null;
		if (!node || !doc?.createRange) {
			return 0;
		}
		try {
			let range = doc.createRange();
			range.selectNodeContents(node);
			let rects = Array.from(range.getClientRects?.() || []).filter((rect) =>
				rect
				&& Number(rect.width || 0) > 0
				&& Number(rect.height || 0) > 0
			);
			range.detach?.();
			if (!rects.length) {
				return 0;
			}
			let tops = [];
			for (let rect of rects) {
				let top = Number(rect.top || 0);
				if (!Number.isFinite(top)) {
					continue;
				}
				if (!tops.some((value) => Math.abs(value - top) <= 1.5)) {
					tops.push(top);
				}
			}
			return tops.length;
		}
		catch (_error) {
			return 0;
		}
	}

	function tableCellMeasurementNode(cell) {
		return cell?.querySelector?.(".sr-native-table-cell, .sr-table-fragment-cell-content") || cell || null;
	}

	function markWrappedProseTableCells(root = null) {
		let cells = Array.from(root?.querySelectorAll?.("tbody td[data-sr-align='left']") || []);
		for (let cell of cells) {
			cell.removeAttribute("data-sr-multiline-prose");
			let measure = tableCellMeasurementNode(cell);
			let text = String(measure?.textContent || cell.textContent || "").trim();
			if (!isLikelyProseTableCellText(text)) {
				continue;
			}
			if (lineBoxCountForNode(measure) > 1) {
				cell.setAttribute("data-sr-multiline-prose", "true");
			}
		}
	}

	function cloneHeadingScales(scales) {
		let out = {};
		for (let level = 1; level <= 6; level += 1) {
			out[level] = Number(scales?.[level] || scales?.[`h${level}`] || scales?.[String(level)] || 0);
		}
		return out;
	}

	function normalizeHeadingAlign(value, fallback = "left") {
		let normalized = String(value || fallback || "left").trim().toLowerCase();
		return ["left", "center", "right"].includes(normalized) ? normalized : "left";
	}

	function normalizeHeadingTransform(value, fallback = "none") {
		let normalized = String(value || fallback || "none").trim().toLowerCase();
		return ["none", "uppercase"].includes(normalized) ? normalized : "none";
	}

	function normalizeHeadingWeight(value, fallback = 700) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			numeric = Number(fallback);
		}
		return numeric >= 600 ? 700 : 400;
	}

	function cloneHeadingStyles(styles) {
		let out = {};
		for (let level = 1; level <= 6; level += 1) {
			let fallback = DEFAULT_HEADING_STYLES[level];
			let value = styles?.[level] || styles?.[`h${level}`] || styles?.[String(level)] || {};
			out[level] = {
				align: normalizeHeadingAlign(value.align || value.textAlign, fallback.align),
				weight: normalizeHeadingWeight(value.weight || value.fontWeight, fallback.weight),
				italic: typeof value.italic == "boolean" ? value.italic : String(value.fontStyle || "").toLowerCase() == "italic",
				transform: normalizeHeadingTransform(value.transform || value.textTransform, fallback.transform),
			};
		}
		return out;
	}

	function hasOwnSetting(settings, key) {
		return !!settings && Object.prototype.hasOwnProperty.call(settings, key);
	}

	function normalizeLineHeight(value, fallback = DEFAULT_EDITOR_SETTINGS.lineHeight) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric < 1 || numeric > 3) {
			numeric = Number(fallback);
		}
		return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : DEFAULT_EDITOR_SETTINGS.lineHeight;
	}

	function normalizeParagraphAlign(value, fallback = DEFAULT_EDITOR_SETTINGS.paragraphAlign) {
		let normalized = String(value || fallback || "left").trim().toLowerCase();
		return ["left", "justify", "center"].includes(normalized) ? normalized : "left";
	}

	function normalizeProseParagraphAlign(value, fallback = DEFAULT_EDITOR_SETTINGS.paragraphAlign) {
		let normalized = normalizeParagraphAlign(value, fallback);
		return normalized == "center" ? "center" : "justify";
	}

	function normalizeParagraphIndent(value, fallback = DEFAULT_EDITOR_SETTINGS.paragraphIndentInches) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric < 0 || numeric > 2) {
			numeric = Number(fallback);
		}
		return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
	}

	function normalizeTableStyle(value, fallback = DEFAULT_EDITOR_SETTINGS.tableStyle) {
		let normalized = String(value || fallback || "standard").trim().toLowerCase();
		return ["standard", "apa", "minimal", "scientific", "grid"].includes(normalized) ? normalized : "standard";
	}

	function normalizeHeadingScales(settings = {}, preset = null) {
		let explicit = cloneHeadingScales(settings.headingScales);
		if (Object.values(explicit).some((value) => Number.isFinite(value) && value > 0)) {
			let out = {};
			for (let level = 1; level <= 6; level += 1) {
				let value = explicit[level];
				out[level] = Number.isFinite(value) && value > 0
					? value
					: (preset?.headingScales?.[level] || DEFAULT_HEADING_SCALES[level]);
			}
			return out;
		}
		let legacyHeadingScale = Number(settings.headingScale || 0);
		if (Number.isFinite(legacyHeadingScale) && legacyHeadingScale > 0) {
			return {
				1: Number((legacyHeadingScale * 1.45).toFixed(2)),
				2: Number((legacyHeadingScale * 1.2).toFixed(2)),
				3: Number(legacyHeadingScale.toFixed(2)),
				4: DEFAULT_HEADING_SCALES[4],
				5: DEFAULT_HEADING_SCALES[5],
				6: DEFAULT_HEADING_SCALES[6],
			};
		}
		return cloneHeadingScales(preset?.headingScales || DEFAULT_HEADING_SCALES);
	}

	function normalizeHeadingStyles(settings = {}, preset = null) {
		let raw = settings?.headingStyles;
		let hasExplicit = false;
		for (let level = 1; level <= 6; level += 1) {
			let candidate = raw?.[level] || raw?.[`h${level}`] || raw?.[String(level)] || null;
			if (candidate && typeof candidate == "object" && Object.keys(candidate).length) {
				hasExplicit = true;
				break;
			}
		}
		if (hasExplicit) {
			let explicit = cloneHeadingStyles(raw);
			let fallback = cloneHeadingStyles(preset?.headingStyles || DEFAULT_HEADING_STYLES);
			let out = {};
			for (let level = 1; level <= 6; level += 1) {
				out[level] = Object.assign({}, fallback[level], explicit[level]);
			}
			return out;
		}
		return cloneHeadingStyles(preset?.headingStyles || DEFAULT_HEADING_STYLES);
	}

	function resolveCitationStylePreset(styleID = "") {
		let normalizedStyleID = String(styleID || "").trim();
		for (let preset of CITATION_STYLE_PRESETS) {
			if (preset.match.test(normalizedStyleID)) {
				return {
					id: preset.id,
					label: preset.label,
					fontFamily: preset.fontFamily || DEFAULT_EDITOR_SETTINGS.fontFamily,
					fontSizePx: Number(preset.fontSizePx || DEFAULT_EDITOR_SETTINGS.fontSizePx),
					lineHeight: normalizeLineHeight(preset.lineHeight, DEFAULT_EDITOR_SETTINGS.lineHeight),
					paragraphAlign: normalizeParagraphAlign(preset.paragraphAlign, DEFAULT_EDITOR_SETTINGS.paragraphAlign),
					paragraphIndentInches: normalizeParagraphIndent(preset.paragraphIndentInches, DEFAULT_EDITOR_SETTINGS.paragraphIndentInches),
					marginInches: preset.marginInches,
					headingScales: cloneHeadingScales(preset.headingScales),
					headingStyles: cloneHeadingStyles(preset.headingStyles),
					tableStyle: normalizeTableStyle(preset.tableStyle, "standard"),
				};
			}
		}
		return {
			id: "standard",
			label: "Standard layout",
			fontFamily: DEFAULT_EDITOR_SETTINGS.fontFamily,
			fontSizePx: DEFAULT_EDITOR_SETTINGS.fontSizePx,
			lineHeight: DEFAULT_EDITOR_SETTINGS.lineHeight,
			paragraphAlign: DEFAULT_EDITOR_SETTINGS.paragraphAlign,
			paragraphIndentInches: DEFAULT_EDITOR_SETTINGS.paragraphIndentInches,
			marginInches: DEFAULT_EDITOR_SETTINGS.printMarginInches,
			headingScales: cloneHeadingScales(DEFAULT_HEADING_SCALES),
			headingStyles: cloneHeadingStyles(DEFAULT_HEADING_STYLES),
			tableStyle: "standard",
		};
	}

	function normalizeSettings(settings) {
		let rawSettings = settings || {};
		let merged = Object.assign({}, DEFAULT_EDITOR_SETTINGS, rawSettings);
		let preset = resolveCitationStylePreset(merged.citationStyleID);
		let normalizedMargin = hasOwnSetting(rawSettings, "printMarginInches") ? Number(rawSettings.printMarginInches) : Number(preset.marginInches);
		if (!Number.isFinite(normalizedMargin) || normalizedMargin <= 0) {
			normalizedMargin = preset.marginInches;
		}
		merged.fontFamily =
			hasOwnSetting(rawSettings, "fontFamily") && String(rawSettings.fontFamily || "").trim()
				? String(rawSettings.fontFamily).trim()
				: preset.fontFamily;
		merged.fontSizePx = clampNumber(
			hasOwnSetting(rawSettings, "fontSizePx") ? rawSettings.fontSizePx : preset.fontSizePx,
			preset.fontSizePx || DEFAULT_EDITOR_SETTINGS.fontSizePx,
			9,
			18
		);
		merged.lineHeight = normalizeLineHeight(
			hasOwnSetting(rawSettings, "lineHeight") ? rawSettings.lineHeight : preset.lineHeight,
			preset.lineHeight || DEFAULT_EDITOR_SETTINGS.lineHeight
		);
		merged.paragraphAlign = normalizeParagraphAlign(
			hasOwnSetting(rawSettings, "paragraphAlign") ? rawSettings.paragraphAlign : preset.paragraphAlign,
			preset.paragraphAlign || DEFAULT_EDITOR_SETTINGS.paragraphAlign
		);
		merged.paragraphIndentInches = normalizeParagraphIndent(
			hasOwnSetting(rawSettings, "paragraphIndentInches") ? rawSettings.paragraphIndentInches : preset.paragraphIndentInches,
			preset.paragraphIndentInches || DEFAULT_EDITOR_SETTINGS.paragraphIndentInches
		);
		merged.tableStyle = normalizeTableStyle(
			hasOwnSetting(rawSettings, "tableStyle") ? rawSettings.tableStyle : preset.tableStyle || DEFAULT_EDITOR_SETTINGS.tableStyle,
			preset.tableStyle || DEFAULT_EDITOR_SETTINGS.tableStyle
		);
		merged.bulletStyle = normalizeListStyle(
			hasOwnSetting(rawSettings, "bulletStyle") ? rawSettings.bulletStyle : DEFAULT_EDITOR_SETTINGS.bulletStyle,
			false
		);
		merged.headingScales = normalizeHeadingScales(rawSettings, preset);
		merged.headingStyles = normalizeHeadingStyles(rawSettings, preset);
			merged.printMarginInches = normalizedMargin;
			merged.preview_page_theme = String(
				rawSettings.preview_page_theme !== undefined
					? rawSettings.preview_page_theme
					: (rawSettings.previewPageTheme !== undefined ? rawSettings.previewPageTheme : merged.preview_page_theme)
			).trim().toLowerCase() == "dark" ? "dark" : "light";
			merged.pageViewFlow = "vertical";
			merged.citationStylePreset = preset.id;
		merged.citationStylePresetLabel = preset.label;
		merged.citationStyleLayoutLabel = preset.label;
		return merged;
	}

	function resolveHeadingSizeMap(settings = {}, { printMode = false } = {}) {
		let merged = normalizeSettings(settings);
		let preset = resolveCitationStylePreset(merged.citationStyleID);
		let headingScales = normalizeHeadingScales(merged, preset);
		let fontSizePx = Number(merged.fontSizePx || DEFAULT_EDITOR_SETTINGS.fontSizePx);
		let pageViewScale = clampNumber(merged.pageViewScale, DEFAULT_EDITOR_SETTINGS.pageViewScale, 0.65, 1.75);
		let scaledFontSizePx = printMode ? fontSizePx : Number((fontSizePx * pageViewScale).toFixed(2));
		let out = {};
		for (let level = 1; level <= 6; level += 1) {
			out[level] = Math.max(1, Math.round(scaledFontSizePx * Number(headingScales[level] || 1)));
		}
		return out;
	}

	function clampNumber(value, fallback, min, max) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			numeric = fallback;
		}
		if (Number.isFinite(min)) {
			numeric = Math.max(min, numeric);
		}
		if (Number.isFinite(max)) {
			numeric = Math.min(max, numeric);
		}
		return numeric;
	}

	function isLocalAbsolutePathLike(value = "") {
		let raw = String(value || "").trim();
		return /^[A-Za-z]:[\\/]/.test(raw)
			|| /^\\\\[^\\]+\\[^\\]+/.test(raw)
			|| /^\/[A-Za-z]:[\\/]/.test(raw);
	}

	function resolveAssetURL(src, options = {}) {
		let raw = String(src || "").trim();
		if (!raw) {
			return "";
		}
		if (/^(?:[a-z]+:|\/\/)/i.test(raw) && !isLocalAbsolutePathLike(raw)) {
			return raw;
		}
		if (typeof options.resolveAssetURL == "function") {
			try {
				return String(options.resolveAssetURL(raw) || raw);
			}
			catch (_err) {
				return raw;
			}
		}
		return raw;
	}

	function parseTableRow(line) {
		return String(line || "")
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((cell) => cell.trim());
	}

	function isTableSeparator(line) {
		return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?:\s*:?-{3,}:?\s*)?\|?\s*$/.test(String(line || ""));
	}

	function parseTableAlignmentRow(line) {
		if (!isTableSeparator(line)) {
			return [];
		}
		return parseTableRow(line).map((cell) => {
			let trimmed = String(cell || "").trim();
			let left = trimmed.startsWith(":");
			let right = trimmed.endsWith(":");
			if (left && right) {
				return "center";
			}
			if (right) {
				return "right";
			}
			if (left) {
				return "left";
			}
			return "";
		});
	}

	function tableAlignmentMarker(align) {
		switch (String(align || "").trim().toLowerCase()) {
			case "left":
				return ":---";
			case "center":
				return ":---:";
			case "right":
				return "---:";
			default:
				return "---";
		}
	}

	function normalizeTableAlignment(value) {
		let normalized = String(value || "").trim().toLowerCase();
		return ["left", "center", "right"].includes(normalized) ? normalized : "";
	}

	function normalizeListLevel(value, fallback = 0) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric < 0) {
			numeric = Number(fallback || 0);
		}
		if (!Number.isFinite(numeric) || numeric < 0) {
			numeric = 0;
		}
		return Math.max(0, Math.min(8, Math.floor(numeric)));
	}

	function normalizeListItem(item, fallbackLevel = 0) {
		if (item && typeof item == "object" && !Array.isArray(item)) {
			return {
				text: String(item.text || ""),
				level: normalizeListLevel(item.level, fallbackLevel),
			};
		}
		return {
			text: String(item || ""),
			level: normalizeListLevel(fallbackLevel, 0),
		};
	}

	function normalizeListItems(items = []) {
		let out = [];
		let previousLevel = 0;
		for (let index = 0; index < (items || []).length; index += 1) {
			let normalized = normalizeListItem(items[index], index == 0 ? 0 : previousLevel);
			if (index == 0) {
				normalized.level = 0;
			}
			else {
				normalized.level = Math.max(0, Math.min(normalized.level, previousLevel + 1));
			}
			previousLevel = normalized.level;
			out.push(normalized);
		}
		return out;
	}

	function normalizeDisplayWidthPercent(value, fallback = 100) {
		let numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric <= 0) {
			numeric = Number(fallback || 100);
		}
		if (!Number.isFinite(numeric) || numeric <= 0) {
			numeric = 100;
		}
		return Math.max(10, Math.min(100, Math.round(numeric)));
	}

	function normalizeListStyle(value, ordered = false) {
		let normalized = String(value || "").trim().toLowerCase();
		let allowed = ordered
			? ["decimal", "lower-alpha", "lower-roman"]
			: ["disc", "circle", "square"];
		return allowed.includes(normalized)
			? normalized
			: (ordered ? "decimal" : "disc");
	}

	function documentBulletStyle(options = {}) {
		return normalizeListStyle(options?.settings?.bulletStyle || DEFAULT_EDITOR_SETTINGS.bulletStyle, false);
	}

	function explicitListStyleFromElement(element) {
		let explicit = String(
			element?.getAttribute?.("data-list-style-explicit")
			|| element?.getAttribute?.("data-sr-list-style-explicit")
			|| ""
		).trim().toLowerCase();
		if (explicit != "true") {
			return "";
		}
		return String(
			element?.getAttribute?.("data-list-style")
			|| element?.getAttribute?.("data-sr-list-style")
			|| ""
		).trim();
	}

	function normalizeListBlock(block = {}, options = {}) {
		let ordered = !!block?.ordered;
		let explicitListStyle = String(block?.listStyle || "").trim();
		let normalizedExplicitListStyle = explicitListStyle ? normalizeListStyle(explicitListStyle, ordered) : "";
		let resolvedListStyle = ordered
			? (normalizedExplicitListStyle || "decimal")
			: (normalizedExplicitListStyle || documentBulletStyle(options));
		return {
			type: "list",
			ordered,
			items: normalizeListItems(block?.items || []),
			listStyle: normalizedExplicitListStyle,
			resolvedListStyle,
			hasExplicitListStyle: !!normalizedExplicitListStyle,
		};
	}

	function listBlockMeta(block = {}) {
		let normalized = normalizeListBlock(block);
		if (!normalized.hasExplicitListStyle) {
			return null;
		}
		return { listStyle: normalized.listStyle };
	}

	function listIndentLevel(rawIndent) {
		let source = String(rawIndent || "");
		let tabCount = (source.match(/\t/g) || []).length;
		let spaceCount = source.replace(/\t/g, "").length;
		let level = tabCount + Math.floor(spaceCount / 4);
		if (!tabCount && level === 0 && spaceCount >= 2) {
			level = 1;
		}
		return normalizeListLevel(level, 0);
	}

	function orderedListMarkerLabel(value, style = "decimal") {
		let numeric = Math.max(1, Number(value || 1) || 1);
		switch (String(style || "decimal").trim().toLowerCase()) {
			case "lower-alpha": {
				let out = "";
				let current = numeric;
				while (current > 0) {
					current -= 1;
					out = String.fromCharCode(97 + (current % 26)) + out;
					current = Math.floor(current / 26);
				}
				return out || "a";
			}
			case "lower-roman": {
				let pairs = [
					["m", 1000],
					["cm", 900],
					["d", 500],
					["cd", 400],
					["c", 100],
					["xc", 90],
					["l", 50],
					["xl", 40],
					["x", 10],
					["ix", 9],
					["v", 5],
					["iv", 4],
					["i", 1],
				];
				let current = numeric;
				let out = "";
				for (let [label, amount] of pairs) {
					while (current >= amount) {
						out += label;
						current -= amount;
					}
				}
				return out || "i";
			}
			default:
				return String(numeric);
		}
	}

	function orderedListMarkerLabels(items = [], style = "decimal") {
		let normalized = normalizeListItems(items);
		let counters = [];
		return normalized.map((item) => {
			let level = normalizeListLevel(item.level, 0);
			counters = counters.slice(0, level + 1);
			counters[level] = (counters[level] || 0) + 1;
			let prefix = counters
				.slice(0, level)
				.map((value) => String(value))
				.join(".");
			let current = orderedListMarkerLabel(counters[level], style);
			return `${prefix ? `${prefix}.` : ""}${current}.`;
		});
	}

	function renderListBlockHTML(block, options = {}, { native = false } = {}) {
		let normalized = normalizeListBlock(block, options);
		let ordered = !!normalized.ordered;
		let items = normalized.items;
		let markerStyle = normalized.resolvedListStyle;
		let markers = ordered ? orderedListMarkerLabels(items, markerStyle) : [];
		let unorderedMarker = markerStyle == "square"
			? "▪"
			: (markerStyle == "circle" ? "◦" : "•");
		let listKind = ordered ? "ol" : "ul";
		let itemClass = native ? "sr-block-editable" : "sr-list-item-text";
		return `<section class="sr-${native ? "native-" : ""}list-block sr-block-list" data-sr-list-kind="${listKind}" data-sr-list-style="${markerStyle}" data-sr-list-style-explicit="${normalized.hasExplicitListStyle ? "true" : "false"}"><div class="sr-native-list">${
			items.map((item, index) => `<div class="sr-native-list-item" data-level="${item.level}" style="--sr-list-level:${item.level}"><div class="sr-native-list-marker">${ordered ? markers[index] : unorderedMarker}</div><div class="${itemClass}">${renderInlineHTML(item.text || "", options)}</div></div>`).join("")
		}</div></section>`;
	}

	function parseBlockMeta(line) {
		let match = String(line || "").match(BLOCK_META_RE);
		if (!match) {
			return null;
		}
		try {
			let parsed = JSON.parse(match[1]);
			return parsed && typeof parsed == "object" ? parsed : null;
		}
		catch (_err) {
			return null;
		}
	}

	function serializeBlockMeta(meta) {
		if (!meta || typeof meta != "object") {
			return "";
		}
		return `<!-- sr:block-meta ${JSON.stringify(meta)} -->`;
	}

	function trimBlockText(value) {
		let text = normalizeNewlines(value).trim();
		return text || "";
	}

	function protectHardBreakMarkdown(value = "") {
		return normalizeNewlines(value).replaceAll(HARD_BREAK_MARKDOWN, HARD_BREAK_TOKEN);
	}

	function restoreHardBreakMarkdown(value = "") {
		return String(value || "").replaceAll(HARD_BREAK_TOKEN, HARD_BREAK_MARKDOWN);
	}

	function splitTextOnBareNewlines(value = "") {
		return protectHardBreakMarkdown(value)
			.split(/\n+/)
			.map((part) => trimBlockText(restoreHardBreakMarkdown(part)))
			.filter(Boolean);
	}

	function paragraphBlocksFromText(text = "") {
		return splitTextOnBareNewlines(text).map((segment) => ({
			type: "paragraph",
			text: segment,
		}));
	}

	function headingAndParagraphBlocksFromText(level = 1, text = "") {
		let segments = splitTextOnBareNewlines(text);
		if (!segments.length) {
			return [];
		}
		return [{
			type: "heading",
			level: Math.max(1, Math.min(6, Number(level || 1) || 1)),
			text: segments[0],
		}].concat(
			segments.slice(1).map((segment) => ({
				type: "paragraph",
				text: segment,
			}))
		);
	}

	function listItemsFromText(text = "", level = 0) {
		return splitTextOnBareNewlines(text).map((segment) => ({
			text: segment,
			level: normalizeListLevel(level, 0),
		}));
	}

	function normalizeTableCell(cell) {
		if (cell && typeof cell == "object" && !Array.isArray(cell)) {
			let colspan = Number(cell.colspan || 1);
			return {
				text: String(cell.text || ""),
				colspan: Number.isFinite(colspan) && colspan > 1 ? Math.round(colspan) : 1,
			};
		}
		return {
			text: String(cell || ""),
			colspan: 1,
		};
	}

	function tableRowColumnCount(row) {
		return (Array.isArray(row) ? row : [])
			.map((cell) => normalizeTableCell(cell))
			.reduce((sum, cell) => sum + Math.max(1, cell.colspan || 1), 0);
	}

	function tableColumnCount(block) {
		let count = Array.isArray(block?.header) ? block.header.length : 0;
		for (let row of block?.rows || []) {
			count = Math.max(count, tableRowColumnCount(row));
		}
		return Math.max(1, count);
	}

	function normalizeTableAlignments(alignments, columnCount) {
		let out = Array.isArray(alignments) ? alignments.map((value) => normalizeTableAlignment(value)) : [];
		while (out.length < columnCount) {
			out.push("");
		}
		return out.slice(0, columnCount);
	}

	function normalizeTableRow(row, columnCount = 0) {
		let cells = Array.isArray(row) ? row.map((cell) => normalizeTableCell(cell)) : [];
		let occupied = cells.reduce((sum, cell) => sum + Math.max(1, cell.colspan || 1), 0);
		if (!cells.length && columnCount > 0) {
			cells = Array.from({ length: columnCount }, () => ({ text: "", colspan: 1 }));
			occupied = columnCount;
		}
		while (occupied < columnCount) {
			cells.push({ text: "", colspan: 1 });
			occupied += 1;
		}
		return cells;
	}

	function normalizeTableBlock(block = {}) {
		let columnCount = tableColumnCount(block);
		let header = Array.isArray(block.header)
			? block.header.map((cell) => String(cell || ""))
			: [];
		while (header.length < columnCount) {
			header.push("");
		}
		return {
			type: "table",
			header: header.slice(0, columnCount),
			alignments: normalizeTableAlignments(block.alignments, columnCount),
			rows: (block.rows || []).map((row) => normalizeTableRow(row, columnCount)),
			captionAbove: trimBlockText(block.captionAbove),
			noteBelow: trimBlockText(block.noteBelow),
			columnCount,
		};
	}

	function cloneTableBlock(block = {}) {
		let normalized = normalizeTableBlock(block);
		return {
			type: "table",
			header: normalized.header.slice(),
			alignments: normalized.alignments.slice(),
			rows: normalized.rows.map((row) => row.map((cell) => ({ text: cell.text, colspan: cell.colspan }))),
			captionAbove: normalized.captionAbove,
			noteBelow: normalized.noteBelow,
			columnCount: normalized.columnCount,
		};
	}

	function tableBlockMeta(block) {
		let normalized = normalizeTableBlock(block);
		let meta = {};
		if (normalized.captionAbove) {
			meta.captionAbove = normalized.captionAbove;
		}
		if (normalized.noteBelow) {
			meta.noteBelow = normalized.noteBelow;
		}
		let rowColSpans = normalized.rows.map((row) => row.map((cell) => Math.max(1, cell.colspan || 1)));
		if (rowColSpans.some((row) => row.some((span) => span > 1))) {
			meta.rowColSpans = rowColSpans;
		}
		return Object.keys(meta).length ? meta : null;
	}

	function mediaBlockMeta(block = {}) {
		let meta = {};
		let captionAbove = trimBlockText(block.captionAbove);
		let noteBelow = trimBlockText(block.noteBelow);
		let displayWidthPercent = normalizeDisplayWidthPercent(block.displayWidthPercent, 100);
		if (captionAbove) {
			meta.captionAbove = captionAbove;
		}
		if (noteBelow) {
			meta.noteBelow = noteBelow;
		}
		if (displayWidthPercent != 100) {
			meta.displayWidthPercent = displayWidthPercent;
		}
		return Object.keys(meta).length ? meta : null;
	}

	function applyTableMetaToRows(rows, meta, columnCount) {
		let rowSpans = Array.isArray(meta?.rowColSpans) ? meta.rowColSpans : null;
		return (rows || []).map((row, rowIndex) => {
			let spans = Array.isArray(rowSpans?.[rowIndex]) ? rowSpans[rowIndex] : null;
			if (!spans || spans.length != row.length) {
				return normalizeTableRow(row, columnCount);
			}
			let spanTotal = spans.reduce((sum, value) => sum + Math.max(1, Number(value) || 1), 0);
			if (spanTotal != columnCount) {
				return normalizeTableRow(row, columnCount);
			}
			return row.map((cell, cellIndex) => ({
				text: String(cell || ""),
				colspan: Math.max(1, Number(spans[cellIndex]) || 1),
			}));
		});
	}

	function isSingleLineContext(text) {
		let value = trimBlockText(text);
		return !!value && !value.includes("\n");
	}

	function looksLikeCaption(text, kind = "") {
		let value = trimBlockText(text);
		if (!isSingleLineContext(value) || value.length > 220) {
			return false;
		}
		if (/^(?:table|tbl\.?|figure|fig\.?|supplementary\s+(?:table|figure)|appendix\s+(?:table|figure))\b/i.test(value)) {
			return true;
		}
		return kind == "table" && /^[A-Z][^.!?]{0,180}$/.test(value);
	}

	function looksLikeNote(text) {
		let value = trimBlockText(text);
		if (!value || value.length > 500) {
			return false;
		}
		return /^(?:\*?\s*)?(?:note|notes|abbreviations?|legend|key|source|sources)\b[.:]?/i.test(value);
	}

	function looksLikeTableOrFigureNumber(text, kind = "") {
		let value = trimBlockText(text);
		if (!isSingleLineContext(value)) {
			return false;
		}
		if (kind == "table") {
			return /^table\s+\d+[a-z]?$/i.test(value);
		}
		if (kind == "image") {
			return /^figure\s+\d+[a-z]?$/i.test(value);
		}
		return /^(?:table|figure)\s+\d+[a-z]?$/i.test(value);
	}

	function attachBlockContext(blocks) {
		let out = [];
		for (let index = 0; index < (blocks || []).length; index += 1) {
			let block = blocks[index];
			if (!block) {
				continue;
			}
			let current = block.type == "table"
				? cloneTableBlock(block)
				: Object.assign({}, block, {
					captionAbove: trimBlockText(block.captionAbove),
					noteBelow: trimBlockText(block.noteBelow),
			});
			if (current.type == "table" || current.type == "image") {
				let previous = out[out.length - 1] || null;
				let previousBefore = out[out.length - 2] || null;
				if (previous?.type == "paragraph") {
					let previousText = trimBlockText(previous.text);
					let previousBeforeText = previousBefore?.type == "paragraph" ? trimBlockText(previousBefore.text) : "";
					if (current.captionAbove && previousText == current.captionAbove) {
						out.pop();
					}
					else if (
						!current.captionAbove
						&& previousBefore?.type == "paragraph"
						&& looksLikeTableOrFigureNumber(previousBeforeText, current.type)
						&& looksLikeCaption(previousText, current.type)
					) {
						current.captionAbove = `${previousBeforeText}\n${previousText}`.trim();
						out.pop();
						out.pop();
					}
					else if (!current.captionAbove && looksLikeCaption(previousText, current.type)) {
						current.captionAbove = previousText;
						out.pop();
					}
				}
				let next = blocks[index + 1] || null;
				if (next?.type == "paragraph") {
					let nextText = trimBlockText(next.text);
					if (current.noteBelow && nextText == current.noteBelow) {
						index += 1;
					}
					else if (!current.noteBelow && looksLikeNote(nextText)) {
						current.noteBelow = nextText;
						index += 1;
					}
				}
			}
			out.push(current);
		}
		return out;
	}

	function splitContextLines(text) {
		return normalizeNewlines(text)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	function layoutStyleID(options = {}) {
		let settings = options?.settings || {};
		let preset = resolveCitationStylePreset(settings.citationStyleID || "");
		return preset.id || "standard";
	}

	function renderCaptionHTML(text, options = {}, kind = "table") {
		let lines = splitContextLines(text);
		if (!lines.length) {
			return "";
		}
		let styleID = layoutStyleID(options);
		if (styleID == "apa") {
			let out = [];
			let first = lines[0] || "";
			let second = lines[1] || "";
			if (looksLikeTableOrFigureNumber(first, kind)) {
				out.push(`<div class="sr-block-caption-line sr-caption-number">${renderInlineHTML(first, options)}</div>`);
				if (second) {
					out.push(`<div class="sr-block-caption-line sr-caption-title">${renderInlineHTML(second, options)}</div>`);
				}
				for (let index = 2; index < lines.length; index += 1) {
					out.push(`<div class="sr-block-caption-line sr-caption-extra">${renderInlineHTML(lines[index], options)}</div>`);
				}
				return out.join("");
			}
		}
		return lines.map((line) => `<div class="sr-block-caption-line">${renderInlineHTML(line, options)}</div>`).join("");
	}

	function renderNoteHTML(text, options = {}) {
		let value = trimBlockText(text);
		if (!value) {
			return "";
		}
		let styleID = layoutStyleID(options);
		if (styleID == "apa") {
			let match = value.match(/^(Note\.)\s*(.*)$/i);
			if (match) {
				return `<span class="sr-note-label">${escapeHTML(match[1])}</span>${match[2] ? ` ${renderInlineHTML(match[2], options)}` : ""}`;
			}
		}
		return renderInlineHTML(value, options);
	}

	function renderTableCells(row, tagName, alignments, options = {}) {
		let html = [];
		let columnIndex = 0;
		for (let rawCell of row || []) {
			let cell = normalizeTableCell(rawCell);
			let align = normalizeTableAlignment(alignments?.[columnIndex] || "");
			let attrs = [
				` data-sr-align="${align || "left"}"`,
				` data-sr-column-index="${columnIndex}"`,
				cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "",
			].join("");
			html.push(`<${tagName}${attrs}>${tagName == "th" ? "" : ""}${renderInlineHTML(cell.text, options)}</${tagName}>`);
			columnIndex += cell.colspan;
		}
		return html.join("");
	}

	function parseCitationAttributes(rawAttributes = "") {
		let source = String(rawAttributes || "").trim();
		if (!source) {
			return { locator: "", prefix: "", suffix: "" };
		}
		let out = { locator: "", prefix: "", suffix: "" };
		let attrRE = /\b(locator|prefix|suffix)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
		for (let match of source.matchAll(attrRE)) {
			let key = String(match[1] || "").trim();
			let value = String(match[2] || "")
				.replace(/\\\\/g, "\\")
				.replace(/\\"/g, "\"");
			if (key) {
				out[key] = value;
			}
		}
		return out;
	}

	function serializeCitationAttributes({ locator = "", prefix = "", suffix = "" } = {}) {
		let parts = [];
		for (let [key, value] of [
			["locator", locator],
			["prefix", prefix],
			["suffix", suffix],
		]) {
			let text = String(value || "");
			if (!text) {
				continue;
			}
			let escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			parts.push(`${key}="${escaped}"`);
		}
		return parts.join(", ");
	}

	function parseCitationMarkdown(rawToken) {
		let token = String(rawToken || "").trim();
		let match = token.match(/^@\[\s*([A-Za-z0-9]+(?:\s*,\s*[A-Za-z0-9]+)*)\s*\](?:\{([\s\S]*?)\})?$/);
		if (!match) {
			return null;
		}
		let keys = String(match[1] || "")
			.split(",")
			.map((key) => key.trim())
			.filter(Boolean);
		if (!keys.length) {
			return null;
		}
		let attrs = parseCitationAttributes(match[2] || "");
		return {
			keys,
			locator: attrs.locator || "",
			prefix: attrs.prefix || "",
			suffix: attrs.suffix || "",
			markdown: token,
		};
	}

	function makeCitationMarkdown({ keys, locator = "", prefix = "", suffix = "" }) {
		let cleanedKeys = (keys || []).map((key) => String(key || "").trim()).filter(Boolean);
		if (!cleanedKeys.length) {
			return "";
		}
		let token = `@[${cleanedKeys.join(",")}]`;
		let attrs = serializeCitationAttributes({ locator, prefix, suffix });
		return attrs ? `${token}{${attrs}}` : token;
	}

	function isBibliographyURL(rawHref) {
		return String(rawHref || "").trim() == "zotero://systematic-reviewer/bibliography";
	}

	function replaceCitationMarkdown(sourceText, replacer) {
		let source = String(sourceText || "");
		let re = /@\[\s*[A-Za-z0-9]+(?:\s*,\s*[A-Za-z0-9]+)*\s*\](?:\{[\s\S]*?\})?/g;
		return source.replace(re, (match) => {
			let citation = parseCitationMarkdown(match);
			return citation ? replacer(citation, match) : match;
		});
	}

	function extractCitations(markdown) {
		let out = [];
		replaceCitationMarkdown(normalizeNewlines(markdown), (citation, rawToken) => {
			out.push(Object.assign({}, citation, {
				markdown: citation.markdown || String(rawToken || ""),
			}));
			return rawToken;
		});
		return out;
	}

	function normalizePageLayout(layout) {
		return String(layout || "").toLowerCase() == "landscape" ? "landscape" : "portrait";
	}

	function generatedSingletonFirstIndices(blocks = []) {
		let out = {
			toc: -1,
			bibliography: -1,
			prisma: -1,
		};
		for (let index = 0; index < (blocks || []).length; index += 1) {
			let block = blocks[index];
			if (!block || !Object.prototype.hasOwnProperty.call(out, block.type) || out[block.type] >= 0) {
				continue;
			}
			out[block.type] = index;
		}
		return out;
	}

	function outlineCanonicalSectionTitle(type = "") {
		switch (String(type || "").trim().toLowerCase()) {
			case "toc":
				return "Table of Contents";
			case "bibliography":
				return "Bibliography";
			case "prisma":
				return "PRISMA";
			default:
				return "";
		}
	}

	function normalizeOutlineLabel(text = "") {
		return String(text || "")
			.replace(/@\[[^\]]+\](?:\{[\s\S]*?\})?/g, " cite ")
			.replace(/[_*`~[\]()<>#!]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
	}

	function slugifyOutlineText(text = "", fallback = "section") {
		let source = String(text || "")
			.toLowerCase()
			.replace(/@\[[^\]]+\](?:\{[\s\S]*?\})?/g, " cite ")
			.replace(/[_*`~[\]()<>#!]+/g, " ")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return source || fallback;
	}

	function previousGeneratedHeadingBlockIndex(blocks = [], index = -1, type = "") {
		let canonical = normalizeOutlineLabel(outlineCanonicalSectionTitle(type));
		if (!canonical || index <= 0) {
			return -1;
		}
		for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
			let candidate = blocks[cursor] || null;
			if (!candidate) {
				continue;
			}
			if (candidate.type == "page-marker" || candidate.type == "page-layout") {
				continue;
			}
			if (candidate.type == "page-break") {
				return -1;
			}
			if (candidate.type == "heading" && normalizeOutlineLabel(candidate.text || "") == canonical) {
				return cursor;
			}
			return -1;
		}
		return -1;
	}

	function anchorAttributes(anchor = "") {
		let value = String(anchor || "").trim();
		if (!value) {
			return "";
		}
		return ` id="${escapeHTML(value)}" data-sr-anchor="${escapeHTML(value)}"`;
	}

	function blockOutlineIndex(block, outline = null) {
		if (!block || !outline?.blockIndexByRef?.get) {
			return -1;
		}
		return Number(outline.blockIndexByRef.get(block) ?? -1);
	}

	function normalizeTOCMinimumHeadingLevel(options = {}) {
		let level = Number(options?.tocMinHeadingLevel ?? options?.minimumTOCHeadingLevel ?? 2) || 2;
		return Math.max(1, Math.min(6, Math.round(level)));
	}

	function tocDisplayLevelForSourceLevel(level = 1, minHeadingLevel = 2) {
		let sourceLevel = Math.max(1, Math.min(6, Number(level || 1) || 1));
		let minimum = Math.max(1, Math.min(6, Number(minHeadingLevel || 2) || 2));
		return Math.max(1, sourceLevel - minimum + 1);
	}

	function buildDocumentOutline(blocksInput = [], options = {}) {
		let blocks = Array.isArray(blocksInput) ? blocksInput : parseMarkdown(blocksInput);
		let tocMinHeadingLevel = normalizeTOCMinimumHeadingLevel(options);
		let firstIndices = generatedSingletonFirstIndices(blocks);
		let blockIndexByRef = new Map();
		let blockAnchorByIndex = new Map();
		let generatedHeadingReuseByIndex = new Map();
		let entries = [];

		for (let index = 0; index < blocks.length; index += 1) {
			let block = blocks[index];
			if (block && typeof block == "object") {
				blockIndexByRef.set(block, index);
			}
		}

		for (let type of ["bibliography", "prisma"]) {
			let index = firstIndices[type];
			if (index < 0) {
				continue;
			}
			let headingIndex = previousGeneratedHeadingBlockIndex(blocks, index, type);
			if (headingIndex >= 0) {
				generatedHeadingReuseByIndex.set(index, headingIndex);
			}
		}

		if (firstIndices.toc >= 0) {
			blockAnchorByIndex.set(firstIndices.toc, "sr-toc");
		}

		let headingSequence = 0;
		for (let index = 0; index < blocks.length; index += 1) {
			let block = blocks[index];
			if (!block) {
				continue;
			}
			if (block.type == "toc" && firstIndices.toc == index && options.includeTOCSelf !== false) {
				entries.push({
					kind: "toc",
					title: outlineCanonicalSectionTitle("toc"),
					level: 1,
					anchor: "sr-toc",
					blockIndex: index,
				});
				continue;
			}
			if (block.type == "heading") {
				headingSequence += 1;
				let level = Math.max(1, Math.min(6, Number(block.level || 1) || 1));
				let title = String(block.text || "").trim() || `Heading ${level}`;
				let anchor = `sr-heading-${headingSequence}-${slugifyOutlineText(title, "heading")}`;
				blockAnchorByIndex.set(index, anchor);
				if (level < tocMinHeadingLevel) {
					continue;
				}
				entries.push({
					kind: "heading",
					title,
					level: tocDisplayLevelForSourceLevel(level, tocMinHeadingLevel),
					sourceLevel: level,
					anchor,
					blockIndex: index,
				});
				continue;
			}
			if ((block.type == "bibliography" || block.type == "prisma") && firstIndices[block.type] == index && !generatedHeadingReuseByIndex.has(index)) {
				let title = outlineCanonicalSectionTitle(block.type);
				let anchor = `sr-${block.type}`;
				blockAnchorByIndex.set(index, anchor);
				entries.push({
					kind: block.type,
					title,
					level: tocDisplayLevelForSourceLevel(2, tocMinHeadingLevel),
					sourceLevel: 2,
					anchor,
					blockIndex: index,
				});
			}
		}

		return {
			blocks,
			firstIndices,
			blockIndexByRef,
			blockAnchorByIndex,
			generatedHeadingReuseByIndex,
			entries,
		};
	}

	function tocEntryLabelText(entry, options = {}) {
		let label = String(entry?.title || "").trim() || outlineCanonicalSectionTitle(entry?.kind || "");
		label = label
			.replace(/@\[[^\]]+\](?:\{[\s\S]*?\})?/g, "cite")
			.replace(/[_*`~]+/g, "")
			.trim();
		return label;
	}

	function tocLeaderDotsHTML() {
		return ".".repeat(512);
	}

	function renderTOCBlockHTML(outline = null, options = {}) {
		let entries = Array.isArray(outline?.entries) ? outline.entries : [];
		let includePageNumbers = options?.includePageNumbers !== false;
		let anchor = String(outline?.blockAnchorByIndex?.get(outline?.firstIndices?.toc) || "sr-toc").trim();
		return `<section class="sr-toc-block" data-sr-toc="true" data-sr-toc-root="true"${anchorAttributes(anchor)}><h1 class="sr-toc-heading">${escapeHTML(outlineCanonicalSectionTitle("toc"))}</h1><div class="sr-toc-flow">${
			entries.map((entry) => {
				let level = Math.max(1, Number(entry?.level || 1) || 1);
				let label = tocEntryLabelText(entry, options);
				let targetAnchor = String(entry?.anchor || "").trim();
				return `<div class="sr-toc-entry" data-sr-toc-level="${level}" data-sr-toc-label="${escapeHTML(label)}" data-sr-toc-target-anchor="${escapeHTML(targetAnchor)}" style="padding-inline-start:${Math.max(0, (level - 1) * 1.25).toFixed(2)}em;"><a class="sr-toc-link${includePageNumbers ? " sr-toc-link-paged" : ""}" href="#${escapeHTML(targetAnchor)}" data-sr-toc-link="true"${includePageNumbers ? ` data-sr-toc-paged="true"` : ""}><span class="sr-toc-main"><span class="sr-toc-entry-label">${escapeHTML(label)}</span></span>${includePageNumbers ? `<span class="sr-toc-leader" aria-hidden="true">${tocLeaderDotsHTML()}</span><span class="sr-toc-page-number" data-sr-toc-target-anchor="${escapeHTML(targetAnchor)}"></span>` : ""}</a></div>`;
			}).join("")
		}</div></section>`;
	}

	function collectRenderedAnchorPageMap(root) {
		let out = new Map();
		for (let sheet of Array.from(root?.querySelectorAll?.(".sr-page-sheet[data-sr-page-index], .sr-editor-section[data-sr-page-index]") || [])) {
			let pageIndex = Number(sheet?.getAttribute?.("data-sr-page-index") || 0) || 0;
			if (!pageIndex) {
				continue;
			}
			for (let node of Array.from(sheet.querySelectorAll?.("[data-sr-anchor]") || [])) {
				let anchor = String(node?.getAttribute?.("data-sr-anchor") || node?.id || "").trim();
				if (anchor && !out.has(anchor)) {
					out.set(anchor, pageIndex);
				}
			}
		}
		return out;
	}

	function updateRenderedTOCPageNumbers(root) {
		let pageMap = collectRenderedAnchorPageMap(root);
		Array.from(root?.querySelectorAll?.(".sr-toc-page-number[data-sr-toc-target-anchor]") || []).forEach((node) => {
			let anchor = String(node?.getAttribute?.("data-sr-toc-target-anchor") || "").trim();
			node.textContent = anchor && pageMap.has(anchor) ? String(pageMap.get(anchor)) : "";
		});
	}

	function ensureTOCMeasureHost(doc) {
		if (!doc?.createElement) {
			return null;
		}
		let host = doc.getElementById?.("sr-toc-measure-host") || null;
		if (!host) {
			host = doc.createElement("span");
			host.id = "sr-toc-measure-host";
			host.setAttribute("aria-hidden", "true");
			host.style.position = "absolute";
			host.style.left = "-100000px";
			host.style.top = "0";
			host.style.visibility = "hidden";
			host.style.pointerEvents = "none";
			host.style.whiteSpace = "nowrap";
			host.style.padding = "0";
			host.style.margin = "0";
			host.style.border = "0";
			(doc.body || doc.documentElement || doc).appendChild(host);
		}
		return host;
	}

	function syncTOCMeasureHostStyle(host, sampleNode) {
		let doc = sampleNode?.ownerDocument || host?.ownerDocument || null;
		let win = doc?.defaultView || null;
		if (!host || !sampleNode || !win?.getComputedStyle) {
			return "";
		}
		let style = win.getComputedStyle(sampleNode);
		let key = [
			style.fontStyle,
			style.fontVariant,
			style.fontWeight,
			style.fontStretch,
			style.fontSize,
			style.fontFamily,
			style.letterSpacing,
			style.wordSpacing,
			style.textTransform,
		].join("|");
		if (host.getAttribute("data-sr-toc-style-key") == key) {
			return key;
		}
		host.setAttribute("data-sr-toc-style-key", key);
		host.style.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
		host.style.fontFamily = style.fontFamily;
		host.style.fontSize = style.fontSize;
		host.style.fontWeight = style.fontWeight;
		host.style.fontStyle = style.fontStyle;
		host.style.letterSpacing = style.letterSpacing;
		host.style.wordSpacing = style.wordSpacing;
		host.style.textTransform = style.textTransform;
		host.style.lineHeight = style.lineHeight;
		return key;
	}

	function measureTOCTextWidth(host = null, text = "", styleKey = "", cache = null) {
		let normalized = String(text || "");
		if (!host) {
			return normalized.length * 8;
		}
		let cacheKey = styleKey ? `${styleKey}::${normalized}` : normalized;
		if (cache?.has?.(cacheKey)) {
			return cache.get(cacheKey);
		}
		host.style.display = "inline-block";
		host.style.width = "auto";
		host.style.maxWidth = "none";
		host.style.whiteSpace = "nowrap";
		host.style.overflowWrap = "normal";
		host.style.wordBreak = "normal";
		host.textContent = normalized;
		let width = host.getBoundingClientRect?.().width || host.offsetWidth || host.scrollWidth || 0;
		if (cache?.set) {
			cache.set(cacheKey, width);
		}
		return width;
	}

	function splitTOCTokenToFit(token = "", maxWidth = 0, host = null, styleKey = "", cache = null) {
		let remaining = String(token || "");
		let parts = [];
		while (remaining) {
			if (remaining.length == 1 || measureTOCTextWidth(host, remaining, styleKey, cache) <= maxWidth) {
				parts.push(remaining);
				break;
			}
			let low = 1;
			let high = remaining.length;
			let best = 1;
			while (low <= high) {
				let mid = Math.floor((low + high) / 2);
				let slice = remaining.slice(0, mid);
				if (measureTOCTextWidth(host, slice, styleKey, cache) <= maxWidth) {
					best = mid;
					low = mid + 1;
				}
				else {
					high = mid - 1;
				}
			}
			parts.push(remaining.slice(0, best));
			remaining = remaining.slice(best);
		}
		return parts.filter(Boolean);
	}

	function wrapTOCLabelLines(text = "", maxWidth = 0, sampleNode = null, cache = null) {
		let normalized = String(text || "").replace(/\s+/g, " ").trim();
		if (!normalized) {
			return [""];
		}
		let doc = sampleNode?.ownerDocument || null;
		let host = ensureTOCMeasureHost(doc);
		if (maxWidth <= 0 || !host || !sampleNode) {
			return [normalized];
		}
		let styleKey = syncTOCMeasureHostStyle(host, sampleNode);
		let lines = [];
		let current = "";
		for (let word of normalized.split(/\s+/).filter(Boolean)) {
			let candidate = current ? `${current} ${word}` : word;
			if (measureTOCTextWidth(host, candidate, styleKey, cache) <= maxWidth) {
				current = candidate;
				continue;
			}
			if (current) {
				lines.push(current);
			}
			if (measureTOCTextWidth(host, word, styleKey, cache) <= maxWidth) {
				current = word;
				continue;
			}
			let fragments = splitTOCTokenToFit(word, maxWidth, host, styleKey, cache);
			if (!fragments.length) {
				current = word;
				continue;
			}
			lines.push(...fragments.slice(0, -1));
			current = fragments[fragments.length - 1] || "";
		}
		if (current) {
			lines.push(current);
		}
		return lines.length ? lines : [normalized];
	}

	function layoutRenderedTOCEntry(_entry, _cache = null) {}

	function layoutRenderedTOCRows(_root) {}

	function isTOCContinuationNode(node) {
		return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() == "toc";
	}

	function tocDisplayRoot(node) {
		if (node?.matches?.(".sr-toc-block[data-sr-toc-root='true']")) {
			return node;
		}
		return node?.querySelector?.(".sr-toc-block[data-sr-toc-root='true']") || null;
	}

	function isTOCDisplayNode(node) {
		return !!tocDisplayRoot(node);
	}

	function tocHeadingElement(root) {
		return root?.querySelector?.(":scope > .sr-toc-heading") || root?.querySelector?.(":scope > h1") || null;
	}

	function tocFlowElement(root) {
		if (!root) {
			return null;
		}
		let flow = root.querySelector(":scope > .sr-toc-flow");
		if (!flow) {
			flow = root.ownerDocument?.createElement?.("div") || null;
			if (!flow) {
				return null;
			}
			flow.className = "sr-toc-flow";
			let movable = Array.from(root.childNodes || []).filter((child) => child !== tocHeadingElement(root));
			if (movable.length) {
				flow.append(...movable);
			}
			root.appendChild(flow);
		}
		return flow;
	}

	function tocEntryNodes(node) {
		let root = tocDisplayRoot(node);
		let flow = tocFlowElement(root);
		return Array.from(flow?.children || []).filter((child) => child?.matches?.(".sr-toc-entry"));
	}

	function cloneTOCEntries(nodes = []) {
		let entries = [];
		for (let sourceNode of nodes) {
			for (let entry of tocEntryNodes(sourceNode)) {
				entries.push(entry.cloneNode(true));
			}
		}
		return entries;
	}

	function setTOCContinuationState(node, continuation = false) {
		if (!node) {
			return;
		}
		if (continuation) {
			node.setAttribute("data-sr-generated-continuation", "toc");
		}
		else {
			node.removeAttribute("data-sr-generated-continuation");
		}
		let root = tocDisplayRoot(node);
		if (!root) {
			return;
		}
		root.classList.toggle("is-continuation", continuation);
		if (continuation) {
			root.removeAttribute("id");
			root.removeAttribute("data-sr-anchor");
		}
	}

	function setTOCNodeEntries(node, entries = [], { continuation = false } = {}) {
		let root = tocDisplayRoot(node);
		if (!root) {
			return false;
		}
		setTOCContinuationState(node, continuation);
		let heading = tocHeadingElement(root);
		if (continuation) {
			heading?.remove?.();
			heading = null;
		}
		else if (!heading) {
			heading = root.ownerDocument?.createElement?.("h1") || null;
			if (heading) {
				heading.className = "sr-toc-heading";
				heading.textContent = outlineCanonicalSectionTitle("toc");
				root.insertBefore(heading, root.firstChild || null);
			}
		}
		let flow = tocFlowElement(root);
		if (!flow) {
			return false;
		}
		flow.replaceChildren(...entries.map((entry) => entry.cloneNode(true)));
		return true;
	}

	function createTOCContinuationNode(sourceNode) {
		let clone = sourceNode?.cloneNode?.(true) || null;
		if (!clone) {
			return null;
		}
		setTOCNodeEntries(clone, [], { continuation: true });
		return clone;
	}

	function appendTOCEntry(node, entry) {
		let root = tocDisplayRoot(node);
		let flow = tocFlowElement(root);
		if (!flow || !entry) {
			return;
		}
		flow.appendChild(entry);
	}

	function removeLastTOCEntry(node) {
		let entries = tocEntryNodes(node);
		let last = entries[entries.length - 1] || null;
		if (!last) {
			return null;
		}
		return last.parentNode?.removeChild?.(last) || last;
	}

	function isBibliographyContinuationNode(node) {
		return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() == "bibliography";
	}

	function bibliographyDisplayRoot(node) {
		if (node?.matches?.(".sr-bibliography-block[data-sr-bibliography-root='true']")) {
			return node;
		}
		return node?.querySelector?.(".sr-bibliography-block[data-sr-bibliography-root='true']") || null;
	}

	function isBibliographyDisplayNode(node) {
		return !!bibliographyDisplayRoot(node);
	}

	function bibliographyHeadingElement(root) {
		return root?.querySelector?.(":scope > .sr-bibliography-heading")
			|| root?.querySelector?.(":scope > h2")
			|| null;
	}

	function bibliographyFlowElement(root) {
		if (!root) {
			return null;
		}
		let doc = root.ownerDocument || (typeof document != "undefined" ? document : null);
		let flow = root.querySelector(":scope > .sr-bibliography-flow");
		if (!flow) {
			flow = doc?.createElement?.("div") || null;
			if (!flow) {
				return null;
			}
			flow.className = "sr-bibliography-flow";
			let movable = Array.from(root.childNodes || []).filter((child) => child !== bibliographyHeadingElement(root));
			if (movable.length) {
				flow.append(...movable);
			}
			root.appendChild(flow);
		}
		let body = flow.querySelector(":scope > .csl-bib-body");
		if (!body) {
			body = doc?.createElement?.("div") || null;
			if (!body) {
				return null;
			}
			body.className = "csl-bib-body";
			body.append(...Array.from(flow.childNodes || []));
			flow.replaceChildren(body);
		}
		return body;
	}

	function bibliographyEntryNodes(node) {
		let root = bibliographyDisplayRoot(node);
		let body = bibliographyFlowElement(root);
		return Array.from(body?.children || []).filter((child) => child?.matches?.(".csl-entry"));
	}

	function cloneBibliographyEntries(nodes = []) {
		let entries = [];
		for (let sourceNode of nodes || []) {
			for (let entry of bibliographyEntryNodes(sourceNode)) {
				entries.push(entry.cloneNode(true));
			}
		}
		return entries;
	}

	function setBibliographyContinuationState(node, continuation = false) {
		if (!node) {
			return;
		}
		if (continuation) {
			node.setAttribute("data-sr-generated-continuation", "bibliography");
		}
		else {
			node.removeAttribute("data-sr-generated-continuation");
		}
		let root = bibliographyDisplayRoot(node);
		if (!root) {
			return;
		}
		root.classList.toggle("is-continuation", continuation);
		if (continuation) {
			node.removeAttribute("id");
			node.removeAttribute("data-sr-anchor");
			root.removeAttribute("id");
			root.removeAttribute("data-sr-anchor");
		}
	}

	function setBibliographyNodeEntries(node, entries = [], { continuation = false } = {}) {
		let root = bibliographyDisplayRoot(node);
		if (!root) {
			return false;
		}
		setBibliographyContinuationState(node, continuation);
		let heading = bibliographyHeadingElement(root);
		if (continuation) {
			heading?.remove?.();
			heading = null;
		}
		else if (!heading) {
			heading = root.ownerDocument?.createElement?.("h2") || null;
			if (heading) {
				heading.className = "sr-bibliography-heading";
				heading.textContent = outlineCanonicalSectionTitle("bibliography");
				root.insertBefore(heading, root.firstChild || null);
			}
		}
		let body = bibliographyFlowElement(root);
		if (!body) {
			return false;
		}
		body.replaceChildren(...entries.map((entry) => entry.cloneNode(true)));
		return true;
	}

	function createBibliographyContinuationNode(sourceNode) {
		let clone = sourceNode?.cloneNode?.(true) || null;
		if (!clone) {
			return null;
		}
		setBibliographyNodeEntries(clone, [], { continuation: true });
		return clone;
	}

	function bibliographyEntryCount(node) {
		return bibliographyEntryNodes(node).length;
	}

	function appendBibliographyEntry(node, entry) {
		let root = bibliographyDisplayRoot(node);
		let body = bibliographyFlowElement(root);
		if (!body || !entry) {
			return;
		}
		body.appendChild(entry);
	}

	function removeLastBibliographyEntry(node) {
		let entries = bibliographyEntryNodes(node);
		let last = entries[entries.length - 1] || null;
		if (!last) {
			return null;
		}
		return last.parentNode?.removeChild?.(last) || last;
	}

	function codeBlockLanguage(value = "") {
		return String(value || "").trim();
	}

	function codeEditorRows(text = "") {
		let lineCount = normalizeNewlines(text).split("\n").length;
		return Math.max(6, Math.min(24, lineCount + 1));
	}

	function renderCodeDisplayInnerHTML(text = "") {
		return `<div class="sr-code-block-shell"><pre class="sr-code-block-pre"><code>${escapeHTML(text || "")}</code></pre></div>`;
	}

	function renderCodeBlockHTML(block = {}, options = {}) {
		let lang = codeBlockLanguage(block?.lang);
		let langAttr = ` data-sr-code-lang="${escapeHTML(lang)}"`;
		if (options?.editorMode) {
			return `<section class="sr-native-block sr-block-code" data-block-type="code" data-sr-code-root="true"${langAttr}><div class="sr-code-block-shell"><textarea class="sr-code-block-input" rows="${codeEditorRows(block?.text || "")}" spellcheck="false" wrap="soft" data-sr-code="true" data-sr-editable="true"${langAttr}>${escapeHTML(block?.text || "")}</textarea></div></section>`;
		}
		let classes = options?.native ? "sr-native-block sr-block-code" : "sr-code-block sr-block-code";
		let blockTypeAttr = options?.native ? ' data-block-type="code"' : "";
		return `<section class="${classes}"${blockTypeAttr} data-sr-code-root="true"${langAttr}>${renderCodeDisplayInnerHTML(block?.text || "")}</section>`;
	}

	function isCodeContinuationNode(node) {
		return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() == "code";
	}

	function codeDisplayRoot(node) {
		if (node?.matches?.(".sr-block-code[data-sr-code-root='true'], .sr-native-block[data-block-type='code']")) {
			return node;
		}
		return node?.querySelector?.(".sr-block-code[data-sr-code-root='true'], .sr-native-block[data-block-type='code']") || null;
	}

	function codeTextFromNode(node) {
		let root = codeDisplayRoot(node) || node;
		if (!root) {
			return "";
		}
		let textarea = root.matches?.("textarea[data-sr-code='true']") ? root : root.querySelector?.("textarea[data-sr-code='true']");
		if (textarea) {
			return String(textarea.value || textarea.textContent || "");
		}
		let code = root.matches?.("code") ? root : root.querySelector?.("pre > code, code");
		if (code) {
			return String(code.textContent || "");
		}
		let pre = root.matches?.("pre") ? root : root.querySelector?.("pre");
		return String(pre?.textContent || root.textContent || "");
	}

	function codeLanguageFromNode(node) {
		let root = codeDisplayRoot(node) || node;
		if (!root) {
			return "";
		}
		let textarea = root.matches?.("textarea[data-sr-code='true']") ? root : root.querySelector?.("textarea[data-sr-code='true']");
		return codeBlockLanguage(
			textarea?.getAttribute?.("data-sr-code-lang")
			|| root.getAttribute?.("data-sr-code-lang")
			|| root.dataset?.srCodeLang
			|| ""
		);
	}

	function setCodeContinuationState(node, continuation = false) {
		let root = codeDisplayRoot(node) || node;
		if (!root) {
			return;
		}
		if (continuation) {
			root.setAttribute("data-sr-generated-continuation", "code");
			root.removeAttribute("id");
			root.removeAttribute("data-sr-anchor");
		}
		else {
			root.removeAttribute("data-sr-generated-continuation");
		}
	}

	function setCodeNodeText(node, text = "") {
		let root = codeDisplayRoot(node) || node;
		if (!root) {
			return false;
		}
		let value = String(text || "");
		let textarea = root.matches?.("textarea[data-sr-code='true']") ? root : root.querySelector?.("textarea[data-sr-code='true']");
		if (textarea) {
			textarea.value = value;
			return true;
		}
		let code = root.matches?.("code") ? root : root.querySelector?.("pre > code, code");
		if (code) {
			code.textContent = value;
			return true;
		}
		let pre = root.matches?.("pre") ? root : root.querySelector?.("pre");
		if (pre) {
			pre.textContent = value;
			return true;
		}
		return false;
	}

	function createCodeContinuationNode(sourceNode, text = "") {
		let root = codeDisplayRoot(sourceNode) || sourceNode;
		let clone = root?.cloneNode?.(true) || null;
		if (!clone) {
			return null;
		}
		clone.style.display = "";
		clone.removeAttribute("aria-hidden");
		clone.removeAttribute("data-sr-code-fragment-source");
		setCodeNodeText(clone, text);
		setCodeContinuationState(clone, true);
		return clone;
	}

	function resetCodeSourceNode(node) {
		let root = codeDisplayRoot(node) || node;
		if (!root) {
			return null;
		}
		root.style.display = "";
		root.removeAttribute("aria-hidden");
		root.removeAttribute("data-sr-code-fragment-source");
		setCodeContinuationState(root, false);
		return root;
	}

	function parseMarkdown(markdown) {
		let source = normalizeNewlines(markdown);
		let lines = source.split("\n");
		let blocks = [];
		let paragraph = [];
		let codeFence = null;
		let codeLines = [];
		let listKind = null;
		let listItems = [];
		let pendingBlockMeta = null;

		let flushParagraph = () => {
			if (!paragraph.length) {
				return;
			}
			blocks.push({
				type: "paragraph",
				text: paragraph.join("\n").trim(),
			});
			paragraph = [];
		};

		let flushList = () => {
			if (!listKind || !listItems.length) {
				return;
			}
			blocks.push(normalizeListBlock({
				type: "list",
				ordered: listKind == "ol",
				items: listItems.slice(),
				listStyle: pendingBlockMeta?.listStyle,
			}));
			listKind = null;
			listItems = [];
			pendingBlockMeta = null;
		};

		for (let i = 0; i < lines.length; i += 1) {
			let raw = lines[i];
			let line = raw.trimEnd();
			let markerMatch = line.match(PAGE_MARKER_RE);
			let pageBreakMatch = PAGE_BREAK_RE.test(line.trim());
			let pageLayoutMatch = line.match(PAGE_LAYOUT_RE);

			if (codeFence) {
				if (/^```/.test(line.trim())) {
					blocks.push({
						type: "code",
						lang: codeFence,
						text: codeLines.join("\n"),
					});
					codeFence = null;
					codeLines = [];
				}
				else {
					codeLines.push(raw);
				}
				continue;
			}

			if (/^```/.test(line.trim())) {
				flushParagraph();
				flushList();
				codeFence = line.trim().replace(/^```/, "").trim();
				codeLines = [];
				continue;
			}

			if (markerMatch) {
				flushParagraph();
				flushList();
				blocks.push({
					type: "page-marker",
					page: Number(markerMatch[1]),
				});
				continue;
			}

			if (pageBreakMatch) {
				flushParagraph();
				flushList();
				blocks.push({ type: "page-break" });
				continue;
			}

			if (pageLayoutMatch) {
				flushParagraph();
				flushList();
				blocks.push({
					type: "page-layout",
					layout: "landscape",
				});
				continue;
			}

			let blockMeta = parseBlockMeta(line);
			if (blockMeta) {
				flushParagraph();
				flushList();
				pendingBlockMeta = blockMeta;
				continue;
			}

			let next = i + 1 < lines.length ? lines[i + 1] : "";
			if (line.includes("|") && next && isTableSeparator(next)) {
				flushParagraph();
				flushList();
				let header = parseTableRow(line);
				let alignments = parseTableAlignmentRow(next);
				let rows = [];
				i += 2;
				while (i < lines.length) {
					let rowLine = lines[i];
					if (!rowLine.trim() || !rowLine.includes("|")) {
						i -= 1;
						break;
					}
					rows.push(parseTableRow(rowLine));
					i += 1;
				}
				let columnCount = Math.max(header.length, alignments.length, ...rows.map((row) => row.length), 1);
				blocks.push(normalizeTableBlock({
					type: "table",
					header,
					alignments,
					rows: applyTableMetaToRows(rows, pendingBlockMeta, columnCount),
					captionAbove: pendingBlockMeta?.captionAbove || "",
					noteBelow: pendingBlockMeta?.noteBelow || "",
				}));
				pendingBlockMeta = null;
				continue;
			}

			if (!line.trim()) {
				flushParagraph();
				flushList();
				continue;
			}

			if (TOC_PLACEHOLDER_RE.test(line.trim())) {
				flushParagraph();
				flushList();
				blocks.push({ type: "toc" });
				continue;
			}

			if (line.trim() == BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN) {
				flushParagraph();
				flushList();
				blocks.push({ type: "bibliography" });
				continue;
			}

			if (line.trim() == PRISMA_PLACEHOLDER_MARKDOWN) {
				flushParagraph();
				flushList();
				blocks.push({ type: "prisma" });
				continue;
			}

			let standaloneImage = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
			if (standaloneImage) {
				flushParagraph();
				flushList();
				blocks.push({
					type: "image",
					alt: standaloneImage[1] || "",
					src: standaloneImage[2] || "",
					captionAbove: pendingBlockMeta?.captionAbove || "",
					noteBelow: pendingBlockMeta?.noteBelow || "",
					displayWidthPercent: pendingBlockMeta?.displayWidthPercent,
				});
				pendingBlockMeta = null;
				continue;
			}

			let heading = line.match(/^(#{1,6})\s+(.*)$/);
			if (heading) {
				flushParagraph();
				flushList();
				blocks.push({
					type: "heading",
					level: Math.min(6, heading[1].length),
					text: heading[2],
				});
				continue;
			}

			let unordered = line.match(/^(\s*)[-*+]\s+(.*)$/);
			if (unordered) {
				flushParagraph();
				if (listKind && listKind != "ul") {
					flushList();
				}
				listKind = "ul";
				listItems.push({
					text: unordered[2],
					level: listIndentLevel(unordered[1]),
				});
				continue;
			}

			let ordered = line.match(/^(\s*)\d+\.\s+(.*)$/);
			if (ordered) {
				flushParagraph();
				if (listKind && listKind != "ol") {
					flushList();
				}
				listKind = "ol";
				listItems.push({
					text: ordered[2],
					level: listIndentLevel(ordered[1]),
				});
				continue;
			}

			flushList();
			paragraph.push(line);
		}

		flushParagraph();
		flushList();

		if (codeFence) {
			blocks.push({
				type: "code",
				lang: codeFence,
				text: codeLines.join("\n"),
			});
		}

		return attachBlockContext(blocks);
	}

	function serializeBlocks(blocks) {
		let out = [];
		for (let block of blocks || []) {
			if (!block) {
				continue;
			}
			let lines = [];
			switch (block.type) {
				case "page-marker":
					lines.push(`<--page${block.page || 1}-->`);
					break;
				case "page-break":
					lines.push(PAGE_BREAK_MARKDOWN);
					break;
				case "page-layout":
					if (normalizePageLayout(block.layout) == "landscape") {
						lines.push("<!-- sr:page-layout:landscape -->");
					}
					break;
				case "toc":
					lines.push(TOC_PLACEHOLDER_MARKDOWN);
					break;
				case "heading":
					lines.push(`${"#".repeat(Math.max(1, Math.min(6, block.level || 1)))} ${String(block.text || "").trim()}`.trim());
					break;
				case "paragraph":
					lines.push(String(block.text || "").trimEnd());
					break;
				case "list":
					let normalizedList = normalizeListBlock(block);
					let listMeta = listBlockMeta(normalizedList);
					if (listMeta) {
						lines.push(serializeBlockMeta(listMeta));
					}
					for (let item of normalizedList.items || []) {
						let prefix = normalizedList.ordered ? "1." : "-";
						let indent = "    ".repeat(item.level || 0);
						lines.push(`${indent}${prefix} ${String(item.text || "").trim()}`.trimEnd());
					}
					break;
				case "table": {
					let table = normalizeTableBlock(block);
					if (table.captionAbove) {
						lines.push(table.captionAbove);
					}
					let meta = tableBlockMeta(table);
					if (meta) {
						lines.push(serializeBlockMeta(meta));
					}
					if (Array.isArray(table.header) && table.header.length) {
						lines.push(`| ${table.header.map((cell) => String(cell || "")).join(" | ")} |`);
						lines.push(`| ${table.alignments.map((align) => tableAlignmentMarker(align)).join(" | ")} |`);
						for (let row of table.rows || []) {
							lines.push(`| ${row.map((cell) => String(normalizeTableCell(cell).text || "")).join(" | ")} |`);
						}
					}
					if (table.noteBelow) {
						lines.push(table.noteBelow);
					}
					break;
				}
				case "bibliography":
					lines.push(BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN);
					break;
				case "prisma":
					lines.push(PRISMA_PLACEHOLDER_MARKDOWN);
					break;
				case "image": {
					let captionAbove = trimBlockText(block.captionAbove);
					let noteBelow = trimBlockText(block.noteBelow);
					if (captionAbove) {
						lines.push(captionAbove);
					}
					let meta = mediaBlockMeta(block);
					if (meta) {
						lines.push(serializeBlockMeta(meta));
					}
					lines.push(`![${String(block.alt || "")}](${String(block.src || "")})`);
					if (noteBelow) {
						lines.push(noteBelow);
					}
					break;
				}
				case "code":
					lines.push(`\`\`\`${block.lang || ""}`.trimEnd());
					lines.push(String(block.text || ""));
					lines.push("```");
					break;
				default:
					break;
			}
			if (lines.length) {
				out.push(...lines, "");
			}
		}
		return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
	}

	function sectionizeBlocks(blocks) {
		let sections = [];
		let current = {
			layout: "portrait",
			blocks: [],
		};

		let currentHasVisibleContent = () =>
			current.blocks.some((candidate) =>
				candidate
				&& candidate.type != "page-break"
				&& candidate.type != "page-layout"
				&& candidate.type != "page-marker"
			);

		let pushCurrent = ({ force = false } = {}) => {
			if (!force && !current.blocks.length && !sections.length) {
				return;
			}
			if (!force && !current.blocks.length) {
				current = { layout: current.layout || "portrait", blocks: [] };
				return;
			}
			sections.push(current);
			current = {
				layout: "portrait",
				blocks: [],
			};
		};

		for (let block of blocks || []) {
			if (!block) {
				continue;
			}
			if (block.type == "page-marker") {
				if (currentHasVisibleContent() || sections.length) {
					pushCurrent();
				}
				continue;
			}
			if (block.type == "page-break") {
				pushCurrent();
				current.layout = "portrait";
				current.blocks.push({ type: "page-break" });
				continue;
			}
			if (block.type == "page-layout") {
				current.layout = "landscape";
				current.blocks.push({ type: "page-layout", layout: "landscape" });
				continue;
			}
			current.blocks.push(block);
		}

		if (current.blocks.length || !sections.length) {
			sections.push(current);
		}
		return sections.map((section) => ({
			layout: normalizePageLayout(section.layout),
			blocks: Array.isArray(section.blocks) ? section.blocks.slice() : [],
		}));
	}

	function paginateBlocks(blocks) {
		return sectionizeBlocks(blocks);
	}

	function renderPreviewBlock(block, options = {}, bibliographyHTML = "", prismaHTML = "") {
		let outline = options?.tocOutline || null;
		let blockIndex = blockOutlineIndex(block, outline);
		let anchor = blockIndex >= 0 ? String(outline?.blockAnchorByIndex?.get(blockIndex) || "").trim() : "";
		let generatedSectionAnchor = anchor;
		if (block?.type == "bibliography" || block?.type == "prisma") {
			if (outline?.firstIndices?.[block.type] >= 0 && blockIndex != outline.firstIndices[block.type]) {
				return "";
			}
			if (outline?.generatedHeadingReuseByIndex?.has?.(blockIndex)) {
				generatedSectionAnchor = "";
			}
		}
		if (block?.type == "toc" && outline?.firstIndices?.toc >= 0 && blockIndex != outline.firstIndices.toc) {
			return "";
		}
		switch (block.type) {
			case "page-marker":
				return "";
			case "page-break":
				return "";
			case "page-layout":
				return "";
			case "heading":
				return `<h${block.level}${anchorAttributes(anchor)}>${renderInlineHTML(block.text, options)}</h${block.level}>`;
			case "toc":
				return renderTOCBlockHTML(outline, { includePageNumbers: true });
			case "paragraph":
				return `<p>${renderInlineHTML(block.text, options)}</p>`;
			case "list":
				return renderListBlockHTML(block, options, { native: false });
			case "table": {
				let table = normalizeTableBlock(block);
				let styleID = layoutStyleID(options);
				return `<section class="sr-table-block" data-sr-table-style="${styleID}">${
					table.captionAbove ? `<div class="sr-block-caption sr-table-caption">${renderCaptionHTML(table.captionAbove, options, "table")}</div>` : ""
				}<div class="sr-table-wrap"><table class="sr-rendered-table"><thead><tr>${
					table.header.map((cell, index) => `<th data-sr-align="${normalizeTableAlignment(table.alignments[index]) || "left"}" data-sr-column-index="${index}">${renderInlineHTML(cell, options)}</th>`).join("")
				}</tr></thead><tbody>${
					table.rows.map((row) => `<tr>${renderTableCells(row, "td", table.alignments, options)}</tr>`).join("")
				}</tbody></table></div>${
					table.noteBelow ? `<div class="sr-block-note sr-table-note">${renderNoteHTML(table.noteBelow, options)}</div>` : ""
				}</section>`;
			}
			case "bibliography":
				return `<section class="sr-generated-section sr-generated-section-bibliography" data-sr-generated-kind="bibliography"${anchorAttributes(generatedSectionAnchor)}>${
					bibliographyHTML || `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`
				}</section>`;
			case "prisma":
				return `<section class="sr-generated-section sr-generated-section-prisma" data-sr-generated-kind="prisma"${anchorAttributes(generatedSectionAnchor)}>${
					prismaHTML || `<div class="sr-prisma-empty" data-sr-prisma="true">PRISMA diagram is not available.</div>`
				}</section>`;
			case "image":
				return `<figure class="sr-figure-block" data-sr-table-style="${layoutStyleID(options)}" data-sr-display-width="${normalizeDisplayWidthPercent(block.displayWidthPercent, 100)}" style="width:${normalizeDisplayWidthPercent(block.displayWidthPercent, 100)}%; max-width:100%;">${
					block.captionAbove ? `<div class="sr-block-caption sr-figure-caption">${renderCaptionHTML(block.captionAbove, options, "image")}</div>` : ""
				}<img alt="${escapeHTML(block.alt || "")}" src="${escapeHTML(resolveAssetURL(block.src || "", options))}" data-sr-asset-src="${escapeHTML(block.src || "")}" />${
					block.noteBelow ? `<figcaption class="sr-block-note sr-figure-note">${renderNoteHTML(block.noteBelow, options)}</figcaption>` : ""
				}</figure>`;
			case "code":
				return renderCodeBlockHTML(block, { native: false });
			default:
				return "";
		}
	}

	function renderNativeBlockHTML(block, options = {}, bibliographyHTML = "", prismaHTML = "") {
		let outline = options?.tocOutline || null;
		let blockIndex = blockOutlineIndex(block, outline);
		let anchor = blockIndex >= 0 ? String(outline?.blockAnchorByIndex?.get(blockIndex) || "").trim() : "";
		let generatedSectionAnchor = anchor;
		if (block?.type == "bibliography" || block?.type == "prisma") {
			if (outline?.firstIndices?.[block.type] >= 0 && blockIndex != outline.firstIndices[block.type]) {
				return "";
			}
			if (outline?.generatedHeadingReuseByIndex?.has?.(blockIndex)) {
				generatedSectionAnchor = "";
			}
		}
		if (block?.type == "toc" && outline?.firstIndices?.toc >= 0 && blockIndex != outline.firstIndices.toc) {
			return "";
		}
		switch (block.type) {
			case "page-marker":
				return "";
			case "page-break":
				return "";
			case "page-layout":
				return "";
			case "heading": {
				let level = Math.min(6, Math.max(1, block.level || 1));
				return `<section class="sr-native-block sr-block-heading" data-block-type="heading" data-level="${level}"${anchorAttributes(anchor)}><div class="sr-block-editable">${renderInlineHTML(block.text || "", options)}</div></section>`;
			}
			case "toc":
				return `<section class="sr-native-block sr-block-toc" data-block-type="toc"><div class="sr-block-editable sr-block-static" contenteditable="false" data-sr-editable="false" data-sr-markdown="${escapeHTML(TOC_PLACEHOLDER_MARKDOWN)}">${renderTOCBlockHTML(outline, { includePageNumbers: false })}</div></section>`;
			case "paragraph":
				return `<section class="sr-native-block sr-block-paragraph" data-block-type="paragraph"><div class="sr-block-editable">${renderInlineHTML(block.text || "", options)}</div></section>`;
			case "list": {
				let list = normalizeListBlock(block, options);
				return renderListBlockHTML(block, options, { native: true }).replace(
					/^<section class="sr-native-list-block sr-block-list"/,
					`<section class="sr-native-block sr-block-list" data-block-type="list" data-list-kind="${list.ordered ? "ol" : "ul"}" data-list-style="${escapeHTML(list.resolvedListStyle)}" data-sr-list-style="${escapeHTML(list.resolvedListStyle)}" data-list-style-explicit="${list.hasExplicitListStyle ? "true" : "false"}" data-sr-list-style-explicit="${list.hasExplicitListStyle ? "true" : "false"}"`
				);
			}
			case "table": {
				let table = normalizeTableBlock(block);
				let styleID = layoutStyleID(options);
				let renderNativeRow = (row, section, rowIndex) => {
					let html = [];
					let columnIndex = 0;
					for (let cell of row || []) {
						let normalizedCell = normalizeTableCell(cell);
						let align = normalizeTableAlignment(table.alignments[columnIndex]) || "left";
						let tag = section == "header" ? "th" : "td";
						let attrs = [
							` data-sr-align="${align}"`,
							` data-sr-table-section="${section}"`,
							` data-row-index="${rowIndex}"`,
							` data-column-index="${columnIndex}"`,
							` data-sr-column-index="${columnIndex}"`,
							normalizedCell.colspan > 1 ? ` colspan="${normalizedCell.colspan}" data-colspan="${normalizedCell.colspan}"` : ' data-colspan="1"',
						].join("");
						html.push(`<${tag}${attrs}><div class="sr-native-table-cell">${renderInlineHTML(normalizedCell.text || "", options)}</div></${tag}>`);
						columnIndex += normalizedCell.colspan;
					}
					return html.join("");
				};
				return `<section class="sr-native-block sr-block-table" data-block-type="table" data-sr-table-style="${styleID}"><div class="sr-native-table-shell">${
					table.captionAbove ? `<div class="sr-block-editable sr-table-context sr-table-caption" data-sr-table-caption="true">${renderInlineHTML(table.captionAbove || "", options)}</div>` : ""
				}<div class="sr-native-table-wrap"><table class="sr-native-table"><thead><tr>${
					renderNativeRow(table.header.map((text) => ({ text, colspan: 1 })), "header", 0)
				}</tr></thead><tbody>${
					table.rows.map((row, rowIndex) => `<tr>${renderNativeRow(row, "body", rowIndex)}</tr>`).join("")
				}</tbody></table></div>${
					table.noteBelow ? `<div class="sr-block-editable sr-table-context sr-table-note" data-sr-table-note="true">${renderInlineHTML(table.noteBelow || "", options)}</div>` : ""
				}</div></section>`;
			}
			case "bibliography":
				return `<section class="sr-native-block sr-block-bibliography" data-block-type="bibliography"${anchorAttributes(generatedSectionAnchor)}><div class="sr-block-editable sr-block-static">${
					bibliographyHTML || `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`
				}</div></section>`;
			case "prisma":
				return `<section class="sr-native-block sr-block-prisma" data-block-type="prisma"${anchorAttributes(generatedSectionAnchor)}><div class="sr-block-editable sr-block-static" contenteditable="false" data-sr-editable="false" data-sr-markdown="${escapeHTML(PRISMA_PLACEHOLDER_MARKDOWN)}">${
					prismaHTML || `<div class="sr-prisma-empty" data-sr-prisma="true">PRISMA diagram is not available.</div>`
				}</div></section>`;
			case "image":
				return `<section class="sr-native-block sr-block-image" data-block-type="image"><figure class="sr-native-image" data-sr-table-style="${layoutStyleID(options)}" data-sr-display-width="${normalizeDisplayWidthPercent(block.displayWidthPercent, 100)}" style="width:${normalizeDisplayWidthPercent(block.displayWidthPercent, 100)}%; max-width:100%;">${
					block.captionAbove ? `<div class="sr-block-editable sr-figure-context sr-figure-caption">${renderInlineHTML(block.captionAbove || "", options)}</div>` : ""
				}<img alt="${escapeHTML(block.alt || "")}" src="${escapeHTML(resolveAssetURL(block.src || "", options))}" data-sr-asset-src="${escapeHTML(block.src || "")}" />${
					block.noteBelow ? `<figcaption class="sr-block-editable sr-figure-context sr-figure-note">${renderInlineHTML(block.noteBelow || "", options)}</figcaption>` : ""
				}</figure></section>`;
			case "code":
				return renderCodeBlockHTML(block, { native: true, editorMode: !!options?.editorMode });
			default:
				return "";
		}
	}

	function renderInlineHTML(text, options = {}) {
		let citationRenderer = typeof options.renderCitation == "function" ? options.renderCitation : null;
		let linkRenderer = typeof options.renderLink == "function" ? options.renderLink : null;
		let placeholders = [];
		let source = String(text || "");

		let stash = (html) => {
			let token = `\u0000SR${placeholders.length}\u0000`;
			placeholders.push({ token, html });
			return token;
		};

		if (source.includes(HARD_BREAK_MARKDOWN)) {
			let hardBreakToken = stash('<br data-sr-hard-break="true">');
			source = source.split(HARD_BREAK_MARKDOWN).join(hardBreakToken);
		}
		source = source.replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${escapeHTML(code)}</code>`));
		source = source.replace(/<u>([\s\S]*?)<\/u>/gi, (_match, inner) => stash(`<u>${escapeHTML(inner)}</u>`));
		source = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) =>
			stash(`<img alt="${escapeHTML(alt)}" src="${escapeHTML(resolveAssetURL(src, options))}" data-sr-asset-src="${escapeHTML(src)}">`)
		);
		source = replaceCitationMarkdown(source, (citation, rawToken) => {
			let html = citationRenderer
				? citationRenderer(citation, "cite")
				: `<span class="sr-citation-ref">${escapeHTML("cite")}</span>`;
			return stash(html);
		});
		source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
			if (isBibliographyURL(href)) {
				return stash(`<span class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</span>`);
			}
			let rendered = linkRenderer
				? linkRenderer({ label, href })
				: `<a href="${escapeHTML(href)}">${escapeHTML(label)}</a>`;
			return stash(rendered);
		});
		source = escapeHTML(source).replace(/\n/g, " ");
		source = source.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		source = source.replace(/\*([^*]+)\*/g, "<em>$1</em>");
		for (let item of placeholders) {
			source = source.replaceAll(item.token, item.html);
		}
		return source;
	}

	function renderHTML(markdown, options = {}) {
		let blocks = parseMarkdown(markdown);
		let tocOutline = buildDocumentOutline(blocks);
		let settings = normalizeSettings(options?.settings || {});
		let explicitPageFooters = !!options?.explicitPageFooters;
		let bibliographyHTML =
			blocks.some((block) => block?.type == "bibliography") && typeof options.renderBibliography == "function"
				? xmlSafeHTMLFragment(options.renderBibliography(markdown))
				: "";
		let prismaHTML =
			blocks.some((block) => block?.type == "prisma") && typeof options.renderPrisma == "function"
				? xmlSafeHTMLFragment(options.renderPrisma(markdown))
				: "";
		let pages = paginateBlocks(blocks);
		return `<div class="sr-markdown-document sr-page-stack" data-sr-page-numbers="${settings.printPageNumbers ? "true" : "false"}" data-sr-page-number-mode="${explicitPageFooters ? "explicit" : "auto"}">${
			pages.map((page, pageIndex) => `<section class="sr-page-sheet sr-page-sheet-preview" data-sr-layout="${normalizePageLayout(page.layout)}" data-sr-page-index="${pageIndex + 1}" data-sr-page-source="manual"><div class="sr-page-sheet-body">${renderPageBodyHTML(page.blocks, Object.assign({}, options, { tocOutline }), bibliographyHTML, prismaHTML)}</div>${settings.printPageNumbers && explicitPageFooters ? renderExplicitPageFooterHTML(pageIndex + 1) : ""}</section>`).join("\n")
		}</div>`;
	}

	function renderNativeDocumentHTML(markdown, options = {}) {
		let blocks = parseMarkdown(markdown);
		let tocOutline = buildDocumentOutline(blocks);
		let settings = normalizeSettings(options?.settings || {});
		let explicitPageFooters = !!options?.explicitPageFooters;
		let bibliographyHTML =
			blocks.some((block) => block?.type == "bibliography") && typeof options.renderBibliography == "function"
				? xmlSafeHTMLFragment(options.renderBibliography(markdown))
				: "";
		let prismaHTML =
			blocks.some((block) => block?.type == "prisma") && typeof options.renderPrisma == "function"
				? xmlSafeHTMLFragment(options.renderPrisma(markdown))
				: "";
		let pages = paginateBlocks(blocks);
		return `<div class="sr-native-root sr-page-stack" data-sr-page-numbers="${settings.printPageNumbers ? "true" : "false"}" data-sr-page-number-mode="${explicitPageFooters ? "explicit" : "auto"}">${
			pages.map((page, pageIndex) => `<section class="sr-page-sheet sr-page-sheet-native" data-sr-layout="${normalizePageLayout(page.layout)}" data-sr-page-index="${pageIndex + 1}" data-sr-page-source="manual"><div class="sr-page-sheet-body">${renderNativePageBodyHTML(page.blocks, Object.assign({}, options, { tocOutline }), bibliographyHTML, prismaHTML)}</div>${settings.printPageNumbers && explicitPageFooters ? renderExplicitPageFooterHTML(pageIndex + 1) : ""}</section>`).join("\n")
		}</div>`;
	}

	function previewPrintPageBodyNodes(body) {
		return Array.from(body?.childNodes || []).filter((node) => {
			if (!node) {
				return false;
			}
			if (node.nodeType == 1) {
				return !node.matches?.(".sr-page-number-footer");
			}
			return String(node.textContent || "").trim().length > 0;
		});
	}

	function previewPrintBodyOverflows(body) {
		return !!(body && body.clientHeight > 0 && body.scrollHeight > body.clientHeight + 2);
	}

	function previewPrintIsTableSource(node) {
		return !!previewPrintTableDisplayRoot(node);
	}

	function previewPrintIsTableFragment(node) {
		return String(node?.getAttribute?.("data-sr-generated-continuation") || "").trim() == "table";
	}

	function previewPrintTableDisplayRoot(node) {
		if (node?.matches?.(".sr-table-block")) {
			return node;
		}
		return node?.querySelector?.(".sr-table-block") || null;
	}

	function previewPrintResetTableSourceNode(node) {
		let root = previewPrintTableDisplayRoot(node);
		if (!root) {
			return null;
		}
		root.style.display = "";
		root.removeAttribute("aria-hidden");
		root.removeAttribute("data-sr-table-fragment-source");
		return root;
	}

	function previewPrintIsCodeSource(node) {
		return !!codeDisplayRoot(node);
	}

	function previewPrintIsCodeFragment(node) {
		return isCodeContinuationNode(node);
	}

	function preferredCodeSplitLength(text = "", maxLength = 0) {
		let upperBound = Math.max(0, Math.min(String(text || "").length, Number(maxLength || 0) || 0));
		if (upperBound <= 0) {
			return 0;
		}
		let newlineBreak = String(text || "").lastIndexOf("\n", upperBound - 1);
		let trailingLength = upperBound - (newlineBreak + 1);
		if (newlineBreak >= 0 && (trailingLength <= 24 || newlineBreak + 1 >= Math.floor(upperBound * 0.92))) {
			return newlineBreak + 1;
		}
		return upperBound;
	}

	function previewPrintMaxCodePrefixLength(text = "", currentBody = null, sourceNode = null) {
		let source = String(text || "");
		if (!source || !currentBody || !sourceNode) {
			return 0;
		}
		let low = 1;
		let high = source.length;
		let best = 0;
		while (low <= high) {
			let middle = Math.floor((low + high) / 2);
			let fragmentNode = createCodeContinuationNode(sourceNode, source.slice(0, middle));
			if (!fragmentNode) {
				break;
			}
			currentBody.appendChild(fragmentNode);
			let fits = !previewPrintBodyOverflows(currentBody);
			fragmentNode.remove();
			if (fits) {
				best = middle;
				low = middle + 1;
			}
			else {
				high = middle - 1;
			}
		}
		return best;
	}

	function previewPrintPaginateCodeNode(node, currentSheet, currentBody, root) {
		let canonicalNode = resetCodeSourceNode(node);
		if (!canonicalNode) {
			return { currentSheet, currentBody };
		}
		let sourceText = codeTextFromNode(canonicalNode);
		if (!sourceText) {
			return previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		}
		canonicalNode.style.display = "none";
		canonicalNode.setAttribute("aria-hidden", "true");
		canonicalNode.setAttribute("data-sr-code-fragment-source", "true");
		currentBody.appendChild(canonicalNode);
		let activeSheet = currentSheet;
		let activeBody = currentBody;
		let remaining = sourceText;
		while (remaining.length) {
			let fittingLength = previewPrintMaxCodePrefixLength(remaining, activeBody, canonicalNode);
			if (fittingLength <= 0) {
				activeSheet = previewPrintNextAutoContinuationSheet(activeSheet, root) || activeSheet;
				activeBody = activeSheet.querySelector(".sr-page-sheet-body") || activeBody;
				fittingLength = previewPrintMaxCodePrefixLength(remaining, activeBody, canonicalNode);
				if (fittingLength <= 0) {
					fittingLength = remaining.length;
				}
			}
			let splitLength = preferredCodeSplitLength(remaining, fittingLength) || fittingLength;
			let fragmentNode = createCodeContinuationNode(canonicalNode, remaining.slice(0, splitLength));
			if (!fragmentNode) {
				break;
			}
			activeBody.appendChild(fragmentNode);
			remaining = remaining.slice(splitLength);
			if (remaining.length) {
				activeSheet = previewPrintNextAutoContinuationSheet(activeSheet, root) || activeSheet;
				activeBody = activeSheet.querySelector(".sr-page-sheet-body") || activeBody;
			}
		}
		return { currentSheet: activeSheet, currentBody: activeBody };
	}

	function previewPrintCreateAutoPageSheet(doc, layout, root) {
		let sheet = doc.createElement("section");
		sheet.className = "sr-page-sheet sr-page-sheet-preview";
		sheet.setAttribute("data-sr-layout", normalizePageLayout(layout));
		sheet.setAttribute("data-sr-page-source", "auto");
		let body = doc.createElement("div");
		body.className = "sr-page-sheet-body";
		sheet.appendChild(body);
		if (root?.getAttribute?.("data-sr-page-numbers") == "true" && root?.getAttribute?.("data-sr-page-number-mode") == "explicit") {
			let footer = doc.createElement("div");
			footer.className = "sr-page-number-footer";
			footer.setAttribute("data-sr-page-footer", "true");
			sheet.appendChild(footer);
		}
		return { sheet, body };
	}

	function previewPrintNextAutoContinuationSheet(sheet, root) {
		if (!sheet) {
			return null;
		}
		let layout = normalizePageLayout(sheet.getAttribute("data-sr-layout") || "portrait");
		let next = sheet.nextElementSibling || null;
		while (next && !next.classList?.contains("sr-page-sheet")) {
			next = next.nextElementSibling || null;
		}
		if (next && pageSheetSource(next) == "auto") {
			next.setAttribute("data-sr-layout", layout);
			return next;
		}
		let created = previewPrintCreateAutoPageSheet(sheet?.ownerDocument || document, layout, root);
		sheet.after(created.sheet);
		return created.sheet;
	}

	function refreshPreviewPrintSheetIndices(root) {
		Array.from(root?.querySelectorAll?.(".sr-page-sheet") || []).forEach((sheet, index) => {
			sheet.setAttribute("data-sr-page-index", String(index + 1));
			let footer = sheet.querySelector(":scope > .sr-page-number-footer");
			if (root?.getAttribute?.("data-sr-page-numbers") == "true" && root?.getAttribute?.("data-sr-page-number-mode") == "explicit") {
				if (!footer) {
					footer = (root?.ownerDocument || document).createElement("div");
					footer.className = "sr-page-number-footer";
					footer.setAttribute("data-sr-page-footer", "true");
					sheet.appendChild(footer);
				}
				footer.textContent = String(index + 1);
			}
			else {
				footer?.remove?.();
			}
		});
	}

	function removeEmptyPreviewPrintAutoPages(root) {
		for (let sheet of Array.from(root?.querySelectorAll?.(".sr-page-sheet[data-sr-page-source='auto']") || [])) {
			let body = sheet.querySelector(".sr-page-sheet-body");
			if (!previewPrintPageBodyNodes(body).length) {
				sheet.remove();
			}
		}
		refreshPreviewPrintSheetIndices(root);
	}

	function previewPrintAppendNode(node, currentSheet, currentBody, root) {
		if (!node) {
			return { currentSheet, currentBody };
		}
		currentBody.appendChild(node);
		if (previewPrintBodyOverflows(currentBody) && previewPrintPageBodyNodes(currentBody).length > 1) {
			node.remove();
			currentSheet = previewPrintNextAutoContinuationSheet(currentSheet, root) || currentSheet;
			currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
			currentBody.appendChild(node);
		}
		return { currentSheet, currentBody };
	}

	function previewPrintPaginateTOCNode(groupNodes, currentSheet, currentBody, root) {
		let canonicalNode = groupNodes[0] || null;
		if (!canonicalNode) {
			return { currentSheet, currentBody };
		}
		let allEntries = cloneTOCEntries(groupNodes);
		if (!allEntries.length) {
			return previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		}
		setTOCNodeEntries(canonicalNode, [], { continuation: false });
		let appended = previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		currentSheet = appended.currentSheet;
		currentBody = appended.currentBody;
		let activeNode = canonicalNode;
		for (let entry of allEntries) {
			appendTOCEntry(activeNode, entry.cloneNode(true));
			if (!previewPrintBodyOverflows(currentBody)) {
				continue;
			}
			let entryCount = tocEntryNodes(activeNode).length;
			if (entryCount == 1) {
				let currentNodes = previewPrintPageBodyNodes(currentBody);
				if (currentNodes.length == 1) {
					continue;
				}
				activeNode.remove();
				currentSheet = previewPrintNextAutoContinuationSheet(currentSheet, root) || currentSheet;
				currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
				currentBody.appendChild(activeNode);
				continue;
			}
			let overflowEntry = removeLastTOCEntry(activeNode);
			currentSheet = previewPrintNextAutoContinuationSheet(currentSheet, root) || currentSheet;
			currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
			activeNode = createTOCContinuationNode(canonicalNode) || canonicalNode;
			currentBody.appendChild(activeNode);
			if (overflowEntry) {
				appendTOCEntry(activeNode, overflowEntry);
			}
		}
		return { currentSheet, currentBody };
	}

	function previewPrintPaginateBibliographyNode(groupNodes, currentSheet, currentBody, root) {
		let canonicalNode = groupNodes[0] || null;
		if (!canonicalNode) {
			return { currentSheet, currentBody };
		}
		let allEntries = cloneBibliographyEntries(groupNodes);
		if (!allEntries.length) {
			return previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		}
		setBibliographyNodeEntries(canonicalNode, [], { continuation: false });
		currentBody.appendChild(canonicalNode);
		let activeNode = canonicalNode;
		for (let entry of allEntries) {
			appendBibliographyEntry(activeNode, entry.cloneNode(true));
			if (!previewPrintBodyOverflows(currentBody)) {
				continue;
			}
			let entryCount = bibliographyEntryCount(activeNode);
			if (entryCount == 1) {
				let currentNodes = previewPrintPageBodyNodes(currentBody);
				if (currentNodes.length == 1) {
					continue;
				}
				activeNode.remove();
				currentSheet = previewPrintNextAutoContinuationSheet(currentSheet, root) || currentSheet;
				currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
				currentBody.appendChild(activeNode);
				continue;
			}
			let overflowEntry = removeLastBibliographyEntry(activeNode);
			currentSheet = previewPrintNextAutoContinuationSheet(currentSheet, root) || currentSheet;
			currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
			activeNode = createBibliographyContinuationNode(canonicalNode) || canonicalNode;
			currentBody.appendChild(activeNode);
			if (overflowEntry) {
				appendBibliographyEntry(activeNode, overflowEntry);
			}
		}
		return { currentSheet, currentBody };
	}

	function previewPrintTableGroupID(node) {
		let root = node?.matches?.(".sr-table-block") ? node : node?.querySelector?.(".sr-table-block");
		if (!root) {
			return `print-table-${Date.now()}`;
		}
		let current = String(root.getAttribute("data-sr-table-group") || "").trim();
		if (!current) {
			current = `print-table-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			root.setAttribute("data-sr-table-group", current);
		}
		return current;
	}

	function previewPrintMeasurementMarginInches(settings = {}, options = {}) {
		if (options?.pageBodyIsPrintContentBox) {
			return 0;
		}
		let margin = Number(settings?.printMarginInches || 1);
		return Number.isFinite(margin) && margin >= 0 ? margin : 1;
	}

	function previewPrintTableFragmentHeightGuardPx(options = {}) {
		let explicit = Number(options?.tableFragmentHeightGuardPx);
		if (Number.isFinite(explicit) && explicit >= 0) {
			return explicit;
		}
		return options?.strictTables ? 10 : 0;
	}

	function previewPrintStrictTableFailure(message = "") {
		throw new Error(`PDF table pagination failed: ${String(message || "Unable to paginate rendered table.").trim()}`);
	}

	function previewPrintTableFragmentationEngine() {
		if (typeof SystematicReviewerTableFragmentation == "undefined") {
			return null;
		}
		return SystematicReviewerTableFragmentation || null;
	}

	function previewPrintPaginateTableNode(node, currentSheet, currentBody, root, settings = {}, options = {}) {
		let canonicalNode = previewPrintResetTableSourceNode(node);
		if (!canonicalNode) {
			return { currentSheet, currentBody };
		}
		let strictTables = !!options?.strictTables;
		let tableFragmentation = previewPrintTableFragmentationEngine();
		if (!tableFragmentation?.buildRenderedTableFragmentPlan) {
			if (strictTables) {
				previewPrintStrictTableFailure("The measured table fragmentation engine is not available.");
			}
			return previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		}
		let measurementMargin = previewPrintMeasurementMarginInches(settings, options);
		let precedingNodes = previewPrintPageBodyNodes(currentBody).filter((entry) =>
			entry !== canonicalNode && !isBibliographyContinuationNode(entry) && !previewPrintIsTableFragment(entry)
		);
		let pageBodyBox = tableFragmentation.measurePageBodyUsableBox(currentBody, {
			precedingNodes,
			printMarginInches: measurementMargin,
		});
		if (!pageBodyBox) {
			if (strictTables) {
				previewPrintStrictTableFailure("Unable to measure the current print page content box.");
			}
			return previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		}
		let fragmentHeightGuard = previewPrintTableFragmentHeightGuardPx(options);
		let plan = tableFragmentation.buildRenderedTableFragmentPlan(canonicalNode, {
			groupId: previewPrintTableGroupID(canonicalNode),
			pageBody: currentBody,
			pageBodyBox,
			firstPageAvailableHeight: Math.max(0, pageBodyBox.remainingHeight - fragmentHeightGuard),
			followingPageHeight: Math.max(0, pageBodyBox.contentHeight - fragmentHeightGuard),
			printMarginInches: measurementMargin,
		});
		if (plan?.startOnNextPage && pageBodyBox.occupiedHeight > 0.5) {
			currentSheet = previewPrintNextAutoContinuationSheet(currentSheet, root) || currentSheet;
			currentBody = currentSheet.querySelector(".sr-page-sheet-body") || currentBody;
			pageBodyBox = tableFragmentation.measurePageBodyUsableBox(currentBody, {
				precedingNodes: previewPrintPageBodyNodes(currentBody).filter((entry) =>
					!isBibliographyContinuationNode(entry) && !previewPrintIsTableFragment(entry)
				),
				printMarginInches: measurementMargin,
			});
			plan = tableFragmentation.buildRenderedTableFragmentPlan(canonicalNode, {
				groupId: previewPrintTableGroupID(canonicalNode),
				pageBody: currentBody,
				pageBodyBox,
				firstPageAvailableHeight: Math.max(0, Number(pageBodyBox?.remainingHeight || 0) - fragmentHeightGuard),
				followingPageHeight: Math.max(0, Number(pageBodyBox?.contentHeight || 0) - fragmentHeightGuard),
				printMarginInches: measurementMargin,
			});
		}
		if (!plan?.fragments?.length) {
			if (strictTables) {
				let detail = plan?.incompleteReason || "The fragmentation engine did not produce any measured fragments.";
				if (!plan) {
					let ownerDoc = canonicalNode?.ownerDocument || null;
					detail += ` plan=null; docBody=${ownerDoc?.body ? "yes" : "no"}; docElement=${ownerDoc?.documentElement ? "yes" : "no"}; sourceTable=${canonicalNode?.querySelector?.("table") ? "yes" : "no"}; bodyClient=${Number(currentBody?.clientWidth || 0) || 0}x${Number(currentBody?.clientHeight || 0) || 0}.`;
				}
				if (plan && Number.isFinite(Number(plan.sourceRowCount))) {
					detail += ` sourceRows=${Number(plan.completedRowCount || 0) || 0}/${Number(plan.sourceRowCount || 0) || 0}; firstPageAvailableHeight=${Number(pageBodyBox?.remainingHeight || 0).toFixed(2)}; followingPageHeight=${Number(pageBodyBox?.contentHeight || 0).toFixed(2)}.`;
				}
				previewPrintStrictTableFailure(detail);
			}
			return previewPrintAppendNode(canonicalNode, currentSheet, currentBody, root);
		}
		if (strictTables && plan?.complete !== true) {
			previewPrintStrictTableFailure(plan?.incompleteReason || "Measured table fragments did not cover the complete source table.");
		}
		canonicalNode.style.display = "none";
		canonicalNode.setAttribute("aria-hidden", "true");
		canonicalNode.setAttribute("data-sr-table-fragment-source", "true");
		currentBody.appendChild(canonicalNode);
		let activeSheet = currentSheet;
		let activeBody = currentBody;
		let renderedFragmentCount = 0;
		for (let index = 0; index < plan.fragments.length; index += 1) {
			if (index > 0) {
				activeSheet = previewPrintNextAutoContinuationSheet(activeSheet, root) || activeSheet;
				activeBody = activeSheet.querySelector(".sr-page-sheet-body") || activeBody;
			}
			let fragmentNode = tableFragmentation.renderTableFragmentNode(plan.fragments[index], {
				document: root?.ownerDocument || document,
			});
			if (fragmentNode) {
				activeBody.appendChild(fragmentNode);
				renderedFragmentCount += 1;
			}
		}
		if (strictTables && renderedFragmentCount != plan.fragments.length) {
			previewPrintStrictTableFailure("A measured table fragment could not be rendered.");
		}
		return { currentSheet: activeSheet, currentBody: activeBody };
	}

	function repaginatePreviewPrintRoot(root, settings = {}, options = {}) {
		if (!root) {
			return;
		}
		layoutRenderedTOCRows(root);
		let allSheets = Array.from(root.querySelectorAll(".sr-page-sheet"));
		if (!allSheets.length) {
			return;
		}
		let manualSheets = allSheets.filter((sheet) => pageSheetSource(sheet) != "auto");
		let baseSheets = manualSheets.length ? manualSheets : allSheets.slice(0, 1);
		for (let baseSheet of baseSheets) {
			let groupSheets = [baseSheet];
			let cursor = baseSheet.nextElementSibling;
			while (cursor?.classList?.contains("sr-page-sheet") && pageSheetSource(cursor) == "auto") {
				groupSheets.push(cursor);
				cursor = cursor.nextElementSibling;
			}
			let flowNodes = [];
			for (let sheet of groupSheets) {
				let body = sheet.querySelector(".sr-page-sheet-body");
				if (!body) {
					continue;
				}
				for (let node of previewPrintPageBodyNodes(body)) {
					if (!previewPrintIsTableFragment(node) && !previewPrintIsCodeFragment(node)) {
						flowNodes.push(node);
					}
				}
				body.replaceChildren();
			}

			let currentSheet = baseSheet;
			let currentBody = currentSheet?.querySelector?.(".sr-page-sheet-body") || null;
			if (!currentSheet || !currentBody) {
				continue;
			}
			for (let index = 0; index < flowNodes.length; index += 1) {
				let node = flowNodes[index];
				if (isTOCContinuationNode(node)) {
					continue;
				}
				if (isTOCDisplayNode(node)) {
					let tocGroup = [node];
					while ((index + 1) < flowNodes.length && isTOCContinuationNode(flowNodes[index + 1])) {
						tocGroup.push(flowNodes[index + 1]);
						index += 1;
					}
					let paginated = previewPrintPaginateTOCNode(tocGroup, currentSheet, currentBody, root);
					currentSheet = paginated.currentSheet;
					currentBody = paginated.currentBody;
					continue;
				}
				if (isBibliographyContinuationNode(node)) {
					continue;
				}
				if (isBibliographyDisplayNode(node)) {
					let bibliographyGroup = [node];
					while ((index + 1) < flowNodes.length && isBibliographyContinuationNode(flowNodes[index + 1])) {
						bibliographyGroup.push(flowNodes[index + 1]);
						index += 1;
					}
					let paginated = previewPrintPaginateBibliographyNode(bibliographyGroup, currentSheet, currentBody, root);
					currentSheet = paginated.currentSheet;
					currentBody = paginated.currentBody;
					continue;
				}
				if (previewPrintIsTableSource(node)) {
					let paginated = previewPrintPaginateTableNode(node, currentSheet, currentBody, root, settings, options);
					currentSheet = paginated.currentSheet;
					currentBody = paginated.currentBody;
					continue;
				}
				if (previewPrintIsCodeFragment(node)) {
					continue;
				}
				if (previewPrintIsCodeSource(node)) {
					let paginated = previewPrintPaginateCodeNode(node, currentSheet, currentBody, root);
					currentSheet = paginated.currentSheet;
					currentBody = paginated.currentBody;
					continue;
				}
				let appended = previewPrintAppendNode(node, currentSheet, currentBody, root);
				currentSheet = appended.currentSheet;
				currentBody = appended.currentBody;
			}
		}

		removeEmptyPreviewPrintAutoPages(root);
		updateRenderedTOCPageNumbers(root);
	}

	function previewPrintElementVisible(node) {
		if (!node || node.nodeType != 1) {
			return false;
		}
		if (String(node.getAttribute?.("aria-hidden") || "").trim() == "true") {
			return false;
		}
		let style = node.ownerDocument?.defaultView?.getComputedStyle?.(node) || null;
		if (style && (style.display == "none" || style.visibility == "hidden")) {
			return false;
		}
		return true;
	}

	function previewPrintBodyOverflowAmount(body) {
		if (!body) {
			return 0;
		}
		let scrollOverflow = Math.max(0, Number(body.scrollHeight || 0) - Number(body.clientHeight || 0));
		let rectOverflow = 0;
		try {
			let bodyRect = body.getBoundingClientRect?.() || null;
			if (bodyRect) {
				for (let node of previewPrintPageBodyNodes(body)) {
					if (!previewPrintElementVisible(node)) {
						continue;
					}
					let rect = node.getBoundingClientRect?.() || null;
					if (rect) {
						rectOverflow = Math.max(rectOverflow, Number(rect.bottom || 0) - Number(bodyRect.bottom || 0));
					}
				}
			}
		}
		catch (_error) {}
		return Math.max(scrollOverflow, rectOverflow);
	}

	function previewPrintTableGroupFragments(root, groupID = "") {
		let targetID = String(groupID || "").trim();
		return Array.from(root?.querySelectorAll?.(".sr-table-fragment-block[data-sr-generated-continuation='table']") || []).filter((fragment) =>
			String(fragment?.getAttribute?.("data-sr-table-group") || "").trim() == targetID
		);
	}

	function validatePreparedPrintDocument(root, options = {}) {
		if (!root) {
			throw new Error("PDF pagination failed: missing rendered report root.");
		}
		let tolerance = Math.max(0, Number(options?.overflowTolerancePx || 3) || 3);
		for (let body of Array.from(root.querySelectorAll?.(".sr-page-sheet-body") || [])) {
			let overflowAmount = previewPrintBodyOverflowAmount(body);
			if (overflowAmount > tolerance) {
				let sheet = body.closest?.(".sr-page-sheet");
				let pageIndex = String(sheet?.getAttribute?.("data-sr-page-index") || "").trim() || "?";
				let layout = String(sheet?.getAttribute?.("data-sr-layout") || "portrait").trim() || "portrait";
				let nodes = previewPrintPageBodyNodes(body)
					.filter((entry) => previewPrintElementVisible(entry))
					.map((entry) => String(entry?.className || entry?.nodeName || "node").trim().replace(/\s+/g, "."))
					.slice(-4)
					.join(",");
				throw new Error(`PDF pagination failed: page ${pageIndex} (${layout}) content overflows the print body by ${Math.ceil(overflowAmount)}px${nodes ? `; nodes=${nodes}` : ""}.`);
			}
		}
		if (options?.strictTables) {
			for (let source of Array.from(root.querySelectorAll?.(".sr-table-block") || [])) {
				let isFragmentSource = String(source.getAttribute?.("data-sr-table-fragment-source") || "").trim() == "true";
				let groupID = String(source.getAttribute?.("data-sr-table-group") || "").trim();
				if (isFragmentSource) {
					if (!groupID || !previewPrintTableGroupFragments(root, groupID).length) {
						throw new Error("PDF table pagination failed: an overflowing source table did not produce measured table fragments.");
					}
					continue;
				}
				if (previewPrintElementVisible(source)) {
					let body = source.closest?.(".sr-page-sheet-body") || null;
					if (previewPrintBodyOverflowAmount(body) > tolerance) {
						throw new Error("PDF table pagination failed: a visible source table still overflows after strict pagination.");
					}
				}
			}
		}
		let tocRoots = Array.from(root.querySelectorAll?.(".sr-toc-block[data-sr-toc-root='true']") || []);
		let tocNumbers = Array.from(root.querySelectorAll?.(".sr-toc-page-number[data-sr-toc-target-anchor]") || []);
		if (tocRoots.length && tocNumbers.length && !tocNumbers.some((node) => String(node.textContent || "").trim())) {
			throw new Error("PDF pagination failed: TOC page numbers were blank after final pagination.");
		}
	}

	function prepareRenderedPrintDocument(root, settings = {}, options = {}) {
		let targetRoot = root?.matches?.(".sr-markdown-document") ? root : root?.querySelector?.(".sr-markdown-document");
		if (!targetRoot) {
			if (options?.strict) {
				throw new Error("PDF pagination failed: missing rendered report root.");
			}
			return { ok: false, pageCount: 0, tableFragmentCount: 0 };
		}
		let normalizedSettings = normalizeSettings(settings || {});
		repaginatePreviewPrintRoot(targetRoot, normalizedSettings, options || {});
		markWrappedProseTableCells(targetRoot);
		updateRenderedTOCPageNumbers(targetRoot);
		refreshPreviewPrintSheetIndices(targetRoot);
		if (options?.strict) {
			validatePreparedPrintDocument(targetRoot, options || {});
		}
		return {
			ok: true,
			pageCount: Array.from(targetRoot.querySelectorAll?.(".sr-page-sheet") || []).length,
			tableFragmentCount: Array.from(targetRoot.querySelectorAll?.(".sr-table-fragment-block[data-sr-generated-continuation='table']") || []).length,
		};
	}

	function unwrapRenderedPrintSections(root) {
		for (let section of Array.from(root?.querySelectorAll?.(":scope > .sr-print-section") || [])) {
			while (section.firstChild) {
				root.insertBefore(section.firstChild, section);
			}
			section.remove();
		}
	}

	function wrapRenderedPrintSections(root) {
		let targetRoot = root?.matches?.(".sr-markdown-document") ? root : root?.querySelector?.(".sr-markdown-document");
		if (!targetRoot?.ownerDocument) {
			return targetRoot || null;
		}
		unwrapRenderedPrintSections(targetRoot);
		let doc = targetRoot.ownerDocument;
		let sheets = Array.from(targetRoot.children || []).filter((child) => child?.classList?.contains("sr-page-sheet"));
		if (!sheets.length) {
			return targetRoot;
		}
		let currentSection = null;
		let sectionIndex = 0;
		for (let sheet of sheets) {
			let source = pageSheetSource(sheet);
			let layout = normalizePageLayout(sheet.getAttribute("data-sr-layout") || "portrait");
			if (!currentSection || source != "auto") {
				sectionIndex += 1;
				currentSection = doc.createElement("div");
				currentSection.className = "sr-print-section";
				currentSection.setAttribute("data-sr-layout", layout);
				currentSection.setAttribute("data-sr-print-section-index", String(sectionIndex));
				targetRoot.insertBefore(currentSection, sheet);
			}
			else {
				layout = normalizePageLayout(currentSection.getAttribute("data-sr-layout") || layout);
				sheet.setAttribute("data-sr-layout", layout);
			}
			currentSection.appendChild(sheet);
		}
		targetRoot.setAttribute("data-sr-print-sectioned", "true");
		return targetRoot;
	}

	function renderPaginatedPrintDocumentHTML(markdown, options = {}) {
		let doc = options.document || (typeof document != "undefined" ? document : null);
		if (!doc?.createElement) {
			return renderHTML(markdown, options);
		}
		let settings = normalizeSettings(options?.settings || {});
		let theme = String(options?.theme || "light");
		let sandbox = doc.createElement("div");
		sandbox.style.position = "absolute";
		sandbox.style.left = "-100000px";
		sandbox.style.top = "0";
		sandbox.style.width = "max-content";
		sandbox.style.minWidth = "0";
		sandbox.style.height = "auto";
		sandbox.style.minHeight = "0";
		sandbox.style.overflow = "visible";
		sandbox.style.visibility = "hidden";
		sandbox.style.pointerEvents = "none";
		let style = doc.createElement("style");
		style.textContent = createDocumentCSS({ settings, theme, printMode: false });
		let measurementStyle = doc.createElement("style");
		measurementStyle.textContent = createPrintPaginationMeasurementCSS(settings);
		let host = doc.createElement("div");
		host.className = "sr-preview-host";
		host.innerHTML = renderHTML(markdown, options);
		sandbox.appendChild(style);
		sandbox.appendChild(measurementStyle);
		sandbox.appendChild(host);
		(doc.body || doc.documentElement || doc).appendChild(sandbox);
		try {
			let root = host.querySelector(".sr-markdown-document");
			if (!root) {
				return renderHTML(markdown, options);
			}
				prepareRenderedPrintDocument(root, settings, {
					strict: options?.strict !== false,
					strictTables: options?.strictTables !== false,
				});
				if (options?.wrapPrintSections) {
					wrapRenderedPrintSections(root);
				}
				return root.outerHTML;
			}
			finally {
			sandbox.remove();
		}
	}

	function renderEditorMarkerHTML(block) {
		if (!block) {
			return "";
		}
		if (block.type == "page-break") {
			return '<div class="sr-section-separator" contenteditable="false" data-sr-marker="page-break" data-sr-editable="false"><span>Page Break</span></div>';
		}
		if (block.type == "page-layout" && normalizePageLayout(block.layout) == "landscape") {
			return '<div class="sr-section-separator" contenteditable="false" data-sr-marker="page-layout" data-sr-layout="landscape" data-sr-editable="false"><span>Landscape Section</span></div>';
		}
		return "";
	}

	function renderEditorSectionBodyHTML(blocks, options = {}, bibliographyHTML = "", prismaHTML = "") {
		return (blocks || [])
			.map((block) => {
				if (!block) {
					return "";
				}
				if (block.type == "page-break" || block.type == "page-layout") {
					return renderEditorMarkerHTML(block);
				}
				return renderNativeBlockHTML(block, options, bibliographyHTML, prismaHTML);
			})
			.filter(Boolean)
			.join("\n");
	}

	function renderEditorHTML(markdown, options = {}) {
		let citationHTMLByToken = options?.citationHTMLByToken instanceof Map
			? options.citationHTMLByToken
			: new Map();
		if (!(options?.citationHTMLByToken instanceof Map) && options?.citationHTMLByToken && typeof options.citationHTMLByToken == "object") {
			for (let [token, html] of Object.entries(options.citationHTMLByToken)) {
				citationHTMLByToken.set(String(token || ""), String(html || ""));
			}
		}
		let bibliographyHTML = xmlSafeHTMLFragment(options?.bibliographyHTML || "");
		let prismaHTML = xmlSafeHTMLFragment(options?.prismaHTML || "");
		let baseURL = String(options?.baseURL || "").trim();
		let blocks = parseMarkdown(markdown);
		let tocOutline = buildDocumentOutline(blocks);
		let sections = sectionizeBlocks(blocks);
		return `<div class="sr-native-root sr-section-stack" data-sr-page-numbers="false">${
			sections.map((section, sectionIndex) => {
				let bodyHTML = renderEditorSectionBodyHTML(section.blocks, Object.assign({}, options, {
					editorMode: true,
					tocOutline,
					renderCitation: (citation, label) => {
						let token = makeCitationMarkdown(citation || {});
						let html = citationHTMLByToken.get(token) || escapeHTML(label || token || "cite");
						return `<span class="sr-citation-chip" data-sr-markdown="${escapeHTML(token)}">${html}</span>`;
					},
					renderBibliography: () => bibliographyHTML || `<div class="sr-bibliography-placeholder" data-sr-bibliography="true">Bibliography</div>`,
					renderPrisma: () => prismaHTML || `<div class="sr-prisma-empty" data-sr-prisma="true">PRISMA diagram is not available.</div>`,
					resolveAssetURL: (assetPath) => {
						let source = String(assetPath || "").trim();
						if (!source) {
							return "";
						}
						if (/^(?:[a-z]+:|\/\/)/i.test(source) && !isLocalAbsolutePathLike(source)) {
							return source;
						}
						if (typeof options.resolveAssetURL == "function") {
							try {
								return String(options.resolveAssetURL(source) || source);
							}
							catch (_err) {}
						}
						if (!baseURL) {
							return source;
						}
						try {
							return String(new URL(source, baseURL).toString() || source);
						}
						catch (_err) {
							return source;
						}
					},
				}), bibliographyHTML, prismaHTML);
				if (!String(bodyHTML || "").trim()) {
					bodyHTML = '<section class="sr-native-block sr-block-paragraph" data-block-type="paragraph"><div class="sr-block-editable"><br /></div></section>';
				}
				return `<section class="sr-editor-section" data-sr-layout="${normalizePageLayout(section.layout)}" data-sr-page-index="${sectionIndex + 1}" data-sr-page-source="manual"><div class="sr-editor-section-body sr-page-sheet-body sr-page-editor-body" data-sr-page-body="true">${bodyHTML}</div></section>`;
			}).join("\n")
		}</div>`;
	}

	function renderPageBodyHTML(blocks, options = {}, bibliographyHTML = "", prismaHTML = "") {
		return (blocks || []).map((block) => renderPreviewBlock(block, options, bibliographyHTML, prismaHTML)).join("\n");
	}

	function renderNativePageBodyHTML(blocks, options = {}, bibliographyHTML = "", prismaHTML = "") {
		return (blocks || [])
			.filter((block) => block && block.type != "page-break" && block.type != "page-layout")
			.map((block) => renderNativeBlockHTML(block, options, bibliographyHTML, prismaHTML))
			.join("\n");
	}

	function renderExplicitPageFooterHTML(pageIndex = 1) {
		return `<div class="sr-page-number-footer" data-sr-page-footer="true">${Number(pageIndex || 1) || 1}</div>`;
	}

		function inlineMarkdownFromNode(node) {
			if (!node) {
				return "";
			}
		if (node.nodeType == 3) {
			return String(node.textContent || "").replace(/[\u200B\u2060\uFEFF]/g, "");
		}
		if (node.nodeType != 1) {
			return "";
		}
		let el = node;
		let citationMarkdown = el.getAttribute?.("data-sr-markdown") || "";
		if (citationMarkdown) {
			let citation = parseCitationMarkdown(citationMarkdown);
			if (citation) {
				return makeCitationMarkdown(citation);
			}
		}
			if (el.dataset?.srMarkdown) {
				return el.dataset.srMarkdown;
			}
			let tag = String(el.tagName || "").toLowerCase();
			if (tag == "br") {
				return el.getAttribute("data-sr-hard-break") == "true" ? HARD_BREAK_MARKDOWN : "";
			}
			if (tag == "textarea") {
				return String(el.value || el.textContent || "");
			}
		if (tag == "img") {
			return `![${el.getAttribute("alt") || ""}](${el.getAttribute("data-sr-asset-src") || el.getAttribute("data-sr-original-src") || el.getAttribute("src") || ""})`;
		}
			if (["div", "p", "figcaption"].includes(tag)) {
				let output = [];
				let previousWasBlockChild = false;
				for (let child of Array.from(el.childNodes || [])) {
					let childTag = String(child?.tagName || "").toLowerCase();
					let currentIsBlockChild = ["div", "p"].includes(childTag);
					let childMarkdown = inlineMarkdownFromNode(child);
					if (!childMarkdown) {
						continue;
					}
					if (output.length && (currentIsBlockChild || previousWasBlockChild)) {
						output.push("\n");
					}
					output.push(childMarkdown);
					previousWasBlockChild = currentIsBlockChild;
				}
				return output.join("");
			}
		let inner = Array.from(el.childNodes || [])
			.map((child) => inlineMarkdownFromNode(child))
			.join("");
		if (tag == "strong" || tag == "b") {
			return `**${inner}**`;
		}
		if (tag == "em" || tag == "i") {
			return `*${inner}*`;
		}
		if (tag == "u") {
			return `<u>${inner}</u>`;
		}
		if (tag == "span" && /underline/i.test(el.getAttribute("style") || "")) {
			return `<u>${inner}</u>`;
		}
		if (tag == "code") {
			return `\`${inner}\``;
		}
		if (tag == "a") {
			return `[${inner}](${el.getAttribute("href") || ""})`;
		}
		return inner;
	}

	function tableBlockFromElement(el) {
		let table = el?.matches?.("table") ? el : el?.querySelector?.("table");
		if (!table) {
			return null;
		}
		let container = el?.classList?.contains("sr-block-table") ? el : table.closest(".sr-block-table");
		let headerCells = Array.from(table.querySelectorAll("thead tr:first-child th"));
		let header = headerCells.map((cell) => inlineMarkdownFromNode(cell.querySelector(".sr-native-table-cell") || cell).trim());
		let alignments = headerCells.map((cell) => normalizeTableAlignment(cell.getAttribute("data-sr-align") || "left"));
		let rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
			Array.from(tr.querySelectorAll(":scope > td")).map((cell) => ({
				text: inlineMarkdownFromNode(cell.querySelector(".sr-native-table-cell") || cell).trim(),
				colspan: Math.max(1, Number(cell.getAttribute("data-colspan") || cell.colSpan || 1)),
			}))
		);
		return normalizeTableBlock({
			type: "table",
			header,
			alignments,
			rows,
			captionAbove: inlineMarkdownFromNode(container?.querySelector?.("[data-sr-table-caption='true']") || container?.querySelector?.(".sr-table-caption")).trim(),
			noteBelow: inlineMarkdownFromNode(container?.querySelector?.("[data-sr-table-note='true']") || container?.querySelector?.(".sr-table-note")).trim(),
		});
	}

	function blocksFromEditorNode(node) {
		if (!node) {
			return [];
		}
		if (node.nodeType == 3) {
			let text = String(node.textContent || "").trim();
			return text ? [{ type: "paragraph", text }] : [];
		}
		if (node.nodeType != 1) {
			return [];
		}
		let el = node;
		if (el.getAttribute?.("data-sr-generated-continuation") == "bibliography") {
			return [];
		}
		if (el.getAttribute?.("data-sr-generated-continuation") == "code") {
			return [];
		}
		if (el.classList?.contains("sr-section-separator")) {
			let marker = String(el.getAttribute("data-sr-marker") || "").trim().toLowerCase();
			if (marker == "page-break") {
				return [{ type: "page-break" }];
			}
			if (marker == "page-layout" && normalizePageLayout(el.getAttribute("data-sr-layout") || "portrait") == "landscape") {
				return [{ type: "page-layout", layout: "landscape" }];
			}
			return [];
		}
			if (el.classList?.contains("sr-native-block")) {
				let type = el.getAttribute("data-block-type") || "";
				if (type == "heading") {
					return headingAndParagraphBlocksFromText(
						Number(el.getAttribute("data-level") || 1),
						inlineMarkdownFromNode(el.querySelector(".sr-block-editable")).trim()
					);
				}
				if (type == "paragraph") {
					return paragraphBlocksFromText(
						inlineMarkdownFromNode(el.querySelector(".sr-block-editable")).trim()
					);
				}
				if (type == "list") {
					let ordered = el.getAttribute("data-list-kind") == "ol";
					let items = Array.from(el.querySelectorAll(".sr-native-list-item")).flatMap((row) =>
						listItemsFromText(
							inlineMarkdownFromNode(row.querySelector(".sr-block-editable")).trim(),
							Math.max(0, Number(row.getAttribute("data-level") || row.dataset?.level || 0) || 0)
						)
					);
					return items.length ? [normalizeListBlock({
						type: "list",
						ordered,
					items,
					listStyle: explicitListStyleFromElement(el),
				})] : [];
			}
			if (type == "table") {
				return [tableBlockFromElement(el)].filter(Boolean);
			}
			if (type == "image") {
				let img = el.querySelector("img");
				if (!img) {
					return [];
				}
				return [{
					type: "image",
					alt: img.getAttribute("alt") || "",
					src: img.getAttribute("data-sr-asset-src") || img.getAttribute("data-sr-original-src") || img.getAttribute("src") || "",
					captionAbove: inlineMarkdownFromNode(el.querySelector("[data-sr-figure-caption='true']") || el.querySelector(".sr-figure-caption")).trim(),
					noteBelow: inlineMarkdownFromNode(el.querySelector("[data-sr-figure-note='true']") || el.querySelector(".sr-figure-note")).trim(),
					displayWidthPercent: img.closest("figure")?.getAttribute("data-sr-display-width") || img.getAttribute("data-sr-display-width") || "",
				}];
			}
			if (type == "bibliography") {
				return [{ type: "bibliography" }];
			}
			if (type == "toc") {
				return [{ type: "toc" }];
			}
			if (type == "prisma") {
				return [{ type: "prisma" }];
			}
			if (type == "code") {
				let textarea = el.querySelector("textarea[data-sr-code='true'], textarea");
				return [{
					type: "code",
					lang: textarea?.getAttribute("data-sr-code-lang") || codeLanguageFromNode(el) || "",
					text: textarea ? (textarea.value || textarea.textContent || "") : codeTextFromNode(el),
				}];
			}
		}
		if (el.classList?.contains("sr-page-marker")) {
			return [{ type: "page-marker", page: Number(el.getAttribute("data-sr-page") || el.dataset?.srPage || 1) }];
		}
		if (el.matches(".sr-bibliography-placeholder,[data-sr-bibliography='true']")) {
			return [{ type: "bibliography" }];
		}
		if (el.matches(".sr-toc-block,[data-sr-toc='true']")) {
			return [{ type: "toc" }];
		}
		if (el.matches(".sr-prisma-figure,.sr-prisma-empty,[data-sr-prisma='true']")) {
			return [{ type: "prisma" }];
		}
			if (String(el.tagName || "").match(/^H[1-6]$/i)) {
				return headingAndParagraphBlocksFromText(
					Number(String(el.tagName || "").slice(1)),
					inlineMarkdownFromNode(el).trim()
				);
			}
			if (el.tagName == "P") {
				return paragraphBlocksFromText(inlineMarkdownFromNode(el).trim());
			}
			if (el.tagName == "UL" || el.tagName == "OL") {
				let items = Array.from(el.querySelectorAll(":scope > li")).flatMap((li) =>
					listItemsFromText(inlineMarkdownFromNode(li).trim(), 0)
				);
				return items.length ? [normalizeListBlock({
					type: "list",
					ordered: el.tagName == "OL",
				items,
				listStyle: explicitListStyleFromElement(el),
			})] : [];
		}
		if (el.tagName == "TABLE") {
			return [tableBlockFromElement(el.closest(".sr-block-table") || el)].filter(Boolean);
		}
		if (el.tagName == "FIGURE" || (el.tagName == "DIV" && el.querySelector("img"))) {
			let img = el.querySelector("img");
			if (!img) {
				return [];
			}
			return [{
				type: "image",
				alt: img.getAttribute("alt") || "",
				src: img.getAttribute("data-sr-asset-src") || img.getAttribute("data-sr-original-src") || img.getAttribute("src") || "",
				captionAbove: inlineMarkdownFromNode(el.querySelector("[data-sr-figure-caption='true']") || el.querySelector(".sr-figure-caption")).trim(),
				noteBelow: inlineMarkdownFromNode(el.querySelector("[data-sr-figure-note='true']") || el.querySelector(".sr-figure-note")).trim(),
				displayWidthPercent: img.closest("figure")?.getAttribute("data-sr-display-width") || img.getAttribute("data-sr-display-width") || "",
			}];
		}
		if (el.tagName == "PRE") {
			let code = el.querySelector("code");
			return [{
				type: "code",
				lang: codeLanguageFromNode(el.closest?.(".sr-block-code, .sr-native-block[data-block-type='code']") || el) || "",
				text: code ? code.textContent || "" : el.textContent || "",
			}];
		}
			if (["DIV", "SECTION", "ARTICLE"].includes(el.tagName)) {
				let nested = [];
				for (let child of Array.from(el.childNodes || [])) {
					nested.push(...blocksFromEditorNode(child));
				}
				if (nested.length) {
					return nested;
				}
				return paragraphBlocksFromText(inlineMarkdownFromNode(el).trim());
			}
			return paragraphBlocksFromText(inlineMarkdownFromNode(el).trim());
		}

	function pageSheetSource(sheet) {
		return sheet?.getAttribute?.("data-sr-page-source") == "auto" ? "auto" : "manual";
	}

	function collectNativeEditorBlocks(rootNode) {
		let root = rootNode?.matches?.(".sr-native-root")
			? rootNode
			: rootNode?.querySelector?.(".sr-native-root");
		if (!root) {
			return [];
		}
		let sections = Array.from(root.querySelectorAll(".sr-editor-section"));
		if (sections.length) {
			let blocks = [];
			for (let section of sections) {
				let body = section.querySelector(".sr-editor-section-body") || section.querySelector(".sr-page-editor-body") || section.querySelector(".sr-page-sheet-body");
				if (!body) {
					continue;
				}
				for (let node of Array.from(body.childNodes || [])) {
					blocks.push(...blocksFromEditorNode(node));
				}
			}
			return blocks;
		}
		let pages = Array.from(root.querySelectorAll(".sr-page-sheet"));
		let blocks = [];
		let previousManualLayout = "portrait";
		let sawManualPage = false;
		for (let sheet of pages) {
			let layout = normalizePageLayout(sheet.getAttribute("data-sr-layout") || "portrait");
			let manualPage = pageSheetSource(sheet) != "auto";
			if (manualPage) {
				if (sawManualPage) {
					blocks.push({ type: "page-break" });
				}
				if (layout == "landscape" && ((!sawManualPage && layout != "portrait") || (sawManualPage && layout != previousManualLayout))) {
					blocks.push({ type: "page-layout", layout });
				}
				previousManualLayout = layout;
				sawManualPage = true;
			}
			let body = sheet.querySelector(".sr-page-editor-body") || sheet.querySelector(".sr-page-sheet-body");
			if (!body) {
				continue;
			}
			for (let node of Array.from(body.childNodes || [])) {
				blocks.push(...blocksFromEditorNode(node));
			}
		}
		return blocks;
	}

	function normalizeTableSelectionCells(cells = []) {
		let seen = new Set();
		return (cells || [])
			.filter(Boolean)
			.map((cell) => ({
				section: cell.section || "body",
				rowIndex: Number(cell.rowIndex || 0),
				columnIndex: Number(cell.columnIndex || 0),
				colspan: Math.max(1, Number(cell.colspan || 1)),
			}))
			.filter((cell) => {
				let key = `${cell.section}:${cell.rowIndex}:${cell.columnIndex}`;
				if (seen.has(key)) {
					return false;
				}
				seen.add(key);
				return true;
			})
			.sort((left, right) =>
				left.section.localeCompare(right.section)
				|| left.rowIndex - right.rowIndex
				|| left.columnIndex - right.columnIndex
			);
	}

	function insertColumnIntoTableBlock(block, boundaryIndex) {
		let table = normalizeTableBlock(block);
		table.header.splice(boundaryIndex, 0, "");
		table.alignments.splice(boundaryIndex, 0, "");
		table.rows = table.rows.map((row) => {
			let nextRow = [];
			let position = 0;
			let inserted = false;
			for (let rawCell of row) {
				let cell = normalizeTableCell(rawCell);
				let start = position;
				let end = position + cell.colspan;
				if (!inserted && boundaryIndex == start) {
					nextRow.push({ text: "", colspan: 1 });
					inserted = true;
				}
				if (!inserted && boundaryIndex > start && boundaryIndex < end) {
					nextRow.push({ text: cell.text, colspan: cell.colspan + 1 });
					inserted = true;
				}
				else {
					nextRow.push({ text: cell.text, colspan: cell.colspan });
				}
				position = end;
			}
			if (!inserted) {
				nextRow.push({ text: "", colspan: 1 });
			}
			return nextRow;
		});
		return table;
	}

	function insertRowIntoTableBlock(block, rowIndex) {
		let table = normalizeTableBlock(block);
		table.rows.splice(Math.max(0, Math.min(table.rows.length, rowIndex)), 0, Array.from({ length: table.columnCount }, () => ({ text: "", colspan: 1 })));
		return table;
	}

	function deleteRowFromTableBlock(block, rowIndex) {
		let table = normalizeTableBlock(block);
		let columnCount = Math.max(1, table.columnCount || 1);
		if (!table.rows.length) {
			table.rows = [Array.from({ length: columnCount }, () => ({ text: "", colspan: 1 }))];
			return table;
		}
		let targetIndex = Math.max(0, Math.min(table.rows.length - 1, Number(rowIndex || 0)));
		if (table.rows.length == 1) {
			table.rows[0] = Array.from({ length: columnCount }, () => ({ text: "", colspan: 1 }));
			return table;
		}
		table.rows.splice(targetIndex, 1);
		if (!table.rows.length) {
			table.rows = [Array.from({ length: columnCount }, () => ({ text: "", colspan: 1 }))];
		}
		return table;
	}

	function deleteColumnFromTableBlock(block, columnIndex) {
		let table = normalizeTableBlock(block);
		let targetIndex = Math.max(0, Math.min(Math.max(0, table.columnCount - 1), Number(columnIndex || 0)));
		if (table.columnCount <= 1) {
			table.header = [""];
			table.alignments = [table.alignments?.[0] || "left"];
			table.rows = (table.rows || []).map(() => [{ text: "", colspan: 1 }]);
			if (!table.rows.length) {
				table.rows = [[{ text: "", colspan: 1 }]];
			}
			return table;
		}
		table.header.splice(targetIndex, 1);
		table.alignments.splice(targetIndex, 1);
		table.rows = (table.rows || []).map((row) => {
			let nextRow = [];
			let position = 0;
			for (let rawCell of row || []) {
				let cell = normalizeTableCell(rawCell);
				let start = position;
				let end = position + cell.colspan;
				if (targetIndex < start || targetIndex >= end) {
					nextRow.push({ text: cell.text, colspan: cell.colspan });
				}
				else if (cell.colspan > 1) {
					nextRow.push({ text: cell.text, colspan: cell.colspan - 1 });
				}
				position = end;
			}
			return nextRow.length ? nextRow : [{ text: "", colspan: 1 }];
		});
		if (!table.rows.length) {
			table.rows = [[{ text: "", colspan: 1 }]];
		}
		return table;
	}

	function applyAlignmentToTableBlock(block, cells, align) {
		let table = normalizeTableBlock(block);
		let targets = new Set();
		for (let descriptor of cells || []) {
			for (let columnIndex = descriptor.columnIndex; columnIndex < descriptor.columnIndex + descriptor.colspan; columnIndex += 1) {
				targets.add(columnIndex);
			}
		}
		for (let columnIndex of targets) {
			table.alignments[columnIndex] = align;
		}
		return table;
	}

	function canMergeTableCells(cells) {
		let normalized = normalizeTableSelectionCells(cells);
		if (normalized.length < 2) {
			return false;
		}
		let first = normalized[0];
		if (first.section != "body") {
			return false;
		}
		if (!normalized.every((cell) => cell.section == first.section && cell.rowIndex == first.rowIndex)) {
			return false;
		}
		let expected = first.columnIndex;
		for (let cell of normalized) {
			if (cell.columnIndex != expected) {
				return false;
			}
			expected += cell.colspan;
		}
		return true;
	}

	function mergeTableCellsInBlock(block, cells) {
		let table = normalizeTableBlock(block);
		let normalized = normalizeTableSelectionCells(cells);
		if (!canMergeTableCells(normalized)) {
			return null;
		}
		let targetRowIndex = normalized[0].rowIndex;
		let start = normalized[0].columnIndex;
		let end = normalized[normalized.length - 1].columnIndex + normalized[normalized.length - 1].colspan;
		let selectedStarts = new Set(normalized.map((cell) => cell.columnIndex));
		let mergedParts = [];
		let nextRow = [];
		let position = 0;
		let inserted = false;
		for (let rawCell of table.rows[targetRowIndex] || []) {
			let cell = normalizeTableCell(rawCell);
			let cellStart = position;
			let cellEnd = position + cell.colspan;
			if (!inserted && cellStart >= end) {
				nextRow.push({ text: mergedParts.join(" ").trim(), colspan: end - start });
				inserted = true;
			}
			if (selectedStarts.has(cellStart) && cellEnd <= end) {
				if (String(cell.text || "").trim()) {
					mergedParts.push(String(cell.text || "").trim());
				}
			}
			else if (cellEnd <= start || cellStart >= end) {
				nextRow.push({ text: cell.text, colspan: cell.colspan });
			}
			position = cellEnd;
		}
		if (!inserted) {
			nextRow.push({ text: mergedParts.join(" ").trim(), colspan: end - start });
		}
		table.rows[targetRowIndex] = nextRow;
		return table;
	}

	function createDocumentCSS({ settings = {}, theme = "light", printMode = false } = {}) {
		let merged = normalizeSettings(settings);
		let fontFamily = escapeHTML(merged.fontFamily || DEFAULT_EDITOR_SETTINGS.fontFamily);
		let fontSizePx = Number(merged.fontSizePx || DEFAULT_EDITOR_SETTINGS.fontSizePx);
		let preset = resolveCitationStylePreset(merged.citationStyleID);
		let headingScales = normalizeHeadingScales(merged, preset);
		let headingStyles = normalizeHeadingStyles(merged, preset);
		let lineHeight = normalizeLineHeight(merged.lineHeight, preset.lineHeight || DEFAULT_EDITOR_SETTINGS.lineHeight);
		let paragraphAlign = normalizeParagraphAlign(merged.paragraphAlign, preset.paragraphAlign || DEFAULT_EDITOR_SETTINGS.paragraphAlign);
		let proseParagraphAlign = normalizeProseParagraphAlign(
			merged.paragraphAlign,
			preset.paragraphAlign || DEFAULT_EDITOR_SETTINGS.paragraphAlign
		);
		let paragraphIndentInches = normalizeParagraphIndent(
			merged.paragraphIndentInches,
			preset.paragraphIndentInches || DEFAULT_EDITOR_SETTINGS.paragraphIndentInches
		);
		let marginInches = Number(merged.printMarginInches || DEFAULT_EDITOR_SETTINGS.printMarginInches);
		let pageViewScale = clampNumber(merged.pageViewScale, DEFAULT_EDITOR_SETTINGS.pageViewScale, 0.65, 1.75);
		let pageGapPx = Math.max(16, Math.round(22 * pageViewScale));
		let hostPaddingPx = 0;
		let scaledFontSizePx = printMode ? fontSizePx : Number((fontSizePx * pageViewScale).toFixed(2));
		let printPortraitWidth = `calc(210mm - ${marginInches * 2}in)`;
		let printPortraitHeight = `calc(297mm - ${marginInches * 2}in)`;
		let printLandscapeWidth = `calc(297mm - ${marginInches * 2}in)`;
		let printLandscapeHeight = `calc(210mm - ${marginInches * 2}in)`;
		let printFooterBandInches = Math.max(0.24, Math.min(0.5, marginInches * 0.45));
		let printFooterBandHeight = `${printFooterBandInches.toFixed(3)}in`;
		let printFooterBottom = "0.05in";
		let printPortraitBodyHeight = `calc(297mm - ${marginInches * 2}in - ${printFooterBandHeight})`;
		let printLandscapeBodyHeight = `calc(210mm - ${marginInches * 2}in - ${printFooterBandHeight})`;
		let pageWidth = printMode ? printPortraitWidth : `calc(210mm * ${pageViewScale})`;
		let pageHeight = printMode ? printPortraitHeight : `calc(297mm * ${pageViewScale})`;
		let landscapeWidth = printMode ? printLandscapeWidth : `calc(297mm * ${pageViewScale})`;
		let landscapeHeight = printMode ? printLandscapeHeight : `calc(210mm * ${pageViewScale})`;
		let screenPadding = printMode ? "0" : `calc(${marginInches}in * ${pageViewScale})`;
		let sectionGapPx = Math.max(8, Math.round(12 * pageViewScale));
		let paragraphIndent = paragraphIndentInches > 0
			? (printMode ? `${paragraphIndentInches}in` : `calc(${paragraphIndentInches}in * ${pageViewScale})`)
			: "0";
		let paragraphBottomMargin = lineHeight >= 1.8 ? "0" : "0.75em";
		let tableStyle = normalizeTableStyle(merged.tableStyle, preset.tableStyle || "standard");
		let headingSizes = resolveHeadingSizeMap(merged, { printMode });
		let headingRules = [];
		for (let level = 1; level <= 6; level += 1) {
			let style = headingStyles[level] || DEFAULT_HEADING_STYLES[level];
			headingRules.push(`.sr-markdown-document h${level} { font-size: ${headingSizes[level]}px; font-weight: ${style.weight}; font-style: ${style.italic ? "italic" : "normal"}; text-align: ${style.align}; text-transform: ${style.transform}; }`);
			headingRules.push(`.sr-block-heading[data-level="${level}"] .sr-block-editable { font-size: ${headingSizes[level]}px; font-weight: ${style.weight}; font-style: ${style.italic ? "italic" : "normal"}; text-align: ${style.align}; text-transform: ${style.transform}; }`);
		}
			let isDark = String(theme || "").toLowerCase() == "dark";
			let palette = printMode
				? {
					chrome: "#ffffff",
					paper: "#ffffff",
					text: "#1d2024",
					muted: "#656b73",
					border: "#c7ccd3",
					borderSoft: "#dfe3e8",
					accent: "#205ea6",
			  }
			: isDark
					? {
							chrome: "#232527",
							paper: "#2e2e2e",
							text: "#f2f4f8",
							muted: "#b1b1b1",
							border: "#4a4a4a",
						borderSoft: "#3a3a3a",
						accent: "#0a84ff",
				  }
				: {
						chrome: "#f4f5f6",
						paper: "#ffffff",
						text: "#1d2024",
						muted: "#656b73",
						border: "#c7ccd3",
						borderSoft: "#dfe3e8",
							accent: "#205ea6",
					  };
			let darkPrismaPreviewRules = (!printMode && isDark)
				? [
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg { background: ${palette.paper} !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg .mw-prisma-node-label, .sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg .mw-prisma-node-value, .sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg .mw-prisma-phase-text { fill: ${palette.text} !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg .mw-prisma-edge { stroke: #7d8794 !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg path[fill="#4b5563"] { fill: #7d8794 !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg rect[fill="#ffffff"] { fill: #3a3a3a !important; stroke: #6a6a6a !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg rect[fill="#d9d9d9"], .sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg rect[fill="#f1f3f6"] { fill: #424242 !important; stroke: #707070 !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg rect[fill="#b0ccea"] { fill: #3b5672 !important; stroke: #5f7fa2 !important; }`,
						`.sr-prisma-figure[data-sr-prisma="true"] .mw-prisma-svg rect[fill="#ebb61b"] { fill: #a97810 !important; stroke: #c28b13 !important; }`,
				  ]
				: [];
			return [
			printMode ? `@page { size: A4 portrait; margin: ${marginInches}in; }` : "",
			printMode ? `@page sr-portrait { size: A4 portrait; margin: ${marginInches}in; }` : "",
			printMode ? `@page sr-landscape { size: A4 landscape; margin: ${marginInches}in; }` : "",
			"html, body { margin: 0; padding: 0; }",
			printMode
				? `body { background: ${palette.chrome}; color: ${palette.text}; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }`
				: "body { background: transparent; color: inherit; font: inherit; }",
			`.sr-preview-host, .sr-native-host { padding: ${printMode ? "0" : `${hostPaddingPx}px`}; background: transparent; min-height: ${printMode ? "auto" : "100%"}; box-sizing: border-box; overflow: auto; }`,
			`.sr-doc-host { display: ${printMode ? "flex" : "block"}; justify-content: ${printMode ? "flex-start" : "normal"}; align-items: flex-start; width: ${printMode ? "auto" : "fit-content"}; min-width: 100%; min-height: ${printMode ? "auto" : "100%"}; margin: ${printMode ? "0" : "0 auto"}; padding: ${printMode ? "0" : `${hostPaddingPx}px`}; box-sizing: border-box; background: transparent; overflow: visible; }`,
			`.sr-page-stack { display: flex; flex-direction: column; gap: ${printMode ? "0" : `${pageGapPx}px`}; align-items: ${printMode ? "stretch" : "center"}; width: ${printMode ? "auto" : "fit-content"}; min-width: ${printMode ? "auto" : "100%"}; }`,
			`.sr-section-stack { display: flex; flex-direction: column; gap: ${printMode ? "0" : `${sectionGapPx}px`}; align-items: ${printMode ? "stretch" : "center"}; width: ${printMode ? "auto" : "fit-content"}; min-width: ${printMode ? "auto" : "100%"}; }`,
			".sr-page-sheet { position: relative; background: transparent; flex: 0 0 auto; }",
			`.sr-editor-section { position: relative; display: block; background: ${palette.paper}; flex: 0 0 auto; width: ${pageWidth}; min-width: ${pageWidth}; margin: 0 auto; padding: ${screenPadding}; box-sizing: border-box; border: 0; box-shadow: none; overflow: visible; }`,
			`.sr-page-stack[data-sr-page-numbers="true"]:not([data-sr-page-number-mode="explicit"]) .sr-page-sheet::after { content: attr(data-sr-page-index); position: absolute; left: 50%; bottom: calc(${marginInches}in * var(--sr-page-view-scale, 1) * 0.35); transform: translateX(-50%); color: ${palette.text}; font-family: ${fontFamily}, Georgia, serif; font-size: calc(10px * var(--sr-page-view-scale, 1)); line-height: 1; pointer-events: none; }`,
			`.sr-page-number-footer { position: absolute; left: 50%; bottom: calc(${marginInches}in * var(--sr-page-view-scale, 1) * 0.35); transform: translateX(-50%); color: ${palette.text}; font-family: ${fontFamily}, Georgia, serif; font-size: calc(10px * var(--sr-page-view-scale, 1)); line-height: 1; pointer-events: none; }`,
			".sr-page-sheet-body {",
			`\tfont-family: ${fontFamily}, Georgia, serif;`,
			`\tfont-size: ${scaledFontSizePx}px;`,
			`\tline-height: ${lineHeight};`,
			`\tcolor: ${palette.text};`,
			`\tbackground: ${palette.paper};`,
			`\twidth: ${pageWidth};`,
			printMode ? "" : `\theight: ${pageHeight};`,
			`\tmin-height: ${pageHeight};`,
			"\tmax-width: none;",
			`\tmargin: ${printMode ? "0" : "0 auto"};`,
			`\tpadding: ${screenPadding};`,
			"\tbox-sizing: border-box;",
			"\tborder: 0;",
			`\tbox-shadow: none;`,
			printMode ? "" : "\toverflow: hidden;",
			"}",
			`.sr-page-sheet[data-sr-layout="landscape"] .sr-page-sheet-body { width: ${landscapeWidth}; ${printMode ? "" : `height: ${landscapeHeight}; `}min-height: ${landscapeHeight};${printMode ? "" : " overflow: hidden;"}}`,
			`.sr-section-stack .sr-editor-section[data-sr-layout="landscape"] { width: ${landscapeWidth}; min-width: ${landscapeWidth}; }`,
			".sr-section-stack .sr-page-sheet-body {",
			"\twidth: 100%;",
			"\theight: auto;",
			"\tmin-height: 0;",
			"\tmax-width: none;",
			"\tmargin: 0;",
			"\tpadding: 0;",
			"\tbackground: transparent;",
			"\tbox-sizing: border-box;",
			"\toverflow: visible;",
			"}",
			".sr-section-stack .sr-page-editor-body { min-height: 0; }",
			".sr-section-stack .sr-native-table-wrap { overflow: visible; }",
			".sr-section-separator { display: flex; align-items: center; width: 100%; gap: 8px; margin: 0 0 12px; color: #656b73; font-size: calc(9px * var(--sr-page-view-scale, 1)); line-height: 1.2; cursor: context-menu; user-select: none; }",
			".sr-section-separator::before, .sr-section-separator::after { content: \"\"; flex: 1 1 auto; height: 1px; background: #c7ccd3; }",
			`.sr-section-separator > span { flex: 0 0 auto; background: ${palette.paper}; padding: 0 6px; }`,
			".sr-section-separator[data-sr-marker='page-layout'] { color: #205ea6; }",
				".sr-markdown-document h1, .sr-markdown-document h2, .sr-markdown-document h3, .sr-markdown-document h4, .sr-markdown-document h5, .sr-markdown-document h6 { line-height: 1.2; margin-top: 1.1em; margin-bottom: 0.45em; font-weight: 700; overflow-wrap: anywhere; word-break: normal; }",
				".sr-markdown-document h1:first-child, .sr-markdown-document h2:first-child, .sr-markdown-document h3:first-child { margin-top: 0; }",
				`.sr-page-sheet-body p, .sr-page-sheet-body li { margin: 0 0 ${paragraphBottomMargin}; text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
				`.sr-page-sheet-body p { text-indent: ${paragraphIndent}; }`,
				".sr-markdown-document p, .sr-markdown-document li, .sr-markdown-document .sr-block-caption, .sr-markdown-document .sr-block-note, .sr-markdown-document a { overflow-wrap: anywhere; word-break: normal; }",
				".sr-page-sheet-body ul, .sr-page-sheet-body ol { padding-left: 1.5em; }",
			".sr-markdown-document pre, .sr-native-root pre { overflow: visible; margin: 0; padding: 12px 14px; background: #f4f4f4; border: 1px solid #d5d8de; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-family: inherit; font-size: inherit; line-height: inherit; color: inherit; }",
			".sr-markdown-document code, .sr-native-root code { font-family: inherit; font-size: inherit; line-height: inherit; }",
			".sr-markdown-document :not(pre) > code, .sr-native-root :not(pre) > code { background: #eef0f3; padding: 0.15em 0.35em; }",
			".sr-markdown-document figure, .sr-native-root figure { margin: 14px 0 16px; }",
			".sr-markdown-document img, .sr-native-root img { max-width: 100%; height: auto; display: block; }",
			".sr-markdown-document figcaption, .sr-native-root figcaption { margin-top: 6px; font-size: 11px; color: #656b73; }",
			".sr-block-caption { margin: 0 0 6px; font-size: 12px; font-weight: 600; line-height: 1.45; text-align: left; }",
			".sr-block-caption-line { display: block; }",
			".sr-caption-number { font-weight: 700; }",
			".sr-caption-title { font-style: italic; font-weight: 400; }",
			".sr-block-note { margin: 7px 0 0; font-size: 11px; line-height: 1.45; color: #656b73; text-align: left; }",
			".sr-generated-section { display: block; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }",
			".sr-note-label { font-style: italic; }",
			".sr-figure-block { break-inside: avoid-page; page-break-inside: avoid; }",
			".sr-table-block, .sr-block-table, .sr-native-table-shell { break-inside: auto; page-break-inside: auto; }",
			".sr-markdown-document table, .sr-native-table { width: 100%; max-width: 100%; border-collapse: collapse; margin: 0; background: transparent; table-layout: fixed; }",
			".sr-markdown-document thead, .sr-native-table thead { display: table-header-group; }",
			".sr-markdown-document tbody, .sr-markdown-document tr, .sr-native-table tbody, .sr-native-table tr { break-inside: auto; page-break-inside: auto; }",
			".sr-markdown-document th, .sr-markdown-document td, .sr-native-table th, .sr-native-table td { padding: 7px 9px; text-align: left; vertical-align: top; min-width: 0; max-width: 100%; box-sizing: border-box; word-break: break-word; overflow-wrap: anywhere; }",
			`.sr-markdown-document tbody td[data-sr-align='left'], .sr-native-table td[data-sr-align='left'][data-sr-table-section='body'] { text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
			".sr-markdown-document tbody td[data-sr-align='left'][data-sr-multiline-prose='true'], .sr-native-table td[data-sr-align='left'][data-sr-table-section='body'][data-sr-multiline-prose='true'], .sr-table-fragment-table tbody td[data-sr-align='left'][data-sr-multiline-prose='true'] { text-align: left !important; text-align-last: auto; }",
			".sr-markdown-document th[data-sr-align='center'], .sr-markdown-document td[data-sr-align='center'], .sr-native-table th[data-sr-align='center'], .sr-native-table td[data-sr-align='center'] { text-align: center; }",
			".sr-markdown-document th[data-sr-align='right'], .sr-markdown-document td[data-sr-align='right'], .sr-native-table th[data-sr-align='right'], .sr-native-table td[data-sr-align='right'] { text-align: right; }",
			tableStyle == "apa"
				? ".sr-markdown-document .sr-table-block table, .sr-native-root .sr-block-table .sr-native-table, .sr-table-fragment-table { border-top: 2px solid #4a535d; border-bottom: 2px solid #4a535d; }"
				: (tableStyle == "minimal" || tableStyle == "scientific")
					? ".sr-markdown-document .sr-table-block table, .sr-native-root .sr-block-table .sr-native-table, .sr-table-fragment-table { border-top: 1.5px solid #5a636e; border-bottom: 1.5px solid #5a636e; }"
					: ".sr-markdown-document table, .sr-native-table, .sr-table-fragment-table { border: 1px solid #8f98a3; }",
			tableStyle == "apa" || tableStyle == "minimal" || tableStyle == "scientific"
				? ".sr-markdown-document .sr-table-block th, .sr-markdown-document .sr-table-block td, .sr-native-root .sr-block-table th, .sr-native-root .sr-block-table td, .sr-table-fragment-table th, .sr-table-fragment-table td { border: 0; background: transparent; }"
				: ".sr-markdown-document th, .sr-markdown-document td, .sr-native-table th, .sr-native-table td, .sr-table-fragment-table th, .sr-table-fragment-table td { border: 1px solid #8f98a3; }",
			tableStyle == "apa" || tableStyle == "minimal" || tableStyle == "scientific"
				? ".sr-markdown-document .sr-table-block thead th, .sr-native-root .sr-block-table thead th, .sr-table-fragment-table thead th { border-bottom: 1px solid #4a535d; font-weight: 700; }"
				: ".sr-markdown-document th, .sr-native-table th, .sr-table-fragment-table th { background: #f2f4f6; }",
			tableStyle == "scientific"
				? ".sr-markdown-document .sr-table-block tbody tr + tr td, .sr-native-root .sr-block-table tbody tr + tr td, .sr-table-fragment-table tbody tr + tr td { border-top: 0.5px solid #c7ccd3; }"
				: "",
			tableStyle == "apa"
				? ".sr-markdown-document .sr-table-block[data-sr-table-style='apa'] thead th[data-sr-align='left'], .sr-native-root .sr-block-table[data-sr-table-style='apa'] thead th[data-sr-align='left'], .sr-table-fragment-block[data-sr-table-style='apa'] thead th[data-sr-align='left'] { text-align: center; }"
				: "",
			tableStyle == "apa"
				? ".sr-markdown-document .sr-table-block[data-sr-table-style='apa'] tbody td[data-sr-align='left']:not([data-sr-multiline-prose='true']), .sr-native-root .sr-block-table[data-sr-table-style='apa'] tbody td[data-sr-align='left']:not([data-sr-multiline-prose='true']), .sr-table-fragment-block[data-sr-table-style='apa'] tbody td[data-sr-align='left']:not([data-sr-multiline-prose='true']) { text-align: center; }"
				: "",
			tableStyle == "apa"
				? ".sr-markdown-document .sr-table-block[data-sr-table-style='apa'] tbody td[data-sr-align='left'][data-sr-column-index='0'], .sr-native-root .sr-block-table[data-sr-table-style='apa'] tbody td[data-sr-align='left'][data-sr-column-index='0'], .sr-table-fragment-block[data-sr-table-style='apa'] tbody td[data-sr-align='left'][data-sr-source-column='0'] { text-align: left; }"
				: "",
			".sr-page-editor-body .sr-block-table th, .sr-page-editor-body .sr-block-table td { box-shadow: inset 0 0 0 0.5px rgba(143,152,163,0.28); }",
			".sr-page-editor-body .sr-block-table thead th { background: transparent; }",
			".sr-page-sheet-body .sr-page-marker { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; color: #656b73; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }",
			".sr-page-sheet-body .sr-page-marker::before, .sr-page-sheet-body .sr-page-marker::after { content: \"\"; flex: 1 1 auto; height: 1px; background: #c7ccd3; }",
			`.sr-page-sheet-body .sr-page-marker span { background: ${palette.paper}; padding: 0 6px; }`,
			".sr-table-fragment-block { display: block; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; }",
			".sr-table-fragment-wrap { width: 100%; max-width: 100%; min-width: 0; overflow: hidden; }",
			".sr-table-fragment-table { width: 100%; max-width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; }",
			".sr-table-fragment-table thead { display: table-header-group; }",
			".sr-table-fragment-table tbody, .sr-table-fragment-table tr { break-inside: auto; page-break-inside: auto; }",
			".sr-table-fragment-table th, .sr-table-fragment-table td { padding: 7px 9px; text-align: left; vertical-align: top; min-width: 0; max-width: 100%; box-sizing: border-box; word-break: break-word; overflow-wrap: anywhere; }",
			`.sr-table-fragment-table tbody td[data-sr-align='left'] { text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
			".sr-table-fragment-table th[data-sr-align='center'], .sr-table-fragment-table td[data-sr-align='center'] { text-align: center; }",
			".sr-table-fragment-table th[data-sr-align='right'], .sr-table-fragment-table td[data-sr-align='right'] { text-align: right; }",
			".sr-table-fragment-cell-content { width: 100%; min-width: 0; min-height: 22px; box-sizing: border-box; white-space: inherit; word-break: inherit; overflow-wrap: inherit; }",
			".sr-table-fragment-cell-content.is-empty-carryover { min-height: 22px; }",
			`.sr-code-block, .sr-code-fragment-block, .sr-native-root .sr-block-code { display: block; width: 100%; max-width: 100%; min-width: 0; break-inside: auto; page-break-inside: auto; }`,
			`.sr-code-block-shell { width: 100%; max-width: 100%; min-width: 0; margin: 0 0 ${paragraphBottomMargin}; }`,
			".sr-code-block-pre { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; font-family: inherit; font-size: inherit; line-height: inherit; color: inherit; }",
			".sr-code-block-pre code { display: block; width: 100%; max-width: 100%; min-width: 0; }",
			".sr-code-block-input { display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 8em; margin: 0; padding: 12px 14px; border: 1px solid #d5d8de; background: #f4f4f4; color: inherit; font: inherit; line-height: inherit; resize: none; overflow: hidden; box-sizing: border-box; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }",
			".sr-native-root { font-family: inherit; font-size: inherit; line-height: inherit; }",
			".sr-native-block { border: 0; break-inside: avoid-page; page-break-inside: avoid; background: transparent; }",
			".sr-block-table { break-inside: auto; page-break-inside: auto; }",
			`.sr-block-editable, .sr-block-static { padding: 0; margin: 0 0 ${paragraphBottomMargin}; white-space: pre-wrap; word-break: break-word; }`,
			".sr-block-bibliography .sr-block-static, .sr-block-bibliography .sr-block-static * { white-space: normal; }",
			".sr-block-bibliography .sr-block-static { margin-bottom: 0; }",
			".sr-block-bibliography, .sr-block-bibliography .sr-block-static, .sr-bibliography-block, .sr-bibliography-flow, .sr-bibliography-flow .csl-bib-body { break-inside: auto; page-break-inside: auto; }",
			".sr-block-bibliography, .sr-block-bibliography .sr-block-static, .sr-bibliography-block, .sr-bibliography-flow, .sr-bibliography-flow .csl-bib-body { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow-wrap: anywhere; }",
			".sr-bibliography-block { display: block; box-sizing: border-box; overflow-wrap: anywhere; }",
			".sr-bibliography-heading { margin: 0 0 0.8em; }",
			".sr-toc-block { display: block; width: 100%; max-width: 100%; box-sizing: border-box; min-width: 0; margin: 0 0 1em; break-inside: auto; page-break-inside: auto; white-space: normal !important; word-break: normal !important; overflow-wrap: normal !important; }",
			".sr-toc-heading { margin: 0 0 0.8em; }",
			".sr-toc-flow { display: block; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }",
			".sr-toc-entry { display: block; break-inside: avoid; page-break-inside: avoid; margin: 0 0 0.45em; white-space: normal !important; word-break: normal !important; overflow-wrap: normal !important; }",
			".sr-toc-link, .sr-toc-link:link, .sr-toc-link:visited, .sr-toc-link:hover, .sr-toc-link:active, .sr-toc-link:focus-visible { display: grid !important; grid-template-columns: fit-content(70%) minmax(1.25em, 1fr) auto; align-items: end; column-gap: 0.35em; color: inherit !important; text-decoration: none !important; min-width: 0; width: 100%; white-space: normal !important; }",
			".sr-toc-link * { color: inherit !important; text-decoration: none !important; word-break: normal !important; overflow-wrap: normal !important; hyphens: none !important; }",
			".sr-toc-link:hover .sr-toc-entry-label, .sr-toc-link:focus-visible .sr-toc-entry-label { text-decoration: underline; }",
			`.sr-toc-main { display: block; min-width: 0; max-width: 100%; grid-column: 1; padding-inline-end: 0.15em; background: ${palette.paper}; }`,
			".sr-toc-entry-label { display: inline; min-width: 0; max-width: 100%; white-space: normal !important; overflow-wrap: anywhere !important; word-break: normal !important; line-height: inherit; }",
			".sr-toc-leader { display: none; }",
			`.sr-toc-link[data-sr-toc-paged="true"] .sr-toc-leader { display: block; grid-column: 2; align-self: end; min-width: 1.25em; overflow: hidden; white-space: nowrap !important; color: inherit; font: inherit; line-height: inherit; letter-spacing: 0.02em; text-decoration: none; user-select: none; pointer-events: none; transform: translateY(-0.08em); }`,
			`.sr-toc-page-number { display: block; grid-column: 3; align-self: end; min-width: 3ch; padding-inline-start: 0.45em; text-align: right; color: inherit; font: inherit; line-height: inherit; text-decoration: none; background: ${palette.paper}; }`,
			".sr-bibliography-flow { display: block; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow-wrap: anywhere; }",
			".sr-bibliography-flow .csl-bib-body { display: block; width: auto !important; max-width: 100%; min-width: 0; box-sizing: border-box; margin-right: 0 !important; overflow-wrap: anywhere; }",
			".sr-bibliography-flow, .sr-bibliography-flow *, .sr-bibliography-flow .csl-bib-body, .sr-bibliography-flow .csl-bib-body * { font-family: inherit !important; font-size: inherit !important; line-height: inherit !important; color: inherit; box-sizing: border-box; max-width: 100%; white-space: normal !important; overflow-wrap: anywhere !important; word-break: normal; }",
			`.sr-bibliography-flow .csl-entry { display: block; width: auto !important; max-width: 100%; margin: 0 0 0.4em; margin-right: 0 !important; overflow-wrap: anywhere; break-inside: avoid; page-break-inside: avoid; text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
			`.sr-bibliography-flow .csl-right-inline { display: flow-root; width: auto !important; max-width: 100%; overflow: visible; text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
			`.sr-block-paragraph .sr-block-editable, .sr-block-list .sr-block-editable { text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
			`.sr-block-paragraph .sr-block-editable { text-indent: ${paragraphIndent}; }`,
			...headingRules,
			".sr-native-list { display: flex; flex-direction: column; }",
			".sr-native-list-item { display: grid; grid-template-columns: minmax(18px, auto) minmax(0, 1fr); align-items: start; column-gap: 10px; border-top: 0; padding-inline-start: calc(var(--sr-list-level, 0) * 24px); }",
			".sr-native-list-item:first-child { border-top: 0; }",
			".sr-native-list-marker { display: flex; align-items: flex-start; justify-content: flex-start; min-width: 1em; padding-top: 0.08em; color: #656b73; line-height: inherit; }",
			`.sr-list-item-text, .sr-native-list-item .sr-block-editable { min-width: 0; margin: 0 0 ${paragraphBottomMargin}; white-space: pre-wrap; word-break: break-word; }`,
			".sr-native-table-wrap, .sr-table-wrap { width: 100%; max-width: 100%; overflow: visible; padding: 0; }",
				".sr-native-table-cell { display: block; width: 100%; min-width: 0; max-width: 100%; min-height: 22px; box-sizing: border-box; white-space: normal; word-break: break-word; overflow-wrap: anywhere; text-align: inherit; text-align-last: auto; }",
				".sr-table-context, .sr-figure-context { margin: 0; min-height: 20px; }",
				".sr-native-image { padding: 0 0 12px; }",
				`.sr-prisma-figure { display: block; margin: 0 0 ${paragraphBottomMargin}; break-inside: avoid-page; page-break-inside: avoid; max-width: 100%; }`,
				`.sr-prisma-figure svg, .sr-prisma-figure img { display: block; width: 100%; max-width: 100%; height: auto; background: ${printMode ? "white" : palette.paper}; border: 0; }`,
				`.sr-prisma-figure[data-sr-prisma-border="true"] svg, .sr-prisma-figure[data-sr-prisma-border="true"] img { border: 1px solid ${palette.border}; }`,
				...darkPrismaPreviewRules,
				`.sr-prisma-empty { display: block; margin: 0 0 ${paragraphBottomMargin}; padding: 14px 16px; border: 1px dashed ${palette.border}; color: ${palette.muted}; white-space: normal; }`,
			`.sr-citation-ref, .sr-citation-chip { color: ${printMode ? "inherit" : palette.accent}; text-decoration: ${printMode ? "none" : "underline"}; text-underline-offset: 0.12em; background: transparent; border: 0; padding: 0; display: inline; }`,
			".sr-citation-chip { cursor: text; }",
			`.sr-bibliography-placeholder { display: block; margin-top: 1.4em; padding-top: 0.75em; border-top: 1px dashed ${palette.border}; color: ${palette.muted}; }`,
			".csl-bib-body { margin: 0; }",
			".csl-entry { margin: 0 0 0.4em; line-height: inherit; break-inside: avoid; page-break-inside: avoid; }",
			".csl-entry > * { margin-top: 0; margin-bottom: 0; }",
			".csl-left-margin { float: left; padding-right: 0.45em; }",
			`.csl-right-inline { display: flow-root; width: auto !important; max-width: 100%; overflow: visible; text-align: ${proseParagraphAlign}; text-align-last: auto; }`,
			printMode ? "body.sr-print-body { background: white; }" : "",
			printMode ? "body.sr-print-body .sr-preview-host, body.sr-print-body .sr-native-host { padding: 0; min-height: auto; }" : "",
			printMode ? "body.sr-print-body .sr-page-stack { gap: 0; }" : "",
			printMode ? "body.sr-print-body .sr-page-stack[data-sr-print-sectioned=\"true\"] { display: block; width: auto; min-width: 0; }" : "",
			printMode ? "body.sr-print-body .sr-print-section { display: block; margin: 0; padding: 0; break-before: page; page-break-before: always; }" : "",
			printMode ? "body.sr-print-body .sr-print-section:first-child { break-before: auto; page-break-before: auto; }" : "",
			printMode ? "body.sr-print-body .sr-print-section[data-sr-layout=\"portrait\"] { page: sr-portrait; }" : "",
			printMode ? "body.sr-print-body .sr-print-section[data-sr-layout=\"landscape\"] { page: sr-landscape; }" : "",
			printMode ? "body.sr-print-body .sr-print-section[data-sr-layout=\"portrait\"] > .sr-page-sheet { page: sr-portrait; }" : "",
			printMode ? "body.sr-print-body .sr-print-section[data-sr-layout=\"landscape\"] > .sr-page-sheet { page: sr-landscape; }" : "",
			printMode ? "body.sr-print-body .sr-print-section > .sr-page-sheet:first-child { break-before: auto; page-break-before: auto; }" : "",
			printMode ? "body.sr-print-body .sr-page-sheet { break-before: page; page-break-before: always; margin: 0; position: relative; box-sizing: border-box; }" : "",
			printMode ? "body.sr-print-body .sr-page-sheet:first-child { break-before: auto; page-break-before: auto; }" : "",
			printMode ? `body.sr-print-body .sr-page-stack:not([data-sr-print-sectioned="true"]) .sr-page-sheet[data-sr-layout="portrait"] { page: sr-portrait; }` : "",
			printMode ? `body.sr-print-body .sr-page-stack:not([data-sr-print-sectioned="true"]) .sr-page-sheet[data-sr-layout="landscape"] { page: sr-landscape; }` : "",
			printMode ? `body.sr-print-body .sr-page-sheet[data-sr-layout="portrait"] { width: ${printPortraitWidth}; height: ${printPortraitHeight}; min-height: ${printPortraitHeight}; }` : "",
			printMode ? `body.sr-print-body .sr-page-sheet[data-sr-layout="landscape"] { overflow: visible; width: ${printLandscapeWidth}; height: ${printLandscapeHeight}; min-height: ${printLandscapeHeight}; }` : "",
			printMode ? `body.sr-print-body .sr-page-sheet[data-sr-layout="portrait"] .sr-page-sheet-body { width: ${printPortraitWidth}; height: ${printPortraitBodyHeight}; min-height: ${printPortraitBodyHeight}; overflow: hidden; }` : "",
			printMode ? `body.sr-print-body .sr-page-sheet[data-sr-layout="landscape"] .sr-page-sheet-body { width: ${printLandscapeWidth}; height: ${printLandscapeBodyHeight}; min-height: ${printLandscapeBodyHeight}; overflow: hidden; }` : "",
			printMode ? `body.sr-print-body .sr-page-sheet .sr-page-number-footer { bottom: ${printFooterBottom}; }` : "",
			printMode ? "body.sr-print-body .sr-page-sheet figure, body.sr-print-body .sr-page-sheet pre, body.sr-print-body .sr-page-sheet h1, body.sr-print-body .sr-page-sheet h2, body.sr-print-body .sr-page-sheet h3 { break-inside: avoid-page; page-break-inside: avoid; }" : "",
			printMode ? "body.sr-print-body .sr-page-sheet .sr-table-block, body.sr-print-body .sr-page-sheet .sr-block-table, body.sr-print-body .sr-page-sheet .sr-native-table-shell, body.sr-print-body .sr-page-sheet table, body.sr-print-body .sr-page-sheet thead, body.sr-print-body .sr-page-sheet tbody, body.sr-print-body .sr-page-sheet tr, body.sr-print-body .sr-page-sheet th, body.sr-print-body .sr-page-sheet td { break-inside: auto; page-break-inside: auto; }" : "",
			printMode ? "body.sr-print-body .sr-page-sheet .sr-table-wrap, body.sr-print-body .sr-page-sheet .sr-native-table-wrap { overflow: visible; }" : "",
			printMode ? "body.sr-print-body .sr-block-bibliography, body.sr-print-body .sr-block-bibliography .sr-block-static, body.sr-print-body .sr-bibliography-block, body.sr-print-body .sr-bibliography-flow, body.sr-print-body .sr-bibliography-flow .csl-bib-body { break-inside: auto; page-break-inside: auto; }" : "",
		].join("\n");
	}

	function createPrintPaginationMeasurementCSS(settings = {}) {
		let merged = normalizeSettings(settings);
		let marginInches = Number(merged.printMarginInches || DEFAULT_EDITOR_SETTINGS.printMarginInches);
		let pageViewScale = clampNumber(merged.pageViewScale, DEFAULT_EDITOR_SETTINGS.pageViewScale, 0.65, 1.75);
		let printFooterBandInches = Math.max(0.24, Math.min(0.5, marginInches * 0.45));
		let printFooterBandHeight = `${printFooterBandInches.toFixed(3)}in`;
		let portraitBodyHeight = `calc((297mm - ${printFooterBandHeight}) * ${pageViewScale})`;
		let landscapeBodyHeight = `calc((210mm - ${printFooterBandHeight}) * ${pageViewScale})`;
		return [
			`.sr-markdown-document .sr-page-sheet[data-sr-layout="portrait"] .sr-page-sheet-body { height: ${portraitBodyHeight}; min-height: ${portraitBodyHeight}; }`,
			`.sr-markdown-document .sr-page-sheet[data-sr-layout="landscape"] .sr-page-sheet-body { height: ${landscapeBodyHeight}; min-height: ${landscapeBodyHeight}; }`,
		].join("\n");
	}

	function createPrintHTML({
		title = "Systematic Reviewer",
		bodyHTML = "",
		settings = {},
		baseURL = "",
		theme = "light",
		nativeMode = false,
	} = {}) {
		let css = createDocumentCSS({ settings, theme, printMode: true });
		return [
			"<!DOCTYPE html>",
			"<html>",
			"<head>",
			'<meta charset="utf-8">',
			baseURL ? `<base href="${escapeHTML(baseURL)}">` : "",
			`<title>${escapeHTML(title)}</title>`,
			"<style>",
			css,
			"</style>",
			"</head>",
			'<body class="sr-print-body">',
			`<div class="${nativeMode ? "sr-native-host" : "sr-preview-host"}">${bodyHTML}</div>`,
			"</body>",
			"</html>",
		].join("");
	}

	let api = {
		DEFAULT_EDITOR_SETTINGS,
		DEFAULT_HEADING_SCALES,
		DEFAULT_HEADING_STYLES,
		BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN,
		PAGE_BREAK_MARKDOWN,
		PRISMA_PLACEHOLDER_MARKDOWN,
		TOC_PLACEHOLDER_MARKDOWN,
		parseCitationMarkdown,
		makeCitationMarkdown,
		replaceCitationMarkdown,
		isBibliographyURL,
		extractCitations,
		normalizeSettings,
		resolveCitationStylePreset,
		normalizeListItem,
		normalizeListItems,
		normalizeListBlock,
		orderedListMarkerLabels,
		normalizeTableBlock,
		normalizeTableCell,
		normalizeTableSelectionCells,
		resolveHeadingSizeMap,
		insertColumnIntoTableBlock,
		insertRowIntoTableBlock,
		deleteRowFromTableBlock,
		deleteColumnFromTableBlock,
		applyAlignmentToTableBlock,
		canMergeTableCells,
		mergeTableCellsInBlock,
		parseMarkdown,
		buildDocumentOutline,
		sectionizeBlocks,
		paginateBlocks,
		serializeBlocks,
		renderTOCBlockHTML,
		renderInlineHTML,
			renderHTML,
			renderEditorHTML,
			prepareRenderedPrintDocument,
			wrapRenderedPrintSections,
			renderPaginatedPrintDocumentHTML,
		renderNativeDocumentHTML,
		renderPageBodyHTML,
		renderNativePageBodyHTML,
		inlineMarkdownFromNode,
		tableBlockFromElement,
		codeDisplayRoot,
		codeTextFromNode,
		codeLanguageFromNode,
		isCodeContinuationNode,
		createCodeContinuationNode,
		resetCodeSourceNode,
		blocksFromEditorNode,
			collectNativeEditorBlocks,
			layoutRenderedTOCRows,
			updateRenderedTOCPageNumbers,
		createDocumentCSS,
		createPrintHTML,
		escapeHTML,
		markWrappedProseTableCells,
	};

	if (typeof module != "undefined" && module.exports) {
		module.exports = api;
	}
	return api;
})();
