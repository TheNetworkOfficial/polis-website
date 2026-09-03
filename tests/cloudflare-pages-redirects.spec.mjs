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
    "/files/* /route-shells/files 200",
    "/organizations/* /route-shells/organizations 200",
    "/posts/* /route-shells/posts 200",
  ]);

  const emittedHtml = new Set(
    webpackConfig.plugins
      .map((plugin) => plugin?.userOptions?.filename)
      .filter(Boolean),
  );
  assert.ok(emittedHtml.has("route-shells/files.html"));
  assert.ok(emittedHtml.has("route-shells/organizations.html"));
  assert.ok(emittedHtml.has("route-shells/posts.html"));
});
