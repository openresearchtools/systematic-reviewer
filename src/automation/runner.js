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

		_freezeActiveMemoryRuntimeSnapshot(current, sessionID = "", chatClient = {}, runtimeState = {}, config = {}) {
			let client = this._cloneSessionAgentModelPayload(chatClient || {});
			return {
				session_id: String(sessionID || current?.sessionID || "default").trim() || "default",
				project_id: String(current?.context?.projectID || "").trim(),
				project_root: String(current?.context?.projectRoot || "").trim(),
				memory_key: this._memoryCompactionKey(current?.context || {}),
				chat_preset_id: String(client?.presetID || runtimeState?.chat_preset_id || "default").trim() || "default",
				chat_model_override: String(runtimeState?.chat_model_override || "").trim(),
				chat_reasoning_effort: String(client?.reasoningEffort || runtimeState?.chat_reasoning_effort || "").trim(),
				client,
				api_kind: String(client?.apiKind || config?.chatClient?.apiKind || "").trim(),
				runtime_type: String(client?.runtimeType || "").trim(),
				model: String(client?.model || "").trim(),
				base_url: String(client?.baseUrl || "").trim(),
				stream_base_url: String(client?.streamBaseUrl || "").trim(),
				context_window: Number(client?.contextWindow || 0) || 0,
				max_output_tokens: Number(client?.maxOutputTokens || 0) || 0,
				timeout_ms: Number(client?.timeoutMs || 0) || 0,
				state_mode: String(client?.stateMode || "").trim(),
				role_id: String(client?.roleID || "").trim(),
				preset_label: String(client?.presetLabel || "").trim(),
				scheduler_key: String(client?.schedulerKey || "").trim(),
				executor_id: String(client?.executorID || "").trim(),
				executor_path: String(client?.executorPath || "").trim(),
				executor_args: Array.isArray(client?.executorArgs) ? client.executorArgs.slice() : [],
			};
		},

		_activeMemoryRuntimeInvocationSnapshot(client = {}, snapshot = null) {
			let runtime = snapshot && typeof snapshot == "object" ? snapshot : {};
			let frozenClient = runtime?.client && typeof runtime.client == "object" ? runtime.client : {};
			let source = Object.assign({}, frozenClient, client || {});
			return {
				session_id: String(runtime?.session_id || "").trim(),
				project_id: String(runtime?.project_id || "").trim(),
				project_root: String(runtime?.project_root || "").trim(),
				runtime_type: String(runtime?.runtime_type || source?.runtimeType || "").trim(),
				api_kind: String(runtime?.api_kind || source?.apiKind || "").trim(),
				role_id: String(runtime?.role_id || source?.roleID || "").trim(),
				preset_id: String(runtime?.chat_preset_id || source?.presetID || "").trim(),
				preset_label: String(runtime?.preset_label || source?.presetLabel || "").trim(),
				model: String(runtime?.model || source?.model || "").trim(),
				model_override: String(runtime?.chat_model_override || "").trim(),
				reasoning_effort: String(runtime?.chat_reasoning_effort || source?.reasoningEffort || "").trim(),
				base_url: String(runtime?.base_url || source?.baseUrl || "").trim(),
				stream_base_url: String(runtime?.stream_base_url || source?.streamBaseUrl || "").trim(),
				context_window: Number(runtime?.context_window || source?.contextWindow || 0) || 0,
				max_output_tokens: Number(runtime?.max_output_tokens || source?.maxOutputTokens || 0) || 0,
				timeout_ms: Number(runtime?.timeout_ms || source?.timeoutMs || 0) || 0,
				state_mode: String(runtime?.state_mode || source?.stateMode || "").trim(),
				scheduler_key: String(runtime?.scheduler_key || source?.schedulerKey || "").trim(),
				executor_id: String(runtime?.executor_id || source?.executorID || "").trim(),
				executor_path: String(runtime?.executor_path || source?.executorPath || "").trim(),
				executor_args: Array.isArray(runtime?.executor_args)
					? runtime.executor_args.slice()
					: (Array.isArray(source?.executorArgs) ? source.executorArgs.slice() : []),
			};
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
			let memoryRuntimeSnapshot = this._freezeActiveMemoryRuntimeSnapshot(current, sessionID, chatClient, runtimeState, config);
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
						memoryRuntimeSnapshot,
						origin: options.origin || "",
					activeEntrySequenceNo: Number(options.activeEntrySequenceNo || 0) || 0,
					activeEntrySequenceNos: Array.isArray(options.activeEntrySequenceNos) ? options.activeEntrySequenceNos : [],
					activeInstructionPayload: options.activeInstructionPayload || null,
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
				synthetic: !!projection.synthetic,
				context_window: Number(projection.context_window || 0) || 0,
				safe_cap_tokens: Number(projection.safe_cap_tokens || 0) || 0,
				max_output_tokens: Number(projection.max_output_tokens || 0) || 0,
				input_budget_tokens: Number(projection.input_budget_tokens || 0) || 0,
				target_input_budget_tokens: Number(projection.target_input_budget_tokens || 0) || 0,
				head_tokens: Number(projection.head_tokens || 0) || 0,
				active_memory_tokens: Number(projection.active_memory_tokens || 0) || 0,
				tool_schema_tokens: Number(projection.tool_schema_tokens || 0) || 0,
				truncation_notice_tokens: Number(projection.truncation_notice_tokens || 0) || 0,
				raw_history_tokens: Number(projection.raw_history_tokens || 0) || 0,
				used_input_tokens: Number(projection.used_input_tokens || 0) || 0,
				estimated_input_tokens: Number(projection.estimated_input_tokens || 0) || 0,
				fits_budget: projection.fits_budget !== false,
				over_budget_tokens: Number(projection.over_budget_tokens || 0) || 0,
				truncated: !!projection.truncated,
				omitted_count: Number(projection.omitted_count || 0) || 0,
				compaction_status: projection.compaction_status || null,
				head_text: String(projection.head_text || ""),
				active_memory_text: String(projection.active_memory_text || ""),
				tool_schema_text: String(projection.tool_schema_text || ""),
					prompt_text: String(projection.prompt_text || ""),
				};
			},

			_modelInputPreviewText(input) {
				if (typeof input == "string") {
					return input;
				}
				try {
					return JSON.stringify(input, null, 2);
				}
				catch (_error) {
					return String(input || "");
				}
			},

			_promptBudgetFailureMessage(projection = null) {
				let estimated = Number(projection?.estimated_input_tokens || projection?.used_input_tokens || 0) || 0;
				let target = Number(projection?.target_input_budget_tokens || 0) || 0;
				let inputBudget = Number(projection?.input_budget_tokens || 0) || 0;
				let over = target && estimated > target
					? estimated - target
					: Math.max(0, Number(projection?.over_budget_tokens || 0) || 0);
				let parts = [
					`Prompt input is ${estimated} estimated tokens, which exceeds the current send target ${target || "unknown"} by ${over} tokens.`,
				];
				if (inputBudget) {
					parts.push(`The full input budget is ${inputBudget}; the send target is the truncation target used before the model call.`);
				}
				parts.push(`Breakdown: system plus active memory ${Number(projection?.head_tokens || 0) || 0}, tool schemas ${Number(projection?.tool_schema_tokens || 0) || 0}, active memory alone ${Number(projection?.active_memory_tokens || 0) || 0}, truncation notice ${Number(projection?.truncation_notice_tokens || 0) || 0}, selected serialized history about ${Math.max(0, estimated - (Number(projection?.head_tokens || 0) || 0) - (Number(projection?.tool_schema_tokens || 0) || 0) - (Number(projection?.truncation_notice_tokens || 0) || 0))}.`);
				parts.push("The model input preview above shows the exact serialized text that was about to be sent.");
				return parts.join(" ");
			},

			_memoryPath(context = {}) {
				return this._joinPath(context?.projectRoot || "", "memory.txt");
			},

		_activeMemoryPath(context = {}) {
			return this._joinPath(context?.projectRoot || "", "active-memory.txt");
		},

		_memoryCompactionKey(context = {}) {
			return String(context?.projectID || context?.projectRoot || "default").trim() || "default";
		},

		_setMemoryCompactionStatus(context = {}, patch = {}) {
			if (!this.memoryCompactionStatusByProject) {
				this.memoryCompactionStatusByProject = new Map();
			}
			let key = this._memoryCompactionKey(context);
			let previous = this.memoryCompactionStatusByProject.get(key) || {};
			let next = Object.assign({}, previous, patch || {}, {
				updated_at: new Date().toISOString(),
			});
			this.memoryCompactionStatusByProject.set(key, next);
			return next;
		},

		_memoryCompactionStatus(context = {}) {
			if (!this.memoryCompactionStatusByProject) {
				this.memoryCompactionStatusByProject = new Map();
			}
			return this.memoryCompactionStatusByProject.get(this._memoryCompactionKey(context)) || {
				status: "idle",
				message: "",
				updated_at: "",
			};
		},

		async _emitMemoryCompactionProgress(progress = null, type = "", context = {}, patch = {}) {
			let status = this._setMemoryCompactionStatus(context, patch || {});
			await this._emitSessionProgress(progress, type, {
				memory: status,
			});
			return status;
		},

			async _recordMemoryCompactionTimelineEvent(context = {}, sessionID = "", eventType = "", patch = {}, progress = null) {
				try {
					let payload = Object.assign({}, patch || {}, {
						active_memory_compaction: true,
					});
					await this._appendSessionEventWithProgress(context, sessionID, eventType || "memory_compaction", {
						role: "system",
						title: "Active Memory Compaction",
						content: String(patch?.message || "").trim(),
						payload,
					}, progress);
				}
				catch (error) {
					this.log?.(`active memory compaction timeline event skipped: ${error?.message || String(error)}`);
				}
			},

		async _readActiveMemoryText(context = {}) {
			let path = this._activeMemoryPath(context);
			if (!path || !(await this._pathExists(path))) {
				return "";
			}
			return String(await this._readFileText(path) || "").trim();
		},

					async _writeActiveMemoryText(context = {}, text = "", options = {}) {
						let path = this._activeMemoryPath(context);
						let trimmed = String(text || "").trim();
						if (!trimmed && options?.allowEmpty !== true) {
							throw new Error("Refusing to write empty active memory.");
						}
						let contents = trimmed ? `${trimmed}\n` : "";
					let parent = this._parentPath(path);
					let tmpName = `.active-memory.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
					let tmpPath = parent ? this._joinPath(parent, tmpName) : `${path}.${tmpName}`;
				await this._writeTextFile(tmpPath, contents);
				try {
					if (typeof IOUtils != "undefined" && IOUtils?.move) {
						await IOUtils.move(tmpPath, path, { noOverwrite: false });
					}
					else {
						let target = this._nsIFile(path);
						if (target.exists()) {
							target.remove(false);
						}
						let tmp = this._nsIFile(tmpPath);
						tmp.moveTo(target.parent, target.leafName);
					}
				}
				catch (error) {
					await this._removeIfExists(tmpPath);
					throw error;
				}
					return path;
				},

					async _readMemoryText(context = {}) {
					let path = this._memoryPath(context);
					if (!path || !(await this._pathExists(path))) {
						return "";
					}
				return String(await this._readFileText(path) || "");
			},

			_memoryTextHasTurns(memoryText = "") {
				return /(^|\n)## (?:Turn|Checkpoint)\s+/.test(String(memoryText || ""));
			},

					async _waitForActiveMemoryCompactionJob(context = {}, abortSignal = null) {
					this._throwIfSessionAborted(abortSignal);
					let key = this._memoryCompactionKey(context);
					let job = this.memoryCompactionJobs?.get(key);
					if (!job) {
						return null;
				}
				try {
					await job;
					}
					catch (_error) {}
					this._throwIfSessionAborted(abortSignal);
					return await this._readActiveMemoryText(context);
					},

					async _ensureActiveMemoryTextForPrompt(current, sessionID = "", options = {}) {
						let context = current?.context || {};
						let existing = await this._readActiveMemoryText(context);
						if (existing.trim()) {
							return existing;
						}
						await this._emitMemoryCompactionProgress(options.progress || null, "memory.compaction.warning", context, {
							status: "warning",
							message: "Active memory is empty; continuing from the serialized session prompt context while the next active-memory compaction runs.",
							session_id: String(sessionID || "default").trim() || "default",
						});
						return "";
					},

			_originFromSessionRunOptions(options = {}) {
				let payload = options?.activeInstructionPayload && typeof options.activeInstructionPayload == "object"
					? options.activeInstructionPayload
					: {};
			return String(
				options?.origin
				|| payload?.origin
				|| payload?.mode
				|| (payload?.autodrive_reviewer ? "autodrive_reviewer" : "")
				|| (payload?.autodrive ? "autodrive" : "")
				|| "ui"
			).trim() || "ui";
		},

		_latestActiveInstructionEntry(timeline = []) {
			let candidates = [];
			for (let entry of (Array.isArray(timeline) ? timeline : [])) {
				if (entry?.context_excluded) {
					continue;
				}
				let eventType = String(entry?.event_type || "").trim();
				let title = String(entry?.title || "").trim().toLowerCase();
				let payload = entry?.payload && typeof entry.payload == "object" && !Array.isArray(entry.payload)
					? entry.payload
					: {};
				let origin = String(payload?.origin || "").trim();
				let mode = String(payload?.mode || "").trim();
				let active =
					eventType == "autodrive_prompt"
					|| eventType == "autodrive_reviewer"
					|| eventType == "user_message"
					|| !!payload?.autodrive
					|| !!payload?.autodrive_reviewer
					|| ["ui", "api", "autodrive", "autodrive_reviewer", "steer", "auto_followup"].includes(origin)
					|| ["steer", "auto_followup"].includes(mode)
					|| title.includes("auto drive")
					|| title.includes("workflow follow-up")
					|| title.includes("steer message");
				if (!active) {
					continue;
				}
				candidates.push(entry);
			}
			candidates.sort((left, right) => (Number(right?.sequence_no || 0) || 0) - (Number(left?.sequence_no || 0) || 0));
			return candidates[0] || null;
		},

		_createSessionTurnMemory(current, sessionID, userMessage = "", options = {}) {
			let payload = options?.activeInstructionPayload && typeof options.activeInstructionPayload == "object"
				? Object.assign({}, options.activeInstructionPayload)
				: null;
			return {
				started_at: new Date().toISOString(),
				finished_at: "",
				project_id: String(current?.context?.projectID || "").trim(),
				project_root: String(current?.context?.projectRoot || "").trim(),
				report_path: String(current?.context?.reportPath || "").trim(),
				log_path: String(current?.context?.logPath || "").trim(),
				session_id: String(sessionID || current?.sessionID || "default").trim() || "default",
				origin: this._originFromSessionRunOptions(options),
				first_instruction: String(userMessage || "").trim(),
				first_instruction_sequence_no: Number(options?.activeEntrySequenceNo || 0) || 0,
				active_sequence_nos: Array.isArray(options?.activeEntrySequenceNos)
					? options.activeEntrySequenceNos.slice()
					: (Number(options?.activeEntrySequenceNo || 0) ? [Number(options.activeEntrySequenceNo || 0)] : []),
				active_payload: payload,
				workflow_followups: [],
				tool_artifacts: [],
				final_answer: "",
			};
		},

		_trackSessionActiveSequence(activeSequenceNos, entry = null) {
			if (!activeSequenceNos || typeof activeSequenceNos.add != "function" || !entry) {
				return;
			}
			let sequenceNo = Number(entry?.sequence_no || 0) || 0;
			if (sequenceNo) {
				activeSequenceNos.add(sequenceNo);
			}
		},

		_collectMemoryArtifactPaths(results = []) {
			let paths = new Set();
			let visit = (value, depth = 0, key = "") => {
				if (depth > 4 || value === null || value === undefined) {
					return;
				}
				if (typeof value == "string") {
					let text = String(value || "").trim();
					if (
						text
						&& (/(^|_)(path|file|artifact|job_id)$/i.test(String(key || ""))
							|| /^\/[^<>:"|?*\r\n]+/.test(text)
							|| /^[A-Za-z]:[\\/][^<>:"|?*\r\n]+/.test(text))
					) {
						paths.add(text);
					}
					return;
				}
				if (Array.isArray(value)) {
					for (let entry of value.slice(0, 40)) {
						visit(entry, depth + 1, key);
					}
					return;
				}
				if (typeof value == "object") {
					for (let [childKey, childValue] of Object.entries(value).slice(0, 80)) {
						visit(childValue, depth + 1, childKey);
					}
				}
			};
			for (let entry of (Array.isArray(results) ? results : [])) {
				visit(entry, 0, "");
			}
			return Array.from(paths).slice(0, 40);
		},

			_formatMemoryBlock(label = "", value = "") {
				let text = String(value || "").trim();
				if (!text) {
					return "";
				}
				return [`### ${label}`, "", text].join("\n");
			},

				_memoryCompactionFollowupText(followup = "") {
					let text = String(followup || "").trim();
					if (!text) {
						return "";
					}
				text = text.replace(
					/\n*Active objective to continue after the REPORT\.md refresh:\s*```text[\s\S]*?```\s*/i,
					"\nActive objective to continue after the REPORT.md refresh: provided separately in this compaction record.\n"
					);
					return text.replace(/\n{3,}/g, "\n\n").trim();
				},

				_serializedMemoryCompactionEntry(entry = {}) {
					let payload = entry?.payload && typeof entry.payload == "object" && !Array.isArray(entry.payload)
						? entry.payload
						: {};
					let normalized = {
						role: String(entry?.role || "user").trim() || "user",
						event_type: String(entry?.event_type || "user_message").trim() || "user_message",
						title: String(entry?.title || "").trim(),
						content: String(entry?.content || "").trim(),
						payload,
					};
					if (typeof SystematicReviewerTokenBudget != "undefined" && SystematicReviewerTokenBudget?.serializeTimelineEntry) {
						return SystematicReviewerTokenBudget.serializeTimelineEntry(normalized);
					}
					let lines = [];
					lines.push(`${normalized.role.toUpperCase()}${normalized.event_type ? ` [${normalized.event_type}]` : ""}${normalized.title ? ` ${normalized.title}` : ""}`.trim());
					if (normalized.content) {
						lines.push(normalized.content);
					}
					if (Object.keys(payload).length) {
						try {
							lines.push(JSON.stringify(payload, null, 2));
						}
						catch (_error) {}
					}
					return lines.filter(Boolean).join("\n").trim();
				},

				_compactionOriginEventType(origin = "") {
					let clean = String(origin || "").trim();
					if (clean == "autodrive") {
						return "autodrive_prompt";
					}
					if (clean == "autodrive_reviewer") {
						return "autodrive_reviewer";
					}
					return "user_message";
				},

			_formatSessionTurnCompactionRecord(record = {}) {
				let started = String(record?.started_at || new Date().toISOString()).trim();
					let origin = String(record?.origin || "ui").trim() || "ui";
					let activePayload = record?.active_payload && typeof record.active_payload == "object" && !Array.isArray(record.active_payload)
						? Object.assign({}, record.active_payload)
						: {};
					activePayload.origin = activePayload.origin || origin;
					activePayload.session_id = String(record?.session_id || "default").trim() || "default";
					if (Number(record?.first_instruction_sequence_no || 0) || 0) {
						activePayload.sequence_no = Number(record.first_instruction_sequence_no || 0) || 0;
					}
					if (Array.isArray(record?.active_sequence_nos) && record.active_sequence_nos.length) {
						activePayload.active_sequence_nos = record.active_sequence_nos.slice();
					}
					let serializedActive = this._serializedMemoryCompactionEntry({
						role: "user",
						event_type: this._compactionOriginEventType(origin),
						title: "Serialized Active Message",
						content: record?.first_instruction || "",
						payload: activePayload,
					});
					let followups = (Array.isArray(record?.workflow_followups) ? record.workflow_followups : [])
						.map((entry, index) => {
							let text = String(entry || "").trim();
							return text ? `### Serialized Follow-Up/Completion User Prompt ${index + 1}\n\n${this._serializedMemoryCompactionEntry({
								role: "user",
								event_type: "user_message",
								title: "Workflow Follow-up",
								content: text,
								payload: {
									mode: "auto_followup",
									origin: "auto_followup",
									session_id: String(record?.session_id || "default").trim() || "default",
								},
							})}` : "";
						})
						.filter(Boolean)
						.join("\n\n");
					let finalMessage = this._serializedMemoryCompactionEntry({
						role: "assistant",
						event_type: "responses_message",
						title: "Final Turn Message",
						content: record?.final_answer || "",
						payload: {
							session_id: String(record?.session_id || "default").trim() || "default",
							finished_at: String(record?.finished_at || "").trim(),
						},
					});
					let lines = [
						`## Turn ${started}`,
						"",
						`- Origin: ${origin}`,
						`- Session: ${String(record?.session_id || "default").trim() || "default"}`,
						record?.first_instruction_sequence_no ? `- First instruction sequence: ${Number(record.first_instruction_sequence_no || 0)}` : "",
						record?.active_sequence_nos?.length ? `- Active sequences: ${record.active_sequence_nos.join(", ")}` : "",
						"",
						`### Serialized User/Auto Drive/Reviewer Message\n\n${serializedActive}`,
						followups,
						`### Final Turn Message\n\n${finalMessage}`,
						"",
					];
					return lines.filter((line) => line !== "").join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
				},

			_formatSessionTurnMemoryRecord(record = {}) {
				let started = String(record?.started_at || new Date().toISOString()).trim();
				let followups = (Array.isArray(record?.workflow_followups) ? record.workflow_followups : [])
					.map((entry, index) => `#### Follow-up ${index + 1}\n\n${String(entry || "").trim()}`)
				.filter(Boolean)
				.join("\n\n");
			let artifacts = Array.from(new Set([
				String(record?.report_path || "").trim(),
				String(record?.log_path || "").trim(),
				...(Array.isArray(record?.tool_artifacts) ? record.tool_artifacts : []),
			].filter(Boolean)));
			let payloadText = record?.active_payload
				? this._serializeToolResult(record.active_payload)
				: "";
			let lines = [
				`## Turn ${started}`,
				"",
				`- Origin: ${String(record?.origin || "ui").trim() || "ui"}`,
				`- Session: ${String(record?.session_id || "default").trim() || "default"}`,
				record?.first_instruction_sequence_no ? `- First instruction sequence: ${Number(record.first_instruction_sequence_no || 0)}` : "",
				record?.active_sequence_nos?.length ? `- Active sequences: ${record.active_sequence_nos.join(", ")}` : "",
				`- Project root: ${String(record?.project_root || "").trim() || "(not recorded)"}`,
				"",
				this._formatMemoryBlock("First Instruction", record?.first_instruction || ""),
				this._formatMemoryBlock("Active Instruction Metadata", payloadText),
				followups ? `### Major Workflow Follow-Ups\n\n${followups}` : "",
				this._formatMemoryBlock("Final Assistant Answer", record?.final_answer || ""),
				artifacts.length ? `### Important Files And Artifacts\n\n${artifacts.map((entry) => `- ${entry}`).join("\n")}` : "",
				"",
				];
				return lines.filter((line) => line !== "").join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
			},

			_memoryFileHeader(existing = "") {
				return String(existing || "").trim()
					? String(existing || "").replace(/\s+$/g, "")
					: [
						"# Systematic Reviewer Turn Memory",
						"",
						"Append-only chronological turn memory for project inspection and active-memory rebuilds.",
					].join("\n");
			},

			async _appendProjectMemoryBlock(context = {}, block = "") {
				let recordMarkdown = String(block || "").trim();
				if (!recordMarkdown) {
					return null;
				}
				let path = this._memoryPath(context);
				let key = this._memoryCompactionKey(context);
				if (!this.memoryAppendJobs) {
					this.memoryAppendJobs = new Map();
				}
				let previous = this.memoryAppendJobs.get(key);
				let task = (async () => {
					if (previous) {
						await previous.catch(() => null);
					}
					let existing = await this._readMemoryText(context);
					let header = this._memoryFileHeader(existing);
					await this._writeTextFile(path, `${header}\n\n${recordMarkdown}\n`);
					return {
						path,
						record_markdown: recordMarkdown,
					};
				})().finally(() => {
					if (this.memoryAppendJobs?.get(key) === task) {
						this.memoryAppendJobs.delete(key);
					}
				});
				this.memoryAppendJobs.set(key, task);
				return await task;
			},

			_formatSessionCheckpointMemoryRecord(record = {}) {
				let started = String(record?.started_at || new Date().toISOString()).trim();
				let artifacts = Array.from(new Set([
					String(record?.report_path || "").trim(),
					String(record?.log_path || "").trim(),
					...(Array.isArray(record?.tool_artifacts) ? record.tool_artifacts : []),
				].filter(Boolean)));
				let lines = [
					`## Checkpoint ${started}`,
					"",
					`- Origin: ${String(record?.origin || "auto_followup").trim() || "auto_followup"}`,
					`- Session: ${String(record?.session_id || "default").trim() || "default"}`,
					record?.active_sequence_nos?.length ? `- Active sequences: ${record.active_sequence_nos.join(", ")}` : "",
					`- Project root: ${String(record?.project_root || "").trim() || "(not recorded)"}`,
					"",
					this._formatMemoryBlock("Active Instruction", record?.first_instruction || ""),
					this._formatMemoryBlock("Major Workflow Follow-Up", record?.followup || ""),
					this._formatMemoryBlock("Checkpoint State", record?.state || ""),
					artifacts.length ? `### Important Files And Artifacts\n\n${artifacts.map((entry) => `- ${entry}`).join("\n")}` : "",
					"",
				];
				return lines.filter((line) => line !== "").join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
			},

				async _appendSessionTurnMemory(context = {}, record = {}) {
					let block = this._formatSessionTurnMemoryRecord(record);
					return await this._appendProjectMemoryBlock(context, block);
				},

				_formatSessionCheckpointCompactionRecord(record = {}) {
					let started = String(record?.started_at || new Date().toISOString()).trim();
					let activePayload = {
						origin: String(record?.origin || "auto_followup").trim() || "auto_followup",
						session_id: String(record?.session_id || "default").trim() || "default",
					};
					if (Array.isArray(record?.active_sequence_nos) && record.active_sequence_nos.length) {
						activePayload.active_sequence_nos = record.active_sequence_nos.slice();
					}
					let serializedActive = this._serializedMemoryCompactionEntry({
						role: "user",
						event_type: this._compactionOriginEventType(record?.origin || "auto_followup"),
						title: "Serialized Active Message",
						content: record?.first_instruction || "",
						payload: activePayload,
					});
					let serializedFollowup = this._serializedMemoryCompactionEntry({
						role: "user",
						event_type: "user_message",
						title: "Workflow Follow-up",
						content: record?.followup || "",
						payload: {
							mode: "auto_followup",
							origin: "auto_followup",
							session_id: String(record?.session_id || "default").trim() || "default",
						},
					});
					let lines = [
						`## Checkpoint ${started}`,
						"",
						`- Origin: ${String(record?.origin || "auto_followup").trim() || "auto_followup"}`,
						`- Session: ${String(record?.session_id || "default").trim() || "default"}`,
						record?.active_sequence_nos?.length ? `- Active sequences: ${record.active_sequence_nos.join(", ")}` : "",
						"",
						`### Serialized User/Auto Drive/Reviewer Message\n\n${serializedActive}`,
						`### Serialized Follow-Up/Completion User Prompt\n\n${serializedFollowup}`,
						"",
					];
					return lines.filter((line) => line !== "").join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
				},

				async _appendSessionMemoryCheckpoint(context = {}, record = {}) {
					let block = this._formatSessionCheckpointMemoryRecord(record);
					return await this._appendProjectMemoryBlock(context, block);
				},

			async _finalizeSessionTurnMemory(current, sessionID = "", record = {}, finalAnswer = "", options = {}) {
				if (!record || record.__memory_finalized) {
					return null;
				}
				let answer = String(finalAnswer || record.final_answer || "").trim();
					record.final_answer = answer || "(No final assistant answer was produced.)";
					record.finished_at = new Date().toISOString();
					let memoryAppend = await this._appendSessionTurnMemory(current.context, record);
					record.__memory_finalized = true;
					let compactionRecord = this._formatSessionTurnCompactionRecord(record);
					let compactionJob = this._scheduleActiveMemoryCompaction(current, sessionID, compactionRecord, {
						progress: options.progress || null,
						abortSignal: options.abortSignal || null,
						chatClient: options.chatClient || null,
					config: options.config || null,
					runtimeState: options.runtimeState || null,
					memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
				});
				if (options.waitForCompaction) {
					await compactionJob.catch(() => null);
				}
				return memoryAppend;
			},

			async _recordMajorWorkflowMemoryCheckpoint(current, sessionID = "", turnMemory = {}, followup = "", options = {}) {
				let followupText = String(followup || "").trim();
				if (!followupText) {
					return null;
				}
				let record = {
					started_at: new Date().toISOString(),
					project_id: String(current?.context?.projectID || "").trim(),
					project_root: String(current?.context?.projectRoot || "").trim(),
					report_path: String(current?.context?.reportPath || "").trim(),
					log_path: String(current?.context?.logPath || "").trim(),
					session_id: String(sessionID || current?.sessionID || "default").trim() || "default",
					origin: "auto_followup",
					first_instruction: String(turnMemory?.first_instruction || "").trim(),
					active_sequence_nos: Array.isArray(turnMemory?.active_sequence_nos) ? turnMemory.active_sequence_nos.slice() : [],
					followup: followupText,
					state: [
						"A successful major workflow action completed inside an ongoing agent run.",
						"The next model step must refresh REPORT.md from the latest tool result/log/artifact and then continue the active instruction recorded above.",
						"This is an in-run checkpoint before a final assistant answer, so the final answer may still be pending.",
					].join(" "),
					tool_artifacts: Array.isArray(turnMemory?.tool_artifacts) ? turnMemory.tool_artifacts.slice() : [],
				};
					try {
						let memoryAppend = await this._appendSessionMemoryCheckpoint(current.context, record);
							let compactionRecord = this._formatSessionCheckpointCompactionRecord(record);
							let compactionJob = this._scheduleActiveMemoryCompaction(current, sessionID, compactionRecord, {
								progress: options.progress || null,
								abortSignal: options.abortSignal || null,
							chatClient: options.chatClient || null,
							config: options.config || null,
							runtimeState: options.runtimeState || null,
							memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
						});
						if (options.waitForCompaction) {
							await compactionJob.catch(() => null);
						}
						return memoryAppend;
				}
				catch (error) {
					if (this._isSessionAbortError(error)) {
						throw error;
					}
					this.log?.(`major workflow memory checkpoint failed: ${error?.message || String(error)}`);
					return null;
				}
			},

				_limitActiveMemoryText(text = "") {
					return String(text || "").trim();
				},

			async _readCompactionPromptAsset(assetPath = "", fallback = "") {
			try {
				if (SystematicReviewerAutomationDocs?.readAssetText) {
					return await SystematicReviewerAutomationDocs.readAssetText(this, assetPath);
				}
			}
			catch (_error) {}
			return String(fallback || "").trim();
		},

					_activeMemoryModelPayload(client = {}, systemPrompt = "", userPrompt = "", options = {}) {
						let snapshot = options?.memoryRuntimeSnapshot && typeof options.memoryRuntimeSnapshot == "object"
							? options.memoryRuntimeSnapshot
							: {};
						let snapshotClient = snapshot?.client && typeof snapshot.client == "object" ? snapshot.client : {};
						let maxOutputTokens = Number(
							snapshot?.max_output_tokens
							|| snapshotClient?.maxOutputTokens
							|| client?.maxOutputTokens
							|| 0
						) || 10000;
					let payload = {
						model: client.model,
						input: String(userPrompt || "").trim(),
						max_output_tokens: maxOutputTokens,
					store: false,
					stream: false,
					instructions: String(systemPrompt || "").trim(),
						tools: [],
						reasoning: client?.reasoningEffort
							? { effort: String(client.reasoningEffort || "").trim() }
							: undefined,
					};
					if (String(client?.runtimeType || "").trim() == "local_exec") {
						if (client?.roleID && !Object.prototype.hasOwnProperty.call(payload, "runtime_role_id")) {
							payload.runtime_role_id = String(client.roleID || "").trim();
						}
						if (client?.presetID && !Object.prototype.hasOwnProperty.call(payload, "runtime_preset_id")) {
							payload.runtime_preset_id = String(client.presetID || "").trim();
						}
						payload.runtime_invocation_snapshot = this._activeMemoryRuntimeInvocationSnapshot(
							client,
							options?.memoryRuntimeSnapshot || null
						);
					}
					return payload;
				},

			_memoryRuntimeEventPatch(snapshot = null) {
				let runtime = snapshot && typeof snapshot == "object" ? snapshot : {};
				let client = runtime?.client && typeof runtime.client == "object" ? runtime.client : {};
				return {
					model: String(runtime?.model || client?.model || "").trim(),
					preset_id: String(runtime?.chat_preset_id || client?.presetID || "").trim(),
					runtime_type: String(runtime?.runtime_type || client?.runtimeType || "").trim(),
					api_kind: String(runtime?.api_kind || client?.apiKind || "").trim(),
					role_id: String(runtime?.role_id || client?.roleID || "").trim(),
				};
			},

			_responseContainsExplicitBridgeTruncation(value = null, depth = 0) {
				if (depth > 5 || value === null || value === undefined) {
					return false;
				}
				if (typeof value == "string") {
					return value.includes("[... OpenCode bridge transport truncated ...]");
				}
				if (typeof value != "object") {
					return false;
				}
				if (value.truncated_for_bridge === true || value.bridge_truncated === true || value.transport_truncated === true) {
					return true;
				}
				if (Array.isArray(value)) {
					return value.some((entry) => this._responseContainsExplicitBridgeTruncation(entry, depth + 1));
				}
				for (let [key, child] of Object.entries(value)) {
					if (/truncated_for_bridge|bridge_truncated|transport_truncated/i.test(String(key || "")) && child === true) {
						return true;
					}
					if (this._responseContainsExplicitBridgeTruncation(child, depth + 1)) {
						return true;
					}
				}
				return false;
			},

			_memoryResponseTruncationReason(response = {}) {
				if (response?.truncated === true) {
					return String(response?.finishReason || response?.finish_reason || "truncated").trim() || "truncated";
				}
				let finishReason = String(response?.finishReason || response?.finish_reason || response?.raw?.finish_reason || "").trim().toLowerCase();
				if (finishReason == "length") {
					return "length";
				}
				let status = String(response?.status || response?.raw?.status || "").trim().toLowerCase();
				if (status == "incomplete" || response?.raw?.incomplete_details != null || response?.incomplete_details != null) {
					return status || "incomplete";
				}
				if (this._responseContainsExplicitBridgeTruncation(response)) {
					return "bridge transport truncated";
				}
				return "";
			},

				async _requestSessionRuntimeTextOnce(client = {}, payload = {}, options = {}) {
					let requestPayload = this._cloneSessionAgentModelPayload(payload);
					let useStream = String(client?.runtimeType || "").trim() == "local_exec";
					if (useStream) {
						requestPayload.stream = true;
					}
					let response = await SystematicReviewerPDFMarkdown.requestResponses(client, requestPayload, {
						signal: options?.abortSignal || null,
						stream: useStream,
					});
					let truncationReason = this._memoryResponseTruncationReason(response);
					if (truncationReason) {
						let reason = String(truncationReason || "truncated").trim() || "truncated";
						throw new Error(`Memory compaction returned a truncated model response: ${reason}.`);
					}
					let text = String(response?.text || "").trim();
					if (!text) {
						throw new Error("Memory compaction returned an empty response.");
				}
				return text;
			},

				async _activeMemoryRequestPayloadOnce(client = {}, payload = {}, options = {}) {
					let text = await this._requestSessionRuntimeTextOnce(client, payload, options);
					let limited = this._limitActiveMemoryText(text);
				return limited;
			},

		async _activeMemoryRequestOnce(client = {}, systemPrompt = "", userPrompt = "", options = {}) {
				let payload = this._activeMemoryModelPayload(client, systemPrompt, userPrompt, options);
			let maxRetries = this._sessionAgentModelMaxRetries();
			let lastError = null;
			for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
				this._throwIfSessionAborted(options?.abortSignal || null);
				try {
					return await this._activeMemoryRequestPayloadOnce(client, payload, options);
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
						await this._emitMemoryCompactionProgress(options.progress || null, "memory.compaction.retry", options.context || {}, {
							status: "running",
							message: `Retrying active memory ${retryIndex}/${maxRetries}...`,
							session_id: String(options?.sessionID || options?.session_id || "default").trim() || "default",
							...this._memoryRuntimeEventPatch(options?.memoryRuntimeSnapshot || null),
							retry_index: retryIndex,
							max_retries: maxRetries,
							retry_delay_ms: retryDelayMs,
							error_message: this._sessionAgentRetryErrorMessage(error),
						});
					await this._waitSessionAgentModelRetry(retryDelayMs, options.abortSignal || null);
				}
			}
			throw lastError instanceof Error ? lastError : new Error(String(lastError || "Memory compaction model call failed."));
		},

		async _withActiveMemoryRuntime(current, sessionID = "", task, options = {}) {
				let snapshot = options?.memoryRuntimeSnapshot && typeof options.memoryRuntimeSnapshot == "object"
					? options.memoryRuntimeSnapshot
					: null;
				if (snapshot?.client) {
					let frozen = this._cloneSessionAgentModelPayload(snapshot);
					return await task(this._cloneSessionAgentModelPayload(frozen.client), null, frozen);
				}
			if (options?.chatClient) {
				let runtimeState = await this._loadSessionRuntimeState(current.context, sessionID).catch(() => ({}));
				let frozen = this._freezeActiveMemoryRuntimeSnapshot(current, sessionID, options.chatClient, runtimeState, options.config || {});
				return await task(this._cloneSessionAgentModelPayload(frozen.client), options.config || null, frozen);
			}
			let config = await this._conversionConfig();
			this._assertSessionChatExecutionReady(config);
			let runtimeState = await this._loadSessionRuntimeState(current.context, sessionID);
			let prepared = await this._prepareRoleAPIClient("session_chat", config.chatClient, config, {
				presetID: runtimeState?.chat_preset_id || "default",
				modelOverride: runtimeState?.chat_model_override || "",
				reasoningEffort: runtimeState?.chat_reasoning_effort || "",
				cwd: current?.context?.projectRoot || "",
			});
			try {
				let client = prepared.client || config.chatClient;
				let preparedClientHasReasoning = Object.prototype.hasOwnProperty.call(prepared?.client || {}, "reasoningEffort");
				client.reasoningEffort = String(
					preparedClientHasReasoning
						? prepared.client.reasoningEffort
						: (runtimeState?.chat_reasoning_effort || "")
				).trim().toLowerCase();
				let frozen = this._freezeActiveMemoryRuntimeSnapshot(current, sessionID, client, runtimeState, config);
				return await task(this._cloneSessionAgentModelPayload(frozen.client), config, frozen);
			}
			finally {
				await prepared?.release?.();
			}
		},

			async _runActiveMemoryCompaction(current, sessionID, recordMarkdown = "", options = {}) {
				let context = current?.context || {};
				let existingActiveMemory = await this._readActiveMemoryText(context);
			let systemPrompt = await this._readCompactionPromptAsset(
				"automation/docs/prompts/compaction-system.md",
				"You maintain compact working memory for Systematic Reviewer. Return only replacement Active Memory markdown with the required sections."
			);
			let userTemplate = await this._readCompactionPromptAsset(
				"automation/docs/prompts/compaction-user.md",
				"Build the next Active Memory from the prior Active Memory and the new chronological turn record. Return only replacement Active Memory markdown."
			);
			let prompt = [
				userTemplate,
				"",
				"Prior Active Memory:",
				"```text",
				existingActiveMemory || "(empty)",
				"```",
				"",
				"New Chronological Turn Record:",
				"```text",
				String(recordMarkdown || "").trim() || "(empty)",
				"```",
			].join("\n");
					let compacted = await this._withActiveMemoryRuntime(current, sessionID, async (client, _config, frozen) => (
						await this._activeMemoryRequestOnce(client, systemPrompt, prompt, Object.assign({}, options, {
							context,
							sessionID,
							memoryRuntimeSnapshot: frozen || options?.memoryRuntimeSnapshot || null,
						}))
					), options);
				let path = await this._writeActiveMemoryText(context, compacted);
			return {
				ok: true,
				session_id: String(sessionID || "default").trim() || "default",
				active_memory_path: path,
				active_memory_tokens: SystematicReviewerTokenBudget.estimateTextTokens(compacted),
			};
		},

		_scheduleActiveMemoryCompaction(current, sessionID, recordMarkdown = "", options = {}) {
			let context = current?.context || {};
			let key = this._memoryCompactionKey(context);
			if (!this.memoryCompactionJobs) {
				this.memoryCompactionJobs = new Map();
			}
				let previous = this.memoryCompactionJobs.get(key);
				let frozenOptions = Object.assign({}, options || {});
				if (frozenOptions.memoryRuntimeSnapshot) {
					frozenOptions.memoryRuntimeSnapshot = this._cloneSessionAgentModelPayload(frozenOptions.memoryRuntimeSnapshot);
				}
				else if (frozenOptions.chatClient) {
					frozenOptions.memoryRuntimeSnapshot = this._freezeActiveMemoryRuntimeSnapshot(
						current,
						sessionID,
					frozenOptions.chatClient,
					frozenOptions.runtimeState || {},
					frozenOptions.config || {}
				);
			}
			let task = (async () => {
				if (previous) {
					await previous.catch(() => null);
				}
					await this._emitMemoryCompactionProgress(frozenOptions.progress || null, "memory.compaction.started", context, {
						status: "running",
						message: "Updating active memory...",
						session_id: String(sessionID || "default").trim() || "default",
						...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
					});
				try {
					await Zotero.Promise.delay(0);
				}
				catch (_error) {}
						try {
							let result = await this._runActiveMemoryCompaction(current, sessionID, recordMarkdown, frozenOptions);
								await this._emitMemoryCompactionProgress(frozenOptions.progress || null, "memory.compaction.completed", context, {
									status: "complete",
									message: "Active memory updated",
								session_id: String(sessionID || "default").trim() || "default",
								...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
								active_memory_path: result.active_memory_path,
								active_memory_tokens: result.active_memory_tokens,
							});
								await this._recordMemoryCompactionTimelineEvent(context, sessionID, "memory_compaction_completed", {
									status: "complete",
									message: "Active memory updated",
									session_id: String(sessionID || "default").trim() || "default",
									...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
									active_memory_path: result.active_memory_path,
									active_memory_tokens: result.active_memory_tokens,
								}, frozenOptions.progress || null);
							return result;
						}
						catch (error) {
							if (this._isSessionAbortError(error)) {
								await this._emitMemoryCompactionProgress(frozenOptions.progress || null, "memory.compaction.stopped", context, {
								status: "idle",
								message: "Active memory update stopped",
									session_id: String(sessionID || "default").trim() || "default",
									...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
								});
								await this._recordMemoryCompactionTimelineEvent(context, sessionID, "memory_compaction_stopped", {
									status: "idle",
									message: "Active memory update stopped",
									session_id: String(sessionID || "default").trim() || "default",
									...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
								}, frozenOptions.progress || null);
								return null;
							}
							this.log?.(`active memory compaction failed: ${error?.message || String(error)}`);
							await this._emitMemoryCompactionProgress(frozenOptions.progress || null, "memory.compaction.failed", context, {
								status: "error",
							message: error?.message || String(error),
								session_id: String(sessionID || "default").trim() || "default",
								...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
							});
							await this._recordMemoryCompactionTimelineEvent(context, sessionID, "memory_compaction_failed", {
								status: "error",
								message: error?.message || String(error),
								session_id: String(sessionID || "default").trim() || "default",
								...this._memoryRuntimeEventPatch(frozenOptions.memoryRuntimeSnapshot || null),
							}, frozenOptions.progress || null);
							return null;
						}
			})().finally(() => {
				if (this.memoryCompactionJobs?.get(key) === task) {
					this.memoryCompactionJobs.delete(key);
				}
			});
			this.memoryCompactionJobs.set(key, task);
			return task;
		},

			_splitMemoryTextForRebuild(memoryText = "", targetTokens = 0) {
			let chunks = [];
				let parts = String(memoryText || "").split(/\n(?=## (?:Turn|Checkpoint)\s+)/g).filter((part) => String(part || "").trim());
			let limit = Math.max(2000, Number(targetTokens || 0) || 12000);
			let current = "";
			for (let part of parts.length ? parts : [String(memoryText || "")]) {
				let next = current ? `${current}\n\n${part}` : part;
				if (current && SystematicReviewerTokenBudget.estimateTextTokens(next) > limit) {
					chunks.push(current);
					current = part;
				}
				else {
					current = next;
				}
			}
			if (current.trim()) {
				chunks.push(current);
			}
			return chunks.length ? chunks : [String(memoryText || "")];
		},

			async _rebuildActiveMemory(current, sessionID = "", options = {}) {
				let context = current?.context || {};
				let memoryText = await this._readMemoryText(context);
				if (!memoryText.trim()) {
					return {
						ok: false,
						mode: "empty",
						chunk_count: 0,
						active_memory_path: this._activeMemoryPath(context),
						message: "memory.txt is empty; active-memory.txt was left unchanged.",
					};
				}
			let systemPrompt = await this._readCompactionPromptAsset(
				"automation/docs/prompts/compaction-system.md",
				"You are rebuilding compact active memory from chronological Systematic Reviewer turn memory. Return only markdown using the required sections."
			);
			let rebuildIntro = [
				"Build replacement Active Memory from the following chronological turn memory.",
				"Preserve chronology: older work belongs in Older History, recent turns in Recent Work, and the latest actionable objective in Current Objective and Next Best Action.",
				"Return plain markdown only using the required section headings.",
			].join("\n");
			let result = await this._withActiveMemoryRuntime(current, sessionID, async (client) => {
				let budget = SystematicReviewerTokenBudget.inputBudget(
					Number(client?.contextWindow || 0) || 0,
					Number(client?.maxOutputTokens || 0) || 8000
				);
				let promptTokens = SystematicReviewerTokenBudget.estimateTextTokens(`${systemPrompt}\n\n${rebuildIntro}\n\n${memoryText}`);
				let target = budget.input_budget_tokens ? Math.floor(budget.input_budget_tokens * 0.75) : 0;
				if (!target || promptTokens <= target) {
						let compacted = await this._activeMemoryRequestOnce(client, systemPrompt, [
							rebuildIntro,
							"",
							"Full Chronological Turn Memory:",
								"```text",
							memoryText,
							"```",
						].join("\n"), Object.assign({}, options, {
							context,
							sessionID,
						}));
						let path = await this._writeActiveMemoryText(context, compacted);
					return {
						ok: true,
						mode: "single",
						chunk_count: 1,
						active_memory_path: path,
						active_memory_tokens: SystematicReviewerTokenBudget.estimateTextTokens(compacted),
					};
				}
				let chunks = this._splitMemoryTextForRebuild(memoryText, Math.max(2000, target - SystematicReviewerTokenBudget.estimateTextTokens(systemPrompt) - 1200));
				let summaries = [];
				for (let index = 0; index < chunks.length; index += 1) {
					let summary = await this._activeMemoryRequestOnce(client, systemPrompt, [
						"Summarize this chronological memory slice for later final Active Memory rebuilding.",
						`Slice ${index + 1} of ${chunks.length}. Preserve whether this slice is older or newer than adjacent slices.`,
							"",
							"```text",
							chunks[index],
							"```",
						].join("\n"), Object.assign({}, options, {
							context,
							sessionID,
						}));
					summaries.push(summary);
				}
				let combined = await this._activeMemoryRequestOnce(client, systemPrompt, [
					rebuildIntro,
					"",
					"Chronological slice summaries, oldest to newest:",
					"",
					summaries.map((summary, index) => `## Slice ${index + 1}\n\n${summary}`).join("\n\n"),
				].join("\n"), Object.assign({}, options, {
					context,
					sessionID,
				}));
				let path = await this._writeActiveMemoryText(context, combined);
				return {
					ok: true,
					mode: "split",
					chunk_count: chunks.length,
					active_memory_path: path,
					active_memory_tokens: SystematicReviewerTokenBudget.estimateTextTokens(combined),
				};
			}, options);
			this._setMemoryCompactionStatus(context, {
				status: "complete",
				message: "Memory rebuilt",
				session_id: String(sessionID || "default").trim() || "default",
				active_memory_path: result.active_memory_path,
				active_memory_tokens: result.active_memory_tokens,
			});
			return result;
		},

			async _runSessionAgentNative(current, sessionID, userMessage, options = {}) {
				let maxSteps = 1000;
				let previousResponseID = String(options?.runtimeState?.chat_previous_response_id || "").trim();
				let nextInputAfterTools = null;
				let activeSequenceNos = new Set();
				if (Number(options?.activeEntrySequenceNo || 0) || 0) {
				activeSequenceNos.add(Number(options.activeEntrySequenceNo || 0) || 0);
			}
			for (let sequenceNo of (Array.isArray(options?.activeEntrySequenceNos) ? options.activeEntrySequenceNos : [])) {
				let value = Number(sequenceNo || 0) || 0;
				if (value) {
					activeSequenceNos.add(value);
				}
				}
				let turnMemory = this._createSessionTurnMemory(current, sessionID, userMessage, options);
				let latestActiveInstructionText = String(userMessage || "").trim();
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
				try {
					for (let step = 1; step <= maxSteps; step += 1) {
						this._throwIfSessionAborted(options?.abortSignal || null);
							let promptPacket = await this._buildSessionPromptPacket(current, sessionID, {
								chatClient: options.chatClient,
								config: options.config,
								runtimeState: options.runtimeState || null,
								stateful: !!options.stateful,
								memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
								activeNamespaces: Array.from(loadedNamespaces),
						activeToolNames: Array.from(loadedToolNames),
						activeEntrySequenceNos: Array.from(activeSequenceNos),
						transport: "native",
						progress: options.progress || null,
						abortSignal: options.abortSignal || null,
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
					await this._emitSessionProgress(options.progress || null, "prompt.preview", {
						step,
						stateful: !!options.stateful,
						model: String(promptPacket?.chatClient?.model || "").trim(),
						previous_response_id: String(previousResponseID || "").trim(),
						input_text: this._modelInputPreviewText(stepInput),
						instructions_text: options.stateful ? String(promptPacket?.headText || "").trim() : "",
						head_text: String(promptPacket?.projection?.head_text || promptPacket?.headText || "").trim(),
						active_memory_text: String(promptPacket?.projection?.active_memory_text || promptPacket?.activeMemoryText || "").trim(),
						tool_schema_text: String(promptPacket?.projection?.tool_schema_text || SystematicReviewerSlidingContext.serializeToolSchemaText({ tools: promptPacket.tools }) || "").trim(),
						prompt_text: String(promptPacket?.projection?.prompt_text || "").trim(),
						chat_budget: this._chatBudgetFromProjection(promptPacket.projection),
					});
					if (!options.stateful && promptPacket?.projection?.fits_budget === false) {
						throw new Error(this._promptBudgetFailureMessage(promptPacket.projection));
					}
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
							this._trackSessionActiveSequence(activeSequenceNos, steerMessage.entry || null);
							turnMemory.workflow_followups.push(`Steer message:\n${String(steerMessage.content || "").trim()}`);
							nextInputAfterTools = null;
							userMessage = steerMessage.content;
							latestActiveInstructionText = String(steerMessage.content || "").trim() || latestActiveInstructionText;
							continue;
						}
							await this._finalizeSessionTurnMemory(current, sessionID, turnMemory, reply, {
								progress: options.progress || null,
								abortSignal: options.abortSignal || null,
								chatClient: options.chatClient || null,
								config: options.config || null,
								runtimeState: options.runtimeState || null,
								memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
							});
						return reply;
					}
				let execution = await this._executeSessionToolCalls(current, sessionID, toolCalls, {
					emitProgress: !!options.emitProgress,
					progress: options.progress || null,
					abortSignal: options.abortSignal || null,
				});
				let artifactPaths = this._collectMemoryArtifactPaths(execution.results || []);
				for (let path of artifactPaths) {
					if (!turnMemory.tool_artifacts.includes(path)) {
						turnMemory.tool_artifacts.push(path);
					}
				}
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
					let steerMessage = await this._consumePendingSessionSteer(current, sessionID, options.progress || null);
					if (steerMessage) {
						this._trackSessionActiveSequence(activeSequenceNos, steerMessage.entry || null);
						turnMemory.workflow_followups.push(`Steer message:\n${String(steerMessage.content || "").trim()}`);
					}
					let activeInstructionForFollowup = this._combineSteerMessages(
						latestActiveInstructionText || turnMemory.first_instruction || userMessage,
						steerMessage?.content || ""
					);
					let autoSteer = this._buildAutoReportRewriteSteer(execution.results || [], toolCalls, {
						activeInstruction: activeInstructionForFollowup,
					});
					if (autoSteer) {
						loadedNamespaces.add("workspace");
						turnMemory.workflow_followups.push(autoSteer);
					}
					let combinedSteer = this._combineSteerMessages(autoSteer, steerMessage?.content || "");
					if (autoSteer && !options.stateful) {
						let followupEntry = await this._appendSessionMessageWithProgress(current.context, sessionID, "user", autoSteer, {
							eventType: "user_message",
							title: "Workflow Follow-up",
							payload: {
							mode: "auto_followup",
							origin: "auto_followup",
						},
						}, options.progress || null);
						this._trackSessionActiveSequence(activeSequenceNos, followupEntry);
					}
					if (autoSteer) {
						turnMemory.active_sequence_nos = Array.from(activeSequenceNos);
							await this._recordMajorWorkflowMemoryCheckpoint(current, sessionID, turnMemory, autoSteer, {
								progress: options.progress || null,
								abortSignal: options.abortSignal || null,
								chatClient: options.chatClient || null,
								config: options.config || null,
								runtimeState: options.runtimeState || null,
								memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
							});
					}
					if (combinedSteer) {
						userMessage = combinedSteer;
						latestActiveInstructionText = activeInstructionForFollowup || latestActiveInstructionText;
					}
					if (options.stateful) {
						nextInputAfterTools = this._formatNativeToolResultsInput(execution.results || [], combinedSteer);
					}
				}
				throw new Error("The model kept requesting more tool steps without reaching a final answer, so the run was stopped.");
				}
				catch (error) {
					if (!this._isSessionAbortError(error)) {
						let message = error?.message || String(error);
						try {
								await this._finalizeSessionTurnMemory(current, sessionID, turnMemory, `Run ended with error before a final assistant answer: ${message}`, {
									progress: options.progress || null,
									abortSignal: options.abortSignal || null,
									chatClient: options.chatClient || null,
									config: options.config || null,
									runtimeState: options.runtimeState || null,
									memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
								});
						}
						catch (memoryError) {
							this.log?.(`session turn memory finalization failed after run error: ${memoryError?.message || String(memoryError)}`);
						}
					}
					throw error;
				}
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
				let activeMemoryText = await this._ensureActiveMemoryTextForPrompt(current, sessionID, {
					progress: options.progress || null,
					abortSignal: options.abortSignal || null,
					chatClient: options.chatClient || null,
					config: options.config || null,
					runtimeState: options.runtimeState || null,
					memoryRuntimeSnapshot: options.memoryRuntimeSnapshot || null,
				});
			let latestActive = this._latestActiveInstructionEntry(timeline);
			let requiredEntrySequenceNos = Array.isArray(options.activeEntrySequenceNos) && options.activeEntrySequenceNos.length
				? options.activeEntrySequenceNos
				: (latestActive?.sequence_no ? [latestActive.sequence_no] : []);
			let stateful = !!options.stateful;
			let responseTools = this._sessionResponseTools(toolCatalog, {
				activeNamespaces: options.activeNamespaces || [],
				activeToolNames: options.activeToolNames || [],
			});
			let projection = stateful
				? SystematicReviewerSlidingContext.buildStatefulProjection({
					headText,
					activeMemoryText,
					tools: responseTools,
					timeline,
					contextWindow: Number(options?.chatClient?.contextWindow || 0) || 0,
					maxOutputTokens: Number(options?.chatClient?.maxOutputTokens || 0) || 0,
				})
				: SystematicReviewerSlidingContext.buildProjection({
					headText,
					tools: responseTools,
					headEntry: {
						role: "system",
						event_type: "system_prompt",
						title: "Pinned Prompt Context",
						synthetic: true,
						content: headText,
					},
					timeline,
					contextWindow: Number(options?.chatClient?.contextWindow || 0) || 0,
					maxOutputTokens: Number(options?.chatClient?.maxOutputTokens || 0) || 0,
					activeMemoryText,
					requiredEntrySequenceNos,
					pinnedStartCount: 0,
					maxContentChars: 12000,
					maxPayloadChars: 8000,
				});
			projection.compaction_status = this._memoryCompactionStatus(current.context);
			return {
				headText: projection.head_text || headText,
				baseHeadText: headText,
				activeMemoryText,
				sessionState,
				inspection,
				projectCounts,
				availableScopes,
				toolCatalog,
				timeline,
				projection,
				tools: responseTools,
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

		_buildAutoReportRewriteSteer(results = [], toolCalls = [], options = {}) {
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
			let activeInstruction = String(options?.activeInstruction || "").trim();
			if (activeInstruction.length > 7000) {
				activeInstruction = `${activeInstruction.slice(0, 7000)}\n\n[Active instruction truncated inside workflow follow-up; use active memory and the session timeline for the full instruction if needed.]`;
			}
			let activeInstructionBlock = activeInstruction
				? [
					"Active objective to continue after the REPORT.md refresh:",
					"```text",
					activeInstruction,
					"```",
				]
				: [
					"Active objective to continue after the REPORT.md refresh: continue the latest user, API, Auto Drive, reviewer, steer, or workflow-follow-up instruction from the injected active memory and session context.",
				];
			return [
					"A successful major workflow action just completed. Before your next final reply, refresh the relevant canonical REPORT.md section or sections now.",
					...activeInstructionBlock,
					"Use workspace markdown tools to inspect REPORT.md and log.txt by headings, then patch only the affected sections.",
					"Ground the rewrite in the immediate tool result, the latest relevant log.txt entry, and any saved artifact or output from the run.",
					"Rewrite stale canonical prose. Do not append dated procedural run notes into REPORT.md.",
					"After the report refresh, resume the active objective quoted above plus any still-current constraints in injected active memory. Do not treat report refresh as completion of the broader task unless that quoted objective was only to refresh the report.",
					"If the report refresh fully completes the quoted user, API, Auto Drive, reviewer, steer, or workflow-follow-up objective, say so clearly; otherwise keep working toward that objective.",
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
			let entry = await this._appendSessionMessageWithProgress(current.context, sessionID, "user", String(pending.content || ""), {
				eventType: "user_message",
				title: "Steer Message",
				payload: {
					queue_id: String(pending.queue_id || "").trim(),
					mode: "steer",
					origin: "steer",
				},
			}, progress);
			return Object.assign({}, pending, { entry });
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
