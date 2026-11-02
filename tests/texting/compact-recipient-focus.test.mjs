import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const recipient = (itemId, name, extra = {}) => ({
  itemId,
  state: "awaiting_confirmation",
  expiresAtMs: Date.now() + 60000,
  humanConfirmation: { recordId: `receipt-${itemId}` },
  blockedReasons: [],
  preview: {
    contactDisplayName: name,
    contactPhone: "+12025550142",
    message: `Hi ${name}, this is Example Organization. Reply STOP to opt out.`,
  },
  ...extra,
});
function fixture(t, items, outcomeEnabled = false) {
  const state = {
    campaign: {
      campaignId: "example-campaign",
      name: "Example outreach",
      status: "active",
      canFetchQueue: true,
      templateText: "Saved template. Reply STOP to opt out.",
    },
    queue: { state: "ready", items },
  };
  const view = { campaigns: state };
  const calls = [];
  const runtime = {
    context: () => ({
      organizationId: "example-org",
      userId: "volunteer",
      section: "send",
      resourceId: "example-campaign",
    }),
    view: () => view,
    can: (name) =>
      ["manualQueue", "queueStatus"].includes(name) ||
      (outcomeEnabled && name === "recordRecipientOutcome"),
    workspace: () => ({ canSend: true, capabilities: { manualQueue: true } }),
    billing: () => ({ sendingBlocked: false }),
    busy: () => false,
    sendHeld: () => false,
    guard() {},
    api: (...args) => {
      calls.push(args);
      if (
        outcomeEnabled &&
        args[0] === "/campaigns/example-campaign/queue/alex/outcome" &&
        args[1] === undefined
      )
        return {
          outcome: {
            capabilities: { record: true },
            contactRevision: 7,
            availableTags: [],
            tags: [],
            partyOptions: [],
          },
        };
      throw Error("Rendering cannot dispatch work");
    },
    contactApi: { invalidate() {} },
  };
  const page = createCampaigns(runtime);
  t.after(() => page.dispose());
  return { page, state, calls };
}

test("the docked Send targets the exact one personalized preview in front of the user", (t) => {
  const h = fixture(t, [
    recipient("alex", "Alex"),
    recipient("jordan", "Jordan"),
  ]);
  const html = h.page.render("send");
  assert.match(html, /data-texting-recipient="alex"/);
  assert.match(html, /Hi Alex, this is Example Organization/);
  assert.doesNotMatch(html, /Hi Jordan/);
  assert.match(
    html,
    /aria-label="Send to Alex"[^>]*data-workspace-action="queue-confirm"[^>]*data-value="alex"/,
  );
  assert.equal(
    (html.match(/data-workspace-action="queue-confirm"/g) || []).length,
    1,
  );
  assert.equal(
    h.page.selectedQueueItem("alex").humanConfirmation.recordId,
    "receipt-alex",
  );
  assert.equal(h.calls.length, 0);
});

test("opening an existing recipient outcome leaves the panel and keeps its original form visible without a Send", async (t) => {
  const h = fixture(t, [recipient("alex", "Alex")], true);
  assert.doesNotMatch(h.page.render("send"), /Record outcome/);
  h.page.localAction("compact-panel", "recipients");
  assert.match(h.page.render("send"), /Record outcome/);
  const action = "queue-outcome-open";
  const value = JSON.stringify({
    campaignId: "example-campaign",
    itemId: "alex",
  });
  assert.equal(h.page.localAction(action, value), false);
  await h.page.action(action, value);
  const html = h.page.render("send");
  assert.match(
    html,
    /class="pt-compact-content"><section class="pt-recipient-outcome"/,
  );
  assert.match(html, /data-workspace-form="queue-outcome-save"/);
  assert.doesNotMatch(
    html,
    /role="dialog"|data-workspace-action="queue-confirm"/,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], undefined, "opening the form is a read only");
  await h.page.action("queue-outcome-close");
  assert.match(h.page.render("send"), /aria-label="Send to Alex"/);
  assert.equal(h.calls.length, 1, "closing never sends or reallocates");
});

test("a held earlier row does not hide another verified ready recipient and remains reviewable", (t) => {
  const held = recipient("unknown", "Held recipient", {
    state: "provider_outcome_unknown",
  });
  const h = fixture(t, [held, recipient("alex", "Alex")]);
  assert.match(h.page.render("send"), /Hi Alex/);
  assert.match(h.page.render("send"), /Some recipients need review/);
  assert.doesNotMatch(h.page.render("send"), /Hi Held recipient/);
  assert.equal(h.page.localAction("compact-panel", "recipients"), true);
  const html = h.page.render("send");
  assert.match(html, /Hi Held recipient/);
  assert.match(html, /Do not send again/);
  assert.match(html, /aria-label="Send to Held recipient"[^>]*disabled/);
  assert.equal(held.state, "provider_outcome_unknown");
  assert.equal(h.calls.length, 0);
});

test("an all-held assignment offers review and cannot create an enabled replacement send", (t) => {
  const held = recipient("unknown", "Held recipient", {
    state: "provider_outcome_unknown",
  });
  const h = fixture(t, [held]);
  const before = structuredClone(h.state);
  assert.match(h.page.render("send"), /Review recipient/);
  assert.doesNotMatch(
    h.page.render("send"),
    /data-workspace-action="queue-confirm"/,
  );
  h.page.localAction("compact-details");
  h.page.render("send");
  h.page.localAction("compact-overlay-close");
  assert.deepEqual(h.state, before);
  assert.doesNotMatch(
    h.page.render("send"),
    /data-workspace-action="queue-load"/,
  );
  assert.equal(h.calls.length, 0);
});
