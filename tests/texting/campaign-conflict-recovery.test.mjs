import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { customerText } = await import(await moduleUrl("textingWorkspaceUi"));
const conflict = (code) =>
  Object.assign(new Error(code), { status: 409, payload: { error: code } });
const campaign = (extra = {}) => ({
  campaignId: "campaign-one",
  revision: 3,
  status: "prepared",
  name: "Example campaign",
  canActivate: true,
  canFetchQueue: false,
  assignedUserIds: ["volunteer"],
  blockedReasons: [],
  audienceId: "reviewed-audience",
  templateText: "Example organization. Reply STOP.",
  mediaId: null,
  ...extra,
});
function fixture(t, handler, section = "campaigns", extraCapabilities = []) {
  const priorWindow = globalThis.window;
  globalThis.window = { confirm: () => true };
  t.after(() => {
    globalThis.window = priorWindow;
  });
  const draft = {
    name: "Unsaved local edit",
    templateText: "Unsaved local message",
  };
  const view = {
      campaigns: { campaign: campaign(), draft, scheduleUnsupported: true },
    },
    calls = [],
    toasts = [],
    holds = new Set();
  let current = true;
  const r = {
    context: () => ({
      organizationId: "example-org",
      userId: "volunteer",
      section,
      resourceId: "campaign-one",
    }),
    view: () => view,
    guard: () => {
      if (!current) throw new Error("Workspace changed");
    },
    can: (name) =>
      [
        "createCampaigns",
        "manualQueue",
        "queueStatus",
        ...extraCapabilities,
      ].includes(name),
    busy: () => false,
    workspace: () => ({
      contractVersion: 2,
      canSend: true,
      capabilities: { manualQueue: true },
    }),
    billing: () => ({ sendingBlocked: false }),
    contactApi: { invalidate() {} },
    changed() {},
    armExpiry() {},
    sendHeld: (key) => holds.has(key),
    holdSend: (key) => holds.add(key),
    releaseSend: (key) => holds.delete(key),
    toast: (message) => toasts.push(message),
    navigate() {},
    api: async (path, body, method) => {
      const wireMethod = body === undefined ? "GET" : method || "POST";
      calls.push({
        path,
        body,
        method: wireMethod,
      });
      if (path === "/texter/ensure") {
        assert.equal(wireMethod, "POST");
        assert.deepEqual(body, { campaignId: "campaign-one" });
        return { texter: { state: "ready" } };
      }
      if (body !== undefined) {
        assert.equal(
          wireMethod,
          "POST",
          "recovery must never change the mutation method",
        );
        assert.equal(
          path,
          section === "send"
            ? "/campaigns/campaign-one/queue"
            : "/campaigns/campaign-one/transition",
          "a different mutation cannot masquerade as the refused campaign/queue request",
        );
        if (section === "campaigns")
          assert.deepEqual(body, { expectedRevision: 3, action: "activate" });
        else
          assert.ok(
            Object.keys(body).every((key) =>
              ["allocationId", "sessionId"].includes(key),
            ),
          );
      } else {
        assert.equal(wireMethod, "GET");
        assert.ok(
          [
            "/campaigns/campaign-one",
            "/campaigns/campaign-one/queue",
            "/campaigns/campaign-one/recipient-batches?limit=20",
            "/campaigns/previous-campaign",
          ].includes(path),
          `unexpected recovery read: ${path}`,
        );
      }
      return handler({
        path,
        body,
        calls,
        view,
        leave: () => {
          current = false;
        },
      });
    },
  };
  const page = createCampaigns(r);
  t.after(() => page.dispose());
  return { page, state: view.campaigns, calls, draft, toasts, holds };
}
const mutations = (h) => h.calls.filter((call) => call.method !== "GET");
const emptyStatus = (extra = {}) => ({
  campaignId: "campaign-one",
  state: "none",
  items: [],
  readOnly: true,
  resendPermitted: false,
  canResumeAllocation: false,
  parked: false,
  allocationToken: null,
  ...extra,
});

test("a successful fresh queue request renders its saved recipients without sending or reallocating", async (t) => {
  const item = {
    itemId: "ready-recipient",
    state: "awaiting_confirmation",
    expiresAtMs: Date.now() + 60000,
    humanConfirmation: { recordId: "exact-saved-receipt" },
    blockedReasons: [],
    preview: {
      contactPhone: "+12025550124",
      contactDisplayName: "Example Recipient",
      message: "Example organization says hello. Reply STOP.",
    },
  };
  const queue = {
    campaignId: "campaign-one",
    state: "held",
    allocationId: "a1111111-1111-4111-8111-111111111111",
    items: [item],
  };
  const h = fixture(
    t,
    ({ path, body }) => {
      assert.equal(path, "/campaigns/campaign-one/queue");
      assert.deepEqual(body, {});
      return structuredClone(queue);
    },
    "send",
  );
  h.state.campaign = campaign({ status: "active", canFetchQueue: true });
  await h.page.action("queue-load");
  assert.deepEqual(h.state.queue, queue);
  const html = h.page.render("send");
  assert.match(html, /Example Recipient/);
  assert.match(html, /Example organization says hello/);
  const sendButton = html.match(
    /<button[^>]*data-workspace-action="queue-confirm"[^>]*>/,
  )?.[0];
  assert.ok(sendButton);
  assert.doesNotMatch(sendButton, /disabled/);
  assert.deepEqual(
    h.calls.map(({ path, method }) => ({ path, method })),
    [
      { path: "/texter/ensure", method: "POST" },
      { path: "/campaigns/campaign-one/queue", method: "POST" },
    ],
  );
  assert.equal(h.state.queueRequestNeedsRead, false);
  assert.equal(h.holds.size, 0);
});

test("successful activation observes the active campaign and reads its recipient additions without another mutation", async (t) => {
  const active = campaign({
    revision: 4,
    status: "active",
    canActivate: false,
    canFetchQueue: true,
  });
  const h = fixture(
    t,
    ({ path, body }) => {
      if (path === "/campaigns/campaign-one/transition") {
        assert.deepEqual(body, { expectedRevision: 3, action: "activate" });
        return { campaign: structuredClone(active) };
      }
      assert.equal(path, "/campaigns/campaign-one/recipient-batches?limit=20");
      assert.equal(body, undefined);
      return { items: [], nextCursor: null };
    },
    "campaigns",
    ["appendCampaignRecipients"],
  );
  await h.page.action("transition-activate");
  assert.deepEqual(h.state.campaign, active);
  assert.equal(h.state.preparingRecipients, false);
  assert.deepEqual(h.state.additionBatches, []);
  assert.equal(h.state.additionError, "");
  assert.equal(h.state.draft, h.draft);
  assert.match(h.page.render("campaigns"), /Start texting/);
  assert.deepEqual(
    h.calls.map(({ path, method }) => ({ path, method })),
    [
      { path: "/campaigns/campaign-one/transition", method: "POST" },
      {
        path: "/campaigns/campaign-one/recipient-batches?limit=20",
        method: "GET",
      },
    ],
  );
});

for (const code of [
  "prompt_campaign_revision_conflict",
  "texting_campaign_revision_conflict",
])
  test(`${code} reads the active campaign and preserves edits without replaying activation`, async (t) => {
    const h = fixture(t, ({ body }) => {
      if (body) throw conflict(code);
      return {
        campaign: campaign({
          revision: 4,
          status: "active",
          canActivate: false,
          canFetchQueue: true,
        }),
      };
    });
    await h.page.action("transition-activate");
    assert.equal(mutations(h).length, 1);
    assert.equal(h.calls.length, 2);
    assert.equal(h.state.campaign.status, "active");
    assert.equal(h.state.draft, h.draft);
    assert.match(h.page.render("campaigns"), /Campaign status updated/);
    h.page.localAction("compact-details");
    assert.match(h.page.render("campaigns"), /This campaign is active/);
    assert.match(h.page.render("campaigns"), /Start texting/);
    assert.equal(h.state.campaignStatusNeedsRead, false);
    assert.deepEqual(mutations(h)[0].body, {
      expectedRevision: 3,
      action: "activate",
    });
  });

test("pending activation shows its saved state and explicit refresh performs only another GET", async (t) => {
  let pending = true;
  const h = fixture(t, ({ body }) => {
    if (body) throw conflict("prompt_campaign_revision_conflict");
    return {
      campaign: campaign({
        revision: pending ? 3 : 4,
        status: pending ? "activating" : "active",
        canActivate: false,
        canFetchQueue: !pending,
      }),
    };
  });
  await h.page.action("transition-activate");
  h.page.localAction("compact-details");
  assert.match(h.page.render("campaigns"), /Campaign is opening/);
  assert.doesNotMatch(h.page.render("campaigns"), /Start texting/);
  pending = false;
  await h.page.action("campaign-status-refresh");
  assert.equal(mutations(h).length, 1);
  assert.equal(h.state.campaign.status, "active");
});

test("failed revision read keeps the draft and blocks another mutation until explicit status refresh succeeds", async (t) => {
  let failed = true;
  const h = fixture(t, ({ body }) => {
    if (body) throw conflict("prompt_campaign_revision_conflict");
    if (failed)
      throw Object.assign(new Error("Read unavailable"), { status: 503 });
    return {
      campaign: campaign({
        revision: 4,
        status: "active",
        canActivate: false,
        canFetchQueue: true,
      }),
    };
  });
  await assert.rejects(
    h.page.action("transition-activate"),
    /latest status could not be checked/,
  );
  assert.equal(h.state.draft, h.draft);
  assert.equal(h.state.campaignStatusNeedsRead, true);
  assert.match(h.page.render("campaigns"), /Refresh campaign status/);
  h.page.localAction("compact-more");
  h.page.localAction("compact-panel", "campaign");
  assert.match(
    h.page.render("campaigns"),
    /data-workspace-action="transition-activate"[^>]*disabled/,
  );
  await assert.rejects(
    h.page.action("transition-activate"),
    /Refresh campaign status/,
  );
  assert.equal(mutations(h).length, 1);
  failed = false;
  await h.page.action("campaign-status-refresh");
  assert.equal(h.state.campaignStatusNeedsRead, false);
  assert.equal(mutations(h).length, 1);
});

for (const bad of [
  campaign({ campaignId: "another-campaign", revision: 4 }),
  campaign({ revision: 2 }),
])
  test(`revision recovery rejects a mismatched or older saved campaign ${bad.campaignId}:${bad.revision}`, async (t) => {
    const h = fixture(t, ({ body }) => {
      if (body) throw conflict("prompt_campaign_revision_conflict");
      return { campaign: bad };
    });
    await assert.rejects(
      h.page.action("transition-activate"),
      /latest status could not be checked/,
    );
    assert.equal(h.state.campaign.revision, 3);
    assert.equal(h.state.campaignStatusNeedsRead, true);
    assert.equal(mutations(h).length, 1);
  });

test("a scope change during revision read cannot install the late campaign", async (t) => {
  const h = fixture(t, ({ body, leave }) => {
    if (body) throw conflict("prompt_campaign_revision_conflict");
    leave();
    return { campaign: campaign({ revision: 4, status: "active" }) };
  });
  await assert.rejects(h.page.action("transition-activate"));
  assert.equal(h.state.campaign.revision, 3);
  assert.equal(mutations(h).length, 1);
});

test("a slower revision read cannot overwrite a newer campaign accepted while it was in flight", async (t) => {
  const h = fixture(t, ({ body, view }) => {
    if (body) throw conflict("prompt_campaign_revision_conflict");
    view.campaigns.campaign = campaign({ revision: 5, status: "paused" });
    return { campaign: campaign({ revision: 4, status: "active" }) };
  });
  await assert.rejects(
    h.page.action("transition-activate"),
    /latest status could not be checked/,
  );
  assert.equal(h.state.campaign.revision, 5);
  assert.equal(h.state.campaign.status, "paused");
  assert.equal(mutations(h).length, 1);
});

for (const code of [
  "prompt_other_campaign_queue_held",
  "texting_other_campaign_queue_held",
])
  test(`${code} names the previous assignment using reads and never allocates again automatically`, async (t) => {
    let previous = true;
    const h = fixture(
      t,
      ({ path, body }) => {
        if (body) throw conflict(code);
        if (path.endsWith("/queue"))
          return emptyStatus({
            queueSession: previous ? { campaignId: "previous-campaign" } : null,
          });
        if (path.endsWith("/previous-campaign"))
          return {
            campaign: campaign({
              campaignId: "previous-campaign",
              name: "Earlier precinct campaign",
            }),
          };
        assert.fail(`Unexpected read ${path}`);
      },
      "send",
    );
    h.state.campaign = campaign({ status: "active", canFetchQueue: true });
    await h.page.action("queue-load");
    assert.equal(
      mutations(h).filter((call) => call.path.endsWith("/queue")).length,
      1,
    );
    assert.match(h.page.render("send"), /Review assignment/);
    h.page.localAction("compact-details");
    assert.match(h.page.render("send"), /Earlier precinct campaign/);
    assert.match(h.page.render("send"), /Open previous campaign/);
    assert.doesNotMatch(
      h.page.render("send"),
      /data-workspace-action="queue-load"/,
    );
    await assert.rejects(
      h.page.action("queue-load"),
      /Check saved recipient status/,
    );
    previous = false;
    await h.page.action("queue-check-request");
    assert.equal(h.state.queueRequestNeedsRead, false);
    assert.equal(
      mutations(h).filter((call) => call.path.endsWith("/queue")).length,
      1,
    );
  });

test("known preallocation refusal with failed status read remains blocked without a second allocation", async (t) => {
  const h = fixture(
    t,
    ({ body }) => {
      if (body) throw conflict("prompt_other_campaign_queue_held");
      throw new Error("Read failed");
    },
    "send",
  );
  h.state.campaign = campaign({ status: "active", canFetchQueue: true });
  await assert.rejects(
    h.page.action("queue-load"),
    /saved recipient status could not be checked/,
  );
  assert.equal(h.state.queueRequestNeedsRead, true);
  await assert.rejects(
    h.page.action("queue-load"),
    /Check saved recipient status/,
  );
  assert.equal(
    mutations(h).filter((call) => call.path.endsWith("/queue")).length,
    1,
  );
});

test("an observed owned or uncertain assignment consumes the original refusal proof even if a later read is empty", async (t) => {
  for (const observed of [
    emptyStatus({
      state: "held",
      canResumeAllocation: true,
      allocationToken: "held-token",
    }),
    emptyStatus({
      state: "materializing",
      canResumeAllocation: true,
      allocationToken: "checkpoint-token",
    }),
    emptyStatus({
      state: "allocation_unknown",
      allocationToken: "unknown-token",
    }),
    emptyStatus({ state: "none", allocationToken: "unexpected-token" }),
    emptyStatus({
      queueSession: {
        campaignId: "campaign-one",
        allocationId: "new-owner-token",
      },
    }),
    emptyStatus({ parked: true }),
    emptyStatus({
      state: "complete",
      items: [
        {
          itemId: "uncertain-item",
          state: "provider_outcome_unknown",
          resendPermitted: false,
        },
      ],
    }),
    emptyStatus({
      state: "complete",
      items: [
        {
          itemId: "rejected-item",
          state: "rejected_not_accepted",
          resendPermitted: false,
          nonAcceptanceVerified: false,
        },
      ],
    }),
  ]) {
    let first = true;
    const h = fixture(
      t,
      ({ body }) => {
        if (body) throw conflict("prompt_other_campaign_queue_held");
        const status = first ? observed : emptyStatus();
        first = false;
        return status;
      },
      "send",
    );
    h.state.campaign = campaign({ status: "active", canFetchQueue: true });
    await h.page.action("queue-load");
    assert.equal(h.state.queueRequestKnownRefusal, false);
    assert.equal(h.state.queueRequestWasFresh, false);
    await h.page.action("queue-check-request");
    assert.equal(h.state.queueRequestNeedsRead, true);
    await assert.rejects(
      h.page.action("queue-load"),
      /Check saved recipient status/,
    );
    assert.equal(
      mutations(h).filter((call) => call.path.endsWith("/queue")).length,
      1,
    );
  }
});

test("sealed terminal history alone does not strand a definitively refused fresh recipient request", async (t) => {
  const history = [
    { itemId: "sent", state: "confirmed", resendPermitted: false },
    { itemId: "skipped", state: "skipped", resendPermitted: false },
    { itemId: "returned", state: "released_unused", resendPermitted: false },
    {
      itemId: "rejected",
      state: "rejected_not_accepted",
      resendPermitted: false,
      nonAcceptanceVerified: true,
    },
  ];
  const h = fixture(
    t,
    ({ body }) => {
      if (body) throw conflict("prompt_other_campaign_queue_held");
      return emptyStatus({
        state: "complete",
        allocationToken: "historical-token",
        items: history,
      });
    },
    "send",
  );
  h.state.campaign = campaign({ status: "active", canFetchQueue: true });
  await h.page.action("queue-load");
  assert.equal(h.state.queueRequestNeedsRead, false);
  h.page.localAction("compact-details");
  assert.match(h.page.render("send"), /No unfinished recipient request/);
  assert.equal(
    mutations(h).filter((call) => call.path.endsWith("/queue")).length,
    1,
  );
});

test("late empty recipient status cannot clear a newly observed local held assignment", async (t) => {
  const held = {
    state: "held",
    allocationId: "newly-observed",
    items: [{ itemId: "kept", state: "provider_outcome_unknown" }],
  };
  const h = fixture(
    t,
    ({ body, view }) => {
      if (body) throw conflict("prompt_other_campaign_queue_held");
      view.campaigns.queue = structuredClone(held);
      return emptyStatus();
    },
    "send",
  );
  h.state.campaign = campaign({ status: "active", canFetchQueue: true });
  await h.page.action("queue-load");
  assert.equal(h.state.queueRequestNeedsRead, true);
  assert.deepEqual(h.state.queue, held);
  assert.equal(
    mutations(h).filter((call) => call.path.endsWith("/queue")).length,
    1,
  );
});

test("recipient status must prove read-only exact scope before permitting another explicit request", async (t) => {
  for (const invalid of [
    emptyStatus({ readOnly: false }),
    emptyStatus({ resendPermitted: true }),
    emptyStatus({ campaignId: "other" }),
    emptyStatus({ state: "none", items: null }),
  ]) {
    const h = fixture(
      t,
      ({ body }) => {
        if (body) throw conflict("prompt_other_campaign_queue_held");
        return invalid;
      },
      "send",
    );
    h.state.campaign = campaign({ status: "active", canFetchQueue: true });
    await assert.rejects(
      h.page.action("queue-load"),
      /saved recipient status could not be checked/,
    );
    assert.equal(h.state.queueRequestNeedsRead, true);
    assert.equal(
      mutations(h).filter((call) => call.path.endsWith("/queue")).length,
      1,
    );
  }
});

test("an uncertain allocation waits for explicit status read and keeps real server uncertainty protected", async (t) => {
  const h = fixture(
    t,
    ({ body }) => {
      if (body) throw new TypeError("Lost response");
      return emptyStatus({ state: "allocation_unknown" });
    },
    "send",
  );
  h.state.campaign = campaign({ status: "active", canFetchQueue: true });
  await assert.rejects(
    h.page.action("queue-load"),
    /request could not be confirmed/,
  );
  assert.equal(
    h.calls.filter(
      (call) => call.method === "GET" && call.path.endsWith("/queue"),
    ).length,
    0,
  );
  await h.page.action("queue-check-request");
  assert.equal(h.state.queueRequestNeedsRead, true);
  assert.match(h.page.render("send"), /Unconfirmed/);
  h.page.localAction("compact-details");
  assert.match(h.page.render("send"), /server still needs to reconcile/);
  await assert.rejects(
    h.page.action("queue-load"),
    /Check saved recipient status/,
  );
  assert.equal(
    mutations(h).filter((call) => call.path.endsWith("/queue")).length,
    1,
  );
});

test("an empty status read after a lost allocation response is not proof that the original request never started", async (t) => {
  const h = fixture(
    t,
    ({ body }) => {
      if (body) throw new TypeError("Lost response");
      return emptyStatus();
    },
    "send",
  );
  h.state.campaign = campaign({ status: "active", canFetchQueue: true });
  await assert.rejects(
    h.page.action("queue-load"),
    /request could not be confirmed/,
  );
  await h.page.action("queue-check-request");
  assert.equal(h.state.queueRequestNeedsRead, true);
  assert.match(h.page.render("send"), /Unconfirmed/);
  h.page.localAction("compact-details");
  assert.match(
    h.page.render("send"),
    /result of the recipient request is still unconfirmed/,
  );
  assert.doesNotMatch(h.state.queueRequestMessage, /saved assignment/);
  await assert.rejects(
    h.page.action("queue-load"),
    /Check saved recipient status/,
  );
  assert.equal(
    mutations(h).filter((call) => call.path.endsWith("/queue")).length,
    1,
  );
});

test("existing held or partially materialized work cannot be cleared by an empty status read", async (t) => {
  for (const queue of [
    {
      state: "held",
      items: [{ itemId: "kept-item", state: "provider_outcome_unknown" }],
      allocationId: "kept-allocation",
    },
    {
      state: "preparing",
      preparationKind: "queue_materialization",
      allocationId: "a1111111-1111-4111-8111-111111111111",
      items: [],
    },
  ]) {
    const h = fixture(
      t,
      ({ body }) => {
        if (body) throw conflict("prompt_other_campaign_queue_held");
        return emptyStatus();
      },
      "send",
    );
    h.state.campaign = campaign({ status: "active", canFetchQueue: true });
    h.state.queue = structuredClone(queue);
    await assert.rejects(
      h.page.action("queue-load"),
      /request could not be confirmed/,
    );
    await h.page.action("queue-check-request");
    assert.equal(h.state.queueRequestNeedsRead, true);
    assert.deepEqual(h.state.queue, queue);
    assert.equal(
      mutations(h).filter((call) => call.path.endsWith("/queue")).length,
      1,
    );
  }
});

test("operational conflicts display guidance instead of technical codes", () => {
  for (const code of [
    "prompt_campaign_revision_conflict",
    "texting_campaign_revision_conflict",
    "prompt_other_campaign_queue_held",
    "texting_other_campaign_queue_held",
    "queue_reconciliation_required",
  ])
    assert.doesNotMatch(
      customerText(code),
      /revision_conflict|queue_held|reconciliation_required/,
    );
});
