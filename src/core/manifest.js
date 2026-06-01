var SystematicReviewerWorkflowManifest = (() => {
	const TAB_DEFINITIONS = Object.freeze([
		{
			id: "settings",
			label: "Settings",
			order: 100,
			placement: "action",
			requires_project: false,
			source: {
				browserUI: "ui/settings.js",
				hostWindow: "shared workflow browser host",
			},
			storage: "global_settings",
			commandFamilies: ["settings"],
			notes: [
				"Port the Zotero preferences experience into the native workflow browser surface.",
				"Reuse the existing backend settings, scan, test, and project-management logic without changing storage.",
				"Expose Settings from the topbar action area rather than the project tab strip.",
			],
		},
			{
				id: "automation",
				label: "Writer",
				order: 0,
			source: {
				browserUI: "ui/automation.js",
				hostWindow: "shared workflow browser host",
			},
			storage: "project_root",
			commandFamilies: ["automation"],
			notes: [
				"Browser-backed replacement for the old native workspace/editor/chat surface.",
				"Keep backend session, citation, export, and file logic in the privileged plugin runtime.",
				"UI must lazy-load and avoid holding duplicate document state in Zotero chrome and browser content.",
			],
		},
		{
			id: "harvest",
			label: "Harvest",
			order: 10,
			source: {
				liteUI: "static/index.html#harvest-section",
				liteLogic: "static/main.js",
				liteBackend: ["app/web_app.py:start_harvest", "app/harvest_service.py"],
			},
			storage: "zotero_collection",
			commandFamilies: ["harvest"],
			notes: [
				"Import supported OpenAlex identifiers into Harvest/OpenAlex, then merge sources into Pending with exact-ID deduplication.",
				"Do not wire harvest rows into the project SQLite schema.",
				"Use OpenAlex API key from plugin settings when present.",
				"Use DOI -> PMID -> arXiv -> ISBN -> PMCID-to-PMID priority for Zotero ingest.",
			],
		},
		{
			id: "embeddings",
			label: "Embeddings",
			order: 20,
			source: {
				liteUI: "static/index.html#embeddings-section",
				liteLogic: "static/main.js",
				liteBackend: ["app/web_app.py:start_embedding", "app/embedding_service.py"],
			},
			storage: "sqlite_blob",
			commandFamilies: ["embeddings"],
			notes: [
				"Store embeddings in project SQLite blobs.",
				"Full Text uses preferred V.md then F.md markdown attachments and stores chunk vectors in document_chunks and chunk_vectors.",
				"Use plugin-managed runtime roles and model settings.",
				"Do not reuse lite model manager flows.",
			],
		},
		{
			id: "semantic",
			label: "Semantic Search",
			order: 30,
			source: {
				liteUI: "static/index.html#semantic-section",
				liteLogic: "static/main.js",
				liteBackend: ["screening and embedding search paths through app/web_app.py"],
			},
			storage: "sqlite_project",
			commandFamilies: ["semantic"],
			notes: [
				"Run brute-force cosine similarity over stored embedding blobs.",
				"Full Text search writes both a numeric score column and a chunk-text companion column into Screening.",
				"Use the current Embeddings model from plugin settings.",
				"Persist one screening score column per semantic search.",
			],
		},
		{
			id: "extraction",
			label: "Extraction",
			order: 40,
			source: {
				liteUI: "static/index.html#extraction-section",
				liteLogic: "static/main.js",
				liteBackend: [
					"app/web_app.py:get_extraction_template",
					"app/web_app.py:list_extraction_templates",
					"app/web_app.py:save_extraction_template",
					"app/web_app.py:create_extraction_template",
					"app/web_app.py:start_llm_extraction",
					"app/web_app.py:start_single_llm_extraction",
				],
			},
			storage: "sqlite_project",
			commandFamilies: ["extraction"],
			notes: [
				"Keep template builder UX strong, but restyle it to match Zotero.",
				"Separate UI rendering from extraction core logic.",
				"Use plugin runtime settings rather than lite settings plumbing.",
			],
		},
		{
			id: "screening",
			label: "Screening",
			order: 50,
			source: {
				liteUI: "static/index.html#screening-beta-section",
				liteLogic: "static/main.js",
				liteBackend: ["app/screening_service.py", "screening endpoints in app/web_app.py"],
			},
			storage: "sqlite_project",
			commandFamilies: ["screening"],
			notes: [
				"Use one screening decision flow.",
				"Do not preserve the old initial-vs-final split.",
				"Operate directly on the current collection project instead of sync loops.",
				"Use native Zotero item and PDF attachment actions instead of external fulltext upload flows.",
			],
		},
		{
			id: "prisma",
			label: "PRISMA",
			order: 60,
			source: {
				liteUI: "static/index.html#prisma-section",
				liteLogic: "static/prisma.js",
				liteBackend: ["app/prisma_service.py", "prisma endpoints in app/web_app.py"],
			},
			storage: "sqlite_project",
			commandFamilies: ["prisma"],
			notes: [
				"Use Zotero-native export paths where practical.",
				"Keep state and rendering native to the plugin.",
			],
		},
	]);

	const COMMAND_DEFINITIONS = Object.freeze([
		{ id: "automation.getBootstrap", tab: "automation" },
		{ id: "settings.getBootstrap", tab: "settings" },
		{ id: "settings.save", tab: "settings" },
		{ id: "settings.scan", tab: "settings" },
		{ id: "settings.runtimeRole.test", tab: "settings" },
		{ id: "settings.project.reveal", tab: "settings" },
		{ id: "settings.project.reconcile", tab: "settings" },
		{ id: "settings.project.delete", tab: "settings" },
		{ id: "automation.project.switch", tab: "automation" },
		{ id: "automation.session.new", tab: "automation" },
		{ id: "automation.session.switch", tab: "automation" },
		{ id: "automation.chat.send", tab: "automation" },
			{ id: "automation.jobs.open", tab: "automation" },
			{ id: "automation.document.render", tab: "automation" },
			{ id: "automation.document.save", tab: "automation" },
			{ id: "automation.document.log.read", tab: "automation" },
			{ id: "automation.document.memory.read", tab: "automation" },
			{ id: "automation.document.rollback.list", tab: "automation" },
		{ id: "automation.document.rollback.diff", tab: "automation" },
		{ id: "automation.document.rollback.restore", tab: "automation" },
		{ id: "automation.document.editorSettings.save", tab: "automation" },
		{ id: "automation.document.exportPdf", tab: "automation" },
		{ id: "automation.document.exportPdf.saveAs", tab: "automation" },
		{ id: "automation.document.exportPlainMarkdown", tab: "automation" },
		{ id: "automation.document.exportPlainMarkdown.saveAs", tab: "automation" },
		{ id: "automation.document.importImage", tab: "automation" },
		{ id: "automation.citation.catalog", tab: "automation" },
		{ id: "automation.citation.preview", tab: "automation" },
		{ id: "harvest.getConfig", tab: "harvest" },
		{ id: "harvest.getRateLimit", tab: "harvest" },
		{ id: "harvest.run", tab: "harvest" },
		{ id: "harvest.estimate", tab: "harvest" },
		{ id: "harvest.listOutputs", tab: "harvest" },
		{ id: "harvest.listRuns", tab: "harvest" },
		{ id: "harvest.readOutput", tab: "harvest" },
		{ id: "embeddings.listSources", tab: "embeddings" },
		{ id: "embeddings.listStored", tab: "embeddings" },
		{ id: "embeddings.run", tab: "embeddings" },
		{ id: "embeddings.refresh", tab: "embeddings" },
		{ id: "semantic.getConfig", tab: "semantic" },
		{ id: "semantic.search", tab: "semantic" },
		{ id: "semantic.previewItem", tab: "semantic" },
		{ id: "semantic.hit.open", tab: "semantic" },
		{ id: "documents.getConfig", tab: "automation" },
		{ id: "documents.find", tab: "automation" },
		{ id: "documents.find_next", tab: "automation" },
		{ id: "documents.hit.open", tab: "automation" },
		{ id: "project_data.schema", tab: "automation" },
		{ id: "project_data.rows", tab: "automation" },
		{ id: "project_data.row", tab: "automation" },
		{ id: "items.create", tab: "automation" },
		{ id: "items.create_many", tab: "automation" },
		{ id: "items.read_metadata", tab: "automation" },
		{ id: "items.write_metadata", tab: "automation" },
		{ id: "items.write_metadata_many", tab: "automation" },
		{ id: "items.update_metadata", tab: "automation" },
		{ id: "items.update_metadata_many", tab: "automation" },
		{ id: "items.import_identifiers", tab: "automation" },
		{ id: "extraction.templates.list", tab: "extraction" },
		{ id: "extraction.templates.load", tab: "extraction" },
		{ id: "extraction.templates.save", tab: "extraction" },
		{ id: "extraction.templates.create", tab: "extraction" },
		{ id: "extraction.templates.export", tab: "extraction" },
		{ id: "extraction.templates.import", tab: "extraction" },
		{ id: "extraction.sources.list", tab: "extraction" },
		{ id: "extraction.results.list", tab: "extraction" },
		{ id: "extraction.run", tab: "extraction" },
		{ id: "extraction.runSingle", tab: "extraction" },
		{ id: "extraction.updateFields", tab: "extraction" },
		{ id: "screening.list", tab: "screening" },
		{ id: "screening.search", tab: "screening" },
		{ id: "descriptives.run", tab: "screening" },
		{ id: "descriptives.runs.list", tab: "screening" },
		{ id: "descriptives.run.load", tab: "screening" },
		{ id: "screening.exportCsv", tab: "screening" },
		{ id: "screening.item.open", tab: "screening" },
		{ id: "screening.pdf.open", tab: "screening" },
		{ id: "screening.fulltext.open", tab: "screening" },
		{ id: "screening.runs.list", tab: "screening" },
		{ id: "screening.runs.load", tab: "screening" },
		{ id: "screening.runs.compare", tab: "screening" },
		{ id: "screening.filters.list", tab: "screening" },
		{ id: "screening.filters.materialize", tab: "screening" },
		{ id: "screening.filters.delete", tab: "screening" },
		{ id: "screening.update", tab: "screening" },
		{ id: "screening.bulkRun", tab: "screening" },
		{ id: "screening.saveEdits", tab: "screening" },
		{ id: "screening.columns.create", tab: "screening" },
		{ id: "screening.comments.update", tab: "screening" },
		{ id: "screening.rules.recompute", tab: "screening" },
		{ id: "screening.rules.update", tab: "screening" },
		{ id: "prisma.getState", tab: "prisma" },
		{ id: "prisma.saveState", tab: "prisma" },
		{ id: "prisma.compute", tab: "prisma" },
		{ id: "prisma.render", tab: "prisma" },
		{ id: "prisma.savePng", tab: "prisma" },
		{ id: "prisma.export", tab: "prisma" },
		{ id: "jobs.list", tab: "automation" },
		{ id: "jobs.load", tab: "automation" },
		{ id: "explore.getConfig", tab: "automation" },
		{ id: "explore.columns.list", tab: "automation" },
		{ id: "explore.citations.suggest", tab: "automation" },
		{ id: "explore.query", tab: "automation" },
		{ id: "explore.tables.saveCsv", tab: "automation" },
		{ id: "explore.exportCsv", tab: "automation" },
		{ id: "explore.chats.list", tab: "automation" },
		{ id: "explore.chats.create", tab: "automation" },
		{ id: "explore.chats.load", tab: "automation" },
		{ id: "explore.chats.run", tab: "automation" },
		{ id: "explore.runs.list", tab: "automation" },
		{ id: "explore.runs.load", tab: "automation" },
		{ id: "explore.snapshot", tab: "automation" },
		{ id: "explore.session.load", tab: "automation" },
		{ id: "explore.job.load", tab: "automation" },
	]);

	function normalizeProjectType(value) {
		let raw = String(value || "").trim().toLowerCase();
		if (["custom", "custom_analysis", "custom-analysis", "analysis"].includes(raw)) {
			return "custom_analysis";
		}
		return "systematic_review";
	}

	function isTabEnabled(tabID, projectType = "systematic_review", options = {}) {
		let normalizedType = normalizeProjectType(projectType);
		let id = String(tabID || "").trim();
		let embeddingsAvailable = options?.embeddings_available !== false;
		if (!id) {
			return false;
		}
		if (id == "settings") {
			return true;
		}
		if (id == "prisma") {
			return false;
		}
		if (normalizedType == "custom_analysis" && ["harvest", "prisma"].includes(id)) {
			return false;
		}
		if (!embeddingsAvailable && ["embeddings", "semantic"].includes(id)) {
			return false;
		}
		return TAB_DEFINITIONS.some((tab) => tab.id == id);
	}

	function isCommandTabAvailable(tabID, projectType = "systematic_review", options = {}) {
		let normalizedType = normalizeProjectType(projectType);
		let id = String(tabID || "").trim();
		let embeddingsAvailable = options?.embeddings_available !== false;
		if (!id) {
			return false;
		}
		if (id == "settings") {
			return true;
		}
		if (normalizedType == "custom_analysis" && ["harvest", "prisma"].includes(id)) {
			return false;
		}
		if (!embeddingsAvailable && ["embeddings", "semantic"].includes(id)) {
			return false;
		}
		return TAB_DEFINITIONS.some((tab) => tab.id == id);
	}

	function getViewDefinition(tabID = "") {
		let id = String(tabID || "").trim();
		let hit = TAB_DEFINITIONS.find((tab) => tab.id == id) || null;
		return hit ? Object.assign({}, hit) : null;
	}

	function listTabs(projectType = "systematic_review", options = {}) {
		let normalizedType = normalizeProjectType(projectType);
		return TAB_DEFINITIONS
			.filter((tab) => tab.placement != "action")
			.filter((tab) => isTabEnabled(tab.id, normalizedType, options || {}))
			.slice()
			.sort((a, b) => a.order - b.order)
			.map((tab) => Object.assign({}, tab));
	}

	function listCommandsForTab(tabID) {
		let id = String(tabID || "").trim();
		return COMMAND_DEFINITIONS
			.filter((command) => command.tab == id)
			.map((command) => Object.assign({}, command));
	}

	return {
		TAB_DEFINITIONS,
		COMMAND_DEFINITIONS,
		isTabEnabled,
		isCommandTabAvailable,
		getViewDefinition,
		listTabs,
		listCommandsForTab,
	};
})();
