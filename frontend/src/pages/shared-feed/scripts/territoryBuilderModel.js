const copy = (value) => JSON.parse(JSON.stringify(value));
const filters = (value = {}) => ({
  excludeDoNotKnock: value.excludeDoNotKnock === true,
  excludeReportedDanger: value.excludeReportedDanger === true,
});
const validationMessages = {
  territory_builder_area_outside_boundary:
    "Keep the area inside your campaign boundary.",
  territory_builder_territory_outside_area:
    "Keep each territory inside your selected area.",
  territory_builder_invalid_geometry:
    "This boundary could not be used. Adjust its corners and try again.",
  territory_builder_invalid_polygon:
    "This boundary could not be used. Adjust its corners and try again.",
  territory_builder_too_many_territories:
    "This plan has too many territories. Remove one before adding another.",
  territory_builder_locked_count:
    "Increase the territory count to cover the area outside your locked territories.",
  territory_builder_invalid_count:
    "Choose a territory count within the available limit.",
  territory_builder_split_unavailable:
    "Unlock and select a territory before splitting it.",
  territory_builder_invalid_assignee:
    "A selected staff member is no longer eligible. Choose another staff member.",
  territory_builder_assignee_ineligible:
    "A selected staff member is no longer eligible. Choose another staff member.",
  territory_builder_area_required: "Choose or draw an area first.",
  territory_builder_invalid_start:
    "Choose a valid start time or start immediately.",
};
const failureMessage = (error) =>
  validationMessages[error.message] ||
  (error.message?.startsWith("territory_builder_")
    ? "This plan could not be validated. Check the boundaries and assignments, then try again."
    : error.message) ||
  "The change could not be completed. Try again.";

export const territoryBuilderBase = ({ scopeType, scopeId }, suffix = "") =>
  scopeType === "candidate"
    ? `/api/candidate-dashboard/voter-map/territory-builder${suffix}?candidateId=${encodeURIComponent(scopeId)}`
    : `/api/coalitions/${encodeURIComponent(scopeId)}/voter-map/territory-builder${suffix}`;

export function geometryBounds(geometry) {
  const points = [];
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") points.push(coordinates);
    else coordinates.forEach(visit);
  };
  visit(geometry?.coordinates);
  if (!points.length) return null;
  return points.reduce(
    (bounds, point) => [
      Math.min(bounds[0], point[0]),
      Math.min(bounds[1], point[1]),
      Math.max(bounds[2], point[0]),
      Math.max(bounds[3], point[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = point,
      [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-12 &&
      x >= Math.min(xi, xj) &&
      x <= Math.max(xi, xj) &&
      y >= Math.min(yi, yj) &&
      y <= Math.max(yi, yj)
    )
      return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function pointInGeometry(point, geometry) {
  if (!point || !geometry) return false;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some(
    (rings) =>
      inRing(point, rings[0]) &&
      !rings.slice(1).some((ring) => inRing(point, ring)),
  );
}

export function polygonFromPoints(points) {
  if (points.length < 3)
    throw new Error("Add at least three corners on the map.");
  return { type: "Polygon", coordinates: [[...copy(points), [...points[0]]]] };
}

export function combineTrims(previous, geometry) {
  const polygons = (value) =>
    !value
      ? []
      : value.type === "Polygon"
        ? [value.coordinates]
        : value.coordinates;
  return {
    type: "MultiPolygon",
    coordinates: [...polygons(previous), ...polygons(geometry)],
  };
}

export function translateGeometry(geometry, dx, dy) {
  if (!geometry) return null;
  const shift = (coordinates) =>
    typeof coordinates[0] === "number"
      ? [coordinates[0] + dx, coordinates[1] + dy]
      : coordinates.map(shift);
  return { ...geometry, coordinates: shift(geometry.coordinates) };
}

/** Sample editing handles globally without simplifying or copying the geometry. */
export function sampledGeometryVertices(geometry, limit = 64) {
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const rings = [];
  let total = 0;
  polygons.forEach((polygon, pi) =>
    polygon.forEach((ring, ri) => {
      const count = Math.max(0, ring.length - 1);
      if (count) rings.push({ ring, pi, ri, offset: total, count });
      total += count;
    }),
  );
  const count = Math.min(total, Math.max(0, Math.floor(limit)));
  let ringIndex = 0;
  return Array.from({ length: count }, (_, index) => {
    const vertex =
      count === 1 ? 0 : Math.floor((index * (total - 1)) / (count - 1));
    while (vertex >= rings[ringIndex].offset + rings[ringIndex].count)
      ringIndex++;
    const { ring, pi, ri, offset } = rings[ringIndex];
    const vi = vertex - offset;
    return { point: ring[vi], pi, ri, vi };
  });
}

export function hasCompleteAssignments(state) {
  const staff = new Set(
    (state.bootstrap?.staff || []).map((person) => person.userId),
  );
  return (
    state.draft.territories.length > 0 &&
    state.draft.territories.every((territory) =>
      staff.has(territory.assigneeUserId),
    )
  );
}

export function publishBlockReason(state) {
  if (!state.review) return "Review the current plan before publishing.";
  if (!hasCompleteAssignments(state))
    return "Choose staff for each territory before publishing.";
  const counts = new Map(
    state.review.territories.map((territory) => [
      territory.id,
      territory.addressCount,
    ]),
  );
  if (
    state.draft.territories.some((territory) => !(counts.get(territory.id) > 0))
  )
    return "Each territory needs at least one address. Adjust or remove empty territories.";
  return "";
}

/** Only approved geometry and operational exclusions cross the API boundary. */
export function builderPayload(state, mode = "manual") {
  return {
    revision: state.revision,
    areaGeojson: copy(state.draft.areaGeojson),
    territories: state.draft.territories.map((territory) => ({
      id: territory.id,
      name: territory.name,
      geojson: copy(territory.geojson),
      trimGeometry: territory.trimGeometry
        ? copy(territory.trimGeometry)
        : null,
      locked: territory.locked === true,
      assigneeUserId: territory.assigneeUserId || null,
    })),
    contactExclusions: filters(state.draft.contactExclusions),
    mode,
    targetCount: state.targetCount,
    startsAt: state.draft.startsAt || null,
    ...(mode === "split" ? { splitTerritoryId: state.selectedId } : {}),
  };
}

const identity = (context) =>
  context?.userId && context?.scopeId
    ? `${context.userId}:${context.scopeType}:${context.scopeId}`
    : "";
const emptyDraft = () => ({
  areaGeojson: null,
  territories: [],
  contactExclusions: filters(),
  startsAt: null,
});

/** One actor and organization at a time. Late responses never restore old drafts. */
export function createTerritoryBuilderModel({
  request,
  context,
  changed = () => {},
}) {
  let epoch = 0;
  let state = {
    key: "",
    loading: false,
    busy: "",
    error: "",
    loaded: false,
    draft: emptyDraft(),
    step: "area",
    targetCount: 4,
    selectedId: "",
    history: [],
    revision: 0,
    review: null,
    dirty: false,
    publishKey: "",
  };
  const current = () => state.key && state.key === identity(context());
  const notify = () => changed(state);
  const guard = (key, version) => {
    if (!current() || state.key !== key || epoch !== version)
      throw new Error("Account or organization changed. Reopen Territories.");
  };
  function reset() {
    epoch++;
    state = {
      key: "",
      loading: false,
      busy: "",
      error: "",
      loaded: false,
      draft: emptyDraft(),
      step: "area",
      targetCount: 4,
      selectedId: "",
      history: [],
      revision: 0,
      review: null,
      dirty: false,
      publishKey: "",
    };
  }
  async function call(suffix, options = {}) {
    const key = state.key,
      version = epoch,
      scope = context();
    guard(key, version);
    const result = await request(territoryBuilderBase(scope, suffix), {
      auth: true,
      ...options,
      headers: { "X-Polis-Expected-Actor": scope.userId },
      beforeRequest: () => guard(key, version),
    });
    guard(key, version);
    return result;
  }
  async function load({ force = false } = {}) {
    const key = identity(context());
    if (!key) {
      reset();
      notify();
      return;
    }
    if (current() && (state.loading || (state.loaded && !force))) return;
    reset();
    state.key = key;
    state.loading = true;
    notify();
    const version = epoch;
    try {
      const payload = await call("");
      if (
        payload.source?.complete !== true ||
        !Array.isArray(payload.points) ||
        !Array.isArray(payload.staff) ||
        !Array.isArray(payload.areas)
      )
        throw new Error(
          "Complete territory planning data is unavailable. Try again.",
        );
      state.bootstrap = payload;
      state.revision = payload.revision;
      state.draft = payload.draft ? copy(payload.draft) : emptyDraft();
      state.draft.contactExclusions = filters(state.draft.contactExclusions);
      state.draft.territories ||= [];
      state.selectedId = state.draft.territories[0]?.id || "";
      state.targetCount = Math.min(
        payload.limits?.maxTerritories || 12,
        Math.max(1, state.draft.territories.length || 4),
      );
      state.loaded = true;
    } catch (error) {
      if (version !== epoch || !current()) return;
      state.error =
        error.status === 403
          ? "You no longer have permission to manage these territories."
          : error.message || "Territories could not be loaded.";
    } finally {
      if (version === epoch && current()) {
        state.loading = false;
        notify();
      }
    }
  }
  function edit(change) {
    if (!current() || !state.loaded || state.busy) return false;
    state.history.push(copy(state.draft));
    if (state.history.length > 30) state.history.shift();
    change(state.draft);
    state.review = null;
    state.publishKey = "";
    state.published = null;
    state.error = "";
    state.notice = "";
    state.dirty = true;
    notify();
    return true;
  }
  function undo() {
    if (!current() || state.busy || !state.history.length) return;
    state.draft = state.history.pop();
    state.review = null;
    state.publishKey = "";
    state.error = "";
    state.dirty = true;
    notify();
  }
  async function run(action, mode = "manual") {
    if (
      !current() ||
      !state.loaded ||
      state.busy ||
      !state.draft.areaGeojson ||
      state.conflict
    )
      return false;
    const key = state.key,
      version = epoch;
    state.busy = action;
    state.error = "";
    state.notice = "";
    const body = builderPayload(state, mode);
    if (action === "publish") {
      const blocked = publishBlockReason(state);
      if (blocked) {
        state.busy = "";
        state.error = blocked;
        notify();
        return false;
      }
      state.publishKey ||= globalThis.crypto.randomUUID();
      body.idempotencyKey = state.publishKey;
    }
    notify();
    try {
      const response = await call(`/${action}`, {
        method: action === "draft" ? "PUT" : "POST",
        body,
      });
      guard(key, version);
      if (action === "preview") {
        if (!Array.isArray(response.territories) || !response.summary)
          throw new Error("The territory preview is incomplete. Try again.");
        if (mode !== "manual") {
          state.history.push(copy(state.draft));
          state.dirty = true;
          state.publishKey = "";
        }
        state.draft.territories = copy(response.territories);
        state.selectedId = state.draft.territories.some(
          (t) => t.id === state.selectedId,
        )
          ? state.selectedId
          : state.draft.territories[0]?.id || "";
        state.review = response;
      } else if (action === "draft") {
        state.revision = response.revision;
        state.publishKey = "";
        state.dirty = false;
        state.notice = "Draft saved";
      } else {
        state.revision = response.revision;
        state.published = response;
        state.dirty = false;
        state.notice = "Territories published";
      }
      return true;
    } catch (error) {
      if (version !== epoch || !current()) return false;
      if (
        (error.status === 403 &&
          error.message !== "territory_builder_area_outside_boundary") ||
        error.status === 401
      ) {
        state.bootstrap = null;
        state.draft = emptyDraft();
        state.review = null;
        state.history = [];
        state.loaded = false;
      }
      if (error.status === 409) state.conflict = true;
      state.error =
        error.status === 409
          ? "This plan or its source data changed. Reload before publishing again."
          : failureMessage(error);
      return false;
    } finally {
      if (version === epoch && current()) {
        state.busy = "";
        notify();
      }
    }
  }
  function setStep(step) {
    if (state.busy || !["area", "cut", "assign"].includes(step)) return;
    if (step !== "area" && !state.draft.areaGeojson) return;
    if (step === "assign" && !state.draft.territories.length) return;
    state.step = step;
    notify();
  }
  function select(id) {
    if (!current() || state.busy) return;
    state.selectedId = id;
    notify();
  }
  function setCount(value) {
    if (!current() || state.busy) return;
    state.targetCount = Math.max(
      1,
      Math.min(
        state.bootstrap?.limits?.maxTerritories || 12,
        Math.floor(Number(value)) || 1,
      ),
    );
    state.review = null;
    state.publishKey = "";
    notify();
  }
  return {
    load,
    reset,
    edit,
    undo,
    run,
    setStep,
    select,
    setCount,
    get state() {
      return state;
    },
  };
}
