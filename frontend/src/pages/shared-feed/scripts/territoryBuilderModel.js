const copy = (value) => JSON.parse(JSON.stringify(value));
const filters = (value = {}) => ({
  excludeDoNotKnock: value.excludeDoNotKnock === true,
  excludeReportedDanger: value.excludeReportedDanger === true,
});
const sourceErrors = new Set([
  "territory_builder_source_changed",
  "territory_builder_source_preparing",
  "territory_builder_source_generation_changed",
]);
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
  territory_builder_source_preparing:
    "Addresses are being prepared. You can keep editing or save your draft.",
  territory_builder_source_changed:
    "Address data changed. Refresh addresses, then check coverage again.",
};
const failureMessage = (error) =>
  validationMessages[error.message] ||
  (error.message?.startsWith("territory_builder_")
    ? "This plan could not be validated. Check the boundaries and assignments, then try again."
    : error.message) ||
  "The change could not be completed. Try again.";

export const territoryBuilderBase = (
  { scopeType, scopeId, contactSelectionId, ballotChase },
  suffix = "",
  metadata = false,
) => {
  const base =
    scopeType === "candidate"
      ? `/api/candidate-dashboard/voter-map/territory-builder${suffix}?candidateId=${encodeURIComponent(scopeId)}`
      : `/api/coalitions/${encodeURIComponent(scopeId)}/voter-map/territory-builder${suffix}`;
  const result = metadata
    ? `${base}${scopeType === "candidate" ? "&" : "?"}protocol=2`
    : base;
  if (!metadata || !contactSelectionId || !ballotChase) return result;
  const query = new URLSearchParams({
    contactSelectionId,
    electionId: ballotChase.electionId,
    ballotSnapshotId: ballotChase.snapshotId,
  });
  return `${result}&${query}`;
};
const snapshotValid = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const sourceReady = (state) =>
  state.source?.status === "ready" &&
  state.source.complete === true &&
  snapshotValid(state.source.snapshotId);

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
  if (
    !sourceReady(state) ||
    state.review.snapshotId !== state.source.snapshotId
  )
    return "Refresh addresses and review the current plan before publishing.";
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
    protocolVersion: 2,
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
    ...(state.contactSelectionId && state.ballotChase
      ? {
          contactSelectionId: state.contactSelectionId,
          ballotChase: copy(state.ballotChase),
        }
      : {}),
    ...(mode === "split" ? { splitTerritoryId: state.selectedId } : {}),
  };
}

const identity = (context) =>
  context?.userId && context?.scopeId
    ? `${context.userId}:${context.scopeType}:${context.scopeId}${context.contactSelectionId ? `:${context.contactSelectionId}:${context.ballotChase?.snapshotId || ""}` : ""}`
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
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
}) {
  let epoch = 0,
    viewportEpoch = 0,
    sourceTimer,
    sourceRequest = false,
    viewportFlight = false,
    pendingViewport = null;
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
    source: null,
    points: [],
    viewportKey: "",
    viewportBusy: false,
    sourceBusy: false,
  };
  const current = () => state.key && state.key === identity(context());
  const notify = (kind) => changed(state, kind);
  const guard = (key, version) => {
    if (!current() || state.key !== key || epoch !== version)
      throw new Error("Account or organization changed. Reopen Territories.");
  };
  function reset() {
    discardPendingViewport();
    cancel(sourceTimer);
    sourceTimer = null;
    sourceRequest = false;
    viewportEpoch++;
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
      source: null,
      points: [],
      viewportKey: "",
      viewportBusy: false,
      sourceBusy: false,
    };
  }
  async function call(suffix, options = {}) {
    const key = state.key,
      version = epoch,
      scope = context();
    guard(key, version);
    const { metadata = false, ...requestOptions } = options;
    const result = await request(
      territoryBuilderBase(scope, suffix, metadata),
      {
        auth: true,
        ...requestOptions,
        headers: { "X-Polis-Expected-Actor": scope.userId },
        beforeRequest: () => guard(key, version),
      },
    );
    guard(key, version);
    return result;
  }
  function clearViewport() {
    discardPendingViewport();
    viewportEpoch++;
    state.points = [];
    state.viewportKey = "";
    state.viewportBusy = false;
  }
  function discardPendingViewport() {
    pendingViewport?.resolve(false);
    pendingViewport = null;
  }
  function receiveSource(value) {
    if (
      !value ||
      !["ready", "preparing", "unavailable"].includes(value.status) ||
      (value.status === "ready" &&
        (value.complete !== true || !snapshotValid(value.snapshotId)))
    )
      throw new Error(
        "Address preparation status is unavailable. Refresh to try again.",
      );
    if (value.snapshotId !== state.source?.snapshotId) {
      state.review = null;
      state.publishKey = "";
      clearViewport();
    }
    state.source = copy(value);
  }
  function failAccess(error) {
    if (error.status !== 401 && error.status !== 403) return false;
    epoch++;
    sourceRequest = false;
    cancel(sourceTimer);
    clearViewport();
    state.bootstrap = null;
    state.source = null;
    state.draft = emptyDraft();
    state.review = null;
    state.history = [];
    state.loaded = false;
    state.loading = false;
    state.busy = "";
    state.sourceBusy = false;
    state.error = "You no longer have permission to manage these territories.";
    notify();
    return true;
  }
  /** Poll only metadata; never replace an unsaved plan when its source is ready. */
  async function refreshSource({ prepare = true } = {}) {
    if (!current() || !state.loaded || sourceRequest) return false;
    cancel(sourceTimer);
    const version = epoch;
    sourceRequest = true;
    state.sourceBusy = true;
    state.sourceError = "";
    notify();
    try {
      if (prepare)
        await call("/source", {
          method: "POST",
          body: {
            protocolVersion: 2,
            ...(state.contactSelectionId && state.ballotChase
              ? {
                  contactSelectionId: state.contactSelectionId,
                  ballotChase: copy(state.ballotChase),
                }
              : {}),
          },
        });
      const payload = await call("", { metadata: true });
      if (payload.protocolVersion !== 2)
        throw new Error("Address preparation is unavailable. Try again.");
      receiveSource(payload.source);
      if (!sourceReady(state) && state.source.status === "preparing") {
        sourceTimer = schedule(() => {
          if (version === epoch && current())
            void refreshSource({ prepare: false });
        }, 5000);
      }
      return true;
    } catch (error) {
      if (version !== epoch || !current()) return false;
      if (!failAccess(error)) state.sourceError = failureMessage(error);
      return false;
    } finally {
      if (version === epoch && current()) {
        sourceRequest = false;
        state.sourceBusy = false;
        notify();
      }
    }
  }
  async function recoverSource() {
    state.source = { status: "preparing", complete: false, snapshotId: null };
    state.review = null;
    state.publishKey = "";
    clearViewport();
    await refreshSource();
  }
  /** Each response belongs to one actor, source, filter set and camera request. */
  async function viewport(bbox, zoom, { force = false } = {}) {
    if (!current() || !state.loaded || !sourceReady(state)) return false;
    const body = {
      snapshotId: state.source.snapshotId,
      bbox: Array.isArray(bbox) ? [...bbox] : bbox,
      zoom,
      contactExclusions: filters(state.draft.contactExclusions),
      ...(state.contactSelectionId && state.ballotChase
        ? {
            contactSelectionId: state.contactSelectionId,
            ballotChase: copy(state.ballotChase),
          }
        : {}),
    };
    const viewportKey = JSON.stringify(body);
    if (!force && state.viewportKey === viewportKey) return false;
    const version = epoch,
      ticket = ++viewportEpoch;
    state.viewportKey = viewportKey;
    state.points = [];
    state.viewportBusy = true;
    state.viewportError = "";
    notify("viewport");
    // A long source read must not multiply with every camera movement. Retain
    // one newest pending view while the existing request keeps its slot.
    if (viewportFlight) {
      discardPendingViewport();
      return new Promise((resolve) => {
        pendingViewport = { body, version, ticket, resolve };
      });
    }
    return performViewport({ body, version, ticket });
  }
  async function performViewport({ body, version, ticket }) {
    viewportFlight = true;
    try {
      const result = await call("/points", { method: "POST", body });
      if (version !== epoch || ticket !== viewportEpoch || !current())
        return false;
      if (
        result.viewportComplete !== true ||
        result.source?.complete !== true ||
        result.source?.snapshotId !== body.snapshotId ||
        !Array.isArray(result.points) ||
        result.points.length > 1000 ||
        result.points.some(
          (p) =>
            !p ||
            typeof p.id !== "string" ||
            !Array.isArray(p.coordinates) ||
            p.coordinates.length !== 2 ||
            !p.coordinates.every(Number.isFinite) ||
            Math.abs(p.coordinates[0]) > 180 ||
            Math.abs(p.coordinates[1]) > 90 ||
            !Number.isSafeInteger(p.count) ||
            p.count < 1,
        )
      )
        throw new Error(
          "Map addresses are incomplete. Refresh addresses to try again.",
        );
      state.points = copy(result.points);
      state.clustered = result.clustered === true;
      return true;
    } catch (error) {
      if (version !== epoch || !current()) return false;
      if (failAccess(error)) return false;
      if (ticket !== viewportEpoch) return false;
      if (sourceErrors.has(error.message)) await recoverSource();
      else state.viewportError = failureMessage(error);
      return false;
    } finally {
      if (version === epoch && ticket === viewportEpoch && current()) {
        state.viewportBusy = false;
        notify("viewport");
      }
      viewportFlight = false;
      const next = pendingViewport;
      pendingViewport = null;
      if (next) {
        if (
          next.version === epoch &&
          next.ticket === viewportEpoch &&
          current() &&
          sourceReady(state) &&
          state.source.snapshotId === next.body.snapshotId
        )
          void performViewport(next).then(next.resolve);
        else next.resolve(false);
      }
    }
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
    state.contactSelectionId = context().contactSelectionId || null;
    state.ballotChase = context().ballotChase
      ? copy(context().ballotChase)
      : null;
    state.loading = true;
    notify();
    const version = epoch;
    try {
      const payload = await call("", { metadata: true });
      if (
        payload.protocolVersion !== 2 ||
        !Array.isArray(payload.staff) ||
        !Array.isArray(payload.areas)
      )
        throw new Error(
          "Complete territory planning data is unavailable. Try again.",
        );
      state.bootstrap = payload;
      receiveSource(payload.source);
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
      if (!sourceReady(state)) void refreshSource();
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
    const previousFilters = JSON.stringify(
      filters(state.draft.contactExclusions),
    );
    change(state.draft);
    if (
      previousFilters !== JSON.stringify(filters(state.draft.contactExclusions))
    )
      clearViewport();
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
    clearViewport();
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
    if (action !== "draft" && !sourceReady(state)) {
      state.error = validationMessages.territory_builder_source_preparing;
      notify();
      void refreshSource();
      return false;
    }
    state.busy = action;
    state.error = "";
    state.notice = "";
    const body = builderPayload(state, mode);
    if (action !== "draft") body.snapshotId = state.source.snapshotId;
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
        if (state.source?.snapshotId !== body.snapshotId)
          throw Object.assign(new Error("territory_builder_source_changed"), {
            status: 409,
          });
        if (
          !Array.isArray(response.territories) ||
          !response.summary ||
          response.snapshotId !== body.snapshotId ||
          !snapshotValid(response.planHash) ||
          [
            "totalAddressCount",
            "eligibleAddressCount",
            "excludedAddressCount",
            "allocatedAddressCount",
            "unallocatedAddressCount",
          ].some(
            (key) =>
              !Number.isSafeInteger(response.summary[key]) ||
              response.summary[key] < 0,
          ) ||
          response.territories.some(
            (row) =>
              !Number.isSafeInteger(row.addressCount) || row.addressCount < 0,
          )
        )
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
      if (sourceErrors.has(error.message)) {
        state.error = validationMessages.territory_builder_source_changed;
        await recoverSource();
        return false;
      }
      if (
        (error.status === 403 &&
          error.message !== "territory_builder_area_outside_boundary") ||
        error.status === 401
      ) {
        failAccess(error);
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
    refreshSource,
    viewport,
    get state() {
      return state;
    },
  };
}
