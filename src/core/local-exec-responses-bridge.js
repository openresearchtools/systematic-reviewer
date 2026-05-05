var SystematicReviewerLocalExecResponsesBridge = {
	_localExecResponseStore: new Map(),

	_localExecRolePath(roleID = "") {
		let cleanRoleID = String(roleID || "").trim();
		if (!cleanRoleID) {
			return "";
		}
		return SystematicReviewerWorkflowServer?.localExecRoleBasePath?.(cleanRoleID) || "";
	},

	_localExecResponsesBaseURL(roleID = "") {
		let path = this._localExecRolePath(roleID);
		let baseURL = SystematicReviewerWorkflowServer?.getStreamBaseURL?.()
			|| SystematicReviewerWorkflowServer?.getBaseURL?.()
			|| "";
		if (!path || !baseURL) {
			return "";
		}
		return `${baseURL}${path}`;
	},

	_localExecResponsesInputText(payload = {}) {
		let flattenContent = (value) => {
			if (value === undefined || value === null) {
				return "";
			}
			if (typeof value == "string") {
				return value.trim();
			}
			if (Array.isArray(value)) {
				return value
					.map((entry) => flattenContent(entry))
					.filter(Boolean)
					.join("\n");
			}
			if (typeof value == "object") {
				if (typeof value.text == "string") {
					return value.text.trim();
				}
				if (typeof value.content == "string") {
					return value.content.trim();
				}
				if (Array.isArray(value.content)) {
					return value.content
						.map((entry) => flattenContent(entry))
						.filter(Boolean)
						.join("\n");
				}
				if (value.type == "input_image" || value.type == "image_url") {
					return "[Image omitted]";
				}
			}
			return "";
		};
		let input = payload?.input;
		if (typeof input == "string" && input.trim()) {
			return input.trim();
		}
		if (Array.isArray(input)) {
			return input
				.map((entry) => {
					if (typeof entry == "string") {
						return entry.trim();
					}
					let role = String(entry?.role || "user").trim().toUpperCase();
					let content = flattenContent(entry?.content || "");
					return content ? `${role}:\n${content}` : "";
				})
				.filter(Boolean)
				.join("\n\n")
				.trim();
		}
		if (Array.isArray(payload?.messages)) {
			return payload.messages
				.map((entry) => {
					let role = String(entry?.role || "user").trim().toUpperCase();
					let content = flattenContent(entry?.content || "");
					return content ? `${role}:\n${content}` : "";
				})
				.filter(Boolean)
				.join("\n\n")
				.trim();
		}
		return "";
	},

	_localExecResponsesInstructionsText(payload = {}) {
		return String(payload?.instructions || "").trim();
	},

	_localExecResponsesFunctionTools(payload = {}) {
		return (Array.isArray(payload?.tools) ? payload.tools : [])
			.map((entry) => {
				if (!entry || typeof entry != "object") {
					return null;
				}
				let functionEntry = entry?.function && typeof entry.function == "object"
					? entry.function
					: null;
				let type = String(entry?.type || functionEntry?.type || "function").trim();
				let name = String(entry?.name || functionEntry?.name || "").trim();
				if (type && type != "function") {
					return null;
				}
				if (!name) {
					return null;
				}
				let description = String(entry?.description || functionEntry?.description || "").trim();
				let parameters = entry?.parameters && typeof entry.parameters == "object"
					? entry.parameters
					: (functionEntry?.parameters && typeof functionEntry.parameters == "object"
						? functionEntry.parameters
						: {
							type: "object",
							properties: {},
							additionalProperties: false,
						});
				return {
					type: "function",
					name,
					description,
					parameters,
				};
			})
			.filter(Boolean);
	},

	_localExecOpenCodeBridgeTruncateText(value = "", maxChars = 24000) {
		let text = String(value || "");
		let limit = Math.max(0, Number(maxChars || 0) || 0);
		if (!limit || text.length <= limit) {
			return {
				text,
				truncated: false,
			};
		}
		let truncate = typeof SystematicReviewerTokenBudget != "undefined"
			&& SystematicReviewerTokenBudget?.middleTruncateText
			? SystematicReviewerTokenBudget.middleTruncateText
			: null;
		if (truncate) {
			let result = truncate(text, limit, "\n\n[... OpenCode bridge transport truncated ...]\n\n");
			return {
				text: String(result?.text || ""),
				truncated: !!result?.truncated,
			};
		}
		let marker = "\n\n[... OpenCode bridge transport truncated ...]\n\n";
		let remaining = Math.max(0, limit - marker.length);
		let head = Math.max(1, Math.floor(remaining / 2));
		let tail = Math.max(1, remaining - head);
		return {
			text: `${text.slice(0, head).trimEnd()}${marker}${text.slice(Math.max(0, text.length - tail)).trimStart()}`,
			truncated: true,
		};
	},

	_localExecOpenCodeSerializeUnknown(value = null, fallback = "") {
		if (value === undefined || value === null) {
			return String(fallback || "");
		}
		if (typeof value == "string") {
			return value;
		}
		try {
			return JSON.stringify(value);
		}
		catch (_error) {
			return String(value || fallback || "");
		}
	},

	_localExecOpenCodeNormalizeContentParts(content = "") {
		let normalizeOne = (entry) => {
			if (entry === undefined || entry === null) {
				return null;
			}
			if (typeof entry == "string") {
				let text = entry.trim();
				return text ? { type: "input_text", text } : null;
			}
			if (typeof entry != "object") {
				let text = String(entry || "").trim();
				return text ? { type: "input_text", text } : null;
			}
			let type = String(entry?.type || "").trim() || "input_text";
			if (type == "input_image" || type == "image_url") {
				return {
					type,
					omitted: true,
				};
			}
			let text = "";
			if (typeof entry?.text == "string") {
				text = entry.text;
			}
			else if (typeof entry?.content == "string") {
				text = entry.content;
			}
			else if (entry?.content !== undefined && entry?.content !== null) {
				text = this._localExecOpenCodeSerializeUnknown(entry.content);
			}
			else {
				text = this._localExecOpenCodeSerializeUnknown(entry);
			}
			text = String(text || "").trim();
			return text ? { type, text } : null;
		};
		if (Array.isArray(content)) {
			return content.map((entry) => normalizeOne(entry)).filter(Boolean);
		}
		let part = normalizeOne(content);
		return part ? [part] : [];
	},

	_localExecOpenCodeNormalizeInputItem(entry = null) {
		if (entry === undefined || entry === null) {
			return null;
		}
		if (typeof entry == "string") {
			let text = entry.trim();
			return text
				? {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text }],
				}
				: null;
		}
		if (typeof entry != "object") {
			let text = String(entry || "").trim();
			return text
				? {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text }],
				}
				: null;
		}
		let type = String(entry?.type || "").trim();
		if (type == "function_call") {
			let args = typeof entry?.arguments == "string"
				? entry.arguments
				: this._localExecOpenCodeSerializeUnknown(entry?.arguments || entry?.args || {}, "{}");
			return {
				type: "function_call",
				call_id: String(entry?.call_id || entry?.callID || entry?.id || "").trim(),
				name: String(entry?.name || "").trim(),
				arguments: String(args || "{}"),
			};
		}
		if (type == "function_call_output") {
			let rawOutput = entry?.output !== undefined
				? entry.output
				: (entry?.content !== undefined ? entry.content : "");
			let serialized = this._localExecOpenCodeSerializeUnknown(rawOutput);
			let truncated = this._localExecOpenCodeBridgeTruncateText(serialized, 24000);
			return {
				type: "function_call_output",
				call_id: String(entry?.call_id || entry?.callID || "").trim(),
				output: truncated.text,
				status: String(entry?.status || "completed").trim() || "completed",
				truncated_for_bridge: !!truncated.truncated,
			};
		}
		if (type == "message" || entry?.role || entry?.content !== undefined) {
			let role = String(entry?.role || "user").trim() || "user";
			let content = this._localExecOpenCodeNormalizeContentParts(entry?.content || entry?.text || "");
			return content.length
				? {
					type: "message",
					role,
					content,
				}
				: null;
		}
		let text = this._localExecOpenCodeSerializeUnknown(entry).trim();
		return text
			? {
				type: type || "input_object",
				text,
			}
			: null;
	},

	_localExecOpenCodeNormalizeResponsesInput(payload = {}) {
		let input = payload?.input;
		if (typeof input == "string") {
			let text = input.trim();
			return text
				? [{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text }],
				}]
				: [];
		}
		if (Array.isArray(input)) {
			return input
				.map((entry) => this._localExecOpenCodeNormalizeInputItem(entry))
				.filter(Boolean);
		}
		if (Array.isArray(payload?.messages)) {
			return payload.messages
				.map((entry) => this._localExecOpenCodeNormalizeInputItem(entry))
				.filter(Boolean);
		}
		return [];
	},

	_localExecOpenCodeResponsesInputHasContent(payload = {}) {
		return this._localExecOpenCodeNormalizeResponsesInput(payload).length > 0;
	},

	_localExecOpenCodeBridgePacket(payload = {}) {
		let tools = this._localExecResponsesFunctionTools(payload);
		return {
			instructions: this._localExecResponsesInstructionsText(payload),
			input: this._localExecOpenCodeNormalizeResponsesInput(payload),
			advertised_tools: tools.map((tool) => ({
				type: "function",
				name: String(tool?.name || "").trim(),
				description: String(tool?.description || "").trim(),
				parameters: tool?.parameters && typeof tool.parameters == "object"
					? tool.parameters
					: {
						type: "object",
						properties: {},
						additionalProperties: false,
					},
			})),
		};
	},

	_localExecOpenCodeAssertAdvertisedTools(packet = {}, payload = {}) {
		let expected = this._localExecResponsesFunctionTools(payload)
			.map((tool) => String(tool?.name || "").trim())
			.filter(Boolean)
			.sort();
		let actual = (Array.isArray(packet?.advertised_tools) ? packet.advertised_tools : [])
			.map((tool) => String(tool?.name || "").trim())
			.filter(Boolean)
			.sort();
		if (expected.length != actual.length || expected.some((name, index) => name != actual[index])) {
			throw new Error(`OpenCode bridge advertised tool mismatch. expected=${expected.join(",")} actual=${actual.join(",")}`);
		}
		return true;
	},

		_localExecOpenCodeToolSummary(payload = {}) {
			let names = this._localExecResponsesFunctionTools(payload)
				.map((tool) => String(tool?.name || "").trim())
				.filter(Boolean);
			return {
				count: names.length,
				names,
			};
		},

		_localExecOpenCodeToolMap(payload = {}) {
			let out = new Map();
			for (let tool of this._localExecResponsesFunctionTools(payload)) {
				let name = String(tool?.name || "").trim();
				if (name) {
					out.set(name, tool);
				}
			}
			return out;
		},

		_localExecOpenCodeSchemaExampleValue(schema = {}, name = "") {
			let type = Array.isArray(schema?.type)
				? String(schema.type[0] || "").trim()
				: String(schema?.type || "").trim();
			if (Array.isArray(schema?.enum) && schema.enum.length) {
				return schema.enum[0];
			}
			if (Array.isArray(schema?.const) && schema.const.length) {
				return schema.const[0];
			}
			if (Object.prototype.hasOwnProperty.call(schema || {}, "default")) {
				return schema.default;
			}
			if (type == "number" || type == "integer") {
				return 1;
			}
			if (type == "boolean") {
				return true;
			}
			if (type == "array") {
				return [];
			}
			if (type == "object") {
				return {};
			}
			let cleanName = String(name || "value").trim() || "value";
			return `<${cleanName}>`;
		},

		_localExecOpenCodeToolArgsExample(tool = {}) {
			let parameters = tool?.parameters && typeof tool.parameters == "object" ? tool.parameters : {};
			let properties = parameters?.properties && typeof parameters.properties == "object" ? parameters.properties : {};
			let required = new Set(Array.isArray(parameters?.required) ? parameters.required : []);
			let out = {};
			let names = Object.keys(properties);
			for (let name of names) {
				if (required.has(name) || names.length <= 3) {
					out[name] = this._localExecOpenCodeSchemaExampleValue(properties[name], name);
				}
			}
			return out;
		},

		_localExecOpenCodeToolAcceptsEmptyObject(tool = {}) {
			let parameters = tool?.parameters && typeof tool.parameters == "object" ? tool.parameters : {};
			let properties = parameters?.properties && typeof parameters.properties == "object" ? parameters.properties : {};
			let required = Array.isArray(parameters?.required) ? parameters.required : [];
			return Object.keys(properties).length == 0 && required.length == 0;
		},

		_localExecOpenCodeAdvertisedToolGuide(payload = {}) {
			let lines = [];
			for (let tool of this._localExecResponsesFunctionTools(payload)) {
				let name = String(tool?.name || "").trim();
				if (!name) {
					continue;
				}
				let description = String(tool?.description || "No description provided.").trim();
				let parameters = tool?.parameters && typeof tool.parameters == "object" ? tool.parameters : {};
				let properties = parameters?.properties && typeof parameters.properties == "object" ? parameters.properties : {};
				let required = new Set(Array.isArray(parameters?.required) ? parameters.required : []);
				let argLines = Object.entries(properties).map(([argName, meta]) => {
					let requirement = required.has(argName) ? "required" : "optional";
					let argDescription = String(meta?.description || "").trim() || "No description provided.";
					return `    - ${argName} (${requirement}): ${argDescription}`;
				});
				let example = this._localExecJSONString(this._localExecOpenCodeToolArgsExample(tool), "{}");
				lines.push(`- ${name}: ${description}`);
				lines.push(`  Required arguments: ${Array.from(required).join(", ") || "none"}`);
				lines.push(`  args_json example: ${example}`);
				if (argLines.length) {
					lines.push("  Arguments:");
					lines.push(...argLines);
				}
			}
			return lines.join("\n");
		},

		_localExecJSONString(value, fallback = "{}") {
			try {
				return JSON.stringify(value);
			}
		catch (_error) {
			return String(fallback || "{}");
		}
	},

	_localExecResponsesPlanSchema(payload = {}) {
		let toolNames = this._localExecResponsesFunctionTools(payload)
			.map((entry) => String(entry?.name || "").trim())
			.filter(Boolean);
		return {
			type: "object",
			additionalProperties: false,
			properties: {
				reply: { type: "string" },
				thinking: { type: "string" },
				title: { type: "string" },
				tool_calls: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							name: toolNames.length
								? { type: "string", enum: toolNames }
								: { type: "string" },
							purpose: { type: "string" },
							args_json: { type: "string" },
						},
						required: ["name", "purpose", "args_json"],
					},
				},
			},
			required: ["reply", "thinking", "title", "tool_calls"],
		};
	},

	_localExecExtractJSONObjectText(rawText = "") {
		let text = String(rawText || "").trim();
		if (!text) {
			return "";
		}
		let fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (fenced?.[1]) {
			text = fenced[1].trim();
		}
		if (text.startsWith("{") && text.endsWith("}")) {
			return text;
		}
		let first = text.indexOf("{");
		let last = text.lastIndexOf("}");
		if (first >= 0 && last > first) {
			return text.slice(first, last + 1);
		}
		return "";
	},

	_localExecBalancedJSONObjectCandidates(rawText = "") {
		let text = String(rawText || "");
		let out = [];
		for (let start = 0; start < text.length; start += 1) {
			if (text[start] != "{") {
				continue;
			}
			let depth = 0;
			let inString = false;
			let escaped = false;
			for (let index = start; index < text.length; index += 1) {
				let ch = text[index];
				if (inString) {
					if (escaped) {
						escaped = false;
					}
					else if (ch == "\\") {
						escaped = true;
					}
					else if (ch == "\"") {
						inString = false;
					}
					continue;
				}
				if (ch == "\"") {
					inString = true;
					continue;
				}
				if (ch == "{") {
					depth += 1;
				}
				else if (ch == "}") {
					depth -= 1;
					if (depth === 0) {
						out.push(text.slice(start, index + 1));
						break;
					}
				}
			}
		}
		return out;
	},

	_localExecOpenCodeExtractJSONObjectText(rawText = "") {
		let text = String(rawText || "").trim();
		if (!text) {
			return "";
		}
		let sentinel = text.match(/BEGIN_SYSTEMATIC_REVIEWER_TOOL_PLAN\s*([\s\S]*?)\s*END_SYSTEMATIC_REVIEWER_TOOL_PLAN/i);
		if (sentinel?.[1]) {
			let candidate = this._localExecExtractJSONObjectText(sentinel[1]);
			if (candidate) {
				return candidate;
			}
		}
		let generic = this._localExecExtractJSONObjectText(text);
		if (generic) {
			return generic;
		}
		let candidates = this._localExecBalancedJSONObjectCandidates(text);
		for (let candidate of candidates.reverse()) {
			try {
				let parsed = JSON.parse(candidate);
				if (parsed && typeof parsed == "object" && !Array.isArray(parsed)) {
					return candidate;
				}
			}
			catch (_error) {}
		}
		return "";
	},

	_localExecResponsesToolBridgePrompt(payload = {}, built = {}) {
		let basePrompt = String(built?.promptText || "").trim();
		let tools = this._localExecResponsesFunctionTools(payload);
		if (!tools.length) {
			return basePrompt;
		}
		let toolLines = [];
		for (let tool of tools) {
			toolLines.push(`- ${String(tool?.name || "").trim()}: ${String(tool?.description || "No description provided.").trim()}`);
			toolLines.push(`  Parameters JSON Schema: ${this._localExecJSONString(tool?.parameters || {}, "{}")}`);
		}
		let bridgeBlock = [
			"SYSTEM:",
			"You are behind a bridge that translates OpenAI Responses function tools to a CLI runtime.",
			"Treat the existing SYSTEM/USER content above as the real task and context.",
			"Do not execute the tools yourself. Instead, select from the available function tools below and return only JSON that matches the required output schema.",
			"If a tool is needed, populate tool_calls with the exact tool name and args_json containing a JSON object string that satisfies the provided parameter schema.",
			"If no tool is needed, return tool_calls as [] and put the final user-facing reply in reply.",
			"Keep thinking concise plain text. Do not wrap the JSON in markdown fences.",
			"Example tool call item: {\"name\":\"tool_name\",\"purpose\":\"why\",\"args_json\":\"{\\\"field\\\":\\\"value\\\"}\"}",
			"",
			"Available function tools:",
			...toolLines,
		].join("\n");
		return [basePrompt, bridgeBlock].filter(Boolean).join("\n\n").trim();
	},

		_localExecOpenCodeToolBridgePrompt(payload = {}, built = {}) {
			void built;
			let tools = this._localExecResponsesFunctionTools(payload);
			let packet = this._localExecOpenCodeBridgePacket(payload);
			this._localExecOpenCodeAssertAdvertisedTools(packet, payload);
			let allowedNames = tools.map((tool) => String(tool?.name || "").trim()).filter(Boolean);
			let toolGuide = this._localExecOpenCodeAdvertisedToolGuide(payload);
			let packetJSON = JSON.stringify(packet, null, 2);
			let bridgeBlock = [
				"SYSTEM:",
				"You are an adapter for the Systematic Reviewer OpenAI Responses tool loop.",
				"Use only the Responses request JSON below. Do not inspect files, sessions, projects, OpenCode tools, or external state.",
			"Only functions listed in responses_request.advertised_tools are callable. No other tool names are valid.",
			"Return the next Responses step as one structured plan object between the required markers.",
			"",
			"BEGIN_SYSTEMATIC_REVIEWER_RESPONSES_REQUEST",
			packetJSON,
			"END_SYSTEMATIC_REVIEWER_RESPONSES_REQUEST",
			"",
				"Allowed function names:",
				allowedNames.length ? allowedNames.map((name) => `- ${name}`).join("\n") : "- none",
				"",
				"Advertised function details and argument examples:",
				toolGuide || "- none",
				"",
				"Output contract:",
				"BEGIN_SYSTEMATIC_REVIEWER_TOOL_PLAN",
				"{\"reply\":\"\",\"thinking\":\"brief private plan or rationale\",\"title\":\"short session title\",\"tool_calls\":[]}",
				"END_SYSTEMATIC_REVIEWER_TOOL_PLAN",
				"Rules:",
				"- If a tool is needed, set reply to \"\" and put each tool call in tool_calls as {\"name\":\"tool_name\",\"purpose\":\"why this tool is needed\",\"args_json\":\"{\\\"field\\\":\\\"value\\\"}\"}.",
				"- If no tool is needed, set tool_calls to [] and put the final user-facing answer in reply.",
				"- args_json must be a JSON object encoded as a string.",
				"- For zero-argument tools, set args_json to \"{}\".",
				"- Treat input items of type function_call_output as already-executed tool results. Use their output; do not repeat those completed function calls unless the latest user message explicitly asks to rerun them.",
				"- When input contains a previous tool_search function_call_output, use its tools[].description, call_example, required_arguments, call_arguments_example, and arguments fields as the detailed guidance for the newly advertised namespace tools.",
				"- Do not output function names outside advertised_tools.",
				"- Do not put prose outside BEGIN_SYSTEMATIC_REVIEWER_TOOL_PLAN and END_SYSTEMATIC_REVIEWER_TOOL_PLAN.",
				"- Do not wrap the plan in markdown fences.",
			].join("\n");
			return bridgeBlock.trim();
	},

	_localExecOpenCodeDirectPrompt(payload = {}, built = {}) {
		void built;
		let packet = this._localExecOpenCodeBridgePacket(Object.assign({}, payload || {}, {
			tools: [],
		}));
		let packetJSON = JSON.stringify(packet, null, 2);
		return [
			"SYSTEM:",
			"You are an adapter for the Systematic Reviewer OpenAI Responses chat path.",
			"Use only the Responses request JSON below. Do not inspect files, sessions, projects, OpenCode tools, or external state.",
			"Return only the final user-facing answer text. Do not include JSON unless the user explicitly requested JSON.",
			"",
			"BEGIN_SYSTEMATIC_REVIEWER_RESPONSES_REQUEST",
			packetJSON,
			"END_SYSTEMATIC_REVIEWER_RESPONSES_REQUEST",
		].join("\n").trim();
	},

		_localExecOpenCodeRepairPrompt(rawText = "", parseError = null, payload = {}) {
			let tools = this._localExecResponsesFunctionTools(payload);
			let toolNames = tools.map((tool) => String(tool?.name || "").trim()).filter(Boolean);
			let toolGuide = this._localExecOpenCodeAdvertisedToolGuide(payload);
			return [
				"SYSTEM:",
				"The previous OpenCode response did not match the Systematic Reviewer structured-plan format.",
				"Repair formatting only. Do not solve the task again, choose different tools, add tools, remove tools, or reinterpret the request.",
				"Return exactly one JSON object between these markers and nothing else:",
			"BEGIN_SYSTEMATIC_REVIEWER_TOOL_PLAN",
			"{\"reply\":\"\",\"thinking\":\"brief private plan or rationale\",\"title\":\"short session title\",\"tool_calls\":[]}",
				"END_SYSTEMATIC_REVIEWER_TOOL_PLAN",
				toolNames.length ? `Allowed tool names: ${toolNames.join(", ")}` : "No tool names are available.",
				"Each tool call must be {\"name\":\"tool_name\",\"purpose\":\"why\",\"args_json\":\"{\\\"field\\\":\\\"value\\\"}\"}. args_json must decode to one JSON object.",
				"For zero-argument tools, args_json must be \"{}\".",
				"Do not add or repeat completed function calls from the input. Repair the previous response formatting only.",
				"Advertised function details and argument examples:",
				toolGuide || "- none",
				`Parser error: ${String(parseError?.message || parseError || "unknown").slice(0, 800)}`,
				"",
				"Previous response:",
				String(rawText || "").slice(0, 12000),
			].join("\n");
	},

	_localExecOpenCodeDiagnosticError(error, rawText = "", model = "", payload = {}) {
		let snippet = String(rawText || "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 700);
		let modelLabel = String(model || "").trim() || "OpenCode model";
		let toolSummary = this._localExecOpenCodeToolSummary(payload);
		let message = `${modelLabel} did not return a valid structured tool plan: ${error?.message || String(error)} Advertised tools (${toolSummary.count}): ${toolSummary.names.join(", ") || "none"}.`;
		if (snippet) {
			message += ` Output snippet: ${snippet}`;
		}
		return new Error(message);
	},

	_localExecOpenCodePlanRoot(parsed = null) {
		let current = parsed;
		for (let depth = 0; depth < 4; depth += 1) {
			if (!current || typeof current != "object" || Array.isArray(current)) {
				return current;
			}
			let next = current.plan
				|| current.tool_plan
				|| current.toolPlan
				|| current.structured_tool_plan
				|| current.structuredToolPlan
				|| current.result
				|| null;
			if (!next || typeof next != "object" || Array.isArray(next)) {
				return current;
			}
			current = next;
		}
		return current;
	},

	_localExecOpenCodeRawToolCalls(parsed = {}) {
		let root = parsed && typeof parsed == "object" ? parsed : {};
		let arrays = [
			root.tool_calls,
			root.toolCalls,
			root.function_calls,
			root.functionCalls,
			root.actions,
		];
		for (let value of arrays) {
			if (Array.isArray(value)) {
				return value;
			}
		}
		if (Array.isArray(root.output)) {
			let calls = root.output.filter((entry) => {
				let type = String(entry?.type || "").trim();
				return type == "function_call" || type == "tool_call";
			});
			if (calls.length) {
				return calls;
			}
		}
		let single = root.tool_call
			|| root.toolCall
			|| root.function_call
			|| root.functionCall
			|| (["function_call", "tool_call"].includes(String(root.type || "").trim()) ? root : null);
		return single && typeof single == "object" ? [single] : [];
	},

	_localExecOpenCodePlanFromText(rawText = "", payload = {}, options = {}) {
		let candidateText = this._localExecOpenCodeExtractJSONObjectText(rawText);
		if (!candidateText) {
			throw new Error("No JSON object was found in OpenCode output.");
		}
		let parsed = null;
		try {
			parsed = JSON.parse(candidateText);
		}
		catch (error) {
			throw new Error(`OpenCode returned invalid structured JSON: ${error?.message || String(error)}`);
		}
		parsed = this._localExecOpenCodePlanRoot(parsed);
			let allowedNames = new Set(
				this._localExecResponsesFunctionTools(payload)
					.map((entry) => String(entry?.name || "").trim())
					.filter(Boolean)
			);
			let toolMap = this._localExecOpenCodeToolMap(payload);
			let rawToolCalls = this._localExecOpenCodeRawToolCalls(parsed);
			let toolCalls = [];
			let invalidToolNames = [];
			for (let entry of rawToolCalls) {
				let functionEntry = entry?.function && typeof entry.function == "object" ? entry.function : {};
			let name = String(
				entry?.name
				|| entry?.tool
				|| entry?.tool_name
				|| entry?.toolName
				|| functionEntry?.name
				|| ""
			).trim();
			if (!name) {
				throw new Error("OpenCode returned a tool call without a function name.");
			}
				if (allowedNames.size && !allowedNames.has(name)) {
					invalidToolNames.push(name);
				}
				let args = null;
				let tool = toolMap.get(name) || null;
				let acceptsEmptyObject = tool ? this._localExecOpenCodeToolAcceptsEmptyObject(tool) : false;
				for (let candidate of [
					entry?.args,
					entry?.arguments,
					entry?.input,
					entry?.parameters,
					entry?.args_json,
					entry?.argsJSON,
					entry?.arguments_json,
					entry?.argumentsJSON,
					functionEntry?.arguments,
				]) {
					if (candidate && typeof candidate == "object" && !Array.isArray(candidate)) {
						args = candidate;
						break;
					}
					if (typeof candidate == "string" && candidate.trim()) {
					try {
						let parsedArgs = JSON.parse(candidate);
						if (parsedArgs && typeof parsedArgs == "object" && !Array.isArray(parsedArgs)) {
							args = parsedArgs;
							break;
						}
					}
					catch (_error) {}
				}
				}
				let argsJSONText = String(entry?.args_json || entry?.argsJSON || entry?.arguments_json || entry?.argumentsJSON || "").trim();
				if (!args && argsJSONText) {
					try {
						let parsedArgs = JSON.parse(argsJSONText);
					if (!parsedArgs || typeof parsedArgs != "object" || Array.isArray(parsedArgs)) {
						throw new Error("Expected one JSON object.");
					}
					args = parsedArgs;
				}
				catch (error) {
						throw new Error(`OpenCode returned invalid args_json for tool ${name || "unknown"}: ${error?.message || String(error)}`);
					}
				}
				if (!args) {
					if (acceptsEmptyObject) {
						args = {};
					}
					else {
						let parameters = tool?.parameters && typeof tool.parameters == "object" ? tool.parameters : {};
						let required = Array.isArray(parameters?.required) ? parameters.required.filter(Boolean) : [];
						let properties = parameters?.properties && typeof parameters.properties == "object" ? Object.keys(parameters.properties) : [];
						let hint = [
							required.length ? `required=${required.join(",")}` : "",
							properties.length ? `available=${properties.join(",")}` : "",
						].filter(Boolean).join("; ");
						throw new Error(`OpenCode returned missing args_json for tool ${name || "unknown"}${hint ? ` (${hint})` : ""}.`);
					}
				}
				toolCalls.push({
					name,
					args,
				purpose: String(entry?.purpose || entry?.why || entry?.reason || "").trim(),
			});
		}
		if (invalidToolNames.length) {
			throw new Error(`OpenCode returned unadvertised tool call(s): ${Array.from(new Set(invalidToolNames)).join(", ")}. Advertised tools: ${Array.from(allowedNames).join(", ") || "none"}.`);
		}
		let reply = String(
			parsed?.reply
			|| parsed?.response
			|| parsed?.message
			|| parsed?.answer
			|| parsed?.final
			|| parsed?.content
			|| ""
		).trim();
		let thinking = String(parsed?.thinking || parsed?.reasoning || parsed?.rationale || "").trim();
		let title = String(parsed?.title || parsed?.session_title || parsed?.sessionTitle || "").trim();
		if (!reply && !toolCalls.length) {
			throw new Error("OpenCode returned neither a final reply nor any Responses function calls.");
		}
		return {
			reply,
			thinking,
			title,
			tool_calls: toolCalls,
		};
	},

	_localExecResponsesPlanFromText(rawText = "", payload = {}) {
		let candidateText = this._localExecExtractJSONObjectText(rawText);
		if (!candidateText) {
			throw new Error("Local executor did not return a valid structured tool plan.");
		}
		let parsed = null;
		try {
			parsed = JSON.parse(candidateText);
		}
		catch (error) {
			throw new Error(`Local executor returned invalid structured JSON: ${error?.message || String(error)}`);
		}
		let allowedNames = new Set(
			this._localExecResponsesFunctionTools(payload)
				.map((entry) => String(entry?.name || "").trim())
				.filter(Boolean)
		);
		let toolCalls = (Array.isArray(parsed?.tool_calls) ? parsed.tool_calls : [])
			.map((entry) => {
				let name = String(
					entry?.name
					|| entry?.tool
					|| entry?.tool_name
					|| entry?.toolName
					|| ""
				).trim();
				let args = entry?.args && typeof entry.args == "object" && !Array.isArray(entry.args)
					? entry.args
					: null;
				let argsJSONText = String(entry?.args_json || entry?.argsJSON || "").trim();
				if (!args && argsJSONText) {
					try {
						let parsedArgs = JSON.parse(argsJSONText);
						if (!parsedArgs || typeof parsedArgs != "object" || Array.isArray(parsedArgs)) {
							throw new Error("Expected one JSON object.");
						}
						args = parsedArgs;
					}
					catch (error) {
						throw new Error(`Local executor returned invalid args_json for tool ${name || "unknown"}: ${error?.message || String(error)}`);
					}
				}
				if (!args) {
					throw new Error(`Local executor returned missing args_json for tool ${name || "unknown"}.`);
				}
				return {
					name,
					args,
					purpose: String(entry?.purpose || entry?.why || "").trim(),
				};
			})
			.filter((entry) => entry.name && (!allowedNames.size || allowedNames.has(entry.name)));
		if (Array.isArray(parsed?.tool_calls) && parsed.tool_calls.length && !toolCalls.length) {
			throw new Error("Local executor returned tool calls that do not match the advertised Responses tool names.");
		}
		let reply = String(parsed?.reply || parsed?.response || parsed?.message || "").trim();
		let thinking = String(parsed?.thinking || parsed?.reasoning || "").trim();
		let title = String(parsed?.title || parsed?.session_title || "").trim();
		if (!reply && !toolCalls.length) {
			throw new Error("Local executor returned neither a final reply nor any Responses function calls.");
		}
		return {
			reply,
			thinking,
			title,
			tool_calls: toolCalls,
		};
	},

	async _localExecResolvedRoleConfig(roleID, payload = {}) {
		let config = await this._conversionConfig();
		let runtimeRoles = config?.runtimeRoles || this._defaultRuntimeRoles();
		let apiConnections = config?.apiConnections || [];
		let requestedPresetID = String(
			payload?.runtime_preset_id
			|| payload?.runtimePresetID
			|| payload?.preset_id
			|| payload?.presetID
			|| "default"
		).trim() || "default";
		let resolvedPreset = this._resolveRolePreset(
			roleID,
			runtimeRoles,
			apiConnections,
			null,
			requestedPresetID
		);
		if (requestedPresetID != "default" && !resolvedPreset) {
			throw new Error(`Unknown runtime preset for ${roleID}: ${requestedPresetID}`);
		}
		let role = Object.assign(
			{},
			this._defaultRuntimeRole(roleID),
			runtimeRoles?.[roleID] || {},
			resolvedPreset || {}
		);
		return {
			config,
			runtimeRoles,
			apiConnections,
			requestedPresetID,
			resolvedPreset,
			role,
		};
	},

	_localExecResponseStoreEntry(responseID = "") {
		let key = String(responseID || "").trim();
		return key ? (this._localExecResponseStore.get(key) || null) : null;
	},

	_localExecBuildStoredPrompt(entry = {}, inputText = "", instructionsText = "") {
		let instructions = String(instructionsText || entry?.instructions || "").trim();
		let segments = Array.isArray(entry?.segments) ? entry.segments.slice() : [];
		let cleanInput = String(inputText || "").trim();
		if (cleanInput) {
			segments.push({
				role: "user",
				content: cleanInput,
			});
		}
		let promptParts = [];
		if (instructions) {
			promptParts.push(`SYSTEM:\n${instructions}`);
		}
		for (let segment of segments) {
			let role = String(segment?.role || "user").trim().toUpperCase();
			let content = String(segment?.content || "").trim();
			if (content) {
				promptParts.push(`${role}:\n${content}`);
			}
		}
		return {
			instructions,
			segments,
			promptText: promptParts.join("\n\n").trim(),
		};
	},

	_localExecResponsesUsage(inputText = "", outputText = "") {
		let estimate = typeof SystematicReviewerTokenBudget != "undefined"
			? SystematicReviewerTokenBudget.estimateTextTokens
			: (value) => Math.max(0, Math.round(String(value || "").length / 4));
		let inputTokens = estimate(inputText);
		let outputTokens = estimate(outputText);
		return {
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			total_tokens: inputTokens + outputTokens,
		};
	},

	_localExecResponsesEnvelope(roleID, executor, payload = {}, text = "", options = {}) {
		let responseID = String(options?.responseID || "").trim()
			|| `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		let messageID = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		let previousResponseID = String(payload?.previous_response_id || payload?.previousResponseID || "").trim();
		let inputText = this._localExecResponsesInputText(payload);
		let instructionsText = this._localExecResponsesInstructionsText(payload);
		let previousEntry = this._localExecResponseStoreEntry(previousResponseID);
		let built = this._localExecBuildStoredPrompt(previousEntry, inputText, instructionsText);
		let storeEnabled = payload?.store === false ? false : true;
		if (storeEnabled) {
			this._localExecResponseStore.set(responseID, {
				instructions: built.instructions,
				segments: built.segments.concat([{
					role: "assistant",
					content: String(text || ""),
				}]),
				created_at: new Date().toISOString(),
				role_id: roleID,
			});
		}
		return {
			id: responseID,
			object: "response",
			created_at: Math.floor(Date.now() / 1000),
			status: "completed",
			model: String(payload?.model || this._localExecModelIdentifier(roleID, executor)),
			previous_response_id: previousResponseID || undefined,
			output: [{
				id: messageID,
				type: "message",
				status: "completed",
				role: "assistant",
				content: [{
					type: "output_text",
					text: String(text || ""),
					annotations: [],
				}],
			}],
			usage: this._localExecResponsesUsage(
				options?.usageInputText || inputText,
				text
			),
		};
	},

	_localExecResponsesPlanEnvelope(roleID, executor, payload = {}, plan = {}, options = {}) {
		let responseID = String(options?.responseID || "").trim()
			|| `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		let previousResponseID = String(payload?.previous_response_id || payload?.previousResponseID || "").trim();
		let inputText = this._localExecResponsesInputText(payload);
		let instructionsText = this._localExecResponsesInstructionsText(payload);
		let previousEntry = this._localExecResponseStoreEntry(previousResponseID);
		let built = this._localExecBuildStoredPrompt(previousEntry, inputText, instructionsText);
		let storeEnabled = payload?.store === false ? false : true;
		let output = [];
		let tokenSeed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		let reply = String(plan?.reply || "").trim();
		let thinking = String(plan?.thinking || "").trim();
		let toolCalls = Array.isArray(plan?.tool_calls) ? plan.tool_calls : [];
		let callFrames = Array.isArray(options?.callFrames) ? options.callFrames : [];
		if (thinking) {
			output.push({
				id: `rs_${tokenSeed}`,
				type: "reasoning",
				status: "completed",
				summary: [{
					type: "summary_text",
					text: thinking,
				}],
			});
		}
		if (toolCalls.length) {
			for (let index = 0; index < toolCalls.length; index += 1) {
				let call = toolCalls[index] || {};
				let frame = callFrames[index] && typeof callFrames[index] == "object" ? callFrames[index] : {};
				output.push({
					id: String(frame?.item_id || "").trim() || `fc_${tokenSeed}_${index + 1}`,
					type: "function_call",
					status: "completed",
					call_id: String(frame?.call_id || "").trim() || `call_${tokenSeed}_${index + 1}`,
					name: String(call?.name || "").trim(),
					arguments: this._localExecJSONString(call?.args && typeof call.args == "object" ? call.args : {}, "{}"),
				});
			}
		}
		else {
			output.push({
				id: `msg_${tokenSeed}`,
				type: "message",
				status: "completed",
				role: "assistant",
				content: [{
					type: "output_text",
					text: reply,
					annotations: [],
				}],
			});
		}
		if (storeEnabled) {
			let storedAssistantContent = toolCalls.length
				? this._localExecJSONString({
					reply,
					thinking,
					tool_calls: toolCalls,
				}, "{}")
				: reply;
			this._localExecResponseStore.set(responseID, {
				instructions: built.instructions,
				segments: built.segments.concat([{
					role: "assistant",
					content: storedAssistantContent,
				}]),
				created_at: new Date().toISOString(),
				role_id: roleID,
			});
		}
		return {
			id: responseID,
			object: "response",
			created_at: Math.floor(Date.now() / 1000),
			status: "completed",
			model: String(payload?.model || this._localExecModelIdentifier(roleID, executor)),
			previous_response_id: previousResponseID || undefined,
			output,
			usage: this._localExecResponsesUsage(
				options?.usageInputText || inputText,
				reply || this._localExecJSONString(toolCalls, "[]")
			),
		};
	},

	async _handleLocalExecResponsesRequest(roleID, payload = {}) {
		// Keep non-stream Responses calls on the exact same completion path as stream
		// so runtime tests, extraction, and chat finalize the assistant text identically.
		return await this._handleLocalExecResponsesStreamRequest(roleID, Object.assign({}, payload || {}, {
			stream: false,
		}), null, {});
	},

	async _handleLocalExecResponsesStreamRequest(roleID, payload = {}, handlers = {}, options = {}) {
		let resolved = await this._localExecResolvedRoleConfig(roleID, payload);
		let role = resolved.role || this._defaultRuntimeRole(roleID);
		if (role.runtime_type != "local_exec") {
			throw new Error(`${roleID} is not configured for local executor mode.`);
		}
			let executor = this._localExecExecutor(role);
			if (!executor?.installed || !executor?.binary_path) {
				throw new Error(`${roleID} local executor is not installed.`);
			}
			if (String(executor?.id || "").trim() == "opencode") {
				let payloadModel = String(payload?.model || "").trim();
				if (payloadModel && !payloadModel.startsWith("local-exec/")) {
					role = Object.assign({}, role, { model: payloadModel });
				}
			}
			let isOpenCodeExecutor = String(executor?.id || "").trim() == "opencode";
			let promptText = this._localExecResponsesInputText(payload);
			let hasOpenCodeBridgeInput = isOpenCodeExecutor && this._localExecOpenCodeResponsesInputHasContent(payload);
		if (!promptText && !hasOpenCodeBridgeInput) {
			throw new Error("Responses input is required.");
		}
		let built = this._localExecBuildStoredPrompt(
			null,
			promptText,
			this._localExecResponsesInstructionsText(payload)
		);
		if (!built.promptText && !hasOpenCodeBridgeInput) {
			throw new Error("Responses input is required.");
		}
		let tools = this._localExecResponsesFunctionTools(payload);
		let timeoutMs = Math.max(
			30000,
			Number(payload?.timeout_ms || payload?.timeoutMs || role.timeout_ms || 120000) || 120000
		);
		let reasoningEffort = String(payload?.reasoning?.effort || "").trim().toLowerCase();
		let responseID = `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		let model = String(payload?.model || this._localExecModelIdentifier(roleID, executor)).trim();
		await handlers?.onEvent?.({
			type: "response.created",
			response: {
				id: responseID,
				object: "response",
				created_at: Math.floor(Date.now() / 1000),
				status: "in_progress",
				model,
			},
		});
		if (tools.length) {
			let bridgedPrompt = isOpenCodeExecutor
				? this._localExecOpenCodeToolBridgePrompt(payload, built)
				: this._localExecResponsesToolBridgePrompt(payload, built);
			let parsePlan = (text) => isOpenCodeExecutor
				? this._localExecOpenCodePlanFromText(text, payload, { model })
				: this._localExecResponsesPlanFromText(text, payload);
			let parsePlanWithOpenCodeRepair = async (rawText = "", firstError = null) => {
				if (!isOpenCodeExecutor) {
					throw firstError;
				}
				let repairPrompt = this._localExecOpenCodeRepairPrompt(rawText, firstError, payload);
				let repaired = await this._runLocalExecTextStream(roleID, role, repairPrompt, {
					timeoutMs,
					reasoningEffort,
					signal: options?.signal || null,
					outputSchema: this._localExecResponsesPlanSchema(payload),
					advertisedTools: this._localExecOpenCodeToolSummary(payload),
				});
				try {
					return parsePlan(repaired?.text || "");
				}
				catch (repairError) {
					throw this._localExecOpenCodeDiagnosticError(repairError, repaired?.text || rawText, model, payload);
				}
			};
			let reasoningItemID = "";
			let reasoningText = "";
			let previewToolCallsEmitted = false;
			let previewCallFrames = [];
			let emitReasoningDelta = async (deltaText = "", fullText = "") => {
				let delta = String(deltaText || "");
				let nextFull = String(fullText || reasoningText || "");
				if (!delta && !nextFull) {
					return;
				}
				if (!reasoningItemID) {
					reasoningItemID = `rs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
					await handlers?.onEvent?.({
						type: "response.output_item.added",
						response_id: responseID,
						item: {
							id: reasoningItemID,
							type: "reasoning",
							status: "in_progress",
							summary: [],
						},
					});
				}
				reasoningText = nextFull || (reasoningText ? `${reasoningText}${delta}` : delta);
				await handlers?.onEvent?.({
					type: "response.reasoning.delta",
					response_id: responseID,
					item_id: reasoningItemID,
					delta: delta || nextFull,
					text: reasoningText,
				});
			};
			try {
				let result = await this._runLocalExecTextStream(roleID, role, bridgedPrompt, {
					timeoutMs,
					reasoningEffort,
					signal: options?.signal || null,
					outputSchema: this._localExecResponsesPlanSchema(payload),
					advertisedTools: isOpenCodeExecutor ? this._localExecOpenCodeToolSummary(payload) : null,
					onEvent: async (event = {}) => {
						let type = String(event?.type || "").trim();
						if (type == "local_exec.reasoning_delta") {
							await emitReasoningDelta(String(event?.delta || ""), String(event?.text || ""));
							return;
						}
						if (type != "local_exec.agent_message") {
							return;
						}
						let nextText = String(event?.text || "").trim();
						if (!nextText) {
							return;
						}
						let previewText = nextText;
						let previewPlan = null;
						try {
							previewPlan = parsePlan(nextText);
						}
						catch (_error) {
							previewPlan = null;
						}
						if (previewPlan) {
							previewText = String(previewPlan?.thinking || previewPlan?.reply || nextText).trim() || nextText;
							if (Array.isArray(previewPlan?.tool_calls) && previewPlan.tool_calls.length && !previewToolCallsEmitted) {
								for (let index = 0; index < previewPlan.tool_calls.length; index += 1) {
									let call = previewPlan.tool_calls[index] || {};
									let callID = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}_${index + 1}`;
									let itemID = `fc_${callID}`;
									let argumentsText = this._localExecJSONString(call?.args && typeof call.args == "object" ? call.args : {}, "{}");
									previewCallFrames[index] = {
										call_id: callID,
										item_id: itemID,
									};
									await handlers?.onEvent?.({
										type: "response.output_item.added",
										response_id: responseID,
										item: {
											id: itemID,
											type: "function_call",
											status: "completed",
											call_id: callID,
											name: String(call?.name || "").trim(),
											arguments: "",
										},
									});
									await handlers?.onEvent?.({
										type: "response.function_call_arguments.delta",
										response_id: responseID,
										call_id: callID,
										name: String(call?.name || "").trim(),
										delta: argumentsText,
									});
								}
								previewToolCallsEmitted = true;
							}
						}
						if (!reasoningItemID) {
							reasoningItemID = `rs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
							await handlers?.onEvent?.({
								type: "response.output_item.added",
								response_id: responseID,
								item: {
									id: reasoningItemID,
									type: "reasoning",
									status: "in_progress",
									summary: [],
								},
							});
						}
						let deltaText = previewText.startsWith(reasoningText)
							? previewText.slice(reasoningText.length)
							: (reasoningText ? `\n${previewText}` : previewText);
						reasoningText = reasoningText
							? (previewText.startsWith(reasoningText) ? previewText : `${reasoningText}\n${previewText}`.trim())
							: previewText;
						if (!deltaText) {
							return;
						}
						await handlers?.onEvent?.({
							type: "response.reasoning.delta",
							response_id: responseID,
							item_id: reasoningItemID,
							delta: deltaText,
							text: reasoningText,
						});
					},
				});
				let plan = null;
				try {
					plan = parsePlan(result?.text || "");
				}
				catch (firstError) {
					plan = await parsePlanWithOpenCodeRepair(result?.text || "", firstError);
				}
				if (plan?.thinking && !reasoningItemID) {
					reasoningItemID = `rs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
					await handlers?.onEvent?.({
						type: "response.output_item.added",
						response_id: responseID,
						item: {
							id: reasoningItemID,
							type: "reasoning",
							status: "in_progress",
							summary: [],
						},
					});
					await handlers?.onEvent?.({
						type: "response.reasoning.delta",
						response_id: responseID,
						item_id: reasoningItemID,
						delta: String(plan.thinking || ""),
						text: String(plan.thinking || ""),
					});
				}
				if (Array.isArray(plan?.tool_calls) && plan.tool_calls.length) {
					if (!previewToolCallsEmitted) {
						for (let index = 0; index < plan.tool_calls.length; index += 1) {
							let call = plan.tool_calls[index] || {};
							let callID = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}_${index + 1}`;
							let itemID = `fc_${callID}`;
							let argumentsText = this._localExecJSONString(call?.args && typeof call.args == "object" ? call.args : {}, "{}");
							previewCallFrames[index] = {
								call_id: callID,
								item_id: itemID,
							};
							await handlers?.onEvent?.({
								type: "response.output_item.added",
								response_id: responseID,
								item: {
									id: itemID,
									type: "function_call",
									status: "completed",
									call_id: callID,
									name: String(call?.name || "").trim(),
									arguments: "",
								},
							});
							await handlers?.onEvent?.({
								type: "response.function_call_arguments.delta",
								response_id: responseID,
								call_id: callID,
								name: String(call?.name || "").trim(),
								delta: argumentsText,
							});
						}
					}
				}
				else if (String(plan?.reply || "").trim()) {
					await handlers?.onEvent?.({
						type: "response.output_text.delta",
						response_id: responseID,
						delta: String(plan.reply || ""),
						text: String(plan.reply || ""),
					});
					await handlers?.onEvent?.({
						type: "response.output_text.done",
						response_id: responseID,
						text: String(plan.reply || ""),
					});
				}
				let envelope = this._localExecResponsesPlanEnvelope(roleID, executor, Object.assign({}, payload || {}, {
					store: false,
					previous_response_id: "",
				}), plan, {
					usageInputText: bridgedPrompt,
					responseID,
					callFrames: previewCallFrames,
				});
				await handlers?.onEvent?.({
					type: "response.completed",
					response: envelope,
				});
				return envelope;
			}
			catch (error) {
				await handlers?.onEvent?.({
					type: "response.error",
					error: {
						message: error?.message || String(error),
					},
				});
				throw error;
			}
		}
		let latestText = "";
		let directReasoningItemID = "";
		let directReasoningText = "";
		try {
			let directPrompt = isOpenCodeExecutor
				? this._localExecOpenCodeDirectPrompt(payload, built)
				: built.promptText;
			let result = await this._runLocalExecTextStream(roleID, role, directPrompt, {
				timeoutMs,
				reasoningEffort,
				signal: options?.signal || null,
				advertisedTools: isOpenCodeExecutor ? this._localExecOpenCodeToolSummary(payload) : null,
				onDelta: async (delta, fullText) => {
					latestText = String(fullText || "");
					if (!delta) {
						return;
					}
					await handlers?.onEvent?.({
						type: "response.output_text.delta",
						response_id: responseID,
						delta: String(delta || ""),
						text: latestText,
					});
				},
				onEvent: async (event = {}) => {
					let type = String(event?.type || "").trim();
					if (type == "local_exec.reasoning_delta") {
						let deltaText = String(event?.delta || "");
						let fullText = String(event?.text || "");
						if (!deltaText && !fullText) {
							return;
						}
						if (!directReasoningItemID) {
							directReasoningItemID = `rs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
							await handlers?.onEvent?.({
								type: "response.output_item.added",
								response_id: responseID,
								item: {
									id: directReasoningItemID,
									type: "reasoning",
									status: "in_progress",
									summary: [],
								},
							});
						}
						directReasoningText = fullText || (directReasoningText ? `${directReasoningText}${deltaText}` : deltaText);
						await handlers?.onEvent?.({
							type: "response.reasoning.delta",
							response_id: responseID,
							item_id: directReasoningItemID,
							delta: deltaText || fullText,
							text: directReasoningText,
						});
						return;
					}
					if (type == "local_exec.agent_message") {
						await handlers?.onEvent?.({
							type: "response.agent_message",
							response_id: responseID,
							item_id: String(event?.item_id || "").trim(),
							text: String(event?.text || "").trim(),
						});
						return;
					}
					if (type == "local_exec.command.started") {
						await handlers?.onEvent?.({
							type: "response.command.started",
							response_id: responseID,
							item_id: String(event?.item_id || "").trim(),
							command: String(event?.command || "").trim(),
						});
						return;
					}
					if (type == "local_exec.command.completed") {
						await handlers?.onEvent?.({
							type: "response.command.completed",
							response_id: responseID,
							item_id: String(event?.item_id || "").trim(),
							command: String(event?.command || "").trim(),
							output: String(event?.output || ""),
							exit_code: Number(event?.exit_code || 0) || 0,
						});
					}
				},
			});
			let finalText = String(result?.text || latestText || "").trim();
			let envelope = this._localExecResponsesEnvelope(roleID, executor, Object.assign({}, payload || {}, {
				store: false,
				previous_response_id: "",
			}), finalText, {
				usageInputText: built.promptText,
				responseID,
			});
			await handlers?.onEvent?.({
				type: "response.output_text.done",
				response_id: responseID,
				text: finalText,
			});
			await handlers?.onEvent?.({
				type: "response.completed",
				response: envelope,
			});
			return envelope;
		}
		catch (error) {
			await handlers?.onEvent?.({
				type: "response.error",
				error: {
					message: error?.message || String(error),
				},
			});
			throw error;
		}
	},
};
