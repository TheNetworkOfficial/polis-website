import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { queueBlockExplanation } = await import(
  await moduleUrl("textingWorkspaceUi")
);

function fixture() {
  const item = {
    itemId: "held-recipient",
    state: "blocked",
    blockedReasons: ["prompt_confirmation_guard_rejected"],
    expiresAtMs: Date.now() + 60_000,
    preview: {
      contactDisplayName: "Example Recipient",
      contactPhone: "+12025550124",
      message: "Example Civic Team says hello. Reply STOP to opt out.",
    },
  };
  const state = {
    campaigns: {
      campaign: { campaignId: "campaign-one", canFetchQueue: true },
      queue: { items: [item] },
    },
  };
  const held = new Set();
  const calls = [];
  const r = {
    view: () => state,
    can: (name) => name === "manualQueue",
    workspace: () => ({ canSend: true, capabilities: { manualQueue: true } }),
    billing: () => ({ sendingBlocked: false }),
    context: () => ({ resourceId: "campaign-one" }),
    busy: () => false,
    sendHeld: (key) => held.has(key),
    armExpiry: () => {},
    api: async (path, body) => {
      calls.push({ path, body });
      assert.equal(path, "/campaigns/campaign-one/queue");
      return {
        items: [
          {
            ...item,
            state: "awaiting_confirmation",
            blockedReasons: [],
            humanConfirmation: { recordId: "fresh-proof" },
          },
        ],
      };
    },
  };
  return { page: createCampaigns(r), state, calls, item, held, r };
}

test("technical validation is visible, stays unsendable, and rechecks the held recipient without sending", async () => {
  const { page, state, calls, item } = fixture();
  const html = page.render("send");
  assert.match(
    html,
    /<div class="pt-notice" role="status"><strong>Sending unavailable<\/strong><p>Polis could not verify/,
  );
  assert.match(html, /data-workspace-action="queue-confirm"[^>]*disabled/);
  assert.doesNotMatch(html, /Opted out|An opt-out is recorded/);
  await assert.rejects(page.action("queue-confirm"), /not ready/);
  assert.equal(calls.length, 0);
  await page.action("queue-recheck");
  assert.deepEqual(calls, [
    { path: "/campaigns/campaign-one/queue", body: {} },
  ]);
  assert.equal(state.campaigns.queue.items[0].itemId, item.itemId);
  assert.match(
    page.render("send"),
    /data-workspace-action="queue-confirm"[^>]*>Send to Example Recipient/,
  );
  assert.doesNotMatch(
    page.render("send"),
    /Sending unavailable|Check recipient again/,
  );
  assert.equal(state.campaigns.sent, undefined);
});

test("only explicit recipient suppression implies opt-out; unknown failures and contact restrictions do not", async () => {
  const { page, calls, item } = fixture();
  for (const code of [
    "prompt_recipient_suppressed",
    "texting_recipient_suppressed",
  ]) {
    item.blockedReasons = [code];
    assert.equal(queueBlockExplanation(item).title, "Opted out");
    assert.match(page.render("send"), /An opt-out is recorded/);
    assert.doesNotMatch(page.render("send"), /Check recipient again/);
    await assert.rejects(page.action("queue-recheck"), /needs review/);
  }
  item.blockedReasons = ["prompt_contact_suppressed"];
  assert.equal(queueBlockExplanation(item).title, "Texting restricted");
  assert.doesNotMatch(page.render("send"), />Opted out</);
  for (const reasons of [
    [],
    ["queue_item_not_ready"],
    ["prompt_confirmation_scope_mismatch"],
  ]) {
    item.blockedReasons = reasons;
    assert.equal(queueBlockExplanation(item).title, "Sending unavailable");
    assert.doesNotMatch(
      page.render("send"),
      /Opted out|An opt-out is recorded/,
    );
  }
  assert.equal(calls.length, 0);
});

test("rechecking never bypasses pending sends, uncertain outcomes, or queue permissions", async () => {
  const { page, state, calls, held, r, item } = fixture();
  held.add("queue:campaign-one:held-recipient");
  assert.doesNotMatch(page.render("send"), /Check recipient again/);
  await assert.rejects(page.action("queue-recheck"), /needs review/);
  held.clear();
  state.campaigns.pendingItemId = item.itemId;
  await assert.rejects(page.action("queue-recheck"), /needs review/);
  state.campaigns.pendingItemId = null;
  item.state = "provider_outcome_unknown";
  await assert.rejects(page.action("queue-recheck"), /needs review/);
  item.state = "blocked";
  r.can = () => false;
  await assert.rejects(page.action("queue-recheck"), /not ready/);
  r.can = () => true;
  state.campaigns.campaign.canFetchQueue = false;
  await assert.rejects(page.action("queue-recheck"), /not ready/);
  assert.equal(calls.length, 0);
});

test("selection verification failures explain the source issue; attempted recipients cannot be rechecked", async () => {
  const { page, calls, item } = fixture();
  item.blockedReasons = ["prompt_source_guard_required"];
  assert.match(
    page.render("send"),
    /could not verify this recipient against the campaign’s saved contact selection/,
  );
  assert.doesNotMatch(page.render("send"), /Opted out|sending approval/);
  assert.equal(queueBlockExplanation(item).canRecheck, true);
  item.blockedReasons = ["prompt_source_membership_changed"];
  assert.match(page.render("send"), /saved contact selection has changed/);
  await assert.rejects(page.action("queue-recheck"), /needs review/);
  for (const code of [
    "prompt_provider_item_already_attempted",
    "prompt_logical_recipient_already_attempted",
    "prompt_confirmation_already_claimed",
    "provider_outcome_reconciliation_required",
    "queue_reconciliation_required",
  ]) {
    item.blockedReasons = [code, "prompt_source_guard_required"];
    assert.equal(queueBlockExplanation(item).title, "Delivery needs review");
    assert.doesNotMatch(page.render("send"), /Check recipient again/);
    await assert.rejects(page.action("queue-recheck"), /needs review/);
  }
  assert.equal(calls.length, 0);
});
