import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const load = async (name) =>
  import(
    `data:text/javascript;base64,${Buffer.from(await readFile(new URL(`../../frontend/src/pages/shared-feed/scripts/${name}.js`, import.meta.url), "utf8")).toString("base64")}`
  );
const model = await load("ballotChaserModel"),
  { createBallotExport, checkedBallotDownload } = await load("ballotExport");
const MiB = 1048576;

test("import lifecycle captions are plain language and never expose new internal states", () => {
  const labels = {
    uploading: "Upload file",
    inspecting: "Reading file",
    awaiting_mapping: "Review columns",
    reviewing: "Checking county update",
    review_ready: "Ready to apply",
    needs_review: "Needs review",
    applying: "Publishing update",
    complete: "Update complete",
    failed: "Update paused",
    cancelled: "Update cancelled",
  };
  for (const [status, label] of Object.entries(labels))
    assert.equal(model.ballotImportStatus(status), label);
  assert.equal(
    model.ballotImportStatus("future_internal_phase"),
    "Check progress",
  );
});

test("report-only columns stay out of contact mappings while explicit county fields remain opt-in", () => {
  const result = model.ballotContactColumns(
    ["Voter ID", "Ballot", "Name", "DailyExportTimestamp", "Precinct"],
    { Name: "saved-hidden-field", Precinct: model.ballotAddCountyField },
  );
  assert.deepEqual(result.fieldMapping, { Name: "saved-hidden-field" });
  assert.deepEqual(result.sourceOnlyColumns, [
    "Voter ID",
    "Ballot",
    "DailyExportTimestamp",
  ]);
  assert.ok(!JSON.stringify(result).includes(model.ballotAddCountyField));
});
const file = (size) => ({
  size,
  slice: (start, end) => ({
    start,
    end: Math.min(end, size),
    size: Math.min(end, size) - start,
  }),
});
const descriptor = (count = 3, completed = []) => ({
  method: "MULTIPART",
  uploadId: "private-upload",
  partSizeBytes: 8 * MiB,
  completedParts: completed,
  parts: Array.from({ length: count }, (_, i) => ({
    partNumber: i + 1,
    sizeBytes: 8 * MiB,
    url: `https://fixture-private.s3.us-west-2.amazonaws.com/part-${i + 1}`,
    headers: {},
  })).filter((p) => !completed.some((c) => c.partNumber === p.partNumber)),
});

test("all five ballot views pin snapshot and comparison labels without widening outstanding", () => {
  for (const view of Object.keys(model.ballotViews)) {
    const chase = model.ballotChaseContext("election", "snapshot", view, {
      sourceAsOf: "2026-10-15",
      previousSourceAsOf: "2026-10-14",
    });
    assert.equal(chase.view, view);
    assert.equal(chase.sourceAsOf, "2026-10-15");
    assert.equal(
      chase.outstandingOnly,
      view === "outstanding" ? true : undefined,
    );
  }
  assert.throws(
    () => model.ballotChaseContext("election", "snapshot", "everything"),
    /Choose/,
  );
  assert.equal(model.ballotStatusLabels.accepted, "Accepted");
  assert.equal(model.ballotStatusLabels.cure_required, "Needs cure");
  assert.match(model.ballotReportDate("2026-10-15T16:00:00Z"), /2026/);
  assert.doesNotMatch(model.ballotReportDate("2026-10-15T16:00:00Z"), /T16:/);
  assert.equal(model.ballotReportDate("unknown"), "No published update");
});

test("multipart resume skips confirmed ranges and sends two parts without credentials", async () => {
  const upload = descriptor(3, [
    { partNumber: 1, etag: '"saved-one"', sizeBytes: 8 * MiB },
  ]);
  let active = 0,
    peak = 0;
  const ranges = [],
    progress = [];
  const result = await model.uploadBallotParts(file(24 * MiB), upload, {
    guard: () => {},
    progress: (p) => progress.push(p.loaded),
    transport: async (url, options) => {
      active++;
      peak = Math.max(peak, active);
      ranges.push(options.body);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, undefined);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return {
        ok: true,
        headers: { get: () => (url.endsWith("2") ? '"two"' : '"three"') },
      };
    },
  });
  assert.equal(peak, 2);
  assert.deepEqual(
    ranges.map((x) => x.start),
    [8 * MiB, 16 * MiB],
  );
  assert.deepEqual(progress, [8 * MiB, 16 * MiB, 24 * MiB]);
  assert.deepEqual(result.parts, [
    { partNumber: 1, etag: '"saved-one"' },
    { partNumber: 2, etag: '"two"' },
    { partNumber: 3, etag: '"three"' },
  ]);
});

test("partial upload failure waits for in-flight work and starts no further ranges", async () => {
  let release,
    calls = 0,
    settled = false;
  const upload = model
    .uploadBallotParts(file(32 * MiB), descriptor(4), {
      guard: () => {},
      transport: async () => {
        calls++;
        if (calls === 1) throw new Error("connection lost");
        await new Promise((resolve) => {
          release = resolve;
        });
        return { ok: true, headers: { get: () => '"receipt"' } };
      },
    })
    .finally(() => {
      settled = true;
    });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await assert.rejects(upload, /connection lost/);
  assert.equal(calls, 2);
});

test("bad ranges and changed actor stop multipart before dispatch", async () => {
  const bad = descriptor();
  bad.parts[1].partNumber = 1;
  await assert.rejects(
    model.uploadBallotParts(file(24 * MiB), bad, {
      guard: () => {},
      transport: () => {
        throw new Error("must not send");
      },
    }),
    /parts do not match/,
  );
  await assert.rejects(
    model.uploadBallotParts(file(24 * MiB), descriptor(), {
      guard: () => {
        throw new Error("account changed");
      },
    }),
    /account changed/,
  );
  assert.equal(
    await model.uploadBallotParts(
      file(24 * MiB),
      { method: "COMPLETE", completed: true },
      { guard: () => {} },
    ),
    null,
  );
});

test("server export sends filter+raw selection once, reads status, never downloads paged CSV", async () => {
  const calls = [];
  let ready = false;
  const controller = createBallotExport({
    guard: () => {},
    changed: () => {},
    schedule: () => 0,
    cancel: () => {},
    request: async (path, options) => {
      calls.push({ path, options });
      options.beforeRequest();
      return {
        ok: true,
        export: {
          exportId: "export-one",
          status: ready ? "ready" : "building",
          rows: 100,
          snapshotId: "snapshot",
          view: "newly_returned",
        },
        ...(ready
          ? {
              download: {
                method: "GET",
                url: "https://fixture-private.s3.us-west-2.amazonaws.com/export.csv",
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            }
          : {}),
      };
    },
  });
  await controller.start(
    "/api/contact-book/scopes/coalition%3Afixture/ballot-chaser",
    {
      electionId: "election",
      operationId: "operation",
      snapshotId: "snapshot",
      view: "newly_returned",
      filter: { field: "state", op: "eq", value: "AZ" },
      selection: { mode: "all_matching", excludeIds: ["excluded"] },
    },
  );
  ready = true;
  assert.match(await controller.download(), /export.csv/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.selection.excludeIds[0], "excluded");
  assert.deepEqual(calls[0].options.body.columns, [
    "contactId",
    "ballotVoterId",
    "ballotStatus",
    "ballotReturnedAt",
    "ballotSourceAsOf",
    "ballotComparisonFrom",
    "ballotComparisonTo",
  ]);
  assert.equal(calls[1].options.method, undefined);
  assert.ok(calls.every((c) => !c.path.includes("/rows")));
  controller.reset();
});

test("publication change removes an existing ready download and requests refresh", async () => {
  let stale = false;
  const c = createBallotExport({
    guard: () => {},
    changed: () => {},
    schedule: () => 0,
    cancel: () => {},
    request: async () => {
      if (stale)
        throw Object.assign(new Error("changed"), {
          payload: { error: "ballot_snapshot_changed" },
        });
      return {
        ok: true,
        export: { exportId: "one", status: "ready", rows: 10 },
        download: {
          url: "https://fixture-private.s3.us-west-2.amazonaws.com/data",
          method: "GET",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      };
    },
  });
  await c.start("/ballot-chaser", {
    electionId: "election",
    snapshotId: "old",
  });
  stale = true;
  assert.equal(await c.download(), null);
  assert.equal(c.view().job, null);
  assert.equal(c.view().download, null);
  assert.match(c.view().error, /Refresh Ballot Chaser/);
});

test("late export response after account change exposes no link", async () => {
  let resolve,
    actor = true;
  const c = createBallotExport({
    guard: () => {
      if (!actor) throw new Error("account changed");
    },
    changed: () => {},
    schedule: () => 0,
    cancel: () => {},
    request: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const start = c.start("/ballot-chaser", { electionId: "election" });
  actor = false;
  resolve({ ok: true, export: { exportId: "old", status: "ready" } });
  await start;
  assert.deepEqual(c.view(), {});
});

test("private download rejects expired URLs, redirects to other hosts and userinfo", () => {
  for (const url of [
    "https://evil.example/data",
    "http://fixture.s3.us-west-2.amazonaws.com/data",
    "https://user:pass@fixture.s3.us-west-2.amazonaws.com/data",
  ])
    assert.throws(
      () =>
        checkedBallotDownload({
          url,
          method: "GET",
          expiresAt: Date.now() + 60000,
        }),
      /expired/,
    );
  assert.throws(
    () =>
      checkedBallotDownload({
        url: "https://fixture.s3.us-west-2.amazonaws.com/data",
        method: "GET",
        expiresAt: 1,
      }),
    /expired/,
  );
});

test("an old download click cannot open a newly selected export", async () => {
  let release;
  const ready = (id) => ({
    ok: true,
    export: { exportId: id, status: "ready" },
    download: {
      method: "GET",
      url: `https://fixture-private.s3.us-west-2.amazonaws.com/${id}`,
      expiresAt: Date.now() + 60000,
    },
  });
  const c = createBallotExport({
    guard: () => {},
    changed: () => {},
    schedule: () => 0,
    cancel: () => {},
    request: async (path, options) => {
      if (options.method === "POST") return ready(options.body.operationId);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await c.start("/ballot-chaser", {
    electionId: "election",
    operationId: "old",
  });
  const oldClick = c.download();
  await c.start("/ballot-chaser", {
    electionId: "election",
    operationId: "new",
  });
  release(ready("old"));
  await assert.rejects(oldClick, /no longer open/);
  assert.equal(c.view().job.exportId, "new");
});
