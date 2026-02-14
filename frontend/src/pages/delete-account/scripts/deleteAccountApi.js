export const DELETE_CONFIRMATION_PHRASE = "DELETE";

/* global __DELETE_ACCOUNT_API_BASE_URL__, __COGNITO_REGION__, __COGNITO_APP_CLIENT_ID__, __COGNITO_DOMAIN__, __COGNITO_REDIRECT_URI__, __COGNITO_SCOPES__, __COGNITO_ENABLE_PASSWORD_FLOW__ */
const DELETE_ACCOUNT_API_BASE_URL = __DELETE_ACCOUNT_API_BASE_URL__;
const COGNITO_REGION = __COGNITO_REGION__;
const COGNITO_APP_CLIENT_ID = __COGNITO_APP_CLIENT_ID__;
const COGNITO_DOMAIN = __COGNITO_DOMAIN__;
const COGNITO_REDIRECT_URI = __COGNITO_REDIRECT_URI__;
const COGNITO_SCOPES = __COGNITO_SCOPES__;
const COGNITO_ENABLE_PASSWORD_FLOW = __COGNITO_ENABLE_PASSWORD_FLOW__;

const DEFAULT_COGNITO_REGION = "us-west-2";
const DEFAULT_COGNITO_SCOPES =
  "openid email profile aws.cognito.signin.user.admin";

const SESSION_STORAGE_KEY = "deleteAccountSession.v1";
const OAUTH_STATE_STORAGE_KEY = "deleteAccountOauthState.v1";
const OAUTH_VERIFIER_STORAGE_KEY = "deleteAccountOauthVerifier.v1";

const PASSWORD_SIGNIN_FLOW = "USER_PASSWORD_AUTH";

export class DeleteAccountApiError extends Error {
  constructor(
    message,
    { statusCode = 0, errorCode = "request_failed", payload = null } = {},
  ) {
    super(message);
    this.name = "DeleteAccountApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.payload = payload;
  }
}

function isTemplateToken(value) {
  const candidate = String(value || "");
  return candidate.includes("[") && candidate.includes("]");
}

function resolveConfigValue(raw, fallback = "") {
  const value = String(raw || "").trim();
  if (!value || isTemplateToken(value)) {
    return fallback;
  }
  return value;
}

function resolveApiBaseUrl() {
  const configured = resolveConfigValue(DELETE_ACCOUNT_API_BASE_URL, "");
  if (!configured) {
    return "";
  }
  return configured.endsWith("/")
    ? configured.slice(0, configured.length - 1)
    : configured;
}

function buildApiUrl(path) {
  const base = resolveApiBaseUrl();
  return base ? `${base}${path}` : path;
}

function resolveCognitoRegion() {
  return resolveConfigValue(COGNITO_REGION, DEFAULT_COGNITO_REGION);
}

function resolveCognitoClientId() {
  return resolveConfigValue(COGNITO_APP_CLIENT_ID, "");
}

function resolveCognitoDomain() {
  const domain = resolveConfigValue(COGNITO_DOMAIN, "");
  return domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function resolveCognitoRedirectUri() {
  const fallback = `${window.location.origin}${window.location.pathname}`;
  return resolveConfigValue(COGNITO_REDIRECT_URI, fallback);
}

function resolveCognitoScopes() {
  const raw = resolveConfigValue(COGNITO_SCOPES, DEFAULT_COGNITO_SCOPES);
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function getCognitoIdpEndpoint() {
  return `https://cognito-idp.${resolveCognitoRegion()}.amazonaws.com/`;
}

function getHostedUiBaseUrl() {
  return `https://${resolveCognitoDomain()}`;
}

function resolvePasswordSignInEnabled() {
  const value = resolveConfigValue(COGNITO_ENABLE_PASSWORD_FLOW, "false");
  return value.toLowerCase() === "true";
}

function hasPasswordSignInConfig() {
  return Boolean(
    resolvePasswordSignInEnabled() &&
      resolveCognitoRegion() &&
      resolveCognitoClientId(),
  );
}

function hasHostedSignInConfig() {
  return Boolean(resolveCognitoClientId() && resolveCognitoDomain());
}

export function getDeleteAccountAuthCapabilities() {
  const hosted = hasHostedSignInConfig();
  return {
    password: hasPasswordSignInConfig(),
    hosted,
    google: hosted,
  };
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
  const raw = String(token || "").trim();
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

function deriveSessionUser(session) {
  const idClaims = decodeJwtClaims(session?.idToken);
  const accessClaims = decodeJwtClaims(session?.accessToken);
  const claims = idClaims || accessClaims || {};

  const userId = String(claims?.sub || "").trim() || null;
  const email = String(claims?.email || "").trim() || null;
  const username =
    String(claims?.["cognito:username"] || claims?.username || "").trim() ||
    null;
  const displayName = email || username || userId || "Authenticated user";

  return {
    userId,
    email,
    username,
    displayName,
  };
}

export function getAuthenticatedUserLabel(session) {
  return deriveSessionUser(session).displayName;
}

function persistSession(session) {
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function parseStoredSession() {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const accessToken = String(parsed.accessToken || "").trim();
    const idToken = String(parsed.idToken || "").trim();
    const expiresAt = Number(parsed.expiresAt || 0);
    if (!accessToken || !idToken || !Number.isFinite(expiresAt)) {
      return null;
    }

    if (Date.now() >= expiresAt) {
      return null;
    }

    return {
      accessToken,
      idToken,
      refreshToken: String(parsed.refreshToken || "").trim() || null,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function clearStoredSessionOnly() {
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function clearOAuthState() {
  window.sessionStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
  window.sessionStorage.removeItem(OAUTH_VERIFIER_STORAGE_KEY);
}

export function clearDeletionSession() {
  clearStoredSessionOnly();
  clearOAuthState();
}

export function getStoredDeletionSession() {
  const session = parseStoredSession();
  if (!session) {
    clearStoredSessionOnly();
    return null;
  }
  return session;
}

function buildSessionFromTokens(tokens = {}) {
  const accessToken = String(
    tokens.AccessToken || tokens.access_token || "",
  ).trim();
  const idToken = String(tokens.IdToken || tokens.id_token || "").trim();
  const refreshToken =
    String(tokens.RefreshToken || tokens.refresh_token || "").trim() || null;
  const expiresInSeconds = Number(
    tokens.ExpiresIn || tokens.expires_in || 3600,
  );

  if (!accessToken || !idToken) {
    throw new DeleteAccountApiError(
      "Sign-in did not return required session tokens.",
      {
        errorCode: "invalid_auth_response",
      },
    );
  }

  const ttl = Number.isFinite(expiresInSeconds)
    ? Math.max(60, expiresInSeconds)
    : 3600;
  return {
    accessToken,
    idToken,
    refreshToken,
    expiresAt: Date.now() + ttl * 1000,
  };
}

function mapSignInFailure(payload = {}, statusCode = 0) {
  const rawType = String(payload?.__type || payload?.name || "");
  const errorCode = rawType.includes("#")
    ? rawType.slice(rawType.lastIndexOf("#") + 1)
    : rawType || "signin_failed";
  const message = String(payload?.message || "").trim();

  if (
    errorCode === "NotAuthorizedException" ||
    errorCode === "UserNotFoundException"
  ) {
    return {
      message: "Incorrect username/email or password.",
      errorCode: "invalid_credentials",
      statusCode,
    };
  }

  if (
    errorCode === "InvalidParameterException" &&
    message.toLowerCase().includes("user_password_auth")
  ) {
    return {
      message:
        "Direct password sign-in is unavailable for this client. Use Cognito sign-in page.",
      errorCode: "password_flow_unavailable",
      statusCode,
    };
  }

  if (errorCode === "PasswordResetRequiredException") {
    return {
      message: "Password reset is required before sign-in.",
      errorCode: "password_reset_required",
      statusCode,
    };
  }

  return {
    message: "Sign-in failed. Please verify your credentials and try again.",
    errorCode,
    statusCode,
  };
}

async function resolveCognitoUsername(identifier) {
  const response = await fetch(buildApiUrl("/api/auth/resolve"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  const resolved = String(payload?.cognitoUsername || "").trim();
  return resolved || null;
}

export async function signInForDeletion(identifier, password) {
  if (!hasPasswordSignInConfig()) {
    throw new DeleteAccountApiError(
      "Password sign-in is not configured for this environment.",
      {
        errorCode: "auth_not_configured",
      },
    );
  }

  const normalizedIdentifier = String(identifier || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedIdentifier || !normalizedPassword) {
    throw new DeleteAccountApiError(
      "Username/email and password are required.",
      {
        errorCode: "missing_credentials",
      },
    );
  }

  let cognitoIdentifier = normalizedIdentifier;
  if (normalizedIdentifier.includes("@")) {
    const resolvedUsername = await resolveCognitoUsername(normalizedIdentifier);
    if (resolvedUsername) {
      cognitoIdentifier = resolvedUsername;
    }
  }

  const response = await fetch(getCognitoIdpEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: PASSWORD_SIGNIN_FLOW,
      ClientId: resolveCognitoClientId(),
      AuthParameters: {
        USERNAME: cognitoIdentifier,
        PASSWORD: normalizedPassword,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapSignInFailure(payload, response.status);
    throw new DeleteAccountApiError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  const session = buildSessionFromTokens(payload?.AuthenticationResult || {});
  persistSession(session);

  return {
    session,
    user: deriveSessionUser(session),
  };
}

async function startHostedSignIn({ identityProvider } = {}) {
  if (!hasHostedSignInConfig()) {
    throw new DeleteAccountApiError(
      "Hosted sign-in is not configured for this environment.",
      {
        errorCode: "auth_not_configured",
      },
    );
  }

  const state = createRandomToken(32);
  const verifier = createRandomToken(64);
  const challenge = await buildPkceChallenge(verifier);

  window.sessionStorage.setItem(OAUTH_STATE_STORAGE_KEY, state);
  window.sessionStorage.setItem(OAUTH_VERIFIER_STORAGE_KEY, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: resolveCognitoClientId(),
    redirect_uri: resolveCognitoRedirectUri(),
    scope: resolveCognitoScopes(),
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  if (identityProvider) {
    params.set("identity_provider", identityProvider);
  }

  window.location.assign(
    `${getHostedUiBaseUrl()}/oauth2/authorize?${params.toString()}`,
  );
}

export async function startGoogleSignInForDeletion() {
  await startHostedSignIn({ identityProvider: "Google" });
}

export async function startHostedSignInForDeletion() {
  await startHostedSignIn();
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

function mapBackendError(payload = {}, statusCode = 0, fallbackMessage) {
  const errorCode = String(payload?.error || payload?.code || "").trim();

  if (errorCode === "verification_rate_limited") {
    return {
      message: "Too many attempts. Please wait and try again.",
      errorCode,
      statusCode,
    };
  }

  if (errorCode === "invalid_or_expired_code") {
    return {
      message:
        "That code is invalid or expired. Request a new code and try again.",
      errorCode,
      statusCode,
    };
  }

  if (errorCode === "delete_verification_required") {
    return {
      message: "Email verification is required again before deletion.",
      errorCode,
      statusCode,
    };
  }

  if (
    errorCode === "unauthorized" ||
    errorCode === "access_token_required" ||
    statusCode === 401
  ) {
    return {
      message: "Session expired. Sign in again to continue.",
      errorCode: errorCode || "unauthorized",
      statusCode,
    };
  }

  return {
    message: fallbackMessage,
    errorCode: errorCode || "request_failed",
    statusCode,
  };
}

function buildAuthorizedHeaders(session, extra = {}) {
  const authToken = String(
    session?.idToken || session?.accessToken || "",
  ).trim();
  const accessToken = String(session?.accessToken || "").trim();

  if (!authToken || !accessToken) {
    throw new DeleteAccountApiError("Sign in again to continue.", {
      errorCode: "unauthorized",
      statusCode: 401,
    });
  }

  return {
    Authorization: `Bearer ${authToken}`,
    "X-Cognito-Access-Token": accessToken,
    ...extra,
  };
}

export async function completeHostedSignInForDeletion() {
  const url = new URL(window.location.href);
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    clearOAuthState();
    clearOAuthParamsFromUrl();
    return {
      handled: true,
      error:
        decodeURIComponent(oauthErrorDescription || "") ||
        "Sign-in was cancelled or failed.",
    };
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return { handled: false, error: null };
  }

  const returnedState = url.searchParams.get("state") || "";
  const expectedState =
    window.sessionStorage.getItem(OAUTH_STATE_STORAGE_KEY) || "";
  const verifier =
    window.sessionStorage.getItem(OAUTH_VERIFIER_STORAGE_KEY) || "";

  clearOAuthState();
  clearOAuthParamsFromUrl();

  if (
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState ||
    !verifier
  ) {
    throw new DeleteAccountApiError(
      "Sign-in verification failed. Please try again.",
      {
        errorCode: "oauth_state_mismatch",
      },
    );
  }

  const response = await fetch(`${getHostedUiBaseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: resolveCognitoClientId(),
      code,
      redirect_uri: resolveCognitoRedirectUri(),
      code_verifier: verifier,
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new DeleteAccountApiError(
      "Unable to complete sign-in. Please try again.",
      {
        statusCode: response.status,
        errorCode: "oauth_token_exchange_failed",
        payload,
      },
    );
  }

  const session = buildSessionFromTokens(payload);
  persistSession(session);

  return {
    handled: true,
    error: null,
    session,
    user: deriveSessionUser(session),
  };
}

export async function requestDeleteVerificationCode(session) {
  const response = await fetch(
    buildApiUrl("/api/me/delete-verification/send-code"),
    {
      method: "POST",
      headers: buildAuthorizedHeaders(session),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapBackendError(
      payload,
      response.status,
      "We could not send a verification code. Please try again.",
    );
    throw new DeleteAccountApiError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  return payload;
}

export async function verifyDeleteVerificationCode(session, code) {
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) {
    throw new DeleteAccountApiError("Verification code is required.", {
      errorCode: "missing_code",
      statusCode: 400,
    });
  }

  const response = await fetch(
    buildApiUrl("/api/me/delete-verification/verify-code"),
    {
      method: "POST",
      headers: buildAuthorizedHeaders(session, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ code: normalizedCode }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapBackendError(
      payload,
      response.status,
      "We could not verify that code. Please try again.",
    );
    throw new DeleteAccountApiError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  return payload;
}

export async function submitDeleteAccountRequest({
  session,
  deleteVerificationToken,
}) {
  const verificationToken = String(deleteVerificationToken || "").trim();
  if (!verificationToken) {
    throw new DeleteAccountApiError(
      "Email verification is required before deleting your account.",
      {
        errorCode: "delete_verification_required",
        statusCode: 412,
      },
    );
  }

  const response = await fetch(buildApiUrl("/api/me"), {
    method: "DELETE",
    headers: buildAuthorizedHeaders(session, {
      "X-Delete-Verification-Token": verificationToken,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapBackendError(
      payload,
      response.status,
      "Deletion request failed. Please try again.",
    );
    throw new DeleteAccountApiError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  return payload;
}
