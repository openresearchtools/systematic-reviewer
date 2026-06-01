var SystematicReviewerSlidingContext = (() => {
	function optionalString(value) {
		return String(value || "").trim();
	}

	function serializePromptEntry(entry = {}) {
		return SystematicReviewerTokenBudget.serializeTimelineEntry(entry);
	}

	function buildPromptText(headText = "", promptEntries = []) {
		let parts = [];
		let intro = String(headText || "").trim();
		if (intro) {
			parts.push(intro);
		}
		for (let entry of Array.isArray(promptEntries) ? promptEntries : []) {
			let text = serializePromptEntry(entry);
			if (text) {
				parts.push(text);
			}
		}
		return parts.join("\n\n").trim();
	}

	function activeMemoryBlock(activeMemoryText = "") {
		let text = String(activeMemoryText || "").trim();
		if (!text) {
			return "";
		}
		return [
			"Project active memory:",
			"The following durable continuation memory is injected into every agent call. Use it to preserve user objectives, standing decisions, recent work, open tasks, and next action across long sessions.",
			"",
			text,
		].join("\n").trim();
	}

	function combineHeadAndMemory(headText = "", activeMemoryText = "") {
		let parts = [String(headText || "").trim(), activeMemoryBlock(activeMemoryText)]
			.filter((part) => String(part || "").trim());
		return parts.join("\n\n").trim();
	}

	function serializeToolSchemaText(options = {}) {
		if (options.toolSchemaText !== undefined && options.toolSchemaText !== null) {
			return String(options.toolSchemaText || "");
		}
		if (Array.isArray(options.tools)) {
			try {
				return JSON.stringify(options.tools, null, 2);
			}
			catch (_error) {
				return String(options.tools || "");
			}
		}
		return "";
	}

	function estimateToolSchemaTokens(options = {}) {
		if (Number(options.toolSchemaTokens || 0) || 0) {
			return Math.max(0, Number(options.toolSchemaTokens || 0) || 0);
		}
		let text = serializeToolSchemaText(options);
		if (text) {
			return SystematicReviewerTokenBudget.estimateTextTokens(text);
		}
		return 0;
	}

	function buildProjection(options = {}) {
		let contextWindow = Math.max(0, Number(options.contextWindow || 0) || 0);
		let maxOutputTokens = Math.max(0, Number(options.maxOutputTokens || 0) || 0);
		let baseHeadText = String(options.headText || "").trim();
		let activeMemoryText = String(options.activeMemoryText || "").trim();
		let activeMemoryTokens = SystematicReviewerTokenBudget.estimateTextTokens(activeMemoryText);
		let toolSchemaText = serializeToolSchemaText(options);
		let toolSchemaTokens = estimateToolSchemaTokens(options);
		let headText = combineHeadAndMemory(baseHeadText, activeMemoryText);
		let headEntry = options.headEntry && typeof options.headEntry == "object"
			? JSON.parse(JSON.stringify(options.headEntry))
			: null;
		let timeline = Array.isArray(options.timeline) ? options.timeline : [];
		let budget = SystematicReviewerTokenBudget.inputBudget(
			contextWindow,
			maxOutputTokens,
			options.safeRatio
		);
			let headTokens = SystematicReviewerTokenBudget.estimateTextTokens(headText);
			let targetRatio = Math.max(0.2, Math.min(1, Number(options.targetInputBudgetRatio || 0.8) || 0.8));
			let targetInputBudgetTokens = budget.input_budget_tokens
				? Math.floor(budget.input_budget_tokens * targetRatio)
				: 0;
			let projection = SystematicReviewerTokenBudget.buildTimelineProjection(timeline, {
				headTokens,
				inputBudgetTokens: budget.input_budget_tokens,
				targetInputBudgetTokens,
				activeMemoryTokens,
				toolSchemaTokens,
				requiredEntrySequenceNos: options.requiredEntrySequenceNos || options.requiredSequenceNos || [],
				pinnedStartCount: options.pinnedStartCount,
				maxContentChars: options.maxContentChars,
				maxPayloadChars: options.maxPayloadChars,
				truncationNotice: options.truncationNotice,
			});
			let promptText = buildPromptText(headText, projection.prompt_entries || []);
			let promptTextTokens = SystematicReviewerTokenBudget.estimateTextTokens(promptText);
			let actualInputTokens = promptTextTokens + toolSchemaTokens;
			let effectiveTargetInputBudgetTokens = Number(projection.target_input_budget_tokens || targetInputBudgetTokens || 0) || 0;
			let fitsBudget = !effectiveTargetInputBudgetTokens || actualInputTokens <= effectiveTargetInputBudgetTokens;
			let visibleTimeline = projection.visible_entries || [];
			let promptTimeline = projection.prompt_entries || [];
		if (headEntry && headText) {
			visibleTimeline = [headEntry].concat(visibleTimeline);
			promptTimeline = [{
				role: String(headEntry.role || "system"),
				event_type: String(headEntry.event_type || "system_prompt"),
				title: String(headEntry.title || "Pinned Prompt Context"),
				content: headText,
				synthetic: true,
			}].concat(promptTimeline);
		}
		return {
				stateful: !!options.stateful,
				base_head_text: baseHeadText,
				head_text: headText,
				head_tokens: headTokens,
				active_memory_text: activeMemoryText,
				active_memory_tokens: activeMemoryTokens,
				tool_schema_text: toolSchemaText,
				tool_schema_tokens: toolSchemaTokens,
				truncation_notice_tokens: Number(projection.truncation_notice_tokens || 0) || 0,
				context_window: budget.context_window,
				safe_cap_tokens: budget.safe_cap_tokens,
					max_output_tokens: budget.max_output_tokens,
					input_budget_tokens: budget.input_budget_tokens,
					target_input_budget_tokens: effectiveTargetInputBudgetTokens,
					raw_history_tokens: Number(projection.raw_history_tokens || 0) || 0,
					used_input_tokens: actualInputTokens,
					estimated_input_tokens: actualInputTokens,
					fits_budget: fitsBudget,
					over_budget_tokens: fitsBudget ? 0 : Math.max(0, actualInputTokens - effectiveTargetInputBudgetTokens),
					truncated: !!projection.truncated,
				omitted_count: Number(projection.omitted_count || 0) || 0,
			visible_timeline: visibleTimeline,
			prompt_timeline: promptTimeline,
			omitted_timeline: projection.omitted_entries || [],
			prompt_text: promptText,
		};
	}

	function buildStatefulProjection(options = {}) {
		let timeline = Array.isArray(options.timeline) ? options.timeline : [];
		let promptTimeline = timeline.filter((entry) => !entry?.context_excluded);
		let baseHeadText = String(options.headText || "").trim();
		let activeMemoryText = String(options.activeMemoryText || "").trim();
		let toolSchemaText = serializeToolSchemaText(options);
		let toolSchemaTokens = estimateToolSchemaTokens(options);
		let headText = combineHeadAndMemory(baseHeadText, activeMemoryText);
		let headTokens = SystematicReviewerTokenBudget.estimateTextTokens(headText);
		return {
			stateful: true,
			base_head_text: baseHeadText,
			head_text: headText,
			head_tokens: headTokens,
			active_memory_text: activeMemoryText,
			active_memory_tokens: SystematicReviewerTokenBudget.estimateTextTokens(activeMemoryText),
			tool_schema_text: toolSchemaText,
			tool_schema_tokens: toolSchemaTokens,
			truncation_notice_tokens: 0,
			raw_history_tokens: promptTimeline.reduce((sum, entry) => sum + SystematicReviewerTokenBudget.estimateTimelineEntry(entry), 0),
			used_input_tokens: headTokens + toolSchemaTokens,
			target_input_budget_tokens: 0,
			fits_budget: true,
			over_budget_tokens: 0,
			context_window: Math.max(0, Number(options.contextWindow || 0) || 0),
			safe_cap_tokens: 0,
			max_output_tokens: Math.max(0, Number(options.maxOutputTokens || 0) || 0),
			input_budget_tokens: 0,
			estimated_input_tokens: headTokens + toolSchemaTokens,
			truncated: false,
			omitted_count: 0,
			visible_timeline: timeline,
			prompt_timeline: promptTimeline,
			omitted_timeline: [],
			prompt_text: buildPromptText(headText, promptTimeline),
		};
	}

	return {
		buildPromptText,
		buildProjection,
		buildStatefulProjection,
		serializeToolSchemaText,
		estimateToolSchemaTokens,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerSlidingContext;
}
