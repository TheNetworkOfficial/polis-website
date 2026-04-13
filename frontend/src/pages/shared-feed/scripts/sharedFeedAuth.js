const SESSION_STORAGE_KEY = "sharedFeedSession.v1";
const OAUTH_STATE_STORAGE_KEY = "sharedFeedOauthState.v1";
const OAUTH_VERIFIER_STORAGE_KEY = "sharedFeedOauthVerifier.v1";

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function toBase64Url(input) {
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return toBase64Url(binary);
}

function createRandomToken(length = 48) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function buildPkceChallenge(verifier) {
  const input = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest("SHA-256", input);
  return bytesToBase64Url(new Uint8Array(digest));
}

function decodeJwtClaims(token) {
  const raw = normalizeString(token);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (payload.length % 4)) % 4;
    const decoded = atob(`${payload}${"=".repeat(padLength)}`);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function buildSessionFromTokens(tokens = {}) {
  const accessToken = normalizeString(tokens.AccessToken || tokens.access_token);
  const idToken = normalizeString(tokens.IdToken || tokens.id_token);
  const refreshToken =
    normalizeString(tokens.RefreshToken || tokens.refresh_token) || null;
  const expiresInSeconds = Number(tokens.ExpiresIn || tokens.expires_in || 3600);

  if (!accessToken || !idToken) {
    throw new Error("invalid_auth_response");
  }

  return {
    accessToken,
    idToken,
    refreshToken,
    expiresAt:
      Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000,
  };
}

function persistSession(session) {
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSessionOnly() {
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function clearOAuthState() {
  window.sessionStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
  window.sessionStorage.removeItem(OAUTH_VERIFIER_STORAGE_KEY);
}

function clearOAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const keys = ["code", "state", "error", "error_description"];
  let changed = false;

  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  const query = url.searchParams.toString();
  const next = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  window.history.replaceState({}, document.title, next);
}

function getStoredSession() {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const accessToken = normalizeString(parsed.accessToken);
    const idToken = normalizeString(parsed.idToken);
    const expiresAt = Number(parsed.expiresAt || 0);
    if (!accessToken || !idToken || !Number.isFinite(expiresAt)) {
      return null;
    }
    if (Date.now() >= expiresAt) {
      clearStoredSessionOnly();
      return null;
    }
    return {
      accessToken,
      idToken,
      refreshToken: normalizeString(parsed.refreshToken) || null,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function deriveSessionUser(session) {
  const idClaims = decodeJwtClaims(session?.idToken);
  const accessClaims = decodeJwtClaims(session?.accessToken);
  const claims = idClaims || accessClaims || {};

  return {
    userId: normalizeString(claims?.sub) || null,
    email: normalizeString(claims?.email) || null,
    username:
      normalizeString(claims?.["cognito:username"] || claims?.username) || null,
    displayName:
      normalizeString(claims?.email) ||
      normalizeString(claims?.name) ||
      normalizeString(claims?.preferred_username) ||
      normalizeString(claims?.["cognito:username"] || claims?.username) ||
      normalizeString(claims?.sub) ||
      "Authenticated user",
  };
}

function resolveHostedUiBaseUrl(config = {}) {
  const domain = normalizeString(config.domain).replace(/^https?:\/\//i, "");
  return domain ? `https://${domain}` : "";
}

function resolveRedirectUri(config = {}) {
  return normalizeString(config.redirectUri) || window.location.href;
}

function resolveScopes(config = {}) {
  const raw =
    normalizeString(config.scopes) ||
    "openid email profile aws.cognito.signin.user.admin";
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export function hasHostedSignInConfig(config = {}) {
  return Boolean(normalizeString(config.clientId) && normalizeString(config.domain));
}

export function buildAuthorizedHeaders(session, extra = {}) {
  const authToken = normalizeString(session?.idToken || session?.accessToken);
  const accessToken = normalizeString(session?.accessToken);
  if (!authToken || !accessToken) {
    throw new Error("unauthorized");
  }

  return {
    Authorization: `Bearer ${authToken}`,
    "X-Cognito-Access-Token": accessToken,
    ...extra,
  };
}

async function startHostedAuth(config = {}, { mode = "login" } = {}) {
  if (!hasHostedSignInConfig(config)) {
    throw new Error("auth_not_configured");
  }

  const state = createRandomToken(32);
  const verifier = createRandomToken(64);
  const challenge = await buildPkceChallenge(verifier);

  window.sessionStorage.setItem(OAUTH_STATE_STORAGE_KEY, state);
  window.sessionStorage.setItem(OAUTH_VERIFIER_STORAGE_KEY, verifier);

  const params = new URLSearchParams({
    client_id: normalizeString(config.clientId),
    response_type: "code",
    redirect_uri: resolveRedirectUri(config),
    scope: resolveScopes(config),
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  const hostedUiBaseUrl = resolveHostedUiBaseUrl(config);
  const route = mode === "signup" ? "/signup" : "/oauth2/authorize";
  window.location.assign(`${hostedUiBaseUrl}${route}?${params.toString()}`);
}

export async function startHostedSignIn(config = {}) {
  await startHostedAuth(config, { mode: "login" });
}

export async function startHostedSignUp(config = {}) {
  await startHostedAuth(config, { mode: "signup" });
}

export async function completeHostedSignIn(config = {}) {
  const url = new URL(window.location.href);
  const oauthError = normalizeString(url.searchParams.get("error"));
  const oauthErrorDescription = normalizeString(
    url.searchParams.get("error_description"),
  );

  if (oauthError) {
    clearOAuthState();
    clearOAuthParamsFromUrl();
    return {
      handled: true,
      session: null,
      user: null,
      error: oauthErrorDescription || "Sign-in was cancelled or failed.",
    };
  }

  const code = normalizeString(url.searchParams.get("code"));
  if (!code) {
    return {
      handled: false,
      session: getStoredSession(),
      user: deriveSessionUser(getStoredSession()),
      error: null,
    };
  }

  const returnedState = normalizeString(url.searchParams.get("state"));
  const expectedState = normalizeString(
    window.sessionStorage.getItem(OAUTH_STATE_STORAGE_KEY),
  );
  const verifier = normalizeString(
    window.sessionStorage.getItem(OAUTH_VERIFIER_STORAGE_KEY),
  );

  clearOAuthState();
  clearOAuthParamsFromUrl();

  if (
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState ||
    !verifier
  ) {
    return {
      handled: true,
      session: null,
      user: null,
      error: "Sign-in verification failed. Please try again.",
    };
  }

  const response = await fetch(`${resolveHostedUiBaseUrl(config)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: normalizeString(config.clientId),
      code,
      redirect_uri: resolveRedirectUri(config),
      code_verifier: verifier,
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      handled: true,
      session: null,
      user: null,
      error: "Unable to complete sign-in. Please try again.",
    };
  }

  const session = buildSessionFromTokens(payload);
  persistSession(session);
  return {
    handled: true,
    session,
    user: deriveSessionUser(session),
    error: null,
  };
}

export function clearSharedFeedSession() {
  clearStoredSessionOnly();
  clearOAuthState();
}

export function getStoredSharedFeedSession() {
  return getStoredSession();
}

export function getAuthenticatedUser(session) {
  return session ? deriveSessionUser(session) : null;
}
