import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { checkedTextingReport, createTextingHistory, renderTextingReport } =
  await import(await moduleUrl("textingReporting"));
const { createConversations } = await import(
  await moduleUrl("textingConversations")
);
const report = () => ({
  version: 1,
  campaignId: "campaign",
  coverage: "partial",
  unreadReplies: 2,
  counts: {
    accepted: 4,
    sent: 1,
    delivered: 2,
    failed: 1,
    pending: 0,
    needsReview: 0,
    inbound: 3,
    outbound: 4,
  },
});

test("reporting rejects unavailable counts and distinguishes acceptance, delivery, unread and partial coverage without money", () => {
  const html = renderTextingReport(checkedTextingReport(report(), "campaign"));
  assert.match(html, /Accepted does not mean delivered/);
  assert.match(html, /Earlier activity may be missing/);
  assert.match(html, /Unread to you/);
  assert.doesNotMatch(html, /budget|balance|charge|\$/i);
  assert.throws(() =>
    checkedTextingReport({ ...report(), counts: {} }, "campaign"),
  );
  assert.throws(() => checkedTextingReport(report(), "another"));
});

test("saved history survives new views, preserves sparse pagination and never dispatches a send", async () => {
  const calls = [],
    item = {
      entryId: "entry",
      campaignId: "campaign",
      displayName: "Example",
      content: "<exact preview>",
      status: "accepted",
      createdAtMs: 1000,
    };
  const make = () => {
    const s = { campaign: { campaignId: "campaign" } };
    const r = {
      can: () => true,
      guard: () => {},
      busy: () => false,
      sendHeld: () => false,
      api: async (route, body) => {
        calls.push({ route, body });
        if (route.endsWith("/reporting")) return { report: report() };
        const query = new URL(`https://example.test${route}`).searchParams;
        return query.get("cursor")
          ? { items: [item], nextCursor: null }
          : { items: [], nextCursor: "next" };
      },
    };
    return createTextingHistory(r, () => s);
  };
  let history = make();
  await history.load();
  assert.match(history.render(), /Load more history/);
  await history.action("report-history-more");
  assert.match(history.render(), /&lt;exact preview&gt;/);
  assert.match(history.render(), /Accepted · delivery pending/);
  history = make();
  await history.load();
  await history.action("report-history-more");
  assert.match(history.render(), /&lt;exact preview&gt;/);
  assert.ok(calls.every((call) => call.body === undefined));
});

test("only a visible rendered conversation acknowledges exact returned pages; preload, dispose and route change do not", async (t) => {
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  let frames = [];
  globalThis.document = {
    hidden: false,
    querySelector: () => ({
      dataset: { conversationId: "conversation" },
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 300,
        left: 0,
        right: 300,
      }),
      querySelectorAll: () => [
        {
          dataset: { textingMessageId: "message-1" },
          getBoundingClientRect: () => ({
            top: 10,
            bottom: 50,
            left: 10,
            right: 290,
          }),
        },
      ],
    }),
  };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const make = () => {
    const view = {},
      calls = [];
    let current = true;
    const page = createConversations({
      view: () => view,
      context: () => ({ resourceId: "conversation" }),
      can: (key) => key === "readReporting",
      busy: () => false,
      sendHeld: () => false,
      billing: () => null,
      workspace: () => ({}),
      changed: () => {},
      guard: () => {
        if (!current) throw Error("changed");
      },
      fail: () => {},
      api: async (route, body) => {
        calls.push({ route, body });
        return body
          ? { unreadReplies: 0 }
          : {
              conversation: {
                conversationId: "conversation",
                campaignId: "campaign",
                canReply: false,
                displayName: "Example",
              },
              messages: [
                {
                  messageId: "message-1",
                  direction: "inbound",
                  content: "A reply",
                },
              ],
              readToken: "opaque-page-token",
            };
      },
    });
    return {
      page,
      calls,
      change: () => {
        current = false;
      },
    };
  };
  const f = make();
  await f.page.load("conversation");
  assert.equal(f.calls.length, 1);
  globalThis.document.hidden = true;
  f.page.render();
  assert.equal(frames.length, 0);
  assert.equal(f.calls.length, 1);
  globalThis.document.hidden = false;
  f.page.render();
  await frames.shift()();
  assert.deepEqual(f.calls[1], {
    route: "/conversations/conversation/read",
    body: { readToken: "opaque-page-token", visibleMessageIds: ["message-1"] },
  });
  f.page.render();
  assert.equal(frames.length, 0);
  f.page.dispose();
  for (const invalidate of [(h) => h.page.dispose(), (h) => h.change()]) {
    const h = make();
    await h.page.load("conversation");
    h.page.render();
    invalidate(h);
    await frames.shift()();
    assert.equal(h.calls.length, 1);
    h.page.dispose();
  }
});

test("Replies history acknowledges visible evidence in its original campaign without a send", async (t) => {
  const previousDocument = globalThis.document,
    previousFrame = globalThis.requestAnimationFrame,
    frames = [],
    calls = [];
  globalThis.document = {
    hidden: false,
    querySelectorAll: () => [
      {
        dataset: { textingHistoryEntry: "old-reply" },
        getBoundingClientRect: () => ({
          top: 10,
          bottom: 40,
          left: 0,
          right: 300,
        }),
      },
    ],
  };
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousFrame;
  });
  const s = {
    campaign: { campaignId: "campaign" },
    history: { direction: "inbound", items: [] },
  };
  const h = createTextingHistory(
    {
      can: () => true,
      guard: () => {},
      busy: () => false,
      changed: () => {},
      api: async (route, body) => {
        calls.push({ route, body });
        if (route.endsWith("/reporting") || body) return { report: report() };
        return {
          items: [
            {
              entryId: "old-reply",
              campaignId: "campaign",
              conversationId: "reused",
              direction: "inbound",
              createdAtMs: 1,
              content: "Reply",
            },
          ],
          readToken: "history-page",
        };
      },
    },
    () => s,
  );
  await h.load();
  assert.ok(calls.every((call) => !call.body));
  h.render();
  await frames.shift()();
  assert.deepEqual(
    calls.filter((call) => call.body),
    [
      {
        route: "/campaigns/campaign/history/read",
        body: { readToken: "history-page", visibleEntryIds: ["old-reply"] },
      },
    ],
  );
});

for (const exact of [false, true])
  test(`expired history proofs renew ${exact ? "exact cached IDs" : "their original page"} without acknowledging offscreen entries`, async (t) => {
    const saved = {
      document: globalThis.document,
      requestAnimationFrame: globalThis.requestAnimationFrame,
    };
    const frames = [],
      calls = [];
    let reads = 0;
    globalThis.document = {
      hidden: false,
      querySelectorAll: () => [
        {
          dataset: { textingHistoryEntry: "visible" },
          getBoundingClientRect: () => ({
            top: 10,
            bottom: 30,
            left: 10,
            right: 200,
          }),
        },
      ],
    };
    globalThis.requestAnimationFrame = (fn) => frames.push(fn);
    const item = (entryId) => ({
      entryId,
      campaignId: "campaign",
      direction: "inbound",
      content: entryId,
    });
    const state = {
      campaign: { campaignId: "campaign" },
      history: { direction: "inbound", items: [] },
    };
    const page = createTextingHistory(
      {
        can: (key) => key !== "campaignReadProof" || exact,
        guard() {},
        busy: () => false,
        changed() {},
        api: async (path, body) => {
          calls.push({ path, body });
          if (path.endsWith("/reporting") || body) return { report: report() };
          reads++;
          if (path.includes("/read-proof?")) {
            assert.ok(path.endsWith("entryIds=visible"));
            return {
              readToken: "renewed",
              readTokenExpiresAtMs: Date.now() + 60000,
              readEntryIds: ["visible"],
            };
          }
          return {
            items: [item("visible"), item("offscreen")],
            readToken: reads === 1 ? "expired" : "renewed",
            readTokenExpiresAtMs: reads === 1 ? 1 : Date.now() + 60000,
          };
        },
      },
      () => state,
    );
    t.after(() => {
      page.dispose();
      Object.assign(globalThis, saved);
    });
    await page.load();
    state.history.items.push(item("retained-older"));
    page.render();
    await frames.shift()();
    assert.equal(reads, 2);
    assert.deepEqual(calls.find((c) => c.body).body, {
      readToken: "renewed",
      visibleEntryIds: ["visible"],
    });
    assert.ok(state.history.items.some((i) => i.entryId === "retained-older"));
    assert.ok(state.history.readTokens.get("expired").has("offscreen"));
  });
