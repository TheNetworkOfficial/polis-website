import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const navigationSource = await readFile(
  new URL(
    "../frontend/src/pages/shared-feed/scripts/workspaceNavigation.js",
    import.meta.url,
  ),
  "utf8",
);
const navigationUrl = moduleUrl(navigationSource);
const navigation = await import(navigationUrl);
const filesSource = (
  await readFile(
    new URL(
      "../frontend/src/pages/files/scripts/filesWorkspaceNavigation.js",
      import.meta.url,
    ),
    "utf8",
  )
).replace(
  '"../../shared-feed/scripts/workspaceNavigation.js"',
  JSON.stringify(navigationUrl),
);
const files = await import(moduleUrl(filesSource));
const origin = "https://polis.example.test";
const scope = { scopeType: "coalition", scopeId: "civic-team" };
const descriptor = {
  filesWorkspaceId: "files:v1:organization:civic-team",
  principal: { type: "organization", id: "civic-team" },
};
const payload = {
  coalition: {
    coalitionId: "civic-team",
    name: "Civic Team",
    voterMapEnabled: true,
  },
  membership: { roleKey: "member", status: "active", permissions: [] },
};
const options = { scope, descriptor, payload, actorId: "current-person" };

test("explicit organization routes retain their owner instead of trusting conflicting query hints", () => {
  const conflicting =
    "?organizationScopeType=coalition&organizationScopeId=another-team";
  for (const path of [
    "/coalitions/civic-team/missions",
    "/organizations/civic-team/texting/inbox",
    "/workspace/coalition/civic-team/work/publishing/new",
    "/messages/servers/coalition/civic-team/channels",
  ])
    assert.deepEqual(
      navigation.workspaceNavigationScope(path, conflicting),
      scope,
    );
  assert.deepEqual(
    navigation.workspaceNavigationScope(
      "/candidate-dashboard/campaign-one",
      conflicting,
    ),
    { scopeType: "candidate", scopeId: "campaign-one" },
  );
  const campaignScope = { scopeType: "candidate", scopeId: "campaign-one" };
  const chooser = new URL(
    navigation.withWorkspaceNavigationScope(
      "/candidate-dashboard",
      campaignScope,
      origin,
    ),
    origin,
  );
  assert.deepEqual(
    navigation.workspaceNavigationScope(chooser.pathname, chooser.search),
    campaignScope,
  );
  const frame = navigation.renderWorkspaceNavigationFrame({
    scope: campaignScope,
    name: "Campaign One",
  });
  assert.match(
    frame,
    /data-route="\/candidate-dashboard">All campaigns<\/button>/u,
  );
  assert.doesNotMatch(frame, />All coalitions</u);
});

test("plain consumer routes have no workspace and malformed scope hints cannot activate one", () => {
  for (const path of [
    "/feed",
    "/files",
    "/search",
    "/coalitions",
    "/candidate-dashboard",
  ])
    assert.equal(navigation.workspaceNavigationScope(path), null);
  for (const [path, query] of [
    ["/coalitions/civic%2Fteam", ""],
    ["/workspace/coalition/%00bad/work/publishing", ""],
    ["/coalitions/%E0%A4%A", ""],
    [
      "/files",
      "?organizationScopeType=organization&organizationScopeId=civic-team",
    ],
    ["/files", "?organizationScopeType=coalition&organizationScopeId="],
    [
      "/files",
      "?organizationScopeType=coalition&organizationScopeId=bad%5Cteam",
    ],
  ])
    assert.equal(navigation.workspaceNavigationScope(path, query), null);
});

test("shared detail links preserve workspace context, their existing query and hash", () => {
  const result = navigation.withWorkspaceNavigationScope(
    "/profile/notifications?filter=unread#today",
    scope,
    origin,
  );
  const url = new URL(result, origin);
  assert.equal(url.pathname, "/profile/notifications");
  assert.equal(url.searchParams.get("filter"), "unread");
  assert.equal(url.searchParams.get("organizationScopeType"), "coalition");
  assert.equal(url.searchParams.get("organizationScopeId"), "civic-team");
  assert.equal(url.hash, "#today");
  const post = new URL(
    navigation.withWorkspaceNavigationScope(
      "/posts/organization-update?source=files#discussion",
      scope,
      origin,
    ),
    origin,
  );
  assert.equal(post.pathname, "/posts/organization-update");
  assert.equal(post.searchParams.get("source"), "files");
  assert.equal(post.searchParams.get("organizationScopeType"), "coalition");
  assert.equal(post.searchParams.get("organizationScopeId"), "civic-team");
  assert.equal(post.hash, "#discussion");
  assert.equal(
    navigation.withWorkspaceNavigationScope(
      "/coalitions/another-team/members",
      scope,
      origin,
    ),
    "/coalitions/another-team/members",
  );
  for (const path of [
    "/auth?returnTo=%2Ffeed",
    "/coalitions",
    "https://elsewhere.example.test/files",
  ])
    assert.equal(
      navigation.withWorkspaceNavigationScope(path, scope, origin),
      path,
    );
});

test("organization Files paths preserve selected owner on internal pages without activating standalone mode", () => {
  const path = files.filesNavigationPath("/files/recent?sort=name#list", {
    filesWorkspaceId: descriptor.filesWorkspaceId,
    scope,
    origin,
  });
  const url = new URL(path, origin);
  assert.equal(url.pathname, "/files/recent");
  assert.equal(url.searchParams.get("workspace"), descriptor.filesWorkspaceId);
  assert.equal(url.searchParams.get("sort"), "name");
  assert.equal(url.searchParams.get("organizationScopeId"), scope.scopeId);
  assert.equal(url.hash, "#list");
  const standalone = new URL(
    files.filesNavigationPath("/files/recent", {
      filesWorkspaceId: descriptor.filesWorkspaceId,
      scope: null,
      origin,
    }),
    origin,
  );
  assert.equal(standalone.searchParams.get("workspace"), null);
  assert.equal(standalone.searchParams.has("organizationScopeId"), false);
  for (const path of ["/feed", "https://elsewhere.example.test/files"])
    assert.equal(files.filesNavigationPath(path, { scope, origin }), path);
});

test("Files organization navigation needs a matching authorized principal, membership and actor", () => {
  const result = files.filesOrganizationNavigation(options);
  assert.equal(result.name, "Civic Team");
  assert.equal(result.actorId, "current-person");
  assert.equal(result.isAdmin, false);
  assert.equal(
    result.navItems.find((item) => item.key === "overview").href,
    "/coalitions/civic-team",
  );
  assert.equal(
    result.navItems.find((item) => item.key === "missions").enabled,
    false,
  );
  assert.equal(
    result.navItems.some((item) => item.key === "administration"),
    false,
  );
  for (const change of [
    { actorId: "" },
    { scope: null },
    { scope: { scopeType: "candidate", scopeId: "civic-team" } },
    {
      descriptor: {
        ...descriptor,
        principal: { type: "organization", id: "other-team" },
      },
    },
    {
      descriptor: {
        ...descriptor,
        principal: { type: "personal", id: "civic-team" },
      },
    },
    { payload: { ...payload, coalition: { coalitionId: "other-team" } } },
    { payload: { ...payload, membership: null } },
  ])
    assert.equal(
      files.filesOrganizationNavigation({ ...options, ...change }),
      null,
    );
});

test("pending or inactive Files membership cannot restore organization navigation", () => {
  for (const membership of [
    { roleKey: "admin", status: "pending" },
    { roleKey: "admin", status: "inactive" },
    { roleKey: "admin", status: "removed" },
    { roleKey: "admin" },
    { roleKey: "admin", status: "active", isActive: false },
    { roleKey: "admin", status: "active", isPending: true },
  ])
    assert.equal(
      files.filesOrganizationNavigation({
        ...options,
        payload: { ...payload, membership },
      }),
      null,
    );
  assert.notEqual(
    files.filesOrganizationNavigation({
      ...options,
      payload: {
        ...payload,
        membership: { roleKey: "member", isActive: true, isPending: false },
      },
    }),
    null,
  );
});

test("current organization navigation respects names, role access and query identity", () => {
  const result = files.filesOrganizationNavigation({
    ...options,
    payload: {
      ...payload,
      membership: { status: "active", roleKey: "admin", permissions: [] },
    },
  });
  assert.equal(result.isAdmin, true);
  assert.equal(
    result.navItems.find((item) => item.key === "missions").enabled,
    true,
  );
  assert.equal(
    result.navItems.some((item) => item.key === "administration"),
    true,
  );
  const fileUrl = new URL(
    result.navItems.find((item) => item.key === "files").href,
    origin,
  );
  assert.equal(
    fileUrl.searchParams.get("workspace"),
    descriptor.filesWorkspaceId,
  );
  assert.equal(fileUrl.searchParams.get("organizationScopeId"), "civic-team");
  assert.equal(
    navigation.workspaceDashboardPath(scope),
    "/coalitions/civic-team",
  );
  assert.equal(
    navigation.workspaceDashboardPath({
      scopeType: "candidate",
      scopeId: "campaign-one",
    }),
    "/candidate-dashboard/campaign-one",
  );
});
