import assert from "node:assert/strict";
import test from "node:test";
import { moduleUrl } from "./module-fixture.mjs";
const { createConversations } = await import(
  await moduleUrl("textingConversations")
);
const { snapshotConversationScroll, restoreConversationScroll } = await import(
  await moduleUrl("textingConversationHistory")
);
const conversation = {
  conversationId: "thread",
  campaignId: "campaign",
  canReply: true,
  replyState: "available",
  phone: "+12025550124",
  status: "open",
};
const billing = {
  rateStatus: "verified",
  availableMicros: 1000000,
  sendingBlocked: false,
  smsUpToTwoSegmentsMicros: 35000,
  smsAdditionalSegmentMicros: 15000,
  mmsMicros: 45000,
};
const messages = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    messageId: String(from + i),
    content: `Message ${from + i}`,
    direction: "inbound",
    createdAtMs: (from + i) * 1000,
    status: "received",
  }));
const response = (rows = [], nextCursor = null) => ({
  conversation: { ...conversation },
  messages: rows,
  nextCursor,
  messageOrder: "latest",
});
const flush = () => new Promise(setImmediate);
function harness(
  t,
  api,
  {
    resourceId = "thread",
    holds = new Map(),
    maxPollReads = 120,
    capabilities = {},
  } = {},
) {
  const previousDocument = globalThis.document,
    previousFormData = globalThis.FormData,
    previousWindow = globalThis.window;
  const listeners = new Map(),
    timers = new Map(),
    calls = [],
    view = {},
    failures = [];
  let sequence = 0,
    current = true,
    now = 0;
  const document = {
    hidden: false,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  globalThis.document = document;
  globalThis.window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  globalThis.FormData = class {
    constructor(form) {
      this.form = form;
    }
    get(name) {
      return this.form[name];
    }
  };
  const runtime = {
    view: () => view,
    context: () => ({ resourceId, userId: "admin", organizationId: "org" }),
    can: () => false,
    workspace: () => ({ canSend: true, capabilities }),
    billing: () => billing,
    busy: () => false,
    changed() {},
    toast() {},
    clearError() {},
    guard() {
      if (!current) throw Error("Actor or route changed");
    },
    fail: (error) => failures.push(error),
    sendHeld: (key) => holds.has(key),
    sendHold: (key) => holds.get(key),
    holdSend: (key, action) => holds.set(key, action),
    releaseSend: (key) => holds.delete(key),
    refreshSendStatus: async () => {},
    api: async (...args) => {
      calls.push(args);
      return api(...args);
    },
  };
  const page = createConversations(runtime, {
    schedule: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { fn, ms });
      return id;
    },
    cancel: (id) => timers.delete(id),
    now: () => now,
    visible: () => !document.hidden,
    maxPollReads,
  });
  t.after(() => {
    page.dispose();
    globalThis.document = previousDocument;
    globalThis.FormData = previousFormData;
    globalThis.window = previousWindow;
  });
  return {
    page,
    view,
    calls,
    holds,
    failures,
    document,
    timers,
    routeChanged() {
      current = false;
    },
    async tick() {
      const [id, next] = timers.entries().next().value || [];
      if (!next) return;
      timers.delete(id);
      now += next.ms;
      await next.fn();
    },
    async visibility(hidden) {
      document.hidden = hidden;
      listeners.get("visibilitychange")?.();
      await flush();
    },
    async focus() {
      listeners.get("focus")?.();
      await flush();
    },
  };
}

test("latest history entry, older pages and refresh retain complete loaded history and drafts", async (t) => {
  let fresh = false;
  const h = harness(t, async (path) => {
    const query = new URL(`https://example.test${path}`).searchParams;
    assert.equal(query.get("order"), "latest");
    if (query.get("cursor") === "older-50") return response(messages(1, 50));
    return fresh
      ? response(messages(52, 101), "older-51")
      : response(messages(51, 100), "older-50");
  });
  await h.page.load("thread");
  assert.equal(h.view.conversations.messages.at(-1).messageId, "100");
  h.page.change({ name: "reply", value: "My unsent draft" });
  await h.page.action("conversations-more");
  assert.equal(h.view.conversations.messages.length, 100);
  fresh = true;
  await h.page.action("conversations-refresh");
  assert.equal(h.view.conversations.messages.length, 101);
  assert.equal(h.view.conversations.messages[0].messageId, "1");
  assert.equal(h.view.conversations.messages.at(-1).messageId, "101");
  assert.equal(h.view.conversations.cursor, null);
  assert.equal(h.view.conversations.reply, "My unsent draft");
  assert.ok(h.calls.every(([, body]) => body === undefined));
});

test("a large incoming burst fills its gap in bounded pages without dropping earlier history", async (t) => {
  let fresh = false;
  const h = harness(t, async (path) => {
    if (!fresh) return response(messages(1, 5));
    const query = new URL(`https://example.test${path}`).searchParams;
    const upper = Number(query.get("cursor") || 250);
    return response(
      messages(Math.max(1, upper - 49), upper),
      upper > 50 ? String(upper - 50) : null,
    );
  });
  await h.page.load("thread");
  fresh = true;
  await h.page.refresh("thread");
  assert.equal(
    h.calls.length,
    4,
    "one initial read and at most three catch-up pages",
  );
  assert.equal(h.view.conversations.syncCursor, "100");
  assert.match(h.page.render(), /Checking newer messages/);
  await h.tick();
  assert.equal(h.view.conversations.messages.length, 250);
  assert.equal(h.view.conversations.syncCursor, null);
  assert.equal(
    new Set(h.view.conversations.messages.map((row) => row.messageId)).size,
    250,
  );
});

for (const outcome of ["accepted", "rejected_not_attempted"])
  test(`lost reply response resolves only its exact saved ${outcome} action`, async (t) => {
    let pending,
      sent = false;
    const h = harness(t, async (path, body) => {
      if (path.endsWith("/reply")) {
        sent = true;
        pending = body.actionId;
        throw new TypeError("Response lost");
      }
      if (path.includes("/reply-actions/"))
        return {
          action: {
            actionId: pending,
            conversationId: "thread",
            state: outcome,
            resendPermitted: false,
          },
        };
      return response(sent ? messages(1, 2) : messages(1, 1));
    });
    await h.page.load("thread");
    h.page.change({ name: "reply", value: "A reply" });
    await assert.rejects(h.page.submit("reply", { reply: "A reply" }));
    assert.deepEqual(h.holds.get("reply:thread"), {
      actionId: pending,
      conversationId: "thread",
    });
    assert.match(h.page.render(), /Check saved reply/);
    await h.page.action("conversations-refresh");
    assert.equal(h.holds.size, 0);
    assert.equal(
      h.view.conversations.reply,
      outcome === "accepted" ? "" : "A reply",
    );
    assert.match(h.page.render(), /data-workspace-form="reply"/);
    assert.equal(h.calls.filter(([path]) => path.endsWith("/reply")).length, 1);
  });

for (const proof of [
  { state: "not_found" },
  { state: "provider_outcome_unknown" },
  { state: "accepted", actionId: "different" },
  { state: "accepted", conversationId: "another" },
  { state: "accepted", resendPermitted: true },
])
  test(`recovery remains held for ${JSON.stringify(proof)}`, async (t) => {
    const holds = new Map([
      ["reply:thread", { actionId: "saved", conversationId: "thread" }],
    ]);
    const h = harness(
      t,
      async (path) =>
        path.includes("/reply-actions/")
          ? {
              action: {
                actionId: "saved",
                conversationId: "thread",
                resendPermitted: false,
                ...proof,
              },
            }
          : response(messages(1, 1)),
      { holds },
    );
    await h.page.load("thread");
    await h.page.action("conversations-refresh");
    assert.equal(holds.size, 1);
    assert.doesNotMatch(h.page.render(), /data-workspace-form="reply"/);
    assert.ok(h.calls.every(([, body]) => body === undefined));
  });

test("saved exact actions recover on a new controller; legacy boolean holds never unlock", async (t) => {
  for (const action of [
    true,
    { actionId: "saved", conversationId: "thread" },
  ]) {
    const holds = new Map([["reply:thread", action]]);
    const h = harness(
      t,
      async (path) =>
        path.includes("/reply-actions/")
          ? {
              action: {
                actionId: "saved",
                conversationId: "thread",
                state: "accepted",
                resendPermitted: false,
              },
            }
          : response(messages(1, 1)),
      { holds },
    );
    await h.page.load("thread");
    assert.equal(holds.size, action === true ? 1 : 0);
    assert.equal(
      h.calls.some(([path]) => path.includes("/reply-actions/")),
      action !== true,
    );
    h.page.dispose();
  }
});

test("inbox updates automatically, stops while hidden, resumes, and never sends", async (t) => {
  let reads = 0;
  const h = harness(
    t,
    async (path) => {
      assert.match(path, /^\/conversations(?:\?order=provider_id)?$/);
      return {
        items: [
          {
            conversationId: "thread",
            phone: "+12025550124",
            unreadReplies: ++reads,
          },
        ],
        nextCursor: null,
      };
    },
    { resourceId: "", maxPollReads: 2 },
  );
  await h.page.load("");
  await h.tick();
  assert.equal(h.view.conversations.items[0].unreadReplies, 2);
  await h.visibility(true);
  assert.equal(h.timers.size, 0);
  await h.visibility(false);
  assert.equal(reads, 3);
  await h.tick();
  await h.tick();
  assert.equal(h.timers.size, 0);
  assert.match(h.page.render(), /Live updates paused/);
  await h.page.action("conversations-refresh");
  assert.equal(h.timers.size, 1);
  assert.ok(h.calls.every(([, body]) => body === undefined));
});

test("inbox scans later pages, retains loaded rows, and evicts inaccessible rows after a full pass", async (t) => {
  let updated = false,
    revoked = false;
  const rows = Array.from({ length: 100 }, (_, i) => ({
    conversationId: `thread-${i + 1}`,
    phone: "+12025550124",
    lastMessageAtMs: i + 1,
    unreadReplies: 0,
  }));
  const h = harness(
    t,
    async (path) => {
      const later = path.includes("cursor=second");
      return {
        items: rows
          .slice(later ? 50 : 0, later ? 100 : 50)
          .filter((row) => !revoked || row.conversationId !== "thread-80")
          .map((row) =>
            updated && row.conversationId === "thread-90"
              ? { ...row, unreadReplies: 1, lastMessageAtMs: 1000 }
              : row,
          ),
        nextCursor: later ? null : "second",
      };
    },
    { resourceId: "" },
  );
  await h.page.load("");
  assert.equal(h.view.conversations.items.length, 50);
  assert.equal(h.view.conversations.cursor, "second");
  await h.page.action("conversations-more");
  assert.equal(h.view.conversations.items.length, 100);
  updated = true;
  await h.tick();
  assert.equal(h.calls.length, 3, "one page per polling interval");
  assert.equal(h.view.conversations.items.length, 100);
  assert.equal(h.view.conversations.items[0].conversationId, "thread-90");
  assert.equal(h.view.conversations.items[0].unreadReplies, 1);
  revoked = true;
  await h.tick();
  assert.equal(
    h.view.conversations.items.length,
    100,
    "first-page refresh keeps loaded later pages",
  );
  await h.tick();
  assert.equal(h.view.conversations.items.length, 99);
  assert.ok(
    !h.view.conversations.items.some(
      (row) => row.conversationId === "thread-80",
    ),
  );
  assert.equal(h.view.conversations.items[0].unreadReplies, 1);
  assert.equal(h.view.conversations.cursor, null);
  assert.ok(h.calls.every(([, body]) => body === undefined));
});

test("automatic inbox scanning discovers replies on pages the user has not loaded", async (t) => {
  const h = harness(
    t,
    async (path) => ({
      items: [
        {
          conversationId: path.includes("cursor") ? "later" : "first",
          unreadReplies: path.includes("cursor") ? 1 : 0,
        },
      ],
      nextCursor: path.includes("cursor") ? null : "second",
    }),
    { resourceId: "" },
  );
  await h.page.load("");
  await h.tick();
  assert.equal(h.view.conversations.items.length, 2);
  assert.equal(
    h.view.conversations.items.find((row) => row.conversationId === "later")
      .unreadReplies,
    1,
  );
  assert.equal(h.view.conversations.cursor, null);
});

test("regaining window focus promptly refreshes a visible conversation and disposal removes its listener", async (t) => {
  const h = harness(t, async () => response(messages(1, 1)));
  await h.page.load("thread");
  await h.focus();
  assert.equal(h.calls.length, 2);
  h.page.dispose();
  await h.focus();
  assert.equal(h.calls.length, 2);
});

test("hidden, disposed and changed-actor views abort or discard late automatic history", async (t) => {
  for (const stop of ["hidden", "disposed", "actor"]) {
    let resolve,
      reads = 0,
      signal;
    const h = harness(t, async (path, body, method, options) => {
      if (++reads === 1) return response(messages(1, 1));
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    });
    await h.page.load("thread");
    const refresh = h.tick();
    await flush();
    if (stop === "hidden") await h.visibility(true);
    else if (stop === "disposed") h.page.dispose();
    else h.routeChanged();
    if (stop !== "actor") assert.equal(signal.aborted, true);
    resolve(response(messages(1, 2)));
    await refresh;
    assert.equal(h.view.conversations.messages.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("scroll restoration keeps its message anchor for older history and follows the end only when already there", () => {
  const thread = {
    dataset: { conversationId: "thread" },
    scrollTop: 80,
    scrollHeight: 600,
    clientHeight: 200,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => [anchor],
  };
  let offset = 110;
  const anchor = {
    dataset: { textingMessageId: "50" },
    getBoundingClientRect: () => ({ top: offset, bottom: offset + 40 }),
  };
  const root = { querySelector: () => thread };
  const snapshot = snapshotConversationScroll(root);
  offset = 410;
  thread.scrollTop = 0;
  thread.scrollHeight = 900;
  restoreConversationScroll(root, snapshot);
  assert.equal(thread.scrollTop, 300);
  restoreConversationScroll(root, { ...snapshot, atEnd: true });
  assert.equal(thread.scrollTop, 900);
  restoreConversationScroll(root, null);
  assert.equal(thread.scrollTop, 900);
});

test("foreground default polling continues past 120 reads and repeated failures use capped backoff", async (t) => {
  let fail = false;
  const h = harness(
    t,
    async () => {
      if (fail) throw new TypeError("Network unavailable");
      return response(messages(1, 1));
    },
    { maxPollReads: Infinity },
  );
  await h.page.load("thread");
  for (let i = 0; i < 125; i++) await h.tick();
  assert.equal(h.calls.length, 126);
  assert.equal(h.timers.size, 1);
  fail = true;
  for (let i = 0; i < 8; i++) await h.tick();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 120000);
  fail = false;
  await h.tick();
  assert.equal(h.view.conversations.refreshError, false);
  assert.equal([...h.timers.values()][0].ms, 15000);
});

test("provider-ID history rotates across overlapping pages to discover newer replies behind the first page", async (t) => {
  const h = harness(t, async (path) => {
    const cursor = new URL(`https://example.test${path}`).searchParams.get(
      "cursor",
    );
    const rows =
      cursor === "second"
        ? [
            {
              messageId: "uuid-middle",
              content: "Newest reply on a later UUID page",
              createdAtMs: 999999,
              direction: "inbound",
              status: "received",
            },
          ]
        : [
            {
              messageId: "uuid-last",
              content: "Earlier reply on first UUID page",
              createdAtMs: 1000,
              direction: "inbound",
              status: "received",
            },
          ];
    return {
      ...response(rows, cursor ? null : "second"),
      messageOrder: "provider_id",
    };
  });
  await h.page.load("thread");
  assert.match(h.page.render(), /Load more messages/);
  await h.tick();
  assert.equal(h.calls.length, 2, "one page per polling interval");
  assert.equal(h.view.conversations.messages.length, 2);
  assert.equal(h.view.conversations.messages.at(-1).messageId, "uuid-middle");
  await h.tick();
  assert.equal(
    h.view.conversations.providerScanCursor,
    "second",
    "overlap must not stop the UUID scan",
  );
  await h.tick();
  assert.equal(h.view.conversations.messages.length, 2);
  assert.equal(h.view.conversations.providerScanCursor, null);
});

test("a failed saved-action check keeps its hold while incoming history still refreshes", async (t) => {
  const holds = new Map([
    ["reply:thread", { actionId: "saved", conversationId: "thread" }],
  ]);
  let newest = 1;
  const h = harness(
    t,
    async (path) => {
      if (path.includes("/reply-actions/"))
        throw new TypeError("Action check unavailable");
      return response(messages(1, newest));
    },
    { holds },
  );
  await h.page.load("thread");
  newest = 2;
  await h.tick();
  assert.equal(h.view.conversations.messages.length, 2);
  assert.equal(holds.size, 1);
  assert.doesNotMatch(h.page.render(), /data-workspace-form="reply"/);
});

test("accepted recovery clears normalized unchanged drafts but preserves a later draft revision", async (t) => {
  for (const edited of [false, true]) {
    let actionId;
    const h = harness(t, async (path, body) => {
      if (path.endsWith("/reply")) {
        actionId = body.actionId;
        throw new TypeError("Lost response");
      }
      if (path.includes("/reply-actions/"))
        return {
          action: {
            actionId,
            conversationId: "thread",
            state: "accepted",
            resendPermitted: false,
          },
        };
      return response(messages(1, 1));
    });
    await h.page.load("thread");
    h.page.change({ name: "reply", value: "  Hello neighbor.  " });
    await assert.rejects(
      h.page.submit("reply", { reply: "  Hello neighbor.  " }),
    );
    if (edited) h.page.change({ name: "reply", value: "  Hello neighbor.  " });
    await h.page.refresh("thread");
    assert.equal(
      h.view.conversations.reply,
      edited ? "  Hello neighbor.  " : "",
    );
    assert.equal(h.calls.filter(([path]) => path.endsWith("/reply")).length, 1);
    h.page.dispose();
  }
});

test("action-scope 403 preserves independently authorized conversation while current-conversation revocation clears it", async (t) => {
  let revoked = false;
  const holds = new Map([
    ["reply:thread", { actionId: "old", conversationId: "thread" }],
  ]);
  const h = harness(
    t,
    async (path) => {
      if (path.includes("/reply-actions/") || revoked)
        throw Object.assign(new Error("Forbidden"), { status: 403 });
      return response(messages(1, 2));
    },
    { holds },
  );
  await h.page.load("thread");
  assert.equal(h.failures.length, 0);
  assert.equal(h.view.conversations.messages.length, 2);
  assert.equal(holds.size, 1);
  assert.match(h.page.render(), /campaign you can no longer review/);
  revoked = true;
  await h.page.refresh("thread");
  assert.equal(h.failures[0].status, 403);
});

test("queued focus refresh cannot start after visibility changes while awaiting an older read", async (t) => {
  let resolve,
    reads = 0;
  const h = harness(t, async () =>
    ++reads === 1
      ? new Promise((done) => {
          resolve = done;
        })
      : response(messages(1, 2)),
  );
  const initial = h.page.load("thread").catch(() => {});
  await flush();
  await h.focus();
  await h.visibility(true);
  resolve(response(messages(1, 1)));
  await initial.catch(() => {});
  await flush();
  assert.equal(reads, 1);
  assert.equal(h.view.conversations.messages, undefined);
});

test("message change feed updates an older loaded status and retains older history", async (t) => {
  const h = harness(t, async (path) => {
    if (path.includes("/changes?"))
      return {
        ...response([
          { ...messages(1, 1)[0], status: "delivered" },
          ...messages(101, 101),
        ]),
        changeCursor: "change-2",
      };
    if (path.includes("cursor=older")) return response(messages(1, 50));
    return {
      ...response(messages(51, 100), "older"),
      changeCursor: "change-1",
      capabilities: { messageChanges: true },
    };
  });
  await h.page.load("thread");
  await h.page.action("conversations-more");
  await h.tick();
  assert.equal(h.view.conversations.messages.length, 101);
  assert.equal(h.view.conversations.messages[0].status, "delivered");
  assert.equal(h.view.conversations.changeCursor, "change-2");
  assert.ok(
    h.calls.some(([path]) => path.includes("/changes?cursor=change-1")),
  );
});

test("capability fallback refreshes older nonterminal statuses by exact IDs", async (t) => {
  const h = harness(t, async (path) => {
    if (path.includes("/read-proof?"))
      return {
        messages: [
          { ...messages(1, 1)[0], direction: "outbound", status: "delivered" },
        ],
      };
    if (path.includes("cursor=older"))
      return response([
        { ...messages(1, 1)[0], direction: "outbound", status: "sent" },
      ]);
    return response(messages(51, 100), "older");
  });
  await h.page.load("thread");
  await h.page.action("conversations-more");
  await h.tick();
  assert.equal(h.view.conversations.messages[0].status, "delivered");
  assert.ok(
    h.calls.some(([path]) =>
      path.includes("includeMessages=true&messageIds=1"),
    ),
  );
});

test("legacy clearance resumes the same request and requires a verified generation before a new deliberate reply", async (t) => {
  let checks = 0;
  const holds = new Map([["reply:thread", true]]);
  const h = harness(
    t,
    async (path, body) => {
      if (path.endsWith("/reply-clearance"))
        return ++checks === 1
          ? { state: "checking" }
          : { state: "cleared", clearanceId: "clearance", replyGeneration: 3 };
      if (path.endsWith("/reply")) {
        assert.equal(body.replyGeneration, 3);
        return { result: { state: "accepted", actionId: body.actionId } };
      }
      return {
        ...response(),
        conversation: { ...conversation, replyGeneration: 3 },
      };
    },
    { holds },
  );
  await h.page.load("thread");
  await h.page.action("reply-recovery");
  assert.ok(holds.has("reply:thread"));
  await h.page.action("reply-recovery");
  assert.ok(!holds.has("reply:thread"));
  const requests = h.calls.filter(([path]) =>
    path.endsWith("/reply-clearance"),
  );
  assert.equal(requests[0][1].requestId, requests[1][1].requestId);
  assert.equal(h.calls.filter(([path]) => path.endsWith("/reply")).length, 0);
  h.page.change({ name: "reply", value: "New deliberate reply" });
  await h.page.submit("reply", { reply: "New deliberate reply" });
  assert.equal(h.calls.filter(([path]) => path.endsWith("/reply")).length, 1);
});

test("projection health fallback restarts canonical reads without dropping loaded history", async (t) => {
  let ready = true;
  const h = harness(t, async (path) => {
    if (path.includes("/changes?"))
      throw Object.assign(Error("Unavailable index"), {
        status: 409,
        payload: { error: "texting_message_changes_not_ready" },
      });
    if (path.includes("cursor=tm1.older"))
      throw Object.assign(Error("Unavailable index"), {
        status: 409,
        code: "texting_history_index_not_ready",
      });
    if (path.includes("read-proof")) return { messages: [] };
    return {
      ...response(
        ready ? messages(1, 2) : messages(3, 3),
        ready ? "tm1.older" : "canonical-older",
      ),
      changeCursor: ready ? "saved-changes" : null,
      capabilities: { messageChanges: ready },
    };
  });
  await h.page.load("thread");
  ready = false;
  await h.tick();
  assert.equal(h.view.conversations.messages.length, 3);
  assert.equal(h.view.conversations.capabilities.messageChanges, false);
  await h.page.action("conversations-more");
  assert.equal(h.view.conversations.cursor, "canonical-older");
  assert.equal(h.failures.length, 0);
});

test("inbox index fallback preserves loaded rows and restarts the authorized scan", async (t) => {
  let first = true;
  const h = harness(
    t,
    async (path) => {
      if (path.includes("cursor=ti1."))
        throw Object.assign(Error("Unavailable index"), {
          status: 409,
          code: "texting_inbox_index_not_ready",
        });
      const result = {
        items: [
          {
            conversationId: first ? "old" : "new",
            lastMessageAtMs: first ? 1 : 2,
          },
        ],
        nextCursor: first ? "ti1.next" : "canonical-next",
      };
      first = false;
      return result;
    },
    { resourceId: null },
  );
  await h.page.load(null);
  await h.tick();
  assert.deepEqual(
    h.view.conversations.items.map((i) => i.conversationId),
    ["new", "old"],
  );
  assert.equal(h.view.conversations.inboxScanCursor, "canonical-next");
  assert.equal(h.failures.length, 0);
});

test("indexed inbox head refresh uses an independent canonical permission sweep", async (t) => {
  let revoked = false;
  const row = (conversationId, time) => ({
    conversationId,
    lastMessageAtMs: time,
    unreadReplies: 1,
  });
  const h = harness(
    t,
    async (path) => {
      if (path === "/conversations")
        return {
          items: [row("moving", 100)],
          nextCursor: "ti1.moving",
          order: "recent_activity",
        };
      assert.ok(path.includes("order=provider_id"));
      assert.ok(!path.includes("ti1."));
      return path.includes("cursor=canonical")
        ? { items: [row("later", 2)], nextCursor: null, order: "provider_id" }
        : {
            items: revoked ? [] : [row("stable", 1)],
            nextCursor: "canonical",
            order: "provider_id",
          };
    },
    { resourceId: "" },
  );
  await h.page.load("");
  await h.tick();
  await h.tick();
  assert.deepEqual(
    h.view.conversations.items.map((i) => i.conversationId),
    ["moving", "later", "stable"],
  );
  assert.equal(
    h.calls.length,
    5,
    "one indexed head and one stable sweep page per interval",
  );
  revoked = true;
  await h.tick();
  await h.tick();
  assert.deepEqual(
    h.view.conversations.items.map((i) => i.conversationId),
    ["moving", "later"],
  );
});

test("each accepted reply waits for a fresh advanced generation before another deliberate send", async (t) => {
  let generation = 0,
    stale = true;
  const h = harness(
    t,
    async (path, body) => {
      if (path.endsWith("/reply")) {
        assert.equal(body.replyGeneration, generation);
        generation++;
        return { result: { state: "accepted", actionId: body.actionId } };
      }
      return {
        ...response(),
        conversation: {
          ...conversation,
          replyGeneration: stale ? 0 : generation,
        },
      };
    },
    { capabilities: { replyGenerationFencing: true } },
  );
  await h.page.load("thread");
  h.page.change({ name: "reply", value: "First deliberate reply" });
  await h.page.submit("reply", { reply: "First deliberate reply" });
  assert.ok(h.view.conversations.replyEligibilityActionId);
  await assert.rejects(
    h.page.submit("reply", { reply: "Second deliberate reply" }),
    /not eligible/,
  );
  assert.equal(h.calls.filter(([path]) => path.endsWith("/reply")).length, 1);
  stale = false;
  await h.page.refresh("thread");
  assert.equal(h.view.conversations.replyEligibilityActionId, undefined);
  h.page.change({ name: "reply", value: "Second deliberate reply" });
  await h.page.submit("reply", { reply: "Second deliberate reply" });
  assert.equal(generation, 2);
  assert.equal(h.view.conversations.conversation.replyGeneration, 2);
});

test("a persisted not_found action needs explicit clearance and resumes the server-owned request", async (t) => {
  const holds = new Map([
    [
      "reply:thread",
      {
        actionId: "saved-action",
        conversationId: "thread",
        replyGeneration: 0,
      },
    ],
  ]);
  let checking = false,
    cleared = false;
  const h = harness(
    t,
    async (path, body) => {
      if (path.includes("/reply-actions/"))
        return {
          action: {
            actionId: "saved-action",
            conversationId: "thread",
            state: "not_found",
            resendPermitted: false,
          },
        };
      if (path.endsWith("/reply-clearance")) {
        if (checking) {
          assert.equal(body.requestId, "server-clearance");
          cleared = true;
        }
        checking = true;
        return {
          state: cleared ? "cleared" : "checking",
          clearanceId: "server-clearance",
          replyGeneration: 1,
        };
      }
      assert.ok(!path.endsWith("/reply"));
      return {
        ...response(),
        conversation: {
          ...conversation,
          replyGeneration: checking ? 1 : 0,
          replyState:
            checking && !cleared ? "provider_outcome_unknown" : "available",
          ...(checking
            ? {
                replyClearance: {
                  clearanceId: "server-clearance",
                  state: "checking",
                  canResume: !cleared,
                  canTakeOver: false,
                },
              }
            : {}),
        },
      };
    },
    { holds, capabilities: { replyGenerationFencing: true } },
  );
  await h.page.load("thread");
  assert.ok(holds.has("reply:thread"));
  assert.match(h.page.render(), /data-workspace-action="reply-clearance"/);
  assert.equal(
    h.calls.filter(([path]) => path.endsWith("/reply-clearance")).length,
    0,
  );
  await h.page.action("reply-clearance");
  assert.ok(holds.has("reply:thread"));
  delete h.view.conversations.clearanceRequestId; // Simulate lost local continuation state.
  await h.page.action("reply-clearance");
  assert.equal(holds.has("reply:thread"), false);
  assert.equal(h.view.conversations.conversation.replyGeneration, 1);
});

test("reopening an in-progress clearance resumes the advertised identity without a local hold", async (t) => {
  const h = harness(t, async (path, body) => {
    if (path.endsWith("/reply-clearance")) {
      assert.equal(body.requestId, "original-server-request");
      return {
        state: "checking",
        clearanceId: "original-server-request",
        replyGeneration: 4,
      };
    }
    return {
      ...response(),
      conversation: {
        ...conversation,
        replyState: "provider_outcome_unknown",
        replyGeneration: 4,
        replyClearance: {
          clearanceId: "original-server-request",
          state: "checking",
          canResume: true,
          canTakeOver: false,
        },
      },
    };
  });
  await h.page.load("thread");
  await h.page.action("reply-clearance");
  assert.equal(
    h.calls.filter(([path]) => path.endsWith("/reply-clearance")).length,
    1,
  );
  assert.equal(h.calls.filter(([path]) => path.endsWith("/reply")).length, 0);
});

test("manager takeover is deliberate and uses only the advertised recovery authority", async (t) => {
  let allowed = false;
  const h = harness(t, async (path, body) => {
    if (path.endsWith("/reply-clearance")) {
      assert.equal(body.takeover, true);
      assert.ok(body.requestId);
      return {
        state: "checking",
        clearanceId: "existing-clearance",
        replyGeneration: 4,
      };
    }
    return {
      ...response(),
      conversation: {
        ...conversation,
        replyState: "provider_outcome_unknown",
        replyGeneration: 4,
        replyClearance: {
          clearanceId: "existing-clearance",
          state: "checking",
          canResume: false,
          canTakeOver: allowed,
        },
      },
    };
  });
  await h.page.load("thread");
  await assert.rejects(
    h.page.action("reply-clearance-takeover"),
    /cannot be taken over/,
  );
  assert.equal(
    h.calls.filter(([path]) => path.endsWith("/reply-clearance")).length,
    0,
  );
  allowed = true;
  await h.page.refresh("thread");
  assert.match(h.page.render(), /Take over recovery check/);
  await h.page.action("reply-clearance-takeover");
  assert.equal(
    h.calls.filter(([path]) => path.endsWith("/reply-clearance")).length,
    1,
  );
});
