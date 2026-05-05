var SystematicReviewerWorkflowPrisma = (() => {
	const STATE_FILENAME = "prisma-state.json";
	const EXPORT_DIRNAME = "prisma";
	const EXPORT_STATE_FILENAME = "prisma-export.json";
	const EXPORT_MARKDOWN_FILENAME = "PRISMA-SUMMARY.md";
	const DEFAULT_FONT_FAMILY = '"Lato", "Helvetica Neue", Arial, sans-serif';
	const DEFAULT_FONT_SIZE = 14;
	const DEFAULT_CORNER_RADIUS = 8;
	const DEFAULT_SHOW_OUTER_BORDER = false;
	const DEFAULT_REPORT_SCALE_PERCENT = 100;
	const REPORT_SCALE_MIN = 60;
	const REPORT_SCALE_MAX = 140;

	const DEFAULT_OPTIONS = Object.freeze({
		previous: false,
		other: false,
		dbDetail: false,
		regDetail: false,
		metaAnalysis: false,
	});

	const TEMPLATE_ROWS = Object.freeze([
		{ data: "NA", node: "node4", box: "prevstud", description: "Grey title box; Previous studies", boxtext: "Previous studies", tooltips: "Grey title box; Previous studies", url: "prevstud.html", n: "0" },
		{ data: "previous_studies", node: "node5", box: "box1", description: "Studies included in previous version of review", boxtext: "Studies included in previous version of review", tooltips: "Studies included in previous version of review", url: "previous_studies.html", n: "0" },
		{ data: "previous_reports", node: "NA", box: "box1", description: "Reports of studies included in previous version of review", boxtext: "Reports of studies included in previous version of review", tooltips: "NA", url: "previous_reports.html", n: "0" },
		{ data: "NA", node: "node6", box: "newstud", description: "Yellow title box; Identification of new studies via databases and registers", boxtext: "Identification of new studies via databases and registers", tooltips: "Yellow title box; Identification of new studies via databases and registers", url: "newstud.html", n: "0" },
		{ data: "database_results", node: "node7", box: "box2", description: "Records identified from: Databases", boxtext: "Databases", tooltips: "Records identified from: Databases and Registers", url: "database_results.html", n: "0" },
		{ data: "database_specific_results", node: "NA", box: "box2", description: "Records identified from: specific databases", boxtext: "Specific Databases", tooltips: "NA", url: "database_results.html", n: "Database 1, xxx; Database 2, xxx; Database 3, xxx" },
		{ data: "register_results", node: "NA", box: "box2", description: "Records identified from: Registers", boxtext: "Registers", tooltips: "NA", url: "NA", n: "0" },
		{ data: "register_specific_results", node: "NA", box: "box2", description: "Records identified from: specific registers", boxtext: "Specific Registers", tooltips: "NA", url: "database_results.html", n: "Register 1, xxx; Register 2, xxx; Register 3, xxx" },
		{ data: "NA", node: "node16", box: "othstud", description: "Grey title box; Identification of new studies via other methods", boxtext: "Identification of new studies via other methods", tooltips: "Grey title box; Identification of new studies via other methods", url: "othstud.html", n: "0" },
		{ data: "website_results", node: "node17", box: "box11", description: "Records identified from: Websites", boxtext: "Websites", tooltips: "Records identified from: Websites, Organisations and Citation Searching", url: "website_results.html", n: "0" },
		{ data: "organisation_results", node: "", box: "box11", description: "Records identified from: Organisations", boxtext: "Organisations", tooltips: "NA", url: "NA", n: "0" },
		{ data: "citations_results", node: "NA", box: "box11", description: "Records identified from: Citation searching", boxtext: "Citation searching", tooltips: "NA", url: "NA", n: "0" },
		{ data: "duplicates", node: "node8", box: "box3", description: "Duplicate records", boxtext: "Duplicate records", tooltips: "Duplicate records", url: "duplicates.html", n: "0" },
		{ data: "excluded_automatic", node: "NA", box: "box3", description: "Records marked as ineligible by automation tools", boxtext: "Records marked as ineligible by automation tools", tooltips: "NA", url: "NA", n: "0" },
		{ data: "excluded_other", node: "NA", box: "box3", description: "Records removed for other reasons", boxtext: "Records removed for other reasons", tooltips: "NA", url: "NA", n: "0" },
		{ data: "records_screened", node: "node9", box: "box4", description: "Records screened (databases and registers)", boxtext: "Records screened", tooltips: "Records screened (databases and registers)", url: "records_screened.html", n: "0" },
		{ data: "records_excluded", node: "node10", box: "box5", description: "Records excluded (databases and registers)", boxtext: "Records excluded", tooltips: "Records excluded (databases and registers)", url: "records_excluded.html", n: "0" },
		{ data: "dbr_sought_reports", node: "node11", box: "box6", description: "Reports sought for retrieval (databases and registers)", boxtext: "Reports sought for retrieval", tooltips: "Reports sought for retrieval (databases and registers)", url: "dbr_sought_reports.html", n: "0" },
		{ data: "dbr_notretrieved_reports", node: "node12", box: "box7", description: "Reports not retrieved (databases and registers)", boxtext: "Reports not retrieved", tooltips: "Reports not retrieved (databases and registers)", url: "dbr_notretrieved_reports.html", n: "0" },
		{ data: "other_sought_reports", node: "node18", box: "box12", description: "Reports sought for retrieval (other)", boxtext: "Reports sought for retrieval", tooltips: "Reports sought for retrieval (other)", url: "other_sought_reports.html", n: "0" },
		{ data: "other_notretrieved_reports", node: "node19", box: "box13", description: "Reports not retrieved (other)", boxtext: "Reports not retrieved", tooltips: "Reports not retrieved (other)", url: "other_notretrieved_reports.html", n: "0" },
		{ data: "dbr_assessed", node: "node13", box: "box8", description: "Reports assessed for eligibility (databases and registers)", boxtext: "Reports assessed for eligibility", tooltips: "Reports assessed for eligibility (databases and registers)", url: "dbr_assessed.html", n: "0" },
		{ data: "dbr_excluded", node: "node14", box: "box9", description: "Reports excluded (databases and registers): [separate reasons and numbers using ; e.g. Reason1, xxx; Reason2, xxx; Reason3, xxx]", boxtext: "Reports excluded", tooltips: "Reports excluded (databases and registers)", url: "dbrexcludedrecords.html", n: "Reason1, xxx; Reason2, xxx; Reason3, xxx" },
		{ data: "other_assessed", node: "node20", box: "box14", description: "Reports assessed for eligibility (other)", boxtext: "Reports assessed for eligibility", tooltips: "Reports assessed for eligibility (other)", url: "other_assessed.html", n: "0" },
		{ data: "other_excluded", node: "node21", box: "box15", description: "Reports excluded (other): [separate reasons and numbers using ; e.g. Reason1, xxx; Reason2, xxx; Reason3, xxx]", boxtext: "Reports excluded", tooltips: "Reports excluded (other)", url: "other_excluded.html", n: "Reason1, xxx; Reason2, xxx; Reason3, xxx" },
		{ data: "new_studies", node: "node15", box: "box10", description: "New studies included in review", boxtext: "New studies included in review", tooltips: "New studies included in review", url: "new_studies.html", n: "0" },
		{ data: "new_reports", node: "NA", box: "box10", description: "Reports of new included studies", boxtext: "Reports of new included studies", tooltips: "NA", url: "NA", n: "0" },
		{ data: "total_studies", node: "node22", box: "box16", description: "Total studies included in review", boxtext: "Total studies included in review", tooltips: "Total studies included in review", url: "total_studies.html", n: "0" },
		{ data: "total_reports", node: "NA", box: "box16", description: "Reports of total included studies", boxtext: "Reports of total included studies", tooltips: "NA", url: "NA", n: "0" },
		{ data: "identification", node: "node1", box: "identification", description: "Blue identification box", boxtext: "Identification", tooltips: "Blue identification box", url: "identification.html", n: "0" },
		{ data: "screening", node: "node2", box: "screening", description: "Blue screening box", boxtext: "Screening", tooltips: "Blue screening box", url: "screening.html", n: "0" },
		{ data: "included", node: "node3", box: "included", description: "Blue included box", boxtext: "Included", tooltips: "Blue included box", url: "included.html", n: "0" },
		{ data: "total_studies_ma", node: "node23", box: "box17", description: "Total studies included in meta-analysis", boxtext: "Total studies included in meta-analysis", tooltips: "Total studies included in meta-analysis", url: "total_studies_meta_analysis.html", n: "0" },
		{ data: "total_reports_ma", node: "NA", box: "box17", description: "Reports of total included studies in meta-analysis", boxtext: "Reports of total included studies in meta-analysis", tooltips: "NA", url: "NA", n: "0" },
	]);

	const PALETTE = Object.freeze({
		prevstud: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		othstud: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		newstud: { fill: "#ebb61b", stroke: "#d79b00" },
		box1: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box2: { fill: "#ffffff", stroke: "#444444" },
		box3: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box4: { fill: "#ffffff", stroke: "#444444" },
		box5: { fill: "#ffffff", stroke: "#444444" },
		box6: { fill: "#ffffff", stroke: "#444444" },
		box7: { fill: "#ffffff", stroke: "#444444" },
		box8: { fill: "#ffffff", stroke: "#444444" },
		box9: { fill: "#ffffff", stroke: "#444444" },
		box10: { fill: "#ffffff", stroke: "#444444" },
		box11: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box12: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box13: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box14: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box15: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box16: { fill: "#d9d9d9", stroke: "#9a9a9a" },
		box17: { fill: "#ffffff", stroke: "#444444" },
		identification: { fill: "#b0ccea", stroke: "#6f8fb8" },
		screening: { fill: "#b0ccea", stroke: "#6f8fb8" },
		included: { fill: "#b0ccea", stroke: "#6f8fb8" },
		default: { fill: "#ffffff", stroke: "#444444" },
		custom: { fill: "#f1f3f6", stroke: "#777777" },
	});

	const BOX_W = 320;
	const BOX_H = 90;
	const COL_GAP = 70;
	const ROW_GAP = 60;
	const HEADER_H = 50;
	const IDENT_H = 150;
	const SCREEN_H = 90;
	const RETRIEVE_H = 90;
	const ASSESS_H = 130;
	const EXCLUDE_H = 130;
	const INCLUDED_H = 100;
	const TOTAL_H = 110;
	const META_H = 110;
	const HEADER_Y = 40;
	const IDENT_Y = HEADER_Y + HEADER_H + 24;
	const SCREEN_Y = IDENT_Y + IDENT_H + ROW_GAP;
	const RETRIEVE_Y = SCREEN_Y + SCREEN_H + ROW_GAP;
	const ASSESS_Y = RETRIEVE_Y + RETRIEVE_H + ROW_GAP + 10;
	const INCLUDED_Y = ASSESS_Y + ASSESS_H + ROW_GAP;
	const TOTAL_Y = INCLUDED_Y + INCLUDED_H + ROW_GAP;
	const META_Y = TOTAL_Y + TOTAL_H + ROW_GAP;
	const COL0 = 80;
	const COL1 = COL0 + BOX_W + COL_GAP;
	const COL2 = COL1 + BOX_W + COL_GAP;
	const COL3 = COL2 + BOX_W + COL_GAP;
	const COL4 = COL3 + BOX_W + COL_GAP;
	const HEADER_WIDE = BOX_W * 2 + COL_GAP;
	const PHASE_LANE_X = 24;
	const PHASE_LANE_W = 30;
	const PHASE_TO_CONTENT_GAP = 26;
	const CONTENT_REBASE_PAD_X = PHASE_LANE_X + PHASE_LANE_W + PHASE_TO_CONTENT_GAP;

	const BASE_LAYOUT = Object.freeze([
		{ id: "node4", x: COL0, y: HEADER_Y, width: BOX_W, height: HEADER_H, showValue: false, optionalGroup: "previous" },
		{ id: "previous_studies", x: COL0, y: IDENT_Y, width: BOX_W, height: IDENT_H, showValue: false, optionalGroup: "previous" },
		{ id: "previous_reports", x: COL0, y: IDENT_Y + IDENT_H + ROW_GAP, width: 0, height: 0, optionalGroup: "previous", render: false },
		{ id: "node6", x: COL1, y: HEADER_Y, width: HEADER_WIDE, height: HEADER_H, showValue: false },
		{ id: "database_results", x: COL1, y: IDENT_Y, width: BOX_W, height: IDENT_H, showValue: false },
		{ id: "register_results", x: COL1, y: IDENT_Y, width: 0, height: 0, render: false },
		{ id: "database_specific_results", x: COL1, y: IDENT_Y, width: 0, height: 0, optionalGroup: "dbDetail", render: false },
		{ id: "register_specific_results", x: COL1, y: IDENT_Y, width: 0, height: 0, optionalGroup: "regDetail", render: false },
		{ id: "duplicates", x: COL2, y: IDENT_Y, width: BOX_W, height: IDENT_H, showValue: false },
		{ id: "excluded_automatic", x: COL2, y: IDENT_Y + 40, width: 0, height: 0, render: false },
		{ id: "excluded_other", x: COL2, y: IDENT_Y + 40, width: 0, height: 0, render: false },
		{ id: "records_screened", x: COL1, y: SCREEN_Y, width: BOX_W, height: SCREEN_H },
		{ id: "records_excluded", x: COL2, y: SCREEN_Y, width: BOX_W, height: SCREEN_H },
		{ id: "dbr_sought_reports", x: COL1, y: RETRIEVE_Y, width: BOX_W, height: RETRIEVE_H },
		{ id: "dbr_notretrieved_reports", x: COL2, y: RETRIEVE_Y, width: BOX_W, height: RETRIEVE_H },
		{ id: "dbr_assessed", x: COL1, y: ASSESS_Y, width: BOX_W, height: ASSESS_H },
		{ id: "dbr_excluded", x: COL2, y: ASSESS_Y, width: BOX_W, height: EXCLUDE_H },
		{ id: "new_studies", x: COL1, y: INCLUDED_Y, width: BOX_W, height: INCLUDED_H },
		{ id: "new_reports", x: COL1, y: INCLUDED_Y + INCLUDED_H + ROW_GAP, width: 0, height: 0, render: false },
		{ id: "total_studies", x: COL1, y: TOTAL_Y, width: BOX_W, height: TOTAL_H, showValue: true },
		{ id: "total_reports", x: COL1, y: TOTAL_Y + TOTAL_H + ROW_GAP, width: 0, height: 0, render: false },
		{ id: "total_studies_ma", x: COL1, y: META_Y, width: BOX_W, height: META_H, optionalGroup: "metaAnalysis", showValue: true },
		{ id: "total_reports_ma", x: COL1, y: META_Y + META_H + ROW_GAP, width: 0, height: 0, optionalGroup: "metaAnalysis", render: false },
		{ id: "node16", x: COL3, y: HEADER_Y, width: HEADER_WIDE, height: HEADER_H, showValue: false, optionalGroup: "other" },
		{ id: "website_results", x: COL3, y: IDENT_Y, width: BOX_W, height: IDENT_H, showValue: false, optionalGroup: "other" },
		{ id: "organisation_results", x: COL3, y: IDENT_Y, width: 0, height: 0, optionalGroup: "other", render: false },
		{ id: "citations_results", x: COL3, y: IDENT_Y, width: 0, height: 0, optionalGroup: "other", render: false },
		{ id: "other_sought_reports", x: COL3, y: RETRIEVE_Y, width: BOX_W, height: RETRIEVE_H, optionalGroup: "other" },
		{ id: "other_notretrieved_reports", x: COL4, y: RETRIEVE_Y, width: BOX_W, height: RETRIEVE_H, optionalGroup: "other" },
		{ id: "other_assessed", x: COL3, y: ASSESS_Y, width: BOX_W, height: ASSESS_H, optionalGroup: "other" },
		{ id: "other_excluded", x: COL4, y: ASSESS_Y, width: BOX_W, height: EXCLUDE_H, optionalGroup: "other" },
	]);

	const TEMPLATE_KEY_SET = new Set(
		TEMPLATE_ROWS
			.map((row) => templateKey(row))
			.filter(Boolean)
			.concat(BASE_LAYOUT.map((row) => row.id))
	);

	function optionalString(value) {
		return String(value || "").trim();
	}

	function templateKey(row = {}) {
		let rawData = optionalString(row.data);
		if (rawData && rawData.toUpperCase() != "NA") {
			return rawData;
		}
		let rawNode = optionalString(row.node);
		return rawNode && rawNode.toUpperCase() != "NA" ? rawNode : "";
	}

	function hasOwn(target, key) {
		return Object.prototype.hasOwnProperty.call(target || {}, key);
	}

	function normalizeNonNegativeInt(value, fallback = 0) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed)) {
			return fallback;
		}
		return Math.max(0, Math.round(parsed));
	}

	function sanitizeFontFamily(value) {
		return optionalString(value) || DEFAULT_FONT_FAMILY;
	}

	function sanitizeBoolean(value, fallback = false) {
		if (typeof value == "boolean") {
			return value;
		}
		if (value === "true" || value === "1" || value === 1) {
			return true;
		}
		if (value === "false" || value === "0" || value === 0) {
			return false;
		}
		return !!fallback;
	}

	function sanitizeFontSize(value) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed)) {
			return DEFAULT_FONT_SIZE;
		}
		return Math.max(8, Math.min(32, Math.round(parsed)));
	}

	function sanitizeCornerRadius(value) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed)) {
			return DEFAULT_CORNER_RADIUS;
		}
		return Math.max(0, Math.min(24, Math.round(parsed)));
	}

	function sanitizeReportScalePercent(value) {
		let parsed = Number(value);
		if (!Number.isFinite(parsed)) {
			return DEFAULT_REPORT_SCALE_PERCENT;
		}
		return Math.max(REPORT_SCALE_MIN, Math.min(REPORT_SCALE_MAX, Math.round(parsed)));
	}

	function sanitizeOptions(raw = {}) {
		let next = Object.assign({}, DEFAULT_OPTIONS);
		for (let key of Object.keys(DEFAULT_OPTIONS)) {
			if (hasOwn(raw, key)) {
				next[key] = !!raw[key];
			}
		}
		return next;
	}

	function sanitizeLabels(raw = {}) {
		let next = {};
		for (let [key, value] of Object.entries(raw || {})) {
			let cleanKey = optionalString(key);
			if (!TEMPLATE_KEY_SET.has(cleanKey)) {
				continue;
			}
			let text = String(value || "").trim();
			if (text) {
				next[cleanKey] = text;
			}
		}
		return next;
	}

	function sanitizeHidden(raw = []) {
		if (!Array.isArray(raw)) {
			return [];
		}
		return Array.from(new Set(raw.map((entry) => optionalString(entry)).filter((entry) => TEMPLATE_KEY_SET.has(entry))));
	}

	function sanitizeOverrideValue(value) {
		if (value === null || value === undefined || value === "") {
			return null;
		}
		let parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return Math.max(0, Math.round(parsed));
		}
		let text = optionalString(value);
		return text || null;
	}

	function sanitizeOverrideRows(raw = []) {
		if (!Array.isArray(raw)) {
			return [];
		}
		let rows = [];
		for (let entry of raw) {
			if (!entry || typeof entry != "object") {
				continue;
			}
			let label = String(entry.label || "").trim() || "Row";
			let mode = optionalString(entry.mode || "manual").toLowerCase() || "manual";
			if (!["manual", "retrieval_found", "column_equals"].includes(mode)) {
				mode = "manual";
			}
			let column = optionalString(entry.column);
			let values = Array.isArray(entry.values)
				? entry.values.map((value) => optionalString(value)).filter(Boolean)
				: [];
			rows.push({
				label,
				mode,
				column,
				values,
				value: sanitizeOverrideValue(entry.value),
			});
		}
		return rows;
	}

	function sanitizeOverrides(raw = {}) {
		let next = {};
		for (let [key, value] of Object.entries(raw || {})) {
			let cleanKey = optionalString(key);
			if (!TEMPLATE_KEY_SET.has(cleanKey) || !value || typeof value != "object" || !value.override) {
				continue;
			}
			next[cleanKey] = {
				override: true,
				value: sanitizeOverrideValue(value.value),
				label: String(value.label || "").trim(),
				rows: sanitizeOverrideRows(value.rows),
			};
		}
		return next;
	}

	function statePath(reviewer, context) {
		return reviewer._joinPath(context.projectRoot, STATE_FILENAME);
	}

	function exportDir(reviewer, context) {
		return reviewer._joinPath(context.outputsDir, EXPORT_DIRNAME);
	}

	async function loadPersistedState(reviewer, context) {
		let raw = (await reviewer._readJSONFile(statePath(reviewer, context))) || {};
		return {
			options: sanitizeOptions(raw.options || {}),
			labels: sanitizeLabels(raw.labels || {}),
			hidden: sanitizeHidden(raw.hidden || []),
			overrides: sanitizeOverrides(raw.overrides || {}),
			fontSize: sanitizeFontSize(raw.fontSize),
			cornerRadius: sanitizeCornerRadius(raw.cornerRadius),
			showOuterBorder: sanitizeBoolean(raw.showOuterBorder, DEFAULT_SHOW_OUTER_BORDER),
			reportScalePercent: sanitizeReportScalePercent(raw.reportScalePercent),
			updated_at: optionalString(raw.updated_at),
		};
	}

	async function resolveAutomationFontFamily({ reviewer, current, payload = {} }) {
		let rawEditorSettings = payload?.editor_settings || payload?.editorSettings || payload?.editor || null;
		if ((!rawEditorSettings || typeof rawEditorSettings != "object" || !Object.keys(rawEditorSettings).length) && current?.settings?.editor) {
			rawEditorSettings = current.settings.editor;
		}
		if ((!rawEditorSettings || typeof rawEditorSettings != "object" || !Object.keys(rawEditorSettings).length) && current?.context?.settingsPath) {
			try {
				let settings = (await reviewer._readJSONFile(current.context.settingsPath)) || {};
				rawEditorSettings = settings?.editor || rawEditorSettings;
			}
			catch (_error) {}
		}
		let normalized = reviewer?._normalizeEditorSettings
			? reviewer._normalizeEditorSettings(rawEditorSettings || {})
			: (typeof SystematicReviewerNativeMarkdown != "undefined" && SystematicReviewerNativeMarkdown?.normalizeSettings
				? SystematicReviewerNativeMarkdown.normalizeSettings(rawEditorSettings || {})
				: (rawEditorSettings || {}));
		return sanitizeFontFamily(normalized?.fontFamily);
	}

	function styleForBox(box) {
		let key = optionalString(box);
		if (key.toUpperCase() == "NA") {
			key = "";
		}
		return PALETTE[key || "default"] || PALETTE.default;
	}

	function collectionRecordCount(collection, { includeDescendants = false } = {}) {
		if (!collection) {
			return 0;
		}
		return collectionItemKeys(collection, { includeDescendants }).length;
	}

	function collectionItemKeys(collection, { includeDescendants = false } = {}) {
		if (!collection) {
			return [];
		}
		let collections = [collection];
		if (includeDescendants) {
			try {
				for (let desc of collection.getDescendents(false, "collection", false) || []) {
					let next = desc?.id ? Zotero.Collections.get(desc.id) : null;
					if (next && !next.deleted) {
						collections.push(next);
					}
				}
			}
			catch (_error) {}
		}
		let seen = new Set();
		for (let current of collections) {
			let directItems = current.getChildItems ? current.getChildItems(false, false) : [];
			for (let item of directItems || []) {
				if (!item || item.deleted || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) {
					continue;
				}
				let itemKey = optionalString(item.key);
				if (itemKey) {
					seen.add(itemKey);
				}
			}
		}
		return Array.from(seen);
	}

	async function screeningDecisionReasons(reviewer, context, itemKeys = []) {
		let cleanKeys = Array.from(new Set((itemKeys || []).map((itemKey) => optionalString(itemKey)).filter(Boolean)));
		if (!cleanKeys.length || !SystematicReviewerWorkflowEmbeddings?.executeRows) {
			return new Map();
		}
		let out = new Map();
		let batchSize = 400;
		for (let index = 0; index < cleanKeys.length; index += batchSize) {
			let batch = cleanKeys.slice(index, index + batchSize);
			let rows = await SystematicReviewerWorkflowEmbeddings.executeRows(
				reviewer,
				context,
				`SELECT item_key, COALESCE(reason, '') AS reason
				 FROM screening_decisions
				 WHERE item_key IN (${batch.map(() => "?").join(", ")})`,
				batch
			);
			for (let row of rows || []) {
				let itemKey = optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "item_key") || "");
				if (!itemKey) {
					continue;
				}
				out.set(itemKey, optionalString(SystematicReviewerWorkflowEmbeddings.rowValue(row, "reason") || ""));
			}
		}
		return out;
	}

	function countItemsWithPDF(reviewer, items = []) {
		let count = 0;
		for (let item of items || []) {
			if (!item || item.deleted || !item.getAttachments) {
				continue;
			}
			let attachmentIDs = [];
			try {
				attachmentIDs = item.getAttachments() || [];
			}
			catch (_error) {
				attachmentIDs = [];
			}
			let found = false;
			for (let attachmentID of attachmentIDs) {
				let attachment = Zotero.Items.get(attachmentID);
				if (!attachment || attachment.deleted || !attachment.isAttachment?.()) {
					continue;
				}
				let contentType = optionalString(attachment.attachmentContentType).toLowerCase();
				let filePath = optionalString(attachment.getFilePath ? attachment.getFilePath() : "").toLowerCase();
				if (contentType == "application/pdf" || filePath.endsWith(".pdf")) {
					found = true;
					break;
				}
			}
			if (found) {
				count += 1;
			}
		}
		return count;
	}

	async function computeAutoState({ reviewer, current }) {
		let context = current?.context;
		if (!context || !current?.collection) {
			throw new Error("Open a collection project first.");
		}

		let [harvestSourcesState, reviewCollections, availableColumns] = await Promise.all([
			SystematicReviewerWorkflowHarvest?.listSources
				? SystematicReviewerWorkflowHarvest.listSources(reviewer, current)
				: Promise.resolve({ sources: [], duplicates_collection_key: "", duplicates_collection_name: "Duplicates" }),
			SystematicReviewerWorkflowScreening?.reviewCollections
				? SystematicReviewerWorkflowScreening.reviewCollections(reviewer, current, { createMissing: false, includeMaybe: false })
				: Promise.resolve({ pending: null, included: null, excluded: null, excluded_ft: null }),
			(async () => {
				if (!SystematicReviewerWorkflowExplore?.dataset) {
					return [];
				}
				try {
					let data = await SystematicReviewerWorkflowExplore.dataset(reviewer, current, {});
					return Array.isArray(data?.columns) ? data.columns.map((column) => ({
						key: optionalString(column?.key),
						label: optionalString(column?.label) || optionalString(column?.key),
					})).filter((column) => column.key) : [];
				}
				catch (_error) {
					return [];
				}
			})(),
		]);

		let harvestSources = Array.isArray(harvestSourcesState?.sources)
			? harvestSourcesState.sources.map((entry) => ({
				collection_key: optionalString(entry?.collection_key),
				collection_name: optionalString(entry?.collection_name),
				item_count: normalizeNonNegativeInt(entry?.item_count, 0),
				is_openalex: !!entry?.is_openalex,
				is_added_by_user: !!entry?.is_added_by_user,
			}))
			: [];
		let identified = harvestSources.reduce((total, entry) => total + normalizeNonNegativeInt(entry.item_count, 0), 0);

		let duplicateCollection = harvestSourcesState?.duplicates_collection_key
			? reviewer._collectionByKey(context.libraryID, harvestSourcesState.duplicates_collection_key)
			: null;
		let duplicatesRemoved = normalizeNonNegativeInt(collectionRecordCount(duplicateCollection, { includeDescendants: true }), 0);

		let pendingCount = normalizeNonNegativeInt(collectionRecordCount(reviewCollections?.pending, { includeDescendants: true }), 0);
		let includedCount = normalizeNonNegativeInt(collectionRecordCount(reviewCollections?.included, { includeDescendants: true }), 0);
		let excludedCount = normalizeNonNegativeInt(collectionRecordCount(reviewCollections?.excluded, { includeDescendants: true }), 0);
		let excludedFTCount = normalizeNonNegativeInt(collectionRecordCount(reviewCollections?.excluded_ft, { includeDescendants: true }), 0);
		let excludedItemKeys = collectionItemKeys(reviewCollections?.excluded, { includeDescendants: true });
		let excludedReasons = await screeningDecisionReasons(reviewer, context, excludedItemKeys);
		let fullTextNotRetrievedReason = optionalString(SystematicReviewerWorkflowFullText?.NOT_RETRIEVED_REASON || "full_text_not_retrieved");
		let unretrievedCount = excludedItemKeys.reduce((total, itemKey) => {
			return total + (optionalString(excludedReasons.get(itemKey) || "") == fullTextNotRetrievedReason ? 1 : 0);
		}, 0);
		let screenedExclusions = Math.max(0, excludedCount - unretrievedCount);

		let workflowItems = reviewer._projectCitableItems(current.collection, current.projectItem);
		let withAttachments = normalizeNonNegativeInt(countItemsWithPDF(reviewer, workflowItems), 0);
		let recordsScreened = pendingCount + includedCount + excludedCount + excludedFTCount;
		let soughtReports = includedCount + excludedFTCount + unretrievedCount;
		let assessedReports = includedCount + excludedFTCount;

		let autoValues = {
			previous_studies: 0,
			previous_reports: 0,
			database_results: identified,
			database_specific_results: harvestSources.map((entry) => ({
				label: entry.collection_name || "Source",
				count: normalizeNonNegativeInt(entry.item_count, 0),
				collection_key: entry.collection_key,
			})),
			register_results: 0,
			register_specific_results: [],
			duplicates: duplicatesRemoved,
			excluded_automatic: 0,
			excluded_other: 0,
			website_results: 0,
			organisation_results: 0,
			citations_results: 0,
			records_screened: recordsScreened,
			records_excluded: screenedExclusions,
			records_excluded_auto: 0,
			records_excluded_manual: screenedExclusions,
			dbr_sought_reports: soughtReports,
			dbr_notretrieved_reports: unretrievedCount,
			dbr_assessed: assessedReports,
			dbr_excluded: excludedFTCount,
			dbr_excluded_auto: 0,
			dbr_excluded_manual: excludedFTCount,
			dbr_excluded_reasons: "",
			other_sought_reports: 0,
			other_notretrieved_reports: 0,
			other_assessed: 0,
			other_excluded: 0,
			other_excluded_reasons: "",
			new_studies: includedCount,
			new_reports: includedCount,
			total_studies: includedCount,
			total_reports: includedCount,
			total_studies_ma: 0,
			total_reports_ma: 0,
		};

		return {
			ok: true,
			project_id: context.projectID,
			collection_name: current.collection?.name || context.collectionName || "",
			harvest_sources: harvestSources,
			records_identified: identified,
			records_with_attachments: withAttachments,
			records_screened: recordsScreened,
			records_included: includedCount,
			records_excluded: screenedExclusions,
			records_excluded_full_text: excludedFTCount,
			records_full_text_not_retrieved: unretrievedCount,
			records_pending: pendingCount,
			records_duplicates: duplicatesRemoved,
			available_columns: availableColumns,
			auto_values: autoValues,
		};
	}

	function composeValues(state = {}) {
		let autoValues = state.auto_values || {};
		let overrides = state.overrides || {};
		let values = {};
		for (let row of TEMPLATE_ROWS) {
			let key = templateKey(row);
			if (!key) {
				continue;
			}
			let override = overrides[key] || null;
			if (override?.override && override.value !== null && override.value !== undefined && override.value !== "") {
				values[key] = override.value;
				continue;
			}
			if (hasOwn(autoValues, key)) {
				values[key] = autoValues[key];
				continue;
			}
			values[key] = row.n ?? "";
		}
		for (let [key, value] of Object.entries(autoValues || {})) {
			if (!hasOwn(values, key)) {
				values[key] = value;
			}
		}
		return values;
	}

	function applyTransientState(baseState = {}, payload = {}) {
		return Object.assign({}, baseState, {
			options: hasOwn(payload, "options") ? sanitizeOptions(payload.options || {}) : sanitizeOptions(baseState.options || {}),
			labels: hasOwn(payload, "labels") ? sanitizeLabels(payload.labels || {}) : sanitizeLabels(baseState.labels || {}),
			hidden: hasOwn(payload, "hidden") ? sanitizeHidden(payload.hidden || []) : sanitizeHidden(baseState.hidden || []),
			overrides: hasOwn(payload, "overrides") ? sanitizeOverrides(payload.overrides || {}) : sanitizeOverrides(baseState.overrides || {}),
			fontFamily: hasOwn(payload, "fontFamily") ? sanitizeFontFamily(payload.fontFamily) : sanitizeFontFamily(baseState.fontFamily),
			fontSize: hasOwn(payload, "fontSize") ? sanitizeFontSize(payload.fontSize) : sanitizeFontSize(baseState.fontSize),
			cornerRadius: hasOwn(payload, "cornerRadius") ? sanitizeCornerRadius(payload.cornerRadius) : sanitizeCornerRadius(baseState.cornerRadius),
			showOuterBorder: hasOwn(payload, "showOuterBorder") ? sanitizeBoolean(payload.showOuterBorder, DEFAULT_SHOW_OUTER_BORDER) : sanitizeBoolean(baseState.showOuterBorder, DEFAULT_SHOW_OUTER_BORDER),
			reportScalePercent: hasOwn(payload, "reportScalePercent") ? sanitizeReportScalePercent(payload.reportScalePercent) : sanitizeReportScalePercent(baseState.reportScalePercent),
		});
	}

	function formatCount(value) {
		let text = optionalString(value);
		return `n = ${text || "0"}`;
	}

	function toInt(value) {
		let parsed = Number(value);
		return Number.isFinite(parsed) ? Math.round(parsed) : 0;
	}

	function semicolonLines(text) {
		if (!text) {
			return [];
		}
		return String(text)
			.split(";")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	function buildDiagram(state = {}) {
		let templateIndex = new Map(TEMPLATE_ROWS.map((row) => [templateKey(row), row]).filter(([key]) => key));
		let options = sanitizeOptions(state.options || {});
		let hidden = new Set(sanitizeHidden(state.hidden || []));
		let values = state.values || composeValues(state);
		let labels = sanitizeLabels(state.labels || {});
		let overrides = sanitizeOverrides(state.overrides || {});
		let harvestSources = Array.isArray(state.harvest_sources) ? state.harvest_sources : [];
		let composedLabels = {};
		let showValueOverride = {};

		let previousStudiesValue = formatCount(values.previous_studies);
		let previousReportsValue = formatCount(values.previous_reports);
		composedLabels.previous_studies = [
			labels.previous_studies || "Previous studies",
			`(${previousStudiesValue})`,
			labels.previous_reports || "Reports of studies included in previous version of review",
			`(${previousReportsValue})`,
		].filter(Boolean).join("\n");
		showValueOverride.previous_studies = false;

		let sourceRows = harvestSources.map((entry) => ({
			label: entry.collection_name || "Source",
			count: normalizeNonNegativeInt(entry.item_count, 0),
		}));
		composedLabels.database_results = [
			"Records identified from:",
			`Databases (${formatCount(values.database_results)})`,
			...sourceRows.map((entry) => `${entry.label} (n = ${entry.count})`),
			`Registers (${formatCount(values.register_results)})`,
		].filter(Boolean).join("\n");
		showValueOverride.database_results = false;

		composedLabels.duplicates = [
			"Records removed before screening:",
			`Duplicate records (${formatCount(values.duplicates)})`,
			`Records marked as ineligible by automation tools (${formatCount(values.excluded_automatic)})`,
			`Records removed for other reasons (${formatCount(values.excluded_other)})`,
		].join("\n");
		showValueOverride.duplicates = false;

		composedLabels.website_results = [
			"Records identified from:",
			`Websites (${formatCount(values.website_results)})`,
			`Organisations (${formatCount(values.organisation_results)})`,
			`Citation searching (${formatCount(values.citations_results)})`,
		].join("\n");
		showValueOverride.website_results = false;

		composedLabels.records_excluded = [
			labels.records_excluded || "Records excluded (databases and registers)",
			`Automation tools (n = ${toInt(values.records_excluded_auto)})`,
			`Manual (n = ${Math.max(toInt(values.records_excluded) - toInt(values.records_excluded_auto), 0)})`,
		].join("\n");
		showValueOverride.records_excluded = false;

		let dbrReasonLines = semicolonLines(values.dbr_excluded_reasons);
		composedLabels.dbr_excluded = [
			labels.dbr_excluded || "Reports excluded (databases and registers)",
			`Automation tools (n = ${toInt(values.dbr_excluded_auto)})`,
			`Manual (n = ${Math.max(toInt(values.dbr_excluded) - toInt(values.dbr_excluded_auto), 0)})`,
			...dbrReasonLines,
		].filter(Boolean).join("\n");
		showValueOverride.dbr_excluded = false;

		let otherReasonLines = semicolonLines(values.other_excluded_reasons);
		if (otherReasonLines.length) {
			composedLabels.other_excluded = [
				labels.other_excluded || "Reports excluded (other methods)",
				...otherReasonLines,
			].join("\n");
			showValueOverride.other_excluded = false;
		}

		for (let headerID of ["node4", "node6", "node16"]) {
			let templateRow = templateIndex.get(headerID) || {};
			composedLabels[headerID] = templateRow.boxtext || templateRow.description || headerID;
			showValueOverride[headerID] = false;
		}

		let cascadeGroups = {
			node4: new Set(["previous_studies", "previous_reports"]),
			node6: new Set([
				"database_results",
				"register_results",
				"database_specific_results",
				"register_specific_results",
				"duplicates",
				"excluded_automatic",
				"excluded_other",
				"records_screened",
				"records_excluded",
				"dbr_sought_reports",
				"dbr_notretrieved_reports",
				"dbr_assessed",
				"dbr_excluded",
				"new_studies",
				"total_studies",
				"total_reports",
				"total_studies_ma",
				"total_reports_ma",
			]),
			node16: new Set([
				"website_results",
				"organisation_results",
				"citations_results",
				"other_sought_reports",
				"other_notretrieved_reports",
				"other_assessed",
				"other_excluded",
			]),
		};
		for (let [parent, children] of Object.entries(cascadeGroups)) {
			if (hidden.has(parent)) {
				for (let child of children) {
					hidden.add(child);
				}
			}
		}

		let hasPreviousArm = options.previous && !hidden.has("node4") && !hidden.has("previous_studies");
		let xOffset = hasPreviousArm ? 0 : -(BOX_W + COL_GAP);

		let nodes = [];
		let activeIDs = new Set();
		for (let layoutEntry of BASE_LAYOUT) {
			if (layoutEntry.render === false) {
				continue;
			}
			if (layoutEntry.optionalGroup && !options[layoutEntry.optionalGroup]) {
				continue;
			}
			if (hidden.has(layoutEntry.id)) {
				continue;
			}
			activeIDs.add(layoutEntry.id);
			let templateRow = templateIndex.get(layoutEntry.id) || {};
			let style = styleForBox(templateRow.box);
			let label = composedLabels[layoutEntry.id]
				|| labels[layoutEntry.id]
				|| templateRow.boxtext
				|| layoutEntry.id;
			let override = overrides[layoutEntry.id] || null;
			let value = override?.override && override.value !== null && override.value !== undefined
				? override.value
				: values[layoutEntry.id];
			if (override?.override) {
				if (override.label) {
					label = override.label;
				}
				if (Array.isArray(override.rows) && override.rows.length) {
					let extraLines = [];
					let total = 0;
					for (let row of override.rows) {
						let rowValue = Number(row.value);
						let nextValue = Number.isFinite(rowValue) ? Math.max(0, Math.round(rowValue)) : 0;
						extraLines.push(`${row.label || "Row"} (n = ${nextValue})`);
						total += nextValue;
					}
					label = [label].concat(extraLines).join("\n");
					value = total;
				}
			}
			nodes.push({
				id: layoutEntry.id,
				label,
				value,
				x: (layoutEntry.x || 0) + xOffset,
				y: layoutEntry.y || 0,
				width: layoutEntry.width || BOX_W,
				height: layoutEntry.height || BOX_H,
				fill: style.fill || "#ffffff",
				stroke: style.stroke || "#444444",
				showValue: layoutEntry.showValue !== false && !showValueOverride[layoutEntry.id],
				render: layoutEntry.render !== false,
			});
		}

		let edges = [
			["database_results", "duplicates"],
			["database_results", "records_screened"],
			["records_screened", "records_excluded"],
			["records_screened", "dbr_sought_reports"],
			["dbr_sought_reports", "dbr_notretrieved_reports"],
			["dbr_sought_reports", "dbr_assessed"],
			["dbr_assessed", "dbr_excluded"],
			["dbr_assessed", "new_studies"],
			["website_results", "other_sought_reports"],
			["other_sought_reports", "other_notretrieved_reports"],
			["other_sought_reports", "other_assessed"],
			["other_assessed", "other_excluded"],
			["other_assessed", "new_studies"],
			["new_studies", "total_studies"],
			["total_studies", "total_studies_ma"],
			["previous_studies", "total_studies"],
		].filter(([fromID, toID]) => activeIDs.has(fromID) && activeIDs.has(toID));

		if (nodes.length) {
			let minX = Math.min(...nodes.map((node) => node.x));
			let minY = Math.min(...nodes.map((node) => node.y));
			let padX = CONTENT_REBASE_PAD_X;
			let padY = 40;
			nodes = nodes.map((node) => Object.assign({}, node, {
				x: node.x - minX + padX,
				y: node.y - minY + padY,
			}));
		}

		let width = nodes.length
			? Math.max(...nodes.map((node) => node.x + node.width)) + 60
			: 1200;
		let height = nodes.length
			? Math.max(...nodes.map((node) => node.y + node.height)) + 60
			: 1400;

		return {
			nodes,
			edges,
			canvas: {
				width,
				height,
			},
		};
	}

	function serializeColumnList(columns = []) {
		return (columns || []).map((column) => ({
			key: optionalString(column?.key),
			label: optionalString(column?.label) || optionalString(column?.key),
		})).filter((column) => column.key);
	}

	async function getState({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let computed = await computeAutoState({ reviewer, current });
		let persisted = await loadPersistedState(reviewer, context);
		let fontFamily = await resolveAutomationFontFamily({ reviewer, current, payload });
		let state = Object.assign({}, computed, persisted, {
			template: TEMPLATE_ROWS,
			layout: BASE_LAYOUT,
			state_path: statePath(reviewer, context),
			export_dir: exportDir(reviewer, context),
			fontFamily: fontFamily || DEFAULT_FONT_FAMILY,
			fontSize: persisted.fontSize || DEFAULT_FONT_SIZE,
			cornerRadius: persisted.cornerRadius ?? DEFAULT_CORNER_RADIUS,
			showOuterBorder: sanitizeBoolean(persisted.showOuterBorder, DEFAULT_SHOW_OUTER_BORDER),
			reportScalePercent: sanitizeReportScalePercent(persisted.reportScalePercent),
			available_columns: serializeColumnList(computed.available_columns || []),
		});
		state.values = composeValues(state);
		state.diagram = buildDiagram(state);
		return Object.assign({ ok: true }, state);
	}

	async function saveState({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let existing = await loadPersistedState(reviewer, context);
		let next = {
			options: hasOwn(payload, "options") ? sanitizeOptions(payload.options || {}) : existing.options,
			labels: hasOwn(payload, "labels") ? sanitizeLabels(payload.labels || {}) : existing.labels,
			hidden: hasOwn(payload, "hidden") ? sanitizeHidden(payload.hidden || []) : existing.hidden,
			overrides: hasOwn(payload, "overrides") ? sanitizeOverrides(payload.overrides || {}) : existing.overrides,
			fontSize: hasOwn(payload, "fontSize") ? sanitizeFontSize(payload.fontSize) : existing.fontSize,
			cornerRadius: hasOwn(payload, "cornerRadius") ? sanitizeCornerRadius(payload.cornerRadius) : existing.cornerRadius,
			showOuterBorder: hasOwn(payload, "showOuterBorder") ? sanitizeBoolean(payload.showOuterBorder, DEFAULT_SHOW_OUTER_BORDER) : sanitizeBoolean(existing.showOuterBorder, DEFAULT_SHOW_OUTER_BORDER),
			reportScalePercent: hasOwn(payload, "reportScalePercent") ? sanitizeReportScalePercent(payload.reportScalePercent) : sanitizeReportScalePercent(existing.reportScalePercent),
			updated_at: new Date().toISOString(),
		};
		await reviewer._writeJSONFile(statePath(reviewer, context), next);
		return {
			ok: true,
			saved: true,
			state_path: statePath(reviewer, context),
			state: await getState({ reviewer, current }),
		};
	}

	async function resolveRenderState({ reviewer, current, payload = {} }) {
		let state = await getState({ reviewer, current, payload });
		let renderedState = applyTransientState(state, payload || {});
		renderedState.values = composeValues(renderedState);
		renderedState.diagram = buildDiagram(renderedState);
		return renderedState;
	}

	async function render({ reviewer, current, payload = {} }) {
		let state = await resolveRenderState({ reviewer, current, payload });
		return {
			ok: true,
			project_id: state.project_id,
			collection_name: state.collection_name,
			state_path: state.state_path,
			export_dir: state.export_dir,
			options: state.options,
			labels: state.labels,
			hidden: state.hidden,
			overrides: state.overrides,
			fontFamily: state.fontFamily,
			fontSize: state.fontSize,
			cornerRadius: state.cornerRadius,
			showOuterBorder: state.showOuterBorder,
			reportScalePercent: state.reportScalePercent,
			values: state.values,
			template: state.template,
			layout: state.layout,
			available_columns: state.available_columns || [],
			summary: {
				identified: state.records_identified,
				with_attachments: state.records_with_attachments,
				screened: state.records_screened,
				included: state.records_included,
				excluded: state.records_excluded,
				excluded_full_text: state.records_excluded_full_text,
				pending: state.records_pending,
				duplicates: state.records_duplicates,
			},
			harvest_sources: state.harvest_sources || [],
			diagram: state.diagram,
		};
	}

	function resolveColumnKey(columns = [], rawValue = "") {
		let requested = optionalString(rawValue).toLowerCase();
		if (!requested) {
			return "";
		}
		for (let column of columns || []) {
			let key = optionalString(column?.key);
			let label = optionalString(column?.label);
			if (key.toLowerCase() == requested || label.toLowerCase() == requested) {
				return key;
			}
		}
		return "";
	}

	async function computeRowCount({ reviewer, current, payload = {} }) {
		let mode = optionalString(payload.mode).toLowerCase();
		if (!mode) {
			return await computeAutoState({ reviewer, current });
		}
		if (mode == "retrieval_found") {
			let auto = await computeAutoState({ reviewer, current });
			return {
				ok: true,
				mode,
				count: normalizeNonNegativeInt(auto?.auto_values?.dbr_assessed, 0),
			};
		}
		if (mode == "column_equals") {
			if (!SystematicReviewerWorkflowExplore?.dataset) {
				throw new Error("Explore dataset is not available.");
			}
			let data = await SystematicReviewerWorkflowExplore.dataset(reviewer, current, {});
			let columns = serializeColumnList(data?.columns || []);
			let columnKey = resolveColumnKey(columns, payload.column);
			if (!columnKey) {
				throw new Error("Choose a column to compute.");
			}
			let rawValues = Array.isArray(payload.values)
				? payload.values
				: (payload.value !== undefined ? [payload.value] : []);
			let expected = rawValues.map((value) => optionalString(value).toLowerCase()).filter(Boolean);
			let expectedSet = new Set(expected);
			let count = 0;
			for (let row of data?.rows || []) {
				let value = optionalString(row?.[columnKey]);
				if (!expectedSet.size) {
					if (value) {
						count += 1;
					}
					continue;
				}
				if (expectedSet.has(value.toLowerCase())) {
					count += 1;
				}
			}
			return {
				ok: true,
				mode,
				column: columnKey,
				values: rawValues.map((value) => optionalString(value)).filter(Boolean),
				count,
			};
		}
		throw new Error("Unsupported PRISMA compute mode.");
	}

	function markdownLines(rendered = {}) {
		let summary = rendered.summary || {};
		let lines = [
			"# PRISMA Summary",
			"",
			`Collection: ${rendered.collection_name || ""}`,
			"",
			"## Summary",
			`- Identified: ${Number(summary.identified || 0) || 0}`,
			`- Duplicates removed: ${Number(summary.duplicates || 0) || 0}`,
			`- Screened: ${Number(summary.screened || 0) || 0}`,
			`- Excluded: ${Number(summary.excluded || 0) || 0}`,
			`- Full-text excluded: ${Number(summary.excluded_full_text || 0) || 0}`,
			`- Included: ${Number(summary.included || 0) || 0}`,
			`- Pending: ${Number(summary.pending || 0) || 0}`,
		];
		if ((rendered.harvest_sources || []).length) {
			lines.push("", "## Harvest Sources");
			for (let source of rendered.harvest_sources || []) {
				lines.push(`- ${source.collection_name}: ${Number(source.item_count || 0) || 0}`);
			}
		}
		lines.push("", "## Diagram Nodes");
		for (let node of rendered.diagram?.nodes || []) {
			if (node.render === false || !node.id) {
				continue;
			}
			let valueText = node.showValue === false ? "" : ` (n = ${Number(node.value || 0) || 0})`;
			lines.push(`- ${node.id}: ${String(node.label || "").replace(/\n+/g, " / ")}${valueText}`);
		}
		lines.push("");
		return lines.join("\n");
	}

	function decodePNGDataURL(dataURL = "") {
		let raw = String(dataURL || "");
		if (!raw.startsWith("data:image/png")) {
			throw new Error("data_url must be a PNG data URL.");
		}
		let parts = raw.split(",", 2);
		if (parts.length != 2) {
			throw new Error("PNG data URL is invalid.");
		}
		let binary = atob(parts[1]);
		let bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	}

	async function writeBinaryFile(reviewer, path, bytes) {
		let parent = reviewer._parentPath(path);
		if (parent) {
			await reviewer._ensureDirectory(parent);
		}
		if (typeof IOUtils != "undefined" && IOUtils?.write) {
			await IOUtils.write(path, bytes);
			return;
		}
		let file = reviewer._nsIFile(path);
		let output = Components.classes["@mozilla.org/network/file-output-stream;1"]
			.createInstance(Components.interfaces.nsIFileOutputStream);
		output.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
		let binary = Components.classes["@mozilla.org/binaryoutputstream;1"]
			.createInstance(Components.interfaces.nsIBinaryOutputStream);
		binary.setOutputStream(output);
		binary.writeByteArray(Array.from(bytes), bytes.length);
		binary.close();
		output.close();
	}

	function ensurePNGExtension(path = "") {
		let text = String(path || "").trim();
		if (!text) {
			return "";
		}
		return /\.png$/i.test(text) ? text : `${text}.png`;
	}

	async function choosePNGPath(reviewer, current) {
		let win = reviewer?._primaryWindow?.() || null;
		if (!win?.document) {
			throw new Error("A Zotero window is required to choose where to save the PRISMA PNG.");
		}
		let fakeController = { doc: win.document };
		let fp = Components.classes["@mozilla.org/filepicker;1"]
			.createInstance(Components.interfaces.nsIFilePicker);
		reviewer._initFilePicker(fp, fakeController, "Save PRISMA PNG", Components.interfaces.nsIFilePicker.modeSave);
		fp.defaultExtension = "png";
		fp.defaultString = `prisma-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
		fp.appendFilter("PNG", "*.png");
		let displayDirectory = exportDir(reviewer, current?.context || null);
		if (displayDirectory && await reviewer._pathExists(displayDirectory)) {
			try {
				fp.displayDirectory = reviewer._nsIFile(displayDirectory);
			}
			catch (_error) {}
		}
		let result = await new Promise((resolve) => fp.open(resolve));
		if ((result != Components.interfaces.nsIFilePicker.returnOK && result != Components.interfaces.nsIFilePicker.returnReplace) || !fp.file) {
			return "";
		}
		return ensurePNGExtension(fp.file.path);
	}

	async function savePNG({ reviewer, current, payload = {} }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let bytes = decodePNGDataURL(payload.data_url || payload.dataUrl || "");
		let filePath = ensurePNGExtension(payload.output_path || payload.outputPath || "");
		if (!filePath) {
			filePath = await choosePNGPath(reviewer, current);
		}
		if (!filePath) {
			return {
				ok: true,
				canceled: true,
			};
		}
		await writeBinaryFile(reviewer, filePath, bytes);
		return {
			ok: true,
			path: filePath,
			export_dir: reviewer._parentPath(filePath) || "",
		};
	}

	async function exportState({ reviewer, current }) {
		let context = current?.context;
		if (!context) {
			throw new Error("Open a collection project first.");
		}
		let rendered = await render({ reviewer, current });
		let dir = exportDir(reviewer, context);
		let jsonPath = reviewer._joinPath(dir, EXPORT_STATE_FILENAME);
		let markdownPath = reviewer._joinPath(dir, EXPORT_MARKDOWN_FILENAME);
		await reviewer._ensureDirectory(dir);
		await reviewer._writeJSONFile(jsonPath, {
			exported_at: new Date().toISOString(),
			...rendered,
		});
		await reviewer._writeTextFile(markdownPath, `${markdownLines(rendered)}\n`);
		return {
			ok: true,
			export_dir: dir,
			json_path: jsonPath,
			markdown_path: markdownPath,
			rendered,
		};
	}

	return {
		compute: computeRowCount,
		getState,
		saveState,
		render,
		savePNG,
		exportState,
	};
})();
