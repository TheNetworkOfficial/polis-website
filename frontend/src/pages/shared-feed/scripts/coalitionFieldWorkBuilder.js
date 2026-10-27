import {
  createTerritoryBuilderModel,
  geometryBounds,
  polygonFromPoints,
  sourceReady,
  publishBlockReason,
  sampledGeometryVertices,
} from "./territoryBuilderModel.js";
import {
  fieldEscape as e,
  fieldText as text,
} from "./coalitionFieldWorkModel.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const collection = (features) => ({ type: "FeatureCollection", features });
const feature = (geometry, properties = {}) => ({
  type: "Feature",
  geometry,
  properties,
});
const glyph = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const closeIcon = glyph('<path d="m6 6 12 12M18 6 6 18"/>');

/** Approved three-step presentation over the existing revision/source-fenced
 * territory model. No preview geometry, counts or publication is fabricated. */
export function createCoalitionFieldWorkBuilder({
  context,
  request,
  loadMapLibre,
  mapStyle,
  dialog,
  canAuthor,
  refreshAccess,
  onClose,
  onPublished,
} = {}) {
  let opened = false,
    step = 1,
    name = "",
    method = "area",
    vertices = [],
    editing = null,
    map,
    library,
    canvas,
    mapReady = false,
    epoch = 0,
    handles = [],
    redrawTimer,
    initialized = false,
    initialError = "",
    mapError = "";
  let submissionPending = false,
    formError = "";
  let dragged = false,
    pointerActive = false,
    pendingRender = false,
    keyboardHandleFocus = "";
  const model = createTerritoryBuilderModel({
    request,
    context,
    changed: (_state, kind) => {
      if (opened && context()) {
        if (kind === "viewport") updateMap();
        else render();
      }
    },
  });
  const d = () => dialog?.();
  function reset() {
    epoch++;
    close();
    model.reset();
  }
  function close() {
    opened = false;
    initialized = false;
    epoch++;
    clearTimeout(redrawTimer);
    handles.forEach((handle) => handle.remove());
    handles = [];
    map?.remove();
    map = null;
    canvas = null;
    mapReady = false;
    model.reset();
    pointerActive = false;
    pendingRender = false;
    keyboardHandleFocus = "";
    globalThis.window?.removeEventListener("pointerup", pointerUp);
    globalThis.window?.removeEventListener("pointercancel", pointerUp);
  }
  async function open(territory = null) {
    close();
    if (!canAuthor()) return;
    await refreshAccess();
    if (!canAuthor()) return;
    opened = true;
    formError = "";
    step = 1;
    name = territory?.name || "";
    editing = territory;
    vertices = [];
    initialError = "";
    mapError = "";
    initialized = false;
    const node = d();
    node.addEventListener("click", click);
    node.addEventListener("change", change);
    node.addEventListener("submit", submit);
    node.addEventListener("input", input);
    node.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    render();
    if (!node.open) node.showModal();
    await model.load({ force: true });
    if (!opened || !context()) return;
    if (!territory && !model.state.draft.areaGeojson) {
      const area =
        model.state.bootstrap?.boundary ||
        model.state.bootstrap?.areas?.[0]?.geojson;
      model.edit((draft) => {
        if (area) draft.areaGeojson = copy(area);
        draft.contactExclusions = {
          excludeDoNotKnock: true,
          excludeReportedDanger: true,
        };
      });
      model.setCount(2);
    }
    if (territory) {
      // The model publishes existing IDs through the saved plan. A legacy unit
      // boundary is never silently copied into a new overlapping territory.
      const saved = model.state.bootstrap?.existingTerritories?.find(
        (row) =>
          row.territoryId === territory.territoryId &&
          row.builderManaged === true,
      );
      const source = model.state.bootstrap?.areas?.find(
        (row) => row.id === territory.territoryId,
      );
      const matches = saved
        ? model.state.draft.territories.filter(
            (row) =>
              row.id === territory.territoryId ||
              row.territoryId === territory.territoryId ||
              (row.name === territory.name &&
                JSON.stringify(row.geojson) ===
                  JSON.stringify(source?.geojson || territory.geojson)),
          )
        : [];
      const match = matches.length === 1 ? matches[0] : null;
      if (!match)
        initialError =
          "This boundary belongs to an older territory plan. Viewing and assignment management remain available. Polygon editing is available for territories in the current saved field plan.";
      else {
        model.select(match.id);
        step = 2;
      }
    }
    initialized = true;
    render();
  }
  function title() {
    if (step === 4) return "Territories published";
    return editing ? "Edit territory boundary" : "New territory";
  }
  function handoffMarkup(state) {
    const handoff = state.published?.fieldHandoff || state.fieldHandoff;
    if (!handoff) return "";
    const complete = ["complete", "complete_with_review"].includes(
      handoff.status,
    );
    const message =
      handoff.status === "complete"
        ? "Operational field data is ready."
        : handoff.status === "complete_with_review"
          ? "Operational field data is prepared; some contacts need review."
          : "Operational field data is still being prepared. The worker will continue after this window closes.";
    return `<div class="note-box${complete ? "" : " warning"}" role="status"><strong>${e(message)}</strong><p>${Number(handoff.committed) || 0} records prepared · ${Number(handoff.review) || 0} need review · ${Number(handoff.excluded) || 0} excluded.</p>${action("Refresh field data status", "refresh-handoff")}</div>`;
  }
  function action(label, key, extra = "", primary = false) {
    return `<button type="button" class="${primary ? "primary-button" : "secondary-button"}" data-fwb-action="${key}"${model.state.busy ? " disabled" : ""} ${extra}>${label}</button>`;
  }
  function render() {
    if (!opened || !d() || !context()) return;
    if (pointerActive) {
      pendingRender = true;
      return;
    }
    const node = d(),
      state = model.state,
      draft = state.draft,
      safetyExpanded = node.querySelector(".advanced-settings")?.open === true;
    if (canvas) canvas.remove();
    node.className = "create-dialog";
    node.setAttribute("aria-labelledby", "fw-builder-title");
    const busy = Boolean(state.busy || state.loading);
    if (step === 4) {
      node.innerHTML = `<header class="dialog-header"><h2 id="fw-builder-title">Territories published</h2></header><div class="dialog-body">${state.error ? `<p role="alert">${e(state.error)}</p>` : ""}${handoffMarkup(state)}</div><footer class="dialog-footer">${action("Done", "close", "", true)}</footer>`;
      return;
    }
    const steps = ["Choose an area", "Shape territories", "Review & publish"];
    let content;
    if (state.loading || !initialized)
      content =
        '<div class="empty-state"><h3>Loading territory planning</h3><p>Checking the current area, draft, addresses and eligible team.</p></div>';
    else if (initialError)
      content = `<div class="note-box warning" role="alert"><strong>Boundary editing is unavailable for this plan</strong><p>${e(initialError)}</p></div>`;
    else if (!state.loaded)
      content = `<div class="note-box warning" role="alert"><p>${e(state.error || "Territory planning could not be loaded.")}</p>${action("Retry", "reload")}</div>`;
    else
      content = `<ol class="builder-stepper">${steps.map((label, index) => `<li class="${index + 1 === step ? "is-active" : index + 1 < step ? "is-complete" : ""}"><em>${index + 1}</em><span>${label}</span></li>`).join("")}</ol>${state.error ? `<div class="note-box warning" role="alert">${e(state.error)}${state.conflict ? action("Reload saved plan", "reload") : ""}</div>` : ""}${step === 1 ? areaMarkup(state) : step === 2 ? shapeMarkup(state) : reviewMarkup(state)}${!sourceReady(state) ? `<div class="note-box warning" role="status"><strong>Address data is being prepared</strong><p>${e(state.source?.message || "You can keep editing your area or save the draft. Preview and publication become available when the current source is ready.")}</p>${action("Refresh addresses", "refresh-source")}</div>` : ""}${state.notice ? `<p role="status">${e(state.notice)}</p>` : ""}`;
    node.innerHTML = `<header class="dialog-header"><div><span class="eyebrow">Territory planning</span><h2 id="fw-builder-title">${e(title())}</h2><p>${editing ? "Update your saved field plan and review its assignments." : "Build a clear field plan from an area your coalition can manage."}</p></div><button type="button" class="icon-button" data-fwb-action="close" aria-label="Close ${e(title())}"${busy ? " disabled" : ""}>${closeIcon}</button></header><form data-fwb-form><div class="dialog-body">${formError ? `<p role="alert">${e(formError)}</p>` : ""}${content}</div><footer class="dialog-footer">${step === 1 ? action("Cancel", "close") : action("Back", "back")}${state.loaded && initialized && !initialError ? action("Save draft", "save") : ""}${!state.loaded || !initialized || initialError ? "" : `<button type="submit" class="primary-button"${busy || state.conflict || (step > 1 && !sourceReady(state)) || (step === 3 && Boolean(publishBlockReason(state))) ? " disabled" : ""}>${busy ? "Working…" : step === 1 ? "Continue" : step === 2 ? "Review plan" : "Publish territories"}</button>`}</footer></form>`;
    if (safetyExpanded && node.querySelector(".advanced-settings"))
      node.querySelector(".advanced-settings").open = true;
    if (state.fieldHandoff)
      node
        .querySelector(".dialog-body")
        ?.insertAdjacentHTML("afterbegin", handoffMarkup(state));
    if (busy)
      node.querySelectorAll("input,select,textarea").forEach((field) => {
        field.disabled = true;
      });
    if (state.loaded && initialized && !initialError) mountMap();
    if (canvas && draft.areaGeojson) map?.resize();
  }
  function areaMarkup(state) {
    const areas = state.bootstrap?.areas || [];
    return `<label class="field"><span>Plan name</span><input name="planName" value="${e(name)}" placeholder="Name this field plan" required maxlength="80" /></label><div class="builder-selection"><label><input type="radio" name="method" value="area"${method === "area" ? " checked" : ""} />Use coalition area</label><label><input type="radio" name="method" value="draw"${method === "draw" ? " checked" : ""} />Draw an area</label></div>${method === "area" ? `<label class="field"><span>Source area</span><select name="areaIndex"><option value="">Choose an authorized area</option>${areas.map((area, index) => `<option value="${index}"${state.draft.areaGeojson && JSON.stringify(area.geojson) === JSON.stringify(state.draft.areaGeojson) ? " selected" : ""}>${e(area.name || "Coalition area")}</option>`).join("")}</select></label>` : `<p>Select at least three boundary corners on the map. Use Undo point to correct the last corner.</p>${action("Undo point", "undo-point")}${action("Clear drawing", "clear-drawing")}`}<div class="field-builder-map"><div class="field-builder-canvas" data-fwb-map></div></div><p id="fw-builder-validation" role="alert" hidden></p>`;
  }
  function shapeMarkup(state) {
    const selected = state.draft.territories.find(
      (row) => row.id === state.selectedId,
    );
    return `${editing ? `<p>Adjust the selected boundary on the map. Other boundaries, exclusions and assignments remain in the plan for review.</p>` : `<div class="form-grid"><label class="field"><span>Number of territories</span><input name="count" type="number" min="1" max="${state.bootstrap?.limits?.maxTerritories || 12}" value="${state.targetCount}" required /></label><div class="field"><span>Division method</span><p>Automatic division · Keep shared-address residents together</p></div></div>`}<div class="field-builder-map"><div class="field-builder-canvas" data-fwb-map></div></div><div class="note-actions">${!editing ? action("Generate territories", "generate", sourceReady(state) ? "" : "disabled") : ""}${action("Fit area", "fit")}${action("Undo boundary change", "undo")}</div>${state.draft.territories.length ? `<label class="field"><span>Selected territory</span><select name="selected">${state.draft.territories.map((row) => `<option value="${e(row.id)}"${row.id === state.selectedId ? " selected" : ""}>${e(row.name)}</option>`).join("")}</select></label>${selected ? `<div class="form-grid"><label class="field"><span>Territory name</span><input name="territoryName" value="${e(selected.name)}" required maxlength="80" /></label><label class="field"><span>Boundary protection</span><span><input type="checkbox" name="locked"${selected.locked ? " checked" : ""} /> Keep this territory locked during division</span></label></div><p>Drag a boundary corner to adjust it. Locked territories keep their shape during automatic division.</p>` : ""}` : "<p>Generate territories to preview the field plan.</p>"}<details class="advanced-settings"><summary>Safety exclusions</summary><label class="field"><span><input type="checkbox" data-fwb-filter="excludeDoNotKnock"${state.draft.contactExclusions.excludeDoNotKnock ? " checked" : ""} /> Exclude do-not-knock addresses</span></label><label class="field"><span><input type="checkbox" data-fwb-filter="excludeReportedDanger"${state.draft.contactExclusions.excludeReportedDanger ? " checked" : ""} /> Exclude reported-danger addresses</span></label></details>${summaryMarkup(state)}`;
  }
  function summaryMarkup(state) {
    const summary = state.review?.summary;
    if (!summary)
      return `<div class="note-box"><strong>Coverage is checked against the current address data</strong><p>Restricted locations and reported-danger exclusions follow the field plan's safety settings.</p></div>`;
    return `<div class="note-box"><strong>${Number(summary.eligibleAddressCount) || 0} eligible doors · ${Number(summary.allocatedAddressCount) || 0} allocated</strong><p>${Number(summary.excludedAddressCount) || 0} excluded doors · ${Number(summary.unallocatedAddressCount) || 0} unallocated doors. Residents at a shared address stay together.${Number.isSafeInteger(state.source?.unmappedRecordCount) ? ` ${state.source.unmappedRecordCount} records need a map location.` : ""}</p></div>`;
  }
  function reviewMarkup(state) {
    const staff = state.bootstrap?.staff || [],
      block = publishBlockReason(state);
    return `<div class="field-builder-map"><div class="field-builder-canvas" data-fwb-map></div></div><div class="field-detail-meta"><div><span>Plan</span><strong>${e(name || "Field plan")}</strong></div><div><span>Territories</span><strong>${state.draft.territories.length}</strong></div></div><section class="field-section"><h3>Assign territory leads</h3><p>Choose an eligible lead for each territory before publishing the active field plan.</p>${state.draft.territories.map((row) => `<label class="field"><span>${e(row.name)}</span><select data-fwb-assignee="${e(row.id)}"><option value="">Choose a team member</option>${staff.map((p) => `<option value="${e(p.userId)}"${p.userId === row.assigneeUserId ? " selected" : ""}>${e(p.displayName || p.name || p.username || "Coalition member")}${p.username ? ` · @${e(p.username)}` : ""}</option>`).join("")}</select></label>`).join("")}</section>${summaryMarkup(state)}${block ? `<p role="status">${e(block)}</p>` : ""}<div class="note-box"><strong>Review before publishing</strong><p>Confirm the boundaries and assigned leads. Publication updates this field plan and its active territory assignments.</p></div>`;
  }
  function data() {
    const state = model.state,
      features = [];
    if (state.draft.areaGeojson)
      features.push(feature(state.draft.areaGeojson, { kind: "area" }));
    state.draft.territories.forEach((row) =>
      features.push(
        feature(row.geojson, {
          kind: "territory",
          id: row.id,
          selected: row.id === state.selectedId,
        }),
      ),
    );
    if (step === 1 && method === "draw" && vertices.length > 1)
      features.push(
        feature(
          { type: "LineString", coordinates: vertices },
          { kind: "drawing" },
        ),
      );
    return collection(features);
  }
  function mountMap() {
    const slot = d()?.querySelector("[data-fwb-map]");
    if (!slot) return;
    if (canvas) {
      slot.replaceWith(canvas);
      map?.resize();
      updateMap();
      return;
    }
    canvas = document.createElement("div");
    canvas.className = "field-builder-canvas";
    slot.replaceWith(canvas);
    const ticket = ++epoch;
    void (async () => {
      try {
        library = await loadMapLibre();
        if (!opened || ticket !== epoch || !context()) return;
        map = new library.Map({
          container: canvas,
          preserveDrawingBuffer: true,
          style: mapStyle(),
          center: [-110.5, 46.8],
          zoom: 8,
          attributionControl: true,
        });
        map.on("load", () => {
          if (!opened || ticket !== epoch) return;
          mapReady = true;
          map.addSource("field-builder-geometry", {
            type: "geojson",
            data: data(),
          });
          map.addLayer({
            id: "field-builder-fill",
            type: "fill",
            source: "field-builder-geometry",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": "#5ea1ff", "fill-opacity": 0.15 },
          });
          map.addLayer({
            id: "field-builder-line",
            type: "line",
            source: "field-builder-geometry",
            paint: { "line-color": "#5ea1ff", "line-width": 2 },
          });
          fitMap();
          updateMap();
        });
        map.on("click", (event) => {
          if (dragged) {
            dragged = false;
            return;
          }
          if (step === 1 && method === "draw" && !model.state.busy) {
            vertices.push([event.lngLat.lng, event.lngLat.lat]);
            updateMap();
          }
        });
        map.on("moveend", () => {
          if (!mapReady || !sourceReady(model.state)) return;
          const b = map.getBounds();
          void model.viewport(
            [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
            map.getZoom(),
          );
        });
        map.on("error", () => {
          mapError =
            "Some street imagery could not be loaded. Boundary data remains available.";
        });
      } catch {
        if (opened && ticket === epoch) {
          mapError =
            "Street map unavailable. Retry opening territory planning.";
          const p = document.createElement("p");
          p.setAttribute("role", "alert");
          p.textContent = mapError;
          canvas?.replaceWith(p);
        }
      }
    })();
  }
  function fitMap() {
    const state = model.state,
      geometry =
        state.draft.areaGeojson ||
        state.bootstrap?.boundary ||
        state.bootstrap?.areas?.[0]?.geojson;
    const bounds = geometryBounds(geometry);
    if (bounds && map)
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 24, maxZoom: 17, duration: 0 },
      );
  }
  function updateMap() {
    if (!mapReady || !map) return;
    const active = document.activeElement;
    const focusKey =
      keyboardHandleFocus ||
      (canvas?.contains(active) ? active.dataset.fwbVertex || "" : "");
    keyboardHandleFocus = "";
    map.getSource("field-builder-geometry")?.setData(data());
    handles.forEach((handle) => handle.remove());
    handles = [];
    if (step !== 2 || model.state.busy) return;
    const row = model.state.draft.territories.find(
      (t) => t.id === model.state.selectedId,
    );
    if (!row || row.locked) return;
    sampledGeometryVertices(row.geojson, 64).forEach(
      ({ point, pi, ri, vi }) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "field-boundary-handle";
        element.dataset.fwbVertex = `${row.id}:${pi}:${ri}:${vi}`;
        element.setAttribute(
          "aria-label",
          `Boundary point ${vi + 1}; drag or use arrow keys to move`,
        );
        const marker = new library.Marker({ element, draggable: true })
          .setLngLat(point)
          .addTo(map);
        element.setAttribute(
          "aria-label",
          `Boundary point ${vi + 1}; drag or use arrow keys to move`,
        );
        const update = (lng, lat) => {
          const geometry = copy(row.geojson),
            polygons =
              geometry.type === "Polygon"
                ? [geometry.coordinates]
                : geometry.coordinates,
            ring = polygons[pi][ri];
          ring[vi] = [lng, lat];
          if (vi === 0 || vi === ring.length - 1)
            ring[0] = ring[ring.length - 1] = [lng, lat];
          model.edit(() => {
            row.geojson = geometry;
          });
        };
        marker.on("dragstart", () => {
          dragged = true;
        });
        marker.on("dragend", () => {
          const point = marker.getLngLat();
          update(point.lng, point.lat);
        });
        element.addEventListener("keydown", (event) => {
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          // A model edit redraws the handles. Preserve only the keyboard user's
          // exact territory/ring/vertex so consecutive arrows keep editing it.
          if (document.activeElement === element)
            keyboardHandleFocus = element.dataset.fwbVertex;
          const delta = event.shiftKey ? 0.0005 : 0.0001;
          const p = marker.getLngLat();
          update(
            p.lng +
              (event.key === "ArrowRight"
                ? delta
                : event.key === "ArrowLeft"
                  ? -delta
                  : 0),
            p.lat +
              (event.key === "ArrowUp"
                ? delta
                : event.key === "ArrowDown"
                  ? -delta
                  : 0),
          );
        });
        handles.push(marker);
        if (focusKey === element.dataset.fwbVertex)
          element.focus({ preventScroll: true });
      },
    );
  }
  function error(message) {
    formError = message;
    let node = d()?.querySelector("#fw-builder-validation");
    if (!node && d()?.querySelector(".dialog-body")) {
      node = document.createElement("p");
      node.setAttribute("role", "alert");
      d().querySelector(".dialog-body").append(node);
    }
    if (node) {
      node.hidden = false;
      node.textContent = message;
    }
  }
  async function click(event) {
    const node = event.target.closest("[data-fwb-action]");
    if (!node || !opened) return;
    event.preventDefault();
    event.stopPropagation();
    if (model.state.busy || node.disabled) return;
    const key = node.dataset.fwbAction;
    if (key === "close") {
      const published = step === 4;
      d()?.close();
      close();
      onClose?.();
      if (published) await onPublished?.();
    } else if (key === "back") {
      step = Math.max(1, step - 1);
      render();
    } else if (key === "fit") fitMap();
    else if (key === "save") {
      if (step === 1 && !commitArea()) return;
      const ok = await model.run("draft");
      if (ok) render();
    } else if (key === "reload") {
      initialized = false;
      await model.load({ force: true });
      initialized = true;
      render();
    } else if (key === "refresh-source") await model.refreshSource();
    else if (key === "refresh-handoff") await model.refreshFieldHandoff();
    else if (key === "generate") await generate();
    else if (key === "undo") model.undo();
    else if (key === "undo-point") {
      vertices.pop();
      updateMap();
    } else if (key === "clear-drawing") {
      vertices = [];
      updateMap();
    }
  }
  function pointerDown() {
    pointerActive = true;
  }
  function pointerUp() {
    pointerActive = false;
    if (pendingRender) {
      pendingRender = false;
      requestAnimationFrame(() => {
        if (opened) render();
      });
    }
  }
  function input(event) {
    if (!opened || !event.target.closest("[data-fwb-form]")) return;
    if (event.target.name === "planName") name = event.target.value;
  }
  function commitArea() {
    name = text(d()?.querySelector('[name="planName"]')?.value || name);
    if (!name) {
      error("Enter a plan name.");
      return false;
    }
    if (method === "draw") {
      if (new Set(vertices.map((point) => point.join(","))).size < 3) {
        error("Choose at least three boundary corners.");
        return false;
      }
      const geometry = polygonFromPoints(vertices);
      if (!geometry) {
        error("Choose at least three boundary corners.");
        return false;
      }
      model.edit((draft) => {
        draft.areaGeojson = geometry;
        draft.territories = [];
      });
    }
    if (!model.state.draft.areaGeojson) {
      error("Choose an authorized area or draw a boundary.");
      return false;
    }
    return true;
  }
  async function change(event) {
    if (!opened || !event.target.closest("[data-fwb-form]")) return;
    event.stopPropagation();
    const node = event.target,
      state = model.state;
    if (state.busy) return;
    if (node.dataset.fwbFilter)
      model.edit((draft) => {
        draft.contactExclusions[node.dataset.fwbFilter] = node.checked;
      });
    else if (node.name === "planName") name = node.value;
    else if (node.name === "method") {
      name = d().querySelector('[name="planName"]')?.value || name;
      method = node.value;
      render();
    } else if (node.name === "areaIndex" && node.value !== "") {
      const area = state.bootstrap.areas[Number(node.value)];
      if (area)
        model.edit((draft) => {
          draft.areaGeojson = copy(area.geojson);
        });
      fitMap();
    } else if (node.name === "count") model.setCount(node.value);
    else if (node.name === "selected") model.select(node.value);
    else if (node.name === "territoryName")
      model.edit((draft) => {
        const row = draft.territories.find((t) => t.id === state.selectedId);
        if (row) row.name = text(node.value) || "Territory";
      });
    else if (node.name === "locked")
      model.edit((draft) => {
        const row = draft.territories.find((t) => t.id === state.selectedId);
        if (row) row.locked = node.checked;
      });
    else if (node.dataset.fwbAssignee) {
      model.edit((draft) => {
        const row = draft.territories.find(
          (t) => t.id === node.dataset.fwbAssignee,
        );
        if (row) row.assigneeUserId = node.value || null;
      });
      await model.run("preview", "manual");
    }
  }
  async function generate() {
    if (!(await model.run("preview", "auto"))) return false;
    if (name)
      model.edit((draft) => {
        draft.territories.forEach((row, index) => {
          if (!row.locked) row.name = `${name} ${index + 1}`;
        });
      });
    return true;
  }
  async function submit(event) {
    if (!event.target.matches("[data-fwb-form]") || !opened) return;
    event.preventDefault();
    event.stopPropagation();
    if (model.state.busy || submissionPending) return;
    submissionPending = true;
    formError = "";
    const phase = step,
      data = new FormData(event.target);
    const submitButton = event.target.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await refreshAccess();
      if (!canAuthor() || !context()) {
        error("Territory authoring is no longer available for this account.");
        return;
      }
      if (phase !== step) return;
      if (phase === 1) {
        name = text(data.get("planName"));
        if (!commitArea()) return;
        step = 2;
        render();
        fitMap();
      } else if (phase === 2) {
        if (
          (!model.state.draft.territories.length ||
            model.state.draft.territories.length !== model.state.targetCount) &&
          !editing
        ) {
          if (!(await generate())) return;
        }
        if (await model.run("preview", "manual")) {
          step = 3;
          render();
        }
      } else if (await model.run("publish")) {
        if (model.state.published?.fieldHandoff) {
          step = 4;
          render();
          return;
        }
        d()?.close();
        close();
        onClose?.();
        await onPublished?.();
      }
    } catch (failure) {
      error(
        failure.message ||
          "The territory plan could not be updated. Try again.",
      );
    } finally {
      submissionPending = false;
      const button = d()?.querySelector('button[type="submit"]');
      if (button && opened)
        button.disabled = Boolean(
          model.state.busy ||
            model.state.conflict ||
            (step > 1 && !sourceReady(model.state)) ||
            (step === 3 && publishBlockReason(model.state)),
        );
    }
  }

  return {
    open,
    close,
    reset,
    isBusy: () =>
      Boolean(submissionPending || model.state.busy || model.state.loading),
  };
}
