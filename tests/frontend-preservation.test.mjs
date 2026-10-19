import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyFrontendPreservation } from "../scripts/verify-frontend-preservation.mjs";
const entry = (path, content) => ({
  path,
  sha256: createHash("sha256").update(content).digest("hex"),
});

test("a clean-main rebuild cannot silently discard a separately shipped source overlay", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "polis-frontend-preservation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "frontend/src"), { recursive: true });
  await writeFile(join(root, "frontend/src/app.js"), "new setup entry");
  const baseline = {
    files: [
      entry("frontend/src/app.js", "old entry"),
      entry("frontend/src/ballot.js", "live ballot autosave"),
    ],
  };
  const reviewed = { files: [entry("frontend/src/app.js", "new setup entry")] };
  await assert.rejects(
    verifyFrontendPreservation({ root, baseline, reviewed }),
    /missing_frontend_input:frontend\/src\/ballot.js/,
  );
  await writeFile(join(root, "frontend/src/ballot.js"), "live ballot autosave");
  assert.equal(
    (await verifyFrontendPreservation({ root, baseline, reviewed })).passed,
    true,
  );
  await writeFile(join(root, "frontend/src/ballot.js"), "older ballot");
  await assert.rejects(
    verifyFrontendPreservation({ root, baseline, reviewed }),
    /unreviewed_frontend_change/,
  );
});

test("a manifest permits exact reviewed additions but rejects unreviewed build sources and unsafe paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "polis-frontend-preservation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "frontend/src"), { recursive: true });
  await writeFile(join(root, "frontend/src/app.js"), "live app");
  await writeFile(join(root, "frontend/src/setup.js"), "reviewed setup");
  const baseline = { files: [entry("frontend/src/app.js", "live app")] };
  const reviewed = {
    files: [entry("frontend/src/setup.js", "reviewed setup")],
  };
  assert.equal(
    (await verifyFrontendPreservation({ root, baseline, reviewed }))
      .verifiedFiles,
    2,
  );
  await writeFile(join(root, "frontend/src/unreviewed.js"), "unreviewed");
  await assert.rejects(
    verifyFrontendPreservation({ root, baseline, reviewed }),
    /unreviewed_frontend_addition/,
  );
  await assert.rejects(
    verifyFrontendPreservation({
      root,
      baseline,
      reviewed: { files: [entry("../outside", "bad")] },
    }),
    /invalid_frontend_manifest/,
  );
});
