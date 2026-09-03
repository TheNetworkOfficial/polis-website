import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const webpackConfig = require("../frontend/webpack.config.js");

test("Cloudflare Pages rewrites dynamic Files and Governance routes", () => {
  const redirectsPlugin = webpackConfig.plugins.find(
    (plugin) => plugin?.constructor?.name === "StaticTextAssetPlugin",
  );
  assert.ok(redirectsPlugin, "webpack must emit the Cloudflare _redirects asset");
  assert.equal(redirectsPlugin.filename, "_redirects");

  const rules = readFileSync(redirectsPlugin.sourcePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(rules, [
    "/files/* /files/index.html 200",
    "/organizations/* /organizations/index.html 200",
    "/posts/* /posts/index.html 200",
  ]);
});
