const { test, expect } = require("@playwright/test");

function workspace({ initialized = true, principal = null } = {}) {
  const workspacePrincipal = principal || {
    type: "organization",
    sourceType: "organization",
    id: "org-1",
    displayName: "Forward Florida",
    orgKind: "independent_organization",
    jurisdiction: { stateCode: "FL" },
  };
  const sourceType = workspacePrincipal.sourceType || workspacePrincipal.type;
  const activeAuthorizationRoot = ["official", "elected_official"].includes(
    sourceType,
  )
    ? "official_office"
    : ["candidate", "campaign", "political_account"].includes(sourceType)
      ? "campaign"
      : "organization";
  const filesWorkspaceId = `files:v1:${workspacePrincipal.type}:${workspacePrincipal.id}`;
  return {
    filesWorkspaceId,
    principal: workspacePrincipal,
    entitlement: "organization_files",
    permissions: [
      "files_view",
      "files_upload",
      "files_propose",
      "files_review",
      "files_manage",
      "files_share",
      "files_automations_manage",
      "files_restricted_approve",
      "files_restricted_download",
    ],
    capabilities: {
      canView: true,
      canUpload: true,
      canPropose: true,
      canReview: true,
      canManage: true,
      canShare: true,
      canManageAutomations: true,
      canApproveRestricted: true,
      canDownloadRestricted: true,
      canCreatePostDraft: true,
    },
    featureFlags: {
      filesEnabled: true,
      uploadsEnabled: true,
      automationsEnabled: true,
      aiSuggestionsEnabled: true,
      postProvenanceEnabled: true,
      hostReferencesEnabled: false,
    },
    settings: {
      version: 1,
      defaultView: "my_files",
      suggestions: {
        contextMatches: true,
        socialPosts: true,
        duplicateMedia: true,
        aiAssistance: false,
      },
      automations: {
        contextSharingPrompts: true,
        newMediaPostPrompts: true,
        usageBadges: true,
      },
      notifications: {
        shares: true,
        proposals: true,
        reviews: true,
        automations: true,
      },
      rolePurposeMappings: {},
      rolePurposeMappingsByRoot: { [activeAuthorizationRoot]: {} },
    },
    activeAuthorizationRoot,
    setup: { initialized, presetKey: initialized ? "independent_org" : null },
    setupByRoot: {
      [activeAuthorizationRoot]: {
        initialized,
        presetKey: initialized ? "independent_org" : null,
      },
    },
    governanceAuthority: {
      roleId: "governance-role",
      revision: 2,
      authorizationRoot: activeAuthorizationRoot,
      actorIsCurrentAuthority: true,
    },
    governanceAuthorityRoleIds: {
      [activeAuthorizationRoot]: "governance-role",
    },
    governanceAuthorityRevisions: { [activeAuthorizationRoot]: 2 },
    revision: initialized ? 9 : 0,
    etag: initialized ? '"workspace-9"' : null,
    roots: [
      {
        folderId: "folder-1",
        entityType: "folder",
        name: "Florida House District 3",
        description: "Current district research",
        itemCount: 2,
        filesWorkspaceId,
        authorizationRoot: activeAuthorizationRoot,
        version: 3,
        etag: '"folder-3"',
      },
      {
        folderId: "folder-2",
        entityType: "folder",
        name: "Field plans",
        description: "Canvass and organizing plans",
        itemCount: 0,
        filesWorkspaceId,
        authorizationRoot: activeAuthorizationRoot,
        version: 4,
        etag: '"folder-4"',
      },
    ],
    views: ["my_files", "shared_with_me", "recent", "needs_review", "archive"],
    pendingCounts: { needsReview: 1, suggestions: 1 },
  };
}

const folder = {
  entityType: "folder",
  folderId: "folder-1",
  name: "Florida House District 3",
  description: "Current district research for connected campaigns.",
  version: 3,
  etag: '"folder-3"',
  filesWorkspaceId: "files:v1:organization:org-1",
  authorizationRoot: "organization",
  currentEditionId: "edition-2026",
  reviewRequired: true,
  restriction: "standard",
  settings: { inheritWorkspace: true },
  context: {
    stateCode: "FL",
    office: "state_house",
    district: "3",
    cycle: "2026",
    boundaryVintage: "2022",
    sensitivity: "standard",
  },
};

const assets = [
  {
    assetId: "asset-1",
    folderId: "folder-1",
    sourceAssetVersionId: "asset-version-1",
    version: 5,
    etag: '"asset-5"',
    name: "Fourth of July crowd.jpg",
    mimeType: "image/jpeg",
    state: "ready",
    size: 412000,
    updatedAt: "2026-07-04T22:00:00Z",
    altText: "Families gathered beneath flags at the district celebration.",
    crop: { x: 0.05, y: 0.1, width: 0.9, height: 0.8 },
    usages: [
      {
        organization: { displayName: "Florida State Party" },
        postId: "post-published",
        status: "published",
        canViewUsage: true,
        canOpenPost: true,
        postPath: "/posts/post-published",
      },
      {
        organization: { displayName: "Hidden Draft Team" },
        postId: "post-draft",
        status: "draft",
        canViewUsage: true,
        canOpenPost: true,
      },
      {
        organization: { displayName: "Missing Status Team" },
        postId: "post-missing-status",
        canViewUsage: true,
        canOpenPost: true,
      },
      {
        organization: { displayName: "Unauthorized Usage Team" },
        postId: "post-unauthorized",
        status: "published",
        canOpenPost: true,
      },
      {
        organization: { displayName: "External Link Team" },
        postId: "post-external",
        status: "published",
        canViewUsage: true,
        canOpenPost: true,
        postUrl: "https://example.invalid/posts/post-external",
      },
    ],
  },
  {
    assetId: "asset-2",
    folderId: "folder-1",
    sourceAssetVersionId: "asset-version-2",
    version: 6,
    etag: '"asset-6"',
    name: "Parade clip.mp4",
    mimeType: "video/mp4",
    state: "ready",
    size: 1_900_000,
    updatedAt: "2026-07-04T22:10:00Z",
  },
];

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

async function seedSession(
  page,
  {
    uploadCheckpoint = false,
    sessionUserId = "user-1",
    checkpointUserId = "user-1",
  } = {},
) {
  await page.addInitScript(
    ({ uploadCheckpoint, sessionUserId, checkpointUserId }) => {
      const claims = btoa(
        JSON.stringify({
          sub: sessionUserId,
          email: "media@example.com",
          name: "Media Manager",
        }),
      );
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: "access.token.value",
          idToken: `header.${claims}.signature`,
          expiresAt: Date.now() + 60 * 60 * 1000,
        }),
      );
      if (uploadCheckpoint) {
        sessionStorage.setItem(
          "polisFilesUploads.v1",
          JSON.stringify({
            version: 1,
            userId: checkpointUserId,
            items: [
              {
                id: "checkpoint-1",
                folderId: "folder-1",
                sessionId: "upload-revoked",
                fileMetadata: {
                  name: "sensitive.pdf",
                  size: 42,
                  type: "application/pdf",
                },
              },
            ],
          }),
        );
      }
    },
    { uploadCheckpoint, sessionUserId, checkpointUserId },
  );
}

async function appendForgedAiSetting(page, formName) {
  await page.locator(`form[data-form="${formName}"]`).evaluate((form) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "aiSuggestionsEnabled";
    input.value = "true";
    form.append(input);
  });
}

async function mockFiles(page, overrides = {}) {
  const currentWorkspace = overrides.workspace || workspace();
  const discoveredWorkspaces = overrides.workspaces || [currentWorkspace];
  const sourceType =
    currentWorkspace.principal.sourceType || currentWorkspace.principal.type;
  const sourceId =
    sourceType === "official"
      ? currentWorkspace.principal.sourceId
      : currentWorkspace.principal.id;
  const activeFolder = {
    ...folder,
    filesWorkspaceId: currentWorkspace.filesWorkspaceId,
    authorizationRoot: currentWorkspace.activeAuthorizationRoot,
    ...(overrides.folder || {}),
  };
  const folderAccess = overrides.folderAccess || {
    shared: false,
    permissions: currentWorkspace.permissions,
    capabilities: currentWorkspace.capabilities,
    grantId: null,
    accessTier: "owner",
    currentMainOnly: false,
  };
  let uploadStatusIndex = 0;
  let uploadAbortAttempts = 0;
  let uploadIntent = "commit";
  let uploadProposal = null;
  let editionMaterialization = currentWorkspace.activeMaterialization
    ? { ...currentWorkspace.activeMaterialization }
    : null;
  let editionMaterializationStatusIndex = 0;
  let activeEditionId = activeFolder.currentEditionId;
  const editionItems = overrides.editions || [
    {
      id: "edition-2026",
      name: "2026 cycle",
      version: 7,
      etag: '"edition-7"',
    },
    {
      id: "edition-2024",
      name: "2024 cycle",
      version: 4,
      etag: '"edition-4"',
    },
  ];
  let hostReferenceItems = [...(overrides.hostReferenceItems || [])];
  const signedUploadAttempts = new Map();
  const captures = {
    grants: [],
    proposals: [],
    proposalCreates: [],
    proposalResubmissions: [],
    proposalWithdrawals: [],
    posts: [],
    uploads: [],
    uploadPartHeaders: [],
    signedUploadParts: [],
    uploadAborts: [],
    settings: [],
    settingsRequests: [],
    suggestions: [],
    folders: [],
    folderCreates: [],
    archives: [],
    editions: [],
    editionArchives: [],
    editionRestores: [],
    editionMaterializationPolls: [],
    grantRequests: [],
    initializations: [],
    initializationRequests: [],
    previews: [],
    hostReferences: [],
    requests: [],
  };
  await page.route("**/signed-preview/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/signed-upload/**", async (route) => {
    const partNumber = Number(
      new URL(route.request().url()).pathname.split("-").at(-1),
    );
    const attempt = (signedUploadAttempts.get(partNumber) || 0) + 1;
    signedUploadAttempts.set(partNumber, attempt);
    captures.uploadPartHeaders.push(route.request().headers());
    captures.signedUploadParts.push({ partNumber, attempt });
    if (overrides.onSignedUpload) {
      const handled = await overrides.onSignedUpload({
        route,
        partNumber,
        attempt,
        captures,
      });
      if (handled) return;
    }
    return route.fulfill({
      status: 200,
      headers: { etag: `"part-etag-${partNumber}"` },
      body: "",
    });
  });
  await page.route("**/api/files/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postDataJSON?.() || {};
    const idempotencyKey = request.headers()["idempotency-key"] || "";
    captures.requests.push({
      path,
      method,
      body,
      idempotencyKey,
      ifMatch: request.headers()["if-match"] || "",
    });
    if (overrides.onRequest) {
      const handled = await overrides.onRequest({
        route,
        request,
        url,
        path,
        method,
        body,
        captures,
      });
      if (handled) return;
    }
    if (path === "/api/files/workspaces" && method === "GET") {
      return json(route, { ok: true, workspaces: discoveredWorkspaces });
    }
    if (path === "/api/files/setup-presets") {
      return json(route, {
        ok: true,
        presets: [
          {
            presetKey: "independent_org",
            name: "Independent organization",
            description:
              "District intelligence with review-gated collaboration.",
            folders: [
              { name: "District intelligence" },
              { name: "Campaign media" },
            ],
          },
        ],
      });
    }
    if (
      path ===
        `/api/files/workspaces/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}` &&
      method === "GET"
    ) {
      return json(route, { ok: true, workspace: currentWorkspace });
    }
    if (path.endsWith("/initialize") && method === "POST") {
      captures.initializations.push(body);
      captures.initializationRequests.push({
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      if (
        overrides.staleInitializeOnce &&
        captures.initializationRequests.length === 1
      ) {
        currentWorkspace.revision = 10;
        currentWorkspace.etag = '"workspace-10"';
        return json(
          route,
          {
            ok: false,
            error: "files_version_conflict",
            message: "Workspace changed",
          },
          409,
        );
      }
      currentWorkspace.setup = { initialized: true, presetKey: body.presetKey };
      currentWorkspace.setupByRoot = {
        ...(currentWorkspace.setupByRoot || {}),
        [currentWorkspace.activeAuthorizationRoot]: currentWorkspace.setup,
      };
      return json(route, { ok: true, workspace: currentWorkspace });
    }
    if (path.endsWith("/settings") && method === "PUT") {
      captures.settings.push(body);
      captures.settingsRequests.push({
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      return json(route, { ok: true, settings: body.settings });
    }
    if (
      path === "/api/files/host-references/folder-picker" &&
      method === "GET"
    ) {
      return json(route, {
        items: overrides.hostPickerItems || [
          {
            folderId: "folder-1",
            name: "Florida House District 3",
            breadcrumb: "District research / Florida House 3",
            filesWorkspaceId: currentWorkspace.filesWorkspaceId,
            principal: currentWorkspace.principal,
            authorizationRoot: currentWorkspace.activeAuthorizationRoot,
            context: activeFolder.context,
            restriction: "standard",
            version: 3,
            etag: '"folder-3"',
            capabilities: {
              canView: true,
              canLinkHostReference: true,
            },
            allowedRelationKeys: ["supporting_material"],
            allowedPurposeKeys: ["research"],
          },
        ],
        referenceOptions: overrides.hostReferenceOptions || {
          scope: "folder",
          referenceType: url.searchParams.get("referenceType"),
          relations: [
            {
              relationType: "supporting_material",
              label: "Supporting material",
            },
          ],
          purposes: [{ purposeKey: "research", label: "Research" }],
        },
        nextCursor: null,
      });
    }
    if (path === "/api/files/host-references" && method === "GET") {
      return json(route, { items: hostReferenceItems, nextCursor: null });
    }
    const hostReferenceDetailMatch = path.match(
      /^\/api\/files\/host-references\/([^/]+)$/u,
    );
    if (hostReferenceDetailMatch && method === "GET") {
      const hostReferenceId = decodeURIComponent(hostReferenceDetailMatch[1]);
      const envelope = hostReferenceItems.find(
        (item) => item.hostReference?.hostReferenceId === hostReferenceId,
      );
      return envelope
        ? json(route, envelope)
        : json(route, { ok: false, error: "host_reference_not_found" }, 404);
    }
    if (path === "/api/files/host-references" && method === "POST") {
      captures.hostReferences.push({
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      const envelope = {
        hostReference: {
          hostReferenceId: "host-reference-1",
          ...body,
          status: "active",
          version: 1,
          deepLink: {
            route: "/files/references/host-reference-1",
            params: { hostReferenceId: "host-reference-1" },
          },
        },
        revision: 1,
        etag: '"host-reference-1"',
      };
      hostReferenceItems = [envelope, ...hostReferenceItems];
      return json(route, envelope);
    }
    if (
      /^\/api\/files\/host-references\/[^/]+\/revoke$/u.test(path) &&
      method === "POST"
    ) {
      captures.hostReferences.push({
        path,
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      const hostReferenceId = decodeURIComponent(path.split("/")[4]);
      const current = hostReferenceItems.find(
        (item) => item.hostReference?.hostReferenceId === hostReferenceId,
      );
      const envelope = {
        hostReference: {
          ...(current?.hostReference || {}),
          hostReferenceId,
          status: "revoked",
          version: Number(current?.revision || 1) + 1,
        },
        revision: Number(current?.revision || 1) + 1,
        etag: `"${hostReferenceId}-revoked"`,
      };
      hostReferenceItems = hostReferenceItems.map((item) =>
        item.hostReference?.hostReferenceId === hostReferenceId
          ? envelope
          : item,
      );
      return json(route, envelope);
    }
    if (path.endsWith("/share-targets") && method === "GET") {
      return json(route, {
        ok: true,
        targets: [
          {
            principal: {
              type: "organization",
              id: "party-1",
              displayName: "Florida State Party",
            },
            relationship: {
              relationshipId: "rel-1",
              type: "connected",
              status: "active",
            },
            canShareStandard: true,
            canShareRestricted: true,
          },
        ],
      });
    }
    if (
      path === "/api/files/share-targets/organization/party-1/access-options"
    ) {
      expect(url.searchParams.get("folderId")).toBe("folder-1");
      return json(route, {
        ok: true,
        targetPrincipal: {
          type: "organization",
          id: "party-1",
          displayName: "Florida State Party",
        },
        rolePurposeMappings: [{ roleId: "media-team", purposeKeys: ["media"] }],
        roles: [
          {
            roleId: "media-team",
            label: "Media team",
            category: "media",
            purposeKeys: ["media"],
            memberCount: 4,
            eligibleForStandard: true,
            eligibleForRestricted: false,
          },
        ],
        members: [
          {
            userId: "member-1",
            displayName: "Alex Rivera",
            status: "active",
            eligibleForStandard: true,
            eligibleForRestricted: true,
          },
        ],
      });
    }
    if (path.endsWith("/folders") && method === "GET") {
      return json(route, { ok: true, items: [currentWorkspace.roots[0]] });
    }
    if (path.endsWith("/folders") && method === "POST") {
      captures.folderCreates.push({
        path,
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      if (
        overrides.staleFolderCreateOnce &&
        captures.folderCreates.length === 1
      ) {
        currentWorkspace.revision = 10;
        currentWorkspace.etag = '"workspace-10"';
        return json(
          route,
          {
            ok: false,
            error: "files_version_conflict",
            message: "Workspace changed",
          },
          409,
        );
      }
      return json(route, {
        ok: true,
        folder: {
          folderId: "folder-new",
          entityType: "folder",
          filesWorkspaceId: currentWorkspace.filesWorkspaceId,
          authorizationRoot: currentWorkspace.activeAuthorizationRoot,
          version: 1,
          etag: '"folder-new-1"',
          ...body,
        },
      });
    }
    if (path === "/api/files/grant-requests" && method === "GET") {
      if (overrides.grantRequestsForbidden) {
        return json(
          route,
          { ok: false, error: "grant_recipient_membership_required" },
          403,
        );
      }
      return json(route, {
        ok: true,
        grantRequests: overrides.grantRequests || [],
        nextCursor: null,
      });
    }
    if (path.endsWith("/suggestions") && method === "GET") {
      return json(route, {
        ok: true,
        suggestions: overrides.suggestions || [
          {
            id: "suggestion-1",
            type: "event_media",
            engine: "rules",
            version: 4,
            title: "Fourth of July media is ready",
            reason: "The event date and folder metadata match July 4.",
            confidence: 0.98,
            context: { district: "FL House 3", election: "2026" },
            recommendation: {
              caption: "Celebrate the Fourth with families across FL03.",
              assetIds: ["asset-1", "asset-2"],
              scheduledFor: null,
            },
          },
        ],
      });
    }
    if (
      /^\/api\/files\/suggestions\/suggestion-1\/(accept|edit|dismiss|snooze|disable)$/u.test(
        path,
      ) &&
      method === "POST"
    ) {
      captures.suggestions.push({ path, body, idempotencyKey });
      const action = path.split("/").at(-1);
      return json(route, {
        ok: true,
        suggestion: {
          id: "suggestion-1",
          status: action,
          ...(overrides.suggestionDecision || {}),
        },
        ...(action === "disable"
          ? { folder: { ...folder, settings: { inheritWorkspace: false } } }
          : {}),
      });
    }
    if (path === "/api/files/folders/folder-1" && method === "GET") {
      return json(route, {
        ok: true,
        folder: { ...activeFolder, currentEditionId: activeEditionId },
        access: folderAccess,
        version: activeFolder.version,
        etag: activeFolder.etag,
      });
    }
    if (path === "/api/files/folders/folder-2" && method === "GET") {
      return json(route, {
        ok: true,
        folder: currentWorkspace.roots[1],
        version: currentWorkspace.roots[1].version,
        etag: currentWorkspace.roots[1].etag,
      });
    }
    if (path === "/api/files/folders/folder-1" && method === "PATCH") {
      captures.folders.push(body);
      return json(route, { ok: true, folder: { ...activeFolder, ...body } });
    }
    if (path === "/api/files/folders/folder-1/archive" && method === "POST") {
      captures.archives.push({ path, body, idempotencyKey });
      return json(route, {
        ok: true,
        folder: { ...activeFolder, status: "archived", version: 4 },
      });
    }
    if (path.endsWith("/assets") && method === "GET") {
      return json(route, { ok: true, assets: overrides.assets || assets });
    }
    const previewMatch = path.match(
      /^\/api\/files\/assets\/([^/]+)\/versions\/([^/]+)\/preview$/u,
    );
    if (previewMatch && method === "GET") {
      const assetId = decodeURIComponent(previewMatch[1]);
      const revisionId = decodeURIComponent(previewMatch[2]);
      captures.previews.push({
        assetId,
        revisionId,
        headers: request.headers(),
      });
      if (
        overrides.previewForbiddenAfter !== undefined &&
        captures.previews.length > overrides.previewForbiddenAfter
      ) {
        return json(route, { ok: false, error: "files_access_denied" }, 403, {
          "Cache-Control": "private, no-store, max-age=0",
        });
      }
      return json(
        route,
        {
          assetId,
          revisionId,
          url: `${url.origin}/signed-preview/${encodeURIComponent(assetId)}/${encodeURIComponent(revisionId)}.png?signature=short-lived`,
          expiresInSeconds: overrides.previewExpiresInSeconds || 300,
          cachePolicy: "no-store",
          offlineAvailable: false,
          watermarked: assetId === "asset-1",
          contentType: "image/png",
        },
        200,
        { "Cache-Control": "private, no-store, max-age=0" },
      );
    }
    if (path.endsWith("/editions") && method === "GET") {
      return json(route, {
        ok: true,
        editions: editionItems.map((edition) => ({
          ...edition,
          status: edition.id === activeEditionId ? "current" : "archived",
          isCurrent: edition.id === activeEditionId,
        })),
      });
    }
    if (
      path === "/api/files/folders/folder-1/editions/start" &&
      method === "POST"
    ) {
      captures.editions.push({ path, body, idempotencyKey });
      return json(route, {
        ok: true,
        edition: { editionId: "edition-new", state: "current", ...body },
      });
    }
    if (path.endsWith("/editions") && method === "POST") {
      captures.editions.push({ path, body, idempotencyKey });
      return json(route, {
        ok: true,
        edition: { editionId: "edition-new", state: "draft", ...body },
      });
    }
    if (
      path === "/api/files/editions/edition-2026/archive" &&
      method === "POST"
    ) {
      captures.editionArchives.push({
        path,
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      editionMaterializationStatusIndex = 0;
      editionMaterialization = {
        materializationId: "materialization-archive",
        mode: "archive",
        status: "pending",
        progress: {
          phase: "pending",
          sourceAssetCount: 0,
          projectionItemCount: 0,
          affectedFolderCount: 0,
          complete: false,
        },
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:00:00.000Z",
        version: 1,
      };
      currentWorkspace.activeMaterialization = editionMaterialization;
      return json(
        route,
        {
          ok: true,
          accepted: true,
          materialization: editionMaterialization,
          edition: { editionId: "edition-2026", state: "active", version: 7 },
          folder: { ...activeFolder, currentEditionId: activeEditionId },
          dispatchPending: false,
          revision: 1,
          etag: '"materialization-1"',
        },
        202,
      );
    }
    if (
      path === "/api/files/editions/edition-2024/restore" &&
      method === "POST"
    ) {
      captures.editionRestores.push({
        path,
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      editionMaterializationStatusIndex = 0;
      editionMaterialization = {
        materializationId: "materialization-restore",
        mode: "restore",
        status: "pending",
        progress: {
          phase: "pending",
          sourceAssetCount: 2,
          projectionItemCount: 0,
          affectedFolderCount: 1,
          complete: false,
        },
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:00:00.000Z",
        version: 1,
      };
      currentWorkspace.activeMaterialization = editionMaterialization;
      return json(
        route,
        {
          ok: true,
          accepted: true,
          materialization: editionMaterialization,
          edition: { editionId: "edition-2024", state: "archived", version: 4 },
          folder: { ...activeFolder, currentEditionId: activeEditionId },
          dispatchPending: false,
          revision: 1,
          etag: '"materialization-1"',
        },
        202,
      );
    }
    const materializationMatch = path.match(
      /^\/api\/files\/edition-materializations\/([^/]+)$/u,
    );
    if (materializationMatch && method === "GET" && editionMaterialization) {
      captures.editionMaterializationPolls.push(path);
      const statuses = overrides.editionMaterializationStatuses || ["complete"];
      const status =
        statuses[
          Math.min(editionMaterializationStatusIndex, statuses.length - 1)
        ];
      editionMaterializationStatusIndex += 1;
      editionMaterialization = {
        ...editionMaterialization,
        status,
        progress: {
          ...editionMaterialization.progress,
          phase: status,
          projectionItemCount: status === "complete" ? 2 : 1,
          complete: status === "complete",
        },
        ...(status === "failed"
          ? { failureCode: "edition_source_unavailable" }
          : {}),
        version: editionMaterialization.version + 1,
        updatedAt: "2026-08-17T12:00:01.000Z",
      };
      currentWorkspace.activeMaterialization = editionMaterialization;
      if (status === "complete") {
        activeEditionId =
          editionMaterialization.mode === "restore" ? "edition-2024" : "";
        currentWorkspace.activeMaterialization = null;
      }
      return json(route, {
        ok: true,
        materialization: editionMaterialization,
        revision: editionMaterialization.version,
        etag: `"materialization-${editionMaterialization.version}"`,
      });
    }
    if (path.endsWith("/proposals") && method === "GET") {
      return json(route, {
        ok: true,
        proposals: overrides.proposals || [
          {
            proposalId: "proposal-1",
            title: "Replace precinct contact sheet",
            summary: "Use the certified 2026 contacts.",
            status: "pending_review",
            version: 2,
            etag: '"proposal-2"',
            createdBy: { displayName: "Jamie Lee" },
          },
        ],
      });
    }
    if (path.endsWith("/proposals") && method === "POST") {
      captures.proposalCreates.push(body);
      return json(route, {
        ok: true,
        proposal: { proposalId: "proposal-new", status: "pending_review" },
      });
    }
    if (
      path === "/api/files/proposals/proposal-1/approvals" &&
      method === "POST"
    ) {
      captures.proposals.push(body);
      return json(route, {
        ok: true,
        proposal: { proposalId: "proposal-1", status: body.decision },
      });
    }
    if (path === "/api/files/proposals/proposal-1" && method === "PATCH") {
      captures.proposalResubmissions.push({
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      return json(route, {
        ok: true,
        proposal: {
          proposalId: "proposal-1",
          status: "pending_review",
          version: Number(body.expectedVersion) + 1,
          ...body,
        },
      });
    }
    if (
      path === "/api/files/proposals/proposal-1/withdraw" &&
      method === "POST"
    ) {
      captures.proposalWithdrawals.push({
        body,
        idempotencyKey,
        ifMatch: request.headers()["if-match"] || "",
      });
      return json(route, {
        ok: true,
        proposal: {
          proposalId: "proposal-1",
          status: "withdrawn",
          version: Number(body.expectedVersion) + 1,
        },
      });
    }
    if (path.endsWith("/grants") && method === "GET") {
      return json(route, {
        ok: true,
        grants: [
          {
            grantId: "grant-pending",
            recipientPrincipal: { displayName: "Florida State Party" },
            recipientUserIds: ["member-1"],
            capabilities: ["files_view"],
            restriction: "restricted",
            status: "pending_authority",
            grantRequestRevision: 4,
            approvals: [
              { approvalType: "maintainer", reviewerUserId: "maintainer-1" },
            ],
            recipientAcceptance: null,
            expiresAt: "2026-12-31T00:00:00Z",
          },
        ],
      });
    }
    if (path.endsWith("/grants") && method === "POST") {
      captures.grants.push(body);
      return json(route, {
        ok: true,
        grant: { grantId: "grant-new", ...body },
      });
    }
    if (
      /^\/api\/files\/grants\/[^/]+\/(accept|decline)$/u.test(path) &&
      method === "POST"
    ) {
      captures.grantRequests.push({ path, body, idempotencyKey });
      return json(route, {
        ok: true,
        grant: {
          grantId: path.split("/")[4],
          folderId: "folder-1",
          status: path.endsWith("/accept") ? "active" : "declined",
        },
      });
    }
    if (path === "/api/files/post-drafts" && method === "POST") {
      captures.posts.push(body);
      return json(route, { ok: true, draftId: "draft-1" });
    }
    if (path.endsWith("/upload-sessions") && method === "POST") {
      uploadIntent = body.intent || "commit";
      uploadProposal = body.proposal || null;
      captures.uploads.push({ step: "initiate", body, idempotencyKey });
      return json(route, {
        ok: true,
        uploadSession: {
          uploadSessionId: "upload-1",
          assetId: "asset-upload-1",
          revisionId: "asset-upload-version-1",
          intent: uploadIntent,
          proposal:
            uploadIntent === "proposal"
              ? { ...uploadProposal, proposalId: "proposal-upload-1" }
              : null,
          state: "uploading",
          partSize: overrides.uploadPartSize || 5 * 1024 * 1024,
          totalParts: overrides.uploadTotalParts || 1,
          uploadedParts: [],
          version: 1,
        },
        upload: { maxPresignParts: 10, partUrlExpiresInSeconds: 900 },
      });
    }
    if (path === "/api/files/upload-sessions/upload-1/parts:presign") {
      captures.uploads.push({ step: "presign", body, idempotencyKey });
      return json(route, {
        ok: true,
        parts: body.parts.map((part) => ({
          partNumber: part.partNumber,
          url: `${url.origin}/signed-upload/part-${part.partNumber}`,
          requiredHeaders: {
            "x-amz-checksum-sha256": part.checksumSha256,
          },
        })),
      });
    }
    if (path === "/api/files/upload-sessions/upload-1/parts") {
      captures.uploads.push({ step: "checkpoint", body, idempotencyKey });
      return json(route, { ok: true, uploadSession: { version: 2 } });
    }
    if (path === "/api/files/upload-sessions/upload-1/complete") {
      captures.uploads.push({ step: "complete", body, idempotencyKey });
      return json(route, { ok: true, state: "scanning" }, 202);
    }
    if (
      path === "/api/files/upload-sessions/upload-1/abort" &&
      method === "POST"
    ) {
      captures.uploadAborts.push({ body, idempotencyKey });
      uploadAbortAttempts += 1;
      if (uploadAbortAttempts <= Number(overrides.uploadAbortFailures || 0)) {
        return json(
          route,
          {
            ok: false,
            error: "abort_unavailable",
            message: "Upload cancellation is temporarily unavailable.",
          },
          503,
        );
      }
      return json(route, { ok: true, state: "aborted" });
    }
    if (path === "/api/files/upload-sessions/upload-1" && method === "GET") {
      const statuses = overrides.uploadStatuses || [{ state: "scanning" }];
      const status = statuses[Math.min(uploadStatusIndex, statuses.length - 1)];
      uploadStatusIndex += 1;
      return json(route, {
        ok: true,
        uploadSession: {
          uploadSessionId: "upload-1",
          assetId: "asset-upload-1",
          revisionId: "asset-upload-version-1",
          intent: status.intent || uploadIntent,
          proposal:
            (status.intent || uploadIntent) === "proposal"
              ? { ...uploadProposal, proposalId: "proposal-upload-1" }
              : null,
          version: 3 + uploadStatusIndex,
          progress: 1,
          ...status,
        },
      });
    }
    return json(
      route,
      { ok: false, error: "unmocked", message: `${method} ${path}` },
      500,
    );
  });
  return captures;
}

test("Files home is entitled, contextual, responsive, and supports list/grid", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page);
  await page.goto("/files");
  await expect(
    page.getByRole("heading", {
      name: "Everything your team needs—without hunting for it.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Florida House District 3/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("Rule-based media prompt")).toBeVisible();
  await expect(page.getByText("Optional AI assistance")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Snooze" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Disable these" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit before accepting" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Suggested caption or instructions"),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Edit before accepting" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).click();
  await page
    .getByLabel("Suggested caption or instructions")
    .fill("A community Fourth of July celebration across FL03.");
  await page
    .getByRole("button", { name: "Accept edited recommendation" })
    .click();
  expect(captures.suggestions[0]).toEqual({
    path: "/api/files/suggestions/suggestion-1/edit",
    body: {
      expectedVersion: 4,
      recommendation: {
        caption: "A community Fourth of July celebration across FL03.",
        assetIds: ["asset-1", "asset-2"],
        scheduledFor: null,
      },
    },
    idempotencyKey: expect.any(String),
  });

  await page.reload();
  await page.getByRole("button", { name: "Snooze" }).click();
  expect(captures.suggestions[1]).toEqual({
    path: "/api/files/suggestions/suggestion-1/snooze",
    body: {
      expectedVersion: 4,
      snoozedUntil: expect.any(String),
    },
    idempotencyKey: expect.any(String),
  });

  await page.reload();
  await page.getByRole("button", { name: "Disable these" }).click();
  expect(captures.suggestions[2]).toEqual({
    path: "/api/files/suggestions/suggestion-1/disable",
    body: { expectedVersion: 4, scope: "folder" },
    idempotencyKey: expect.any(String),
  });
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.locator(".files-items--grid")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".files-mobile-nav")).toBeVisible();
  await expect(page.locator(".files-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Recent", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "Recent", exact: true }),
  ).toBeFocused();
});

test("accepting a contextual share prompt opens existing access review without granting", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    suggestions: [
      {
        suggestionId: "suggestion-1",
        suggestionType: "contextual_folder_share",
        action: "prompt_share",
        version: 4,
        title: "Share Campaign Media with Florida State Party",
        reason: "The campaign connection and media purpose are an exact match.",
        confidence: 1,
      },
    ],
    suggestionDecision: {
      suggestionId: "suggestion-1",
      folderId: "folder-1",
    },
  });

  await page.goto("/files/recommended");
  await page.getByRole("button", { name: "Review & share" }).click();

  await expect(page).toHaveURL(/\/files\/folders\/folder-1\?tab=access$/u);
  await expect(
    page.getByRole("heading", { name: "Who has access" }),
  ).toBeVisible();
  expect(captures.suggestions).toEqual([
    expect.objectContaining({
      path: "/api/files/suggestions/suggestion-1/accept",
      body: { expectedVersion: 4 },
    }),
  ]);
  expect(captures.grants).toEqual([]);
});

test("canonical media prompt reviews Current without creating a grant or post draft", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    suggestions: [
      {
        suggestionId: "suggestion-1",
        suggestionType: "event_recap",
        recommendedAction: "create_post_draft",
        folderId: "folder-1",
        version: 4,
        title: "Create a Fourth of July recap post",
        summary: "Review the event media and prepare an editable Polis post.",
      },
    ],
    suggestionDecision: {
      suggestionId: "suggestion-1",
      folderId: "folder-1",
    },
  });

  await page.goto("/files/recommended");
  await expect(page.getByText("Rule-based media prompt")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Create a Fourth of July recap post",
      level: 3,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Review the event media and prepare an editable Polis post.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Review & share" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Review media" }).click();

  await expect(page).toHaveURL(/\/files\/folders\/folder-1\?tab=current$/u);
  await expect(
    page.getByRole("button", { name: "Current", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(captures.suggestions).toEqual([
    expect.objectContaining({
      path: "/api/files/suggestions/suggestion-1/accept",
      body: { expectedVersion: 4 },
    }),
  ]);
  expect(captures.grants).toEqual([]);
  expect(captures.grantRequests).toEqual([]);
  expect(captures.posts).toEqual([]);
  expect(
    captures.requests.filter(
      ({ method, path }) =>
        method === "POST" &&
        (path.includes("/grants") || path === "/api/files/post-drafts"),
    ),
  ).toEqual([]);
});

test("proposal review, restricted named sharing, provenance, and ordered post draft use canonical contracts", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page);
  await page.goto("/files/folders/folder-1");
  await expect(
    page.getByRole("heading", { name: "Florida House District 3", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("Florida State Party used this")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Florida State Party used this" }),
  ).toHaveAttribute("href", "/posts/post-published");
  await expect(page.getByText("Hidden Draft Team used this")).toHaveCount(0);
  await expect(page.getByText("Missing Status Team used this")).toHaveCount(0);
  await expect(page.getByText("Unauthorized Usage Team used this")).toHaveCount(
    0,
  );
  await expect(page.getByText("External Link Team used this")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "External Link Team used this" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start a new edition" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Archive folder" }).first(),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Start a new edition" })
    .first()
    .click();
  await page.getByLabel("Edition label").fill("2028 district cycle");
  await page.getByLabel("Edition type").selectOption("election_cycle");
  await page.getByLabel("Effective year").fill("2028");
  await page.getByLabel("Election cycle").fill("2028");
  await page.getByLabel("Boundary vintage").fill("2024");
  await page.getByLabel("Effective from").fill("2027-11-03");
  await page.getByLabel("Effective through").fill("2028-11-07");
  await page.getByRole("button", { name: "Start new current edition" }).click();
  expect(captures.editions[0]).toEqual({
    path: "/api/files/folders/folder-1/editions/start",
    body: {
      label: "2028 district cycle",
      type: "election_cycle",
      effectiveYear: 2028,
      cycle: 2028,
      boundaryVintage: "2024",
      effectiveFrom: "2027-11-03",
      effectiveTo: "2028-11-07",
      archiveCurrent: true,
      expectedVersion: 3,
      expectedCurrentEditionVersion: 7,
    },
    idempotencyKey: expect.any(String),
  });

  await page.getByRole("button", { name: "Archive current version" }).click();
  await expect(
    page.getByRole("heading", { name: "Archive current version?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Archive current version" })
    .last()
    .click();
  expect(captures.editionArchives[0]).toEqual({
    path: "/api/files/editions/edition-2026/archive",
    body: { expectedVersion: 7, expectedFolderVersion: 3 },
    idempotencyKey: expect.any(String),
    ifMatch: '"edition-7"',
  });
  await expect(
    page.getByText("Current version archived and preserved in history."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Select all media" }).click();
  await expect(page.getByRole("button", { name: /Create post/ })).toContainText(
    "2",
  );
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page
    .getByRole("button", { name: "Select Fourth of July crowd.jpg" })
    .focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Select Parade clip.mp4" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Create post/ }).click();
  await expect(page.getByText("Files → Polis post · 2/10")).toBeVisible();
  await page
    .getByRole("button", { name: "Move Parade clip.mp4 earlier" })
    .click();
  await page
    .getByLabel("Post idea or caption")
    .fill("A joyful Fourth of July in House District 3.");
  await page.getByRole("button", { name: "Create post draft" }).click();
  expect(captures.posts).toHaveLength(1);
  expect(captures.posts[0].mediaItems).toEqual([
    expect.objectContaining({
      assetId: "asset-2",
      sourceAssetVersionId: "asset-version-2",
      mediaType: "video",
      altText: "",
      order: 0,
    }),
    expect.objectContaining({
      assetId: "asset-1",
      sourceAssetVersionId: "asset-version-1",
      mediaType: "image",
      altText: "Families gathered beneath flags at the district celebration.",
      crop: { x: 0.05, y: 0.1, width: 0.9, height: 0.8 },
      order: 1,
    }),
  ]);
  expect(captures.posts[0].mediaItems[0]).not.toHaveProperty("revisionId");
  expect(captures.posts[0].mediaItems[1]).not.toHaveProperty("revisionId");
  expect(captures.posts[0]).toEqual(
    expect.objectContaining({
      expectedFolderVersion: 3,
      expectedAssetVersions: { "asset-2": 6, "asset-1": 5 },
    }),
  );

  await page.getByRole("button", { name: "Proposed changes" }).click();
  await page.getByRole("button", { name: "Approve & merge" }).click();
  await page.getByLabel(/Review note/).fill("Certified contacts verified.");
  await page.getByRole("button", { name: "Approve & merge" }).last().click();
  expect(captures.proposals[0]).toEqual(
    expect.objectContaining({
      decision: "approve",
      expectedVersion: 2,
      expectedFolderVersion: 3,
    }),
  );
  await page.getByRole("button", { name: "Request changes" }).click();
  await page
    .getByLabel(/Review note/)
    .fill("Please attach the certification source.");
  await page.getByRole("button", { name: "Send change request" }).click();
  expect(captures.proposals[1]).toEqual(
    expect.objectContaining({
      decision: "request_changes",
      expectedVersion: 2,
      expectedFolderVersion: 3,
    }),
  );

  await page.getByRole("button", { name: "Suggest change" }).click();
  await expect(page.getByLabel("Change type").locator("option")).toHaveText([
    "Add an asset",
    "Replace an asset",
    "Rename an asset",
    "Move an asset",
    "Update metadata",
    "Delete an asset",
  ]);
  await page.getByLabel("Change type").selectOption("rename");
  await page.getByLabel("Short title").fill("Clarify event photo name");
  await page
    .getByLabel("Explain the change")
    .fill("Use an accessible, descriptive file name.");
  await page.getByLabel("Current asset").selectOption("asset-1");
  await page.getByLabel("New file name").fill("FL03 July 4 families.jpg");
  await page.getByRole("button", { name: "Submit for review" }).click();
  expect(captures.proposalCreates[0]).toEqual({
    title: "Clarify event photo name",
    description: "Use an accessible, descriptive file name.",
    operations: [
      {
        type: "rename",
        assetId: "asset-1",
        name: "FL03 July 4 families.jpg",
      },
    ],
    expectedVersion: 3,
  });

  await page.getByRole("button", { name: "Access & automations" }).click();
  await expect(page.getByText("Governance authority")).toBeVisible();
  await expect(page.getByText("Recipient acceptance")).toBeVisible();
  await page.getByRole("button", { name: "Share access" }).click();
  await page
    .getByLabel("Connected organization or campaign")
    .last()
    .selectOption("organization:party-1");
  await expect(
    page.locator('select[name="roleId"] option[value="media-team"]'),
  ).toHaveText("Media team · 4 members");
  await page.getByText("Restricted", { exact: true }).click();
  await page
    .locator('select[name="recipientUserIds"]')
    .selectOption("member-1");
  await page
    .getByLabel("Required purpose")
    .fill("Candidate briefing for active FL House 3 field planning.");
  await page.getByLabel("Required expiry").fill("2026-12-20");
  await page.getByRole("button", { name: "Request restricted access" }).click();
  expect(captures.grants[0]).toEqual(
    expect.objectContaining({
      restriction: "restricted",
      recipientPrincipal: { type: "organization", id: "party-1" },
      relationshipId: "rel-1",
      accessTier: "contribute",
      audiencePurposeKey: "media",
      recipientRoleIds: [],
      recipientUserIds: ["member-1"],
      allowDownload: false,
      expectedVersion: 3,
    }),
  );

  await page.getByRole("button", { name: "Archive folder" }).click();
  await page
    .getByLabel("Archive note")
    .fill("The 2026 district research has moved into its preserved edition.");
  await page.getByRole("button", { name: "Archive folder" }).last().click();
  expect(captures.archives[0]).toEqual({
    path: "/api/files/folders/folder-1/archive",
    body: {
      reason:
        "The 2026 district research has moved into its preserved edition.",
      expectedVersion: 3,
    },
    idempotencyKey: expect.any(String),
  });
});

test("archived editions restore their contents through the bounded async materialization contract", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    editionMaterializationStatuses: ["applying", "consolidating", "complete"],
  });
  await page.goto("/files/folders/folder-1");
  await page.getByRole("button", { name: "Restore as Current" }).click();
  await expect(
    page.getByText("Restoring this edition as Current"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start a new edition" }).first(),
  ).toBeDisabled();
  expect(captures.editionRestores[0]).toEqual({
    path: "/api/files/editions/edition-2024/restore",
    body: {
      expectedVersion: 4,
      expectedFolderVersion: 3,
      archiveCurrent: true,
      expectedCurrentEditionVersion: 7,
    },
    idempotencyKey: expect.any(String),
    ifMatch: '"edition-4"',
  });
  expect(captures.requests.some(({ path }) => path.endsWith("/activate"))).toBe(
    false,
  );
  await expect(
    page.getByText(
      "Archived edition restored as Current with its versioned contents.",
    ),
  ).toBeVisible({ timeout: 10_000 });
  expect(captures.editionMaterializationPolls).toHaveLength(3);
  const restored = page
    .locator(".files-edition")
    .filter({ hasText: "2024 cycle" });
  await expect(restored.getByText("Current", { exact: true })).toBeVisible();
});

test("reload reconciles a manager-visible active materialization and resumes polling", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    editionMaterializationStatuses: ["applying", "applying", "complete"],
  });
  await page.goto("/files/folders/folder-1");
  await page.getByRole("button", { name: "Restore as Current" }).click();
  await expect(page.getByText(/applying · 2 source items/)).toBeVisible();
  const pollsBeforeReload = captures.editionMaterializationPolls.length;
  await page.reload();
  await expect(
    page.getByText("Restoring this edition as Current"),
  ).toBeVisible();
  await expect(
    page.getByText("Edition restore completed with its versioned contents."),
  ).toBeVisible({ timeout: 10_000 });
  expect(captures.editionRestores).toHaveLength(1);
  expect(captures.editionMaterializationPolls.length).toBeGreaterThan(
    pollsBeforeReload,
  );
});

test("active materialization bootstrap is manager-only and malformed summaries fail closed", async ({
  page,
  context,
}) => {
  const activeMaterialization = {
    materializationId: "materialization-existing",
    mode: "restore",
    status: "applying",
    progress: {
      phase: "applying",
      sourceAssetCount: 2,
      projectionItemCount: 1,
      affectedFolderCount: 1,
      complete: false,
    },
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:01.000Z",
    version: 2,
  };
  const viewerWorkspace = workspace();
  viewerWorkspace.permissions = viewerWorkspace.permissions.filter(
    (permission) => permission !== "files_manage",
  );
  viewerWorkspace.capabilities.canManage = false;
  viewerWorkspace.activeMaterialization = activeMaterialization;
  await seedSession(page);
  const viewerCaptures = await mockFiles(page, { workspace: viewerWorkspace });
  await page.goto("/files/folders/folder-1");
  await expect(page.getByText("Restoring this edition as Current")).toHaveCount(
    0,
  );
  expect(viewerCaptures.editionMaterializationPolls).toHaveLength(0);

  const malformedPage = await context.newPage();
  const malformedWorkspace = workspace();
  malformedWorkspace.activeMaterialization = {
    ...activeMaterialization,
    status: "partially_visible",
  };
  await seedSession(malformedPage);
  const malformedCaptures = await mockFiles(malformedPage, {
    workspace: malformedWorkspace,
  });
  await malformedPage.goto("/files/folders/folder-1");
  await expect(
    malformedPage.getByText("Restoring this edition as Current"),
  ).toHaveCount(0);
  expect(malformedCaptures.editionMaterializationPolls).toHaveLength(0);
});

test("edition materialization fails closed without exposing a partial Current", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    editionMaterializationStatuses: ["failed"],
  });
  await page.goto("/files/folders/folder-1");
  await page.getByRole("button", { name: "Restore as Current" }).click();
  await expect(
    page.getByRole("alert").getByText("Version restore could not finish"),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "edition source unavailable",
  );
  expect(captures.editionMaterializationPolls).toHaveLength(1);
  const originalCurrent = page
    .locator(".files-edition")
    .filter({ hasText: "2026 cycle" });
  await expect(
    originalCurrent.getByText("Current", { exact: true }),
  ).toBeVisible();
});

test("workspace materialization locks explain the 409 without pretending to mutate", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    onRequest: async ({ route, path, method }) => {
      if (
        path === "/api/files/editions/edition-2024/restore" &&
        method === "POST"
      ) {
        await json(
          route,
          {
            ok: false,
            error: "files_materialization_in_progress",
            message: "Workspace locked",
          },
          409,
        );
        return true;
      }
      return false;
    },
  });
  await page.goto("/files/folders/folder-1");
  await page.getByRole("button", { name: "Restore as Current" }).click();
  await expect(
    page.getByText(/Another edition change is already/),
  ).toBeVisible();
  expect(captures.editionMaterializationPolls).toHaveLength(0);
});

test("Files denies a workspace when the feature flag is absent", async ({
  page,
}) => {
  await seedSession(page);
  const missingFlagWorkspace = workspace();
  delete missingFlagWorkspace.featureFlags.filesEnabled;
  await mockFiles(page, { workspace: missingFlagWorkspace });

  await page.goto("/files");
  await expect(
    page.getByRole("heading", { name: "Files isn’t enabled here" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
});

test("drag and drop uses bounded resumable multipart upload and enters scanning", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page);
  await page.goto("/files/folders/folder-1");
  await page
    .getByRole("button", { name: "Upload", exact: true })
    .first()
    .click();
  await page.locator("[data-dropzone]").evaluate((dropzone) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["district briefing"], "briefing.txt", { type: "text/plain" }),
    );
    dropzone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
  await expect(
    page.getByText("Uploaded · security scan in progress"),
  ).toBeVisible();
  expect(captures.uploads.map((entry) => entry.step)).toEqual([
    "initiate",
    "presign",
    "checkpoint",
    "complete",
  ]);
  expect(captures.uploads[0].body).toEqual(
    expect.objectContaining({
      fileName: "briefing.txt",
      contentType: "text/plain",
      size: 17,
      checksumSha256: expect.any(String),
      intent: "commit",
      expectedVersion: 3,
    }),
  );
  expect(captures.uploads[0].body).not.toHaveProperty("expectedFolderVersion");
  expect(captures.uploads[3].body.parts[0]).toEqual(
    expect.objectContaining({ partNumber: 1, etag: '"part-etag-1"' }),
  );
  expect(captures.uploads.every((entry) => entry.idempotencyKey)).toBe(true);
  expect(captures.uploads[0].idempotencyKey).toBe(
    captures.uploads[0].body.idempotencyKey,
  );
  expect(captures.uploads[3].idempotencyKey).toBe(
    captures.uploads[3].body.idempotencyKey,
  );
  expect(captures.uploadPartHeaders[0]["x-amz-checksum-sha256"]).toBe(
    captures.uploads[1].body.parts[0].checksumSha256,
  );
});

test("pause survives reload and resumes without reuploading completed parts", async ({
  page,
}) => {
  await seedSession(page);
  let releaseInterruptedPart;
  const interruptedPart = new Promise((resolve) => {
    releaseInterruptedPart = resolve;
  });
  const completedParts = [1, 2, 3].map((partNumber) => ({
    partNumber,
    etag: `"part-etag-${partNumber}"`,
    checksumSha256: "server-reconciled-checksum",
    size: 4,
  }));
  const captures = await mockFiles(page, {
    uploadPartSize: 4,
    uploadTotalParts: 4,
    uploadStatuses: [
      {
        state: "uploading",
        progress: 0.75,
        bytesUploaded: 12,
        uploadedParts: completedParts,
      },
      {
        state: "uploading",
        progress: 0.75,
        bytesUploaded: 12,
        uploadedParts: completedParts,
      },
      { state: "scanning", progress: 1, uploadedParts: completedParts },
    ],
    onSignedUpload: async ({ route, partNumber, attempt }) => {
      if (partNumber !== 4 || attempt !== 1) return false;
      await interruptedPart;
      await route
        .fulfill({
          status: 200,
          headers: { etag: '"part-etag-4"' },
          body: "",
        })
        .catch(() => {});
      return true;
    },
  });
  const chooseCheckpointFile = (locator) =>
    locator.evaluate((input) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["abcdefghijklmnop"], "resume.txt", {
          type: "text/plain",
          lastModified: 1_786_800_000_000,
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await chooseCheckpointFile(page.locator('[data-action="pick-files"]'));
  await expect
    .poll(
      () =>
        captures.signedUploadParts.filter(({ partNumber }) => partNumber === 4)
          .length,
    )
    .toBe(1);

  await page
    .locator(".files-modal")
    .getByRole("button", { name: "Pause" })
    .click();
  await expect(page.getByText("Paused at 75%").first()).toBeVisible();
  expect(captures.uploadAborts).toHaveLength(0);
  const storedBeforeReload = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("polisFilesUploads.v1")),
  );
  expect(storedBeforeReload.items[0]).toEqual(
    expect.objectContaining({
      status: "paused",
      sessionId: "upload-1",
      progress: 0.75,
    }),
  );
  expect(
    storedBeforeReload.items[0].completedParts.map(
      ({ partNumber, etag, size }) => ({ partNumber, etag, size }),
    ),
  ).toEqual(
    completedParts.map(({ partNumber, etag, size }) => ({
      partNumber,
      etag,
      size,
    })),
  );
  releaseInterruptedPart();

  await page.reload();
  await expect(page.getByText("Choose the same file to resume")).toBeVisible();
  await chooseCheckpointFile(page.locator("[data-resume-upload]"));
  await expect
    .poll(
      () => captures.uploads.filter(({ step }) => step === "complete").length,
    )
    .toBe(1);
  await expect(
    page.getByText("Uploaded · security scan in progress").first(),
  ).toBeVisible();

  const presignedPartBatches = captures.uploads
    .filter(({ step }) => step === "presign")
    .map(({ body }) => body.parts.map(({ partNumber }) => partNumber));
  expect(presignedPartBatches).toEqual([[1, 2, 3], [4], [4]]);
  expect(
    captures.signedUploadParts.filter(({ partNumber }) => partNumber <= 3),
  ).toEqual([
    { partNumber: 1, attempt: 1 },
    { partNumber: 2, attempt: 1 },
    { partNumber: 3, attempt: 1 },
  ]);
  expect(captures.uploads.at(-1).body.parts).toEqual([
    ...completedParts.map(({ partNumber, etag, checksumSha256 }) => ({
      partNumber,
      etag,
      checksumSha256,
    })),
    expect.objectContaining({ partNumber: 4, etag: '"part-etag-4"' }),
  ]);
});

test("Cancel remains the canonical server abort after a local pause", async ({
  page,
}) => {
  await seedSession(page);
  let releaseUpload;
  const uploadGate = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  const captures = await mockFiles(page, {
    uploadStatuses: [{ state: "uploading", version: 1, progress: 0 }],
    onSignedUpload: async ({ route, partNumber, attempt }) => {
      if (partNumber !== 1 || attempt !== 1) return false;
      await uploadGate;
      await route
        .fulfill({
          status: 200,
          headers: { etag: '"part-etag-1"' },
          body: "",
        })
        .catch(() => {});
      return true;
    },
  });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('[data-action="pick-files"]').evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["cancel me"], "cancel.txt", {
        type: "text/plain",
        lastModified: 1_786_800_000_000,
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(() => captures.signedUploadParts.length).toBe(1);
  const modal = page.locator(".files-modal");
  await modal.getByRole("button", { name: "Pause" }).click();
  await expect(modal.getByText(/Paused at/)).toBeVisible();
  expect(captures.uploadAborts).toHaveLength(0);

  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => captures.uploadAborts.length).toBe(1);
  expect(captures.uploadAborts).toEqual([
    {
      body: {
        expectedVersion: 1,
        idempotencyKey: expect.any(String),
      },
      idempotencyKey: expect.any(String),
    },
  ]);
  expect(captures.uploadAborts[0].idempotencyKey).toBe(
    captures.uploadAborts[0].body.idempotencyKey,
  );
  const cancellationRequests = captures.requests.filter(({ path }) =>
    path.startsWith("/api/files/upload-sessions/upload-1"),
  );
  expect(
    cancellationRequests.slice(-2).map(({ method, path }) => [method, path]),
  ).toEqual([
    ["GET", "/api/files/upload-sessions/upload-1"],
    ["POST", "/api/files/upload-sessions/upload-1/abort"],
  ]);
  releaseUpload();
});

test("a failed upload abort keeps its checkpoint and retries on reload", async ({
  page,
}) => {
  await seedSession(page);
  let releaseUpload;
  const uploadGate = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  const captures = await mockFiles(page, {
    uploadAbortFailures: 1,
    uploadStatuses: [{ state: "uploading", version: 1, progress: 0 }],
    onSignedUpload: async ({ route, partNumber, attempt }) => {
      if (partNumber !== 1 || attempt !== 1) return false;
      await uploadGate;
      await route
        .fulfill({
          status: 200,
          headers: { etag: '"part-etag-1"' },
          body: "",
        })
        .catch(() => {});
      return true;
    },
  });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('[data-action="pick-files"]').evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["cancel and retry"], "retry-cancel.txt", {
        type: "text/plain",
        lastModified: 1_786_800_000_000,
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(() => captures.signedUploadParts.length).toBe(1);
  const modal = page.locator(".files-modal");
  await modal.getByRole("button", { name: "Pause" }).click();
  await expect(modal.getByText(/Paused at/)).toBeVisible();

  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(
    modal.getByRole("button", { name: "Retry cancellation" }),
  ).toBeVisible();
  const pendingCheckpoint = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("polisFilesUploads.v1")),
  );
  expect(pendingCheckpoint.items).toEqual([
    expect.objectContaining({
      sessionId: "upload-1",
      status: "cancel_pending",
      cancelRequested: true,
    }),
  ]);
  expect(captures.uploadAborts).toHaveLength(1);
  releaseUpload();

  await page.reload();
  await expect.poll(() => captures.uploadAborts.length).toBe(2);
  expect(captures.uploadAborts[1].idempotencyKey).toBe(
    captures.uploadAborts[0].idempotencyKey,
  );
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();
});

for (const invalidSession of [
  { name: "malformed JSON", body: '{"ok":true,"uploadSession":' },
  { name: "missing session", body: JSON.stringify({ ok: true }) },
  {
    name: "missing identity",
    body: JSON.stringify({ ok: true, uploadSession: { version: 99 } }),
  },
  {
    name: "mismatched identity",
    body: JSON.stringify({
      ok: true,
      uploadSession: { uploadSessionId: "upload-other", version: 99 },
    }),
  },
]) {
  test(`cancellation preserves known session after ${invalidSession.name} until canonical retry`, async ({
    page,
  }) => {
    await seedSession(page);
    let releaseUpload;
    const uploadGate = new Promise((resolve) => {
      releaseUpload = resolve;
    });
    let reconciliationCount = 0;
    const captures = await mockFiles(page, {
      uploadStatuses: [{ state: "uploading", version: 1, progress: 0 }],
      onRequest: async ({ route, path, method }) => {
        if (
          path !== "/api/files/upload-sessions/upload-1" ||
          method !== "GET"
        ) {
          return false;
        }
        reconciliationCount += 1;
        if (reconciliationCount !== 1) return false;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: invalidSession.body,
        });
        return true;
      },
      onSignedUpload: async ({ route, partNumber, attempt }) => {
        if (partNumber !== 1 || attempt !== 1) return false;
        await uploadGate;
        await route
          .fulfill({
            status: 200,
            headers: { etag: '"part-etag-1"' },
            body: "",
          })
          .catch(() => {});
        return true;
      },
    });

    await page.goto("/files/uploads");
    await page.getByRole("button", { name: "Add files" }).click();
    await page.locator('[data-action="pick-files"]').evaluate((input) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["keep session identity"], "session-identity.txt", {
          type: "text/plain",
          lastModified: 1_786_800_000_000,
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => captures.signedUploadParts.length).toBe(1);
    const modal = page.locator(".files-modal");
    await modal.getByRole("button", { name: "Pause" }).click();
    await expect(modal.getByText(/Paused at/)).toBeVisible();

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(
      modal.getByRole("button", { name: "Retry cancellation" }),
    ).toBeVisible();
    const pendingCheckpoint = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("polisFilesUploads.v1")),
    );
    expect(pendingCheckpoint.items).toEqual([
      expect.objectContaining({
        sessionId: "upload-1",
        sessionVersion: 1,
        status: "cancel_pending",
        cancelRequested: true,
      }),
    ]);
    expect(captures.uploadAborts).toHaveLength(0);

    await modal.getByRole("button", { name: "Retry cancellation" }).click();
    await expect.poll(() => captures.uploadAborts.length).toBe(1);
    expect(captures.uploadAborts[0].body.expectedVersion).toBe(1);
    expect(reconciliationCount).toBe(2);
    expect(
      captures.requests
        .filter(({ path }) =>
          path.startsWith("/api/files/upload-sessions/upload-"),
        )
        .slice(-3)
        .map(({ method, path }) => [method, path]),
    ).toEqual([
      ["GET", "/api/files/upload-sessions/upload-1"],
      ["GET", "/api/files/upload-sessions/upload-1"],
      ["POST", "/api/files/upload-sessions/upload-1/abort"],
    ]);
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
      )
      .toBeNull();
    releaseUpload();
  });
}

test("active cancellation waits for an in-flight checkpoint before aborting", async ({
  page,
}) => {
  await seedSession(page);
  let markCheckpointStarted;
  let releaseCheckpoint;
  const checkpointStarted = new Promise((resolve) => {
    markCheckpointStarted = resolve;
  });
  const checkpointGate = new Promise((resolve) => {
    releaseCheckpoint = resolve;
  });
  const captures = await mockFiles(page, {
    onRequest: async ({ route, path, method }) => {
      if (
        path === "/api/files/upload-sessions/upload-1/parts" &&
        method === "POST"
      ) {
        markCheckpointStarted();
        await checkpointGate;
        await json(route, {
          ok: true,
          uploadSession: { uploadSessionId: "upload-1", version: 2 },
        });
        return true;
      }
      if (path === "/api/files/upload-sessions/upload-1" && method === "GET") {
        await json(route, {
          ok: true,
          uploadSession: {
            uploadSessionId: "upload-1",
            assetId: "asset-upload-1",
            revisionId: "asset-upload-version-1",
            state: "uploading",
            version: 2,
          },
        });
        return true;
      }
      return false;
    },
  });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('[data-action="pick-files"]').evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["checkpoint race"], "checkpoint-race.txt", {
        type: "text/plain",
        lastModified: 1_786_800_100_000,
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await checkpointStarted;

  const modal = page.locator(".files-modal");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal.getByText(/Cancelling securely/u)).toBeVisible();
  expect(captures.uploadAborts).toHaveLength(0);
  expect(
    captures.requests.filter(
      ({ path, method }) =>
        path === "/api/files/upload-sessions/upload-1" && method === "GET",
    ),
  ).toHaveLength(0);

  releaseCheckpoint();
  await expect(modal.getByText("Cancelled", { exact: true })).toBeVisible();

  const abortRequests = captures.requests.filter(
    ({ path, method }) =>
      path === "/api/files/upload-sessions/upload-1/abort" && method === "POST",
  );
  expect(abortRequests.map(({ body }) => body.expectedVersion)).toEqual([2]);
  expect(abortRequests[0].idempotencyKey).toMatch(/:abort:v2$/u);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();
});

test("cancellation waits for an in-flight session creation before confirming abort", async ({
  page,
}) => {
  await seedSession(page);
  let markCreationStarted;
  let releaseCreation;
  const creationStarted = new Promise((resolve) => {
    markCreationStarted = resolve;
  });
  const creationGate = new Promise((resolve) => {
    releaseCreation = resolve;
  });
  const captures = await mockFiles(page, {
    uploadStatuses: [{ state: "uploading", version: 1, progress: 0 }],
    onRequest: async ({ route, path, method }) => {
      if (path.endsWith("/upload-sessions") && method === "POST") {
        markCreationStarted();
        await creationGate;
        await json(route, {
          ok: true,
          uploadSession: {
            uploadSessionId: "upload-1",
            assetId: "asset-upload-1",
            revisionId: "asset-upload-version-1",
            state: "uploading",
            partSize: 5 * 1024 * 1024,
            totalParts: 1,
            uploadedParts: [],
            version: 1,
          },
        });
        return true;
      }
      return false;
    },
  });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('[data-action="pick-files"]').evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["creation race"], "creation-race.txt", {
        type: "text/plain",
        lastModified: 1_786_800_200_000,
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await creationStarted;

  const modal = page.locator(".files-modal");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal.getByText(/Cancelling securely/u)).toBeVisible();
  const pendingCheckpoint = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("polisFilesUploads.v1")),
  );
  expect(pendingCheckpoint.items).toEqual([
    expect.objectContaining({
      sessionId: "",
      status: "cancelling",
      cancelRequested: true,
      sessionCreationStarted: true,
    }),
  ]);
  expect(captures.uploadAborts).toHaveLength(0);

  releaseCreation();
  await expect(modal.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect.poll(() => captures.uploadAborts.length).toBe(1);
  expect(captures.uploadAborts[0].body.expectedVersion).toBe(1);
  expect(captures.uploadAborts[0].idempotencyKey).toMatch(/:abort:v1$/u);
  const sessionRequests = captures.requests.filter(({ path }) =>
    path.startsWith("/api/files/upload-sessions/upload-1"),
  );
  const createIndex = captures.requests.findIndex(({ path }) =>
    path.endsWith("/upload-sessions"),
  );
  const reconcileIndex = captures.requests.findIndex(
    ({ path, method }) =>
      path === "/api/files/upload-sessions/upload-1" && method === "GET",
  );
  const abortIndex = captures.requests.findIndex(({ path }) =>
    path.endsWith("/abort"),
  );
  expect(sessionRequests.some(({ method }) => method === "GET")).toBe(true);
  expect(reconcileIndex).toBeGreaterThan(createIndex);
  expect(abortIndex).toBeGreaterThan(reconcileIndex);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();
});

test("a definite pre-create 409 confirms cancellation locally", async ({
  page,
}) => {
  await seedSession(page);
  let markCreationStarted;
  let releaseCreation;
  const creationStarted = new Promise((resolve) => {
    markCreationStarted = resolve;
  });
  const creationGate = new Promise((resolve) => {
    releaseCreation = resolve;
  });
  const captures = await mockFiles(page, {
    onRequest: async ({ route, path, method }) => {
      if (path.endsWith("/upload-sessions") && method === "POST") {
        markCreationStarted();
        await creationGate;
        await json(
          route,
          {
            ok: false,
            error: "files_workspace_not_initialized",
          },
          409,
        );
        return true;
      }
      return false;
    },
  });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('[data-action="pick-files"]').evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["rejected creation"], "rejected-creation.txt", {
        type: "text/plain",
        lastModified: 1_786_800_250_000,
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await creationStarted;

  const modal = page.locator(".files-modal");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal.getByText(/Cancelling securely/u)).toBeVisible();
  releaseCreation();

  await expect(modal.getByText("Cancelled", { exact: true })).toBeVisible();
  const createRequests = captures.requests.filter(
    ({ path, method }) =>
      path.endsWith("/upload-sessions") && method === "POST",
  );
  expect(createRequests).toHaveLength(1);
  expect(createRequests[0].idempotencyKey).toBe(
    createRequests[0].body.idempotencyKey,
  );
  expect(captures.uploadAborts).toHaveLength(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();
});

test("an ambiguous creation failure replays the stable create before abort", async ({
  page,
}) => {
  await seedSession(page);
  let markCreationStarted;
  let releaseCreation;
  let creationAttempts = 0;
  const creationStarted = new Promise((resolve) => {
    markCreationStarted = resolve;
  });
  const creationGate = new Promise((resolve) => {
    releaseCreation = resolve;
  });
  const captures = await mockFiles(page, {
    uploadStatuses: [{ state: "uploading", version: 1, progress: 0 }],
    onRequest: async ({ route, path, method }) => {
      if (path.endsWith("/upload-sessions") && method === "POST") {
        creationAttempts += 1;
        if (creationAttempts === 1) {
          markCreationStarted();
          await creationGate;
          await json(
            route,
            {
              ok: false,
              error: "upload_session_unavailable",
              message: "The upload session response was interrupted.",
            },
            503,
          );
          return true;
        }
      }
      return false;
    },
  });

  await page.goto("/files/uploads");
  await page.getByRole("button", { name: "Add files" }).click();
  await page.locator('[data-action="pick-files"]').evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["ambiguous creation"], "ambiguous-creation.txt", {
        type: "text/plain",
        lastModified: 1_786_800_275_000,
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await creationStarted;

  const modal = page.locator(".files-modal");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal.getByText(/Cancelling securely/u)).toBeVisible();
  releaseCreation();

  await expect(modal.getByText("Cancelled", { exact: true })).toBeVisible();
  const createRequests = captures.requests.filter(
    ({ path, method }) =>
      path.endsWith("/upload-sessions") && method === "POST",
  );
  expect(createRequests).toHaveLength(2);
  expect(createRequests[1].idempotencyKey).toBe(
    createRequests[0].idempotencyKey,
  );
  expect(createRequests[1].body.idempotencyKey).toBe(
    createRequests[0].body.idempotencyKey,
  );
  expect(captures.uploadAborts).toHaveLength(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();
});

for (const replayFailure of [
  { status: 409, code: "idempotency_request_in_progress" },
  { status: 409, code: "idempotency_request_mismatch" },
  { status: 401, code: "unauthorized" },
  { status: 403, code: "files_permission_denied" },
  { status: 408, code: "request_timeout" },
  { status: 429, code: "files_monthly_ingress_exceeded" },
  { status: 409, code: "files_version_conflict" },
  { status: 409, code: "files_workspace_not_initialized" },
]) {
  test(`lost create response survives ${replayFailure.code} until recovery and abort`, async ({
    page,
  }) => {
    await seedSession(page);
    let markCreationStarted;
    let releaseCreation;
    let creationAttempts = 0;
    let originalFinished = false;
    const creationStarted = new Promise((resolve) => {
      markCreationStarted = resolve;
    });
    const creationGate = new Promise((resolve) => {
      releaseCreation = resolve;
    });
    const captures = await mockFiles(page, {
      uploadStatuses: [{ state: "uploading", version: 1, progress: 0 }],
      onRequest: async ({ route, path, method }) => {
        if (!path.endsWith("/upload-sessions") || method !== "POST") {
          return false;
        }
        creationAttempts += 1;
        if (creationAttempts === 1) {
          markCreationStarted();
          await creationGate;
          await route.abort("connectionreset");
          return true;
        }
        if (!originalFinished) {
          // The API returns 409 while the original idempotency claim is still
          // in progress; other replay failures also cannot undo that request.
          await json(
            route,
            { ok: false, error: replayFailure.code },
            replayFailure.status,
          );
          return true;
        }
        // Once the original commits, the same key returns its saved receipt.
        await json(
          route,
          {
            ok: true,
            uploadSession: {
              uploadSessionId: "upload-1",
              assetId: "asset-upload-1",
              revisionId: "asset-upload-version-1",
              state: "uploading",
              partSize: 5 * 1024 * 1024,
              totalParts: 1,
              uploadedParts: [],
              version: 1,
            },
          },
          200,
          { "Idempotency-Replayed": "true" },
        );
        return true;
      },
    });

    await page.goto("/files/uploads");
    await page.getByRole("button", { name: "Add files" }).click();
    await page.locator('[data-action="pick-files"]').evaluate((input) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["lost creation response"], "lost-creation-response.txt", {
          type: "text/plain",
          lastModified: 1_786_800_290_000,
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await creationStarted;

    const modal = page.locator(".files-modal");
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal.getByText(/Cancelling securely/u)).toBeVisible();
    releaseCreation();

    await expect(
      modal.getByRole("button", { name: "Retry cancellation" }),
    ).toBeVisible();
    const pendingCheckpoint = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("polisFilesUploads.v1")),
    );
    expect(pendingCheckpoint.items).toEqual([
      expect.objectContaining({
        sessionId: "",
        status: "cancel_pending",
        cancelRequested: true,
        sessionCreationStarted: true,
      }),
    ]);
    expect(creationAttempts).toBe(2);
    expect(captures.uploadAborts).toHaveLength(0);

    originalFinished = true;
    await page.reload();
    await expect.poll(() => captures.uploadAborts.length).toBe(1);
    const createRequests = captures.requests.filter(
      ({ path, method }) =>
        path.endsWith("/upload-sessions") && method === "POST",
    );
    expect(createRequests).toHaveLength(3);
    for (const replay of createRequests.slice(1)) {
      expect(replay.body).toEqual(createRequests[0].body);
      expect(replay.idempotencyKey).toBe(createRequests[0].idempotencyKey);
      expect(replay.ifMatch).toBe(createRequests[0].ifMatch);
    }
    expect(captures.uploadAborts[0].body.expectedVersion).toBe(1);
    expect(
      await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
    ).toBeNull();
  });
}

for (const completionState of ["scanning", "ready"]) {
  test(`cancellation yields to an in-flight completion that reaches ${completionState}`, async ({
    page,
  }) => {
    await seedSession(page);
    let markCompletionStarted;
    let releaseCompletion;
    const completionStarted = new Promise((resolve) => {
      markCompletionStarted = resolve;
    });
    const completionGate = new Promise((resolve) => {
      releaseCompletion = resolve;
    });
    const captures = await mockFiles(page, {
      onRequest: async ({ route, path, method }) => {
        if (
          path === "/api/files/upload-sessions/upload-1/complete" &&
          method === "POST"
        ) {
          markCompletionStarted();
          await completionGate;
          await json(
            route,
            {
              ok: true,
              uploadSession: {
                uploadSessionId: "upload-1",
                state: completionState,
                version: 3,
              },
            },
            202,
          );
          return true;
        }
        if (
          path === "/api/files/upload-sessions/upload-1" &&
          method === "GET"
        ) {
          await json(route, {
            ok: true,
            uploadSession: {
              uploadSessionId: "upload-1",
              assetId: "asset-upload-1",
              revisionId: "asset-upload-version-1",
              state: completionState,
              version: 3,
              progress: 1,
            },
          });
          return true;
        }
        return false;
      },
    });

    await page.goto("/files/uploads");
    await page.getByRole("button", { name: "Add files" }).click();
    await page.locator('[data-action="pick-files"]').evaluate((input) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["completion race"], "completion-race.txt", {
          type: "text/plain",
          lastModified: 1_786_800_300_000,
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await completionStarted;

    const modal = page.locator(".files-modal");
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal.getByText(/Cancelling securely/u)).toBeVisible();
    expect(captures.uploadAborts).toHaveLength(0);

    releaseCompletion();
    await expect(
      modal.getByText(
        completionState === "scanning"
          ? "Upload completed before cancellation · security scan in progress"
          : "Ready in Current",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      modal.getByRole("button", { name: "Retry cancellation" }),
    ).toHaveCount(0);
    expect(captures.uploadAborts).toHaveLength(0);
    const storedCheckpoint = await page.evaluate(() =>
      sessionStorage.getItem("polisFilesUploads.v1"),
    );
    if (completionState === "scanning") {
      expect(JSON.parse(storedCheckpoint).items).toEqual([
        expect.objectContaining({
          sessionId: "upload-1",
          status: "scanning",
          cancelRequested: false,
        }),
      ]);
    } else {
      expect(storedCheckpoint).toBeNull();
    }
    const sessionRequests = captures.requests.filter(({ path }) =>
      path.startsWith("/api/files/upload-sessions/upload-1"),
    );
    const completeIndex = sessionRequests.findIndex(({ path }) =>
      path.endsWith("/complete"),
    );
    const reconcileIndex = sessionRequests.findIndex(
      ({ path, method }) =>
        path === "/api/files/upload-sessions/upload-1" && method === "GET",
    );
    expect(completeIndex).toBeGreaterThanOrEqual(0);
    expect(reconcileIndex).toBeGreaterThan(completeIndex);
  });
}

test("setup presets keep rule prompts on and AI off by default", async ({
  page,
}) => {
  await seedSession(page);
  const uninitialized = workspace({ initialized: false });
  const captures = await mockFiles(page, { workspace: uninitialized });
  await page.goto("/files");
  await expect(
    page.getByRole("heading", { name: "Start organized—not empty." }),
  ).toBeVisible();
  await expect(page.getByLabel(/Rule-based event media prompts/)).toBeChecked();
  await expect(page.getByLabel(/Optional AI caption/)).not.toBeChecked();
  await page.getByText("Independent organization", { exact: true }).click();
  await page.getByRole("button", { name: "Create my Files space" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Everything your team needs—without hunting for it.",
    }),
  ).toBeVisible();
  expect(captures.initializations[0]).toEqual({
    presetKey: "independent_org",
    expectedVersion: 0,
    settings: {
      version: 1,
      defaultView: "my_files",
      suggestions: {
        contextMatches: true,
        socialPosts: true,
        duplicateMedia: true,
        aiAssistance: false,
      },
      automations: {
        contextSharingPrompts: true,
        newMediaPostPrompts: true,
        usageBadges: true,
      },
      notifications: {
        shares: true,
        proposals: true,
        reviews: true,
        automations: true,
      },
      rolePurposeMappings: {},
      rolePurposeMappingsByRoot: { organization: {} },
    },
  });
  expect(captures.initializationRequests[0]).toEqual({
    body: captures.initializations[0],
    idempotencyKey: expect.any(String),
    ifMatch: "",
  });
});

test("AI controls stay hidden and forged values fail closed when the feature is disabled", async ({
  page,
}) => {
  await seedSession(page);
  const setupWorkspace = workspace({ initialized: false });
  setupWorkspace.featureFlags.aiSuggestionsEnabled = false;
  setupWorkspace.settings.suggestions.aiAssistance = true;
  const setupCaptures = await mockFiles(page, { workspace: setupWorkspace });

  await page.goto("/files");
  await expect(page.getByLabel(/Optional AI caption/)).toHaveCount(0);
  await expect(
    page.locator('form[data-form="setup"] [name="aiSuggestionsEnabled"]'),
  ).toHaveCount(0);
  await appendForgedAiSetting(page, "setup");
  await page.getByRole("button", { name: "Create my Files space" }).click();
  expect(
    setupCaptures.initializations[0].settings.suggestions.aiAssistance,
  ).toBe(false);

  const settingsPage = await page.context().newPage();
  await seedSession(settingsPage);
  const disabledWorkspace = workspace();
  disabledWorkspace.featureFlags.aiSuggestionsEnabled = false;
  disabledWorkspace.settings.suggestions.aiAssistance = true;
  const disabledFolder = {
    ...folder,
    settings: {
      inheritWorkspace: false,
      suggestions: {
        contextMatches: true,
        socialPosts: true,
        aiAssistance: true,
      },
      automations: { usageBadges: true },
    },
  };
  const settingsCaptures = await mockFiles(settingsPage, {
    workspace: disabledWorkspace,
    folder: disabledFolder,
  });

  await settingsPage.goto("/files");
  await settingsPage
    .getByRole("button", { name: "Open Files settings" })
    .click();
  await expect(settingsPage.getByLabel(/^AI assistance/)).toHaveCount(0);
  await expect(
    settingsPage.locator(
      'form[data-form="settings"] [name="aiSuggestionsEnabled"]',
    ),
  ).toHaveCount(0);
  await appendForgedAiSetting(settingsPage, "settings");
  await settingsPage.getByRole("button", { name: "Save settings" }).click();
  expect(settingsCaptures.settings[0].settings.suggestions).toEqual({
    contextMatches: true,
    socialPosts: true,
    duplicateMedia: true,
    aiAssistance: false,
  });

  await settingsPage.goto("/files/folders/folder-1");
  await settingsPage.getByRole("button", { name: "Folder settings" }).click();
  await expect(settingsPage.getByLabel(/^AI suggestions/)).toHaveCount(0);
  await expect(
    settingsPage.locator(
      'form[data-form="folder-settings"] [name="aiSuggestionsEnabled"]',
    ),
  ).toHaveCount(0);
  await appendForgedAiSetting(settingsPage, "folder-settings");
  const folderReload = settingsPage.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/files/folders/folder-1/assets",
  );
  await settingsPage.getByRole("button", { name: "Save folder" }).click();
  await folderReload;
  expect(settingsCaptures.folders[0].settings).toEqual({
    inheritWorkspace: false,
    suggestions: {
      contextMatches: true,
      socialPosts: true,
      aiAssistance: false,
    },
    automations: { usageBadges: true },
  });
  await settingsPage.close();
});

test("workspace settings preserve the canonical nested contract and revision", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page);
  await page.goto("/files");
  await page.getByRole("button", { name: "Open Files settings" }).click();
  await page.getByLabel(/^AI assistance/).check();
  await page.getByRole("button", { name: "Save settings" }).click();

  expect(captures.settings).toHaveLength(1);
  expect(captures.settings[0]).toEqual({
    settings: {
      version: 1,
      defaultView: "my_files",
      suggestions: {
        contextMatches: true,
        socialPosts: true,
        duplicateMedia: true,
        aiAssistance: true,
      },
      automations: {
        contextSharingPrompts: true,
        newMediaPostPrompts: true,
        usageBadges: true,
      },
      notifications: {
        shares: true,
        proposals: true,
        reviews: true,
        automations: true,
      },
      rolePurposeMappings: {},
      rolePurposeMappingsByRoot: { organization: {} },
    },
    expectedVersion: 9,
  });
  expect(captures.settings[0].settings).not.toHaveProperty(
    "aiSuggestionsEnabled",
  );
  expect(captures.settingsRequests[0]).toEqual({
    body: captures.settings[0],
    idempotencyKey: expect.any(String),
    ifMatch: '"workspace-9"',
  });
});

test("workspace settings submit only the active authorization root", async ({
  page,
}) => {
  await seedSession(page);
  const multiRootWorkspace = workspace();
  multiRootWorkspace.settings.rolePurposeMappingsByRoot = {
    organization: { media: ["organization-media"] },
    campaign: { media: ["campaign-media"] },
    official_office: { governance: ["official-governance"] },
  };
  multiRootWorkspace.settings.rolePurposeMappings =
    multiRootWorkspace.settings.rolePurposeMappingsByRoot.organization;
  const captures = await mockFiles(page, { workspace: multiRootWorkspace });

  await page.goto("/files");
  await page.getByRole("button", { name: "Open Files settings" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();

  expect(captures.settings[0].settings.rolePurposeMappingsByRoot).toEqual({
    organization: { media: ["organization-media"] },
  });
});

test("official workspace bootstrap uses the official source alias id", async ({
  page,
}) => {
  await seedSession(page);
  const officialWorkspace = workspace({
    principal: {
      type: "political_account",
      id: "political-account-42",
      sourceType: "official",
      sourceId: "official-7",
      displayName: "Mayor Jordan Lee",
      jurisdiction: { stateCode: "FL", municipality: "Pensacola" },
    },
  });
  const captures = await mockFiles(page, { workspace: officialWorkspace });

  await page.goto("/files");
  await expect(
    page.getByRole("heading", {
      name: "Everything your team needs—without hunting for it.",
    }),
  ).toBeVisible();
  expect(captures.requests).toContainEqual(
    expect.objectContaining({
      method: "GET",
      path: "/api/files/workspaces/official/official-7",
    }),
  );
  expect(
    captures.requests.some(
      ({ path }) =>
        path === "/api/files/workspaces/political_account/political-account-42",
    ),
  ).toBe(false);
});

test("Official Office Files-only staff need explicit post-draft eligibility", async ({
  page,
}) => {
  await seedSession(page);
  const officialWorkspace = workspace({
    principal: {
      type: "political_account",
      id: "political-account-42",
      sourceType: "official",
      sourceId: "official-7",
      displayName: "Mayor Jordan Lee",
      jurisdiction: { stateCode: "FL", municipality: "Pensacola" },
    },
  });
  delete officialWorkspace.capabilities.canCreatePostDraft;
  const captures = await mockFiles(page, { workspace: officialWorkspace });

  await page.goto("/files/folders/folder-1");
  await expect(page.getByText("Florida State Party used this")).toBeVisible();
  await page
    .getByRole("button", { name: "Select Fourth of July crowd.jpg" })
    .click();
  await expect(page.getByRole("button", { name: /Create post/ })).toHaveCount(
    0,
  );

  await page.locator("#files-app").evaluate((app) => {
    const forgedAction = document.createElement("button");
    forgedAction.dataset.action = "open-post";
    forgedAction.textContent = "Forged create post action";
    app.append(forgedAction);
    forgedAction.click();
  });
  await expect(
    page.getByText(
      "Your current Polis role cannot create posts from this Files folder.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Turn approved media into a post" }),
  ).toHaveCount(0);
  expect(captures.posts).toHaveLength(0);
});

test("proposal uploads create exactly one server-owned replace proposal", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    uploadStatuses: [
      {
        state: "ready",
        intent: "proposal",
        proposal: { proposalId: "proposal-upload-1" },
      },
    ],
  });
  await page.goto("/files/folders/folder-1?tab=proposals");
  await page.getByRole("button", { name: "Suggest change" }).click();
  await page.getByLabel("Change type").selectOption("replace");
  await page.getByLabel("Short title").fill("Replace the parade clip");
  await page
    .getByLabel("Explain the change")
    .fill("The stabilized cut has accessible captions.");
  await page.getByLabel("Current asset").selectOption("asset-2");
  await page.locator("[data-proposal-upload]").setInputFiles({
    name: "parade-captioned.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("captioned parade clip"),
  });
  await expect
    .poll(() => captures.uploads.some(({ step }) => step === "complete"))
    .toBe(true);

  expect(captures.uploads[0].body).toEqual(
    expect.objectContaining({
      intent: "proposal",
      expectedVersion: 3,
      proposal: {
        action: "replace",
        targetAssetId: "asset-2",
        title: "Replace the parade clip",
        description: "The stabilized cut has accessible captions.",
      },
    }),
  );
  expect(captures.proposalCreates).toHaveLength(0);
});

test("shared contribute access always uploads as a proposal, never a direct commit", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    folderAccess: {
      shared: true,
      permissions: ["files_view", "files_propose"],
      capabilities: {
        canView: true,
        canUpload: false,
        canPropose: true,
        canReview: false,
        canManage: false,
        canShare: false,
      },
      grantId: "grant-contribute",
      accessTier: "contribute",
      currentMainOnly: true,
    },
  });
  await page.goto("/files/folders/folder-1");
  await page
    .locator("#files-content")
    .getByRole("button", { name: "Upload for review" })
    .click();
  await page.locator('[data-action="pick-files"]').setInputFiles({
    name: "field-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("suggested field note"),
  });
  await expect
    .poll(() => captures.uploads.some(({ step }) => step === "complete"))
    .toBe(true);

  expect(captures.uploads[0].body).toEqual(
    expect.objectContaining({
      intent: "proposal",
      proposal: {
        action: "add",
        title: "Add field-note.txt",
        description: "Submitted from shared Files access for review.",
      },
    }),
  );
  expect(captures.proposalCreates).toHaveLength(0);
});

test("non-upload proposal operations send canonical operation arrays", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page);
  await page.goto("/files/folders/folder-1?tab=proposals");
  const operations = [
    {
      type: "move",
      configure: async () => {
        await page.getByLabel("Current asset").selectOption("asset-1");
        await page.getByLabel("Destination folder").selectOption("folder-2");
      },
      expected: {
        type: "move",
        assetId: "asset-1",
        destinationFolderId: "folder-2",
      },
    },
    {
      type: "metadata",
      configure: async () => {
        await page.getByLabel("Current asset").selectOption("asset-1");
        await page.getByLabel("Metadata field").fill("eventDate");
        await page.getByLabel("New value").fill("2026-07-04");
      },
      expected: {
        type: "metadata",
        assetId: "asset-1",
        metadata: { eventDate: "2026-07-04" },
      },
    },
    {
      type: "delete",
      configure: async () => {
        await page.getByLabel("Current asset").selectOption("asset-2");
      },
      expected: { type: "delete", assetId: "asset-2" },
    },
  ];

  for (const operation of operations) {
    await page.getByRole("button", { name: "Suggest change" }).click();
    await page.getByLabel("Change type").selectOption(operation.type);
    await page.getByLabel("Short title").fill(`${operation.type} asset`);
    await page
      .getByLabel("Explain the change")
      .fill(`Canonical ${operation.type} proposal.`);
    await operation.configure();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect.poll(() => captures.proposalCreates.length).toBeGreaterThan(0);
  }

  expect(
    captures.proposalCreates.map(({ operations }) => operations[0]),
  ).toEqual(operations.map(({ expected }) => expected));
});

test("restricted folders disable post tools while internal Campaign Media stays usable", async ({
  page,
}) => {
  await seedSession(page);
  const restrictedFolder = {
    ...folder,
    restriction: "restricted",
    context: { ...folder.context, sensitivity: "highly_restricted" },
    settings: {
      inheritWorkspace: false,
      suggestions: {
        contextMatches: true,
        socialPosts: true,
        aiAssistance: true,
      },
      automations: { usageBadges: true },
    },
  };
  const captures = await mockFiles(page, { folder: restrictedFolder });
  await page.goto("/files/folders/folder-1");
  await page.getByRole("button", { name: "Folder settings" }).click();
  await expect(page.getByLabel(/^AI suggestions/)).toBeDisabled();
  await expect(page.getByLabel(/^AI suggestions/)).not.toBeChecked();
  await expect(page.getByLabel(/^Post suggestions/)).toBeDisabled();
  await expect(page.getByLabel(/^Post suggestions/)).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Select Fourth of July crowd.jpg" })
    .click();
  await expect(page.getByRole("button", { name: /Create post/ })).toHaveCount(
    0,
  );
  await expect(page.getByText("Florida State Party used this")).toHaveCount(0);
  await page.getByRole("button", { name: "Folder settings" }).click();
  await page.getByRole("button", { name: "Save folder" }).click();

  expect(captures.folders[0].settings).toEqual({
    inheritWorkspace: false,
    suggestions: {
      contextMatches: true,
      socialPosts: false,
      aiAssistance: false,
    },
    automations: { usageBadges: true },
  });

  const internalPage = await page.context().newPage();
  await seedSession(internalPage);
  await mockFiles(internalPage, {
    folder: {
      ...folder,
      name: "Campaign Media",
      restriction: "standard",
      context: { ...folder.context, sensitivity: "internal" },
    },
  });
  await internalPage.goto("/files/folders/folder-1");
  await internalPage
    .getByRole("button", { name: "Select Fourth of July crowd.jpg" })
    .click();
  await expect(
    internalPage.getByRole("button", { name: /Create post/ }),
  ).toBeVisible();
  await internalPage.getByRole("button", { name: /Create post/ }).click();
  await expect(
    internalPage.getByRole("heading", {
      name: "Turn approved media into a post",
    }),
  ).toBeVisible();
  await internalPage.close();
});

test("scan polling stops and surfaces an explicit quarantined result", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    uploadStatuses: [
      { state: "quarantined", quarantineReason: "Malware signature detected" },
    ],
  });
  await page.goto("/files/folders/folder-1");
  await page
    .locator("#files-content")
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await page.locator('[data-action="pick-files"]').setInputFiles({
    name: "unsafe.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("unsafe archive"),
  });
  await expect(page.getByText("Malware signature detected")).toBeVisible();
  await expect(page.locator(".files-upload-item--quarantined")).toBeVisible();
  expect(
    captures.requests.filter(
      ({ method, path }) =>
        method === "GET" && path === "/api/files/upload-sessions/upload-1",
    ),
  ).toHaveLength(1);
});

test("named recipients can accept restricted shares with the live entity revision", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    grantRequests: [
      {
        grantId: "grant-incoming",
        folderId: "folder-1",
        folderName: "Restricted FL03 strategy",
        ownerPrincipal: {
          type: "organization",
          id: "owner-org",
          displayName: "Florida Victory Coalition",
        },
        recipientPrincipal: {
          type: "organization",
          id: "org-1",
          displayName: "Forward Florida",
        },
        purpose: "Named recipient election briefing",
        accessTier: "contribute",
        allowDownload: false,
        expiresAt: Date.UTC(2026, 11, 31),
        relationshipId: "rel-active",
        status: "pending_recipient_acceptance",
        approvalProgress: {
          maintainer: true,
          governanceAuthority: true,
          recipientAcceptance: false,
        },
        grantRequestRevision: 1,
        revision: 7,
        etag: '"grant-7"',
      },
    ],
  });
  await page.goto("/files/grant-requests/grant-incoming");
  await expect(page.getByText("Restricted FL03 strategy")).toBeVisible();
  await expect(
    page.getByText(/Florida Victory Coalition requests/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept access" }).click();
  await expect(
    page.getByRole("heading", { name: "Florida House District 3", level: 2 }),
  ).toBeVisible();
  expect(captures.grantRequests[0]).toEqual(
    expect.objectContaining({
      path: "/api/files/grants/grant-incoming/accept",
      body: { expectedVersion: 7 },
      idempotencyKey: expect.any(String),
    }),
  );
});

test("non-recipients cannot discover or accept incoming restricted shares", async ({
  page,
}) => {
  await seedSession(page);
  await mockFiles(page, { grantRequestsForbidden: true });
  await page.goto("/files/grant-requests/grant-incoming");
  await expect(
    page.getByRole("heading", { name: "Needs review", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("Restricted access requests")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept access" })).toHaveCount(
    0,
  );
});

test("select all refuses ambiguous truncation when a folder exceeds the carousel limit", async ({
  page,
}) => {
  await seedSession(page);
  const manyAssets = Array.from({ length: 11 }, (_, index) => ({
    assetId: `asset-many-${index + 1}`,
    folderId: "folder-1",
    sourceAssetVersionId: `asset-many-version-${index + 1}`,
    name: `Event photo ${index + 1}.jpg`,
    mimeType: "image/jpeg",
    state: "ready",
    size: 1000 + index,
  }));
  await mockFiles(page, { assets: manyAssets });
  await page.goto("/files/folders/folder-1");
  await page.getByRole("button", { name: "Select all media" }).click();
  await expect(
    page.getByText(
      "This folder has 11 media items. Choose up to 10 individually for a Polis carousel.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Create post/ })).toHaveCount(
    0,
  );
});

test("mismatched-user upload checkpoints purge before reconciliation", async ({
  page,
}) => {
  await seedSession(page, {
    uploadCheckpoint: true,
    sessionUserId: "user-current",
    checkpointUserId: "user-previous",
  });
  const captures = await mockFiles(page);
  await page.goto("/files");
  await expect(
    page.getByRole("heading", {
      name: "Everything your team needs—without hunting for it.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();
  expect(
    captures.requests.some(
      ({ path }) => path === "/api/files/upload-sessions/upload-revoked",
    ),
  ).toBe(false);
});

test("upload checkpoints are purged on logout and authorization revocation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "polisFilesUploads.v1",
      JSON.stringify([{ id: "orphan" }]),
    );
  });
  await page.goto("/files");
  await expect(
    page.getByRole("heading", { name: /campaign knowledge/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("polisFilesUploads.v1")),
  ).toBeNull();

  const revoked = await page.context().newPage();
  await seedSession(revoked, { uploadCheckpoint: true });
  await revoked.route("**/api/files/**", (route) =>
    json(
      route,
      { ok: false, error: "forbidden", message: "Access revoked" },
      403,
    ),
  );
  await revoked.goto("/files");
  await expect(
    revoked.getByRole("heading", { name: "Files could not open" }),
  ).toBeVisible();
  expect(
    await revoked.evaluate(() =>
      sessionStorage.getItem("polisFilesUploads.v1"),
    ),
  ).toBeNull();
});

for (const rootFixture of [
  {
    name: "Campaign setup is independent from Official Office",
    principal: {
      type: "political_account",
      id: "political-account-42",
      sourceType: "candidate",
      sourceId: "candidate-42",
      displayName: "Jordan Lee for Florida",
    },
    initializedElsewhere: "official_office",
    expectedRoot: "campaign",
  },
  {
    name: "Official Office setup is independent from Campaign",
    principal: {
      type: "political_account",
      id: "political-account-42",
      sourceType: "official",
      sourceId: "official-42",
      displayName: "Mayor Jordan Lee",
    },
    initializedElsewhere: "campaign",
    expectedRoot: "official_office",
  },
]) {
  test(rootFixture.name, async ({ page }) => {
    await seedSession(page);
    const scopedWorkspace = workspace({
      initialized: true,
      principal: rootFixture.principal,
    });
    scopedWorkspace.setup = { initialized: true, presetKey: "other-root" };
    scopedWorkspace.setupByRoot = {
      [rootFixture.initializedElsewhere]: {
        initialized: true,
        presetKey: "other-root",
      },
    };
    scopedWorkspace.settings.rolePurposeMappings = {
      media: ["wrong-root-role"],
    };
    scopedWorkspace.settings.rolePurposeMappingsByRoot = {
      [rootFixture.initializedElsewhere]: {
        media: ["wrong-root-role"],
      },
    };
    const captures = await mockFiles(page, { workspace: scopedWorkspace });

    await page.goto("/files");
    await expect(
      page.getByRole("heading", { name: "Start organized—not empty." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create my Files space" }).click();
    expect(captures.initializations[0]).toEqual(
      expect.objectContaining({
        expectedVersion: 9,
        settings: expect.objectContaining({
          rolePurposeMappings: {},
          rolePurposeMappingsByRoot: { [rootFixture.expectedRoot]: {} },
        }),
      }),
    );
    expect(
      captures.initializations[0].settings.rolePurposeMappingsByRoot,
    ).not.toHaveProperty(rootFixture.initializedElsewhere);
  });
}

test("stale setup refreshes the workspace fence and requires an intentional retry", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, {
    workspace: workspace({ initialized: false }),
    staleInitializeOnce: true,
  });
  await page.goto("/files");
  await page.getByRole("button", { name: "Create my Files space" }).click();
  await expect(page.getByText(/Current versions were refreshed/)).toBeVisible();
  await page.getByRole("button", { name: "Create my Files space" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Everything your team needs—without hunting for it.",
    }),
  ).toBeVisible();

  expect(captures.initializationRequests).toHaveLength(2);
  expect(captures.initializationRequests[0]).toEqual(
    expect.objectContaining({
      body: expect.objectContaining({ expectedVersion: 0 }),
      ifMatch: "",
      idempotencyKey: expect.any(String),
    }),
  );
  expect(captures.initializationRequests[1]).toEqual(
    expect.objectContaining({
      body: expect.objectContaining({ expectedVersion: 10 }),
      ifMatch: '"workspace-10"',
      idempotencyKey: expect.any(String),
    }),
  );
  expect(captures.initializationRequests[0].idempotencyKey).not.toBe(
    captures.initializationRequests[1].idempotencyKey,
  );
});

test("root and child folders use the exact target fence and stale roots retry safely", async ({
  page,
  context,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page, { staleFolderCreateOnce: true });
  await page.goto("/files");
  await page.getByRole("button", { name: "New root folder" }).click();
  await page.getByLabel("Folder name").fill("Campaign compliance");
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByText(/Current versions were refreshed/)).toBeVisible();
  await expect(page.locator(".files-busy")).toHaveCount(0);
  await page.getByLabel("Folder name").fill("Campaign compliance");
  await page.getByLabel("Folder name").press("Enter");
  await expect.poll(() => captures.folderCreates.length).toBe(2);
  expect(captures.folderCreates[0]).toEqual(
    expect.objectContaining({
      body: expect.objectContaining({ expectedVersion: 9 }),
      ifMatch: '"workspace-9"',
      idempotencyKey: expect.any(String),
    }),
  );
  expect(captures.folderCreates[1]).toEqual(
    expect.objectContaining({
      body: expect.objectContaining({ expectedVersion: 10 }),
      ifMatch: '"workspace-10"',
      idempotencyKey: expect.any(String),
    }),
  );
  expect(captures.folderCreates[0].idempotencyKey).not.toBe(
    captures.folderCreates[1].idempotencyKey,
  );

  const childPage = await context.newPage();
  await seedSession(childPage);
  const childCaptures = await mockFiles(childPage);
  await childPage.goto("/files/folders/folder-1");
  await childPage.getByRole("button", { name: "New subfolder" }).click();
  await childPage.getByLabel("Folder name").fill("Precinct contacts");
  await childPage.getByRole("button", { name: "Create subfolder" }).click();
  await expect.poll(() => childCaptures.folderCreates.length).toBe(1);
  expect(childCaptures.folderCreates[0]).toEqual(
    expect.objectContaining({
      body: expect.objectContaining({
        parentFolderId: "folder-1",
        expectedVersion: 3,
      }),
      ifMatch: '"folder-3"',
      idempotencyKey: expect.any(String),
    }),
  );
});

test("proposal resubmit and withdraw preserve exact proposal and folder fences", async ({
  page,
}) => {
  await seedSession(page);
  const changedProposal = {
    proposalId: "proposal-1",
    title: "Clarify event image name",
    description: "Use a clearer public-facing name.",
    status: "changes_requested",
    version: 3,
    etag: '"proposal-3"',
    submittedByUserId: "user-1",
    operations: [
      { type: "rename", assetId: "asset-1", name: "FL03 families.jpg" },
    ],
    createdBy: { displayName: "Media Manager" },
  };
  const captures = await mockFiles(page, { proposals: [changedProposal] });
  await page.goto("/files/folders/folder-1?tab=proposals");
  await page.getByRole("button", { name: "Revise & resubmit" }).click();
  await page
    .getByLabel("Revised explanation")
    .fill("The requested name now follows the campaign accessibility guide.");
  await page.getByRole("button", { name: "Return to review" }).click();
  expect(captures.proposalResubmissions[0]).toEqual({
    body: {
      title: "Clarify event image name",
      description:
        "The requested name now follows the campaign accessibility guide.",
      operations: [
        { type: "rename", assetId: "asset-1", name: "FL03 families.jpg" },
      ],
      expectedVersion: 3,
      expectedFolderVersion: 3,
    },
    idempotencyKey: expect.any(String),
    ifMatch: '"proposal-3"',
  });

  await page.getByRole("button", { name: "Withdraw" }).click();
  await page.getByRole("button", { name: "Withdraw proposal" }).click();
  expect(captures.proposalWithdrawals[0]).toEqual({
    body: { expectedVersion: 3 },
    idempotencyKey: expect.any(String),
    ifMatch: '"proposal-3"',
  });
});

test("asset listings resolve exact-version previews in memory and purge them on 403", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "IntersectionObserver");
  });
  await seedSession(page);
  const captures = await mockFiles(page, {
    previewExpiresInSeconds: 1,
    previewForbiddenAfter: 2,
  });
  await page.goto("/files/folders/folder-1");
  await expect.poll(() => captures.previews.length).toBe(2);
  expect(
    captures.requests.filter(({ path }) => path.endsWith("/preview")),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/api/files/assets/asset-1/versions/asset-version-1/preview",
      }),
      expect.objectContaining({
        path: "/api/files/assets/asset-2/versions/asset-version-2/preview",
      }),
    ]),
  );
  await expect(
    page.getByText("Watermarked preview · online only"),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      `${Object.values(localStorage).join(" ")} ${Object.values(sessionStorage).join(" ")}`.includes(
        "signed-preview",
      ),
    ),
  ).toBe(false);

  await expect.poll(() => captures.previews.length).toBeGreaterThan(2);
  await expect(page.locator('img[src*="signed-preview"]')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      `${Object.values(localStorage).join(" ")} ${Object.values(sessionStorage).join(" ")}`.includes(
        "signed-preview",
      ),
    ),
  ).toBe(false);
});

test("host references stay feature-gated and reject invalid query tuples", async ({
  page,
}) => {
  await seedSession(page);
  const captures = await mockFiles(page);
  await page.goto(
    "/files?referenceType=event_recap&hostSourceType=calendar&hostSourceId=calendar-1&hostResourceType=event&hostResourceId=event-1&hostResourceVersion=8",
  );
  await expect(
    page.getByRole("button", { name: "Attach a Files folder" }),
  ).toHaveCount(0);
  expect(
    captures.requests.some(({ path }) =>
      path.startsWith("/api/files/host-references"),
    ),
  ).toBe(false);

  const enabled = workspace();
  enabled.featureFlags.hostReferencesEnabled = true;
  const invalidPage = await page.context().newPage();
  await seedSession(invalidPage);
  const invalidCaptures = await mockFiles(invalidPage, { workspace: enabled });
  await invalidPage.goto(
    "/files?referenceType=event_recap&hostSourceType=messaging&hostSourceId=calendar-1&hostResourceType=event&hostResourceId=event-1&hostResourceVersion=not-a-number",
  );
  await expect(
    invalidPage.getByRole("button", { name: "Attach a Files folder" }),
  ).toHaveCount(0);
  expect(
    invalidCaptures.requests.some(({ path }) =>
      path.startsWith("/api/files/host-references"),
    ),
  ).toBe(false);
});

test("host picker keeps authorized cross-workspace choices and supports safe list and revoke", async ({
  page,
}) => {
  await seedSession(page);
  const enabled = workspace();
  enabled.featureFlags.hostReferencesEnabled = true;
  const otherWorkspaceId = "files:v1:organization:state-party";
  const otherWorkspace = workspace({
    principal: {
      type: "organization",
      sourceType: "organization",
      id: "state-party",
      displayName: "Florida State Party",
    },
  });
  otherWorkspace.featureFlags.hostReferencesEnabled = true;
  const captures = await mockFiles(page, {
    workspace: enabled,
    workspaces: [enabled, otherWorkspace],
    hostPickerItems: [
      {
        folderId: "folder-1",
        name: "Campaign media",
        breadcrumb: "Media / Events",
        filesWorkspaceId: enabled.filesWorkspaceId,
        principal: enabled.principal,
        authorizationRoot: "organization",
        restriction: "standard",
        version: 3,
        etag: '"folder-3"',
        capabilities: { canView: true, canLinkHostReference: true },
        allowedRelationKeys: ["supporting_material"],
        allowedPurposeKeys: ["research"],
      },
      {
        folderId: "party-folder",
        name: "State party event media",
        breadcrumb: "Campaigns / 2026 / Event media",
        filesWorkspaceId: otherWorkspaceId,
        principal: {
          type: "organization",
          id: "state-party",
          displayName: "Florida State Party",
        },
        authorizationRoot: "organization",
        restriction: "standard",
        version: 6,
        etag: '"party-folder-6"',
        capabilities: { canView: true, canLinkHostReference: true },
        allowedRelationKeys: ["supporting_material"],
        allowedPurposeKeys: ["research"],
      },
      {
        folderId: "alias-only-folder",
        name: "Unsafe alias result",
        filesWorkspaceId: "files:v1:organization:unsafe",
        authorizationRoot: "organization",
        version: 1,
        etag: '"unsafe-1"',
        capabilities: { canView: true, canReference: true },
      },
      {
        folderId: "stale-folder",
        name: "Stale result",
        filesWorkspaceId: "files:v1:organization:stale",
        authorizationRoot: "organization",
        status: "stale",
        version: 1,
        etag: '"stale-1"',
        capabilities: { canView: true, canLinkHostReference: true },
      },
    ],
  });
  await page.goto(
    "/files?referenceType=event_recap&hostSourceType=calendar&hostSourceId=calendar-1&hostResourceType=event&hostResourceId=event-1&hostResourceVersion=8",
  );
  await page.getByRole("button", { name: "Attach a Files folder" }).click();
  await expect(
    page.getByText(/Forward Florida · organization · Media/),
  ).toBeVisible();
  await expect(
    page.getByText(/Florida State Party · organization · Campaigns/),
  ).toBeVisible();
  await expect(page.getByText("Unsafe alias result")).toHaveCount(0);
  await expect(page.getByText("Stale result")).toHaveCount(0);
  await page.getByText("State party event media").click();
  await page.getByLabel("Relationship").selectOption("supporting_material");
  await page.getByLabel("Purpose").selectOption("research");
  await page.getByRole("button", { name: "Attach folder" }).click();
  expect(captures.hostReferences[0]).toEqual({
    body: expect.objectContaining({
      referenceType: "event_recap",
      host: {
        sourceType: "calendar",
        sourceId: "calendar-1",
        resourceType: "event",
        resourceId: "event-1",
        resourceVersion: 8,
      },
      files: {
        filesWorkspaceId: otherWorkspaceId,
        folderId: "party-folder",
      },
      relationType: "supporting_material",
      purposeKey: "research",
      expectedFolderVersion: 6,
      expectedHostVersion: 8,
    }),
    idempotencyKey: expect.any(String),
    ifMatch: '"party-folder-6"',
  });
  await expect(
    page.getByText("supporting material", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open linked item" }),
  ).toHaveAttribute("href", "/files/references/host-reference-1");
  await page.getByRole("button", { name: "Revoke link" }).click();
  await page.getByLabel("Reason").fill("The event recap is complete.");
  await page.getByRole("button", { name: "Revoke link" }).last().click();
  expect(captures.hostReferences[1]).toEqual({
    path: "/api/files/host-references/host-reference-1/revoke",
    body: {
      reason: "The event recap is complete.",
      expectedVersion: 1,
      expectedHostVersion: 8,
    },
    idempotencyKey: expect.any(String),
    ifMatch: '"host-reference-1"',
  });
  await expect(page.getByText(/revoked/)).toBeVisible();
});

test("direct host-reference detail is eligible-workspace scoped, keyboard navigable, and mobile safe", async ({
  page,
}) => {
  await seedSession(page);
  const enabled = workspace();
  enabled.featureFlags.hostReferencesEnabled = true;
  const envelope = {
    hostReference: {
      hostReferenceId: "host-reference-direct",
      referenceType: "event_recap",
      host: {
        sourceType: "calendar",
        sourceId: "calendar-1",
        resourceType: "event",
        resourceId: "event-1",
        resourceVersion: 8,
      },
      files: {
        filesWorkspaceId: enabled.filesWorkspaceId,
        folderId: "folder-1",
      },
      relationType: "supporting_material",
      purposeKey: "media",
      status: "active",
      version: 2,
      fileName: "never-render-secret.jpg",
      previewUrl: "https://private.invalid/signed-secret",
      deepLink: {
        route: "/files/references/host-reference-direct",
        params: { hostReferenceId: "host-reference-direct" },
      },
    },
    revision: 2,
    etag: '"host-reference-direct-2"',
  };
  await mockFiles(page, { workspace: enabled, hostReferenceItems: [envelope] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/files/references/host-reference-direct");
  await expect(
    page.getByRole("heading", { name: "Linked Files material" }),
  ).toBeVisible();
  await expect(page.getByText("never-render-secret.jpg")).toHaveCount(0);
  await expect(page.locator('[src*="private.invalid"]')).toHaveCount(0);
  const back = page.getByRole("button", { name: "Back to Files" });
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Everything your team needs—without hunting for it.",
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Linked Files material" }),
  ).toBeVisible();
});

test("direct host-reference detail fails closed for an ineligible workspace", async ({
  page,
}) => {
  await seedSession(page);
  const enabled = workspace();
  enabled.featureFlags.hostReferencesEnabled = true;
  await mockFiles(page, {
    workspace: enabled,
    hostReferenceItems: [
      {
        hostReference: {
          hostReferenceId: "host-reference-foreign",
          referenceType: "event_recap",
          host: {
            sourceType: "calendar",
            sourceId: "calendar-foreign",
            resourceType: "event",
            resourceId: "event-secret",
            resourceVersion: 2,
          },
          files: {
            filesWorkspaceId: "files:v1:organization:not-eligible",
            folderId: "secret-folder",
          },
          relationType: "opposition_research",
          purposeKey: "secret-purpose",
          status: "active",
          version: 1,
        },
        revision: 1,
        etag: '"foreign-1"',
      },
    ],
  });
  await page.goto("/files/references/host-reference-foreign");
  await expect(
    page.getByRole("heading", { name: "Files reference unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("opposition research")).toHaveCount(0);
  await expect(page.getByText("secret purpose")).toHaveCount(0);
});
