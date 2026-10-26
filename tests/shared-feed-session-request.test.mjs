import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const directory = new URL(
  "../frontend/src/pages/shared-feed/",
  import.meta.url,
);
const guardSource = await readFile(
  new URL("scripts/sharedFeedSessionRequest.js", directory),
  "utf8",
);
const { createSharedFeedSessionGuard } = await import(
  `data:text/javascript;base64,${Buffer.from(guardSource).toString("base64")}`
);
const authSource = await readFile(
  new URL("scripts/sharedFeedAuth.js", directory),
  "utf8",
);
const { buildAuthorizedHeaders } = await import(
  `data:text/javascript;base64,${Buffer.from(authSource).toString("base64")}`
);
const page = await readFile(new URL("shared-feed.js", directory), "utf8");
const start = page.indexOf("async function fetchJsonRaw(");
const end = page.indexOf("\nfunction updateItem(", start);
assert.ok(start >= 0 && end > start);

const fresh = (extra = {}) => ({
  userId: "test-staff",
  idToken: "fixture-id-new",
  accessToken: "fixture-access-new",
  refreshToken: "fixture-refresh",
  expiresAt: Date.now() + 3_600_000,
  ...extra,
});
const stale = () =>
  fresh({
    idToken: "fixture-id-old",
    accessToken: "fixture-access-old",
    expiresAt: Date.now() - 1000,
  });

function transport({ session = stale(), restore, send } = {}) {
  const state = { auth: { session } };
  const calls = [];
  let route = "/workspace/coalition/fixture/work/ballot-chaser";
  let restores = 0;
  const requestSession = createSharedFeedSessionGuard({
    getSession: () => state.auth.session,
    restoreSession: async (previous) => {
      restores++;
      return restore ? restore(previous) : fresh();
    },
    saveSession: (value) => {
      state.auth.session = value;
    },
    userId: (value) => value?.userId,
    contextKey: () => route,
  });
  const context = vm.createContext({
    state,
    window: {},
    requestSession,
    getApiBaseUrl: () => "https://api.polis.test",
    buildAuthorizedHeaders,
    normalizeString: (value) => String(value || "").trim(),
    fetch: (url, options) => {
      calls.push({ url, ...options });
      return send
        ? send(url, options)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          });
    },
  });
  vm.runInContext(page.slice(start, end), context);
  return {
    state,
    calls,
    request: context.fetchJsonRaw,
    restores: () => restores,
    setRoute: (value) => {
      route = value;
    },
  };
}

test("the first upload request after long local preparation silently renews and dispatches once", async () => {
  const fixture = transport();
  const prepared = { fileName: "prepared-ballots.csv", rows: 109_783 };
  let beforeDispatch = 0;
  await fixture.request(
    "/api/contact-book/scopes/fixture/ballot-chaser/imports",
    {
      auth: true,
      method: "POST",
      body: prepared,
      headers: { "Idempotency-Key": "fixture-operation" },
      beforeDispatch: () => beforeDispatch++,
    },
  );
  assert.equal(fixture.restores(), 1);
  assert.equal(fixture.calls.length, 1);
  assert.equal(beforeDispatch, 1);
  assert.equal(fixture.calls[0].headers.Authorization, "Bearer fixture-id-new");
  assert.equal(fixture.calls[0].body, JSON.stringify(prepared));
  assert.equal(
    fixture.calls[0].headers["Idempotency-Key"],
    "fixture-operation",
  );
  assert.equal(prepared.rows, 109_783);
});

test("valid sessions make repeated requests without another renewal", async () => {
  const fixture = transport({ session: fresh() });
  await Promise.all(
    Array.from({ length: 5 }, () =>
      fixture.request("/api/profile/me", { auth: true }),
    ),
  );
  assert.equal(fixture.restores(), 0);
  assert.equal(fixture.calls.length, 5);
});

test("near-expiry sessions renew before dispatch", async () => {
  const fixture = transport({
    session: fresh({ expiresAt: Date.now() + 30_000 }),
  });
  await fixture.request("/api/profile/me", { auth: true });
  assert.equal(fixture.restores(), 1);
});

test("a transient renewal failure preserves the session and sends no upload", async () => {
  const session = stale();
  const fixture = transport({
    session,
    restore: () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await assert.rejects(
    fixture.request("/upload", { auth: true, method: "POST", body: {} }),
    (error) => error.status === 503,
  );
  assert.equal(fixture.state.auth.session, session);
  assert.equal(fixture.calls.length, 0);
});

test("a revoked refresh credential requires sign-in without dispatch", async () => {
  const fixture = transport({
    restore: () => {
      throw Object.assign(new Error("Not authorized"), { statusCode: 400 });
    },
  });
  await assert.rejects(
    fixture.request("/upload", { auth: true, method: "POST", body: {} }),
    (error) => error.status === 401 && /sign in again/.test(error.message),
  );
  assert.equal(fixture.calls.length, 0);
});

for (const change of ["sign-out", "account", "same-account-sign-in", "route"]) {
  test(`a pending renewal cannot dispatch after ${change}`, async () => {
    let finish;
    const fixture = transport({
      restore: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = fixture.request("/upload", {
      auth: true,
      method: "POST",
      body: {},
    });
    const rejected = assert.rejects(pending, (error) => error.status === 409);
    if (change === "route") fixture.setRoute("/another-workspace");
    else
      fixture.state.auth.session =
        change === "sign-out"
          ? null
          : fresh({
              userId: change === "account" ? "another-user" : "test-staff",
              refreshToken: "another-sign-in",
            });
    finish(fresh());
    await rejected;
    assert.equal(fixture.calls.length, 0);
  });
}

test("cancelling during renewal prevents dispatch", async () => {
  let finish;
  const abort = new AbortController();
  const fixture = transport({
    restore: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = fixture.request("/read", {
    auth: true,
    signal: abort.signal,
  });
  const rejected = assert.rejects(
    pending,
    (error) => error.name === "AbortError",
  );
  abort.abort();
  finish(fresh());
  await rejected;
  assert.equal(fixture.calls.length, 0);
});

test("failed network outcomes and permission denials never replay mutations", async () => {
  for (const outcome of ["network", "unauthorized", "forbidden"]) {
    const fixture = transport({
      send: () => {
        if (outcome === "network") throw new TypeError("Failed to fetch");
        return Promise.resolve({
          ok: false,
          status: outcome === "unauthorized" ? 401 : 403,
          json: async () => ({ message: "Denied" }),
        });
      },
    });
    let dispatched = 0;
    await assert.rejects(
      fixture.request("/send", {
        auth: true,
        method: "POST",
        body: { operationId: "one-attempt" },
        beforeDispatch: () => dispatched++,
      }),
    );
    assert.equal(dispatched, 1);
    assert.equal(fixture.restores(), 1);
    assert.equal(fixture.calls.length, 1);
  }
});

test("anonymous requests and valid unload releases dispatch without awaiting renewal", async () => {
  for (const options of [
    { auth: false },
    { auth: true, keepalive: true, method: "POST", body: { release: true } },
  ]) {
    const fixture = transport({ session: fresh() });
    const pending = fixture.request("/exit", options);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.restores(), 0);
    if (options.auth)
      assert.equal(
        fixture.calls[0].headers.Authorization,
        "Bearer fixture-id-new",
      );
    else assert.equal(fixture.calls[0].headers.Authorization, undefined);
    await pending;
  }
});

test("an operation guard can stop dispatch after renewal", async () => {
  const fixture = transport();
  await assert.rejects(
    fixture.request("/upload", {
      auth: true,
      method: "POST",
      beforeDispatch: () => {
        throw new Error("The prepared operation changed");
      },
    }),
    /prepared operation changed/,
  );
  assert.equal(fixture.calls.length, 0);
});
