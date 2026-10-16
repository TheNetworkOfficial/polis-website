import {
  escapeText as e,
  button,
  field,
  select,
  notice,
  count,
  id,
  uuid,
} from "./textingWorkspaceUi";
import {
  ballotStatusLabels,
  ballotReportDate,
  ballotViews,
} from "./ballotChaserModel";
import {
  displayContactValue,
  contactFilterValue,
} from "./organizationContactsModel";

const operators = [
  ["eq", "is"],
  ["neq", "is not"],
  ["contains", "contains"],
  ["in", "is any of"],
  ["any", "has any"],
  ["all", "has all"],
  ["none", "has none"],
  ["exists", "is recorded"],
  ["not_exists", "is not recorded"],
  ["gt", "greater than"],
  ["gte", "at least"],
  ["lt", "less than"],
  ["lte", "at most"],
];
const staleCodes = new Set([
  "ballot_snapshot_changed",
  "ballot_publication_pending",
  "ballot_cursor_stale",
  "contact_cursor_query_changed",
  "contact_selection_access_changed",
  "contact_book_changed",
]);

/** Register selection never substitutes a voter reference for a Contact Book ID. */
export function ballotRegisterSelection(state) {
  return state.allMatching
    ? { mode: "all_matching", excludeVoterRefs: [...state.excluded] }
    : { mode: "explicit", includeVoterRefs: [...state.included] };
}

export function ballotRegisterValue(row, key) {
  const ballot = row.ballotState || {};
  const virtual = {
    ballotVoterId: row.voterId,
    ballotStatus: ballotStatusLabels[ballot.status] || "Unknown",
    ballotReturnedAt: ballot.returnedAt,
    ballotSourceAsOf: ballot.sourceAsOf,
  };
  return Object.hasOwn(virtual, key) ? virtual[key] : row.fields?.[key];
}

/** A separate register keeps browsing and exports free of contact mutations. */
export function createBallotRegister({
  request,
  guard,
  base,
  electionId,
  snapshotId,
  chaseView,
  dates = {},
  schema,
  busy,
  changed,
  beginExport,
  beginCampaign,
  canCampaign = () => false,
  invalidateExport = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let generation = 0,
    disposed = false,
    contactTimer,
    contactFlight = null;
  const state = {
    rows: [],
    fields: [],
    query: {},
    included: new Set(),
    excluded: new Set(),
    allMatching: false,
    cursors: [null],
    page: 0,
    pageSize: 50,
    filters: [],
    columns: ["displayName", "precinct", "city"],
  };
  const current = (version = generation) => {
    guard();
    if (disposed || version !== generation)
      throw new Error("This ballot list is no longer open.");
  };
  const can = (name) => schema?.capabilities?.[name] === true;
  const endpoint = `${base}/elections/${id(electionId)}`;
  const b = (action, text, options = {}) =>
    button(`register-${action}`, text, {
      ...options,
      disabled: busy() || state.loading || options.disabled,
    });
  const selected = (row) =>
    state.included.has(row.voterRef) ||
    (state.allMatching && !state.excluded.has(row.voterRef));
  const clearSelection = () => {
    state.included.clear();
    state.excluded.clear();
    state.allMatching = false;
  };
  function fail(error) {
    const code = error?.payload?.error || error?.code;
    if (staleCodes.has(code)) {
      invalidateExport();
      cancel(contactTimer);
      state.stale = true;
      state.rows = [];
      state.detail = null;
      clearSelection();
      state.error =
        "This ballot list changed. Refresh Ballot Chaser and choose your list again.";
    } else if ([401, 403].includes(error?.status || error?.statusCode)) {
      invalidateExport();
      cancel(contactTimer);
      state.rows = [];
      state.detail = null;
      state.materializationIntent = null;
      state.materialization = null;
      clearSelection();
      state.denied = true;
      state.error = "Access changed. Reopen Ballot Chaser.";
    } else state.error = error.message || "This list paused. Try again.";
  }
  async function call(suffix, body, version) {
    current(version);
    const result = await request(`${endpoint}${suffix}`, {
      auth: true,
      method: "POST",
      body,
      beforeRequest: () => current(version),
    });
    current(version);
    if (result?.ok !== true)
      throw new Error("The ballot list response could not be confirmed.");
    return result;
  }
  async function load({ first = false } = {}) {
    if (disposed || state.loading || state.stale || state.denied) return;
    current();
    if (first) {
      state.cursors = [null];
      state.page = 0;
      clearSelection();
      state.detail = null;
      invalidateExport();
    }
    const version = ++generation;
    state.loading = true;
    state.error = "";
    changed();
    try {
      const result = await call(
        "/voters",
        {
          ...state.query,
          snapshotId,
          view: chaseView,
          limit: state.pageSize,
          ...(state.cursors[state.page]
            ? { cursor: state.cursors[state.page] }
            : {}),
        },
        version,
      );
      if (
        result.storageMode !== "register" ||
        result.ballotChase?.electionId !== electionId ||
        result.ballotChase?.snapshotId !== snapshotId ||
        result.ballotChase?.view !== chaseView ||
        !Number.isSafeInteger(result.total) ||
        result.total < 0 ||
        !Array.isArray(result.schema) ||
        !Array.isArray(result.items) ||
        result.items.some((row) => !row?.voterRef) ||
        new Set(result.items.map((row) => row.voterRef)).size !==
          result.items.length ||
        (result.ballotChase?.snapshotId &&
          result.ballotChase.snapshotId !== snapshotId) ||
        (result.snapshotId && result.snapshotId !== snapshotId)
      )
        throw Object.assign(
          new Error("Refresh the ballot list before continuing."),
          { code: "ballot_snapshot_changed" },
        );
      const allowed = new Set(
        result.schema.map((definition) => definition.fieldId),
      );
      state.rows = result.items.map((row) => ({
        ...row,
        fields: Object.fromEntries(
          Object.entries(row.fields || {}).filter(([key]) => allowed.has(key)),
        ),
      }));
      state.nextCursor = result.nextCursor || null;
      state.total = result.total;
      if (Array.isArray(result.schema)) state.fields = result.schema;
      state.query.sort ||= {
        field: ["displayName", "ballotVoterId", "ballotStatus"].find((key) =>
          state.fields.some((definition) => definition.fieldId === key),
        ),
        direction: "asc",
      };
      state.loaded = true;
    } catch (error) {
      if (!disposed && version === generation) {
        try {
          current(version);
          fail(error);
        } catch {
          dispose();
        }
      }
    } finally {
      if (!disposed && version === generation) {
        state.loading = false;
        changed();
      }
    }
  }
  function dispose() {
    disposed = true;
    generation++;
    cancel(contactTimer);
    state.rows = [];
    state.detail = null;
    state.materializationIntent = null;
    state.materialization = null;
    clearSelection();
  }
  function definitions() {
    return state.fields.filter((definition) => !definition.archived);
  }
  function filterChildren(path = "") {
    if (!path) return state.filters;
    let node;
    let children = state.filters;
    for (const part of path.split(".")) {
      node = children[Number(part)];
      children = node?.conditions;
    }
    if (!Array.isArray(children)) throw new Error("Reopen these filters.");
    return children;
  }
  function filterRow(condition, index) {
    if (condition.conditions)
      return `<fieldset class="pt-contact-filter-group"><legend>Condition group</legend>${select(
        `group_${index}`,
        "Group match",
        [
          ["and", "All conditions"],
          ["or", "Any condition"],
          ["not", "None of these conditions"],
        ],
        condition.op,
      )}${condition.conditions.map((child, number) => filterRow(child, `${index}.${number}`)).join("")}<div class="pt-actions">${b("filter-add", "Add condition", { secondary: true, value: String(index) })}${String(index).split(".").length < 3 ? b("filter-group-add", "Add group", { secondary: true, value: String(index) }) : ""}${b("filter-remove", "Remove group", { secondary: true, value: String(index) })}</div></fieldset>`;
    const definition = definitions().find(
      (item) => item.fieldId === condition.field,
    );
    const input = ["boolean", "tri_state"].includes(definition?.type)
      ? select(
          `value_${index}`,
          definition.label,
          [
            ["", "Choose"],
            ["true", "Yes"],
            ["false", "No"],
          ],
          String(condition.value ?? ""),
        )
      : field(
          `value_${index}`,
          definition?.label || "Value",
          condition.value ?? "",
          { max: 1000 },
        );
    return `<div class="bc-register-filter">${select(
      `field_${index}`,
      "Field",
      [
        ["", "Choose a field"],
        ...definitions()
          .filter((item) => item.filterable !== false)
          .map((item) => [item.fieldId, item.label]),
      ],
      condition.field || "",
    )}${select(`operator_${index}`, "Condition", operators, condition.op || "eq")}${input}${b("filter-remove", "Remove condition", { secondary: true, value: String(index) })}</div>`;
  }
  function readFilters(nodes, data, parent = "", typed = false) {
    if (nodes.length > 20 || parent.split(".").length > 4)
      throw new Error("Use fewer filter conditions.");
    return nodes.map((condition, index) => {
      const path = parent ? `${parent}.${index}` : String(index);
      if (condition.conditions) {
        const op = data.get(`group_${path}`);
        if (!["and", "or", "not"].includes(op))
          throw new Error("Choose how to match this group.");
        const children = readFilters(condition.conditions, data, path, typed);
        if (typed && !children.length)
          throw new Error("Add a condition to each group.");
        return {
          op,
          conditions:
            typed && op === "not"
              ? [{ op: "or", conditions: children }]
              : children,
        };
      }
      const key = data.get(`field_${path}`),
        op = data.get(`operator_${path}`),
        value = data.get(`value_${path}`) || "";
      if (!typed) return { field: key, op, value };
      const definition = definitions().find(
        (item) => item.fieldId === key && item.filterable !== false,
      );
      if (!definition || !operators.some(([operator]) => operator === op))
        throw new Error("Choose a field and condition for each filter.");
      return {
        field: key,
        op: op === "not_exists" ? "exists" : op,
        value: ["exists", "not_exists"].includes(op)
          ? op === "exists"
          : contactFilterValue(
              value,
              definition,
              ["any", "all", "none"].includes(op) ? "in" : op,
            ),
      };
    });
  }
  function filters() {
    return `<details class="pt-workspace-details"${state.filtersOpen ? " open" : ""} data-register-disclosure="filters"><summary>Filters${state.filters.length ? ` · ${state.filters.length}` : ""}</summary><form data-register-form="filters"><div class="pt-fields">${select(
      "filterLogic",
      "Match",
      [
        ["and", "All conditions"],
        ["or", "Any condition"],
      ],
      state.filterLogic || "and",
    )}</div>${state.filters.map(filterRow).join("")}<div class="pt-actions">${b("filter-add", "Add condition", { secondary: true })}${b("filter-group-add", "Add group", { secondary: true })}<button class="pt-btn" type="submit"${state.loading || busy() ? " disabled" : ""}>Apply filters</button>${b("filter-clear", "Clear filters", { secondary: true })}</div></form></details>`;
  }
  function rowTable() {
    const columns = state.columns
      .map((key) => definitions().find((item) => item.fieldId === key))
      .filter(Boolean);
    return `<div class="pt-workspace-table-wrap"><table class="pt-workspace-table bc-register-table"><thead><tr><th scope="col"><span class="pt-cb-visually-hidden">Select</span></th><th scope="col">Voter</th><th scope="col">Ballot status</th>${columns
      .filter((item) => item.fieldId !== "displayName")
      .map((item) => `<th scope="col">${e(item.label)}</th>`)
      .join("")}</tr></thead><tbody>${state.rows
      .map((row) => {
        const name = row.fields?.displayName || row.fields?.fullName || "Voter";
        return `<tr><td><label class="pt-cb-check-hit"><input type="checkbox" data-register-row="${e(row.voterRef)}" aria-label="Select ${e(name)}"${selected(row) ? " checked" : ""}${state.loading || busy() || state.materializationIntent || ["queued", "running"].includes(state.materialization?.status) ? " disabled" : ""}></label></td><td><strong>${e(name)}</strong>${row.contactId ? '<small class="bc-register-link-state">In Contact Book</small>' : ""}${b("source", "County details", { value: row.voterRef, secondary: true })}</td><td>${e(ballotStatusLabels[row.ballotState?.status] || "Unknown")}</td>${columns
          .filter((item) => item.fieldId !== "displayName")
          .map(
            (item) =>
              `<td data-label="${e(item.label)}">${e(displayContactValue(ballotRegisterValue(row, item.fieldId)))}</td>`,
          )
          .join("")}</tr>`;
      })
      .join("")}</tbody></table></div>`;
  }
  function contactPanel() {
    const job = state.materialization;
    if (!job && !state.materializationIntent) return "";
    const title =
      job?.status === "complete"
        ? "Contact Book updated"
        : job?.status === "needs_review" || job?.status === "failed"
          ? "Contact Book request needs review"
          : job
            ? "Adding selected voters"
            : "Check your Contact Book request";
    return `<section aria-label="Contact Book request">${notice(title, job ? `${count(job.processed)} of ${count(job.total)} processed · ${count(job.added)} added · ${count(job.linked)} linked${job.reviewRequired ? ` · ${count(job.reviewRequired)} need review` : ""}` : "The response was interrupted. Check this same request before starting another.")}${job && ["queued", "running"].includes(job.status) ? '<progress aria-label="Adding selected voters"></progress>' : ""}${state.contactError ? notice("Progress paused", state.contactError) : ""}${job ? b("contacts-refresh", "Check Contact Book progress", { secondary: true }) : b("contacts", "Check this request", { secondary: true })}</section>`;
  }
  function render() {
    if (disposed) return "";
    const selectedCount = state.allMatching
      ? Number.isSafeInteger(state.total)
        ? Math.max(0, state.total - state.excluded.size)
        : null
      : state.included.size;
    const details = state.detail;
    const contactPending =
      !!state.materializationIntent ||
      ["queued", "running"].includes(state.materialization?.status);
    const sortChoices = definitions()
      .filter((item) => item.sortable !== false)
      .flatMap((item) => [
        [`${item.fieldId}:asc`, `${item.label} · A to Z`],
        [`${item.fieldId}:desc`, `${item.label} · Z to A`],
      ]);
    return `<section class="pt-card bc-register" aria-label="County voter list" aria-busy="${state.loading}">
      <header class="pt-cb-heading"><div><h2>${e(ballotViews[chaseView])}</h2><p>${dates.sourceAsOf ? e(ballotReportDate(dates.sourceAsOf)) : "Published county report"}${dates.previousSourceAsOf ? ` · Compared with ${e(ballotReportDate(dates.previousSourceAsOf))}` : ""}</p></div><strong>${count(state.total)} voters</strong></header>
      <p class="pt-cb-hint">County voters stay in this ballot list. Add selected people to Contact Book when needed.</p>
      ${state.error ? notice(state.stale ? "Refresh this list" : "List paused", state.error) : ""}
      ${state.stale ? button("ballot-refresh-list", "Refresh ballot list", { disabled: busy() }) : ""}
      ${
        state.stale || state.denied
          ? ""
          : `
        <form class="bc-register-search" data-register-form="search">${field("search", "Search voters", state.searchDraft ?? state.query.search ?? "", { max: 200 })}${select("sort", "Sort by", sortChoices, `${state.query.sort?.field || ""}:${state.query.sort?.direction || "asc"}`)}<button type="submit" class="pt-btn"${state.loading || busy() ? " disabled" : ""}>Search</button></form>
        ${filters()}
        <details class="pt-workspace-details"><summary>Columns</summary><div class="pt-fields">${definitions()
          .filter((item) => item.fieldId !== "displayName")
          .map(
            (item) =>
              `<label class="pt-workspace-check"><input type="checkbox" data-register-column="${e(item.fieldId)}"${state.columns.includes(item.fieldId) ? " checked" : ""}>${e(item.label)}</label>`,
          )
          .join("")}</div></details>
        <div class="pt-actions bc-register-selection">
          ${b("select-page", "Select this page", { secondary: true, disabled: !state.rows.length || contactPending })}
          ${b("select-all", "Select all matching", { secondary: true, disabled: contactPending })}
          ${b("clear", "Clear selection", { secondary: true, disabled: contactPending })}
          <span role="status">${selectedCount === null ? "All matching voters selected" : `${count(selectedCount)} selected`}</span>
          ${can("export") ? b("export", selectedCount || state.allMatching ? "Export selected voters" : "Export this list") : ""}
          ${chaseView === "outstanding" && canCampaign() && beginCampaign ? b("campaign", "Create texting campaign", { disabled: !selectedCount || contactPending }) : ""}
          ${can("import") ? b("contacts", state.materializationIntent ? "Check this request" : "Add selected to Contact Book", { secondary: true, disabled: !state.included.size || state.allMatching || !!state.materializationIntent || ["queued", "running"].includes(state.materialization?.status) }) : ""}
        </div>
        ${contactPanel()}
        ${state.rows.length ? rowTable() : state.loaded && !state.loading ? notice("No matching voters", "Try another ballot list or filter.") : notice("Loading voters")}
        ${
          details
            ? `<section class="pt-card" aria-label="County details"><h3>${e(details.fields?.displayName || "County details")}</h3><dl class="bc-register-details">${definitions()
                .map(
                  (item) =>
                    `<div><dt>${e(item.label)}</dt><dd>${e(displayContactValue(ballotRegisterValue(details, item.fieldId)))}</dd></div>`,
                )
                .join(
                  "",
                )}</dl>${b("source-close", "Close details", { secondary: true })}</section>`
            : ""
        }
        <div class="pt-actions">${b("previous", "Previous page", { secondary: true, disabled: state.page === 0 })}<span>Page ${state.page + 1}</span>${b("next", "Next page", { secondary: true, disabled: !state.nextCursor })}</div>
      `
      }
    </section>`;
  }
  async function action(name, value) {
    if (!name.startsWith("register-")) return false;
    current();
    if (state.loading || state.stale || state.denied) return true;
    const operation = name.slice(9);
    if (
      (state.materializationIntent ||
        ["queued", "running"].includes(state.materialization?.status)) &&
      ["select-page", "select-all", "clear"].includes(operation)
    )
      return true;
    if (
      state.materializationIntent &&
      ["next", "previous", "filter-clear"].includes(operation)
    )
      throw new Error(
        "Check the pending Contact Book request before changing this list.",
      );
    if (operation === "next" && state.nextCursor) {
      state.cursors[++state.page] = state.nextCursor;
      await load();
    } else if (operation === "previous" && state.page > 0) {
      state.page--;
      await load();
    } else if (operation === "select-page") {
      for (const row of state.rows) {
        state.included.add(row.voterRef);
        state.excluded.delete(row.voterRef);
      }
    } else if (operation === "select-all") {
      clearSelection();
      state.allMatching = true;
    } else if (operation === "clear") clearSelection();
    else if (operation === "source")
      state.detail = state.rows.find((row) => row.voterRef === value);
    else if (operation === "source-close") state.detail = null;
    else if (operation === "filter-add") {
      const children = filterChildren(value || "");
      if (children.length >= 20)
        throw new Error("Use up to 20 conditions in a group.");
      children.push({ field: "", op: "eq", value: "" });
      state.filtersOpen = true;
    } else if (operation === "filter-group-add") {
      if (String(value || "").split(".").length > 3)
        throw new Error("Use fewer nested groups.");
      const children = filterChildren(value || "");
      if (children.length >= 20)
        throw new Error("Use up to 20 conditions in a group.");
      children.push({
        op: "and",
        conditions: [{ field: "", op: "eq", value: "" }],
      });
      state.filtersOpen = true;
    } else if (operation === "filter-remove") {
      const parts = String(value).split(".");
      const index = Number(parts.pop());
      filterChildren(parts.join(".")).splice(index, 1);
    } else if (operation === "filter-clear") {
      state.filters = [];
      delete state.query.filter;
      await load({ first: true });
    } else if (operation === "export") {
      if (!can("export")) throw new Error("Voter export is restricted.");
      const explicit = !state.allMatching && state.included.size > 0;
      await beginExport({
        electionId,
        snapshotId,
        view: chaseView,
        ...state.query,
        ...(explicit ? { sort: undefined } : {}),
        columns: [
          ...new Set([
            ...state.columns.filter((key) =>
              definitions().some((definition) => definition.fieldId === key),
            ),
            "ballotNewlyReturned",
          ]),
        ],
        registerSchema: definitions().map((definition) => definition.fieldId),
        selection:
          explicit || state.allMatching
            ? ballotRegisterSelection(state)
            : { mode: "all_matching", excludeVoterRefs: [] },
      });
    } else if (operation === "campaign") {
      if (chaseView !== "outstanding" || !canCampaign() || !beginCampaign)
        throw new Error("Texting campaign access is restricted.");
      const selection = ballotRegisterSelection(state);
      if (!state.allMatching && !state.included.size)
        throw new Error("Select voters for this campaign first.");
      if (state.included.size + state.excluded.size > 5000)
        throw new Error("Use up to 5,000 individual selection changes.");
      await beginCampaign({
        sourceType: "ballot_register",
        ballotChase: { electionId, snapshotId, view: "outstanding" },
        query: structuredClone(state.query),
        selection,
      });
    } else if (operation === "contacts-refresh") {
      await refreshContacts();
    } else if (operation === "contacts") {
      if (!can("import") || state.allMatching || !state.included.size)
        throw new Error("Select individual voters to add to Contact Book.");
      if (state.included.size > 5000)
        throw new Error("Choose up to 5,000 voters to add at a time.");
      if (["queued", "running"].includes(state.materialization?.status))
        return true;
      if (!state.materializationIntent) state.materialization = null;
      const version = generation;
      state.materializationIntent ||= {
        operationId: uuid(),
        snapshotId,
        voterRefs: [...state.included],
      };
      try {
        const result = await call(
          "/contacts",
          state.materializationIntent,
          version,
        );
        acceptContactsJob(result.job);
        state.materializationIntent = null;
        state.error = "";
      } catch (error) {
        try {
          current();
        } catch {
          dispose();
          throw error;
        }
        fail(error);
        throw new Error(state.error);
      }
    }
    changed();
    return true;
  }
  function acceptContactsJob(job) {
    if (
      !job?.jobId ||
      !["queued", "running", "complete", "needs_review", "failed"].includes(
        job.status,
      ) ||
      (state.materialization && state.materialization.jobId !== job.jobId)
    )
      throw new Error(
        "The Contact Book request could not be confirmed. Check this request again.",
      );
    state.materialization = job;
    cancel(contactTimer);
    if (["queued", "running"].includes(job.status))
      contactTimer = schedule(() => {
        void refreshContacts();
      }, 3000);
  }
  async function refreshContacts() {
    if (contactFlight || !state.materialization?.jobId || disposed)
      return contactFlight;
    contactFlight = (async () => {
      current();
      const result = await request(
        `${endpoint}/contacts/${id(state.materialization.jobId)}`,
        {
          auth: true,
          beforeRequest: () => current(),
        },
      );
      current();
      if (result?.ok !== true)
        throw new Error("The Contact Book request could not be confirmed.");
      acceptContactsJob(result.job);
      state.contactError = "";
      changed();
    })()
      .catch((error) => {
        if (!disposed) {
          try {
            current();
            if (
              staleCodes.has(error?.payload?.error || error?.code) ||
              [401, 403].includes(error?.status || error?.statusCode)
            )
              fail(error);
            else state.contactError = error.message;
            changed();
          } catch {
            dispose();
          }
        }
      })
      .finally(() => {
        contactFlight = null;
      });
    return contactFlight;
  }
  async function submit(kind, form) {
    current();
    if (state.loading || state.stale || state.denied) return;
    if (state.materializationIntent)
      throw new Error(
        "Check the pending Contact Book request before changing this list.",
      );
    const data = form instanceof FormData ? form : new FormData(form);
    if (kind === "search") {
      const sort = String(data.get("sort") || "displayName:asc");
      const split = sort.lastIndexOf(":");
      const sortField = sort.slice(0, split),
        direction = sort.slice(split + 1);
      if (
        !definitions().some(
          (definition) =>
            definition.fieldId === sortField && definition.sortable !== false,
        ) ||
        !["asc", "desc"].includes(direction)
      )
        throw new Error("Choose a supported sort order.");
      state.query.sort = {
        field: sortField,
        direction,
      };
      state.query.search = String(data.get("search") || "").trim();
    } else if (kind === "filters") {
      const conditions = readFilters(state.filters, data, "", true);
      state.query.filter = conditions.length
        ? { op: data.get("filterLogic") === "or" ? "or" : "and", conditions }
        : undefined;
      state.filterLogic = state.query.filter?.op;
      state.filters = readFilters(state.filters, data);
      state.filtersOpen = false;
    }
    await load({ first: true });
  }
  function change(target) {
    current();
    if (target.dataset.registerRow) {
      if (
        state.materializationIntent ||
        ["queued", "running"].includes(state.materialization?.status)
      )
        return false;
      const voterRef = target.dataset.registerRow;
      if (!state.rows.some((row) => row.voterRef === voterRef)) return false;
      if (target.checked) {
        state.included.add(voterRef);
        state.excluded.delete(voterRef);
      } else {
        state.included.delete(voterRef);
        if (state.allMatching) state.excluded.add(voterRef);
      }
      return true;
    }
    if (target.dataset.registerColumn) {
      const key = target.dataset.registerColumn;
      if (!definitions().some((item) => item.fieldId === key)) return false;
      state.columns = target.checked
        ? [...new Set([...state.columns, key])]
        : state.columns.filter((column) => column !== key);
      return true;
    }
    const form = target.closest?.("[data-register-form]");
    if (form?.dataset.registerForm === "filters") {
      const data = new FormData(form);
      state.filters = readFilters(state.filters, data);
      state.filterLogic = data.get("filterLogic");
    }
    if (form?.dataset.registerForm === "search" && target.name === "search")
      state.searchDraft = target.value;
    return false;
  }
  return { load, render, action, submit, change, dispose, state: () => state };
}
