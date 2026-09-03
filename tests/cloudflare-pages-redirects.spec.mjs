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

test("Node and Lightsail route Files and organization Governance shells", () => {
  const serverSource = readFileSync(
    new URL("../backend/src/server.js", import.meta.url),
    "utf8",
  );
  const publicServerSource = readFileSync(
    new URL("../backend/src/publicServer.js", import.meta.url),
    "utf8",
  );
  const nginxSource = readFileSync(
    new URL(
      "../deploy/lightsail/polis-website.nginx.conf.example",
      import.meta.url,
    ),
    "utf8",
  );

  for (const source of [serverSource, publicServerSource]) {
    assert.match(
      source,
      /\[\/\^\\\/files\(\?:\\\/\.\*\)\?\$\/u, "files\/index\.html"\]/u,
    );
    assert.match(
      source,
      /\[\/\^\\\/organizations\(\?:\\\/\.\*\)\?\$\/u, "organizations\/index\.html"\]/u,
    );
  }

  const dynamicRouteLocation = nginxSource
    .split(/\r?\n/u)
    .find((line) => line.includes("location ~ ^/(account-deletion-requested"));
  assert.ok(dynamicRouteLocation, "Lightsail dynamic-route proxy must exist");
  assert.match(dynamicRouteLocation, /\|files\|/u);
  assert.match(dynamicRouteLocation, /\|organizations\|/u);
});
