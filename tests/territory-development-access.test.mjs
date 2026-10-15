import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../frontend/src/pages/shared-feed/scripts/territoryDevelopmentAccess.js",
    import.meta.url,
  ),
  "utf8",
);
const { createTerritoryDevelopmentAccess, visibleTerritorySections } =
  await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
const scope = { scopeType: "coalition", scopeId: "fixture" };
const capability = (value = true) => ({
  ok: true,
  access: { capabilities: { territoryDevelopmentAccess: value } },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture(enabled = true) {
  let context = {
    userId: "actor-a",
    session: {},
    location: "/coalitions/fixture/voter-map",
  };
  const gate = createTerritoryDevelopmentAccess({
    enabled,
    context: () => context,
  });
  return {
    gate,
    set: (next) => {
      context = { ...context, ...next };
    },
  };
}

test("ordinary owner/admin roles never imply a development grant", async () => {
  const { gate } = fixture();
  await gate.read(scope, async () => ({
    ok: true,
    isOwner: true,
    isAdmin: true,
    canManageTerritories: true,
  }));
  assert.equal(gate.allowed(scope), false);
});

for (const value of [undefined, false, "true", 1, {}, []]) {
  test(`server development capability must be boolean true: ${JSON.stringify(value)}`, async () => {
    const { gate } = fixture();
    await gate.read(scope, async () => ({
      ok: true,
      access: { capabilities: { territoryDevelopmentAccess: value } },
    }));
    assert.equal(gate.allowed(scope), false);
  });
}

test("an explicit development build and successful capability read are both required", async () => {
  const disabled = fixture(false).gate;
  await disabled.read(scope, async () => capability());
  assert.equal(disabled.allowed(scope), false);
  const { gate } = fixture();
  assert.equal(gate.allowed(scope), false);
  await gate.read(scope, async () => capability());
  assert.equal(gate.allowed(scope), true);
  assert.equal(gate.allowed({ ...scope, scopeId: "other" }), false);
  assert.equal(gate.allowed({ ...scope, scopeType: "candidate" }), false);
});

test("an error envelope carrying a capability does not enable the tool", async () => {
  const { gate } = fixture();
  await gate.read(scope, async () => ({ ...capability(), ok: false }));
  assert.equal(gate.allowed(scope), false);
  await gate.read(scope, async () => ({
    capabilities: { territoryDevelopmentAccess: true },
  }));
  assert.equal(gate.allowed(scope), false);
});

test("refresh immediately removes a prior grant and failure keeps it absent", async () => {
  const { gate } = fixture();
  await gate.read(scope, async () => capability());
  const pending = deferred(),
    read = gate.read(scope, () => pending.promise);
  assert.equal(gate.allowed(scope), false);
  pending.reject(new Error("unavailable"));
  await assert.rejects(read, /unavailable/);
  assert.equal(gate.allowed(scope), false);
});

test("late success cannot restore access after the actor switches", async () => {
  const { gate, set } = fixture(),
    pending = deferred();
  const read = gate.read(scope, () => pending.promise);
  set({ userId: "actor-b", session: {} });
  pending.resolve(capability());
  await read;
  assert.equal(gate.allowed(scope), false);
});

test("renewed sessions and signout invalidate the old grant even for the same account", async () => {
  const { gate, set } = fixture();
  await gate.read(scope, async () => capability());
  set({ session: {} });
  assert.equal(gate.allowed(scope), false);
  await gate.read(scope, async () => capability());
  set({ userId: "", session: null });
  assert.equal(gate.allowed(scope), false);
});

test("navigation and history return cannot reopen a stored plan using an old grant", async () => {
  const { gate, set } = fixture();
  await gate.read(scope, async () => capability());
  set({ location: "/coalitions/other/voter-map" });
  assert.equal(gate.allowed(scope), false);
  set({ location: "/coalitions/fixture/voter-map" });
  assert.equal(gate.allowed(scope), false);
});

test("reverse completion cannot replace the newer server decision", async () => {
  const { gate } = fixture(),
    first = deferred(),
    second = deferred();
  const a = gate.read(scope, () => first.promise),
    b = gate.read(scope, () => second.promise);
  second.resolve(capability(false));
  await b;
  first.resolve(capability());
  await a;
  assert.equal(gate.allowed(scope), false);
});

test("a stale failure cannot revoke a newer successful read", async () => {
  const { gate } = fixture(),
    first = deferred();
  const a = gate.read(scope, () => first.promise);
  await gate.read(scope, async () => capability());
  first.reject(new Error("old failure"));
  await assert.rejects(a, /old failure/);
  assert.equal(gate.allowed(scope), true);
});

test("field map and assigned territory sections remain visible when management is hidden", () => {
  const rows = [
    { key: "map" },
    { key: "assigned" },
    { key: "territories/admin" },
    { key: "notes" },
  ];
  assert.deepEqual(
    visibleTerritorySections(rows, false).map((row) => row.key),
    ["map", "assigned", "notes"],
  );
  assert.deepEqual(visibleTerritorySections(rows, true), rows);
});

for (const [mode, optIn, expected] of [
  ["production", "true", false],
  ["development", "false", false],
  ["development", "true", true],
]) {
  test(`compiled opt-in default for ${mode}/${optIn}`, async () => {
    const compiled = source
      .replaceAll("process.env.NODE_ENV", JSON.stringify(mode))
      .replaceAll(
        "process.env.POLIS_TERRITORY_DEVELOPMENT_ENABLED",
        JSON.stringify(optIn),
      );
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
    );
    assert.equal(module.territoryDevelopmentBuildEnabled, expected);
  });
}
