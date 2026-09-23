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
const { uploadContactFile } = await import(await moduleUrl("textingContacts"));
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
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
    refreshBilling: async () => {},
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
    refreshBilling: async () => {},
    armExpiry: () => {},
    toast: () => {},
  };
  await createCampaigns(r).action("queue-confirm");
  assert.equal(calls.length, 1);
  assert.equal(state.campaigns.queue.items[0].itemId, "item-two");
  assert.equal(state.campaigns.sent, 1);
});
