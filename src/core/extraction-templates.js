var SystematicReviewerWorkflowExtractionTemplates = (() => {
	const ALLOWED_FIELD_TYPES = new Set(["string", "number", "enum", "boolean"]);
	const PROJECT_TYPE_SYSTEMATIC_REVIEW_ID = "systematic_review";
	const PROJECT_TYPE_CUSTOM_ANALYSIS_ID = "custom_analysis";
	const PROJECT_TEMPLATE_PACKS = Object.freeze({
		[PROJECT_TYPE_SYSTEMATIC_REVIEW_ID]: Object.freeze({
			primary_name: "General",
			templates: Object.freeze([
				Object.freeze({
					file_name: "general.yaml",
					resource: "core/bundled-extraction-templates/systematic-review/general.yaml",
				}),
				Object.freeze({
					file_name: "full-text-match.yaml",
					resource: "core/bundled-extraction-templates/systematic-review/full-text-match.yaml",
				}),
				Object.freeze({
					file_name: "eligibility.yaml",
					resource: "core/bundled-extraction-templates/systematic-review/eligibility.yaml",
				}),
				Object.freeze({
					file_name: "interventions.yaml",
					resource: "core/bundled-extraction-templates/systematic-review/interventions.yaml",
				}),
				Object.freeze({
					file_name: "summarization.yaml",
					resource: "core/bundled-extraction-templates/systematic-review/summarization.yaml",
				}),
			]),
		}),
		[PROJECT_TYPE_CUSTOM_ANALYSIS_ID]: Object.freeze({
			primary_name: "Custom Analysis",
			templates: Object.freeze([
				Object.freeze({
					file_name: "custom-analysis.yaml",
					resource: "core/bundled-extraction-templates/custom-analysis/custom-analysis.yaml",
				}),
			]),
		}),
	});

	function optionalString(value) {
		return String(value || "").trim();
	}

	function slugify(value) {
		return optionalString(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "template";
	}

	function toNumber(value) {
		if (value === null || value === undefined || value === "") {
			return null;
		}
		let numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	}

	function dedupeStrings(values = []) {
		let out = [];
		let seen = new Set();
		for (let value of Array.isArray(values) ? values : []) {
			let text = optionalString(value);
			if (!text || seen.has(text)) {
				continue;
			}
			seen.add(text);
			out.push(text);
		}
		return out;
	}

	function normalizeExampleOutput(raw = {}) {
		if (!raw || typeof raw != "object" || Array.isArray(raw)) {
			return {};
		}
		let output = {};
		for (let [key, value] of Object.entries(raw)) {
			let nextKey = optionalString(key);
			if (!nextKey) {
				continue;
			}
			output[nextKey] = value;
		}
		return output;
	}

	function normalizeExamples(raw = []) {
		if (!Array.isArray(raw)) {
			return [];
		}
		let out = [];
		for (let entry of raw) {
			if (!entry || typeof entry != "object" || Array.isArray(entry)) {
				continue;
			}
			let markdown = String(entry.markdown || "");
			let output = normalizeExampleOutput(entry.output || {});
			if (!markdown.trim() && !Object.keys(output).length) {
				continue;
			}
			out.push({
				markdown,
				output,
			});
		}
		return out;
	}

	function normalizeField(raw = {}) {
		let key = optionalString(raw.key || raw.id);
		if (!key) {
			return null;
		}
		let type = optionalString(raw.type || "string").toLowerCase();
		if (type == "integer") {
			type = "number";
		}
		if (!ALLOWED_FIELD_TYPES.has(type)) {
			type = "string";
		}
		let field = {
			key,
			label: optionalString(raw.label) || key,
			type,
			guidance: optionalString(raw.guidance),
		};
		if (raw.allow_null) {
			field.allow_null = true;
		}
		if (type == "number") {
			let min = toNumber(raw.min);
			let max = toNumber(raw.max);
			if (min !== null) {
				field.min = min;
			}
			if (max !== null) {
				field.max = max;
			}
		}
		if (type == "enum") {
			let choices = dedupeStrings(raw.choices);
			if (choices.length) {
				field.choices = choices;
			}
			let rawGuidance = raw.choice_guidance && typeof raw.choice_guidance == "object"
				? raw.choice_guidance
				: {};
			let choiceGuidance = {};
			for (let choice of choices) {
				let guidance = optionalString(rawGuidance[choice]);
				if (guidance) {
					choiceGuidance[choice] = guidance;
				}
			}
			if (Object.keys(choiceGuidance).length) {
				field.choice_guidance = choiceGuidance;
			}
		}
		return field;
	}

	function templateDefaults(context = {}) {
		return {
			name: "template",
			description: "",
			system_prompt: "",
			user_prompt: "",
			format_instructions: "",
			field_block_template: "",
			fields: [],
			examples: [],
			collection_key: context.collectionKey,
		};
	}

	function countIndent(line) {
		let match = String(line || "").match(/^ */);
		return match ? match[0].length : 0;
	}

	function skipBlankLines(state) {
		while (state.index < state.lines.length) {
			let text = String(state.lines[state.index] || "");
			if (!text.trim() || text.trim().startsWith("#")) {
				state.index += 1;
				continue;
			}
			break;
		}
	}

	function parseScalar(text) {
		let raw = String(text || "").trim();
		if (!raw) {
			return "";
		}
		if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
			try {
				return JSON.parse(raw.startsWith('"') ? raw : JSON.stringify(raw.slice(1, -1)));
			}
			catch (_error) {
				return raw.slice(1, -1);
			}
		}
		if (raw == "true") {
			return true;
		}
		if (raw == "false") {
			return false;
		}
		if (raw == "null" || raw == "~") {
			return null;
		}
		if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
			return Number(raw);
		}
		return raw;
	}

	function splitKeyValue(text) {
		let raw = String(text || "");
		let divider = raw.indexOf(":");
		if (divider < 0) {
			return null;
		}
		let key = raw.slice(0, divider).trim();
		if (!key) {
			return null;
		}
		return [key, raw.slice(divider + 1)];
	}

	function foldBlockLines(lines = []) {
		let parts = [];
		let pendingBreak = false;
		for (let line of lines) {
			if (!line) {
				pendingBreak = true;
				continue;
			}
			if (!parts.length) {
				parts.push(line);
				pendingBreak = false;
				continue;
			}
			if (pendingBreak) {
				parts.push("\n");
				parts.push(line);
				pendingBreak = false;
				continue;
			}
			parts.push(" ");
			parts.push(line);
		}
		return parts.join("").trim();
	}

	function parseBlockScalar(state, parentIndent, style) {
		let out = [];
		let minIndent = null;
		while (state.index < state.lines.length) {
			let line = String(state.lines[state.index] || "");
			if (!line.trim()) {
				out.push("");
				state.index += 1;
				continue;
			}
			let indent = countIndent(line);
			if (indent <= parentIndent) {
				break;
			}
			if (minIndent === null) {
				minIndent = indent;
			}
			out.push(line.slice(minIndent));
			state.index += 1;
		}
		return style == ">" ? foldBlockLines(out) : out.join("\n").replace(/\n+$/, "");
	}

	function parseMap(state, indent, seed = null) {
		let obj = seed || {};
		while (state.index < state.lines.length) {
			skipBlankLines(state);
			if (state.index >= state.lines.length) {
				break;
			}
			let line = String(state.lines[state.index] || "");
			let actualIndent = countIndent(line);
			if (actualIndent < indent) {
				break;
			}
			if (actualIndent > indent) {
				break;
			}
			let content = line.slice(indent);
			if (content.startsWith("- ")) {
				break;
			}
			let pair = splitKeyValue(content);
			if (!pair) {
				state.index += 1;
				continue;
			}
			let [key, rawValue] = pair;
			let remainder = String(rawValue || "").trim();
			state.index += 1;
			if (remainder == "|" || remainder == ">") {
				obj[key] = parseBlockScalar(state, indent, remainder);
				continue;
			}
			if (remainder) {
				obj[key] = parseScalar(remainder);
				continue;
			}
			let nested = parseNode(state, indent + 2);
			obj[key] = nested === null ? "" : nested;
		}
		return obj;
	}

	function parseSequenceItemMap(state, indent, firstContent) {
		let pair = splitKeyValue(firstContent);
		if (!pair) {
			return parseScalar(firstContent);
		}
		let [key, rawValue] = pair;
		let obj = {};
		let remainder = String(rawValue || "").trim();
		if (remainder == "|" || remainder == ">") {
			obj[key] = parseBlockScalar(state, indent + 2, remainder);
		}
		else if (remainder) {
			obj[key] = parseScalar(remainder);
		}
		else {
			let nested = parseNode(state, indent + 2);
			obj[key] = nested === null ? "" : nested;
		}
		return parseMap(state, indent + 2, obj);
	}

	function parseSequence(state, indent) {
		let items = [];
		while (state.index < state.lines.length) {
			skipBlankLines(state);
			if (state.index >= state.lines.length) {
				break;
			}
			let line = String(state.lines[state.index] || "");
			let actualIndent = countIndent(line);
			if (actualIndent < indent) {
				break;
			}
			if (actualIndent > indent) {
				break;
			}
			let content = line.slice(indent);
			if (!content.startsWith("- ")) {
				break;
			}
			let remainder = content.slice(2).trimEnd();
			state.index += 1;
			if (!remainder.trim()) {
				let nested = parseNode(state, indent + 2);
				items.push(nested === null ? "" : nested);
				continue;
			}
			if (splitKeyValue(remainder)) {
				items.push(parseSequenceItemMap(state, indent, remainder));
				continue;
			}
			items.push(parseScalar(remainder));
		}
		return items;
	}

	function parseNode(state, indent) {
		skipBlankLines(state);
		if (state.index >= state.lines.length) {
			return null;
		}
		let line = String(state.lines[state.index] || "");
		let actualIndent = countIndent(line);
		if (actualIndent < indent) {
			return null;
		}
		let content = line.slice(actualIndent);
		if (content.startsWith("- ")) {
			return parseSequence(state, indent);
		}
		return parseMap(state, indent);
	}

	function parseYAML(text) {
		let raw = String(text || "").replace(/\r\n?/g, "\n");
		let state = {
			lines: raw.split("\n"),
			index: 0,
		};
		let value = parseNode(state, 0);
		return value && typeof value == "object" && !Array.isArray(value) ? value : {};
	}

	function isPlainScalar(value) {
		let text = String(value || "");
		return /^[A-Za-z0-9 _./()&,+-]+$/.test(text)
			&& !/:\s/.test(text)
			&& !/[#`[\]{}!|>'"%@]/.test(text);
	}

	function dumpScalar(value) {
		if (value === null || value === undefined) {
			return "null";
		}
		if (typeof value == "boolean" || typeof value == "number") {
			return String(value);
		}
		let text = String(value);
		if (!text) {
			return '""';
		}
		return isPlainScalar(text) ? text : JSON.stringify(text);
	}

	function appendBlockString(lines, indent, key, value) {
		let text = String(value || "");
		let padding = " ".repeat(indent);
		let blockIndent = `${padding}  `;
		lines.push(`${padding}${key}: |`);
		for (let line of text.replace(/\r\n?/g, "\n").split("\n")) {
			lines.push(`${blockIndent}${line}`);
		}
	}

	function appendKeyValue(lines, indent, key, value) {
		if (typeof value == "string" && value.includes("\n")) {
			appendBlockString(lines, indent, key, value);
			return;
		}
		lines.push(`${" ".repeat(indent)}${key}: ${dumpScalar(value)}`);
	}

	function appendObject(lines, indent, key, value = {}) {
		let entries = value && typeof value == "object" && !Array.isArray(value)
			? Object.entries(value)
			: [];
		if (!entries.length) {
			lines.push(`${" ".repeat(indent)}${key}: {}`);
			return;
		}
		lines.push(`${" ".repeat(indent)}${key}:`);
		for (let [entryKey, entryValue] of entries) {
			appendKeyValue(lines, indent + 2, entryKey, entryValue);
		}
	}

	function appendField(lines, indent, field = {}) {
		let padding = " ".repeat(indent);
		lines.push(`${padding}- key: ${dumpScalar(field.key || "")}`);
		appendKeyValue(lines, indent + 2, "label", field.label || field.key || "");
		appendKeyValue(lines, indent + 2, "type", field.type || "string");
		if (optionalString(field.guidance)) {
			appendKeyValue(lines, indent + 2, "guidance", field.guidance);
		}
		if (field.allow_null) {
			appendKeyValue(lines, indent + 2, "allow_null", true);
		}
		if (Array.isArray(field.choices) && field.choices.length) {
			lines.push(`${" ".repeat(indent + 2)}choices:`);
			for (let choice of field.choices) {
				lines.push(`${" ".repeat(indent + 4)}- ${dumpScalar(choice)}`);
			}
		}
		if (field.choice_guidance && typeof field.choice_guidance == "object" && Object.keys(field.choice_guidance).length) {
			appendObject(lines, indent + 2, "choice_guidance", field.choice_guidance);
		}
		if (field.min !== undefined && field.min !== null && field.min !== "") {
			appendKeyValue(lines, indent + 2, "min", field.min);
		}
		if (field.max !== undefined && field.max !== null && field.max !== "") {
			appendKeyValue(lines, indent + 2, "max", field.max);
		}
	}

	function appendExample(lines, indent, example = {}) {
		let padding = " ".repeat(indent);
		lines.push(`${padding}- markdown: |`);
		for (let line of String(example.markdown || "").replace(/\r\n?/g, "\n").split("\n")) {
			lines.push(`${" ".repeat(indent + 4)}${line}`);
		}
		let output = example.output && typeof example.output == "object" && !Array.isArray(example.output)
			? example.output
			: {};
		if (Object.keys(output).length) {
			lines.push(`${" ".repeat(indent + 2)}output:`);
			for (let [key, value] of Object.entries(output)) {
				appendKeyValue(lines, indent + 4, key, value);
			}
		}
	}

	function dumpTemplateYAML(template = {}) {
		let lines = [];
		appendKeyValue(lines, 0, "name", template.name || "template");
		if (optionalString(template.description)) {
			appendKeyValue(lines, 0, "description", template.description);
		}
		if (String(template.system_prompt || "")) {
			appendBlockString(lines, 0, "system_prompt", template.system_prompt);
		}
		if (String(template.user_prompt || "")) {
			appendBlockString(lines, 0, "user_prompt", template.user_prompt);
		}
		if (String(template.format_instructions || "")) {
			appendBlockString(lines, 0, "format_instructions", template.format_instructions);
		}
		if (String(template.field_block_template || "")) {
			appendBlockString(lines, 0, "field_block_template", template.field_block_template);
		}
		lines.push("fields:");
		for (let field of Array.isArray(template.fields) ? template.fields : []) {
			appendField(lines, 2, field);
		}
		let examples = Array.isArray(template.examples) ? template.examples : [];
		if (examples.length) {
			lines.push("examples:");
			for (let example of examples) {
				appendExample(lines, 2, example);
			}
		}
		return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
	}

	function normalizeProjectType(projectType = "") {
		let raw = optionalString(projectType).toLowerCase();
		if (["custom", "custom_analysis", "custom-analysis", "analysis"].includes(raw)) {
			return PROJECT_TYPE_CUSTOM_ANALYSIS_ID;
		}
		return PROJECT_TYPE_SYSTEMATIC_REVIEW_ID;
	}

	function bundledTemplatePack(projectType = "") {
		return PROJECT_TEMPLATE_PACKS[normalizeProjectType(projectType)] || PROJECT_TEMPLATE_PACKS[PROJECT_TYPE_SYSTEMATIC_REVIEW_ID];
	}

	function bundledTemplatePrimaryName(projectType = "") {
		return bundledTemplatePack(projectType).primary_name || "";
	}

	async function readBundledTemplateText(reviewer, resourcePath) {
		let base = String(reviewer?.rootURI || "").trim();
		if (!base) {
			throw new Error("Plugin root URI is unavailable for bundled extraction templates.");
		}
		let url = `${base}${String(resourcePath || "").trim()}`;
		let response = await fetch(url);
		if (!response?.ok) {
			throw new Error(`Unable to load bundled extraction template (${response?.status || "unknown"}).`);
		}
		let text = await response.text();
		if (!optionalString(text)) {
			throw new Error("Bundled extraction template is empty.");
		}
		return text.replace(/\r\n?/g, "\n");
	}

	function normalizeTemplate(context, raw = {}, options = {}) {
		let base = Object.assign({}, templateDefaults(context), raw || {});
		let fields = Array.isArray(base.fields)
			? base.fields.map(normalizeField).filter(Boolean)
			: [];
		let examples = normalizeExamples(base.examples);
		let normalized = {
			name: optionalString(base.name) || "template",
			description: String(base.description || ""),
			system_prompt: String(base.system_prompt || ""),
			user_prompt: String(base.user_prompt || ""),
			format_instructions: String(base.format_instructions || ""),
			field_block_template: String(base.field_block_template || ""),
			fields,
			examples,
			collection_key: context.collectionKey,
			updated_at: optionalString(base.updated_at) || "",
		};
		if (options.path !== undefined) {
			normalized.path = optionalString(options.path);
		}
		if (options.yaml !== undefined) {
			normalized.yaml = String(options.yaml || "");
		}
		return normalized;
	}

	function parseTemplateContent(context, content) {
		let text = String(content || "").trim();
		if (!text) {
			throw new Error("Template content is required.");
		}
		let parsed = null;
		try {
			parsed = JSON.parse(text);
			if (parsed?.template && typeof parsed.template == "object") {
				parsed = parsed.template;
			}
		}
		catch (_jsonError) {
			try {
				parsed = parseYAML(text);
			}
			catch (_yamlError) {
				throw new Error("Template import must be valid YAML or JSON.");
			}
		}
		return normalizeTemplate(context, parsed || {}, { yaml: text.replace(/\r\n?/g, "\n") });
	}

	function listTemplatePaths(reviewer, context) {
		let dir = reviewer._nsIFile(context.templatesDir);
		if (!dir.exists() || !dir.isDirectory()) {
			return [];
		}
		let paths = [];
		let entries = dir.directoryEntries;
		while (entries.hasMoreElements()) {
			let entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
			if (!entry?.leafName || entry.leafName.startsWith(".")) {
				continue;
			}
			if (entry.isDirectory()) {
				continue;
			}
			let lower = entry.leafName.toLowerCase();
			if (!lower.endsWith(".yaml") && !lower.endsWith(".yml")) {
				continue;
			}
			paths.push(entry.path);
		}
		return paths.sort((left, right) => left.localeCompare(right));
	}

	function suggestedFileName(reviewer, template = {}) {
		let base = reviewer._sanitizeFileName(slugify(template.name || "extraction-template"));
		return `${base || "extraction-template"}.yaml`;
	}

	function isManagedTemplatePath(reviewer, context, path) {
		let text = optionalString(path);
		if (!text) {
			return false;
		}
		let lower = text.toLowerCase();
		if (!lower.endsWith(".yaml") && !lower.endsWith(".yml")) {
			return false;
		}
		return reviewer._parentPath(text) == context.templatesDir;
	}

	function uniqueTemplatePath(reviewer, context, name) {
		let base = reviewer._sanitizeFileName(slugify(name));
		let candidate = reviewer._joinPath(context.templatesDir, `${base}.yaml`);
		if (!reviewer._pathExists(candidate)) {
			return candidate;
		}
		let counter = 2;
		while (reviewer._pathExists(candidate)) {
			candidate = reviewer._joinPath(context.templatesDir, `${base}-${counter}.yaml`);
			counter += 1;
		}
		return candidate;
	}

	function firstTemplatePath(reviewer, context) {
		return listTemplatePaths(reviewer, context)[0] || "";
	}

	async function readTemplateRecord(reviewer, context, path) {
		let targetPath = optionalString(path);
		if (!targetPath || !(await reviewer._pathExists(targetPath))) {
			return null;
		}
		let yamlText = String(await reviewer._readFileText(targetPath) || "").replace(/\r\n?/g, "\n");
		let parsed = parseTemplateContent(context, yamlText || "");
		let payload = normalizeTemplate(context, parsed || {}, {
			path: targetPath,
			yaml: yamlText,
		});
		payload.updated_at = payload.updated_at || new Date().toISOString();
		return payload;
	}

	async function findTemplatePathByName(reviewer, context, name) {
		let wanted = optionalString(name).toLowerCase();
		if (!wanted) {
			return "";
		}
		let candidates = listTemplatePaths(reviewer, context);
		for (let path of candidates) {
			let leaf = reviewer._basename(path).replace(/\.ya?ml$/i, "").toLowerCase();
			if (leaf == wanted) {
				return path;
			}
			let rawText = String(await reviewer._readFileText(path) || "");
			let parsed = parseTemplateContent(context, rawText);
			let templateName = optionalString(parsed?.name).toLowerCase();
			if (templateName && templateName == wanted) {
				return path;
			}
		}
		return "";
	}

	async function seedProjectTemplates(reviewer, context, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW_ID) {
		await reviewer._ensureDirectory(context.templatesDir);
		let pack = bundledTemplatePack(projectType);
		let written = [];
		for (let entry of Array.isArray(pack.templates) ? pack.templates : []) {
			let fileName = optionalString(entry?.file_name);
			let resource = optionalString(entry?.resource);
			if (!fileName || !resource) {
				continue;
			}
			let targetPath = reviewer._joinPath(context.templatesDir, fileName);
			if (await reviewer._pathExists(targetPath)) {
				continue;
			}
			let bundledText = await readBundledTemplateText(reviewer, resource);
			await reviewer._writeTextFile(targetPath, bundledText);
			written.push(targetPath);
		}
		return {
			ok: true,
			project_type: normalizeProjectType(projectType),
			written,
		};
	}

	async function resolveTemplatePath(reviewer, context, selector = {}, options = {}) {
		let requestedPath = optionalString(selector.path);
		if (requestedPath && isManagedTemplatePath(reviewer, context, requestedPath) && await reviewer._pathExists(requestedPath)) {
			return requestedPath;
		}
		let requestedName = optionalString(selector.name);
		if (requestedName) {
			let namedPath = await findTemplatePathByName(reviewer, context, requestedName);
			if (namedPath) {
				return namedPath;
			}
		}
		if (options.allowFallback === false) {
			return "";
		}
		return firstTemplatePath(reviewer, context);
	}

	async function loadBootstrapTemplate(reviewer, context, projectType = PROJECT_TYPE_SYSTEMATIC_REVIEW_ID) {
		let preferredPath = await findTemplatePathByName(reviewer, context, bundledTemplatePrimaryName(projectType));
		if (preferredPath) {
			return await readTemplateRecord(reviewer, context, preferredPath);
		}
		let fallbackPath = firstTemplatePath(reviewer, context);
		if (!fallbackPath) {
			return null;
		}
		return await readTemplateRecord(reviewer, context, fallbackPath);
	}

	async function listTemplates(reviewer, context) {
		let items = [];
		for (let path of listTemplatePaths(reviewer, context)) {
			let loaded = await readTemplateRecord(reviewer, context, path);
			if (loaded) {
				items.push(loaded);
			}
		}
		items.sort((left, right) => {
			return String(left.name || "").localeCompare(String(right.name || ""));
		});
		return items.map((entry) => ({
			name: entry.name,
			path: entry.path,
			description: entry.description || "",
			field_count: Array.isArray(entry.fields) ? entry.fields.length : 0,
			updated_at: entry.updated_at || "",
			yaml: entry.yaml || dumpTemplateYAML(entry),
		}));
	}

	async function saveTemplate(reviewer, context, payload = {}, options = {}) {
		await reviewer._ensureDirectory(context.templatesDir);
		let createNew = !!options.createNew;
		let requestedPath = optionalString(payload.path);
		let targetPath = "";
		if (!createNew && isManagedTemplatePath(reviewer, context, requestedPath)) {
			targetPath = requestedPath;
		}
		else {
			targetPath = uniqueTemplatePath(reviewer, context, payload.name || "template");
		}
		let normalized = normalizeTemplate(context, payload, {
			path: targetPath,
		});
		normalized.updated_at = new Date().toISOString();
		let yamlText = dumpTemplateYAML(normalized);
		await reviewer._writeTextFile(targetPath, yamlText);
		return await readTemplateRecord(reviewer, context, targetPath);
	}

	async function loadTemplate(reviewer, context, selector = {}) {
		let path = await resolveTemplatePath(reviewer, context, selector || {});
		if (!path) {
			return null;
		}
		return await readTemplateRecord(reviewer, context, path);
	}

	async function exportTemplate(reviewer, context, selector = {}) {
		let loaded = await loadTemplate(reviewer, context, selector || {});
		if (!loaded) {
			throw new Error("This project has no extraction templates.");
		}
		return {
			ok: true,
			name: loaded.name,
			path: loaded.path || "",
			file_name: suggestedFileName(reviewer, loaded),
			content_type: "application/yaml",
			content: loaded.yaml || dumpTemplateYAML(loaded),
			template: loaded,
		};
	}

	async function importTemplate(reviewer, context, payload = {}) {
		let template = parseTemplateContent(context, payload.content);
		let overrideName = optionalString(payload.name);
		if (overrideName) {
			template.name = overrideName;
		}
		let saved = await saveTemplate(reviewer, context, template, {
			createNew: payload.create_new !== false && payload.createNew !== false,
		});
		return Object.assign({}, saved, {
			ok: true,
			imported: true,
			file_name: suggestedFileName(reviewer, saved),
		});
	}

	return {
		dumpTemplateYAML,
		parseTemplateContent,
		seedProjectTemplates,
		loadBootstrapTemplate,
		listTemplates,
		loadTemplate,
		saveTemplate,
		exportTemplate,
		importTemplate,
	};
})();
