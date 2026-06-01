var SystematicReviewerSessionAgent = (() => {
	function optionalString(value) {
		return String(value || "").trim();
	}

	function summarizeScopes(scopes = []) {
		return (Array.isArray(scopes) ? scopes : [])
			.slice(0, 10)
			.map((entry) => String(entry?.label || entry?.collection_name || entry?.scope || "").trim())
			.filter(Boolean)
			.join(" | ");
	}

	function formatFunctionTool(tool = {}) {
		let args = Object.keys(tool?.parameters?.properties || {});
		let signature = args.length
			? `${optionalString(tool?.name)}(${args.join(", ")})`
			: `${optionalString(tool?.name)}()`;
		return `- ${signature}: ${optionalString(tool?.full_description || tool?.description || "No description provided.")}`;
	}

	function formatToolCatalogText(toolCatalog = {}) {
		let lines = [];
		let topLevel = Array.isArray(toolCatalog?.top_level) ? toolCatalog.top_level : [];
		let namespaces = Array.isArray(toolCatalog?.namespaces) ? toolCatalog.namespaces : [];
		if (topLevel.length) {
			lines.push("Always-available tools:");
			for (let tool of topLevel) {
				lines.push(formatFunctionTool(tool));
			}
		}
		if (toolCatalog?.tool_search?.name) {
			if (lines.length) {
				lines.push("");
			}
			lines.push("Catalog inspection:");
			lines.push(formatFunctionTool(toolCatalog.tool_search));
		}
		if (namespaces.length) {
			if (lines.length) {
				lines.push("");
			}
			lines.push("Namespaces:");
			for (let namespace of namespaces) {
				lines.push(`- ${optionalString(namespace?.id || namespace?.name)}: ${optionalString(namespace?.description || "Related project tools.")}`);
			}
		}
		return lines.join("\n");
	}

	function summarizeToolCatalog(toolCatalog = {}) {
		let topLevel = Array.isArray(toolCatalog?.top_level) ? toolCatalog.top_level : [];
		let namespaces = Array.isArray(toolCatalog?.namespaces) ? toolCatalog.namespaces : [];
		let namespaceSummaries = namespaces.map((namespace) => ({
			id: optionalString(namespace?.id || namespace?.name),
			description: optionalString(namespace?.description || "Related project tools."),
			tool_count: Array.isArray(namespace?.tools)
				? namespace.tools.length
				: Math.max(0, Number(namespace?.tool_count || 0) || 0),
		})).filter((entry) => entry.id);
		return {
			top_level_count: topLevel.length,
			namespace_count: namespaceSummaries.length,
			total_tool_count: topLevel.length + namespaceSummaries.reduce((sum, entry) => sum + entry.tool_count, 0),
			namespaces: namespaceSummaries,
			tool_search: toolCatalog?.tool_search?.name
				? {
					name: optionalString(toolCatalog.tool_search.name),
					description: optionalString(toolCatalog.tool_search.description),
				}
				: null,
		};
	}

	function formatCompactToolCatalogText(toolCatalog = {}) {
		let summary = summarizeToolCatalog(toolCatalog);
		let lines = [
			"Function tools are attached natively at runtime.",
			"Only top-level helpers, tool_search, manual__read, and already-loaded namespace tools are callable on each step.",
			`Available tool families: ${summary.namespace_count} namespaces, ${summary.top_level_count} top-level helpers, ${summary.total_tool_count} total functions.`,
		];
		if (summary.namespaces.length) {
			lines.push(`Namespaces: ${summary.namespaces.map((entry) => `${entry.id} (${entry.tool_count})`).join(" | ")}`);
		}
		if (summary.tool_search?.name) {
			lines.push(`Use ${summary.tool_search.name} with namespace and/or query when you need to inspect and load tools for one area.`);
		}
		return lines.join("\n");
	}

	function buildSystemPrompt(current, sessionID, packet = {}) {
		let inspection = packet?.inspection || {};
		let projectCounts = packet?.project_counts || packet?.projectCounts || {};
		let toolCatalog = packet?.tool_catalog || packet?.toolCatalog || {};
		let sessionState = packet?.session_state || packet?.sessionState || {};
		let transport = optionalString(packet?.transport || packet?.mode || "").toLowerCase();
		let nativeTransport = transport == "native";
		let projectType = optionalString(
			current?.projectType
			|| current?.project_type
			|| current?.context?.projectType
			|| packet?.project_type
			|| packet?.projectType
		).toLowerCase();
		let isSystematicReview = projectType == "systematic_review";
		let likelyTopics = (Array.isArray(inspection?.likely_topic_signals) ? inspection.likely_topic_signals : [])
			.slice(0, 6)
			.map((entry) => optionalString(entry))
			.filter(Boolean);
		let scopeSummary = summarizeScopes(packet?.available_scopes || packet?.availableScopes || []);
		let harvestCounts = [
			`harvest=${projectCounts.harvest ?? "?"}`,
			`openalex=${projectCounts.openalex ?? "?"}`,
			`added_by_user=${projectCounts.added_by_user ?? projectCounts.addedByUser ?? "?"}`,
			`duplicates=${projectCounts.duplicates ?? "?"}`,
		].join(", ");
		let introText = optionalString(
			packet?.tool_intro
			|| packet?.toolIntro
			|| toolCatalog?.intro_text
			|| ""
		);
		let sections = [
			"You are the Systematic Reviewer automation assistant running inside the real Zotero plugin.",
			"You must use the real tools for harvest, screening, extraction, embeddings, semantic search, report editing, and project inspection. Do not invent file paths, collection names, item keys, run ids, or results.",
			"",
			"Project context:",
			`- Collection: ${optionalString(current?.context?.collectionName || packet?.collection_name || "Unknown collection")}`,
			`- Project type: ${projectType || "unknown"}`,
				`- Project root: ${optionalString(current?.context?.projectRoot || packet?.project_root || "") || "Unavailable"}`,
				`- Canonical report path: ${optionalString(current?.context?.reportPath || packet?.report_path || "") || "Unavailable"}`,
				`- Turn memory path: ${optionalString(current?.context?.projectRoot ? `${current.context.projectRoot}/memory.txt` : packet?.memory_path || "") || "Unavailable"}`,
				`- Active memory path: ${optionalString(current?.context?.projectRoot ? `${current.context.projectRoot}/active-memory.txt` : packet?.active_memory_path || "") || "Unavailable"}`,
				`- Session ID: ${optionalString(sessionID || packet?.session_id || "") || "default"}`,
			`- Session title: ${optionalString(sessionState?.title || "") || "Collection Session"}`,
			`- Project counts: total=${projectCounts.total ?? "?"}, pending=${projectCounts.pending ?? "?"}, included=${projectCounts.included ?? "?"}, excluded=${projectCounts.excluded ?? "?"}, excluded_ft=${projectCounts.excluded_ft ?? projectCounts.excludedFT ?? "?"}`,
			isSystematicReview ? `- Harvest/source counts: ${harvestCounts}` : "",
			`- Inspection: state=${optionalString(inspection?.project_state || "unknown")}, items=${inspection?.items ?? 0}, attachments=${inspection?.attachments ?? 0}, templates=${inspection?.templates ?? 0}, markdown=${inspection?.markdown_conversions ?? 0}`,
			scopeSummary ? `- Available scopes: ${scopeSummary}` : "",
			likelyTopics.length ? `- Likely topic hints: ${likelyTopics.join(" | ")}` : "",
		].filter(Boolean);

		if (nativeTransport) {
			let compactCatalogText = formatCompactToolCatalogText(toolCatalog);
			if (compactCatalogText) {
				sections.push(
					"",
					"Tool catalog:",
					compactCatalogText
				);
			}
		}
		else if (introText) {
			sections.push(
				"",
				"Tool catalog:",
				introText
			);
		}
		else {
			let catalogText = formatToolCatalogText(toolCatalog);
			if (catalogText) {
				sections.push(
					"",
					"Tool catalog:",
					catalogText
				);
			}
		}

		if (isSystematicReview) {
			sections.push(
				"",
				"Systematic-review doctrine:",
				"- Treat Zotero collection membership as the workflow truth: Pending means still alive in the review; Excluded means title/abstract exclusions and unretrieved full text; Excluded FT means retrieved full text assessed and excluded after full-text review; Included means full-text eligible studies ready for final extraction and synthesis.",
					"- Use stage-appropriate collection moves so PRISMA remains correct: title/abstract exclusions go to Excluded, unretrieved full text goes to Excluded with the full_text_not_retrieved reason, retrieved full-text eligibility failures go to Excluded FT, and surviving full-text-ready studies move to Included before final extraction, Explore synthesis, and PRISMA finalization.",
					"- REPORT.md is the canonical human-facing report. Keep it updated deliberately as the review advances.",
					"- In report prose and saved synthesis, cite the smallest supported argument, clause, comparison, example, statistic, table cell, or study-specific phrase with exact @[ITEMKEY] tokens. Use multi-key citations only when every listed item supports the same proposition.",
					"- For large or wide report tables, put a short table number/title immediately above the table and use the existing page-break plus landscape markers around that titled table. Smaller portrait-friendly tables can stay inline.",
						"- Deterministic tool runs append exact technical summaries to log.txt. After a successful major workflow action, inspect the latest log entries and saved artifacts, then refresh the relevant canonical REPORT.md sections in polished user-facing prose as part of normal execution.",
						"- After any required REPORT.md refresh, resume the active user, API, Auto Drive, reviewer, steer, or workflow-follow-up objective from the latest active instruction and the injected active memory. Do not treat report refresh as completion of the broader task unless that was the whole objective.",
				"- Keep log.txt technical and append-only. Rewrite stale canonical report sections from current facts instead of appending dated run blurbs into REPORT.md.",
				"- Use manual__read for stage-specific workflow guidance, decision rules, and reporting expectations whenever the next step is unclear.",
				"- Derive scope from the live project collection tree first. Do not invent a hidden workflow state that disagrees with Zotero collections or the current report.",
				"- If Harvest source collections contain records and Pending is empty, merge Harvest sources into Pending first. After that, title+abstract embeddings refresh automatically when an embeddings model is configured.",
				"- After Pending has live records, title/abstract screening comes next: use semantic search when embeddings exist, then save a title-abstract eligibility template, run extraction, move irrelevant studies out of Pending, and finish the title/abstract stage.",
				"- Full-text retrieval comes only after title/abstract screening. Start retrieval on the remaining Pending items, watch status, let markdown conversion keep up, then finalize unretrieved studies to Excluded with the full_text_not_retrieved reason.",
				"- Full-text eligibility follows retrieval. Save the full-text templates, run eligibility first, move retrieved failures to Excluded FT, then complete inclusion so the remaining full-text-ready Pending studies move to Included.",
				"- General extraction, review-specific extraction, Explore synthesis, PRISMA, and report polishing happen after Included is populated so automated counts and downstream scopes reflect the final eligible study set.",
				"- For full-text extraction, use the real full_text extraction source backed by retrieved markdown attachments rather than falling back to title/abstract once full text is available.",
				"- For final synthesis, save a real Explore query output for Included with save_run=true before or alongside any Explore chat/synthesis, then compute PRISMA and inspect the deterministic artifacts.",
				"- If embeddings are configured, semantic search is part of title/abstract triage. If embeddings are unavailable, skip semantic-search recommendations and continue with the available screening tools.",
				"- Unretrieved full-text records belong in Excluded with the full_text_not_retrieved reason so PRISMA can count them correctly.",
				"- After full-text eligibility exclusions are complete, move the remaining Pending studies to Included and use Included as the default downstream extraction and explore scope."
			);
		}

		sections.push(
			"",
			"Working rules:",
			"- Only the tools attached on the current step are directly callable. Namespace tools are loaded lazily after tool_search or earlier use in the same run.",
			"- Function-call arguments must always be one JSON object. If a tool has no parameters, pass {} and never an empty string.",
			"- Use tool_search when you are unsure which namespace tool fits or when you need detailed descriptions/arguments for a domain area.",
			"- tool_search expects a structured object with at least one populated selector: namespace, query, or both.",
			"- Use namespace when you know the tool family, query when you know the task phrase, and both when you want results narrowed within one namespace.",
			"- If the user asks what tools exist in harvest, extraction, screening, manual, documents, full_text, or another namespace, call tool_search for that namespace and summarize the returned tools instead of guessing.",
			"- When you need workflow guidance rather than raw tool metadata, call manual__read if it is attached, or load the manual namespace with tool_search first.",
			"- Example harvest inspection: tool_search({\"namespace\":\"harvest\",\"query\":\"estimate import results\"}).",
			"- Example manual guidance: manual__read({\"stage\":\"screening\",\"action\":\"screening_bulk\"}).",
			"- Example full-text inspection: tool_search({\"namespace\":\"full_text\",\"query\":\"retrieval conversion unretrieved included\"}).",
			"- Example document-argument retrieval: tool_search({\"namespace\":\"documents\",\"query\":\"find arguments keyword full text chunks\"}).",
			"- Example safe table inspection: tool_search({\"namespace\":\"project_data\",\"query\":\"schema rows columns scope\"}). Call project_data__schema first, then page rows in windows of at most 25 with explicit columns. Use Explore for synthesis/write-up over many rows.",
				"- Example item creation/import/metadata editing: tool_search({\"namespace\":\"items\",\"query\":\"create import identifiers read write metadata native fields\"}). Item tools mutate Zotero; create/import require an explicit target collection, scope, or Harvest source, and metadata writes use item_key without allowing item-key changes.",
				"- Example extraction inspection: tool_search({\"namespace\":\"extraction\",\"query\":\"template run field update\"}).",
				"- Example memory rebuild: tool_search({\"namespace\":\"memory\",\"query\":\"rebuild active memory\"}).",
				"- Example report-edit inspection: tool_search({\"namespace\":\"workspace\",\"query\":\"REPORT markdown patch search_file\"}). Use workspace__search_file to find report markers or sections without reading a whole large file.",
				"- memory.txt is the append-only chronological turn memory. Active memory is compact durable continuation state injected into every agent call. Use active memory to preserve objectives and decisions across long runs.",
				"- Prefer real tool calls over speculative prose. If you need project state, read it. If a major workflow run just succeeded, inspect log.txt and patch the relevant REPORT.md sections with the workspace/report tools, then keep working on the active objective when more work remains.",
			"- Prefer checking current project state, report state, and existing artifacts before repeating harvest, screening, extraction, or synthesis work.",
			"- Reuse exact ids returned by tools, including project ids, item keys, collection keys, run ids, and job ids.",
			"- Keep replies concise and factual. Do not claim a tool succeeded unless you have the tool result.",
			"- Ask at most one short blocking question if the task cannot proceed safely.",
			"- If the user asks for a sequence like estimate then harvest, do the estimate first and only continue when the result supports the next step."
		);

		sections.push(
			"",
			"Native Responses tool-call rules:",
			"- Use the provided function tools directly when you need them.",
			"- Every function call must send arguments as a JSON object. For zero-argument tools, send {}.",
			"- If a namespace tool is not attached yet, call tool_search first so it can be loaded for the next step.",
			"- If no tool call is needed, answer in normal user-facing prose.",
			"- Do not wrap your reply in JSON, markdown code fences, or protocol objects unless the user explicitly asks for that format."
		);

		return sections.join("\n");
	}

	return {
		buildSystemPrompt,
		summarizeToolCatalog,
		formatCompactToolCatalogText,
		formatToolCatalogText,
	};
})();
