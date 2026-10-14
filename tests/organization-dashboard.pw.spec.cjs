const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const BASE = "http://127.0.0.1:9086";
const ART =
  process.env.DASHBOARD_ARTIFACTS ||
  "D:/CodexHome/artifacts/polis-visual-corrections-20261014/website";
async function fixture(
  page,
  {
    role = "admin",
    preference = null,
    delay = 0,
    conflict = false,
    deny = false,
  } = {},
) {
  const writes = [],
    reads = [],
    errors = [];
  let revision = preference?.revision || 0;
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "dashboard-test-actor", name: "Alex Example" })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ token, base }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: Date.now() + 3600000,
        }),
      );
      localStorage.setItem("polis.theme.v1", "light");
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: base,
            auth: {
              ...value.auth,
              region: "us-west-2",
              clientId: "test",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { token, base: BASE },
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === BASE || !url.protocol.startsWith("http")
      ? route.continue()
      : route.abort();
  });
  const permissions =
    role === "admin"
      ? [
          "voter_map_manager",
          "audit_view",
          "missions_manage",
          "missions_view",
          "calendar_manage",
          "posts_approve_manage",
          "text_bank_supervise",
        ]
      : role === "field-director"
        ? ["voter_map_manager", "missions_view", "calendar_view"]
        : role === "text-banking-coordinator"
          ? ["text_bank_supervise", "missions_view", "calendar_view"]
          : ["missions_view"];
  const coalition = {
    coalitionId: "dashboard-fixture",
    name: "Example organization",
    voterMapEnabled: true,
    coalitionType: "ordinary",
  };
  const membership = {
    roleKey: role,
    status: "active",
    isActive: true,
    permissions,
  };
  const workspace = {
    scopeType: "coalition",
    scopeId: "dashboard-fixture",
    displayName: "Example organization",
    role,
    isAdmin: role === "admin",
    permissions,
    dashboardPreferences: { status: "ready", revision, preference },
    features: {},
    featureFlags: {},
  };
  const mission = {
    missionId: "mission1",
    scopeType: "coalition",
    scopeId: "dashboard-fixture",
    jobs: [
      {
        jobId: "job1",
        title: "Westside door team",
        assigneeUserId: "dashboard-test-actor",
        status: "assigned",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      },
      {
        jobId: "job2",
        title: "Check in with your team",
        assigneeUserId: "dashboard-test-actor",
        status: "completed",
      },
    ],
  };
  await page.route(`${BASE}/api/**`, async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = decodeURIComponent(url.pathname);
    reads.push(p);
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/api/profile/me")
      return json({
        profile: {
          userId: "dashboard-test-actor",
          displayName: "Alex Example",
          username: "alex",
        },
      });
    if (p === "/api/coalitions")
      return json({ items: [{ coalition, membership }] });
    if (p === "/api/coalitions/dashboard-fixture")
      return json({ coalition, membership });
    if (p === "/api/me/organization-workspaces") {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return json({ workspaces: [workspace] });
    }
    if (p.endsWith("/dashboard-preferences")) {
      if (req.method() === "PUT") {
        const body = req.postDataJSON();
        writes.push({ body, actor: req.headers()["x-polis-expected-actor"] });
        if (conflict)
          return json(
            { message: "dashboard_preferences_revision_conflict" },
            409,
          );
        revision++;
        preference = { ...body, revision };
        delete preference.expectedRevision;
        workspace.dashboardPreferences = {
          status: "ready",
          revision,
          preference,
        };
      }
      return json({ ok: true, revision, preference });
    }
    if (p === "/api/voter-map/canvassing/progress")
      return deny
        ? json({ message: "Forbidden" }, 403)
        : json({
            status: "ready",
            totals: {
              doorsKnocked: 1240,
              conversations: 486,
              literatureDropped: 218,
              explored: 1750,
              visualCanvassed: 394,
            },
            leaderboardScope: { status: "ready" },
            leaderboardComplete: true,
            leaderboard: [
              { displayName: "Sam Example", doorsKnocked: 320, points: 480 },
              { displayName: "Jordan Example", doorsKnocked: 210, points: 360 },
            ],
          });
    if (p === "/api/missions")
      return json({ items: [mission], nextCursor: null });
    if (p === "/api/coalitions/dashboard-fixture/calendar/items")
      return json({
        items: [
          {
            title: "Team canvass",
            startAt: new Date(Date.now() + 86400000).toISOString(),
            locationName: "Westside meeting point",
          },
          {
            title: "Volunteer orientation",
            startAt: new Date(Date.now() + 2 * 86400000).toISOString(),
            locationName: "Community room",
          },
        ],
        nextCursor: null,
      });
    if (p.endsWith("/audit"))
      return json({
        scope: { scopeType: "coalition", scopeId: "dashboard-fixture" },
        events: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({
          action: ["mission.completed", "member.joined", "territory.published"][
            i % 3
          ],
          entityType: "team",
          actorUserId: `member${i % 4}`,
          occurredAt: new Date(Date.now() - i * 1400000).toISOString(),
        })),
      });
    if (p.endsWith("/post-drafts"))
      return json({ drafts: [{ state: "submitted" }], nextCursor: null });
    if (p.includes("/canvassing/operations"))
      return json({
        items: [
          {
            type: "literature_request",
            status: "open",
            addressLabel: "Westside",
          },
          { type: "return_visit", status: "open", addressLabel: "Downtown" },
        ],
        nextCursor: null,
      });
    if (p.endsWith("/workspace") && p.includes("text-banking"))
      return json({
        workspace: {
          scopeKey: "coalition:dashboard-fixture",
          status: "configured",
          manualOnly: true,
          capabilities: { readReporting: true },
        },
      });
    if (p.endsWith("/campaigns"))
      return json({
        items: [
          {
            campaignId: "campaign1",
            name: "Volunteer check-in",
            scopeKey: "coalition:dashboard-fixture",
            status: "active",
            assignedUserIds: ["sam", "jordan"],
          },
          {
            campaignId: "campaign2",
            name: "Weekend reminder",
            scopeKey: "coalition:dashboard-fixture",
            status: "active",
            assignedUserIds: ["alex"],
          },
        ],
        nextCursor: null,
      });
    if (p.endsWith("/reporting"))
      return json({
        report: {
          version: 1,
          campaignId: p.split("/").at(-2),
          coverage: "complete",
          counts: {
            accepted: 0,
            sent: 0,
            delivered: 480,
            failed: 8,
            pending: 12,
            needsReview: 0,
            inbound: 63,
            outbound: 500,
          },
          unreadReplies: 5,
        },
      });
    if (p.endsWith("/conversations"))
      return json({
        items: [
          {
            displayName: "Sam Example",
            hasConversationalReply: true,
            unreadReplyCount: 2,
          },
          {
            displayName: "Jordan Example",
            hasConversationalReply: true,
            unreadReplyCount: 1,
          },
        ],
        nextCursor: null,
      });
    if (p === "/api/me/notifications")
      return json({
        scopeKey: "coalition:dashboard-fixture",
        items: [
          {
            title: "Meet the team at the Westside entrance at 10 am.",
            authorName: "Sam Example",
            lastEventTs: Date.now(),
          },
        ],
      });
    if (p.endsWith("/access/catalog"))
      return json({
        roles: [{ roleKey: role, label: role, enabled: true, system: true }],
        canManage: role === "admin",
      });
    return json({
      ok: true,
      items: [],
      members: [],
      workspaces: [],
      territories: [],
    });
  });
  return { writes, reads, errors, workspace };
}
async function open(page) {
  await page.goto(`${BASE}/coalitions/dashboard-fixture`);
  await expect(page.locator(".organization-dashboard .pd-grid")).toBeVisible();
  await expect(page.locator(".pd-module [aria-busy=true]")).toHaveCount(0);
}
test("approved graphical role compositions render on phone and wide with existing navigation", async ({
  page,
}) => {
  const capture = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  await expect(page.locator(".pd-module")).toHaveCount(5);
  await expect(page.locator(".pd-activity-visual")).toBeVisible();
  await expect(page.locator("[data-dashboard-card=field]")).toContainText(
    "1,240",
  );
  await expect(page.locator("[data-dashboard-card=texting]")).toContainText(
    "96",
  );
  fs.mkdirSync(ART, { recursive: true });
  await page.screenshot({
    path: path.join(ART, "actual-dashboard-wide.png"),
    fullPage: true,
  });
  await page
    .locator(".organization-dashboard")
    .screenshot({ path: path.join(ART, "actual-dashboard-content-wide.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(ART, "actual-dashboard-phone.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  expect(capture.errors).toEqual([]);
});
test("saved first layout waits for snapshot, preserves order, hides and saves private actor", async ({
  page,
}) => {
  const preference = {
    schemaVersion: 1,
    revision: 3,
    order: ["schedule", "field", "activity"],
    hidden: ["activity"],
  };
  const capture = await fixture(page, { preference, delay: 400 });
  await page.goto(`${BASE}/coalitions/dashboard-fixture`);
  await expect(page.locator("[data-dashboard-card=activity]")).toHaveCount(0);
  await expect(page.locator(".pd-grid")).toBeVisible();
  await expect(page.locator(".pd-module")).toHaveCount(2);
  await expect(page.locator(".pd-module").first()).toHaveAttribute(
    "data-dashboard-card",
    "schedule",
  );
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page
    .getByRole("button", { name: "Move On the streets earlier" })
    .click();
  await page.getByRole("button", { name: "Hide Coming up" }).click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByText("Your layout is saved.")).toBeVisible();
  expect(capture.writes).toHaveLength(1);
  expect(capture.writes[0].actor).toBe("dashboard-test-actor");
  expect(capture.writes[0].body.expectedRevision).toBe(3);
  await page.reload();
  await expect(page.locator(".pd-module")).toHaveCount(1);
  await expect(page.locator(".pd-module").first()).toHaveAttribute(
    "data-dashboard-card",
    "field",
  );
});
test("empty layouts stay empty, additions cancel cleanly, save conflict retains draft", async ({
  page,
}) => {
  const capture = await fixture(page, {
    preference: { schemaVersion: 1, revision: 2, order: [], hidden: [] },
    conflict: true,
  });
  await open(page);
  await expect(page.locator(".pd-module")).toHaveCount(0);
  await page.getByRole("button", { name: "Add cards", exact: true }).click();
  await page
    .getByRole("button", { name: "Add On the streets", exact: true })
    .click();
  await expect(page.locator("[data-dashboard-card=field]")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".pd-module")).toHaveCount(0);
  await page.getByRole("button", { name: "Add cards", exact: true }).click();
  await page
    .getByRole("button", { name: "Add Coming up", exact: true })
    .click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(
    page.getByText("Your layout changed on another device."),
  ).toBeVisible();
  await expect(page.locator("[data-dashboard-card=schedule]")).toBeVisible();
  expect(capture.writes).toHaveLength(1);
});
for (const role of ["field-director", "text-banking-coordinator", "volunteer"])
  test(`${role} card actions and role composition`, async ({ page }) => {
    const capture = await fixture(page, { role });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.screenshot({
      path: path.join(ART, `actual-dashboard-${role}-phone.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".organization-dashboard").screenshot({
      path: path.join(ART, `actual-dashboard-${role}-wide.png`),
    });
    expect(capture.errors).toEqual([]);
  });
module.exports = { fixture, open };
test("pointer handle reorders without activating cards; field footer keeps the existing route", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const handle = page.getByRole("button", {
    name: "Drag On the streets to reorder",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox(),
    to = await page.locator("[data-dashboard-card=attention]").boundingBox();
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".pd-module").nth(1)).toHaveAttribute(
    "data-dashboard-card",
    "field",
  );
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByText("Your layout is saved.")).toBeVisible();
  await page
    .getByRole("button", { name: "Open field overview", exact: false })
    .click();
  await expect(page).toHaveURL(/\/coalitions\/dashboard-fixture\/voter-map$/);
});

test("candidate overview uses the same saved graphical cards and existing candidate navigation", async ({
  page,
}) => {
  const capture = await fixture(page);
  await page.route(`${BASE}/api/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const access = {
      candidateId: "candidate-fixture",
      isOwner: true,
      permissions: ["voter_map_manager"],
    };
    if (p === "/api/candidateDashboard/candidates")
      return json({ candidates: [{ ...access, name: "Campaign example" }] });
    if (p === "/api/candidates/candidate-fixture")
      return json({
        candidate: {
          candidateId: "candidate-fixture",
          name: "Campaign example",
          userId: "dashboard-test-actor",
        },
      });
    if (p.startsWith("/api/candidateDashboard/candidate-fixture"))
      return json({
        candidate: {
          candidateId: "candidate-fixture",
          name: "Campaign example",
        },
        access,
      });
    if (p === "/api/me/organization-workspaces")
      return json({
        workspaces: [
          {
            ...capture.workspace,
            scopeType: "candidate",
            scopeId: "candidate-fixture",
            isOwner: true,
            dashboardPreferences: {
              status: "ready",
              revision: 1,
              preference: {
                schemaVersion: 1,
                revision: 1,
                order: ["field"],
                hidden: [],
              },
            },
          },
        ],
      });
    return route.fallback();
  });
  await page.goto(`${BASE}/candidate-dashboard/candidate-fixture`);
  await expect(page.locator(".pd-grid")).toBeVisible();
  await expect(page.locator(".pd-module")).toHaveCount(1);
  await expect(page.locator("[data-dashboard-card=field]")).toContainText(
    "1,240",
  );
  await expect(
    page.getByRole("navigation", { name: "Campaign dashboard sections" }),
  ).toBeVisible();
  expect(capture.errors).toEqual([]);
});

test("saved dark theme retains the same blue graphical layout", async ({
  page,
}) => {
  const capture = await fixture(page);
  await page.addInitScript(() =>
    localStorage.setItem("prefs.themeMode", "dark"),
  );
  await open(page);
  const background = await page
    .locator(".organization-dashboard")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).toBe("rgb(8, 16, 32)");
  await page
    .locator(".organization-dashboard")
    .screenshot({ path: path.join(ART, "actual-dashboard-dark-wide.png") });
  expect(capture.errors).toEqual([]);
});
