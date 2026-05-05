var SystematicReviewerPrivilegedBrowserController = (() => {
	const DEFAULT_TIMEOUT_MS = 30000;
	const DEFAULT_COMMAND_TIMEOUT_MS = 15000;
	const MAX_WAIT_MS = 30000;
	const SCREENSHOT_TEMP_DIR_NAME = "systematic-reviewer-browser-screenshots";

	let viewerWindows = [];
	let activeViewerWindowID = null;
	let nextViewerWindowID = 0;
	let frameScriptURL = "";
	let requestCounter = 0;

	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function parseOptionalInt(value) {
		let parsed = parseInt(value, 10);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return null;
		}
		return parsed;
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

	function clamp(value, min, max, fallback = min) {
		let next = Number(value);
		if (!Number.isFinite(next)) {
			next = fallback;
		}
		return Math.max(min, Math.min(max, next));
	}

	function positiveNumber(value, fallback = 0) {
		let next = Number(value);
		if (!Number.isFinite(next) || next <= 0) {
			return fallback;
		}
		return next;
	}

	function sanitizeFilenamePart(value = "", fallback = "page") {
		let cleaned = optionalString(value);
		if (!cleaned) {
			cleaned = fallback;
		}
		cleaned = cleaned
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (!cleaned) {
			cleaned = fallback;
		}
		if (cleaned.length > 80) {
			cleaned = cleaned.slice(0, 80).trim();
		}
		return cleaned || fallback;
	}

	async function writeUTF8(path, text) {
		let bytes = new TextEncoder().encode(String(text || ""));
		await IOUtils.write(path, bytes);
	}

	function bytesToBase64(bytes) {
		let out = "";
		for (let i = 0; i < bytes.length; i += 1) {
			out += String.fromCharCode(bytes[i]);
		}
		return btoa(out);
	}

	function base64ToBytes(base64 = "") {
		let binary = atob(String(base64 || ""));
		let bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	}

	function tempScreenshotDir() {
		return PathUtils.join(Zotero.DataDirectory.dir, SCREENSHOT_TEMP_DIR_NAME);
	}

	function currentWindowGlobalBrowser(browser) {
		return browser?.browsingContext?.currentWindowGlobal || null;
	}

	function cleanupViewerWindows() {
		let next = [];
		for (let entry of viewerWindows || []) {
			if (!entry || !entry.win || entry.win.closed) {
				continue;
			}
			next.push(entry);
		}
		viewerWindows = next;
		let active = null;
		if (activeViewerWindowID) {
			active = viewerWindows.find((entry) => entry.id == activeViewerWindowID) || null;
		}
		if (!active && viewerWindows.length) {
			active = viewerWindows[viewerWindows.length - 1];
			activeViewerWindowID = active.id;
		}
		if (!active) {
			activeViewerWindowID = null;
		}
		return viewerWindows;
	}

	function getViewerEntry(windowID = null) {
		cleanupViewerWindows();
		if (windowID !== null && windowID !== undefined) {
			let parsed = parseOptionalInt(windowID);
			if (!parsed) {
				throw new Error(`Invalid window_id: ${windowID}`);
			}
			let entry = viewerWindows.find((candidate) => candidate.id == parsed) || null;
			if (!entry) {
				throw new Error(`Browser window not found: ${parsed}`);
			}
			return entry;
		}
		if (!activeViewerWindowID) {
			return null;
		}
		return viewerWindows.find((candidate) => candidate.id == activeViewerWindowID) || null;
	}

	function getViewerWindow(windowID = null) {
		return getViewerEntry(windowID)?.win || null;
	}

	function getBrowserFromWindow(win) {
		let browser = win?.document?.querySelector?.("browser") || null;
		if (!browser) {
			throw new Error("Browser window content is unavailable.");
		}
		return browser;
	}

	function getBrowserOrThrow(options = {}) {
		let win = getViewerWindow(options.windowID || options.window_id || null);
		if (!win) {
			throw new Error("No browser window is open.");
		}
		return getBrowserFromWindow(win);
	}

	function registerViewerWindow(win) {
		if (!win || win.closed) {
			throw new Error("Browser window unavailable.");
		}
		cleanupViewerWindows();
		let existing = viewerWindows.find((entry) => entry.win == win) || null;
		if (existing) {
			activeViewerWindowID = existing.id;
			return existing.id;
		}
		let id = ++nextViewerWindowID;
		viewerWindows.push({ id, win });
		activeViewerWindowID = id;
		try {
			win.addEventListener("unload", () => {
				viewerWindows = (viewerWindows || []).filter((entry) => entry.win != win);
				if (activeViewerWindowID == id) {
					activeViewerWindowID = null;
				}
				cleanupViewerWindows();
			}, { once: true });
		}
		catch (_error) {}
		return id;
	}

	function windowState(entry) {
		let state = {
			window_id: entry?.id || null,
			active: entry?.id == activeViewerWindowID,
			closed: !!(entry?.win && entry.win.closed),
			url: null,
			title: null,
			page_loaded: false,
		};
		if (!entry?.win || entry.win.closed) {
			return state;
		}
		try {
			let browser = getBrowserFromWindow(entry.win);
			state.url = browser.currentURI?.spec || null;
			state.title = browser.contentTitle || null;
			state.page_loaded = !!(browser.webProgress && !browser.webProgress.isLoadingDocument);
		}
		catch (_error) {}
		return state;
	}

	function listViewerWindows() {
		cleanupViewerWindows();
		let windows = viewerWindows.map((entry) => windowState(entry));
		return {
			active_window_id: activeViewerWindowID || null,
			window_count: windows.length,
			windows,
		};
	}

	function focusViewerWindow(windowID) {
		let entry = getViewerEntry(windowID);
		if (!entry) {
			throw new Error("No browser window is open.");
		}
		activeViewerWindowID = entry.id;
		try {
			entry.win.focus?.();
		}
		catch (_error) {}
		return windowState(entry);
	}

	function closeViewerWindow(windowID = null) {
		let entry = getViewerEntry(windowID);
		if (!entry) {
			return {
				closed: false,
				window_id: null,
			};
		}
		let state = windowState(entry);
		try {
			entry.win.close?.();
		}
		catch (_error) {}
		viewerWindows = (viewerWindows || []).filter((candidate) => candidate.id != entry.id);
		if (activeViewerWindowID == entry.id) {
			activeViewerWindowID = null;
		}
		cleanupViewerWindows();
		return {
			closed: true,
			window_id: state.window_id,
			url: state.url,
			title: state.title,
		};
	}

	function closeAllViewerWindows() {
		cleanupViewerWindows();
		let closed = viewerWindows.map((entry) => closeViewerWindow(entry.id)).filter((entry) => entry?.closed);
		return {
			closed_count: closed.length,
			closed,
		};
	}

	function validateURL(url = "") {
		let trimmed = optionalString(url);
		if (!/^(https?|file|about):/i.test(trimmed)) {
			throw new Error("Only http(s), file, and about URLs are allowed.");
		}
		return trimmed;
	}

	function openBasicViewer(url = "", options = {}) {
		let viewerOptions = {
			allowJavaScript: options.allowJavaScript !== false,
			cookieSandbox: options.cookieSandbox,
		};
		return Zotero.openInViewer(url, viewerOptions);
	}

	async function waitForViewerWindowReady(win, timeoutMs = DEFAULT_TIMEOUT_MS) {
		await new Promise((resolve, reject) => {
			if (!win || win.closed) {
				reject(new Error("Browser window closed."));
				return;
			}
			let finished = false;
			let cleanup = () => {
				if (finished) {
					return;
				}
				finished = true;
				try {
					win.removeEventListener("load", onLoad);
				}
				catch (_error) {}
				clearTimeout(timer);
			};
			let onLoad = () => {
				cleanup();
				resolve();
			};
			let timer = setTimeout(() => {
				cleanup();
				reject(new Error("Timed out waiting for browser window."));
			}, timeoutMs);
			if (win.document?.readyState == "complete") {
				cleanup();
				resolve();
				return;
			}
			win.addEventListener("load", onLoad);
		});
	}

	async function waitForPage(browser, timeoutMs = DEFAULT_TIMEOUT_MS, disallowURL = null) {
		let deadline = Date.now() + Math.max(0, Number(timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
		while (Date.now() < deadline) {
			try {
				let currentURL = browser.currentURI?.spec || null;
				let readyState = optionalString(browser.contentDocument?.readyState || "").toLowerCase();
				let loading = !!(browser.webProgress && browser.webProgress.isLoadingDocument);
				let hasUsableURL = !!currentURL
					&& currentURL != "about:blank"
					&& (!disallowURL || currentURL != disallowURL);
				let domReady = readyState == "interactive" || readyState == "complete";
				if (hasUsableURL && (!loading || domReady)) {
					return;
				}
			}
			catch (_error) {}
			await sleep(100);
		}
		throw new Error("Timed out waiting for page load.");
	}

	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function getFrameScriptSource() {
		return `
(() => {
	if (this.__systematicReviewerPrivilegedBrowserFrameLoaded) {
		return;
	}
	this.__systematicReviewerPrivilegedBrowserFrameLoaded = true;

	const COMMAND = "systematic-reviewer-privileged-browser:command";
	const RESPONSE = "systematic-reviewer-privileged-browser:response";
		const INTERACTIVE_SELECTOR =
			"a[href],button,input,select,textarea,summary,[role='button'],[onclick],[contenteditable='true'],[contenteditable='']";
	const OVERLAY_HINT_RE = /cookie|consent|gdpr|onetrust|didomi|sp_message|paywall|subscribe|newsletter|popup|modal|banner|advert|adblock/i;
	const CAPTCHA_HINT_RE = /captcha|recaptcha|hcaptcha|turnstile|verify you are human|human verification|cloudflare/i;
	const COOKIE_HINT_RE = /cookie|consent|gdpr|privacy|onetrust|didomi|trustarc|cmp|your choices|personal data/i;
	const COOKIE_ACCEPT_RE = /accept|agree|allow all|accept all|ok(ay)?|got it/i;
	const COOKIE_REJECT_RE = /reject|decline|deny|refuse|disagree|reject all|opt out|continue without accepting|do not sell/i;
	const COOKIE_NECESSARY_RE = /(necessary|essential|strictly necessary).*(only)|only.*(necessary|essential)/i;
	const CAPTURE_HIDDEN_ATTR = "data-systematic-reviewer-browser-capture-hidden";
	const CAPTURE_STYLE_ID = "__systematicReviewerBrowserCaptureStyle";

	function toInt(value, fallbackValue) {
		let n = parseInt(value, 10);
		return Number.isFinite(n) ? n : fallbackValue;
	}

	function clamp(value, min, max) {
		if (!Number.isFinite(value)) return min;
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	function truncate(value, maxLen) {
		if (typeof value != "string") {
			return "";
		}
		if (value.length <= maxLen) {
			return value;
		}
		return value.slice(0, maxLen);
	}

	function cssEscape(value) {
		if (typeof CSS != "undefined" && CSS.escape) {
			return CSS.escape(value);
		}
		return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
	}

	function getNodePath(el) {
		if (!el || el.nodeType != 1) {
			return "";
		}
		if (el.id) {
			return "#" + cssEscape(el.id);
		}
		let parts = [];
		let curr = el;
		while (curr && curr.nodeType == 1 && parts.length < 7) {
			let tag = curr.tagName.toLowerCase();
			let index = 1;
			let sib = curr;
			while ((sib = sib.previousElementSibling)) {
				if (sib.tagName == curr.tagName) {
					index++;
				}
			}
			parts.unshift(tag + ":nth-of-type(" + index + ")");
			curr = curr.parentElement;
		}
		return parts.join(" > ");
	}

	function elementText(el) {
		let text = "";
		if (typeof el.innerText == "string" && el.innerText.trim()) {
			text = el.innerText;
		}
		else if (typeof el.textContent == "string") {
			text = el.textContent;
		}
		text = text.replace(/\\s+/g, " ").trim();
		if (!text) {
			text = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
		}
		return text;
	}

		function isVisible(el) {
			if (!el || !el.ownerDocument || !el.ownerDocument.defaultView) {
				return false;
		}
		let rect = el.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			return false;
		}
		let style = el.ownerDocument.defaultView.getComputedStyle(el);
		if (!style) {
			return true;
		}
		if (style.visibility == "hidden" || style.display == "none") {
			return false;
		}
		if (style.opacity == "0") {
			return false;
			}
			return true;
		}

		function intersectsViewport(el) {
			if (!el || typeof el.getBoundingClientRect != "function") {
				return false;
			}
			let rect = el.getBoundingClientRect();
			if (!rect || rect.width <= 0 || rect.height <= 0) {
				return false;
			}
			return rect.bottom >= 0
				&& rect.right >= 0
				&& rect.top <= content.innerHeight
				&& rect.left <= content.innerWidth;
		}

	function isDisabled(el) {
		return !!(el.disabled || el.getAttribute("aria-disabled") == "true");
	}

	function getRect(el) {
		let rect = el.getBoundingClientRect();
		return {
			x: Math.round(rect.x),
			y: Math.round(rect.y),
			width: Math.round(rect.width),
			height: Math.round(rect.height)
		};
	}

	function describeElement(el, actionId) {
		let href = null;
		try {
			href = el.href || el.getAttribute("href") || null;
		}
		catch (e) {}
		let value = null;
		try {
			if (typeof el.value == "string") {
				value = el.value;
			}
		}
		catch (e) {}
		return {
			actionId: actionId,
			tag: (el.tagName || "").toLowerCase(),
			type: el.getAttribute("type") || null,
			role: el.getAttribute("role") || null,
			href: href,
			text: truncate(elementText(el), 180),
			ariaLabel: el.getAttribute("aria-label") || null,
			title: el.getAttribute("title") || null,
			name: el.getAttribute("name") || null,
			value: truncate(value || "", 120) || null,
			path: getNodePath(el),
			visible: isVisible(el),
			disabled: isDisabled(el),
			rect: getRect(el)
		};
	}

	function getCandidates(options) {
		let includeHidden = !!(options && options.includeHidden);
		let nodes = [];
		let found = content.document.querySelectorAll(INTERACTIVE_SELECTOR);
		let actionId = 0;
		for (let i = 0; i < found.length; i++) {
			let el = found[i];
			if (!includeHidden && !isVisible(el)) {
				continue;
			}
			actionId += 1;
			nodes.push({
				actionId: actionId,
				element: el
			});
		}
		return nodes;
	}

	function detectCaptcha() {
		let signals = [];
		try {
			let title = (content.document.title || "").toLowerCase();
			if (CAPTCHA_HINT_RE.test(title)) {
				signals.push("title");
			}
			let bodyText = "";
			if (content.document.body) {
				bodyText = (content.document.body.innerText || content.document.body.textContent || "")
					.toLowerCase()
					.slice(0, 6000);
			}
			if (CAPTCHA_HINT_RE.test(bodyText)) {
				signals.push("bodyText");
			}
			let iframes = content.document.querySelectorAll("iframe[src], frame[src]");
			for (let i = 0; i < iframes.length; i++) {
				let src = (iframes[i].getAttribute("src") || "").toLowerCase();
				if (src && CAPTCHA_HINT_RE.test(src)) {
					signals.push("iframe");
					break;
				}
			}
			let captchaNodes = content.document.querySelectorAll(
				"[id*='captcha' i], [class*='captcha' i], [id*='recaptcha' i], [class*='recaptcha' i], [data-sitekey], .cf-turnstile, [id*='turnstile' i]"
			);
			if (captchaNodes.length) {
				signals.push("nodeHint");
			}
		}
		catch (e) {}
		return {
			detected: signals.length > 0,
			signals: Array.from(new Set(signals))
		};
	}

	function snapshot(options) {
		let maxNodes = clamp(toInt(options && options.maxNodes, 80), 1, 1000);
		let candidates = getCandidates(options || {});
		let nodes = [];
		for (let i = 0; i < candidates.length && nodes.length < maxNodes; i++) {
			let candidate = candidates[i];
			nodes.push(describeElement(candidate.element, candidate.actionId));
		}
		return {
			url: content.location.href,
			title: content.document.title,
			readyState: content.document.readyState,
			viewport: {
				width: content.innerWidth,
				height: content.innerHeight,
				scrollX: content.scrollX,
				scrollY: content.scrollY
			},
			totalInteractiveNodes: candidates.length,
			nodes: nodes,
			captcha: detectCaptcha()
		};
	}

		function contentStats() {
			let doc = content.document;
		let bodyText = "";
		try {
			if (doc.body) {
				bodyText = (doc.body.innerText || doc.body.textContent || "");
			}
		}
		catch (e) {}
		bodyText = bodyText.replace(/\\s+/g, " ").trim();
		let interactiveCount = 0;
		try {
			interactiveCount = doc.querySelectorAll(INTERACTIVE_SELECTOR).length;
		}
		catch (e) {}
			return {
				url: content.location.href,
				title: doc.title || null,
				readyState: doc.readyState || null,
				textLength: bodyText.length,
				htmlLength: doc.documentElement ? (doc.documentElement.outerHTML || "").length : 0,
				interactiveCount,
				hasMain: !!doc.querySelector("main"),
				hasArticle: !!doc.querySelector("article"),
				bodyChildCount: doc.body ? doc.body.children.length : 0,
				scrollY: content.scrollY,
				viewportHeight: content.innerHeight,
				documentHeight: Math.max(
					content.innerHeight || 0,
					doc.documentElement ? doc.documentElement.scrollHeight : 0,
					doc.body ? doc.body.scrollHeight : 0
				)
			};
		}

		function serialize(payload) {
		payload = payload || {};
		let includeDoctype = payload.includeDoctype !== false;
		let doc = content.document;
		let html = doc.documentElement ? doc.documentElement.outerHTML : "";
		if (includeDoctype && doc.doctype) {
			let dt = "<!DOCTYPE " + doc.doctype.name;
			if (doc.doctype.publicId) {
				dt += ' PUBLIC "' + doc.doctype.publicId + '"';
			}
			if (doc.doctype.systemId) {
				dt += ' "' + doc.doctype.systemId + '"';
			}
			dt += ">";
			html = dt + "\\n" + html;
		}
			return {
				url: content.location.href,
				title: doc.title || null,
				contentType: doc.contentType || "text/html",
				html
			};
		}

		function cloneFilteredContent(node, options = {}, isRoot = false) {
			if (!node) {
				return null;
			}
			if (node.nodeType == content.Node.TEXT_NODE) {
				let text = String(node.nodeValue || "");
				return text.replace(/\s+/g, " ").trim()
					? content.document.createTextNode(text)
					: null;
			}
			if (node.nodeType != content.Node.ELEMENT_NODE) {
				return null;
			}
			let tag = String(node.tagName || "").toLowerCase();
			if (["script", "style", "noscript", "template"].includes(tag)) {
				return null;
			}
			if (!isRoot && !isVisible(node)) {
				return null;
			}
			let includeSelf = options.viewportOnly !== true || isRoot || intersectsViewport(node);
			let clone = node.cloneNode(false);
			let childCount = 0;
			for (let child of node.childNodes || []) {
				if (!includeSelf && options.viewportOnly === true && child?.nodeType == content.Node.TEXT_NODE) {
					continue;
				}
				let filtered = cloneFilteredContent(child, options, false);
				if (!filtered) {
					continue;
				}
				clone.appendChild(filtered);
				childCount += 1;
			}
			if (!includeSelf && childCount === 0) {
				return null;
			}
			return clone;
		}

		function extractContent(payload) {
			payload = payload || {};
			let selector = typeof payload.selector == "string" ? payload.selector.trim() : "";
			let doc = content.document;
			let root = selector
				? doc.querySelector(selector)
				: (doc.body || doc.documentElement);
			if (!root) {
				if (selector) {
					throw new Error("No element found for selector.");
				}
				throw new Error("No readable root is available for the current page.");
			}
			let filtered = cloneFilteredContent(root, {
				viewportOnly: payload.viewportOnly === true,
			}, true);
			let html = filtered?.outerHTML || "";
			return {
				url: content.location.href,
				title: doc.title || null,
				selector: selector || "",
				viewportOnly: payload.viewportOnly === true,
				html,
				htmlLength: html.length
			};
		}

	function getCookieContextScore(el) {
		let score = 0;
		let node = el;
		let depth = 0;
		while (node && node.nodeType == 1 && depth < 6) {
			let idClass = ((node.id || "") + " " + (node.className ? String(node.className) : "")).toLowerCase();
			let role = (node.getAttribute("role") || "").toLowerCase();
			if (COOKIE_HINT_RE.test(idClass) || COOKIE_HINT_RE.test(role)) {
				score += 2;
			}
			try {
				let style = content.getComputedStyle(node);
				if (style && (style.position == "fixed" || style.position == "sticky")) {
					score += 1;
				}
			}
			catch (e) {}
			node = node.parentElement;
			depth++;
		}
		let txt = elementText(el).toLowerCase();
		if (COOKIE_HINT_RE.test(txt)) {
			score += 2;
		}
		return score;
	}

	function getCookieLabel(el) {
		let text = elementText(el);
		let value = "";
		try {
			value = el.getAttribute("value") || "";
		}
		catch (e) {}
		return (text + " " + value).replace(/\\s+/g, " ").trim();
	}

	function scoreCookieAction(el, mode) {
		let label = getCookieLabel(el);
		let lower = label.toLowerCase();
		let context = getCookieContextScore(el);
		let hasNecessary = COOKIE_NECESSARY_RE.test(lower);
		let hasReject = COOKIE_REJECT_RE.test(lower);
		let hasAccept = COOKIE_ACCEPT_RE.test(lower);
		let score = context;
		if (mode == "necessary") {
			if (hasNecessary) score += 9;
			else if (hasReject) score += 5;
		}
		else if (mode == "reject") {
			if (hasReject) score += 8;
			if (hasNecessary) score += 2;
		}
		else {
			if (hasNecessary) score += 10;
			else if (hasReject) score += 7;
		}
		if (hasAccept && !hasNecessary) {
			score -= 9;
		}
		if (lower.includes("manage") || lower.includes("settings")) {
			score -= 2;
		}
		return {
			score,
			label,
			context,
		};
	}

	function clickNow(el) {
		try {
			el.focus();
		}
		catch (e) {}
		try {
			el.click();
			return true;
		}
		catch (e) {}
		try {
			let ev = new content.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				view: content,
				button: 0
			});
			return !!el.dispatchEvent(ev);
		}
		catch (e) {}
		return false;
	}

	function cookies(payload) {
		payload = payload || {};
		let mode = typeof payload.mode == "string" ? payload.mode.toLowerCase() : "necessary_or_reject";
		if (!["necessary_or_reject", "necessary", "reject"].includes(mode)) {
			mode = "necessary_or_reject";
		}
		let maxRounds = clamp(toInt(payload.maxRounds, 2), 1, 5);
		let maxClicks = clamp(toInt(payload.maxClicks, 2), 1, 6);
		let clicked = [];
		let considered = 0;
		for (let round = 0; round < maxRounds; round++) {
			let nodes = content.document.querySelectorAll(
				"button,[role='button'],a[href],input[type='button'],input[type='submit'],input[type='reset']"
			);
			let scored = [];
			for (let i = 0; i < nodes.length; i++) {
				let el = nodes[i];
				if (!isVisible(el) || isDisabled(el)) {
					continue;
				}
				let label = getCookieLabel(el);
				if (!label) {
					continue;
				}
				let details = scoreCookieAction(el, mode);
				if (details.score < 4) {
					continue;
				}
				scored.push({
					element: el,
					score: details.score,
					label: details.label,
					context: details.context
				});
			}
			considered += scored.length;
			if (!scored.length) {
				break;
			}
			scored.sort((a, b) => b.score - a.score || b.context - a.context);
			for (let i = 0; i < scored.length; i++) {
				if (clicked.length >= maxClicks) {
					break;
				}
				let candidate = scored[i];
				let success = clickNow(candidate.element);
				clicked.push({
					score: candidate.score,
					label: truncate(candidate.label, 180),
					context: candidate.context,
					success
				});
			}
			if (clicked.length >= maxClicks) {
				break;
			}
		}
		return {
			mode,
			maxRounds,
			maxClicks,
			clickedCount: clicked.length,
			consideredCount: considered,
			clicked
		};
	}

	function resolveTarget(payload) {
		payload = payload || {};
		let candidates = getCandidates({
			includeHidden: !!payload.includeHidden
		});
		if (Number.isInteger(payload.actionId) && payload.actionId > 0) {
			for (let i = 0; i < candidates.length; i++) {
				let c = candidates[i];
				if (c.actionId == payload.actionId) {
					return { element: c.element, actionId: c.actionId, matchedBy: "actionId" };
				}
			}
			throw new Error("actionId not found: " + payload.actionId);
		}
		if (typeof payload.selector == "string" && payload.selector.trim()) {
			let el = content.document.querySelector(payload.selector);
			if (el) {
				return { element: el, actionId: null, matchedBy: "selector" };
			}
			throw new Error("No element found for selector.");
		}
		if (typeof payload.path == "string" && payload.path.trim()) {
			let el = content.document.querySelector(payload.path);
			if (el) {
				return { element: el, actionId: null, matchedBy: "path" };
			}
			throw new Error("No element found for path.");
		}
		if (typeof payload.text == "string" && payload.text.trim()) {
			let needle = payload.caseSensitive ? payload.text : payload.text.toLowerCase();
			let exact = !!payload.exact;
			let best = null;
			for (let i = 0; i < candidates.length; i++) {
				let c = candidates[i];
				let txt = elementText(c.element) || "";
				let haystack = payload.caseSensitive ? txt : txt.toLowerCase();
				let matches = exact ? haystack == needle : haystack.indexOf(needle) != -1;
				if (!matches) {
					continue;
				}
				if (!best || (!isDisabled(c.element) && isDisabled(best.element))) {
					best = c;
				}
			}
			if (best) {
				return { element: best.element, actionId: best.actionId, matchedBy: "text" };
			}
			throw new Error("No element found matching text.");
		}
		throw new Error("Provide one locator: actionId, selector, path, or text.");
	}

	function getNavigableHref(el) {
		if (!el || !el.localName) {
			return null;
		}
		let localName = el.localName.toLowerCase();
		if ((localName == "a" || localName == "area") && el.href) {
			return el.href;
		}
		return null;
	}

	function shouldInternalNavigateHref(href) {
		if (!href || typeof href != "string") {
			return false;
		}
		let parsed;
		try {
			parsed = new URL(href, content.location.href);
		}
		catch (e) {
			return false;
		}
		let protocol = parsed.protocol.toLowerCase();
		return protocol == "http:" || protocol == "https:" || protocol == "file:" || protocol == "about:" || protocol == "blob:" || protocol == "data:";
	}

	function click(payload) {
		let resolved = resolveTarget(payload);
		let el = resolved.element;
		if (isDisabled(el)) {
			throw new Error("Target element is disabled.");
		}
		if (!isVisible(el) && payload && payload.includeHidden !== true) {
			throw new Error("Target element is not visible.");
		}
		if (!payload || payload.scrollIntoView !== false) {
			try {
				el.scrollIntoView({ block: "center", inline: "center" });
			}
			catch (e) {}
		}
		let beforeURL = content.location.href;
		try {
			el.focus();
		}
		catch (e) {}
		let href = getNavigableHref(el);
		let hasDownloadAttr = false;
		try {
			hasDownloadAttr = !!(el && el.hasAttribute && el.hasAttribute("download"));
		}
		catch (e) {}
		if ((!payload || payload.internalNavigate !== false) && href && shouldInternalNavigateHref(href) && !hasDownloadAttr) {
			content.location.assign(href);
			return {
				matchedBy: resolved.matchedBy,
				clicked: true,
				beforeURL: beforeURL,
				afterURL: content.location.href,
				internalNavigate: true,
				navigateURL: href,
				target: describeElement(el, resolved.actionId)
			};
		}
		let clicked = false;
		try {
			el.click();
			clicked = true;
		}
		catch (e) {}
		if (!clicked) {
			let ev = new content.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				view: content,
				button: 0
			});
			clicked = el.dispatchEvent(ev);
		}
		return {
			matchedBy: resolved.matchedBy,
			clicked: !!clicked,
			beforeURL: beforeURL,
			afterURL: content.location.href,
			target: describeElement(el, resolved.actionId)
		};
	}

	function type(payload) {
		if (!payload || typeof payload.value != "string") {
			throw new Error("Missing value string.");
		}
		let resolved = resolveTarget(payload);
		let el = resolved.element;
		if (isDisabled(el)) {
			throw new Error("Target element is disabled.");
		}
		if (!isVisible(el) && payload && payload.includeHidden !== true) {
			throw new Error("Target element is not visible.");
		}
		try {
			el.scrollIntoView({ block: "center", inline: "nearest" });
		}
		catch (e) {}
		try {
			el.focus();
		}
		catch (e) {}
		let tag = (el.tagName || "").toLowerCase();
		if (tag == "input" || tag == "textarea") {
			el.value = payload.value;
			el.dispatchEvent(new content.Event("input", { bubbles: true }));
			el.dispatchEvent(new content.Event("change", { bubbles: true }));
		}
		else if (el.isContentEditable) {
			el.textContent = payload.value;
			el.dispatchEvent(new content.Event("input", { bubbles: true }));
		}
		else {
			throw new Error("Target is not a text input.");
		}
		if (payload.pressEnter) {
			let down = new content.KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				bubbles: true
			});
			let up = new content.KeyboardEvent("keyup", {
				key: "Enter",
				code: "Enter",
				bubbles: true
			});
			el.dispatchEvent(down);
			el.dispatchEvent(up);
		}
		return {
			matchedBy: resolved.matchedBy,
			typed: true,
			valueLength: payload.value.length,
			target: describeElement(el, resolved.actionId)
		};
	}

	function selectValue(payload) {
		let resolved = resolveTarget(payload);
		let el = resolved.element;
		if ((el.tagName || "").toLowerCase() != "select") {
			throw new Error("Target is not a select element.");
		}
		let desiredValue = typeof payload.value == "string" ? payload.value : null;
		let desiredLabel = typeof payload.label == "string" ? payload.label.trim() : "";
		let desiredIndex = Number.isInteger(payload.index) ? payload.index : null;
		let matched = false;
		if (desiredValue !== null) {
			for (let i = 0; i < el.options.length; i++) {
				if (el.options[i].value == desiredValue) {
					el.selectedIndex = i;
					matched = true;
					break;
				}
			}
		}
		if (!matched && desiredLabel) {
			let lowered = desiredLabel.toLowerCase();
			for (let i = 0; i < el.options.length; i++) {
				let label = String(el.options[i].label || el.options[i].text || "").trim();
				if (label.toLowerCase() == lowered) {
					el.selectedIndex = i;
					matched = true;
					break;
				}
			}
		}
		if (!matched && desiredIndex !== null) {
			if (desiredIndex < 0 || desiredIndex >= el.options.length) {
				throw new Error("Select index is out of range.");
			}
			el.selectedIndex = desiredIndex;
			matched = true;
		}
		if (!matched) {
			throw new Error("No matching option found.");
		}
		el.dispatchEvent(new content.Event("input", { bubbles: true }));
		el.dispatchEvent(new content.Event("change", { bubbles: true }));
		return {
			matchedBy: resolved.matchedBy,
			selected: true,
			value: el.value,
			label: el.selectedOptions && el.selectedOptions[0]
				? (el.selectedOptions[0].label || el.selectedOptions[0].text || "")
				: "",
			index: el.selectedIndex,
			target: describeElement(el, resolved.actionId)
		};
	}

	function scroll(payload) {
		payload = payload || {};
		if (payload.to == "top") {
			content.scrollTo({
				top: 0,
				left: content.scrollX,
				behavior: payload.behavior || "auto"
			});
		}
		else if (payload.to == "bottom") {
			content.scrollTo({
				top: content.document.documentElement.scrollHeight,
				left: content.scrollX,
				behavior: payload.behavior || "auto"
			});
		}
		else if (Number.isFinite(payload.x) || Number.isFinite(payload.y)) {
			content.scrollTo({
				left: Number.isFinite(payload.x) ? payload.x : content.scrollX,
				top: Number.isFinite(payload.y) ? payload.y : content.scrollY,
				behavior: payload.behavior || "auto"
			});
		}
		else {
			let deltaX = Number.isFinite(payload.deltaX) ? payload.deltaX : 0;
			let deltaY = Number.isFinite(payload.deltaY) ? payload.deltaY : 600;
			content.scrollBy({
				left: deltaX,
				top: deltaY,
				behavior: payload.behavior || "auto"
			});
		}
		return {
			scrollX: content.scrollX,
			scrollY: content.scrollY,
			viewportHeight: content.innerHeight,
			documentHeight: content.document.documentElement.scrollHeight
		};
	}

	function getCaptureDimensions() {
		let doc = content.document;
		let de = doc.documentElement;
		let body = doc.body;
		let viewportWidth = Math.max(1, content.innerWidth || de?.clientWidth || 1);
		let viewportHeight = Math.max(1, content.innerHeight || de?.clientHeight || 1);
		let documentWidth = Math.max(
			viewportWidth,
			de ? de.scrollWidth : 0,
			body ? body.scrollWidth : 0,
			de ? de.offsetWidth : 0,
			body ? body.offsetWidth : 0
		);
		let documentHeight = Math.max(
			viewportHeight,
			de ? de.scrollHeight : 0,
			body ? body.scrollHeight : 0,
			de ? de.offsetHeight : 0,
			body ? body.offsetHeight : 0
		);
		return {
			viewportWidth,
			viewportHeight,
			documentWidth,
			documentHeight
		};
	}

	function capturePlan(payload) {
		payload = payload || {};
		let overlapPx = clamp(toInt(payload.overlapPx, 80), 0, 700);
		let dims = getCaptureDimensions();
		let maxTop = Math.max(0, dims.documentHeight - dims.viewportHeight);
		let step = Math.max(1, dims.viewportHeight - overlapPx);
		let positions = [0];
		let y = 0;
		let maxTiles = clamp(toInt(payload.maxTiles, 500), 1, 5000);
		while (y < maxTop && positions.length < maxTiles) {
			y = Math.min(maxTop, y + step);
			if (positions[positions.length - 1] != y) {
				positions.push(y);
			}
			if (y >= maxTop) {
				break;
			}
		}
		if (positions[positions.length - 1] != maxTop) {
			positions.push(maxTop);
		}
		return Object.assign({
			overlapPx,
			stepPx: step,
			positions
		}, dims);
	}

	function capturePrepare(payload) {
		payload = payload || {};
		let hideFixed = payload.hideFixed !== false;
		let maxNodes = clamp(toInt(payload.maxNodes, 8000), 500, 20000);
		let hidden = 0;
		let doc = content.document;
		let styleEl = doc.getElementById(CAPTURE_STYLE_ID);
		if (!styleEl) {
			styleEl = doc.createElement("style");
			styleEl.id = CAPTURE_STYLE_ID;
			styleEl.textContent =
				"[" + CAPTURE_HIDDEN_ATTR + "='1']{"
				+ "visibility:hidden !important;"
				+ "opacity:0 !important;"
				+ "pointer-events:none !important;"
				+ "}"
				+ "html,body{scroll-behavior:auto !important;}";
			(doc.head || doc.documentElement).appendChild(styleEl);
		}
		if (hideFixed) {
			let nodes = doc.querySelectorAll("body *");
			for (let i = 0; i < nodes.length && i < maxNodes; i++) {
				let el = nodes[i];
				if (!el || el.nodeType != 1 || el.getAttribute(CAPTURE_HIDDEN_ATTR) == "1") {
					continue;
				}
				let style = null;
				try {
					style = content.getComputedStyle(el);
				}
				catch (e) {}
				if (!style) {
					continue;
				}
				let position = (style.position || "").toLowerCase();
				if (!(position == "fixed" || position == "sticky")) {
					continue;
				}
				let rect = el.getBoundingClientRect();
				let area = Math.max(0, rect.width) * Math.max(0, rect.height);
				if (area < 1200) {
					continue;
				}
				el.setAttribute(CAPTURE_HIDDEN_ATTR, "1");
				hidden++;
			}
		}
		return {
			hideFixed,
			hiddenCount: hidden
		};
	}

	function captureRestore() {
		let doc = content.document;
		let hiddenNodes = doc.querySelectorAll("[" + CAPTURE_HIDDEN_ATTR + "='1']");
		let restored = 0;
		for (let i = 0; i < hiddenNodes.length; i++) {
			hiddenNodes[i].removeAttribute(CAPTURE_HIDDEN_ATTR);
			restored++;
		}
		let styleEl = doc.getElementById(CAPTURE_STYLE_ID);
		if (styleEl && styleEl.parentNode) {
			styleEl.parentNode.removeChild(styleEl);
		}
		return { restoredCount: restored };
	}

		function handleCommand(command, payload) {
			switch (command) {
				case "snapshot":
					return snapshot(payload || {});
				case "content_stats":
					return contentStats();
				case "serialize":
					return serialize(payload || {});
				case "extract_content":
					return extractContent(payload || {});
				case "cookies":
					return cookies(payload || {});
			case "click":
				return click(payload || {});
			case "type":
				return type(payload || {});
			case "select":
				return selectValue(payload || {});
			case "scroll":
				return scroll(payload || {});
			case "capture_plan":
				return capturePlan(payload || {});
			case "capture_prepare":
				return capturePrepare(payload || {});
			case "capture_restore":
				return captureRestore();
			default:
				throw new Error("Unknown command: " + command);
		}
	}

	addMessageListener(COMMAND, message => {
		if (content != content.top) {
			return;
		}
		let data = message && message.data ? message.data : {};
		let requestId = data.requestId;
		try {
			let result = handleCommand(data.command, data.payload || {});
			sendAsyncMessage(RESPONSE, {
				requestId: requestId,
				ok: true,
				result: result
			});
		}
		catch (e) {
			sendAsyncMessage(RESPONSE, {
				requestId: requestId,
				ok: false,
				error: e && e.message ? e.message : String(e)
			});
		}
	});
})();
`;
	}

	function ensureFrameScriptLoaded(browser) {
		let mm = browser?.messageManager || null;
		if (!mm) {
			throw new Error("Browser message manager is unavailable.");
		}
		if (!frameScriptURL) {
			frameScriptURL = "data:application/javascript;charset=utf-8," + encodeURIComponent(getFrameScriptSource());
		}
		mm.loadFrameScript(frameScriptURL, true);
	}

	async function sendFrameCommand(browser, command, payload = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
		ensureFrameScriptLoaded(browser);
		let mm = browser.messageManager;
		let requestId = `systematic-reviewer-privileged-browser-${Date.now()}-${++requestCounter}`;
		return await new Promise((resolve, reject) => {
			let finished = false;
			let cleanup = () => {
				if (finished) {
					return;
				}
				finished = true;
				try {
					mm.removeMessageListener("systematic-reviewer-privileged-browser:response", onResponse);
				}
				catch (_error) {}
				clearTimeout(timer);
			};
			let onResponse = (message) => {
				let data = message?.data || {};
				if (data.requestId != requestId) {
					return;
				}
				cleanup();
				if (!data.ok) {
					reject(new Error(data.error || `Command failed: ${command}`));
					return;
				}
				resolve(data.result || {});
			};
			let timer = setTimeout(() => {
				cleanup();
				reject(new Error(`Timed out waiting for browser command: ${command}`));
			}, timeoutMs);
			mm.addMessageListener("systematic-reviewer-privileged-browser:response", onResponse);
			mm.sendAsyncMessage("systematic-reviewer-privileged-browser:command", {
				requestId,
				command,
				payload,
			});
		});
	}

	async function waitAfterAction(browser, beforeURL, timeoutMs = 5000) {
		let deadline = Date.now() + Math.max(0, timeoutMs);
		let sawLoadStart = false;
		while (Date.now() < deadline) {
			let isLoading = false;
			let currentURL = null;
			try {
				isLoading = !!(browser.webProgress && browser.webProgress.isLoadingDocument);
				currentURL = browser.currentURI?.spec || null;
			}
			catch (_error) {}
			if (isLoading) {
				sawLoadStart = true;
				break;
			}
			if (currentURL && beforeURL && currentURL != beforeURL) {
				return true;
			}
			await sleep(100);
		}
		if (!sawLoadStart) {
			return false;
		}
		try {
			await waitForPage(browser, Math.max(250, deadline - Date.now()));
		}
		catch (_error) {}
		return true;
	}

	async function openURL(url, options = {}) {
		let targetURL = validateURL(url);
		cleanupViewerWindows();
		let explicitWindowID = parseOptionalInt(options.windowID || options.window_id);
		let openNewWindow = parseBool(options.newWindow ?? options.new_window ?? options.openInNewWindow, false);
		let win = null;
		let windowID = null;
		if (explicitWindowID && !openNewWindow) {
			let entry = getViewerEntry(explicitWindowID);
			win = entry?.win || null;
			windowID = entry?.id || null;
		}
		else if (!openNewWindow) {
			let activeEntry = getViewerEntry();
			win = activeEntry?.win || null;
			windowID = activeEntry?.id || null;
		}
		if (!win) {
			let lastError = null;
			for (let attempt = 0; attempt < 4; attempt += 1) {
				try {
					win = openBasicViewer(targetURL, options);
					windowID = registerViewerWindow(win);
					await waitForViewerWindowReady(win, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
					let browser = getBrowserFromWindow(win);
					try {
						await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
					}
					catch (_error) {}
					let state = await getState({ windowID });
					state.created_window = true;
					state.reused_existing_window = false;
					state.requested_new_window = openNewWindow;
					return state;
				}
				catch (error) {
					lastError = error;
					try {
						if (windowID) {
							closeViewerWindow(windowID);
						}
					}
					catch (_innerError) {}
					win = null;
					windowID = null;
					if (attempt < 3) {
						await sleep(150 * (attempt + 1));
					}
				}
			}
			throw lastError || new Error("Failed to open browser window.");
		}
		windowID = registerViewerWindow(win);
		let browser = getBrowserFromWindow(win);
		let previousURL = browser.currentURI?.spec || null;
		browser.loadURI(
			Services.io.newURI(targetURL),
			{
				triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
			}
		);
		try {
			await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, previousURL);
		}
		catch (_error) {}
		let state = await getState({ windowID });
		state.created_window = false;
		state.reused_existing_window = true;
		state.requested_new_window = openNewWindow;
		return state;
	}

	async function navigate(options = {}) {
		if (typeof options.url == "string" && options.url.trim()) {
			return await openURL(options.url, options);
		}
		let action = optionalString(options.action).toLowerCase();
		if (!action) {
			throw new Error("browser navigate requires action or url.");
		}
		if (action == "home") {
			let homeURL = optionalString(options.homeURL || options.home_url || "about:home");
			return await openURL(homeURL, options);
		}
		let browser = getBrowserOrThrow(options);
		let beforeURL = browser.currentURI?.spec || null;
		let shouldWaitForLoad = true;
		let available = true;
		let unavailableReason = "";
		switch (action) {
			case "back": {
				let canGoBack = false;
				try {
					canGoBack = !!browser.canGoBack;
				}
				catch (_error) {}
				try {
					if (!canGoBack && browser.webNavigation) {
						canGoBack = !!browser.webNavigation.canGoBack;
					}
				}
				catch (_error) {}
				if (!canGoBack) {
					available = false;
					unavailableReason = "NO_BACK_HISTORY";
					shouldWaitForLoad = false;
					break;
				}
				browser.goBack();
				break;
			}
			case "forward": {
				let canGoForward = false;
				try {
					canGoForward = !!browser.canGoForward;
				}
				catch (_error) {}
				try {
					if (!canGoForward && browser.webNavigation) {
						canGoForward = !!browser.webNavigation.canGoForward;
					}
				}
				catch (_error) {}
				if (!canGoForward) {
					available = false;
					unavailableReason = "NO_FORWARD_HISTORY";
					shouldWaitForLoad = false;
					break;
				}
				browser.goForward();
				break;
			}
			case "reload":
				try {
					browser.reload();
				}
				catch (_error) {
					browser.webNavigation?.reload?.(0);
				}
				break;
			case "stop":
				shouldWaitForLoad = false;
				try {
					browser.stop();
				}
				catch (_error) {
					browser.webNavigation?.stop?.(0);
				}
				break;
			default:
				throw new Error(`Unsupported navigate action: ${action}`);
		}
		if (!available) {
			let state = await getState(options);
			return {
				action,
				available: false,
				reason: unavailableReason,
				before_url: beforeURL,
				after_url: state.url || null,
				navigated: false,
				waited_for_load: false,
				state,
			};
		}
		let waitForLoad = parseBool(options.waitForLoad ?? options.wait_for_load, shouldWaitForLoad);
		let waitedForLoad = false;
		if (waitForLoad) {
			try {
				let disallowURL = (action == "back" || action == "forward") ? beforeURL : null;
				await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, disallowURL);
				waitedForLoad = true;
			}
			catch (_error) {}
		}
		let state = await getState(options);
		return {
			action,
			available: true,
			before_url: beforeURL,
			after_url: state.url || null,
			navigated: beforeURL != (state.url || null),
			waited_for_load: waitedForLoad,
			state,
		};
	}

	async function waitForBrowser(options = {}) {
		let mode = optionalString(options.mode || "load").toLowerCase() || "load";
		if (mode == "sleep") {
			let sleepMs = clamp(options.sleepMs || options.sleep_ms || options.timeoutMs || options.timeout_ms, 1, 120000, 500);
			await sleep(sleepMs);
			return {
				mode: "sleep",
				slept_ms: sleepMs,
				state: await getState(options),
			};
		}
		if (mode == "render") {
			let render = await waitForRenderablePage(options);
			return {
				mode: "render",
				result: render,
				state: await getState(options),
			};
		}
		if (mode == "load_render" || mode == "load+render") {
			let load = await waitForBrowser(Object.assign({}, options, { mode: "load" }));
			let render = await waitForBrowser(Object.assign({}, options, { mode: "render" }));
			return {
				mode: "load_render",
				load,
				render,
				state: render.state || load.state,
			};
		}
		if (mode != "load") {
			throw new Error(`Unsupported wait mode: ${mode}`);
		}
		let browser = getBrowserOrThrow(options);
		let loaded = false;
		let error = "";
		try {
			await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
			loaded = true;
		}
		catch (err) {
			error = err?.message || String(err);
		}
		return {
			mode: "load",
			loaded,
			error,
			state: await getState(options),
		};
	}

	async function getState(options = {}) {
		let windowID = options && (options.windowID !== undefined || options.window_id !== undefined)
			? (options.windowID ?? options.window_id)
			: null;
		let win = getViewerWindow(windowID);
		let windows = listViewerWindows();
		if (!win) {
			return {
				viewer_open: false,
				active_window_id: windows.active_window_id,
				window_count: windows.window_count,
				windows: windows.windows,
			};
		}
		let selectedWindowID = parseOptionalInt(windowID) || windows.active_window_id;
		let browser = getBrowserFromWindow(win);
		let url = browser.currentURI?.spec || null;
		let title = browser.contentTitle || null;
		let pageLoaded = false;
		try {
			pageLoaded = !!(browser.webProgress && !browser.webProgress.isLoadingDocument);
		}
		catch (_error) {}
		return {
			viewer_open: true,
			window_id: selectedWindowID,
			active_window_id: windows.active_window_id,
			window_count: windows.window_count,
			windows: windows.windows,
			url,
			title,
			page_loaded: pageLoaded,
		};
	}

	async function listActions(options = {}) {
		let browser = getBrowserOrThrow(options);
		if (options.waitForLoad !== false && options.wait_for_load !== false) {
			try {
				await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
			}
			catch (_error) {}
		}
		let payload = {
			maxNodes: clamp(options.maxNodes || options.max_nodes, 1, 1000, 80),
			includeHidden: options.includeHidden === true || options.include_hidden === true,
		};
		return await sendFrameCommand(browser, "snapshot", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS);
	}

	async function getSummary(options = {}) {
		let result = await listActions(Object.assign({ max_nodes: 50 }, options || {}));
		return {
			url: result?.url || null,
			title: result?.title || null,
			timestamp: new Date().toISOString(),
			total_interactive_nodes: Number(result?.totalInteractiveNodes || 0) || 0,
			nodes: Array.isArray(result?.nodes) ? result.nodes : [],
			captcha: result?.captcha || null,
		};
	}

	async function getContentStats(options = {}) {
		let browser = getBrowserOrThrow(options);
		if (options.waitForLoad !== false && options.wait_for_load !== false) {
			try {
				await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
			}
			catch (_error) {}
		}
		return await sendFrameCommand(browser, "content_stats", {}, Number(options.commandTimeoutMs || options.command_timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS);
	}

	async function clickElement(options = {}) {
		let browser = getBrowserOrThrow(options);
		let beforeURL = browser.currentURI?.spec || null;
		let payload = {
			actionId: Number.isInteger(options.action_id) ? options.action_id : options.actionId,
			selector: options.selector,
			path: options.path,
			text: options.text,
			exact: options.exact === true,
			caseSensitive: options.case_sensitive === true || options.caseSensitive === true,
			includeHidden: options.include_hidden === true || options.includeHidden === true,
			scrollIntoView: options.scroll_into_view !== false && options.scrollIntoView !== false,
			internalNavigate: options.internal_navigate !== false && options.internalNavigate !== false,
		};
		let commandResult = await sendFrameCommand(browser, "click", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS);
		let waitMs = Number.isInteger(options.waitForLoadMs) ? options.waitForLoadMs : (Number.isInteger(options.wait_for_load_ms) ? options.wait_for_load_ms : 5000);
		let navigated = waitMs > 0 ? await waitAfterAction(browser, beforeURL, waitMs) : false;
		return Object.assign({}, commandResult, {
			navigated,
			state: await getState(options),
		});
	}

	async function typeIntoElement(options = {}) {
		let browser = getBrowserOrThrow(options);
		let payload = {
			actionId: Number.isInteger(options.action_id) ? options.action_id : options.actionId,
			selector: options.selector,
			path: options.path,
			text: options.text,
			value: String(options.value || ""),
			exact: options.exact === true,
			caseSensitive: options.case_sensitive === true || options.caseSensitive === true,
			includeHidden: options.include_hidden === true || options.includeHidden === true,
			pressEnter: options.press_enter === true || options.pressEnter === true,
		};
		let commandResult = await sendFrameCommand(browser, "type", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS);
		return Object.assign({}, commandResult, {
			state: await getState(options),
		});
	}

	async function selectElement(options = {}) {
		let browser = getBrowserOrThrow(options);
		let payload = {
			actionId: Number.isInteger(options.action_id) ? options.action_id : options.actionId,
			selector: options.selector,
			path: options.path,
			text: options.text,
			value: typeof options.value == "string" ? options.value : null,
			label: typeof options.label == "string" ? options.label : "",
			index: Number.isInteger(options.index) ? options.index : null,
			exact: options.exact === true,
			caseSensitive: options.case_sensitive === true || options.caseSensitive === true,
			includeHidden: options.include_hidden === true || options.includeHidden === true,
		};
		let commandResult = await sendFrameCommand(browser, "select", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS);
		return Object.assign({}, commandResult, {
			state: await getState(options),
		});
	}

	async function scrollPage(options = {}) {
		let browser = getBrowserOrThrow(options);
		let payload = {};
		let toValue = optionalString(options.to || "");
		if (toValue) {
			payload.to = toValue.toLowerCase();
		}
		if (Number.isFinite(options.x)) payload.x = options.x;
		if (Number.isFinite(options.y)) payload.y = options.y;
		if (Number.isFinite(options.delta_x)) payload.deltaX = options.delta_x;
		if (Number.isFinite(options.delta_y)) payload.deltaY = options.delta_y;
		if (Number.isFinite(options.deltaX)) payload.deltaX = options.deltaX;
		if (Number.isFinite(options.deltaY)) payload.deltaY = options.deltaY;
		if (typeof options.behavior == "string" && options.behavior.trim()) {
			payload.behavior = options.behavior.trim();
		}
		let commandResult = await sendFrameCommand(browser, "scroll", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || DEFAULT_COMMAND_TIMEOUT_MS) || DEFAULT_COMMAND_TIMEOUT_MS);
		return Object.assign({}, commandResult, {
			state: await getState(options),
		});
	}

	async function waitForRenderablePage(options = {}) {
		let browser = getBrowserOrThrow(options);
		let timeoutMs = clamp(options.timeoutMs || options.timeout_ms, 500, 60000, 12000);
		let intervalMs = clamp(options.intervalMs || options.interval_ms, 100, 1500, 300);
		let minTextLength = clamp(options.minTextLength || options.min_text_length, 20, 5000, 120);
		let minInteractive = clamp(options.minInteractive || options.min_interactive, 0, 200, 3);
		let deadline = Date.now() + timeoutMs;
		let last = null;
		while (Date.now() < deadline) {
			try {
				last = await sendFrameCommand(browser, "content_stats", {}, Math.min(5000, timeoutMs));
				let textLen = Number(last?.textLength || 0) || 0;
				let interactive = Number(last?.interactiveCount || 0) || 0;
				let meaningful = !!last?.hasMain || !!last?.hasArticle || textLen >= minTextLength || interactive >= minInteractive;
				if (meaningful) {
					return Object.assign({ ready: true }, last);
				}
			}
			catch (_error) {}
			await sleep(intervalMs);
		}
		return Object.assign({ ready: false }, last || {});
	}

	async function handleCookieBanners(options = {}) {
		let browser = getBrowserOrThrow(options);
		if (options.waitForLoad !== false && options.wait_for_load !== false) {
			try {
				await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
			}
			catch (_error) {}
		}
		let payload = {
			mode: optionalString(options.mode || "necessary_or_reject") || "necessary_or_reject",
			maxRounds: parseOptionalInt(options.maxRounds || options.max_rounds) || 2,
			maxClicks: parseOptionalInt(options.maxClicks || options.max_clicks) || 2,
			delayMs: parseOptionalInt(options.delayMs || options.delay_ms) || 450,
		};
		let result = await sendFrameCommand(browser, "cookies", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || 20000) || 20000);
		let waitAfterMs = parseOptionalInt(options.waitAfterMs || options.wait_after_ms) || 0;
		if (waitAfterMs > 0) {
			await sleep(waitAfterMs);
		}
		return Object.assign({}, result, {
			state: await getState(options),
		});
	}

	async function serializeCurrentPage(options = {}) {
		let browser = getBrowserOrThrow(options);
		if (options.waitForLoad !== false && options.wait_for_load !== false) {
			try {
				await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
			}
			catch (_error) {}
		}
		if (parseBool(options.waitForRenderable ?? options.wait_for_renderable, true)) {
			await waitForRenderablePage({
				windowID: options.windowID || options.window_id,
				timeout_ms: parseOptionalInt(options.renderWaitMs || options.render_wait_ms) || 12000,
				min_text_length: parseOptionalInt(options.minTextLength || options.min_text_length) || 120,
				min_interactive: parseOptionalInt(options.minInteractive || options.min_interactive) || 3,
			}).catch(() => null);
		}
		let payload = {
			includeDoctype: parseBool(options.includeDoctype ?? options.include_doctype, true),
		};
		return await sendFrameCommand(browser, "serialize", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || 20000) || 20000);
	}

	async function extractPageContent(options = {}) {
		let browser = getBrowserOrThrow(options);
		if (options.waitForLoad !== false && options.wait_for_load !== false) {
			try {
				await waitForPage(browser, Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
			}
			catch (_error) {}
		}
		if (parseBool(options.waitForRenderable ?? options.wait_for_renderable, true)) {
			await waitForRenderablePage({
				windowID: options.windowID || options.window_id,
				timeout_ms: parseOptionalInt(options.renderWaitMs || options.render_wait_ms) || 12000,
				min_text_length: parseOptionalInt(options.minTextLength || options.min_text_length) || 120,
				min_interactive: parseOptionalInt(options.minInteractive || options.min_interactive) || 3,
			}).catch(() => null);
		}
		let payload = {
			selector: optionalString(options.selector || ""),
			viewportOnly: parseBool(options.viewportOnly ?? options.viewport_only, false),
		};
		return await sendFrameCommand(browser, "extract_content", payload, Number(options.commandTimeoutMs || options.command_timeout_ms || 20000) || 20000);
	}

	async function resolveScreenshotPath(options = {}) {
		let explicitPath = optionalString(options.path || "");
		if (explicitPath) {
			let parent = PathUtils.parent(explicitPath);
			if (parent) {
				await IOUtils.makeDirectory(parent, { createAncestors: true });
			}
			return explicitPath;
		}
		let dir = optionalString(options.dir || "") || tempScreenshotDir();
		await IOUtils.makeDirectory(dir, { createAncestors: true });
		let filename = optionalString(options.filename || `browser-shot-${Date.now()}.png`);
		if (!filename.toLowerCase().endsWith(".png")) {
			filename += ".png";
		}
		return PathUtils.join(dir, filename);
	}

	async function captureBitmapPNGBytes(browser, options = {}) {
		let winGlobal = currentWindowGlobalBrowser(browser);
		if (!winGlobal) {
			throw new Error("No page context is available for screenshot capture.");
		}
		let scale = clamp(options.scale, 0.5, 4.0, 1.0);
		let includeDataURL = options.includeDataURL === true;
		let bitmap = await winGlobal.drawSnapshot(null, scale, "rgb(255,255,255)", false);
		try {
			let doc = browser.ownerDocument;
			let canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			let ctx = canvas.getContext("2d");
			ctx.drawImage(bitmap, 0, 0);
			let dataURL = canvas.toDataURL("image/png");
			let out = {
				width: canvas.width,
				height: canvas.height,
				bytes: base64ToBytes(dataURL.split(",")[1]),
			};
			if (includeDataURL) {
				out.dataURL = dataURL;
			}
			return out;
		}
		finally {
			try {
				bitmap?.close?.();
			}
			catch (_error) {}
		}
	}

	async function resamplePNGDataURL(browser, dataURL = "", targetWidth = 0, targetHeight = 0) {
		let width = Math.max(1, Math.round(positiveNumber(targetWidth, 1)));
		let height = Math.max(1, Math.round(positiveNumber(targetHeight, 1)));
		let image = await loadImageFromDataURL(browser, dataURL);
		let doc = browser.ownerDocument;
		let canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
		canvas.width = width;
		canvas.height = height;
		let ctx = canvas.getContext("2d");
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		let nextDataURL = canvas.toDataURL("image/png");
		return {
			width: canvas.width,
			height: canvas.height,
			bytes: base64ToBytes(nextDataURL.split(",")[1]),
			dataURL: nextDataURL,
		};
	}

	function resolveScreenshotScaling(options = {}, defaults = {}) {
		let defaultScale = positiveNumber(defaults.scale, 1.0) || 1.0;
		let defaultOversample = positiveNumber(defaults.oversample, 1.0) || 1.0;
		let finalScale = clamp(
			options.scale ?? options.captureScale ?? options.capture_scale,
			0.2,
			4.0,
			defaultScale
		);
		let oversample = clamp(
			options.oversample ?? options.captureOversample ?? options.capture_oversample,
			1.0,
			3.0,
			defaultOversample
		);
		let captureScale = clamp(finalScale * oversample, 0.2, 4.0, finalScale);
		return {
			scale: finalScale,
			oversample,
			captureScale,
			outputRatio: finalScale / captureScale,
		};
	}

	function filenameFromPath(path = "") {
		let parts = String(path || "").split(/[\\/]/).filter(Boolean);
		return parts.length ? parts[parts.length - 1] : "";
	}

	function stripExtension(filename = "") {
		let index = String(filename || "").lastIndexOf(".");
		return index > 0 ? String(filename || "").slice(0, index) : String(filename || "");
	}

	async function loadImageFromDataURL(browser, dataURL = "") {
		let win = browser.ownerGlobal || browser.ownerDocument?.defaultView || null;
		if (!win?.Image) {
			throw new Error("Screenshot image decoding is unavailable.");
		}
		return await new Promise((resolve, reject) => {
			let img = new win.Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("Failed to decode screenshot tile."));
			img.src = dataURL;
		});
	}

	async function captureViewportScreenshot(browser, options = {}) {
		let outputPath = await resolveScreenshotPath(options);
		let scaling = resolveScreenshotScaling(options, {
			scale: 1.0,
			oversample: 1.0,
		});
		let png = await captureBitmapPNGBytes(browser, {
			scale: scaling.captureScale,
			includeDataURL: scaling.captureScale != scaling.scale,
		});
		if (scaling.captureScale != scaling.scale && png.dataURL) {
			png = await resamplePNGDataURL(
				browser,
				png.dataURL,
				Math.max(1, Math.round(png.width * scaling.outputRatio)),
				Math.max(1, Math.round(png.height * scaling.outputRatio))
			);
		}
		await IOUtils.write(outputPath, png.bytes);
		return {
			mode: "viewport",
			path: outputPath,
			width: png.width,
			height: png.height,
			url: browser.currentURI?.spec || null,
			title: browser.contentTitle || null,
			scale: scaling.scale,
			oversample: scaling.oversample,
			capture_scale: scaling.captureScale,
		};
	}

	async function captureFullPage(browser, options = {}, mode = "fullpage_stitched") {
		let outputPath = await resolveScreenshotPath(options);
		let outputDir = PathUtils.parent(outputPath);
		await IOUtils.makeDirectory(outputDir, { createAncestors: true });
		let outputFilename = filenameFromPath(outputPath);
		let baseName = sanitizeFilenamePart(stripExtension(outputFilename) || optionalString(options.title || "") || "fullpage", "fullpage");
		let tileDir = optionalString(options.tilesDir || options.tiles_dir || "") || PathUtils.join(outputDir, `${baseName}-tiles`);
		await IOUtils.makeDirectory(tileDir, { createAncestors: true });
		let overlapPx = clamp(options.overlapPx || options.overlap_px, 0, 600, 80);
		let scrollDelayMs = clamp(options.scrollDelayMs || options.scroll_delay_ms, 20, 3000, 220);
		let maxTiles = clamp(options.maxTiles || options.max_tiles, 1, 1000, 240);
		let scaling = resolveScreenshotScaling(options, {
			scale: 2.0,
			oversample: 1.0,
		});
		let finalScale = scaling.scale;
		let oversample = scaling.oversample;
		let captureScale = scaling.captureScale;
		let outputRatio = scaling.outputRatio;
		let saveTiles = parseBool(options.saveTiles ?? options.save_tiles, true);
		let hideFixed = parseBool(options.hideFixed ?? options.hide_fixed, true);
		let restoreScrollTop = parseBool(options.restoreScrollTop ?? options.restore_scroll_top, true);
		let forceSingleOutput = parseBool(options.forceSingleOutput ?? options.force_single_output, false);
		let maxSingleHeightPx = clamp(options.maxSingleHeightPx || options.max_single_height_px, 4000, 32000, 30000);
		let commandTimeoutMs = Number(options.commandTimeoutMs || options.command_timeout_ms || 25000) || 25000;
		let plan = await sendFrameCommand(browser, "capture_plan", { overlapPx }, commandTimeoutMs);
		if (forceSingleOutput) {
			let documentHeightCss = Math.max(1, Number(plan.documentHeight || plan.viewportHeight || 1) || 1);
			let maxScaleForSingle = maxSingleHeightPx / documentHeightCss;
			if (maxScaleForSingle > 0 && finalScale > maxScaleForSingle) {
				finalScale = clamp(maxScaleForSingle, 0.2, 4.0, 1.0);
				captureScale = clamp(finalScale * oversample, 0.2, 4.0, finalScale);
				outputRatio = finalScale / captureScale;
			}
		}
		let positions = Array.isArray(plan.positions) ? plan.positions.slice(0, maxTiles) : [0];
		if (!positions.length) {
			positions = [0];
		}
		let tiles = [];
		let prepared = false;
		try {
			try {
				await sendFrameCommand(browser, "capture_prepare", {
					hideFixed,
					maxNodes: parseOptionalInt(options.capturePrepMaxNodes || options.capture_prep_max_nodes) || 8000,
				}, commandTimeoutMs);
				prepared = true;
			}
			catch (_error) {}
			for (let index = 0; index < positions.length; index += 1) {
				let y = Number.isFinite(positions[index]) ? positions[index] : 0;
				await sendFrameCommand(browser, "scroll", { y, behavior: "auto" }, commandTimeoutMs);
				if (scrollDelayMs > 0) {
					await sleep(scrollDelayMs);
				}
				let shot = await captureBitmapPNGBytes(browser, {
					scale: captureScale,
					includeDataURL: mode != "fullpage_tiles",
				});
				let tileName = `${baseName}-tile-${String(index + 1).padStart(3, "0")}-y${Math.round(y)}.png`;
				let tilePath = PathUtils.join(tileDir, tileName);
				if (saveTiles || mode == "fullpage_tiles") {
					await IOUtils.write(tilePath, shot.bytes);
				}
				tiles.push({
					index: index + 1,
					y,
					width: shot.width,
					height: shot.height,
					path: (saveTiles || mode == "fullpage_tiles") ? tilePath : null,
					dataURL: shot.dataURL || null,
				});
			}
		}
		finally {
			if (prepared) {
				try {
					await sendFrameCommand(browser, "capture_restore", {}, commandTimeoutMs);
				}
				catch (_error) {}
			}
			if (restoreScrollTop) {
				try {
					await sendFrameCommand(browser, "scroll", { y: 0, behavior: "auto" }, commandTimeoutMs);
				}
				catch (_error) {}
			}
		}
		let manifestPath = PathUtils.join(tileDir, `${baseName}-tiles.json`);
		await writeUTF8(manifestPath, JSON.stringify({
			mode,
			url: browser.currentURI?.spec || null,
			title: browser.contentTitle || null,
			scale: finalScale,
			oversample,
			captureScale,
			overlapPx,
			plan,
			tileCount: tiles.length,
			tiles: tiles.map((tile) => ({
				index: tile.index,
				y: tile.y,
				width: tile.width,
				height: tile.height,
				path: tile.path,
			})),
		}, null, 2));
		if (mode == "fullpage_tiles") {
			return {
				mode,
				path: null,
				tile_dir: tileDir,
				manifest_path: manifestPath,
				tile_count: tiles.length,
				tiles: tiles.map((tile) => ({
					index: tile.index,
					y: tile.y,
					width: tile.width,
					height: tile.height,
					path: tile.path,
				})),
				url: browser.currentURI?.spec || null,
				title: browser.contentTitle || null,
				scale: finalScale,
				oversample,
				capture_scale: captureScale,
			};
		}
		if (!tiles.length) {
			throw new Error("No screenshot tiles were captured.");
		}
		let scalePxPerCss = tiles[0].width / Math.max(1, Number(plan.viewportWidth || tiles[0].width) || tiles[0].width);
		let estimatedHeightPx = Math.max(
			Math.ceil((Number(plan.documentHeight || plan.viewportHeight || 1) || 1) * scalePxPerCss),
			...tiles.map((tile) => Math.ceil(tile.y * scalePxPerCss) + tile.height)
		);
		let outputWidthPx = Math.max(1, Math.round(tiles[0].width * outputRatio));
		let outputHeightPx = Math.max(1, Math.round(estimatedHeightPx * outputRatio));
		let maxSegmentHeightPx = clamp(options.maxSegmentHeightPx || options.max_segment_height_px, 2000, 30000, 12000);
		if (forceSingleOutput) {
			maxSegmentHeightPx = maxSingleHeightPx;
		}
		let segmentCount = Math.max(1, Math.ceil(outputHeightPx / maxSegmentHeightPx));
		let loaded = [];
		for (let tile of tiles) {
			if (!tile.dataURL) {
				if (!tile.path) {
					throw new Error("Screenshot tile is missing both dataURL and file path.");
				}
				let bytes = await IOUtils.read(tile.path);
				tile.dataURL = "data:image/png;base64," + bytesToBase64(bytes);
			}
			let image = await loadImageFromDataURL(browser, tile.dataURL);
			loaded.push({
				yPx: Math.round(tile.y * scalePxPerCss),
				width: tile.width,
				height: tile.height,
				image,
			});
		}
		let segmentPaths = [];
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
			let segTop = segmentIndex * maxSegmentHeightPx;
			let segHeight = Math.min(maxSegmentHeightPx, outputHeightPx - segTop);
			let doc = browser.ownerDocument;
			let canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
			canvas.width = outputWidthPx;
			canvas.height = Math.max(1, segHeight);
			let ctx = canvas.getContext("2d");
			ctx.imageSmoothingEnabled = outputRatio != 1;
			if (ctx.imageSmoothingEnabled) {
				ctx.imageSmoothingQuality = "high";
			}
			for (let tile of loaded) {
				let tileTop = Math.round(tile.yPx * outputRatio);
				let tileBottom = tileTop + Math.max(1, Math.round(tile.height * outputRatio));
				let segBottom = segTop + segHeight;
				let overlapTop = Math.max(segTop, tileTop);
				let overlapBottom = Math.min(segBottom, tileBottom);
				if (overlapBottom <= overlapTop) {
					continue;
				}
				let srcY = Math.max(0, Math.round((overlapTop - tileTop) / outputRatio));
				let srcBottom = Math.min(tile.height, Math.round((overlapBottom - tileTop) / outputRatio));
				let srcH = Math.max(1, srcBottom - srcY);
				let dstY = overlapTop - segTop;
				let dstH = overlapBottom - overlapTop;
				ctx.drawImage(tile.image, 0, srcY, tile.width, srcH, 0, dstY, outputWidthPx, dstH);
			}
			let dataURL = canvas.toDataURL("image/png");
			let bytes = base64ToBytes(dataURL.split(",")[1]);
			let segmentPath = outputPath;
			if (segmentCount > 1) {
				segmentPath = PathUtils.join(outputDir, `${baseName}-part-${String(segmentIndex + 1).padStart(3, "0")}.png`);
			}
			await IOUtils.write(segmentPath, bytes);
			segmentPaths.push(segmentPath);
		}
		return {
			mode,
			path: segmentPaths[0] || outputPath,
			paths: segmentPaths,
			tile_dir: tileDir,
			manifest_path: manifestPath,
			tile_count: tiles.length,
			segments: segmentPaths.length,
			estimated_width: outputWidthPx,
			estimated_height: outputHeightPx,
			url: browser.currentURI?.spec || null,
			title: browser.contentTitle || null,
			scale: finalScale,
			oversample,
			capture_scale: captureScale,
		};
	}

	async function takeScreenshot(options = {}) {
		let browser = getBrowserOrThrow(options);
		let timeoutMs = Number(options.timeoutMs || options.timeout_ms || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
		if (options.waitForLoad !== false && options.wait_for_load !== false) {
			try {
				await waitForPage(browser, timeoutMs);
			}
			catch (_error) {}
		}
		if (parseBool(options.handleCookies ?? options.handle_cookies, false)) {
			await handleCookieBanners(Object.assign({}, options, { wait_for_load: false })).catch(() => null);
		}
		if (parseBool(options.waitForRenderable ?? options.wait_for_renderable, false)) {
			await waitForRenderablePage(Object.assign({}, options, { timeout_ms: parseOptionalInt(options.renderWaitMs || options.render_wait_ms) || 12000 })).catch(() => null);
		}
		let mode = optionalString(options.mode || "viewport").toLowerCase();
		if (["fullpage", "fullpage_stitched", "stitched", "full"].includes(mode)) {
			return await captureFullPage(browser, options, "fullpage_stitched");
		}
		if (["fullpage_tiles", "tiles", "tiled"].includes(mode)) {
			return await captureFullPage(browser, options, "fullpage_tiles");
		}
		return await captureViewportScreenshot(browser, options);
	}

	return {
		listViewerWindows,
		focusViewerWindow,
		closeViewerWindow,
		closeAllViewerWindows,
		openURL,
		navigate,
		waitForBrowser,
		getState,
		getSummary,
		getContentStats,
		listActions,
		clickElement,
		typeIntoElement,
		selectElement,
		scrollPage,
		waitForRenderablePage,
		handleCookieBanners,
		serializeCurrentPage,
		extractPageContent,
		takeScreenshot,
		getBrowserOrThrow,
		tempScreenshotDir,
		sanitizeFilenamePart,
	};
})();
