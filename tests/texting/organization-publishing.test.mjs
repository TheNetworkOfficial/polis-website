import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

globalThis.document = { addEventListener() {}, hidden: false };
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key),
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { createOrganizationPublishingPage, organizationPostPermissions } =
  await import(await moduleUrl("organizationPublishing"));

function fixture({
  draft,
  permissions = ["posts_submit"],
  handler,
  confirm,
} = {}) {
  let scope = { userId: "actor", scopeType: "coalition", scopeId: "org-one" };
  const calls = [],
    navigations = [];
  const page = createOrganizationPublishingPage({
    context: () => scope,
    changed() {},
    navigate: (path) => navigations.push(path),
    confirm,
    request: async (path, options = {}) => {
      calls.push({ path, ...options });
      const custom = await handler?.(path, options);
      if (custom !== undefined) return custom;
      if (path === "/api/me/organization-workspaces")
        return {
          workspaces: [
            { ...scope, permissions, displayName: "Community Alliance" },
          ],
        };
      if (path.endsWith("/audience-groups"))
        return { groups: [{ groupId: "neighbors", name: "Neighbors" }] };
      if (path.endsWith("/social/connections")) return { connections: [] };
      if (path.endsWith("/preview"))
        return {
          url: "https://example.test/asset",
          contentType: "image/png",
          expiresInSeconds: 300,
        };
      if (options.method === "POST" || options.method === "PATCH")
        return { draft: { ...draft, draftId: "saved", version: 5 } };
      if (path.endsWith("/post-drafts/draft-one")) return { draft };
      return { drafts: [] };
    },
  });
  return {
    page,
    calls,
    navigations,
    switchActor() {
      scope = { ...scope, userId: "other" };
    },
  };
}

test("organization action respects roles and reviewing another author", async () => {
  assert.equal(
    organizationPostPermissions({ permissions: ["posts_submit"] }).direct,
    false,
  );
  const f = fixture({
    draft: {
      draftId: "draft-one",
      version: 4,
      state: "pending_approval",
      actorUserId: "writer",
      content: { type: "image", imageUrl: "https://example.test/photo" },
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer, { draftId: "draft-one" });
  assert.equal(f.page.composerAction(composer), "");
  composer.organization.permissions = organizationPostPermissions({
    permissions: ["posts_approve_manage"],
  });
  assert.equal(f.page.composerAction(composer), "approve");
  await f.page.draftAction("reject", "Please correct the date");
  const write = f.calls.find((c) => c.path.endsWith("/reject"));
  assert.equal(write.body.expectedVersion, 4);
  assert.equal(write.body.expectedActorUserId, "actor");
  assert.equal(write.body.reason, "Please correct the date");
  f.page.reset();
});

test("discarding an unresolved retry is explicit and never deletes a server draft", async () => {
  storage.clear();
  let approved = false,
    confirmation;
  const f = fixture({
    confirm: async (options) => {
      confirmation = options;
      return approved;
    },
    handler: async (path, options) => {
      if (options.method === "POST") throw new Error("Connection lost");
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer);
  await assert.rejects(
    f.page.saveComposer(composer, {
      type: "image",
      imageUrl: "https://example.test/image",
    }),
    /Connection lost/,
  );
  await f.page.discardRetry();
  assert.equal(storage.size, 1);
  approved = true;
  await f.page.discardRetry();
  assert.equal(storage.size, 0);
  assert.match(confirmation.message, /Any draft already saved remains/);
  assert.equal(
    f.calls.some((c) => c.method === "DELETE"),
    false,
  );
  f.page.reset();
});

test("refreshing expired Files previews keeps unsaved caption and pinned version", async () => {
  const f = fixture({
    draft: {
      draftId: "draft-one",
      version: 4,
      state: "editing",
      actorUserId: "actor",
      content: {
        description: "Saved caption",
        mediaItems: [{ assetId: "a", sourceAssetVersionId: "v1" }],
      },
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer, { draftId: "draft-one" });
  composer.description = "Unsaved correction";
  composer.organizationMedia[0].expiresAt = 0;
  await f.page.draftAction("refresh-media");
  assert.equal(composer.description, "Unsaved correction");
  assert.ok(composer.organizationMedia[0].expiresAt > Date.now());
  assert.equal(
    f.calls.filter((c) => c.path.endsWith("/versions/v1/preview")).length,
    2,
  );
  f.page.reset();
});

test("review saves preserve a scheduled crosspost and edited destination metadata", async () => {
  storage.clear();
  const scheduledAt = 1893456000000;
  const f = fixture({
    draft: {
      draftId: "draft-one",
      version: 4,
      state: "editing",
      actorUserId: "actor",
      content: {
        type: "image",
        crosspostDraft: {
          scheduledAt,
          youtubeTitle: "Old title",
          youtubeDescription: "Old details",
        },
      },
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer, { draftId: "draft-one" });
  await f.page.saveComposer(composer, {
    type: "image",
    crosspostSelections: [
      { provider: "youtube", connectionId: "channel", targetId: "target" },
    ],
    crosspostDraft: {
      youtubeTitle: "Corrected title",
      youtubeDescription: "Corrected details",
    },
  });
  const saved = f.calls.find((c) => c.method === "PATCH").body.crosspostDraft;
  assert.equal(saved.scheduledAt, scheduledAt);
  assert.equal(saved.youtubeTitle, "Corrected title");
  assert.equal(saved.youtubeDescription, "Corrected details");
  assert.match(f.page.renderDraftActions(composer), /Crosspost scheduled/);
  f.page.reset();
});

test("Files drafts retain pinned references and submit with returned revision", async () => {
  storage.clear();
  const items = [
    {
      assetId: "asset",
      sourceAssetVersionId: "pinned",
      altText: "Door hanger",
    },
  ];
  const f = fixture({
    draft: {
      draftId: "draft-one",
      version: 4,
      state: "editing",
      actorUserId: "actor",
      content: { type: "image", mediaItems: items },
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer, { draftId: "draft-one" });
  assert.match(
    f.calls.find((c) => c.path.endsWith("/preview")).path,
    /versions\/pinned\/preview$/,
  );
  await f.page.saveComposer(
    composer,
    { ...composer.existingContent, description: "Ready", visibility: "public" },
    "submit",
  );
  const patch = f.calls.find((c) => c.method === "PATCH");
  assert.equal(patch.body.mediaItems, undefined);
  assert.equal(patch.body.expectedVersion, 4);
  assert.equal(
    f.calls.find((c) => c.path.endsWith("/submit")).body.expectedVersion,
    5,
  );
  assert.deepEqual(composer.existingContent.mediaItems, items);
  assert.deepEqual(f.navigations, [
    "/workspace/coalition/org-one/work/publishing",
  ]);
  assert.equal(storage.size, 0);
  f.page.reset();
});

test("a changed actor prevents post action after the save request", async () => {
  storage.clear();
  let f;
  f = fixture({
    handler: async (path, options) => {
      if (options.method === "POST" && path.endsWith("/post-drafts")) {
        f.switchActor();
        return { draft: { draftId: "saved", version: 1 } };
      }
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer);
  await assert.rejects(
    f.page.saveComposer(
      composer,
      {
        type: "image",
        imageUrl: "https://example.test/new",
        visibility: "public",
      },
      "submit",
    ),
    /active account changed/,
  );
  assert.equal(
    f.calls.some((c) => c.path.endsWith("/submit")),
    false,
  );
  assert.equal(storage.size, 1);
  assert.deepEqual(f.navigations, []);
  f.page.reset();
  storage.clear();
});

test("failed media needs replacement and Files failures open recovery", async () => {
  storage.clear();
  const draft = {
    draftId: "draft-one",
    version: 4,
    state: "publication_failed",
    actorUserId: "actor",
    publicationError: { message: "Replace failed media" },
    content: { type: "video", cfUid: "old" },
  };
  const f = fixture({ draft });
  const composer = {};
  await f.page.prepareComposer(composer, { draftId: "draft-one" });
  await assert.rejects(
    f.page.saveComposer(composer, composer.existingContent),
    /Replace the failed media/,
  );
  assert.equal(
    composer.organization.publicationError.message,
    "Replace failed media",
  );
  composer.file = { name: "replacement.mp4" };
  await f.page.saveComposer(composer, { type: "video", cfUid: "new" });
  f.page.reset();
  const files = fixture({
    draft: {
      ...draft,
      content: {
        type: "image",
        mediaItems: [{ assetId: "a", sourceAssetVersionId: "v" }],
      },
    },
  });
  const filesComposer = {};
  await files.page.prepareComposer(filesComposer, { draftId: "draft-one" });
  assert.equal(filesComposer.organization.readOnly, true);
  assert.match(
    files.page.renderDraftActions(filesComposer),
    /Replace source in Files/,
  );
  files.page.reset();
});

test("optional setup failure preserves draft and blocks unavailable custom audience", async () => {
  const f = fixture({
    draft: {
      draftId: "draft-one",
      version: 4,
      actorUserId: "actor",
      content: {
        type: "image",
        visibility: "custom",
        audienceGroupIds: ["neighbors"],
      },
    },
    handler: async (path) => {
      if (
        path.endsWith("/audience-groups") ||
        path.endsWith("/social/connections")
      )
        throw new Error("temporarily unavailable");
    },
  });
  const composer = {};
  await f.page.prepareComposer(composer, { draftId: "draft-one" });
  assert.ok(composer.organization);
  assert.equal(composer.visibility, "custom");
  await assert.rejects(
    f.page.saveComposer(composer, composer.existingContent),
    /available organization audience/,
  );
  assert.equal(
    f.calls.some((c) => c.method === "PATCH"),
    false,
  );
  f.page.reset();
});

test("draft pagination uses scoped cursor, deduplicates boundaries and refresh resets cursor", async () => {
  let first = 0;
  const f = fixture({
    handler: async (path) => {
      if (path.includes("/post-drafts?")) {
        if (path.includes("cursor="))
          return {
            drafts: [
              { draftId: "a", state: "editing" },
              { draftId: "b", state: "editing" },
            ],
            nextCursor: null,
          };
        first++;
        return {
          drafts: [{ draftId: "a", state: "editing" }],
          nextCursor: "opaque token",
        };
      }
    },
  });
  await f.page.load();
  assert.match(f.page.render(), /Load more drafts/);
  await f.page.load({ more: true });
  assert.equal((f.page.render().match(/Open draft/g) || []).length, 2);
  assert.doesNotMatch(f.page.render(), /Load more drafts/);
  assert.ok(f.calls.some((c) => c.path.includes("cursor=opaque%20token")));
  await f.page.load({ force: true });
  assert.equal(first, 2);
  f.page.reset();
});
