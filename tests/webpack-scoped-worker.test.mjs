import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function inspectOutput(prefix) {
  return spawnSync(
    process.execPath,
    [
      "-e",
      'const webpack=require("webpack");const c=require("./frontend/webpack.config.js");webpack.validate(c);console.log(JSON.stringify(c.output));',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, POLIS_WEB_WORKER_PUBLIC_PATH: prefix },
      encoding: "utf8",
    },
  );
}

test("default Webpack worker path remains unchanged", () => {
  const result = inspectOutput("");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(Object.hasOwn(output, "workerPublicPath"), false);
});

test("Webpack accepts the cohort worker prefix and rejects unsafe paths", () => {
  const result = inspectOutput("/polis-household-assets-20261028/");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(output.workerPublicPath, "/polis-household-assets-20261028/");
  for (const prefix of ["https://other.invalid/", "/polis-household/../", "/"])
    assert.match(inspectOutput(prefix).stderr, /must be a scoped/);
});
