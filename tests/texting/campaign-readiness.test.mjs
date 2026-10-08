import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ funded = false, uncertain = false } = {}) {
  const listeners = new Map(),
    calls = [];
  globalThis.document = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener() {},
  };
  const recipient = {
    itemId: "held-recipient",
    state: "awaiting_confirmation",
    expiresAtMs: Date.now() + 60000,
    humanConfirmation: { recordId: "same-held-receipt" },
    blockedReasons: [],
    preview: {
      contactPhone: "+12025550124",
      contactDisplayName: "Example Recipient",
      message: "Example organization says hello. Reply STOP to opt out.",
    },
  };
  const page = createTextingWorkspacePage({
    context: () => ({
      organizationId: "example-org",
      userId: "volunteer",
      section: "send",
      resourceId: "campaign-one",
    }),
    changed() {},
    navigate() {},
    request: async (url, options) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      if (url.endsWith("/workspace"))
        return {
          ok: true,
          workspace: {
            provider: "prompt",
            manualOnly: true,
            status: "configured",
            scopeKey: "coalition:example-org",
            canSend: funded,
            blockedReasons: funded ? [] : ["funding_required"],
            capabilities: { manualQueue: true, manageBilling: false },
          },
        };
      if (url.endsWith("/summary"))
        return {
          ok: true,
          billing: { sendingBlocked: !funded, canManageBilling: false },
        };
      if (url.endsWith("/campaigns/campaign-one"))
        return {
          ok: true,
          campaign: {
            campaignId: "campaign-one",
            name: "Example campaign",
            status: "active",
            canFetchQueue: funded,
            blockedReasons: funded ? [] : ["funding_required"],
            assignedUserIds: ["volunteer"],
          },
        };
      if (url.endsWith("/texter/ensure"))
        return { ok: true, texter: { state: "ready" } };
      if (url.endsWith("/queue"))
        return { ok: true, state: "held", items: [structuredClone(recipient)] };
      if (url.endsWith("/confirm")) {
        if (uncertain) throw new TypeError("Failed to fetch");
        return {
          ok: true,
          result: { itemId: recipient.itemId, state: "confirmed" },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  return {
    page,
    calls,
    recipient,
    fund: (value) => {
      funded = value;
    },
    click: async (action) => {
      const target = {
        disabled: false,
        dataset: { workspaceAction: action },
        closest: () => ({
          dataset: {
            workspaceKey: "volunteer:example-org:send:campaign-one",
          },
        }),
      };
      listeners.get("click")({ target: { closest: () => target } });
      await flush();
    },
  };
}

for (const refresh of ["focus", "button"])
  test(`${refresh} refresh restores the funded campaign without navigation or allocating`, async () => {
    const h = fixture();
    try {
      await h.page.load();
      assert.match(
        h.page.render(),
        /data-workspace-action="queue-load"[^>]*disabled/,
      );
      assert.match(h.page.render(), /Refresh sending status/);
      h.fund(true);
      if (refresh === "focus") await h.page.refresh();
      else await h.click("queue-refresh-status");
      assert.match(
        h.page.render(),
        /data-workspace-action="queue-load"[^>]*>Get my next messages/,
      );
      assert.doesNotMatch(h.page.render(), /Refresh sending status/);
      assert.equal(
        h.calls.filter((call) => call.url.endsWith("/campaigns/campaign-one"))
          .length,
        2,
      );
      assert.ok(h.calls.every((call) => call.method === "GET"));
      assert.equal(
        h.calls.some((call) => call.url.endsWith("/queue")),
        false,
      );
    } finally {
      h.page.reset();
    }
  });

test("funding refresh keeps the exact held recipient and receipt until deliberate Send", async () => {
  const h = fixture({ funded: true });
  try {
    await h.page.load();
    await h.click("queue-load");
    h.fund(false);
    await h.page.refresh();
    assert.match(h.page.render(), /Refresh sending status/);
    h.fund(true);
    await h.click("queue-refresh-status");
    assert.match(
      h.page.render(),
      /data-workspace-action="queue-confirm"[^>]*>Send to Example Recipient/,
    );
    assert.equal(
      h.calls.filter((call) => call.url.endsWith("/queue")).length,
      1,
    );
    assert.equal(
      h.calls.some((call) => call.url.endsWith("/confirm")),
      false,
    );
    await h.click("queue-confirm");
    assert.deepEqual(
      h.calls.find((call) => call.url.endsWith("/confirm")).body,
      { humanConfirmation: h.recipient.humanConfirmation },
    );
  } finally {
    h.page.reset();
  }
});

test("funding refresh never releases or resends an uncertain held recipient", async () => {
  const h = fixture({ funded: true, uncertain: true });
  try {
    await h.page.load();
    await h.click("queue-load");
    await h.click("queue-confirm");
    assert.match(h.page.render(), /Delivery needs review/);
    h.fund(false);
    await h.page.refresh();
    h.fund(true);
    await h.click("queue-refresh-status");
    assert.match(h.page.render(), /Delivery needs review/);
    assert.match(
      h.page.render(),
      /data-workspace-action="queue-confirm"[^>]*disabled/,
    );
    await h.click("queue-confirm");
    assert.equal(
      h.calls.filter((call) => call.url.endsWith("/confirm")).length,
      1,
    );
    assert.equal(
      h.calls.filter((call) => call.url.endsWith("/queue")).length,
      1,
    );
  } finally {
    h.page.reset();
  }
});

test("readiness refresh leaves campaign editing and its saved draft alone", async () => {
  const draft = { name: "Unsaved draft", templateText: "Draft message" },
    state = { campaigns: { campaign: { campaignId: "campaign-one" }, draft } };
  const page = createCampaigns({
    context: () => ({ section: "campaigns", resourceId: "campaign-one" }),
    view: () => state,
    contactApi: { invalidate() {} },
    api: () =>
      assert.fail("Sending refresh must not change an editing revision"),
  });
  await page.refreshReadiness();
  assert.equal(state.campaigns.draft, draft);
  assert.deepEqual(state.campaigns.campaign, { campaignId: "campaign-one" });
  page.dispose();
});
