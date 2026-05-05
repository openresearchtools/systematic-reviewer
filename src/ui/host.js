const BASE_PATH = "/systematic-reviewer/workflow";
const LOCATION = typeof window != "undefined" ? new URL(window.location.href) : null;
const PROJECT_ID = LOCATION?.searchParams?.get("project_id") || "";
const TAB_ID = LOCATION?.searchParams?.get("tab_id") || "";
const ACTIVE_TAB = LOCATION?.searchParams?.get("active_tab") || "";

async function parseJSONResponse(response) {
  let text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  }
  catch (_err) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  const formatError = (value) => {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "object") {
      const message = String(value.message || "").trim();
      const type = String(value.type || "").trim();
      if (message && type && type !== message) {
        return `${message} (${type})`;
      }
      if (message) {
        return message;
      }
      if (type) {
        return type;
      }
    }
    return String(value || "").trim();
  };
  if (!response.ok || payload?.ok === false) {
    throw new Error(formatError(payload?.error) || `HTTP ${response.status}`);
  }
  return payload;
}

export async function invoke(command, payload = {}) {
  const nextPayload = Object.assign({}, payload || {});
  if (PROJECT_ID && !nextPayload.project_id && !nextPayload.projectID) {
    nextPayload.project_id = PROJECT_ID;
  }
  if (ACTIVE_TAB && !nextPayload.active_tab && !nextPayload.activeTab) {
    nextPayload.active_tab = ACTIVE_TAB;
  }
  if (TAB_ID && !nextPayload.tab_id && !nextPayload.tabID) {
    nextPayload.tab_id = TAB_ID;
  }
  const response = await fetch(`${BASE_PATH}/commands/call`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command, payload: nextPayload }),
  });
  const parsed = await parseJSONResponse(response);
  return parsed.result;
}

export async function listCommands() {
  const response = await fetch(`${BASE_PATH}/commands/list`, {
    credentials: "same-origin",
  });
  const parsed = await parseJSONResponse(response);
  return parsed.commands || [];
}

export async function ping() {
  const response = await fetch(`${BASE_PATH}/ping`, {
    credentials: "same-origin",
  });
  return await parseJSONResponse(response);
}

export async function readEventStream(url, payload = {}, onEvent = null, options = {}) {
  const response = await fetch(String(url || ""), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload || {}),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(await response.text() || `HTTP ${response.status}`);
  }
  if (!response.body || typeof response.body.getReader != "function") {
    throw new Error("Streaming response body is unavailable.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const isAbortLikeError = (error) => {
    const message = String(error?.message || error || "").toLowerCase();
    return options?.signal?.aborted
      && (
        String(error?.name || "") === "AbortError"
        || message.includes("aborted")
        || message.includes("cancel")
        || message.includes("readablestream.cancel")
      );
  };
  const emit = async (rawBlock) => {
    const text = String(rawBlock || "").replace(/\r\n/g, "\n").trim();
    if (!text) {
      return;
    }
    let eventName = "";
    const dataLines = [];
    for (const line of text.split("\n")) {
      if (!line || line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    const dataText = dataLines.join("\n").trim();
    if (!dataText || dataText == "[DONE]") {
      return;
    }
    let payloadValue = null;
    try {
      payloadValue = JSON.parse(dataText);
    }
    catch (_error) {
      payloadValue = {
        type: eventName || "message",
        data: dataText,
      };
    }
    if (payloadValue && typeof payloadValue == "object" && !payloadValue.type && eventName) {
      payloadValue.type = eventName;
    }
    await onEvent?.(payloadValue);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        await emit(block);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    await emit(buffer);
  }
  catch (error) {
    if (!isAbortLikeError(error)) {
      throw error;
    }
  }
  finally {
    try {
      reader.releaseLock();
    }
    catch (_error) {}
  }
}
