import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../frontend/src/pages/shared-feed/scripts/sharedFeedAuth.js",
    import.meta.url,
  ),
  "utf8",
);
const {
  completeHostedSignIn,
  consumeSharedFeedPostAuthPath,
  getSharedFeedAuthCapabilities,
  signInSharedFeedWithPassword,
  startHostedSignIn,
  startHostedSignUp,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const config = {
  clientId: "browser-client",
  domain: "polis.auth.us-west-2.amazoncognito.com",
  redirectUri: "https://polis.test/feed",
  supportedIdentityProviders: "COGNITO,Google",
};

function browser() {
  const values = new Map();
  const destinations = [];
  return {
    destinations,
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    crypto: webcrypto,
    location: {
      origin: "https://polis.test",
      pathname: "/auth",
      href: "https://polis.test/auth",
      assign: (url) => destinations.push(new URL(url)),
    },
    history: { replaceState: () => {} },
  };
}

test("Google is available only when explicitly configured alongside hosted OAuth", () => {
  for (const supportedIdentityProviders of [
    undefined,
    "",
    "COGNITO",
    "GoogleOther",
    "google",
  ]) {
    assert.equal(
      getSharedFeedAuthCapabilities({ ...config, supportedIdentityProviders })
        .google,
      false,
    );
  }
  for (const supportedIdentityProviders of [
    "COGNITO,Google",
    " COGNITO Google ",
    ["COGNITO", "Google"],
  ]) {
    assert.equal(
      getSharedFeedAuthCapabilities({ ...config, supportedIdentityProviders })
        .google,
      true,
    );
  }
  assert.equal(
    getSharedFeedAuthCapabilities({ ...config, domain: "" }).google,
    false,
  );
  assert.equal(
    getSharedFeedAuthCapabilities({ ...config, clientId: "" }).google,
    false,
  );
});

test("Google OAuth skips the generic login with account choice and preserves PKCE and return path", async (t) => {
  const window = browser();
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("starting OAuth must not contact account APIs");
  });
  const previousWindow = globalThis.window;
  globalThis.window = window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  const postAuthPath =
    "/workspace/coalition/test/work/ballot-chaser?view=doors";
  await startHostedSignIn(config, { postAuthPath, identityProvider: "Google" });
  assert.equal(window.destinations.length, 1);
  const url = window.destinations[0];
  assert.equal(url.origin, "https://polis.auth.us-west-2.amazoncognito.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("identity_provider"), "Google");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const verifier = window.sessionStorage.getItem("sharedFeedOauthVerifier.v1");
  assert.ok(verifier.length >= 43);
  const expectedChallenge = Buffer.from(
    await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    ),
  ).toString("base64url");
  assert.equal(url.searchParams.get("code_challenge"), expectedChallenge);
  assert.equal(
    url.searchParams.get("state"),
    window.sessionStorage.getItem("sharedFeedOauthState.v1"),
  );
  assert.equal(consumeSharedFeedPostAuthPath(), postAuthPath);
  assert.equal(consumeSharedFeedPostAuthPath(), "");
});

test("generic login and signup retain their routes and omit provider parameters", async (t) => {
  const previousWindow = globalThis.window;
  const window = browser();
  globalThis.window = window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  await startHostedSignIn(config);
  await startHostedSignUp(config);
  assert.deepEqual(
    window.destinations.map((url) => url.pathname),
    ["/oauth2/authorize", "/signup"],
  );
  for (const url of window.destinations) {
    assert.equal(url.searchParams.has("identity_provider"), false);
    assert.equal(url.searchParams.has("prompt"), false);
  }
  await startHostedSignUp(config, { identityProvider: "Google" });
  assert.equal(window.destinations[2].pathname, "/oauth2/authorize");
  assert.equal(
    window.destinations[2].searchParams.get("identity_provider"),
    "Google",
  );
});

test("unsupported providers fail before replacing the outstanding OAuth request", async (t) => {
  const previousWindow = globalThis.window;
  const window = browser();
  globalThis.window = window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  await startHostedSignIn(config, { postAuthPath: "/feed" });
  const existingState = window.sessionStorage.getItem(
    "sharedFeedOauthState.v1",
  );
  for (const [settings, identityProvider] of [
    [config, "Google&redirect_uri=https://evil.test"],
    [config, "Facebook"],
    [{ ...config, supportedIdentityProviders: "COGNITO" }, "Google"],
  ]) {
    await assert.rejects(
      startHostedSignIn(settings, { identityProvider }),
      (error) => error.errorCode === "identity_provider_unavailable",
    );
  }
  assert.equal(window.destinations.length, 1);
  assert.equal(
    window.sessionStorage.getItem("sharedFeedOauthState.v1"),
    existingState,
  );
  assert.equal(consumeSharedFeedPostAuthPath(), "/feed");
});

test("Google callback still rejects mismatched OAuth state without exchanging tokens", async (t) => {
  const previousWindow = globalThis.window;
  const window = browser();
  globalThis.window = window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("an invalid callback must never exchange tokens");
  });
  await startHostedSignIn(config, { identityProvider: "Google" });
  window.location.href = "https://polis.test/feed?code=test-code&state=wrong";
  const previousDocument = globalThis.document;
  globalThis.document = { title: "Polis" };
  t.after(() => {
    globalThis.document = previousDocument;
  });
  const result = await completeHostedSignIn(config);
  assert.equal(result.handled, true);
  assert.equal(result.session, null);
  assert.equal(result.error, "Sign-in verification failed. Please try again.");
  assert.equal(window.sessionStorage.getItem("sharedFeedOauthState.v1"), null);
  assert.equal(
    window.sessionStorage.getItem("sharedFeedOauthVerifier.v1"),
    null,
  );
});

test("password verification challenges direct users to secure sign-in without saving a session", async (t) => {
  const previousWindow = globalThis.window;
  const window = browser();
  globalThis.window = window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  const writes = [];
  t.mock.method(window.sessionStorage, "setItem", (...values) =>
    writes.push(values),
  );
  window.localStorage = { setItem: (...values) => writes.push(values) };
  let challenge = "SMS_MFA";
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(
      options.headers["X-Amz-Target"],
      "AWSCognitoIdentityProviderService.InitiateAuth",
    );
    return {
      ok: true,
      json: async () => ({
        ChallengeName: challenge,
        Session: "challenge-session",
      }),
    };
  });
  for (const name of [
    "SMS_MFA",
    "SOFTWARE_TOKEN_MFA",
    "NEW_PASSWORD_REQUIRED",
  ]) {
    challenge = name;
    await assert.rejects(
      signInSharedFeedWithPassword(
        { ...config, region: "us-west-2", enablePasswordFlow: "true" },
        { identifier: "test-user", password: "test-password" },
      ),
      (error) => {
        assert.equal(error.errorCode, "additional_verification_required");
        assert.equal(
          error.message,
          "Your account needs an additional verification step. Choose More sign-in options to continue.",
        );
        assert.equal(error.payload, null);
        return true;
      },
    );
  }
  assert.deepEqual(writes, []);
  assert.equal(window.sessionStorage.getItem("sharedFeedSession.v1"), null);
});
