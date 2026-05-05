var SystematicReviewerPrivilegedBrowserTools = (() => {
	const DEFAULT_READ_MAX_CHARS = 30000;
	const MAX_READ_MAX_CHARS = 120000;
	const MIN_READ_MAX_CHARS = 2000;
	const DEFAULT_WAIT_TIMEOUT_MS = 30000;
	const DEFAULT_COMMAND_TIMEOUT_MS = 15000;
	const DEFAULT_EXPAND_ROUNDS = 3;
	const DEFAULT_EXPAND_CLICKS_PER_ROUND = 3;
	const DEFAULT_LOAD_MORE_ROUNDS = 8;
	const DEFAULT_LOAD_MORE_CLICKS = 3;
	const DEFAULT_LOAD_MORE_SCROLLS = 8;
	const DEFAULT_LOAD_MORE_TIME_MS = 20000;
	const DEFAULT_LOAD_MORE_STALL_ROUNDS = 2;
	const DEFAULT_ACTION_SETTLE_MS = 500;
	const HARVEST_WEB_COLLECTION_NAME = "Web";
	const SNAPSHOT_TITLE = "Webpage Snapshot";
	const PDF_TITLE = "Webpage PDF";
	const EXPAND_ACTION_RE = /\b(read more|show more|view more|see more|expand|details|show details|view details|continue reading|full text|show abstract|show description|more info)\b/i;
	const EXPAND_EXCLUDE_RE = /\b(comment|reply|replies|result|results|post|posts|item|items|thread|feed|next|older|newer|page)\b/i;
	const LOAD_MORE_ACTION_RE = /\b(load more|more comments|more replies|more results|more posts|show more comments|show more replies|show more results|next|next page|older|newer|continue)\b/i;
	const LOAD_MORE_CONTEXT_RE = /\b(comment|reply|repl(?:y|ies)|result|results|post|posts|item|items|thread|feed|page)\b/i;
	const DANGEROUS_ACTION_RE = /\b(delete|remove|buy|purchase|checkout|order|submit|send|post|publish|follow|unfollow|like|upvote|downvote|share|sign out|signout|log out|logout|message|pay|install|download|open app|claim|join|apply)\b/i;
	const SYSTEMATIC_REVIEW_TYPE = typeof PROJECT_TYPE_SYSTEMATIC_REVIEW != "undefined"
		? PROJECT_TYPE_SYSTEMATIC_REVIEW
		: "systematic_review";
	const CUSTOM_ANALYSIS_TYPE = typeof PROJECT_TYPE_CUSTOM_ANALYSIS != "undefined"
		? PROJECT_TYPE_CUSTOM_ANALYSIS
		: "custom_analysis";

	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function collapseWhitespace(value = "") {
		return String(value || "").replace(/\s+/g, " ").trim();
	}

	function parseBool(value, fallback = false) {
		if (value === undefined || value === null) {
			return fallback;
		}
		if (typeof value == "boolean") {
			return value;
		}
		if (typeof value == "number") {
			return value !== 0;
		}
		let lowered = optionalString(value).toLowerCase();
		if (["1", "true", "yes", "y", "on"].includes(lowered)) {
			return true;
		}
		if (["0", "false", "no", "n", "off"].includes(lowered)) {
			return false;
		}
		return fallback;
	}

	function clampInt(value, min, max, fallback = min) {
		let next = Math.round(Number(value || 0) || 0);
		if (!Number.isFinite(next) || next <= 0) {
			next = fallback;
		}
		return Math.max(min, Math.min(max, next));
	}

	function browserController() {
		if (typeof SystematicReviewerPrivilegedBrowserController == "undefined" || !SystematicReviewerPrivilegedBrowserController) {
			throw new Error("Privileged browser controller is unavailable.");
		}
		return SystematicReviewerPrivilegedBrowserController;
	}

	async function attachmentFilePath(attachment) {
		if (!attachment) {
			return "";
		}
		try {
			if (typeof attachment.getFilePathAsync == "function") {
				return String((await attachment.getFilePathAsync()) || "");
			}
		}
		catch (_error) {}
		try {
			if (typeof attachment.getFilePath == "function") {
				return String(attachment.getFilePath() || "");
			}
		}
		catch (_error) {}
		return "";
	}

	async function attachmentSummary(attachment) {
		if (!attachment) {
			return null;
		}
		let title = "";
		try {
			title = attachment.getField("title");
		}
		catch (_error) {}
		return {
			id: attachment.id,
			key: attachment.key,
			title: optionalString(title),
			content_type: optionalString(attachment.attachmentContentType),
			link_mode: attachment.attachmentLinkMode || null,
			file_path: await attachmentFilePath(attachment),
		};
	}

	function itemSummary(item) {
		if (!item) {
			return null;
		}
		return {
			id: item.id,
			key: item.key,
			title: optionalString(item.getField?.("title") || ""),
			url: optionalString(item.getField?.("url") || ""),
		};
	}

	function projectContextFromToolArgs(args = {}) {
		let context = args?.__sr_tool_context?.project_context;
		return context && typeof context == "object" ? context : null;
	}

	async function resolveProjectRuntime(reviewer, args = {}, options = {}) {
		let requireProject = options?.requireProject !== false;
		let projectContext = projectContextFromToolArgs(args);
		if (projectContext && reviewer?._resolveProjectReference) {
			let resolved = await reviewer._resolveProjectReference(projectContext);
			if (resolved) {
				return resolved;
			}
		}
		let explicitProjectID = optionalString(
			args?.__sr_tool_context?.project_id
			|| args?.project_id
			|| args?.projectID
			|| ""
		);
		let explicitSessionID = optionalString(
			args?.__sr_tool_context?.session_id
			|| args?.session_id
			|| args?.sessionID
			|| ""
		);
		if (explicitProjectID && reviewer?._resolveProjectByID) {
			let resolved = await reviewer._resolveProjectByID(explicitProjectID, {
				sessionID: explicitSessionID,
			});
			if (resolved) {
				return resolved;
			}
		}
		let current = await reviewer?._resolveCurrentProject?.();
		if (current) {
			return current;
		}
		let restored = await reviewer?._restoreLastProjectSelection?.();
		if (restored) {
			return restored;
		}
		if (requireProject) {
			throw new Error("A bound Systematic Reviewer project is required for this browser tool.");
		}
		return null;
	}

	function resolveToolSessionID(reviewer, current = null, args = {}) {
		return optionalString(
			args?.__sr_tool_context?.session_id
			|| args?.session_id
			|| args?.sessionID
			|| current?.sessionID
			|| reviewer?.currentProject?.sessionID
			|| "default"
		) || "default";
	}

	async function ensureSessionArtifactDir(reviewer, current = null, args = {}, leafName = "") {
		let sessionID = resolveToolSessionID(reviewer, current, args);
		let sessionsRoot = optionalString(current?.context?.sessionsDir || "");
		if (!sessionsRoot || !sessionID) {
			return "";
		}
		let sessionDir = reviewer._joinPath(sessionsRoot, sessionID);
		let artifactDir = leafName
			? reviewer._joinPath(sessionDir, leafName)
			: sessionDir;
		await reviewer._ensureDirectory(sessionsRoot);
		await reviewer._ensureDirectory(sessionDir);
		await reviewer._ensureDirectory(artifactDir);
		return artifactDir;
	}

	async function resolveBrowserScreenshotArgs(reviewer, args = {}) {
		let next = Object.assign({}, args || {});
		if (optionalString(next.path || "") || optionalString(next.dir || "")) {
			return next;
		}
		let current = null;
		try {
			current = await resolveProjectRuntime(reviewer, args, { requireProject: false });
		}
		catch (_error) {
			current = null;
		}
		let screenshotDir = await ensureSessionArtifactDir(
			reviewer,
			current,
			args,
			"browser-screenshots"
		).catch(() => "");
		if (screenshotDir) {
			next.dir = screenshotDir;
		}
		return next;
	}

	async function spillBrowserReadMarkdown(reviewer, current = null, args = {}, source = {}, markdown = "") {
		let root = await ensureSessionArtifactDir(reviewer, current, args, "browser-reads").catch(() => "");
		if (!root) {
			return "";
		}
		let url = optionalString(source?.url || "");
		let title = optionalString(source?.title || "");
		let label = title;
		if (!label && url) {
			try {
				label = String(new URL(url).hostname || "");
			}
			catch (_error) {}
		}
		let filename = `browser-read-${Date.now()}-${browserController().sanitizeFilenamePart(label || "page-read", "page-read")}.md`;
		let path = reviewer._joinPath(root, filename);
		await reviewer._writeTextFile(path, `${markdownTrim(markdown)}\n`);
		return path;
	}

	async function resolveProjectType(reviewer, current = null) {
		let direct = optionalString(
			current?.projectType
			|| current?.context?.projectType
			|| current?.settings?.project_type
			|| ""
		);
		if (direct) {
			return direct;
		}
		if (current?.context && reviewer?._projectTypeForContext) {
			return optionalString(await reviewer._projectTypeForContext(current.context, SYSTEMATIC_REVIEW_TYPE));
		}
		return SYSTEMATIC_REVIEW_TYPE;
	}

	function hasExplicitTarget(args = {}) {
		return !!(
			args?.scope !== undefined
			|| args?.review_scope !== undefined
			|| args?.reviewScope !== undefined
			|| args?.collection_key !== undefined
			|| args?.collectionKey !== undefined
			|| args?.scope_collection_key !== undefined
			|| args?.scopeCollectionKey !== undefined
			|| args?.collection_name !== undefined
			|| args?.collectionName !== undefined
			|| args?.scope_collection_name !== undefined
			|| args?.scopeCollectionName !== undefined
		);
	}

	async function resolveTargetCollection(reviewer, current, args = {}) {
		let explicit = hasExplicitTarget(args);
		let projectType = await resolveProjectType(reviewer, current);
		if (explicit) {
			let scope = reviewer._projectScopeDescriptor(current.collection, args);
			return {
				explicit: true,
				project_type: projectType,
				target_collection: scope?.scope_collection || current.collection,
				target_scope: scope || null,
				default_target: false,
				queue_merge: false,
				project_collections: null,
			};
		}
		if (projectType == CUSTOM_ANALYSIS_TYPE) {
			let dataCollection = await reviewer._resolveCustomAnalysisDataCollection(current.collection, {
				createMissing: true,
			});
			return {
				explicit: false,
				project_type: projectType,
				target_collection: dataCollection || current.collection,
				target_scope: null,
				default_target: true,
				queue_merge: false,
				project_collections: null,
			};
		}
		let projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(reviewer, current, {
			ensureAddedByUser: false,
		});
		let webCollection = await reviewer._ensureDirectChildCollection(projectCollections.harvest.root, HARVEST_WEB_COLLECTION_NAME);
		return {
			explicit: false,
			project_type: projectType,
			target_collection: webCollection,
			target_scope: null,
			default_target: true,
			queue_merge: true,
			project_collections: projectCollections,
		};
	}

	async function maybeWithWriteLease(reviewer, current, runner, options = {}) {
		if (typeof runner != "function") {
			return null;
		}
		if (reviewer?._withZoteroWriteLease) {
			return await reviewer._withZoteroWriteLease(current?.context || null, runner, {
				jobID: optionalString(options.jobID || ""),
				ownerKey: optionalString(options.ownerKey || `privileged-browser:${Math.random().toString(36).slice(2, 8)}`),
			});
		}
		return await runner();
	}

	function normalizeSnapshotHTML(raw = "") {
		if (typeof raw == "string") {
			return raw;
		}
		if (raw instanceof Uint8Array) {
			try {
				return new TextDecoder("utf-8").decode(raw);
			}
			catch (_error) {
				return "";
			}
		}
		if (raw && typeof raw == "object") {
			for (let key of ["snapshotContent", "content", "html", "text"]) {
				if (typeof raw[key] == "string" && raw[key].trim()) {
					return raw[key];
				}
			}
		}
		return "";
	}

	async function captureSnapshotHTML(browser, fallbackHTML = "") {
		let snapshotHTML = "";
		let snapshotMode = "serialized_dom";
		let warning = "";
		if (browser && typeof browser.snapshot == "function") {
			try {
				snapshotHTML = normalizeSnapshotHTML(await browser.snapshot());
				if (snapshotHTML) {
					snapshotMode = "native_snapshot";
				}
			}
			catch (error) {
				warning = optionalString(error?.message || error);
			}
		}
		if (!snapshotHTML && browser?.browsingContext?.currentWindowGlobal?.getActor) {
			try {
				let actor = browser.browsingContext.currentWindowGlobal.getActor("SingleFile");
				snapshotHTML = normalizeSnapshotHTML(await actor.sendQuery("snapshot"));
				if (snapshotHTML) {
					snapshotMode = "singlefile_actor";
				}
			}
			catch (error) {
				if (!warning) {
					warning = optionalString(error?.message || error);
				}
			}
		}
		if (!snapshotHTML) {
			snapshotHTML = String(fallbackHTML || "");
		}
		if (!snapshotHTML) {
			throw new Error("Unable to capture page snapshot HTML.");
		}
		return {
			html: snapshotHTML,
			snapshot_mode: snapshotMode,
			warning,
		};
	}

	async function ensureBrowserTempRoot(reviewer) {
		let root = reviewer._joinPath(reviewer._configRoot(), "privileged-browser");
		await reviewer._ensureDirectory(root);
		return root;
	}

	async function createSnapshotAttachment(reviewer, item, pageURL, snapshotHTML, tempRoot) {
		if (typeof Zotero.Attachments?.importFromSnapshotContent == "function") {
			try {
				let attachment = await Zotero.Attachments.importFromSnapshotContent({
					url: pageURL,
					title: SNAPSHOT_TITLE,
					parentItemID: item.id,
					snapshotContent: snapshotHTML,
					contentType: "text/html",
					charset: "utf-8",
				});
				return {
					attachment,
					method: "importFromSnapshotContent",
				};
			}
			catch (_error) {}
		}
		let tempPath = reviewer._joinPath(
			tempRoot,
			`browser-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`
		);
		await reviewer._writeTextFile(tempPath, snapshotHTML);
		try {
			if (typeof Zotero.Attachments?.importSnapshotFromFile == "function") {
				let attachment = await Zotero.Attachments.importSnapshotFromFile({
					file: tempPath,
					url: pageURL,
					title: SNAPSHOT_TITLE,
					contentType: "text/html",
					charset: "utf-8",
					parentItemID: item.id,
					singleFile: true,
					moveFile: true,
				});
				return {
					attachment,
					method: "importSnapshotFromFile",
				};
			}
			let attachment = await Zotero.Attachments.importFromFile({
				file: tempPath,
				parentItemID: item.id,
				title: SNAPSHOT_TITLE,
			});
			return {
				attachment,
				method: "importFromFile",
			};
		}
		finally {
			await reviewer._removeIfExists(tempPath).catch(() => null);
		}
	}

	async function createPDFAttachment(reviewer, browser, item, snapshotHTML, tempRoot) {
		let pdfPath = reviewer._joinPath(
			tempRoot,
			`browser-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
		);
		await SystematicReviewerSavePDF.saveHTMLToPDF({
			win: browser?.ownerGlobal || Zotero.getMainWindow?.() || null,
			html: snapshotHTML,
			outputPath: pdfPath,
		});
		try {
			let attachment = await Zotero.Attachments.importFromFile({
				file: pdfPath,
				parentItemID: item.id,
				title: PDF_TITLE,
			});
			return {
				attachment,
				method: "importFromFile",
			};
		}
		finally {
			await reviewer._removeIfExists(pdfPath).catch(() => null);
		}
	}

	async function queuePDFMarkdown(reviewer, current, item, pdfAttachment) {
		let filePath = await attachmentFilePath(pdfAttachment);
		if (!filePath) {
			return {
				ok: true,
				queued_count: 0,
				jobs: [],
			};
		}
		return await SystematicReviewerWorkflowScreening.queueMarkdownConversionsForSources(reviewer, current, [
			{
				attachment: pdfAttachment,
				parentItem: item,
				kind: "pdf",
				path: filePath,
			},
		]);
	}

	async function queueDefaultSystematicReviewMerge(reviewer, current, targetCollection, projectCollections = null) {
		if (!targetCollection?.key) {
			return {
				ok: true,
				queued: false,
			};
		}
		return await SystematicReviewerWorkflowHarvest.queueMergeSourceIntoPending({
			reviewer,
			current,
			payload: {
				source_collection_key: targetCollection.key,
			},
			options: {
				projectCollections,
				sourceCollection: targetCollection,
			},
		});
	}

	async function maybeQueuePendingEmbeddings(reviewer, current, targetCollection) {
		if (!targetCollection?.key || !reviewer?._hasConfiguredEmbeddingsModelSync?.()) {
			return {
				ok: true,
				queued: false,
			};
		}
		let projectType = await resolveProjectType(reviewer, current);
		if (projectType != SYSTEMATIC_REVIEW_TYPE) {
			return {
				ok: true,
				queued: false,
			};
		}
		let projectCollections = await SystematicReviewerWorkflowHarvest.ensureProjectCollections(reviewer, current, {
			ensureAddedByUser: false,
		});
		if (!projectCollections?.pending?.key || projectCollections.pending.key != targetCollection.key) {
			return {
				ok: true,
				queued: false,
			};
		}
		let result = await SystematicReviewerWorkflowEmbeddings.runEmbeddings({
			reviewer,
			current,
			payload: {
				collection_key: targetCollection.key,
				collection_name: targetCollection.name,
			},
		});
		return Object.assign({
			ok: true,
			queued: true,
		}, result || {});
	}

	function normalizeRelativeHref(href = "", fallbackURL = "") {
		let raw = optionalString(href);
		if (!raw) {
			return "";
		}
		try {
			return String(new URL(raw, fallbackURL || "about:blank").href || raw);
		}
		catch (_error) {
			return raw;
		}
	}

	function markdownEscapeTableCell(value = "") {
		return String(value || "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
	}

	function markdownTrim(text = "") {
		return String(text || "")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/^\s+|\s+$/g, "");
	}

	function inlineText(node, context = {}) {
		if (!node) {
			return "";
		}
		if (node.nodeType == 3) {
			return String(node.nodeValue || "").replace(/\s+/g, " ");
		}
		if (node.nodeType != 1) {
			return "";
		}
		let tag = String(node.tagName || "").toLowerCase();
		if (["script", "style", "noscript", "template"].includes(tag)) {
			return "";
		}
		if (tag == "br") {
			return "\n";
		}
		if (tag == "code") {
			let text = collapseWhitespace(node.textContent || "");
			return text ? `\`${text}\`` : "";
		}
		if (tag == "a") {
			let label = collapseWhitespace(node.textContent || "");
			let href = normalizeRelativeHref(node.getAttribute("href") || "", context.url || "");
			if (!label && !href) {
				return "";
			}
			if (context.includeLinks === false || !href) {
				return label;
			}
			let safeLabel = label || href;
			return `[${safeLabel}](${href})`;
		}
		if (tag == "img") {
			return "";
		}
		let pieces = [];
		for (let child of node.childNodes || []) {
			let rendered = inlineText(child, context);
			if (rendered) {
				pieces.push(rendered);
			}
		}
		let joined = pieces.join("");
		if (["p", "div", "section", "article", "main", "header", "footer", "aside", "li"].includes(tag)) {
			return joined.replace(/\s+/g, " ");
		}
		return joined;
	}

	function collectDirectListText(node, context = {}) {
		let pieces = [];
		for (let child of node.childNodes || []) {
			if (child?.nodeType == 1) {
				let tag = String(child.tagName || "").toLowerCase();
				if (tag == "ul" || tag == "ol") {
					continue;
				}
			}
			let rendered = inlineText(child, context);
			if (rendered) {
				pieces.push(rendered);
			}
		}
		return collapseWhitespace(pieces.join(""));
	}

	function renderTable(node, context = {}) {
		let rows = [];
		for (let tr of node.querySelectorAll("tr") || []) {
			let cells = [];
			for (let cell of tr.children || []) {
				let tag = String(cell.tagName || "").toLowerCase();
				if (tag != "th" && tag != "td") {
					continue;
				}
				cells.push(markdownEscapeTableCell(inlineText(cell, context)));
			}
			if (cells.length) {
				rows.push(cells);
			}
		}
		if (!rows.length) {
			return "";
		}
		let columnCount = Math.max(...rows.map((row) => row.length));
		rows = rows.map((row) => {
			let padded = row.slice();
			while (padded.length < columnCount) {
				padded.push("");
			}
			return padded;
		});
		let firstRowHasHeaders = !!(node.querySelector("thead th") || Array.from(node.querySelectorAll("tr:first-child th") || []).length);
		let header = firstRowHasHeaders
			? rows.shift()
			: Array.from({ length: columnCount }, (_value, index) => `Column ${index + 1}`);
		let divider = Array.from({ length: columnCount }, () => "---");
		let lines = [
			`| ${header.join(" | ")} |`,
			`| ${divider.join(" | ")} |`,
		];
		for (let row of rows) {
			lines.push(`| ${row.join(" | ")} |`);
		}
		return lines.join("\n");
	}

	function renderList(node, ordered = false, depth = 0, context = {}) {
		let items = [];
		let index = 1;
		for (let child of node.children || []) {
			if (String(child.tagName || "").toLowerCase() != "li") {
				continue;
			}
			let prefix = ordered ? `${index}. ` : "- ";
			let indent = "  ".repeat(depth);
			let itemText = collectDirectListText(child, context);
			let lines = [];
			if (itemText) {
				lines.push(`${indent}${prefix}${itemText}`);
			}
			for (let nested of child.children || []) {
				let nestedTag = String(nested.tagName || "").toLowerCase();
				if (nestedTag == "ul" || nestedTag == "ol") {
					let nestedMarkdown = renderList(nested, nestedTag == "ol", depth + 1, context);
					if (nestedMarkdown) {
						lines.push(nestedMarkdown);
					}
				}
			}
			if (lines.length) {
				items.push(lines.join("\n"));
			}
			index += 1;
		}
		return items.join("\n");
	}

	function noiseNode(element) {
		if (!element || element.nodeType != 1) {
			return false;
		}
		let idClass = `${element.id || ""} ${String(element.className || "")}`.toLowerCase();
		let role = optionalString(element.getAttribute?.("role") || "").toLowerCase();
		let aria = optionalString(element.getAttribute?.("aria-label") || "").toLowerCase();
		let dataTest = optionalString(element.getAttribute?.("data-testid") || "").toLowerCase();
		let hint = `${idClass} ${role} ${aria} ${dataTest}`;
		return /(cookie|consent|banner|breadcrumb|newsletter|subscribe|advert|promo|social|share|sidebar|footer|nav|menu|modal|popup|dialog)/i.test(hint);
	}

	function cleanReadableRoot(html = "", url = "") {
		let doc = new DOMParser().parseFromString(String(html || ""), "text/html");
		for (let selector of [
			"script",
			"style",
			"noscript",
			"template",
			"svg",
			"canvas",
			"iframe",
			"video",
			"audio",
			"form",
			"button",
			"input",
			"select",
			"textarea",
		]) {
			for (let node of doc.querySelectorAll(selector) || []) {
				node.remove();
			}
		}
		for (let element of doc.querySelectorAll("header, nav, footer, aside, dialog, [role='dialog'], [role='navigation'], [role='banner'], [role='contentinfo']") || []) {
			if (!element.closest("main, article, [role='main']")) {
				element.remove();
			}
		}
		for (let element of doc.querySelectorAll("body *") || []) {
			if (!element.isConnected) {
				continue;
			}
			if (!element.closest("main, article, [role='main']") && noiseNode(element)) {
				element.remove();
			}
		}
		let root = doc.querySelector("main, article, [role='main']") || doc.body || doc.documentElement;
		return {
			doc,
			root,
			context: {
				url,
			},
		};
	}

	function renderBlocks(node, context = {}) {
		if (!node) {
			return [];
		}
		if (node.nodeType == 3) {
			let text = collapseWhitespace(node.nodeValue || "");
			return text ? [text] : [];
		}
		if (node.nodeType != 1) {
			return [];
		}
		let tag = String(node.tagName || "").toLowerCase();
		if (["script", "style", "noscript", "template"].includes(tag)) {
			return [];
		}
		if (tag == "table") {
			let table = renderTable(node, context);
			return table ? [table] : [];
		}
		if (tag == "pre") {
			let text = String(node.textContent || "").replace(/\n+$/, "");
			return text ? [`\`\`\`\n${text}\n\`\`\``] : [];
		}
		if (tag == "blockquote") {
			let content = markdownTrim(renderBlocks(node, context).join("\n\n"));
			if (!content) {
				return [];
			}
			return [content.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")];
		}
		if (tag == "hr") {
			return ["---"];
		}
		if (tag == "ul" || tag == "ol") {
			let list = renderList(node, tag == "ol", 0, context);
			return list ? [list] : [];
		}
		if (/^h[1-6]$/.test(tag)) {
			let level = Number(tag.slice(1)) || 1;
			let text = collapseWhitespace(inlineText(node, context));
			return text ? [`${"#".repeat(level)} ${text}`] : [];
		}
		if (tag == "p") {
			let text = collapseWhitespace(inlineText(node, context));
			return text ? [text] : [];
		}
		if (tag == "img") {
			let text = inlineText(node, context);
			return text ? [text] : [];
		}
		let childBlocks = [];
		for (let child of node.childNodes || []) {
			childBlocks.push(...renderBlocks(child, context));
		}
		if (["main", "article", "section", "div", "body", "html"].includes(tag)) {
			return childBlocks;
		}
		let inline = collapseWhitespace(inlineText(node, context));
		if (inline && !childBlocks.length) {
			return [inline];
		}
		return childBlocks;
	}

	function truncateMarkdown(markdown = "", maxChars = DEFAULT_READ_MAX_CHARS) {
		let normalized = markdownTrim(markdown);
		if (normalized.length <= maxChars) {
			return {
				markdown: normalized,
				truncated: false,
			};
		}
		let clipped = normalized.slice(0, maxChars);
		let lastBoundary = Math.max(
			clipped.lastIndexOf("\n\n"),
			clipped.lastIndexOf(". "),
			clipped.lastIndexOf(" ")
		);
		if (lastBoundary > Math.max(1000, Math.floor(maxChars * 0.65))) {
			clipped = clipped.slice(0, lastBoundary);
		}
		return {
			markdown: `${markdownTrim(clipped)}\n\n[Truncated after ${maxChars} characters.]`,
			truncated: true,
		};
	}

	function actionLabel(node = {}) {
		return collapseWhitespace([
			node?.text || "",
			node?.ariaLabel || "",
			node?.title || "",
			node?.name || "",
		].join(" "));
	}

	function actionSignature(node = {}) {
		return [
			optionalString(node?.path || ""),
			optionalString(node?.href || ""),
			actionLabel(node),
		].join("|");
	}

	function actionHasSafeHref(node = {}) {
		let href = optionalString(node?.href || "");
		if (!href) {
			return true;
		}
		return href.startsWith("#") || /^javascript:/i.test(href);
	}

	function isDangerousAction(node = {}) {
		return DANGEROUS_ACTION_RE.test(actionLabel(node));
	}

	function rankAction(node = {}) {
		let rect = node?.rect && typeof node.rect == "object" ? node.rect : {};
		return Number(rect?.y || 0) * -1 + Number(rect?.height || 0);
	}

	function isExpandAction(node = {}) {
		let label = actionLabel(node);
		if (!label || node?.visible === false || node?.disabled === true) {
			return false;
		}
		if (isDangerousAction(node) || !actionHasSafeHref(node)) {
			return false;
		}
		if (String(node?.tag || "").toLowerCase() == "summary") {
			return true;
		}
		return EXPAND_ACTION_RE.test(label) && !EXPAND_EXCLUDE_RE.test(label);
	}

	function isLoadMoreAction(node = {}) {
		let label = actionLabel(node);
		if (!label || node?.visible === false || node?.disabled === true) {
			return false;
		}
		if (isDangerousAction(node) || !actionHasSafeHref(node)) {
			return false;
		}
		if (LOAD_MORE_ACTION_RE.test(label)) {
			return true;
		}
		return /\bshow more\b/i.test(label) && LOAD_MORE_CONTEXT_RE.test(label);
	}

	function contentStatsChanged(before = {}, after = {}) {
		return (Number(after?.textLength || 0) > Number(before?.textLength || 0) + 40)
			|| (Number(after?.htmlLength || 0) > Number(before?.htmlLength || 0) + 200)
			|| (Number(after?.documentHeight || 0) > Number(before?.documentHeight || 0) + 40)
			|| (Number(after?.interactiveCount || 0) > Number(before?.interactiveCount || 0));
	}

	async function settleBrowserMutation(windowID = null, waitAfterMs = DEFAULT_ACTION_SETTLE_MS) {
		if (waitAfterMs > 0) {
			await browserController().waitForBrowser({
				window_id: windowID,
				mode: "sleep",
				sleep_ms: waitAfterMs,
			}).catch(() => null);
		}
		await browserController().waitForRenderablePage({
			window_id: windowID,
			timeout_ms: Math.max(1000, Math.min(12000, waitAfterMs || 4000)),
		}).catch(() => null);
	}

	async function expandCurrentPage(_reviewer, args = {}) {
		let controller = browserController();
		let initialState = await controller.getState({
			window_id: args.window_id,
		});
		if (!initialState?.viewer_open) {
			throw new Error("No page is loaded in the privileged browser.");
		}
		let windowID = initialState.window_id;
		let maxRounds = clampInt(args.max_rounds || args.maxRounds, 1, 10, DEFAULT_EXPAND_ROUNDS);
		let maxClicksPerRound = clampInt(args.max_clicks_per_round || args.maxClicksPerRound, 1, 10, DEFAULT_EXPAND_CLICKS_PER_ROUND);
		let waitAfterMs = clampInt(args.wait_after_ms || args.waitAfterMs, 50, 10000, DEFAULT_ACTION_SETTLE_MS);
		let seen = new Set();
		let clicked = [];
		let rounds = 0;
		for (let round = 0; round < maxRounds; round += 1) {
			let clickedThisRound = 0;
			let roundProgress = false;
			for (let step = 0; step < maxClicksPerRound; step += 1) {
				let actions = await controller.listActions({
					window_id: windowID,
					max_nodes: 250,
					include_hidden: false,
					wait_for_load: false,
				});
				let candidates = (Array.isArray(actions?.nodes) ? actions.nodes : [])
					.filter((node) => {
						let signature = actionSignature(node);
						return isExpandAction(node) && signature && !seen.has(signature);
					})
					.sort((left, right) => rankAction(right) - rankAction(left));
				let candidate = candidates[0] || null;
				if (!candidate) {
					break;
				}
				let signature = actionSignature(candidate);
				seen.add(signature);
				let result = await controller.clickElement({
					window_id: windowID,
					action_id: candidate.actionId,
					internal_navigate: false,
					wait_for_load_ms: 0,
				});
				clicked.push({
					action_id: candidate.actionId,
					label: actionLabel(candidate),
					path: optionalString(candidate.path || ""),
					clicked: !!result?.clicked,
				});
				clickedThisRound += 1;
				roundProgress = roundProgress || !!result?.clicked;
				await settleBrowserMutation(windowID, waitAfterMs);
			}
			if (clickedThisRound <= 0) {
				break;
			}
			rounds += 1;
			if (!roundProgress) {
				break;
			}
		}
		return {
			ok: true,
			window_id: windowID,
			rounds,
			clicked_count: clicked.length,
			clicked,
			state: await controller.getState({ window_id: windowID }),
		};
	}

	async function loadMoreCurrentPage(_reviewer, args = {}) {
		let controller = browserController();
		let initialState = await controller.getState({
			window_id: args.window_id,
		});
		if (!initialState?.viewer_open) {
			throw new Error("No page is loaded in the privileged browser.");
		}
		let windowID = initialState.window_id;
		let maxRounds = clampInt(args.max_rounds || args.maxRounds, 1, 20, DEFAULT_LOAD_MORE_ROUNDS);
		let maxClicks = clampInt(args.max_clicks || args.maxClicks, 0, 20, DEFAULT_LOAD_MORE_CLICKS);
		let maxScrolls = clampInt(args.max_scrolls || args.maxScrolls, 0, 40, DEFAULT_LOAD_MORE_SCROLLS);
		let maxTimeMs = clampInt(args.max_time_ms || args.maxTimeMs, 1000, 120000, DEFAULT_LOAD_MORE_TIME_MS);
		let stallRounds = clampInt(args.stall_rounds || args.stallRounds, 1, 8, DEFAULT_LOAD_MORE_STALL_ROUNDS);
		let waitAfterMs = clampInt(args.wait_after_ms || args.waitAfterMs, 50, 10000, DEFAULT_ACTION_SETTLE_MS);
		let startedAt = Date.now();
		let seen = new Set();
		let clicked = [];
		let scrolled = [];
		let rounds = [];
		let totalClicks = 0;
		let totalScrolls = 0;
		let stallCount = 0;
		for (let round = 0; round < maxRounds; round += 1) {
			if (Date.now() - startedAt >= maxTimeMs) {
				break;
			}
			let before = await controller.getContentStats({
				window_id: windowID,
				wait_for_load: false,
			});
			let roundInfo = {
				round: round + 1,
				clicked: null,
				scrolled: null,
				new_content: false,
			};
			let didAction = false;
			if (totalClicks < maxClicks) {
				let actions = await controller.listActions({
					window_id: windowID,
					max_nodes: 250,
					include_hidden: false,
					wait_for_load: false,
				});
				let candidates = (Array.isArray(actions?.nodes) ? actions.nodes : [])
					.filter((node) => {
						let signature = actionSignature(node);
						return isLoadMoreAction(node) && signature && !seen.has(signature);
					})
					.sort((left, right) => rankAction(right) - rankAction(left));
				let candidate = candidates[0] || null;
				if (candidate) {
					let signature = actionSignature(candidate);
					seen.add(signature);
					let result = await controller.clickElement({
						window_id: windowID,
						action_id: candidate.actionId,
						internal_navigate: false,
						wait_for_load_ms: 0,
					});
					totalClicks += 1;
					didAction = true;
					roundInfo.clicked = {
						action_id: candidate.actionId,
						label: actionLabel(candidate),
						path: optionalString(candidate.path || ""),
						clicked: !!result?.clicked,
					};
					clicked.push(roundInfo.clicked);
					await settleBrowserMutation(windowID, waitAfterMs);
				}
			}
			if (!didAction && totalScrolls < maxScrolls) {
				let deltaY = Math.max(300, Math.round(Number(before?.viewportHeight || 0) * 0.85) || 700);
				let result = await controller.scrollPage({
					window_id: windowID,
					delta_y: deltaY,
					behavior: "auto",
				});
				totalScrolls += 1;
				didAction = true;
				roundInfo.scrolled = {
					delta_y: deltaY,
					scroll_y: Number(result?.scrollY || 0),
					document_height: Number(result?.documentHeight || 0),
				};
				scrolled.push(roundInfo.scrolled);
				await settleBrowserMutation(windowID, waitAfterMs);
			}
			if (!didAction) {
				break;
			}
			let after = await controller.getContentStats({
				window_id: windowID,
				wait_for_load: false,
			});
			roundInfo.new_content = contentStatsChanged(before, after);
			rounds.push(roundInfo);
			if (roundInfo.new_content) {
				stallCount = 0;
			}
			else {
				stallCount += 1;
				if (stallCount >= stallRounds) {
					break;
				}
			}
		}
		return {
			ok: true,
			window_id: windowID,
			rounds,
			clicked_count: clicked.length,
			scroll_count: scrolled.length,
			stall_rounds: stallCount,
			time_ms: Date.now() - startedAt,
			state: await controller.getState({ window_id: windowID }),
		};
	}

	async function readCurrentPage(reviewer, args = {}) {
		let controller = browserController();
		if (args.handle_cookies === true || args.handleCookies === true) {
			await controller.handleCookieBanners({
				window_id: args.window_id,
				mode: args.cookie_mode || args.cookieMode || "necessary_or_reject",
				max_rounds: args.cookie_max_rounds || args.cookieMaxRounds,
				max_clicks: args.cookie_max_clicks || args.cookieMaxClicks,
				delay_ms: args.cookie_delay_ms || args.cookieDelayMs,
			}).catch(() => null);
		}
		let extracted = await controller.extractPageContent({
			window_id: args.window_id,
			selector: optionalString(args.selector || ""),
			viewport_only: parseBool(args.viewport_only ?? args.viewportOnly, false),
			timeout_ms: args.timeout_ms || DEFAULT_WAIT_TIMEOUT_MS,
			command_timeout_ms: args.command_timeout_ms || args.timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS,
			wait_for_renderable: args.wait_for_renderable !== false,
			render_wait_ms: args.render_wait_ms || args.timeout_ms || 12000,
		});
		let cleaned = cleanReadableRoot(extracted?.html || "", extracted?.url || "");
		let includeLinks = parseBool(args.include_links ?? args.includeLinks, true);
		cleaned.context.includeLinks = includeLinks;
		let blocksWithContext = renderBlocks(cleaned.root, cleaned.context);
		let markdown = markdownTrim(blocksWithContext.join("\n\n"));
		let limit = clampInt(args.max_chars || args.maxChars, MIN_READ_MAX_CHARS, MAX_READ_MAX_CHARS, DEFAULT_READ_MAX_CHARS);
		let truncated = truncateMarkdown(markdown, limit);
		let current = null;
		let markdownPath = "";
		try {
			current = await resolveProjectRuntime(reviewer, args, { requireProject: false });
		}
		catch (_error) {
			current = null;
		}
		if (markdown.length > limit) {
			markdownPath = await spillBrowserReadMarkdown(reviewer, current, args, extracted, markdown).catch(() => "");
		}
		let state = await controller.getState({
			window_id: args.window_id,
		});
		return {
			ok: true,
			window_id: state?.window_id || null,
			url: optionalString(extracted?.url || ""),
			title: optionalString(extracted?.title || ""),
			markdown: truncated.markdown,
			truncated: truncated.truncated,
			max_chars: limit,
			selector: optionalString(extracted?.selector || ""),
			viewport_only: extracted?.viewportOnly === true,
			include_links: includeLinks,
			markdown_path: optionalString(markdownPath),
			full_markdown_length: markdown.length,
			source_html_length: String(extracted?.html || "").length,
		};
	}

	async function savePageToProject(reviewer, args = {}) {
		let controller = browserController();
		let current = await resolveProjectRuntime(reviewer, args, { requireProject: true });
		if (!current?.context || !current?.collection) {
			throw new Error("A bound project is required to save the current page.");
		}
		let browser = controller.getBrowserOrThrow({
			window_id: args.window_id,
		});
		if (args.handle_cookies !== false && args.handleCookies !== false) {
			await controller.handleCookieBanners({
				window_id: args.window_id,
				mode: args.cookie_mode || args.cookieMode || "necessary_or_reject",
				max_rounds: args.cookie_max_rounds || args.cookieMaxRounds,
				max_clicks: args.cookie_max_clicks || args.cookieMaxClicks,
				delay_ms: args.cookie_delay_ms || args.cookieDelayMs,
			}).catch(() => null);
		}
		let state = await controller.getState({
			window_id: args.window_id,
		});
		if (!state?.viewer_open || !optionalString(state.url)) {
			throw new Error("No page is loaded in the privileged browser.");
		}
		let serialized = await controller.serializeCurrentPage({
			window_id: args.window_id,
			timeout_ms: args.timeout_ms || DEFAULT_WAIT_TIMEOUT_MS,
			command_timeout_ms: args.command_timeout_ms || args.timeout_ms || 20000,
			wait_for_renderable: args.wait_for_renderable !== false,
			render_wait_ms: args.render_wait_ms || 12000,
		});
		let snapshotCapture = await captureSnapshotHTML(browser, serialized?.html || "");
		let tempRoot = await ensureBrowserTempRoot(reviewer);
		let target = null;
		let created = await maybeWithWriteLease(reviewer, current, async () => {
			target = await resolveTargetCollection(reviewer, current, args);
			let item = new Zotero.Item("webpage");
			item.libraryID = current.collection.libraryID || current.context.libraryID || Zotero.Libraries.userLibraryID;
			item.setField("title", optionalString(args.title || state.title || state.url) || "Webpage");
			item.setField("url", optionalString(state.url));
			item.setField("accessDate", "CURRENT_TIMESTAMP");
			if (target.target_collection?.id) {
				item.setCollections([target.target_collection.id]);
			}
			await item.saveTx();
			let snapshot = await createSnapshotAttachment(
				reviewer,
				item,
				optionalString(state.url),
				snapshotCapture.html,
				tempRoot
			);
			let pdf = await createPDFAttachment(
				reviewer,
				browser,
				item,
				snapshotCapture.html,
				tempRoot
			);
			return {
				item,
				snapshot_attachment: snapshot.attachment,
				snapshot_method: snapshot.method,
				pdf_attachment: pdf.attachment,
				pdf_method: pdf.method,
			};
		}, {
			ownerKey: "privileged-browser-save",
		});
		let markdownQueue = await queuePDFMarkdown(reviewer, current, created.item, created.pdf_attachment);
		let mergeQueue = null;
		if (target.queue_merge === true) {
			mergeQueue = await queueDefaultSystematicReviewMerge(
				reviewer,
				current,
				target.target_collection,
				target.project_collections
			);
		}
		let embeddingsQueue = null;
		if (target.explicit === true) {
			embeddingsQueue = await maybeQueuePendingEmbeddings(reviewer, current, target.target_collection).catch((error) => ({
				ok: false,
				queued: false,
				error: optionalString(error?.message || error),
			}));
		}
		return {
			ok: true,
			project_id: optionalString(current.context.projectID),
			project_type: await resolveProjectType(reviewer, current),
			target: {
				explicit: target.explicit,
				default_target: target.default_target,
				collection_key: optionalString(target.target_collection?.key),
				collection_name: optionalString(target.target_collection?.name),
			},
			page: {
				url: optionalString(state.url),
				title: optionalString(state.title),
			},
			item: itemSummary(created.item),
			snapshot_mode: snapshotCapture.snapshot_mode,
			snapshot_warning: snapshotCapture.warning || "",
			snapshot_attachment: await attachmentSummary(created.snapshot_attachment),
			pdf_attachment: await attachmentSummary(created.pdf_attachment),
			markdown_queue: markdownQueue,
			merge_queue: mergeQueue,
			embeddings_queue: embeddingsQueue,
		};
	}

	function browserOpenTool(reviewer) {
		return {
			id: "sr.browserOpen",
			description: "Open a URL in the privileged Zotero browser window, optionally in a new window.",
			inputShape: {
				url: "required http(s), file, or about URL",
				new_window: "optional boolean",
				window_id: "optional existing browser window id",
				timeout_ms: "optional integer milliseconds",
			},
			execute: async (args = {}) => await browserController().openURL(args.url, args),
		};
	}

	function browserListWindowsTool() {
		return {
			id: "sr.browserListWindows",
			description: "List privileged browser windows and the current active page state.",
			inputShape: {},
			execute: async () => ({
				ok: true,
				...(browserController().listViewerWindows()),
			}),
		};
	}

	function browserFocusWindowTool() {
		return {
			id: "sr.browserFocusWindow",
			description: "Focus one privileged browser window by id.",
			inputShape: {
				window_id: "required integer browser window id",
			},
			execute: async (args = {}) => ({
				ok: true,
				...(browserController().focusViewerWindow(args.window_id || args.windowID)),
			}),
		};
	}

	function browserCloseWindowTool() {
		return {
			id: "sr.browserCloseWindow",
			description: "Close one privileged browser window, or the active one when window_id is omitted.",
			inputShape: {
				window_id: "optional integer browser window id",
			},
			execute: async (args = {}) => ({
				ok: true,
				...(browserController().closeViewerWindow(args.window_id || args.windowID || null)),
			}),
		};
	}

	function browserCloseAllWindowsTool() {
		return {
			id: "sr.browserCloseAllWindows",
			description: "Close all privileged browser windows.",
			inputShape: {},
			execute: async () => ({
				ok: true,
				...(browserController().closeAllViewerWindows()),
			}),
		};
	}

	function browserStateTool() {
		return {
			id: "sr.browserState",
			description: "Return the current state of the privileged browser, including URL, title, and window metadata.",
			inputShape: {
				window_id: "optional integer browser window id",
			},
			execute: async (args = {}) => ({
				ok: true,
				...(await browserController().getState(args)),
			}),
		};
	}

	function browserNavigateTool() {
		return {
			id: "sr.browserNavigate",
			description: "Navigate the active privileged browser window by URL or action such as back, forward, reload, or stop.",
			inputShape: {
				url: "optional URL to open",
				action: "optional: back | forward | reload | stop | home",
				window_id: "optional integer browser window id",
				timeout_ms: "optional integer milliseconds",
				wait_for_load: "optional boolean",
			},
			execute: async (args = {}) => await browserController().navigate(args),
		};
	}

	function browserWaitTool() {
		return {
			id: "sr.browserWait",
			description: "Wait for the browser to load, render, or simply sleep for a specified duration.",
			inputShape: {
				mode: "optional: load | render | load_render | sleep",
				window_id: "optional integer browser window id",
				timeout_ms: "optional integer milliseconds",
				sleep_ms: "optional integer milliseconds when mode=sleep",
			},
			execute: async (args = {}) => await browserController().waitForBrowser(args),
		};
	}

	function browserActionsTool() {
		return {
			id: "sr.browserActions",
			description: "List the currently visible interactive elements and action candidates on the page.",
			inputShape: {
				window_id: "optional integer browser window id",
				max_nodes: "optional integer limit",
				include_hidden: "optional boolean",
			},
			execute: async (args = {}) => await browserController().listActions(args),
		};
	}

	function browserSummaryTool() {
		return {
			id: "sr.browserSummary",
			description: "Return a concise summary of the current page and its visible action candidates.",
			inputShape: {
				window_id: "optional integer browser window id",
				max_nodes: "optional integer limit",
			},
			execute: async (args = {}) => await browserController().getSummary(args),
		};
	}

	function browserClickTool() {
		return {
			id: "sr.browserClick",
			description: "Click an element on the current page by action id, selector, CSS path, or visible text.",
			inputShape: {
				window_id: "optional integer browser window id",
				action_id: "optional integer from browser__actions",
				selector: "optional CSS selector",
				path: "optional CSS path from browser__actions",
				text: "optional visible text matcher",
				exact: "optional boolean",
				wait_for_load_ms: "optional integer milliseconds after click",
			},
			execute: async (args = {}) => await browserController().clickElement(args),
		};
	}

	function browserTypeTool() {
		return {
			id: "sr.browserType",
			description: "Type text into an input, textarea, or contenteditable element on the current page.",
			inputShape: {
				window_id: "optional integer browser window id",
				action_id: "optional integer from browser__actions",
				selector: "optional CSS selector",
				path: "optional CSS path",
				text: "optional visible text matcher",
				value: "required string",
				press_enter: "optional boolean",
			},
			execute: async (args = {}) => await browserController().typeIntoElement(args),
		};
	}

	function browserSelectTool() {
		return {
			id: "sr.browserSelect",
			description: "Choose an option in a select element by value, label, or index.",
			inputShape: {
				window_id: "optional integer browser window id",
				action_id: "optional integer from browser__actions",
				selector: "optional CSS selector",
				path: "optional CSS path",
				text: "optional visible text matcher",
				value: "optional option value",
				label: "optional option label",
				index: "optional zero-based integer index",
			},
			execute: async (args = {}) => await browserController().selectElement(args),
		};
	}

	function browserScrollTool() {
		return {
			id: "sr.browserScroll",
			description: "Scroll the current page by amount, absolute position, or to the top or bottom.",
			inputShape: {
				window_id: "optional integer browser window id",
				to: "optional: top | bottom",
				x: "optional absolute x position",
				y: "optional absolute y position",
				delta_y: "optional scroll delta",
				behavior: "optional: auto | smooth",
			},
			execute: async (args = {}) => await browserController().scrollPage(args),
		};
	}

	function browserExpandPageTool(reviewer) {
		return {
			id: "sr.browserExpandPage",
			description: "Reveal bounded hidden content on the current page by clicking low-risk expand, read-more, or details controls without navigating away.",
			inputShape: {
				window_id: "optional integer browser window id",
				max_rounds: "optional integer bounded expansion rounds",
				max_clicks_per_round: "optional integer click cap per round",
				wait_after_ms: "optional integer milliseconds to let the page settle after each click",
			},
			execute: async (args = {}) => await expandCurrentPage(reviewer, args),
		};
	}

	function browserLoadMoreTool(reviewer) {
		return {
			id: "sr.browserLoadMore",
			description: "Boundedly continue lists, comments, or feed-like content by clicking load-more style controls or scrolling without running forever.",
			inputShape: {
				window_id: "optional integer browser window id",
				max_rounds: "optional integer overall rounds",
				max_clicks: "optional integer cap on load-more style button clicks",
				max_scrolls: "optional integer cap on scroll continuation attempts",
				max_time_ms: "optional integer total time cap in milliseconds",
				stall_rounds: "optional integer rounds allowed with no new content before stopping",
				wait_after_ms: "optional integer milliseconds to let the page settle after each action",
			},
			execute: async (args = {}) => await loadMoreCurrentPage(reviewer, args),
		};
	}

	function browserHandleCookiesTool() {
		return {
			id: "sr.browserHandleCookies",
			description: "Attempt to dismiss cookie banners or consent dialogs on the current page.",
			inputShape: {
				window_id: "optional integer browser window id",
				mode: "optional: necessary_or_reject | necessary | reject",
				max_rounds: "optional integer",
				max_clicks: "optional integer",
				delay_ms: "optional integer milliseconds",
			},
			execute: async (args = {}) => await browserController().handleCookieBanners(args),
		};
	}

	function browserSerializeTool() {
		return {
			id: "sr.browserSerialize",
			description: "Serialize the current live page DOM to HTML for debugging or further processing.",
			inputShape: {
				window_id: "optional integer browser window id",
				timeout_ms: "optional integer milliseconds",
				wait_for_renderable: "optional boolean",
			},
			execute: async (args = {}) => await browserController().serializeCurrentPage(args),
		};
	}

	function browserScreenshotTool(reviewer) {
		return {
			id: "sr.browserScreenshot",
			description: "Capture a screenshot of the current page or full page from the privileged browser.",
			inputShape: {
				project_id: "optional stored project id when using developer testing without an already bound project",
				session_id: "optional project session id for default artifact placement",
				window_id: "optional integer browser window id",
				mode: "optional: viewport | fullpage_stitched | fullpage_tiles",
				wait_for_renderable: "optional boolean",
				scale: "optional number; final output scale, similar to PDF VLM image scale",
				oversample: "optional number; higher capture oversampling before downsampling, similar to PDF VLM image oversample",
				force_single_output: "optional boolean for one tall image when possible",
				max_single_height_px: "optional integer output height cap when forcing one image",
				max_segment_height_px: "optional integer output height cap per stitched image segment",
				path: "optional absolute output path",
				dir: "optional output directory",
				filename: "optional file name",
			},
			execute: async (args = {}) => {
				let prepared = await resolveBrowserScreenshotArgs(reviewer, args);
				return await browserController().takeScreenshot(prepared);
			},
		};
	}

	function browserReadPageTool(reviewer) {
		return {
			id: "sr.browserReadPage",
			description: "Read the current live page as cleaned markdown for docs lookup, research, or transient browsing without saving evidence into the project. Large reads automatically spill the full markdown into the active session folder and return the file path.",
			inputShape: {
				window_id: "optional integer browser window id",
				selector: "optional CSS selector to read only one subtree of the current page",
				viewport_only: "optional boolean to restrict the read to content intersecting the visible viewport",
				handle_cookies: "optional boolean",
				include_links: "optional boolean; defaults to true",
				wait_for_renderable: "optional boolean",
				timeout_ms: "optional integer milliseconds",
				max_chars: "optional integer markdown character limit",
			},
			execute: async (args = {}) => await readCurrentPage(reviewer, args),
		};
	}

	function browserSavePageTool(reviewer) {
		return {
			id: "sr.browserSavePageToProject",
			description: "Save the current page into the active project as a Zotero webpage item with a snapshot and native PDF, then queue the normal follow-up work for that project type.",
			inputShape: {
				project_id: "optional stored project id when using developer testing without an already bound project",
				window_id: "optional integer browser window id",
				collection_key: "optional explicit in-project target collection key",
				collection_name: "optional explicit in-project target collection name",
				scope: "optional review scope or in-project target name",
				handle_cookies: "optional boolean; defaults to true",
				timeout_ms: "optional integer milliseconds",
			},
			execute: async (args = {}) => await savePageToProject(reviewer, args),
		};
	}

	function getSessionTools(reviewer) {
		return [
			browserOpenTool(reviewer),
			browserListWindowsTool(),
			browserFocusWindowTool(),
			browserCloseWindowTool(),
			browserCloseAllWindowsTool(),
			browserStateTool(),
			browserNavigateTool(),
			browserWaitTool(),
			browserActionsTool(),
			browserSummaryTool(),
			browserClickTool(),
			browserTypeTool(),
			browserSelectTool(),
			browserScrollTool(),
			browserExpandPageTool(reviewer),
			browserLoadMoreTool(reviewer),
			browserHandleCookiesTool(),
			browserSerializeTool(),
			browserScreenshotTool(reviewer),
			browserReadPageTool(reviewer),
			browserSavePageTool(reviewer),
		].filter(Boolean);
	}

	function getSessionPromptIntro(_reviewer = null) {
		if (typeof SystematicReviewerPrivilegedBrowserPrompts == "undefined") {
			return "";
		}
		return optionalString(SystematicReviewerPrivilegedBrowserPrompts?.sessionBrowserIntro?.() || "");
	}

	return {
		getSessionTools,
		getSessionPromptIntro,
	};
})();
