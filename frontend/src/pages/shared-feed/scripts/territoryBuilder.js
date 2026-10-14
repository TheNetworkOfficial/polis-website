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
    fitKey = "",
    drag = null,
    reviewOpen = false,
    viewportTimer;
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
    clearTimeout(viewportTimer);
    mapGeneration++;
    handles.forEach((h) => h.remove());
    handles = [];
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
  }
  function shell() {
    return `<section class="territory-builder" aria-label="Territory builder">
      <header class="tb-header"><button type="button" data-tb-action="back" aria-label="Back to voter map">${icon("back")}</button><div><h2>Territories</h2><span data-tb-scope></span></div><span data-tb-draft></span><div data-tb-save></div></header>
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
      host.addEventListener("keydown", (event) => {
        if (reviewOpen && event.key === "Tab") {
          const focusable = [
            ...q(".tb-dialog").querySelectorAll("button:not(:disabled)"),
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
          drawing = [];
          tool = "select";
          reviewOpen = false;
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
    q("[data-tb-filters]").innerHTML = `<span>Exclude</span>${[
      ["excludeDoNotKnock", "Do not knock requests"],
      ["excludeReportedDanger", "Reported danger issues"],
    ]
      .map(
        ([key, label]) =>
          `<label><input type="checkbox" data-tb-filter="${key}"${ex[key] ? " checked" : ""}${!s.loaded || s.busy || s.published ? " disabled" : ""}>${label}</label>`,
      )
      .join(
        "",
      )}<select class="tb-blank-select" aria-label="Blank filter dropdown placeholder" disabled><option value=""></option></select>`;
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
        ? "Choose your working area"
        : `${s.draft.territories.length} territories`;
    q("[data-tb-tools]").innerHTML =
      [
        ["select", "Select / resize"],
        ["draw", s.step === "area" ? "Draw area" : "Draw territory"],
        ["move", "Move boundary"],
        ["trim", "Trim selected territory"],
      ]
        .map(([key, title]) =>
          button("tool", icon(key), {
            value: key,
            title,
            pressed: tool === key,
            disabled:
              s.step === "assign" ||
              Boolean(s.published) ||
              (key === "trim" && (s.step === "area" || !selected(s))),
          }),
        )
        .join("") +
      button("undo", icon("undo"), {
        title: "Undo last change",
        disabled: !s.history.length || Boolean(s.published),
      });
    const hints = {
      select: "Select a territory. Drag its corners to resize.",
      draw: "Tap the map to add corners, then finish the shape.",
      trim: "Draw a part to remove from the selected territory.",
      move: "Drag the selected boundary on the map.",
    };
    q("[data-tb-hint]").textContent =
      mapError ||
      (s.busy
        ? "Checking your plan…"
        : s.step === "assign"
          ? "Review each territory and choose a staff member."
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
    const summary = s.review?.summary;
    q("[data-tb-status]").innerHTML =
      `<strong>${s.notice ? e(s.notice) : !sourceReady(s) ? "Preparing addresses…" : summary ? `${summary.eligibleAddressCount} addresses in area` : "Check coverage for address totals"}</strong><span>${summary?.excludedAddressCount ? `${summary.excludedAddressCount} excluded · ` : ""}${s.source?.unmappedRecordCount ? `${e(s.source.unmappedRecordCount)} records have no map location` : s.viewportBusy ? "Loading visible addresses…" : s.clustered ? "Nearby addresses are grouped on the map" : "Changes stay in your draft until published"}</span>${button("refresh-source", s.sourceBusy ? "Checking…" : "Refresh addresses", { disabled: s.sourceBusy })}`;
    q("[data-tb-next]").innerHTML = s.published
      ? button("new", "Plan another area")
      : s.step === "area"
        ? button("next-cut", "Use this area →", {
            primary: true,
            disabled: !s.draft.areaGeojson || drawing.length > 0,
          })
        : s.step === "cut"
          ? button("next-assign", "Assign staff →", {
              primary: true,
              disabled:
                !s.draft.territories.length ||
                drawing.length > 0 ||
                !sourceReady(s),
            })
          : button("review", "Review & publish →", {
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
  function areaPanel(s) {
    return `<h3>Choose an area</h3><p>Start with an available boundary or draw one on the map.</p><div class="tb-area-list">${s.bootstrap.areas.map((area, i) => button("area", e(area.name || "Available area"), { value: i, pressed: JSON.stringify(s.draft.areaGeojson) === JSON.stringify(area.geojson) })).join("")}</div>${s.bootstrap.boundary ? button("boundary", "Use full boundary", { disabled: !s.bootstrap.boundary }) : ""}${button("tool", `${icon("draw")} Draw an area`, { value: "draw", pressed: tool === "draw" })}${drawingControls()}${s.draft.areaGeojson ? `<div class="tb-stat"><strong>${s.review?.summary.eligibleAddressCount ?? "—"}</strong><span>addresses included</span></div>${button("preview", "Check coverage", { disabled: !sourceReady(s) })}` : ""}<p class="tb-subtle">Use the map controls to move around and zoom in.</p>`;
  }
  function territoryRows(s, assignment = false) {
    return s.draft.territories
      .map(
        (t, index) =>
          `<div class="tb-territory-row${t.id === s.selectedId ? " is-selected" : ""}"><button type="button" data-tb-action="select" data-value="${e(t.id)}" aria-pressed="${t.id === s.selectedId}"><span class="tb-number">${index + 1}</span><span><strong>${e(t.name)}</strong><small>${Number.isInteger(t.addressCount) && s.review ? `${t.addressCount} addresses` : "Awaiting preview"}${t.locked ? " · Locked" : ""}</small></span></button>${assignment ? `<label class="tb-assignee"><span class="tb-sr-only">Assign ${e(t.name)}</span><select data-tb-assignee="${e(t.id)}"${s.busy ? " disabled" : ""}><option value="">Unassigned</option>${s.bootstrap.staff.map((p) => `<option value="${e(p.userId)}"${p.userId === t.assigneeUserId ? " selected" : ""}>${e(p.displayName || p.username || "Team member")}${p.username ? ` (@${e(p.username)})` : ""}</option>`).join("")}${t.assigneeUserId && !s.bootstrap.staff.some((p) => p.userId === t.assigneeUserId) ? '<option selected value="">Staff member unavailable — choose again</option>' : ""}</select></label>` : ""}</div>`,
      )
      .join("");
  }
  function cutPanel(s) {
    const t = selected(s);
    return `<h3>Cut your territories</h3><p>Balance the workload, then adjust the boundaries.</p><div class="tb-methods">${["auto", "guided", "draw"].map((name) => button("method", name[0].toUpperCase() + name.slice(1), { value: name, pressed: method === name })).join("")}</div>${method !== "draw" ? `<label class="tb-count"><span>Territories</span><input type="number" data-tb-count min="1" max="${s.bootstrap.limits?.maxTerritories || 12}" value="${s.targetCount}"${s.busy ? " disabled" : ""}></label><p class="tb-subtle">${method === "guided" ? "Locked territories stay in place. Split the remaining area." : "Divide the area by geography and address workload."}</p>${button("generate", method === "guided" ? "Fill remaining area" : "Create territories", { primary: true })}` : `<p class="tb-subtle">Draw each territory, then drag its corners to refine it.</p>${button("tool", `${icon("draw")} Draw territory`, { value: "draw", primary: true })}`}${drawingControls()}<div class="tb-territories">${territoryRows(s)}</div>${t ? `<label class="tb-name">Territory name<input type="text" data-tb-name value="${e(t.name)}" maxlength="80"${s.busy ? " disabled" : ""}></label><div class="tb-edit-actions">${button("lock", t.locked ? "Unlock" : "Lock", { pressed: t.locked })}${button("split", "Split", { disabled: t.locked })}${button("tool", "Trim", { value: "trim", disabled: t.locked })}${t.trimGeometry ? button("clear-trim", "Restore trim", { disabled: t.locked }) : ""}${button("remove", "Remove", { disabled: t.locked })}</div>` : ""}${s.draft.territories.length ? button("preview", "Check coverage") : ""}${s.review ? `<p class="tb-subtle">${s.review.summary.allocatedAddressCount} allocated · ${s.review.summary.unallocatedAddressCount} unassigned to a territory${s.review.summary.boundaryAddressCount ? ` · ${s.review.summary.boundaryAddressCount} on an edge; move the boundary to include them` : ""}</p>` : ""}`;
  }
  function assignPanel(s) {
    const localDate = s.draft.startsAt
      ? new Date(
          new Date(s.draft.startsAt).getTime() -
            new Date(s.draft.startsAt).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "";
    return `<h3>Assign your team</h3><p>Choose staff for each territory. Save a draft to finish later.</p>${!s.bootstrap.staff.length ? '<p class="tb-subtle">No eligible staff are available yet.</p>' : ""}<div class="tb-territories">${territoryRows(s, true)}</div><label class="tb-start">Start time <span class="tb-subtle">Optional</span><input type="datetime-local" data-tb-start value="${e(localDate)}"${s.busy ? " disabled" : ""}></label>${localDate ? button("clear-start", "Start immediately") : ""}`;
  }
  function publishedPanel(s) {
    return `<h3>Territories are ready</h3><p>Your published boundaries and staff assignments are saved.</p><div class="tb-stat"><strong>${s.draft.territories.length}</strong><span>territories published</span></div>${button("back", "Return to voter map", { primary: true })}`;
  }
  function renderReview() {
    const s = model.state;
    const blocked = publishBlockReason(s);
    q("[data-tb-review]").innerHTML =
      reviewOpen && s.review
        ? `<div class="tb-scrim"><section class="tb-dialog" role="dialog" aria-modal="true" aria-label="Review territories" tabindex="-1"><h3>Ready to publish?</h3><p>Review the final plan before staff can use it.</p><dl><div><dt>Territories</dt><dd>${s.draft.territories.length}</dd></div><div><dt>Addresses allocated</dt><dd>${s.review.summary.allocatedAddressCount}</dd></div><div><dt>Not in a territory</dt><dd>${s.review.summary.unallocatedAddressCount}</dd></div><div><dt>Excluded addresses</dt><dd>${s.review.summary.excludedAddressCount}</dd></div><div><dt>Staff assignments</dt><dd>${s.draft.territories.filter((t) => t.assigneeUserId).length}</dd></div></dl>${s.review.summary.unallocatedAddressCount > 0 ? '<p class="tb-warning">Some addresses in your area are outside these territories.</p>' : ""}${blocked ? `<p class="tb-warning">${e(blocked)}</p>` : ""}${s.error ? `<p role="alert">${e(s.error)}</p>` : ""}<div class="tb-dialog-actions">${button("close-review", "Back")}${button("publish", s.busy === "publish" ? "Publishing…" : "Publish territories", { primary: true, disabled: s.conflict || Boolean(blocked) })}</div></section></div>`
        : "";
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
        if (s.step !== "area") await model.run("preview");
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
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.2 },
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
            "circle-color": "#153b43",
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
    const colors = ["#1d67b8", "#287e75", "#945b30", "#7255ab", "#a03c65"];
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
    map.getCanvas().style.cursor = ["draw", "trim"].includes(tool)
      ? "crosshair"
      : tool === "move"
        ? "move"
        : "";
    drawHandles();
    fitMap();
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
  return {
    markup: () => "<div data-territory-builder-host></div>",
    mount,
    reset,
    model,
  };
}
