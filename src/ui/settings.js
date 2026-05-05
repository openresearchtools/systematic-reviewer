function mapStatusTone(tone = "") {
	if (tone == "ready") {
		return "is-ready";
	}
	if (tone == "error") {
		return "is-error";
	}
	return "";
}

function createSettingsService(ctx) {
	return {
		getPreferencePanePayload: async () => await ctx.invoke("settings.getBootstrap"),
		savePreferencePaneSettings: async (payload = {}) => await ctx.invoke("settings.save", payload || {}),
		scanPreferencePaneEndpoints: async (payload = {}) => await ctx.invoke("settings.scan", payload || {}),
		testPreferencePaneRuntimeRole: async (roleID = "", payload = {}) =>
			await ctx.invoke("settings.runtimeRole.test", Object.assign({}, payload || {}, {
				role_id: String(roleID || "").trim(),
			})),
		testPreferencePaneMCPClient: async (server = {}, payload = {}) =>
			await ctx.invoke("settings.mcpClient.test", Object.assign({}, payload || {}, {
				server: server || {},
			})),
		revealPreferencePaneProject: async (projectID = "") =>
			await ctx.invoke("settings.project.reveal", {
				project_id: String(projectID || "").trim(),
			}),
		reconcilePreferencePaneProject: async (projectID = "") =>
			await ctx.invoke("settings.project.reconcile", {
				project_id: String(projectID || "").trim(),
			}),
		openPreferencePaneProject: async (projectID = "") =>
			await ctx.invoke("workflow.openTab", {
				project_id: String(projectID || "").trim(),
				tab_id: "automation",
			}),
		deletePreferencePaneProject: async (payload = {}) => await ctx.invoke("settings.project.delete", payload || {}),
		restartZotero: async () => await ctx.invoke("settings.restartZotero", {}),
	};
}

export function createSettingsTab(ctx) {
	const shared = window.SystematicReviewerSharedSettingsUI;
	if (!shared || typeof shared.createController != "function") {
		throw new Error("Systematic Reviewer settings controller is unavailable.");
	}
	const node = ctx.createNode("section", {
		className: "mw-tab-panel mw-tab-panel-settings is-shell-managed",
	});
	const controller = shared.createController({
		chromeMode: "external",
		service: createSettingsService(ctx),
		onStatus: (message = "", tone = "") => {
			ctx.setStatus(String(message || ""), mapStatusTone(tone));
		},
		onChromeChange: () => {
			ctx.requestChromeUpdate?.();
		},
		logError: (error) => {
			try {
				console.error(error);
			}
			catch (_err) {}
		},
		openURL: async (url = "") => {
			await ctx.invoke("workflow.openExternalURL", {
				url: String(url || "").trim(),
			});
		},
	});
	controller.init(node);
	return {
		node,
		refresh: async () => await controller.refresh(),
		save: async () => await controller.save(),
			scan: async () => await controller.scan(),
			getChromeState: () => controller.getChromeState(),
			setActiveSection: (tabID = "") => controller.setActiveSection(tabID),
			setPreviewPageTheme: (theme = "light") => controller.setPreviewPageTheme(theme),
			hasPendingChanges: () => controller.hasPendingChanges(),
		canDeactivate: async (reason = "") => await controller.canDeactivate(reason),
		destroy() {
			controller.destroy();
		},
	};
}
