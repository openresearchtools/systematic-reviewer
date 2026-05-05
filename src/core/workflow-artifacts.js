var SystematicReviewerWorkflowArtifacts = (() => {
	const WORKFLOW_DIRNAME = "workflow";

	function optionalString(value) {
		return String(value || "").trim();
	}

	function nowStamp() {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	function slugify(value = "", fallback = "artifact") {
		let slug = String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return slug || fallback;
	}

	function normalizeMarkdown(text = "") {
		return String(text || "").replace(/\r\n?/g, "\n");
	}

	function reportSectionHeading(headingPath = []) {
		let parts = Array.isArray(headingPath)
			? headingPath.map((part) => optionalString(part)).filter(Boolean)
			: [optionalString(headingPath)].filter(Boolean);
		return parts[parts.length - 1] || "Section";
	}

	function markerStart(marker = "") {
		return `<!-- systematic-reviewer:${marker}:start -->`;
	}

	function markerEnd(marker = "") {
		return `<!-- systematic-reviewer:${marker}:end -->`;
	}

	function escapeRegExp(text = "") {
		return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function normalizeHeadingPath(path = []) {
		return (Array.isArray(path) ? path : [path])
			.map((part) => optionalString(part))
			.filter(Boolean);
	}

	function suffixPathMatches(fullPath = [], wantedPath = []) {
		let normalizedFull = normalizeHeadingPath(fullPath).map((part) => SystematicReviewerTextFileTools.normalizeHeadingLabel(part));
		let normalizedWanted = normalizeHeadingPath(wantedPath).map((part) => SystematicReviewerTextFileTools.normalizeHeadingLabel(part));
		if (!normalizedWanted.length || normalizedFull.length < normalizedWanted.length) {
			return false;
		}
		let offset = normalizedFull.length - normalizedWanted.length;
		for (let index = 0; index < normalizedWanted.length; index++) {
			if (normalizedFull[offset + index] != normalizedWanted[index]) {
				return false;
			}
		}
		return true;
	}

	function findSection(markdown = "", headingPath = []) {
		let wantedPath = normalizeHeadingPath(headingPath);
		if (!wantedPath.length) {
			return null;
		}
		let headings = SystematicReviewerTextFileTools.extractMarkdownHeadings(markdown);
		let matched = headings.find((heading) => suffixPathMatches(heading?.path || [], wantedPath)) || null;
		if (!matched?.path?.length) {
			return null;
		}
		return SystematicReviewerTextFileTools.findMarkdownSection(markdown, { headingPath: matched.path });
	}

	function workflowDir(reviewer, context) {
		return reviewer._joinPath(context.outputsDir, WORKFLOW_DIRNAME);
	}

	async function ensureWorkflowDir(reviewer, context, subdir = "") {
		let dir = workflowDir(reviewer, context);
		await reviewer._ensureDirectory(dir);
		if (optionalString(subdir)) {
			dir = reviewer._joinPath(dir, optionalString(subdir));
			await reviewer._ensureDirectory(dir);
		}
		return dir;
	}

	function ensureHeading(markdown = "", headingPath = []) {
		let normalized = normalizeMarkdown(markdown);
		let path = normalizeHeadingPath(headingPath);
		if (!path.length) {
			return normalized;
		}
		let existing = findSection(normalized, path);
		if (existing) {
			return normalized;
		}
		if (path.length > 1) {
			normalized = ensureHeading(normalized, path.slice(0, -1));
		}
		let level = Math.max(2, Math.min(6, path.length + 1));
		let block = `${"#".repeat(level)} ${reportSectionHeading(path)}\n\n`;
		if (path.length == 1) {
			return normalized.replace(/\s*$/, "") + `\n\n${block}`;
		}
		let parent = findSection(normalized, path.slice(0, -1));
		if (!parent) {
			return normalized.replace(/\s*$/, "") + `\n\n${block}`;
		}
		let parentText = normalized.slice(parent.startOffset, parent.endOffset).replace(/\s*$/, "");
		let nextParentText = `${parentText}\n\n${block}\n`;
		return normalized.slice(0, parent.startOffset) + nextParentText + normalized.slice(parent.endOffset);
	}

	function upsertMarkedBlock(markdown = "", headingPath = [], marker = "", body = "") {
		let normalized = ensureHeading(markdown, headingPath);
		let section = findSection(normalized, headingPath);
		if (!section) {
			return normalized;
		}
		let blockBody = optionalString(body) ? String(body).trim() : "";
		let start = markerStart(marker);
		let end = markerEnd(marker);
		let nextBlock = `${start}\n${blockBody}\n${end}`;
		let sectionText = normalized.slice(section.startOffset, section.endOffset);
		let blockRe = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
		let nextSectionText = "";
		if (blockRe.test(sectionText)) {
			nextSectionText = sectionText.replace(blockRe, nextBlock);
		}
		else {
			nextSectionText = sectionText.replace(/\s*$/, "");
			nextSectionText = `${nextSectionText}\n\n${nextBlock}\n`;
		}
		return normalized.slice(0, section.startOffset) + nextSectionText + normalized.slice(section.endOffset);
	}

	function upsertStandaloneMarkedBlock(regionText = "", marker = "", body = "") {
		let normalized = normalizeMarkdown(regionText);
		let start = markerStart(marker);
		let end = markerEnd(marker);
		let nextBlock = `${start}\n${String(body || "").trim()}\n${end}`;
		let blockRe = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
		if (blockRe.test(normalized)) {
			return normalized.replace(blockRe, nextBlock).replace(/\s*$/, "");
		}
		let trimmed = normalized.trim();
		if (!trimmed) {
			return nextBlock;
		}
		return `${trimmed}\n\n${nextBlock}`;
	}

	function prismaPlaceholderMarkdown() {
		let nativeMarkdown = typeof SystematicReviewerNativeMarkdown != "undefined" ? SystematicReviewerNativeMarkdown : null;
		return String(nativeMarkdown?.PRISMA_PLACEHOLDER_MARKDOWN || "[prisma](zotero://systematic-reviewer/prisma)").trim();
	}

	function pageBreakMarkdown() {
		let nativeMarkdown = typeof SystematicReviewerNativeMarkdown != "undefined" ? SystematicReviewerNativeMarkdown : null;
		return String(nativeMarkdown?.PAGE_BREAK_MARKDOWN || "<!-- sr:page-break -->").trim();
	}

	function prismaScaffoldDescription() {
		return "PRISMA Flow Diagram. The PRISMA flow diagram for the systematic review detailing the database searches, the number of abstracts screened, and the full texts retrieved.";
	}

	function findGeneratedPrismaSection(normalizedMarkdown = "") {
		let lines = normalizeMarkdown(normalizedMarkdown).split("\n");
		let placeholder = prismaPlaceholderMarkdown();
		let pageBreak = pageBreakMarkdown();
		let placeholderLine = lines.findIndex((line) => optionalString(line) == placeholder);
		if (placeholderLine < 0) {
			return null;
		}
		let insertStartLine = placeholderLine + 1;
		while (insertStartLine < lines.length && !optionalString(lines[insertStartLine])) {
			insertStartLine += 1;
		}
		if (optionalString(lines[insertStartLine]) == prismaScaffoldDescription()) {
			insertStartLine += 1;
			while (insertStartLine < lines.length && !optionalString(lines[insertStartLine])) {
				insertStartLine += 1;
			}
		}
		let sectionEndLine = lines.length;
		for (let index = insertStartLine; index < lines.length; index += 1) {
			if (optionalString(lines[index]) == pageBreak) {
				sectionEndLine = index;
				break;
			}
		}
		return {
			lines,
			insertStartLine,
			sectionEndLine,
		};
	}

	async function writeGeneratedPrismaBlock(reviewer, context, options = {}) {
		let reportPath = context?.reportPath || "";
		if (!reportPath) {
			throw new Error("Project report path is unavailable.");
		}
		let marker = optionalString(options.marker || "prisma-summary");
		let body = String(options.body || "").trim();
		let current = normalizeMarkdown(await reviewer._readFileText(reportPath));
		let section = findGeneratedPrismaSection(current);
		if (!section) {
			return {
				ok: false,
				report_path: reportPath,
				marker,
				used_placeholder: false,
			};
		}
		let before = section.lines.slice(0, section.insertStartLine).join("\n").replace(/\s*$/, "");
		let region = section.lines.slice(section.insertStartLine, section.sectionEndLine).join("\n");
		let after = section.lines.slice(section.sectionEndLine).join("\n").replace(/^\s*/, "");
		let nextRegion = upsertStandaloneMarkedBlock(region, marker, body);
		let next = [before, nextRegion, after].filter((part) => String(part || "").trim()).join("\n\n");
		if (next != current) {
			await reviewer._writeTextFile(reportPath, next);
		}
		return {
			ok: true,
			report_path: reportPath,
			marker,
			used_placeholder: true,
		};
	}

	async function writeMarkdownBlock(reviewer, filePath = "", options = {}) {
		let targetPath = optionalString(filePath);
		if (!targetPath) {
			throw new Error("Target markdown path is unavailable.");
		}
		let headingPath = Array.isArray(options.headingPath || options.heading_path)
			? (options.headingPath || options.heading_path)
			: [optionalString(options.heading || "")].filter(Boolean);
		let marker = optionalString(options.marker || slugify(headingPath.join("-") || "block"));
		let body = String(options.body || "").trim();
		let seedMarkdown = normalizeMarkdown(options.seedMarkdown || options.seed_markdown || "");
		let current = await reviewer._pathExists(targetPath)
			? normalizeMarkdown(await reviewer._readFileText(targetPath))
			: seedMarkdown;
		let next = upsertMarkedBlock(current, headingPath, marker, body);
		if (next != current) {
			await reviewer._writeTextFile(targetPath, next);
		}
		return {
			ok: true,
			path: targetPath,
			heading_path: headingPath,
			marker,
		};
	}

	async function writeReportBlock(reviewer, context, options = {}) {
		let reportPath = context?.reportPath || "";
		if (!reportPath) {
			throw new Error("Project report path is unavailable.");
		}
		let result = await writeMarkdownBlock(reviewer, reportPath, options);
		return Object.assign({}, result, {
			report_path: reportPath,
		});
	}

	async function writeLogBlock(reviewer, context, options = {}) {
		let logPath = context?.logPath || "";
		if (!logPath) {
			throw new Error("Project log path is unavailable.");
		}
		let result = await writeMarkdownBlock(reviewer, logPath, Object.assign({}, options, {
			seed_markdown: options.seed_markdown || "# Workflow Log\n\n",
		}));
		return Object.assign({}, result, {
			log_path: logPath,
		});
	}

	async function writeArtifact(reviewer, context, options = {}) {
		let category = optionalString(options.category || "workflow");
		let kind = optionalString(options.kind || category);
		let extension = optionalString(options.extension || "md").replace(/^\./, "") || "md";
		let dir = await ensureWorkflowDir(reviewer, context, category);
		let fileName = `${nowStamp()}-${slugify(kind)}.${extension}`;
		let path = reviewer._joinPath(dir, fileName);
		let content = "";
		if (extension == "json") {
			await reviewer._writeJSONFile(path, options.content && typeof options.content == "object" ? options.content : {});
		}
		else {
			content = String(options.content || "");
			await reviewer._writeTextFile(path, content);
		}
		return {
			ok: true,
			path,
			file_name: fileName,
			category,
			kind,
		};
	}

	function artifactFileEntries(reviewer, dirPath = "") {
		let dir = reviewer._nsIFile(dirPath);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let out = [];
		let entries = dir.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.isFile?.() || entry.leafName.startsWith(".")) {
				continue;
			}
			out.push(entry.path);
		}
		return out.sort();
	}

	async function syncCategoryBlock(reviewer, context, options = {}) {
		let category = optionalString(options.category || "workflow");
		let dir = await ensureWorkflowDir(reviewer, context, category);
		let blocks = [];
		for (let path of artifactFileEntries(reviewer, dir)) {
			if (!/\.md$/i.test(path)) {
				continue;
			}
			let text = normalizeMarkdown(await reviewer._readFileText(path)).trim();
			if (text) {
				blocks.push(text);
			}
		}
		let body = blocks.length
			? blocks.join("\n\n")
			: String(options.emptyLabel || options.empty_label || "No saved workflow artifacts yet.").trim();
		return await writeLogBlock(reviewer, context, {
			headingPath: options.headingPath || options.heading_path || [],
			marker: options.marker || slugify(category || "workflow"),
			body,
		});
	}

	return {
		workflowDir,
		ensureWorkflowDir,
		writeArtifact,
		writeMarkdownBlock,
		writeReportBlock,
		writeLogBlock,
		writeGeneratedPrismaBlock,
		upsertMarkedBlock,
		syncCategoryBlock,
	};
})();
