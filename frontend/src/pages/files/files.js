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
const EDITION_MATERIALIZATION_POLL_LIMIT = 30;
const EDITION_MATERIALIZATION_POLL_BASE_MS = 500;
const EDITION_MATERIALIZATION_POLL_MAX_MS = 5_000;
const HOST_REFERENCE_TUPLES = new Map([
  ["event_recap", ["calendar", "event"]],
  ["message_attachment", ["messaging", "message"]],
  ["mission_artifact", ["missions", "mission"]],
  ["field_brief", ["missions", "field_brief"]],
  ["governance_reference", ["governance", "constitution_version"]],
  ["profile_brand", ["organization", "organization_profile"]],
  ["district_intelligence", ["candidate_onboarding", "district_intelligence"]],
  ["restricted_import", ["files_transfer", "restricted_import_request"]],
  ["restricted_export", ["files_transfer", "restricted_export_request"]],
]);
const VIEW_PATHS = new Map([
  ["recent", "recent"],
  ["shared", "shared_with_me"],
  ["review", "needs_review"],
  ["recommended", "recommended_shares"],
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
  uploadRuns: new Map(),
  uploadSessionCreations: new Map(),
  uploadPollTimers: new Map(),
  modal: null,
  toast: null,
  busyAction: "",
  mutationKeys: new Map(),
  previewEntries: new Map(),
  previewRequests: new Map(),
  previewExpiryTimers: new Map(),
  previewObserver: null,
  previewGeneration: 0,
  previewAccessDenied: false,
  hostReferenceContext: parseHostReferenceContext(),
  hostReferences: [],
  hostReferencesStatus: "idle",
  hostReferenceDetail: null,
  editionMaterialization: null,
  postDraft: { open: false, description: "", usages: new Map() },
};

const api = new FilesApi({
  apiBaseUrl: __POLIS_FILES_API_BASE_URL__,
  getSession: () => state.session,
});
let shareSearchTimer = null;
let editionMaterializationTimer = null;
let editionMaterializationGeneration = 0;

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

function parseHostReferenceContext() {
  const query = new URLSearchParams(window.location.search);
  const context = {
    referenceType: normalizeString(query.get("referenceType")).toLowerCase(),
    hostSourceType: normalizeString(query.get("hostSourceType")).toLowerCase(),
    hostSourceId: normalizeString(query.get("hostSourceId")),
    hostResourceType: normalizeString(
      query.get("hostResourceType"),
    ).toLowerCase(),
    hostResourceId: normalizeString(query.get("hostResourceId")),
    hostResourceVersion: Number(query.get("hostResourceVersion")),
  };
  const safeIdentifier = (value) =>
    Boolean(
      value && value.length <= 200 && /^[a-zA-Z0-9_.:@/-]+$/u.test(value),
    );
  const tuple = HOST_REFERENCE_TUPLES.get(context.referenceType);
  if (
    !tuple ||
    tuple[0] !== context.hostSourceType ||
    tuple[1] !== context.hostResourceType ||
    !safeIdentifier(context.hostSourceId) ||
    !safeIdentifier(context.hostResourceId) ||
    !Number.isSafeInteger(context.hostResourceVersion) ||
    context.hostResourceVersion < 1
  ) {
    return null;
  }
  return context;
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
      entity?.shareSuggestionId ||
      entity?.suggestionId ||
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
  if (segments[1] === "references" && segments[2]) {
    return {
      kind: "reference",
      key: "reference",
      hostReferenceId: decodeURIComponent(segments[2]),
      tab: "current",
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
    reference: "Files reference",
  };
  return state.route.kind === "folder"
    ? entityName(state.folder, "Folder")
    : labels[state.route.key];
}

function authorizationRootOf(
  descriptor = state.workspace || state.workspaceDescriptor,
) {
  const explicit = normalizeString(descriptor?.activeAuthorizationRoot);
  if (["campaign", "official_office", "organization"].includes(explicit)) {
    return explicit;
  }
  const principal = descriptor?.principal || {};
  const sourceType = normalizeString(
    principal.sourceType || principal.type,
  ).toLowerCase();
  if (["official", "elected_official"].includes(sourceType)) {
    return "official_office";
  }
  if (["candidate", "campaign", "political_account"].includes(sourceType)) {
    return "campaign";
  }
  return sourceType === "organization" ? "organization" : "";
}

function activeWorkspaceSetup(
  workspace = state.workspace,
  descriptor = state.workspaceDescriptor,
) {
  const rootKey = authorizationRootOf(workspace || descriptor);
  const byRoot = workspace?.setupByRoot || descriptor?.setupByRoot || {};
  if (rootKey && Object.prototype.hasOwnProperty.call(byRoot, rootKey)) {
    return byRoot[rootKey] || {};
  }
  if (Object.keys(byRoot).length) return {};
  return workspace?.setup || descriptor?.setup || {};
}

function activeRolePurposeMappings(settings = state.workspace?.settings || {}) {
  const rootKey = authorizationRootOf();
  const byRoot = settings?.rolePurposeMappingsByRoot || {};
  if (rootKey && Object.prototype.hasOwnProperty.call(byRoot, rootKey)) {
    return byRoot[rootKey] || {};
  }
  if (Object.keys(byRoot).length) return {};
  return settings?.rolePurposeMappings || {};
}

function activeGovernanceAuthority() {
  const rootKey = authorizationRootOf();
  const authority = state.workspace?.governanceAuthority;
  if (
    !rootKey ||
    !authority ||
    normalizeString(authority.authorizationRoot) !== rootKey
  ) {
    return null;
  }
  const expectedRoleId = normalizeString(
    state.workspace?.governanceAuthorityRoleIds?.[rootKey],
  );
  const expectedRevision = normalizeString(
    state.workspace?.governanceAuthorityRevisions?.[rootKey],
  );
  if (
    (expectedRoleId && normalizeString(authority.roleId) !== expectedRoleId) ||
    (expectedRevision &&
      normalizeString(authority.revision) !== expectedRevision)
  ) {
    return null;
  }
  return authority;
}

function workspaceSelectionKey(descriptor) {
  const principal = descriptor?.principal || {};
  const sourceType = normalizeString(principal.sourceType || principal.type);
  const sourceId = normalizeString(
    sourceType === "official" ? principal.sourceId : principal.id,
  );
  return [
    normalizeString(descriptor?.filesWorkspaceId),
    authorizationRootOf(descriptor),
    `${sourceType}:${sourceId}`,
  ].join("|");
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

function aiSuggestionsAvailable() {
  return workspaceFlags().aiSuggestionsEnabled === true;
}

function hostReferencesEnabled() {
  return Boolean(
    workspaceFlags().hostReferencesEnabled === true &&
      state.hostReferenceContext,
  );
}

function hostReferenceEligibleWorkspaces() {
  return state.workspaces.filter(
    (workspace) =>
      isFilesWorkspaceAccessible(workspace) &&
      workspace?.featureFlags?.hostReferencesEnabled === true &&
      normalizeString(workspace?.filesWorkspaceId),
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

function postDraftCreationEnabled() {
  return Boolean(
    capabilities().canCreatePostDraft === true && !folderIsRestricted(),
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

function resourceRevision(entity, { allowZero = false } = {}) {
  const raw = entity?.revision ?? entity?.version;
  const revision = Number(raw);
  return Number.isSafeInteger(revision) && revision >= (allowZero ? 0 : 1)
    ? revision
    : null;
}

function requireResourceRevision(entity, label, options = {}) {
  const revision = resourceRevision(entity, options);
  if (revision === null) {
    setToast(
      `${label} is missing current version information. Refresh Files before changing it.`,
      "error",
    );
  }
  return revision;
}

function assertResourceRevision(entity, label, options = {}) {
  const revision = resourceRevision(entity, options);
  if (revision === null) {
    throw new FilesApiError(
      `${label} is missing current version information. Refresh Files before changing it.`,
      { code: "expected_version_required" },
    );
  }
  return revision;
}

function resourceEtag(entity) {
  return normalizeString(entity?.etag);
}

function mutationOptions(actionKey, entity, revision) {
  const etag = resourceEtag(entity, revision);
  return {
    idempotencyKey: actionKey,
    ...(etag ? { headers: { "If-Match": etag } } : {}),
  };
}

function isRevisionConflict(error) {
  return [409, 412, 428].includes(Number(error?.status || 0));
}

async function refreshWorkspaceFence() {
  const principal = principalOf();
  if (!principal.type || !principal.id) return;
  const payload = await api.getWorkspace(principal.type, principal.id);
  state.workspace = normalizeWorkspacePayload(payload);
  state.workspaceDescriptor = {
    ...state.workspaceDescriptor,
    ...state.workspace,
    principal: {
      ...(state.workspaceDescriptor?.principal || {}),
      ...(state.workspace?.principal || {}),
    },
  };
}

async function refreshFolderFence() {
  const folderId = entityId(state.folder);
  if (!folderId) return;
  const payload = await api.getFolder(folderId);
  const folder = payload?.folder || payload;
  state.folder = {
    ...state.folder,
    ...folder,
    ...(payload?.access ? { access: payload.access } : {}),
    revision: payload?.revision ?? folder?.revision,
    version: payload?.version ?? folder?.version,
    etag: payload?.etag || folder?.etag || "",
  };
}

async function refreshFenceAfterConflict(scope) {
  try {
    if (scope === "workspace") await refreshWorkspaceFence();
    if (scope === "folder") await refreshFolderFence();
  } catch {
    // The original mutation error remains the actionable message. A normal
    // page refresh will retry the authenticated read if this refresh also fails.
  }
  return "Files changed while this action was open. Current versions were refreshed; review and try again.";
}

async function bootstrap() {
  render();
  try {
    await completeHostedSignIn(authConfig);
    state.session = await restoreSharedFeedSession(authConfig);
    if (!state.session) {
      purgeUploadCheckpoints();
      purgePreviewEntries();
      clearEditionMaterialization();
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
      state.workspaces.find(
        (item) =>
          workspaceSelectionKey(item) === preferredId ||
          item.filesWorkspaceId === preferredId,
      ) || state.workspaces[0];
    await selectWorkspace(preferred, { preserveRoute: true });
  } catch (error) {
    if ([401, 403].includes(error?.status)) {
      purgeUploadCheckpoints();
      purgePreviewEntries();
      clearEditionMaterialization();
    }
    state.status = "error";
    state.error = error?.message || "Polis Files could not be opened.";
    render();
  }
}

async function selectWorkspace(descriptor, { preserveRoute = false } = {}) {
  purgePreviewEntries();
  clearEditionMaterialization();
  state.previewAccessDenied = false;
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
  state.workspaceDescriptor = {
    ...descriptor,
    ...state.workspace,
    principal: {
      ...(descriptor?.principal || {}),
      ...(state.workspace?.principal || {}),
      ...(descriptor?.principal?.sourceType
        ? {
            sourceType: descriptor.principal.sourceType,
            sourceId: descriptor.principal.sourceId,
          }
        : {}),
    },
  };
  writeStorage(
    STORED_WORKSPACE_KEY,
    workspaceSelectionKey(state.workspaceDescriptor),
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
  const setup = activeWorkspaceSetup(state.workspace, descriptor);
  if (!setup.initialized) {
    await openSetup();
    return;
  }
  if (!preserveRoute) {
    window.history.pushState({}, "", "/files");
    state.route = parseRoute();
  }
  const resumeMaterialization = resumeWorkspaceEditionMaterialization();
  await loadRoute();
  if (resumeMaterialization) {
    scheduleEditionMaterializationPoll({ immediate: true });
  }
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
    } else if (state.route.kind === "reference") {
      await loadHostReferenceDetail(state.route.hostReferenceId);
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
    if (state.route.kind !== "reference") await loadHostReferences();
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
    version: folderPayload?.version ?? folder?.version,
    revision: folderPayload?.revision ?? folder?.revision,
    etag: folderPayload?.etag || folder?.etag || "",
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

function hostReferenceFromEnvelope(value) {
  const reference = value?.hostReference;
  if (!reference || !value?.etag) return null;
  return {
    ...reference,
    revision: value?.revision,
    version: reference?.version ?? value?.revision,
    etag: normalizeString(value.etag),
  };
}

function hostReferenceHasCanonicalTuple(reference) {
  const host = reference?.host || {};
  const tuple = HOST_REFERENCE_TUPLES.get(
    normalizeString(reference?.referenceType),
  );
  return Boolean(
    tuple &&
      tuple[0] === normalizeString(host.sourceType) &&
      tuple[1] === normalizeString(host.resourceType) &&
      normalizeString(host.sourceId) &&
      normalizeString(host.resourceId) &&
      Number.isSafeInteger(Number(host.resourceVersion)) &&
      Number(host.resourceVersion) > 0,
  );
}

function hostReferenceMatchesContext(reference) {
  const context = state.hostReferenceContext;
  const host = reference?.host || {};
  return Boolean(
    context &&
      hostReferenceHasCanonicalTuple(reference) &&
      normalizeString(reference?.referenceType) === context.referenceType &&
      normalizeString(host.sourceType) === context.hostSourceType &&
      normalizeString(host.sourceId) === context.hostSourceId &&
      normalizeString(host.resourceType) === context.hostResourceType &&
      normalizeString(host.resourceId) === context.hostResourceId &&
      Number(host.resourceVersion) === context.hostResourceVersion &&
      normalizeString(reference?.hostReferenceId) &&
      resourceRevision(reference) !== null &&
      ["active", "revoked"].includes(normalizeString(reference?.status)),
  );
}

async function loadHostReferenceDetail(hostReferenceId) {
  state.hostReferenceDetail = null;
  const eligibleWorkspaceIds = new Set(
    hostReferenceEligibleWorkspaces().map((workspace) =>
      normalizeString(workspace.filesWorkspaceId),
    ),
  );
  if (!eligibleWorkspaceIds.size) {
    throw new FilesApiError("This Files reference is unavailable.", {
      status: 404,
      code: "host_reference_not_found",
    });
  }
  let payload;
  try {
    payload = await api.getHostReference(hostReferenceId);
  } catch (error) {
    if ([403, 404].includes(error?.status)) {
      throw new FilesApiError("This Files reference is unavailable.", {
        status: 404,
        code: "host_reference_not_found",
      });
    }
    throw error;
  }
  const reference = hostReferenceFromEnvelope(payload);
  const referenceWorkspaceId = normalizeString(
    reference?.files?.filesWorkspaceId,
  );
  if (
    !reference ||
    normalizeString(reference.hostReferenceId) !== hostReferenceId ||
    !hostReferenceHasCanonicalTuple(reference) ||
    !eligibleWorkspaceIds.has(referenceWorkspaceId) ||
    resourceRevision(reference) === null ||
    !["active", "revoked"].includes(normalizeString(reference.status))
  ) {
    throw new FilesApiError("This Files reference is unavailable.", {
      status: 404,
      code: "host_reference_not_found",
    });
  }
  state.hostReferenceDetail = reference;
}

async function loadHostReferences() {
  if (!hostReferencesEnabled()) {
    state.hostReferences = [];
    state.hostReferencesStatus = "idle";
    return;
  }
  const context = state.hostReferenceContext;
  state.hostReferencesStatus = "loading";
  try {
    const payload = await api.listHostReferences({
      referenceType: context.referenceType,
      hostSourceType: context.hostSourceType,
      hostSourceId: context.hostSourceId,
      hostResourceType: context.hostResourceType,
      hostResourceId: context.hostResourceId,
      hostResourceVersion: context.hostResourceVersion,
      limit: 100,
    });
    state.hostReferences = firstArray(payload, ["items"])
      .map(hostReferenceFromEnvelope)
      .filter(Boolean)
      .filter(hostReferenceMatchesContext);
    state.hostReferencesStatus = "ready";
  } catch {
    state.hostReferences = [];
    state.hostReferencesStatus = "error";
  }
}

function safeHostReferenceDeepLink(reference) {
  const route = normalizeString(reference?.deepLink?.route);
  if (!route.startsWith("/") || route.startsWith("//")) return "";
  let resolved = route;
  Object.entries(reference?.deepLink?.params || {}).forEach(([key, value]) => {
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(key) && normalizeString(value)) {
      resolved = resolved.replaceAll(`:${key}`, encodeURIComponent(value));
    }
  });
  if (/:\w+/u.test(resolved)) return "";
  let url;
  try {
    url = new URL(resolved, window.location.origin);
  } catch {
    return "";
  }
  if (url.origin !== window.location.origin) return "";
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length === 3 &&
    segments[0] === "files" &&
    segments[1] === "references" &&
    segments[2] === reference.hostReferenceId
  ) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  const sourceId = normalizeString(reference?.host?.sourceId);
  if (
    reference.referenceType === "profile_brand" &&
    segments.length === 4 &&
    segments[0] === "coalitions" &&
    segments[1] === sourceId &&
    segments[2] === "admin" &&
    segments[3] === "edit"
  ) {
    return url.pathname;
  }
  if (
    reference.referenceType === "governance_reference" &&
    segments[0] === "organizations" &&
    segments[1] === sourceId &&
    segments[2] === "governance" &&
    (segments.length === 3 ||
      (segments.length === 5 &&
        segments[3] === "constitutions" &&
        segments[4] === normalizeString(reference?.host?.resourceId)))
  ) {
    return url.pathname;
  }
  return "";
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
  const activeId = workspaceSelectionKey(state.workspaceDescriptor);
  return `<label class="files-workspace-switcher">
    <span class="sr-only">Files workspace</span>
    <span class="files-workspace-switcher__mark">${escapeHtml(initials(workspaceLabel(state.workspaceDescriptor)))}</span>
    <select data-action="switch-workspace" aria-label="Files workspace">
      ${state.workspaces
        .map(
          (workspace) =>
            `<option value="${escapeHtml(workspaceSelectionKey(workspace))}" ${workspaceSelectionKey(workspace) === activeId ? "selected" : ""}>${escapeHtml(workspaceLabel(workspace))}${authorizationRootOf(workspace) === "official_office" ? " · Official office" : authorizationRootOf(workspace) === "campaign" ? " · Campaign" : ""}</option>`,
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
  const roots = firstArray(state.workspace, ["roots"]).length
    ? state.workspace.roots
    : firstArray(state.workspaceDescriptor, ["roots"]);
  const activeRoot = authorizationRootOf();
  const scopedRoots = roots.filter(
    (folder) => normalizeString(folder?.authorizationRoot) === activeRoot,
  );
  return scopedRoots.length ||
    roots.every((folder) => !folder?.authorizationRoot)
    ? scopedRoots.length
      ? scopedRoots
      : roots
    : [];
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
      ${hostReferencesEnabled() ? `<button class="files-button files-button--secondary" data-action="open-host-reference">${icon("folder")}Attach a Files folder</button>` : ""}
      ${selected && postDraftCreationEnabled() ? `<button class="files-button files-button--secondary" data-action="open-post">${icon("post")}Create post <span>${selected}</span></button>` : ""}
      ${canOpenUpload() ? `<button class="files-button files-button--primary" data-action="open-upload">${icon("upload")}${currentUploadIntent() === "proposal" ? "Upload for review" : "Upload"}</button>` : ""}
      <button class="files-avatar" data-action="open-settings" aria-label="Open Files settings">${escapeHtml(initials(state.user?.name || state.user?.email))}</button>
    </div>
  </header>`;
}

function renderHostReferencesPanel() {
  if (!hostReferencesEnabled()) return "";
  if (state.hostReferencesStatus === "loading") {
    return '<section class="files-host-references" aria-busy="true"><p>Loading linked Files folders…</p></section>';
  }
  if (state.hostReferencesStatus === "error") {
    return '<section class="files-host-references files-host-references--error"><p>Linked Files folders could not be loaded. No references are shown until authorization is confirmed.</p></section>';
  }
  if (!state.hostReferences.length) return "";
  return `<section class="files-host-references" aria-label="Files folders attached to this Polis item"><div><p class="files-eyebrow">Attached to this ${escapeHtml(state.hostReferenceContext.hostResourceType)}</p><h2>Linked Files folders</h2></div><div class="files-host-references__list">${state.hostReferences
    .map((reference) => {
      const deepLink = safeHostReferenceDeepLink(reference);
      const active = normalizeString(reference.status) === "active";
      const relation = normalizeString(reference.relationType).replace(
        /_/gu,
        " ",
      );
      const purpose = normalizeString(reference.purposeKey).replace(/_/gu, " ");
      return `<article class="files-host-reference"><div>${icon("folder")}<span><strong>${escapeHtml(relation || "Files folder")}</strong><small>${escapeHtml([purpose, active ? "active" : "revoked"].filter(Boolean).join(" · "))}</small></span></div><div>${deepLink ? `<a class="files-link-button" href="${escapeHtml(deepLink)}">Open linked item</a>` : ""}${active ? `<button class="files-link-button files-link-button--danger" data-action="revoke-host-reference" data-id="${escapeHtml(reference.hostReferenceId)}">Revoke link</button>` : ""}</div></article>`;
    })
    .join("")}</div></section>`;
}

function renderHostReferenceDetail() {
  if (state.contentStatus === "error" || !state.hostReferenceDetail) {
    return `<section class="files-page files-reference-detail"><button class="files-link-button" data-nav="/files">← Back to Files</button>${renderEmpty("Files reference unavailable", "It may have been revoked, moved outside your authorized workspaces, or is no longer available.")}</section>`;
  }
  const reference = state.hostReferenceDetail;
  const workspace = hostReferenceEligibleWorkspaces().find(
    (item) =>
      normalizeString(item.filesWorkspaceId) ===
      normalizeString(reference.files?.filesWorkspaceId),
  );
  const relation = normalizeString(reference.relationType).replace(/_/gu, " ");
  const purpose = normalizeString(reference.purposeKey).replace(/_/gu, " ");
  const resourceType = normalizeString(reference.host?.resourceType).replace(
    /_/gu,
    " ",
  );
  return `<section class="files-page files-reference-detail" aria-labelledby="files-reference-title"><button class="files-link-button" data-nav="/files">← Back to Files</button><div class="files-reference-detail__card"><div class="files-folder-hero__icon">${icon("folder")}</div><div><p class="files-eyebrow">Version-fenced Files reference</p><h2 id="files-reference-title">Linked Files material</h2><p>${escapeHtml([relation || "supporting material", purpose, resourceType].filter(Boolean).join(" · "))}</p><small>${escapeHtml(workspaceLabel(workspace))} · ${normalizeString(reference.status) === "active" ? "Active" : "Revoked"}</small></div></div><p class="files-form-note">This page confirms the revocable relationship only. File names, signed preview URLs, and folder contents remain inside their normal Files permissions.</p></section>`;
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

function assetPreviewIdentity(item) {
  const assetId = entityId(item);
  const revisionId = normalizeString(
    item?.sourceAssetVersionId ||
      item?.assetVersionId ||
      item?.revisionId ||
      item?.currentRevisionId,
  );
  return assetId && revisionId
    ? { assetId, revisionId, key: `${assetId}:${revisionId}` }
    : null;
}

function safePreviewUrl(value) {
  try {
    const url = new URL(normalizeString(value), window.location.origin);
    const localHttp =
      url.protocol === "http:" &&
      (url.origin === window.location.origin ||
        ["127.0.0.1", "localhost"].includes(url.hostname));
    return url.protocol === "https:" || localHttp ? url.href : "";
  } catch {
    return "";
  }
}

function purgePreviewEntries() {
  state.previewGeneration += 1;
  state.previewObserver?.disconnect();
  state.previewObserver = null;
  state.previewExpiryTimers.forEach((timer) => window.clearTimeout(timer));
  state.previewExpiryTimers.clear();
  state.previewEntries.clear();
  state.previewRequests.clear();
}

function clearEditionMaterialization() {
  editionMaterializationGeneration += 1;
  if (editionMaterializationTimer) {
    window.clearTimeout(editionMaterializationTimer);
    editionMaterializationTimer = null;
  }
  state.editionMaterialization = null;
}

function schedulePreviewExpiry(key, entry, delay) {
  const existing = state.previewExpiryTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    state.previewExpiryTimers.delete(key);
    if (state.previewEntries.get(key) === entry) {
      state.previewEntries.delete(key);
      render();
    }
  }, delay);
  state.previewExpiryTimers.set(key, timer);
}

async function loadAssetPreview(assetId, revisionId) {
  const key = `${assetId}:${revisionId}`;
  const current = state.previewEntries.get(key);
  if (current && current.expiresAt > Date.now()) return current;
  if (state.previewRequests.has(key)) return state.previewRequests.get(key);
  const generation = state.previewGeneration;
  const request = (async () => {
    try {
      const payload = await api.getAssetPreview(assetId, revisionId);
      const expiresInSeconds = Number(payload?.expiresInSeconds);
      const url = safePreviewUrl(payload?.url);
      const contentType = normalizeString(payload?.contentType).toLowerCase();
      if (
        normalizeString(payload?.assetId) !== assetId ||
        normalizeString(payload?.revisionId) !== revisionId ||
        !url ||
        !Number.isFinite(expiresInSeconds) ||
        expiresInSeconds <= 0 ||
        expiresInSeconds > 300 ||
        payload?.cachePolicy !== "no-store" ||
        payload?.offlineAvailable !== false ||
        !/^(image|video)\//u.test(contentType)
      ) {
        throw new FilesApiError("Preview response was not safe to display.", {
          code: "preview_contract_invalid",
        });
      }
      if (generation !== state.previewGeneration) return null;
      const lifetime = Math.max(1_000, (expiresInSeconds - 5) * 1_000);
      const entry = {
        url,
        expiresAt: Date.now() + lifetime,
        watermarked: payload.watermarked === true,
        contentType,
      };
      state.previewEntries.set(key, entry);
      schedulePreviewExpiry(key, entry, lifetime);
      render();
      return entry;
    } catch (error) {
      if ([401, 403].includes(error?.status)) {
        state.previewAccessDenied = true;
        purgePreviewEntries();
        render();
      } else if (generation === state.previewGeneration) {
        const retryDelay = error?.status === 409 ? 10_000 : 30_000;
        const entry = {
          unavailable: true,
          processing: error?.status === 409,
          expiresAt: Date.now() + retryDelay,
        };
        state.previewEntries.set(key, entry);
        schedulePreviewExpiry(key, entry, retryDelay);
        render();
      }
      return null;
    } finally {
      if (generation === state.previewGeneration) {
        state.previewRequests.delete(key);
      }
    }
  })();
  state.previewRequests.set(key, request);
  return request;
}

function observePreviewTargets() {
  state.previewObserver?.disconnect();
  if (state.previewAccessDenied) return;
  const targets = Array.from(root.querySelectorAll("[data-preview-asset]"));
  if (!targets.length) return;
  const loadTarget = (target) => {
    const assetId = normalizeString(target.dataset.previewAsset);
    const revisionId = normalizeString(target.dataset.previewRevision);
    if (assetId && revisionId) loadAssetPreview(assetId, revisionId);
  };
  if (!("IntersectionObserver" in window)) {
    targets.forEach(loadTarget);
    return;
  }
  state.previewObserver = new IntersectionObserver(
    (entries, observer) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach((entry) => {
          observer.unobserve(entry.target);
          loadTarget(entry.target);
        });
    },
    { rootMargin: "160px" },
  );
  targets.forEach((target) => state.previewObserver.observe(target));
}

function itemThumbnail(item) {
  if (isFolder(item))
    return `<div class="files-item__thumb files-item__thumb--folder">${icon("folder")}</div>`;
  const identity = assetPreviewIdentity(item);
  const preview = identity ? state.previewEntries.get(identity.key) : null;
  if (preview?.url && preview.expiresAt > Date.now() && isMedia(item)) {
    const media = preview.contentType.startsWith("video/")
      ? `<video src="${escapeHtml(preview.url)}" muted playsinline preload="metadata" aria-hidden="true"></video>`
      : `<img src="${escapeHtml(preview.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
    const previewLabel = `${preview.watermarked ? "Watermarked preview · " : "Preview · "}online only`;
    return `<div class="files-item__thumb files-item__thumb--preview ${preview.watermarked ? "is-watermarked" : ""}" title="${escapeHtml(previewLabel)}">${media}<span class="files-preview-state">${escapeHtml(previewLabel)}</span></div>`;
  }
  if (identity && isMedia(item) && assetIsReady(item)) {
    const stateLabel = preview?.processing
      ? "Preview processing"
      : preview?.unavailable
        ? "Preview unavailable"
        : "Loading preview";
    const mediaType = normalizeString(item?.mediaType).toLowerCase();
    const mimeType = normalizeString(item?.mimeType || item?.contentType);
    return `<div class="files-item__thumb files-item__thumb--file" data-preview-asset="${escapeHtml(identity.assetId)}" data-preview-revision="${escapeHtml(identity.revisionId)}">${icon(mediaType === "video" || mimeType.startsWith("video/") ? "video" : "image")}<span class="sr-only">${stateLabel}</span></div>`;
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
  const isPostPrompt = isMediaPostPrompt(suggestion);
  const canDisable = can("canManageAutomations", "files_automations_manage");
  return `<article class="files-suggestion">
    <div class="files-suggestion__icon">${icon("spark")}</div>
    <div><p class="files-eyebrow">${escapeHtml(aiGenerated ? "Optional AI assistance" : isPostPrompt ? "Rule-based media prompt" : "Context match")}${percent ? ` · ${percent}% match` : ""}</p>
      <h3>${escapeHtml(entityName(suggestion, "Recommended share"))}</h3>
      <p>${escapeHtml(suggestion?.summary || suggestion?.explanation || suggestion?.reason || (isPostPrompt ? "Review the available media in Current before creating a Polis post." : "Polis found a relevant folder for this workspace."))}</p>
      ${context?.district || context?.election ? `<div class="files-context-chips"><span>${escapeHtml(context.district || "")}</span><span>${escapeHtml(context.election || "")}</span></div>` : ""}
    </div>
    <div class="files-suggestion__actions">
      <button class="files-button files-button--primary" data-suggestion="accept" data-id="${escapeHtml(id)}">${isPostPrompt ? "Review media" : "Review & share"}</button>
      <button class="files-button files-button--secondary" data-suggestion="edit" data-id="${escapeHtml(id)}">Edit</button>
      <button class="files-button files-button--ghost" data-suggestion="snooze" data-id="${escapeHtml(id)}">Snooze</button>
      <button class="files-button files-button--ghost" data-suggestion="dismiss" data-id="${escapeHtml(id)}">Dismiss</button>
      ${canDisable ? `<button class="files-button files-button--ghost files-button--small" data-suggestion="disable" data-id="${escapeHtml(id)}">Disable these</button>` : ""}
    </div>
  </article>`;
}

function isMediaPostPrompt(suggestion) {
  const suggestionType = normalizeString(
    suggestion?.suggestionType,
  ).toLowerCase();
  const recommendedAction = normalizeString(
    suggestion?.recommendedAction,
  ).toLowerCase();
  if (suggestionType || recommendedAction) {
    return (
      ["event_recap", "ready_for_media_team"].includes(suggestionType) &&
      recommendedAction === "create_post_draft"
    );
  }
  return ["media_post", "event_media"].includes(
    normalizeString(suggestion?.type).toLowerCase(),
  );
}

function isContextualSharePrompt(suggestion) {
  return (
    normalizeString(suggestion?.suggestionType).toLowerCase() ===
      "contextual_folder_share" &&
    normalizeString(suggestion?.action).toLowerCase() === "prompt_share"
  );
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
    ["proposals", "Proposed changes"],
    ["history", "History"],
    ["access", "Access & automations"],
  ];
  const pendingProposalCount = state.folderData.proposals.filter(
    proposalIsPendingReview,
  ).length;
  return `<nav class="files-tabs" aria-label="Folder sections">${tabs.map(([key, label]) => `<button data-folder-tab="${key}" class="${state.route.tab === key ? "is-active" : ""}" ${state.route.tab === key ? 'aria-current="page"' : ""}>${label}${key === "proposals" && pendingProposalCount ? `<span>${pendingProposalCount}</span>` : ""}</button>`).join("")}</nav>`;
}

function activeEditionMaterialization() {
  const tracker = state.editionMaterialization;
  return tracker?.workspaceWide === true ||
    tracker?.folderId === entityId(state.folder)
    ? tracker
    : null;
}

function renderEditionMaterializationStatus() {
  const tracker = activeEditionMaterialization();
  if (!tracker) return "";
  const materialization = tracker.materialization || {};
  const status = normalizeString(materialization.status || "pending");
  const progress = materialization.progress || {};
  const restoring = materialization.mode === "restore";
  if (status === "failed") {
    return `<div class="files-edition-job files-edition-job--error" role="alert">${icon("review")}<div><strong>${restoring ? "Version restore could not finish" : "Version archive could not finish"}</strong><span>No partial edition was exposed. ${escapeHtml(normalizeString(materialization.failureCode).replace(/_/gu, " ") || "Refresh Files and try again.")}</span></div><button class="files-link-button" data-action="dismiss-edition-materialization">Dismiss</button></div>`;
  }
  const phase = status.replace(/_/gu, " ");
  const counts = [
    Number(progress.sourceAssetCount) > 0
      ? `${Number(progress.sourceAssetCount)} source item${Number(progress.sourceAssetCount) === 1 ? "" : "s"}`
      : "",
    Number(progress.affectedFolderCount) > 0
      ? `${Number(progress.affectedFolderCount)} affected folder${Number(progress.affectedFolderCount) === 1 ? "" : "s"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="files-edition-job" role="status" aria-live="polite">${icon("archive")}<div><strong>${restoring ? "Restoring this edition as Current" : "Archiving the current version"}</strong><span>${escapeHtml(phase)}${counts ? ` · ${escapeHtml(counts)}` : ""}. Current remains all-old or all-new while Polis prepares the change.</span></div>${tracker.pollingStopped ? '<button class="files-link-button" data-action="refresh-edition-materialization">Check status</button>' : '<span class="files-edition-job__pulse" aria-hidden="true"></span>'}</div>`;
}

function renderEditionRail() {
  const editions = state.folderData.editions;
  if (!editions.length) return "";
  const materialization = activeEditionMaterialization();
  const locked = Boolean(
    materialization &&
      !["complete", "failed"].includes(
        normalizeString(materialization.materialization?.status),
      ),
  );
  return `<aside class="files-editions">${renderEditionMaterializationStatus()}<div class="files-editions__heading"><div><p class="files-eyebrow">Versions</p><h3>Folder editions</h3></div>${can("canManage", "files_manage") ? `<button class="files-editions__new" data-action="new-edition" ${locked ? "disabled" : ""}>Start a new edition</button>` : ""}</div>${editions
    .map((edition) => {
      const current = editionIsCurrent(edition);
      const stateLabel = current
        ? "current"
        : normalizeString(edition?.state || edition?.status || "archived");
      return `<article class="files-edition ${current ? "is-current" : ""}"><div><strong>${escapeHtml(entityName(edition, "Edition"))}</strong><span>${escapeHtml(stateLabel)} · ${escapeHtml(formatDate(edition?.activatedAt || edition?.createdAt))}</span></div>${current ? `<div class="files-edition__actions"><span class="files-state-pill files-state-pill--current">Current</span>${can("canManage", "files_manage") ? `<button class="files-link-button files-link-button--danger" data-edition-action="archive" data-id="${escapeHtml(entityId(edition))}" ${locked ? "disabled" : ""}>Archive current version</button>` : ""}</div>` : can("canManage", "files_manage") ? `<button class="files-link-button" data-edition-action="restore" data-id="${escapeHtml(entityId(edition))}" ${locked ? "disabled" : ""}>Restore as Current</button>` : ""}</article>`;
    })
    .join("")}</aside>`;
}

function editionIsCurrent(edition) {
  const editionId = entityId(edition);
  return Boolean(
    editionId &&
      (editionId === normalizeString(state.folder?.currentEditionId) ||
        edition?.isCurrent === true ||
        ["current", "active"].includes(
          normalizeString(edition?.state || edition?.status),
        )),
  );
}

function renderCurrentTab() {
  return `<div class="files-folder-columns"><div><div class="files-current-banner">${icon("check")}<div><strong>Current, approved material</strong><span>People with shared access see this edition. Proposed changes stay separate until reviewed.</span></div></div>${renderToolbar({ count: state.folderData.assets.length })}${renderItems(state.folderData.assets, "This edition is empty", folderUploadIntent() === "proposal" ? "Upload material for review; it stays outside Current until approved." : folderUploadIntent() === "commit" ? "Upload approved material, or propose an addition if this folder is review-gated." : "Approved files will appear here.")}</div>${renderEditionRail()}</div>`;
}

function proposalStatus(proposal) {
  return normalizeString(proposal?.status || "pending_review").replace(
    /_/gu,
    " ",
  );
}

function proposalIsPendingReview(proposal) {
  return ["pending_review", "pending", "open"].includes(
    normalizeString(proposal?.status),
  );
}

function proposalActorActions(proposal) {
  const status = normalizeString(proposal?.status);
  const submittedBy = normalizeString(
    proposal?.submittedByUserId ||
      proposal?.createdByUserId ||
      proposal?.createdBy?.userId,
  );
  const actorOwnsProposal = Boolean(
    submittedBy && submittedBy === normalizeString(state.user?.userId),
  );
  const proposalCapabilities = proposal?.capabilities || {};
  return {
    canResubmit:
      status === "changes_requested" &&
      (proposalCapabilities.canResubmit === true || actorOwnsProposal),
    canWithdraw:
      ["pending_review", "changes_requested"].includes(status) &&
      (proposalCapabilities.canWithdraw === true || actorOwnsProposal),
  };
}

function renderProposalsTab() {
  const proposals = state.folderData.proposals;
  return `<div class="files-review-layout"><div><div class="files-tab-intro"><div><p class="files-eyebrow">Safe collaboration</p><h3>Proposed changes</h3><p>Review additions, replacements, and deletions before they become current.</p></div>${can("canPropose", "files_propose") ? '<button class="files-button files-button--secondary" data-action="new-proposal">Suggest change</button>' : ""}</div>${
    proposals.length
      ? `<div class="files-proposals">${proposals
          .map((proposal) => {
            const actorActions = proposalActorActions(proposal);
            const reviewActions =
              proposalIsPendingReview(proposal) &&
              can("canReview", "files_review")
                ? `<button class="files-button files-button--primary" data-proposal-decision="approve" data-id="${escapeHtml(entityId(proposal))}">Approve & merge</button><button class="files-button files-button--secondary" data-proposal-decision="request_changes" data-id="${escapeHtml(entityId(proposal))}">Request changes</button><button class="files-button files-button--danger" data-proposal-decision="reject" data-id="${escapeHtml(entityId(proposal))}">Refuse</button>`
                : "";
            const submitterActions = `${actorActions.canResubmit ? `<button class="files-button files-button--secondary" data-proposal-action="resubmit" data-id="${escapeHtml(entityId(proposal))}">Revise & resubmit</button>` : ""}${actorActions.canWithdraw ? `<button class="files-button files-button--ghost" data-proposal-action="withdraw" data-id="${escapeHtml(entityId(proposal))}">Withdraw</button>` : ""}`;
            return `<article class="files-proposal"><div class="files-proposal__status"><span class="files-state-pill">${escapeHtml(proposalStatus(proposal))}</span><span>${escapeHtml(formatDate(proposal?.createdAt, { withTime: true }))}</span></div><h4>${escapeHtml(entityName(proposal, "Proposed change"))}</h4><p>${escapeHtml(proposal?.summary || proposal?.description || "Review the proposed folder change.")}</p><div class="files-proposal__author"><span>${escapeHtml(initials(entityName(proposal?.createdBy || proposal?.author, "Team member")))}</span><div><strong>${escapeHtml(entityName(proposal?.createdBy || proposal?.author, "Team member"))}</strong><small>Proposed this change</small></div></div>${reviewActions || submitterActions ? `<div class="files-proposal__actions">${reviewActions}${submitterActions}</div>` : ""}</article>`;
          })
          .join("")}</div>`
      : renderEmpty(
          "No proposed changes",
          "Suggestions from contributors will appear here for review.",
        )
  }</div><aside class="files-review-explainer"><p class="files-eyebrow">How review works</p><ol><li>A contributor suggests an addition, change, or deletion.</li><li>An authorized folder manager can approve, request changes, or refuse it.</li><li>Only approval merges it into Current; every decision remains in history.</li></ol></aside></div>`;
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
  const authority = activeGovernanceAuthority();
  const rootLabel =
    authorizationRootOf() === "official_office"
      ? "Official Office"
      : authorizationRootOf() === "campaign"
        ? "Campaign"
        : "Organization";
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
            const expectedVersion = grant?.version || grant?.revision || "";
            return `<article class="files-grant"><span class="files-grant__avatar">${escapeHtml(initials(entityName(subject, "Access")))}</span><div><strong>${escapeHtml(entityName(subject, "Access grant"))}</strong><p>${(grant?.recipientRoleIds || []).length ? "Dynamic role · membership changes automatically" : restricted ? "Restricted named-person access" : "Named access"}</p><small>${escapeHtml((grant?.capabilities || grant?.permissions || []).map((item) => item.replace(/^files_/u, "")).join(" · ") || "view")}${grant?.expiresAt ? ` · expires ${escapeHtml(formatDate(grant.expiresAt))}` : ""}</small>${renderRestrictedProgress(grant)}</div><span class="files-state-pill ${pending ? "files-state-pill--pending" : "files-state-pill--current"}">${escapeHtml((grant?.status || "active").replace(/_/gu, " "))}</span><div class="files-grant__actions">${pending && restricted && can("canApproveRestricted", "files_restricted_approve") ? `<button class="files-link-button" data-grant-action="approve" data-id="${escapeHtml(entityId(grant))}" data-version="${escapeHtml(expectedVersion)}">Review approval</button>` : ""}${can("canShare", "files_share") ? `<button class="files-link-button files-link-button--danger" data-grant-action="revoke" data-id="${escapeHtml(entityId(grant))}" data-version="${escapeHtml(expectedVersion)}">Revoke</button>` : ""}</div></article>`;
          })
          .join("")}</div>`
      : renderEmpty(
          "Only workspace members have access",
          "Add a role-based share or request restricted access for a named person.",
        )
  }</div><aside class="files-access-note">${icon("shared")}<h4>Role shares stay in sync</h4><p>Share with a media, research, field, or custom Polis role. When membership changes, folder access changes with it—no manual cleanup.</p><p>Restricted governance approval is scoped to this ${rootLabel} root${authority?.actorIsCurrentAuthority === true ? "; you are a current authority for this root" : ""}.</p></aside></div>`;
}

function renderFolder() {
  if (state.contentStatus === "loading")
    return `<section class="files-page">${renderSkeletons()}</section>`;
  if (state.contentStatus === "error")
    return `<section class="files-page">${renderInlineError()}</section>`;
  const context = state.folder?.context || {};
  const editionTracker = activeEditionMaterialization();
  const editionLocked = Boolean(
    editionTracker &&
      !["complete", "failed"].includes(
        normalizeString(editionTracker.materialization?.status),
      ),
  );
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
    )}</div><h2>${escapeHtml(entityName(state.folder, "Folder"))}</h2><p>${escapeHtml(state.folder?.description || "Current, governed information for authorized collaborators.")}</p></div><div class="files-folder-hero__actions">${can("canManage", "files_manage") && state.folder?.access?.shared !== true ? `<button class="files-button files-button--ghost" data-action="new-folder" ${editionLocked ? "disabled" : ""}>New subfolder</button><button class="files-button files-button--ghost" data-action="folder-settings" ${editionLocked ? "disabled" : ""}>Folder settings</button><button class="files-button files-button--ghost" data-action="new-edition" ${editionLocked ? "disabled" : ""}>Start a new edition</button>` : ""}${can("canManage", "files_manage") && state.folder?.access?.shared !== true && state.folder?.status !== "archived" ? `<button class="files-button files-button--danger" data-action="archive-folder" ${editionLocked ? "disabled" : ""}>Archive folder</button>` : ""}${canOpenUpload() ? `<button class="files-button files-button--primary" data-action="open-upload" ${editionLocked ? "disabled" : ""}>${folderUploadIntent() === "proposal" ? "Upload for review" : "Upload"}</button>` : ""}</div></div></div>${renderFolderTabs()}<div class="files-folder-tab">${tabContent}</div></section>`;
}

function renderUploadsPage() {
  const items = state.uploadQueue;
  return `<section class="files-page"><div class="files-page-intro files-page-intro--actions"><div><p class="files-eyebrow">Transfer center</p><h2>Uploads</h2><p>Keep working while signed uploads transfer securely in the background.</p></div>${canOpenUpload() ? '<button class="files-button files-button--primary" data-action="open-upload">Add files</button>' : ""}</div>${items.length ? `<div class="files-upload-list">${items.map(renderUploadItem).join("")}</div>` : renderEmpty("No uploads in this session", "Choose files or drag them into an upload window to begin.")}</section>`;
}

function renderUploadItem(item) {
  const file = item.file || item.fileMetadata || {};
  const type = normalizeString(file.type || file.contentType);
  const isPaused = item.status === "paused";
  const cancellationPending = item.status === "cancel_pending";
  const waitingForFile = isPaused && !item.file;
  const status =
    item.status === "quarantined"
      ? item.error || "Quarantined · security review did not release this file"
      : cancellationPending
        ? item.error || "Cancellation is pending and will retry automatically."
        : item.status === "cancelling"
          ? "Cancelling securely…"
          : item.status === "cancelled"
            ? "Cancelled"
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
                    : item.status === "pausing"
                      ? "Pausing safely…"
                      : item.status === "finalizing"
                        ? "Verifying upload…"
                        : item.status === "queued"
                          ? "Waiting"
                          : waitingForFile
                            ? "Choose the same file to resume"
                            : isPaused
                              ? `Paused at ${Math.round(item.progress * 100)}%`
                              : `${Math.round(item.progress * 100)}% uploaded`;
  const active = item.status === "uploading" || item.status === "hashing";
  const cancel = `<button data-upload-action="cancel" data-id="${escapeHtml(item.id)}">Cancel</button>`;
  const actions = cancellationPending
    ? `<button data-upload-action="cancel" data-id="${escapeHtml(item.id)}">Retry cancellation</button>`
    : active
      ? `<button data-upload-action="pause" data-id="${escapeHtml(item.id)}">Pause</button>${cancel}`
      : waitingForFile
        ? `<label class="files-upload-resume">Resume<input type="file" data-resume-upload="${escapeHtml(item.id)}" /></label>${cancel}`
        : isPaused
          ? `<button data-upload-action="resume" data-id="${escapeHtml(item.id)}">Resume</button>${cancel}`
          : item.status === "pausing" || item.status === "finalizing"
            ? cancel
            : item.status === "error" && item.file
              ? `<button data-upload-action="retry" data-id="${escapeHtml(item.id)}">Retry</button>`
              : item.status === "complete" || item.status === "scanning"
                ? icon("check")
                : item.status === "quarantined"
                  ? icon("review")
                  : "";
  return `<article class="files-upload-item files-upload-item--${escapeHtml(item.status)}"><div class="files-upload-item__icon">${icon(type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file")}</div><div class="files-upload-item__body"><div><strong>${escapeHtml(file.name || file.fileName)}</strong><span>${escapeHtml(formatBytes(file.size))}</span></div><progress class="files-progress" aria-label="Upload progress" max="100" value="${Math.round(item.progress * 100)}">${Math.round(item.progress * 100)}%</progress><small>${escapeHtml(status)}</small></div><div class="files-upload-item__actions">${actions}</div></article>`;
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
    "proposal-resubmit": renderResubmitProposalModal,
    "proposal-withdraw": renderWithdrawProposalModal,
    edition: renderEditionModal,
    "archive-edition": renderArchiveEditionModal,
    "host-reference": renderHostReferenceModal,
    "revoke-host-reference": renderRevokeHostReferenceModal,
    "suggestion-edit": renderSuggestionEditModal,
    "archive-folder": renderArchiveFolderModal,
    "confirm-decision": renderDecisionModal,
  }[state.modal.type]?.();
  if (!content) return "";
  const locked =
    state.modal.type === "setup" && !activeWorkspaceSetup().initialized;
  return `<div class="files-modal-layer" role="presentation"><div class="files-modal-backdrop" ${locked ? "" : 'data-action="close-modal"'}></div><section class="files-modal files-modal--${escapeHtml(state.modal.type)}" role="dialog" aria-modal="true" aria-labelledby="files-modal-title">${!locked ? `<button class="files-modal__close" data-action="close-modal" aria-label="Close">${icon("close")}</button>` : ""}${content}</section></div>`;
}

function renderSetupModal() {
  const selected = state.modal?.presetKey || "blank";
  const aiControl = aiSuggestionsAvailable()
    ? '<label><input type="checkbox" name="aiSuggestionsEnabled" /> Optional AI caption and next-step assistance <small>(off by default)</small></label>'
    : "";
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
    )}</div><div class="files-setup__toggles"><label><input type="checkbox" name="contextMatchingEnabled" checked /> Suggest relevant folders from district and election context</label><label><input type="checkbox" name="eventMediaPromptsEnabled" checked /> Rule-based event media prompts <small>(no AI)</small></label>${aiControl}</div><div class="files-modal__actions"><button class="files-button files-button--ghost" type="submit" name="intent" value="skip">Skip setup</button><button class="files-button files-button--primary" type="submit" name="intent" value="initialize">Create my Files space</button></div></form></div>`;
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
  const parent = state.modal?.parentFolderId ? state.folder : null;
  return `<div class="files-modal__heading"><p class="files-eyebrow">Add structure</p><h2 id="files-modal-title">New ${parent ? "subfolder" : "folder"}</h2><p>${parent ? `This folder will live inside ${escapeHtml(entityName(parent))}. ` : ""}Canonical election context lets Polis make accurate, explainable matches as boundaries and cycles change.</p></div><form data-form="new-folder"><div class="files-field"><label for="folder-name">Folder name</label><input id="folder-name" name="name" required maxlength="120" placeholder="Florida House District 3 research" autofocus /></div><div class="files-field"><label for="folder-description">What belongs here?</label><textarea id="folder-description" name="description" rows="3" maxlength="500" placeholder="Current district research, contacts, and field notes"></textarea></div><fieldset class="files-context-fields"><legend>Political context <span>(optional)</span></legend><div class="files-form-grid files-form-grid--three"><div class="files-field"><label for="folder-state">State</label><select id="folder-state" name="stateCode"><option value="">None</option>${stateCodes.map((code) => `<option value="${code}">${code}</option>`).join("")}</select></div><div class="files-field"><label for="folder-office">Office</label><select id="folder-office" name="office"><option value="">None</option><option value="us_house">U.S. House</option><option value="state_senate">State Senate</option><option value="state_house">State House</option><option value="statewide">Statewide</option><option value="county">County</option><option value="municipal">Municipal</option><option value="school_board">School board</option><option value="other">Other</option></select></div><div class="files-field"><label for="folder-district">District number</label><input id="folder-district" name="district" inputmode="numeric" placeholder="3" /></div></div><div class="files-form-grid files-form-grid--three"><div class="files-field"><label for="folder-cycle">Election cycle</label><input id="folder-cycle" name="cycle" inputmode="numeric" placeholder="2026" /></div><div class="files-field"><label for="folder-boundary">Boundary vintage</label><input id="folder-boundary" name="boundaryVintage" inputmode="numeric" placeholder="2022" /></div><div class="files-field"><label for="folder-effective-from">Effective from</label><input id="folder-effective-from" name="effectiveFrom" type="date" /></div></div><div class="files-field"><label for="folder-effective-to">Effective through <span>(if known)</span></label><input id="folder-effective-to" name="effectiveTo" type="date" /></div></fieldset><label class="files-check"><input type="checkbox" name="reviewRequired" checked /> Require approval before suggested changes become current</label><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Create ${parent ? "subfolder" : "folder"}</button></div></form>`;
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
  const aiControl = aiSuggestionsAvailable()
    ? toggleField(
        "aiSuggestionsEnabled",
        "AI assistance",
        "Optionally suggest captions and useful next steps; never post automatically.",
        false,
      )
    : "";
  return `<div class="files-modal__heading"><p class="files-eyebrow">Workspace defaults</p><h2 id="files-modal-title">Files settings</h2><p>These defaults apply across this workspace. Folder managers can narrow them for a specific folder.</p></div><form data-form="settings"><div class="files-settings-list">${toggleField("contextMatchingEnabled", "Context matching", "Match district, office, election, and event context to relevant folders.")}${toggleField("connectionSharePromptsEnabled", "Connection share prompts", "Ask before sharing useful folders when organizations or campaigns connect.")}${toggleField("eventMediaPromptsEnabled", "Rule-based media prompts", "Prompt teams when event media arrives using folder and calendar metadata—no AI.")}${toggleField("postSuggestionsEnabled", "Files-to-post recommendations", "Offer post ideas from approved media without publishing automatically.")}${aiControl}${toggleField("postUsageBadgesEnabled", "Post provenance badges", "Show which teams have already used a photo or video.", workspaceFlags().postProvenanceEnabled !== false)}${toggleField("uploadNotificationsEnabled", "Automation notifications", "Notify relevant teams when Files recommendations or automations need attention.")}</div>${!automationAccess ? '<p class="files-form-note">Only members with Files automation management permission can change automation defaults.</p>' : ""}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit" ${automationAccess ? "" : "disabled"}>Save settings</button></div></form>`;
}

function renderFolderSettingsModal() {
  const settings = state.folder?.settings || {};
  const restricted = folderIsRestricted();
  state.modal.settings = state.modal.settings || settings;
  const inheritWorkspace = settings.inheritWorkspace !== false;
  const aiControl = aiSuggestionsAvailable()
    ? toggleField(
        "aiSuggestionsEnabled",
        "AI suggestions",
        restricted
          ? "AI processing is unavailable for restricted folders."
          : "Suggest useful actions from approved material.",
        false,
        { disabled: inheritWorkspace || restricted },
      )
    : "";
  return `<div class="files-modal__heading"><p class="files-eyebrow">Folder controls</p><h2 id="files-modal-title">${escapeHtml(entityName(state.folder))} settings</h2><p>Override workspace automation and review behavior for this folder.</p></div><form data-form="folder-settings"><div class="files-field"><label for="folder-edit-name">Folder name</label><input id="folder-edit-name" name="name" value="${escapeHtml(entityName(state.folder))}" required /></div><label class="files-toggle"><span><strong>Review-gated changes</strong><small>Contributors suggest edits; folder reviewers merge them.</small></span><input type="checkbox" name="reviewRequired" ${state.folder?.reviewRequired !== false ? "checked" : ""}/><i></i></label><label class="files-toggle"><span><strong>Use workspace automation defaults</strong><small>Turn off to customize this folder.</small></span><input type="checkbox" name="inheritWorkspace" data-action="folder-inherit" ${inheritWorkspace ? "checked" : ""}/><i></i></label>${toggleField("contextMatchingEnabled", "Context matching", "Use this folder’s district, election, office, and event metadata.", true, { disabled: inheritWorkspace })}${aiControl}${toggleField("postSuggestionsEnabled", "Post suggestions", restricted ? "Restricted material cannot generate post suggestions." : "Suggest drafts when new media is added.", false, { disabled: inheritWorkspace || restricted })}${toggleField("postUsageBadgesEnabled", "Usage badges", "Show linked Polis posts on used media.", true, { disabled: inheritWorkspace })}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Save folder</button></div></form>`;
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

function renderResubmitProposalModal() {
  const proposal = state.folderData.proposals.find(
    (item) => entityId(item) === state.modal?.proposalId,
  );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Address the review</p><h2 id="files-modal-title">Revise and resubmit</h2><p>Update the explanation, then return the same version-fenced change operations to review.</p></div><form data-form="proposal-resubmit"><div class="files-field"><label for="proposal-resubmit-title">Short title</label><input id="proposal-resubmit-title" name="title" required maxlength="140" value="${escapeHtml(entityName(proposal, "Proposed change"))}" /></div><div class="files-field"><label for="proposal-resubmit-description">Revised explanation</label><textarea id="proposal-resubmit-description" name="description" rows="5" required maxlength="1500">${escapeHtml(proposal?.description || proposal?.summary || "")}</textarea></div><p class="files-form-note">The proposed asset operations remain unchanged. Start a new proposal if the files or requested operation must change.</p><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Return to review</button></div></form>`;
}

function renderWithdrawProposalModal() {
  const proposal = state.folderData.proposals.find(
    (item) => entityId(item) === state.modal?.proposalId,
  );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Preserve the audit trail</p><h2 id="files-modal-title">Withdraw this proposed change?</h2><p>${escapeHtml(entityName(proposal, "This proposal"))} will leave the review queue but remain in folder history.</p></div><form data-form="proposal-withdraw"><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Keep in review</button><button class="files-button files-button--danger" type="submit">Withdraw proposal</button></div></form>`;
}

function renderEditionModal() {
  const context = state.folder?.context || {};
  const defaultType = context.boundaryVintage
    ? "boundary_vintage"
    : context.cycle
      ? "election_cycle"
      : "annual";
  const current = state.folderData.editions.find(editionIsCurrent);
  return `<div class="files-modal__heading"><p class="files-eyebrow">Preserve context over time</p><h2 id="files-modal-title">Start a new edition</h2><p>${current ? "Polis will archive the current version and make the new edition current in one audited step." : "Polis will create and activate this as the folder’s current edition."}</p></div><form data-form="edition"><div class="files-field"><label for="edition-label">Edition label</label><input id="edition-label" name="label" required placeholder="2028 cycle" /></div><div class="files-form-grid files-form-grid--three"><div class="files-field"><label for="edition-type">Edition type</label><select id="edition-type" name="type"><option value="annual" ${defaultType === "annual" ? "selected" : ""}>Annual</option><option value="election_cycle" ${defaultType === "election_cycle" ? "selected" : ""}>Election cycle</option><option value="boundary_vintage" ${defaultType === "boundary_vintage" ? "selected" : ""}>Boundary vintage</option><option value="custom">Custom</option></select></div><div class="files-field"><label for="edition-year">Effective year</label><input id="edition-year" name="effectiveYear" inputmode="numeric" placeholder="2028" /></div><div class="files-field"><label for="edition-cycle">Election cycle</label><input id="edition-cycle" name="cycle" inputmode="numeric" value="${escapeHtml(context.cycle || "")}" /></div></div><div class="files-field"><label for="edition-boundary">Boundary vintage</label><input id="edition-boundary" name="boundaryVintage" value="${escapeHtml(context.boundaryVintage || "")}" placeholder="2022" /></div><div class="files-form-grid"><div class="files-field"><label for="edition-effective-from">Effective from</label><input id="edition-effective-from" name="effectiveFrom" type="date" value="${escapeHtml(context.effectiveFrom || "")}" /></div><div class="files-field"><label for="edition-effective-to">Effective through</label><input id="edition-effective-to" name="effectiveTo" type="date" value="${escapeHtml(context.effectiveTo || "")}" /></div></div>${current ? '<p class="files-form-note">The archived version remains available in edition history and is never deleted.</p>' : ""}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit">Start new current edition</button></div></form>`;
}

function renderArchiveEditionModal() {
  const edition = state.folderData.editions.find(
    (item) => entityId(item) === state.modal?.editionId,
  );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Preserve, don’t delete</p><h2 id="files-modal-title">Archive current version?</h2><p>${escapeHtml(entityName(edition, "This edition"))} will remain in version history. This folder will have no Current edition until you start a new edition or restore an archived one.</p></div><form data-form="archive-edition"><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Keep current</button><button class="files-button files-button--danger" type="submit">Archive current version</button></div></form>`;
}

function renderRevokeHostReferenceModal() {
  const reference = state.hostReferences.find(
    (item) => item.hostReferenceId === state.modal?.hostReferenceId,
  );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Revocable by design</p><h2 id="files-modal-title">Revoke this Files link?</h2><p>The folder and its history remain intact. This Polis item will stop carrying the reference.</p></div><form data-form="revoke-host-reference"><div class="files-field"><label for="host-revoke-reason">Reason</label><textarea id="host-revoke-reason" name="reason" rows="3" required placeholder="Why this link is no longer current"></textarea></div><p class="files-form-note">${escapeHtml(normalizeString(reference?.relationType).replace(/_/gu, " ") || "Linked folder")}</p><div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Keep link</button><button class="files-button files-button--danger" type="submit">Revoke link</button></div></form>`;
}

function hostPickerOption(option, kind) {
  if (typeof option === "string") return { key: option, label: option };
  const key = normalizeString(
    option?.key ||
      option?.value ||
      (kind === "relation" ? option?.relationType : option?.purposeKey),
  );
  return key
    ? { key, label: normalizeString(option?.label || option?.name || key) }
    : null;
}

function hostFolderCanAttach(item) {
  const capabilities = item?.capabilities || {};
  const referenceType = state.hostReferenceContext?.referenceType;
  const restriction = normalizeString(item?.restriction).toLowerCase();
  const restricted = restriction && restriction !== "standard";
  const status = normalizeString(item?.status);
  return Boolean(
    entityId(item) &&
      normalizeString(item?.filesWorkspaceId) &&
      normalizeString(item?.authorizationRoot) &&
      resourceRevision(item) !== null &&
      normalizeString(item?.etag) &&
      (!status || status === "active") &&
      capabilities.canView === true &&
      capabilities.canLinkHostReference === true &&
      (referenceType === "restricted_import"
        ? restricted && capabilities.canImportHostReference === true
        : referenceType === "restricted_export"
          ? restricted &&
            capabilities.canExportHostReference === true &&
            capabilities.canDownloadRestricted === true
          : HOST_REFERENCE_TUPLES.has(referenceType)),
  );
}

function hostFolderBreadcrumb(item) {
  const breadcrumb = item?.breadcrumb;
  const path = Array.isArray(breadcrumb)
    ? breadcrumb
        .map((entry) => entityName(entry, ""))
        .filter(Boolean)
        .join(" / ")
    : normalizeString(breadcrumb);
  const principal = entityName(item?.principal, "Files workspace");
  const root = normalizeString(item?.authorizationRoot).replace(/_/gu, " ");
  return [principal, root, path].filter(Boolean).join(" · ");
}

function selectedHostFolder() {
  return (state.modal?.items || []).find(
    (item) => entityId(item) === state.modal?.selectedFolderId,
  );
}

function renderHostReferenceModal() {
  const modal = state.modal || {};
  const selected = selectedHostFolder();
  const relationAllowlist = new Set(selected?.allowedRelationKeys || []);
  const purposeAllowlist = new Set(selected?.allowedPurposeKeys || []);
  const relations = firstArray(modal.referenceOptions, ["relations"])
    .map((option) => hostPickerOption(option, "relation"))
    .filter(
      (option) =>
        option &&
        (!relationAllowlist.size || relationAllowlist.has(option.key)),
    );
  const purposes = firstArray(modal.referenceOptions, ["purposes"])
    .map((option) => hostPickerOption(option, "purpose"))
    .filter(
      (option) =>
        option && (!purposeAllowlist.size || purposeAllowlist.has(option.key)),
    );
  return `<div class="files-modal__heading"><p class="files-eyebrow">Connect Files to Polis</p><h2 id="files-modal-title">Attach a Files folder</h2><p>Choose an authorized folder for this ${escapeHtml(state.hostReferenceContext?.hostResourceType || "Polis item")}. The reference stays version-fenced and can be revoked.</p></div><form data-form="host-reference">${modal.loading ? '<div class="files-host-picker" aria-busy="true"><p>Loading authorized folders…</p></div>' : modal.error ? `<div class="files-empty files-empty--error"><p>${escapeHtml(modal.error)}</p></div>` : `<fieldset class="files-host-picker"><legend>Authorized folders across your workspaces</legend>${(modal.items || []).map((item) => `<label class="files-host-folder ${entityId(item) === modal.selectedFolderId ? "is-selected" : ""}"><input type="radio" name="folderId" value="${escapeHtml(entityId(item))}" data-action="host-folder" ${entityId(item) === modal.selectedFolderId ? "checked" : ""}/><span>${icon("folder")}</span><span><strong>${escapeHtml(entityName(item, "Folder"))}</strong><small>${escapeHtml(hostFolderBreadcrumb(item))}</small></span></label>`).join("") || "<p>No authorized folders can be attached to this item.</p>"}</fieldset>`}${selected ? `<div class="files-form-grid"><div class="files-field"><label for="host-relation">Relationship</label><select id="host-relation" name="relationType" required><option value="">Choose a relationship</option>${relations.map((option) => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join("")}</select></div>${purposes.length ? `<div class="files-field"><label for="host-purpose">Purpose</label><select id="host-purpose" name="purposeKey" required><option value="">Choose a purpose</option>${purposes.map((option) => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join("")}</select></div>` : ""}</div>` : ""}<div class="files-modal__actions"><button class="files-button files-button--ghost" type="button" data-action="close-modal">Cancel</button><button class="files-button files-button--primary" type="submit" ${selected && relations.length && purposes.length ? "" : "disabled"}>Attach folder</button></div></form>`;
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
  if (!state.postDraft.open || !postDraftCreationEnabled()) return "";
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
      : state.route.kind === "reference"
        ? renderHostReferenceDetail()
        : state.route.key === "home"
          ? renderHome()
          : renderView();
  return `<div class="files-shell">${renderSidebar()}<div class="files-main">${renderHeader()}<main class="files-content" id="files-content">${renderHostReferencesPanel()}${mainContent}</main></div>${renderMobileNav()}${renderModal()}${renderPostDrawer()}${state.toast ? `<div class="files-toast files-toast--${escapeHtml(state.toast.tone)}" role="status">${state.toast.tone === "success" ? icon("check") : icon("file")}<span>${escapeHtml(state.toast.message)}</span></div>` : ""}${state.busyAction ? '<div class="files-busy" role="status"><span></span><span class="sr-only">Working…</span></div>' : ""}</div>`;
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
  window.requestAnimationFrame(observePreviewTargets);
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

async function withBusy(
  key,
  operation,
  successMessage = "",
  { onError = null } = {},
) {
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
    if (Number(error?.status || 0) >= 400 && Number(error?.status || 0) < 500) {
      // A server-rejected request was not committed. A corrected retry must use
      // a new logical key because the body/version fingerprint will differ.
      state.mutationKeys.delete(key);
    }
    const message = onError ? await onError(error) : "";
    const materializationLockMessage =
      error?.code === "files_materialization_in_progress"
        ? "An edition change is being prepared. Current remains consistent; wait for it to finish before changing this workspace."
        : "";
    setToast(
      message ||
        materializationLockMessage ||
        error?.message ||
        "That action could not be completed.",
      "error",
    );
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
    };
    render();
    return;
  }
  const proposalAction = event.target.closest("[data-proposal-action]");
  if (proposalAction) {
    const proposalId = normalizeString(proposalAction.dataset.id);
    const proposalEntity = state.folderData.proposals.find(
      (item) => entityId(item) === proposalId,
    );
    const actorActions = proposalActorActions(proposalEntity);
    const action = proposalAction.dataset.proposalAction;
    if (
      (action === "resubmit" && !actorActions.canResubmit) ||
      (action === "withdraw" && !actorActions.canWithdraw)
    ) {
      return;
    }
    state.modal = {
      type: action === "resubmit" ? "proposal-resubmit" : "proposal-withdraw",
      proposalId,
    };
    render();
    return;
  }
  const incomingGrant = event.target.closest("[data-grant-request-action]");
  if (incomingGrant) {
    await respondToGrantRequest(
      incomingGrant.dataset.id,
      incomingGrant.dataset.grantRequestAction,
    );
    return;
  }
  const grant = event.target.closest("[data-grant-action]");
  if (grant) {
    await changeGrant(grant.dataset.id, grant.dataset.grantAction);
    return;
  }
  const edition = event.target.closest("[data-edition-action]");
  if (edition) {
    if (edition.dataset.editionAction === "archive") {
      state.modal = {
        type: "archive-edition",
        editionId: edition.dataset.id,
      };
      render();
    } else {
      await restoreEditionAsCurrent(edition.dataset.id);
    }
    return;
  }
  const uploadAction = event.target.closest("[data-upload-action]");
  if (uploadAction) {
    if (uploadAction.dataset.uploadAction === "pause")
      pauseUpload(uploadAction.dataset.id);
    if (uploadAction.dataset.uploadAction === "cancel")
      await cancelUpload(uploadAction.dataset.id);
    if (uploadAction.dataset.uploadAction === "resume")
      resumeUpload(uploadAction.dataset.id);
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
  if (action === "refresh-edition-materialization") {
    scheduleEditionMaterializationPoll({
      immediate: true,
      resetAttempts: true,
    });
  }
  if (action === "dismiss-edition-materialization") {
    clearEditionMaterialization();
    render();
  }
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
    state.modal = {
      type: "new-folder",
      parentFolderId:
        state.route.kind === "folder" ? entityId(state.folder) : "",
    };
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
  if (action === "open-host-reference") {
    if (!hostReferencesEnabled()) return;
    state.modal = {
      type: "host-reference",
      loading: true,
      items: [],
      referenceOptions: {},
      selectedFolderId: "",
    };
    render();
    await loadHostReferencePicker();
  }
  if (action === "revoke-host-reference") {
    const hostReferenceId = normalizeString(
      event.target.closest("[data-id]")?.dataset.id,
    );
    const reference = state.hostReferences.find(
      (item) => item.hostReferenceId === hostReferenceId,
    );
    if (!reference || normalizeString(reference.status) !== "active") return;
    state.modal = { type: "revoke-host-reference", hostReferenceId };
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
    if (!postDraftCreationEnabled()) {
      setToast(
        "Your current Polis role cannot create posts from this Files folder.",
        "error",
      );
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
      (item) => workspaceSelectionKey(item) === event.target.value,
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
  if (event.target.matches('[data-action="host-folder"]')) {
    state.modal.selectedFolderId = event.target.value;
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
  if (name === "proposal-resubmit") await submitProposalResubmission(data);
  if (name === "proposal-withdraw") await submitProposalWithdrawal();
  if (name === "proposal-decision") await submitProposalDecision(data);
  if (name === "edition") await submitEdition(data);
  if (name === "archive-edition") await submitArchiveEdition();
  if (name === "suggestion-edit") await submitSuggestionEdit(data);
  if (name === "archive-folder") await submitArchiveFolder(data);
  if (name === "host-reference") await submitHostReference(data);
  if (name === "revoke-host-reference") await submitRevokeHostReference(data);
  if (name === "post-draft") await submitPostDraft(data);
}

async function submitSetup(data, intent) {
  const principal = principalOf();
  const workspaceRevision = requireResourceRevision(
    state.workspace,
    "This Files workspace",
    { allowZero: true },
  );
  if (workspaceRevision === null) return;
  const rootKey = authorizationRootOf();
  if (!rootKey) {
    setToast(
      "This Files authorization scope is unavailable. Refresh and try again.",
      "error",
    );
    return;
  }
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
          expectedVersion: workspaceRevision,
          settings: {
            version: 1,
            defaultView: "my_files",
            suggestions: {
              contextMatches: data.has("contextMatchingEnabled"),
              socialPosts: true,
              duplicateMedia: true,
              aiAssistance:
                aiSuggestionsAvailable() && data.has("aiSuggestionsEnabled"),
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
            rolePurposeMappingsByRoot: { [rootKey]: {} },
          },
        },
        mutationOptions(actionKey, state.workspace, workspaceRevision),
      ),
    "Files is ready.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("workspace") : "",
    },
  );
  if (!result) return;
  state.modal = null;
  state.workspace = result?.workspace || {
    ...state.workspace,
    setup: { initialized: true, presetKey },
    setupByRoot: {
      ...(state.workspace?.setupByRoot || {}),
      ...(rootKey ? { [rootKey]: { initialized: true, presetKey } } : {}),
    },
  };
  const refreshed = await api.getWorkspace(principal.type, principal.id);
  state.workspace = normalizeWorkspacePayload(refreshed);
  await loadRoute();
}

async function submitNewFolder(data) {
  const principal = principalOf();
  const parentFolderId = normalizeString(state.modal?.parentFolderId);
  const target = parentFolderId ? state.folder : state.workspace;
  const targetLabel = parentFolderId ? "The parent folder" : "This workspace";
  const targetRevision = requireResourceRevision(target, targetLabel);
  if (targetRevision === null) return;
  const result = await withBusy(
    "folder",
    (actionKey) =>
      api.createFolder(
        principal.type,
        principal.id,
        {
          name: normalizeString(data.get("name")),
          description: normalizeString(data.get("description")),
          ...(parentFolderId ? { parentFolderId } : {}),
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
          expectedVersion: targetRevision,
        },
        mutationOptions(actionKey, target, targetRevision),
      ),
    "Folder created.",
    {
      onError: (error) =>
        isRevisionConflict(error)
          ? refreshFenceAfterConflict(parentFolderId ? "folder" : "workspace")
          : "",
    },
  );
  if (!result) return;
  state.modal = null;
  const folder = result.folder || result;
  if (entityId(folder))
    navigate(`/files/folders/${encodeURIComponent(entityId(folder))}`);
  else await loadRoute();
}

async function submitShare(data) {
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  if (folderRevision === null) return;
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
    expectedVersion: folderRevision,
  };
  const result = await withBusy(
    "share",
    (actionKey) =>
      api.createGrant(entityId(state.folder), grant, {
        ...mutationOptions(actionKey, state.folder, folderRevision),
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
      payload?.rolePurposeMappingsByRoot?.[authorizationRootOf()] ||
      payload?.rolePurposeMappings ||
      payload?.purposeMappings ||
      [];
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

async function loadHostReferencePicker() {
  if (state.modal?.type !== "host-reference" || !hostReferencesEnabled()) {
    return;
  }
  const context = state.hostReferenceContext;
  try {
    const payload = await api.getHostReferenceFolderPicker({
      referenceType: context.referenceType,
      hostSourceType: context.hostSourceType,
      hostSourceId: context.hostSourceId,
      hostResourceType: context.hostResourceType,
      hostResourceId: context.hostResourceId,
      hostResourceVersion: context.hostResourceVersion,
      limit: 100,
    });
    if (state.modal?.type !== "host-reference") return;
    const referenceOptions = payload?.referenceOptions || {};
    if (
      normalizeString(referenceOptions.scope) !== "folder" ||
      normalizeString(referenceOptions.referenceType) !==
        context.referenceType ||
      !firstArray(referenceOptions, ["relations"]).length
    ) {
      throw new FilesApiError(
        "The server did not authorize relationship options for this Polis item.",
        { code: "host_reference_options_invalid" },
      );
    }
    state.modal.items = firstArray(payload, ["items"]).filter(
      hostFolderCanAttach,
    );
    state.modal.referenceOptions = referenceOptions;
    state.modal.selectedFolderId = entityId(state.modal.items[0]);
    state.modal.loading = false;
    state.modal.error = "";
  } catch (error) {
    if (state.modal?.type !== "host-reference") return;
    state.modal.loading = false;
    state.modal.error =
      error?.message || "Authorized folders could not be loaded.";
  }
  render();
}

async function submitHostReference(data) {
  if (!hostReferencesEnabled()) return;
  const context = state.hostReferenceContext;
  const folder = selectedHostFolder();
  if (!folder || !hostFolderCanAttach(folder)) {
    setToast("Choose an authorized Files folder.", "error");
    return;
  }
  const relationType = normalizeString(data.get("relationType"));
  const purposeKey = normalizeString(data.get("purposeKey"));
  const relationKeys = new Set(
    firstArray(state.modal?.referenceOptions, ["relations"])
      .map((option) => hostPickerOption(option, "relation")?.key)
      .filter(Boolean),
  );
  const purposeKeys = new Set(
    firstArray(state.modal?.referenceOptions, ["purposes"])
      .map((option) => hostPickerOption(option, "purpose")?.key)
      .filter(Boolean),
  );
  const allowedRelations = new Set(folder.allowedRelationKeys || relationKeys);
  const allowedPurposes = new Set(folder.allowedPurposeKeys || purposeKeys);
  if (
    !relationType ||
    !purposeKey ||
    !relationKeys.has(relationType) ||
    !purposeKeys.has(purposeKey) ||
    !allowedRelations.has(relationType) ||
    !allowedPurposes.has(purposeKey)
  ) {
    setToast("Choose an allowed relationship and purpose.", "error");
    return;
  }
  const restriction = normalizeString(folder.restriction);
  const folderRevision = requireResourceRevision(
    folder,
    "The selected Files folder",
  );
  if (folderRevision === null || !normalizeString(folder.etag)) {
    setToast(
      "The selected folder is missing its current version tag. Refresh the picker and try again.",
      "error",
    );
    return;
  }
  const result = await withBusy("host-reference", (actionKey) =>
    api.createHostReference(
      {
        referenceType: context.referenceType,
        host: {
          sourceType: context.hostSourceType,
          sourceId: context.hostSourceId,
          resourceType: context.hostResourceType,
          resourceId: context.hostResourceId,
          resourceVersion: context.hostResourceVersion,
        },
        files: {
          filesWorkspaceId: folder.filesWorkspaceId,
          folderId: entityId(folder),
        },
        relationType,
        purposeKey,
        ...(restriction ? { restriction } : {}),
        expectedFolderVersion: folderRevision,
        expectedHostVersion: context.hostResourceVersion,
      },
      mutationOptions(actionKey, folder, folderRevision),
    ),
  );
  if (!result) return;
  if (!normalizeString(result?.hostReference?.hostReferenceId)) {
    setToast("Polis did not confirm the folder attachment.", "error");
    return;
  }
  state.modal = null;
  setToast("Files folder attached with revocable, version-fenced access.");
  await loadHostReferences();
}

async function submitRevokeHostReference(data) {
  if (!hostReferencesEnabled()) return;
  const reference = state.hostReferences.find(
    (item) => item.hostReferenceId === state.modal?.hostReferenceId,
  );
  if (!reference || !hostReferenceMatchesContext(reference)) {
    setToast(
      "This Files link is no longer available. Refresh and try again.",
      "error",
    );
    return;
  }
  const referenceRevision = requireResourceRevision(
    reference,
    "This Files link",
  );
  if (referenceRevision === null) return;
  const reason = normalizeString(data.get("reason"));
  if (!reason) {
    setToast("Add a reason before revoking this link.", "error");
    return;
  }
  const result = await withBusy(
    `host-reference:${reference.hostReferenceId}:revoke`,
    (actionKey) =>
      api.revokeHostReference(
        reference.hostReferenceId,
        {
          reason,
          expectedVersion: referenceRevision,
          expectedHostVersion: state.hostReferenceContext.hostResourceVersion,
        },
        mutationOptions(actionKey, reference, referenceRevision),
      ),
    "Files link revoked.",
  );
  if (!result) return;
  state.modal = null;
  await loadHostReferences();
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
      aiAssistance:
        aiSuggestionsAvailable() && data.has("aiSuggestionsEnabled"),
    },
    automations: {
      usageBadges: data.has("postUsageBadgesEnabled"),
    },
  };
  if (folder) return { inheritWorkspace: false, ...updated };
  const rootKey = authorizationRootOf();
  const rolePurposeMappings = activeRolePurposeMappings(current);
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
    rolePurposeMappings,
    ...(rootKey
      ? { rolePurposeMappingsByRoot: { [rootKey]: rolePurposeMappings } }
      : {}),
  };
}

async function submitSettings(data) {
  const principal = principalOf();
  const workspaceRevision = requireResourceRevision(
    state.workspace,
    "This Files workspace",
  );
  if (workspaceRevision === null) return;
  const result = await withBusy(
    "settings",
    (actionKey) =>
      api.updateSettings(
        principal.type,
        principal.id,
        {
          settings: settingsFromData(data),
          expectedVersion: workspaceRevision,
        },
        mutationOptions(actionKey, state.workspace, workspaceRevision),
      ),
    "Files settings saved.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("workspace") : "",
    },
  );
  if (!result) return;
  state.workspace.settings = result.settings || settingsFromData(data);
  state.workspace.revision = result.revision ?? state.workspace.revision;
  state.workspace.version = result.revision ?? state.workspace.version;
  state.workspace.etag = result.etag || state.workspace.etag;
  state.modal = null;
}

async function submitFolderSettings(data) {
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  if (folderRevision === null) return;
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
          expectedVersion: folderRevision,
        },
        mutationOptions(actionKey, state.folder, folderRevision),
      ),
    "Folder settings saved.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
  );
  if (!result) return;
  state.folder = result.folder || result;
  state.modal = null;
  await loadRoute();
}

function destinationFolderIds(operations = []) {
  return [
    ...new Set(
      operations
        .filter((operation) => normalizeString(operation?.type) === "move")
        .map((operation) => normalizeString(operation?.destinationFolderId))
        .filter(Boolean),
    ),
  ];
}

function exactDestinationFolderVersions(proposal) {
  const ids = destinationFolderIds(proposal?.operations || []);
  if (!ids.length) return {};
  const stored = proposal?.destinationFolderVersions || {};
  const result = {};
  for (const id of ids) {
    const revision = resourceRevision({ version: stored[id] });
    if (revision === null) {
      setToast(
        "A destination folder changed or is missing its current version. Refresh the proposal before reviewing it.",
        "error",
      );
      return null;
    }
    result[id] = revision;
  }
  return result;
}

async function destinationFenceForCreate(folderId) {
  if (!folderId) return null;
  if (folderId === entityId(state.folder)) {
    const revision = requireResourceRevision(
      state.folder,
      "The destination folder",
    );
    return revision === null ? null : { folder: state.folder, revision };
  }
  try {
    const payload = await api.getFolder(folderId);
    const folder = {
      ...(payload?.folder || payload),
      version: payload?.version ?? payload?.folder?.version,
      revision: payload?.revision ?? payload?.folder?.revision,
      etag: payload?.etag || payload?.folder?.etag || "",
    };
    const revision = requireResourceRevision(folder, "The destination folder");
    const sourceWorkspaceId = normalizeString(state.folder?.filesWorkspaceId);
    const destinationWorkspaceId = normalizeString(folder?.filesWorkspaceId);
    const sourceRoot = normalizeString(state.folder?.authorizationRoot);
    const destinationRoot = normalizeString(folder?.authorizationRoot);
    if (
      revision === null ||
      (sourceWorkspaceId && destinationWorkspaceId !== sourceWorkspaceId) ||
      (sourceRoot && destinationRoot !== sourceRoot)
    ) {
      setToast(
        "Choose an authorized destination in this Files workspace and authorization scope.",
        "error",
      );
      return null;
    }
    return { folder, revision };
  } catch (error) {
    setToast(
      error?.message || "The destination folder could not be verified.",
      "error",
    );
    return null;
  }
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
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  if (folderRevision === null) return;
  let expectedDestinationFolderVersions = {};
  if (operation.type === "move") {
    const destination = await destinationFenceForCreate(
      operation.destinationFolderId,
    );
    if (!destination) return;
    expectedDestinationFolderVersions = {
      [operation.destinationFolderId]: destination.revision,
    };
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
          expectedVersion: folderRevision,
          ...(Object.keys(expectedDestinationFolderVersions).length
            ? { expectedDestinationFolderVersions }
            : {}),
        },
        mutationOptions(actionKey, state.folder, folderRevision),
      ),
    "Change submitted for review.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitProposalResubmission(data) {
  const proposal = state.folderData.proposals.find(
    (item) => entityId(item) === state.modal?.proposalId,
  );
  if (!proposalActorActions(proposal).canResubmit) return;
  const proposalRevision = requireResourceRevision(
    proposal,
    "This proposed change",
  );
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  const expectedDestinationFolderVersions =
    exactDestinationFolderVersions(proposal);
  const operations = firstArray(proposal, ["operations"]);
  if (
    proposalRevision === null ||
    folderRevision === null ||
    expectedDestinationFolderVersions === null
  ) {
    return;
  }
  if (!operations.length) {
    setToast(
      "This proposal is missing its version-fenced change operations. Refresh before resubmitting.",
      "error",
    );
    return;
  }
  const result = await withBusy(
    `proposal:${entityId(proposal)}:resubmit`,
    (actionKey) =>
      api.resubmitProposal(
        entityId(proposal),
        {
          title: normalizeString(data.get("title")),
          description: normalizeString(data.get("description")),
          operations,
          expectedVersion: proposalRevision,
          expectedFolderVersion: folderRevision,
          ...(Object.keys(expectedDestinationFolderVersions).length
            ? { expectedDestinationFolderVersions }
            : {}),
        },
        mutationOptions(actionKey, proposal, proposalRevision),
      ),
    "Proposed change returned to review.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitProposalWithdrawal() {
  const proposal = state.folderData.proposals.find(
    (item) => entityId(item) === state.modal?.proposalId,
  );
  if (!proposalActorActions(proposal).canWithdraw) return;
  const proposalRevision = requireResourceRevision(
    proposal,
    "This proposed change",
  );
  if (proposalRevision === null) return;
  const result = await withBusy(
    `proposal:${entityId(proposal)}:withdraw`,
    (actionKey) =>
      api.withdrawProposal(
        entityId(proposal),
        { expectedVersion: proposalRevision },
        mutationOptions(actionKey, proposal, proposalRevision),
      ),
    "Proposed change withdrawn from review.",
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitProposalDecision(data) {
  const modal = state.modal;
  const proposal = state.folderData.proposals.find(
    (item) => entityId(item) === modal?.proposalId,
  );
  const proposalRevision = requireResourceRevision(
    proposal,
    "This proposed change",
  );
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  const expectedDestinationFolderVersions =
    exactDestinationFolderVersions(proposal);
  if (
    proposalRevision === null ||
    folderRevision === null ||
    expectedDestinationFolderVersions === null
  ) {
    return;
  }
  const result = await withBusy(
    "review",
    (actionKey) =>
      api.reviewProposal(
        modal.proposalId,
        {
          decision: modal.decision,
          reason: normalizeString(data.get("reason")),
          expectedVersion: proposalRevision,
          expectedFolderVersion: folderRevision,
          ...(Object.keys(expectedDestinationFolderVersions).length
            ? { expectedDestinationFolderVersions }
            : {}),
        },
        mutationOptions(actionKey, proposal, proposalRevision),
      ),
    modal.decision === "approve"
      ? "Proposal approved and merged."
      : modal.decision === "request_changes"
        ? "Changes requested from the contributor."
        : "Proposal refused.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

function normalizedEditionMaterialization(payload) {
  const materialization = payload?.materialization || payload;
  const materializationId = normalizeString(materialization?.materializationId);
  const status = normalizeString(materialization?.status);
  const mode = normalizeString(materialization?.mode);
  if (
    !/^[a-zA-Z0-9_-]{1,200}$/u.test(materializationId) ||
    !["restore", "archive"].includes(mode) ||
    !["pending", "applying", "consolidating", "complete", "failed"].includes(
      status,
    ) ||
    resourceRevision(materialization) === null
  ) {
    throw new FilesApiError(
      "Polis returned an invalid edition preparation status. Refresh Files before changing versions.",
      { code: "edition_materialization_contract_invalid" },
    );
  }
  return {
    ...materialization,
    materializationId,
    status,
    mode,
    revision: payload?.revision ?? materialization.revision,
    version:
      materialization.version ?? payload?.revision ?? materialization.revision,
    etag: normalizeString(payload?.etag || materialization.etag),
  };
}

function resumeWorkspaceEditionMaterialization() {
  const active = state.workspace?.activeMaterialization;
  if (!active || !can("canManage", "files_manage")) return false;
  let materialization;
  try {
    materialization = normalizedEditionMaterialization(active);
  } catch {
    // Workspace summaries are actor-scoped. A malformed or unexpectedly broad
    // projection is ignored rather than probing its manager-only status route.
    return false;
  }
  if (materialization.status === "complete") return false;
  state.editionMaterialization = {
    folderId: state.route.kind === "folder" ? state.route.folderId : "",
    workspaceWide: true,
    materialization,
    completeMessage:
      materialization.mode === "restore"
        ? "Edition restore completed with its versioned contents."
        : "Current version archived and preserved in history.",
    attempt: 0,
    pollingStopped: materialization.status === "failed",
  };
  return materialization.status !== "failed";
}

function editionMaterializationMessage(error) {
  if (error?.code === "files_materialization_in_progress") {
    return "Another edition change is already being prepared. Current remains consistent; check its status before trying again.";
  }
  return isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "";
}

function beginEditionMaterialization(payload, { folderId, completeMessage }) {
  if (payload?.accepted !== true) {
    throw new FilesApiError(
      "Polis did not confirm that this edition change was queued.",
      { code: "edition_materialization_not_accepted" },
    );
  }
  const materialization = normalizedEditionMaterialization(payload);
  editionMaterializationGeneration += 1;
  if (editionMaterializationTimer) {
    window.clearTimeout(editionMaterializationTimer);
    editionMaterializationTimer = null;
  }
  state.editionMaterialization = {
    folderId,
    workspaceWide: true,
    materialization,
    completeMessage,
    attempt: 0,
    pollingStopped: false,
  };
  render();
  scheduleEditionMaterializationPoll();
}

function scheduleEditionMaterializationPoll({
  immediate = false,
  resetAttempts = false,
} = {}) {
  const tracker = state.editionMaterialization;
  const materializationId = normalizeString(
    tracker?.materialization?.materializationId,
  );
  if (!tracker || !materializationId) return;
  if (editionMaterializationTimer) {
    window.clearTimeout(editionMaterializationTimer);
    editionMaterializationTimer = null;
  }
  if (resetAttempts) tracker.attempt = 0;
  tracker.pollingStopped = false;
  if (tracker.attempt >= EDITION_MATERIALIZATION_POLL_LIMIT) {
    tracker.pollingStopped = true;
    render();
    return;
  }
  const generation = editionMaterializationGeneration;
  const delay = immediate
    ? 0
    : Math.min(
        EDITION_MATERIALIZATION_POLL_BASE_MS * 2 ** tracker.attempt,
        EDITION_MATERIALIZATION_POLL_MAX_MS,
      );
  editionMaterializationTimer = window.setTimeout(async () => {
    editionMaterializationTimer = null;
    try {
      const payload = await api.getEditionMaterialization(materializationId);
      if (generation !== editionMaterializationGeneration) return;
      const materialization = normalizedEditionMaterialization(payload);
      if (materialization.materializationId !== materializationId) {
        throw new FilesApiError("Edition status did not match this request.", {
          code: "edition_materialization_mismatch",
        });
      }
      tracker.materialization = materialization;
      tracker.attempt += 1;
      if (materialization.status === "complete") {
        const message = tracker.completeMessage;
        clearEditionMaterialization();
        await loadRoute();
        setToast(message);
        return;
      }
      if (materialization.status === "failed") {
        render();
        return;
      }
      render();
      scheduleEditionMaterializationPoll();
    } catch (error) {
      if (generation !== editionMaterializationGeneration) return;
      if ([401, 403, 404].includes(Number(error?.status || 0))) {
        clearEditionMaterialization();
        setToast(
          "Edition status is no longer available to this account. No partial version is shown.",
          "error",
        );
        return;
      }
      tracker.attempt += 1;
      if (tracker.attempt >= EDITION_MATERIALIZATION_POLL_LIMIT) {
        tracker.pollingStopped = true;
        render();
        return;
      }
      scheduleEditionMaterializationPoll();
    }
  }, delay);
}

async function restoreEditionAsCurrent(id) {
  if (activeEditionMaterialization()) return;
  const edition = state.folderData.editions.find(
    (item) => entityId(item) === id,
  );
  if (!edition || editionIsCurrent(edition)) return;
  const editionRevision = requireResourceRevision(
    edition,
    "The archived edition",
  );
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  const currentEditionId = normalizeString(state.folder?.currentEditionId);
  const current = state.folderData.editions.find(
    (item) => entityId(item) === currentEditionId || editionIsCurrent(item),
  );
  if (currentEditionId && currentEditionId !== id && !current) {
    setToast(
      "The current edition version is missing. Refresh Files before restoring another edition.",
      "error",
    );
    return;
  }
  const currentRevision =
    current && entityId(current) !== id
      ? requireResourceRevision(current, "The current edition")
      : null;
  if (
    editionRevision === null ||
    folderRevision === null ||
    (current && entityId(current) !== id && currentRevision === null)
  ) {
    return;
  }
  const result = await withBusy(
    `edition:${id}:restore`,
    (actionKey) =>
      api.restoreEdition(
        id,
        {
          expectedVersion: editionRevision,
          expectedFolderVersion: folderRevision,
          ...(current && entityId(current) !== id
            ? {
                archiveCurrent: true,
                expectedCurrentEditionVersion: currentRevision,
              }
            : {}),
        },
        mutationOptions(actionKey, edition, editionRevision),
      ),
    "",
    { onError: editionMaterializationMessage },
  );
  if (!result) return;
  try {
    beginEditionMaterialization(result, {
      folderId: entityId(state.folder),
      completeMessage:
        "Archived edition restored as Current with its versioned contents.",
    });
  } catch (error) {
    setToast(error.message, "error");
  }
}

async function submitEdition(data) {
  const current = state.folderData.editions.find(editionIsCurrent);
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  const currentRevision = current
    ? requireResourceRevision(current, "The current edition")
    : null;
  if (folderRevision === null || (current && currentRevision === null)) return;
  const optionalInteger = (name) => {
    const value = normalizeString(data.get(name));
    return value && /^\d{4}$/u.test(value) ? Number(value) : undefined;
  };
  const optionalText = (name) => {
    const value = normalizeString(data.get(name));
    return value || undefined;
  };
  const result = await withBusy(
    "edition",
    (actionKey) =>
      api.startEdition(
        entityId(state.folder),
        {
          label: normalizeString(data.get("label")),
          type: normalizeString(data.get("type")),
          ...(optionalInteger("effectiveYear") !== undefined
            ? { effectiveYear: optionalInteger("effectiveYear") }
            : {}),
          ...(optionalInteger("cycle") !== undefined
            ? { cycle: optionalInteger("cycle") }
            : {}),
          ...(optionalText("boundaryVintage")
            ? { boundaryVintage: optionalText("boundaryVintage") }
            : {}),
          ...(optionalText("effectiveFrom")
            ? { effectiveFrom: optionalText("effectiveFrom") }
            : {}),
          ...(optionalText("effectiveTo")
            ? { effectiveTo: optionalText("effectiveTo") }
            : {}),
          archiveCurrent: true,
          expectedVersion: folderRevision,
          ...(current
            ? { expectedCurrentEditionVersion: currentRevision }
            : {}),
        },
        mutationOptions(actionKey, state.folder, folderRevision),
      ),
    "New current edition started; the prior version remains archived.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
  );
  if (!result) return;
  state.modal = null;
  await loadRoute();
}

async function submitArchiveEdition() {
  const id = normalizeString(state.modal?.editionId);
  const edition = state.folderData.editions.find(
    (item) => entityId(item) === id,
  );
  const currentEditionId = normalizeString(state.folder?.currentEditionId);
  if (
    !edition ||
    (currentEditionId ? currentEditionId !== id : !editionIsCurrent(edition))
  ) {
    setToast(
      "Only the folder’s current edition can use Archive current version. Refresh Files and review the edition history.",
      "error",
    );
    return;
  }
  const editionRevision = requireResourceRevision(
    edition,
    "The current edition",
  );
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  if (editionRevision === null || folderRevision === null) return;
  const result = await withBusy(
    `edition:${id}:archive`,
    (actionKey) =>
      api.archiveEdition(
        id,
        {
          expectedVersion: editionRevision,
          expectedFolderVersion: folderRevision,
        },
        mutationOptions(actionKey, edition, editionRevision),
      ),
    "",
    {
      onError: editionMaterializationMessage,
    },
  );
  if (!result) return;
  state.modal = null;
  try {
    beginEditionMaterialization(result, {
      folderId: entityId(state.folder),
      completeMessage: "Current version archived and preserved in history.",
    });
  } catch (error) {
    setToast(error.message, "error");
  }
}

async function submitSuggestionEdit(data) {
  const suggestion = state.suggestions.find(
    (item) => entityId(item) === state.modal?.suggestionId,
  );
  const existingRecommendation = suggestion?.recommendation || {};
  const suggestionRevision = requireResourceRevision(
    suggestion,
    "This recommendation",
  );
  if (suggestionRevision === null) return;
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
          expectedVersion: suggestionRevision,
          recommendation: {
            caption: normalizeString(data.get("caption")),
            ...(assetIds.length ? { assetIds } : {}),
            scheduledFor,
          },
        },
        mutationOptions(actionKey, suggestion, suggestionRevision),
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
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  if (folderRevision === null) return;
  const result = await withBusy(
    "archive-folder",
    (actionKey) =>
      api.archiveFolder(
        entityId(state.folder),
        {
          reason: normalizeString(data.get("reason")),
          expectedVersion: folderRevision,
        },
        mutationOptions(actionKey, state.folder, folderRevision),
      ),
    "Folder archived with its history preserved.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
  );
  if (!result) return;
  state.modal = null;
  navigate("/files");
}

async function submitPostDraft(data) {
  if (!postDraftCreationEnabled()) {
    setToast(
      "Your current Polis role cannot create posts from this Files folder.",
      "error",
    );
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
  const folderRevision = requireResourceRevision(state.folder, "This folder");
  if (folderRevision === null) return;
  const expectedAssetVersions = {};
  for (const item of selected) {
    const revision = requireResourceRevision(
      item,
      entityName(item, "This media item"),
    );
    if (revision === null) return;
    expectedAssetVersions[entityId(item)] = revision;
  }
  const result = await withBusy(
    "post",
    (actionKey) =>
      api.createPostDraft(
        {
          filesWorkspaceId: state.workspace.filesWorkspaceId,
          folderId: entityId(state.folder),
          description: normalizeString(data.get("description")),
          expectedFolderVersion: folderRevision,
          expectedAssetVersions,
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
        mutationOptions(actionKey, state.folder, folderRevision),
      ),
    "Post draft created with Files provenance.",
    {
      onError: (error) =>
        isRevisionConflict(error) ? refreshFenceAfterConflict("folder") : "",
    },
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
  const suggestionRevision = requireResourceRevision(
    suggestion,
    "This recommendation",
  );
  if (suggestionRevision === null) return;
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
            expectedVersion: suggestionRevision,
            scope: "folder",
          },
          mutationOptions(actionKey, suggestion, suggestionRevision),
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
          expectedVersion: suggestionRevision,
          ...(action === "snooze" ? { snoozedUntil } : {}),
        },
        mutationOptions(actionKey, suggestion, suggestionRevision),
      ),
    action === "accept"
      ? "Recommendation accepted."
      : action === "snooze"
        ? "Recommendation snoozed for one week."
        : "Recommendation dismissed.",
  );
  if (!result) return;
  state.suggestions = state.suggestions.filter((item) => entityId(item) !== id);
  const folderId = normalizeString(
    result?.suggestion?.folderId ||
      result?.folderId ||
      result?.folder?.folderId ||
      suggestion?.folderId,
  );
  if (action === "accept" && folderId) {
    if (isContextualSharePrompt(suggestion)) {
      navigate(`/files/folders/${encodeURIComponent(folderId)}?tab=access`);
      return;
    }
    if (isMediaPostPrompt(suggestion)) {
      navigate(`/files/folders/${encodeURIComponent(folderId)}?tab=current`);
    }
  }
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

async function changeGrant(id, action) {
  const grant = state.folderData.grants.find((item) => entityId(item) === id);
  const expectedVersion = requireResourceRevision(grant, "This access grant");
  if (expectedVersion === null) return;
  const result = await withBusy(
    `grant:${id}:${action}`,
    (actionKey) =>
      api.changeGrant(
        id,
        action,
        { expectedVersion },
        mutationOptions(actionKey, grant, expectedVersion),
      ),
    action === "approve" ? "Restricted access approved." : "Access revoked.",
  );
  if (result) await loadRoute();
}

async function respondToGrantRequest(id, action) {
  if (!id || !["accept", "decline"].includes(action)) return;
  const request = state.incomingGrantRequests.find(
    (item) => normalizeString(item?.grantId || item?.grant?.grantId) === id,
  );
  const grant = request?.grant || request;
  const expectedVersion = requireResourceRevision(grant, "This access request");
  if (expectedVersion === null) return;
  const result = await withBusy(
    `incoming-grant:${id}:${action}`,
    (actionKey) =>
      api.changeGrant(
        id,
        action,
        {
          expectedVersion,
          ...(action === "decline"
            ? { reason: "Declined by the named recipient" }
            : {}),
        },
        mutationOptions(actionKey, grant, expectedVersion),
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

function addUploads(fileList, { intent = "", proposal = null } = {}) {
  const folderId =
    state.modal?.folderId ||
    entityId(state.folder) ||
    entityId(workspaceRoots()[0]);
  if (!folderId) {
    setToast("Choose or create a destination folder first.", "error");
    return false;
  }
  const folderResource =
    entityId(state.folder) === folderId
      ? state.folder
      : workspaceRoots().find((item) => entityId(item) === folderId);
  const folderVersion = requireResourceRevision(
    folderResource,
    "The upload folder",
  );
  if (folderVersion === null) return false;
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
    folderVersion,
    folderEtag: resourceEtag(folderResource, folderVersion),
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

function uploadSessionFileMetadata(item) {
  const file = item.file || item.fileMetadata || {};
  return {
    name: normalizeString(file.name || file.fileName),
    size: Number(file.size),
    type:
      normalizeString(file.type || file.contentType) ||
      "application/octet-stream",
  };
}

function rememberUploadSession(item, session) {
  const file = uploadSessionFileMetadata(item);
  const sessionId = normalizeString(session?.uploadSessionId || session?.id);
  if (!sessionId) {
    throw new FilesApiError("The resumable upload session was incomplete.");
  }
  const knownSessionId = normalizeString(item.sessionId);
  if (knownSessionId && sessionId !== knownSessionId) {
    throw new FilesApiError("The resumable upload session did not match.", {
      code: "upload_session_identity_mismatch",
    });
  }
  item.sessionId = sessionId;
  item.sessionVersion = session?.version;
  item.assetId = normalizeString(session?.assetId || item.assetId);
  item.revisionId = normalizeString(session?.revisionId || item.revisionId);
  item.proposalId = uploadProposalId(session, item.proposalId);
  item.intent = normalizeString(session?.intent || item.intent) || "commit";
  item.proposal = session?.proposal || item.proposal || null;
  item.partSize = Number(session?.partSize || item.partSize || 5 * 1024 * 1024);
  item.totalParts = Number(
    session?.totalParts ||
      item.totalParts ||
      Math.ceil(file.size / item.partSize),
  );
  item.completedParts = Array.isArray(session?.uploadedParts)
    ? session.uploadedParts
    : item.completedParts || [];
  item.sessionCreationStarted = false;
}

function uploadSessionCreationWasDefinitivelyRejected(
  error,
  { recoveryAttempt = false } = {},
) {
  if (recoveryAttempt) return false;
  const status = Number(error?.status);
  if (!Number.isInteger(status) || status < 400 || status >= 500) return false;
  if ([401, 403, 408, 425, 429].includes(status)) return false;
  // Only explicit pre-create validation failures prove the first request did
  // not create a session. Generic conflicts can occur after a commit, while
  // replay, authorization, throttling, and timeout failures are inconclusive.
  return new Set([
    "folder_not_found",
    "files_workspace_not_initialized",
    "invalid_file_name",
    "invalid_content_type",
    "unsafe_upload_type",
    "invalid_upload_size",
    "invalid_checksum_sha256",
    "invalid_upload_intent",
    "invalid_upload_part_count",
    "invalid_proposal_action",
    "proposal_target_asset_required",
    "proposal_target_asset_invalid",
    "files_quota_exceeded",
    "expected_version_required",
    "missing_idempotency_key",
    "idempotency_key_required",
  ]).has(normalizeString(error?.code));
}

async function createOrRecoverUploadSession(item) {
  const activeCreation = state.uploadSessionCreations.get(item.id);
  if (activeCreation) return activeCreation;
  const recoveryAttempt = item.sessionCreationStarted === true;
  const file = uploadSessionFileMetadata(item);
  if (
    !file.name ||
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    !normalizeString(item.checksumSha256)
  ) {
    throw new FilesApiError(
      "The pending upload session cannot be recovered without its file metadata and checksum.",
    );
  }
  const uploadFolderRevision = assertResourceRevision(
    { version: item.folderVersion },
    "The upload folder",
  );
  item.sessionCreationStarted = true;
  persistUploadCheckpoints();
  const creation = (async () => {
    try {
      const session = normalizedUploadSession(
        await api.createUploadSession(
          item.folderId,
          {
            fileName: file.name,
            contentType: file.type,
            size: file.size,
            checksumSha256: item.checksumSha256,
            idempotencyKey: item.id,
            intent: item.intent || "commit",
            ...(item.intent === "proposal" && item.proposal
              ? { proposal: item.proposal }
              : {}),
            expectedVersion: uploadFolderRevision,
          },
          {
            idempotencyKey: item.id,
            ...(item.folderEtag
              ? { headers: { "If-Match": item.folderEtag } }
              : {}),
          },
        ),
      );
      rememberUploadSession(item, session);
      persistUploadCheckpoints();
      return session;
    } catch (error) {
      if (
        !item.sessionId &&
        uploadSessionCreationWasDefinitivelyRejected(error, { recoveryAttempt })
      ) {
        item.sessionCreationStarted = false;
        persistUploadCheckpoints();
      }
      throw error;
    }
  })();
  state.uploadSessionCreations.set(item.id, creation);
  try {
    return await creation;
  } finally {
    if (state.uploadSessionCreations.get(item.id) === creation) {
      state.uploadSessionCreations.delete(item.id);
    }
  }
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
      folderVersion: item.folderVersion,
      folderEtag: item.folderEtag || "",
      userId,
      sessionId: item.sessionId || "",
      sessionVersion: item.sessionVersion,
      assetId: item.assetId || "",
      revisionId: item.revisionId || "",
      proposalId: item.proposalId || "",
      intent: item.intent || "commit",
      proposal: item.proposal || null,
      status: item.status,
      scanPollAttempts: item.scanPollAttempts || 0,
      checksumSha256: item.checksumSha256 || "",
      partSize: item.partSize || 0,
      totalParts: item.totalParts || 0,
      completedParts: item.completedParts || [],
      progress: item.progress || 0,
      cancelRequested: item.cancelRequested === true,
      sessionCreationStarted: item.sessionCreationStarted === true,
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
    ? checkpoints.map((item) => {
        const cancelRequested =
          item.cancelRequested === true ||
          ["cancelling", "cancel_pending"].includes(item.status);
        return {
          ...item,
          file: null,
          cancelRequested,
          sessionCreationStarted: item.sessionCreationStarted === true,
          status: cancelRequested
            ? "cancel_pending"
            : ["scanning", "quarantined"].includes(item.status)
              ? item.status
              : "paused",
          error: cancelRequested
            ? "Cancellation is pending and will retry automatically."
            : "",
        };
      })
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
  await Promise.all(
    state.uploadQueue.map(async (item) => {
      if (item.cancelRequested) {
        applyUploadAbortResult(item, await abortUploadSession(item));
        return;
      }
      await refreshUploadStatus(item);
    }),
  );
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

function uploadAbortError(message) {
  return new DOMException(message, "AbortError");
}

function assertUploadTransferActive(item, signal) {
  if (signal?.aborted || item.pauseRequested || item.cancelRequested) {
    throw signal?.reason instanceof Error
      ? signal.reason
      : uploadAbortError(
          item.pauseRequested ? "Upload paused." : "Upload cancelled.",
        );
  }
}

/** Pausing stops only local work; the live multipart session stays resumable. */
function pauseUpload(id) {
  const item = state.uploadQueue.find((entry) => entry.id === id);
  if (!item || !["hashing", "uploading"].includes(item.status)) return;
  item.pauseRequested = true;
  item.cancelRequested = false;
  item.status = "pausing";
  item.error = "";
  persistUploadCheckpoints();
  render();
  const controller = state.uploadControllers.get(id);
  if (controller) {
    controller.abort(uploadAbortError("Upload paused."));
  } else {
    item.status = "paused";
    persistUploadCheckpoints();
    render();
  }
}

function resumeUpload(id, file = null) {
  const item = state.uploadQueue.find((entry) => entry.id === id);
  const selectedFile = file || item?.file;
  if (!item || !selectedFile || state.uploadControllers.has(id)) return;
  if (!fileMatchesCheckpoint(selectedFile, item.fileMetadata)) {
    setToast(
      "Choose the original file with the same name, size, and modified date.",
      "error",
    );
    return;
  }
  item.file = selectedFile;
  item.pauseRequested = false;
  item.cancelRequested = false;
  startUpload(item);
}

function startUpload(item) {
  if (
    !item?.file ||
    state.uploadControllers.has(item.id) ||
    state.uploadRuns.has(item.id)
  ) {
    return null;
  }
  const run = runUpload(item);
  state.uploadRuns.set(item.id, run);
  run
    .finally(() => {
      if (state.uploadRuns.get(item.id) === run) {
        state.uploadRuns.delete(item.id);
      }
    })
    .catch(() => {});
  return run;
}

async function runUpload(item) {
  item.pauseRequested = false;
  item.cancelRequested = false;
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
        signal: controller.signal,
        onProgress: (progress) => {
          item.hashProgress = progress;
          render();
        },
      });
    }
    assertUploadTransferActive(item, controller.signal);
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
      session = await createOrRecoverUploadSession(item);
    }
    rememberUploadSession(item, session);
    persistUploadCheckpoints();
    assertUploadTransferActive(item, controller.signal);
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
      assertUploadTransferActive(item, controller.signal);
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
          return {
            partNumber,
            blob,
            checksumSha256: await checksumBlob(blob, {
              signal: controller.signal,
            }),
          };
        }),
      );
      assertUploadTransferActive(item, controller.signal);
      const signed = await api.presignUploadParts(
        item.sessionId,
        {
          parts: prepared.map(({ partNumber, checksumSha256 }) => ({
            partNumber,
            checksumSha256,
          })),
          expectedVersion: assertResourceRevision(
            { version: item.sessionVersion },
            "The upload session",
          ),
        },
        mutationOptions(
          `${item.id}:presign:${partNumbers.join("-")}`,
          { version: item.sessionVersion },
          item.sessionVersion,
        ),
      );
      assertUploadTransferActive(item, controller.signal);
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
          expectedVersion: assertResourceRevision(
            { version: item.sessionVersion },
            "The upload session",
          ),
        },
        mutationOptions(
          `${item.id}:checkpoint:${partNumbers.join("-")}`,
          { version: item.sessionVersion },
          item.sessionVersion,
        ),
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
    assertUploadTransferActive(item, controller.signal);
    item.status = "finalizing";
    persistUploadCheckpoints();
    render();
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
        expectedVersion: assertResourceRevision(
          { version: item.sessionVersion },
          "The upload session",
        ),
      },
      mutationOptions(
        `${item.id}:complete`,
        { version: item.sessionVersion },
        item.sessionVersion,
      ),
    );
    assertUploadTransferActive(item, controller.signal);
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
    const interrupted = error?.name === "AbortError";
    if (item.cancelRequested) {
      applyUploadAbortResult(item, await abortUploadSession(item));
    } else {
      item.status = interrupted ? "paused" : "error";
      item.error = interrupted ? "Paused" : error?.message || "Upload failed";
    }
    persistUploadCheckpoints();
  } finally {
    state.uploadControllers.delete(item.id);
    render();
  }
}

function uploadAbortActionKey(item, sessionRevision) {
  return `${item.id}:abort:v${sessionRevision}`;
}

async function reconcileUploadSessionBeforeAbort(item) {
  try {
    const session = normalizedUploadSession(
      await api.getUploadSession(item.sessionId),
    );
    rememberUploadSession(item, session);
    persistUploadCheckpoints();
    const sessionState = normalizeString(session?.state).toLowerCase();
    if (["aborted", "expired", "failed"].includes(sessionState)) {
      return { aborted: true };
    }
    if (!sessionState || sessionState === "uploading") {
      return { ready: true };
    }
    if (
      [
        "uploaded",
        "scanning",
        "ready",
        "complete",
        "completed",
        "quarantined",
      ].includes(sessionState)
    ) {
      applyUploadSessionState(item, session);
      return { cancellationSuperseded: true, sessionState };
    }
    return {
      aborted: false,
      error: new FilesApiError(
        `The upload reached ${sessionState} before cancellation could be confirmed.`,
        { code: "upload_session_not_abortable" },
      ),
    };
  } catch (error) {
    if ([404, 410].includes(Number(error?.status))) {
      return { aborted: true };
    }
    return { aborted: false, error };
  }
}

async function attemptUploadSessionAbort(item) {
  const sessionRevision = assertResourceRevision(
    { version: item.sessionVersion },
    "The upload session",
  );
  const actionKey = uploadAbortActionKey(item, sessionRevision);
  await api.abortUpload(
    item.sessionId,
    {
      expectedVersion: sessionRevision,
      idempotencyKey: actionKey,
    },
    mutationOptions(actionKey, { version: sessionRevision }, sessionRevision),
  );
  return { aborted: true };
}

async function abortUploadSession(item) {
  if (!item.abortPromise) {
    item.abortPromise = (async () => {
      try {
        if (
          !item.sessionId &&
          (item.sessionCreationStarted ||
            state.uploadSessionCreations.has(item.id))
        ) {
          try {
            await createOrRecoverUploadSession(item);
          } catch (error) {
            if (!item.sessionId && item.sessionCreationStarted === false) {
              return { aborted: true };
            }
            throw error;
          }
        }
        if (!item.sessionId) return { aborted: true };
        const reconciled = await reconcileUploadSessionBeforeAbort(item);
        if (!reconciled.ready) return reconciled;
        try {
          return await attemptUploadSessionAbort(item);
        } catch (error) {
          if (error?.code !== "files_version_conflict") throw error;
          const reconciled = await reconcileUploadSessionBeforeAbort(item);
          if (!reconciled.ready) return reconciled;
          return await attemptUploadSessionAbort(item);
        }
      } catch (error) {
        return { aborted: false, error };
      }
    })();
  }
  const abortPromise = item.abortPromise;
  const result = await abortPromise;
  if (item.abortPromise === abortPromise) item.abortPromise = null;
  return result;
}

function applyUploadAbortResult(item, result) {
  item.pauseRequested = false;
  if (result.cancellationSuperseded) {
    item.cancelRequested = false;
    if (item.status === "scanning") {
      item.error =
        "Upload completed before cancellation · security scan in progress";
      scheduleUploadStatusPoll(item);
    }
    return;
  }
  item.cancelRequested = true;
  if (result.aborted) {
    item.status = "cancelled";
    item.error = "Cancelled";
    return;
  }
  item.status = "cancel_pending";
  item.error =
    "Cancellation could not reach the server. It will retry when Files reloads, or you can retry now.";
}

async function cancelUpload(id) {
  const item = state.uploadQueue.find((entry) => entry.id === id);
  if (!item) return;
  item.cancelRequested = true;
  item.pauseRequested = false;
  const pollTimer = state.uploadPollTimers.get(id);
  if (pollTimer) window.clearTimeout(pollTimer);
  state.uploadPollTimers.delete(id);
  item.status = "cancelling";
  item.error = "";
  persistUploadCheckpoints();
  render();
  const activeRun = state.uploadRuns.get(id);
  state.uploadControllers.get(id)?.abort(uploadAbortError("Upload cancelled."));
  if (activeRun) {
    await activeRun;
    if (
      !item.cancelRequested ||
      ["cancelled", "cancel_pending"].includes(item.status)
    )
      return;
  }
  applyUploadAbortResult(item, await abortUploadSession(item));
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
    state.modal?.type === "setup" && !activeWorkspaceSetup().initialized;
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
