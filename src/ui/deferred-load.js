const selectorCache = new Map();

function cacheKey(projectID = "", selectorKey = "", scopeKey = "") {
  return [
    String(projectID || "").trim(),
    String(selectorKey || "").trim(),
    String(scopeKey || "").trim(),
  ].join("::");
}

export function readSelectorCache(projectID = "", selectorKey = "", scopeKey = "") {
  return selectorCache.get(cacheKey(projectID, selectorKey, scopeKey));
}

export function writeSelectorCache(projectID = "", selectorKey = "", scopeKey = "", value = null) {
  selectorCache.set(cacheKey(projectID, selectorKey, scopeKey), value);
  return value;
}

export function setSelectPlaceholder(select, label = "Loading...") {
  if (!select) {
    return;
  }
  const option = document.createElement("option");
  option.value = "";
  option.textContent = String(label || "Loading...");
  option.disabled = true;
  option.selected = true;
  select.replaceChildren(option);
  select.disabled = true;
}

export function setSelectEntries(select, entries = [], options = {}) {
  if (!select) {
    return "";
  }
  const list = Array.isArray(entries) ? entries : [];
  const current = String(options.currentValue ?? select.value ?? "").trim();
  const placeholder = String(options.placeholder || "").trim();
  const valueKey = String(options.valueKey || "value");
  const labelKey = String(options.labelKey || "label");
  const built = [];
  if (placeholder) {
    built.push({ value: "", label: placeholder, disabled: false });
  }
  for (const entry of list) {
    built.push({
      value: String(entry?.[valueKey] ?? ""),
      label: String(entry?.[labelKey] ?? entry?.[valueKey] ?? ""),
      disabled: entry?.disabled === true,
    });
  }
  select.replaceChildren(
    ...built.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      option.disabled = entry.disabled === true;
      return option;
    })
  );
  const nextValue = built.some((entry) => entry.value === current)
    ? current
    : String(options.fallbackValue ?? built.find((entry) => !entry.disabled)?.value ?? "");
  select.value = nextValue;
  select.disabled = built.filter((entry) => !entry.disabled).length <= 1 && !list.length;
  return select.value || "";
}

export function scheduleAfterPaint(callback) {
  let cancelled = false;
  let frameID = 0;
  let timerID = 0;
  const run = () => {
    if (cancelled) {
      return;
    }
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          callback?.();
        }
      })
      .catch(() => {});
  };
  if (typeof window != "undefined" && typeof window.requestAnimationFrame == "function") {
    frameID = window.requestAnimationFrame(() => {
      timerID = window.setTimeout(run, 0);
    });
  }
  else {
    timerID = setTimeout(run, 0);
  }
  return () => {
    cancelled = true;
    if (frameID && typeof window != "undefined" && typeof window.cancelAnimationFrame == "function") {
      window.cancelAnimationFrame(frameID);
    }
    if (timerID) {
      clearTimeout(timerID);
    }
  };
}

export function scheduleAfterIdle(callback, timeout = 300) {
  let cancelled = false;
  let idleID = 0;
  let timerID = 0;
  const run = () => {
    if (cancelled) {
      return;
    }
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          callback?.();
        }
      })
      .catch(() => {});
  };
  if (typeof window != "undefined" && typeof window.requestIdleCallback == "function") {
    idleID = window.requestIdleCallback(run, { timeout: Number(timeout || 300) || 300 });
  }
  else {
    timerID = setTimeout(run, Number(timeout || 300) || 300);
  }
  return () => {
    cancelled = true;
    if (idleID && typeof window != "undefined" && typeof window.cancelIdleCallback == "function") {
      window.cancelIdleCallback(idleID);
    }
    if (timerID) {
      clearTimeout(timerID);
    }
  };
}

export function isScopeMissingError(error) {
  const message = String(error?.message || error || "");
  return message.includes("Requested subcollection scope was not found inside the current project collection tree.");
}
