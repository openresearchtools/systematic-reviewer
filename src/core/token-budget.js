var SystematicReviewerTokenBudget = (() => {
	const SAFE_CONTEXT_RATIO = 0.9;
	const DEFAULT_PINNED_START_COUNT = 4;
	const DEFAULT_TRUNCATION_NOTICE = [
		"The middle of this conversation was truncated to fit the configured context budget.",
		"Expand this block to inspect the omitted turns, tool calls, and tool outputs that were not sent to the model.",
	].join(" ");

	function optionalString(value) {
		return String(value || "").trim();
	}

	function estimateTextTokens(value = "") {
		let text = String(value || "");
		if (!text) {
			return 0;
		}
		let normalized = text.replace(/\s+/g, " ").trim();
		if (!normalized) {
			return 0;
		}
		let characters = normalized.length;
		let words = normalized.split(/\s+/).filter(Boolean).length;
		let lines = normalized.split(/\r?\n/).length;
		return Math.max(
			1,
			Math.round((characters / 4) + (words * 0.12) + (lines * 0.35))
		);
	}

	function safeContextCap(contextWindow = 0, ratio = SAFE_CONTEXT_RATIO) {
		let window = Math.max(0, Number(contextWindow || 0) || 0);
		if (!window) {
			return 0;
		}
		return Math.max(0, Math.floor(window * Math.max(0.1, Number(ratio || SAFE_CONTEXT_RATIO) || SAFE_CONTEXT_RATIO)));
	}

	function inputBudget(contextWindow = 0, maxOutputTokens = 0, ratio = SAFE_CONTEXT_RATIO) {
		let cap = safeContextCap(contextWindow, ratio);
		let reserve = Math.max(0, Number(maxOutputTokens || 0) || 0);
		return {
			context_window: Math.max(0, Number(contextWindow || 0) || 0),
			safe_cap_tokens: cap,
			max_output_tokens: reserve,
			input_budget_tokens: Math.max(0, cap - reserve),
		};
	}

	function serializePayload(payload) {
		if (payload === undefined || payload === null) {
			return "";
		}
		try {
			return JSON.stringify(payload, null, 2);
		}
		catch (_error) {
			return String(payload);
		}
	}

	function payloadForPromptSerialization(entry = {}) {
		let payload = entry?.payload;
		if (
			optionalString(entry?.event_type) == "documents_find"
			&& payload
			&& typeof payload == "object"
			&& !Array.isArray(payload)
		) {
			return {
				search_id: payload.search_id || "",
				query: payload.query || "",
				mode: payload.mode || "",
				keyword_backend: payload.keyword_backend || "",
				model: payload.model || "",
				scope: payload.scope || null,
				has_more: !!payload.has_more,
				next_offset: Number(payload.next_offset || 0) || 0,
				returned_documents: Number(payload.returned_documents || 0) || 0,
				total_documents: Number(payload.total_documents || 0) || 0,
			};
		}
		return payload;
	}

	function serializeTimelineEntry(entry = {}) {
		let role = optionalString(entry?.role || "system").toUpperCase() || "SYSTEM";
		let title = optionalString(entry?.title || "");
		let eventType = optionalString(entry?.event_type || "");
		let content = String(entry?.content || "").trim();
		let payload = serializePayload(payloadForPromptSerialization(entry));
		let lines = [];
		lines.push(`${role}${eventType ? ` [${eventType}]` : ""}${title ? ` ${title}` : ""}`.trim());
		if (content) {
			lines.push(content);
		}
		if (payload) {
			lines.push(payload);
		}
		return lines.filter(Boolean).join("\n");
	}

	function estimateTimelineEntry(entry = {}) {
		return estimateTextTokens(serializeTimelineEntry(entry));
	}

	function middleTruncateText(value = "", maxChars = 0, marker = "\n\n[... truncated ...]\n\n") {
		let text = String(value || "");
		let limit = Math.max(0, Number(maxChars || 0) || 0);
		if (!limit || text.length <= limit) {
			return {
				text,
				truncated: false,
			};
		}
		if (limit <= marker.length + 8) {
			return {
				text: `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`,
				truncated: true,
			};
		}
		let remaining = limit - marker.length;
		let head = Math.max(4, Math.floor(remaining / 2));
		let tail = Math.max(4, remaining - head);
		return {
			text: `${text.slice(0, head).trimEnd()}${marker}${text.slice(Math.max(0, text.length - tail)).trimStart()}`,
			truncated: true,
		};
	}

	function cloneEntry(entry = {}) {
		let copy = {};
		for (let [key, value] of Object.entries(entry || {})) {
			if (value && typeof value == "object") {
				try {
					copy[key] = JSON.parse(JSON.stringify(value));
				}
				catch (_error) {
					copy[key] = value;
				}
			}
			else {
				copy[key] = value;
			}
		}
		return copy;
	}

	function truncatedEntry(entry = {}, options = {}) {
		let next = cloneEntry(entry);
		let maxContentChars = Math.max(0, Number(options.maxContentChars || 0) || 0);
		if (maxContentChars > 0) {
			let result = middleTruncateText(String(next.content || ""), maxContentChars);
			next.content = result.text;
			if (result.truncated) {
				next.truncated_content = true;
			}
		}
		let maxPayloadChars = Math.max(0, Number(options.maxPayloadChars || 0) || 0);
		if (maxPayloadChars > 0 && next.payload !== undefined && next.payload !== null) {
			let serialized = serializePayload(next.payload);
			let result = middleTruncateText(serialized, maxPayloadChars);
			if (result.truncated) {
				next.payload = {
					truncated: true,
					text: result.text,
				};
				next.truncated_payload = true;
			}
		}
		return next;
	}

	function sequenceKey(entry = {}) {
		let sequenceNo = Number(entry?.sequence_no || 0) || 0;
		if (sequenceNo) {
			return `seq:${sequenceNo}`;
		}
		return [
			"entry",
			optionalString(entry?.event_type || ""),
			optionalString(entry?.created_at || ""),
			optionalString(entry?.title || ""),
			optionalString(entry?.role || ""),
		].join(":");
	}

	function optionNumber(options = {}, key = "", fallback = 0) {
		if (!Object.prototype.hasOwnProperty.call(options || {}, key)) {
			return fallback;
		}
		let value = Number(options?.[key] || 0);
		return Number.isFinite(value) ? value : fallback;
	}

	function requiredSequenceSet(options = {}) {
		let source = options.requiredEntrySequenceNos
			|| options.requiredSequenceNos
			|| options.activeEntrySequenceNos
			|| [];
		let values = Array.isArray(source) ? source : [source];
		let out = new Set();
		for (let value of values) {
			let numberValue = Number(value || 0) || 0;
			if (numberValue) {
				out.add(`seq:${numberValue}`);
			}
		}
		return out;
	}

	function buildTimelineProjection(entries = [], options = {}) {
		let source = (Array.isArray(entries) ? entries : [])
			.filter((entry) => !entry?.context_excluded)
			.map((entry) => cloneEntry(entry));
		let pinnedStartCount = Math.max(0, optionNumber(options, "pinnedStartCount", DEFAULT_PINNED_START_COUNT));
		let headTokens = Math.max(0, Number(options.headTokens || 0) || 0);
		let activeMemoryTokens = Math.max(0, Number(options.activeMemoryTokens || 0) || 0);
		let toolSchemaTokens = Math.max(0, Number(options.toolSchemaTokens || options.extraInputTokens || 0) || 0);
		let budget = Math.max(0, Number(options.inputBudgetTokens || 0) || 0);
		let targetBudget = Math.max(0, Number(options.targetInputBudgetTokens || 0) || 0);
		let effectiveBudget = targetBudget || budget;
		let maxContentChars = Math.max(0, Number(options.maxContentChars || 8000) || 8000);
		let maxPayloadChars = Math.max(0, Number(options.maxPayloadChars || 6000) || 6000);
		let notice = optionalString(options.truncationNotice || DEFAULT_TRUNCATION_NOTICE) || DEFAULT_TRUNCATION_NOTICE;
		let requiredSequences = requiredSequenceSet(options);
		let rawHistoryTokens = source.reduce((sum, entry) => sum + estimateTimelineEntry(entry), 0);

		let pinned = source.slice(0, pinnedStartCount).map((entry) => truncatedEntry(entry, {
			maxContentChars,
			maxPayloadChars,
		}));
		let keptIDs = new Set();
		for (let entry of pinned) {
			keptIDs.add(sequenceKey(entry));
		}
		let required = [];
		for (let raw of source) {
			let key = sequenceKey(raw);
			if (!requiredSequences.has(key) || keptIDs.has(key)) {
				continue;
			}
			let entry = truncatedEntry(raw, {
				maxContentChars,
				maxPayloadChars,
			});
			required.push(entry);
			keptIDs.add(key);
		}
		let usedTokens = headTokens
			+ toolSchemaTokens
			+ pinned.reduce((sum, entry) => sum + estimateTimelineEntry(entry), 0)
			+ required.reduce((sum, entry) => sum + estimateTimelineEntry(entry), 0);
		let keptTail = [];
		let omitted = [];

		for (let index = source.length - 1; index >= 0; index -= 1) {
			let raw = source[index];
			let entry = truncatedEntry(raw, {
				maxContentChars,
				maxPayloadChars,
			});
			let key = sequenceKey(entry);
			if (keptIDs.has(key)) {
				continue;
			}
			let estimate = estimateTimelineEntry(entry);
			if (!effectiveBudget || usedTokens + estimate <= effectiveBudget) {
				keptTail.unshift(entry);
				usedTokens += estimate;
				keptIDs.add(key);
			}
			else {
				omitted.unshift(cloneEntry(raw));
			}
		}

		let visible = pinned.slice();
			let truncated = omitted.length > 0;
			let truncationPromptEntry = null;
			let truncationNoticeTokens = 0;
			if (truncated) {
				truncationPromptEntry = {
				role: "system",
				event_type: "truncated_context",
				title: "Truncated Context",
				content: notice,
				payload: {
					truncated_count: omitted.length,
				},
				};
				truncationNoticeTokens = estimateTimelineEntry(truncationPromptEntry);
				usedTokens += truncationNoticeTokens;
				while (effectiveBudget && usedTokens > effectiveBudget && keptTail.length) {
					let removed = keptTail.shift();
					if (!removed) {
						break;
					}
					usedTokens -= estimateTimelineEntry(removed);
					omitted.unshift(cloneEntry(removed));
				}
				visible.push({
					role: "system",
					event_type: "truncated_context",
				title: "Truncated Context",
				content: notice,
				payload: {
					truncated_count: omitted.length,
					entries: omitted,
				},
				synthetic: true,
			});
		}
		let remainder = required.concat(keptTail).sort((left, right) => {
			let leftSeq = Number(left?.sequence_no || 0) || 0;
			let rightSeq = Number(right?.sequence_no || 0) || 0;
			return leftSeq - rightSeq;
		});
		let visibleKeys = new Set(visible.map((entry) => sequenceKey(entry)));
		for (let entry of remainder) {
			let key = sequenceKey(entry);
			if (!visibleKeys.has(key)) {
				visible.push(entry);
				visibleKeys.add(key);
			}
		}

			return {
				truncated,
				head_tokens: headTokens,
				active_memory_tokens: activeMemoryTokens,
				tool_schema_tokens: toolSchemaTokens,
				truncation_notice_tokens: truncationNoticeTokens,
				raw_history_tokens: rawHistoryTokens,
				used_input_tokens: usedTokens,
				input_budget_tokens: budget,
				target_input_budget_tokens: effectiveBudget,
				fits_budget: !effectiveBudget || usedTokens <= effectiveBudget,
				over_budget_tokens: effectiveBudget && usedTokens > effectiveBudget ? usedTokens - effectiveBudget : 0,
				visible_entries: visible,
				prompt_entries: visible.map((entry) => entry.event_type == "truncated_context"
					? (truncationPromptEntry || {
						role: "system",
						event_type: "truncated_context",
						title: entry.title,
						content: entry.content,
						payload: {
							truncated_count: Number(entry?.payload?.truncated_count || 0) || 0,
						},
					})
				: cloneEntry(entry)),
				omitted_entries: omitted,
				kept_tail_entries: keptTail,
				pinned_entries: pinned,
				required_entries: required,
				omitted_count: omitted.length,
			};
	}

	return {
		SAFE_CONTEXT_RATIO,
		DEFAULT_PINNED_START_COUNT,
		DEFAULT_TRUNCATION_NOTICE,
		estimateTextTokens,
		safeContextCap,
		inputBudget,
		serializeTimelineEntry,
		estimateTimelineEntry,
		middleTruncateText,
		buildTimelineProjection,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerTokenBudget;
}
