var SystematicReviewerDocumentSearch = (() => {
	const DEFAULT_DOCUMENT_LIMIT = 5;
	const MAX_DOCUMENT_LIMIT = 5;
	const DEFAULT_CHUNKS_PER_DOCUMENT = 2;
	const MAX_CHUNKS_PER_DOCUMENT = 2;
	const SEARCH_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
	const FTS_MATCH_LIMIT = 2500;
	const SCAN_BATCH_SIZE = 200;
	const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/;
	const PAGE_BREAK_RE = /^\s*<!--\s*sr:page-break\s*-->\s*$/i;
	const PAGE_MARKER_RE = /^\s*<[-]{1,2}page(\d+)[-]{1,2}>\s*$/i;
	const ftsSupportByProject = new Map();

	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function nowISO() {
		return new Date().toISOString();
	}

	function rowValue(row, key = "") {
		if (!row) {
			return "";
		}
		if (SystematicReviewerWorkflowEmbeddings?.rowValue) {
			return SystematicReviewerWorkflowEmbeddings.rowValue(row, key);
		}
		return row[key];
	}

	function normalizeUnicode(value = "") {
		let text = String(value || "")
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
			.replace(/\u2026/g, "...")
			.replace(/\u00A0/g, " ");
		try {
			text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
		}
		catch (_error) {}
		return text;
	}

	function replaceNonTokenCharacters(value = "") {
		let text = String(value || "");
		try {
			return text.replace(/[^\p{L}\p{N}]+/gu, " ");
		}
		catch (_error) {
			return text.replace(/[^A-Za-z0-9]+/g, " ");
		}
	}

	function normalizeForSearch(value = "") {
		return replaceNonTokenCharacters(normalizeUnicode(value).toLowerCase())
			.replace(/\s+/g, " ")
			.trim();
	}

	function tokenize(value = "") {
		let normalized = normalizeForSearch(value);
		if (!normalized) {
			return [];
		}
		let seen = new Set();
		let tokens = [];
		for (let token of normalized.split(/\s+/)) {
			let clean = optionalString(token);
			if (!clean || clean.length < 2 || seen.has(clean)) {
				continue;
			}
			seen.add(clean);
			tokens.push(clean);
		}
		return tokens;
	}

	function normalizeLimit(value, fallback = DEFAULT_DOCUMENT_LIMIT) {
		let parsed = Number(value || 0) || 0;
		if (!parsed || parsed < 1) {
			parsed = fallback;
		}
		return Math.max(1, Math.min(MAX_DOCUMENT_LIMIT, Math.round(parsed)));
	}

	function normalizeChunksPerDocument(value) {
		let parsed = Number(value || 0) || 0;
		if (!parsed || parsed < 1) {
			parsed = DEFAULT_CHUNKS_PER_DOCUMENT;
		}
		return Math.max(1, Math.min(MAX_CHUNKS_PER_DOCUMENT, Math.round(parsed)));
	}

	function searchID() {
		return `find-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}

	async function executeRows(reviewer, context, sql, params = []) {
		if (SystematicReviewerWorkflowEmbeddings?.executeRows) {
			return await SystematicReviewerWorkflowEmbeddings.executeRows(reviewer, context, sql, params);
		}
		let db = await reviewer._projectDB(context);
		return await db.queryAsync(sql, params);
	}

	async function executeWrite(reviewer, context, sql, params = []) {
		if (SystematicReviewerWorkflowEmbeddings?.executeWrite) {
			return await SystematicReviewerWorkflowEmbeddings.executeWrite(reviewer, context, sql, params);
		}
		let db = await reviewer._projectDB(context);
		return await db.queryAsync(sql, params);
	}

	async function ensureSchema(reviewer, context) {
		let db = await reviewer._projectDB(context);
		if (reviewer?._ensureTableColumns) {
			await reviewer._ensureTableColumns(db, "document_chunks", [
				{ name: "start_offset", sql: "start_offset INTEGER NOT NULL DEFAULT 0" },
				{ name: "end_offset", sql: "end_offset INTEGER NOT NULL DEFAULT 0" },
			]);
		}
		else {
			try {
				await db.queryAsync("ALTER TABLE document_chunks ADD COLUMN start_offset INTEGER NOT NULL DEFAULT 0");
			}
			catch (_error) {}
			try {
				await db.queryAsync("ALTER TABLE document_chunks ADD COLUMN end_offset INTEGER NOT NULL DEFAULT 0");
			}
			catch (_error) {}
		}
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS document_chunk_keyword_index (
				chunk_id TEXT PRIMARY KEY,
				item_key TEXT NOT NULL,
				title TEXT NOT NULL DEFAULT '',
				heading_path TEXT NOT NULL DEFAULT '',
				body_normalized TEXT NOT NULL DEFAULT '',
				search_text TEXT NOT NULL DEFAULT '',
				updated_at TEXT NOT NULL
			)
		`);
		await db.queryAsync(`
			CREATE TABLE IF NOT EXISTS document_search_sessions (
				search_id TEXT PRIMARY KEY,
				mode TEXT NOT NULL,
				query TEXT NOT NULL,
				scope_json TEXT NOT NULL DEFAULT '{}',
				result_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		for (let sql of [
			"CREATE INDEX IF NOT EXISTS idx_document_chunk_keyword_item ON document_chunk_keyword_index(item_key)",
			"CREATE INDEX IF NOT EXISTS idx_document_search_sessions_updated ON document_search_sessions(updated_at)",
		]) {
			await db.queryAsync(sql);
		}
		let ftsAvailable = await detectFTS5(reviewer, context);
		if (ftsAvailable) {
			await db.queryAsync(
				"CREATE VIRTUAL TABLE IF NOT EXISTS document_chunk_fts USING fts5(chunk_id UNINDEXED, item_key UNINDEXED, title, heading, body, normalized, tokenize='unicode61 remove_diacritics 2')"
			);
		}
		return {
			keyword_backend: ftsAvailable ? "fts5" : "scan",
		};
	}

	async function detectFTS5(reviewer, context) {
		let projectID = optionalString(context?.projectID || context?.databasePath || "");
		if (projectID && ftsSupportByProject.has(projectID)) {
			return !!ftsSupportByProject.get(projectID);
		}
		let db = await reviewer._projectDB(context);
		let available = false;
		try {
			await db.queryAsync("DROP TABLE IF EXISTS __sr_fts5_probe");
			await db.queryAsync("CREATE VIRTUAL TABLE __sr_fts5_probe USING fts5(value)");
			await db.queryAsync("DROP TABLE IF EXISTS __sr_fts5_probe");
			available = true;
		}
		catch (_error) {
			try {
				await db.queryAsync("DROP TABLE IF EXISTS __sr_fts5_probe");
			}
			catch (_dropError) {}
			available = false;
		}
		if (projectID) {
			ftsSupportByProject.set(projectID, available);
		}
		return available;
	}

	function scopePayload(payload = {}) {
		let out = {};
		for (let key of ["scope", "collection_key", "collectionKey", "collection_name", "collectionName"]) {
			if (optionalString(payload?.[key])) {
				out[key] = payload[key];
			}
		}
		return out;
	}

	function chunkID(itemKey = "", attachmentKey = "", chunkIndex = 0) {
		return `${optionalString(itemKey)}:${optionalString(attachmentKey) || "markdown"}:${Math.max(0, Number(chunkIndex || 0) || 0)}`;
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

	function fileModifiedISO(reviewer, path = "") {
		try {
			let file = reviewer._nsIFile(path);
			if (file?.exists?.()) {
				return new Date(Number(file.lastModifiedTime || 0) || Date.now()).toISOString();
			}
		}
		catch (_error) {}
		return "";
	}

	async function currentChunkState(reviewer, context, itemKeys = []) {
		let keys = Array.from(new Set((itemKeys || []).map(optionalString).filter(Boolean)));
		if (!keys.length) {
			return new Map();
		}
		let out = new Map();
		for (let offset = 0; offset < keys.length; offset += SCAN_BATCH_SIZE) {
			let batch = keys.slice(offset, offset + SCAN_BATCH_SIZE);
			let rows = await executeRows(
				reviewer,
				context,
				`SELECT
					item_key,
					COUNT(*) AS chunk_count,
					MAX(CASE WHEN COALESCE(start_offset, 0) = 0 AND COALESCE(end_offset, 0) = 0 THEN 1 ELSE 0 END) AS has_missing_offsets,
					MAX(COALESCE(updated_at, '')) AS updated_at,
					MAX(COALESCE(attachment_key, '')) AS attachment_key
				 FROM document_chunks
				 WHERE item_key IN (${batch.map(() => "?").join(", ")})
				 GROUP BY item_key`,
				batch
			);
			for (let row of rows || []) {
				out.set(optionalString(rowValue(row, "item_key")), {
					chunk_count: Number(rowValue(row, "chunk_count") || 0) || 0,
					has_missing_offsets: Number(rowValue(row, "has_missing_offsets") || 0) > 0,
					updated_at: optionalString(rowValue(row, "updated_at")),
					attachment_key: optionalString(rowValue(row, "attachment_key")),
				});
			}
		}
		return out;
	}

	async function scopedRefs(reviewer, current, payload = {}) {
		return await SystematicReviewerWorkflowEmbeddings.scopedItemRefs(reviewer, current, scopePayload(payload), {
			batchSize: SystematicReviewerWorkflowEmbeddings.SCOPE_ITEM_REF_BATCH_SIZE || 250,
		});
	}

	async function loadRecords(reviewer, current, payload = {}) {
		let rows = await SystematicReviewerWorkflowEmbeddings.projectItemRows(reviewer, current, scopePayload(payload), {
			batchSize: SystematicReviewerWorkflowEmbeddings.SCOPE_ITEM_REF_BATCH_SIZE || 250,
		});
		let out = new Map();
		for (let row of rows || []) {
			let itemKey = optionalString(row?.item_key);
			if (!itemKey) {
				continue;
			}
			out.set(itemKey, row);
		}
		return out;
	}

	async function ensureDocumentChunks(reviewer, current, payload = {}) {
		let context = current?.context;
		await ensureSchema(reviewer, context);
		let refs = await scopedRefs(reviewer, current, payload);
		let itemKeys = refs.map((entry) => optionalString(entry?.item_key)).filter(Boolean);
		let existing = await currentChunkState(reviewer, context, itemKeys);
		let needed = [];
		for (let ref of refs || []) {
			let itemKey = optionalString(ref?.item_key);
			let state = existing.get(itemKey) || null;
			if (!itemKey || (state?.chunk_count && !state?.has_missing_offsets)) {
				continue;
			}
			needed.push(ref);
		}
		if (!needed.length) {
			return {
				scoped_item_count: refs.length,
				indexed_item_count: existing.size,
				refreshed_item_count: 0,
			};
		}
		let refreshed = 0;
		for (let batchRefs of chunkArray(needed, 20)) {
			let items = Zotero.Items.get(batchRefs.map((entry) => Number(entry?.item_id || 0) || 0).filter(Boolean)) || [];
			for (let item of items || []) {
				let itemKey = optionalString(item?.key);
				if (!itemKey) {
					continue;
				}
				let source = await SystematicReviewerWorkflowRAG.preferredMarkdownSourceForItem(reviewer, item);
				if (!source?.markdown_path || !source?.attachment_key) {
					continue;
				}
				let markdown = await reviewer._readFileText(source.markdown_path).catch(() => "");
				let chunks = SystematicReviewerWorkflowRAG.chunkMarkdownText
					? SystematicReviewerWorkflowRAG.chunkMarkdownText(markdown)
					: [];
				let updatedAt = nowISO();
				let db = await reviewer._projectDB(context);
				await db.executeTransaction(async () => {
					await db.queryAsync("DELETE FROM document_chunks WHERE item_key = ?", [itemKey]);
					for (let chunk of chunks || []) {
						await db.queryAsync(
							`INSERT OR REPLACE INTO document_chunks (
								chunk_id, item_key, attachment_key, relative_path, chunk_index,
								text, page_label, section_label, token_count, start_offset, end_offset, updated_at
							) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
							[
								chunkID(itemKey, source.attachment_key, chunk.chunk_index),
								itemKey,
								source.attachment_key,
								source.relative_path || reviewer._leafName?.(source.markdown_path) || "",
								Number(chunk.chunk_index || 0) || 0,
								String(chunk.text || ""),
								String(chunk.page_label || ""),
								String(chunk.section_label || ""),
								Number(chunk.token_count || 0) || 0,
								Number(chunk.start_offset || 0) || 0,
								Number(chunk.end_offset || 0) || 0,
								updatedAt,
							]
						);
					}
				});
				refreshed += 1;
			}
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		return {
			scoped_item_count: refs.length,
			indexed_item_count: existing.size + refreshed,
			refreshed_item_count: refreshed,
		};
	}

	function chunkArray(items = [], size = 1) {
		let chunkSize = Math.max(1, Number(size || 0) || 1);
		let out = [];
		for (let index = 0; index < items.length; index += chunkSize) {
			out.push(items.slice(index, index + chunkSize));
		}
		return out;
	}

	async function keywordIndexState(reviewer, context) {
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT
				(SELECT COUNT(*) FROM document_chunks) AS chunk_count,
				(SELECT COUNT(*) FROM document_chunk_keyword_index) AS keyword_count,
				(SELECT MAX(COALESCE(updated_at, '')) FROM document_chunks) AS chunk_updated_at,
				(SELECT MAX(COALESCE(updated_at, '')) FROM document_chunk_keyword_index) AS keyword_updated_at`
		);
		let row = rows?.[0] || null;
		return {
			chunk_count: Number(rowValue(row, "chunk_count") || 0) || 0,
			keyword_count: Number(rowValue(row, "keyword_count") || 0) || 0,
			chunk_updated_at: optionalString(rowValue(row, "chunk_updated_at")),
			keyword_updated_at: optionalString(rowValue(row, "keyword_updated_at")),
		};
	}

	function needsKeywordRebuild(state = {}) {
		if (Number(state.chunk_count || 0) != Number(state.keyword_count || 0)) {
			return true;
		}
		if (optionalString(state.chunk_updated_at) && optionalString(state.chunk_updated_at) > optionalString(state.keyword_updated_at)) {
			return true;
		}
		return false;
	}

	async function rebuildKeywordIndex(reviewer, context, recordsByKey = null) {
		let ftsAvailable = await detectFTS5(reviewer, context);
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT
				dc.chunk_id,
				dc.item_key,
				dc.text,
				dc.section_label,
				COALESCE(ii.title, '') AS title
			 FROM document_chunks dc
			 LEFT JOIN item_identities ii ON ii.item_key = dc.item_key
			 ORDER BY dc.item_key ASC, dc.chunk_index ASC`
		);
		let db = await reviewer._projectDB(context);
		let updatedAt = nowISO();
		await db.executeTransaction(async () => {
			await db.queryAsync("DELETE FROM document_chunk_keyword_index");
			if (ftsAvailable) {
				await db.queryAsync("DELETE FROM document_chunk_fts");
			}
			for (let row of rows || []) {
				let chunkIDValue = optionalString(rowValue(row, "chunk_id"));
				if (!chunkIDValue) {
					continue;
				}
				let itemKey = optionalString(rowValue(row, "item_key"));
				let record = recordsByKey?.get?.(itemKey) || {};
				let title = optionalString(rowValue(row, "title")) || optionalString(record?.title);
				let heading = optionalString(rowValue(row, "section_label"));
				let body = String(rowValue(row, "text") || "");
				let normalized = normalizeForSearch([title, heading, body].join(" "));
				await db.queryAsync(
					`INSERT OR REPLACE INTO document_chunk_keyword_index (
						chunk_id, item_key, title, heading_path, body_normalized, search_text, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[
						chunkIDValue,
						itemKey,
						title,
						heading,
						normalizeForSearch(body),
						normalized,
						updatedAt,
					]
				);
				if (ftsAvailable) {
					await db.queryAsync(
						`INSERT INTO document_chunk_fts (
							chunk_id, item_key, title, heading, body, normalized
						) VALUES (?, ?, ?, ?, ?, ?)`,
						[
							chunkIDValue,
							itemKey,
							title,
							heading,
							body,
							normalized,
						]
					);
				}
			}
		});
		return {
			keyword_backend: ftsAvailable ? "fts5" : "scan",
			indexed_chunks: rows.length,
		};
	}

	async function ensureKeywordIndex(reviewer, current, payload = {}, recordsByKey = null) {
		let context = current?.context;
		await ensureDocumentChunks(reviewer, current, payload);
		let schema = await ensureSchema(reviewer, context);
		let state = await keywordIndexState(reviewer, context);
		if (needsKeywordRebuild(state)) {
			return await rebuildKeywordIndex(reviewer, context, recordsByKey);
		}
		return {
			keyword_backend: schema.keyword_backend,
			indexed_chunks: state.keyword_count,
		};
	}

	function escapeFTS5Term(term = "") {
		return `"${String(term || "").replace(/"/g, '""')}"`;
	}

	function ftsQuery(tokens = [], operator = "AND") {
		let op = String(operator || "AND").toUpperCase() == "OR" ? " OR " : " AND ";
		return (tokens || []).map(escapeFTS5Term).filter(Boolean).join(op);
	}

	function tokenPositions(normalized = "", token = "") {
		let parts = String(normalized || "").split(/\s+/);
		let out = [];
		for (let index = 0; index < parts.length; index += 1) {
			if (parts[index] == token) {
				out.push(index);
			}
		}
		return out;
	}

	function proximityBonus(normalized = "", tokens = []) {
		let positions = [];
		for (let token of tokens || []) {
			let tokenPositionsValue = tokenPositions(normalized, token);
			if (!tokenPositionsValue.length) {
				return 0;
			}
			positions.push(tokenPositionsValue[0]);
		}
		let min = Math.min(...positions);
		let max = Math.max(...positions);
		let span = Math.max(1, max - min + 1);
		return Math.max(0, 10 - span);
	}

	function keywordBoostScore(entry = {}, query = "", tokens = []) {
		let body = normalizeForSearch(entry.text || entry.body || "");
		let title = normalizeForSearch(entry.title || "");
		let heading = normalizeForSearch(entry.heading_path || entry.section_label || "");
		let queryNorm = normalizeForSearch(query);
		let score = 0;
		let presentInBody = 0;
		for (let token of tokens || []) {
			if (body.includes(token)) {
				presentInBody += 1;
				score += 1.5;
			}
			if (title.includes(token)) {
				score += 8;
			}
			if (heading.includes(token)) {
				score += 5;
			}
		}
		if (tokens.length && presentInBody == tokens.length) {
			score += 10;
		}
		if (queryNorm && body.includes(queryNorm)) {
			score += 12;
		}
		if (queryNorm && title.includes(queryNorm)) {
			score += 16;
		}
		score += proximityBonus(body, tokens);
		return score;
	}

	async function fetchChunkRows(reviewer, context, chunkIDs = []) {
		let ids = Array.from(new Set((chunkIDs || []).map(optionalString).filter(Boolean)));
		if (!ids.length) {
			return new Map();
		}
		let out = new Map();
		for (let offset = 0; offset < ids.length; offset += SCAN_BATCH_SIZE) {
			let batch = ids.slice(offset, offset + SCAN_BATCH_SIZE);
			let rows = await executeRows(
				reviewer,
				context,
				`SELECT
					dc.chunk_id,
					dc.item_key,
					dc.attachment_key,
					dc.relative_path,
					dc.chunk_index,
					dc.text,
					dc.page_label,
					dc.section_label,
					COALESCE(dc.start_offset, 0) AS start_offset,
					COALESCE(dc.end_offset, 0) AS end_offset,
					COALESCE(ii.title, '') AS title
				 FROM document_chunks dc
				 LEFT JOIN item_identities ii ON ii.item_key = dc.item_key
				 WHERE dc.chunk_id IN (${batch.map(() => "?").join(", ")})`,
				batch
			);
			for (let row of rows || []) {
				out.set(optionalString(rowValue(row, "chunk_id")), row);
			}
		}
		return out;
	}

	async function keywordSearchFTS(reviewer, context, query = "", tokens = [], scopedKeys = new Set()) {
		let candidates = [];
		for (let operator of ["AND", "OR"]) {
			let matchQuery = ftsQuery(tokens, operator);
			if (!matchQuery) {
				return [];
			}
			let rows = await executeRows(
				reviewer,
				context,
				`SELECT chunk_id, item_key, bm25(document_chunk_fts) AS bm25_score
				 FROM document_chunk_fts
				 WHERE document_chunk_fts MATCH ?
				 ORDER BY bm25_score ASC
				 LIMIT ?`,
				[matchQuery, FTS_MATCH_LIMIT]
			).catch(() => []);
			for (let row of rows || []) {
				let itemKey = optionalString(rowValue(row, "item_key"));
				if (scopedKeys.size && !scopedKeys.has(itemKey)) {
					continue;
				}
				candidates.push({
					chunk_id: optionalString(rowValue(row, "chunk_id")),
					item_key: itemKey,
					base_score: Math.max(0, 0 - Number(rowValue(row, "bm25_score") || 0)),
				});
			}
			if (candidates.length) {
				break;
			}
		}
		let rowsByID = await fetchChunkRows(reviewer, context, candidates.map((entry) => entry.chunk_id));
		return candidates.map((candidate) => {
			let row = rowsByID.get(candidate.chunk_id) || null;
			if (!row) {
				return null;
			}
			return chunkCandidateFromRow(row, query, tokens, candidate.base_score);
		}).filter(Boolean);
	}

	async function keywordSearchScan(reviewer, context, query = "", tokens = [], scopedKeys = new Set()) {
		let itemKeys = Array.from(scopedKeys);
		if (!itemKeys.length) {
			return [];
		}
		let out = [];
		for (let offset = 0; offset < itemKeys.length; offset += SCAN_BATCH_SIZE) {
			let batch = itemKeys.slice(offset, offset + SCAN_BATCH_SIZE);
			let rows = await executeRows(
				reviewer,
				context,
				`SELECT
					dc.chunk_id,
					dc.item_key,
					dc.attachment_key,
					dc.relative_path,
					dc.chunk_index,
					dc.text,
					dc.page_label,
					dc.section_label,
					COALESCE(dc.start_offset, 0) AS start_offset,
					COALESCE(dc.end_offset, 0) AS end_offset,
					COALESCE(ii.title, '') AS title
				 FROM document_chunks dc
				 LEFT JOIN item_identities ii ON ii.item_key = dc.item_key
				 WHERE dc.item_key IN (${batch.map(() => "?").join(", ")})
				 ORDER BY dc.item_key ASC, dc.chunk_index ASC`,
				batch
			);
			for (let row of rows || []) {
				let candidate = chunkCandidateFromRow(row, query, tokens, 0);
				if (Number(candidate?.score || 0) > 0) {
					out.push(candidate);
				}
			}
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		return out;
	}

	function chunkCandidateFromRow(row, query = "", tokens = [], baseScore = 0) {
		let entry = {
			chunk_id: optionalString(rowValue(row, "chunk_id")),
			item_key: optionalString(rowValue(row, "item_key")),
			attachment_key: optionalString(rowValue(row, "attachment_key")),
			relative_path: optionalString(rowValue(row, "relative_path")),
			chunk_index: Number(rowValue(row, "chunk_index") || 0) || 0,
			text: String(rowValue(row, "text") || ""),
			page_label: optionalString(rowValue(row, "page_label")),
			section_label: optionalString(rowValue(row, "section_label")),
			start_offset: Number(rowValue(row, "start_offset") || 0) || 0,
			end_offset: Number(rowValue(row, "end_offset") || 0) || 0,
			title: optionalString(rowValue(row, "title")),
		};
		entry.score = Number(baseScore || 0) + keywordBoostScore(entry, query, tokens);
		return entry;
	}

	async function keywordFind(reviewer, current, payload = {}, recordsByKey = new Map(), refs = []) {
		let context = current?.context;
		let query = optionalString(payload.query);
		let tokens = tokenize(query);
		if (!query || !tokens.length) {
			throw new Error("Keyword query is required.");
		}
		let scopedKeys = new Set((refs || []).map((entry) => optionalString(entry?.item_key)).filter(Boolean));
		let indexState = await ensureKeywordIndex(reviewer, current, payload, recordsByKey);
		let candidates = [];
		if (indexState.keyword_backend == "fts5") {
			candidates = await keywordSearchFTS(reviewer, context, query, tokens, scopedKeys);
		}
		if (!candidates.length) {
			candidates = await keywordSearchScan(reviewer, context, query, tokens, scopedKeys);
			indexState.keyword_backend = indexState.keyword_backend == "fts5" ? "fts5" : "scan";
		}
		return {
			candidates,
			keyword_backend: indexState.keyword_backend,
			indexed_chunks: Number(indexState.indexed_chunks || 0) || 0,
		};
	}

	async function semanticFind(reviewer, current, payload = {}, refs = []) {
		let context = current?.context;
		let query = optionalString(payload.query);
		if (!query) {
			throw new Error("Semantic query is required.");
		}
		await ensureDocumentChunks(reviewer, current, payload);
		let availability = await semanticAvailability(reviewer, current, refs);
		if (!availability.embeddings_model_configured) {
			throw new Error(availability.semantic_unavailable_reason || "Configure an embeddings model before using Semantic Find Arguments. Keyword search works without embeddings.");
		}
		if (!availability.semantic_available) {
			throw new Error(availability.semantic_unavailable_reason || "Run full-text embeddings first, or ask the agent to run full-text embeddings first, to use Semantic Find Arguments. Keyword search works without this.");
		}
		let clientState = await SystematicReviewerWorkflowEmbeddings.resolveEmbeddingsClient(reviewer);
		let currentModel = optionalString(clientState.logicalModel || availability.current_embeddings_model || clientState.client?.model);
		let queryVector = SystematicReviewerWorkflowEmbeddings.normalizeVector(
			(await SystematicReviewerWorkflowEmbeddings.embedTexts(reviewer, clientState.client, [query]))[0] || [],
			true
		);
		let scopedKeys = (refs || []).map((entry) => optionalString(entry?.item_key)).filter(Boolean).sort((a, b) => a.localeCompare(b));
		let candidates = [];
		for (let offset = 0; offset < scopedKeys.length; offset += SCAN_BATCH_SIZE) {
			let batch = scopedKeys.slice(offset, offset + SCAN_BATCH_SIZE);
			if (!batch.length) {
				continue;
			}
			let rows = await executeRows(
				reviewer,
				context,
				`SELECT
					dc.chunk_id,
					dc.item_key,
					dc.attachment_key,
					dc.relative_path,
					dc.chunk_index,
					dc.text,
					dc.page_label,
					dc.section_label,
					COALESCE(dc.start_offset, 0) AS start_offset,
					COALESCE(dc.end_offset, 0) AS end_offset,
					COALESCE(ii.title, '') AS title,
					cv.vector_blob,
					cv.dimensions
				 FROM document_chunks dc
				 JOIN chunk_vectors cv ON cv.chunk_id = dc.chunk_id
				 LEFT JOIN item_identities ii ON ii.item_key = dc.item_key
				 WHERE cv.vector_kind = ?
				   AND COALESCE(cv.model, '') = ?
				   AND dc.item_key IN (${batch.map(() => "?").join(", ")})
				 ORDER BY dc.item_key ASC, dc.chunk_index ASC`,
				[SystematicReviewerWorkflowRAG.FULL_TEXT_VECTOR_KIND, currentModel, ...batch]
			);
			for (let row of rows || []) {
				let vector = SystematicReviewerWorkflowEmbeddings.normalizeVector(
					SystematicReviewerWorkflowEmbeddings.blobToVector(rowValue(row, "vector_blob")),
					true
				);
				if (!vector.length || vector.length != queryVector.length) {
					continue;
				}
				let score = 0;
				for (let index = 0; index < vector.length; index += 1) {
					score += Number(queryVector[index] || 0) * Number(vector[index] || 0);
				}
				let candidate = chunkCandidateFromRow(row, query, tokenize(query), 0);
				candidate.score = Number(score || 0);
				candidates.push(candidate);
			}
			if (typeof Zotero?.Promise?.delay == "function") {
				await Zotero.Promise.delay(0);
			}
		}
		return {
			candidates,
			model: currentModel,
		};
	}

	async function scopedFullTextVectorCount(reviewer, context, itemKeys = [], model = "") {
		let keys = Array.from(new Set((itemKeys || []).map(optionalString).filter(Boolean)));
		let cleanModel = optionalString(model);
		if (!keys.length || !cleanModel) {
			return 0;
		}
		let total = 0;
		for (let offset = 0; offset < keys.length; offset += SCAN_BATCH_SIZE) {
			let batch = keys.slice(offset, offset + SCAN_BATCH_SIZE);
			let rows = await executeRows(
				reviewer,
				context,
				`SELECT COUNT(*) AS count
				 FROM document_chunks dc
				 JOIN chunk_vectors cv ON cv.chunk_id = dc.chunk_id
				 WHERE cv.vector_kind = ?
				   AND COALESCE(cv.model, '') = ?
				   AND dc.item_key IN (${batch.map(() => "?").join(", ")})`,
				[SystematicReviewerWorkflowRAG.FULL_TEXT_VECTOR_KIND, cleanModel, ...batch]
			).catch(() => []);
			total += Number(rowValue(rows?.[0], "count") || 0) || 0;
		}
		return total;
	}

	async function semanticAvailability(reviewer, current, refs = []) {
		let currentModel = "";
		try {
			let modelResult = await SystematicReviewerWorkflowEmbeddings.currentEmbeddingsModel(reviewer);
			currentModel = optionalString(modelResult?.model || modelResult);
		}
		catch (_error) {
			currentModel = "";
		}
		let stored = [];
		try {
			stored = await SystematicReviewerWorkflowRAG.listStoredStatus(reviewer, current);
		}
		catch (_error) {
			stored = [];
		}
		let matching = currentModel
			? (stored || []).find((entry) =>
				optionalString(entry?.model) == currentModel
				&& optionalString(entry?.vector_column) == SystematicReviewerWorkflowRAG.FULL_TEXT_VECTOR_KIND
			) || null
			: null;
		let embeddingsConfigured = !!currentModel;
		let scopedVectorCount = embeddingsConfigured
			? await scopedFullTextVectorCount(
				reviewer,
				current?.context,
				(refs || []).map((entry) => optionalString(entry?.item_key)).filter(Boolean),
				currentModel
			)
			: 0;
		let semanticAvailable = !!(embeddingsConfigured && matching && scopedVectorCount > 0);
		let reason = "";
		if (!embeddingsConfigured) {
			reason = "Configure an embeddings model before using Semantic Find Arguments. Keyword search works without embeddings.";
		}
		else if (!semanticAvailable) {
			reason = "Run full-text embeddings first, or ask the agent to run full-text embeddings first, to use Semantic Find Arguments. Keyword search works without this.";
		}
		return {
			embeddings_model_configured: embeddingsConfigured,
			current_embeddings_model: currentModel,
			semantic_available: semanticAvailable,
			semantic_unavailable_reason: reason,
			semantic_full_text_vector_count: scopedVectorCount,
			semantic_project_full_text_vector_count: Number(matching?.vector_count || matching?.chunk_count || 0) || 0,
			semantic_full_text_vector_status: matching || null,
			semantic_full_text_vectors: stored,
		};
	}

	function headingMarkers(markdown = "") {
		let source = String(markdown || "").replace(/\r\n/g, "\n");
		let markers = [];
		let stack = [];
		let offset = 0;
		let page = 1;
		for (let line of source.split("\n")) {
			let trimmed = String(line || "").trim();
			let pageMatch = trimmed.match(PAGE_MARKER_RE);
			if (pageMatch) {
				page = Math.max(1, Number(pageMatch[1]) || page || 1);
			}
			else if (PAGE_BREAK_RE.test(trimmed)) {
				page += 1;
			}
			let match = trimmed.match(HEADING_RE);
			if (match) {
				let level = Math.min(6, String(match[1] || "").length);
				stack[level - 1] = optionalString(match[2]);
				stack.length = level;
				markers.push({
					offset,
					page_label: `Page ${page}`,
					path: stack.slice(),
				});
			}
			offset += line.length + 1;
		}
		return markers;
	}

	function pageLabelAtOffset(markdown = "", offset = 0, fallback = "") {
		let source = String(markdown || "").replace(/\r\n/g, "\n");
		let target = Math.max(0, Number(offset || 0) || 0);
		let page = 1;
		let cursor = 0;
		for (let line of source.split("\n")) {
			if (cursor > target) {
				break;
			}
			let trimmed = String(line || "").trim();
			let pageMatch = trimmed.match(PAGE_MARKER_RE);
			if (pageMatch) {
				page = Math.max(1, Number(pageMatch[1]) || page || 1);
			}
			else if (PAGE_BREAK_RE.test(trimmed)) {
				page += 1;
			}
			cursor += line.length + 1;
		}
		return page > 0 ? `Page ${page}` : optionalString(fallback);
	}

	function headingContext(markers = [], offset = 0, fallback = "") {
		let current = [];
		let next = [];
		for (let marker of markers || []) {
			if (Number(marker.offset || 0) <= Number(offset || 0)) {
				current = Array.isArray(marker.path) ? marker.path.slice() : [];
				continue;
			}
			next = Array.isArray(marker.path) ? marker.path.slice() : [];
			break;
		}
		if (!current.length && fallback) {
			current = [fallback];
		}
		return {
			heading_path: current,
			next_heading_path: next,
		};
	}

	function chunkDisplayText(text = "") {
		return String(text || "")
			.replace(PAGE_MARKER_RE, " ")
			.replace(/<[-]{1,2}page\d+[-]{1,2}>/gi, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function excerptWindow(text = "", query = "", maxChars = 420) {
		let source = chunkDisplayText(text);
		if (source.length <= maxChars) {
			return source;
		}
		let tokens = tokenize(query);
		let lower = normalizeUnicode(source).toLowerCase();
		let index = -1;
		for (let token of tokens) {
			index = lower.indexOf(token.toLowerCase());
			if (index >= 0) {
				break;
			}
		}
		if (index < 0) {
			return `${source.slice(0, maxChars - 1).trim()}…`;
		}
		let start = Math.max(0, index - Math.floor(maxChars / 3));
		let end = Math.min(source.length, start + maxChars);
		if (end - start < maxChars) {
			start = Math.max(0, end - maxChars);
		}
		return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${end < source.length ? "…" : ""}`;
	}

	function highlightMatchIndex(text = "", query = "") {
		let source = String(text || "").replace(/\s+/g, " ").trim();
		if (!source) {
			return -1;
		}
		let tokens = tokenize(query).filter((token) => String(token || "").length >= 3);
		let lower = normalizeUnicode(source).toLowerCase();
		for (let token of tokens) {
			let index = lower.indexOf(String(token || "").toLowerCase());
			if (index >= 0) {
				return index;
			}
		}
		return -1;
	}

	function highlightWindow(text = "", query = "", maxChars = 140) {
		let source = chunkDisplayText(text);
		if (!source) {
			return "";
		}
		let index = highlightMatchIndex(source, query);
		if (index < 0) {
			return source.slice(0, Math.min(source.length, maxChars)).trim();
		}
		let start = Math.max(0, index - Math.floor(maxChars / 4));
		let end = Math.min(source.length, start + maxChars);
		if (end - start < maxChars) {
			start = Math.max(0, end - maxChars);
		}
		return source.slice(start, end).trim();
	}

	async function enrichCandidate(reviewer, context, candidate = {}, query = "", record = {}) {
		let markdownPath = "";
		let markdown = "";
		let markers = [];
		try {
			let attachment = Zotero.Items.getByLibraryAndKey(context.libraryID, candidate.attachment_key);
			markdownPath = await attachmentFilePath(attachment);
			if (markdownPath) {
				markdown = await reviewer._readFileText(markdownPath).catch(() => "");
				markers = headingMarkers(markdown);
			}
		}
		catch (_error) {}
		let heading = headingContext(markers, candidate.start_offset, candidate.section_label);
		let highlightIndex = highlightMatchIndex(candidate.text, query);
		let highlightOffset = Number(candidate.start_offset || 0) + Math.max(0, Number(highlightIndex || 0) || 0);
		let pageLabel = markdownPath
			? pageLabelAtOffset(markdown, highlightOffset, candidate.page_label)
			: optionalString(candidate.page_label);
		heading = headingContext(markers, highlightOffset, candidate.section_label);
		let excerpt = excerptWindow(candidate.text, query, 360);
		let longExcerpt = excerptWindow(candidate.text, query, 1100);
		return {
			chunk_id: candidate.chunk_id,
			chunk_index: Number(candidate.chunk_index || 0) || 0,
			score: Number(candidate.score || 0),
			snippet: excerpt,
			excerpt,
			long_excerpt: longExcerpt,
			highlight_text: highlightWindow(candidate.text, query, 140),
			page_label: pageLabel,
			section_label: optionalString(candidate.section_label),
			heading_path: heading.heading_path,
			next_heading_path: heading.next_heading_path,
			attachment_key: optionalString(candidate.attachment_key),
			relative_path: optionalString(candidate.relative_path),
			markdown_path: markdownPath,
			start_offset: Number(candidate.start_offset || 0) || 0,
			end_offset: Number(candidate.end_offset || 0) || 0,
		};
	}

	async function groupResults(reviewer, current, candidates = [], recordsByKey = new Map(), payload = {}) {
		let query = optionalString(payload.query);
		let limit = normalizeLimit(payload.limit);
		let chunksPerDocument = normalizeChunksPerDocument(payload.chunks_per_document ?? payload.chunksPerDocument);
		let byItem = new Map();
		for (let candidate of candidates || []) {
			let itemKey = optionalString(candidate.item_key);
			if (!itemKey) {
				continue;
			}
			if (!byItem.has(itemKey)) {
				byItem.set(itemKey, {
					item_key: itemKey,
					score: Number(candidate.score || 0),
					candidates: [],
				});
			}
			let entry = byItem.get(itemKey);
			entry.score = Math.max(Number(entry.score || 0), Number(candidate.score || 0));
			entry.candidates.push(candidate);
		}
		let rankedDocuments = Array.from(byItem.values()).sort((left, right) =>
			Number(right.score || 0) - Number(left.score || 0)
			|| optionalString(recordsByKey.get(left.item_key)?.title).localeCompare(optionalString(recordsByKey.get(right.item_key)?.title))
			|| left.item_key.localeCompare(right.item_key)
		);
		let documents = [];
		for (let doc of rankedDocuments) {
			let record = recordsByKey.get(doc.item_key) || {};
			let chunks = doc.candidates
				.slice()
				.sort((left, right) =>
					Number(right.score || 0) - Number(left.score || 0)
					|| Number(left.chunk_index || 0) - Number(right.chunk_index || 0)
				)
				.slice(0, chunksPerDocument);
			let enriched = [];
			for (let chunk of chunks) {
				enriched.push(await enrichCandidate(reviewer, current.context, chunk, query, record));
			}
			documents.push({
				item_key: doc.item_key,
				citation_token: optionalString(record?.citation_token) || `@[${doc.item_key}]`,
				citation_text: optionalString(record?.citation_text),
				title: optionalString(record?.title) || "Untitled",
				year: optionalString(record?.year),
				doi: optionalString(record?.doi),
				zotero_uri: optionalString(record?.zotero_uri),
				score: Number(doc.score || 0),
				chunks: enriched,
			});
		}
		return {
			all_documents: documents,
			page_documents: documents.slice(0, limit),
			limit,
			chunks_per_document: chunksPerDocument,
		};
	}

	function breadcrumbForChunk(chunk = {}) {
		let heading = Array.isArray(chunk.heading_path) && chunk.heading_path.length
			? chunk.heading_path.join(" > ")
			: optionalString(chunk.section_label);
		return [
			optionalString(chunk.relative_path || chunk.markdown_path),
			optionalString(chunk.page_label),
			heading,
		].filter(Boolean).join(" | ");
	}

	function buildReplyMarkdown(result = {}, documents = []) {
		let lines = [
			`Find Arguments (${String(result.mode || "keyword")}): ${String(result.query || "").trim()}`,
			"",
		];
		if (!documents.length) {
			lines.push("No matching full-text chunks were found in the selected project scope.");
			return lines.join("\n").trim();
		}
		for (let [index, doc] of documents.entries()) {
			lines.push(`${index + 1}. ${doc.citation_token} ${doc.title}`);
			for (let chunk of doc.chunks || []) {
				let crumb = breadcrumbForChunk(chunk);
				lines.push(`   ${chunk.excerpt}`);
				if (crumb) {
					lines.push(`   ${crumb}`);
				}
			}
			lines.push("");
		}
		if (result.has_more) {
			lines.push(`More results are available. Use find_next with search_id ${result.search_id}.`);
		}
		return lines.join("\n").trim();
	}

	async function saveSearchSession(reviewer, context, result = {}) {
		let id = optionalString(result.search_id) || searchID();
		let now = nowISO();
		await executeWrite(
			reviewer,
			context,
			`INSERT OR REPLACE INTO document_search_sessions (
				search_id, mode, query, scope_json, result_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM document_search_sessions WHERE search_id = ?), ?), ?)`,
			[
				id,
				optionalString(result.mode),
				optionalString(result.query),
				JSON.stringify(result.scope || {}),
				JSON.stringify(result),
				id,
				now,
				now,
			]
		);
		await executeWrite(
			reviewer,
			context,
			"DELETE FROM document_search_sessions WHERE updated_at < ?",
			[new Date(Date.now() - SEARCH_SESSION_TTL_MS).toISOString()]
		).catch(() => {});
		return id;
	}

	async function loadSearchSession(reviewer, context, searchIDValue = "") {
		let rows = await executeRows(
			reviewer,
			context,
			`SELECT result_json
			 FROM document_search_sessions
			 WHERE search_id = ?
			 LIMIT 1`,
			[searchIDValue]
		);
		let raw = optionalString(rowValue(rows?.[0], "result_json"));
		if (!raw) {
			return null;
		}
		try {
			return JSON.parse(raw);
		}
		catch (_error) {
			return null;
		}
	}

	function pageResult(fullResult = {}, offset = 0, limit = DEFAULT_DOCUMENT_LIMIT) {
		let all = Array.isArray(fullResult.all_results) ? fullResult.all_results : [];
		let safeOffset = Math.max(0, Number(offset || 0) || 0);
		let safeLimit = normalizeLimit(limit);
		let page = all.slice(safeOffset, safeOffset + safeLimit);
		let nextOffset = safeOffset + page.length;
		let result = Object.assign({}, fullResult, {
			results: page,
			all_results: all,
			returned_documents: page.length,
			total_documents: all.length,
			offset: safeOffset,
			next_offset: nextOffset,
			has_more: nextOffset < all.length,
		});
		result.reply_markdown = buildReplyMarkdown(result, page);
		return result;
	}

	function publicResult(result = {}) {
		let out = Object.assign({}, result);
		delete out.all_results;
		return out;
	}

	async function find({ reviewer, current, payload = {} } = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let query = optionalString(payload.query);
		if (!query) {
			throw new Error("Find Arguments query is required.");
		}
		let mode = optionalString(payload.mode || "keyword").toLowerCase();
		if (!["keyword", "semantic"].includes(mode)) {
			throw new Error("Find Arguments mode must be keyword or semantic.");
		}
		await ensureSchema(reviewer, context);
		let refs = await scopedRefs(reviewer, current, payload);
		if (!refs.length) {
			throw new Error("No scoped project documents are available for Find Arguments.");
		}
		let recordsByKey = await loadRecords(reviewer, current, payload);
		let searchMeta = {};
		let candidates = [];
		if (mode == "semantic") {
			let semantic = await semanticFind(reviewer, current, payload, refs);
			candidates = semantic.candidates || [];
			searchMeta.model = semantic.model || "";
		}
		else {
			let keyword = await keywordFind(reviewer, current, payload, recordsByKey, refs);
			candidates = keyword.candidates || [];
			searchMeta.keyword_backend = keyword.keyword_backend || "scan";
			searchMeta.indexed_chunks = Number(keyword.indexed_chunks || 0) || 0;
		}
		let grouped = await groupResults(reviewer, current, candidates, recordsByKey, payload);
		let scope = SystematicReviewerWorkflowEmbeddings.scopeDescriptor
			? SystematicReviewerWorkflowEmbeddings.scopeDescriptor(reviewer, current, scopePayload(payload))
			: {};
		let base = {
			ok: true,
			search_id: searchID(),
			query,
			mode,
			scope,
			keyword_backend: searchMeta.keyword_backend || "",
			model: searchMeta.model || "",
			indexed_chunks: Number(searchMeta.indexed_chunks || 0) || 0,
			limit: grouped.limit,
			chunks_per_document: grouped.chunks_per_document,
			total_documents: grouped.all_documents.length,
			all_results: grouped.all_documents,
		};
		let result = pageResult(base, 0, grouped.limit);
		result.search_id = await saveSearchSession(reviewer, context, result);
		return publicResult(result);
	}

	async function findNext({ reviewer, current, payload = {} } = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		await ensureSchema(reviewer, context);
		let id = optionalString(payload.search_id || payload.searchID);
		if (!id) {
			throw new Error("search_id is required.");
		}
		let existing = await loadSearchSession(reviewer, context, id);
		if (!existing) {
			throw new Error("Find Arguments search_id was not found or has expired.");
		}
		let limit = normalizeLimit(payload.limit || existing.limit);
		let offset = Number(existing.next_offset || existing.returned_documents || 0) || 0;
		let result = pageResult(existing, offset, limit);
		result.search_id = id;
		await saveSearchSession(reviewer, context, result);
		return publicResult(result);
	}

	async function getConfig({ reviewer, current, payload = {} } = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let schema = await ensureSchema(reviewer, context);
		let refs = await scopedRefs(reviewer, current, payload).catch(() => []);
		let chunkRows = await executeRows(
			reviewer,
			context,
			"SELECT COUNT(*) AS count, COUNT(DISTINCT item_key) AS item_count FROM document_chunks"
		).catch(() => []);
		let semantic = await semanticAvailability(reviewer, current, refs);
		return {
			ok: true,
			keyword_backend: schema.keyword_backend,
			scoped_item_count: refs.length,
			indexed_chunk_count: Number(rowValue(chunkRows?.[0], "count") || 0) || 0,
			indexed_document_count: Number(rowValue(chunkRows?.[0], "item_count") || 0) || 0,
			embeddings_model_configured: !!semantic.embeddings_model_configured,
			current_embeddings_model: semantic.current_embeddings_model || "",
			semantic_available: !!semantic.semantic_available,
			semantic_unavailable_reason: semantic.semantic_unavailable_reason || "",
			semantic_full_text_vector_count: Number(semantic.semantic_full_text_vector_count || 0) || 0,
			semantic_project_full_text_vector_count: Number(semantic.semantic_project_full_text_vector_count || 0) || 0,
			semantic_full_text_vector_status: semantic.semantic_full_text_vector_status || null,
			semantic_full_text_vectors: semantic.semantic_full_text_vectors || [],
		};
	}

	async function hitOpen({ reviewer, current, payload = {} } = {}) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let itemKey = optionalString(payload.item_key || payload.itemKey);
		let attachmentKey = optionalString(payload.attachment_key || payload.attachmentKey);
		let highlightText = optionalString(payload.highlight_text || payload.highlightText || payload.snippet || payload.excerpt);
		let searchQuery = optionalString(payload.search_query || payload.searchQuery || payload.query);
		let pageLabel = optionalString(payload.page_label || payload.pageLabel);
		let pageNumber = Number(payload.page_number || payload.pageNumber || 0) || 0;
		if (!attachmentKey && optionalString(payload.search_id || payload.searchID) && itemKey) {
			let existing = await loadSearchSession(reviewer, context, optionalString(payload.search_id || payload.searchID));
			let docs = Array.isArray(existing?.all_results) ? existing.all_results : [];
			let doc = docs.find((entry) => optionalString(entry?.item_key) == itemKey) || null;
			let chunkIndex = payload.chunk_index ?? payload.chunkIndex;
			let chunk = (Array.isArray(doc?.chunks) ? doc.chunks : []).find((entry) =>
				chunkIndex === undefined || chunkIndex === null || chunkIndex === ""
					? true
					: Number(entry?.chunk_index || 0) == Number(chunkIndex || 0)
			) || null;
			attachmentKey = optionalString(chunk?.attachment_key);
			highlightText = highlightText || optionalString(chunk?.highlight_text || chunk?.excerpt);
			pageLabel = pageLabel || optionalString(chunk?.page_label);
			if (!pageNumber && pageLabel) {
				pageNumber = Number(String(pageLabel).match(/\d+/)?.[0] || 0) || 0;
			}
			searchQuery = searchQuery || optionalString(existing?.query);
		}
		if (!pageNumber && pageLabel) {
			pageNumber = Number(String(pageLabel).match(/\d+/)?.[0] || 0) || 0;
		}
		if (!itemKey) {
			throw new Error("item_key is required.");
		}
		if (!attachmentKey) {
			throw new Error("attachment_key is required.");
		}
			let viewerMode = reviewer._openAttachmentTextualViewerByKey
				? await reviewer._openAttachmentTextualViewerByKey({
					libraryID: context.libraryID,
					attachmentKey,
					parentItemKey: itemKey,
					highlightText,
					pdfSearchQuery: searchQuery || highlightText,
					searchQuery,
					pageNumber,
				})
				: "";
			if (!viewerMode && reviewer._openMarkdownViewerTab) {
				await reviewer._openMarkdownViewerTab(null, {
					libraryID: context.libraryID,
					attachmentKey,
					parentItemKey: itemKey,
					highlightText,
					pdfSearchQuery: searchQuery || highlightText,
					searchQuery,
					pageNumber,
				});
				viewerMode = "markdown";
			}
			if (!viewerMode) {
				throw new Error("The stored document-search hit attachment could not be opened.");
			}
			return {
				ok: true,
				item_key: itemKey,
				attachment_key: attachmentKey,
				mode: viewerMode,
				highlight_text: highlightText,
				page_number: pageNumber,
			};
	}

	return {
		DEFAULT_DOCUMENT_LIMIT,
		MAX_DOCUMENT_LIMIT,
		DEFAULT_CHUNKS_PER_DOCUMENT,
		MAX_CHUNKS_PER_DOCUMENT,
		normalizeForSearch,
		tokenize,
		ensureSchema,
		ensureDocumentChunks,
		getConfig,
		find,
		findNext,
		hitOpen,
	};
})();
