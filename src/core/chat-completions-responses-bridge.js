var SystematicReviewerChatCompletionsResponsesBridge = (() => {
	function trimString(value = "") {
		return String(value ?? "").trim();
	}

	function makeID(prefix = "chatcmpl_bridge") {
		return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
	}

	function serializeContent(value = "") {
		if (value === undefined || value === null) {
			return "";
		}
		if (typeof value == "string") {
			return value;
		}
		try {
			return JSON.stringify(value);
		}
		catch (_error) {
			return String(value || "");
		}
	}

	function normalizeToolParameters(parameters = null) {
		if (parameters && typeof parameters == "object" && !Array.isArray(parameters)) {
			return parameters;
		}
		return {
			type: "object",
			properties: {},
			additionalProperties: false,
		};
	}

	function responsesToolFunction(entry = null) {
		if (!entry || typeof entry != "object") {
			return null;
		}
		let fn = entry.function && typeof entry.function == "object" ? entry.function : null;
		let type = trimString(entry.type || fn?.type || "function");
		if (type && type != "function") {
			return null;
		}
		let name = trimString(entry.name || fn?.name || "");
		if (!name) {
			return null;
		}
		return {
			name,
			description: trimString(entry.description || fn?.description || ""),
			parameters: normalizeToolParameters(entry.parameters || fn?.parameters || null),
		};
	}

	function advertisedToolMap(payload = {}) {
		let map = new Map();
		for (let entry of Array.isArray(payload?.tools) ? payload.tools : []) {
			let fn = responsesToolFunction(entry);
			if (fn?.name) {
				map.set(fn.name, fn);
			}
		}
		return map;
	}

	function chatToolsFromResponses(payload = {}) {
		let out = [];
		for (let fn of advertisedToolMap(payload).values()) {
			out.push({
				type: "function",
				function: {
					name: fn.name,
					description: fn.description,
					parameters: fn.parameters,
				},
			});
		}
		return out;
	}

	function normalizeChatRole(role = "") {
		let normalized = trimString(role || "user").toLowerCase();
		if (normalized == "developer") {
			return "system";
		}
		if (["system", "user", "assistant", "tool"].includes(normalized)) {
			return normalized;
		}
		return "user";
	}

	function imageURLFromPart(part = {}) {
		if (typeof part?.image_url == "string") {
			return part.image_url;
		}
		if (part?.image_url && typeof part.image_url == "object") {
			return trimString(part.image_url.url || "");
		}
		if (typeof part?.url == "string") {
			return part.url;
		}
		return "";
	}

	function contentPartToChat(part = null) {
		if (part === undefined || part === null) {
			return null;
		}
		if (typeof part == "string") {
			return part ? { type: "text", text: part } : null;
		}
		if (typeof part != "object") {
			let text = serializeContent(part);
			return text ? { type: "text", text } : null;
		}
		let type = trimString(part.type || "input_text");
		if (type == "input_image" || type == "image_url") {
			let url = imageURLFromPart(part);
			return url ? { type: "image_url", image_url: { url } } : null;
		}
		let text = "";
		if (typeof part.text == "string") {
			text = part.text;
		}
		else if (typeof part.content == "string") {
			text = part.content;
		}
		else if (part.content !== undefined && part.content !== null) {
			text = serializeContent(part.content);
		}
		else if (part.output !== undefined && part.output !== null) {
			text = serializeContent(part.output);
		}
		return text ? { type: "text", text } : null;
	}

	function contentToChat(content = "") {
		if (typeof content == "string") {
			return content;
		}
		let parts = Array.isArray(content)
			? content.map((part) => contentPartToChat(part)).filter(Boolean)
			: [contentPartToChat(content)].filter(Boolean);
		if (!parts.length) {
			return "";
		}
		let hasImages = parts.some((part) => part.type == "image_url");
		if (!hasImages && parts.every((part) => part.type == "text")) {
			return parts.map((part) => part.text || "").join("\n");
		}
		return parts;
	}

	function functionCallArgumentsText(item = {}) {
		if (typeof item.arguments == "string") {
			return item.arguments;
		}
		if (item.arguments !== undefined && item.arguments !== null) {
			return serializeContent(item.arguments);
		}
		if (typeof item.args_json == "string") {
			return item.args_json;
		}
		if (typeof item.args == "string") {
			return item.args;
		}
		if (item.args !== undefined && item.args !== null) {
			return serializeContent(item.args);
		}
		return "{}";
	}

	function inputItemToChatMessages(item = null) {
		if (item === undefined || item === null) {
			return [];
		}
		if (typeof item == "string") {
			return item.trim() ? [{ role: "user", content: item }] : [];
		}
		if (typeof item != "object") {
			let text = serializeContent(item);
			return text ? [{ role: "user", content: text }] : [];
		}
		let type = trimString(item.type || "");
		if (type == "function_call") {
			let name = trimString(item.name || "");
			let callID = trimString(item.call_id || item.callID || item.id || makeID("call"));
			if (!name) {
				return [];
			}
			return [{
				role: "assistant",
				content: null,
				tool_calls: [{
					id: callID,
					type: "function",
					function: {
						name,
						arguments: functionCallArgumentsText(item),
					},
				}],
			}];
		}
		if (type == "function_call_output" || type == "tool_output") {
			let callID = trimString(item.call_id || item.callID || item.tool_call_id || item.id || "");
			let content = item.output !== undefined ? item.output : (item.content !== undefined ? item.content : "");
			return [{
				role: "tool",
				tool_call_id: callID,
				content: serializeContent(content),
			}];
		}
		let role = normalizeChatRole(item.role || "user");
		let content = contentToChat(item.content !== undefined ? item.content : item.text || "");
		if (!content || (Array.isArray(content) && !content.length)) {
			return [];
		}
		return [{ role, content }];
	}

	function messagesFromResponsesPayload(payload = {}) {
		let messages = [];
		let instructions = trimString(payload.instructions || "");
		if (instructions) {
			messages.push({ role: "system", content: instructions });
		}
		let input = payload.input;
		if (typeof input == "string") {
			if (input.trim()) {
				messages.push({ role: "user", content: input });
			}
		}
		else if (Array.isArray(input)) {
			for (let item of input) {
				messages.push(...inputItemToChatMessages(item));
			}
		}
		else if (Array.isArray(payload.messages)) {
			for (let message of payload.messages) {
				messages.push(...inputItemToChatMessages(message));
			}
		}
		return messages.length ? messages : [{ role: "user", content: "" }];
	}

	function buildChatCompletionsPayload(client = {}, payload = {}, options = {}) {
		let body = {
			model: trimString(client.model || payload.model || ""),
			messages: messagesFromResponsesPayload(payload),
		};
		let maxTokens = Number(payload.max_output_tokens || client.maxOutputTokens || 0) || 0;
		if (maxTokens > 0) {
			body.max_tokens = maxTokens;
		}
		let tools = chatToolsFromResponses(payload);
		if (tools.length) {
			body.tools = tools;
			if (payload.tool_choice !== undefined) {
				body.tool_choice = payload.tool_choice;
			}
		}
		if (!!options.stream || payload.stream === true) {
			body.stream = true;
		}
		return body;
	}

	function chatChoiceMessage(choice = {}) {
		return choice?.message && typeof choice.message == "object" ? choice.message : {};
	}

	function normalizeReturnedToolName(name = "", _toolMap = new Map()) {
		let clean = trimString(name);
		return clean;
	}

	function responseEnvelopeFromChatCompletion(json = {}, payload = {}, toolMap = new Map(), state = null) {
		let choice = json?.choices?.[0] || {};
		let message = state ? {} : chatChoiceMessage(choice);
		let text = state ? trimString(state.text || "") : trimString(message.content || "");
		let output = [];
		if (text) {
			output.push({
				id: makeID("msg"),
				type: "message",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text }],
			});
		}
		let calls = state
			? Array.from(state.toolCalls.values())
			: (Array.isArray(message.tool_calls) ? message.tool_calls : []);
		if (!state && message.function_call && typeof message.function_call == "object") {
			calls = calls.concat([{
				id: makeID("call"),
				type: "function",
				function: message.function_call,
			}]);
		}
		for (let call of calls) {
			let fn = call?.function && typeof call.function == "object" ? call.function : call;
			let name = normalizeReturnedToolName(fn?.name || call?.name || "", toolMap);
			if (!name) {
				continue;
			}
			let callID = trimString(call?.id || call?.call_id || call?.callID || makeID("call"));
			let args = typeof fn?.arguments == "string"
				? fn.arguments
				: (fn?.arguments !== undefined && fn?.arguments !== null
					? serializeContent(fn.arguments)
					: (typeof call?.argumentsText == "string" ? call.argumentsText : "{}"));
			output.push({
				id: callID,
				type: "function_call",
				status: "completed",
				call_id: callID,
				name,
				arguments: args || "{}",
			});
		}
		return {
			id: trimString(json?.id || state?.responseID || makeID("resp")),
			object: "response",
			created_at: Number(json?.created || Math.floor(Date.now() / 1000)) || Math.floor(Date.now() / 1000),
			model: trimString(json?.model || payload?.model || ""),
			status: "completed",
			finish_reason: trimString(choice?.finish_reason || state?.finishReason || "completed"),
			output,
			usage: json?.usage && typeof json.usage == "object" ? json.usage : null,
		};
	}

	function createStreamState(payload = {}) {
		return {
			responseID: makeID("resp"),
			text: "",
			finishReason: "",
			toolCalls: new Map(),
			outputTextDone: false,
		};
	}

	function streamToolCall(state, deltaCall = {}) {
		let index = Number(deltaCall.index || 0) || 0;
		let current = state.toolCalls.get(index) || {
			id: "",
			type: "function",
			function: {
				name: "",
				arguments: "",
			},
			itemAdded: false,
			emittedArgumentsLength: 0,
		};
		if (deltaCall.id) {
			current.id = trimString(deltaCall.id);
		}
		if (deltaCall.function?.name) {
			current.function.name = trimString(deltaCall.function.name);
		}
		if (typeof deltaCall.function?.arguments == "string") {
			current.function.arguments += deltaCall.function.arguments;
		}
		if (!current.id) {
			current.id = makeID("call");
		}
		state.toolCalls.set(index, current);
		return current;
	}

	async function emitToolCallAddedIfReady(state, call, toolMap, handlers) {
		let name = normalizeReturnedToolName(call?.function?.name || "", toolMap);
		if (!name || call.itemAdded) {
			return;
		}
		call.itemAdded = true;
		await handlers?.onEvent?.({
			type: "response.output_item.added",
			response_id: state.responseID,
			item: {
				id: call.id,
				type: "function_call",
				status: "in_progress",
				call_id: call.id,
				name,
				arguments: "",
			},
		});
	}

	async function applyChatStreamEvent(state, event = {}, toolMap = new Map(), handlers = {}) {
		if (event?.id && !state.responseID) {
			state.responseID = trimString(event.id);
		}
		for (let choice of Array.isArray(event?.choices) ? event.choices : []) {
			let delta = choice?.delta && typeof choice.delta == "object" ? choice.delta : {};
			if (typeof delta.content == "string" && delta.content) {
				state.text += delta.content;
				await handlers?.onEvent?.({
					type: "response.output_text.delta",
					response_id: state.responseID,
					delta: delta.content,
					text: state.text,
				});
			}
			for (let deltaCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
				let call = streamToolCall(state, deltaCall);
				await emitToolCallAddedIfReady(state, call, toolMap, handlers);
				let argDelta = String(deltaCall.function?.arguments || "");
				if (argDelta && call.itemAdded) {
					await handlers?.onEvent?.({
						type: "response.function_call_arguments.delta",
						response_id: state.responseID,
						item_id: call.id,
						call_id: call.id,
						delta: argDelta,
					});
					call.emittedArgumentsLength = call.function.arguments.length;
				}
			}
			if (delta.function_call && typeof delta.function_call == "object") {
				let call = streamToolCall(state, {
					index: 0,
					function: delta.function_call,
				});
				await emitToolCallAddedIfReady(state, call, toolMap, handlers);
				let argDelta = String(delta.function_call.arguments || "");
				if (argDelta && call.itemAdded) {
					await handlers?.onEvent?.({
						type: "response.function_call_arguments.delta",
						response_id: state.responseID,
						item_id: call.id,
						call_id: call.id,
						delta: argDelta,
					});
					call.emittedArgumentsLength = call.function.arguments.length;
				}
			}
			if (choice?.finish_reason) {
				state.finishReason = trimString(choice.finish_reason);
			}
		}
	}

	async function finalizeStream(state, payload, toolMap, handlers, deps, raw = {}) {
		for (let call of state.toolCalls.values()) {
			await emitToolCallAddedIfReady(state, call, toolMap, handlers);
			let remainingArguments = call.function.arguments.slice(Number(call.emittedArgumentsLength || 0) || 0);
			if (call.itemAdded && remainingArguments) {
				await handlers?.onEvent?.({
					type: "response.function_call_arguments.delta",
					response_id: state.responseID,
					item_id: call.id,
					call_id: call.id,
					delta: remainingArguments,
				});
				call.emittedArgumentsLength = call.function.arguments.length;
			}
		}
		if (state.text && !state.outputTextDone) {
			state.outputTextDone = true;
			await handlers?.onEvent?.({
				type: "response.output_text.done",
				response_id: state.responseID,
				text: state.text,
			});
		}
		let envelope = responseEnvelopeFromChatCompletion(raw, payload, toolMap, state);
		await handlers?.onEvent?.({
			type: "response.completed",
			response: envelope,
		});
		return deps.deriveToolStateFromResponses(envelope);
	}

	async function requestResponses(client = {}, payload = {}, options = {}, deps = {}) {
		if (!deps.postJson || !deps.postEventStream || !deps.deriveToolStateFromResponses) {
			throw new Error("Chat Completions bridge dependencies are unavailable.");
		}
		let baseUrl = trimString(client.baseUrl || "").replace(/\/+$/, "");
		let streamBaseUrl = trimString(client.streamBaseUrl || client.baseUrl || "").replace(/\/+$/, "");
		let toolMap = advertisedToolMap(payload);
		let body = buildChatCompletionsPayload(client, payload, options);
		let useStream = !!options.stream || payload.stream === true;
		if (useStream) {
			let state = createStreamState(payload);
			let lastChunk = {};
			await deps.postEventStream(
				`${streamBaseUrl}/chat/completions`,
				body,
				client.apiKey,
				client.timeoutMs,
				async (event) => {
					lastChunk = event && typeof event == "object" ? event : lastChunk;
					await applyChatStreamEvent(state, event, toolMap, {
						onEvent: options.onEvent,
					});
				},
				{ signal: options.signal || null }
			);
			return await finalizeStream(state, payload, toolMap, { onEvent: options.onEvent }, deps, lastChunk);
		}
		let json = await deps.postJson(
			`${baseUrl}/chat/completions`,
			body,
			client.apiKey,
			client.timeoutMs,
			{ signal: options.signal || null }
		);
		let envelope = responseEnvelopeFromChatCompletion(json, payload, toolMap);
		return deps.deriveToolStateFromResponses(envelope);
	}

	return {
		requestResponses,
		buildChatCompletionsPayload,
		responseEnvelopeFromChatCompletion,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerChatCompletionsResponsesBridge;
}
