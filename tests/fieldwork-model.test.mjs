import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  let source = await readFile(
    new URL(
      `../frontend/src/pages/shared-feed/scripts/${name}.js`,
      import.meta.url,
    ),
    "utf8",
  );
  for (const match of [...source.matchAll(/from "\.\/([\w]+)(?:\.js)?"/g)])
    source = source.replaceAll(match[0], `from "${await moduleUrl(match[1])}"`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  modules.set(name, url);
  return url;
}
const model = await import(await moduleUrl("coalitionFieldWorkModel"));
const NOW = Date.parse("2026-10-26T18:00:00Z");
const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-114.01, 46.86],
      [-114, 46.86],
      [-114, 46.87],
      [-114.01, 46.87],
      [-114.01, 46.86],
    ],
    [
      [-114.006, 46.864],
      [-114.004, 46.864],
      [-114.004, 46.866],
      [-114.006, 46.866],
      [-114.006, 46.864],
    ],
  ],
};

test("unmapped voter coordinates remain absent instead of creating a pin at 0,0", () => {
  for (const [lat, lng] of [
    [null, null],
    ["", ""],
    [undefined, undefined],
    ["abc", "0"],
    [91, 0],
    [0, 181],
  ])
    assert.equal(model.fieldPoint({ lat, lng }), null);
  assert.deepEqual(model.fieldPoint({ lat: 0, lng: 0 }), [0, 0]);
  assert.deepEqual(
    model.fieldPoint({ lat: "46.86", lng: "-114.01" }),
    [-114.01, 46.86],
  );
});

test("pin colors preserve the authoritative outreach meanings and unknown state", () => {
  assert.equal(
    model.fieldPinStatus({ pinStatus: { state: "red" } }),
    "remaining",
  );
  assert.equal(
    model.fieldPinStatus({
      pinStatus: { state: "green", reservation: { expiresAt: NOW + 30000 } },
    }),
    "reserved",
  );
  assert.equal(model.fieldPinStatus({ pinStatus: { state: "blue" } }), "clear");
  assert.equal(model.fieldPinStatus({}), "unknown");
  assert.equal(model.fieldStatusLabels.remaining, "Outreach remaining");
  assert.equal(model.fieldStatusLabels.clear, "No pending outreach");
  assert.doesNotMatch(
    Object.values(model.fieldStatusLabels).join(" "),
    /knocked|completed visit/i,
  );
});

test("authoring requires both management and a fresh positive authoring capability", () => {
  assert.equal(
    model.fieldAccess({ scope: "full", canManageTerritories: true }).canAuthor,
    false,
  );
  assert.equal(
    model.fieldAccess({
      scope: "full",
      canManageTerritories: false,
      capabilities: { territoryAuthoringAccess: true },
    }).canAuthor,
    false,
  );
  const access = model.fieldAccess({
    scope: "full",
    canManageTerritories: true,
    capabilities: { territoryAuthoringAccess: false },
  });
  assert.equal(access.canManageTerritories, true);
  assert.equal(access.canAuthor, false);
  assert.equal(
    model.fieldAccess({
      scope: "full",
      canManageTerritories: true,
      capabilities: { territoryAuthoringAccess: true },
    }).canAuthor,
    true,
  );
});

test("scheduled, expired, revoked and malformed assignments never become active", () => {
  const active = {
    status: "active",
    startsAt: "2026-10-25T18:00:00Z",
    endsAt: "2026-10-27T18:00:00Z",
  };
  assert.equal(model.fieldAssignmentActive(active, NOW), true);
  assert.equal(
    model.fieldAssignmentActive(
      { ...active, startsAt: "2026-10-27T18:00:00Z" },
      NOW,
    ),
    false,
  );
  assert.equal(
    model.fieldAssignmentActive(
      { ...active, endsAt: "2026-10-26T18:00:00Z" },
      NOW,
    ),
    false,
  );
  assert.equal(
    model.fieldAssignmentActive({ ...active, status: "revoked" }, NOW),
    false,
  );
  assert.equal(
    model.fieldAssignmentActive({ ...active, startsAt: "broken" }, NOW),
    false,
  );
});

test("territory membership preserves polygon holes and FeatureCollection boundaries", () => {
  const territory = model.fieldTerritory({
    territoryId: "north",
    geojson: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: polygon }],
    },
  });
  assert.equal(
    model.fieldInTerritory({ lat: 46.862, lng: -114.008 }, territory),
    true,
  );
  assert.equal(
    model.fieldInTerritory({ lat: 46.865, lng: -114.005 }, territory),
    false,
  );
  assert.equal(
    model.fieldInTerritory({ lat: 46.88, lng: -114.008 }, territory),
    false,
  );
});

test("My areas filters only server returned records within real assigned geometry", () => {
  const territory = model.fieldTerritory({
    territoryId: "north",
    geojson: polygon,
  });
  const records = [
    model.fieldVoter({
      recordId: "inside",
      displayName: "Avery",
      lat: 46.862,
      lng: -114.008,
    }),
    model.fieldVoter({
      recordId: "hole",
      displayName: "Taylor",
      lat: 46.865,
      lng: -114.005,
    }),
    model.fieldVoter({
      recordId: "outside",
      displayName: "Jordan",
      lat: 46.88,
      lng: -114.008,
    }),
  ];
  assert.deepEqual(
    model
      .fieldFilterRecords(records, {
        area: "mine",
        territories: [territory],
        myTerritoryIds: ["north"],
      })
      .map((row) => row.recordId),
    ["inside"],
  );
  assert.deepEqual(
    model.fieldFilterRecords(records, {
      area: "mine",
      territories: [territory],
      myTerritoryIds: [],
    }),
    [],
  );
  assert.deepEqual(
    model.fieldFilterRecords(records, {
      area: "all",
      territories: [territory],
      query: "nobody",
    }),
    [],
  );
});

test("record names and note text are escaped without losing their content", () => {
  assert.equal(
    model.fieldEscape("<img src=\"x\" onerror='alert(1)'>&"),
    "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
  );
});

test("legacy field links preserve their event identity and go to the correct owner", async () => {
  const routes = await import(await moduleUrl("coalitionFieldWorkRoutes"));
  assert.equal(
    routes.canonicalCoalitionFieldWorkPath(
      "/coalitions/cedar/voter-map/members",
      "?q=Taylor",
    ),
    "/coalitions/cedar/members/directory?q=Taylor",
  );
  assert.equal(
    routes.canonicalCoalitionFieldWorkPath(
      "/coalitions/cedar/voter-map/cta",
      "?eventId=shift-1",
    ),
    "/coalitions/cedar/calendar/field-events?eventId=shift-1",
  );
  assert.equal(
    routes.canonicalCoalitionFieldWorkPath(
      "/coalitions/cedar/voter-map/cta/transport/shift%201",
      "?tab=pickup",
    ),
    "/coalitions/cedar/calendar/field-events/transport?tab=pickup&eventId=shift+1",
  );
  assert.equal(
    routes.canonicalCoalitionFieldWorkPath(
      "/coalitions/cedar/voter-map/scripts",
    ),
    "/coalitions/cedar/admin/edit/outreach",
  );
  assert.equal(
    routes.canonicalCoalitionFieldWorkPath(
      "/coalitions/cedar/field-work/map",
      "?area=north",
    ),
    "/coalitions/cedar/voter-map/map?area=north",
  );
  assert.equal(
    routes.canonicalCoalitionFieldWorkPath("/coalitions/cedar/missions"),
    "",
  );
  assert.equal(
    routes.coalitionFieldToolOwner(["members", "directory"]),
    "members",
  );
  assert.equal(
    routes.coalitionFieldToolOwner(["calendar", "field-events", "transport"]),
    "cta/transport",
  );
  assert.equal(
    routes.coalitionFieldToolOwner(["admin", "edit", "outreach"]),
    "scripts",
  );
});

test("an actor change during credential resolution blocks the queued request before dispatch", async () => {
  const { createCoalitionFieldWork } = await import(
    await moduleUrl("coalitionFieldWork")
  );
  const { createTextingSessionRequest } = await import(
    await moduleUrl("textingSession")
  );
  let current = {
    userId: "alex",
    sessionKey: "session-a",
    coalitionId: "cedar",
    membership: {},
    enabled: true,
  };
  let release;
  const delay = new Promise((resolve) => {
    release = resolve;
  });
  let enteredRestore;
  const restoring = new Promise((resolve) => {
    enteredRestore = resolve;
  });
  const dispatched = [];
  let session = { userId: "alex", idToken: "session-a" };
  const transport = createTextingSessionRequest({
    getSession: () => session,
    restoreSession: async () => {
      enteredRestore();
      await delay;
      return session;
    },
    saveSession: (next) => {
      session = next;
    },
    userId: (value) => value?.userId || "",
    contextKey: () => `/coalitions/${current.coalitionId}/voter-map`,
    request: async (url) => {
      dispatched.push(url);
      return { ok: true, scope: "full", territories: [] };
    },
  });
  const runtime = createCoalitionFieldWork({
    context: () => current,
    request: transport,
  });
  const loading = runtime.load();
  await restoring;
  current = { ...current, userId: "sam", sessionKey: "session-b" };
  release();
  await loading;
  assert.deepEqual(dispatched, []);
  runtime.reset();
});

test("same-user credential rotation is fenced synchronously by Field Work through the actual transport", async () => {
  const { createCoalitionFieldWork } = await import(
    await moduleUrl("coalitionFieldWork")
  );
  const { createTextingSessionRequest, textingRequestWasNotDispatched } =
    await import(await moduleUrl("textingSession"));
  let session = { userId: "alex", idToken: "session-a" };
  let current = {
    userId: "alex",
    sessionKey: "session-a",
    coalitionId: "cedar",
    membership: {},
    enabled: true,
  };
  let release;
  const delay = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const dispatched = [];
  const failures = [];
  let invalidations = 0;
  const transport = createTextingSessionRequest({
    getSession: () => session,
    restoreSession: async () => {
      started();
      await delay;
      return { userId: "alex", idToken: "session-b" };
    },
    saveSession: (next) => {
      session = next;
      current = { ...current, sessionKey: next.idToken };
    },
    userId: (value) => value?.userId || "",
    contextKey: () => "/coalitions/cedar/voter-map",
    request: async (url) => {
      dispatched.push(url);
      return { ok: true };
    },
  });
  const runtime = createCoalitionFieldWork({
    context: () => current,
    onContextInvalidated: () => invalidations++,
    request: async (...args) => {
      try {
        return await transport(...args);
      } catch (error) {
        failures.push(error);
        throw error;
      }
    },
  });
  const loading = runtime.load();
  await entered;
  const dispatchedBeforeGuardFinished = dispatched.length;
  release();
  await loading;
  assert.equal(dispatchedBeforeGuardFinished, 0);
  assert.deepEqual(dispatched, []);
  assert.equal(invalidations, 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /Account or workspace changed/);
  assert.equal(textingRequestWasNotDispatched(failures[0]), true);
  runtime.reset();
});

test("a delayed access response cannot start reads in another coalition", async () => {
  const { createCoalitionFieldWork } = await import(
    await moduleUrl("coalitionFieldWork")
  );
  let current = {
    userId: "alex",
    sessionKey: "session-a",
    coalitionId: "cedar",
    membership: {},
    enabled: true,
  };
  let release;
  const delay = new Promise((resolve) => {
    release = resolve;
  });
  const requested = [];
  const runtime = createCoalitionFieldWork({
    context: () => current,
    request: async (url, options) => {
      await options.beforeRequest();
      requested.push(url);
      await delay;
      return {
        ok: true,
        scope: "full",
        territories: [],
        canManageTerritories: true,
      };
    },
  });
  const loading = runtime.load();
  await Promise.resolve();
  current = { ...current, coalitionId: "riverside" };
  release();
  await loading;
  assert.deepEqual(requested, ["/api/coalitions/cedar/voter-map/access"]);
  runtime.reset();
});
