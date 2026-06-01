const express = require("express");
const crypto = require("crypto");

const router = express.Router();
const callbackFormParser = express.urlencoded({ extended: false });
const callbackJsonParser = express.json({
  type: ["application/json", "application/*+json"],
});

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

function requestOrigin(req) {
  const configured = normalizeBaseUrl(process.env.PUBLIC_WEB_BASE_URL);
  if (configured) {
    return configured;
  }
  const forwardedProto = normalizeString(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${req.get("host")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildBackendCallbackUrl(provider, req) {
  const backendBaseUrl = normalizeBaseUrl(process.env.VIDEO_BACKEND_BASE_URL);
  if (!backendBaseUrl) {
    return "";
  }
  const url = new URL(
    `${backendBaseUrl}/api/social/oauth/${encodeURIComponent(provider)}/callback`,
  );
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, String(entry));
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildCompletionUrl(req, {
  provider = "",
  status = "error",
  message = "Connection failed.",
  connectionId = "",
} = {}) {
  const origin = requestOrigin(req);
  const url = new URL(`${origin}/oauth/complete`);
  if (provider) {
    url.searchParams.set("provider", provider);
  }
  if (status) {
    url.searchParams.set("status", status);
  }
  if (message) {
    url.searchParams.set("message", message);
  }
  if (connectionId) {
    url.searchParams.set("connectionId", connectionId);
  }
  url.searchParams.set("path", "/settings/connected-accounts");
  return url.toString();
}

function buildDataDeletionResponse(req, provider) {
  const origin = requestOrigin(req);
  const confirmationCode = `polis-${provider || "social"}-${crypto
    .randomBytes(8)
    .toString("hex")}`;
  return {
    url: `${origin}/delete-account.html`,
    confirmation_code: confirmationCode,
  };
}

function normalizeAppPath(value) {
  const normalized = normalizeString(value);
  if (!normalized || !normalized.startsWith("/")) {
    return "/settings/connected-accounts";
  }
  return normalized;
}

function appendCompletionParams(url, {
  provider,
  status,
  message,
  connectionId,
}) {
  if (provider) {
    url.searchParams.set("social_provider", provider);
  }
  if (status) {
    url.searchParams.set("social_status", status);
  }
  if (message) {
    url.searchParams.set("social_message", message);
  }
  if (connectionId) {
    url.searchParams.set("social_connection_id", connectionId);
  }
  return url;
}

function buildMobileDeepLink(appRoute) {
  const scheme =
    normalizeString(process.env.MOBILE_DEEP_LINK_SCHEME) ||
    normalizeString(process.env.MOBILE_APP_URL_SCHEME) ||
    normalizeString(process.env.STRIPE_RETURN_URL_SCHEME) ||
    "myapp";
  const host = normalizeString(process.env.MOBILE_DEEP_LINK_HOST) || "auth";
  const url = new URL(`${scheme}://${host}/`);
  url.searchParams.set("path", appRoute);
  return url.toString();
}

function buildAndroidIntentUrl({ deepLinkUrl, packageName, fallbackUrl }) {
  const parsed = new URL(deepLinkUrl);
  const scheme = parsed.protocol.replace(/:$/, "");
  const target = `${parsed.host}${parsed.pathname}${parsed.search}`;
  const parts = [
    `intent://${target}#Intent`,
    `scheme=${encodeURIComponent(scheme)}`,
  ];
  if (packageName) {
    parts.push(`package=${encodeURIComponent(packageName)}`);
  }
  if (fallbackUrl) {
    parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  }
  parts.push("end");
  return parts.join(";");
}

function completionPageHtml({
  origin,
  provider,
  status,
  message,
  connectionId,
  appPath,
}) {
  const target = appendCompletionParams(
    new URL(`${origin}${normalizeAppPath(appPath)}`),
    { provider, status, message, connectionId },
  );
  const webTargetUrl = target.toString();
  const appRoute = `${target.pathname}${target.search}`;
  const appTargetUrl = buildMobileDeepLink(appRoute);
  const androidTargetUrl = buildAndroidIntentUrl({
    deepLinkUrl: appTargetUrl,
    packageName:
      normalizeString(process.env.ANDROID_APP_PACKAGE) || "com.luxcorp.polis",
    fallbackUrl: webTargetUrl,
  });
  const headline = status === "success" ? "Connection complete" : "Connection issue";
  const actionLabel = status === "success" ? "Open Polis" : "Back to Polis";
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(headline)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f3ea;
        --ink: #17222d;
        --muted: #5c6470;
        --card: rgba(255, 255, 255, 0.94);
        --line: rgba(23, 34, 45, 0.08);
        --brand: #0d7c66;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(13, 124, 102, 0.16), transparent 28%),
          linear-gradient(180deg, #fbf9f2 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .shell {
        width: min(92vw, 520px);
        padding: 32px;
        border-radius: 28px;
        border: 1px solid var(--line);
        background: var(--card);
        box-shadow: 0 24px 64px rgba(21, 31, 41, 0.14);
      }
      .eyebrow {
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(13, 124, 102, 0.12);
        color: var(--brand);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 16px 0 8px;
        font-size: clamp(2rem, 5vw, 2.8rem);
        line-height: 1.04;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 180px;
        padding: 14px 18px;
        border-radius: 999px;
        border: 1px solid rgba(13, 124, 102, 0.18);
        text-decoration: none;
        color: #ffffff;
        background: linear-gradient(135deg, #0d7c66 0%, #129678 100%);
        font-weight: 700;
      }
      .status {
        margin-top: 16px;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="eyebrow">Polis</div>
      <h1>${escapeHtml(headline)}</h1>
      <p>${escapeHtml(message || "Returning you to the app.")}</p>
      <div class="actions">
        <a class="button" id="open-polis" href="${escapeHtml(appTargetUrl)}">${escapeHtml(actionLabel)}</a>
      </div>
      <p class="status">If Polis is installed, this page should reopen it automatically. If it does not, tap the button.</p>
    </main>
    <script>
      (function () {
        var appTarget = ${JSON.stringify(appTargetUrl)};
        var androidTarget = ${JSON.stringify(androidTargetUrl)};
        var isAndroid = /Android/i.test(navigator.userAgent || "");
        var target = isAndroid ? androidTarget : appTarget;
        var button = document.getElementById("open-polis");
        if (button) {
          button.href = target;
        }
        window.setTimeout(function () {
          window.location.assign(target);
        }, 250);
      })();
    </script>
  </body>
</html>`;
}

function parseJsonEnv(value, fallback) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return fallback;
  }
}

router.get("/oauth/:platform/callback", async (req, res) => {
  const provider = normalizeString(req.params.platform).toLowerCase();
  if (!provider) {
    res.redirect(
      buildCompletionUrl(req, {
        status: "error",
        message: "Unknown provider.",
      }),
    );
    return;
  }
  const callbackUrl = buildBackendCallbackUrl(provider, req);
  if (!callbackUrl) {
    res.redirect(
      buildCompletionUrl(req, {
        provider,
        status: "error",
        message: "VIDEO_BACKEND_BASE_URL is not configured.",
      }),
    );
    return;
  }

  try {
    const response = await fetch(callbackUrl, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    const completionUrl =
      normalizeString(payload?.completionUrl) ||
      buildCompletionUrl(req, {
        provider,
        status: response.ok ? "success" : "error",
        message:
          normalizeString(payload?.message) ||
          normalizeString(payload?.error) ||
          (response.ok ? "Connection complete." : "Connection failed."),
        connectionId: normalizeString(payload?.connection?.connectionId),
      });
    res.redirect(completionUrl);
  } catch (error) {
    res.redirect(
      buildCompletionUrl(req, {
        provider,
        status: "error",
        message:
          error instanceof Error ? error.message : "OAuth relay failed.",
      }),
    );
  }
});

router.get("/oauth/:platform/deauthorize", (req, res) => {
  const provider = normalizeString(req.params.platform).toLowerCase();
  res.json({ ok: true, provider });
});

router.post(
  "/oauth/:platform/deauthorize",
  callbackFormParser,
  callbackJsonParser,
  (req, res) => {
    const provider = normalizeString(req.params.platform).toLowerCase();
    res.json({ ok: true, provider });
  },
);

router.get("/oauth/:platform/data-deletion", (req, res) => {
  const provider = normalizeString(req.params.platform).toLowerCase();
  res.json(buildDataDeletionResponse(req, provider));
});

router.post(
  "/oauth/:platform/data-deletion",
  callbackFormParser,
  callbackJsonParser,
  (req, res) => {
    const provider = normalizeString(req.params.platform).toLowerCase();
    res.json(buildDataDeletionResponse(req, provider));
  },
);

router.get("/oauth/complete", (req, res) => {
  const origin = requestOrigin(req);
  const provider = normalizeString(req.query.provider);
  const status = normalizeString(req.query.status) || "success";
  const message = normalizeString(req.query.message);
  const connectionId = normalizeString(req.query.connectionId);
  const appPath = normalizeString(req.query.path) || "/settings/connected-accounts";
  res
    .set(
      "Content-Security-Policy",
      "default-src 'self' 'unsafe-inline' https: data:; img-src https: data:; connect-src https:;",
    )
    .type("html")
    .send(
      completionPageHtml({
        origin,
        provider,
        status,
        message,
        connectionId,
        appPath,
      }),
    );
});

router.get("/.well-known/oauth-client-metadata.json", (req, res) => {
  const origin = requestOrigin(req);
  const configuredUrl =
    normalizeString(process.env.BLUESKY_CLIENT_METADATA_URL) ||
    `${origin}/.well-known/oauth-client-metadata.json`;
  const redirectUri =
    normalizeString(process.env.BLUESKY_REDIRECT_URI) ||
    `${origin}/oauth/bluesky/callback`;
  const jwksUri =
    normalizeString(process.env.BLUESKY_JWKS_URL) ||
    `${origin}/.well-known/jwks.json`;
  const payload = {
    client_id: configuredUrl,
    client_name: normalizeString(process.env.BLUESKY_CLIENT_NAME) || "Polis",
    application_type: "native",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "atproto transition:generic",
    redirect_uris: [redirectUri],
    dpop_bound_access_tokens: true,
    jwks_uri: jwksUri,
    token_endpoint_auth_method: "none",
  };
  res.type("application/json").send(JSON.stringify(payload));
});

router.get("/.well-known/jwks.json", (_req, res) => {
  const payload = parseJsonEnv(process.env.BLUESKY_JWKS_JSON, { keys: [] });
  res.type("application/json").send(JSON.stringify(payload));
});

module.exports = router;
