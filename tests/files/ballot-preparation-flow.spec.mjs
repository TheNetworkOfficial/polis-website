import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "../texting/module-fixture.mjs";
const {
  createBallotPreparation,
  preparedReportDate,
  ballotPreparationCapacity,
  ballotSentPreparationPolicy,
} = await import(await moduleUrl("ballotPreparation"));

test("expanded availability preserves an enrolled cohort's smaller frozen capacity", () => {
  const policy = {
    enabled: true,
    version: "bounded_v1",
    maxRows: 50000,
    maxSourceBytes: 50000000,
    maxColumns: 55,
    maxHeaderBytes: 64,
  };
  assert.equal(
    ballotPreparationCapacity({ ...policy, maxRows: 125000 }, policy).maxRows,
    50000,
  );
  assert.equal(
    ballotPreparationCapacity(
      { ...policy, maxRows: 125000 },
      { ...policy, maxRows: 125000 },
    ).maxRows,
    125000,
  );
  assert.equal(
    ballotPreparationCapacity({ ...policy, maxRows: 125001 }, policy),
    null,
  );
  assert.equal(
    ballotPreparationCapacity(
      { ...policy, maxRows: 125000 },
      { ...policy, enabled: false },
    ),
    null,
  );
});

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
const returnForm = () =>
  form({
    headersReviewed: "on",
    idColumn: "Return ID",
    confirmedReturnsOnly: "on",
  });
const statusForm = (overrides = {}) =>
  form({
    headersReviewed: "on",
    idColumn: "Return ID",
    statusColumn: "BALSTATUS",
    statusMeaningsReviewed: "on",
    returnMeaning_0: "returned",
    returnMeaning_1: "voided",
    ...overrides,
  });
const sentPolicy = () => ({
  enabled: true,
  maxRows: 5000,
  maxSourceBytes: 5000000,
  idColumn: "VOTERID",
  districtColumn: "CONDIST",
  districtValue: "8",
  partyColumn: "PARTY",
  partyValues: ["IND", "PND"],
  statusColumn: "BALSTATUS",
  issuedValue: "S",
  electionDateColumn: "ELECTDATE",
});
const sentColumns = [
  "VOTERID",
  "CONDIST",
  "PARTY",
  "BALSTATUS",
  "ELECTDATE",
  "Name",
];
const sentForm = () => form({ headersReviewed: "on", idColumn: "VOTERID" });
function fixture({
  returns = false,
  sent = false,
  handler,
  requestHandler,
  transport,
  returnStatuses,
  preparedReceipt = {},
} = {}) {
  const calls = [],
    workerCalls = [],
    workers = [];
  let ctx = {
    allowed: true,
    canExport: true,
    base: "/org-one/ballot-chaser",
    electionId: "election-one",
    snapshotId: returns || sent ? "snapshot-one" : null,
    ...(sent
      ? {
          mode: "sent",
          sentUpdates: sentPolicy(),
          preparationColumns: [...sentColumns],
          retainedRows: 2,
          electionDate: "2026-11-03",
        }
      : {}),
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
                      headers: sent
                        ? [...sentColumns]
                        : returns
                          ? returnStatuses
                            ? ["Return ID", "BALSTATUS", "Date"]
                            : ["Return ID", "Date"]
                          : ["ID", "CD", "Party"],
                      sample: [["0001", "8", "ind"]],
                      delimiter: "comma",
                      encoding: "utf-8",
                    }
                  : message.action === "return-statuses"
                    ? {
                        statusColumn: message.options.statusColumn,
                        inputRows: returnStatuses.reduce(
                          (sum, item) => sum + item.count,
                          0,
                        ),
                        statuses: returnStatuses,
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
                            ...preparedReceipt,
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

test("approved capacity and both reviewed party codes reach the worker without broadening selection", async () => {
  const h = fixture();
  h.setContext({ limits: { maxRows: 125000 } });
  assert.match(h.controller.render(), /125,000 retained voters/);
  await h.controller.inspect(file(), sourceForm());
  const reviewed = baselineForm();
  reviewed.set("partyValue", " IND, PND, IND ");
  await h.controller.prepare(reviewed);
  assert.deepEqual(h.workerCalls.at(-1).options.filters, [
    { column: "CD", value: "8" },
    { column: "Party", values: ["IND", "PND"] },
  ]);
  assert.equal(h.workerCalls.at(-1).options.limits.maxRows, 125000);
  assert.match(h.controller.render(), /IND or PND/);
  assert.doesNotMatch(h.controller.render(), /NOL/);
  h.setContext({ limits: { maxRows: 50000 } });
  assert.throws(() => h.controller.ready(), /changed/);
});

test("supported return capacity exceeds the legacy cohort but unsupported capacity fails closed", async () => {
  const ids = Array.from({ length: 50001 }, (_, index) => String(index));
  const h = fixture({
    returns: true,
    handler: (message) =>
      message.action === "inspect"
        ? {
            headers: ["Return ID"],
            sample: [["0001"]],
            delimiter: "comma",
            encoding: "utf-8",
          }
        : message.action === "ids"
          ? ids
          : {
              blob: new Blob(["Voter ID\r\n0001\r\n"]),
              receipt: { selectedRows: 1 },
            },
    requestHandler: async () => ({
      ok: true,
      export: {
        exportId: "ids",
        snapshotId: "snapshot-one",
        status: "ready",
        rows: ids.length,
      },
      download: {
        method: "GET",
        url: "https://fixture-private.s3.us-west-2.amazonaws.com/ids.csv",
        expiresAt: Date.now() + 60000,
      },
    }),
  });
  h.setContext({ limits: { maxRows: 125000 } });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(returnForm());
  assert.equal(
    h.workerCalls.find((call) => call.action === "ids").options.limits.maxRows,
    125000,
  );
  assert.equal(h.workerCalls.at(-1).options.retainedIds.length, 50001);
  assert.equal(h.controller.ready().snapshotId, "snapshot-one");
  const unsupported = fixture();
  unsupported.setContext({ limits: { maxRows: 125001 } });
  await assert.rejects(
    unsupported.controller.inspect(file(), sourceForm()),
    /capacity could not be confirmed/,
  );
  assert.equal(unsupported.calls.length, 0);
  assert.equal(unsupported.workerCalls.length, 0);
});

test("county status review scans locally before any retained-ID export and confirms exact R/X choices", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [
      { value: "R", count: 3 },
      { value: "X", count: 1 },
    ],
    preparedReceipt: { returnedRows: 3, voidedRows: 1, conflictingIds: 0 },
  });
  await h.controller.inspect(file(), sourceForm());
  assert.match(h.controller.render(), /Return-status column/);
  assert.match(h.controller.render(), /value="BALSTATUS" selected/);
  assert.doesNotMatch(h.controller.render(), /name="confirmedReturnsOnly"/);
  assert.doesNotMatch(h.controller.render(), /No status column — confirmed/);
  assert.match(
    h.controller.render(),
    /S code does not confirm a received ballot/,
  );
  await h.controller.prepare(statusForm());
  assert.equal(h.calls.length, 0);
  assert.equal(h.workerCalls.at(-1).action, "return-statuses");
  assert.deepEqual(h.controller.state().returnMeanings, ["returned", "voided"]);
  assert.match(h.controller.render(), /4 rows checked locally/);
  assert.throws(() => h.controller.ready(), /Prepare and review/);
  await h.controller.prepare(statusForm());
  assert.deepEqual(h.workerCalls.at(-1).options.returnStatus, {
    column: "BALSTATUS",
    mappings: [
      { value: "R", meaning: "returned" },
      { value: "X", meaning: "voided" },
    ],
  });
  assert.match(h.controller.render(), /3 received rows/);
  assert.match(h.controller.render(), /1 voided rows excluded/);
  assert.match(h.controller.render(), /Previous ballot status stays unchanged/);
  assert.doesNotMatch(h.controller.render(), /send.*Sam|file.*review first/);
});

test("blank and unknown statuses require a self-service meaning before matching", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [
      { value: "R", count: 1 },
      { value: "", count: 2 },
      { value: "?", count: 1 },
    ],
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(statusForm());
  assert.deepEqual(h.controller.state().returnMeanings, ["returned", "", ""]);
  assert.match(h.controller.render(), /Blank status/);
  assert.match(
    h.controller.render(),
    /name="readStatuses" value="on" formnovalidate/,
  );
  await assert.rejects(
    h.controller.prepare(
      statusForm({ returnMeaning_1: "", returnMeaning_2: "" }),
    ),
    /meaning for every observed status/,
  );
  assert.equal(h.calls.length, 0);
  await h.controller.prepare(
    statusForm({ returnMeaning_1: "ignore", returnMeaning_2: "ignore" }),
  );
  assert.deepEqual(h.workerCalls.at(-1).options.returnStatus.mappings, [
    { value: "R", meaning: "returned" },
    { value: "", meaning: "ignore" },
    { value: "?", meaning: "ignore" },
  ]);
});

test("a BALSTATUS file cannot bypass classification through the returned-only confirmation", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [{ value: "S", count: 4 }],
  });
  await h.controller.inspect(file(), sourceForm());
  await assert.rejects(
    h.controller.prepare(returnForm()),
    /includes BALSTATUS/,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.workerCalls.length, 1);
  await h.controller.prepare(statusForm());
  assert.deepEqual(h.controller.state().returnMeanings, [""]);
  await assert.rejects(
    h.controller.prepare(statusForm({ returnMeaning_0: "" })),
    /meaning for every observed status/,
  );
  assert.equal(h.calls.length, 0);
});

test("returned-only files need an explicit confirmation before a server operation", async () => {
  const h = fixture({ returns: true });
  await h.controller.inspect(file(), sourceForm());
  await assert.rejects(
    h.controller.prepare(
      form({ headersReviewed: "on", idColumn: "Return ID" }),
    ),
    /explicitly confirm/,
  );
  assert.equal(h.calls.length, 0);
  await h.controller.prepare(returnForm());
  assert.deepEqual(h.workerCalls.at(-1).options.returnStatus, {
    returnedOnly: true,
  });
});

test("conflicting received and voided voter IDs need acknowledgment before upload", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [
      { value: "R", count: 2 },
      { value: "X", count: 1 },
    ],
    preparedReceipt: { returnedRows: 2, voidedRows: 1, conflictingIds: 1 },
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(statusForm());
  await h.controller.prepare(statusForm());
  assert.match(h.controller.render(), /name="excludeConflicted" required/);
  assert.match(h.controller.render(), /1 voters with both received and voided/);
  assert.throws(() => h.controller.ready(), /left unchanged/);
  assert.equal(
    h.controller.ready(form({ excludeConflicted: "on" })).receipt
      .conflictingIds,
    1,
  );
  h.controller.reviewReturns();
  assert.throws(() => h.controller.ready(), /Prepare and review/);
  assert.match(h.controller.render(), /Review every return status/);
});

test("all-voided results show excluded counts and cannot create an upload", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [{ value: "X", count: 4 }],
    preparedReceipt: {
      selectedRows: 0,
      matchedUnique: 0,
      returnedRows: 0,
      voidedRows: 4,
      conflictingIds: 0,
    },
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(statusForm());
  await h.controller.prepare(statusForm({ returnMeaning_0: "voided" }));
  assert.match(h.controller.render(), /4 voided rows excluded/);
  assert.match(h.controller.render(), /No file was uploaded/);
  assert.doesNotMatch(
    h.controller.render(),
    /data-ballot-form="prepare-upload"/,
  );
  assert.throws(() => h.controller.ready(), /No update is needed/);
  assert.ok(h.calls.every((call) => !call.path.endsWith("/imports")));
});

test("changed status columns rescan locally and rejected mappings invalidate prior preparation", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [
      { value: "R", count: 1 },
      { value: "X", count: 1 },
    ],
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(statusForm());
  await h.controller.prepare(statusForm());
  assert.equal(h.controller.ready().mode, "returns");
  const calls = h.calls.length;
  await assert.rejects(
    h.controller.prepare(statusForm({ returnMeaning_0: "" })),
    /meaning for every observed status/,
  );
  assert.throws(() => h.controller.ready(), /Prepare and review/);
  assert.equal(h.calls.length, calls);
  await h.controller.prepare(statusForm({ statusColumn: "Date" }));
  assert.equal(h.workerCalls.at(-1).action, "return-statuses");
  assert.equal(h.workerCalls.at(-1).options.statusColumn, "Date");
  assert.equal(h.calls.length, calls);
  h.setContext({ snapshotId: "new-snapshot" });
  await assert.rejects(h.controller.prepare(statusForm()), /changed/);
});

test("status labels are escaped rather than inserted as county-supplied HTML", async () => {
  const code = '<img src=x onerror="alert(1)">';
  const h = fixture({
    returns: true,
    returnStatuses: [{ value: code, count: 1 }],
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(statusForm());
  const html = h.controller.render();
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.deepEqual(h.controller.state().returnMeanings, [""]);
});

test("sent additions require the controlled capability and original county schema", () => {
  assert.equal(
    ballotSentPreparationPolicy(sentPolicy(), sentColumns)?.enabled,
    true,
  );
  for (const change of [
    { enabled: false },
    { maxRows: 5001 },
    { maxSourceBytes: 5000001 },
    { districtValue: "9" },
    { partyValues: ["IND", "PND", "NOL"] },
    { issuedValue: "R" },
  ])
    assert.equal(
      ballotSentPreparationPolicy({ ...sentPolicy(), ...change }, sentColumns),
      null,
    );
  assert.equal(
    ballotSentPreparationPolicy(sentPolicy(), ["VOTERID", "PARTY"]),
    null,
  );
});

test("new sent voters use the published all-ID list and fixed selection while preserving original columns", async () => {
  const h = fixture({
    sent: true,
    preparedReceipt: { existingRows: 1, outsideRows: 2, voidedRows: 1 },
  });
  h.setContext({ limits: { maxRows: 125000 } });
  assert.match(h.controller.render(), /Upload sent-ballot file/);
  assert.match(h.controller.render(), /Sent ballots — add new voters/);
  assert.match(h.controller.render(), /5,000 new voters and 5 MB/);
  await h.controller.inspect(file(), sourceForm());
  const html = h.controller.render();
  assert.match(html, /CONDIST 8, PARTY IND or PND, and BALSTATUS S/);
  assert.doesNotMatch(html, /name="districtValue"|name="partyValue"/);
  await h.controller.prepare(sentForm());
  assert.deepEqual(h.calls[0].options.body.columns, ["ballotVoterId"]);
  const options = h.workerCalls.at(-1).options;
  assert.equal(options.mode, "sent");
  assert.deepEqual(options.retainedIds, ["0001", "0002"]);
  assert.deepEqual(options.outputColumns, sentColumns);
  assert.deepEqual(options.filters, [
    { column: "CONDIST", value: "8" },
    { column: "PARTY", values: ["IND", "PND"] },
  ]);
  assert.deepEqual(options.sentPolicy, sentPolicy());
  assert.equal(options.electionDate, "2026-11-03");
  assert.equal(options.limits.maxRows, 125000);
  const prepared = h.controller.ready();
  assert.equal(prepared.mode, "sent");
  assert.equal(prepared.idColumn, "VOTERID");
  assert.equal(prepared.snapshotId, "snapshot-one");
  assert.equal(prepared.file.name, "prepared-sent-ballots.csv");
  assert.match(h.controller.render(), /already tracked rows skipped/);
  assert.match(h.controller.render(), /Existing voters, previous returns/);
  assert.match(h.controller.render(), /two-per-day and 35-per-month/);
  assert.match(h.controller.render(), /latest returns again/);
});

test("a sent code in the returns workflow explains the separate upload without changing its meaning", async () => {
  const h = fixture({
    returns: true,
    returnStatuses: [{ value: "S", count: 262 }],
  });
  h.setContext({
    sentUpdates: sentPolicy(),
    preparationColumns: [...sentColumns],
    electionDate: "2026-11-03",
  });
  assert.match(h.controller.render(), /Upload returned-ballot file/);
  assert.match(
    h.controller.render(),
    /Returned ballots — match received ballots/,
  );
  assert.match(
    h.controller.render(),
    /EV33 reports use R for received and X for voided/,
  );
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(statusForm());
  const html = h.controller.render();
  assert.match(html, /Review returned-ballot columns/);
  assert.match(html, /This file includes sent ballots \(S\)/);
  assert.match(html, /Cancel preparation/);
  assert.match(html, /Upload sent-ballot file/);
  assert.match(html, /S means Sent; do not mark it as Returned/);
  assert.deepEqual(h.controller.state().returnMeanings, [""]);
  assert.equal(h.calls.length, 0);
});

test("missing sent capability, snapshot or export permission cannot start preparation", async () => {
  for (const change of [
    { sentUpdates: undefined },
    { snapshotId: null },
    { canExport: false },
    { electionDate: undefined },
  ]) {
    const h = fixture({ sent: true });
    h.setContext(change);
    assert.match(h.controller.render(), /Sent additions unavailable/);
    await assert.rejects(
      h.controller.inspect(file(), sourceForm()),
      /not available/,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.workerCalls.length, 0);
  }
});

test("sent files missing an original county column fail before the private ID export", async () => {
  const h = fixture({
    sent: true,
    handler: () => ({
      headers: sentColumns.filter((name) => name !== "Name"),
      sample: [],
      delimiter: "comma",
      encoding: "utf-8",
    }),
  });
  await h.controller.inspect(file(), sourceForm());
  await assert.rejects(
    h.controller.prepare(sentForm()),
    /every original master column/,
  );
  assert.equal(h.calls.length, 0);
});

test("a no-additions sent file never exposes an upload and consumes no import", async () => {
  const h = fixture({
    sent: true,
    preparedReceipt: {
      selectedRows: 0,
      existingRows: 3,
      outsideRows: 1,
      conflictingIds: 0,
    },
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(sentForm());
  assert.match(h.controller.render(), /No new eligible voters/);
  assert.match(h.controller.render(), /3 already tracked rows skipped/);
  assert.doesNotMatch(
    h.controller.render(),
    /data-ballot-form="prepare-upload"/,
  );
  assert.throws(() => h.controller.ready(), /No update is needed/);
  assert.ok(h.calls.every((call) => !call.path.endsWith("/imports")));
});

test("sent conflict exclusion is explicit and capability or schema changes invalidate the prepared file", async () => {
  const h = fixture({
    sent: true,
    preparedReceipt: { conflictingIds: 1 },
  });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(sentForm());
  assert.match(
    h.controller.render(),
    /Exclude new voters with conflicting sent-ballot records/,
  );
  assert.throws(() => h.controller.ready(), /conflicting sent-ballot records/);
  assert.equal(
    h.controller.ready(form({ excludeConflicted: "on" })).mode,
    "sent",
  );
  h.setContext({ sentUpdates: { ...sentPolicy(), enabled: false } });
  assert.throws(
    () => h.controller.ready(form({ excludeConflicted: "on" })),
    /changed/,
  );
  h.setContext({
    sentUpdates: sentPolicy(),
    preparationColumns: [...sentColumns, "Extra"],
  });
  assert.throws(
    () => h.controller.ready(form({ excludeConflicted: "on" })),
    /changed/,
  );
  h.setContext({ preparationColumns: sentColumns, electionDate: "2026-11-04" });
  assert.throws(
    () => h.controller.ready(form({ excludeConflicted: "on" })),
    /changed/,
  );
});

test("sent readiness also enforces the prepared row and byte limits", async () => {
  const h = fixture({ sent: true });
  await h.controller.inspect(file(), sourceForm());
  await h.controller.prepare(sentForm());
  const state = h.controller.state();
  state.prepared.receipt.selectedRows = 5001;
  assert.throws(() => h.controller.ready(), /5,000-new-voter or 5 MB/);
  state.prepared.receipt.selectedRows = 1;
  state.prepared.blob = new Blob([new Uint8Array(5000001)]);
  assert.throws(() => h.controller.ready(), /5,000-new-voter or 5 MB/);
});
