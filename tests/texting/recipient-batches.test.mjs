import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createRecipientBatches } = await import(
  await moduleUrl("textingRecipientBatches")
);
function harness() {
  const s = {
    campaign: {
      campaignId: "campaign",
      revision: 4,
      status: "active",
      canAddRecipients: true,
      templateText: "Hello. Reply STOP to opt out.",
      budgetMicros: 10000000,
    },
  };
  const calls = [],
    tasks = new Map();
  let next = 0,
    allowed = true,
    batch;
  const runtime = {
    guard() {},
    can: () => allowed,
    busy: () => false,
    changed() {},
    view: () => ({}),
    billing: () => ({}),
    workspace: () => ({}),
    api: async (path, body) => {
      calls.push({ path, body });
      if (path === "/campaigns/campaign")
        return {
          campaign: {
            ...s.campaign,
            revision: batch?.status === "ready" ? 9 : 4,
            recipientBatchPendingId:
              batch && !["ready", "cancelled"].includes(batch.status)
                ? batch.batchId
                : null,
          },
        };
      if (body?.selectionId) {
        batch = {
          batchId: "batch",
          status: "ready_for_review",
          reviewToken: "reviewed",
          selectedCount: 5,
          newCount: 2,
          alreadyIncludedCount: 2,
          heldCount: 1,
          canCancel: true,
        };
        return { batch };
      }
      if (path.endsWith("/prepare")) {
        batch = { ...batch, status: "preparing", canCancel: false };
        return { batch };
      }
      if (path.endsWith("/cancel")) {
        batch = { ...batch, status: "cancelled", canCancel: false };
        return { batch };
      }
      if (path.includes("?")) return { batches: batch ? [batch] : [] };
      return { batch };
    },
  };
  const recipients = {
    load: async () => {},
    hasSelection: () => true,
    render: () => "<div>Contacts</div>",
    reviewForCampaign: async () => true,
    selection: () => ({ selectionId: "selection" }),
  };
  const helper = createRecipientBatches(runtime, () => s, recipients, {
    schedule: (fn) => {
      const id = ++next;
      tasks.set(id, fn);
      return id;
    },
    cancel: (id) => tasks.delete(id),
  });
  return {
    helper,
    s,
    calls,
    tasks,
    runtime,
    finish: () => {
      batch = { ...batch, status: "ready", canCancel: false };
    },
    revoke: () => {
      allowed = false;
    },
    waiting: () => {
      batch = {
        ...batch,
        status: "preparing",
        stage: "awaiting_campaign_activation",
      };
    },
  };
}
test("local review deduplicates visibly and shares only after explicit approval", async () => {
  const f = harness();
  await f.helper.action("recipient-batch-open");
  await f.helper.action("recipient-batch-review");
  assert.match(f.helper.render(), /Already included/);
  assert.match(f.helper.render(), /Add 2 recipients/);
  assert.equal(f.calls.filter((x) => x.path.endsWith("/prepare")).length, 0);
  await f.helper.action("recipient-batch-prepare");
  assert.deepEqual(f.calls.find((x) => x.path.endsWith("/prepare")).body, {
    approved: true,
    reviewToken: "reviewed",
  });
  const task = [...f.tasks.values()][0];
  await task();
  assert.equal(f.calls.filter((x) => x.path.endsWith("/prepare")).length, 1);
  f.helper.dispose();
});
test("reload restores saved progress without approval and draft activation wait stops polling", async () => {
  const f = harness();
  await f.helper.action("recipient-batch-open");
  await f.helper.action("recipient-batch-review");
  f.waiting();
  await f.helper.load();
  assert.equal(f.tasks.size, 0);
  await f.helper.action("recipient-batch-view", "batch");
  assert.match(f.helper.render(), /Waiting for campaign activation/);
  assert.equal(f.calls.filter((x) => x.path.endsWith("/prepare")).length, 0);
  f.helper.dispose();
});
test("a reviewed zero-send batch can be cancelled and revoked permissions hide recipients", async () => {
  const f = harness();
  await f.helper.action("recipient-batch-open");
  await f.helper.action("recipient-batch-review");
  await f.helper.action("recipient-batch-cancel");
  assert.match(f.helper.render(), /Cancelled/);
  f.revoke();
  assert.doesNotMatch(f.helper.render(), /New recipients/);
  await f.helper.action("recipient-batch-open");
  assert.equal(f.calls.filter((x) => x.body).length, 2);
  f.helper.dispose();
  assert.equal(f.tasks.size, 0);
});

test("completion refreshes campaign revision before another addition and a pending older page keeps polling", async () => {
  const f = harness();
  await f.helper.action("recipient-batch-open");
  await f.helper.action("recipient-batch-review");
  f.finish();
  await f.helper.load();
  assert.equal(f.s.campaign.revision, 9);
  assert.equal(f.s.campaign.recipientBatchPendingId, null);
  await f.helper.action("recipient-batch-open");
  await f.helper.action("recipient-batch-review");
  assert.equal(
    f.calls.filter((c) => c.body?.selectionId).at(-1).body.expectedRevision,
    9,
  );
  f.waiting();
  f.s.additionBatch = null;
  f.s.campaign.recipientBatchPendingId = "batch";
  const api = f.runtime.api;
  f.runtime.api = async (path, body) =>
    path.includes("?") ? { batches: [], nextCursor: "older" } : api(path, body);
  await f.helper.load();
  assert.equal(f.s.additionBatches[0].batchId, "batch");
  assert.match(f.helper.overview(), /Waiting for campaign activation/);
  assert.equal(f.tasks.size, 0);
  f.helper.dispose();
});

test("dual estimates include both verified routes and missing campaign capability prevents a new start", async () => {
  const f = harness();
  await f.helper.action("recipient-batch-open");
  await f.helper.action("recipient-batch-review");
  f.runtime.billing = () => ({
    rateStatus: "verified",
    smsUpToTwoSegmentsMicros: 35000,
    optInRates: { rateStatus: "verified", smsSegmentMicros: 17500 },
  });
  f.s.campaign.routingMode = "dual";
  assert.match(f.helper.render(), /\$0.035 to \$0.07/);
  f.s.campaign.canAddRecipients = false;
  assert.doesNotMatch(
    f.helper.overview(),
    /data-workspace-action="recipient-batch-open"/,
  );
  f.helper.dispose();
});
