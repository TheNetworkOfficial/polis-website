import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createTextingShellAccess } = await import(
  await moduleUrl("textingShell")
);

test("navigation permissions survive pending same-actor tabs only", () => {
  const access = createTextingShellAccess();
  const identity = { userId: "admin", organizationId: "org-one" };
  assert.deepEqual(
    access.read({ ...identity, authorizationStatus: "pending" }),
    {},
  );
  assert.equal(
    access.read({
      ...identity,
      authorizationStatus: "ready",
      capabilities: { readContactBook: true },
    }).readContactBook,
    true,
  );
  assert.equal(
    access.read({
      ...identity,
      authorizationStatus: "pending",
      capabilities: { readContactBook: false },
    }).readContactBook,
    true,
  );
  assert.deepEqual(
    access.read({
      ...identity,
      organizationId: "org-two",
      authorizationStatus: "pending",
    }),
    {},
  );
  assert.deepEqual(
    access.read({ ...identity, authorizationStatus: "pending" }),
    {},
  );
});

test("denial, explicit changed permission, logout and account changes discard navigation snapshot", () => {
  const access = createTextingShellAccess();
  const identity = { userId: "admin", organizationId: "org-one" };
  const grant = () =>
    access.read({
      ...identity,
      authorizationStatus: "ready",
      capabilities: { readContactBook: true, manageBilling: true },
    });
  grant();
  assert.deepEqual(
    access.read({ ...identity, authorizationStatus: "denied" }),
    {},
  );
  assert.deepEqual(
    access.read({ ...identity, authorizationStatus: "pending" }),
    {},
  );
  grant();
  assert.equal(
    access.read({
      ...identity,
      authorizationStatus: "ready",
      capabilities: { readContactBook: false },
    }).readContactBook,
    false,
  );
  grant();
  access.reset();
  assert.deepEqual(
    access.read({ ...identity, authorizationStatus: "pending" }),
    {},
  );
  grant();
  assert.deepEqual(
    access.read({
      ...identity,
      userId: "other",
      authorizationStatus: "pending",
    }),
    {},
  );
  grant();
  assert.deepEqual(
    access.read({ ...identity, userId: "", authorizationStatus: "pending" }),
    {},
  );
});
