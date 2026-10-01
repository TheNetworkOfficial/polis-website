import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const urls = new Map();
async function moduleUrl(name) {
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
    source = source.replaceAll(match[0], `from "${await moduleUrl(match[1])}"`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  urls.set(name, url);
  return url;
}
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);

async function harness(t) {
  const originalDocument = globalThis.document;
  const listeners = new Map(),
    calls = [],
    navigation = [];
  globalThis.document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    querySelector: () => null,
  };
  let context = {
    userId: "admin",
    organizationId: "org-one",
    section: "contacts",
  };
  let allowed = true,
    denied = false;
  const row = {
    contactId: "contact-one",
    fields: { displayName: "Fictional Person" },
    tags: [],
    eligibility: { status: "eligible" },
  };
  const page = createTextingWorkspacePage({
    context: () => context,
    changed: () => {},
    navigate: (...route) => navigation.push(route),
    request: async (url, options = {}) => {
      calls.push({ url, ...options });
      if (url.endsWith("/workspace")) {
        if (denied)
          throw Object.assign(new Error("Access changed"), { status: 403 });
        return {
          ok: true,
          workspace: {
            provider: "prompt",
            manualOnly: true,
            scopeKey: `coalition:${context.organizationId}`,
            status: "configured",
            capabilities: { createCampaigns: allowed, manageBilling: true },
          },
        };
      }
      if (url.endsWith("/billing/summary"))
        return { ok: true, billing: { canManageBilling: true } };
      if (url.endsWith("/delivery-schedule"))
        return { ok: true, schedule: { status: "verified" } };
      if (url.endsWith("/schema"))
        return {
          ok: true,
          fields: [{ fieldId: "displayName", label: "Name", type: "text" }],
          tags: [],
          capabilities: { read: true, select: true },
        };
      if (url.endsWith("/query"))
        return { ok: true, items: [row], bookRevision: 1, complete: true };
      if (url.endsWith("/selections"))
        return {
          ok: true,
          selection: {
            selectionId: "selection-one",
            status: "ready",
            count: 1,
            eligibleCount: 1,
          },
        };
      if (url.endsWith("/selections/selection-one/contacts"))
        return { ok: true, items: [row] };
      if (/\/(?:views|audiences)$/.test(url)) return { ok: true, items: [] };
      throw new Error(`Unexpected test route: ${url}`);
    },
  });
  t.after(() => {
    page.reset();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const owned = () => ({
    dataset: {
      workspaceKey: `${context.userId}:${context.organizationId}:${context.section || "home"}:${context.resourceId || ""}`,
    },
  });
  await page.load();
  listeners.get("change")({
    target: {
      dataset: { contactChange: "book-row", contactId: row.contactId },
      checked: true,
      closest: (selector) =>
        selector === "[data-workspace-key]" ? owned() : null,
    },
  });
  const target = {
    dataset: { workspaceAction: "book-campaign-start" },
    closest: (selector) =>
      selector === "[data-workspace-key]" ? owned() : target,
  };
  listeners.get("click")({ target });
  await new Promise(setImmediate);
  assert.deepEqual(navigation, [["campaigns", "new"]]);
  assert.equal(
    calls.filter(
      (call) => call.method === "POST" && !call.url.endsWith("/query"),
    ).length,
    0,
  );
  return {
    page,
    calls,
    route: (patch) => {
      context = { ...context, ...patch };
    },
    allow: (value) => {
      allowed = value;
    },
    deny: (value) => {
      denied = value;
    },
  };
}

test("book handoff builds a local selection once and requires review without provider or campaign writes", async (t) => {
  const h = await harness(t);
  h.route({ section: "campaigns", resourceId: "new" });
  await h.page.load();
  const selection = h.calls.find((call) => call.url.endsWith("/selections"));
  assert.deepEqual(selection.body.includeIds, ["contact-one"]);
  assert.match(h.page.render(), /Review selection/);
  assert.doesNotMatch(
    h.page.render(),
    /data-contact-change="recipients-reviewed" checked/,
  );
  assert.equal(
    h.calls.filter(
      (call) => call.url.includes("/text-banking/") && call.method === "POST",
    ).length,
    0,
  );
  await h.page.load({ force: true });
  assert.equal(
    h.calls.filter((call) => call.url.endsWith("/selections")).length,
    1,
  );
});

for (const change of ["organization", "user", "permission", "denied"])
  test(`pending campaign selection is discarded after ${change} changes`, async (t) => {
    const h = await harness(t);
    if (change === "organization") h.route({ organizationId: "org-two" });
    else if (change === "user") h.route({ userId: "other-admin" });
    else {
      h.route({ section: "campaigns", resourceId: "new" });
      if (change === "permission") h.allow(false);
      else h.deny(true);
    }
    await h.page.load();
    h.allow(true);
    h.deny(false);
    h.route({
      organizationId: "org-one",
      userId: "admin",
      section: "campaigns",
      resourceId: "new",
    });
    await h.page.load({ force: true });
    assert.equal(
      h.calls.filter((call) => call.url.endsWith("/selections")).length,
      0,
    );
    assert.equal(
      h.calls.filter(
        (call) => call.url.includes("/text-banking/") && call.method === "POST",
      ).length,
      0,
    );
  });
