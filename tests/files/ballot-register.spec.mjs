import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scripts = new URL(
  "../../frontend/src/pages/shared-feed/scripts/",
  import.meta.url,
);
const modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  let source = await readFile(new URL(`${name}.js`, scripts), "utf8");
  for (const match of [...source.matchAll(/from "\.\/([^"\n]+)"/g)])
    source = source.replace(match[0], `from "${await moduleUrl(match[1])}"`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  modules.set(name, url);
  return url;
}
const { createBallotRegister, ballotRegisterSelection, ballotRegisterValue } =
  await import(await moduleUrl("ballotRegister"));
const fields = [
  { fieldId: "displayName", label: "Name", type: "text", sortable: true },
  { fieldId: "precinct", label: "Precinct", type: "text", filterable: true },
  {
    fieldId: "source_Party",
    label: "County party",
    type: "text",
    sourceColumn: "Party",
  },
];
const rows = [
  {
    voterRef: "ref-alex",
    voterId: "00017",
    contactId: null,
    fields: {
      displayName: "Alex Example",
      precinct: "0007",
      source_Party: "Independent",
    },
    ballotState: {
      status: "accepted",
      sourceAsOf: "2026-10-15",
      returnedAt: "2026-10-14",
    },
  },
  {
    voterRef: "ref-blair",
    voterId: "00018",
    contactId: "existing-contact",
    fields: { displayName: "Blair Example", precinct: "0008" },
    ballotState: { status: "cure_required", sourceAsOf: "2026-10-15" },
  },
];
const result = (overrides = {}) => ({
  ok: true,
  storageMode: "register",
  items: structuredClone(rows),
  schema: fields,
  total: 500000,
  nextCursor: "second-page",
  complete: false,
  ballotChase: {
    electionId: "election",
    snapshotId: "snapshot",
    view: "returned",
  },
  ...overrides,
});
function setup(options = {}) {
  const calls = [],
    exports = [];
  let actor = true;
  const controller = createBallotRegister({
    base: "/ballot-chaser",
    electionId: "election",
    snapshotId: "snapshot",
    chaseView: "returned",
    schema: { capabilities: { read: true, import: true, export: true } },
    guard: () => {
      if (!actor) throw new Error("Account changed");
    },
    busy: () => false,
    changed: () => {},
    schedule: () => 0,
    cancel: () => {},
    beginExport: async (body) => exports.push(body),
    request: async (path, request) => {
      request.beforeRequest();
      calls.push({ path, ...request });
      return options.request ? options.request(path, request) : result();
    },
    ...options,
  });
  return {
    controller,
    calls,
    exports,
    switchActor: () => {
      actor = false;
    },
  };
}
const rowChange = (voterRef, checked) => ({
  dataset: { registerRow: voterRef },
  checked,
});

test("500k register browsing uses one bounded query and never creates contacts", async () => {
  const { controller, calls } = setup();
  await controller.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/ballot-chaser/elections/election/voters");
  assert.deepEqual(calls[0].body, {
    snapshotId: "snapshot",
    view: "returned",
    limit: 50,
  });
  assert.equal(controller.state().total, 500000);
  assert.equal(controller.state().query.sort.field, "displayName");
  assert.match(controller.render(), /Alex Example/);
  assert.match(controller.render(), /Accepted/);
  assert.match(controller.render(), /Needs cure/);
  assert.ok(!controller.render().includes('href="/contacts/ref-alex'));
  assert.equal(ballotRegisterValue(rows[0], "source_Party"), "Independent");
  assert.equal(ballotRegisterValue(rows[0], "ballotVoterId"), "00017");
});

test("register exports use voter references, declared source columns and pinned snapshot", async () => {
  const { controller, calls, exports } = setup();
  await controller.load();
  controller.change({
    dataset: { registerColumn: "source_Party" },
    checked: true,
  });
  controller.change(rowChange("ref-alex", true));
  await controller.action("register-export");
  assert.equal(calls.length, 1);
  assert.deepEqual(exports[0].selection, {
    mode: "explicit",
    includeVoterRefs: ["ref-alex"],
  });
  assert.equal(exports[0].snapshotId, "snapshot");
  assert.equal(exports[0].sort, undefined);
  assert.ok(exports[0].columns.includes("source_Party"));
  assert.ok(exports[0].columns.includes("ballotNewlyReturned"));
  assert.equal(exports[0].selection.includeIds, undefined);
});

test("all matching export keeps exclusions and sort without a 500k selection job", async () => {
  const { controller, calls, exports } = setup();
  await controller.load();
  await controller.action("register-select-all");
  controller.change(rowChange("ref-blair", false));
  await controller.action("register-export");
  assert.deepEqual(exports[0].selection, {
    mode: "all_matching",
    excludeVoterRefs: ["ref-blair"],
  });
  assert.equal(exports[0].sort.field, "displayName");
  assert.equal(calls.length, 1);
  await assert.rejects(controller.action("register-contacts"), /individual/);
});

test("a valid empty intermediate page still exposes its cursor", async () => {
  const bodies = [];
  const { controller } = setup({
    request: async (_, request) => {
      bodies.push(request.body);
      return result(
        bodies.length === 1
          ? { items: [], nextCursor: "sparse-cursor" }
          : { nextCursor: null },
      );
    },
  });
  await controller.load();
  await controller.action("register-next");
  assert.equal(bodies[1].cursor, "sparse-cursor");
  assert.equal(controller.state().rows.length, 2);
});

test("snapshot changes clear selection, private source details and rows", async () => {
  let stale = false;
  const { controller } = setup({
    request: async () => {
      if (stale)
        throw Object.assign(new Error("stale"), {
          payload: { error: "ballot_snapshot_changed" },
        });
      return result();
    },
  });
  await controller.load();
  controller.change(rowChange("ref-alex", true));
  await controller.action("register-source", "ref-alex");
  stale = true;
  await controller.action("register-next");
  assert.deepEqual(controller.state().rows, []);
  assert.equal(controller.state().included.size, 0);
  assert.doesNotMatch(controller.render(), /Alex Example/);
  assert.match(controller.render(), /Refresh this list/);
});

test("late query after actor change or disposal never populates the register", async () => {
  let release;
  const { controller, switchActor } = setup({
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const flight = controller.load();
  switchActor();
  release(result());
  await flight;
  assert.deepEqual(controller.state().rows, []);
  assert.equal(controller.render(), "");
});

test("wrong election/snapshot and undeclared response shapes fail closed", async () => {
  for (const response of [
    result({ ballotChase: { electionId: "other", snapshotId: "snapshot" } }),
    result({ ballotChase: { electionId: "election", snapshotId: "old" } }),
    result({
      ballotChase: {
        electionId: "election",
        snapshotId: "snapshot",
        view: "outstanding",
      },
    }),
    result({ schema: null }),
    result({ items: [{ fields: { displayName: "Untrusted" } }] }),
  ]) {
    const { controller } = setup({ request: async () => response });
    await controller.load();
    assert.deepEqual(controller.state().rows, []);
    assert.match(controller.state().error, /Refresh/);
  }
});

test("explicit add is a separate stable operation, survives lost ACK, and never sends", async () => {
  const posts = [];
  const { controller } = setup({
    request: async (path, request) => {
      if (path.endsWith("/voters")) return result();
      posts.push({ path, body: structuredClone(request.body) });
      if (posts.length === 1) throw new Error("Response interrupted");
      return {
        ok: true,
        job: {
          jobId: "contacts-one",
          status: "queued",
          total: 1,
          processed: 0,
          added: 0,
          linked: 0,
          reviewRequired: 0,
        },
      };
    },
  });
  await controller.load();
  controller.change(rowChange("ref-alex", true));
  await assert.rejects(controller.action("register-contacts"), /interrupted/);
  controller.change(rowChange("ref-blair", true));
  assert.deepEqual([...controller.state().included], ["ref-alex"]);
  await controller.action("register-contacts");
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(posts[0].path, "/ballot-chaser/elections/election/contacts");
  assert.deepEqual(posts[0].body.voterRefs, ["ref-alex"]);
  assert.equal(controller.state().materialization.status, "queued");
  controller.dispose();
});

test("read/export role cannot add contacts even if edit is true", async () => {
  const { controller } = setup({
    schema: {
      capabilities: { read: true, export: true, edit: true, import: false },
    },
  });
  await controller.load();
  controller.change(rowChange("ref-alex", true));
  assert.doesNotMatch(controller.render(), /Add selected to Contact Book/);
  await assert.rejects(controller.action("register-contacts"), /individual/);
});

test("selection helper preserves exact string voter references", () => {
  assert.deepEqual(
    ballotRegisterSelection({
      allMatching: false,
      included: new Set(["00001"]),
      excluded: new Set(),
    }),
    { mode: "explicit", includeVoterRefs: ["00001"] },
  );
});

test("redacted schema uses a supported default sort and never renders undeclared private fields", async () => {
  const { controller, calls } = setup({
    request: async () =>
      result({
        schema: [
          { fieldId: "ballotStatus", label: "Ballot status", type: "text" },
        ],
      }),
  });
  await controller.load();
  assert.equal(controller.state().query.sort.field, "ballotStatus");
  assert.deepEqual(controller.state().rows[0].fields, {});
  assert.doesNotMatch(controller.render(), /Alex Example|Independent/);
  assert.equal(calls.length, 0);
  controller.dispose();
});

test("search and typed nested filters use declared fields, retain leading zeroes and clear the prior export", async () => {
  let invalidated = 0;
  const { controller, calls } = setup({
    invalidateExport: () => invalidated++,
  });
  await controller.load();
  controller.state().filters = [
    { field: "precinct", op: "eq", value: "0007" },
    {
      op: "not",
      conditions: [{ field: "source_Party", op: "eq", value: "Party A" }],
    },
  ];
  const data = new FormData();
  for (const [key, value] of Object.entries({
    filterLogic: "and",
    field_0: "precinct",
    operator_0: "eq",
    value_0: "0007",
    group_1: "not",
    "field_1.0": "source_Party",
    "operator_1.0": "eq",
    "value_1.0": "Party A",
  }))
    data.set(key, value);
  await controller.submit("filters", data);
  assert.deepEqual(calls.at(-1).body.filter, {
    op: "and",
    conditions: [
      { field: "precinct", op: "eq", value: "0007" },
      {
        op: "not",
        conditions: [
          {
            op: "or",
            conditions: [{ field: "source_Party", op: "eq", value: "Party A" }],
          },
        ],
      },
    ],
  });
  assert.equal(invalidated, 1);
  const search = new FormData();
  search.set("search", "Alex");
  search.set("sort", "displayName:desc");
  await controller.submit("search", search);
  assert.equal(calls.at(-1).body.search, "Alex");
  assert.equal(calls.at(-1).body.sort.direction, "desc");
  search.set("sort", "unavailable-private-field:asc");
  await assert.rejects(controller.submit("search", search), /supported sort/);
});

test("a late Contact Book POST cannot retain a request in a different actor's view", async () => {
  let release;
  const { controller, switchActor } = setup({
    request: async (path) =>
      path.endsWith("/voters")
        ? result()
        : new Promise((resolve) => {
            release = resolve;
          }),
  });
  await controller.load();
  controller.change(rowChange("ref-alex", true));
  const flight = controller.action("register-contacts");
  switchActor();
  release({
    ok: true,
    job: {
      jobId: "late",
      status: "complete",
      total: 1,
      processed: 1,
      added: 1,
      linked: 0,
      reviewRequired: 0,
    },
  });
  await assert.rejects(flight, /Account changed/);
  assert.equal(controller.render(), "");
  assert.equal(controller.state().materializationIntent, null);
  assert.equal(controller.state().materialization, null);
});

test("Contact Book progress uses GET only, rejects an unrelated job and rechecks access", async () => {
  const paths = [];
  let denied = false;
  const { controller } = setup({
    request: async (path, options) => {
      paths.push({ path, method: options.method });
      if (path.endsWith("/voters")) return result();
      if (denied) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return {
        ok: true,
        job: {
          jobId: options.method === "POST" ? "one" : "other",
          status: "running",
          total: 1,
          processed: 0,
          added: 0,
          linked: 0,
          reviewRequired: 0,
        },
      };
    },
  });
  await controller.load();
  controller.change(rowChange("ref-alex", true));
  await controller.action("register-contacts");
  await controller.action("register-contacts-refresh");
  assert.equal(paths.at(-1).method, undefined);
  assert.equal(
    paths.at(-1).path,
    "/ballot-chaser/elections/election/contacts/one",
  );
  assert.match(controller.state().contactError, /could not be confirmed/);
  assert.equal(controller.state().materialization.jobId, "one");
  denied = true;
  await controller.action("register-contacts-refresh");
  assert.deepEqual(controller.state().rows, []);
  assert.equal(controller.state().materialization, null);
  assert.doesNotMatch(controller.render(), /Alex Example/);
  controller.dispose();
});
