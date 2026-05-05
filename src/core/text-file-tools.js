var SystematicReviewerTextFileTools = (() => {
	const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*$/;

	function normalizeNewlines(value) {
		return String(value || "").replace(/\r\n?/g, "\n");
	}

	function detectLineEnding(value) {
		return String(value || "").includes("\r\n") ? "\r\n" : "\n";
	}

	function restoreLineEndings(value, ending = "\n") {
		let normalized = normalizeNewlines(value);
		return ending == "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
	}

	function decomposeText(value) {
		let normalized = normalizeNewlines(value);
		let hadTrailingNewline = normalized.endsWith("\n");
		let lines = normalized.split("\n");
		if (hadTrailingNewline) {
			lines.pop();
		}
		return {
			text: normalized,
			lines,
			hadTrailingNewline,
		};
	}

	function recomposeText(lines, hadTrailingNewline = false) {
		let out = (Array.isArray(lines) ? lines : []).map((line) => String(line ?? "")).join("\n");
		return hadTrailingNewline ? `${out}\n` : out;
	}

	function normalizeLineNumber(value, label) {
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1) {
			throw new Error(`${label} must be a positive integer.`);
		}
		return parsed;
	}

	function normalizeOptionalPositiveInteger(value, label) {
		if (value === undefined || value === null || value === "") {
			return null;
		}
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1) {
			throw new Error(`${label} must be a positive integer.`);
		}
		return parsed;
	}

	function sliceTextByLines(value, options = {}) {
		let decomposed = decomposeText(value);
		let lines = decomposed.lines;
		let totalLines = lines.length;
		let startLine = normalizeOptionalPositiveInteger(
			options.startLine ?? options.start_line ?? options.fromLine ?? options.from_line,
			"startLine"
		) || 1;
		let endLine = normalizeOptionalPositiveInteger(
			options.endLine ?? options.end_line ?? options.toLine ?? options.to_line,
			"endLine"
		);
		let maxLines = normalizeOptionalPositiveInteger(
			options.maxLines ?? options.max_lines ?? options.limit,
			"maxLines"
		);
		if (totalLines === 0 && (startLine > 1 || endLine)) {
			throw new Error("Cannot select lines from an empty file.");
		}
		if (startLine > Math.max(1, totalLines)) {
			throw new Error(`startLine ${startLine} is outside the file.`);
		}
		if (endLine === null) {
			endLine = maxLines !== null ? Math.min(totalLines, startLine + maxLines - 1) : totalLines;
		}
		if (endLine < startLine) {
			throw new Error(`endLine ${endLine} must be greater than or equal to startLine ${startLine}.`);
		}
		if (endLine > totalLines) {
			throw new Error(`endLine ${endLine} is outside the file.`);
		}
		let selected = lines.slice(startLine - 1, endLine);
		let selectionTrailingNewline = decomposed.hadTrailingNewline && endLine == totalLines;
		let numbered = selected
			.map((line, index) => `${startLine + index}: ${line}`)
			.join("\n");
		return {
			content: recomposeText(selected, selectionTrailingNewline),
			lineNumberedContent: recomposeText(numbered ? numbered.split("\n") : [], selectionTrailingNewline),
			startLine,
			endLine,
			totalLines,
			hasMoreBefore: startLine > 1,
			hasMoreAfter: endLine < totalLines,
			lines: selected.map((text, index) => ({
				line: startLine + index,
				text,
			})),
		};
	}

	function extractMarkdownHeadings(markdown) {
		let lines = decomposeText(markdown).lines;
		let headings = [];
		let stack = [];
		for (let index = 0; index < lines.length; index++) {
			let match = lines[index].match(HEADING_RE);
			if (!match) {
				continue;
			}
			let level = Math.min(6, match[1].length);
			let text = String(match[2] || "").trim();
			stack[level - 1] = text;
			stack.length = level;
			headings.push({
				line: index + 1,
				level,
				text,
				path: stack.slice().filter((part) => String(part || "").trim()),
			});
		}
		return headings;
	}

	function normalizeHeadingPath(input) {
		if (Array.isArray(input)) {
			return input.map((part) => String(part || "").trim()).filter(Boolean);
		}
		let single = String(input || "").trim();
		return single ? [single] : [];
	}

	function normalizeHeadingLabel(value) {
		return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
	}

	function pathsEqual(left, right) {
		if (left.length != right.length) {
			return false;
		}
		for (let index = 0; index < left.length; index++) {
			if (left[index] != right[index]) {
				return false;
			}
		}
		return true;
	}

	function pathEndsWith(left, right) {
		if (right.length > left.length) {
			return false;
		}
		let offset = left.length - right.length;
		for (let index = 0; index < right.length; index++) {
			if (left[offset + index] != right[index]) {
				return false;
			}
		}
		return true;
	}

	function normalizeHeadingLevel(value) {
		if (value === undefined || value === null || value === "") {
			return null;
		}
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
			throw new Error(`Heading level must be between 1 and 6. Received: ${value}`);
		}
		return parsed;
	}

	function normalizeHeadingOccurrence(value) {
		if (value === undefined || value === null || value === "") {
			return 1;
		}
		let parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1) {
			throw new Error(`Heading occurrence must be a positive integer. Received: ${value}`);
		}
		return parsed;
	}

	function resolveMarkdownHeading(markdown, query = {}, options = {}) {
		let headings = Array.isArray(markdown) ? markdown : extractMarkdownHeadings(markdown);
		let input = query;
		let headingPath = normalizeHeadingPath(
			query?.headingPath
			|| query?.heading_path
			|| query?.path
			|| query?.heading
			|| query?.title
			|| input
		);
		if (!headingPath.length) {
			return {
				match: null,
				matches: [],
				headings,
			};
		}
		let normalizedPath = headingPath.map(normalizeHeadingLabel);
		let level = normalizeHeadingLevel(query?.level ?? query?.headingLevel ?? query?.heading_level ?? null);
		let occurrence = normalizeHeadingOccurrence(query?.occurrence ?? query?.match ?? null);
		let afterLine = Number(options.afterLine || 0) || 0;
		let exactPath = headingPath.length > 1 || Array.isArray(query?.headingPath || query?.heading_path || query?.path || input);
		let candidateMatches = headings.filter((heading) => {
			if (heading.line <= afterLine) {
				return false;
			}
			if (level !== null && heading.level != level) {
				return false;
			}
			return true;
		});
		let matches = exactPath
			? candidateMatches.filter((heading) =>
				pathsEqual(heading.path.map(normalizeHeadingLabel), normalizedPath)
			)
			: candidateMatches.filter((heading) =>
				normalizeHeadingLabel(heading.text) == normalizedPath[normalizedPath.length - 1]
			);
		if (exactPath && !matches.length) {
			matches = candidateMatches.filter((heading) =>
				pathEndsWith(heading.path.map(normalizeHeadingLabel), normalizedPath)
			);
		}
		return {
			match: matches[occurrence - 1] || null,
			matches,
			headings,
		};
	}

	function offsetForLine(lines, lineIndex) {
		let offset = 0;
		for (let index = 0; index < lineIndex; index++) {
			offset += lines[index].length + 1;
		}
		return offset;
	}

	function buildMarkdownRangeResult(text, lines, hadTrailingNewline, headings, startLine, endLine, meta = {}) {
		let safeStartLine = Math.max(1, Number(startLine || 1) || 1);
		let safeEndLine = Math.max(safeStartLine - 1, Number(endLine || 0) || 0);
		let startIndex = Math.max(0, safeStartLine - 1);
		let endIndexExclusive = Math.max(startIndex, safeEndLine);
		let selectedLines = safeEndLine >= safeStartLine ? lines.slice(startIndex, endIndexExclusive) : [];
		let selectionTrailingNewline = hadTrailingNewline && safeEndLine == lines.length;
		return Object.assign({
			startLine: safeStartLine,
			endLine: safeEndLine,
			content: recomposeText(selectedLines, selectionTrailingNewline),
			hasMoreBefore: safeStartLine > 1,
			hasMoreAfter: safeEndLine < lines.length,
			headings: headings.filter((heading) => heading.line >= safeStartLine && heading.line <= safeEndLine),
		}, meta);
	}

	function findMarkdownSection(markdown, query = {}) {
		let decomposed = decomposeText(markdown);
		let headings = extractMarkdownHeadings(decomposed.text);
		let resolved = resolveMarkdownHeading(headings, query);
		let match = resolved.match;
		if (!match) {
			return null;
		}
		let headingIndex = headings.findIndex((heading) => heading.line == match.line && heading.level == match.level);
		let nextHeading = null;
		for (let index = headingIndex + 1; index < headings.length; index++) {
			if (headings[index].level <= match.level) {
				nextHeading = headings[index];
				break;
			}
		}
		let endLine = nextHeading ? nextHeading.line - 1 : decomposed.lines.length;
		let startOffset = offsetForLine(decomposed.lines, match.line - 1);
		let endOffset = nextHeading
			? offsetForLine(decomposed.lines, nextHeading.line - 1)
			: decomposed.text.length;
		let bodyStartLine = Math.min(endLine + 1, match.line + 1);
		let bodyStartOffset = bodyStartLine > endLine
			? endOffset
			: offsetForLine(decomposed.lines, bodyStartLine - 1);
		let base = buildMarkdownRangeResult(
			decomposed.text,
			decomposed.lines,
			decomposed.hadTrailingNewline,
			headings,
			match.line,
			endLine,
			{
				heading: match,
				headingLine: decomposed.lines[match.line - 1] || "",
				matchCount: resolved.matches.length,
				startOffset,
				endOffset,
				bodyStartLine,
				bodyStartOffset,
				body: bodyStartLine > endLine
					? ""
					: buildMarkdownRangeResult(
						decomposed.text,
						decomposed.lines,
						decomposed.hadTrailingNewline,
						headings,
						bodyStartLine,
						endLine
					).content,
			}
		);
		base.nextHeading = nextHeading;
		return base;
	}

	function readMarkdownRange(markdown, options = {}) {
		let decomposed = decomposeText(markdown);
		let headings = extractMarkdownHeadings(decomposed.text);
		let start = findMarkdownSection(decomposed.text, {
			heading: options.heading,
			headingPath: options.headingPath || options.heading_path,
			level: options.level,
			occurrence: options.occurrence,
		});
		if (!start) {
			return null;
		}
		let includeHeading = options.includeHeading !== false;
		let rangeStartLine = includeHeading ? start.startLine : Math.min(start.endLine + 1, start.startLine + 1);
		let endHeading = null;
		let rangeEndLine = start.endLine;
		if (options.toHeading || options.to_heading || options.toHeadingPath || options.to_heading_path) {
			let resolvedEnd = resolveMarkdownHeading(headings, {
				heading: options.toHeading || options.to_heading,
				headingPath: options.toHeadingPath || options.to_heading_path,
				level: options.toLevel || options.to_level,
				occurrence: options.toOccurrence || options.to_occurrence,
			}, {
				afterLine: start.heading.line,
			});
			endHeading = resolvedEnd.match;
			if (!endHeading) {
				throw new Error("The requested end heading was not found after the start heading.");
			}
			if (options.includeEndHeading) {
				let explicitEndSection = findMarkdownSection(decomposed.text, {
					headingPath: endHeading.path,
				});
				rangeEndLine = explicitEndSection ? explicitEndSection.endLine : endHeading.line;
			}
			else {
				rangeEndLine = endHeading.line - 1;
			}
		}
		let result = buildMarkdownRangeResult(
			decomposed.text,
			decomposed.lines,
			decomposed.hadTrailingNewline,
			headings,
			rangeStartLine,
			rangeEndLine,
			{
				heading: start.heading,
				headingLine: start.headingLine,
				matchCount: start.matchCount,
				endHeading,
				body: start.body,
			}
		);
		result.section = start;
		return result;
	}

	function parsePatchHeader(lines, index) {
		let line = lines[index];
		if (line.startsWith("*** Add File:")) {
			let path = line.slice("*** Add File:".length).trim();
			return path ? { type: "add", path, nextIndex: index + 1 } : null;
		}
		if (line.startsWith("*** Delete File:")) {
			let path = line.slice("*** Delete File:".length).trim();
			return path ? { type: "delete", path, nextIndex: index + 1 } : null;
		}
		if (line.startsWith("*** Update File:")) {
			let path = line.slice("*** Update File:".length).trim();
			let nextIndex = index + 1;
			let movePath = undefined;
			if (nextIndex < lines.length && lines[nextIndex].startsWith("*** Move to:")) {
				movePath = lines[nextIndex].slice("*** Move to:".length).trim();
				nextIndex += 1;
			}
			return path ? { type: "update", path, movePath, nextIndex } : null;
		}
		return null;
	}

	function parseUpdateFileChunks(lines, startIndex) {
		let chunks = [];
		let index = startIndex;
		while (index < lines.length && !lines[index].startsWith("***")) {
			if (!lines[index].startsWith("@@")) {
				index += 1;
				continue;
			}
			let changeContext = lines[index].slice(2).trim() || undefined;
			index += 1;
			let oldLines = [];
			let newLines = [];
			let isEndOfFile = false;
			while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("***")) {
				let line = lines[index];
				if (line == "*** End of File") {
					isEndOfFile = true;
					index += 1;
					break;
				}
				if (line.startsWith(" ")) {
					let content = line.slice(1);
					oldLines.push(content);
					newLines.push(content);
				}
				else if (line.startsWith("-")) {
					oldLines.push(line.slice(1));
				}
				else if (line.startsWith("+")) {
					newLines.push(line.slice(1));
				}
				index += 1;
			}
			chunks.push({
				oldLines,
				newLines,
				changeContext,
				isEndOfFile,
			});
		}
		return {
			chunks,
			nextIndex: index,
		};
	}

	function parseAddFileContents(lines, startIndex) {
		let added = [];
		let index = startIndex;
		while (index < lines.length && !lines[index].startsWith("***")) {
			if (!lines[index].startsWith("+")) {
				throw new Error("Add-file patches may only contain '+' lines.");
			}
			added.push(lines[index].slice(1));
			index += 1;
		}
		return {
			content: added.join("\n"),
			nextIndex: index,
		};
	}

	function stripPatchHeredoc(value) {
		let match = String(value || "").match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
		return match ? match[2] : String(value || "");
	}

	function parseStructuredPatch(patchText) {
		let cleaned = stripPatchHeredoc(String(patchText || "").trim());
		let lines = cleaned.split("\n");
		let beginIndex = lines.findIndex((line) => line.trim() == "*** Begin Patch");
		let endIndex = lines.findIndex((line) => line.trim() == "*** End Patch");
		if (beginIndex == -1 || endIndex == -1 || beginIndex >= endIndex) {
			throw new Error("Invalid patch format: missing Begin/End markers.");
		}
		let hunks = [];
		let index = beginIndex + 1;
		while (index < endIndex) {
			let header = parsePatchHeader(lines, index);
			if (!header) {
				index += 1;
				continue;
			}
			if (header.type == "add") {
				let parsed = parseAddFileContents(lines, header.nextIndex);
				hunks.push({
					type: "add",
					path: header.path,
					content: parsed.content,
				});
				index = parsed.nextIndex;
				continue;
			}
			if (header.type == "delete") {
				hunks.push({
					type: "delete",
					path: header.path,
				});
				index = header.nextIndex;
				continue;
			}
			let parsed = parseUpdateFileChunks(lines, header.nextIndex);
			hunks.push({
				type: "update",
				path: header.path,
				movePath: header.movePath,
				chunks: parsed.chunks,
			});
			index = parsed.nextIndex;
		}
		if (!hunks.length) {
			throw new Error("Patch did not contain any file hunks.");
		}
		return {
			hunks,
		};
	}

	function normalizeUnicodeForPatch(value) {
		return String(value || "")
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
			.replace(/\u2026/g, "...")
			.replace(/\u00A0/g, " ");
	}

	function tryMatchSequence(lines, pattern, startIndex, comparator, isEndOfFile) {
		if (isEndOfFile) {
			let fromEnd = lines.length - pattern.length;
			if (fromEnd >= startIndex) {
				let matched = true;
				for (let index = 0; index < pattern.length; index++) {
					if (!comparator(lines[fromEnd + index], pattern[index])) {
						matched = false;
						break;
					}
				}
				if (matched) {
					return fromEnd;
				}
			}
		}
		for (let lineIndex = startIndex; lineIndex <= lines.length - pattern.length; lineIndex++) {
			let matched = true;
			for (let patternIndex = 0; patternIndex < pattern.length; patternIndex++) {
				if (!comparator(lines[lineIndex + patternIndex], pattern[patternIndex])) {
					matched = false;
					break;
				}
			}
			if (matched) {
				return lineIndex;
			}
		}
		return -1;
	}

	function seekSequence(lines, pattern, startIndex, isEndOfFile = false) {
		if (!pattern.length) {
			return -1;
		}
		let exact = tryMatchSequence(lines, pattern, startIndex, (left, right) => left === right, isEndOfFile);
		if (exact != -1) {
			return exact;
		}
		let rstrip = tryMatchSequence(lines, pattern, startIndex, (left, right) => left.trimEnd() === right.trimEnd(), isEndOfFile);
		if (rstrip != -1) {
			return rstrip;
		}
		let trim = tryMatchSequence(lines, pattern, startIndex, (left, right) => left.trim() === right.trim(), isEndOfFile);
		if (trim != -1) {
			return trim;
		}
		return tryMatchSequence(
			lines,
			pattern,
			startIndex,
			(left, right) => normalizeUnicodeForPatch(left.trim()) === normalizeUnicodeForPatch(right.trim()),
			isEndOfFile
		);
	}

	function computePatchReplacements(lines, chunks, fileLabel = "file") {
		let replacements = [];
		let lineIndex = 0;
		for (let chunk of chunks) {
			if (chunk.changeContext) {
				let contextIndex = seekSequence(lines, [chunk.changeContext], lineIndex);
				if (contextIndex == -1) {
					throw new Error(`Failed to find patch context '${chunk.changeContext}' in ${fileLabel}.`);
				}
				lineIndex = contextIndex + 1;
			}
			if (!chunk.oldLines.length) {
				let insertionIndex = chunk.isEndOfFile ? lines.length : lineIndex;
				replacements.push([insertionIndex, 0, chunk.newLines]);
				continue;
			}
			let oldLines = chunk.oldLines.slice();
			let newLines = chunk.newLines.slice();
			let found = seekSequence(lines, oldLines, lineIndex, !!chunk.isEndOfFile);
			if (found == -1 && oldLines.length && oldLines[oldLines.length - 1] === "") {
				oldLines = oldLines.slice(0, -1);
				if (newLines.length && newLines[newLines.length - 1] === "") {
					newLines = newLines.slice(0, -1);
				}
				found = seekSequence(lines, oldLines, lineIndex, !!chunk.isEndOfFile);
			}
			if (found == -1) {
				throw new Error(`Failed to find expected patch lines in ${fileLabel}.`);
			}
			replacements.push([found, oldLines.length, newLines]);
			lineIndex = found + oldLines.length;
		}
		replacements.sort((left, right) => left[0] - right[0]);
		return replacements;
	}

	function applyReplacements(lines, replacements) {
		let out = lines.slice();
		for (let index = replacements.length - 1; index >= 0; index--) {
			let [startIndex, removeCount, insertLines] = replacements[index];
			out.splice(startIndex, removeCount, ...insertLines);
		}
		return out;
	}

	function deriveUpdatedTextFromChunks(originalText, fileLabel, chunks = []) {
		let decomposed = decomposeText(originalText);
		let replacements = computePatchReplacements(decomposed.lines, chunks, fileLabel);
		let lines = applyReplacements(decomposed.lines, replacements);
		let needsTrailingNewline = decomposed.hadTrailingNewline || !!lines.length;
		return {
			content: recomposeText(lines, needsTrailingNewline),
			replacements,
		};
	}

	return {
		normalizeNewlines,
		detectLineEnding,
		restoreLineEndings,
		decomposeText,
		recomposeText,
		sliceTextByLines,
		extractMarkdownHeadings,
		normalizeHeadingPath,
		normalizeHeadingLabel,
		resolveMarkdownHeading,
		findMarkdownSection,
		readMarkdownRange,
		parseStructuredPatch,
		deriveUpdatedTextFromChunks,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerTextFileTools;
}
