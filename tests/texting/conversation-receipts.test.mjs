import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createConversationReads } = await import(
  await moduleUrl("textingConversationReads")
);
const { textingReadRequest } = await import(
  await moduleUrl("textingReadRequest")
);

function harness(t) {
  const old = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  const frames = [],
    calls = [],
    proofCalls = [],
    positions = new Map([
      ["old", 20],
      ["new", 1000],
    ]);
  const view = {
    conversations: { conversation: { conversationId: "thread" } },
  };
  let current = true,
    time = 100,
    proofResolve;
  globalThis.document = {
    hidden: false,
    querySelector: () => ({
      dataset: { conversationId: "thread" },
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 300,
        left: 0,
        right: 400,
      }),
      querySelectorAll: () =>
        [...positions].map(([key, top]) => ({
          dataset: { textingMessageId: key },
          getBoundingClientRect: () => ({
            top,
            bottom: top + 50,
            left: 10,
            right: 390,
          }),
        })),
    }),
  };
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  const receipts = createConversationReads(
    {
      view: () => view,
      changed() {},
      fail(error) {
        throw error;
      },
      api: async (path, body) => {
        calls.push({ path, body });
        return { unreadReplies: 1 };
      },
    },
    {
      active: () => current,
      resource: () => "thread",
      now: () => time,
      read: async (path) => {
        proofCalls.push(path);
        return proofResolve
          ? await new Promise((done) => proofResolve(done))
          : { readToken: "refreshed", readTokenExpiresAtMs: 99999 };
      },
    },
  );
  t.after(() => {
    receipts.dispose();
    Object.assign(globalThis, old);
  });
  return {
    receipts,
    calls,
    proofCalls,
    positions,
    view,
    setTime(value) {
      time = value;
    },
    hide() {
      document.hidden = true;
    },
    invalidate() {
      current = false;
    },
    deferProof(callback) {
      proofResolve = callback;
    },
    async paint() {
      receipts.schedule();
      await frames.shift()?.();
    },
  };
}
test("only intersecting inbound IDs are acknowledged; offscreen and hidden replies remain unread", async (t) => {
  const h = harness(t);
  h.receipts.remember({
    readToken: "page",
    messages: [
      { messageId: "old", direction: "inbound" },
      { messageId: "new", direction: "inbound" },
    ],
  });
  await h.paint();
  assert.deepEqual(h.calls[0].body, {
    readToken: "page",
    visibleMessageIds: ["old"],
  });
  h.positions.set("new", 30);
  h.hide();
  await h.paint();
  assert.equal(h.calls.length, 1);
  document.hidden = false;
  await h.paint();
  assert.deepEqual(h.calls[1].body.visibleMessageIds, ["new"]);
  await h.paint();
  assert.equal(h.calls.length, 2);
});
test("old visible proofs refresh by exact IDs, then recheck visibility before acknowledgement", async (t) => {
  const h = harness(t);
  h.receipts.remember({
    readToken: "expired",
    readTokenExpiresAtMs: 1,
    messages: [{ messageId: "old", direction: "inbound" }],
  });
  await h.paint();
  assert.match(h.proofCalls[0], /read-proof\?messageIds=old$/);
  assert.equal(h.calls[0].body.readToken, "refreshed");
});
test("a late refreshed proof after route change cannot acknowledge", async (t) => {
  const h = harness(t);
  let resolve;
  h.deferProof((done) => {
    resolve = done;
  });
  h.receipts.remember({
    readToken: "expired",
    readTokenExpiresAtMs: 1,
    messages: [{ messageId: "old", direction: "inbound" }],
  });
  const pending = h.paint();
  await new Promise(setImmediate);
  h.invalidate();
  resolve({ readToken: "refreshed", readTokenExpiresAtMs: 99999 });
  await pending;
  assert.equal(h.calls.length, 0);
});
test("read deadlines abort and settle even when transport ignores cancellation", async () => {
  let signal, resolve;
  const pending = textingReadRequest(
    (value) => {
      signal = value;
      return new Promise((done) => {
        resolve = done;
      });
    },
    { timeoutMs: 5 },
  );
  const check = assert.rejects(pending, { name: "TimeoutError" });
  await new Promise((done) => setTimeout(done, 15));
  await check;
  assert.equal(signal.aborted, true);
  resolve({ late: true });
});
