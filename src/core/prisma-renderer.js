var SystematicReviewerPrismaRenderer = (() => {
	const SVG_NS = "http://www.w3.org/2000/svg";
	const EMBEDDED_STYLES = [
		".mw-prisma-svg { overflow: visible; }",
		".mw-prisma-edge { stroke: #4b5563; stroke-width: 2; fill: none; }",
		".mw-prisma-node-label { fill: #1f1f1f; }",
		".mw-prisma-node-value { fill: #1f1f1f; font-weight: 700; }",
		".mw-prisma-phase-text { fill: #1f1f1f; font-weight: 700; }",
	].join("\n");

	let markerSequence = 0;
	let wrapContext = null;

	function resolveDocument(doc = null) {
		return doc
			|| globalThis.document
			|| null;
	}

	function createSVGNode(doc, tagName) {
		return doc.createElementNS(SVG_NS, tagName);
	}

	function measureContext(doc = null) {
		if (wrapContext) {
			return wrapContext;
		}
		let activeDocument = resolveDocument(doc);
		try {
			wrapContext = activeDocument?.createElement?.("canvas")?.getContext?.("2d") || null;
		}
		catch (_error) {
			wrapContext = null;
		}
		return wrapContext;
	}

	function wrapLines(text, fontSize, fontFamily, maxWidthPx = 180, doc = null) {
		let source = String(text || "");
		let lines = [];
		let chunks = source
			.split(/\n+/)
			.map((entry) => entry.trim())
			.filter(Boolean);
		let parts = chunks.length ? chunks : [source];
		let ctx2d = measureContext(doc);
		if (ctx2d) {
			ctx2d.font = `${fontSize}px ${fontFamily}`;
		}
		for (let part of parts) {
			let tokens = String(part || "").split(/\s+/).filter(Boolean);
			if (!tokens.length) {
				continue;
			}
			let current = tokens[0];
			for (let index = 1; index < tokens.length; index += 1) {
				let next = tokens[index];
				let candidate = `${current} ${next}`;
				let tooWide = false;
				if (ctx2d) {
					tooWide = ctx2d.measureText(candidate).width > maxWidthPx;
				}
				else {
					tooWide = candidate.length * Math.max(6, Number(fontSize || 14) * 0.58) > maxWidthPx;
				}
				if (!tooWide) {
					current = candidate;
					continue;
				}
				lines.push(current);
				current = next;
			}
			lines.push(current);
		}
		return lines;
	}

	function addEmbeddedStyles(svg, doc = null) {
		let activeDocument = resolveDocument(doc) || svg?.ownerDocument;
		if (!svg || !activeDocument) {
			return svg;
		}
		let existing = Array.from(svg?.childNodes || []).find((node) =>
			node?.nodeType == 1
			&& String(node.localName || "").toLowerCase() == "style"
			&& node.getAttribute?.("data-sr-prisma-embedded") == "true"
		) || null;
		if (existing) {
			existing.textContent = EMBEDDED_STYLES;
			return svg;
		}
		let style = createSVGNode(activeDocument, "style");
		style.setAttribute("data-sr-prisma-embedded", "true");
		style.textContent = EMBEDDED_STYLES;
		svg.insertBefore(style, svg.firstChild || null);
		return svg;
	}

	function drawPrismaPhases(doc, svg, canvasHeight, fontSize, fontFamily, cornerRadius) {
		const margin = 20;
		const gap = 20;
		const segment = Math.max(120, (canvasHeight - margin * 2 - gap * 2) / 3);
		[
			{ label: "Identification", y: margin, height: segment },
			{ label: "Screening", y: margin + segment + gap, height: segment },
			{ label: "Included", y: margin + (segment + gap) * 2, height: segment },
		].forEach((phase) => {
			const rect = createSVGNode(doc, "rect");
			rect.setAttribute("x", "24");
			rect.setAttribute("y", String(phase.y));
			rect.setAttribute("width", "30");
			rect.setAttribute("height", String(phase.height));
			rect.setAttribute("rx", String(cornerRadius));
			rect.setAttribute("fill", "#b0ccea");
			rect.setAttribute("stroke", "none");
			svg.appendChild(rect);

			const text = createSVGNode(doc, "text");
			text.setAttribute("x", "39");
			text.setAttribute("y", String(phase.y + phase.height / 2));
			text.setAttribute("transform", `rotate(-90 39 ${phase.y + phase.height / 2})`);
			text.setAttribute("text-anchor", "middle");
			text.setAttribute("class", "mw-prisma-phase-text");
			text.setAttribute("fill", "#1f1f1f");
			text.setAttribute("font-weight", "700");
			text.setAttribute("font-family", fontFamily);
			text.setAttribute("font-size", String(fontSize));
			text.textContent = phase.label;
			svg.appendChild(text);
		});
	}

	function clampReportScalePercent(value) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed)) {
			return 100;
		}
		return Math.max(50, Math.min(160, Math.round(parsed)));
	}

	function intrinsicCanvasSize(diagram, state = {}) {
		let width = Number(diagram?.canvas?.width || 1200) || 1200;
		let height = Number(diagram?.canvas?.height || 1400) || 1400;
		let fontSize = Number(state?.fontSize || 14) || 14;
		let baseScale = Math.max(1, fontSize / 14);
		return {
			width: width * baseScale,
			height: height * baseScale,
			baseWidth: width,
			baseHeight: height,
			baseScale,
		};
	}

	function resolveFitScale(intrinsicWidth = 1200, intrinsicHeight = 1400, fitBox = null) {
		if (!fitBox?.maxWidthPx && !fitBox?.maxHeightPx) {
			return 1;
		}
		let widthRatio = Number(fitBox?.maxWidthPx || intrinsicWidth) / Math.max(1, intrinsicWidth);
		let heightRatio = Number(fitBox?.maxHeightPx || intrinsicHeight) / Math.max(1, intrinsicHeight);
		let fitScale = Math.min(widthRatio, heightRatio);
		if (!Number.isFinite(fitScale) || fitScale <= 0) {
			return 1;
		}
		return Math.max(0.05, fitScale);
	}

	function resolveReportScalePercent(reportScalePercent = 100, fitScale = 1) {
		let normalizedPercent = clampReportScalePercent(reportScalePercent) / 100;
		let normalizedFit = Number(fitScale);
		if (!Number.isFinite(normalizedFit) || normalizedFit <= 0) {
			normalizedFit = 1;
		}
		return Math.max(0.05, normalizedFit * Math.min(1, normalizedPercent));
	}

	function computeReportFitBox(pageContext = {}, options = {}) {
		let marginInches = Number(options?.marginInches || 1);
		if (!Number.isFinite(marginInches) || marginInches < 0) {
			marginInches = 1;
		}
		let layout = String(pageContext?.layout || options?.layout || "portrait").toLowerCase() == "landscape"
			? "landscape"
			: "portrait";
		let pageWidthInches = layout == "landscape" ? (297 / 25.4) : (210 / 25.4);
		let pageHeightInches = layout == "landscape" ? (210 / 25.4) : (297 / 25.4);
		let reservedHeightPx = Number(options?.baseReservedHeightPx);
		if (!Number.isFinite(reservedHeightPx) || reservedHeightPx < 0) {
			reservedHeightPx = 120;
		}
		let leadingTextBlocks = (pageContext?.before || []).filter((block) => ["heading", "paragraph"].includes(block?.type));
		let trailingTextBlocks = (pageContext?.after || []).filter((block) => ["heading", "paragraph"].includes(block?.type));
		reservedHeightPx += Math.min(120, leadingTextBlocks.length * 36) + Math.min(120, trailingTextBlocks.length * 40);
		return {
			layout,
			maxWidthPx: Math.max(240, Math.round((pageWidthInches - marginInches * 2) * 96)),
			maxHeightPx: Math.max(220, Math.round((pageHeightInches - marginInches * 2) * 96 - reservedHeightPx)),
			reservedHeightPx,
		};
	}

	function resolveRenderedScale(state = {}, intrinsicWidth = 1200, intrinsicHeight = 1400, fitBox = null) {
		let fitScale = resolveFitScale(intrinsicWidth, intrinsicHeight, fitBox);
		let scale = resolveReportScalePercent(state?.reportScalePercent, fitScale);
		if (!Number.isFinite(scale) || scale <= 0) {
			return 1;
		}
		return Math.max(0.05, scale);
	}

	function buildSVG(diagram, state = {}, options = {}) {
		let doc = resolveDocument(options.doc);
		if (!doc) {
			throw new Error("A document is required to render the PRISMA diagram.");
		}
		if (!diagram?.nodes || !diagram?.edges) {
			return null;
		}
		let svg = createSVGNode(doc, "svg");
		let width = Number(diagram.canvas?.width || 1200) || 1200;
		let height = Number(diagram.canvas?.height || 1400) || 1400;
		let fontSize = Number(state?.fontSize || 14) || 14;
		let fontFamily = String(state?.fontFamily || '"Lato", "Helvetica Neue", Arial, sans-serif');
		let cornerRadius = Number(state?.cornerRadius ?? 8) || 0;
		let intrinsic = intrinsicCanvasSize(diagram, state);
		let renderedScale = options?.fitBox
			? resolveRenderedScale(state, intrinsic.width, intrinsic.height, options.fitBox)
			: 1;
		let arrowPad = 6;
		let markerPrefix = String(options.markerPrefix || `mw-prisma-${Date.now()}-${markerSequence += 1}`);
		let arrowID = `${markerPrefix}-arrow`;
		let arrowBoldID = `${markerPrefix}-arrow-bold`;

		svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
		svg.setAttribute("width", String(intrinsic.width * renderedScale));
		svg.setAttribute("height", String(intrinsic.height * renderedScale));
		svg.setAttribute("class", "mw-prisma-svg");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", "PRISMA flow diagram");
		svg.setAttribute("overflow", "visible");
		svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
		svg.setAttribute("data-sr-prisma-intrinsic-width", String(intrinsic.width));
		svg.setAttribute("data-sr-prisma-intrinsic-height", String(intrinsic.height));
		svg.setAttribute("data-sr-prisma-render-scale", String(renderedScale));

		let defs = createSVGNode(doc, "defs");
		let marker = createSVGNode(doc, "marker");
		marker.setAttribute("id", arrowID);
		marker.setAttribute("viewBox", "0 0 10 10");
		marker.setAttribute("refX", "5");
		marker.setAttribute("refY", "5");
		marker.setAttribute("markerWidth", "5");
		marker.setAttribute("markerHeight", "5");
		marker.setAttribute("orient", "auto-start-reverse");
		let markerPath = createSVGNode(doc, "path");
		markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
		markerPath.setAttribute("fill", "#4b5563");
		marker.appendChild(markerPath);
		defs.appendChild(marker);

		let markerBold = createSVGNode(doc, "marker");
		markerBold.setAttribute("id", arrowBoldID);
		markerBold.setAttribute("viewBox", "0 0 12 12");
		markerBold.setAttribute("refX", "6");
		markerBold.setAttribute("refY", "6");
		markerBold.setAttribute("markerWidth", "7");
		markerBold.setAttribute("markerHeight", "7");
		markerBold.setAttribute("orient", "auto-start-reverse");
		let markerBoldPath = createSVGNode(doc, "path");
		markerBoldPath.setAttribute("d", "M 0 0 L 12 6 L 0 12 z");
		markerBoldPath.setAttribute("fill", "#4b5563");
		markerBold.appendChild(markerBoldPath);
		defs.appendChild(markerBold);
		svg.appendChild(defs);

		drawPrismaPhases(doc, svg, height, fontSize, fontFamily, cornerRadius);

		let nodeMap = new Map((diagram.nodes || []).map((node) => [node.id, node]));

		function edgePath(from, to) {
			const fromMidX = from.x + from.width / 2;
			const toMidX = to.x + to.width / 2;
			const fromMidY = from.y + from.height / 2;
			const toMidY = to.y + to.height / 2;
			const fromBottom = from.y + from.height;
			const toTop = to.y;
			const fromRight = from.x + from.width;
			const fromLeft = from.x;
			const toLeft = to.x;
			const toRight = to.x + to.width;

			if (Math.abs(fromMidX - toMidX) < 8) {
				return `M ${fromMidX} ${fromBottom} L ${toMidX} ${toTop - arrowPad}`;
			}
			if (Math.abs(fromMidY - toMidY) < 8) {
				const movingRight = toMidX >= fromMidX;
				const startX = movingRight ? fromRight : fromLeft;
				const endX = movingRight ? toLeft - arrowPad : toRight + arrowPad;
				return `M ${startX} ${fromMidY} L ${endX} ${toMidY}`;
			}
			const movingRight = toMidX >= fromMidX;
			const startX = movingRight ? fromRight : fromLeft;
			const endX = movingRight ? toLeft - arrowPad : toRight + arrowPad;
			const elbowX = startX + (endX - startX) / 2;
			return `M ${startX} ${fromMidY} L ${elbowX} ${fromMidY} L ${elbowX} ${toMidY} L ${endX} ${toMidY}`;
		}

		function assessedToIncluded(fromId, toId, from, to) {
			if (toId !== "new_studies" || !String(fromId || "").includes("assessed")) {
				return null;
			}
			const fromMidX = from.x + from.width / 2;
			const fromBottom = from.y + from.height;
			const toRight = to.x + to.width;
			const toMidY = to.y + to.height / 2;
			if (fromId === "other_assessed") {
				return `M ${fromMidX} ${fromBottom} L ${fromMidX} ${toMidY} L ${toRight + arrowPad} ${toMidY}`;
			}
			return null;
		}

		(diagram.edges || []).forEach(([fromId, toId]) => {
			const from = nodeMap.get(fromId);
			const to = nodeMap.get(toId);
			if (!from || !to || from.render === false || to.render === false || !from.width || !from.height || !to.width || !to.height) {
				return;
			}
			const useBold = toId === "total_studies" || toId === "total_studies_ma" || toId === "new_studies";
			const path = createSVGNode(doc, "path");
			path.setAttribute("d", assessedToIncluded(fromId, toId, from, to) || edgePath(from, to));
			path.setAttribute("class", "mw-prisma-edge");
			path.setAttribute("fill", "none");
			path.setAttribute("stroke", "#4b5563");
			path.setAttribute("stroke-width", useBold ? "2.25" : "2");
			path.setAttribute("stroke-linecap", "square");
			path.setAttribute("stroke-linejoin", "miter");
			path.setAttribute("marker-end", useBold ? `url(#${arrowBoldID})` : `url(#${arrowID})`);
			svg.appendChild(path);
		});

		(diagram.nodes || []).forEach((node) => {
			if (node.render === false || !node.width || !node.height) {
				return;
			}
			const group = createSVGNode(doc, "g");
			group.dataset.nodeId = node.id;
			group.setAttribute("class", "mw-prisma-node");

			const rect = createSVGNode(doc, "rect");
			rect.setAttribute("x", String(node.x));
			rect.setAttribute("y", String(node.y));
			rect.setAttribute("width", String(node.width));
			rect.setAttribute("height", String(node.height));
			rect.setAttribute("rx", String(cornerRadius));
			rect.setAttribute("ry", String(cornerRadius));
			rect.setAttribute("fill", String(node.fill || "#ffffff"));
			rect.setAttribute("stroke", String(node.stroke || "#444444"));
			rect.setAttribute("stroke-width", "2");
			group.appendChild(rect);

			const labelLines = wrapLines(node.label || "", fontSize, fontFamily, node.width - 16, doc);
			const lineHeight = 15;
			const padding = 14;
			const reserveForValue = node.showValue !== false && node.value !== undefined ? lineHeight + 8 : 0;
			const availableLabelSpace = Math.max(node.height - reserveForValue - padding * 2, lineHeight);
			const totalHeight = labelLines.length * lineHeight;
			const startY = node.y + padding + Math.max(0, (availableLabelSpace - totalHeight) / 2) + lineHeight * 0.8;

			labelLines.forEach((line, index) => {
				const text = createSVGNode(doc, "text");
				text.setAttribute("x", String(node.x + node.width / 2));
				text.setAttribute("y", String(startY + index * lineHeight));
				text.setAttribute("text-anchor", "middle");
				text.setAttribute("class", "mw-prisma-node-label");
				text.setAttribute("fill", "#1f1f1f");
				text.setAttribute("font-family", fontFamily);
				text.setAttribute("font-size", String(fontSize));
				text.textContent = line;
				group.appendChild(text);
			});

			if (node.showValue !== false && node.value !== undefined) {
				const valueText = createSVGNode(doc, "text");
				valueText.setAttribute("x", String(node.x + node.width / 2));
				valueText.setAttribute("y", String(node.y + node.height - padding));
				valueText.setAttribute("text-anchor", "middle");
				valueText.setAttribute("class", "mw-prisma-node-value");
				valueText.setAttribute("fill", "#1f1f1f");
				valueText.setAttribute("font-weight", "700");
				valueText.setAttribute("font-family", fontFamily);
				valueText.setAttribute("font-size", String(fontSize));
				valueText.textContent = `(n = ${Number(node.value || 0) || 0})`;
				group.appendChild(valueText);
			}

			svg.appendChild(group);
		});

		if (typeof options.onEdit == "function") {
			svg.addEventListener("contextmenu", (event) => {
				let target = event.target?.closest?.("g");
				if (!target?.dataset?.nodeId) {
					return;
				}
				event.preventDefault();
				options.onEdit(target.dataset.nodeId);
			});
		}

		addEmbeddedStyles(svg, doc);
		return svg;
	}

	function drawDiagram(root, diagram, state = {}, onEdit = null) {
		if (!root) {
			return null;
		}
		let doc = resolveDocument(root.ownerDocument);
		root.replaceChildren();
		if (!diagram?.nodes || !diagram?.edges) {
			root.appendChild((doc || globalThis.document).createTextNode("No PRISMA diagram is available."));
			return null;
		}
		let svg = buildSVG(diagram, state, { doc, onEdit });
		if (!svg) {
			root.appendChild((doc || globalThis.document).createTextNode("No PRISMA diagram is available."));
			return null;
		}
		root.appendChild(svg);
		return svg;
	}

	function serializeSVG(svg, options = {}) {
		if (!svg) {
			return "";
		}
		let clone = svg.cloneNode(true);
		if (options.embedStyles !== false) {
			addEmbeddedStyles(clone, clone.ownerDocument || resolveDocument());
		}
		let serializerCtor = clone.ownerDocument?.defaultView?.XMLSerializer || globalThis.XMLSerializer;
		let serializer = serializerCtor ? new serializerCtor() : null;
		return serializer ? serializer.serializeToString(clone) : "";
	}

	function svgMarkup(diagram, state = {}, options = {}) {
		let svg = buildSVG(diagram, state, options);
		return serializeSVG(svg, options);
	}

	function svgDataURL(diagram, state = {}, options = {}) {
		let markup = svgMarkup(diagram, state, Object.assign({}, options, { embedStyles: true }));
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
	}

	async function pngDataURL(win, diagram, state = {}, options = {}) {
		if (!win?.document) {
			throw new Error("A window is required to export the PRISMA diagram.");
		}
		let sourceURL = svgDataURL(diagram, state, Object.assign({}, options, { doc: win.document }));
		let rasterScale = Number(options?.rasterScale || 2);
		if (!Number.isFinite(rasterScale) || rasterScale <= 0) {
			rasterScale = 2;
		}
		rasterScale = Math.max(1, Math.min(4, rasterScale));
		return await new Promise((resolve, reject) => {
			let image = new win.Image();
			image.onload = () => {
				try {
					let sourceWidth = Math.max(1, image.naturalWidth || image.width || 1);
					let sourceHeight = Math.max(1, image.naturalHeight || image.height || 1);
					let canvas = win.document.createElement("canvas");
					canvas.width = Math.max(1, Math.round(sourceWidth * rasterScale));
					canvas.height = Math.max(1, Math.round(sourceHeight * rasterScale));
					let context = canvas.getContext("2d");
					context.fillStyle = "#ffffff";
					context.fillRect(0, 0, canvas.width, canvas.height);
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					resolve(canvas.toDataURL("image/png"));
				}
				catch (error) {
					reject(error);
				}
			};
			image.onerror = () => reject(new Error("Failed to rasterize the PRISMA diagram."));
			image.src = sourceURL;
		});
	}

	function renderFigureHTML(diagram, state = {}, options = {}) {
		let doc = resolveDocument(options.doc);
		if (!doc) {
			throw new Error("A document is required to render the PRISMA diagram.");
		}
		let host = doc.createElement("div");
		let figure = doc.createElement("figure");
		figure.className = String(options.figureClass || "sr-prisma-figure");
		figure.setAttribute("data-sr-prisma", "true");
		figure.setAttribute("data-sr-prisma-border", state?.showOuterBorder ? "true" : "false");
		figure.setAttribute("data-sr-prisma-report-scale", String(clampReportScalePercent(state?.reportScalePercent)));
		if (!diagram?.nodes || !diagram?.edges) {
			let empty = doc.createElement("div");
			empty.className = "sr-prisma-empty";
			empty.setAttribute("data-sr-prisma", "true");
			empty.textContent = String(options.emptyText || "PRISMA diagram is not available.");
			figure.appendChild(empty);
		}
		else {
			let intrinsic = intrinsicCanvasSize(diagram, state);
			let requestedScale = resolveRenderedScale(state, intrinsic.width, intrinsic.height, options?.fitBox || null);
			figure.setAttribute("data-sr-prisma-width", String(intrinsic.width));
			figure.setAttribute("data-sr-prisma-height", String(intrinsic.height));
			figure.setAttribute("data-sr-prisma-scale", String(requestedScale));
			figure.style.width = `${Math.max(1, Math.round(intrinsic.width * requestedScale))}px`;
			figure.style.maxWidth = "100%";
			let svg = buildSVG(diagram, state, options);
			if (svg) {
				figure.appendChild(svg);
			}
		}
		host.appendChild(figure);
		return host.innerHTML;
	}

	return {
		SVG_NS,
		EMBEDDED_STYLES,
		wrapLines,
		buildSVG,
		drawDiagram,
		addEmbeddedStyles,
		serializeSVG,
		svgMarkup,
		svgDataURL,
		pngDataURL,
		computeReportFitBox,
		resolveFitScale,
		resolveReportScalePercent,
		renderFigureHTML,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerPrismaRenderer;
}
