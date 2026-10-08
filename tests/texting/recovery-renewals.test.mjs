import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createTextingRecovery } = await import(
  await moduleUrl("textingRecovery")
);
const { renderTextingRenewals, renderTextingSetup } = await import(
  await moduleUrl("textingRenewals")
);
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);
const { textingNotificationRoute } = await import(
  await moduleUrl("textingNotifications")
);

test("inbound texting notifications open the scoped texting conversation and reject malformed targets", () => {
  const item = {
    kind: "texting",
    target: {
      surfaceType: "text_banking_workspace",
      scopeKey: "coalition:org",
      conversationId: "thread",
    },
  };
  assert.equal(
    textingNotificationRoute(item),
    "/organizations/org/texting/conversation/thread",
  );
  assert.equal(
    textingNotificationRoute({
      ...item,
      target: { ...item.target, conversationId: "../messages" },
    }),
    "",
  );
  assert.equal(
    textingNotificationRoute({
      ...item,
      target: { ...item.target, scopeKey: "candidate:org" },
    }),
    "",
  );
});

test("renewal warnings name the owner and next step for admins only", () => {
  const deadlines = [
    {
      kind: "rates",
      label: "Texting rates",
      status: "due_soon",
      expiresAtMs: 1900000000000,
      owner: "Polis support",
      nextStep: "Ask support to renew the review.",
    },
  ];
  assert.equal(renderTextingRenewals(deadlines, false), "");
  assert.match(renderTextingRenewals(deadlines, true), /Polis support/);
  assert.match(renderTextingRenewals(deadlines, true), /Ask support to renew/);
  assert.equal(
    renderTextingRenewals([{ ...deadlines[0], status: "current" }], true),
    "",
  );
  assert.match(
    renderTextingSetup({
      manualReviewRequired: true,
      state: "provision_required",
      nextStep: "Contact Polis support.",
    }),
    /Manual setup review required/,
  );
});

test("recovery pages paginate and explicit checks never send or accept claims as proof", async () => {
  const view = {},
    calls = [];
  const page = createTextingRecovery({
    view: () => view,
    can: () => true,
    guard() {},
    busy: () => false,
    api: async (path, body) => {
      calls.push({ path, body });
      return {
        items: [
          {
            caseId: path.includes("cursor") ? "case-2" : "case-1",
            actorDisplayName: "Lee Example",
            canReconcile: true,
            canSubmitEvidence: true,
            nextStep: "Check saved outcome",
            state: "needs_review",
          },
        ],
        nextCursor: path.includes("cursor") ? null : "later",
      };
    },
  });
  await page.load();
  await page.action("recovery-more");
  assert.equal(view.recovery.items.length, 2);
  assert.ok(calls.every((call) => call.body === undefined));
  assert.match(page.render(), /Lee Example/);
  assert.match(page.render(), /does not release held messages/);
  await page.action("recovery-check", "case-1");
  assert.equal(calls.filter((call) => call.body).length, 1);
  assert.match(
    calls.find((call) => call.body).path,
    /\/recovery\/case-1\/reconcile$/,
  );
});

test("an exact resolved hold does not reappear when storage deletion fails", async (t) => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const stored = new Map([
    [
      "polis.texting.uncertain.admin:org:reply:thread",
      JSON.stringify({
        version: 1,
        actionId: "saved",
        conversationId: "thread",
      }),
    ],
  ]);
  globalThis.sessionStorage = {
    getItem: (key) => stored.get(key),
    setItem: (key, value) => stored.set(key, value),
    removeItem() {
      throw new Error("Storage unavailable");
    },
  };
  const page = createTextingWorkspacePage({
    context: () => ({
      userId: "admin",
      organizationId: "org",
      section: "conversation",
      resourceId: "thread",
    }),
    changed() {},
    navigate() {},
    request: async (path) => {
      if (path.endsWith("/workspace"))
        return {
          ok: true,
          workspace: {
            provider: "prompt",
            scopeKey: "coalition:org",
            manualOnly: true,
            status: "configured",
            canSend: true,
            capabilities: {},
          },
        };
      if (path.endsWith("/billing/summary"))
        return { ok: true, billing: { sendingBlocked: false } };
      if (path.includes("/reply-actions/"))
        return {
          ok: true,
          action: {
            actionId: "saved",
            conversationId: "thread",
            state: "accepted",
            resendPermitted: false,
          },
        };
      return {
        ok: true,
        conversation: {
          conversationId: "thread",
          campaignId: "campaign",
          canReply: true,
        },
        messages: [],
      };
    },
  });
  t.after(() => {
    page.reset();
    Object.assign(globalThis, previous);
  });
  await page.load();
  await page.refresh();
  assert.match(page.render(), /data-workspace-form="reply"/);
  assert.doesNotMatch(page.render(), /Reply needs review/);
});
