import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scripts = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/src/pages/shared-feed/scripts",
);
const urls = new Map();
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let source = await readFile(path.join(scripts, `${name}.js`), "utf8");
  source = source.replace(/^import\s+"[^"\n]+\.css";\r?\n/gm, "");
  for (const match of [...source.matchAll(/from "\.\/(texting\w+)"/g)])
    source = source.replaceAll(match[0], `from "${await moduleUrl(match[1])}"`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  urls.set(name, url);
  return url;
}
const { createConversations } = await import(
  await moduleUrl("textingConversations")
);
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);

const billing = {
  organizationName: "Example Civic Team",
  rateStatus: "verified",
  availableMicros: 1000000,
  reservedMicros: 0,
  settledMicros: 0,
  sendingBlocked: false,
  canManageBilling: true,
  smsUpToTwoSegmentsMicros: 35000,
  smsAdditionalSegmentMicros: 15000,
  mmsMicros: 45000,
};
const workspace = {
  provider: "prompt",
  manualOnly: true,
  status: "configured",
  scopeKey: "coalition:org-one",
  canSend: true,
  capabilities: { manageBilling: true },
};
const conversation = {
  conversationId: "conversation-one",
  campaignId: "campaign-one",
  displayName: "Example Recipient",
  phone: "+12025550124",
  status: "active",
  canReply: true,
  suppressed: false,
};
const originalMessage = {
  messageId: "message-one",
  direction: "inbound",
  content: "Please tell me more.",
  status: "received",
};
const deliveredMessage = {
  messageId: "message-two",
  direction: "outbound",
  content: "Here is the requested information.",
  status: "delivered",
};
const response = (messages = [originalMessage]) => ({
  conversation: { ...conversation },
  messages,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
const accepted = (body) => ({
  result: { actionId: body.actionId, state: "accepted" },
});

async function acceptReply(h) {
  h.page.change({ name: "reply", value: deliveredMessage.content });
  await h.page.submit("reply", {
    values: { reply: deliveredMessage.content },
  });
}

function browserStub(t) {
  const previousDocument = globalThis.document,
    previousFormData = globalThis.FormData,
    listeners = new Map();
  globalThis.document = {
    hidden: false,
    visibilityState: "visible",
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  globalThis.FormData = class {
    constructor(form) {
      this.values = form.values;
    }
    get(name) {
      return this.values[name];
    }
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    globalThis.FormData = previousFormData;
  });
  return listeners;
}

function conversationHarness(api) {
  const view = { conversations: {} },
    calls = [],
    holds = new Set(),
    failures = [];
  let current = true;
  const page = createConversations({
    view: () => view,
    context: () => ({ resourceId: conversation.conversationId }),
    workspace: () => workspace,
    billing: () => billing,
    can: (name) => workspace.capabilities[name] === true,
    busy: () => false,
    changed: () => {},
    toast: () => {},
    guard: () => {
      if (!current) throw new Error("Workspace changed");
    },
    fail: (error) => failures.push(error),
    sendHeld: (key) => holds.has(key),
    holdSend: (key) => holds.add(key),
    releaseSend: (key) => holds.delete(key),
    refreshSendStatus: async () => {},
    refreshBilling: async () => {},
    api: async (route, body) => {
      if (route === "/texter/ensure") return { texter: { state: "ready" } };
      calls.push({ route, body });
      return api(route, body);
    },
  });
  return {
    page,
    view,
    calls,
    holds,
    failures,
    changeRoute: () => {
      current = false;
    },
  };
}

test("accepted replies refresh spending counters and recover delayed delivery without resending or clearing a later draft", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = browserStub(t),
    calls = [],
    key = "admin:org-one:conversation:conversation-one";
  let sent = false,
    conversationReads = 0;
  const page = createTextingWorkspacePage({
    context: () => ({
      organizationId: "org-one",
      userId: "admin",
      section: "conversation",
      resourceId: conversation.conversationId,
    }),
    changed: () => {},
    navigate: () => {},
    request: async (url, options) => {
      if (url.endsWith("/texter/ensure"))
        return { ok: true, texter: { state: "ready" } };
      calls.push({ url, options });
      if (url.endsWith("/workspace"))
        return {
          ok: true,
          workspace: {
            ...workspace,
            sendingMode: "pilot",
            pilot: {
              remainingMessages: sent ? 5 : 6,
              remainingSpendMicros: sent ? 465000 : 500000,
            },
          },
        };
      if (url.endsWith("/summary"))
        return {
          ok: true,
          billing: { ...billing, availableMicros: sent ? 965000 : 1000000 },
        };
      if (url.endsWith("/reply")) {
        assert.equal(options.method, "POST");
        assert.equal(options.body.content, deliveredMessage.content);
        sent = true;
        return {
          ok: true,
          result: { actionId: options.body.actionId, state: "accepted" },
        };
      }
      assert.match(url, /\/conversations\/conversation-one$/);
      conversationReads++;
      if (conversationReads === 2) throw new TypeError("Failed to fetch");
      return {
        ok: true,
        ...response(
          conversationReads > 2
            ? [originalMessage, deliveredMessage]
            : [originalMessage],
        ),
      };
    },
  });
  t.after(() => page.reset());
  const owner = (selector) =>
      selector === "[data-workspace-key]"
        ? { dataset: { workspaceKey: key } }
        : null,
    input = (value) =>
      listeners.get("input")({
        target: {
          name: "reply",
          value,
          dataset: {},
          closest: owner,
        },
      });
  await page.load();
  input(deliveredMessage.content);
  listeners.get("submit")({
    preventDefault: () => {},
    target: {
      dataset: { workspaceForm: "reply" },
      values: { reply: deliveredMessage.content },
      matches: () => true,
      reportValidity: () => true,
      closest: owner,
    },
  });
  await flush();
  assert.match(page.render(), /Reply accepted/);
  assert.match(page.render(), /5 messages and \$0.465 remain/);
  assert.doesNotMatch(
    page.render(),
    /role="alert"|Failed to fetch|Reply needs review/,
  );
  assert.doesNotMatch(page.render(), /Here is the requested information\./);
  assert.equal(conversationReads, 2);
  for (const suffix of ["/workspace", "/summary"])
    assert.equal(calls.filter((call) => call.url.endsWith(suffix)).length, 2);

  input("A later draft should stay here.");
  t.mock.timers.tick(10000);
  await flush();
  assert.match(page.render(), /Here is the requested information\./);
  assert.match(page.render(), /delivered/i);
  assert.match(page.render(), /A later draft should stay here\./);
  assert.equal(conversationReads, 3);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(conversationReads, 3);

  await page.refresh();
  assert.equal(conversationReads, 4);
  assert.match(page.render(), /A later draft should stay here\./);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(conversationReads, 4);
  assert.equal(
    calls.filter((call) => call.options.method === "POST").length,
    1,
  );
  assert.equal(calls.filter((call) => call.url.endsWith("/reply")).length, 1);
});

test("accepted-reply polling is bounded and stops after disposal, route changes, or revoked access", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  browserStub(t);
  const bounded = conversationHarness(async (route, body) =>
    body ? accepted(body) : response(),
  );
  t.after(() => bounded.page.dispose());
  await bounded.page.load(conversation.conversationId);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(bounded.calls.length, 1); // Opening a conversation does not poll.
  await acceptReply(bounded);
  for (let i = 0; i < 7; i++) {
    t.mock.timers.tick(10000);
    await flush();
  }
  assert.equal(bounded.calls.length, 9); // Initial GET, POST, immediate GET, six polls.
  await bounded.page.action("conversations-refresh");
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(bounded.calls.length, 10); // Manual refresh performs one read.
  assert.equal(
    bounded.calls.filter((call) => call.body !== undefined).length,
    1,
  );
  bounded.page.dispose();

  for (const stop of ["dispose", "route"]) {
    let resolveRead,
      reads = 0;
    const h = conversationHarness(async (route, body) => {
      if (body) return accepted(body);
      if (++reads <= 2) return response();
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    });
    t.after(() => h.page.dispose());
    await h.page.load(conversation.conversationId);
    await acceptReply(h);
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(typeof resolveRead, "function");
    if (stop === "dispose") h.page.dispose();
    else h.changeRoute();
    resolveRead(response([originalMessage, deliveredMessage]));
    await flush();
    assert.deepEqual(h.view.conversations.messages, [originalMessage], stop);
    t.mock.timers.tick(30000);
    await flush();
    assert.equal(h.calls.length, 4, stop);
  }

  for (const status of [401, 403]) {
    let reads = 0;
    const h = conversationHarness(async (route, body) => {
      if (body) return accepted(body);
      if (++reads > 2)
        throw Object.assign(new Error("Access denied"), { status });
      return response();
    });
    t.after(() => h.page.dispose());
    await h.page.load(conversation.conversationId);
    await acceptReply(h);
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(h.failures[0]?.status, status);
    t.mock.timers.tick(30000);
    await flush();
    assert.equal(h.calls.length, 4);
  }
});

test("unknown, missing, and lost reply responses retain the send hold and polling never retries the POST", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  browserStub(t);
  for (const outcome of ["unknown", "missing", "lost"]) {
    const h = conversationHarness(async (route, body) => {
      if (!body) return response();
      assert.match(route, /\/reply$/);
      if (outcome === "lost") throw new TypeError("Failed to fetch");
      if (outcome === "missing") return {};
      return {
        result: { actionId: body.actionId, state: "provider_outcome_unknown" },
      };
    });
    t.after(() => h.page.dispose());
    await h.page.load(conversation.conversationId);
    h.page.change({ name: "reply", value: deliveredMessage.content });
    const form = { values: { reply: deliveredMessage.content } };
    // The public handler may surface the uncertainty; its durable hold must survive.
    await h.page.submit("reply", form).catch(() => {});
    assert.equal(h.holds.has(`reply:${conversation.conversationId}`), true);
    assert.match(h.page.render(), /Reply needs review/);
    assert.doesNotMatch(h.page.render(), /data-workspace-form="reply"/);
    await assert.rejects(h.page.submit("reply", form), /not eligible/);
    await h.page.action("conversations-refresh");
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(10000);
      await flush();
    }
    assert.equal(h.calls.filter((call) => call.body !== undefined).length, 1);
    assert.equal(h.holds.has(`reply:${conversation.conversationId}`), true);
    assert.equal(h.view.conversations.reply, deliveredMessage.content);
    h.page.dispose();
  }
});
