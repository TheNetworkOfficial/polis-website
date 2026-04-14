import "./css/shared-feed.css";
import polisLogoUrl from "../../assets/images/polis/Polis.png";

import {
  buildAuthorizedHeaders,
  clearSharedFeedSession,
  completeHostedSignIn,
  getAuthenticatedUser,
  getStoredSharedFeedSession,
  hasHostedSignInConfig,
  startHostedSignIn,
  startHostedSignUp,
} from "./scripts/sharedFeedAuth.js";

const runtimeConfig = window.__POLIS_SHARED_FEED__ || {};
const root = document.getElementById("shared-feed-app");
const initialCommentId =
  new URL(window.location.href).searchParams.get("commentId") || "";

const FEED_MODE_FOR_YOU = "for_you";
const FEED_MODE_FOLLOWING = "following";

const state = {
  mode: FEED_MODE_FOR_YOU,
  userHasInteracted: false,
  renderError: "",
  auth: {
    config: runtimeConfig.auth || {},
    session: null,
    user: null,
    message: "",
  },
  ui: {
    toast: "",
    authModal: null,
    comments: {
      open: false,
      loading: false,
      submitting: false,
      postId: "",
      items: [],
      cursor: null,
      error: "",
      replyTo: null,
      highlightedCommentId: initialCommentId,
    },
  },
  feeds: {
    [FEED_MODE_FOR_YOU]: {
      items: [],
      nextCursor: null,
      sessionId: null,
      loading: true,
      loadingMore: false,
      error: "",
      bootstrapped: false,
    },
    [FEED_MODE_FOLLOWING]: {
      items: [],
      nextCursor: null,
      sessionId: null,
      loading: false,
      loadingMore: false,
      error: "",
      bootstrapped: false,
      unauthorized: false,
    },
  },
  activeIndex: 0,
};

let renderScheduled = false;
let toastTimer = null;
let observer = null;
let hlsLoaderPromise = null;
let hlsControllers = [];
let mediaPreconnectInitialized = false;

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeUrl(value) {
  const normalized = normalizeString(value);
  return normalized || "";
}

function upgradePosterUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return "";
  }
  try {
    const url = new URL(normalized);
    if (url.hostname !== "videodelivery.net") {
      return url.toString();
    }
    const requestedHeight = Number(url.searchParams.get("height"));
    if (!Number.isFinite(requestedHeight) || requestedHeight < 960) {
      url.searchParams.set("height", "960");
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  if (numeric >= 1000000) {
    return `${(numeric / 1000000).toFixed(numeric >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(numeric >= 100000 ? 0 : 1).replace(/\.0$/, "")}K`;
  }
  return String(Math.max(0, Math.floor(numeric)));
}

function formatDuration(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const twoDigits = (part) => String(part).padStart(2, "0");
  if (hours > 0) {
    return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  }
  return `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

function formatRelativeTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w`;
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function isVideoItem(item) {
  return item?.kind === "post" && item.mediaType === "video";
}

function isImageItem(item) {
  return item?.kind === "post" && item.mediaType === "image";
}

function buildAppOpenUrl(postId, commentId = "") {
  const normalizedPostId = normalizeString(postId);
  const scheme = normalizeString(runtimeConfig.appUrlScheme) || "myapp";
  if (!normalizedPostId || !scheme) {
    return "";
  }
  const path = `/posts/${encodeURIComponent(normalizedPostId)}`;
  const commentQuery = normalizeString(commentId)
    ? `?commentId=${encodeURIComponent(normalizeString(commentId))}`
    : "";
  return `${scheme}://auth/?path=${encodeURIComponent(`${path}${commentQuery}`)}`;
}

function getPublicWebBaseUrl() {
  return normalizeString(runtimeConfig.publicWebBaseUrl) || window.location.origin;
}

function getShareUrl(postId) {
  return `${getPublicWebBaseUrl()}/posts/${encodeURIComponent(postId)}`;
}

function getApiBaseUrl() {
  return normalizeString(runtimeConfig.apiBaseUrl).replace(/\/+$/g, "");
}

function getStoreUrls() {
  return {
    ios: normalizeUrl(runtimeConfig.iosStoreUrl),
    android: normalizeUrl(runtimeConfig.androidStoreUrl),
  };
}

function openAuthModal(kind, context = {}) {
  state.ui.authModal = {
    kind,
    title:
      context.title ||
      (kind === "following"
        ? "Log in to unlock Following"
        : "Join Polis to keep going"),
    message:
      context.message ||
      "Sign in or create an account to like posts, join conversations, and open this feed inside the app.",
    postId: normalizeString(context.postId),
  };
  scheduleRender();
}

function closeAuthModal() {
  state.ui.authModal = null;
  scheduleRender();
}

function showToast(message) {
  state.ui.toast = normalizeString(message);
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  if (state.ui.toast) {
    toastTimer = window.setTimeout(() => {
      state.ui.toast = "";
      scheduleRender();
    }, 3200);
  }
  scheduleRender();
}

function scheduleRender() {
  if (renderScheduled) {
    return;
  }
  renderScheduled = true;
  window.requestAnimationFrame(() => {
    renderScheduled = false;
    renderApp();
  });
}

function destroyPlayerControllers() {
  for (const controller of hlsControllers) {
    try {
      controller?.destroy?.();
    } catch {
      // ignore cleanup errors
    }
  }
  hlsControllers = [];
}

function ensureHlsLoader() {
  if (window.Hls) {
    return Promise.resolve(window.Hls);
  }
  if (hlsLoaderPromise) {
    return hlsLoaderPromise;
  }
  hlsLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hls-loader="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Hls), {
        once: true,
      });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
    script.async = true;
    script.dataset.hlsLoader = "1";
    script.addEventListener("load", () => resolve(window.Hls), { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
  return hlsLoaderPromise;
}

function ensureMediaPreconnect() {
  if (mediaPreconnectInitialized) {
    return;
  }
  mediaPreconnectInitialized = true;
  ["https://videodelivery.net", "https://imagedelivery.net"].forEach((href) => {
    if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.append(link);
  });
}

function normalizeComment(raw = {}) {
  return {
    commentId: normalizeString(raw.commentId),
    postId: normalizeString(raw.postId),
    replyTo: normalizeString(raw.replyTo) || null,
    text: normalizeString(raw.text),
    createdAt: Number(raw.createdAt) || null,
    displayName:
      normalizeString(raw.displayName || raw.userDisplayName) || "Polis user",
    username: normalizeString(raw.username),
    avatarUrl: normalizeUrl(raw.avatarUrl || raw.userAvatarUrl),
    likedByMe: raw.likedByMe === true,
    likeCount: Number(raw.likeCount) || 0,
  };
}

function normalizeFeedItem(raw = {}, index = 0) {
  if (normalizeString(raw.eventId)) {
    return {
      kind: "event",
      key: `event:${normalizeString(raw.eventId) || index}`,
      eventId: normalizeString(raw.eventId),
      title: normalizeString(raw.title) || "Upcoming event",
      description: normalizeString(raw.description),
      imageUrl: normalizeUrl(raw.imageUrl),
      hostDisplayName: normalizeString(raw.hostDisplayName),
      startAt: Number(raw.startAt) || null,
      address: normalizeString(raw.address),
    };
  }

  if (normalizeString(raw.type).toLowerCase() === "candidate_opt_in_prompt") {
    return {
      kind: "prompt",
      key: `prompt:${normalizeString(raw.candidateId) || index}`,
      title: "Candidate prompt",
      description:
        "Continue in the Polis app to complete this personalized feed step.",
    };
  }

  const postId = normalizeString(raw.postId);
  const rawType = normalizeString(raw.mediaType || raw.type).toLowerCase();
  const mediaType = rawType === "image" ? "image" : "video";
  const caption =
    normalizeString(raw.description) ||
    normalizeString(raw.caption) ||
    normalizeString(raw.text) ||
    normalizeString(raw.previewText) ||
    normalizeString(raw.previewTitle);
  const rawPosterUrl =
    normalizeUrl(raw.thumbUrl) ||
    normalizeUrl(raw.previewUrl) ||
    normalizeUrl(raw.imageUrl) ||
    normalizeUrl(raw.previewMediaThumbnail);
  const posterUrl =
    mediaType === "video" ? upgradePosterUrl(rawPosterUrl) : rawPosterUrl;
  const imageUrl = normalizeUrl(raw.imageUrl) || posterUrl;

  return {
    kind: "post",
    key: `post:${postId || index}`,
    postId,
    authorUserId:
      normalizeString(raw.userId || raw.authorUserId || raw.authorId) || null,
    authorDisplayName:
      normalizeString(raw.displayName || raw.userDisplayName) || "Post author",
    authorUsername: normalizeString(raw.username),
    authorAvatarUrl: normalizeUrl(raw.avatarUrl || raw.userAvatarUrl),
    mediaType,
    videoUrl: normalizeUrl(raw.videoUrl || raw.mediaUrl),
    mp4Url: normalizeUrl(raw.mp4Url),
    imageUrl,
    posterUrl,
    playbackId: normalizeString(raw.playbackId),
    durationMs: Number(raw.durationMs) || null,
    caption,
    previewTitle: normalizeString(raw.previewTitle),
    createdAt: Number(raw.createdAt) || null,
    likesCount: Number(raw.likesCount) || 0,
    commentsCount: Number(raw.commentsCount) || 0,
    likedByMe: raw.likedByMe === true,
    savedByMe: raw.savedByMe === true,
    isFollowing: raw.isFollowing === true,
    canonicalUrl: normalizeUrl(raw.canonicalUrl) || getShareUrl(postId),
    openAppUrl: buildAppOpenUrl(postId),
    candidateId: normalizeString(raw.candidateId),
    authorType: normalizeString(raw.authorType) || "user",
    raw,
  };
}

function getCurrentFeedState() {
  return state.feeds[state.mode];
}

function getCurrentItems() {
  return getCurrentFeedState().items;
}

function ensureActiveIndexInBounds() {
  const items = getCurrentItems();
  if (!items.length) {
    state.activeIndex = 0;
    return;
  }
  state.activeIndex = Math.min(items.length - 1, Math.max(0, state.activeIndex));
}

async function fetchJson(path, { auth = false, method = "GET", body, headers = {} } = {}) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("video_backend_base_url_missing");
  }

  const nextHeaders = {
    Accept: "application/json",
    ...headers,
  };
  if (auth) {
    Object.assign(nextHeaders, buildAuthorizedHeaders(state.auth.session));
  }
  if (body !== undefined && body !== null) {
    nextHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: nextHeaders,
    body:
      body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      normalizeString(payload?.message || payload?.error) || "request_failed",
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function updateItem(postId, updater) {
  for (const mode of [FEED_MODE_FOR_YOU, FEED_MODE_FOLLOWING]) {
    const feed = state.feeds[mode];
    feed.items = feed.items.map((item) => {
      if (item.kind !== "post" || item.postId !== postId) {
        return item;
      }
      return updater(item);
    });
  }
}

async function refreshPostEngagement(postId) {
  const path = state.auth.session
    ? `/api/posts/${encodeURIComponent(postId)}/engagement`
    : `/api/public/posts/${encodeURIComponent(postId)}/engagement`;
  const payload = await fetchJson(path, { auth: Boolean(state.auth.session) });
  updateItem(postId, (item) => ({
    ...item,
    likesCount: Number(payload.likesCount) || 0,
    commentsCount: Number(payload.commentsCount) || 0,
    likedByMe: payload.likedByMe === true,
  }));
  scheduleRender();
}

async function loadInitialFeed() {
  const feed = state.feeds[FEED_MODE_FOR_YOU];
  feed.loading = true;
  feed.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/public/posts/${encodeURIComponent(runtimeConfig.postId)}/web-feed?limit=6`,
    );
    feed.items = (payload.items || []).map(normalizeFeedItem);
    feed.nextCursor = normalizeString(payload.nextCursor) || null;
    feed.sessionId = normalizeString(payload.sessionId) || null;
    feed.loading = false;
    feed.bootstrapped = true;
    ensureActiveIndexInBounds();
    scheduleRender();

    if (initialCommentId) {
      openComments(runtimeConfig.postId, { autoHighlight: initialCommentId });
    }
  } catch (error) {
    feed.loading = false;
    feed.error =
      error?.message === "video_backend_base_url_missing"
        ? "The website is missing its video backend configuration."
        : "The shared feed could not be loaded.";
    scheduleRender();
  }
}

async function loadFollowingFeed({ refresh = false } = {}) {
  const feed = state.feeds[FEED_MODE_FOLLOWING];
  if (!state.auth.session) {
    feed.unauthorized = true;
    openAuthModal("following");
    return;
  }

  if (feed.loading || feed.loadingMore) {
    return;
  }

  if (!refresh && feed.bootstrapped) {
    state.mode = FEED_MODE_FOLLOWING;
    ensureActiveIndexInBounds();
    scheduleRender();
    return;
  }

  feed.loading = true;
  feed.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/feed/following?limit=6", {
      auth: true,
    });
    feed.items = (payload.items || []).map(normalizeFeedItem);
    feed.nextCursor = normalizeString(payload.nextCursor) || null;
    feed.sessionId = normalizeString(payload.sessionId) || null;
    feed.loading = false;
    feed.bootstrapped = true;
    feed.unauthorized = false;
    state.mode = FEED_MODE_FOLLOWING;
    state.activeIndex = 0;
    scheduleRender();
  } catch (error) {
    feed.loading = false;
    feed.error =
      Number(error?.status) === 401
        ? "Log in to see Following."
        : "The Following feed is unavailable right now.";
    feed.unauthorized = Number(error?.status) === 401;
    if (feed.unauthorized) {
      openAuthModal("following");
    }
    scheduleRender();
  }
}

async function loadMoreFeed(mode = state.mode) {
  const feed = state.feeds[mode];
  if (!feed.nextCursor || feed.loadingMore) {
    return;
  }

  feed.loadingMore = true;
  scheduleRender();

  try {
    let payload;
    if (mode === FEED_MODE_FOLLOWING) {
      payload = await fetchJson(
        `/api/feed/following?limit=6&cursor=${encodeURIComponent(feed.nextCursor)}`,
        { auth: true },
      );
    } else {
      const query = new URLSearchParams({
        limit: "6",
        cursor: feed.nextCursor,
      });
      if (feed.sessionId) {
        query.set("sessionId", feed.sessionId);
      }
      if (runtimeConfig.postId) {
        query.set("excludePostId", runtimeConfig.postId);
      }
      payload = await fetchJson(`/api/public/feed/for-you?${query.toString()}`);
    }

    const incoming = (payload.items || []).map(normalizeFeedItem);
    const seenKeys = new Set(feed.items.map((item) => item.key));
    feed.items = feed.items.concat(
      incoming.filter((item) => !seenKeys.has(item.key)),
    );
    feed.nextCursor = normalizeString(payload.nextCursor) || null;
    feed.sessionId = normalizeString(payload.sessionId) || feed.sessionId || null;
  } catch {
    feed.error = "More posts could not be loaded.";
  } finally {
    feed.loadingMore = false;
    scheduleRender();
  }
}

async function openComments(postId, { autoHighlight = "" } = {}) {
  const normalizedPostId = normalizeString(postId);
  if (!normalizedPostId) {
    return;
  }

  state.ui.comments.open = true;
  state.ui.comments.loading = true;
  state.ui.comments.error = "";
  state.ui.comments.postId = normalizedPostId;
  state.ui.comments.replyTo = null;
  state.ui.comments.highlightedCommentId = normalizeString(autoHighlight);
  scheduleRender();

  try {
    const path = state.auth.session
      ? `/api/posts/${encodeURIComponent(normalizedPostId)}/comments?limit=100`
      : `/api/public/posts/${encodeURIComponent(normalizedPostId)}/comments?limit=100`;
    const payload = await fetchJson(path, {
      auth: Boolean(state.auth.session),
    });
    state.ui.comments.items = (payload.items || []).map(normalizeComment);
    state.ui.comments.cursor = normalizeString(payload.cursor) || null;
  } catch {
    state.ui.comments.items = [];
    state.ui.comments.error = "Comments could not be loaded.";
  } finally {
    state.ui.comments.loading = false;
    scheduleRender();
  }
}

function closeComments() {
  state.ui.comments.open = false;
  state.ui.comments.replyTo = null;
  scheduleRender();
}

async function handlePostLike(postId) {
  if (!state.auth.session) {
    openAuthModal("like_post", {
      postId,
      title: "Log in to like posts",
      message: "Create an account or sign in to like this post and shape your Polis feed.",
    });
    return;
  }

  const item = getCurrentItems().find((candidate) => candidate.postId === postId);
  if (!item) {
    return;
  }

  const nextLiked = !item.likedByMe;
  updateItem(postId, (current) => ({
    ...current,
    likedByMe: nextLiked,
    likesCount: Math.max(0, current.likesCount + (nextLiked ? 1 : -1)),
  }));
  scheduleRender();

  try {
    await fetchJson(`/api/posts/${encodeURIComponent(postId)}/like`, {
      auth: true,
      method: nextLiked ? "POST" : "DELETE",
    });
    await refreshPostEngagement(postId);
  } catch {
    await refreshPostEngagement(postId).catch(() => {
      updateItem(postId, () => item);
      scheduleRender();
    });
    showToast("Like failed. Try again.");
  }
}

async function handleSavePost(postId) {
  if (!state.auth.session) {
    openAuthModal("save_post", {
      postId,
      title: "Log in to save posts",
      message: "Sign in to save this post and pick it up later in the app.",
    });
    return;
  }

  const item = getCurrentItems().find((candidate) => candidate.postId === postId);
  if (!item) {
    return;
  }

  const nextSaved = !item.savedByMe;
  updateItem(postId, (current) => ({
    ...current,
    savedByMe: nextSaved,
  }));
  scheduleRender();

  try {
    const payload = await fetchJson(`/api/posts/${encodeURIComponent(postId)}/save`, {
      auth: true,
      method: nextSaved ? "POST" : "DELETE",
    });
    updateItem(postId, (current) => ({
      ...current,
      savedByMe: payload.saved === true,
    }));
    scheduleRender();
  } catch {
    updateItem(postId, (current) => ({
      ...current,
      savedByMe: item.savedByMe,
    }));
    scheduleRender();
    showToast("Save failed. Try again.");
  }
}

async function handleFollowAuthor(item) {
  if (!state.auth.session) {
    openAuthModal("follow_author", {
      postId: item.postId,
      title: "Log in to follow creators",
      message: "Sign in to follow this account and unlock your Following feed.",
    });
    return;
  }

  if (!item.authorUserId) {
    showToast("Profile unavailable.");
    return;
  }

  const previous = item.isFollowing === true;
  updateItem(item.postId, (current) => ({
    ...current,
    isFollowing: !previous,
  }));
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/users/${encodeURIComponent(item.authorUserId)}/follow`,
      {
        auth: true,
        method: "POST",
      },
    );
    updateItem(item.postId, (current) => ({
      ...current,
      isFollowing: payload.following === true,
    }));
    scheduleRender();
  } catch {
    updateItem(item.postId, (current) => ({
      ...current,
      isFollowing: previous,
    }));
    scheduleRender();
    showToast("Follow failed. Try again.");
  }
}

async function handleCommentLike(commentId) {
  if (!state.auth.session) {
    openAuthModal("like_comment", {
      title: "Log in to like comments",
      message:
        "Sign in or create an account to react and join the conversation.",
    });
    return;
  }

  const current = state.ui.comments.items.find((item) => item.commentId === commentId);
  if (!current) {
    return;
  }
  const nextLiked = !current.likedByMe;
  state.ui.comments.items = state.ui.comments.items.map((item) =>
    item.commentId === commentId
      ? {
          ...item,
          likedByMe: nextLiked,
          likeCount: Math.max(0, item.likeCount + (nextLiked ? 1 : -1)),
        }
      : item,
  );
  scheduleRender();

  try {
    await fetchJson(`/api/comments/${encodeURIComponent(commentId)}/like`, {
      auth: true,
      method: nextLiked ? "PUT" : "DELETE",
    });
  } catch {
    state.ui.comments.items = state.ui.comments.items.map((item) =>
      item.commentId === commentId ? current : item,
    );
    scheduleRender();
    showToast("Comment reaction failed. Try again.");
  }
}

async function submitComment(text) {
  if (!state.auth.session) {
    openAuthModal("write_comment", {
      title: "Log in to comment",
      message:
        "Create an account or sign in to reply, like comments, and add your own voice.",
    });
    return;
  }

  const postId = normalizeString(state.ui.comments.postId);
  if (!postId) {
    return;
  }
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    showToast("Write something first.");
    return;
  }

  state.ui.comments.submitting = true;
  scheduleRender();

  try {
    await fetchJson(`/api/posts/${encodeURIComponent(postId)}/comments`, {
      auth: true,
      method: "POST",
      body: {
        text: normalizedText,
        replyTo: state.ui.comments.replyTo || null,
      },
    });
    state.ui.comments.replyTo = null;
    await Promise.all([openComments(postId), refreshPostEngagement(postId)]);
  } catch {
    showToast("Comment failed. Try again.");
  } finally {
    state.ui.comments.submitting = false;
    scheduleRender();
  }
}

async function handleShare(postId) {
  const shareUrl = getShareUrl(postId);
  try {
    if (navigator.share) {
      await navigator.share({
        title: "Polis",
        text: "Watch this Polis post",
        url: shareUrl,
      });
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    showToast("Link copied.");
  } catch {
    showToast("Sharing unavailable on this device.");
  }
}

function requestAppOpen(postId, commentId = "") {
  const targetUrl = buildAppOpenUrl(postId, commentId);
  if (!targetUrl) {
    showToast("App link unavailable.");
    return;
  }
  window.location.assign(targetUrl);
}

function getNavItems() {
  return [
    { label: "Feed", key: "feed", icon: "feed", active: true },
    { label: "Candidates", key: "candidates", icon: "candidate" },
    { label: "Create", key: "create", icon: "create" },
    { label: "Events", key: "events", icon: "calendar" },
    { label: "Profile", key: "profile", icon: "profile" },
  ];
}

function getTopActions() {
  return [
    { key: "search", label: "Search", icon: "search" },
    { key: "messages", label: "Messages", icon: "messages" },
  ];
}

function renderIcon(name) {
  const icons = {
    feed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z"></path></svg>',
    candidate:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c4.418 0 8 2.239 8 5v3H4v-3c0-2.761 3.582-5 8-5Z"></path></svg>',
    create:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"></path></svg>',
    calendar:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm11 8H6v10h12V10Z"></path></svg>',
    profile:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c4.97 0 9 2.687 9 6v2H3v-2c0-3.313 4.03-6 9-6Z"></path></svg>',
    search:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm8.646 10.232L21 18.086 19.586 19.5l-1.854-1.854 1.414-1.414Z"></path></svg>',
    messages:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5Zm2 2v8.172L7.172 14H18V7H6Z"></path></svg>',
    heart:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35 10.55 20C5.4 15.24 2 12.09 2 8.24A4.74 4.74 0 0 1 6.76 3.5c2 0 3.92.93 5.24 2.39A7.06 7.06 0 0 1 17.24 3.5 4.74 4.74 0 0 1 22 8.24c0 3.85-3.4 7-8.55 11.77L12 21.35Z"></path></svg>',
    heartOutline:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 3A5.5 5.5 0 0 1 22 8.5c0 3.34-2.72 5.95-6.84 9.72L12 21l-3.16-2.78C4.72 14.45 2 11.84 2 8.5A5.5 5.5 0 0 1 7.5 3c1.74 0 3.41.81 4.5 2.09A6.1 6.1 0 0 1 16.5 3Zm0 2c-1.54 0-3.04.99-3.57 2.36h-1.86C11.54 5.99 10.04 5 8.5 5A3.5 3.5 0 0 0 5 8.5c0 2.45 2.23 4.6 5.66 7.74L12 17.46l1.34-1.22C16.77 13.1 19 10.95 19 8.5A3.5 3.5 0 0 0 15.5 5Z"></path></svg>',
    comment:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5Zm2 2v8.172L7.172 14H18V7H6Z"></path></svg>',
    share:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 8-1.41 1.41L14 6.83V16h-2V6.83L9.41 9.41 8 8l4-4 4 4ZM6 18h12v2H6z"></path></svg>',
    save:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v16l-8-4-8 4V5a2 2 0 0 1 2-2Zm0 2v12.764l6-3 6 3V5H6Z"></path></svg>',
    saveFilled:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v16l-8-4-8 4V5a2 2 0 0 1 2-2Z"></path></svg>',
    play:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>',
    pause:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg>',
    soundOn:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8a10.5 10.5 0 0 1 0 16l-1.41-1.41a8.5 8.5 0 0 0 0-13.18L16.5 4Z"></path></svg>',
    soundOff:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 12 2.5 2.5-1.5 1.5L17.5 13.5 15 16v-8l2.5 2.5L20 8l1.5 1.5L19 12ZM3 10v4h4l5 5V5L7 10H3Z"></path></svg>',
    close:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"></path></svg>',
  };
  return icons[name] || icons.feed;
}

function renderRail() {
  const navItems = getNavItems()
    .map((item) => {
      const action = item.key === "feed" ? "noop" : "nav-gate";
      const activeClass = item.active ? " is-active" : "";
      return `<button class="shared-feed-rail__nav${activeClass}" data-action="${action}" data-nav-key="${escapeHtml(item.key)}">
        <span class="shared-feed-rail__icon">${renderIcon(item.icon)}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>`;
    })
    .join("");

  const authButtons = state.auth.session
    ? `<button class="shared-feed-rail__secondary" data-action="logout">Log out</button>`
    : `<div class="shared-feed-rail__cta-row">
        <button class="shared-feed-rail__primary" data-action="auth-login-inline">Log in</button>
        <button class="shared-feed-rail__secondary" data-action="auth-signup-inline">Sign up</button>
      </div>`;

  return `<aside class="shared-feed-rail">
    <div class="shared-feed-rail__brand">
      <span class="shared-feed-rail__brand-mark">
        <img class="shared-feed-rail__brand-logo" src="${escapeHtml(polisLogoUrl)}" alt="Polis" />
      </span>
      <div>
        <div class="shared-feed-rail__brand-name">Polis</div>
        <div class="shared-feed-rail__brand-copy">Public feed view</div>
      </div>
    </div>
    <nav class="shared-feed-rail__nav-list">${navItems}</nav>
    <div class="shared-feed-rail__footer">
      <button class="shared-feed-rail__primary" data-action="open-app-shell">Open app</button>
      ${authButtons}
    </div>
  </aside>`;
}

function renderTopChrome() {
  const actions = getTopActions()
    .map(
      (item) =>
        `<button class="shared-feed-topbar__icon" data-action="top-action" data-top-key="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)}">
          ${renderIcon(item.icon)}
        </button>`,
    )
    .join("");

  return `<header class="shared-feed-topbar">
    <div class="shared-feed-topbar__spacer"></div>
    <div class="shared-feed-topbar__toggle">
      <button class="shared-feed-topbar__mode${state.mode === FEED_MODE_FOLLOWING ? " is-active" : ""}" data-action="toggle-mode" data-mode="${FEED_MODE_FOLLOWING}">Following</button>
      <button class="shared-feed-topbar__mode${state.mode === FEED_MODE_FOR_YOU ? " is-active" : ""}" data-action="toggle-mode" data-mode="${FEED_MODE_FOR_YOU}">For You</button>
    </div>
    <div class="shared-feed-topbar__actions">${actions}</div>
  </header>`;
}

function renderPostItem(item, index) {
  const active = index === state.activeIndex;
  const avatarInitial = escapeHtml(item.authorDisplayName.slice(0, 1).toUpperCase() || "P");
  const followBadge =
    item.authorUserId && !item.isFollowing
      ? `<button class="shared-feed-avatar__follow" data-action="follow-author" data-post-id="${escapeHtml(item.postId)}" aria-label="Follow ${escapeHtml(item.authorDisplayName)}">+</button>`
      : "";
  const mediaMarkup = isImageItem(item)
    ? `<img class="shared-feed-post__image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.previewTitle || item.caption || item.authorDisplayName)}" loading="${index < 2 ? "eager" : "lazy"}" />`
    : `<video
        class="shared-feed-post__video"
        playsinline
        loop
        preload="${index <= 1 ? "auto" : "metadata"}"
        poster="${escapeHtml(item.posterUrl)}"
        data-video-post-id="${escapeHtml(item.postId)}"
        data-video-url="${escapeHtml(item.videoUrl)}"
        data-mp4-url="${escapeHtml(item.mp4Url)}"
      ></video>`;
  const captionLine = item.caption
    ? `<p class="shared-feed-post__caption">${escapeHtml(item.caption)}</p>`
    : "";
  const duration = isVideoItem(item) && item.durationMs
    ? `<div class="shared-feed-post__duration">${escapeHtml(formatDuration(item.durationMs))}</div>`
    : "";

  return `<article class="shared-feed-item shared-feed-item--post${active ? " is-active" : ""}" data-index="${index}" data-post-id="${escapeHtml(item.postId)}">
    <div class="shared-feed-post">
      <div class="shared-feed-post__frame" data-action="toggle-play" data-post-id="${escapeHtml(item.postId)}">
        ${mediaMarkup}
        <div class="shared-feed-post__overlay shared-feed-post__overlay--gradient"></div>
        <div class="shared-feed-post__overlay shared-feed-post__overlay--chrome">
          <button class="shared-feed-post__volume" data-action="toggle-volume" data-playback-control="1" aria-label="${state.userHasInteracted ? "Toggle sound" : "Enable sound"}">
            ${renderIcon(state.userHasInteracted ? "soundOn" : "soundOff")}
          </button>
          ${duration}
          <div class="shared-feed-post__actions" data-playback-control="1">
            <div class="shared-feed-avatar">
              <button class="shared-feed-avatar__button" data-action="profile" data-user-id="${escapeHtml(item.authorUserId)}">
                ${
                  item.authorAvatarUrl
                    ? `<img src="${escapeHtml(item.authorAvatarUrl)}" alt="${escapeHtml(item.authorDisplayName)}" />`
                    : `<span>${avatarInitial}</span>`
                }
              </button>
              ${followBadge}
            </div>
            <button class="shared-feed-action shared-feed-action--counted${item.likedByMe ? " is-active" : ""}" data-action="toggle-like" data-post-id="${escapeHtml(item.postId)}">
              <span class="shared-feed-action__icon">${renderIcon(item.likedByMe ? "heart" : "heartOutline")}</span>
              <span class="shared-feed-action__label">${escapeHtml(formatCount(item.likesCount))}</span>
            </button>
            <button class="shared-feed-action shared-feed-action--counted" data-action="open-comments" data-post-id="${escapeHtml(item.postId)}">
              <span class="shared-feed-action__icon">${renderIcon("comment")}</span>
              <span class="shared-feed-action__label">${escapeHtml(formatCount(item.commentsCount))}</span>
            </button>
            <button class="shared-feed-action shared-feed-action--icon-only${item.savedByMe ? " is-active" : ""}" data-action="toggle-save" data-post-id="${escapeHtml(item.postId)}" aria-label="${item.savedByMe ? "Unsave post" : "Save post"}">
              <span class="shared-feed-action__icon">${renderIcon(item.savedByMe ? "saveFilled" : "save")}</span>
            </button>
            <button class="shared-feed-action shared-feed-action--icon-only" data-action="share" data-post-id="${escapeHtml(item.postId)}" aria-label="Share post">
              <span class="shared-feed-action__icon">${renderIcon("share")}</span>
            </button>
          </div>
          <div class="shared-feed-post__copy" data-playback-control="1">
            <div class="shared-feed-post__author-row">
              <button class="shared-feed-post__author" data-action="profile" data-user-id="${escapeHtml(item.authorUserId)}">${escapeHtml(item.authorDisplayName)}</button>
              ${
                item.authorUsername
                  ? `<span class="shared-feed-post__handle">@${escapeHtml(item.authorUsername)}</span>`
                  : ""
              }
              ${
                item.createdAt
                  ? `<span class="shared-feed-post__time">${escapeHtml(formatRelativeTime(item.createdAt))}</span>`
                  : ""
              }
            </div>
            ${captionLine}
          </div>
          ${
            isVideoItem(item)
              ? `<div class="shared-feed-scrubber" data-scrubber="${escapeHtml(item.postId)}" data-playback-control="1">
                  <div class="shared-feed-scrubber__time" data-scrubber-time="${escapeHtml(item.postId)}">00:00 / ${escapeHtml(formatDuration(item.durationMs || 0))}</div>
                  <input class="shared-feed-scrubber__slider" type="range" min="0" max="1000" value="0" step="1" data-scrubber-input="${escapeHtml(item.postId)}" />
                </div>`
              : ""
          }
        </div>
        <button class="shared-feed-post__playback-indicator${active ? "" : " is-visible"}" data-playback-indicator="${escapeHtml(item.postId)}" aria-hidden="true">
          ${renderIcon("play")}
        </button>
      </div>
    </div>
  </article>`;
}

function renderEventItem(item, index) {
  return `<article class="shared-feed-item shared-feed-item--event" data-index="${index}">
    <div class="shared-feed-panel-card">
      ${
        item.imageUrl
          ? `<img class="shared-feed-panel-card__image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />`
          : ""
      }
      <div class="shared-feed-panel-card__body">
        <p class="shared-feed-panel-card__eyebrow">Event</p>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.description || "Continue in the Polis app to view the full event experience.")}</p>
        <div class="shared-feed-panel-card__meta">
          ${item.hostDisplayName ? `<span>${escapeHtml(item.hostDisplayName)}</span>` : ""}
          ${item.startAt ? `<span>${escapeHtml(formatRelativeTime(item.startAt))}</span>` : ""}
        </div>
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="open-app-shell">Open app</button>
      </div>
    </div>
  </article>`;
}

function renderPromptItem(item, index) {
  return `<article class="shared-feed-item shared-feed-item--prompt" data-index="${index}">
    <div class="shared-feed-panel-card shared-feed-panel-card--prompt">
      <div class="shared-feed-panel-card__body">
        <p class="shared-feed-panel-card__eyebrow">Polis</p>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.description)}</p>
        <div class="shared-feed-panel-card__actions">
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="auth-signup-inline">Create account</button>
          <button class="shared-feed-chip" data-action="open-app-shell">Open app</button>
        </div>
      </div>
    </div>
  </article>`;
}

function renderFeedItems(items) {
  if (!items.length) {
    return `<div class="shared-feed-empty">
      <h2>Nothing here yet.</h2>
      <p>Try opening this post in the Polis app for the full experience.</p>
    </div>`;
  }

  return items
    .map((item, index) => {
      if (item.kind === "event") {
        return renderEventItem(item, index);
      }
      if (item.kind === "prompt") {
        return renderPromptItem(item, index);
      }
      return renderPostItem(item, index);
    })
    .join("");
}

function renderFeedStage() {
  const feed = getCurrentFeedState();
  const items = getCurrentItems();
  const showFollowingGate =
    state.mode === FEED_MODE_FOLLOWING &&
    !state.auth.session &&
    !feed.bootstrapped;

  return `<section class="shared-feed-stage">
    ${renderTopChrome()}
    <div class="shared-feed-scroll" id="shared-feed-scroll">
      ${
        feed.loading
          ? `<div class="shared-feed-loading"><div class="shared-feed-loading__pulse"></div><p>Loading feed…</p></div>`
          : ""
      }
      ${
        feed.error
          ? `<div class="shared-feed-error"><h2>Feed unavailable</h2><p>${escapeHtml(feed.error)}</p></div>`
          : ""
      }
      ${
        showFollowingGate
          ? `<div class="shared-feed-locked">
              <h2>Following is personal.</h2>
              <p>Sign in to load the people and campaigns you follow.</p>
              <button class="shared-feed-chip shared-feed-chip--primary" data-action="auth-login-inline">Log in</button>
            </div>`
          : renderFeedItems(items)
      }
      ${
        feed.loadingMore
          ? `<div class="shared-feed-loading-more">Loading more…</div>`
          : ""
      }
    </div>
  </section>`;
}

function renderCommentsPanel() {
  const open = state.ui.comments.open;
  const postId = state.ui.comments.postId;
  const currentPost = getCurrentItems().find((item) => item.postId === postId);
  const comments = state.ui.comments.items
    .map((comment) => {
      const replyBadge = comment.replyTo
        ? `<span class="shared-comments__reply-pill">Reply</span>`
        : "";
      const replyClass = comment.replyTo ? " is-reply" : "";
      const highlightClass =
        state.ui.comments.highlightedCommentId === comment.commentId
          ? " is-highlighted"
          : "";
      return `<article class="shared-comment${replyClass}${highlightClass}" data-comment-id="${escapeHtml(comment.commentId)}">
        <div class="shared-comment__avatar">
          ${
            comment.avatarUrl
              ? `<img src="${escapeHtml(comment.avatarUrl)}" alt="${escapeHtml(comment.displayName)}" />`
              : `<span>${escapeHtml(comment.displayName.slice(0, 1).toUpperCase() || "P")}</span>`
          }
        </div>
        <div class="shared-comment__body">
          <div class="shared-comment__meta">
            <span class="shared-comment__name">${escapeHtml(comment.displayName)}</span>
            ${
              comment.username
                ? `<span class="shared-comment__username">@${escapeHtml(comment.username)}</span>`
                : ""
            }
            ${replyBadge}
            ${
              comment.createdAt
                ? `<span class="shared-comment__time">${escapeHtml(formatRelativeTime(comment.createdAt))}</span>`
                : ""
            }
          </div>
          <p class="shared-comment__text">${escapeHtml(comment.text)}</p>
          <div class="shared-comment__actions">
            <button data-action="reply-comment" data-comment-id="${escapeHtml(comment.commentId)}">Reply</button>
            <button data-action="toggle-comment-like" data-comment-id="${escapeHtml(comment.commentId)}" class="${comment.likedByMe ? "is-active" : ""}">
              Like ${escapeHtml(formatCount(comment.likeCount))}
            </button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  return `<div class="shared-comments${open ? " is-open" : ""}">
    <button class="shared-comments__backdrop" data-action="close-comments" aria-label="Close comments"></button>
    <section class="shared-comments__panel" aria-hidden="${open ? "false" : "true"}">
      <div class="shared-comments__handle"></div>
      <div class="shared-comments__header">
        <div>
          <h2>Comments</h2>
          <p>${escapeHtml(formatCount(state.ui.comments.items.length))} replies on this post</p>
        </div>
        <button class="shared-comments__close" data-action="close-comments" aria-label="Close comments">${renderIcon("close")}</button>
      </div>
      <div class="shared-comments__list">
        ${
          state.ui.comments.loading
            ? `<div class="shared-comments__empty">Loading comments…</div>`
            : state.ui.comments.error
              ? `<div class="shared-comments__empty">${escapeHtml(state.ui.comments.error)}</div>`
              : comments || `<div class="shared-comments__empty">No comments yet.</div>`
        }
      </div>
      <div class="shared-comments__composer">
        ${
          state.ui.comments.replyTo
            ? `<div class="shared-comments__replying">
                Replying in thread
                <button data-action="cancel-reply">Cancel</button>
              </div>`
            : ""
        }
        ${
          state.auth.session
            ? `<form class="shared-comments__form" data-comment-form="1">
                <textarea name="comment" rows="2" placeholder="Write a comment about ${escapeHtml(currentPost?.authorDisplayName || "this post")}"></textarea>
                <button type="submit"${state.ui.comments.submitting ? " disabled" : ""}>${state.ui.comments.submitting ? "Posting…" : "Post"}</button>
              </form>`
            : `<button class="shared-comments__locked" data-action="auth-login-inline">
                Log in or sign up to comment
              </button>`
        }
      </div>
    </section>
  </div>`;
}

function renderAuthModal() {
  const modal = state.ui.authModal;
  const stores = getStoreUrls();
  return `<div class="shared-auth-modal${modal ? " is-open" : ""}">
    <button class="shared-auth-modal__backdrop" data-action="close-auth-modal" aria-label="Close sign-in modal"></button>
    <section class="shared-auth-modal__dialog" aria-hidden="${modal ? "false" : "true"}">
      <p class="shared-auth-modal__eyebrow">Polis account</p>
      <h2>${escapeHtml(modal?.title || "Join Polis")}</h2>
      <p>${escapeHtml(modal?.message || "Sign in to unlock the full feed.")}</p>
      <div class="shared-auth-modal__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="auth-login-inline">Log in</button>
        <button class="shared-feed-chip" data-action="auth-signup-inline">Sign up</button>
      </div>
      <div class="shared-auth-modal__secondary">
        <button class="shared-feed-chip" data-action="auth-open-app" data-post-id="${escapeHtml(modal?.postId || runtimeConfig.postId || "")}">Open app instead</button>
        ${
          stores.ios || stores.android
            ? `<div class="shared-auth-modal__stores">
                ${
                  stores.ios
                    ? `<a href="${escapeHtml(stores.ios)}" target="_blank" rel="noopener noreferrer">iPhone</a>`
                    : ""
                }
                ${
                  stores.android
                    ? `<a href="${escapeHtml(stores.android)}" target="_blank" rel="noopener noreferrer">Android</a>`
                    : ""
                }
              </div>`
            : ""
        }
      </div>
    </section>
  </div>`;
}

function renderToast() {
  return state.ui.toast
    ? `<div class="shared-feed-toast">${escapeHtml(state.ui.toast)}</div>`
    : "";
}

function renderApp() {
  if (!root) {
    return;
  }

  ensureActiveIndexInBounds();
  const playbackSnapshot = snapshotPlaybackState();
  const shell = `<div class="shared-feed-shell">
    ${renderRail()}
    ${renderFeedStage()}
  </div>
  ${renderCommentsPanel()}
  ${renderAuthModal()}
  ${renderToast()}`;
  root.innerHTML = shell;
  bindObservers();
  bindVideos();
  restorePlaybackState(playbackSnapshot);
  focusComposerIfNeeded();
}

function focusComposerIfNeeded() {
  if (!state.ui.comments.open || !state.auth.session) {
    return;
  }
  const textarea = root.querySelector(".shared-comments__form textarea");
  if (textarea && state.ui.comments.replyTo) {
    textarea.focus();
  }
}

function bindObservers() {
  if (observer) {
    observer.disconnect();
  }
  const items = Array.from(root.querySelectorAll(".shared-feed-item"));
  if (!items.length) {
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) {
        return;
      }
      const nextIndex = Number(visible.target.getAttribute("data-index") || 0);
      if (Number.isFinite(nextIndex) && nextIndex !== state.activeIndex) {
        state.activeIndex = nextIndex;
        syncPlayback();
        if (nextIndex >= getCurrentItems().length - 2) {
          loadMoreFeed(state.mode).catch(() => {});
        }
      }
    },
    {
      threshold: [0.35, 0.55, 0.75],
      root: root.querySelector("#shared-feed-scroll"),
      rootMargin: "0px",
    },
  );

  for (const item of items) {
    observer.observe(item);
  }
}

function getVideoCardIndex(video) {
  return Number(
    video.closest(".shared-feed-item")?.getAttribute("data-index") || -1,
  );
}

function resolvePreferredHlsLevel(levels = [], video) {
  if (!Array.isArray(levels) || !levels.length) {
    return -1;
  }
  const targetHeight = Math.max(video.clientHeight || 0, 720);
  const levelsWithIndex = levels
    .map((level, index) => ({
      index,
      height: Number(level?.height) || 0,
    }))
    .filter((level) => level.height > 0)
    .sort((left, right) => left.height - right.height);
  if (!levelsWithIndex.length) {
    return -1;
  }
  const match =
    levelsWithIndex.find((level) => level.height >= targetHeight) ||
    levelsWithIndex[Math.max(0, levelsWithIndex.length - 1)];
  return match?.index ?? -1;
}

function hydrateVideo(video) {
  if (!video || video.dataset.mediaHydrated === "1") {
    return;
  }
  const hlsUrl = normalizeString(video.dataset.videoUrl);
  const mp4Url = normalizeString(video.dataset.mp4Url);
  if (!hlsUrl && !mp4Url) {
    return;
  }

  video.dataset.mediaHydrated = "1";
  video.muted = !state.userHasInteracted;
  video.playsInline = true;
  video.loop = true;

  if (video.canPlayType("application/vnd.apple.mpegurl") && hlsUrl) {
    video.src = hlsUrl;
    return;
  }

  if (hlsUrl) {
    ensureHlsLoader()
      .then((Hls) => {
        if (!Hls?.isSupported || !Hls.isSupported()) {
          if (mp4Url) {
            video.src = mp4Url;
          }
          return;
        }
        const controller = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          capLevelToPlayerSize: true,
          startFragPrefetch: true,
        });
        controller.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          const preferredLevel = resolvePreferredHlsLevel(data?.levels, video);
          if (preferredLevel >= 0) {
            controller.startLevel = preferredLevel;
            controller.nextLevel = preferredLevel;
          }
        });
        controller.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal && mp4Url) {
            controller.destroy();
            video.src = mp4Url;
          }
        });
        controller.loadSource(hlsUrl);
        controller.attachMedia(video);
        video.__polisHlsController = controller;
        hlsControllers.push(controller);
      })
      .catch(() => {
        if (mp4Url) {
          video.src = mp4Url;
        }
      });
    return;
  }

  if (mp4Url) {
    video.src = mp4Url;
  }
}

function syncVideoLoadingStrategy() {
  Array.from(root?.querySelectorAll("video[data-video-post-id]") || []).forEach(
    (video) => {
      const index = getVideoCardIndex(video);
      const distance = Number.isFinite(index)
        ? Math.abs(index - state.activeIndex)
        : Number.POSITIVE_INFINITY;
      const shouldWarm = distance <= 1;
      video.preload = shouldWarm ? "auto" : "metadata";
      if (shouldWarm) {
        hydrateVideo(video);
      }
    },
  );
}

function syncPlayback() {
  syncVideoLoadingStrategy();
  const cards = Array.from(root.querySelectorAll(".shared-feed-item--post"));
  cards.forEach((card) => {
    const index = Number(card.getAttribute("data-index") || -1);
    const video = card.querySelector("video");
    const indicator = card.querySelector("[data-playback-indicator]");
    const isActive = index === state.activeIndex;
    card.classList.toggle("is-active", isActive);
    if (!video) {
      return;
    }
    video.muted = !state.userHasInteracted;
    if (
      isActive &&
      !state.ui.comments.open &&
      (state.mode === FEED_MODE_FOR_YOU || state.mode === FEED_MODE_FOLLOWING)
    ) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
      if (indicator) {
        indicator.classList.remove("is-visible");
      }
    } else {
      video.pause();
      if (indicator) {
        indicator.classList.add("is-visible");
      }
    }
  });
  updateVolumeButtons();
}

function bindVideos() {
  destroyPlayerControllers();
  const videos = Array.from(root.querySelectorAll("video[data-video-post-id]"));
  for (const video of videos) {
    const postId = normalizeString(video.dataset.videoPostId);
    video.muted = !state.userHasInteracted;
    video.playsInline = true;
    video.loop = true;

    video.addEventListener("timeupdate", () => updateScrubber(postId, video));
    video.addEventListener("loadedmetadata", () => updateScrubber(postId, video));
    video.addEventListener("play", () => {
      const indicator = root.querySelector(`[data-playback-indicator="${CSS.escape(postId)}"]`);
      indicator?.classList.remove("is-visible");
    });
    video.addEventListener("pause", () => {
      const index = Number(
        video.closest(".shared-feed-item")?.getAttribute("data-index") || -1,
      );
      const indicator = root.querySelector(`[data-playback-indicator="${CSS.escape(postId)}"]`);
      if (index === state.activeIndex) {
        indicator?.classList.add("is-visible");
      }
    });
  }
  syncPlayback();
}

function snapshotPlaybackState() {
  if (!root) {
    return {};
  }
  return Array.from(root.querySelectorAll("video[data-video-post-id]")).reduce(
    (snapshot, video) => {
      const postId = normalizeString(video.dataset.videoPostId);
      if (!postId) {
        return snapshot;
      }
      snapshot[postId] = {
        currentTime: Number(video.currentTime) || 0,
        paused: video.paused,
        muted: video.muted,
      };
      return snapshot;
    },
    {},
  );
}

function restorePlaybackState(snapshot = {}) {
  Object.entries(snapshot).forEach(([postId, value]) => {
    const video = root?.querySelector(
      `video[data-video-post-id="${CSS.escape(postId)}"]`,
    );
    if (!video) {
      return;
    }

    const applySnapshot = () => {
      if (Number.isFinite(value.currentTime) && value.currentTime > 0) {
        try {
          video.currentTime = value.currentTime;
        } catch {
          // Ignore media seek timing errors during initial load.
        }
      }
      video.muted = value.muted;
      if (value.paused) {
        video.pause();
        return;
      }
      if (!state.ui.comments.open) {
        video.play().catch(() => {});
      }
    };

    if (video.readyState >= 1) {
      applySnapshot();
      return;
    }
    video.addEventListener("loadedmetadata", applySnapshot, { once: true });
  });
  updateVolumeButtons();
}

function updateVolumeButtons() {
  Array.from(root?.querySelectorAll(".shared-feed-post__volume") || []).forEach(
    (button) => {
      button.innerHTML = state.userHasInteracted
        ? renderIcon("soundOn")
        : renderIcon("soundOff");
      button.setAttribute(
        "aria-label",
        state.userHasInteracted ? "Disable sound" : "Enable sound",
      );
    },
  );
}

function updateScrubber(postId, video) {
  const slider = root.querySelector(`[data-scrubber-input="${CSS.escape(postId)}"]`);
  const time = root.querySelector(`[data-scrubber-time="${CSS.escape(postId)}"]`);
  if (!slider || !time) {
    return;
  }

  const duration = Number(video.duration);
  const currentTime = Number(video.currentTime);
  if (!Number.isFinite(duration) || duration <= 0) {
    slider.value = "0";
    time.textContent = `00:00 / ${formatDuration(0)}`;
    return;
  }
  slider.value = String(Math.round((currentTime / duration) * 1000));
  time.textContent = `${formatDuration(currentTime * 1000)} / ${formatDuration(duration * 1000)}`;
}

async function handleInlineAuth(action) {
  if (!hasHostedSignInConfig(state.auth.config)) {
    openAuthModal("auth_unavailable", {
      title: "Web sign-in is not configured yet",
      message:
        "Open the Polis app for now, or finish the website Cognito configuration and try again.",
    });
    return;
  }
  try {
    if (action === "login") {
      await startHostedSignIn(state.auth.config);
    } else {
      await startHostedSignUp(state.auth.config);
    }
  } catch {
    showToast("Sign-in could not be started.");
  }
}

function handleRootClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }
  const action = target.getAttribute("data-action");
  if (
    target.classList.contains("shared-feed-post__frame") &&
    event.target.closest("[data-playback-control='1']")
  ) {
    return;
  }

  if (action === "toggle-mode") {
    const nextMode = target.getAttribute("data-mode");
    if (nextMode === FEED_MODE_FOLLOWING) {
      if (!state.auth.session) {
        openAuthModal("following");
        return;
      }
      loadFollowingFeed().catch(() => {});
      return;
    }
    state.mode = FEED_MODE_FOR_YOU;
    scheduleRender();
    return;
  }

  if (action === "toggle-like") {
    handlePostLike(target.getAttribute("data-post-id")).catch(() => {});
    return;
  }

  if (action === "toggle-save") {
    handleSavePost(target.getAttribute("data-post-id")).catch(() => {});
    return;
  }

  if (action === "open-comments") {
    openComments(target.getAttribute("data-post-id")).catch(() => {});
    return;
  }

  if (action === "close-comments") {
    closeComments();
    return;
  }

  if (action === "reply-comment") {
    const commentId = normalizeString(target.getAttribute("data-comment-id"));
    if (!state.auth.session) {
      openAuthModal("write_comment");
      return;
    }
    state.ui.comments.replyTo = commentId || null;
    scheduleRender();
    return;
  }

  if (action === "cancel-reply") {
    state.ui.comments.replyTo = null;
    scheduleRender();
    return;
  }

  if (action === "toggle-comment-like") {
    handleCommentLike(target.getAttribute("data-comment-id")).catch(() => {});
    return;
  }

  if (action === "share") {
    handleShare(target.getAttribute("data-post-id")).catch(() => {});
    return;
  }

  if (action === "open-app") {
    requestAppOpen(target.getAttribute("data-post-id"));
    return;
  }

  if (action === "open-app-shell") {
    requestAppOpen(runtimeConfig.postId || "");
    return;
  }

  if (action === "auth-login-inline") {
    handleInlineAuth("login");
    return;
  }

  if (action === "auth-signup-inline") {
    handleInlineAuth("signup");
    return;
  }

  if (action === "close-auth-modal") {
    closeAuthModal();
    return;
  }

  if (action === "auth-open-app") {
    requestAppOpen(target.getAttribute("data-post-id") || runtimeConfig.postId || "");
    return;
  }

  if (action === "logout") {
    clearSharedFeedSession();
    state.auth.session = null;
    state.auth.user = null;
    state.mode = FEED_MODE_FOR_YOU;
    state.feeds[FEED_MODE_FOLLOWING] = {
      items: [],
      nextCursor: null,
      sessionId: null,
      loading: false,
      loadingMore: false,
      error: "",
      bootstrapped: false,
      unauthorized: false,
    };
    closeAuthModal();
    showToast("Signed out.");
    return;
  }

  if (action === "follow-author") {
    const postId = normalizeString(target.getAttribute("data-post-id"));
    const item = getCurrentItems().find((candidate) => candidate.postId === postId);
    if (item) {
      handleFollowAuthor(item).catch(() => {});
    }
    return;
  }

  if (action === "top-action" || action === "nav-gate" || action === "profile") {
    openAuthModal("nav_gate", {
      title: "Continue in Polis",
      message:
        "This section opens in the app today. Sign in here to unlock feed actions, or open the app for the full product surface.",
    });
    return;
  }

  if (action === "toggle-volume") {
    state.userHasInteracted = !state.userHasInteracted;
    Array.from(root?.querySelectorAll("video[data-video-post-id]") || []).forEach(
      (video) => {
        video.muted = !state.userHasInteracted;
      },
    );
    updateVolumeButtons();
    return;
  }

  if (action === "toggle-play") {
    const postId = normalizeString(target.getAttribute("data-post-id"));
    const video = root.querySelector(`video[data-video-post-id="${CSS.escape(postId)}"]`);
    if (!video) {
      return;
    }
    state.userHasInteracted = true;
    video.muted = false;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    updateVolumeButtons();
  }
}

function handleRootInput(event) {
  const slider = event.target.closest("[data-scrubber-input]");
  if (!slider) {
    return;
  }
  const postId = normalizeString(slider.getAttribute("data-scrubber-input"));
  const video = root.querySelector(`video[data-video-post-id="${CSS.escape(postId)}"]`);
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }
  const fraction = Number(slider.value) / 1000;
  video.currentTime = Math.max(0, Math.min(1, fraction)) * video.duration;
  updateScrubber(postId, video);
}

function handleCommentSubmit(event) {
  const form = event.target.closest("[data-comment-form]");
  if (!form) {
    return;
  }
  event.preventDefault();
  const textarea = form.querySelector("textarea[name='comment']");
  submitComment(textarea?.value || "").then(() => {
    if (textarea) {
      textarea.value = "";
    }
  });
}

async function bootstrapAuth() {
  const completed = await completeHostedSignIn(state.auth.config);
  const session = completed.session || getStoredSharedFeedSession();
  state.auth.session = session;
  state.auth.user = getAuthenticatedUser(session);
  if (completed.error) {
    state.auth.message = completed.error;
    showToast(completed.error);
  } else if (completed.handled && session) {
    showToast(`Signed in as ${state.auth.user?.displayName || "your account"}.`);
  }
}

function attachGlobalListeners() {
  root?.addEventListener("click", handleRootClick);
  root?.addEventListener("input", handleRootInput);
  root?.addEventListener("submit", handleCommentSubmit);
  window.addEventListener(
    "pointerdown",
    () => {
      if (!state.userHasInteracted) {
        state.userHasInteracted = true;
        Array.from(root?.querySelectorAll("video[data-video-post-id]") || []).forEach(
          (video) => {
            video.muted = false;
          },
        );
        syncPlayback();
      }
    },
    { once: true },
  );
}

async function init() {
  if (!root) {
    return;
  }

  ensureMediaPreconnect();
  attachGlobalListeners();
  await bootstrapAuth();
  await loadInitialFeed();
}

void init();
