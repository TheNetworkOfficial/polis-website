import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { createConversations } = await import(
  await moduleUrl("textingConversations")
);

const billing = {
  rateStatus: "verified",
  availableMicros: 1_000_000,
  sendingBlocked: false,
  smsUpToTwoSegmentsMicros: 35000,
  mmsMicros: 45000,
};
const item = (n, extra = {}) => ({
  itemId: `recipient-${n}`,
  state: "awaiting_confirmation",
  expiresAtMs: Date.now() + 60000,
  humanConfirmation: { recordId: `proof-${n}` },
  preview: {
    contactPhone: `+1202555012${n}`,
    contactDisplayName: `Person ${n}`,
    message: "Hello neighbor. Reply STOP to opt out.",
  },
  ...extra,
});
function queueHarness(api) {
  const view = {
      campaigns: {
        campaign: { campaignId: "campaign", canFetchQueue: true },
        queue: { items: [item(1), item(2), item(3)] },
      },
    },
    holds = new Set(),
    calls = [];
  const r = {
    view: () => view,
    context: () => ({ resourceId: "campaign" }),
    can: (key) => ["manualQueue", "queueStatus"].includes(key),
    workspace: () => ({ canSend: true, capabilities: { manualQueue: true } }),
    billing: () => billing,
    busy: () => false,
    changed() {},
    toast(message) {
      view.message = message;
    },
    armExpiry() {},
    guard() {},
    refreshSendStatus: async () => {},
    sendHeld: (key) => holds.has(key),
    holdSend: (key) => holds.add(key),
    releaseSend: (key) => holds.delete(key),
    api: async (...args) => {
      calls.push(args);
      return api(...args);
    },
  };
  return { page: createCampaigns(r), view, holds, calls };
}

test("batch exposes every explicit recipient Send and moves pending and unknown rows below ready rows", async () => {
  let resolve;
  const h = queueHarness(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  assert.equal(
    (h.page.render("send").match(/>Send<\/button>/g) || []).length,
    3,
  );
  const pending = h.page.action("queue-confirm", "recipient-1");
  await new Promise(setImmediate);
  const html = h.page.render("send");
  assert.ok(
    html.indexOf('data-texting-recipient="recipient-2"') <
      html.indexOf('data-texting-recipient="recipient-1"'),
  );
  await assert.rejects(h.page.action("queue-confirm", "recipient-2"));
  resolve({
    result: { itemId: "recipient-1", state: "provider_outcome_unknown" },
  });
  await pending;
  assert.ok(h.holds.has("queue:campaign:recipient-1"));
  const next = h.page.action("queue-confirm", "recipient-2");
  await new Promise(setImmediate);
  assert.equal(
    h.calls.at(-1)[0],
    "/campaigns/campaign/queue/recipient-2/confirm",
  );
  assert.deepEqual(h.calls.at(-1)[1], {
    humanConfirmation: { recordId: "proof-2" },
  });
  resolve({ result: { itemId: "recipient-2", state: "confirmed" } });
  await next;
  await assert.rejects(h.page.action("queue-confirm", "recipient-1"));
  assert.match(h.page.render("send"), /recipient-1/);
  assert.doesNotMatch(
    h.page.render("send"),
    /data-texting-recipient="recipient-2"/,
  );
  assert.equal(h.calls.length, 2);
});

test("personalized final text stays visible and each MMS Send needs its displayed image", async () => {
  const h = queueHarness(async () => {
    throw Error("Unexpected send");
  });
  h.view.campaigns.queue.items = [
    item(1),
    item(2, {
      preview: {
        contactPhone: "+12025550122",
        message: "Hello Robin, a different final message.",
        attachmentUrl: "https://example.invalid/attachment.png",
      },
    }),
  ];
  const html = h.page.render("send");
  assert.match(html, /Hello neighbor/);
  assert.match(html, /Hello Robin/);
  assert.match(
    html,
    /data-workspace-action="queue-confirm" data-value="recipient-2" disabled/,
  );
  await assert.rejects(h.page.action("queue-confirm", "recipient-2"));
  h.page.queueImageReady("recipient-1", true);
  await assert.rejects(h.page.action("queue-confirm", "recipient-2"));
  h.page.queueImageReady("recipient-2", true);
  assert.match(
    h.page.render("send"),
    /data-workspace-action="queue-confirm" data-value="recipient-2">Send/,
  );
  assert.equal(h.calls.length, 0);
});

test("loading another batch retains uncertain rows and never repeats their confirmation", async () => {
  const h = queueHarness(async (path) =>
    path.endsWith("/queue")
      ? { items: [item(3)] }
      : { texter: { state: "ready" } },
  );
  h.view.campaigns.queue.items = [
    item(1, { state: "provider_outcome_unknown" }),
  ];
  h.holds.add("queue:campaign:recipient-1");
  await h.page.action("queue-load");
  assert.equal(h.view.campaigns.queue.items.length, 2);
  assert.ok(
    h.page.render("send").indexOf('data-texting-recipient="recipient-3"') <
      h.page.render("send").indexOf('data-texting-recipient="recipient-1"'),
  );
  assert.equal(h.calls.filter(([path]) => path.endsWith("/confirm")).length, 0);
});

for (const folder of ["replies", "opt_outs"])
  test(`${folder} follows empty canonical pages and preserves folder/campaign filters on pagination and polling`, async (t) => {
    const view = {},
      calls = [];
    const resourceId = `folder:${folder}:campaign`,
      timers = new Map();
    let pageNumber = 0;
    const page = createConversations(
      {
        view: () => view,
        context: () => ({ resourceId }),
        can: () => false,
        guard() {},
        busy: () => false,
        changed() {},
        sendHeld: () => false,
        api: async (path) => {
          calls.push(path);
          const query = new URL(path, "https://example.invalid").searchParams;
          assert.equal(query.get("folder"), folder);
          assert.equal(query.get("campaignId"), "campaign");
          pageNumber++;
          return pageNumber <= 4
            ? {
                items: [],
                nextCursor: `page-${pageNumber}`,
                order: "provider_id",
              }
            : {
                items: [
                  {
                    conversationId: "late-match",
                    displayName: "Late Matching Person",
                    phone: "+12025550125",
                    hasReceivedReply: folder === "replies",
                    suppressed: folder === "opt_outs",
                  },
                ],
                nextCursor: null,
                order: "provider_id",
              };
        },
      },
      {
        schedule: (fn) => {
          timers.set(1, fn);
          return 1;
        },
        cancel: () => timers.clear(),
      },
    );
    t.after(() => page.dispose());
    await page.load(resourceId);
    assert.equal(calls.length, 4);
    assert.match(page.render(), /More conversations to check/);
    assert.match(page.render(), /Load more/);
    assert.doesNotMatch(page.render(), /No replies yet|No opt outs yet/);
    await page.action("conversations-more");
    assert.match(page.render(), /Late Matching Person/);
    assert.equal(
      new URL(calls.at(-1), "https://example.invalid").searchParams.get(
        "cursor",
      ),
      "page-4",
    );
    await page.refresh(resourceId);
    assert.match(page.render(), /Late Matching Person/);
  });
