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

	function buildProjection(options = {}) {
		let contextWindow = Math.max(0, Number(options.contextWindow || 0) || 0);
		let maxOutputTokens = Math.max(0, Number(options.maxOutputTokens || 0) || 0);
		let headText = String(options.headText || "").trim();
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
		let projection = SystematicReviewerTokenBudget.buildTimelineProjection(timeline, {
			headTokens,
			inputBudgetTokens: budget.input_budget_tokens,
			pinnedStartCount: options.pinnedStartCount,
			maxContentChars: options.maxContentChars,
			maxPayloadChars: options.maxPayloadChars,
			truncationNotice: options.truncationNotice,
		});
		let promptText = buildPromptText(headText, projection.prompt_entries || []);
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
			head_text: headText,
			head_tokens: headTokens,
			context_window: budget.context_window,
			safe_cap_tokens: budget.safe_cap_tokens,
			max_output_tokens: budget.max_output_tokens,
			input_budget_tokens: budget.input_budget_tokens,
			estimated_input_tokens: SystematicReviewerTokenBudget.estimateTextTokens(promptText),
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
		return {
			stateful: true,
			head_text: String(options.headText || "").trim(),
			head_tokens: SystematicReviewerTokenBudget.estimateTextTokens(String(options.headText || "").trim()),
			context_window: Math.max(0, Number(options.contextWindow || 0) || 0),
			safe_cap_tokens: 0,
			max_output_tokens: Math.max(0, Number(options.maxOutputTokens || 0) || 0),
			input_budget_tokens: 0,
			estimated_input_tokens: 0,
			truncated: false,
			omitted_count: 0,
			visible_timeline: timeline,
			prompt_timeline: promptTimeline,
			omitted_timeline: [],
			prompt_text: buildPromptText(String(options.headText || "").trim(), promptTimeline),
		};
	}

	return {
		buildPromptText,
		buildProjection,
		buildStatefulProjection,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerSlidingContext;
}
