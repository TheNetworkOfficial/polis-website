import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createTextingCompactStatus } = await import(
  await moduleUrl("textingCompactStatus")
);
function fixture({ manage = true } = {}) {
  const state = {
    campaign: {
      campaignId: "campaign-one",
      name: "Example outreach",
      revision: 4,
      status: "active",
      canFetchQueue: true,
    },
    draft: { templateText: "Preserve this unsaved message" },
  };
  const context = {
    userId: "volunteer-one",
    organizationId: "organization-one",
  };
  const workspace = { canSend: true },
    billing = { sendingBlocked: false },
    view = { campaigns: state, error: "", message: "" },
    calls = [],
    holds = new Set();
  let busy = false;
  const runtime = {
    context: () => context,
    view: () => view,
    workspace: () => workspace,
    billing: () => billing,
    can: (name) =>
      name === "manageBilling" || name === "createCampaigns"
        ? manage
        : name === "queueStatus",
    busy: () => busy,
    api: (...args) => {
      calls.push(args);
      assert.fail("presentation must not call an API");
    },
    holdSend: () => assert.fail("presentation cannot add a send fence"),
    releaseSend: () => assert.fail("presentation cannot clear a send fence"),
    sendHeld: (key) => holds.has(key),
  };
  const controller = createTextingCompactStatus(runtime, () => state);
  const render = (extra = {}) =>
    controller.render({
      body: "<article><p>Example organization says hello. Reply STOP.</p></article>",
      primary:
        '<button data-workspace-action="queue-load">Get next recipients</button>',
      caption: "One press sends to one person.",
      details: "<p>Existing message details and sending requirements.</p>",
      activity: "<p>Existing sent history.</p>",
      ...extra,
    });
  return {
    state,
    context,
    workspace,
    billing,
    view,
    calls,
    holds,
    controller,
    render,
    busy: (value) => {
      busy = value;
    },
  };
}

test("Got it acknowledges only the informational presentation and leaves all domain state untouched", () => {
  const h = fixture();
  h.state.campaignStatusMessage =
    "This campaign is active. Choose Start texting.";
  const before = structuredClone(h.state);
  assert.match(h.render(), /Campaign status updated/);
  assert.match(h.render(), /data-workspace-action="compact-ack"/);
  assert.equal(h.controller.localAction("compact-ack"), true);
  assert.doesNotMatch(h.render(), /data-workspace-action="compact-ack"/);
  assert.match(h.render(), /Ready to start/);
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.length, 0);
});

test("an active send is not labelled as a review failure, while a settled unknown outcome retains its hold", () => {
  const h = fixture(),
    key = "queue:campaign-one:pending-recipient";
  const row = {
    itemId: "pending-recipient",
    state: "awaiting_confirmation",
    humanConfirmation: { recordId: "original-proof" },
  };
  h.state.queue = {
    state: "held",
    items: [row],
    allocationToken: "original-allocation",
  };
  h.state.pendingItems = new Map([[row.itemId, "sending"]]);
  h.state.pendingItemId = row.itemId;
  h.holds.add(key);
  assert.equal(h.controller.model().kind, "ready");
  assert.doesNotMatch(h.controller.model().issues.join(" "), /needs? review/);
  h.state.pendingItems.clear();
  h.state.pendingItemId = null;
  row.state = "provider_outcome_unknown";
  const before = structuredClone(h.state);
  assert.equal(h.controller.model().kind, "attention");
  assert.match(h.controller.model().issues.join(" "), /needs review/);
  h.controller.localAction("compact-ack");
  h.controller.localAction("compact-overlay-close");
  assert.ok(h.holds.has(key));
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.length, 0);
});

test("the same update stays acknowledged across renders but a new revision or message is shown", () => {
  const h = fixture();
  h.state.campaignStatusMessage = "Status updated";
  h.controller.localAction("compact-ack");
  assert.doesNotMatch(h.render(), /data-workspace-action="compact-ack"/);
  assert.doesNotMatch(h.render(), /data-workspace-action="compact-ack"/);
  h.state.campaign.revision++;
  assert.match(h.render(), /data-workspace-action="compact-ack"/);
  h.controller.localAction("compact-ack");
  h.state.campaignStatusMessage = "A different saved update";
  assert.match(h.render(), /data-workspace-action="compact-ack"/);
});

test("an acknowledgement cannot carry across actor, organization or campaign boundaries", () => {
  for (const change of [
    (h) => {
      h.context.userId = "volunteer-two";
    },
    (h) => {
      h.context.organizationId = "organization-two";
    },
    (h) => {
      h.state.campaign.campaignId = "campaign-two";
    },
  ]) {
    const h = fixture();
    h.state.campaignStatusMessage = "Status updated";
    h.controller.localAction("compact-ack");
    change(h);
    assert.match(h.render(), /data-workspace-action="compact-ack"/);
  }
});

test("previous assignments and uncertain requests remain blocked after acknowledgement and panel dismissal", () => {
  for (const previous of [false, true]) {
    const h = fixture();
    h.state.queueRequestNeedsRead = true;
    h.state.queueRequestKnownRefusal = previous;
    h.state.queueRequestMessage = "The existing request remains protected.";
    if (previous)
      h.state.queuePreviousCampaign = {
        campaignId: "earlier-campaign",
        name: "Earlier outreach",
      };
    const before = structuredClone(h.state);
    h.controller.localAction("compact-details");
    assert.match(h.render(), /role="dialog"/);
    assert.match(
      h.render(),
      previous ? /Open previous campaign/ : /Check saved status/,
    );
    h.controller.localAction("compact-ack");
    h.controller.localAction("compact-overlay-close");
    const html = h.render();
    assert.doesNotMatch(html, /role="dialog"/);
    assert.match(html, previous ? /Review assignment/ : /Check saved status/);
    assert.doesNotMatch(html, /data-workspace-action="queue-load"/);
    assert.deepEqual(h.state, before);
    assert.equal(h.calls.length, 0);
  }
});

test("a real unknown allocation is compactly visible even without a local read flag", () => {
  const h = fixture();
  h.state.queue = {
    state: "allocation_unknown",
    items: [],
    allocationToken: "saved-token",
  };
  const before = structuredClone(h.state);
  assert.equal(h.controller.model().kind, "uncertain");
  assert.match(h.render(), /Unconfirmed/);
  assert.match(h.render(), /Check saved status/);
  h.controller.localAction("compact-details");
  h.controller.localAction("compact-overlay-close");
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.length, 0);
});

test("checking status disables its primary action while preserving the message and domain state", () => {
  const h = fixture();
  h.state.queueRequestNeedsRead = true;
  h.busy(true);
  const before = structuredClone(h.state),
    html = h.render();
  assert.equal(h.controller.model().kind, "checking");
  assert.match(html, /Checking saved status/);
  assert.match(
    html,
    /data-workspace-action="campaign-status-refresh"[^>]*disabled/,
  );
  assert.match(html, /Example organization says hello/);
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.length, 0);
});

test("details are a labelled modal with inert background and closing changes presentation only", () => {
  const h = fixture(),
    before = structuredClone(h.state);
  assert.doesNotMatch(h.render(), /role="dialog"/);
  h.controller.localAction("compact-details");
  const html = h.render();
  assert.match(html, /pt-compact-main" inert/);
  assert.match(
    html,
    /role="dialog" aria-modal="true" aria-labelledby="pt-compact-title"/,
  );
  assert.match(html, /data-contact-dialog="compact"/);
  assert.match(html, /aria-label="Close details"/);
  h.controller.localAction("compact-overlay-close");
  assert.doesNotMatch(h.render(), /pt-compact-main" inert/);
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.length, 0);
});

test("More preserves permission-gated management and saved recipient actions without executing them", () => {
  for (const manage of [false, true]) {
    const h = fixture({ manage });
    h.controller.localAction("compact-more");
    const html = h.render({
      recipients: "<p>Existing saved recipients.</p>",
      more: '<button data-workspace-action="existing-action">Existing action</button>',
    });
    assert.match(html, /Campaign options/);
    assert.match(html, /Assigned recipients/);
    assert.match(html, /Existing action/);
    assert.match(html, /Leave session/);
    if (manage) assert.match(html, /Manage team/);
    else assert.doesNotMatch(html, /Manage team/);
    assert.equal(h.calls.length, 0);
  }
});

test("activity and campaign panels retain existing detail content and do not intercept send or management actions", () => {
  const h = fixture();
  h.controller.localAction("compact-activity");
  assert.match(h.render(), /Existing sent history/);
  h.controller.localAction("compact-panel", "campaign");
  assert.match(h.render(), /Existing message details and sending requirements/);
  for (const action of [
    "queue-confirm",
    "queue-load",
    "queue-check-request",
    "transition-activate",
    "transition-archive",
  ])
    assert.equal(h.controller.localAction(action), false);
  assert.equal(h.calls.length, 0);
});

test("a real blocker outranks an informational update and cannot be acknowledged as resolved", () => {
  const h = fixture();
  h.state.campaignStatusMessage = "Campaign updated";
  h.view.error = "An operation needs review";
  assert.equal(h.controller.model().kind, "attention");
  assert.doesNotMatch(h.render(), /data-workspace-action="compact-ack"/);
  h.controller.localAction("compact-details");
  assert.match(h.render(), /An operation needs review/);
  h.controller.localAction("compact-ack");
  h.controller.localAction("compact-overlay-close");
  assert.equal(h.controller.model().kind, "attention");
  assert.equal(h.view.error, "An operation needs review");
});

test("one renewal is counted once and its details remain available", () => {
  const h = fixture();
  h.workspace.renewalDeadlines = [
    {
      label: "Texting approval",
      status: "due_soon",
      expiresAtMs: Date.now() + 86400000,
      owner: "Support",
    },
  ];
  assert.equal(h.controller.model().count, 1);
  h.controller.localAction("compact-details");
  assert.match(h.render(), /Texting approval/);
  assert.match(h.render(), /Support/);
  assert.equal(h.calls.length, 0);
});

test("paused, archived and pending activation do not advertise a ready-to-start state", () => {
  for (const status of ["paused", "archived", "activating"]) {
    const h = fixture();
    h.state.campaign.status = status;
    h.state.campaign.canFetchQueue = false;
    assert.doesNotMatch(h.controller.model().text, /Ready to start/);
    assert.doesNotMatch(
      h.render({
        primary:
          '<button data-workspace-action="review-only">Review campaign</button>',
      }),
      /data-workspace-action="queue-load"/,
    );
  }
});

test("untrusted campaign and assignment labels are escaped in compact surfaces", () => {
  const h = fixture();
  h.state.campaign.name = '<img src=x onerror="unsafe()">';
  h.state.queueRequestNeedsRead = true;
  h.state.queuePreviousCampaign = {
    campaignId: "earlier",
    name: "<script>unsafe()</script>",
  };
  h.controller.localAction("compact-details");
  const html = h.render();
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(h.calls.length, 0);
});
