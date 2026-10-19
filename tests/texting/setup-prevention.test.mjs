import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { moduleUrl } from "./module-fixture.mjs";

const { createTextingSetupPage } = await import(
  await moduleUrl("textingSetup")
);
const {
  createTextingSetupTransport,
  textingSetupActivation,
  textingSetupApiBase,
} = await import(await moduleUrl("textingSetupTransport"));
const { textingPurchaseStatus, textingPurchaseBlockers } = await import(
  await moduleUrl("textingReadinessStatus")
);
const { renderTextingRenewals } = await import(
  await moduleUrl("textingRenewals")
);
const { createTextingSetupRecovery } = await import(
  await moduleUrl("textingSetupRecovery")
);
const base = "/api/texting/setup/coalition/org-1";
const discovery = {
  capabilities: { isolatedSetup: true, createSetup: true, manageBilling: true },
  setups: [],
  availableAudiences: [
    { audienceId: "selection-one", name: "Reviewed neighbors", count: 50 },
  ],
  volunteers: [
    { userId: "person-one", displayName: "Helena Example", username: "helena" },
  ],
};
const draft = () => ({
  setupId: "setup-one",
  campaignId: "campaign-one",
  revision: 2,
  epoch: 1,
  state: "draft",
  owner: { isCurrentUser: true },
  canPrepare: true,
  canPublish: false,
  progress: { selected: 50, submitted: 0, verified: 0 },
  draft: { name: "Neighbors", templateText: "Example Civic Team. Reply STOP." },
});
const handoff = () => ({
  state: "ready",
  expectedRevision: 4,
  action: {
    method: "POST",
    path: "/api/text-banking/prompt/scopes/coalition%3Aorg-1/campaigns/campaign-one/transition",
    body: { expectedRevision: 4, action: "activate" },
  },
});
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
function fixture(
  t,
  {
    setup = draft(),
    api,
    resourceId = "setup-one",
    capabilities = discovery.capabilities,
    legacy,
    organizationId = "org-1",
  } = {},
) {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    FormData: globalThis.FormData,
    sessionStorage: globalThis.sessionStorage,
  };
  const listeners = new Map(),
    calls = [],
    oldCalls = [],
    navigation = [];
  globalThis.document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  globalThis.window = { confirm: () => true };
  const tabValues = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => tabValues.get(key),
    setItem: (key, value) => tabValues.set(key, value),
    removeItem: (key) => tabValues.delete(key),
  };
  globalThis.FormData = class {
    constructor(form) {
      this.values = form.values;
    }
    get(key) {
      return this.values[key];
    }
    getAll(key) {
      return this.values[key] || [];
    }
  };
  t.after(() => Object.assign(globalThis, original));
  let actor = "actor-one",
    saved = structuredClone(setup);
  const page = createTextingSetupPage({
    context: () => ({ userId: actor, organizationId, resourceId }),
    changed() {},
    navigate: (...args) => navigation.push(args),
    schedule: () => 1,
    cancel() {},
    request: async (path, options = {}) => {
      calls.push({ path, ...options });
      if (api)
        return api({ path, options, saved, save: (value) => (saved = value) });
      return path === base ? { ...discovery, capabilities } : { setup: saved };
    },
    legacyRequest: async (path, options) => {
      oldCalls.push({ path, ...options });
      return legacy ? legacy(path, options) : { ok: true };
    },
  });
  return {
    page,
    calls,
    oldCalls,
    navigation,
    actor: (id) => (actor = id),
    submit: async (values) => {
      listeners.get("submit")({
        target: { values, matches: () => true, reportValidity: () => true },
        preventDefault() {},
      });
      await flush();
      for (let count = 0; count < 100 && /Saving…/.test(page.render()); count++)
        await new Promise((resolve) => setTimeout(resolve, 1));
    },
    click: async (action) => {
      listeners.get("click")({
        target: {
          closest: () => ({
            dataset: { setupAction: action },
            disabled: false,
          }),
        },
      });
      await flush();
    },
  };
}

test("setup config pins the dedicated HTTPS API and disabled config sends no credentials", async () => {
  const good = {
    schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
    enabled: true,
    apiBaseUrl: "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
  };
  assert.equal(textingSetupApiBase(good), good.apiBaseUrl);
  for (const value of [
    { ...good, enabled: false },
    { ...good, apiBaseUrl: "https://evil.example/prod" },
    { ...good, apiBaseUrl: `${good.apiBaseUrl}?secret=x` },
  ])
    assert.equal(textingSetupApiBase(value), "");
  const calls = [];
  const request = createTextingSetupTransport({
    headers: () => ({ Authorization: "test-only-token" }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ...good, enabled: false }) };
    },
  });
  await assert.rejects(request(base), /setup_unavailable/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers, undefined);
  await assert.rejects(
    request("/api/text-banking/prompt/scopes/anything/campaigns/one/queue"),
    /setup_route_invalid/,
  );
  assert.equal(calls.length, 1);
});

test("paused admissions keep paginated saved setups readable without creating or replaying an operation", async (t) => {
  const saved = (setupId, name) => ({
    ...draft(),
    setupId,
    draft: { name, templateText: "Example Civic Team. Reply STOP." },
  });
  const h = fixture(t, {
    resourceId: "",
    api: async ({ path }) => ({
      ...discovery,
      capabilities: { ...discovery.capabilities, createSetup: false },
      setupAvailability: {
        state: "paused",
        supportedWorkflowTypes: ["contact_book_single"],
      },
      setups: path.includes("?cursor=")
        ? [saved("older", "Older saved preparation")]
        : [saved("recent", "Recent saved preparation")],
      nextCursor: path.includes("?cursor=") ? null : "signed.cursor-value",
    }),
  });
  await h.page.load();
  assert.match(h.page.render(), /New campaign setup is paused/);
  assert.match(h.page.render(), /Load more saved setups/);
  await h.click("more");
  assert.match(h.page.render(), /Recent saved preparation/);
  assert.match(h.page.render(), /Older saved preparation/);
  assert.doesNotMatch(h.page.render(), /Load more saved setups/);
  assert.ok(
    h.calls.some((call) => call.path === `${base}?cursor=signed.cursor-value`),
  );
  assert.ok(h.calls.every((call) => !call.method || call.method === "GET"));
  assert.equal(h.oldCalls.length, 0);
});

test("setup transport sends credentials only to the pinned setup path and never follows redirects", async () => {
  const calls = [];
  const request = createTextingSetupTransport({
    headers: () => ({ Authorization: "test-only-token" }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.startsWith("/")
            ? {
                schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
                enabled: true,
                apiBaseUrl:
                  "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
              }
            : { ok: true },
      };
    },
  });
  await request(`${base}/drafts/setup-one/resume`, {
    method: "POST",
    body: { expectedRevision: 2 },
  });
  assert.equal(
    calls[1].url,
    `https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod${base}/drafts/setup-one/resume`,
  );
  assert.equal(calls[1].options.redirect, "error");
  assert.equal(calls[1].options.credentials, "omit");
  assert.deepEqual(JSON.parse(calls[1].options.body), { expectedRevision: 2 });
});

test("activation handoff accepts only the exact campaign, original revision and activation action", () => {
  const setup = { ...draft(), handoff: handoff() };
  assert.equal(textingSetupActivation(setup, "org-1"), setup.handoff.action);
  for (const action of [
    {
      ...handoff().action,
      path: handoff().action.path.replace("campaign-one", "campaign-two"),
    },
    { ...handoff().action, body: { expectedRevision: 5, action: "activate" } },
    {
      ...handoff().action,
      path: handoff().action.path.replace("transition", "queue"),
    },
    {
      ...handoff().action,
      body: { expectedRevision: 4, action: "activate", humanConfirmation: {} },
    },
  ])
    assert.throws(
      () =>
        textingSetupActivation(
          { ...setup, handoff: { ...handoff(), action } },
          "org-1",
        ),
      /setup_handoff_invalid/,
    );
});

test("load and refresh observe preparation without calling mutations or incumbent APIs", async (t) => {
  const h = fixture(t, {
    setup: { ...draft(), state: "preparing", canPrepare: false },
  });
  await h.page.load();
  await h.page.refresh();
  assert.ok(h.calls.every((call) => !call.method || call.method === "GET"));
  assert.equal(h.oldCalls.length, 0);
  assert.match(h.page.render(), /You can leave this page and return/);
});

test("a lost activation response requires saved readback and never automatically repeats activation", async (t) => {
  const h = fixture(t, {
    setup: {
      ...draft(),
      state: "published",
      canPrepare: false,
      handoff: handoff(),
    },
    legacy: async () => {
      throw new TypeError("Response lost");
    },
  });
  await h.page.load();
  await h.click("open");
  assert.equal(h.oldCalls.length, 1);
  assert.match(h.page.render(), /Check the saved result/);
  await h.click("open");
  assert.equal(h.oldCalls.length, 1);
  await h.click("refresh");
  assert.equal(h.oldCalls.length, 1);
  assert.deepEqual(h.oldCalls[0].body, {
    expectedRevision: 4,
    action: "activate",
  });
});

test("bounded publication without a handoff cannot activate a partial canonical graph", async (t) => {
  const h = fixture(t, {
    setup: { ...draft(), state: "ready", canPrepare: false, canPublish: true },
  });
  await h.page.load();
  await h.click("open");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls.at(-1).path, `${base}/drafts/setup-one/publish`);
  assert.equal(h.oldCalls.length, 0);
});

test("manager takeover is offered only by capability and uses the exact saved revision", async (t) => {
  const h = fixture(t, {
    setup: { ...draft(), canPrepare: false, canTakeover: true },
  });
  await h.page.load();
  assert.match(h.page.render(), /Take over preparation/);
  await h.click("takeover");
  assert.deepEqual(h.calls.at(-1).body, { expectedRevision: 2 });
  assert.equal(h.oldCalls.length, 0);
});

test("a late response after actor change cannot render another actor's setup", async (t) => {
  let release;
  const h = fixture(t, {
    api: () => new Promise((resolve) => (release = resolve)),
  });
  const pending = h.page.load();
  await flush();
  h.actor("actor-two");
  release(discovery);
  await pending;
  assert.doesNotMatch(h.page.render(), /Neighbors|Example Civic Team/);
});

test("an accepted activation displays progress until complete and never claims ready to text early", async (t) => {
  const h = fixture(t, {
    setup: {
      ...draft(),
      canPrepare: false,
      state: "opening",
      handoff: { state: "accepted", action: null },
    },
  });
  await h.page.load();
  assert.doesNotMatch(h.page.render(), />Start texting</);
});

test("new setup uses named choices and stays hidden from non-billing creation permissions", async (t) => {
  const h = fixture(t, {
    resourceId: "new",
    capabilities: { ...discovery.capabilities, manageBilling: false },
  });
  await h.page.load();
  assert.doesNotMatch(h.page.render(), /data-setup-form/);
  assert.match(h.page.render(), /organization administrator/);
});

test("pending payment never claims funded, preserves same-purchase guidance and uses exact known blockers", () => {
  assert.match(
    textingPurchaseStatus({ status: "pending", paymentStatus: "paid" }).message,
    /don’t pay again/i,
  );
  assert.equal(
    textingPurchaseStatus({ status: "credit_pending" }).title,
    "Updating your balance",
  );
  assert.equal(
    textingPurchaseStatus({ status: "pending" }, { delayed: true }).title,
    "Payment is still processing",
  );
  assert.match(
    textingPurchaseBlockers({
      blockedReasons: ["funding_required", "registration_approval_required"],
    })[0].message,
    /registration/,
  );
  assert.doesNotMatch(
    textingPurchaseBlockers({
      purchaseReadiness: { blockers: [{ code: "untrusted-phone-and-secret" }] },
    })[0].message,
    /untrusted-phone-and-secret/,
  );
});

test("only finite positive renewal dates render, with rates distinct from an open tax deferral", () => {
  const html = renderTextingRenewals(
    [
      {
        kind: "tax_review",
        label: "Tax review",
        expiresAtMs: null,
        status: "pending",
      },
      { label: "Epoch tax", expiresAtMs: 0, status: "expired" },
      {
        kind: "rates",
        label: "Verified texting rates",
        expiresAtMs: Date.now() + 86400000,
        status: "due_soon",
        owner: "Polis support",
      },
    ],
    true,
  );
  assert.match(html, /Verified texting rates/);
  assert.doesNotMatch(html, /Tax review|Epoch tax|1970/);
});

test("a route change during config discovery fences the setup request before credentials are sent", async () => {
  let release,
    active = true;
  const calls = [];
  const request = createTextingSetupTransport({
    headers: () => ({ Authorization: "original-test-actor" }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Promise((resolve) => (release = resolve));
    },
  });
  const pending = request(base, {
    beforeRequest: () => {
      if (!active) throw new Error("Actor changed");
    },
  });
  active = false;
  release({
    ok: true,
    json: async () => ({
      schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
      enabled: true,
      apiBaseUrl: "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
    }),
  });
  await assert.rejects(pending, /Actor changed/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers, undefined);
});

test("saved reconciliation uses only the explicitly advertised operation and cannot become an upload", async (t) => {
  const h = fixture(t, {
    setup: {
      ...draft(),
      canPrepare: false,
      canReconcile: true,
      state: "reconciliation_required",
    },
  });
  await h.page.load();
  assert.match(h.page.render(), /Check preparation status/);
  await h.click("reconcile");
  assert.equal(h.calls.at(-1).path, `${base}/drafts/setup-one/reconcile`);
  assert.deepEqual(h.calls.at(-1).body, { expectedRevision: 2 });
  assert.equal(h.oldCalls.length, 0);
});

test("an edited published campaign cannot be activated with a substituted revision", async (t) => {
  const h = fixture(t, {
    setup: {
      ...draft(),
      canPrepare: false,
      state: "published",
      handoff: { state: "changed", action: null },
    },
  });
  await h.page.load();
  await h.click("open");
  assert.match(h.page.render(), /Campaign changed after review/);
  assert.match(h.page.render(), /View campaign status/);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(h.oldCalls.length, 0);
});

test("creation recovery stores only opaque identity, including when tab storage is unavailable", () => {
  const values = new Map(),
    location = {
      href: "https://polis.example/organizations/org-1/texting/setup/new?return=keep",
    };
  const options = {
    context: () => ({ userId: "actor-one", organizationId: "org-1" }),
    storage: () => ({
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }),
    location: () => location,
    history: () => ({
      state: {},
      replaceState: (_state, _title, path) =>
        (location.href = new URL(path, location.href).href),
    }),
  };
  const recovery = createTextingSetupRecovery(options);
  recovery.save("original-request");
  assert.deepEqual([...values.values()], ["original-request"]);
  assert.equal(createTextingSetupRecovery(options).read(), "original-request");
  const privateMode = createTextingSetupRecovery({
    ...options,
    storage: () => {
      throw new Error("Storage disabled");
    },
  });
  assert.equal(privateMode.read(), "original-request");
  recovery.clear();
  assert.equal(recovery.read(), null);
  assert.match(location.href, /return=keep/);
});

test("reload resolves the existing creation through GET without repeating create or activation", async (t) => {
  const h = fixture(t, { resourceId: "new" });
  const values = new Map([
    ["polis.texting.setup.request.v1.actor-one.org-1", "original-request"],
  ]);
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key),
    removeItem: (key) => values.delete(key),
  };
  await h.page.load();
  assert.equal(h.calls.at(-1).path, `${base}/requests/original-request`);
  assert.ok(h.calls.every((call) => !call.method || call.method === "GET"));
  assert.deepEqual(h.navigation, [["setup", "setup-one"]]);
  assert.equal(values.size, 0);
  assert.equal(h.oldCalls.length, 0);
});

const originalForm = () => ({
  name: "Neighbors",
  audienceId: "selection-one",
  templateText: "Example Civic Team. Reply STOP.",
  budget: "5.00",
  start: "2099-01-01T10:00",
  end: "2099-01-01T18:00",
  volunteer: ["person-one"],
});
const originalBody = () => ({
  requestId: "original-request",
  name: "Neighbors",
  audienceId: "selection-one",
  templateText: "Example Civic Team. Reply STOP.",
  mediaId: null,
  budgetMicros: 5000000,
  deliveryNotBeforeMs: new Date("2099-01-01T10:00").getTime(),
  deliveryBeforeMs: new Date("2099-01-01T18:00").getTime(),
  assignedUserIds: ["person-one"],
});
async function saveOriginalDraft() {
  await createTextingSetupRecovery({
    context: () => ({ userId: "actor-one", organizationId: "org-1" }),
  }).saveDraft(originalBody());
}

test("a missing creation lookup restores and explicitly retries only the exact original body and identity", async (t) => {
  const h = fixture(t, {
    resourceId: "new",
    api: ({ path, options }) => {
      if (path === base) return discovery;
      if (path.includes("/requests/"))
        throw Object.assign(new Error("Not found"), {
          status: 404,
          payload: { error: "texting_setup_request_not_found" },
        });
      assert.equal(options.body.requestId, "original-request");
      assert.deepEqual(options.body, originalBody());
      return { setup: draft() };
    },
  });
  await saveOriginalDraft();
  await h.page.load();
  assert.match(h.page.render(), /original draft is restored/);
  assert.match(h.page.render(), /value="2099-01-01T10:00"/);
  assert.match(h.page.render(), /value="person-one" checked/);
  assert.ok(h.calls.every((call) => !call.method || call.method === "GET"));
  await h.submit({ ...originalForm(), name: "Changed draft" });
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  assert.match(h.page.render(), /original draft has been restored/);
  await h.submit(originalForm());
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls.at(-1).body.requestId, "original-request");
  assert.equal(
    globalThis.sessionStorage.getItem(
      "polis.texting.setup.draft.v2.actor-one.org-1",
    ),
    undefined,
  );
});

test("an ID-only or corrupt pending record can read back but never submit a substituted draft", async (t) => {
  const h = fixture(t, {
    resourceId: "new",
    api: ({ path }) => {
      if (path === base) return discovery;
      throw Object.assign(new Error("Not found"), {
        status: 404,
        payload: { error: "texting_setup_request_not_found" },
      });
    },
  });
  await saveOriginalDraft();
  globalThis.sessionStorage.setItem(
    "polis.texting.setup.draft.v2.actor-one.org-1",
    "{broken",
  );
  await h.page.load();
  assert.match(h.page.render(), /Original draft unavailable/);
  await h.submit(originalForm());
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(
    globalThis.sessionStorage.getItem(
      "polis.texting.setup.request.v1.actor-one.org-1",
    ),
    "original-request",
  );
});

test("paused discovery and a missing request preserve the original draft without permitting a retry until enabled", async (t) => {
  let enabled = false;
  const h = fixture(t, {
    resourceId: "new",
    api: ({ path }) => {
      if (path === base)
        return {
          ...discovery,
          capabilities: { ...discovery.capabilities, createSetup: enabled },
          setupAvailability: { state: enabled ? "enabled" : "paused" },
        };
      throw Object.assign(new Error("Not found"), {
        status: 404,
        payload: { error: "texting_setup_request_not_found" },
      });
    },
  });
  await saveOriginalDraft();
  await h.page.load();
  assert.match(h.page.render(), /New campaign setup is paused/);
  await h.submit(originalForm());
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  enabled = true;
  await h.page.load({ force: true });
  assert.match(h.page.render(), /value="Neighbors"/);
  assert.match(h.page.render(), /Retry same saved draft/);
  assert.equal(
    globalThis.sessionStorage.getItem(
      "polis.texting.setup.request.v1.actor-one.org-1",
    ),
    "original-request",
  );
});

test("storage write or exact readback failure prevents dispatch and keeps the same identity guard", async (t) => {
  const h = fixture(t, { resourceId: "new" });
  await h.page.load();
  const saved = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => {
      if (key.includes("draft.v2")) throw new Error("quota");
      saved.set(key, value);
    },
    removeItem() {},
  };
  await h.submit(originalForm());
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  assert.match(h.page.render(), /No creation request was sent/);
  assert.equal(saved.size, 1);
});

test("pending draft fingerprint and scope binding reject corruption and another actor without dispatch", async () => {
  const values = new Map();
  let actor = "actor-one";
  const recovery = createTextingSetupRecovery({
    context: () => ({ userId: actor, organizationId: "org-1" }),
    storage: () => ({
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }),
    location: () => null,
  });
  await recovery.saveDraft(originalBody());
  const key = "polis.texting.setup.draft.v2.actor-one.org-1",
    raw = values.get(key);
  assert.equal(JSON.parse(raw).fingerprint.length, 64);
  actor = "actor-two";
  assert.equal(recovery.read(), null);
  assert.equal(await recovery.readDraft("original-request"), null);
  values.set(key.replace("actor-one", "actor-two"), raw);
  await assert.rejects(recovery.readDraft("original-request"), /draft_invalid/);
  actor = "actor-one";
  values.set(key, raw.replace("Neighbors", "Edited draft"));
  await assert.rejects(recovery.readDraft("original-request"), /draft_invalid/);
});

test("a storage backend that silently drops the draft fails exact readback before any POST", async () => {
  const values = new Map();
  const recovery = createTextingSetupRecovery({
    context: () => ({ userId: "actor-one", organizationId: "org-1" }),
    storage: () => ({
      getItem: (key) => values.get(key),
      setItem: (key, value) => {
        if (!key.includes("draft.v2")) values.set(key, value);
      },
    }),
    location: () => null,
  });
  await assert.rejects(recovery.saveDraft(originalBody()), /storage_required/);
  assert.equal(recovery.read(), "original-request");
});

test("the self-contained envelope retains identity if its opaque index disappears; index persistence still must verify before POST", async () => {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
  const recovery = createTextingSetupRecovery({
    context: () => ({ userId: "actor-one", organizationId: "org-1" }),
    storage: () => storage,
    location: () => null,
  });
  await recovery.saveDraft(originalBody());
  values.delete("polis.texting.setup.request.v1.actor-one.org-1");
  assert.equal(recovery.read(), "original-request");
  assert.deepEqual(
    await recovery.readDraft("original-request"),
    originalBody(),
  );
  storage.setItem = (key, value) => {
    if (key.includes("draft.v2")) values.set(key, value);
  };
  await assert.rejects(recovery.saveDraft(originalBody()), /storage_required/);
});

test("an actor switch during durable draft hashing cannot dispatch or persist into another actor scope", async (t) => {
  const h = fixture(t, { resourceId: "new" });
  await h.page.load();
  const pending = h.submit(originalForm());
  h.actor("actor-two");
  await pending;
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(
    globalThis.sessionStorage.getItem(
      "polis.texting.setup.draft.v2.actor-two.org-1",
    ),
    undefined,
  );
});

test("actual backend-generated publication DTO preserves the fixed legacy revision across a lost activation response", async (t) => {
  const folder = new URL("./fixtures/setup-v1/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("MANIFEST.json", folder), "utf8"),
  );
  const fixtures = {};
  for (const record of manifest.records) {
    const raw = await readFile(new URL(record.file, folder));
    assert.equal(createHash("sha256").update(raw).digest("hex"), record.sha256);
    fixtures[record.label] = JSON.parse(raw);
  }
  const published = fixtures.published.setup;
  let complete = false;
  const h = fixture(t, {
    organizationId: "fictional",
    resourceId: published.setupId,
    api: async ({ path }) =>
      path.endsWith("/fictional")
        ? fixtures.enabled
        : complete
          ? fixtures["complete-handoff"]
          : fixtures.published,
    legacy: async () => {
      throw new Error("response lost after acceptance");
    },
  });
  await h.page.load();
  assert.match(h.page.render(), /Continue opening/);
  assert.doesNotMatch(h.page.render(), /Status unavailable/);
  await h.click("open");
  assert.equal(h.oldCalls.length, 1);
  assert.deepEqual(h.oldCalls[0].body, published.handoff.action.body);
  assert.notEqual(h.oldCalls[0].body.expectedRevision, published.revision);
  assert.match(h.page.render(), /Check the saved result/);
  complete = true;
  await h.page.refresh();
  assert.match(h.page.render(), /Start texting/);
  assert.equal(h.oldCalls.length, 1);
});
