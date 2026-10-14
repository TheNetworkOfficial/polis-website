import {
  createTerritoryBuilderModel,
  geometryBounds,
  pointInGeometry,
  polygonFromPoints,
  combineTrims,
  translateGeometry,
  sampledGeometryVertices,
  hasCompleteAssignments,
  publishBlockReason,
  sourceReady,
} from "./territoryBuilderModel";
import { escapeText as e } from "./textingWorkspaceUi";
import "../css/territory-builder.css";

const clone = (value) => JSON.parse(JSON.stringify(value));
const feature = (geometry, properties = {}) => ({
  type: "Feature",
  geometry,
  properties,
});
const collection = (features) => ({ type: "FeatureCollection", features });
const selected = (state) =>
  state.draft.territories.find((t) => t.id === state.selectedId);
const polygons = (geometry) =>
  geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
const icons = {
  back: '<path d="m14 7-5 5 5 5M9 12h12"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  select: '<path d="m5 3 14 9-7 1-3 7z"/>',
  draw: '<path d="m4 17 0 3 3 0L20 7l-3-3zM14 7l3 3"/>',
  trim: '<path d="M7 3v14h14M3 7h14v14"/>',
  move: '<path d="M12 3v18M3 12h18m-12-6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  undo: '<path d="m7 4-4 4 4 4M3 8h10a7 7 0 0 1 0 14"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  pan: '<path d="M8 13V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10c0 4-3 6-7 6h-1c-2 0-3-1-5-3l-4-6a2 2 0 0 1 3-2l2 2"/>',
  users:
    '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m2-18a4 4 0 0 1 0 8m1 4a5 5 0 0 1 3 4v2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6ZM8 12l3 3 5-6"/>',
  area: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  sparkles:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  pencil: '<path d="m4 16 12-12 4 4L8 20H4ZM14 6l4 4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.select}</svg>`;

/** A persistent map child survives the shared shell's unrelated rerenders. */
export function createTerritoryBuilder({
  request,
  context,
  mapLoader,
  mapStyle,
  navigate,
  confirm,
  openExisting,
  openContacts,
}) {
  let host,
    map,
    mapLibrary,
    mapLoading = false,
    mapReady = false,
    mapError = "",
    mapGeneration = 0;
  let tool = "select",
    method = "auto",
    drawing = [],
    handles = [],
    labels = [],
    fitKey = "",
    drag = null,
    reviewOpen = false,
    viewportTimer,
    dialog = null;
  const model = createTerritoryBuilderModel({
    request,
    context,
    changed: (_, kind) => (kind === "viewport" ? renderViewport() : render()),
  });
  const button = (
    action,
    label,
    { value = "", primary = false, disabled = false, pressed, title } = {},
  ) =>
    `<button type="button" data-tb-action="${e(action)}" data-value="${e(value)}"${primary ? ' class="tb-primary"' : ""}${disabled || model.state.busy ? " disabled" : ""}${pressed === undefined ? "" : ` aria-pressed="${pressed}"`}${title ? ` aria-label="${e(title)}" title="${e(title)}"` : ""}>${label}</button>`;
  const stateKey = () => {
    const c = context();
    return c?.userId
      ? `${c.userId}:${c.scopeType}:${c.scopeId}${c.contactSelectionId ? `:${c.contactSelectionId}:${c.ballotChase?.snapshotId || ""}` : ""}`
      : "";
  };

  function destroyMap() {
    window.removeEventListener("pointerup", onMapUp);
    window.removeEventListener("pointercancel", cancelMapDrag);
    window.removeEventListener("blur", cancelMapDrag);
    clearTimeout(viewportTimer);
    mapGeneration++;
    handles.forEach((h) => h.remove());
    handles = [];
    labels.forEach((label) => label.remove());
    labels = [];
    map?.remove();
    map = null;
    mapReady = false;
    mapLoading = false;
    fitKey = "";
    drag = null;
  }
  function reset() {
    destroyMap();
    model.reset();
    host?.remove();
    host = null;
    tool = "select";
    drawing = [];
    reviewOpen = false;
    mapError = "";
    dialog = null;
  }
  function shell() {
    return `<section class="territory-builder" aria-label="Territory builder">
      <header class="tb-header"><button type="button" data-tb-action="back" aria-label="Back to voter map">${icon("back")}</button><div><h2>Territories</h2><span data-tb-scope></span></div><span class="tb-draft-badge" data-tb-draft></span><div data-tb-save></div>${button("access", icon("shield"), { title: "Your map access" })}</header>
      <nav class="tb-steps" aria-label="Territory setup" data-tb-steps></nav>
      <div class="tb-filters" role="group" aria-label="Address exclusions" data-tb-filters></div>
      <div class="tb-alert" role="alert" data-tb-error hidden></div>
      <div class="tb-workspace"><div class="tb-map-wrap"><div class="tb-map" data-tb-map aria-label="Territory planning map"></div><div class="tb-map-top"><span data-tb-map-title></span>${button("fit", icon("fit"), { title: "Fit map" })}</div><div class="tb-map-tools" data-tb-tools></div><div class="tb-map-hint" role="status" data-tb-hint></div><div class="tb-map-bottom"><span>● Address locations</span><div>${button("zoom-out", "−", { title: "Zoom out" })}${button("zoom-in", "+", { title: "Zoom in" })}</div></div></div>
      <aside class="tb-panel" aria-label="Territory controls" data-tb-panel></aside></div>
      <footer class="tb-footer"><div data-tb-status role="status" aria-live="polite"></div><div data-tb-next></div></footer>
      <div data-tb-review></div></section>`;
  }
  function mount(root) {
    const placeholder = root.querySelector("[data-territory-builder-host]");
    const key = stateKey();
    if (
      !placeholder &&
      root.querySelector("[data-territory-legacy]") &&
      key &&
      host &&
      model.state.key === key
    )
      return;
    if (!placeholder || !key) {
      reset();
      return;
    }
    if (host && model.state.key && model.state.key !== key) reset();
    if (!host) {
      host = document.createElement("div");
      host.innerHTML = shell();
      host.addEventListener("click", onClick);
      host.addEventListener("change", onChange);
      host.addEventListener("input", (event) => {
        if (event.target.hasAttribute("data-tb-count"))
          q(".tb-count output").value = event.target.value;
      });
      host.addEventListener("keydown", (event) => {
        if ((reviewOpen || dialog) && event.key === "Tab") {
          const focusable = [
            ...q(".tb-dialog").querySelectorAll(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
            ),
          ];
          const first = focusable[0],
            last = focusable.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === q(".tb-dialog"))
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === q(".tb-dialog"))
          ) {
            event.preventDefault();
            first?.focus();
          }
        }
        if (event.key === "Escape") {
          cancelMapDrag();
          drawing = [];
          tool = "select";
          reviewOpen = false;
          dialog = null;
          render();
        }
      });
    }
    placeholder.replaceWith(host);
    map?.resize();
    void model.load();
    render();
  }
  const q = (selector) => host?.querySelector(selector);
  function render() {
    if (!host || !host.isConnected) return;
    const s = model.state,
      c = context();
    if (s.key && s.key !== stateKey()) {
      reset();
      return;
    }
    q("[data-tb-scope]").textContent =
      c?.label || (c?.scopeType === "candidate" ? "Campaign" : "Organization");
    q("[data-tb-draft]").textContent = s.published
      ? "Published"
      : s.dirty
        ? "Unsaved draft"
        : s.bootstrap?.published
          ? "Published"
          : "Draft";
    q("[data-tb-save]").innerHTML = button(
      "save",
      s.busy === "draft" ? "Saving…" : "Save draft",
      { disabled: !s.loaded || !s.draft.areaGeojson || Boolean(s.published) },
    );
    q("[data-tb-steps]").innerHTML = ["area", "cut", "assign"]
      .map(
        (step, index) =>
          `<button type="button" data-tb-action="step" data-value="${step}"${s.step === step ? ' aria-current="step"' : ""}${s.busy || !s.loaded || (step !== "area" && !s.draft.areaGeojson) || (step === "assign" && !s.draft.territories.length) ? " disabled" : ""}><span>${index + 1}</span>${step[0].toUpperCase() + step.slice(1)}</button>`,
      )
      .join('<span aria-hidden="true">›</span>');
    const ex = s.draft.contactExclusions;
    const summary = s.review?.summary;
    q("[data-tb-filters]").innerHTML = `<span>Exclude</span>${[
      ["excludeDoNotKnock", "Do not knock requests"],
      ["excludeReportedDanger", "Reported danger issues"],
    ]
      .map(
        ([key, label]) =>
          `<label><input type="checkbox" data-tb-filter="${key}"${ex[key] ? " checked" : ""}${!s.loaded || s.busy || s.published ? " disabled" : ""}><span>${label}</span>${Number.isSafeInteger(summary?.[key === "excludeDoNotKnock" ? "doNotKnockAddressCount" : "reportedDangerAddressCount"]) ? `<small>${summary[key === "excludeDoNotKnock" ? "doNotKnockAddressCount" : "reportedDangerAddressCount"]}</small>` : ""}</label>`,
      )
      .join(
        "",
      )}<select class="tb-blank-select" aria-label="Blank filter dropdown placeholder"><option value=""></option></select><span class="tb-filter-summary">${summary ? `${summary.eligibleAddressCount} included · ${summary.excludedAddressCount} excluded` : ""}</span>`;
    const error = q("[data-tb-error]");
    error.hidden = !(s.error || s.sourceError || s.viewportError);
    error.textContent = s.error || s.sourceError || s.viewportError || "";
    if (!s.loaded) {
      if (map) destroyMap();
      q("[data-tb-panel]").innerHTML =
        `<h3>${s.loading ? "Loading your area…" : "Planning unavailable"}</h3><p>${s.loading ? "Checking map access and available addresses." : "Reload to check current access and planning data."}</p>${!s.loading ? button("reload", "Reload") : ""}`;
      q("[data-tb-next]").innerHTML = "";
      q("[data-tb-status]").textContent = "";
      q("[data-tb-tools]").innerHTML = "";
      return;
    }
    q("[data-tb-map-title]").textContent =
      s.step === "area"
        ? s.bootstrap.areas.find(
            (area) =>
              JSON.stringify(area.geojson) ===
              JSON.stringify(s.draft.areaGeojson),
          )?.name || "Your working area"
        : `${s.draft.territories.length} territories`;
    q("[data-tb-tools]").innerHTML =
      [
        ["select", "Select and reshape"],
        ["pan", "Pan map"],
        ...(s.step === "cut"
          ? [
              ["draw", "Draw territory"],
              ["trim", "Trim territory"],
            ]
          : []),
      ]
        .map(([key, title]) =>
          button("tool", icon(key), {
            value: key,
            title,
            pressed: tool === key,
            disabled:
              (key !== "pan" &&
                (s.step === "assign" || Boolean(s.published))) ||
              (key === "trim" && (s.step === "area" || !selected(s))),
          }),
        )
        .join("") +
      (s.step === "cut"
        ? button("undo", icon("undo"), {
            title: "Undo last edit",
            disabled: !s.history.length || Boolean(s.published),
          })
        : "");
    const hints = {
      select: "Select a territory. Drag its corners to resize.",
      draw: "Tap the map to add corners, then finish the shape.",
      trim: "Draw a part to remove from the selected territory.",
      move: "Drag the selected boundary on the map.",
      pan: "Drag to move around the map.",
    };
    q("[data-tb-hint]").textContent =
      mapError ||
      (s.busy
        ? "Checking your plan…"
        : s.step === "assign"
          ? "Choose a person for each territory."
          : hints[tool]);
    q("[data-tb-panel]").innerHTML =
      (s.conflict ? button("reload", "Reload latest plan") : "") +
      (s.published
        ? publishedPanel(s)
        : s.step === "area"
          ? areaPanel(s)
          : s.step === "cut"
            ? cutPanel(s)
            : assignPanel(s)) +
      `<div class="tb-existing-link">${button("existing", "Existing territories")}</div>`;
    q("[data-tb-status]").innerHTML =
      `<strong>${s.notice ? e(s.notice) : !sourceReady(s) ? "Preparing addresses…" : s.step === "assign" ? `${s.draft.territories.filter((t) => t.assigneeUserId).length} of ${s.draft.territories.length} assigned` : summary ? (s.step === "cut" ? `${s.draft.territories.length} territories · ${summary.allocatedAddressCount} doors` : `${summary.eligibleAddressCount} addresses`) : "Choose your working area"}</strong><span>${summary && s.step !== "area" ? `${summary.unallocatedAddressCount} doors outside territories` : s.source?.unmappedRecordCount ? `${e(s.source.unmappedRecordCount)} without a mapped address` : s.viewportBusy ? "Loading visible addresses…" : ""}</span>`;
    q("[data-tb-next]").innerHTML = s.published
      ? button("new", "Plan another area")
      : s.step === "area"
        ? button("next-cut", "Use this area →", {
            primary: true,
            disabled: !s.draft.areaGeojson || drawing.length > 0,
          })
        : s.step === "cut"
          ? button("next-assign", "Assign people →", {
              primary: true,
              disabled:
                !s.draft.territories.length ||
                drawing.length > 0 ||
                !sourceReady(s),
            })
          : button("review", "Review →", {
              primary: true,
              disabled: !hasCompleteAssignments(s) || !sourceReady(s),
            });
    renderReview();
    if (!map && !mapLoading && !mapError) void loadMap();
    updateMap();
    scheduleViewport();
  }
  function drawingControls() {
    return drawing.length
      ? `<div class="tb-drawing-controls"><p>${drawing.length} corners</p>${button("finish", "Finish shape", { primary: true, disabled: drawing.length < 3 })}${button("cancel-draw", "Cancel")}</div>`
      : "";
  }
  function sourcePanel(s) {
    const count = s.source?.mappedAddressCount,
      missing = s.source?.unmappedRecordCount;
    return `<div class="tb-contact-source"><strong>Contact book</strong><span>${Number.isSafeInteger(count) ? `${count.toLocaleString()} mapped` : "Preparing addresses…"}${Number.isSafeInteger(missing) ? ` · ${missing.toLocaleString()} need a map location` : ""}</span>${button("address-issues", "Review address issues", { disabled: !s.loaded })}</div><label class="tb-permitted"><input type="checkbox" checked disabled>Within your permitted map area</label>`;
  }
  function areaPanel(s) {
    return `<span class="tb-eyebrow">Start with a place</span><h3>Where are we working?</h3><p>Choose a boundary or draw your own.</p><div class="tb-area-list">${s.bootstrap.areas.map((area, i) => button("area", `${icon("area")}<span>Saved area<small>${e(area.name || "Available area")}</small></span>`, { value: i, pressed: JSON.stringify(s.draft.areaGeojson) === JSON.stringify(area.geojson) })).join("")}${s.bootstrap.boundary ? button("boundary", `${icon("pin")}<span>Boundary<small>Neighborhood / precinct</small></span>`, { pressed: JSON.stringify(s.draft.areaGeojson) === JSON.stringify(s.bootstrap.boundary) && !s.bootstrap.areas.some((area) => JSON.stringify(area.geojson) === JSON.stringify(s.draft.areaGeojson)) }) : ""}${button("tool", `${icon("draw")}<span>Draw an area<small>Tap around its edges</small></span>`, { value: "draw", pressed: tool === "draw" })}</div>${sourcePanel(s)}${drawingControls()}${s.draft.areaGeojson && !s.review ? button("preview", "Check coverage", { disabled: !sourceReady(s) }) : ""}`;
  }
  function territoryRows(s, assignment = false) {
    return s.draft.territories
      .map((t, index) => {
        const person = s.bootstrap.staff.find(
          (p) => p.userId === t.assigneeUserId,
        );
        const caption = assignment
          ? person?.displayName ||
            person?.username ||
            (t.assigneeUserId ? "Choose another person" : "Choose person")
          : `${t.locked ? "Locked · " : ""}${Number.isInteger(t.addressCount) && s.review ? `${t.addressCount} doors` : "Check coverage"}`;
        return `<div class="tb-territory-row${t.id === s.selectedId ? " is-selected" : ""}">${button(assignment ? "choose-person" : "select", `<span class="tb-number">T${index + 1}</span><span><strong>${e(t.name)}</strong><small>${e(caption)}</small></span>${assignment ? icon(person ? "lock" : "select") : ""}`, { value: t.id, pressed: t.id === s.selectedId, title: `${assignment ? "Assign" : "Select"} ${t.name}` })}</div>`;
      })
      .join("");
  }
  function cutPanel(s) {
    const t = selected(s),
      total = s.review?.summary.eligibleAddressCount;
    return `<span class="tb-eyebrow">Make it manageable</span><h3>${s.draft.territories.length ? "Shape your territories" : "How do you want to cut?"}</h3><div class="tb-methods">${["auto", "guided", "draw"].map((name) => button("method", `${name === "auto" ? icon("sparkles") : ""}${name[0].toUpperCase() + name.slice(1)}`, { value: name, pressed: method === name })).join("")}</div>${drawing.length ? drawingControls() : method === "draw" ? `<p>Your lines. Live address counts.</p>${button("tool", `${icon("draw")}Draw a territory`, { value: "draw" })}` : `${method === "guided" ? `<p>${s.draft.territories.length ? "Lock a territory you like. Fill the rest." : "Draw one territory. Fill the rest automatically."}</p>${!s.draft.territories.length ? button("tool", `${icon("draw")}Draw first territory`, { value: "draw" }) : ""}` : ""}<label class="tb-count" for="tb-territory-count"><span>Territories</span><output>${s.targetCount}</output></label><input id="tb-territory-count" type="range" data-tb-count min="1" max="${s.bootstrap.limits?.maxTerritories || 12}" value="${s.targetCount}"${s.busy ? " disabled" : ""}><div class="tb-small-row"><span>${Number.isInteger(total) ? `About ${Math.round(total / s.targetCount)} doors each` : ""}</span><span>Balanced by doors</span></div>${button("generate", `${icon("sparkles")}${method === "guided" ? "Fill remaining area" : s.draft.territories.length ? "Rebalance territories" : `Preview ${s.targetCount} territories`}`, { primary: !s.draft.territories.length })}`}${s.draft.territories.length ? `<hr class="tb-rule"><div class="tb-inline-controls"><span class="tb-eyebrow">${s.draft.territories.length} territories</span>${button("rename", `${icon("pencil")}Rename`, { disabled: !t })}</div><div class="tb-territories">${territoryRows(s)}</div>${t ? `<div class="tb-edit-actions">${button("lock", `${icon("lock")}${t.locked ? "Unlock" : "Keep shape"}`, { pressed: t.locked })}${button("split", "Split", { disabled: t.locked })}${button("remove", "Remove", { disabled: t.locked })}${!s.review ? button("preview", "Check coverage", { disabled: !sourceReady(s) }) : ""}</div><details class="tb-extra-tools"><summary>Boundary tools</summary>${button("tool", `${icon("move")}Move boundary`, { value: "move", disabled: t.locked })}${t.trimGeometry ? button("clear-trim", "Restore trim", { disabled: t.locked }) : ""}</details>` : ""}` : ""}`;
  }
  function assignPanel(s) {
    const start = s.draft.startsAt
      ? new Date(s.draft.startsAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "When published";
    return `<span class="tb-eyebrow">Put names on the map</span><h3>Who’s taking each area?</h3><p>Choose from people with map clearance.</p>${!s.bootstrap.staff.length ? '<p class="tb-subtle">No eligible people are available yet.</p>' : ""}<div class="tb-territories">${territoryRows(s, true)}</div>${button("assign-available", `${icon("users")}Assign available people`, { disabled: !s.bootstrap.staff.length })}<hr class="tb-rule"><div class="tb-small-row"><span>Starts</span>${button("schedule", `${e(start)} ⌄`)}</div><div class="tb-small-row"><span>Access</span><span>Assigned area only</span></div>${button("team-access", "View team clearance →")}`;
  }
  function publishedPanel(s) {
    return `<h3>Territories are ready</h3><p>Your published boundaries and staff assignments are saved.</p><div class="tb-stat"><strong>${s.draft.territories.length}</strong><span>territories published</span></div>${button("back", "Return to voter map", { primary: true })}`;
  }
  function renderReview() {
    const s = model.state;
    if (dialog) {
      renderDialog();
      return;
    }
    const blocked = publishBlockReason(s);
    q("[data-tb-review]").innerHTML =
      reviewOpen && s.review
        ? `<div class="tb-scrim"><section class="tb-dialog" role="dialog" aria-modal="true" aria-label="Review territories" tabindex="-1"><h3>Ready to publish?</h3><p>Review the final plan before staff can use it.</p><dl><div><dt>Territories</dt><dd>${s.draft.territories.length}</dd></div><div><dt>Addresses allocated</dt><dd>${s.review.summary.allocatedAddressCount}</dd></div><div><dt>Not in a territory</dt><dd>${s.review.summary.unallocatedAddressCount}</dd></div><div><dt>Excluded addresses</dt><dd>${s.review.summary.excludedAddressCount}</dd></div><div><dt>Staff assignments</dt><dd>${s.draft.territories.filter((t) => t.assigneeUserId).length}</dd></div></dl>${s.review.summary.unallocatedAddressCount > 0 ? '<p class="tb-warning">Some addresses in your area are outside these territories.</p>' : ""}${blocked ? `<p class="tb-warning">${e(blocked)}</p>` : ""}${s.error ? `<p role="alert">${e(s.error)}</p>` : ""}<div class="tb-dialog-actions">${button("close-review", "Back")}${button("save-review", "Keep as draft")}${button("publish", s.busy === "publish" ? "Publishing…" : "Publish territories", { primary: true, disabled: s.conflict || Boolean(blocked) })}</div></section></div>`
        : "";
  }
  function renderDialog() {
    const s = model.state,
      t = s.draft.territories.find((item) => item.id === dialog?.territoryId);
    let title = "Your map access",
      body = "";
    if (dialog.kind === "people") {
      title = `Assign ${t?.name || "territory"}`;
      body = `<p>${Number.isInteger(t?.addressCount) && s.review ? `${t.addressCount} doors · ` : ""}Eligible members only</p><div class="tb-people-list">${s.bootstrap.staff
        .map((person) =>
          button(
            "assign-person",
            `<span class="tb-avatar">${e(
              (person.displayName || person.username || "Team member")
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join(""),
            )}</span><span><strong>${e(person.displayName || person.username || "Team member")}</strong><small>${e(person.roleLabel || (person.username ? `@${person.username}` : "Map access"))} · ${s.draft.territories.filter((item) => item.assigneeUserId === person.userId).length} assigned</small></span><span>Choose</span>`,
            { value: person.userId },
          ),
        )
        .join(
          "",
        )}</div>${t?.assigneeUserId ? button("unassign-person", "Remove assignment") : ""}`;
    } else if (dialog.kind === "rename") {
      title = "Rename territory";
      body = `<label class="tb-name">Territory name<input type="text" data-tb-rename maxlength="80" value="${e(t?.name || "")}" autocomplete="off"></label>${button("save-name", "Save name", { primary: true })}`;
    } else if (dialog.kind === "schedule") {
      title = "When should this start?";
      const local = s.draft.startsAt
        ? new Date(
            new Date(s.draft.startsAt).getTime() -
              new Date(s.draft.startsAt).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "";
      body = `<label class="tb-start">Start time<input type="datetime-local" data-tb-schedule value="${e(local)}"></label>${button("save-start", "Use this time", { primary: true })}${button("clear-start", "When published")}`;
    } else if (dialog.kind === "team-access") {
      title = "Team clearance";
      body = `<p>These people can receive territories in this area.</p><div class="tb-people-list">${s.bootstrap.staff.map((person) => `<div class="tb-person-readout"><span class="tb-avatar">${icon("users")}</span><span><strong>${e(person.displayName || person.username || "Team member")}</strong><small>${e(person.roleLabel || "Map access")}</small></span></div>`).join("")}</div>`;
    } else if (dialog.kind === "address-issues") {
      title = "Address issues";
      const missing = s.source?.unmappedRecordCount;
      body = `<p>${Number.isInteger(missing) ? `${missing} ${missing === 1 ? "contact needs" : "contacts need"} a map location.` : "Address locations are still being checked."}</p><p>Review their addresses in Contact Book.</p>${openContacts ? button("open-contacts", "Open Contact Book", { primary: true }) : ""}${button("refresh-source", s.sourceBusy ? "Checking…" : "Refresh addresses", { disabled: s.sourceBusy })}`;
    } else
      body = `<p>Plan territories within your permitted map area.</p><div class="tb-small-row"><span>Eligible people</span><strong>${s.bootstrap.staff.length}</strong></div><div class="tb-small-row"><span>Volunteers can work</span><span>Assigned area only</span></div>`;
    q("[data-tb-review]").innerHTML =
      `<div class="tb-scrim"><section class="tb-dialog" role="dialog" aria-modal="true" aria-label="${e(title)}" tabindex="-1"><div class="tb-dialog-head"><h3>${e(title)}</h3>${button("close-dialog", icon("close"), { title: "Close dialog" })}</div>${body}</section></div>`;
  }
  async function onClick(event) {
    const control = event.target.closest("[data-tb-action]");
    if (!control || control.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const action = control.dataset.tbAction,
      value = control.dataset.value,
      s = model.state;
    if (action === "refresh-source") {
      await model.refreshSource();
      if (mapReady) requestViewport(true);
      return;
    }
    if (
      [
        "access",
        "team-access",
        "address-issues",
        "schedule",
        "rename",
        "choose-person",
      ].includes(action)
    ) {
      if (!s.loaded) return;
      dialog = {
        kind: action === "choose-person" ? "people" : action,
        territoryId: action === "choose-person" ? value : s.selectedId,
      };
      if (action === "choose-person") model.select(value);
      renderDialog();
      q(".tb-dialog")?.focus();
      return;
    }
    if (action === "close-dialog") {
      dialog = null;
      renderReview();
      return;
    }
    if (action === "open-contacts") {
      dialog = null;
      openContacts?.();
      return;
    }
    if (action === "back") {
      if (
        s.dirty &&
        !(await confirm({
          title: "Leave unsaved changes?",
          message: "Save your draft to keep these territory changes.",
          confirmLabel: "Leave",
        }))
      )
        return;
      navigate(context().backPath);
      return;
    }
    if (action === "reload" || action === "new") {
      if (
        s.dirty &&
        !(await confirm({
          title: "Reload this plan?",
          message: "Unsaved changes will be replaced with the saved plan.",
          confirmLabel: "Reload",
        }))
      )
        return;
      reviewOpen = false;
      drawing = [];
      mapError = "";
      await model.load({ force: true });
      if (action === "new")
        model.edit((d) => {
          d.areaGeojson = null;
          d.territories = [];
          d.startsAt = null;
        });
      return;
    }
    if (s.busy) return;
    if (action === "existing") {
      openExisting?.();
      return;
    }
    if (action === "fit") {
      fitMap(true);
      return;
    }
    if (action === "zoom-in") {
      map?.zoomIn();
      return;
    }
    if (action === "zoom-out") {
      map?.zoomOut();
      return;
    }
    if (action === "tool") {
      cancelMapDrag();
      tool = value;
      drawing = [];
      render();
      return;
    }
    if (action === "cancel-draw") {
      drawing = [];
      tool = "select";
      render();
      return;
    }
    if (action === "step") {
      cancelMapDrag();
      tool = "select";
      drawing = [];
      reviewOpen = false;
      model.setStep(value);
      return;
    }
    if (action === "next-cut") {
      tool = "select";
      model.setStep("cut");
      return;
    }
    if (action === "next-assign") {
      if (await model.run("preview")) {
        tool = "select";
        model.setStep("assign");
      }
      return;
    }
    if (action === "save") {
      await model.run("draft");
      return;
    }
    if (action === "save-review") {
      if (await model.run("draft")) {
        reviewOpen = false;
        render();
      }
      return;
    }
    if (action === "assign-available") {
      if (!s.bootstrap.staff.length) return;
      model.edit((draft) => {
        const workloads = new Map(
          s.bootstrap.staff.map((person) => [
            person.userId,
            draft.territories.filter(
              (item) => item.assigneeUserId === person.userId,
            ).length,
          ]),
        );
        for (const territory of draft.territories.filter(
          (item) => !item.assigneeUserId,
        )) {
          const person = [...s.bootstrap.staff].sort(
            (a, b) =>
              workloads.get(a.userId) - workloads.get(b.userId) ||
              (a.displayName || a.username || "").localeCompare(
                b.displayName || b.username || "",
              ),
          )[0];
          territory.assigneeUserId = person.userId;
          workloads.set(person.userId, workloads.get(person.userId) + 1);
        }
      });
      return;
    }
    if (["assign-person", "unassign-person", "save-name"].includes(action)) {
      const territory = s.draft.territories.find(
        (item) => item.id === dialog?.territoryId,
      );
      if (!territory) return;
      const name = q("[data-tb-rename]")?.value.trim();
      if (action === "save-name" && !name) {
        q("[data-tb-rename]")?.focus();
        return;
      }
      if (
        action === "assign-person" &&
        !s.bootstrap.staff.some((person) => person.userId === value)
      )
        return;
      dialog = null;
      model.edit(() => {
        if (action === "save-name") territory.name = name;
        else
          territory.assigneeUserId =
            action === "unassign-person" ? null : value;
      });
      return;
    }
    if (action === "save-start") {
      const value = q("[data-tb-schedule]")?.value;
      if (!value || !Number.isFinite(new Date(value).getTime())) return;
      dialog = null;
      model.edit((draft) => {
        draft.startsAt = new Date(value).toISOString();
      });
      return;
    }
    if (action === "select") {
      model.select(value);
      return;
    }
    if (action === "undo") {
      model.undo();
      return;
    }
    if (action === "method") {
      method = value;
      tool = value === "draw" ? "draw" : "select";
      drawing = [];
      render();
      return;
    }
    if (action === "generate") {
      drawing = [];
      tool = "select";
      await model.run("preview", method);
      return;
    }
    if (action === "preview" || action === "split") {
      await model.run("preview", action === "split" ? "split" : "manual");
      return;
    }
    if (action === "review") {
      if (await model.run("preview")) {
        reviewOpen = true;
        renderReview();
        q(".tb-dialog")?.focus();
      }
      return;
    }
    if (action === "close-review") {
      reviewOpen = false;
      renderReview();
      q('[data-tb-action="review"]')?.focus();
      return;
    }
    if (action === "publish") {
      if (await model.run("publish")) {
        reviewOpen = false;
        render();
      }
      return;
    }
    if (action === "area" || action === "boundary") {
      const geometry =
        action === "boundary"
          ? s.bootstrap.boundary
          : s.bootstrap.areas[Number(value)]?.geojson;
      if (geometry) {
        model.edit((d) => {
          d.areaGeojson = clone(geometry);
          d.territories = [];
        });
        fitMap(true);
        if (sourceReady(s)) await model.run("preview");
      }
      return;
    }
    const territory = selected(s);
    if (action === "lock" && territory) {
      model.edit(() => {
        territory.locked = !territory.locked;
      });
      return;
    }
    if (action === "remove" && territory && !territory.locked) {
      model.edit((d) => {
        d.territories = d.territories.filter((t) => t.id !== territory.id);
      });
      return;
    }
    if (action === "clear-trim" && territory && !territory.locked) {
      model.edit(() => {
        territory.trimGeometry = null;
      });
      return;
    }
    if (action === "clear-start") {
      dialog = null;
      model.edit((d) => {
        d.startsAt = null;
      });
      return;
    }
    if (action === "finish") {
      try {
        const shape = polygonFromPoints(drawing);
        if (tool === "trim" && territory && !territory.locked)
          model.edit(() => {
            territory.trimGeometry = combineTrims(
              territory.trimGeometry,
              shape,
            );
          });
        else if (s.step === "area")
          model.edit((d) => {
            d.areaGeojson = shape;
            d.territories = [];
          });
        else {
          const id = globalThis.crypto.randomUUID();
          model.edit((d) => {
            d.territories.push({
              id,
              name: `Territory ${d.territories.length + 1}`,
              geojson: shape,
              trimGeometry: null,
              locked: false,
              assigneeUserId: null,
            });
          });
          model.select(id);
        }
        drawing = [];
        tool = "select";
        render();
        if (sourceReady(s)) await model.run("preview");
      } catch (error) {
        q("[data-tb-hint]").textContent = error.message;
      }
    }
  }
  function onChange(event) {
    const node = event.target,
      s = model.state;
    if (s.busy) return;
    if (node.dataset.tbFilter)
      model.edit((d) => {
        d.contactExclusions[node.dataset.tbFilter] = node.checked;
      });
    else if (node.hasAttribute("data-tb-count")) model.setCount(node.value);
    else if (node.hasAttribute("data-tb-name")) {
      const t = selected(s);
      if (t)
        model.edit(() => {
          t.name = node.value.trim() || "Territory";
        });
    } else if (node.dataset.tbAssignee)
      model.edit((d) => {
        const t = d.territories.find(
          (entry) => entry.id === node.dataset.tbAssignee,
        );
        if (t) t.assigneeUserId = node.value || null;
      });
    else if (node.hasAttribute("data-tb-start"))
      model.edit((d) => {
        d.startsAt = node.value ? new Date(node.value).toISOString() : null;
      });
  }
  async function loadMap() {
    const generation = ++mapGeneration;
    mapLoading = true;
    try {
      mapLibrary = await mapLoader();
      if (!host?.isConnected || generation !== mapGeneration) return;
      map = new mapLibrary.Map({
        container: q("[data-tb-map]"),
        style: mapStyle(),
        center: [-98, 39],
        zoom: 3,
        attributionControl: true,
        dragPan: true,
        touchZoomRotate: true,
      });
      map.on("load", () => {
        if (generation !== mapGeneration) return;
        mapReady = true;
        map.addSource("tb-area", { type: "geojson", data: collection([]) });
        map.addSource("tb-territories", {
          type: "geojson",
          data: collection([]),
        });
        map.addSource("tb-points", { type: "geojson", data: collection([]) });
        map.addSource("tb-drawing", { type: "geojson", data: collection([]) });
        map.addSource("tb-trims", { type: "geojson", data: collection([]) });
        map.addLayer({
          id: "tb-area-fill",
          type: "fill",
          source: "tb-area",
          paint: { "fill-color": "#5ea1ff", "fill-opacity": 0.08 },
        });
        map.addLayer({
          id: "tb-area-line",
          type: "line",
          source: "tb-area",
          paint: {
            "line-color": "#1d67b8",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
        map.addLayer({
          id: "tb-territory-fill",
          type: "fill",
          source: "tb-territories",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["case", ["get", "selected"], 0.22, 0.12],
          },
        });
        map.addLayer({
          id: "tb-territory-line",
          type: "line",
          source: "tb-territories",
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["case", ["get", "selected"], 3, 1.5],
          },
        });
        map.addLayer({
          id: "tb-trim-fill",
          type: "fill",
          source: "tb-trims",
          paint: { "fill-color": "#c91532", "fill-opacity": 0.25 },
        });
        map.addLayer({
          id: "tb-address-points",
          type: "circle",
          source: "tb-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              1,
              3,
              100,
              9,
              10000,
              18,
            ],
            "circle-color": "#1d67b8",
            "circle-opacity": 0.7,
          },
        });
        map.addLayer({
          id: "tb-drawing-line",
          type: "line",
          source: "tb-drawing",
          paint: {
            "line-color": "#1d67b8",
            "line-width": 3,
            "line-dasharray": [2, 1],
          },
        });
        updateMap();
        fitMap(true);
      });
      map.on("error", () => {
        if (generation === mapGeneration) {
          mapError = "Some map tiles could not load. Check your connection.";
          render();
        }
      });
      map.on("click", onMapClick);
      map.on("mousedown", onMapDown);
      map.on("mousemove", onMapMove);
      map.on("mouseup", onMapUp);
      map.on("touchstart", onMapDown);
      map.on("touchmove", onMapMove);
      map.on("touchend", onMapUp);
      window.addEventListener("pointerup", onMapUp);
      window.addEventListener("pointercancel", cancelMapDrag);
      window.addEventListener("blur", cancelMapDrag);
      map.on("moveend", scheduleViewport);
    } catch {
      if (generation === mapGeneration) {
        mapError = "The map could not load. Reload to try again.";
        render();
      }
    } finally {
      if (generation === mapGeneration) mapLoading = false;
    }
  }
  function fitMap(force = false) {
    if (!mapReady) return;
    const s = model.state;
    const bounds = geometryBounds(
      s.draft.areaGeojson ||
        s.bootstrap?.boundary ||
        s.bootstrap?.areas[0]?.geojson,
    );
    if (!bounds) return;
    const key = JSON.stringify(bounds);
    if (!force && fitKey === key) return;
    fitKey = key;
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 48, maxZoom: 17, duration: 0 },
    );
  }
  function scheduleViewport() {
    clearTimeout(viewportTimer);
    if (!mapReady || !host?.isConnected || !sourceReady(model.state)) return;
    viewportTimer = setTimeout(() => requestViewport(), 200);
  }
  function requestViewport(force = false) {
    if (!mapReady || !host?.isConnected) return;
    const bounds = map.getBounds();
    const bbox = [
      Math.max(-180, bounds.getWest()),
      Math.max(-90, bounds.getSouth()),
      Math.min(180, bounds.getEast()),
      Math.min(90, bounds.getNorth()),
    ];
    if (bbox[0] < bbox[2] && bbox[1] < bbox[3])
      void model.viewport(bbox, Math.min(24, Math.max(0, map.getZoom())), {
        force,
      });
  }
  function updateMap() {
    if (!mapReady || !model.state.loaded) return;
    const s = model.state;
    map
      .getSource("tb-area")
      .setData(
        collection(s.draft.areaGeojson ? [feature(s.draft.areaGeojson)] : []),
      );
    const colors = ["#1d67b8"];
    map.getSource("tb-territories").setData(
      collection(
        s.draft.territories.map((t, i) =>
          feature(t.geojson, {
            id: t.id,
            name: t.name,
            selected: t.id === s.selectedId,
            color: colors[i % colors.length],
          }),
        ),
      ),
    );
    map
      .getSource("tb-trims")
      .setData(
        collection(
          s.draft.territories
            .filter((t) => t.trimGeometry)
            .map((t) => feature(t.trimGeometry)),
        ),
      );
    renderViewport();
    map
      .getSource("tb-drawing")
      .setData(
        collection(
          drawing.length > 1
            ? [feature({ type: "LineString", coordinates: drawing })]
            : [],
        ),
      );
    map.dragPan?.enable();
    map.getCanvas().style.cursor = ["draw", "trim"].includes(tool)
      ? "crosshair"
      : tool === "move"
        ? "move"
        : "grab";
    drawHandles();
    drawTerritoryLabels();
    // Camera changes belong to the user. Fit only on initial load, explicit
    // area selection or the Fit control; draft/viewport updates must not snap
    // a dragged map back to its previous boundary.
  }
  // Camera updates must not replace a control while the user is clicking it.
  function renderViewport() {
    if (!host?.isConnected) return;
    const s = model.state;
    const error = q("[data-tb-error]");
    error.hidden = !(s.error || s.sourceError || s.viewportError);
    error.textContent = s.error || s.sourceError || s.viewportError || "";
    const label = q(".tb-map-bottom > span");
    label.textContent = s.viewportBusy
      ? "Loading visible addresses…"
      : s.clustered
        ? "● Grouped address locations"
        : "● Address locations";
    if (mapReady && map.getSource("tb-points"))
      map
        .getSource("tb-points")
        .setData(
          collection(
            s.points.map((p) =>
              feature(
                { type: "Point", coordinates: p.coordinates },
                { count: p.count },
              ),
            ),
          ),
        );
  }
  function editable() {
    const s = model.state;
    return s.step === "area"
      ? {
          geometry: s.draft.areaGeojson,
          set: (geometry) => {
            s.draft.areaGeojson = geometry;
            s.draft.territories = [];
          },
        }
      : selected(s) && !selected(s).locked
        ? {
            geometry: selected(s).geojson,
            trim: selected(s).trimGeometry,
            set: (geometry) => {
              selected(s).geojson = geometry;
            },
            setTrim: (geometry) => {
              selected(s).trimGeometry = geometry;
            },
          }
        : null;
  }
  function drawTerritoryLabels() {
    labels.forEach((label) => label.remove());
    labels = [];
    const s = model.state;
    s.draft.territories.forEach((territory, index) => {
      const bounds = geometryBounds(territory.geojson);
      if (!bounds) return;
      const element = document.createElement("div");
      element.className = "tb-map-label";
      const person = s.bootstrap.staff.find(
        (item) => item.userId === territory.assigneeUserId,
      );
      const caption =
        s.step === "assign" && person
          ? person.displayName || person.username || "Assigned"
          : s.review && Number.isSafeInteger(territory.addressCount)
            ? `${territory.addressCount} doors`
            : "";
      element.innerHTML = `<strong>T${index + 1}</strong>${caption ? `<span>${e(caption)}</span>` : ""}`;
      labels.push(
        new mapLibrary.Marker({ element })
          .setLngLat([(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
          .addTo(map),
      );
    });
  }
  function drawHandles() {
    handles.forEach((h) => h.remove());
    handles = [];
    const s = model.state,
      target = editable();
    if (
      s.step === "assign" ||
      s.busy ||
      s.published ||
      tool !== "select" ||
      !target?.geometry
    )
      return;
    sampledGeometryVertices(target.geometry).forEach(
      ({ point, pi, ri, vi }) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "tb-map-handle";
        element.setAttribute(
          "aria-label",
          `Boundary corner ${vi + 1}. Drag or use arrow keys to move.`,
        );
        const marker = new mapLibrary.Marker({ element, draggable: true })
          .setLngLat(point)
          .addTo(map);
        // MapLibre sets a generic marker label when attaching the element.
        element.setAttribute(
          "aria-label",
          `Boundary corner ${vi + 1}. Drag or use arrow keys to move.`,
        );
        const move = (next) => {
          const geometry = clone(target.geometry),
            nextRings = polygons(geometry),
            nextRing = nextRings[pi][ri];
          nextRing[vi] = next;
          if (vi === 0) nextRing[nextRing.length - 1] = [...next];
          model.edit(() => target.set(geometry));
        };
        marker.on("dragend", () => {
          const p = marker.getLngLat();
          move([p.lng, p.lat]);
        });
        element.addEventListener("keydown", (event) => {
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
          }[event.key];
          if (!direction) return;
          event.preventDefault();
          const step =
            (360 / (512 * 2 ** map.getZoom())) * (event.shiftKey ? 10 : 2);
          move([
            point[0] + direction[0] * step,
            point[1] + direction[1] * step,
          ]);
        });
        handles.push(marker);
      },
    );
  }
  function onMapClick(event) {
    const s = model.state;
    if (s.busy || s.step === "assign" || s.published || drag) return;
    if (tool === "draw" || tool === "trim") {
      drawing.push([event.lngLat.lng, event.lngLat.lat]);
      render();
      return;
    }
    if (tool === "pan") return;
    const hit = map.queryRenderedFeatures(event.point, {
      layers: ["tb-territory-fill"],
    })[0];
    if (hit) model.select(hit.properties.id);
  }
  function onMapDown(event) {
    if (tool !== "move" || model.state.busy || model.state.step === "assign")
      return;
    const target = editable();
    if (
      !target?.geometry ||
      !pointInGeometry([event.lngLat.lng, event.lngLat.lat], target.geometry)
    )
      return;
    event.preventDefault();
    map.dragPan.disable();
    drag = {
      origin: [event.lngLat.lng, event.lngLat.lat],
      geometry: clone(target.geometry),
      target,
      next: null,
    };
  }
  function onMapMove(event) {
    if (!drag) return;
    const dx = event.lngLat.lng - drag.origin[0],
      dy = event.lngLat.lat - drag.origin[1];
    drag.next = translateGeometry(drag.geometry, dx, dy);
    drag.trim = translateGeometry(drag.target.trim, dx, dy);
    map
      .getSource(model.state.step === "area" ? "tb-area" : "tb-territories")
      .setData(
        collection([feature(drag.next, { color: "#1d67b8", selected: true })]),
      );
  }
  function onMapUp() {
    if (!drag) return;
    const completed = drag;
    drag = null;
    map.dragPan.enable();
    if (completed.next)
      model.edit(() => {
        completed.target.set(completed.next);
        if (completed.target.setTrim) completed.target.setTrim(completed.trim);
      });
    else updateMap();
  }
  function cancelMapDrag() {
    const active = Boolean(drag);
    drag = null;
    map?.dragPan?.enable();
    if (active && mapReady) updateMap();
  }
  return {
    markup: () => "<div data-territory-builder-host></div>",
    mount,
    reset,
    model,
  };
}
