import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "../texting/module-fixture.mjs";
const { createBallotPreparation, preparedReportDate } = await import(
  await moduleUrl("ballotPreparation")
);

test("date-only county reports preserve the date without requiring a made-up time", () => {
  assert.equal(preparedReportDate("2026-10-24"), "2026-10-24T00:00:00.000Z");
  assert.equal(preparedReportDate("2028-02-29"), "2028-02-29T00:00:00.000Z");
  assert.throws(() => preparedReportDate("2026-02-29"), /actual YYYY-MM-DD/);
});

test("a county timestamp must include a zone, and local-only times are rejected", () => {
  assert.equal(
    preparedReportDate("2026-10-24T12:00:00-07:00"),
    "2026-10-24T19:00:00.000Z",
  );
  assert.equal(
    preparedReportDate("2026-10-24T19:00Z"),
    "2026-10-24T19:00:00.000Z",
  );
  assert.throws(
    () => preparedReportDate("2026-10-24T12:00"),
    /time-zone offset/,
  );
  assert.throws(
    () => preparedReportDate("2026-10-24T25:00:00Z"),
    /actual YYYY-MM-DD/,
  );
});

const form = (values) => new Map(Object.entries(values));
const sourceForm = () => form({ delimiter: "comma", encoding: "utf-8" });
const baselineForm = () =>
  form({
    headersReviewed: "on",
    idColumn: "ID",
    districtColumn: "CD",
    districtValue: "8",
    partyColumn: "Party",
    partyValue: "ind",
  });
const returnForm = () => form({ headersReviewed: "on", idColumn: "Return ID" });
function fixture({ returns = false, handler, requestHandler, transport } = {}) {
  const calls = [],
    workerCalls = [],
    workers = [];
  let ctx = {
    allowed: true,
    canExport: true,
    base: "/org-one/ballot-chaser",
    electionId: "election-one",
    snapshotId: returns ? "snapshot-one" : null,
  };
  const controller = createBallotPreparation({
    guard: () => {},
    changed: () => {},
    context: () => ctx,
    pause: async () => {},
    createWorker: () => {
      const worker = {
        stopped: false,
        terminate() {
          this.stopped = true;
        },
        postMessage(message) {
          workerCalls.push(message);
          void Promise.resolve()
            .then(async () => {
              const result = handler
                ? await handler(message)
                : message.action === "inspect"
                  ? {
                      headers: returns
                        ? ["Return ID", "Date"]
                        : ["ID", "CD", "Party"],
                      sample: [["0001", "8", "ind"]],
                      delimiter: "comma",
                      encoding: "utf-8",
                    }
                  : message.action === "ids"
                    ? ["0001", "0002"]
                    : {
                        blob: new Blob(["Voter ID\r\n0001\r\n"]),
                        receipt: {
                          inputRows: 4,
                          selectedRows: 1,
                          excludedRows: 3,
                          unknownRows: 2,
                          duplicateRows: 1,
                          matchedUnique: 1,
                        },
                      };
              if (!worker.stopped)
                worker.onmessage({
                  data: { id: message.id, type: "result", result },
                });
            })
            .catch((error) => {
              if (!worker.stopped) worker.onerror(error);
            });
        },
      };
      workers.push(worker);
      return worker;
    },
    request: async (path, options) => {
      calls.push({ path, options });
      if (requestHandler) return requestHandler(path, options);
      return {
        ok: true,
        export: {
          exportId: "private-ids",
          snapshotId: "snapshot-one",
          status: "ready",
          rows: 2,
        },
        download: {
          method: "GET",
          url: "https://fixture-private.s3.us-west-2.amazonaws.com/ids.csv",
          expiresAt: Date.now() + 60000,
        },
      };
    },
    transport:
      transport ||
      (async (_, options) => {
        assert.equal(options.credentials, "omit");
        assert.equal(options.redirect, "error");
        return new Response("ballotVoterId\r\n0001\r\n0002\r\n");
      }),
  });
  return {
    controller,
    calls,
    workerCalls,
    workers,
    setContext: (value) => {
      ctx = { ...ctx, ...value };
    },
  };
}
const file = () => new File(["ID,CD,Party\n0001,8,ind\n"], "county.txt");

test("preview and exact baseline review run in a worker without any server operation", async () => {
  const h = fixture();
  await h.controller.inspect(file(), sourceForm());
  assert.match(h.controller.render(), /Review county columns/);
  assert.match(h.controller.render(), /headersReviewed/);
  await assert.rejects(
    h.controller.prepare(form({ idColumn: "ID" })),
    /Confirm/,
  );
  await h.controller.prepare(baselineForm());
  assert.deepEqual(h.workerCalls.at(-1).options.filters, [
    { column: "CD", value: "8" },
    { column: "Party", value: "ind" },
  ]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.ready().mode, "baseline");
  assert.equal(h.controller.ready().idColumn, "ID");
  assert.match(h.controller.render(), /preparedReviewed/);
  assert.match(h.controller.render(), /Issued/);
});

test("returns fetch only the current all-voter ID export, reauthorize and pin snapshot before matching", async () => {
  const h = fixture({ returns: true });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(returnForm());
  const create = h.calls[0];
  assert.equal(
    create.path,
    "/org-one/ballot-chaser/elections/election-one/exports",
  );
  assert.deepEqual(create.options.body.columns, ["ballotVoterId"]);
  assert.equal(create.options.body.view, "all");
  assert.equal(create.options.body.snapshotId, "snapshot-one");
  assert.deepEqual(h.workerCalls.at(-1).options.retainedIds, ["0001", "0002"]);
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/exports/private-ids")).length,
    2,
  );
  assert.equal(h.controller.ready().idColumn, "Voter ID");
  assert.equal(h.controller.ready().snapshotId, "snapshot-one");
  assert.match(h.controller.render(), /2 rows outside this election/);
});

test("disabled preparation and missing returns export permission fail before any cloud request", async () => {
  const h = fixture({ returns: true });
  h.setContext({ allowed: false });
  await assert.rejects(
    h.controller.inspect(file(), sourceForm()),
    /not enabled/,
  );
  h.setContext({ allowed: true });
  await h.controller.inspect(file(), sourceForm());
  h.setContext({ canExport: false });
  await assert.rejects(h.controller.prepare(returnForm()), /export permission/);
  assert.equal(h.calls.length, 0);
});

test("a changed organization or snapshot cannot reuse a prepared file", async () => {
  const h = fixture();
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(baselineForm());
  h.setContext({ base: "/other-org/ballot-chaser" });
  assert.throws(() => h.controller.ready(), /changed/);
  h.setContext({ base: "/org-one/ballot-chaser", snapshotId: "new-snapshot" });
  assert.throws(() => h.controller.ready(), /changed/);
});

test("stale or oversized authoritative ID export cannot reach local returns matching", async () => {
  for (const change of [{ snapshotId: "other-snapshot" }, { rows: 50001 }]) {
    const h = fixture({
      returns: true,
      requestHandler: async () => ({
        ok: true,
        export: {
          exportId: "ids",
          snapshotId: "snapshot-one",
          status: "ready",
          rows: 2,
          ...change,
        },
      }),
    });
    await h.controller.inspect(file(), sourceForm());
    await assert.rejects(h.controller.prepare(returnForm()), /changed|exceeds/);
    assert.equal(h.workerCalls.length, 1);
  }
});

test("lost export authorization after download leaves no prepared returns", async () => {
  let calls = 0;
  const h = fixture({
    returns: true,
    requestHandler: async () => {
      if (++calls === 3)
        throw Object.assign(new Error("Access changed"), { status: 403 });
      return {
        ok: true,
        export: {
          exportId: "ids",
          snapshotId: "snapshot-one",
          status: "ready",
          rows: 2,
        },
        download: {
          method: "GET",
          url: "https://fixture-private.s3.us-west-2.amazonaws.com/ids.csv",
          expiresAt: Date.now() + 60000,
        },
      };
    },
  });
  await h.controller.inspect(file(), sourceForm());
  await assert.rejects(h.controller.prepare(returnForm()), /Access changed/);
  assert.equal(
    h.workerCalls.filter((call) => call.action === "prepare").length,
    0,
  );
  assert.throws(() => h.controller.ready(), /Prepare and review/);
});

test("cancel terminates an in-flight worker and drops file, preview and prepared data", async () => {
  const h = fixture({ handler: () => new Promise(() => {}) });
  const pending = h.controller.inspect(file(), sourceForm());
  await Promise.resolve();
  h.controller.cancel();
  await assert.rejects(pending, /cancelled/i);
  assert.ok(h.workers.every((worker) => worker.stopped));
  assert.deepEqual(h.controller.state(), {});
  assert.equal(h.calls.length, 0);
});

test("a zero-match returns receipt cannot create an uploadable file", async () => {
  const h = fixture({
    returns: true,
    handler: (message) =>
      message.action === "inspect"
        ? {
            headers: ["Return ID"],
            sample: [["9999"]],
            delimiter: "comma",
            encoding: "utf-8",
          }
        : message.action === "ids"
          ? ["0001", "0002"]
          : {
              blob: new Blob(["Voter ID\r\n"]),
              receipt: {
                inputRows: 1,
                selectedRows: 0,
                excludedRows: 1,
                unknownRows: 1,
                duplicateRows: 0,
              },
            },
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(returnForm());
  assert.match(h.controller.render(), /No matching returns/);
  assert.doesNotMatch(h.controller.render(), /prepare-upload|sourceAsOf/);
  assert.throws(() => h.controller.ready(), /No update is needed/);
  assert.ok(h.calls.every((call) => !call.path.endsWith("/imports")));
});

test("an unknown ID-export creation outcome stops and explicit retry retains the same operation", async () => {
  const operations = [];
  const h = fixture({
    returns: true,
    requestHandler: async (path, options) => {
      if (options.body) {
        operations.push(options.body.operationId);
        if (operations.length === 1) throw new Error("Connection interrupted");
      }
      return {
        ok: true,
        export: {
          exportId: "ids",
          snapshotId: "snapshot-one",
          status: "ready",
          rows: 2,
        },
        download: {
          method: "GET",
          url: "https://fixture-private.s3.us-west-2.amazonaws.com/ids.csv",
          expiresAt: Date.now() + 60000,
        },
      };
    },
  });
  await h.controller.inspect(file(), sourceForm());
  await assert.rejects(
    h.controller.prepare(returnForm()),
    /Connection interrupted/,
  );
  assert.equal(operations.length, 1);
  await h.controller.prepare(returnForm());
  assert.equal(operations.length, 2);
  assert.equal(operations[0], operations[1]);
});
