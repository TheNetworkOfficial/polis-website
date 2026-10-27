import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const subscriptionSource = (
  await readFile(
    new URL(
      "../frontend/src/pages/shared-feed/scripts/geocodeSubscription.js",
      import.meta.url,
    ),
    "utf8",
  )
).replace(
  /import[\s\S]*?from "\.\/textingWorkspaceUi";/,
  `const e = v => String(v ?? ''), count = v => String(v ?? 0), uuid = () => crypto.randomUUID(), checkedUrl = v => v || '';`,
);
const subscriptionUrl = `data:text/javascript;base64,${Buffer.from(subscriptionSource).toString("base64")}`;

const source = (
  await readFile(
    new URL(
      "../frontend/src/pages/shared-feed/scripts/organizationGeocodeCredits.js",
      import.meta.url,
    ),
    "utf8",
  )
)
  .replace(
    /import[\s\S]*?from "\.\/textingWorkspaceUi";/,
    `const e = v => String(v ?? ''), button = (action, text) => '<button data-action="'+action+'">'+text+'</button>', count = v => String(v ?? 0), uuid = () => crypto.randomUUID(), checkedUrl = v => v || '';`,
  )
  .replace(
    /import[\s\S]*?from "\.\/geocodeUi";/,
    `const geocodeLabel = v => String(v || '').replaceAll('_', ' '), geocodeSelectionKey = v => JSON.stringify(v || null), geocodeTerminal = v => ['complete','cancelled'].includes(v?.status);`,
  )
  .replace(/from "\.\/geocodeSubscription"/, `from "${subscriptionUrl}"`);
const { createOrganizationGeocodeCredits } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const { createGeocodeSubscription, geocodePaymentUrl } = await import(
  subscriptionUrl
);

test("workspace rotation rejects a late response and clears quotes, billing intents and drafts", async () => {
  let owner = "actor:coalition:A",
    release;
  const state = {};
  const component = createOrganizationGeocodeCredits({
    state: () => state,
    ownerKey: () => owner,
    api: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    prefix: "book",
    busy: () => false,
    selectedIds: () => [],
  });
  const pending = component.load();
  state.geocodeCredits.quote = { quoteId: "old" };
  state.geocodeCredits.subscriptionOperation = { operationId: "old" };
  state.geocodeCredits.settingsDraft = { automatic: { enabled: true } };
  owner = "actor:coalition:B";
  release({ enabled: true, permissions: { subscriptionManage: true } });
  await assert.rejects(pending, /workspace changed/);
  assert.equal(component.render(), "");
  assert.equal(state.geocodeCredits.owner, owner);
  assert.equal(state.geocodeCredits.quote, undefined);
  assert.equal(state.geocodeCredits.subscriptionOperation, undefined);
  assert.equal(state.geocodeCredits.settingsDraft, undefined);
});

test("payment navigation accepts only exact approved HTTPS Stripe hosts", () => {
  for (const value of [
    "https://checkout.stripe.com/c/pay/a",
    "https://invoice.stripe.com/i/a",
    "https://billing.stripe.com/p/a",
  ])
    assert.equal(geocodePaymentUrl(value), value);
  for (const value of [
    "http://checkout.stripe.com/c/a",
    "https://checkout.stripe.com.evil.test/a",
    "https://user@checkout.stripe.com/a",
    "javascript:alert(1)",
    "https://checkout.stripe.com:444/a",
  ])
    assert.throws(() => geocodePaymentUrl(value));
});

test("uncertain subscription intent is retried unchanged and stale preview cannot charge", async (t) => {
  const oldWindow = globalThis.window,
    oldStorage = globalThis.sessionStorage,
    oldForm = globalThis.FormData;
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.sessionStorage = oldStorage;
    globalThis.FormData = oldForm;
  });
  globalThis.window = { location: { pathname: "/organization/A/contacts" } };
  const storage = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.FormData = class {
    constructor(data) {
      this.data = data;
    }
    get(key) {
      return this.data[key];
    }
  };
  const s = {
    status: {
      enabled: true,
      permissions: { subscriptionManage: true },
      rights: { accepted: true },
      capabilities: { subscription: true },
    },
    subscription: {
      source: "pilot",
      revision: 1,
      checkoutEnabled: true,
      termsVersion: "terms",
      plans: [{ id: "team" }],
    },
  };
  const calls = [],
    navigations = [];
  let fail = true;
  let authoritative = null;
  const component = createGeocodeSubscription({
    get: () => s,
    ownerKey: () => "actor:coalition:A",
    b: () => "",
    prefix: "book",
    busy: () => false,
    refresh: async () => {},
    navigate: (url) => navigations.push(url),
    api: async (path, body) => {
      calls.push({ path, body });
      if (path.endsWith("/reconcile")) return { subscription: authoritative };
      if (fail) throw Error("lost response");
      return {
        status: "pending",
        checkoutUrl: "https://checkout.stripe.com/c/pay/a",
      };
    },
  });
  await assert.rejects(
    component.submit("book-geocode-subscription", {
      planId: "team",
      subscriptionTerms: "on",
    }),
    /lost response/,
  );
  assert.ok(storage.size);
  fail = false;
  await component.action("subscription-retry");
  assert.equal(calls[0].body.operationId, calls[1].body.operationId);
  assert.equal(navigations.length, 1);
  await assert.rejects(
    component.submit("book-geocode-subscription", {
      planId: "team",
      subscriptionTerms: "on",
    }),
    /pending billing/,
  );
  s.subscriptionOperation = null;
  s.subscriptionPreview = {
    previewId: "expired",
    expectedRevision: 1,
    expiresAt: Date.now() - 1,
  };
  s.subscriptionPreviewTerms = "terms";
  await assert.rejects(
    component.action("subscription-confirm"),
    /expired or changed/,
  );
  assert.equal(calls.length, 2);
  s.subscriptionOperation = {
    operationId: "rejected-operation",
    expectedRevision: 1,
  };
  authoritative = {
    ...s.subscription,
    lastOperation: { operationId: "rejected-operation", status: "rejected" },
  };
  await component.action("subscription-refresh");
  assert.equal(s.subscriptionOperation, null);
  assert.match(s.subscriptionNotice, /rejected/);
  s.status.permissions.subscriptionManage = false;
  await assert.rejects(
    component.action("subscription-cancel-review"),
    /owner or administrator/,
  );
});
function fixture() {
  let selection = "frozen",
    failExecute = false;
  const state = {},
    calls = [],
    continuations = [];
  const api = async (path, body) => {
    calls.push({ path, body });
    if (path === "/geocoding/credits")
      return {
        enabled: true,
        available: 10,
        permissions: { spend: true },
        rights: { accepted: true },
        settings: {},
      };
    if (path.endsWith("/quotes"))
      return {
        quote: {
          quoteId: "q",
          status: "ready",
          maximumCredits: 2,
          uniqueAddresses: 1,
          expiresAt: Date.now() + 60000,
        },
      };
    if (path.endsWith("/executions")) {
      if (failExecute) throw Error("connection lost");
      return { job: { id: "job", selectionId: "frozen", status: "complete" } };
    }
    if (path.includes("/jobs/"))
      return { job: { id: "job", selectionId: "frozen", status: "complete" } };
    if (path.endsWith("/destinations"))
      return {
        destination: { id: "destination", status: "awaiting_projection" },
      };
    if (path.endsWith("/destinations/destination/advance"))
      return {
        destination: {
          id: "destination",
          status: "ready",
          refreshedSelectionId: "refreshed",
          continuation: { operationId: "once" },
        },
      };
    return { items: [] };
  };
  const component = createOrganizationGeocodeCredits({
    api,
    state: () => state,
    prefix: "book",
    busy: () => false,
    selectedIds: () => [],
    selectionKey: () => selection,
    prepareSelection: async () => ({ selectionId: selection }),
    continueDestination: async (value) => continuations.push(value),
  });
  return {
    component,
    state,
    calls,
    continuations,
    select: (value) => (selection = value),
    fail: (value) => (failExecute = value),
  };
}
test("frozen destination waits projection and hands off only once with refreshed selection", async () => {
  const f = fixture();
  await f.component.review("territory_wizard");
  await f.component.action("book-geocode-continue-destination");
  assert.equal(f.continuations.length, 0);
  await f.component.action("book-geocode-continue-destination");
  await f.component.action("book-geocode-continue-destination");
  assert.equal(f.continuations.length, 1);
  assert.equal(f.continuations[0].refreshedSelectionId, "refreshed");
  assert.equal(f.calls.filter((v) => v.path.endsWith("/executions")).length, 0);
  assert.equal(
    f.calls.find((v) => v.path.endsWith("/destinations")).body.locatedOnly,
    false,
  );
});
test("uncertain execution retries same operation and selection change invalidates quote", async () => {
  const f = fixture();
  await f.component.review();
  f.fail(true);
  await assert.rejects(
    f.component.action("book-geocode-execute"),
    /connection lost/,
  );
  await assert.rejects(
    f.component.action("book-geocode-execute"),
    /connection lost/,
  );
  const calls = f.calls.filter((v) => v.path.endsWith("/executions"));
  assert.equal(calls[0].body.operationId, calls[1].body.operationId);
  f.select("different");
  f.component.render();
  assert.equal(f.state.geocodeCredits.quote, null);
  await assert.rejects(
    f.component.action("book-geocode-execute"),
    /selection changed/,
  );
  assert.equal(f.calls.filter((v) => v.path.endsWith("/executions")).length, 2);
});
test("located-only is an explicit new destination operation", async () => {
  const f = fixture();
  await f.component.review("territory_wizard");
  await f.component.action("book-geocode-continue-destination");
  await f.component.action("book-geocode-located-destination");
  const calls = f.calls.filter((v) => v.path.endsWith("/destinations"));
  assert.equal(calls[0].body.locatedOnly, false);
  assert.equal(calls[1].body.locatedOnly, true);
  assert.notEqual(calls[0].body.operationId, calls[1].body.operationId);
});

const originalSource = (
  await readFile(
    new URL(
      "../frontend/src/pages/shared-feed/scripts/organizationContactOriginal.js",
      import.meta.url,
    ),
    "utf8",
  )
).replace(
  /import[^;]+;/,
  `const checksumBlob = async () => btoa(String.fromCharCode(...Array(32).fill(1)));`,
);
const { archiveContactOriginal } = await import(
  `data:text/javascript;base64,${Buffer.from(originalSource).toString("base64")}`
);
test("archive uploads exact bytes without cookies, resumes matching evidence, requires version", async () => {
  const file = new Blob(["unchanged bytes"]);
  Object.defineProperty(file, "name", { value: "fixture.csv" });
  const calls = [],
    pending = { id: "original", sha256: "01".repeat(32), size: file.size };
  const api = async (path, body) => {
    calls.push({ path, body });
    return {
      original: {
        id: "original",
        uploadUrl: "https://storage.example.test/object",
        headers: {},
      },
    };
  };
  const options = {
    api,
    guard: () => {},
    pending,
    upload: async (_, request) => {
      assert.equal(request.body, file);
      assert.equal(request.credentials, "omit");
      return new Response("", {
        status: 200,
        headers: { "x-amz-version-id": "immutable" },
      });
    },
  };
  await archiveContactOriginal(file, options);
  assert.equal(calls[0].path, "/import-originals/original");
  assert.equal(calls[1].path, "/import-originals/original/resume");
  assert.equal(calls[2].body.versionId, "immutable");
  await assert.rejects(
    archiveContactOriginal(file, {
      ...options,
      upload: async () => new Response("", { status: 200 }),
    }),
    /verification is unavailable/,
  );
});

test("lost completion response recovers sealed original without another upload", async () => {
  const file = new Blob(["unchanged bytes"]);
  Object.defineProperty(file, "name", { value: "fixture.csv" });
  const pending = { id: "sealed", sha256: "01".repeat(32), size: file.size };
  const calls = [];
  const result = await archiveContactOriginal(file, {
    pending,
    guard: () => {},
    api: async (path) => {
      calls.push(path);
      return {
        original: { ...pending, status: "ready", versionId: "sealed-version" },
      };
    },
    upload: async () => {
      throw Error("A sealed original must not be uploaded again");
    },
  });
  assert.equal(result.versionId, "sealed-version");
  assert.deepEqual(calls, ["/import-originals/sealed"]);
});
