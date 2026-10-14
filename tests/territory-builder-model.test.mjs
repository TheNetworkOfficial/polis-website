import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../frontend/src/pages/shared-feed/scripts/territoryBuilderModel.js",
    import.meta.url,
  ),
  "utf8",
);
const {
  createTerritoryBuilderModel,
  builderPayload,
  territoryBuilderBase,
  pointInGeometry,
  polygonFromPoints,
  combineTrims,
  translateGeometry,
  sampledGeometryVertices,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const area = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ],
  ],
};
const territory = {
  id: "cut-one",
  name: "West",
  geojson: area,
  trimGeometry: null,
  locked: false,
  assigneeUserId: null,
};
const snapshotId = "a".repeat(64);
test("ballot territory handoff carries a frozen audience through metadata and plan payloads", () => {
  const ballotChase = {
    electionId: "az-general",
    snapshotId: "county-snapshot",
    outstandingOnly: true,
  };
  const path = territoryBuilderBase(
    {
      scopeType: "coalition",
      scopeId: "org-a",
      contactSelectionId: "selection-one",
      ballotChase,
    },
    "",
    true,
  );
  const url = new URL(path, "https://fixture.example");
  assert.equal(url.searchParams.get("contactSelectionId"), "selection-one");
  assert.equal(url.searchParams.get("electionId"), "az-general");
  assert.equal(url.searchParams.get("ballotSnapshotId"), "county-snapshot");
  const payload = builderPayload({
    revision: 1,
    draft: {
      areaGeojson: area,
      territories: [territory],
      contactExclusions: {},
    },
    targetCount: 1,
    contactSelectionId: "selection-one",
    ballotChase,
  });
  assert.equal(payload.contactSelectionId, "selection-one");
  assert.deepEqual(payload.ballotChase, ballotChase);
  payload.ballotChase.electionId = "changed";
  assert.equal(ballotChase.electionId, "az-general");
});
const bootstrap = (draft = null) => ({
  ok: true,
  protocolVersion: 2,
  revision: 2,
  areas: [{ id: "area-one", name: "Operational area", geojson: area }],
  boundary: area,
  points: [],
  staff: [{ userId: "staff-one", displayName: "Sam Example", username: "sam" }],
  draft,
  source: {
    status: "ready",
    snapshotId,
    mappedAddressCount: 500000,
    unmappedRecordCount: 0,
    complete: true,
  },
});
const preview = (rows = [territory]) => ({
  ok: true,
  snapshotId,
  planHash: "b".repeat(64),
  territories: rows.map((t) => ({ ...t, addressCount: 1 })),
  summary: {
    totalAddressCount: 1,
    eligibleAddressCount: 1,
    excludedAddressCount: 0,
    allocatedAddressCount: 1,
    unallocatedAddressCount: 0,
  },
});
function harness(request, timers = {}) {
  let context = { scopeType: "coalition", scopeId: "org-a", userId: "actor-a" };
  const calls = [];
  const model = createTerritoryBuilderModel({
    ...timers,
    context: () => context,
    request: async (path, options) => {
      calls.push({ path, options });
      return request ? request(path, options) : bootstrap();
    },
  });
  return {
    model,
    calls,
    setContext(next) {
      context = next;
    },
  };
}
async function loaded(request) {
  const h = harness(request);
  await h.model.load();
  h.model.edit((d) => {
    d.areaGeojson = area;
    d.territories = [structuredClone(territory)];
  });
  return h;
}

test("uses existing coalition and candidate routes with explicit candidate scope", () => {
  assert.equal(
    territoryBuilderBase(
      { scopeType: "coalition", scopeId: "a b" },
      "/preview",
    ),
    "/api/coalitions/a%20b/voter-map/territory-builder/preview",
  );
  assert.equal(
    territoryBuilderBase({ scopeType: "candidate", scopeId: "a b" }, "/draft"),
    "/api/candidate-dashboard/voter-map/territory-builder/draft?candidateId=a%20b",
  );
});

test("both exclusions start off and can be independently enabled then disabled", async () => {
  const { model } = await loaded();
  assert.deepEqual(model.state.draft.contactExclusions, {
    excludeDoNotKnock: false,
    excludeReportedDanger: false,
  });
  model.edit((d) => {
    d.contactExclusions.excludeDoNotKnock = true;
  });
  model.edit((d) => {
    d.contactExclusions.excludeReportedDanger = true;
  });
  model.edit((d) => {
    d.contactExclusions.excludeDoNotKnock = false;
    d.contactExclusions.excludeReportedDanger = false;
  });
  assert.deepEqual(builderPayload(model.state).contactExclusions, {
    excludeDoNotKnock: false,
    excludeReportedDanger: false,
  });
});

test("payload strips display counts and unknown filters; staff IDs stay internal", async () => {
  const { model } = await loaded();
  model.edit((d) => {
    d.contactExclusions.unknown = true;
    d.territories[0].addressCount = 999;
    d.territories[0].assigneeUserId = "staff-one";
    d.startsAt = "2027-01-01T10:00:00.000Z";
  });
  const body = builderPayload(model.state);
  assert.deepEqual(Object.keys(body.contactExclusions), [
    "excludeDoNotKnock",
    "excludeReportedDanger",
  ]);
  assert.equal(body.territories[0].addressCount, undefined);
  assert.equal(body.territories[0].assigneeUserId, "staff-one");
  assert.equal(body.startsAt, "2027-01-01T10:00:00.000Z");
});

test("incomplete source never becomes a ready plan", async () => {
  const { model } = harness(() => ({
    ...bootstrap(),
    source: { complete: false },
  }));
  await model.load();
  assert.equal(model.state.loaded, false);
  assert.match(model.state.error, /Address preparation status/);
});

test("late bootstrap cannot overwrite a new actor or organization's data", async () => {
  let finish;
  const h = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = h.model.load();
  h.setContext({ scopeType: "coalition", scopeId: "org-b", userId: "actor-b" });
  h.model.reset();
  finish(bootstrap());
  await pending;
  assert.equal(h.model.state.loaded, false);
  assert.equal(h.model.state.bootstrap, undefined);
});

test("preview requests fence the actor and stop a mutation before dispatch on account change", async () => {
  const h = await loaded((path, options) => {
    if (options.method) {
      h.setContext({
        scopeType: "coalition",
        scopeId: "org-a",
        userId: "actor-b",
      });
      options.beforeRequest();
    }
    return bootstrap();
  });
  assert.equal(await h.model.run("draft"), false);
  const call = h.calls.at(-1);
  assert.equal(call.options.headers["X-Polis-Expected-Actor"], "actor-a");
  assert.equal(h.model.state.notice, "");
});

test("manual edits invalidate the last reviewed counts and prevent publish", async () => {
  const { model, calls } = await loaded((path, options) =>
    options.method ? preview() : bootstrap(),
  );
  await model.run("preview");
  assert.equal(model.state.review.summary.allocatedAddressCount, 1);
  model.edit((d) => {
    d.territories[0].name = "Changed";
  });
  const before = calls.length;
  assert.equal(await model.run("publish"), false);
  assert.equal(calls.length, before);
});

test("server guided result keeps locks and undo restores the prior complete draft", async () => {
  const lock = { ...territory, locked: true };
  const { model } = await loaded((path, options) =>
    options.method
      ? preview([lock, { ...territory, id: "cut-two", name: "East" }])
      : bootstrap(),
  );
  assert.equal(await model.run("preview", "guided"), true);
  assert.equal(model.state.draft.territories.length, 2);
  assert.equal(model.state.draft.territories[0].locked, true);
  model.undo();
  assert.equal(model.state.draft.territories.length, 1);
  assert.equal(model.state.review, null);
});

test("failed preview keeps manual geometry and exposes the real error", async () => {
  const { model } = await loaded((path, options) => {
    if (options.method) throw new Error("Territories overlap.");
    return bootstrap();
  });
  const before = structuredClone(model.state.draft);
  assert.equal(await model.run("preview"), false);
  assert.deepEqual(model.state.draft, before);
  assert.equal(model.state.error, "Territories overlap.");
});

test("draft save adopts revision without publishing; stale writes surface conflict", async () => {
  let conflict = false;
  const { model } = await loaded((path, options) => {
    if (!options.method) return bootstrap();
    if (conflict) throw Object.assign(new Error("conflict"), { status: 409 });
    return { ok: true, revision: 3 };
  });
  assert.equal(await model.run("draft"), true);
  assert.equal(model.state.revision, 3);
  assert.equal(model.state.published, null);
  conflict = true;
  assert.equal(await model.run("draft"), false);
  assert.match(model.state.error, /changed.*Reload/);
  assert.equal(model.state.revision, 3);
});

test("publish timeout reuses one idempotency key and never automatically retries", async () => {
  const keys = [];
  const { model } = await loaded((path, options) => {
    if (!options.method) return bootstrap();
    if (path.endsWith("/preview"))
      return preview([{ ...territory, assigneeUserId: "staff-one" }]);
    keys.push(options.body.idempotencyKey);
    if (keys.length === 1) throw new Error("Connection interrupted");
    return { ok: true, revision: 3, published: true, territories: [territory] };
  });
  await model.run("preview");
  assert.equal(await model.run("publish"), false);
  assert.equal(keys.length, 1);
  assert.equal(await model.run("publish"), true);
  assert.equal(keys[0], keys[1]);
  assert.equal(model.state.revision, 3);
});

test("revoked access removes authorized data from the active builder", async () => {
  const { model } = await loaded((path, options) => {
    if (options.method)
      throw Object.assign(new Error("Access revoked"), { status: 403 });
    return bootstrap();
  });
  await model.run("preview");
  assert.equal(model.state.bootstrap, null);
  assert.equal(model.state.loaded, false);
  assert.equal(model.state.draft.territories.length, 0);
});

test("candidate boundary validation preserves the editable plan and bootstrap", async () => {
  const { model } = await loaded((path, options) => {
    if (options.method)
      throw Object.assign(
        new Error("territory_builder_area_outside_boundary"),
        { status: 403 },
      );
    return bootstrap();
  });
  await model.run("preview");
  assert.equal(model.state.loaded, true);
  assert.equal(model.state.draft.territories.length, 1);
  assert.match(model.state.error, /inside your campaign boundary/);
});

test("server limits and persisted exclusions survive a new builder session", async () => {
  const saved = {
    areaGeojson: area,
    territories: [territory],
    contactExclusions: {
      excludeDoNotKnock: true,
      excludeReportedDanger: false,
    },
    startsAt: null,
  };
  const h = harness(() => ({
    ...bootstrap(saved),
    limits: { maxTerritories: 12 },
  }));
  await h.model.load();
  h.model.setCount(100);
  assert.equal(h.model.state.targetCount, 12);
  assert.equal(h.model.state.draft.contactExclusions.excludeDoNotKnock, true);
  assert.equal(
    h.model.state.draft.contactExclusions.excludeReportedDanger,
    false,
  );
});

test("geometry membership respects holes and multiple islands, and trim preserves prior masks", () => {
  const hole = [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
    [1, 1],
  ];
  const withHole = { ...area, coordinates: [...area.coordinates, hole] };
  assert.equal(pointInGeometry([2, 2], withHole), false);
  assert.equal(pointInGeometry([0.5, 2], withHole), true);
  assert.equal(pointInGeometry([9, 9], withHole), false);
  const combined = combineTrims(
    area,
    polygonFromPoints([
      [10, 10],
      [11, 10],
      [11, 11],
    ]),
  );
  assert.equal(combined.type, "MultiPolygon");
  assert.equal(combined.coordinates.length, 2);
  assert.equal(pointInGeometry([10.8, 10.2], combined), true);
  assert.throws(
    () =>
      polygonFromPoints([
        [0, 0],
        [1, 1],
      ]),
    /three corners/,
  );
});

test("publishing requires eligible staff and positive authoritative address counts; drafts remain saveable", async () => {
  let row = { ...territory };
  const { model, calls } = await loaded((path, options) => {
    if (!options.method) return bootstrap();
    if (path.endsWith("/preview"))
      return {
        ...preview([row]),
        territories: [{ ...row, addressCount: row.addressCount ?? 1 }],
      };
    return { ok: true, revision: 3 };
  });
  await model.run("preview");
  assert.equal(await model.run("publish"), false);
  assert.match(model.state.error, /Choose staff/);
  assert.equal(await model.run("draft"), true);
  row = { ...territory, assigneeUserId: "staff-no-longer-eligible" };
  await model.run("preview");
  assert.equal(await model.run("publish"), false);
  row = { ...territory, assigneeUserId: "staff-one", addressCount: 0 };
  await model.run("preview");
  assert.equal(await model.run("publish"), false);
  assert.match(model.state.error, /at least one address/);
  assert.equal(calls.filter(({ path }) => path.endsWith("/publish")).length, 0);
});

test("20,000-vertex multipolygon exposes 64 globally sampled handles with original indices and unchanged geometry", () => {
  const ring = (size, offset) => {
    const points = Array.from({ length: size }, (_, i) => [
      Math.cos((i / size) * Math.PI * 2) + offset,
      Math.sin((i / size) * Math.PI * 2),
    ]);
    return [...points, [...points[0]]];
  };
  const geometry = {
    type: "MultiPolygon",
    coordinates: [[ring(10000, 0), ring(5000, 0)], [ring(5000, 3)]],
  };
  const original = JSON.stringify(geometry);
  const sampled = sampledGeometryVertices(geometry);
  assert.equal(sampled.length, 64);
  assert.equal(
    new Set(sampled.map(({ pi, ri, vi }) => `${pi}:${ri}:${vi}`)).size,
    64,
  );
  assert.equal(new Set(sampled.map(({ pi, ri }) => `${pi}:${ri}`)).size, 3);
  for (const { pi, ri, vi, point } of sampled)
    assert.equal(point, geometry.coordinates[pi][ri][vi]);
  assert.deepEqual(sampled[0], {
    point: geometry.coordinates[0][0][0],
    pi: 0,
    ri: 0,
    vi: 0,
  });
  assert.equal(sampled.at(-1).vi, 4999);
  assert.equal(JSON.stringify(geometry), original);
  assert.equal(sampledGeometryVertices(area).length, 4);
});

test("whole-boundary movement preserves all polygon rings and moves trim geometry by the same delta", () => {
  const geometry = {
    type: "MultiPolygon",
    coordinates: [area.coordinates, area.coordinates],
  };
  const shifted = translateGeometry(geometry, 0.2, -0.3);
  assert.deepEqual(shifted.coordinates[1][0][0], [0.2, -0.3]);
  assert.deepEqual(geometry.coordinates[1][0][0], [0, 0]);
  assert.deepEqual(
    translateGeometry(area, 0.2, -0.3).coordinates,
    shifted.coordinates[0],
  );
});

const viewportResult = (count = 500000, id = "cluster:0:0") => ({
  ok: true,
  points: [
    { id, coordinates: [1, 1], count, doNotKnock: true, reportedDanger: true },
  ],
  source: bootstrap().source,
  viewportComplete: true,
  clustered: true,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("metadata opens before source preparation finishes; draft saves and polling preserve unsaved geometry", async () => {
  let ready = false,
    poll;
  const pending = {
    ...bootstrap(),
    source: { status: "preparing", complete: false, snapshotId: null },
  };
  const h = harness(
    (path, options) => {
      if (path.includes("/source")) return { status: "preparing" };
      if (options.method === "PUT") return { revision: 3 };
      return ready ? bootstrap() : pending;
    },
    {
      schedule: (fn) => {
        poll = fn;
        return 1;
      },
      cancel: () => {},
    },
  );
  await h.model.load();
  await settle();
  assert.equal(h.model.state.loaded, true);
  assert.equal(h.model.state.source.status, "preparing");
  assert.equal(h.calls[0].path.endsWith("?protocol=2"), true);
  h.model.edit((d) => {
    d.areaGeojson = area;
    d.territories = [{ ...territory, name: "Unsaved custom name" }];
  });
  assert.equal(await h.model.run("draft"), true);
  h.model.edit((d) => {
    d.territories[0].name = "Keep this edit";
  });
  ready = true;
  poll();
  await settle();
  assert.equal(h.model.state.source.status, "ready");
  assert.equal(h.model.state.revision, 3);
  assert.equal(h.model.state.draft.territories[0].name, "Keep this edit");
  assert.equal(
    h.calls.filter(({ path }) => path.includes("/source")).length,
    1,
  );
  assert.equal(
    h.calls.some(({ path }) => path.includes("/points")),
    false,
  );
  h.model.reset();
});

test("candidate metadata appends protocol without losing explicit candidate scope", async () => {
  assert.equal(
    territoryBuilderBase(
      { scopeType: "candidate", scopeId: "one two" },
      "",
      true,
    ),
    "/api/candidate-dashboard/voter-map/territory-builder?candidateId=one%20two&protocol=2",
  );
});

test("cluster counts never become area totals and camera responses are accepted only for the latest viewport", async () => {
  const pending = [];
  const h = await loaded((path) =>
    path.endsWith("/points")
      ? new Promise((resolve) => pending.push(resolve))
      : bootstrap(),
  );
  const older = h.model.viewport([0, 0, 2, 2], 10);
  const newer = h.model.viewport([0, 0, 4, 4], 11);
  assert.equal(pending.length, 1, "only one source read is in flight");
  pending[0](viewportResult(1, "old"));
  await older;
  assert.deepEqual(h.model.state.points, []);
  assert.equal(pending.length, 2);
  pending[1](viewportResult(500000, "new"));
  await newer;
  assert.equal(h.model.state.points[0].id, "new");
  assert.equal(h.model.state.points[0].count, 500000);
  assert.equal(h.model.state.review, null);
  assert.equal(h.model.state.draft.territories[0].addressCount, undefined);
  assert.equal(await h.model.viewport([0, 0, 4, 4], 11), false);
  assert.equal(pending.length, 2);
});

test("slow map requests coalesce a pan storm into only the newest follow-up", async () => {
  const pending = [];
  const h = await loaded((path, options) =>
    path.endsWith("/points")
      ? new Promise((resolve) => pending.push({ resolve, body: options.body }))
      : bootstrap(),
  );
  const first = h.model.viewport([0, 0, 2, 2], 10);
  const skipped = [];
  for (let i = 0; i < 30; i++)
    skipped.push(h.model.viewport([0, 0, 3 + i, 3], 11));
  const camera = [0, 0, 40, 4];
  const last = h.model.viewport(camera, 12);
  camera[2] = 90;
  assert.equal(pending.length, 1);
  assert.deepEqual(await Promise.all(skipped), Array(30).fill(false));
  pending[0].resolve(viewportResult(1, "stale"));
  assert.equal(await first, false);
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[1].body.bbox, [0, 0, 40, 4]);
  assert.deepEqual(h.model.state.points, []);
  pending[1].resolve(viewportResult(500000, "latest"));
  assert.equal(await last, true);
  assert.equal(h.model.state.points[0].id, "latest");
  assert.equal(h.model.state.viewportBusy, false);
});

test("coalesced camera requests retain the frozen ballot audience on both active and newest queued reads", async () => {
  const pending = [],
    ballotChase = {
      electionId: "az-general",
      snapshotId: "county-snapshot",
      outstandingOnly: true,
    };
  const h = harness((path, options) =>
    path.endsWith("/points")
      ? new Promise((resolve) => pending.push({ resolve, body: options.body }))
      : bootstrap(),
  );
  h.setContext({
    scopeType: "coalition",
    scopeId: "org-a",
    userId: "actor-a",
    contactSelectionId: "selection-one",
    ballotChase,
  });
  await h.model.load();
  const first = h.model.viewport([0, 0, 2, 2], 10),
    skipped = [];
  for (let i = 0; i < 30; i++)
    skipped.push(h.model.viewport([0, 0, 3 + i, 3], 11));
  const latest = h.model.viewport([0, 0, 40, 4], 12);
  assert.equal(pending.length, 1);
  assert.deepEqual(await Promise.all(skipped), Array(30).fill(false));
  assert.equal(pending[0].body.contactSelectionId, "selection-one");
  assert.deepEqual(pending[0].body.ballotChase, ballotChase);
  pending[0].resolve(viewportResult(1, "old"));
  assert.equal(await first, false);
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[1].body.ballotChase, ballotChase);
  assert.equal(pending[1].body.contactSelectionId, "selection-one");
  assert.deepEqual(pending[1].body.bbox, [0, 0, 40, 4]);
  pending[1].resolve(viewportResult(1, "current"));
  assert.equal(await latest, true);
  assert.equal(h.model.state.points[0].id, "current");
});

test("reset and filter invalidation discard queued reads without releasing the active slot early", async () => {
  const pending = [];
  const h = await loaded((path) =>
    path.endsWith("/points")
      ? new Promise((resolve) => pending.push(resolve))
      : bootstrap(),
  );
  const active = h.model.viewport([0, 0, 2, 2], 10);
  const queued = h.model.viewport([0, 0, 3, 3], 11);
  h.model.edit((d) => {
    d.contactExclusions.excludeReportedDanger = true;
  });
  assert.equal(await queued, false);
  const filtered = h.model.viewport([0, 0, 3, 3], 11);
  assert.equal(pending.length, 1);
  h.model.reset();
  assert.equal(await filtered, false);
  pending[0](viewportResult());
  assert.equal(await active, false);
  assert.equal(pending.length, 1);
  assert.deepEqual(h.model.state.points, []);
  assert.equal(h.model.state.loaded, false);
});

test("filter changes clear visible points immediately and reject a delayed response with old exclusions", async () => {
  let resolve;
  const h = await loaded((path) =>
    path.endsWith("/points")
      ? new Promise((done) => {
          resolve = done;
        })
      : bootstrap(),
  );
  const old = h.model.viewport([0, 0, 4, 4], 11);
  h.model.edit((d) => {
    d.contactExclusions.excludeDoNotKnock = true;
  });
  resolve(viewportResult());
  await old;
  assert.deepEqual(h.model.state.points, []);
  assert.equal(h.model.state.viewportKey, "");
  assert.equal(
    h.calls.at(-1).options.body.contactExclusions.excludeDoNotKnock,
    false,
  );
});

test("oversized, incomplete and wrong-snapshot viewport responses never show partial inventory", async () => {
  for (const result of [
    {
      ...viewportResult(),
      points: Array.from({ length: 1001 }, () => viewportResult().points[0]),
    },
    { ...viewportResult(), viewportComplete: false },
    {
      ...viewportResult(),
      source: { ...bootstrap().source, snapshotId: "c".repeat(64) },
    },
  ]) {
    const h = await loaded((path) =>
      path.endsWith("/points") ? result : bootstrap(),
    );
    assert.equal(await h.model.viewport([0, 0, 4, 4], 10), false);
    assert.deepEqual(h.model.state.points, []);
    assert.match(h.model.state.viewportError, /incomplete/);
  }
});

test("source-change preview recovery preserves geometry without turning into a revision conflict", async () => {
  const h = await loaded((path) => {
    if (path.endsWith("/preview"))
      throw Object.assign(new Error("territory_builder_source_changed"), {
        status: 409,
      });
    if (path.endsWith("/source")) return { status: "ready" };
    return bootstrap();
  });
  const draft = structuredClone(h.model.state.draft);
  assert.equal(await h.model.run("preview"), false);
  assert.deepEqual(h.model.state.draft, draft);
  assert.equal(h.model.state.conflict, undefined);
  assert.equal(h.model.state.source.status, "ready");
  assert.equal(h.model.state.review, null);
  assert.equal(
    h.calls.filter(({ path }) => path.endsWith("/source")).length,
    1,
  );
});

test("revoked viewport access invalidates an in-flight preview before it can restore authorized data", async () => {
  let resolvePreview;
  const h = await loaded((path) => {
    if (path.endsWith("/preview"))
      return new Promise((resolve) => {
        resolvePreview = resolve;
      });
    if (path.endsWith("/points"))
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    return bootstrap();
  });
  const pending = h.model.run("preview");
  await h.model.viewport([0, 0, 4, 4], 11);
  resolvePreview(preview());
  await pending;
  assert.equal(h.model.state.loaded, false);
  assert.equal(h.model.state.bootstrap, null);
  assert.equal(h.model.state.review, null);
  assert.deepEqual(h.model.state.points, []);
  assert.deepEqual(h.model.state.draft.territories, []);
});

test("actor change prevents a pending camera response from entering the next workspace", async () => {
  let resolve;
  const h = await loaded((path) =>
    path.endsWith("/points")
      ? new Promise((done) => {
          resolve = done;
        })
      : bootstrap(),
  );
  const pending = h.model.viewport([0, 0, 4, 4], 10);
  h.setContext({ scopeType: "coalition", scopeId: "other", userId: "other" });
  h.model.reset();
  resolve(viewportResult());
  await pending;
  assert.deepEqual(h.model.state.points, []);
  assert.equal(h.model.state.loaded, false);
});

test("revocation from an older camera cancels the newest queued view and any pending preview", async () => {
  let rejectPoints,
    resolvePreview,
    pointsCalls = 0;
  const h = await loaded((path) => {
    if (path.endsWith("/points")) {
      pointsCalls++;
      return new Promise((_, reject) => {
        rejectPoints = reject;
      });
    }
    if (path.endsWith("/preview"))
      return new Promise((resolve) => {
        resolvePreview = resolve;
      });
    return bootstrap();
  });
  const previewRequest = h.model.run("preview");
  const active = h.model.viewport([0, 0, 2, 2], 10);
  const queued = h.model.viewport([0, 0, 4, 4], 11);
  rejectPoints(Object.assign(new Error("Forbidden"), { status: 403 }));
  assert.equal(await active, false);
  assert.equal(await queued, false);
  resolvePreview(preview());
  assert.equal(await previewRequest, false);
  assert.equal(pointsCalls, 1);
  assert.equal(h.model.state.loaded, false);
  assert.equal(h.model.state.review, null);
  assert.deepEqual(h.model.state.points, []);
});
