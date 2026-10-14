import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (name) =>
  readFile(
    new URL(
      `../frontend/src/pages/shared-feed/scripts/${name}.js`,
      import.meta.url,
    ),
    "utf8",
  );
const uri = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const modelUrl = uri(await read("organizationDashboardModel"));
const model = await import(modelUrl);
const reportSource = await read("textingReporting");
const reportUrl = uri(
  reportSource.slice(
    reportSource.indexOf("const keys ="),
    reportSource.indexOf("export const textingHistoryStatus"),
  ),
);
const folderSource = await read("textingFolders");
const foldersUrl = uri(
  folderSource.slice(
    folderSource.indexOf("export const conversationUnreadCount"),
    folderSource.indexOf("export function renderTextingFolders"),
  ),
);
const dataSource = (await read("organizationDashboardData"))
  .replace('"./organizationDashboardModel"', JSON.stringify(modelUrl))
  .replace('"./textingReporting"', JSON.stringify(reportUrl))
  .replace('"./textingFolders"', JSON.stringify(foldersUrl));
const dataUrl = uri(dataSource),
  { createDashboardData } = await import(dataUrl);
const uiUrl = uri(
  'export const escapeText = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll("\\"","&quot;");',
);
const controllerSource = (await read("organizationDashboard"))
  .replace('"./textingWorkspaceUi"', JSON.stringify(uiUrl))
  .replace('"./organizationDashboardModel"', JSON.stringify(modelUrl))
  .replace('"./organizationDashboardData"', JSON.stringify(dataUrl))
  .replace('import "../css/organization-dashboard.css";', "");
const { createOrganizationDashboard } = await import(uri(controllerSource));
const scope = {
  scopeType: "coalition",
  scopeId: "one",
  userId: "actor",
  routes: {},
};
const workspace = { ...scope, isAdmin: true, permissions: [], role: "admin" };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const snapshot = (order, hidden = [], revision = 1) => ({
  revision,
  preference: { schemaVersion: 1, revision, order, hidden },
});
test("layout snapshots reject damaged/foreign IDs but preserve deliberate empty layouts and unknown permissions", () => {
  assert.deepEqual(
    model.checkedDashboardSnapshot(snapshot([])).preference.order,
    [],
  );
  assert.throws(() => model.checkedDashboardSnapshot(snapshot(["unknown"])));
  assert.throws(() =>
    model.checkedDashboardSnapshot(snapshot(["field", "field"])),
  );
  const layout = snapshot(["activity", "field"], ["activity"]).preference;
  assert.deepEqual(model.visibleDashboardCards(layout, new Set(["field"])), [
    "field",
  ]);
  assert.deepEqual(layout.order, ["activity", "field"]);
});
test("actual event buckets retain timestamps and never create member counts or invented goals", () => {
  const events = [
    { occurredAt: "2026-10-01T10:05:00Z" },
    { occurredAt: "2026-10-03T14:10:00Z" },
  ];
  assert.deepEqual(
    model.recentActivityBars(events).map((item) => item.time),
    [Date.parse("2026-10-01T10:00:00Z"), Date.parse("2026-10-03T14:00:00Z")],
  );
  assert.equal(model.checkedCount(undefined), null);
  assert.equal(model.personalJobProgress([]).percent, null);
});
test("personal progress exhausts pagination, filters other assignees and rejects a scope mismatch", async () => {
  const reads = [];
  const data = createDashboardData({
    scope,
    workspace,
    routes: { missions: "/missions" },
    call: async (path) => {
      reads.push(path);
      return {
        items: [
          {
            scopeType: "coalition",
            scopeId: "one",
            missionId: "m",
            jobs: [
              { assigneeUserId: "actor", status: "completed" },
              { assigneeUserId: "other", status: "assigned" },
            ],
          },
        ],
        nextCursor: null,
      };
    },
  });
  assert.equal((await data.load("progress")).progress.total, 1);
  assert.equal((await data.load("progress")).progress.completed, 1);
  assert.equal(reads.length, 1);
  const wrong = createDashboardData({
    scope,
    workspace,
    routes: {},
    call: async () => ({
      items: [{ scopeType: "coalition", scopeId: "other", jobs: [] }],
    }),
  });
  await assert.rejects(wrong.load("progress"));
});
test("pagination cannot loop or quietly use partial totals; failed reads can retry", async () => {
  let calls = 0;
  const data = createDashboardData({
    scope,
    workspace,
    routes: {},
    call: async () => {
      calls++;
      return { items: [], nextCursor: "same" };
    },
  });
  await assert.rejects(data.load("progress"));
  assert.equal(calls, 2);
  await assert.rejects(data.load("progress"));
  assert.equal(calls, 4);
});
test("activity source failures stay unknown while authorized useful summaries remain", async () => {
  const calls = [];
  const data = createDashboardData({
    scope,
    workspace,
    routes: {},
    call: async (path) => {
      calls.push(path);
      if (path.includes("/audit")) throw new Error("Temporary unavailable");
      if (path.includes("/canvassing/progress"))
        return {
          status: "ready",
          leaderboardScope: { status: "ready" },
          totals: { doorsKnocked: 42 },
        };
      if (path.includes("/missions")) return { items: [] };
      throw new Error("Texting unavailable");
    },
  });
  const value = await data.load("activity");
  assert.deepEqual(
    value.metrics.map((item) => item.value),
    [null, 42, null, 0],
  );
  assert.deepEqual(value.bars, []);
  assert.equal(
    calls.filter((path) => path.includes("/canvassing/progress")).length,
    1,
  );
});
test("partial campaign reporting never becomes a full delivery ratio or hero total", async () => {
  const data = createDashboardData({
    scope,
    workspace,
    routes: {},
    call: async (path) => {
      if (path.endsWith("/workspace"))
        return {
          workspace: {
            scopeKey: "coalition:one",
            status: "configured",
            manualOnly: true,
            capabilities: { readReporting: true },
          },
        };
      if (path.includes("/campaigns?"))
        return { items: [{ campaignId: "c", scopeKey: "coalition:one" }] };
      if (path.endsWith("/reporting"))
        return {
          report: {
            version: 1,
            campaignId: "c",
            coverage: "partial",
            counts: Object.fromEntries(
              [
                "accepted",
                "sent",
                "delivered",
                "failed",
                "pending",
                "needsReview",
                "inbound",
                "outbound",
              ].map((key) => [key, 2]),
            ),
            unreadReplies: 0,
          },
        };
      throw new Error("Unused");
    },
  });
  assert.equal((await data.load("texting")).ratio, null);
  assert.equal((await data.load("texting")).metrics[0].value, null);
});
test("reply queue excludes suppressed opt-outs and read conversations", async () => {
  const data = createDashboardData({
    scope,
    workspace,
    routes: { replies: "/replies" },
    call: async (path) =>
      path.endsWith("/workspace")
        ? {
            workspace: {
              scopeKey: "coalition:one",
              status: "configured",
              manualOnly: true,
            },
          }
        : path.includes("/campaigns?")
          ? { items: [] }
          : {
              items: [
                {
                  displayName: "Reply",
                  hasConversationalReply: true,
                  unreadReplyCount: 2,
                },
                {
                  displayName: "Opt out",
                  suppressed: true,
                  hasConversationalReply: false,
                  unreadReplyCount: 8,
                },
                {
                  displayName: "Read",
                  hasConversationalReply: true,
                  unreadReplyCount: 0,
                },
              ],
            },
  });
  assert.deepEqual(
    (await data.load("replies")).rows.map((row) => row.title),
    ["Reply"],
  );
});
test("saved first order has no default flash and late old actor snapshot is discarded", async () => {
  const wait = deferred();
  let context = { ...scope };
  const dashboard = createOrganizationDashboard({
    context: () => context,
    changed: () => {},
    navigate: () => {},
    request: async () => wait.promise,
  });
  const loading = dashboard.load();
  assert.equal(dashboard.render().includes("data-dashboard-card="), false);
  context = { ...scope, userId: "another" };
  wait.resolve({
    workspaces: [
      {
        ...workspace,
        dashboardPreferences: { status: "ready", ...snapshot(["field"]) },
      },
    ],
  });
  await loading;
  assert.equal(dashboard.render().includes("data-dashboard-card="), false);
});
test("access revocation clears all card data and fences later private responses", async () => {
  const delayed = deferred();
  const dashboard = createOrganizationDashboard({
    context: () => scope,
    changed: () => {},
    navigate: () => {},
    request: async (path) => {
      if (path === "/api/me/organization-workspaces")
        return {
          workspaces: [
            {
              ...workspace,
              dashboardPreferences: {
                status: "ready",
                ...snapshot(["field", "assignment"]),
              },
            },
          ],
        };
      if (path.includes("/canvassing/progress"))
        throw Object.assign(new Error("Revoked"), { status: 403 });
      if (path.includes("/missions")) return delayed.promise;
      throw new Error("Unused");
    },
  });
  const loading = dashboard.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  delayed.resolve({
    items: [
      {
        scopeType: "coalition",
        scopeId: "one",
        missionId: "private",
        jobs: [{ assigneeUserId: "actor", title: "Private late title" }],
      },
    ],
  });
  await loading;
  assert.deepEqual(dashboard.state().cards, {});
  assert.equal(dashboard.render().includes("Private late title"), false);
  assert.equal(dashboard.state().workspace, null);
});
