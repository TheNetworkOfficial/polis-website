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
const ui = await import(await moduleUrl("textingWorkspaceUi"));
const { uploadContactFile, createContacts } = await import(
  await moduleUrl("textingContacts")
);
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { createConversations } = await import(
  await moduleUrl("textingConversations")
);
const { createTextingBalancePage } = await import(
  await moduleUrl("textingBalance")
);
const { renderTextingShell } = await import(await moduleUrl("textingShell"));
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
  capabilities: {
    manageBilling: true,
    manualQueue: true,
    createCampaigns: true,
    uploadImports: true,
  },
  limits: { maxUploadBytes: 5 * 1024 ** 3, maxImportRows: 1000000 },
};
const item = () => ({
  itemId: "item-one",
  state: "awaiting_confirmation",
  expiresAtMs: Date.now() + 60000,
  blockedReasons: [],
  humanConfirmation: { recordId: "opaque-server-receipt" },
  preview: {
    contactPhone: "+12025550124",
    contactDisplayName: "Example Recipient",
    message: "Example Civic Team says hello. Reply STOP to opt out.",
    attachmentUrl: null,
  },
});

test("displayed SMS costs follow verified base and additional segment tariff", () => {
  assert.equal(ui.messagePrice(billing, "x".repeat(160)), 35000);
  assert.equal(ui.messagePrice(billing, "x".repeat(306)), 35000);
  assert.equal(ui.messagePrice(billing, "x".repeat(307)), 50000);
  assert.equal(ui.messagePrice(billing, "😀".repeat(71)), 50000);
  assert.equal(ui.messagePrice(billing, "hello", true), 45000);
  assert.equal(
    ui.messagePrice(
      { ...billing, smsAdditionalSegmentMicros: null },
      "x".repeat(307),
    ),
    null,
  );
  assert.equal(
    ui.messagePrice({ ...billing, rateStatus: "unverified" }, "hi"),
    null,
  );
});

test("manual confirmation requires exact preview, current receipt, loaded media and enough funds", () => {
  assert.equal(!!ui.queueCanConfirm(item(), workspace, billing), true);
  assert.equal(
    !!ui.queueCanConfirm(
      { ...item(), expiresAtMs: Date.now() - 1 },
      workspace,
      billing,
    ),
    false,
  );
  assert.equal(
    !!ui.queueCanConfirm(
      { ...item(), humanConfirmation: null },
      workspace,
      billing,
    ),
    false,
  );
  assert.equal(
    !!ui.queueCanConfirm(item(), { ...workspace, canSend: false }, billing),
    false,
  );
  assert.equal(
    !!ui.queueCanConfirm(item(), workspace, {
      ...billing,
      availableMicros: 34999,
    }),
    false,
  );
  assert.equal(
    !!ui.queueCanConfirm(item(), workspace, {
      ...billing,
      availableMicros: 35000,
    }),
    true,
  );
  const m = item();
  m.preview.attachmentUrl = "https://example.test/media.gif";
  assert.equal(!!ui.queueCanConfirm(m, workspace, billing, false), false);
  assert.equal(!!ui.queueCanConfirm(m, workspace, billing, true), true);
  m.preview.attachmentUrl = "javascript:alert(1)";
  assert.equal(!!ui.queueCanConfirm(m, workspace, billing, true), false);
});

test("volunteers use server sending status without receiving financial fields", () => {
  const volunteer = {
    ...workspace,
    capabilities: { ...workspace.capabilities, manageBilling: false },
  };
  const operational = {
    canManageBilling: false,
    canPurchase: false,
    sendingBlocked: false,
    blockedReasons: [],
  };
  assert.equal(!!ui.queueCanConfirm(item(), volunteer, operational), true);
  assert.equal(ui.messageFundingReady(volunteer, operational, "Reply"), true);
  assert.equal(
    !!ui.queueCanConfirm(item(), volunteer, {
      ...operational,
      sendingBlocked: true,
    }),
    false,
  );
  assert.equal(!!ui.queueCanConfirm(item(), volunteer, null), false);
  assert.equal(
    !!ui.queueCanConfirm(
      { ...item(), state: "provider_outcome_unknown" },
      volunteer,
      operational,
    ),
    false,
  );
  assert.equal(
    !!ui.queueCanConfirm(
      { ...item(), expiresAtMs: Date.now() - 1 },
      volunteer,
      operational,
    ),
    false,
  );
  assert.equal(ui.messageFundingReady(workspace, operational, "Reply"), false);
});

test("non-admin home, pilot, campaigns and replies hide even legacy financial values", async () => {
  documentStub();
  const volunteer = {
    ...workspace,
    sendingMode: "pilot",
    pilot: { remainingMessages: 5, remainingSpendMicros: 465000 },
    capabilities: { ...workspace.capabilities, manageBilling: false },
  };
  const oldSummary = { ...billing, canManageBilling: false };
  const page = createTextingWorkspacePage({
    context: () => ({
      organizationId: "org-one",
      userId: "volunteer",
      section: "home",
    }),
    changed: () => {},
    navigate: () => {},
    request: async (url) =>
      url.endsWith("/workspace")
        ? { ok: true, workspace: volunteer }
        : url.endsWith("/summary")
          ? { ok: true, billing: oldSummary }
          : { ok: true, items: [] },
  });
  await page.load();
  assert.match(page.render(), /5 messages remain/);
  assert.doesNotMatch(
    page.render(),
    /TEXTING BALANCE|View balance|Pending charges|Completed usage|\$[0-9]/,
  );
  page.reset();
  const campaign = {
    campaignId: "campaign-one",
    name: "Campaign",
    status: "draft",
    templateText: "Reply STOP to opt out.",
    budgetMicros: 70000,
    reservedMicros: 35000,
    settledMicros: 35000,
    assignedUserIds: [],
    canFetchQueue: true,
  };
  const state = {
    campaigns: { campaign, draft: campaign, queue: { items: [item()] } },
    conversations: {
      conversation: {
        conversationId: "one",
        phone: "+12025550124",
        canReply: true,
      },
      messages: [],
      reply: "Received",
    },
  };
  const r = {
    view: () => state,
    can: (key) => key !== "manageBilling",
    workspace: () => volunteer,
    billing: () => oldSummary,
    context: () => ({ resourceId: "campaign-one" }),
    busy: () => false,
    sendHeld: () => false,
  };
  const campaigns = createCampaigns(r);
  for (const section of ["campaigns", "results", "send"]) {
    assert.doesNotMatch(
      campaigns.render(section),
      /Campaign limit|Pending charges|Completed usage|Available funds|Rate unavailable|\$[0-9]/,
    );
  }
  state.campaigns.editing = true;
  assert.doesNotMatch(
    campaigns.render("campaigns"),
    /Spending limit|per message|Rate awaiting verification|\$[0-9]/,
  );
  const conversation = createConversations(r).render();
  assert.doesNotMatch(conversation, /Rate unavailable|\$[0-9]/);
  assert.match(conversation, /type="submit">Send reply/);
  const shell = (options) =>
    renderTextingShell({
      organizationId: "org-one",
      section: "home",
      content: "",
      ...options,
    });
  assert.doesNotMatch(shell({}), /texting-balance/);
  assert.match(shell({ manageBilling: true }), /texting-balance/);
});

test("direct Balance routes reject volunteers and erase finances after admin downgrade", async () => {
  documentStub();
  const savedWindow = globalThis.window;
  globalThis.window = {
    location: {
      href: "https://polis.example/organizations/org-one/texting-balance",
    },
  };
  let admin = false;
  const calls = [];
  const page = createTextingBalancePage({
    context: () => ({ organizationId: "org-one", userId: "current-user" }),
    changed: () => {},
    request: async (url) => {
      calls.push(url);
      return url.endsWith("/summary")
        ? { billing: { ...billing, currency: "usd", canManageBilling: admin } }
        : { transactions: [], nextCursor: null };
    },
  });
  try {
    await page.load();
    assert.match(page.render(), /do not have access/);
    assert.doesNotMatch(
      page.render(),
      /texting-available|AVAILABLE TO SEND|\$[0-9]/,
    );
    assert.equal(calls.length, 1);
    assert.equal(page.getMeta().capabilities.manageBilling, false);
    admin = true;
    await page.load();
    assert.match(page.render(), /texting-available/);
    assert.equal(page.getMeta().capabilities.manageBilling, true);
    admin = false;
    await page.refresh();
    assert.match(page.render(), /do not have access/);
    assert.doesNotMatch(
      page.render(),
      /texting-available|AVAILABLE TO SEND|\$[0-9]/,
    );
    assert.equal(page.getMeta().capabilities.manageBilling, false);
  } finally {
    page.reset();
    globalThis.window = savedWindow;
  }
});

test("multipart uploads bind digest, omit credentials and reject foreign destinations", async () => {
  const file = new File(["phone\n2025550124\n"], "example.csv"),
    calls = [],
    progress = [];
  const job = {
    importId: "import-one",
    file: { fileName: file.name, sizeBytes: file.size },
    upload: { partSizeBytes: 8388608, totalParts: 1 },
  };
  let host = "example-bucket.s3.us-west-2.amazonaws.com";
  const api = async (route, body) => {
    calls.push({ route, body });
    return {
      upload: {
        importId: job.importId,
        parts: [
          {
            partNumber: 1,
            sizeBytes: file.size,
            sha256Base64: body.parts[0].sha256Base64,
            uploaded: false,
            url: `https://${host}/part`,
            method: "PUT",
            headers: { "x-amz-checksum-sha256": body.parts[0].sha256Base64 },
          },
        ],
      },
    };
  };
  const transport = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true };
  };
  await uploadContactFile({
    file,
    job,
    api,
    guard: () => {},
    progress: (n) => progress.push(n),
    transport,
  });
  assert.equal(progress.at(-1), file.size);
  assert.equal(calls[0].body.parts[0].sha256Base64.length, 44);
  host = "unexpected.example.test";
  await assert.rejects(
    uploadContactFile({
      file,
      job,
      api,
      guard: () => {},
      progress: () => {},
      transport,
    }),
    /destination/,
  );
});

test("multipart resume rejects a mismatched already-uploaded checksum", async () => {
  const file = new File(["row"], "sample.csv"),
    job = {
      importId: "saved",
      file: { fileName: file.name, sizeBytes: file.size },
      upload: { partSizeBytes: 8388608, totalParts: 1 },
    };
  await assert.rejects(
    uploadContactFile({
      file,
      job,
      api: async () => ({
        upload: {
          importId: "saved",
          parts: [
            {
              partNumber: 1,
              sizeBytes: 3,
              uploaded: true,
              sha256Base64: "different",
            },
          ],
        },
      }),
      guard: () => {},
      progress: () => {},
      transport: () => assert.fail("No upload should occur"),
    }),
    /original file/,
  );
});

function documentStub() {
  globalThis.document = { addEventListener: () => {} };
}
test("entry and refresh issue reads only and never allocate recipients", async () => {
  documentStub();
  const calls = [];
  const c = { organizationId: "org-one", userId: "admin", section: "home" };
  const request = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/workspace")
      ? { ok: true, workspace }
      : url.endsWith("/summary")
        ? { ok: true, billing }
        : { ok: true, items: [] };
  };
  const page = createTextingWorkspacePage({
    request,
    context: () => c,
    changed: () => {},
    navigate: () => {},
  });
  await page.load();
  await page.refresh();
  assert.equal(
    calls.every((call) => !call.options.method),
    true,
  );
  assert.equal(
    calls.some((call) => call.url.endsWith("/queue")),
    false,
  );
  assert.match(page.render(), /Good conversations start here/);
  page.reset();
});

test("a late workspace response cannot populate another organization's view", async () => {
  documentStub();
  let c = { organizationId: "org-one", userId: "admin", section: "home" },
    resolveFirst;
  const request = async (url) => {
    if (url.includes("coalition%3Aorg-one") && url.endsWith("/workspace"))
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    if (url.endsWith("/workspace"))
      return {
        ok: true,
        workspace: { ...workspace, scopeKey: "coalition:org-two" },
      };
    if (url.endsWith("/summary"))
      return {
        ok: true,
        billing: { ...billing, organizationName: "Second organization" },
      };
    return { ok: true, items: [] };
  };
  const page = createTextingWorkspacePage({
    request,
    context: () => c,
    changed: () => {},
    navigate: () => {},
  });
  const first = page.load();
  await Promise.resolve();
  c = { ...c, organizationId: "org-two" };
  await page.load();
  resolveFirst({ ok: true, workspace });
  await first;
  assert.equal(page.getMeta().organizationName, "Second organization");
  assert.doesNotMatch(page.render(), /coalition:org-one/);
  page.reset();
});

test("uncertain initial sends stay fenced and never auto-retry", async () => {
  const q = item(),
    held = new Set(),
    calls = [],
    state = {
      campaigns: {
        campaign: { campaignId: "campaign-one", canFetchQueue: true },
        queue: { items: [q] },
      },
    };
  const r = {
    view: () => state,
    workspace: () => workspace,
    billing: () => billing,
    can: () => true,
    sendHeld: (k) => held.has(k),
    holdSend: (k) => held.add(k),
    releaseSend: (k) => held.delete(k),
    api: async (path, body) => {
      calls.push({ path, body });
      return {
        result: { itemId: q.itemId, state: "provider_outcome_unknown" },
      };
    },
    refreshSendStatus: async () => {},
    changed: () => {},
    context: () => ({ resourceId: "campaign-one" }),
    busy: () => false,
    armExpiry: () => {},
    toast: () => {},
  };
  const page = createCampaigns(r);
  await page.action("queue-confirm");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { humanConfirmation: q.humanConfirmation });
  await assert.rejects(page.action("queue-confirm"), /not ready/);
  assert.equal(calls.length, 1);
  assert.equal(state.campaigns.queue.items.length, 1);
  assert.match(page.render("send"), /Delivery needs review/);
  assert.doesNotMatch(page.render("send"), /Sending…/);
});

test("a confirmed message advances only the local item; it does not confirm the next recipient", async () => {
  const q = item(),
    held = new Set(),
    calls = [],
    state = {
      campaigns: {
        campaign: { campaignId: "campaign-one", canFetchQueue: true },
        queue: { items: [q, { ...item(), itemId: "item-two" }] },
      },
    };
  const r = {
    view: () => state,
    workspace: () => workspace,
    billing: () => billing,
    can: () => true,
    sendHeld: (k) => held.has(k),
    holdSend: (k) => held.add(k),
    releaseSend: (k) => held.delete(k),
    api: async (path) => {
      calls.push(path);
      return { result: { itemId: q.itemId, state: "confirmed" } };
    },
    refreshSendStatus: async () => {},
    changed: () => {},
    context: () => ({ resourceId: "campaign-one" }),
    busy: () => false,
    armExpiry: () => {},
    toast: () => {},
  };
  await createCampaigns(r).action("queue-confirm");
  assert.equal(calls.length, 1);
  assert.equal(state.campaigns.queue.items[0].itemId, "item-two");
  assert.equal(state.campaigns.sent, 1);
});

const importJob = (status, revision = 1) => ({
  importId: "import-one",
  file: { fileName: "example.csv" },
  status,
  revision,
  progress: { rowsStaged: status === "staged" ? 1 : 0 },
  mapping: { fields: { phone: "phone" }, headers: ["phone"] },
  actions: {
    canReviewMapping: status === "awaiting_mapping",
    canRetry: status === "queued",
  },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function importHarness(api) {
  const view = {
    contacts: {
      job: importJob("awaiting_mapping"),
      preview: { totalRows: 1, counts: { validPhones: 1 }, rows: [] },
      reviewed: true,
      mapping: { fields: { phone: "phone" }, headers: ["phone"] },
      settings: { fields: { phone: "phone" } },
    },
  };
  let current = true,
    failure;
  const page = createContacts({
    view: () => view,
    context: () => ({ resourceId: "import-one" }),
    api,
    can: (name) => name === "uploadImports",
    busy: () => false,
    changed: () => {},
    guard: () => {
      if (!current) throw new Error("Workspace changed");
    },
    fail: (error) => {
      failure = error;
    },
  });
  return {
    page,
    view,
    changeRoute: () => {
      current = false;
    },
    failure: () => failure,
  };
}

test("import keeps a stable starting view and recovers a failed status read without another POST", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let finishMapping,
    reads = 0;
  const h = importHarness(async (path, body) => {
    calls.push({ path, body });
    if (body)
      return new Promise((resolve) => {
        finishMapping = resolve;
      });
    reads++;
    if (reads === 1) throw new TypeError("Failed to fetch");
    return { import: importJob("staged", 3) };
  });
  const saving = h.page.action("mapping-save");
  assert.match(h.page.render(), /Starting your import/);
  assert.doesNotMatch(h.page.render(), /Match your columns/);
  finishMapping({ import: importJob("queued", 2) });
  await saving;
  assert.match(h.page.render(), /Import progress/);
  assert.doesNotMatch(h.page.render(), /Resume processing/);
  t.mock.timers.tick(5000);
  await flush();
  assert.match(h.page.render(), /Reconnecting to import status/);
  assert.doesNotMatch(h.page.render(), /Failed to fetch|Contacts imported/);
  assert.equal(h.view.contacts.job.status, "queued");
  t.mock.timers.tick(15000);
  await flush();
  assert.match(h.page.render(), /Contacts imported/);
  assert.doesNotMatch(h.page.render(), /Reconnecting/);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads, 2);
  assert.equal(calls.filter((c) => c.body).length, 1);
  h.page.dispose();
});

test("a lost mapping response only checks its durable import and never resubmits", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const h = importHarness(async (path, body) => {
    calls.push({ path, body });
    if (body) throw new TypeError("Failed to fetch");
    return { import: importJob("staged", 3) };
  });
  await h.page.action("mapping-save");
  assert.match(h.page.render(), /Checking your saved import/);
  await h.page.action("mapping-save");
  assert.equal(calls.length, 1);
  t.mock.timers.tick(15000);
  await flush();
  assert.match(h.page.render(), /Contacts imported/);
  assert.equal(calls.filter((c) => c.body).length, 1);
  h.page.dispose();
});

test("automatic import reads are bounded and stop on disposal or revoked access", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const h = importHarness(async () => {
    reads++;
    return { import: importJob("queued", 2) };
  });
  await h.page.load("import-one");
  for (let i = 0; i < 61; i++) {
    t.mock.timers.tick(5000);
    await flush();
  }
  assert.equal(reads, 61); // One initial read and 60 automatic checks.
  assert.match(h.page.render(), /Automatic updates paused/);
  await h.page.action("import-refresh");
  assert.equal(reads, 62);
  h.page.dispose();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads, 62);

  let revoked = false,
    forbiddenReads = 0;
  const denied = importHarness(async () => {
    forbiddenReads++;
    if (revoked) throw Object.assign(new Error("Forbidden"), { status: 403 });
    return { import: importJob("queued", 2) };
  });
  await denied.page.load("import-one");
  revoked = true;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(denied.failure()?.status, 403);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(forbiddenReads, 2);
});

test("a disposed import cannot replace saved state with a late status response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish;
  const h = importHarness(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = h.page.action("import-refresh");
  h.page.dispose();
  finish({ import: importJob("staged", 3) });
  await pending;
  assert.equal(h.view.contacts.job.status, "awaiting_mapping");
});

test("a lost preparation response reconciles by reads without another contact transfer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const oldWindow = globalThis.window;
  globalThis.window = { confirm: () => true };
  t.after(() => {
    globalThis.window = oldWindow;
  });
  const job = { ...importJob("staged", 3), audienceId: "audience-one" };
  const view = {
    contacts: { job, transfer: { state: "not_started", canAdvance: true } },
  };
  const calls = [];
  let transferReads = 0;
  const page = createContacts({
    view: () => view,
    context: () => ({ resourceId: job.importId }),
    can: () => true,
    busy: () => false,
    changed: () => {},
    guard: () => {},
    api: async (path, body) => {
      calls.push({ path, body });
      if (body) throw new TypeError("Failed to fetch");
      if (path.endsWith("provider-sync") && ++transferReads === 1)
        return {
          transfer: {
            state: "in_progress",
            backgroundActive: true,
            canAdvance: false,
          },
        };
      return path.endsWith("provider-sync")
        ? {
            transfer: {
              state: "verified",
              canAdvance: false,
              partitions: [
                { partitionIndex: 0, verifiedCount: 1, contactCount: 1 },
              ],
            },
          }
        : { import: job };
    },
  });
  await page.action("transfer-start");
  assert.match(page.render(), /Checking list preparation/);
  assert.doesNotMatch(page.render(), /Failed to fetch/);
  await assert.rejects(page.action("transfer-start"), /Refresh/);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(view.contacts.transfer.state, "in_progress");
  assert.doesNotMatch(page.render(), /List ready with vendor/);
  t.mock.timers.tick(5000);
  await flush();
  assert.match(page.render(), /List ready with vendor/);
  assert.doesNotMatch(page.render(), /Checking list preparation/);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls.filter((c) => c.body).length, 1);
  assert.equal(calls.length, 5);
  page.dispose();
});

test("sending feedback remains pending until confirmation, then refreshes pilot limits and balance without another send", async () => {
  const listeners = new Map();
  globalThis.document = {
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  const campaign = {
    campaignId: "campaign-one",
    name: "Example campaign",
    canFetchQueue: true,
  };
  const calls = [];
  let releaseSend,
    sent = false;
  const page = createTextingWorkspacePage({
    context: () => ({
      organizationId: "org-one",
      userId: "admin",
      section: "send",
      resourceId: campaign.campaignId,
    }),
    changed: () => {},
    navigate: () => {},
    request: async (url, options) => {
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
      if (url.endsWith("/texter/ensure"))
        return { ok: true, texter: { state: "ready" } };
      if (url.endsWith("/queue"))
        return { ok: true, items: [item(), { ...item(), itemId: "item-two" }] };
      if (url.endsWith("/confirm"))
        return new Promise((resolve) => {
          releaseSend = () => {
            sent = true;
            resolve({
              ok: true,
              result: { itemId: "item-one", state: "confirmed" },
            });
          };
        });
      return { ok: true, campaign };
    },
  });
  const click = (action) => {
    const target = {
      disabled: false,
      dataset: { workspaceAction: action },
      closest: () => ({
        dataset: { workspaceKey: "admin:org-one:send:campaign-one" },
      }),
    };
    listeners.get("click")({ target: { closest: () => target } });
  };
  await page.load();
  click("queue-load");
  await flush();
  click("queue-confirm");
  await flush();
  assert.match(page.render(), /Sending…/);
  assert.doesNotMatch(
    page.render(),
    /Delivery needs review|needs review|Saving…/,
  );
  assert.match(
    page.render(),
    /data-workspace-action="queue-confirm"[^>]*disabled/,
  );
  click("queue-confirm");
  assert.equal(calls.filter((call) => call.url.endsWith("/confirm")).length, 1);
  releaseSend();
  await flush();
  assert.match(page.render(), /Message accepted/);
  assert.match(page.render(), /5 messages and \$0.465 remain/);
  assert.match(page.render(), /\$0.965/);
  assert.doesNotMatch(page.render(), /Delivery needs review|Sending…/);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/workspace")).length,
    2,
  );
  assert.equal(calls.filter((call) => call.url.endsWith("/confirm")).length, 1);
  page.reset();
});
