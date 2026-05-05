import { isScopeMissingError, readSelectorCache, scheduleAfterIdle, scheduleAfterPaint, setSelectEntries, setSelectPlaceholder, writeSelectorCache } from "./deferred-load.js";

function field(ctx, label, input, options = {}) {
  return ctx.createNode("label", {
    className: `mw-field${options.full ? " full" : ""}`,
    children: [
      ctx.createNode("span", { textContent: label }),
      input,
    ],
  });
}

function buildStoredList(ctx, stored = [], loading = false) {
  if (loading) {
    return ctx.createNode("div", { className: "mw-empty", textContent: "Loading stored embeddings..." });
  }
  if (!stored.length) {
    return ctx.createNode("div", { className: "mw-empty", textContent: "No embeddings have been stored for this project yet." });
  }
  return ctx.createNode("div", {
    className: "mw-result-list",
    children: stored.map((entry) =>
      ctx.createNode("div", {
        className: "mw-result-card",
        children: [
          ctx.createNode("div", {
            className: "mw-result-top",
            children: [
              ctx.createNode("div", { className: "mw-result-title", textContent: entry.source_label || entry.vector_column }),
              ctx.createNode("div", {
                className: "mw-meta",
                children: [
                  ctx.createNode("div", { className: "mw-badge", textContent: `${entry.vector_count || 0} vectors` }),
                  ctx.createNode("div", { className: "mw-badge", textContent: `${entry.vector_dim || 0} dims` }),
                ],
              }),
            ],
          }),
          ctx.createNode("div", { className: "mw-result-meta", textContent: entry.model || "Unknown model" }),
          ctx.createNode("div", {
            className: "mw-result-meta",
            textContent: entry.last_updated ? `Updated ${new Date(entry.last_updated).toLocaleString()}` : "",
          }),
        ],
      })
    ),
  });
}

function buildSearchableSourcePicker(ctx, registerCleanup = null, config = {}) {
  let options = [];
  let currentValue = "";
  let isOpen = false;
  let query = "";
  let shouldFocusSearch = false;
  let placeholder = String(config.placeholder || "Choose a source");
  const root = ctx.createNode("div", {
    className: `mw-screening-option-picker mw-screening-scope-picker${config.rootClassName ? ` ${config.rootClassName}` : ""}`,
  });
  const trigger = ctx.createNode("button", {
    className: `mw-button mw-screening-option-picker-trigger mw-screening-scope-picker-trigger${config.triggerClassName ? ` ${config.triggerClassName}` : ""}`,
    textContent: placeholder,
    attrs: {
      type: "button",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
    },
  });
  const menu = ctx.createNode("div", {
    className: `mw-screening-option-picker-menu mw-screening-scope-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}`,
    attrs: { role: "listbox" },
  });
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = String(config.searchPlaceholder || "Search sources...");
  searchInput.className = "mw-screening-option-picker-search";
  const head = ctx.createNode("div", {
    className: "mw-screening-option-picker-head",
    children: [searchInput],
  });
  const meta = ctx.createNode("div", { className: "mw-screening-option-picker-meta" });
  const list = ctx.createNode("div", { className: "mw-screening-option-picker-list" });
  head.append(meta);
  menu.append(head, list);
  document.body.appendChild(menu);

  function selectedOption() {
    return options.find((entry) => String(entry?.key || "") === String(currentValue || "")) || null;
  }

  function filteredOptions() {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) {
      return options.slice();
    }
    return options.filter((entry) => {
      const haystack = [
        String(entry?.label || ""),
        String(entry?.key || ""),
        String(entry?.search_text || ""),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  function optionMeta(entry) {
    const parts = [];
    if (entry?.key && String(entry.key || "") !== String(entry.label || "")) {
      parts.push(String(entry.key || ""));
    }
    if (entry?.item_count !== undefined && entry?.item_count !== null) {
      parts.push(`${Number(entry.item_count || 0) || 0} items`);
    }
    return parts.join(" · ");
  }

  function positionMenu() {
    if (!isOpen || !trigger.isConnected || !menu.isConnected) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    menu.style.left = "8px";
    menu.style.top = "8px";
    menu.style.minWidth = `${Math.max(280, Math.round(rect.width))}px`;
    const menuRect = menu.getBoundingClientRect();
    let left = rect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuRect.width - 8);
    }
    let top = rect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - 4);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function closePicker() {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    shouldFocusSearch = false;
    renderPicker();
  }

  function renderMenuOptions() {
    const visibleOptions = filteredOptions();
    meta.textContent = `${visibleOptions.length} of ${options.length} sources`;
    list.replaceChildren(...visibleOptions.map((entry) => {
      const key = String(entry?.key || "");
      const item = ctx.createNode("button", {
        className: `mw-screening-option-picker-item${key === currentValue ? " is-selected" : ""}`,
        attrs: {
          type: "button",
          role: "option",
          "aria-selected": key === currentValue ? "true" : "false",
        },
        children: [
          ctx.createNode("span", {
            className: "mw-screening-option-picker-item-label",
            textContent: entry?.label || key,
          }),
          optionMeta(entry)
            ? ctx.createNode("span", {
                className: "mw-screening-option-picker-item-key",
                textContent: optionMeta(entry),
              })
            : null,
        ].filter(Boolean),
      });
      item.addEventListener("click", () => {
        const changed = key !== currentValue;
        currentValue = key;
        closePicker();
        if (changed && typeof config.onChange === "function") {
          void config.onChange(currentValue);
        }
      });
      return item;
    }));
    if (!visibleOptions.length) {
      list.appendChild(ctx.createNode("div", {
        className: "mw-screening-option-picker-empty",
        textContent: String(config.emptyText || "No sources match this search."),
      }));
    }
  }

  function renderPicker() {
    const selected = selectedOption();
    trigger.textContent = selected?.label || placeholder;
    trigger.className = `mw-button mw-screening-option-picker-trigger mw-screening-scope-picker-trigger${config.triggerClassName ? ` ${config.triggerClassName}` : ""}${isOpen ? " is-open" : ""}`;
    trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    trigger.disabled = !options.length;
    menu.className = `mw-screening-option-picker-menu mw-screening-scope-picker-menu${config.menuClassName ? ` ${config.menuClassName}` : ""}${isOpen ? " is-open" : ""}`;
    renderMenuOptions();
    if (isOpen) {
      window.requestAnimationFrame(() => {
        positionMenu();
        if (shouldFocusSearch) {
          shouldFocusSearch = false;
          searchInput.focus();
          searchInput.select();
        }
      });
    }
  }

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isOpen) {
      query = "";
      searchInput.value = "";
      shouldFocusSearch = true;
    }
    isOpen = !isOpen;
    renderPicker();
  });

  searchInput.addEventListener("input", () => {
    query = String(searchInput.value || "");
    renderMenuOptions();
    if (isOpen) {
      window.requestAnimationFrame(() => positionMenu());
    }
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      trigger.focus();
    }
    else if (event.key === "Enter") {
      const first = filteredOptions()[0];
      if (first?.key) {
        event.preventDefault();
        const changed = String(first.key || "") !== currentValue;
        currentValue = String(first.key || "");
        closePicker();
        if (changed && typeof config.onChange === "function") {
          void config.onChange(currentValue);
        }
      }
    }
  });

  const outsideHandler = (event) => {
    if (!root.contains(event.target) && !menu.contains(event.target)) {
      closePicker();
    }
  };
  document.addEventListener("mousedown", outsideHandler, true);
  window.addEventListener("resize", positionMenu);
  window.addEventListener("scroll", positionMenu, true);
  if (typeof registerCleanup === "function") {
    registerCleanup(() => {
      document.removeEventListener("mousedown", outsideHandler, true);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      menu.remove();
    });
  }

  root.append(trigger);
  renderPicker();

  return {
    node: root,
    getValue: () => currentValue,
    setValue: (value) => {
      currentValue = String(value || "");
      renderPicker();
    },
    setOptions: (nextOptions = [], preferredValue = "") => {
      options = Array.isArray(nextOptions) ? nextOptions.slice() : [];
      const preferred = String(preferredValue || currentValue || "").trim();
      if (preferred && options.some((entry) => String(entry?.key || "") === preferred)) {
        currentValue = preferred;
      }
      else {
        currentValue = String(options?.[0]?.key || "");
      }
      renderPicker();
    },
    setPlaceholder: (value = "") => {
      placeholder = String(value || config.placeholder || "Choose a source");
      renderPicker();
    },
    close: closePicker,
  };
}

export function createEmbeddingsTab(ctx) {
  const panel = ctx.createNode("section", { className: "mw-tab-panel" });
  const scopeSelect = document.createElement("select");
  scopeSelect.setAttribute("data-embeddings-scope-select", "true");
  let state = null;
  const cleanupFns = [];
  const registerCleanup = (fn) => {
    if (typeof fn === "function") {
      cleanupFns.push(fn);
    }
  };
  const sourcePicker = buildSearchableSourcePicker(ctx, registerCleanup, {
    placeholder: "Loading text sources...",
    searchPlaceholder: "Search source label or key...",
    onChange: async (value) => {
      state.sourceKey = String(value || "");
      ctx.setStatus("Embeddings source updated.", "is-ready");
    },
  });
  const resumeInput = document.createElement("input");
  resumeInput.type = "checkbox";
  resumeInput.checked = true;
  const runButton = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Run Embeddings",
    attrs: { type: "button" },
  });
  const refreshButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Refresh",
    attrs: { type: "button" },
  });

  const storedCard = ctx.createNode("div", { className: "mw-card" });
  const projectID = String(ctx.bootstrap?.project?.project_id || ctx.bootstrap?.project?.collection_name || "project");
  state = {
    scopeKey: String(ctx.getSharedScopeKey?.() || ""),
    sourceKey: "title_abstract",
    lightweightScopes: [],
    stored: [],
    sources: [],
    storedLoaded: false,
    sourceToken: 0,
    scopeHydrationToken: 0,
    destroyed: false,
    cancelAfterPaint: null,
    cancelAfterIdle: null,
  };

  function selectorScopeKey() {
    return String(state.scopeKey || "");
  }

  function renderScopeOptions(scopes = [], preferredKey = "") {
    const current = String(preferredKey || state.scopeKey || scopeSelect.value || "").trim();
    const nextValue = setSelectEntries(scopeSelect, scopes, {
      valueKey: "collection_key",
      labelKey: "label",
      currentValue: current,
      fallbackValue: current,
    });
    state.scopeKey = String(nextValue || "");
  }

  function renderSources(entries = [], preferredKey = "") {
    state.sources = Array.isArray(entries) ? entries.slice() : [];
    const current = String(preferredKey || state.sourceKey || sourcePicker.getValue() || "").trim();
    sourcePicker.setOptions(state.sources, current);
    state.sourceKey = String(sourcePicker.getValue() || "");
  }

  function renderStored({ loading = false } = {}) {
    storedCard.replaceChildren(
      ctx.createNode("h3", { textContent: "Stored vectors" }),
      ctx.createNode("div", {
        className: "mw-muted",
        textContent: "Stored embeddings are reused by Semantic Search and semantic screening.",
      }),
      buildStoredList(ctx, state.stored, loading),
    );
  }

  async function loadScopes({ allowScopeReset = true, hydrateCounts = true } = {}) {
    try {
      const result = await ctx.invoke("workflow.scopes.list", { purpose: "embeddings" });
      state.lightweightScopes = Array.isArray(result?.scopes) ? result.scopes : [];
      renderScopeOptions(state.lightweightScopes, state.scopeKey);
      if (hydrateCounts && state.lightweightScopes.length) {
        const token = ++state.scopeHydrationToken;
        scheduleAfterIdle(async () => {
          if (state.destroyed || token !== state.scopeHydrationToken) {
            return;
          }
          try {
            const hydrated = await ctx.invoke("workflow.scopes.hydrate", {
              purpose: "embeddings",
              scopes: state.lightweightScopes,
            });
            if (state.destroyed || token !== state.scopeHydrationToken) {
              return;
            }
            state.lightweightScopes = Array.isArray(hydrated?.scopes) ? hydrated.scopes : state.lightweightScopes;
            renderScopeOptions(state.lightweightScopes, state.scopeKey);
          }
          catch (_error) {}
        }, 220);
      }
      return state.lightweightScopes;
    }
    catch (error) {
      if (allowScopeReset && state.scopeKey && isScopeMissingError(error)) {
        state.scopeKey = "";
        await Promise.resolve(ctx.rememberScopeKey?.("")).catch(() => {});
        return await loadScopes({ allowScopeReset: false, hydrateCounts });
      }
      throw error;
    }
  }

  async function loadSourceOptions({ force = false, allowScopeReset = true } = {}) {
    const cacheScopeKey = selectorScopeKey();
    const cacheKey = "embeddings:sources:list";
    const cached = !force ? readSelectorCache(projectID, cacheKey, cacheScopeKey) : null;
    if (cached?.sources) {
      renderSources(cached.sources, state.sourceKey || "title_abstract");
    }
    else {
      sourcePicker.setPlaceholder("Loading text sources...");
      renderSources([], "");
    }
    const token = ++state.sourceToken;
    try {
      const payload = {};
      if (state.scopeKey) {
        payload.collection_key = state.scopeKey;
      }
      const result = await ctx.invoke("workflow.options.embeddingsSources.list", payload);
      if (state.destroyed || token !== state.sourceToken) {
        return;
      }
      const sources = Array.isArray(result?.sources) ? result.sources : [];
      writeSelectorCache(projectID, cacheKey, cacheScopeKey, { sources });
      renderSources(sources, state.sourceKey || "title_abstract");
    }
    catch (error) {
      if (allowScopeReset && state.scopeKey && isScopeMissingError(error)) {
        state.scopeKey = "";
        await Promise.resolve(ctx.rememberScopeKey?.("")).catch(() => {});
        await loadScopes({ allowScopeReset: false });
        return await loadSourceOptions({ force, allowScopeReset: false });
      }
      throw error;
    }
  }

  async function hydrateStored({ force = false } = {}) {
    const cacheKey = "embeddings:stored:list";
    const cached = !force ? readSelectorCache(projectID, cacheKey) : null;
    if (cached?.stored) {
      state.stored = cached.stored;
      state.storedLoaded = true;
      renderStored();
      return;
    }
    renderStored({ loading: true });
    const result = await ctx.invoke("workflow.options.embeddingsStored.list", {});
    state.stored = Array.isArray(result?.stored) ? result.stored : [];
    state.storedLoaded = true;
    writeSelectorCache(projectID, cacheKey, "", { stored: state.stored });
    renderStored();
  }

  function startDeferredHydration({ force = false } = {}) {
    state.cancelAfterPaint?.();
    state.cancelAfterIdle?.();
    state.cancelAfterPaint = scheduleAfterPaint(() => {
      loadSourceOptions({ force }).catch((error) => {
        if (!state.destroyed) {
          ctx.setStatus(error?.message || String(error), "is-error");
        }
      });
    });
    state.cancelAfterIdle = scheduleAfterIdle(() => {
      hydrateStored({ force }).catch((error) => {
        if (!state.destroyed) {
          ctx.setStatus(error?.message || String(error), "is-error");
        }
      });
    }, 260);
  }

  async function refresh({ manual = false } = {}) {
    if (manual) {
      ctx.setStatus("Refreshing Embeddings...");
    }
    await loadScopes({ hydrateCounts: true });
    if (manual) {
      await Promise.all([
        loadSourceOptions({ force: true }),
        hydrateStored({ force: true }),
      ]);
      ctx.setStatus("Embeddings refreshed.", "is-ready");
      return;
    }
    startDeferredHydration({ force: false });
  }

  async function runEmbeddings() {
    const payload = {
      source_key: state.sourceKey || sourcePicker.getValue() || "title_abstract",
      resume: !!resumeInput.checked,
      detach: true,
    };
    if (state.scopeKey) {
      payload.collection_key = state.scopeKey;
    }
    ctx.setStatus("Queueing embeddings job...");
    const result = await ctx.invoke("embeddings.run", payload);
    await Promise.resolve(ctx.rememberTabJobID?.(result.job_id || "", "embeddings")).catch(() => {});
    state.cancelAfterIdle?.();
    state.cancelAfterIdle = scheduleAfterIdle(() => {
      hydrateStored({ force: true }).catch(() => {});
    }, 500);
    ctx.setStatus(result.message || "Job started. Track progress in Jobs.", "is-ready");
  }

  refreshButton.addEventListener("click", () => {
    refresh({ manual: true }).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });

  scopeSelect.addEventListener("change", () => {
    state.scopeKey = String(scopeSelect.value || "");
    Promise.resolve(ctx.rememberScopeKey?.(state.scopeKey || "")).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
    loadSourceOptions({ force: true }).then(() => {
      ctx.setStatus("Embeddings scope updated.", "is-ready");
    }).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });

  runButton.addEventListener("click", () => {
    runEmbeddings().catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });

    panel.append(
    ctx.createNode("div", {
      className: "mw-grid",
      children: [
        field(ctx, "Scope", scopeSelect),
        field(ctx, "Text source", sourcePicker.node),
        ctx.createNode("label", {
          className: "mw-toggle",
          children: [resumeInput, ctx.createNode("span", { textContent: "Skip rows already embedded with the current model" })],
        }),
        ctx.createNode("div", {
          className: "mw-actions full",
          children: [runButton, refreshButton],
        }),
      ],
    }),
    storedCard,
  );

  setSelectPlaceholder(scopeSelect, "Loading scopes...");
  sourcePicker.setPlaceholder("Loading text sources...");
  renderStored({ loading: true });

  Promise.resolve(ctx.readSharedScopeKey?.())
    .catch(() => String(ctx.getSharedScopeKey?.() || ""))
    .then((scopeKey) => {
      state.scopeKey = String(scopeKey || state.scopeKey || "");
      return refresh({ manual: false });
    })
    .catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });

  return {
    node: panel,
    refresh: async () => {
      await refresh({ manual: true });
    },
    destroy() {
      state.destroyed = true;
      state.cancelAfterPaint?.();
      state.cancelAfterIdle?.();
      sourcePicker.close();
      for (const cleanup of cleanupFns.splice(0)) {
        try {
          cleanup();
        }
        catch (_error) {}
      }
    },
  };
}
