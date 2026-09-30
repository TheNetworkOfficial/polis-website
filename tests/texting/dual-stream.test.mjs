import assert from "node:assert/strict";
import test from "node:test";
import { moduleUrl } from "./module-fixture.mjs";

const ui = await import(await moduleUrl("textingWorkspaceUi"));
const { validateOptInStep, createTextingOptIn } = await import(
  await moduleUrl("textingOptIn")
);
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);
const billing = {
  rateStatus: "verified",
  smsUpToTwoSegmentsMicros: 35000,
  smsAdditionalSegmentMicros: 15000,
  mmsMicros: 45000,
  optInRates: {
    rateStatus: "verified",
    smsSegmentMicros: 17500,
    mmsMicros: 35000,
  },
};

test("stream prices preserve SMS segmentation, MMS rates and four decimal precision", () => {
  assert.equal(ui.money(17500), "$0.0175");
  for (const [length, optIn, standard] of [
    [160, 17500, 35000],
    [306, 35000, 35000],
    [307, 52500, 50000],
  ]) {
    assert.equal(
      ui.messagePrice(billing, "x".repeat(length), false, "opt_in"),
      optIn,
    );
    assert.equal(
      ui.messagePrice(billing, "x".repeat(length), false, "standard"),
      standard,
    );
  }
  assert.equal(ui.messagePrice(billing, "caption", true, "opt_in"), 35000);
  assert.equal(ui.messagePrice(billing, "caption", true, "standard"), 45000);
  assert.equal(
    ui.messagePrice({ ...billing, optInRates: null }, "text", false, "opt_in"),
    null,
  );
  assert.equal(
    ui.messagePrice(billing, "😀".repeat(36), false, "opt_in"),
    35000,
  );
});

test("registration validates durable application details and never accepts malformed dates", () => {
  assert.match(validateOptInStep({}, 0), /legal organization/);
  assert.match(
    validateOptInStep({ authorityConfirmed: true }, 2, {
      token: "test",
      expiresOn: "2099-02-30",
    }),
    /expiration/,
  );
  assert.equal(
    validateOptInStep({ authorityConfirmed: true }, 2, { hasToken: true }),
    "",
  );
  assert.match(validateOptInStep({}, 2, { hasToken: true }), /authority/);
});

function harness(request) {
  const listeners = new Map();
  globalThis.document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  let context = { userId: "admin", organizationId: "org", section: "settings" };
  const module = createTextingOptIn({
    request,
    context: () => context,
    changed() {},
  });
  return {
    module,
    context: (value) => {
      context = value;
    },
    async click(name, attemptId) {
      const target = {
        dataset: { optInAction: name, attemptId },
        closest: (selector) =>
          selector === "[data-opt-in-key]"
            ? { dataset: { optInKey: "admin:org" } }
            : selector === "form"
              ? null
              : target,
      };
      listeners.get("click")({ target });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
const registration = {
  revision: 1,
  status: "approved",
  application: {},
  ready: true,
};
const response = {
  ok: true,
  registration,
  capabilities: { canSave: false, canQuote: false, canSubmit: false },
};

test("feature-disabled setup stays unavailable and rendering removes vendor names from server decisions", async () => {
  const calls = [];
  const h = harness(async (path, options) => {
    calls.push({ path, options });
    return path.endsWith("/settings")
      ? { ok: true, settings: { revision: 0, routingMode: "single" } }
      : {
          ...response,
          registration: {
            ...registration,
            reviewMessage: "Telnyx and Prompt.io require review.",
          },
        };
  });
  await h.module.load({ enabled: false, canManage: true });
  assert.doesNotMatch(
    h.module.render(),
    /Enable dual|Add opt-in texting|Telnyx|Prompt/,
  );
  assert.match(h.module.render(), /not available yet/);
  assert.ok(calls.every((call) => call.options.method === undefined));
});

test("single stream switch uses revision and uncertain writes are never retried automatically", async () => {
  const writes = [];
  const h = harness(async (path, options) => {
    if (options.method) {
      writes.push(options);
      throw new Error("Telnyx status unavailable");
    }
    return path.endsWith("/settings")
      ? { ok: true, settings: { revision: 8, routingMode: "dual" } }
      : response;
  });
  await h.module.load({ enabled: true, canManage: true });
  assert.match(h.module.render(), /Return to single stream texting/);
  await h.click("single");
  assert.deepEqual(writes[0].body, {
    expectedRevision: 8,
    routingMode: "single",
  });
  await h.click("single");
  assert.equal(writes.length, 1);
  assert.doesNotMatch(h.module.render(), /Telnyx|Prompt/);
  assert.match(h.module.render(), /saved outcome needs/);
});

test("late settings cannot populate another organization", async () => {
  let finish;
  const h = harness((path) =>
    path.endsWith("/settings")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(response),
  );
  const loading = h.module.load({ enabled: true, canManage: true });
  h.context({ userId: "admin", organizationId: "other", section: "settings" });
  finish({ ok: true, settings: { revision: 1, routingMode: "dual" } });
  await loading;
  assert.equal(h.module.render(), "");
});

test("workspace negotiates neutral endpoints while legacy workspaces remain unchanged", async () => {
  globalThis.document = { addEventListener() {} };
  for (const enabled of [true, false]) {
    const calls = [];
    const controller = createTextingWorkspacePage({
      context: () => ({
        organizationId: "org",
        userId: "admin",
        section: "home",
      }),
      changed() {},
      navigate() {},
      request: async (path) => {
        calls.push(path);
        if (path.endsWith("/workspace"))
          return {
            ok: true,
            workspace: {
              provider: "prompt",
              manualOnly: true,
              scopeKey: "coalition:org",
              status: "configured",
              capabilities: { neutralWorkspaceApi: enabled },
            },
          };
        if (path.endsWith("/summary")) return { ok: true, billing: {} };
        return { ok: true, items: [] };
      },
    });
    await controller.load();
    assert.match(calls[0], /\/prompt\/scopes\//);
    assert.match(calls[1], enabled ? /\/workspaces\// : /\/prompt\/scopes\//);
    controller.reset();
  }
});

test("admin delivery review checks evidence without supplying a result or resending", async () => {
  const writes = [];
  const h = harness(async (path, options) => {
    if (options.method) {
      writes.push({ path, ...options });
      return { ok: true };
    }
    if (path.endsWith("/settings"))
      return { ok: true, settings: { revision: 1, routingMode: "dual" } };
    if (path.endsWith("/review"))
      return {
        ok: true,
        items: [
          {
            attemptId: "attempt/1",
            status: "outcome_unknown",
            canReconcile: true,
          },
        ],
      };
    return response;
  });
  await h.module.load({ enabled: true, canManage: true });
  assert.match(h.module.render(), /Messages needing review/);
  await h.click("review", "attempt/1");
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /review\/attempt%2F1\/reconcile$/);
  assert.deepEqual(writes[0].body, {});
  assert.match(h.module.render(), /remain on hold/);
});

test("protected MMS requires decoded media before confirmation and never trusts a remote attachment URL", async () => {
  const { createConversations } = await import(
    await moduleUrl("textingConversations")
  );
  const view = {},
    calls = [];
  const media = { mimeType: "image/png", dataBase64: "aGVsbG8=" };
  const conversation = {
    conversationId: "oi_conversation",
    campaignId: "campaign",
    stream: "opt_in",
    phone: "+12025550101",
    canReply: false,
  };
  const controller = createConversations({
    view: () => view,
    context: () => ({ resourceId: conversation.conversationId }),
    workspace: () => ({}),
    billing: () => billing,
    can: () => false,
    busy: () => false,
    guard() {},
    sendHeld: () => false,
    api: async (path) => {
      calls.push(path);
      return path.endsWith("/attachments/0")
        ? { media }
        : {
            conversation,
            messages: [
              {
                messageId: "inbound-message",
                direction: "inbound",
                content: "A picture",
                attachments: [
                  {
                    attachmentId: "0",
                    url: "https://untrusted.example.test/image.png",
                  },
                ],
              },
            ],
          };
    },
  });
  await controller.load(conversation.conversationId);
  assert.match(controller.render(), /View attachment/);
  assert.doesNotMatch(controller.render(), /untrusted\.example/);
  await controller.action(
    "conversation-attachment",
    JSON.stringify(["inbound-message", "0"]),
  );
  assert.equal(
    calls[1],
    "/conversations/oi_conversation/messages/inbound-message/attachments/0",
  );
  assert.match(controller.render(), /data:image\/png;base64,aGVsbG8=/);
  await assert.rejects(
    controller.action(
      "conversation-attachment",
      JSON.stringify(["unrelated", "0"]),
    ),
  );
  assert.equal(calls.length, 2);
  assert.equal(
    ui.protectedMediaData({
      mimeType: "image/svg+xml",
      dataBase64: "aGVsbG8=",
    }),
    "",
  );
  assert.equal(
    ui.protectedMediaData({
      mimeType: "image/png",
      dataBase64: '" onerror=alert(1)',
    }),
    "",
  );
  const item = {
    state: "awaiting_confirmation",
    stream: "opt_in",
    expiresAtMs: Date.now() + 60000,
    humanConfirmation: {},
    preview: {
      contactPhone: "+12025550101",
      message: "Picture",
      attachmentUrl: "/api/protected",
      mediaId: "media-one",
    },
  };
  const workspace = {
      canSend: true,
      capabilities: { manualQueue: true, manageBilling: true },
    },
    funds = { ...billing, sendingBlocked: false, availableMicros: 35000 };
  assert.equal(ui.queueCanConfirm(item, workspace, funds, false), false);
  assert.equal(ui.queueCanConfirm(item, workspace, funds, true), true);
  controller.dispose();
});
