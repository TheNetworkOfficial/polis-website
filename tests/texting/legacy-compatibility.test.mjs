import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { prepareTextingAccess } = await import(await moduleUrl("textingAccess"));
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);

test("incumbent workspaces keep assigned sending without calling new access setup", async () => {
  const calls = [];
  const runtime = {
    workspace: () => ({
      provider: "prompt",
      capabilities: { manualQueue: true },
    }),
    api: async (path) => calls.push(path),
  };
  await prepareTextingAccess(runtime, {}, "assigned-campaign");
  assert.deepEqual(calls, []);
});

test("legacy campaign save omits unsupported schedule while access failures remain visible", async (t) => {
  const old = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) {
      this.values = form;
    }
    get(key) {
      return this.values[key];
    }
  };
  t.after(() => {
    globalThis.FormData = old;
  });
  const view = {},
    calls = [];
  let status = 404;
  const runtime = {
    view: () => view,
    can: () => true,
    busy: () => false,
    navigate() {},
    contactApi: async (path) => {
      assert.equal(path, "/schema");
      return { capabilities: { read: false } };
    },
    api: async (path, body) => {
      calls.push({ path, body });
      if (path === "/delivery-schedule")
        throw Object.assign(new Error("unavailable"), { status });
      if (path === "/audiences") return { audiences: [] };
      return { campaign: { ...body, campaignId: "campaign" } };
    },
  };
  const page = createCampaigns(runtime);
  await page.load("new", "campaigns");
  assert.equal(view.campaigns.scheduleUnsupported, true);
  view.campaigns.draft.audienceId = "saved-reviewed-audience";
  await page.submit("campaign", {
    name: "Example",
    templateText: "Example Civic Team. Reply STOP to opt out.",
    budget: "5",
    deliveryStart: "2026-09-30T08:00",
    deliveryEnd: "2026-10-01T20:00",
  });
  assert.equal(Object.hasOwn(calls.at(-1).body, "deliverySchedule"), false);
  status = 403;
  await assert.rejects(page.load("new", "campaigns"), /unavailable/);
  status = 404;
  view.neutralApi = true;
  await assert.rejects(page.load("new", "campaigns"), /unavailable/);
});

test("legacy billing uses authoritative summary permission only when capability is absent", async (t) => {
  const old = globalThis.document;
  globalThis.document = { addEventListener() {} };
  t.after(() => {
    if (old === undefined) delete globalThis.document;
    else globalThis.document = old;
  });
  const capabilities = { manualQueue: true, createCampaigns: true };
  let billingPermission = true;
  const page = createTextingWorkspacePage({
    context: () => ({
      userId: "user",
      organizationId: "example",
      section: "home",
    }),
    changed() {},
    navigate() {},
    request: async (path) => ({
      ok: true,
      ...(path.endsWith("/workspace")
        ? {
            workspace: {
              provider: "prompt",
              manualOnly: true,
              scopeKey: "coalition:example",
              status: "configured",
              capabilities,
            },
          }
        : path.endsWith("/billing/summary")
          ? { billing: { canManageBilling: billingPermission } }
          : { items: [] }),
    }),
  });
  await page.load();
  assert.equal(page.getMeta().capabilities.manageBilling, true);
  capabilities.manageBilling = false;
  await page.refresh();
  assert.equal(page.getMeta().capabilities.manageBilling, false);
  delete capabilities.manageBilling;
  billingPermission = false;
  await page.refresh();
  assert.equal(page.getMeta().capabilities.manageBilling, false);
});
