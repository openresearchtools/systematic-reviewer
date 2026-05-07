var SystematicReviewerAutomationRunner = {
	_sessionAgentModelMaxRetries() {
		return 5;
	},

	_sessionAgentModelRetryDelayMs(retryIndex = 1) {
		let delays = [1000, 2000, 4000, 8000, 16000];
		let index = Math.max(0, Math.min(delays.length - 1, (Number(retryIndex || 0) || 1) - 1));
		return delays[index];
	},

	_isSessionAbortError(error) {
		let name = String(error?.name || "").trim();
		let message = String(error?.message || error || "").trim().toLowerCase();
		return name == "AbortError"
			|| message.includes("aborted")
			|| message.includes("cancelled")
			|| message.includes("canceled");
	},

	_throwIfSessionAborted(signal = null, message = "Session run stopped.") {
		if (!signal?.aborted) {
			return;
		}
		let error = new Error(String(message || "Session run stopped."));
		error.name = "AbortError";
		throw error;
	},

	_sessionAgentRetryErrorMessage(error) {
		let message = String(error?.message || error || "Model call failed.").trim() || "Model call failed.";
		return this._truncateText ? this._truncateText(message, 900) : message.slice(0, 900);
	},

	_cloneSessionAgentModelPayload(value) {
		if (!value || typeof value != "object") {
			return value;
		}
		try {
			return JSON.parse(JSON.stringify(value));
		}
		catch (_error) {
			if (Array.isArray(value)) {
				return value.slice();
			}
			return Object.assign({}, value);
		}
	},

	async _waitSessionAgentModelRetry(delayMs = 0, signal = null) {
		this._throwIfSessionAborted(signal);
		let ms = Math.max(0, Number(delayMs || 0) || 0);
		if (!ms) {
			this._throwIfSessionAborted(signal);
			return;
		}
		await new Promise((resolve, reject) => {
			let settled = false;
			let timer = null;
			let cleanup = () => {
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
				if (signal && typeof signal.removeEventListener == "function") {
					try {
						signal.removeEventListener("abort", onAbort);
					}
					catch (_error) {}
				}
			};
			let finish = (error = null) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				if (error) {
					reject(error);
				}
				else {
					resolve();
				}
			};
			let onAbort = () => {
				let error = new Error("Session run stopped.");
				error.name = "AbortError";
				finish(error);
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			if (signal && typeof signal.addEventListener == "function") {
				signal.addEventListener("abort", onAbort, { once: true });
			}
			timer = setTimeout(() => finish(), ms);
		});
		this._throwIfSessionAborted(signal);
	},

	async _runSessionAgent(current, sessionID, message, options = {}) {
		let userMessage = String(message || "").trim();
		if (!userMessage) {
			return null;
		}
		this._throwIfSessionAborted(options?.abortSignal || null);
		let reportBaselineHash = await this._reportContentHash(current.context);
		let config = await this._conversionConfig();
		this._assertSessionChatExecutionReady(config);
		let runtimeState = await this._loadSessionRuntimeState(current.context, sessionID);
		let preparedChat = await this._prepareRoleAPIClient("session_chat", config.chatClient, config, {
			presetID: runtimeState?.chat_preset_id || "default",
			modelOverride: runtimeState?.chat_model_override || "",
			reasoningEffort: runtimeState?.chat_reasoning_effort || "",
			cwd: current?.context?.projectRoot || "",
		});
		try {
			let chatClient = preparedChat.client || config.chatClient;
			let preparedClientHasReasoning = Object.prototype.hasOwnProperty.call(preparedChat?.client || {}, "reasoningEffort");
			chatClient.reasoningEffort = String(
				preparedClientHasReasoning
					? preparedChat.client.reasoningEffort
					: (runtimeState?.chat_reasoning_effort || "")
			).trim().toLowerCase();
			let stateful = String(chatClient?.stateMode || "").trim() == "stateful";
			if (preparedChat.summaryPatch) {
				await this._updateSessionState(current.context, sessionID, {
					summaryPatch: preparedChat.summaryPatch,
				});
			}
			let apiKind = String(chatClient?.apiKind || "responses").trim();
			if (!["responses", "chat_completions"].includes(apiKind)) {
				throw new Error("Automation chat requires a Responses-compatible runtime.");
			}
			let reply = await this._runSessionAgentNative(current, sessionID, userMessage, {
				chatClient,
				config,
				stateful,
				runtimeState,
				emitProgress: !!options.emitProgress,
				progress: options.progress || null,
				abortSignal: options.abortSignal || null,
			});
			let reportFinalHash = await this._reportContentHash(current.context);
			if (reportFinalHash != reportBaselineHash) {
				await this._snapshotReportFromDisk(current.context, "agent-run-final");
			}
			return reply;
		}
		finally {
			await preparedChat.release?.();
		}
	},

	async _emitSessionProgress(progress = null, type = "", payload = {}) {
		if (!progress || typeof progress.onEvent != "function") {
			return;
		}
		try {
			await progress.onEvent({
				type: String(type || "").trim(),
				...(payload && typeof payload == "object" ? payload : {}),
			});
		}
		catch (error) {
			this.log?.(`session progress delivery skipped: ${error?.message || String(error)}`);
		}
	},

	async _appendSessionEventWithProgress(context, sessionID, eventType, options = {}, progress = null) {
		let entry = await this._appendSessionEvent(context, sessionID, eventType, options);
		await this._emitSessionProgress(progress, "timeline.entry", {
			entry,
		});
		return entry;
	},

		async _appendSessionMessageWithProgress(context, sessionID, role, content, options = {}, progress = null) {
			let entry = await this._appendSessionMessage(context, sessionID, role, content, options);
			await this._emitSessionProgress(progress, "timeline.entry", {
				entry,
			});
			return entry;
		},

		_chatBudgetFromProjection(projection = null) {
			if (!projection || typeof projection != "object") {
				return null;
			}
			return {
				stateful: !!projection.stateful,
				context_window: Number(projection.context_window || 0) || 0,
				safe_cap_tokens: Number(projection.safe_cap_tokens || 0) || 0,
				max_output_tokens: Number(projection.max_output_tokens || 0) || 0,
				input_budget_tokens: Number(projection.input_budget_tokens || 0) || 0,
				estimated_input_tokens: Number(projection.estimated_input_tokens || 0) || 0,
				truncated: !!projection.truncated,
				omitted_count: Number(projection.omitted_count || 0) || 0,
			};
		},

		async _runSessionAgentNative(current, sessionID, userMessage, options = {}) {
			let maxSteps = 1000;
		let previousResponseID = String(options?.runtimeState?.chat_previous_response_id || "").trim();
		let nextInputAfterTools = null;
		let lastToolPlanSignature = "";
		let repeatedToolPlanCount = 0;
		let loadedNamespaces = new Set();
		let loadedToolNames = new Set();
		let lastReportHash = "";
		try {
			lastReportHash = await this._reportContentHash(current.context);
		}
		catch (_error) {
			lastReportHash = "";
		}
		for (let step = 1; step <= maxSteps; step += 1) {
			this._throwIfSessionAborted(options?.abortSignal || null);
			let promptPacket = await this._buildSessionPromptPacket(current, sessionID, {
				chatClient: options.chatClient,
				config: options.config,
				stateful: !!options.stateful,
				activeNamespaces: Array.from(loadedNamespaces),
					activeToolNames: Array.from(loadedToolNames),
					transport: "native",
				});
				await this._emitSessionProgress(options.progress || null, "chat.budget", {
					step,
					chat_budget: this._chatBudgetFromProjection(promptPacket.projection),
				});
				let stepInput = this._buildNativeLoopInput(promptPacket, {
					stateful: !!options.stateful,
					userMessage,
				previousResponseID,
				nextInputAfterTools,
			});
			let response = await this._requestSessionAgentNativeStep(promptPacket, {
				userMessage,
				input: stepInput,
				stateful: !!options.stateful,
				previousResponseID,
				progress: options.progress || null,
				step,
				abortSignal: options.abortSignal || null,
			});
			this._throwIfSessionAborted(options?.abortSignal || null);
			nextInputAfterTools = null;
			if (options.stateful && response.responseID) {
				let nextRuntime = await this._updateSessionRuntimeState(current.context, sessionID, {
					chat_previous_response_id: response.responseID,
				});
				previousResponseID = String(nextRuntime?.chat_previous_response_id || "").trim();
			}
			let persisted = await this._appendNativeResponseItems(current.context, sessionID, response, {
				progress: options.progress || null,
				step,
			});
			this._throwIfSessionAborted(options?.abortSignal || null);
			let toolCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
			let currentSignature = this._toolLoopSignature(toolCalls);
			if (currentSignature && currentSignature == lastToolPlanSignature) {
				repeatedToolPlanCount += 1;
			}
			else {
				lastToolPlanSignature = currentSignature;
				repeatedToolPlanCount = 0;
			}
			if (repeatedToolPlanCount >= 20) {
				throw new Error("The model kept repeating the same tool calls without progressing, so the run was stopped.");
			}
			if (!toolCalls.length) {
				let reply = String(persisted?.messageText || response.reply || "").trim()
					|| "I reviewed the current project state and I am ready for the next step.";
				if (!persisted?.messageCount) {
					await this._appendSessionMessageWithProgress(current.context, sessionID, "assistant", reply, {
						eventType: "responses_message",
						title: "Systematic Reviewer",
						payload: {
							transport: "native",
							step,
						},
					}, options.progress || null);
				}
				let steerMessage = await this._consumePendingSessionSteer(current, sessionID, options.progress || null);
				if (steerMessage) {
					nextInputAfterTools = null;
					userMessage = steerMessage.content;
					continue;
				}
				return reply;
			}
			let execution = await this._executeSessionToolCalls(current, sessionID, toolCalls, {
				emitProgress: !!options.emitProgress,
				progress: options.progress || null,
				abortSignal: options.abortSignal || null,
			});
			try {
				let nextReportHash = await this._reportContentHash(current.context);
				if (nextReportHash && nextReportHash != lastReportHash) {
					lastReportHash = nextReportHash;
					await this._emitSessionProgress(options.progress || null, "report.updated", {
						report_hash: nextReportHash,
						report_path: current?.context?.reportPath || "",
						source: "tool_batch",
						step,
					});
				}
			}
			catch (_error) {}
			let activated = this._collectSessionToolActivations(execution.results || [], promptPacket.toolCatalog);
			for (let namespaceID of activated.namespaces) {
				loadedNamespaces.add(namespaceID);
			}
			for (let toolName of activated.tool_names) {
				loadedToolNames.add(toolName);
			}
			let autoSteer = this._buildAutoReportRewriteSteer(execution.results || [], toolCalls);
			if (autoSteer) {
				loadedNamespaces.add("workspace");
			}
			let steerMessage = await this._consumePendingSessionSteer(current, sessionID, options.progress || null);
			let combinedSteer = this._combineSteerMessages(autoSteer, steerMessage?.content || "");
			if (autoSteer && !options.stateful) {
				await this._appendSessionMessageWithProgress(current.context, sessionID, "user", autoSteer, {
					eventType: "user_message",
					title: "Workflow Follow-up",
					payload: {
						mode: "auto_followup",
					},
				}, options.progress || null);
			}
			if (combinedSteer) {
				userMessage = combinedSteer;
			}
			if (options.stateful) {
				nextInputAfterTools = this._formatNativeToolResultsInput(execution.results || [], combinedSteer);
			}
		}
		throw new Error("The model kept requesting more tool steps without reaching a final answer, so the run was stopped.");
	},

	_buildNativeLoopInput(_promptPacket, options = {}) {
		if (!options?.stateful) {
			return String(_promptPacket?.projection?.prompt_text || "").trim();
		}
		if (Array.isArray(options?.nextInputAfterTools) && options.nextInputAfterTools.length) {
			return options.nextInputAfterTools;
		}
		let userMessage = String(options?.userMessage || "").trim();
		if (!userMessage) {
			return [];
		}
		return [{
			type: "message",
			role: "user",
			content: [{
				type: "input_text",
				text: userMessage,
			}],
		}];
	},

	_nativeResponseMessageText(item = {}) {
		let content = Array.isArray(item?.content) ? item.content : [];
		let texts = [];
		for (let part of content) {
			if (part?.type == "output_text" && typeof part?.text == "string") {
				texts.push(part.text);
			}
		}
		return String(texts.join("\n").trim() || item?.text || "").trim();
	},

	_nativeResponseReasoningText(item = {}) {
		let summary = Array.isArray(item?.summary) ? item.summary : [];
		let summaryTexts = summary
			.map((entry) => String(entry?.text || entry?.summary || entry || "").trim())
			.filter(Boolean);
		if (summaryTexts.length) {
			return summaryTexts.join("\n");
		}
		let content = Array.isArray(item?.content) ? item.content : [];
		let contentTexts = content
			.map((entry) => String(entry?.text || entry?.summary || entry || "").trim())
			.filter(Boolean);
		if (contentTexts.length) {
			return contentTexts.join("\n");
		}
		return String(item?.text || item?.id || "Reasoning available in payload.").trim();
	},

	async _appendNativeResponseItems(context, sessionID, response = {}, options = {}) {
		let output = Array.isArray(response?.raw?.output) ? response.raw.output : [];
		let normalizedReply = String(response?.reply || "").trim();
		let normalizedThinking = String(response?.thinking || "").trim();
		let reasoningCount = 0;
		let messageCount = 0;
		let lastMessageText = "";
		for (let item of output) {
			let itemType = String(item?.type || "").trim();
			if (itemType == "reasoning") {
				let content = this._nativeResponseReasoningText(item);
				if (!content) {
					continue;
				}
				reasoningCount += 1;
				await this._appendSessionEventWithProgress(context, sessionID, "responses_reasoning", {
					role: "assistant",
					title: "Reasoning",
					content,
					payload: item,
				}, options.progress || null);
				continue;
			}
			if (itemType == "message") {
				let content = this._nativeResponseMessageText(item);
				if (!content) {
					continue;
				}
				messageCount += 1;
				lastMessageText = content;
				await this._appendSessionMessageWithProgress(context, sessionID, "assistant", content, {
					eventType: "responses_message",
					title: "Systematic Reviewer",
					payload: item,
				}, options.progress || null);
			}
		}
		if (!reasoningCount && normalizedThinking) {
			await this._appendSessionEventWithProgress(context, sessionID, "responses_reasoning", {
				role: "assistant",
				title: "Reasoning",
				content: normalizedThinking,
				payload: {
					type: "reasoning",
					source: "normalized_native_reply",
				},
			}, options.progress || null);
			reasoningCount = 1;
		}
		return {
			reasoningCount,
			messageCount,
			messageText: lastMessageText,
		};
	},

	async _buildSessionPromptPacket(current, sessionID, options = {}) {
		let sessionState = await this._loadSessionState(current.context, sessionID);
		let inspection = await this._inspectProjectSession(current);
		let projectCounts = await this._projectCounts(current.context).catch(() => ({}));
		let toolCatalog = this._sessionToolCatalog();
		let availableScopes = [];
		try {
			availableScopes = SystematicReviewerWorkflowScreening?.availableScopes
				? (SystematicReviewerWorkflowScreening.availableScopes(this, current) || [])
				: [];
		}
		catch (_error) {
			availableScopes = [];
		}
		let headText = SystematicReviewerSessionAgent.buildSystemPrompt(current, sessionID, {
			inspection,
			project_counts: projectCounts,
			project_type: current?.projectType || current?.context?.projectType || "",
			tool_catalog: toolCatalog,
			session_state: sessionState,
			available_scopes: availableScopes,
			transport: "native",
		});
		let timeline = await this._loadSessionTimeline(current.context, sessionID);
		let stateful = !!options.stateful;
		let projection = stateful
			? SystematicReviewerSlidingContext.buildStatefulProjection({
				headText,
				timeline,
				contextWindow: Number(options?.chatClient?.contextWindow || 0) || 0,
				maxOutputTokens: Number(options?.chatClient?.maxOutputTokens || 0) || 0,
			})
			: SystematicReviewerSlidingContext.buildProjection({
				headText,
				headEntry: {
					role: "system",
					event_type: "system_prompt",
					title: "Pinned Prompt Context",
					content: headText,
					synthetic: true,
				},
				timeline,
				contextWindow: Number(options?.chatClient?.contextWindow || 0) || 0,
				maxOutputTokens: Number(options?.chatClient?.maxOutputTokens || 0) || 0,
				pinnedStartCount: 4,
				maxContentChars: 12000,
				maxPayloadChars: 8000,
			});
		return {
			headText,
			sessionState,
			inspection,
			projectCounts,
			availableScopes,
			toolCatalog,
			timeline,
			projection,
			tools: this._sessionResponseTools(toolCatalog, {
				activeNamespaces: options.activeNamespaces || [],
				activeToolNames: options.activeToolNames || [],
			}),
			config: options.config || null,
			chatClient: options.chatClient || null,
			stateful,
			transport: "native",
		};
	},

	_sessionAlwaysAvailableToolNames(toolCatalog = {}) {
		let names = new Set(
			(Array.isArray(toolCatalog?.top_level) ? toolCatalog.top_level : [])
				.map((tool) => String(tool?.name || "").trim())
				.filter(Boolean)
		);
		if (toolCatalog?.by_name?.manual__read) {
			names.add("manual__read");
		}
		return Array.from(names);
	},

	_sessionResponseTools(toolCatalog = {}, options = {}) {
		let selected = SystematicReviewerResponsesToolCatalog.resolveAdvertisedTools(toolCatalog, {
			always_available_tool_names: this._sessionAlwaysAvailableToolNames(toolCatalog),
			active_namespaces: Array.isArray(options?.activeNamespaces) ? options.activeNamespaces : [],
			active_tool_names: Array.isArray(options?.activeToolNames) ? options.activeToolNames : [],
		});
		let tools = selected.map((tool) => ({
			type: "function",
			name: String(tool?.name || "").trim(),
			description: String(tool?.full_description || tool?.description || "").trim(),
			parameters: tool?.parameters && typeof tool.parameters == "object"
				? tool.parameters
				: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
		})).filter((tool) => tool.name);
		if (toolCatalog?.tool_search?.name) {
			tools.push({
				type: "function",
				name: String(toolCatalog.tool_search.name || "").trim(),
				description: String(toolCatalog.tool_search.description || "").trim(),
				parameters: toolCatalog.tool_search.parameters && typeof toolCatalog.tool_search.parameters == "object"
					? toolCatalog.tool_search.parameters
					: {
						type: "object",
						properties: {},
						additionalProperties: false,
					},
			});
		}
		return tools;
	},

	async _requestSessionAgentNativeStep(promptPacket, options = {}) {
		let input = Object.prototype.hasOwnProperty.call(options || {}, "input")
			? options.input
			: String(promptPacket?.projection?.prompt_text || "").trim();
		let requestPayload = {
			model: promptPacket.chatClient.model,
			input,
			tools: promptPacket.tools,
			max_output_tokens: Number(promptPacket?.chatClient?.maxOutputTokens || 0) || 10000,
			store: !!options?.stateful,
			stream: !!options?.progress,
			instructions: options?.stateful ? String(promptPacket?.headText || "").trim() : undefined,
			previous_response_id: options?.stateful && String(options?.previousResponseID || "").trim()
				? String(options.previousResponseID || "").trim()
				: undefined,
			reasoning: promptPacket?.chatClient?.reasoningEffort
				? { effort: String(promptPacket.chatClient.reasoningEffort || "").trim() }
				: undefined,
		};
		let maxRetries = this._sessionAgentModelMaxRetries();
		let lastError = null;
		for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
			this._throwIfSessionAborted(options?.abortSignal || null);
			try {
				return await this._requestSessionAgentNativeStepOnce(promptPacket, requestPayload, options);
			}
			catch (error) {
				if (this._isSessionAbortError(error)) {
					throw error;
				}
				lastError = error;
				if (attempt >= maxRetries) {
					break;
				}
				let retryIndex = attempt + 1;
				let retryDelayMs = this._sessionAgentModelRetryDelayMs(retryIndex);
				await this._emitSessionProgress(options.progress || null, "model.retry", {
					step: Number(options?.step || 0) || 0,
					retry_index: retryIndex,
					max_retries: maxRetries,
					retry_delay_ms: retryDelayMs,
					error_message: this._sessionAgentRetryErrorMessage(error),
				});
				await this._waitSessionAgentModelRetry(retryDelayMs, options.abortSignal || null);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError || "Model call failed."));
	},

	async _requestSessionAgentNativeStepOnce(promptPacket, requestPayload = {}, options = {}) {
		let functionArguments = new Map();
		let reasoningText = "";
		let response = await SystematicReviewerPDFMarkdown.requestResponses(promptPacket.chatClient, this._cloneSessionAgentModelPayload(requestPayload), {
			signal: options.abortSignal || null,
			onEvent: async (event = {}) => {
				let type = String(event?.type || "").trim();
				if (type == "response.output_item.added") {
					let itemType = String(event?.item?.type || "").trim();
					if (itemType == "reasoning") {
						await this._emitSessionProgress(options.progress || null, "responses.reasoning.started", {
							item_id: String(event?.item?.id || "").trim(),
							step: Number(options?.step || 0) || 0,
						});
						return;
					}
					if (itemType == "function_call") {
						let argumentsText = typeof event?.item?.arguments === "string"
							? event.item.arguments
							: (event?.item?.arguments && typeof event.item.arguments == "object"
								? JSON.stringify(event.item.arguments)
								: "");
						await this._emitSessionProgress(options.progress || null, "tool.call.started", {
							call_id: String(event?.item?.call_id || event?.item?.id || "").trim(),
							name: String(event?.item?.name || "").trim(),
							arguments_text: argumentsText,
						});
						return;
					}
				}
				if (type.includes("reasoning") && type.includes("delta")) {
					let deltaText = String(
						event?.delta
						|| event?.text
						|| event?.summary?.[0]?.text
						|| event?.summary_text
						|| ""
					);
					if (deltaText) {
						reasoningText += deltaText;
						await this._emitSessionProgress(options.progress || null, "responses.reasoning.delta", {
							text: reasoningText,
							delta: deltaText,
							step: Number(options?.step || 0) || 0,
						});
					}
					return;
				}
				if (type == "response.function_call_arguments.delta" || type.endsWith("arguments.delta")) {
					let callID = String(event?.call_id || event?.item_id || event?.id || "").trim();
					if (!callID) {
						return;
					}
					let deltaText = String(event?.delta || "");
					let current = String(functionArguments.get(callID) || "");
					current += deltaText;
					functionArguments.set(callID, current);
					await this._emitSessionProgress(options.progress || null, "tool.call.delta", {
						call_id: callID,
						name: String(event?.name || "").trim(),
						arguments_text: current,
						delta: deltaText,
					});
					return;
				}
				if (type == "response.output_text.delta" && String(event?.delta || "")) {
					let cumulativeText = String(event?.text || "");
					let structuredPreview = /^[\s`]*\{/.test(cumulativeText);
					await this._emitSessionProgress(options.progress || null, "assistant.delta", {
						delta: String(event.delta || ""),
						text: cumulativeText,
						step: Number(options?.step || 0) || 0,
						transport: structuredPreview ? "native-structured" : "native",
					});
				}
			},
		});
		let normalized = this._normalizeNativeAssistantResponse(response, {
			toolCatalog: promptPacket.toolCatalog,
			advertisedTools: promptPacket.tools,
		});
		this._assertValidNativeAssistantResponse(response, normalized);
		return {
			reply: String(normalized?.reply || "").trim(),
			responseID: String(response?.responseID || "").trim(),
			toolCalls: Array.isArray(normalized?.toolCalls) ? normalized.toolCalls : [],
			raw: response?.raw || {},
		};
	},

	_assertValidNativeAssistantResponse(response = {}, normalized = {}) {
		if (response?.truncated || String(response?.finishReason || "").trim() == "length") {
			let reason = String(response?.finishReason || "length").trim() || "length";
			throw new Error(`Responses tool loop returned a truncated model response: ${reason}.`);
		}
		let reply = String(normalized?.reply || "").trim();
		let toolCalls = Array.isArray(normalized?.toolCalls) ? normalized.toolCalls : [];
		let rawFunctionCalls = Array.isArray(response?.functionCalls) ? response.functionCalls : [];
		for (let entry of rawFunctionCalls) {
			if (!entry || typeof entry != "object") {
				continue;
			}
			let name = String(
				entry.name
				|| entry.tool
				|| entry.tool_name
				|| entry.toolName
				|| entry.id
				|| ""
			).trim();
			if (!name) {
				throw new Error("Responses tool loop returned a function call without a tool name.");
			}
		}
		for (let toolCall of toolCalls) {
			let name = String(toolCall?.name || "").trim();
			if (!name) {
				throw new Error("Responses tool loop returned a function call without a tool name.");
			}
			if (!toolCall?.isAdvertisedTool) {
				throw new Error(`Responses tool loop returned an unadvertised tool call: ${name}.`);
			}
			if (!toolCall?.args || typeof toolCall.args != "object" || Array.isArray(toolCall.args)) {
				throw new Error(
					toolCall?.argumentsError
						? `Responses tool loop returned invalid arguments for ${name}: ${toolCall.argumentsError}`
						: `Responses tool loop returned invalid arguments for ${name}: expected one JSON object.`
				);
			}
		}
		if (!reply && !toolCalls.length) {
			throw new Error("Responses tool loop returned no function calls or assistant text.");
		}
	},

	_normalizeNativeAssistantResponse(response = {}, options = {}) {
		let reply = String(response?.text || "").trim();
		let toolCalls = this._normalizeToolCalls(Array.isArray(response?.functionCalls) ? response.functionCalls : [], options);
		return {
			reply,
			thinking: "",
			toolCalls,
		};
	},

	_normalizeToolCalls(value, options = {}) {
		let toolCatalog = options?.toolCatalog || {};
		let advertisedNames = [];
		let advertisedToolMap = new Map();
		if (Array.isArray(options?.advertisedTools)) {
			advertisedNames = options.advertisedTools
				.map((tool) => String(tool?.name || "").trim())
				.filter(Boolean);
			for (let tool of options.advertisedTools) {
				let name = String(tool?.name || "").trim();
				if (name) {
					advertisedToolMap.set(name, tool);
				}
			}
		}
		let allowed = new Set(advertisedNames);
		if (!allowed.size) {
			allowed = new Set([
				...(Array.isArray(toolCatalog?.flattened) ? toolCatalog.flattened : []).map((entry) => String(entry?.name || "").trim()).filter(Boolean),
				String(toolCatalog?.tool_search?.name || "tool_search").trim(),
			]);
		}
		if (!Array.isArray(value)) {
			return [];
		}
		return value
			.filter((entry) => entry && typeof entry == "object")
			.map((entry) => {
				let name = String(
					entry.name
					|| entry.tool
					|| entry.tool_name
					|| entry.toolName
					|| entry.id
					|| ""
				).trim();
				let argsText = String(
					entry.argumentsText
					|| entry.arguments_text
					|| ""
				).trim();
				let args = Object.prototype.hasOwnProperty.call(entry, "args")
					? entry.args
					: entry.arguments;
				let argumentsError = String(entry.argumentsError || entry.arguments_error || "").trim();
				let toolSchema = advertisedToolMap.get(name)?.parameters
					|| toolCatalog?.by_name?.[name]?.parameters
					|| null;
				let toolProperties = toolSchema?.properties && typeof toolSchema.properties == "object"
					? toolSchema.properties
					: {};
				let toolRequired = Array.isArray(toolSchema?.required) ? toolSchema.required : [];
				let acceptsEmptyObject = !!toolSchema
					&& Object.keys(toolProperties).length == 0
					&& !toolRequired.length;
				let normalizeZeroArgCall = () => {
					args = {};
					argumentsError = "";
				};
				if ((!args || typeof args != "object" || Array.isArray(args)) && argsText) {
					try {
						let parsedArgs = JSON.parse(argsText);
						if (!parsedArgs || typeof parsedArgs != "object" || Array.isArray(parsedArgs)) {
							if (acceptsEmptyObject) {
								normalizeZeroArgCall();
							}
							else {
								throw new Error("Expected one JSON object.");
							}
						}
						else {
							args = parsedArgs;
							argumentsError = "";
						}
					}
					catch (error) {
						if (acceptsEmptyObject) {
							normalizeZeroArgCall();
						}
						else {
							argumentsError = error?.message || String(error);
							args = null;
						}
					}
				}
				if (acceptsEmptyObject) {
					if (!args || typeof args != "object" || Array.isArray(args)) {
						normalizeZeroArgCall();
					}
					else if (Object.keys(args).length) {
						normalizeZeroArgCall();
					}
				}
				let hasValidArgs = !!args && typeof args == "object" && !Array.isArray(args);
				return {
					name,
					isAdvertisedTool: allowed.has(name),
					args: hasValidArgs ? args : null,
					argumentsText: argsText,
					argumentsError,
					purpose: String(entry.purpose || entry.why || "").trim(),
					callID: String(entry.callID || entry.call_id || "").trim(),
				};
			})
			.filter((entry) => entry.name);
	},

	_collectSessionToolActivations(results = [], toolCatalog = {}) {
		let namespaces = new Set();
		let toolNames = new Set();
		let toolSearchName = String(toolCatalog?.tool_search?.name || "tool_search").trim();
		for (let entry of (Array.isArray(results) ? results : [])) {
			let name = String(entry?.name || "").trim();
			if (!name) {
				continue;
			}
			if (name == toolSearchName) {
				let result = entry?.result && typeof entry.result == "object" ? entry.result : null;
				if (!entry?.ok || !result?.ok) {
					continue;
				}
				for (let namespaceID of (Array.isArray(result?.activate_namespaces) ? result.activate_namespaces : [])) {
					let normalized = String(namespaceID || "").trim();
					if (normalized) {
						namespaces.add(normalized);
					}
				}
				for (let toolName of (Array.isArray(result?.activate_tools) ? result.activate_tools : [])) {
					let normalized = String(toolName || "").trim();
					if (normalized) {
						toolNames.add(normalized);
					}
				}
				continue;
			}
			let descriptor = toolCatalog?.by_name?.[name] || null;
			if (descriptor?.namespace) {
				namespaces.add(descriptor.namespace);
			}
			else {
				toolNames.add(name);
			}
		}
		return {
			namespaces: Array.from(namespaces),
			tool_names: Array.from(toolNames),
		};
	},

	_combineSteerMessages(...messages) {
		let seen = new Set();
		let combined = [];
		for (let message of messages) {
			let normalized = String(message || "").trim();
			if (!normalized || seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			combined.push(normalized);
		}
		return combined.join("\n\n").trim();
	},

	_sessionBatchIncludesReportWrite(toolCalls = []) {
		let reportWriteTools = new Set([
			"workspace__patch_markdown",
			"workspace__patch_file",
			"workspace__apply_patch",
			"workspace__write_file",
		]);
		return (Array.isArray(toolCalls) ? toolCalls : []).some((entry) => reportWriteTools.has(String(entry?.name || "").trim()));
	},

	_isStableSuccessfulWorkflowResult(entry = {}) {
		if (!entry?.ok) {
			return false;
		}
		let result = entry?.result;
		if (!result || typeof result != "object" || Array.isArray(result)) {
			return false;
		}
		if (result.ok === false || result.error || result.queued || result.pending) {
			return false;
		}
		let status = String(result.status || "").trim().toLowerCase();
		if (status && ["queued", "pending", "running", "in_progress", "processing"].includes(status)) {
			return false;
		}
		return true;
	},

	_reportRewriteInstructionForToolResult(entry = {}, toolCall = {}) {
		if (!this._isStableSuccessfulWorkflowResult(entry)) {
			return "";
		}
		let name = String(entry?.name || "").trim();
		let result = entry?.result && typeof entry.result == "object" && !Array.isArray(entry.result)
			? entry.result
			: {};
		let args = toolCall?.args && typeof toolCall.args == "object" && !Array.isArray(toolCall.args)
			? toolCall.args
			: {};
		if (name == "harvest__open_alex") {
			return "Refresh REPORT.md now: inspect the latest Harvest entry in log.txt plus the saved harvest summary artifact, then rewrite the canonical Methods/Search Strategy or Evidence Search narrative with the exact query, query mode, Boolean field when relevant, effective filters (including language/date limits), search mode (estimate, limited, or all), any bounded max-results setting, and the grounded result counts.";
		}
		if (name == "extraction__run") {
			return "Refresh REPORT.md now: inspect the latest Extraction entry in log.txt plus the saved extraction run outputs, then rewrite the canonical Methods/Extraction Strategy and Results/Data Extraction sections in polished prose describing the template used, source scope, runtime/model, requested fields, extraction intent, and observed run outcomes.";
		}
		if (name == "screening__complete_title_abstract") {
			return "Refresh REPORT.md now: rewrite the Study Selection methods and title/abstract screening handoff narrative from the latest stage-completion result and log entry, keeping the canonical section current rather than appending dated notes.";
		}
		if (name == "full_text__finalize_unretrieved") {
			return "Refresh REPORT.md now: rewrite the study-selection or PRISMA-adjacent narrative for unretrieved full texts using the latest full-text log entry and counts, including the stable full_text_not_retrieved pathway in user-facing language.";
		}
		if (name == "full_text__complete_inclusion") {
			return "Refresh REPORT.md now: rewrite the full-text eligibility/inclusion narrative and downstream Included-scope handoff from the latest completion result and log entry.";
		}
		if (name == "descriptives__run") {
			return "Refresh REPORT.md now: use the descriptives markdown, latest log entry, and saved artifact to rewrite the relevant Results statistics section, preserving any returned citation tokens exactly.";
		}
		if (name == "explore__query") {
			if (!args.save_run && !result.saved_path && !result.output_path && !result.job_id) {
				return "";
			}
			return "Refresh REPORT.md now: use the saved Explore output, latest log entry, and grounded counts to rewrite the relevant Results synthesis section. Preserve exact citation tokens and refresh the canonical section rather than appending a dated run blurb.";
		}
		if (name == "explore__chat_run") {
			return "Refresh REPORT.md now: inspect the saved Explore chat output and latest log entry, then rewrite the relevant Results synthesis section in grounded user-facing prose while preserving exact citation tokens.";
		}
		if (name == "prisma__compute") {
			return "Refresh REPORT.md now: inspect the latest PRISMA compute log/artifact and rewrite the canonical PRISMA section from the current computed counts instead of leaving the report stale.";
		}
		return "";
	},

	_buildAutoReportRewriteSteer(results = [], toolCalls = []) {
		if (this._sessionBatchIncludesReportWrite(toolCalls)) {
			return "";
		}
		let toolCallByName = new Map();
		for (let call of (Array.isArray(toolCalls) ? toolCalls : [])) {
			let name = String(call?.name || "").trim();
			if (name && !toolCallByName.has(name)) {
				toolCallByName.set(name, call);
			}
		}
		let instructions = [];
		for (let entry of (Array.isArray(results) ? results : [])) {
			let instruction = this._reportRewriteInstructionForToolResult(entry, toolCallByName.get(String(entry?.name || "").trim()) || null);
			if (instruction && !instructions.includes(instruction)) {
				instructions.push(instruction);
			}
		}
		if (!instructions.length) {
			return "";
		}
		return [
			"A successful major workflow action just completed. Before your next final reply, refresh the relevant canonical REPORT.md section or sections now.",
			"Use workspace markdown tools to inspect REPORT.md and log.txt by headings, then patch only the affected sections.",
			"Ground the rewrite in the immediate tool result, the latest relevant log.txt entry, and any saved artifact or output from the run.",
			"Rewrite stale canonical prose. Do not append dated procedural run notes into REPORT.md.",
			...instructions,
		].join("\n");
	},

	_toolLoopSignature(toolCalls = []) {
		let normalized = (Array.isArray(toolCalls) ? toolCalls : [])
			.map((entry) => ({
				name: String(entry?.name || "").trim(),
				args: entry?.args && typeof entry.args == "object" && !Array.isArray(entry.args)
					? entry.args
					: String(entry?.argumentsText || "").trim(),
			}))
			.filter((entry) => entry.name);
		if (!normalized.length) {
			return "";
		}
		try {
			return JSON.stringify(normalized);
		}
		catch (_error) {
			return normalized.map((entry) => entry.name).join("|");
		}
	},

	async _executeSessionToolCalls(current, sessionID, toolCalls = [], options = {}) {
		let allowedCalls = Array.isArray(toolCalls) ? toolCalls.slice() : [];
		let results = [];
		let executionProjectContext = Object.assign({}, current?.context || {}, {
			projectItemKey: current?.projectItem?.key || "",
			sessionID: String(sessionID || current?.sessionID || "").trim() || "default",
			projectType: current?.projectType || current?.context?.projectType || "",
		});
		for (let toolCall of allowedCalls) {
			this._throwIfSessionAborted(options?.abortSignal || null);
			let callID = String(toolCall?.callID || "").trim()
				|| `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
			let toolName = String(toolCall?.name || "").trim();
			let hasValidArgs = !!toolCall?.args && typeof toolCall.args == "object" && !Array.isArray(toolCall.args);
			let argumentsText = String(toolCall?.argumentsText || "").trim();
			if (!argumentsText && hasValidArgs) {
				argumentsText = JSON.stringify(toolCall.args);
			}
			await this._emitSessionProgress(options.progress || null, "tool.call.started", {
				call_id: callID,
				name: toolName,
				arguments_text: argumentsText,
				purpose: String(toolCall?.purpose || "").trim(),
			});
			await this._appendSessionEventWithProgress(current.context, sessionID, "function_call", {
				role: "tool",
				title: toolName || "function_call",
				content: String(toolCall?.purpose || "").trim() || `Calling ${toolName}.`,
				payload: {
					type: "function_call",
					call_id: callID,
					name: toolName,
					arguments: argumentsText,
					status: "completed",
				},
			}, options.progress || null);
			await this._emitSessionProgress(options.progress || null, "tool.call.waiting", {
				call_id: callID,
				name: toolName,
				arguments_text: argumentsText,
			});
			try {
				if (!toolCall?.isAdvertisedTool) {
					throw new Error(`Unknown function_call tool: ${toolName}`);
				}
				if (!hasValidArgs) {
					throw new Error(
						toolCall?.argumentsError
							? `Invalid function_call arguments for ${toolName}: ${toolCall.argumentsError}`
							: `Invalid function_call arguments for ${toolName}: expected one JSON object.`
					);
				}
				await this._activateSessionContext(current, sessionID);
				let result = await this.agentTools.call(toolName, toolCall.args, {
					surface: "session",
					projectContext: executionProjectContext,
					projectID: executionProjectContext.projectID,
					sessionID: executionProjectContext.sessionID,
				});
				this._throwIfSessionAborted(options?.abortSignal || null);
				results.push({
					name: toolName,
					purpose: String(toolCall?.purpose || "").trim(),
					call_id: callID,
					ok: true,
					result,
				});
				let output = this._serializeToolResult(result);
				await this._appendSessionEventWithProgress(current.context, sessionID, "function_call_output", {
					role: "tool",
					title: toolName || "function_call_output",
					content: `Completed ${toolName}.`,
					payload: {
						type: "function_call_output",
						call_id: callID,
						output,
						status: "completed",
					},
				}, options.progress || null);
			}
			catch (error) {
				if (this._isSessionAbortError(error)) {
					throw error;
				}
				let failure = {
					ok: false,
					error: error?.message || String(error),
				};
				results.push({
					name: toolName,
					purpose: String(toolCall?.purpose || "").trim(),
					call_id: callID,
					ok: false,
					result: failure,
				});
				let output = this._serializeToolResult(failure);
				await this._appendSessionEventWithProgress(current.context, sessionID, "function_call_output", {
					role: "tool",
					title: toolName || "function_call_output",
					content: error?.message || String(error),
					payload: {
						type: "function_call_output",
						call_id: callID,
						output,
						status: "completed",
					},
				}, options.progress || null);
			}
			if (options?.emitProgress) {
				await this._refreshAllControllers();
			}
		}
		if (allowedCalls.length) {
			await this._emitSessionProgress(options.progress || null, "assistant.resumed", {
				call_count: allowedCalls.length,
			});
		}
		return { results };
	},

	async _consumePendingSessionSteer(current, sessionID, progress = null) {
		let pending = await this._consumeSessionPendingMessage(current.context, sessionID, {
			mode: "steer",
		});
		if (!pending) {
			return null;
		}
		await this._appendSessionMessageWithProgress(current.context, sessionID, "user", String(pending.content || ""), {
			eventType: "user_message",
			title: "Steer Message",
			payload: {
				queue_id: String(pending.queue_id || "").trim(),
				mode: "steer",
			},
		}, progress);
		return pending;
	},

	_formatNativeToolResultsInput(results = [], steerMessage = "") {
		let input = [];
		for (let entry of (Array.isArray(results) ? results : [])) {
			let callID = String(entry?.call_id || entry?.callID || "").trim();
			if (!callID) {
				continue;
			}
			let output = this._serializeToolResult(entry?.result);
			input.push({
				type: "function_call_output",
				call_id: callID,
				output,
			});
		}
		let steerText = String(steerMessage || "").trim();
		if (steerText) {
			input.push({
				type: "message",
				role: "user",
				content: [{
					type: "input_text",
					text: steerText,
				}],
			});
		}
		return input;
	},

	_serializeToolResult(result) {
		if (result === undefined) {
			return "null";
		}
		if (typeof result == "string") {
			return result;
		}
		try {
			return JSON.stringify(result === undefined ? null : result);
		}
		catch (_error) {
			return String(result);
		}
	},
};
