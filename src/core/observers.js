var SystematicReviewerObservers = {
	_registerNotifierObserver() {
		if (this.notifierObserverID) {
			return;
		}
		let observer = {
			notify: (event, type) => {
				if (!["item", "collection-item", "collection"].includes(type)) {
					return;
				}
				if (!["add", "modify", "remove", "delete", "move", "refresh"].includes(event)) {
					return;
				}
				this._scheduleCurrentProjectRefresh();
			},
		};
		this.notifierObserverID = Zotero.Notifier.registerObserver(
			observer,
			["item", "collection-item", "collection"],
			"systematic-reviewer"
		);
	},

	_unregisterNotifierObserver() {
		if (!this.notifierObserverID) {
			return;
		}
		try {
			Zotero.Notifier.unregisterObserver(this.notifierObserverID);
		}
		catch (_err) {}
		this.notifierObserverID = null;
	},

	_registerUIFontObserver() {
		if (this.uiFontSizeObserverID || !Zotero?.Prefs?.registerObserver) {
			return;
		}
		this.uiFontSizeObserverID = Zotero.Prefs.registerObserver("fontSize", () => {
			this._refreshWorkflowBrowserAppearance();
		});
	},

	_unregisterUIFontObserver() {
		if (!this.uiFontSizeObserverID || !Zotero?.Prefs?.unregisterObserver) {
			this.uiFontSizeObserverID = null;
			return;
		}
		try {
			Zotero.Prefs.unregisterObserver(this.uiFontSizeObserverID);
		}
		catch (_error) {}
		this.uiFontSizeObserverID = null;
	},

	_registerSettingsOpenObserver() {
		if (this.settingsOpenObserver || typeof Services == "undefined" || !Services.obs?.addObserver) {
			return;
		}
		let topic = String(this.settingsOpenObserverTopic || "systematic-reviewer-open-settings-tab");
		let observer = {
			observe: (_subject, observedTopic) => {
				if (observedTopic != topic) {
					return;
				}
				let targetWin = this._primaryWindow();
				Promise.resolve(this._openWorkflowTab(targetWin, null, { activeTab: "settings" })).catch((error) => {
					this.log(`settings tab open observer failed: ${error}`);
					try {
						this._showError(error);
					}
					catch (_err) {}
				});
			},
		};
		Services.obs.addObserver(observer, topic);
		this.settingsOpenObserver = observer;
	},

	_unregisterSettingsOpenObserver() {
		if (!this.settingsOpenObserver || typeof Services == "undefined" || !Services.obs?.removeObserver) {
			this.settingsOpenObserver = null;
			return;
		}
		try {
			Services.obs.removeObserver(this.settingsOpenObserver, String(this.settingsOpenObserverTopic || "systematic-reviewer-open-settings-tab"));
		}
		catch (_error) {}
		this.settingsOpenObserver = null;
	},
};
