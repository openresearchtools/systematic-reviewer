var SystematicReviewerWorkflowFullText = (() => {
	const RETRIEVAL_STATE_FILE = "full-text-retrieval-state.json";
	const RETRIEVAL_QUIET_WINDOW_MS = 60 * 1000;
	const NOT_RETRIEVED_REASON = "full_text_not_retrieved";

	function optionalString(value) {
		return String(value || "").trim();
	}

	function existingJobID(payload = {}) {
		return optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
	}

	function waitForJobCompletion(payload = {}, defaultWait = true) {
		if (payload?.wait_for_completion === true || payload?.waitForCompletion === true || payload?.await_completion === true) {
			return true;
		}
		if (payload?.wait_for_completion === false || payload?.waitForCompletion === false || payload?.await_completion === false) {
			return false;
		}
		if (payload?.detach === true || payload?.background === true || payload?.queue_only === true || payload?.queueOnly === true) {
			return false;
		}
		return defaultWait;
	}

	function nowISO() {
		return new Date().toISOString();
	}

	function retrievalStatePath(reviewer, context) {
		return reviewer._joinPath(context.outputsDir, "workflow", RETRIEVAL_STATE_FILE);
	}

	async function ensureWorkflowDir(reviewer, context) {
		let dir = reviewer._joinPath(context.outputsDir, "workflow");
		await reviewer._ensureDirectory(context.outputsDir);
		await reviewer._ensureDirectory(dir);
		return dir;
	}

	function scopePayload(payload = {}) {
		return {
			scope: payload.scope,
			collection_key: payload.collection_key || payload.collectionKey,
			collection_name: payload.collection_name || payload.collectionName,
		};
	}

	function hasScopeSelection(payload = {}) {
		return !!(
			optionalString(payload?.scope)
			|| optionalString(payload?.collection_key || payload?.collectionKey)
			|| optionalString(payload?.collection_name || payload?.collectionName)
		);
	}

	function effectiveScopePayload(payload = {}, fallback = {}) {
		return hasScopeSelection(payload || {}) ? (payload || {}) : (fallback || {});
	}

	function resolvedScopeSpec(reviewer, current, payload = {}) {
		let explicit = SystematicReviewerWorkflowEmbeddings?.scopeSpecFromPayload
			? SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload(payload || {})
			: null;
		if (explicit) {
			return explicit;
		}
		let fallback = SystematicReviewerWorkflowEmbeddings?.defaultScopeEntry
			? SystematicReviewerWorkflowEmbeddings.defaultScopeEntry(reviewer, current)
			: null;
		if (!fallback?.collection_key) {
			return null;
		}
		return {
			scope: String(fallback.scope_kind || ""),
			collection_key: String(fallback.collection_key || ""),
			collection_name: String(fallback.collection_name || ""),
		};
	}

	function projectItemsByKey(reviewer, current, itemKeys = []) {
		let root = current?.collection || null;
		let out = new Map();
		if (!root) {
			return out;
		}
		let wanted = new Set((itemKeys || []).map((itemKey) => optionalString(itemKey)).filter(Boolean));
		for (let node of reviewer?._projectCollectionNodes?.(root) || []) {
			let items = node?.collection?.getChildItems ? node.collection.getChildItems(false, false) : [];
			for (let item of items || []) {
				let key = optionalString(item?.key);
				if (!key || (wanted.size && !wanted.has(key))) {
					continue;
				}
				out.set(key, item);
			}
		}
		return out;
	}

	function itemHasPdf(item = null) {
		if (!item?.getAttachments) {
			return false;
		}
		for (let attachmentID of item.getAttachments() || []) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
				continue;
			}
			let contentType = optionalString(attachment.attachmentContentType).toLowerCase();
			let filePath = optionalString(attachment.getFilePath ? attachment.getFilePath() : "").toLowerCase();
			if (contentType == "application/pdf" || filePath.endsWith(".pdf")) {
				return true;
			}
		}
		return false;
	}

	function itemPdfSources(item = null) {
		let sources = [];
		if (!item?.getAttachments) {
			return sources;
		}
		for (let attachmentID of item.getAttachments() || []) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
				continue;
			}
			let contentType = optionalString(attachment.attachmentContentType).toLowerCase();
			let filePath = optionalString(attachment.getFilePath ? attachment.getFilePath() : "");
			if (contentType != "application/pdf" && !String(filePath).toLowerCase().endsWith(".pdf")) {
				continue;
			}
			if (!filePath) {
				continue;
			}
			sources.push({
				attachment,
				parentItem: item,
				kind: "pdf",
				path: filePath,
			});
		}
		return sources;
	}

	async function fetchAvailableFiles(items = []) {
		let itemList = (items || []).filter(Boolean);
		if (!itemList.length || !Zotero.Attachments?.addAvailableFiles) {
			return {
				ok: true,
				mode: "skipped",
				attempted: 0,
				succeeded: 0,
				failed: [],
			};
		}
		let runBatchFetch = async () => {
			await Zotero.Attachments.addAvailableFiles(itemList);
		};
		try {
			if (Zotero.SystematicReviewer?._withZoteroWriteLease) {
				await Zotero.SystematicReviewer._withZoteroWriteLease(null, runBatchFetch, {
					ownerKey: `full-text-fetch:${Math.random().toString(36).slice(2, 8)}`,
				});
			}
			else {
				await runBatchFetch();
			}
			return {
				ok: true,
				mode: "batch",
				attempted: itemList.length,
				succeeded: itemList.length,
				failed: [],
			};
		}
		catch (batchError) {
			let succeeded = 0;
			let failed = [];
			for (let item of itemList) {
				try {
					let runSingleFetch = async () => {
						await Zotero.Attachments.addAvailableFiles([item]);
					};
					if (Zotero.SystematicReviewer?._withZoteroWriteLease) {
						await Zotero.SystematicReviewer._withZoteroWriteLease(null, runSingleFetch, {
							ownerKey: `full-text-fetch:${optionalString(item?.key) || Math.random().toString(36).slice(2, 8)}`,
						});
					}
					else {
						await runSingleFetch();
					}
					succeeded += 1;
				}
				catch (error) {
					failed.push({
						item_key: optionalString(item?.key),
						message: error?.message || String(error),
					});
				}
			}
			if (failed.length == itemList.length) {
				Zotero.logError(batchError);
			}
			return {
				ok: failed.length < itemList.length,
				mode: "batch_fallback_single",
				attempted: itemList.length,
				succeeded,
				failed,
			};
		}
	}

	async function loadRetrievalState(reviewer, context) {
		let state = (await reviewer._readJSONFile(retrievalStatePath(reviewer, context))) || {};
		return state && typeof state == "object" ? state : {};
	}

	async function saveRetrievalState(reviewer, context, state = {}) {
		await ensureWorkflowDir(reviewer, context);
		await reviewer._writeJSONFile(retrievalStatePath(reviewer, context), state || {});
		return state;
	}

	function retrievalStateIsActive(state = {}) {
		return !!(state && typeof state == "object" && optionalString(state.started_at) && state.active !== false);
	}

	function markdownHeadingBlock(title = "", lines = []) {
		return [
			`#### ${String(title || "Entry").trim()}`,
			"",
			...(Array.isArray(lines) ? lines : []).map((line) => String(line || "")),
		].join("\n").trim();
	}

	async function syncFullTextArtifacts(reviewer, context) {
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, context, {
			category: "full-text",
			headingPath: ["Methods", "Full-Text Retrieval"],
			marker: "full-text-retrieval",
			emptyLabel: "No full-text retrieval activity has been logged yet.",
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, context, {
			category: "full-text",
			headingPath: ["Results", "Full-Text Results"],
			marker: "full-text-results",
			emptyLabel: "No full-text review notes have been logged yet.",
		});
	}

	async function writeFullTextArtifact(reviewer, context, kind = "", title = "", lines = []) {
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, context, {
			category: "full-text",
			kind: optionalString(kind) || "full-text",
			extension: "md",
			content: `${markdownHeadingBlock(title, lines)}\n`,
		});
		await syncFullTextArtifacts(reviewer, context);
		return artifact;
	}

	async function finishWatchJob({ reviewer, current, jobID = "", message = "", metadata = {}, progressCurrent = 0, progressTotal = 0 }) {
		let cleanJobID = optionalString(jobID);
		if (!cleanJobID) {
			return;
		}
		await SystematicReviewerWorkflowJobs.succeed(reviewer, current, cleanJobID, {
			used_mode: "full_text_retrieval_watch",
			progress_current: progressCurrent,
			progress_total: progressTotal,
			message: optionalString(message),
			metadata: metadata || {},
		});
	}

	async function collectionTargets(reviewer, current) {
		return await SystematicReviewerWorkflowScreening.reviewCollections(reviewer, current, {
			createMissing: false,
			includeMaybe: false,
		});
	}

	async function moveItemsWithDecision({ reviewer, current, itemKeys = [], targetCollection, decision = "", reason = "", notes = "", sourceType = "automated", sourceDetail = "" }) {
		let cleanKeys = Array.from(new Set((itemKeys || []).map((itemKey) => optionalString(itemKey)).filter(Boolean)));
		if (!cleanKeys.length || !targetCollection?.key) {
			return {
				ok: true,
				moved_count: 0,
				item_keys: [],
			};
		}
		for (let itemKey of cleanKeys) {
			await SystematicReviewerWorkflowScreening.updateDecision({
				reviewer,
				current,
				payload: {
					item_key: itemKey,
					decision,
					reason,
					notes,
					target_collection_key: String(targetCollection.key || ""),
					target_collection_name: String(targetCollection.name || ""),
					source_type: sourceType,
					source_detail: sourceDetail,
				},
			});
		}
		return {
			ok: true,
			moved_count: cleanKeys.length,
			item_keys: cleanKeys,
			target_collection_key: String(targetCollection.key || ""),
			target_collection_name: String(targetCollection.name || ""),
		};
	}

	async function inspectScopedItems(reviewer, current, payload = {}) {
		let scopeSpec = resolvedScopeSpec(reviewer, current, payload || {});
		let items = reviewer?._projectCitableItems
			? reviewer._projectCitableItems(current?.collection, current?.projectItem, scopeSpec)
			: [];
		let itemKeys = (items || []).map((item) => optionalString(item?.key)).filter(Boolean);
		let identityMap = reviewer?._projectItemIdentityMap
			? await reviewer._projectItemIdentityMap(current?.context, itemKeys)
			: new Map();
		let itemMap = projectItemsByKey(reviewer, current, itemKeys);
		let records = [];
		let withPdf = [];
		let withoutPdf = [];
		let pdfSources = [];
		for (let itemKey of itemKeys) {
			let identity = identityMap.get(itemKey) || null;
			let record = {
				item_key: itemKey,
				title: optionalString(identity?.title || itemMap.get(itemKey)?.getField?.("title") || ""),
				citation_token: `@[${itemKey}]`,
			};
			records.push(record);
			if (!itemKey) {
				continue;
			}
			let item = itemMap.get(itemKey) || null;
			let entry = {
				item_key: itemKey,
				title: optionalString(record?.title),
				citation_token: optionalString(record?.citation_token || `@[${itemKey}]`),
			};
			if (itemHasPdf(item)) {
				withPdf.push(entry);
				pdfSources.push(...itemPdfSources(item));
			}
			else {
				withoutPdf.push(entry);
			}
		}
		return {
			records,
			withPdf,
			withoutPdf,
			pdfSources,
		};
	}

	function configuredPdfMode(config = null) {
		let mode = optionalString(config?.pdf_markdown?.mode || config?.pdfMarkdown?.mode || "");
		return mode || "fast";
	}

	async function queueConversionsForInspected({ reviewer, current, context, inspected }) {
		let config = await reviewer._conversionConfig();
		let requestedMode = configuredPdfMode(config);
		let existingKeys = await reviewer._existingConversionSourceKeys(context);
		let sources = [];
		for (let source of inspected?.pdfSources || []) {
			let key = optionalString(source?.attachment?.key);
			if (!key || existingKeys.has(key)) {
				continue;
			}
			if (reviewer?._conversionSourceHasUsableTextAttachment && await reviewer._conversionSourceHasUsableTextAttachment(source)) {
				continue;
			}
			sources.push(source);
		}
		if (!sources.length) {
			return {
				ok: true,
				requested_mode: requestedMode,
				queued_count: 0,
				jobs: [],
			};
		}
		let result = await reviewer._enqueueConversionSources(current, sources, requestedMode, {
			openJobsTab: false,
			refreshControllers: false,
		});
		return {
			ok: true,
			requested_mode: requestedMode,
			queued_count: Array.isArray(result?.jobs) ? result.jobs.length : 0,
			jobs: result?.jobs || [],
		};
	}

	async function observeRetrievalState({ reviewer, current, payload = {}, previousState = null, writeArtifacts = false, monitorReason = "" }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let previous = previousState || await loadRetrievalState(reviewer, context);
		let scopedPayload = effectiveScopePayload(payload || {}, previous.scope || {});
		let inspected = await inspectScopedItems(reviewer, current, scopedPayload || {});
		let now = Date.now();
		let previousPdfKeys = new Set(Array.isArray(previous?.pdf_item_keys) ? previous.pdf_item_keys.map((entry) => optionalString(entry)) : []);
		let currentPdfKeys = inspected.withPdf.map((entry) => entry.item_key);
		let newPdfItemKeys = currentPdfKeys.filter((itemKey) => !previousPdfKeys.has(itemKey));
		let lastProgressAt = previous?.last_progress_at || previous?.started_at || "";
		if (newPdfItemKeys.length > 0) {
			lastProgressAt = nowISO();
		}
		let quietForMs = lastProgressAt ? Math.max(0, now - Date.parse(lastProgressAt)) : 0;
		let quietWindowSatisfied = quietForMs >= RETRIEVAL_QUIET_WINDOW_MS;
		let settledWithUnretrieved = quietWindowSatisfied && inspected.withoutPdf.length > 0;
		let conversionQueue = await queueConversionsForInspected({
			reviewer,
			current,
			context,
			inspected,
		});
		let active = retrievalStateIsActive(previous);
		if (inspected.withoutPdf.length === 0) {
			active = false;
		}
		let completedAt = optionalString(previous?.completed_at || "");
		let completionReason = optionalString(previous?.completion_reason || "");
		if (!completedAt && inspected.withoutPdf.length === 0) {
			completedAt = nowISO();
			completionReason = "all_retrieved";
		}
		if (settledWithUnretrieved) {
			active = false;
			if (!completedAt || completionReason == "superseded") {
				completedAt = nowISO();
				completionReason = "idle_ready_to_finalize";
			}
		}
		let nextState = Object.assign({}, previous || {}, {
			active,
			started_at: previous?.started_at || nowISO(),
			last_checked_at: nowISO(),
			last_progress_at: lastProgressAt || nowISO(),
			scope: scopePayload(scopedPayload || {}),
			requested_item_keys: inspected.records.map((entry) => entry.item_key),
			pdf_item_keys: currentPdfKeys,
			missing_item_keys: inspected.withoutPdf.map((entry) => entry.item_key),
			last_fetch_summary: previous?.last_fetch_summary || null,
			completed_at: completedAt,
			completion_reason: completionReason,
		});
		await saveRetrievalState(reviewer, context, nextState);
		let suggestedNextAction = "wait_for_retrieval";
		if (settledWithUnretrieved) {
			suggestedNextAction = "finalize_unretrieved";
		}
		else if (!nextState.active || inspected.withoutPdf.length === 0) {
			suggestedNextAction = "continue_full_text_review";
		}
		let recommendedPollAfterMs = quietWindowSatisfied
			? 0
			: Math.max(5000, Math.min(30000, RETRIEVAL_QUIET_WINDOW_MS - quietForMs));
		if (optionalString(previous?.watch_job_id)) {
			let progressMessage = inspected.withoutPdf.length
				? `Full-text retrieval watch: ${inspected.withPdf.length}/${inspected.records.length} records currently have PDFs.`
				: `Full-text retrieval watch complete: ${inspected.records.length}/${inspected.records.length} records now have PDFs.`;
			await SystematicReviewerWorkflowJobs.progress(
				reviewer,
				current,
				previous.watch_job_id,
				inspected.withPdf.length,
				inspected.records.length,
				progressMessage
			);
			if (newPdfItemKeys.length) {
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					previous.watch_job_id,
					"info",
					`Detected ${newPdfItemKeys.length} newly retrieved PDF${newPdfItemKeys.length == 1 ? "" : "s"}${monitorReason ? ` (${monitorReason})` : ""}.`
				);
			}
			if (conversionQueue.queued_count > 0) {
				await SystematicReviewerWorkflowJobs.log(
					reviewer,
					current,
					previous.watch_job_id,
					"info",
					`Queued ${conversionQueue.queued_count} markdown conversion job${conversionQueue.queued_count == 1 ? "" : "s"} using ${conversionQueue.requested_mode || "the configured PDF mode"}.`
				);
			}
			if (inspected.withoutPdf.length === 0) {
				await finishWatchJob({
					reviewer,
					current,
					jobID: previous.watch_job_id,
					message: "Full-text retrieval watch completed: all scoped records now have PDFs.",
					progressCurrent: inspected.records.length,
					progressTotal: inspected.records.length,
					metadata: {
						scope: nextState.scope || null,
						completion_reason: "all_retrieved",
						retrieved_count: inspected.withPdf.length,
						requested_count: inspected.records.length,
					},
				});
			}
			else if (settledWithUnretrieved && retrievalStateIsActive(previous)) {
				await finishWatchJob({
					reviewer,
					current,
					jobID: previous.watch_job_id,
					message: `Full-text retrieval watch settled with ${inspected.withPdf.length}/${inspected.records.length} records retrieved. Finalize ${inspected.withoutPdf.length} unretrieved record${inspected.withoutPdf.length == 1 ? "" : "s"} next.`,
					progressCurrent: inspected.withPdf.length,
					progressTotal: inspected.records.length,
					metadata: {
						scope: nextState.scope || null,
						completion_reason: "idle_ready_to_finalize",
						retrieved_count: inspected.withPdf.length,
						unretrieved_count: inspected.withoutPdf.length,
						requested_count: inspected.records.length,
					},
				});
			}
		}
		if (writeArtifacts && conversionQueue.queued_count > 0) {
			await writeFullTextArtifact(
				reviewer,
				context,
				"full-text-conversions-auto",
				`${new Date().toISOString()} Full-Text Markdown Conversion Queue`,
				[
					`- Trigger: ${optionalString(monitorReason || "retrieval_monitor").replace(/_/g, " ")}`,
					`- Newly found PDFs: ${newPdfItemKeys.length}`,
					`- Requested mode: ${String(conversionQueue?.requested_mode || "").trim() || "(not recorded)"}`,
					`- Jobs queued: ${Number(conversionQueue?.queued_count || 0) || 0}`,
				]
			);
		}
		return {
			ok: true,
			active: nextState.active !== false,
			watch_job_id: optionalString(previous?.watch_job_id || nextState?.watch_job_id || ""),
			scope: nextState.scope,
			requested_count: inspected.records.length,
			with_pdf_count: inspected.withPdf.length,
			missing_pdf_count: inspected.withoutPdf.length,
			new_pdf_count: newPdfItemKeys.length,
			new_pdf_item_keys: newPdfItemKeys,
			last_progress_at: nextState.last_progress_at,
			quiet_for_ms: quietForMs,
			quiet_window_ms: RETRIEVAL_QUIET_WINDOW_MS,
			quiet_window_satisfied: quietWindowSatisfied,
			idle_ready: settledWithUnretrieved,
			suggested_next_action: suggestedNextAction,
			recommended_poll_after_ms: recommendedPollAfterMs,
			completed_at: nextState.completed_at || "",
			completion_reason: nextState.completion_reason || "",
			conversion_queue: conversionQueue,
			with_pdf_items: inspected.withPdf.slice(0, 50),
			missing_pdf_items: inspected.withoutPdf.slice(0, 50),
		};
	}

	async function startRetrieval({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let requestedJobID = existingJobID(payload);
		if (!requestedJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "fulltext",
				kind: "full_text_retrieval_watch",
				title: "Full-Text Retrieval Watch",
				requested_mode: "full_text_retrieval_watch",
				used_mode: "full_text_retrieval_watch",
				source_title: current?.collection?.name || context.collectionName || "Full Text",
				source_path: context.projectRoot,
				output_path: context.projectRoot,
				metadata: {
					payload: Object.assign({}, payload || {}),
					scope: scopePayload(payload || {}),
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Full-text retrieval watch started. Track progress in Jobs.",
			});
		}
		let previous = await loadRetrievalState(reviewer, context);
		if (retrievalStateIsActive(previous) && optionalString(previous?.watch_job_id)) {
			await finishWatchJob({
				reviewer,
				current,
				jobID: previous.watch_job_id,
				message: "Superseded by a newer full-text retrieval watch.",
				progressCurrent: Number(previous?.pdf_item_keys?.length || 0) || 0,
				progressTotal: Number(previous?.requested_item_keys?.length || 0) || 0,
				metadata: {
					scope: previous?.scope || null,
					completion_reason: "superseded",
				},
			});
		}
		let inspected = await inspectScopedItems(reviewer, current, payload || {});
		let items = (inspected.withoutPdf || [])
			.map((entry) => Zotero.Items.getByLibraryAndKey(context.libraryID, entry.item_key))
			.filter(Boolean);
		let fetchSummary = await fetchAvailableFiles(items);
		let watchJob = { job_id: requestedJobID };
		let state = await saveRetrievalState(reviewer, context, {
			active: true,
			started_at: nowISO(),
			last_checked_at: nowISO(),
			last_progress_at: nowISO(),
			scope: scopePayload(payload || {}),
			requested_item_keys: inspected.records.map((entry) => entry.item_key),
			pdf_item_keys: inspected.withPdf.map((entry) => entry.item_key),
			missing_item_keys: inspected.withoutPdf.map((entry) => entry.item_key),
			last_fetch_summary: fetchSummary,
			watch_job_id: watchJob.job_id,
			completed_at: "",
			completion_reason: "",
		});
		await SystematicReviewerWorkflowJobs.progress(
			reviewer,
			current,
			watchJob?.job_id || "",
			inspected.withPdf.length,
			inspected.records.length,
			`Full-text retrieval watch started for ${inspected.records.length} scoped record${inspected.records.length == 1 ? "" : "s"}.`
		);
		let conversionQueue = await queueConversionsForInspected({
			reviewer,
			current,
			context,
			inspected,
		});
		return {
			ok: true,
			started: true,
			scope: scopePayload(payload || {}),
			requested_count: inspected.records.length,
			with_pdf_count: inspected.withPdf.length,
			missing_pdf_count: inspected.withoutPdf.length,
			watch_job_id: watchJob.job_id,
			fetch_summary: fetchSummary,
			conversion_queue: conversionQueue,
			state,
		};
	}

	async function status({ reviewer, current, payload = {} }) {
		return await observeRetrievalState({
			reviewer,
			current,
			payload: payload || {},
			writeArtifacts: false,
			monitorReason: "manual_status",
		});
	}

	async function queueConversions({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let inspected = await inspectScopedItems(reviewer, current, payload || {});
		return await queueConversionsForInspected({
			reviewer,
			current,
			context,
			inspected,
		});
	}

	async function listItems({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let state = await loadRetrievalState(reviewer, context);
		let inspected = await inspectScopedItems(reviewer, current, payload || state.scope || {});
		return {
			ok: true,
			scope: scopePayload(payload || state.scope || {}),
			requested_count: inspected.records.length,
			with_pdf_count: inspected.withPdf.length,
			missing_pdf_count: inspected.withoutPdf.length,
			retrieved_items: inspected.withPdf,
			unretrieved_items: inspected.withoutPdf,
		};
	}

	async function conversionStatus({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let inspected = await inspectScopedItems(reviewer, current, payload || {});
		let scopedItemKeys = new Set((inspected.records || []).map((entry) => optionalString(entry.item_key)).filter(Boolean));
		let jobs = await SystematicReviewerWorkflowJobs.listJobs(reviewer, current, {
			limit: payload.limit || payload.job_limit || 200,
		});
		let filtered = (jobs || []).filter((entry) => {
			if (optionalString(entry?.kind) != "convert_attachment_markdown") {
				return false;
			}
			if (!scopedItemKeys.size) {
				return true;
			}
			let sourceItemKey = optionalString(entry?.source_item_key || "");
			let parentItemKey = optionalString(entry?.parent_item_key || "");
			return scopedItemKeys.has(sourceItemKey) || scopedItemKeys.has(parentItemKey);
		});
		let counts = {
			queued: 0,
			running: 0,
			succeeded: 0,
			failed: 0,
		};
		for (let entry of filtered) {
			let status = optionalString(entry?.status || "").toLowerCase();
			if (Object.prototype.hasOwnProperty.call(counts, status)) {
				counts[status] += 1;
			}
		}
		return {
			ok: true,
			scope: scopePayload(payload || {}),
			job_count: filtered.length,
			queued_count: counts.queued,
			running_count: counts.running,
			succeeded_count: counts.succeeded,
			failed_count: counts.failed,
			jobs: filtered,
		};
	}

	async function finalizeUnretrieved({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let state = await status({ reviewer, current, payload });
		let targets = await collectionTargets(reviewer, current);
		let excludedCollection = targets?.excluded || null;
		if (!excludedCollection?.key) {
			throw new Error("Excluded collection is unavailable.");
		}
		let result = await moveItemsWithDecision({
			reviewer,
			current,
			itemKeys: (state.missing_pdf_items || []).map((entry) => entry.item_key),
			targetCollection: excludedCollection,
			decision: "exclude",
			reason: NOT_RETRIEVED_REASON,
			notes: optionalString(payload.notes || "Full text could not be retrieved."),
			sourceType: "automated",
			sourceDetail: "full_text_retrieval_monitor",
		});
		let previous = await loadRetrievalState(reviewer, context);
		let nextState = Object.assign({}, previous || {}, {
			active: false,
			last_checked_at: nowISO(),
			completed_at: nowISO(),
			completion_reason: "finalized_unretrieved",
			missing_item_keys: [],
		});
		await saveRetrievalState(reviewer, context, nextState);
		await finishWatchJob({
			reviewer,
			current,
			jobID: optionalString(previous?.watch_job_id || ""),
			message: `Full-text retrieval watch completed after moving ${Number(result?.moved_count || 0) || 0} unretrieved record${Number(result?.moved_count || 0) == 1 ? "" : "s"} to Excluded.`,
			progressCurrent: Number(state?.with_pdf_count || 0) || 0,
			progressTotal: Number(state?.requested_count || 0) || 0,
			metadata: {
				scope: nextState.scope || null,
				completion_reason: "finalized_unretrieved",
				moved_count: Number(result?.moved_count || 0) || 0,
				reason_code: NOT_RETRIEVED_REASON,
			},
		});
		return Object.assign({}, result, {
			reason_code: NOT_RETRIEVED_REASON,
			watch_job_id: optionalString(previous?.watch_job_id || ""),
		});
	}

	async function completeInclusion({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let targets = await collectionTargets(reviewer, current);
		let includedCollection = targets?.included || null;
		if (!includedCollection?.key) {
			throw new Error("Included collection is unavailable.");
		}
		let inspected = await inspectScopedItems(reviewer, current, Object.assign({}, payload || {}, {
			scope: payload.scope || "pending",
		}));
		let result = await moveItemsWithDecision({
			reviewer,
			current,
			itemKeys: inspected.records.map((entry) => entry.item_key),
			targetCollection: includedCollection,
			decision: "include",
			reason: optionalString(payload.reason || "full_text_eligible"),
			notes: optionalString(payload.notes || "Moved to Included after full-text eligibility review."),
			sourceType: "manual",
			sourceDetail: "full_text_stage_completion",
		});
		let previous = await loadRetrievalState(reviewer, context);
		let nextState = Object.assign({}, previous || {}, {
			active: false,
			last_checked_at: nowISO(),
			completed_at: nowISO(),
			completion_reason: "included_completion",
			missing_item_keys: [],
		});
		await saveRetrievalState(reviewer, context, nextState);
		await finishWatchJob({
			reviewer,
			current,
			jobID: optionalString(previous?.watch_job_id || ""),
			message: `Full-text retrieval workflow handed off after moving ${Number(result?.moved_count || 0) || 0} remaining Pending record${Number(result?.moved_count || 0) == 1 ? "" : "s"} into Included.`,
			progressCurrent: Number(result?.moved_count || 0) || 0,
			progressTotal: Number(result?.moved_count || 0) || 0,
			metadata: {
				scope: nextState.scope || null,
				completion_reason: "included_completion",
				moved_count: Number(result?.moved_count || 0) || 0,
			},
		});
		return Object.assign({}, result, {
			default_results_scope: {
				scope: "included",
				collection_key: String(includedCollection.key || ""),
				collection_name: String(includedCollection.name || ""),
			},
			watch_job_id: optionalString(previous?.watch_job_id || ""),
		});
	}

	async function hasActiveRetrieval({ reviewer, context }) {
		if (!context) {
			return false;
		}
		let state = await loadRetrievalState(reviewer, context);
		return retrievalStateIsActive(state);
	}

	async function reconcileActiveMonitor({ reviewer, current, payload = {}, reason = "" }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let previous = await loadRetrievalState(reviewer, context);
		if (!retrievalStateIsActive(previous)) {
			return {
				ok: true,
				active: false,
				scope: previous?.scope || {},
			};
		}
		return await observeRetrievalState({
			reviewer,
			current,
			payload: payload || previous.scope || {},
			previousState: previous,
			writeArtifacts: true,
			monitorReason: optionalString(reason || "project_refresh"),
		});
	}

	return {
		NOT_RETRIEVED_REASON,
		startRetrieval,
		status,
		listItems,
		queueConversions,
		conversionStatus,
		finalizeUnretrieved,
		completeInclusion,
		hasActiveRetrieval,
		reconcileActiveMonitor,
	};
})();
