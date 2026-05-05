var SystematicReviewerWorkflowSemanticSearch = (() => {
	const SCORE_BATCH_SIZE = 1000;

	function optionalString(value) {
		return String(value || "").trim();
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

	function nowStamp() {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	function normalizeLimit(value) {
		let raw = optionalString(value);
		if (["all", "unlimited", "none", "no_limit", "nolimit"].includes(raw.toLowerCase())) {
			return null;
		}
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return 25;
		}
		return Math.max(1, Math.round(parsed));
	}

	function buildPreview(text) {
		let value = String(text || "").trim().replace(/\s+/g, " ");
		if (!value) {
			return "";
		}
		return value.length > 320 ? `${value.slice(0, 317)}...` : value;
	}

	function cosineSimilarity(left = [], right = []) {
		if (!left.length || !right.length || left.length != right.length) {
			return null;
		}
		let dot = 0;
		let leftNorm = 0;
		let rightNorm = 0;
		for (let index = 0; index < left.length; index += 1) {
			let l = Number(left[index] || 0);
			let r = Number(right[index] || 0);
			dot += l * r;
			leftNorm += l * l;
			rightNorm += r * r;
		}
		if (!leftNorm || !rightNorm) {
			return null;
		}
		return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
	}

	function scoreColumnKey(searchName = "") {
		let slug = String(searchName || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
		return `semantic_${slug || "search"}`;
	}

	function chunkColumnKey(searchName = "") {
		return `${scoreColumnKey(searchName)}_chunk`;
	}

	function currentContext(currentOrContext) {
		return currentOrContext?.context || currentOrContext;
	}

	async function currentEmbeddingsModel(reviewer) {
		let config = await reviewer._conversionConfig();
		return {
			config,
			model: optionalString(
				SystematicReviewerWorkflowEmbeddings.currentEmbeddingsModel
					? await SystematicReviewerWorkflowEmbeddings.currentEmbeddingsModel(reviewer)
					: (
						config?.runtimeRoles?.embeddings?.model
						|| config?.embeddingsClient?.model
						|| ""
					)
			),
		};
	}

	function availableScopes(reviewer, current) {
		return SystematicReviewerWorkflowEmbeddings.availableScopes
			? SystematicReviewerWorkflowEmbeddings.availableScopes(reviewer, current, {
				purpose: "semantic",
			})
			: [];
	}

	function defaultScopeEntry(scopes = []) {
		return scopes.find((entry) => optionalString(entry.collection_name).toLowerCase() == "pending")
			|| scopes[0]
			|| null;
	}

	function resolveScopePayload(reviewer, current, payload = {}) {
		let explicit = SystematicReviewerWorkflowEmbeddings.scopeSpecFromPayload(payload || {});
		if (explicit) {
			return explicit;
		}
		let fallback = defaultScopeEntry(availableScopes(reviewer, current));
		if (!fallback?.collection_key) {
			return {};
		}
		return {
			collection_key: String(fallback.collection_key || ""),
			collection_name: String(fallback.collection_name || ""),
		};
	}

	function scopeDescriptor(reviewer, current, payload = {}) {
		return SystematicReviewerWorkflowEmbeddings.scopeDescriptor
			? SystematicReviewerWorkflowEmbeddings.scopeDescriptor(
				reviewer,
				current,
				resolveScopePayload(reviewer, current, payload)
			)
			: null;
	}

	async function projectItemMap(reviewer, current, payload = {}) {
		let rows = SystematicReviewerWorkflowEmbeddings.projectItemRows
			? await SystematicReviewerWorkflowEmbeddings.projectItemRows(
				reviewer,
				current,
				resolveScopePayload(reviewer, current, payload)
			)
			: [];
		return new Map((rows || []).map((row) => [String(row.item_key || ""), row]));
	}

	async function readSemanticScoreColumns(reviewer, context) {
		if (!context) {
			return [];
		}
		await SystematicReviewerWorkflowScreening.ensureSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT column_key, label, type, updated_at
			 FROM screening_columns
			 WHERE column_key LIKE ?
			 ORDER BY updated_at DESC, column_key ASC`,
			["semantic_%"]
		);
		return (rows || []).map((row) => ({
			column_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "column_key") || ""),
			label: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "label") || ""),
			type: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "type") || ""),
			updated_at: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "updated_at") || ""),
		}));
	}

	async function storedSourcesForModel(reviewer, current, model = "", payload = {}) {
		let stored = await SystematicReviewerWorkflowEmbeddings.listStored(reviewer, currentContext(current));
		return (stored || [])
			.filter((entry) => optionalString(entry.model) == optionalString(model) && Number(entry.vector_count || 0) > 0)
			.map((entry) => {
				let sourceKey = entry.source_key || SystematicReviewerWorkflowEmbeddings.sourceKeyFromVectorKind(entry.vector_column);
				let sourceLabel = entry.source_label || SystematicReviewerWorkflowEmbeddings.sourceLabel(sourceKey);
				return {
					source_key: sourceKey,
					source_label: sourceLabel || entry.vector_column,
					vector_column: entry.vector_column,
					model: entry.model,
					vector_count: Number(entry.vector_count || 0) || 0,
					vector_dim: Number(entry.vector_dim || 0) || 0,
					last_updated: entry.last_updated || "",
					item_count: Number(entry?.item_count || 0) || 0,
				};
			});
	}

	async function listSourceOptions({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let { model } = await currentEmbeddingsModel(reviewer);
		let scopePayload = resolveScopePayload(reviewer, current, payload);
		return {
			ok: true,
			current_model: model,
			scope: scopeDescriptor(reviewer, current, scopePayload),
			sources: model
				? await storedSourcesForModel(reviewer, current, model, scopePayload)
				: [],
		};
	}

	function selectStoredSource(sources = [], payload = {}) {
		let requestedVector = optionalString(payload.vector_column || payload.vectorColumn);
		let requestedSource = optionalString(payload.source_key || payload.sourceKey || payload.source);
		return sources.find((entry) =>
			(entry.vector_column && entry.vector_column == requestedVector)
			|| (entry.source_key && entry.source_key == requestedSource)
		) || sources[0] || null;
	}

	async function previewItem({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		let record = (await projectItemMap(reviewer, current, payload || {})).get(itemKey) || null;
		if (!record) {
			throw new Error("That item key was not found in the current collection project.");
		}
		let extractionValues = await SystematicReviewerWorkflowExtraction.listResults({
			reviewer,
			current,
			payload: { limit: 500 },
		});
		let itemValues = Array.isArray(extractionValues?.items)
			? extractionValues.items.find((entry) => String(entry.item_key || "") == itemKey)
			: null;
		return {
			ok: true,
			item: Object.assign({}, record, {
				abstract_preview: buildPreview(record.abstract_note),
				extraction_values: itemValues?.values || [],
			}),
		};
	}

	async function getConfig({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let { model } = await currentEmbeddingsModel(reviewer);
		let scopes = payload?.include_available_scopes !== false
			? availableScopes(reviewer, current)
			: [];
		let scopePayload = resolveScopePayload(reviewer, current, payload);
		return {
			ok: true,
			current_model: model,
			scope: scopeDescriptor(reviewer, current, scopePayload),
			available_scopes: payload?.include_available_scopes !== false ? scopes : [],
			sources: await storedSourcesForModel(reviewer, current, model, scopePayload),
			score_columns: await readSemanticScoreColumns(reviewer, context),
		};
	}

	async function queueSearch({ reviewer, current, payload = {}, options = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let query = optionalString(payload.query);
		if (!query) {
			throw new Error("Semantic query is required.");
		}
		let searchName = optionalString(payload.search_name || payload.searchName || payload.name) || `Semantic Search ${nowStamp()}`;
		let scopePayload = resolveScopePayload(reviewer, current, payload);
		let { model: configuredModel } = await currentEmbeddingsModel(reviewer);
		if (!configuredModel) {
			throw new Error("Embeddings model is not configured.");
		}
		let allStored = await SystematicReviewerWorkflowEmbeddings.listStored(reviewer, context);
		let sources = await storedSourcesForModel(reviewer, current, configuredModel, scopePayload);
		let source = selectStoredSource(sources, payload);
		if (!source) {
			let requestedVector = optionalString(payload.vector_column || payload.vectorColumn);
			let requestedAny = (allStored || []).some((entry) => optionalString(entry.vector_column) == requestedVector);
			if (requestedVector && requestedAny) {
				throw new Error("Stored vectors for that source were created with a different embeddings model. Recreate embeddings for this source first.");
			}
			throw new Error("No stored embeddings exist for the current embeddings model. Run Embeddings first.");
		}
		let scoreColumn = scoreColumnKey(searchName);
		let chunkColumn = source.source_key == "full_text" ? chunkColumnKey(searchName) : "";
		let queuePayload = Object.assign({}, payload || {}, {
			query,
			search_name: searchName,
			vector_column: source.vector_column,
			source_key: source.source_key,
			include_available_scopes: false,
		});
		if (scopePayload?.collection_key) {
			queuePayload.collection_key = scopePayload.collection_key;
		}
		if (scopePayload?.collection_name) {
			queuePayload.collection_name = scopePayload.collection_name;
		}
		let job = await reviewer._queueWorkflowJob(current, {
			prefix: "semantic",
			kind: "manual_semantic_search",
			title: `Semantic search: ${source.source_label}`,
			requested_mode: source.vector_column,
			used_mode: configuredModel || source.vector_column,
			source_title: `${current.collection?.name || "Collection"} / ${source.source_label}`,
			source_path: context.databasePath,
			output_path: context.databasePath,
			metadata: {
				payload: queuePayload,
				query,
				search_name: searchName,
				score_column: scoreColumn,
				chunk_column: chunkColumn,
				vector_column: source.vector_column,
				source_key: source.source_key,
				model: configuredModel,
				scope: scopeDescriptor(reviewer, current, scopePayload),
				batch_size: SCORE_BATCH_SIZE,
				queue_origin: String(options.queue_origin || "").trim(),
			},
			targetWin: options.targetWin || null,
			openJobsTab: options.openJobsTab === true,
			refreshControllers: options.refreshControllers !== false,
		});
		return {
			ok: true,
			queued: true,
			job_id: job.job_id,
			job_kind: "manual_semantic_search",
			message: "Job started. Track progress in Jobs.",
			search_name: searchName,
			score_column: scoreColumn,
			chunk_column: chunkColumn,
			source_key: source.source_key,
			source_label: source.source_label,
			vector_column: source.vector_column,
			model: configuredModel,
			scope: scopeDescriptor(reviewer, current, scopePayload),
		};
	}

	function normalizeBands(payload = {}) {
		let rawBands = Array.isArray(payload?.bands) ? payload.bands : null;
		let fallback = [
			{ label: "Very high relevance", min: 0.8, max: 1.000001 },
			{ label: "High relevance", min: 0.6, max: 0.8 },
			{ label: "Possible relevance", min: 0.4, max: 0.6 },
			{ label: "Low relevance", min: -1.000001, max: 0.4 },
		];
		let bands = rawBands && rawBands.length ? rawBands : fallback;
		return bands.map((band, index) => ({
			label: optionalString(band?.label || `Band ${index + 1}`),
			min: Number(band?.min),
			max: Number(band?.max),
		})).filter((band) => Number.isFinite(band.min) && Number.isFinite(band.max) && band.max > band.min);
	}

	async function inspectScores({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let scoreColumns = await readSemanticScoreColumns(reviewer, context);
		let requestedColumn = optionalString(payload.score_column || payload.scoreColumn || payload.column_key || payload.columnKey);
		let selectedColumn = requestedColumn
			? scoreColumns.find((entry) => optionalString(entry?.column_key) == requestedColumn) || null
			: scoreColumns[0] || null;
		if (!selectedColumn?.column_key) {
			throw new Error("No semantic score column is available for inspection.");
		}
		let itemMap = await projectItemMap(reviewer, current, payload || {});
		let itemKeys = Array.from(itemMap.keys());
		if (!itemKeys.length) {
			return {
				ok: true,
				score_column: selectedColumn.column_key,
				score_columns: scoreColumns,
				scope: scopeDescriptor(reviewer, current, payload || {}),
				total_scored: 0,
				bands: [],
			};
		}
		let scored = [];
		for (let offset = 0; offset < itemKeys.length; offset += SCORE_BATCH_SIZE) {
			let batch = itemKeys.slice(offset, offset + SCORE_BATCH_SIZE);
			let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`SELECT item_key, COALESCE(value_text, '') AS value_text
				 FROM screening_column_values
				 WHERE column_key=? AND item_key IN (${batch.map(() => "?").join(", ")})`,
				[selectedColumn.column_key, ...batch]
			);
			for (let row of rows || []) {
				let itemKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key"));
				let score = Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "value_text"));
				if (!itemKey || !Number.isFinite(score)) {
					continue;
				}
				let record = itemMap.get(itemKey) || {};
				scored.push({
					item_key: itemKey,
					title: String(record.title || ""),
					abstract_preview: buildPreview(record.abstract_note),
					citation_token: String(record.citation_token || `@[${itemKey}]`),
					cosine_score: score,
				});
			}
		}
		scored.sort((left, right) =>
			Number(right.cosine_score || 0) - Number(left.cosine_score || 0)
			|| String(left.title || "").localeCompare(String(right.title || ""))
		);
		let sampleLimit = Math.max(1, Math.min(20, Number(payload.sample_limit || payload.sampleLimit || 5) || 5));
		let scoreValues = scored.map((entry) => Number(entry.cosine_score || 0));
		let total = scoreValues.length;
		let sum = scoreValues.reduce((acc, value) => acc + value, 0);
		let min = total ? Math.min(...scoreValues) : null;
		let max = total ? Math.max(...scoreValues) : null;
		let bands = normalizeBands(payload).map((band) => {
			let matches = scored.filter((entry) => entry.cosine_score >= band.min && entry.cosine_score < band.max);
			return {
				label: band.label,
				min: band.min,
				max: band.max,
				count: matches.length,
				samples: matches.slice(0, sampleLimit),
			};
		});
		return {
			ok: true,
			score_column: selectedColumn.column_key,
			score_column_label: selectedColumn.label || selectedColumn.column_key,
			score_columns: scoreColumns,
			scope: scopeDescriptor(reviewer, current, payload || {}),
			total_scored: total,
			summary: {
				min,
				max,
				average: total ? (sum / total) : null,
			},
			bands,
		};
	}

	async function executeBatchWrites(reviewer, context, statements = []) {
		if (!Array.isArray(statements) || !statements.length) {
			return;
		}
		let db = await reviewer._projectDB(context);
		await db.executeTransaction(async () => {
			for (let statement of statements) {
				if (!statement?.sql) {
					continue;
				}
				await db.queryAsync(statement.sql, statement.params || []);
			}
		});
	}

	function markdownHeadingBlock(title = "", lines = []) {
		return [
			`#### ${String(title || "Entry").trim()}`,
			"",
			...(Array.isArray(lines) ? lines : []).map((line) => String(line || "")),
		].join("\n").trim();
	}

	async function recordSemanticSearchArtifact(reviewer, current, result = {}) {
		if (!current?.context || !SystematicReviewerWorkflowArtifacts?.writeArtifact) {
			return null;
		}
		let artifact = await SystematicReviewerWorkflowArtifacts.writeArtifact(reviewer, current.context, {
			category: "semantic",
			kind: "semantic-search",
			extension: "md",
			content: markdownHeadingBlock(
				`${new Date().toISOString()} Semantic Search`,
				[
					`- Search: ${String(result?.search_name || result?.score_column || "semantic search").trim()}`,
					`- Query: ${String(result?.query || "").trim() || "(not recorded)"}`,
					`- Scope: ${String(result?.scope?.label || result?.scope?.collection_name || result?.scope?.collection_key || "").trim() || "(project scope)"}`,
					`- Source: ${String(result?.source_label || result?.source_key || "").trim() || "(unknown source)"}`,
					`- Model: ${String(result?.model || "").trim() || "(not recorded)"}`,
					`- Total results: ${Number(result?.total_results || 0) || 0}`,
					`- Returned results: ${Number(result?.returned_results || 0) || 0}`,
				]
			),
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "semantic",
			headingPath: ["Results", "Screening Results"],
			marker: "semantic-results",
			emptyLabel: "No semantic-search notes have been logged yet.",
		});
		await SystematicReviewerWorkflowArtifacts.syncCategoryBlock(reviewer, current.context, {
			category: "semantic",
			headingPath: ["Appendices", "Semantic Searches"],
			marker: "semantic-searches",
			emptyLabel: "No semantic-search runs have been logged yet.",
		});
		return artifact;
	}

	async function search({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let query = optionalString(payload.query);
		if (!query) {
			throw new Error("Semantic query is required.");
		}
		let searchName = optionalString(payload.search_name || payload.searchName || payload.name) || `Semantic Search ${nowStamp()}`;
		let scoreColumn = scoreColumnKey(searchName);
		let fullTextChunkColumn = chunkColumnKey(searchName);
		let limit = normalizeLimit(payload.limit);
		let scopePayload = resolveScopePayload(reviewer, current, payload);
		let scopedItems = await projectItemMap(reviewer, current, scopePayload);
		if (!scopedItems.size) {
			throw new Error("No scoped items are available for semantic search.");
		}

		let { model: configuredModel } = await currentEmbeddingsModel(reviewer);
		let allStored = await SystematicReviewerWorkflowEmbeddings.listStored(reviewer, context);
		let sources = await storedSourcesForModel(reviewer, current, configuredModel, scopePayload);
		let source = selectStoredSource(sources, payload);
		if (!source) {
			let requestedVector = optionalString(payload.vector_column || payload.vectorColumn);
			let requestedAny = (allStored || []).some((entry) => optionalString(entry.vector_column) == requestedVector);
			if (requestedVector && requestedAny) {
				throw new Error("Stored vectors for that source were created with a different embeddings model. Recreate embeddings for this source first.");
			}
			throw new Error("No stored embeddings exist for the current embeddings model. Run Embeddings first.");
		}

		let clientState = await SystematicReviewerWorkflowEmbeddings.resolveEmbeddingsClient(reviewer);
		let currentModel = optionalString(clientState.logicalModel || configuredModel || clientState.client?.model);
		if (optionalString(source.model) != currentModel) {
			throw new Error("Stored vectors for that source were created with a different embeddings model. Recreate embeddings for this source first.");
		}

		let existingJobID = optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
		if (!existingJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "semantic",
				kind: "manual_semantic_search",
				title: `Semantic search: ${source.source_label}`,
				requested_mode: source.vector_column,
				used_mode: currentModel || source.vector_column,
				source_title: `${current.collection?.name || "Collection"} / ${source.source_label}`,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}, {
						query,
						search_name: searchName,
						vector_column: source.vector_column,
						source_key: source.source_key,
					}),
					query,
					search_name: searchName,
					score_column: scoreColumn,
					vector_column: source.vector_column,
					source_key: source.source_key,
					model: currentModel,
					scope: scopeDescriptor(reviewer, current, scopePayload),
					batch_size: SCORE_BATCH_SIZE,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Semantic search started. Track progress in Jobs.",
			});
		}
		let job = { job_id: existingJobID };

		try {
			await SystematicReviewerWorkflowScreening.ensureSchema(reviewer, context);
			await SystematicReviewerWorkflowScreening.upsertColumnDefinition(
				reviewer,
				context,
				scoreColumn,
				searchName,
				"number"
			);
			await SystematicReviewerWorkflowEmbeddings.executeWrite(
				reviewer,
				context,
				"DELETE FROM screening_column_values WHERE column_key=?",
				[scoreColumn]
			);

			await SystematicReviewerWorkflowJobs.log(
				reviewer,
				current,
				job.job_id,
				"info",
				`Embedding semantic query with ${currentModel || clientState.client.model}.`
			);
			let queryVector = SystematicReviewerWorkflowEmbeddings.normalizeVector(
				(await SystematicReviewerWorkflowEmbeddings.embedTexts(reviewer, clientState.client, [query]))[0] || [],
				true
			);
			if (source.source_key == "full_text") {
				let fullTextResult = await SystematicReviewerWorkflowRAG.searchFullText({
					reviewer,
					current,
					payload,
					queryVector,
					searchName,
					scoreColumn,
					chunkColumn: fullTextChunkColumn,
					currentModel,
					scopedItems,
					limit,
					job,
				});
				let result = {
					ok: true,
					job_id: job.job_id,
					query,
					search_name: searchName,
					score_column: scoreColumn,
					chunk_column: fullTextResult.chunk_column,
					source_key: source.source_key,
					source_label: source.source_label,
					vector_column: source.vector_column,
					model: currentModel,
					limit,
					total_results: Number(fullTextResult.total_results || 0) || 0,
					returned_results: Array.isArray(fullTextResult.results) ? fullTextResult.results.length : 0,
					scanned_rows: Number(fullTextResult.scanned_rows || 0) || 0,
					candidate_rows: Number(fullTextResult.candidate_rows || 0) || 0,
					scored_rows: Number(fullTextResult.scored_rows || 0) || 0,
					flushed_rows: Number(fullTextResult.flushed_rows || 0) || 0,
					mismatched_dim: Number(fullTextResult.mismatched_dim || 0) || 0,
					scope: scopeDescriptor(reviewer, current, scopePayload),
					score_columns: await readSemanticScoreColumns(reviewer, context),
					results: Array.isArray(fullTextResult.results) ? fullTextResult.results : [],
				};
				await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
					used_mode: currentModel || source.vector_column,
					output_path: context.databasePath,
					progress_current: Number(fullTextResult.scored_rows || 0) || 0,
					progress_total: Math.max(
						Number(fullTextResult.candidate_rows || 0) || 0,
						Number(fullTextResult.scored_rows || 0) || 0
					),
					metadata: result,
					message: `Stored ${result.total_results} full-text semantic matches in ${scoreColumn} and ${fullTextChunkColumn}.`,
				});
				if (existingJobID) {
					await recordSemanticSearchArtifact(reviewer, current, result).catch((error) => {
						reviewer?.log?.(`semantic artifact write skipped: ${error}`);
					});
				}
				return result;
			}

			let results = [];
			let scannedRows = 0;
			let candidateRows = 0;
			let scoredRows = 0;
			let mismatchedDim = 0;
			let flushedRows = 0;
			let scopedItemKeys = Array.from(scopedItems.keys()).sort((left, right) => left.localeCompare(right));
			for (let offset = 0; offset < scopedItemKeys.length; offset += SCORE_BATCH_SIZE) {
				await reviewer._throwIfJobCanceled?.(current, job.job_id);
				let batchKeys = scopedItemKeys.slice(offset, offset + SCORE_BATCH_SIZE);
				if (!batchKeys.length) {
					continue;
				}
				let placeholders = batchKeys.map(() => "?").join(", ");
				let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
					reviewer,
					context,
					`SELECT item_key, vector_blob, dimensions, COALESCE(model, '') AS model
					 FROM item_vectors
					 WHERE vector_kind=?
					   AND COALESCE(model, '') = ?
					   AND item_key IN (${placeholders})
					 ORDER BY item_key ASC`,
					[source.vector_column, currentModel, ...batchKeys]
				);
				if (!rows.length) {
					await SystematicReviewerWorkflowJobs.progress(
						reviewer,
						current,
						job.job_id,
						offset + batchKeys.length,
						scopedItems.size,
						`Scored ${scoredRows} rows after scanning ${scannedRows}`
					);
					continue;
				}
				scannedRows += rows.length;
				let statements = [];
				for (let row of rows) {
					let itemKey = String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key") || "");
					let record = scopedItems.get(itemKey) || null;
					if (!record) {
						continue;
					}
					candidateRows += 1;
					let vector = SystematicReviewerWorkflowEmbeddings.normalizeVector(
						SystematicReviewerWorkflowEmbeddings.blobToVector(
							SystematicReviewerWorkflowEmbeddings.rowValue(row, "vector_blob")
						),
						true
					);
					let score = cosineSimilarity(queryVector, vector);
					if (score === null) {
						mismatchedDim += 1;
						continue;
					}
					let valueText = String(Number(score).toFixed(8));
					statements.push({
						sql: `INSERT OR REPLACE INTO screening_column_values (
							item_key, column_key, value_text, updated_at
						) VALUES (?, ?, ?, ?)`,
						params: [itemKey, scoreColumn, valueText, new Date().toISOString()],
					});
					results.push({
						item_key: itemKey,
						title: String(record.title || ""),
						abstract_preview: buildPreview(record.abstract_note),
						year: String(record.year || ""),
						doi: String(record.doi || ""),
						citation_text: String(record.citation_text || ""),
						citation_token: String(record.citation_token || `@[${itemKey}]`),
						zotero_uri: String(record.zotero_uri || ""),
						cosine_score: Number(score),
					});
					scoredRows += 1;
				}
				await executeBatchWrites(reviewer, context, statements);
				flushedRows += statements.length;
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					job.job_id,
					Math.min(offset + batchKeys.length, scopedItems.size),
					scopedItems.size,
					`Scored ${scoredRows} rows after scanning ${scannedRows}`
				);
			}

			results.sort((left, right) =>
				(Number(right.cosine_score || 0) - Number(left.cosine_score || 0))
				|| String(left.title || "").localeCompare(String(right.title || ""))
				|| String(left.item_key || "").localeCompare(String(right.item_key || ""))
			);
			let limitedResults = limit === null ? results : results.slice(0, limit);
			let result = {
				ok: true,
				job_id: job.job_id,
				query,
				search_name: searchName,
				score_column: scoreColumn,
				source_key: source.source_key,
				source_label: source.source_label,
				vector_column: source.vector_column,
				model: currentModel,
				limit,
				total_results: results.length,
				returned_results: limitedResults.length,
				scanned_rows: scannedRows,
				candidate_rows: candidateRows,
				scored_rows: scoredRows,
				flushed_rows: flushedRows,
				mismatched_dim: mismatchedDim,
				scope: scopeDescriptor(reviewer, current, scopePayload),
				score_columns: await readSemanticScoreColumns(reviewer, context),
				results: limitedResults,
			};
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: currentModel || source.vector_column,
				output_path: context.databasePath,
				progress_current: scoredRows,
				progress_total: Math.max(candidateRows, scoredRows),
				metadata: result,
				message: `Stored ${scoredRows} semantic scores in ${scoreColumn}.`,
			});
			if (existingJobID) {
				await recordSemanticSearchArtifact(reviewer, current, result).catch((error) => {
					reviewer?.log?.(`semantic artifact write skipped: ${error}`);
				});
			}
			return result;
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
		finally {
			await clientState.release?.();
		}
	}

	return {
		listSourceOptions,
		getConfig,
		queueSearch,
		search,
		previewItem,
		inspectScores,
		listScoreColumns: readSemanticScoreColumns,
	};
})();
