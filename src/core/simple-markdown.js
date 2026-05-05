var SystematicReviewerSimpleMarkdown = (() => {
	const PAGE_MARKER_RE = /^\s*<[-]{1,2}page(\d+)[-]{1,2}>\s*$/i;

	function normalizeNewlines(input) {
		return String(input || "").replace(/\r\n?/g, "\n");
	}

	function escapeHTML(input) {
		return String(input || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function splitPages(markdown) {
		let source = normalizeNewlines(markdown);
		let lines = source.split("\n");
		let pages = [];
		let currentPage = 1;
		let currentLines = [];
		let sawMarker = false;

		let pushPage = () => {
			if (!sawMarker && !currentLines.length && pages.length) {
				return;
			}
			pages.push({
				pageNumber: currentPage,
				content: currentLines.join("\n").trim(),
			});
			currentLines = [];
		};

		for (let line of lines) {
			let match = line.match(PAGE_MARKER_RE);
			if (!match) {
				currentLines.push(line);
				continue;
			}
			if (sawMarker || currentLines.some((value) => value.trim())) {
				pushPage();
			}
			sawMarker = true;
			currentPage = Math.max(1, Number(match[1]) || pages.length + 1 || 1);
			currentLines = [];
		}

		if (sawMarker || currentLines.some((value) => value.trim()) || !pages.length) {
			pushPage();
		}

		if (!pages.length) {
			return [{
				pageNumber: 1,
				content: "",
			}];
		}
		return pages;
	}

	function resolveAssetURL(rawPath, options = {}) {
		let source = String(rawPath || "").trim();
		if (!source) {
			return "";
		}
		if (typeof options.resolveAssetURL == "function") {
			return options.resolveAssetURL(source);
		}
		return source;
	}

	function renderInline(text, options = {}) {
		let placeholders = [];
		let source = String(text || "");

		let stash = (html) => {
			let token = `\u0000SRMD${placeholders.length}\u0000`;
			placeholders.push({ token, html });
			return token;
		};

		source = source.replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${escapeHTML(code)}</code>`));
		source = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) =>
			stash(`<img alt="${escapeHTML(alt)}" src="${escapeHTML(resolveAssetURL(src, options))}" data-sr-asset-src="${escapeHTML(src)}" />`)
		);
		source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) =>
			stash(`<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`)
		);
		source = escapeHTML(source);
		source = source.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		source = source.replace(/\*([^*]+)\*/g, "<em>$1</em>");
		for (let placeholder of placeholders) {
			source = source.replaceAll(placeholder.token, placeholder.html);
		}
		return source;
	}

	function isTableSeparator(line) {
		let trimmed = String(line || "").trim();
		if (!trimmed.includes("|")) {
			return false;
		}
		let cells = trimmed.replace(/^\||\|$/g, "").split("|");
		return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
	}

	function parseTableRow(line) {
		return String(line || "")
			.trim()
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((cell) => cell.trim());
	}

	function parseTableAlignments(line) {
		return parseTableRow(line).map((cell) => {
			if (/^:\s*-+\s*:$/.test(cell)) {
				return "center";
			}
			if (/^-+\s*:$/.test(cell)) {
				return "right";
			}
			return "left";
		});
	}

	function startsSpecialBlock(line, nextLine = "") {
		let trimmed = String(line || "").trim();
		return (
			!trimmed
			|| /^```/.test(trimmed)
			|| /^#{1,6}\s+/.test(trimmed)
			|| /^[-*+]\s+/.test(trimmed)
			|| /^\d+\.\s+/.test(trimmed)
			|| (trimmed.includes("|") && isTableSeparator(nextLine))
		);
	}

	function renderTable(lines, startIndex, options = {}) {
		let header = parseTableRow(lines[startIndex]);
		let alignments = parseTableAlignments(lines[startIndex + 1]);
		let rows = [];
		let index = startIndex + 2;
		while (index < lines.length) {
			let line = lines[index];
			if (!String(line || "").trim() || !String(line || "").includes("|")) {
				break;
			}
			rows.push(parseTableRow(line));
			index += 1;
		}
		let columnCount = Math.max(header.length, alignments.length, ...rows.map((row) => row.length), 1);
		while (header.length < columnCount) {
			header.push("");
		}
		while (alignments.length < columnCount) {
			alignments.push("left");
		}
		for (let row of rows) {
			while (row.length < columnCount) {
				row.push("");
			}
		}
		return {
			nextIndex: index,
			html: `<div class="sr-simple-md-table-scroll"><table class="sr-simple-md-table"><thead><tr>${
				header.map((cell, columnIndex) => `<th data-sr-align="${alignments[columnIndex]}">${renderInline(cell, options)}</th>`).join("")
			}</tr></thead><tbody>${
				rows.map((row) => `<tr>${row.map((cell, columnIndex) => `<td data-sr-align="${alignments[columnIndex]}">${renderInline(cell, options)}</td>`).join("")}</tr>`).join("")
			}</tbody></table></div>`,
		};
	}

	function renderList(lines, startIndex, ordered, options = {}) {
		let index = startIndex;
		let items = [];
		let pattern = ordered ? /^\d+\.\s+(.*)$/ : /^[-*+]\s+(.*)$/;
		while (index < lines.length) {
			let trimmed = String(lines[index] || "").trim();
			let match = trimmed.match(pattern);
			if (!match) {
				break;
			}
			items.push(`<li>${renderInline(match[1], options)}</li>`);
			index += 1;
		}
		let tag = ordered ? "ol" : "ul";
		return {
			nextIndex: index,
			html: `<${tag} class="sr-simple-md-list">${items.join("")}</${tag}>`,
		};
	}

	function renderParagraph(lines, startIndex, options = {}) {
		let parts = [];
		let index = startIndex;
		while (index < lines.length) {
			let line = String(lines[index] || "");
			let nextLine = index + 1 < lines.length ? lines[index + 1] : "";
			if (startsSpecialBlock(line, nextLine)) {
				break;
			}
			parts.push(line.trim());
			index += 1;
		}
		return {
			nextIndex: index,
			html: `<p>${renderInline(parts.join(" "), options)}</p>`,
		};
	}

	function renderPageHTML(content, options = {}) {
		let lines = normalizeNewlines(content).split("\n");
		let html = [];
		let index = 0;
		while (index < lines.length) {
			let line = String(lines[index] || "");
			let trimmed = line.trim();
			let nextLine = index + 1 < lines.length ? lines[index + 1] : "";

			if (!trimmed) {
				index += 1;
				continue;
			}

			if (/^```/.test(trimmed)) {
				let codeLines = [];
				let fenceIndex = index + 1;
				while (fenceIndex < lines.length && !/^```/.test(String(lines[fenceIndex] || "").trim())) {
					codeLines.push(lines[fenceIndex]);
					fenceIndex += 1;
				}
				html.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
				index = Math.min(lines.length, fenceIndex + 1);
				continue;
			}

			let heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
			if (heading) {
				let level = Math.min(6, heading[1].length);
				html.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
				index += 1;
				continue;
			}

			if (trimmed.includes("|") && isTableSeparator(nextLine)) {
				let table = renderTable(lines, index, options);
				html.push(table.html);
				index = table.nextIndex;
				continue;
			}

			if (/^[-*+]\s+/.test(trimmed)) {
				let list = renderList(lines, index, false, options);
				html.push(list.html);
				index = list.nextIndex;
				continue;
			}

			if (/^\d+\.\s+/.test(trimmed)) {
				let list = renderList(lines, index, true, options);
				html.push(list.html);
				index = list.nextIndex;
				continue;
			}

			let paragraph = renderParagraph(lines, index, options);
			if (paragraph.nextIndex == index) {
				index += 1;
				continue;
			}
			html.push(paragraph.html);
			index = paragraph.nextIndex;
		}

		return html.join("\n");
	}

	function renderDocumentHTML(markdown, options = {}) {
		let pages = splitPages(markdown);
		return `<div class="sr-simple-md-stack">${
			pages.map((page) => `<section class="sr-simple-md-page" data-sr-page-index="${page.pageNumber}"><header class="sr-simple-md-page-header">Page ${page.pageNumber}</header><div class="sr-simple-md-page-body">${renderPageHTML(page.content, options)}</div></section>`).join("")
		}</div>`;
	}

	return {
		PAGE_MARKER_RE,
		escapeHTML,
		normalizeNewlines,
		splitPages,
		renderInline,
		renderPageHTML,
		renderDocumentHTML,
	};
})();

if (typeof module !== "undefined") {
	module.exports = SystematicReviewerSimpleMarkdown;
}
