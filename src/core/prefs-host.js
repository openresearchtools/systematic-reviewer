var SystematicReviewerPrefsHost = {
	async _registerPreferencePane() {
		if (this.preferencePaneID || !Zotero.PreferencePanes?.register) {
			return;
		}
		this.preferencePaneID = await Zotero.PreferencePanes.register({
			pluginID: this.id,
			src: "ui/prefs/prefs.xhtml",
			id: "systematic-reviewer-prefpane",
			label: "Systematic Reviewer",
			scripts: ["ui/prefs/pane.js"],
			stylesheets: ["ui/prefs/prefs.css"],
		});
	},

	_unregisterPreferencePane() {
		if (!this.preferencePaneID || !Zotero.PreferencePanes?.unregister) {
			this.preferencePaneID = null;
			return;
		}
		try {
			Zotero.PreferencePanes.unregister(this.preferencePaneID);
		}
		catch (_err) {}
		this.preferencePaneID = null;
	},
};

