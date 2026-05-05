function stripInvisibleTextControls(input = "") {
  return [...String(input || "")]
    .filter((ch) => {
      if (ch === "\n" || ch === "\t") {
        return true;
      }
      const code = ch.codePointAt(0) || 0;
      if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
        return false;
      }
      return !["\uFEFF", "\u200B", "\u200C", "\u200D", "\u2060"].includes(ch);
    })
    .join("");
}

export function cleanDisplayText(input = "", { multiline = false, trim = true } = {}) {
  let text = String(input ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = stripInvisibleTextControls(text).replaceAll("\u00A0", " ");
  if (multiline) {
    return trim ? text.trim() : text;
  }
  text = text.replace(/\s+/g, " ");
  return trim ? text.trim() : text;
}

export function compactStatusText(input = "", { maxChars = 13, maxStemChars = 10 } = {}) {
  const text = cleanDisplayText(input);
  const max = Math.max(6, Number(maxChars || 13) || 13);
  const maxStem = Math.max(3, Math.min(max - 3, Number(maxStemChars || 10) || 10));
  if (text.length <= max) {
    return text;
  }
  const words = text.split(/\s+/).filter(Boolean);
  let stem = "";
  for (const word of words) {
    const candidate = stem ? `${stem} ${word}` : word;
    if (candidate.length > maxStem) {
      break;
    }
    stem = candidate;
  }
  if (!stem) {
    stem = text.slice(0, maxStem).trimEnd();
  }
  return `${stem.replace(/[.,;:!?-]+$/g, "")}...`;
}
