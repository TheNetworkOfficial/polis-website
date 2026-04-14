const DEFAULT_COGNITO_REGION = "us-west-2";
const DEFAULT_COGNITO_SCOPES =
  "openid email profile aws.cognito.signin.user.admin";
const PASSWORD_SIGNIN_FLOW = "USER_PASSWORD_AUTH";
const REFRESH_TOKEN_FLOW = "REFRESH_TOKEN_AUTH";

const SESSION_STORAGE_KEY = "sharedFeedSession.v1";
const LOCAL_STORAGE_KEY = "sharedFeedSessionPersisted.v1";
const OAUTH_STATE_STORAGE_KEY = "sharedFeedOauthState.v1";
const OAUTH_VERIFIER_STORAGE_KEY = "sharedFeedOauthVerifier.v1";
const POST_AUTH_PATH_STORAGE_KEY = "sharedFeedPostAuthPath.v1";
const SESSION_REFRESH_LEEWAY_MS = 60 * 1000;

export class SharedFeedAuthError extends Error {
  constructor(
    message,
    { statusCode = 0, errorCode = "request_failed", payload = null } = {},
  ) {
    super(message);
    this.name = "SharedFeedAuthError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.payload = payload;
  }
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
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

function getSafeStorage(kind) {
  try {
    return window?.[kind] || null;
  } catch {
    return null;
  }
}

function readStoredValue(kind, key) {
  const storage = getSafeStorage(kind);
  if (!storage) {
    return "";
  }
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStoredValue(kind, key, value) {
  const storage = getSafeStorage(kind);
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota/privacy mode errors and continue in-memory.
  }
}

function removeStoredValue(kind, key) {
  const storage = getSafeStorage(kind);
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage quota/privacy mode errors and continue in-memory.
  }
}

function buildSessionFromTokens(tokens = {}, { refreshToken = "" } = {}) {
  const accessToken = normalizeString(
    tokens.AccessToken || tokens.access_token,
  );
  const idToken = normalizeString(tokens.IdToken || tokens.id_token);
  const resolvedRefreshToken =
    normalizeString(tokens.RefreshToken || tokens.refresh_token) ||
    normalizeString(refreshToken) ||
    null;
  const expiresInSeconds = Number(
    tokens.ExpiresIn || tokens.expires_in || 3600,
  );

  if (!accessToken || !idToken) {
    throw new SharedFeedAuthError("Sign-in did not return required tokens.", {
      errorCode: "invalid_auth_response",
    });
  }

  return {
    accessToken,
    idToken,
    refreshToken: resolvedRefreshToken,
    expiresAt:
      Date.now() +
      (Number.isFinite(expiresInSeconds)
        ? Math.max(60, expiresInSeconds)
        : 3600) *
        1000,
  };
}

function persistSession(session) {
  const serialized = JSON.stringify(session);
  writeStoredValue("sessionStorage", SESSION_STORAGE_KEY, serialized);
  writeStoredValue("localStorage", LOCAL_STORAGE_KEY, serialized);
}

function clearStoredSessionOnly() {
  removeStoredValue("sessionStorage", SESSION_STORAGE_KEY);
  removeStoredValue("localStorage", LOCAL_STORAGE_KEY);
}

function clearOAuthState() {
  removeStoredValue("sessionStorage", OAUTH_STATE_STORAGE_KEY);
  removeStoredValue("sessionStorage", OAUTH_VERIFIER_STORAGE_KEY);
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

function parseStoredSession(raw) {
  if (!normalizeString(raw)) {
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

function isSessionValid(session, leewayMs = SESSION_REFRESH_LEEWAY_MS) {
  const expiresAt = Number(session?.expiresAt || 0);
  return Boolean(
    Number.isFinite(expiresAt) && Date.now() + leewayMs < expiresAt,
  );
}

function getStoredSession({ allowExpired = false } = {}) {
  const candidates = [
    parseStoredSession(readStoredValue("sessionStorage", SESSION_STORAGE_KEY)),
    parseStoredSession(readStoredValue("localStorage", LOCAL_STORAGE_KEY)),
  ].filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  const session = candidates.sort(
    (left, right) =>
      Number(right?.expiresAt || 0) - Number(left?.expiresAt || 0),
  )[0];

  if (!allowExpired && !isSessionValid(session, 0)) {
    clearStoredSessionOnly();
    return null;
  }

  persistSession(session);
  return session;
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

function resolveApiBaseUrl(config = {}) {
  return normalizeBaseUrl(config.apiBaseUrl);
}

function buildApiUrl(config = {}, path) {
  const baseUrl = resolveApiBaseUrl(config);
  return baseUrl ? `${baseUrl}${path}` : path;
}

function resolveCognitoRegion(config = {}) {
  return normalizeString(config.region) || DEFAULT_COGNITO_REGION;
}

function resolveCognitoClientId(config = {}) {
  return normalizeString(config.clientId);
}

function resolveHostedUiBaseUrl(config = {}) {
  const domain = normalizeString(config.domain).replace(/^https?:\/\//i, "");
  return domain ? `https://${domain}` : "";
}

function resolveRedirectUri(config = {}) {
  return (
    normalizeString(config.redirectUri) ||
    `${window.location.origin}${window.location.pathname}`
  );
}

function resolveScopes(config = {}) {
  const raw = normalizeString(config.scopes) || DEFAULT_COGNITO_SCOPES;
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function getCognitoIdpEndpoint(config = {}) {
  return `https://cognito-idp.${resolveCognitoRegion(config)}.amazonaws.com/`;
}

function resolvePasswordSignInEnabled(config = {}) {
  return normalizeString(config.enablePasswordFlow).toLowerCase() === "true";
}

export function hasHostedSignInConfig(config = {}) {
  return Boolean(
    normalizeString(config.clientId) && normalizeString(config.domain),
  );
}

export function hasPasswordSignInConfig(config = {}) {
  return Boolean(
    resolvePasswordSignInEnabled(config) &&
      resolveCognitoRegion(config) &&
      resolveCognitoClientId(config),
  );
}

function hasDirectSignUpConfig(config = {}) {
  return Boolean(
    resolveCognitoRegion(config) && resolveCognitoClientId(config),
  );
}

function hasRefreshSessionConfig(config = {}) {
  return Boolean(
    resolveCognitoRegion(config) && resolveCognitoClientId(config),
  );
}

export function getSharedFeedAuthCapabilities(config = {}) {
  return {
    direct: hasDirectSignUpConfig(config),
    password: hasPasswordSignInConfig(config),
    hosted: hasHostedSignInConfig(config),
  };
}

export function buildAuthorizedHeaders(session, extra = {}, options = {}) {
  const authToken = normalizeString(session?.idToken || session?.accessToken);
  const accessToken = normalizeString(session?.accessToken);
  if (!authToken || !accessToken) {
    throw new Error("unauthorized");
  }

  const headers = {
    Authorization: `Bearer ${authToken}`,
    ...extra,
  };
  if (options.includeAccessToken === true) {
    headers["X-Cognito-Access-Token"] = accessToken;
  }
  return headers;
}

async function refreshSharedFeedSession(config = {}, session) {
  if (
    !hasRefreshSessionConfig(config) ||
    !normalizeString(session?.refreshToken)
  ) {
    return null;
  }

  const response = await fetch(getCognitoIdpEndpoint(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: REFRESH_TOKEN_FLOW,
      ClientId: resolveCognitoClientId(config),
      AuthParameters: {
        REFRESH_TOKEN: normalizeString(session.refreshToken),
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapAuthFailure(payload, response.status, {
      message: "Your session expired. Please sign in again.",
      errorCode: "session_refresh_failed",
    });
    throw new SharedFeedAuthError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  const refreshedSession = buildSessionFromTokens(
    payload?.AuthenticationResult || {},
    {
      refreshToken: session.refreshToken,
    },
  );
  persistSession(refreshedSession);
  return refreshedSession;
}

function sanitizeUsername(value) {
  let sanitized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/[.-]+/g, "_");
  sanitized = sanitized.replace(/^_+|_+$/g, "");
  return sanitized;
}

function generateUsernameFromEmail(email) {
  const baseSource = normalizeString(email).split("@")[0];
  let base = sanitizeUsername(baseSource);
  if (base.length < 3) {
    base = "user";
  }
  const suffix = Date.now().toString(36);
  let candidate = `${base}_${suffix}`;
  if (candidate.length > 20) {
    candidate = candidate.slice(0, 20);
  }
  if (candidate.length < 3) {
    candidate = `user_${suffix.slice(0, 6)}`;
  }
  return candidate;
}

function mapAuthFailure(payload = {}, statusCode = 0, fallbacks = {}) {
  const rawType = normalizeString(payload?.__type || payload?.name);
  const errorCode = rawType.includes("#")
    ? rawType.slice(rawType.lastIndexOf("#") + 1)
    : rawType || normalizeString(fallbacks.errorCode) || "request_failed";
  const message = normalizeString(payload?.message);
  const messageLower = message.toLowerCase();

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

  if (errorCode === "UserNotConfirmedException") {
    return {
      message:
        "Your account is not confirmed yet. Enter the verification code to finish signing up.",
      errorCode: "user_not_confirmed",
      statusCode,
    };
  }

  if (
    errorCode === "InvalidParameterException" &&
    messageLower.includes("user_password_auth")
  ) {
    return {
      message:
        "Direct password sign-in is unavailable for this client. Use the Cognito sign-in page instead.",
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

  if (
    errorCode === "UsernameExistsException" ||
    errorCode === "AliasExistsException"
  ) {
    return {
      message: "An account with that email already exists.",
      errorCode: "account_exists",
      statusCode,
    };
  }

  if (errorCode === "InvalidPasswordException") {
    return {
      message:
        message ||
        "Password must be at least 8 characters and meet Cognito requirements.",
      errorCode: "invalid_password",
      statusCode,
    };
  }

  if (errorCode === "CodeMismatchException") {
    return {
      message: "That code is invalid. Check the email and try again.",
      errorCode: "invalid_code",
      statusCode,
    };
  }

  if (errorCode === "ExpiredCodeException") {
    return {
      message: "That code expired. Request a new code and try again.",
      errorCode: "expired_code",
      statusCode,
    };
  }

  if (errorCode === "LimitExceededException") {
    return {
      message: "Too many attempts. Wait a moment and try again.",
      errorCode: "rate_limited",
      statusCode,
    };
  }

  return {
    message:
      message ||
      normalizeString(fallbacks.message) ||
      "Authentication failed. Try again.",
    errorCode,
    statusCode,
  };
}

async function resolveCognitoUsername(identifier, config = {}) {
  const normalizedIdentifier = normalizeString(identifier);
  if (!normalizedIdentifier || !normalizedIdentifier.includes("@")) {
    return null;
  }

  const response = await fetch(buildApiUrl(config, "/api/auth/resolve"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: normalizedIdentifier }),
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  return normalizeString(payload?.cognitoUsername) || null;
}

function persistPostAuthPath(path) {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath) {
    removeStoredValue("sessionStorage", POST_AUTH_PATH_STORAGE_KEY);
    return;
  }
  writeStoredValue(
    "sessionStorage",
    POST_AUTH_PATH_STORAGE_KEY,
    normalizedPath,
  );
}

export function setSharedFeedPostAuthPath(path) {
  persistPostAuthPath(path);
}

export function consumeSharedFeedPostAuthPath() {
  const value = normalizeString(
    readStoredValue("sessionStorage", POST_AUTH_PATH_STORAGE_KEY),
  );
  removeStoredValue("sessionStorage", POST_AUTH_PATH_STORAGE_KEY);
  return value;
}

async function startHostedAuth(
  config = {},
  { mode = "login", postAuthPath = "" } = {},
) {
  if (!hasHostedSignInConfig(config)) {
    throw new SharedFeedAuthError("Hosted sign-in is not configured.", {
      errorCode: "auth_not_configured",
    });
  }

  persistPostAuthPath(postAuthPath);

  const state = createRandomToken(32);
  const verifier = createRandomToken(64);
  const challenge = await buildPkceChallenge(verifier);

  writeStoredValue("sessionStorage", OAUTH_STATE_STORAGE_KEY, state);
  writeStoredValue("sessionStorage", OAUTH_VERIFIER_STORAGE_KEY, verifier);

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

export async function startHostedSignIn(config = {}, options = {}) {
  await startHostedAuth(config, { ...options, mode: "login" });
}

export async function startHostedSignUp(config = {}, options = {}) {
  await startHostedAuth(config, { ...options, mode: "signup" });
}

export async function signInSharedFeedWithPassword(
  config = {},
  { identifier = "", password = "" } = {},
) {
  if (!hasPasswordSignInConfig(config)) {
    throw new SharedFeedAuthError(
      "Password sign-in is not configured for this environment.",
      {
        errorCode: "auth_not_configured",
      },
    );
  }

  const normalizedIdentifier = normalizeString(identifier);
  const normalizedPassword = String(password || "");
  if (!normalizedIdentifier || !normalizedPassword) {
    throw new SharedFeedAuthError("Username/email and password are required.", {
      errorCode: "missing_credentials",
    });
  }

  let cognitoIdentifier = normalizedIdentifier;
  if (normalizedIdentifier.includes("@")) {
    const resolvedUsername = await resolveCognitoUsername(
      normalizedIdentifier,
      config,
    );
    if (resolvedUsername) {
      cognitoIdentifier = resolvedUsername;
    }
  }

  const response = await fetch(getCognitoIdpEndpoint(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: PASSWORD_SIGNIN_FLOW,
      ClientId: resolveCognitoClientId(config),
      AuthParameters: {
        USERNAME: cognitoIdentifier,
        PASSWORD: normalizedPassword,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapAuthFailure(payload, response.status, {
      message: "Sign-in failed. Try again.",
      errorCode: "signin_failed",
    });
    throw new SharedFeedAuthError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload: {
        ...payload,
        cognitoUsername: cognitoIdentifier,
        email: normalizedIdentifier.includes("@") ? normalizedIdentifier : "",
      },
    });
  }

  const session = buildSessionFromTokens(payload?.AuthenticationResult || {});
  persistSession(session);

  return {
    session,
    user: deriveSessionUser(session),
  };
}

export async function signUpSharedFeedWithEmail(
  config = {},
  { email = "", password = "" } = {},
) {
  if (!hasDirectSignUpConfig(config)) {
    throw new SharedFeedAuthError(
      "Direct sign-up is not configured for this environment.",
      {
        errorCode: "auth_not_configured",
      },
    );
  }

  const normalizedEmail = normalizeString(email).toLowerCase();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new SharedFeedAuthError("Enter a valid email address.", {
      errorCode: "invalid_email",
    });
  }
  if (normalizedPassword.length < 8) {
    throw new SharedFeedAuthError("Password must be at least 8 characters.", {
      errorCode: "invalid_password",
    });
  }

  const username = generateUsernameFromEmail(normalizedEmail);
  const response = await fetch(getCognitoIdpEndpoint(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.SignUp",
    },
    body: JSON.stringify({
      ClientId: resolveCognitoClientId(config),
      Username: username,
      Password: normalizedPassword,
      UserAttributes: [{ Name: "email", Value: normalizedEmail }],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapAuthFailure(payload, response.status, {
      message: "Sign-up failed. Try again.",
      errorCode: "signup_failed",
    });
    throw new SharedFeedAuthError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  const deliveryDetails = payload?.CodeDeliveryDetails || {};
  const deliveryDestination = normalizeString(deliveryDetails?.Destination);
  const deliveryMedium = normalizeString(deliveryDetails?.DeliveryMedium);
  const userSub = normalizeString(payload?.UserSub);
  const isComplete = payload?.UserConfirmed === true || !deliveryDestination;

  return {
    isComplete,
    nextStep: isComplete ? "none" : "confirmCode",
    username,
    deliveryDestination: deliveryDestination || null,
    deliveryMedium: deliveryMedium || null,
    userSub: userSub || null,
  };
}

export async function confirmSharedFeedSignUp(
  config = {},
  { username = "", code = "" } = {},
) {
  if (!hasDirectSignUpConfig(config)) {
    throw new SharedFeedAuthError(
      "Direct confirmation is not configured for this environment.",
      {
        errorCode: "auth_not_configured",
      },
    );
  }

  const normalizedUsername = normalizeString(username);
  const normalizedCode = normalizeString(code);
  if (!normalizedUsername || !normalizedCode) {
    throw new SharedFeedAuthError(
      "Username and confirmation code are required.",
      {
        errorCode: "missing_confirmation_details",
      },
    );
  }

  const response = await fetch(getCognitoIdpEndpoint(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.ConfirmSignUp",
    },
    body: JSON.stringify({
      ClientId: resolveCognitoClientId(config),
      Username: normalizedUsername,
      ConfirmationCode: normalizedCode,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapAuthFailure(payload, response.status, {
      message: "We could not confirm that code. Try again.",
      errorCode: "confirm_failed",
    });
    throw new SharedFeedAuthError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  return true;
}

export async function resendSharedFeedSignUpCode(
  config = {},
  { username = "" } = {},
) {
  if (!hasDirectSignUpConfig(config)) {
    throw new SharedFeedAuthError(
      "Direct confirmation is not configured for this environment.",
      {
        errorCode: "auth_not_configured",
      },
    );
  }

  const normalizedUsername = normalizeString(username);
  if (!normalizedUsername) {
    throw new SharedFeedAuthError("Username is required to resend a code.", {
      errorCode: "missing_username",
    });
  }

  const response = await fetch(getCognitoIdpEndpoint(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target":
        "AWSCognitoIdentityProviderService.ResendConfirmationCode",
    },
    body: JSON.stringify({
      ClientId: resolveCognitoClientId(config),
      Username: normalizedUsername,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mapped = mapAuthFailure(payload, response.status, {
      message: "We could not resend the verification code.",
      errorCode: "resend_failed",
    });
    throw new SharedFeedAuthError(mapped.message, {
      statusCode: mapped.statusCode,
      errorCode: mapped.errorCode,
      payload,
    });
  }

  const deliveryDetails = payload?.CodeDeliveryDetails || {};
  return {
    deliveryDestination: normalizeString(deliveryDetails?.Destination) || null,
    deliveryMedium: normalizeString(deliveryDetails?.DeliveryMedium) || null,
  };
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
      session: null,
      user: null,
      error: null,
    };
  }

  const returnedState = normalizeString(url.searchParams.get("state"));
  const expectedState = normalizeString(
    readStoredValue("sessionStorage", OAUTH_STATE_STORAGE_KEY),
  );
  const verifier = normalizeString(
    readStoredValue("sessionStorage", OAUTH_VERIFIER_STORAGE_KEY),
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

  const response = await fetch(
    `${resolveHostedUiBaseUrl(config)}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: normalizeString(config.clientId),
        code,
        redirect_uri: resolveRedirectUri(config),
        code_verifier: verifier,
      }).toString(),
    },
  );

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
  removeStoredValue("sessionStorage", POST_AUTH_PATH_STORAGE_KEY);
}

export function getStoredSharedFeedSession() {
  return getStoredSession();
}

export async function restoreSharedFeedSession(config = {}) {
  const storedSession = getStoredSession({ allowExpired: true });
  if (!storedSession) {
    return null;
  }

  if (isSessionValid(storedSession)) {
    return storedSession;
  }

  try {
    return await refreshSharedFeedSession(config, storedSession);
  } catch {
    clearStoredSessionOnly();
    return null;
  }
}

export function getAuthenticatedUser(session) {
  return session ? deriveSessionUser(session) : null;
}
