import { isScopeMissingError, readSelectorCache, scheduleAfterPaint, setSelectEntries, setSelectPlaceholder, writeSelectorCache } from "./deferred-load.js";
import { createSearchablePlaceholderAutocomplete } from "./searchable-autocomplete.js";

function field(ctx, label, input, options = {}) {
  return ctx.createNode("label", {
    className: `mw-field${options.full ? " full" : ""}`,
    children: [
      ctx.createNode("span", { textContent: label }),
      input,
    ],
  });
}

function createTextInput(type = "text", placeholder = "") {
  const input = document.createElement("input");
  input.type = type;
  if (placeholder) {
    input.placeholder = placeholder;
  }
  return input;
}

function createTextarea(rows = 4, placeholder = "") {
  const input = document.createElement("textarea");
  input.rows = rows;
  if (placeholder) {
    input.placeholder = placeholder;
  }
  return input;
}

function createSelect(options = []) {
  const select = document.createElement("select");
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  return select;
}

function cloneTemplateForNew(template = {}) {
  const copy = JSON.parse(JSON.stringify(template || {}));
  copy.path = "";
  copy.name = "template";
  return copy;
}

function parseEnumChoices(text = "") {
  const choices = [];
  const choiceGuidance = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const divider = trimmed.indexOf("|");
    const value = (divider >= 0 ? trimmed.slice(0, divider) : trimmed).trim();
    const guidance = (divider >= 0 ? trimmed.slice(divider + 1) : "").trim();
    if (!value || choices.includes(value)) {
      continue;
    }
    choices.push(value);
    if (guidance) {
      choiceGuidance[value] = guidance;
    }
  }
  return { choices, choice_guidance: choiceGuidance };
}

function enumChoicesText(field = {}) {
  const choices = Array.isArray(field.choices) ? field.choices : [];
  const guidance = field.choice_guidance && typeof field.choice_guidance == "object"
    ? field.choice_guidance
    : {};
  return choices.map((choice) => {
    const note = String(guidance[choice] || "").trim();
    return note ? `${choice} | ${note}` : choice;
  }).join("\n");
}

function fieldDetailsText(field = {}) {
  const lines = [
    `Key: ${field.key || ""}`,
    `Type: ${field.type || "string"}`,
    `Allow null: ${field.allow_null ? "yes" : "no"}`,
  ];
  if (field.guidance) {
    lines.push(`Guidance: ${field.guidance}`);
  }
  if (Array.isArray(field.choices) && field.choices.length) {
    lines.push(`Choices: ${field.choices.join(", ")}`);
  }
  if (field.choice_guidance && typeof field.choice_guidance == "object") {
    const choiceNotes = Object.entries(field.choice_guidance)
      .map(([key, value]) => `${key}: ${value}`)
      .join("; ");
    if (choiceNotes) {
      lines.push(`Choice guidance: ${choiceNotes}`);
    }
  }
  if (field.min !== undefined && field.min !== null) {
    lines.push(`Min: ${field.min}`);
  }
  if (field.max !== undefined && field.max !== null) {
    lines.push(`Max: ${field.max}`);
  }
  return lines.join(" | ");
}

function renderFieldSelector(ctx, template = {}, selectedKeys = new Set()) {
  const fields = Array.isArray(template.fields) ? template.fields : [];
  if (!fields.length) {
    return ctx.createNode("div", {
      className: "mw-empty",
      textContent: "No template fields yet.",
    });
  }
  return ctx.createNode("div", {
    className: "mw-field-checkboxes",
    children: fields.map((field) => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedKeys.has(field.key);
      checkbox.value = field.key;
      const detail = ctx.createNode("div", {
        className: "mw-extraction-field-detail is-hidden",
        textContent: fieldDetailsText(field),
      });
      const toggle = ctx.createNode("button", {
        className: "mw-button",
        textContent: "Details",
        attrs: { type: "button" },
      });
      toggle.addEventListener("click", () => {
        detail.classList.toggle("is-hidden");
        toggle.textContent = detail.classList.contains("is-hidden") ? "Details" : "Hide";
      });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedKeys.add(field.key);
        }
        else {
          selectedKeys.delete(field.key);
        }
      });
      return ctx.createNode("div", {
        className: "mw-extraction-field-card",
        children: [
          ctx.createNode("div", {
            className: "mw-extraction-field-header",
            children: [
              ctx.createNode("div", {
                className: "mw-extraction-field-left",
                children: [
                  checkbox,
                  ctx.createNode("div", {
                    className: "mw-extraction-field-meta",
                    children: [
                      ctx.createNode("div", {
                        className: "mw-extraction-field-title",
                        textContent: field.label || field.key,
                      }),
                      ctx.createNode("div", {
                        className: "mw-extraction-field-sub",
                        children: [
                          ctx.createNode("span", {
                            className: "mw-badge",
                            textContent: field.type || "string",
                          }),
                          !field.allow_null
                            ? ctx.createNode("span", {
                                className: "mw-badge",
                                textContent: "required",
                              })
                            : null,
                        ].filter(Boolean),
                      }),
                    ],
                  }),
                ],
              }),
              toggle,
            ],
          }),
          detail,
        ],
      });
    }),
  });
}

function createChoiceRow(ctx, choiceValue = "", guidanceValue = "") {
  const valueInput = createTextInput("text", "Category value");
  valueInput.value = choiceValue;
  valueInput.setAttribute("data-choice", "value");
  const guidanceInput = createTextInput("text", "Guidance (optional)");
  guidanceInput.value = guidanceValue;
  guidanceInput.setAttribute("data-choice", "guidance");
  const removeButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Remove",
    attrs: { type: "button" },
  });
  const row = ctx.createNode("div", {
    className: "mw-extraction-choice-row",
    children: [valueInput, guidanceInput, removeButton],
  });
  removeButton.addEventListener("click", () => row.remove());
  return row;
}

function createBuilderFieldBlock(ctx, data = {}, options = {}) {
  const container = ctx.createNode("div", { className: "mw-extraction-builder-field" });
  const keyInput = createTextInput("text", "key (snake_case)");
  keyInput.value = data.key || "";
  keyInput.setAttribute("data-field", "key");
  const labelInput = createTextInput("text", "Label shown in UI");
  labelInput.value = data.label || data.key || "";
  labelInput.setAttribute("data-field", "label");
  const typeSelect = createSelect([
    ["string", "string"],
    ["number", "number"],
    ["enum", "enum"],
    ["boolean", "boolean"],
  ]);
  typeSelect.value = data.type || "string";
  typeSelect.setAttribute("data-field", "type");
  const guidanceInput = createTextarea(6, "Guidance. Type @{ to insert row values.");
  guidanceInput.value = data.guidance || "";
  guidanceInput.setAttribute("data-field", "guidance");
  if (typeof options.attachPlaceholderAutocomplete === "function") {
    options.attachPlaceholderAutocomplete(guidanceInput);
  }
  const allowNullInput = document.createElement("input");
  allowNullInput.type = "checkbox";
  allowNullInput.checked = !!data.allow_null;
  allowNullInput.setAttribute("data-field", "allow_null");
  const minInput = createTextInput("text", "Min (supports negatives)");
  minInput.value = data.min !== undefined && data.min !== null ? String(data.min) : "";
  minInput.setAttribute("data-field", "min");
  const maxInput = createTextInput("text", "Max (supports negatives)");
  maxInput.value = data.max !== undefined && data.max !== null ? String(data.max) : "";
  maxInput.setAttribute("data-field", "max");
  const removeButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Remove",
    attrs: { type: "button" },
  });

  const numericRow = ctx.createNode("div", {
    className: "mw-extraction-builder-field-row two-up",
    children: [minInput, maxInput],
  });
  const choicesSection = ctx.createNode("div", { className: "mw-extraction-builder-choices" });
  const choicesList = ctx.createNode("div", { className: "mw-extraction-builder-choice-list" });
  const addChoiceButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Add category",
    attrs: { type: "button" },
  });
  addChoiceButton.addEventListener("click", () => {
    choicesList.appendChild(createChoiceRow(ctx));
  });
  const parsedChoices = enumChoicesText(data);
  const choiceLines = parsedChoices ? parsedChoices.split(/\r?\n/) : [];
  if (choiceLines.length) {
    choiceLines.forEach((line) => {
      const divider = line.indexOf("|");
      const choiceValue = (divider >= 0 ? line.slice(0, divider) : line).trim();
      const guidanceValue = (divider >= 0 ? line.slice(divider + 1) : "").trim();
      choicesList.appendChild(createChoiceRow(ctx, choiceValue, guidanceValue));
    });
  }
  else {
    choicesList.appendChild(createChoiceRow(ctx));
  }
  choicesSection.append(
    ctx.createNode("div", {
      className: "mw-extraction-builder-choice-label",
      textContent: "Categories (value + guidance)",
    }),
    choicesList,
    addChoiceButton,
  );

  function syncTypeVisibility() {
    const type = typeSelect.value;
    numericRow.hidden = type !== "number";
    choicesSection.hidden = type !== "enum";
  }

  typeSelect.addEventListener("change", syncTypeVisibility);
  removeButton.addEventListener("click", () => container.remove());

  container.append(
    ctx.createNode("div", {
      className: "mw-extraction-builder-field-row four-up",
      children: [
        field(ctx, "Field key", keyInput),
        field(ctx, "Field label", labelInput),
        field(ctx, "Type", typeSelect),
        ctx.createNode("div", {
          className: "mw-extraction-builder-remove",
          children: [removeButton],
        }),
      ],
    }),
    field(ctx, "Guidance (LLM hint)", guidanceInput, { full: true }),
    ctx.createNode("label", {
      className: "mw-pill-toggle",
      children: [allowNullInput, ctx.createNode("span", { textContent: "Allow null" })],
    }),
    numericRow,
    choicesSection,
  );
  syncTypeVisibility();
  return container;
}

function readBuilderFields(container) {
  const fields = [];
  container.querySelectorAll(".mw-extraction-builder-field").forEach((block) => {
    const key = String(block.querySelector("[data-field='key']")?.value || "").trim();
    if (!key) {
      return;
    }
    const label = String(block.querySelector("[data-field='label']")?.value || "").trim() || key;
    const type = String(block.querySelector("[data-field='type']")?.value || "string").trim() || "string";
    const guidance = String(block.querySelector("[data-field='guidance']")?.value || "").trim();
    const field = { key, label, type, guidance };
    if (block.querySelector("[data-field='allow_null']")?.checked) {
      field.allow_null = true;
    }
    if (type === "number") {
      const minValue = String(block.querySelector("[data-field='min']")?.value || "").trim();
      const maxValue = String(block.querySelector("[data-field='max']")?.value || "").trim();
      if (minValue && !Number.isNaN(Number(minValue))) {
        field.min = Number(minValue);
      }
      if (maxValue && !Number.isNaN(Number(maxValue))) {
        field.max = Number(maxValue);
      }
    }
    if (type === "enum") {
      const choices = [];
      const choiceGuidance = {};
      block.querySelectorAll(".mw-extraction-choice-row").forEach((row) => {
        const value = String(row.querySelector("[data-choice='value']")?.value || "").trim();
        const guidanceValue = String(row.querySelector("[data-choice='guidance']")?.value || "").trim();
        if (!value) {
          return;
        }
        if (!choices.includes(value)) {
          choices.push(value);
        }
        if (guidanceValue) {
          choiceGuidance[value] = guidanceValue;
        }
      });
      if (choices.length) {
        field.choices = choices;
      }
      if (Object.keys(choiceGuidance).length) {
        field.choice_guidance = choiceGuidance;
      }
    }
    fields.push(field);
  });
  return fields;
}

function buildJobCard(ctx, job = null) {
  if (!job?.job_id) {
    return ctx.createNode("div", {
      className: "mw-empty",
      textContent: "Run extraction to queue a background job you can track here.",
    });
  }
  const metadata = job.metadata && typeof job.metadata == "object" ? job.metadata : {};
  const stats = [];
  if (metadata.item_total !== undefined) {
    stats.push({ label: "Items", value: Number(metadata.item_total || 0) || 0 });
  }
  if (metadata.item_succeeded !== undefined) {
    stats.push({ label: "Succeeded", value: Number(metadata.item_succeeded || 0) || 0 });
  }
  if (metadata.item_failed !== undefined) {
    stats.push({ label: "Failed", value: Number(metadata.item_failed || 0) || 0 });
  }
  return ctx.createNode("div", {
    className: "mw-card-stack",
    children: [
      ctx.createNode("div", {
        className: "mw-detail-rows",
        children: [
          ctx.createNode("div", { className: "mw-detail-row", children: [
            ctx.createNode("div", { className: "mw-detail-label", textContent: "Job" }),
            ctx.createNode("div", { className: "mw-detail-value", textContent: job.job_id }),
          ]}),
          ctx.createNode("div", { className: "mw-detail-row", children: [
            ctx.createNode("div", { className: "mw-detail-label", textContent: "Status" }),
            ctx.createNode("div", { className: "mw-detail-value", textContent: job.status || "queued" }),
          ]}),
          ctx.createNode("div", { className: "mw-detail-row", children: [
            ctx.createNode("div", { className: "mw-detail-label", textContent: "Template" }),
            ctx.createNode("div", { className: "mw-detail-value", textContent: metadata.template_name || job.title || "Extraction" }),
          ]}),
        ],
      }),
      stats.length
        ? ctx.createNode("div", {
            className: "mw-stat-grid",
            children: stats.map((entry) => ctx.createNode("div", {
              className: "mw-stat-card",
              children: [
                ctx.createNode("div", { className: "mw-stat-value", textContent: String(entry.value) }),
                ctx.createNode("div", { className: "mw-stat-label", textContent: entry.label }),
              ],
            })),
          })
        : null,
      Array.isArray(job.logs) && job.logs.length
        ? ctx.createNode("div", {
            className: "mw-code",
            textContent: job.logs.slice(-8).map((entry) => `[${entry.level || "info"}] ${entry.message || ""}`).join("\n"),
          })
        : null,
    ].filter(Boolean),
  });
}

export function createExtractionTab(ctx) {
  const panel = ctx.createNode("section", { className: "mw-tab-panel mw-extraction-panel" });
  const templateSelect = document.createElement("select");
  templateSelect.setAttribute("data-extraction-template-select", "true");
  const scopeSelect = document.createElement("select");
  scopeSelect.setAttribute("data-extraction-scope-select", "true");
  const sourceSelect = document.createElement("select");
  sourceSelect.setAttribute("data-extraction-source-select", "true");
  const runtimePresetSelect = document.createElement("select");
  runtimePresetSelect.setAttribute("data-extraction-runtime-preset-select", "true");
  const skipExistingInput = document.createElement("input");
  skipExistingInput.type = "checkbox";
  const fieldContainer = ctx.createNode("div", { className: "mw-field-checkboxes" });
  const templateStatus = ctx.createNode("div", { className: "mw-muted mw-small", textContent: "" });
  const templateName = ctx.createNode("div", { className: "mw-muted mw-small", textContent: "" });
  const runtimeStatus = ctx.createNode("div", { className: "mw-muted mw-small", textContent: "" });
  const uploadButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Add template (upload)",
    attrs: { type: "button", "data-extraction-action": "import-template" },
  });
  const editButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Edit template",
    attrs: { type: "button", "data-extraction-action": "edit-template" },
  });
  const newButton = ctx.createNode("button", {
    className: "mw-button",
    textContent: "New template",
    attrs: { type: "button", "data-extraction-action": "new-template" },
  });
  const runButton = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Run extraction",
    attrs: { type: "button", "data-extraction-action": "run" },
  });

  const modalBackdrop = ctx.createNode("div", {
    className: "mw-extraction-modal-backdrop",
    attrs: { hidden: "hidden" },
  });
  const modal = ctx.createNode("div", { className: "mw-extraction-modal" });
  const modalTitle = ctx.createNode("h3", { textContent: "New Extraction Template" });
  const builderName = createTextInput("text", "(e.g. screening_fields)");
  builderName.id = "template-builder-name";
  const builderDescription = createTextInput("text", "(e.g. Eligibility screening fields)");
  builderDescription.id = "template-builder-desc";
  const builderSystem = createTextarea(3, "System prompt");
  builderSystem.id = "template-builder-system";
  const builderFormat = createTextarea(3, "Format instructions");
  builderFormat.id = "template-builder-format";
  const builderFields = ctx.createNode("div", { className: "mw-extraction-builder-fields", attrs: { id: "template-builder-fields" } });
  const builderAddField = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Add field",
    attrs: { type: "button", id: "template-builder-add-field" },
  });
  const builderSave = ctx.createNode("button", {
    className: "mw-button primary",
    textContent: "Save template",
    attrs: { type: "button", id: "template-builder-save" },
  });
  const builderClose = ctx.createNode("button", {
    className: "mw-button",
    textContent: "Close",
    attrs: { type: "button", id: "template-builder-close" },
  });

  const state = {
    currentTemplate: null,
    selectedFieldKeys: new Set(),
    templateLibrary: [],
    templateColumns: [],
    scopeKey: String(ctx.getSharedScopeKey?.() || ""),
    builderTemplate: null,
    builderMode: "new",
    runtimeOptions: { default_label: "Default", presets: [] },
    lightweightScopes: [],
    destroyed: false,
    sourceToken: 0,
    runtimeToken: 0,
    columnToken: 0,
    cancelAfterPaint: null,
  };
  const projectID = String(ctx.bootstrap?.project?.project_id || ctx.bootstrap?.project?.collection_name || "project");
  editButton.disabled = true;
  runButton.disabled = true;
  const placeholderAutocomplete = createSearchablePlaceholderAutocomplete(ctx, {
    getOptions: () => Array.isArray(state.templateColumns) ? state.templateColumns : [],
    ensureOptions: async () => {
      if (!state.templateColumns.length) {
        await loadTemplateColumnOptions({ force: false });
      }
      return state.templateColumns;
    },
    searchPlaceholder: "Filter columns...",
    emptyText: "No columns match this filter.",
    metaLabel: "columns",
    menuClassName: "mw-extraction-placeholder-menu",
    metaText: (entry) => {
      const key = String(entry?.key || "").trim();
      const label = String(entry?.label || "").trim();
      return key && label && key !== label ? key : "";
    },
  });

  async function loadTemplateColumnOptions(options = {}) {
    const force = options.force === true;
    const cacheKey = "extraction:columns:list";
    const cached = !force ? readSelectorCache(projectID, cacheKey) : null;
    if (cached?.columns) {
      state.templateColumns = Array.isArray(cached.columns) ? cached.columns : [];
    }
    const token = ++state.columnToken;
    const result = await ctx.invoke("workflow.options.extractionColumns.list", {});
    if (state.destroyed || token !== state.columnToken) {
      return result;
    }
    state.templateColumns = Array.isArray(result?.columns) ? result.columns : [];
    writeSelectorCache(projectID, cacheKey, "", {
      columns: state.templateColumns,
    });
    placeholderAutocomplete.refresh();
    return result;
  }

  function attachPlaceholderAutocomplete(input) {
    placeholderAutocomplete.attach(input);
  }

  function scopePayload() {
    return scopeSelect.value ? { collection_key: scopeSelect.value } : {};
  }

  function renderTemplateLibrary(templates = [], preferredPath = "") {
    const current = preferredPath || templateSelect.value || state.currentTemplate?.path || "";
    if (!(Array.isArray(templates) && templates.length)) {
      templateSelect.replaceChildren(ctx.createNode("option", {
        attrs: { value: "", disabled: "disabled", selected: "selected" },
        textContent: "No templates",
      }));
      templateSelect.disabled = true;
      return;
    }
    templateSelect.replaceChildren(
      ...templates.map((entry) => ctx.createNode("option", {
        attrs: { value: entry.path || "" },
        textContent: entry.name || entry.path || "Template",
      }))
    );
    const fallback = templates[0]?.path || "";
    templateSelect.value = templates.some((entry) => String(entry.path || "") === current) ? current : fallback;
    templateSelect.disabled = false;
  }

  function renderScopeOptions(scopes = [], preferredKey = "") {
    const current = preferredKey || scopeSelect.value || state.scopeKey || "";
    const entries = Array.isArray(scopes) ? scopes : [];
    state.scopeKey = setSelectEntries(scopeSelect, entries, {
      valueKey: "collection_key",
      labelKey: "label",
      currentValue: current,
      fallbackValue: current,
    }) || "";
  }

  function renderSourceOptions(sources = [], preferredKey = "") {
    const current = preferredKey || sourceSelect.value || "title_abstract";
    setSelectEntries(sourceSelect, sources.map((entry) => ({
      key: entry.key,
      label: `${entry.label}${entry.item_count ? ` (${entry.item_count})` : ""}`,
    })), {
      valueKey: "key",
      labelKey: "label",
      currentValue: current,
      fallbackValue: current || "title_abstract",
    });
    sourceSelect.disabled = !(Array.isArray(sources) && sources.length);
  }

  function renderRuntimeOptions(runtimeOptions = {}, preferredPresetID = "") {
    state.runtimeOptions = runtimeOptions && typeof runtimeOptions === "object"
      ? runtimeOptions
      : { default_label: "Default", presets: [] };
    const presets = Array.isArray(state.runtimeOptions.presets) ? state.runtimeOptions.presets : [];
    const optionValue = (entry = {}) => {
      const roleID = String(entry?.runtime_role_id || entry?.runtimeRoleID || "").trim();
      const presetID = String(entry?.runtime_preset_id || entry?.runtimePresetID || entry?.preset_id || entry?.presetID || "").trim();
      return String(entry?.choice_id || entry?.choiceID || (roleID && presetID ? `${roleID}::${presetID}` : presetID)).trim();
    };
    const defaultChoice = String(
      state.runtimeOptions.default_choice_id
      || state.runtimeOptions.defaultChoiceID
      || (state.runtimeOptions.default_role_id ? `${state.runtimeOptions.default_role_id}::${state.runtimeOptions.default_preset_id || "default"}` : "")
    ).trim();
    const current = String(preferredPresetID || runtimePresetSelect.value || defaultChoice).trim();
    runtimePresetSelect.replaceChildren(
      ...presets
        .filter((entry) => optionValue(entry))
        .map((entry) => ctx.createNode("option", {
          attrs: { value: optionValue(entry) },
          textContent: entry.label || entry.short_label || entry.preset_id || "Preset",
        }))
    );
    runtimePresetSelect.value = Array.from(runtimePresetSelect.options).some((option) => String(option.value || "") === current)
      ? current
      : (Array.from(runtimePresetSelect.options).some((option) => String(option.value || "") === defaultChoice) ? defaultChoice : "");
    runtimePresetSelect.disabled = !runtimePresetSelect.options.length;
    runtimeStatus.textContent = runtimePresetSelect.value
      ? "Run this extraction with the selected model preset."
      : "Configure extraction models in Settings.";
  }

  function parseRuntimePresetSelection(value = "") {
    const raw = String(value || "").trim();
    if (!raw) {
      return { runtime_role_id: "", runtime_preset_id: "" };
    }
    const separator = raw.indexOf("::");
    if (separator >= 0) {
      return {
        runtime_role_id: raw.slice(0, separator).trim(),
        runtime_preset_id: raw.slice(separator + 2).trim() || "default",
      };
    }
    return {
      runtime_role_id: "",
      runtime_preset_id: raw,
    };
  }

  function syncTemplateActionState() {
    const hasTemplate = !!state.currentTemplate?.path;
    editButton.disabled = !hasTemplate;
    runButton.disabled = !hasTemplate;
  }

  function fillTemplate(template = {}) {
    state.currentTemplate = template;
    state.selectedFieldKeys = new Set((Array.isArray(template.fields) ? template.fields : []).map((field) => field.key));
    templateStatus.textContent = template.path
      ? `Loaded template: ${template.name || "template"}`
      : "Unsaved template draft";
    templateName.textContent = template.path || "";
    fieldContainer.replaceChildren(renderFieldSelector(ctx, template, state.selectedFieldKeys));
    syncTemplateActionState();
  }

  function clearTemplateState(message = "No extraction templates in this project yet. Create one or upload one into this project folder.") {
    state.currentTemplate = null;
    state.selectedFieldKeys = new Set();
    templateStatus.textContent = message;
    templateName.textContent = "";
    fieldContainer.replaceChildren(ctx.createNode("div", {
      className: "mw-empty",
      textContent: message,
    }));
    syncTemplateActionState();
  }

  function openBuilder(template = {}, mode = "new") {
    state.builderTemplate = JSON.parse(JSON.stringify(template || {}));
    state.builderMode = mode;
    modalTitle.textContent = mode === "edit" ? "Edit Extraction Template" : "New Extraction Template";
    builderName.value = String(state.builderTemplate.name || "");
    builderDescription.value = String(state.builderTemplate.description || "");
    builderSystem.value = String(state.builderTemplate.system_prompt || "");
    builderFormat.value = String(state.builderTemplate.format_instructions || "");
    builderFields.replaceChildren();
    const fields = Array.isArray(state.builderTemplate.fields) && state.builderTemplate.fields.length
      ? state.builderTemplate.fields
      : [{}];
    fields.forEach((entry) => builderFields.appendChild(createBuilderFieldBlock(ctx, entry, {
      attachPlaceholderAutocomplete,
    })));
    modalBackdrop.hidden = false;
    void loadTemplateColumnOptions({ force: false }).catch(() => {});
  }

  function closeBuilder() {
    modalBackdrop.hidden = true;
    state.builderTemplate = null;
    state.builderMode = "new";
    builderFields.replaceChildren();
    placeholderAutocomplete.hide();
  }

  async function loadTemplateByPath(path) {
    const template = await ctx.invoke("extraction.templates.load", path ? { path } : {});
    if (!template) {
      clearTemplateState();
      return null;
    }
    fillTemplate(template);
    return template;
  }

  async function ensureTemplateSelected(path = "") {
    const nextPath = String(path || "").trim();
    if (!nextPath) {
      return null;
    }
    let hasOption = Array.from(templateSelect.options || []).some((option) => String(option.value || "") === nextPath);
    if (!hasOption) {
      const library = await ctx.invoke("extraction.templates.list");
      state.templateLibrary = Array.isArray(library.templates) ? library.templates : [];
      renderTemplateLibrary(state.templateLibrary, nextPath);
      hasOption = Array.from(templateSelect.options || []).some((option) => String(option.value || "") === nextPath);
    }
    if (hasOption) {
      templateSelect.value = nextPath;
    }
    return await loadTemplateByPath(nextPath);
  }

  async function hydrateScopes() {
    if (!state.lightweightScopes.length) {
      return;
    }
    try {
      const result = await ctx.invoke("workflow.scopes.hydrate", {
        purpose: "extraction",
        scopes: state.lightweightScopes,
      });
      state.lightweightScopes = Array.isArray(result.scopes) ? result.scopes : state.lightweightScopes;
      renderScopeOptions(state.lightweightScopes, state.scopeKey);
    }
    catch (_error) {}
  }

  async function loadScopes(preferredScope = state.scopeKey || "", allowScopeReset = true) {
    try {
      const result = await ctx.invoke("workflow.scopes.list", { purpose: "extraction" });
      state.lightweightScopes = Array.isArray(result.scopes) ? result.scopes : [];
      renderScopeOptions(state.lightweightScopes, preferredScope);
      void hydrateScopes();
      return state.lightweightScopes;
    }
    catch (error) {
      if (allowScopeReset && preferredScope && isScopeMissingError(error)) {
        state.scopeKey = "";
        await Promise.resolve(ctx.rememberScopeKey?.("")).catch(() => {});
        return await loadScopes("", false);
      }
      throw error;
    }
  }

  async function loadSourceOptions(preferredScope = state.scopeKey || "", preferredSource = sourceSelect.value || "title_abstract", options = {}) {
    const force = options.force === true;
    const cacheScopeKey = String(preferredScope || "");
    const cacheKey = "extraction:sources:list";
    const cached = !force ? readSelectorCache(projectID, cacheKey, cacheScopeKey) : null;
    if (cached?.sources) {
      renderSourceOptions(cached.sources, preferredSource);
    }
    else {
      setSelectPlaceholder(sourceSelect, "Loading text sources...");
    }
    const token = ++state.sourceToken;
    try {
      const result = await ctx.invoke("workflow.options.extractionSources.list", preferredScope ? { collection_key: preferredScope } : {});
      if (state.destroyed || token !== state.sourceToken) {
        return result;
      }
      const sources = Array.isArray(result?.sources) ? result.sources : [];
      writeSelectorCache(projectID, cacheKey, cacheScopeKey, { sources });
      renderSourceOptions(sources, preferredSource);
      return result;
    }
    catch (error) {
      if (options.allowScopeReset !== false && preferredScope && isScopeMissingError(error)) {
        state.scopeKey = "";
        await Promise.resolve(ctx.rememberScopeKey?.("")).catch(() => {});
        await loadScopes("", false);
        return await loadSourceOptions("", preferredSource, Object.assign({}, options, {
          allowScopeReset: false,
        }));
      }
      throw error;
    }
  }

  async function loadRuntimeSelectorOptions(preferredPresetID = runtimePresetSelect.value || "", options = {}) {
    const force = options.force === true;
    const cacheKey = "extraction:runtimes:list:v2";
    const cached = !force ? readSelectorCache(projectID, cacheKey) : null;
    if (cached?.runtime_options) {
      renderRuntimeOptions(cached.runtime_options, preferredPresetID);
    }
    else {
      setSelectPlaceholder(runtimePresetSelect, "Loading model presets...");
    }
    const token = ++state.runtimeToken;
    const result = await ctx.invoke("workflow.options.extractionRuntimes.list", {});
    if (state.destroyed || token !== state.runtimeToken) {
      return result;
    }
    const runtimeOptions = result?.runtime_options || { default_label: "Default", presets: [] };
    writeSelectorCache(projectID, cacheKey, "", { runtime_options: runtimeOptions });
    renderRuntimeOptions(runtimeOptions, preferredPresetID);
    return result;
  }

  async function refreshWorkspace(options = {}) {
    const preferredTemplatePath = options.templatePath || templateSelect.value || state.currentTemplate?.path || "";
    const preferredScope = options.scopeKey !== undefined ? options.scopeKey : (scopeSelect.value || state.scopeKey || "");
    if (options.manual) {
      ctx.setStatus("Refreshing Extraction...");
    }
    const library = await ctx.invoke("extraction.templates.list");
    state.templateLibrary = Array.isArray(library.templates) ? library.templates : [];
    renderTemplateLibrary(state.templateLibrary, preferredTemplatePath);
    await loadScopes(preferredScope);
    if (state.templateLibrary.length && (templateSelect.value || state.templateLibrary[0]?.path)) {
      await loadTemplateByPath(templateSelect.value || state.templateLibrary[0].path);
    }
    else {
      clearTemplateState();
    }
    if (options.manual) {
      await Promise.all([
        loadSourceOptions(preferredScope, options.sourceKey || sourceSelect.value || "title_abstract", { force: true }),
        loadRuntimeSelectorOptions(runtimePresetSelect.value || "", { force: true }),
        loadTemplateColumnOptions({ force: true }),
      ]);
      ctx.setStatus("Extraction refreshed.", "is-ready");
      return;
    }
    state.cancelAfterPaint?.();
    state.cancelAfterPaint = scheduleAfterPaint(() => {
      Promise.all([
        loadSourceOptions(preferredScope, options.sourceKey || sourceSelect.value || "title_abstract", { force: false }),
        loadRuntimeSelectorOptions(runtimePresetSelect.value || "", { force: false }),
        loadTemplateColumnOptions({ force: false }),
      ]).catch((error) => {
        if (!state.destroyed) {
          ctx.setStatus(error?.message || String(error), "is-error");
        }
      });
    });
  }

  async function importTemplateFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,.json,application/yaml,application/json,text/yaml,text/x-yaml";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) {
        return;
      }
      try {
        ctx.setStatus("Importing extraction template...");
        const content = await file.text();
        const saved = await ctx.invoke("extraction.templates.import", {
          content,
          create_new: true,
        });
        await refreshWorkspace({ templatePath: saved.path, scopeKey: state.scopeKey });
        await ensureTemplateSelected(saved.path);
        ctx.setStatus("Extraction template imported.", "is-ready");
      }
      catch (error) {
        ctx.setStatus(error?.message || String(error), "is-error");
      }
    });
    input.click();
  }

  async function saveBuilderTemplate() {
    const payload = {
      path: String(state.builderTemplate?.path || "").trim(),
      name: String(builderName.value || "").trim(),
      description: String(builderDescription.value || "").trim(),
      system_prompt: String(builderSystem.value || ""),
      format_instructions: String(builderFormat.value || ""),
      user_prompt: "",
      field_block_template: "",
      fields: readBuilderFields(builderFields),
      examples: Array.isArray(state.builderTemplate?.examples) ? state.builderTemplate.examples : [],
    };
    if (!payload.name) {
      throw new Error("Template name is required.");
    }
    if (!payload.fields.length) {
      throw new Error("Add at least one field before saving.");
    }
    const command = payload.path && state.builderMode === "edit"
      ? "extraction.templates.save"
      : "extraction.templates.create";
    const saved = await ctx.invoke(command, payload);
    closeBuilder();
    await refreshWorkspace({ templatePath: saved.path, scopeKey: state.scopeKey });
    await ensureTemplateSelected(saved.path);
    ctx.setStatus("Extraction template saved.", "is-ready");
  }

  async function runExtraction() {
    if (!state.currentTemplate?.path) {
      throw new Error("Choose or save a template before running extraction.");
    }
    const selectedFields = Array.from(state.selectedFieldKeys);
    if (!selectedFields.length) {
      throw new Error("Choose at least one field to extract.");
    }
    const payload = {
      template_path: state.currentTemplate.path,
      source_key: sourceSelect.value || "title_abstract",
      selected_fields: selectedFields,
      row_scope: skipExistingInput.checked ? "missing_fields" : "all",
      detach: true,
    };
    if (scopeSelect.value) {
      payload.collection_key = scopeSelect.value;
    }
    const runtimeSelection = parseRuntimePresetSelection(runtimePresetSelect.value);
    if (runtimeSelection.runtime_role_id) {
      payload.runtime_role_id = runtimeSelection.runtime_role_id;
    }
    if (runtimeSelection.runtime_preset_id) {
      payload.runtime_preset_id = runtimeSelection.runtime_preset_id;
    }
    ctx.setStatus("Queueing extraction job...");
    const result = await ctx.invoke("extraction.run", payload);
    await Promise.resolve(ctx.rememberTabJobID?.(result.job_id || "", "extraction")).catch(() => {});
    ctx.setStatus(result.message || "Job started. Track progress in Jobs.", "is-ready");
  }

  uploadButton.addEventListener("click", () => {
    importTemplateFile().catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  editButton.addEventListener("click", () => {
    if (!state.currentTemplate) {
      return;
    }
    openBuilder(state.currentTemplate || {}, "edit");
  });
  newButton.addEventListener("click", () => {
    const base = cloneTemplateForNew(state.currentTemplate || {});
    openBuilder(base, "new");
  });
  templateSelect.addEventListener("change", () => {
    if (!templateSelect.value) {
      clearTemplateState();
      return;
    }
    loadTemplateByPath(templateSelect.value).then(() => {
      ctx.setStatus("Extraction template loaded.", "is-ready");
    }).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  scopeSelect.addEventListener("change", () => {
    state.scopeKey = scopeSelect.value || "";
    Promise.resolve(ctx.rememberScopeKey?.(state.scopeKey || "")).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
    loadSourceOptions(state.scopeKey, sourceSelect.value || "title_abstract", { force: true }).then(() => {
      ctx.setStatus("Extraction scope updated.", "is-ready");
    }).catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  runButton.addEventListener("click", () => {
    runExtraction().catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  builderAddField.addEventListener("click", () => {
    builderFields.appendChild(createBuilderFieldBlock(ctx, {}, {
      attachPlaceholderAutocomplete,
    }));
  });
  builderClose.addEventListener("click", () => closeBuilder());
  builderSave.addEventListener("click", () => {
    saveBuilderTemplate().catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  });
  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) {
      closeBuilder();
    }
  });
  attachPlaceholderAutocomplete(builderSystem);
  attachPlaceholderAutocomplete(builderFormat);

  modal.append(
    ctx.createNode("div", {
      className: "mw-extraction-modal-header",
      children: [
        modalTitle,
        ctx.createNode("div", {
          className: "mw-actions",
          children: [builderSave, builderClose],
        }),
      ],
    }),
    ctx.createNode("div", {
      className: "mw-extraction-modal-body",
      children: [
        ctx.createNode("div", {
          className: "mw-grid",
          children: [
            field(ctx, "Template name", builderName),
            field(ctx, "Description", builderDescription),
          ],
        }),
        field(ctx, "System prompt", builderSystem, { full: true }),
        ctx.createNode("div", {
          className: "mw-muted mw-small",
          textContent: "Type @{ to insert row values such as @{citation_text}, @{title}, @{full-text}, @{screening:column_key}, or @{extraction:field_key}. Field guidance can use the same placeholders. Only the fields selected for the run are serialized into the request.",
        }),
        field(ctx, "Format instructions", builderFormat, { full: true }),
        ctx.createNode("div", { className: "mw-extraction-section-title", textContent: "Fields" }),
        builderFields,
        ctx.createNode("div", {
          className: "mw-actions",
          children: [builderAddField],
        }),
      ],
    }),
  );
  modalBackdrop.appendChild(modal);

  panel.append(
    ctx.createNode("div", {
      className: "mw-extraction-layout",
      children: [
        ctx.createNode("div", {
          className: "mw-card mw-extraction-card",
          children: [
            ctx.createNode("h3", { textContent: "Template + Fields" }),
            ctx.createNode("div", {
              className: "mw-muted",
              textContent: "Choose a project template, edit it if needed, then select which fields to send to the LLM.",
            }),
            field(ctx, "Template", templateSelect),
            ctx.createNode("div", {
              className: "mw-actions",
              children: [uploadButton, editButton, newButton],
            }),
            templateStatus,
            templateName,
            ctx.createNode("div", {
              className: "mw-extraction-section-title",
              textContent: "Fields",
            }),
            fieldContainer,
          ],
        }),
        ctx.createNode("div", {
          className: "mw-card mw-extraction-card",
          children: [
            ctx.createNode("h3", { textContent: "Run" }),
            ctx.createNode("div", {
              className: "mw-muted",
              textContent: "Run with the default extraction model, or choose one saved extraction preset. Track progress in Jobs.",
            }),
            field(ctx, "Scope", scopeSelect),
            field(ctx, "Text source", sourceSelect),
            field(ctx, "Model preset", runtimePresetSelect),
            runtimeStatus,
            ctx.createNode("label", {
              className: "mw-pill-toggle",
              children: [
                skipExistingInput,
                ctx.createNode("span", { textContent: "Skip rows with existing values" }),
              ],
            }),
            ctx.createNode("div", {
              className: "mw-actions",
              children: [runButton],
            }),
          ],
        }),
      ],
    }),
    modalBackdrop,
  );

  setSelectPlaceholder(scopeSelect, "Loading scopes...");
  setSelectPlaceholder(sourceSelect, "Loading text sources...");
  setSelectPlaceholder(runtimePresetSelect, "Loading model presets...");

  Promise.resolve(ctx.readSharedScopeKey?.())
    .catch(() => String(ctx.getSharedScopeKey?.() || ""))
    .then((scopeKey) => {
      state.scopeKey = String(scopeKey || state.scopeKey || "");
      state.cancelAfterPaint?.();
      state.cancelAfterPaint = scheduleAfterPaint(() => {
        refreshWorkspace({ scopeKey: state.scopeKey, manual: false }).catch((error) => {
          ctx.setStatus(error?.message || String(error), "is-error");
        });
      });
      return null;
    })
    .catch((error) => {
      ctx.setStatus(error?.message || String(error), "is-error");
    });
  return {
    node: panel,
    refresh: async () => {
      await refreshWorkspace({ scopeKey: state.scopeKey, manual: true });
    },
    destroy() {
      state.destroyed = true;
      state.cancelAfterPaint?.();
      placeholderAutocomplete.destroy();
    },
  };
}
