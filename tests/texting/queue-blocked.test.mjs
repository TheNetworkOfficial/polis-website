import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { queueBlockExplanation, queueCanSkip } = await import(
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
            expiresAtMs: Date.now() + 60_000,
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
    /aria-label="Send to Example Recipient"[^>]*data-workspace-action="queue-confirm"[^>]*>Send<\/button>/,
  );
  assert.doesNotMatch(
    page.render("send"),
    /Sending unavailable|Check recipient again/,
  );
  assert.equal(state.campaigns.sent, undefined);
});

test("an expired untouched preview renews the held queue only after explicit refresh", async () => {
  const { page, state, calls, item } = fixture();
  Object.assign(item, {
    state: "awaiting_confirmation",
    blockedReasons: [],
    humanConfirmation: { recordId: "old-proof" },
    expiresAtMs: Date.now() - 1,
  });
  assert.match(page.render("send"), /Refresh message previews/);
  await assert.rejects(page.action("queue-confirm"), /not ready/);
  assert.equal(calls.length, 0);
  await page.action("queue-refresh-preview");
  assert.deepEqual(calls, [
    { path: "/campaigns/campaign-one/queue", body: {} },
  ]);
  assert.equal(state.campaigns.queue.items[0].itemId, item.itemId);
  assert.equal(
    state.campaigns.queue.items[0].humanConfirmation.recordId,
    "fresh-proof",
  );
  assert.doesNotMatch(
    page.render("send"),
    /Preview expired|Refresh message previews/,
  );
  assert.equal(state.campaigns.sent, undefined);
});

test("preview refresh cannot bypass an attempted send, blocked recipient or provider lease", async () => {
  const { page, state, calls, item, held } = fixture();
  Object.assign(item, {
    state: "awaiting_confirmation",
    blockedReasons: [],
    humanConfirmation: {},
    expiresAtMs: Date.now() - 1,
  });
  held.add("queue:campaign-one:held-recipient");
  await assert.rejects(page.action("queue-refresh-preview"));
  held.clear();
  state.campaigns.pendingItemId = item.itemId;
  await assert.rejects(page.action("queue-refresh-preview"));
  state.campaigns.pendingItemId = null;
  for (const status of [
    "provider_outcome_unknown",
    "skip_unknown",
    "lease_expired",
    "blocked",
  ]) {
    item.state = status;
    assert.doesNotMatch(
      page.render("send"),
      /data-workspace-action="queue-refresh-preview"/,
    );
    await assert.rejects(page.action("queue-refresh-preview"));
  }
  item.state = "awaiting_confirmation";
  item.stream = "opt_in";
  await assert.rejects(page.action("queue-refresh-preview"));
  assert.equal(calls.length, 0);
});

test("stopped campaigns expose server-authorized Skip recovery while hiding sends", async () => {
  const { page, state, item } = fixture();
  Object.assign(state.campaigns.campaign, {
    status: "archived",
    queueRecoveryRequired: true,
  });
  Object.assign(item, {
    canSkip: true,
    blockedReasons: ["prompt_campaign_archived"],
  });
  assert.equal(queueCanSkip(item), true);
  assert.match(page.render("send"), /Campaign is stopped/);
  assert.match(
    page.render("send"),
    /data-workspace-action="queue-skip"[^>]*>Skip recipient/,
  );
  assert.doesNotMatch(
    page.render("send"),
    /data-workspace-action="queue-confirm"/,
  );
  await assert.rejects(page.action("queue-confirm"));
  state.campaigns.queue.items = [];
  state.campaigns.queue.state = "complete";
  assert.match(page.render("send"), /Held recipients reviewed/);
  assert.doesNotMatch(
    page.render("send"),
    /data-workspace-action="queue-load"/,
  );
  state.campaigns.queue.state = "preparing";
  assert.match(page.render("send"), /Check recipients/);
});

test("explicit skip authority handles restricted held items but never uncertain attempts", () => {
  const item = {
    state: "blocked",
    canSkip: true,
    blockedReasons: ["prompt_contact_suppressed"],
  };
  assert.equal(queueCanSkip(item), true);
  for (const state of [
    "provider_outcome_unknown",
    "skip_unknown",
    "lease_expired",
    "confirmed",
  ]) {
    assert.equal(queueCanSkip({ ...item, state }), false);
  }
  assert.equal(
    queueCanSkip({ state: "awaiting_confirmation", canSkip: false }),
    false,
  );
  assert.equal(
    queueCanSkip({ ...item, leaseExpiresAtMs: Date.now() - 1 }),
    false,
  );
});

test("explicit queue loading continues only bounded saved checkpoints and stops errors or unknown allocations", async () => {
  for (const mode of [
    "complete",
    "limit",
    "unknown",
    "unmarked",
    "error",
    "changed",
  ]) {
    const { page, state, item, r } = fixture();
    let reads = 0;
    const allocationId = "00000000-0000-4000-8000-000000000001";
    r.api = async (path, body) => {
      assert.equal(path, "/campaigns/campaign-one/queue");
      assert.deepEqual(body, reads === 0 ? {} : { allocationId });
      reads++;
      if (mode === "error") throw new Error("Read unavailable");
      if (mode === "unknown") return { state: "allocation_unknown", items: [] };
      if (mode === "unmarked") return { state: "preparing", items: [] };
      if (mode === "complete" && reads === 6)
        return { state: "held", items: [item] };
      return {
        state: "preparing",
        preparationKind: "queue_materialization",
        allocationId:
          mode === "changed" && reads === 2
            ? "00000000-0000-4000-8000-000000000002"
            : allocationId,
        retryAfterMs: 0,
        items: [],
      };
    };
    if (mode === "error")
      await assert.rejects(page.action("queue-load"), /Read unavailable/);
    else if (mode === "changed")
      await assert.rejects(page.action("queue-load"), /assignment changed/);
    else await page.action("queue-load");
    assert.equal(
      reads,
      mode === "complete"
        ? 6
        : mode === "limit"
          ? 8
          : mode === "changed"
            ? 2
            : 1,
    );
    assert.equal(state.campaigns.sent, undefined);
  }
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

test("invalid personalized content can be skipped explicitly in either stream, never sent or rechecked", async () => {
  for (const resultState of ["accepted", "skipped"]) {
    const { page, state, item, r, held, calls } = fixture();
    item.blockedReasons = ["texting_personalization_value_invalid"];
    item.humanConfirmation = null;
    Object.assign(r, {
      holdSend: (key) => held.add(key),
      releaseSend: (key) => held.delete(key),
      changed: () => {},
      toast: () => {},
      refreshSendStatus: async () => {},
      api: async (path, body) => {
        calls.push({ path, body });
        return { result: { itemId: item.itemId, state: resultState } };
      },
    });
    assert.match(page.render("send"), /Message needs attention/);
    assert.match(
      page.render("send"),
      /data-workspace-action="queue-skip"[^>]*>Skip recipient/,
    );
    assert.match(
      page.render("send"),
      /data-workspace-action="queue-confirm"[^>]*disabled/,
    );
    assert.doesNotMatch(page.render("send"), /Check recipient again/);
    await assert.rejects(page.action("queue-confirm"), /not ready/);
    await assert.rejects(page.action("queue-recheck"), /needs review/);
    await page.action("queue-skip");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].path,
      "/campaigns/campaign-one/queue/held-recipient/skip",
    );
    assert.ok(calls[0].body.actionId);
    assert.equal(state.campaigns.queue.items.length, 0);
    assert.equal(state.campaigns.sent, undefined);
    assert.equal(held.size, 0);
  }
});

test("personalized Skip retains lease, attempt, pending, unknown-outcome, and permission fences", async () => {
  const { page, state, item, r, held, calls } = fixture();
  item.blockedReasons = ["texting_personalization_value_invalid"];
  assert.equal(queueCanSkip(item), true);
  for (const code of [
    "prompt_confirmation_already_claimed",
    "provider_outcome_reconciliation_required",
    "prompt_recipient_suppressed",
    "unknown_reason",
  ]) {
    item.blockedReasons.push(code);
    assert.equal(queueCanSkip(item), false);
    await assert.rejects(page.action("queue-skip"), /not ready/);
    item.blockedReasons.pop();
  }
  assert.equal(queueCanSkip({ ...item, blockedReasons: [] }), false);
  assert.equal(
    queueCanSkip({
      ...item,
      expiresAtMs: Date.now() - 1,
      leaseExpiresAtMs: null,
    }),
    true,
  );
  assert.equal(
    queueCanSkip({
      ...item,
      expiresAtMs: undefined,
      leaseExpiresAtMs: Date.now() + 60_000,
    }),
    true,
  );
  assert.equal(
    queueCanSkip({ ...item, leaseExpiresAtMs: Date.now() - 1 }),
    false,
  );
  assert.equal(queueCanSkip({ ...item, leaseExpiresAtMs: "invalid" }), false);
  assert.equal(
    queueCanSkip({ ...item, state: "provider_outcome_unknown" }),
    false,
  );
  assert.equal(queueCanSkip({ ...item, state: "lease_expired" }), false);
  held.add("queue:campaign-one:held-recipient");
  await assert.rejects(page.action("queue-skip"), /not ready/);
  held.clear();
  state.campaigns.pendingItemId = item.itemId;
  await assert.rejects(page.action("queue-skip"), /not ready/);
  state.campaigns.pendingItemId = null;
  r.can = () => false;
  await assert.rejects(page.action("queue-skip"), /not ready/);
  r.can = () => true;
  state.campaigns.campaign.canFetchQueue = false;
  await assert.rejects(page.action("queue-skip"), /not ready/);
  assert.equal(calls.length, 0);
});

test("a skipped response to Confirm cannot be treated as a successful send", async () => {
  const { page, state, item, r, held } = fixture();
  item.state = "awaiting_confirmation";
  item.blockedReasons = [];
  item.humanConfirmation = { recordId: "proof" };
  Object.assign(r, {
    holdSend: (key) => held.add(key),
    releaseSend: (key) => held.delete(key),
    changed: () => {},
    toast: () => {},
    refreshSendStatus: async () => {},
    api: async () => ({ result: { itemId: item.itemId, state: "skipped" } }),
  });
  await page.action("queue-confirm");
  assert.equal(state.campaigns.queue.items.length, 1);
  assert.equal(state.campaigns.sent, undefined);
  assert.equal(held.size, 1);
});
