var SystematicReviewerPDFMarkdown = (() => {
	const PDF_WORKER_SRC = "resource://zotero/reader/pdf/build/pdf.worker.mjs";
	const PDF_CMAP_URL = "resource://zotero/reader/pdf/web/cmaps/";
	const PDF_STANDARD_FONTS_URL = "resource://zotero/reader/pdf/web/standard_fonts/";
	const PDF_WASM_URL = "resource://zotero/reader/pdf/web/wasm/";
	const READER_HTML_URL = "resource://zotero/reader/reader.html";
	const HTML_NS = "http://www.w3.org/1999/xhtml";
	const HIDDEN_READER_PREVIEW_TIMEOUT_MS = 60000;
	const PDF_RENDER_HOST_READY_TIMEOUT_MS = 60000;
	const PDF_RENDER_REQUEST_TIMEOUT_MS = 120000;

	const DEFAULT_VLM_PROMPT =
		"Convert this page to markdown. Do not miss any text and only output the bare markdown! Any graphs or figures found convert to markdown table. If figure is image without details, describe what you see in the image. For tables, pay attention to whitespace: some cells may be intentionally empty, so keep empty and filled cells in the correct columns. Ensure correct assignment of column headings and subheadings for tables.";
	const DEFAULT_IMAGE_VLM_PROMPT =
		"Describe this image in high detail and output clean markdown. Include all visible text exactly, preserve structure, and use markdown tables when tabular content is present. For charts or figures, summarize key visual elements and values if readable.";
	const FAST_MACHINE_READABILITY_HINT_A = "machine-readability gate rejected";
	const FAST_MACHINE_READABILITY_HINT_B = "content appears non-machine-readable";

	const DEFAULT_RUNTIME = {
		nPredict: 5000,
		nCtx: 32768,
		nBatch: 2048,
		nUbatch: 2048,
		nParallel: 4,
		nThreads: 8,
		nThreadsBatch: 8,
		scale: 2.0,
		oversample: 1.5,
		maxRetries: 2,
	};

	let _pdfJSImportPromise = null;
	let _runtimeRequestQueue = [];
	let _runtimeActiveCounts = new Map();
	let _runtimeBlockingOwner = "";
	let _runtimeBlockingCount = 0;

	function runtimeRequestMeta(client = {}) {
		let schedulerKey = String(
			client?.schedulerKey ||
			`${String(client?.runtimeType || client?.baseUrl || "runtime").trim()}::${String(client?.model || "model").trim()}`
		).trim();
		if (!schedulerKey) {
			schedulerKey = "runtime::model";
		}
		let parallelRequests = Math.max(1, Number(client?.parallelRequests || 1) || 1);
		return {
			schedulerKey,
			parallelRequests,
			independentResources: !!client?.independentResources,
		};
	}

	function activeRuntimeCount(schedulerKey = "") {
		return Number(_runtimeActiveCounts.get(String(schedulerKey || "").trim()) || 0) || 0;
	}

	function canStartRuntimeRequest(entry) {
		let meta = runtimeRequestMeta(entry?.client || {});
		if (activeRuntimeCount(meta.schedulerKey) >= meta.parallelRequests) {
			return false;
		}
		if (meta.independentResources) {
			return true;
		}
		return !_runtimeBlockingOwner || _runtimeBlockingOwner == meta.schedulerKey;
	}

	function pumpRuntimeRequestQueue() {
		let madeProgress = true;
		while (madeProgress) {
			madeProgress = false;
			for (let index = 0; index < _runtimeRequestQueue.length; index += 1) {
				let entry = _runtimeRequestQueue[index];
				if (!entry || !canStartRuntimeRequest(entry)) {
					continue;
				}
				_runtimeRequestQueue.splice(index, 1);
				startRuntimeRequest(entry);
				madeProgress = true;
				break;
			}
		}
	}

	function startRuntimeRequest(entry) {
		let meta = runtimeRequestMeta(entry?.client || {});
		_runtimeActiveCounts.set(meta.schedulerKey, activeRuntimeCount(meta.schedulerKey) + 1);
		if (!meta.independentResources) {
			_runtimeBlockingOwner = meta.schedulerKey;
			_runtimeBlockingCount += 1;
		}
		Promise.resolve()
			.then(() => entry.run())
			.then((value) => entry.resolve(value), (error) => entry.reject(error))
			.finally(() => {
				let nextCount = Math.max(0, activeRuntimeCount(meta.schedulerKey) - 1);
				if (nextCount > 0) {
					_runtimeActiveCounts.set(meta.schedulerKey, nextCount);
				}
				else {
					_runtimeActiveCounts.delete(meta.schedulerKey);
				}
				if (!meta.independentResources) {
					_runtimeBlockingCount = Math.max(0, _runtimeBlockingCount - 1);
					if (_runtimeBlockingOwner == meta.schedulerKey && _runtimeBlockingCount <= 0) {
						_runtimeBlockingOwner = "";
						_runtimeBlockingCount = 0;
					}
				}
				pumpRuntimeRequestQueue();
			});
	}

	function scheduleRuntimeRequest(client, run) {
		return new Promise((resolve, reject) => {
			let entry = {
				client,
				run,
				resolve,
				reject,
			};
			_runtimeRequestQueue.push(entry);
			pumpRuntimeRequestQueue();
		});
	}

	function runtimeDefaults(runtime = {}) {
		let merged = Object.assign({}, DEFAULT_RUNTIME, runtime || {});
		if (!merged.nThreadsBatch || merged.nThreadsBatch <= 0) {
			merged.nThreadsBatch = merged.nThreads;
		}
		return merged;
	}

	function normalizeNewlines(input) {
		return String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	}

	function stripInvisibleTextControls(input) {
		return [...String(input || "")]
			.filter((ch) => !isInvisibleTextControl(ch))
			.join("");
	}

	function isInvisibleTextControl(ch) {
		if (ch === "\n" || ch === "\t") {
			return false;
		}
		let code = ch.codePointAt(0) || 0;
		return (
			(((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) &&
				code !== 0x09 &&
				code !== 0x0a) ||
			["\uFEFF", "\u200B", "\u200C", "\u200D", "\u2060"].includes(ch)
		);
	}

	function fixSymbolMojibake(input) {
		let replacements = [
			["Î±", "α"], ["Î²", "β"], ["Î³", "γ"], ["Î´", "δ"], ["Îµ", "ε"],
			["Î¸", "θ"], ["Î»", "λ"], ["Î¼", "μ"], ["Î”", "Δ"], ["Î£", "Σ"],
			["Î©", "Ω"], ["Ï€", "π"], ["Ïƒ", "σ"], ["Ï‰", "ω"], ["Ï†", "φ"],
			["Ïˆ", "ψ"], ["Â±", "±"], ["Â·", "·"], ["Âµ", "μ"], ["âˆ’", "−"],
			["â‰¤", "≤"], ["â‰¥", "≥"], ["â‰ˆ", "≈"], ["âˆš", "√"], ["âˆ‘", "∑"],
			["âˆ", "∏"], ["âˆ«", "∫"], ["âˆ‚", "∂"], ["âˆž", "∞"], ["â†’", "→"],
			["â‡’", "⇒"],
		];
		let text = String(input || "");
		for (let [bad, good] of replacements) {
			text = text.replaceAll(bad, good);
		}
		return text;
	}

	function fixCommonMojibake(input) {
		let replacements = [
			["Ã¯Â»Â¿", ""],
			["Ã¢â‚¬â„¢", "\u2019"],
			["Ã¢â‚¬Ëœ", "\u2018"],
			["Ã¢â‚¬Å“", "\u201C"],
			["Ã¢â‚¬\u009d", "\u201D"],
			["Ã¢â‚¬â€œ", "\u2013"],
			["Ã¢â‚¬â€\u009d", "\u2014"],
			["Ã¢â‚¬Â¦", "\u2026"],
			["Ã¢â‚¬Â¢", "\u2022"],
			["Ã‚ ", " "],
			["Ã‚", ""],
			["â€™", "\u2019"],
			["â€˜", "\u2018"],
			["â€œ", "\u201C"],
			["â€\u009d", "\u201D"],
			["â€“", "\u2013"],
			["â€”", "\u2014"],
			["â€¦", "\u2026"],
			["â€¢", "\u2022"],
			["Â±", "\u00B1"],
			["Â·", "\u00B7"],
			["âˆ’", "\u2212"],
			["â‰¤", "\u2264"],
			["â‰¥", "\u2265"],
			["â‰ˆ", "\u2248"],
			["âˆš", "\u221A"],
			["â†’", "\u2192"],
			["â‡’", "\u21D2"],
		];
		let text = String(input || "");
		for (let [bad, good] of replacements) {
			text = text.replaceAll(bad, good);
		}
		return fixSymbolMojibake(text);
	}

	function normalizeTextBasic(input) {
		let text = normalizeNewlines(input);
		let stripped = stripInvisibleTextControls(text).replaceAll("\u00A0", " ");
		let mojibake = fixCommonMojibake(stripped);
		let visible = stripInvisibleTextControls(mojibake);
		let trimmedLines = visible
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n");
		return trimmedLines.replace(/\n{3,}/g, "\n\n").trim();
	}

	function splitFastTextIntoPages(input) {
		return normalizeNewlines(input)
			.split("\f")
			.map((pageText) => normalizeTextBasic(pageText))
			.filter(Boolean);
	}

	function joinPagesWithFastMarkers(pageBlocks) {
		return pageBlocks
			.map((pageText, index) => `<-page${index + 1}->\n${String(pageText || "").trimEnd()}`)
			.join("\n\n");
	}

	function joinPagesWithVlmMarkers(rows) {
		return rows
			.map((row) => `<--page${row.page}-->\n\n${String(row.markdown || "").trimEnd()}`)
			.join("\n\n");
	}

	function tokenLooksWordlike(token) {
		let normalized = String(token || "").replace(
			/^[\p{P}\u2018\u2019\u201C\u201D]+|[\p{P}\u2018\u2019\u201C\u201D]+$/gu,
			""
		);
		if (!normalized) {
			return false;
		}
		let letterCount = 0;
		let vowelCount = 0;
		for (let ch of normalized) {
			if (/\p{L}/u.test(ch)) {
				letterCount += 1;
				if ("aeiouy".includes(ch.toLowerCase())) {
					vowelCount += 1;
				}
			}
		}
		return letterCount >= 3 && vowelCount >= 1;
	}

	function hasLongAsciiPunctuationRun(input, minLen) {
		let run = 0;
		for (let ch of String(input || "")) {
			if (/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(ch)) {
				run += 1;
				if (run >= minLen) {
					return true;
				}
			}
			else if (!/\s/.test(ch)) {
				run = 0;
			}
		}
		return false;
	}

	function lineLooksGarbled(line) {
		let trimmed = String(line || "").trim();
		let nonSpaceChars = [...trimmed].filter((ch) => !/\s/.test(ch)).length;
		if (nonSpaceChars < 28) {
			return false;
		}
		let tokens = trimmed.split(/\s+/).filter(Boolean);
		if (tokens.length < 5) {
			return false;
		}
		let alpha = [...trimmed].filter((ch) => !/\s/.test(ch) && /\p{L}/u.test(ch)).length;
		let asciiPunct = [...trimmed].filter(
			(ch) => !/\s/.test(ch) && /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(ch)
		).length;
		let alphaRatio = alpha / nonSpaceChars;
		let punctRatio = asciiPunct / nonSpaceChars;
		let wordlikeTokens = tokens.filter(tokenLooksWordlike).length;
		let wordlikeRatio = wordlikeTokens / tokens.length;
		let longPunctRun = hasLongAsciiPunctuationRun(trimmed, 5);
		return (
			(punctRatio >= 0.3 && alphaRatio <= 0.55 && wordlikeRatio <= 0.35) ||
			(punctRatio >= 0.45 && alphaRatio <= 0.7) ||
			(longPunctRun && wordlikeRatio <= 0.45 && alphaRatio <= 0.6)
		);
	}

	function updateReadabilityStats(stats, pageText, pageNumber) {
		let pageContentLines = 0;
		let pageSuspiciousLines = 0;
		for (let line of String(pageText || "").split("\n").map((value) => value.trim())) {
			if (!line) {
				continue;
			}
			pageContentLines += 1;
			if (lineLooksGarbled(line)) {
				pageSuspiciousLines += 1;
			}
		}
		stats.contentLines += pageContentLines;
		stats.suspiciousLines += pageSuspiciousLines;
		let pageSuspicious =
			((pageContentLines >= 8 &&
				pageSuspiciousLines >= 5 &&
				pageSuspiciousLines / pageContentLines >= 0.45) ||
				pageSuspiciousLines >= 12);
		if (pageSuspicious) {
			stats.suspiciousPages.push(pageNumber);
		}
	}

	function looksNonMachineReadable(pageCount, stats) {
		if (stats.contentLines === 0) {
			return true;
		}
		let suspiciousPages = stats.suspiciousPages.length;
		let suspiciousPageRatio = suspiciousPages / Math.max(1, pageCount);
		return (
			(suspiciousPageRatio >= 0.2 && stats.suspiciousLines >= 20) ||
			(suspiciousPageRatio >= 0.1 && stats.suspiciousLines >= 35) ||
			(suspiciousPages >= 8 && stats.suspiciousLines >= 60)
		);
	}

	function ensureMachineReadableText(pdfPath, pageCount, pageTexts) {
		let stats = {
			contentLines: 0,
			suspiciousLines: 0,
			suspiciousPages: [],
		};
		pageTexts.forEach((pageText, index) => updateReadabilityStats(stats, pageText, index + 1));
		if (!looksNonMachineReadable(pageCount, stats)) {
			return;
		}
		let samplePages = stats.suspiciousPages.slice(0, 6).join(", ");
		throw new Error(
			`Machine-readability gate rejected ${pdfPath}: content appears non-machine-readable (likely broken/missing Unicode font mapping). Suspicious pages: [${samplePages}]. Use a different PDF source or OCR fallback.`
		);
	}

	function sameFontBucket(a, b) {
		return Math.abs(a - b) <= 0.11;
	}

	function inferBodyFontSize(lines) {
		let buckets = new Map();
		for (let line of lines) {
			let trimmed = String(line.text || "").trim();
			if (!trimmed) {
				continue;
			}
			let bucket = Math.round((line.fontSize || 0) * 10);
			let weight = Math.max(1, [...trimmed].length);
			buckets.set(bucket, (buckets.get(bucket) || 0) + weight);
		}
		let best = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
		return best ? best[0] / 10 : 11.0;
	}

	function inferGlobalHeadingBuckets(pages) {
		let allLines = pages.flatMap((page) => page.lines || []);
		if (!allLines.length) {
			return [null, null];
		}
		let bodyFont = inferBodyFontSize(allLines);
		let minHeadingSize = Math.max(bodyFont + 2.2, bodyFont * 1.22);
		let counts = new Map();
		for (let line of allLines) {
			let bucket = Math.round((line.fontSize || 0) * 10);
			let bucketSize = bucket / 10;
			if (bucketSize >= minHeadingSize) {
				counts.set(bucket, (counts.get(bucket) || 0) + 1);
			}
		}
		let buckets = [...counts.entries()]
			.filter(([, count]) => count >= 2)
			.map(([bucket]) => bucket / 10)
			.sort((a, b) => b - a);
		let deduped = [];
		for (let bucket of buckets) {
			if (!deduped.some((existing) => sameFontBucket(existing, bucket))) {
				deduped.push(bucket);
			}
		}
		return [deduped[0] || null, deduped[1] || null];
	}

	function detectHeadingGroupsBySize(lines, headingOneBucket, headingTwoBucket) {
		if (headingOneBucket == null) {
			return [];
		}
		let groups = [];
		let current = null;
		for (let line of lines) {
			let bucket = Math.round((line.fontSize || 0) * 10) / 10;
			let level = sameFontBucket(bucket, headingOneBucket)
				? 1
				: headingTwoBucket != null && sameFontBucket(bucket, headingTwoBucket)
					? 2
					: null;
			if (level == null) {
				if (current) {
					groups.push(current);
					current = null;
				}
				continue;
			}
			if (current && current.level === level) {
				current.lines.push(String(line.text || "").trim());
			}
			else {
				if (current) {
					groups.push(current);
				}
				current = { level, lines: [String(line.text || "").trim()] };
			}
		}
		if (current) {
			groups.push(current);
		}
		return groups;
	}

	function canonicalizeForMatch(input) {
		return [...String(input || "")]
			.filter((ch) => /[\p{L}\p{N}]/u.test(ch))
			.map((ch) => ch.toLowerCase())
			.join("");
	}

	function linesEquivalentForMatch(a, b) {
		let left = canonicalizeForMatch(a);
		let right = canonicalizeForMatch(b);
		if (!left || !right) {
			return false;
		}
		if (left === right) {
			return true;
		}
		let minLen = Math.min(left.length, right.length);
		return minLen >= 10 && (left.includes(right) || right.includes(left));
	}

	function findHeadingMatch(lines, startAt, headingLines) {
		for (let candidate = startAt; candidate < lines.length; candidate += 1) {
			let lineCursor = candidate;
			let headingCursor = 0;
			while (headingCursor < headingLines.length) {
				while (lineCursor < lines.length && !String(lines[lineCursor] || "").trim()) {
					lineCursor += 1;
				}
				if (lineCursor >= lines.length) {
					break;
				}
				if (!linesEquivalentForMatch(lines[lineCursor], headingLines[headingCursor])) {
					break;
				}
				headingCursor += 1;
				lineCursor += 1;
			}
			if (headingCursor === headingLines.length) {
				return [candidate, lineCursor];
			}
		}
		return null;
	}

	function cleanupHeadingText(input) {
		let words = String(input || "").split(/\s+/).filter(Boolean);
		if (!words.length) {
			return "";
		}
		let merged = [];
		let index = 0;
		while (index < words.length) {
			if (index + 1 < words.length) {
				let first = words[index];
				let second = words[index + 1];
				let shouldMerge =
					first.length === 1 &&
					index === 0 &&
					/[A-Za-z]/.test(first) &&
					!["a", "i"].includes(first.toLowerCase()) &&
					/[a-z]/.test(second[0] || "");
				if (shouldMerge) {
					merged.push(`${first}${second}`);
					index += 2;
					continue;
				}
			}
			merged.push(words[index]);
			index += 1;
		}
		return merged.join(" ");
	}

	function applyHeadingGroupsToText(pageText, groups) {
		let lines = String(pageText || "").split("\n");
		if (!lines.length) {
			return "";
		}
		let cursor = 0;
		let out = "";
		for (let group of groups) {
			if (!group.lines.length) {
				continue;
			}
			let match = findHeadingMatch(lines, cursor, group.lines);
			if (!match) {
				continue;
			}
			let [start, end] = match;
			for (let line of lines.slice(cursor, start)) {
				out += `${line}\n`;
			}
			let joined = lines
				.slice(start, end)
				.map((line) => String(line || "").trim())
				.filter(Boolean)
				.join(" ");
			let headingText = cleanupHeadingText(joined);
			if (headingText) {
				if (out && !out.endsWith("\n\n")) {
					out += "\n";
				}
				out += `${"#".repeat(group.level)} ${headingText}\n\n`;
			}
			cursor = end;
		}
		for (let line of lines.slice(cursor)) {
			out += `${line}\n`;
		}
		return out.trimEnd().replace(/\n{3,}/g, "\n\n");
	}

	function renderPageMarkdownFromLines(pageText, lines, headingOneBucket, headingTwoBucket) {
		if (!lines.length || headingOneBucket == null) {
			return pageText;
		}
		let groups = detectHeadingGroupsBySize(lines, headingOneBucket, headingTwoBucket);
		if (!groups.length) {
			return pageText;
		}
		return applyHeadingGroupsToText(pageText, groups);
	}

	function sanitizeOuterMarkdownFence(markdown) {
		let normalized = normalizeNewlines(markdown);
		let lines = normalized.split("\n");
		if (!lines.length) {
			return normalized;
		}
		let firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
		if (firstNonEmpty === -1) {
			return normalized;
		}
		let lastNonEmpty = -1;
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			if (lines[i].trim().length > 0) {
				lastNonEmpty = i;
				break;
			}
		}
		if (lastNonEmpty <= firstNonEmpty) {
			return normalized;
		}
		let opener = lines[firstNonEmpty].trim();
		if (!opener.startsWith("```")) {
			return normalized;
		}
		let lang = opener.slice(3).trim().toLowerCase();
		if (!(lang === "" || lang === "markdown" || lang === "md")) {
			return normalized;
		}
		if (lines[lastNonEmpty].trim() !== "```") {
			return normalized;
		}
		return lines
			.slice(0, firstNonEmpty)
			.concat(lines.slice(firstNonEmpty + 1, lastNonEmpty), lines.slice(lastNonEmpty + 1))
			.join("\n")
			.replace(/^\n+|\n+$/g, "");
	}

	function sanitizeModelMarkdown(markdown) {
		return sanitizeOuterMarkdownFence(String(markdown || "").trim());
	}

	function stripThinkContent(text = "") {
		let cleaned = String(text || "");
		cleaned = cleaned.replace(/<\s*think\b[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi, "");
		let strayClose = cleaned.toLowerCase().lastIndexOf("</think>");
		if (strayClose >= 0) {
			cleaned = cleaned.slice(strayClose + "</think>".length);
		}
		return cleaned.trim();
	}

	function fastErrorLooksNonMachineReadable(message) {
		let value = String(message || "").toLowerCase();
		return (
			value.includes(FAST_MACHINE_READABILITY_HINT_A) ||
			value.includes(FAST_MACHINE_READABILITY_HINT_B) ||
			value.includes("non-machine-readable") ||
			value.includes("missing unicode font mapping")
		);
	}

	function tokenizeWordsForLoopDetection(input) {
		return normalizeNewlines(input)
			.toLowerCase()
			.split(/[^a-z0-9]+/i)
			.filter((word) => word.length >= 2);
	}

	function normalizeLineForLoopDetection(line) {
		return normalizeNewlines(line)
			.toLowerCase()
			.replace(/[`*_>#\-|]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function detectConsecutiveLineLoop(markdown) {
		let lines = normalizeNewlines(markdown)
			.split("\n")
			.map(normalizeLineForLoopDetection)
			.filter((line) => line.length >= 12);
		let bestRun = 1;
		let currentRun = 1;
		for (let i = 1; i < lines.length; i += 1) {
			if (lines[i] === lines[i - 1]) {
				currentRun += 1;
				bestRun = Math.max(bestRun, currentRun);
			}
			else {
				currentRun = 1;
			}
		}
		return bestRun >= 4;
	}

	function detectConsecutiveWordSpanLoop(markdown) {
		let words = tokenizeWordsForLoopDetection(markdown);
		if (words.length < 48) {
			return false;
		}
		for (let span = 8; span <= 32; span += 1) {
			for (let start = 0; start + span * 3 <= words.length; start += 1) {
				let a = words.slice(start, start + span).join(" ");
				let b = words.slice(start + span, start + span * 2).join(" ");
				let c = words.slice(start + span * 2, start + span * 3).join(" ");
				if (a === b && b === c) {
					return true;
				}
			}
		}
		return false;
	}

	function hasLoop(markdown) {
		return (
			detectConsecutiveLineLoop(markdown) ||
			detectConsecutiveWordSpanLoop(markdown)
		);
	}

	async function loadPdfJs() {
		if (!_pdfJSImportPromise) {
			_pdfJSImportPromise = Promise.resolve().then(() => {
				let mod = ChromeUtils.importESModule("resource://zotero/reader/pdf/build/pdf.mjs");
				try {
					mod.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
				}
				catch (_err) {}
				return mod;
			});
		}
		return _pdfJSImportPromise;
	}

	function getCanvasWindow() {
		let win = null;
		try {
			win = Services.wm.getMostRecentWindow("navigator:browser");
		}
		catch (_err) {}
		if (win && !win.closed && win.document) {
			return win;
		}
		throw new Error("No DOM window is available for PDF/image rendering");
	}

	function createCanvasInWindow(win, width, height) {
		let canvas = win.document.createElementNS(HTML_NS, "canvas");
		canvas.width = Math.max(1, Math.round(width));
		canvas.height = Math.max(1, Math.round(height));
		return canvas;
	}

	function createCanvas(width, height) {
		return createCanvasInWindow(getCanvasWindow(), width, height);
	}

	function buildPdfRenderHostHTML() {
		return `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>Systematic Reviewer PDF Render Host</title>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			background: transparent;
			overflow: hidden;
		}
	</style>
</head>
<body>
	<script>
		const PDF_WORKER_SRC = "resource://zotero/reader/pdf/build/pdf.worker.mjs";
		const PDF_CMAP_URL = "resource://zotero/reader/pdf/web/cmaps/";
		const PDF_STANDARD_FONTS_URL = "resource://zotero/reader/pdf/web/standard_fonts/";
		const PDF_WASM_URL = "resource://zotero/reader/pdf/web/wasm/";

		const state = {
			ready: false,
			error: "",
			pdfjsLib: null,
			requests: Object.create(null),
		};

		function clampDimension(value) {
			return Math.max(1, Math.round(Number(value) || 0));
		}

		function createCanvas(width, height) {
			const canvas = document.createElement("canvas");
			canvas.width = clampDimension(width);
			canvas.height = clampDimension(height);
			return canvas;
		}

		async function ensurePdfJs() {
			if (state.pdfjsLib) {
				return state.pdfjsLib;
			}
			if (state.error) {
				throw new Error(state.error);
			}
			try {
				const mod = await import("resource://zotero/reader/pdf/build/pdf.mjs");
				try {
					mod.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
				}
				catch (_err) {}
				state.pdfjsLib = mod;
				state.ready = true;
				document.documentElement.setAttribute("data-sr-pdf-render-host-ready", "true");
				return mod;
			}
			catch (error) {
				state.error = error instanceof Error ? error.message : String(error);
				document.documentElement.setAttribute("data-sr-pdf-render-host-error", state.error);
				throw error;
			}
		}

		async function loadPdfBytes(pdfURL) {
			const response = await fetch(pdfURL);
			if (!response.ok) {
				throw new Error(\`Failed to load PDF bytes: HTTP \${response.status}\`);
			}
			return new Uint8Array(await response.arrayBuffer());
		}

		async function renderPdfPages(pdfURL, settings = {}, onUpdate = null) {
			const pdfjsLib = await ensurePdfJs();
			onUpdate?.({ phase: "loading_pdf" });
			const data = await loadPdfBytes(pdfURL);
			const scale = Number(settings.scale) || 2.0;
			const oversample = Number(settings.oversample) || 1.5;
			onUpdate?.({ phase: "opening_document" });
			const loadingTask = pdfjsLib.getDocument({
				data,
				useSystemFonts: true,
				isEvalSupported: false,
				cMapUrl: PDF_CMAP_URL,
				cMapPacked: true,
				standardFontDataUrl: PDF_STANDARD_FONTS_URL,
				wasmUrl: PDF_WASM_URL,
			});
			const documentHandle = await loadingTask.promise;
			try {
				const pages = [];
				onUpdate?.({ phase: "rendering", current: 0, total: documentHandle.numPages });
				for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber += 1) {
					const page = await documentHandle.getPage(pageNumber);
					try {
						const renderViewport = page.getViewport({ scale: scale * oversample });
						const renderCanvas = createCanvas(renderViewport.width, renderViewport.height);
						const renderContext = renderCanvas.getContext("2d");
						await page.render({
							canvasContext: renderContext,
							viewport: renderViewport,
						}).promise;
						pages.push({
							page: pageNumber,
							imageDataURL: renderCanvas.toDataURL("image/png"),
						});
						onUpdate?.({ phase: "rendering", current: pageNumber, total: documentHandle.numPages });
					}
					finally {
						if (typeof page?.cleanup === "function") {
							page.cleanup();
						}
					}
				}
				return pages;
			}
			finally {
				await documentHandle.destroy();
			}
		}

		function nextRequestID() {
			return \`req-\${Date.now()}-\${Math.random().toString(36).slice(2, 10)}\`;
		}

		function startRenderPdfPages(pdfURL, settings = {}) {
			const requestID = nextRequestID();
			state.requests[requestID] = {
				status: "running",
				phase: "queued",
				current: 0,
				total: 0,
				error: "",
				result: null,
			};
			renderPdfPages(pdfURL, settings, (update) => {
				const request = state.requests[requestID];
				if (!request) {
					return;
				}
				request.phase = String(update?.phase || request.phase || "");
				request.current = Number(update?.current || 0);
				request.total = Number(update?.total || 0);
			}).then((result) => {
				const request = state.requests[requestID];
				if (!request) {
					return;
				}
				request.status = "succeeded";
				request.phase = "done";
				request.result = result;
			}).catch((error) => {
				const request = state.requests[requestID];
				if (!request) {
					return;
				}
				request.status = "failed";
				request.phase = "failed";
				request.error = error instanceof Error ? error.message : String(error);
			});
			return requestID;
		}

		function getRenderRequestState(requestID) {
			const request = state.requests[requestID];
			if (!request) {
				return null;
			}
			return {
				status: request.status,
				phase: request.phase,
				current: request.current,
				total: request.total,
				error: request.error,
				result: request.result,
			};
		}

		globalThis.srPdfRenderHost = {
			get ready() {
				return state.ready;
			},
			get error() {
				return state.error;
			},
			startRenderPdfPages,
			getRenderRequestState,
			ensureReady: ensurePdfJs,
		};

		ensurePdfJs().catch(() => {});
	</script>
</body>
</html>`;
	}

	async function createTempPdfRenderHostFile() {
		let file = Services.dirsvc.get("TmpD", Ci.nsIFile).clone();
		file.append(`systematic-reviewer-pdf-render-host-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.html`);
		await Zotero.File.putContentsAsync(file.path, buildPdfRenderHostHTML());
		return file;
	}

	function dataURLToUint8Array(dataURL) {
		let comma = dataURL.indexOf(",");
		let base64 = comma >= 0 ? dataURL.slice(comma + 1) : dataURL;
		let binary = atob(base64);
		let out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			out[i] = binary.charCodeAt(i) & 0xff;
		}
		return out;
	}

	function canvasToDataURL(canvas) {
		return canvas.toDataURL("image/png");
	}

	function ensureHiddenBrowserCompat(win) {
		try {
			if (win?.gBrowser && typeof win.gBrowser.getTabForBrowser != "function") {
				win.gBrowser.getTabForBrowser = () => null;
			}
		}
		catch (_err) {}
	}

	function createHiddenReaderPreviewBrowser(win) {
		ensureHiddenBrowserCompat(win);
		let browser = win.document.createXULElement("browser");
		browser.setAttribute("class", "reader");
		browser.setAttribute("flex", "1");
		browser.setAttribute("type", "content");
		browser.setAttribute("primary", "true");
		browser.setAttribute("transparent", "true");
		browser.setAttribute("remote", "false");
		browser.setAttribute("tooltip", "html-tooltip");
		browser.setAttribute("src", READER_HTML_URL);
		browser.style.position = "fixed";
		browser.style.left = "-20000px";
		browser.style.top = "0";
		browser.style.width = "1200px";
		browser.style.height = "1600px";
		browser.style.opacity = "0";
		browser.style.pointerEvents = "none";
		browser.style.border = "0";
		browser.style.zIndex = "-1";
		win.document.documentElement.appendChild(browser);
		try {
			if (browser.docShell) {
				browser.docShell.windowDraggingAllowed = true;
			}
		}
		catch (_err) {}
		return browser;
	}

	function cleanupHiddenReaderPreview(preview) {
		try {
			preview?.reader?.uninit?.();
		}
		catch (_err) {}
		try {
			preview?.browser?.remove?.();
		}
		catch (_err) {}
	}

	function createHiddenPdfRenderHostBrowser(win) {
		ensureHiddenBrowserCompat(win);
		let browser = win.document.createXULElement("browser");
		browser.setAttribute("type", "content");
		browser.setAttribute("remote", "false");
		browser.setAttribute("maychangeremoteness", "false");
		browser.style.position = "fixed";
		browser.style.left = "-20000px";
		browser.style.top = "0";
		browser.style.width = "1200px";
		browser.style.height = "1600px";
		browser.style.opacity = "0";
		browser.style.pointerEvents = "none";
		browser.style.border = "0";
		browser.style.zIndex = "-1";
		win.document.documentElement.appendChild(browser);
		return browser;
	}

	function cleanupHiddenPdfRenderHost(handle) {
		try {
			handle?.browser?.remove?.();
		}
		catch (_err) {}
		try {
			handle?.tempFile?.remove?.(false);
		}
		catch (_err) {}
	}

	function waitForBrowserLoad(browser, expectedURL = "", timeoutMs = HIDDEN_READER_PREVIEW_TIMEOUT_MS, targetLabel = "browser") {
		let ownerWindow = browser?.ownerGlobal || browser?.ownerDocument?.defaultView || null;
		return new Promise((resolve, reject) => {
			try {
				let currentURL = browser?.contentWindow?.location?.href || browser?.currentURI?.spec || "";
				let readyState = browser?.contentDocument?.readyState || "";
				if ((!expectedURL || currentURL === expectedURL || String(currentURL).startsWith(expectedURL)) && readyState == "complete") {
					resolve();
					return;
				}
			}
			catch (_err) {}
			let settled = false;
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => {
					if (settled) {
						return;
					}
					settled = true;
					cleanup();
					reject(new Error(`Timed out loading ${String(targetLabel || "browser")}`));
				}, timeoutMs)
				: null;

			let cleanup = () => {
				if (timer != null && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				browser.removeEventListener("load", onLoad, true);
			};

			let onLoad = () => {
				let currentURL = "";
				try {
					currentURL = browser?.contentWindow?.location?.href || browser?.currentURI?.spec || "";
				}
				catch (_err) {}
				if (expectedURL && currentURL && currentURL !== expectedURL && !String(currentURL).startsWith(expectedURL)) {
					return;
				}
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				resolve();
			};

			browser.addEventListener("load", onLoad, true);
		});
	}

	function waitForReaderPreviewReady(preview, timeoutMs = HIDDEN_READER_PREVIEW_TIMEOUT_MS) {
		let ownerWindow = preview?.browser?.ownerGlobal || preview?.browser?.ownerDocument?.defaultView || null;
		return new Promise((resolve, reject) => {
			let settled = false;
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => {
					if (settled) {
						return;
					}
					settled = true;
					reject(new Error("Timed out waiting for PDF reader preview"));
				}, timeoutMs)
				: null;

			let finish = (error, value) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer != null && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				if (error) {
					reject(error);
					return;
				}
				resolve(value);
			};

			let poll = () => {
				try {
					let readerWindow = preview?.reader?._internalReader?._primaryView?._iframeWindow || null;
					let pdfDocument = readerWindow?.PDFViewerApplication?.pdfDocument || null;
					if (readerWindow && pdfDocument) {
						finish(null, { readerWindow, pdfDocument });
						return;
					}
				}
				catch (_err) {}
				if (!settled && ownerWindow?.setTimeout) {
					ownerWindow.setTimeout(poll, 50);
				}
			};

			poll();
		});
	}

	function getBrowserHostGlobal(browser) {
		let win = browser?.contentWindow || null;
		return getWindowGlobal(win);
	}

	function getWindowGlobal(win) {
		if (!win) {
			return null;
		}
		try {
			if (win.wrappedJSObject) {
				return win.wrappedJSObject;
			}
		}
		catch (_err) {}
		try {
			return Components.utils.waiveXrays(win);
		}
		catch (_err) {}
		return win;
	}

	function getReaderRuntimeObjects(readerWindow, fallbackDocument = null) {
		let global = getWindowGlobal(readerWindow);
		let app = global?.PDFViewerApplication || null;
		let viewer = app?.pdfViewer || null;
		let pdfDocument = app?.pdfDocument || fallbackDocument || null;
		return {
			global,
			app,
			viewer,
			pdfDocument,
		};
	}

	function buildPdfReaderRenderBridgeScript() {
		return `
(function () {
	if (
		globalThis.srPdfReaderRenderBridge &&
		typeof globalThis.srPdfReaderRenderBridge.startRenderPdfPages === "function" &&
		typeof globalThis.srPdfReaderRenderBridge.getRenderRequestState === "function"
	) {
		return;
	}

	const state = {
		requests: Object.create(null),
	};

	function clampDimension(value) {
		return Math.max(1, Math.round(Number(value) || 0));
	}

	function createCanvas(width, height) {
		const canvas = document.createElement("canvas");
		canvas.width = clampDimension(width);
		canvas.height = clampDimension(height);
		return canvas;
	}

	function nextRequestID() {
		return \`reader-req-\${Date.now()}-\${Math.random().toString(36).slice(2, 10)}\`;
	}

	async function renderPdfPages(settings = {}, onUpdate = null) {
		const app = globalThis.PDFViewerApplication || null;
		const viewer = app?.pdfViewer || null;
		const pdfDocument = app?.pdfDocument || null;
		if (!app || !viewer || !pdfDocument) {
			throw new Error("PDF reader is not ready for rendering");
		}
		await app.initializedPromise;
		await viewer.firstPagePromise;
		const scale = Number(settings.scale) || 2.0;
		const oversample = Number(settings.oversample) || 1.5;
		const totalPages = Number(pdfDocument.numPages || 0) || 0;
		onUpdate?.({ phase: "opening_document", current: 0, total: totalPages });
		const pages = [];
		for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
			const pdfPage = await pdfDocument.getPage(pageNumber);
			try {
				const renderViewport = pdfPage.getViewport({ scale: scale * oversample });
				const renderCanvas = createCanvas(renderViewport.width, renderViewport.height);
				const renderContext = renderCanvas.getContext("2d");
				await pdfPage.render({
					canvasContext: renderContext,
					viewport: renderViewport,
				}).promise;
				pages.push({
					page: pageNumber,
					imageDataURL: renderCanvas.toDataURL("image/png"),
				});
				onUpdate?.({ phase: "rendering", current: pageNumber, total: totalPages });
			}
			finally {
				if (typeof pdfPage?.cleanup === "function") {
					pdfPage.cleanup();
				}
			}
		}
		return pages;
	}

	function startRenderPdfPages(settings = {}) {
		const requestID = nextRequestID();
		state.requests[requestID] = {
			status: "running",
			phase: "queued",
			current: 0,
			total: 0,
			error: "",
			result: null,
		};
		renderPdfPages(settings, (update) => {
			const request = state.requests[requestID];
			if (!request) {
				return;
			}
			request.phase = String(update?.phase || request.phase || "");
			request.current = Number(update?.current || 0);
			request.total = Number(update?.total || 0);
		}).then((result) => {
			const request = state.requests[requestID];
			if (!request) {
				return;
			}
			request.status = "succeeded";
			request.phase = "done";
			request.result = result;
		}).catch((error) => {
			const request = state.requests[requestID];
			if (!request) {
				return;
			}
			request.status = "failed";
			request.phase = "failed";
			request.error = error instanceof Error ? error.message : String(error);
		});
		return requestID;
	}

	function getRenderRequestState(requestID) {
		const request = state.requests[requestID];
		if (!request) {
			return null;
		}
		return {
			status: request.status,
			phase: request.phase,
			current: request.current,
			total: request.total,
			error: request.error,
			result: request.result,
		};
	}

	globalThis.srPdfReaderRenderBridge = {
		startRenderPdfPages,
		getRenderRequestState,
	};
})();
`;
	}

	function ensureReaderRenderBridge(readerWindow) {
		let global = getWindowGlobal(readerWindow);
		let bridge = global?.srPdfReaderRenderBridge || null;
		if (bridge && typeof bridge.startRenderPdfPages == "function" && typeof bridge.getRenderRequestState == "function") {
			return bridge;
		}
		let script = buildPdfReaderRenderBridgeScript();
		let injected = false;
		try {
			evaluateInReaderWindow(readerWindow, script);
			injected = true;
		}
		catch (_evalError) {}
		if (!injected) {
			let scriptURL = `data:application/javascript;charset=utf-8,${encodeURIComponent(script)}`;
			Services.scriptloader.loadSubScript(scriptURL, global || readerWindow);
		}
		bridge = getWindowGlobal(readerWindow)?.srPdfReaderRenderBridge || null;
		if (!bridge || typeof bridge.startRenderPdfPages != "function" || typeof bridge.getRenderRequestState != "function") {
			throw new Error("PDF reader bridge did not expose render request methods");
		}
		return bridge;
	}

	function evaluateInReaderWindow(readerWindow, source) {
		if (!readerWindow || typeof source != "string" || !source.trim()) {
			throw new Error("PDF reader window evaluation requires a target window and source");
		}
		let rawWindow = readerWindow;
		let waivedWindow = getWindowGlobal(readerWindow);
		let evaluators = [];
		try {
			if (typeof rawWindow.eval == "function") {
				evaluators.push(rawWindow.eval.bind(rawWindow));
			}
		}
		catch (_err) {}
		try {
			if (waivedWindow && typeof waivedWindow.eval == "function" && waivedWindow.eval !== rawWindow?.eval) {
				evaluators.push(waivedWindow.eval.bind(waivedWindow));
			}
		}
		catch (_err) {}
		let lastError = null;
		for (let evaluator of evaluators) {
			try {
				return evaluator(source);
			}
			catch (error) {
				lastError = error;
			}
		}
		throw lastError instanceof Error
			? lastError
			: new Error("PDF reader window does not expose an executable eval bridge");
	}

	function startReaderRenderRequest(readerWindow, settings = {}) {
		ensureReaderRenderBridge(readerWindow);
		return String(evaluateInReaderWindow(
			readerWindow,
			`(() => globalThis.srPdfReaderRenderBridge.startRenderPdfPages(${JSON.stringify(settings || {})}))()`
		) || "");
	}

	function getReaderRenderRequestState(readerWindow, requestID) {
		ensureReaderRenderBridge(readerWindow);
		let serializedRequestID = JSON.stringify(String(requestID || ""));
		return evaluateInReaderWindow(
			readerWindow,
			`(() => {
				let state = globalThis.srPdfReaderRenderBridge.getRenderRequestState(${serializedRequestID});
				return state ? JSON.parse(JSON.stringify(state)) : null;
			})()`
		);
	}

	function waitForPdfRenderHostReady(browser, timeoutMs = PDF_RENDER_HOST_READY_TIMEOUT_MS) {
		let ownerWindow = browser?.ownerGlobal || browser?.ownerDocument?.defaultView || null;
		return new Promise((resolve, reject) => {
			let settled = false;
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => {
					if (settled) {
						return;
					}
					settled = true;
					reject(new Error("Timed out waiting for PDF render host"));
				}, timeoutMs)
				: null;

			let finish = (error, value) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer != null && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				if (error) {
					reject(error);
				}
				else {
					resolve(value);
				}
			};

			let poll = async () => {
				try {
					let global = getBrowserHostGlobal(browser);
					let host = global?.srPdfRenderHost || null;
					if (host?.error) {
						finish(new Error(String(host.error)));
						return;
					}
					if (
						host?.ready &&
						typeof host.startRenderPdfPages == "function" &&
						typeof host.getRenderRequestState == "function"
					) {
						finish(null, host);
						return;
					}
				}
				catch (error) {
					finish(error);
					return;
				}
				if (!settled && ownerWindow?.setTimeout) {
					ownerWindow.setTimeout(poll, 50);
				}
			};

			poll();
		});
	}

	async function openHiddenPdfRenderHost() {
		let win = getCanvasWindow();
		let browser = createHiddenPdfRenderHostBrowser(win);
		let tempFile = await createTempPdfRenderHostFile();
		let url = Services.io.newFileURI(tempFile).spec;
		try {
			browser.setAttribute("src", url);
			await waitForBrowserLoad(browser, url, PDF_RENDER_HOST_READY_TIMEOUT_MS, "PDF render host");
			let host = await waitForPdfRenderHostReady(browser, PDF_RENDER_HOST_READY_TIMEOUT_MS);
			return { browser, host, tempFile };
		}
		catch (error) {
			cleanupHiddenPdfRenderHost({ browser, tempFile });
			throw error;
		}
	}

	function waitForReaderTabReady(reader, timeoutMs = HIDDEN_READER_PREVIEW_TIMEOUT_MS) {
		let ownerWindow = reader?._window || reader?._iframeWindow || Zotero.getMainWindow?.() || null;
		return new Promise((resolve, reject) => {
			let settled = false;
			let timer = ownerWindow?.setTimeout
				? ownerWindow.setTimeout(() => {
					if (settled) {
						return;
					}
					settled = true;
					reject(new Error("Timed out waiting for background PDF reader"));
				}, timeoutMs)
				: null;

			let finish = (error, value) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer != null && ownerWindow?.clearTimeout) {
					ownerWindow.clearTimeout(timer);
				}
				if (error) {
					reject(error);
					return;
				}
				resolve(value);
			};

			let poll = () => {
				try {
					let readerWindow = reader?._internalReader?._primaryView?._iframeWindow || null;
					let pdfDocument = readerWindow?.PDFViewerApplication?.pdfDocument || null;
					if (readerWindow && pdfDocument) {
						finish(null, { readerWindow, pdfDocument });
						return;
					}
				}
				catch (_err) {}
				if (!settled && ownerWindow?.setTimeout) {
					ownerWindow.setTimeout(poll, 50);
				}
			};

			poll();
		});
	}

	async function openHiddenReaderPreview(attachmentItemID) {
		if (!attachmentItemID || !Zotero.Reader?.openPreview || !Zotero.getMainWindow) {
			return null;
		}
		let win = null;
		try {
			win = Zotero.getMainWindow();
		}
		catch (_err) {}
		if (!win || win.closed || !win.document?.createXULElement) {
			return null;
		}
		let browser = createHiddenReaderPreviewBrowser(win);
		let preview = { browser, reader: null };
		try {
			await waitForBrowserLoad(browser, READER_HTML_URL, HIDDEN_READER_PREVIEW_TIMEOUT_MS, "PDF reader preview");
			preview.reader = await Zotero.Reader.openPreview(attachmentItemID, browser);
			let success = await preview.reader._open({});
			if (!success) {
				throw new Error(`PDF reader preview failed to open attachment ${attachmentItemID}`);
			}
			let { readerWindow, pdfDocument } = await waitForReaderPreviewReady(preview);
			let readerObjects = getReaderRuntimeObjects(readerWindow, pdfDocument);
			await readerObjects.app?.initializedPromise;
			await readerObjects.viewer?.firstPagePromise;
			return Object.assign(preview, {
				readerWindow,
				readerGlobal: readerObjects.global,
				readerApp: readerObjects.app,
				readerViewer: readerObjects.viewer,
				pdfDocument: readerObjects.pdfDocument,
			});
		}
		catch (error) {
			cleanupHiddenReaderPreview(preview);
			throw error;
		}
	}

	async function openBackgroundReaderTab(attachmentItemID) {
		if (!attachmentItemID || !Zotero.Reader?.open) {
			return null;
		}
		let reader = await Zotero.Reader.open(attachmentItemID, null, {
			openInBackground: true,
			allowDuplicate: true,
			preventJumpback: true,
		});
		if (!reader) {
			throw new Error(`Background PDF reader failed to open attachment ${attachmentItemID}`);
		}
		try {
			await reader._initPromise;
		}
		catch (_err) {}
		let { readerWindow, pdfDocument } = await waitForReaderTabReady(reader);
		let readerObjects = getReaderRuntimeObjects(readerWindow, pdfDocument);
		await readerObjects.app?.initializedPromise;
		await readerObjects.viewer?.firstPagePromise;
		return {
			reader,
			readerWindow,
			readerGlobal: readerObjects.global,
			readerApp: readerObjects.app,
			readerViewer: readerObjects.viewer,
			pdfDocument: readerObjects.pdfDocument,
		};
	}

	function cleanupBackgroundReaderTab(handle) {
		try {
			handle?.reader?.close?.();
		}
		catch (_err) {}
	}

	async function renderPdfPagesToDataURLsViaReader(attachmentItemID, runtime, hooks = null) {
		let previewError = null;
		if (hooks?.onLog) {
			await hooks.onLog("info", "Opening PDF reader preview");
		}
		try {
			return await renderPdfPagesToDataURLsViaReaderPreview(attachmentItemID, runtime, hooks);
		}
		catch (error) {
			previewError = error;
			if (hooks?.onLog) {
				await hooks.onLog("warn", `PDF reader preview failed: ${error?.message || String(error)}`);
				await hooks.onLog("info", "Retrying with background PDF reader");
			}
		}

		try {
			return await renderPdfPagesToDataURLsViaBackgroundReaderTab(attachmentItemID, runtime, hooks);
		}
		catch (error) {
			let previewMessage = previewError?.message || String(previewError || "Unknown preview failure");
			let backgroundMessage = error?.message || String(error);
			if (hooks?.onLog) {
				await hooks.onLog("warn", `Background PDF reader failed: ${backgroundMessage}`);
			}
			throw new Error(`PDF reader rendering failed. Preview: ${previewMessage}. Background reader: ${backgroundMessage}`);
		}
	}

	async function renderPdfPagesToDataURLsViaCompatibilityFallback(pdfPath, runtime, hooks = null) {
		let directError = null;
		if (hooks?.onLog) {
			await hooks.onLog("info", "PDF reader rendering is unavailable; using compatibility PDF renderer");
		}
		try {
			return await renderPdfPagesToDataURLsViaImportedPdfJs(pdfPath, runtime, hooks);
		}
		catch (error) {
			directError = error;
			if (hooks?.onLog) {
				await hooks.onLog("warn", `Direct PDF renderer failed: ${error?.message || String(error)}`);
				await hooks.onLog("info", "Retrying with PDF render host");
			}
		}

		try {
			return await renderPdfPagesToDataURLsViaBundledPdfJsHost(pdfPath, runtime, hooks);
		}
		catch (error) {
			let directMessage = directError?.message || String(directError || "Unknown direct renderer failure");
			let hostMessage = error?.message || String(error);
			throw new Error(`Compatibility PDF rendering failed. Direct renderer: ${directMessage}. PDF render host: ${hostMessage}`);
		}
	}

	async function localFileBytes(path) {
		let binary = await Zotero.File.getBinaryContentsAsync(path);
		let out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			out[i] = binary.charCodeAt(i) & 0xff;
		}
		return out;
	}

	function deriveFontSize(item) {
		let t = item.transform || [];
		let height = Math.abs(item.height || 0);
		let a = Math.abs(t[0] || 0);
		let d = Math.abs(t[3] || 0);
		let b = Math.abs(t[1] || 0);
		let c = Math.abs(t[2] || 0);
		return Math.max(height, a, d, Math.hypot(a, b), Math.hypot(c, d), 0);
	}

	function splitTextLines(raw) {
		return String(raw || "")
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	function collectPageLinesWithFontSize(items) {
		let chunks = [];
		for (let item of items || []) {
			let raw = item.str || "";
			if (!raw.trim()) {
				continue;
			}
			let transform = item.transform || [];
			let left = Number(transform[4] || 0);
			let top = Number(transform[5] || 0);
			let fontSize = deriveFontSize(item);
			if (fontSize <= 0) {
				continue;
			}
			for (let text of splitTextLines(raw)) {
				chunks.push({ top, left, fontSize, text });
			}
		}
		if (!chunks.length) {
			return [];
		}
		chunks.sort((a, b) => {
			if (b.top !== a.top) {
				return b.top - a.top;
			}
			return a.left - b.left;
		});

		let rows = [];
		for (let chunk of chunks) {
			let lastRow = rows[rows.length - 1];
			if (lastRow) {
				let referenceTop = lastRow[0]?.top ?? chunk.top;
				let rowMaxFont = lastRow.reduce((max, entry) => Math.max(max, entry.fontSize), chunk.fontSize);
				let tolerance = Math.min(Math.max(rowMaxFont * 0.2, 0.8), 2.0);
				if (Math.abs(referenceTop - chunk.top) <= tolerance) {
					lastRow.push(chunk);
					continue;
				}
			}
			rows.push([chunk]);
		}

		let lines = [];
		for (let row of rows) {
			row.sort((a, b) => a.left - b.left);
			let fontBuckets = new Map();
			for (let chunk of row) {
				let bucket = Math.round(chunk.fontSize * 10);
				let weight = [...chunk.text].filter((ch) => !/\s/.test(ch)).length || 1;
				fontBuckets.set(bucket, (fontBuckets.get(bucket) || 0) + weight);
			}
			let dominant = [...fontBuckets.entries()].sort((a, b) => b[1] - a[1])[0];
			let rowFont = dominant ? dominant[0] / 10 : 0;
			let rendered = normalizeTextBasic(row.map((chunk) => chunk.text.trim()).join(" "));
			if (!rendered) {
				continue;
			}
			lines.push({ text: rendered, fontSize: rowFont });
		}
		return lines;
	}

	function buildNormalizedPageText(lines) {
		return normalizeTextBasic((lines || []).map((line) => line.text).join("\n"));
	}

	async function reportProgress(hooks, progress) {
		if (hooks?.onProgress) {
			await hooks.onProgress(progress);
		}
		if (hooks?.yield) {
			await hooks.yield();
		}
	}

	async function extractFastPdfMarkdownViaPDFWorker(attachmentItemID, hooks = null) {
		if (!attachmentItemID || !Zotero.PDFWorker?.getFullText) {
			return null;
		}
		let result = await Zotero.PDFWorker.getFullText(attachmentItemID, null, true);
		let pageTexts = splitFastTextIntoPages(result?.text || "");
		if (!pageTexts.length) {
			throw new Error("FAST extraction returned no text");
		}
		ensureMachineReadableText("PDF worker extraction", pageTexts.length, pageTexts);
		for (let pageNumber = 1; pageNumber <= pageTexts.length; pageNumber += 1) {
			await reportProgress(hooks, {
				phase: "fast",
				current: pageNumber,
				total: pageTexts.length,
				message: `FAST extracted page ${pageNumber}/${pageTexts.length}`,
			});
		}
		return {
			markdown: joinPagesWithFastMarkers(pageTexts),
			pages: pageTexts.length,
			chars: [...pageTexts.join("\n\n")].length,
		};
	}

	async function extractFastPdfMarkdown(pdfPath, hooks = null, attachmentItemID = null) {
		if (attachmentItemID) {
			try {
				let workerResult = await extractFastPdfMarkdownViaPDFWorker(attachmentItemID, hooks);
				if (workerResult) {
					return workerResult;
				}
			}
			catch (error) {
				if (hooks?.onLog) {
					await hooks.onLog(
						"info",
						`FAST worker extraction failed, falling back to direct PDF text extraction: ${error?.message || String(error)}`
					);
				}
			}
		}
		let pdfjsLib = await loadPdfJs();
		let data = await localFileBytes(pdfPath);
		let loadingTask = pdfjsLib.getDocument({
			data,
			useSystemFonts: true,
			isEvalSupported: false,
			cMapUrl: PDF_CMAP_URL,
			cMapPacked: true,
			standardFontDataUrl: PDF_STANDARD_FONTS_URL,
			wasmUrl: PDF_WASM_URL,
		});
		let document = await loadingTask.promise;
		try {
			let pages = document.numPages;
			let pageData = [];
			for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
				let page = await document.getPage(pageNumber);
				try {
					let textContent = await page.getTextContent();
					let lines = collectPageLinesWithFontSize(textContent.items || []);
					let normalizedText = buildNormalizedPageText(lines);
					pageData.push({ normalizedText, lines });
					await reportProgress(hooks, {
						phase: "fast",
						current: pageNumber,
						total: pages,
						message: `FAST extracted page ${pageNumber}/${pages}`,
					});
				}
				finally {
					if (typeof page?.cleanup == "function") {
						page.cleanup();
					}
				}
			}
			ensureMachineReadableText(
				pdfPath,
				pages,
				pageData.map((page) => page.normalizedText)
			);
			let [headingOne, headingTwo] = inferGlobalHeadingBuckets(pageData);
			let pageBlocks = pageData.map((page) =>
				renderPageMarkdownFromLines(page.normalizedText, page.lines, headingOne, headingTwo)
			);
			let markdown = joinPagesWithFastMarkers(pageBlocks);
			return {
				markdown,
				pages,
				chars: [...markdown].length,
			};
		}
		finally {
			await document.destroy();
		}
	}

	function createAbortError(message = "Request aborted.") {
		let error = new Error(String(message || "Request aborted."));
		error.name = "AbortError";
		return error;
	}

	function resolveAbortControllerCtor() {
		return globalThis.AbortController || null;
	}

	function isAbortSignalLike(value) {
		if (!value || typeof value != "object") {
			return false;
		}
		let ctorName = String(value?.constructor?.name || "").trim();
		return ctorName == "AbortSignal"
			|| ctorName == "nsIAbortSignal"
			|| (typeof value.aborted == "boolean"
				&& typeof value.addEventListener == "function"
				&& typeof value.removeEventListener == "function"
				&& typeof value.throwIfAborted == "function");
	}

	function postJson(url, body, apiKey, timeoutMs = 120000, options = {}) {
		let AbortCtor = resolveAbortControllerCtor();
		let controller = AbortCtor ? new AbortCtor() : null;
		let externalSignal = options?.signal || null;
		let requestSignal = controller
			? controller.signal
			: (isAbortSignalLike(externalSignal) ? externalSignal : null);
		let abortHandler = null;
		if (externalSignal?.aborted) {
			return Promise.reject(createAbortError());
		}
		if (controller && externalSignal && typeof externalSignal.addEventListener == "function") {
			abortHandler = () => controller.abort();
			externalSignal.addEventListener("abort", abortHandler, { once: true });
		}
		let timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
		return fetch(url, {
			method: "POST",
			headers: Object.assign({
				"content-type": "application/json",
			}, apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
			body: JSON.stringify(body),
			...(requestSignal ? { signal: requestSignal } : {}),
		}).then(async (response) => {
			let text = await response.text();
			let json = text ? JSON.parse(text) : {};
			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status} from ${url}: ${typeof json?.error === "object" ? JSON.stringify(json.error) : text}`
				);
			}
			return json;
		}).catch((error) => {
			if (externalSignal?.aborted || controller?.signal?.aborted) {
				throw createAbortError();
			}
			throw error;
		}).finally(() => {
			if (timer) {
				clearTimeout(timer);
			}
			if (externalSignal && abortHandler && typeof externalSignal.removeEventListener == "function") {
				try {
					externalSignal.removeEventListener("abort", abortHandler);
				}
				catch (_error) {}
			}
		});
	}

	async function postEventStream(url, body, apiKey, timeoutMs = 120000, onEvent = null, options = {}) {
		let AbortCtor = resolveAbortControllerCtor();
		let controller = AbortCtor ? new AbortCtor() : null;
		let externalSignal = options?.signal || null;
		let requestSignal = controller
			? controller.signal
			: (isAbortSignalLike(externalSignal) ? externalSignal : null);
		let abortHandler = null;
		if (externalSignal?.aborted) {
			throw createAbortError();
		}
		if (controller && externalSignal && typeof externalSignal.addEventListener == "function") {
			abortHandler = () => controller.abort();
			externalSignal.addEventListener("abort", abortHandler, { once: true });
		}
		let timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
		let response = null;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: Object.assign({
					"content-type": "application/json",
					accept: "text/event-stream",
				}, apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
				body: JSON.stringify(body),
				...(requestSignal ? { signal: requestSignal } : {}),
			});
			if (!response.ok) {
				let text = await response.text();
				let json = {};
				try {
					json = text ? JSON.parse(text) : {};
				}
				catch (_error) {}
				throw new Error(
					`HTTP ${response.status} from ${url}: ${typeof json?.error === "object" ? JSON.stringify(json.error) : text}`
				);
			}
			if (!response.body || typeof response.body.getReader != "function") {
				throw new Error(`Streaming response body is unavailable for ${url}`);
			}
			let reader = response.body.getReader();
			let decoder = new TextDecoder();
			let buffer = "";
			while (true) {
				let { value, done } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
				let boundary = buffer.indexOf("\n\n");
				while (boundary >= 0) {
					let rawEvent = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					let parsed = parseSSEEvent(rawEvent);
					if (parsed) {
						if (["error", "response.error"].includes(String(parsed?.type || "").trim())) {
							let message = String(parsed?.error?.message || parsed?.message || parsed?.error || "Streaming request failed.").trim();
							throw new Error(message || "Streaming request failed.");
						}
						await onEvent?.(parsed);
					}
					boundary = buffer.indexOf("\n\n");
				}
			}
			buffer += decoder.decode();
			buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
			let tail = parseSSEEvent(buffer);
			if (tail) {
				if (["error", "response.error"].includes(String(tail?.type || "").trim())) {
					let message = String(tail?.error?.message || tail?.message || tail?.error || "Streaming request failed.").trim();
					throw new Error(message || "Streaming request failed.");
				}
				await onEvent?.(tail);
			}
		}
		catch (error) {
			if (externalSignal?.aborted || controller?.signal?.aborted) {
				throw createAbortError();
			}
			throw error;
		}
		finally {
			if (timer) {
				clearTimeout(timer);
			}
			if (externalSignal && abortHandler && typeof externalSignal.removeEventListener == "function") {
				try {
					externalSignal.removeEventListener("abort", abortHandler);
				}
				catch (_error) {}
			}
			try {
				response?.body?.cancel?.();
			}
			catch (_error) {}
		}
	}

	function parseSSEEvent(rawBlock = "") {
		let text = String(rawBlock || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
		if (!text) {
			return null;
		}
		let eventName = "";
		let dataLines = [];
		for (let line of text.split("\n")) {
			if (!line || line.startsWith(":")) {
				continue;
			}
			if (line.startsWith("event:")) {
				eventName = line.slice(6).trim();
				continue;
			}
			if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).trimStart());
			}
		}
		let dataText = dataLines.join("\n").trim();
		if (!dataText || dataText == "[DONE]") {
			return null;
		}
		try {
			let payload = JSON.parse(dataText);
			if (payload && typeof payload == "object") {
				if (!payload.type && eventName) {
					payload.type = eventName;
				}
				return payload;
			}
		}
		catch (_error) {}
		return {
			type: eventName || "message",
			data: dataText,
		};
	}

	function responseEventTextDelta(event = {}) {
		if (typeof event?.delta === "string") {
			return event.delta;
		}
		if (typeof event?.text === "string") {
			return event.text;
		}
		if (typeof event?.data === "string" && String(event?.type || "").includes("output_text")) {
			return event.data;
		}
		return "";
	}

	function mergeResponseFunctionCall(state, item = {}) {
		let callID = String(item?.call_id || item?.callID || item?.id || "").trim();
		let name = String(item?.name || "").trim();
		if (!callID && !name) {
			return;
		}
		let current = state.functionCallMap.get(callID || name) || {
			callID: callID || "",
			name,
			argumentsText: "",
		};
		if (callID) {
			current.callID = callID;
		}
		if (name) {
			current.name = name;
		}
		let argumentsText = typeof item?.arguments === "string"
			? item.arguments
			: (item?.arguments && typeof item.arguments == "object"
				? JSON.stringify(item.arguments)
				: "");
		if (argumentsText) {
			current.argumentsText = argumentsText;
		}
		state.functionCallMap.set(current.callID || current.name, current);
	}

	function createResponsesStreamAccumulator() {
		return {
			text: "",
			responseID: "",
			status: "",
			finishReason: "",
			usage: null,
			completedResponse: null,
			functionCallMap: new Map(),
		};
	}

	function applyResponsesStreamEvent(state, event = {}) {
		let type = String(event?.type || "").trim();
		if (!type) {
			return {
				type: "",
				delta: "",
				text: state.text,
			};
		}
		if (!state.responseID) {
			state.responseID = String(
				event?.response?.id
				|| event?.id
				|| ""
			).trim();
		}
		if (event?.response && typeof event.response == "object" && Array.isArray(event.response.output)) {
			state.completedResponse = event.response;
		}
		if (event?.usage && typeof event.usage == "object") {
			state.usage = event.usage;
		}
		if (String(event?.status || "").trim()) {
			state.status = String(event.status || "").trim();
		}
		let delta = "";
		if (type == "response.output_text.delta") {
			delta = responseEventTextDelta(event);
			state.text += delta;
		}
		if (type == "response.output_item.added" && event?.item?.type == "function_call") {
			mergeResponseFunctionCall(state, event.item);
		}
		if ((type == "response.function_call_arguments.delta" || type.endsWith("arguments.delta"))) {
			let callID = String(event?.call_id || event?.item_id || event?.id || "").trim();
			let current = state.functionCallMap.get(callID) || {
				callID,
				name: String(event?.name || "").trim(),
				argumentsText: "",
			};
			current.argumentsText += String(event?.delta || "");
			state.functionCallMap.set(callID, current);
		}
		if (type == "response.completed") {
			let completed = event?.response && typeof event.response == "object"
				? event.response
				: (event && typeof event == "object" && Array.isArray(event.output) ? event : null);
			if (completed) {
				state.completedResponse = completed;
				state.responseID = String(completed.id || state.responseID || "").trim();
				state.status = String(completed.status || state.status || "").trim();
				state.finishReason = String(completed.finish_reason || state.finishReason || state.status || "").trim();
				state.usage = completed.usage && typeof completed.usage == "object" ? completed.usage : state.usage;
			}
		}
		return {
			type,
			delta,
			text: state.text,
		};
	}

	function finalizeTextStateFromResponseStream(state) {
		if (state?.completedResponse) {
			return deriveTextStateFromResponses(state.completedResponse);
		}
		let text = String(state?.text || "").trim();
		let status = String(state?.status || "").trim();
		if (!status) {
			status = text ? "completed" : "incomplete";
		}
		return {
			text,
			eosReached: status === "completed",
			truncated: status === "incomplete",
			finishReason: String(state?.finishReason || status).trim(),
			responseID: String(state?.responseID || "").trim(),
			output: [],
			usage: state?.usage && typeof state.usage == "object" ? state.usage : null,
		};
	}

	function finalizeToolStateFromResponseStream(state) {
		let streamFunctionCalls = [];
		for (let entry of state?.functionCallMap?.values?.() || []) {
			let argumentsText = String(entry?.argumentsText || "").trim();
			let parsedArguments = null;
			let argumentsError = "";
			if (argumentsText) {
				try {
					let parsed = JSON.parse(argumentsText);
					if (!parsed || typeof parsed != "object" || Array.isArray(parsed)) {
						throw new Error("Expected a JSON object.");
					}
					parsedArguments = parsed;
				}
				catch (error) {
					argumentsError = error?.message || String(error);
				}
			}
			streamFunctionCalls.push({
				callID: String(entry?.callID || "").trim(),
				name: String(entry?.name || "").trim(),
				argumentsText,
				arguments: parsedArguments,
				argumentsError,
			});
		}
		if (state?.completedResponse) {
			let completed = deriveToolStateFromResponses(state.completedResponse);
			let mergedByID = new Map();
			for (let call of Array.isArray(completed?.functionCalls) ? completed.functionCalls : []) {
				let key = String(call?.callID || call?.name || "").trim();
				if (key) {
					mergedByID.set(key, Object.assign({}, call));
				}
			}
			for (let streamed of streamFunctionCalls) {
				let key = String(streamed?.callID || streamed?.name || "").trim();
				if (!key) {
					continue;
				}
				let existing = mergedByID.get(key) || null;
				let streamedArgsText = String(streamed?.argumentsText || "").trim();
				let existingArgsText = String(existing?.argumentsText || "").trim();
				let shouldUseStreamedArgs = !existing
					|| !existingArgsText
					|| existingArgsText == "{}"
					|| (existingArgsText.startsWith("{") && existingArgsText.endsWith("}") && Object.keys(existing?.arguments || {}).length === 0);
				if (shouldUseStreamedArgs) {
					mergedByID.set(key, Object.assign({}, existing || {}, streamed, {
						callID: String(streamed?.callID || existing?.callID || "").trim(),
						name: String(streamed?.name || existing?.name || "").trim(),
					}));
				}
			}
			return Object.assign({}, completed, {
				functionCalls: Array.from(mergedByID.values()),
			});
		}
		return Object.assign({}, finalizeTextStateFromResponseStream(state), {
			functionCalls: streamFunctionCalls,
			raw: {},
		});
	}

	function deriveFinishStateFromChat(json) {
		let choice = json?.choices?.[0];
		let content = choice?.message?.content || "";
		let finishReason = choice?.finish_reason ?? null;
		return {
			markdown: sanitizeModelMarkdown(stripThinkContent(String(content || ""))),
			eosReached: finishReason === "stop" || finishReason === null,
			truncated: finishReason === "length",
			finishReason,
		};
	}

	function deriveTextStateFromChat(json) {
		let choice = json?.choices?.[0];
		let content = choice?.message?.content || "";
		let finishReason = choice?.finish_reason ?? null;
		return {
			text: String(content || "").trim(),
			eosReached: finishReason === "stop" || finishReason === null,
			truncated: finishReason === "length",
			finishReason,
		};
	}

	function deriveFinishStateFromResponses(json) {
		let output = Array.isArray(json?.output) ? json.output : [];
		let texts = [];
		for (let item of output) {
			if (item?.type !== "message" || !Array.isArray(item?.content)) {
				continue;
			}
			for (let part of item.content) {
				if (part?.type === "output_text" && typeof part?.text === "string") {
					texts.push(part.text);
				}
			}
		}
		let markdown = sanitizeModelMarkdown(stripThinkContent(texts.join("\n").trim()));
		let status = json?.status ?? null;
		let truncated =
			status === "incomplete" ||
			json?.incomplete_details != null ||
			json?.finish_reason === "length";
		return {
			markdown,
			eosReached: status === "completed" && !json?.incomplete_details,
			truncated,
			finishReason: json?.finish_reason ?? status,
			responseID: typeof json?.id === "string" ? json.id : "",
			output,
			usage: json?.usage && typeof json.usage == "object" ? json.usage : null,
		};
	}

	function deriveTextStateFromResponses(json) {
		let output = Array.isArray(json?.output) ? json.output : [];
		let texts = [];
		for (let item of output) {
			if (item?.type !== "message" || !Array.isArray(item?.content)) {
				continue;
			}
			for (let part of item.content) {
				if (part?.type === "output_text" && typeof part?.text === "string") {
					texts.push(part.text);
				}
			}
		}
		let text = texts.join("\n").trim();
		let status = json?.status ?? null;
		let truncated =
			status === "incomplete" ||
			json?.incomplete_details != null ||
			json?.finish_reason === "length";
		return {
			text,
			eosReached: status === "completed" && !json?.incomplete_details,
			truncated,
			finishReason: json?.finish_reason ?? status,
			responseID: typeof json?.id === "string" ? json.id : "",
			output,
			usage: json?.usage && typeof json.usage == "object" ? json.usage : null,
		};
	}

	function deriveToolStateFromResponses(json) {
		let base = deriveTextStateFromResponses(json);
		let output = Array.isArray(json?.output) ? json.output : [];
		let functionCalls = [];
		for (let item of output) {
			if (item?.type !== "function_call") {
				continue;
			}
			let argumentsText = typeof item?.arguments === "string"
				? item.arguments
				: (item?.arguments && typeof item.arguments == "object"
					? JSON.stringify(item.arguments)
					: "");
			let parsedArguments = null;
			let argumentsError = "";
			if (argumentsText) {
				try {
					let parsed = JSON.parse(argumentsText);
					if (!parsed || typeof parsed != "object" || Array.isArray(parsed)) {
						throw new Error("Expected a JSON object.");
					}
					parsedArguments = parsed;
				}
				catch (error) {
					argumentsError = error?.message || String(error);
				}
			}
			functionCalls.push({
				callID: typeof item?.call_id === "string" ? item.call_id : "",
				name: typeof item?.name === "string" ? item.name : "",
				argumentsText,
				arguments: parsedArguments,
				argumentsError,
			});
		}
		return Object.assign({}, base, {
			functionCalls,
			raw: json && typeof json == "object" ? json : {},
		});
	}

	function ensureClientConfigured(client, purpose) {
		let baseUrl = String(client?.baseUrl || "").trim();
		let model = String(client?.model || "").trim();
		if (!baseUrl) {
			throw new Error(`${purpose} endpoint base URL is not configured. Set it in Zotero Settings -> Systematic Reviewer.`);
		}
		if (!model) {
			throw new Error(`${purpose} model is not configured. Set it in Zotero Settings -> Systematic Reviewer.`);
		}
	}

	function normalizeReasoningEffortValue(value = "") {
		let normalized = String(value || "").trim().toLowerCase();
		return normalized && normalized != "default" ? normalized : "";
	}

	function requestVisionMarkdown(client, prompt, imageDataURL, runtime, useRetryPenalties = false) {
		ensureClientConfigured(client, "VLM");
		let { nPredict } = runtimeDefaults(runtime);
		let baseUrl = client.baseUrl.replace(/\/+$/, "");
		let apiKind = client.apiKind || "auto";
		let apiKinds =
			apiKind === "responses"
				? ["responses"]
				: apiKind === "chat_completions"
					? ["chat_completions"]
					: ["responses", "chat_completions"];
		let lastError = null;
		let run = async () => {
			let reasoningEffort = normalizeReasoningEffortValue(client.reasoningEffort || "");
			for (let kind of apiKinds) {
				try {
					if (kind === "responses") {
						let json = await postJson(
							`${baseUrl}/responses`,
							Object.assign({
								model: client.model,
								input: [{
									role: "user",
									content: [
										{ type: "input_text", text: prompt },
										{ type: "input_image", image_url: imageDataURL },
									],
								}],
								max_output_tokens: client.maxOutputTokens || nPredict,
							}, reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
							client.apiKey,
							client.timeoutMs
						);
						return deriveFinishStateFromResponses(json);
					}
					let json = await postJson(
						`${baseUrl}/chat/completions`,
						{
							model: client.model,
							messages: [{
								role: "user",
								content: [
									{ type: "text", text: prompt },
									{ type: "image_url", image_url: { url: imageDataURL } },
							],
							}],
							max_tokens: client.maxOutputTokens || nPredict,
							...(useRetryPenalties ? { presence_penalty: 0.15, frequency_penalty: 0.1 } : {}),
						},
						client.apiKey,
						client.timeoutMs
					);
					return deriveFinishStateFromChat(json);
				}
				catch (error) {
					lastError = error;
				}
			}
			throw lastError instanceof Error ? lastError : new Error(String(lastError));
		};
		return scheduleRuntimeRequest(client, run);
	}

	function requestTextChat(client, messages, runtime, useRetryPenalties = false, options = {}) {
		ensureClientConfigured(client, "Chat");
		let { nPredict } = runtimeDefaults(runtime);
		let baseUrl = client.baseUrl.replace(/\/+$/, "");
		let inputText = typeof options.inputText == "string" && options.inputText.trim()
			? options.inputText.trim()
			: messages.map((message) => `${String(message.role || "user").toUpperCase()}:\n${message.content}`).join("\n\n");
		if (String(client?.runtimeType || "").trim() == "local_exec") {
			let payload = {
				model: client.model,
				input: inputText,
				max_output_tokens: client.maxOutputTokens || nPredict,
				stream: !!options.stream,
			};
			if (typeof options.instructions == "string" && options.instructions.trim()) {
				payload.instructions = options.instructions.trim();
			}
			if (typeof options.previousResponseID == "string" && options.previousResponseID.trim()) {
				payload.previous_response_id = options.previousResponseID.trim();
			}
			if (options.store !== undefined) {
				payload.store = !!options.store;
			}
			let reasoningEffort = normalizeReasoningEffortValue(options.reasoningEffort || client.reasoningEffort || "");
			if (reasoningEffort) {
				payload.reasoning = { effort: reasoningEffort };
			}
			return requestResponses(client, payload, {
				stream: !!options.stream,
				onEvent: options.onEvent,
				signal: options.signal || null,
			});
		}
		let apiKind = client.apiKind || "auto";
		let apiKinds =
			apiKind === "responses"
				? ["responses"]
				: apiKind === "chat_completions"
					? ["chat_completions"]
					: ["responses", "chat_completions"];
		let lastError = null;
		let run = async () => {
			for (let kind of apiKinds) {
				try {
					if (kind === "responses") {
						let payload = {
							model: client.model,
							input: inputText,
							max_output_tokens: client.maxOutputTokens || nPredict,
							stream: !!options.stream,
						};
						if (typeof options.instructions == "string" && options.instructions.trim()) {
							payload.instructions = options.instructions.trim();
						}
						if (typeof options.previousResponseID == "string" && options.previousResponseID.trim()) {
							payload.previous_response_id = options.previousResponseID.trim();
						}
						if (options.store !== undefined) {
							payload.store = !!options.store;
						}
						let reasoningEffort = normalizeReasoningEffortValue(options.reasoningEffort || client.reasoningEffort || "");
						if (reasoningEffort) {
							payload.reasoning = { effort: reasoningEffort };
						}
						if (options.stream) {
							let streamState = createResponsesStreamAccumulator();
							await postEventStream(
								`${baseUrl}/responses`,
								payload,
								client.apiKey,
								client.timeoutMs,
								async (event) => {
									let snapshot = applyResponsesStreamEvent(streamState, event);
									if (snapshot.delta || snapshot.type == "response.completed") {
										await options.onEvent?.(Object.assign({}, event, {
											text: snapshot.text,
											delta: snapshot.delta,
										}));
									}
									else {
										await options.onEvent?.(event);
									}
								},
								{
									signal: options.signal || null,
								}
							);
							return finalizeTextStateFromResponseStream(streamState);
						}
						let json = await postJson(
							`${baseUrl}/responses`,
							payload,
							client.apiKey,
							client.timeoutMs,
							{
								signal: options.signal || null,
							}
						);
						return deriveTextStateFromResponses(json);
					}
					let json = await postJson(
						`${baseUrl}/chat/completions`,
						{
							model: client.model,
							messages: messages.map((message) => ({
								role: message.role,
								content: message.content,
							})),
							max_tokens: client.maxOutputTokens || nPredict,
							...(useRetryPenalties ? { presence_penalty: 0.15, frequency_penalty: 0.1 } : {}),
						},
						client.apiKey,
						client.timeoutMs
					);
					return deriveTextStateFromChat(json);
				}
				catch (error) {
					lastError = error;
				}
			}
			throw lastError instanceof Error ? lastError : new Error(String(lastError));
		};
		return scheduleRuntimeRequest(client, run);
	}

	function requestResponses(client, payload = {}, options = {}) {
		ensureClientConfigured(client, "Responses");
		if (
			String(client?.runtimeType || "").trim() != "local_exec" &&
			String(client?.apiKind || "").trim() == "chat_completions"
		) {
			if (typeof SystematicReviewerChatCompletionsResponsesBridge == "undefined" || !SystematicReviewerChatCompletionsResponsesBridge?.requestResponses) {
				throw new Error("Chat Completions bridge is unavailable.");
			}
			return scheduleRuntimeRequest(client, () => SystematicReviewerChatCompletionsResponsesBridge.requestResponses(
				client,
				payload,
				options,
				{
					postJson,
					postEventStream,
					deriveToolStateFromResponses,
				}
			));
		}
		let baseUrl = client.baseUrl.replace(/\/+$/, "");
		let streamBaseUrl = String(client?.streamBaseUrl || client?.baseUrl || "").replace(/\/+$/, "");
		let run = async () => {
			let requestPayload = payload && typeof payload == "object" ? Object.assign({}, payload) : {};
			if (String(client?.runtimeType || "").trim() == "local_exec") {
				let roleID = String(client?.roleID || "").trim();
				let presetID = String(client?.presetID || "").trim();
				if (roleID && !Object.prototype.hasOwnProperty.call(requestPayload, "runtime_role_id")) {
					requestPayload.runtime_role_id = roleID;
				}
				if (presetID && !Object.prototype.hasOwnProperty.call(requestPayload, "runtime_preset_id")) {
					requestPayload.runtime_preset_id = presetID;
				}
			}
			let useStream = !!options.stream || requestPayload.stream === true;
			if (useStream && !Object.prototype.hasOwnProperty.call(requestPayload, "stream")) {
				requestPayload.stream = true;
			}
			if (useStream) {
				let streamState = createResponsesStreamAccumulator();
				await postEventStream(
					`${streamBaseUrl}/responses`,
					requestPayload,
					client.apiKey,
					client.timeoutMs,
					async (event) => {
						let snapshot = applyResponsesStreamEvent(streamState, event);
						let type = String(event?.type || "").trim();
						if (useStream) {
							let forwardedEvent = Object.assign({}, event);
							if (type == "response.output_text.delta" || type == "response.output_text.done") {
								forwardedEvent.text = snapshot.text;
								forwardedEvent.delta = snapshot.delta;
							}
							await options.onEvent?.(forwardedEvent);
						}
					},
					{
						signal: options.signal || null,
					}
				);
				return finalizeToolStateFromResponseStream(streamState);
			}
			let json = await postJson(
				`${baseUrl}/responses`,
				requestPayload,
				client.apiKey,
				client.timeoutMs,
				{
					signal: options.signal || null,
				}
			);
			return deriveToolStateFromResponses(json);
		};
		return scheduleRuntimeRequest(client, run);
	}

	async function loadImageDataURLWithScaling(imagePath, runtime) {
		let settings = runtimeDefaults(runtime);
		let win = getCanvasWindow();
		let imageURL = Zotero.File.pathToFileURI(imagePath);
		let image = await new Promise((resolve, reject) => {
			let img = new win.Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error(`Failed to load image: ${imagePath}`));
			img.src = imageURL;
		});
		let targetWidth = Math.max(1, Math.round(image.naturalWidth * settings.scale));
		let targetHeight = Math.max(1, Math.round(image.naturalHeight * settings.scale));
		let tempWidth = Math.max(1, Math.round(image.naturalWidth * settings.scale * settings.oversample));
		let tempHeight = Math.max(1, Math.round(image.naturalHeight * settings.scale * settings.oversample));
		let tempCanvas = createCanvas(tempWidth, tempHeight);
		let tempContext = tempCanvas.getContext("2d");
		tempContext.imageSmoothingEnabled = true;
		tempContext.imageSmoothingQuality = "high";
		tempContext.drawImage(image, 0, 0, tempCanvas.width, tempCanvas.height);
		let finalCanvas = createCanvas(targetWidth, targetHeight);
		let finalContext = finalCanvas.getContext("2d");
		finalContext.imageSmoothingEnabled = true;
		finalContext.imageSmoothingQuality = "high";
		finalContext.drawImage(
			tempCanvas,
			0, 0, tempCanvas.width, tempCanvas.height,
			0, 0, finalCanvas.width, finalCanvas.height
		);
		return canvasToDataURL(finalCanvas);
	}

	async function renderPdfPagesToDataURLsViaReaderPreview(attachmentItemID, runtime, hooks = null) {
		let preview = await openHiddenReaderPreview(attachmentItemID);
		if (!preview?.pdfDocument || !preview?.readerWindow) {
			throw new Error(`No PDF reader preview is available for attachment ${attachmentItemID}`);
		}
		try {
			return await renderPdfPagesToDataURLsViaReaderBridge(preview, runtime, hooks);
		}
		finally {
			cleanupHiddenReaderPreview(preview);
		}
	}

	async function renderPdfPagesToDataURLsViaBackgroundReaderTab(attachmentItemID, runtime, hooks = null) {
		let handle = await openBackgroundReaderTab(attachmentItemID);
		if (!handle?.pdfDocument || !handle?.readerWindow) {
			throw new Error(`No background PDF reader is available for attachment ${attachmentItemID}`);
		}
		try {
			return await renderPdfPagesToDataURLsViaReaderBridge(handle, runtime, hooks);
		}
		finally {
			cleanupBackgroundReaderTab(handle);
		}
	}

	async function renderPdfPagesToDataURLsViaReaderBridge(handle, runtime, hooks = null) {
		let settings = runtimeDefaults(runtime);
		ensureReaderRenderBridge(handle?.readerWindow);
		let requestID = startReaderRenderRequest(handle?.readerWindow, {
			scale: settings.scale,
			oversample: settings.oversample,
		});
		if (hooks?.onLog) {
			await hooks.onLog("info", `PDF reader render request started: ${requestID}`);
		}
		let ownerWindow = handle?.readerWindow || handle?.readerGlobal || null;
		let startTime = Date.now();
		let lastPhase = "";
		let pages = null;
		while (Date.now() - startTime < PDF_RENDER_REQUEST_TIMEOUT_MS) {
			let requestState = getReaderRenderRequestState(handle?.readerWindow, requestID);
			if (!requestState) {
				await new Promise((resolve) => (ownerWindow?.setTimeout || setTimeout)(resolve, 100));
				continue;
			}
			if (requestState?.phase && requestState.phase !== lastPhase && hooks?.onLog) {
				lastPhase = requestState.phase;
				await hooks.onLog("info", `PDF reader render phase: ${requestState.phase}`);
			}
			if (requestState?.status == "failed") {
				throw new Error(String(requestState.error || "PDF reader render request failed"));
			}
			if (requestState?.status == "succeeded") {
				pages = requestState.result;
				break;
			}
			await new Promise((resolve) => (ownerWindow?.setTimeout || setTimeout)(resolve, 100));
		}
		if (!pages) {
			throw new Error("Timed out waiting for PDF reader render request");
		}
		let total = Array.isArray(pages) ? pages.length : 0;
		let renderedPages = [];
		for (let index = 0; index < total; index += 1) {
			let pageData = pages[index];
			renderedPages.push({
				page: Number(pageData?.page) || (index + 1),
				imageDataURL: String(pageData?.imageDataURL || ""),
			});
			await reportProgress(hooks, {
				phase: "render",
				current: index + 1,
				total,
				message: `Rendered page ${index + 1}/${total}`,
			});
		}
		return renderedPages;
	}

	async function renderPdfPagesToDataURLsViaImportedPdfJs(pdfPath, runtime, hooks = null) {
		let settings = runtimeDefaults(runtime);
		let pdfjsLib = await loadPdfJs();
		let data = await localFileBytes(pdfPath);
		let loadingTask = pdfjsLib.getDocument({
			data,
			useSystemFonts: true,
			isEvalSupported: false,
			cMapUrl: PDF_CMAP_URL,
			cMapPacked: true,
			standardFontDataUrl: PDF_STANDARD_FONTS_URL,
			wasmUrl: PDF_WASM_URL,
		});
		let document = await loadingTask.promise;
		try {
			let pages = [];
			for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
				let page = await document.getPage(pageNumber);
				try {
					let renderViewport = page.getViewport({ scale: settings.scale * settings.oversample });
					let renderCanvas = createCanvas(renderViewport.width, renderViewport.height);
					let renderContext = renderCanvas.getContext("2d");
					await page.render({
						canvasContext: renderContext,
						viewport: renderViewport,
					}).promise;
					pages.push({
						page: pageNumber,
						imageDataURL: canvasToDataURL(renderCanvas),
					});
					await reportProgress(hooks, {
						phase: "render",
						current: pageNumber,
						total: document.numPages,
						message: `Rendered page ${pageNumber}/${document.numPages}`,
					});
				}
				finally {
					page.cleanup();
				}
			}
			return pages;
		}
		finally {
			await document.destroy();
		}
	}

	async function renderPdfPagesToDataURLsViaBundledPdfJsHost(pdfPath, runtime, hooks = null) {
		let settings = runtimeDefaults(runtime);
		if (hooks?.onLog) {
			await hooks.onLog("info", "Opening PDF render host");
		}
		let handle = await openHiddenPdfRenderHost();
		try {
			if (hooks?.onLog) {
				await hooks.onLog("info", "PDF render host ready");
			}
			let global = getBrowserHostGlobal(handle.browser);
			let host = handle.host || global?.srPdfRenderHost;
			if (!host || typeof host.startRenderPdfPages != "function" || typeof host.getRenderRequestState != "function") {
				throw new Error("PDF render host did not expose render request methods");
			}
			let pdfURL = Zotero.File.pathToFileURI(pdfPath);
			let requestID = host.startRenderPdfPages(pdfURL, {
				scale: settings.scale,
				oversample: settings.oversample,
			});
			if (hooks?.onLog) {
				await hooks.onLog("info", `PDF render request started: ${requestID}`);
			}
			let ownerWindow = handle.browser?.ownerGlobal || handle.browser?.ownerDocument?.defaultView || null;
			let startTime = Date.now();
			let lastPhase = "";
			let pages = null;
			while (Date.now() - startTime < PDF_RENDER_REQUEST_TIMEOUT_MS) {
				let requestState = host.getRenderRequestState(requestID);
				if (!requestState) {
					await new Promise((resolve) => (ownerWindow?.setTimeout || setTimeout)(resolve, 100));
					continue;
				}
				if (requestState?.phase && requestState.phase !== lastPhase && hooks?.onLog) {
					lastPhase = requestState.phase;
					await hooks.onLog("info", `PDF render phase: ${requestState.phase}`);
				}
				if (requestState?.status == "failed") {
					throw new Error(String(requestState.error || "PDF render request failed"));
				}
				if (requestState?.status == "succeeded") {
					pages = requestState.result;
					break;
				}
				await new Promise((resolve) => (ownerWindow?.setTimeout || setTimeout)(resolve, 100));
			}
			if (!pages) {
				throw new Error("Timed out waiting for PDF render request");
			}
			let total = Array.isArray(pages) ? pages.length : 0;
			let renderedPages = [];
			for (let index = 0; index < total; index += 1) {
				let pageData = pages[index];
				renderedPages.push({
					page: Number(pageData?.page) || (index + 1),
					imageDataURL: String(pageData?.imageDataURL || ""),
				});
				await reportProgress(hooks, {
					phase: "render",
					current: index + 1,
					total,
					message: `Rendered page ${index + 1}/${total}`,
				});
			}
			return renderedPages;
		}
		finally {
			cleanupHiddenPdfRenderHost(handle);
		}
	}

	async function renderPdfPagesToDataURLs(pdfPath, runtime, hooks = null, attachmentItemID = null) {
		if (hooks?.onLog) {
			await hooks.onLog("info", "Preparing PDF pages for vision conversion");
		}
		if (attachmentItemID && (Zotero.Reader?.openPreview || Zotero.Reader?.open)) {
			return renderPdfPagesToDataURLsViaReader(attachmentItemID, runtime, hooks);
		}
		return renderPdfPagesToDataURLsViaCompatibilityFallback(pdfPath, runtime, hooks);
	}

	async function runImageVlm(imagePath, outputPath, client, runtime, prompt = DEFAULT_IMAGE_VLM_PROMPT, hooks = null) {
		let settings = runtimeDefaults(runtime);
		let imageDataURL = await loadImageDataURLWithScaling(imagePath, settings);
		let attempts = 0;
		let response = null;
		while (attempts <= settings.maxRetries) {
			let retryAttempt = attempts > 0;
			try {
				let result = await requestVisionMarkdown(
					client,
					(prompt || DEFAULT_IMAGE_VLM_PROMPT).trim(),
					imageDataURL,
					settings,
					retryAttempt
				);
				let loopDetected = hasLoop(result.markdown);
				let bad = !result.eosReached || result.truncated || loopDetected;
				attempts += 1;
				if (bad && attempts <= settings.maxRetries) {
					if (hooks?.onLog) {
						await hooks.onLog("warn", `Image retry ${attempts}/${settings.maxRetries}: eos_reached=${result.eosReached}, truncated=${result.truncated}, loop_detected=${loopDetected}`);
					}
					continue;
				}
				if (bad) {
					throw new Error(
						`quality gate failed after ${attempts} attempts: eos_reached=${result.eosReached}, truncated=${result.truncated}, loop_detected=${loopDetected}`
					);
				}
				response = result;
				break;
			}
			catch (error) {
				attempts += 1;
				if (attempts > settings.maxRetries) {
					throw new Error(
						`inference failed after ${attempts} attempts: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				if (hooks?.onLog) {
					await hooks.onLog("warn", `Image inference retry ${attempts}/${settings.maxRetries}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
		if (!response) {
			throw new Error("Image VLM did not produce a response");
		}
		let markdown = `<--page1-->\n\n${response.markdown}${response.markdown.endsWith("\n") ? "" : "\n"}`;
		let sanitized = sanitizeOuterMarkdownFence(markdown);
		await Zotero.File.putContentsAsync(outputPath, sanitized);
		return sanitized;
	}

	async function runPdfVlm(pdfPath, outputPath, client, runtime, prompt = DEFAULT_VLM_PROMPT, hooks = null, attachmentItemID = null) {
		let settings = runtimeDefaults(runtime);
		let renderedPages = await renderPdfPagesToDataURLs(pdfPath, settings, hooks, attachmentItemID);
		if (!renderedPages.length) {
			throw new Error("No pages rendered");
		}
		let rows = [];
		let completedPages = 0;
		let nextPageIndex = 0;
		let workerCount = Math.max(1, Math.min(renderedPages.length, Number(client?.parallelRequests || 1) || 1));
		let workers = Array.from({ length: workerCount }, () => (async () => {
			while (true) {
				let currentIndex = nextPageIndex;
				nextPageIndex += 1;
				if (currentIndex >= renderedPages.length) {
					return;
				}
				let renderedPage = renderedPages[currentIndex];
				let attempts = 0;
				let finalResponse = null;
				while (attempts <= settings.maxRetries) {
					let retryAttempt = attempts > 0;
					try {
						let result = await requestVisionMarkdown(
							client,
							(prompt || DEFAULT_VLM_PROMPT).trim(),
							renderedPage.imageDataURL,
							settings,
							retryAttempt
						);
						let loopDetected = hasLoop(result.markdown);
						let bad = !result.eosReached || result.truncated || loopDetected;
						attempts += 1;
						if (bad && attempts <= settings.maxRetries) {
							if (hooks?.onLog) {
								await hooks.onLog("warn", `Page ${renderedPage.page} retry ${attempts}/${settings.maxRetries}: eos_reached=${result.eosReached}, truncated=${result.truncated}, loop_detected=${loopDetected}`);
							}
							continue;
						}
						if (bad) {
							throw new Error(
								`quality gate failed for page ${String(renderedPage.page).padStart(4, "0")} after ${attempts} attempts: eos_reached=${result.eosReached}, truncated=${result.truncated}, loop_detected=${loopDetected}`
							);
						}
						finalResponse = result;
						break;
					}
					catch (error) {
						attempts += 1;
						if (attempts > settings.maxRetries) {
							throw new Error(
								`inference failed for page ${String(renderedPage.page).padStart(4, "0")} after ${attempts} attempts: ${error instanceof Error ? error.message : String(error)}`
							);
						}
						if (hooks?.onLog) {
							await hooks.onLog("warn", `Page ${renderedPage.page} inference retry ${attempts}/${settings.maxRetries}: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}
				if (!finalResponse) {
					throw new Error(`Page ${renderedPage.page} did not produce a response`);
				}
				rows.push({ page: renderedPage.page, markdown: finalResponse.markdown });
				completedPages += 1;
				await reportProgress(hooks, {
					phase: "vlm",
					current: completedPages,
					total: renderedPages.length,
					message: `VLM completed ${completedPages}/${renderedPages.length} page requests.`,
				});
			}
		})());
		await Promise.all(workers);
		rows.sort((a, b) => a.page - b.page);
		let markdown = sanitizeOuterMarkdownFence(joinPagesWithVlmMarkers(rows));
		await Zotero.File.putContentsAsync(outputPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
		return markdown;
	}

	function conversionSuffixForMode(modeLabel) {
		let normalized = String(modeLabel || "").trim().toUpperCase();
		return normalized == "V" || normalized == "VLM" ? "V" : "F";
	}

	function outputLeafNameForInputLeafName(inputLeafName, modeLabel) {
		let fileName = String(inputLeafName || "").trim();
		let stem = fileName.replace(/\.[^.]+$/, "").trim();
		if (!stem) {
			throw new Error(`cannot determine file stem for '${inputLeafName}'`);
		}
		return `${stem}${conversionSuffixForMode(modeLabel)}.md`;
	}

	function conversionOutputPathForSource(inputPath, modeLabel) {
		let file = Zotero.File.pathToFile(inputPath);
		let parent = file.parent;
		let out = parent.clone();
		out.append(outputLeafNameForInputLeafName(file.leafName, modeLabel));
		return out.path;
	}

	function conversionOutputPathForSourceInDirectory(inputPath, outputDir, modeLabel) {
		let file = Zotero.File.pathToFile(inputPath);
		let out = Zotero.File.pathToFile(outputDir);
		out.append(outputLeafNameForInputLeafName(file.leafName, modeLabel));
		return out.path;
	}

	function conversionOutputPaths(inputPath, outputDir = null) {
		if (outputDir) {
			return {
				fastOutputPath: conversionOutputPathForSourceInDirectory(inputPath, outputDir, "F"),
				vlmOutputPath: conversionOutputPathForSourceInDirectory(inputPath, outputDir, "V"),
			};
		}
		return {
			fastOutputPath: conversionOutputPathForSource(inputPath, "F"),
			vlmOutputPath: conversionOutputPathForSource(inputPath, "V"),
		};
	}

	async function convertSource(options) {
		let { inputPath, mode, client, runtime, pdfPrompt, imagePrompt, hooks, outputDir, attachmentItemID } = options;
		let normalizedMode = String(mode || "fast_with_vlm_fallback").trim().toLowerCase();
		let ext = String(inputPath).toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
		let isPdf = ext === ".pdf";
		let outputs = conversionOutputPaths(inputPath, outputDir || null);

		if (!isPdf) {
			let markdown = await runImageVlm(
				inputPath,
				outputs.vlmOutputPath,
				client,
				runtime,
				(imagePrompt || DEFAULT_IMAGE_VLM_PROMPT).trim(),
				hooks
			);
			return {
				usedMode: "vlm",
				fallbackUsed: false,
				outputPath: outputs.vlmOutputPath,
				markdown,
			};
		}

		if (normalizedMode === "fast") {
			let fast = await extractFastPdfMarkdown(inputPath, hooks, attachmentItemID || null);
			let markdown = sanitizeOuterMarkdownFence(fast.markdown);
			await Zotero.File.putContentsAsync(
				outputs.fastOutputPath,
				markdown.endsWith("\n") ? markdown : `${markdown}\n`
			);
			return {
				usedMode: "fast",
				fallbackUsed: false,
				outputPath: outputs.fastOutputPath,
				markdown,
			};
		}

		if (normalizedMode === "vlm") {
			let markdown = await runPdfVlm(
				inputPath,
				outputs.vlmOutputPath,
				client,
				runtime,
				(pdfPrompt || DEFAULT_VLM_PROMPT).trim(),
				hooks,
				attachmentItemID || null
			);
			return {
				usedMode: "vlm",
				fallbackUsed: false,
				outputPath: outputs.vlmOutputPath,
				markdown,
			};
		}

		try {
			let fast = await extractFastPdfMarkdown(inputPath, hooks, attachmentItemID || null);
			let markdown = sanitizeOuterMarkdownFence(fast.markdown);
			await Zotero.File.putContentsAsync(
				outputs.fastOutputPath,
				markdown.endsWith("\n") ? markdown : `${markdown}\n`
			);
			return {
				usedMode: "fast",
				fallbackUsed: false,
				outputPath: outputs.fastOutputPath,
				markdown,
			};
		}
		catch (error) {
			let message = error instanceof Error ? error.message : String(error);
			if (hooks?.onLog) {
				let nonMachineReadable = fastErrorLooksNonMachineReadable(message);
				await hooks.onLog(
					"info",
					nonMachineReadable
						? `FAST path rejected as non-machine-readable, falling back to VLM: ${message}`
						: `FAST extraction failed, falling back to VLM: ${message}`
				);
			}
		}

		let markdown = await runPdfVlm(
			inputPath,
			outputs.vlmOutputPath,
			client,
			runtime,
			(pdfPrompt || DEFAULT_VLM_PROMPT).trim(),
			hooks,
			attachmentItemID || null
		);
		return {
			usedMode: "vlm",
			fallbackUsed: true,
			outputPath: outputs.vlmOutputPath,
			markdown,
		};
	}

	return {
		DEFAULT_VLM_PROMPT,
		DEFAULT_IMAGE_VLM_PROMPT,
		runtimeDefaults,
		splitFastTextIntoPages,
		conversionSuffixForMode,
		outputLeafNameForInputLeafName,
		conversionOutputPaths,
		fastErrorLooksNonMachineReadable,
		extractFastPdfMarkdown,
		requestVisionMarkdown,
		requestTextChat,
		requestResponses,
		runImageVlm,
		runPdfVlm,
		convertSource,
		dataURLToUint8Array,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerPDFMarkdown;
}
