import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSourceUrl = new URL(
  "../frontend/src/pages/delete-account/scripts/deleteAccountApi.js",
  import.meta.url,
);
const deleteAccountCssUrl = new URL(
  "../frontend/src/pages/delete-account/css/delete-account.css",
  import.meta.url,
);

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  removeItem(key) {
    this.values.delete(key);
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function jwtWithSubject(subject, tokenUse) {
  const encoded = Buffer.from(
    JSON.stringify({ sub: subject, token_use: tokenUse }),
  ).toString("base64url");
  return `header.${encoded}.signature`;
}

async function loadDeleteAccountApi({ providers = "COGNITO" } = {}) {
  const config = {
    __DELETE_ACCOUNT_API_BASE_URL__:
      "https://b3nfp5rv5m.execute-api.us-west-2.amazonaws.com/prod",
    __COGNITO_REGION__: "us-west-2",
    __COGNITO_APP_CLIENT_ID__: "3eh4bclp1kupifkb2vt9pc1s1k",
    __COGNITO_DOMAIN__:
      "coalition-auth-app-dev-coalition.auth.us-west-2.amazoncognito.com",
    __COGNITO_REDIRECT_URI__: "https://polisapp.io/delete-account",
    __COGNITO_SCOPES__: "openid email profile aws.cognito.signin.user.admin",
    __COGNITO_ENABLE_PASSWORD_FLOW__: "false",
    __COGNITO_SUPPORTED_IDENTITY_PROVIDERS__: providers,
  };
  Object.assign(globalThis, config);

  const source = await readFile(apiSourceUrl, "utf8");
  const uniqueSource = `${source}\n// test-import-${Date.now()}-${Math.random()}\n`;
  return import(
    `data:text/javascript;base64,${Buffer.from(uniqueSource).toString("base64")}`
  );
}

function installWindow(url = "https://polisapp.io/delete-account") {
  const storage = new MemoryStorage();
  const assigned = [];
  const replaced = [];
  const parsed = new URL(url);
  globalThis.window = {
    crypto: globalThis.crypto,
    history: {
      replaceState(_state, _title, next) {
        replaced.push(next);
      },
    },
    location: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      assign(next) {
        assigned.push(next);
      },
    },
    sessionStorage: storage,
  };
  globalThis.document = { title: "Delete account" };
  return { assigned, replaced, storage };
}

test("deletion page CSS keeps hidden workflow controls out of layout", async () => {
  const css = await readFile(deleteAccountCssUrl, "utf8");
  assert.match(
    css,
    /\.delete-main\s+\[hidden\]\s*\{[^}]*display:\s*none\s*!important\s*;/,
  );
});

test("deletion auth exposes only identity providers configured for its client", async () => {
  installWindow();
  const cognitoOnly = await loadDeleteAccountApi();
  assert.deepEqual(cognitoOnly.getDeleteAccountAuthCapabilities(), {
    password: false,
    hosted: true,
    google: false,
  });

  const withGoogle = await loadDeleteAccountApi({
    providers: "COGNITO,Google",
  });
  assert.deepEqual(withGoogle.getDeleteAccountAuthCapabilities(), {
    password: false,
    hosted: true,
    google: true,
  });
});

test("hosted deletion sign-in uses the dedicated client, canonical callback and PKCE", async () => {
  const browser = installWindow();
  const api = await loadDeleteAccountApi();

  await api.startHostedSignInForDeletion();

  assert.equal(browser.assigned.length, 1);
  const authorizationUrl = new URL(browser.assigned[0]);
  assert.equal(authorizationUrl.pathname, "/oauth2/authorize");
  assert.equal(
    authorizationUrl.searchParams.get("client_id"),
    "3eh4bclp1kupifkb2vt9pc1s1k",
  );
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    "https://polisapp.io/delete-account",
  );
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.ok(browser.storage.getItem("deleteAccountOauthState.v1"));
  assert.ok(browser.storage.getItem("deleteAccountOauthVerifier.v1"));
});

test("callback rejects mismatched state before exchanging an authorization code", async () => {
  const browser = installWindow(
    "https://polisapp.io/delete-account?code=sample-code&state=returned-state",
  );
  browser.storage.setItem("deleteAccountOauthState.v1", "expected-state");
  browser.storage.setItem("deleteAccountOauthVerifier.v1", "verifier");
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("fetch must not run for a state mismatch");
  };
  const api = await loadDeleteAccountApi();

  await assert.rejects(
    api.completeHostedSignInForDeletion(),
    (error) => error?.errorCode === "oauth_state_mismatch",
  );
  assert.equal(fetchCount, 0);
  assert.equal(browser.storage.getItem("deleteAccountOauthState.v1"), null);
  assert.equal(browser.storage.getItem("deleteAccountOauthVerifier.v1"), null);
});

test("matching callback exchanges the code with the original verifier and redirect URI", async () => {
  const browser = installWindow(
    "https://polisapp.io/delete-account?code=sample-code&state=expected-state",
  );
  browser.storage.setItem("deleteAccountOauthState.v1", "expected-state");
  browser.storage.setItem("deleteAccountOauthVerifier.v1", "sample-verifier");
  let observedRequest = null;
  globalThis.fetch = async (url, options) => {
    observedRequest = { url, options };
    return {
      ok: true,
      async json() {
        return {
          access_token: jwtWithSubject("user-1", "access"),
          id_token: jwtWithSubject("user-1", "id"),
          refresh_token: "refresh-token",
          expires_in: 3600,
        };
      },
    };
  };
  const api = await loadDeleteAccountApi();

  const result = await api.completeHostedSignInForDeletion();

  assert.equal(result.handled, true);
  assert.equal(result.user.userId, "user-1");
  assert.equal(
    observedRequest.url,
    "https://coalition-auth-app-dev-coalition.auth.us-west-2.amazoncognito.com/oauth2/token",
  );
  const body = new URLSearchParams(observedRequest.options.body);
  assert.equal(body.get("client_id"), "3eh4bclp1kupifkb2vt9pc1s1k");
  assert.equal(body.get("code"), "sample-code");
  assert.equal(body.get("code_verifier"), "sample-verifier");
  assert.equal(body.get("redirect_uri"), "https://polisapp.io/delete-account");
  assert.equal(browser.replaced[0], "/delete-account");
});

test("deletion API calls preserve the identity/access-token split and proof gate", async () => {
  installWindow();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, status: "queued" };
      },
    };
  };
  const api = await loadDeleteAccountApi();
  const session = {
    idToken: "id-token",
    accessToken: "access-token",
  };

  await api.requestDeleteVerificationCode(session);
  assert.equal(
    requests[0].url,
    "https://b3nfp5rv5m.execute-api.us-west-2.amazonaws.com/prod/api/me/delete-verification/send-code",
  );
  assert.equal(requests[0].options.headers.Authorization, "Bearer id-token");
  assert.equal(
    requests[0].options.headers["X-Cognito-Access-Token"],
    "access-token",
  );

  await assert.rejects(
    api.submitDeleteAccountRequest({ session, deleteVerificationToken: "" }),
    (error) => error?.errorCode === "delete_verification_required",
  );
  assert.equal(requests.length, 1);

  await api.submitDeleteAccountRequest({
    session,
    deleteVerificationToken: "verification-proof",
  });
  assert.equal(requests[1].options.method, "DELETE");
  assert.equal(
    requests[1].options.headers["X-Delete-Verification-Token"],
    "verification-proof",
  );
});
