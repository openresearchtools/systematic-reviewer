function prismaOption(ctx, key, label) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("data-prisma-option", key);
  return ctx.createNode("label", {
    className: "mw-pill-toggle",
    children: [input, ctx.createNode("span", { textContent: label })],
  });
}

function drawDiagram(root, diagram, state, onEdit = null) {
  if (root) {
    root.setAttribute("data-sr-prisma-border", state?.showOuterBorder ? "true" : "false");
  }
  return SystematicReviewerPrismaRenderer.drawDiagram(root, diagram, state, onEdit);
}

function findTemplateEntry(template = [], nodeId = "") {
  const target = String(nodeId || "").trim();
  return (template || []).find((entry) => {
    const data = String(entry?.data || "").trim();
    const node = String(entry?.node || "").trim();
    return (data && data !== "NA" && data === target) || (node && node !== "NA" && node === target);
  }) || null;
}

function defaultRowsForNode(state, nodeId) {
  const values = state?.values || {};
  const harvestSources = Array.isArray(state?.harvest_sources) ? state.harvest_sources : [];
  const reasonsToRows = (rawText = "") =>
    String(rawText || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const match = entry.match(/^(.*?),(.*)$/);
        if (match) {
          const parsed = Number(match[2].trim());
          return {
            label: match[1].trim() || "Reason",
            mode: "manual",
            value: Number.isFinite(parsed) ? parsed : 0,
            column: "",
            values: [],
          };
        }
        return { label: entry, mode: "manual", value: 0, column: "", values: [] };
      });

  switch (nodeId) {
    case "database_results":
      return harvestSources.length
        ? harvestSources.map((entry) => ({
            label: entry.collection_name || "Source",
            mode: "manual",
            value: Number(entry.item_count || 0) || 0,
            column: "",
            values: [],
          }))
        : [{ label: "Databases", mode: "manual", value: Number(values.database_results || 0) || 0, column: "", values: [] }];
    case "duplicates":
      return [
        { label: "Duplicate records", mode: "manual", value: Number(values.duplicates || 0) || 0, column: "", values: [] },
        { label: "Automation tools", mode: "manual", value: Number(values.excluded_automatic || 0) || 0, column: "", values: [] },
        { label: "Other reasons", mode: "manual", value: Number(values.excluded_other || 0) || 0, column: "", values: [] },
      ];
    case "records_excluded":
      return [
        { label: "Total", mode: "manual", value: Number(values.records_excluded || 0) || 0, column: "", values: [] },
        { label: "Automation tools", mode: "manual", value: Number(values.records_excluded_auto || 0) || 0, column: "", values: [] },
        { label: "Manual", mode: "manual", value: Number(values.records_excluded_manual || 0) || 0, column: "", values: [] },
      ];
    case "dbr_excluded":
      return [
        { label: "Total", mode: "manual", value: Number(values.dbr_excluded || 0) || 0, column: "", values: [] },
        { label: "Automation tools", mode: "manual", value: Number(values.dbr_excluded_auto || 0) || 0, column: "", values: [] },
        { label: "Manual", mode: "manual", value: Number(values.dbr_excluded_manual || 0) || 0, column: "", values: [] },
        ...reasonsToRows(values.dbr_excluded_reasons),
      ];
    case "other_excluded":
      return reasonsToRows(values.other_excluded_reasons);
    case "website_results":
      return [
        { label: "Websites", mode: "manual", value: Number(values.website_results || 0) || 0, column: "", values: [] },
        { label: "Organisations", mode: "manual", value: Number(values.organisation_results || 0) || 0, column: "", values: [] },
        { label: "Citation searching", mode: "manual", value: Number(values.citations_results || 0) || 0, column: "", values: [] },
      ];
    default:
      return [{ label: "Value", mode: "manual", value: Number(values[nodeId] || 0) || 0, column: "", values: [] }];
  }
}

function cloneStatePayload(state = {}) {
  return {
    options: Object.assign({}, state.options || {}),
    labels: Object.assign({}, state.labels || {}),
    hidden: Array.isArray(state.hidden) ? [...state.hidden] : [],
    overrides: JSON.parse(JSON.stringify(state.overrides || {})),
    fontSize: Number(state.fontSize || 14) || 14,
    cornerRadius: Number(state.cornerRadius ?? 8) || 0,
    showOuterBorder: !!state.showOuterBorder,
    reportScalePercent: Number(state.reportScalePercent || 100) || 100,
  };
}

export function createPrismaSurface(ctx, options = {}) {
  const embedded = !!options?.embedded;
  const panelClassName = String(options?.className || "").trim()
    || (embedded ? "mw-prisma-surface is-embedded" : "mw-tab-panel mw-prisma-surface");
  const panel = ctx.createNode("section", { className: panelClassName });
  const state = {
    current: null,
    editRows: [],
    editingNode: "",
  };

  const previousToggle = prismaOption(ctx, "previous", "Include previous studies");
  const otherToggle = prismaOption(ctx, "other", "Other methods arm");
  const metaToggle = prismaOption(ctx, "metaAnalysis", "Meta-analysis totals");
  const fontSize = ctx.createNode("input", {
    className: "mw-prisma-compact-input",
    attrs: { type: "number", min: "8", max: "32", step: "1" },
  });
  const reportScale = ctx.createNode("input", {
    className: "mw-prisma-compact-input",
    attrs: { type: "number", min: "50", max: "160", step: "5" },
  });
  const squareCorners = ctx.createNode("input", {
    attrs: { type: "checkbox" },
  });
  const outerBorder = ctx.createNode("input", {
    attrs: { type: "checkbox" },
  });
  const refreshButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Refresh",
    attrs: { type: "button", "data-prisma-action": "refresh" },
  });
  const saveButton = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Save",
    attrs: { type: "button", "data-prisma-action": "save" },
  });
  const exportButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Export PNG",
    attrs: { type: "button", "data-prisma-action": "export" },
  });
  const localStatus = ctx.createNode("span", {
    className: "mw-note mw-prisma-status-inline",
    attrs: { id: "prisma-status", "data-prisma-status": "true" },
    textContent: "Loading PRISMA diagram...",
  });
  const canvas = ctx.createNode("div", {
    className: "mw-prisma-canvas",
    attrs: { id: "prisma-canvas", "data-prisma-canvas": "true" },
  });

  const modalBackdrop = ctx.createNode("div", { className: "mw-prisma-modal-backdrop", attrs: { hidden: "hidden" } });
  const modal = ctx.createNode("div", { className: "mw-prisma-modal" });
  const modalTitle = ctx.createNode("h3", { textContent: "Edit node" });
  const modalLabel = document.createElement("textarea");
  modalLabel.rows = 4;
  modalLabel.id = "prisma-edit-label";
  const modalValue = document.createElement("input");
  modalValue.type = "number";
  modalValue.id = "prisma-edit-value";
  modalValue.placeholder = "Leave blank to keep auto count";
  const modalHint = ctx.createNode("div", {
    className: "mw-note",
    attrs: { id: "prisma-edit-hint" },
    textContent: "Right-click a box to override its text or saved value.",
  });
  const modalRows = ctx.createNode("div", {
    className: "mw-prisma-edit-rows",
    attrs: { id: "prisma-edit-rows" },
  });
  const modalAddRow = ctx.createNode("button", {
    className: "mw-button",
    textContent: "+ Add row",
    attrs: { type: "button", id: "prisma-edit-add-row" },
  });
  const modalReset = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Use auto value",
    attrs: { type: "button", id: "prisma-edit-reset" },
  });
  const modalCancel = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Close",
    attrs: { type: "button", id: "prisma-edit-cancel" },
  });
  const modalSave = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Save",
    attrs: { type: "button", id: "prisma-edit-save" },
  });

  function setLocalStatus(text, tone = "") {
    localStatus.className = `mw-note mw-prisma-status-inline${tone ? ` ${tone}` : ""}`;
    localStatus.textContent = text;
  }

  function setControlValues() {
    if (!state.current) {
      return;
    }
    previousToggle.querySelector("input").checked = !!state.current.options?.previous;
    otherToggle.querySelector("input").checked = !!state.current.options?.other;
    metaToggle.querySelector("input").checked = !!state.current.options?.metaAnalysis;
    fontSize.value = String(Number(state.current.fontSize || 14) || 14);
    reportScale.value = String(Number(state.current.reportScalePercent || 100) || 100);
    squareCorners.checked = Number(state.current.cornerRadius || 0) === 0;
    outerBorder.checked = !!state.current.showOuterBorder;
  }

  function collectState() {
    if (!state.current) {
      return {
        options: {},
        labels: {},
        hidden: [],
        overrides: {},
        fontSize: Number(fontSize.value || 14) || 14,
        cornerRadius: squareCorners.checked ? 0 : 8,
        showOuterBorder: !!outerBorder.checked,
        reportScalePercent: Number(reportScale.value || 100) || 100,
      };
    }
    return {
      options: {
        previous: !!previousToggle.querySelector("input").checked,
        other: !!otherToggle.querySelector("input").checked,
        metaAnalysis: !!metaToggle.querySelector("input").checked,
        dbDetail: !!state.current.options?.dbDetail,
        regDetail: !!state.current.options?.regDetail,
      },
      labels: Object.assign({}, state.current.labels || {}),
      hidden: Array.isArray(state.current.hidden) ? [...state.current.hidden] : [],
      overrides: JSON.parse(JSON.stringify(state.current.overrides || {})),
      fontSize: Number(fontSize.value || state.current.fontSize || 14) || 14,
      cornerRadius: squareCorners.checked ? 0 : 8,
      showOuterBorder: !!outerBorder.checked,
      reportScalePercent: Number(reportScale.value || state.current.reportScalePercent || 100) || 100,
    };
  }

  function closeModal() {
    state.editingNode = "";
    state.editRows = [];
    modalBackdrop.hidden = true;
  }

  function renderEditRows() {
    modalRows.replaceChildren();
    const columns = Array.isArray(state.current?.available_columns) ? state.current.available_columns : [];
    state.editRows.forEach((row, index) => {
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = row.label || "";
      labelInput.placeholder = "(e.g. Manual exclusions)";
      labelInput.addEventListener("input", () => {
        state.editRows[index].label = labelInput.value;
      });

      const modeSelect = document.createElement("select");
      [
        { value: "manual", label: "Manual value" },
        { value: "retrieval_found", label: "Retrieval + Found" },
        { value: "column_equals", label: "Column equals" },
      ].forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.value;
        option.textContent = entry.label;
        modeSelect.appendChild(option);
      });
      modeSelect.value = row.mode || "manual";
      modeSelect.addEventListener("change", () => {
        state.editRows[index].mode = modeSelect.value;
        renderEditRows();
      });

      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.placeholder = "(e.g. 12)";
      valueInput.value = row.value ?? "";
      valueInput.addEventListener("input", () => {
        state.editRows[index].value = valueInput.value === "" ? null : Number(valueInput.value);
      });

      const columnSelect = document.createElement("select");
      [{ key: "", label: "Column" }].concat(columns).forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.key || "";
        option.textContent = entry.label || entry.key || "Column";
        columnSelect.appendChild(option);
      });
      columnSelect.value = row.column || "";
      columnSelect.style.display = modeSelect.value === "column_equals" ? "block" : "none";
      columnSelect.addEventListener("change", () => {
        state.editRows[index].column = columnSelect.value || "";
      });

      const valuesInput = document.createElement("input");
      valuesInput.type = "text";
      valuesInput.placeholder = "(e.g. duplicate, not eligible)";
      valuesInput.value = Array.isArray(row.values) ? row.values.join(", ") : "";
      valuesInput.style.display = modeSelect.value === "column_equals" ? "block" : "none";
      valuesInput.addEventListener("input", () => {
        state.editRows[index].values = valuesInput.value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      });

      const actions = ctx.createNode("div", {
        className: "mw-prisma-edit-row-actions",
      });
      if (modeSelect.value !== "manual") {
        const computeButton = ctx.createNode("button", {
          className: "mw-button",
          textContent: "Compute",
          attrs: { type: "button" },
        });
        computeButton.addEventListener("click", async () => {
          try {
            modalHint.textContent = "Computing row value...";
            const result = await ctx.invoke("prisma.compute", {
              mode: state.editRows[index].mode,
              column: state.editRows[index].column || "",
              values: state.editRows[index].values || [],
            });
            if (typeof result?.count === "number") {
              state.editRows[index].value = result.count;
              modalHint.textContent = `Computed ${state.editRows[index].label || "row"}: ${result.count}`;
              renderEditRows();
            }
          }
          catch (error) {
            modalHint.textContent = error?.message || String(error);
          }
        });
        actions.appendChild(computeButton);
      }
      const removeButton = ctx.createNode("button", {
        className: "mw-button",
        textContent: "Remove",
        attrs: { type: "button" },
      });
      removeButton.addEventListener("click", () => {
        state.editRows.splice(index, 1);
        renderEditRows();
      });
      actions.appendChild(removeButton);

      modalRows.appendChild(ctx.createNode("div", {
        className: "mw-prisma-edit-row",
        children: [labelInput, modeSelect, valueInput, columnSelect, valuesInput, actions],
      }));
    });
  }

  function openEdit(nodeId) {
    if (!state.current) {
      return;
    }
    state.editingNode = String(nodeId || "").trim();
    if (!state.editingNode) {
      return;
    }
    const override = state.current.overrides?.[state.editingNode] || {};
    const template = findTemplateEntry(state.current.template || [], state.editingNode) || {};
    const fallbackLabel = override.label || state.current.labels?.[state.editingNode] || template.boxtext || template.description || state.editingNode;
    modalTitle.textContent = `Edit ${state.editingNode}`;
    modalLabel.value = String(fallbackLabel || "").split("\n").join("\n");
    modalValue.value = override.value ?? "";
    modalHint.textContent = "Right-click a box to override its text or saved value.";
    state.editRows = Array.isArray(override.rows) && override.rows.length
      ? JSON.parse(JSON.stringify(override.rows))
      : defaultRowsForNode(state.current, state.editingNode);
    renderEditRows();
    modalBackdrop.hidden = false;
  }

  async function refreshDiagram({ quiet = false } = {}) {
    if (!state.current) {
      return;
    }
    if (!quiet) {
      ctx.setStatus("Rendering PRISMA diagram...");
      setLocalStatus("Rendering PRISMA diagram...");
    }
    try {
      const rendered = await ctx.invoke("prisma.render", collectState());
      state.current = Object.assign({}, state.current, rendered);
      drawDiagram(canvas, rendered.diagram, state.current, openEdit);
      ctx.setStatus("PRISMA ready.", "is-ready");
      setLocalStatus("PRISMA ready.", "is-ready");
    }
    catch (error) {
      canvas.replaceChildren(ctx.createNode("div", {
        className: "mw-empty",
        textContent: error?.message || String(error),
      }));
      ctx.setStatus(error?.message || String(error), "is-error");
      setLocalStatus(error?.message || String(error), "is-error");
    }
  }

  async function loadState() {
    ctx.setStatus("Loading PRISMA state...");
    setLocalStatus("Loading PRISMA state...");
    try {
      state.current = await ctx.invoke("prisma.getState");
      setControlValues();
      drawDiagram(canvas, state.current.diagram, state.current, openEdit);
      ctx.setStatus("PRISMA ready.", "is-ready");
      setLocalStatus("PRISMA ready.", "is-ready");
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
      setLocalStatus(error?.message || String(error), "is-error");
    }
  }

  async function saveState() {
    if (!state.current) {
      return;
    }
    ctx.setStatus("Saving PRISMA state...");
    setLocalStatus("Saving PRISMA state...");
    try {
      const result = await ctx.invoke("prisma.saveState", collectState());
      state.current = result.state;
      setControlValues();
      drawDiagram(canvas, state.current.diagram, state.current, openEdit);
      try {
        await Promise.resolve(options?.onStateSaved?.(state.current));
      }
      catch (_error) {}
      ctx.setStatus("PRISMA state saved.", "is-ready");
      setLocalStatus("PRISMA state saved.", "is-ready");
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
      setLocalStatus(error?.message || String(error), "is-error");
    }
  }

  async function exportPNG() {
    if (!state.current?.diagram) {
      ctx.setStatus("Nothing to export.", "is-error");
      setLocalStatus("Nothing to export.", "is-error");
      return;
    }
    ctx.setStatus("Exporting PRISMA PNG...");
    setLocalStatus("Exporting PRISMA PNG...");
    try {
      const dataURL = await SystematicReviewerPrismaRenderer.pngDataURL(window, state.current.diagram, state.current);
      const saved = await ctx.invoke("prisma.savePng", { data_url: dataURL });
      if (saved?.canceled) {
        ctx.setStatus("PRISMA PNG export canceled.", "is-ready");
        setLocalStatus("PRISMA PNG export canceled.", "is-ready");
        return;
      }
      ctx.setStatus(saved?.path ? `PRISMA PNG saved to ${saved.path}` : "PRISMA PNG saved.", "is-ready");
      setLocalStatus(saved?.path ? `PRISMA PNG saved to ${saved.path}` : "PRISMA PNG saved.", "is-ready");
    }
    catch (error) {
      ctx.setStatus(error?.message || String(error), "is-error");
      setLocalStatus(error?.message || String(error), "is-error");
    }
  }

  previousToggle.querySelector("input").addEventListener("change", () => refreshDiagram().catch(() => {}));
  otherToggle.querySelector("input").addEventListener("change", () => refreshDiagram().catch(() => {}));
  metaToggle.querySelector("input").addEventListener("change", () => refreshDiagram().catch(() => {}));
  fontSize.addEventListener("input", () => refreshDiagram({ quiet: true }).catch(() => {}));
  reportScale.addEventListener("input", () => refreshDiagram({ quiet: true }).catch(() => {}));
  squareCorners.addEventListener("change", () => refreshDiagram({ quiet: true }).catch(() => {}));
  outerBorder.addEventListener("change", () => refreshDiagram({ quiet: true }).catch(() => {}));
  refreshButton.addEventListener("click", () => loadState().catch(() => {}));
  saveButton.addEventListener("click", () => saveState().catch(() => {}));
  exportButton.addEventListener("click", () => exportPNG().catch(() => {}));
  modalAddRow.addEventListener("click", () => {
    state.editRows.push({ label: "Row", mode: "manual", value: 0, column: "", values: [] });
    renderEditRows();
  });
  modalCancel.addEventListener("click", () => closeModal());
  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) {
      closeModal();
    }
  });
  modalReset.addEventListener("click", async () => {
    if (!state.current || !state.editingNode) {
      return;
    }
    delete state.current.overrides[state.editingNode];
    closeModal();
    await saveState();
  });
  modalSave.addEventListener("click", async () => {
    if (!state.current || !state.editingNode) {
      return;
    }
    const rows = state.editRows.map((row) => ({
      label: row.label || "Row",
      mode: row.mode || "manual",
      column: row.column || "",
      values: Array.isArray(row.values) ? row.values : [],
      value: row.value === "" ? null : row.value,
    }));
    const rowValues = rows.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
    const totalValue = rowValues.length ? rowValues.reduce((sum, value) => sum + value, 0) : modalValue.value;
    state.current.overrides[state.editingNode] = {
      override: true,
      value: totalValue === "" || totalValue === null || totalValue === undefined ? null : Number(totalValue),
      label: modalLabel.value,
      rows,
    };
    closeModal();
    await saveState();
  });

  modal.append(
    ctx.createNode("div", {
      className: "mw-prisma-modal-header",
      children: [
        modalTitle,
        ctx.createNode("div", {
          className: "mw-actions",
          children: [modalCancel, modalSave],
        }),
      ],
    }),
    ctx.createNode("div", {
      className: "mw-prisma-modal-body",
      children: [
        ctx.createNode("label", {
          className: "mw-field full",
          children: [
            ctx.createNode("span", { textContent: "Label lines (one per line)" }),
            modalLabel,
          ],
        }),
        ctx.createNode("div", { className: "mw-note", textContent: "Rows inside box" }),
        modalRows,
        modalAddRow,
        ctx.createNode("label", {
          className: "mw-field",
          children: [
            ctx.createNode("span", { textContent: "Value (override for bottom n=)" }),
            modalValue,
          ],
        }),
        modalHint,
        ctx.createNode("div", {
          className: "mw-actions",
          children: [modalReset],
        }),
      ],
    }),
  );
  modalBackdrop.appendChild(modal);

  panel.append(
    ctx.createNode("div", {
      className: "mw-card mw-prisma-toolbar-card",
      children: [
        ctx.createNode("div", {
          className: "mw-prisma-toolbar",
          children: [
            ctx.createNode("div", {
              className: "mw-prisma-controls-left",
              children: [
                previousToggle,
                otherToggle,
                metaToggle,
                ctx.createNode("label", {
                  className: "mw-pill-inline",
                  children: [
                    ctx.createNode("span", { textContent: "Size" }),
                    fontSize,
                  ],
                }),
                ctx.createNode("label", {
                  className: "mw-pill-inline",
                  children: [
                    ctx.createNode("span", { textContent: "Report size (%)" }),
                    reportScale,
                  ],
                }),
                ctx.createNode("label", {
                  className: "mw-pill-toggle",
                  children: [squareCorners, ctx.createNode("span", { textContent: "Square corners" })],
                }),
                ctx.createNode("label", {
                  className: "mw-pill-toggle",
                  children: [outerBorder, ctx.createNode("span", { textContent: "Outer border" })],
                }),
              ],
            }),
            ctx.createNode("div", {
              className: "mw-prisma-actions",
              children: [
                ctx.createNode("div", {
                  className: "mw-actions",
                  children: [localStatus, refreshButton, saveButton, exportButton],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    ctx.createNode("div", {
      className: "mw-card mw-prisma-canvas-wrap",
      children: [canvas],
    }),
    modalBackdrop,
  );

  loadState().catch((error) => {
    ctx.setStatus(error?.message || String(error), "is-error");
    setLocalStatus(error?.message || String(error), "is-error");
  });

  return {
    node: panel,
    refresh() {
      return loadState();
    },
    destroy() {
      closeModal();
    },
  };
}

export function createPrismaTab(ctx) {
  return createPrismaSurface(ctx, {
    className: "mw-tab-panel mw-prisma-surface",
  });
}
