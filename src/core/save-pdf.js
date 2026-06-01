var SystematicReviewerSavePDF = (() => {
	const PRINT_LOAD_TIMEOUT_MS = 60000;
	const A4_WIDTH_INCHES = 210 / 25.4;
	const A4_HEIGHT_INCHES = 297 / 25.4;
	const A4_WIDTH_POINTS = A4_WIDTH_INCHES * 72;
	const A4_HEIGHT_POINTS = A4_HEIGHT_INCHES * 72;

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

	function isWindowsPlatform() {
		try {
			return String(Services.appinfo?.OS || "").toUpperCase() == "WINNT";
		}
		catch (_error) {
			return false;
		}
	}

	function ensureHiddenBrowserCompat(win) {
		try {
			if (win?.gBrowser && typeof win.gBrowser.getTabForBrowser != "function") {
				win.gBrowser.getTabForBrowser = () => null;
			}
		}
		catch (_error) {}
	}

	function createOffscreenPrintBrowser(win) {
		if (!win?.document?.createXULElement) {
			throw new Error("A Zotero browser window is required for PDF export.");
		}
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
		browser.setAttribute("src", "about:blank");
		win.document.documentElement.appendChild(browser);
		return browser;
	}

	function cleanupOffscreenPrintBrowser(browser) {
		try {
			browser?.remove?.();
		}
		catch (_error) {}
	}

	async function createTempPrintHTMLFile(html = "") {
		let file = Services.dirsvc.get("TmpD", Ci.nsIFile);
		file.append(`systematic-reviewer-print-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.html`);
		await Zotero.File.putContentsAsync(file.path, String(html || ""));
		return file;
	}

	function cleanupTempPrintHTMLFile(file) {
		try {
			file?.remove?.(false);
		}
		catch (_error) {}
	}

	function resolveViewerOwnerWindow(win) {
		if (win?.openDialog && !win.closed) {
			return win;
		}
		try {
			let zoteroMain = Zotero.getMainWindow?.() || null;
			if (zoteroMain?.openDialog && !zoteroMain.closed) {
				return zoteroMain;
			}
		}
		catch (_error) {}
		try {
			let candidate = Services.wm.getMostRecentWindow("navigator:browser");
			if (candidate?.openDialog && !candidate.closed) {
				return candidate;
			}
		}
		catch (_error) {}
		return null;
	}

	function openBasicViewerWindow(win, uri = "") {
		let ownerWindow = resolveViewerOwnerWindow(win);
		if (!ownerWindow?.openDialog) {
			throw new Error("A Zotero chrome window is required for PDF export.");
		}
		let args = {
			wrappedJSObject: {
				uri: String(uri || "about:blank"),
				options: {
					allowJavaScript: true,
				},
			},
		};
		let viewerWindow = ownerWindow.openDialog(
			"chrome://zotero/content/standalone/basicViewer.xhtml",
			"systematic-reviewer-pdf-export",
			"chrome,dialog=no,resizable,width=1200,height=1600,left=-20000,top=0",
			args
		);
		return viewerWindow;
	}

	async function waitForViewerWindowReady(viewerWindow, timeoutMs = PRINT_LOAD_TIMEOUT_MS) {
		let start = Date.now();
		while ((Date.now() - start) < timeoutMs) {
			if (viewerWindow?.closed) {
				throw new Error("The PDF export window closed before the document finished loading.");
			}
			let browser = null;
			try {
				browser = viewerWindow?.browser || viewerWindow?.document?.querySelector?.("browser") || null;
			}
			catch (_error) {}
			if (browser?.contentDocument) {
				return browser;
			}
			await waitForDelay(viewerWindow, 50);
		}
		throw new Error("Timed out waiting for the PDF export window to initialize.");
	}

	function cleanupViewerWindow(viewerWindow) {
		try {
			viewerWindow?.close?.();
		}
		catch (_error) {}
	}

	function normalizeBrowserURL(url = "") {
		return String(url || "")
			.trim()
			.replace(/#.*$/, "")
			.replace(/\?.*$/, "")
			.replace(/\/+$/, "");
	}

	function browserURLMatches(currentURL = "", expectedURL = "") {
		let current = normalizeBrowserURL(currentURL);
		let expected = normalizeBrowserURL(expectedURL);
		if (!expected) {
			return true;
		}
		if (!current || current == "about:blank") {
			return false;
		}
		if (current == expected) {
			return true;
		}
		return current.startsWith(expected) || expected.startsWith(current);
	}

	function waitForBrowserLoad(browser, expectedURL = "", timeoutMs = PRINT_LOAD_TIMEOUT_MS, targetLabel = "browser") {
		let ownerWindow = browser?.ownerGlobal || browser?.ownerDocument?.defaultView || null;
		return new Promise((resolve, reject) => {
			let settled = false;
			let start = Date.now();
			let finish = (error = null) => {
				if (settled) {
					return;
				}
				settled = true;
				if (error) {
					reject(error);
					return;
				}
				resolve();
			};
			let poll = () => {
				if (settled) {
					return;
				}
				try {
					let currentURL = browser?.contentWindow?.location?.href || browser?.currentURI?.spec || "";
					if (browserURLMatches(currentURL, expectedURL)) {
						finish(null);
						return;
					}
				}
				catch (_error) {}
				if ((Date.now() - start) >= timeoutMs) {
					let currentURL = "";
					try {
						currentURL = browser?.contentWindow?.location?.href || browser?.currentURI?.spec || "";
					}
					catch (_error) {}
					finish(new Error(`Timed out waiting for ${targetLabel} to load. url=${currentURL || "(unknown)"}`));
					return;
				}
				if (ownerWindow?.setTimeout) {
					ownerWindow.setTimeout(poll, 50);
					return;
				}
				globalThis.setTimeout?.(poll, 50);
			};
			poll();
		});
	}

	function waitForDelay(win, delayMs = 0) {
		return new Promise((resolve) => {
			let target = win || globalThis;
			if (typeof target?.setTimeout == "function") {
				target.setTimeout(resolve, Math.max(0, Number(delayMs || 0) || 0));
				return;
			}
			resolve();
		});
	}

	function parsePrintHTMLDocument(html = "", win = null) {
		let ParserCtor = win?.DOMParser || globalThis.DOMParser || null;
		if (typeof ParserCtor != "function") {
			try {
				ParserCtor = Services.wm.getMostRecentWindow("navigator:browser")?.DOMParser || null;
			}
			catch (_error) {}
		}
		if (typeof ParserCtor != "function") {
			return null;
		}
		try {
			return new ParserCtor().parseFromString(String(html || ""), "text/html");
		}
		catch (_error) {
			return null;
		}
	}

	function pdfOutputFileSnapshot(path = "") {
		let resolvedPath = String(path || "").trim();
		if (!resolvedPath) {
			return null;
		}
		try {
			let file = nsIFileFromPath(resolvedPath);
			if (!file.exists()) {
				return null;
			}
			return {
				exists: true,
				size: Number(file.fileSize || 0) || 0,
				modified: Number(file.lastModifiedTime || 0) || 0,
			};
		}
		catch (_error) {
			return null;
		}
	}

	async function waitForPDFOutputFileReady(path = "", win = null, timeoutMs = 15000) {
		let started = Date.now();
		let stableCount = 0;
		let lastSnapshot = null;
		while ((Date.now() - started) < timeoutMs) {
			let snapshot = pdfOutputFileSnapshot(path);
			if (snapshot?.exists && snapshot.size > 0) {
				if (lastSnapshot && snapshot.size == lastSnapshot.size && snapshot.modified == lastSnapshot.modified) {
					stableCount += 1;
					if (stableCount >= 3) {
						return snapshot;
					}
				}
				else {
					stableCount = 0;
				}
				lastSnapshot = snapshot;
			}
			await waitForDelay(win, 120);
		}
		let finalSnapshot = pdfOutputFileSnapshot(path);
		if (finalSnapshot?.exists && finalSnapshot.size > 0) {
			return finalSnapshot;
		}
		throw new Error("Timed out waiting for the exported PDF file to finish writing.");
	}

	async function waitForImageLoads(doc, timeoutMs = PRINT_LOAD_TIMEOUT_MS) {
		let images = Array.from(doc?.images || []).filter(Boolean);
		if (!images.length) {
			return;
		}
		await Promise.all(images.map((image) => new Promise((resolve) => {
			try {
				if (image.complete) {
					resolve();
					return;
				}
				let ownerWindow = image.ownerDocument?.defaultView || doc?.defaultView || globalThis;
				let settled = false;
				let timer = ownerWindow?.setTimeout
					? ownerWindow.setTimeout(() => {
						if (settled) {
							return;
						}
						settled = true;
						resolve();
					}, timeoutMs)
					: null;
				let finish = () => {
					if (settled) {
						return;
					}
					settled = true;
					if (timer != null && ownerWindow?.clearTimeout) {
						ownerWindow.clearTimeout(timer);
					}
					resolve();
				};
				image.addEventListener("load", finish, { once: true });
				image.addEventListener("error", finish, { once: true });
			}
			catch (_error) {
				resolve();
			}
		})));
	}

	async function waitForPrintDocumentReady(browser, timeoutMs = PRINT_LOAD_TIMEOUT_MS) {
		let win = browser?.contentWindow || browser?.ownerGlobal || null;
		if (!win) {
			throw new Error("The PDF print document did not initialize correctly.");
		}
		let start = Date.now();
		let doc = null;
		let docTimeoutMs = Math.min(timeoutMs, 4000);
		while ((Date.now() - start) < docTimeoutMs) {
			doc = browser?.contentDocument || browser?.contentWindow?.document || null;
			if (doc?.body) {
				break;
			}
			await waitForDelay(win, 50);
		}
		if (!doc?.body) {
			await waitForDelay(win, 500);
			return;
		}
		while (String(doc?.readyState || "").toLowerCase() == "loading" && (Date.now() - start) < docTimeoutMs) {
			await waitForDelay(win, 25);
			doc = browser?.contentDocument || browser?.contentWindow?.document || doc || null;
		}
		try {
			if (doc?.fonts?.ready) {
				await Promise.race([
					doc.fonts.ready.catch(() => {}),
					waitForDelay(win, Math.min(timeoutMs, 2000)),
				]);
			}
		}
		catch (_error) {}
		await waitForImageLoads(doc, timeoutMs);
		await waitForDelay(win, 300);
	}

	function binaryStringToBytes(binary = "") {
		let source = String(binary || "");
		let out = new Uint8Array(source.length);
		for (let i = 0; i < source.length; i += 1) {
			out[i] = source.charCodeAt(i) & 0xff;
		}
		return out;
	}

	function asciiBytes(text = "") {
		return binaryStringToBytes(String(text || ""));
	}

	function bytesToBinaryString(bytes = null) {
		let source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
		if (!source.length) {
			return "";
		}
		let parts = [];
		let chunkSize = 0x8000;
		for (let index = 0; index < source.length; index += chunkSize) {
			let slice = source.subarray(index, Math.min(source.length, index + chunkSize));
			parts.push(String.fromCharCode.apply(null, slice));
		}
		return parts.join("");
	}

	async function readBinaryFileBytes(path = "") {
		let binary = await Zotero.File.getBinaryContentsAsync(String(path || ""));
		return binaryStringToBytes(binary);
	}

	async function writeBinaryFileBytes(path = "", bytes = null) {
		let file = nsIFileFromPath(path);
		let stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
		let binary = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
		try {
			stream.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
			binary.setOutputStream(stream);
			binary.writeByteArray(Array.from(bytes || []), Number(bytes?.length || 0));
		}
		finally {
			try {
				binary.close();
			}
			catch (_error) {}
			try {
				stream.close();
			}
			catch (_error) {}
		}
	}

	function collectPrintAnchorPageMap(doc) {
		let out = new Map();
		for (let sheet of Array.from(doc?.querySelectorAll?.(".sr-page-sheet[data-sr-page-index]") || [])) {
			let pageIndex = Number(sheet?.getAttribute?.("data-sr-page-index") || 0) || 0;
			if (!pageIndex) {
				continue;
			}
			for (let node of Array.from(sheet.querySelectorAll?.("[data-sr-anchor], [id]") || [])) {
				let anchor = String(node?.getAttribute?.("data-sr-anchor") || node?.id || "").trim();
				if (anchor && !out.has(anchor)) {
					out.set(anchor, pageIndex);
				}
			}
		}
		return out;
	}

	function setTemporaryBoolPref(prefName = "", nextValue = true) {
		let name = String(prefName || "").trim();
		if (!name) {
			return () => {};
		}
		let hadUserValue = false;
		let previousValue = false;
		try {
			hadUserValue = Services.prefs.prefHasUserValue(name);
		}
		catch (_error) {}
		try {
			previousValue = Services.prefs.getBoolPref(name);
		}
		catch (_error) {
			previousValue = false;
		}
		try {
			Services.prefs.setBoolPref(name, !!nextValue);
		}
		catch (_error) {}
		return () => {
			try {
				if (hadUserValue) {
					Services.prefs.setBoolPref(name, previousValue);
				}
				else {
					Services.prefs.clearUserPref(name);
				}
			}
			catch (_error) {}
		};
	}

	function decodeAnchorText(anchor = "") {
		let value = String(anchor || "").trim();
		if (!value) {
			return "";
		}
		try {
			return decodeURIComponent(value);
		}
		catch (_error) {
			return value;
		}
	}

	function extractPrintLinkTargetAnchor(link = null) {
		let storedAnchor = "";
		try {
			storedAnchor = String(
				link?.getAttribute?.("data-sr-toc-target-anchor")
				|| link?.closest?.("[data-sr-toc-target-anchor]")?.getAttribute?.("data-sr-toc-target-anchor")
				|| ""
			).trim();
		}
		catch (_error) {
			storedAnchor = "";
		}
		if (storedAnchor) {
			return decodeAnchorText(storedAnchor);
		}
		let rawHref = "";
		try {
			rawHref = String(link?.getAttribute?.("href") || link?.href || "").trim();
		}
		catch (_error) {
			rawHref = "";
		}
		if (!rawHref) {
			return "";
		}
		let hashIndex = rawHref.lastIndexOf("#");
		if (hashIndex < 0) {
			return "";
		}
		let anchor = rawHref.slice(hashIndex + 1).trim();
		if (!anchor) {
			return "";
		}
		return decodeAnchorText(anchor);
	}

	function preparePrintHTMLForPDF(html = "", win = null) {
		if (!isWindowsPlatform()) {
			return String(html || "");
		}
		try {
			let doc = parsePrintHTMLDocument(html, win);
			let tocFragmentLinks = Array.from(doc.querySelectorAll?.(".sr-toc-link[href]") || [])
				.filter((link) => String(link?.getAttribute?.("href") || "").trim().startsWith("#"));
			let bases = Array.from(doc.querySelectorAll?.("base[href]") || []);
			if (!tocFragmentLinks.length || !bases.length) {
				return String(html || "");
			}
			for (let base of bases) {
				base.remove();
			}
			return `<!DOCTYPE html>\n${doc.documentElement?.outerHTML || String(html || "")}`;
		}
		catch (_error) {
			return String(html || "");
		}
	}

	function relayoutPrintTOCIfAvailable(doc = null) {
		try {
			if (
				doc
				&& typeof SystematicReviewerNativeMarkdown != "undefined"
				&& typeof SystematicReviewerNativeMarkdown?.layoutRenderedTOCRows == "function"
			) {
				SystematicReviewerNativeMarkdown.layoutRenderedTOCRows(doc);
			}
		}
		catch (_error) {}
	}

	function refreshPrintTOCPageNumbers(doc = null) {
		relayoutPrintTOCIfAvailable(doc);
		let anchorPageMap = collectPrintAnchorPageMap(doc);
		let tocRoots = Array.from(doc?.querySelectorAll?.(".sr-toc-block, .sr-block-toc") || []);
		let pageNumberNodes = Array.from(doc?.querySelectorAll?.(".sr-toc-page-number[data-sr-toc-target-anchor]") || []);
		let filledPageNumberCount = 0;
		for (let node of pageNumberNodes) {
			let anchor = String(node?.getAttribute?.("data-sr-toc-target-anchor") || "").trim();
			let pageNumber = Number(anchorPageMap.get(anchor) || 0) || 0;
			node.textContent = pageNumber ? String(pageNumber) : "";
			if (pageNumber) {
				filledPageNumberCount += 1;
			}
		}
		return {
			anchorPageMap,
			tocCount: tocRoots.length,
			pageNumberNodeCount: pageNumberNodes.length,
			filledPageNumberCount,
		};
	}

	function collectRenderedTOCPageNumberMap(doc = null) {
		let out = new Map();
		for (let node of Array.from(doc?.querySelectorAll?.(".sr-toc-page-number[data-sr-toc-target-anchor]") || [])) {
			let anchor = String(node?.getAttribute?.("data-sr-toc-target-anchor") || "").trim();
			let pageNumber = Number(String(node?.textContent || "").trim()) || 0;
			if (anchor && pageNumber > 0 && !out.has(anchor)) {
				out.set(anchor, pageNumber);
			}
		}
		return out;
	}

	function decodePDFLiteralString(value = "") {
		let source = String(value || "");
		let out = "";
		for (let i = 0; i < source.length; i += 1) {
			let ch = source[i];
			if (ch != "\\") {
				out += ch;
				continue;
			}
			let next = source[i + 1] || "";
			if (!next) {
				break;
			}
			if (/[0-7]/.test(next)) {
				let octal = next;
				let consumed = 1;
				while (consumed < 3 && /[0-7]/.test(source[i + 1 + consumed] || "")) {
					octal += source[i + 1 + consumed];
					consumed += 1;
				}
				out += String.fromCharCode(parseInt(octal, 8));
				i += consumed;
				continue;
			}
			i += 1;
			switch (next) {
				case "n":
					out += "\n";
					break;
				case "r":
					out += "\r";
					break;
				case "t":
					out += "\t";
					break;
				case "b":
					out += "\b";
					break;
				case "f":
					out += "\f";
					break;
				case "(":
				case ")":
				case "\\":
					out += next;
					break;
				case "\n":
					break;
				case "\r":
					if (source[i + 1] == "\n") {
						i += 1;
					}
					break;
				default:
					out += next;
					break;
			}
		}
		return out;
	}

	function decodePDFHexString(value = "") {
		let hex = String(value || "").replace(/\s+/g, "");
		if (!hex) {
			return "";
		}
		if (hex.length % 2 == 1) {
			hex += "0";
		}
		let out = "";
		for (let index = 0; index < hex.length; index += 2) {
			let code = parseInt(hex.slice(index, index + 2), 16);
			if (Number.isFinite(code)) {
				out += String.fromCharCode(code & 0xff);
			}
		}
		return out;
	}

	function decodePDFStringToken(value = "") {
		let token = String(value || "").trim();
		if (!token) {
			return "";
		}
		if (token.startsWith("(") && token.endsWith(")")) {
			return decodePDFLiteralString(token.slice(1, -1));
		}
		if (/^<[0-9A-Fa-f\s]+>$/.test(token)) {
			return decodePDFHexString(token.slice(1, -1));
		}
		return "";
	}

	function extractPDFURIText(actionBody = "", objectsByNumber = null) {
		let body = String(actionBody || "");
		let indirectReference = body.match(/\/URI\s+(\d+)\s+(\d+)\s+R\b/);
		if (indirectReference) {
			let uriObject = objectsByNumber?.get?.(Number(indirectReference[1])) || null;
			return decodePDFStringToken(uriObject?.body || "");
		}
		let directLiteral = body.match(/\/URI\s*(\((?:\\.|[^\\])*?\))/s);
		if (directLiteral) {
			return decodePDFStringToken(directLiteral[1]);
		}
		let directHex = body.match(/\/URI\s*(<[0-9A-Fa-f\s]+>)/s);
		if (directHex) {
			return decodePDFStringToken(directHex[1]);
		}
		return "";
	}

	function decodePDFURIAnchor(uriText = "") {
		let uri = String(uriText || "");
		let hashIndex = uri.lastIndexOf("#");
		if (hashIndex < 0) {
			return "";
		}
		let anchor = uri.slice(hashIndex + 1).trim();
		if (!anchor) {
			return "";
		}
		return decodeAnchorText(anchor);
	}

	function collectPrintTOCTargetAnchors(doc) {
		let targets = new Set();
		for (let link of Array.from(doc?.querySelectorAll?.(".sr-toc-link[data-sr-toc-link='true'], .sr-toc-link") || [])) {
			let anchor = extractPrintLinkTargetAnchor(link);
			if (anchor) {
				targets.add(anchor);
			}
		}
		return targets;
	}

	function pdfPageDimensionsForLayout(layout = "portrait") {
		return String(layout || "").toLowerCase() == "landscape"
			? { width: A4_HEIGHT_POINTS, height: A4_WIDTH_POINTS }
			: { width: A4_WIDTH_POINTS, height: A4_HEIGHT_POINTS };
	}

	function formatPDFNumber(value = 0) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed)) {
			parsed = 0;
		}
		let rounded = Math.round(parsed * 1000) / 1000;
		if (Number.isInteger(rounded)) {
			return String(rounded);
		}
		return String(rounded).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
	}

	function rectToPDFAnnotationRect(rect = null, sheetRect = null, layout = "portrait") {
		if (!rect || !sheetRect || !sheetRect.width || !sheetRect.height) {
			return null;
		}
		let dims = pdfPageDimensionsForLayout(layout);
		let left = ((rect.left - sheetRect.left) / sheetRect.width) * dims.width;
		let right = ((rect.right - sheetRect.left) / sheetRect.width) * dims.width;
		let topFromTop = ((rect.top - sheetRect.top) / sheetRect.height) * dims.height;
		let bottomFromTop = ((rect.bottom - sheetRect.top) / sheetRect.height) * dims.height;
		let lowerLeftY = dims.height - bottomFromTop;
		let upperRightY = dims.height - topFromTop;
		if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(lowerLeftY) || !Number.isFinite(upperRightY)) {
			return null;
		}
		return [
			Math.max(0, Math.min(dims.width, left)),
			Math.max(0, Math.min(dims.height, lowerLeftY)),
			Math.max(0, Math.min(dims.width, right)),
			Math.max(0, Math.min(dims.height, upperRightY)),
		];
	}

	function collectPrintTOCLinkAnnotations(doc) {
		let annotations = [];
		for (let sheet of Array.from(doc?.querySelectorAll?.(".sr-page-sheet[data-sr-page-index]") || [])) {
			let pageIndex = Number(sheet?.getAttribute?.("data-sr-page-index") || 0) || 0;
			if (!pageIndex) {
				continue;
			}
			let layout = String(sheet?.getAttribute?.("data-sr-layout") || "portrait").trim();
			let sheetRect = sheet.getBoundingClientRect?.();
				if (!sheetRect?.width || !sheetRect?.height) {
					continue;
				}
				for (let link of Array.from(sheet.querySelectorAll?.(".sr-toc-link[data-sr-toc-link='true'], .sr-toc-link") || [])) {
					let targetAnchor = extractPrintLinkTargetAnchor(link);
					if (!targetAnchor) {
						continue;
					}
				let rect = link.getBoundingClientRect?.();
				let pdfRect = rectToPDFAnnotationRect(rect, sheetRect, layout);
				if (!pdfRect) {
					continue;
				}
				let width = pdfRect[2] - pdfRect[0];
				let height = pdfRect[3] - pdfRect[1];
				if (width <= 1 || height <= 1) {
					continue;
				}
				annotations.push({
					sourcePageIndex: pageIndex,
					targetAnchor,
					rect: pdfRect,
				});
			}
		}
		return annotations;
	}

	function collectPrintPageLayouts(doc = null) {
		return Array.from(doc?.querySelectorAll?.(".sr-page-sheet[data-sr-page-index]") || [])
			.map((sheet) => ({
				pageIndex: Number(sheet?.getAttribute?.("data-sr-page-index") || 0) || 0,
				layout: String(sheet?.getAttribute?.("data-sr-layout") || "portrait").trim().toLowerCase() == "landscape" ? "landscape" : "portrait",
			}))
			.filter((entry) => entry.pageIndex > 0)
			.sort((a, b) => a.pageIndex - b.pageIndex)
			.map((entry) => entry.layout);
	}

	function extractPDFObjects(pdfText = "") {
		let objects = [];
		let regex = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
		let match = null;
		while ((match = regex.exec(String(pdfText || "")))) {
			objects.push({
				number: Number(match[1]),
				generation: Number(match[2]),
				body: String(match[3] || ""),
				start: match.index,
			});
		}
		return objects;
	}

	function latestPDFObjects(objects = []) {
		let latestByNumber = new Map();
		for (let object of Array.from(objects || [])) {
			if (!object?.number) {
				continue;
			}
			latestByNumber.set(object.number, object);
		}
		return Array.from(latestByNumber.values()).sort((a, b) => (a?.start || 0) - (b?.start || 0));
	}

	function extractPDFPageObjectNumbers(objects = []) {
		return objects
			.filter((object) => /\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body))
			.map((object) => object.number);
	}

	function pdfUsesCompressedObjectStreams(pdfText = "") {
		let source = String(pdfText || "");
		return /\/ObjStm\b/.test(source) || /\/Type\s*\/XRef\b/.test(source);
	}

	function extractPDFPageObjectNumbersFromPageTree(objects = [], trailerInfo = null) {
		let objectsByNumber = new Map(Array.from(objects || []).map((object) => [object.number, object]));
		let rootRef = String(trailerInfo?.root || "");
		let rootObjectNumber = Number((rootRef.match(/^\s*(\d+)\s+\d+\s+R\s*$/) || [])[1] || 0) || 0;
		let catalogBody = String(objectsByNumber.get(rootObjectNumber)?.body || "");
		let pagesRootNumber = Number((catalogBody.match(/\/Pages\s+(\d+)\s+\d+\s+R\b/) || [])[1] || 0) || 0;
		if (!pagesRootNumber) {
			return extractPDFPageObjectNumbers(objects);
		}
		let seen = new Set();
		let ordered = [];
		let walk = (objectNumber = 0) => {
			if (!objectNumber || seen.has(objectNumber)) {
				return;
			}
			seen.add(objectNumber);
			let body = String(objectsByNumber.get(objectNumber)?.body || "");
			if (!body) {
				return;
			}
			if (/\/Type\s*\/Page\b/.test(body) && !/\/Type\s*\/Pages\b/.test(body)) {
				ordered.push(objectNumber);
				return;
			}
			if (!/\/Type\s*\/Pages\b/.test(body)) {
				return;
			}
			let kidsBody = (body.match(/\/Kids\s*\[(.*?)\]/s) || [])[1] || "";
			let kidRefs = Array.from(kidsBody.matchAll(/(\d+)\s+\d+\s+R/g)).map((match) => Number(match[1]) || 0).filter(Boolean);
			for (let kidRef of kidRefs) {
				walk(kidRef);
			}
		};
		walk(pagesRootNumber);
		return ordered.length ? ordered : extractPDFPageObjectNumbers(objects);
	}

	function extractPDFNumberArray(body = "", name = "") {
		let key = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (!key) {
			return null;
		}
		let match = String(body || "").match(new RegExp(`/${key}\\s*\\[([^\\]]+)\\]`, "s"));
		if (!match) {
			return null;
		}
		let numbers = Array.from(String(match[1] || "").matchAll(/-?\d+(?:\.\d+)?/g))
			.map((entry) => Number(entry[0]))
			.filter((value) => Number.isFinite(value));
		return numbers.length >= 4 ? numbers.slice(0, 4) : null;
	}

	function extractPDFIntegerValue(body = "", name = "") {
		let key = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (!key) {
			return null;
		}
		let match = String(body || "").match(new RegExp(`/${key}\\s+(-?\\d+)`));
		return match ? Number(match[1]) || 0 : null;
	}

	function extractPDFPageBoxes(pdfText = "") {
		let objects = latestPDFObjects(extractPDFObjects(pdfText));
		let objectsByNumber = new Map(objects.map((object) => [object.number, object]));
		let trailer = extractPDFTrailerInfo(pdfText);
		let rootRef = String(trailer?.root || "");
		let rootObjectNumber = Number((rootRef.match(/^\s*(\d+)\s+\d+\s+R\s*$/) || [])[1] || 0) || 0;
		let catalogBody = String(objectsByNumber.get(rootObjectNumber)?.body || "");
		let pagesRootNumber = Number((catalogBody.match(/\/Pages\s+(\d+)\s+\d+\s+R\b/) || [])[1] || 0) || 0;
		let boxes = [];
		let seen = new Set();
		let walk = (objectNumber = 0, inherited = {}) => {
			if (!objectNumber || seen.has(objectNumber)) {
				return;
			}
			seen.add(objectNumber);
			let object = objectsByNumber.get(objectNumber) || null;
			let body = String(object?.body || "");
			if (!body) {
				return;
			}
			let next = Object.assign({}, inherited || {});
			let mediaBox = extractPDFNumberArray(body, "MediaBox");
			let cropBox = extractPDFNumberArray(body, "CropBox");
			let rotate = extractPDFIntegerValue(body, "Rotate");
			if (mediaBox) {
				next.mediaBox = mediaBox;
			}
			if (cropBox) {
				next.cropBox = cropBox;
			}
			if (rotate !== null) {
				next.rotate = rotate;
			}
			if (/\/Type\s*\/Page\b/.test(body) && !/\/Type\s*\/Pages\b/.test(body)) {
				boxes.push({
					objectNumber,
					mediaBox: next.mediaBox || [],
					cropBox: next.cropBox || [],
					rotate: Number(next.rotate || 0) || 0,
				});
				return;
			}
			if (!/\/Type\s*\/Pages\b/.test(body)) {
				return;
			}
			let kidsBody = (body.match(/\/Kids\s*\[(.*?)\]/s) || [])[1] || "";
			for (let kidRef of Array.from(kidsBody.matchAll(/(\d+)\s+\d+\s+R/g)).map((match) => Number(match[1]) || 0).filter(Boolean)) {
				walk(kidRef, next);
			}
		};
		walk(pagesRootNumber, {});
		if (boxes.length) {
			return boxes;
		}
		return extractPDFPageObjectNumbers(objects).map((objectNumber) => {
			let body = String(objectsByNumber.get(objectNumber)?.body || "");
			return {
				objectNumber,
				mediaBox: extractPDFNumberArray(body, "MediaBox") || [],
				cropBox: extractPDFNumberArray(body, "CropBox") || [],
				rotate: extractPDFIntegerValue(body, "Rotate") || 0,
			};
		});
	}

	function pdfPageBoxLayout(box = null) {
		let mediaBox = Array.isArray(box?.mediaBox) ? box.mediaBox : [];
		if (mediaBox.length < 4) {
			return "";
		}
		let width = Math.abs((Number(mediaBox[2]) || 0) - (Number(mediaBox[0]) || 0));
		let height = Math.abs((Number(mediaBox[3]) || 0) - (Number(mediaBox[1]) || 0));
		let rotate = Math.abs(Number(box?.rotate || 0) || 0) % 180;
		if (rotate == 90) {
			[width, height] = [height, width];
		}
		if (!(width > 0) || !(height > 0)) {
			return "";
		}
		return width > height ? "landscape" : "portrait";
	}

	async function validatePDFPageLayouts(outputPath = "", expectedLayouts = []) {
		let expected = Array.isArray(expectedLayouts) ? expectedLayouts : [];
		if (!expected.length) {
			return;
		}
		let pdfBytes = await readBinaryFileBytes(outputPath);
		let pdfText = bytesToBinaryString(pdfBytes);
		let boxes = extractPDFPageBoxes(pdfText);
		if (boxes.length != expected.length) {
			if (!boxes.length && pdfUsesCompressedObjectStreams(pdfText)) {
				try {
					Zotero.debug("Systematic Reviewer: skipped PDF page-layout validation because Gecko wrote compressed object streams.");
				}
				catch (_error) {}
				return;
			}
			throw new Error(`PDF page count mismatch after printing: Gecko produced ${boxes.length} page(s), expected ${expected.length} rendered page sheet(s).`);
		}
		for (let index = 0; index < expected.length; index += 1) {
			let wanted = expected[index] == "landscape" ? "landscape" : "portrait";
			let actual = pdfPageBoxLayout(boxes[index]);
			if (actual && actual != wanted) {
				let mediaBox = boxes[index]?.mediaBox || [];
				let width = Math.abs((Number(mediaBox[2]) || 0) - (Number(mediaBox[0]) || 0));
				let height = Math.abs((Number(mediaBox[3]) || 0) - (Number(mediaBox[1]) || 0));
				throw new Error(`PDF page ${index + 1} printed as ${actual} (${Math.round(width)}x${Math.round(height)}pt), expected ${wanted}.`);
			}
		}
	}

	function extractPDFTrailerInfo(pdfText = "") {
		let trailerRegex = /trailer\s*<<([\s\S]*?)>>\s*startxref\s*(\d+)\s*%%EOF/g;
		let match = null;
		let last = null;
		while ((match = trailerRegex.exec(String(pdfText || "")))) {
			last = match;
		}
		let dict = "";
		let startXRef = 0;
		if (last) {
			dict = String(last[1] || "");
			startXRef = Number(last[2] || 0) || 0;
		}
		else {
			let startMatches = Array.from(String(pdfText || "").matchAll(/startxref\s*(\d+)\s*%%EOF/g));
			startXRef = Number(startMatches[startMatches.length - 1]?.[1] || 0) || 0;
			let objects = latestPDFObjects(extractPDFObjects(pdfText));
			let xrefObject = objects.find((object) => Number(object?.start || 0) == startXRef)
				|| objects.filter((object) => /\/Type\s*\/XRef\b/.test(object?.body || "")).pop()
				|| null;
			let xrefDictionary = String(xrefObject?.body || "").split(/\bstream\b/)[0] || "";
			dict = (xrefDictionary.match(/<<([\s\S]*?)>>/) || [])[1] || xrefDictionary;
		}
		if (!dict) {
			throw new Error("Unable to locate the PDF trailer.");
		}
		let size = Number((dict.match(/\/Size\s+(\d+)/) || [])[1] || 0) || 0;
		let root = (dict.match(/\/Root\s+(\d+\s+\d+\s+R)/) || [])[1] || "";
		let info = (dict.match(/\/Info\s+(\d+\s+\d+\s+R)/) || [])[1] || "";
		let encrypt = (dict.match(/\/Encrypt\s+(\d+\s+\d+\s+R)/) || [])[1] || "";
		let idBody = (dict.match(/\/ID\s*\[([\s\S]*?)\]/) || [])[1] || "";
		if (!root) {
			throw new Error("Unable to locate the PDF catalog reference.");
		}
		return { size, root, info, encrypt, idBody, startXRef };
	}

	function buildIncrementalXref(entries = []) {
		let sorted = Array.from(entries || [])
			.filter((entry) => entry && entry.objectNumber >= 0 && entry.offset >= 0)
			.sort((a, b) => a.objectNumber - b.objectNumber);
		if (!sorted.length) {
			return "";
		}
		let chunks = ["xref\n"];
		for (let index = 0; index < sorted.length;) {
			let startObject = sorted[index].objectNumber;
			let lines = [];
			let expected = startObject;
			while (index < sorted.length && sorted[index].objectNumber == expected) {
				lines.push(`${String(sorted[index].offset).padStart(10, "0")} ${String(sorted[index].generation || 0).padStart(5, "0")} n \n`);
				index += 1;
				expected += 1;
			}
			chunks.push(`${startObject} ${lines.length}\n${lines.join("")}`);
		}
		return chunks.join("");
	}

	function inspectPDFInternalActionTargets(pdfText = "") {
		let objects = latestPDFObjects(extractPDFObjects(pdfText));
		let objectsByNumber = new Map(objects.map((object) => [object.number, object]));
		let actions = [];
		for (let object of objects) {
			let body = String(object?.body || "");
			if (!/\/S\s*\/(?:URI|GoTo)\b/.test(body)) {
				continue;
			}
			if (/\/Subtype\s*\/Link\b/.test(body) && !/\/Type\s*\/Action\b/.test(body)) {
				continue;
			}
			if (/\/S\s*\/URI\b/.test(body)) {
				let uriText = extractPDFURIText(body, objectsByNumber);
				let anchor = decodePDFURIAnchor(uriText);
				actions.push({
					objectNumber: object.number,
					generation: object.generation,
					type: "URI",
					uriText,
					anchor,
				});
				continue;
			}
			if (/\/S\s*\/GoTo\b/.test(body)) {
				actions.push({
					objectNumber: object.number,
					generation: object.generation,
					type: "GoTo",
					body,
				});
			}
		}
		return actions;
	}

	function inspectPDFLinkAnnotations(pdfText = "") {
		let objects = latestPDFObjects(extractPDFObjects(pdfText));
		let objectsByNumber = new Map(objects.map((object) => [object.number, object]));
		return objects
			.filter((object) => /\/Subtype\s*\/Link\b/.test(object.body))
			.map((object) => {
				let actionMatch = object.body.match(/\/A\s+(\d+)\s+(\d+)\s+R\b/);
				let directActionMatch = object.body.match(/\/A\s*<<([\s\S]*?)>>/);
				let directURIText = directActionMatch ? extractPDFURIText(directActionMatch[1], objectsByNumber) : "";
				let destMatch = object.body.match(/\/Dest\s*\[\s*(\d+)\s+\d+\s+R\s+\/Fit\s*\]/);
				return {
					objectNumber: object.number,
					generation: object.generation,
					body: object.body,
					actionObjectNumber: actionMatch ? Number(actionMatch[1]) || 0 : 0,
					directURIAnchor: decodePDFURIAnchor(directURIText),
					destPageObjectNumber: destMatch ? Number(destMatch[1]) || 0 : 0,
				};
			});
	}

	function extractPDFReferenceTokens(text = "") {
		return Array.from(String(text || "").matchAll(/(\d+\s+\d+\s+R)/g)).map((match) => String(match[1] || "").trim());
	}

	function extractPDFPageAnnotationRefs(pageBody = "", objectsByNumber = null) {
		let body = String(pageBody || "");
		let directArray = (body.match(/\/Annots\s*\[(.*?)\]/s) || [])[1] || "";
		if (directArray) {
			return extractPDFReferenceTokens(directArray);
		}
		let indirectRef = body.match(/\/Annots\s+(\d+)\s+(\d+)\s+R\b/);
		if (indirectRef) {
			let annotsObject = objectsByNumber?.get?.(Number(indirectRef[1])) || null;
			return extractPDFReferenceTokens(String(annotsObject?.body || ""));
		}
		return [];
	}

	function rewritePDFPageAnnotationRefs(pageBody = "", annotationRefs = []) {
		let refs = Array.from(annotationRefs || []).filter(Boolean);
		let body = String(pageBody || "").trim();
		body = body
			.replace(/\s*\/Annots\s*\[(.*?)\]/s, "")
			.replace(/\s*\/Annots\s+\d+\s+\d+\s+R\b/g, "");
		if (!refs.length) {
			return body;
		}
		let annotsText = `/Annots [ ${refs.join(" ")} ]`;
		if (body.endsWith(">>")) {
			return `${body.slice(0, -2).trim()} ${annotsText} >>`;
		}
		return `${body} ${annotsText}`;
	}

	function rewritePDFLinkAnnotationBody(annotationBody = "", targetPageObjectNumber = 0) {
		let target = Number(targetPageObjectNumber || 0) || 0;
		if (!target) {
			return String(annotationBody || "");
		}
		let body = String(annotationBody || "").trim();
		body = body
			.replace(/\s*\/A\s+\d+\s+\d+\s+R\b/g, "")
			.replace(/\s*\/A\s*<<[\s\S]*?>>/g, "")
			.replace(/\s*\/Dest\s*\[\s*\d+\s+\d+\s+R\s+\/Fit\s*\]/g, "");
		if (body.endsWith(">>")) {
			return `${body.slice(0, -2).trim()} /Dest [ ${target} 0 R /Fit ] >>`;
		}
		return `${body} /Dest [ ${target} 0 R /Fit ]`;
	}

	async function rewritePDFInternalAnchorLinks(outputPath = "", anchorPageMap = null, tocLinkAnnotations = null) {
		let anchors = anchorPageMap instanceof Map ? anchorPageMap : new Map();
		if (!anchors.size) {
			return { updatedCount: 0, internalURIActionCount: 0, gotoActionCount: 0 };
		}
		let tocAnnotations = Array.isArray(tocLinkAnnotations) ? tocLinkAnnotations : [];
		let originalBytes = await readBinaryFileBytes(outputPath);
		let pdfText = bytesToBinaryString(originalBytes);
		let objects = latestPDFObjects(extractPDFObjects(pdfText));
		let objectsByNumber = new Map(objects.map((object) => [object.number, object]));
		let usesCompressedObjectStreams = pdfUsesCompressedObjectStreams(pdfText);
		let trailer = null;
		try {
			trailer = extractPDFTrailerInfo(pdfText);
		}
		catch (error) {
			if (usesCompressedObjectStreams) {
				return {
					updatedCount: 0,
					internalURIActionCount: 0,
					gotoActionCount: 0,
					compressedObjectStreams: true,
					pageObjectsReadable: false,
				};
			}
			throw error;
		}
		let pageObjectNumbers = extractPDFPageObjectNumbersFromPageTree(objects, trailer);
		if (!pageObjectNumbers.length) {
			return {
				updatedCount: 0,
				internalURIActionCount: 0,
				gotoActionCount: inspectPDFInternalActionTargets(pdfText).filter((action) => action.type == "GoTo").length,
				compressedObjectStreams: usesCompressedObjectStreams,
				pageObjectsReadable: false,
			};
		}
		let updatesByObject = new Map();
		let internalURIActionCount = 0;
		let actionTargetsByObject = new Map();
		for (let action of inspectPDFInternalActionTargets(pdfText)) {
			if (action.type != "URI" || !action.anchor) {
				continue;
			}
			internalURIActionCount += 1;
			let targetPageIndex = Number(anchors.get(action.anchor) || 0) || 0;
			let targetPageObject = pageObjectNumbers[targetPageIndex - 1] || 0;
			if (!targetPageObject) {
				continue;
			}
			actionTargetsByObject.set(action.objectNumber, targetPageObject);
			updatesByObject.set(action.objectNumber, {
				objectNumber: action.objectNumber,
				generation: action.generation,
				body: `<< /Type /Action /S /GoTo /D [ ${targetPageObject} 0 R /Fit ] >>`,
			});
		}
		for (let annotation of inspectPDFLinkAnnotations(pdfText)) {
			let targetPageObject = Number(actionTargetsByObject.get(annotation.actionObjectNumber) || 0) || 0;
			if (!targetPageObject && annotation.directURIAnchor) {
				let targetPageIndex = Number(anchors.get(annotation.directURIAnchor) || 0) || 0;
				targetPageObject = pageObjectNumbers[targetPageIndex - 1] || 0;
				if (targetPageObject) {
					internalURIActionCount += 1;
				}
			}
			if (!targetPageObject) {
				continue;
			}
			updatesByObject.set(annotation.objectNumber, {
				objectNumber: annotation.objectNumber,
				generation: annotation.generation,
				body: rewritePDFLinkAnnotationBody(annotation.body, targetPageObject),
			});
		}
		let nextObjectNumber = Math.max(0, ...objects.map((object) => Number(object.number) || 0)) + 1;
		let pageAnnotationRefs = new Map();
		for (let tocAnnotation of tocAnnotations) {
			let sourcePageIndex = Number(tocAnnotation?.sourcePageIndex || 0) || 0;
			let targetPageIndex = Number(anchors.get(String(tocAnnotation?.targetAnchor || "").trim()) || 0) || 0;
			let sourcePageObject = pageObjectNumbers[sourcePageIndex - 1] || 0;
			let targetPageObject = pageObjectNumbers[targetPageIndex - 1] || 0;
			let rect = Array.isArray(tocAnnotation?.rect) ? tocAnnotation.rect : null;
			if (!sourcePageObject || !targetPageObject || !rect || rect.length != 4) {
				continue;
			}
			let annotationObjectNumber = nextObjectNumber++;
			let rectText = `[ ${rect.map((value) => formatPDFNumber(value)).join(" ")} ]`;
			let annotationRef = `${annotationObjectNumber} 0 R`;
			let list = pageAnnotationRefs.get(sourcePageObject) || [];
			list.push(annotationRef);
			pageAnnotationRefs.set(sourcePageObject, list);
			updatesByObject.set(annotationObjectNumber, {
				objectNumber: annotationObjectNumber,
				generation: 0,
				body: `<< /Type /Annot /Subtype /Link /Border [ 0 0 0 ] /Rect ${rectText} /Dest [ ${targetPageObject} 0 R /Fit ] >>`,
			});
		}
		for (let [pageObjectNumber, newRefs] of pageAnnotationRefs.entries()) {
			let pageObject = objectsByNumber.get(pageObjectNumber);
			if (!pageObject) {
				continue;
			}
			let existingRefs = extractPDFPageAnnotationRefs(pageObject.body, objectsByNumber);
			updatesByObject.set(pageObjectNumber, {
				objectNumber: pageObject.number,
				generation: pageObject.generation,
				body: rewritePDFPageAnnotationRefs(pageObject.body, [...existingRefs, ...newRefs]),
			});
		}
		let updates = Array.from(updatesByObject.values()).sort((a, b) => a.objectNumber - b.objectNumber);
		if (!updates.length) {
			return {
				updatedCount: 0,
				internalURIActionCount,
				gotoActionCount: inspectPDFInternalActionTargets(pdfText).filter((action) => action.type == "GoTo").length,
			};
		}
		let appendParts = ["\n"];
		let xrefEntries = [];
		let cursor = originalBytes.length + 1;
		for (let update of updates) {
			let objectText = `${update.objectNumber} ${update.generation} obj\n${String(update.body || "").trim()}\nendobj\n`;
			xrefEntries.push({
				objectNumber: update.objectNumber,
				generation: update.generation,
				offset: cursor,
			});
			appendParts.push(objectText);
			cursor += objectText.length;
		}
		let xrefText = buildIncrementalXref(xrefEntries);
		let xrefOffset = cursor;
		appendParts.push(xrefText);
		let trailerParts = [
			"trailer\n<<",
			`/Size ${Math.max(trailer.size || 0, Math.max(...updates.map((update) => update.objectNumber)) + 1)}`,
			`/Root ${trailer.root}`,
		];
		if (trailer.info) {
			trailerParts.push(`/Info ${trailer.info}`);
		}
		if (trailer.encrypt) {
			trailerParts.push(`/Encrypt ${trailer.encrypt}`);
		}
		if (trailer.idBody) {
			trailerParts.push(`/ID [${trailer.idBody}]`);
		}
		trailerParts.push(`/Prev ${trailer.startXRef}`);
		appendParts.push(`${trailerParts.join(" ")} >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
		let appendedBytes = asciiBytes(appendParts.join(""));
		let outputBytes = new Uint8Array(originalBytes.length + appendedBytes.length);
		outputBytes.set(originalBytes, 0);
		outputBytes.set(appendedBytes, originalBytes.length);
		await writeBinaryFileBytes(outputPath, outputBytes);
		let finalText = bytesToBinaryString(outputBytes);
		let finalActions = inspectPDFInternalActionTargets(finalText);
		return {
			updatedCount: updates.length,
			internalURIActionCount,
			gotoActionCount: finalActions.filter((action) => action.type == "GoTo").length,
		};
	}

	async function validatePDFInternalLinkRepair(outputPath = "", anchorPageMap = null, tocTargetAnchors = null, tocLinkAnnotations = null) {
		let anchors = anchorPageMap instanceof Map ? anchorPageMap : new Map();
		let tocTargets = tocTargetAnchors instanceof Set ? tocTargetAnchors : new Set();
		let expectedTOCLinks = Array.isArray(tocLinkAnnotations) ? tocLinkAnnotations.length : 0;
		let pdfBytes = await readBinaryFileBytes(outputPath);
		let pdfText = bytesToBinaryString(pdfBytes);
		let usesCompressedObjectStreams = pdfUsesCompressedObjectStreams(pdfText);
		let actions = inspectPDFInternalActionTargets(pdfText);
		let annotations = inspectPDFLinkAnnotations(pdfText);
		let knownInternalAnchors = new Set([
			...Array.from(anchors.keys()),
			...Array.from(tocTargets.values()),
		]);
		let leftoverInternalURIs = actions.filter((action) =>
			action.type == "URI"
			&& action.anchor
			&& knownInternalAnchors.has(action.anchor)
		);
		let leftoverInternalAnnotationURIs = annotations.filter((annotation) =>
			annotation.directURIAnchor
			&& knownInternalAnchors.has(annotation.directURIAnchor)
		);
		if (leftoverInternalURIs.length || leftoverInternalAnnotationURIs.length) {
			throw new Error(`PDF still contains ${leftoverInternalURIs.length + leftoverInternalAnnotationURIs.length} internal URI action(s) instead of same-document destinations.`);
		}
		if (tocTargets.size) {
			let directDestAnnotations = annotations.filter((annotation) => annotation.destPageObjectNumber > 0);
			let gotoActions = actions.filter((action) => action.type == "GoTo" && /\/D\s*\[\s*\d+\s+0\s+R\s+\/Fit\s*\]/.test(action.body || ""));
			if (usesCompressedObjectStreams && !actions.length && !annotations.length) {
				try {
					Zotero.debug("Systematic Reviewer: skipped PDF internal-link validation because Gecko wrote compressed object streams.");
				}
				catch (_error) {}
				return;
			}
			if (!directDestAnnotations.length && !gotoActions.length) {
				throw new Error("PDF TOC export did not produce any standards-compliant internal destinations.");
			}
			if (expectedTOCLinks > 0 && directDestAnnotations.length < expectedTOCLinks) {
				throw new Error(`PDF TOC export produced only ${directDestAnnotations.length} internal link annotation(s); expected at least ${expectedTOCLinks}.`);
			}
		}
	}

	async function loadPrintHTMLIntoBrowser(browser, html = "") {
		let tempFile = await createTempPrintHTMLFile(html);
		let fileURL = Services.io.newFileURI(tempFile).spec;
		try {
			if (typeof browser?.loadURI == "function") {
				try {
					browser.loadURI(fileURL, {
						triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
					});
				}
				catch (_error) {
					browser.setAttribute("src", fileURL);
				}
			}
			else {
				browser.setAttribute("src", fileURL);
			}
			await waitForBrowserLoad(browser, fileURL, 15000, "the PDF print document");
			await waitForPrintDocumentReady(browser, PRINT_LOAD_TIMEOUT_MS);
			return tempFile;
		}
		catch (error) {
			cleanupTempPrintHTMLFile(tempFile);
			throw error;
		}
	}

	function createPDFPrintSettings(outputPath, settings = {}, win = null) {
		let marginInches = Number(settings?.printMarginInches || 1);
		if (!Number.isFinite(marginInches) || marginInches < 0) {
			marginInches = 1;
		}
		let service = Cc["@mozilla.org/gfx/printsettings-service;1"].getService(
			Ci.nsIPrintSettingsService
		);
		let printSettings = null;
		try {
			if (typeof win?.PrintUtils?.getPrintSettings == "function") {
				printSettings = win.PrintUtils.getPrintSettings("", false);
			}
		}
		catch (_error) {}
		if (!printSettings) {
			printSettings = service.createNewPrintSettings();
		}
		printSettings.isInitializedFromPrinter = true;
		printSettings.isInitializedFromPrefs = true;
		printSettings.outputFormat = Ci.nsIPrintSettings.kOutputFormatPDF;
		printSettings.outputDestination = Ci.nsIPrintSettings.kOutputDestinationFile;
		printSettings.toFileName = String(outputPath || "");
		printSettings.printerName = "";
		printSettings.printSilent = true;
		printSettings.paperSizeUnit = Ci.nsIPrintSettings.kPaperSizeInches;
		printSettings.paperWidth = A4_WIDTH_INCHES;
		printSettings.paperHeight = A4_HEIGHT_INCHES;
		printSettings.usePageRuleSizeAsPaperSize = true;
		printSettings.marginTop = marginInches;
		printSettings.marginRight = marginInches;
		printSettings.marginBottom = marginInches;
		printSettings.marginLeft = marginInches;
		printSettings.unwriteableMarginTop = 0;
		printSettings.unwriteableMarginRight = 0;
		printSettings.unwriteableMarginBottom = 0;
		printSettings.unwriteableMarginLeft = 0;
		printSettings.printBGColors = true;
		printSettings.printBGImages = true;
		printSettings.scaling = 1;
		printSettings.shrinkToFit = false;
		printSettings.headerStrCenter = "";
		printSettings.headerStrLeft = "";
		printSettings.headerStrRight = "";
		printSettings.footerStrCenter = "";
		printSettings.footerStrLeft = "";
		printSettings.footerStrRight = "";
		return printSettings;
	}

	async function saveHTMLToPDF({ win = null, html = "", outputPath = "", settings = {} } = {}) {
		if (!win?.document) {
			throw new Error("A Zotero window is required for PDF export.");
		}
		let resolvedOutputPath = String(outputPath || "").trim();
		if (!resolvedOutputPath) {
			throw new Error("PDF export requires an output path.");
		}
		let viewerWindow = null;
		let browser = null;
		let tempFile = null;
		let restoreInternalDestinationsPref = () => {};
		let printHTML = preparePrintHTMLForPDF(html, win);
		let staticPrintDocument = parsePrintHTMLDocument(printHTML, win);
		let staticTOCRefresh = refreshPrintTOCPageNumbers(staticPrintDocument);
		let staticRenderedTOCPageMap = collectRenderedTOCPageNumberMap(staticPrintDocument);
		let staticTOCTargetAnchors = collectPrintTOCTargetAnchors(staticPrintDocument);
		try {
			try {
				let existingFile = nsIFileFromPath(resolvedOutputPath);
				if (existingFile.exists()) {
					existingFile.remove(false);
				}
			}
			catch (_error) {}

			tempFile = await createTempPrintHTMLFile(printHTML);
			let fileURL = Services.io.newFileURI(tempFile).spec;
			viewerWindow = openBasicViewerWindow(win, fileURL);
			try {
				browser = await waitForViewerWindowReady(viewerWindow, 15000);
				try {
					viewerWindow.moveTo?.(-20000, 0);
				}
				catch (_error) {}
				try {
					viewerWindow.blur?.();
				}
				catch (_error) {}
				await waitForBrowserLoad(browser, fileURL, PRINT_LOAD_TIMEOUT_MS, "the PDF print document");
				await waitForDelay(viewerWindow, 350);
				await waitForPrintDocumentReady(browser, PRINT_LOAD_TIMEOUT_MS);
			}
			catch (error) {
				throw new Error(`Preparing the PDF print document failed: ${error?.message || String(error)}`);
			}
			let browsingContext = browser?.browsingContext || browser?.contentWindow?.browsingContext || null;
			if (!browsingContext || typeof browsingContext.print != "function") {
				throw new Error("Native PDF printing is not available for the export browser.");
			}
			let printDocument = browser?.contentDocument || browser?.contentWindow?.document || null;
			let tocRefresh = refreshPrintTOCPageNumbers(printDocument);
			try {
				void (printDocument?.documentElement?.offsetHeight || 0);
			}
			catch (_error) {}
			await waitForDelay(viewerWindow || win, 80);
			tocRefresh = refreshPrintTOCPageNumbers(printDocument);
			let anchorPageMap = tocRefresh.anchorPageMap.size ? tocRefresh.anchorPageMap : staticTOCRefresh.anchorPageMap;
			let renderedTOCPageMap = collectRenderedTOCPageNumberMap(printDocument);
			if (!renderedTOCPageMap.size) {
				renderedTOCPageMap = staticRenderedTOCPageMap;
			}
			let pdfAnchorPageMap = renderedTOCPageMap.size ? renderedTOCPageMap : anchorPageMap;
			let tocTargetAnchors = collectPrintTOCTargetAnchors(printDocument);
			if (!tocTargetAnchors.size) {
				tocTargetAnchors = staticTOCTargetAnchors;
			}
			let tocLinkAnnotations = collectPrintTOCLinkAnnotations(printDocument);
			if ((tocRefresh.tocCount > 0 || staticTOCRefresh.tocCount > 0) && pdfAnchorPageMap.size <= 0) {
				throw new Error("The PDF print document rendered a TOC, but the exporter could not derive any TOC page-number targets.");
			}
				if (
					(tocRefresh.tocCount > 0 && tocRefresh.pageNumberNodeCount > 0 && tocRefresh.filledPageNumberCount <= 0)
					&& !(staticTOCRefresh.pageNumberNodeCount > 0 && staticTOCRefresh.filledPageNumberCount > 0)
				) {
					throw new Error("The PDF print document rendered a TOC, but its page numbers were blank before printing.");
				}
				let expectedPrintPageLayouts = collectPrintPageLayouts(printDocument);
				if (!expectedPrintPageLayouts.length) {
					expectedPrintPageLayouts = collectPrintPageLayouts(staticPrintDocument);
				}
				let printSettings = createPDFPrintSettings(resolvedOutputPath, settings || {}, viewerWindow || win);
				restoreInternalDestinationsPref = setTemporaryBoolPref("print.save_as_pdf.internal_destinations.enabled", true);
				try {
				await browsingContext.print(printSettings);
			}
			catch (error) {
				throw new Error(`Native PDF printing failed: ${error?.message || String(error)}`);
			}
			finally {
				restoreInternalDestinationsPref();
				restoreInternalDestinationsPref = () => {};
			}
				try {
					await waitForPDFOutputFileReady(resolvedOutputPath, viewerWindow || win);
					await validatePDFPageLayouts(resolvedOutputPath, expectedPrintPageLayouts);
					cleanupViewerWindow(viewerWindow);
					viewerWindow = null;
				browser = null;
				await waitForDelay(win, 400);
				await waitForPDFOutputFileReady(resolvedOutputPath, win, 5000);
				let rewriteResult = await rewritePDFInternalAnchorLinks(resolvedOutputPath, pdfAnchorPageMap, tocLinkAnnotations);
				if ((rewriteResult?.updatedCount || 0) > 0) {
					Zotero.debug(`Systematic Reviewer: rewrote ${rewriteResult.updatedCount} PDF internal TOC links.`);
				}
				await validatePDFInternalLinkRepair(resolvedOutputPath, pdfAnchorPageMap, tocTargetAnchors, tocLinkAnnotations);
			}
			catch (error) {
				throw new Error(`Native PDF link annotation repair failed: ${error?.message || String(error)}`);
			}
			return {
				ok: true,
				path: resolvedOutputPath,
			};
		}
		catch (error) {
			throw new Error(`PDF export failed: ${error?.message || String(error)}`);
		}
		finally {
			restoreInternalDestinationsPref();
			cleanupTempPrintHTMLFile(tempFile);
			cleanupViewerWindow(viewerWindow);
		}
	}

	return {
		saveHTMLToPDF,
		createPDFPrintSettings,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerSavePDF;
}
