import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL(
  "../../frontend/src/pages/files/scripts/filesApi.js",
  import.meta.url,
);
const source = (await readFile(sourceUrl, "utf8")).replace(
  /import \{ buildAuthorizedHeaders \} from "[^\n]+";/u,
  "const buildAuthorizedHeaders = (_session, headers = {}) => headers;",
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { FilesApi, FilesApiError } = await import(moduleUrl);

function response(body = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mutationOptions(key, etag = '"revision"') {
  return {
    idempotencyKey: key,
    headers: { "If-Match": etag },
  };
}

test("every Files mutation carries a stable retry key and exact revision fences", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), ...options });
    return response();
  };
  try {
    const api = new FilesApi({
      apiBaseUrl: "https://api.polis.test",
      getSession: () => null,
    });
    const cases = [
      {
        name: "setup",
        call: () =>
          api.initializeWorkspace(
            "organization",
            "org-1",
            { presetKey: "blank", expectedVersion: 0 },
            mutationOptions("setup-1", '"workspace-0"'),
          ),
        path: "/api/files/workspaces/organization/org-1/initialize",
        method: "POST",
        body: { presetKey: "blank", expectedVersion: 0 },
        key: "setup-1",
        etag: '"workspace-0"',
      },
      {
        name: "settings",
        call: () =>
          api.updateSettings(
            "organization",
            "org-1",
            { settings: { version: 1 }, expectedVersion: 9 },
            mutationOptions("settings-1", '"workspace-9"'),
          ),
        path: "/api/files/workspaces/organization/org-1/settings",
        method: "PUT",
        body: { settings: { version: 1 }, expectedVersion: 9 },
        key: "settings-1",
        etag: '"workspace-9"',
      },
      ...[
        ["root folder", {}, "root-folder-1"],
        ["child folder", { parentFolderId: "folder-1" }, "child-folder-1"],
      ].map(([name, extra, key]) => ({
        name,
        call: () =>
          api.createFolder(
            "organization",
            "org-1",
            { name: name, ...extra, expectedVersion: 9 },
            mutationOptions(key, '"target-9"'),
          ),
        path: "/api/files/workspaces/organization/org-1/folders",
        method: "POST",
        body: { name: name, ...extra, expectedVersion: 9 },
        key,
        etag: '"target-9"',
      })),
      {
        name: "folder update",
        call: () =>
          api.updateFolder(
            "folder-1",
            { name: "Current", expectedVersion: 3 },
            mutationOptions("folder-update-1", '"folder-3"'),
          ),
        path: "/api/files/folders/folder-1",
        method: "PATCH",
        body: { name: "Current", expectedVersion: 3 },
        key: "folder-update-1",
        etag: '"folder-3"',
      },
      {
        name: "folder archive",
        call: () =>
          api.archiveFolder(
            "folder-1",
            { reason: "Superseded", expectedVersion: 3 },
            mutationOptions("folder-archive-1", '"folder-3"'),
          ),
        path: "/api/files/folders/folder-1/archive",
        method: "POST",
        body: { reason: "Superseded", expectedVersion: 3 },
        key: "folder-archive-1",
        etag: '"folder-3"',
      },
      {
        name: "proposal create",
        call: () =>
          api.createProposal(
            "folder-1",
            {
              operations: [
                {
                  type: "move",
                  assetId: "asset-1",
                  destinationFolderId: "folder-2",
                },
              ],
              expectedVersion: 3,
              expectedDestinationFolderVersions: { "folder-2": 4 },
            },
            mutationOptions("proposal-create-1", '"folder-3"'),
          ),
        path: "/api/files/folders/folder-1/proposals",
        method: "POST",
        body: {
          operations: [
            {
              type: "move",
              assetId: "asset-1",
              destinationFolderId: "folder-2",
            },
          ],
          expectedVersion: 3,
          expectedDestinationFolderVersions: { "folder-2": 4 },
        },
        key: "proposal-create-1",
        etag: '"folder-3"',
      },
      {
        name: "proposal review",
        call: () =>
          api.reviewProposal(
            "proposal-1",
            {
              decision: "approve",
              expectedVersion: 2,
              expectedFolderVersion: 3,
              expectedDestinationFolderVersions: { "folder-2": 4 },
            },
            mutationOptions("proposal-review-1", '"proposal-2"'),
          ),
        path: "/api/files/proposals/proposal-1/approvals",
        method: "POST",
        body: {
          decision: "approve",
          expectedVersion: 2,
          expectedFolderVersion: 3,
          expectedDestinationFolderVersions: { "folder-2": 4 },
        },
        key: "proposal-review-1",
        etag: '"proposal-2"',
      },
      {
        name: "proposal resubmit",
        call: () =>
          api.resubmitProposal(
            "proposal-1",
            {
              title: "Revised",
              operations: [
                { type: "rename", assetId: "asset-1", name: "Current.jpg" },
              ],
              expectedVersion: 3,
              expectedFolderVersion: 3,
            },
            mutationOptions("proposal-resubmit-1", '"proposal-3"'),
          ),
        path: "/api/files/proposals/proposal-1",
        method: "PATCH",
        body: {
          title: "Revised",
          operations: [
            { type: "rename", assetId: "asset-1", name: "Current.jpg" },
          ],
          expectedVersion: 3,
          expectedFolderVersion: 3,
        },
        key: "proposal-resubmit-1",
        etag: '"proposal-3"',
      },
      {
        name: "proposal withdraw",
        call: () =>
          api.withdrawProposal(
            "proposal-1",
            { expectedVersion: 3 },
            mutationOptions("proposal-withdraw-1", '"proposal-3"'),
          ),
        path: "/api/files/proposals/proposal-1/withdraw",
        method: "POST",
        body: { expectedVersion: 3 },
        key: "proposal-withdraw-1",
        etag: '"proposal-3"',
      },
      {
        name: "edition start",
        call: () =>
          api.startEdition(
            "folder-1",
            {
              label: "2028 cycle",
              type: "election_cycle",
              archiveCurrent: true,
              expectedVersion: 3,
              expectedCurrentEditionVersion: 7,
            },
            mutationOptions("edition-start-1", '"folder-3"'),
          ),
        path: "/api/files/folders/folder-1/editions/start",
        method: "POST",
        body: {
          label: "2028 cycle",
          type: "election_cycle",
          archiveCurrent: true,
          expectedVersion: 3,
          expectedCurrentEditionVersion: 7,
        },
        key: "edition-start-1",
        etag: '"folder-3"',
      },
      {
        name: "edition restore",
        call: () =>
          api.restoreEdition(
            "edition-2024",
            {
              archiveCurrent: true,
              expectedVersion: 5,
              expectedFolderVersion: 3,
              expectedCurrentEditionVersion: 7,
            },
            mutationOptions("edition-restore-1", '"edition-5"'),
          ),
        path: "/api/files/editions/edition-2024/restore",
        method: "POST",
        body: {
          archiveCurrent: true,
          expectedVersion: 5,
          expectedFolderVersion: 3,
          expectedCurrentEditionVersion: 7,
        },
        key: "edition-restore-1",
        etag: '"edition-5"',
      },
      {
        name: "edition archive",
        call: () =>
          api.archiveEdition(
            "edition-2026",
            { expectedVersion: 7, expectedFolderVersion: 3 },
            mutationOptions("edition-archive-1", '"edition-7"'),
          ),
        path: "/api/files/editions/edition-2026/archive",
        method: "POST",
        body: { expectedVersion: 7, expectedFolderVersion: 3 },
        key: "edition-archive-1",
        etag: '"edition-7"',
      },
      {
        name: "grant create",
        call: () =>
          api.createGrant(
            "folder-1",
            { recipientUserIds: ["user-2"], expectedVersion: 3 },
            mutationOptions("grant-create-1", '"folder-3"'),
          ),
        path: "/api/files/folders/folder-1/grants",
        method: "POST",
        body: { recipientUserIds: ["user-2"], expectedVersion: 3 },
        key: "grant-create-1",
        etag: '"folder-3"',
      },
      {
        name: "grant action",
        call: () =>
          api.changeGrant(
            "grant-1",
            "revoke",
            { expectedVersion: 2 },
            mutationOptions("grant-revoke-1", '"grant-2"'),
          ),
        path: "/api/files/grants/grant-1/revoke",
        method: "POST",
        body: { expectedVersion: 2 },
        key: "grant-revoke-1",
        etag: '"grant-2"',
      },
      {
        name: "suggestion action",
        call: () =>
          api.changeSuggestion(
            "suggestion-1",
            "snooze",
            { expectedVersion: 4, snoozedUntil: "2026-08-24T00:00:00.000Z" },
            mutationOptions("suggestion-snooze-1", '"suggestion-4"'),
          ),
        path: "/api/files/suggestions/suggestion-1/snooze",
        method: "POST",
        body: { expectedVersion: 4, snoozedUntil: "2026-08-24T00:00:00.000Z" },
        key: "suggestion-snooze-1",
        etag: '"suggestion-4"',
      },
      {
        name: "upload initiate",
        call: () =>
          api.createUploadSession(
            "folder-1",
            { fileName: "photo.jpg", size: 4, expectedVersion: 3 },
            mutationOptions("upload-initiate-1", '"folder-3"'),
          ),
        path: "/api/files/folders/folder-1/upload-sessions",
        method: "POST",
        body: { fileName: "photo.jpg", size: 4, expectedVersion: 3 },
        key: "upload-initiate-1",
        etag: '"folder-3"',
      },
      ...[
        [
          "presign",
          "parts:presign",
          { parts: [{ partNumber: 1 }], expectedVersion: 1 },
        ],
        [
          "checkpoint",
          "parts",
          { parts: [{ partNumber: 1, etag: '"part"' }], expectedVersion: 2 },
        ],
        [
          "complete",
          "complete",
          { parts: [{ partNumber: 1, etag: '"part"' }], expectedVersion: 3 },
        ],
        ["abort", "abort", { expectedVersion: 3 }],
      ].map(([name, suffix, body], index) => ({
        name: `upload ${name}`,
        call: () => {
          const methods = [
            api.presignUploadParts.bind(api),
            api.checkpointUploadParts.bind(api),
            api.completeUpload.bind(api),
            api.abortUpload.bind(api),
          ];
          return methods[index](
            "upload-1",
            body,
            mutationOptions(`upload-${name}-1`, '"upload-session"'),
          );
        },
        path: `/api/files/upload-sessions/upload-1/${suffix}`,
        method: "POST",
        body,
        key: `upload-${name}-1`,
        etag: '"upload-session"',
      })),
      {
        name: "post draft",
        call: () =>
          api.createPostDraft(
            {
              folderId: "folder-1",
              expectedFolderVersion: 3,
              expectedAssetVersions: { "asset-1": 5 },
              mediaItems: [
                {
                  assetId: "asset-1",
                  sourceAssetVersionId: "version-1",
                  mediaType: "image",
                  order: 0,
                },
              ],
            },
            mutationOptions("post-draft-1", '"folder-3"'),
          ),
        path: "/api/files/post-drafts",
        method: "POST",
        body: {
          folderId: "folder-1",
          expectedFolderVersion: 3,
          expectedAssetVersions: { "asset-1": 5 },
          mediaItems: [
            {
              assetId: "asset-1",
              sourceAssetVersionId: "version-1",
              mediaType: "image",
              order: 0,
            },
          ],
        },
        key: "post-draft-1",
        etag: '"folder-3"',
      },
      {
        name: "host reference create",
        call: () =>
          api.createHostReference(
            {
              referenceType: "event_recap",
              expectedFolderVersion: 3,
              expectedHostVersion: 8,
            },
            mutationOptions("host-create-1", '"folder-3"'),
          ),
        path: "/api/files/host-references",
        method: "POST",
        body: {
          referenceType: "event_recap",
          expectedFolderVersion: 3,
          expectedHostVersion: 8,
        },
        key: "host-create-1",
        etag: '"folder-3"',
      },
      {
        name: "host reference update",
        call: () =>
          api.updateHostReference(
            "reference-1",
            { purposeKey: "media", expectedVersion: 2, expectedHostVersion: 8 },
            mutationOptions("host-update-1", '"reference-2"'),
          ),
        path: "/api/files/host-references/reference-1",
        method: "PATCH",
        body: {
          purposeKey: "media",
          expectedVersion: 2,
          expectedHostVersion: 8,
        },
        key: "host-update-1",
        etag: '"reference-2"',
      },
      {
        name: "host reference revoke",
        call: () =>
          api.revokeHostReference(
            "reference-1",
            {
              reason: "Superseded",
              expectedVersion: 2,
              expectedHostVersion: 8,
            },
            mutationOptions("host-revoke-1", '"reference-2"'),
          ),
        path: "/api/files/host-references/reference-1/revoke",
        method: "POST",
        body: {
          reason: "Superseded",
          expectedVersion: 2,
          expectedHostVersion: 8,
        },
        key: "host-revoke-1",
        etag: '"reference-2"',
      },
    ];

    for (const expected of cases) {
      const index = requests.length;
      await expected.call();
      const actual = requests[index];
      assert.equal(new URL(actual.url).pathname, expected.path, expected.name);
      assert.equal(actual.method, expected.method, expected.name);
      assert.deepEqual(JSON.parse(actual.body), expected.body, expected.name);
      assert.equal(
        actual.headers["Idempotency-Key"],
        expected.key,
        expected.name,
      );
      assert.equal(actual.headers["If-Match"], expected.etag, expected.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request-scoped preparation freezes UI mutations without intercepting concurrent upload keys or reads", async () => {
  const requests = [];
  const preparedRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), ...options });
    return response();
  };
  try {
    const api = new FilesApi({
      apiBaseUrl: "https://api.polis.test",
      getSession: () => null,
    });
    const prepareMutation = (request) => {
      preparedRequests.push(structuredClone(request));
      return {
        ...request,
        body: { ...request.body, reason: "Frozen note" },
        headers: { "If-Match": '"frozen-version"' },
        idempotencyKey: "ui-request-key",
      };
    };
    await Promise.all([
      api.archiveFolder(
        "folder/a",
        { expectedVersion: 3, reason: "Original note" },
        { prepareMutation, headers: { "If-Match": '"original-version"' } },
      ),
      api.abortUpload(
        "upload-1",
        { expectedVersion: 4 },
        { idempotencyKey: "upload-only-key" },
      ),
      api.request("/api/files/folders/folder-a", { prepareMutation }),
    ]);
    assert.equal(preparedRequests.length, 1);
    assert.deepEqual(preparedRequests[0], {
      path: "https://api.polis.test/api/files/folders/folder%2Fa/archive",
      method: "POST",
      body: { expectedVersion: 3, reason: "Original note" },
      headers: { "If-Match": '"original-version"' },
    });
    const ui = requests.find((request) => request.url.endsWith("/archive"));
    assert.deepEqual(JSON.parse(ui.body), {
      expectedVersion: 3,
      reason: "Frozen note",
    });
    assert.equal(ui.headers["If-Match"], '"frozen-version"');
    assert.equal(ui.headers["Idempotency-Key"], "ui-request-key");
    assert.equal(
      requests.find((request) => request.url.endsWith("/abort")).headers[
        "Idempotency-Key"
      ],
      "upload-only-key",
    );
    assert.equal(
      requests.find((request) => request.method === "GET").headers[
        "Idempotency-Key"
      ],
      undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unreadable mutation success receipts stay uncertain without changing read or error contracts", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const api = new FilesApi({ getSession: () => null });
    for (const fixture of [
      { body: '{"ok":' },
      { body: "null" },
      { body: "[]" },
      { body: '"ok"' },
      { body: "{}" },
      { body: "<html>Unavailable</html>", contentType: "text/html" },
      { body: null, status: 204 },
    ]) {
      globalThis.fetch = async () =>
        new Response(fixture.body, {
          status: fixture.status || 200,
          headers: {
            "content-type": fixture.contentType || "application/json",
          },
        });
      await assert.rejects(
        api.archiveFolder(
          "folder-1",
          { expectedVersion: 3 },
          { idempotencyKey: "unchanged-key" },
        ),
        (error) =>
          error instanceof FilesApiError &&
          error.code === "files_mutation_receipt_unconfirmed",
      );
    }
    globalThis.fetch = async () =>
      new Response('{"ok":', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    assert.deepEqual(await api.getFolder("folder-1"), { ok: true });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ ok: false, error: "files_version_conflict" }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(
      api.archiveFolder(
        "folder-1",
        { expectedVersion: 3 },
        { idempotencyKey: "unchanged-key" },
      ),
      (error) =>
        error.status === 409 && error.code === "files_version_conflict",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the Files transport fails closed before fetch without a retry key or revision", async () => {
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return response();
  };
  try {
    const api = new FilesApi({ getSession: () => null });
    await assert.rejects(
      api.archiveFolder("folder-1", { expectedVersion: 3 }),
      (error) =>
        error instanceof FilesApiError &&
        error.code === "idempotency_key_required",
    );
    await assert.rejects(
      api.archiveFolder(
        "folder-1",
        { reason: "No fence" },
        { idempotencyKey: "archive-without-version" },
      ),
      (error) =>
        error instanceof FilesApiError &&
        error.code === "expected_version_required",
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("edition materialization status is a no-store manager read", async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    request = { url: String(url), ...options };
    return response({
      materialization: {
        materializationId: "materialization-1",
        mode: "restore",
        status: "pending",
        version: 1,
      },
    });
  };
  try {
    const api = new FilesApi({
      apiBaseUrl: "https://api.polis.test",
      getSession: () => null,
    });
    await api.getEditionMaterialization("materialization-1");
    assert.equal(
      new URL(request.url).pathname,
      "/api/files/edition-materializations/materialization-1",
    );
    assert.equal(request.method, "GET");
    assert.equal(request.cache, "no-store");
    assert.equal(request.body, undefined);
    assert.equal(request.headers["Idempotency-Key"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
