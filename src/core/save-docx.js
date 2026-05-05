var SystematicReviewerSaveDOCX = (() => {
	const A4_PORTRAIT_TWIPS = { width: 11906, height: 16838 };
	const A4_LANDSCAPE_TWIPS = { width: 16838, height: 11906 };
	const DEFAULT_IMAGE_SIZE_PX = { width: 640, height: 360 };
	const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
	const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
	const CUSTOM_PROPS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
	const DOC_PROPS_VT_NS = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
	const ZOTERO_BOOKMARK_PREFIX = "ZOTERO_BREF_";
	const ZOTERO_FIELD_CODE_PREFIX = " ADDIN ZOTERO_";
	const ZOTERO_PREF_KEY = "ZOTERO_PREF";
	const CSL_CITATION_SCHEMA = "https://github.com/citation-style-language/schema/raw/master/csl-citation.json";
	const DOCX_TOC_FIELD_INSTRUCTION = 'TOC \\o "1-5" \\h \\z \\u';

	function escapeXML(value = "") {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;");
	}

	function xmlSafeHTMLFragment(html = "") {
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

	function sanitizeBookmarkName(value = "", fallback = "ZOTERO_CITATION") {
		let normalized = String(value || fallback)
			.replace(/[^A-Za-z0-9_]/g, "_")
			.replace(/^_+/, "");
		if (!normalized) {
			normalized = fallback;
		}
		if (!/^[A-Za-z]/.test(normalized)) {
			normalized = `Z${normalized}`;
		}
		return normalized.slice(0, 40);
	}

	function chunkString(value = "", size = 255) {
		let source = String(value ?? "");
		let output = [];
		for (let index = 0; index < source.length; index += size) {
			output.push(source.slice(index, index + size));
		}
		return output.length ? output : [""];
	}

	function inchesToTwips(value = 1) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed < 0) {
			parsed = 1;
		}
		return Math.round(parsed * 1440);
	}

	function pxToEmu(value = 0) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			parsed = 1;
		}
		return Math.round(parsed * 9525);
	}

	function normalizeDisplayWidthPercent(value = 100) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			parsed = 100;
		}
		return Math.max(10, Math.min(100, Math.round(parsed)));
	}

	function nextContentControlID(context) {
		let next = Number(context?.contentControlCounter || 1) || 1;
		if (context) {
			context.contentControlCounter = next + 1;
		}
		return 100000 + next;
	}

	function createTempDirectory(prefix = "systematic-reviewer-docx") {
		let dir = Services.dirsvc.get("TmpD", Ci.nsIFile);
		dir.append(`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
		dir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
		return dir.path;
	}

	function normalizeLocalPath(path = "") {
		let raw = String(path || "").trim();
		if (!raw) {
			return "";
		}
		if (
			(raw.startsWith('"') && raw.endsWith('"'))
			|| (raw.startsWith("'") && raw.endsWith("'"))
		) {
			raw = raw.slice(1, -1).trim();
		}
		if (/^file:/i.test(raw)) {
			try {
				return Services.io.newURI(raw).QueryInterface(Ci.nsIFileURL).file.path;
			}
			catch (_error) {}
		}
		if (/^\\\\\?\\UNC\\/i.test(raw)) {
			return `\\\\${raw.slice(8)}`;
		}
		if (/^\\\\\?\\[A-Za-z]:[\\/]/.test(raw)) {
			return raw.slice(4);
		}
		if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
			return raw.slice(1);
		}
		return raw;
	}

	function nsIFileFromPath(path = "") {
		let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
		file.initWithPath(normalizeLocalPath(path));
		return file;
	}

	function cleanupTempDirectory(path = "") {
		try {
			let dir = nsIFileFromPath(path);
			if (dir.exists()) {
				dir.remove(true);
			}
		}
		catch (_error) {}
	}

	function currentTimestampISO() {
		return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	}

	function escapeRegExp(value = "") {
		return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function extensionFromPath(path = "", fallback = "bin") {
		let match = String(path || "").trim().toLowerCase().match(/\.([a-z0-9]+)$/);
		return match ? match[1] : fallback;
	}

	function decodeDataURLToBytes(dataURL = "") {
		let source = String(dataURL || "").trim();
		let match = source.match(/^data:([^,]*?),(.*)$/i);
		if (!match) {
			throw new Error("Invalid data URL.");
		}
		let metadata = String(match[1] || "");
		let payload = String(match[2] || "");
		let isBase64 = /(?:^|;)base64(?:;|$)/i.test(metadata);
		let binary = isBase64
			? atob(payload)
			: decodeURIComponent(payload);
		let bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index) & 0xFF;
		}
		return bytes;
	}

	async function readBinaryFile(path = "") {
		if (typeof IOUtils != "undefined" && IOUtils?.read) {
			return await IOUtils.read(path);
		}
		let file = nsIFileFromPath(path);
		let input = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
		input.init(file, 0x01, 0o444, 0);
		let binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
		binary.setInputStream(input);
		let bytes = Uint8Array.from(binary.readByteArray(binary.available()));
		binary.close();
		input.close();
		return bytes;
	}

	function mediaContentType(extension = "") {
		switch (String(extension || "").toLowerCase()) {
			case "png":
				return "image/png";
			case "jpg":
			case "jpeg":
				return "image/jpeg";
			case "gif":
				return "image/gif";
			case "webp":
				return "image/webp";
			case "svg":
				return "image/svg+xml";
			default:
				return "application/octet-stream";
		}
	}

	function parseSVGDimensions(markup = "") {
		let source = String(markup || "");
		let widthMatch = source.match(/\bwidth="([0-9.]+)"/i);
		let heightMatch = source.match(/\bheight="([0-9.]+)"/i);
		if (widthMatch && heightMatch) {
			return {
				width: Math.max(1, Number(widthMatch[1]) || DEFAULT_IMAGE_SIZE_PX.width),
				height: Math.max(1, Number(heightMatch[1]) || DEFAULT_IMAGE_SIZE_PX.height),
			};
		}
		let viewBoxMatch = source.match(/\bviewBox="([0-9.\s-]+)"/i);
		if (viewBoxMatch) {
			let parts = String(viewBoxMatch[1] || "")
				.trim()
				.split(/\s+/)
				.map((value) => Number(value));
			if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
				return {
					width: Math.max(1, parts[2]),
					height: Math.max(1, parts[3]),
				};
			}
		}
		return Object.assign({}, DEFAULT_IMAGE_SIZE_PX);
	}

	function normalizeLayout(layout = "portrait") {
		return String(layout || "").toLowerCase() == "landscape" ? "landscape" : "portrait";
	}

	function pageSizeForLayout(layout = "portrait") {
		return normalizeLayout(layout) == "landscape" ? A4_LANDSCAPE_TWIPS : A4_PORTRAIT_TWIPS;
	}

	function sectionPropertiesXML(layout = "portrait", marginInches = 1, options = {}) {
		let pageSize = pageSizeForLayout(layout);
		let marginTwips = inchesToTwips(marginInches);
		let typeXML = options?.type
			? `<w:type w:val="${escapeXML(options.type)}"/>`
			: "";
		let orientXML = normalizeLayout(layout) == "landscape" ? ` w:orient="landscape"` : "";
		return `<w:sectPr>${typeXML}<w:pgSz w:w="${pageSize.width}" w:h="${pageSize.height}"${orientXML}/><w:pgMar w:top="${marginTwips}" w:right="${marginTwips}" w:bottom="${marginTwips}" w:left="${marginTwips}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
	}

	function paragraphXML(children = "", options = {}) {
		let pPr = [];
		if (options.styleID) {
			pPr.push(`<w:pStyle w:val="${escapeXML(options.styleID)}"/>`);
		}
		if (options.align) {
			pPr.push(`<w:jc w:val="${escapeXML(options.align)}"/>`);
		}
		if (Number.isFinite(options.indentLeftTwips) || Number.isFinite(options.hangingTwips) || Number.isFinite(options.firstLineTwips)) {
			let attrs = [];
			if (Number.isFinite(options.indentLeftTwips)) {
				attrs.push(` w:left="${Math.round(options.indentLeftTwips)}"`);
			}
			if (Number.isFinite(options.hangingTwips)) {
				attrs.push(` w:hanging="${Math.round(options.hangingTwips)}"`);
			}
			if (Number.isFinite(options.firstLineTwips)) {
				attrs.push(` w:firstLine="${Math.round(options.firstLineTwips)}"`);
			}
			pPr.push(`<w:ind${attrs.join("")}/>`);
		}
		if (options.keepNext) {
			pPr.push("<w:keepNext/>");
		}
		if (options.keepLines) {
			pPr.push("<w:keepLines/>");
		}
		if (options.pageBreakBefore) {
			pPr.push("<w:pageBreakBefore/>");
		}
		if (options.spacingAfterTwips || options.spacingBeforeTwips) {
			let after = Number.isFinite(options.spacingAfterTwips) ? Math.round(options.spacingAfterTwips) : 0;
			let before = Number.isFinite(options.spacingBeforeTwips) ? Math.round(options.spacingBeforeTwips) : 0;
			pPr.push(`<w:spacing w:before="${before}" w:after="${after}"/>`);
		}
		if (options.sectionXML) {
			pPr.push(options.sectionXML);
		}
		let resolvedChildren = String(children || "") || "<w:r/>";
		return `<w:p>${pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}${resolvedChildren}</w:p>`;
	}

	function assertWellFormedXML(context, xmlText = "", label = "XML part") {
		let parser = context?.parser || (context?.doc?.defaultView?.DOMParser ? new context.doc.defaultView.DOMParser() : new DOMParser());
		let parsed = parser.parseFromString(String(xmlText || ""), "application/xml");
		if (parsed?.querySelector?.("parsererror")) {
			let errorText = parsed.querySelector("parsererror")?.textContent || `Malformed XML in ${label}.`;
			throw new Error(`${label} is not well-formed XML: ${errorText}`.trim());
		}
		return parsed;
	}

	function validateDocxPackageModel(context, packageParts = {}) {
		let requiredParts = [
			"[Content_Types].xml",
			"_rels/.rels",
			"word/document.xml",
			"word/styles.xml",
			"word/settings.xml",
			"word/_rels/document.xml.rels",
			"docProps/core.xml",
			"docProps/app.xml",
		];
		if (context.citationMode == "linked") {
			requiredParts.push("docProps/custom.xml");
		}
		for (let path of requiredParts) {
			let xmlText = packageParts[path];
			if (!String(xmlText || "").trim()) {
				throw new Error(`DOCX package is missing required part ${path}.`);
			}
			assertWellFormedXML(context, xmlText, path);
		}
		let contentTypes = String(packageParts["[Content_Types].xml"] || "");
		let requiredOverrides = [
			"/word/document.xml",
			"/word/styles.xml",
			"/word/settings.xml",
			"/docProps/core.xml",
			"/docProps/app.xml",
		];
		if (context.citationMode == "linked") {
			requiredOverrides.push("/docProps/custom.xml");
		}
		for (let partName of requiredOverrides) {
			if (!new RegExp(`<Override\\b[^>]*PartName="${escapeRegExp(partName)}"`, "i").test(contentTypes)) {
				throw new Error(`[Content_Types].xml is missing an Override for ${partName}.`);
			}
		}
		if (!/<Default\b[^>]*Extension="rels"[^>]*ContentType="application\/vnd\.openxmlformats-package\.relationships\+xml"/i.test(contentTypes)) {
			throw new Error("[Content_Types].xml is missing the relationships content-type default.");
		}
		if (!/<Default\b[^>]*Extension="xml"[^>]*ContentType="application\/xml"/i.test(contentTypes)) {
			throw new Error("[Content_Types].xml is missing the XML content-type default.");
		}
		for (let mediaPart of Array.from(context.mediaParts || [])) {
			let extension = String(mediaPart?.extension || "").trim();
			let contentType = String(mediaPart?.contentType || "").trim();
			if (!extension || !contentType) {
				continue;
			}
			let mediaPattern = new RegExp(`<Default\\b[^>]*Extension="${escapeRegExp(extension)}"[^>]*ContentType="${escapeRegExp(contentType)}"`, "i");
			if (!mediaPattern.test(contentTypes)) {
				throw new Error(`[Content_Types].xml is missing the media default for .${extension}.`);
			}
		}
		let rootRelationships = String(packageParts["_rels/.rels"] || "");
		if (!/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument"[^>]*Target="word\/document\.xml"/i.test(rootRelationships)) {
			throw new Error("DOCX package root relationships are missing the officeDocument relationship to word/document.xml.");
		}
		let documentRelationships = String(packageParts["word/_rels/document.xml.rels"] || "");
		if (!/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/styles"[^>]*Target="styles\.xml"/i.test(documentRelationships)) {
			throw new Error("word/_rels/document.xml.rels is missing the styles relationship.");
		}
		if (!/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/settings"[^>]*Target="settings\.xml"/i.test(documentRelationships)) {
			throw new Error("word/_rels/document.xml.rels is missing the settings relationship.");
		}
		for (let mediaPart of Array.from(context.mediaParts || [])) {
			let target = String(mediaPart?.target || "").trim();
			if (!target) {
				continue;
			}
			let relPattern = new RegExp(`Type="http://schemas\\.openxmlformats\\.org/officeDocument/2006/relationships/image"[^>]*Target="${escapeRegExp(target)}"`, "i");
			if (!relPattern.test(documentRelationships)) {
				throw new Error(`word/_rels/document.xml.rels is missing the image relationship for ${target}.`);
			}
		}
		let documentBody = String(packageParts["word/document.xml"] || "");
		let stylesBody = String(packageParts["word/styles.xml"] || "");
		if (!/<w:document\b[\s\S]*?<w:body>[\s\S]*<\/w:body>[\s\S]*<\/w:document>/i.test(documentBody)) {
			throw new Error("word/document.xml does not contain a valid w:document/w:body structure.");
		}
		if (!/<w:style\b[^>]*w:styleId="Title"/i.test(stylesBody)) {
			throw new Error("word/styles.xml is missing the Title style used for Markdown H1.");
		}
		let titleStyleMatch = stylesBody.match(/<w:style\b[^>]*w:styleId="Title"[\s\S]*?<\/w:style>/i);
		if (titleStyleMatch && /<w:outlineLvl\b/i.test(titleStyleMatch[0])) {
			throw new Error("word/styles.xml Title style must not be an outline heading.");
		}
		for (let level = 1; level <= 6; level += 1) {
			let headingPattern = new RegExp(`<w:style\\b[^>]*w:styleId="Heading${level}"[\\s\\S]*?<w:outlineLvl\\b[^>]*w:val="${level - 1}"\\s*/>[\\s\\S]*?</w:style>`, "i");
			if (!headingPattern.test(stylesBody)) {
				throw new Error(`word/styles.xml is missing outline metadata for Heading${level}.`);
			}
		}
		if (String(context.markdown || "").includes(SystematicReviewerNativeMarkdown.TOC_PLACEHOLDER_MARKDOWN)) {
			if (!/<w:style\b[^>]*w:styleId="TOCHeading"/i.test(stylesBody) || !/<w:style\b[^>]*w:styleId="TOC1"/i.test(stylesBody)) {
				throw new Error("word/styles.xml is missing native TOC styles.");
			}
			if (!/<w:sdt>\s*<w:sdtPr>[\s\S]*?<w:docPartGallery w:val="Table of Contents"\/>[\s\S]*?<w:sdtContent>/i.test(documentBody)) {
				throw new Error("word/document.xml is missing the native TOC content-control wrapper.");
			}
			let tocInstructionPattern = escapeRegExp(DOCX_TOC_FIELD_INSTRUCTION);
			let tocFieldMatch = documentBody.match(new RegExp(`<w:fldChar\\b[^>]*w:fldCharType="begin"[\\s\\S]*?<w:instrText\\b[^>]*>\\s*${tocInstructionPattern}\\s*<\\/w:instrText>[\\s\\S]*?<w:fldChar\\b[^>]*w:fldCharType="separate"[\\s\\S]*?<w:fldChar\\b[^>]*w:fldCharType="end"`, "i"));
			if (!tocFieldMatch) {
				throw new Error("word/document.xml is missing a valid native TOC field run sequence.");
			}
			let tocFieldCount = (documentBody.match(new RegExp(tocInstructionPattern, "g")) || []).length;
			if (tocFieldCount != 1) {
				throw new Error(`word/document.xml must contain exactly one native TOC field; found ${tocFieldCount}.`);
			}
		}
		let settingsXMLText = String(packageParts["word/settings.xml"] || "");
		if (!/<w:updateFields\b[^>]*w:val="true"\s*\/>/i.test(settingsXMLText)) {
			throw new Error("word/settings.xml is missing w:updateFields.");
		}
	}

	function runPropertiesXML(options = {}) {
		let parts = [];
		if (options.bold) {
			parts.push("<w:b/>");
		}
		if (options.italic) {
			parts.push("<w:i/>");
		}
		if (options.underline) {
			parts.push('<w:u w:val="single"/>');
		}
		if (options.color) {
			parts.push(`<w:color w:val="${escapeXML(options.color)}"/>`);
		}
		if (parts.length) {
			return `<w:rPr>${parts.join("")}</w:rPr>`;
		}
		return "";
	}

	function textRunsXML(text = "", options = {}) {
		let source = String(text ?? "");
		if (!source.length) {
			return [`<w:r>${runPropertiesXML(options)}<w:t></w:t></w:r>`];
		}
		let parts = [];
		let segments = source.split(/\n/);
		segments.forEach((segment, index) => {
			if (segment.length) {
				let preserve = /^[\s]|[\s]$/.test(segment) || /\s{2,}/.test(segment);
				parts.push(`<w:r>${runPropertiesXML(options)}<w:t${preserve ? ' xml:space="preserve"' : ""}>${escapeXML(segment)}</w:t></w:r>`);
			}
			if (index < segments.length - 1) {
				parts.push(`<w:r>${runPropertiesXML(options)}<w:br/></w:r>`);
			}
		});
		return parts;
	}

	function createRelationshipRegistry() {
		return {
			nextID: 1,
			entries: [],
			add(type, target, targetMode = "") {
				let id = `rId${this.nextID++}`;
				this.entries.push({ id, type, target, targetMode });
				return id;
			},
			xml() {
				return [
					`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
					`<Relationships xmlns="${REL_NS}">`,
					...this.entries.map((entry) => `<Relationship Id="${entry.id}" Type="${escapeXML(entry.type)}" Target="${escapeXML(entry.target)}"${entry.targetMode ? ` TargetMode="${escapeXML(entry.targetMode)}"` : ""}/>`),
					"</Relationships>",
				].join("");
			},
		};
	}

	function createDocxContext({ reviewer, current, win, markdown, outputPath, settings, controller, citationMode = "linked", title = "REPORT" } = {}) {
		let rootPath = createTempDirectory();
		let reportDir = reviewer?._parentPath?.(String(current?.context?.reportPath || "")) || String(current?.context?.projectRoot || "");
		let documentRels = createRelationshipRegistry();
		documentRels.add(
			"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
			"styles.xml"
		);
		documentRels.add(
			"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
			"settings.xml"
		);
		let doc = win?.document || null;
		let parser = doc?.defaultView?.DOMParser ? new doc.defaultView.DOMParser() : new DOMParser();
		return {
			reviewer,
			current,
			win,
			doc,
			parser,
			markdown: String(markdown || ""),
			outputPath: String(outputPath || ""),
			settings: settings || {},
			controller,
			citationMode: String(citationMode || "linked").toLowerCase() == "unlinked" ? "unlinked" : "linked",
			title: String(title || "REPORT"),
			rootPath,
			reportDir,
			documentRels,
			mediaParts: [],
			bookmarkCounter: 1,
			citationMetadata: [],
			bibliographyMetadata: null,
			outline: null,
			drawingCounter: 1,
			contentControlCounter: 1,
			hyperlinkByHref: new Map(),
			zoteroSessionID: Zotero.Utilities?.randomString ? Zotero.Utilities.randomString() : `sr-${Date.now()}`,
		};
	}

	function resolveWorkspaceAssetPath(context, assetSource = "") {
		let source = String(assetSource || "").trim();
		if (!source) {
			return "";
		}
		let reviewer = context.reviewer;
		let normalizedSource = reviewer?._normalizeLocalPath
			? reviewer._normalizeLocalPath(source)
			: source;
		if (!normalizedSource) {
			return "";
		}
		if (/^data:/i.test(source) || /^\/\//.test(source)) {
			return "";
		}
		let candidates = [];
		if (reviewer?._isAbsolutePath?.(normalizedSource)) {
			candidates.push(normalizedSource);
		}
		else if (/^[a-z]+:/i.test(source)) {
			return "";
		}
		if (context.reportDir) {
			candidates.push(reviewer._joinPath(context.reportDir, normalizedSource));
		}
		if (context.current?.context?.projectRoot) {
			candidates.push(reviewer._joinPath(context.current.context.projectRoot, normalizedSource));
		}
		for (let candidate of candidates) {
			try {
				if (!candidate) {
					continue;
				}
				let file = nsIFileFromPath(candidate);
				if (file.exists()) {
					return candidate;
				}
			}
			catch (_error) {}
		}
		return "";
	}

	async function registerMediaPart(context, payload = {}) {
		let extension = String(payload.extension || "bin").replace(/^\./, "").toLowerCase();
		let mediaName = `${String(payload.baseName || "media")}-${context.mediaParts.length + 1}.${extension}`;
		let relativeTarget = `media/${mediaName}`;
		let absolutePath = context.reviewer._joinPath(context.rootPath, "word", relativeTarget);
		if (payload.bytes) {
			await context.reviewer._writeBinaryFile(absolutePath, payload.bytes);
		}
		else if (payload.text !== undefined) {
			await context.reviewer._writeTextFile(absolutePath, String(payload.text || ""));
		}
		else if (payload.sourcePath) {
			let bytes = await readBinaryFile(payload.sourcePath);
			await context.reviewer._writeBinaryFile(absolutePath, bytes);
		}
		let relID = context.documentRels.add(
			"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
			relativeTarget
		);
		let part = {
			relID,
			fileName: mediaName,
			target: relativeTarget,
			extension,
			contentType: mediaContentType(extension),
			widthPx: Math.max(1, Number(payload.widthPx || DEFAULT_IMAGE_SIZE_PX.width) || DEFAULT_IMAGE_SIZE_PX.width),
			heightPx: Math.max(1, Number(payload.heightPx || DEFAULT_IMAGE_SIZE_PX.height) || DEFAULT_IMAGE_SIZE_PX.height),
		};
		context.mediaParts.push(part);
		return part;
	}

	async function registerImageAsset(context, assetSource = "", options = {}) {
		let sourcePath = resolveWorkspaceAssetPath(context, assetSource);
		if (!sourcePath) {
			return null;
		}
		let extension = extensionFromPath(sourcePath, "png");
		return await registerMediaPart(context, {
			sourcePath,
			extension,
			baseName: options.baseName || "image",
			widthPx: options.widthPx || DEFAULT_IMAGE_SIZE_PX.width,
			heightPx: options.heightPx || DEFAULT_IMAGE_SIZE_PX.height,
		});
	}

	async function registerPrismaSVG(context, markup = "", options = {}) {
		let dimensions = parseSVGDimensions(markup);
		return await registerMediaPart(context, {
			text: String(markup || ""),
			extension: "svg",
			baseName: options.baseName || "prisma",
			widthPx: dimensions.width,
			heightPx: dimensions.height,
		});
	}

	async function registerPrismaPNG(context, markup = "", options = {}) {
		let dimensions = parseSVGDimensions(markup);
		let dataURL = await SystematicReviewerPrismaRenderer.pngDataURL(
			context.win,
			options.diagram,
			options.state || {},
			options.renderOptions || {}
		);
		return await registerMediaPart(context, {
			bytes: decodeDataURLToBytes(dataURL),
			extension: "png",
			baseName: options.baseName || "prisma",
			widthPx: dimensions.width,
			heightPx: dimensions.height,
		});
	}

	function collectPackageFiles(rootPath = "") {
		let root = nsIFileFromPath(rootPath);
		let output = [];
		function walk(current, relativeBase = "") {
			let entries = current.directoryEntries;
			while (entries.hasMoreElements()) {
				let entry = entries.getNext().QueryInterface(Ci.nsIFile);
				let relativePath = relativeBase ? `${relativeBase}/${entry.leafName}` : entry.leafName;
				if (entry.isDirectory()) {
					walk(entry, relativePath);
					continue;
				}
				output.push({
					path: entry.path,
					relativePath,
				});
			}
		}
		walk(root, "");
		return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
	}

	async function packageDOCX(rootPath = "", outputPath = "") {
		let zipWriter = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
		let outputFile = nsIFileFromPath(outputPath);
		let mode = 0x04 | 0x08 | 0x20;
		zipWriter.open(outputFile, mode);
		try {
			for (let entry of collectPackageFiles(rootPath)) {
				let sourceFile = nsIFileFromPath(entry.path);
				zipWriter.addEntryFile(entry.relativePath, Ci.nsIZipWriter.COMPRESSION_DEFAULT, sourceFile, false);
			}
		}
		finally {
			zipWriter.close();
		}
		try {
			let file = nsIFileFromPath(outputPath);
			return file.exists() && file.fileSize > 0;
		}
		catch (_error) {
			return false;
		}
	}

	function drawingXML(context, mediaPart, options = {}) {
		let maxWidthPx = Number(options.maxWidthPx || mediaPart.widthPx || DEFAULT_IMAGE_SIZE_PX.width) || DEFAULT_IMAGE_SIZE_PX.width;
		let maxHeightPx = Number(options.maxHeightPx || mediaPart.heightPx || DEFAULT_IMAGE_SIZE_PX.height) || DEFAULT_IMAGE_SIZE_PX.height;
		let widthPx = mediaPart.widthPx || DEFAULT_IMAGE_SIZE_PX.width;
		let heightPx = mediaPart.heightPx || DEFAULT_IMAGE_SIZE_PX.height;
		let scale = Math.min(maxWidthPx / Math.max(1, widthPx), maxHeightPx / Math.max(1, heightPx), 1);
		if (!Number.isFinite(scale) || scale <= 0) {
			scale = 1;
		}
		let cx = pxToEmu(widthPx * scale);
		let cy = pxToEmu(heightPx * scale);
		let drawingID = context.drawingCounter++;
		let name = escapeXML(options.name || `Image ${drawingID}`);
		return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingID}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingID}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${mediaPart.relID}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
	}

	function hyperlinkRelID(context, href = "") {
		let normalized = String(href || "").trim();
		if (!normalized) {
			return "";
		}
		if (!context.hyperlinkByHref.has(normalized)) {
			context.hyperlinkByHref.set(normalized, context.documentRels.add(
				"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
				normalized,
				"External"
			));
		}
		return context.hyperlinkByHref.get(normalized) || "";
	}

	function citationVisibleText(context, citation = {}, fallbackLabel = "cite") {
		try {
			return String(context.reviewer._formatCitationText(context.controller, citation, fallbackLabel) || fallbackLabel || "cite").trim();
		}
		catch (_error) {
			return String(fallbackLabel || "cite");
		}
	}

	function lookupCitationItem(context, key = "") {
		let normalizedKey = String(key || "").trim();
		if (!normalizedKey) {
			return null;
		}
		try {
			if (typeof SystematicReviewerCitations != "undefined" && typeof SystematicReviewerCitations._lookupCitationItem == "function") {
				let item = SystematicReviewerCitations._lookupCitationItem(context.controller, normalizedKey);
				if (item && !item.deleted) {
					return item;
				}
			}
		}
		catch (_error) {}
		try {
			let libraryID = context.current?.bootstrap?.current_project?.zotero?.library_id
				|| context.controller?.bootstrap?.current_project?.zotero?.library_id
				|| null;
			if (libraryID) {
				let item = Zotero.Items.getByLibraryAndKey(libraryID, normalizedKey);
				if (item && !item.deleted) {
					return item;
				}
			}
		}
		catch (_error) {}
		return null;
	}

	function zoteroDocumentDataJSON(context) {
		return JSON.stringify({
			style: {
				styleID: context.settings?.citationStyleID || "http://www.zotero.org/styles/apa",
				locale: context.settings?.citationLocale || Zotero.locale || "",
				hasBibliography: String(context.markdown || "").includes(SystematicReviewerNativeMarkdown.BIBLIOGRAPHY_PLACEHOLDER_MARKDOWN),
				bibliographyStyleHasBeenSet: false,
			},
			prefs: {
				fieldType: "Bookmark",
				noteType: 0,
				automaticJournalAbbreviations: false,
				delayCitationUpdates: false,
			},
			sessionID: context.zoteroSessionID,
			zoteroVersion: Zotero.version,
			dataVersion: 4,
		});
	}

	function zoteroBookmarkName(context) {
		let bookmarkID = context.bookmarkCounter++;
		let bookmarkName = sanitizeBookmarkName(`${ZOTERO_BOOKMARK_PREFIX}${bookmarkID}`, `${ZOTERO_BOOKMARK_PREFIX}1`);
		return { bookmarkID, bookmarkName };
	}

	function citationItemJSON(context, key = "", extras = {}) {
		let item = lookupCitationItem(context, key);
		if (item) {
			let itemData = null;
			try {
				itemData = Zotero.Utilities.Item.itemToCSLJSON(item);
			}
			catch (_error) {}
			return Object.assign({
				id: item.id,
				uris: [Zotero.URI?.getItemURI ? Zotero.URI.getItemURI(item) : ""].filter(Boolean),
				itemData: itemData || { id: item.id, title: item.getDisplayTitle?.() || key || "Untitled" },
			}, extras);
		}
		return Object.assign({
			id: String(key || ""),
			uris: [],
			itemData: {
				id: String(key || ""),
				title: String(key || "Untitled"),
			},
		}, extras);
	}

	function zoteroCitationCode(context, citation = {}, visibleText = "cite") {
		let keys = Array.isArray(citation.keys) ? citation.keys : [];
		let citationItems = keys
			.map((key, index) => {
				let extras = {};
				if (index == 0 && citation.prefix) {
					extras.prefix = String(citation.prefix || "");
				}
				if (index == keys.length - 1 && citation.locator) {
					extras.locator = String(citation.locator || "");
					extras.label = "page";
				}
				if (index == keys.length - 1 && citation.suffix) {
					extras.suffix = String(citation.suffix || "");
				}
				return citationItemJSON(context, key, extras);
			})
			.filter(Boolean);
		let payload = {
			citationID: Zotero.Utilities?.randomString ? Zotero.Utilities.randomString() : `sr-citation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			properties: {
				formattedCitation: String(visibleText || "cite"),
				plainCitation: String(visibleText || "cite"),
				noteIndex: 0,
			},
			citationItems,
			schema: CSL_CITATION_SCHEMA,
		};
		return `ITEM CSL_CITATION ${JSON.stringify(payload)}`;
	}

	function zoteroBibliographyCode() {
		return `BIBL ${JSON.stringify({
			uncited: [],
			omitted: [],
			custom: [],
		})} CSL_BIBLIOGRAPHY`;
	}

	function insertBookmarkStartInParagraph(paragraphXMLText = "", bookmarkID = 1, bookmarkName = "") {
		let paragraph = String(paragraphXMLText || "");
		let marker = `<w:bookmarkStart w:id="${bookmarkID}" w:name="${escapeXML(bookmarkName)}"/>`;
		if (!paragraph.includes("<w:p")) {
			return paragraph;
		}
		let pPrCloseIndex = paragraph.indexOf("</w:pPr>");
		if (pPrCloseIndex >= 0) {
			let insertAt = pPrCloseIndex + "</w:pPr>".length;
			return `${paragraph.slice(0, insertAt)}${marker}${paragraph.slice(insertAt)}`;
		}
		return paragraph.replace("<w:p>", `<w:p>${marker}`);
	}

	function insertBookmarkEndInParagraph(paragraphXMLText = "", bookmarkID = 1) {
		let paragraph = String(paragraphXMLText || "");
		if (!paragraph.includes("</w:p>")) {
			return paragraph;
		}
		return paragraph.replace("</w:p>", `<w:bookmarkEnd w:id="${bookmarkID}"/></w:p>`);
	}

	function wrapParagraphsWithBookmark(paragraphs = [], bookmarkID = 1, bookmarkName = "") {
		if (!paragraphs.length) {
			return paragraphs;
		}
		let output = paragraphs.slice();
		output[0] = insertBookmarkStartInParagraph(output[0], bookmarkID, bookmarkName);
		let lastIndex = output.length - 1;
		output[lastIndex] = insertBookmarkEndInParagraph(output[lastIndex], bookmarkID);
		return output;
	}

	function customPropertiesXML(context) {
		let properties = [];
		let pid = 2;
		let pushChunked = (baseName, value) => {
			let chunks = chunkString(value, 255);
			chunks.forEach((chunk, index) => {
				properties.push(
					`<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid++}" name="${escapeXML(`${baseName}_${index + 1}`)}"><vt:lpwstr>${escapeXML(chunk)}</vt:lpwstr></property>`
				);
			});
		};
		pushChunked(ZOTERO_PREF_KEY, zoteroDocumentDataJSON(context));
		for (let entry of context.citationMetadata || []) {
			if (!entry?.bookmarkName || !entry?.fieldCode) {
				continue;
			}
			pushChunked(entry.bookmarkName, `${ZOTERO_FIELD_CODE_PREFIX}${entry.fieldCode} `);
		}
		if (context.bibliographyMetadata?.bookmarkName && context.bibliographyMetadata?.fieldCode) {
			pushChunked(context.bibliographyMetadata.bookmarkName, `${ZOTERO_FIELD_CODE_PREFIX}${context.bibliographyMetadata.fieldCode} `);
		}
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<Properties xmlns="${CUSTOM_PROPS_NS}" xmlns:vt="${DOC_PROPS_VT_NS}">`,
			...properties,
			`</Properties>`,
		].join("");
	}

	function renderHTMLNodesToRuns(context, nodes = [], format = {}) {
		let parts = [];
		for (let node of Array.from(nodes || [])) {
			if (!node) {
				continue;
			}
			if (node.nodeType == 3) {
				parts.push(...textRunsXML(node.nodeValue || "", format));
				continue;
			}
			if (node.nodeType != 1) {
				continue;
			}
			let tag = String(node.tagName || "").toLowerCase();
			if (tag == "br") {
				parts.push(`<w:r>${runPropertiesXML(format)}<w:br/></w:r>`);
				continue;
			}
			if (node.hasAttribute("data-sr-docx-citation")) {
				let raw = node.getAttribute("data-sr-docx-citation") || "";
				let citation = {};
				try {
					citation = JSON.parse(decodeURIComponent(raw));
				}
				catch (_error) {}
				let visibleText = citationVisibleText(context, citation, node.textContent || "cite");
				if (context.citationMode == "linked") {
					let { bookmarkID, bookmarkName } = zoteroBookmarkName(context);
					let fieldCode = zoteroCitationCode(context, citation, visibleText);
					context.citationMetadata.push({
						bookmarkName,
						bookmarkID,
						fieldCode,
						citation,
						text: visibleText,
					});
					parts.push(`<w:bookmarkStart w:id="${bookmarkID}" w:name="${bookmarkName}"/>`);
					parts.push(...textRunsXML(visibleText, format));
					parts.push(`<w:bookmarkEnd w:id="${bookmarkID}"/>`);
				}
				else {
					parts.push(...textRunsXML(visibleText, format));
				}
				continue;
			}
			if (tag == "strong" || tag == "b") {
				parts.push(...renderHTMLNodesToRuns(context, node.childNodes, Object.assign({}, format, { bold: true })));
				continue;
			}
			if (tag == "em" || tag == "i") {
				parts.push(...renderHTMLNodesToRuns(context, node.childNodes, Object.assign({}, format, { italic: true })));
				continue;
			}
			if (tag == "u") {
				parts.push(...renderHTMLNodesToRuns(context, node.childNodes, Object.assign({}, format, { underline: true })));
				continue;
			}
			if (tag == "code") {
				parts.push(...renderHTMLNodesToRuns(context, node.childNodes, Object.assign({}, format, { code: true })));
				continue;
			}
			if (tag == "a") {
				let relID = hyperlinkRelID(context, node.getAttribute("href") || "");
				let inner = renderHTMLNodesToRuns(context, node.childNodes, Object.assign({}, format, { underline: true, color: "205ea6" })).join("");
				if (relID && inner) {
					parts.push(`<w:hyperlink r:id="${relID}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${inner}</w:hyperlink>`);
				}
				else {
					parts.push(inner);
				}
				continue;
			}
			parts.push(...renderHTMLNodesToRuns(context, node.childNodes, format));
		}
		return parts;
	}

	function runsFromInlineMarkdown(context, text = "") {
		let html = SystematicReviewerNativeMarkdown.renderInlineHTML(String(text || ""), {
			renderCitation: (citation, label) => {
				let encoded = encodeURIComponent(JSON.stringify(citation || {}));
				let visible = escapeXML(citationVisibleText(context, citation, label || "cite"));
				return `<span data-sr-docx-citation="${encoded}">${visible}</span>`;
			},
			renderLink: ({ label, href }) => `<a href="${escapeXML(href)}">${escapeXML(label)}</a>`,
			resolveAssetURL: (assetPath) => assetPath,
		});
		let wrapper = context.doc.createElement("div");
		wrapper.innerHTML = xmlSafeHTMLFragment(html);
		return renderHTMLNodesToRuns(context, wrapper.childNodes, {}).join("");
	}

	function paragraphFromInlineMarkdown(context, text = "", options = {}) {
		return paragraphXML(runsFromInlineMarkdown(context, text), options);
	}

	function docxProseAlign(context) {
		let raw = String(context?.settings?.paragraphAlign || "").trim().toLowerCase();
		return raw == "center" ? "center" : "both";
	}

	function docxHeadingStyleID(level = 1) {
		let normalized = Math.max(1, Math.min(6, Number(level || 1) || 1));
		return normalized == 1 ? "Title" : `Heading${Math.max(1, Math.min(5, normalized - 1))}`;
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

	function normalizeDocxTableColumnAlign(value = "") {
		let align = String(value || "").trim().toLowerCase();
		return ["left", "center", "right"].includes(align) ? align : "left";
	}

	function docxTableCellAlign(context, {
		styleID = "",
		columnAlign = "",
		columnIndex = 0,
		text = "",
		header = false,
	} = {}) {
		let align = normalizeDocxTableColumnAlign(columnAlign || "left");
		let style = String(styleID || "").trim().toLowerCase();
		if (header) {
			if (align == "right") {
				return "right";
			}
			return "center";
		}
		if (align == "center" || align == "right") {
			return align;
		}
		let prose = isLikelyProseTableCellText(text);
		if (style == "apa") {
			if (Number(columnIndex || 0) === 0) {
				return prose ? "left" : "left";
			}
			return prose ? "left" : "center";
		}
		return prose ? "left" : "left";
	}

	function paragraphsFromPlainText(text = "", options = {}) {
		return String(text || "")
			.split(/\n{2,}/)
			.map((chunk) => String(chunk || "").trim())
			.filter(Boolean)
			.map((chunk) => paragraphXML(textRunsXML(chunk).join(""), options));
	}

	function codeBlockParagraphsXML(text = "") {
		let lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
		if (!lines.length) {
			lines = [""];
		}
		return lines.map((line) => paragraphXML(textRunsXML(line, { code: true }).join(""), {
			spacingBeforeTwips: 0,
			spacingAfterTwips: 0,
		}));
	}

	function tocTitleParagraphXML() {
		return paragraphXML(textRunsXML("Table of Contents").join(""), {
			styleID: "TOCHeading",
			keepNext: true,
		});
	}

	function tocFieldParagraphXML() {
		return paragraphXML([
			"<w:r><w:fldChar w:fldCharType=\"begin\" w:dirty=\"true\"/></w:r>",
			`<w:r><w:rPr><w:rStyle w:val="IndexLink"/></w:rPr><w:instrText xml:space="preserve"> ${DOCX_TOC_FIELD_INSTRUCTION}</w:instrText></w:r>`,
			"<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r>",
			...textRunsXML(""),
			"<w:r><w:fldChar w:fldCharType=\"end\"/></w:r>",
		].join(""), {
			styleID: "TOC1",
		});
	}

	function tocBlockXML(context) {
		let contentControlID = nextContentControlID(context);
		return [
			"<w:sdt>",
			"<w:sdtPr>",
			`<w:id w:val="${contentControlID}"/>`,
			"<w:docPartObj>",
			"<w:docPartGallery w:val=\"Table of Contents\"/>",
			"<w:docPartUnique w:val=\"true\"/>",
			"</w:docPartObj>",
			"</w:sdtPr>",
			"<w:sdtContent>",
			tocTitleParagraphXML(),
			tocFieldParagraphXML(),
			"</w:sdtContent>",
			"</w:sdt>",
		].join("");
	}

	function docxBlockIndex(context, block = null) {
		return Number(context?.outline?.blockIndexByRef?.get?.(block) ?? -1);
	}

	function docxIsPrimaryGeneratedBlock(context, block = null, type = "") {
		let index = docxBlockIndex(context, block);
		return index >= 0 && context?.outline?.firstIndices?.[type] == index;
	}

	function docxGeneratedSectionUsesExplicitHeading(context, block = null) {
		let index = docxBlockIndex(context, block);
		return !!(index >= 0 && context?.outline?.generatedHeadingReuseByIndex?.has?.(index));
	}

	function docxGeneratedSectionHeadingXML(type = "bibliography") {
		let title = String(type || "").toLowerCase() == "prisma" ? "PRISMA" : "Bibliography";
		return paragraphXML(textRunsXML(title).join(""), { styleID: docxHeadingStyleID(2) });
	}

	function tableBordersXML(styleID = "standard") {
		let normalized = String(styleID || "standard").toLowerCase();
		if (["apa", "minimal", "scientific"].includes(normalized)) {
			return `<w:tblBorders><w:top w:val="single" w:sz="${normalized == "apa" ? 16 : 12}" w:space="0" w:color="444444"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="${normalized == "apa" ? 16 : 12}" w:space="0" w:color="444444"/><w:right w:val="nil"/><w:insideH w:val="single" w:sz="8" w:space="0" w:color="B8C0C8"/><w:insideV w:val="nil"/></w:tblBorders>`;
		}
		return `<w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="8F98A3"/><w:left w:val="single" w:sz="8" w:space="0" w:color="8F98A3"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="8F98A3"/><w:right w:val="single" w:sz="8" w:space="0" w:color="8F98A3"/><w:insideH w:val="single" w:sz="8" w:space="0" w:color="8F98A3"/><w:insideV w:val="single" w:sz="8" w:space="0" w:color="8F98A3"/></w:tblBorders>`;
	}

	function docxFirstBodyRowDuplicatesHeader(table = {}) {
		let normalized = SystematicReviewerNativeMarkdown.normalizeTableBlock(table || {});
		let header = Array.isArray(normalized?.header) ? normalized.header.map((value) => String(value || "").trim()) : [];
		let firstRow = Array.isArray(normalized?.rows?.[0])
			? normalized.rows[0].map((cell) => SystematicReviewerNativeMarkdown.normalizeTableCell(cell))
			: [];
		if (!header.length || !firstRow.length || firstRow.length != header.length) {
			return false;
		}
		let headerColumnCount = header.length;
		let firstRowColumnCount = firstRow.reduce((sum, cell) => sum + Math.max(1, Number(cell?.colspan || 1) || 1), 0);
		if (headerColumnCount != firstRowColumnCount) {
			return false;
		}
		for (let index = 0; index < firstRow.length; index += 1) {
			let cell = firstRow[index];
			if (Math.max(1, Number(cell?.colspan || 1) || 1) != 1) {
				return false;
			}
			if (String(cell?.text || "").trim() != header[index]) {
				return false;
			}
		}
		return true;
	}

	function tableXML(context, tableBlock = {}, options = {}) {
		let table = SystematicReviewerNativeMarkdown.normalizeTableBlock(tableBlock);
		let styleID = String(options.styleID || table.style || "standard").toLowerCase();
		let rows = [];
		let headerCells = table.header.map((text) => ({ text, colspan: 1 }));
		let rowXML = (cells = [], header = false) => {
			let cellXML = [];
			let columnIndex = 0;
			for (let rawCell of cells) {
				let cell = SystematicReviewerNativeMarkdown.normalizeTableCell(rawCell);
				let resolvedAlign = docxTableCellAlign(context, {
					styleID,
					columnAlign: table.alignments?.[columnIndex] || "left",
					columnIndex,
					text: cell.text || "",
					header,
				});
				let inner = paragraphXML(runsFromInlineMarkdown(context, cell.text || ""), {
					align: resolvedAlign,
					spacingBeforeTwips: 0,
					spacingAfterTwips: 0,
				});
				let tcPr = [];
				if (cell.colspan > 1) {
					tcPr.push(`<w:gridSpan w:val="${Math.max(1, cell.colspan)}"/>`);
				}
				cellXML.push(`<w:tc>${tcPr.length ? `<w:tcPr>${tcPr.join("")}</w:tcPr>` : ""}${inner}</w:tc>`);
				columnIndex += Math.max(1, Number(cell.colspan || 1) || 1);
			}
			let rowProps = header ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
			return `<w:tr>${rowProps}${cellXML.join("")}</w:tr>`;
		};
		rows.push(rowXML(headerCells, true));
		let bodyRows = docxFirstBodyRowDuplicatesHeader(table)
			? (table.rows || []).slice(1)
			: (table.rows || []);
		for (let row of bodyRows) {
			rows.push(rowXML(row, false));
		}
		let columnCount = Math.max(
			headerCells.reduce((sum, cell) => sum + Math.max(1, Number(cell.colspan || 1)), 0),
			...bodyRows.map((row) => row.reduce((sum, rawCell) => sum + Math.max(1, Number((rawCell?.colspan ?? 1) || 1)), 0)),
			1
		);
		let grid = Array.from({ length: columnCount }, () => `<w:gridCol w:w="${Math.round(9000 / columnCount)}"/>`).join("");
		return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>${tableBordersXML(styleID)}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join("")}</w:tbl>`;
	}

	function bibliographyParagraphsXML(context, options = {}) {
		let html = "";
		try {
			html = String(context.reviewer._renderBibliographyHTML(context.controller, context.markdown) || "");
		}
		catch (_error) {}
		if (!html) {
			return options.emitHeading === false
				? []
				: [paragraphXML(textRunsXML("Bibliography").join(""), { styleID: docxHeadingStyleID(2) })];
		}
		let wrapper = context.doc.createElement("div");
		wrapper.innerHTML = xmlSafeHTMLFragment(html);
		let entries = Array.from(wrapper.querySelectorAll(".csl-entry"));
		let output = [];
		if (options.emitHeading !== false) {
			output.push(paragraphXML(textRunsXML("Bibliography").join(""), { styleID: docxHeadingStyleID(2) }));
		}
		if (!entries.length) {
			if (options.emitHeading === false) {
				return output;
			}
			let text = wrapper.textContent || "Bibliography";
			if (String(text || "").trim()) {
				output.push(...paragraphsFromPlainText(text, {
					align: docxProseAlign(context),
				}));
			}
			return output;
		}
		let entryParagraphs = [];
		for (let entry of entries) {
			let runs = renderHTMLNodesToRuns(context, entry.childNodes, {}).join("");
			entryParagraphs.push(paragraphXML(runs, {
				align: docxProseAlign(context),
			}));
		}
		if (context.citationMode == "linked") {
			let { bookmarkID, bookmarkName } = zoteroBookmarkName(context);
			context.bibliographyMetadata = {
				bookmarkID,
				bookmarkName,
				fieldCode: zoteroBibliographyCode(),
			};
			entryParagraphs = wrapParagraphsWithBookmark(entryParagraphs, bookmarkID, bookmarkName);
		}
		output.push(...entryParagraphs);
		return output;
	}

	async function blockXMLList(context, block = {}, pageLayout = "portrait") {
		switch (block.type) {
			case "heading":
				return [paragraphFromInlineMarkdown(context, block.text || "", {
					styleID: docxHeadingStyleID(block.level),
					keepNext: true,
				})];
			case "paragraph":
				return [paragraphFromInlineMarkdown(context, block.text || "", {
					align: docxProseAlign(context),
				})];
			case "list": {
				let items = SystematicReviewerNativeMarkdown.normalizeListItems(block.items || []);
				let counts = new Map();
				return items.map((item) => {
					let level = Math.max(0, Number(item.level || 0) || 0);
					let marker = "•";
					if (block.ordered) {
						let next = (counts.get(level) || 0) + 1;
						counts.set(level, next);
						marker = `${next}.`;
					}
					let runs = textRunsXML(`${marker} `).join("") + runsFromInlineMarkdown(context, item.text || "");
					return paragraphXML(runs, {
						align: docxProseAlign(context),
						indentLeftTwips: 360 + level * 360,
						hangingTwips: 240,
					});
				});
			}
			case "table": {
				let output = [];
				if (String(block.captionAbove || "").trim()) {
					output.push(paragraphFromInlineMarkdown(context, block.captionAbove || ""));
				}
				output.push(tableXML(context, block, { styleID: block.style || context.settings?.tableStyle || "standard" }));
				if (String(block.noteBelow || "").trim()) {
					output.push(paragraphFromInlineMarkdown(context, block.noteBelow || ""));
				}
				return output;
			}
			case "toc":
				if (!docxIsPrimaryGeneratedBlock(context, block, "toc")) {
					return [];
				}
				return [tocBlockXML(context)];
			case "bibliography":
				if (!docxIsPrimaryGeneratedBlock(context, block, "bibliography")) {
					return [];
				}
				return bibliographyParagraphsXML(context, {
					emitHeading: !docxGeneratedSectionUsesExplicitHeading(context, block),
				});
			case "prisma": {
				if (!docxIsPrimaryGeneratedBlock(context, block, "prisma")) {
					return [];
				}
				let output = [];
				if (!docxGeneratedSectionUsesExplicitHeading(context, block)) {
					output.push(docxGeneratedSectionHeadingXML("prisma"));
				}
				if (!context.prismaMediaPart) {
					output.push(paragraphXML(textRunsXML("PRISMA diagram is not available.").join("")));
					return output;
				}
				output.push(paragraphXML(drawingXML(context, context.prismaMediaPart, {
					name: "PRISMA Diagram",
					maxWidthPx: normalizeLayout(pageLayout) == "landscape" ? 980 : 720,
					maxHeightPx: 920,
				}), { align: "center" }));
				return output;
			}
			case "image": {
				let output = [];
				if (String(block.captionAbove || "").trim()) {
					output.push(paragraphFromInlineMarkdown(context, block.captionAbove || ""));
				}
				let mediaPart = await registerImageAsset(context, block.src || "", { baseName: "image" });
				if (mediaPart) {
					let baseMaxWidthPx = normalizeLayout(pageLayout) == "landscape" ? 980 : 720;
					let widthPercent = normalizeDisplayWidthPercent(block.displayWidthPercent);
					output.push(paragraphXML(drawingXML(context, mediaPart, {
						name: block.alt || "Image",
						maxWidthPx: Math.max(96, Math.round(baseMaxWidthPx * (widthPercent / 100))),
						maxHeightPx: 520,
					}), { align: "center" }));
				}
				else {
					output.push(paragraphXML(textRunsXML(block.alt || block.src || "Image").join("")));
				}
				if (String(block.noteBelow || "").trim()) {
					output.push(paragraphFromInlineMarkdown(context, block.noteBelow || ""));
				}
				return output;
			}
			case "code":
				return codeBlockParagraphsXML(String(block.text || ""));
			default:
				return [];
		}
	}

	async function buildDocumentBodyXML(context) {
		let sourceBlocks = SystematicReviewerNativeMarkdown.parseMarkdown(context.markdown || "");
		context.outline = SystematicReviewerNativeMarkdown.buildDocumentOutline(sourceBlocks, {
			includeTOCSelf: false,
		});
		let pages = SystematicReviewerNativeMarkdown.paginateBlocks(sourceBlocks);
		if (!pages.length) {
			pages = [{ layout: "portrait", blocks: [] }];
		}
		let xmlParts = [];
		for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
			let page = pages[pageIndex] || { layout: "portrait", blocks: [] };
			let layout = normalizeLayout(page.layout);
			let pageBlocks = Array.from(page.blocks || []).filter((block) =>
				block
				&& block.type != "page-break"
				&& block.type != "page-layout"
				&& block.type != "page-marker"
			);
			for (let block of pageBlocks) {
				xmlParts.push(...await blockXMLList(context, block, layout));
			}
			let nextPage = pages[pageIndex + 1] || null;
			if (!nextPage) {
				continue;
			}
			if (normalizeLayout(nextPage.layout) == layout) {
				xmlParts.push(paragraphXML("<w:r><w:br w:type=\"page\"/></w:r>"));
			}
			else {
				xmlParts.push(paragraphXML("", {
					sectionXML: sectionPropertiesXML(layout, context.settings?.printMarginInches, { type: "nextPage" }),
				}));
			}
		}
		let finalLayout = normalizeLayout(pages[pages.length - 1]?.layout || "portrait");
		return {
			bodyXML: xmlParts.join(""),
			finalSectionXML: sectionPropertiesXML(finalLayout, context.settings?.printMarginInches),
		};
	}

	function documentXML(context, bodyXML = "", finalSectionXML = "") {
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<w:document xmlns:w="${WORD_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`,
			"<w:body>",
			bodyXML,
			finalSectionXML,
			"</w:body>",
			"</w:document>",
		].join("");
	}

	function stylesXML(settings = {}) {
		let normalized = SystematicReviewerNativeMarkdown.normalizeSettings(settings || {});
		let fontFamily = escapeXML(normalized.fontFamily || "Georgia");
		let bodySizeHalfPoints = Math.round((Number(normalized.fontSizePx || 12) || 12) * 2);
		let marginTwips = inchesToTwips(normalized.printMarginInches || 1);
		let tocTabStop = Math.max(1440, pageSizeForLayout("portrait").width - (marginTwips * 2) - 120);
		let headingSizes = typeof SystematicReviewerNativeMarkdown.resolveHeadingSizeMap == "function"
			? SystematicReviewerNativeMarkdown.resolveHeadingSizeMap(normalized, { printMode: true })
			: null;
		let headingStyles = normalized.headingStyles || SystematicReviewerNativeMarkdown.DEFAULT_HEADING_STYLES || {};
		let baseHeadingSize = Math.max(
			bodySizeHalfPoints + 4,
			Math.round((Number(headingSizes?.[2] || 0) || (bodySizeHalfPoints / 2 + 2)) * 2)
		);
		let titleStyle = headingStyles[1] || {};
		let titleSizePx = Number(headingSizes?.[1] || 0);
		let titleSize = Math.max(
			bodySizeHalfPoints + 8,
			Math.round((titleSizePx > 0 ? titleSizePx : (bodySizeHalfPoints / 2 + 6)) * 2)
		);
		let titlePPr = ["<w:keepNext/>"];
		if (titleStyle.align && titleStyle.align != "left") {
			titlePPr.push(`<w:jc w:val="${escapeXML(titleStyle.align)}"/>`);
		}
		titlePPr.push(`<w:spacing w:before="0" w:after="180"/>`);
		let titleRPr = [`<w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/>`, `<w:sz w:val="${titleSize}"/>`, `<w:szCs w:val="${titleSize}"/>`, "<w:b/>"];
		if (titleStyle.italic) {
			titleRPr.push("<w:i/>");
		}
		if (String(titleStyle.transform || "").toLowerCase() == "uppercase") {
			titleRPr.push("<w:caps/>");
		}
		let baseStylesXML = [
			`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/><w:sz w:val="${bodySizeHalfPoints}"/><w:szCs w:val="${bodySizeHalfPoints}"/></w:rPr></w:style>`,
			`<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="140"/></w:pPr></w:style>`,
			`<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="Heading"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/><w:sz w:val="${baseHeadingSize}"/><w:szCs w:val="${baseHeadingSize}"/></w:rPr></w:style>`,
			`<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr>${titlePPr.join("")}</w:pPr><w:rPr>${titleRPr.join("")}</w:rPr></w:style>`,
			`<w:style w:type="paragraph" w:styleId="Index"><w:name w:val="Index"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:suppressLineNumbers/></w:pPr></w:style>`,
			`<w:style w:type="paragraph" w:styleId="IndexHeading"><w:name w:val="Index Heading"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:suppressLineNumbers/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/><w:b/><w:sz w:val="${Math.max(bodySizeHalfPoints + 8, baseHeadingSize)}"/><w:szCs w:val="${Math.max(bodySizeHalfPoints + 8, baseHeadingSize)}"/></w:rPr></w:style>`,
			`<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="IndexHeading"/><w:qFormat/><w:pPr><w:suppressLineNumbers/><w:ind w:hanging="0" w:start="0"/></w:pPr></w:style>`,
			`<w:style w:type="character" w:styleId="IndexLink"><w:name w:val="Index Link"/></w:style>`,
		];
		for (let level = 1; level <= 6; level += 1) {
			let indentStart = Math.max(0, (level - 1) * 283);
			baseStylesXML.push(`<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Index"/><w:pPr><w:tabs><w:tab w:val="clear" w:pos="709"/><w:tab w:val="right" w:pos="${tocTabStop}" w:leader="dot"/></w:tabs><w:ind w:hanging="0" w:start="${indentStart}"/></w:pPr></w:style>`);
		}
		let headingXML = [];
		for (let level = 1; level <= 6; level += 1) {
			let sourceLevel = Math.min(6, level + 1);
			let resolvedSizePx = Number(headingSizes?.[sourceLevel] || 0);
			let size = Math.max(bodySizeHalfPoints, Math.round((resolvedSizePx > 0 ? resolvedSizePx : (bodySizeHalfPoints / 2)) * 2));
			let style = headingStyles[sourceLevel] || {};
			let pPr = [];
			pPr.push("<w:keepNext/>");
			if (style.align && style.align != "left") {
				pPr.push(`<w:jc w:val="${escapeXML(style.align)}"/>`);
			}
			pPr.push(`<w:spacing w:before="${sourceLevel <= 2 ? 240 : 160}" w:after="120"/>`);
			pPr.push(`<w:outlineLvl w:val="${level - 1}"/>`);
			let rPr = [`<w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/>`, `<w:sz w:val="${size}"/>`, `<w:szCs w:val="${size}"/>`, "<w:b/>"];
			if (style.italic) {
				rPr.push("<w:i/>");
			}
			if (String(style.transform || "").toLowerCase() == "uppercase") {
				rPr.push("<w:caps/>");
			}
			headingXML.push(`<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Heading"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr>${pPr.join("")}</w:pPr><w:rPr>${rPr.join("")}</w:rPr></w:style>`);
		}
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<w:styles xmlns:w="${WORD_NS}">`,
			"<w:docDefaults>",
			`<w:rPrDefault><w:rPr><w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/><w:sz w:val="${bodySizeHalfPoints}"/><w:szCs w:val="${bodySizeHalfPoints}"/></w:rPr></w:rPrDefault>`,
			`<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault>`,
			"</w:docDefaults>",
			...baseStylesXML,
			...headingXML,
			"</w:styles>",
		].join("");
	}

	function settingsXML() {
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<w:settings xmlns:w="${WORD_NS}"><w:zoom w:percent="100"/><w:updateFields w:val="true"/></w:settings>`,
		].join("");
	}

	function rootRelationshipsXML(context) {
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<Relationships xmlns="${REL_NS}">`,
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`,
			`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
			`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`,
			context.citationMode == "linked"
				? `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>`
				: "",
			"</Relationships>",
		].filter(Boolean).join("");
	}

	function contentTypesXML(context) {
		let defaults = new Map([
			["rels", "application/vnd.openxmlformats-package.relationships+xml"],
			["xml", "application/xml"],
		]);
		for (let part of context.mediaParts) {
			defaults.set(part.extension, part.contentType);
		}
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
			...Array.from(defaults.entries()).map(([extension, contentType]) => `<Default Extension="${escapeXML(extension)}" ContentType="${escapeXML(contentType)}"/>`),
			`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
			`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`,
			`<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`,
			`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
			`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
			context.citationMode == "linked"
				? `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`
				: "",
			"</Types>",
		].filter(Boolean).join("");
	}

	function appXML() {
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Zotero Systematic Reviewer</Application></Properties>`,
		].join("");
	}

	function coreXML(title = "REPORT") {
		let now = currentTimestampISO();
		return [
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
			`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
			`<dc:title>${escapeXML(title)}</dc:title>`,
			`<dc:creator>Systematic Reviewer</dc:creator>`,
			`<cp:lastModifiedBy>Systematic Reviewer</cp:lastModifiedBy>`,
			`<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXML(now)}</dcterms:created>`,
			`<dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXML(now)}</dcterms:modified>`,
			`</cp:coreProperties>`,
		].join("");
	}

	async function writePackageFiles(context, documentBodyXML, finalSectionXML) {
		let reviewer = context.reviewer;
		let packageParts = {
			"[Content_Types].xml": contentTypesXML(context),
			"_rels/.rels": rootRelationshipsXML(context),
			"docProps/app.xml": appXML(),
			"docProps/core.xml": coreXML(context.title),
			"word/document.xml": documentXML(context, documentBodyXML, finalSectionXML),
			"word/styles.xml": stylesXML(context.settings),
			"word/settings.xml": settingsXML(),
			"word/_rels/document.xml.rels": context.documentRels.xml(),
		};
		if (context.citationMode == "linked") {
			packageParts["docProps/custom.xml"] = customPropertiesXML(context);
		}
		validateDocxPackageModel(context, packageParts);
		await reviewer._ensureDirectory(reviewer._joinPath(context.rootPath, "_rels"));
		await reviewer._ensureDirectory(reviewer._joinPath(context.rootPath, "docProps"));
		await reviewer._ensureDirectory(reviewer._joinPath(context.rootPath, "word", "_rels"));
		await reviewer._ensureDirectory(reviewer._joinPath(context.rootPath, "word", "media"));
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "[Content_Types].xml"), packageParts["[Content_Types].xml"]);
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "_rels", ".rels"), packageParts["_rels/.rels"]);
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "docProps", "app.xml"), packageParts["docProps/app.xml"]);
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "docProps", "core.xml"), packageParts["docProps/core.xml"]);
		if (context.citationMode == "linked") {
			await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "docProps", "custom.xml"), packageParts["docProps/custom.xml"]);
		}
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "word", "document.xml"), packageParts["word/document.xml"]);
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "word", "styles.xml"), packageParts["word/styles.xml"]);
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "word", "settings.xml"), packageParts["word/settings.xml"]);
		await reviewer._writeTextFile(reviewer._joinPath(context.rootPath, "word", "_rels", "document.xml.rels"), packageParts["word/_rels/document.xml.rels"]);
	}

	async function preparePrismaMedia(context) {
		if (!String(context.markdown || "").includes(SystematicReviewerNativeMarkdown.PRISMA_PLACEHOLDER_MARKDOWN)) {
			return null;
		}
		try {
			let prismaState = await SystematicReviewerWorkflowPrisma.render({
				reviewer: context.reviewer,
				current: context.current,
				payload: { editor_settings: context.settings },
			});
			if (!prismaState?.diagram) {
				return null;
			}
			let fitBox = {
				maxWidthPx: 980,
				maxHeightPx: 920,
			};
			let markup = SystematicReviewerPrismaRenderer.svgMarkup(prismaState.diagram, prismaState, {
				doc: context.doc,
				fitBox,
				embedStyles: true,
			});
			if (!markup) {
				return null;
			}
			context.prismaMediaPart = await registerPrismaPNG(context, markup, {
				baseName: "prisma",
				diagram: prismaState.diagram,
				state: prismaState,
				renderOptions: {
					fitBox,
					embedStyles: true,
				},
			});
			return context.prismaMediaPart;
		}
		catch (_error) {
			return null;
		}
	}

	async function saveAutomationDOCX({
		reviewer = null,
		current = null,
		win = null,
		markdown = "",
		outputPath = "",
		settings = {},
		controller = null,
		citationMode = "linked",
		title = "REPORT",
	} = {}) {
		if (!reviewer || !win?.document) {
			throw new Error("A Zotero window and reviewer context are required for DOCX export.");
		}
		let resolvedOutputPath = String(outputPath || "").trim();
		if (!resolvedOutputPath) {
			throw new Error("DOCX export requires an output path.");
		}
		let context = createDocxContext({
			reviewer,
			current,
			win,
			markdown,
			outputPath: resolvedOutputPath,
			settings,
			controller,
			citationMode,
			title,
		});
		try {
			await reviewer._ensureDirectory(reviewer._parentPath(resolvedOutputPath));
			await preparePrismaMedia(context);
			let { bodyXML, finalSectionXML } = await buildDocumentBodyXML(context);
			await writePackageFiles(context, bodyXML, finalSectionXML);
			try {
				let existing = nsIFileFromPath(resolvedOutputPath);
				if (existing.exists()) {
					existing.remove(false);
				}
			}
			catch (_error) {}
			let worked = await packageDOCX(context.rootPath, resolvedOutputPath);
			if (!worked) {
				throw new Error("DOCX packaging produced no output.");
			}
			return {
				ok: true,
				path: resolvedOutputPath,
			};
		}
		catch (error) {
			throw new Error(`DOCX export failed: ${error?.message || String(error)}`);
		}
		finally {
			cleanupTempDirectory(context.rootPath);
		}
	}

	return {
		saveAutomationDOCX,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerSaveDOCX;
}
