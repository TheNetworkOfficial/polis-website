/* global __COGNITO_APP_CLIENT_ID__, __COGNITO_DOMAIN__, __COGNITO_ENABLE_PASSWORD_FLOW__, __COGNITO_REDIRECT_URI__, __COGNITO_REGION__, __COGNITO_SCOPES__, __POLIS_FILES_API_BASE_URL__ */

import "../../styles.css";
import "./css/files.css";
import polisLogoUrl from "../../assets/images/polis/Polis.png";
import {
  completeHostedSignIn,
  getAuthenticatedUser,
  hasHostedSignInConfig,
  restoreSharedFeedSession,
  setSharedFeedPostAuthPath,
  startHostedSignIn,
} from "../shared-feed/scripts/sharedFeedAuth.js";
import {
  FilesApi,
  FilesApiError,
  uploadSignedObject,
} from "./scripts/filesApi.js";
import {
  hasFilesEntitlement,
  hasFilesView,
  isFilesWorkspaceAccessible,
} from "./scripts/filesEntitlements.js";
import { checksumBlob } from "./scripts/sha256.js";

const root = document.getElementById("files-app");
const STORED_WORKSPACE_KEY = "polisFilesWorkspace.v1";
const STORED_LAYOUT_KEY = "polisFilesLayout.v1";
const STORED_UPLOADS_KEY = "polisFilesUploads.v1";
const UPLOAD_SCAN_POLL_LIMIT = 8;
const UPLOAD_SCAN_POLL_BASE_MS = 750;
const VIEW_PATHS = new Map([
  ["recent", "recent"],
  ["shared", "shared_with_me"],
  ["review", "needs_review"],
  ["recommended", "recommended"],
  ["uploads", "uploads"],
]);
const authConfig = {
  region: __COGNITO_REGION__,
  clientId: __COGNITO_APP_CLIENT_ID__,
  domain: __COGNITO_DOMAIN__,
  scopes: __COGNITO_SCOPES__,
  enablePasswordFlow: __COGNITO_ENABLE_PASSWORD_FLOW__,
  redirectUri: __COGNITO_REDIRECT_URI__,
};

const state = {
  status: "booting",
  contentStatus: "idle",
  session: null,
  user: null,
  error: "",
  workspaces: [],
  workspace: null,
  workspaceDescriptor: null,
  route: parseRoute(),
  layout: readStorage(STORED_LAYOUT_KEY) === "grid" ? "grid" : "list",
  search: "",
  sort: "updated_desc",
  items: [],
  cursor: "",
  folder: null,
  folderData: {
    assets: [],
    proposals: [],
    history: [],
    grants: [],
    editions: [],
  },
  suggestions: [],
  incomingGrantRequests: [],
  presets: [],
  selection: new Set(),
  uploadQueue: [],
  uploadControllers: new Map(),
  uploadPollTimers: new Map(),
  modal: null,
  toast: null,
  busyAction: "",
  mutationKeys: new Map(),
  postDraft: { open: false, description: "", usages: new Map() },
};

const api = new FilesApi({
  apiBaseUrl: __POLIS_FILES_API_BASE_URL__,
  getSession: () => state.session,
});
let shareSearchTimer = null;

function readStorage(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The app remains functional when private browsing blocks persistence.
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function normalizeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function firstArray(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function entityId(entity) {
  return normalizeString(
    entity?.assetId ||
      entity?.proposalId ||
      entity?.grantId ||
      entity?.editionId ||
      entity?.folderId ||
      entity?.id,
  );
}

function entityName(entity, fallback = "Untitled") {
  return normalizeString(
    entity?.name ||
      entity?.displayName ||
      entity?.title ||
      entity?.fileName ||
      fallback,
  );
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const amount = bytes / 1024 ** unit;
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function formatDate(value, { withTime = false } = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: withTime ? "numeric" : undefined,
    minute: withTime ? "2-digit" : undefined,
  }).format(date);
}

function initials(value) {
  return (
    normalizeString(value)
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "P"
  );
}

function parseRoute() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const query = new URLSearchParams(window.location.search);
  if (segments[0] !== "files")
    return { kind: "home", key: "home", tab: "current" };
  if (segments[1] === "grant-requests" && segments[2]) {
    return {
      kind: "view",
      key: "review",
      grantRequestId: decodeURIComponent(segments[2]),
      tab: "current",
    };
  }
  if (segments[1] === "folders" && segments[2]) {
    return {
      kind: "folder",
      key: "folder",
      folderId: decodeURIComponent(segments[2]),
      tab: ["current", "proposals", "history", "access"].includes(
        query.get("tab"),
      )
        ? query.get("tab")
        : "current",
    };
  }
  const key = VIEW_PATHS.has(segments[1]) ? segments[1] : "home";
  return { kind: "view", key, tab: "current" };
}

function routeTitle() {
  const labels = {
    home: "Files home",
    recent: "Recent",
    shared: "Shared with me",
    review: "Needs review",
    recommended: "Recommended",
    uploads: "Uploads",
  };
  return state.route.kind === "folder"
    ? entityName(state.folder, "Folder")
    : labels[state.route.key];
}

function principalOf(descriptor = state.workspaceDescriptor) {
  const principal = descriptor?.principal || {};
  const sourceType = normalizeString(principal.sourceType);
  return {
    type: sourceType || normalizeString(principal.type),
    id: normalizeString(
      sourceType === "official" ? principal.sourceId : principal.id,
    ),
  };
}

function capabilities() {
  return (
    state.workspace?.capabilities ||
    state.workspaceDescriptor?.capabilities ||
    {}
  );
}

function permissions() {
  return new Set(
    state.workspace?.permissions ||
      state.workspaceDescriptor?.permissions ||
      [],
  );
}

function can(capability, permission) {
  return Boolean(capabilities()?.[capability] || permissions().has(permission));
}

function workspaceFlags() {
  return (
    state.workspace?.featureFlags ||
    state.workspaceDescriptor?.featureFlags ||
    {}
  );
}

function workspaceLabel(descriptor) {
  const principal = descriptor?.principal || {};
  return entityName(
    principal,
    principal.type === "organization" ? "Organization" : "Political account",
  );
}

function isFolder(item) {
  const entityType = normalizeString(
    item?.entityType || item?.type || item?.kind,
  )
    .toLowerCase()
    .replace(/-/gu, "_");
  if (entityType) return entityType === "folder";
  return Boolean(
    item?.folderId &&
      !item?.assetId &&
      !item?.assetVersionId &&
      !item?.sourceAssetVersionId &&
      !item?.revisionId,
  );
}

function isMedia(item) {
  const mediaType = normalizeString(item?.mediaType).toLowerCase();
  if (["image", "video"].includes(mediaType)) return true;
  const mime = normalizeString(item?.mimeType || item?.contentType);
  return mime.startsWith("image/") || mime.startsWith("video/");
}

function assetIsReady(item) {
  const status = normalizeString(
    item?.state || item?.status || item?.scanStatus,
  ).toLowerCase();
  return status === "ready";
}

function isPostSelectableMedia(item) {
  return isMedia(item) && assetIsReady(item);
}

function folderIsRestricted() {
  const restriction = normalizeString(state.folder?.restriction)
    .toLowerCase()
    .replace(/-/gu, "_");
  return ["restricted", "highly_restricted"].includes(restriction);
}

function postProvenanceEnabled() {
  return Boolean(
    workspaceFlags().postProvenanceEnabled === true && !folderIsRestricted(),
  );
}

function folderUploadIntent(folder = state.folder) {
  const access = folder?.access;
  if (!access) {
    return can("canUpload", "files_upload") ? "commit" : null;
  }
  const accessPermissions = new Set(access.permissions || []);
  const canDirect = Boolean(
    access.capabilities?.canUpload === true ||
      accessPermissions.has("files_upload"),
  );
  const canPropose = Boolean(
    access.capabilities?.canPropose === true ||
      accessPermissions.has("files_propose"),
  );
  if (access.shared === true) {
    if (access.accessTier === "maintain" && canDirect) return "commit";
    return canPropose ? "proposal" : null;
  }
  if (canDirect || can("canUpload", "files_upload")) return "commit";
  if (canPropose || can("canPropose", "files_propose")) return "proposal";
  return null;
}

function currentUploadIntent() {
  if (state.route.kind === "folder" && state.folder) {
    return folderUploadIntent(state.folder);
  }
  return can("canUpload", "files_upload") ? "commit" : null;
}

function canOpenUpload() {
  return Boolean(
    currentUploadIntent() && workspaceFlags().uploadsEnabled === true,
  );
}

function icon(name, className = "") {
  const paths = {
    home: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3V11Z"/>',
    recent:
      '<path d="M12 4a8 8 0 1 1-7.4 5H2l3.4-4L9 9H6.7A6 6 0 1 0 12 6v4l3 2-1 1.7-4-2.7V4h2Z"/>',
    shared:
      '<path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20v-3c0-2.8 2.7-5 6-5s6 2.2 6 5v3H2Zm13 0v-3c0-1.6-.6-3-1.7-4.1.8-.6 1.7-.9 2.7-.9 3.3 0 6 2.2 6 5v3h-7Z"/>',
    review:
      '<path d="M5 3h14v18H5V3Zm3 4v2h8V7H8Zm0 4v2h5v-2H8Zm0 4v2h4v-2H8Zm6.5-.7-1.4 1.4 2.4 2.4 4.5-4.5-1.4-1.4-3.1 3.1-1-1Z"/>',
    spark:
      '<path d="m12 2 1.4 5.6L19 9l-5.6 1.4L12 16l-1.4-5.6L5 9l5.6-1.4L12 2Zm7 13 .8 3.2L23 19l-3.2.8L19 23l-.8-3.2L15 19l3.2-.8L19 15ZM5 14l.8 3.2L9 18l-3.2.8L5 22l-.8-3.2L1 18l3.2-.8L5 14Z"/>',
    upload:
      '<path d="M11 16h2V8l3 3 1.4-1.4L12 4.2 6.6 9.6 8 11l3-3v8Zm-6 4h14v-5h2v7H3v-7h2v5Z"/>',
    folder: '<path d="M2 5h8l2 2h10v13H2V5Zm2 4v9h16V9H4Z"/>',
    file: '<path d="M5 2h9l5 5v15H5V2Zm2 2v16h10V9h-5V4H7Zm7 .8V7h2.2L14 4.8Z"/>',
    image:
      '<path d="M3 4h18v16H3V4Zm2 2v12h14V6H5Zm2 9 3-4 2.5 3 2-2.5L18 16H6.3L7 15Zm8-7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
    video: '<path d="M3 5h13v14H3V5Zm2 2v10h9V7H5Zm13 3 4-3v10l-4-3v-4Z"/>',
    grid: '<path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z"/>',
    list: '<path d="M3 4h3v3H3V4Zm5 0h13v3H8V4ZM3 10h3v3H3v-3Zm5 0h13v3H8v-3ZM3 16h3v3H3v-3Zm5 0h13v3H8v-3Z"/>',
    search:
      '<path d="M10.5 3a7.5 7.5 0 1 1-4.7 13.3L2.1 20 3.5 21.4l3.8-3.8A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/>',
    settings:
      '<path d="M10.8 2h2.4l.5 2.1c.5.2 1 .5 1.4.8l2-.7 1.7 1.7-.7 2c.3.4.6.9.8 1.4l2.1.5v2.4l-2.1.5c-.2.5-.5 1-.8 1.4l.7 2-1.7 1.7-2-.7c-.4.3-.9.6-1.4.8l-.5 2.1h-2.4l-.5-2.1c-.5-.2-1-.5-1.4-.8l-2 .7-1.7-1.7.7-2c-.3-.4-.6-.9-.8-1.4L3 12.2V9.8l2.1-.5c.2-.5.5-1 .8-1.4l-.7-2 1.7-1.7 2 .7c.4-.3.9-.6 1.4-.8L10.8 2Zm1.2 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
    post: '<path d="M4 3h16v18H4V3Zm2 2v14h12V5H6Zm2 2h8v2H8V7Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z"/>',
    chevron: '<path d="m9 5 7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6L9 5Z"/>',
    close:
      '<path d="m5.6 4.2 6.4 6.4 6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4 1.4-1.4Z"/>',
    more: '<path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
    check: '<path d="m4 12 5 5L20 6l1.4 1.4L9 19.8 2.6 13.4 4 12Z"/>',
    archive:
      '<path d="M3 3h18v5H3V3Zm2 2v1h14V5H5Zm0 5h14v11H5V10Zm4 3v2h6v-2H9Z"/>',
  };
  return `<svg class="files-icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
}

function setToast(message, tone = "success") {
  state.toast = { message, tone };
  render();
  window.setTimeout(() => {
    if (state.toast?.message === message) {
      state.toast = null;
      render();
    }
  }, 4200);
}

function normalizeWorkspacePayload(payload) {
  return payload?.workspace || payload;
}

async function bootstrap() {
  render();
  try {
    await completeHostedSignIn(authConfig);
    state.session = await restoreSharedFeedSession(authConfig);
    if (!state.session) {
      purgeUploadCheckpoints();
      state.status = "signed-out";
      render();
      return;
    }
    state.user = getAuthenticatedUser(state.session);
    restoreUploadCheckpoints();
    await reconcileUploadCheckpoints();
    const discovery = await api.listWorkspaces();
    const discoveredWorkspaces = firstArray(discovery, ["workspaces", "items"]);
    if (!discoveredWorkspaces.length) {
      state.status = "no-workspaces";
      render();
      return;
    }
    const entitledWorkspaces = discoveredWorkspaces.filter(hasFilesEntitlement);
    if (!entitledWorkspaces.length) {
      state.status = "disabled";
      render();
      return;
    }
    state.workspaces = entitledWorkspaces.filter(isFilesWorkspaceAccessible);
    if (!state.workspaces.length) {
      state.status = "forbidden";
      render();
      return;
    }
    const preferredId = readStorage(STORED_WORKSPACE_KEY);
    const preferred =
      state.workspaces.find((item) => item.filesWorkspaceId === preferredId) ||
      state.workspaces[0];
    await selectWorkspace(preferred, { preserveRoute: true });
  } catch (error) {
    if ([401, 403].includes(error?.status)) purgeUploadCheckpoints();
    state.status = "error";
    state.error = error?.message || "Polis Files could not be opened.";
    render();
  }
}

async function selectWorkspace(descriptor, { preserveRoute = false } = {}) {
  state.workspaceDescriptor = descriptor;
  state.status = "loading-workspace";
  state.folder = null;
  state.items = [];
  state.selection.clear();
  render();
  const principal = principalOf(descriptor);
  if (!principal.type || !principal.id)
    throw new FilesApiError("This workspace is missing its owner.");
  const payload = await api.getWorkspace(principal.type, principal.id);
  state.workspace = normalizeWorkspacePayload(payload);
  state.workspaceDescriptor = { ...descriptor, ...state.workspace };
  writeStorage(
    STORED_WORKSPACE_KEY,
    state.workspace.filesWorkspaceId || descriptor.filesWorkspaceId || "",
  );
  if (!hasFilesEntitlement(state.workspace)) {
    state.status = "disabled";
    render();
    return;
  }
  if (!hasFilesView(state.workspace)) {
    purgeUploadCheckpoints();
    state.status = "forbidden";
    render();
    return;
  }
  state.status = "ready";
  const setup = state.workspace.setup || descriptor.setup || {};
  if (!setup.initialized) {
    await openSetup();
    return;
  }
  if (!preserveRoute) {
    window.history.pushState({}, "", "/files");
    state.route = parseRoute();
  }
  await loadRoute();
}

async function loadRoute() {
  if (state.status !== "ready") return;
  state.contentStatus = "loading";
  state.error = "";
  state.folder = null;
  render();
  try {
    if (state.route.kind === "folder") {
      await loadFolder(state.route.folderId, state.route.tab);
    } else if (state.route.key === "recommended") {
      await loadSuggestions();
      state.items = [];
    } else if (state.route.key === "uploads") {
      state.items = [];
    } else {
      const principal = principalOf();
      const view =
        state.route.key === "home"
          ? "my_files"
          : VIEW_PATHS.get(state.route.key);
      const payload = await api.listFolders(principal.type, principal.id, {
        view,
        search: state.search,
        sort: state.sort,
      });
      state.items = firstArray(payload, [
        "items",
        "folders",
        "assets",
        "results",
      ]);
      state.cursor = normalizeString(payload?.nextCursor || payload?.cursor);
      if (state.route.key === "home") await loadSuggestions({ quiet: true });
      if (state.route.key === "review") await loadIncomingGrantRequests();
      else state.incomingGrantRequests = [];
    }
    state.contentStatus = "ready";
  } catch (error) {
    state.contentStatus = "error";
    state.error = error?.message || "This Files view could not be loaded.";
  }
  render();
}

async function loadIncomingGrantRequests() {
  try {
    const payload = await api.listGrantRequests({
      status: "pending_recipient_acceptance",
    });
    state.incomingGrantRequests = firstArray(payload, [
      "grantRequests",
      "requests",
      "items",
    ]);
  } catch (error) {
    if (![403, 404].includes(error?.status)) throw error;
    state.incomingGrantRequests = [];
  }
}

async function loadFolder(folderId, tab) {
  const folderPayload = await api.getFolder(folderId);
  const folder = folderPayload?.folder || folderPayload;
  state.folder = {
    ...folder,
    ...(folderPayload?.access ? { access: folderPayload.access } : {}),
    version: folderPayload?.version || folder?.version,
    revision: folderPayload?.revision || folder?.revision,
  };
  const tasks = [api.listAssets(folderId), api.listEditions(folderId)];
  if (tab === "proposals") tasks.push(api.listProposals(folderId));
  if (tab === "history") tasks.push(api.listHistory(folderId));
  if (tab === "access") tasks.push(api.listGrants(folderId));
  const results = await Promise.all(tasks);
  state.folderData.assets = firstArray(results[0], [
    "assets",
    "items",
    "results",
  ]);
  state.folderData.editions = firstArray(results[1], [
    "editions",
    "items",
    "results",
  ]);
  if (tab === "proposals") {
    state.folderData.proposals = firstArray(results[2], [
      "proposals",
      "items",
      "results",
    ]);
  }
  if (tab === "history") {
    state.folderData.history = firstArray(results[2], [
      "history",
      "events",
      "items",
      "results",
    ]);
  }
  if (tab === "access") {
    state.folderData.grants = firstArray(results[2], [
      "grants",
      "access",
      "items",
      "results",
    ]);
  }
}

async function loadSuggestions({ quiet = false } = {}) {
  try {
    const principal = principalOf();
    const payload = await api.listSuggestions(principal.type, principal.id, {
      status: "pending",
    });
    state.suggestions = firstArray(payload, [
      "suggestions",
      "items",
      "results",
    ]);
  } catch (error) {
    if (!quiet) throw error;
    state.suggestions = [];
  }
}

function navigate(path) {
  window.history.pushState({}, "", path);
  state.route = parseRoute();
  state.selection.clear();
  state.postDraft.open = false;
  loadRoute();
}

function renderSignedOut() {
  const hosted = hasHostedSignInConfig(authConfig);
  return `<main class="files-gate">
    <img src="${polisLogoUrl}" alt="Polis" class="files-gate__logo" />
    <p class="files-eyebrow">Polis Files</p>
    <h1>Your campaign knowledge, ready when your team needs it.</h1>
    <p>Sign in to securely store, version, review, and share work across your authorized organizations and political accounts.</p>
    <button class="files-button files-button--primary" data-action="sign-in">${hosted ? "Sign in to Polis" : "Continue to sign in"}</button>
  </main>`;
}

function renderStatusPage(kind, title, body) {
  return `<main class="files-gate">
    <img src="${polisLogoUrl}" alt="Polis" class="files-gate__logo" />
    <p class="files-eyebrow">Polis Files</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    ${kind === "error" ? '<button class="files-button files-button--primary" data-action="retry">Try again</button>' : '<a class="files-button files-button--ghost" href="/feed">Back to Polis</a>'}
  </main>`;
}

function renderWorkspaceSwitcher() {
  const activeId =
    state.workspace?.filesWorkspaceId ||
    state.workspaceDescriptor?.filesWorkspaceId;
  return `<label class="files-workspace-switcher">
    <span class="sr-only">Files workspace</span>
    <span class="files-workspace-switcher__mark">${escapeHtml(initials(workspaceLabel(state.workspaceDescriptor)))}</span>
    <select data-action="switch-workspace" aria-label="Files workspace">
      ${state.workspaces
        .map(
          (workspace) =>
            `<option value="${escapeHtml(workspace.filesWorkspaceId)}" ${workspace.filesWorkspaceId === activeId ? "selected" : ""}>${escapeHtml(workspaceLabel(workspace))}</option>`,
        )
        .join("")}
    </select>
  </label>`;
}

function navItem({ path, key, label, iconName, badge = 0 }) {
  const active = state.route.key === key;
  return `<button class="files-nav__item ${active ? "is-active" : ""}" data-nav="${path}" ${active ? 'aria-current="page"' : ""}>
    ${icon(iconName)}<span>${escapeHtml(label)}</span>${badge ? `<span class="files-nav__badge" aria-label="${badge} pending">${badge > 99 ? "99+" : badge}</span>` : ""}
  </button>`;
}

function workspaceRoots() {
  return firstArray(state.workspace, ["roots"]).length
    ? state.workspace.roots
    : firstArray(state.workspaceDescriptor, ["roots"]);
}

function renderSidebar() {
  const pending =
    state.workspace?.pendingCounts ||
    state.workspaceDescriptor?.pendingCounts ||
    {};
  return `<aside class="files-sidebar" aria-label="Files navigation">
    <a href="/feed" class="files-brand" aria-label="Polis feed"><img src="${polisLogoUrl}" alt="" /><span>POLIS</span></a>
    ${renderWorkspaceSwitcher()}
    <nav class="files-nav">
      ${navItem({ path: "/files", key: "home", label: "Files home", iconName: "home" })}
      ${navItem({ path: "/files/recent", key: "recent", label: "Recent", iconName: "recent" })}
      ${navItem({ path: "/files/shared", key: "shared", label: "Shared with me", iconName: "shared" })}
      ${navItem({ path: "/files/review", key: "review", label: "Needs review", iconName: "review", badge: pending.needsReview || pending.proposals })}
      ${navItem({ path: "/files/recommended", key: "recommended", label: "Recommended", iconName: "spark", badge: pending.suggestions })}
      ${navItem({ path: "/files/uploads", key: "uploads", label: "Uploads", iconName: "upload", badge: state.uploadQueue.filter((item) => item.status === "uploading").length })}
    </nav>
    <div class="files-sidebar__section">
      <div class="files-sidebar__label"><span>Roots</span>${can("canManage", "files_manage") ? '<button data-action="new-folder" aria-label="New root folder">+</button>' : ""}</div>
      ${
        workspaceRoots()
          .map(
            (folder) =>
              `<button class="files-root-link" data-open-folder="${escapeHtml(entityId(folder))}">${icon("folder")}<span>${escapeHtml(entityName(folder))}</span></button>`,
          )
          .join("") || '<p class="files-sidebar__empty">No roots yet</p>'
      }
    </div>
    <div class="files-sidebar__footer">
      <button data-action="open-settings">${icon("settings")}<span>Files settings</span></button>
      <a href="/feed">← Back to Polis</a>
    </div>
  </aside>`;
}

function renderMobileNav() {
  return `<nav class="files-mobile-nav" aria-label="Files navigation">
    ${navItem({ path: "/files", key: "home", label: "Home", iconName: "home" })}
    ${navItem({ path: "/files/recent", key: "recent", label: "Recent", iconName: "recent" })}
    ${navItem({ path: "/files/shared", key: "shared", label: "Shared", iconName: "shared" })}
    ${navItem({ path: "/files/review", key: "review", label: "Review", iconName: "review" })}
    ${navItem({ path: "/files/recommended", key: "recommended", label: "For you", iconName: "spark" })}
  </nav>`;
}

function renderHeader() {
  const selected = state.selection.size;
  return `<header class="files-header">
    <div class="files-header__mobile-brand"><img src="${polisLogoUrl}" alt="Polis" />${renderWorkspaceSwitcher()}</div>
    <div class="files-header__title"><p class="files-eyebrow">${escapeHtml(workspaceLabel(state.workspaceDescriptor))}</p><h1>${escapeHtml(routeTitle())}</h1></div>
    <div class="files-header__actions">
      ${selected && postProvenanceEnabled() ? `<button class="files-button files-button--secondary" data-action="open-post">${icon("post")}Create post <span>${selected}</span></button>` : ""}
      ${canOpenUpload() ? `<button class="files-button files-button--primary" data-action="open-upload">${icon("upload")}${currentUploadIntent() === "proposal" ? "Upload for review" : "Upload"}</button>` : ""}
      <button class="files-avatar" data-action="open-settings" aria-label="Open Files settings">${escapeHtml(initials(state.user?.name || state.user?.email))}</button>
    </div>
  </header>`;
}

function renderToolbar({ count = state.items.length } = {}) {
  const selectable =
    state.route.kind === "folder" && state.route.tab === "current"
      ? state.folderData.assets.filter(isPostSelectableMedia)
      : [];
  const allSelected =
    selectable.length > 0 &&
    selectable.every((item) => state.selection.has(entityId(item)));
  return `<div class="files-toolbar">
    <form class="files-search" data-form="search" role="search">
      ${icon("search")}<label class="sr-only" for="files-search-input">Search this view</label>
      <input id="files-search-input" name="search" value="${escapeHtml(state.search)}" placeholder="Search names, context, or people" />
    </form>
    <span class="files-toolbar__count">${count} item${count === 1 ? "" : "s"}</span>
    ${selectable.length ? `<button class="files-toolbar__bulk" data-action="select-all" aria-pressed="${allSelected}">${allSelected ? "Clear selection" : "Select all media"}</button>${state.selection.size ? `<button class="files-toolbar__bulk" data-action="bulk-download">Download selected</button>` : ""}` : ""}
    <label class="files-sort"><span class="sr-only">Sort</span><select data-action="sort">
      <option value="updated_desc" ${state.sort === "updated_desc" ? "selected" : ""}>Last updated</option>
      <option value="name_asc" ${state.sort === "name_asc" ? "selected" : ""}>Name</option>
      <option value="created_desc" ${state.sort === "created_desc" ? "selected" : ""}>Newest</option>
    </select></label>
    <div class="files-layout-toggle" role="group" aria-label="Layout">
      <button data-layout="list" class="${state.layout === "list" ? "is-active" : ""}" aria-label="List view" aria-pressed="${state.layout === "list"}">${icon("list")}</button>
      <button data-layout="grid" class="${state.layout === "grid" ? "is-active" : ""}" aria-label="Grid view" aria-pressed="${state.layout === "grid"}">${icon("grid")}</button>
    </div>
  </div>`;
}

function safePostPath(path, postId = "") {
  const candidate = normalizeString(
    path || (postId ? `/posts/${encodeURIComponent(postId)}` : ""),
  );
  if (!candidate) return "";
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    if (!/^\/posts\/[^/]+/u.test(url.pathname)) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function usageBadges(item) {
  const folderUsageSetting = state.folder?.settings?.automations?.usageBadges;
  const workspaceUsageSetting =
    state.workspace?.settings?.automations?.usageBadges;
  if (
    !postProvenanceEnabled() ||
    folderUsageSetting === false ||
    (folderUsageSetting === undefined && workspaceUsageSetting === false)
  ) {
    return "";
  }
  const usages = firstArray(item, ["usage", "usages", "postUsages"]).filter(
    (usage) => {
      const explicitlyPublished = Boolean(
        usage?.isPublished === true ||
          normalizeString(usage?.status).toLowerCase() === "published" ||
          normalizeString(usage?.publicationStatus).toLowerCase() ===
            "published",
      );
      return explicitlyPublished && usage?.canViewUsage === true;
    },
  );
  if (!usages.length) return "";
  return `<div class="files-usage-badges" aria-label="Post usage">${usages
    .slice(0, 3)
    .map((usage) => {
      const org = entityName(
        usage?.organization ||
          usage?.principal ||
          (usage?.organizationDisplayName
            ? { displayName: usage.organizationDisplayName }
            : usage),
        "Posted",
      );
      const path =
        usage?.canOpenPost === true
          ? safePostPath(usage?.postPath || usage?.postUrl, usage?.postId)
          : "";
      const badge = `<span class="files-usage-badge"><span>${escapeHtml(initials(org))}</span>${escapeHtml(org)} used this</span>`;
      return path ? `<a href="${escapeHtml(path)}">${badge}</a>` : badge;
    })
    .join("")}</div>`;
}

function itemThumbnail(item) {
  if (isFolder(item))
    return `<div class="files-item__thumb files-item__thumb--folder">${icon("folder")}</div>`;
  const preview = normalizeString(item?.thumbnailUrl || item?.previewUrl);
  if (preview && isMedia(item)) {
    return `<div class="files-item__thumb"><img src="${escapeHtml(preview)}" alt="" loading="lazy" /></div>`;
  }
  const mime = normalizeString(item?.mimeType || item?.contentType);
  return `<div class="files-item__thumb files-item__thumb--file">${icon(mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "file")}</div>`;
}

function renderItem(item) {
  const id = entityId(item);
  const folder = isFolder(item);
  const selected = state.selection.has(id);
  const edition = entityName(
    item?.edition,
    normalizeString(item?.editionLabel || item?.versionLabel),
  );
  return `<article class="files-item ${selected ? "is-selected" : ""}" data-kind="${folder ? "folder" : "asset"}">
    ${!folder && isPostSelectableMedia(item) ? `<label class="files-item__select"><span class="sr-only">Select ${escapeHtml(entityName(item))}</span><input type="checkbox" data-select-asset="${escapeHtml(id)}" ${selected ? "checked" : ""} /></label>` : ""}
    <button class="files-item__open" ${folder ? `data-open-folder="${escapeHtml(id)}"` : isPostSelectableMedia(item) ? `data-select-asset="${escapeHtml(id)}"` : "disabled"} aria-label="${folder ? "Open" : isPostSelectableMedia(item) ? (selected ? "Deselect" : "Select") : "Preview unavailable for"} ${escapeHtml(entityName(item))}">
      ${itemThumbnail(item)}
      <span class="files-item__body"><strong>${escapeHtml(entityName(item))}</strong><span>${folder ? `${Number(item?.itemCount || item?.assetCount || 0)} items` : `${escapeHtml(formatBytes(item?.size || item?.sizeBytes))}${edition ? ` · ${escapeHtml(edition)}` : ""}`}</span></span>
    </button>
    <div class="files-item__meta"><span>${escapeHtml(formatDate(item?.updatedAt || item?.createdAt))}</span>${usageBadges(item)}</div>
    <button class="files-item__more" data-action="item-menu" data-item-id="${escapeHtml(id)}" aria-label="More actions for ${escapeHtml(entityName(item))}">${icon("more")}</button>
  </article>`;
}

function renderItems(
  items = state.items,
  emptyTitle = "Nothing here yet",
  emptyBody = "Items will appear here as your team adds and shares them.",
) {
  if (state.contentStatus === "loading") return renderSkeletons();
  if (state.contentStatus === "error") return renderInlineError();
  if (!items.length) return renderEmpty(emptyTitle, emptyBody);
  return `<div class="files-items files-items--${state.layout}">${items.map(renderItem).join("")}</div>`;
}

function renderSkeletons() {
  return `<div class="files-items files-items--${state.layout}" aria-busy="true" aria-label="Loading files">${Array.from({ length: 6 }, (_, index) => `<div class="files-skeleton files-skeleton--${index + 1}"><span></span><span></span></div>`).join("")}</div>`;
}

function renderInlineError() {
  return `<div class="files-empty files-empty--error">${icon("file")}<h2>We couldn’t load this view</h2><p>${escapeHtml(state.error)}</p><button class="files-button files-button--secondary" data-action="reload-view">Try again</button></div>`;
}

function renderEmpty(title, body) {
  return `<div class="files-empty">${icon("folder")}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${canOpenUpload() ? `<button class="files-button files-button--secondary" data-action="open-upload">${currentUploadIntent() === "proposal" ? "Upload for review" : "Upload files"}</button>` : ""}</div>`;
}

function renderSuggestionCard(suggestion) {
  const id = entityId(suggestion);
  const context = suggestion?.context || suggestion?.match || {};
  const score = Number(suggestion?.confidence || context?.confidence || 0);
  const percent = score > 0 ? Math.round(score <= 1 ? score * 100 : score) : 0;
  const aiGenerated =
    suggestion?.engine === "ai" || suggestion?.source === "ai";
  const isPostPrompt = ["media_post", "event_media"].includes(suggestion?.type);
  const canDisable = can("canManageAutomations", "files_automations_manage");
  return `<article class="files-suggestion">
    <div class="files-suggestion__icon">${icon("spark")}</div>
    <div><p class="files-eyebrow">${escapeHtml(aiGenerated ? "Optional AI assistance" : isPostPrompt ? "Rule-based media prompt" : "Context match")}${percent ? ` · ${percent}% match` : ""}</p>
      <h3>${escapeHtml(entityName(suggestion, "Recommended share"))}</h3>
      <p>${escapeHtml(suggestion?.explanation || suggestion?.reason || "Polis found a relevant folder for this workspace.")}</p>
      ${context?.district || context?.election ? `<div class="files-context-chips"><span>${escapeHtml(context.district || "")}</span><span>${escapeHtml(context.election || "")}</span></div>` : ""}
    </div>
    <div class="files-suggestion__actions">
      <button class="files-button files-button--primary" data-suggestion="accept" data-id="${escapeHtml(id)}">${isPostPrompt ? "Create draft" : "Review & share"}</button>
      <button class="files-button files-button--secondary" data-suggestion="edit" data-id="${escapeHtml(id)}">Edit</button>
      <button class="files-button files-button--ghost" data-suggestion="snooze" data-id="${escapeHtml(id)}">Snooze</button>
      <button class="files-button files-button--ghost" data-suggestion="dismiss" data-id="${escapeHtml(id)}">Dismiss</button>
      ${canDisable ? `<button class="files-button files-button--ghost files-button--small" data-suggestion="disable" data-id="${escapeHtml(id)}">Disable these</button>` : ""}
    </div>
  </article>`;
}

function renderHome() {
  const roots = workspaceRoots();
  return `<section class="files-page files-page--home">
    <div class="files-welcome">
      <div><p class="files-eyebrow">Secure, contextual, connected</p><h2>Everything your team needs—without hunting for it.</h2><p>Current material stays clear, history stays preserved, and sharing follows the roles you already manage in Polis.</p></div>
      ${can("canManage", "files_manage") ? '<button class="files-button files-button--secondary" data-action="new-folder">New folder</button>' : ""}
    </div>
    ${roots.length ? `<section class="files-section"><div class="files-section__heading"><div><p class="files-eyebrow">Your roots</p><h2>Campaign & official files</h2></div></div><div class="files-root-grid">${roots.map((folder) => `<button class="files-root-card" data-open-folder="${escapeHtml(entityId(folder))}"><span class="files-root-card__icon">${icon("folder")}</span><span><strong>${escapeHtml(entityName(folder))}</strong><small>${escapeHtml(folder?.description || `${Number(folder?.itemCount || 0)} items`)}</small></span>${icon("chevron")}</button>`).join("")}</div></section>` : ""}
    ${state.suggestions.length ? `<section class="files-section"><div class="files-section__heading"><div><p class="files-eyebrow">Polis found a match</p><h2>Recommended next steps</h2></div><button class="files-link-button" data-nav="/files/recommended">See all</button></div><div class="files-suggestions">${state.suggestions.slice(0, 2).map(renderSuggestionCard).join("")}</div></section>` : ""}
    <section class="files-section"><div class="files-section__heading"><div><p class="files-eyebrow">Workspace</p><h2>Recently updated</h2></div></div>${renderToolbar()}${renderItems(state.items, "Your Files space is ready", "Upload something new or choose a setup preset to begin organizing your work.")}</section>
  </section>`;
}

function renderView() {
  if (state.route.key === "recommended") {
    return `<section class="files-page"><div class="files-page-intro"><p class="files-eyebrow">Context-aware help</p><h2>Recommended</h2><p>Polis matches district, election, event, and media context. Nothing is shared or posted until an authorized person confirms it.</p></div>${state.contentStatus === "loading" ? renderSkeletons() : state.suggestions.length ? `<div class="files-suggestions">${state.suggestions.map(renderSuggestionCard).join("")}</div>` : renderEmpty("You’re all caught up", "New context matches and media opportunities will appear here.")}</section>`;
  }
  if (state.route.key === "uploads") return renderUploadsPage();
  const empty = {
    recent: [
      "No recent activity",
      "Files you open or update will appear here.",
    ],
    shared: [
      "Nothing shared with you",
      "Role-based and named-user shares will appear here automatically.",
    ],
    review: [
      "Nothing needs review",
      "Proposed edits and restricted-access requests will collect here.",
    ],
  }[state.route.key] || [
    "Nothing here",
    "Files will appear here when available.",
  ];
  return `<section class="files-page"><div class="files-page-intro"><p class="files-eyebrow">${escapeHtml(workspaceLabel(state.workspaceDescriptor))}</p><h2>${escapeHtml(routeTitle())}</h2><p>${state.route.key === "review" ? "Approve or refuse proposed changes without exposing draft work as current." : "Find the material you need across connected, permissioned workspaces."}</p></div>${state.route.key === "review" ? renderIncomingGrantRequests() : ""}${renderToolbar()}${renderItems(state.items, empty[0], empty[1])}</section>`;
}

function renderIncomingGrantRequests() {
  if (!state.incomingGrantRequests.length) return "";
  return `<section class="files-incoming-grants" aria-labelledby="files-incoming-grants-title"><div class="files-tab-intro"><div><p class="files-eyebrow">Shared with you</p><h3 id="files-incoming-grants-title">Restricted access requests</h3><p>Only a named recipient can accept. Folder contents remain hidden until acceptance.</p></div></div>${state.incomingGrantRequests
    .map((request) => {
      const grant = request.grant || request;
      const grantId = normalizeString(grant.grantId || request.grantId);
      const owner = entityName(
        request.ownerPrincipal || grant.ownerPrincipal,
        "Connected workspace",
      );
      const folderName =
        normalizeString(request.folderName || grant.folderName) ||
        entityName(request.folder || grant.folder, "Restricted folder");
      const canRespond = Boolean(
        grantId &&
          normalizeString(grant.status) === "pending_recipient_acceptance" &&
          request.canAccept !== false &&
          grant.canAccept !== false,
      );
      const expectedVersion =
        grant.version ||
        grant.revision ||
        request.version ||
        request.revision ||
        request.etag ||
        "";
      return `<article class="files-incoming-grant"><div class="files-folder-hero__icon">${icon("review")}</div><div><strong>${escapeHtml(folderName)}</strong><p>${escapeHtml(owner)} requests named-person access${grant.purpose ? ` · ${escapeHtml(grant.purpose)}` : ""}</p><small>${grant.expiresAt ? `Expires ${escapeHtml(formatDate(grant.expiresAt))}` : "No folder content is shown before acceptance."}</small></div>${canRespond ? `<div class="files-incoming-grant__actions"><button class="files-button files-button--primary" data-grant-request-action="accept" data-id="${escapeHtml(grantId)}" data-version="${escapeHtml(expectedVersion)}">Accept access</button><button class="files-button files-button--ghost" data-grant-request-action="decline" data-id="${escapeHtml(grantId)}" data-version="${escapeHtml(expectedVersion)}">Decline</button></div>` : '<span class="files-state-pill files-state-pill--pending">Named recipient only</span>'}</article>`;
    })
    .join("")}</section>`;
}

function renderFolderTabs() {
  const tabs = [
    ["current", "Current"],
    ["proposals", "Proposals"],
    ["history", "History"],
    ["access", "Access"],
  ];
  return `<nav class="files-tabs" aria-label="Folder sections">${tabs.map(([key, label]) => `<button data-folder-tab="${key}" class="${state.route.tab === key ? "is-active" : ""}" ${state.route.tab === key ? 'aria-current="page"' : ""}>${label}${key === "proposals" && state.folderData.proposals.filter((item) => ["pending", "open"].includes(item.status)).length ? `<span>${state.folderData.proposals.length}</span>` : ""}</button>`).join("")}</nav>`;
}

function renderEditionRail() {
  const editions = state.folderData.editions;
  if (!editions.length) return "";
  return `<aside class="files-editions"><div class="files-editions__heading"><div><p class="files-eyebrow">Versions</p><h3>Folder editions</h3></div>${can("canManage", "files_manage") ? '<button class="files-editions__new" data-action="new-edition">Start new edition</button>' : ""}</div>${editions.map((edition) => `<article class="files-edition ${edition?.status === "current" || edition?.isCurrent ? "is-current" : ""}"><div><strong>${escapeHtml(entityName(edition, "Edition"))}</strong><span>${escapeHtml(edition?.status || (edition?.isCurrent ? "current" : "archived"))} · ${escapeHtml(formatDate(edition?.activatedAt || edition?.createdAt))}</span></div>${edition?.isCurrent || edition?.status === "current" ? '<span class="files-state-pill files-state-pill--current">Current</span>' : can("canManage", "files_manage") ? `<button class="files-link-button" data-edition-action="activate" data-id="${escapeHtml(entityId(edition))}">Make current</button>` : ""}</article>`).join("")}</aside>`;
}

function renderCurrentTab() {
  return `<div class="files-folder-columns"><div><div class="files-current-banner">${icon("check")}<div><strong>Current, approved material</strong><span>People with shared access see this edition. Proposed changes stay separate until reviewed.</span></div></div>${renderToolbar({ count: state.folderData.assets.length })}${renderItems(state.folderData.assets, "This edition is empty", folderUploadIntent() === "proposal" ? "Upload material for review; it stays outside Current until approved." : folderUploadIntent() === "commit" ? "Upload approved material, or propose an addition if this folder is review-gated." : "Approved files will appear here.")}</div>${renderEditionRail()}</div>`;
}

function proposalStatus(proposal) {
  return normalizeString(proposal?.status || "pending").replace(/_/gu, " ");
}

function renderProposalsTab() {
  const proposals = state.folderData.proposals;
  return `<div class="files-review-layout"><div><div class="files-tab-intro"><div><p class="files-eyebrow">Safe collaboration</p><h3>Suggested changes</h3><p>Review additions, replacements, and deletions before they become current.</p></div>${can("canPropose", "files_propose") ? '<button class="files-button files-button--secondary" data-action="new-proposal">Suggest change</button>' : ""}</div>${proposals.length ? `<div class="files-proposals">${proposals.map((proposal) => `<article class="files-proposal"><div class="files-proposal__status"><span class="files-state-pill">${escapeHtml(proposalStatus(proposal))}</span><span>${escapeHtml(formatDate(proposal?.createdAt, { withTime: true }))}</span></div><h4>${escapeHtml(entityName(proposal, "Proposed change"))}</h4><p>${escapeHtml(proposal?.summary || proposal?.description || "Review the proposed folder change.")}</p><div class="files-proposal__author"><span>${escapeHtml(initials(entityName(proposal?.createdBy || proposal?.author, "Team member")))}</span><div><strong>${escapeHtml(entityName(proposal?.createdBy || proposal?.author, "Team member"))}</strong><small>Proposed this change</small></div></div>${["pending", "open"].includes(normalizeString(proposal?.status || "pending")) && can("canReview", "files_review") ? `<div class="files-proposal__actions"><button class="files-button files-button--primary" data-proposal-decision="approve" data-id="${escapeHtml(entityId(proposal))}" data-version="${escapeHtml(proposal?.version || proposal?.revision || "")}">Approve & merge</button><button class="files-button files-button--secondary" data-proposal-decision="request_changes" data-id="${escapeHtml(entityId(proposal))}" data-version="${escapeHtml(proposal?.version || proposal?.revision || "")}">Request changes</button><button class="files-button files-button--danger" data-proposal-decision="reject" data-id="${escapeHtml(entityId(proposal))}" data-version="${escapeHtml(proposal?.version || proposal?.revision || "")}">Refuse</button></div>` : ""}</article>`).join("")}</div>` : renderEmpty("No proposed changes", "Suggestions from contributors will appear here for review.")}</div><aside class="files-review-explainer"><p class="files-eyebrow">How review works</p><ol><li>A contributor suggests an addition, change, or deletion.</li><li>An authorized folder manager can approve, request changes, or refuse it.</li><li>Only approval merges it into Current; every decision remains in history.</li></ol></aside></div>`;
}

function renderHistoryTab() {
  const events = state.folderData.history;
  return `<div class="files-tab-intro"><div><p class="files-eyebrow">Audit trail</p><h3>Folder history</h3><p>See who changed, reviewed, shared, or archived information over time.</p></div></div>${events.length ? `<ol class="files-history">${events.map((event) => `<li><span class="files-history__dot"></span><div><strong>${escapeHtml(entityName(event, event?.action || "Folder updated"))}</strong><p>${escapeHtml(event?.description || event?.summary || "")}</p><small>${escapeHtml(entityName(event?.actor, "Polis"))} · ${escapeHtml(formatDate(event?.createdAt, { withTime: true }))}</small></div></li>`).join("")}</ol>` : renderEmpty("No history yet", "Folder events will form a durable audit trail here.")}`;
}

function grantSubject(grant) {
  return (
    grant?.recipientPrincipal ||
    grant?.subject ||
    grant?.grantee ||
    grant?.principal ||
    grant
  );
}

function renderRestrictedProgress(grant) {
  if (grant?.restriction !== "restricted" && !grant?.restricted) return "";
  const approvals = firstArray(grant, ["approvals"]);
  const maintainer = approvals.some(
    (approval) => approval.approvalType === "maintainer",
  );
  const authority = approvals.some(
    (approval) => approval.approvalType === "governance_authority",
  );
  const accepted = Boolean(
    grant?.recipientAcceptance?.acceptedAt || grant?.status === "active",
  );
  return `<div class="files-approval-progress" aria-label="Restricted access approval progress"><span class="${maintainer ? "is-complete" : ""}">${icon(maintainer ? "check" : "review")}Maintainer</span><span class="${authority ? "is-complete" : ""}">${icon(authority ? "check" : "review")}Governance authority</span><span class="${accepted ? "is-complete" : ""}">${icon(accepted ? "check" : "shared")}Recipient acceptance</span></div>`;
}

function renderAccessTab() {
  const grants = state.folderData.grants;
  return `<div class="files-access-layout"><div><div class="files-tab-intro"><div><p class="files-eyebrow">Revocable by design</p><h3>Who has access</h3><p>Dynamic role shares follow Polis membership. Restricted shares require an explicitly approved person.</p></div>${can("canShare", "files_share") ? '<button class="files-button files-button--secondary" data-action="new-share">Share access</button>' : ""}</div>${
    grants.length
      ? `<div class="files-grants">${grants
          .map((grant) => {
            const subject = grantSubject(grant);
            const pending =
              normalizeString(grant?.status).startsWith("pending") ||
              grant?.status === "requested";
            const restricted =
              grant?.restriction === "restricted" || grant?.restricted;
            const expectedVersion =
              grant?.version || grant?.revision || grant?.etag || "";
            return `<article class="files-grant"><span class="files-grant__avatar">${escapeHtml(initials(entityName(subject, "Access")))}</span><div><strong>${escapeHtml(entityName(subject, "Access grant"))}</strong><p>${(grant?.recipientRoleIds || []).length ? "Dynamic role · membership changes automatically" : restricted ? "Restricted named-person access" : "Named access"}</p><small>${escapeHtml((grant?.capabilities || grant?.permissions || []).map((item) => item.replace(/^files_/u, "")).join(" · ") || "view")}${grant?.expiresAt ? ` · expires ${escapeHtml(formatDate(grant.expiresAt))}` : ""}</small>${renderRestrictedProgress(grant)}</div><span class="files-state-pill ${pending ? "files-state-pill--pending" : "files-state-pill--current"}">${escapeHtml((grant?.status || "active").replace(/_/gu, " "))}</span><div class="files-grant__actions">${pending && restricted && can("canApproveRestricted", "files_restricted_approve") ? `<button class="files-link-button" data-grant-action="approve" data-id="${escapeHtml(entityId(grant))}" data-version="${escapeHtml(expectedVersion)}">Review approval</button>` : ""}${can("canShare", "files_share") ? `<button class="files-link-button files-link-button--danger" data-grant-action="revoke" data-id="${escapeHtml(entityId(grant))}" data-version="${escapeHtml(expectedVersion)}">Revoke</button>` : ""}</div></article>`;
          })
          .join("")}</div>`
      : renderEmpty(
          "Only workspace members have access",
          "Add a role-based share or request restricted access for a named person.",
        )
  }</div><aside class="files-access-note">${icon("shared")}<h4>Role shares stay in sync</h4><p>Share with a media, research, field, or custom Polis role. When membership changes, folder access changes with it—no manual cleanup.</p></aside></div>`;
}

function renderFolder() {
  if (state.contentStatus === "loading")
    return `<section class="files-page">${renderSkeletons()}</section>`;
  if (state.contentStatus === "error")
    return `<section class="files-page">${renderInlineError()}</section>`;
  const context = state.folder?.context || {};
  const tabContent = {
    current: renderCurrentTab,
    proposals: renderProposalsTab,
    history: renderHistoryTab,
    access: renderAccessTab,
  }[state.route.tab]();
  return `<section class="files-page files-page--folder"><div class="files-folder-hero"><button class="files-back" data-nav="/files">← All files</button><div class="files-folder-hero__row"><div class="files-folder-hero__icon">${icon("folder")}</div><div><div class="files-context-chips">${[
    context?.stateCode,
    context?.office,
    context?.district,
    context?.cycle,
    context?.boundaryVintage,
    state.folder?.classification,
  ]
    .filter(Boolean)
    .map((value) => `<span>${escapeHtml(value)}</span>`)
    .join(
      "",
    )}</div><h2>${escapeHtml(entityName(state.folder, "Folder"))}</h2><p>${escapeHtml(state.folder?.description || "Current, governed information for authorized collaborators.")}</p></div><div class="files-folder-hero__actions">${can("canManage", "files_manage") && state.folder?.access?.shared !== true ? '<button class="files-button files-button--ghost" data-action="folder-settings">Folder settings</button><button class="files-button files-button--ghost" data-action="new-edition">Start new edition</button>' : ""}${can("canManage", "files_manage") && state.folder?.access?.shared !== true && state.folder?.status !== "archived" ? '<button class="files-button files-button--danger" data-action="archive-folder">Archive folder</button>' : ""}${canOpenUpload() ? `<button class="files-button files-button--primary" data-action="open-upload">${folderUploadIntent() === "proposal" ? "Upload for review" : "Upload"}</button>` : ""}</div></div></div>${renderFolderTabs()}<div class="files-folder-tab">${tabContent}</div></section>`;
}

function renderUploadsPage() {
  const items = state.uploadQueue;
  return `<section class="files-page"><div class="files-page-intro files-page-intro--actions"><div><p class="files-eyebrow">Transfer center</p><h2>Uploads</h2><p>Keep working while signed uploads transfer securely in the background.</p></div>${canOpenUpload() ? '<button class="files-button files-button--primary" data-action="open-upload">Add files</button>' : ""}</div>${items.length ? `<div class="files-upload-list">${items.map(renderUploadItem).join("")}</div>` : renderEmpty("No uploads in this session", "Choose files or drag them into an upload window to begin.")}</section>`;
}

function renderUploadItem(item) {
  const file = item.file || item.fileMetadata || {};
  const type = normalizeString(file.type || file.contentType);
  const waitingForFile = item.status === "paused" && !item.file;
  const status =
    item.status === "quarantined"
      ? item.error || "Quarantined · security review did not release this file"
      : item.status === "error"
        ? item.error
        : item.status === "complete"
          ? item.intent === "proposal"
            ? "Ready for proposal review"
            : "Ready in Current"
          : item.status === "scanning"
            ? item.error || "Uploaded · security scan in progress"
            : item.status === "hashing"
              ? "Preparing secure checksums"
              : item.status === "queued"
                ? "Waiting"
                : waitingForFile
                  ? "Choose the same file to resume"
                  : `${Math.round(item.progress * 100)}% uploaded`;
  return `<article class="files-upload-item files-upload-item--${escapeHtml(item.status)}"><div class="files-upload-item__icon">${icon(type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file")}</div><div class="files-upload-item__body"><div><strong>${escapeHtml(file.name || file.fileName)}</strong><span>${escapeHtml(formatBytes(file.size))}</span></div><progress class="files-progress" aria-label="Upload progress" max="100" value="${Math.round(item.progress * 100)}">${Math.round(item.progress * 100)}%</progress><small>${escapeHtml(status)}</small></div><div class="files-upload-item__actions">${item.status === "uploading" || item.status === "hashing" ? `<button data-upload-action="cancel" data-id="${escapeHtml(item.id)}">Cancel</button>` : waitingForFile ? `<label class="files-upload-resume">Resume<input type="file" data-resume-upload="${escapeHtml(item.id)}" /></label>` : item.status === "error" && item.file ? `<button data-upload-action="retry" data-id="${escapeHtml(item.id)}">Retry</button>` : item.status === "complete" || item.status === "scanning" ? icon("check") : item.status === "quarantined" ? icon("review") : ""}</div></article>`;
}

function renderModal() {
  if (!state.modal) return "";
  const content = {
    setup: renderSetupModal,
    upload: renderUploadModal,
    "new-folder": renderNewFolderModal,
    "new-share": renderShareModal,
    settings: renderSettingsModal,
    "folder-settings": renderFolderSettingsModal,
    proposal: renderProposalModal,
    edition: renderEditionModal,
    "suggestion-edit": renderSuggestionEditModal,
    "archive-folder": renderArchiveFolderModal,
    "confirm-decision": renderDecisionModal,
  }[state.modal.type]?.();
  if (!content) return "";
  const locked =
    state.modal.type === "setup" && !(state.workspace?.setup || {}).initialized;
  return `<div class="files-modal-layer" role="presentation"><div class="files-modal-backdrop" ${locked ? "" : 'data-action="close-modal"'}></div><section class="files-modal files-modal--${escapeHtml(state.modal.type)}" role="dialog" aria-modal="true" aria-labelledby="files-modal-title">${!locked ? `<button class="files-modal__close" data-action="close-modal" aria-label="Close">${icon("close")}</button>` : ""}${content}</section></div>`;
}

function renderSetupModal() {
  const selected = state.modal?.presetKey || "blank";
  return `<div class="files-setup"><div class="files-setup__intro"><span class="files-setup__mark">${icon("folder")}</span><p class="files-eyebrow">Set up Polis Files</p><h2 id="files-modal-title">Start organized—not empty.</h2><p>Choose a workspace pattern. You can rename folders, change role access, or turn automations off at any time.</p></div><form data-form="setup"><div class="files-preset-grid"><label class="files-preset ${selected === "blank" ? "is-selected" : ""}"><input type="radio" name="presetKey" value="blank" ${selected === "blank" ? "checked" : ""}/><span class="files-preset__icon">${icon("folder")}</span><strong>Blank workspace</strong><small>Start with no default folders.</small></label>${state.presets
    .map(
      (preset) =>
        `<label class="files-preset ${selected === (preset.presetKey || preset.key) ? "is-selected" : ""}"><input type="radio" name="presetKey" value="${escapeHtml(preset.presetKey || preset.key)}" ${selected === (preset.presetKey || preset.key) ? "checked" : ""}/><span class="files-preset__icon">${icon(preset.icon || "folder")}</span><strong>${escapeHtml(entityName(preset, "Workspace preset"))}</strong><small>${escapeHtml(preset.description || "Adds permission-scoped starter folders.")}</small><span class="files-preset__preview">${firstArray(
          preset,
          ["folders", "roots"],
        )
          .slice(0, 3)
          .map((folder) => escapeHtml(entityName(folder)))
          .join(" · ")}</span></label>`,
    )
    .join(
      "",
    )}</div><div class="files-setup__toggles"><label><input type="checkbox" name="contextMatchingEnabled" checked /> Suggest relevant folders from district and election context</label><label><input type="checkbox" name="eventMediaPromptsEnabled" checked /> Rule-based event media prompts <small>(no AI)</small></label><label><input type="checkbox" name="aiSuggestionsEnabled" /> Optional AI caption and next-step assistance <small>(off by default)</small></label></div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="submit" name="intent" value="skip">Skip setup</button><button class="files-button files-button--primary" type="submit" name="intent" value="initialize">Create my Files space</button></div></form></div>`;
}

function uploadFolderOptions() {
  const options = [];
  if (state.folder) options.push(state.folder);
  workspaceRoots().forEach((rootFolder) => {
    if (!options.some((item) => entityId(item) === entityId(rootFolder)))
      options.push(rootFolder);
  });
  return options;
}

function renderUploadModal() {
  const folderId =
    state.modal.folderId ||
    entityId(state.folder) ||
    entityId(workspaceRoots()[0]);
  return `<div class="files-modal__heading"><p class="files-eyebrow">Secure upload</p><h2 id="files-modal-title">Add files</h2><p>Uploads go to the selected folder’s Current edition or enter review when that folder requires approval.</p></div><div class="files-field"><label for="upload-folder">Destination</label><select id="upload-folder" data-action="upload-folder">${uploadFolderOptions()
    .map(
      (folder) =>
        `<option value="${escapeHtml(entityId(folder))}" ${entityId(folder) === folderId ? "selected" : ""}>${escapeHtml(entityName(folder))}</option>`,
    )
    .join(
      "",
    )}</select></div><label class="files-dropzone" data-dropzone><input type="file" data-action="pick-files" multiple /><span class="files-dropzone__icon">${icon("upload")}</span><strong>Drag files here or choose from your device</strong><small>Images, video, documents, archives, and other team material</small></label>${state.uploadQueue.length ? `<div class="files-upload-list files-upload-list--modal">${state.uploadQueue.slice(-4).map(renderUploadItem).join("")}</div>` : ""}<div class="files-modal__actions"><button class="files-button files-button--ghost" data-action="close-modal">Close</button></div>`;
}

function renderNewFolderModal() {
  const stateCodes =
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
      " ",
    );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Add structure</p><h2 id="files-modal-title">New folder</h2><p>Canonical election context lets Polis make accurate, explainable matches as boundaries and cycles change.</p></div><form data-form="new-folder"><div class="files-field"><label for="folder-name">Folder name</label><input id="folder-name" name="name" required maxlength="120" placeholder="Florida House District 3 research" autofocus /></div><div class="files-field"><label for="folder-description">What belongs here?</label><textarea id="folder-description" name="description" rows="3" maxlength="500" placeholder="Current district research, contacts, and field notes"></textarea></div><fieldset class="files-context-fields"><legend>Political context <span>(optional)</span></legend><div class="files-form-grid files-form-grid--three"><div class="files-field"><label for="folder-state">State</label><select id="folder-state" name="stateCode"><option value="">None</option>${stateCodes.map((code) => `<option value="${code}">${code}</option>`).join("")}</select></div><div class="files-field"><label for="folder-office">Office</label><select id="folder-office" name="office"><option value="">None</option><option value="us_house">U.S. House</option><option value="state_senate">State Senate</option><option value="state_house">State House</option><option value="statewide">Statewide</option><option value="county">County</option><option value="municipal">Municipal</option><option value="school_board">School board</option><option value="other">Other</option></select></div><div class="files-field"><label for="folder-district">District number</label><input id="folder-district" name="district" inputmode="numeric" placeholder="3" /></div></div><div class="files-form-grid files-form-grid--three"><div class="files-field"><label for="folder-cycle">Election cycle</label><input id="folder-cycle" name="cycle" inputmode="numeric" placeholder="2026" /></div><div class="files-field"><label for="folder-boundary">Boundary vintage</label><input id="folder-boundary" name="boundaryVintage" inputmode="numeric" placeholder="2022" /></div><div class="files-field"><label for="folder-effective-from">Effective from</label><input id="folder-effective-from" name="effectiveFrom" type="date" /></div></div><div class="files-field"><label for="folder-effective-to">Effective through <span>(if known)</span></label><input id="folder-effective-to" name="effectiveTo" type="date" /></div></fieldset><label class="files-check"><input type="checkbox" name="reviewRequired" checked /> Require approval before suggested changes become current</label><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Create folder</button></div></form>`;
}

const SHARE_PURPOSE_OPTIONS = [
  ["media", "Media and communications"],
  ["research", "Research and district intelligence"],
  ["field", "Field and organizing"],
  ["leadership", "Leadership coordination"],
  ["compliance", "Compliance and legal"],
  ["custom:collaboration", "Other approved collaboration"],
];

function shareTargetValue(target) {
  const principal = target?.principal || target || {};
  return `${normalizeString(principal.type)}:${normalizeString(principal.id)}`;
}

function selectedShareTarget(modal = state.modal) {
  return (modal?.targets || []).find(
    (target) => shareTargetValue(target) === modal?.targetValue,
  );
}

function purposeKeysForRole(role, mappings) {
  if (Array.isArray(role?.purposeKeys)) return role.purposeKeys;
  if (Array.isArray(mappings)) {
    const mapping = mappings.find(
      (item) =>
        item?.roleId === role?.roleId || item?.role?.roleId === role?.roleId,
    );
    return firstArray(mapping, ["purposeKeys", "audiencePurposeKeys"]);
  }
  const mapped = mappings?.[role?.roleId];
  return Array.isArray(mapped) ? mapped : firstArray(mapped, ["purposeKeys"]);
}

function renderShareModal() {
  const modal = state.modal || {};
  const shareType = modal.shareType || "organization_role";
  const targets = modal.targets || [];
  const roles = (modal.roles || []).filter(
    (role) => role.eligibleForStandard !== false,
  );
  const members = (modal.members || []).filter((member) =>
    shareType === "restricted_user"
      ? member.eligibleForRestricted !== false
      : member.eligibleForStandard !== false,
  );
  const targetValue = modal.targetValue || "";
  const selectedTarget = selectedShareTarget(modal);
  const restrictedAvailable =
    !selectedTarget || selectedTarget.canShareRestricted === true;
  const selectedPurpose = modal.audiencePurposeKey || "";
  const discoveredPurposeKeys = roles.flatMap((role) =>
    purposeKeysForRole(role, modal.rolePurposeMappings),
  );
  const purposeOptions = [...SHARE_PURPOSE_OPTIONS];
  for (const purposeKey of discoveredPurposeKeys) {
    if (!purposeKey || purposeOptions.some(([key]) => key === purposeKey))
      continue;
    purposeOptions.push([
      purposeKey,
      purposeKey.replace(/^custom:/u, "").replace(/_/gu, " "),
    ]);
  }
  const minimumExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `<div class="files-modal__heading"><p class="files-eyebrow">Controlled sharing</p><h2 id="files-modal-title">Share folder access</h2><p>Choose from active Polis connections. Role access follows membership; restricted access never goes to a role.</p></div><form data-form="new-share" data-share-type="${escapeHtml(shareType)}"><fieldset class="files-segmented files-segmented--three"><legend class="sr-only">Share type</legend><label><input type="radio" name="subjectType" value="organization_role" data-action="share-type" ${shareType === "organization_role" ? "checked" : ""}/><span>Team role</span></label><label><input type="radio" name="subjectType" value="user" data-action="share-type" ${shareType === "user" ? "checked" : ""}/><span>Named person</span></label><label><input type="radio" name="subjectType" value="restricted_user" data-action="share-type" ${shareType === "restricted_user" ? "checked" : ""} ${restrictedAvailable ? "" : "disabled"}/><span>Restricted</span></label></fieldset><div class="files-field"><label for="share-target-search">Connected organization or campaign</label><input id="share-target-search" type="search" data-share-search="targets" value="${escapeHtml(modal.targetQuery || "")}" placeholder="Search connected workspaces" autocomplete="off" /><select name="targetPrincipal" data-action="share-target" aria-label="Connected organization or campaign"><option value="">${modal.loadingTargets ? "Loading connections…" : "Choose a connected workspace"}</option>${targets
    .map((target) => {
      const principal = target.principal || target;
      const value = shareTargetValue(target);
      return `<option value="${escapeHtml(value)}" ${value === targetValue ? "selected" : ""} data-restricted="${target.canShareRestricted === true}">${escapeHtml(entityName(principal))}${target.relationship?.type ? ` · ${escapeHtml(target.relationship.type)}` : ""}</option>`;
    })
    .join(
      "",
    )}</select>${selectedTarget && !restrictedAvailable ? "<small>This connection permits standard sharing only.</small>" : ""}</div><div class="files-share-role" data-share-section="role"><div class="files-field"><label for="share-role-search">Role</label><input id="share-role-search" type="search" data-share-search="options" placeholder="Search media, field, research, or custom roles" autocomplete="off" /><select name="roleId" data-action="share-role"><option value="">Choose a role</option>${roles
    .map((role) => {
      const count = Number(role.memberCount);
      const countLabel = Number.isFinite(count)
        ? ` · ${count} member${count === 1 ? "" : "s"}`
        : "";
      return `<option value="${escapeHtml(role.roleId)}" ${role.roleId === modal.roleId ? "selected" : ""}>${escapeHtml(role.label)}${countLabel}</option>`;
    })
    .join(
      "",
    )}</select></div><p class="files-form-note">Everyone currently assigned to this role receives access. Access updates automatically when role membership changes.</p></div><div class="files-share-person" data-share-section="person"><div class="files-field"><label for="share-member-search">Eligible named people</label><input id="share-member-search" type="search" data-share-search="options" placeholder="Search connected members" autocomplete="off" /><select name="recipientUserIds" multiple size="${Math.min(5, Math.max(3, members.length))}" aria-describedby="share-member-help">${members.map((member) => `<option value="${escapeHtml(member.userId)}">${escapeHtml(member.displayName)}${member.status ? ` · ${escapeHtml(member.status)}` : ""}</option>`).join("")}</select><small id="share-member-help">${members.length ? "Choose one or more eligible people." : targetValue ? "No eligible people match this search." : "Choose a connected workspace first."}</small></div></div><div class="files-field"><label for="share-audience-purpose">What team function is this for?</label><select id="share-audience-purpose" name="audiencePurposeKey" data-action="share-purpose" required><option value="">Choose a purpose</option>${purposeOptions.map(([key, label]) => `<option value="${escapeHtml(key)}" ${key === selectedPurpose ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select><small>Polis uses this context to suggest the right role mapping without broadening access.</small></div><fieldset class="files-permission-grid"><legend>Access level</legend><label><input type="radio" name="accessTier" value="view" /> View current</label><label><input type="radio" name="accessTier" value="contribute" checked /> View and suggest changes</label><label data-standard-only><input type="radio" name="accessTier" value="maintain" /> Maintain ordinary folder content</label>${can("canDownloadRestricted", "files_restricted_download") ? '<label data-restricted-only><input type="checkbox" name="allowDownload" /> Download restricted files</label>' : ""}</fieldset><div class="files-restricted-fields" data-share-section="restricted"><div class="files-restricted-warning">${icon("review")}<p><strong>Three-step access</strong><span>A folder maintainer and a distinct governance authority approve this request. Then an eligible named recipient accepts it.</span></p></div><div class="files-field"><label for="share-purpose">Required purpose</label><textarea id="share-purpose" name="purpose" rows="3" maxlength="500" placeholder="Why this person needs this restricted information"></textarea></div><div class="files-field"><label for="share-expiry">Required expiry</label><input id="share-expiry" name="expiresAt" type="date" min="${minimumExpiry}" /></div></div><div class="files-form-note">Only active, eligible Polis connections appear here. If someone is missing, update the underlying organization connection or membership first.</div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit" ${modal.loadingTargets || modal.loadingOptions ? "disabled" : ""}>${shareType === "restricted_user" ? "Request restricted access" : "Share access"}</button></div></form>`;
}

const SETTINGS_FIELD_PATHS = {
  contextMatchingEnabled: ["suggestions", "contextMatches"],
  connectionSharePromptsEnabled: ["automations", "contextSharingPrompts"],
  eventMediaPromptsEnabled: ["automations", "newMediaPostPrompts"],
  aiSuggestionsEnabled: ["suggestions", "aiAssistance"],
  postSuggestionsEnabled: ["suggestions", "socialPosts"],
  postUsageBadgesEnabled: ["automations", "usageBadges"],
  uploadNotificationsEnabled: ["notifications", "automations"],
};

function settingsValue(key, fallback = true) {
  const settings = state.modal?.settings || state.workspace?.settings || {};
  const path = SETTINGS_FIELD_PATHS[key];
  const canonical = path ? settings?.[path[0]]?.[path[1]] : undefined;
  if (typeof canonical === "boolean") return canonical;
  return settings[key] === undefined ? fallback : Boolean(settings[key]);
}

function toggleField(
  name,
  label,
  description,
  fallback = true,
  { disabled = false } = {},
) {
  return `<label class="files-toggle ${disabled ? "is-disabled" : ""}"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span><input type="checkbox" name="${escapeHtml(name)}" ${settingsValue(name, fallback) && !disabled ? "checked" : ""} ${disabled ? "disabled" : ""}/><i aria-hidden="true"></i></label>`;
}

function renderSettingsModal() {
  const automationAccess = can(
    "canManageAutomations",
    "files_automations_manage",
  );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Workspace defaults</p><h2 id="files-modal-title">Files settings</h2><p>These defaults apply across this workspace. Folder managers can narrow them for a specific folder.</p></div><form data-form="settings"><div class="files-settings-list">${toggleField("contextMatchingEnabled", "Context matching", "Match district, office, election, and event context to relevant folders.")}${toggleField("connectionSharePromptsEnabled", "Connection share prompts", "Ask before sharing useful folders when organizations or campaigns connect.")}${toggleField("eventMediaPromptsEnabled", "Rule-based media prompts", "Prompt teams when event media arrives using folder and calendar metadata—no AI.")}${toggleField("postSuggestionsEnabled", "Files-to-post recommendations", "Offer post ideas from approved media without publishing automatically.")}${toggleField("aiSuggestionsEnabled", "AI assistance", "Optionally suggest captions and useful next steps; never post automatically.", false)}${toggleField("postUsageBadgesEnabled", "Post provenance badges", "Show which teams have already used a photo or video.", workspaceFlags().postProvenanceEnabled !== false)}${toggleField("uploadNotificationsEnabled", "Automation notifications", "Notify relevant teams when Files recommendations or automations need attention.")}</div>${!automationAccess ? '<p class="files-form-note">Only members with Files automation management permission can change automation defaults.</p>' : ""}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit" ${automationAccess ? "" : "disabled"}>Save settings</button></div></form>`;
}

function renderFolderSettingsModal() {
  const settings = state.folder?.settings || {};
  const restricted = folderIsRestricted();
  state.modal.settings = state.modal.settings || settings;
  const inheritWorkspace = settings.inheritWorkspace !== false;
  return `<div class="files-modal__heading"><p class="files-eyebrow">Folder controls</p><h2 id="files-modal-title">${escapeHtml(entityName(state.folder))} settings</h2><p>Override workspace automation and review behavior for this folder.</p></div><form data-form="folder-settings"><div class="files-field"><label for="folder-edit-name">Folder name</label><input id="folder-edit-name" name="name" value="${escapeHtml(entityName(state.folder))}" required /></div><label class="files-toggle"><span><strong>Review-gated changes</strong><small>Contributors suggest edits; folder reviewers merge them.</small></span><input type="checkbox" name="reviewRequired" ${state.folder?.reviewRequired !== false ? "checked" : ""}/><i></i></label><label class="files-toggle"><span><strong>Use workspace automation defaults</strong><small>Turn off to customize this folder.</small></span><input type="checkbox" name="inheritWorkspace" data-action="folder-inherit" ${inheritWorkspace ? "checked" : ""}/><i></i></label>${toggleField("contextMatchingEnabled", "Context matching", "Use this folder’s district, election, office, and event metadata.", true, { disabled: inheritWorkspace })}${toggleField("aiSuggestionsEnabled", "AI suggestions", restricted ? "AI processing is unavailable for restricted folders." : "Suggest useful actions from approved material.", false, { disabled: inheritWorkspace || restricted })}${toggleField("postSuggestionsEnabled", "Post suggestions", restricted ? "Restricted material cannot generate post suggestions." : "Suggest drafts when new media is added.", false, { disabled: inheritWorkspace || restricted })}${toggleField("postUsageBadgesEnabled", "Usage badges", "Show linked Polis posts on used media.", true, { disabled: inheritWorkspace })}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Save folder</button></div></form>`;
}

function proposalAssetOptions(selectedId = "") {
  return state.folderData.assets
    .map(
      (asset) =>
        `<option value="${escapeHtml(entityId(asset))}" ${entityId(asset) === selectedId ? "selected" : ""}>${escapeHtml(entityName(asset))}</option>`,
    )
    .join("");
}

function renderProposalModal() {
  const operationType = state.modal?.operationType || "add";
  const targetAssetId = state.modal?.targetAssetId || "";
  const targetField =
    operationType === "add"
      ? ""
      : `<div class="files-field"><label for="proposal-target">Current asset</label><select id="proposal-target" name="targetAssetId" data-action="proposal-target" required><option value="">Choose an asset</option>${proposalAssetOptions(targetAssetId)}</select></div>`;
  const uploadedAssetField = ["add", "replace"].includes(operationType)
    ? `<div class="files-field"><label class="files-proposal-upload">Choose the ${operationType === "replace" ? "replacement" : "new"} file<input type="file" data-proposal-upload /></label><small>Choosing a file starts one proposal upload. Polis scans it and creates exactly one review request; it cannot enter Current until approved.</small></div>`
    : "";
  const operationFields = {
    rename:
      '<div class="files-field"><label for="proposal-name">New file name</label><input id="proposal-name" name="operationName" required maxlength="255" /></div>',
    move: `<div class="files-field"><label for="proposal-destination">Destination folder</label><select id="proposal-destination" name="destinationFolderId" required><option value="">Choose a folder</option>${workspaceRoots()
      .filter((folder) => entityId(folder) !== entityId(state.folder))
      .map(
        (folder) =>
          `<option value="${escapeHtml(entityId(folder))}">${escapeHtml(entityName(folder))}</option>`,
      )
      .join("")}</select></div>`,
    metadata:
      '<div class="files-form-grid"><div class="files-field"><label for="proposal-metadata-key">Metadata field</label><input id="proposal-metadata-key" name="metadataKey" required placeholder="eventDate" /></div><div class="files-field"><label for="proposal-metadata-value">New value</label><input id="proposal-metadata-value" name="metadataValue" required /></div></div>',
  }[operationType];
  const uploadOperation = ["add", "replace"].includes(operationType);
  return `<div class="files-modal__heading"><p class="files-eyebrow">Suggest, then review</p><h2 id="files-modal-title">Propose a folder change</h2><p>An authorized reviewer decides whether this becomes part of Current.</p></div><form data-form="proposal"><div class="files-field"><label for="proposal-title">Short title</label><input id="proposal-title" name="title" required maxlength="140" placeholder="Replace 2024 precinct contact sheet" /></div><div class="files-field"><label for="proposal-description">Explain the change</label><textarea id="proposal-description" name="description" rows="5" required maxlength="1500" placeholder="What should change, and why is the new information current?"></textarea></div><div class="files-field"><label for="proposal-type">Change type</label><select id="proposal-type" name="operationType" data-action="proposal-operation"><option value="add" ${operationType === "add" ? "selected" : ""}>Add an asset</option><option value="replace" ${operationType === "replace" ? "selected" : ""}>Replace an asset</option><option value="rename" ${operationType === "rename" ? "selected" : ""}>Rename an asset</option><option value="move" ${operationType === "move" ? "selected" : ""}>Move an asset</option><option value="metadata" ${operationType === "metadata" ? "selected" : ""}>Update metadata</option><option value="delete" ${operationType === "delete" ? "selected" : ""}>Delete an asset</option></select></div>${targetField}${uploadedAssetField}${operationFields || ""}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">${uploadOperation ? "Close" : "Cancel"}</button>${uploadOperation ? "" : '<button class="files-button files-button--primary" type="submit">Submit for review</button>'}</div></form>`;
}

function renderEditionModal() {
  const context = state.folder?.context || {};
  const defaultType = context.boundaryVintage
    ? "boundary_vintage"
    : context.cycle
      ? "election_cycle"
      : "annual";
  return `<div class="files-modal__heading"><p class="files-eyebrow">Preserve context over time</p><h2 id="files-modal-title">Create a new edition</h2><p>The current edition stays available until you deliberately activate the new one.</p></div><form data-form="edition"><div class="files-field"><label for="edition-label">Edition label</label><input id="edition-label" name="label" required placeholder="2028 cycle" /></div><div class="files-form-grid files-form-grid--three"><div class="files-field"><label for="edition-type">Edition type</label><select id="edition-type" name="type"><option value="annual" ${defaultType === "annual" ? "selected" : ""}>Annual</option><option value="election_cycle" ${defaultType === "election_cycle" ? "selected" : ""}>Election cycle</option><option value="boundary_vintage" ${defaultType === "boundary_vintage" ? "selected" : ""}>Boundary vintage</option><option value="custom">Custom</option></select></div><div class="files-field"><label for="edition-year">Effective year</label><input id="edition-year" name="effectiveYear" inputmode="numeric" placeholder="2028" /></div><div class="files-field"><label for="edition-cycle">Election cycle</label><input id="edition-cycle" name="cycle" inputmode="numeric" value="${escapeHtml(context.cycle || "")}" /></div></div><div class="files-field"><label for="edition-boundary">Boundary vintage</label><input id="edition-boundary" name="boundaryVintage" value="${escapeHtml(context.boundaryVintage || "")}" placeholder="2022" /></div><div class="files-form-grid"><div class="files-field"><label for="edition-effective-from">Effective from</label><input id="edition-effective-from" name="effectiveFrom" type="date" value="${escapeHtml(context.effectiveFrom || "")}" /></div><div class="files-field"><label for="edition-effective-to">Effective through</label><input id="edition-effective-to" name="effectiveTo" type="date" value="${escapeHtml(context.effectiveTo || "")}" /></div></div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Create edition</button></div></form>`;
}

function renderSuggestionEditModal() {
  const suggestion =
    state.suggestions.find(
      (item) => entityId(item) === state.modal?.suggestionId,
    ) || {};
  const recommendation = suggestion?.recommendation || {};
  const scheduledFor = normalizeString(recommendation.scheduledFor).slice(
    0,
    16,
  );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Keep the human in control</p><h2 id="files-modal-title">Edit before accepting</h2><p>Adjust the proposed action. Polis will preserve the original recommendation and your changes in its audit context.</p></div><form data-form="suggestion-edit"><div class="files-field"><label for="suggestion-caption">Suggested caption or instructions</label><textarea id="suggestion-caption" name="caption" rows="5" required autofocus>${escapeHtml(recommendation.caption || suggestion?.description || suggestion?.reason || entityName(suggestion, "Recommended action"))}</textarea></div><div class="files-field"><label for="suggestion-scheduled-for">Suggested publish time <span>(optional)</span></label><input id="suggestion-scheduled-for" name="scheduledFor" type="datetime-local" value="${escapeHtml(scheduledFor)}" /></div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Accept edited recommendation</button></div></form>`;
}

function renderArchiveFolderModal() {
  return `<div class="files-modal__heading"><p class="files-eyebrow">Preserve, don’t delete</p><h2 id="files-modal-title">Archive this folder?</h2><p>Current contents, editions, access history, and proposal decisions remain preserved. Active shares stop exposing it in everyday views.</p></div><form data-form="archive-folder"><div class="files-field"><label for="archive-reason">Archive note</label><textarea id="archive-reason" name="reason" rows="3" required placeholder="Why this folder is no longer current"></textarea></div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Keep active</button><button class="files-button files-button--danger" type="submit">Archive folder</button></div></form>`;
}

function renderDecisionModal() {
  const approving = state.modal.decision === "approve";
  const requesting = state.modal.decision === "request_changes";
  const eyebrow = approving
    ? "Merge into Current"
    : requesting
      ? "Return with guidance"
      : "Close without merging";
  const title = approving
    ? "Approve this proposal?"
    : requesting
      ? "Request changes?"
      : "Refuse this proposal?";
  const body = approving
    ? "The approved change becomes visible to everyone with current access."
    : requesting
      ? "The contributor can revise this proposal without losing its discussion and review history."
      : "The proposal stays in history, but Current will not change.";
  const button = approving
    ? "Approve & merge"
    : requesting
      ? "Send change request"
      : "Refuse change";
  return `<div class="files-modal__heading"><p class="files-eyebrow">${eyebrow}</p><h2 id="files-modal-title">${title}</h2><p>${body}</p></div><form data-form="proposal-decision"><div class="files-field"><label for="decision-reason">Review note ${approving ? "(optional)" : ""}</label><textarea id="decision-reason" name="reason" rows="3" ${approving ? "" : "required"} placeholder="Add specific, actionable context for the contributor and future reviewers"></textarea></div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button ${approving ? "files-button--primary" : requesting ? "files-button--secondary" : "files-button--danger"}" type="submit">${button}</button></div></form>`;
}

function renderPostDrawer() {
  if (!state.postDraft.open) return "";
  const selected = selectedAssets();
  return `<div class="files-drawer-layer"><div class="files-drawer-backdrop" data-action="close-post"></div><aside class="files-post-drawer" role="dialog" aria-modal="true" aria-labelledby="files-post-title"><header><div><p class="files-eyebrow">Files → Polis post · ${selected.length}/10</p><h2 id="files-post-title">Turn approved media into a post</h2></div><button data-action="close-post" aria-label="Close">${icon("close")}</button></header><form data-form="post-draft"><div class="files-post-carousel" aria-label="Selected media in post order">${selected.map((item, index) => `<article><span>${index + 1}</span>${itemThumbnail(item)}<strong>${escapeHtml(entityName(item))}</strong>${usageBadges(item)}<div class="files-post-order"><button type="button" data-post-move="back" data-id="${escapeHtml(entityId(item))}" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(entityName(item))} earlier">←</button><button type="button" data-post-move="forward" data-id="${escapeHtml(entityId(item))}" ${index === selected.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(entityName(item))} later">→</button></div><button type="button" data-select-asset="${escapeHtml(entityId(item))}" aria-label="Remove ${escapeHtml(entityName(item))}">${icon("close")}</button></article>`).join("")}</div><div class="files-field"><label for="post-description">Post idea or caption</label><textarea id="post-description" name="description" rows="5" placeholder="Share the story behind this moment…">${escapeHtml(state.postDraft.description)}</textarea></div><div class="files-post-note">${icon("post")}<p><strong>Provenance stays attached.</strong> Published, access-safe post links appear on media usage badges. Unpublished drafts are never exposed.</p></div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-post">Keep browsing</button><button class="files-button files-button--primary" type="submit" ${selected.length ? "" : "disabled"}>Create post draft</button></div></form></aside></div>`;
}

function selectedAssets() {
  const byId = new Map(
    state.folderData.assets.map((item) => [entityId(item), item]),
  );
  return Array.from(state.selection)
    .map((id) => byId.get(id))
    .filter(Boolean);
}

function renderApp() {
  const mainContent =
    state.route.kind === "folder"
      ? renderFolder()
      : state.route.key === "home"
        ? renderHome()
        : renderView();
  return `<div class="files-shell">${renderSidebar()}<div class="files-main">${renderHeader()}<main class="files-content" id="files-content">${mainContent}</main></div>${renderMobileNav()}${renderModal()}${renderPostDrawer()}${state.toast ? `<div class="files-toast files-toast--${escapeHtml(state.toast.tone)}" role="status">${state.toast.tone === "success" ? icon("check") : icon("file")}<span>${escapeHtml(state.toast.message)}</span></div>` : ""}${state.busyAction ? '<div class="files-busy" role="status"><span></span><span class="sr-only">Working…</span></div>' : ""}</div>`;
}

function render() {
  if (!root) return;
  if (state.status === "booting" || state.status === "loading-workspace") {
    root.innerHTML = `<main class="files-boot" aria-busy="true" aria-live="polite"><img src="${polisLogoUrl}" alt="" /><p>${state.status === "booting" ? "Opening Polis Files…" : "Opening workspace…"}</p></main>`;
    return;
  }
  if (state.status === "signed-out") {
    root.innerHTML = renderSignedOut();
    return;
  }
  const gates = {
    "no-workspaces": [
      "No Files workspace yet",
      "Files appears when you have an eligible organization, campaign, or official account.",
    ],
    disabled: [
      "Files isn’t enabled here",
      "This workspace is not currently entitled to Polis Files.",
    ],
    forbidden: [
      "You don’t have Files access",
      "Ask a workspace administrator for a Files role or named access grant.",
    ],
    error: ["Files could not open", state.error || "Please try again."],
  };
  if (gates[state.status]) {
    root.innerHTML = renderStatusPage(state.status, ...gates[state.status]);
    return;
  }
  root.innerHTML = renderApp();
  const activeLayer = state.modal
    ? root.querySelector(".files-modal")
    : state.postDraft.open
      ? root.querySelector(".files-post-drawer")
      : null;
  const layerState = state.modal || state.postDraft;
  if (activeLayer && !layerState.focused) {
    layerState.focused = true;
    window.requestAnimationFrame(() => {
      const preferred = activeLayer.querySelector("[autofocus]");
      const fallback = activeLayer.querySelector(
        "input:not([type='hidden']), textarea, select, button",
      );
      (preferred || fallback)?.focus();
    });
  }
}

async function openSetup() {
  state.modal = { type: "setup", presetKey: "blank" };
  state.status = "ready";
  render();
  try {
    const payload = await api.getSetupPresets();
    state.presets = firstArray(payload, ["presets", "items"]);
  } catch (error) {
    setToast(
      error?.message ||
        "Presets could not be loaded; a blank workspace is still available.",
      "error",
    );
  }
  render();
}

async function withBusy(key, operation, successMessage = "") {
  if (state.busyAction) return;
  state.busyAction = key;
  const actionKey =
    state.mutationKeys.get(key) ||
    window.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;
  state.mutationKeys.set(key, actionKey);
  render();
  try {
    const result = await operation(actionKey);
    state.mutationKeys.delete(key);
    if (successMessage) setToast(successMessage);
    return result;
  } catch (error) {
    setToast(error?.message || "That action could not be completed.", "error");
    return null;
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleClick(event) {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    event.preventDefault();
    navigate(nav.dataset.nav);
    return;
  }
  const folder = event.target.closest("[data-open-folder]");
  if (folder) {
    navigate(`/files/folders/${encodeURIComponent(folder.dataset.openFolder)}`);
    return;
  }
  const select = event.target.closest("[data-select-asset]");
  if (select) {
    const id = select.dataset.selectAsset;
    if (state.selection.has(id)) state.selection.delete(id);
    else if (state.selection.size >= 10) {
      setToast("A Polis carousel can include up to 10 media items.", "error");
      return;
    } else state.selection.add(id);
    render();
    return;
  }
  const move = event.target.closest("[data-post-move]");
  if (move) {
    const ids = Array.from(state.selection);
    const index = ids.indexOf(move.dataset.id);
    const targetIndex =
      move.dataset.postMove === "back" ? index - 1 : index + 1;
    if (index >= 0 && targetIndex >= 0 && targetIndex < ids.length) {
      [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
      state.selection = new Set(ids);
      render();
    }
    return;
  }
  const layout = event.target.closest("[data-layout]");
  if (layout) {
    state.layout = layout.dataset.layout;
    writeStorage(STORED_LAYOUT_KEY, state.layout);
    render();
    return;
  }
  const tab = event.target.closest("[data-folder-tab]");
  if (tab && state.folder) {
    navigate(
      `/files/folders/${encodeURIComponent(entityId(state.folder))}?tab=${tab.dataset.folderTab}`,
    );
    return;
  }
  const suggestion = event.target.closest("[data-suggestion]");
  if (suggestion) {
    await actOnSuggestion(suggestion.dataset.id, suggestion.dataset.suggestion);
    return;
  }
  const proposal = event.target.closest("[data-proposal-decision]");
  if (proposal) {
    state.modal = {
      type: "confirm-decision",
      proposalId: proposal.dataset.id,
      decision: proposal.dataset.proposalDecision,
      expectedVersion: proposal.dataset.version || undefined,
    };
    render();
    return;
  }
  const incomingGrant = event.target.closest("[data-grant-request-action]");
  if (incomingGrant) {
    await respondToGrantRequest(
      incomingGrant.dataset.id,
      incomingGrant.dataset.grantRequestAction,
      incomingGrant.dataset.version,
    );
    return;
  }
  const grant = event.target.closest("[data-grant-action]");
  if (grant) {
    await changeGrant(
      grant.dataset.id,
      grant.dataset.grantAction,
      grant.dataset.version,
    );
    return;
  }
  const edition = event.target.closest("[data-edition-action]");
  if (edition) {
    await changeEdition(edition.dataset.id, edition.dataset.editionAction);
    return;
  }
  const uploadAction = event.target.closest("[data-upload-action]");
  if (uploadAction) {
    if (uploadAction.dataset.uploadAction === "cancel")
      await cancelUpload(uploadAction.dataset.id);
    if (uploadAction.dataset.uploadAction === "retry")
      retryUpload(uploadAction.dataset.id);
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "sign-in") {
    setSharedFeedPostAuthPath("/files");
    if (hasHostedSignInConfig(authConfig))
      await startHostedSignIn(authConfig, { returnPath: "/files" });
    else window.location.assign("/auth?returnTo=%2Ffiles");
  }
  if (action === "retry") bootstrap();
  if (action === "reload-view") loadRoute();
  if (action === "close-modal") {
    state.modal = null;
    render();
  }
  if (action === "select-all") {
    const mediaIds = state.folderData.assets
      .filter(isPostSelectableMedia)
      .map(entityId);
    const allSelected =
      mediaIds.length > 0 && mediaIds.every((id) => state.selection.has(id));
    if (allSelected) {
      state.selection = new Set();
      render();
    } else if (mediaIds.length > 10) {
      setToast(
        `This folder has ${mediaIds.length} media items. Choose up to 10 individually for a Polis carousel.`,
        "error",
      );
    } else {
      state.selection = new Set(mediaIds);
      render();
    }
  }
  if (action === "bulk-download") await downloadSelectedAssets();
  if (action === "new-folder") {
    state.modal = { type: "new-folder" };
    render();
  }
  if (action === "open-upload") {
    state.modal = {
      type: "upload",
      folderId: entityId(state.folder) || entityId(workspaceRoots()[0]),
    };
    render();
  }
  if (action === "new-share") {
    state.modal = {
      type: "new-share",
      shareType: "organization_role",
      targets: [],
      roles: [],
      members: [],
      loadingTargets: true,
    };
    render();
    await loadShareTargets();
  }
  if (action === "open-settings") {
    state.modal = { type: "settings" };
    render();
  }
  if (action === "folder-settings") {
    state.modal = {
      type: "folder-settings",
      settings: { ...(state.folder?.settings || {}) },
    };
    render();
  }
  if (action === "new-proposal") {
    state.modal = {
      type: "proposal",
      operationType: "add",
      targetAssetId: Array.from(state.selection)[0] || "",
    };
    render();
  }
  if (action === "new-edition") {
    state.modal = { type: "edition" };
    render();
  }
  if (action === "archive-folder") {
    state.modal = { type: "archive-folder" };
    render();
  }
  if (action === "open-post") {
    if (!postProvenanceEnabled()) {
      setToast("This folder cannot be used to create Polis posts.", "error");
      return;
    }
    state.postDraft.open = true;
    state.postDraft.focused = false;
    render();
  }
  if (action === "close-post") {
    state.postDraft.open = false;
    render();
  }
}

async function handleChange(event) {
  if (event.target.matches('[data-action="switch-workspace"]')) {
    const selected = state.workspaces.find(
      (item) => item.filesWorkspaceId === event.target.value,
    );
    if (selected) await selectWorkspace(selected);
  }
  if (event.target.matches('[data-action="sort"]')) {
    state.sort = event.target.value;
    await loadRoute();
  }
  if (event.target.matches('[data-action="upload-folder"]'))
    state.modal.folderId = event.target.value;
  if (event.target.matches('[data-action="pick-files"]'))
    addUploads(event.target.files);
  if (event.target.matches("[data-proposal-upload]")) {
    const operationType = state.modal?.operationType || "add";
    const targetAssetId = state.modal?.targetAssetId || "";
    const form = event.target.closest("form");
    const proposalData = new FormData(form);
    const title = normalizeString(proposalData.get("title"));
    const description = normalizeString(proposalData.get("description"));
    if (!title || !description) {
      setToast(
        "Add a title and explanation before choosing the file.",
        "error",
      );
    } else if (operationType === "replace" && !targetAssetId) {
      setToast(
        "Choose the current asset before uploading its replacement.",
        "error",
      );
    } else {
      const started = addUploads(event.target.files, {
        intent: "proposal",
        proposal: {
          action: operationType === "replace" ? "replace" : "add",
          ...(targetAssetId ? { targetAssetId } : {}),
          title,
          description,
        },
      });
      if (started) {
        state.modal = null;
        setToast(
          "Proposal upload started. It will enter review after scanning.",
        );
      }
    }
  }
  if (event.target.matches("[data-resume-upload]"))
    resumeUpload(event.target.dataset.resumeUpload, event.target.files?.[0]);
  if (event.target.matches('[data-action="share-type"]')) {
    state.modal.shareType = event.target.value;
    render();
  }
  if (event.target.matches('[data-action="share-target"]')) {
    state.modal.targetValue = event.target.value;
    const target = selectedShareTarget();
    if (
      state.modal.shareType === "restricted_user" &&
      target?.canShareRestricted !== true
    ) {
      state.modal.shareType = "user";
      setToast(
        "This connection permits standard sharing only. Choose a named-person share instead.",
        "error",
      );
    }
    await loadShareAccessOptions();
  }
  if (event.target.matches('[data-action="share-role"]')) {
    state.modal.roleId = event.target.value;
    const role = (state.modal.roles || []).find(
      (item) => item.roleId === state.modal.roleId,
    );
    const suggestedPurpose = purposeKeysForRole(
      role,
      state.modal.rolePurposeMappings,
    )[0];
    if (suggestedPurpose) state.modal.audiencePurposeKey = suggestedPurpose;
    render();
  }
  if (event.target.matches('[data-action="share-purpose"]')) {
    state.modal.audiencePurposeKey = event.target.value;
  }
  if (event.target.matches('[data-action="proposal-operation"]')) {
    state.modal.operationType = event.target.value;
    render();
  }
  if (event.target.matches('[data-action="proposal-target"]')) {
    state.modal.targetAssetId = event.target.value;
  }
  if (event.target.matches('[data-action="folder-inherit"]')) {
    state.modal.settings = {
      ...(state.modal.settings || {}),
      inheritWorkspace: event.target.checked,
    };
    render();
  }
  if (event.target.matches('input[name="presetKey"]')) {
    state.modal.presetKey = event.target.value;
    render();
  }
}

function handleInput(event) {
  const kind = event.target.dataset.shareSearch;
  if (!kind || state.modal?.type !== "new-share") return;
  if (shareSearchTimer) window.clearTimeout(shareSearchTimer);
  if (kind === "targets") state.modal.targetQuery = event.target.value;
  else state.modal.optionsQuery = event.target.value;
  shareSearchTimer = window.setTimeout(() => {
    if (kind === "targets")
      loadShareTargets(state.modal.targetQuery).catch(() => {});
    else loadShareAccessOptions(state.modal.optionsQuery).catch(() => {});
  }, 250);
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const name = form.dataset.form;
  if (name === "search") {
    state.search = normalizeString(data.get("search"));
    await loadRoute();
  }
  if (name === "setup") await submitSetup(data, event.submitter?.value);
  if (name === "new-folder") await submitNewFolder(data);
  if (name === "new-share") await submitShare(data);
  if (name === "settings") await submitSettings(data);
  if (name === "folder-settings") await submitFolderSettings(data);
  if (name === "proposal") await submitProposal(data);
  if (name === "proposal-decision") await submitProposalDecision(data);
  if (name === "edition") await submitEdition(data);
  if (name === "suggestion-edit") await submitSuggestionEdit(data);
  if (name === "archive-folder") await submitArchiveFolder(data);
  if (name === "post-draft") await submitPostDraft(data);
}

async function submitSetup(data, intent) {
  const principal = principalOf();
  const presetKey =
    intent === "skip"
      ? "blank"
      : normalizeString(data.get("presetKey")) || "blank";
  const result = await withBusy(
    "setup",
    (actionKey) =>
      api.initializeWorkspace(
        principal.type,
        principal.id,
        {
          presetKey,
          settings: {
            version: 1,
            defaultView: "my_files",
            suggestions: {
              contextMatches: data.has("contextMatchingEnabled"),
              socialPosts: true,
              duplicateMedia: true,
              aiAssistance: data.has("aiSuggestionsEnabled"),
            },
            automations: {
              contextSharingPrompts: true,
              newMediaPostPrompts: data.has("eventMediaPromptsEnabled"),
              usageBadges: true,
            },
            notifications: {
              shares: true,
              proposals: true,
              reviews: true,
              automations: true,
            },
            rolePurposeMappings: {},
          },
        },
        { idempotencyKey: actionKey },
      ),
    "Files is ready.",
  );
  if (!result) return;
  state.modal = null;
  state.workspace = normalizeWorkspacePayload(result) || {
    ...state.workspace,
    setup: { initialized: true, presetKey },
  };
  const refreshed = await api.getWorkspace(principal.type, principal.id);
  state.workspace = normalizeWorkspacePayload(refreshed);
  await loadRoute();
}

async function submitNewFolder(data) {
  const principal = principalOf();
  const result = await withBusy(
    "folder",
    (actionKey) =>
      api.createFolder(
        principal.type,
        principal.id,
        {
          name: normalizeString(data.get("name")),
          description: normalizeString(data.get("description")),
          context: {
            countryCode: "US",
            stateCode: normalizeString(data.get("stateCode")),
            office: normalizeString(data.get("office")),
            district: normalizeString(data.get("district")),
            cycle: normalizeString(data.get("cycle")),
            boundaryVintage: normalizeString(data.get("boundaryVintage")),
            effectiveFrom: normalizeString(data.get("effectiveFrom")),
            effectiveTo: normalizeString(data.get("effectiveTo")),
          },
          reviewRequired: data.has("reviewRequired"),
        },
        { idempotencyKey: actionKey },
      ),
    "Folder created.",
  );
  if (!result) return;
  state.modal = null;
  const folder = result.folder || result;
  if (entityId(folder))
    navigate(`/files/folders/${encodeURIComponent(entityId(folder))}`);
  else await loadRoute();
}

async function submitShare(data) {
  const subjectType = normalizeString(data.get("subjectType"));
  const restricted = subjectType === "restricted_user";
  const selectedTargetValue = normalizeString(data.get("targetPrincipal"));
  const target = selectedShareTarget();
  const targetPrincipal = target?.principal || target;
  const recipientPrincipal =
    target && shareTargetValue(target) === selectedTargetValue
      ? {
          type: normalizeString(targetPrincipal?.type),
          id: normalizeString(targetPrincipal?.id),
          ...(targetPrincipal?.key
            ? { key: normalizeString(targetPrincipal.key) }
            : {}),
        }
      : null;
  const relationshipId = normalizeString(target?.relationship?.relationshipId);
  const roleId = normalizeString(data.get("roleId"));
  const recipientUserIds = data
    .getAll("recipientUserIds")
    .map(normalizeString)
    .filter(Boolean);
  if (!recipientPrincipal) {
    setToast("Choose an active connected workspace.", "error");
    return;
  }
  if (!relationshipId) {
    setToast(
      "This connection is missing its share authorization. Refresh the connection before sharing.",
      "error",
    );
    return;
  }
  if (restricted && target.canShareRestricted !== true) {
    setToast("This connection does not permit restricted sharing.", "error");
    return;
  }
  if (!restricted && target.canShareStandard === false) {
    setToast(
      "This connection does not permit standard folder sharing.",
      "error",
    );
    return;
  }
  if (subjectType === "organization_role" && !roleId) {
    setToast("Choose an eligible role.", "error");
    return;
  }
  if (subjectType !== "organization_role" && !recipientUserIds.length) {
    setToast("Choose at least one eligible named person.", "error");
    return;
  }
  const purpose = normalizeString(data.get("purpose"));
  const expiresAt = normalizeString(data.get("expiresAt"));
  if (restricted && (!purpose || !expiresAt)) {
    setToast(
      "Restricted access requires both a purpose and an expiry date.",
      "error",
    );
    return;
  }
  const audiencePurposeKey = normalizeString(data.get("audiencePurposeKey"));
  if (!audiencePurposeKey) {
    setToast("Choose the team function for this share.", "error");
    return;
  }
  const accessTier = normalizeString(data.get("accessTier")) || "view";
  if (restricted && accessTier === "maintain") {
    setToast(
      "Restricted access can be view-only or allow suggestions, but cannot grant maintenance rights.",
      "error",
    );
    return;
  }
  const grant = {
    recipientPrincipal,
    relationshipId,
    accessTier,
    audiencePurposeKey,
    recipientRoleIds: subjectType === "organization_role" ? [roleId] : [],
    recipientUserIds:
      subjectType === "organization_role" ? [] : recipientUserIds,
    purpose: restricted ? purpose : "",
    expiresAt: restricted ? expiresAt : null,
    allowDownload: restricted && data.has("allowDownload"),
    restriction: restricted ? "restricted" : "standard",
    expectedVersion: state.folder?.version,
  };
  const result = await withBusy(
    "share",
    (actionKey) =>
      api.createGrant(entityId(state.folder), grant, {
        idempotencyKey: actionKey,
      }),
    restricted
      ? "Restricted access entered two-person review."
      : "Folder access shared.",
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function loadShareTargets(query = "") {
  if (state.modal?.type !== "new-share") return;
  state.modal.loadingTargets = true;
  render();
  try {
    const principal = principalOf();
    const payload = await api.getShareTargets(principal.type, principal.id, {
      q: normalizeString(query),
      limit: 50,
    });
    if (state.modal?.type !== "new-share") return;
    state.modal.targets = firstArray(payload, ["targets", "items"]);
    state.modal.targetQuery = normalizeString(query);
  } catch (error) {
    setToast(
      error?.message || "Connected share targets could not be loaded.",
      "error",
    );
  } finally {
    if (state.modal?.type === "new-share") {
      state.modal.loadingTargets = false;
      render();
    }
  }
}

async function loadShareAccessOptions(query = "") {
  if (state.modal?.type !== "new-share") return;
  const [type, ...idParts] = normalizeString(state.modal.targetValue).split(
    ":",
  );
  const id = idParts.join(":");
  state.modal.roles = [];
  state.modal.members = [];
  if (!type || !id) {
    render();
    return;
  }
  state.modal.loadingOptions = true;
  render();
  try {
    const payload = await api.getShareTargetAccessOptions(type, id, {
      q: normalizeString(query),
      limit: 75,
      folderId: entityId(state.folder),
    });
    if (state.modal?.type !== "new-share") return;
    state.modal.roles = firstArray(payload, ["roles"]);
    state.modal.members = firstArray(payload, ["members"]);
    state.modal.rolePurposeMappings =
      payload?.rolePurposeMappings || payload?.purposeMappings || [];
    state.modal.restrictedRequirements = payload?.restrictedRequirements || {};
    if (!state.modal.audiencePurposeKey) {
      state.modal.audiencePurposeKey = state.modal.roles
        .flatMap((role) =>
          purposeKeysForRole(role, state.modal.rolePurposeMappings),
        )
        .find(Boolean);
    }
    state.modal.optionsQuery = normalizeString(query);
  } catch (error) {
    setToast(
      error?.message || "Eligible roles and members could not be loaded.",
      "error",
    );
  } finally {
    if (state.modal?.type === "new-share") {
      state.modal.loadingOptions = false;
      render();
    }
  }
}

function settingsFromData(data, { folder = false } = {}) {
  if (folder && data.has("inheritWorkspace")) {
    return { inheritWorkspace: true };
  }
  const current = state.modal?.settings || state.workspace?.settings || {};
  const updated = {
    suggestions: {
      contextMatches: data.has("contextMatchingEnabled"),
      socialPosts: data.has("postSuggestionsEnabled"),
      aiAssistance: data.has("aiSuggestionsEnabled"),
    },
    automations: {
      usageBadges: data.has("postUsageBadgesEnabled"),
    },
  };
  if (folder) return { inheritWorkspace: false, ...updated };
  return {
    version: Number(current.version || 1),
    defaultView: normalizeString(current.defaultView) || "my_files",
    suggestions: {
      ...current.suggestions,
      ...updated.suggestions,
      duplicateMedia: current.suggestions?.duplicateMedia !== false,
    },
    automations: {
      ...current.automations,
      contextSharingPrompts: data.has("connectionSharePromptsEnabled"),
      newMediaPostPrompts: data.has("eventMediaPromptsEnabled"),
      ...updated.automations,
    },
    notifications: {
      ...current.notifications,
      shares: current.notifications?.shares !== false,
      proposals: current.notifications?.proposals !== false,
      reviews: current.notifications?.reviews !== false,
      automations: data.has("uploadNotificationsEnabled"),
    },
    rolePurposeMappings: current.rolePurposeMappings || {},
  };
}

async function submitSettings(data) {
  const principal = principalOf();
  const result = await withBusy(
    "settings",
    (actionKey) =>
      api.updateSettings(
        principal.type,
        principal.id,
        {
          settings: settingsFromData(data),
          expectedVersion:
            state.workspace?.settingsVersion ||
            state.workspace?.revision ||
            state.workspace?.version ||
            state.workspace?.etag,
        },
        { idempotencyKey: actionKey },
      ),
    "Files settings saved.",
  );
  if (!result) return;
  state.workspace.settings = result.settings || settingsFromData(data);
  state.modal = null;
}

async function submitFolderSettings(data) {
  const settings = settingsFromData(data, { folder: true });
  if (folderIsRestricted() && settings.suggestions) {
    settings.suggestions.aiAssistance = false;
    settings.suggestions.socialPosts = false;
  }
  const result = await withBusy(
    "folder-settings",
    (actionKey) =>
      api.updateFolder(
        entityId(state.folder),
        {
          name: normalizeString(data.get("name")),
          reviewRequired: data.has("reviewRequired"),
          settings,
          expectedVersion: state.folder?.version || state.folder?.revision,
        },
        { idempotencyKey: actionKey },
      ),
    "Folder settings saved.",
  );
  if (!result) return;
  state.folder = result.folder || result;
  state.modal = null;
  await loadRoute();
}

async function submitProposal(data) {
  const operationType = normalizeString(data.get("operationType"));
  const targetAssetId = normalizeString(data.get("targetAssetId"));
  let operation;
  if (["add", "replace"].includes(operationType)) {
    setToast(
      "Choose the proposal file above; Polis creates the review request after scanning.",
      "error",
    );
    return;
  } else if (operationType === "rename") {
    const name = normalizeString(data.get("operationName"));
    operation =
      targetAssetId && name
        ? { type: "rename", assetId: targetAssetId, name }
        : null;
  } else if (operationType === "move") {
    const destinationFolderId = normalizeString(
      data.get("destinationFolderId"),
    );
    operation =
      targetAssetId && destinationFolderId
        ? { type: "move", assetId: targetAssetId, destinationFolderId }
        : null;
  } else if (operationType === "metadata") {
    const metadataKey = normalizeString(data.get("metadataKey"));
    const metadataValue = normalizeString(data.get("metadataValue"));
    operation =
      targetAssetId && metadataKey && metadataValue
        ? {
            type: "metadata",
            assetId: targetAssetId,
            metadata: { [metadataKey]: metadataValue },
          }
        : null;
  } else if (operationType === "delete") {
    operation = targetAssetId
      ? { type: "delete", assetId: targetAssetId }
      : null;
  }
  if (!operation) {
    setToast("Complete the selected change before submitting it.", "error");
    return;
  }
  const result = await withBusy(
    "proposal",
    (actionKey) =>
      api.createProposal(
        entityId(state.folder),
        {
          title: normalizeString(data.get("title")),
          description: normalizeString(data.get("description")),
          operations: [operation],
          expectedVersion: state.folder?.version || state.folder?.revision,
        },
        { idempotencyKey: actionKey },
      ),
    "Change submitted for review.",
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitProposalDecision(data) {
  const modal = state.modal;
  const result = await withBusy(
    "review",
    (actionKey) =>
      api.reviewProposal(
        modal.proposalId,
        {
          decision: modal.decision,
          reason: normalizeString(data.get("reason")),
          expectedVersion: modal.expectedVersion,
        },
        { idempotencyKey: actionKey },
      ),
    modal.decision === "approve"
      ? "Proposal approved and merged."
      : modal.decision === "request_changes"
        ? "Changes requested from the contributor."
        : "Proposal refused.",
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitEdition(data) {
  const result = await withBusy(
    "edition",
    (actionKey) =>
      api.createEdition(
        entityId(state.folder),
        {
          label: normalizeString(data.get("label")),
          type: normalizeString(data.get("type")),
          effectiveYear: normalizeString(data.get("effectiveYear")) || null,
          cycle: normalizeString(data.get("cycle")) || null,
          boundaryVintage: normalizeString(data.get("boundaryVintage")) || null,
          effectiveFrom: normalizeString(data.get("effectiveFrom")) || null,
          effectiveTo: normalizeString(data.get("effectiveTo")) || null,
          expectedVersion: state.folder?.version || state.folder?.revision,
        },
        { idempotencyKey: actionKey },
      ),
    "New edition created.",
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitSuggestionEdit(data) {
  const suggestion = state.suggestions.find(
    (item) => entityId(item) === state.modal?.suggestionId,
  );
  const existingRecommendation = suggestion?.recommendation || {};
  const assetIds = firstArray(existingRecommendation, ["assetIds"])
    .map(normalizeString)
    .filter(Boolean)
    .slice(0, 10);
  const scheduledForInput = normalizeString(data.get("scheduledFor"));
  const scheduledFor = scheduledForInput
    ? new Date(scheduledForInput).toISOString()
    : null;
  const result = await withBusy(
    "suggestion",
    (actionKey) =>
      api.changeSuggestion(
        entityId(suggestion),
        "edit",
        {
          expectedVersion: suggestion?.version || suggestion?.revision,
          recommendation: {
            caption: normalizeString(data.get("caption")),
            ...(assetIds.length ? { assetIds } : {}),
            scheduledFor,
          },
        },
        { idempotencyKey: actionKey },
      ),
    "Edited recommendation accepted.",
  );
  if (!result) return;
  state.suggestions = state.suggestions.filter(
    (item) => entityId(item) !== entityId(suggestion),
  );
  state.modal = null;
}

async function submitArchiveFolder(data) {
  const result = await withBusy(
    "archive-folder",
    (actionKey) =>
      api.archiveFolder(
        entityId(state.folder),
        {
          reason: normalizeString(data.get("reason")),
          expectedVersion: state.folder?.version || state.folder?.revision,
        },
        { idempotencyKey: actionKey },
      ),
    "Folder archived with its history preserved.",
  );
  if (!result) return;
  state.modal = null;
  navigate("/files");
}

async function submitPostDraft(data) {
  if (!postProvenanceEnabled()) {
    setToast("This folder cannot be used to create Polis posts.", "error");
    return;
  }
  const selected = selectedAssets();
  if (!selected.length) {
    setToast(
      "Choose at least one ready image or video for this post.",
      "error",
    );
    return;
  }
  if (selected.length > 10) {
    setToast("A Polis carousel can include at most 10 media items.", "error");
    return;
  }
  if (selected.some((item) => !assetIsReady(item) || !isMedia(item))) {
    setToast(
      "Every post item must be a ready image or video. Wait for scanning or remove unsupported files.",
      "error",
    );
    return;
  }
  if (
    selected.some(
      (item) =>
        !(
          item.sourceAssetVersionId ||
          item.assetVersionId ||
          item.revisionId ||
          item.currentRevisionId
        ),
    )
  ) {
    setToast(
      "One or more media items are missing an immutable source version.",
      "error",
    );
    return;
  }
  const result = await withBusy(
    "post",
    (actionKey) =>
      api.createPostDraft(
        {
          filesWorkspaceId: state.workspace.filesWorkspaceId,
          folderId: entityId(state.folder),
          description: normalizeString(data.get("description")),
          mediaItems: selected.map((item, order) => {
            const sourceAssetVersionId =
              item.sourceAssetVersionId ||
              item.assetVersionId ||
              item.revisionId ||
              item.currentRevisionId;
            return {
              assetId: entityId(item),
              sourceAssetVersionId,
              mediaType:
                normalizeString(item.mediaType) ||
                (normalizeString(item.mimeType || item.contentType).startsWith(
                  "video/",
                )
                  ? "video"
                  : "image"),
              altText: normalizeString(item.altText || item.metadata?.altText),
              ...(item.crop || item.metadata?.crop
                ? { crop: item.crop || item.metadata.crop }
                : {}),
              order,
            };
          }),
        },
        { idempotencyKey: actionKey },
      ),
    "Post draft created with Files provenance.",
  );
  if (!result) return;
  state.postDraft.open = false;
  state.selection.clear();
  const postPath = safePostPath(result.postPath, result.postId);
  if (postPath) window.location.assign(postPath);
}

async function actOnSuggestion(id, action) {
  const suggestion = state.suggestions.find((item) => entityId(item) === id);
  if (action === "edit") {
    state.modal = { type: "suggestion-edit", suggestionId: id };
    render();
    return;
  }
  if (action === "disable") {
    if (!can("canManageAutomations", "files_automations_manage")) {
      setToast(
        "You do not have permission to disable Files automations.",
        "error",
      );
      return;
    }
    const aiGenerated =
      suggestion?.engine === "ai" || suggestion?.source === "ai";
    const result = await withBusy(
      "suggestion",
      (actionKey) =>
        api.changeSuggestion(
          id,
          "disable",
          {
            expectedVersion: suggestion?.version || suggestion?.revision,
            scope: "folder",
          },
          { idempotencyKey: actionKey },
        ),
      aiGenerated
        ? "AI assistance disabled."
        : "Rule-based media prompts disabled.",
    );
    if (!result) return;
    state.suggestions = state.suggestions.filter(
      (item) => entityId(item) !== id,
    );
    return;
  }
  const snoozedUntil = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await withBusy(
    "suggestion",
    (actionKey) =>
      api.changeSuggestion(
        id,
        action,
        {
          expectedVersion: suggestion?.version || suggestion?.revision,
          ...(action === "snooze" ? { snoozedUntil } : {}),
        },
        { idempotencyKey: actionKey },
      ),
    action === "accept"
      ? "Recommendation accepted."
      : action === "snooze"
        ? "Recommendation snoozed for one week."
        : "Recommendation dismissed.",
  );
  if (!result) return;
  state.suggestions = state.suggestions.filter((item) => entityId(item) !== id);
  const folderId = result.folderId || result.folder?.folderId;
  if (action === "accept" && folderId)
    navigate(`/files/folders/${encodeURIComponent(folderId)}?tab=access`);
}

async function downloadSelectedAssets() {
  const selected = selectedAssets().filter(
    (item) =>
      !item.restricted ||
      can("canDownloadRestricted", "files_restricted_download"),
  );
  if (!selected.length) {
    setToast(
      "You do not have download access for the selected restricted media.",
      "error",
    );
    return;
  }
  const downloads = await withBusy("download", () =>
    Promise.all(selected.map((item) => api.getAssetDownload(entityId(item)))),
  );
  if (!downloads) return;
  downloads.forEach((download, index) => {
    const url = normalizeString(download?.downloadUrl || download?.url);
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entityName(selected[index]);
    anchor.rel = "noopener";
    anchor.click();
  });
  setToast(
    `${downloads.length} download${downloads.length === 1 ? "" : "s"} prepared.`,
  );
}

async function changeGrant(id, action, expectedVersion) {
  const result = await withBusy(
    `grant:${id}:${action}`,
    (actionKey) =>
      api.changeGrant(
        id,
        action,
        { expectedVersion: expectedVersion || undefined },
        { idempotencyKey: actionKey },
      ),
    action === "approve" ? "Restricted access approved." : "Access revoked.",
  );
  if (result) await loadRoute();
}

async function respondToGrantRequest(id, action, expectedVersion) {
  if (!id || !["accept", "decline"].includes(action)) return;
  const result = await withBusy(
    `incoming-grant:${id}:${action}`,
    (actionKey) =>
      api.changeGrant(
        id,
        action,
        {
          expectedVersion: expectedVersion || undefined,
          ...(action === "decline"
            ? { reason: "Declined by the named recipient" }
            : {}),
        },
        { idempotencyKey: actionKey },
      ),
    action === "accept"
      ? "Restricted folder access accepted."
      : "Access request declined.",
  );
  if (!result) return;
  state.incomingGrantRequests = state.incomingGrantRequests.filter(
    (request) =>
      normalizeString(request?.grantId || request?.grant?.grantId) !== id,
  );
  const folderId = normalizeString(result?.grant?.folderId || result?.folderId);
  if (action === "accept" && folderId) {
    navigate(`/files/folders/${encodeURIComponent(folderId)}`);
  } else {
    render();
  }
}

async function changeEdition(id, action) {
  const edition = state.folderData.editions.find(
    (item) => entityId(item) === id,
  );
  const result = await withBusy(
    `edition:${id}:${action}`,
    (actionKey) =>
      api.changeEdition(
        id,
        action,
        { expectedVersion: edition?.version || edition?.revision },
        { idempotencyKey: actionKey },
      ),
    "Current edition updated.",
  );
  if (result) await loadRoute();
}

function addUploads(fileList, { intent = "", proposal = null } = {}) {
  const folderId =
    state.modal?.folderId ||
    entityId(state.folder) ||
    entityId(workspaceRoots()[0]);
  if (!folderId) {
    setToast("Choose or create a destination folder first.", "error");
    return false;
  }
  const resolvedIntent =
    normalizeString(intent) ||
    (state.folder && entityId(state.folder) === folderId
      ? folderUploadIntent(state.folder)
      : can("canUpload", "files_upload")
        ? "commit"
        : null);
  if (!resolvedIntent) {
    setToast(
      "You can view this folder, but cannot add or propose files.",
      "error",
    );
    return false;
  }
  const additions = Array.from(fileList || []).map((file) => ({
    id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    file,
    folderId,
    intent: resolvedIntent,
    proposal:
      resolvedIntent === "proposal"
        ? proposal || {
            action: "add",
            title: `Add ${file.name}`,
            description: "Submitted from shared Files access for review.",
          }
        : null,
    progress: 0,
    status: "queued",
    error: "",
  }));
  state.uploadQueue.push(...additions);
  persistUploadCheckpoints();
  render();
  additions.forEach(startUpload);
  return additions.length > 0;
}

function normalizedUploadSession(payload) {
  return payload?.uploadSession || payload?.session || payload;
}

function uploadProposalId(session, fallback = "") {
  return normalizeString(
    session?.proposal?.proposalId ||
      session?.proposalId ||
      session?.asset?.proposalId ||
      fallback,
  );
}

function uploadPartTarget(payload, partNumber) {
  return firstArray(payload, ["parts", "signedParts", "items"]).find(
    (part) => Number(part?.partNumber) === Number(partNumber),
  );
}

function persistUploadCheckpoints() {
  const userId = normalizeString(state.user?.userId);
  if (!userId) {
    purgeUploadCheckpoints();
    return;
  }
  const checkpoints = state.uploadQueue
    .filter((item) => !["complete", "cancelled"].includes(item.status))
    .map((item) => ({
      id: item.id,
      folderId: item.folderId,
      userId,
      sessionId: item.sessionId || "",
      sessionVersion: item.sessionVersion,
      assetId: item.assetId || "",
      revisionId: item.revisionId || "",
      proposalId: item.proposalId || "",
      intent: item.intent || "commit",
      proposal: item.proposal || null,
      scanPollAttempts: item.scanPollAttempts || 0,
      checksumSha256: item.checksumSha256 || "",
      partSize: item.partSize || 0,
      totalParts: item.totalParts || 0,
      completedParts: item.completedParts || [],
      progress: item.progress || 0,
      fileMetadata:
        item.fileMetadata ||
        (item.file
          ? {
              name: item.file.name,
              size: item.file.size,
              type: item.file.type || "application/octet-stream",
              lastModified: item.file.lastModified,
            }
          : null),
    }));
  if (!checkpoints.length) {
    try {
      window.sessionStorage.removeItem(STORED_UPLOADS_KEY);
    } catch {
      // There is no resumable state to retain.
    }
    return;
  }
  try {
    window.sessionStorage.setItem(
      STORED_UPLOADS_KEY,
      JSON.stringify({ version: 1, userId, items: checkpoints }),
    );
  } catch {
    // Resume is best effort when browser storage is unavailable.
  }
}

function restoreUploadCheckpoints() {
  let payload = null;
  try {
    payload = JSON.parse(
      window.sessionStorage.getItem(STORED_UPLOADS_KEY) || "[]",
    );
  } catch {
    payload = null;
  }
  const userId = normalizeString(state.user?.userId);
  if (
    !payload ||
    Array.isArray(payload) ||
    normalizeString(payload.userId) !== userId
  ) {
    purgeUploadCheckpoints();
    return;
  }
  const checkpoints = Array.isArray(payload.items) ? payload.items : [];
  state.uploadQueue = Array.isArray(checkpoints)
    ? checkpoints.map((item) => ({
        ...item,
        file: null,
        status: "paused",
        error: "",
      }))
    : [];
}

function purgeUploadCheckpoints() {
  state.uploadPollTimers.forEach((timer) => window.clearTimeout(timer));
  state.uploadPollTimers.clear();
  state.uploadQueue = [];
  try {
    window.sessionStorage.removeItem(STORED_UPLOADS_KEY);
  } catch {
    // Nothing else to purge when storage is unavailable.
  }
}

function applyUploadSessionState(item, session) {
  item.sessionVersion = session?.version || item.sessionVersion;
  item.assetId = normalizeString(session?.assetId || item.assetId);
  item.revisionId = normalizeString(session?.revisionId || item.revisionId);
  item.proposalId = uploadProposalId(session, item.proposalId);
  item.intent = normalizeString(session?.intent || item.intent) || "commit";
  item.proposal = session?.proposal || item.proposal || null;
  const uploadedParts = firstArray(session, ["uploadedParts"]);
  if (uploadedParts.length) item.completedParts = uploadedParts;
  item.progress =
    Number(session?.progress || 0) ||
    (item.fileMetadata?.size
      ? Number(session?.bytesUploaded || 0) / item.fileMetadata.size
      : item.progress);
  const sessionState = normalizeString(session?.state).toLowerCase();
  if (["ready", "complete", "completed"].includes(sessionState)) {
    item.status = "complete";
    item.progress = 1;
    item.error = "";
  } else if (["uploaded", "scanning"].includes(sessionState)) {
    item.status = "scanning";
    item.progress = 1;
    item.error = "";
  } else if (sessionState === "quarantined") {
    item.status = "quarantined";
    item.progress = 1;
    item.error = normalizeString(
      session?.scanResult?.message ||
        session?.quarantineReason ||
        "Quarantined · security review did not release this file",
    );
  } else if (["aborted", "expired", "failed"].includes(sessionState)) {
    item.status = "error";
    item.error = `Upload ${sessionState}. Choose the file to try again.`;
  }
}

function scheduleUploadStatusPoll(item, { immediate = false } = {}) {
  if (
    item.status !== "scanning" ||
    !item.sessionId ||
    state.uploadPollTimers.has(item.id)
  ) {
    return;
  }
  const attempts = Number(item.scanPollAttempts || 0);
  if (attempts >= UPLOAD_SCAN_POLL_LIMIT) {
    item.error =
      "Security scan is still processing. Reopen Files later to refresh its status.";
    persistUploadCheckpoints();
    render();
    return;
  }
  const delay = immediate
    ? 0
    : Math.min(UPLOAD_SCAN_POLL_BASE_MS * 2 ** attempts, 5000);
  const timer = window.setTimeout(async () => {
    state.uploadPollTimers.delete(item.id);
    item.scanPollAttempts = attempts + 1;
    await refreshUploadStatus(item, { schedule: true });
  }, delay);
  state.uploadPollTimers.set(item.id, timer);
}

async function refreshUploadStatus(item, { schedule = false } = {}) {
  if (!item?.sessionId) return;
  try {
    const session = normalizedUploadSession(
      await api.getUploadSession(item.sessionId),
    );
    applyUploadSessionState(item, session);
  } catch (error) {
    if (error?.status === 403) {
      purgeUploadCheckpoints();
      render();
      return;
    }
  }
  persistUploadCheckpoints();
  render();
  if (schedule) scheduleUploadStatusPoll(item);
}

async function reconcileUploadCheckpoints() {
  await Promise.all(state.uploadQueue.map((item) => refreshUploadStatus(item)));
  state.uploadQueue
    .filter((item) => item.status === "scanning")
    .forEach((item) => scheduleUploadStatusPoll(item));
  persistUploadCheckpoints();
}

function fileMatchesCheckpoint(file, metadata) {
  return Boolean(
    file &&
      metadata &&
      file.name === metadata.name &&
      file.size === metadata.size &&
      (!metadata.lastModified || file.lastModified === metadata.lastModified),
  );
}

function resumeUpload(id, file) {
  const item = state.uploadQueue.find((entry) => entry.id === id);
  if (!item || !file) return;
  if (!fileMatchesCheckpoint(file, item.fileMetadata)) {
    setToast(
      "Choose the original file with the same name, size, and modified date.",
      "error",
    );
    return;
  }
  item.file = file;
  startUpload(item);
}

async function startUpload(item) {
  if (!item.file) return;
  item.status = "hashing";
  item.error = "";
  const controller = new AbortController();
  state.uploadControllers.set(item.id, controller);
  render();
  try {
    item.fileMetadata = {
      name: item.file.name,
      size: item.file.size,
      type: item.file.type || "application/octet-stream",
      lastModified: item.file.lastModified,
    };
    // The v1 contract requires the whole-file checksum before the server chooses
    // a multipart size. We therefore make two bounded passes (whole file, then
    // per-part checksums) without ever materializing the full file in memory.
    if (!item.checksumSha256) {
      item.checksumSha256 = await checksumBlob(item.file, {
        onProgress: (progress) => {
          item.hashProgress = progress;
          render();
        },
      });
    }
    let session;
    if (item.sessionId) {
      try {
        session = normalizedUploadSession(
          await api.getUploadSession(item.sessionId),
        );
      } catch (error) {
        if (![404, 410].includes(error?.status)) throw error;
        item.sessionId = "";
        item.completedParts = [];
      }
    }
    if (!item.sessionId) {
      session = normalizedUploadSession(
        await api.createUploadSession(
          item.folderId,
          {
            fileName: item.file.name,
            contentType: item.file.type || "application/octet-stream",
            size: item.file.size,
            checksumSha256: item.checksumSha256,
            idempotencyKey: item.id,
            intent: item.intent || "commit",
            ...(item.intent === "proposal" && item.proposal
              ? { proposal: item.proposal }
              : {}),
            expectedVersion: state.folder?.version || state.folder?.revision,
          },
          { idempotencyKey: item.id },
        ),
      );
    }
    item.sessionId = normalizeString(session?.uploadSessionId || session?.id);
    item.sessionVersion = session?.version;
    item.assetId = normalizeString(session?.assetId || item.assetId);
    item.revisionId = normalizeString(session?.revisionId || item.revisionId);
    item.proposalId = uploadProposalId(session, item.proposalId);
    item.intent = normalizeString(session?.intent || item.intent) || "commit";
    item.proposal = session?.proposal || item.proposal || null;
    item.partSize = Number(
      session?.partSize || item.partSize || 5 * 1024 * 1024,
    );
    item.totalParts = Number(
      session?.totalParts || Math.ceil(item.file.size / item.partSize),
    );
    item.completedParts = firstArray(session, ["uploadedParts"]).length
      ? session.uploadedParts
      : item.completedParts || [];
    if (!item.sessionId)
      throw new FilesApiError("The resumable upload session was incomplete.");
    item.status = "uploading";
    persistUploadCheckpoints();

    const completedByNumber = new Map(
      item.completedParts.map((part) => [Number(part.partNumber), part]),
    );
    const completedBytes = () =>
      Array.from(completedByNumber.values()).reduce(
        (total, part) => total + Number(part.size || 0),
        0,
      );
    item.progress = item.file.size ? completedBytes() / item.file.size : 0;
    for (let start = 1; start <= item.totalParts; start += 3) {
      const partNumbers = Array.from(
        { length: Math.min(3, item.totalParts - start + 1) },
        (_, index) => start + index,
      ).filter((partNumber) => !completedByNumber.has(partNumber));
      if (!partNumbers.length) continue;
      const prepared = await Promise.all(
        partNumbers.map(async (partNumber) => {
          const offset = (partNumber - 1) * item.partSize;
          const blob = item.file.slice(
            offset,
            Math.min(offset + item.partSize, item.file.size),
          );
          return { partNumber, blob, checksumSha256: await checksumBlob(blob) };
        }),
      );
      const signed = await api.presignUploadParts(
        item.sessionId,
        {
          parts: prepared.map(({ partNumber, checksumSha256 }) => ({
            partNumber,
            checksumSha256,
          })),
          expectedVersion: item.sessionVersion,
        },
        { idempotencyKey: `${item.id}:presign:${partNumbers.join("-")}` },
      );
      const inFlight = new Map();
      const uploadedParts = await Promise.all(
        prepared.map(async (part) => {
          const target = uploadPartTarget(signed, part.partNumber);
          const url = normalizeString(
            target?.url || target?.uploadUrl || target?.signedUrl,
          );
          if (!url)
            throw new FilesApiError(
              `Upload part ${part.partNumber} was not signed.`,
            );
          const uploaded = await uploadSignedObject({
            url,
            method: target?.method || "PUT",
            headers: target?.headers || target?.requiredHeaders || {},
            file: part.blob,
            signal: controller.signal,
            onProgress: (progress) => {
              inFlight.set(part.partNumber, part.blob.size * progress);
              item.progress = item.file.size
                ? (completedBytes() +
                    Array.from(inFlight.values()).reduce(
                      (sum, value) => sum + value,
                      0,
                    )) /
                  item.file.size
                : 0;
              render();
            },
          });
          return {
            partNumber: part.partNumber,
            etag: uploaded.etag,
            checksumSha256: part.checksumSha256,
            size: part.blob.size,
          };
        }),
      );
      const checkpoint = await api.checkpointUploadParts(
        item.sessionId,
        {
          parts: uploadedParts,
          expectedVersion: item.sessionVersion,
        },
        { idempotencyKey: `${item.id}:checkpoint:${partNumbers.join("-")}` },
      );
      item.sessionVersion =
        normalizedUploadSession(checkpoint)?.version ||
        checkpoint?.version ||
        item.sessionVersion;
      uploadedParts.forEach((part) =>
        completedByNumber.set(part.partNumber, part),
      );
      item.completedParts = Array.from(completedByNumber.values()).sort(
        (left, right) => left.partNumber - right.partNumber,
      );
      item.progress = item.file.size ? completedBytes() / item.file.size : 1;
      persistUploadCheckpoints();
    }
    const completion = await api.completeUpload(
      item.sessionId,
      {
        parts: item.completedParts.map(
          ({ partNumber, etag, checksumSha256 }) => ({
            partNumber,
            etag,
            checksumSha256,
          }),
        ),
        checksumSha256: item.checksumSha256,
        idempotencyKey: `${item.id}:complete`,
        expectedVersion: item.sessionVersion,
      },
      { idempotencyKey: `${item.id}:complete` },
    );
    item.progress = 1;
    applyUploadSessionState(item, normalizedUploadSession(completion));
    if (!item.status || item.status === "uploading") item.status = "scanning";
    persistUploadCheckpoints();
    if (item.status === "scanning") {
      scheduleUploadStatusPoll(item, { immediate: true });
    }
    if (
      state.route.kind === "folder" &&
      entityId(state.folder) === item.folderId
    )
      await loadRoute();
  } catch (error) {
    item.status = error?.name === "AbortError" ? "cancelled" : "error";
    item.error =
      error?.name === "AbortError"
        ? "Cancelled"
        : error?.message || "Upload failed";
    persistUploadCheckpoints();
  } finally {
    state.uploadControllers.delete(item.id);
    render();
  }
}

async function cancelUpload(id) {
  const item = state.uploadQueue.find((entry) => entry.id === id);
  if (!item) return;
  const pollTimer = state.uploadPollTimers.get(id);
  if (pollTimer) window.clearTimeout(pollTimer);
  state.uploadPollTimers.delete(id);
  state.uploadControllers.get(id)?.abort();
  if (item.sessionId) {
    try {
      await api.abortUpload(
        item.sessionId,
        {
          expectedVersion: item.sessionVersion,
          idempotencyKey: `${item.id}:abort`,
        },
        { idempotencyKey: `${item.id}:abort` },
      );
    } catch {
      // Local cancellation is immediate; server abort remains idempotent.
    }
  }
  item.status = "cancelled";
  item.error = "Cancelled";
  persistUploadCheckpoints();
  render();
}

function retryUpload(id) {
  const item = state.uploadQueue.find((entry) => entry.id === id);
  if (item) startUpload(item);
}

function handleDragOver(event) {
  const dropzone = event.target.closest("[data-dropzone]");
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.add("is-dragging");
}

function handleDragLeave(event) {
  event.target.closest("[data-dropzone]")?.classList.remove("is-dragging");
}

function handleDrop(event) {
  const dropzone = event.target.closest("[data-dropzone]");
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  addUploads(event.dataTransfer?.files);
}

function handleKeydown(event) {
  const lockedSetup =
    state.modal?.type === "setup" &&
    !(state.workspace?.setup || {}).initialized;
  if (event.key === "Escape") {
    if (state.modal && !lockedSetup) {
      event.preventDefault();
      state.modal = null;
      render();
    } else if (state.postDraft.open) {
      event.preventDefault();
      state.postDraft.open = false;
      render();
    }
    return;
  }
  if (event.key !== "Tab" || (!state.modal && !state.postDraft.open)) return;
  const layer = root.querySelector(
    state.modal ? ".files-modal" : ".files-post-drawer",
  );
  const focusable = Array.from(
    layer?.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    ) || [],
  ).filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

root?.addEventListener("click", handleClick);
root?.addEventListener("keydown", handleKeydown);
root?.addEventListener("change", handleChange);
root?.addEventListener("input", handleInput);
root?.addEventListener("submit", handleSubmit);
root?.addEventListener("dragover", handleDragOver);
root?.addEventListener("dragleave", handleDragLeave);
root?.addEventListener("drop", handleDrop);
window.addEventListener("popstate", () => {
  state.route = parseRoute();
  loadRoute();
});

bootstrap();
