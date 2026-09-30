import "../css/organization-contacts.css";
import {
  escapeText as e,
  button,
  field,
  select,
  textarea,
  head,
  notice,
  count,
  list,
  id,
  uuid,
  label,
} from "./textingWorkspaceUi";
import {
  contactValue,
  displayContactValue,
  typedContactInput,
  contactFilterValue,
  contactCsvCell,
} from "./organizationContactsModel";
import {
  previewContactFile,
  uploadSharedContactRows,
  assertContactImportHeaders,
  boundedContactImportPreview,
} from "./organizationContactImport";

const defaults = ["displayName", "city", "state", "phone", "consentStatus"];
const virtualFields = [
  { fieldId: "tags", label: "Tags", type: "multiple_choice" },
  { fieldId: "sources", label: "Import sources", type: "multiple_choice" },
  { fieldId: "eligibility", label: "Texting eligibility", type: "text" },
  { fieldId: "status", label: "Contact status", type: "text" },
];
const operators = [
  ["eq", "is"],
  ["neq", "is not"],
  ["contains", "contains"],
  ["in", "is any of"],
  ["any", "has any"],
  ["all", "has all"],
  ["none", "has none"],
  ["exists", "is recorded"],
  ["gt", "greater than"],
  ["lt", "less than"],
];
const simpleTypes = new Set([
  "text",
  "long_text",
  "number",
  "date",
  "datetime",
  "boolean",
  "single_choice",
  "multiple_choice",
  "phone",
  "email",
  "url",
  "json",
  "address",
  "jurisdiction",
]);
const fieldId = (field) => field.fieldId;
const checkbox = (name, text, checked, extra = "") =>
  `<label class="pt-workspace-check"><input type="checkbox" data-contact-change="${e(name)}"${checked ? " checked" : ""} ${extra}>${e(text)}</label>`;

/** One controller powers the organization book and campaign selector; selections are always local. */
export function createOrganizationContactBook(r, { mode = "book" } = {}) {
  let queryGeneration = 0,
    queryAbort = null,
    disposed = false;
  const dispose = () => {
    disposed = true;
    queryGeneration++;
    queryAbort?.abort();
    r.contactApi.invalidate?.();
  };
  const prefix = mode === "selector" ? "recipients" : "book";
  const slot = mode === "selector" ? "recipientBook" : "contactBook";
  const state = () =>
    (r.view()[slot] ||= {
      rows: [],
      columns: [...defaults],
      pinnedColumns: [],
      filters: [],
      query: { sort: { field: "displayName", direction: "asc" } },
      includeIds: new Set(),
      excludeIds: new Set(),
      panel: "contacts",
      endpointChoices: {},
    });
  const details = (title, content) =>
    `<details class="pt-workspace-details" data-contact-change="${prefix}-disclosure" data-disclosure="${e(title)}"${state().expanded?.has(title) ? " open" : ""}><summary>${e(title)}</summary>${content}</details>`;
  const api = (...args) => r.contactApi(...args);
  const can = (name) => state().schema?.capabilities?.[name] === true;
  const b = (action, text, options = {}) =>
    button(`${prefix}-${action}`, text, { disabled: r.busy(), ...options });
  const formName = (suffix) => `${prefix}-${suffix}`;
  const fields = () =>
    list(state().schema?.fields).filter((item) => !item.archived);
  const tags = () => list(state().schema?.tags).filter((tag) => !tag.archived);
  const tagGroups = () =>
    [
      ...new Set(
        tags()
          .map((tag) => tag.groupId)
          .filter(Boolean),
      ),
    ].map((groupId) => {
      const memberTags = tags().filter((tag) => tag.groupId === groupId);
      return {
        fieldId: `tag_group:${groupId}`,
        groupId,
        label: memberTags.find((tag) => tag.groupLabel)?.groupLabel || groupId,
        type: "multiple_choice",
        memberTags,
      };
    });
  const columnDefinition = (key) =>
    key.startsWith("tag_group:")
      ? tagGroups().find((group) => group.fieldId === key)
      : key.startsWith("tag:")
        ? {
            fieldId: key,
            label:
              tags().find((tag) => `tag:${tag.tagId}` === key)?.label || "Tag",
          }
        : fields().find((item) => item.fieldId === key);
  const filterFields = () => [
    ...fields().filter((item) => item.filterable !== false),
    ...virtualFields,
    ...tagGroups(),
  ];
  const invalidateSelection = () => {
    const s = state();
    s.selection = null;
    s.selectionOperationId = null;
    s.reviewed = false;
    s.bound = null;
    s.bindOperationId = null;
  };
  async function schema() {
    state().schema = await api("/schema");
  }
  async function query({
    more = false,
    previous = false,
    refresh = false,
  } = {}) {
    const s = state();
    const requestedCursor = previous
      ? s.previousCursors?.at(-1)
      : more
        ? s.cursor
        : null;
    const generation = ++queryGeneration;
    queryAbort?.abort();
    const controller = new AbortController();
    queryAbort = controller;
    let result;
    try {
      result = await api(
        "/query",
        {
          ...s.query,
          limit: 50,
          ...(requestedCursor ? { cursor: requestedCursor } : {}),
        },
        "POST",
        {
          signal: controller.signal,
          refresh,
          isCurrent: () => !disposed && generation === queryGeneration,
        },
      );
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        disposed ||
        generation !== queryGeneration
      )
        return;
      s.rows = [];
      s.cursor = null;
      s.total = null;
      s.complete = false;
      s.recentResults = false;
      s.previousCursors = [];
      s.currentCursor = null;
      s.pageNumber = 1;
      if ([401, 403].includes(error?.status || error?.statusCode)) {
        s.schema = { capabilities: {} };
        s.selectedRows = [];
        s.addRows = [];
        invalidateSelection();
      }
      if (
        (error?.payload?.error || error?.code) ===
        "contact_index_preparation_required"
      ) {
        const requirement = error.payload?.details || error.details || {};
        if (
          JSON.stringify(requirement) !== JSON.stringify(s.indexRequirement)
        ) {
          s.indexJob = null;
          s.indexOperationId = uuid();
        }
        s.indexRequirement = requirement;
      } else {
        s.indexRequirement = null;
        s.indexJob = null;
      }
      throw error;
    }
    if (disposed || generation !== queryGeneration) return;
    s.previousCursors ||= [];
    if (previous) {
      s.previousCursors.pop();
      s.pageNumber--;
    } else if (more) {
      s.previousCursors.push(s.currentCursor || null);
      if (s.previousCursors.length > 8) s.previousCursors.shift();
      s.pageNumber = (s.pageNumber || 1) + 1;
    } else {
      s.previousCursors = [];
      s.pageNumber = 1;
    }
    s.currentCursor = requestedCursor;
    s.rows = list(result.items);
    s.cursor = result.nextCursor;
    s.complete = result.complete;
    s.total = result.total;
    s.bookRevision = result.bookRevision;
    s.recentResults = result.fromCache === true;
    s.indexRequirement = null;
    s.indexJob = null;
  }
  async function prepareIndex({ resume = false, refresh = false } = {}) {
    const s = state(),
      jobId = s.indexJob?.id || s.indexRequirement?.jobId;
    if (!s.indexRequirement) return;
    if (!refresh && !can("manage"))
      throw new Error("A contact manager must prepare this search.");
    if (refresh && jobId) s.indexJob = (await api(`/indexes/${id(jobId)}`)).job;
    else if (resume && jobId) {
      s.indexResumeOperationId ||= uuid();
      s.indexJob = (
        await api(`/indexes/${id(jobId)}/resume`, {
          operationId: s.indexResumeOperationId,
        })
      ).job;
      s.indexResumeOperationId = null;
    } else {
      s.indexOperationId ||= uuid();
      s.indexJob = (
        await api("/indexes/prepare", {
          fieldId: s.indexRequirement.fieldId,
          operation: s.indexRequirement.operation,
          operationId: s.indexOperationId,
        })
      ).job;
    }
    r.changed();
    for (
      let step = 0;
      !disposed && !refresh && s.indexJob?.status === "preparing" && step < 4;
      step++
    ) {
      r.guard();
      s.indexJob = (await api(`/indexes/${id(s.indexJob.id)}/advance`, {})).job;
      r.changed();
    }
    if (s.indexJob?.status === "ready") await query({ refresh: true });
  }
  function indexPreparation() {
    const s = state();
    if (!s.indexRequirement) return "";
    const job = s.indexJob;
    return (
      notice(
        "Prepare contact search",
        job
          ? `${count(job.processedContacts || 0)} contacts processed · ${count(job.workUsed || 0)} of ${count(job.workBudget || 0)} work units · ${label(job.status)}. ${job.status === "paused" ? "The work budget was reached. Resume explicitly to continue." : "Results will appear after preparation finishes."}`
          : `${s.indexRequirement.fieldId} needs ${s.indexRequirement.operation} indexing. ${can("manage") ? "Prepare this index to use the filter or sort." : "Ask a contact manager to prepare this search."}`,
      ) +
      `<div class="pt-actions">${can("manage") ? b("index-prepare", job?.status === "paused" ? "Resume index preparation" : job ? "Continue index preparation" : "Prepare search index") : ""}${job || s.indexRequirement.jobId ? b("index-status", "Refresh preparation status", { secondary: true }) : ""}</div>`
    );
  }
  async function savedItems(kind) {
    const items = [],
      seen = new Set();
    let cursor;
    do {
      const result = await api(
        `/${kind}${cursor ? `?cursor=${id(cursor)}` : ""}`,
      );
      items.push(...list(result.items));
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor))
        throw new Error(
          "Saved layout pagination did not advance. Refresh and try again.",
        );
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
  async function load() {
    await schema();
    const s = state();
    if (!can("read")) return;
    const [views, audiences] = await Promise.all([
      savedItems("views"),
      savedItems("audiences"),
    ]);
    s.views = views;
    s.audiences = audiences;
    if (!s.defaultViewLoaded) {
      const initialView = s.views.find(
        (view) => view.viewId === s.schema.viewDefaults?.viewId,
      );
      if (initialView) applyView(initialView);
      s.defaultViewLoaded = true;
    }
    s.columns = s.columns.filter(
      (key) =>
        fields().some((item) => item.fieldId === key) ||
        tags().some((tag) => `tag:${tag.tagId}` === key) ||
        tagGroups().some((group) => group.fieldId === key),
    );
    if (!s.columns.length) s.columns = fields().slice(0, 5).map(fieldId);
    await query();
  }
  function applyView(item) {
    const s = state();
    s.query.filter = item.filter || null;
    s.query.search = item.search || "";
    if (item.sort) s.query.sort = item.sort;
    if (item.columns) s.columns = [...item.columns];
    s.pinnedColumns = [...(item.pinnedColumns || [])];
    const root = item.filter;
    s.filterMode = root?.conditions ? root.op : "and";
    s.filters = root
      ? root.conditions
        ? draftCondition(root).conditions
        : [draftCondition(root)]
      : [];
  }
  function selected(contact) {
    const s = state();
    return (
      s.includeIds.has(contact.contactId) ||
      (s.allMatching && !s.excludeIds.has(contact.contactId))
    );
  }
  function selectionSpec() {
    const s = state();
    return {
      mode: s.allMatching ? "all_matching" : "explicit",
      query: s.selectionQuery || s.query,
      includeIds: [...s.includeIds],
      excludeIds: [...s.excludeIds],
      endpointChoices: s.endpointChoices,
      ...(s.selectionRevision != null
        ? { expectedBookRevision: s.selectionRevision }
        : {}),
    };
  }
  async function advanceSelection() {
    const s = state();
    for (let step = 0; s.selection?.status === "building" && step < 8; step++) {
      s.selection = (
        await api(`/selections/${id(s.selection.selectionId)}/advance`, {
          operationId: uuid(),
        })
      ).selection;
      r.changed();
    }
  }
  async function prepareSelection() {
    const s = state();
    if (!can("select"))
      throw new Error("Your role cannot select this contact data.");
    if (!s.allMatching && !s.includeIds.size)
      throw new Error("Choose contacts first.");
    s.selectionOperationId ||= uuid();
    s.selection = (
      await api("/selections", {
        ...selectionSpec(),
        operationId: s.selectionOperationId,
      })
    ).selection;
    await advanceSelection();
    if (s.selection?.status === "ready") await loadSelected();
  }
  async function loadSelected(more = false) {
    const s = state();
    const result = await api(
      `/selections/${id(s.selection.selectionId)}/contacts${more && s.selectedCursor ? `?cursor=${id(s.selectedCursor)}` : ""}`,
    );
    s.selectedRows = list(result.items);
    s.selectedPage = more ? (s.selectedPage || 1) + 1 : 1;
    s.selectedCursor = result.nextCursor;
  }
  async function bindCampaign(campaignId) {
    const s = state();
    if (s.selection?.duplicateEndpointCount)
      throw new Error(
        "Several selected contacts share a phone number. Uncheck extra contacts or choose a separate eligible number, then review the selection again.",
      );
    if (s.selection?.status !== "ready" || !s.reviewed)
      throw new Error(
        "Review and confirm the recipient selection before saving this campaign.",
      );
    if (
      s.bound?.campaignId === campaignId &&
      s.bound?.selectionId === s.selection.selectionId
    )
      return s.bound.audienceId;
    s.bindOperationId ||= uuid();
    const result = await api(
      `/selections/${id(s.selection.selectionId)}/campaign`,
      { campaignId, operationId: s.bindOperationId },
    );
    if (!result.audienceId || result.exportAuthorized !== false)
      throw new Error("The local campaign selection could not be verified.");
    s.bound = { ...result, campaignId };
    return result.audienceId;
  }
  function filterForm() {
    const s = state();
    return `<form data-workspace-form="${formName("filter")}" class="pt-contact-filter"><div class="pt-contact-tools">${field("search", "Search contacts", s.query.search || "", { max: 200, extra: 'placeholder="Name, contact details…"' })}${select(
      "sort",
      "Sort by",
      fields()
        .filter((item) => item.sortable !== false)
        .map((item) => [item.fieldId, item.label]),
      s.query.sort?.field,
    )}${select(
      "direction",
      "Order",
      [
        ["asc", "Ascending"],
        ["desc", "Descending"],
      ],
      s.query.sort?.direction || "asc",
    )}<button type="submit" class="pt-btn pt-btn--secondary"${r.busy() || s.allMatching ? " disabled" : ""}>Apply</button></div>${details(
      "Filter contacts",
      `${select(
        "filterMode",
        "Match",
        [
          ["and", "All conditions"],
          ["or", "Any condition"],
          ["not", "None of these conditions"],
        ],
        s.filterMode || "and",
      )}${renderFilterConditions(s.filters)}<div class="pt-actions">${b("filter-add", "Add condition", { secondary: true, disabled: !!s.allMatching || r.busy() })}${b("filter-group-add", "Add group", { secondary: true, disabled: !!s.allMatching || r.busy() })}${b("filter-clear", "Clear filters", { secondary: true, disabled: !!s.allMatching || r.busy() })}</div><p class="pt-muted">For district filters, choose a state as well as a district.</p>`,
    )}${s.allMatching ? notice("Selection filters are held", "Clear the selection to change these filters. You can add individual contacts using the separate search below.") : ""}</form>`;
  }
  function filterNode(path) {
    let nodes = state().filters,
      node;
    for (const index of String(path).split(".")) {
      node = nodes[Number(index)];
      nodes = node?.conditions;
    }
    return node;
  }
  function filterChildren(path = "") {
    return path ? filterNode(path).conditions : state().filters;
  }
  function draftCondition(condition) {
    return condition.conditions
      ? {
          ...condition,
          conditions: (condition.op === "not" &&
          condition.conditions.length === 1 &&
          condition.conditions[0].op === "or"
            ? condition.conditions[0].conditions
            : condition.conditions
          ).map(draftCondition),
        }
      : {
          ...condition,
          value: Array.isArray(condition.value)
            ? condition.value.join(", ")
            : String(condition.value ?? ""),
        };
  }
  function renderFilterConditions(conditions, parentPath = "") {
    const s = state(),
      disabled = !!s.allMatching || r.busy();
    return conditions
      .map((condition, index) => {
        const path = parentPath ? `${parentPath}.${index}` : String(index);
        if (condition.conditions)
          return `<fieldset class="pt-contact-filter-group"><legend>Condition group</legend>${select(
            `group_${path}`,
            "Group match",
            [
              ["and", "All conditions"],
              ["or", "Any condition"],
              ["not", "None of these conditions"],
            ],
            condition.op,
          )}${renderFilterConditions(condition.conditions, path)}<div class="pt-actions">${b("filter-add", "Add condition", { secondary: true, value: path, disabled })}${path.split(".").length < 3 ? b("filter-group-add", "Add group", { secondary: true, value: path, disabled }) : ""}${b("filter-remove", "Remove group", { secondary: true, value: path, disabled })}</div></fieldset>`;
        return `<div class="pt-contact-filter-row">${select(
          `field_${path}`,
          "Field",
          filterFields().map((item) => [item.fieldId, item.label]),
          condition.field,
        )}${select(`op_${path}`, "Condition", ["tags", "sources"].includes(condition.field) || condition.field.startsWith("tag_group:") ? operators.filter(([op]) => ["any", "all", "none"].includes(op)) : operators, condition.op || "eq")}${filterInput(condition, path)}${b("filter-remove", "Remove", { secondary: true, value: path, disabled })}</div>`;
      })
      .join("");
  }
  function filterInput(condition, index) {
    if (condition.field.startsWith("tag_group:")) {
      const group = tagGroups().find(
        (group) => group.fieldId === condition.field,
      );
      const selectedIds = String(condition.value || "")
        .split(",")
        .map((value) => value.trim());
      return `<label class="pt-field"><span>Group tags</span><select name="value_${e(index)}" multiple>${(group?.memberTags || []).map((tag) => `<option value="${e(tag.tagId)}"${selectedIds.includes(tag.tagId) ? " selected" : ""}>${e(tag.label)}</option>`).join("")}</select></label>`;
    }
    const s = state();
    if (["tags", "sources"].includes(condition.field)) {
      const selectedValues = String(condition.value || "")
        .split(",")
        .map((value) => value.trim());
      const choices =
        condition.field === "tags"
          ? tags().map((tag) => [tag.tagId, tag.label])
          : [
              ...new Map(
                [
                  ...list(s.schema.sources),
                  ...s.rows.flatMap((row) => list(row.sources)),
                ].map((source) => [
                  source.sourceId,
                  source.label || source.sourceId,
                ]),
              ).entries(),
            ];
      for (const value of selectedValues.filter(Boolean))
        if (!choices.some(([key]) => key === value))
          choices.push([value, "Saved source"]);
      return `<label class="pt-field"><span>${condition.field === "tags" ? "Tags" : "Import sources"}</span><select name="value_${index}" multiple size="3">${choices.map(([key, text]) => `<option value="${e(key)}"${selectedValues.includes(key) ? " selected" : ""}>${e(text)}</option>`).join("")}</select></label>`;
    }
    if (condition.field === "status")
      return select(
        `value_${index}`,
        "Value",
        [
          ["active", "Active"],
          ["archived", "Archived"],
        ],
        condition.value || "active",
      );
    if (condition.field === "eligibility")
      return select(
        `value_${index}`,
        "Value",
        [
          ["eligible", "Eligible"],
          ["held", "Needs review"],
          ["suppressed", "Suppressed"],
        ],
        condition.value || "eligible",
      );
    if (condition.field === "consentStatus")
      return select(
        `value_${index}`,
        "Value",
        [
          ["unknown", "Unknown"],
          ["opted_in", "Opted in"],
          ["opted_out", "Opted out"],
        ],
        condition.value || "unknown",
      );
    if (
      filterFields().find((field) => field.fieldId === condition.field)
        ?.type === "boolean"
    )
      return select(
        `value_${index}`,
        "Value",
        [
          ["", "Unknown"],
          ["true", "Yes"],
          ["false", "No"],
        ],
        condition.value || "",
      );
    return field(`value_${index}`, "Value", condition.value || "", {
      max: 1000,
      extra: 'placeholder="Separate multiple values with commas"',
    });
  }
  function rowTable(rows, { review = false, addition = false } = {}) {
    const s = state(),
      columns = [
        ...(s.pinnedColumns || []).filter((key) => s.columns.includes(key)),
        ...s.columns.filter((key) => !s.pinnedColumns?.includes(key)),
      ]
        .map(columnDefinition)
        .filter(Boolean);
    const pin = (key) => {
      const index = (s.pinnedColumns || [])
        .filter((item) => s.columns.includes(item))
        .indexOf(key);
      return index < 0
        ? ""
        : ` class="pt-contact-pinned" style="left:${index * 180}px"`;
    };
    return `<div class="pt-workspace-table-wrap"><table class="pt-workspace-table pt-contact-table"><thead><tr>${can("select") ? '<th scope="col">Select</th>' : ""}${columns.map((item) => `<th scope="col"${pin(item.fieldId)}>${e(item.label)}</th>`).join("")}<th scope="col">Details</th></tr></thead><tbody>${rows.map((contact) => `<tr>${can("select") ? `<td class="pt-contact-select"><input type="checkbox" aria-label="Select ${e(contact.fields?.displayName || contact.fields?.fullName || "contact")}" data-contact-change="${prefix}-row" data-contact-id="${e(contact.contactId)}"${addition ? ' data-addition="true"' : ""}${(addition ? s.includeIds.has(contact.contactId) : review || selected(contact)) ? " checked" : ""}${r.busy() ? " disabled" : ""}></td>` : ""}${columns.map((item) => `<td data-label="${e(item.label)}"${pin(item.fieldId)}>${item.fieldId.startsWith("tag:") && can("edit") && mode === "book" ? `<input type="checkbox" aria-label="${e(item.label)} for ${e(contact.fields?.displayName || "contact")}" data-contact-change="${prefix}-tag-cell" data-contact-id="${e(contact.contactId)}" data-tag-id="${e(item.fieldId.slice(4))}"${contactValue(contact, item) ? " checked" : ""}${r.busy() ? " disabled" : ""}>` : e(displayContactValue(contactValue(contact, item)))}</td>`).join("")}<td class="pt-contact-open">${b("detail", "Open", { secondary: true, value: contact.contactId })}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function columnOrderControls() {
    const s = state();
    return `<div class="pt-contact-column-order"><p class="pt-muted">Column order</p>${s.columns.map((key, index) => `<div class="pt-row"><span>${e(columnDefinition(key)?.label || key)}</span><div class="pt-actions">${checkbox(`${prefix}-column-pin`, "Pin", s.pinnedColumns?.includes(key), `value="${e(key)}"`)}${b("column-earlier", "Move earlier", { secondary: true, value: key, disabled: r.busy() || index === 0 })}${b("column-later", "Move later", { secondary: true, value: key, disabled: r.busy() || index === s.columns.length - 1 })}</div></div>`).join("")}</div>`;
  }
  function viewTools() {
    const s = state();
    return details(
      "View and saved audiences",
      `<form data-workspace-form="${formName("view")}"><div class="pt-contact-columns">${[...fields(), ...tags().map((tag) => ({ fieldId: `tag:${tag.tagId}`, label: `Tag: ${tag.label}` })), ...tagGroups().map((group) => ({ ...group, label: `Tag group: ${group.label}` }))].map((item) => checkbox(`${prefix}-column`, item.label, s.columns.includes(item.fieldId), `value="${e(item.fieldId)}"`)).join("")}</div>${columnOrderControls()}${field("name", s.editingView ? "View name" : "Save this view as", s.viewDraft?.name || "", { required: true })}${select(
        "visibility",
        "Who can use this view",
        [
          ["private", "Only me"],
          ["organization", "Organization"],
        ],
        s.viewDraft?.visibility || "private",
      )}<button type="submit" class="pt-btn pt-btn--secondary">${s.editingView ? "Save view changes" : "Save view"}</button>${s.editingView ? b("view-cancel-edit", "Cancel editing", { secondary: true }) : ""}</form><div class="pt-actions">${list(
        s.views,
      )
        .map(
          (view) =>
            `<div class="pt-row"><span>${b("view-load", view.name, { secondary: true, value: view.viewId || view.id, disabled: !!s.allMatching || r.busy() })}${s.schema.viewDefaults?.viewId === view.viewId ? " · Organization default" : ""}</span><div class="pt-actions">${b("view-edit", "Edit layout", { secondary: true, value: view.viewId || view.id, disabled: !!s.allMatching || r.busy() })}${can("manage") && view.visibility === "organization" ? b("view-default", "Set organization default", { secondary: true, value: view.viewId || view.id }) : ""}${b("view-archive", "Archive layout", { secondary: true, value: view.viewId || view.id })}</div></div>`,
        )
        .join(
          "",
        )}</div><form data-workspace-form="${formName("audience")}" class="pt-contact-save">${field("name", "Save these filters as an audience", s.audienceDraft?.name || "", { required: true })}${select(
        "visibility",
        "Who can use this audience",
        [
          ["private", "Only me"],
          ["organization", "Organization"],
        ],
        s.audienceDraft?.visibility || "private",
      )}<button type="submit" class="pt-btn pt-btn--secondary">Save audience</button></form><div class="pt-actions">${list(
        s.audiences,
      )
        .map((audience) =>
          b("audience-load", audience.name, {
            secondary: true,
            value: audience.audienceId || audience.id,
            disabled: !!s.allMatching || r.busy(),
          }),
        )
        .join("")}</div>`,
    );
  }
  function selectionReview() {
    const s = state();
    if (!s.selection) return "";
    const selection = s.selection;
    if (selection.status === "building")
      return (
        notice(
          "Building the complete selection",
          "The selection spans all result pages. Continue until its exact count is ready.",
        ) + b("selection-advance", "Continue selection")
      );
    if (selection.status !== "ready")
      return notice(
        "Selection needs review",
        list(selection.reasons).map(label).join(", ") ||
          "Resolve conflicting endpoints or refresh changed contacts before continuing.",
      );
    return `<section class="pt-card pt-contact-selection"><h3>Review selected contacts</h3>${
      selection.duplicateEndpointCount
        ? notice(
            "Shared phone numbers need review",
            `${count(selection.duplicateEndpointCount)} shared destinations were found. Keep one selected contact for each shared number, or choose a separate eligible number, then review again.`,
          ) +
          list(selection.duplicateEndpoints)
            .map(
              (group) =>
                `<p>${list(group.contactIds)
                  .map((contactId) =>
                    e(
                      s.selectedRows?.find((row) => row.contactId === contactId)
                        ?.fields?.displayName || contactId,
                    ),
                  )
                  .join(" · ")}</p>`,
            )
            .join("")
        : ""
    }<p><strong>${count(selection.count)}</strong> selected contacts · ${count(selection.eligibleCount || 0)} eligible for texting · ${count(selection.excludedCount || 0)} held for texting.</p>${list(s.selectedRows).length ? rowTable(s.selectedRows, { review: true }) : ""}${s.selectedPage > 1 ? b("selected-first", "First selected page", { secondary: true }) : ""}${s.selectedCursor ? b("selected-more", "Next selected page", { secondary: true }) : ""}${mode === "selector" ? `<p class="pt-muted">Only this reviewed selection can be prepared with your texting provider. Opt-outs are checked again before sending.</p>${checkbox(`${prefix}-reviewed`, "I reviewed these campaign recipients", s.reviewed, selection.duplicateEndpointCount ? "disabled" : "")}` : ""}</section>`;
  }
  function selectionTools() {
    const s = state();
    if (!can("select")) return "";
    const hasSelection = s.allMatching || s.includeIds.size;
    return `${mode === "selector" && hasSelection ? endpointControls() : ""}<div class="pt-contact-selection-bar"><span>${s.allMatching ? `All matching contacts${s.excludeIds.size ? `, excluding ${count(s.excludeIds.size)}` : ""}${s.includeIds.size ? `, plus ${count(s.includeIds.size)} individual choices` : ""}` : `${count(s.includeIds.size)} selected`}</span><div class="pt-actions">${b("select-page", "Select this page", { secondary: true })}${b("select-all", "Select all matching", { secondary: true, disabled: !s.rows.length || r.busy() })}${hasSelection ? b("select-clear", "Clear selection", { secondary: true }) + b("selection-review", "Review selection") : ""}</div></div>${hasSelection ? details("Add specific contacts", `<form data-workspace-form="${formName("add-search")}" class="pt-contact-save">${field("search", "Search the rest of your contact book", s.addSearch || "", { required: true })}<button class="pt-btn pt-btn--secondary" type="submit">Search</button></form>${list(s.addRows).length ? rowTable(s.addRows, { addition: true }) : ""}${s.addCursor ? b("add-more", "Next search page", { secondary: true }) : ""}`) : ""}${
      mode === "book" && can("edit") && hasSelection
        ? `<form data-workspace-form="${formName("bulk-tags")}" class="pt-contact-save">${select(
            "action",
            "Tag action",
            [
              ["add", "Add tag"],
              ["remove", "Remove tag"],
            ],
          )}${select(
            "tagId",
            "Tag",
            tags().map((tag) => [tag.tagId, tag.label]),
            "",
            true,
          )}<button class="pt-btn pt-btn--secondary" type="submit">Apply to selection</button></form>`
        : ""
    }${
      mode === "book" && can("edit") && hasSelection
        ? details(
            "More selection actions",
            `${can("manage") ? b("geography-start", "Update districts for selection", { secondary: true }) : ""}<p class="pt-muted">Uses installed local boundary coverage. Addresses are never sent to an outside geocoder.</p>${
              can("manage")
                ? `<form data-workspace-form="${formName("bulk-source-remove")}" class="pt-contact-save">${select(
                    "sourceId",
                    "Source membership to remove",
                    list(s.schema.sources).map((source) => [
                      source.sourceId,
                      source.label || source.sourceId,
                    ]),
                    "",
                    true,
                  )}<button type="submit" class="pt-btn pt-btn--secondary">Remove source from selection</button></form><p class="pt-muted">Only matching source memberships on the reviewed selection are removed. Other sources and recorded history remain available.</p>`
                : ""
            }`,
          )
        : ""
    }${bulkPanel()}${geographyPanel()}`;
  }
  function geographyPanel() {
    const s = state(),
      job = s.geographyJob;
    if (!job) return "";
    return `<section class="pt-card"><h3>Review district updates</h3><p class="pt-muted">Only installed local boundary coverage is used. Prepared campaign membership stays fixed.</p>${notice(label(job.status), `${count(job.processed || 0)} checked · ${count(job.changedCount || 0)} changed`)}${job.status === "needs_review" ? "<p>The contact book or boundary coverage changed. Start a new district review before applying.</p>" : ""}<div class="pt-actions">${["previewing", "applying"].includes(job.status) ? b("geography-advance", "Continue district review", { secondary: true }) : ""}${job.status === "preview_ready" ? b("geography-apply", "Apply reviewed district updates") : ""}${b("geography-outcomes", "Review district results", { secondary: true })}</div>${list(
      s.geographyOutcomes,
    )
      .map(
        (row) =>
          `<details class="pt-workspace-details"><summary>${e(s.rows.find((contact) => contact.contactId === row.contactId)?.fields?.displayName || row.contactId)} · ${e(label(row.geographyStatus || row.status))}</summary><pre class="pt-contact-json">${e(JSON.stringify(row, null, 2))}</pre></details>`,
      )
      .join(
        "",
      )}${s.geographyOutcomeCursor ? b("geography-outcomes-more", "More district results", { secondary: true }) : ""}<h4>Potentially affected saved views and audiences</h4><p class="pt-muted">These saved filters reference changed geography fields. Membership counts must be refreshed when each view is used.</p>${[
      "view",
      "audience",
    ]
      .map(
        (kind) =>
          `<div>${
            list(s.geographyAffected?.[kind]?.items)
              .map((item) => `<p>${e(item.name)}</p>`)
              .join("") ||
            `<p class="pt-muted">No ${kind === "view" ? "views" : "audiences"} listed${s.geographyAffected?.[kind]?.nextCursor ? " on this page" : ""}.</p>`
          }${s.geographyAffected?.[kind]?.nextCursor ? b("geography-affected-more", `More affected ${kind === "view" ? "views" : "audiences"}`, { secondary: true, value: kind }) : ""}</div>`,
      )
      .join("")}</section>`;
  }
  async function geographyOutcomes(more = false) {
    const s = state();
    const result = await api(
      `/geography-refresh/${id(s.geographyJob.jobId)}/outcomes${more && s.geographyOutcomeCursor ? `?cursor=${id(s.geographyOutcomeCursor)}` : ""}`,
    );
    s.geographyOutcomes = [
      ...(more ? list(s.geographyOutcomes) : []),
      ...list(result.items),
    ];
    s.geographyOutcomeCursor = result.nextCursor;
  }
  async function geographyAffected(kind, more = false) {
    const s = state();
    s.geographyAffected ||= {};
    const prior = s.geographyAffected[kind];
    const result = await api(
      `/geography-refresh/${id(s.geographyJob.jobId)}/affected-views?kind=${kind}${more && prior?.nextCursor ? `&cursor=${id(prior.nextCursor)}` : ""}`,
    );
    s.geographyAffected[kind] = {
      ...result,
      items: [...(more ? list(prior?.items) : []), ...list(result.items)],
    };
  }
  async function advanceGeography() {
    const s = state();
    for (
      let step = 0;
      ["previewing", "applying"].includes(s.geographyJob?.status) && step < 8;
      step++
    ) {
      s.geographyJob = (
        await api(`/geography-refresh/${id(s.geographyJob.jobId)}/advance`, {
          operationId: uuid(),
        })
      ).job;
      r.changed();
    }
    await geographyOutcomes();
    await Promise.all([
      geographyAffected("view"),
      geographyAffected("audience"),
    ]);
    if (s.geographyJob.status === "complete") await query();
  }
  function bulkPanel() {
    const s = state(),
      job = s.bulkJob;
    if (!job) return "";
    const tags = !job.action || job.action === "tags";
    const title =
      job.action === "enrich"
        ? "District update"
        : job.action === "source_remove"
          ? "Source removal"
          : "Tag update";
    return `${notice(job.phase === "undo" ? "Undo tag update" : title, `${label(job.status)} · ${count(job.processed || 0)} processed · ${count(job.phase === "undo" ? job.undoFailureCount || 0 : job.failureCount || 0)} need review`)}<div class="pt-actions">${!["complete", "undone", "failed"].includes(job.status) ? b("bulk-advance", `Continue ${title.toLowerCase()}`, { secondary: true }) : ""}${b("bulk-outcomes", tags ? "Review tag results" : "Review results", { secondary: true })}${tags && job.status === "complete" && job.phase !== "undo" ? b("bulk-undo", "Undo this tag update", { secondary: true }) : ""}</div>${s.bulkOutcomes ? `<div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr><th>Contact</th><th>Result</th><th>Review</th></tr></thead><tbody>${s.bulkOutcomes.map((row) => `<tr><td>${e(s.rows.find((contact) => contact.contactId === row.contactId)?.fields?.displayName || row.contactId)}</td><td>${e(label(row.status))}</td><td>${e(label(row.error || row.geographyStatus || ""))}</td></tr>`).join("")}</tbody></table></div>${s.bulkOutcomeCursor ? b("bulk-outcomes-more", "More results", { secondary: true }) : ""}` : ""}`;
  }
  async function loadBulkOutcomes(more = false) {
    const s = state(),
      result = await api(
        `/jobs/${id(s.bulkJob.jobId)}/outcomes${more && s.bulkOutcomeCursor ? `?cursor=${id(s.bulkOutcomeCursor)}` : ""}`,
      );
    s.bulkOutcomes = [...(more ? s.bulkOutcomes : []), ...list(result.items)];
    s.bulkOutcomeCursor = result.nextCursor;
  }
  function renderContactField(definition, contact, editable) {
    const value = contactValue(contact, definition),
      issue = contact.fieldIssues?.[definition.fieldId];
    if (issue)
      return `<div class="pt-field"><span>${e(definition.label)}</span><p>${e(displayContactValue(value))}</p><p class="pt-muted">Retained original value · needs ${e(label(issue.expectedType || definition.type))} review.</p>${editable && !definition.readOnly && simpleTypes.has(definition.type) ? `<details class="pt-workspace-details"><summary>Correct this value</summary>${editorInput(definition, null)}<label class="pt-workspace-check"><input type="checkbox" name="correct_${e(definition.fieldId)}">Replace this retained value when saving</label></details>` : ""}</div>`;
    return editable && !definition.readOnly && simpleTypes.has(definition.type)
      ? editorInput(definition, value)
      : `<div class="pt-field"><span>${e(definition.label)}</span>${value !== null && typeof value === "object" ? `<pre class="pt-contact-json">${e(JSON.stringify(value, null, 2))}</pre>` : `<p>${e(displayContactValue(value))}</p>`}</div>`;
  }

  function renderRows() {
    const s = state();
    return `${indexPreparation()}<section class="pt-card">${filterForm()}${viewTools()}<p class="pt-muted" role="status">${s.total != null ? `${count(s.total)} matching contacts` : `${count(s.rows.length)} contacts loaded${s.cursor ? " · more pages available" : ""}`}</p>${s.recentResults ? '<p class="pt-muted" role="status">Recent results. Refresh to check for updates.</p>' : ""}${b("refresh", "Refresh contacts", { secondary: true })}${selectionTools()}${s.rows.length ? rowTable(s.rows) : notice(s.cursor ? "No matches on this page" : "No matching contacts", s.cursor ? "Continue to check the remaining results." : "Try changing the filters or add contacts.")}${s.rows.length || s.pageNumber > 1 ? `<p class="pt-muted">Page ${count(s.pageNumber || 1)} · ${count(s.rows.length)} contacts on this page</p>` : ""}<div class="pt-actions">${s.previousCursors?.length ? b("previous", "Previous page", { secondary: true }) : ""}${s.pageNumber > 1 ? b("first", "First page", { secondary: true }) : ""}${s.cursor ? b("more", "Next page", { secondary: true }) : ""}</div></section>${selectionReview()}`;
  }
  function endpointControls() {
    const s = state();
    const contacts = [
      ...new Map(
        [...s.rows, ...list(s.selectedRows), ...list(s.addRows)].map(
          (contact) => [contact.contactId, contact],
        ),
      ).values(),
    ];
    const controls = contacts
      .map((contact) => {
        const phones = [
          ...new Set(
            [
              contact.fields?.phone,
              ...list(contact.fields?.phones).map((phone) =>
                typeof phone === "object" ? phone.number || phone.phone : phone,
              ),
            ].filter(Boolean),
          ),
        ];
        if (phones.length < 2) return "";
        return `<label class="pt-field"><span>Texting number for ${e(contact.fields?.displayName || "contact")}</span><select data-contact-change="${prefix}-endpoint" data-contact-id="${e(contact.contactId)}"><option value="">Use the primary eligible number</option>${phones.map((phone) => `<option value="${e(phone)}"${s.endpointChoices[contact.contactId] === phone ? " selected" : ""}>${e(phone)}</option>`).join("")}</select></label>`;
      })
      .filter(Boolean);
    return controls.length
      ? details(
          "Choose texting numbers",
          `<p class="pt-muted">Use one eligible number for each selected contact. Shared numbers receive one message.</p><div class="pt-fields">${controls.join("")}</div>`,
        )
      : "";
  }
  function editorInput(definition, value) {
    if (["json", "address", "jurisdiction"].includes(definition.type))
      return (
        textarea(
          `contact_${definition.fieldId}`,
          `${definition.label} (JSON)`,
          value == null ? "" : JSON.stringify(value, null, 2),
          false,
          65536,
        ) +
        '<p class="pt-muted">Use valid JSON to retain every nested property. Leave blank to clear this value.</p>'
      );
    if (definition.type === "boolean")
      return select(
        `contact_${definition.fieldId}`,
        definition.label,
        [
          ["", "Unknown"],
          ["true", "Yes"],
          ["false", "No"],
        ],
        value == null ? "" : String(value),
      );
    if (definition.type === "single_choice")
      return select(
        `contact_${definition.fieldId}`,
        definition.label,
        [
          ["", "Not recorded"],
          ...list(definition.options).map((option) =>
            typeof option === "object"
              ? [option.value, option.label]
              : [option, option],
          ),
        ],
        value || "",
      );
    if (definition.type === "long_text")
      return textarea(
        `contact_${definition.fieldId}`,
        definition.label,
        value || "",
        false,
        10000,
      );
    return field(
      `contact_${definition.fieldId}`,
      definition.label,
      Array.isArray(value) ? value.join(", ") : (value ?? ""),
      {
        max: 2000,
        type:
          {
            number: "number",
            date: "date",
            datetime: "datetime-local",
            email: "email",
            url: "url",
            phone: "tel",
          }[definition.type] || "text",
        extra: definition.type === "number" ? 'step="any"' : "",
      },
    );
  }
  function detail() {
    const s = state(),
      contact = s.detail?.contact || { fields: {}, tags: [] };
    const groups = new Map();
    for (const definition of fields()) {
      const group = definition.group || "Other information";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(definition);
    }
    const editable = can("edit");
    return (
      head(
        "CONTACT BOOK",
        contact.fields?.displayName ||
          contact.fields?.fullName ||
          (s.detailNew ? "Add a contact" : "Contact details"),
        "Contact details, voter information, and field history in one place.",
        b("close-detail", "Back", { secondary: true }),
      ) +
      `<section class="pt-card">${contact.sync ? notice(contact.sync.status === "needs_attention" ? "Saved · related views need attention" : contact.sync.status === "updating_related_views" ? "Saved · updating related views" : "Saved", contact.sync.status === "needs_attention" ? "An administrator can retry pending updates from Sync status." : "") : ""}${contact.eligibility ? notice(`Texting: ${label(contact.eligibility.status)}`, list(contact.eligibility.reasons).map(label).join(", ")) : ""}${contact.contactId && editable ? `<div class="pt-actions">${b("enrich", "Update districts", { secondary: true })}${b("contact-archive", contact.status === "archived" ? "Restore contact" : "Archive contact", { secondary: true })}</div>` : ""}${s.enrichmentStatus ? notice(s.enrichmentStatus) : ""}<form data-workspace-form="${formName("contact")}">${[...groups].map(([group, definitions]) => `<details class="pt-workspace-details"${["identity", "contact", "Identity", "Contact details"].includes(group) ? " open" : ""}><summary>${e(label(group))}</summary><div class="pt-fields">${definitions.map((definition) => renderContactField(definition, contact, editable)).join("")}</div></details>`).join("")}${
        editable
          ? `<div class="pt-contact-columns">${tags()
              .map(
                (tag) =>
                  `<label class="pt-workspace-check"><input name="tagId" value="${e(tag.tagId)}" type="checkbox"${contact.tags?.includes(tag.tagId) ? " checked" : ""}>${e(tag.label)}</label>`,
              )
              .join(
                "",
              )}</div><button class="pt-btn" type="submit">Save contact</button>`
          : ""
      }</form></section>${details(
        "Sources",
        list(s.detail?.sources || contact.sources)
          .map(
            (source) =>
              `<article class="pt-card"><strong>${e(source.label || source.sourceId)}</strong><pre class="pt-contact-json">${e(JSON.stringify(source, null, 2))}</pre>${can("manage") && source.sourceRecordId ? b("source-remove", "Remove source membership", { secondary: true, value: JSON.stringify({ sourceId: source.sourceId, sourceRecordId: source.sourceRecordId }) }) : ""}</article>`,
          )
          .join("") || '<p class="pt-muted">No source history recorded.</p>',
      )}${details(
        "Activity and field history",
        list(s.detail?.history)
          .map(
            (event) =>
              `<article class="pt-card"><pre class="pt-contact-json">${e(JSON.stringify(event, null, 2))}</pre></article>`,
          )
          .join("") || '<p class="pt-muted">No activity recorded.</p>',
      )}${s.detail?.historyNextCursor ? b("history-more", "More activity", { secondary: true }) : ""}${linkedActivity()}${identityControls()}`
    );
  }
  function linkedActivity() {
    const s = state();
    if (!s.detail?.contact?.contactId || !can("personal")) return "";
    return details(
      "Linked activity",
      `<p class="pt-muted">Door-knocking visits, follow-up requests, notes and campaign records reflect their current authorized state. Property history remains attached to its recorded location.</p><div class="pt-actions">${[
        ["visits", "Visits"],
        ["requests", "Follow-up requests"],
        ["notes", "Notes"],
        ["campaigns", "Campaign activity"],
        ["property", "Property history"],
      ]
        .map(([kind, title]) =>
          b("activity", title, { secondary: true, value: kind }),
        )
        .join("")}</div>${
        s.activity
          ? `<h3>${e(label(s.activity.kind))}</h3>${
              list(s.activity.items)
                .map(
                  (item) =>
                    `<pre class="pt-contact-json">${e(JSON.stringify(item, null, 2))}</pre>`,
                )
                .join("") || "<p>No linked records available.</p>"
            }${s.activity.nextCursor ? b("activity-more", "More linked records", { secondary: true, value: s.activity.kind }) : ""}`
          : ""
      }`,
    );
  }
  function mergeConflicts() {
    const s = state(),
      target = s.detail?.contact,
      source = s.mergeCandidate;
    if (!target || !source) return [];
    return fields().filter(
      (field) =>
        !field.readOnly &&
        source.fields?.[field.fieldId] != null &&
        Object.hasOwn(target.fields || {}, field.fieldId) &&
        JSON.stringify(target.fields[field.fieldId]) !==
          JSON.stringify(source.fields[field.fieldId]),
    );
  }
  function mergeChoiceControls() {
    const s = state(),
      conflicts = mergeConflicts();
    return conflicts.length
      ? `<details class="pt-workspace-details" open><summary>Review ${count(conflicts.length)} differing fields</summary>${conflicts.map((field) => `<details class="pt-workspace-details"><summary>${e(field.label)}</summary><p>Current value</p><pre class="pt-contact-json">${e(typeof s.detail.contact.fields[field.fieldId] === "object" ? JSON.stringify(s.detail.contact.fields[field.fieldId], null, 2) : String(s.detail.contact.fields[field.fieldId]))}</pre><p>Duplicate value</p><pre class="pt-contact-json">${e(typeof s.mergeCandidate.fields[field.fieldId] === "object" ? JSON.stringify(s.mergeCandidate.fields[field.fieldId], null, 2) : String(s.mergeCandidate.fields[field.fieldId]))}</pre><label class="pt-field"><span>Value for ${e(field.label)}</span><select data-contact-change="${prefix}-merge-choice" data-field-id="${e(field.fieldId)}"><option value="target"${s.mergeChoices?.[field.fieldId] !== "source" ? " selected" : ""}>Keep current value</option><option value="source"${s.mergeChoices?.[field.fieldId] === "source" ? " selected" : ""}>Use duplicate value</option></select></label></details>`).join("")}<p class="pt-muted">Recorded opt-outs remain effective after a merge.</p></details>`
      : '<p class="pt-muted">No differing populated fields need a choice.</p>';
  }
  function identityControls() {
    const s = state(),
      contact = s.detail?.contact;
    if (!can("manage") || !contact?.contactId) return "";
    return details(
      "Review duplicate contacts",
      `<form data-workspace-form="${formName("identity-search")}" class="pt-contact-save">${field("search", "Find a possible duplicate", s.identitySearch || "", { required: true })}<button type="submit" class="pt-btn pt-btn--secondary">Search</button></form>${list(
        s.identityRows,
      )
        .filter((row) => row.contactId !== contact.contactId)
        .map(
          (row) =>
            `<div class="pt-row"><span>${e(row.fields?.displayName || row.fields?.fullName || "Unnamed contact")} · ${e(row.fields?.phone || row.fields?.city || "No phone")}</span>${b("identity-choose", "Review duplicate", { value: row.contactId, secondary: true })}</div>`,
        )
        .join(
          "",
        )}${s.mergeCandidate ? `<article class="pt-card"><h3>Review this merge</h3><p>${e(contact.fields?.displayName || "This contact")} will retain its identity. Review differing values below. The selected duplicate’s sources and history will be linked to it.</p><p><strong>${e(s.mergeCandidate.fields?.displayName || "Possible duplicate")}</strong> · ${e(s.mergeCandidate.fields?.phone || "No phone")} · ${e([s.mergeCandidate.fields?.addressLine1, s.mergeCandidate.fields?.city].filter(Boolean).join(", "))}</p>${mergeChoiceControls()}${b("identity-merge", "Merge reviewed duplicate")}</article>` : ""}${s.lastMergeId ? `<p class="pt-muted">Undo is available only while neither merged record has later edits.</p>${b("identity-split", "Undo this merge", { secondary: true })}` : ""}`,
    );
  }
  function tagGroupInputs(tag = {}) {
    return (
      select(
        "groupId",
        "Tag group",
        [
          ["", "No group"],
          ...tagGroups().map((group) => [group.groupId, group.label]),
        ],
        tag.groupId || "",
      ) + field("newGroupLabel", "New group name", "", { max: 120 })
    );
  }
  function tagGroupPayload(data) {
    const newLabel = String(data.get("newGroupLabel") || "").trim();
    if (newLabel) {
      const existing = tagGroups().find(
        (group) => group.label.toLowerCase() === newLabel.toLowerCase(),
      );
      return {
        groupId: existing?.groupId || `group_${uuid()}`,
        groupLabel: existing?.label || newLabel,
      };
    }
    const group = tagGroups().find(
      (group) => group.groupId === data.get("groupId"),
    );
    return {
      groupId: group?.groupId || null,
      groupLabel: group?.label || null,
    };
  }
  function schemaPanel() {
    return (
      head(
        "CONTACT BOOK",
        "Fields and tags",
        "Keep all information available and choose what appears in your view.",
        b("panel", "Back to contacts", { value: "contacts", secondary: true }),
      ) +
      `${conversionPanel()}<div class="pt-grid pt-grid--two"><section class="pt-card"><h2>Custom fields</h2>${
        can("manage")
          ? `<form data-workspace-form="${formName("field-create")}">${field("label", "Field name", "", { required: true })}${select(
              "type",
              "Type",
              [
                ["text", "Text"],
                ["long_text", "Long text"],
                ["number", "Number"],
                ["date", "Date"],
                ["datetime", "Date and time"],
                ["boolean", "Yes / no / unknown"],
                ["single_choice", "Single choice"],
                ["multiple_choice", "Multiple choices"],
                ["phone", "Phone"],
                ["email", "Email"],
                ["url", "Link"],
                ["json", "Structured JSON"],
                ["address", "Structured address"],
                ["jurisdiction", "Structured jurisdiction"],
              ],
            )}${field("options", "Choices, separated by commas")}${field("group", "Group", "Organization fields")}<button class="pt-btn" type="submit">Create field</button></form>`
          : ""
      }${fields()
        .filter((item) => item.custom)
        .map(
          (item) =>
            `<form data-workspace-form="${formName("field-rename")}" data-field-id="${e(item.fieldId)}" class="pt-contact-save">${field("label", "Field label", item.label, { required: true })}<span class="pt-muted">${e(label(item.type))}</span>${can("manage") ? '<button class="pt-btn pt-btn--secondary" type="submit">Rename</button>' + b("field-convert", "Change type", { secondary: true, value: item.fieldId }) + b("field-archive", "Archive", { secondary: true, value: item.fieldId }) : ""}</form>`,
        )
        .join(
          "",
        )}</section><section class="pt-card"><h2>Tags</h2>${can("manage") ? `<form data-workspace-form="${formName("tag-create")}" class="pt-contact-save">${field("label", "New tag", "", { required: true })}${tagGroupInputs()}<button class="pt-btn" type="submit">Create tag</button></form>` : ""}${tags()
        .map(
          (tag) =>
            `<form data-workspace-form="${formName("tag-rename")}" data-tag-id="${e(tag.tagId)}" class="pt-contact-save">${field("label", "Tag label", tag.label, { required: true })}${can("manage") ? tagGroupInputs(tag) : ""}<small class="pt-muted">${e(tag.tagId)}</small>${can("manage") ? '<button class="pt-btn pt-btn--secondary" type="submit">Rename</button>' + b("tag-archive", "Archive", { secondary: true, value: tag.tagId }) : ""}</form>`,
        )
        .join("")}</section></div>`
    );
  }
  function conversionPanel() {
    const s = state(),
      definition = s.convertField,
      job = s.conversionJob;
    if (!definition || !can("manage")) return "";
    return `<section class="pt-card"><h2>Change ${e(definition.label)} type</h2><p class="pt-muted">Preview every existing value before applying a conversion. Original values remain in the field history.</p><form data-workspace-form="${formName("conversion")}">${select(
      "type",
      "New type",
      [
        ["text", "Text"],
        ["long_text", "Long text"],
        ["number", "Number"],
        ["date", "Date"],
        ["datetime", "Date and time"],
        ["boolean", "Yes / no / unknown"],
        ["single_choice", "Single choice"],
        ["multiple_choice", "Multiple choices"],
        ["phone", "Phone"],
        ["email", "Email"],
        ["url", "Link"],
        ["json", "Structured JSON"],
        ["address", "Structured address"],
        ["jurisdiction", "Structured jurisdiction"],
      ],
      definition.type,
    )}<button class="pt-btn pt-btn--secondary" type="submit">Preview conversion</button></form>${
      job
        ? `${
            list(job.samples).length
              ? `<div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><caption>Example conversions</caption><thead><tr><th>Original value</th><th>Converted value</th></tr></thead><tbody>${list(
                  job.samples,
                )
                  .map(
                    (sample) =>
                      `<tr><td>${e(displayContactValue(sample.before))}</td><td>${e(displayContactValue(sample.after))}</td></tr>`,
                  )
                  .join("")}</tbody></table></div>`
              : ""
          }<p role="status">${e(label(job.status))} · ${count(job.processed || 0)} checked · ${count(job.invalid || 0)} need review</p>${list(
            job.sampleErrors,
          )
            .map((error) => `<p>${e(displayContactValue(error))}</p>`)
            .join(
              "",
            )}${["previewing", "applying"].includes(job.status) ? b("conversion-advance", "Continue conversion", { secondary: true }) : ""}${job.status === "preview_ready" && !job.invalid ? b("conversion-apply", "Apply reviewed conversion") : ""}`
        : ""
    }</section>`;
  }
  function importReport() {
    const s = state();
    if (!s.importReportId) return "";
    return `<section class="pt-card"><h2>Import record report</h2><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr><th>Record</th><th>Result</th><th>Review</th></tr></thead><tbody>${list(
      s.importReportRows,
    )
      .map(
        (row) =>
          `<tr><td>${count(Number(row.row) + 1)}</td><td>${e(label(row.status))}</td><td>${e(label(row.error || ""))}${row.contactId ? b("detail", "Open contact", { secondary: true, value: row.contactId }) : ""}${can("personal") ? b("import-original", "Compare source record", { secondary: true, value: String(row.row) }) : ""}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${s.importReportCursor ? b("import-report-more", "More records", { secondary: true }) : ""}${sourceComparison()}</section>`;
  }
  function sourceComparison() {
    const s = state(),
      review = s.sourceReview;
    if (!review) return "";
    return `<h3>Original source record ${count(Number(review.original.row) + 1)}</h3><p class="pt-muted">Review original values alongside the current contact. Applying an editable value records a new correction; the source evidence stays intact.</p><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr><th>Source column</th><th>Original value</th><th>Current value</th><th>Correction</th></tr></thead><tbody>${review.original.columns
      .map((column, index) => {
        const mapped = review.job.fieldByIndex?.[String(index)],
          definition = fields().find((field) => field.fieldId === mapped);
        const original = review.original.values[index];
        const current = review.contact?.fields?.[mapped];
        const full = (value) =>
          value !== null && typeof value === "object"
            ? JSON.stringify(value, null, 2)
            : value == null
              ? "Not recorded"
              : String(value);
        return `<tr><td>${e(typeof column === "object" ? column.header || column.label || column.name : column)}</td><td><pre class="pt-contact-json">${e(full(original))}</pre></td><td><pre class="pt-contact-json">${e(full(current))}</pre></td><td>${review.contact && definition && !definition.readOnly && simpleTypes.has(definition.type) && can("edit") && index < review.original.values.length ? b("source-value-apply", `Use source value for ${definition.label}`, { secondary: true, value: String(index) }) : ""}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  }
  function importPreviewPayload() {
    const s = state(),
      draft = s.importDraft || {};
    const mapping = Object.fromEntries(
      s.filePreview.headers.map((header, index) => [
        String(index),
        draft.mapping?.[String(index)] || guessField(header),
      ]),
    );
    return {
      columns: s.filePreview.headers,
      mapping,
      rows: s.filePreview.rows.slice(0, 25),
      sourceNamespace: draft.sourceNamespace || "",
      sourcePolicy: { permittedPurpose: draft.sourcePolicy || "unreviewed" },
    };
  }
  function importMatches() {
    const preview = state().importMatchPreview;
    if (!preview) return "";
    return `<section class="pt-card"><h3>Sample match review</h3><p class="pt-muted">This review covers only ${count(preview.sampledRows)} sample records. The full import can contain additional matches and conflicts.</p><p>${count(preview.newContacts)} new · ${count(preview.matchedContacts)} matched · ${count(preview.conflicts)} conflicts · ${count(preview.missingLocations)} missing locations · ${count(preview.invalidPhones)} invalid phones</p>${
      list(preview.customFields).length
        ? `<p>New custom fields: ${list(preview.customFields)
            .map((field) => e(field.label || field.fieldId))
            .join(", ")}</p>`
        : ""
    }${list(preview.rows)
      .map(
        (row) =>
          `<details class="pt-workspace-details"><summary>Record ${count(Number(row.row) + 1)} · ${e(label(row.status))}</summary><pre class="pt-contact-json">${e(JSON.stringify(row, null, 2))}</pre></details>`,
      )
      .join("")}</section>`;
  }
  function importPanel() {
    const s = state(),
      imports = list(s.imports);
    return (
      head(
        "CONTACT BOOK",
        "Imports",
        "Uploads add to the organization’s shared contact and voter data.",
        b("panel", "Back to contacts", { value: "contacts", secondary: true }),
      ) +
      (can("import")
        ? `<section class="pt-card">${s.resumeImport ? notice(`Resume ${s.resumeImport.name}`, "Reselect the original file. Its exact columns and all previously saved records will be verified before completion.") + b("import-resume-cancel", "Start a different import", { secondary: true }) : ""}<form data-workspace-form="${formName("import-preview")}"><div class="pt-fields"><label class="pt-field"><span>Contact file</span><input type="file" accept=".csv,.tsv,.txt" data-contact-change="${prefix}-file"></label>${select(
            "delimiter",
            "File format",
            [
              [",", "CSV"],
              ["\t", "TSV"],
              ["|", "Pipe separated"],
            ],
            s.delimiter || ",",
          )}${select(
            "encoding",
            "Encoding",
            [
              ["utf-8", "UTF-8"],
              ["utf-16le", "UTF-16 LE"],
              ["windows-1252", "Windows-1252"],
            ],
            s.encoding || "utf-8",
          )}</div><button class="pt-btn pt-btn--secondary" type="submit">Preview columns</button></form>${
            s.filePreview
              ? `<form data-workspace-form="${formName("import-save")}">${s.resumeImport ? "<fieldset disabled>" : ""}<div class="pt-fields">${field("name", "Import name", s.importDraft?.name || s.importPayload?.name || s.file?.name || "", { required: true })}${field("sourceNamespace", "Source namespace", s.importDraft?.sourceNamespace || s.importPayload?.sourceNamespace || "", { required: true, extra: 'placeholder="Provider, state, and export year"' })}${select(
                  "sourcePolicy",
                  "Permitted texting use",
                  [
                    ["unreviewed", "Not reviewed"],
                    ["manual_sms", "Manual texting permitted"],
                    ["sms_with_opt_in", "Only with recorded opt-in"],
                    ["not_for_sms", "Not permitted for texting"],
                  ],
                  s.importDraft?.sourcePolicy ||
                    s.importPayload?.sourcePolicy?.permittedPurpose ||
                    "unreviewed",
                )}</div><p class="pt-muted">Up to 1,000,000 records per file. Every accepted column is retained. Unmapped columns become custom fields, including local districts. Missing phone numbers and addresses do not discard contacts.</p><div class="pt-contact-mapping">${s.filePreview.headers
                  .map((header, index) =>
                    select(
                      `column_${index}`,
                      `${index + 1}. ${header || "Unnamed column"}`,
                      [
                        ["__custom__", "Keep as custom field"],
                        ...fields()
                          .filter((item) => !item.readOnly)
                          .map((item) => [item.fieldId, item.label]),
                      ],
                      s.importDraft?.mapping?.[String(index)] ??
                        s.importPayload?.mapping?.[String(index)] ??
                        guessField(header),
                    ),
                  )
                  .join(
                    "",
                  )}</div>${s.resumeImport ? "</fieldset>" : ""}${details("Sample values", `<div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr>${s.filePreview.headers.map((header) => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${s.filePreview.rows.map((row) => `<tr>${row.map((value) => `<td>${e(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`)}${!s.resumeImport ? b("import-match-preview", "Review sample matches", { secondary: true }) + importMatches() : ""}${checkbox(`${prefix}-import-reviewed`, "I reviewed these columns and the source’s permitted use", s.importReviewed, !s.resumeImport && !s.importMatchPreview ? "disabled" : "")}<button type="submit" class="pt-btn"${!s.importReviewed || r.busy() ? " disabled" : ""}>${s.importJob ? "Resume import" : "Import contacts"}</button></form>`
              : ""
          }${s.importProgress ? notice("Import progress", `${count(s.importProgress.processed)} source rows durably saved this pass${s.importProgress.publication?.status === "updating" ? " · contact search updating" : ""}`) : ""}</section>`
        : "") +
      `${details("Replace a source", "<ol><li>Add or update contacts by importing the replacement file and reviewing its source matches.</li><li>Return to contacts, filter by the old import source, and review a frozen selection of the affected contacts.</li><li>Under More selection actions, choose the old source and remove its memberships from that selection.</li></ol><p class='pt-muted'>This replaces the selected source memberships and assertions. Contacts known through other sources, volunteer history, and the rest of the contact book remain available.</p>")}<section class="pt-card"><h2>Source history</h2>${imports.length ? imports.map((job) => `<article class="pt-row"><div><strong>${e(job.name || job.importId)}</strong><p>${e(label(job.status))} · ${count(job.accepted || 0)} accepted · ${count(job.conflicts || 0)} need review</p></div><div class="pt-actions">${job.status === "open" ? b("import-resume", "Resume", { secondary: true, value: job.importId }) : ""}${b("import-report", "Review records", { secondary: true, value: job.importId })}</div></article>`).join("") : '<p class="pt-muted">Your imports will appear here.</p>'}${s.importCursor ? b("imports-more", "More imports", { secondary: true }) : ""}</section>${importReport()}`
    );
  }
  function guessField(header) {
    const normalized = header.replace(/[\s_-]/g, "").toLowerCase();
    return (
      fields().find(
        (item) =>
          !item.readOnly &&
          [item.fieldId, item.label].some(
            (value) =>
              value.replace(/[\s_-]/g, "").toLowerCase() === normalized,
          ),
      )?.fieldId || "__custom__"
    );
  }
  function statusPanel() {
    const s = state(),
      status = s.bookStatus,
      result = s.reconcileResult,
      recovering =
        s.recoveryKind === "geography"
          ? s.geographyJob
          : s.recoveryKind === "conversion"
            ? s.conversionJob
            : null;
    return (
      head(
        "CONTACT BOOK",
        "Sync status",
        "Check contact indexes and update related map views.",
        b("panel", "Back to contacts", { value: "contacts", secondary: true }),
      ) +
      `<section class="pt-card">${status ? notice(status.pendingIndexes ? "Contact updates are being indexed" : "Contact index is up to date", `${count(status.pendingIndexes || 0)} pending contact updates · ${count(status.pendingRestrictions || 0)} pending texting restriction updates${status.schemaJob ? " · field conversion is running" : ""}`) : notice("Checking contact updates…")}${b("status-refresh", "Refresh status", { secondary: true })}${status?.schemaJob ? b("schema-recover", "Take over and finish update", { secondary: true }) : ""}${recovering ? notice("Recovered update", `${label(recovering.status)} · ${count(recovering.processed || 0)} processed`) + (["applying", "previewing"].includes(recovering.status) ? b("schema-recovery-advance", "Continue recovered update", { secondary: true }) : "") : ""}<p class="pt-muted">Review and retry related map projections in bounded batches. Existing door-knocking activity stays in its recorded history.</p>${b("reconcile", result && !result.complete ? "Continue related-view check" : "Check related views", { secondary: true })}${
        result
          ? `<p role="status">${result.phase === "restrictions" ? "Texting restrictions" : "Contacts"}: ${count(result.processed || 0)} checked in this batch · ${count(result.repaired || 0)} indexes repaired · ${count(result.mapRepaired || 0)} map records updated${result.complete ? " · Check complete" : " · More work remains"}</p>${list(
              result.failures,
            )
              .map((item) => `<p>${e(displayContactValue(item))}</p>`)
              .join("")}`
          : ""
      }</section>`
    );
  }
  function render() {
    const s = state();
    if (!s.schema)
      return notice(
        "Contact book unavailable",
        "Refresh to check contact access.",
      );
    if (!can("read"))
      return notice(
        "Contact access is restricted",
        "Your organization administrator can review your access.",
      );
    if (s.detail || s.detailNew) return detail();
    if (mode === "book" && s.panel === "status" && can("manage"))
      return statusPanel();
    if (mode === "book" && s.panel === "fields") return schemaPanel();
    if (mode === "book" && s.panel === "imports") return importPanel();
    return (
      (mode === "book"
        ? head(
            "YOUR ORGANIZATION",
            "Contacts",
            "One contact book for texting, the voter map, and door knocking.",
            can("import")
              ? b("panel", "Add contacts", { value: "imports" })
              : "",
          ) +
          `<div class="pt-actions pt-contact-navigation">${can("import") ? b("panel", "Imports", { secondary: true, value: "imports" }) : ""}${b("panel", "Fields and tags", { secondary: true, value: "fields" })}${can("manage") ? b("panel", "Sync status", { secondary: true, value: "status" }) : ""}${can("edit") ? b("new", "Add one contact", { secondary: true }) : ""}</div>`
        : '<h2>Choose campaign recipients</h2><p class="pt-muted">Filter across your contact book, then select matching contacts or individual people.</p>') +
      renderRows()
    );
  }
  function readFilters(form) {
    const s = state(),
      data = new FormData(form);
    const read = (conditions, parentPath = "") =>
      conditions.map((condition, position) => {
        const index = parentPath
          ? `${parentPath}.${position}`
          : String(position);
        if (condition.conditions) {
          const op = data.get(`group_${index}`) || condition.op;
          const children = read(condition.conditions, index);
          return op === "not"
            ? { op, conditions: [{ op: "or", conditions: children }] }
            : { op, conditions: children };
        }
        const key = data.get(`field_${index}`),
          op = data.get(`op_${index}`),
          raw =
            ["tags", "sources"].includes(key) || key.startsWith("tag_group:")
              ? data.getAll(`value_${index}`).join(",")
              : data.get(`value_${index}`) || "";
        return {
          field: key.startsWith("tag_group:") ? "tags" : key,
          op,
          value:
            op === "exists"
              ? true
              : ["any", "all", "none"].includes(op)
                ? raw
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                : contactFilterValue(
                    raw,
                    filterFields().find((item) => item.fieldId === key),
                    op,
                  ),
        };
      });
    return read(s.filters);
  }

  async function startBulk(action, extra = {}) {
    const s = state();
    if (!can("edit")) throw new Error("Contact editing is restricted.");
    if (s.selection?.status !== "ready") await prepareSelection();
    if (s.selection?.status !== "ready")
      throw new Error("Finish building the selection first.");
    s.bulkOutcomes = null;
    s.bulkUndoOperationId = null;
    s.bulkJob = (
      await api("/bulk", {
        selectionId: s.selection.selectionId,
        action,
        ...extra,
        operationId: uuid(),
      })
    ).job;
    await advanceBulk();
  }
  async function advanceBulk() {
    const s = state();
    for (
      let step = 0;
      s.bulkJob &&
      !["complete", "completed", "ready", "failed", "undone"].includes(
        s.bulkJob.status,
      ) &&
      step < 8;
      step++
    ) {
      s.bulkJob = (
        await api(`/jobs/${id(s.bulkJob.jobId)}/advance`, {
          operationId: uuid(),
        })
      ).job;
      r.changed();
    }
    await query();
  }
  async function submit(kind, form) {
    if (!kind.startsWith(`${prefix}-`)) return false;
    const s = state(),
      data = new FormData(form),
      operationId = uuid();
    const action = kind.slice(prefix.length + 1);
    if (action === "filter") {
      if (s.allMatching)
        throw new Error("Clear the selection before changing its filters.");
      s.filterMode = data.get("filterMode") || "and";
      const conditions = readFilters(form);
      s.filters = conditions.map(draftCondition);
      s.query = {
        search: String(data.get("search") || "").trim(),
        sort: { field: data.get("sort"), direction: data.get("direction") },
        filter: conditions.length
          ? s.filterMode === "not"
            ? { op: "not", conditions: [{ op: "or", conditions }] }
            : { op: s.filterMode, conditions }
          : null,
      };
      await query();
    } else if (action === "view" || action === "audience") {
      const name = String(data.get("name") || "").trim();
      const editing = action === "view" ? s.editingView : null;
      await api(
        `/${action === "view" ? "views" : "audiences"}${editing ? `/${id(editing.viewId)}` : ""}`,
        {
          name,
          visibility: data.get("visibility") || "private",
          filter: s.query.filter || null,
          search: s.query.search || "",
          ...(action === "view"
            ? {
                columns: s.columns,
                pinnedColumns: s.pinnedColumns || [],
                sort: s.query.sort,
              }
            : {}),
          ...(editing ? { expectedRevision: editing.revision } : {}),
          operationId,
        },
        editing ? "PATCH" : "POST",
      );
      s.editingView = null;
      s[action === "view" ? "views" : "audiences"] = await savedItems(
        action === "view" ? "views" : "audiences",
      );
      s[`${action}Draft`] = null;
      r.toast("Saved.");
    } else if (action === "conversion") {
      if (!can("manage") || !s.convertField)
        throw new Error("Select a custom field first.");
      s.conversionJob = (
        await api(`/fields/${id(s.convertField.fieldId)}/conversions`, {
          type: data.get("type"),
          operationId,
        })
      ).job;
      await advanceConversion();
    } else if (action === "identity-search") {
      s.identitySearch = String(data.get("search") || "").trim();
      s.identityRows = list(
        (await api("/query", { search: s.identitySearch, limit: 20 })).items,
      );
      (s.expanded ||= new Set()).add("Review duplicate contacts");
    } else if (action === "add-search") {
      s.addSearch = String(data.get("search") || "").trim();
      const result = await api("/query", { search: s.addSearch, limit: 20 });
      s.addRows = list(result.items);
      s.addCursor = result.nextCursor;
    } else if (action === "contact") {
      if (!can("edit")) throw new Error("Contact editing is restricted.");
      const contact = s.detail?.contact,
        patch = {};
      for (const definition of fields().filter(
        (item) => !item.readOnly && simpleTypes.has(item.type),
      )) {
        if (
          contact?.fieldIssues?.[definition.fieldId] &&
          !data.has(`correct_${definition.fieldId}`)
        )
          continue;
        const raw = data.get(`contact_${definition.fieldId}`);
        if (raw == null) continue;
        const value = typedContactInput(raw, definition);
        if (
          JSON.stringify(value) !==
          JSON.stringify(contact?.fields?.[definition.fieldId] ?? null)
        )
          patch[definition.fieldId] = value;
      }
      const result = await api(
        contact ? `/contacts/${id(contact.contactId)}` : "/contacts",
        {
          fields: patch,
          tags: data.getAll("tagId"),
          operationId,
          ...(contact ? { expectedRevision: contact.revision } : {}),
        },
        contact ? "PATCH" : "POST",
      );
      s.detail = { ...s.detail, contact: result.contact };
      s.detailNew = false;
      await query();
      r.toast("Contact saved.");
    } else if (action === "field-create" || action === "tag-create") {
      if (!can("manage"))
        throw new Error("Field and tag management is restricted.");
      await api(action === "field-create" ? "/fields" : "/tags", {
        label: data.get("label"),
        ...(action === "tag-create" ? tagGroupPayload(data) : {}),
        ...(action === "field-create"
          ? {
              type: data.get("type"),
              group: data.get("group"),
              options: String(data.get("options") || "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : {}),
        operationId,
      });
      await schema();
    } else if (action === "field-rename" || action === "tag-rename") {
      const tag = tags().find((item) => item.tagId === form.dataset.tagId);
      await api(
        action === "field-rename"
          ? `/fields/${id(form.dataset.fieldId)}`
          : `/tags/${id(tag.tagId)}`,
        {
          label: data.get("label"),
          ...(tag ? tagGroupPayload(data) : {}),
          ...(tag ? { expectedRevision: tag.revision } : {}),
          operationId,
        },
        "PATCH",
      );
      await schema();
    } else if (action === "bulk-source-remove") {
      if (!can("manage") || !data.get("sourceId"))
        throw new Error("Choose a source to remove.");
      if (
        !window.confirm(
          "Remove this source membership from every selected contact? Their other sources and history will be retained.",
        )
      )
        return true;
      await startBulk("source_remove", { sourceId: data.get("sourceId") });
    } else if (action === "bulk-tags") {
      if (!can("edit")) throw new Error("Tag editing is restricted.");
      if (s.selection?.status !== "ready") await prepareSelection();
      if (s.selection?.status !== "ready")
        throw new Error("Finish building and reviewing the selection first.");
      const tagId = data.get("tagId");
      s.bulkUndoOperationId = null;
      s.bulkOutcomes = null;
      s.bulkJob = (
        await api("/bulk", {
          selectionId: s.selection.selectionId,
          action: "tags",
          addTags: data.get("action") === "add" ? [tagId] : [],
          removeTags: data.get("action") === "remove" ? [tagId] : [],
          operationId,
        })
      ).job;
      await advanceBulk();
    } else if (action === "import-preview") {
      if (!can("import") || !s.file?.size)
        throw new Error("Choose a nonempty contact file.");
      s.delimiter = data.get("delimiter");
      s.encoding = data.get("encoding");
      const preview = await previewContactFile(s.file, s.delimiter, s.encoding);
      if (s.resumeImport)
        assertContactImportHeaders(preview.headers, s.resumeImport.columns);
      s.filePreview = preview;
      s.importMatchPreview = null;
      s.importReviewed = false;
    } else if (action === "import-save") {
      if (
        !can("import") ||
        !s.filePreview ||
        !s.importReviewed ||
        (!s.resumeImport && !s.importMatchPreview)
      )
        throw new Error("Review the import columns and source first.");
      const mapping = {};
      s.filePreview.headers.forEach((_, index) => {
        const mapped = data.get(`column_${index}`);
        if (mapped) mapping[String(index)] = mapped;
      });
      const payload = s.resumeImport
        ? s.importPayload
        : {
            name: data.get("name"),
            columns: s.filePreview.headers,
            mapping,
            sourceNamespace: data.get("sourceNamespace"),
            sourcePolicy: { permittedPurpose: data.get("sourcePolicy") },
          };
      if (
        s.importJob &&
        JSON.stringify(s.importPayload) !== JSON.stringify(payload)
      )
        throw new Error(
          "Resume with the original mapping and source settings. Choose the file again to start a separate import.",
        );
      s.importOperationId ||= uuid();
      if (!s.importJob) {
        s.importPayload = payload;
        s.importJob = {
          ...(
            await api("/imports", {
              ...payload,
              operationId: s.importOperationId,
            })
          ).import,
          operationId: s.importOperationId,
        };
      }
      const completed = await uploadSharedContactRows({
        file: s.file,
        delimiter: s.delimiter,
        encoding: s.encoding,
        job: s.importJob,
        api,
        guard: r.guard,
        progress: (result) => {
          s.importProgress = result;
          r.changed();
        },
      });
      s.importJob = null;
      s.resumeImport = null;
      s.importPayload = null;
      s.importOperationId = null;
      s.filePreview = null;
      s.importReviewed = false;
      await schema();
      await loadImports();
      if (completed.import?.conflicts) {
        s.importReportId = completed.import.importId;
        await loadImportReport();
        r.toast(
          `Import finished. ${completed.import.conflicts} records need review.`,
        );
      } else
        r.toast(
          completed.publication?.status === "ready"
            ? "File saved. Contact search is ready."
            : "File saved. Contact search and related views are updating.",
        );
    } else return false;
    return true;
  }
  async function advanceSchemaRecovery() {
    if (!can("manage")) throw new Error("Update recovery is restricted.");
    if (state().recoveryKind === "geography") await advanceGeography();
    else if (state().recoveryKind === "conversion") await advanceConversion();
    state().bookStatus = await api("/status");
  }
  async function advanceConversion() {
    const s = state();
    for (
      let step = 0;
      s.conversionJob &&
      ["previewing", "applying"].includes(s.conversionJob.status) &&
      step < 8;
      step++
    ) {
      s.conversionJob = (
        await api(`/conversions/${id(s.conversionJob.jobId)}/advance`, {
          operationId: uuid(),
        })
      ).job;
      r.changed();
    }
    if (s.conversionJob?.status === "complete") {
      await schema();
      r.toast("Field conversion completed.");
    }
  }
  async function loadImportReport(more = false) {
    const s = state();
    const result = await api(
      `/imports/${id(s.importReportId)}/rows${more && s.importReportCursor ? `?cursor=${id(s.importReportCursor)}` : ""}`,
    );
    s.importReportRows = [
      ...(more ? s.importReportRows : []),
      ...list(result.items),
    ];
    s.importReportCursor = result.nextCursor;
  }
  async function downloadSelection() {
    const s = state();
    if (!can("export")) throw new Error("Contact export is restricted.");
    if (s.selection?.status !== "ready") await prepareSelection();
    if (s.selection?.status !== "ready")
      throw new Error("Finish building the selection before downloading it.");
    const columns = [
      ...new Set(
        s.columns.map((key) => (key.startsWith("tag:") ? "tags" : key)),
      ),
    ];
    const job = await api("/exports", {
      selectionId: s.selection.selectionId,
      columns,
      operationId: uuid(),
    });
    const chunks = ["\uFEFF"],
      seen = new Set();
    let cursor,
      wroteHeaders = false;
    do {
      const result = await api(
        `/exports/${id(job.exportId)}/rows${cursor ? `?cursor=${id(cursor)}` : ""}`,
      );
      const names = result.columns || job.columns || columns;
      if (!wroteHeaders) {
        chunks.push(
          names
            .map((value) =>
              contactCsvCell(
                typeof value === "object"
                  ? value.label || value.fieldId
                  : fields().find((field) => field.fieldId === value)?.label ||
                      value,
              ),
            )
            .join(",") + "\r\n",
        );
        wroteHeaders = true;
      }
      for (const row of list(result.rows))
        chunks.push(
          (Array.isArray(row)
            ? row
            : names.map((key) => row[key.fieldId || key])
          )
            .map(contactCsvCell)
            .join(",") + "\r\n",
        );
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor))
        throw new Error(
          "The export stopped before completing. Refresh before trying again.",
        );
      if (cursor) seen.add(cursor);
      r.guard();
    } while (cursor);
    const url = URL.createObjectURL(
      new Blob(chunks, { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "selected-contacts.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    r.toast("Selected contacts downloaded.");
  }
  async function loadImports(more = false) {
    const s = state(),
      result = await api(
        `/imports${more && s.importCursor ? `?cursor=${id(s.importCursor)}` : ""}`,
      );
    s.imports = [...(more ? s.imports : []), ...list(result.items)];
    s.importCursor = result.nextCursor;
  }
  async function action(name, value) {
    if (!name.startsWith(`${prefix}-`)) return false;
    const s = state(),
      op = name.slice(prefix.length + 1);
    if (op === "refresh") await query({ refresh: true });
    else if (op === "index-prepare")
      await prepareIndex({ resume: s.indexJob?.status === "paused" });
    else if (op === "index-status") await prepareIndex({ refresh: true });
    else if (op === "column-earlier" || op === "column-later") {
      const from = s.columns.indexOf(value),
        to = from + (op === "column-earlier" ? -1 : 1);
      if (from >= 0 && to >= 0 && to < s.columns.length)
        [s.columns[from], s.columns[to]] = [s.columns[to], s.columns[from]];
    } else if (op === "view-edit") {
      const item = s.views.find((view) => view.viewId === value);
      if (!item || s.allMatching)
        throw new Error("Clear the selection before editing a layout.");
      applyView(item);
      s.editingView = item;
      s.viewDraft = {
        name: item.name,
        visibility: item.visibility || "private",
      };
      await query();
    } else if (op === "view-cancel-edit") {
      s.editingView = null;
      s.viewDraft = null;
    } else if (op === "view-default") {
      if (!can("manage"))
        throw new Error("Organization defaults are restricted.");
      await api("/view-default", {
        viewId: value,
        expectedRevision: s.schema.viewDefaults?.revision || 0,
        operationId: uuid(),
      });
      await schema();
    } else if (op === "view-archive") {
      const item = s.views.find((view) => view.viewId === value);
      if (!item || !window.confirm(`Archive the saved layout “${item.name}”?`))
        return true;
      await api(
        `/views/${id(value)}`,
        {
          archived: true,
          expectedRevision: item.revision,
          operationId: uuid(),
        },
        "PATCH",
      );
      s.views = await savedItems("views");
      if (s.editingView?.viewId === value) {
        s.editingView = null;
        s.viewDraft = null;
      }
      await schema();
    } else if (op === "schema-recover") {
      if (!can("manage")) throw new Error("Update recovery is restricted.");
      if (
        !window.confirm(
          "Take over the active field or district update and finish its remaining work? Completed changes and its protection against conflicting edits are retained.",
        )
      )
        return true;
      const job = (await api("/schema-job/recover", { operationId: uuid() }))
        .job;
      s.recoveryKind = job.jobId.startsWith("geo_refresh_")
        ? "geography"
        : "conversion";
      if (s.recoveryKind === "geography") s.geographyJob = job;
      else {
        s.conversionJob = job;
        s.convertField = fields().find(
          (field) => field.fieldId === job.fieldId,
        );
      }
      await advanceSchemaRecovery();
    } else if (op === "schema-recovery-advance") await advanceSchemaRecovery();
    else if (op === "status-refresh") s.bookStatus = await api("/status");
    else if (op === "reconcile") {
      if (!can("manage")) throw new Error("Related-view review is restricted.");
      const phase = s.reconcileResult?.complete
        ? "contacts"
        : s.reconcileResult?.nextPhase || "contacts";
      const result = await api("/reconcile", {
        phase,
        cursor: s.reconcileResult?.complete
          ? null
          : s.reconcileResult?.nextCursor || null,
        operationId: uuid(),
      });
      s.reconcileResult = {
        ...result,
        phase,
        nextPhase:
          phase === "contacts" && result.complete ? "restrictions" : phase,
        complete: phase === "restrictions" && result.complete,
      };
      s.bookStatus = await api("/status");
    } else if (op === "geography-start") {
      if (!can("manage"))
        throw new Error("District refresh review is restricted.");
      if (s.selection?.status !== "ready") await prepareSelection();
      if (s.selection?.status !== "ready")
        throw new Error("Finish building the selection first.");
      s.geographyJob = (
        await api("/geography-refresh", {
          selectionId: s.selection.selectionId,
          operationId: uuid(),
        })
      ).job;
      s.geographyOutcomes = [];
      s.geographyAffected = {};
      await advanceGeography();
    } else if (op === "geography-advance") await advanceGeography();
    else if (op === "geography-outcomes") await geographyOutcomes();
    else if (op === "geography-outcomes-more") await geographyOutcomes(true);
    else if (op === "geography-affected-more")
      await geographyAffected(value, true);
    else if (op === "geography-apply") {
      if (!can("manage") || s.geographyJob?.status !== "preview_ready")
        throw new Error("Finish reviewing district changes first.");
      s.geographyJob = (
        await api(`/geography-refresh/${id(s.geographyJob.jobId)}/apply`, {
          operationId: uuid(),
        })
      ).job;
      await advanceGeography();
    } else if (op === "bulk-outcomes") await loadBulkOutcomes();
    else if (op === "bulk-outcomes-more") await loadBulkOutcomes(true);
    else if (op === "bulk-undo") {
      if (
        !window.confirm(
          "Undo this tag update? Contacts changed since the update will be held for review.",
        )
      )
        return true;
      s.bulkUndoOperationId ||= uuid();
      s.bulkJob = (
        await api(`/jobs/${id(s.bulkJob.jobId)}/undo`, {
          operationId: s.bulkUndoOperationId,
        })
      ).job;
      await advanceBulk();
      await loadBulkOutcomes();
    } else if (op === "source-remove") {
      if (
        !can("manage") ||
        !window.confirm(
          "Remove this source membership and retract its field assertions from this contact? The source evidence remains in history.",
        )
      )
        return true;
      const source = JSON.parse(value),
        contact = s.detail.contact;
      await api(`/contacts/${id(contact.contactId)}/sources/remove`, {
        ...source,
        expectedRevision: contact.revision,
        operationId: uuid(),
      });
      s.detail = await api(`/contacts/${id(contact.contactId)}`);
      r.toast("Source membership removed.");
    } else if (op === "export") await downloadSelection();
    else if (op === "more") await query({ more: true });
    else if (op === "previous") await query({ previous: true });
    else if (op === "first") await query();
    else if (op === "field-convert") {
      s.convertField = fields().find((field) => field.fieldId === value);
      s.conversionJob = null;
    } else if (op === "conversion-advance") await advanceConversion();
    else if (op === "conversion-apply") {
      if (
        s.conversionJob?.status !== "preview_ready" ||
        s.conversionJob.invalid
      )
        throw new Error("Resolve conversion errors before applying it.");
      s.conversionJob = (
        await api(`/conversions/${id(s.conversionJob.jobId)}/apply`, {
          operationId: uuid(),
        })
      ).job;
      await advanceConversion();
    } else if (op === "import-resume") {
      const job = (await api(`/imports/${id(value)}`)).import;
      if (job.status !== "open")
        throw new Error(
          "This import is already closed. Open its record report instead.",
        );
      s.resumeImport = job;
      s.importJob = { ...job, operationId: `resume:${job.importId}` };
      s.importPayload = {
        name: job.name,
        columns: job.columns,
        mapping: job.fieldByIndex,
        sourceNamespace: job.sourceNamespace,
        sourcePolicy: job.sourcePolicy,
      };
      s.file = null;
      s.filePreview = null;
      s.importDraft = null;
      s.importReviewed = false;
      s.importProgress = null;
    } else if (op === "import-resume-cancel") {
      s.resumeImport = null;
      s.importJob = null;
      s.importPayload = null;
      s.importOperationId = null;
      s.file = null;
      s.filePreview = null;
      s.importDraft = null;
      s.importReviewed = false;
    } else if (op === "import-match-preview") {
      if (!can("import") || !s.filePreview || s.resumeImport)
        throw new Error("Preview a new contact file first.");
      const payload = boundedContactImportPreview(importPreviewPayload());
      if (!payload.sourceNamespace.trim())
        throw new Error("Enter a source namespace before reviewing matches.");
      s.importMatchPreview = (await api("/import-preview", payload)).preview;
      s.importReviewed = false;
    } else if (op === "import-original") {
      if (!can("personal")) throw new Error("Source evidence is restricted.");
      const original = await api(
        `/imports/${id(s.importReportId)}/rows/${id(value)}/original`,
      );
      const job = (await api(`/imports/${id(s.importReportId)}`)).import;
      const record = list(s.importReportRows).find(
        (row) => String(row.row) === value,
      );
      const contact = record?.contactId
        ? (await api(`/contacts/${id(record.contactId)}`)).contact
        : null;
      s.sourceReview = { original, job, contact };
    } else if (op === "source-value-apply") {
      const review = s.sourceReview,
        index = Number(value);
      const definition = fields().find(
        (field) => field.fieldId === review?.job.fieldByIndex?.[String(index)],
      );
      if (
        !can("edit") ||
        !review?.contact ||
        !definition ||
        definition.readOnly
      )
        throw new Error("This source value cannot be applied directly.");
      const raw = review.original.values[index];
      const valueToApply = typedContactInput(
        typeof raw === "object" && raw !== null
          ? JSON.stringify(raw)
          : String(raw ?? ""),
        definition,
      );
      if (
        !window.confirm(
          `Replace the current ${definition.label} with the reviewed source value?`,
        )
      )
        return true;
      review.contact = (
        await api(
          `/contacts/${id(review.contact.contactId)}`,
          {
            fields: { [definition.fieldId]: valueToApply },
            expectedRevision: review.contact.revision,
            operationId: uuid(),
          },
          "PATCH",
        )
      ).contact;
      r.toast("Reviewed source correction saved.");
    } else if (op === "import-report") {
      s.sourceReview = null;
      s.importReportId = value;
      await loadImportReport();
    } else if (op === "import-report-more") await loadImportReport(true);
    else if (op === "panel") {
      s.panel = value;
      if (value === "imports") await loadImports();
      if (value === "status" && can("manage"))
        s.bookStatus = await api("/status");
      if (value === "contacts") await query();
    } else if (op === "imports-more") await loadImports(true);
    else if (op === "activity" || op === "activity-more") {
      const result = await api(
        `/contacts/${id(s.detail.contact.contactId)}/activity?kind=${id(value)}${op === "activity-more" && s.activity?.nextCursor ? `&cursor=${id(s.activity.nextCursor)}` : ""}`,
      );
      s.activity = {
        ...result,
        items: [
          ...(op === "activity-more" ? list(s.activity?.items) : []),
          ...list(result.items),
        ],
      };
      (s.expanded ||= new Set()).add("Linked activity");
    } else if (op === "detail") {
      s.activity = null;
      s.detail = await api(`/contacts/${id(value)}`);
      s.enrichmentStatus = null;
      s.detailNew = false;
    } else if (op === "identity-choose") {
      s.mergeCandidate = (await api(`/contacts/${id(value)}`)).contact;
      s.mergeChoices = {};
      (s.expanded ||= new Set()).add("Review duplicate contacts");
    } else if (op === "identity-merge") {
      const target = s.detail.contact,
        source = s.mergeCandidate;
      if (!can("manage") || !source || target.contactId === source.contactId)
        throw new Error("Review a separate duplicate contact first.");
      const result = await api("/identities/merge", {
        targetId: target.contactId,
        sourceIds: [source.contactId],
        fieldChoices: Object.fromEntries(
          mergeConflicts().map((field) => [
            field.fieldId,
            s.mergeChoices?.[field.fieldId] === "source"
              ? source.fields[field.fieldId]
              : target.fields[field.fieldId],
          ]),
        ),
        expectedRevisions: {
          [target.contactId]: target.revision,
          [source.contactId]: source.revision,
        },
        operationId: uuid(),
      });
      s.lastMergeId = result.mergeId || result.merge?.mergeId;
      s.mergeCandidate = null;
      s.identityRows = [];
      s.detail = await api(`/contacts/${id(target.contactId)}`);
      await query();
      r.toast("Reviewed duplicate merged.");
    } else if (op === "identity-split") {
      if (!can("manage") || !s.lastMergeId)
        throw new Error("This merge is not available to undo.");
      await api("/identities/split", {
        mergeId: s.lastMergeId,
        operationId: uuid(),
      });
      s.lastMergeId = null;
      s.detail = await api(`/contacts/${id(s.detail.contact.contactId)}`);
      await query();
      r.toast("Merge undone.");
    } else if (op === "enrich") {
      const result = await api(
        `/contacts/${id(s.detail.contact.contactId)}/enrich`,
        { operationId: uuid() },
      );
      s.detail.contact = result.contact;
      s.enrichmentStatus =
        {
          matched: "Districts updated using available local boundaries.",
          boundary_review_required:
            "A district boundary needs review before an assignment can be confirmed.",
          local_address_coverage_unavailable:
            "Local address coverage is unavailable. Existing imported districts are retained.",
          address_review_required:
            "Review the residential address before updating districts.",
        }[result.status] || "District review is pending.";
      await query();
    } else if (op === "contact-archive") {
      const contact = s.detail.contact;
      const result = await api(
        `/contacts/${id(contact.contactId)}`,
        {
          expectedRevision: contact.revision,
          status: contact.status === "archived" ? "active" : "archived",
          operationId: uuid(),
        },
        "PATCH",
      );
      s.detail.contact = result.contact;
      await query();
    } else if (op === "history-more") {
      const result = await api(
        `/contacts/${id(s.detail.contact.contactId)}/history?cursor=${id(s.detail.historyNextCursor)}`,
      );
      s.detail.history.push(...list(result.items));
      s.detail.historyNextCursor = result.nextCursor;
    } else if (op === "field-archive") {
      await api(
        `/fields/${id(value)}`,
        { archived: true, operationId: uuid() },
        "PATCH",
      );
      await schema();
    } else if (op === "tag-archive") {
      const tag = tags().find((tag) => tag.tagId === value);
      await api(
        `/tags/${id(value)}`,
        { archived: true, expectedRevision: tag.revision, operationId: uuid() },
        "PATCH",
      );
      await schema();
    } else if (op === "new") {
      s.detailNew = true;
      s.detail = null;
    } else if (op === "close-detail") {
      s.detail = null;
      s.detailNew = false;
    } else if (op === "filter-add") {
      (s.expanded ||= new Set()).add("Filter contacts");
      filterChildren(value).push({ field: "state", op: "eq", value: "" });
    } else if (op === "filter-group-add") {
      (s.expanded ||= new Set()).add("Filter contacts");
      filterChildren(value).push({
        op: "or",
        conditions: [{ field: "state", op: "eq", value: "" }],
      });
    } else if (op === "filter-remove") {
      const parts = String(value).split(".");
      const index = Number(parts.pop());
      filterChildren(parts.join(".")).splice(index, 1);
    } else if (op === "filter-clear") {
      s.filters = [];
      s.query.filter = null;
      s.query.search = "";
      await query();
    } else if (op === "select-page") {
      for (const row of s.rows) {
        s.includeIds.add(row.contactId);
        s.excludeIds.delete(row.contactId);
      }
      invalidateSelection();
    } else if (op === "select-all") {
      s.allMatching = true;
      s.selectionQuery = structuredClone(s.query);
      s.selectionRevision = s.bookRevision;
      s.excludeIds.clear();
      invalidateSelection();
    } else if (op === "select-clear") {
      s.allMatching = false;
      s.selectionQuery = null;
      s.selectionRevision = null;
      s.includeIds.clear();
      s.excludeIds.clear();
      s.addRows = [];
      invalidateSelection();
    } else if (op === "selection-review") await prepareSelection();
    else if (op === "selection-advance") {
      await advanceSelection();
      if (s.selection?.status === "ready") await loadSelected();
    } else if (op === "selected-more") await loadSelected(true);
    else if (op === "selected-first") await loadSelected();
    else if (op === "bulk-advance") await advanceBulk();
    else if (op === "add-more") {
      const result = await api("/query", {
        search: s.addSearch,
        limit: 20,
        cursor: s.addCursor,
      });
      s.addRows = list(result.items);
      s.addCursor = result.nextCursor;
    } else if (op === "view-load" || op === "audience-load") {
      if (s.allMatching)
        throw new Error("Clear the selection before changing its filters.");
      const item = list(op === "view-load" ? s.views : s.audiences).find(
        (item) => (item.viewId || item.audienceId || item.id) === value,
      );
      if (!item) throw new Error("The saved view is no longer available.");
      applyView(item);
      await query();
    } else if (op === "tag-cell") {
      const change = s.pendingTag;
      if (!change || !can("edit")) return true;
      const contact = s.rows.find((row) => row.contactId === change.contactId);
      if (!contact) return true;
      const tags = new Set(contact.tags || []);
      if (change.checked) tags.add(change.tagId);
      else tags.delete(change.tagId);
      await api(
        `/contacts/${id(contact.contactId)}`,
        {
          tags: [...tags],
          expectedRevision: contact.revision,
          operationId: uuid(),
        },
        "PATCH",
      );
      s.pendingTag = null;
      await query();
    } else return false;
    return true;
  }
  function change(target) {
    const name = target.dataset.contactChange,
      s = state();
    for (const kind of ["view", "audience"]) {
      const form = target.closest?.(
        `[data-workspace-form="${formName(kind)}"]`,
      );
      if (form) {
        const data = new FormData(form);
        s[`${kind}Draft`] = {
          name: data.get("name"),
          visibility: data.get("visibility"),
        };
      }
    }
    if (name === `${prefix}-merge-choice`) {
      (s.mergeChoices ||= {})[target.dataset.fieldId] = target.value;
      return false;
    }
    if (name === `${prefix}-disclosure`) {
      s.expanded ||= new Set();
      if (target.open) s.expanded.add(target.dataset.disclosure);
      else s.expanded.delete(target.dataset.disclosure);
      return false;
    }
    const importForm = target.closest?.(
      `[data-workspace-form="${formName("import-save")}"]`,
    );
    if (importForm) {
      const data = new FormData(importForm),
        mapping = {};
      s.filePreview?.headers.forEach((_, index) => {
        mapping[String(index)] = data.get(`column_${index}`) || "";
      });
      s.importDraft = {
        name: data.get("name"),
        sourceNamespace: data.get("sourceNamespace"),
        sourcePolicy: data.get("sourcePolicy"),
        mapping,
      };
      if (target.name) {
        s.importReviewed = false;
        s.importMatchPreview = null;
      }
    }
    if (name === `${prefix}-row`) {
      const contactId = target.dataset.contactId;
      if (target.checked) {
        s.includeIds.add(contactId);
        s.excludeIds.delete(contactId);
      } else {
        s.includeIds.delete(contactId);
        if (s.allMatching) s.excludeIds.add(contactId);
      }
      invalidateSelection();
      return true;
    }
    if (name === `${prefix}-column-pin`) {
      s.pinnedColumns ||= [];
      if (target.checked && !s.pinnedColumns.includes(target.value))
        s.pinnedColumns.push(target.value);
      else if (!target.checked)
        s.pinnedColumns = s.pinnedColumns.filter((key) => key !== target.value);
      return true;
    }
    if (name === `${prefix}-column`) {
      if (target.checked) s.columns.push(target.value);
      else {
        s.columns = s.columns.filter((key) => key !== target.value);
        s.pinnedColumns = (s.pinnedColumns || []).filter(
          (key) => key !== target.value,
        );
      }
      return true;
    }
    if (name === `${prefix}-endpoint`) {
      if (target.value)
        s.endpointChoices[target.dataset.contactId] = target.value;
      else delete s.endpointChoices[target.dataset.contactId];
      invalidateSelection();
      return true;
    }
    if (name === `${prefix}-reviewed`) {
      s.reviewed = target.checked;
      return true;
    }
    if (name === `${prefix}-file`) {
      if (!target.files?.[0]) return false;
      s.file = target.files?.[0];
      s.filePreview = null;
      s.importMatchPreview = null;
      if (!s.resumeImport) {
        s.importJob = null;
        s.importPayload = null;
        s.importOperationId = null;
      }
      s.importDraft = null;
      s.importReviewed = false;
      return false;
    }
    if (name === `${prefix}-import-reviewed`) {
      s.importReviewed = target.checked;
      return true;
    }
    if (name === `${prefix}-tag-cell`) {
      s.pendingTag = {
        contactId: target.dataset.contactId,
        tagId: target.dataset.tagId,
        checked: target.checked,
      };
      return false;
    }
    const form = target.closest?.(
      `[data-workspace-form="${formName("filter")}"]`,
    );
    if (form && target.name?.startsWith("field_")) {
      const condition = filterNode(target.name.slice(6));
      condition.field = target.value;
      condition.value = target.value.startsWith("tag_group:")
        ? tagGroups()
            .find((group) => group.fieldId === target.value)
            ?.memberTags.map((tag) => tag.tagId)
            .join(", ") || ""
        : "";
      condition.op =
        ["tags", "sources"].includes(target.value) ||
        target.value.startsWith("tag_group:")
          ? "any"
          : "eq";
      (s.expanded ||= new Set()).add("Filter contacts");
      return true;
    }
    if (form && target.name?.startsWith("group_"))
      filterNode(target.name.slice(6)).op = target.value;
    if (form && target.name === "filterMode") s.filterMode = target.value;
    if (form && target.name?.startsWith("op_")) {
      filterNode(target.name.slice(3)).op = target.value;
    }
    if (form && target.name?.startsWith("value_")) {
      filterNode(target.name.slice(6)).value = target.multiple
        ? [...target.selectedOptions].map((option) => option.value).join(", ")
        : target.value;
    }
    return false;
  }
  return {
    dispose,
    load,
    render,
    submit,
    action,
    change,
    bindCampaign,
    selection: () => state().selection,
    hasSelection: () =>
      !!state().selection || state().allMatching || state().includeIds.size > 0,
  };
}
