const JOB_PROGRESS_REFRESH_THROTTLE_MS = 750;
const HARVEST_MERGE_JOB_START_DELAY_MS = 220;
const HARVEST_RUN_JOB_START_DELAY_MS = 220;
const EMBEDDINGS_JOB_START_DELAY_MS = 220;
const GLOBAL_JOB_RUNNER_LIMIT = 4;
const DEFAULT_LEASE_POLL_MS = 30;
const JOB_RECOVERY_RETRY_LIMIT = 12;
const JOB_RECOVERY_RETRY_DELAY_MS = 750;
const JOB_COMPLETION_TTL_MS = 1000 * 60 * 5;
const HARVEST_IMPORT_STALL_MS = 1000 * 60 * 20;
const HARVEST_IMPORT_RECOVERY_SCAN_MS = 1000 * 60;
const HARVEST_IMPORT_STOP_GRACE_MS = 1000 * 30;

var SystematicReviewerJobsRuntime = {
	_jobOptionalString(value = "") {
		return String(value || "").trim();
	},

	_normalizeJobListLimit(value, fallback = 25, max = 500) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return fallback;
		}
		return Math.max(1, Math.min(max, Math.round(parsed)));
	},

	_cleanJobRecord(job = {}) {
		let clean = Object.assign({}, job || {});
		if (Object.prototype.hasOwnProperty.call(clean, "metadata_json")) {
			delete clean.metadata_json;
		}
		return clean;
	},

	_jobSupportsContinue(job = {}) {
		let kind = this._jobOptionalString(job.kind);
		return ["manual_harvest", "manual_embeddings", "manual_extraction", "manual_extraction_single", "convert_attachment_markdown"].includes(kind);
	},

	_jobSupportsRestart(job = {}) {
		let kind = this._jobOptionalString(job.kind);
		return [
			"manual_harvest",
			"manual_embeddings",
			"manual_extraction",
			"manual_extraction_single",
			"convert_attachment_markdown",
			"full_text_retrieval_watch",
			"manual_semantic_search",
			"manual_harvest_merge",
			"manual_screening_save",
			"manual_screening_rules",
			"manual_screening_filter",
			"manual_screening_bulk",
			"manual_screening_export_csv",
			"manual_automation_export_pdf",
			"manual_automation_export_docx",
			"manual_automation_export_markdown",
			"manual_explore_query",
			"manual_explore_export_csv",
			"manual_explore_chat",
			"manual_project_reconcile",
		].includes(kind);
	},

	_contextFromStoredProject(stored = {}) {
		return {
			projectID: this._jobOptionalString(stored.project_id),
			libraryID: Number(stored.library_id || 0) || 0,
			collectionKey: this._jobOptionalString(stored.collection_key),
			collectionName: this._jobOptionalString(stored.collection_name),
			projectRoot: this._jobOptionalString(stored.project_root),
			databasePath: this._jobOptionalString(stored.database_path),
			projectType: this._jobOptionalString(stored.project_type),
		};
	},

	_decorateJobRecord(job = {}, project = {}, metadata = null) {
		let parsedMetadata = metadata && typeof metadata == "object" ? metadata : this._parseJobMetadata(job || {});
		let projectID = this._jobOptionalString(project.project_id || project.projectID || job.project_id);
		let projectName = this._jobOptionalString(project.collection_name || project.collectionName || project.name || project.project_name || projectID);
		let projectType = this._jobOptionalString(project.project_type || project.projectType);
		let status = this._jobOptionalString(job.status);
		return Object.assign({}, this._cleanJobRecord(job || {}), {
			project_id: projectID,
			project_name: projectName,
			project_type: projectType,
			wait_reason: this._getJobWaitReason(projectID, job.job_id) || "",
			stop_available: ["queued", "running"].includes(status),
			continue_available: ["failed", "partial", "canceled", "interrupted"].includes(status) && this._jobSupportsContinue(job),
			restart_available: ["queued", "failed", "partial", "canceled", "interrupted", "succeeded"].includes(status) && this._jobSupportsRestart(job),
			metadata: parsedMetadata,
		});
	},

	async _projectJobCounts(context) {
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT status, COUNT(*) AS count
			 FROM jobs
			 GROUP BY status`
		);
		let counts = {
			queued: 0,
			running: 0,
			succeeded: 0,
			partial: 0,
			failed: 0,
			canceled: 0,
		};
		for (let row of rows) {
			counts[row.status] = row.count;
		}
		return counts;
	},

	async _listJobs(context, limit = 200) {
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT job_id, kind, title, status, requested_mode, used_mode, source_title,
			        source_attachment_key, source_item_key, output_path, output_attachment_key,
			        fallback_used, progress_current, progress_total, cancel_requested, error_message, metadata_json,
			        created_at, started_at, finished_at, updated_at
			 FROM jobs
			 ORDER BY created_at DESC
			 LIMIT ?`,
			[limit]
		);
		return rows.map((row) => ({
			job_id: row.job_id,
			kind: row.kind,
			title: row.title,
			status: row.status,
			requested_mode: row.requested_mode,
			used_mode: row.used_mode,
			source_title: row.source_title,
			source_attachment_key: row.source_attachment_key,
			source_item_key: row.source_item_key,
			output_path: row.output_path,
			output_attachment_key: row.output_attachment_key,
			fallback_used: !!row.fallback_used,
			progress_current: row.progress_current || 0,
			progress_total: row.progress_total || 0,
			cancel_requested: Number(row.cancel_requested || 0) === 1,
			error_message: row.error_message || "",
			metadata_json: String(row.metadata_json || ""),
			created_at: row.created_at,
			started_at: row.started_at || "",
			finished_at: row.finished_at || "",
			updated_at: row.updated_at,
		}));
	},

	async _jobLogs(context, jobID, limit = 400) {
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT level, message, created_at
			 FROM job_logs
			 WHERE job_id=?
			 ORDER BY sequence_no DESC
			 LIMIT ?`,
			[jobID, limit]
		);
		return (rows || []).reverse().map((row) => ({
			level: row.level,
			message: row.message,
			created_at: row.created_at,
		}));
	},

	async _jobLogCount(context, jobID) {
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT COUNT(*) AS total
			 FROM job_logs
			 WHERE job_id=?`,
			[jobID]
		);
		return Number(rows?.[0]?.total || 0) || 0;
	},

	async _readJobRecord(context, jobID = "") {
		let target = this._jobOptionalString(jobID);
		if (!target) {
			return null;
		}
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT job_id, project_id, kind, title, status, requested_mode, used_mode, library_id,
			        collection_key, parent_item_key, source_item_key, source_attachment_key,
			        source_title, source_content_type, source_path, output_path, output_attachment_key,
			        fallback_used, progress_current, progress_total, cancel_requested, error_message,
			        metadata_json, created_at, started_at, finished_at, updated_at
			 FROM jobs
			 WHERE job_id=?
			 LIMIT 1`,
			[target]
		);
		if (!rows.length) {
			return null;
		}
		let row = rows[0];
		return {
			job_id: row.job_id,
			project_id: row.project_id,
			kind: row.kind,
			title: row.title,
			status: row.status,
			requested_mode: row.requested_mode,
			used_mode: row.used_mode,
			library_id: row.library_id,
			collection_key: row.collection_key,
			parent_item_key: row.parent_item_key,
			source_item_key: row.source_item_key,
			source_attachment_key: row.source_attachment_key,
			source_title: row.source_title,
			source_content_type: row.source_content_type,
			source_path: row.source_path,
			output_path: row.output_path,
			output_attachment_key: row.output_attachment_key,
			fallback_used: !!row.fallback_used,
			progress_current: Number(row.progress_current || 0) || 0,
			progress_total: Number(row.progress_total || 0) || 0,
			cancel_requested: Number(row.cancel_requested || 0) === 1,
			error_message: this._jobOptionalString(row.error_message),
			metadata_json: this._jobOptionalString(row.metadata_json),
			created_at: row.created_at,
			started_at: this._jobOptionalString(row.started_at),
			finished_at: this._jobOptionalString(row.finished_at),
			updated_at: row.updated_at,
		};
	},

	async _resolveStoredProjectForJobs(projectID = "") {
		let target = this._jobOptionalString(projectID);
		if (!target) {
			throw new Error("project_id is required.");
		}
		let stored = (await this._listStoredProjects()).find((entry) => this._jobOptionalString(entry.project_id) == target) || null;
		if (!stored) {
			throw new Error(`Unknown stored project: ${target}`);
		}
		let current = null;
		if (stored.available_in_zotero) {
			current = await this._resolveProjectReference(this._projectReferenceData(stored, {
				projectID: stored.project_id,
				libraryID: stored.library_id,
				collectionKey: stored.collection_key,
				collectionName: stored.collection_name,
				projectItemKey: stored.project_item_key,
				projectType: stored.project_type,
				sessionID: stored.last_session_id || "default",
			}));
		}
		return {
			stored,
			current,
			context: current?.context || this._contextFromStoredProject(stored),
		};
	},

	async _insertWorkflowJobRecord(current, options = {}) {
		let context = current?.context;
		let collection = current?.collection;
		let projectItem = current?.projectItem;
		if (!context || !collection || !projectItem) {
			throw new Error("Project runtime is unavailable for workflow jobs.");
		}
		let db = await this._projectDB(context);
		let now = new Date().toISOString();
		let jobID = this._jobOptionalString(options.job_id || options.jobID) || this._workflowJobID(this._jobOptionalString(options.prefix || "manual") || "manual");
		let status = this._jobOptionalString(options.status || "queued") || "queued";
		let title = this._jobOptionalString(options.title || "Workflow Job") || "Workflow Job";
		let requestedMode = this._jobOptionalString(options.requested_mode || options.requestedMode || "manual") || "manual";
		let usedMode = this._jobOptionalString(options.used_mode || options.usedMode || requestedMode) || requestedMode;
		let sourceTitle = this._jobOptionalString(options.source_title || options.sourceTitle || "Workflow") || "Workflow";
		let sourcePath = this._jobOptionalString(options.source_path || options.sourcePath || context.projectRoot) || context.projectRoot;
		let outputPath = this._jobOptionalString(options.output_path || options.outputPath);
		let outputAttachmentKey = this._jobOptionalString(options.output_attachment_key || options.outputAttachmentKey);
		let sourceAttachmentKey = this._jobOptionalString(options.source_attachment_key || options.sourceAttachmentKey || projectItem.key);
		let sourceItemKey = this._jobOptionalString(options.source_item_key || options.sourceItemKey || projectItem.key) || projectItem.key;
		let parentItemKey = this._jobOptionalString(options.parent_item_key || options.parentItemKey || projectItem.key);
		let fallbackUsed = options.fallback_used === true || options.fallbackUsed === true ? 1 : 0;
		let progressCurrent = Number(options.progress_current || options.progressCurrent || 0) || 0;
		let progressTotal = Number(options.progress_total || options.progressTotal || 0) || 0;
		let cancelRequested = options.cancel_requested === true || options.cancelRequested === true ? 1 : 0;
		let errorMessage = this._jobOptionalString(options.error_message || options.errorMessage) || null;
		let metadataJSON = this._safeJobMetadataJSON(options.metadata || {});
		let createdAt = this._jobOptionalString(options.created_at || options.createdAt) || now;
		let startedAt = options.started_at !== undefined || options.startedAt !== undefined
			? (this._jobOptionalString(options.started_at || options.startedAt) || null)
			: (status == "running" ? now : null);
		let finishedAt = options.finished_at !== undefined || options.finishedAt !== undefined
			? (this._jobOptionalString(options.finished_at || options.finishedAt) || null)
			: null;
		let updatedAt = this._jobOptionalString(options.updated_at || options.updatedAt) || now;
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`INSERT INTO jobs (
					job_id, project_id, kind, title, status, requested_mode, used_mode, library_id,
					collection_key, parent_item_key, source_item_key, source_attachment_key,
					source_title, source_content_type, source_path, output_path, output_attachment_key,
					fallback_used, progress_current, progress_total, cancel_requested, error_message, metadata_json,
					created_at, started_at, finished_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					jobID,
					context.projectID,
					this._jobOptionalString(options.kind || "workflow") || "workflow",
					title,
					status,
					requestedMode,
					usedMode,
					context.libraryID,
					context.collectionKey,
					parentItemKey,
					sourceItemKey,
					sourceAttachmentKey,
					sourceTitle,
					this._jobOptionalString(options.source_content_type || options.sourceContentType || "application/systematic-reviewer+manual"),
					sourcePath,
					outputPath,
					outputAttachmentKey,
					fallbackUsed,
					progressCurrent,
					progressTotal,
					cancelRequested,
					errorMessage,
					metadataJSON,
					createdAt,
					startedAt,
					finishedAt,
					updatedAt,
				]
			);
		}, {
			jobID,
			ownerKey: `job-insert:${context.projectID}:${jobID}`,
		});
		return {
			job_id: jobID,
			title,
			status,
			requested_mode: requestedMode,
			used_mode: usedMode,
		};
	},

	async _queueSelectedItemsForConversion(win, mode) {
		let collection = this._selectedCollection(win || this._primaryWindow());
		if (!collection) {
			throw new Error("Select a Zotero collection first");
		}
		let sources = this._selectedConvertibleSources(win || this._primaryWindow());
		if (!sources.length) {
			throw new Error("Select a PDF, PNG, JPG, or an item with supported attachments first");
		}
		let result = await this._queueConversionSourcesForCollection(collection, sources, mode, {
			targetWin: win || this._primaryWindow(),
		});
		return result.jobs;
	},

	async _enqueueConversionSources(current, sources, mode, options = {}) {
		options = options || {};
		let targetWin = options.targetWin || null;
		let openJobsTab = options.openJobsTab !== false;
		let refreshControllers = options.refreshControllers !== false;
		if (!current?.context || !current?.collection || !current?.projectItem) {
			throw new Error("Project runtime is unavailable for conversion.");
		}
		let jobs = [];
		for (let source of sources) {
			let job = await this._createConversionJob(current.context, current.collection, current.projectItem, source, mode);
			jobs.push(job);
			this._pushPendingJobReference({
				projectID: current.context.projectID,
				libraryID: current.context.libraryID,
				collectionKey: current.context.collectionKey,
				jobID: job.job_id,
			});
		}
		this._scheduleJobPump();
		if (openJobsTab) {
			await this._openJobsTab(targetWin || this._primaryWindow(), current);
		}
		if (refreshControllers) {
			await this._refreshAllControllers();
		}
		return {
			jobs,
			projectCollection: current.collection,
			runtime: current,
		};
	},

	_workflowJobID(prefix = "manual") {
		return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	},

	_safeJobMetadataJSON(value) {
		try {
			return JSON.stringify(value || {});
		}
		catch (_error) {
			return "{}";
		}
	},

	_parseJobMetadata(job = {}) {
		let raw = String(job?.metadata_json || "").trim();
		if (!raw) {
			return {};
		}
		try {
			let parsed = JSON.parse(raw);
			return parsed && typeof parsed == "object" ? parsed : {};
		}
		catch (_error) {
			return {};
		}
	},

	async _mergeJobMetadata(context, jobID, patch = {}) {
		let target = this._jobOptionalString(jobID);
		if (!context || !target || !patch || typeof patch != "object") {
			return null;
		}
		let existing = await this._readJobRecord(context, target).catch(() => null);
		if (!existing) {
			return null;
		}
		let merged = Object.assign({}, this._parseJobMetadata(existing || {}), patch || {});
		let metadataJSON = this._safeJobMetadataJSON(merged);
		let db = await this._projectDB(context);
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET metadata_json=?,
				     updated_at=?
				 WHERE job_id=?`,
				[metadataJSON, new Date().toISOString(), target]
			);
		}, {
			jobID: target,
			ownerKey: `job-metadata:${context.projectID}:${target}`,
		});
		return merged;
	},

	async _readActiveJobForMutation(context, jobID, allowedStatuses = ["queued", "running"]) {
		let target = this._jobOptionalString(jobID);
		if (!context || !target) {
			return null;
		}
		let job = await this._readJobRecord(context, target).catch(() => null);
		if (!job) {
			return null;
		}
		let status = this._jobOptionalString(job.status);
		return Array.isArray(allowedStatuses) && allowedStatuses.includes(status) ? job : null;
	},

	_jobControlKey(projectID = "", jobID = "") {
		let nextProjectID = String(projectID || "").trim();
		let nextJobID = String(jobID || "").trim();
		return nextProjectID && nextJobID ? `${nextProjectID}:${nextJobID}` : "";
	},

	_jobCompletionKey(projectID = "", jobID = "") {
		return this._jobControlKey(projectID, jobID);
	},

	_ensureJobCompletionEntry(projectID = "", jobID = "") {
		let key = this._jobCompletionKey(projectID, jobID);
		if (!key) {
			return null;
		}
		if (!this.jobCompletionEntries) {
			this.jobCompletionEntries = new Map();
		}
		let entry = this.jobCompletionEntries.get(key) || null;
		if (entry) {
			return entry;
		}
		let resolvePromise = null;
		let rejectPromise = null;
		let promise = new Promise((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		entry = {
			projectID: String(projectID || "").trim(),
			jobID: String(jobID || "").trim(),
			promise,
			resolve: resolvePromise,
			reject: rejectPromise,
			settled: false,
			value: undefined,
			error: null,
			cleanupTimer: 0,
		};
		this.jobCompletionEntries.set(key, entry);
		return entry;
	},

	_settleJobCompletion(projectID = "", jobID = "", outcome = {}) {
		let entry = this._ensureJobCompletionEntry(projectID, jobID);
		if (!entry || entry.settled) {
			return outcome?.value;
		}
		entry.settled = true;
		entry.value = outcome?.value;
		entry.error = outcome?.error || null;
		if (entry.error) {
			entry.reject(entry.error);
		}
		else {
			entry.resolve(entry.value);
		}
		let key = this._jobCompletionKey(projectID, jobID);
		let win = this._primaryWindow?.() || null;
		let timerHost = win || (typeof window != "undefined" ? window : null);
		if (entry.cleanupTimer && timerHost?.clearTimeout) {
			timerHost.clearTimeout(entry.cleanupTimer);
		}
		if (timerHost?.setTimeout) {
			entry.cleanupTimer = timerHost.setTimeout(() => {
				this.jobCompletionEntries?.delete?.(key);
			}, JOB_COMPLETION_TTL_MS);
		}
		return entry.value;
	},

	async _awaitJobCompletion(projectID = "", jobID = "") {
		let entry = this._ensureJobCompletionEntry(projectID, jobID);
		if (!entry) {
			return null;
		}
		return await entry.promise;
	},

	_setJobWaitReason(projectID = "", jobID = "", reason = "") {
		let key = this._jobControlKey(projectID, jobID);
		if (!key) {
			return "";
		}
		let nextReason = String(reason || "").trim();
		if (!nextReason) {
			this.jobWaitReasons?.delete?.(key);
			return "";
		}
		this.jobWaitReasons?.set?.(key, nextReason);
		return nextReason;
	},

	_getJobWaitReason(projectID = "", jobID = "") {
		let key = this._jobControlKey(projectID, jobID);
		if (!key) {
			return "";
		}
		return String(this.jobWaitReasons?.get?.(key) || "").trim();
	},

	_clearJobWaitReason(projectID = "", jobID = "") {
		this._setJobWaitReason(projectID, jobID, "");
	},

	async _setJobCancelRequested(context, jobID, requested = true) {
		if (!context?.projectID || !jobID) {
			return false;
		}
		let db = await this._projectDB(context);
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET cancel_requested=?, updated_at=?
				 WHERE job_id=?`,
				[requested ? 1 : 0, new Date().toISOString(), jobID]
			);
		}, {
			jobID,
			ownerKey: `job-cancel-request:${context.projectID}:${jobID}`,
		});
		return true;
	},

	async _jobCancelRequested(context, jobID) {
		if (!context?.projectID || !jobID) {
			return false;
		}
		let db = await this._projectDB(context);
		let value = await this._dbValue(
			db,
			"SELECT cancel_requested AS value FROM jobs WHERE job_id=? LIMIT 1",
			[jobID]
		);
		return Number(value || 0) === 1;
	},

	async _throwIfJobCanceled(current, jobID, message = "Workflow job canceled.") {
		if (!current?.context || !jobID) {
			return;
		}
		if (!(await this._jobCancelRequested(current.context, jobID))) {
			return;
		}
		let error = new Error(String(message || "Workflow job canceled."));
		error.code = "SR_JOB_CANCELED";
		error.canceled = true;
		error.isCanceled = true;
		throw error;
	},

	async _withLease(leaseKey = "", options = {}, runner) {
		let nextLeaseKey = String(leaseKey || "").trim();
		if (!nextLeaseKey || typeof runner != "function") {
			return await runner();
		}
		let ownerKey = String(options.ownerKey || "").trim() || `lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		let sharedKey = String(options.sharedKey || "").trim();
		let capacity = Math.max(1, Number(options.capacity || 0) || 1);
		let jobID = String(options.jobID || "").trim();
		let projectID = String(options.projectID || "").trim();
		let waitReason = String(options.waitReason || "").trim();
		let pollMS = Math.max(10, Number(options.pollMs || options.poll_ms || DEFAULT_LEASE_POLL_MS) || DEFAULT_LEASE_POLL_MS);
		let cancelCheck = typeof options.cancelCheck == "function" ? options.cancelCheck : null;
		let waitReasonSet = false;
		if (!this.jobResourceLeases) {
			this.jobResourceLeases = new Map();
		}
		let release = null;
		try {
			while (true) {
				let state = this.jobResourceLeases.get(nextLeaseKey);
				if (!state) {
					state = {
						holders: new Map(),
					};
					this.jobResourceLeases.set(nextLeaseKey, state);
				}
				let ownerEntry = state.holders.get(ownerKey) || null;
				let ownerCount = Number(
					ownerEntry && typeof ownerEntry == "object"
						? ownerEntry.count
						: ownerEntry
				) || 0;
				let holderCount = 0;
				let sharedHeld = false;
				for (let holder of state.holders.values()) {
					let count = Number(
						holder && typeof holder == "object"
							? holder.count
							: holder
					) || 0;
					if (count > 0) {
						holderCount += count;
					}
					let holderSharedKey = holder && typeof holder == "object"
						? String(holder.sharedKey || "").trim()
						: "";
					if (sharedKey && holderSharedKey && holderSharedKey == sharedKey) {
						sharedHeld = true;
					}
				}
				if (ownerCount > 0 || sharedHeld || holderCount < capacity) {
					state.holders.set(ownerKey, {
						count: ownerCount + 1,
						sharedKey,
					});
					release = () => {
						let activeState = this.jobResourceLeases.get(nextLeaseKey);
						if (!activeState) {
							return;
						}
						let activeOwnerEntry = activeState.holders.get(ownerKey) || null;
						let activeOwnerCount = Math.max(0, (
							Number(
								activeOwnerEntry && typeof activeOwnerEntry == "object"
									? activeOwnerEntry.count
									: activeOwnerEntry
							) || 0
						) - 1);
						if (activeOwnerCount > 0) {
							activeState.holders.set(ownerKey, {
								count: activeOwnerCount,
								sharedKey,
							});
						}
						else {
							activeState.holders.delete(ownerKey);
						}
						if (!activeState.holders.size) {
							this.jobResourceLeases.delete(nextLeaseKey);
						}
					};
					break;
				}
				if (cancelCheck && await cancelCheck()) {
					let error = new Error("Workflow job canceled.");
					error.code = "SR_JOB_CANCELED";
					error.canceled = true;
					error.isCanceled = true;
					throw error;
				}
				if (jobID && projectID && waitReason && !waitReasonSet) {
					this._setJobWaitReason(projectID, jobID, waitReason);
					await this._refreshAllControllers().catch(() => {});
					waitReasonSet = true;
				}
				await Zotero.Promise.delay(pollMS);
			}
			if (jobID && projectID) {
				this._clearJobWaitReason(projectID, jobID);
			}
			return await runner();
		}
		finally {
			if (jobID && projectID) {
				this._clearJobWaitReason(projectID, jobID);
			}
			if (typeof release == "function") {
				release();
			}
		}
	},

	async _withProjectDBWriteLease(context, runner, options = {}) {
		let projectID = String(context?.projectID || "").trim();
		if (!projectID) {
			return await runner();
		}
		let jobID = String(options.jobID || "").trim();
		let sharedKey = Object.prototype.hasOwnProperty.call(options || {}, "sharedKey")
			? String(options.sharedKey || "").trim()
			: (jobID ? `job:${jobID}` : "");
		return await this._withLease(`project_db_write:${projectID}`, {
			ownerKey: String(options.ownerKey || jobID || `project-db:${projectID}`).trim(),
			sharedKey,
			capacity: 1,
			projectID,
			jobID,
			waitReason: "Waiting for project database write access.",
			cancelCheck: jobID
				? async () => await this._jobCancelRequested(context, jobID)
				: null,
		}, runner);
	},

	async _withZoteroWriteLease(currentOrContext, runner, options = {}) {
		let projectID = String(currentOrContext?.context?.projectID || currentOrContext?.projectID || "").trim();
		let context = currentOrContext?.context || currentOrContext || null;
		let jobID = String(options.jobID || "").trim();
		return await this._withLease("zotero_write", {
			ownerKey: String(options.ownerKey || jobID || `zotero-write:${Date.now().toString(36)}`).trim(),
			sharedKey: jobID ? `job:${jobID}` : "",
			capacity: 1,
			projectID,
			jobID,
			waitReason: "Waiting for Zotero item or collection write access.",
			cancelCheck: (jobID && context)
				? async () => await this._jobCancelRequested(context, jobID)
				: null,
		}, runner);
	},

	async _runtimeLeaseForJob(current, job, metadata = {}) {
		let kind = String(job?.kind || "").trim();
		if (!["manual_embeddings", "manual_extraction", "manual_extraction_single", "manual_semantic_search", "manual_explore_chat", "convert_attachment_markdown"].includes(kind)) {
			return null;
		}
		let roleID = "";
		let presetID = "default";
		let prepared = null;
		try {
			if (kind == "manual_embeddings") {
				roleID = "embeddings";
				let config = await this._conversionConfig();
				prepared = await this._prepareRoleAPIClient(roleID, config.embeddingsClient, config, {
					presetID: metadata?.model_preset_id || metadata?.preset_id || "default",
				});
			}
			else if (kind == "manual_extraction" || kind == "manual_extraction_single") {
				roleID = "data_extraction";
				presetID = String(metadata?.model_preset_id || metadata?.preset_id || metadata?.payload?.runtime_preset_id || "default").trim() || "default";
				let config = await this._conversionConfig();
				prepared = await this._prepareRoleAPIClient(roleID, config.extractionClient, config, {
					presetID,
				});
			}
			else if (kind == "manual_semantic_search") {
				roleID = "embeddings";
				let config = await this._conversionConfig();
				prepared = await this._prepareRoleAPIClient(roleID, config.embeddingsClient, config, {
					presetID: metadata?.model_preset_id || metadata?.preset_id || "default",
				});
			}
			else if (kind == "manual_explore_chat") {
				roleID = String(metadata?.runtime_role_id || metadata?.payload?.runtime_role_id || "session_chat").trim() || "session_chat";
				presetID = String(metadata?.model_preset_id || metadata?.preset_id || metadata?.payload?.runtime_preset_id || "default").trim() || "default";
				let config = await this._conversionConfig();
				let baseClient = roleID == "data_extraction" ? config.extractionClient : config.chatClient;
				prepared = await this._prepareRoleAPIClient(roleID, baseClient, config, {
					presetID,
				});
			}
			else if (kind == "convert_attachment_markdown") {
				roleID = "pdf_vlm";
				let config = await this._conversionConfig();
				prepared = await this._prepareRoleAPIClient(roleID, config.vlmClient, config, {
					presetID: metadata?.model_preset_id || metadata?.preset_id || "default",
				});
			}
			let client = prepared?.client || null;
			if (!client || client.independentResources) {
				return null;
			}
			let leaseKey = String(client.schedulerKey || "").trim();
			if (!leaseKey) {
				return null;
			}
			return {
				key: `runtime:${leaseKey}`,
				capacity: Math.max(1, Number(client.parallelRequests || 1) || 1),
				waitReason: `Waiting for ${roleID || "runtime"} capacity.`,
			};
		}
		finally {
			await prepared?.release?.();
		}
	},

	_hasPendingJobReference(jobID = "") {
		let target = String(jobID || "").trim();
		if (!target) {
			return false;
		}
		return this.pendingJobQueue.some((entry) => String(entry?.jobID || "").trim() == target);
	},

	_pushPendingJobReference(entry = {}) {
		let jobID = String(entry?.jobID || "").trim();
		if (!jobID || this._hasPendingJobReference(jobID)) {
			return false;
		}
		this.pendingJobQueue.push({
			projectID: entry.projectID,
			libraryID: entry.libraryID,
			collectionKey: entry.collectionKey,
			databasePath: entry.databasePath,
			jobID,
			readyAt: Math.max(0, Number(entry?.readyAt || 0) || 0),
			retryCount: Math.max(0, Number(entry?.retryCount || 0) || 0),
		});
		return true;
	},

	_clearJobRecoveryAttempt(jobID = "") {
		let target = String(jobID || "").trim();
		if (!target) {
			return 0;
		}
		this.jobRecoveryAttempts?.delete?.(target);
		return 0;
	},

	_incrementJobRecoveryAttempt(jobID = "") {
		let target = String(jobID || "").trim();
		if (!target) {
			return 0;
		}
		if (!this.jobRecoveryAttempts) {
			this.jobRecoveryAttempts = new Map();
		}
		let nextCount = (Number(this.jobRecoveryAttempts.get(target) || 0) || 0) + 1;
		this.jobRecoveryAttempts.set(target, nextCount);
		return nextCount;
	},

	async _markRecoveredJobFailed(entry = {}, message = "") {
		let jobID = String(entry?.jobID || "").trim();
		let projectID = String(entry?.projectID || "").trim();
		let databasePath = String(entry?.databasePath || "").trim();
		let errorMessage = String(message || "Queued workflow job could not be resumed after restart.").trim();
		if (!jobID || !projectID || !databasePath) {
			return false;
		}
		let context = {
			projectID,
			databasePath,
		};
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT kind, metadata_json
			 FROM jobs
			 WHERE job_id=?
			 LIMIT 1`,
			[jobID]
		);
		let job = rows?.[0] || null;
		let now = new Date().toISOString();
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET status='failed', cancel_requested=0, error_message=?, finished_at=COALESCE(finished_at, ?), updated_at=?
				 WHERE job_id=?
				   AND status IN ('queued', 'running')`,
				[errorMessage, now, now, jobID]
			);
			if (String(job?.kind || "").trim() == "manual_harvest") {
				let metadata = this._parseJobMetadata({ metadata_json: String(job?.metadata_json || "") });
				let runID = String(metadata?.run_id || "").trim();
				if (runID) {
					await db.queryAsync(
						`UPDATE harvest_runs
						 SET status='interrupted',
						     cancel_requested=0,
						     error_message=CASE
						     	WHEN error_message IS NULL OR error_message=''
						     	THEN ?
						     	ELSE error_message
						     END,
						     last_heartbeat_at=?,
						     updated_at=?
						 WHERE run_id=?
						   AND status IN ('queued', 'running')`,
						[errorMessage, now, now, runID]
					);
				}
			}
		}, {
			jobID,
			ownerKey: `job-recovery-fail:${projectID}:${jobID}`,
		});
		await this._appendJobLog(context, jobID, "error", errorMessage).catch(() => {});
		this._clearJobRecoveryAttempt(jobID);
		this._clearJobWaitReason(projectID, jobID);
		return true;
	},

	async _reconcileJobsAfterRestart() {
		let now = new Date().toISOString();
		let projects = await this._listStoredProjects().catch(() => []);
		for (let project of projects || []) {
			let projectID = String(project?.project_id || "").trim();
			let databasePath = String(project?.database_path || "").trim();
			if (!projectID || !databasePath) {
				continue;
			}
			let context = {
				projectID,
				databasePath,
			};
			let db = await this._projectDB(context);
			let runningJobs = await db.queryAsync(
				`SELECT job_id, kind, metadata_json, title
				 FROM jobs
				 WHERE status='running'`
			).catch(() => []);
			if (!runningJobs.length) {
				continue;
			}
			let interruptedMessage = "Workflow job was interrupted when Zotero restarted.";
			await this._withProjectDBWriteLease(context, async () => {
				await db.queryAsync(
					`UPDATE jobs
					 SET status='failed',
					     cancel_requested=0,
					     error_message=CASE
					     	WHEN error_message IS NULL OR error_message=''
					     	THEN ?
					     	ELSE error_message
					     END,
					     finished_at=COALESCE(finished_at, ?),
					     updated_at=?
					 WHERE status='running'`,
					[interruptedMessage, now, now]
				);
				for (let row of runningJobs) {
					if (String(row?.kind || "").trim() != "manual_harvest") {
						continue;
					}
					let metadata = this._parseJobMetadata({ metadata_json: String(row?.metadata_json || "") });
					let runID = String(metadata?.run_id || "").trim();
					if (!runID) {
						continue;
					}
					await db.queryAsync(
						`UPDATE harvest_runs
						 SET status='interrupted',
						     cancel_requested=0,
						     error_message=CASE
						     	WHEN error_message IS NULL OR error_message=''
						     	THEN ?
						     	ELSE error_message
						     END,
						     last_heartbeat_at=?,
						     updated_at=?
						 WHERE run_id=?
						   AND status='running'`,
						[interruptedMessage, now, now, runID]
					);
				}
			}, {
				ownerKey: `job-reconcile:${projectID}`,
			});
			for (let row of runningJobs) {
				let jobID = String(row?.job_id || "").trim();
				if (!jobID) {
					continue;
				}
				await this._appendJobLog(context, jobID, "error", interruptedMessage).catch(() => {});
			}
		}
	},

	_harvestImportRecoveryKey(projectID = "", runID = "", jobID = "") {
		let nextProjectID = this._jobOptionalString(projectID);
		let nextRunID = this._jobOptionalString(runID);
		let nextJobID = this._jobOptionalString(jobID);
		return nextProjectID && nextRunID && nextJobID ? `${nextProjectID}:${nextRunID}:${nextJobID}` : "";
	},

	_scheduleHarvestImportRecoveryWatchdog(delayMs = HARVEST_IMPORT_RECOVERY_SCAN_MS) {
		if (!this.initialized || this.harvestImportRecoveryWatchdogScheduled) {
			return;
		}
		this.harvestImportRecoveryWatchdogScheduled = true;
		let generation = Number(this.harvestImportRecoveryWatchdogGeneration || 0) || 0;
		let wait = Math.max(0, Number(delayMs || 0) || 0);
		Zotero.Promise.delay(wait).then(async () => {
			this.harvestImportRecoveryWatchdogScheduled = false;
			if ((Number(this.harvestImportRecoveryWatchdogGeneration || 0) || 0) != generation || !this.initialized) {
				return;
			}
			try {
				await this._scanHarvestImportRecovery();
			}
			catch (error) {
				this.log(`harvest import recovery scan skipped: ${error}`);
			}
			if ((Number(this.harvestImportRecoveryWatchdogGeneration || 0) || 0) == generation && this.initialized) {
				this._scheduleHarvestImportRecoveryWatchdog(HARVEST_IMPORT_RECOVERY_SCAN_MS);
			}
		}).catch((error) => {
			this.harvestImportRecoveryWatchdogScheduled = false;
			this.log(`harvest import recovery watchdog failed: ${error}`);
		});
	},

	_stopHarvestImportRecoveryWatchdog() {
		this.harvestImportRecoveryWatchdogGeneration = (Number(this.harvestImportRecoveryWatchdogGeneration || 0) || 0) + 1;
		this.harvestImportRecoveryWatchdogScheduled = false;
		this.harvestImportRecoveryRunning = false;
		this.harvestImportRecoveryLocks = new Set();
	},

	async _loadHarvestRunSnapshot(context, runID = "") {
		let target = this._jobOptionalString(runID);
		if (!context || !target) {
			return null;
		}
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT run_id, job_id, status, stage, fetch_completed_at, last_heartbeat_at, updated_at
			 FROM harvest_runs
			 WHERE run_id=?
			 LIMIT 1`,
			[target]
		);
		return rows?.[0] || null;
	},

	async _waitForHarvestRunStatus(context, runID, expectedStatuses = [], timeoutMs = HARVEST_IMPORT_STOP_GRACE_MS, pollMs = 2000) {
		let deadline = Date.now() + Math.max(0, Number(timeoutMs || 0) || 0);
		let expected = new Set((Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]).map((value) => this._jobOptionalString(value)));
		while (Date.now() <= deadline) {
			let row = await this._loadHarvestRunSnapshot(context, runID).catch(() => null);
			let status = this._jobOptionalString(row?.status);
			if (row && expected.has(status)) {
				return row;
			}
			if (Date.now() >= deadline) {
				return row;
			}
			await Zotero.Promise.delay(Math.max(200, Number(pollMs || 0) || 2000));
		}
		return await this._loadHarvestRunSnapshot(context, runID).catch(() => null);
	},

	async _scanHarvestImportRecovery() {
		if (this.harvestImportRecoveryRunning) {
			return;
		}
		this.harvestImportRecoveryRunning = true;
		try {
			let cutoffISO = new Date(Date.now() - HARVEST_IMPORT_STALL_MS).toISOString();
			let projects = await this._listStoredProjects().catch(() => []);
			for (let stored of projects || []) {
				let context = this._contextFromStoredProject(stored);
				if (!context.projectID || !context.databasePath) {
					continue;
				}
				let db = await this._projectDB(context);
				let rows = await db.queryAsync(
					`SELECT runs.run_id, runs.job_id, runs.status AS run_status, runs.stage,
					        runs.fetch_completed_at, runs.last_heartbeat_at, runs.updated_at AS run_updated_at,
					        runs.import_candidate_index, runs.processed_candidates,
					        jobs.kind, jobs.status AS job_status, jobs.metadata_json
					 FROM harvest_runs runs
					 JOIN jobs jobs
					   ON jobs.job_id = runs.job_id
					 WHERE runs.status='running'
					   AND runs.stage='import'
					   AND COALESCE(runs.fetch_completed_at, '') != ''
					   AND jobs.kind='manual_harvest'
					   AND jobs.status='running'
					   AND COALESCE(runs.last_heartbeat_at, runs.updated_at, runs.started_at, runs.created_at) < ?`,
					[cutoffISO]
				).catch(() => []);
				for (let row of rows || []) {
					let key = this._harvestImportRecoveryKey(context.projectID, row?.run_id, row?.job_id);
					if (!key) {
						continue;
					}
					if (!this.harvestImportRecoveryLocks) {
						this.harvestImportRecoveryLocks = new Set();
					}
					if (this.harvestImportRecoveryLocks.has(key)) {
						continue;
					}
					this.harvestImportRecoveryLocks.add(key);
					try {
						await this._recoverStalledHarvestImport({ stored, context, row });
					}
					catch (error) {
						this.log(`harvest import recovery skipped for ${context.projectID}/${this._jobOptionalString(row?.run_id)}: ${error}`);
					}
					finally {
						this.harvestImportRecoveryLocks.delete(key);
					}
				}
			}
		}
		finally {
			this.harvestImportRecoveryRunning = false;
		}
	},

	async _recoverStalledHarvestImport({ stored = {}, context = {}, row = {} } = {}) {
		let projectID = this._jobOptionalString(context.projectID || stored.project_id);
		let runID = this._jobOptionalString(row?.run_id);
		let jobID = this._jobOptionalString(row?.job_id);
		if (!projectID || !runID || !jobID) {
			return;
		}
		let activeJob = await this._readJobRecord(context, jobID).catch(() => null);
		if (!activeJob || this._jobOptionalString(activeJob.kind) != "manual_harvest" || this._jobOptionalString(activeJob.status) != "running") {
			return;
		}
		let resolved = await this._resolveStoredProjectForJobs(projectID);
		let current = resolved?.current || null;
		if (!current) {
			this.log(`harvest import recovery skipped for ${projectID}/${runID}: project runtime is unavailable`);
			return;
		}
		let detectedAt = new Date().toISOString();
		let recoverySummary = "Harvest NDJSON import has not advanced for more than 20 minutes. Automatic recovery will Stop this job and then Continue from the saved checkpoint.";
		let autoCancelMessage = "Harvest NDJSON import stalled for more than 20 minutes. Automatic recovery canceled this job so Continue could resume from the saved checkpoint.";
		await this._mergeJobMetadata(context, jobID, {
			watchdog_recovery: {
				reason: "stalled_ndjson_import",
				run_id: runID,
				detected_at: detectedAt,
				source_job_id: jobID,
			},
		}).catch(() => null);
		await this._appendJobLog(context, jobID, "warn", recoverySummary).catch(() => {});
		await this._controlGlobalJob({
			project_id: projectID,
			job_id: jobID,
			action: "stop",
			cancel_message: autoCancelMessage,
		});
		await this._appendJobLog(context, jobID, "warn", "Automatic recovery requested Stop. Waiting for the normal cancel checkpoint before queuing Continue.").catch(() => {});
		let stoppedRun = await this._waitForHarvestRunStatus(context, runID, ["canceled"], HARVEST_IMPORT_STOP_GRACE_MS);
		let forcedHandoff = false;
		if (this._jobOptionalString(stoppedRun?.status) != "canceled") {
			forcedHandoff = true;
			await this._appendJobLog(context, jobID, "warn", "The stalled harvest did not reach its normal cancel checkpoint. Finishing the stop with canceled semantics so Continue can resume from the saved checkpoint.").catch(() => {});
			await this._markJobCanceled({ context }, jobID, {
				message: autoCancelMessage,
				metadata: {
					watchdog_recovery: {
						reason: "stalled_ndjson_import",
						run_id: runID,
						detected_at: detectedAt,
						source_job_id: jobID,
						forced_canceled_handoff: true,
					},
				},
			}).catch(() => {});
			let now = new Date().toISOString();
			let db = await this._projectDB(context);
			await this._withProjectDBWriteLease(context, async () => {
				await db.queryAsync(
					`UPDATE harvest_runs
					 SET status='canceled',
					     cancel_requested=0,
					     error_message=?,
					     completed_at=COALESCE(completed_at, ?),
					     last_heartbeat_at=?,
					     updated_at=?
					 WHERE run_id=?
					   AND job_id=?`,
					[autoCancelMessage, now, now, now, runID, jobID]
				);
			}, {
				jobID,
				ownerKey: `harvest-watchdog-stop:${context.projectID}:${jobID}`,
			});
		}
		let continueResponse = await this._controlGlobalJob({
			project_id: projectID,
			job_id: jobID,
			action: "continue",
		});
		let continuedJobID = this._jobOptionalString(continueResponse?.job_id);
		await this._mergeJobMetadata(context, jobID, {
			watchdog_recovery: {
				reason: "stalled_ndjson_import",
				run_id: runID,
				detected_at: detectedAt,
				source_job_id: jobID,
				forced_canceled_handoff: forcedHandoff,
				continued_job_id: continuedJobID,
			},
		}).catch(() => null);
		await this._appendJobLog(
			context,
			jobID,
			"warn",
			continuedJobID
				? `Automatic recovery queued Continue as ${continuedJobID}. Resuming from the saved checkpoint.`
				: "Automatic recovery queued Continue. Resuming from the saved checkpoint."
		).catch(() => {});
		if (continuedJobID) {
			await this._mergeJobMetadata(context, continuedJobID, {
				watchdog_recovery: {
					reason: "stalled_ndjson_import",
					run_id: runID,
					detected_at: detectedAt,
					recovered_from_job_id: jobID,
				},
			}).catch(() => null);
			await this._appendJobLog(context, continuedJobID, "info", `Queued automatically after harvest import recovery for run ${runID}. Resuming from the saved checkpoint.`).catch(() => {});
		}
		await this._refreshAllControllers().catch(() => {});
	},

	_removePendingJobReference(jobID = "") {
		let target = String(jobID || "").trim();
		if (!target || !Array.isArray(this.pendingJobQueue)) {
			return false;
		}
		let initialLength = this.pendingJobQueue.length;
		this.pendingJobQueue = this.pendingJobQueue.filter((entry) => String(entry?.jobID || "").trim() != target);
		return this.pendingJobQueue.length !== initialLength;
	},

	async _createQueuedWorkflowJob(current, options = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Project runtime is unavailable for queued workflow jobs.");
		}
		let job = await this._insertWorkflowJobRecord(current, Object.assign({}, options, {
			status: "queued",
		}));
		await this._appendJobLog(context, job.job_id, "info", `Queued ${job.title}`);
		return job;
	},

	async _queueWorkflowJob(current, options = {}) {
		options = options || {};
		let job = await this._createQueuedWorkflowJob(current, options);
		let requestedDelay = Math.max(0, Number(options.startDelayMs ?? options.start_delay_ms ?? 0) || 0);
		let kind = String(options.kind || "").trim();
		let startDelayMs = requestedDelay;
		if (kind == "manual_harvest_merge") {
			startDelayMs = Math.max(startDelayMs, HARVEST_MERGE_JOB_START_DELAY_MS);
		}
		else if (kind == "manual_harvest" || kind == "manual_harvest_estimate") {
			startDelayMs = Math.max(startDelayMs, HARVEST_RUN_JOB_START_DELAY_MS);
		}
		else if (kind == "manual_embeddings") {
			startDelayMs = Math.max(startDelayMs, EMBEDDINGS_JOB_START_DELAY_MS);
		}
		this._pushPendingJobReference({
			projectID: current?.context?.projectID,
			libraryID: current?.context?.libraryID,
			collectionKey: current?.context?.collectionKey,
			jobID: job.job_id,
			readyAt: Date.now() + startDelayMs,
		});
		this._scheduleJobPump(startDelayMs);
		if (options.openJobsTab === true) {
			await this._openJobsTab(options.targetWin || this._primaryWindow(), current);
		}
		if (options.refreshControllers !== false) {
			await this._refreshAllControllers();
		}
		return job;
	},

	async _launchWorkflowJob(current, options = {}) {
		options = options || {};
		let job = await this._queueWorkflowJob(current, options);
		let waitForCompletion = options.waitForCompletion === true || options.wait_for_completion === true;
		if (!waitForCompletion) {
			return Object.assign({
				ok: true,
				queued: true,
				job_id: String(job?.job_id || "").trim(),
				job_kind: String(options.kind || "").trim(),
				message: String(options.message || "Job started. Track progress in Jobs.").trim(),
			}, job || {});
		}
		return await this._awaitJobCompletion(current?.context?.projectID || "", String(job?.job_id || "").trim());
	},

	async _queueConversionSourcesForCollection(collection, sources, mode, options = {}) {
		options = options || {};
		let projectCollection = await this._projectCollectionForItemTools(collection);
		if (!projectCollection) {
			throw new Error("Manual conversion requires an existing Systematic Reviewer or Custom Analysis project. Create one from My Library first.");
		}
		let current = await this._openExistingCollectionProject(projectCollection);
		let result = await this._enqueueConversionSources(current, sources, mode, options);
		result.projectCollection = projectCollection;
		return result;
	},

	async _existingConversionSourceKeys(context) {
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT DISTINCT source_attachment_key
			 FROM jobs
			 WHERE kind='convert_attachment_markdown'
			   AND status IN ('queued', 'running')
			   AND source_attachment_key IS NOT NULL
			   AND source_attachment_key != ''`
		);
		let keys = new Set();
		for (let row of rows || []) {
			let key = String(row.source_attachment_key || "").trim();
			if (key) {
				keys.add(key);
			}
		}
		return keys;
	},

	async _conversionSourceHasUsableTextAttachment(source = null) {
		let item = source?.parentItem || null;
		if (!item && source?.attachment?.parentItemID) {
			item = Zotero.Items.get(source.attachment.parentItemID) || null;
		}
		if (!item || item.deleted || !SystematicReviewerWorkflowRAG?.preferredMarkdownSourceForItem) {
			return false;
		}
		let preferred = await SystematicReviewerWorkflowRAG.preferredMarkdownSourceForItem(this, item).catch(() => null);
		return !!(preferred?.attachment_key && preferred?.markdown_path);
	},

	async _queueAutoFastConversionJobs(current) {
		if (!current?.context || !current?.collection || !current?.projectItem) {
			return [];
		}
		let config = this._conversionConfig
			? await this._conversionConfig().catch(() => null)
			: null;
		let requestedMode = this._jobOptionalString(config?.pdf_markdown?.mode || config?.pdfMarkdown?.mode || "") || "fast";
		let existingKeys = await this._existingConversionSourceKeys(current.context);
		let rawSources = this._projectConversionSources(current.collection, current.projectItem, {
			pdfOnly: true,
		});
		let summaryByItemKey = new Map();
		let sources = [];
		for (let source of rawSources) {
			let key = String(source?.attachment?.key || "").trim();
			if (!key || existingKeys.has(key)) {
				continue;
			}
			let parentItem = source?.parentItem || null;
			if (parentItem?.key && SystematicReviewerWorkflowScreening?.fullTextSummaryForItem) {
				let itemKey = String(parentItem.key || "").trim();
				let summary = summaryByItemKey.get(itemKey) || null;
				if (!summary) {
					summary = await SystematicReviewerWorkflowScreening.fullTextSummaryForItem(this, parentItem).catch(() => null);
					summaryByItemKey.set(itemKey, summary);
				}
				if (String(summary?.full_text_state || "").trim() != "pdf_only") {
					continue;
				}
			}
			sources.push(source);
		}
		if (!sources.length) {
			return [];
		}
		let result = await this._enqueueConversionSources(current, sources, requestedMode, {
			openJobsTab: false,
			refreshControllers: false,
		});
		return result.jobs || [];
	},

	async _reconcileProjectConversionAutomation(current, options = {}) {
		if (!current?.context || !current?.collection || !current?.projectItem) {
			return {
				ok: true,
				mode: "skipped",
				jobs: [],
			};
		}
		let activeRetrieval = await SystematicReviewerWorkflowFullText?.hasActiveRetrieval?.({
			reviewer: this,
			context: current.context,
		});
		if (activeRetrieval) {
			let monitor = await SystematicReviewerWorkflowFullText.reconcileActiveMonitor({
				reviewer: this,
				current,
				payload: options.payload || {},
				reason: options.reason || "project_refresh",
			});
			return {
				ok: true,
				mode: "full_text_retrieval",
				monitor,
				jobs: Array.isArray(monitor?.conversion_queue?.jobs) ? monitor.conversion_queue.jobs : [],
			};
		}
		let jobs = await this._queueAutoFastConversionJobs(current);
		return {
			ok: true,
			mode: "auto_fast",
			jobs,
		};
	},

	async _createConversionJob(context, collection, projectItem, source, mode) {
		let sourcePath = source.path;
		let sourceFile = this._nsIFile(sourcePath);
		let stem = sourceFile.leafName.replace(/\.[^.]+$/, "").trim() || "Converted";
		let sourceKey = source.attachment.key || source.attachment.id;
		let folder = this._joinPath(context.conversionsDir, sourceKey);
		await this._ensureDirectory(folder);
		let requestedLabel = mode == "fast" ? "F" : "V";
		let outputPath = this._joinPath(
			folder,
			`${stem}${requestedLabel}.md`
		);
		let title = `${sourceFile.leafName} - ${mode == "fast_with_vlm_fallback" ? "Auto" : mode.toUpperCase()}`;
		let current = {
			context,
			collection,
			projectItem,
		};
		let job = await this._insertWorkflowJobRecord(current, {
			prefix: "job",
			kind: "convert_attachment_markdown",
			title,
			status: "queued",
			requested_mode: mode,
			used_mode: "",
			parent_item_key: source.parentItem?.key || "",
			source_item_key: source.parentItem?.key || source.attachment.key || "",
			source_attachment_key: source.attachment.key || "",
			source_title: this._itemField(source.attachment, "title") || sourceFile.leafName,
			source_content_type: source.attachment.attachmentContentType || this._contentTypeForPath(sourcePath),
			source_path: sourcePath,
			output_path: outputPath,
			metadata: {
				parent_item_id: source.parentItem?.id || null,
				parent_item_key: source.parentItem?.key || "",
				attachment_item_id: source.attachment.id,
				attachment_item_key: source.attachment.key || "",
				kind: source.kind,
			},
		});
		await this._appendJobLog(context, job.job_id, "info", `Queued ${title}`);
		return {
			job_id: job.job_id,
			status: "queued",
			requested_mode: mode,
			output_path: outputPath,
		};
	},

	_scheduleJobPump(delayMs = 0) {
		if (this.jobPumpScheduled) {
			return;
		}
		this.jobPumpScheduled = true;
		let wait = Math.max(0, Number(delayMs || 0) || 0);
		Zotero.Promise.delay(wait).then(() => {
			this.jobPumpScheduled = false;
			return this._pumpJobQueue();
		}).catch((error) => this.log(`job pump failed: ${error}`));
	},

	async _recoverQueuedJobEntries() {
		let recovered = [];
		let seen = new Set(this.pendingJobQueue.map((entry) => String(entry?.jobID || "").trim()).filter(Boolean));
		let projects = await this._listStoredProjects().catch(() => []);
		for (let project of projects || []) {
			let projectID = String(project?.project_id || "").trim();
			let libraryID = Number(project?.library_id || 0) || 0;
			let collectionKey = String(project?.collection_key || "").trim();
			let databasePath = String(project?.database_path || "").trim();
			if (!projectID || !libraryID || !collectionKey || !databasePath) {
				continue;
			}
			let db = await this._projectDB({
				projectID,
				databasePath,
			});
			let rows = await db.queryAsync(
				`SELECT job_id
				 FROM jobs
				 WHERE status='queued'
				 ORDER BY created_at ASC`
			);
			for (let row of rows || []) {
				let jobID = String(row?.job_id || "").trim();
				if (!jobID || seen.has(jobID)) {
					continue;
				}
				seen.add(jobID);
					recovered.push({
						projectID,
						libraryID,
						collectionKey,
						databasePath,
						jobID,
						readyAt: 0,
						retryCount: 0,
					});
				}
			}
		for (let entry of recovered) {
			this._pushPendingJobReference(entry);
		}
		return recovered;
	},

	async _pumpJobQueue() {
		if (this.jobPumpRunning) {
			return;
		}
		this.jobPumpRunning = true;
		let rescheduleDelay = 0;
		try {
			while (true) {
				if (!this.pendingJobQueue.length) {
					let recovered = await this._recoverQueuedJobEntries();
					if (!recovered.length) {
						break;
					}
				}
				if (!this.activeJobRunners) {
					this.activeJobRunners = new Map();
				}
				let launched = false;
				let now = Date.now();
				while (this.activeJobRunners.size < GLOBAL_JOB_RUNNER_LIMIT && this.pendingJobQueue.length) {
					let readyIndex = this.pendingJobQueue.findIndex((entry) => (Number(entry?.readyAt || 0) || 0) <= now);
					if (readyIndex < 0) {
						let nextReadyAt = Number(this.pendingJobQueue[0]?.readyAt || 0) || 0;
						for (let entry of this.pendingJobQueue) {
							let candidateReadyAt = Number(entry?.readyAt || 0) || 0;
							if (candidateReadyAt && (!nextReadyAt || candidateReadyAt < nextReadyAt)) {
								nextReadyAt = candidateReadyAt;
							}
						}
						if (nextReadyAt > now) {
							rescheduleDelay = Math.max(0, nextReadyAt - now);
						}
						break;
					}
					let [next] = this.pendingJobQueue.splice(readyIndex, 1);
					if (!next) {
						break;
					}
					launched = true;
					this._startQueuedJobRunner(next);
				}
				if (!launched) {
					if (this.pendingJobQueue.length || this.activeJobRunners.size) {
						break;
					}
					break;
				}
			}
		}
		finally {
			this.jobPumpRunning = false;
			if (this.pendingJobQueue.length) {
				this._scheduleJobPump(rescheduleDelay);
			}
		}
	},

	_startQueuedJobRunner(entry) {
		if (!entry?.jobID) {
			return;
		}
		let key = String(entry.jobID || "").trim();
		if (!key) {
			return;
		}
		if (!this.activeJobRunners) {
			this.activeJobRunners = new Map();
		}
		if (this.activeJobRunners.has(key)) {
			return;
		}
		let runner = this._runQueuedJob(entry)
			.then((result) => {
				this._settleJobCompletion(entry.projectID, key, {
					value: result,
				});
				return result;
			})
			.catch((error) => {
				this._settleJobCompletion(entry.projectID, key, {
					error,
				});
				this.log(`job ${key} failed: ${error}`);
			})
			.finally(async () => {
				this.activeJobRunners.delete(key);
				this._scheduleJobPump(DEFAULT_LEASE_POLL_MS);
			});
		this.activeJobRunners.set(key, runner);
	},

	async _runQueuedConversionJob(current, job) {
		let context = current.context;
		let jobID = String(job?.job_id || "").trim();
		let sourceAttachment = Zotero.Items.getByLibraryAndKey(context.libraryID, job.source_attachment_key);
		if (!sourceAttachment) {
			throw new Error(`Source attachment not found for ${job.source_attachment_key}`);
		}
		let parentItem = sourceAttachment.parentItemID ? Zotero.Items.get(sourceAttachment.parentItemID) : null;
		let config = await this._conversionConfig();
		this._assertRoleExecutionReady("pdf_vlm", config, "PDF / Conversion");
		let preparedVLM = await this._prepareRoleAPIClient("pdf_vlm", config.vlmClient, config);
		let result;
		try {
			result = await SystematicReviewerPDFMarkdown.convertSource({
				inputPath: job.source_path,
				mode: job.requested_mode,
				outputDir: this._parentPath(job.output_path),
				client: preparedVLM.client || config.vlmClient,
				runtime: config.runtime,
				pdfPrompt: config.pdfPrompt,
				imagePrompt: config.imagePrompt,
				attachmentItemID: sourceAttachment.id,
				hooks: {
					onLog: async (level, message) => {
						await this._appendJobLog(context, jobID, level, message);
						await this._refreshAllControllers();
					},
					onProgress: async (progress) => {
						await this._updateJobProgress(context, jobID, progress.current || 0, progress.total || 0, progress.message || "");
					},
					yield: async () => {
						await this._throwIfJobCanceled(current, jobID);
						await Zotero.Promise.delay(0);
					},
				},
			});
		}
		finally {
			await preparedVLM.release?.();
		}
		let attachmentTitle = this._basename(result.outputPath);
		let outputAttachment = await this._upsertConvertedMarkdownAttachment(
			sourceAttachment,
			parentItem,
			current.collection,
			result.outputPath,
			attachmentTitle
		);
			await this._markJobSucceeded(current, jobID, {
				used_mode: result.usedMode,
				output_path: result.outputPath,
				output_attachment_key: outputAttachment?.key || "",
			fallback_used: result.fallbackUsed === true,
			progress_current: Number(job?.progress_total || 0) || 0,
			progress_total: Number(job?.progress_total || 0) || 0,
			message: `Completed ${job.title} - ${attachmentTitle}${result.fallbackUsed ? " (fallback used)" : ""}`,
				metadata: Object.assign({}, this._parseJobMetadata(job || {}), {
					fallback_used: result.fallbackUsed === true,
				}),
			});
		},

		_conversionTextContentTypeForPath(path = "") {
			let lower = String(path || "").toLowerCase();
			if (lower.endsWith(".csv")) {
				return "text/csv";
			}
			if (lower.endsWith(".txt")) {
				return "text/plain";
			}
			return "text/markdown";
		},

	async _runQueuedProjectReconcileJob(current, job) {
		let context = current.context;
		let jobID = String(job?.job_id || "").trim();
		let metadata = this._parseJobMetadata(job || {});
		await this._updateJobProgress(context, jobID, 0, 4, "Reconciling project links and workflow files.");
		await this._reconcileCollectionProject(context, current.collection, current.projectItem, null, {
			current,
			jobID,
			batchSize: 10,
			onYield: async () => {
				await this._throwIfJobCanceled(current, jobID);
			},
		});
		await this._updateJobProgress(context, jobID, 1, 4, "Linked project files and source attachments.");
		let reconcile = await this._reconcileProjectItemKeys(context, current.collection, current.projectItem);
		await this._updateJobProgress(context, jobID, 2, 4, `Repaired ${Number(reconcile?.applied_count || 0) || 0} project item keys.`);
		await this._reconcileProjectConversionAutomation(current, {
			reason: "settings_project_reconcile",
			payload: metadata?.payload || {},
		});
		await this._updateJobProgress(context, jobID, 3, 4, "Checked conversion automation.");
		let counts = await this._projectCounts(context);
		await this._markJobSucceeded(current, jobID, {
			used_mode: "batched",
			output_path: context.databasePath || "",
			progress_current: 4,
			progress_total: 4,
			message: `Reconciled project. Items: ${Number(counts?.items || 0) || 0}. Attachments: ${Number(counts?.attachments || 0) || 0}.`,
			metadata: Object.assign({}, metadata || {}, {
				applied_count: Number(reconcile?.applied_count || 0) || 0,
				counts,
			}),
		});
		return {
			ok: true,
			applied_count: Number(reconcile?.applied_count || 0) || 0,
			counts,
		};
	},

	async _runQueuedJob(entry) {
		let jobID = entry.jobID;
		let collection = this._collectionByKey(entry.libraryID, entry.collectionKey);
		if (!collection) {
			let attempts = this._incrementJobRecoveryAttempt(jobID);
			if (attempts <= JOB_RECOVERY_RETRY_LIMIT) {
				this._setJobWaitReason(entry.projectID, jobID, "Waiting for the Zotero project collection to become available.");
				this._pushPendingJobReference(Object.assign({}, entry, {
					readyAt: Date.now() + (JOB_RECOVERY_RETRY_DELAY_MS * attempts),
					retryCount: attempts,
				}));
				await this._refreshAllControllers().catch(() => {});
				return;
			}
			await this._markRecoveredJobFailed(entry, "Queued workflow job could not reopen its Zotero project collection after restart.");
			return;
		}
		let context = this._collectionProjectContext(collection);
		let projectType = await this._projectTypeForContext(context, "systematic_review").catch(() => "systematic_review");
		let projectItem = await this._resolveProjectItem(collection, "", false);
		if (!projectItem) {
			projectItem = await this._resolveProjectItem(collection, "", true, projectType).catch(() => null);
		}
		if (!projectItem) {
			let attempts = this._incrementJobRecoveryAttempt(jobID);
			if (attempts <= JOB_RECOVERY_RETRY_LIMIT) {
				this._setJobWaitReason(entry.projectID, jobID, "Waiting for the project shell item to become available.");
				this._pushPendingJobReference(Object.assign({}, entry, {
					databasePath: entry.databasePath || context.databasePath,
					readyAt: Date.now() + (JOB_RECOVERY_RETRY_DELAY_MS * attempts),
					retryCount: attempts,
				}));
				await this._refreshAllControllers().catch(() => {});
				return;
			}
			await this._markRecoveredJobFailed(
				Object.assign({}, entry, { databasePath: entry.databasePath || context.databasePath }),
				"Queued workflow job could not restore its project shell item after restart."
			);
			return;
		}
		this._clearJobRecoveryAttempt(jobID);
		this._clearJobWaitReason(context.projectID, jobID);
		let current = { context, collection, projectItem, projectType };
		let db = await this._projectDB(context);
		let rows = await db.queryAsync(
			`SELECT *
			 FROM jobs
			 WHERE job_id=?`,
			[entry.jobID]
		);
		if (!rows.length) {
			return;
		}
		let job = rows[0];
		if (job.status != "queued" && job.status != "running") {
			return;
		}
		if (Number(job.cancel_requested || 0) === 1) {
			await SystematicReviewerWorkflowJobs.cancel(this, current, jobID, {
				message: "Workflow job canceled before it started.",
			});
			return;
		}
		let kind = String(job.kind || "").trim();
		let metadata = this._parseJobMetadata(job);
		let runtimeLease = await this._runtimeLeaseForJob(current, job, metadata);
		let runJob = async () => {
			await this._throwIfJobCanceled(current, jobID);

			let now = new Date().toISOString();
			await this._withProjectDBWriteLease(context, async () => {
				await db.queryAsync(
					`UPDATE jobs
					 SET status='running', started_at=COALESCE(started_at, ?), updated_at=?, error_message=NULL
					 WHERE job_id=?`,
					[now, now, entry.jobID]
				);
			}, {
				jobID,
				ownerKey: `queued-job-start:${context.projectID}:${jobID}`,
			});
			await this._appendJobLog(context, entry.jobID, "info", `Started ${job.title}`);
			if (!["manual_harvest", "manual_harvest_estimate", "manual_harvest_merge", "manual_embeddings"].includes(kind)) {
				await this._refreshAllControllers();
			}

			try {
				if (kind == "convert_attachment_markdown") {
					return await this._runQueuedConversionJob(current, job);
				}
				else if (kind == "manual_harvest_merge") {
					return await SystematicReviewerWorkflowHarvest.mergeSourceIntoPending({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_harvest" || kind == "manual_harvest_estimate") {
					return await SystematicReviewerWorkflowHarvest.runQueuedHarvestJob({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_embeddings") {
					return await SystematicReviewerWorkflowEmbeddings.runEmbeddings({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_project_reconcile") {
					return await this._runQueuedProjectReconcileJob(current, job);
				}
				else if (kind == "manual_semantic_search") {
					return await SystematicReviewerWorkflowSemanticSearch.search({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_extraction" || kind == "manual_extraction_single") {
					return await SystematicReviewerWorkflowExtraction.runExtraction({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
						single: kind == "manual_extraction_single" || metadata?.single === true,
					});
				}
				else if (kind == "manual_screening_save") {
					return await SystematicReviewerWorkflowScreening.saveEdits({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_screening_rules") {
					return await SystematicReviewerWorkflowScreening.recomputeRules({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_screening_filter" || kind == "manual_screening_bulk") {
					return await SystematicReviewerWorkflowScreening.bulkRun({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_screening_export_csv") {
					return await SystematicReviewerWorkflowScreening.exportCSV({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
						options: {
							outputPath: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
						},
					});
				}
				else if (kind == "manual_automation_export_pdf") {
					return await SystematicReviewerWorkflowCommands.call("automation.document.exportPdf", Object.assign({}, metadata?.payload || {}, {
						project_id: context.projectID,
						existing_job_id: jobID,
						output_path: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
					}));
				}
				else if (kind == "manual_automation_export_docx") {
					return await SystematicReviewerWorkflowCommands.call("automation.document.exportDocx", Object.assign({}, metadata?.payload || {}, {
						project_id: context.projectID,
						existing_job_id: jobID,
						output_path: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
					}));
				}
				else if (kind == "manual_automation_export_markdown") {
					return await SystematicReviewerWorkflowCommands.call("automation.document.exportPlainMarkdown", Object.assign({}, metadata?.payload || {}, {
						project_id: context.projectID,
						existing_job_id: jobID,
						output_path: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
					}));
				}
				else if (kind == "manual_explore_query") {
					return await SystematicReviewerWorkflowExplore.query({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_explore_export_csv") {
					return await SystematicReviewerWorkflowExplore.exportCSV({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "manual_explore_chat") {
					return await SystematicReviewerWorkflowExplore.runChat({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else if (kind == "full_text_retrieval_watch") {
					return await SystematicReviewerWorkflowFullText.startRetrieval({
						reviewer: this,
						current,
						payload: Object.assign({}, metadata?.payload || {}, {
							existing_job_id: jobID,
						}),
					});
				}
				else {
					throw new Error(`Unsupported queued job kind: ${kind || "unknown"}`);
				}
			}
			catch (error) {
				let status = String((await this._dbValue(
					db,
					"SELECT status AS value FROM jobs WHERE job_id=? LIMIT 1",
					[jobID]
				)) || "").trim();
				let canceled = status == "canceled"
					|| error?.isCanceled === true
					|| error?.canceled === true
					|| String(error?.code || "").trim() == "SR_JOB_CANCELED";
				if (canceled && (status == "queued" || status == "running")) {
					await SystematicReviewerWorkflowJobs.cancel(this, current, jobID, {
						message: error?.message || "Workflow job canceled.",
					});
				}
				else if (status == "queued" || status == "running") {
					let message = error instanceof Error ? error.message : String(error);
					let finishedAt = new Date().toISOString();
					await this._withProjectDBWriteLease(context, async () => {
						await db.queryAsync(
							`UPDATE jobs
							 SET status='failed', error_message=?, finished_at=?, updated_at=?
							 WHERE job_id=?`,
							[message, finishedAt, finishedAt, jobID]
						);
					}, {
						jobID,
						ownerKey: `queued-job-fail:${context.projectID}:${jobID}`,
					});
					await this._appendJobLog(context, jobID, "error", message);
				}
				throw error;
			}
			finally {
				this._jobProgressRefreshState?.delete?.(jobID);
				this._clearJobWaitReason(context.projectID, jobID);
				await this._refreshCurrentProjectFromCollections({ autoQueueConversions: false }).catch(() => {});
				await this._refreshAllControllers();
			}
		};
		if (runtimeLease?.key) {
			return await this._withLease(runtimeLease.key, {
				ownerKey: `job:${context.projectID}:${jobID}`,
				capacity: runtimeLease.capacity,
				projectID: context.projectID,
				jobID,
				waitReason: runtimeLease.waitReason,
			}, runJob);
		}
		return await runJob();
	},

	async _appendJobLog(context, jobID, level, message) {
		let db = await this._projectDB(context);
		let runner = async () => {
			let attempts = 0;
			while (attempts < 5) {
				attempts += 1;
				let seq = (await this._dbValue(
					db,
					"SELECT COALESCE(MAX(sequence_no), 0) + 1 AS value FROM job_logs WHERE job_id=?",
					[jobID]
				)) || 1;
				try {
					await db.queryAsync(
						`INSERT INTO job_logs (job_id, sequence_no, level, message, created_at)
						 VALUES (?, ?, ?, ?, ?)`,
						[jobID, seq, level, message, new Date().toISOString()]
					);
					return;
				}
				catch (error) {
					let messageText = String(error?.message || error || "");
					let duplicateSequence = messageText.includes("UNIQUE constraint failed: job_logs.job_id, job_logs.sequence_no");
					if (!duplicateSequence || attempts >= 5) {
						throw error;
					}
					await Zotero.Promise.delay(5);
				}
			}
		};
		await this._withProjectDBWriteLease(context, runner, {
			jobID,
			ownerKey: `job-log:${context?.projectID || "project"}:${jobID}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
			sharedKey: "",
		});
	},

	async _updateJobProgress(context, jobID, current, total, message = "", options = {}) {
		let activeJob = await this._readActiveJobForMutation(context, jobID);
		if (!activeJob) {
			return false;
		}
		let db = await this._projectDB(context);
		let now = new Date().toISOString();
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET progress_current=?, progress_total=?, updated_at=?
				 WHERE job_id=?
				   AND status IN ('queued', 'running')`,
				[current || 0, total || 0, now, jobID]
			);
		}, {
			jobID,
			ownerKey: `job-progress:${context?.projectID || "project"}:${jobID}`,
		});
		if (message) {
			await this._appendJobLog(context, jobID, "info", message);
		}
		let shouldRefresh = options.refresh !== false;
		if (shouldRefresh) {
			let forceRefresh = options.force_refresh === true || options.forceRefresh === true;
			if (!forceRefresh) {
				if (!this._jobProgressRefreshState) {
					this._jobProgressRefreshState = new Map();
				}
				let nowMS = Date.now();
				let lastRefreshMS = Number(this._jobProgressRefreshState.get(jobID) || 0) || 0;
				let completed = Number(total || 0) > 0 && Number(current || 0) >= Number(total || 0);
				if (!completed && nowMS - lastRefreshMS < JOB_PROGRESS_REFRESH_THROTTLE_MS) {
					shouldRefresh = false;
				}
				else {
					this._jobProgressRefreshState.set(jobID, nowMS);
				}
			}
			else {
				if (!this._jobProgressRefreshState) {
					this._jobProgressRefreshState = new Map();
				}
				this._jobProgressRefreshState.set(jobID, Date.now());
			}
		}
		if (shouldRefresh) {
			await this._refreshAllControllers();
		}
		return true;
	},

	async _markCompletedJobStatus(current, jobID, status, options = {}) {
		if (!current?.context || !jobID) {
			return;
		}
		let context = current.context;
		let activeJob = await this._readActiveJobForMutation(context, jobID);
		if (!activeJob) {
			return false;
		}
		let db = await this._projectDB(context);
		let finishedAt = new Date().toISOString();
		let existing = activeJob;
		let mergedMetadata = Object.assign({}, this._parseJobMetadata(existing || {}), options.metadata || {});
		let metadataJSON = this._safeJobMetadataJSON(mergedMetadata);
		let cleanStatus = this._jobOptionalString(status).toLowerCase() == "partial" ? "partial" : "succeeded";
		let progressTotal = Number(options.progress_total || options.progressTotal || 0) || 0;
		let progressCurrent = Number(options.progress_current || options.progressCurrent || progressTotal || 0) || 0;
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET status=?,
				     used_mode=?,
				     output_path=?,
				     output_attachment_key=?,
				     fallback_used=?,
				     progress_current=?,
				     progress_total=?,
				     cancel_requested=0,
				     metadata_json=?,
				     finished_at=?,
				     updated_at=?,
				     error_message=NULL
				 WHERE job_id=?
				   AND status IN ('queued', 'running')`,
				[
					cleanStatus,
					this._jobOptionalString(options.used_mode || options.usedMode || "manual") || "manual",
					this._jobOptionalString(options.output_path || options.outputPath),
					this._jobOptionalString(options.output_attachment_key || options.outputAttachmentKey),
					options.fallback_used === true || options.fallbackUsed === true ? 1 : 0,
					progressCurrent,
					progressTotal,
					metadataJSON,
					finishedAt,
					finishedAt,
					jobID,
				]
			);
		}, {
			jobID,
			ownerKey: `job-${cleanStatus}:${context.projectID}:${jobID}`,
		});
		if (options.message) {
			await this._appendJobLog(context, jobID, "info", String(options.message));
		}
		await this._refreshAllControllers();
		return true;
	},

	async _markJobSucceeded(current, jobID, options = {}) {
		return await this._markCompletedJobStatus(current, jobID, "succeeded", options || {});
	},

	async _markJobPartial(current, jobID, options = {}) {
		return await this._markCompletedJobStatus(current, jobID, "partial", options || {});
	},

	async _markJobFailed(current, jobID, error, options = {}) {
		if (!current?.context || !jobID) {
			return;
		}
		let context = current.context;
		let activeJob = await this._readActiveJobForMutation(context, jobID);
		if (!activeJob) {
			return false;
		}
		let db = await this._projectDB(context);
		let finishedAt = new Date().toISOString();
		let message = error instanceof Error ? error.message : String(error || "Workflow job failed.");
		let existing = activeJob;
		let mergedMetadata = Object.assign({}, this._parseJobMetadata(existing || {}), options.metadata || {});
		let metadataJSON = this._safeJobMetadataJSON(mergedMetadata);
		let progressTotal = Number(options.progress_total || options.progressTotal || activeJob?.progress_total || 0) || 0;
		let progressCurrent = Number(options.progress_current || options.progressCurrent || activeJob?.progress_current || progressTotal || 0) || 0;
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET status='failed',
				     progress_current=?,
				     progress_total=?,
				     cancel_requested=0,
				     error_message=?,
				     metadata_json=?,
				     finished_at=?,
				     updated_at=?
				 WHERE job_id=?
				   AND status IN ('queued', 'running')`,
				[progressCurrent, progressTotal, message, metadataJSON, finishedAt, finishedAt, jobID]
			);
		}, {
			jobID,
			ownerKey: `job-fail:${context.projectID}:${jobID}`,
		});
		await this._appendJobLog(context, jobID, "error", message);
		if (options.append_message) {
			await this._appendJobLog(context, jobID, "info", String(options.append_message));
		}
		await this._refreshAllControllers();
		return true;
	},

	async _markJobCanceled(current, jobID, options = {}) {
		if (!current?.context || !jobID) {
			return;
		}
		let context = current.context;
		let activeJob = await this._readActiveJobForMutation(context, jobID);
		if (!activeJob) {
			return false;
		}
		let db = await this._projectDB(context);
		let finishedAt = new Date().toISOString();
		let message = this._jobOptionalString(options.message || "Workflow job canceled.") || "Workflow job canceled.";
		let mergedMetadata = Object.assign({}, this._parseJobMetadata(activeJob || {}), options.metadata || {});
		let metadataJSON = this._safeJobMetadataJSON(mergedMetadata);
		await this._withProjectDBWriteLease(context, async () => {
			await db.queryAsync(
				`UPDATE jobs
				 SET status='canceled',
				     cancel_requested=0,
				     error_message=?,
				     metadata_json=CASE
				     	WHEN ? != '{}' THEN ?
				     	ELSE COALESCE(metadata_json, '{}')
				     END,
				     finished_at=?,
				     updated_at=?
				 WHERE job_id=?
				   AND status IN ('queued', 'running')`,
				[message, metadataJSON, metadataJSON, finishedAt, finishedAt, jobID]
			);
		}, {
			jobID,
			ownerKey: `job-cancel:${context.projectID}:${jobID}`,
		});
		await this._appendJobLog(context, jobID, "info", message);
		await this._refreshAllControllers();
		return true;
	},

	async _listGlobalJobs(options = {}) {
		let storedProjects = await this._listStoredProjects();
		let perProjectLimit = this._normalizeJobListLimit(options.per_project_limit || options.perProjectLimit || 50, 50, 500);
		let overallLimit = this._normalizeJobListLimit(options.limit, 200, 1000);
		let jobs = [];
		for (let stored of storedProjects) {
			let context = this._contextFromStoredProject(stored);
			if (!context.projectID || !context.databasePath) {
				continue;
			}
			let rows = await this._listJobs(context, perProjectLimit).catch(() => []);
			for (let row of rows) {
				jobs.push(this._decorateJobRecord(row, stored));
			}
		}
		jobs.sort((left, right) =>
			String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
			|| String(right.created_at || "").localeCompare(String(left.created_at || ""))
			|| String(left.title || "").localeCompare(String(right.title || ""))
		);
		let counts = {
			queued: 0,
			running: 0,
			succeeded: 0,
			partial: 0,
			failed: 0,
			canceled: 0,
		};
		for (let job of jobs) {
			let status = this._jobOptionalString(job.status);
			if (Object.prototype.hasOwnProperty.call(counts, status)) {
				counts[status] += 1;
			}
		}
		return {
			ok: true,
			counts,
			jobs: jobs.slice(0, overallLimit),
			projects: storedProjects.map((entry) => ({
				project_id: entry.project_id,
				project_name: entry.collection_name,
				project_type: entry.project_type,
			})),
		};
	},

	async _loadGlobalJob(options = {}) {
		let projectID = this._jobOptionalString(options.project_id || options.projectID);
		let jobID = this._jobOptionalString(options.job_id || options.jobID);
		if (!projectID) {
			throw new Error("project_id is required.");
		}
		if (!jobID) {
			throw new Error("job_id is required.");
		}
		let resolved = await this._resolveStoredProjectForJobs(projectID);
		let job = await this._readJobRecord(resolved.context, jobID);
		if (!job) {
			throw new Error(`Job not found: ${jobID}`);
		}
		let logs = await this._jobLogs(
			resolved.context,
			jobID,
			this._normalizeJobListLimit(options.log_limit || options.logLimit, 200, 1000)
		);
		let logCount = await this._jobLogCount(resolved.context, jobID);
		let metadata = this._parseJobMetadata(job);
		return {
			ok: true,
			selected_job_id: jobID,
			job: Object.assign({}, this._decorateJobRecord(job, resolved.stored, metadata), {
				log_count: logCount,
				logs,
			}),
		};
	},

	async _requeueConversionJob(current, job = {}) {
		let attachmentKey = this._jobOptionalString(job.source_attachment_key);
		if (!attachmentKey) {
			throw new Error("Source attachment key is missing.");
		}
		let attachment = Zotero.Items.getByLibraryAndKey(current.context.libraryID, attachmentKey);
		if (!attachment || attachment.deleted) {
			throw new Error("Source attachment is no longer available in Zotero.");
		}
		let parentItem = attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : null;
		let source = {
			attachment,
			parentItem,
			kind: String(attachment.attachmentContentType || "").toLowerCase().includes("pdf") ? "pdf" : "attachment",
			path: this._jobOptionalString(job.source_path) || this._jobOptionalString(attachment.getFilePath?.()),
		};
		let requestedMode = this._jobOptionalString(job.requested_mode) || "fast";
		let result = await this._enqueueConversionSources(current, [source], requestedMode, {
			openJobsTab: false,
			refreshControllers: true,
		});
		return {
			ok: true,
			queued: true,
			job_id: result?.jobs?.[0]?.job_id || "",
			job_kind: "convert_attachment_markdown",
			project_id: current?.context?.projectID || "",
		};
	},

	async _controlGlobalJob(options = {}) {
		let action = this._jobOptionalString(options.action).toLowerCase();
		let projectID = this._jobOptionalString(options.project_id || options.projectID);
		let jobID = this._jobOptionalString(options.job_id || options.jobID);
		if (!action) {
			throw new Error("action is required.");
		}
		let resolved = await this._resolveStoredProjectForJobs(projectID);
		let context = resolved.context;
		let current = resolved.current;
		let job = await this._readJobRecord(context, jobID);
		if (!job) {
			throw new Error(`Job not found: ${jobID}`);
		}
		let metadata = this._parseJobMetadata(job);
		if (action == "stop") {
			if (this._jobOptionalString(job.kind) == "manual_harvest") {
				return Object.assign({
					project_id: context.projectID,
				}, await SystematicReviewerWorkflowHarvest.stopHarvestRun({
					reviewer: this,
					current: current || { context },
					payload: {
						run_id: this._jobOptionalString(metadata.run_id),
						job_id: job.job_id,
						cancel_message: this._jobOptionalString(options.cancel_message || options.cancelMessage || options.message),
					},
				}));
			}
			if (this._jobOptionalString(job.status) == "queued") {
				this._removePendingJobReference?.(job.job_id);
				await this._markJobCanceled({ context }, job.job_id, {
					message: "Workflow job canceled before it started.",
				});
				let error = new Error("Workflow job canceled before it started.");
				error.isCanceled = true;
				error.canceled = true;
				error.code = "SR_JOB_CANCELED";
				this._settleJobCompletion(context.projectID, job.job_id, { error });
				return {
					ok: true,
					canceled: true,
					job_id: job.job_id,
					project_id: context.projectID,
				};
			}
			if (this._jobOptionalString(job.status) != "running") {
				return {
					ok: true,
					job_id: job.job_id,
					project_id: context.projectID,
					message: "Job is not currently running.",
				};
			}
			await this._setJobCancelRequested(context, job.job_id, true);
			await this._appendJobLog(context, job.job_id, "info", "Stop requested. The job will stop at the next safe checkpoint.");
			await this._refreshAllControllers();
			return {
				ok: true,
				stopping: true,
				job_id: job.job_id,
				project_id: context.projectID,
			};
		}
		if (!current) {
			throw new Error("Open the project in Zotero to continue or restart this job.");
		}
		if (action == "continue") {
			if (!this._jobSupportsContinue(job)) {
				throw new Error("Continue is not available for this job.");
			}
			if (this._jobOptionalString(job.kind) == "manual_harvest") {
				return Object.assign({
					project_id: context.projectID,
				}, await SystematicReviewerWorkflowHarvest.continueHarvestRun({
					reviewer: this,
					current,
					payload: { run_id: this._jobOptionalString(metadata.run_id), job_id: job.job_id },
				}));
			}
			if (this._jobOptionalString(job.kind) == "manual_embeddings") {
				return Object.assign({
					project_id: context.projectID,
				}, await SystematicReviewerWorkflowEmbeddings.queueEmbeddings({
					reviewer: this,
					current,
					payload: Object.assign({}, metadata.payload || {}, { resume: true }),
					options: {
						queue_origin: "jobs.global.control.continue",
					},
				}));
			}
			if (["manual_extraction", "manual_extraction_single"].includes(this._jobOptionalString(job.kind))) {
				let payload = Object.assign({}, metadata.payload || {}, {
					row_scope: this._jobOptionalString(job.kind) == "manual_extraction_single" ? "single_item" : "missing_fields",
				});
				return Object.assign({
					project_id: context.projectID,
				}, await SystematicReviewerWorkflowExtraction.queueExtraction({
					reviewer: this,
					current,
					payload,
					single: this._jobOptionalString(job.kind) == "manual_extraction_single",
					options: {
						queue_origin: "jobs.global.control.continue",
					},
				}));
			}
			if (this._jobOptionalString(job.kind) == "convert_attachment_markdown") {
				return await this._requeueConversionJob(current, job);
			}
		}
		if (action != "restart") {
			throw new Error(`Unsupported jobs.global.control action: ${action}`);
		}
		if (!this._jobSupportsRestart(job)) {
			throw new Error("Restart is not available for this job.");
		}
		if (this._jobOptionalString(job.status) == "queued") {
			if (this._jobOptionalString(job.kind) == "manual_harvest") {
				await SystematicReviewerWorkflowHarvest.stopHarvestRun({
					reviewer: this,
					current: current || { context },
					payload: {
						run_id: this._jobOptionalString(metadata.run_id),
						job_id: job.job_id,
					},
				});
			}
			else {
				this._removePendingJobReference?.(job.job_id);
				await this._markJobCanceled({ context }, job.job_id, {
					message: "Queued workflow job was restarted before it started.",
				});
			}
		}
		if (this._jobOptionalString(job.kind) == "manual_harvest") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowHarvest.restartHarvestRun({
				reviewer: this,
				current,
				payload: { run_id: this._jobOptionalString(metadata.run_id), job_id: job.job_id },
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_embeddings") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowEmbeddings.queueEmbeddings({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, { resume: false }),
				options: {
					queue_origin: "jobs.global.control.restart",
				},
			}));
		}
		if (["manual_extraction", "manual_extraction_single"].includes(this._jobOptionalString(job.kind))) {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowExtraction.queueExtraction({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}),
				single: this._jobOptionalString(job.kind) == "manual_extraction_single",
				options: {
					queue_origin: "jobs.global.control.restart",
				},
			}));
		}
		if (this._jobOptionalString(job.kind) == "convert_attachment_markdown") {
			return await this._requeueConversionJob(current, job);
		}
		if (this._jobOptionalString(job.kind) == "full_text_retrieval_watch") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowFullText.startRetrieval({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_semantic_search") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowSemanticSearch.queueSearch({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}),
				options: {
					queue_origin: "jobs.global.control.restart",
				},
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_harvest_merge") {
			let mergePayload = Object.assign({}, metadata.payload || {});
			let sourceKeys = Array.isArray(mergePayload.source_collection_keys) ? mergePayload.source_collection_keys.filter(Boolean) : [];
			let response = this._jobOptionalString(mergePayload.merge_scope) == "all" || sourceKeys.length > 1
				? await SystematicReviewerWorkflowHarvest.queueMergeAllSourcesIntoPending({
					reviewer: this,
					current,
					payload: mergePayload,
					options: {
						queue_origin: "jobs.global.control.restart",
						showMergeNotice: true,
					},
				})
				: await SystematicReviewerWorkflowHarvest.queueMergeSourceIntoPending({
					reviewer: this,
					current,
					payload: mergePayload,
					options: {
						queue_origin: "jobs.global.control.restart",
						showMergeNotice: true,
					},
				});
			return Object.assign({
				project_id: context.projectID,
			}, response);
		}
		if (this._jobOptionalString(job.kind) == "manual_screening_save") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowScreening.saveEdits({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_screening_rules") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowScreening.recomputeRules({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		if (["manual_screening_filter", "manual_screening_bulk"].includes(this._jobOptionalString(job.kind))) {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowScreening.bulkRun({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_screening_export_csv") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowScreening.exportCSV({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
				options: {
					outputPath: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
				},
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_automation_export_pdf") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowCommands.call("automation.document.exportPdf.saveAs", Object.assign({}, metadata.payload || {}, {
				project_id: context.projectID,
				detach: true,
				output_path: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
			})));
		}
		if (this._jobOptionalString(job.kind) == "manual_automation_export_docx") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowCommands.call("automation.document.exportDocx.saveAs", Object.assign({}, metadata.payload || {}, {
				project_id: context.projectID,
				detach: true,
				output_path: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
			})));
		}
		if (this._jobOptionalString(job.kind) == "manual_automation_export_markdown") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowCommands.call("automation.document.exportPlainMarkdown.saveAs", Object.assign({}, metadata.payload || {}, {
				project_id: context.projectID,
				detach: true,
				output_path: this._jobOptionalString(job.output_path || metadata?.output_path || metadata?.payload?.__resolved_output_path || ""),
			})));
		}
		if (this._jobOptionalString(job.kind) == "manual_explore_query") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowExplore.query({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_explore_export_csv") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowExplore.exportCSV({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		if (this._jobOptionalString(job.kind) == "manual_explore_chat") {
			return Object.assign({
				project_id: context.projectID,
			}, await SystematicReviewerWorkflowExplore.runChat({
				reviewer: this,
				current,
				payload: Object.assign({}, metadata.payload || {}, {
					detach: true,
				}),
			}));
		}
		throw new Error("Restart is not yet implemented for this job kind.");
	},

	async _upsertConvertedMarkdownAttachment(sourceAttachment, parentItem, collection, outputPath, title) {
		let existing = [];
		if (parentItem?.getAttachments) {
			for (let attachmentID of parentItem.getAttachments()) {
				let attachment = Zotero.Items.get(attachmentID);
				if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
					continue;
				}
				if (this._itemField(attachment, "title") == title) {
					existing.push(attachment);
				}
			}
		}
		else {
			let selectedKey = sourceAttachment.key;
			let libraryItems = collection.getChildItems ? collection.getChildItems(false, false) : [];
			for (let item of libraryItems) {
				if (!item || item.deleted || !item.isAttachment?.()) {
					continue;
				}
				if (
					item.key != selectedKey &&
					this._itemField(item, "title") == title &&
					/^text\//i.test(String(item.attachmentContentType || ""))
				) {
					existing.push(item);
				}
			}
		}

		return await this._withZoteroWriteLease(
			collection ? this._collectionProjectContext(collection) : null,
			async () => {
				for (let attachment of existing) {
					try {
						await attachment.eraseTx();
					}
					catch (error) {
						this.log?.(`conversion attachment replacement skipped stale ${attachment?.key || "attachment"}: ${error}`);
					}
				}

				let options = {
					file: outputPath,
					title,
					contentType: this._conversionTextContentTypeForPath(outputPath),
				};
				if (parentItem?.id) {
					options.parentItemID = parentItem.id;
					options.libraryID = parentItem.libraryID || sourceAttachment?.libraryID || collection?.libraryID || Zotero.Libraries.userLibraryID;
				}
				else {
					options.collections = [collection.id];
					options.libraryID = collection?.libraryID || sourceAttachment?.libraryID || Zotero.Libraries.userLibraryID;
				}
				let imported = await Zotero.Attachments.importFromFile(options);
				await this._removeIfExists(outputPath).catch(() => null);
				return imported;
			},
			{
				ownerKey: `conversion-output:${collection?.libraryID || 0}:${sourceAttachment?.key || "attachment"}`,
			}
		);
	},
};
