import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);
const { createTextingSessionRequest } = await import(
  await moduleUrl("textingSession")
);
const flush = () => new Promise(setImmediate);

function fixture(
  t,
  { stream = "standard", media = false, section = "send" } = {},
) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    FormData: globalThis.FormData,
  };
  const listeners = new Map(),
    storage = new Map(),
    calls = [];
  globalThis.document = {
    hidden: false,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener() {},
    querySelector: () => null,
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.FormData = class {
    constructor(value) {
      this.value = value;
    }
    get(key) {
      return this.value[key];
    }
  };
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  let auth = { userId: "admin" },
    restoreFails = false,
    transportFails = false,
    recoveryMode = "ready";
  const context = {
    organizationId: "org",
    userId: "admin",
    section,
    resourceId: section === "send" ? "campaign" : "thread",
  };
  const item = (n) => ({
    itemId: `item-${n}`,
    stream,
    state: "awaiting_confirmation",
    expiresAtMs: Date.now() + 3600000,
    blockedReasons: [],
    humanConfirmation: { recordId: `receipt-${n}` },
    preview: {
      contactPhone: "+12025550124",
      contactDisplayName: `Recipient ${n}`,
      message: "Hello neighbor.",
      ...(media
        ? stream === "opt_in"
          ? { mediaId: "image" }
          : { attachmentUrl: "https://example.invalid/image.png" }
        : {}),
    },
  });
  const request = createTextingSessionRequest({
    getSession: () => auth,
    restoreSession: async () => (restoreFails ? null : auth),
    saveSession: (value) => {
      auth = value;
    },
    userId: (value) => value?.userId || "",
    contextKey: () => JSON.stringify(context),
    request: async (url, options = {}) => {
      calls.push({ url, body: options.body, method: options.method || "GET" });
      if (url.endsWith("/workspace"))
        return {
          ok: true,
          workspace: {
            provider: "prompt",
            manualOnly: true,
            status: "configured",
            scopeKey: "coalition:org",
            canSend: true,
            capabilities: {
              manageBilling: true,
              manualQueue: true,
              queueStatus: true,
              queueItemRecovery: true,
            },
          },
        };
      if (url.endsWith("/summary"))
        return {
          ok: true,
          billing: {
            canManageBilling: true,
            rateStatus: "verified",
            availableMicros: 10000000,
            sendingBlocked: false,
            smsUpToTwoSegmentsMicros: 35000,
            smsAdditionalSegmentMicros: 15000,
            mmsMicros: 45000,
            optInRates: {
              rateStatus: "verified",
              mmsMicros: 45000,
              smsSegmentMicros: 15000,
            },
          },
        };
      if (url.endsWith("/queue"))
        return options.body
          ? { ok: true, items: [item(1), item(2)] }
          : {
              ok: true,
              readOnly: true,
              campaignId: "campaign",
              items: [1, 2].map((n) => ({
                itemId: `item-${n}`,
                state: "held",
                resendPermitted: false,
              })),
            };
      if (url.endsWith("/confirm")) {
        if (transportFails) throw new TypeError("Socket closed after dispatch");
        const itemId = url.split("/").at(-2);
        return {
          ok: true,
          result: {
            itemId,
            state:
              itemId === "item-1" ? "provider_outcome_unknown" : "confirmed",
          },
        };
      }
      if (url.endsWith("/content"))
        return {
          ok: true,
          media: { mimeType: "image/png", dataBase64: "aW1hZ2U=" },
        };
      if (url.endsWith("/recover-preview")) {
        if (recoveryMode === "unknown")
          throw Object.assign(Error("Outcome still unknown"), { status: 409 });
        if (recoveryMode === "lost_response") {
          recoveryMode = "ready";
          throw new TypeError("Recovery response lost");
        }
        return {
          ok: true,
          item: {
            ...item(1),
            humanConfirmation: { recordId: "rotated-receipt" },
          },
          recoveryRequestId: options.body.requestId,
          previousReceiptFenced: recoveryMode !== "unverified",
          resendPermitted: false,
        };
      }
      if (url.endsWith("/reply")) {
        if (transportFails) throw new TypeError("Socket closed after dispatch");
        return {
          ok: true,
          result: { state: "accepted", actionId: options.body.actionId },
        };
      }
      if (url.includes("/reply-actions/"))
        return {
          ok: true,
          action: {
            actionId: url.split("/").at(-1),
            conversationId: "thread",
            state: "not_found",
            resendPermitted: false,
          },
        };
      if (url.includes("/conversations/thread"))
        return {
          ok: true,
          conversation: {
            conversationId: "thread",
            campaignId: "campaign",
            canReply: true,
            replyGeneration: 0,
            replyState: "available",
            phone: "+12025550124",
            status: "open",
          },
          messages: [],
          nextCursor: null,
        };
      return {
        ok: true,
        campaign: {
          campaignId: "campaign",
          name: "Example campaign",
          canFetchQueue: true,
        },
      };
    },
  });
  const page = createTextingWorkspacePage({
    context: () => context,
    changed() {},
    navigate() {},
    request,
  });
  const container = {
    dataset: { workspaceKey: `admin:org:${section}:${context.resourceId}` },
    querySelector: () => ({ disabled: true }),
    querySelectorAll: () =>
      [1, 2].map((n) => ({ dataset: { value: `item-${n}` }, disabled: true })),
  };
  const imageTarget = (n) => ({
    dataset: { workspaceQueueImage: `item-${n}` },
    naturalWidth: 100,
    closest: () => container,
  });
  t.after(() => {
    page.reset();
    Object.assign(globalThis, previous);
  });
  return {
    page,
    storage,
    calls,
    setRestoreFails: (value) => {
      restoreFails = value;
    },
    setTransportFails: (value) => {
      transportFails = value;
    },
    setRecoveryMode: (value) => {
      recoveryMode = value;
    },
    image: (n) => listeners.get("load")({ target: imageTarget(n) }),
    imageError: (n) => listeners.get("error")({ target: imageTarget(n) }),
    async click(action, value) {
      const target = {
        disabled: false,
        dataset: { workspaceAction: action, value },
        closest: () => container,
      };
      listeners.get("click")({ target: { closest: () => target } });
      await flush();
      await flush();
    },
    async reply() {
      const form = {
        dataset: { workspaceForm: "reply" },
        reply: "Hello neighbor.",
        matches: () => true,
        closest: () => container,
        reportValidity: () => true,
      };
      listeners.get("submit")({ target: form, preventDefault() {} });
      await flush();
      await flush();
    },
  };
}

for (const stream of ["standard", "opt_in"])
  test(`${stream} MMS continues past an uncertain recipient and ignores stale image events`, async (t) => {
    const f = fixture(t, { media: true, stream });
    await f.page.load();
    await f.click("queue-load");
    f.image(1);
    await f.click("queue-confirm", "item-1");
    assert.match(
      f.page.render(),
      /data-workspace-action="queue-confirm"[^>]*disabled/,
    );
    f.image(2);
    f.image(1);
    f.imageError(1);
    assert.match(
      f.page.render(),
      /data-workspace-action="queue-confirm" data-value="item-2">Send/,
    );
    assert.match(
      f.page.render(),
      /data-workspace-action="queue-confirm" data-value="item-1" disabled/,
    );
    await f.click("queue-confirm", "item-2");
    assert.deepEqual(
      f.calls
        .filter((c) => c.url.endsWith("/confirm"))
        .map((c) => c.url.split("/").at(-2)),
      ["item-1", "item-2"],
    );
    assert.equal(
      f.storage.get("polis.texting.uncertain.admin:org:queue:campaign:item-1"),
      "1",
    );
  });

test("queue authentication failure before dispatch leaves no false hold after reauthentication", async (t) => {
  const f = fixture(t);
  await f.page.load();
  await f.click("queue-load");
  f.setRestoreFails(true);
  await f.click("queue-confirm");
  assert.equal(f.calls.filter((c) => c.url.endsWith("/confirm")).length, 0);
  assert.equal(f.storage.size, 0);
  f.setRestoreFails(false);
  await f.page.load({ force: true });
  await f.click("queue-load");
  await f.click("queue-status");
  assert.doesNotMatch(
    f.page.render(),
    /Delivery needs review|data-workspace-action="queue-confirm"[^>]*disabled/,
  );
});

test("reply authentication failure before dispatch leaves no nonexistent action hold", async (t) => {
  const f = fixture(t, { section: "conversation" });
  await f.page.load();
  f.setRestoreFails(true);
  await f.reply();
  assert.equal(f.calls.filter((c) => c.url.endsWith("/reply")).length, 0);
  assert.equal(f.storage.size, 0);
  f.setRestoreFails(false);
  await f.page.load({ force: true });
  assert.doesNotMatch(f.page.render(), /Reply needs review/);
  assert.match(f.page.render(), /data-workspace-form="reply"/);
});

test("post-dispatch network failures preserve queue holds", async (t) => {
  const f = fixture(t);
  await f.page.load();
  await f.click("queue-load");
  f.setTransportFails(true);
  await f.click("queue-confirm");
  assert.equal(f.calls.filter((c) => c.url.endsWith("/confirm")).length, 1);
  assert.equal(
    f.storage.get("polis.texting.uncertain.admin:org:queue:campaign:item-1"),
    "1",
  );
  await f.click("queue-status");
  assert.match(f.page.render(), /Delivery needs review/);
});

test("legacy queue recovery persists its request across response loss and requires a separate confirmation", async (t) => {
  const f = fixture(t),
    key = "polis.texting.uncertain.admin:org:queue:campaign:item-1";
  f.storage.set(key, "1");
  await f.page.load();
  await f.click("queue-load");
  f.setRecoveryMode("lost_response");
  await f.click("queue-recover-preview");
  const requestId = JSON.parse(f.storage.get(key)).recoveryRequestId;
  assert.ok(requestId);
  await f.page.load({ force: true });
  await f.click("queue-load");
  await f.click("queue-recover-preview");
  assert.deepEqual(
    f.calls
      .filter((c) => c.url.endsWith("/recover-preview"))
      .map((c) => c.body.requestId),
    [requestId, requestId],
  );
  assert.equal(f.storage.has(key), false);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/confirm")).length, 0);
  assert.doesNotMatch(
    f.page.render(),
    /data-workspace-action="queue-confirm"[^>]*disabled/,
  );
  await f.click("queue-confirm");
  assert.equal(f.calls.filter((c) => c.url.endsWith("/confirm")).length, 1);
});

for (const mode of ["unknown", "unverified"])
  test(`legacy queue recovery preserves ${mode} outcomes`, async (t) => {
    const f = fixture(t),
      key = "polis.texting.uncertain.admin:org:queue:campaign:item-1";
    f.storage.set(key, "1");
    await f.page.load();
    await f.click("queue-load");
    f.setRecoveryMode(mode);
    await f.click("queue-recover-preview");
    assert.equal(f.storage.has(key), true);
    assert.match(
      f.page.render(),
      /data-workspace-action="queue-confirm"[^>]*disabled/,
    );
    assert.equal(f.calls.filter((c) => c.url.endsWith("/confirm")).length, 0);
  });

test("post-dispatch reply network failure preserves its exact opaque identity", async (t) => {
  const f = fixture(t, { section: "conversation" });
  await f.page.load();
  f.setTransportFails(true);
  await f.reply();
  const sent = f.calls.find((c) => c.url.endsWith("/reply"));
  assert.ok(sent);
  const saved = JSON.parse(
    f.storage.get("polis.texting.uncertain.admin:org:reply:thread"),
  );
  assert.equal(saved.actionId, sent.body.actionId);
  assert.equal(saved.conversationId, "thread");
  assert.equal(saved.replyGeneration, 0);
  assert.match(f.page.render(), /Reply needs review/);
});
