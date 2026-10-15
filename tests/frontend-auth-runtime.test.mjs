import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const {
  hydrateFrontendAuthRuntime,
  sendFrontendFile,
} = require("../backend/src/frontendAuthRuntime.js");
const req = {
  protocol: "https",
  originalUrl: "/organizations/tester-org?returnTo=%2Ffeed",
  get: () => "polisapp.io",
};
const authEnv = {
  COGNITO_REGION: "us-west-2",
  COGNITO_APP_CLIENT_ID: "public-browser-client",
  COGNITO_DOMAIN: "polis.auth.us-west-2.amazoncognito.com",
  COGNITO_SCOPES: "openid email profile",
  COGNITO_ENABLE_PASSWORD_FLOW: "true",
  COGNITO_REDIRECT_URI: "https://polisapp.io/auth",
  SESSION_SECRET: "must-never-be-public",
};
const runtime = {
  route: "/organizations/org/governance",
  routeKey: "organization-governance",
  routeParams: { organizationId: "org" },
  auth: { region: "", clientId: "", domain: "", enablePasswordFlow: "false" },
  apiBaseUrl: "https://existing-api.example.test",
  appInfo: { commit: "71873ff", buildNumber: "existing-release" },
  map: { styleUrl: "existing-map" },
};
const prefix =
  '<html><head><script defer src="/scripts/shared-feed.js?v=71873ff"></script></head><body><main>Existing updated UI</main><script>window.__POLIS_WEB_APP__ = ';
const suffix =
  ";window.__POLIS_SHARED_FEED__ = window.__POLIS_WEB_APP__;</script></body></html>";
const html = `${prefix}${JSON.stringify(runtime)}${suffix}`;

function readRuntime(value) {
  return JSON.parse(value.slice(prefix.length, -suffix.length));
}

test("static fallback receives configured browser sign-in without changing update data", () => {
  const hydrated = hydrateFrontendAuthRuntime(html, req, authEnv);
  const result = readRuntime(hydrated);
  assert.deepEqual(result, {
    ...runtime,
    auth: {
      region: authEnv.COGNITO_REGION,
      clientId: authEnv.COGNITO_APP_CLIENT_ID,
      domain: authEnv.COGNITO_DOMAIN,
      scopes: authEnv.COGNITO_SCOPES,
      enablePasswordFlow: "true",
      redirectUri: "https://polisapp.io/auth",
    },
  });
  assert.ok(hydrated.startsWith(prefix));
  assert.ok(hydrated.endsWith(suffix));
  assert.ok(!hydrated.includes(authEnv.SESSION_SECRET));
});

test("runtime serialization cannot turn public configuration into executable markup", () => {
  const hydrated = hydrateFrontendAuthRuntime(html, req, {
    ...authEnv,
    COGNITO_DOMAIN: "</script><script>alert(1)</script>",
  });
  assert.ok(!hydrated.includes("</script><script>"));
  assert.equal(
    readRuntime(hydrated).auth.domain,
    "</script><script>alert(1)</script>",
  );
});

test("ordinary HTML remains unchanged and default redirect preserves request query", () => {
  assert.equal(
    hydrateFrontendAuthRuntime("<html>Public page</html>", req, authEnv),
    "<html>Public page</html>",
  );
  assert.equal(
    readRuntime(hydrateFrontendAuthRuntime(html, req, {})).auth.redirectUri,
    "https://polisapp.io/organizations/tester-org?returnTo=%2Ffeed",
  );
});

test("HTML response sends runtime config with no-store and keeps asset bytes", async () => {
  const directory = await mkdtemp(path.resolve(".auth-runtime-test-"));
  const filePath = path.join(directory, "shell.html");
  await writeFile(filePath, html);
  try {
    const response = await new Promise((resolve, reject) => {
      const headers = {};
      const res = {
        set(name, value) {
          headers[name] = value;
          return this;
        },
        type(value) {
          headers.type = value;
          return this;
        },
        send(body) {
          resolve({ headers, body });
        },
        sendFile() {
          reject(new Error("must hydrate shared browser shell"));
        },
      };
      sendFrontendFile(req, res, reject, filePath);
    });
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.headers.type, "html");
    assert.ok(response.body.startsWith(prefix));
    assert.ok(response.body.endsWith(suffix));
    assert.equal(readRuntime(response.body).apiBaseUrl, runtime.apiBaseUrl);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const serverName of ["server.js", "publicServer.js"]) {
  test(`${serverName} hydrates directory and deep-link fallbacks ahead of static files`, async () => {
    const backendRequire = createRequire(
      new URL("../backend/package.json", import.meta.url),
    );
    const express = backendRequire("express");
    const app = express();
    const listen = app.listen.bind(app);
    app.listen = () => {};
    const directory = await mkdtemp(path.resolve(".auth-runtime-test-"));
    await mkdir(path.join(directory, "organizations"));
    await writeFile(path.join(directory, "organizations/index.html"), html);
    await writeFile(
      path.join(directory, "unchanged.js"),
      "existing asset bytes",
    );
    const previousEnv = Object.fromEntries(
      Object.keys(authEnv).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, authEnv);
    let server;
    try {
      let source = await readFile(
        new URL(`../backend/src/${serverName}`, import.meta.url),
        "utf8",
      );
      const context = {
        app,
        console,
        __dirname: path.resolve("backend/src"),
        process: { env: { ...process.env, FRONTEND_DIST_PATH: directory } },
        require(name) {
          if (name === "dotenv") return { config() {} };
          if (name === "express") {
            return Object.assign(() => app, express);
          }
          if (name.startsWith("./"))
            return backendRequire(`./src/${name.slice(2)}`);
          return backendRequire(name);
        },
        fs: require("node:fs"),
        path,
        express,
        sendFrontendFile,
      };
      if (serverName === "server.js") {
        source = source.slice(
          source.indexOf("function resolveFrontendDistPath()"),
          source.indexOf("(async () =>"),
        );
        source += "\nmountFrontendRoutes(app);";
      }
      const runServer = vm.runInThisContext(
        `(function (app, process, require, __dirname, console, fs, path, express, sendFrontendFile) { { ${source}\n } })`,
      );
      runServer(
        context.app,
        context.process,
        context.require,
        context.__dirname,
        context.console,
        context.fs,
        context.path,
        context.express,
        context.sendFrontendFile,
      );
      server = await new Promise((resolve) => {
        const listener = listen(0, "127.0.0.1", () => resolve(listener));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const route of [
        "/organizations",
        "/organizations/tester-org",
        "/organizations/signup",
      ]) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 200, route);
        assert.equal(response.headers.get("cache-control"), "no-store", route);
        assert.equal(
          readRuntime(await response.text()).auth.clientId,
          authEnv.COGNITO_APP_CLIENT_ID,
          route,
        );
      }
      const asset = await fetch(`${base}/unchanged.js`);
      assert.equal(await asset.text(), "existing asset bytes");
      assert.notEqual(asset.headers.get("cache-control"), "no-store");
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
