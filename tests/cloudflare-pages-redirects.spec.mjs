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
  assert.ok(
    redirectsPlugin,
    "webpack must emit the Cloudflare _redirects asset",
  );
  assert.equal(redirectsPlugin.filename, "_redirects");

  const rules = readFileSync(redirectsPlugin.sourcePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(rules, [
    "/files/* /route-shells/files 200",
    "/organizations/* /route-shells/organizations 200",
    "/workspace/* /route-shells/workspace 200",
    "/posts/* /route-shells/posts 200",
  ]);

  const emittedHtml = new Set(
    webpackConfig.plugins
      .map((plugin) => plugin?.userOptions?.filename)
      .filter(Boolean),
  );
  assert.ok(emittedHtml.has("route-shells/files.html"));
  assert.ok(emittedHtml.has("route-shells/organizations.html"));
  assert.ok(emittedHtml.has("route-shells/workspace.html"));
  assert.ok(emittedHtml.has("workspace/index.html"));
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
  assert.match(dynamicRouteLocation, /\|workspace\|/u);
});

test("every canonical workspace link serves the authenticated Node shell", async () => {
  const backendRequire = createRequire(
    new URL("../backend/package.json", import.meta.url),
  );
  const express = backendRequire("express");
  const app = express();
  app.use(backendRequire("./src/routes/postShares.js"));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const scope of ["coalition", "candidate"]) {
      for (const section of [
        "",
        "/work/publishing",
        "/work/publishing/new",
        "/work/publishing/drafts/draft-1",
        "/people",
        "/people/contacts",
        "/more/audiences",
        "/more/roles",
        "/more/social-connections",
      ]) {
        const path = `/workspace/${scope}/org-1${section}`;
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200, path);
        const html = await response.text();
        assert.ok(html.includes('id="shared-feed-app"'), path);
        assert.ok(html.includes('"requiresAuth":true'), path);
        assert.ok(html.includes(`"route":"${path}"`), path);
        assert.ok(html.includes('"organizationScopeId":"org-1"'), path);
        assert.ok(html.includes("/scripts/shared-feed.js"), path);
      }
    }
    assert.equal(
      (await fetch(`${base}/workspace/user/org-1/work/publishing`)).status,
      404,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
