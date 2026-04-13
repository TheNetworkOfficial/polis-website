const express = require("express");
const { Resvg } = require("@resvg/resvg-js");

const router = express.Router();

const DEFAULT_ANDROID_PACKAGE = "com.luxcorp.polis";
const DEFAULT_BRAND_NAME = "Polis";
const SOCIAL_CARD_WIDTH = 1200;
const SOCIAL_CARD_HEIGHT = 630;
const SOCIAL_CARD_FETCH_TIMEOUT_MS = 5000;
const SOCIAL_CARD_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

function wrapSvgText(value, {
  maxCharsPerLine = 32,
  maxLines = 3,
} = {}) {
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
    const contentType = normalizeString(response.headers.get("content-type")) || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > SOCIAL_CARD_MAX_IMAGE_BYTES) {
      return "";
    }
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch (_error) {
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
  const brandName = trimToLength(shareCard?.brandName, 30) || DEFAULT_BRAND_NAME;
  const title = trimToLength(shareCard?.previewTitle, 120) || `${brandName} post`;
  const description =
    trimToLength(shareCard?.previewText, 220) || `Open this post in ${brandName}.`;
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

function renderActionLinks({ canonicalUrl, iosStoreUrl, androidStoreUrl }) {
  const links = [
    `<a class="share-button share-button--primary" href="${escapeAttribute(canonicalUrl)}">Open in app</a>`,
  ];
  if (iosStoreUrl) {
    links.push(
      `<a class="share-button" href="${escapeAttribute(iosStoreUrl)}" target="_blank" rel="noopener noreferrer">Download on iPhone</a>`,
    );
  }
  if (androidStoreUrl) {
    links.push(
      `<a class="share-button" href="${escapeAttribute(androidStoreUrl)}" target="_blank" rel="noopener noreferrer">Download on Android</a>`,
    );
  }
  return links.join("");
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
        color-scheme: light;
        --bg: #f3f1eb;
        --card: #ffffff;
        --ink: #1f2430;
        --muted: #5a6474;
        --line: #d7dce5;
        --brand: #0d7c66;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(13, 124, 102, 0.12), transparent 32%),
          linear-gradient(180deg, #faf8f2 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .shell {
        width: min(92vw, 540px);
        padding: 32px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 28px 70px rgba(18, 30, 46, 0.12);
      }
      .eyebrow {
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(13, 124, 102, 0.12);
        color: var(--brand);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 10px;
        font-size: clamp(2rem, 5vw, 2.8rem);
        line-height: 1.04;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .status {
        margin-top: 18px;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="eyebrow">Polis Post</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle)}</p>
      <p class="status">Status: ${escapeHtml(String(statusCode))}</p>
    </main>
  </body>
</html>`;
}

function renderSharePage({
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
  const authorUsername = normalizeString(shareCard.authorUsername);
  const authorAvatarUrl = normalizeString(shareCard.authorAvatarUrl);
  const imageUrl = normalizeString(shareCard.previewMediaThumbnail);
  const mediaType = normalizeString(shareCard.mediaType) || "post";
  const metaImage = normalizeString(socialCardImageUrl) || imageUrl || "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | ${escapeHtml(brandName)}</title>
    <meta name="description" content="${escapeAttribute(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />
    <meta property="og:title" content="${escapeAttribute(title)}" />
    <meta property="og:description" content="${escapeAttribute(description)}" />
    <meta property="og:image" content="${escapeAttribute(metaImage)}" />
    <meta property="og:image:secure_url" content="${escapeAttribute(metaImage)}" />
    <meta property="og:image:width" content="${String(SOCIAL_CARD_WIDTH)}" />
    <meta property="og:image:height" content="${String(SOCIAL_CARD_HEIGHT)}" />
    <meta property="og:image:alt" content="${escapeAttribute(`${brandName} post preview for ${authorDisplayName}`)}" />
    <meta property="og:site_name" content="${escapeAttribute(brandName)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttribute(title)}" />
    <meta name="twitter:description" content="${escapeAttribute(description)}" />
    <meta name="twitter:image" content="${escapeAttribute(metaImage)}" />
    <meta name="twitter:image:alt" content="${escapeAttribute(`${brandName} post preview for ${authorDisplayName}`)}" />
    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1e8;
        --card: rgba(255, 255, 255, 0.94);
        --ink: #18212d;
        --muted: #536072;
        --line: #d5dbe4;
        --brand: #0d7c66;
        --brand-soft: rgba(13, 124, 102, 0.12);
        --shadow: 0 28px 80px rgba(19, 31, 46, 0.12);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(13, 124, 102, 0.18), transparent 34%),
          radial-gradient(circle at bottom right, rgba(24, 33, 45, 0.1), transparent 28%),
          linear-gradient(180deg, #fbfaf5 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Segoe UI", Arial, sans-serif;
      }
      main {
        width: min(94vw, 1080px);
        margin: 0 auto;
        padding: 32px 0 48px;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--brand-soft);
        color: var(--brand);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .brand__dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--brand);
      }
      .hero {
        display: grid;
        gap: 24px;
        grid-template-columns: minmax(0, 1.2fr) minmax(280px, 360px);
        margin-top: 20px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 30px;
        background: var(--card);
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .content {
        padding: 28px;
      }
      .eyebrow {
        color: var(--brand);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 14px 0 16px;
        font-size: clamp(2.2rem, 5vw, 4.4rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }
      .summary {
        margin: 0;
        max-width: 56ch;
        color: var(--muted);
        font-size: 1.05rem;
        line-height: 1.65;
      }
      .author {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: center;
        margin-top: 24px;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.92);
      }
      .author__avatar,
      .author__avatar-fallback {
        width: 52px;
        height: 52px;
        border-radius: 16px;
      }
      .author__avatar {
        object-fit: cover;
      }
      .author__avatar-fallback {
        display: grid;
        place-items: center;
        background: var(--brand-soft);
        color: var(--brand);
        font-weight: 800;
        font-size: 1.1rem;
      }
      .author__name {
        font-weight: 700;
        font-size: 1.02rem;
      }
      .author__username {
        color: var(--muted);
        font-size: 0.92rem;
        margin-top: 3px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      .share-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: #fff;
        color: var(--ink);
        text-decoration: none;
        font-weight: 700;
      }
      .share-button--primary {
        border-color: transparent;
        background: var(--brand);
        color: #fff;
      }
      .meta {
        margin-top: 18px;
        color: var(--muted);
        font-size: 0.92rem;
      }
      .media {
        padding: 18px;
      }
      .media__frame {
        position: relative;
        aspect-ratio: 9 / 16;
        border-radius: 22px;
        overflow: hidden;
        background: #e6ebf2;
      }
      .media__frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .media__badge {
        position: absolute;
        left: 12px;
        top: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(24, 33, 45, 0.74);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .media__footer {
        margin-top: 14px;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.55;
      }
      @media (max-width: 880px) {
        .hero {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <span class="brand__dot"></span>
        <span>${escapeHtml(brandName)}</span>
      </div>
      <section class="hero">
        <article class="card content">
          <div class="eyebrow">${escapeHtml(brandName)} Public Post</div>
          <h1>${escapeHtml(title)}</h1>
          <p class="summary">${escapeHtml(description)}</p>
          <section class="author">
            ${
              authorAvatarUrl
                ? `<img class="author__avatar" src="${escapeAttribute(authorAvatarUrl)}" alt="${escapeAttribute(authorDisplayName)}" />`
                : `<div class="author__avatar-fallback">${escapeHtml(authorDisplayName.slice(0, 1).toUpperCase() || "P")}</div>`
            }
            <div>
              <div class="author__name">${escapeHtml(authorDisplayName)}</div>
              ${
                authorUsername
                  ? `<div class="author__username">@${escapeHtml(authorUsername)}</div>`
                  : ""
              }
            </div>
          </section>
          <div class="actions">
            ${renderActionLinks({
              canonicalUrl,
              iosStoreUrl,
              androidStoreUrl,
            })}
          </div>
          <div class="meta">
            Share URL: <a href="${escapeAttribute(requestUrl)}">${escapeHtml(requestUrl)}</a>
          </div>
        </article>
        <aside class="card media">
          <div class="media__frame">
            ${
              imageUrl
                ? `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}" />`
                : ""
            }
            <div class="media__badge">${escapeHtml(mediaType)}</div>
          </div>
          <div class="media__footer">
            If the ${escapeHtml(brandName)} app is installed, opening this public link should route into the app. Otherwise this browser page remains available.
          </div>
        </aside>
      </section>
    </main>
  </body>
</html>`;
}

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
  } catch (_error) {
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
              { "/": "/cta-invite/*" },
              { "/": "/events/*" },
              { "/": "/posts/*" },
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
