import { buildAuthorizedHeaders } from "../../shared-feed/scripts/sharedFeedAuth.js";

const JSON_CONTENT_TYPE = "application/json";

function trimTrailingSlash(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/u, "");
}

function encodeSegment(value) {
  return encodeURIComponent(String(value || "").trim());
}

function mutationHeaders(headers = {}, stableIdempotencyKey = "") {
  return { ...headers, "Idempotency-Key": stableIdempotencyKey };
}

function hasExpectedRevision(body) {
  return Object.entries(body || {}).some(
    ([key, value]) =>
      /^expected(?:[A-Z][A-Za-z0-9]*)?Version(?:s)?$/u.test(key) &&
      value !== undefined &&
      value !== null &&
      value !== "",
  );
}

/**
 * Files mutations are optimistic and replay-safe by contract. Keeping the
 * assertion at the transport boundary prevents a sparse projection from ever
 * becoming an unfenced write, even if a caller forgets its local preflight.
 */
export function assertFilesMutationContract({ body, idempotencyKey }) {
  if (!String(idempotencyKey || body?.idempotencyKey || "").trim()) {
    throw new FilesApiError(
      "This Files action is missing its retry key. Refresh and try again.",
      { code: "idempotency_key_required" },
    );
  }
  if (!hasExpectedRevision(body)) {
    throw new FilesApiError(
      "This Files action is missing current version information. Refresh and try again.",
      { code: "expected_version_required" },
    );
  }
}

export class FilesApiError extends Error {
  constructor(
    message,
    { status = 0, code = "request_failed", payload = null } = {},
  ) {
    super(message);
    this.name = "FilesApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/**
 * Small authenticated client for the Files v1 resource API. It keeps transport
 * concerns out of the page state machine and preserves server error contracts.
 */
export class FilesApi {
  constructor({ apiBaseUrl = "", getSession }) {
    this.apiBaseUrl = trimTrailingSlash(apiBaseUrl);
    this.getSession = getSession;
  }

  resolve(path) {
    if (/^https?:\/\//iu.test(path)) return path;
    return `${this.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async request(
    path,
    {
      method = "GET",
      body,
      headers = {},
      signal,
      cache,
      idempotencyKey = "",
    } = {},
  ) {
    const session = this.getSession?.();
    const hasBody = body !== undefined;
    const requestHeaders = buildAuthorizedHeaders(
      session,
      hasBody ? { "Content-Type": JSON_CONTENT_TYPE, ...headers } : headers,
    );
    const normalizedMethod = String(method || "GET").toUpperCase();
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(normalizedMethod);
    const stableIdempotencyKey = String(
      idempotencyKey || body?.idempotencyKey || "",
    ).trim();
    if (mutation) {
      assertFilesMutationContract({
        body,
        idempotencyKey: stableIdempotencyKey,
      });
    }
    const response = await fetch(this.resolve(path), {
      method: normalizedMethod,
      headers: !mutation
        ? requestHeaders
        : mutationHeaders(requestHeaders, stableIdempotencyKey),
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
      ...(cache ? { cache } : {}),
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes(JSON_CONTENT_TYPE)
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    if (!response.ok || payload?.ok === false) {
      throw new FilesApiError(
        payload?.message ||
          payload?.error ||
          `Files request failed (${response.status}).`,
        {
          status: response.status,
          code: payload?.error || payload?.code || "request_failed",
          payload,
        },
      );
    }
    return payload || { ok: true };
  }

  listWorkspaces() {
    return this.request("/api/files/workspaces");
  }

  getWorkspace(principalType, principalId) {
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}`,
    );
  }

  getSetupPresets() {
    return this.request("/api/files/setup-presets");
  }

  initializeWorkspace(principalType, principalId, input, options = {}) {
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/initialize`,
      { method: "POST", body: input, ...options },
    );
  }

  getSettings(principalType, principalId) {
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/settings`,
    );
  }

  updateSettings(principalType, principalId, input, options = {}) {
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/settings`,
      { method: "PUT", body: input, ...options },
    );
  }

  listFolders(principalType, principalId, query = {}) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    });
    const suffix = params.size ? `?${params}` : "";
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/folders${suffix}`,
    );
  }

  createFolder(principalType, principalId, input, options = {}) {
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/folders`,
      { method: "POST", body: input, ...options },
    );
  }

  getFolder(folderId) {
    return this.request(`/api/files/folders/${encodeSegment(folderId)}`);
  }

  updateFolder(folderId, input, options = {}) {
    return this.request(`/api/files/folders/${encodeSegment(folderId)}`, {
      method: "PATCH",
      body: input,
      ...options,
    });
  }

  archiveFolder(folderId, input, options = {}) {
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/archive`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  getFolderCollection(folderId, collection, query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/${collection}${params.size ? `?${params}` : ""}`,
    );
  }

  listAssets(folderId, query) {
    return this.getFolderCollection(folderId, "assets", query);
  }

  listHistory(folderId, query) {
    return this.getFolderCollection(folderId, "history", query);
  }

  listAccess(folderId, query) {
    return this.getFolderCollection(folderId, "access", query);
  }

  listProposals(folderId, query) {
    return this.getFolderCollection(folderId, "proposals", query);
  }

  createProposal(folderId, input, options = {}) {
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/proposals`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  getProposal(proposalId) {
    return this.request(`/api/files/proposals/${encodeSegment(proposalId)}`);
  }

  reviewProposal(proposalId, input, options = {}) {
    return this.request(
      `/api/files/proposals/${encodeSegment(proposalId)}/approvals`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  resubmitProposal(proposalId, input, options = {}) {
    return this.request(`/api/files/proposals/${encodeSegment(proposalId)}`, {
      method: "PATCH",
      body: input,
      ...options,
    });
  }

  withdrawProposal(proposalId, input = {}, options = {}) {
    return this.request(
      `/api/files/proposals/${encodeSegment(proposalId)}/withdraw`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  listEditions(folderId) {
    return this.getFolderCollection(folderId, "editions");
  }

  createEdition(folderId, input, options = {}) {
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/editions`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  startEdition(folderId, input, options = {}) {
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/editions/start`,
      { method: "POST", body: input, ...options },
    );
  }

  archiveEdition(editionId, input, options = {}) {
    return this.request(
      `/api/files/editions/${encodeSegment(editionId)}/archive`,
      { method: "POST", body: input, ...options },
    );
  }

  restoreEdition(editionId, input, options = {}) {
    return this.request(
      `/api/files/editions/${encodeSegment(editionId)}/restore`,
      { method: "POST", body: input, ...options },
    );
  }

  getEditionMaterialization(materializationId) {
    return this.request(
      `/api/files/edition-materializations/${encodeSegment(materializationId)}`,
      { cache: "no-store" },
    );
  }

  listGrants(folderId) {
    return this.getFolderCollection(folderId, "grants");
  }

  listGrantRequests(query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/grant-requests${params.size ? `?${params}` : ""}`,
    );
  }

  getShareTargets(principalType, principalId, query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/share-targets${params.size ? `?${params}` : ""}`,
    );
  }

  getShareTargetAccessOptions(principalType, principalId, query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/share-targets/${encodeSegment(principalType)}/${encodeSegment(principalId)}/access-options${params.size ? `?${params}` : ""}`,
    );
  }

  createGrant(folderId, input, options = {}) {
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/grants`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  changeGrant(grantId, action, input = {}, options = {}) {
    return this.request(
      `/api/files/grants/${encodeSegment(grantId)}/${encodeSegment(action)}`,
      { method: "POST", body: input, ...options },
    );
  }

  listSuggestions(principalType, principalId, query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/workspaces/${encodeSegment(principalType)}/${encodeSegment(principalId)}/suggestions${params.size ? `?${params}` : ""}`,
    );
  }

  changeSuggestion(suggestionId, action, input = {}, options = {}) {
    return this.request(
      `/api/files/suggestions/${encodeSegment(suggestionId)}/${encodeSegment(action)}`,
      { method: "POST", body: input, ...options },
    );
  }

  createUploadSession(folderId, input, options = {}) {
    return this.request(
      `/api/files/folders/${encodeSegment(folderId)}/upload-sessions`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  getUploadSession(uploadSessionId) {
    return this.request(
      `/api/files/upload-sessions/${encodeSegment(uploadSessionId)}`,
    );
  }

  presignUploadParts(uploadSessionId, input, options = {}) {
    return this.request(
      `/api/files/upload-sessions/${encodeSegment(uploadSessionId)}/parts:presign`,
      { method: "POST", body: input, ...options },
    );
  }

  checkpointUploadParts(uploadSessionId, input, options = {}) {
    return this.request(
      `/api/files/upload-sessions/${encodeSegment(uploadSessionId)}/parts`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  completeUpload(uploadSessionId, input, options = {}) {
    return this.request(
      `/api/files/upload-sessions/${encodeSegment(uploadSessionId)}/complete`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  abortUpload(uploadSessionId, input = {}, options = {}) {
    return this.request(
      `/api/files/upload-sessions/${encodeSegment(uploadSessionId)}/abort`,
      {
        method: "POST",
        body: input,
        ...options,
      },
    );
  }

  finalizeUpload(uploadSessionId, input, options = {}) {
    return this.request(
      `/api/files/upload-sessions/${encodeSegment(uploadSessionId)}/finalize`,
      { method: "POST", body: input, ...options },
    );
  }

  getAssetUsage(assetId) {
    return this.request(`/api/files/assets/${encodeSegment(assetId)}/usage`);
  }

  getAssetPreview(assetId, sourceAssetVersionId = "") {
    const versionPath = sourceAssetVersionId
      ? `/versions/${encodeSegment(sourceAssetVersionId)}`
      : "";
    return this.request(
      `/api/files/assets/${encodeSegment(assetId)}${versionPath}/preview`,
      { cache: "no-store" },
    );
  }

  getAssetDownload(assetId) {
    return this.request(`/api/files/assets/${encodeSegment(assetId)}/download`);
  }

  createPostDraft(input, options = {}) {
    return this.request("/api/files/post-drafts", {
      method: "POST",
      body: input,
      ...options,
    });
  }

  listHostReferences(query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/host-references${params.size ? `?${params}` : ""}`,
    );
  }

  getHostReference(hostReferenceId) {
    return this.request(
      `/api/files/host-references/${encodeSegment(hostReferenceId)}`,
    );
  }

  getHostReferenceFolderPicker(query = {}) {
    const params = new URLSearchParams(query);
    return this.request(
      `/api/files/host-references/folder-picker${params.size ? `?${params}` : ""}`,
    );
  }

  createHostReference(input, options = {}) {
    return this.request("/api/files/host-references", {
      method: "POST",
      body: input,
      ...options,
    });
  }

  updateHostReference(hostReferenceId, input, options = {}) {
    return this.request(
      `/api/files/host-references/${encodeSegment(hostReferenceId)}`,
      { method: "PATCH", body: input, ...options },
    );
  }

  revokeHostReference(hostReferenceId, input, options = {}) {
    return this.request(
      `/api/files/host-references/${encodeSegment(hostReferenceId)}/revoke`,
      { method: "POST", body: input, ...options },
    );
  }
}

/** Uploads one signed object and reports browser-native progress. */
export function uploadSignedObject({
  url,
  method = "PUT",
  headers = {},
  file,
  onProgress,
  signal,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Upload interrupted.", "AbortError"),
      );
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers || {}).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value),
    );
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader("etag") || "" });
      } else {
        reject(
          new FilesApiError(`Upload failed (${xhr.status}).`, {
            status: xhr.status,
          }),
        );
      }
    });
    xhr.addEventListener("error", () =>
      reject(new FilesApiError("Upload connection failed.")),
    );
    xhr.addEventListener("abort", () =>
      reject(new DOMException("Upload cancelled.", "AbortError")),
    );
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
