import { cleanDisplayText } from "./text-utils.js";

function optionalString(value) {
  return String(value || "").trim();
}

export function hasMarkdownTable(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      return true;
    }
  }
  return false;
}

function renderInlineWithCitations(text, citationMap, onShowCitation, options = {}) {
  const fragment = document.createDocumentFragment();
  const source = String(text || "");
  const showRawTokens = !!options.showRawCitationTokens;
  let lastIndex = 0;
  const matches = Array.from(source.matchAll(/@\[([^\]\n]+)\](\{[^}]*\})?/g));
  if (!matches.length) {
    fragment.appendChild(document.createTextNode(source));
    return fragment;
  }
  for (const match of matches) {
    const token = String(match?.[0] || "");
    const index = Number(match?.index || 0);
    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex, index)));
    }
    const citation = citationMap.get(token) || null;
    const span = document.createElement("span");
    span.className = "mw-explore-citation";
    span.textContent = showRawTokens
      ? token
      : citation?.labels?.map((entry) => entry.citation_text || entry.item_key).filter(Boolean).join("; ") || token;
    span.setAttribute("data-citation-token", token);
    span.tabIndex = 0;
    if (citation && typeof onShowCitation === "function") {
      const show = () => onShowCitation(span, citation);
      span.addEventListener("mouseenter", show);
      span.addEventListener("focus", show);
    }
    fragment.appendChild(span);
    lastIndex = index + token.length;
  }
  if (lastIndex < source.length) {
    fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
  return fragment;
}

function parseMarkdownTable(lines, start) {
  const splitRow = (row) =>
    String(row || "")
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  if (start + 1 >= lines.length) {
    return null;
  }
  if (!/^\s*\|?\s*:?-{3,}/.test(lines[start + 1])) {
    return null;
  }
  const header = splitRow(lines[start]);
  const rows = [];
  let index = start + 2;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.includes("|") || !line.trim()) {
      break;
    }
    rows.push(splitRow(line));
    index += 1;
  }
  return {
    consumed: index - start,
    header,
    rows,
  };
}

export function renderExploreMarkdown(text, message = {}, handlers = {}) {
  const root = document.createElement("div");
  root.className = "mw-explore-markdown";
  const citationMap = new Map();
  for (const citation of Array.isArray(message?.citations) ? message.citations : []) {
    citationMap.set(String(citation?.token || ""), citation);
  }
  const inlineCitationOptions = {
    showRawCitationTokens: !!handlers.showRawCitationTokens,
  };
  const lines = String(text || "").split(/\r?\n/);
  let paragraph = [];

  const flushParagraph = () => {
    const joined = paragraph.join(" ").trim();
    paragraph = [];
    if (!joined) {
      return;
    }
    const p = document.createElement("p");
    p.appendChild(renderInlineWithCitations(joined, citationMap, handlers.onShowCitation, inlineCitationOptions));
    root.appendChild(p);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(6, String(headingMatch[1] || "").length);
      const heading = document.createElement(`h${level}`);
      heading.appendChild(renderInlineWithCitations(String(headingMatch[2] || "").trim(), citationMap, handlers.onShowCitation, inlineCitationOptions));
      root.appendChild(heading);
      continue;
    }
    if (line.includes("|")) {
      const table = parseMarkdownTable(lines, index);
      if (table) {
        flushParagraph();
        const wrapper = document.createElement("div");
        wrapper.className = "mw-explore-table-wrap";
        const element = document.createElement("table");
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const cellText of table.header) {
          const th = document.createElement("th");
          th.appendChild(renderInlineWithCitations(cellText, citationMap, handlers.onShowCitation, inlineCitationOptions));
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        element.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (const row of table.rows) {
          const tr = document.createElement("tr");
          for (const cellText of row) {
            const td = document.createElement("td");
            td.appendChild(renderInlineWithCitations(cellText, citationMap, handlers.onShowCitation, inlineCitationOptions));
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        element.appendChild(tbody);
        wrapper.appendChild(element);
        root.appendChild(wrapper);
        index += table.consumed - 1;
        continue;
      }
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();

  if (!root.childNodes.length) {
    root.textContent = cleanDisplayText(optionalString(text));
  }
  return root;
}
