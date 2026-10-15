import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createTextingQueueSession } = await import(
  await moduleUrl("textingQueueSession")
);
const { createTextingExitRequest } = await import(
  await moduleUrl("textingSession")
);
const { createTextingWorkspacePage } = await import(
  await moduleUrl("textingWorkspace")
);
const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";
const requestA = "33333333-3333-4333-8333-333333333333";
const requestB = "44444444-4444-4444-8444-444444444444";
const sessionC = "55555555-5555-4555-8555-555555555555";
const actor = { userId: "volunteer", organizationId: "org-one" };
const assignment = (sessionId = sessionA) => ({
  campaignId: "previous-campaign",
  allocationId: "exact-allocation-token",
  sessionId,
  assignmentExpiresAtMs: Date.now() + 3600000,
  canReleaseUnused: true,
});

test("exit freezes the owning campaign, scope, allocation and session and dispatches once", () => {
  const calls = [],
    ids = [sessionA, requestA, sessionB];
  const owner = createTextingQueueSession({
    makeId: () => ids.shift(),
    requestExit: (path, options) => {
      calls.push({ path, options });
      return Promise.resolve({ ok: true, release: { state: "released" } });
    },
  });
  const dto = assignment();
  assert.equal(owner.observe(dto, actor), true);
  dto.campaignId = "new-campaign-on-screen";
  dto.allocationId = "modified-token";
  assert.equal(owner.release(), true);
  assert.equal(owner.release(), false);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].path,
    "/api/text-banking/prompt/scopes/coalition%3Aorg-one/campaigns/previous-campaign/queue/release",
  );
  assert.deepEqual(calls[0].options, {
    expectedUserId: "volunteer",
    body: {
      allocationId: "exact-allocation-token",
      sessionId: sessionA,
      requestId: requestA,
      reason: "exit",
    },
  });
  assert.equal(owner.sessionId, sessionB);
  assert.doesNotMatch(
    JSON.stringify(calls),
    /humanConfirmation|contactPhone|skip|confirm|Bearer/,
  );
});

test("resume rotates session ownership even when the same allocation is offered again", () => {
  const calls = [],
    ids = [sessionA, requestA, sessionB, requestB, sessionC];
  const owner = createTextingQueueSession({
    makeId: () => ids.shift(),
    requestExit: (path, options) => {
      calls.push(options.body);
    },
  });
  owner.observe(assignment(), actor);
  owner.release();
  assert.equal(
    owner.observe(assignment(sessionA), actor),
    false,
    "Late metadata from the exited session cannot adopt its old receipts",
  );
  assert.equal(
    owner.observe(assignment(sessionB), { ...actor, neutralApi: true }),
    true,
  );
  owner.release();
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.sessionId),
    [sessionA, sessionB],
  );
  assert.deepEqual(
    calls.map((c) => c.requestId),
    [requestA, requestB],
  );
  assert.equal(calls[0].allocationId, calls[1].allocationId);
});

test("legacy, foreign-session and nonreleasable assignments never dispatch exit writes", () => {
  for (const dto of [
    null,
    { ...assignment(), sessionId: null },
    assignment(sessionB),
    { ...assignment(), canReleaseUnused: false },
    { ...assignment(), campaignId: "../another-campaign" },
    { ...assignment(), allocationId: "" },
  ]) {
    const owner = createTextingQueueSession({
      makeId: () => sessionA,
      requestExit: () => assert.fail("No inferred release is permitted"),
    });
    assert.equal(owner.observe(dto, actor), false);
    assert.equal(owner.release(), false);
  }
});

test("failed exit transport is best effort and cannot clear holds or replay a mutation", async () => {
  const holds = new Set(["pending-item", "uncertain-item"]);
  let calls = 0;
  const owner = createTextingQueueSession({
    makeId: () => sessionA,
    requestExit: () => {
      calls++;
      return Promise.reject(new TypeError("Connection closed"));
    },
  });
  owner.observe(assignment(), actor);
  owner.release();
  await Promise.resolve();
  owner.release();
  assert.equal(calls, 1);
  assert.deepEqual([...holds], ["pending-item", "uncertain-item"]);
});

test("exit before allocation response releases only its exact late session and never adopts previews", () => {
  const calls = [],
    ids = [sessionA, sessionB, requestA];
  const owner = createTextingQueueSession({
    makeId: () => ids.shift(),
    requestExit: (path, options) => {
      calls.push({ path, options });
    },
  });
  const ticket = owner.beginAllocation(actor);
  assert.equal(owner.release(), true);
  owner.forget();
  assert.equal(owner.sessionId, sessionB);
  owner.completeAllocation(ticket, assignment(sessionA));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.sessionId, sessionA);
  assert.equal(calls[0].options.body.allocationId, "exact-allocation-token");
  assert.equal(
    owner.release(),
    false,
    "No late preview became the active assignment",
  );
  owner.completeAllocation(ticket, assignment(sessionA));
  assert.equal(calls.length, 1);
});

test("a foreign or unverified late allocation response cannot issue a release", () => {
  for (const dto of [
    null,
    assignment(sessionB),
    { ...assignment(), canReleaseUnused: false },
  ]) {
    const ids = [sessionA, sessionB];
    const owner = createTextingQueueSession({
      makeId: () => ids.shift(),
      requestExit: () =>
        assert.fail("No release from unrelated or unverified response"),
    });
    const ticket = owner.beginAllocation(actor);
    owner.release();
    owner.completeAllocation(ticket, dto);
    assert.equal(owner.release(), false);
  }
});

test("exit uses current valid authentication synchronously with keepalive", () => {
  const calls = [];
  let session = { userId: "volunteer", expiresAt: Date.now() + 60000 };
  const request = createTextingExitRequest({
    getSession: () => session,
    userId: (s) => s?.userId,
    request: (path, options) => {
      calls.push({ path, options });
      return Promise.resolve({ ok: true });
    },
  });
  const path =
    "/api/text-banking/workspaces/coalition%3Aorg-one/campaigns/previous-campaign/queue/release";
  const body = {
    allocationId: "exact-allocation-token",
    sessionId: sessionA,
    requestId: requestA,
    reason: "exit",
  };
  request(path, { expectedUserId: "volunteer", body });
  assert.deepEqual(calls, [
    { path, options: { auth: true, method: "POST", keepalive: true, body } },
  ]);
  session = { userId: "other-volunteer", expiresAt: Date.now() + 60000 };
  assert.throws(() => request(path, { expectedUserId: "volunteer", body }));
  session = { userId: "volunteer", expiresAt: Date.now() - 1 };
  assert.throws(() => request(path, { expectedUserId: "volunteer", body }));
  session.expiresAt = Date.now() + 60000;
  assert.throws(() =>
    request(path.replace("release", "confirm"), {
      expectedUserId: "volunteer",
      body,
    }),
  );
  assert.equal(calls.length, 1);
});

function workspaceFixture({ delayAllocation = false } = {}) {
  const listeners = new Map(),
    calls = [],
    exits = [],
    saved = new Map();
  globalThis.document = {
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  globalThis.sessionStorage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  let context = { ...actor, section: "send", resourceId: "previous-campaign" };
  let finishAllocation;
  const campaign = () => ({
    campaignId: context.resourceId,
    name: "Example campaign",
    canFetchQueue: true,
  });
  const page = createTextingWorkspacePage({
    context: () => context,
    changed: () => {},
    navigate: () => {},
    requestExit: (path, options) => {
      exits.push({ path, options });
      return Promise.resolve({ ok: true });
    },
    request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith("/workspace"))
        return {
          ok: true,
          workspace: {
            provider: "prompt",
            scopeKey: "coalition:org-one",
            manualOnly: true,
            status: "configured",
            canSend: true,
            capabilities: { manualQueue: true, queueRelease: true },
          },
        };
      if (path.endsWith("/summary"))
        return {
          ok: true,
          billing: { canManageBilling: false, sendingBlocked: false },
        };
      if (path.endsWith("/queue")) {
        const result = {
          ok: true,
          queueSession: {
            ...assignment(options.body.sessionId),
            campaignId: context.resourceId,
          },
          items: [
            {
              itemId: "item-one",
              state: "awaiting_confirmation",
              expiresAtMs: Date.now() + 60000,
              humanConfirmation: { recordId: "exact-proof" },
              preview: {
                contactPhone: "+12025550124",
                message: "Hello. Reply STOP to opt out.",
              },
            },
          ],
        };
        if (delayAllocation)
          return new Promise((resolve) => {
            finishAllocation = () => resolve(result);
          });
        return result;
      }
      return { ok: true, campaign: campaign() };
    },
  });
  return {
    page,
    calls,
    exits,
    finishAllocation: () => finishAllocation(),
    setContext: (next) => {
      context = next;
    },
    click: (action) => {
      const target = {
        disabled: false,
        dataset: { workspaceAction: action },
        closest: () => ({
          dataset: {
            workspaceKey: `${context.userId}:${context.organizationId}:${context.section}:${context.resourceId}`,
          },
        }),
      };
      listeners.get("click")({ target: { closest: () => target } });
    },
  };
}
const drain = () => new Promise((resolve) => setImmediate(resolve));

test("internal campaign navigation retains the owner and workspace exit releases its exact batch", async () => {
  const f = workspaceFixture();
  await f.page.load();
  f.click("queue-load");
  await drain();
  const allocation = f.calls.find((c) => c.path.endsWith("/queue"));
  assert.match(allocation.options.body.sessionId, /^[0-9a-f-]{36}$/i);
  f.setContext({ ...actor, section: "send", resourceId: "different-campaign" });
  await f.page.load();
  assert.equal(f.exits.length, 0);
  f.setContext(null);
  f.page.reset();
  assert.equal(f.exits.length, 1);
  assert.match(f.exits[0].path, /\/previous-campaign\/queue\/release$/);
  assert.equal(
    f.exits[0].options.body.sessionId,
    allocation.options.body.sessionId,
  );
  assert.equal(f.exits[0].options.body.allocationId, "exact-allocation-token");
  f.page.reset();
  assert.equal(f.exits.length, 1);
  assert.equal(
    f.calls.filter((c) => c.options.method).length,
    1,
    "Only the explicit queue request was dispatched through normal workspace transport",
  );
});

test("background exit invalidates the old previews; resume reads only and next explicit allocation has a new session", async () => {
  const f = workspaceFixture();
  await f.page.load();
  f.click("queue-load");
  await drain();
  const first = f.calls.find((c) => c.path.endsWith("/queue"));
  f.page.exit();
  f.page.exit();
  assert.equal(f.exits.length, 1);
  f.click("queue-load");
  await drain();
  assert.equal(f.calls.filter((c) => c.path.endsWith("/queue")).length, 1);
  await f.page.refresh();
  assert.equal(
    f.calls.filter((c) => c.path.endsWith("/queue")).length,
    1,
    "Resume must not allocate or send automatically",
  );
  f.click("queue-load");
  await drain();
  const queues = f.calls.filter((c) => c.path.endsWith("/queue"));
  assert.equal(queues.length, 2);
  assert.notEqual(
    queues[1].options.body.sessionId,
    first.options.body.sessionId,
  );
  f.page.reset();
  assert.equal(f.exits.length, 2);
});

test("a queue POST completing after SPA exit releases its late token before the old-route response is rejected", async () => {
  const f = workspaceFixture({ delayAllocation: true });
  await f.page.load();
  f.click("queue-load");
  await drain();
  const allocation = f.calls.find((c) => c.path.endsWith("/queue"));
  assert.ok(allocation);
  f.setContext(null);
  f.page.reset();
  assert.equal(
    f.exits.length,
    0,
    "No token may be invented while allocation is pending",
  );
  f.finishAllocation();
  await drain();
  assert.equal(f.exits.length, 1);
  assert.equal(
    f.exits[0].options.body.sessionId,
    allocation.options.body.sessionId,
  );
  assert.equal(f.exits[0].options.body.allocationId, "exact-allocation-token");
  assert.match(f.exits[0].path, /\/previous-campaign\/queue\/release$/);
  assert.equal(f.calls.filter((c) => c.path.endsWith("/queue")).length, 1);
  assert.doesNotMatch(f.page.render(), /Example campaign|Send to/);
});
