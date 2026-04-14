const express = require("express");
const { Resvg } = require("@resvg/resvg-js");

const router = express.Router();

const DEFAULT_ANDROID_PACKAGE = "com.luxcorp.polis";
const DEFAULT_BRAND_NAME = "Polis";
const SOCIAL_CARD_WIDTH = 1200;
const SOCIAL_CARD_HEIGHT = 630;
const SOCIAL_CARD_FETCH_TIMEOUT_MS = 5000;
const SOCIAL_CARD_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const APP_SHELL_ROUTE_DEFINITIONS = [
  { routeKey: "feed", pattern: /^\/feed$/u, params: [] },
  { routeKey: "candidates", pattern: /^\/candidates$/u, params: [] },
  {
    routeKey: "candidate-edit",
    pattern: /^\/candidates\/([^/]+)\/edit$/u,
    params: ["candidateId"],
  },
  {
    routeKey: "candidate-detail",
    pattern: /^\/candidates\/([^/]+)$/u,
    params: ["candidateId"],
  },
  { routeKey: "events", pattern: /^\/events$/u, params: [] },
  {
    routeKey: "event-detail",
    pattern: /^\/events\/([^/]+)$/u,
    params: ["eventId"],
  },
  { routeKey: "manage-events", pattern: /^\/manage-events$/u, params: [] },
  {
    routeKey: "manage-events-new",
    pattern: /^\/manage-events\/new$/u,
    params: [],
  },
  {
    routeKey: "manage-events-edit",
    pattern: /^\/manage-events\/([^/]+)\/edit$/u,
    params: ["eventId"],
  },
  { routeKey: "profile-self", pattern: /^\/profile$/u, params: [] },
  {
    routeKey: "profile-edit",
    pattern: /^\/profile\/edit$/u,
    params: [],
  },
  {
    routeKey: "profile-connections",
    pattern: /^\/profile\/connections$/u,
    params: [],
  },
  {
    routeKey: "profile-notifications",
    pattern: /^\/profile\/notifications$/u,
    params: [],
  },
  {
    routeKey: "profile-user",
    pattern: /^\/profile\/([^/]+)$/u,
    params: ["userId"],
  },
  { routeKey: "messages-root", pattern: /^\/messages$/u, params: [] },
  {
    routeKey: "messages-wildcard",
    pattern: /^\/messages\/(.+)$/u,
    params: ["messagePath"],
  },
];

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

function splitEnvList(value) {
  return normalizeString(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function resolveStoreUrls() {
  const iosStoreUrl = normalizeString(process.env.IOS_APP_STORE_URL);
  const iosStoreId = normalizeString(process.env.IOS_APP_STORE_ID);
  const androidPackage =
    normalizeString(process.env.ANDROID_APP_PACKAGE) || DEFAULT_ANDROID_PACKAGE;
  const androidStoreUrl = normalizeString(process.env.ANDROID_APP_STORE_URL);
  return {
    ios:
      iosStoreUrl ||
      (iosStoreId
        ? `https://apps.apple.com/us/app/id${encodeURIComponent(iosStoreId)}`
        : ""),
    android:
      androidStoreUrl ||
      `https://play.google.com/store/apps/details?id=${encodeURIComponent(androidPackage)}`,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function trimToLength(value, maxLength) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function initialsFromName(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "P";
  }
  const initials = normalized
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
  return initials || normalized.slice(0, 1).toUpperCase();
}

function wrapSvgText(value, { maxCharsPerLine = 32, maxLines = 3 } = {}) {
  const normalized = trimToLength(value, maxCharsPerLine * maxLines + 24);
  if (!normalized) {
    return [];
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  while (words.length > 0 && lines.length < maxLines) {
    const word = words.shift();
    if (!word) {
      continue;
    }
    if (lines.length === maxLines - 1) {
      const remainder = [current, word, ...words].filter(Boolean).join(" ");
      if (remainder) {
        lines.push(trimToLength(remainder, maxCharsPerLine));
      }
      return lines;
    }
    const proposal = current ? `${current} ${word}` : word;
    if (proposal.length <= maxCharsPerLine || !current) {
      current = proposal;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function buildSocialCardImageUrl(req, postId) {
  const origin = requestOrigin(req);
  if (!origin || !postId) {
    return "";
  }
  return `${origin}/posts/${encodeURIComponent(postId)}/social-card.png`;
}

async function fetchImageDataUri(url) {
  const normalized = normalizeString(url);
  if (!normalized) {
    return "";
  }
  try {
    const response = await fetch(normalized, {
      signal: AbortSignal.timeout(SOCIAL_CARD_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "image/png,image/jpeg,image/webp,image/*;q=0.8",
      },
    });
    if (!response.ok) {
      return "";
    }
    const contentType =
      normalizeString(response.headers.get("content-type")) || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > SOCIAL_CARD_MAX_IMAGE_BYTES) {
      return "";
    }
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

async function buildSocialCardAssets(shareCard) {
  const [mediaImage, authorAvatar] = await Promise.all([
    fetchImageDataUri(shareCard?.previewMediaThumbnail),
    fetchImageDataUri(shareCard?.authorAvatarUrl),
  ]);
  return { mediaImage, authorAvatar };
}

function renderSocialCardSvg({
  shareCard,
  mediaImage = "",
  authorAvatar = "",
}) {
  const brandName =
    trimToLength(shareCard?.brandName, 30) || DEFAULT_BRAND_NAME;
  const title =
    trimToLength(shareCard?.previewTitle, 120) || `${brandName} post`;
  const description =
    trimToLength(shareCard?.previewText, 220) ||
    `Open this post in ${brandName}.`;
  const authorDisplayName =
    trimToLength(shareCard?.authorDisplayName, 48) || "Post author";
  const authorUsername = trimToLength(shareCard?.authorUsername, 32);
  const mediaType = trimToLength(shareCard?.mediaType, 16) || "post";
  const titleLines = wrapSvgText(title, { maxCharsPerLine: 42, maxLines: 2 });
  const descriptionLines = wrapSvgText(description, {
    maxCharsPerLine: 48,
    maxLines: 2,
  });
  const initials = initialsFromName(authorDisplayName);
  const avatarMarkup = authorAvatar
    ? `<image href="${authorAvatar}" x="64" y="526" width="56" height="56" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
    : `<rect x="64" y="526" width="56" height="56" rx="18" fill="#D8F1E8" />
       <text x="92" y="563" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" fill="#0D7C66">${escapeXml(initials)}</text>`;
  const mediaMarkup = mediaImage
    ? `<image href="${mediaImage}" x="0" y="0" width="${SOCIAL_CARD_WIDTH}" height="${SOCIAL_CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice" />`
    : `<rect width="${SOCIAL_CARD_WIDTH}" height="${SOCIAL_CARD_HEIGHT}" fill="url(#fallbackBg)" />`;
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<tspan x="64" dy="${index === 0 ? 0 : 52}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const descriptionMarkup = descriptionLines
    .map(
      (line, index) =>
        `<tspan x="64" dy="${index === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const usernameMarkup = authorUsername
    ? `<text x="130" y="560" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#D8E1EB">@${escapeXml(authorUsername)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_CARD_WIDTH}" height="${SOCIAL_CARD_HEIGHT}" viewBox="0 0 ${SOCIAL_CARD_WIDTH} ${SOCIAL_CARD_HEIGHT}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(10,19,31,0.08)" />
        <stop offset="48%" stop-color="rgba(10,19,31,0.18)" />
        <stop offset="100%" stop-color="rgba(10,19,31,0.92)" />
      </linearGradient>
      <linearGradient id="fallbackBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0B1624" />
        <stop offset="55%" stop-color="#17314B" />
        <stop offset="100%" stop-color="#0D7C66" />
      </linearGradient>
      <clipPath id="avatarClip">
        <rect x="64" y="526" width="56" height="56" rx="18" />
      </clipPath>
    </defs>
    ${mediaMarkup}
    <rect width="${SOCIAL_CARD_WIDTH}" height="${SOCIAL_CARD_HEIGHT}" fill="url(#fade)" />
    <rect x="48" y="48" width="130" height="38" rx="19" fill="rgba(255,255,255,0.92)" />
    <text x="113" y="73" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#0D7C66">${escapeXml(brandName.toUpperCase())}</text>
    <rect x="1022" y="48" width="130" height="38" rx="19" fill="rgba(9,20,32,0.62)" />
    <text x="1087" y="73" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">${escapeXml(mediaType.toUpperCase())}</text>
    <text x="64" y="336" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800" fill="#FFFFFF">${titleMarkup}</text>
    <text x="64" y="468" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#D8E1EB">${descriptionMarkup}</text>
    ${avatarMarkup}
    <text x="130" y="540" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#FFFFFF">${escapeXml(authorDisplayName)}</text>
    ${usernameMarkup}
  </svg>`;
}

async function renderSocialCardPng(shareCard) {
  const assets = await buildSocialCardAssets(shareCard);
  const svg = renderSocialCardSvg({
    shareCard,
    mediaImage: assets.mediaImage,
    authorAvatar: assets.authorAvatar,
  });
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: SOCIAL_CARD_WIDTH,
    },
  });
  return resvg.render().asPng();
}

function buildShareCardEndpoint(postId) {
  const baseUrl = normalizeBaseUrl(process.env.VIDEO_BACKEND_BASE_URL);
  if (!baseUrl) {
    return "";
  }
  return `${baseUrl}/api/posts/${encodeURIComponent(postId)}/share-card`;
}

async function fetchShareCard(postId) {
  const endpoint = buildShareCardEndpoint(postId);
  if (!endpoint) {
    return {
      ok: false,
      statusCode: 500,
      error: "VIDEO_BACKEND_BASE_URL missing",
    };
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      statusCode: response.status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function resolveAppUrlScheme() {
  return (
    normalizeString(
      process.env.MOBILE_APP_URL_SCHEME ||
        process.env.APP_URL_SCHEME ||
        process.env.STRIPE_RETURN_URL_SCHEME,
    ) || "myapp"
  );
}

function buildAppOpenUrl(postId, commentId = "") {
  const normalizedPostId = normalizeString(postId);
  const scheme = resolveAppUrlScheme();
  if (!normalizedPostId || !scheme) {
    return "";
  }
  const path = `/posts/${encodeURIComponent(normalizedPostId)}`;
  const commentQuery = normalizeString(commentId)
    ? `?commentId=${encodeURIComponent(normalizeString(commentId))}`
    : "";
  return `${scheme}://auth/?path=${encodeURIComponent(`${path}${commentQuery}`)}`;
}

/**
 * Match a request pathname against the authenticated web app route set so the
 * backend can serve one shell for deep links and hard refreshes.
 */
function matchAppShellRoute(pathname) {
  const normalizedPath = normalizeString(pathname) || "/";
  for (const definition of APP_SHELL_ROUTE_DEFINITIONS) {
    const match = definition.pattern.exec(normalizedPath);
    if (!match) {
      continue;
    }
    const routeParams = {};
    definition.params.forEach((paramName, index) => {
      routeParams[paramName] = normalizeString(match[index + 1]);
    });
    return {
      routeKey: definition.routeKey,
      routePath: normalizedPath,
      routeParams,
    };
  }
  return null;
}

function getSharedRuntimeBase(req, { requestUrl, canonicalUrl } = {}) {
  const resolvedRequestUrl =
    normalizeString(requestUrl) || `${requestOrigin(req)}${req.originalUrl}`;
  const resolvedCanonicalUrl =
    normalizeString(canonicalUrl) || resolvedRequestUrl;
  const publicWebBaseUrl =
    normalizeBaseUrl(process.env.PUBLIC_WEB_BASE_URL) || requestOrigin(req);
  const storeUrls = resolveStoreUrls();

  return {
    brandName: DEFAULT_BRAND_NAME,
    requestUrl: resolvedRequestUrl,
    canonicalUrl: resolvedCanonicalUrl,
    publicWebBaseUrl,
    apiBaseUrl: normalizeBaseUrl(process.env.VIDEO_BACKEND_BASE_URL),
    appUrlScheme: resolveAppUrlScheme(),
    iosStoreUrl: storeUrls.ios,
    androidStoreUrl: storeUrls.android,
    auth: {
      clientId: normalizeString(process.env.COGNITO_APP_CLIENT_ID),
      domain: normalizeString(process.env.COGNITO_DOMAIN),
      scopes: normalizeString(process.env.COGNITO_SCOPES),
      redirectUri:
        normalizeString(process.env.COGNITO_REDIRECT_URI) || resolvedRequestUrl,
    },
    map: {
      styleUrl: normalizeString(process.env.VOTER_MAP_STYLE_URL),
      maptilerApiKey: normalizeString(process.env.MAPTILER_API_KEY),
    },
    messaging: {
      wsUrl:
        normalizeString(process.env.MESSAGING_WS_URL) ||
        normalizeString(process.env.MESSAGING_GATEWAY_URL),
    },
  };
}

function buildWebRuntimeConfig(req, options = {}) {
  const routePath =
    normalizeString(options.routePath) || normalizeString(req.path) || "/";
  const routeMatch = matchAppShellRoute(routePath);
  const routeParams =
    options.routeParams && typeof options.routeParams === "object"
      ? options.routeParams
      : routeMatch?.routeParams || {};
  const shareContext =
    options.shareContext && typeof options.shareContext === "object"
      ? options.shareContext
      : null;

  return {
    ...getSharedRuntimeBase(req, {
      requestUrl: options.requestUrl,
      canonicalUrl: options.canonicalUrl,
    }),
    route: routePath,
    routeKey:
      normalizeString(options.routeKey) ||
      normalizeString(routeMatch?.routeKey),
    routeParams,
    requiresAuth: options.requiresAuth === true,
    shareContext,
  };
}

function renderUnavailablePage({ title, subtitle, statusCode }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050608;
        --line: rgba(255, 255, 255, 0.12);
        --ink: #f7f8fb;
        --muted: rgba(232, 235, 245, 0.7);
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(255, 51, 95, 0.16), transparent 28%),
          linear-gradient(180deg, #0b0f15 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Avenir Next", "Space Grotesk", "IBM Plex Sans", sans-serif;
      }
      main {
        width: min(92vw, 540px);
        padding: 30px;
        border-radius: 28px;
        border: 1px solid var(--line);
        background: rgba(9, 12, 18, 0.92);
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.3);
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.65;
      }
      h1 {
        margin: 12px 0 10px;
        font-size: clamp(2rem, 5vw, 2.8rem);
        line-height: 1.02;
      }
      .eyebrow {
        color: rgba(255, 255, 255, 0.58);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .status {
        margin-top: 18px;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Polis post</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle)}</p>
      <p class="status">Status: ${escapeHtml(String(statusCode))}</p>
    </main>
  </body>
</html>`;
}

function renderWebShellPage({
  pageTitle,
  description,
  canonicalUrl,
  metaImage = "",
  brandName = DEFAULT_BRAND_NAME,
  runtimeConfig,
  eyebrow = DEFAULT_BRAND_NAME,
  headline,
  supportingCopy,
  primaryAction = "",
  secondaryActions = "",
  extraMeta = "",
}) {
  const safeTitle = normalizeString(pageTitle) || brandName;
  const safeDescription =
    normalizeString(description) || `Open ${brandName} on the web.`;
  const safeHeadline = normalizeString(headline) || safeTitle;
  const safeSupportingCopy = normalizeString(supportingCopy) || safeDescription;
  const inlineConfig = serializeForInlineScript(runtimeConfig || {});

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(safeTitle)}</title>
    <meta name="description" content="${escapeAttribute(safeDescription)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />
    <meta property="og:title" content="${escapeAttribute(safeTitle)}" />
    <meta property="og:description" content="${escapeAttribute(safeDescription)}" />
    ${
      metaImage
        ? `<meta property="og:image" content="${escapeAttribute(metaImage)}" />
    <meta property="og:image:secure_url" content="${escapeAttribute(metaImage)}" />
    <meta property="og:image:width" content="${String(SOCIAL_CARD_WIDTH)}" />
    <meta property="og:image:height" content="${String(SOCIAL_CARD_HEIGHT)}" />
    <meta name="twitter:image" content="${escapeAttribute(metaImage)}" />`
        : ""
    }
    <meta property="og:site_name" content="${escapeAttribute(brandName)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttribute(safeTitle)}" />
    <meta name="twitter:description" content="${escapeAttribute(safeDescription)}" />
    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />
    <link rel="stylesheet" href="/css/shared-feed.css" />
    ${extraMeta}
    <style>
      :root {
        color-scheme: dark;
        --bg: #050608;
        --ink: #f7f8fb;
        --muted: rgba(232, 235, 245, 0.7);
        --line: rgba(255, 255, 255, 0.12);
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 14% 12%, rgba(255, 51, 95, 0.18), transparent 28%),
          radial-gradient(circle at 84% 20%, rgba(37, 244, 238, 0.12), transparent 24%),
          linear-gradient(180deg, #0b0f15 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Avenir Next", "Space Grotesk", "IBM Plex Sans", sans-serif;
      }
      #shared-feed-app {
        min-height: 100vh;
      }
      .shared-feed-shell-fallback {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 28px;
      }
      .shared-feed-shell-fallback__card {
        width: min(92vw, 560px);
        padding: 30px;
        border-radius: 28px;
        background: rgba(9, 12, 18, 0.92);
        border: 1px solid var(--line);
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34);
      }
      .shared-feed-shell-fallback__eyebrow {
        margin: 0 0 10px;
        color: rgba(255, 255, 255, 0.58);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .shared-feed-shell-fallback__card h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3rem);
        line-height: 0.96;
      }
      .shared-feed-shell-fallback__card p {
        margin: 14px 0 0;
        color: var(--muted);
        line-height: 1.65;
      }
      .shared-feed-shell-fallback__actions {
        margin-top: 20px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .shared-feed-shell-fallback__button {
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
      }
      .shared-feed-shell-fallback__button--primary {
        border-color: transparent;
        background: linear-gradient(135deg, #ff335f, #ff6e88);
      }
    </style>
  </head>
  <body>
    <div id="shared-feed-app">
      <div class="shared-feed-shell-fallback">
        <div class="shared-feed-shell-fallback__card">
          <p class="shared-feed-shell-fallback__eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(safeHeadline)}</h1>
          <p>${escapeHtml(safeSupportingCopy)}</p>
          <div class="shared-feed-shell-fallback__actions">
            ${primaryAction}
            ${secondaryActions}
          </div>
        </div>
      </div>
    </div>
    <script>
      window.__POLIS_WEB_APP__ = ${inlineConfig};
      window.__POLIS_SHARED_FEED__ = window.__POLIS_WEB_APP__;
    </script>
    <script defer src="/scripts/shared-feed.js"></script>
    <noscript>
      <div class="shared-feed-shell-fallback">
        <div class="shared-feed-shell-fallback__card">
          <p class="shared-feed-shell-fallback__eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(safeHeadline)}</h1>
          <p>${escapeHtml(safeSupportingCopy)}</p>
        </div>
      </div>
    </noscript>
  </body>
</html>`;
}

function renderSharePage({
  req,
  shareCard,
  canonicalUrl,
  requestUrl,
  socialCardImageUrl,
  iosStoreUrl,
  androidStoreUrl,
}) {
  const brandName = normalizeString(shareCard.brandName) || DEFAULT_BRAND_NAME;
  const title =
    normalizeString(shareCard.previewTitle) ||
    normalizeString(shareCard.authorDisplayName) ||
    `${brandName} post`;
  const description =
    normalizeString(shareCard.previewText) || `Open this post in ${brandName}.`;
  const authorDisplayName =
    normalizeString(shareCard.authorDisplayName) || "Post author";
  const imageUrl = normalizeString(shareCard.previewMediaThumbnail);
  const metaImage = normalizeString(socialCardImageUrl) || imageUrl || "";
  const postId = normalizeString(shareCard.postId);
  const openAppUrl = buildAppOpenUrl(postId);
  const runtimeConfig = buildWebRuntimeConfig(req, {
    routePath: `/posts/${postId}`,
    routeKey: "share-post",
    canonicalUrl,
    requestUrl,
    requiresAuth: false,
    shareContext: {
      postId,
      title,
      description,
      brandName,
      canonicalUrl,
      requestUrl,
      openAppUrl,
      authorDisplayName,
    },
  });
  runtimeConfig.iosStoreUrl = iosStoreUrl;
  runtimeConfig.androidStoreUrl = androidStoreUrl;

  return renderWebShellPage({
    pageTitle: `${title} | ${brandName}`,
    description,
    canonicalUrl,
    metaImage,
    brandName,
    runtimeConfig,
    eyebrow: brandName,
    headline: title,
    supportingCopy: description,
    primaryAction: openAppUrl
      ? `<a class="shared-feed-shell-fallback__button shared-feed-shell-fallback__button--primary" href="${escapeAttribute(openAppUrl)}">Open in app</a>`
      : "",
    secondaryActions: `
      ${
        androidStoreUrl
          ? `<a class="shared-feed-shell-fallback__button" href="${escapeAttribute(androidStoreUrl)}" target="_blank" rel="noopener noreferrer">Android</a>`
          : ""
      }
      ${
        iosStoreUrl
          ? `<a class="shared-feed-shell-fallback__button" href="${escapeAttribute(iosStoreUrl)}" target="_blank" rel="noopener noreferrer">iPhone</a>`
          : ""
      }
    `,
    extraMeta: `
      <meta property="og:image:alt" content="${escapeAttribute(`${brandName} post preview for ${authorDisplayName}`)}" />
      <meta name="twitter:image:alt" content="${escapeAttribute(`${brandName} post preview for ${authorDisplayName}`)}" />
    `,
  });
}

function getAppShellPageMeta(routeMatch) {
  const routeKey = normalizeString(routeMatch?.routeKey);
  const routeParams = routeMatch?.routeParams || {};

  switch (routeKey) {
    case "feed":
      return {
        title: "Feed | Polis",
        description: "Your Polis feed on the web.",
        eyebrow: "Polis web",
        headline: "Your Polis feed",
        supportingCopy:
          "Sign in to continue into the full Polis experience from the browser.",
      };
    case "candidates":
    case "candidate-detail":
    case "candidate-edit":
      return {
        title: "Candidates | Polis",
        description: "Browse candidates and campaign activity in Polis.",
        eyebrow: "Candidates",
        headline: "Candidate pages on the web",
        supportingCopy:
          "Sign in to browse candidates, follow campaigns, and manage your candidate page.",
      };
    case "events":
    case "event-detail":
    case "manage-events":
    case "manage-events-new":
    case "manage-events-edit":
      return {
        title: "Events | Polis",
        description: "Discover and manage local Polis events from the browser.",
        eyebrow: "Events",
        headline: "Events in Polis",
        supportingCopy:
          "Sign in to browse events, RSVP, and manage your own event pages.",
      };
    case "profile-self":
    case "profile-user":
    case "profile-edit":
    case "profile-connections":
    case "profile-notifications":
      return {
        title: "Profile | Polis",
        description:
          "Open your Polis profile, posts, connections, and notifications.",
        eyebrow: "Profile",
        headline:
          routeKey === "profile-user" && routeParams.userId
            ? `Profile ${routeParams.userId}`
            : "Your Polis profile",
        supportingCopy:
          "Sign in to view your profile, connections, notifications, and edit your public page.",
      };
    case "messages-root":
    case "messages-wildcard":
      return {
        title: "Messages | Polis",
        description: "Open Polis messaging in the browser.",
        eyebrow: "Messages",
        headline: "Messaging on the web",
        supportingCopy:
          "Sign in to open your inbox, requests, conversations, device security, and server spaces.",
      };
    default:
      return {
        title: "Polis",
        description: "Open Polis on the web.",
        eyebrow: "Polis",
        headline: "Polis on the web",
        supportingCopy:
          "Sign in to continue into the authenticated Polis web experience.",
      };
  }
}

function renderAppShellPage(req, routeMatch) {
  const requestUrl = `${requestOrigin(req)}${req.originalUrl}`;
  const canonicalUrl = `${requestOrigin(req)}${req.path}`;
  const meta = getAppShellPageMeta(routeMatch);
  const runtimeConfig = buildWebRuntimeConfig(req, {
    routePath: routeMatch.routePath,
    routeKey: routeMatch.routeKey,
    routeParams: routeMatch.routeParams,
    canonicalUrl,
    requestUrl,
    requiresAuth: true,
  });

  return renderWebShellPage({
    pageTitle: meta.title,
    description: meta.description,
    canonicalUrl,
    brandName: runtimeConfig.brandName || DEFAULT_BRAND_NAME,
    runtimeConfig,
    eyebrow: meta.eyebrow,
    headline: meta.headline,
    supportingCopy: meta.supportingCopy,
    primaryAction:
      '<button class="shared-feed-shell-fallback__button shared-feed-shell-fallback__button--primary" type="button">Loading…</button>',
  });
}

router.get("/profile-tab", (req, res) => {
  const query = req.url.includes("?")
    ? req.url.slice(req.url.indexOf("?"))
    : "";
  res.redirect(302, `/profile${query}`);
});

router.get(
  [
    "/feed",
    "/candidates",
    "/candidates/:candidateId",
    "/candidates/:candidateId/edit",
    "/events",
    "/events/:eventId",
    "/manage-events",
    "/manage-events/new",
    "/manage-events/:eventId/edit",
    "/profile",
    "/profile/edit",
    "/profile/connections",
    "/profile/notifications",
    "/profile/:userId",
    "/messages",
    "/messages/*",
  ],
  (req, res) => {
    const routeMatch = matchAppShellRoute(req.path);
    if (!routeMatch) {
      res.status(404).send(
        renderUnavailablePage({
          title: "Page unavailable",
          subtitle: "This app route could not be resolved.",
          statusCode: 404,
        }),
      );
      return;
    }

    res.status(200).type("html").send(renderAppShellPage(req, routeMatch));
  },
);

router.get("/posts/:postId", async (req, res) => {
  const postId = normalizeString(req.params.postId);
  if (!postId) {
    res.status(404).send(
      renderUnavailablePage({
        title: "Post unavailable",
        subtitle: "This share link is missing its post id.",
        statusCode: 404,
      }),
    );
    return;
  }

  const result = await fetchShareCard(postId);
  if (!result.ok) {
    const statusCode =
      result.statusCode === 410 ? 410 : result.statusCode === 404 ? 404 : 502;
    res.status(statusCode).send(
      renderUnavailablePage({
        title: statusCode === 410 ? "Post removed" : "Post unavailable",
        subtitle:
          statusCode === 410
            ? "This post is no longer available."
            : "This post cannot be displayed on the web.",
        statusCode,
      }),
    );
    return;
  }

  const shareCard = result.payload?.shareCard;
  const canonicalUrl =
    normalizeString(shareCard?.canonicalUrl) ||
    `${requestOrigin(req)}/posts/${encodeURIComponent(postId)}`;
  const requestUrl = `${requestOrigin(req)}${req.originalUrl}`;
  const storeUrls = resolveStoreUrls();

  res
    .status(200)
    .type("html")
    .send(
      renderSharePage({
        req,
        shareCard,
        canonicalUrl,
        requestUrl,
        socialCardImageUrl: buildSocialCardImageUrl(req, postId),
        iosStoreUrl: storeUrls.ios,
        androidStoreUrl: storeUrls.android,
      }),
    );
});

router.get("/posts/:postId/social-card.png", async (req, res) => {
  const postId = normalizeString(req.params.postId);
  if (!postId) {
    res.status(404).end();
    return;
  }

  const result = await fetchShareCard(postId);
  if (!result.ok || !result.payload?.shareCard) {
    const statusCode =
      result.statusCode === 410 ? 410 : result.statusCode === 404 ? 404 : 502;
    res.status(statusCode).end();
    return;
  }

  try {
    const png = await renderSocialCardPng(result.payload.shareCard);
    res
      .status(200)
      .type("png")
      .set("Cache-Control", "public, max-age=300, s-maxage=300")
      .send(Buffer.from(png));
  } catch {
    res.status(502).end();
  }
});

router.get("/.well-known/assetlinks.json", (_req, res) => {
  const packageName =
    normalizeString(process.env.ANDROID_APP_PACKAGE) || DEFAULT_ANDROID_PACKAGE;
  const fingerprints = splitEnvList(
    process.env.ANDROID_SHA256_CERT_FINGERPRINTS,
  );
  const payload =
    fingerprints.length > 0
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  res.type("application/json").send(JSON.stringify(payload));
});

router.get("/.well-known/apple-app-site-association", (_req, res) => {
  const appIds = splitEnvList(
    process.env.IOS_APP_IDS || process.env.IOS_APP_ID,
  );
  const details =
    appIds.length > 0
      ? [
          {
            appIDs: appIds,
            components: [
              { "/": "/feed" },
              { "/": "/candidates" },
              { "/": "/candidates/*" },
              { "/": "/cta-invite/*" },
              { "/": "/events/*" },
              { "/": "/manage-events/*" },
              { "/": "/posts/*" },
              { "/": "/profile" },
              { "/": "/profile/*" },
              { "/": "/messages/*" },
              { "/": "/settings/*" },
            ],
          },
        ]
      : [];

  res.type("application/json").send(
    JSON.stringify({
      applinks: {
        apps: [],
        details,
      },
    }),
  );
});

module.exports = router;
