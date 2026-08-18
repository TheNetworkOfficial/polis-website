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
  return {
    filesWorkspaceId: `files:v1:${workspacePrincipal.type}:${workspacePrincipal.id}`,
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
    },
    featureFlags: {
      filesEnabled: true,
      uploadsEnabled: true,
      automationsEnabled: true,
      aiSuggestionsEnabled: true,
      postProvenanceEnabled: true,
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
    },
    setup: { initialized, presetKey: initialized ? "independent_org" : null },
    revision: 9,
    roots: [
      {
        folderId: "folder-1",
        entityType: "folder",
        name: "Florida House District 3",
        description: "Current district research",
        itemCount: 2,
      },
      {
        folderId: "folder-2",
        entityType: "folder",
        name: "Field plans",
        description: "Canvass and organizing plans",
        itemCount: 0,
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

async function mockFiles(page, overrides = {}) {
  const currentWorkspace = overrides.workspace || workspace();
  const sourceType =
    currentWorkspace.principal.sourceType || currentWorkspace.principal.type;
  const sourceId =
    sourceType === "official"
      ? currentWorkspace.principal.sourceId
      : currentWorkspace.principal.id;
  const folderAccess = overrides.folderAccess || {
    shared: false,
    permissions: currentWorkspace.permissions,
    capabilities: currentWorkspace.capabilities,
    grantId: null,
    accessTier: "owner",
    currentMainOnly: false,
  };
  let uploadStatusIndex = 0;
  let uploadIntent = "commit";
  let uploadProposal = null;
  const signedUploadAttempts = new Map();
  const captures = {
    grants: [],
    proposals: [],
    proposalCreates: [],
    posts: [],
    uploads: [],
    uploadPartHeaders: [],
    signedUploadParts: [],
    uploadAborts: [],
    settings: [],
    suggestions: [],
    folders: [],
    archives: [],
    editions: [],
    grantRequests: [],
    initializations: [],
    requests: [],
  };
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
    captures.requests.push({ path, method, body });
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
      return json(route, { ok: true, workspaces: [currentWorkspace] });
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
      currentWorkspace.setup = { initialized: true, presetKey: body.presetKey };
      return json(route, { ok: true, workspace: currentWorkspace });
    }
    if (path.endsWith("/settings") && method === "PUT") {
      captures.settings.push(body);
      return json(route, { ok: true, settings: body.settings });
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
        suggestions: [
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
        suggestion: { id: "suggestion-1", status: action },
        ...(action === "disable"
          ? { folder: { ...folder, settings: { inheritWorkspace: false } } }
          : {}),
      });
    }
    if (path === "/api/files/folders/folder-1" && method === "GET") {
      return json(route, {
        ok: true,
        folder: overrides.folder || folder,
        access: folderAccess,
        version: (overrides.folder || folder).version,
      });
    }
    if (path === "/api/files/folders/folder-1" && method === "PATCH") {
      captures.folders.push(body);
      return json(route, { ok: true, folder: { ...folder, ...body } });
    }
    if (path === "/api/files/folders/folder-1/archive" && method === "POST") {
      captures.archives.push({ path, body, idempotencyKey });
      return json(route, {
        ok: true,
        folder: { ...folder, status: "archived", version: 4 },
      });
    }
    if (path.endsWith("/assets") && method === "GET") {
      return json(route, { ok: true, assets: overrides.assets || assets });
    }
    if (path.endsWith("/editions") && method === "GET") {
      return json(route, {
        ok: true,
        editions: [
          {
            id: "edition-2026",
            name: "2026 cycle",
            status: "current",
            isCurrent: true,
          },
          { id: "edition-2024", name: "2024 cycle", status: "archived" },
        ],
      });
    }
    if (path.endsWith("/editions") && method === "POST") {
      captures.editions.push(body);
      return json(route, {
        ok: true,
        edition: { editionId: "edition-new", state: "draft", ...body },
      });
    }
    if (path.endsWith("/proposals") && method === "GET") {
      return json(route, {
        ok: true,
        proposals: [
          {
            proposalId: "proposal-1",
            title: "Replace precinct contact sheet",
            summary: "Use the certified 2026 contacts.",
            status: "pending",
            version: 2,
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
          url: `http://127.0.0.1:9000/signed-upload/part-${part.partNumber}`,
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
    page.getByRole("button", { name: "Start new edition" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Archive folder" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start new edition" }).first().click();
  await page.getByLabel("Edition label").fill("2028 district cycle");
  await page.getByLabel("Edition type").selectOption("election_cycle");
  await page.getByLabel("Effective year").fill("2028");
  await page.getByLabel("Election cycle").fill("2028");
  await page.getByLabel("Boundary vintage").fill("2024");
  await page.getByLabel("Effective from").fill("2027-11-03");
  await page.getByLabel("Effective through").fill("2028-11-07");
  await page.getByRole("button", { name: "Create edition" }).click();
  expect(captures.editions[0]).toEqual({
    label: "2028 district cycle",
    type: "election_cycle",
    effectiveYear: "2028",
    cycle: "2028",
    boundaryVintage: "2024",
    effectiveFrom: "2027-11-03",
    effectiveTo: "2028-11-07",
    expectedVersion: 3,
  });

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

  await page.getByRole("button", { name: "Proposals" }).click();
  await page.getByRole("button", { name: "Approve & merge" }).click();
  await page.getByLabel(/Review note/).fill("Certified contacts verified.");
  await page.getByRole("button", { name: "Approve & merge" }).last().click();
  expect(captures.proposals[0]).toEqual(
    expect.objectContaining({ decision: "approve", expectedVersion: "2" }),
  );
  await page.getByRole("button", { name: "Request changes" }).click();
  await page
    .getByLabel(/Review note/)
    .fill("Please attach the certification source.");
  await page.getByRole("button", { name: "Send change request" }).click();
  expect(captures.proposals[1]).toEqual(
    expect.objectContaining({
      decision: "request_changes",
      expectedVersion: "2",
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

  await page.getByRole("button", { name: "Access" }).click();
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
  releaseUpload();
});

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
    },
  });
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
    },
    expectedVersion: 9,
  });
  expect(captures.settings[0].settings).not.toHaveProperty(
    "aiSuggestionsEnabled",
  );
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
      body: { expectedVersion: "7" },
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
