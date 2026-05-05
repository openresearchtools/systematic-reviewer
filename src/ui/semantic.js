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

function buildInfoCard(ctx, state = {}) {
  return ctx.createNode("div", {
    className: "mw-card-stack",
    children: [
      ctx.createNode("div", {
        className: "mw-muted",
        textContent: state.currentModel
          ? `Semantic Search uses the current Embeddings model from Settings: ${state.currentModel}`
          : "Configure an Embeddings model in Settings before running Semantic Search.",
      }),
      ctx.createNode("div", {
        className: "mw-note",
        textContent: "This tab queues a search job and writes score columns for Screening. Track progress in Jobs and review scores in Screening.",
      }),
      state.message
        ? ctx.createNode("div", {
            className: "mw-code",
            textContent: state.message,
          })
        : null,
    ].filter(Boolean),
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

export function createSemanticTab(ctx) {
  const panel = ctx.createNode("section", { className: "mw-tab-panel" });
  const queryInput = document.createElement("textarea");
  queryInput.rows = 4;
  queryInput.placeholder = "(e.g. microplastic sediment)";
  const searchNameInput = document.createElement("input");
  searchNameInput.type = "text";
  searchNameInput.placeholder = "(e.g. Sediment semantic search)";
  const scopeSelect = document.createElement("select");
  scopeSelect.setAttribute("data-semantic-scope-select", "true");
  const vectorSelect = document.createElement("select");
  const limitInput = document.createElement("select");
  [
    ["all", "Unlimited"],
    ["10", "10"],
    ["25", "25"],
    ["50", "50"],
    ["100", "100"],
    ["250", "250"],
  ].forEach(([value, label]) => limitInput.appendChild(ctx.createNode("option", {
    attrs: { value },
    textContent: label,
  })));
  limitInput.value = "all";

  const searchButton = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Run Semantic Search",
    attrs: { type: "button" },
  });
  const refreshButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Refresh",
    attrs: { type: "button" },
  });

  const infoCard = ctx.createNode("div", { className: "mw-card" });
  const storedCard = ctx.createNode("div", { className: "mw-card" });
  const projectID = String(ctx.bootstrap?.project?.project_id || ctx.bootstrap?.project?.collection_name || "project");
  const state = {
    currentModel: "",
    message: "",
    scopeKey: String(ctx.getSharedScopeKey?.() || ""),
    lightweightScopes: [],
    stored: [],
    storedLoaded: false,
    destroyed: false,
    sourceToken: 0,
    scopeHydrationToken: 0,
    cancelAfterPaint: null,
    cancelAfterIdle: null,
  };

  function renderInfo() {
    infoCard.replaceChildren(
      ctx.createNode("h3", { textContent: "Semantic Search" }),
      buildInfoCard(ctx, state),
    );
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

  function renderSources(sources = [], preferredValue = "") {
    setSelectEntries(vectorSelect, (sources || []).map((entry) => ({
      value: entry.vector_column,
      label: `${entry.source_label || entry.vector_column}${entry.vector_count ? ` (${entry.vector_count} vectors)` : ""}`,
    })), {
      currentValue: preferredValue || vectorSelect.value || "",
      fallbackValue: preferredValue || vectorSelect.value || "",
    });
    vectorSelect.disabled = !(Array.isArray(sources) && sources.length);
  }

  async function loadScopes({ allowScopeReset = true, hydrateCounts = true } = {}) {
    try {
      const result = await ctx.invoke("workflow.scopes.list", { purpose: "semantic" });
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
              purpose: "semantic",
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
    const cacheKey = "semantic:sources:list";
    const scopeCacheKey = String(state.scopeKey || "");
    const cached = !force ? readSelectorCache(projectID, cacheKey, scopeCacheKey) : null;
    if (cached?.sources) {
      state.currentModel = String(cached.current_model || "");
      renderSources(cached.sources, vectorSelect.value || "");
      renderInfo();
    }
    else {
      setSelectPlaceholder(vectorSelect, "Loading embedding sources...");
    }
    const token = ++state.sourceToken;
    try {
      const payload = {};
      if (state.scopeKey) {
        payload.collection_key = state.scopeKey;
      }
      const result = await ctx.invoke("workflow.options.semanticSources.list", payload);
      if (state.destroyed || token !== state.sourceToken) {
        return;
      }
      const next = {
        current_model: String(result?.current_model || ""),
        sources: Array.isArray(result?.sources) ? result.sources : [],
      };
      writeSelectorCache(projectID, cacheKey, scopeCacheKey, next);
      state.currentModel = next.current_model;
      renderSources(next.sources, vectorSelect.value || "");
      renderInfo();
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
    const cacheKey = "semantic:stored:list";
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
      Promise.all([
        Promise.resolve().then(() => renderInfo()),
        hydrateStored({ force }).catch((error) => {
          if (!state.destroyed) {
            ctx.setStatus(error?.message || String(error), "is-error");
          }
        }),
      ]).catch(() => {});
    }, 180);
  }

  async function refresh({ manual = false } = {}) {
    if (manual) {
      ctx.setStatus("Refreshing Semantic Search...");
    }
    await loadScopes({ hydrateCounts: true });
    if (manual) {
      await Promise.all([
        loadSourceOptions({ force: true }),
        hydrateStored({ force: true }),
      ]);
      ctx.setStatus("Semantic Search refreshed.", "is-ready");
      return;
    }
    startDeferredHydration({ force: false });
  }

  async function runSearch() {
    const payload = {
      query: queryInput.value.trim(),
      search_name: searchNameInput.value.trim(),
      vector_column: vectorSelect.value,
      limit: limitInput.value === "all" ? "all" : (Number(limitInput.value || 0) || 0),
      detach: true,
    };
    if (state.scopeKey) {
      payload.collection_key = state.scopeKey;
    }
    ctx.setStatus("Queueing semantic search...");
    const result = await ctx.invoke("semantic.search", payload);
    await Promise.resolve(ctx.rememberTabJobID?.(result.job_id || "", "semantic")).catch(() => {});
    state.message = result.message || "Job started. Track progress in Jobs.";
    renderInfo();
    ctx.setStatus(state.message, "is-ready");
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
      ctx.setStatus("Semantic scope updated.", "is-ready");
    }).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });

  searchButton.addEventListener("click", () => {
    runSearch().catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });

  panel.append(
    ctx.createNode("div", {
      className: "mw-grid",
      children: [
        field(ctx, "Query", queryInput, { full: true }),
        field(ctx, "Search name", searchNameInput),
        field(ctx, "Scope", scopeSelect),
        field(ctx, "Embedding source", vectorSelect),
        field(ctx, "Result limit", limitInput),
        ctx.createNode("div", {
          className: "mw-actions full",
          children: [searchButton, refreshButton],
        }),
      ],
    }),
    infoCard,
    storedCard,
  );

  setSelectPlaceholder(scopeSelect, "Loading scopes...");
  setSelectPlaceholder(vectorSelect, "Loading embedding sources...");
  renderInfo();
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
    },
  };
}
