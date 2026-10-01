import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const urls = new Map();
async function loadUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let source = await readFile(
    new URL(
      `../../frontend/src/pages/shared-feed/scripts/${name}.js`,
      import.meta.url,
    ),
    "utf8",
  );
  source = source.replace(/^import\s+"[^"\n]+\.css";\r?\n/gm, "");
  for (const match of [
    ...source.matchAll(/from "\.\/((?:texting|organization)\w+)"/g),
  ])
    source = source.replaceAll(match[0], `from "${await loadUrl(match[1])}"`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  urls.set(name, url);
  return url;
}
const { simpleContactFields, contactDistrictLabel, orderedContactTags } =
  await import(await loadUrl("organizationContactPresentation"));
const { loadContactCities } = await import(
  await loadUrl("organizationContactCities")
);
const { estimateContactCampaign } = await import(
  await loadUrl("textingCampaignEstimate")
);
const { createOrganizationContactBook } = await import(
  await loadUrl("organizationContactBook")
);
const { renderTextingShell } = await import(await loadUrl("textingShell"));
const { contactBookPermissionDefinitions } = await import(
  await loadUrl("organizationContactPermissions")
);
const { createCampaigns } = await import(await loadUrl("textingCampaigns"));

test("organization and candidate role saves retain every dedicated contact permission", async () => {
  const source = await readFile(
    new URL(
      "../../frontend/src/pages/shared-feed/shared-feed.js",
      import.meta.url,
    ),
    "utf8",
  );
  const keys = contactBookPermissionDefinitions.map((item) => item.key);
  for (const [prefix, normalize] of [
    ["CANDIDATE_STAFF", "normalizeCandidateStaffPermissionsForWrite"],
    ["COALITION_ASSIGNABLE", "normalizeCoalitionPermissionsForWrite"],
  ]) {
    const definitions = source.match(
      new RegExp(
        `const ${prefix}_PERMISSION_DEFINITIONS = \\[[\\s\\S]*?\\n\\];`,
      ),
    )[0];
    const fn = source.match(
      new RegExp(`function ${normalize}\\(value\\) \\{[\\s\\S]*?\\n\\}`),
    )[0];
    const output = runInNewContext(
      `${definitions}\nconst ${prefix}_PERMISSION_ORDER=${prefix}_PERMISSION_DEFINITIONS.map(item=>item.key);\n${fn}\n${normalize}(keys)`,
      {
        contactBookPermissionDefinitions,
        keys,
        normalizeCandidateDashboardPermissions: (v) => v,
        normalizeCoalitionPermissions: (v) => v,
      },
    );
    assert.deepEqual([...output], keys);
  }
});

test("expired unsent provider leases expose release guidance without Send or Skip actions", () => {
  const view = {
    campaigns: {
      campaign: { campaignId: "c", name: "Fictional outreach" },
      queue: {
        items: [
          {
            itemId: "i",
            state: "lease_expired",
            reclaimState: "provider_release_required",
            blockedReasons: [
              "prompt_queue_lease_expired",
              "provider_release_required",
            ],
          },
        ],
      },
    },
  };
  const controller = createCampaigns({
    view: () => view,
    context: () => ({ resourceId: "c" }),
    can: () => false,
    busy: () => false,
    billing: () => null,
    workspace: () => ({}),
    sendHeld: () => false,
  });
  const html = controller.render("send");
  assert.match(html, /Recipient assignment expired/);
  assert.match(html, /not been returned automatically/);
  assert.doesNotMatch(html, /data-workspace-action="queue-(confirm|skip)"/);
});

test("simple fields exclude map coordinates only, districts retain source values, tags use actual counts", () => {
  const fields = [
    "city",
    "country",
    "latitude",
    "longitude",
    "taxDistrict",
  ].map((fieldId) => ({ fieldId }));
  assert.deepEqual(
    simpleContactFields(fields).map((f) => f.fieldId),
    ["city", "taxDistrict"],
  );
  assert.equal(fields.length, 5);
  assert.equal(contactDistrictLabel("2", "MT"), "MT-02");
  assert.equal(contactDistrictLabel("02", "MT"), "MT-02");
  assert.equal(contactDistrictLabel("2", null), "2");
  assert.equal(contactDistrictLabel("MT-02", "MT"), "MT-02");
  assert.deepEqual(
    orderedContactTags([
      { label: "A", usageCount: 1 },
      { label: "B", usageCount: 12 },
    ]).map((t) => t.label),
    ["B", "A"],
  );
  assert.deepEqual(
    orderedContactTags([{ label: "B" }, { label: "A" }]).map((t) => t.label),
    ["A", "B"],
  );
});

test("city catalogs cache per state for 24h, authenticate transport and reject cancelled or malformed loads", async () => {
  let calls = 0,
    time = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(options.auth, true);
    return {
      state: new URL(url, "https://example.test").searchParams.get("state"),
      cities: ["Zeta", "Alpha"],
    };
  };
  const opts = { now: () => time };
  const first = await loadContactCities("MT", request, opts);
  first.push("Private mutation");
  assert.deepEqual(await loadContactCities("MT", request, opts), [
    "Alpha",
    "Zeta",
  ]);
  assert.equal(calls, 1);
  await loadContactCities("AZ", request, opts);
  assert.equal(calls, 2);
  time = 86400000;
  await loadContactCities("MT", request, opts);
  assert.equal(calls, 3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadContactCities("WY", request, { signal: controller.signal }),
    { name: "AbortError" },
  );
  await assert.rejects(
    loadContactCities("CO", async () => ({ state: "MT", cities: [] })),
    /could not be loaded/,
  );
});

test("campaign total uses frozen eligible count and segments, never page or selected count", () => {
  const billing = {
    rateStatus: "verified",
    smsUpToTwoSegmentsMicros: 35000,
    smsAdditionalSegmentMicros: 10000,
    mmsMicros: 80000,
  };
  const selection = { status: "ready", count: 500, eligibleCount: 321 };
  assert.equal(
    estimateContactCampaign(billing, selection, false, "hello").total,
    null,
  );
  assert.equal(
    estimateContactCampaign(billing, selection, true, "hello").total,
    321 * 35000,
  );
  assert.equal(
    estimateContactCampaign(billing, selection, true, "a".repeat(307)).total,
    321 * 45000,
  );
  assert.equal(
    estimateContactCampaign(billing, selection, true, "image", true).total,
    321 * 80000,
  );
  assert.equal(
    estimateContactCampaign({}, selection, true, "hello").total,
    null,
  );
  assert.equal(
    estimateContactCampaign(
      billing,
      { ...selection, eligibleCount: 0 },
      true,
      "hello",
    ).total,
    0,
  );
});

test("contact shell navigation requires an affirmative book grant", () => {
  const options = { organizationId: "org", content: "", section: "home" };
  assert.doesNotMatch(renderTextingShell(options), />Contacts</);
  assert.match(
    renderTextingShell({ ...options, readContactBook: true }),
    />Contacts</,
  );
});

test("a late city lookup cannot replace choices after changing the state", async () => {
  const view = {};
  const pending = [];
  const r = {
    view: () => view,
    busy: () => false,
    changed() {},
    guard() {},
    cities: (state, { signal }) =>
      new Promise((resolve) => pending.push({ state, signal, resolve })),
    contactApi: async (path) =>
      path === "/schema"
        ? {
            capabilities: { read: true },
            fields: [
              { fieldId: "state", label: "State", type: "text" },
              { fieldId: "city", label: "City", type: "text" },
            ],
          }
        : { items: [], complete: true, bookRevision: 1 },
  };
  const book = createOrganizationContactBook(r);
  await book.load();
  view.contactBook.query.filter = { field: "state", op: "eq", value: "MT" };
  book.localAction("book-overlay", "filters");
  book.change({
    dataset: { contactChange: "book-simple-value", fieldId: "state" },
    value: "AZ",
  });
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(["Phoenix"]);
  await new Promise(setImmediate);
  pending[0].resolve(["Billings"]);
  await new Promise(setImmediate);
  assert.deepEqual(view.contactBook.cities, ["Phoenix"]);
  book.dispose();
});

test("first contact view reads schema then query; saved metadata stays lazy and a default view is honored", async (t) => {
  for (const defaultId of [null, "default-one"]) {
    let view = {},
      calls = [];
    const r = {
      view: () => view,
      busy: () => false,
      guard() {},
      changed() {},
      contactApi: async (path) => {
        calls.push(path);
        if (path === "/schema")
          return {
            capabilities: { read: true },
            fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
            viewDefaults: { viewId: defaultId },
          };
        if (path.startsWith("/views/"))
          return {
            view: {
              name: "Default",
              columns: ["displayName"],
              filter: { field: "state", op: "eq", value: "MT" },
            },
          };
        if (path === "/query")
          return { items: [], complete: true, bookRevision: 1 };
        throw new Error(path);
      },
    };
    const controller = createOrganizationContactBook(r);
    await controller.load();
    assert.deepEqual(
      calls,
      defaultId
        ? ["/schema", "/views/default-one", "/query"]
        : ["/schema", "/query"],
    );
    if (defaultId) assert.equal(view.contactBook.query.filter.value, "MT");
    controller.dispose();
  }
  t.diagnostic(
    "Before: schema + views + audiences + query (4 requests minimum); after: schema + query (2), or schema + default view + query (3). Actual network latency remains environment-dependent.",
  );
});
