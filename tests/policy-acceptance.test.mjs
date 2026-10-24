import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const directory = new URL(
  "../frontend/src/pages/shared-feed/scripts/",
  import.meta.url,
);
const snapshot = await readFile(
  new URL("policySnapshot.js", directory),
  "utf8",
);
const snapshotUrl = `data:text/javascript;base64,${Buffer.from(snapshot).toString("base64")}`;
const source = (
  await readFile(new URL("policyAcceptance.js", directory), "utf8")
).replace('from "./policySnapshot.js"', `from "${snapshotUrl}"`);
const { createPolicyAcceptanceController, verifyPolicyManifest } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const { bundledPolicy } = await import(snapshotUrl);

test("complete policy snapshots are verified; stale or corrupted cached text is rejected", async () => {
  assert.equal(
    await verifyPolicyManifest(bundledPolicy, webcrypto),
    bundledPolicy,
  );
  for (const doc of bundledPolicy.documents)
    assert.doesNotMatch(doc.content, /<%|%>/);
  const bad = structuredClone(bundledPolicy);
  bad.documents[0].content += "modified";
  await assert.rejects(
    verifyPolicyManifest(bad, webcrypto),
    /could not be verified/,
  );
  assert.ok(
    bundledPolicy.documents
      .find((doc) => doc.id === "privacy")
      .content.includes("Google API Limited Use"),
  );
});
test("web agreement requires explicit checking and sends the exact active document hashes", async () => {
  const calls = [];
  const controller = createPolicyAcceptanceController({
    getUserId: () => "user-1",
    request: async (path, options) => {
      calls.push({ path, options });
      options?.beforeDispatch?.();
      return {
        ok: true,
        accepted: true,
        policySetVersion: bundledPolicy.policySetVersion,
      };
    },
  });
  await assert.rejects(
    controller.accept(bundledPolicy, "user-1", false),
    /checkbox/,
  );
  assert.equal(calls.length, 0);
  await controller.accept(bundledPolicy, "user-1", true);
  assert.equal(calls[0].path, "/api/me/policy-acceptance");
  assert.equal(calls[0].options.body.source, "web");
  assert.deepEqual(
    calls[0].options.body.documentHashes,
    Object.fromEntries(
      bundledPolicy.documents.map((doc) => [doc.id, doc.sha256]),
    ),
  );
});
test("account changes before dispatch or while saving cannot confirm another user's receipt", async () => {
  let user = "first",
    writes = 0;
  const controller = createPolicyAcceptanceController({
    getUserId: () => user,
    request: async (_, options) => {
      user = "second";
      options.beforeDispatch();
      writes++;
      return {
        ok: true,
        accepted: true,
        policySetVersion: bundledPolicy.policySetVersion,
      };
    },
  });
  await assert.rejects(
    controller.accept(bundledPolicy, "first", true),
    /account changed/,
  );
  assert.equal(writes, 0);
});
test("missing or wrong-version server receipt never grants agreement", async () => {
  const controller = createPolicyAcceptanceController({
    getUserId: () => "first",
    request: async () => ({
      ok: true,
      accepted: true,
      policySetVersion: "old",
    }),
  });
  await assert.rejects(
    controller.accept(bundledPolicy, "first", true),
    /not confirmed/,
  );
});
test("direct login and hosted/restored sessions invoke the shared review; writes keep guarded actor dispatch", async () => {
  const integration = await readFile(
    new URL(
      "../frontend/src/pages/shared-feed/shared-feed.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    integration,
    /async function finalizeAuthSuccess[\s\S]*?await policyAcceptance\.review\(\)/,
  );
  assert.match(
    integration,
    /async function bootstrapAuth[\s\S]*?await policyAcceptance\.review\(\)/,
  );
  assert.match(
    integration,
    /if \(typeof beforeDispatch === "function"\) beforeDispatch\(\)/,
  );
  assert.match(
    integration,
    /response\.status === 428 && payload\?\.error === "policy_acceptance_required"/,
  );
});
