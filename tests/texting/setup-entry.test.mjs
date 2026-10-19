import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const {
  createTextingSetupEntry,
  textingSetupEntryState,
  renderTextingSetupEntry,
} = await import(await moduleUrl("textingSetupEntry"));
const { createTextingShellAccess, renderTextingShell } = await import(
  await moduleUrl("textingShell")
);
const discovery = (state = "enabled") => ({
  setupAvailability: { state, supportedWorkflowTypes: ["contact_book_single"] },
  capabilities: {
    isolatedSetup: true,
    createSetup: state === "enabled",
    manageBilling: true,
  },
  setups: [],
  nextCursor: null,
});
const navigation = (html) =>
  JSON.parse(/data-value="([^"]+)"/.exec(html)[1].replaceAll("&quot;", '"'));

test("only explicit supported admitted creation makes New campaign use guided setup", () => {
  const entry = textingSetupEntryState(discovery());
  assert.equal(entry.canCreate, true);
  assert.deepEqual(navigation(renderTextingSetupEntry(entry).action), [
    "setup",
    "new",
  ]);
  for (const state of ["paused", "unavailable", "unsupported"])
    assert.equal(textingSetupEntryState(discovery(state)).canCreate, false);
  for (const malformed of [
    undefined,
    {},
    {
      setupAvailability: {
        state: "enabled",
        supportedWorkflowTypes: "contact_book_single",
      },
    },
    {
      ...discovery(),
      capabilities: {
        isolatedSetup: true,
        createSetup: true,
        manageBilling: false,
      },
    },
  ])
    assert.equal(textingSetupEntryState(malformed).canCreate, false);
});

test("paused and unavailable entry retain saved/status paths instead of silently creating via legacy", () => {
  for (const state of ["paused", "unavailable"]) {
    const ui = renderTextingSetupEntry(
      textingSetupEntryState(discovery(state)),
    );
    assert.match(ui.action, /Check campaign setup/);
    assert.match(ui.content, /Saved campaign setups/);
    assert.doesNotMatch(ui.action + ui.content, /Other campaign types/);
  }
  const unsupported = renderTextingSetupEntry(
    textingSetupEntryState(discovery("unsupported")),
  );
  assert.match(unsupported.action, /Other campaign types/);
  assert.deepEqual(navigation(unsupported.action), ["campaigns", "new"]);
});

test("discovery is read-only, route/actor fenced, and never requested by a sender or existing campaign", async () => {
  let context = {
    userId: "manager",
    organizationId: "org",
    section: "send",
    resourceId: "active",
  };
  const calls = [];
  let resolve;
  const entry = createTextingSetupEntry({
    context: () => context,
    changed() {},
    request: async (path, options) => {
      calls.push({ path, options });
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  await entry.load();
  context = { ...context, section: "campaigns" };
  await entry.load();
  assert.equal(calls.length, 0);
  context = { ...context, resourceId: "", scopeType: "candidate" };
  await entry.load();
  assert.equal(calls.length, 0);
  context = { ...context, scopeType: "coalition" };
  context = { ...context, resourceId: "" };
  const pending = entry.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.body, undefined);
  context = { ...context, userId: "another-manager" };
  assert.throws(calls[0].options.beforeRequest, /context_changed/);
  resolve(discovery());
  await pending;
  assert.equal(entry.getState().canCreate, undefined);
});

test("failed discovery produces visible status without changing legacy API or operation identity", async () => {
  const paths = [];
  const entry = createTextingSetupEntry({
    context: () => ({
      userId: "manager",
      organizationId: "org",
      section: "campaigns",
    }),
    changed() {},
    request: async (path) => {
      paths.push(path);
      throw new Error("unavailable");
    },
  });
  await entry.load();
  assert.equal(entry.getState().state, "unavailable");
  assert.deepEqual(paths, ["/api/texting/setup/coalition/org"]);
});

test("authorized campaign managers see Saved setups navigation after admission pauses; volunteers do not", () => {
  const access = createTextingShellAccess();
  const manager = access.read({
    userId: "manager",
    organizationId: "org",
    authorizationStatus: "ready",
    capabilities: { createCampaigns: true },
  });
  assert.equal(manager.setup, true);
  assert.match(
    renderTextingShell({
      organizationId: "org",
      section: "campaigns",
      setupAvailable: manager.setup,
      content: "",
    }),
    /Saved setups/,
  );
  const volunteer = access.read({
    userId: "volunteer",
    organizationId: "org",
    authorizationStatus: "ready",
    capabilities: { manualQueue: true },
  });
  assert.equal(volunteer.setup, false);
  assert.doesNotMatch(
    renderTextingShell({
      organizationId: "org",
      section: "send",
      setupAvailable: volunteer.setup,
      content: "",
    }),
    /Saved setups/,
  );
});
