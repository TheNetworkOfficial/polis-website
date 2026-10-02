import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const { createTextingBalancePage } = await import(
  await moduleUrl("textingBalance")
);
const tick = async () => {
  for (let i = 0; i < 5; i++)
    await new Promise((resolve) => setImmediate(resolve));
};

function harness({ capable = true, failVerify = false } = {}) {
  const events = {},
    calls = [];
  let actor = "admin",
    revision = 0,
    pending = null;
  const details = {
    name: "Organization finance",
    email: "finance@example.test",
    phone: "+12025550123",
  };
  globalThis.document = {
    activeElement: null,
    addEventListener: (name, fn) => {
      events[name] = fn;
    },
  };
  globalThis.requestAnimationFrame = () => {};
  globalThis.window = {
    location: {
      href: "https://example.test/organizations/org/texting-balance?section=billing-details",
    },
  };
  const contact = () => ({
    revision,
    details,
    status: pending
      ? pending.status === "pending_verification"
        ? pending.status
        : "needs_attention"
      : "ready",
    canEdit: !pending || pending.status === "pending_verification",
    pendingChange: pending,
  });
  const helper = createTextingBalancePage({
    context: () => ({ organizationId: "org", userId: actor }),
    changed() {},
    request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith("/workspace"))
        return {
          workspace: {
            scopeKey: "coalition:org",
            capabilities: { neutralWorkspaceApi: true },
          },
        };
      if (path.endsWith("/summary"))
        return {
          billing: {
            canManageBilling: true,
            canManageBillingContact: capable,
            currency: "usd",
            availableMicros: 500640000,
            reservedMicros: 360000,
            billingContactRevision: revision,
          },
        };
      if (path.includes("/transactions"))
        return { transactions: [], nextCursor: null };
      if (path.endsWith("/contact")) return { contact: contact() };
      if (path.endsWith("/contact/changes")) {
        const input = options.body;
        pending = {
          operationId: input.operationId,
          status: "pending_verification",
          emailMasked: "f***@example.test",
          expiresAtMs: Date.now() + 600000,
        };
        return { contact: contact() };
      }
      if (path.endsWith("/verify")) {
        if (failVerify) {
          pending.status = "needs_attention";
          failVerify = false;
          throw Object.assign(
            new Error("billing_contact_update_needs_attention"),
            { status: 503 },
          );
        }
        revision++;
        pending = null;
        return { contact: contact() };
      }
      assert.fail(`Unexpected endpoint: ${path}`);
    },
  });
  return {
    helper,
    calls,
    changeActor() {
      actor = "other";
    },
    input(name, value) {
      events.input({
        target: {
          matches: (selector) => selector === "[data-billing-contact-field]",
          dataset: { billingContactField: name },
          value,
        },
      });
    },
    async click(action) {
      events.click({
        target: {
          closest: () => ({
            dataset: { textingAction: action },
            disabled: false,
          }),
        },
      });
      await tick();
    },
  };
}

test("billing contact flow preserves visible credits and uses only contact metadata writes", async () => {
  const f = harness();
  await f.helper.load();
  assert.match(f.helper.render(), /Receipt email/);
  f.input("email", "finance@example.test");
  await f.click("contact-begin");
  assert.match(f.helper.render(), /Email confirmation code/);
  f.input("code", "12345678");
  await f.click("contact-verify");
  assert.match(f.helper.render(), /Billing details saved/);
  f.helper.show("balance");
  assert.match(f.helper.render(), /500\.64/);
  const writes = f.calls.filter((x) => x.options?.method === "POST");
  assert.equal(writes.length, 2);
  assert.ok(writes.every((x) => x.path.includes("/contact/changes")));
  assert.deepEqual(
    Object.keys(writes[0].options.body).sort(),
    ["email", "expectedRevision", "name", "operationId", "phone"].sort(),
  );
  assert.deepEqual(writes[1].options.body, { code: "12345678" });
  f.helper.reset();
});

test("uncertain billing contact save can be checked and retried with the same operation without a payment", async () => {
  const f = harness({ failVerify: true });
  await f.helper.load();
  await f.click("contact-begin");
  f.input("code", "12345678");
  await f.click("contact-verify");
  await f.click("contact-refresh");
  assert.match(f.helper.render(), /Finish update/);
  await f.click("contact-retry");
  const writes = f.calls.filter((x) => x.options?.method === "POST");
  assert.equal(writes[1].path, writes[2].path);
  assert.deepEqual(writes[2].options.body, { code: "" });
  assert.match(f.helper.render(), /Billing details saved/);
  f.helper.reset();
});

test("a hidden capability or changed account cannot expose or submit the billing editor", async () => {
  const f = harness({ capable: false });
  await f.helper.load();
  assert.doesNotMatch(f.helper.render(), /data-billing-contact-field/);
  await f.click("contact-begin");
  assert.equal(f.calls.filter((x) => x.options?.method === "POST").length, 0);
  f.helper.reset();
  const g = harness();
  await g.helper.load();
  g.changeActor();
  assert.doesNotMatch(g.helper.render(), /finance@example/);
  await g.click("contact-begin");
  assert.equal(g.calls.filter((x) => x.options?.method === "POST").length, 0);
  g.helper.reset();
});
