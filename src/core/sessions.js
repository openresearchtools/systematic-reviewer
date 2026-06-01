var SystematicReviewerSessions = {
	_sessionDir(context, sessionID) {
		return this._joinPath(context.sessionsDir, String(sessionID || "default").trim() || "default");
	},

	_sessionMetaPath(context, sessionID) {
		return this._joinPath(this._sessionDir(context, sessionID), "session.json");
	},

	_sessionHistoryPath(context, sessionID) {
		return this._joinPath(this._sessionDir(context, sessionID), "chat_history.json");
	},

	_defaultSessionMeta(context, sessionID, overrides = {}) {
		let now = new Date().toISOString();
		return Object.assign({
			session_id: String(sessionID || "default").trim() || "default",
			title: "Collection Session",
			created_at: now,
			updated_at: now,
			chat_preset_id: "default",
			chat_previous_response_id: "",
			chat_reasoning_effort: "",
			chat_model_override: "",
			mode: "intake",
			status: "active",
			summary: {},
			pending_messages: [],
		}, overrides || {});
	},

	_normalizeSessionReasoningEffort(value) {
		if (typeof this._normalizeReasoningEffort == "function") {
			return this._normalizeReasoningEffort(value, { allowCustom: true });
		}
		let clean = String(value || "").trim().toLowerCase();
		return clean && clean != "default" ? clean : "";
	},

	_normalizePendingMessageMode(value) {
		return String(value || "").trim() == "steer" ? "steer" : "queued";
	},

	_normalizePendingMessage(entry = {}, index = 0) {
		let content = String(entry?.content || "").trim();
		if (!content) {
			return null;
		}
		let createdAt = String(entry?.created_at || "").trim() || new Date().toISOString();
		let updatedAt = String(entry?.updated_at || "").trim() || createdAt;
		return {
			queue_id: String(entry?.queue_id || `queued-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`).trim(),
			mode: this._normalizePendingMessageMode(entry?.mode || "queued"),
			content,
			payload: entry?.payload && typeof entry.payload == "object" && !Array.isArray(entry.payload)
				? Object.assign({}, entry.payload)
				: null,
			created_at: createdAt,
			updated_at: updatedAt,
		};
	},

	_normalizePendingMessages(entries = []) {
		let normalized = [];
		for (let [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
			let next = this._normalizePendingMessage(entry, index);
			if (next) {
				normalized.push(next);
			}
		}
		normalized.sort((left, right) => {
			if (left.mode != right.mode) {
				return left.mode == "steer" ? -1 : 1;
			}
			return String(left.created_at || "").localeCompare(String(right.created_at || ""));
		});
		return normalized;
	},

	async _ensureSessionDirectory(context, sessionID) {
		let sessionDir = this._sessionDir(context, sessionID);
		await this._ensureDirectory(context.sessionsDir);
		await this._ensureDirectory(sessionDir);
		return sessionDir;
	},

	async _sessionIDsOnDisk(context) {
		await this._ensureDirectory(context.sessionsDir);
		let dir = this._nsIFile(context.sessionsDir);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let ids = [];
		let entries = dir.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.isDirectory?.()) {
				continue;
			}
			let sessionID = String(entry.leafName || "").trim();
			if (sessionID) {
				ids.push(sessionID);
			}
		}
		return ids.sort();
	},

	async _loadSessionMeta(context, sessionID, options = {}) {
		let target = String(sessionID || "default").trim() || "default";
		let metaPath = this._sessionMetaPath(context, target);
		let existing = (await this._readJSONFile(metaPath)) || null;
		if (!existing && options.create !== true) {
			return null;
		}
		let history = (await this._readJSONFile(this._sessionHistoryPath(context, target))) || [];
		let createdAt = String(existing?.created_at || history?.[0]?.created_at || "").trim() || new Date().toISOString();
		let updatedAt = String(
			existing?.updated_at
			|| history?.[history.length - 1]?.created_at
			|| createdAt
		).trim() || createdAt;
		let meta = this._defaultSessionMeta(context, target, {
			title: this._normalizeSessionTitle(existing?.title || "") || this._sessionTitleFromDate(updatedAt),
			created_at: createdAt,
			updated_at: updatedAt,
			chat_preset_id: String(existing?.chat_preset_id || "default").trim() || "default",
			chat_previous_response_id: String(existing?.chat_previous_response_id || "").trim(),
			chat_reasoning_effort: this._normalizeSessionReasoningEffort(existing?.chat_reasoning_effort || ""),
			chat_model_override: String(existing?.chat_model_override || "").trim(),
			mode: this._normalizeSessionMode(existing?.mode || "intake"),
			status: this._normalizeSessionStatus(existing?.status || "active"),
			summary: existing?.summary && typeof existing.summary == "object" ? existing.summary : {},
			pending_messages: this._normalizePendingMessages(existing?.pending_messages || []),
		});
		if (options.create === true && !existing) {
			await this._saveSessionMeta(context, target, meta);
		}
		return meta;
	},

	async _saveSessionMeta(context, sessionID, meta = {}) {
		let target = String(sessionID || "default").trim() || "default";
		await this._ensureSessionDirectory(context, target);
		let next = this._defaultSessionMeta(context, target, meta || {});
		next.title = this._normalizeSessionTitle(next.title) || this._sessionTitleFromDate(next.updated_at || next.created_at);
		next.mode = this._normalizeSessionMode(next.mode);
		next.status = this._normalizeSessionStatus(next.status);
		next.summary = next.summary && typeof next.summary == "object" ? next.summary : {};
		next.pending_messages = this._normalizePendingMessages(next.pending_messages || []);
		await this._writeJSONFile(this._sessionMetaPath(context, target), next);
		return next;
	},

	async _loadSessionTimeline(context, sessionID) {
		let target = String(sessionID || "default").trim() || "default";
		let historyPath = this._sessionHistoryPath(context, target);
		let raw = (await this._readJSONFile(historyPath)) || [];
		if (!Array.isArray(raw)) {
			raw = [];
		}
		return raw.map((entry, index) => ({
			session_id: target,
			sequence_no: Number(entry?.sequence_no || index + 1) || (index + 1),
			event_type: String(entry?.event_type || (entry?.role == "assistant" ? "assistant_final" : entry?.role == "user" ? "user_message" : "message")).trim(),
			role: String(entry?.role || "system").trim() || "system",
			title: String(entry?.title || "").trim(),
			content: String(entry?.content || ""),
			payload: Object.prototype.hasOwnProperty.call(entry || {}, "payload") ? entry.payload : null,
			created_at: String(entry?.created_at || "").trim(),
			synthetic: !!entry?.synthetic,
			context_excluded: !!entry?.context_excluded,
		}));
	},

	async _saveSessionTimeline(context, sessionID, timeline = []) {
		let target = String(sessionID || "default").trim() || "default";
		await this._ensureSessionDirectory(context, target);
		let normalized = (Array.isArray(timeline) ? timeline : []).map((entry, index) => ({
			session_id: target,
			sequence_no: Number(entry?.sequence_no || index + 1) || (index + 1),
			event_type: String(entry?.event_type || (entry?.role == "assistant" ? "assistant_final" : entry?.role == "user" ? "user_message" : "message")).trim(),
			role: String(entry?.role || "system").trim() || "system",
			title: String(entry?.title || "").trim(),
			content: String(entry?.content || ""),
			payload: Object.prototype.hasOwnProperty.call(entry || {}, "payload") ? entry.payload : null,
			created_at: String(entry?.created_at || "").trim() || new Date().toISOString(),
			synthetic: !!entry?.synthetic,
			context_excluded: !!entry?.context_excluded,
		}));
		await this._writeJSONFile(this._sessionHistoryPath(context, target), normalized);
		let meta = await this._loadSessionMeta(context, target, { create: true });
		meta.updated_at = String(normalized[normalized.length - 1]?.created_at || meta.updated_at || new Date().toISOString()).trim();
		await this._saveSessionMeta(context, target, meta);
		return normalized;
	},

	async _appendSessionRecord(context, sessionID, record = {}) {
		let target = String(sessionID || "default").trim() || "default";
		let timeline = await this._loadSessionTimeline(context, target);
		let now = new Date().toISOString();
		let next = {
			session_id: target,
			sequence_no: Number(timeline[timeline.length - 1]?.sequence_no || 0) + 1,
			event_type: String(record?.event_type || "message").trim() || "message",
			role: String(record?.role || "system").trim() || "system",
			title: String(record?.title || "").trim(),
			content: String(record?.content || ""),
			payload: Object.prototype.hasOwnProperty.call(record || {}, "payload") ? record.payload : null,
			created_at: now,
			synthetic: !!record?.synthetic,
			context_excluded: !!record?.context_excluded,
		};
		timeline.push(next);
		await this._saveSessionTimeline(context, target, timeline);
		await this._writeSettingsLastSession(context, target);
		return next;
	},

	async _desiredSessionID(context) {
		let settings = (await this._readJSONFile(context.settingsPath)) || {};
		let configured = String(settings.last_session_id || "").trim();
		if (configured) {
			return configured;
		}
		let sessionIDs = await this._sessionIDsOnDisk(context);
		if (!sessionIDs.length) {
			return "default";
		}
		let metas = [];
		for (let sessionID of sessionIDs) {
			let meta = await this._loadSessionMeta(context, sessionID, { create: false }).catch(() => null);
			if (meta) {
				metas.push(meta);
			}
		}
		metas.sort((left, right) => String(right?.updated_at || "").localeCompare(String(left?.updated_at || "")));
		return String(metas[0]?.session_id || sessionIDs[0] || "default").trim() || "default";
	},

	async _ensureActiveSession(context) {
		let sessionID = await this._desiredSessionID(context);
		await this._loadSessionMeta(context, sessionID, { create: true });
		await this._writeSettingsLastSession(context, sessionID);
		return sessionID;
	},

	async _createSession(context, { sessionID = "", title = "", activate = true } = {}) {
		let now = new Date().toISOString();
		let nextSessionID = String(sessionID || "").trim() || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		let meta = this._defaultSessionMeta(context, nextSessionID, {
			title: this._normalizeSessionTitle(title) || this._sessionTitleFromDate(now),
			created_at: now,
			updated_at: now,
		});
		await this._saveSessionMeta(context, nextSessionID, meta);
		await this._saveSessionTimeline(context, nextSessionID, []);
		if (activate) {
			await this._writeSettingsLastSession(context, nextSessionID);
		}
		return nextSessionID;
	},

	async _startNewSession(controller) {
		let current = await this._resolveControllerProject(controller);
		if (!current) {
			return;
		}
		let sessionID = await this._createSession(current.context, { activate: true });
		controller.projectRef = this._projectReferenceData(current, { sessionID });
		await this._refreshController(controller);
		this._setStatus(controller, "New session started", "ready");
	},

	async _writeSettingsLastSession(context, sessionID) {
		let settings = (await this._readJSONFile(context.settingsPath)) || {};
		settings.kind = settings.kind || "systematic-reviewer-settings";
		settings.version = settings.version || 1;
		settings.collection = settings.collection || {
			library_id: context.libraryID,
			key: context.collectionKey,
			name: context.collectionName,
		};
		settings.database_path = context.databasePath;
		settings.last_session_id = String(sessionID || "default").trim() || "default";
		await this._writeJSONFile(context.settingsPath, settings);
	},

	async _loadSessionMessages(context, sessionID) {
		let timeline = await this._loadSessionTimeline(context, sessionID);
		return timeline
			.filter((entry) => {
				let eventType = String(entry?.event_type || "").trim();
				if (!["user", "assistant"].includes(String(entry?.role || ""))) {
					return false;
				}
				if (entry?.context_excluded) {
					return false;
				}
				if (!eventType) {
					return true;
				}
				return ["message", "user_message", "assistant_final", "assistant_question"].includes(eventType);
			})
			.map((entry) => ({
				role: entry.role,
				content: entry.content,
				created_at: entry.created_at,
			}));
	},

	async _loadRecentSessionMessages(context, sessionID, limit = 12) {
		let messages = await this._loadSessionMessages(context, sessionID);
		return messages.slice(-Math.max(1, Number(limit || 0) || 12));
	},

	async _listProjectSessions(context) {
		let ids = await this._sessionIDsOnDisk(context);
		let sessions = [];
		for (let sessionID of ids) {
			let meta = await this._loadSessionMeta(context, sessionID, { create: false }).catch(() => null);
			if (!meta) {
				continue;
			}
			sessions.push({
				session_id: meta.session_id,
				title: meta.title || meta.session_id,
				updated_at: meta.updated_at || "",
				is_active: false,
				mode: meta.mode || "intake",
				status: meta.status || "active",
			});
		}
		let desired = await this._desiredSessionID(context);
		sessions = sessions.map((entry) => Object.assign({}, entry, {
			is_active: entry.session_id == desired,
		}));
		sessions.sort((left, right) => {
			return (right.is_active ? 1 : 0) - (left.is_active ? 1 : 0)
				|| String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
				|| String(right.session_id || "").localeCompare(String(left.session_id || ""));
		});
		return sessions;
	},

	async _activateSession(controller, sessionID) {
		let current = await this._resolveControllerProject(controller);
		if (!current || !sessionID) {
			return;
		}
		await this._activateSessionContext(current, sessionID);
		controller.projectRef = this._projectReferenceData(current, { sessionID });
		await this._refreshController(controller);
		this._setStatus(controller, "Session switched", "ready");
	},

	async _activateSessionContext(current, sessionID) {
		if (!current || !sessionID) {
			return;
		}
		await this._loadSessionMeta(current.context, sessionID, { create: true });
		await this._writeSettingsLastSession(current.context, sessionID);
		this._setCurrentProject(current.context, current.projectItem, sessionID, current.projectType);
	},

	async _appendSessionMessage(context, sessionID, role, content, options = {}) {
		return await this._appendSessionRecord(context, sessionID, {
			event_type: options.eventType || (role == "assistant" ? "assistant_final" : role == "user" ? "user_message" : "message"),
			role,
			title: options.title || "",
			content,
			payload: options.payload || null,
		});
	},

	async _writeSessionHistoryFile(context, sessionID) {
		let timeline = await this._loadSessionTimeline(context, sessionID);
		await this._saveSessionTimeline(context, sessionID, timeline);
		return this._sessionHistoryPath(context, sessionID);
	},

	async _ensureSessionState(context, sessionID) {
		let meta = await this._loadSessionMeta(context, sessionID, { create: true });
		return meta;
	},

	async _loadSessionRuntimeState(context, sessionID) {
		let meta = await this._loadSessionMeta(context, sessionID, { create: true });
		return {
			session_id: meta.session_id,
			chat_preset_id: String(meta.chat_preset_id || "default").trim() || "default",
			chat_previous_response_id: String(meta.chat_previous_response_id || "").trim(),
			chat_reasoning_effort: this._normalizeSessionReasoningEffort(meta.chat_reasoning_effort || ""),
			chat_model_override: String(meta.chat_model_override || "").trim(),
			updated_at: String(meta.updated_at || "").trim(),
		};
	},

	async _loadSessionPendingMessages(context, sessionID) {
		let meta = await this._loadSessionMeta(context, sessionID, { create: true });
		return this._normalizePendingMessages(meta?.pending_messages || []);
	},

	async _saveSessionPendingMessages(context, sessionID, entries = []) {
		let meta = await this._loadSessionMeta(context, sessionID, { create: true });
		let next = Object.assign({}, meta, {
			pending_messages: this._normalizePendingMessages(entries || []),
			updated_at: new Date().toISOString(),
		});
		await this._saveSessionMeta(context, sessionID, next);
		return next.pending_messages || [];
	},

	async _queueSessionPendingMessage(context, sessionID, content, options = {}) {
		let text = String(content || "").trim();
		if (!text) {
			throw new Error("Queued message content is required.");
		}
		let pending = await this._loadSessionPendingMessages(context, sessionID);
		let now = new Date().toISOString();
		let next = this._normalizePendingMessage({
			queue_id: options.queue_id || "",
			mode: options.mode || "queued",
			content: text,
			payload: options.payload && typeof options.payload == "object" && !Array.isArray(options.payload)
				? Object.assign({}, options.payload)
				: null,
			created_at: now,
			updated_at: now,
		}, pending.length);
		pending.push(next);
		await this._saveSessionPendingMessages(context, sessionID, pending);
		return next;
	},

	async _updateSessionPendingMessage(context, sessionID, queueID, patch = {}) {
		let targetID = String(queueID || "").trim();
		if (!targetID) {
			throw new Error("queue_id is required.");
		}
		let pending = await this._loadSessionPendingMessages(context, sessionID);
		let index = pending.findIndex((entry) => String(entry?.queue_id || "").trim() == targetID);
		if (index < 0) {
			throw new Error("Queued message was not found.");
		}
		let current = pending[index];
		pending[index] = this._normalizePendingMessage({
			queue_id: current.queue_id,
			mode: Object.prototype.hasOwnProperty.call(patch, "mode") ? patch.mode : current.mode,
			content: Object.prototype.hasOwnProperty.call(patch, "content") ? patch.content : current.content,
			payload: Object.prototype.hasOwnProperty.call(patch, "payload") ? patch.payload : current.payload,
			created_at: current.created_at,
			updated_at: new Date().toISOString(),
		}, index);
		await this._saveSessionPendingMessages(context, sessionID, pending);
		return pending[index];
	},

	async _removeSessionPendingMessage(context, sessionID, queueID) {
		let targetID = String(queueID || "").trim();
		if (!targetID) {
			throw new Error("queue_id is required.");
		}
		let pending = await this._loadSessionPendingMessages(context, sessionID);
		let removed = null;
		let next = pending.filter((entry) => {
			let keep = String(entry?.queue_id || "").trim() != targetID;
			if (!keep && !removed) {
				removed = entry;
			}
			return keep;
		});
		if (!removed) {
			throw new Error("Queued message was not found.");
		}
		await this._saveSessionPendingMessages(context, sessionID, next);
		return removed;
	},

	async _consumeSessionPendingMessage(context, sessionID, options = {}) {
		let requestedMode = String(options?.mode || "").trim();
		let pending = await this._loadSessionPendingMessages(context, sessionID);
		if (!pending.length) {
			return null;
		}
		let index = requestedMode
			? pending.findIndex((entry) => String(entry?.mode || "").trim() == requestedMode)
			: pending.findIndex((entry) => String(entry?.mode || "").trim() == "steer");
		if (index < 0 && !requestedMode) {
			index = 0;
		}
		if (index < 0) {
			return null;
		}
		let [consumed] = pending.splice(index, 1);
		await this._saveSessionPendingMessages(context, sessionID, pending);
		return consumed || null;
	},

	async _updateSessionRuntimeState(context, sessionID, patch = {}) {
		let meta = await this._loadSessionMeta(context, sessionID, { create: true });
		let next = Object.assign({}, meta, {
			chat_preset_id: Object.prototype.hasOwnProperty.call(patch, "chat_preset_id")
				? (String(patch.chat_preset_id || "").trim() || "default")
				: (String(meta.chat_preset_id || "default").trim() || "default"),
			chat_previous_response_id: Object.prototype.hasOwnProperty.call(patch, "chat_previous_response_id")
				? String(patch.chat_previous_response_id || "").trim()
				: String(meta.chat_previous_response_id || "").trim(),
			chat_reasoning_effort: Object.prototype.hasOwnProperty.call(patch, "chat_reasoning_effort")
				? this._normalizeSessionReasoningEffort(patch.chat_reasoning_effort || "")
				: this._normalizeSessionReasoningEffort(meta.chat_reasoning_effort || ""),
			chat_model_override: Object.prototype.hasOwnProperty.call(patch, "chat_model_override")
				? String(patch.chat_model_override || "").trim()
				: String(meta.chat_model_override || "").trim(),
			updated_at: new Date().toISOString(),
		});
		await this._saveSessionMeta(context, sessionID, next);
		return {
			session_id: next.session_id,
			chat_preset_id: next.chat_preset_id,
			chat_previous_response_id: next.chat_previous_response_id,
			chat_reasoning_effort: next.chat_reasoning_effort,
			chat_model_override: next.chat_model_override,
			updated_at: next.updated_at,
		};
	},

	async _loadSessionState(context, sessionID) {
		let meta = await this._loadSessionMeta(context, sessionID, { create: true });
		return {
			session_id: meta.session_id,
			title: meta.title || meta.session_id,
			mode: this._normalizeSessionMode(meta.mode),
			status: this._normalizeSessionStatus(meta.status),
			summary: meta.summary && typeof meta.summary == "object" ? meta.summary : {},
			pending_messages: this._normalizePendingMessages(meta.pending_messages || []),
			created_at: meta.created_at || "",
			updated_at: meta.updated_at || "",
		};
	},

	async _updateSessionState(context, sessionID, patch = {}) {
		let current = await this._loadSessionMeta(context, sessionID, { create: true });
		let summary = current.summary && typeof current.summary == "object" ? current.summary : {};
		if (Object.prototype.hasOwnProperty.call(patch, "summary")) {
			summary = patch.summary && typeof patch.summary == "object" ? patch.summary : {};
		}
		if (patch.summaryPatch && typeof patch.summaryPatch == "object") {
			summary = Object.assign({}, summary, patch.summaryPatch);
		}
		let next = Object.assign({}, current, {
			title: this._normalizeSessionTitle(patch.title !== undefined ? patch.title : current.title) || current.title || sessionID,
			mode: this._normalizeSessionMode(patch.mode !== undefined ? patch.mode : current.mode),
			status: this._normalizeSessionStatus(patch.status !== undefined ? patch.status : current.status),
			summary,
			updated_at: new Date().toISOString(),
		});
		await this._saveSessionMeta(context, sessionID, next);
		return {
			session_id: next.session_id,
			title: next.title,
			mode: next.mode,
			status: next.status,
			summary: next.summary,
			created_at: next.created_at,
			updated_at: next.updated_at,
		};
	},

	async _appendSessionEvent(context, sessionID, eventType, options = {}) {
		return await this._appendSessionRecord(context, sessionID, {
			event_type: String(eventType || "event"),
			role: String(options.role || "system"),
			title: options.title || "",
			content: options.content || "",
			payload: options.payload || null,
		});
	},

	async _loadSessionEvents(context, sessionID) {
		return await this._loadSessionTimeline(context, sessionID);
	},

	async _loadRecentSessionEvents(context, sessionID, limit = 16) {
		let timeline = await this._loadSessionTimeline(context, sessionID);
		return timeline.slice(-Math.max(1, Number(limit || 0) || 16));
	},

	async _writeSessionTraceFile(_context, _sessionID) {
		return "";
	},

	async _projectSessionSummary(context) {
		let sessions = await this._listProjectSessions(context);
		return {
			count: sessions.length,
			latest: sessions[0] || null,
		};
	},

	_sessionToolCatalog(surface = "session") {
		if (this.agentTools?.responsesCatalog) {
			return this.agentTools.responsesCatalog({ surface });
		}
		return {
			top_level: [],
			namespaces: [],
			flattened: [],
		};
	},

	async _sessionPromptProjection(current, sessionID, options = {}) {
		let surface = String(options?.surface || "session").trim() || "session";
		let toolCatalog = this._sessionToolCatalog(surface);
		let sessionState = await this._loadSessionState(current.context, sessionID);
		let runtimeState = await this._loadSessionRuntimeState(current.context, sessionID);
		let inspection = await this._inspectProjectSession(current);
		let projectCounts = await this._projectCounts(current.context).catch(() => ({}));
		let availableScopes = [];
		try {
			availableScopes = SystematicReviewerWorkflowScreening?.availableScopes
				? (SystematicReviewerWorkflowScreening.availableScopes(this, current) || [])
				: [];
		}
		catch (_error) {
			availableScopes = [];
		}
		let config = await this._conversionConfig().catch(() => null);
		let preparedChat = config
			? await this._prepareRoleAPIClient("session_chat", config.chatClient, config, {
				presetID: runtimeState?.chat_preset_id || "default",
				modelOverride: runtimeState?.chat_model_override || "",
				cwd: current?.context?.projectRoot || "",
			}).catch(() => null)
			: null;
		try {
			let chatClient = preparedChat?.client || {};
			let stateful = String(chatClient?.stateMode || "").trim() == "stateful";
			let nativeTransport =
				String(chatClient?.apiKind || "responses").trim() == "responses";
			let headText = SystematicReviewerSessionAgent.buildSystemPrompt(current, sessionID, {
				inspection,
				project_counts: projectCounts,
				project_type: current?.projectType || current?.context?.projectType || "",
				tool_catalog: toolCatalog,
				session_state: sessionState,
				available_scopes: availableScopes,
				transport: nativeTransport ? "native" : "text",
			});
				let timeline = await this._loadSessionTimeline(current.context, sessionID);
				let activeMemoryText = typeof this._readActiveMemoryText == "function"
					? await this._readActiveMemoryText(current.context)
					: "";
				let latestActive = typeof this._latestActiveInstructionEntry == "function"
					? this._latestActiveInstructionEntry(timeline)
					: null;
				let requiredEntrySequenceNos = latestActive?.sequence_no ? [latestActive.sequence_no] : [];
				let responseTools = typeof this._sessionResponseTools == "function"
					? this._sessionResponseTools(toolCatalog, {})
					: [];
				let projection = stateful
					? SystematicReviewerSlidingContext.buildStatefulProjection({
						headText,
						activeMemoryText,
						tools: responseTools,
						timeline,
						contextWindow: Number(chatClient?.contextWindow || 0) || 0,
						maxOutputTokens: Number(chatClient?.maxOutputTokens || 0) || 0,
				})
				: SystematicReviewerSlidingContext.buildProjection({
					headText,
					tools: responseTools,
					headEntry: {
						role: "system",
						event_type: "system_prompt",
						title: "Pinned Prompt Context",
						content: headText,
						synthetic: true,
						},
						timeline,
						contextWindow: Number(chatClient?.contextWindow || 0) || 0,
						maxOutputTokens: Number(chatClient?.maxOutputTokens || 0) || 0,
						activeMemoryText,
						requiredEntrySequenceNos,
						pinnedStartCount: 0,
						maxContentChars: 12000,
						maxPayloadChars: 8000,
					});
				projection.compaction_status = typeof this._memoryCompactionStatus == "function"
					? this._memoryCompactionStatus(current.context)
					: null;
				return {
				runtime: {
					chat_preset_id: String(runtimeState?.chat_preset_id || "default").trim() || "default",
					state_mode: stateful ? "stateful" : "stateless",
					context_window: Number(chatClient?.contextWindow || 0) || 0,
						max_output_tokens: Number(chatClient?.maxOutputTokens || 0) || 0,
					},
					head_text: projection.head_text || headText,
					base_head_text: headText,
					active_memory_text: activeMemoryText,
					projection,
				};
		}
		finally {
			await preparedChat?.release?.();
		}
	},

	_formatSessionToolCatalogText(toolCatalog) {
		if (SystematicReviewerSessionAgent?.formatToolCatalogText) {
			return SystematicReviewerSessionAgent.formatToolCatalogText(toolCatalog);
		}
		return "";
	},

	_formatSessionWelcome(inspection) {
		let topicHint = inspection.likely_topic_signals?.length
			? ` It looks like the collection may be about ${inspection.likely_topic_signals.slice(0, 4).join(", ")}.`
			: "";
		return [
			`I inspected this collection project and found ${inspection.items} items, ${inspection.attachments} attachments, ${inspection.markdown_conversions} markdown conversions, and ${inspection.templates} templates.${topicHint}`,
			"",
			"Tell me what you want to do next. You can ask me to refine a review topic, estimate or run a harvest, screen papers, extract fields, edit REPORT.md, summarize project evidence, or export results.",
		].join("\n");
	},

	async _ensureSessionWelcome(current, sessionID, options = {}) {
		let key = [
			current?.context?.projectID || "",
			sessionID || "",
		].join("|");
		if (!this.sessionWelcomeEnsureLocks) {
			this.sessionWelcomeEnsureLocks = new Map();
		}
		let existingLock = this.sessionWelcomeEnsureLocks.get(key);
		if (existingLock) {
			return await existingLock;
		}
		let task = (async () => {
			let surface = String(options?.surface || "session").trim() || "session";
			let existingMessages = await this._loadSessionMessages(current.context, sessionID);
			if (existingMessages.length) {
				return;
			}
			let inspection = await this._inspectProjectSession(current);
			let nextMessages = await this._loadSessionMessages(current.context, sessionID);
			if (nextMessages.length) {
				return;
			}
			let toolCatalog = this._sessionToolCatalog(surface);
			await this._appendSessionEvent(current.context, sessionID, "collection_inspection", {
				role: "system",
				title: "Collection Inspection",
				content: `Project state: ${inspection.project_state}. Items: ${inspection.items}. Attachments: ${inspection.attachments}. Conversions: ${inspection.markdown_conversions}. Templates: ${inspection.templates}.`,
				payload: inspection,
			});
			let compactToolCatalogText = SystematicReviewerSessionAgent?.formatCompactToolCatalogText
				? SystematicReviewerSessionAgent.formatCompactToolCatalogText(toolCatalog)
				: this._formatSessionToolCatalogText(toolCatalog);
			let compactToolCatalogPayload = SystematicReviewerSessionAgent?.summarizeToolCatalog
				? SystematicReviewerSessionAgent.summarizeToolCatalog(toolCatalog)
				: null;
			await this._appendSessionEvent(current.context, sessionID, "system_tools", {
				role: "system",
				title: "Available Tools",
				content: compactToolCatalogText,
				payload: compactToolCatalogPayload,
			});
			await this._appendSessionMessage(current.context, sessionID, "assistant", this._formatSessionWelcome(inspection), {
				eventType: "assistant_question",
				title: "Session Intake",
				payload: {
					inspection,
				},
			});
		})().finally(() => {
			this.sessionWelcomeEnsureLocks.delete(key);
		});
		this.sessionWelcomeEnsureLocks.set(key, task);
		return await task;
	},

	async _sessionStatus(current, sessionID, options = {}) {
		let surface = String(options?.surface || "session").trim() || "session";
		let includeInspection = options?.includeInspection !== false && options?.includeSessionInspection !== false;
		let includePromptProjection = options?.includePromptProjection !== false && options?.includeSessionPromptProjection !== false;
		let activeSessionID = sessionID || await this._ensureActiveSession(current.context);
		let inspection = includeInspection ? await this._inspectProjectSession(current) : null;
		let session = await this._loadSessionState(current.context, activeSessionID);
		let runtime_state = await this._loadSessionRuntimeState(current.context, activeSessionID);
		let pending_messages = await this._loadSessionPendingMessages(current.context, activeSessionID);
		let promptState = includePromptProjection
			? await this._sessionPromptProjection(current, activeSessionID, { surface })
			: null;
		let rawTimeline = await this._loadSessionTimeline(current.context, activeSessionID);
		let pendingTokens = 0;
		let pendingSteerTokens = 0;
		let pendingQueuedTokens = 0;
		let steerCount = 0;
		let queuedCount = 0;
		for (let entry of pending_messages) {
			let tokens = SystematicReviewerTokenBudget.estimateTextTokens(`USER [${String(entry?.mode || "queued")}]\n${String(entry?.content || "")}`);
			pendingTokens += tokens;
			if (String(entry?.mode || "").trim() == "steer") {
				steerCount += 1;
				pendingSteerTokens += tokens;
			}
			else {
				queuedCount += 1;
				pendingQueuedTokens += tokens;
			}
		}
		return {
			session,
			runtime_state,
			inspection,
			tool_catalog: this._sessionToolCatalog(surface),
			sessions: await this._listProjectSessions(current.context),
			transcript: await this._loadSessionMessages(current.context, activeSessionID),
			timeline: rawTimeline,
			pending_messages,
			visible_timeline: Array.isArray(promptState?.projection?.visible_timeline)
				? promptState.projection.visible_timeline
				: rawTimeline,
			prompt_projection: promptState?.projection || null,
			chat_budget: promptState?.projection
				? {
					stateful: !!promptState.projection.stateful,
					synthetic: !!promptState.projection.synthetic,
					context_window: Number(promptState.projection.context_window || 0) || 0,
						safe_cap_tokens: Number(promptState.projection.safe_cap_tokens || 0) || 0,
						max_output_tokens: Number(promptState.projection.max_output_tokens || 0) || 0,
						input_budget_tokens: Number(promptState.projection.input_budget_tokens || 0) || 0,
						target_input_budget_tokens: Number(promptState.projection.target_input_budget_tokens || 0) || 0,
						head_tokens: Number(promptState.projection.head_tokens || 0) || 0,
						active_memory_tokens: Number(promptState.projection.active_memory_tokens || 0) || 0,
						tool_schema_tokens: Number(promptState.projection.tool_schema_tokens || 0) || 0,
						truncation_notice_tokens: Number(promptState.projection.truncation_notice_tokens || 0) || 0,
						raw_history_tokens: Number(promptState.projection.raw_history_tokens || 0) || 0,
						used_input_tokens: Number(promptState.projection.used_input_tokens || 0) || 0,
						estimated_input_tokens: Number(promptState.projection.estimated_input_tokens || 0) || 0,
						fits_budget: promptState.projection.fits_budget !== false,
						over_budget_tokens: Number(promptState.projection.over_budget_tokens || 0) || 0,
						truncated: !!promptState.projection.truncated,
						omitted_count: Number(promptState.projection.omitted_count || 0) || 0,
						compaction_status: promptState.projection.compaction_status || null,
						head_text: String(promptState.projection.head_text || ""),
						active_memory_text: String(promptState.projection.active_memory_text || ""),
						tool_schema_text: String(promptState.projection.tool_schema_text || ""),
						prompt_text: String(promptState.projection.prompt_text || ""),
						pending_message_count: pending_messages.length,
					pending_message_tokens: pendingTokens,
					pending_steer_count: steerCount,
					pending_steer_tokens: pendingSteerTokens,
					pending_queued_count: queuedCount,
					pending_queued_tokens: pendingQueuedTokens,
				}
				: null,
		};
	},

	async _sessionOpen(current, options = {}) {
		let surface = String(options?.surface || "session").trim() || "session";
		let requestedSessionID = String(options.sessionID || options.session_id || "").trim();
		let sessionID = options.newSession
			? await this._createSession(current.context, { title: options.title || "", activate: true })
			: requestedSessionID || await this._ensureActiveSession(current.context);
		await this._activateSessionContext(current, sessionID);
		if (options?.ensureWelcome !== false && options?.ensureSessionWelcome !== false) {
			await this._ensureSessionWelcome(current, sessionID, { surface });
		}
		if (options.title) {
			await this._updateSessionState(current.context, sessionID, { title: options.title });
		}
		return this._sessionStatus(current, sessionID, {
			surface,
			includeInspection: options?.includeInspection,
			includeSessionInspection: options?.includeSessionInspection,
			includePromptProjection: options?.includePromptProjection,
			includeSessionPromptProjection: options?.includeSessionPromptProjection,
		});
	},

	async _sessionMessage(current, sessionID, message, options = {}) {
		let surface = String(options?.surface || "session").trim() || "session";
		let text = String(message || "").trim();
		if (!text) {
			return this._sessionOpen(current, { sessionID, surface });
		}
		let isAbortError = (error) => {
			let name = String(error?.name || "").trim();
			let message = String(error?.message || error || "").trim().toLowerCase();
			return name == "AbortError"
				|| message.includes("aborted")
				|| message.includes("cancelled")
				|| message.includes("canceled");
		};
		let opened = await this._sessionOpen(current, { sessionID, surface });
		let activeSessionID = opened.session.session_id;
			let userEntry = await this._appendSessionMessage(current.context, activeSessionID, "user", text, {
				eventType: "user_message",
				title: options.origin == "api" ? "API Message" : "",
				payload: options.origin ? { origin: String(options.origin || "").trim() } : null,
			});
		if (options.emitProgress) {
			await this._refreshAllControllers();
		}
		try {
			if (text.startsWith("/")) {
				let response = await this._handleLocalCommand(current, activeSessionID, text);
				if (response) {
					await this._appendSessionMessage(current.context, activeSessionID, "assistant", response, {
						eventType: "assistant_final",
						title: "Local Command",
					});
				}
				return this._sessionStatus(current, activeSessionID, { surface });
			}
				await this._runSessionAgent(current, activeSessionID, text, Object.assign({}, options || {}, {
					activeEntrySequenceNo: Number(userEntry?.sequence_no || 0) || 0,
					activeEntrySequenceNos: [Number(userEntry?.sequence_no || 0) || 0].filter(Boolean),
					activeInstructionPayload: userEntry?.payload || { origin: options.origin || "ui" },
				}));
		}
		catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			await this._appendSessionEvent(current.context, activeSessionID, "error", {
				role: "system",
				title: "Assistant Error",
				content: error?.message || String(error),
				payload: {
					message: error?.message || String(error),
				},
			});
			await this._appendSessionMessage(
				current.context,
				activeSessionID,
				"assistant",
				`I hit an error while processing this session: ${error?.message || String(error)}`,
				{
					eventType: "assistant_final",
					title: "Assistant Error",
				}
			);
		}
		return this._sessionStatus(current, activeSessionID, { surface });
	},

	async _sessionTranscriptMessages(context, sessionID, limit = 4) {
		let history = await this._loadRecentSessionMessages(context, sessionID, limit + 2);
		while (history.length && history[0].role == "assistant") {
			history = history.slice(1);
		}
		return history
			.slice(-Math.max(1, limit))
			.map((entry) => ({
				role: entry.role == "assistant" ? "assistant" : "user",
				content: this._truncateText(entry.content, 900),
			}));
	},
};
