var SystematicReviewerTableFragmentation = (() => {
	const TABLE_FRAGMENT_MEASURE_HOST_ATTR = "data-sr-table-fragment-measure-host";
	const DEFAULT_MIN_SLICE_HEIGHT = 24;
	const A4_PORTRAIT_WIDTH_INCHES = 210 / 25.4;
	const A4_PORTRAIT_HEIGHT_INCHES = 297 / 25.4;
	const A4_LANDSCAPE_WIDTH_INCHES = 297 / 25.4;
	const A4_LANDSCAPE_HEIGHT_INCHES = 210 / 25.4;

	function toNumber(value, fallback = 0) {
		let numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value));
	}

	function safeNodeRectHeight(node) {
		try {
			let rectHeight = Number(node?.getBoundingClientRect?.().height || 0) || 0;
			if (rectHeight > 0) {
				return rectHeight;
			}
			return Number(node?.offsetHeight || node?.scrollHeight || 0) || 0;
		}
		catch (_error) {
			return 0;
		}
	}

	function safeNodeRectWidth(node) {
		try {
			let rectWidth = Number(node?.getBoundingClientRect?.().width || 0) || 0;
			if (rectWidth > 0) {
				return rectWidth;
			}
			return Number(node?.offsetWidth || node?.scrollWidth || 0) || 0;
		}
		catch (_error) {
			return 0;
		}
	}

	function px(style, property) {
		return toNumber(style?.getPropertyValue?.(property), 0);
	}

	function escapeHTML(value = "") {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function normalizeTableAlignment(value) {
		let alignment = String(value || "").trim().toLowerCase();
		if (alignment == "center" || alignment == "right") {
			return alignment;
		}
		return "left";
	}

	function ownerDocument(node) {
		return node?.ownerDocument || (typeof document != "undefined" ? document : null);
	}

	function firstDirectChildMatching(root, selector) {
		return Array.from(root?.children || []).find((child) => child?.matches?.(selector)) || null;
	}

	function renderedTableRoot(block) {
		if (block?.matches?.(".sr-table-block")) {
			return block;
		}
		if (block?.matches?.(".sr-block-table")) {
			return block.querySelector?.(".sr-table-block") || block;
		}
		return block?.querySelector?.(".sr-table-block")
			|| block?.querySelector?.(".sr-block-table")
			|| null;
	}

	function renderedTableSourceKind(block) {
		if (block?.matches?.(".sr-block-table")) {
			return "native";
		}
		return "preview";
	}

	function renderedTableElement(block) {
		let root = renderedTableRoot(block);
		return root?.querySelector?.(":scope > .sr-table-wrap > table")
			|| root?.querySelector?.("table")
			|| null;
	}

	function renderedTableCaptionElement(block) {
		return firstDirectChildMatching(renderedTableRoot(block), ".sr-block-caption");
	}

	function renderedTableNoteElement(block) {
		return firstDirectChildMatching(renderedTableRoot(block), ".sr-block-note");
	}

	function renderedTableRows(block) {
		return Array.from(renderedTableElement(block)?.querySelectorAll?.("tbody tr") || []);
	}

	function renderedTableCellContent(cell) {
		if (!cell) {
			return null;
		}
		return cell.querySelector?.(".sr-native-table-cell")
			|| cell.querySelector?.(".sr-table-fragment-cell-content")
			|| cell;
	}

	function pageBodyLayout(pageBody) {
		return pageBody?.closest?.("[data-sr-layout='landscape']") ? "landscape" : "portrait";
	}

	function sumNodeHeights(nodes = []) {
		return (nodes || []).reduce((total, node) => total + safeNodeRectHeight(node), 0);
	}

	function layoutPageSizeInches(layout = "portrait") {
		if (String(layout || "").trim().toLowerCase() == "landscape") {
			return {
				width: A4_LANDSCAPE_WIDTH_INCHES,
				height: A4_LANDSCAPE_HEIGHT_INCHES,
			};
		}
		return {
			width: A4_PORTRAIT_WIDTH_INCHES,
			height: A4_PORTRAIT_HEIGHT_INCHES,
		};
	}

	function scaledMarginAwarePageBox(pageBody, options = {}) {
		let body = pageBody || null;
		let rawMargin = Number(options?.printMarginInches);
		if (!body || !Number.isFinite(rawMargin) || rawMargin < 0) {
			return null;
		}
		let layout = pageBodyLayout(body);
		let pageSize = layoutPageSizeInches(layout);
		let clientWidth = Math.max(0, body.clientWidth || safeNodeRectWidth(body));
		let clientHeight = Math.max(0, body.clientHeight || safeNodeRectHeight(body));
		if (!(clientWidth > 0) || !(clientHeight > 0)) {
			return null;
		}
		let baseWidthPx = Math.max(1, pageSize.width * 96);
		let baseHeightPx = Math.max(1, pageSize.height * 96);
		let scaleX = clientWidth / baseWidthPx;
		let scaleY = clientHeight / baseHeightPx;
		let scale = [scaleX, scaleY].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)[0] || 1;
		let marginPx = Math.max(0, rawMargin * 96 * scale);
		let contentWidth = Math.max(0, clientWidth - marginPx * 2);
		let contentHeight = Math.max(0, clientHeight - marginPx * 2);
		return {
			layout,
			clientWidth,
			clientHeight,
			contentWidth,
			contentHeight,
			paddingTop: marginPx,
			paddingRight: marginPx,
			paddingBottom: marginPx,
			paddingLeft: marginPx,
			marginPx,
		};
	}

	function measurePageBodyUsableBox(pageBody, options = {}) {
		let body = pageBody || null;
		if (!body) {
			return null;
		}
		let marginBox = scaledMarginAwarePageBox(body, options);
		let style = body.ownerDocument?.defaultView?.getComputedStyle?.(body) || null;
		let paddingTop = marginBox?.paddingTop ?? px(style, "padding-top");
		let paddingRight = marginBox?.paddingRight ?? px(style, "padding-right");
		let paddingBottom = marginBox?.paddingBottom ?? px(style, "padding-bottom");
		let paddingLeft = marginBox?.paddingLeft ?? px(style, "padding-left");
		let clientWidth = marginBox?.clientWidth ?? Math.max(0, body.clientWidth || safeNodeRectWidth(body));
		let clientHeight = marginBox?.clientHeight ?? Math.max(0, body.clientHeight || safeNodeRectHeight(body));
		let contentWidth = marginBox?.contentWidth ?? Math.max(0, clientWidth - paddingLeft - paddingRight);
		let contentHeight = marginBox?.contentHeight ?? Math.max(0, clientHeight - paddingTop - paddingBottom);
		let occupiedHeight = Math.max(0, toNumber(options.occupiedHeight, NaN));
		if (!Number.isFinite(occupiedHeight)) {
			let precedingNodes = Array.isArray(options.precedingNodes) ? options.precedingNodes.filter(Boolean) : [];
			if (precedingNodes.length) {
				let bodyRect = body.getBoundingClientRect?.() || null;
				let lastRect = precedingNodes[precedingNodes.length - 1]?.getBoundingClientRect?.() || null;
				if (bodyRect && lastRect) {
					occupiedHeight = Math.max(0, lastRect.bottom - bodyRect.top - paddingTop);
				}
				else {
					occupiedHeight = sumNodeHeights(precedingNodes);
				}
			}
			else {
				occupiedHeight = 0;
			}
		}
		occupiedHeight = Math.max(0, Math.min(contentHeight, occupiedHeight));
		let remainingHeight = Math.max(0, contentHeight - occupiedHeight);
		return {
			layout: marginBox?.layout || pageBodyLayout(body),
			clientWidth,
			clientHeight,
			contentWidth,
			contentHeight,
			paddingTop,
			paddingRight,
			paddingBottom,
			paddingLeft,
			marginPx: marginBox?.marginPx || 0,
			occupiedHeight,
			remainingHeight,
		};
	}

	function copyPageBodyMeasurementStyles(sourceBody, targetBody) {
		if (!sourceBody || !targetBody) {
			return;
		}
		let style = sourceBody.ownerDocument?.defaultView?.getComputedStyle?.(sourceBody) || null;
		let width = Math.max(1, Number(sourceBody.clientWidth || safeNodeRectWidth(sourceBody) || 0) || 1);
		targetBody.className = "sr-page-sheet-body";
		targetBody.style.boxSizing = "border-box";
		targetBody.style.width = `${width}px`;
		targetBody.style.minHeight = "0";
		targetBody.style.height = "auto";
		targetBody.style.maxWidth = "none";
		targetBody.style.margin = "0";
		targetBody.style.paddingTop = style?.paddingTop || "0px";
		targetBody.style.paddingRight = style?.paddingRight || "0px";
		targetBody.style.paddingBottom = style?.paddingBottom || "0px";
		targetBody.style.paddingLeft = style?.paddingLeft || "0px";
		targetBody.style.border = "0";
		targetBody.style.boxShadow = "none";
		targetBody.style.overflow = "visible";
		targetBody.style.background = "transparent";
		targetBody.style.fontFamily = style?.fontFamily || "";
		targetBody.style.fontSize = style?.fontSize || "";
		targetBody.style.fontWeight = style?.fontWeight || "";
		targetBody.style.fontStyle = style?.fontStyle || "";
		targetBody.style.lineHeight = style?.lineHeight || "";
		targetBody.style.letterSpacing = style?.letterSpacing || "";
		targetBody.style.color = style?.color || "";
	}

	function tableMeasureHost(doc) {
		let appendRoot = doc?.body || doc?.documentElement || null;
		if (!appendRoot?.appendChild) {
			return null;
		}
		let host = doc.querySelector?.(`[${TABLE_FRAGMENT_MEASURE_HOST_ATTR}="true"]`) || null;
		if (host) {
			return host;
		}
		host = doc.createElement("div");
		host.setAttribute(TABLE_FRAGMENT_MEASURE_HOST_ATTR, "true");
		host.style.position = "absolute";
		host.style.left = "-20000px";
		host.style.top = "0";
		host.style.width = "auto";
		host.style.height = "auto";
		host.style.overflow = "visible";
		host.style.visibility = "hidden";
		host.style.pointerEvents = "none";
		appendRoot.appendChild(host);
		return host;
	}

	function createTableMeasurePage(doc, container, pageBody, sourceKind = "preview") {
		let root = doc.createElement("div");
		root.className = sourceKind == "native" ? "sr-native-root" : "sr-markdown-document";
		root.style.display = "block";
		root.style.width = "max-content";
		root.style.minWidth = "0";
		root.style.background = "transparent";
		let sheet = doc.createElement("section");
		sheet.className = "sr-page-sheet";
		sheet.setAttribute("data-sr-layout", pageBodyLayout(pageBody));
		sheet.setAttribute("data-sr-page-source", "auto");
		let body = doc.createElement("div");
		copyPageBodyMeasurementStyles(pageBody, body);
		sheet.appendChild(body);
		root.appendChild(sheet);
		container.appendChild(root);
		return { root, sheet, body };
	}

	function createTableMeasureSandbox(block, pageBody, host) {
		let doc = block?.ownerDocument || pageBody?.ownerDocument || host?.ownerDocument || null;
		if (!doc?.createElement || !pageBody || !host) {
			return null;
		}
		let frame = doc.createElement("div");
		frame.style.position = "absolute";
		frame.style.left = "-20000px";
		frame.style.top = "0";
		frame.style.visibility = "hidden";
		frame.style.pointerEvents = "none";
		frame.style.overflow = "visible";
		frame.style.width = `${Math.max(1, pageBody.clientWidth || safeNodeRectWidth(pageBody) || 1)}px`;
		frame.style.minHeight = `${Math.max(1, pageBody.clientHeight || safeNodeRectHeight(pageBody) || 1)}px`;
		frame.style.height = "auto";
		host.appendChild(frame);
		let sourcePage = createTableMeasurePage(doc, frame, pageBody, renderedTableSourceKind(block));
		let fragmentPage = createTableMeasurePage(doc, frame, pageBody, renderedTableSourceKind(block));
		let sourceBlock = block.cloneNode(true);
		sourcePage.body.appendChild(sourceBlock);
		return {
			doc,
			frame,
			host,
			sourceBody: sourcePage.body,
			fragmentBody: fragmentPage.body,
			sourceBlock,
		};
	}

	function destroyTableMeasureSandbox(sandbox) {
		try {
			sandbox?.frame?.remove?.();
		}
		catch (_error) {}
	}

	function tableCellDescriptor(cell, fallbackColumnIndex = 0) {
		let colspan = Math.max(1, Number(cell?.getAttribute?.("data-colspan") || cell?.colSpan || 1) || 1);
		return {
			colspan,
			columnIndex: Math.max(
				0,
				Number(
					cell?.getAttribute?.("data-sr-column-index")
					|| cell?.getAttribute?.("data-column-index")
					|| fallbackColumnIndex
					|| 0
				) || 0
			),
			align: normalizeTableAlignment(cell?.getAttribute?.("data-sr-align") || "left") || "left",
		};
	}

	function ensureTrackSlots(trackSamples, count) {
		while (trackSamples.length < count) {
			trackSamples.push([]);
		}
		return trackSamples;
	}

	function averageNumberList(values = []) {
		let usable = (values || []).map((value) => Number(value) || 0).filter((value) => value > 0);
		if (!usable.length) {
			return 0;
		}
		return usable.reduce((sum, value) => sum + value, 0) / usable.length;
	}

	function normalizeTrackPercentages(widths = [], referenceWidth = 0) {
		let usable = (widths || []).map((value) => Number(value) || 0);
		let widthBase = Math.max(0, Number(referenceWidth || 0) || 0);
		let fallbackBase = usable.reduce((sum, value) => sum + Math.max(0, value), 0);
		let base = Math.max(1, widthBase || fallbackBase || 0);
		let percents = usable.map((value) => (Math.max(0, value) / base) * 100);
		let total = percents.reduce((sum, value) => sum + value, 0);
		if (!(total > 0)) {
			return [];
		}
		return percents.map((value) => (value / total) * 100);
	}

	function validTrackPercentages(trackPercentages = [], referenceWidth = 0, spanSamples = []) {
		if (!Array.isArray(trackPercentages) || !trackPercentages.length) {
			return false;
		}
		if (trackPercentages.some((value) => !Number.isFinite(value) || value <= 0)) {
			return false;
		}
		let total = trackPercentages.reduce((sum, value) => sum + value, 0);
		if (Math.abs(total - 100) > 1.5) {
			return false;
		}
		let widthBase = Math.max(1, Number(referenceWidth || 0) || 1);
		let failures = 0;
		for (let sample of spanSamples || []) {
			let start = Math.max(0, Number(sample?.start || 0) || 0);
			let span = Math.max(1, Number(sample?.span || 1) || 1);
			let expected = trackPercentages
				.slice(start, start + span)
				.reduce((sum, value) => sum + value, 0) * (widthBase / 100);
			let measured = Math.max(0, Number(sample?.width || 0) || 0);
			if (!measured) {
				continue;
			}
			let tolerance = Math.max(10, measured * 0.16);
			if (Math.abs(expected - measured) > tolerance) {
				failures += 1;
			}
		}
		return failures <= Math.max(1, Math.floor((spanSamples?.length || 0) * 0.5));
	}

	function buildRenderedTableTrackModel(table = null, headerCells = []) {
		if (!table) {
			return {
				mode: "auto",
				percentages: [],
				tableWidth: 0,
			};
		}
		let tableWidth = Math.max(1, safeNodeRectWidth(table));
		let rowCells = [];
		let header = Array.isArray(headerCells) && headerCells.length
			? headerCells
			: Array.from(table.querySelectorAll("thead tr:first-child > th"));
		header.forEach((cell, index) => rowCells.push({ cell, fallbackColumnIndex: index }));
		Array.from(table.querySelectorAll("tbody tr")).forEach((row) => {
			Array.from(row.querySelectorAll(":scope > td, :scope > th")).forEach((cell, index) => {
				rowCells.push({ cell, fallbackColumnIndex: index });
			});
		});
		let trackSamples = [];
		let spanSamples = [];
		let trackCount = 0;
		for (let entry of rowCells) {
			let descriptor = tableCellDescriptor(entry?.cell, entry?.fallbackColumnIndex);
			trackCount = Math.max(trackCount, descriptor.columnIndex + descriptor.colspan);
			ensureTrackSlots(trackSamples, trackCount);
			let width = Math.max(0, safeNodeRectWidth(entry?.cell));
			if (!width) {
				continue;
			}
			if (descriptor.colspan == 1) {
				trackSamples[descriptor.columnIndex].push(width);
			}
			else {
				spanSamples.push({
					start: descriptor.columnIndex,
					span: descriptor.colspan,
					width,
				});
			}
		}
		if (!trackCount) {
			return {
				mode: "auto",
				percentages: [],
				tableWidth,
			};
		}
		ensureTrackSlots(trackSamples, trackCount);
		let widths = trackSamples.map((samples) => averageNumberList(samples));
		let resolved = true;
		for (let pass = 0; pass < trackCount; pass += 1) {
			let changed = false;
			for (let sample of spanSamples) {
				let missing = [];
				let known = 0;
				for (let offset = 0; offset < sample.span; offset += 1) {
					let trackIndex = sample.start + offset;
					let value = Number(widths[trackIndex] || 0) || 0;
					if (value > 0) {
						known += value;
					}
					else {
						missing.push(trackIndex);
					}
				}
				if (missing.length == 1 && sample.width > known + 1) {
					widths[missing[0]] = sample.width - known;
					changed = true;
				}
			}
			if (!changed) {
				break;
			}
		}
		let averageWidth = averageNumberList(widths) || (tableWidth / Math.max(1, trackCount));
		for (let index = 0; index < widths.length; index += 1) {
			if (!(Number(widths[index] || 0) > 0)) {
				widths[index] = averageWidth;
				resolved = false;
			}
		}
		let percentages = normalizeTrackPercentages(widths, tableWidth);
		let valid = resolved && validTrackPercentages(percentages, tableWidth, spanSamples);
		return {
			mode: valid ? "fixed" : "auto",
			percentages: valid ? percentages : [],
			tableWidth,
		};
	}

	function splitTextUnits(text = "", options = {}) {
		let value = String(text || "");
		if (!value.length) {
			return [];
		}
		let units = value.match(/\S+\s*|\s+/g) || [value];
		let out = [];
		let maxTokenLength = Math.max(1, Number(options?.maxTokenLength || 12) || 12);
		for (let unit of units) {
			if (!unit) {
				continue;
			}
			if (unit.length <= maxTokenLength || /^\s+$/.test(unit)) {
				out.push(unit);
				continue;
			}
			let cursor = 0;
			while (cursor < unit.length) {
				out.push(unit.slice(cursor, cursor + maxTokenLength));
				cursor += maxTokenLength;
			}
		}
		return out;
	}

	function atomicInlineNode(node) {
		if (!node?.tagName) {
			return false;
		}
		let tag = String(node.tagName || "").toUpperCase();
		if (["IMG", "BR", "SVG", "MATH", "HR"].includes(tag)) {
			return true;
		}
		if (node.getAttribute?.("contenteditable") == "false") {
			return true;
		}
		return node.classList?.contains?.("sr-citation-chip");
	}

	function boundaryPointAfterNode(node) {
		let parent = node?.parentNode || null;
		if (!parent) {
			return null;
		}
		let offset = 0;
		let cursor = node;
		while (cursor && cursor !== parent) {
			offset += 1;
			cursor = cursor.previousSibling;
		}
		return { kind: "node", node: parent, offset };
	}

	function buildCellTextBoundaries(root) {
		if (!root?.ownerDocument) {
			return [{
				kind: "root",
				node: root || null,
				offset: 0,
				textOffset: 0,
			}];
		}
		let boundaries = [{
			kind: "root",
			node: root,
			offset: 0,
			textOffset: 0,
		}];
		let textOffset = 0;
		let pushBoundary = (point, advance = 0) => {
			if (!point?.node) {
				return;
			}
			textOffset += Math.max(0, Number(advance || 0) || 0);
			boundaries.push({
				kind: point.kind || "node",
				node: point.node,
				offset: Math.max(0, Number(point.offset || 0) || 0),
				textOffset,
			});
		};
		let walk = (node) => {
			if (!node) {
				return;
			}
			if (node.nodeType == 3) {
				let parentTag = String(node.parentElement?.tagName || "").toUpperCase();
				let units = splitTextUnits(node.nodeValue || "", {
					maxTokenLength: ["CODE", "KBD", "SAMP", "VAR", "PRE"].includes(parentTag) ? 1 : 12,
				});
				let seen = 0;
				for (let unit of units) {
					seen += String(unit || "").length;
					pushBoundary({
						kind: "text",
						node,
						offset: seen,
					}, String(unit || "").length);
				}
				return;
			}
			if (node.nodeType != 1) {
				return;
			}
			if (atomicInlineNode(node)) {
				pushBoundary(
					boundaryPointAfterNode(node),
					String(node.textContent || "").length || (String(node.tagName || "").toUpperCase() == "BR" ? 1 : 0)
				);
				return;
			}
			for (let child of Array.from(node.childNodes || [])) {
				walk(child);
			}
		};
		for (let child of Array.from(root.childNodes || [])) {
			walk(child);
		}
		if (boundaries.length == 1) {
			boundaries.push({
				kind: "root",
				node: root,
				offset: root.childNodes?.length || 0,
				textOffset: 0,
			});
		}
		return boundaries;
	}

	function rangeFromCellBoundaries(doc, boundaries, startIndex, endIndex) {
		if (!doc?.createRange || !Array.isArray(boundaries) || !boundaries.length) {
			return null;
		}
		let start = boundaries[Math.max(0, Math.min(boundaries.length - 1, Number(startIndex || 0) || 0))] || boundaries[0];
		let end = boundaries[Math.max(0, Math.min(boundaries.length - 1, Number(endIndex || 0) || 0))] || boundaries[boundaries.length - 1];
		if (!start?.node || !end?.node) {
			return null;
		}
		try {
			let range = doc.createRange();
			range.setStart(start.node, Math.max(0, Number(start.offset || 0) || 0));
			range.setEnd(end.node, Math.max(0, Number(end.offset || 0) || 0));
			return range;
		}
		catch (_error) {
			return null;
		}
	}

	function cloneRangeHTML(doc, boundaries, startIndex, endIndex) {
		let range = rangeFromCellBoundaries(doc, boundaries, startIndex, endIndex);
		if (!range) {
			return "";
		}
		let wrapper = doc.createElement("div");
		try {
			wrapper.appendChild(range.cloneContents());
		}
		catch (_error) {
			return "";
		}
		return wrapper.innerHTML || "";
	}

	function tableCellEndIndex(cellModel = null) {
		return Math.max(0, (Array.isArray(cellModel?.boundaries) ? cellModel.boundaries.length : 1) - 1);
	}

	function tableCellSliceHTMLHasVisibleContent(html = "") {
		let source = String(html || "");
		if (!source) {
			return false;
		}
		let stripped = source
			.replace(/<br\s*\/?>/gi, " ")
			.replace(/&nbsp;/gi, " ")
			.replace(/<[^>]+>/g, "")
			.trim();
		if (stripped) {
			return true;
		}
		return /<(br|img|svg|math|hr|code|a|sup|sub)\b/i.test(source);
	}

	function tableCellSliceHasVisibleContent(metrics = null) {
		if (!metrics) {
			return false;
		}
		if (tableCellSliceHTMLHasVisibleContent(metrics.html || "")) {
			return true;
		}
		let sliceStart = Math.max(0, Number(metrics.sliceStart || 0) || 0);
		let sliceEnd = Math.max(sliceStart, Number(metrics.sliceEnd || sliceStart) || sliceStart);
		return sliceEnd > sliceStart && /<[^>]+>/.test(String(metrics.html || ""));
	}

	function copyMeasuredTextStyles(source, target, { width = 0, textSource = null } = {}) {
		if (!source || !target) {
			return;
		}
		let view = source.ownerDocument?.defaultView || null;
		let style = view?.getComputedStyle?.(source) || null;
		let textStyle = textSource && textSource !== source
			? (view?.getComputedStyle?.(textSource) || null)
			: style;
		if (!style) {
			if (width > 0) {
				target.style.width = `${width}px`;
			}
			return;
		}
		let widthValue = Math.max(0, Number(width || 0) || 0);
		target.style.boxSizing = "border-box";
		target.style.display = "block";
		target.style.width = widthValue > 0 ? `${widthValue}px` : "auto";
		target.style.minWidth = "0";
		target.style.margin = "0";
		target.style.padding = "0";
		target.style.border = "0";
		target.style.fontFamily = textStyle?.fontFamily || style.fontFamily || "";
		target.style.fontSize = textStyle?.fontSize || style.fontSize || "";
		target.style.fontWeight = textStyle?.fontWeight || style.fontWeight || "";
		target.style.fontStyle = textStyle?.fontStyle || style.fontStyle || "";
		target.style.lineHeight = textStyle?.lineHeight || style.lineHeight || "";
		target.style.letterSpacing = textStyle?.letterSpacing || style.letterSpacing || "";
		target.style.textAlign = style.textAlign || "";
		target.style.textTransform = textStyle?.textTransform || style.textTransform || "";
		target.style.textIndent = textStyle?.textIndent || style.textIndent || "";
		target.style.whiteSpace = textStyle?.whiteSpace || style.whiteSpace || "normal";
		target.style.wordBreak = style.wordBreak || textStyle?.wordBreak || "normal";
		target.style.overflowWrap = style.overflowWrap || textStyle?.overflowWrap || "break-word";
	}

	function buildRenderedTableCellModel(cell, rowIndex, fallbackColumnIndex = 0) {
		let content = renderedTableCellContent(cell);
		let boundaries = buildCellTextBoundaries(content);
		let contentHeight = safeNodeRectHeight(content);
		let cellHeight = safeNodeRectHeight(cell);
		let contentWidth = safeNodeRectWidth(content) || Math.max(0, safeNodeRectWidth(cell) - 18);
		let extraHeight = Math.max(0, cellHeight - contentHeight);
		if (content === cell) {
			let view = cell?.ownerDocument?.defaultView || null;
			let style = view?.getComputedStyle?.(cell) || null;
			if (style) {
				let paddingTop = Number.parseFloat(style.paddingTop || "0") || 0;
				let paddingBottom = Number.parseFloat(style.paddingBottom || "0") || 0;
				let paddingLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
				let paddingRight = Number.parseFloat(style.paddingRight || "0") || 0;
				let borderTop = Number.parseFloat(style.borderTopWidth || "0") || 0;
				let borderBottom = Number.parseFloat(style.borderBottomWidth || "0") || 0;
				let borderLeft = Number.parseFloat(style.borderLeftWidth || "0") || 0;
				let borderRight = Number.parseFloat(style.borderRightWidth || "0") || 0;
				extraHeight = Math.max(extraHeight, paddingTop + paddingBottom + borderTop + borderBottom);
				contentWidth = Math.max(1, safeNodeRectWidth(cell) - paddingLeft - paddingRight - borderLeft - borderRight);
			}
		}
		let descriptor = tableCellDescriptor(cell, fallbackColumnIndex);
		let doc = cell?.ownerDocument || null;
		let cache = new Map();
		return {
			cell,
			content,
			align: descriptor.align,
			rowIndex: Number(rowIndex || 0) || 0,
			columnIndex: descriptor.columnIndex,
			colspan: descriptor.colspan,
			multilineProse: String(cell?.getAttribute?.("data-sr-multiline-prose") || "").trim() == "true",
			contentWidth: Math.max(1, contentWidth),
			extraHeight,
			boundaries,
			textLength: Number(boundaries[boundaries.length - 1]?.textOffset || 0) || 0,
			measure(startIndex, endIndex, measureHost = null) {
				let safeStart = Math.max(0, Math.min(boundaries.length - 1, Number(startIndex || 0) || 0));
				let safeEnd = Math.max(safeStart, Math.min(boundaries.length - 1, Number(endIndex || 0) || 0));
				let key = `${safeStart}:${safeEnd}`;
				if (cache.has(key)) {
					return cache.get(key);
				}
				let html = cloneRangeHTML(doc, boundaries, safeStart, safeEnd);
				let innerHeight = 0;
				if (html && measureHost?.ownerDocument?.createElement) {
					let probe = doc.createElement(content?.tagName?.toLowerCase?.() || "div");
					probe.className = content?.className || "sr-table-fragment-cell-content";
					copyMeasuredTextStyles(cell, probe, {
						width: contentWidth,
						textSource: content,
					});
					probe.innerHTML = html;
					measureHost.appendChild(probe);
					innerHeight = safeNodeRectHeight(probe);
					probe.remove();
				}
				let textStart = Number(boundaries[safeStart]?.textOffset || 0) || 0;
				let textEnd = Number(boundaries[safeEnd]?.textOffset || textStart) || textStart;
				let metrics = {
					html,
					innerHeight,
					outerHeight: Math.max(0, innerHeight + extraHeight),
					startIndex: safeStart,
					endIndex: safeEnd,
					sliceStart: textStart,
					sliceEnd: textEnd,
				};
				cache.set(key, metrics);
				return metrics;
			},
		};
	}

	function renderedTableSourceInfo(block) {
		let root = renderedTableRoot(block);
		let table = renderedTableElement(root);
		if (!root || !table) {
			return null;
		}
		let caption = renderedTableCaptionElement(root);
		let note = renderedTableNoteElement(root);
		let headerRow = table.querySelector?.("thead tr:first-child") || null;
		let headerNodes = Array.from(headerRow?.querySelectorAll?.(":scope > th") || []);
		let trackModel = buildRenderedTableTrackModel(table, headerNodes);
		let headerColumn = 0;
		let headerCells = headerNodes.map((cell) => {
			let descriptor = tableCellDescriptor(cell, headerColumn);
			headerColumn = descriptor.columnIndex + descriptor.colspan;
			return {
				html: renderedTableCellContent(cell)?.innerHTML || cell.innerHTML || "",
				align: descriptor.align,
				columnIndex: descriptor.columnIndex,
				colspan: descriptor.colspan,
				sliceStart: 0,
				sliceEnd: 0,
			};
		});
		let rows = renderedTableRows(root).map((row, rowIndex) => {
			let column = 0;
			let cells = Array.from(row.querySelectorAll(":scope > td, :scope > th")).map((cell) => {
				let model = buildRenderedTableCellModel(cell, rowIndex, column);
				column = model.columnIndex + model.colspan;
				return model;
			});
			return {
				row,
				rowIndex,
				cells,
				fullHeight: 0,
			};
		});
		return {
			block: root,
			table,
			tableStyle: root.getAttribute?.("data-sr-table-style") || "standard",
			sourceKind: renderedTableSourceKind(root),
			captionHTML: caption?.innerHTML || "",
			noteHTML: note?.innerHTML || "",
			captionHeight: safeNodeRectHeight(caption),
			noteHeight: safeNodeRectHeight(note),
			headerRowHeight: Math.max(safeNodeRectHeight(headerRow), ...headerNodes.map((cell) => safeNodeRectHeight(cell))),
			columnTrackMode: trackModel.mode,
			columnTrackPercentages: trackModel.percentages.slice(),
			tableWidth: trackModel.tableWidth,
			headerCells,
			rows,
		};
	}

	function normalizeMeasuredTableCellSlice(cellModel, startIndex, metrics, availableHeight, measureHost) {
		if (!cellModel) {
			return metrics;
		}
		let safeStart = Math.max(0, Math.min(tableCellEndIndex(cellModel), Number(startIndex || 0) || 0));
		let base = metrics || cellModel.measure(safeStart, safeStart, measureHost);
		if ((Number(base?.endIndex || safeStart) || safeStart) <= safeStart) {
			return base;
		}
		if (tableCellSliceHasVisibleContent(base)) {
			return base;
		}
		let heightLimit = Number.isFinite(Number(availableHeight)) ? Number(availableHeight) : Number.POSITIVE_INFINITY;
		let firstVisible = null;
		let bestFitting = null;
		for (let endIndex = safeStart + 1; endIndex <= tableCellEndIndex(cellModel); endIndex += 1) {
			let candidate = cellModel.measure(safeStart, endIndex, measureHost);
			if ((Number(candidate?.endIndex || safeStart) || safeStart) <= safeStart) {
				continue;
			}
			if (!tableCellSliceHasVisibleContent(candidate)) {
				continue;
			}
			if (!firstVisible) {
				firstVisible = candidate;
			}
			if ((Number(candidate.outerHeight || 0) || 0) <= heightLimit + 0.5) {
				bestFitting = candidate;
			}
		}
		return bestFitting || firstVisible || base;
	}

	function measureRemainingTableCellSlice(cellModel, startIndex, measureHost) {
		if (!cellModel) {
			return {
				html: "",
				innerHeight: 0,
				outerHeight: 0,
				startIndex: 0,
				endIndex: 0,
				sliceStart: 0,
				sliceEnd: 0,
			};
		}
		let safeStart = Math.max(0, Math.min(tableCellEndIndex(cellModel), Number(startIndex || 0) || 0));
		let endIndex = tableCellEndIndex(cellModel);
		if (safeStart >= endIndex) {
			let textOffset = Number(cellModel.boundaries?.[safeStart]?.textOffset || 0) || 0;
			return {
				html: "",
				innerHeight: 0,
				outerHeight: 0,
				startIndex: safeStart,
				endIndex: safeStart,
				sliceStart: textOffset,
				sliceEnd: textOffset,
			};
		}
		return normalizeMeasuredTableCellSlice(
			cellModel,
			safeStart,
			cellModel.measure(safeStart, endIndex, measureHost),
			Number.POSITIVE_INFINITY,
			measureHost
		);
	}

	function chooseTableCellSlice(cellModel, startIndex, availableHeight, measureHost) {
		let boundaries = cellModel?.boundaries || [];
		let start = Math.max(0, Math.min(boundaries.length - 1, Number(startIndex || 0) || 0));
		if (start >= boundaries.length - 1) {
			let textOffset = Number(boundaries[start]?.textOffset || 0) || 0;
			return {
				html: "",
				outerHeight: 0,
				startIndex: start,
				endIndex: start,
				sliceStart: textOffset,
				sliceEnd: textOffset,
			};
		}
		let low = start + 1;
		let high = boundaries.length - 1;
		let best = start;
		while (low <= high) {
			let mid = Math.floor((low + high) / 2);
			let metrics = cellModel.measure(start, mid, measureHost);
			if ((Number(metrics.outerHeight || 0) || 0) <= availableHeight + 0.5) {
				best = mid;
				low = mid + 1;
			}
			else {
				high = mid - 1;
			}
		}
		if (best <= start) {
			best = Math.min(boundaries.length - 1, start + 1);
		}
		return normalizeMeasuredTableCellSlice(
			cellModel,
			start,
			cellModel.measure(start, best, measureHost),
			availableHeight,
			measureHost
		);
	}

	function buildTableSliceRowCandidate(row, rowState, availableHeight, measureHost, options = {}) {
		let heightBudget = Math.max(DEFAULT_MIN_SLICE_HEIGHT, Number(availableHeight || 0) || 0);
		let starts = Array.isArray(rowState?.starts) ? rowState.starts.slice() : [];
		let forceSlice = !!options?.forceSlice;
		let cellEntries = row.cells.map((cellModel, cellIndex) => {
			let startIndex = Math.max(0, Math.min(tableCellEndIndex(cellModel), Number(starts[cellIndex] || 0) || 0));
			let done = startIndex >= tableCellEndIndex(cellModel);
			return {
				cellIndex,
				cellModel,
				startIndex,
				done,
				remaining: done ? null : measureRemainingTableCellSlice(cellModel, startIndex, measureHost),
			};
		});
		let overflowEntries = cellEntries.filter((entry) =>
			!entry.done
			&& (forceSlice || ((Number(entry.remaining?.outerHeight || 0) || 0) > heightBudget + 0.5))
		);
		let rowSliceHeight = 0;
		if (overflowEntries.length) {
			let provisionalSlices = overflowEntries.map((entry) =>
				chooseTableCellSlice(entry.cellModel, entry.startIndex, heightBudget, measureHost)
			);
			rowSliceHeight = Math.max(0, ...provisionalSlices.map((metrics) => Number(metrics?.outerHeight || 0) || 0));
		}
		let sliceCells = [];
		let sliceHeight = 0;
		let nextStarts = starts.slice();
		let madeProgress = false;
		for (let entry of cellEntries) {
			let { cellModel, startIndex, done, remaining } = entry;
			if (done) {
				sliceCells.push({
					align: cellModel.align,
					columnIndex: cellModel.columnIndex,
					colspan: cellModel.colspan,
					multilineProse: cellModel.multilineProse,
					emptyCarryover: true,
					html: "",
					sliceStart: cellModel.textLength,
					sliceEnd: cellModel.textLength,
					startIndex,
					endIndex: startIndex,
				});
				nextStarts[entry.cellIndex] = startIndex;
				continue;
			}
			let metrics = remaining;
			if (overflowEntries.length && (forceSlice || (Number(remaining?.outerHeight || 0) || 0) > rowSliceHeight + 0.5)) {
				metrics = chooseTableCellSlice(cellModel, startIndex, rowSliceHeight, measureHost);
			}
			let endIndex = Math.max(
				startIndex + 1,
				Math.min(
					tableCellEndIndex(cellModel),
					Number(metrics?.endIndex || (startIndex + 1)) || (startIndex + 1)
				)
			);
			if (endIndex !== metrics?.endIndex) {
				metrics = normalizeMeasuredTableCellSlice(
					cellModel,
					startIndex,
					cellModel.measure(startIndex, endIndex, measureHost),
					overflowEntries.length ? rowSliceHeight : heightBudget,
					measureHost
				);
				endIndex = Math.max(
					startIndex + 1,
					Math.min(
						tableCellEndIndex(cellModel),
						Number(metrics?.endIndex || (startIndex + 1)) || (startIndex + 1)
					)
				);
			}
			madeProgress = madeProgress || endIndex > startIndex;
			sliceHeight = Math.max(sliceHeight, Number(metrics?.outerHeight || 0) || 0);
			sliceCells.push({
				align: cellModel.align,
				columnIndex: cellModel.columnIndex,
				colspan: cellModel.colspan,
				multilineProse: cellModel.multilineProse,
				emptyCarryover: false,
				html: metrics?.html || "",
				sliceStart: Number(metrics?.sliceStart || 0) || 0,
				sliceEnd: Number(metrics?.sliceEnd || 0) || 0,
				startIndex,
				endIndex,
			});
			nextStarts[entry.cellIndex] = endIndex;
		}
		if (!madeProgress) {
			return null;
		}
		return {
			sourceRow: row.rowIndex,
			continued: starts.some((value) => value > 0),
			height: sliceHeight,
			cells: sliceCells,
			mode: "slice",
			stateBefore: starts,
			stateAfter: nextStarts,
			complete: nextStarts.every((value, cellIndex) => value >= row.cells[cellIndex].boundaries.length - 1),
		};
	}

	function buildFullTableRowCandidate(row, rowState, measureHost) {
		let starts = Array.isArray(rowState?.starts) ? rowState.starts.slice() : [];
		let cells = row.cells.map((cellModel) => {
			let full = measureRemainingTableCellSlice(cellModel, 0, measureHost);
			return {
				align: cellModel.align,
				columnIndex: cellModel.columnIndex,
				colspan: cellModel.colspan,
				multilineProse: cellModel.multilineProse,
				emptyCarryover: false,
				html: full.html,
				sliceStart: 0,
				sliceEnd: Number(full.sliceEnd || 0) || 0,
				startIndex: 0,
				endIndex: tableCellEndIndex(cellModel),
			};
		});
		return {
			sourceRow: row.rowIndex,
			continued: false,
			height: row.fullHeight,
			mode: "full",
			stateBefore: starts,
			stateAfter: row.cells.map((cellModel) => tableCellEndIndex(cellModel)),
			complete: true,
			cells,
		};
	}

	function tableFragmentTableHTML(fragment = {}) {
		let trackMode = String(fragment?.columnTrackMode || "").trim().toLowerCase() == "fixed" ? "fixed" : "auto";
		let widths = trackMode == "fixed"
			? normalizeTrackPercentages(Array.isArray(fragment?.columnTrackPercentages) ? fragment.columnTrackPercentages : [])
			: [];
		if (!validTrackPercentages(widths)) {
			trackMode = "auto";
			widths = [];
		}
		let headerCells = Array.isArray(fragment?.headerCells) ? fragment.headerCells : [];
		let rows = Array.isArray(fragment?.rows) ? fragment.rows : [];
		let includeHeader = fragment?.includeHeader !== false;
		if (!rows.length && (!includeHeader || !headerCells.length)) {
			return "";
		}
		let colgroup = widths.length
			? `<colgroup>${widths.map((width) => `<col style="width:${Math.max(0.01, Number(width || 0) || 0).toFixed(4)}%;" />`).join("")}</colgroup>`
			: "";
		let renderCell = (cell = {}, header = false) => {
			let tag = header ? "th" : "td";
			let colspan = Math.max(1, Number(cell.colspan || 1) || 1);
			let attrs = [
				` data-sr-align="${normalizeTableAlignment(cell.align || "left") || "left"}"`,
				` data-sr-source-row="${header ? 0 : Math.max(0, Number(cell.sourceRow ?? cell.rowIndex ?? 0) || 0)}"`,
				` data-sr-source-column="${Math.max(0, Number(cell.columnIndex || 0) || 0)}"`,
				` data-sr-slice-start="${Math.max(0, Number(cell.sliceStart || 0) || 0)}"`,
				` data-sr-slice-end="${Math.max(0, Number(cell.sliceEnd || 0) || 0)}"`,
				` data-colspan="${colspan}"`,
				colspan > 1 ? ` colspan="${colspan}"` : "",
				!header && cell.multilineProse ? ' data-sr-multiline-prose="true"' : "",
				cell.emptyCarryover ? ' data-sr-carryover-empty="true"' : "",
			].join("");
			return `<${tag}${attrs}><div class="sr-table-fragment-cell-content${cell.emptyCarryover ? " is-empty-carryover" : ""}">${cell.emptyCarryover ? "" : (cell.html || "<br />")}</div></${tag}>`;
		};
		let headerHTML = includeHeader && headerCells.length
			? `<thead><tr>${headerCells.map((cell) => renderCell(cell, true)).join("")}</tr></thead>`
			: "";
		return `<table class="sr-table-fragment-table" data-sr-track-mode="${trackMode}" data-sr-table-style="${escapeHTML(fragment?.tableStyle || "standard")}">${colgroup}${headerHTML}<tbody>${
			rows.map((row) => `<tr data-sr-source-row="${Math.max(0, Number(row.sourceRow || 0) || 0)}" data-sr-row-continuation="${row.continued ? "true" : "false"}">${
				(row.cells || []).map((cell) => renderCell(Object.assign({}, cell, { sourceRow: row.sourceRow }), false)).join("")
			}</tr>`).join("")
		}</tbody></table>`;
	}

	function renderTableFragmentNode(fragment = {}, options = {}) {
		let doc = options?.doc || options?.document || (typeof document != "undefined" ? document : null);
		if (!doc?.createElement) {
			return null;
		}
		let projection = !!options?.projection;
		let block = doc.createElement("section");
		block.className = projection ? "sr-table-projection-block" : "sr-table-fragment-block";
		block.setAttribute("data-sr-generated-continuation", "table");
		block.setAttribute("data-sr-table-group", String(fragment?.groupId || ""));
		block.setAttribute("data-sr-table-fragment-index", String(Math.max(0, Number(fragment?.index || 0) || 0)));
		block.setAttribute("data-sr-table-fragment-first", fragment?.first ? "true" : "false");
		block.setAttribute("data-sr-table-fragment-last", fragment?.last ? "true" : "false");
		block.setAttribute("data-sr-table-style", String(fragment?.tableStyle || "standard"));
		if (projection) {
			block.setAttribute("data-sr-editable", "false");
		}
		let captionHTML = fragment?.includeCaption === false ? "" : (fragment?.captionHTML || "");
		let noteHTML = fragment?.includeNote === false ? "" : (fragment?.noteHTML || "");
		let tableHTML = tableFragmentTableHTML(fragment);
		block.innerHTML = `${
			captionHTML ? `<div class="sr-block-caption sr-table-caption">${captionHTML}</div>` : ""
		}${
			tableHTML ? `<div class="sr-table-fragment-wrap">${tableHTML}</div>` : ""
		}${
			noteHTML ? `<div class="sr-block-note sr-table-note">${noteHTML}</div>` : ""
		}`;
		return block;
	}

	function measureRenderedTableFragmentMetrics(fragment = {}, sandbox = null) {
		let doc = sandbox?.doc || null;
		let body = sandbox?.fragmentBody || null;
		if (!doc?.createElement || !body) {
			return { blockHeight: 0, tableHeight: 0 };
		}
		body.replaceChildren();
		let block = renderTableFragmentNode(fragment, {
			doc,
			projection: false,
		});
		if (!block) {
			return { blockHeight: 0, tableHeight: 0 };
		}
		body.appendChild(block);
		return {
			blockHeight: safeNodeRectHeight(block),
			tableHeight: safeNodeRectHeight(block.querySelector(".sr-table-fragment-wrap") || block.querySelector("table") || block),
		};
	}

	function tableFragmentPlanCompletionStatus(rows = [], rowStates = [], completedRowCount = 0, reason = "") {
		let sourceRowCount = Array.isArray(rows) ? rows.length : 0;
		let safeCompletedRowCount = Math.max(0, Math.min(sourceRowCount, Number(completedRowCount || 0) || 0));
		let complete = safeCompletedRowCount >= sourceRowCount;
		if (complete) {
			for (let rowIndex = 0; rowIndex < sourceRowCount; rowIndex += 1) {
				let row = rows[rowIndex] || null;
				let starts = Array.isArray(rowStates?.[rowIndex]?.starts) ? rowStates[rowIndex].starts : [];
				for (let cellIndex = 0; cellIndex < (row?.cells || []).length; cellIndex += 1) {
					if ((Number(starts[cellIndex] || 0) || 0) < tableCellEndIndex(row.cells[cellIndex])) {
						complete = false;
						break;
					}
				}
				if (!complete) {
					break;
				}
			}
		}
		return {
			complete,
			sourceRowCount,
			completedRowCount: safeCompletedRowCount,
			incompleteReason: complete
				? ""
				: String(reason || `Measured table fragments covered only ${safeCompletedRowCount} of ${sourceRowCount} source row(s).`),
		};
	}

	function buildRenderedTableFragmentPlan(block, options = {}) {
		let doc = block?.ownerDocument || null;
		let host = tableMeasureHost(doc);
		let pageBody = options?.pageBody || block?.closest?.(".sr-page-sheet-body") || null;
		let pageBodyBox = options?.pageBodyBox || measurePageBodyUsableBox(pageBody, {
			occupiedHeight: options?.occupiedHeight,
			precedingNodes: options?.precedingNodes,
		});
		let defaultPageHeight = Math.max(
			DEFAULT_MIN_SLICE_HEIGHT,
			Number(options?.pageHeight || pageBodyBox?.contentHeight || pageBody?.clientHeight || 0) || 0
		);
		if (!pageBody || !host || !defaultPageHeight) {
			return null;
		}
		let sandbox = createTableMeasureSandbox(block, pageBody, host);
		if (!sandbox?.sourceBlock) {
			return null;
		}
		try {
			let source = renderedTableSourceInfo(sandbox.sourceBlock);
			if (!source) {
				return null;
			}
			let firstPageHeight = Math.max(
				DEFAULT_MIN_SLICE_HEIGHT,
				Number(options?.firstPageAvailableHeight || pageBodyBox?.remainingHeight || defaultPageHeight) || defaultPageHeight
			);
			let followingPageHeight = Math.max(
				DEFAULT_MIN_SLICE_HEIGHT,
				Number(options?.followingPageHeight || pageBodyBox?.contentHeight || defaultPageHeight) || defaultPageHeight
			);
			let rows = source.rows || [];
			rows.forEach((row) => {
				row.fullHeight = Math.max(0, ...((row.cells || []).map((cellModel) =>
					Number(measureRemainingTableCellSlice(cellModel, 0, host).outerHeight || 0) || 0
				)));
			});
			let fragments = [];
			let rowStates = rows.map((row) => ({
				row,
				starts: row.cells.map(() => 0),
			}));
			let rowIndex = 0;
			let fragmentIndex = 0;
			let startOnNextPage = false;
			let movedToFreshFirstPage = false;

			while (rowIndex < rows.length) {
				let isFirst = fragmentIndex == 0;
				let fragmentLimit = isFirst ? firstPageHeight : followingPageHeight;
				let fragment = {
					groupId: String(options?.groupId || ""),
					index: fragmentIndex,
					pageIndex: fragmentIndex,
					first: isFirst,
					last: false,
					captionHTML: isFirst ? source.captionHTML : "",
					noteHTML: "",
					includeCaption: isFirst,
					includeNote: false,
					includeHeader: true,
					headerCells: source.headerCells.map((cell) => Object.assign({}, cell)),
					rows: [],
					tableStyle: source.tableStyle,
					columnTrackMode: source.columnTrackMode,
					columnTrackPercentages: source.columnTrackPercentages.slice(),
					tableHeight: 0,
					blockHeight: 0,
				};
				let initialMetrics = measureRenderedTableFragmentMetrics(fragment, sandbox);
				fragment.tableHeight = initialMetrics.tableHeight;
				fragment.blockHeight = initialMetrics.blockHeight;

				while (rowIndex < rows.length) {
					let row = rows[rowIndex];
					let rowState = rowStates[rowIndex];
					let remainingHeight = Math.max(DEFAULT_MIN_SLICE_HEIGHT, fragmentLimit - fragment.blockHeight);
					let forceSliceCandidate = false;
					let fullFits = rowState.starts.every((value) => value === 0)
						&& row.fullHeight <= remainingHeight + 0.5;
					if (fullFits) {
						let fullRow = buildFullTableRowCandidate(row, rowState, host);
						fragment.rows.push(fullRow);
						rowStates[rowIndex].starts = fullRow.stateAfter.slice();
						let fullMetrics = measureRenderedTableFragmentMetrics(fragment, sandbox);
						if (fullMetrics.blockHeight <= fragmentLimit + 0.5) {
							fragment.tableHeight = fullMetrics.tableHeight;
							fragment.blockHeight = fullMetrics.blockHeight;
							rowIndex += 1;
							continue;
						}
						fragment.rows.pop();
						rowStates[rowIndex].starts = fullRow.stateBefore.slice();
						if (fragment.rows.length) {
							break;
						}
						forceSliceCandidate = true;
					}

					let candidate = buildTableSliceRowCandidate(row, rowState, remainingHeight, host, {
						forceSlice: forceSliceCandidate,
					});
					if (!candidate) {
						break;
					}
					fragment.rows.push(candidate);
					rowStates[rowIndex].starts = candidate.stateAfter.slice();
					let measured = measureRenderedTableFragmentMetrics(fragment, sandbox);
					let trimAttempts = 0;
					while (measured.blockHeight > fragmentLimit + 0.5 && fragment.rows.length && trimAttempts < 24) {
						let lastRow = fragment.rows.pop();
						if (!lastRow) {
							break;
						}
						rowStates[lastRow.sourceRow].starts = Array.isArray(lastRow.stateBefore)
							? lastRow.stateBefore.slice()
							: rowStates[lastRow.sourceRow].starts;
						let baseMetrics = measureRenderedTableFragmentMetrics(fragment, sandbox);
						measured = baseMetrics;
						if (lastRow.mode == "full" && fragment.rows.length) {
							trimAttempts += 1;
							continue;
						}
						let sourceRow = rows[lastRow.sourceRow];
						let rebuildBudget = Math.max(DEFAULT_MIN_SLICE_HEIGHT, fragmentLimit - baseMetrics.blockHeight - (trimAttempts + 1));
						let rebuilt = buildTableSliceRowCandidate(sourceRow, rowStates[lastRow.sourceRow], rebuildBudget, host, {
							forceSlice: true,
						});
						if (!rebuilt) {
							trimAttempts += 1;
							continue;
						}
						fragment.rows.push(rebuilt);
						rowStates[lastRow.sourceRow].starts = rebuilt.stateAfter.slice();
						measured = measureRenderedTableFragmentMetrics(fragment, sandbox);
						trimAttempts += 1;
					}
					if (measured.blockHeight > fragmentLimit + 0.5) {
						let rejected = fragment.rows.pop() || null;
						if (rejected?.sourceRow != null && Array.isArray(rejected.stateBefore)) {
							rowStates[rejected.sourceRow].starts = rejected.stateBefore.slice();
						}
						break;
					}
					fragment.tableHeight = measured.tableHeight;
					fragment.blockHeight = measured.blockHeight;
					let acceptedRow = fragment.rows[fragment.rows.length - 1] || null;
					if (!acceptedRow) {
						break;
					}
					rowStates[rowIndex].starts = Array.isArray(acceptedRow.stateAfter)
						? acceptedRow.stateAfter.slice()
						: rowStates[rowIndex].starts;
					if (acceptedRow.complete) {
						rowIndex += 1;
						continue;
					}
					break;
				}

				if (!fragment.rows.length && rows[rowIndex]) {
					let fallbackRow = rows[rowIndex];
					let fallbackBudget = Math.max(DEFAULT_MIN_SLICE_HEIGHT, fragmentLimit - fragment.blockHeight - 2);
					let fallback = buildTableSliceRowCandidate(fallbackRow, rowStates[rowIndex], fallbackBudget, host, {
						forceSlice: true,
					});
					if (fallback) {
						fragment.rows.push(fallback);
						rowStates[rowIndex].starts = fallback.stateAfter.slice();
						let fallbackMetrics = measureRenderedTableFragmentMetrics(fragment, sandbox);
						if (fallbackMetrics.blockHeight <= fragmentLimit + 0.5) {
							fragment.tableHeight = fallbackMetrics.tableHeight;
							fragment.blockHeight = fallbackMetrics.blockHeight;
							if (fallback.complete) {
								rowIndex += 1;
							}
						}
						else {
							fragment.rows.pop();
							rowStates[rowIndex].starts = Array.isArray(fallback.stateBefore)
								? fallback.stateBefore.slice()
								: rowStates[rowIndex].starts;
						}
					}
				}

				if (!fragment.rows.length) {
					if (fragmentIndex == 0 && !movedToFreshFirstPage && followingPageHeight > firstPageHeight + 0.5) {
						startOnNextPage = true;
						firstPageHeight = followingPageHeight;
						movedToFreshFirstPage = true;
						continue;
					}
					break;
				}

				fragments.push(fragment);
				fragmentIndex += 1;
			}

			if (!fragments.length) {
				let completion = tableFragmentPlanCompletionStatus(
					rows,
					rowStates,
					rowIndex,
					"The fragmentation engine did not produce any measured table fragments."
				);
				return {
					groupId: String(options?.groupId || ""),
					source,
					pageBodyBox,
					startOnNextPage,
					firstFragmentHeight: 0,
					firstFragmentTableHeight: 0,
					complete: completion.complete,
					sourceRowCount: completion.sourceRowCount,
					completedRowCount: completion.completedRowCount,
					incompleteReason: completion.incompleteReason,
					fragments: [],
				};
			}

			let last = fragments[fragments.length - 1];
			let lastLimit = last.first ? firstPageHeight : followingPageHeight;
			if (source.noteHTML) {
				last.includeNote = true;
				last.noteHTML = source.noteHTML || "";
				let lastMetrics = measureRenderedTableFragmentMetrics(last, sandbox);
				last.tableHeight = lastMetrics.tableHeight;
				last.blockHeight = lastMetrics.blockHeight;
				if ((source.noteHeight || 0) > 0 && last.rows.length && last.blockHeight > lastLimit + 0.5) {
					last.includeNote = false;
					last.noteHTML = "";
					let withoutNote = measureRenderedTableFragmentMetrics(last, sandbox);
					last.tableHeight = withoutNote.tableHeight;
					last.blockHeight = withoutNote.blockHeight;
					let noteFragment = {
						groupId: String(options?.groupId || ""),
						index: fragments.length,
						pageIndex: fragments.length,
						first: false,
						last: true,
						captionHTML: "",
						noteHTML: source.noteHTML || "",
						includeCaption: false,
						includeNote: true,
						includeHeader: false,
						headerCells: source.headerCells.map((cell) => Object.assign({}, cell)),
						rows: [],
						tableStyle: source.tableStyle,
						columnTrackMode: source.columnTrackMode,
						columnTrackPercentages: source.columnTrackPercentages.slice(),
						tableHeight: 0,
						blockHeight: 0,
					};
					let noteMetrics = measureRenderedTableFragmentMetrics(noteFragment, sandbox);
					noteFragment.tableHeight = noteMetrics.tableHeight;
					noteFragment.blockHeight = noteMetrics.blockHeight;
					fragments.push(noteFragment);
				}
			}
			else {
				let lastMetrics = measureRenderedTableFragmentMetrics(last, sandbox);
				last.tableHeight = lastMetrics.tableHeight;
				last.blockHeight = lastMetrics.blockHeight;
			}

			fragments.forEach((fragment, index) => {
				fragment.index = index;
				fragment.pageIndex = index;
				fragment.first = index == 0;
				fragment.last = index == fragments.length - 1;
				fragment.includeCaption = index == 0;
				if (index != 0) {
					fragment.captionHTML = "";
				}
				if (index != fragments.length - 1) {
					fragment.includeNote = false;
					fragment.noteHTML = "";
				}
			});

			let completion = tableFragmentPlanCompletionStatus(rows, rowStates, rowIndex);
			return {
				groupId: String(options?.groupId || ""),
				source,
				pageBodyBox,
				startOnNextPage,
				firstFragmentHeight: Number(fragments[0]?.blockHeight || 0) || 0,
				firstFragmentTableHeight: Number(fragments[0]?.tableHeight || 0) || 0,
				complete: completion.complete,
				sourceRowCount: completion.sourceRowCount,
				completedRowCount: completion.completedRowCount,
				incompleteReason: completion.incompleteReason,
				fragments,
			};
		}
		finally {
			destroyTableMeasureSandbox(sandbox);
		}
	}

	let api = {
		measurePageBodyUsableBox,
		buildRenderedTableFragmentPlan,
		renderTableFragmentNode,
	};

	if (typeof module != "undefined" && module.exports) {
		module.exports = api;
	}
	if (typeof globalThis != "undefined") {
		globalThis.SystematicReviewerTableFragmentation = api;
	}
	return api;
})();
