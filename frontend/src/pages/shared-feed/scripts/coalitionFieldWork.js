import {
  fieldText as text,
  fieldEscape as e,
  fieldArray as rows,
  fieldAccess,
  fieldGeometry,
  fieldVoter,
  fieldPerson,
  fieldPoint,
  fieldBounds,
  fieldInTerritory,
  fieldFilterRecords,
  fieldAssignmentActive,
  fieldStatusLabels,
} from "./coalitionFieldWorkModel.js";
import { createCoalitionFieldWorkBuilder } from "./coalitionFieldWorkBuilder.js";

const paths = {
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
  locate:
    '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-3-5"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-2 8m2-14v6h-6"/>',
  minus: '<path d="M4 12h16"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.map}</svg>`;
const badge = (label, status = "published") =>
  `<span class="field-status" data-status="${e(status)}">${e(label)}</span>`;
const button = (label, action, extra = "", primary = false) =>
  `<button type="button" class="${primary ? "primary-button" : "secondary-button"}" data-fw-action="${action}" ${extra}>${label}</button>`;
const date = (value) => {
  const time =
    typeof value === "number"
      ? value
      : /^\d+$/u.test(String(value))
        ? Number(value)
        : Date.parse(value);
  return value && Number.isFinite(time)
    ? new Date(time).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not scheduled";
};
const featureCollection = (features) => ({
  type: "FeatureCollection",
  features,
});

/** A scoped, persistent workspace. Every response and mutation is fenced by actor,
 * session and coalition identity, independently of the shared page's hydration. */
export function createCoalitionFieldWork({
  context,
  request,
  loadMapLibre,
  mapStyle,
  navigate,
  openApp,
  onAccess = () => {},
  onContextInvalidated = () => {},
  onBuilderOpen,
} = {}) {
  let host,
    map,
    mapLibrary,
    mapCanvas,
    observer,
    generation = 0,
    mapEpoch = 0,
    queryTimer,
    searchTimer,
    modalFocus,
    pendingDraftRecovery,
    importTimer,
    toastTimer;
  let markers = [],
    miniMaps = [],
    miniEpoch = 0,
    initialFlight;
  const fresh = () => ({
    key: "",
    actorId: "",
    coalitionId: "",
    loading: true,
    loaded: false,
    error: "",
    denied: false,
    access: null,
    territories: [],
    assignments: {},
    assignmentErrors: {},
    people: [],
    peopleError: "",
    progress: null,
    progressError: "",
    voters: [],
    nextCursor: "",
    listError: "",
    listLoading: false,
    points: [],
    households: [],
    householdNotice: "",
    clusters: [],
    mapLoading: false,
    mapError: "",
    mapMessage: "",
    mapPartial: false,
    view: "map",
    layout: "map",
    query: "",
    area: "all",
    outreach: "all",
    selectedId: "",
    details: {},
    notes: {},
    drafts: {},
    pending: "",
    notice: "",
    dialog: null,
    builderEntryHandled: false,
    dialogError: "",
    manual: {},
    duplicate: null,
    import: {},
    bbox: null,
    mapReady: false,
  });
  let state = fresh();
  const current = () => context?.() || null;
  const identity = (c = current()) =>
    c?.userId && c?.coalitionId
      ? `${c.userId}|${c.sessionKey || ""}|${c.coalitionId}|${c.contactSelectionId || ""}|${c.ballotChase?.snapshotId || ""}`
      : "";
  const endpoint = (suffix = "") =>
    `/api/coalitions/${encodeURIComponent(current().coalitionId)}${suffix}`;
  const q = (selector) => host?.querySelector(selector);
  const canAssign = () =>
    Boolean(state.access?.canManageTerritories && !state.denied);
  const canAuthor = () => Boolean(state.access?.canAuthor && !state.denied);
  const isAdmin = () =>
    state.access
      ? canAssign()
      : Boolean(
          current()?.membership?.isAdmin ||
            ["admin", "officer"].includes(
              text(current()?.membership?.role).toLowerCase(),
            ) ||
            state.access?.canManageTerritories,
        );
  const territory = (id) =>
    state.territories.find((row) => row.territoryId === id);
  const assignments = (id) =>
    (state.assignments[id] || []).filter((row) => fieldAssignmentActive(row));
  const person = (id) => state.people.find((row) => row.userId === id);
  const myIds = () =>
    canAssign()
      ? [
          ...new Set(
            Object.values(state.assignments)
              .flat()
              .filter(
                (row) =>
                  row.userId === current()?.userId &&
                  fieldAssignmentActive(row),
              )
              .map((row) => row.territoryId),
          ),
        ]
      : [
          ...new Set(
            rows(state.progress?.access?.boundaries, ["features"])
              .filter(
                (feature) => feature.properties?.kind === "assigned_territory",
              )
              .map((feature) => text(feature.properties.territoryId))
              .filter(Boolean),
          ),
        ];
  const myTerritories = () =>
    state.territories
      .filter((row) => myIds().includes(row.territoryId))
      .map((row) => {
        const active =
          !canAssign() &&
          rows(state.progress?.access?.boundaries, ["features"]).find(
            (feature) =>
              feature.properties?.kind === "assigned_territory" &&
              feature.properties.territoryId === row.territoryId,
          );
        return active
          ? {
              ...row,
              geojson: fieldGeometry(active),
              version: active.properties.version || row.version,
            }
          : row;
      });
  const tabs = () =>
    isAdmin()
      ? [
          ["map", "Map"],
          ["territories", "Territories"],
          ["assignments", "Assignments"],
        ]
      : [
          ["map", "Map"],
          ["mine", "My areas"],
        ];
  function recoveryOwnerMatches(recovery, next) {
    return Boolean(
      next?.sessionKey &&
        recovery?.actorId &&
        recovery.actorId === next.userId &&
        recovery.coalitionId === next.coalitionId,
    );
  }
  /** Credential rotation may retain user input, never a prior access grant or
   * service response. A logout or any actor/scope change discards these drafts. */
  function captureDraftRecovery(next) {
    if (!recoveryOwnerMatches(state, next)) return null;
    return {
      actorId: state.actorId,
      coalitionId: state.coalitionId,
      drafts: Object.fromEntries(
        Object.entries(state.drafts).map(([recordId, draft]) => [
          recordId,
          {
            body: String(draft.body || ""),
            contactType: text(draft.contactType),
          },
        ]),
      ),
      manual: Object.fromEntries(
        [
          "name",
          "addressLine1",
          "addressLine2",
          "city",
          "state",
          "postalCode",
          "phone",
          "email",
        ].map((key) => [key, String(state.manual?.[key] || "")]),
      ),
    };
  }
  function guard(ticket) {
    if (ticket !== generation || !state.key || state.key !== identity()) {
      if (ticket === generation && state.key !== identity()) {
        const recovery = captureDraftRecovery(current());
        reset();
        pendingDraftRecovery = recovery;
        onContextInvalidated();
      }
      throw Object.assign(
        new Error("Account or workspace changed. Reopen Field work."),
        { stale: true },
      );
    }
  }
  async function call(url, options = {}) {
    const ticket = generation;
    guard(ticket);
    // Header names are case insensitive. The builder supplies its own expected
    // actor header, so normalize before overriding instead of sending two values.
    const headers = Object.fromEntries(
      (typeof Headers !== "undefined" && options.headers instanceof Headers
        ? Array.from(options.headers.entries())
        : Object.entries(options.headers || {})
      ).map(([name, value]) => [name.toLowerCase(), value]),
    );
    headers["x-polis-expected-actor"] = current().userId;
    const payload = await request(url, {
      ...options,
      auth: true,
      // The session transport invokes these guards synchronously. An async
      // callback would reject a discarded promise and still dispatch the write.
      beforeRequest: (...args) => {
        guard(ticket);
        options.beforeRequest?.(...args);
        guard(ticket);
      },
      beforeDispatch: (...args) => {
        guard(ticket);
        options.beforeDispatch?.(...args);
        guard(ticket);
      },
      headers,
    });
    guard(ticket);
    if (payload?.ok === false)
      throw Object.assign(
        new Error(
          text(payload.message || payload.error) ||
            "This request could not be completed.",
        ),
        { payload },
      );
    return payload;
  }
  function sync() {
    const key = identity();
    if (key !== state.key) {
      const next = current();
      const recovery =
        captureDraftRecovery(next) ||
        (recoveryOwnerMatches(pendingDraftRecovery, next)
          ? pendingDraftRecovery
          : null);
      reset();
      state.key = key;
      const c = current();
      state.actorId = c?.userId || "";
      state.coalitionId = c?.coalitionId || "";
      if (recovery) {
        state.drafts = recovery.drafts;
        state.manual = recovery.manual;
      }
      state.view = ["territories", "assignments", "mine"].includes(c?.view)
        ? c.view
        : "map";
      state.area =
        c?.membership?.isAdmin ||
        ["admin", "officer"].includes(c?.membership?.role)
          ? "all"
          : "mine";
      state.layout = c?.layout === "list" ? "list" : "map";
    }
    const c = current(),
      routeSignature = [
        c?.view || "map",
        c?.layout || "map",
        c?.dataAction || "",
        c?.recordId || "",
      ].join("|");
    if (state.routeSignature !== routeSignature) {
      state.routeSignature = routeSignature;
      state.builderEntryHandled = false;
      if (c?.view && c.view !== "builder") state.view = c.view;
      if (c?.layout) state.layout = c.layout;
      if (state.loaded && c?.dataAction === "add")
        queueMicrotask(() => {
          if (
            state.key === identity() &&
            state.routeSignature === routeSignature
          )
            dataDialog("add");
        });
      if (state.loaded && c?.view === "builder")
        queueMicrotask(() => {
          if (
            state.key === identity() &&
            state.routeSignature === routeSignature &&
            !state.builderEntryHandled &&
            canAuthor()
          ) {
            state.builderEntryHandled = true;
            void builder.open();
          }
        });
    }
    return key;
  }
  function reset() {
    generation++;
    mapEpoch++;
    initialFlight = null;
    pendingDraftRecovery = null;
    clearTimeout(queryTimer);
    clearTimeout(searchTimer);
    clearTimeout(importTimer);
    clearTimeout(toastTimer);
    observer?.disconnect();
    observer = null;
    markers.forEach((item) => item.remove());
    markers = [];
    miniEpoch++;
    miniMaps.forEach((item) => item.remove());
    miniMaps = [];
    map?.remove();
    map = null;
    mapCanvas = null;
    builder.reset();
    host?.remove();
    host = null;
    state = fresh();
  }
  function notice(message) {
    state.notice = message;
    renderNotice();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.notice = "";
      renderNotice();
    }, 5000);
  }
  function renderNotice() {
    const node = q("[data-fw-toast]");
    if (node) {
      node.textContent = state.notice;
      node.hidden = !state.notice;
    }
  }
  function markup() {
    sync();
    return "<div data-fieldwork-host></div>";
  }
  function beforeRender() {
    const active = document.activeElement;
    if (!host?.contains(active)) return;
    modalFocus = {
      element: active,
      start: active.selectionStart,
      end: active.selectionEnd,
    };
  }
  function mount(root) {
    const placeholder = root.querySelector("[data-fieldwork-host]");
    if (!placeholder || !sync()) {
      if (host && !placeholder) reset();
      return;
    }
    if (!host) {
      host = document.createElement("section");
      host.className = "polis-field-work";
      host.setAttribute("aria-label", "Field work workspace");
      host.addEventListener("click", onClick);
      host.addEventListener("submit", onSubmit);
      host.addEventListener("input", onInput);
      host.addEventListener("change", onChange);
      host.addEventListener("keydown", onKeydown);
      host.addEventListener(
        "cancel",
        (event) => {
          event.stopPropagation();
          if (state.pending || builder.isBusy()) {
            event.preventDefault();
            return;
          }
          state.dialog = null;
          builder.close();
        },
        true,
      );
      render();
    }
    placeholder.replaceWith(host);
    const open = q("dialog[open]");
    if (open && !open.matches(":modal")) {
      open.close();
      open.showModal();
      if (modalFocus?.element?.isConnected) {
        modalFocus.element.focus({ preventScroll: true });
        if (
          typeof modalFocus.start === "number" &&
          typeof modalFocus.element.setSelectionRange === "function"
        )
          modalFocus.element.setSelectionRange(
            modalFocus.start,
            modalFocus.end,
          );
      }
    }
    resizeMap();
    void mountMiniMaps();
    if (!state.loaded && !initialFlight) void load();
    const routeRecord = text(current()?.recordId);
    if (
      routeRecord &&
      state.loaded &&
      state.selectedId !== routeRecord &&
      !state.dialog
    )
      void showVoter(routeRecord);
  }
  async function readAccess() {
    let payload;
    try {
      payload = await call(endpoint("/voter-map/access"));
    } catch (error) {
      if (!error.stale && [401, 403].includes(Number(error.status))) {
        state.denied = true;
        state.access = fieldAccess({ scope: "denied" });
        state.error =
          "Your Field work access changed. Reload this workspace to check your current permissions.";
        state.voters = [];
        state.points = [];
        state.clusters = [];
        state.territories = [];
        state.notes = {};
        state.details = {};
        q("dialog[open]")?.close();
        state.dialog = null;
        builder.close();
        render();
      }
      throw error;
    }
    state.access = fieldAccess(payload);
    state.territories = state.access.territories;
    onAccess(payload);
    return state.access;
  }
  async function load({ refresh = false } = {}) {
    if (!sync()) return;
    if (initialFlight) return initialFlight;
    if (state.loaded && !refresh) return;
    const ticket = generation;
    const work = async () => {
      state.loading = true;
      state.error = "";
      state.denied = false;
      render();
      try {
        if (
          current().enabled === false ||
          current().membership?.canAccessVoterMap === false
        )
          throw Object.assign(
            new Error(
              "This coalition role does not include Field work access.",
            ),
            { status: 403 },
          );
        await readAccess();
        guard(ticket);
        const jobs = [loadVoters(), loadProgress()];
        if (canAssign()) jobs.push(loadPeople(), loadAssignments());
        await Promise.allSettled(jobs);
        guard(ticket);
        state.loaded = true;
        if (current()?.dataAction === "add")
          setTimeout(() => dataDialog("add"), 0);
        if (
          current()?.view === "builder" &&
          canAuthor() &&
          !state.builderEntryHandled
        ) {
          state.builderEntryHandled = true;
          setTimeout(() => {
            if (ticket === generation && current()?.view === "builder")
              void builder.open();
          }, 0);
        }
      } catch (error) {
        if (error.stale) return;
        state.error = error.message || "Field work could not be loaded.";
        state.denied = [401, 403].includes(Number(error.status));
      } finally {
        if (ticket === generation && state.key === identity()) {
          state.loading = false;
          initialFlight = null;
          render();
          if (refresh && state.mapReady) void queryMap(true);
        }
      }
    };
    initialFlight = work();
    return initialFlight;
  }
  async function loadVoters({ append = false } = {}) {
    const ticket = generation,
      query = new URLSearchParams({ limit: "50" });
    const version = (state.listRequestVersion =
      (state.listRequestVersion || 0) + 1);
    const searchQuery = state.query;
    if (state.query) query.set("q", state.query);
    if (append && state.nextCursor) query.set("cursor", state.nextCursor);
    state.listLoading = true;
    state.listError = "";
    try {
      const payload = await call(endpoint(`/voters?${query}`));
      guard(ticket);
      if (version !== state.listRequestVersion || searchQuery !== state.query)
        return;
      const records = rows(payload, ["items", "voters", "records"]).map((row) =>
        fieldVoter(
          row,
          state.points.find((point) => point.recordId === row.recordId),
        ),
      );
      state.voters = append
        ? [
            ...new Map(
              [...state.voters, ...records].map((row) => [row.recordId, row]),
            ).values(),
          ]
        : records;
      state.nextCursor = text(payload.nextCursor || payload.cursor);
    } catch (error) {
      if (!error.stale && version === state.listRequestVersion)
        state.listError = error.message || "Voter records could not be loaded.";
    } finally {
      if (ticket === generation && version === state.listRequestVersion) {
        state.listLoading = false;
        if (!state.loading) renderResults();
      }
    }
  }
  async function loadPeople() {
    try {
      const result = [],
        seen = new Set();
      let cursor = "";
      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const payload = await call(endpoint(`/members?${query}`));
        result.push(...rows(payload, ["items", "members"]).map(fieldPerson));
        cursor = text(payload.nextCursor);
        if (seen.has(cursor)) break;
        seen.add(cursor);
      } while (cursor);
      state.people = [
        ...new Map(
          result.filter((row) => row.userId).map((row) => [row.userId, row]),
        ).values(),
      ];
      state.peopleError = "";
    } catch (error) {
      if (!error.stale)
        state.peopleError =
          error.message || "The authorized team roster could not be loaded.";
    }
  }
  async function loadAssignments() {
    await Promise.allSettled(
      state.territories.map(async (row) => {
        try {
          const result = await call(
            endpoint(
              `/voter-map/territories/${encodeURIComponent(row.territoryId)}/assignments`,
            ),
          );
          state.assignments[row.territoryId] = rows(result, [
            "assignments",
            "items",
          ]);
          delete state.assignmentErrors[row.territoryId];
        } catch (error) {
          if (!error.stale)
            state.assignmentErrors[row.territoryId] =
              error.message || "Assignments could not be loaded.";
        }
      }),
    );
  }
  async function loadProgress() {
    try {
      state.progress = await call(
        `/api/voter-map/canvassing/progress?coalitionId=${encodeURIComponent(current().coalitionId)}`,
      );
      state.progressError = "";
    } catch (error) {
      if (!error.stale)
        state.progressError =
          error.message || "Field readiness could not be loaded.";
    }
  }
  function empty(title, description, actions = "") {
    return `<div class="empty-state">${icon("map")}<h3>${e(title)}</h3><p>${e(description)}</p>${actions ? `<div class="field-error-actions">${actions}</div>` : ""}</div>`;
  }
  function errorBox(message, action = "retry") {
    return `<div class="field-inline-notice note-box warning" role="alert"><strong>${e(message)}</strong><div class="note-actions">${button("Retry", action)}</div></div>`;
  }
  function header(title, subtitle, actions = "") {
    return `<div class="panel-header"><div><h2>${e(title)}</h2><p>${e(subtitle)}</p></div>${actions ? `<div class="panel-toolbar">${actions}</div>` : ""}</div>`;
  }
  function rosterLabel(id) {
    const p = person(id);
    return p?.name || "Member unavailable";
  }
  function personLabel(id) {
    const p = person(id);
    return `<span class="person"><span class="avatar">${e(
      (p?.name || "?")
        .split(" ")
        .slice(0, 2)
        .map((word) => word[0])
        .join(""),
    )}</span><span>${e(rosterLabel(id))}</span></span>`;
  }
  function visibleHouseholds() {
    if (state.outreach !== "all") return [];
    const query = state.query.trim().toLowerCase();
    return state.households.filter((row) => {
      if (
        query &&
        ![
          ...Object.values(row.address || {}),
          ...(row.linkedPeople || []).map((person) => person.displayName),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
        return false;
      if (state.area === "all") return true;
      return state.territories.some(
        (territory) =>
          (state.area === "mine"
            ? myIds().includes(territory.territoryId)
            : territory.territoryId === state.area) &&
          fieldInTerritory(row, territory),
      );
    });
  }
  function results() {
    const records =
      state.layout === "map"
        ? state.points.map((point) =>
            fieldVoter(
              state.voters.find((row) => row.recordId === point.recordId) ||
                point,
              point,
            ),
          )
        : state.voters;
    return fieldFilterRecords(records, {
      ...state,
      territories: state.territories.map(
        (row) =>
          myTerritories().find(
            (active) => active.territoryId === row.territoryId,
          ) || row,
      ),
      myTerritoryIds: myIds(),
    });
  }
  function render() {
    if (!host || state.key !== identity()) return;
    if (!tabs().some(([key]) => key === state.view)) state.view = "map";
    const activeDialog = state.dialog,
      main = q("[data-fw-main]");
    miniEpoch++;
    miniMaps.forEach((item) => item.remove());
    miniMaps = [];
    if (mapCanvas) mapCanvas.remove();
    host.setAttribute("aria-busy", String(state.loading));
    if (!main)
      host.innerHTML =
        '<div data-fw-main></div><dialog class="drawer" data-fw-detail></dialog><dialog class="create-dialog" data-fw-create></dialog><div class="toast" role="status" data-fw-toast hidden></div>';
    q("[data-fw-main]").innerHTML =
      `<div class="page-intro"><p>Plan the area. Connect the team. Make every doorstep count.</p>${(state.view === "assignments" ? canAssign() : canAuthor()) && !state.loading ? button(`${icon("plus")}${state.view === "assignments" ? "Assign territory" : "New territory"}`, state.view === "assignments" ? "assign" : "new-territory", "", true) : ""}</div><nav class="view-tabs" role="tablist" aria-label="Field work views">${tabs()
        .map(
          ([key, label]) =>
            `<button type="button" role="tab" id="fw-tab-${key}" aria-controls="fw-panel" aria-selected="${key === state.view}" tabindex="${key === state.view ? 0 : -1}" data-fw-action="view" data-view="${key}">${label}${key === "territories" || key === "mine" ? `<span class="count">${key === "mine" ? myTerritories().length : state.territories.length}</span>` : ""}</button>`,
        )
        .join(
          "",
        )}</nav><div id="fw-panel" role="tabpanel" aria-labelledby="fw-tab-${state.view}">${state.loading ? `<section class="panel">${empty("Loading Field work", "Checking your current access and field data.")}</section>` : state.error ? `<section class="panel">${empty(state.denied ? "Field work access unavailable" : "Field work could not be loaded", state.error, button("Retry", "retry"))}</section>` : state.view === "map" ? mapMarkup() : state.view === "assignments" ? assignmentsMarkup() : territoriesMarkup()}</div>`;
    if (state.view === "map" && !state.loading && !state.error) {
      renderResults();
      mountMap();
    }
    renderNotice();
    if (activeDialog && !q("dialog[open]")) renderDialog();
    void mountMiniMaps();
  }
  function mapMarkup() {
    return `<section class="panel">${header("Your field map", "Find voters, plan territories, and give your team a clear place to start.", `<div class="view-toggle" role="group" aria-label="Voter view">${["map", "list"].map((layout) => `<button type="button" data-fw-action="layout" data-layout="${layout}" aria-pressed="${state.layout === layout}">${icon(layout)}${layout === "map" ? "Map" : "List"}</button>`).join("")}</div>`)}<div class="field-toolbar"><label class="field search-field"><span>Find a voter or address</span><div class="search-input">${icon("search")}<input type="search" data-fw-search value="${e(state.query)}" placeholder="Search name or street" /></div></label><label class="field"><span>Territory</span><select data-fw-area><option value="all"${state.area === "all" ? " selected" : ""}>All accessible areas</option><option value="mine"${state.area === "mine" ? " selected" : ""}>My assigned areas</option>${state.territories.map((t) => `<option value="${e(t.territoryId)}"${state.area === t.territoryId ? " selected" : ""}>${e(t.name)}</option>`).join("")}</select></label><label class="field"><span>Outreach status</span><select data-fw-outreach>${[["all", "All outreach"], ...Object.entries(fieldStatusLabels).filter(([key]) => key !== "unknown")].map(([key, label]) => `<option value="${key}"${state.outreach === key ? " selected" : ""}>${label}</option>`).join("")}</select></label></div><div class="field-toolbar-summary"><span data-fw-count></span><div class="note-actions"><button type="button" class="text-button" data-fw-action="retry-households" data-fw-household-retry hidden>Refresh household addresses</button><button type="button" class="text-button" data-fw-action="geocode-credits">Geocode credits</button>${isAdmin() ? '<button type="button" class="text-button" data-fw-action="manage-data">Manage voter data</button>' : ""}<button type="button" class="text-button" data-fw-action="clear-filters">Clear filters</button></div></div>${readinessNotice()}<div data-fw-results></div><footer class="field-context"><p>${icon("calendar")} <strong>${e(state.progress?.round?.label || state.progress?.round?.name || "Coalition field calendar")}</strong>${state.progress?.round?.startsAt ? ` · ${date(state.progress.round.startsAt)}` : ""}</p><button type="button" class="text-button" data-fw-action="destination" data-destination="calendar">Open in Calendar ${icon("arrow")}</button></footer></section>`;
  }
  function readinessNotice() {
    const access = state.progress?.access;
    const reason = text(access?.reason);
    if (state.progressError)
      return `<div class="field-inline-notice note-box warning"><strong>Field readiness is unavailable</strong><p>${e(state.progressError)} Map records remain available. Confirm your active assignment before starting a visit.</p>${button("Retry readiness", "retry-progress")}</div>`;
    if (
      [
        "canvassing_operations_disabled",
        "no_assignment",
        "boundary_unavailable",
      ].includes(reason)
    )
      return `<div class="field-inline-notice note-box warning"><strong>${e({ canvassing_operations_disabled: "Canvassing is paused", no_assignment: "An active assignment is required", boundary_unavailable: "Your active boundary is unavailable" }[reason])}</strong><p>The voter map remains available. Confirm field readiness with your organizer before recording a visit.</p></div>`;
    if (state.area === "mine" && !myIds().length)
      return `<div class="field-inline-notice note-box"><strong>No active areas assigned to you</strong><p>A field organizer can assign your next territory. You can still review the areas your map access permits.</p></div>`;
    return "";
  }
  function recordButton(row) {
    const area = state.territories.find((t) => fieldInTerritory(row, t));
    return `<button type="button" class="map-record${state.selectedId === row.recordId ? " is-selected" : ""}" data-fw-action="voter" data-id="${e(row.recordId)}"><i class="map-key-dot" data-status="${e(row.status)}"></i><div><strong>${e(row.name)}</strong><p>${e(row.addressLine1 || "Address unavailable")}<br />${e(area?.name || [row.city, row.state].filter(Boolean).join(", "))}</p><small>${e(fieldStatusLabels[row.status])}</small></div>${icon("arrow")}</button>`;
  }
  function householdButton(row) {
    const residents = (row.linkedPeople || [])
      .map((person) => person.displayName)
      .filter(Boolean);
    return `<button type="button" class="field-record-button" data-fw-action="destination" data-destination="contacts" data-contact-id="${e(row.contactId)}"><strong>${e(row.address?.addressLine1 || "Household address")}</strong><small>${e([row.address?.addressLine2, row.address?.city].filter(Boolean).join(", "))}${row.reviewRequired ? " · Address needs review" : ""}</small><small>${residents.length ? e(residents.join(", ")) : "Incomplete contact · Add a person"}</small></button>`;
  }
  function renderResults() {
    const target = q("[data-fw-results]");
    if (!target) return;
    const records = results();
    q("[data-fw-count]").textContent =
      `${records.length.toLocaleString()} loaded voter record${records.length === 1 ? "" : "s"} in this view${state.mapPartial ? " · Partial map results: zoom in for more detail" : ""}`;
    if (state.households.length)
      q("[data-fw-count]").textContent +=
        ` · ${visibleHouseholds().length} household addresses`;
    if (visibleHouseholds().length > 200)
      q("[data-fw-count]").textContent +=
        " - Showing 200 household pins; zoom in for more detail";
    if (state.householdNotice)
      q("[data-fw-count]").textContent += ` · ${state.householdNotice}`;
    const householdRetry = q("[data-fw-household-retry]");
    if (householdRetry) householdRetry.hidden = !state.householdNotice;
    if (mapCanvas) mapCanvas.remove();
    if (state.layout === "list")
      target.innerHTML = `${state.listError ? errorBox(state.listError, "retry-voters") : ""}${records.length ? `<table class="field-table"><thead><tr><th>Voter</th><th>Outreach</th><th>Area</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${records.map((row) => `<tr><td><button type="button" class="text-button" data-fw-action="voter" data-id="${e(row.recordId)}"><strong>${e(row.name)}</strong><small>${e(row.addressLine1)}</small></button></td><td data-label="Outreach">${badge(fieldStatusLabels[row.status], row.status)}</td><td data-label="Area">${e(state.territories.find((t) => fieldInTerritory(row, t))?.name || row.city || "Unmapped")}</td><td>${button(icon("arrow"), "voter", `data-id="${e(row.recordId)}" aria-label="View ${e(row.name)}"`)}</td></tr>`).join("")}</tbody></table>` : state.listLoading ? empty("Loading voter records", "Checking the current filters.") : state.listError ? "" : empty("No matching voters", "Try another name, street, territory, or outreach filter.", button("Clear filters", "clear-filters"))}<footer class="field-context"><p>${state.nextCursor ? "More records are available. Area and outreach filters apply to the records loaded so far." : "Showing all returned records for the current search."}</p>${state.nextCursor ? button(state.listLoading ? "Loading…" : "Load more voters", "load-more", state.listLoading ? "disabled" : "") : ""}</footer>`;
    else
      target.innerHTML = `<div class="map-layout"><div class="field-map"><div class="map-surface"><div data-fw-map-mount></div><div class="map-controls" aria-label="Map controls">${button(icon("plus"), "zoom-in", 'aria-label="Zoom in"')}${button(icon("minus"), "zoom-out", 'aria-label="Zoom out"')}${button(icon("locate"), "fit", 'aria-label="Fit coalition area"')}</div><div class="map-legend" aria-label="Outreach legend">${Object.entries(
        fieldStatusLabels,
      )
        .filter(([key]) => key !== "unknown")
        .map(
          ([key, label]) => `<span><i data-status="${key}"></i>${label}</span>`,
        )
        .join(
          "",
        )}</div><div class="field-map-message" data-fw-map-message hidden></div></div></div><aside class="map-side-list" aria-label="Voters in this view"><div class="map-side-heading"><div><h3>Voters in this view</h3><p>${records.length} loaded records · Select for details</p></div><button type="button" class="icon-button" aria-label="Show voter list" data-fw-action="layout" data-layout="list">${icon("list")}</button></div>${state.listError ? errorBox("Voter records could not be loaded. " + state.listError, "retry-voters") : ""}${state.mapDataError ? errorBox("Map records could not be loaded. " + state.mapDataError, "retry-map") : records.map(recordButton).join("") || empty(state.mapLoading ? "Loading map records" : "No voters in this view", state.mapLoading ? "Retrieving the current map area." : "Move the map, clear filters, or switch to the voter list.", button("Clear filters", "clear-filters"))}</aside></div>`;
    if (state.layout === "map") {
      const side = q(".map-side-list");
      if (side && visibleHouseholds().length) {
        side.insertAdjacentHTML(
          "beforeend",
          `<div class="map-side-heading"><h3>Household addresses</h3></div>${visibleHouseholds().map(householdButton).join("")}`,
        );
      }
      mountMap();
      renderMapMessage();
      updateMapMarkers();
    } else if (visibleHouseholds().length) {
      target.insertAdjacentHTML(
        "beforeend",
        `<section aria-label="Household addresses in this map area"><h3>Household addresses</h3><p>Address-only contacts and linked residents from the current map area. Household addresses are separate from voter records.</p>${visibleHouseholds().map(householdButton).join("")}</section>`,
      );
    }
  }
  function miniMap(t) {
    const geometry = t.geojson,
      bounds = fieldBounds([t]);
    if (!geometry || !bounds)
      return '<div class="territory-mini-map">Boundary preview unavailable</div>';
    const [w, s, east, north] = bounds,
      dx = Math.max(east - w, 0.0001),
      dy = Math.max(north - s, 0.0001),
      rings =
        geometry.type === "Polygon"
          ? geometry.coordinates
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates.flat()
            : [];
    return `<div class="territory-mini-map"><div class="field-mini-map" data-fw-mini="${e(t.territoryId)}" aria-label="${e(t.name)} boundary and street context"><svg viewBox="0 0 440 150" role="img" aria-label="${e(t.name)} boundary"><rect width="440" height="150" class="map-land"/>${rings.map((ring) => `<polygon class="territory-shape is-selected" points="${ring.map(([x, y]) => `${40 + ((x - w) / dx) * 360},${130 - ((y - s) / dy) * 110}`).join(" ")}"/>`).join("")}</svg></div></div>`;
  }
  async function mountMiniMaps() {
    miniMaps = miniMaps.filter((thumbnail) => {
      if (thumbnail.getContainer().isConnected) return true;
      thumbnail.remove();
      return false;
    });
    const nodes = [
      ...(host?.querySelectorAll(
        "[data-fw-mini]:not([data-fw-mini-mounted])",
      ) || []),
    ];
    if (!nodes.length) return;
    const version = miniEpoch,
      ticket = generation;
    try {
      const lib = mapLibrary || (await loadMapLibre());
      guard(ticket);
      if (version !== miniEpoch) return;
      const style = mapStyle?.();
      if (
        !style ||
        (typeof style === "object" &&
          !(style.layers || []).some((layer) => layer.type !== "background"))
      )
        return;
      nodes.forEach((node) => {
        if (!node.isConnected) return;
        const t = territory(node.dataset.fwMini),
          bounds = fieldBounds(t ? [t] : []);
        if (!t?.geojson || !bounds) return;
        node.dataset.fwMiniMounted = "true";
        const fallback = node.querySelector("svg"),
          mapHost = document.createElement("div");
        mapHost.className = "field-mini-map-canvas";
        mapHost.hidden = true;
        node.append(mapHost);
        const thumbnail = new lib.Map({
          container: mapHost,
          style,
          interactive: false,
          preserveDrawingBuffer: true,
          attributionControl: { compact: true },
          bounds: [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          fitBoundsOptions: { padding: 18, maxZoom: 17 },
          renderWorldCopies: false,
        });
        miniMaps.push(thumbnail);
        thumbnail.on("load", () => {
          if (version !== miniEpoch || !node.isConnected) return;
          thumbnail.addSource("area", {
            type: "geojson",
            data: featureCollection([
              { type: "Feature", geometry: t.geojson, properties: {} },
            ]),
          });
          thumbnail.addLayer({
            id: "area-fill",
            type: "fill",
            source: "area",
            paint: { "fill-color": "#5ea1ff", "fill-opacity": 0.18 },
          });
          thumbnail.addLayer({
            id: "area-line",
            type: "line",
            source: "area",
            paint: { "line-color": "#5ea1ff", "line-width": 2 },
          });
          mapHost.hidden = false;
          fallback?.setAttribute("hidden", "");
          thumbnail.resize();
        });
        thumbnail.on("error", () => {
          if (!node.isConnected) return;
          mapHost.hidden = true;
          fallback?.removeAttribute("hidden");
        });
      });
    } catch (error) {
      if (error.stale)
        return; /* The exact boundary fallback remains available. */
    }
  }
  function territoriesMarkup() {
    const mine = state.view === "mine",
      items = mine ? myTerritories() : state.territories;
    return `<section class="panel">${header(mine ? "Your assigned areas" : "Territories", mine ? "Your active areas, field instructions, and the next place to start." : "Clear boundaries and named teams, without another task dashboard.")}${mine && state.progressError ? errorBox(state.progressError, "retry-progress") : ""}${
      items.length
        ? `<div class="territory-grid">${items
            .map((t) => {
              const assigned = assignments(t.territoryId);
              return `<article class="territory-card"><div class="territory-card-header"><div><h3>${e(t.name)}</h3><p>${e(t.description || "Coalition field area")}</p></div>${badge(t.status === "draft" ? "Draft" : assigned.length || mine ? "Assigned" : state.assignmentErrors[t.territoryId] ? "Unavailable" : "Unassigned", t.status === "draft" ? "draft" : assigned.length || mine ? "assigned" : "unassigned")}</div>${miniMap(t)}<div class="territory-card-meta">${Number.isSafeInteger(t.addressCount) ? `<span><strong>${t.addressCount}</strong> eligible doors</span>` : ""}${Number.isSafeInteger(t.recordCount) ? `<span>${t.recordCount} voter records</span>` : ""}</div><p>${state.assignmentErrors[t.territoryId] ? "Assignments could not be loaded" : assigned.length ? assigned.map((a) => e(rosterLabel(a.userId))).join(" · ") : mine ? "Your active assignment" : "No team assigned"}</p><footer><span>${assigned[0]?.startsAt ? date(assigned[0].startsAt) : "Published boundary"}</span><button type="button" class="text-button" data-fw-action="territory" data-id="${e(t.territoryId)}">View territory ${icon("arrow")}</button></footer></article>`;
            })
            .join("")}</div>`
        : empty(
            mine ? "No active areas assigned to you" : "No territories yet",
            mine
              ? "Ask a field organizer for your next area."
              : "Create territories from your coalition's authorized area.",
            canAuthor() && !mine
              ? button("New territory", "new-territory", "", true)
              : "",
          )
    }<footer class="field-context"><p>Door counts group residents at a shared location. Voter records are counted separately.</p></footer></section>`;
  }
  function assignmentsMarkup() {
    return `<section class="panel">${header("Team assignments", "Give every territory a named team. Manage membership and access in People.", button("Open People", "destination", 'data-destination="people"'))}${state.peopleError ? errorBox(state.peopleError, "retry-assignments") : ""}${
      !state.territories.length
        ? empty(
            "No territories yet",
            "Create an area before assigning your team.",
            canAuthor() ? button("New territory", "new-territory") : "",
          )
        : `<table class="field-table"><thead><tr><th>Territory</th><th>Assigned team</th><th>Assignment starts</th><th><span class="sr-only">Manage</span></th></tr></thead><tbody>${state.territories
            .map((t) => {
              const assigned = assignments(t.territoryId);
              return `<tr><td><button type="button" class="text-button" data-fw-action="territory" data-id="${e(t.territoryId)}"><strong>${e(t.name)}</strong><small>${e(t.status === "draft" ? "Draft boundary" : "Published boundary")}</small></button></td><td data-label="Assigned team">${state.assignmentErrors[t.territoryId] ? `<span role="alert">Assignments unavailable</span>${button("Retry", "retry-assignments")}` : assigned.length ? assigned.map((row) => personLabel(row.userId)).join("<br />") : badge("Unassigned", "unassigned")}</td><td data-label="Assignment starts">${date(assigned[0]?.startsAt)}</td><td><button type="button" class="icon-button" data-fw-action="assign" data-id="${e(t.territoryId)}" aria-label="Manage ${e(t.name)} assignment"${canAssign() ? "" : " disabled"}>${icon("edit")}</button></td></tr>`;
            })
            .join("")}</tbody></table>`
    }<footer class="field-context"><p>Follow-up tasks, sign deliveries, and approvals stay in Missions.</p><button type="button" class="text-button" data-fw-action="destination" data-destination="missions">Open Missions ${icon("arrow")}</button></footer></section>`;
  }
  function mapData() {
    return featureCollection(
      state.territories
        .filter((t) => t.geojson)
        .map((t) => ({
          type: "Feature",
          properties: {
            id: t.territoryId,
            name: t.name,
            mine: myIds().includes(t.territoryId),
          },
          geometry: t.geojson,
        })),
    );
  }
  function renderMapMessage() {
    const node = q("[data-fw-map-message]");
    if (!node) return;
    const message = state.mapError || state.mapDataError || state.mapMessage;
    node.setAttribute(
      "role",
      state.mapError || state.mapDataError ? "alert" : "status",
    );
    node.hidden = !message;
    node.innerHTML = message
      ? `<strong>${e(message)}</strong>${state.mapError || state.mapDataError ? button("Retry map", "retry-map") : ""}`
      : "";
  }
  async function mountMap() {
    if (state.layout !== "map" || !q("[data-fw-map-mount]")) return;
    if (mapCanvas) {
      q("[data-fw-map-mount]").append(mapCanvas);
      resizeMap();
      return;
    }
    mapCanvas = document.createElement("div");
    mapCanvas.className = "field-map-canvas";
    q("[data-fw-map-mount]").append(mapCanvas);
    const ticket = generation,
      epoch = ++mapEpoch;
    try {
      mapLibrary = await loadMapLibre();
      guard(ticket);
      if (epoch !== mapEpoch) return;
      const style = mapStyle?.();
      const layers =
        style && typeof style === "object" ? style.layers || [] : null;
      if (
        !style ||
        (layers && !layers.some((layer) => layer.type !== "background"))
      )
        state.mapError =
          "Street map imagery is unavailable. Voter records remain available in List view.";
      map = new mapLibrary.Map({
        container: mapCanvas,
        preserveDrawingBuffer: true,
        style,
        center: [-110.5, 46.8],
        zoom: 7,
        attributionControl: true,
      });
      map.on("load", () => {
        if (ticket !== generation || epoch !== mapEpoch) return;
        state.mapReady = true;
        map.addSource("field-territories", {
          type: "geojson",
          data: mapData(),
        });
        map.addLayer({
          id: "field-territories-fill",
          type: "fill",
          source: "field-territories",
          paint: { "fill-color": "#3b82f6", "fill-opacity": 0.13 },
        });
        map.addLayer({
          id: "field-territories-line",
          type: "line",
          source: "field-territories",
          paint: { "line-color": "#5ea1ff", "line-width": 2 },
        });
        map.on("click", "field-territories-fill", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (id) showTerritory(id);
        });
        fitMap();
        void queryMap();
      });
      map.on("moveend", () => {
        clearTimeout(queryTimer);
        queryTimer = setTimeout(() => void queryMap(), 200);
      });
      map.on("error", () => {
        if (ticket !== generation) return;
        state.mapError =
          "Some map imagery could not be loaded. You can still use voter records and territory outlines.";
        renderMapMessage();
      });
      observer = new ResizeObserver(resizeMap);
      observer.observe(mapCanvas);
      renderMapMessage();
    } catch (error) {
      if (!error.stale && ticket === generation) {
        state.mapError =
          "The street map could not be loaded. Use List view or retry.";
        renderMapMessage();
      }
    }
  }
  function resizeMap() {
    if (!map || !mapCanvas?.isConnected) return;
    const size = `${mapCanvas.clientWidth}:${mapCanvas.clientHeight}`;
    if (
      mapCanvas.clientWidth > 0 &&
      mapCanvas.clientHeight > 0 &&
      state.mapSize !== size
    ) {
      state.mapSize = size;
      map.resize();
    }
  }
  function fitMap() {
    if (!map) return;
    const selected =
      state.area === "all"
        ? state.territories
        : state.area === "mine"
          ? myTerritories()
          : state.territories.filter((t) => t.territoryId === state.area);
    const bounds = fieldBounds(
      selected,
      state.area === "all" && !selected.length ? state.voters : [],
    );
    if (bounds)
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 36, maxZoom: 16, duration: 0 },
      );
  }
  async function queryMap(force = false) {
    if (!map || !state.mapReady || state.key !== identity()) return;
    const b = map.getBounds(),
      bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const signature = `${bbox.map((value) => value.toFixed(6)).join(",")}:${Math.round(map.getZoom())}:${state.access?.assignmentTokenVersion || 0}`;
    if (!force && state.mapQuerySignature === signature) return;
    state.mapQuerySignature = signature;
    if (bbox[2] - bbox[0] > 8 || bbox[3] - bbox[1] > 8) {
      state.mapMessage = "Zoom in to load voters in this area.";
      state.points = [];
      state.households = [];
      state.clusters = [];
      renderMapMessage();
      renderResults();
      return;
    }
    const ticket = generation,
      queryKey = (state.mapRequestVersion = (state.mapRequestVersion || 0) + 1);
    state.mapLoading = true;
    try {
      const params = new URLSearchParams({
        bbox: bbox.join(","),
        zoom: String(Math.round(map.getZoom())),
        assignmentTokenVersion: String(
          state.access?.assignmentTokenVersion || 0,
        ),
      });
      const [voterResult, householdResult] = await Promise.allSettled([
        call(endpoint(`/voter-map/query?${params}`)),
        state.access?.capabilities?.householdMap === true
          ? call(
              `/api/contact-book/scopes/${encodeURIComponent(`coalition:${current().coalitionId}`)}/household-map`,
              {
                method: "POST",
                body: {
                  bounds: {
                    west: bbox[0],
                    south: bbox[1],
                    east: bbox[2],
                    north: bbox[3],
                  },
                },
              },
            )
          : Promise.resolve(null),
      ]);
      guard(ticket);
      if (queryKey !== state.mapRequestVersion) return;
      state.households = [];
      state.householdNotice = "";
      if (state.access?.capabilities?.householdMap === true) {
        if (householdResult.status === "fulfilled") {
          const householdPayload = householdResult.value;
          state.householdNotice =
            householdPayload.complete === false || householdPayload.zoomRequired
              ? "Household address results are partial. Zoom in for more detail."
              : "";
          state.households = rows(householdPayload, ["markers"]).filter(
            (row) => row.kind === "household" && fieldPoint(row),
          );
        } else {
          const error = householdResult.reason;
          if (error.stale) throw error;
          // The separately deployed household capability may not yet be enabled.
          // Never retain old markers after a failed current-access query.
          if (ticket === generation && queryKey === state.mapRequestVersion) {
            state.households = [];
            state.householdNotice =
              "Household addresses could not be loaded. Retry the map.";
          }
        }
      }
      if (voterResult.status === "rejected") throw voterResult.reason;
      const payload = voterResult.value;
      state.mapDataError = "";
      state.points = rows(payload, ["points", "items", "records"]).filter(
        (row) => row.kind !== "cluster" && row.recordId && fieldPoint(row),
      );
      state.clusters = [
        ...rows(payload, ["clusters"]),
        ...rows(payload, ["items"]).filter((row) => row.kind === "cluster"),
      ];
      state.mapPartial = Boolean(
        payload.precisionAdjusted ||
          payload.truncatedGeoCellQuery ||
          payload.ownerScanTruncated,
      );
      state.mapMessage = state.mapPartial
        ? "Map results are partial. Zoom in for more detail."
        : state.clusters.length
          ? "Select a cluster to zoom in and see voter records."
          : "";
      state.voters = state.voters.map((row) =>
        fieldVoter(
          row,
          state.points.find((point) => point.recordId === row.recordId),
        ),
      );
    } catch (error) {
      if (
        !error.stale &&
        ticket === generation &&
        queryKey === state.mapRequestVersion
      ) {
        state.mapDataError =
          error.message || "Voter map records could not be loaded.";
        if ([401, 403].includes(Number(error.status))) {
          state.points = [];
          state.clusters = [];
          if (Number(error.status) === 401) state.households = [];
        }
      }
    } finally {
      if (ticket === generation && queryKey === state.mapRequestVersion) {
        state.mapLoading = false;
        renderResults();
      }
    }
  }
  function updateMapMarkers() {
    if (!map || !mapLibrary) return;
    markers.forEach((marker) => marker.remove());
    markers = [];
    map.getSource?.("field-territories")?.setData(mapData());
    visibleHouseholds()
      .slice(0, 200)
      .forEach((row) => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "field-household-marker";
        node.textContent = "⌂";
        node.setAttribute(
          "aria-label",
          `Household: ${row.address?.addressLine1 || "address"}${row.reviewRequired ? ", needs review" : ""}`,
        );
        node.addEventListener("click", (event) => {
          event.stopPropagation();
          navigate(
            `/workspace/coalition/${encodeURIComponent(current().coalitionId)}/people/contacts?contactId=${encodeURIComponent(row.contactId)}`,
          );
        });
        markers.push(
          new mapLibrary.Marker({ element: node })
            .setLngLat([row.lng, row.lat])
            .addTo(map),
        );
        node.setAttribute("role", "button");
        node.setAttribute(
          "aria-label",
          `Household: ${row.address?.addressLine1 || "address"}${row.reviewRequired ? ", needs review" : ""}`,
        );
      });
    state.territories.forEach((row) => {
      const bounds = fieldBounds([row]);
      if (!bounds) return;
      const label = document.createElement("button");
      label.type = "button";
      label.className = "field-territory-label";
      label.textContent = row.name;
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        showTerritory(row.territoryId);
      });
      markers.push(
        new mapLibrary.Marker({ element: label })
          .setLngLat([(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
          .addTo(map),
      );
      label.setAttribute("aria-label", `View ${row.name} territory`);
    });
    results().forEach((row) => {
      const point = fieldPoint(row);
      if (!point) return;
      const node = document.createElement("button");
      node.type = "button";
      node.className = "field-voter-marker";
      node.dataset.status = row.status;
      node.setAttribute(
        "aria-label",
        `${row.name}, ${row.addressLine1}, ${fieldStatusLabels[row.status]}`,
      );
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        void showVoter(row.recordId);
      });
      markers.push(
        new mapLibrary.Marker({ element: node }).setLngLat(point).addTo(map),
      );
      node.setAttribute(
        "aria-label",
        `${row.name}, ${row.addressLine1}, ${fieldStatusLabels[row.status]}`,
      );
    });
    state.clusters.forEach((cluster) => {
      const point = fieldPoint(cluster);
      if (!point) return;
      const node = document.createElement("button");
      node.type = "button";
      node.className = "field-cluster-marker";
      node.textContent = String(cluster.count);
      node.setAttribute("aria-label", `${cluster.count} voters; zoom in`);
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        map.easeTo({ center: point, zoom: Math.min(map.getZoom() + 2, 20) });
      });
      markers.push(
        new mapLibrary.Marker({ element: node }).setLngLat(point).addTo(map),
      );
      node.setAttribute("aria-label", `${cluster.count} voters; zoom in`);
    });
  }
  function dialogHeader(title, subtitle = "", detail = false) {
    return `<header class="dialog-header"><div><span class="eyebrow">${e(subtitle || current()?.name || "Coalition")}</span>${detail ? "" : `<h2 id="fw-dialog-title">${e(title)}</h2>`}</div><button type="button" class="icon-button" data-fw-action="close-dialog" aria-label="Close ${e(title)}"${state.pending ? " disabled" : ""}>${icon("close")}</button></header>`;
  }
  function openDialog(kind, html, detail = false) {
    const node = q(detail ? "[data-fw-detail]" : "[data-fw-create]");
    q(detail ? "[data-fw-create]" : "[data-fw-detail]")?.close();
    node.innerHTML = html;
    node.setAttribute(
      "aria-labelledby",
      detail ? "fw-detail-title" : "fw-dialog-title",
    );
    if (!node.open) node.showModal();
    state.dialog = kind;
    void mountMiniMaps();
  }
  function closeDialog() {
    if (state.pending) return;
    q("dialog[open]")?.close();
    state.dialog = null;
    state.dialogError = "";
    builder.close();
  }
  async function showVoter(id) {
    state.selectedId = id;
    state.dialogError = "";
    const local =
      state.voters.find((row) => row.recordId === id) ||
      state.points.find((row) => row.recordId === id);
    if (local && !state.details[id])
      state.details[id] = fieldVoter(
        local,
        state.points.find((row) => row.recordId === id),
      );
    state.dialog = "voter";
    renderVoterDialog();
    try {
      const [record, notes] = await Promise.all([
        call(endpoint(`/voter-map/records/${encodeURIComponent(id)}`)),
        call(
          endpoint(
            `/voter-map/records/${encodeURIComponent(id)}/notes?limit=50`,
          ),
        ),
      ]);
      state.details[id] = fieldVoter(
        record.record || record,
        state.points.find((row) => row.recordId === id),
      );
      state.notes[id] = {
        items: rows(notes, ["items", "notes"]),
        nextCursor: text(notes.nextCursor),
      };
      if (state.dialog === "voter" && state.selectedId === id)
        renderVoterDialog();
    } catch (error) {
      if (!error.stale && state.selectedId === id) {
        state.dialogError =
          error.message || "Voter details could not be loaded.";
        renderVoterDialog();
      }
    }
  }
  function renderVoterDialog() {
    if (state.dialog !== "voter") return;
    const row = state.details[state.selectedId],
      t = row && state.territories.find((area) => fieldInTerritory(row, area)),
      notes = state.notes[state.selectedId];
    if (!row)
      return openDialog(
        "voter",
        `${dialogHeader("Voter details", "Voter record", true)}<div class="dialog-body"><h2 id="fw-detail-title">Loading voter details</h2>${state.dialogError ? errorBox(state.dialogError, "retry-voter") : ""}</div>`,
        true,
      );
    const draft = state.drafts[row.recordId] || {
      body: "",
      contactType: "other",
    };
    openDialog(
      "voter",
      `${dialogHeader("voter details", `Voter record${t ? ` · ${t.name}` : ""}`, true)}<div class="dialog-body"><h2 id="fw-detail-title">${e(row.name)}</h2><p>${e(row.addressLine1 || "Address unavailable")}<br />${e([row.city, row.state, row.postalCode].filter(Boolean).join(" "))}</p>${badge(fieldStatusLabels[row.status], row.status)}${state.dialogError ? errorBox(state.dialogError, "retry-voter") : ""}<div class="field-detail-meta"><div><span>Territory</span><strong>${e(t?.name || "Not in a loaded territory")}</strong></div><div><span>Available contact</span><strong>${e([row.phone || row.hasPhone ? "Phone" : "", row.email || row.hasEmail ? "Email" : ""].filter(Boolean).join(" · ") || "No shared contact method")}</strong></div></div><section class="field-section"><h3>Field context</h3><p>${e(t?.instructions || state.access?.volunteerMessage || "Confirm field instructions with your organizer before starting.")}</p><div class="note-box"><strong>Outreach status is separate from a door visit</strong><p>The pin shows contact outreach availability. Visit history, safety checks, and canvassing outcomes are handled in Doorknocker.</p></div></section><section class="field-section"><div class="section-heading"><h3>Voter notes</h3><span>${notes ? `${notes.items.length} ${notes.items.length === 1 ? "note" : "notes"}` : "Loading notes…"}</span></div>${(notes?.items || []).map((note) => `<article class="field-note"><strong>${e(note.contactType || "General")} note</strong><p>${e(note.body || note.preview)}</p><small>${e(note.author?.displayName || note.authorDisplayName || "Coalition member")} · ${e(date(note.createdAtIso || note.createdAt))}</small></article>`).join("")}${notes?.nextCursor ? button("Load more notes", "more-notes") : ""}<form data-fw-form="note"><label class="field"><span>Add a note</span><textarea name="body" rows="3" maxlength="4000" required placeholder="Add useful context for your team…">${e(draft.body)}</textarea></label><div class="note-actions"><label class="field"><span>Contact type</span><select name="contactType">${[
        ["other", "General"],
        ["phoneCall", "Phone"],
        ["textMessage", "Text"],
        ["mailEmail", "Email"],
        ["doorKnock", "In person"],
      ]
        .map(
          ([key, label]) =>
            `<option value="${key}"${draft.contactType === key ? " selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label><button type="submit" class="secondary-button"${state.pending ? " disabled" : ""}>${state.pending === "note" ? "Saving…" : "Save note"}</button></div></form></section>${row.contactId ? `<div class="field-hand-off"><div><strong>One contact record across your workspace</strong><p>Contact maintenance stays in Contacts. Coalition membership and team permissions stay in People.</p></div>${button("Open contact", "destination", `data-destination="contacts" data-contact-id="${e(row.contactId)}"`)}</div>` : ""}</div><footer class="dialog-footer">${t ? button("View territory", "territory", `data-id="${e(t.territoryId)}"`) : ""}${button(`Open in Doorknocker ${icon("arrow")}`, "doorknocker", `data-id="${e(t?.territoryId || "")}" data-record-id="${e(row.recordId)}"`, true)}</footer>`,
      true,
    );
  }
  function showTerritory(id) {
    const t = territory(id);
    if (!t) return;
    state.selectedTerritoryId = id;
    state.dialog = "territory";
    const assigned = assignments(id);
    openDialog(
      "territory",
      `${dialogHeader("territory details", "Territory details", true)}<div class="dialog-body"><h2 id="fw-detail-title">${e(t.name)}</h2><p>${e(t.description)}</p><div class="detail-badges">${badge(t.status === "draft" ? "Draft" : "Published", t.status)}${badge(assigned.length || myIds().includes(id) ? "Team assigned" : "Unassigned", assigned.length || myIds().includes(id) ? "assigned" : "unassigned")}</div>${miniMap(t)}<section class="field-section"><div class="section-heading"><h3>Assigned team</h3>${canAssign() ? '<button type="button" class="text-button" data-fw-action="assign" data-id="' + e(id) + '">Manage</button>' : ""}</div>${state.assignmentErrors[id] ? errorBox(state.assignmentErrors[id], "retry-assignments") : assigned.length ? assigned.map((row) => personLabel(row.userId)).join("") : myIds().includes(id) ? "<p>Your active assignment</p>" : "<p>No team assigned.</p>"}</section>${canAuthor() ? `<section class="field-section"><h3>Territory boundary</h3><p>Adjust this area while preserving its field plan.</p>${button(`${icon("edit")} Edit boundary`, "edit-boundary", `data-id="${e(id)}"`)}</section>` : ""}<section class="field-section"><h3>Field instructions</h3><p>${e(t.instructions || state.access?.volunteerMessage || "Confirm field instructions with your organizer.")}</p></section><div class="field-hand-off"><div><strong>Field follow-ups</strong><p>Checklists, sign deliveries, and completion review stay in Missions.</p></div>${button("Open Missions", "destination", 'data-destination="missions"')}</div>${readinessNotice()}</div><footer class="dialog-footer">${button("View on map", "view-area", `data-id="${e(id)}"`)}${button(`Open in Doorknocker ${icon("arrow")}`, "doorknocker", `data-id="${e(id)}"`, true)}</footer>`,
      true,
    );
  }
  function assignmentDialog(id = "") {
    if (!canAssign()) return;
    const selected = territory(id) || state.territories[0];
    if (!selected) {
      notice("Create a territory before assigning your team.");
      return;
    }
    state.assignmentTerritoryId = selected.territoryId;
    state.dialogError = "";
    const assigned = assignments(selected.territoryId);
    openDialog(
      "assignment",
      `${dialogHeader("Assign territory", "Choose the people who will work this area. Membership stays in People.")}<form data-fw-form="assignment"><div class="dialog-body"><label class="field"><span>Territory</span><select name="territoryId" data-fw-assignment-territory>${state.territories.map((t) => `<option value="${e(t.territoryId)}"${t.territoryId === selected.territoryId ? " selected" : ""}>${e(t.name)}</option>`).join("")}</select></label>${state.peopleError ? errorBox(state.peopleError, "retry-assignments") : ""}${state.assignmentErrors[selected.territoryId] ? errorBox(state.assignmentErrors[selected.territoryId], "retry-assignments") : ""}<label class="field"><span>Find a team member</span><input type="search" data-fw-person-search placeholder="Search name or @username" /></label><fieldset class="field-section"><legend>Assigned people</legend><div class="assignment-people">${state.people
        .map(
          (p) =>
            `<label data-fw-person="${e(`${p.name} ${p.username}`.toLowerCase())}"><span class="avatar">${e(
              p.name
                .split(" ")
                .slice(0, 2)
                .map((part) => part[0])
                .join(""),
            )}</span><span>${e(p.name)}${p.userId === current().userId ? " · You" : ""}<small>${e(p.username ? `@${p.username}` : p.role)}</small></span><input type="checkbox" name="people" value="${e(p.userId)}"${assigned.some((row) => row.userId === p.userId) ? " checked" : ""} /></label>`,
        )
        .join(
          "",
        )}</div></fieldset><div class="note-box"><strong>Assignments follow the active boundary</strong><p>Removing an assignment does not remove the person's coalition membership.</p></div><div role="alert" data-fw-dialog-error></div></div><footer class="dialog-footer">${button("Cancel", "close-dialog")}<button type="submit" class="primary-button"${state.peopleError || state.assignmentErrors[selected.territoryId] || state.pending ? " disabled" : ""}>Save assignment</button></footer></form>`,
    );
  }
  function dataDialog(mode = "menu") {
    if (!isAdmin()) return;
    state.dataMode = mode;
    const manual = state.manual || {},
      imp = state.import;
    const field = (name, label, type = "text") =>
      `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${e(manual[name])}"${name === "name" ? " required" : ""} maxlength="200" /></label>`;
    let body;
    if (mode === "add")
      body = `<form data-fw-form="manual"><div class="dialog-body form-grid">${field("name", "Full name")}${field("phone", "Phone", "tel")}${field("addressLine1", "Street address")}${field("addressLine2", "Address line 2")}${field("city", "City")}${field("state", "State")}${field("postalCode", "ZIP code")}${field("email", "Email", "email")}<div class="note-box full-width"><strong>One scoped voter record</strong><p>Check the name and address before adding a voter. Matches are reviewed before replacing an existing record.</p></div><div class="full-width" role="alert" data-fw-dialog-error>${e(state.dialogError)}</div>${state.duplicate ? `<div class="note-box warning full-width"><strong>A matching voter already exists</strong><p>${e(state.duplicate.existing?.displayName || state.duplicate.existing?.name || "Existing voter")}</p><div class="note-actions">${button("Keep existing voter", "duplicate-skip")}${button("Replace existing voter", "duplicate-replace")}</div></div>` : ""}</div><footer class="dialog-footer">${button("Back", "manage-data")}<button type="submit" class="primary-button"${state.pending ? " disabled" : ""}>${state.pending === "manual" ? "Saving…" : "Add voter"}</button></footer></form>`;
    else if (mode === "import")
      body = `<form data-fw-form="import-preview"><div class="dialog-body"><p>Choose a CSV file, review recognized fields and duplicate records, then start the import.</p><label class="field"><span>CSV file</span><input type="file" name="csvFile" accept=".csv,text/csv" required /></label><p>Supported columns include name, addressLine1, city, state, postalCode, phone and email. Header aliases are matched by the import service.</p><div role="alert" data-fw-dialog-error>${e(state.dialogError)}</div>${imp.preview ? importPreviewMarkup(imp.preview) : ""}${imp.job ? importStatusMarkup(imp.job) : ""}</div><footer class="dialog-footer">${button("Back", "manage-data")}<button type="submit" class="secondary-button"${state.pending ? " disabled" : ""}>Preview import</button>${imp.uploadId && imp.preview && !imp.job ? button("Start import", "import-start", state.pending || imp.preview.summary?.truncated ? "disabled" : "", true) : ""}</footer></form>`;
    else
      body = `<div class="dialog-body"><p>Keep voter data maintenance close to the map, without a second voter-list page.</p><div class="field-hand-off"><div><strong>Add a voter</strong><p>Create a scoped record with validation and duplicate review.</p></div>${button("Add voter", "add-voter")}</div><div class="field-hand-off"><div><strong>Import voter records</strong><p>Review recognized columns, duplicates, and import progress.</p></div>${button("Preview import", "import-voters")}</div><div class="field-hand-off"><div><strong>Maintain existing contacts</strong><p>Use the shared contact book rather than a second contact record.</p></div>${button("Open Contacts", "destination", 'data-destination="contacts"')}</div></div><footer class="dialog-footer">${button("Done", "close-dialog", "", true)}</footer>`;
    openDialog(
      "data",
      `${dialogHeader(mode === "add" ? "Add voter" : mode === "import" ? "Import voter records" : "Manage voter data")}${body}`,
    );
  }
  function importPreviewMarkup(preview) {
    const s = preview.summary || {};
    return `<section class="field-section"><h3>Review & match</h3><div class="field-detail-meta">${[
      ["Rows", s.totalRows],
      ["Valid rows", s.validRows],
      ["Invalid rows", s.invalidRows],
      ["Existing duplicates", s.duplicateExistingRows],
    ]
      .map(
        ([label, count]) =>
          `<div><span>${label}</span><strong>${Number(count) || 0}</strong></div>`,
      )
      .join(
        "",
      )}</div>${s.truncated ? '<p role="alert">This file exceeds the preview limit. Split it into smaller files before importing.</p>' : ""}<label class="field"><span>Duplicate records</span><select data-fw-duplicate-mode><option value="skip"${state.import.duplicateMode !== "replace" ? " selected" : ""}>Keep existing records</option><option value="replace"${state.import.duplicateMode === "replace" ? " selected" : ""}>Replace existing records</option></select></label>${rows(
      preview,
      ["items"],
    )
      .slice(0, 8)
      .map(
        (row) =>
          `<div class="field-note"><strong>${e(row.displayName || "Unnamed row")}</strong><p>${e(row.addressLine1)} · ${e(text(row.status).replaceAll("_", " "))}</p>${row.reason ? `<small>${e(row.reason)}</small>` : ""}</div>`,
      )
      .join("")}</section>`;
  }
  function importStatusMarkup(job) {
    return `<section class="field-section"><h3>Import status</h3>${badge(text(job.status) || "Queued")}<p>${Number(job.importedCount || job.processedCount || 0)} records processed · ${Number(job.skippedDuplicateCount || 0)} duplicates skipped · ${Number(job.errorCount || job.failedCount || 0)} failed</p>${job.error ? `<p role="alert">${e(job.error)}</p>` : ""}${button("Refresh status", "import-status")}</section>`;
  }
  function renderDialog() {
    if (state.dialog === "voter") renderVoterDialog();
    else if (state.dialog === "territory")
      showTerritory(state.selectedTerritoryId);
    else if (state.dialog === "assignment")
      assignmentDialog(state.assignmentTerritoryId);
    else if (state.dialog === "data") dataDialog(state.dataMode);
  }
  async function mutate(kind, fn) {
    if (state.pending || state.key !== identity()) return false;
    const ticket = generation;
    state.pending = kind;
    state.dialogError = "";
    host
      ?.querySelectorAll('dialog[open] button[type="submit"]')
      .forEach((node) => {
        node.disabled = true;
      });
    try {
      await readAccess();
      guard(ticket);
      await fn(ticket);
      guard(ticket);
      return true;
    } catch (error) {
      if (!error.stale && ticket === generation) {
        state.dialogError = error.message || "This change could not be saved.";
        const node = q("[data-fw-dialog-error]");
        if (node) node.textContent = state.dialogError;
        else notice(state.dialogError);
      }
      return false;
    } finally {
      if (ticket === generation) {
        state.pending = "";
        host
          ?.querySelectorAll('dialog[open] button[type="submit"]')
          .forEach((node) => {
            node.disabled = false;
          });
      }
    }
  }
  async function saveNote(form) {
    const id = state.selectedId,
      submittedBody = String(form.get("body") || ""),
      payload = {
        body: text(form.get("body")),
        contactType: text(form.get("contactType")),
        tags: [],
      };
    if (!payload.body) return;
    const saved = await mutate("note", async () => {
      const result = await call(
        endpoint(`/voter-map/records/${encodeURIComponent(id)}/notes`),
        { method: "POST", body: payload },
      );
      state.notes[id] ||= { items: [] };
      state.notes[id].items.unshift(result.note || result);
      if (state.drafts[id]?.body === submittedBody)
        state.drafts[id] = { body: "", contactType: payload.contactType };
    });
    if (saved) {
      renderVoterDialog();
      notice("Note saved.");
    } else renderVoterDialog();
  }
  async function saveAssignment(form) {
    const id = text(form.get("territoryId")),
      selected = form.getAll("people").map(text);
    const saved = await mutate("assignment", async () => {
      if (!canAssign())
        throw new Error("You no longer have permission to manage assignments.");
      const live = await call(
        endpoint(
          `/voter-map/territories/${encodeURIComponent(id)}/assignments`,
        ),
      );
      state.assignments[id] = rows(live, ["assignments", "items"]);
      delete state.assignmentErrors[id];
      const previous = assignments(id);
      if (selected.some((userId) => !person(userId)))
        throw new Error(
          "A selected team member is no longer eligible. Reload the roster.",
        );
      try {
        for (const userId of selected.filter(
          (value) => !previous.some((row) => row.userId === value),
        ))
          await call(
            endpoint(
              `/voter-map/territories/${encodeURIComponent(id)}/assignments`,
            ),
            { method: "POST", body: { userId } },
          );
        for (const row of previous.filter(
          (entry) => !selected.includes(entry.userId),
        ))
          await call(
            endpoint(
              `/voter-map/territories/${encodeURIComponent(id)}/assignments/${encodeURIComponent(row.assignmentId)}/revoke`,
            ),
            { method: "POST", body: { userId: row.userId } },
          );
      } finally {
        try {
          const latest = await call(
            endpoint(
              `/voter-map/territories/${encodeURIComponent(id)}/assignments`,
            ),
          );
          state.assignments[id] = rows(latest, ["assignments", "items"]);
        } catch (error) {
          if (!error.stale)
            state.assignmentErrors[id] =
              "Assignments changed, but their latest state could not be loaded. Retry before making another change.";
        }
      }
      await loadProgress();
    });
    if (saved) {
      state.pending = "";
      closeDialog();
      render();
      notice("Territory assignment saved.");
    }
  }
  async function saveManual(form, duplicateMode = "") {
    const payload = duplicateMode
      ? { ...state.manual, duplicateMode }
      : Object.fromEntries(
          [
            "name",
            "addressLine1",
            "addressLine2",
            "city",
            "state",
            "postalCode",
            "phone",
            "email",
          ].map((key) => [key, text(form.get(key))]),
        );
    state.manual = payload;
    state.duplicate = null;
    const saved = await mutate("manual", async () => {
      if (!isAdmin())
        throw new Error("You no longer have permission to add voter records.");
      try {
        await call(endpoint("/voters/manual"), {
          method: "POST",
          body: payload,
        });
      } catch (error) {
        if (Number(error.status) === 409 && error.payload?.existing)
          state.duplicate = { existing: error.payload.existing };
        throw error;
      }
      await loadVoters();
      if (state.mapReady) await queryMap(true);
    });
    if (saved) {
      state.pending = "";
      closeDialog();
      state.manual = {};
      render();
      notice(
        duplicateMode === "skip" ? "Existing voter kept." : "Voter saved.",
      );
    } else if (state.duplicate) dataDialog("add");
  }
  async function previewImport(form) {
    const file = form.get("csvFile");
    if (!(file instanceof File) || !file.name) return;
    await mutate("import-preview", async (ticket) => {
      if (!isAdmin())
        throw new Error("You no longer have permission to import voters.");
      const upload = await call(endpoint("/voter-imports/upload"), {
        method: "POST",
        body: { fileName: file.name, contentType: "text/csv" },
      });
      const target = new URL(upload.upload?.uploadUrl || upload.uploadUrl);
      if (target.protocol !== "https:" && target.origin !== location.origin)
        throw new Error("The upload destination is invalid.");
      guard(ticket);
      const response = await fetch(target.href, {
        method: "PUT",
        headers: upload.upload?.headers || { "content-type": "text/csv" },
        body: file,
      });
      guard(ticket);
      if (!response.ok)
        throw new Error("The CSV upload failed. Choose the file and retry.");
      const preview = await call(endpoint("/voter-imports/preview"), {
        method: "POST",
        body: { uploadId: upload.uploadId },
      });
      state.import = {
        uploadId: upload.uploadId,
        fileName: file.name,
        preview,
        duplicateMode: "skip",
      };
    });
    dataDialog("import");
  }
  async function startImport() {
    const saved = await mutate("import-start", async () => {
      if (
        !isAdmin() ||
        !state.import.uploadId ||
        state.import.preview?.summary?.truncated
      )
        throw new Error("Review a complete CSV preview before importing.");
      const payload = await call(endpoint("/voter-imports"), {
        method: "POST",
        body: {
          uploadId: state.import.uploadId,
          duplicateMode: state.import.duplicateMode || "skip",
          originalFileName: state.import.fileName,
        },
      });
      state.import.importId = text(payload.importId);
      state.import.job = { status: "queued" };
    });
    if (saved) {
      dataDialog("import");
      void importStatus();
    }
  }
  async function importStatus() {
    if (!state.import.importId) return;
    try {
      const payload = await call(
        endpoint(`/voter-imports/${encodeURIComponent(state.import.importId)}`),
      );
      state.import.job = payload.job || payload;
      if (state.dialog === "data" && state.dataMode === "import")
        dataDialog("import");
      const terminal = [
        "complete",
        "completed",
        "failed",
        "cancelled",
        "completed_with_errors",
      ].includes(text(state.import.job.status).toLowerCase());
      if (terminal) {
        await loadVoters();
        if (state.mapReady) await queryMap(true);
      } else {
        clearTimeout(importTimer);
        importTimer = setTimeout(() => void importStatus(), 3000);
      }
    } catch (error) {
      if (!error.stale) {
        state.dialogError =
          error.message || "Import status could not be loaded.";
        if (state.dialog === "data") dataDialog("import");
      }
    }
  }
  async function onClick(event) {
    const node = event.target.closest("[data-fw-action]");
    if (!node || !host.contains(node)) return;
    event.stopPropagation();
    const action = node.dataset.fwAction,
      id = text(node.dataset.id);
    if (node.disabled) return;
    if (action === "view") {
      state.view = node.dataset.view;
      render();
      q('[role="tab"][aria-selected="true"]')?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    } else if (action === "layout") {
      state.layout = node.dataset.layout;
      render();
      if (state.layout === "list") void loadVoters();
    } else if (action === "clear-filters") {
      state.query = "";
      state.area = "all";
      state.outreach = "all";
      render();
      void loadVoters();
    } else if (action === "retry") void load({ refresh: true });
    else if (action === "retry-voters" || action === "load-more")
      void loadVoters({ append: action === "load-more" });
    else if (action === "retry-progress") {
      await loadProgress();
      render();
    } else if (action === "retry-assignments") {
      await Promise.all([loadPeople(), loadAssignments()]);
      render();
      if (state.dialog === "assignment")
        assignmentDialog(state.assignmentTerritoryId);
    } else if (action === "retry-households") {
      await queryMap(true);
    } else if (action === "retry-map") {
      state.mapError = "";
      state.mapQuerySignature = "";
      state.mapSize = "";
      map?.remove();
      map = null;
      mapCanvas = null;
      state.mapReady = false;
      renderResults();
    } else if (action === "zoom-in") map?.zoomIn();
    else if (action === "zoom-out") map?.zoomOut();
    else if (action === "fit") fitMap();
    else if (action === "voter" || action === "retry-voter")
      void showVoter(id || state.selectedId);
    else if (action === "territory") showTerritory(id);
    else if (action === "view-area") {
      closeDialog();
      state.area = id;
      state.view = "map";
      state.layout = "map";
      render();
      fitMap();
    } else if (action === "assign") assignmentDialog(id);
    else if (action === "close-dialog") closeDialog();
    else if (action === "manage-data") dataDialog();
    else if (action === "add-voter") dataDialog("add");
    else if (action === "import-voters") dataDialog("import");
    else if (action === "duplicate-skip" || action === "duplicate-replace")
      void saveManual(
        new FormData(),
        action === "duplicate-skip" ? "skip" : "replace",
      );
    else if (action === "import-start") void startImport();
    else if (action === "import-status") void importStatus();
    else if (action === "new-territory" || action === "edit-boundary") {
      if (!canAuthor()) return;
      closeDialog();
      await builder.open(action === "edit-boundary" ? territory(id) : null);
    } else if (action === "more-notes") {
      const notes = state.notes[state.selectedId];
      if (!notes?.nextCursor) return;
      try {
        const payload = await call(
          endpoint(
            `/voter-map/records/${encodeURIComponent(state.selectedId)}/notes?limit=50&cursor=${encodeURIComponent(notes.nextCursor)}`,
          ),
        );
        notes.items.push(...rows(payload, ["items", "notes"]));
        notes.nextCursor = text(payload.nextCursor);
        renderVoterDialog();
      } catch (error) {
        if (!error.stale) {
          state.dialogError = error.message;
          renderVoterDialog();
        }
      }
    } else if (action === "geocode-credits") {
      navigate(
        `/workspace/coalition/${encodeURIComponent(current().coalitionId)}/people/contacts?geocoding=1`,
      );
    } else if (action === "destination") {
      const base = `/coalitions/${encodeURIComponent(current().coalitionId)}`,
        destination = node.dataset.destination;
      const route =
        destination === "people"
          ? `${base}/members`
          : destination === "contacts"
            ? `/workspace/coalition/${encodeURIComponent(current().coalitionId)}/people/contacts${node.dataset.contactId ? `?contactId=${encodeURIComponent(node.dataset.contactId)}` : ""}`
            : `${base}/${destination}`;
      closeDialog();
      navigate(route);
    } else if (action === "doorknocker") {
      openApp?.(
        `/coalitions/${encodeURIComponent(current().coalitionId)}/voter-map/door-knocker`,
      );
    }
  }
  function onInput(event) {
    const node = event.target;
    if (node.matches("[data-fw-search]")) {
      state.query = node.value;
      renderResults();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void loadVoters(), 250);
    } else if (node.matches("[data-fw-person-search]"))
      host.querySelectorAll("[data-fw-person]").forEach((item) => {
        item.hidden = !item.dataset.fwPerson.includes(
          node.value.toLowerCase().trim(),
        );
      });
    else if (node.closest('[data-fw-form="note"]')) {
      const form = new FormData(node.form);
      state.drafts[state.selectedId] = {
        body: String(form.get("body") || ""),
        contactType: text(form.get("contactType")),
      };
    } else if (node.closest('[data-fw-form="manual"]'))
      state.manual = Object.fromEntries(new FormData(node.form));
  }
  function onChange(event) {
    const node = event.target;
    if (node.matches("[data-fw-area]")) {
      state.area = node.value;
      renderResults();
      fitMap();
    } else if (node.matches("[data-fw-outreach]")) {
      state.outreach = node.value;
      renderResults();
    } else if (node.matches("[data-fw-assignment-territory]"))
      assignmentDialog(node.value);
    else if (node.matches("[data-fw-duplicate-mode]"))
      state.import.duplicateMode = node.value;
    else onInput(event);
  }
  function onSubmit(event) {
    const form = event.target.closest("[data-fw-form]");
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData(form);
    if (form.dataset.fwForm === "note") void saveNote(data);
    else if (form.dataset.fwForm === "assignment") void saveAssignment(data);
    else if (form.dataset.fwForm === "manual") void saveManual(data);
    else if (form.dataset.fwForm === "import-preview") void previewImport(data);
  }
  function onKeydown(event) {
    if (
      event.target.getAttribute("role") !== "tab" ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const entries = tabs(),
      index = entries.findIndex(([key]) => key === state.view);
    state.view =
      entries[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? entries.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + entries.length) %
              entries.length
      ][0];
    render();
    q('[role="tab"][aria-selected="true"]')?.focus();
  }
  const builder = createCoalitionFieldWorkBuilder({
    context: () =>
      canAuthor() && state.key === identity()
        ? {
            userId: current().userId,
            scopeType: "coalition",
            scopeId: current().coalitionId,
            sessionKey: current().sessionKey,
            ...(current().contactSelectionId && current().ballotChase
              ? {
                  contactSelectionId: current().contactSelectionId,
                  ballotChase: current().ballotChase,
                }
              : {}),
          }
        : null,
    request: call,
    loadMapLibre,
    mapStyle,
    dialog: () => q("[data-fw-create]"),
    canAuthor,
    refreshAccess: readAccess,
    onClose: () => {
      state.dialog = null;
    },
    onPublished: async () => {
      state.view = "territories";
      await load({ refresh: true });
      notice("Territories published.");
    },
    onFallback: onBuilderOpen,
  });
  return { markup, mount, load, reset, beforeRender };
}
