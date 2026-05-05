var SystematicReviewerPrefsServices = null;
try {
	SystematicReviewerPrefsServices = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
}
catch (_err) {}

var SystematicReviewerPrefsRedirect = {
	root: null,
	statusNode: null,
	boundButton: null,
	bootstrapped: false,

	init(rootNode = null) {
		let root = rootNode?.currentTarget || rootNode?.target || rootNode || this._getRoot();
		if (!root) {
			return false;
		}
		if (this.root === root && this.bootstrapped) {
			return true;
		}
		this.root = root;
		this.statusNode = root.querySelector("#sr-pref-legacy-status");
		let button = root.querySelector("#sr-pref-open-native-settings");
		if (button && button !== this.boundButton) {
			let handler = () => {
				this.openNativeSettings().catch((error) => {
					try {
						Zotero.logError(error);
					}
					catch (_err) {}
					this._setStatus(error?.message || String(error), "error");
				});
			};
			button.addEventListener("click", handler);
			button.addEventListener("command", handler);
			this.boundButton = button;
		}
		this.bootstrapped = true;
		return true;
	},

	_getRoot() {
		try {
			return window?.document?.getElementById("systematic-reviewer-preferences") || null;
		}
		catch (_err) {
			return null;
		}
	},

	_getPreferencesWindow() {
		try {
			return this.root?.ownerDocument?.defaultView || window || null;
		}
		catch (_err) {
			return null;
		}
	},

	_resolveMainWindow() {
		try {
			if (typeof Zotero?.getMainWindow == "function") {
				let win = Zotero.getMainWindow();
				if (win && !win.closed && win.document?.documentElement?.id == "main-window") {
					return win;
				}
			}
		}
		catch (_err) {}
		try {
			let win = SystematicReviewerPrefsServices?.wm?.getMostRecentWindow?.("navigator:browser") || null;
			if (win && !win.closed && win.document?.documentElement?.id == "main-window") {
				return win;
			}
		}
		catch (_err) {}
		try {
			let opener = this._getPreferencesWindow()?.opener || null;
			if (opener && !opener.closed && opener.document?.documentElement?.id == "main-window") {
				return opener;
			}
		}
		catch (_err) {}
		return null;
	},

	_resolveReviewerService() {
		let mainWin = this._resolveMainWindow();
		let mainService = mainWin?.Zotero?.SystematicReviewer || null;
		if (mainService?._openWorkflowTab) {
			return { service: mainService, mainWin };
		}
		return { service: null, mainWin };
	},

	async _openViaMainWindowBridge(mainWin) {
		let bridge = mainWin?.SystematicReviewerWindowBridge || null;
		if (!bridge?.openSettingsTab) {
			return false;
		}
		await new Promise((resolve, reject) => {
			try {
				mainWin.setTimeout(() => {
					Promise.resolve(bridge.openSettingsTab())
						.then(resolve, reject);
				}, 0);
			}
			catch (error) {
				reject(error);
			}
		});
		return true;
	},

	_notifyOpenSettingsObserver() {
		try {
			if (!SystematicReviewerPrefsServices?.obs?.notifyObservers) {
				return false;
			}
			SystematicReviewerPrefsServices.obs.notifyObservers(null, "systematic-reviewer-open-settings-tab", "");
			return true;
		}
		catch (_err) {
			return false;
		}
	},

	_setStatus(message = "", tone = "") {
		if (!this.statusNode) {
			return;
		}
		this.statusNode.textContent = String(message || "");
		this.statusNode.classList.remove("ready", "error");
		if (tone) {
			this.statusNode.classList.add(tone);
		}
	},

	async openNativeSettings() {
		let resolved = this._resolveReviewerService();
		let service = resolved?.service || null;
		let mainWin = resolved?.mainWin || null;
		let opened = false;
		this._setStatus("Opening native Settings tab.");
		if (mainWin && await this._openViaMainWindowBridge(mainWin).catch(() => false)) {
			opened = true;
		}
		else if (service?._openWorkflowTab && mainWin) {
			await service._openWorkflowTab(mainWin, null, { activeTab: "settings" });
			opened = true;
		}
		else if (this._notifyOpenSettingsObserver()) {
			opened = true;
			if (!mainWin) {
				mainWin = this._resolveMainWindow();
			}
		}
		if (!opened) {
			throw new Error("Systematic Reviewer settings are not available.");
		}
		try {
			mainWin.focus();
		}
		catch (_err) {}
		this._setStatus("Opened Settings - Systematic Reviewer.", "ready");
		let prefsWin = this._getPreferencesWindow();
		if (prefsWin && prefsWin !== mainWin && typeof prefsWin.close == "function") {
			prefsWin.setTimeout(() => {
				try {
					prefsWin.close();
				}
				catch (_err) {}
			}, 0);
		}
	},
};

if (typeof window != "undefined") {
	window.SystematicReviewerPrefsRedirect = SystematicReviewerPrefsRedirect;
	let boot = () => {
		try {
			let root = window.document?.getElementById("systematic-reviewer-preferences");
			if (root) {
				SystematicReviewerPrefsRedirect.init(root);
				return true;
			}
		}
		catch (_err) {}
		return false;
	};
	let bootstrapWhenShown = (event) => {
		let target = event?.target || null;
		if (target?.id == "systematic-reviewer-preferences") {
			SystematicReviewerPrefsRedirect.init(target);
		}
	};
	window.document?.addEventListener?.("showing", bootstrapWhenShown, true);
	window.document?.addEventListener?.("action", () => {
		window.setTimeout(boot, 0);
	}, true);
	window.setTimeout(boot, 0);
}
