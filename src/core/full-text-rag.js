var SystematicReviewerWorkflowRAG = (() => {
	const FULL_TEXT_SOURCE_KEY = "full_text";
	const FULL_TEXT_VECTOR_KIND = "embedding:full_text";
	const FULL_TEXT_CHUNK_TOKENS = 512;
	const FULL_TEXT_CHUNK_OVERLAP_TOKENS = 128;
	const APPROX_WORDS_PER_TOKEN = 0.75;
	const FULL_TEXT_CHUNK_WORDS = Math.max(200, Math.round(FULL_TEXT_CHUNK_TOKENS * APPROX_WORDS_PER_TOKEN));
	const FULL_TEXT_CHUNK_OVERLAP_WORDS = Math.max(50, Math.round(FULL_TEXT_CHUNK_OVERLAP_TOKENS * APPROX_WORDS_PER_TOKEN));
	const SEARCH_BATCH_SIZE = 200;
	const PAGE_BREAK_RE = /^\s*<!--\s*sr:page-break\s*-->\s*$/i;
	const PAGE_MARKER_RE = /^\s*<[-]{1,2}page(\d+)[-]{1,2}>\s*$/i;
	const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/;

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

	function currentContext(currentOrContext) {
		return currentOrContext?.context || currentOrContext;
	}

	function normalizeSearchText(value = "") {
		return String(value || "")
			.replace(/\r\n/g, "\n")
			.replace(/^\s*<!--\s*sr:page-break\s*-->\s*$/gim, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function approximateTokenCountFromWords(wordCount = 0) {
		let words = Math.max(0, Number(wordCount || 0) || 0);
		return Math.max(words, Math.round(words / APPROX_WORDS_PER_TOKEN));
	}

	function chunkID(itemKey = "", attachmentKey = "", chunkIndex = 0) {
		return `${String(itemKey || "").trim()}:${String(attachmentKey || "").trim() || "markdown"}:${Math.max(0, Number(chunkIndex || 0) || 0)}`;
	}

	function pageSectionMarkers(text = "") {
		let source = String(text || "").replace(/\r\n/g, "\n");
		let markers = [];
		let offset = 0;
		let pageNumber = 1;
		let sectionLabel = "";
		for (let line of source.split("\n")) {
			let trimmed = String(line || "").trim();
			let pageMatch = trimmed.match(PAGE_MARKER_RE);
			if (pageMatch) {
				pageNumber = Math.max(1, Number(pageMatch[1]) || pageNumber || 1);
				markers.push({
					offset,
					page_label: `Page ${pageNumber}`,
					section_label: sectionLabel,
				});
			}
			else if (PAGE_BREAK_RE.test(trimmed)) {
				pageNumber += 1;
				markers.push({
					offset,
					page_label: `Page ${pageNumber}`,
					section_label: sectionLabel,
				});
			}
			else {
				let headingMatch = trimmed.match(HEADING_RE);
				if (headingMatch) {
					sectionLabel = String(headingMatch[2] || "").trim();
					markers.push({
						offset,
						page_label: `Page ${pageNumber}`,
						section_label: sectionLabel,
					});
				}
			}
			offset += line.length + 1;
		}
		return markers;
	}

	function metadataAtOffset(markers = [], offset = 0) {
		let pageLabel = "Page 1";
		let sectionLabel = "";
		for (let marker of markers || []) {
			if (Number(marker?.offset || 0) > Number(offset || 0)) {
				break;
			}
			pageLabel = optionalString(marker.page_label) || pageLabel;
			sectionLabel = optionalString(marker.section_label) || sectionLabel;
		}
		return {
			page_label: pageLabel,
			section_label: sectionLabel,
		};
	}

	function chunkMarkdownText(markdown = "") {
		let source = String(markdown || "").replace(/\r\n/g, "\n");
		if (!source.trim()) {
			return [];
		}
		let segments = [];
		let regex = /\S+\s*/g;
		let match = null;
		while ((match = regex.exec(source))) {
			segments.push({
				start: match.index,
				end: match.index + match[0].length,
				text: match[0],
			});
		}
		if (!segments.length) {
			return [];
		}
		let markers = pageSectionMarkers(source);
		let chunks = [];
		let step = Math.max(1, FULL_TEXT_CHUNK_WORDS - FULL_TEXT_CHUNK_OVERLAP_WORDS);
		for (let startIndex = 0, chunkIndex = 0; startIndex < segments.length; startIndex += step, chunkIndex += 1) {
			let endIndex = Math.min(segments.length, startIndex + FULL_TEXT_CHUNK_WORDS);
			let startOffset = segments[startIndex].start;
			let endOffset = segments[endIndex - 1].end;
			let text = source.slice(startOffset, endOffset).trim();
			if (!text) {
				continue;
			}
			let metadata = metadataAtOffset(markers, startOffset);
			chunks.push({
				chunk_index: chunkIndex,
				start_offset: startOffset,
				end_offset: endOffset,
				text,
				word_count: endIndex - startIndex,
				token_count: approximateTokenCountFromWords(endIndex - startIndex),
				page_label: metadata.page_label,
				section_label: metadata.section_label,
			});
			if (endIndex >= segments.length) {
				break;
			}
		}
		return chunks;
	}

	async function attachmentFilePath(attachment) {
		if (!attachment) {
			return "";
		}
		if (attachment.getFilePathAsync) {
			return String((await attachment.getFilePathAsync()) || "");
		}
		if (attachment.getFilePath) {
			return String(attachment.getFilePath() || "");
		}
		return "";
	}

	function textAttachmentRank(name = "") {
		let lower = String(name || "").trim().toLowerCase();
		if (!lower) {
			return 0;
		}
		if (lower.endsWith("v.md")) {
			return 5;
		}
		if (lower.endsWith("f.md")) {
			return 4;
		}
		if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
			return 3;
		}
		if (lower.endsWith(".txt")) {
			return 2;
		}
		if (lower.endsWith(".csv")) {
			return 1;
		}
		return 0;
	}

	function textAttachmentRankForNames(names = []) {
		for (let name of names || []) {
			let rank = textAttachmentRank(name);
			if (rank > 0) {
				return rank;
			}
		}
		return 0;
	}

	function isMarkdownAttachment(attachment, filePath = "") {
		if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
			return false;
		}
		let contentType = String(attachment.attachmentContentType || "").toLowerCase();
		if (contentType == "text/markdown" || contentType == "text/plain" || contentType == "text/csv" || contentType == "text/x-markdown") {
			return true;
		}
		return /\.(?:md|markdown|txt|csv)$/i.test(String(filePath || ""));
	}

	async function preferredMarkdownSourceForItem(reviewer, item) {
		if (!item?.getAttachments) {
			return null;
		}
		let candidates = [];
		for (let attachmentID of item.getAttachments() || []) {
			let attachment = Zotero.Items.get(attachmentID);
			let filePath = await attachmentFilePath(attachment);
			if (!isMarkdownAttachment(attachment, filePath)) {
				continue;
			}
			if (!filePath || (reviewer?._pathExists && !reviewer._pathExists(filePath))) {
				continue;
			}
			let leafName = optionalString(reviewer?._leafName?.(filePath) || attachment?.attachmentFilename || "");
			let title = optionalString(reviewer?._itemField?.(attachment, "title") || leafName || attachment?.key || "");
			let rank = textAttachmentRankForNames([
				title,
				attachment?.attachmentFilename,
				leafName,
				filePath,
			]);
			if (rank <= 0) {
				continue;
			}
			candidates.push({
				attachment,
				attachment_key: optionalString(attachment?.key),
				markdown_path: filePath,
				relative_path: leafName || title,
				title,
				score: rank,
			});
		}
		candidates.sort((left, right) =>
			Number(right.score || 0) - Number(left.score || 0)
				|| String(left.relative_path || "").localeCompare(String(right.relative_path || ""))
				|| String(left.attachment_key || "").localeCompare(String(right.attachment_key || ""))
		);
		return candidates[0] || null;
	}

	function chunkArray(items = [], size = 1) {
		let chunkSize = Math.max(1, Number(size || 0) || 1);
		let out = [];
		for (let index = 0; index < items.length; index += chunkSize) {
			out.push(items.slice(index, index + chunkSize));
		}
		return out;
	}

	async function forEachScopedDocument(reviewer, current, payload = {}, visitor = null, options = {}) {
		let visit = typeof visitor == "function" ? visitor : null;
		if (!visit) {
			return 0;
		}
		let refs = Array.isArray(options?.refs) ? options.refs : await SystematicReviewerWorkflowEmbeddings.scopedItemRefs(
			reviewer,
			current,
			payload,
			{
				batchSize: SystematicReviewerWorkflowEmbeddings.SCOPE_ITEM_REF_BATCH_SIZE || 250,
			}
		);
		let processed = 0;
		for (let batch of chunkArray(
			refs,
			Math.max(1, Number(options?.batchSize || 0) || (SystematicReviewerWorkflowEmbeddings.FULL_TEXT_DOCUMENT_BATCH_SIZE || 10))
		)) {
			let items = Zotero.Items.get(batch.map((entry) => Number(entry?.item_id || 0) || 0).filter(Boolean)) || [];
			let itemsByID = new Map(items.map((item) => [Number(item?.id || 0) || 0, item]));
			for (let ref of batch) {
				processed += 1;
				let item = itemsByID.get(Number(ref?.item_id || 0) || 0) || null;
				if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				let markdownSource = await preferredMarkdownSourceForItem(reviewer, item);
				if (!markdownSource?.attachment_key || !markdownSource.markdown_path) {
					continue;
				}
				let shouldContinue = await visit(Object.assign({}, ref || {}, markdownSource, {
					item_key: optionalString(ref?.item_key || item?.key),
					item,
				}), {
					processed,
					total: refs.length,
				});
				if (shouldContinue === false) {
					return processed;
				}
			}
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		return processed;
	}

	async function scopedDocuments(reviewer, current, payload = {}, options = {}) {
		let documents = [];
		await forEachScopedDocument(reviewer, current, payload, async (entry) => {
			documents.push(entry);
			return true;
		}, options);
		return documents;
	}

	async function countAvailableDocuments(reviewer, current, payload = {}, options = {}) {
		let count = 0;
		await forEachScopedDocument(reviewer, current, payload, async () => {
			count += 1;
			return true;
		}, options);
		return count;
	}

	async function listStoredStatus(reviewer, currentOrContext) {
		let context = currentContext(currentOrContext);
		await SystematicReviewerWorkflowEmbeddings.checkpointProjectDB(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				cv.vector_kind,
				COALESCE(cv.model, '') AS model,
				MAX(cv.dimensions) AS vector_dim,
				COUNT(*) AS vector_count,
				COUNT(DISTINCT dc.item_key) AS item_count,
				MAX(cv.updated_at) AS last_updated
			 FROM chunk_vectors cv
			 JOIN document_chunks dc ON dc.chunk_id = cv.chunk_id
			 WHERE cv.vector_kind = ?
			 GROUP BY cv.vector_kind, COALESCE(cv.model, '')
			 ORDER BY cv.vector_kind ASC, model ASC`,
			[FULL_TEXT_VECTOR_KIND]
		);
		return (rows || []).map((row) => ({
			source_key: FULL_TEXT_SOURCE_KEY,
			source_label: "Full Text",
			vector_column: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "vector_kind") || FULL_TEXT_VECTOR_KIND),
			spec: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "model") || "Full Text"),
			model: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "model") || ""),
			vector_count: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "vector_count") || 0) || 0,
			vector_dim: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "vector_dim") || 0) || 0,
			item_count: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_count") || 0) || 0,
			last_updated: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "last_updated") || ""),
		}));
	}

	async function storageSummary(reviewer, currentOrContext, vectorKind = FULL_TEXT_VECTOR_KIND, model = "") {
		let context = currentContext(currentOrContext);
		await SystematicReviewerWorkflowEmbeddings.checkpointProjectDB(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				COUNT(*) AS total_rows,
				SUM(CASE WHEN vector_kind = ? THEN 1 ELSE 0 END) AS vector_kind_rows,
				SUM(CASE WHEN vector_kind = ? AND COALESCE(model, '') = ? THEN 1 ELSE 0 END) AS matching_rows,
				MAX(CASE WHEN vector_kind = ? THEN length(vector_blob) ELSE 0 END) AS max_blob_bytes
			 FROM chunk_vectors`,
			[
				vectorKind,
				vectorKind,
				String(model || ""),
				vectorKind,
			]
		);
		let row = rows?.[0] || null;
		return {
			total_rows: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "total_rows") || 0) || 0,
			vector_kind_rows: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "vector_kind_rows") || 0) || 0,
			matching_rows: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "matching_rows") || 0) || 0,
			max_blob_bytes: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "max_blob_bytes") || 0) || 0,
		};
	}

	async function existingEmbeddedDocumentsForItemKeys(reviewer, context, itemKeys = [], model = "") {
		let keys = Array.from(new Set((itemKeys || []).map((value) => optionalString(value)).filter(Boolean)));
		if (!keys.length) {
			return new Map();
		}
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				dc.item_key,
				COALESCE(cv.model, '') AS existing_model,
				COUNT(*) AS chunk_count
			 FROM document_chunks dc
			 JOIN chunk_vectors cv ON cv.chunk_id = dc.chunk_id
			 WHERE cv.vector_kind = ?
			   AND (? = '' OR COALESCE(cv.model, '') = ?)
			   AND dc.item_key IN (${keys.map(() => "?").join(", ")})
			 GROUP BY dc.item_key, COALESCE(cv.model, '')
			 ORDER BY dc.item_key ASC`,
			[FULL_TEXT_VECTOR_KIND, String(model || ""), String(model || ""), ...keys]
		);
		let out = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key"));
			if (!itemKey) {
				continue;
			}
			out.set(itemKey, {
				existing_model: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "existing_model") || ""),
				chunk_count: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "chunk_count") || 0) || 0,
			});
		}
		return out;
	}

	async function replaceDocumentEmbeddings(reviewer, context, documentEntry, chunks = [], model = "", options = {}) {
		let db = await reviewer._projectDB(context);
		let itemKey = optionalString(documentEntry?.item_key);
		if (!itemKey) {
			return;
		}
		await db.executeTransaction(async () => {
			await db.queryAsync(
				`DELETE FROM chunk_vectors
				 WHERE vector_kind = ?
				   AND chunk_id IN (
				   	SELECT chunk_id FROM document_chunks WHERE item_key = ?
				   )`,
				[FULL_TEXT_VECTOR_KIND, itemKey]
			);
			await db.queryAsync(
				"DELETE FROM document_chunks WHERE item_key = ?",
				[itemKey]
			);
		});
		let batchSize = typeof SystematicReviewerWorkflowEmbeddings?.normalizeBatchSize == "function"
			? SystematicReviewerWorkflowEmbeddings.normalizeBatchSize(
				options?.batchSize || (SystematicReviewerWorkflowEmbeddings.FULL_TEXT_CHUNK_WRITE_BATCH_SIZE || 25)
			)
			: Math.max(
				1,
				Number(options?.batchSize || 0) || (SystematicReviewerWorkflowEmbeddings.FULL_TEXT_CHUNK_WRITE_BATCH_SIZE || 25)
			);
		for (let batch of chunkArray(chunks || [], batchSize)) {
			let updatedAt = new Date().toISOString();
			await db.executeTransaction(async () => {
				for (let chunk of batch || []) {
					await db.queryAsync(
						`INSERT OR REPLACE INTO document_chunks (
							chunk_id, item_key, attachment_key, relative_path, chunk_index,
							text, page_label, section_label, token_count, start_offset, end_offset, updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							chunk.chunk_id,
							itemKey,
							documentEntry.attachment_key,
							documentEntry.relative_path,
							Number(chunk.chunk_index || 0) || 0,
							chunk.text,
							chunk.page_label || "",
							chunk.section_label || "",
							Number(chunk.token_count || 0) || 0,
							Number(chunk.start_offset || 0) || 0,
							Number(chunk.end_offset || 0) || 0,
							updatedAt,
						]
					);
					await db.queryAsync(
						`INSERT OR REPLACE INTO chunk_vectors (
							chunk_id, vector_kind, vector_blob, dimensions, model, updated_at
						) VALUES (?, ?, ${SystematicReviewerWorkflowEmbeddings.vectorBlobLiteral(chunk.vector)}, ?, ?, ?)`,
						[
							chunk.chunk_id,
							FULL_TEXT_VECTOR_KIND,
							Number(chunk.vector.length || 0) || 0,
							String(model || ""),
							updatedAt,
						]
					);
				}
			});
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
	}

	async function runEmbeddings({ reviewer, current, payload = {}, source = null, clientState = null, state = null }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let activeSource = source || {
			key: FULL_TEXT_SOURCE_KEY,
			label: "Full Text",
			vector_column: FULL_TEXT_VECTOR_KIND,
		};
		let logicalModel = optionalString(clientState?.logicalModel || clientState?.client?.model);
		let batchSize = Math.max(1, Number(clientState?.defaultBatchSize || 32) || 32);
		let resume = payload.resume !== false;
		let normalize = true;
		let existingJobID = optionalString(
			payload?.existing_job_id
			?? payload?.existingJobID
			?? payload?.job_id
			?? payload?.jobID
		);
		if (!existingJobID) {
			return await reviewer._launchWorkflowJob(current, {
				prefix: "embed",
				kind: "manual_embeddings",
				title: `Create embeddings: ${activeSource.label || "Full Text"}`,
				requested_mode: activeSource.key || FULL_TEXT_SOURCE_KEY,
				used_mode: activeSource.key || FULL_TEXT_SOURCE_KEY,
				source_title: `${current.collection?.name || "Collection"} / ${activeSource.label || "Full Text"}`,
				source_path: context.databasePath,
				output_path: context.databasePath,
				metadata: {
					payload: Object.assign({}, payload || {}, {
						source_key: activeSource.key || FULL_TEXT_SOURCE_KEY,
						resume,
					}),
					source_key: activeSource.key || FULL_TEXT_SOURCE_KEY,
					source_label: activeSource.label || "Full Text",
					vector_column: FULL_TEXT_VECTOR_KIND,
					scope: state?.scope || null,
					resume,
				},
				waitForCompletion: waitForJobCompletion(payload, true),
				message: "Full-text embeddings job started. Track progress in Jobs.",
			});
		}
		let refs = await SystematicReviewerWorkflowEmbeddings.scopedItemRefs(reviewer, current, payload, {
			batchSize,
		});
		let totalRows = refs.length;
		let skippedExisting = 0;
		let skippedEmpty = 0;
		let embedded = 0;
		let embeddedChunks = 0;
		let discoveredDocuments = 0;
		let scannedItems = 0;
		let job = { job_id: existingJobID };

		try {
			await SystematicReviewerWorkflowJobs.log(
				reviewer,
					current,
					job.job_id,
					"info",
					`Scanning ${totalRows} scoped items for text-backed full-text documents using ${logicalModel || clientState?.client?.model || ""}.`
				);
			for (let refBatch of chunkArray(refs, batchSize)) {
				let batchItems = Zotero.Items.get(refBatch.map((entry) => Number(entry?.item_id || 0) || 0).filter(Boolean)) || [];
				let itemsByID = new Map(batchItems.map((item) => [Number(item?.id || 0) || 0, item]));
				let documentEntries = [];
				for (let ref of refBatch) {
					let item = itemsByID.get(Number(ref?.item_id || 0) || 0) || null;
					if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
						continue;
					}
					let markdownSource = await preferredMarkdownSourceForItem(reviewer, item);
					if (!markdownSource?.attachment_key || !markdownSource.markdown_path) {
						continue;
					}
					documentEntries.push(Object.assign({}, ref, markdownSource, {
						item_key: optionalString(ref?.item_key || item?.key),
						item,
					}));
				}
				let existingByItem = await existingEmbeddedDocumentsForItemKeys(
					reviewer,
					context,
					documentEntries.map((entry) => entry.item_key),
					logicalModel
				);
					for (let documentEntry of documentEntries) {
						discoveredDocuments += 1;
						let existing = existingByItem.get(String(documentEntry.item_key || ""));
						if (resume && logicalModel && String(existing?.existing_model || "") == logicalModel && Number(existing?.chunk_count || 0) > 0) {
							skippedExisting += 1;
							continue;
						}
						let markdown = await reviewer._readFileText(documentEntry.markdown_path);
						let chunks = chunkMarkdownText(markdown);
						if (!chunks.length) {
							skippedEmpty += 1;
							await replaceDocumentEmbeddings(reviewer, context, documentEntry, [], logicalModel, {
								batchSize,
							});
							continue;
						}
						let embeddedChunksForDocument = [];
						for (let chunkBatch of chunkArray(chunks, batchSize)) {
							let vectors = await SystematicReviewerWorkflowEmbeddings.embedTexts(
								reviewer,
								clientState.client,
							chunkBatch.map((entry) => entry.text)
						);
						for (let batchIndex = 0; batchIndex < chunkBatch.length; batchIndex += 1) {
							let vector = SystematicReviewerWorkflowEmbeddings.normalizeVector(vectors[batchIndex] || [], normalize);
							if (!vector.length) {
								continue;
							}
							let chunk = chunkBatch[batchIndex];
							embeddedChunksForDocument.push(Object.assign({}, chunk, {
								chunk_id: chunkID(documentEntry.item_key, documentEntry.attachment_key, chunk.chunk_index),
								vector,
								}));
							}
						}
						if (!embeddedChunksForDocument.length) {
							skippedEmpty += 1;
							await replaceDocumentEmbeddings(reviewer, context, documentEntry, [], logicalModel, {
								batchSize,
							});
							continue;
						}
						await replaceDocumentEmbeddings(reviewer, context, documentEntry, embeddedChunksForDocument, logicalModel, {
							batchSize,
						});
						embedded += 1;
						embeddedChunks += embeddedChunksForDocument.length;
					}
				scannedItems += refBatch.length;
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					job.job_id,
					scannedItems,
					totalRows,
					`Embedded ${embedded} documents and ${embeddedChunks} chunks after scanning ${scannedItems} / ${totalRows}`
				);
			}

			await SystematicReviewerWorkflowEmbeddings.checkpointProjectDB(reviewer, context);
			let stored = await listStoredStatus(reviewer, context);
			let matchingStatus = stored.find((entry) => entry.vector_column == FULL_TEXT_VECTOR_KIND && entry.model == logicalModel) || null;
			let storage = await storageSummary(reviewer, context, FULL_TEXT_VECTOR_KIND, logicalModel);
			let result = {
				ok: true,
				job_id: job.job_id,
				source_key: FULL_TEXT_SOURCE_KEY,
				source_label: activeSource.label || "Full Text",
				vector_column: FULL_TEXT_VECTOR_KIND,
				model: logicalModel,
				total_items: discoveredDocuments,
				embedded,
				embedded_chunks: embeddedChunks,
				skipped_existing: skippedExisting,
				skipped_empty: skippedEmpty,
				batch_size: batchSize,
				resume,
				normalize,
				stored_status: matchingStatus,
				storage,
				scope: state?.scope || null,
			};
			await SystematicReviewerWorkflowJobs.succeed(reviewer, current, job.job_id, {
				used_mode: logicalModel || FULL_TEXT_SOURCE_KEY,
				output_path: context.databasePath,
				progress_current: discoveredDocuments,
				progress_total: discoveredDocuments,
				metadata: result,
				message: `Stored ${embeddedChunks} full-text chunk embeddings for ${embedded} paper${embedded == 1 ? "" : "s"}.`,
			});
			return result;
		}
		catch (error) {
			await SystematicReviewerWorkflowJobs.fail(reviewer, current, job.job_id, error);
			throw error;
		}
	}

	async function ensureSearchHitSchema(reviewer, context) {
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`CREATE TABLE IF NOT EXISTS semantic_search_hits (
				search_column_key TEXT NOT NULL,
				chunk_column_key TEXT NOT NULL,
				item_key TEXT NOT NULL,
				source_key TEXT NOT NULL DEFAULT '',
				chunk_id TEXT NOT NULL DEFAULT '',
				attachment_key TEXT NOT NULL DEFAULT '',
				relative_path TEXT NOT NULL DEFAULT '',
				page_label TEXT NOT NULL DEFAULT '',
				section_label TEXT NOT NULL DEFAULT '',
				snippet_text TEXT NOT NULL DEFAULT '',
				highlight_text TEXT NOT NULL DEFAULT '',
				score REAL NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (search_column_key, item_key)
			)`
		);
		await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			"CREATE INDEX IF NOT EXISTS idx_semantic_search_hits_chunk_column ON semantic_search_hits(chunk_column_key)"
		);
	}

	function highlightExcerpt(text = "") {
		let source = String(text || "").replace(/\r\n/g, "\n");
		let blocks = source
			.split(/\n\s*\n/g)
			.map((entry) => String(entry || "").trim())
			.filter(Boolean)
			.filter((entry) => !PAGE_BREAK_RE.test(entry));
		for (let block of blocks) {
			let candidate = String(block || "").replace(HEADING_RE, "$2").trim();
			let normalized = normalizeSearchText(candidate);
			if (!normalized) {
				continue;
			}
			return normalized.length > 420 ? normalized.slice(0, 420).trim() : normalized;
		}
		let normalized = normalizeSearchText(source);
		if (!normalized) {
			return "";
		}
		return normalized.length > 420 ? normalized.slice(0, 420).trim() : normalized;
	}

	async function executeStatements(reviewer, context, statements = []) {
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

	async function searchFullText({
		reviewer,
		current,
		payload = {},
		queryVector = [],
		searchName = "",
		scoreColumn = "",
		chunkColumn = "",
		currentModel = "",
		scopedItems = new Map(),
		limit = 25,
		job = null,
	} = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await SystematicReviewerWorkflowScreening.ensureSchema(reviewer, context);
		await ensureSearchHitSchema(reviewer, context);
		await SystematicReviewerWorkflowScreening.upsertColumnDefinition(
			reviewer,
			context,
			scoreColumn,
			searchName,
			"number"
		);
		await SystematicReviewerWorkflowScreening.upsertColumnDefinition(
			reviewer,
			context,
			chunkColumn,
			`${searchName} Chunk`,
			"text"
		);
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			"DELETE FROM screening_column_values WHERE column_key IN (?, ?)",
			[scoreColumn, chunkColumn]
		);
		await SystematicReviewerWorkflowEmbeddings.executeWrite(
			reviewer,
			context,
			"DELETE FROM semantic_search_hits WHERE search_column_key = ? OR chunk_column_key = ?",
			[scoreColumn, chunkColumn]
		);

		let bestByItem = new Map();
		let scannedRows = 0;
		let candidateRows = 0;
		let scoredRows = 0;
		let mismatchedDim = 0;
		let scopedItemKeys = Array.from(scopedItems.keys()).sort((left, right) => left.localeCompare(right));
		for (let offset = 0; offset < scopedItemKeys.length; offset += SEARCH_BATCH_SIZE) {
			let batchKeys = scopedItemKeys.slice(offset, offset + SEARCH_BATCH_SIZE);
			if (!batchKeys.length) {
				continue;
			}
			let placeholders = batchKeys.map(() => "?").join(", ");
			let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`SELECT
					dc.item_key,
					dc.chunk_id,
					dc.attachment_key,
					dc.relative_path,
					dc.chunk_index,
					dc.text,
					dc.page_label,
					dc.section_label,
					cv.vector_blob,
					cv.dimensions
				 FROM document_chunks dc
				 JOIN chunk_vectors cv ON cv.chunk_id = dc.chunk_id
				 WHERE cv.vector_kind = ?
				   AND COALESCE(cv.model, '') = ?
				   AND dc.item_key IN (${placeholders})
				 ORDER BY dc.item_key ASC, dc.chunk_index ASC`,
				[FULL_TEXT_VECTOR_KIND, currentModel, ...batchKeys]
			);
			scannedRows += rows.length;
			for (let row of rows || []) {
				let itemKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key"));
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
				if (!vector.length || vector.length != queryVector.length) {
					mismatchedDim += 1;
					continue;
				}
				let score = 0;
				for (let index = 0; index < vector.length; index += 1) {
					score += Number(queryVector[index] || 0) * Number(vector[index] || 0);
				}
				scoredRows += 1;
				let existing = bestByItem.get(itemKey);
				if (!existing || Number(score) > Number(existing.score || 0)) {
					bestByItem.set(itemKey, {
						item_key: itemKey,
						title: String(record.title || ""),
						abstract_preview: String(record.abstract_note || ""),
						year: String(record.year || ""),
						doi: String(record.doi || ""),
						citation_text: String(record.citation_text || ""),
						citation_token: String(record.citation_token || `@[${itemKey}]`),
						zotero_uri: String(record.zotero_uri || ""),
						score: Number(score),
						chunk_id: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "chunk_id") || ""),
						attachment_key: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "attachment_key") || ""),
						relative_path: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "relative_path") || ""),
						chunk_index: Number(SystematicReviewerWorkflowEmbeddings.rowValue(row, "chunk_index") || 0) || 0,
						chunk_text: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "text") || ""),
						page_label: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "page_label") || ""),
						section_label: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "section_label") || ""),
					});
				}
			}
			if (job?.job_id) {
				await SystematicReviewerWorkflowJobs.progress(
					reviewer,
					current,
					job.job_id,
					Math.min(offset + batchKeys.length, scopedItemKeys.length),
					scopedItemKeys.length,
					`Scored ${scoredRows} chunks after scanning ${scannedRows}`
				);
			}
		}

		let results = Array.from(bestByItem.values()).sort((left, right) =>
			Number(right.score || 0) - Number(left.score || 0)
			|| String(left.title || "").localeCompare(String(right.title || ""))
			|| String(left.item_key || "").localeCompare(String(right.item_key || ""))
		);
		let statements = [];
		let updatedAt = new Date().toISOString();
		for (let result of results) {
			let scoreText = String(Number(result.score || 0).toFixed(8));
			statements.push({
				sql: `INSERT OR REPLACE INTO screening_column_values (
					item_key, column_key, value_text, updated_at
				) VALUES (?, ?, ?, ?)`,
				params: [result.item_key, scoreColumn, scoreText, updatedAt],
			});
			statements.push({
				sql: `INSERT OR REPLACE INTO screening_column_values (
					item_key, column_key, value_text, updated_at
				) VALUES (?, ?, ?, ?)`,
				params: [result.item_key, chunkColumn, result.chunk_text, updatedAt],
			});
			statements.push({
				sql: `INSERT OR REPLACE INTO semantic_search_hits (
					search_column_key, chunk_column_key, item_key, source_key, chunk_id,
					attachment_key, relative_path, page_label, section_label,
					snippet_text, highlight_text, score, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				params: [
					scoreColumn,
					chunkColumn,
					result.item_key,
					FULL_TEXT_SOURCE_KEY,
					result.chunk_id,
					result.attachment_key,
					result.relative_path,
					result.page_label,
					result.section_label,
					result.chunk_text,
					highlightExcerpt(result.chunk_text),
					Number(result.score || 0),
					updatedAt,
				],
			});
		}
		await executeStatements(reviewer, context, statements);
		let limitedResults = limit === null ? results : results.slice(0, Math.max(1, Number(limit || 0) || 1));
		return {
			ok: true,
			score_column: scoreColumn,
			chunk_column: chunkColumn,
			scanned_rows: scannedRows,
			candidate_rows: candidateRows,
			scored_rows: scoredRows,
			flushed_rows: statements.length,
			mismatched_dim: mismatchedDim,
			total_results: results.length,
			results: limitedResults.map((entry) => ({
				item_key: entry.item_key,
				title: entry.title,
				abstract_preview: entry.abstract_preview,
				year: entry.year,
				doi: entry.doi,
				citation_text: entry.citation_text,
				citation_token: entry.citation_token,
				zotero_uri: entry.zotero_uri,
				cosine_score: Number(entry.score || 0),
				best_chunk_text: entry.chunk_text,
				best_chunk_preview: entry.chunk_text,
				chunk_column: chunkColumn,
				attachment_key: entry.attachment_key,
				relative_path: entry.relative_path,
				page_label: entry.page_label,
				section_label: entry.section_label,
			})),
		};
	}

	async function openSearchHit({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		let columnKey = optionalString(payload.column_key || payload.columnKey || payload.chunk_column || payload.chunkColumn || payload.score_column || payload.scoreColumn);
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		if (!columnKey) {
			throw new Error("column_key is required.");
		}
		await ensureSearchHitSchema(reviewer, context);
		let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
			reviewer,
			context,
			`SELECT
				search_column_key,
				chunk_column_key,
				item_key,
				attachment_key,
				highlight_text,
				snippet_text,
				page_label,
				section_label
			 FROM semantic_search_hits
			 WHERE item_key = ?
			   AND (chunk_column_key = ? OR search_column_key = ?)
			 ORDER BY updated_at DESC
			 LIMIT 1`,
			[itemKey, columnKey, columnKey]
		);
		let row = rows?.[0] || null;
		if (!row) {
			throw new Error("No stored full-text semantic hit was found for that screening cell.");
		}
		let attachmentKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "attachment_key"));
		if (!attachmentKey) {
			throw new Error("The stored semantic hit is missing its markdown attachment reference.");
		}
		let highlightText = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "highlight_text"))
			|| optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "snippet_text"));
			let viewerMode = reviewer._openAttachmentTextualViewerByKey
				? await reviewer._openAttachmentTextualViewerByKey({
					libraryID: context.libraryID,
					attachmentKey,
					parentItemKey: itemKey,
					highlightText,
					pdfSearchQuery: highlightText,
					searchQuery: highlightText,
				})
				: "";
			if (!viewerMode && reviewer._openMarkdownViewerTab) {
				await reviewer._openMarkdownViewerTab(null, {
					libraryID: context.libraryID,
					attachmentKey,
					parentItemKey: itemKey,
					highlightText,
					pdfSearchQuery: highlightText,
				});
				viewerMode = "markdown";
			}
			if (!viewerMode) {
				throw new Error("The stored semantic hit attachment could not be opened.");
			}
			return {
				ok: true,
				item_key: itemKey,
				column_key: columnKey,
				attachment_key: attachmentKey,
				mode: viewerMode,
				highlight_text: highlightText,
			page_label: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "page_label") || ""),
			section_label: String(SystematicReviewerWorkflowEmbeddings.rowValue(row, "section_label") || ""),
		};
	}

	return {
		FULL_TEXT_SOURCE_KEY,
		FULL_TEXT_VECTOR_KIND,
		FULL_TEXT_CHUNK_TOKENS,
		FULL_TEXT_CHUNK_OVERLAP_TOKENS,
		chunkMarkdownText,
		preferredMarkdownSourceForItem,
		scopedDocuments,
		countAvailableDocuments,
		listStoredStatus,
		storageSummary,
		runEmbeddings,
		searchFullText,
		openSearchHit,
		ensureSearchHitSchema,
		chunkMarkdownText,
	};
})();
