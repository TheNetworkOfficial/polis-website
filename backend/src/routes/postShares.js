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

function extractVideoDeliveryId(url) {
  const normalized = normalizeString(url);
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    const host = normalizeString(parsed.hostname)?.toLowerCase() || "";
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    if (!pathSegments.length) {
      return "";
    }
    if (host === "videodelivery.net" || host.endsWith(".videodelivery.net")) {
      return normalizeString(pathSegments[0]) || "";
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function buildPublicVideoUrls(deliveryId) {
  const normalized = normalizeString(deliveryId);
  if (!normalized) {
    return null;
  }
  const encoded = encodeURIComponent(normalized);
  const base = `https://videodelivery.net/${encoded}`;
  return {
    hlsUrl: `${base}/manifest/video.m3u8`,
    mp4Url: `${base}/downloads/default.mp4`,
    posterUrl: `${base}/thumbnails/thumbnail.jpg?time=1s&height=960`,
  };
}

function resolveShareMedia(shareCard) {
  const mediaType =
    normalizeString(shareCard?.mediaType).toLowerCase() || "post";
  const previewImage = normalizeString(shareCard?.previewMediaThumbnail);
  if (mediaType === "video") {
    const deliveryId = extractVideoDeliveryId(previewImage);
    const publicUrls = buildPublicVideoUrls(deliveryId);
    if (publicUrls) {
      return {
        kind: "video",
        posterUrl: publicUrls.posterUrl || previewImage || "",
        hlsUrl: publicUrls.hlsUrl || "",
        mp4Url: publicUrls.mp4Url || "",
      };
    }
  }
  return {
    kind: "image",
    posterUrl: previewImage || "",
    hlsUrl: "",
    mp4Url: "",
  };
}

function renderActionLinks({ openAppUrl, iosStoreUrl, androidStoreUrl }) {
  const links = [];
  if (openAppUrl) {
    links.push(
      `<a class="share-button share-button--primary" href="${escapeAttribute(openAppUrl)}" data-open-app-link="1">Open in app</a>`,
    );
  }
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
  if (!links.length) {
    links.push(
      `<a class="share-button share-button--primary" href="${escapeAttribute(openAppUrl || "")}" data-open-app-link="1">Open in app</a>`,
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
  const shareMedia = resolveShareMedia(shareCard);
  const postId = normalizeString(shareCard.postId);
  const openAppUrl = buildAppOpenUrl(postId);
  const inlineShareState = serializeForInlineScript({
    canonicalUrl,
    requestUrl,
    postId,
    shareText: description,
    openAppUrl,
    iosStoreUrl,
    androidStoreUrl,
    shareMedia: {
      kind: shareMedia.kind,
      posterUrl: shareMedia.posterUrl,
      hlsUrl: shareMedia.hlsUrl,
    },
  });

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
    ${
      shareMedia.kind === "video" && shareMedia.hlsUrl
        ? '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>'
        : ""
    }
    <style>
      :root {
        color-scheme: dark;
        --bg: #080b10;
        --surface: rgba(17, 22, 31, 0.9);
        --surface-soft: rgba(255, 255, 255, 0.06);
        --line: rgba(255, 255, 255, 0.12);
        --ink: #f8fafc;
        --muted: rgba(223, 229, 240, 0.76);
        --brand: #ff355d;
        --accent: #25f4ee;
        --shadow: 0 40px 90px rgba(0, 0, 0, 0.42);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 14% 12%, rgba(255, 53, 93, 0.16), transparent 28%),
          radial-gradient(circle at 84% 20%, rgba(37, 244, 238, 0.14), transparent 24%),
          linear-gradient(180deg, #0b0f15 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Segoe UI", Arial, sans-serif;
      }
      a { color: inherit; }
      main {
        width: min(1480px, calc(100vw - 36px));
        min-height: 100vh;
        margin: 0 auto;
        padding: 20px 0 28px;
        display: grid;
        gap: 24px;
        grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) minmax(250px, 300px);
        align-items: stretch;
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--surface);
        backdrop-filter: blur(18px);
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .panel__inner {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 26px 24px;
        height: 100%;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        width: fit-content;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(255, 53, 93, 0.18);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .brand__dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--brand), var(--accent));
      }
      .eyebrow {
        margin: 0;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 {
        margin: 12px 0 0;
        font-size: clamp(2rem, 3vw, 3.4rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }
      .summary {
        margin: 16px 0 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      .author {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: center;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--surface-soft);
      }
      .author__avatar,
      .author__avatar-fallback {
        width: 58px;
        height: 58px;
        border-radius: 18px;
      }
      .author__avatar {
        display: block;
        object-fit: cover;
      }
      .author__avatar-fallback {
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, rgba(255, 53, 93, 0.26), rgba(37, 244, 238, 0.18));
        color: #fff;
        font-size: 1.12rem;
        font-weight: 800;
      }
      .author__name {
        font-weight: 700;
        font-size: 1rem;
      }
      .author__username {
        color: var(--muted);
        font-size: 0.94rem;
        margin-top: 4px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .share-button,
      .rail__button {
        appearance: none;
        border: 1px solid var(--line);
        background: var(--surface-soft);
        color: var(--ink);
        text-decoration: none;
        cursor: pointer;
      }
      .share-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 50px;
        padding: 0 18px;
        border-radius: 18px;
        font-weight: 700;
      }
      .share-button--primary {
        border-color: transparent;
        background: linear-gradient(135deg, var(--brand), #ff6e7f);
        color: #fff;
        box-shadow: 0 18px 36px rgba(255, 53, 93, 0.28);
      }
      .helper,
      .meta-card p,
      .meta-card li {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--surface-soft);
        font-size: 0.88rem;
        font-weight: 600;
      }
      .status-pill::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--brand), var(--accent));
      }
      .feedback {
        min-height: 1.2em;
        color: var(--muted);
        font-size: 0.84rem;
      }
      .stage {
        position: relative;
        display: grid;
        place-items: center;
      }
      .stage::before,
      .stage::after {
        content: "";
        position: absolute;
        width: 240px;
        height: 240px;
        border-radius: 50%;
        filter: blur(70px);
      }
      .stage::before {
        top: 4%;
        left: 8%;
        background: rgba(255, 53, 93, 0.18);
      }
      .stage::after {
        right: 10%;
        bottom: 10%;
        background: rgba(37, 244, 238, 0.14);
      }
      .viewer {
        position: relative;
        z-index: 1;
        width: min(100%, 920px);
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
      }
      .phone-shell {
        border-radius: 34px;
        padding: 14px;
        background:
          linear-gradient(160deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.02)),
          rgba(7, 10, 15, 0.96);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.08),
          0 44px 100px rgba(0, 0, 0, 0.48);
      }
      .player {
        position: relative;
        width: min(100%, 420px);
        aspect-ratio: 9 / 16;
        border-radius: 26px;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.08), transparent 32%),
          #030508;
      }
      .player video,
      .player img,
      .player__fallback {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .player__fallback {
        display: grid;
        place-items: center;
        padding: 28px;
        text-align: center;
        line-height: 1.6;
        color: var(--muted);
      }
      .player__scrim {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .player__scrim::before,
      .player__scrim::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
      }
      .player__scrim::before {
        top: 0;
        height: 24%;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.56), transparent);
      }
      .player__scrim::after {
        bottom: 0;
        height: 42%;
        background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.72));
      }
      .player__badge {
        position: absolute;
        top: 16px;
        left: 16px;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(9, 12, 18, 0.58);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .player__controls {
        position: absolute;
        top: 16px;
        right: 16px;
        display: flex;
        gap: 10px;
      }
      .player__control {
        appearance: none;
        min-width: 44px;
        height: 44px;
        padding: 0 14px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        background: rgba(9, 12, 18, 0.58);
        color: #fff;
        font-size: 0.84rem;
        font-weight: 700;
        cursor: pointer;
      }
      .player__caption {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 0 18px 20px;
      }
      .player__author {
        display: inline-block;
        margin-bottom: 10px;
        font-weight: 700;
        text-decoration: none;
      }
      .player__copy {
        margin: 0;
        max-width: 28ch;
        color: rgba(255, 255, 255, 0.9);
        line-height: 1.55;
        text-shadow: 0 4px 18px rgba(0, 0, 0, 0.42);
      }
      .player__progress {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 8px;
        height: 3px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        overflow: hidden;
      }
      .player__progress-fill {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, var(--brand), var(--accent));
        transition: width 120ms linear;
      }
      .rail {
        display: grid;
        gap: 12px;
        align-items: end;
      }
      .rail__avatar {
        width: 60px;
        height: 60px;
        border-radius: 20px;
        overflow: hidden;
        border: 2px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
      }
      .rail__avatar img,
      .rail__avatar-fallback {
        width: 100%;
        height: 100%;
        display: block;
      }
      .rail__avatar img {
        object-fit: cover;
      }
      .rail__avatar-fallback {
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, rgba(255, 53, 93, 0.3), rgba(37, 244, 238, 0.24));
        font-weight: 800;
      }
      .rail__button {
        display: grid;
        justify-items: center;
        gap: 8px;
        width: 82px;
        padding: 14px 10px;
        border-radius: 24px;
      }
      .rail__button--accent {
        background: linear-gradient(135deg, rgba(255, 53, 93, 0.92), rgba(255, 110, 127, 0.88));
        border-color: transparent;
        color: #fff;
      }
      .rail__button svg {
        width: 24px;
        height: 24px;
      }
      .rail__label {
        font-size: 0.88rem;
        font-weight: 700;
        line-height: 1;
      }
      .rail__meta {
        color: var(--muted);
        font-size: 0.74rem;
        text-align: center;
      }
      .meta-card {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--surface-soft);
        padding: 18px;
      }
      .meta-card h2 {
        margin: 0 0 12px;
        font-size: 1rem;
      }
      .meta-list {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .meta-list strong,
      .meta-list a {
        display: block;
        margin-top: 2px;
        color: var(--ink);
        font-weight: 600;
        text-decoration: none;
        word-break: break-word;
      }
      @media (max-width: 1180px) {
        main {
          grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
        }
        .panel--meta {
          grid-column: 1 / -1;
        }
        .panel--meta .panel__inner {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 860px) {
        main {
          width: min(100vw, calc(100vw - 20px));
          padding: 12px 0 18px;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .viewer {
          grid-template-columns: 1fr;
          justify-items: center;
        }
        .rail {
          width: min(100%, 420px);
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }
        .rail__button,
        .rail__avatar {
          width: 100%;
        }
        .rail__avatar {
          height: 84px;
        }
        .panel--meta .panel__inner {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 520px) {
        main {
          width: 100vw;
          padding: 0 0 16px;
        }
        .panel--lead,
        .panel--meta {
          display: none;
        }
        .stage {
          min-height: 100vh;
        }
        .phone-shell {
          width: 100vw;
          padding: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
        }
        .player {
          width: 100vw;
          min-height: 100vh;
          border-radius: 0;
        }
        .rail {
          position: absolute;
          right: 12px;
          bottom: 92px;
          width: auto;
          grid-template-columns: 1fr;
        }
        .rail__avatar {
          width: 64px;
          height: 64px;
        }
        .rail__button {
          width: 78px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <aside class="panel panel--lead">
        <div class="panel__inner">
          <div class="brand">
            <span class="brand__dot"></span>
            <span>${escapeHtml(brandName)}</span>
          </div>
          <section>
            <p class="eyebrow">${escapeHtml(brandName)} public post</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="summary">${escapeHtml(description)}</p>
          </section>
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
              openAppUrl,
              iosStoreUrl,
              androidStoreUrl,
            })}
          </div>
          <p class="helper">
            The shared post now stays watchable on the web. Likes, comments,
            follows, and the full community context still happen inside the Polis app.
          </p>
          <div class="status-pill">Browser playback enabled</div>
          <div class="feedback" id="share-feedback"></div>
        </div>
      </aside>
      <section class="stage">
        <div class="viewer">
          <div class="phone-shell">
            <article class="player">
              ${
                shareMedia.kind === "video" && shareMedia.hlsUrl
                  ? `<video id="share-video" playsinline loop autoplay muted preload="metadata" poster="${escapeAttribute(shareMedia.posterUrl || imageUrl || metaImage)}"></video>`
                  : imageUrl
                    ? `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}" />`
                    : `<div class="player__fallback">This post is available in the Polis app. Install the app to keep watching and join the conversation.</div>`
              }
              <div class="player__scrim"></div>
              <div class="player__badge">${escapeHtml(mediaType)}</div>
              ${
                shareMedia.kind === "video" && shareMedia.hlsUrl
                  ? `<div class="player__controls">
                  <button class="player__control" id="playback-toggle" type="button">Pause</button>
                  <button class="player__control" id="mute-toggle" type="button">Unmute</button>
                </div>`
                  : ""
              }
              <div class="player__caption">
                <a class="player__author" href="${escapeAttribute(canonicalUrl)}">${escapeHtml(authorUsername ? `@${authorUsername}` : authorDisplayName)}</a>
                <p class="player__copy">${escapeHtml(description)}</p>
              </div>
              ${
                shareMedia.kind === "video" && shareMedia.hlsUrl
                  ? `<div class="player__progress" aria-hidden="true"><div class="player__progress-fill" id="progress-fill"></div></div>`
                  : ""
              }
            </article>
          </div>
          <aside class="rail">
            <div class="rail__avatar">
              ${
                authorAvatarUrl
                  ? `<img src="${escapeAttribute(authorAvatarUrl)}" alt="${escapeAttribute(authorDisplayName)}" />`
                  : `<div class="rail__avatar-fallback">${escapeHtml(authorDisplayName.slice(0, 1).toUpperCase() || "P")}</div>`
              }
            </div>
            <button class="rail__button" type="button" data-open-app-button="1">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.53A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z"/></svg>
              <span class="rail__label">Like</span>
              <span class="rail__meta">In app</span>
            </button>
            <button class="rail__button" type="button" data-open-app-button="1">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 18.5A8.38 8.38 0 0 1 3 11.5 8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5 8.5 8.5 0 0 1 12.5 20H7l-4 3.5Z"/></svg>
              <span class="rail__label">Comment</span>
              <span class="rail__meta">Reply</span>
            </button>
            <button class="rail__button" type="button" id="share-button">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m7 12 10-6v12L7 12Z"/><path d="M3 12h4"/></svg>
              <span class="rail__label">Share</span>
              <span class="rail__meta">Send link</span>
            </button>
            <button class="rail__button rail__button--accent" type="button" id="open-app-button">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              <span class="rail__label">Open</span>
              <span class="rail__meta">Polis app</span>
            </button>
          </aside>
        </div>
      </section>
      <aside class="panel panel--meta">
        <div class="panel__inner">
          <section class="meta-card">
            <h2>Share details</h2>
            <ul class="meta-list">
              <li>Author<strong>${escapeHtml(authorDisplayName)}</strong></li>
              <li>Media<strong>${escapeHtml(mediaType)}</strong></li>
              <li>Canonical URL<strong><a href="${escapeAttribute(canonicalUrl)}">${escapeHtml(canonicalUrl)}</a></strong></li>
            </ul>
          </section>
          <section class="meta-card">
            <h2>Open in app</h2>
            <p>
              The app handoff target for shared posts is the focused post player at
              <code>/posts/:postId</code>. That is the closest current in-app surface
              to a TikTok-style signed-out viewer.
            </p>
          </section>
          <section class="meta-card">
            <h2>Shared link</h2>
            <p>${escapeHtml(requestUrl)}</p>
          </section>
        </div>
      </aside>
    </main>
    <script>
      const shareState = ${inlineShareState};
      const feedback = document.getElementById("share-feedback");

      function setFeedback(message) {
        if (feedback) {
          feedback.textContent = message;
        }
      }

      function isLikelyMobileDevice() {
        return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
      }

      function preferredFallbackUrl() {
        const agent = (window.navigator.userAgent || "").toLowerCase();
        if (agent.includes("iphone") || agent.includes("ipad") || agent.includes("ipod")) {
          return shareState.iosStoreUrl || shareState.canonicalUrl;
        }
        if (agent.includes("android")) {
          return shareState.androidStoreUrl || shareState.canonicalUrl;
        }
        return shareState.canonicalUrl;
      }

      function openInApp() {
        if (!shareState.openAppUrl) {
          setFeedback("App handoff is not configured yet.");
          return;
        }
        if (!isLikelyMobileDevice()) {
          setFeedback("Open this link on a phone with Polis installed to hand off into the app.");
          return;
        }
        let hidden = false;
        const handleVisibility = () => {
          if (document.visibilityState === "hidden") {
            hidden = true;
          }
        };
        document.addEventListener("visibilitychange", handleVisibility, { once: true });
        window.location.assign(shareState.openAppUrl);
        window.setTimeout(() => {
          document.removeEventListener("visibilitychange", handleVisibility);
          const fallbackUrl = preferredFallbackUrl();
          if (!hidden && fallbackUrl && fallbackUrl !== window.location.href) {
            window.location.assign(fallbackUrl);
          }
        }, 1200);
      }

      async function shareLink() {
        const url = shareState.canonicalUrl || shareState.requestUrl;
        if (!url) {
          setFeedback("Share link unavailable right now.");
          return;
        }
        try {
          if (navigator.share) {
            await navigator.share({
              title: document.title,
              text: shareState.shareText || document.title,
              url,
            });
            setFeedback("Share sheet opened.");
            return;
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            setFeedback("Share link copied.");
            return;
          }
        } catch (_error) {
          setFeedback("Sharing failed. Copy the URL from the browser bar.");
          return;
        }
        setFeedback("Copy the URL from the browser bar to share this post.");
      }

      document.querySelectorAll('[data-open-app-button="1"], [data-open-app-link="1"]').forEach((element) => {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          openInApp();
        });
      });

      const shareButton = document.getElementById("share-button");
      if (shareButton) {
        shareButton.addEventListener("click", shareLink);
      }

      const openAppButton = document.getElementById("open-app-button");
      if (openAppButton) {
        openAppButton.addEventListener("click", openInApp);
      }

      const video = document.getElementById("share-video");
      const muteToggle = document.getElementById("mute-toggle");
      const playbackToggle = document.getElementById("playback-toggle");
      const progressFill = document.getElementById("progress-fill");
      const videoMedia = shareState.shareMedia || null;

      function configureVideoSource() {
        if (!video || !videoMedia || videoMedia.kind !== "video") {
          return false;
        }
        const hlsUrl = typeof videoMedia.hlsUrl === "string" ? videoMedia.hlsUrl : "";
        if (!hlsUrl) {
          return false;
        }
        const supportsNativeHls =
          video.canPlayType("application/vnd.apple.mpegurl") ||
          video.canPlayType("application/x-mpegURL");
        if (supportsNativeHls) {
          video.src = hlsUrl;
          return true;
        }
        if (window.Hls && typeof window.Hls.isSupported === "function" && window.Hls.isSupported()) {
          const hls = new window.Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.ERROR, (_event, data) => {
            if (data && data.fatal) {
              setFeedback("Video playback failed in this browser. Open in app to keep watching.");
            }
          });
          window.addEventListener(
            "beforeunload",
            () => {
              hls.destroy();
            },
            { once: true },
          );
          return true;
        }
        setFeedback("This browser cannot play the shared video yet. Open in app to keep watching.");
        return false;
      }

      function syncPlaybackState() {
        if (!video) {
          return;
        }
        if (muteToggle) {
          muteToggle.textContent = video.muted ? "Unmute" : "Mute";
        }
        if (playbackToggle) {
          playbackToggle.textContent = video.paused ? "Play" : "Pause";
        }
      }

      function syncProgress() {
        if (!video || !progressFill) {
          return;
        }
        const duration = Number(video.duration);
        const currentTime = Number(video.currentTime);
        if (!duration || !Number.isFinite(duration)) {
          progressFill.style.width = "0%";
          return;
        }
        const progress = Math.max(0, Math.min(100, (currentTime / duration) * 100));
        progressFill.style.width = progress.toFixed(2) + "%";
      }

      if (video) {
        const hasVideoSource = configureVideoSource();
        video.addEventListener("timeupdate", syncProgress);
        video.addEventListener("play", syncPlaybackState);
        video.addEventListener("pause", syncPlaybackState);
        video.addEventListener("volumechange", syncPlaybackState);
        video.addEventListener("loadedmetadata", syncProgress);
        video.addEventListener("canplay", () => {
          video.play().catch(() => {
            syncPlaybackState();
          });
        });
        video.addEventListener("error", () => {
          setFeedback("Video playback failed in this browser. Open in app to keep watching.");
        });
        video.addEventListener("click", () => {
          if (video.paused) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
        if (!hasVideoSource) {
          setFeedback("Video playback is unavailable right now. Open in app to keep watching.");
        }
        syncPlaybackState();
        syncProgress();
      }

      if (muteToggle && video) {
        muteToggle.addEventListener("click", () => {
          video.muted = !video.muted;
          syncPlaybackState();
        });
      }

      if (playbackToggle && video) {
        playbackToggle.addEventListener("click", () => {
          if (video.paused) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
          syncPlaybackState();
        });
      }
    </script>
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
