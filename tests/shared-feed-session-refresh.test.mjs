import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../frontend/src/pages/shared-feed/scripts/sharedFeedAuth.js",
    import.meta.url,
  ),
  "utf8",
);
const sessionKey = "sharedFeedSession.v1";
const localKey = "sharedFeedSessionPersisted.v1";
const config = {
  clientId: "fictional-browser-client",
  region: "us-west-2",
  enablePasswordFlow: "true",
};
let moduleVersion = 0;

function token(actor, kind, nonce) {
  return `fixture.${Buffer.from(
    JSON.stringify({ sub: actor, token_use: kind, nonce }),
  ).toString("base64url")}.fixture`;
}

function session(
  actor = "staff",
  nonce = "initial",
  expiresAt = Date.now() - 1,
) {
  return {
    idToken: token(actor, "id", nonce),
    accessToken: token(actor, "access", nonce),
    refreshToken: `fictional-refresh-${actor}-${nonce}`,
    expiresAt,
  };
}

function response(actor = "staff", nonce = "renewed", accessActor = actor) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      AuthenticationResult: {
        IdToken: token(actor, "id", nonce),
        AccessToken: token(accessActor, "access", nonce),
        RefreshToken: `fictional-refresh-${actor}-${nonce}`,
        ExpiresIn: 3600,
      },
    }),
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture(t, original = session()) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const stores = [new Map(), new Map()];
  const storage = (values) => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  globalThis.window = {
    sessionStorage: storage(stores[0]),
    localStorage: storage(stores[1]),
  };
  const save = (value) => {
    window.sessionStorage.setItem(sessionKey, JSON.stringify(value));
    window.localStorage.setItem(localKey, JSON.stringify(value));
  };
  save(original);
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  });
  const auth = await import(
    `data:text/javascript;base64,${Buffer.from(
      `${source}\n// independent refresh fixture ${moduleVersion++}`,
    ).toString("base64")}`
  );
  return {
    auth,
    original,
    save,
    read: () => JSON.parse(window.localStorage.getItem(localKey)),
    local: stores[1],
    tab: stores[0],
  };
}

test("a valid session is reused without a refresh request", async (t) => {
  const f = await fixture(t, session("staff", "valid", Date.now() + 3600000));
  globalThis.fetch = () => assert.fail("Valid credentials must not renew");
  assert.deepEqual(
    await f.auth.restoreSharedFeedSession(config, {
      expectedSession: f.original,
      clearOnFailure: false,
    }),
    f.original,
  );
});

test("expired simultaneous requests share one renewal and persist its result", async (t) => {
  const f = await fixture(t);
  const pending = deferred();
  const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return pending.promise;
  };
  const options = { expectedSession: f.original, clearOnFailure: false };
  const first = f.auth.restoreSharedFeedSession(config, options);
  const second = f.auth.restoreSharedFeedSession(config, options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.AuthFlow, "REFRESH_TOKEN_AUTH");
  assert.deepEqual(calls[0].body.AuthParameters, {
    REFRESH_TOKEN: f.original.refreshToken,
  });
  pending.resolve(response());
  const results = await Promise.all([first, second]);
  assert.equal(results[0], results[1]);
  assert.equal(f.auth.getAuthenticatedUser(results[0]).userId, "staff");
  assert.ok(results[0].expiresAt > Date.now() + 3500000);
  assert.deepEqual(f.read(), results[0]);
  assert.equal(f.tab.get(sessionKey), f.local.get(localKey));
});

test("near-expiry credentials renew before the token actually expires", async (t) => {
  const f = await fixture(
    t,
    session("staff", "near-expiry", Date.now() + 10000),
  );
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response();
  };
  await f.auth.restoreSharedFeedSession(config, {
    expectedSession: f.original,
  });
  assert.equal(calls, 1);
  assert.notEqual(f.read().idToken, f.original.idToken);
});

test("a transient renewal failure preserves credentials and can reach the caller", async (t) => {
  const f = await fixture(t);
  const failure = new TypeError("Fictional offline connection");
  globalThis.fetch = async () => {
    throw failure;
  };
  await assert.rejects(
    f.auth.restoreSharedFeedSession(config, {
      expectedSession: f.original,
      clearOnFailure: false,
      throwOnFailure: true,
    }),
    (error) => error === failure,
  );
  assert.deepEqual(f.read(), f.original);
});

test("provider failure status is preserved without clearing a retained session", async (t) => {
  const f = await fixture(t);
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: "Fictional provider unavailable" }),
  });
  await assert.rejects(
    f.auth.restoreSharedFeedSession(config, {
      clearOnFailure: false,
      throwOnFailure: true,
    }),
    (error) => error.statusCode === 503,
  );
  assert.deepEqual(f.read(), f.original);
});

test("legacy default renewal failure returns null and clears only its session", async (t) => {
  const f = await fixture(t);
  f.local.set("messaging-device-fixture", "preserved");
  globalThis.fetch = async () => {
    throw new TypeError("Fictional offline connection");
  };
  assert.equal(await f.auth.restoreSharedFeedSession(config), null);
  assert.equal(f.local.get(localKey), undefined);
  assert.equal(f.tab.get(sessionKey), undefined);
  assert.equal(f.local.get("messaging-device-fixture"), "preserved");
});

test("logout while renewal is pending cannot resurrect stored credentials", async (t) => {
  const f = await fixture(t);
  const pending = deferred();
  globalThis.fetch = () => pending.promise;
  const renewal = f.auth.restoreSharedFeedSession(config, {
    expectedSession: f.original,
    clearOnFailure: false,
  });
  f.auth.clearSharedFeedSession();
  pending.resolve(response());
  assert.equal(await renewal, null);
  assert.equal(f.local.get(localKey), undefined);
  assert.equal(f.tab.get(sessionKey), undefined);
});

for (const actor of ["other-staff", "staff"]) {
  for (const outcome of ["success", "failure"]) {
    test(`an older renewal ${outcome} cannot overwrite or clear a newer ${actor} sign-in`, async (t) => {
      const f = await fixture(t);
      const pending = deferred();
      globalThis.fetch = (_url, options) =>
        JSON.parse(options.body).AuthFlow === "REFRESH_TOKEN_AUTH"
          ? pending.promise
          : Promise.resolve(response(actor, "new-sign-in"));
      const renewal = f.auth.restoreSharedFeedSession(config);
      f.auth.clearSharedFeedSession();
      const signedIn = await f.auth.signInSharedFeedWithPassword(config, {
        identifier: actor,
        password: "fictional-password",
      });
      if (outcome === "success") pending.resolve(response());
      else pending.reject(new TypeError("Fictional offline connection"));
      assert.equal(await renewal, null);
      assert.deepEqual(f.read(), signedIn.session);
      assert.equal(f.auth.getAuthenticatedUser(f.read()).userId, actor);
    });
  }
}

test("a storage change while renewal is pending is never overwritten", async (t) => {
  const f = await fixture(t);
  const pending = deferred();
  globalThis.fetch = () => pending.promise;
  const renewal = f.auth.restoreSharedFeedSession(config, {
    expectedSession: f.original,
  });
  const replacement = session("other-staff", "other-tab", Date.now() + 3600000);
  f.save(replacement);
  pending.resolve(response());
  assert.equal(await renewal, null);
  assert.deepEqual(f.read(), replacement);
});

test("expected-session restore rejects another stored account before mirroring", async (t) => {
  const f = await fixture(t);
  const replacement = session("other-staff", "other-tab", Date.now() + 3600000);
  f.local.set(localKey, JSON.stringify(replacement));
  globalThis.fetch = () => assert.fail("A changed account must not renew");
  assert.equal(
    await f.auth.restoreSharedFeedSession(config, {
      expectedSession: f.original,
    }),
    null,
  );
  assert.equal(f.local.get(localKey), JSON.stringify(replacement));
  assert.equal(f.tab.get(sessionKey), JSON.stringify(f.original));
});

for (const mismatch of ["id", "access"]) {
  test(`renewal rejects a changed ${mismatch} token subject before persistence`, async (t) => {
    const f = await fixture(t);
    globalThis.fetch = async () =>
      response(
        mismatch === "id" ? "other-staff" : "staff",
        "mismatched-response",
        mismatch === "access" ? "other-staff" : "staff",
      );
    await assert.rejects(
      f.auth.restoreSharedFeedSession(config, {
        expectedSession: f.original,
        clearOnFailure: false,
        throwOnFailure: true,
      }),
      (error) =>
        error.statusCode === 401 &&
        error.errorCode === "session_refresh_identity_changed",
    );
    assert.deepEqual(f.read(), f.original);
  });
}
