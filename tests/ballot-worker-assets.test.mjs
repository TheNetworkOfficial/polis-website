import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { inspectBallotWorkerAssets, verifyStagedBallotWorkerAssets } =
  createRequire(import.meta.url)("../scripts/ballot-worker-assets.cjs");

function fixture(t) {
  const dir = fs.mkdtempSync(
    path.join(path.resolve(".cache"), "ballot-worker-"),
  );
  t.after(() => fs.rmSync(dir, { recursive: true }));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(
    path.join(dir, "scripts/shared-feed.js"),
    'var e={u:e=>e+".js"};new Worker(new URL(e.p+e.u(570),e.b))',
  );
  fs.writeFileSync(
    path.join(dir, "570.js"),
    'self.onmessage=()=>self.postMessage({type:"result"});',
  );
  fs.writeFileSync(path.join(dir, "570.js.LICENSE.txt"), "Test license");
  return dir;
}

fs.mkdirSync(path.resolve(".cache"), { recursive: true });

test("inventory includes exact worker and license, and validates a complete staged release", (t) => {
  const dir = fixture(t);
  const inventory = inspectBallotWorkerAssets(dir);
  assert.deepEqual(
    inventory.files.map((file) => file.path),
    ["/570.js", "/570.js.LICENSE.txt"],
  );
  assert.equal(verifyStagedBallotWorkerAssets(inventory, dir), true);
});

test("missing worker or license blocks preparation", (t) => {
  for (const file of ["570.js", "570.js.LICENSE.txt"]) {
    const dir = fixture(t);
    fs.unlinkSync(path.join(dir, file));
    assert.throws(
      () => inspectBallotWorkerAssets(dir),
      /ballot_worker_asset_missing/,
    );
  }
});

test("HTML, changed linker, and multiple workers require review", (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "570.js"), "<!doctype html>");
  assert.throws(
    () => inspectBallotWorkerAssets(dir),
    /ballot_worker_asset_invalid/,
  );
  const bundle = path.join(dir, "scripts/shared-feed.js");
  fs.writeFileSync(bundle, 'new Worker("/changed.js")');
  assert.throws(() => inspectBallotWorkerAssets(dir), /linker_requires_review/);
  fs.writeFileSync(
    bundle,
    'var e={u:e=>e+".js"};new Worker(new URL(e.p+e.u(570),e.b));new Worker(new URL(e.p+e.u(571),e.b))',
  );
  assert.throws(() => inspectBallotWorkerAssets(dir), /linker_requires_review/);
});

test("missing or changed staged assets cannot pass with a valid local inventory", (t) => {
  const dir = fixture(t);
  const inventory = inspectBallotWorkerAssets(dir);
  fs.writeFileSync(path.join(dir, "570.js"), "self.onmessage=()=>{};");
  assert.throws(
    () => verifyStagedBallotWorkerAssets(inventory, dir),
    /stage_changed/,
  );
  fs.unlinkSync(path.join(dir, "570.js"));
  assert.throws(
    () => verifyStagedBallotWorkerAssets(inventory, dir),
    /stage_missing/,
  );
});
