import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scripts = new URL(
  "../../frontend/src/pages/shared-feed/scripts/",
  import.meta.url,
);
const model = await import(
  `data:text/javascript;base64,${Buffer.from(await readFile(new URL("ballotChaserModel.js", scripts))).toString("base64")}`
);
const controller = await readFile(new URL("ballotChaser.js", scripts), "utf8");
const historySource = controller.match(
  / {2}function history\(\) \{\n([\s\S]*?)\n {2}\}/,
)[1];
const escapeText = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
function renderHistory(view) {
  const names = [
    "ballotImportHistoryNewestFirst",
    "ballotImportHistoryRecordCount",
    "ballotImportHistoryReportDate",
    "ballotImportPhase",
    "ballotImportStatus",
  ];
  return new Function(
    ...names,
    "view",
    "e",
    "count",
    "reportDate",
    "boundedElection",
    "closed",
    "b",
    historySource,
  )(
    ...names.map((name) => model[name]),
    view,
    escapeText,
    (value) => value.toLocaleString("en-US"),
    model.ballotReportDate,
    () => true,
    (job) => ["complete", "cancelled", "failed"].includes(job.status),
    (action, text, value) =>
      `<button data-action="${escapeText(action)}" data-value="${escapeText(value)}">${escapeText(text)}</button>`,
  );
}
const upload = (importId, createdAt, extra = {}) => ({
  importId,
  fileName: "prepared-sent-ballots.csv",
  createdAt,
  sourceAsOf: "2026-10-28T00:00:00.000Z",
  status: "complete",
  totalRows: 251,
  ...extra,
});

test("history orders identical filenames by upload creation, never county date or recovery", () => {
  const old = upload("older", "2026-10-28T17:00:00Z", {
      sourceAsOf: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T18:00:00Z",
    }),
    recent = upload("recent", "2026-10-29T17:00:00Z", {
      sourceAsOf: "2026-10-27T00:00:00Z",
      updatedAt: "2026-10-29T17:00:00Z",
    });
  const original = Object.freeze([Object.freeze(old), Object.freeze(recent)]);
  assert.deepEqual(model.ballotImportHistoryNewestFirst(original), [
    recent,
    old,
  ]);
  assert.deepEqual(original, [old, recent]);
  const html = renderHistory({ imports: original });
  assert.ok(
    html.indexOf('data-value="recent"') < html.indexOf('data-value="older"'),
  );
  assert.equal((html.match(/prepared-sent-ballots.csv/g) || []).length, 2);
  assert.match(html, /Uploaded:/);
  assert.match(html, /County report date:/);
  assert.match(html, /Records: 251<\/p><p>Status: Complete/);
});

test("equal dates use deterministic IDs and invalid or missing upload dates stay last", () => {
  const rows = [
    upload("unknown-z", null),
    upload("same-z", "2026-10-29T17:00:00Z"),
    upload("invalid", "not-a-date"),
    upload("same-a", "2026-10-29T17:00:00Z"),
    upload("unknown-a", ""),
  ];
  assert.deepEqual(
    model.ballotImportHistoryNewestFirst(rows).map((row) => row.importId),
    ["same-a", "same-z", "invalid", "unknown-a", "unknown-z"],
  );
});

test("source record totals remain separate from retained voters and processing status", () => {
  assert.equal(
    model.ballotImportHistoryRecordCount({
      status: "applying",
      totalRows: 251,
      counts: { rows: 50 },
      boundedRetainedRows: 110591,
    }),
    251,
  );
  assert.equal(
    model.ballotImportHistoryRecordCount({
      status: "awaiting_mapping",
      rowCount: 12,
    }),
    12,
  );
  assert.equal(
    model.ballotImportHistoryRecordCount({
      status: "complete",
      counts: { rows: 251 },
    }),
    251,
  );
  assert.equal(
    model.ballotImportHistoryRecordCount({
      status: "complete",
      counts: { rows: 0 },
    }),
    0,
  );
});

test("unknown and partial zero counts never present the file as empty", () => {
  for (const job of [
    { status: "awaiting_mapping", counts: { rows: 0 } },
    { status: "reviewing", counts: { rows: 5 } },
    { status: "complete", totalRows: -1, counts: { rows: "251" } },
  ])
    assert.equal(model.ballotImportHistoryRecordCount(job), null);
});

test("history county dates keep the UTC calendar day and metadata is escaped", () => {
  const countyDate = model.ballotImportHistoryReportDate(
    "2026-10-28T00:00:00Z",
  );
  assert.equal(
    countyDate,
    new Date("2026-10-28T00:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  );
  const html = renderHistory({
    imports: [
      upload('id"<unsafe>', "<invalid>", {
        fileName: '<img src=x onerror="run()">',
        sourceAsOf: "bad-date",
        status: "awaiting_mapping",
        totalRows: undefined,
        counts: { rows: 0 },
      }),
    ],
  });
  assert.match(html, /&lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);
  assert.match(html, /Uploaded: Not recorded/);
  assert.match(html, /County report date: Not recorded/);
  assert.match(html, /Records: Not counted yet/);
  assert.match(html, /Status: Waiting for your review/);
  assert.doesNotMatch(html, /<img|<unsafe>|Invalid Date|\ufffd/);
});

test("metadata pagination follows empty filtered pages and deduplicates IDs", async () => {
  const calls = [];
  const result = await model.collectBallotImportHistory(async (cursor) => {
    calls.push(cursor);
    if (!cursor)
      return { items: [upload("older", "2026-10-28")], nextCursor: "empty" };
    if (cursor === "empty") return { items: [], nextCursor: "last" };
    return {
      items: [upload("older", "2026-10-28"), upload("recent", "2026-10-29")],
      nextCursor: null,
    };
  });
  assert.deepEqual(calls, [null, "empty", "last"]);
  assert.equal(result.incomplete, false);
  assert.equal(result.nextCursor, null);
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    model
      .ballotImportHistoryNewestFirst(result.items)
      .map((row) => row.importId),
    ["recent", "older"],
  );
});

test("repeated history cursors stop within the bound and retain the next action", async () => {
  let calls = 0;
  const result = await model.collectBallotImportHistory(async () => {
    calls++;
    return { items: [upload("one", "2026-10-29")], nextCursor: "repeat" };
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.incomplete, true);
  assert.equal(result.nextCursor, "repeat");
  const html = renderHistory({
    imports: result.items,
    importCursor: result.nextCursor,
    importHistoryIncomplete: true,
  });
  assert.match(
    html,
    /Some uploads are not yet shown\. Load more updates to include them\./,
  );
  assert.match(html, /More updates/);
  assert.doesNotMatch(html, /newest first|all uploads/i);
});

test("one explicit history load reads at most 20 metadata pages", async () => {
  let calls = 0;
  const result = await model.collectBallotImportHistory(async () => ({
    items: [],
    nextCursor: String(++calls),
  }));
  assert.equal(calls, 20);
  assert.equal(result.incomplete, true);
  assert.equal(result.nextCursor, "20");
});

test("a first-page failure can retry from the start and later partial pages deduplicate", async () => {
  const failed = await model.collectBallotImportHistory(async () => {
    throw Error("temporarily unavailable");
  });
  assert.equal(failed.incomplete, true);
  assert.equal(failed.nextCursor, null);
  const retry = await model.collectBallotImportHistory(
    async () => ({
      items: [upload("saved", "2026-10-29")],
      nextCursor: null,
    }),
    failed,
  );
  assert.equal(retry.incomplete, false);
  assert.equal(retry.items.length, 1);
  let calls = 0;
  const partial = await model.collectBallotImportHistory(async () => {
    if (++calls === 2) throw Error("temporarily unavailable");
    return { items: retry.items, nextCursor: "more" };
  });
  assert.equal(partial.nextCursor, "more");
  assert.equal(partial.items.length, 1);
  const more = await model.collectBallotImportHistory(
    async () => ({
      items: retry.items,
      nextCursor: null,
    }),
    { items: partial.items, cursor: partial.nextCursor },
  );
  assert.equal(more.items.length, 1);
  assert.equal(more.incomplete, false);
});

test("context changes and authorization loss abort history reads instead of retaining them", async () => {
  let valid = true;
  await assert.rejects(
    model.collectBallotImportHistory(
      async () => {
        valid = false;
        return { items: [upload("private", "2026-10-29")], nextCursor: null };
      },
      {
        guard() {
          if (!valid) throw Error("organization changed");
        },
      },
    ),
    /organization changed/,
  );
  await assert.rejects(
    model.collectBallotImportHistory(async () => {
      throw Object.assign(Error("access changed"), { status: 403 });
    }),
    /access changed/,
  );
});
