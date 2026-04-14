import "./css/shared-feed.css";
import polisLogoUrl from "../../assets/images/polis/Polis.png";

import {
  SharedFeedAuthError,
  buildAuthorizedHeaders,
  clearSharedFeedSession,
  confirmSharedFeedSignUp,
  consumeSharedFeedPostAuthPath,
  completeHostedSignIn,
  getAuthenticatedUser,
  getSharedFeedAuthCapabilities,
  hasHostedSignInConfig,
  resendSharedFeedSignUpCode,
  restoreSharedFeedSession,
  setSharedFeedPostAuthPath,
  signInSharedFeedWithPassword,
  signUpSharedFeedWithEmail,
  startHostedSignIn,
  startHostedSignUp,
} from "./scripts/sharedFeedAuth.js";
import {
  createMessagingBrowserDevice,
  createMessagingSocketClient,
} from "./scripts/webMessaging.js";

const runtimeConfig =
  window.__POLIS_WEB_APP__ || window.__POLIS_SHARED_FEED__ || {};
const root = document.getElementById("shared-feed-app");
const initialCommentId =
  new URL(window.location.href).searchParams.get("commentId") || "";

const FEED_MODE_FOR_YOU = "for_you";
const FEED_MODE_FOLLOWING = "following";
const IMMERSIVE_FEED_PAGE_LIMIT = 6;
const GRID_FEED_PAGE_LIMIT = 25;
const ROUTE_KEY_SHARE_POST = "share-post";
const ROUTE_KEY_FEED = "feed";
const ROUTE_KEY_CANDIDATES = "candidates";
const ROUTE_KEY_OFFICIAL_DETAIL = "official-detail";
const ROUTE_KEY_OFFICIAL_REPORT_CARD = "official-report-card";
const ROUTE_KEY_AUTO_CANDIDATE_DETAIL = "auto-candidate-detail";
const ROUTE_KEY_CANDIDATE_DETAIL = "candidate-detail";
const ROUTE_KEY_CANDIDATE_EDIT = "candidate-edit";
const ROUTE_KEY_EVENTS = "events";
const ROUTE_KEY_EVENT_DETAIL = "event-detail";
const ROUTE_KEY_MANAGE_EVENTS = "manage-events";
const ROUTE_KEY_MANAGE_EVENTS_NEW = "manage-events-new";
const ROUTE_KEY_MANAGE_EVENTS_EDIT = "manage-events-edit";
const ROUTE_KEY_PROFILE_SELF = "profile-self";
const ROUTE_KEY_PROFILE_USER = "profile-user";
const ROUTE_KEY_PROFILE_EDIT = "profile-edit";
const ROUTE_KEY_PROFILE_CONNECTIONS = "profile-connections";
const ROUTE_KEY_PROFILE_NOTIFICATIONS = "profile-notifications";
const ROUTE_KEY_MESSAGES_ROOT = "messages-root";
const ROUTE_KEY_MESSAGES_WILDCARD = "messages-wildcard";

function normalizePathname(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function decodeRouteSegment(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function normalizeRouteParams(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.entries(value).reduce((params, [key, raw]) => {
    params[key] = normalizeString(raw);
    return params;
  }, {});
}

function parseRouteFromLocation(pathname = window.location.pathname) {
  const normalizedPath = normalizePathname(pathname);
  const routePatterns = [
    [ROUTE_KEY_SHARE_POST, /^\/posts\/([^/]+)$/u, ["postId"]],
    [ROUTE_KEY_FEED, /^\/feed$/u, []],
    [ROUTE_KEY_CANDIDATES, /^\/candidates$/u, []],
    [
      ROUTE_KEY_OFFICIAL_REPORT_CARD,
      /^\/officials\/([^/]+)\/report-card$/u,
      ["officialId"],
    ],
    [ROUTE_KEY_OFFICIAL_DETAIL, /^\/officials\/([^/]+)$/u, ["officialId"]],
    [
      ROUTE_KEY_AUTO_CANDIDATE_DETAIL,
      /^\/auto-candidates\/([^/]+)$/u,
      ["entityId"],
    ],
    [
      ROUTE_KEY_CANDIDATE_EDIT,
      /^\/candidates\/([^/]+)\/edit$/u,
      ["candidateId"],
    ],
    [ROUTE_KEY_CANDIDATE_DETAIL, /^\/candidates\/([^/]+)$/u, ["candidateId"]],
    [ROUTE_KEY_EVENTS, /^\/events$/u, []],
    [ROUTE_KEY_EVENT_DETAIL, /^\/events\/([^/]+)$/u, ["eventId"]],
    [ROUTE_KEY_MANAGE_EVENTS, /^\/manage-events$/u, []],
    [ROUTE_KEY_MANAGE_EVENTS_NEW, /^\/manage-events\/new$/u, []],
    [
      ROUTE_KEY_MANAGE_EVENTS_EDIT,
      /^\/manage-events\/([^/]+)\/edit$/u,
      ["eventId"],
    ],
    [ROUTE_KEY_PROFILE_SELF, /^\/profile$/u, []],
    [ROUTE_KEY_PROFILE_EDIT, /^\/profile\/edit$/u, []],
    [ROUTE_KEY_PROFILE_CONNECTIONS, /^\/profile\/connections$/u, []],
    [ROUTE_KEY_PROFILE_NOTIFICATIONS, /^\/profile\/notifications$/u, []],
    [ROUTE_KEY_PROFILE_USER, /^\/profile\/([^/]+)$/u, ["userId"]],
    [ROUTE_KEY_MESSAGES_ROOT, /^\/messages$/u, []],
    [ROUTE_KEY_MESSAGES_WILDCARD, /^\/messages\/(.+)$/u, ["messagePath"]],
  ];

  for (const [routeKey, pattern, paramKeys] of routePatterns) {
    const match = pattern.exec(normalizedPath);
    if (!match) {
      continue;
    }
    const routeParams = {};
    paramKeys.forEach((key, index) => {
      routeParams[key] = normalizeString(match[index + 1]);
    });
    return {
      routeKey,
      routePath: normalizedPath,
      routeParams,
    };
  }

  return {
    routeKey: ROUTE_KEY_SHARE_POST,
    routePath: normalizedPath,
    routeParams: normalizeRouteParams(runtimeConfig.routeParams),
  };
}

function getInitialRoute() {
  const runtimeRouteKey = normalizeString(runtimeConfig.routeKey);
  if (runtimeRouteKey) {
    return {
      routeKey: runtimeRouteKey,
      routePath: normalizePathname(
        runtimeConfig.route || window.location.pathname,
      ),
      routeParams: normalizeRouteParams(runtimeConfig.routeParams),
    };
  }
  return parseRouteFromLocation();
}

function createPagedState() {
  return {
    items: [],
    nextCursor: null,
    loading: false,
    loadingMore: false,
    error: "",
    loaded: false,
  };
}

function createMessagingConversationState() {
  return {
    item: null,
    messages: [],
    nextCursor: null,
    loading: false,
    error: "",
    loaded: false,
    draft: "",
    sending: false,
    typingParticipants: [],
  };
}

function createMessagingDetailState(item = null, extra = {}) {
  return {
    item,
    loading: false,
    error: "",
    loaded: false,
    ...extra,
  };
}

const state = {
  route: getInitialRoute(),
  mode: FEED_MODE_FOR_YOU,
  userHasInteracted: false,
  renderError: "",
  feedContext: {
    kind: normalizeString(runtimeConfig.shareContext?.postId)
      ? "share"
      : runtimeConfig.requiresAuth === true
        ? "app"
        : "share",
    anchorPostId:
      normalizeString(runtimeConfig.shareContext?.postId) ||
      normalizeString(runtimeConfig.routeParams?.postId) ||
      normalizeString(runtimeConfig.postId),
  },
  auth: {
    config: {
      ...(runtimeConfig.auth || {}),
      apiBaseUrl: runtimeConfig.apiBaseUrl,
    },
    session: null,
    user: null,
    message: "",
  },
  ui: {
    toast: "",
    authModal: null,
    expandedPostId: "",
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
  pages: {
    candidates: {
      list: { ...createPagedState(), filters: {} },
      detail: {
        item: null,
        posts: [],
        relatedEvents: [],
        loading: false,
        error: "",
        saving: false,
      },
      officialDetail: {
        item: null,
        loading: false,
        error: "",
      },
      autoDetail: {
        item: null,
        loading: false,
        error: "",
      },
      reportCard: {
        ...createPagedState(),
        officialId: "",
        congress: null,
        refreshedAt: null,
        fromCache: false,
        total: null,
      },
    },
    events: {
      list: {
        ...createPagedState(),
        filters: {},
        mapMode: false,
        geocoded: {},
      },
      detail: {
        item: null,
        loading: false,
        error: "",
        saving: false,
      },
      manage: {
        ...createPagedState(),
        status: "active",
      },
    },
    profile: {
      me: null,
      current: null,
      posts: createPagedState(),
      connections: {
        kind: "followers",
        ...createPagedState(),
      },
      notifications: {
        items: [],
        unreadCount: 0,
        loading: false,
        error: "",
        loaded: false,
      },
      loading: false,
      error: "",
      saving: false,
    },
    messaging: {
      bootstrap: null,
      loading: false,
      error: "",
      initialized: false,
      settings: null,
      device: {
        registered: false,
        registering: false,
        currentDeviceId: "",
        error: "",
      },
      socket: {
        connectionState: "disconnected",
        disconnectedAt: null,
        reconnectAttemptCount: 0,
      },
      inbox: createPagedState(),
      requests: createPagedState(),
      servers: createPagedState(),
      conversation: createMessagingConversationState(),
      serverDirectory: createMessagingDetailState(),
      serverSettings: createMessagingDetailState(null, {
        saving: false,
      }),
      serverRoles: {
        items: [],
        selected: null,
        members: [],
        candidates: [],
        loading: false,
        error: "",
        loaded: false,
      },
      serverMembers: {
        items: [],
        detail: null,
        loading: false,
        detailLoading: false,
        error: "",
        detailError: "",
        loaded: false,
      },
      serverBans: createPagedState(),
      roomMembers: createPagedState(),
      permissionTarget: createMessagingDetailState(null, {
        bundle: null,
      }),
      devices: createPagedState(),
      deviceLink: {
        link: null,
        pending: false,
        error: "",
        lookupCode: "",
      },
      recovery: {
        status: null,
        bundle: null,
        loading: false,
        error: "",
        loaded: false,
        localCode: "",
        actionPending: false,
      },
      security: createPagedState(),
      compose: {
        recipientId: "",
        error: "",
        pending: false,
      },
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
      requestLimit: 0,
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
      requestLimit: 0,
    },
  },
  activeIndex: 0,
};

let renderScheduled = false;
let toastTimer = null;
let observer = null;
let routeEndObserver = null;
let hlsLoaderPromise = null;
let hlsControllers = [];
let mediaPreconnectInitialized = false;
let mapLibreLoaderPromise = null;
let mapLibreStylesReady = false;
let eventsMapInstance = null;
let eventsMapMarkers = [];
let messagingTypingStopTimer = null;
let messagingSessionRetained = false;

const messagingDevice = createMessagingBrowserDevice();
const messagingSocket = createMessagingSocketClient({
  async getAuthToken() {
    return normalizeString(
      state.auth.session?.idToken || state.auth.session?.accessToken,
    );
  },
  async getDeviceId() {
    return messagingDevice.currentDeviceId();
  },
  onEvent(event) {
    handleMessagingSocketEvent(event);
  },
  onStateChange(snapshot) {
    state.pages.messaging.socket = {
      connectionState:
        normalizeString(snapshot.connectionState) || "disconnected",
      disconnectedAt: snapshot.disconnectedAt || null,
      reconnectAttemptCount: Number(snapshot.reconnectAttemptCount) || 0,
    };
    scheduleRender();
  },
});

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

function getCurrentRoute() {
  return state.route;
}

function isShareRoute(route = state.route) {
  return normalizeString(route?.routeKey) === ROUTE_KEY_SHARE_POST;
}

function isFeedRoute(route = state.route) {
  const routeKey = normalizeString(route?.routeKey);
  return routeKey === ROUTE_KEY_FEED || routeKey === ROUTE_KEY_SHARE_POST;
}

function isProtectedRoute(route = state.route) {
  return !isShareRoute(route);
}

function getRouteSection(route = state.route) {
  const routeKey = normalizeString(route?.routeKey);
  if (
    routeKey === ROUTE_KEY_CANDIDATES ||
    routeKey === ROUTE_KEY_OFFICIAL_DETAIL ||
    routeKey === ROUTE_KEY_OFFICIAL_REPORT_CARD ||
    routeKey === ROUTE_KEY_AUTO_CANDIDATE_DETAIL ||
    routeKey === ROUTE_KEY_CANDIDATE_DETAIL ||
    routeKey === ROUTE_KEY_CANDIDATE_EDIT
  ) {
    return "candidates";
  }
  if (
    routeKey === ROUTE_KEY_EVENTS ||
    routeKey === ROUTE_KEY_EVENT_DETAIL ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS_NEW ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS_EDIT
  ) {
    return "events";
  }
  if (
    routeKey === ROUTE_KEY_PROFILE_SELF ||
    routeKey === ROUTE_KEY_PROFILE_USER ||
    routeKey === ROUTE_KEY_PROFILE_EDIT ||
    routeKey === ROUTE_KEY_PROFILE_CONNECTIONS ||
    routeKey === ROUTE_KEY_PROFILE_NOTIFICATIONS
  ) {
    return "profile";
  }
  if (
    routeKey === ROUTE_KEY_MESSAGES_ROOT ||
    routeKey === ROUTE_KEY_MESSAGES_WILDCARD
  ) {
    return "messages";
  }
  return "feed";
}

function getCurrentPathWithQuery() {
  return `${window.location.pathname}${window.location.search}`;
}

function getPathnameFromRouteTarget(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "/";
  }
  try {
    return new URL(normalized, window.location.origin).pathname;
  } catch {
    return normalized.split("?")[0] || "/";
  }
}

function navigateTo(path, { replace = false } = {}) {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath) {
    return;
  }
  const nextUrl = normalizedPath.startsWith("http")
    ? normalizedPath
    : normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;
  if (nextUrl === getCurrentPathWithQuery()) {
    return;
  }
  if (replace) {
    window.history.replaceState({}, document.title, nextUrl);
  } else {
    window.history.pushState({}, document.title, nextUrl);
  }
  state.route = parseRouteFromLocation(window.location.pathname);
  loadCurrentRoute().catch(() => {});
  scheduleRender();
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

function buildDeepLinkOpenUrl(path) {
  const scheme = normalizeString(runtimeConfig.appUrlScheme) || "myapp";
  const normalizedPath = normalizeString(path);
  if (!normalizedPath || !scheme) {
    return "";
  }
  return `${scheme}://auth/?path=${encodeURIComponent(normalizedPath)}`;
}

function buildAppOpenUrl(postId, commentId = "") {
  const normalizedPostId = normalizeString(postId);
  if (!normalizedPostId) {
    return "";
  }
  const path = `/posts/${encodeURIComponent(normalizedPostId)}`;
  const commentQuery = normalizeString(commentId)
    ? `?commentId=${encodeURIComponent(normalizeString(commentId))}`
    : "";
  return buildDeepLinkOpenUrl(`${path}${commentQuery}`);
}

function getPublicWebBaseUrl() {
  return (
    normalizeString(runtimeConfig.publicWebBaseUrl) || window.location.origin
  );
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

function normalizeAuthModalMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "signup" || normalized === "confirm") {
    return normalized;
  }
  return "login";
}

function buildEmptyAuthFields(seed = {}) {
  return {
    identifier: normalizeString(seed.identifier),
    password: String(seed.password ?? ""),
    email: normalizeString(seed.email),
    signupPassword: String(seed.signupPassword ?? ""),
    confirmPassword: String(seed.confirmPassword ?? ""),
    code: normalizeString(seed.code),
  };
}

function cloneAwaitingConfirmation(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    username: normalizeString(value.username),
    email: normalizeString(value.email),
    password: String(value.password ?? ""),
    deliveryDestination: normalizeString(value.deliveryDestination) || null,
  };
}

function getAuthModalDefaultTitle(kind, context = {}) {
  if (normalizeString(context.title)) {
    return normalizeString(context.title);
  }
  if (kind === "following") {
    return "Log in to unlock Following";
  }
  if (kind === "route-protected") {
    const section = getRouteSection(
      parseRouteFromLocation(getPathnameFromRouteTarget(context.targetPath)),
    );
    if (section === "candidates") {
      return "Log in to open Candidates";
    }
    if (section === "events") {
      return "Log in to open Events";
    }
    if (section === "profile") {
      return "Log in to open Profile";
    }
    if (section === "messages") {
      return "Log in to open Messages";
    }
    return "Log in to continue";
  }
  if (kind === "signup") {
    return "Create your Polis account";
  }
  if (kind === "auth_unavailable") {
    return "Web sign-in is not configured yet";
  }
  return "Join Polis to keep going";
}

function getAuthModalDefaultMessage(kind, context = {}) {
  if (normalizeString(context.message)) {
    return normalizeString(context.message);
  }
  if (kind === "route-protected") {
    return "Sign in or create an account to use this feature in the browser, or open the Polis app instead.";
  }
  if (kind === "following") {
    return "Sign in to unlock your Following feed and the rest of the Polis web app.";
  }
  if (kind === "auth_unavailable") {
    return "Open the Polis app for now, or finish the website Cognito configuration and try again.";
  }
  return "Sign in or create an account to like posts, join conversations, and open this feed inside the app.";
}

function buildAuthModalState(kind, context = {}) {
  const previous = state.ui.authModal;
  const targetPath =
    normalizeString(context.targetPath) ||
    normalizeString(previous?.targetPath) ||
    getCurrentPathWithQuery();
  const mode = normalizeAuthModalMode(
    context.mode ||
      (context.awaitingConfirmation ? "confirm" : "") ||
      previous?.mode ||
      (kind === "signup" ? "signup" : "login"),
  );
  const previousFields = previous?.fields || {};
  const nextFields = buildEmptyAuthFields({
    ...previousFields,
    ...context.fields,
  });

  if (!nextFields.email && nextFields.identifier.includes("@")) {
    nextFields.email = nextFields.identifier;
  }
  if (
    !nextFields.identifier &&
    normalizeAuthModalMode(mode) === "login" &&
    nextFields.email
  ) {
    nextFields.identifier = nextFields.email;
  }

  return {
    kind,
    mode,
    title: getAuthModalDefaultTitle(kind, context),
    message: getAuthModalDefaultMessage(kind, context),
    postId:
      normalizeString(context.postId) || normalizeString(previous?.postId),
    targetPath,
    pending: false,
    error: "",
    notice: normalizeString(context.notice),
    fields: nextFields,
    awaitingConfirmation:
      cloneAwaitingConfirmation(context.awaitingConfirmation) ||
      (mode === "confirm"
        ? cloneAwaitingConfirmation(previous?.awaitingConfirmation)
        : null),
    capabilities: getSharedFeedAuthCapabilities(state.auth.config),
  };
}

function openAuthModal(kind, context = {}) {
  state.ui.authModal = buildAuthModalState(kind, context);
  scheduleRender();
}

function closeAuthModal() {
  state.ui.authModal = null;
  scheduleRender();
}

function patchAuthModal(patcher) {
  if (!state.ui.authModal) {
    return;
  }
  const nextValue = patcher(state.ui.authModal);
  if (!nextValue) {
    return;
  }
  state.ui.authModal = nextValue;
  scheduleRender();
}

function setAuthModalMode(mode) {
  patchAuthModal((modal) => {
    const nextMode = normalizeAuthModalMode(mode);
    const nextFields = { ...modal.fields };
    if (nextMode === "signup" && !nextFields.email && nextFields.identifier) {
      nextFields.email = nextFields.identifier;
    }
    if (nextMode === "login" && !nextFields.identifier && nextFields.email) {
      nextFields.identifier = nextFields.email;
    }
    return {
      ...modal,
      mode: nextMode,
      error: "",
      notice: "",
      pending: false,
      fields: nextFields,
      awaitingConfirmation:
        nextMode === "confirm" ? modal.awaitingConfirmation : null,
      capabilities: getSharedFeedAuthCapabilities(state.auth.config),
    };
  });
}

function setAuthModalError(message) {
  patchAuthModal((modal) => ({
    ...modal,
    pending: false,
    error: normalizeString(message),
    notice: "",
  }));
}

function setAuthModalNotice(message) {
  patchAuthModal((modal) => ({
    ...modal,
    pending: false,
    error: "",
    notice: normalizeString(message),
  }));
}

function setAuthModalPending(isPending) {
  patchAuthModal((modal) => ({
    ...modal,
    pending: isPending === true,
  }));
}

function setAuthModalAwaitingConfirmation(awaitingConfirmation) {
  patchAuthModal((modal) => ({
    ...modal,
    mode: "confirm",
    title: "Confirm your account",
    message:
      "Enter the verification code we sent to your email to finish signing up.",
    pending: false,
    error: "",
    notice: "",
    awaitingConfirmation: cloneAwaitingConfirmation(awaitingConfirmation),
    fields: {
      ...modal.fields,
      code: "",
    },
  }));
}

function buildProtectedRouteContext(path) {
  const normalizedPath = normalizeString(path) || getCurrentPathWithQuery();
  return {
    targetPath: normalizedPath,
    title: getAuthModalDefaultTitle("route-protected", {
      targetPath: normalizedPath,
    }),
    message: getAuthModalDefaultMessage("route-protected", {
      targetPath: normalizedPath,
    }),
  };
}

function promptForProtectedRoute(path) {
  openAuthModal("route-protected", buildProtectedRouteContext(path));
}

function navigateWithAuthGate(path, options = {}) {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath) {
    return;
  }
  if (
    !state.auth.session &&
    isProtectedRoute(parseRouteFromLocation(getPathnameFromRouteTarget(path)))
  ) {
    promptForProtectedRoute(normalizedPath);
    return;
  }
  navigateTo(normalizedPath, options);
}

async function finalizeAuthSuccess({
  session,
  user,
  targetPath = "",
  toastMessage = "",
} = {}) {
  state.auth.session = session;
  state.auth.user = user || getAuthenticatedUser(session);
  state.auth.message = "";
  closeAuthModal();
  if (toastMessage) {
    showToast(toastMessage);
  }
  const nextPath = normalizeString(targetPath);
  if (nextPath && nextPath !== getCurrentPathWithQuery()) {
    navigateTo(nextPath);
    return;
  }
  await loadCurrentRoute({ refresh: true });
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

function getMapStyleUrl() {
  const styleUrl = normalizeString(runtimeConfig.map?.styleUrl);
  if (styleUrl) {
    return styleUrl;
  }
  const mapTilerApiKey = normalizeString(runtimeConfig.map?.maptilerApiKey);
  if (!mapTilerApiKey) {
    return "";
  }
  return `https://api.maptiler.com/maps/streets/style.json?key=${encodeURIComponent(mapTilerApiKey)}`;
}

function ensureMapLibreLoader() {
  if (window.maplibregl) {
    return Promise.resolve(window.maplibregl);
  }
  if (mapLibreLoaderPromise) {
    return mapLibreLoaderPromise;
  }
  if (!mapLibreStylesReady) {
    const styleHref =
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    if (!document.head.querySelector(`link[href="${styleHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = styleHref;
      document.head.append(link);
    }
    mapLibreStylesReady = true;
  }
  mapLibreLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-maplibre-loader="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.maplibregl), {
        once: true,
      });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
    script.async = true;
    script.dataset.maplibreLoader = "1";
    script.addEventListener("load", () => resolve(window.maplibregl), {
      once: true,
    });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
  return mapLibreLoaderPromise;
}

async function geocodeEventForMap(event) {
  if (!event?.eventId) {
    return null;
  }
  const cached = state.pages.events.list.geocoded[event.eventId];
  if (cached) {
    return cached;
  }
  if (Number.isFinite(event.lat) && Number.isFinite(event.lng)) {
    const coordinates = { lat: event.lat, lng: event.lng };
    state.pages.events.list.geocoded[event.eventId] = coordinates;
    return coordinates;
  }
  const apiKey = normalizeString(runtimeConfig.map?.maptilerApiKey);
  const query = normalizeString(
    [event.address, event.locationTown, event.locationName]
      .filter(Boolean)
      .join(", "),
  );
  if (!apiKey || !query) {
    return null;
  }
  try {
    const response = await fetch(
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${encodeURIComponent(apiKey)}&limit=1`,
    );
    const payload = await response.json().catch(() => ({}));
    const feature = Array.isArray(payload.features)
      ? payload.features[0]
      : null;
    const center = Array.isArray(feature?.center) ? feature.center : null;
    if (!center || center.length < 2) {
      return null;
    }
    const coordinates = {
      lng: Number(center[0]),
      lat: Number(center[1]),
    };
    if (
      !Number.isFinite(coordinates.lat) ||
      !Number.isFinite(coordinates.lng)
    ) {
      return null;
    }
    state.pages.events.list.geocoded[event.eventId] = coordinates;
    return coordinates;
  } catch {
    return null;
  }
}

function clearEventsMap() {
  if (eventsMapInstance) {
    eventsMapMarkers.forEach((marker) => marker.remove());
    eventsMapMarkers = [];
    eventsMapInstance.remove();
    eventsMapInstance = null;
  }
}

async function bindEventsMap() {
  const mapRoot = root?.querySelector("#shared-events-map");
  if (!mapRoot || !state.pages.events.list.mapMode) {
    clearEventsMap();
    return;
  }
  const styleUrl = getMapStyleUrl();
  if (!styleUrl) {
    mapRoot.innerHTML =
      '<div class="shared-page__empty">Map style is not configured for this environment.</div>';
    return;
  }
  try {
    const maplibregl = await ensureMapLibreLoader();
    if (
      eventsMapInstance &&
      typeof eventsMapInstance.getContainer === "function" &&
      eventsMapInstance.getContainer() !== mapRoot
    ) {
      clearEventsMap();
    }
    const locations = (
      await Promise.all(
        state.pages.events.list.items.map(async (event) => ({
          event,
          coordinates: await geocodeEventForMap(event),
        })),
      )
    ).filter((entry) => entry.coordinates);
    if (!eventsMapInstance) {
      eventsMapInstance = new maplibregl.Map({
        container: mapRoot,
        style: styleUrl,
        center: locations[0]
          ? [locations[0].coordinates.lng, locations[0].coordinates.lat]
          : [-111.891, 40.761],
        zoom: locations[0] ? 8 : 4,
      });
    }
    eventsMapMarkers.forEach((marker) => marker.remove());
    eventsMapMarkers = [];
    locations.forEach(({ event, coordinates }) => {
      const markerEl = document.createElement("button");
      markerEl.className = "shared-events-map__marker";
      markerEl.type = "button";
      markerEl.textContent =
        normalizeString(event.title).slice(0, 1).toUpperCase() || "E";
      markerEl.addEventListener("click", () => {
        navigateTo(`/events/${encodeURIComponent(event.eventId)}`);
      });
      const marker = new maplibregl.Marker({ element: markerEl })
        .setLngLat([coordinates.lng, coordinates.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 18 }).setHTML(
            `<strong>${escapeHtml(event.title)}</strong><br />${escapeHtml(
              event.address || event.locationTown || "",
            )}`,
          ),
        )
        .addTo(eventsMapInstance);
      eventsMapMarkers.push(marker);
    });
  } catch {
    mapRoot.innerHTML =
      '<div class="shared-page__empty">Event map failed to load.</div>';
  }
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
      attendeeCount:
        Number(raw.attendeeCount || raw.goingCount || raw.rsvpCount) || 0,
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
    tags: normalizeTagList(raw.tags || raw.hashtags || raw.hashTags),
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

function hasExpandablePostCopy(item) {
  return Boolean(normalizeString(item?.caption) || item?.tags?.length);
}

function getFeedRequestLimit(route = state.route) {
  return isShareRoute(route) ? IMMERSIVE_FEED_PAGE_LIMIT : GRID_FEED_PAGE_LIMIT;
}

function ensureActiveIndexInBounds() {
  const items = getCurrentItems();
  if (!items.length) {
    state.activeIndex = 0;
    return;
  }
  state.activeIndex = Math.min(
    items.length - 1,
    Math.max(0, state.activeIndex),
  );
}

async function fetchJson(
  path,
  {
    auth = false,
    method = "GET",
    body,
    headers = {},
    includeAccessToken = false,
  } = {},
) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("video_backend_base_url_missing");
  }

  const nextHeaders = {
    Accept: "application/json",
    ...headers,
  };
  if (auth) {
    Object.assign(
      nextHeaders,
      buildAuthorizedHeaders(state.auth.session, {}, { includeAccessToken }),
    );
  }
  const isFormData =
    typeof window.FormData !== "undefined" && body instanceof window.FormData;
  if (body !== undefined && body !== null && !isFormData) {
    nextHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: nextHeaders,
    body:
      body === undefined || body === null
        ? undefined
        : isFormData
          ? body
          : JSON.stringify(body),
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

async function loadInitialFeed({ refresh = false } = {}) {
  const feed = state.feeds[FEED_MODE_FOR_YOU];
  const limit = getFeedRequestLimit();
  if (refresh) {
    feed.items = [];
    feed.nextCursor = null;
    feed.sessionId = null;
    feed.bootstrapped = false;
    feed.requestLimit = 0;
  }
  feed.loading = true;
  feed.error = "";
  scheduleRender();

  try {
    const isShare = state.feedContext.kind === "share";
    const anchorPostId = normalizeString(state.feedContext.anchorPostId);
    const payload = isShare
      ? await fetchJson(
          `/api/public/posts/${encodeURIComponent(anchorPostId)}/web-feed?limit=${limit}`,
        )
      : await fetchJson(`/api/feed/for-you?limit=${limit}`, {
          auth: true,
        });
    feed.items = (payload.items || []).map(normalizeFeedItem);
    feed.nextCursor = normalizeString(payload.nextCursor) || null;
    feed.sessionId = normalizeString(payload.sessionId) || null;
    feed.requestLimit = limit;
    feed.loading = false;
    feed.bootstrapped = true;
    ensureActiveIndexInBounds();
    scheduleRender();

    if (isShare && initialCommentId && anchorPostId) {
      openComments(anchorPostId, { autoHighlight: initialCommentId });
    }
  } catch (error) {
    feed.loading = false;
    feed.error =
      error?.message === "video_backend_base_url_missing"
        ? "The website is missing its video backend configuration."
        : state.feedContext.kind === "share"
          ? "The shared feed could not be loaded."
          : "Your Polis feed could not be loaded.";
    scheduleRender();
  }
}

async function loadFollowingFeed({ refresh = false } = {}) {
  const feed = state.feeds[FEED_MODE_FOLLOWING];
  const limit = getFeedRequestLimit();
  if (!state.auth.session) {
    feed.unauthorized = true;
    openAuthModal("following");
    return;
  }

  if (feed.loading || feed.loadingMore) {
    return;
  }

  if (!refresh && feed.bootstrapped && feed.requestLimit === limit) {
    state.mode = FEED_MODE_FOLLOWING;
    ensureActiveIndexInBounds();
    scheduleRender();
    return;
  }

  feed.loading = true;
  feed.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(`/api/feed/following?limit=${limit}`, {
      auth: true,
    });
    feed.items = (payload.items || []).map(normalizeFeedItem);
    feed.nextCursor = normalizeString(payload.nextCursor) || null;
    feed.sessionId = normalizeString(payload.sessionId) || null;
    feed.requestLimit = limit;
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
  const limit = getFeedRequestLimit();
  if (!feed.nextCursor || feed.loadingMore) {
    return;
  }

  feed.loadingMore = true;
  scheduleRender();

  try {
    let payload;
    if (mode === FEED_MODE_FOLLOWING) {
      payload = await fetchJson(
        `/api/feed/following?limit=${limit}&cursor=${encodeURIComponent(feed.nextCursor)}`,
        { auth: true },
      );
    } else {
      const isShare = state.feedContext.kind === "share";
      const query = new URLSearchParams({
        limit: String(limit),
        cursor: feed.nextCursor,
      });
      if (feed.sessionId) {
        query.set("sessionId", feed.sessionId);
      }
      if (isShare) {
        const anchorPostId = normalizeString(state.feedContext.anchorPostId);
        if (anchorPostId) {
          query.set("excludePostId", anchorPostId);
        }
        payload = await fetchJson(
          `/api/public/feed/for-you?${query.toString()}`,
        );
      } else {
        payload = await fetchJson(`/api/feed/for-you?${query.toString()}`, {
          auth: true,
        });
      }
    }

    const incoming = (payload.items || []).map(normalizeFeedItem);
    const seenKeys = new Set(feed.items.map((item) => item.key));
    feed.items = feed.items.concat(
      incoming.filter((item) => !seenKeys.has(item.key)),
    );
    feed.nextCursor = normalizeString(payload.nextCursor) || null;
    feed.sessionId =
      normalizeString(payload.sessionId) || feed.sessionId || null;
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
      message:
        "Create an account or sign in to like this post and shape your Polis feed.",
    });
    return;
  }

  const item = getCurrentItems().find(
    (candidate) => candidate.postId === postId,
  );
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

  const item = getCurrentItems().find(
    (candidate) => candidate.postId === postId,
  );
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
    const payload = await fetchJson(
      `/api/posts/${encodeURIComponent(postId)}/save`,
      {
        auth: true,
        method: nextSaved ? "POST" : "DELETE",
      },
    );
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

  const current = state.ui.comments.items.find(
    (item) => item.commentId === commentId,
  );
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

function readCurrentSearchParams() {
  return new URLSearchParams(window.location.search);
}

function buildRouteWithQuery(path, query = {}) {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const normalized = normalizeString(value);
    if (!normalized) {
      return;
    }
    search.set(key, normalized);
  });
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function extractOfficialIdFromCandidateRouteId(value) {
  const normalized = decodeRouteSegment(value);
  if (!normalized.startsWith("official:")) {
    return "";
  }
  return normalized.slice("official:".length);
}

function extractAutoCandidateEntityId(value) {
  const normalized = decodeRouteSegment(value);
  if (!normalized.startsWith("auto-candidate:")) {
    return "";
  }
  return normalized.slice("auto-candidate:".length);
}

function buildOfficialProfileRoute(officialId, returnTo = "") {
  const normalizedOfficialId = normalizeString(officialId);
  if (!normalizedOfficialId) {
    return "/candidates";
  }
  return buildRouteWithQuery(
    `/officials/${encodeURIComponent(normalizedOfficialId)}`,
    { returnTo },
  );
}

function buildOfficialReportCardRoute(
  officialId,
  { returnTo = "", congress = null } = {},
) {
  const normalizedOfficialId = normalizeString(officialId);
  if (!normalizedOfficialId) {
    return "/candidates";
  }
  return buildRouteWithQuery(
    `/officials/${encodeURIComponent(normalizedOfficialId)}/report-card`,
    { returnTo, congress },
  );
}

function buildAutoCandidateRoute(entityId, returnTo = "") {
  const normalizedEntityId = normalizeString(entityId);
  if (!normalizedEntityId) {
    return "/candidates";
  }
  return buildRouteWithQuery(
    `/auto-candidates/${encodeURIComponent(normalizedEntityId)}`,
    { returnTo },
  );
}

function normalizeCandidateKind(raw = {}) {
  const normalizedKind = normalizeString(raw.kind).toLowerCase();
  if (normalizedKind === "official") {
    return "official";
  }
  if (
    normalizedKind === "racecandidate" ||
    normalizedKind === "race_candidate"
  ) {
    return "raceCandidate";
  }
  if (normalizedKind === "candidate") {
    return "candidate";
  }
  if (extractOfficialIdFromCandidateRouteId(raw.id)) {
    return "official";
  }
  if (extractAutoCandidateEntityId(raw.id)) {
    return "raceCandidate";
  }
  if (
    normalizeString(raw.officialId) &&
    !normalizeString(raw.candidateId) &&
    !normalizeString(raw.userId)
  ) {
    return "official";
  }
  if (normalizeString(raw.entityId) && !normalizeString(raw.candidateId)) {
    return "raceCandidate";
  }
  return "candidate";
}

function resolveCandidateOfficialId(candidate = {}) {
  return (
    normalizeString(candidate.officialId) ||
    extractOfficialIdFromCandidateRouteId(candidate.candidateId) ||
    extractOfficialIdFromCandidateRouteId(candidate.itemId)
  );
}

function resolveCandidateEntityId(candidate = {}) {
  return (
    normalizeString(candidate.entityId) ||
    extractAutoCandidateEntityId(candidate.candidateId) ||
    extractAutoCandidateEntityId(candidate.itemId)
  );
}

function resolveCandidateOpenRoute(candidate = {}, returnTo = "") {
  const kind = normalizeString(candidate.kind);
  const officialId = resolveCandidateOfficialId(candidate);
  const entityId = resolveCandidateEntityId(candidate);
  if (kind === "official" && officialId) {
    return buildOfficialProfileRoute(officialId, returnTo);
  }
  if (kind === "raceCandidate" && entityId) {
    return buildAutoCandidateRoute(entityId, returnTo);
  }
  const candidateId = normalizeString(candidate.candidateId);
  if (!candidateId) {
    return "/candidates";
  }
  return `/candidates/${encodeURIComponent(candidateId)}`;
}

function resolveCandidateEditRoute(candidate = {}) {
  const candidateId = normalizeString(candidate.candidateId);
  if (!candidateId) {
    return "/candidates";
  }
  return `/candidates/${encodeURIComponent(candidateId)}/edit`;
}

function resolveCandidateFollowTarget(candidate = {}) {
  const officialId = resolveCandidateOfficialId(candidate);
  if (officialId) {
    return { candidateId: "", officialId };
  }
  if (normalizeString(candidate.kind) === "raceCandidate") {
    return { candidateId: "", officialId: "" };
  }
  return {
    candidateId: normalizeString(candidate.candidateId),
    officialId: "",
  };
}

function applyResolvedFollowState(currentItem, nextFollowing, followersCount) {
  if (!currentItem) {
    return currentItem;
  }
  const numericFollowers = Number(followersCount);
  if (Number.isFinite(numericFollowers) && numericFollowers >= 0) {
    return {
      ...currentItem,
      isFollowing: nextFollowing,
      followersCount: numericFollowers,
    };
  }
  const previousCount = Number(currentItem.followersCount) || 0;
  const delta =
    currentItem.isFollowing === nextFollowing ? 0 : nextFollowing ? 1 : -1;
  return {
    ...currentItem,
    isFollowing: nextFollowing,
    followersCount: Math.max(0, previousCount + delta),
  };
}

function formatCalendarDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTermRange(startAt, endAt) {
  const startLabel = formatCalendarDate(startAt);
  const endLabel = formatCalendarDate(endAt);
  if (startLabel && endLabel) {
    return `${startLabel} to ${endLabel}`;
  }
  return startLabel || endLabel || "";
}

function formatApprovalRating(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}% approval`;
}

/**
 * Normalizes tag payloads that may arrive as arrays, comma-separated strings, or hashtag lists.
 */
function normalizeTagList(value) {
  const normalized = normalizeString(value);
  const entries = Array.isArray(value)
    ? value
    : normalized.includes(",") || normalized.includes("\n")
      ? normalized.split(/[,\n]/u)
      : normalized.match(/#[^\s#,]+/gu) || [];
  return entries
    .map((entry) => normalizeString(entry).replace(/^#+/u, ""))
    .filter(Boolean);
}

function normalizeCandidate(raw = {}) {
  const kind = normalizeCandidateKind(raw);
  const socials =
    raw.socials && typeof raw.socials === "object" ? raw.socials : {};
  return {
    itemId: normalizeString(raw.id),
    kind,
    candidateId: normalizeString(raw.candidateId || raw.id || raw.userId) || "",
    officialId:
      normalizeString(raw.officialId) ||
      extractOfficialIdFromCandidateRouteId(raw.id),
    entityId:
      normalizeString(raw.entityId) || extractAutoCandidateEntityId(raw.id),
    displayName:
      normalizeString(raw.displayName || raw.name || raw.hostDisplayName) ||
      "Candidate",
    username: normalizeString(raw.username || raw.hostUsername),
    avatarUrl: normalizeUrl(raw.avatarUrl || raw.imageUrl || raw.photoUrl),
    bio: normalizeString(raw.bio || raw.description),
    district: normalizeString(raw.district),
    levelOfOffice: normalizeString(raw.levelOfOffice || raw.level),
    officeTitle: normalizeString(raw.officeTitle || raw.office),
    partyLabel: normalizeString(raw.partyLabel || raw.party),
    chamber: normalizeString(raw.chamber),
    officialUrl: normalizeUrl(raw.officialUrl),
    followersCount:
      Number(raw.followersCount || raw.followerCount || raw.followCount) || 0,
    isFollowing: raw.isFollowing === true,
    tags: normalizeTagList(raw.priorityTags || raw.tags),
    socials,
    autoGenerated: raw.autoGenerated === true,
    autoGeneratedMessage: normalizeString(raw.autoGeneratedMessage),
    hasAccount: raw.hasAccount === true,
    linkedCandidateId: normalizeString(raw.linkedCandidateId),
    electionName: normalizeString(raw.electionName),
    electionDay: normalizeString(raw.electionDay),
    electionStatus: normalizeString(raw.electionStatus),
    donationsEnabled: raw.donationsEnabled === true,
    donationsAvailable: raw.donationsAvailable === true,
    donationDisabledReason: normalizeString(raw.donationDisabledReason),
    canEdit:
      state.auth.user?.userId &&
      state.auth.user.userId ===
        normalizeString(raw.userId || raw.ownerUserId || raw.candidateId),
  };
}

function normalizeOfficialProfile(raw = {}) {
  return {
    officialId: normalizeString(raw.officialId),
    displayName: normalizeString(raw.displayName || raw.name) || "Official",
    partyLabel: normalizeString(raw.partyLabel),
    partyCode: normalizeString(raw.partyCode),
    chamber: normalizeString(raw.chamber),
    officeTitle: normalizeString(raw.officeTitle) || "Official",
    state: normalizeString(raw.state),
    district: normalizeString(raw.district),
    avatarUrl: normalizeUrl(raw.avatarUrl || raw.photoUrl || raw.imageUrl),
    officialUrl: normalizeUrl(raw.officialUrl),
    termStart: normalizeString(raw.termStart),
    termEnd: normalizeString(raw.termEnd),
    followersCount: Number(raw.followersCount) || 0,
    isFollowing: raw.isFollowing === true,
    autoGenerated: raw.autoGenerated === true,
    autoGeneratedMessage: normalizeString(raw.autoGeneratedMessage),
    hasAccount: raw.hasAccount === true,
  };
}

function normalizeAutoCandidateProfile(raw = {}) {
  return {
    entityId: normalizeString(raw.entityId),
    displayName: normalizeString(raw.displayName || raw.name) || "Candidate",
    partyLabel: normalizeString(raw.partyLabel),
    partyToken: normalizeString(raw.partyToken),
    officeTitle: normalizeString(raw.officeTitle) || "Candidate",
    levelOfOffice: normalizeString(raw.levelOfOffice || raw.level),
    state: normalizeString(raw.state),
    district: normalizeString(raw.district),
    avatarUrl: normalizeUrl(raw.avatarUrl || raw.photoUrl || raw.imageUrl),
    autoGenerated: raw.autoGenerated === true,
    autoGeneratedMessage: normalizeString(raw.autoGeneratedMessage),
    hasAccount: raw.hasAccount === true,
    linkedCandidateId: normalizeString(raw.linkedCandidateId),
    electionId: normalizeString(raw.electionId),
    electionName: normalizeString(raw.electionName),
    electionDay: normalizeString(raw.electionDay),
    electionStatus: normalizeString(raw.electionStatus),
    followersCount: Number(raw.followersCount) || 0,
    isFollowing: raw.isFollowing === true,
  };
}

function normalizeOfficialVoteRecord(raw = {}) {
  const bill = raw.bill && typeof raw.bill === "object" ? raw.bill : {};
  const opinion =
    raw.opinion && typeof raw.opinion === "object" ? raw.opinion : {};
  const aggregate =
    opinion.aggregate && typeof opinion.aggregate === "object"
      ? opinion.aggregate
      : null;
  return {
    voteId: normalizeString(raw.voteId),
    chamber: normalizeString(raw.chamber),
    congress: Number.isFinite(Number(raw.congress))
      ? Number(raw.congress)
      : null,
    session: Number.isFinite(Number(raw.session)) ? Number(raw.session) : null,
    voteNumber: Number.isFinite(Number(raw.voteNumber))
      ? Number(raw.voteNumber)
      : null,
    voteQuestion: normalizeString(raw.voteQuestion),
    voteResult: normalizeString(raw.voteResult),
    votePosition: normalizeString(raw.votePosition),
    votedAt: normalizeString(raw.votedAt),
    billId: normalizeString(bill.billId),
    billCongress: Number.isFinite(Number(bill.congress))
      ? Number(bill.congress)
      : null,
    billType: normalizeString(bill.type),
    billNumber: normalizeString(bill.number),
    billTitle: normalizeString(bill.title),
    billSummary: normalizeString(bill.summary),
    billLatestActionText: normalizeString(bill.latestActionText),
    billLatestActionDate: normalizeString(bill.latestActionDate),
    roles: Array.isArray(raw.roles)
      ? raw.roles.map((role) => normalizeString(role)).filter(Boolean)
      : [],
    myOpinion: normalizeString(opinion.myOpinion),
    hasVoted:
      opinion.hasVoted === true || Boolean(normalizeString(opinion.myOpinion)),
    aggregate: aggregate
      ? {
          upCount: Number(aggregate.upCount) || 0,
          downCount: Number(aggregate.downCount) || 0,
          approvalRating: Number.isFinite(Number(aggregate.approvalRating))
            ? Number(aggregate.approvalRating)
            : null,
        }
      : null,
  };
}

function normalizeEvent(raw = {}) {
  const startAt = Number(raw.startAt) || null;
  const endAt = Number(raw.endAt) || null;
  return {
    eventId: normalizeString(raw.eventId || raw.id),
    title: normalizeString(raw.title) || "Event",
    imageUrl: normalizeUrl(raw.imageUrl),
    description: normalizeString(raw.description),
    startAt,
    endAt,
    address: normalizeString(raw.address),
    locationTown: normalizeString(raw.locationTown),
    locationName: normalizeString(raw.locationName),
    hostUserId: normalizeString(raw.hostUserId),
    hostDisplayName: normalizeString(raw.hostDisplayName) || "Host",
    hostUsername: normalizeString(raw.hostUsername),
    attendeeCount: Number(raw.attendeeCount) || 0,
    interestedCount: Number(raw.interestedCount) || 0,
    isAttending: raw.isAttending === true,
    isInterested: raw.isInterested === true,
    isFree: raw.isFree !== false,
    costAmount: Number.isFinite(Number(raw.costAmount))
      ? Number(raw.costAmount)
      : null,
    tags: normalizeTagList(raw.tags),
    lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : null,
    lng: Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : null,
    canEdit:
      state.auth.user?.userId &&
      state.auth.user.userId === normalizeString(raw.hostUserId),
    raw,
  };
}

function normalizeProfile(raw = {}) {
  const links = Array.isArray(raw.links) ? raw.links : [];
  return {
    userId: normalizeString(raw.userId),
    displayName:
      normalizeString(raw.displayName || raw.username || raw.email) ||
      "Polis user",
    username: normalizeString(raw.username),
    avatarUrl: normalizeUrl(raw.avatarUrl),
    bio: normalizeString(raw.bio),
    town: normalizeString(raw.town || raw.city),
    state: normalizeString(raw.state || raw.homeStateId),
    district: normalizeString(raw.district || raw.locationDistrictId),
    followersCount: Number(raw.followersCount) || 0,
    followingCount: Number(raw.followingCount) || 0,
    friendCount: Number(raw.friendCount || raw.friendsCount) || 0,
    totalLikes: Number(raw.totalLikes) || 0,
    isFollowing: raw.isFollowing === true,
    candidateAccessStatus: normalizeString(raw.candidateAccessStatus),
    links,
  };
}

function normalizeNotification(raw = {}) {
  return {
    notificationId:
      normalizeString(raw.notificationId || raw.id || raw.eventId) || "",
    title: normalizeString(raw.title || raw.headline) || "Notification",
    body: normalizeString(raw.body || raw.message || raw.description),
    createdAt: Number(raw.createdAt || raw.timestamp) || null,
    readAt: Number(raw.readAt) || null,
    route: normalizeString(raw.route || raw.path),
    raw,
  };
}

function normalizeMessagingConversation(raw = {}) {
  return {
    conversationId: normalizeString(raw.conversationId || raw.id),
    title:
      normalizeString(raw.title || raw.displayTitle || raw.label) ||
      "Conversation",
    subtitle: normalizeString(
      raw.subtitle || raw.previewText || raw.lastMessagePreview,
    ),
    kind: normalizeString(raw.kind || raw.type || "dm"),
    folder: normalizeString(raw.folder || raw.listType || "inbox"),
    isEncrypted: raw.isEncrypted === true,
    unreadCount: Number(raw.unreadCount) || 0,
    updatedAt: Number(raw.updatedAt || raw.lastMessageAt || raw.createdAt) || 0,
    lastMessagePreview:
      normalizeString(raw.lastMessagePreview || raw.previewText) ||
      (raw.isEncrypted === true ? "Encrypted message" : ""),
    avatarUrl: normalizeUrl(raw.avatarUrl || raw.imageUrl),
    scopeType: normalizeString(raw.scopeType),
    scopeId: normalizeString(raw.scopeId),
    canManage: raw.canManage === true,
    members: Array.isArray(raw.members) ? raw.members : [],
    raw,
  };
}

function normalizeMessagingMessage(raw = {}) {
  return {
    messageId: normalizeString(raw.messageId || raw.id),
    conversationId: normalizeString(raw.conversationId),
    senderUserId: normalizeString(raw.senderUserId || raw.userId),
    senderDisplayName:
      normalizeString(
        raw.senderDisplayName || raw.displayName || raw.username,
      ) || "Polis user",
    text:
      normalizeString(raw.text || raw.body || raw.caption || raw.previewText) ||
      (raw.isEncrypted === true ? "Encrypted message" : ""),
    createdAt: Number(raw.createdAt || raw.timestamp) || null,
    isEncrypted: raw.isEncrypted === true,
    canEdit: raw.canEdit === true,
    raw,
  };
}

function normalizeMessagingRequest(raw = {}) {
  const destination =
    raw.destination && typeof raw.destination === "object"
      ? raw.destination
      : {};
  const conversation =
    raw.conversation && typeof raw.conversation === "object"
      ? raw.conversation
      : {};
  const inviter =
    raw.inviter && typeof raw.inviter === "object" ? raw.inviter : {};
  const title =
    normalizeString(
      raw.serverTitle ||
        conversation.title ||
        raw.title ||
        inviter.displayName ||
        inviter.username,
    ) || "Request";
  return {
    requestId: normalizeString(raw.requestId || raw.id),
    type: normalizeString(raw.type || "conversation_request"),
    title,
    subtitle:
      normalizeString(
        conversation.subtitle ||
          raw.subtitle ||
          raw.previewText ||
          raw.message ||
          raw.description,
      ) ||
      (normalizeString(raw.type) === "server_invite"
        ? "Open this invite in your server workspace."
        : "Review this request."),
    conversationId: normalizeString(
      conversation.conversationId ||
        raw.conversationId ||
        destination.channelId,
    ),
    scopeType: normalizeString(raw.scopeType || destination.scopeType),
    scopeId: normalizeString(raw.scopeId || destination.scopeId),
    channelId: normalizeString(raw.channelId || destination.channelId),
    serverTitle: normalizeString(raw.serverTitle || raw.title),
    inviterName:
      normalizeString(inviter.displayName || inviter.username) || "Polis user",
    createdAt: Number(raw.createdAt || raw.timestamp) || null,
    raw,
  };
}

function normalizeMessagingServer(raw = {}) {
  return {
    serverKey:
      normalizeString(raw.serverKey) ||
      `${normalizeString(raw.scopeType)}:${normalizeString(raw.scopeId)}`,
    scopeType: normalizeString(raw.scopeType).toLowerCase(),
    scopeId: normalizeString(raw.scopeId),
    title: normalizeString(raw.title) || "Server",
    avatarUrl: normalizeUrl(raw.avatarUrl || raw.avatar || raw.imageUrl),
    canManage: raw.canManage === true,
    memberCount: Number(raw.memberCount) || 0,
    scopeBadge: normalizeString(raw.scopeBadge) || "Server",
    capabilities:
      raw.capabilities && typeof raw.capabilities === "object"
        ? raw.capabilities
        : {},
    raw,
  };
}

function normalizeMessagingRole(raw = {}) {
  return {
    roleId: normalizeString(raw.roleId || raw.id),
    scopeType: normalizeString(raw.scopeType).toLowerCase(),
    scopeId: normalizeString(raw.scopeId),
    name: normalizeString(raw.name) || "Role",
    color: normalizeString(raw.color) || "#8f96a3",
    position: Number(raw.position) || 0,
    memberCount: Number(raw.memberCount) || 0,
    isEveryone: raw.isEveryone === true,
    isManaged: raw.isManaged === true,
    mentionable: raw.mentionable === true,
    displaySeparately: raw.displaySeparately === true,
    basePermissions:
      raw.basePermissions && typeof raw.basePermissions === "object"
        ? raw.basePermissions
        : {},
    raw,
  };
}

function normalizeMessagingMember(raw = {}) {
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  return {
    userId: normalizeString(raw.userId || raw.id),
    effectiveName:
      normalizeString(
        raw.effectiveName || raw.displayName || raw.nickname || raw.username,
      ) || "Member",
    displayName: normalizeString(raw.displayName),
    username: normalizeString(raw.username),
    avatarUrl: normalizeUrl(raw.avatarUrl),
    nickname: normalizeString(raw.nickname),
    roles,
    sourceTags: Array.isArray(raw.sourceTags) ? raw.sourceTags : [],
    timeoutUntil: Number(raw.timeoutUntil) || null,
    isTimedOut: raw.isTimedOut === true,
    raw,
  };
}

function normalizeMessagingBan(raw = {}) {
  return {
    userId: normalizeString(raw.userId || raw.id),
    displayName:
      normalizeString(raw.displayName || raw.username || raw.userId) || "User",
    username: normalizeString(raw.username),
    avatarUrl: normalizeUrl(raw.avatarUrl),
    reason: normalizeString(raw.reason),
    bannedAt: Number(raw.bannedAt) || null,
    bannedBy: normalizeString(raw.bannedBy),
    raw,
  };
}

function normalizeMessagingDevice(raw = {}) {
  return {
    deviceId: normalizeString(raw.deviceId || raw.id),
    deviceLabel:
      normalizeString(raw.deviceLabel || raw.platform || raw.name) || "Device",
    platform: normalizeString(raw.platform),
    createdAt: Number(raw.createdAt) || null,
    lastSeenAt: Number(raw.lastSeenAt || raw.updatedAt) || null,
    raw,
  };
}

function normalizeConnectionEntry(raw = {}) {
  return {
    userId: normalizeString(raw.userId || raw.id),
    displayName:
      normalizeString(raw.displayName || raw.username || raw.email) ||
      "Polis user",
    username: normalizeString(raw.username),
    avatarUrl: normalizeUrl(raw.avatarUrl),
    subtitle: normalizeString(raw.subtitle || raw.bio || raw.location),
  };
}

async function loadCandidateList({ refresh = false } = {}) {
  const list = state.pages.candidates.list;
  if (list.loading || list.loadingMore) {
    return;
  }
  const params = readCurrentSearchParams();
  if (refresh) {
    list.items = [];
    list.nextCursor = null;
    list.loaded = false;
  }
  list.filters = Object.fromEntries(params.entries());
  list.loading = true;
  list.error = "";
  scheduleRender();

  try {
    const query = new URLSearchParams({
      limit: "24",
      ...(params.get("q") ? { q: params.get("q") } : {}),
      ...(params.get("level") ? { level: params.get("level") } : {}),
      ...(params.get("district") ? { district: params.get("district") } : {}),
      ...(params.get("tags") ? { tags: params.get("tags") } : {}),
    });
    const payload = await fetchJson(`/api/candidates?${query.toString()}`, {
      auth: true,
    });
    list.items = (payload.items || []).map(normalizeCandidate);
    list.nextCursor =
      normalizeString(payload.cursor || payload.nextCursor) || null;
    list.loaded = true;
  } catch (error) {
    list.error =
      normalizeString(error?.message) || "Candidates could not be loaded.";
  } finally {
    list.loading = false;
    scheduleRender();
  }
}

/**
 * Appends the next candidate page while deduplicating repeated cursor results.
 */
async function loadMoreCandidateList() {
  const list = state.pages.candidates.list;
  if (!list.nextCursor || list.loading || list.loadingMore) {
    return;
  }

  const params = readCurrentSearchParams();
  const previousCursor = list.nextCursor;
  list.filters = Object.fromEntries(params.entries());
  list.loadingMore = true;
  list.error = "";
  scheduleRender();

  try {
    const query = new URLSearchParams({
      limit: "24",
      cursor: previousCursor,
      ...(params.get("q") ? { q: params.get("q") } : {}),
      ...(params.get("level") ? { level: params.get("level") } : {}),
      ...(params.get("district") ? { district: params.get("district") } : {}),
      ...(params.get("tags") ? { tags: params.get("tags") } : {}),
    });
    const payload = await fetchJson(`/api/candidates?${query.toString()}`, {
      auth: true,
    });
    const incoming = (payload.items || []).map(normalizeCandidate);
    const seenKeys = new Set(
      list.items.map(
        (item) =>
          normalizeString(item.candidateId) ||
          normalizeString(item.officialId) ||
          normalizeString(item.entityId) ||
          normalizeString(item.username) ||
          normalizeString(item.displayName),
      ),
    );
    const nextItems = incoming.filter((item) => {
      const candidateKey =
        normalizeString(item.candidateId) ||
        normalizeString(item.officialId) ||
        normalizeString(item.entityId) ||
        normalizeString(item.username) ||
        normalizeString(item.displayName);
      if (!candidateKey || seenKeys.has(candidateKey)) {
        return false;
      }
      seenKeys.add(candidateKey);
      return true;
    });
    const nextCursor =
      normalizeString(payload.cursor || payload.nextCursor) || null;

    list.items = list.items.concat(nextItems);
    list.nextCursor =
      nextCursor === previousCursor && nextItems.length === 0
        ? null
        : nextCursor;
    list.loaded = true;
  } catch (error) {
    list.error =
      normalizeString(error?.message) || "More candidates could not be loaded.";
  } finally {
    list.loadingMore = false;
    scheduleRender();
  }
}

async function loadCandidateDetail(candidateId, { refresh = false } = {}) {
  const detail = state.pages.candidates.detail;
  const normalizedCandidateId = decodeRouteSegment(candidateId);
  if (!normalizedCandidateId) {
    return;
  }
  if (detail.loading) {
    return;
  }
  if (refresh) {
    detail.item = null;
    detail.posts = [];
    detail.relatedEvents = [];
  }
  detail.loading = true;
  detail.error = "";
  scheduleRender();

  try {
    const [candidatePayload, postsPayload, eventsPayload] = await Promise.all([
      fetchJson(
        `/api/candidates/${encodeURIComponent(normalizedCandidateId)}`,
        {
          auth: true,
        },
      ),
      fetchJson(
        `/api/candidates/${encodeURIComponent(normalizedCandidateId)}/posts?limit=12`,
        { auth: true },
      ).catch(() => ({ items: [] })),
      fetchJson(
        `/api/events?hostUserId=${encodeURIComponent(normalizedCandidateId)}&limit=6`,
        { auth: true },
      ).catch(() => ({ items: [] })),
    ]);
    detail.item = normalizeCandidate(
      candidatePayload.candidate || candidatePayload,
    );
    detail.posts = (postsPayload.items || []).map(normalizeFeedItem);
    detail.relatedEvents = (eventsPayload.items || []).map(normalizeEvent);
  } catch (error) {
    detail.error =
      normalizeString(error?.message) || "Candidate page unavailable.";
  } finally {
    detail.loading = false;
    scheduleRender();
  }
}

async function loadOfficialDetail(officialId, { refresh = false } = {}) {
  const detail = state.pages.candidates.officialDetail;
  const normalizedOfficialId = decodeRouteSegment(officialId);
  if (!normalizedOfficialId) {
    return;
  }
  if (detail.loading) {
    return;
  }
  if (
    refresh ||
    normalizeString(detail.item?.officialId) !== normalizedOfficialId
  ) {
    detail.item = null;
  }
  detail.loading = true;
  detail.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/officials/${encodeURIComponent(normalizedOfficialId)}/profile`,
      {
        auth: true,
      },
    );
    detail.item = normalizeOfficialProfile(payload.profile || payload);
  } catch (error) {
    detail.error =
      normalizeString(error?.message) || "Official profile unavailable.";
  } finally {
    detail.loading = false;
    scheduleRender();
  }
}

async function loadAutoCandidateDetail(entityId, { refresh = false } = {}) {
  const detail = state.pages.candidates.autoDetail;
  const normalizedEntityId = decodeRouteSegment(entityId);
  if (!normalizedEntityId) {
    return;
  }
  if (detail.loading) {
    return;
  }
  if (
    refresh ||
    normalizeString(detail.item?.entityId) !== normalizedEntityId
  ) {
    detail.item = null;
  }
  detail.loading = true;
  detail.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/auto-candidates/${encodeURIComponent(normalizedEntityId)}/profile`,
      {
        auth: true,
      },
    );
    detail.item = normalizeAutoCandidateProfile(payload.profile || payload);
  } catch (error) {
    detail.error =
      normalizeString(error?.message) || "Candidate profile unavailable.";
  } finally {
    detail.loading = false;
    scheduleRender();
  }
}

async function loadOfficialReportCard(
  officialId,
  { refresh = false, append = false } = {},
) {
  const detail = state.pages.candidates.reportCard;
  const normalizedOfficialId = decodeRouteSegment(officialId);
  if (!normalizedOfficialId) {
    return;
  }
  if ((append && detail.loadingMore) || (!append && detail.loading)) {
    return;
  }

  const requestedCongress = Number.parseInt(
    normalizeString(readCurrentSearchParams().get("congress")),
    10,
  );
  const congress =
    Number.isFinite(requestedCongress) && requestedCongress > 0
      ? requestedCongress
      : null;
  const isNewContext =
    detail.officialId !== normalizedOfficialId || detail.congress !== congress;

  if (!append || refresh || isNewContext) {
    detail.items = [];
    detail.nextCursor = null;
    detail.error = "";
    detail.loaded = false;
    if (refresh || isNewContext) {
      detail.refreshedAt = null;
      detail.fromCache = false;
      detail.total = null;
    }
  }

  if (append) {
    detail.loadingMore = true;
  } else {
    detail.loading = true;
  }
  detail.officialId = normalizedOfficialId;
  detail.congress = congress;
  scheduleRender();

  try {
    const query = new URLSearchParams({ limit: "20" });
    if (congress) {
      query.set("congress", String(congress));
    }
    if (append && detail.nextCursor) {
      query.set("cursor", detail.nextCursor);
    }
    if (refresh) {
      query.set("refresh", "1");
    }
    const payload = await fetchJson(
      `/api/officials/${encodeURIComponent(normalizedOfficialId)}/report-card?${query.toString()}`,
      {
        auth: true,
      },
    );
    const incoming = (payload.items || []).map(normalizeOfficialVoteRecord);
    const seenVoteIds = new Set(
      append ? detail.items.map((item) => normalizeString(item.voteId)) : [],
    );
    const nextItems = append
      ? incoming.filter((item) => {
          const voteId = normalizeString(item.voteId);
          if (!voteId || seenVoteIds.has(voteId)) {
            return false;
          }
          seenVoteIds.add(voteId);
          return true;
        })
      : incoming;
    detail.items = append ? detail.items.concat(nextItems) : nextItems;
    detail.nextCursor = normalizeString(payload.nextCursor) || null;
    detail.refreshedAt = Number(payload.refreshedAt) || null;
    detail.fromCache = payload.fromCache === true;
    detail.total = Number.isFinite(Number(payload.total))
      ? Number(payload.total)
      : null;
    detail.loaded = true;
    detail.error = "";
  } catch (error) {
    detail.error =
      normalizeString(error?.message) || "Report card unavailable.";
  } finally {
    detail.loading = false;
    detail.loadingMore = false;
    scheduleRender();
  }
}

async function toggleCandidateFollow(candidateId, officialId = "") {
  const normalizedCandidateId = decodeRouteSegment(candidateId);
  const normalizedOfficialId = decodeRouteSegment(officialId);
  if (!normalizedCandidateId && !normalizedOfficialId) {
    return;
  }
  if (!state.auth.session) {
    await requireAuthForRoute(getCurrentRoute());
    return;
  }
  const path = normalizedOfficialId
    ? `/api/officials/${encodeURIComponent(normalizedOfficialId)}/follow`
    : `/api/candidates/${encodeURIComponent(normalizedCandidateId)}/follow`;
  const payload = await fetchJson(path, {
    auth: true,
    method: "POST",
    body: {},
  });
  const nextFollowing =
    payload.following === true || payload.isFollowing === true;
  const nextFollowersCount = Number(payload.followersCount);
  state.pages.candidates.list.items = state.pages.candidates.list.items.map(
    (item) => {
      const itemOfficialId = resolveCandidateOfficialId(item);
      const matches = normalizedOfficialId
        ? itemOfficialId === normalizedOfficialId
        : item.candidateId === normalizedCandidateId;
      return matches
        ? applyResolvedFollowState(item, nextFollowing, nextFollowersCount)
        : item;
    },
  );
  const candidateDetail = state.pages.candidates.detail.item;
  if (
    candidateDetail &&
    (normalizedOfficialId
      ? resolveCandidateOfficialId(candidateDetail) === normalizedOfficialId
      : candidateDetail.candidateId === normalizedCandidateId)
  ) {
    state.pages.candidates.detail.item = applyResolvedFollowState(
      candidateDetail,
      nextFollowing,
      nextFollowersCount,
    );
  }
  const officialDetail = state.pages.candidates.officialDetail.item;
  if (
    officialDetail &&
    normalizedOfficialId &&
    normalizeString(officialDetail.officialId) === normalizedOfficialId
  ) {
    state.pages.candidates.officialDetail.item = applyResolvedFollowState(
      officialDetail,
      nextFollowing,
      nextFollowersCount,
    );
  }
  scheduleRender();
}

async function saveCandidateFromForm(formData) {
  const candidateId = normalizeString(formData.get("candidateId"));
  if (!candidateId) {
    return;
  }
  const detail = state.pages.candidates.detail;
  detail.saving = true;
  detail.error = "";
  scheduleRender();

  try {
    const payload = {
      displayName: normalizeString(formData.get("displayName")),
      levelOfOffice: normalizeString(formData.get("levelOfOffice")),
      district: normalizeString(formData.get("district")),
      bio: normalizeString(formData.get("bio")),
      avatarUrl: normalizeString(formData.get("avatarUrl")),
      priorityTags: normalizeString(formData.get("priorityTags"))
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      socials: {
        website: normalizeString(formData.get("website")),
        x: normalizeString(formData.get("x")),
        instagram: normalizeString(formData.get("instagram")),
        facebook: normalizeString(formData.get("facebook")),
      },
    };
    const response = await fetchJson(
      `/api/candidates/${encodeURIComponent(candidateId)}`,
      {
        auth: true,
        method: "PATCH",
        body: payload,
      },
    );
    detail.item = normalizeCandidate(response.candidate || response);
    navigateTo(`/candidates/${encodeURIComponent(candidateId)}`, {
      replace: true,
    });
  } catch (error) {
    detail.error =
      normalizeString(error?.message) || "Candidate update failed.";
  } finally {
    detail.saving = false;
    scheduleRender();
  }
}

async function loadEventsList({ refresh = false } = {}) {
  const list = state.pages.events.list;
  if (list.loading) {
    return;
  }
  const params = readCurrentSearchParams();
  if (refresh) {
    list.items = [];
    list.nextCursor = null;
    list.loaded = false;
  }
  list.filters = Object.fromEntries(params.entries());
  list.loading = true;
  list.error = "";
  scheduleRender();

  try {
    const query = new URLSearchParams({
      limit: "24",
      ...(params.get("q") ? { q: params.get("q") } : {}),
      ...(params.get("town") ? { town: params.get("town") } : {}),
      ...(params.get("tags") ? { tags: params.get("tags") } : {}),
      ...(params.get("includePast") === "true" ? { includePast: "true" } : {}),
    });
    const payload = await fetchJson(`/api/events?${query.toString()}`, {
      auth: true,
    });
    list.items = (payload.items || []).map(normalizeEvent);
    list.nextCursor =
      normalizeString(payload.cursor || payload.nextCursor) || null;
    list.loaded = true;
  } catch (error) {
    list.error =
      normalizeString(error?.message) || "Events could not be loaded.";
  } finally {
    list.loading = false;
    scheduleRender();
  }
}

async function loadEventDetail(eventId, { refresh = false } = {}) {
  const detail = state.pages.events.detail;
  const normalizedEventId = normalizeString(eventId);
  if (!normalizedEventId) {
    return;
  }
  if (detail.loading) {
    return;
  }
  if (refresh) {
    detail.item = null;
  }
  detail.loading = true;
  detail.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/events/${encodeURIComponent(normalizedEventId)}`,
      {
        auth: true,
      },
    );
    detail.item = normalizeEvent(payload.event || payload);
  } catch (error) {
    detail.error = normalizeString(error?.message) || "Event unavailable.";
  } finally {
    detail.loading = false;
    scheduleRender();
  }
}

async function loadManageEvents({ refresh = false } = {}) {
  const manage = state.pages.events.manage;
  if (manage.loading) {
    return;
  }
  const params = readCurrentSearchParams();
  const status =
    normalizeString(params.get("status")) || manage.status || "active";
  if (refresh) {
    manage.items = [];
    manage.nextCursor = null;
    manage.loaded = false;
  }
  manage.status = status;
  manage.loading = true;
  manage.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/my/events?status=${encodeURIComponent(status)}&limit=30`,
      { auth: true },
    );
    manage.items = (payload.items || []).map(normalizeEvent);
    manage.nextCursor = normalizeString(payload.nextCursor) || null;
    manage.loaded = true;
  } catch (error) {
    manage.error =
      normalizeString(error?.message) || "Your events could not be loaded.";
  } finally {
    manage.loading = false;
    scheduleRender();
  }
}

function buildEventPayloadFromForm(formData) {
  return {
    title: normalizeString(formData.get("title")),
    description: normalizeString(formData.get("description")),
    locationTown: normalizeString(formData.get("locationTown")),
    address: normalizeString(formData.get("address")),
    locationName: normalizeString(formData.get("locationName")),
    imageUrl: normalizeString(formData.get("imageUrl")),
    startAt: new Date(normalizeString(formData.get("startAt"))).getTime(),
    endAt: new Date(normalizeString(formData.get("endAt"))).getTime(),
    tags: normalizeString(formData.get("tags"))
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

async function saveEventFromForm(formData, { mode = "create" } = {}) {
  const detail = state.pages.events.detail;
  detail.saving = true;
  detail.error = "";
  scheduleRender();

  try {
    const payload = buildEventPayloadFromForm(formData);
    const eventId = normalizeString(formData.get("eventId"));
    const response =
      mode === "edit" && eventId
        ? await fetchJson(`/api/events/${encodeURIComponent(eventId)}`, {
            auth: true,
            method: "PATCH",
            body: payload,
          })
        : await fetchJson("/api/events", {
            auth: true,
            method: "POST",
            body: payload,
          });
    const normalized = normalizeEvent(response.event || response);
    detail.item = normalized;
    navigateTo(`/events/${encodeURIComponent(normalized.eventId)}`, {
      replace: true,
    });
  } catch (error) {
    detail.error = normalizeString(error?.message) || "Event save failed.";
  } finally {
    detail.saving = false;
    scheduleRender();
  }
}

async function deleteEventById(eventId) {
  const normalizedEventId = normalizeString(eventId);
  if (!normalizedEventId) {
    return;
  }
  try {
    await fetchJson(`/api/events/${encodeURIComponent(normalizedEventId)}`, {
      auth: true,
      method: "DELETE",
    });
    showToast("Event deleted.");
    navigateTo("/manage-events");
  } catch (error) {
    showToast(normalizeString(error?.message) || "Event delete failed.");
  }
}

async function toggleEventInterested(eventId, currentlyInterested) {
  const normalizedEventId = normalizeString(eventId);
  if (!normalizedEventId) {
    return;
  }
  const response = await fetchJson(
    `/api/events/${encodeURIComponent(normalizedEventId)}/interested`,
    {
      auth: true,
      method: currentlyInterested ? "DELETE" : "PUT",
      body: {},
    },
  );
  const nextInterested = response.isInterested === true;
  const nextCount = Number(response.interestedCount) || 0;
  const applyUpdate = (item) =>
    item.eventId === normalizedEventId
      ? { ...item, isInterested: nextInterested, interestedCount: nextCount }
      : item;
  state.pages.events.list.items =
    state.pages.events.list.items.map(applyUpdate);
  state.pages.events.manage.items =
    state.pages.events.manage.items.map(applyUpdate);
  if (state.pages.events.detail.item?.eventId === normalizedEventId) {
    state.pages.events.detail.item = applyUpdate(
      state.pages.events.detail.item,
    );
  }
  scheduleRender();
}

async function toggleEventAttendance(eventId, currentlyAttending) {
  const normalizedEventId = normalizeString(eventId);
  if (!normalizedEventId) {
    return;
  }
  const response = await fetchJson(
    `/api/events/${encodeURIComponent(normalizedEventId)}/signup`,
    {
      auth: true,
      method: currentlyAttending ? "DELETE" : "POST",
      body: {},
    },
  );
  const nextAttending = response.isAttending === true;
  const nextCount = Number(response.attendeeCount) || 0;
  const applyUpdate = (item) =>
    item.eventId === normalizedEventId
      ? { ...item, isAttending: nextAttending, attendeeCount: nextCount }
      : item;
  state.pages.events.list.items =
    state.pages.events.list.items.map(applyUpdate);
  state.pages.events.manage.items =
    state.pages.events.manage.items.map(applyUpdate);
  if (state.pages.events.detail.item?.eventId === normalizedEventId) {
    state.pages.events.detail.item = applyUpdate(
      state.pages.events.detail.item,
    );
  }
  scheduleRender();
}

async function loadProfilePage(userId = "", { refresh = false } = {}) {
  const profileState = state.pages.profile;
  const normalizedUserId = normalizeString(userId);
  profileState.loading = true;
  profileState.error = "";
  if (refresh) {
    profileState.current = null;
    profileState.posts = createPagedState();
  }
  scheduleRender();

  try {
    const isSelf = !normalizedUserId;
    const [profilePayload, postsPayload] = await Promise.all([
      fetchJson(
        isSelf
          ? "/api/profile/me"
          : `/api/users/${encodeURIComponent(normalizedUserId)}/profile`,
        {
          auth: true,
        },
      ),
      fetchJson(
        isSelf
          ? "/api/users/me/posts?limit=18"
          : `/api/users/${encodeURIComponent(normalizedUserId)}/posts?limit=18`,
        {
          auth: true,
        },
      ).catch(() => ({ items: [] })),
    ]);
    const normalizedProfile = normalizeProfile(
      profilePayload.profile || profilePayload,
    );
    if (isSelf) {
      profileState.me = normalizedProfile;
    }
    profileState.current = normalizedProfile;
    profileState.posts.items = (postsPayload.items || []).map(
      normalizeFeedItem,
    );
    profileState.posts.nextCursor =
      normalizeString(postsPayload.nextCursor || postsPayload.cursor) || null;
    profileState.posts.loaded = true;
  } catch (error) {
    profileState.error =
      normalizeString(error?.message) || "Profile unavailable.";
  } finally {
    profileState.loading = false;
    scheduleRender();
  }
}

async function saveProfileFromForm(formData) {
  const profileState = state.pages.profile;
  profileState.saving = true;
  profileState.error = "";
  scheduleRender();

  try {
    const payload = {
      displayName: normalizeString(formData.get("displayName")),
      username: normalizeString(formData.get("username")),
      bio: normalizeString(formData.get("bio")),
      avatarUrl: normalizeString(formData.get("avatarUrl")),
      town: normalizeString(formData.get("town")),
      state: normalizeString(formData.get("state")),
      district: normalizeString(formData.get("district")),
      links: [
        {
          type: "website",
          url: normalizeString(formData.get("website")),
        },
        {
          type: "x",
          url: normalizeString(formData.get("x")),
        },
        {
          type: "instagram",
          url: normalizeString(formData.get("instagram")),
        },
      ].filter((entry) => normalizeString(entry.url)),
    };
    const response = await fetchJson("/api/profile", {
      auth: true,
      method: "POST",
      body: payload,
    });
    profileState.me = normalizeProfile(response.profile || response);
    profileState.current = profileState.me;
    navigateTo("/profile", { replace: true });
  } catch (error) {
    profileState.error =
      normalizeString(error?.message) || "Profile update failed.";
  } finally {
    profileState.saving = false;
    scheduleRender();
  }
}

async function loadProfileConnections(kind = "followers") {
  const profileState = state.pages.profile;
  const currentProfile = profileState.current || profileState.me;
  const userId = normalizeString(
    currentProfile?.userId || state.auth.user?.userId,
  );
  if (!userId) {
    return;
  }
  profileState.connections.kind = kind;
  profileState.connections.loading = true;
  profileState.connections.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/users/${encodeURIComponent(userId)}/${encodeURIComponent(kind)}?limit=30`,
      { auth: true },
    );
    profileState.connections.items = (payload.items || []).map(
      normalizeConnectionEntry,
    );
    profileState.connections.nextCursor =
      normalizeString(payload.nextCursor || payload.cursor) || null;
    profileState.connections.loaded = true;
  } catch (error) {
    profileState.connections.error =
      normalizeString(error?.message) || "Connections could not be loaded.";
  } finally {
    profileState.connections.loading = false;
    scheduleRender();
  }
}

async function loadProfileNotifications() {
  const notifications = state.pages.profile.notifications;
  notifications.loading = true;
  notifications.error = "";
  scheduleRender();

  try {
    const [itemsPayload, unreadPayload] = await Promise.all([
      fetchJson("/api/me/notifications?limit=30", { auth: true }),
      fetchJson("/api/me/notifications/unread-count", { auth: true }).catch(
        () => ({
          unreadCount: 0,
        }),
      ),
    ]);
    notifications.items = (
      itemsPayload.items ||
      itemsPayload.notifications ||
      []
    ).map(normalizeNotification);
    notifications.unreadCount =
      Number(unreadPayload.unreadCount || unreadPayload.count) || 0;
    notifications.loaded = true;
  } catch (error) {
    notifications.error =
      normalizeString(error?.message) || "Notifications could not be loaded.";
  } finally {
    notifications.loading = false;
    scheduleRender();
  }
}

async function markNotificationsRead() {
  await fetchJson("/api/me/notifications/read", {
    auth: true,
    method: "POST",
    body: {},
  });
  state.pages.profile.notifications.items =
    state.pages.profile.notifications.items.map((item) => ({
      ...item,
      readAt: item.readAt || Date.now(),
    }));
  state.pages.profile.notifications.unreadCount = 0;
  scheduleRender();
}

async function toggleProfileFollow(userId) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return;
  }
  const payload = await fetchJson(
    `/api/users/${encodeURIComponent(normalizedUserId)}/follow`,
    {
      auth: true,
      method: "POST",
      body: {},
    },
  );
  const nextFollowing = payload.following === true;
  if (state.pages.profile.current?.userId === normalizedUserId) {
    state.pages.profile.current = {
      ...state.pages.profile.current,
      isFollowing: nextFollowing,
      followersCount: Math.max(
        0,
        state.pages.profile.current.followersCount + (nextFollowing ? 1 : -1),
      ),
    };
  }
  scheduleRender();
}

function parseMessagingSubroute(route = state.route) {
  const rawPath = normalizeString(route?.routeParams?.messagePath);
  const segments = rawPath.split("/").filter(Boolean);
  if (!segments.length) {
    return { view: "inbox", segments: [] };
  }
  if (segments[0] === "requests") {
    return { view: "requests", segments };
  }
  if (segments[0] === "compose") {
    return { view: "compose", segments };
  }
  if (segments[0] === "settings") {
    return { view: "settings", segments };
  }
  if (segments[0] === "devices") {
    if (segments[1] === "link") {
      return {
        view: "device-link",
        linkId: decodeRouteSegment(segments[2]),
        segments,
      };
    }
    return { view: "devices", segments };
  }
  if (segments[0] === "recovery") {
    if (segments[1] === "restore") {
      return { view: "recovery-restore", segments };
    }
    return { view: "recovery", segments };
  }
  if (segments[0] === "security-activity") {
    return { view: "security", segments };
  }
  if (
    (segments[0] === "servers" || segments[0] === "spaces") &&
    segments.length >= 3
  ) {
    const scopeType = decodeRouteSegment(segments[1]);
    const scopeId = decodeRouteSegment(segments[2]);
    if (segments[0] === "spaces") {
      return {
        view: "server",
        scopeType,
        scopeId,
        alias: true,
        segments,
      };
    }
    if (segments.length === 3) {
      return {
        view: "server",
        scopeType,
        scopeId,
        segments,
      };
    }
    if (segments[3] === "settings") {
      if (segments[4]) {
        return {
          view: "server-settings-section",
          scopeType,
          scopeId,
          sectionId: decodeRouteSegment(segments[4]),
          segments,
        };
      }
      return {
        view: "server-settings",
        scopeType,
        scopeId,
        segments,
      };
    }
    if (segments[3] === "roles") {
      if (segments[4]) {
        return {
          view: "server-role",
          scopeType,
          scopeId,
          roleId: decodeRouteSegment(segments[4]),
          segments,
        };
      }
      return {
        view: "server-roles",
        scopeType,
        scopeId,
        segments,
      };
    }
    if (segments[3] === "members") {
      if (segments[4]) {
        return {
          view: "server-member",
          scopeType,
          scopeId,
          userId: decodeRouteSegment(segments[4]),
          segments,
        };
      }
      return {
        view: "server-members",
        scopeType,
        scopeId,
        segments,
      };
    }
    if (segments[3] === "bans") {
      return {
        view: "server-bans",
        scopeType,
        scopeId,
        segments,
      };
    }
    if (segments[3] === "rooms" && segments[4]) {
      const conversationId = decodeRouteSegment(segments[4]);
      if (segments.length === 5) {
        return {
          view: "server-room",
          scopeType,
          scopeId,
          conversationId,
          segments,
        };
      }
      if (segments[5] === "settings") {
        if (!segments[6]) {
          return {
            view: "room-settings",
            scopeType,
            scopeId,
            conversationId,
            segments,
          };
        }
        if (segments[6] === "notifications") {
          return {
            view: "room-settings-notifications",
            scopeType,
            scopeId,
            conversationId,
            segments,
          };
        }
        if (segments[6] === "permissions") {
          if (segments[7] === "roles" && segments[8]) {
            return {
              view: "room-permission-role",
              scopeType,
              scopeId,
              conversationId,
              roleId: decodeRouteSegment(segments[8]),
              segments,
            };
          }
          return {
            view: "room-permissions",
            scopeType,
            scopeId,
            conversationId,
            segments,
          };
        }
        return {
          view: "room-settings-section",
          scopeType,
          scopeId,
          conversationId,
          sectionId: decodeRouteSegment(segments[6]),
          segments,
        };
      }
    }
    return {
      view: "server",
      scopeType,
      scopeId,
      segments,
    };
  }
  if (segments[0] === "conversations" && segments[1]) {
    return {
      view: "conversation",
      conversationId: decodeRouteSegment(segments[1]),
      segments,
    };
  }
  return { view: "unsupported", segments };
}

function buildMessagingScopeQuery(scopeType, scopeId, extra = {}) {
  const params = new URLSearchParams({
    scopeType: normalizeString(scopeType),
    scopeId: normalizeString(scopeId),
  });
  Object.entries(extra).forEach(([key, value]) => {
    const normalized = normalizeString(value);
    if (normalized) {
      params.set(key, normalized);
    }
  });
  return params.toString();
}

async function ensureMessagingDeviceRegistered() {
  const messaging = state.pages.messaging;
  if (messaging.device.registering) {
    return;
  }
  messaging.device.currentDeviceId =
    (await messagingDevice.currentDeviceId()) || "";
  messaging.device.registering = true;
  messaging.device.error = "";
  scheduleRender();

  try {
    const registrationPayload =
      await messagingDevice.buildRegistrationPayload();
    await fetchJson("/api/messaging/devices/register", {
      auth: true,
      method: "POST",
      body: registrationPayload,
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    messaging.device.registered = true;
  } catch (error) {
    messaging.device.error =
      normalizeString(error?.message) ||
      "Messaging device registration failed.";
  } finally {
    messaging.device.registering = false;
    scheduleRender();
  }
}

async function ensureMessagingInitialized({ force = false } = {}) {
  const messaging = state.pages.messaging;
  if (messaging.loading) {
    return;
  }
  if (messaging.initialized && !force) {
    return;
  }
  messaging.loading = true;
  messaging.error = "";
  scheduleRender();

  try {
    const bootstrap = await fetchJson("/api/messaging/bootstrap", {
      auth: true,
    });
    messaging.bootstrap = bootstrap;
    messaging.settings = bootstrap.settings || null;
    messaging.initialized = true;
    await ensureMessagingDeviceRegistered();
  } catch (error) {
    messaging.error =
      normalizeString(error?.message) || "Messaging could not be initialized.";
  } finally {
    messaging.loading = false;
    scheduleRender();
  }
}

async function connectMessagingSocketForRoute() {
  const subroute = parseMessagingSubroute();
  const wsUrl =
    normalizeString(state.pages.messaging.bootstrap?.wsUrl) ||
    normalizeString(runtimeConfig.messaging?.wsUrl);
  if (!messagingSessionRetained) {
    await messagingSocket.retainSession(wsUrl);
    messagingSessionRetained = true;
  } else {
    await messagingSocket.ensureConnected(wsUrl);
  }
  if (
    (subroute.view === "conversation" || subroute.view === "server-room") &&
    subroute.conversationId
  ) {
    messagingSocket.subscribeConversation(subroute.conversationId);
  } else {
    if (state.pages.messaging.conversation.item?.conversationId) {
      messagingSocket.unsubscribeConversation(
        state.pages.messaging.conversation.item.conversationId,
      );
    }
    messagingSocket.unsubscribeInbox();
    messagingSocket.subscribeInbox();
  }
}

async function loadMessagingInbox({ refresh = false } = {}) {
  const inbox = state.pages.messaging.inbox;
  if (inbox.loading) {
    return;
  }
  if (refresh) {
    inbox.items = [];
    inbox.loaded = false;
  }
  inbox.loading = true;
  inbox.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      "/api/messaging/conversations?folder=inbox",
      {
        auth: true,
      },
    );
    inbox.items = (payload.conversations || []).map(
      normalizeMessagingConversation,
    );
    inbox.loaded = true;
  } catch (error) {
    inbox.error = normalizeString(error?.message) || "Inbox unavailable.";
  } finally {
    inbox.loading = false;
    scheduleRender();
  }
}

async function loadMessagingRequests() {
  const requests = state.pages.messaging.requests;
  if (requests.loading) {
    return;
  }
  requests.loading = true;
  requests.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/messaging/requests", { auth: true });
    requests.items = (payload.requests || []).map(normalizeMessagingRequest);
    requests.loaded = true;
  } catch (error) {
    requests.error = normalizeString(error?.message) || "Requests unavailable.";
  } finally {
    requests.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServers() {
  const servers = state.pages.messaging.servers;
  if (servers.loading) {
    return;
  }
  servers.loading = true;
  servers.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/messaging/servers", { auth: true });
    servers.items = (payload.servers || []).map(normalizeMessagingServer);
    servers.loaded = true;
  } catch (error) {
    servers.error = normalizeString(error?.message) || "Servers unavailable.";
  } finally {
    servers.loading = false;
    scheduleRender();
  }
}

async function loadMessagingConversation(
  conversationId,
  { refresh = false } = {},
) {
  const conversation = state.pages.messaging.conversation;
  const normalizedConversationId = normalizeString(conversationId);
  if (!normalizedConversationId || conversation.loading) {
    return;
  }
  if (refresh) {
    conversation.messages = [];
    conversation.item = null;
    conversation.loaded = false;
  }
  conversation.loading = true;
  conversation.error = "";
  scheduleRender();

  try {
    const [conversationPayload, historyPayload] = await Promise.all([
      fetchJson(
        `/api/messaging/conversations/${encodeURIComponent(normalizedConversationId)}`,
        {
          auth: true,
        },
      ),
      fetchJson(
        `/api/messaging/conversations/${encodeURIComponent(normalizedConversationId)}/history?limit=50`,
        { auth: true },
      ),
    ]);
    conversation.item = normalizeMessagingConversation(
      conversationPayload.conversation || conversationPayload,
    );
    conversation.messages = (historyPayload.messages || []).map(
      normalizeMessagingMessage,
    );
    conversation.nextCursor =
      normalizeString(historyPayload.nextCursor || historyPayload.cursor) ||
      null;
    conversation.loaded = true;
    messagingSocket.subscribeConversation(normalizedConversationId);
  } catch (error) {
    conversation.error =
      normalizeString(error?.message) || "Conversation unavailable.";
  } finally {
    conversation.loading = false;
    scheduleRender();
  }
}

async function loadMessagingSettings() {
  const messaging = state.pages.messaging;
  try {
    const payload = await fetchJson("/api/messaging/settings", { auth: true });
    messaging.settings = payload.settings || payload;
  } catch (error) {
    messaging.error =
      normalizeString(error?.message) || "Messaging settings unavailable.";
  } finally {
    scheduleRender();
  }
}

async function loadMessagingDevices() {
  const devices = state.pages.messaging.devices;
  devices.loading = true;
  devices.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/messaging/devices", {
      auth: true,
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    devices.items = (payload.devices || []).map(normalizeMessagingDevice);
    devices.loaded = true;
  } catch (error) {
    devices.error =
      normalizeString(error?.message) || "Messaging devices unavailable.";
  } finally {
    devices.loading = false;
    scheduleRender();
  }
}

async function loadMessagingRecovery() {
  const recovery = state.pages.messaging.recovery;
  recovery.loading = true;
  recovery.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/messaging/recovery/status", {
      auth: true,
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    recovery.status = payload.recovery || null;
    recovery.bundle = payload.recoveryBundle || null;
    recovery.localCode = (await messagingDevice.revealRecoveryCode()) || "";
    recovery.loaded = true;
  } catch (error) {
    recovery.error = normalizeString(error?.message) || "Recovery unavailable.";
  } finally {
    recovery.loading = false;
    scheduleRender();
  }
}

async function loadMessagingSecurity() {
  const security = state.pages.messaging.security;
  security.loading = true;
  security.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      "/api/messaging/security-activity?limit=25",
      {
        auth: true,
        headers: await messagingDevice.buildDeviceHeaders(),
      },
    );
    security.items = payload.activity || [];
    security.loaded = true;
  } catch (error) {
    security.error =
      normalizeString(error?.message) || "Security activity unavailable.";
  } finally {
    security.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServerDirectory(
  scopeType,
  scopeId,
  { refresh = false } = {},
) {
  const directory = state.pages.messaging.serverDirectory;
  if (directory.loading) {
    return;
  }
  if (refresh) {
    directory.item = null;
    directory.loaded = false;
  }
  directory.loading = true;
  directory.error = "";
  scheduleRender();

  try {
    const query = buildMessagingScopeQuery(scopeType, scopeId);
    const payload = await fetchJson(
      `/api/messaging/server-directory?${query}`,
      {
        auth: true,
      },
    );
    const source =
      payload.directory && typeof payload.directory === "object"
        ? payload.directory
        : payload;
    directory.item = {
      scopeType: normalizeString(scopeType).toLowerCase(),
      scopeId: normalizeString(scopeId),
      categories: Array.isArray(source.categories) ? source.categories : [],
      channels: (source.channels || []).map(normalizeMessagingConversation),
      canManage: source.canManage === true,
      raw: source,
    };
    directory.loaded = true;
  } catch (error) {
    directory.error =
      normalizeString(error?.message) || "Server directory unavailable.";
  } finally {
    directory.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServerSettings(
  scopeType,
  scopeId,
  { refresh = false } = {},
) {
  const serverSettings = state.pages.messaging.serverSettings;
  if (serverSettings.loading) {
    return;
  }
  if (refresh) {
    serverSettings.item = null;
    serverSettings.loaded = false;
  }
  serverSettings.loading = true;
  serverSettings.error = "";
  scheduleRender();

  try {
    const query = buildMessagingScopeQuery(scopeType, scopeId);
    const payload = await fetchJson(`/api/messaging/server-settings?${query}`, {
      auth: true,
    });
    serverSettings.item = {
      server: normalizeMessagingServer(payload.server || {}),
      capabilities:
        payload.capabilities && typeof payload.capabilities === "object"
          ? payload.capabilities
          : {},
      overview:
        payload.overview && typeof payload.overview === "object"
          ? payload.overview
          : {},
      sections:
        payload.sections && typeof payload.sections === "object"
          ? payload.sections
          : {
              settings: payload.settings || [],
              community: payload.community || [],
              userManagement: payload.userManagement || [],
            },
      raw: payload,
    };
    serverSettings.loaded = true;
  } catch (error) {
    serverSettings.error =
      normalizeString(error?.message) || "Server settings unavailable.";
  } finally {
    serverSettings.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServerRoles(
  scopeType,
  scopeId,
  { refresh = false } = {},
) {
  const rolesState = state.pages.messaging.serverRoles;
  if (rolesState.loading) {
    return;
  }
  if (refresh) {
    rolesState.items = [];
    rolesState.selected = null;
    rolesState.members = [];
    rolesState.candidates = [];
    rolesState.loaded = false;
  }
  rolesState.loading = true;
  rolesState.error = "";
  scheduleRender();

  try {
    const query = buildMessagingScopeQuery(scopeType, scopeId);
    const payload = await fetchJson(`/api/messaging/server-roles?${query}`, {
      auth: true,
    });
    rolesState.items = (payload.roles || []).map(normalizeMessagingRole);
    rolesState.loaded = true;
  } catch (error) {
    rolesState.error =
      normalizeString(error?.message) || "Server roles unavailable.";
  } finally {
    rolesState.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServerRoleDetail(
  scopeType,
  scopeId,
  roleId,
  { refresh = false } = {},
) {
  const rolesState = state.pages.messaging.serverRoles;
  const normalizedRoleId = normalizeString(roleId);
  if (!normalizedRoleId) {
    return;
  }
  if (refresh || !rolesState.loaded) {
    await loadMessagingServerRoles(scopeType, scopeId, { refresh });
  }
  rolesState.loading = true;
  rolesState.error = "";
  scheduleRender();

  try {
    const [membersPayload, candidatesPayload] = await Promise.all([
      fetchJson(
        `/api/messaging/server-roles/${encodeURIComponent(normalizedRoleId)}/members`,
        {
          auth: true,
        },
      ),
      fetchJson(
        `/api/messaging/server-role-candidates?${buildMessagingScopeQuery(scopeType, scopeId)}`,
        { auth: true },
      ).catch(() => ({ candidates: [] })),
    ]);
    rolesState.selected =
      rolesState.items.find((item) => item.roleId === normalizedRoleId) || null;
    rolesState.members = Array.isArray(membersPayload.userIds)
      ? membersPayload.userIds.map((entry) => normalizeString(entry))
      : [];
    rolesState.candidates = Array.isArray(candidatesPayload.candidates)
      ? candidatesPayload.candidates
      : [];
  } catch (error) {
    rolesState.error =
      normalizeString(error?.message) || "Role detail unavailable.";
  } finally {
    rolesState.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServerMembers(
  scopeType,
  scopeId,
  { refresh = false } = {},
) {
  const membersState = state.pages.messaging.serverMembers;
  if (membersState.loading) {
    return;
  }
  if (refresh) {
    membersState.items = [];
    membersState.loaded = false;
  }
  membersState.loading = true;
  membersState.error = "";
  scheduleRender();

  try {
    const query = buildMessagingScopeQuery(
      scopeType,
      scopeId,
      Object.fromEntries(readCurrentSearchParams().entries()),
    );
    const payload = await fetchJson(`/api/messaging/server-members?${query}`, {
      auth: true,
    });
    membersState.items = (payload.members || []).map(normalizeMessagingMember);
    membersState.loaded = true;
  } catch (error) {
    membersState.error =
      normalizeString(error?.message) || "Server members unavailable.";
  } finally {
    membersState.loading = false;
    scheduleRender();
  }
}

async function loadMessagingServerMember(
  scopeType,
  scopeId,
  userId,
  { refresh = false } = {},
) {
  const membersState = state.pages.messaging.serverMembers;
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return;
  }
  if (refresh) {
    membersState.detail = null;
  }
  membersState.detailLoading = true;
  membersState.detailError = "";
  scheduleRender();

  try {
    const query = buildMessagingScopeQuery(scopeType, scopeId);
    const payload = await fetchJson(
      `/api/messaging/server-members/${encodeURIComponent(normalizedUserId)}?${query}`,
      { auth: true },
    );
    membersState.detail = {
      member: normalizeMessagingMember(payload.member || {}),
      roles: (payload.roles || []).map(normalizeMessagingRole),
      capabilities:
        payload.capabilities && typeof payload.capabilities === "object"
          ? payload.capabilities
          : {},
      raw: payload,
    };
  } catch (error) {
    membersState.detailError =
      normalizeString(error?.message) || "Server member detail unavailable.";
  } finally {
    membersState.detailLoading = false;
    scheduleRender();
  }
}

async function loadMessagingServerBans(
  scopeType,
  scopeId,
  { refresh = false } = {},
) {
  const bansState = state.pages.messaging.serverBans;
  if (bansState.loading) {
    return;
  }
  if (refresh) {
    bansState.items = [];
    bansState.loaded = false;
  }
  bansState.loading = true;
  bansState.error = "";
  scheduleRender();

  try {
    const query = buildMessagingScopeQuery(scopeType, scopeId);
    const payload = await fetchJson(`/api/messaging/server-bans?${query}`, {
      auth: true,
    });
    bansState.items = (payload.bans || []).map(normalizeMessagingBan);
    bansState.loaded = true;
  } catch (error) {
    bansState.error =
      normalizeString(error?.message) || "Server bans unavailable.";
  } finally {
    bansState.loading = false;
    scheduleRender();
  }
}

async function loadMessagingConversationMembers(
  conversationId,
  { refresh = false } = {},
) {
  const roomMembers = state.pages.messaging.roomMembers;
  const normalizedConversationId = normalizeString(conversationId);
  if (!normalizedConversationId || roomMembers.loading) {
    return;
  }
  if (refresh) {
    roomMembers.items = [];
    roomMembers.loaded = false;
  }
  roomMembers.loading = true;
  roomMembers.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/messaging/conversations/${encodeURIComponent(normalizedConversationId)}/members`,
      { auth: true },
    );
    roomMembers.items = (payload.members || []).map(normalizeMessagingMember);
    roomMembers.loaded = true;
  } catch (error) {
    roomMembers.error =
      normalizeString(error?.message) || "Conversation members unavailable.";
  } finally {
    roomMembers.loading = false;
    scheduleRender();
  }
}

async function loadMessagingPermissionTarget(
  targetType,
  targetId,
  { refresh = false } = {},
) {
  const permissionTarget = state.pages.messaging.permissionTarget;
  const normalizedTargetType = normalizeString(targetType);
  const normalizedTargetId = normalizeString(targetId);
  if (
    !normalizedTargetType ||
    !normalizedTargetId ||
    permissionTarget.loading
  ) {
    return;
  }
  if (refresh) {
    permissionTarget.bundle = null;
    permissionTarget.item = null;
    permissionTarget.loaded = false;
  }
  permissionTarget.loading = true;
  permissionTarget.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/messaging/permission-targets/${encodeURIComponent(normalizedTargetType)}/${encodeURIComponent(normalizedTargetId)}`,
      { auth: true },
    );
    permissionTarget.bundle = payload;
    permissionTarget.item =
      payload.target && typeof payload.target === "object"
        ? payload.target
        : null;
    permissionTarget.loaded = true;
  } catch (error) {
    permissionTarget.error =
      normalizeString(error?.message) || "Permission detail unavailable.";
  } finally {
    permissionTarget.loading = false;
    scheduleRender();
  }
}

async function loadMessagingDeviceLink(linkId) {
  const deviceLink = state.pages.messaging.deviceLink;
  const normalizedLinkId = normalizeString(linkId);
  if (!normalizedLinkId) {
    return;
  }
  deviceLink.pending = true;
  deviceLink.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/messaging/devices/link/status?linkId=${encodeURIComponent(normalizedLinkId)}`,
      {
        auth: true,
        headers: await messagingDevice.buildDeviceHeaders(),
      },
    );
    deviceLink.link = payload.link || payload;
    if (
      normalizeString(deviceLink.link?.status).toLowerCase() === "approved" &&
      deviceLink.link?.transferBundle &&
      typeof deviceLink.link.transferBundle === "object"
    ) {
      const imported = await messagingDevice.importTrustedDeviceTransferPayload(
        deviceLink.link.transferBundle,
      );
      if (imported) {
        await Promise.all([
          loadMessagingDevices().catch(() => {}),
          loadMessagingRecovery().catch(() => {}),
          loadMessagingSecurity().catch(() => {}),
        ]);
      }
    }
  } catch (error) {
    deviceLink.error =
      normalizeString(error?.message) || "Device link status unavailable.";
  } finally {
    deviceLink.pending = false;
    scheduleRender();
  }
}

async function startMessagingDeviceLink() {
  const deviceLink = state.pages.messaging.deviceLink;
  deviceLink.pending = true;
  deviceLink.error = "";
  scheduleRender();

  try {
    const deviceId = await messagingDevice.currentDeviceId();
    if (!deviceId) {
      throw new Error("Missing current messaging device.");
    }
    const payload = await fetchJson("/api/messaging/devices/link/start", {
      auth: true,
      method: "POST",
      body: {
        deviceId,
      },
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    deviceLink.link = {
      linkId: normalizeString(payload.linkId),
      status: "pending",
      targetDeviceId: normalizeString(payload.targetDeviceId),
      linkCode: normalizeString(payload.linkCode),
      createdAt: Date.now(),
      expiresAt: Number(payload.expiresAt) || null,
      transferBundle: {},
    };
    await loadMessagingDevices();
    if (deviceLink.link.linkId) {
      navigateTo(
        `/messages/devices/link/${encodeURIComponent(deviceLink.link.linkId)}`,
      );
    }
  } catch (error) {
    deviceLink.error =
      normalizeString(error?.message) || "Device-link start failed.";
  } finally {
    deviceLink.pending = false;
    scheduleRender();
  }
}

async function lookupMessagingDeviceLink(formData) {
  const deviceLink = state.pages.messaging.deviceLink;
  const linkCode = normalizeString(formData.get("linkCode"));
  if (!linkCode) {
    deviceLink.error = "Enter a link code.";
    scheduleRender();
    return;
  }
  deviceLink.pending = true;
  deviceLink.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/messaging/devices/link/lookup", {
      auth: true,
      method: "POST",
      body: {
        linkCode,
      },
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    deviceLink.link = payload.link || payload;
    deviceLink.lookupCode = linkCode;
  } catch (error) {
    deviceLink.error =
      normalizeString(error?.message) || "Device lookup failed.";
  } finally {
    deviceLink.pending = false;
    scheduleRender();
  }
}

async function approveMessagingDeviceLink() {
  const deviceLink = state.pages.messaging.deviceLink;
  const link = deviceLink.link;
  if (!link?.linkId || !link?.linkCode || !link?.targetDeviceId) {
    deviceLink.error = "Device link data is incomplete.";
    scheduleRender();
    return;
  }
  deviceLink.pending = true;
  deviceLink.error = "";
  scheduleRender();

  try {
    const devicesPayload = await fetchJson("/api/messaging/devices", {
      auth: true,
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    const devices = (devicesPayload.devices || []).map(
      normalizeMessagingDevice,
    );
    const targetDevice = devices.find(
      (entry) => entry.deviceId === normalizeString(link.targetDeviceId),
    );
    if (!targetDevice) {
      throw new Error("Target device not found in trusted-device list.");
    }
    const transferPayload =
      await messagingDevice.buildTrustedDeviceTransferPayload(targetDevice);
    await fetchJson("/api/messaging/devices/link/approve", {
      auth: true,
      method: "POST",
      body: {
        linkId: normalizeString(link.linkId),
        linkCode: normalizeString(link.linkCode),
        transferBundle: transferPayload.envelope,
      },
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    await loadMessagingDeviceLink(link.linkId);
    await loadMessagingDevices();
    await loadMessagingSecurity();
    showToast("Device approved.");
  } catch (error) {
    deviceLink.error =
      normalizeString(error?.message) || "Device approval failed.";
  } finally {
    deviceLink.pending = false;
    scheduleRender();
  }
}

async function revokeMessagingDevice(deviceId) {
  const normalizedDeviceId = normalizeString(deviceId);
  if (!normalizedDeviceId) {
    return;
  }
  await fetchJson("/api/messaging/devices/revoke", {
    auth: true,
    method: "POST",
    body: {
      targetDeviceId: normalizedDeviceId,
    },
    headers: await messagingDevice.buildDeviceHeaders(),
  });
  await loadMessagingDevices();
  await loadMessagingSecurity();
  showToast("Device revoked.");
}

async function acceptMessagingRequest(requestId) {
  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    return;
  }
  const payload = await fetchJson(
    `/api/messaging/requests/${encodeURIComponent(normalizedRequestId)}/accept`,
    {
      auth: true,
      method: "POST",
      body: {},
    },
  );
  await Promise.all([
    loadMessagingRequests(),
    loadMessagingInbox({ refresh: true }),
    loadMessagingServers(),
  ]);
  const conversationId = normalizeString(
    payload.conversation?.conversationId || payload.channelId,
  );
  const scopeType = normalizeString(
    payload.scopeType || payload.destination?.scopeType,
  );
  const scopeId = normalizeString(
    payload.scopeId || payload.destination?.scopeId,
  );
  const channelId = normalizeString(
    payload.channelId || payload.destination?.channelId,
  );
  if (conversationId && scopeType && scopeId) {
    navigateTo(
      `/messages/servers/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/rooms/${encodeURIComponent(conversationId)}`,
    );
    return;
  }
  if (conversationId) {
    navigateTo(`/messages/conversations/${encodeURIComponent(conversationId)}`);
    return;
  }
  if (scopeType && scopeId && channelId) {
    navigateTo(
      `/messages/servers/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/rooms/${encodeURIComponent(channelId)}`,
    );
    return;
  }
  if (scopeType && scopeId) {
    navigateTo(
      `/messages/servers/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}`,
    );
  }
}

async function refuseMessagingRequest(requestId) {
  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    return;
  }
  await fetchJson(
    `/api/messaging/requests/${encodeURIComponent(normalizedRequestId)}/refuse`,
    {
      auth: true,
      method: "POST",
      body: {
        blockUser: false,
      },
    },
  );
  await loadMessagingRequests();
  showToast("Request dismissed.");
}

async function updateMessagingServerNotificationLevel(
  scopeType,
  scopeId,
  level,
) {
  const normalizedLevel = normalizeString(level);
  if (!normalizedLevel) {
    return;
  }
  state.pages.messaging.serverSettings.saving = true;
  scheduleRender();
  try {
    await fetchJson(
      `/api/messaging/server-settings/preferences?${buildMessagingScopeQuery(scopeType, scopeId)}`,
      {
        auth: true,
        method: "PATCH",
        body: {
          notificationLevel: normalizedLevel,
        },
      },
    );
    await loadMessagingServerSettings(scopeType, scopeId, { refresh: true });
    showToast("Server preference updated.");
  } finally {
    state.pages.messaging.serverSettings.saving = false;
    scheduleRender();
  }
}

async function addMessagingConversationMember(formData) {
  const conversationId = normalizeString(formData.get("conversationId"));
  const userId = normalizeString(formData.get("userId"));
  const username = normalizeString(formData.get("username"));
  if (!conversationId || (!userId && !username)) {
    showToast("Add a user id or username.");
    return;
  }
  await fetchJson(
    `/api/messaging/conversations/${encodeURIComponent(conversationId)}/members`,
    {
      auth: true,
      method: "POST",
      body: {
        ...(userId ? { userId } : {}),
        ...(username ? { username } : {}),
      },
    },
  );
  await loadMessagingConversationMembers(conversationId, { refresh: true });
  showToast("Member added.");
}

async function removeMessagingConversationMember(conversationId, userId) {
  const normalizedConversationId = normalizeString(conversationId);
  const normalizedUserId = normalizeString(userId);
  if (!normalizedConversationId || !normalizedUserId) {
    return;
  }
  await fetchJson(
    `/api/messaging/conversations/${encodeURIComponent(normalizedConversationId)}/members/${encodeURIComponent(normalizedUserId)}`,
    {
      auth: true,
      method: "DELETE",
    },
  );
  await loadMessagingConversationMembers(normalizedConversationId, {
    refresh: true,
  });
  showToast("Member removed.");
}

async function removeMessagingServerMember(scopeType, scopeId, userId) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return;
  }
  await fetchJson(
    `/api/messaging/server-members/${encodeURIComponent(normalizedUserId)}?${buildMessagingScopeQuery(scopeType, scopeId)}`,
    {
      auth: true,
      method: "DELETE",
    },
  );
  await Promise.all([
    loadMessagingServerMembers(scopeType, scopeId, { refresh: true }),
    loadMessagingServerBans(scopeType, scopeId, { refresh: true }).catch(
      () => {},
    ),
  ]);
  showToast("Member removed.");
}

async function banMessagingServerMember(
  scopeType,
  scopeId,
  userId,
  reason = "",
) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return;
  }
  await fetchJson(
    `/api/messaging/server-members/${encodeURIComponent(normalizedUserId)}/ban?${buildMessagingScopeQuery(scopeType, scopeId)}`,
    {
      auth: true,
      method: "PUT",
      body: {
        ...(normalizeString(reason) ? { reason: normalizeString(reason) } : {}),
      },
    },
  );
  await Promise.all([
    loadMessagingServerBans(scopeType, scopeId, { refresh: true }),
    loadMessagingServerMembers(scopeType, scopeId, { refresh: true }).catch(
      () => {},
    ),
  ]);
  showToast("Member banned.");
}

async function unbanMessagingServerMember(scopeType, scopeId, userId) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return;
  }
  await fetchJson(
    `/api/messaging/server-members/${encodeURIComponent(normalizedUserId)}/ban?${buildMessagingScopeQuery(scopeType, scopeId)}`,
    {
      auth: true,
      method: "DELETE",
    },
  );
  await loadMessagingServerBans(scopeType, scopeId, { refresh: true });
  showToast("Member unbanned.");
}

async function syncMessagingPermissionTargetFromCategory(conversationId) {
  const normalizedConversationId = normalizeString(conversationId);
  if (!normalizedConversationId) {
    return;
  }
  await fetchJson(
    `/api/messaging/permission-targets/channel/${encodeURIComponent(normalizedConversationId)}/sync-from-category`,
    {
      auth: true,
      method: "POST",
      body: {},
    },
  );
  await loadMessagingPermissionTarget("channel", normalizedConversationId, {
    refresh: true,
  });
  showToast("Channel permissions synced.");
}

async function createMessagingDm(formData) {
  const recipientId = normalizeString(formData.get("recipientId"));
  const username = normalizeString(formData.get("username"));
  if (!recipientId && !username) {
    state.pages.messaging.compose.error = "Enter a user id or username.";
    scheduleRender();
    return;
  }
  state.pages.messaging.compose.pending = true;
  state.pages.messaging.compose.error = "";
  scheduleRender();

  try {
    const payload = await fetchJson("/api/messaging/dm", {
      auth: true,
      method: "POST",
      body: {
        ...(recipientId ? { targetUserId: recipientId } : {}),
        ...(username ? { username } : {}),
      },
    });
    const conversationId = normalizeString(
      payload.conversation?.conversationId || payload.conversationId,
    );
    if (conversationId) {
      navigateTo(
        `/messages/conversations/${encodeURIComponent(conversationId)}`,
      );
    }
  } catch (error) {
    state.pages.messaging.compose.error =
      normalizeString(error?.message) || "Unable to start direct message.";
    scheduleRender();
  } finally {
    state.pages.messaging.compose.pending = false;
    scheduleRender();
  }
}

async function sendMessagingDraft(conversationId, text) {
  const normalizedConversationId = normalizeString(conversationId);
  const normalizedText = normalizeString(text);
  const conversation = state.pages.messaging.conversation.item;
  if (!normalizedConversationId || !normalizedText) {
    return;
  }
  if (conversation?.isEncrypted) {
    showToast("Encrypted browser messaging is not available yet.");
    return;
  }
  state.pages.messaging.conversation.sending = true;
  scheduleRender();

  try {
    const payload = await fetchJson(
      `/api/messaging/conversations/${encodeURIComponent(normalizedConversationId)}/messages`,
      {
        auth: true,
        method: "POST",
        body: {
          type: "text",
          text: normalizedText,
        },
      },
    );
    const message = normalizeMessagingMessage(payload.message || payload);
    state.pages.messaging.conversation.messages = [
      ...state.pages.messaging.conversation.messages,
      message,
    ];
    state.pages.messaging.conversation.draft = "";
  } catch (error) {
    showToast(normalizeString(error?.message) || "Message send failed.");
  } finally {
    state.pages.messaging.conversation.sending = false;
    scheduleRender();
  }
}

async function startMessagingRecovery({ rotate = false } = {}) {
  const recovery = state.pages.messaging.recovery;
  recovery.actionPending = true;
  recovery.error = "";
  scheduleRender();

  try {
    const currentBackupVersion = Number(recovery.status?.backupVersion) || 0;
    const pkg = await messagingDevice.createRecoveryEnrollment({
      backupVersion: currentBackupVersion + 1,
      deviceVersion: recovery.status?.deviceVersion || null,
      trustVersion: recovery.status?.trustVersion || null,
      rotate,
    });
    const endpoint = rotate
      ? "/api/messaging/recovery/rotate"
      : "/api/messaging/recovery/enroll";
    await fetchJson(endpoint, {
      auth: true,
      method: "POST",
      body: pkg.uploadPayload,
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    recovery.localCode = pkg.recoveryCode;
    await loadMessagingRecovery();
    showToast(rotate ? "Recovery rotated." : "Recovery enrolled.");
  } catch (error) {
    recovery.error =
      normalizeString(error?.message) || "Recovery action failed.";
  } finally {
    recovery.actionPending = false;
    scheduleRender();
  }
}

async function verifyMessagingRecovery() {
  const recovery = state.pages.messaging.recovery;
  recovery.actionPending = true;
  recovery.error = "";
  scheduleRender();

  try {
    const restoreProof = await messagingDevice.currentRecoveryRestoreProof();
    await fetchJson("/api/messaging/recovery/verify", {
      auth: true,
      method: "POST",
      body: {
        backupVersion: recovery.status?.backupVersion,
        restoreProof,
      },
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    await messagingDevice.markRecoveryVerified();
    await loadMessagingRecovery();
    showToast("Recovery verified.");
  } catch (error) {
    recovery.error =
      normalizeString(error?.message) || "Recovery verification failed.";
  } finally {
    recovery.actionPending = false;
    scheduleRender();
  }
}

async function restoreMessagingRecovery(formData) {
  const recovery = state.pages.messaging.recovery;
  const recoveryCode = normalizeString(formData.get("recoveryCode"));
  if (!recovery.bundle) {
    recovery.error = "Recovery bundle unavailable.";
    scheduleRender();
    return;
  }
  recovery.actionPending = true;
  recovery.error = "";
  scheduleRender();

  try {
    const restoreProof = await messagingDevice.restoreFromRecoveryBundle({
      recoveryCode,
      recoveryBundle: recovery.bundle,
    });
    await fetchJson("/api/messaging/recovery/restore", {
      auth: true,
      method: "POST",
      body: {
        backupVersion: recovery.bundle.backupVersion,
        restoreProof,
      },
      headers: await messagingDevice.buildDeviceHeaders(),
    });
    await loadMessagingRecovery();
    showToast("Recovery restored.");
  } catch (error) {
    recovery.error =
      normalizeString(error?.message) || "Recovery restore failed.";
  } finally {
    recovery.actionPending = false;
    scheduleRender();
  }
}

function handleMessagingSocketEvent(event) {
  const type = normalizeString(event?.type).toUpperCase();
  if (!type) {
    return;
  }
  if (type === "MESSAGE_NEW") {
    const message = normalizeMessagingMessage(
      event.payload?.message || event.payload,
    );
    if (
      message.conversationId &&
      message.conversationId ===
        state.pages.messaging.conversation.item?.conversationId
    ) {
      state.pages.messaging.conversation.messages = [
        ...state.pages.messaging.conversation.messages,
        message,
      ];
    }
    loadMessagingInbox({ refresh: true }).catch(() => {});
    scheduleRender();
    return;
  }
  if (type === "TYPING_EVENT") {
    const payload = event.payload || {};
    const conversationId = normalizeString(payload.conversationId);
    if (
      conversationId !== state.pages.messaging.conversation.item?.conversationId
    ) {
      return;
    }
    const userId = normalizeString(payload.userId);
    const label = normalizeString(
      payload.displayName || payload.username || userId,
    );
    const isTyping = payload.isTyping !== false;
    const existing =
      state.pages.messaging.conversation.typingParticipants.filter(
        (entry) => entry.userId !== userId,
      );
    state.pages.messaging.conversation.typingParticipants = isTyping
      ? existing.concat({ userId, label })
      : existing;
    scheduleRender();
    return;
  }
  if (
    type === "MESSAGE_EDITED" ||
    type === "MESSAGE_UPDATED" ||
    type === "MESSAGE_DELETED" ||
    type === "MESSAGE_REACTION_DIFF"
  ) {
    const conversationId = normalizeString(
      event.payload?.conversationId || event.payload?.message?.conversationId,
    );
    if (
      conversationId &&
      conversationId === state.pages.messaging.conversation.item?.conversationId
    ) {
      loadMessagingConversation(conversationId, { refresh: true }).catch(
        () => {},
      );
    }
    loadMessagingInbox({ refresh: true }).catch(() => {});
  }
}

async function requireAuthForRoute(route = state.route) {
  if (!isProtectedRoute(route)) {
    return true;
  }
  if (state.auth.session) {
    return true;
  }
  const capabilities = getSharedFeedAuthCapabilities(state.auth.config);
  if (!capabilities.direct && !capabilities.hosted) {
    state.renderError = "Web sign-in is not configured for this environment.";
    scheduleRender();
    return false;
  }
  promptForProtectedRoute(`${route.routePath}${window.location.search}`);
  return false;
}

async function loadCurrentRoute({ refresh = false } = {}) {
  const route = getCurrentRoute();
  state.renderError = "";
  if (!(await requireAuthForRoute(route))) {
    return;
  }

  if (getRouteSection(route) !== "messages") {
    if (state.pages.messaging.conversation.item?.conversationId) {
      messagingSocket.unsubscribeConversation(
        state.pages.messaging.conversation.item.conversationId,
      );
    }
    messagingSocket.releaseSession();
    messagingSessionRetained = false;
  }

  if (isFeedRoute(route)) {
    if (isShareRoute(route)) {
      state.mode = FEED_MODE_FOR_YOU;
    }
    state.feedContext = isShareRoute(route)
      ? {
          kind: "share",
          anchorPostId:
            normalizeString(route.routeParams.postId) ||
            normalizeString(runtimeConfig.shareContext?.postId),
        }
      : {
          kind: "app",
          anchorPostId: "",
        };
    if (
      normalizeString(route.routeKey) === ROUTE_KEY_FEED &&
      state.mode === FEED_MODE_FOLLOWING
    ) {
      await loadFollowingFeed({ refresh });
      return;
    }
    await loadInitialFeed({ refresh });
    return;
  }

  const routeKey = normalizeString(route.routeKey);
  if (routeKey === ROUTE_KEY_CANDIDATES) {
    await loadCandidateList({ refresh });
    return;
  }
  if (routeKey === ROUTE_KEY_OFFICIAL_DETAIL) {
    await loadOfficialDetail(route.routeParams.officialId, { refresh });
    return;
  }
  if (routeKey === ROUTE_KEY_AUTO_CANDIDATE_DETAIL) {
    await loadAutoCandidateDetail(route.routeParams.entityId, { refresh });
    return;
  }
  if (routeKey === ROUTE_KEY_OFFICIAL_REPORT_CARD) {
    await Promise.all([
      loadOfficialDetail(route.routeParams.officialId, { refresh }),
      loadOfficialReportCard(route.routeParams.officialId, { refresh }),
    ]);
    return;
  }
  if (
    routeKey === ROUTE_KEY_CANDIDATE_DETAIL ||
    routeKey === ROUTE_KEY_CANDIDATE_EDIT
  ) {
    const legacyOfficialId = extractOfficialIdFromCandidateRouteId(
      route.routeParams.candidateId,
    );
    if (legacyOfficialId) {
      navigateTo(buildOfficialProfileRoute(legacyOfficialId), {
        replace: true,
      });
      return;
    }
    const legacyEntityId = extractAutoCandidateEntityId(
      route.routeParams.candidateId,
    );
    if (legacyEntityId) {
      navigateTo(buildAutoCandidateRoute(legacyEntityId), { replace: true });
      return;
    }
    await loadCandidateDetail(route.routeParams.candidateId, { refresh });
    return;
  }
  if (routeKey === ROUTE_KEY_EVENTS) {
    await loadEventsList({ refresh });
    return;
  }
  if (
    routeKey === ROUTE_KEY_EVENT_DETAIL ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS_NEW ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS_EDIT
  ) {
    if (route.routeParams.eventId) {
      await loadEventDetail(route.routeParams.eventId, { refresh });
    }
    return;
  }
  if (routeKey === ROUTE_KEY_MANAGE_EVENTS) {
    await loadManageEvents({ refresh });
    return;
  }
  if (
    routeKey === ROUTE_KEY_PROFILE_SELF ||
    routeKey === ROUTE_KEY_PROFILE_EDIT
  ) {
    await loadProfilePage("", { refresh });
    if (routeKey === ROUTE_KEY_PROFILE_EDIT) {
      return;
    }
    return;
  }
  if (routeKey === ROUTE_KEY_PROFILE_USER) {
    await loadProfilePage(route.routeParams.userId, { refresh });
    return;
  }
  if (routeKey === ROUTE_KEY_PROFILE_CONNECTIONS) {
    await loadProfilePage("", { refresh });
    await loadProfileConnections(
      normalizeString(readCurrentSearchParams().get("kind")) || "followers",
    );
    return;
  }
  if (routeKey === ROUTE_KEY_PROFILE_NOTIFICATIONS) {
    await loadProfilePage("", { refresh });
    await loadProfileNotifications();
    return;
  }
  if (
    routeKey === ROUTE_KEY_MESSAGES_ROOT ||
    routeKey === ROUTE_KEY_MESSAGES_WILDCARD
  ) {
    const subroute = parseMessagingSubroute(route);
    if (subroute.alias) {
      navigateTo(
        buildMessagingServerRoute(subroute.scopeType, subroute.scopeId),
        {
          replace: true,
        },
      );
      return;
    }
    await ensureMessagingInitialized({ force: refresh });
    await connectMessagingSocketForRoute();
    if (subroute.view === "inbox") {
      await Promise.all([
        loadMessagingInbox({ refresh }),
        loadMessagingServers(),
      ]);
      return;
    }
    if (subroute.view === "requests") {
      await loadMessagingRequests();
      return;
    }
    if (subroute.view === "compose") {
      await loadMessagingServers();
      return;
    }
    if (subroute.view === "settings") {
      await Promise.all([loadMessagingSettings(), loadMessagingServers()]);
      return;
    }
    if (subroute.view === "devices") {
      await loadMessagingDevices();
      return;
    }
    if (subroute.view === "device-link") {
      await Promise.all([loadMessagingDevices(), loadMessagingSecurity()]);
      if (subroute.linkId) {
        await loadMessagingDeviceLink(subroute.linkId);
      }
      return;
    }
    if (subroute.view === "recovery") {
      await loadMessagingRecovery();
      return;
    }
    if (subroute.view === "recovery-restore") {
      await loadMessagingRecovery();
      return;
    }
    if (subroute.view === "security") {
      await loadMessagingSecurity();
      return;
    }
    if (subroute.view === "server") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerDirectory(subroute.scopeType, subroute.scopeId, {
          refresh,
        }),
      ]);
      return;
    }
    if (
      subroute.view === "server-settings" ||
      subroute.view === "server-settings-section"
    ) {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerSettings(subroute.scopeType, subroute.scopeId, {
          refresh,
        }),
      ]);
      return;
    }
    if (subroute.view === "server-roles") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerRoles(subroute.scopeType, subroute.scopeId, {
          refresh,
        }),
      ]);
      return;
    }
    if (subroute.view === "server-role") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerRoleDetail(
          subroute.scopeType,
          subroute.scopeId,
          subroute.roleId,
          { refresh },
        ),
      ]);
      return;
    }
    if (subroute.view === "server-members") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerMembers(subroute.scopeType, subroute.scopeId, {
          refresh,
        }),
      ]);
      return;
    }
    if (subroute.view === "server-member") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerMembers(subroute.scopeType, subroute.scopeId, {
          refresh,
        }).catch(() => {}),
        loadMessagingServerMember(
          subroute.scopeType,
          subroute.scopeId,
          subroute.userId,
          { refresh },
        ),
      ]);
      return;
    }
    if (subroute.view === "server-bans") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerBans(subroute.scopeType, subroute.scopeId, {
          refresh,
        }),
      ]);
      return;
    }
    if (subroute.view === "conversation") {
      await Promise.all([
        loadMessagingInbox({ refresh }),
        loadMessagingConversation(subroute.conversationId, { refresh }),
      ]);
      return;
    }
    if (subroute.view === "server-room") {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerDirectory(subroute.scopeType, subroute.scopeId, {
          refresh,
        }).catch(() => {}),
        loadMessagingConversation(subroute.conversationId, { refresh }),
      ]);
      return;
    }
    if (
      subroute.view === "room-settings" ||
      subroute.view === "room-settings-notifications" ||
      subroute.view === "room-settings-section"
    ) {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerDirectory(subroute.scopeType, subroute.scopeId, {
          refresh,
        }).catch(() => {}),
        loadMessagingConversation(subroute.conversationId, { refresh }),
        loadMessagingConversationMembers(subroute.conversationId, { refresh }),
      ]);
      return;
    }
    if (
      subroute.view === "room-permissions" ||
      subroute.view === "room-permission-role"
    ) {
      await Promise.all([
        loadMessagingServers(),
        loadMessagingServerDirectory(subroute.scopeType, subroute.scopeId, {
          refresh,
        }).catch(() => {}),
        loadMessagingConversation(subroute.conversationId, { refresh }).catch(
          () => {},
        ),
        loadMessagingPermissionTarget("channel", subroute.conversationId, {
          refresh,
        }),
      ]);
      if (subroute.roleId) {
        await loadMessagingServerRoles(subroute.scopeType, subroute.scopeId, {
          refresh,
        }).catch(() => {});
      }
      return;
    }
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
  const activeSection = getRouteSection();
  return [
    {
      label: "Feed",
      key: "feed",
      icon: "feed",
      path: "/feed",
      active: activeSection === "feed",
    },
    {
      label: "Candidates",
      key: "candidates",
      icon: "candidate",
      path: "/candidates",
      active: activeSection === "candidates",
    },
    {
      label: "Events",
      key: "events",
      icon: "calendar",
      path: "/events",
      active: activeSection === "events",
    },
    {
      label: "Profile",
      key: "profile",
      icon: "profile",
      path: "/profile",
      active: activeSection === "profile",
    },
    {
      label: "Messages",
      key: "messages",
      icon: "messages",
      path: "/messages",
      active: activeSection === "messages",
    },
  ];
}

function getTopActions() {
  return [
    { key: "search", label: "Search", icon: "search" },
    {
      key: "notifications",
      label: "Notifications",
      icon: "bell",
      path: "/profile/notifications",
    },
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
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v2.764c0 .69-.223 1.36-.636 1.912L4 15h16l-2.364-3.324A3.3 3.3 0 0 1 17 9.764V7a5 5 0 0 0-5-5Zm0 20a3 3 0 0 1-2.816-2h5.632A3 3 0 0 1 12 22Z"></path></svg>',
    heart:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35 10.55 20C5.4 15.24 2 12.09 2 8.24A4.74 4.74 0 0 1 6.76 3.5c2 0 3.92.93 5.24 2.39A7.06 7.06 0 0 1 17.24 3.5 4.74 4.74 0 0 1 22 8.24c0 3.85-3.4 7-8.55 11.77L12 21.35Z"></path></svg>',
    heartOutline:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 3A5.5 5.5 0 0 1 22 8.5c0 3.34-2.72 5.95-6.84 9.72L12 21l-3.16-2.78C4.72 14.45 2 11.84 2 8.5A5.5 5.5 0 0 1 7.5 3c1.74 0 3.41.81 4.5 2.09A6.1 6.1 0 0 1 16.5 3Zm0 2c-1.54 0-3.04.99-3.57 2.36h-1.86C11.54 5.99 10.04 5 8.5 5A3.5 3.5 0 0 0 5 8.5c0 2.45 2.23 4.6 5.66 7.74L12 17.46l1.34-1.22C16.77 13.1 19 10.95 19 8.5A3.5 3.5 0 0 0 15.5 5Z"></path></svg>',
    comment:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5Zm2 2v8.172L7.172 14H18V7H6Z"></path></svg>',
    share:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 8-1.41 1.41L14 6.83V16h-2V6.83L9.41 9.41 8 8l4-4 4 4ZM6 18h12v2H6z"></path></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v16l-8-4-8 4V5a2 2 0 0 1 2-2Zm0 2v12.764l6-3 6 3V5H6Z"></path></svg>',
    saveFilled:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v16l-8-4-8 4V5a2 2 0 0 1 2-2Z"></path></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>',
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
      const activeClass = item.active ? " is-active" : "";
      return `<button class="shared-feed-rail__nav${activeClass}" data-action="navigate" data-route="${escapeHtml(item.path)}" data-nav-key="${escapeHtml(item.key)}">
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
        <div class="shared-feed-rail__brand-copy">${
          isShareRoute()
            ? "Shared post view"
            : state.auth.session
              ? "Authenticated web app"
              : "Web app sign-in"
        }</div>
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
        `<button class="shared-feed-topbar__icon" data-action="top-action" data-top-key="${escapeHtml(item.key)}" data-route="${escapeHtml(item.path || "")}" aria-label="${escapeHtml(item.label)}">
          ${renderIcon(item.icon)}
        </button>`,
    )
    .join("");

  return `<header class="shared-feed-topbar">
    <div class="shared-feed-topbar__spacer">${
      !isFeedRoute()
        ? `<div class="shared-feed-topbar__title">${escapeHtml(
            getRouteSection() === "messages"
              ? "Messages"
              : getRouteSection() === "profile"
                ? "Profile"
                : getRouteSection() === "events"
                  ? "Events"
                  : getRouteSection() === "candidates"
                    ? "Candidates"
                    : "Polis",
          )}</div>`
        : ""
    }</div>
    <div class="shared-feed-topbar__toggle">${
      isFeedRoute()
        ? `
          <button class="shared-feed-topbar__mode${state.mode === FEED_MODE_FOLLOWING ? " is-active" : ""}" data-action="toggle-mode" data-mode="${FEED_MODE_FOLLOWING}">Following</button>
          <button class="shared-feed-topbar__mode${state.mode === FEED_MODE_FOR_YOU ? " is-active" : ""}" data-action="toggle-mode" data-mode="${FEED_MODE_FOR_YOU}">For You</button>
        `
        : `<span class="shared-feed-topbar__mode is-active">Web</span>`
    }</div>
    <div class="shared-feed-topbar__actions">${actions}</div>
  </header>`;
}

function renderPostItem(item, index) {
  const active = index === state.activeIndex;
  const hasExpandableCopy = hasExpandablePostCopy(item);
  const isExpanded =
    normalizeString(state.ui.expandedPostId) === normalizeString(item.postId);
  const avatarInitial = escapeHtml(
    item.authorDisplayName.slice(0, 1).toUpperCase() || "P",
  );
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
  const previewCopy =
    item.caption ||
    item.tags.map((tag) => `#${normalizeString(tag)}`).join(" ");
  const captionText = isExpanded ? item.caption : previewCopy;
  const captionLine = captionText
    ? `<p class="shared-feed-post__caption">${escapeHtml(captionText)}</p>`
    : "";
  const authorMeta = [
    item.authorUsername
      ? `<span class="shared-feed-post__handle">@${escapeHtml(item.authorUsername)}</span>`
      : "",
    item.createdAt
      ? `<span class="shared-feed-post__time">${escapeHtml(formatRelativeTime(item.createdAt))}</span>`
      : "",
  ]
    .filter(Boolean)
    .join('<span class="shared-feed-post__meta-separator">•</span>');
  const tagMarkup =
    isExpanded && item.tags.length
      ? `<div class="shared-feed-post__tags">${item.tags
          .map(
            (tag) =>
              `<span class="shared-feed-post__tag">#${escapeHtml(tag)}</span>`,
          )
          .join("")}</div>`
      : "";
  const copyMarkup = hasExpandableCopy
    ? `<button class="shared-feed-post__copy-toggle${isExpanded ? " is-expanded" : ""}" data-action="toggle-description" data-post-id="${escapeHtml(item.postId)}" aria-expanded="${isExpanded ? "true" : "false"}">
        ${captionLine}
        ${tagMarkup}
        <span class="shared-feed-post__copy-hint">${isExpanded ? "Show less" : "Show more"}</span>
      </button>`
    : captionLine;
  const duration =
    isVideoItem(item) && item.durationMs
      ? `<div class="shared-feed-post__duration">${escapeHtml(formatDuration(item.durationMs))}</div>`
      : "";

  return `<article class="shared-feed-item shared-feed-item--post${active ? " is-active" : ""}" data-index="${index}" data-post-id="${escapeHtml(item.postId)}">
    <div class="shared-feed-post">
      <div class="shared-feed-post__frame" data-action="toggle-play" data-post-id="${escapeHtml(item.postId)}">
        ${mediaMarkup}
        <div class="shared-feed-post__overlay shared-feed-post__overlay--gradient${isExpanded ? " is-expanded" : ""}"></div>
        <div class="shared-feed-post__overlay shared-feed-post__overlay--chrome">
          ${duration}
          <div class="shared-feed-post__content">
            <div class="shared-feed-post__copy" data-playback-control="1">
              <div class="shared-feed-post__author-block">
                <button class="shared-feed-post__author" data-action="profile" data-user-id="${escapeHtml(item.authorUserId)}">${escapeHtml(item.authorDisplayName)}</button>
                ${
                  authorMeta
                    ? `<div class="shared-feed-post__author-meta">${authorMeta}</div>`
                    : ""
                }
              </div>
              ${copyMarkup}
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
            <button class="shared-feed-post__volume" data-action="toggle-volume" aria-label="${state.userHasInteracted ? "Toggle sound" : "Enable sound"}">
              ${renderIcon(state.userHasInteracted ? "soundOn" : "soundOff")}
            </button>
          </div>
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
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/events/${escapeHtml(item.eventId)}">Open event</button>
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

function formatAbsoluteDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTimeInputValue(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function renderMediaThumbnailGrid(
  items = [],
  {
    emptyMessage = "Nothing here yet.",
    gridClassName = "",
    getRoute,
    getMediaUrl,
    getAltText,
    getOverlayText,
    getPlaceholderLabel,
    overlayBare = false,
    isOverlayBare,
  } = {},
) {
  if (!items.length) {
    return `<div class="shared-page__empty">${escapeHtml(emptyMessage)}</div>`;
  }

  const normalizedGridClassName = normalizeString(gridClassName);

  return `<div class="shared-media-grid${normalizedGridClassName ? ` ${escapeHtml(normalizedGridClassName)}` : ""}">${items
    .map((item) => {
      const route = normalizeString(getRoute?.(item));
      const mediaUrl = normalizeUrl(getMediaUrl?.(item));
      const overlayText = normalizeString(getOverlayText?.(item));
      const altText = normalizeString(getAltText?.(item)) || "Media item";
      const overlayIsBare =
        typeof isOverlayBare === "function" ? isOverlayBare(item) : overlayBare;
      const placeholderLabel =
        normalizeString(getPlaceholderLabel?.(item))
          .slice(0, 1)
          .toUpperCase() ||
        altText.slice(0, 1).toUpperCase() ||
        "M";

      return `<button class="shared-media-tile" type="button" data-action="navigate" data-route="${escapeHtml(route)}" aria-label="${escapeHtml(altText)}">
        ${
          mediaUrl
            ? `<img class="shared-media-tile__image" src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(altText)}" loading="lazy" />`
            : `<div class="shared-media-tile__placeholder" aria-hidden="true">${escapeHtml(placeholderLabel)}</div>`
        }
        ${
          overlayText
            ? `<span class="shared-media-tile__overlay${overlayIsBare ? " shared-media-tile__overlay--bare" : ""}">${escapeHtml(overlayText)}</span>`
            : ""
        }
      </button>`;
    })
    .join("")}</div>`;
}

function getFeedGridItems(items = []) {
  return items.filter(
    (item) => item?.kind === "post" || item?.kind === "event",
  );
}

function getFeedPromptItems(items = []) {
  return items.filter((item) => item?.kind === "prompt");
}

function renderFeedPromptCards(items = []) {
  if (!items.length) {
    return "";
  }

  return `<div>
    <h2>More from Polis</h2>
    <div class="shared-card-grid shared-card-grid--detail">
      ${items
        .map(
          (item) => `<article class="shared-card">
            <div class="shared-card__body">
              <p class="shared-page__eyebrow">Prompt</p>
              <h3>${escapeHtml(item.title || "Continue in Polis")}</h3>
              <p class="shared-card__summary">${escapeHtml(item.description || "Open the app to continue this feed step.")}</p>
              <div class="shared-card__actions">
                <button class="shared-feed-chip shared-feed-chip--primary" data-action="open-app-shell">Open app</button>
              </div>
            </div>
          </article>`,
        )
        .join("")}
    </div>
  </div>`;
}

function renderFeedOverviewPage() {
  const feed = getCurrentFeedState();
  const items = getCurrentItems();
  const mediaItems = getFeedGridItems(items);
  const promptItems = getFeedPromptItems(items);
  const modeLabel =
    state.mode === FEED_MODE_FOLLOWING ? "Following" : "For You";

  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Feed</p>
          <h1>${escapeHtml(modeLabel)}</h1>
          <p>Browse the latest Polis posts and events in a compact web grid.</p>
        </div>
        <div class="shared-card__actions">
          ${
            feed.nextCursor
              ? `<button class="shared-feed-chip" data-action="load-more-feed-grid"${feed.loadingMore ? " disabled" : ""}>${feed.loadingMore ? "Loading…" : "Load more"}</button>`
              : ""
          }
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="refresh-feed-grid"${feed.loading ? " disabled" : ""}>${feed.loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>
      ${
        feed.loading && !items.length
          ? '<div class="shared-page__loading">Loading feed…</div>'
          : ""
      }
      ${feed.error ? `<div class="shared-page__error">${escapeHtml(feed.error)}</div>` : ""}
      ${renderMediaThumbnailGrid(mediaItems, {
        emptyMessage: "No feed items yet.",
        gridClassName: "shared-media-grid--five-wide",
        getRoute: (item) => {
          if (item.kind === "event" && item.eventId) {
            return `/events/${encodeURIComponent(item.eventId)}`;
          }
          return item.postId ? `/posts/${encodeURIComponent(item.postId)}` : "";
        },
        getMediaUrl: (item) =>
          item.kind === "event"
            ? item.imageUrl
            : item.posterUrl || item.imageUrl,
        getAltText: (item) =>
          item.kind === "event"
            ? item.title || "Event"
            : item.previewTitle ||
              item.caption ||
              item.authorDisplayName ||
              "Post",
        getOverlayText: (item) => {
          if (item.kind === "event") {
            if (Number(item.attendeeCount) > 0) {
              return `${formatCount(item.attendeeCount)} going`;
            }
            return item.startAt
              ? formatAbsoluteDateTime(item.startAt)
              : item.hostDisplayName || "Event";
          }
          return `${formatCount(item.likesCount)} like${Number(item.likesCount) === 1 ? "" : "s"}`;
        },
        getPlaceholderLabel: (item) => (item.kind === "event" ? "E" : "P"),
        isOverlayBare: (item) => item.kind === "post",
      })}
      ${
        feed.loadingMore
          ? '<div class="shared-page__hint">Loading more feed items…</div>'
          : ""
      }
      ${renderFeedPromptCards(promptItems)}
    </div>
  </section>`;
}

function renderCandidateListPage() {
  const list = state.pages.candidates.list;
  const currentPath = getCurrentPathWithQuery();
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Candidates</p>
          <h1>Candidate pages</h1>
          <p>Browse candidates, follow campaigns, and open full candidate detail pages from the browser.</p>
        </div>
      </div>
      <form class="shared-form shared-form--inline" data-route-form="candidates-filter">
        <input type="search" name="q" placeholder="Search candidates" value="${escapeHtml(list.filters.q || "")}" />
        <input type="text" name="level" placeholder="Level" value="${escapeHtml(list.filters.level || "")}" />
        <input type="text" name="district" placeholder="District" value="${escapeHtml(list.filters.district || "")}" />
        <input type="text" name="tags" placeholder="Tags" value="${escapeHtml(list.filters.tags || "")}" />
        <button type="submit" class="shared-feed-chip shared-feed-chip--primary">Apply</button>
      </form>
      ${
        list.loading
          ? '<div class="shared-page__loading">Loading candidates…</div>'
          : ""
      }
      ${list.error ? `<div class="shared-page__error">${escapeHtml(list.error)}</div>` : ""}
      <div class="shared-card-grid shared-card-grid--candidates">
        ${list.items
          .map(
            (
              candidate,
            ) => `<article class="shared-card shared-card--candidate-preview">
              ${
                candidate.avatarUrl
                  ? `<img class="shared-card__avatar" src="${escapeHtml(candidate.avatarUrl)}" alt="${escapeHtml(candidate.displayName)}" />`
                  : `<div class="shared-card__avatar shared-card__avatar--placeholder">${escapeHtml(candidate.displayName.slice(0, 1).toUpperCase() || "C")}</div>`
              }
              <div class="shared-card__body shared-card__body--candidate-preview">
                <div class="shared-card__meta">
                  <span>${escapeHtml(candidate.officeTitle || candidate.levelOfOffice || "Candidate")}</span>
                  ${
                    candidate.district
                      ? `<span>${escapeHtml(candidate.district)}</span>`
                      : ""
                  }
                </div>
                <h3>${escapeHtml(candidate.displayName)}</h3>
                <p class="shared-card__summary">${escapeHtml(candidate.bio || (candidate.kind === "official" ? "Open the official profile to see office details and the report card." : candidate.kind === "raceCandidate" ? "Open the auto-generated profile to see election details and any linked Polis profile." : "Open the candidate page to see recent posts, events, and campaign details."))}</p>
                <div class="shared-card__meta shared-card__meta--candidate-preview">
                  <span>${escapeHtml(formatCount(candidate.followersCount))} followers</span>
                  ${
                    candidate.tags.length
                      ? `<span>${escapeHtml(candidate.tags.join(", "))}</span>`
                      : ""
                  }
                </div>
                <div class="shared-card__actions">
                  <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="${escapeHtml(resolveCandidateOpenRoute(candidate, currentPath))}">Open</button>
                  ${
                    resolveCandidateFollowTarget(candidate).candidateId ||
                    resolveCandidateFollowTarget(candidate).officialId
                      ? `<button class="shared-feed-chip" data-action="candidate-follow" data-candidate-id="${escapeHtml(resolveCandidateFollowTarget(candidate).candidateId)}" data-official-id="${escapeHtml(resolveCandidateFollowTarget(candidate).officialId)}">${candidate.isFollowing ? "Following" : "Follow"}</button>`
                      : ""
                  }
                  ${
                    candidate.canEdit
                      ? `<button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(resolveCandidateEditRoute(candidate))}">Edit</button>`
                      : ""
                  }
                </div>
              </div>
            </article>`,
          )
          .join("")}
      </div>
      ${
        list.loadingMore
          ? '<div class="shared-page__hint">Loading more candidates…</div>'
          : ""
      }
      ${
        list.nextCursor
          ? '<div class="shared-page__pagination-sentinel" data-candidate-list-sentinel aria-hidden="true"></div>'
          : ""
      }
    </div>
  </section>`;
}

function renderCandidateDetailPage() {
  const detail = state.pages.candidates.detail;
  const candidate = detail.item;
  const isEditRoute = getCurrentRoute().routeKey === ROUTE_KEY_CANDIDATE_EDIT;
  if (detail.loading && !candidate) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__loading">Loading candidate…</div></div></section>`;
  }
  if (!candidate) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__error">${escapeHtml(detail.error || "Candidate unavailable.")}</div></div></section>`;
  }
  const socials = candidate.socials || {};
  const officialId = resolveCandidateOfficialId(candidate);
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__back-row">
        <button class="shared-feed-chip" type="button" data-action="navigate" data-route="/candidates">Back to candidates</button>
      </div>
      <div class="shared-page__header shared-page__header--hero">
        <div class="shared-page__hero">
          ${
            candidate.avatarUrl
              ? `<img class="shared-page__hero-avatar" src="${escapeHtml(candidate.avatarUrl)}" alt="${escapeHtml(candidate.displayName)}" />`
              : `<div class="shared-page__hero-avatar shared-page__hero-avatar--placeholder">${escapeHtml(candidate.displayName.slice(0, 1).toUpperCase() || "C")}</div>`
          }
          <div>
            <p class="shared-page__eyebrow">${escapeHtml(candidate.levelOfOffice || "Candidate")}</p>
            <h1>${escapeHtml(candidate.displayName)}</h1>
            <p>${escapeHtml(candidate.bio || "Candidate page")}</p>
            <div class="shared-card__meta">
              ${candidate.district ? `<span>${escapeHtml(candidate.district)}</span>` : ""}
              <span>${escapeHtml(formatCount(candidate.followersCount))} followers</span>
              ${
                candidate.tags.length
                  ? `<span>${escapeHtml(candidate.tags.join(", "))}</span>`
                  : ""
              }
            </div>
          </div>
        </div>
        <div class="shared-card__actions">
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="candidate-follow" data-candidate-id="${escapeHtml(candidate.candidateId)}" data-official-id="${escapeHtml(officialId)}">${candidate.isFollowing ? "Following" : "Follow"}</button>
          ${
            candidate.canEdit
              ? `<button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(resolveCandidateEditRoute(candidate))}">${isEditRoute ? "Editing" : "Edit page"}</button>`
              : ""
          }
          ${
            normalizeString(socials.website)
              ? `<a class="shared-feed-chip" href="${escapeHtml(socials.website)}" target="_blank" rel="noopener noreferrer">${candidate.donationsAvailable ? "Donate" : "Website"}</a>`
              : ""
          }
          ${
            officialId
              ? `<button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildOfficialReportCardRoute(officialId, { returnTo: getCurrentPathWithQuery() }))}">Official Report Card</button>`
              : ""
          }
          <button class="shared-feed-chip" data-action="navigate" data-route="/events?q=${encodeURIComponent(candidate.displayName)}">Related events</button>
        </div>
      </div>
      ${
        isEditRoute
          ? `<form class="shared-form" data-route-form="candidate-edit">
              <input type="hidden" name="candidateId" value="${escapeHtml(candidate.candidateId)}" />
              <label><span>Display name</span><input name="displayName" value="${escapeHtml(candidate.displayName)}" /></label>
              <label><span>Office level</span><input name="levelOfOffice" value="${escapeHtml(candidate.levelOfOffice)}" /></label>
              <label><span>District</span><input name="district" value="${escapeHtml(candidate.district)}" /></label>
              <label><span>Avatar URL</span><input name="avatarUrl" value="${escapeHtml(candidate.avatarUrl)}" /></label>
              <label><span>Priority tags</span><input name="priorityTags" value="${escapeHtml(candidate.tags.join(", "))}" /></label>
              <label><span>Bio</span><textarea name="bio" rows="5">${escapeHtml(candidate.bio)}</textarea></label>
              <label><span>Website</span><input name="website" value="${escapeHtml(socials.website || "")}" /></label>
              <label><span>X</span><input name="x" value="${escapeHtml(socials.x || "")}" /></label>
              <label><span>Instagram</span><input name="instagram" value="${escapeHtml(socials.instagram || "")}" /></label>
              <label><span>Facebook</span><input name="facebook" value="${escapeHtml(socials.facebook || "")}" /></label>
              <div class="shared-card__actions">
                <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${detail.saving ? " disabled" : ""}>${detail.saving ? "Saving…" : "Save candidate page"}</button>
                <button class="shared-feed-chip" type="button" data-action="navigate" data-route="${escapeHtml(resolveCandidateOpenRoute(candidate))}">Cancel</button>
              </div>
            </form>`
          : ""
      }
      ${detail.error ? `<div class="shared-page__error">${escapeHtml(detail.error)}</div>` : ""}
      <div class="shared-page__split">
        <div>
          <h2>Posts</h2>
          ${renderMediaThumbnailGrid(detail.posts, {
            emptyMessage: "No posts yet.",
            getRoute: (item) =>
              item.postId ? `/posts/${encodeURIComponent(item.postId)}` : "",
            getMediaUrl: (item) => item.posterUrl || item.imageUrl,
            getAltText: (item) =>
              item.previewTitle ||
              item.caption ||
              item.authorDisplayName ||
              "Post",
            getOverlayText: (item) =>
              `${formatCount(item.likesCount)} like${Number(item.likesCount) === 1 ? "" : "s"}`,
            getPlaceholderLabel: () => "P",
            overlayBare: true,
          })}
        </div>
        <div>
          <h2>Upcoming events</h2>
          ${renderMediaThumbnailGrid(detail.relatedEvents, {
            emptyMessage: "No upcoming events yet.",
            getRoute: (item) =>
              item.eventId ? `/events/${encodeURIComponent(item.eventId)}` : "",
            getMediaUrl: (item) => item.imageUrl,
            getAltText: (item) => item.title || "Event",
            getOverlayText: (item) =>
              `${formatCount(item.attendeeCount)} going`,
            getPlaceholderLabel: () => "E",
          })}
        </div>
      </div>
    </div>
  </section>`;
}

function renderOfficialDetailPage() {
  const detail = state.pages.candidates.officialDetail;
  const official = detail.item;
  const returnTo = normalizeString(readCurrentSearchParams().get("returnTo"));
  if (detail.loading && !official) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__loading">Loading official profile…</div></div></section>`;
  }
  if (!official) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__error">${escapeHtml(detail.error || "Official profile unavailable.")}</div></div></section>`;
  }
  const termRange = formatTermRange(official.termStart, official.termEnd);
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__back-row">
        <button class="shared-feed-chip" type="button" data-action="navigate" data-route="${escapeHtml(returnTo || "/candidates")}">Back</button>
      </div>
      ${
        official.autoGeneratedMessage
          ? `<div class="shared-page__hint shared-page__banner">${escapeHtml(official.autoGeneratedMessage)}</div>`
          : ""
      }
      <div class="shared-page__header shared-page__header--hero">
        <div class="shared-page__hero">
          ${
            official.avatarUrl
              ? `<img class="shared-page__hero-avatar" src="${escapeHtml(official.avatarUrl)}" alt="${escapeHtml(official.displayName)}" />`
              : `<div class="shared-page__hero-avatar shared-page__hero-avatar--placeholder">${escapeHtml(official.displayName.slice(0, 1).toUpperCase() || "O")}</div>`
          }
          <div>
            <p class="shared-page__eyebrow">${escapeHtml(official.officeTitle)}</p>
            <h1>${escapeHtml(official.displayName)}</h1>
            <p>${escapeHtml(official.partyLabel || "Elected official")}</p>
            <div class="shared-card__meta">
              ${official.chamber ? `<span>${escapeHtml(humanizeLabel(official.chamber))}</span>` : ""}
              ${official.state ? `<span>${escapeHtml(official.state)}</span>` : ""}
              ${official.district ? `<span>${escapeHtml(official.district)}</span>` : ""}
              ${termRange ? `<span>${escapeHtml(termRange)}</span>` : ""}
              <span>${escapeHtml(formatCount(official.followersCount))} followers</span>
            </div>
          </div>
        </div>
        <div class="shared-card__actions">
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="candidate-follow" data-candidate-id="" data-official-id="${escapeHtml(official.officialId)}">${official.isFollowing ? "Following" : "Follow"}</button>
          <button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildOfficialReportCardRoute(official.officialId, { returnTo: getCurrentPathWithQuery() }))}">Report Card</button>
          ${
            official.officialUrl
              ? `<a class="shared-feed-chip" href="${escapeHtml(official.officialUrl)}" target="_blank" rel="noopener noreferrer">Official Website</a>`
              : ""
          }
        </div>
      </div>
      <article class="shared-card">
        <div class="shared-card__body">
          <h3>Account status</h3>
          <p>${escapeHtml(official.hasAccount ? "This official already has an in-app account." : "This is an auto-generated profile until the official creates or claims an in-app account.")}</p>
        </div>
      </article>
    </div>
  </section>`;
}

function renderAutoCandidateDetailPage() {
  const detail = state.pages.candidates.autoDetail;
  const candidate = detail.item;
  const returnTo = normalizeString(readCurrentSearchParams().get("returnTo"));
  if (detail.loading && !candidate) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__loading">Loading candidate profile…</div></div></section>`;
  }
  if (!candidate) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__error">${escapeHtml(detail.error || "Candidate profile unavailable.")}</div></div></section>`;
  }
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__back-row">
        <button class="shared-feed-chip" type="button" data-action="navigate" data-route="${escapeHtml(returnTo || "/candidates")}">Back</button>
      </div>
      ${
        candidate.autoGeneratedMessage
          ? `<div class="shared-page__hint shared-page__banner">${escapeHtml(candidate.autoGeneratedMessage)}</div>`
          : ""
      }
      <div class="shared-page__header shared-page__header--hero">
        <div class="shared-page__hero">
          ${
            candidate.avatarUrl
              ? `<img class="shared-page__hero-avatar" src="${escapeHtml(candidate.avatarUrl)}" alt="${escapeHtml(candidate.displayName)}" />`
              : `<div class="shared-page__hero-avatar shared-page__hero-avatar--placeholder">${escapeHtml(candidate.displayName.slice(0, 1).toUpperCase() || "C")}</div>`
          }
          <div>
            <p class="shared-page__eyebrow">${escapeHtml(candidate.officeTitle || candidate.levelOfOffice || "Candidate")}</p>
            <h1>${escapeHtml(candidate.displayName)}</h1>
            <p>${escapeHtml(candidate.partyLabel || "Auto-generated candidate profile")}</p>
            <div class="shared-card__meta">
              ${candidate.levelOfOffice ? `<span>${escapeHtml(candidate.levelOfOffice)}</span>` : ""}
              ${candidate.state ? `<span>${escapeHtml(candidate.state)}</span>` : ""}
              ${candidate.district ? `<span>${escapeHtml(candidate.district)}</span>` : ""}
              ${
                candidate.electionStatus
                  ? `<span>${escapeHtml(humanizeLabel(candidate.electionStatus))}</span>`
                  : ""
              }
            </div>
          </div>
        </div>
        <div class="shared-card__actions">
          ${
            candidate.hasAccount && candidate.linkedCandidateId
              ? `<button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/candidates/${escapeHtml(encodeURIComponent(candidate.linkedCandidateId))}">Open Claimed Polis Profile</button>`
              : ""
          }
        </div>
      </div>
      <div class="shared-stack">
        <article class="shared-card">
          <div class="shared-card__body">
            <h3>Election</h3>
            <p>${escapeHtml(candidate.electionName || "Election details unavailable.")}</p>
            ${
              candidate.electionDay
                ? `<div class="shared-card__meta"><span>${escapeHtml(formatCalendarDate(candidate.electionDay))}</span></div>`
                : ""
            }
          </div>
        </article>
        <article class="shared-card">
          <div class="shared-card__body">
            <h3>Account status</h3>
            <p>${escapeHtml(candidate.hasAccount && candidate.linkedCandidateId ? "This auto-generated profile links to a claimed Polis candidate page." : "This is an auto-generated profile until a Polis account is created or linked.")}</p>
          </div>
        </article>
      </div>
    </div>
  </section>`;
}

function renderOfficialReportCardPage() {
  const detail = state.pages.candidates.reportCard;
  const official = state.pages.candidates.officialDetail.item;
  const routeOfficialId = decodeRouteSegment(
    getCurrentRoute().routeParams.officialId,
  );
  const resolvedOfficialId =
    normalizeString(official?.officialId) || routeOfficialId;
  const returnTo = normalizeString(readCurrentSearchParams().get("returnTo"));
  const backRoute =
    returnTo ||
    buildOfficialProfileRoute(resolvedOfficialId || routeOfficialId);
  const headline =
    normalizeString(official?.displayName) || "Official Report Card";
  if (detail.loading && !detail.items.length) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__loading">Loading report card…</div></div></section>`;
  }
  if (detail.error && !detail.items.length) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__error">${escapeHtml(detail.error)}</div></div></section>`;
  }
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__back-row">
        <button class="shared-feed-chip" type="button" data-action="navigate" data-route="${escapeHtml(backRoute)}">Back</button>
      </div>
      <div class="shared-page__header shared-page__header--hero">
        <div>
          <p class="shared-page__eyebrow">Report Card</p>
          <h1>${escapeHtml(headline)}</h1>
          <p>${escapeHtml(detail.congress ? `Congress ${detail.congress}` : "Current Congress")}</p>
          <div class="shared-card__meta">
            ${
              detail.refreshedAt
                ? `<span>Updated ${escapeHtml(formatAbsoluteDateTime(detail.refreshedAt))}</span>`
                : ""
            }
            ${
              detail.total !== null
                ? `<span>${escapeHtml(formatCount(detail.total))} votes</span>`
                : ""
            }
            <span>${detail.fromCache ? "Cached results" : "Latest results"}</span>
          </div>
        </div>
        <div class="shared-card__actions">
          ${
            resolvedOfficialId
              ? `<button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildOfficialProfileRoute(resolvedOfficialId))}">Official Profile</button>`
              : ""
          }
        </div>
      </div>
      ${
        detail.items.length
          ? `<div class="shared-stack">${detail.items
              .map((item) => {
                const billLabel =
                  normalizeString(item.billType) &&
                  normalizeString(item.billNumber)
                    ? `${item.billType.toUpperCase()} ${item.billNumber}`
                    : normalizeString(item.billId);
                const aggregateText =
                  item.aggregate &&
                  (item.aggregate.upCount > 0 || item.aggregate.downCount > 0)
                    ? `${formatApprovalRating(item.aggregate.approvalRating)} • ${formatCount(item.aggregate.upCount)} up • ${formatCount(item.aggregate.downCount)} down`
                    : "";
                const title =
                  item.billTitle || item.voteQuestion || billLabel || "Vote";
                const secondary =
                  item.billTitle &&
                  item.voteQuestion &&
                  item.voteQuestion !== item.billTitle
                    ? item.voteQuestion
                    : item.billSummary || item.voteResult || "";
                const latestAction = [item.billLatestActionText];
                if (item.billLatestActionDate) {
                  latestAction.push(
                    formatCalendarDate(item.billLatestActionDate),
                  );
                }
                return `<article class="shared-card">
                  <div class="shared-card__body">
                    <div class="shared-card__meta">
                      ${item.votedAt ? `<span>${escapeHtml(formatCalendarDate(item.votedAt))}</span>` : ""}
                      ${item.chamber ? `<span>${escapeHtml(humanizeLabel(item.chamber))}</span>` : ""}
                      ${item.voteNumber !== null ? `<span>Vote ${escapeHtml(String(item.voteNumber))}</span>` : ""}
                      ${billLabel ? `<span>${escapeHtml(billLabel)}</span>` : ""}
                    </div>
                    <h3>${escapeHtml(title)}</h3>
                    ${
                      secondary
                        ? `<p class="shared-card__summary">${escapeHtml(secondary)}</p>`
                        : ""
                    }
                    <div class="shared-card__meta">
                      ${
                        item.votePosition
                          ? `<span>Position: ${escapeHtml(item.votePosition)}</span>`
                          : ""
                      }
                      ${
                        item.voteResult
                          ? `<span>Result: ${escapeHtml(item.voteResult)}</span>`
                          : ""
                      }
                      ${
                        item.myOpinion
                          ? `<span>You voted: ${escapeHtml(humanizeLabel(item.myOpinion))}</span>`
                          : ""
                      }
                      ${
                        aggregateText
                          ? `<span>${escapeHtml(aggregateText)}</span>`
                          : ""
                      }
                    </div>
                    ${
                      latestAction.filter(Boolean).length
                        ? `<p>${escapeHtml(latestAction.filter(Boolean).join(" • "))}</p>`
                        : ""
                    }
                  </div>
                </article>`;
              })
              .join("")}</div>`
          : '<div class="shared-page__empty">No report card items are available yet.</div>'
      }
      ${
        detail.error && detail.items.length
          ? `<div class="shared-page__error">${escapeHtml(detail.error)}</div>`
          : ""
      }
      ${
        detail.loadingMore
          ? '<div class="shared-page__hint">Loading more report card items…</div>'
          : detail.nextCursor
            ? '<div class="shared-card__actions"><button class="shared-feed-chip shared-feed-chip--primary" data-action="official-report-card-load-more">Load more</button></div>'
            : ""
      }
    </div>
  </section>`;
}

function renderEventsListPage() {
  const list = state.pages.events.list;
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Events</p>
          <h1>Events</h1>
          <p>Browse upcoming events, switch into map mode, and RSVP directly from the browser.</p>
        </div>
        <div class="shared-card__actions">
          <button class="shared-feed-chip${list.mapMode ? "" : " shared-feed-chip--primary"}" data-action="toggle-events-map" data-map-mode="list">List</button>
          <button class="shared-feed-chip${list.mapMode ? " shared-feed-chip--primary" : ""}" data-action="toggle-events-map" data-map-mode="map">Map</button>
          <button class="shared-feed-chip" data-action="navigate" data-route="/manage-events">Manage yours</button>
        </div>
      </div>
      <form class="shared-form shared-form--inline" data-route-form="events-filter">
        <input type="search" name="q" placeholder="Search events" value="${escapeHtml(list.filters.q || "")}" />
        <input type="text" name="town" placeholder="Town" value="${escapeHtml(list.filters.town || "")}" />
        <input type="text" name="tags" placeholder="Tags" value="${escapeHtml(list.filters.tags || "")}" />
        <label class="shared-form__checkbox"><input type="checkbox" name="includePast"${list.filters.includePast === "true" ? " checked" : ""} /> Include past</label>
        <button type="submit" class="shared-feed-chip shared-feed-chip--primary">Apply</button>
      </form>
      ${
        list.mapMode
          ? '<div class="shared-events-map" id="shared-events-map"></div>'
          : renderMediaThumbnailGrid(list.items, {
              emptyMessage: "No events found.",
              gridClassName: "shared-media-grid--five-wide",
              getRoute: (item) =>
                item.eventId
                  ? `/events/${encodeURIComponent(item.eventId)}`
                  : "",
              getMediaUrl: (item) => item.imageUrl,
              getAltText: (item) => item.title || "Event",
              getOverlayText: (item) =>
                `${formatCount(item.attendeeCount)} going`,
              getPlaceholderLabel: () => "E",
            })
      }
      ${
        list.loading
          ? '<div class="shared-page__loading">Loading events…</div>'
          : ""
      }
      ${list.error ? `<div class="shared-page__error">${escapeHtml(list.error)}</div>` : ""}
    </div>
  </section>`;
}

function renderManageEventsPage() {
  const manage = state.pages.events.manage;
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Manage events</p>
          <h1>Your events</h1>
          <p>Review active and archived events, then open an edit flow or create a new event.</p>
        </div>
        <div class="shared-card__actions">
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/manage-events/new">Create event</button>
          <button class="shared-feed-chip" data-action="manage-events-status" data-status="active">Active</button>
          <button class="shared-feed-chip" data-action="manage-events-status" data-status="archived">Archived</button>
        </div>
      </div>
      ${
        manage.loading
          ? '<div class="shared-page__loading">Loading your events…</div>'
          : ""
      }
      ${manage.error ? `<div class="shared-page__error">${escapeHtml(manage.error)}</div>` : ""}
      <div class="shared-card-grid">
        ${manage.items
          .map(
            (event) => `<article class="shared-card">
              <div class="shared-card__body">
                <div class="shared-card__meta">
                  <span>${escapeHtml(formatAbsoluteDateTime(event.startAt))}</span>
                </div>
                <h3>${escapeHtml(event.title)}</h3>
                <p>${escapeHtml(event.address || event.description || "Event details")}</p>
                <div class="shared-card__actions">
                  <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/events/${escapeHtml(event.eventId)}">Open</button>
                  <button class="shared-feed-chip" data-action="navigate" data-route="/manage-events/${escapeHtml(event.eventId)}/edit">Edit</button>
                  <button class="shared-feed-chip" data-action="delete-event" data-event-id="${escapeHtml(event.eventId)}">Delete</button>
                </div>
              </div>
            </article>`,
          )
          .join("")}
      </div>
    </div>
  </section>`;
}

function renderEventDetailPage() {
  const detail = state.pages.events.detail;
  const event = detail.item;
  const routeKey = getCurrentRoute().routeKey;
  const isCreateRoute = routeKey === ROUTE_KEY_MANAGE_EVENTS_NEW;
  const isEditRoute = routeKey === ROUTE_KEY_MANAGE_EVENTS_EDIT;
  const formEvent = event || {};
  const backRoute = isCreateRoute
    ? "/manage-events"
    : isEditRoute && formEvent.eventId
      ? `/events/${encodeURIComponent(formEvent.eventId)}`
      : "/events";
  const backLabel = isCreateRoute ? "Back to manage events" : "Back to events";
  if (!isCreateRoute && detail.loading && !event) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__loading">Loading event…</div></div></section>`;
  }
  if (!isCreateRoute && !event) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__error">${escapeHtml(detail.error || "Event unavailable.")}</div></div></section>`;
  }
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__back-row">
        <button class="shared-feed-chip" type="button" data-action="navigate" data-route="${escapeHtml(backRoute)}">${escapeHtml(backLabel)}</button>
      </div>
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">${isCreateRoute ? "Create event" : "Event"}</p>
          <h1>${escapeHtml(isCreateRoute ? "New event" : formEvent.title || "Event")}</h1>
          <p>${escapeHtml(formEvent.description || "Manage event details, attendance, and the web detail page here.")}</p>
        </div>
        ${
          !isCreateRoute
            ? `<div class="shared-card__actions">
                <button class="shared-feed-chip shared-feed-chip--primary" data-action="event-attend" data-event-id="${escapeHtml(formEvent.eventId)}">${formEvent.isAttending ? "Going" : "RSVP"}</button>
                <button class="shared-feed-chip" data-action="event-interest" data-event-id="${escapeHtml(formEvent.eventId)}">${formEvent.isInterested ? "Interested" : "Interested?"}</button>
                ${
                  formEvent.canEdit
                    ? `<button class="shared-feed-chip" data-action="navigate" data-route="/manage-events/${escapeHtml(formEvent.eventId)}/edit">Edit</button>`
                    : ""
                }
              </div>`
            : ""
        }
      </div>
      ${detail.error ? `<div class="shared-page__error">${escapeHtml(detail.error)}</div>` : ""}
      ${
        isCreateRoute || isEditRoute
          ? `<form class="shared-form" data-route-form="event-edit">
              <input type="hidden" name="eventId" value="${escapeHtml(formEvent.eventId || "")}" />
              <input type="hidden" name="mode" value="${escapeHtml(isEditRoute ? "edit" : "create")}" />
              <label><span>Title</span><input name="title" value="${escapeHtml(formEvent.title || "")}" required /></label>
              <label><span>Description</span><textarea name="description" rows="5">${escapeHtml(formEvent.description || "")}</textarea></label>
              <label><span>Town</span><input name="locationTown" value="${escapeHtml(formEvent.locationTown || "")}" required /></label>
              <label><span>Location name</span><input name="locationName" value="${escapeHtml(formEvent.locationName || "")}" /></label>
              <label><span>Address</span><input name="address" value="${escapeHtml(formEvent.address || "")}" required /></label>
              <label><span>Image URL</span><input name="imageUrl" value="${escapeHtml(formEvent.imageUrl || "")}" /></label>
              <label><span>Tags</span><input name="tags" value="${escapeHtml((formEvent.tags || []).join(", "))}" /></label>
              <label><span>Start</span><input type="datetime-local" name="startAt" value="${escapeHtml(formatDateTimeInputValue(formEvent.startAt))}" required /></label>
              <label><span>End</span><input type="datetime-local" name="endAt" value="${escapeHtml(formatDateTimeInputValue(formEvent.endAt))}" required /></label>
              <div class="shared-card__actions">
                <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${detail.saving ? " disabled" : ""}>${detail.saving ? "Saving…" : isEditRoute ? "Save event" : "Create event"}</button>
                <button class="shared-feed-chip" type="button" data-action="navigate" data-route="${isEditRoute ? `/events/${escapeHtml(formEvent.eventId)}` : "/manage-events"}">Cancel</button>
              </div>
            </form>`
          : `<div class="shared-card-grid shared-card-grid--detail">
              <article class="shared-card">
                ${
                  formEvent.imageUrl
                    ? `<img class="shared-card__image" src="${escapeHtml(formEvent.imageUrl)}" alt="${escapeHtml(formEvent.title)}" />`
                    : ""
                }
                <div class="shared-card__body">
                  <div class="shared-card__meta">
                    <span>${escapeHtml(formatAbsoluteDateTime(formEvent.startAt))}</span>
                    ${formEvent.locationTown ? `<span>${escapeHtml(formEvent.locationTown)}</span>` : ""}
                  </div>
                  <h3>${escapeHtml(formEvent.title)}</h3>
                  <p>${escapeHtml(formEvent.description || formEvent.address || "")}</p>
                  <div class="shared-card__meta">
                    <span>${escapeHtml(formatCount(formEvent.attendeeCount))} going</span>
                    <span>${escapeHtml(formatCount(formEvent.interestedCount))} interested</span>
                  </div>
                  <div class="shared-card__meta">
                    ${formEvent.address ? `<span>${escapeHtml(formEvent.address)}</span>` : ""}
                    ${formEvent.locationName ? `<span>${escapeHtml(formEvent.locationName)}</span>` : ""}
                  </div>
                </div>
              </article>
            </div>`
      }
    </div>
  </section>`;
}

function renderProfilePage() {
  const routeKey = getCurrentRoute().routeKey;
  const profileState = state.pages.profile;
  const profile = profileState.current || profileState.me;
  const isEditRoute = routeKey === ROUTE_KEY_PROFILE_EDIT;
  if (profileState.loading && !profile) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__loading">Loading profile…</div></div></section>`;
  }
  if (!profile) {
    return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__error">${escapeHtml(profileState.error || "Profile unavailable.")}</div></div></section>`;
  }
  const links = Array.isArray(profile.links) ? profile.links : [];
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header shared-page__header--hero">
        <div class="shared-page__hero">
          ${
            profile.avatarUrl
              ? `<img class="shared-page__hero-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.displayName)}" />`
              : `<div class="shared-page__hero-avatar shared-page__hero-avatar--placeholder">${escapeHtml(profile.displayName.slice(0, 1).toUpperCase() || "P")}</div>`
          }
          <div>
            <p class="shared-page__eyebrow">Profile</p>
            <h1>${escapeHtml(profile.displayName)}</h1>
            <p>${escapeHtml(profile.bio || "Polis profile")}</p>
            <div class="shared-card__meta">
              ${profile.username ? `<span>@${escapeHtml(profile.username)}</span>` : ""}
              ${profile.town ? `<span>${escapeHtml(profile.town)}</span>` : ""}
              ${profile.state ? `<span>${escapeHtml(profile.state)}</span>` : ""}
            </div>
            <div class="shared-card__meta">
              <span>${escapeHtml(formatCount(profile.followersCount))} followers</span>
              <span>${escapeHtml(formatCount(profile.totalLikes))} likes</span>
            </div>
          </div>
        </div>
        <div class="shared-card__actions">
          ${
            profile.userId === state.auth.user?.userId
              ? `<button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/profile/edit">${isEditRoute ? "Editing" : "Edit profile"}</button>`
              : `<button class="shared-feed-chip shared-feed-chip--primary" data-action="profile-follow" data-user-id="${escapeHtml(profile.userId)}">${profile.isFollowing ? "Following" : "Follow"}</button>`
          }
          <button class="shared-feed-chip" data-action="navigate" data-route="/profile/connections">Connections</button>
          <button class="shared-feed-chip" data-action="navigate" data-route="/profile/notifications">Notifications</button>
        </div>
      </div>
      ${
        isEditRoute
          ? `<form class="shared-form" data-route-form="profile-edit">
              <label><span>Display name</span><input name="displayName" value="${escapeHtml(profile.displayName)}" /></label>
              <label><span>Username</span><input name="username" value="${escapeHtml(profile.username)}" /></label>
              <label><span>Avatar URL</span><input name="avatarUrl" value="${escapeHtml(profile.avatarUrl)}" /></label>
              <label><span>Town</span><input name="town" value="${escapeHtml(profile.town)}" /></label>
              <label><span>State</span><input name="state" value="${escapeHtml(profile.state)}" /></label>
              <label><span>District</span><input name="district" value="${escapeHtml(profile.district)}" /></label>
              <label><span>Bio</span><textarea name="bio" rows="5">${escapeHtml(profile.bio)}</textarea></label>
              <label><span>Website</span><input name="website" value="${escapeHtml(links.find((entry) => entry.type === "website")?.url || "")}" /></label>
              <label><span>X</span><input name="x" value="${escapeHtml(links.find((entry) => entry.type === "x" || entry.type === "twitter")?.url || "")}" /></label>
              <label><span>Instagram</span><input name="instagram" value="${escapeHtml(links.find((entry) => entry.type === "instagram")?.url || "")}" /></label>
              <div class="shared-card__actions">
                <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${profileState.saving ? " disabled" : ""}>${profileState.saving ? "Saving…" : "Save profile"}</button>
                <button class="shared-feed-chip" type="button" data-action="navigate" data-route="/profile">Cancel</button>
              </div>
            </form>`
          : ""
      }
      ${profileState.error ? `<div class="shared-page__error">${escapeHtml(profileState.error)}</div>` : ""}
      <h2>Posts</h2>
      ${renderMediaThumbnailGrid(profileState.posts.items, {
        emptyMessage: "No posts yet.",
        getRoute: (item) =>
          item.postId ? `/posts/${encodeURIComponent(item.postId)}` : "",
        getMediaUrl: (item) => item.posterUrl || item.imageUrl,
        getAltText: (item) =>
          item.previewTitle || item.caption || item.authorDisplayName || "Post",
        getOverlayText: (item) =>
          `${formatCount(item.likesCount)} like${Number(item.likesCount) === 1 ? "" : "s"}`,
        getPlaceholderLabel: () => "P",
        overlayBare: true,
      })}
    </div>
  </section>`;
}

function renderProfileConnectionsPage() {
  const connections = state.pages.profile.connections;
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Connections</p>
          <h1>Connections</h1>
          <p>Review followers, following, and friends for this profile.</p>
        </div>
        <div class="shared-card__actions">
          <button class="shared-feed-chip${connections.kind === "followers" ? " shared-feed-chip--primary" : ""}" data-action="profile-connections-kind" data-kind="followers">Followers</button>
          <button class="shared-feed-chip${connections.kind === "following" ? " shared-feed-chip--primary" : ""}" data-action="profile-connections-kind" data-kind="following">Following</button>
          <button class="shared-feed-chip${connections.kind === "friends" ? " shared-feed-chip--primary" : ""}" data-action="profile-connections-kind" data-kind="friends">Friends</button>
        </div>
      </div>
      ${
        connections.loading
          ? '<div class="shared-page__loading">Loading connections…</div>'
          : ""
      }
      ${connections.error ? `<div class="shared-page__error">${escapeHtml(connections.error)}</div>` : ""}
      <div class="shared-card-grid">
        ${connections.items
          .map(
            (entry) => `<article class="shared-card">
              ${
                entry.avatarUrl
                  ? `<img class="shared-card__avatar" src="${escapeHtml(entry.avatarUrl)}" alt="${escapeHtml(entry.displayName)}" />`
                  : `<div class="shared-card__avatar shared-card__avatar--placeholder">${escapeHtml(entry.displayName.slice(0, 1).toUpperCase() || "P")}</div>`
              }
              <div class="shared-card__body">
                <h3>${escapeHtml(entry.displayName)}</h3>
                <p>${escapeHtml(entry.subtitle || entry.username || "Polis user")}</p>
                <div class="shared-card__actions">
                  <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/profile/${escapeHtml(entry.userId)}">Open profile</button>
                </div>
              </div>
            </article>`,
          )
          .join("")}
      </div>
    </div>
  </section>`;
}

function renderProfileNotificationsPage() {
  const notifications = state.pages.profile.notifications;
  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Notifications</p>
          <h1>Notifications</h1>
          <p>${escapeHtml(formatCount(notifications.unreadCount))} unread notifications.</p>
        </div>
        <div class="shared-card__actions">
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="notifications-read">Mark all read</button>
        </div>
      </div>
      ${
        notifications.loading
          ? '<div class="shared-page__loading">Loading notifications…</div>'
          : ""
      }
      ${notifications.error ? `<div class="shared-page__error">${escapeHtml(notifications.error)}</div>` : ""}
      <div class="shared-stack">
        ${notifications.items
          .map(
            (item) => `<article class="shared-card">
              <div class="shared-card__body">
                <div class="shared-card__meta">
                  <span>${item.readAt ? "Read" : "Unread"}</span>
                  ${
                    item.createdAt
                      ? `<span>${escapeHtml(formatAbsoluteDateTime(item.createdAt))}</span>`
                      : ""
                  }
                </div>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.body || "Notification")}</p>
                ${
                  item.route
                    ? `<div class="shared-card__actions">
                        <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="${escapeHtml(item.route)}">Open</button>
                      </div>`
                    : ""
                }
              </div>
            </article>`,
          )
          .join("")}
      </div>
    </div>
  </section>`;
}

function humanizeLabel(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildMessagingServerRoute(scopeType, scopeId, suffix = "") {
  const base = `/messages/servers/${encodeURIComponent(normalizeString(scopeType))}/${encodeURIComponent(normalizeString(scopeId))}`;
  return suffix ? `${base}${suffix}` : base;
}

function buildMessagingRoomRoute(
  scopeType,
  scopeId,
  conversationId,
  suffix = "",
) {
  const base = `${buildMessagingServerRoute(scopeType, scopeId)}/rooms/${encodeURIComponent(normalizeString(conversationId))}`;
  return suffix ? `${base}${suffix}` : base;
}

function findMessagingServer(scopeType, scopeId) {
  const normalizedScopeType = normalizeString(scopeType).toLowerCase();
  const normalizedScopeId = normalizeString(scopeId);
  return (
    state.pages.messaging.servers.items.find(
      (item) =>
        normalizeString(item.scopeType).toLowerCase() === normalizedScopeType &&
        normalizeString(item.scopeId) === normalizedScopeId,
    ) ||
    (normalizeString(
      state.pages.messaging.serverSettings.item?.server?.scopeType,
    ).toLowerCase() === normalizedScopeType &&
    normalizeString(
      state.pages.messaging.serverSettings.item?.server?.scopeId,
    ) === normalizedScopeId
      ? state.pages.messaging.serverSettings.item?.server
      : null)
  );
}

function renderMessagingServerCards(servers = []) {
  return servers
    .map(
      (server) => `<article class="shared-card">
        <div class="shared-card__body">
          <div class="shared-card__meta">
            <span>${escapeHtml(server.scopeBadge || "Server")}</span>
            <span>${escapeHtml(formatCount(server.memberCount || 0))} members</span>
          </div>
          <h3>${escapeHtml(server.title || "Server")}</h3>
          <p>${escapeHtml(server.scopeType || "Scope server")}</p>
          <div class="shared-card__actions">
            <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(server.scopeType, server.scopeId))}">Open</button>
          </div>
        </div>
      </article>`,
    )
    .join("");
}

function renderMessagingConversationPanel({
  conversation,
  messages,
  sideButtons = "",
  asideTitle = "Conversations",
}) {
  return `<div class="shared-page__split">
    <div class="shared-page__sidebar">
      <div class="shared-page__hint">${escapeHtml(asideTitle)}</div>
      <div class="shared-stack">${sideButtons || '<div class="shared-page__empty">No related conversations.</div>'}</div>
    </div>
    <div class="shared-page__main">
      ${
        conversation
          ? `<div class="shared-page__header">
              <div>
                <p class="shared-page__eyebrow">${escapeHtml(conversation.kind)}</p>
                <h1>${escapeHtml(conversation.title)}</h1>
                <p>${escapeHtml(conversation.isEncrypted ? "Encrypted conversation. Sending new messages from the browser is still limited." : conversation.subtitle || "Conversation")}</p>
              </div>
            </div>
            <div class="shared-message-list">
              ${messages
                .map(
                  (
                    message,
                  ) => `<article class="shared-message${message.senderUserId === state.auth.user?.userId ? " is-self" : ""}">
                    <div class="shared-message__meta">
                      <span>${escapeHtml(message.senderDisplayName)}</span>
                      ${
                        message.createdAt
                          ? `<span>${escapeHtml(formatAbsoluteDateTime(message.createdAt))}</span>`
                          : ""
                      }
                    </div>
                    <p>${escapeHtml(message.text)}</p>
                  </article>`,
                )
                .join("")}
            </div>
            ${
              state.pages.messaging.conversation.typingParticipants.length
                ? `<div class="shared-page__hint">${escapeHtml(
                    `${state.pages.messaging.conversation.typingParticipants[0].label} is typing…`,
                  )}</div>`
                : ""
            }
            <form class="shared-form shared-form--inline" data-route-form="messaging-send">
              <input type="hidden" name="conversationId" value="${escapeHtml(conversation.conversationId)}" />
              <input type="text" name="text" placeholder="${escapeHtml(conversation.isEncrypted ? "Encrypted browser compose is not ready yet" : "Write a message")}" ${conversation.isEncrypted ? "disabled" : ""} />
              <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${state.pages.messaging.conversation.sending || conversation.isEncrypted ? " disabled" : ""}>${state.pages.messaging.conversation.sending ? "Sending…" : "Send"}</button>
            </form>`
          : `<div class="shared-page__empty">Conversation unavailable.</div>`
      }
    </div>
  </div>`;
}

function renderMessagingPage() {
  const messaging = state.pages.messaging;
  const inbox = messaging.inbox;
  const requests = messaging.requests;
  const conversation = messaging.conversation;
  const settings = messaging.settings || {};
  const subroute = parseMessagingSubroute();
  const currentServer = findMessagingServer(
    subroute.scopeType,
    subroute.scopeId,
  );
  const directory = messaging.serverDirectory.item;
  const serverSettings = messaging.serverSettings.item;
  const serverRoles = messaging.serverRoles;
  const serverMembers = messaging.serverMembers;
  const serverBans = messaging.serverBans;
  const roomMembers = messaging.roomMembers;
  const permissionBundle = messaging.permissionTarget.bundle || {};
  const permissionTarget =
    permissionBundle.target && typeof permissionBundle.target === "object"
      ? permissionBundle.target
      : {};
  const serverCards = renderMessagingServerCards(messaging.servers.items || []);
  const inboxButtons = inbox.items
    .map(
      (
        item,
      ) => `<button class="shared-list-item${item.conversationId === conversation.item?.conversationId ? " is-active" : ""}" data-action="navigate" data-route="/messages/conversations/${encodeURIComponent(item.conversationId)}">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.lastMessagePreview || "Conversation")}</span>
        ${item.unreadCount ? `<em>${escapeHtml(formatCount(item.unreadCount))} unread</em>` : ""}
      </button>`,
    )
    .join("");
  const channelButtons = (directory?.channels || [])
    .map(
      (
        item,
      ) => `<button class="shared-list-item${item.conversationId === conversation.item?.conversationId ? " is-active" : ""}" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, item.conversationId))}">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.lastMessagePreview || item.subtitle || "Room")}</span>
      </button>`,
    )
    .join("");

  let bodyMarkup = "";
  if (subroute.view === "requests") {
    bodyMarkup = `<div class="shared-stack">${requests.items
      .map(
        (item) => `<article class="shared-card">
          <div class="shared-card__body">
            <div class="shared-card__meta">
              <span>${escapeHtml(humanizeLabel(item.type) || "Request")}</span>
              ${
                item.createdAt
                  ? `<span>${escapeHtml(formatAbsoluteDateTime(item.createdAt))}</span>`
                  : ""
              }
            </div>
            <h3>${escapeHtml(item.title || "Request")}</h3>
            <p>${escapeHtml(item.subtitle || "Review this request.")}</p>
            <div class="shared-card__actions">
              ${
                item.requestId
                  ? `<button class="shared-feed-chip shared-feed-chip--primary" data-action="messaging-request-accept" data-request-id="${escapeHtml(item.requestId)}">Accept</button>
                     <button class="shared-feed-chip" data-action="messaging-request-refuse" data-request-id="${escapeHtml(item.requestId)}">Refuse</button>`
                  : ""
              }
            </div>
          </div>
        </article>`,
      )
      .join("")}</div>`;
  } else if (subroute.view === "compose") {
    bodyMarkup = `<form class="shared-form" data-route-form="messaging-compose">
      <label><span>User ID</span><input name="recipientId" value="${escapeHtml(messaging.compose.recipientId || "")}" /></label>
      <label><span>Username</span><input name="username" /></label>
      <div class="shared-card__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${messaging.compose.pending ? " disabled" : ""}>${messaging.compose.pending ? "Starting…" : "Start DM"}</button>
      </div>
      ${messaging.compose.error ? `<div class="shared-page__error">${escapeHtml(messaging.compose.error)}</div>` : ""}
    </form>`;
  } else if (subroute.view === "conversation") {
    bodyMarkup = renderMessagingConversationPanel({
      conversation: conversation.item,
      messages: conversation.messages,
      sideButtons: inboxButtons,
      asideTitle: "Inbox",
    });
  } else if (subroute.view === "server-room") {
    bodyMarkup = `${renderMessagingConversationPanel({
      conversation: conversation.item,
      messages: conversation.messages,
      sideButtons: channelButtons,
      asideTitle: currentServer?.title || "Server rooms",
    })}
    <div class="shared-stack">
      <div class="shared-card__actions">
        <button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, subroute.conversationId, "/settings"))}">Room settings</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, subroute.conversationId, "/settings/permissions"))}">Permissions</button>
      </div>
    </div>`;
  } else if (subroute.view === "settings") {
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card"><div class="shared-card__body"><h3>Settings</h3><p>DM privacy: ${escapeHtml(normalizeString(settings.dmPrivacy) || "default")}</p><p>Read receipts: ${settings.readReceiptsEnabled === false ? "Off" : "On"}</p></div></article>
      <div class="shared-card__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/messages/devices">Devices</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="/messages/devices/link">Device link</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="/messages/recovery">Recovery</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="/messages/security-activity">Security activity</button>
      </div>
    </div>`;
  } else if (subroute.view === "devices") {
    bodyMarkup = `<div class="shared-stack">
      <div class="shared-page__hint">${escapeHtml(messaging.device.error || `Current device: ${messaging.device.currentDeviceId || "unavailable"}`)}</div>
      <div class="shared-card__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="/messages/devices/link">Link new device</button>
      </div>
      ${(messaging.devices.items || [])
        .map(
          (device) =>
            `<article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>${escapeHtml(device.platform || "device")}</span>${device.lastSeenAt ? `<span>${escapeHtml(formatAbsoluteDateTime(device.lastSeenAt))}</span>` : ""}</div><h3>${escapeHtml(device.deviceLabel || "Device")}</h3><p>${escapeHtml(device.deviceId || "")}</p>${
              device.deviceId &&
              device.deviceId !== messaging.device.currentDeviceId
                ? `<div class="shared-card__actions"><button class="shared-feed-chip" data-action="messaging-device-revoke" data-device-id="${escapeHtml(device.deviceId)}">Revoke</button></div>`
                : ""
            }</div></article>`,
        )
        .join("")}
    </div>`;
  } else if (subroute.view === "device-link") {
    const link = messaging.deviceLink.link;
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card">
        <div class="shared-card__body">
          <div class="shared-card__meta">
            <span>${escapeHtml(normalizeString(link?.status) || "idle")}</span>
            ${
              link?.expiresAt
                ? `<span>${escapeHtml(formatAbsoluteDateTime(link.expiresAt))}</span>`
                : ""
            }
          </div>
          <h3>Device link</h3>
          <p>${escapeHtml(link?.linkCode ? `Link code: ${link.linkCode}` : "Start a new device-link flow on this browser, or enter a code from another device to approve it.")}</p>
          ${
            link?.targetDeviceId
              ? `<p>${escapeHtml(`Target device: ${link.targetDeviceId}`)}</p>`
              : ""
          }
        </div>
      </article>
      <div class="shared-card__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="messaging-device-link-start"${messaging.deviceLink.pending ? " disabled" : ""}>${messaging.deviceLink.pending ? "Working…" : "Start link"}</button>
        ${
          link?.linkId
            ? `<button class="shared-feed-chip" data-action="messaging-device-link-refresh" data-link-id="${escapeHtml(link.linkId)}">Refresh</button>`
            : ""
        }
        ${
          link?.linkId && link?.linkCode && link?.targetDeviceId
            ? `<button class="shared-feed-chip" data-action="messaging-device-link-approve">Approve</button>`
            : ""
        }
      </div>
      <form class="shared-form shared-form--inline" data-route-form="messaging-device-link-lookup">
        <input name="linkCode" value="${escapeHtml(messaging.deviceLink.lookupCode || "")}" placeholder="Link code" />
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${messaging.deviceLink.pending ? " disabled" : ""}>Lookup</button>
      </form>
      ${messaging.deviceLink.error ? `<div class="shared-page__error">${escapeHtml(messaging.deviceLink.error)}</div>` : ""}
    </div>`;
  } else if (
    subroute.view === "recovery" ||
    subroute.view === "recovery-restore"
  ) {
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card"><div class="shared-card__body"><h3>Recovery status</h3><p>${escapeHtml(normalizeString(messaging.recovery.status?.status || messaging.recovery.status?.backupVersion ? "Configured" : "Not enrolled"))}</p><p>${messaging.recovery.localCode ? `Local code: ${escapeHtml(messaging.recovery.localCode)}` : "No local recovery code stored in this browser yet."}</p></div></article>
      <div class="shared-card__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="messaging-recovery-enroll">${messaging.recovery.actionPending ? "Working…" : "Enroll"}</button>
        <button class="shared-feed-chip" data-action="messaging-recovery-rotate">Rotate</button>
        <button class="shared-feed-chip" data-action="messaging-recovery-verify">Verify</button>
      </div>
      <form class="shared-form shared-form--inline" data-route-form="messaging-recovery-restore">
        <input name="recoveryCode" placeholder="Recovery code" />
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${messaging.recovery.actionPending ? " disabled" : ""}>Restore</button>
      </form>
      ${messaging.recovery.error ? `<div class="shared-page__error">${escapeHtml(messaging.recovery.error)}</div>` : ""}
    </div>`;
  } else if (subroute.view === "security") {
    bodyMarkup = `<div class="shared-stack">${(messaging.security.items || [])
      .map(
        (item) =>
          `<article class="shared-card"><div class="shared-card__body"><h3>${escapeHtml(item.type || item.title || "Security event")}</h3><p>${escapeHtml(item.description || item.deviceLabel || "")}</p><div class="shared-card__meta">${item.createdAt ? `<span>${escapeHtml(formatAbsoluteDateTime(item.createdAt))}</span>` : ""}</div></div></article>`,
      )
      .join("")}</div>`;
  } else if (subroute.view === "server") {
    const categories = Array.isArray(directory?.categories)
      ? directory.categories
      : [];
    const channels = Array.isArray(directory?.channels)
      ? directory.channels
      : [];
    const uncategorized = channels.filter(
      (item) => !normalizeString(item.raw?.categoryId),
    );
    bodyMarkup = `<div class="shared-stack">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">${escapeHtml(currentServer?.scopeBadge || "Server")}</p>
          <h1>${escapeHtml(currentServer?.title || "Server")}</h1>
          <p>${escapeHtml(currentServer?.canManage ? "Manage channels, roles, members, and moderation from the browser." : "Browse this server’s channels and rooms from the browser.")}</p>
        </div>
      </div>
      <div class="shared-card__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, "/settings"))}">Settings</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, "/roles"))}">Roles</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, "/members"))}">Members</button>
        <button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, "/bans"))}">Bans</button>
      </div>
      ${
        categories.length
          ? categories
              .map((category) => {
                const categoryChannels = channels.filter(
                  (item) =>
                    normalizeString(item.raw?.categoryId) ===
                    normalizeString(category.categoryId),
                );
                return `<article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>Category</span><span>${escapeHtml(formatCount(categoryChannels.length))} rooms</span></div><h3>${escapeHtml(category.title || "Category")}</h3><div class="shared-stack">${
                  categoryChannels
                    .map(
                      (item) =>
                        `<button class="shared-list-item" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, item.conversationId))}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.subtitle || item.lastMessagePreview || "Room")}</span></button>`,
                    )
                    .join("") ||
                  '<div class="shared-page__empty">No rooms in this category.</div>'
                }</div></div></article>`;
              })
              .join("")
          : ""
      }
      ${
        uncategorized.length
          ? `<article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>Rooms</span><span>${escapeHtml(formatCount(uncategorized.length))}</span></div><h3>Uncategorized</h3><div class="shared-stack">${uncategorized
              .map(
                (item) =>
                  `<button class="shared-list-item" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, item.conversationId))}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.subtitle || item.lastMessagePreview || "Room")}</span></button>`,
              )
              .join("")}</div></div></article>`
          : ""
      }
    </div>`;
  } else if (
    subroute.view === "server-settings" ||
    subroute.view === "server-settings-section"
  ) {
    const sections = serverSettings?.sections || {};
    const selectedSection = normalizeString(subroute.sectionId);
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card">
        <div class="shared-card__body">
          <div class="shared-card__meta">
            <span>${escapeHtml(serverSettings?.server?.scopeBadge || "Server")}</span>
            <span>${escapeHtml(formatCount(serverSettings?.server?.memberCount || 0))} members</span>
          </div>
          <h3>${escapeHtml(serverSettings?.server?.title || currentServer?.title || "Server settings")}</h3>
          <p>${escapeHtml(selectedSection ? `${humanizeLabel(selectedSection)} section` : "Overview and server preferences.")}</p>
        </div>
      </article>
      <form class="shared-form shared-form--inline" data-route-form="messaging-server-settings-preferences">
        <input type="hidden" name="scopeType" value="${escapeHtml(subroute.scopeType)}" />
        <input type="hidden" name="scopeId" value="${escapeHtml(subroute.scopeId)}" />
        <label><span>Notification level</span><input name="notificationLevel" value="${escapeHtml(normalizeString(serverSettings?.overview?.defaultNotificationLevel || ""))}" placeholder="all / mentions / none" /></label>
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${messaging.serverSettings.saving ? " disabled" : ""}>${messaging.serverSettings.saving ? "Saving…" : "Save"}</button>
      </form>
      ${["settings", "community", "userManagement"]
        .map((groupKey) => {
          const items = Array.isArray(sections[groupKey])
            ? sections[groupKey]
            : [];
          if (!items.length) {
            return "";
          }
          return `<article class="shared-card"><div class="shared-card__body"><h3>${escapeHtml(humanizeLabel(groupKey))}</h3><div class="shared-stack">${items
            .map(
              (item) =>
                `<button class="shared-list-item${selectedSection === normalizeString(item.id) ? " is-active" : ""}" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, `/settings/${encodeURIComponent(normalizeString(item.id))}`))}"><strong>${escapeHtml(item.title || humanizeLabel(item.id) || "Section")}</strong><span>${item.available === false ? "Not available for this server." : "Open this settings section."}</span></button>`,
            )
            .join("")}</div></div></article>`;
        })
        .join("")}
    </div>`;
  } else if (subroute.view === "server-roles") {
    bodyMarkup = `<div class="shared-stack">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Roles</p>
          <h1>${escapeHtml(currentServer?.title || "Server roles")}</h1>
          <p>${escapeHtml("Inspect role membership and permission baselines from the browser.")}</p>
        </div>
      </div>
      <div class="shared-card-grid">${serverRoles.items
        .map(
          (role) =>
            `<article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>${escapeHtml(role.color)}</span><span>${escapeHtml(formatCount(role.memberCount))} members</span></div><h3>${escapeHtml(role.name)}</h3><p>${escapeHtml(role.mentionable ? "Mentionable role" : "Standard role")}</p><div class="shared-card__actions"><button class="shared-feed-chip shared-feed-chip--primary" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, `/roles/${encodeURIComponent(role.roleId)}`))}">Open</button></div></div></article>`,
        )
        .join("")}</div>
    </div>`;
  } else if (subroute.view === "server-role") {
    const selectedRole = serverRoles.selected;
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>${escapeHtml(selectedRole?.color || "#8f96a3")}</span><span>${escapeHtml(formatCount(selectedRole?.memberCount || serverRoles.members.length))} members</span></div><h3>${escapeHtml(selectedRole?.name || "Role")}</h3><p>${escapeHtml(selectedRole?.mentionable ? "Mentionable role" : "Role detail")}</p></div></article>
      <article class="shared-card"><div class="shared-card__body"><h3>Role members</h3><div class="shared-stack">${serverRoles.members.length ? serverRoles.members.map((userId) => `<button class="shared-list-item" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, `/members/${encodeURIComponent(userId)}`))}"><strong>${escapeHtml(userId)}</strong><span>Open member detail</span></button>`).join("") : '<div class="shared-page__empty">No members assigned.</div>'}</div></div></article>
      <article class="shared-card"><div class="shared-card__body"><h3>Candidate members</h3><div class="shared-stack">${(serverRoles.candidates || []).length ? serverRoles.candidates.map((candidate) => `<div class="shared-list-item"><strong>${escapeHtml(normalizeString(candidate.displayName || candidate.username || candidate.userId) || "User")}</strong><span>${escapeHtml(normalizeString(candidate.userId))}</span></div>`).join("") : '<div class="shared-page__empty">No role candidates available.</div>'}</div></div></article>
    </div>`;
  } else if (subroute.view === "server-members") {
    bodyMarkup = `<div class="shared-stack">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Members</p>
          <h1>${escapeHtml(currentServer?.title || "Server members")}</h1>
          <p>${escapeHtml("Review roles, nicknames, and moderation targets from the browser.")}</p>
        </div>
      </div>
      <form class="shared-form shared-form--inline" data-route-form="messaging-server-members-filter">
        <input type="hidden" name="scopeType" value="${escapeHtml(subroute.scopeType)}" />
        <input type="hidden" name="scopeId" value="${escapeHtml(subroute.scopeId)}" />
        <label><span>Search</span><input name="query" value="${escapeHtml(readCurrentSearchParams().get("query") || "")}" placeholder="Search members" /></label>
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit">Filter</button>
      </form>
      <div class="shared-stack">${serverMembers.items
        .map(
          (member) =>
            `<button class="shared-list-item" data-action="navigate" data-route="${escapeHtml(buildMessagingServerRoute(subroute.scopeType, subroute.scopeId, `/members/${encodeURIComponent(member.userId)}`))}"><strong>${escapeHtml(member.effectiveName)}</strong><span>${escapeHtml(member.roles.map((role) => role.name).join(", ") || member.username || member.userId)}</span></button>`,
        )
        .join("")}</div>
    </div>`;
  } else if (subroute.view === "server-member") {
    const detail = serverMembers.detail;
    const member = detail?.member;
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>${escapeHtml(member?.username ? `@${member.username}` : member?.userId || "member")}</span>${member?.timeoutUntil ? `<span>${escapeHtml(formatAbsoluteDateTime(member.timeoutUntil))}</span>` : ""}</div><h3>${escapeHtml(member?.effectiveName || "Member")}</h3><p>${escapeHtml(member?.roles?.map((role) => role.name).join(", ") || "No explicit roles")}</p><div class="shared-card__actions"><button class="shared-feed-chip" data-action="messaging-member-ban" data-scope-type="${escapeHtml(subroute.scopeType)}" data-scope-id="${escapeHtml(subroute.scopeId)}" data-user-id="${escapeHtml(subroute.userId)}">Ban</button><button class="shared-feed-chip" data-action="messaging-member-remove" data-scope-type="${escapeHtml(subroute.scopeType)}" data-scope-id="${escapeHtml(subroute.scopeId)}" data-user-id="${escapeHtml(subroute.userId)}">Remove</button></div></div></article>
      ${serverMembers.detailError ? `<div class="shared-page__error">${escapeHtml(serverMembers.detailError)}</div>` : ""}
    </div>`;
  } else if (subroute.view === "server-bans") {
    bodyMarkup = `<div class="shared-stack">
      <div class="shared-page__header">
        <div>
          <p class="shared-page__eyebrow">Moderation</p>
          <h1>${escapeHtml(currentServer?.title || "Server bans")}</h1>
          <p>${escapeHtml("Manage bans from the browser.")}</p>
        </div>
      </div>
      ${
        (serverBans.items || [])
          .map(
            (ban) =>
              `<article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta">${ban.bannedAt ? `<span>${escapeHtml(formatAbsoluteDateTime(ban.bannedAt))}</span>` : ""}${ban.bannedBy ? `<span>${escapeHtml(`By ${ban.bannedBy}`)}</span>` : ""}</div><h3>${escapeHtml(ban.displayName || ban.username || ban.userId)}</h3><p>${escapeHtml(ban.reason || "No ban reason recorded.")}</p><div class="shared-card__actions"><button class="shared-feed-chip shared-feed-chip--primary" data-action="messaging-member-unban" data-scope-type="${escapeHtml(subroute.scopeType)}" data-scope-id="${escapeHtml(subroute.scopeId)}" data-user-id="${escapeHtml(ban.userId)}">Unban</button></div></div></article>`,
          )
          .join("") || '<div class="shared-page__empty">No active bans.</div>'
      }
    </div>`;
  } else if (
    subroute.view === "room-settings" ||
    subroute.view === "room-settings-notifications" ||
    subroute.view === "room-settings-section"
  ) {
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>${escapeHtml(humanizeLabel(subroute.view.replace(/^room-/, "")) || "Room settings")}</span></div><h3>${escapeHtml(conversation.item?.title || "Room")}</h3><p>${escapeHtml(conversation.item?.subtitle || "Manage members and room settings from the browser.")}</p><div class="shared-card__actions"><button class="shared-feed-chip" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, subroute.conversationId, "/settings/permissions"))}">Permissions</button></div></div></article>
      <form class="shared-form shared-form--inline" data-route-form="messaging-room-member-add">
        <input type="hidden" name="conversationId" value="${escapeHtml(subroute.conversationId)}" />
        <label><span>User ID</span><input name="userId" placeholder="User id" /></label>
        <label><span>Username</span><input name="username" placeholder="Username" /></label>
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit">Add member</button>
      </form>
      <article class="shared-card"><div class="shared-card__body"><h3>Room members</h3><div class="shared-stack">${(roomMembers.items || []).length ? roomMembers.items.map((member) => `<div class="shared-list-item"><strong>${escapeHtml(member.effectiveName)}</strong><span>${escapeHtml(member.roles.map((role) => role.name).join(", ") || member.username || member.userId)}</span><div class="shared-card__actions"><button class="shared-feed-chip" data-action="messaging-room-member-remove" data-conversation-id="${escapeHtml(subroute.conversationId)}" data-user-id="${escapeHtml(member.userId)}">Remove</button></div></div>`).join("") : '<div class="shared-page__empty">No room members found.</div>'}</div></div></article>
    </div>`;
  } else if (
    subroute.view === "room-permissions" ||
    subroute.view === "room-permission-role"
  ) {
    const selectedOverride = (permissionTarget.overrides || []).find(
      (entry) =>
        normalizeString(entry.subjectId) === normalizeString(subroute.roleId),
    );
    bodyMarkup = `<div class="shared-stack">
      <article class="shared-card"><div class="shared-card__body"><div class="shared-card__meta"><span>${escapeHtml(permissionTarget.syncState || "standalone")}</span>${permissionTarget.inheritedFromCategoryId ? `<span>${escapeHtml(`Inherited from ${permissionTarget.inheritedFromCategoryId}`)}</span>` : ""}</div><h3>${escapeHtml(conversation.item?.title || "Channel permissions")}</h3><p>${escapeHtml(selectedOverride ? `Showing override for ${selectedOverride.roleName || selectedOverride.subjectId}.` : "Inspect the active permission overrides for this room.")}</p><div class="shared-card__actions">${permissionTarget.canManage ? `<button class="shared-feed-chip shared-feed-chip--primary" data-action="messaging-permission-sync" data-conversation-id="${escapeHtml(subroute.conversationId)}">Sync from category</button>` : ""}</div></div></article>
      <article class="shared-card"><div class="shared-card__body"><h3>Overrides</h3><div class="shared-stack">${(permissionTarget.overrides || []).length ? permissionTarget.overrides.map((entry) => `<button class="shared-list-item${normalizeString(entry.subjectId) === normalizeString(subroute.roleId) ? " is-active" : ""}" data-action="navigate" data-route="${escapeHtml(buildMessagingRoomRoute(subroute.scopeType, subroute.scopeId, subroute.conversationId, `/settings/permissions/roles/${encodeURIComponent(normalizeString(entry.subjectId))}`))}"><strong>${escapeHtml(entry.roleName || entry.subjectId || "Override")}</strong><span>${escapeHtml(entry.roleColor || "")}</span></button>`).join("") : '<div class="shared-page__empty">No explicit overrides.</div>'}</div></div></article>
      ${
        selectedOverride
          ? `<article class="shared-card"><div class="shared-card__body"><h3>${escapeHtml(selectedOverride.roleName || "Override detail")}</h3><div class="shared-card__meta">${
              Object.entries(selectedOverride.permissions || {})
                .filter(
                  ([, value]) =>
                    normalizeString(value) &&
                    normalizeString(value) !== "inherit",
                )
                .map(
                  ([key, value]) =>
                    `<span>${escapeHtml(`${humanizeLabel(key)}: ${humanizeLabel(value)}`)}</span>`,
                )
                .join("") || "<span>No non-inherited permissions.</span>"
            }</div></div></article>`
          : ""
      }
    </div>`;
  } else if (subroute.view === "unsupported") {
    bodyMarkup = `<div class="shared-page__empty">This messaging route is not recognized by the browser shell yet.</div>`;
  } else {
    bodyMarkup = `<div class="shared-page__split">
      <div class="shared-page__sidebar">
        <div class="shared-stack">
          <button class="shared-list-item is-active" data-action="navigate" data-route="/messages">Inbox</button>
          <button class="shared-list-item" data-action="navigate" data-route="/messages/requests">Requests</button>
          <button class="shared-list-item" data-action="navigate" data-route="/messages/compose">Compose</button>
          <button class="shared-list-item" data-action="navigate" data-route="/messages/settings">Settings</button>
        </div>
      </div>
      <div class="shared-page__main">
        <div class="shared-page__header">
          <div>
            <p class="shared-page__eyebrow">Inbox</p>
            <h1>Messages</h1>
            <p>${escapeHtml(messaging.socket.connectionState === "connected" ? "Realtime connected." : "Connecting to messaging gateway…")}</p>
          </div>
        </div>
        <div class="shared-stack">${inboxButtons || '<div class="shared-page__empty">No conversations yet.</div>'}</div>
        <h2>Servers</h2>
        <div class="shared-card-grid">${serverCards || '<div class="shared-page__empty">No servers available.</div>'}</div>
      </div>
    </div>`;
  }

  return `<section class="shared-page">
    ${renderTopChrome()}
    <div class="shared-page__content">
      ${
        messaging.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.error)}</div>`
          : ""
      }
      ${messaging.loading ? '<div class="shared-page__loading">Loading messaging…</div>' : ""}
      ${
        messaging.serverDirectory.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.serverDirectory.error)}</div>`
          : ""
      }
      ${
        messaging.serverSettings.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.serverSettings.error)}</div>`
          : ""
      }
      ${
        messaging.serverRoles.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.serverRoles.error)}</div>`
          : ""
      }
      ${
        messaging.serverMembers.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.serverMembers.error)}</div>`
          : ""
      }
      ${
        messaging.serverBans.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.serverBans.error)}</div>`
          : ""
      }
      ${
        messaging.roomMembers.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.roomMembers.error)}</div>`
          : ""
      }
      ${
        messaging.permissionTarget.error
          ? `<div class="shared-page__error">${escapeHtml(messaging.permissionTarget.error)}</div>`
          : ""
      }
      ${bodyMarkup}
    </div>
  </section>`;
}

function renderRouteStage() {
  if (isProtectedRoute() && !state.auth.session) {
    return `<section class="shared-page">
      ${renderTopChrome()}
      <div class="shared-page__content">
        <div class="shared-page__empty">
          Sign in or create an account to use ${escapeHtml(humanizeLabel(getRouteSection()) || "this feature")} in the browser.
        </div>
        <div class="shared-auth-modal__actions">
          <button class="shared-feed-chip shared-feed-chip--primary" data-action="auth-login-inline">Sign in</button>
          <button class="shared-feed-chip" data-action="auth-signup-inline">Create account</button>
          <button class="shared-feed-chip" data-action="open-app-shell">Open app</button>
        </div>
      </div>
    </section>`;
  }
  const routeKey = getCurrentRoute().routeKey;
  if (isShareRoute()) {
    return renderFeedStage();
  }
  if (routeKey === ROUTE_KEY_FEED) {
    return renderFeedOverviewPage();
  }
  if (routeKey === ROUTE_KEY_CANDIDATES) {
    return renderCandidateListPage();
  }
  if (routeKey === ROUTE_KEY_OFFICIAL_DETAIL) {
    return renderOfficialDetailPage();
  }
  if (routeKey === ROUTE_KEY_AUTO_CANDIDATE_DETAIL) {
    return renderAutoCandidateDetailPage();
  }
  if (routeKey === ROUTE_KEY_OFFICIAL_REPORT_CARD) {
    return renderOfficialReportCardPage();
  }
  if (
    routeKey === ROUTE_KEY_CANDIDATE_DETAIL ||
    routeKey === ROUTE_KEY_CANDIDATE_EDIT
  ) {
    return renderCandidateDetailPage();
  }
  if (routeKey === ROUTE_KEY_EVENTS) {
    return renderEventsListPage();
  }
  if (routeKey === ROUTE_KEY_MANAGE_EVENTS) {
    return renderManageEventsPage();
  }
  if (
    routeKey === ROUTE_KEY_EVENT_DETAIL ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS_NEW ||
    routeKey === ROUTE_KEY_MANAGE_EVENTS_EDIT
  ) {
    return renderEventDetailPage();
  }
  if (
    routeKey === ROUTE_KEY_PROFILE_SELF ||
    routeKey === ROUTE_KEY_PROFILE_USER ||
    routeKey === ROUTE_KEY_PROFILE_EDIT
  ) {
    return renderProfilePage();
  }
  if (routeKey === ROUTE_KEY_PROFILE_CONNECTIONS) {
    return renderProfileConnectionsPage();
  }
  if (routeKey === ROUTE_KEY_PROFILE_NOTIFICATIONS) {
    return renderProfileNotificationsPage();
  }
  if (
    routeKey === ROUTE_KEY_MESSAGES_ROOT ||
    routeKey === ROUTE_KEY_MESSAGES_WILDCARD
  ) {
    return renderMessagingPage();
  }
  return `<section class="shared-page">${renderTopChrome()}<div class="shared-page__content"><div class="shared-page__empty">This route is not available yet.</div></div></section>`;
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
              : comments ||
                `<div class="shared-comments__empty">No comments yet.</div>`
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

function renderAuthModalModeControls(modal) {
  if (!modal) {
    return "";
  }
  const isConfirm = modal.mode === "confirm";
  return `<div class="shared-auth-modal__modes">
    <button class="shared-feed-chip${modal.mode === "login" ? " shared-feed-chip--primary" : ""}" data-action="auth-switch-mode" data-auth-mode="login">Sign in</button>
    <button class="shared-feed-chip${modal.mode === "signup" || isConfirm ? " shared-feed-chip--primary" : ""}" data-action="auth-switch-mode" data-auth-mode="signup">Create account</button>
    ${
      isConfirm
        ? '<button class="shared-feed-chip" data-action="auth-switch-mode" data-auth-mode="confirm" disabled>Confirm code</button>'
        : ""
    }
  </div>`;
}

function renderAuthModalStatus(modal) {
  if (!modal) {
    return "";
  }
  const errorMarkup = modal.error
    ? `<div class="shared-auth-modal__status shared-auth-modal__status--error">${escapeHtml(modal.error)}</div>`
    : "";
  const noticeMarkup = modal.notice
    ? `<div class="shared-auth-modal__status shared-auth-modal__status--notice">${escapeHtml(modal.notice)}</div>`
    : "";
  return `${errorMarkup}${noticeMarkup}`;
}

function renderAuthModalLogin(modal) {
  const capabilities =
    modal?.capabilities || getSharedFeedAuthCapabilities(state.auth.config);
  if (!capabilities.password) {
    return `<div class="shared-auth-modal__fallback">
      <p>Password sign-in is not available for this web client right now.</p>
      ${
        capabilities.hosted
          ? `<div class="shared-auth-modal__actions">
              <button class="shared-feed-chip shared-feed-chip--primary" data-action="auth-start-hosted-login"${modal.pending ? " disabled" : ""}>Continue in browser</button>
            </div>`
          : ""
      }
    </div>`;
  }

  return `<form class="shared-auth-modal__form" data-route-form="auth-login">
    <label>
      <span>Username or email</span>
      <input data-auth-field="identifier" name="identifier" autocomplete="username" value="${escapeHtml(modal.fields.identifier)}" placeholder="you@example.com" />
    </label>
    <label>
      <span>Password</span>
      <input data-auth-field="password" type="password" name="password" autocomplete="current-password" value="${escapeHtml(modal.fields.password)}" placeholder="Password" />
    </label>
    <div class="shared-auth-modal__actions">
      <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${modal.pending ? " disabled" : ""}>${modal.pending ? "Signing in…" : "Sign in"}</button>
      ${
        capabilities.hosted
          ? `<button class="shared-feed-chip" type="button" data-action="auth-start-hosted-login"${modal.pending ? " disabled" : ""}>Use browser sign-in</button>`
          : ""
      }
    </div>
  </form>`;
}

function renderAuthModalSignup(modal) {
  const capabilities =
    modal?.capabilities || getSharedFeedAuthCapabilities(state.auth.config);
  if (!capabilities.direct) {
    return `<div class="shared-auth-modal__fallback">
      <p>Direct sign-up is not available for this web client right now.</p>
      ${
        capabilities.hosted
          ? `<div class="shared-auth-modal__actions">
              <button class="shared-feed-chip shared-feed-chip--primary" data-action="auth-start-hosted-signup"${modal.pending ? " disabled" : ""}>Use browser sign-up</button>
            </div>`
          : ""
      }
    </div>`;
  }

  return `<form class="shared-auth-modal__form" data-route-form="auth-signup">
    <label>
      <span>Email</span>
      <input data-auth-field="email" type="email" name="email" autocomplete="email" value="${escapeHtml(modal.fields.email)}" placeholder="you@example.com" />
    </label>
    <label>
      <span>Password</span>
      <input data-auth-field="signupPassword" type="password" name="password" autocomplete="new-password" value="${escapeHtml(modal.fields.signupPassword)}" placeholder="Use at least 8 characters" />
    </label>
    <label>
      <span>Confirm password</span>
      <input data-auth-field="confirmPassword" type="password" name="confirmPassword" autocomplete="new-password" value="${escapeHtml(modal.fields.confirmPassword)}" placeholder="Confirm password" />
    </label>
    <div class="shared-auth-modal__actions">
      <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${modal.pending ? " disabled" : ""}>${modal.pending ? "Creating…" : "Create account"}</button>
      ${
        capabilities.hosted
          ? `<button class="shared-feed-chip" type="button" data-action="auth-start-hosted-signup"${modal.pending ? " disabled" : ""}>Use browser sign-up</button>`
          : ""
      }
    </div>
  </form>`;
}

function renderAuthModalConfirm(modal) {
  const awaitingConfirmation = modal?.awaitingConfirmation || {};
  const destination =
    awaitingConfirmation.deliveryDestination ||
    awaitingConfirmation.email ||
    "your email";
  return `<div class="shared-auth-modal__confirm-copy">
      <p>We sent a 6-digit verification code to ${escapeHtml(destination)}. Enter it to finish signing up.</p>
    </div>
    <form class="shared-auth-modal__form" data-route-form="auth-confirm">
      <label>
        <span>6-digit code</span>
        <input data-auth-field="code" name="code" inputmode="numeric" autocomplete="one-time-code" value="${escapeHtml(modal.fields.code)}" placeholder="123456" />
      </label>
      <div class="shared-auth-modal__actions">
        <button class="shared-feed-chip shared-feed-chip--primary" type="submit"${modal.pending ? " disabled" : ""}>${modal.pending ? "Confirming…" : "Confirm"}</button>
        <button class="shared-feed-chip" type="button" data-action="auth-resend-code"${modal.pending ? " disabled" : ""}>Resend code</button>
      </div>
    </form>`;
}

function renderAuthModal() {
  const modal = state.ui.authModal;
  const stores = getStoreUrls();
  const capabilities =
    modal?.capabilities || getSharedFeedAuthCapabilities(state.auth.config);
  let bodyMarkup = "";

  if (modal?.mode === "confirm") {
    bodyMarkup = renderAuthModalConfirm(modal);
  } else if (modal?.mode === "signup") {
    bodyMarkup = renderAuthModalSignup(modal);
  } else if (modal) {
    bodyMarkup = renderAuthModalLogin(modal);
  }

  return `<div class="shared-auth-modal${modal ? " is-open" : ""}">
    <button class="shared-auth-modal__backdrop" data-action="close-auth-modal" aria-label="Close sign-in modal"></button>
    <section class="shared-auth-modal__dialog" aria-hidden="${modal ? "false" : "true"}">
      <p class="shared-auth-modal__eyebrow">Polis account</p>
      <h2>${escapeHtml(modal?.title || "Join Polis")}</h2>
      <p>${escapeHtml(modal?.message || "Sign in to unlock the full feed.")}</p>
      ${renderAuthModalModeControls(modal)}
      ${renderAuthModalStatus(modal)}
      ${bodyMarkup}
      <div class="shared-auth-modal__secondary">
        <button class="shared-feed-chip" data-action="auth-open-app" data-route="${escapeHtml(modal?.targetPath || "")}" data-post-id="${escapeHtml(modal?.postId || runtimeConfig.shareContext?.postId || runtimeConfig.postId || "")}">Open app instead</button>
        ${
          !capabilities.direct && !capabilities.hosted
            ? '<span class="shared-auth-modal__hint">Web auth is unavailable in this environment.</span>'
            : ""
        }
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

/**
 * Preserves immersive feed position across full rerenders by anchoring to the
 * active card instead of relying only on raw scrollTop.
 */
function snapshotFeedScrollState() {
  const scrollRoot = root?.querySelector("#shared-feed-scroll");
  if (!scrollRoot) {
    return null;
  }
  const activeCard = scrollRoot.querySelector(
    `[data-index="${String(state.activeIndex)}"]`,
  );
  return {
    scrollTop: scrollRoot.scrollTop,
    activeIndex: state.activeIndex,
    activeOffset: activeCard ? activeCard.offsetTop - scrollRoot.scrollTop : 0,
  };
}

function restoreFeedScrollState(snapshot = null) {
  if (!snapshot) {
    return;
  }
  const scrollRoot = root?.querySelector("#shared-feed-scroll");
  if (!scrollRoot) {
    return;
  }
  const activeCard = scrollRoot.querySelector(
    `[data-index="${String(snapshot.activeIndex)}"]`,
  );
  if (activeCard) {
    scrollRoot.scrollTop = Math.max(
      0,
      activeCard.offsetTop - (Number(snapshot.activeOffset) || 0),
    );
    return;
  }
  scrollRoot.scrollTop = Math.max(0, Number(snapshot.scrollTop) || 0);
}

function renderApp() {
  if (!root) {
    return;
  }

  ensureActiveIndexInBounds();
  const playbackSnapshot = snapshotPlaybackState();
  const scrollSnapshot = snapshotFeedScrollState();
  const shell = `<div class="shared-feed-shell">
    ${renderRail()}
    ${renderRouteStage()}
  </div>
  ${isShareRoute() ? renderCommentsPanel() : ""}
  ${renderAuthModal()}
  ${renderToast()}`;
  root.innerHTML = shell;
  restoreFeedScrollState(scrollSnapshot);
  bindObservers();
  bindVideos();
  bindEventsMap().catch(() => {});
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
  if (routeEndObserver) {
    routeEndObserver.disconnect();
  }
  const items = Array.from(root.querySelectorAll(".shared-feed-item"));
  if (items.length) {
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) => right.intersectionRatio - left.intersectionRatio,
          )[0];
        if (!visible) {
          return;
        }
        const nextIndex = Number(
          visible.target.getAttribute("data-index") || 0,
        );
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

  const candidateListSentinel = root.querySelector(
    "[data-candidate-list-sentinel]",
  );
  if (!candidateListSentinel || typeof IntersectionObserver !== "function") {
    return;
  }

  routeEndObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      loadMoreCandidateList().catch(() => {});
    },
    {
      root: null,
      rootMargin: "0px 0px 320px 0px",
      threshold: 0,
    },
  );
  routeEndObserver.observe(candidateListSentinel);
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
    video.addEventListener("loadedmetadata", () =>
      updateScrubber(postId, video),
    );
    video.addEventListener("play", () => {
      const indicator = root.querySelector(
        `[data-playback-indicator="${CSS.escape(postId)}"]`,
      );
      indicator?.classList.remove("is-visible");
    });
    video.addEventListener("pause", () => {
      const index = Number(
        video.closest(".shared-feed-item")?.getAttribute("data-index") || -1,
      );
      const indicator = root.querySelector(
        `[data-playback-indicator="${CSS.escape(postId)}"]`,
      );
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
  const slider = root.querySelector(
    `[data-scrubber-input="${CSS.escape(postId)}"]`,
  );
  const time = root.querySelector(
    `[data-scrubber-time="${CSS.escape(postId)}"]`,
  );
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
  const capabilities = getSharedFeedAuthCapabilities(state.auth.config);
  if (!capabilities.direct && !capabilities.hosted) {
    openAuthModal("auth_unavailable", {
      mode: action === "signup" ? "signup" : "login",
    });
    return;
  }
  openAuthModal(action === "signup" ? "signup" : "login", {
    mode: action === "signup" ? "signup" : "login",
  });
}

function normalizeAuthErrorMessage(error, fallbackMessage) {
  if (error instanceof SharedFeedAuthError) {
    return normalizeString(error.message) || fallbackMessage;
  }
  return normalizeString(error?.message) || fallbackMessage;
}

async function startHostedModalAuth(mode) {
  const modal = state.ui.authModal;
  if (!modal) {
    return;
  }
  if (!hasHostedSignInConfig(state.auth.config)) {
    setAuthModalError("Hosted sign-in is not configured for this environment.");
    return;
  }
  setAuthModalPending(true);
  try {
    setSharedFeedPostAuthPath(modal.targetPath || getCurrentPathWithQuery());
    if (mode === "signup") {
      await startHostedSignUp(state.auth.config, {
        postAuthPath: modal.targetPath,
      });
    } else {
      await startHostedSignIn(state.auth.config, {
        postAuthPath: modal.targetPath,
      });
    }
  } catch (error) {
    setAuthModalError(
      normalizeAuthErrorMessage(error, "Sign-in could not be started."),
    );
  }
}

async function submitAuthLoginForm(formData) {
  const modal = state.ui.authModal;
  if (!modal) {
    return;
  }
  const identifier = normalizeString(formData.get("identifier"));
  const password = String(formData.get("password") || "");
  if (!identifier || !password) {
    setAuthModalError("Username/email and password are required.");
    return;
  }

  setAuthModalPending(true);
  try {
    const { session, user } = await signInSharedFeedWithPassword(
      state.auth.config,
      {
        identifier,
        password,
      },
    );
    await finalizeAuthSuccess({
      session,
      user,
      targetPath: modal.targetPath,
      toastMessage: `Signed in as ${user?.displayName || "your account"}.`,
    });
  } catch (error) {
    if (
      error instanceof SharedFeedAuthError &&
      error.errorCode === "user_not_confirmed"
    ) {
      setAuthModalAwaitingConfirmation({
        username: normalizeString(error.payload?.cognitoUsername) || identifier,
        email: identifier.includes("@") ? identifier : "",
        password,
        deliveryDestination: identifier.includes("@") ? identifier : "",
      });
      setAuthModalNotice(
        "Your account still needs verification. Enter the code from your email to finish signing up.",
      );
      return;
    }
    setAuthModalError(normalizeAuthErrorMessage(error, "Sign-in failed."));
  }
}

async function submitAuthSignupForm(formData) {
  const modal = state.ui.authModal;
  if (!modal) {
    return;
  }
  const email = normalizeString(formData.get("email")).toLowerCase();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!email || !email.includes("@")) {
    setAuthModalError("Enter a valid email address.");
    return;
  }
  if (password.length < 8) {
    setAuthModalError("Password must be at least 8 characters.");
    return;
  }
  if (password !== confirmPassword) {
    setAuthModalError("Passwords do not match.");
    return;
  }

  setAuthModalPending(true);
  try {
    const result = await signUpSharedFeedWithEmail(state.auth.config, {
      email,
      password,
    });
    if (result.nextStep === "confirmCode" || result.isComplete !== true) {
      setAuthModalAwaitingConfirmation({
        username: result.username,
        email,
        password,
        deliveryDestination: result.deliveryDestination,
      });
      setAuthModalNotice(
        `We sent a code to ${result.deliveryDestination || email}.`,
      );
      return;
    }

    const { session, user } = await signInSharedFeedWithPassword(
      state.auth.config,
      {
        identifier: result.username || email,
        password,
      },
    );
    await finalizeAuthSuccess({
      session,
      user,
      targetPath: modal.targetPath,
      toastMessage: `Signed in as ${user?.displayName || "your account"}.`,
    });
  } catch (error) {
    setAuthModalError(normalizeAuthErrorMessage(error, "Sign-up failed."));
  }
}

async function submitAuthConfirmForm(formData) {
  const modal = state.ui.authModal;
  const awaitingConfirmation = modal?.awaitingConfirmation;
  if (!modal || !awaitingConfirmation?.username) {
    setAuthModalError(
      "Start sign-up again to request a new verification code.",
    );
    return;
  }
  const code = normalizeString(formData.get("code"));
  if (code.length !== 6) {
    setAuthModalError("Enter the 6-digit code.");
    return;
  }

  setAuthModalPending(true);
  try {
    await confirmSharedFeedSignUp(state.auth.config, {
      username: awaitingConfirmation.username,
      code,
    });
    const { session, user } = await signInSharedFeedWithPassword(
      state.auth.config,
      {
        identifier: awaitingConfirmation.username || awaitingConfirmation.email,
        password: awaitingConfirmation.password,
      },
    );
    await finalizeAuthSuccess({
      session,
      user,
      targetPath: modal.targetPath,
      toastMessage: `Signed in as ${user?.displayName || "your account"}.`,
    });
  } catch (error) {
    setAuthModalError(
      normalizeAuthErrorMessage(error, "Account confirmation failed."),
    );
  }
}

async function resendAuthConfirmationCode() {
  const awaitingConfirmation = state.ui.authModal?.awaitingConfirmation;
  if (!awaitingConfirmation?.username) {
    setAuthModalError(
      "Start sign-up again to request a new verification code.",
    );
    return;
  }
  setAuthModalPending(true);
  try {
    const result = await resendSharedFeedSignUpCode(state.auth.config, {
      username: awaitingConfirmation.username,
    });
    patchAuthModal((modal) => ({
      ...modal,
      pending: false,
      error: "",
      notice: `We sent a fresh code to ${result.deliveryDestination || awaitingConfirmation.email || "your email"}.`,
      awaitingConfirmation: {
        ...modal.awaitingConfirmation,
        deliveryDestination:
          normalizeString(result.deliveryDestination) ||
          modal.awaitingConfirmation?.deliveryDestination ||
          null,
      },
      fields: {
        ...modal.fields,
        code: "",
      },
    }));
  } catch (error) {
    setAuthModalError(
      normalizeAuthErrorMessage(
        error,
        "Could not resend the verification code.",
      ),
    );
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

  if (action === "navigate") {
    navigateWithAuthGate(target.getAttribute("data-route"));
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

  if (action === "load-more-feed-grid") {
    loadMoreFeed(state.mode).catch(() => {});
    return;
  }

  if (action === "refresh-feed-grid") {
    if (state.mode === FEED_MODE_FOLLOWING) {
      loadFollowingFeed({ refresh: true }).catch(() => {});
      return;
    }
    loadInitialFeed({ refresh: true }).catch(() => {});
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

  if (action === "toggle-description") {
    const postId = normalizeString(target.getAttribute("data-post-id"));
    const item = getCurrentItems().find(
      (candidate) => candidate.postId === postId,
    );
    if (!item || !hasExpandablePostCopy(item)) {
      return;
    }
    state.ui.expandedPostId =
      normalizeString(state.ui.expandedPostId) === postId ? "" : postId;
    scheduleRender();
    return;
  }

  if (action === "open-app") {
    requestAppOpen(target.getAttribute("data-post-id"));
    return;
  }

  if (action === "open-app-shell") {
    if (isShareRoute() && state.feedContext.anchorPostId) {
      requestAppOpen(state.feedContext.anchorPostId);
      return;
    }
    const deepLinkTarget = buildDeepLinkOpenUrl(
      `${getCurrentRoute().routePath}${window.location.search}`,
    );
    if (!deepLinkTarget) {
      showToast("App link unavailable.");
      return;
    }
    window.location.assign(deepLinkTarget);
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

  if (action === "auth-switch-mode") {
    setAuthModalMode(target.getAttribute("data-auth-mode"));
    return;
  }

  if (action === "auth-start-hosted-login") {
    startHostedModalAuth("login").catch(() => {});
    return;
  }

  if (action === "auth-start-hosted-signup") {
    startHostedModalAuth("signup").catch(() => {});
    return;
  }

  if (action === "auth-resend-code") {
    resendAuthConfirmationCode().catch(() => {});
    return;
  }

  if (action === "close-auth-modal") {
    closeAuthModal();
    return;
  }

  if (action === "auth-open-app") {
    const targetRoute = normalizeString(target.getAttribute("data-route"));
    if (targetRoute) {
      const deepLinkTarget = buildDeepLinkOpenUrl(targetRoute);
      if (deepLinkTarget) {
        window.location.assign(deepLinkTarget);
        return;
      }
    }
    requestAppOpen(
      target.getAttribute("data-post-id") ||
        runtimeConfig.shareContext?.postId ||
        runtimeConfig.postId ||
        "",
    );
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
      requestLimit: 0,
    };
    state.pages.messaging.initialized = false;
    state.pages.messaging.bootstrap = null;
    state.pages.messaging.inbox = createPagedState();
    state.pages.messaging.requests = createPagedState();
    state.pages.messaging.servers = createPagedState();
    state.pages.messaging.conversation = createMessagingConversationState();
    state.pages.messaging.serverDirectory = createMessagingDetailState();
    state.pages.messaging.serverSettings = createMessagingDetailState(null, {
      saving: false,
    });
    state.pages.messaging.serverRoles = {
      items: [],
      selected: null,
      members: [],
      candidates: [],
      loading: false,
      error: "",
      loaded: false,
    };
    state.pages.messaging.serverMembers = {
      items: [],
      detail: null,
      loading: false,
      detailLoading: false,
      error: "",
      detailError: "",
      loaded: false,
    };
    state.pages.messaging.serverBans = createPagedState();
    state.pages.messaging.roomMembers = createPagedState();
    state.pages.messaging.permissionTarget = createMessagingDetailState(null, {
      bundle: null,
    });
    state.pages.messaging.devices = createPagedState();
    state.pages.messaging.deviceLink = {
      link: null,
      pending: false,
      error: "",
      lookupCode: "",
    };
    messagingSocket.releaseSession();
    messagingSessionRetained = false;
    closeAuthModal();
    showToast("Signed out.");
    if (isProtectedRoute()) {
      window.location.assign("/");
    }
    return;
  }

  if (action === "follow-author") {
    const postId = normalizeString(target.getAttribute("data-post-id"));
    const item = getCurrentItems().find(
      (candidate) => candidate.postId === postId,
    );
    if (item) {
      handleFollowAuthor(item).catch(() => {});
    }
    return;
  }

  if (action === "candidate-follow") {
    toggleCandidateFollow(
      target.getAttribute("data-candidate-id"),
      target.getAttribute("data-official-id"),
    ).catch(() => {
      showToast("Candidate follow failed.");
    });
    return;
  }

  if (action === "official-report-card-load-more") {
    const officialId =
      normalizeString(state.pages.candidates.reportCard.officialId) ||
      normalizeString(getCurrentRoute().routeParams.officialId);
    loadOfficialReportCard(officialId, { append: true }).catch(() => {
      showToast("Report card load failed.");
    });
    return;
  }

  if (action === "event-interest") {
    const eventId = normalizeString(target.getAttribute("data-event-id"));
    const eventItem =
      state.pages.events.detail.item?.eventId === eventId
        ? state.pages.events.detail.item
        : state.pages.events.list.items.find(
            (entry) => entry.eventId === eventId,
          ) ||
          state.pages.events.manage.items.find(
            (entry) => entry.eventId === eventId,
          );
    toggleEventInterested(eventId, eventItem?.isInterested === true).catch(
      () => {
        showToast("Event interest update failed.");
      },
    );
    return;
  }

  if (action === "event-attend") {
    const eventId = normalizeString(target.getAttribute("data-event-id"));
    const eventItem =
      state.pages.events.detail.item?.eventId === eventId
        ? state.pages.events.detail.item
        : state.pages.events.list.items.find(
            (entry) => entry.eventId === eventId,
          ) ||
          state.pages.events.manage.items.find(
            (entry) => entry.eventId === eventId,
          );
    toggleEventAttendance(eventId, eventItem?.isAttending === true).catch(
      () => {
        showToast("RSVP failed.");
      },
    );
    return;
  }

  if (action === "profile-follow") {
    toggleProfileFollow(target.getAttribute("data-user-id")).catch(() => {
      showToast("Follow failed.");
    });
    return;
  }

  if (action === "profile") {
    const userId = normalizeString(target.getAttribute("data-user-id"));
    if (userId) {
      navigateWithAuthGate(`/profile/${encodeURIComponent(userId)}`);
    }
    return;
  }

  if (action === "toggle-events-map") {
    state.pages.events.list.mapMode =
      normalizeString(target.getAttribute("data-map-mode")) === "map";
    scheduleRender();
    return;
  }

  if (action === "manage-events-status") {
    const status =
      normalizeString(target.getAttribute("data-status")) || "active";
    navigateWithAuthGate(`/manage-events?status=${encodeURIComponent(status)}`);
    return;
  }

  if (action === "profile-connections-kind") {
    const kind =
      normalizeString(target.getAttribute("data-kind")) || "followers";
    navigateWithAuthGate(
      `/profile/connections?kind=${encodeURIComponent(kind)}`,
    );
    return;
  }

  if (action === "notifications-read") {
    markNotificationsRead().catch(() => {
      showToast("Notification update failed.");
    });
    return;
  }

  if (action === "delete-event") {
    const eventId = normalizeString(target.getAttribute("data-event-id"));
    if (eventId && window.confirm("Delete this event?")) {
      deleteEventById(eventId).catch(() => {
        showToast("Event delete failed.");
      });
    }
    return;
  }

  if (action === "messaging-recovery-enroll") {
    startMessagingRecovery({ rotate: false }).catch(() => {
      showToast("Recovery enrollment failed.");
    });
    return;
  }

  if (action === "messaging-recovery-rotate") {
    startMessagingRecovery({ rotate: true }).catch(() => {
      showToast("Recovery rotation failed.");
    });
    return;
  }

  if (action === "messaging-recovery-verify") {
    verifyMessagingRecovery().catch(() => {
      showToast("Recovery verification failed.");
    });
    return;
  }

  if (action === "messaging-request-accept") {
    acceptMessagingRequest(target.getAttribute("data-request-id")).catch(() => {
      showToast("Request accept failed.");
    });
    return;
  }

  if (action === "messaging-request-refuse") {
    refuseMessagingRequest(target.getAttribute("data-request-id")).catch(() => {
      showToast("Request refuse failed.");
    });
    return;
  }

  if (action === "messaging-device-revoke") {
    const deviceId = normalizeString(target.getAttribute("data-device-id"));
    if (deviceId && window.confirm("Revoke this device?")) {
      revokeMessagingDevice(deviceId).catch(() => {
        showToast("Device revoke failed.");
      });
    }
    return;
  }

  if (action === "messaging-device-link-start") {
    startMessagingDeviceLink().catch(() => {
      showToast("Device-link start failed.");
    });
    return;
  }

  if (action === "messaging-device-link-refresh") {
    loadMessagingDeviceLink(
      target.getAttribute("data-link-id") ||
        state.pages.messaging.deviceLink.link?.linkId,
    ).catch(() => {
      showToast("Device-link refresh failed.");
    });
    return;
  }

  if (action === "messaging-device-link-approve") {
    approveMessagingDeviceLink().catch(() => {
      showToast("Device approval failed.");
    });
    return;
  }

  if (action === "messaging-member-ban") {
    const scopeType = normalizeString(target.getAttribute("data-scope-type"));
    const scopeId = normalizeString(target.getAttribute("data-scope-id"));
    const userId = normalizeString(target.getAttribute("data-user-id"));
    if (!scopeType || !scopeId || !userId) {
      return;
    }
    const reason = normalizeString(window.prompt("Ban reason", ""));
    banMessagingServerMember(scopeType, scopeId, userId, reason).catch(() => {
      showToast("Member ban failed.");
    });
    return;
  }

  if (action === "messaging-member-unban") {
    unbanMessagingServerMember(
      target.getAttribute("data-scope-type"),
      target.getAttribute("data-scope-id"),
      target.getAttribute("data-user-id"),
    ).catch(() => {
      showToast("Member unban failed.");
    });
    return;
  }

  if (action === "messaging-member-remove") {
    const scopeType = normalizeString(target.getAttribute("data-scope-type"));
    const scopeId = normalizeString(target.getAttribute("data-scope-id"));
    const userId = normalizeString(target.getAttribute("data-user-id"));
    if (
      scopeType &&
      scopeId &&
      userId &&
      window.confirm("Remove this member?")
    ) {
      removeMessagingServerMember(scopeType, scopeId, userId).catch(() => {
        showToast("Member remove failed.");
      });
    }
    return;
  }

  if (action === "messaging-room-member-remove") {
    const conversationId = normalizeString(
      target.getAttribute("data-conversation-id"),
    );
    const userId = normalizeString(target.getAttribute("data-user-id"));
    if (
      conversationId &&
      userId &&
      window.confirm("Remove this room member?")
    ) {
      removeMessagingConversationMember(conversationId, userId).catch(() => {
        showToast("Room-member remove failed.");
      });
    }
    return;
  }

  if (action === "messaging-permission-sync") {
    syncMessagingPermissionTargetFromCategory(
      target.getAttribute("data-conversation-id"),
    ).catch(() => {
      showToast("Permission sync failed.");
    });
    return;
  }

  if (action === "top-action") {
    const path = normalizeString(target.getAttribute("data-route"));
    const key = normalizeString(target.getAttribute("data-top-key"));
    if (path) {
      navigateWithAuthGate(path);
      return;
    }
    if (key === "search") {
      const query = normalizeString(
        window.prompt("Search Polis", readCurrentSearchParams().get("q") || ""),
      );
      if (!query) {
        return;
      }
      if (getRouteSection() === "events") {
        navigateWithAuthGate(`/events?q=${encodeURIComponent(query)}`);
        return;
      }
      navigateWithAuthGate(`/candidates?q=${encodeURIComponent(query)}`);
    }
    return;
  }

  if (action === "toggle-volume") {
    state.userHasInteracted = !state.userHasInteracted;
    Array.from(
      root?.querySelectorAll("video[data-video-post-id]") || [],
    ).forEach((video) => {
      video.muted = !state.userHasInteracted;
    });
    updateVolumeButtons();
    return;
  }

  if (action === "toggle-play") {
    const postId = normalizeString(target.getAttribute("data-post-id"));
    const video = root.querySelector(
      `video[data-video-post-id="${CSS.escape(postId)}"]`,
    );
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
  const authField = event.target.closest("[data-auth-field]");
  if (authField && state.ui.authModal) {
    const fieldName = normalizeString(
      authField.getAttribute("data-auth-field"),
    );
    if (fieldName) {
      // Keep auth form state in sync without rerendering the whole shell on
      // every keystroke, which would recreate the input and drop focus.
      state.ui.authModal.fields = {
        ...state.ui.authModal.fields,
        [fieldName]: authField.value,
      };
    }
    return;
  }

  const messageInput = event.target.closest(
    '[data-route-form="messaging-send"] input[name="text"]',
  );
  if (messageInput) {
    const conversationId = normalizeString(
      root?.querySelector(
        '[data-route-form="messaging-send"] input[name="conversationId"]',
      )?.value,
    );
    if (conversationId) {
      messagingSocket.typingStart(conversationId);
      window.clearTimeout(messagingTypingStopTimer);
      messagingTypingStopTimer = window.setTimeout(() => {
        messagingSocket.typingStop(conversationId);
      }, 3000);
    }
  }

  const slider = event.target.closest("[data-scrubber-input]");
  if (!slider) {
    return;
  }
  const postId = normalizeString(slider.getAttribute("data-scrubber-input"));
  const video = root.querySelector(
    `video[data-video-post-id="${CSS.escape(postId)}"]`,
  );
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }
  const fraction = Number(slider.value) / 1000;
  video.currentTime = Math.max(0, Math.min(1, fraction)) * video.duration;
  updateScrubber(postId, video);
}

function handleCommentSubmit(event) {
  const routeForm = event.target.closest("[data-route-form]");
  if (routeForm) {
    event.preventDefault();
    const formData = new FormData(routeForm);
    const formKind = normalizeString(routeForm.getAttribute("data-route-form"));
    if (formKind === "auth-login") {
      submitAuthLoginForm(formData).catch(() => {});
      return;
    }
    if (formKind === "auth-signup") {
      submitAuthSignupForm(formData).catch(() => {});
      return;
    }
    if (formKind === "auth-confirm") {
      submitAuthConfirmForm(formData).catch(() => {});
      return;
    }
    if (formKind === "candidates-filter") {
      const query = new URLSearchParams();
      ["q", "level", "district", "tags"].forEach((key) => {
        const value = normalizeString(formData.get(key));
        if (value) {
          query.set(key, value);
        }
      });
      navigateTo(
        `/candidates${query.toString() ? `?${query.toString()}` : ""}`,
      );
      return;
    }
    if (formKind === "candidate-edit") {
      saveCandidateFromForm(formData).catch(() => {});
      return;
    }
    if (formKind === "events-filter") {
      const query = new URLSearchParams();
      ["q", "town", "tags"].forEach((key) => {
        const value = normalizeString(formData.get(key));
        if (value) {
          query.set(key, value);
        }
      });
      if (formData.get("includePast")) {
        query.set("includePast", "true");
      }
      navigateTo(`/events${query.toString() ? `?${query.toString()}` : ""}`);
      return;
    }
    if (formKind === "event-edit") {
      saveEventFromForm(formData, {
        mode: normalizeString(formData.get("mode")) || "create",
      }).catch(() => {});
      return;
    }
    if (formKind === "profile-edit") {
      saveProfileFromForm(formData).catch(() => {});
      return;
    }
    if (formKind === "messaging-compose") {
      createMessagingDm(formData).catch(() => {});
      return;
    }
    if (formKind === "messaging-device-link-lookup") {
      lookupMessagingDeviceLink(formData).catch(() => {});
      return;
    }
    if (formKind === "messaging-server-settings-preferences") {
      updateMessagingServerNotificationLevel(
        normalizeString(formData.get("scopeType")),
        normalizeString(formData.get("scopeId")),
        normalizeString(formData.get("notificationLevel")),
      ).catch(() => {
        showToast("Server preference update failed.");
      });
      return;
    }
    if (formKind === "messaging-room-member-add") {
      addMessagingConversationMember(formData).catch(() => {});
      routeForm.reset();
      return;
    }
    if (formKind === "messaging-server-members-filter") {
      const scopeType = normalizeString(formData.get("scopeType"));
      const scopeId = normalizeString(formData.get("scopeId"));
      const queryValue = normalizeString(formData.get("query"));
      const query = new URLSearchParams();
      if (queryValue) {
        query.set("query", queryValue);
      }
      navigateTo(
        `${buildMessagingServerRoute(scopeType, scopeId, "/members")}${query.toString() ? `?${query.toString()}` : ""}`,
      );
      return;
    }
    if (formKind === "messaging-send") {
      sendMessagingDraft(
        normalizeString(formData.get("conversationId")),
        normalizeString(formData.get("text")),
      ).catch(() => {});
      routeForm.reset();
      return;
    }
    if (formKind === "messaging-recovery-restore") {
      restoreMessagingRecovery(formData).catch(() => {});
      return;
    }
  }

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
  const session =
    completed.handled && completed.session
      ? completed.session
      : await restoreSharedFeedSession(state.auth.config);
  state.auth.session = session;
  state.auth.user = getAuthenticatedUser(session);
  const postAuthPath = completed.handled ? consumeSharedFeedPostAuthPath() : "";
  if (completed.error) {
    state.auth.message = completed.error;
    showToast(completed.error);
  } else if (completed.handled && session) {
    showToast(
      `Signed in as ${state.auth.user?.displayName || "your account"}.`,
    );
    if (postAuthPath && postAuthPath !== getCurrentPathWithQuery()) {
      navigateTo(postAuthPath, { replace: true });
    }
  }
}

function attachGlobalListeners() {
  root?.addEventListener("click", handleRootClick);
  root?.addEventListener("input", handleRootInput);
  root?.addEventListener("submit", handleCommentSubmit);
  window.addEventListener("popstate", () => {
    state.route = parseRouteFromLocation(window.location.pathname);
    loadCurrentRoute().catch(() => {});
    scheduleRender();
  });
  window.addEventListener(
    "pointerdown",
    () => {
      if (!state.userHasInteracted) {
        state.userHasInteracted = true;
        Array.from(
          root?.querySelectorAll("video[data-video-post-id]") || [],
        ).forEach((video) => {
          video.muted = false;
        });
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
  await loadCurrentRoute({ refresh: true });
}

void init();
