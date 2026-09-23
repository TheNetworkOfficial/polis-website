const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const COALITION_ID = "coalition-ui-demo";
const COALITION_PATH = `/coalitions/${COALITION_ID}`;
const TEXTING_PATH = `/organizations/${COALITION_ID}/texting`;
const FILES_WORKSPACE_ID = `files:v1:organization:${COALITION_ID}`;

async function mockCoalitionWorkspace(page, { role = "admin" } = {}) {
  const token = `e30.${Buffer.from(
    JSON.stringify({
      sub: "coalition-review-user",
      email: "alex@example.test",
      name: "Alex Morgan",
    }),
  ).toString("base64url")}.test`;

  await page.addInitScript(
    ({ baseUrl, token }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: Date.now() + 3_600_000,
        }),
      );
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: baseUrl,
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
    { baseUrl: BASE_URL, token },
  );

  const writes = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const admin = role === "admin";
  const coalition = {
    coalitionId: COALITION_ID,
    name: "Civic Action Team",
    description: "A shared workspace for neighborhood volunteers.",
    coalitionType: "constitutional",
    hasConstitution: true,
    voterMapEnabled: true,
    primaryContactName: "Alex Morgan",
    email: "team@example.test",
    website: "https://example.test",
  };
  const membership = { roleKey: role, status: "active", permissions: [] };
  const roles = [
    { roleKey: "admin", label: "Admin", enabled: true, system: true },
    { roleKey: "member", label: "Member", enabled: true, system: true },
  ];

  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    // This fixture is entirely local and read-only, including accidental writes.
    if (request.method() !== "GET") {
      writes.push({ path, method: request.method() });
      return respond({ error: "read_only_ui_fixture" }, 403);
    }
    if (path === "/api/profile/me")
      return respond({
        profile: {
          userId: "coalition-review-user",
          displayName: "Alex Morgan",
          username: "alex-demo",
        },
      });
    if (path === "/api/coalitions")
      return respond({ items: [{ coalition, membership }] });
    if (path === "/api/files/workspaces")
      return respond({
        workspaces: ["another-demo-organization", COALITION_ID].map((id) => ({
          filesWorkspaceId: `files:v1:organization:${id}`,
          principal: { type: "organization", sourceType: "organization", id },
          entitlement: "organization_files",
          featureFlags: { filesEnabled: true },
          permissions: ["files_view"],
        })),
      });
    if (path === `/api/files/workspaces/organization/${COALITION_ID}`)
      return respond({
        workspace: {
          filesWorkspaceId: FILES_WORKSPACE_ID,
          principal: {
            type: "organization",
            sourceType: "organization",
            id: COALITION_ID,
            displayName: coalition.name,
          },
          entitlement: "organization_files",
          featureFlags: { filesEnabled: true },
          permissions: ["files_view"],
          capabilities: { canView: true },
          setup: { initialized: true },
          roots: [],
          settings: { version: 1 },
        },
      });
    if (path === `/api/coalitions/${COALITION_ID}`)
      return respond({ coalition, membership });
    if (path === `/api/coalitions/${COALITION_ID}/members`)
      return respond({
        members: [
          {
            userId: "coalition-review-user",
            displayName: "Alex Morgan",
            username: "alex-demo",
            roleKey: role,
            permissions: [],
          },
          {
            userId: "coalition-review-second-user",
            displayName: "Jordan Reed",
            username: "jordan-demo",
            roleKey: "member",
            permissions: [],
          },
        ],
      });
    if (path === `/api/coalitions/${COALITION_ID}/access/catalog`)
      return respond({ roles, canManage: admin });
    if (path === `/api/coalitions/${COALITION_ID}/voter-map/access`)
      return respond({
        access: {
          ok: admin,
          territories: [],
          canManageTerritories: admin,
          canManageCta: admin,
        },
      });
    if (path.endsWith("/workspace") && path.includes("/text-banking/"))
      return respond({
        ok: true,
        workspace: {
          scopeKey: `coalition:${COALITION_ID}`,
          provider: "prompt",
          manualOnly: true,
          status: "configured",
          canSend: false,
          sendingMode: "blocked",
          blockedReasons: [],
          capabilities: {},
        },
      });
    if (path.endsWith("/billing/summary"))
      return respond({
        ok: true,
        billing: {
          organizationName: coalition.name,
          currency: "usd",
          availableMicros: 0,
          reservedMicros: 0,
          settledMicros: 0,
          unfundedMicros: 0,
          sendingBlocked: true,
          canManageBilling: admin,
        },
      });
    return respond({ ok: true, items: [], audiences: [], workspaces: [] });
  });
  return { writes, errors };
}

test("coalition navigation preserves the existing Texting Hub and scoped Files destination", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60000);
  const { writes, errors } = await mockCoalitionWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${BASE_URL}/coalitions`);
  await expect(page.locator(".polis-coalition-ui")).toBeVisible();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}/admin`);

  const navigation = page.locator(".coalition-ui-sidebar");
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".coalition-ui-heading h1")).toHaveText("Home");
  await page.screenshot({
    path: testInfo.outputPath("coalition-home-desktop.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.polisThemeResolved = "dark";
  });
  await page.screenshot({
    path: testInfo.outputPath("coalition-home-dark.png"),
    animations: "disabled",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.polisThemeResolved = "light";
  });
  await navigation.locator(`[data-route="${COALITION_PATH}/members"]`).click();
  await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}/members`);
  await expect(
    page.locator('[data-route-form="coalition-invite"] input[name="username"]'),
  ).toBeEnabled();

  const files = navigation.locator('[data-route^="/files?"]');
  await expect(files).toHaveCount(1);
  const filesUrl = new URL(await files.getAttribute("data-route"), BASE_URL);
  expect(filesUrl.pathname).toBe("/files");
  expect(filesUrl.searchParams.get("workspace")).toBe(FILES_WORKSPACE_ID);
  await files.click();
  await expect(page).toHaveURL(filesUrl.href);
  await expect(page.locator(".files-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team files", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".polis-coalition-ui")).toHaveCount(0);
  await page.goto(`${BASE_URL}${COALITION_PATH}`);
  await expect(navigation).toBeVisible();

  // Exercise the existing section renderers after the shared presentation changes.
  for (const section of [
    "missions",
    "calendar",
    "governance",
    "amplify",
    "petitions",
    "voter-map",
  ]) {
    await navigation
      .locator(`[data-route="${COALITION_PATH}/${section}"]`)
      .click();
    await expect(page.locator(".coalition-ui-heading h1")).toBeVisible();
    await expect(page.locator(".shared-page__loading")).toHaveCount(0);
    const width = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
    if (["calendar", "governance", "voter-map"].includes(section)) {
      await page.screenshot({
        path: testInfo.outputPath(`coalition-${section}-desktop.png`),
        fullPage: true,
      });
    }
  }
  await navigation.locator(`[data-route="${TEXTING_PATH}"]`).click();
  await expect(page).toHaveURL(`${BASE_URL}${TEXTING_PATH}`);
  await expect(page.locator(".texting-workspace")).toBeVisible();
  await expect(page.locator(".pt-brand img")).toBeVisible();
  await expect(page.locator(".polis-coalition-ui")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Good conversations start here." }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("member access stays read-only and coalition pages fit a mobile viewport", async ({
  page,
}, testInfo) => {
  const { writes, errors } = await mockCoalitionWorkspace(page, {
    role: "member",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}${COALITION_PATH}/members`);
  const invite = page.locator('[data-route-form="coalition-invite"]');
  await expect(invite.locator('input[name="username"]')).toBeDisabled();
  await expect(invite.locator('select[name="roleKey"]')).toBeDisabled();
  await expect(invite.locator('button[type="submit"]')).toBeDisabled();
  await expect(
    page.locator('[data-route-form="coalition-role-create"]'),
  ).toHaveCount(0);

  const mobileNavigation = page.locator(".coalition-ui-mobile-nav");
  await mobileNavigation.locator("summary").click();
  await expect(
    mobileNavigation.getByRole("button", { name: "Field work", exact: true }),
  ).toBeDisabled();
  await expect(
    mobileNavigation.getByRole("button", { name: "People", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await mobileNavigation.locator("summary").click();

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({
    path: testInfo.outputPath("coalition-members-mobile.png"),
    fullPage: true,
  });
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("coalition rooms retain the live composer in a channel workspace without changing private messages", async ({
  page,
}, testInfo) => {
  const { errors } = await mockCoalitionWorkspace(page);
  await page.routeWebSocket("**", (socket) => socket.close());
  const roomId = "field-room-demo";
  const messageWrites = [];
  const room = {
    conversationId: roomId,
    title: "field-team",
    subtitle: "Plans and check-ins for our next shift.",
    kind: "room",
    scopeType: "coalition",
    scopeId: COALITION_ID,
    categoryId: "organizing",
    participantCount: 2,
    canManage: true,
    isEncrypted: false,
  };
  await page.route(`${BASE_URL}/api/messaging/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      if (path.endsWith("/devices/register") || path.endsWith("/read"))
        return respond({ ok: true });
      messageWrites.push({ path, method: request.method() });
      return respond({ error: "no_sends_in_ui_fixture" }, 403);
    }
    if (path.endsWith("/server-directory"))
      return respond({
        directory: {
          canManage: true,
          categories: [{ categoryId: "organizing", title: "Organizing" }],
          channels: [room],
        },
      });
    if (path.endsWith("/servers"))
      return respond({
        servers: [
          {
            scopeType: "coalition",
            scopeId: COALITION_ID,
            title: "Civic Action Team",
            canManage: true,
          },
        ],
      });
    if (path === `/api/messaging/conversations/${roomId}`)
      return respond({ conversation: room });
    if (path.endsWith("/history"))
      return respond({
        messages: [
          {
            messageId: "room-message-one",
            conversationId: roomId,
            senderUserId: "coalition-review-second-user",
            senderDisplayName: "Jordan Reed",
            text: "The next volunteer shift is ready.",
            createdAt: Date.now() - 600000,
          },
          {
            messageId: "room-message-two",
            conversationId: roomId,
            senderUserId: "coalition-review-user",
            senderDisplayName: "Alex Morgan",
            text: "Thanks, I will bring the welcome materials.",
            createdAt: Date.now() - 300000,
          },
        ],
      });
    if (path.endsWith("/members"))
      return respond({
        members: [
          {
            userId: "coalition-review-user",
            effectiveName: "Alex Morgan",
            username: "alex-demo",
            roles: [],
          },
          {
            userId: "coalition-review-second-user",
            effectiveName: "Jordan Reed",
            username: "jordan-demo",
            roles: [],
          },
        ],
      });
    return respond({
      ok: true,
      settings: {},
      messages: [],
      conversations: [],
      requests: [],
      items: [],
      pins: [],
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE_URL}${COALITION_PATH}/rooms`);
  await expect(page.locator(".shared-coalition-room-browser")).toBeVisible();
  const channel = page
    .locator(".shared-coalition-room-channel")
    .filter({ hasText: "field-team" });
  await expect(channel).toHaveCount(1);
  await channel.click();
  await expect(page.locator(".shared-coalition-chat")).toBeVisible();
  await expect(
    page.locator(".shared-coalition-room-channel.is-active"),
  ).toContainText("field-team");
  await expect(page.locator(".shared-message-list")).toContainText(
    "The next volunteer shift is ready.",
  );
  await expect(
    page.locator(".shared-message.is-self .shared-messaging-avatar"),
  ).toBeVisible();
  await expect(page.locator(".shared-coalition-chat__members")).toContainText(
    "Jordan Reed",
  );
  await expect(page.locator(".shared-coalition-chat__members")).toBeVisible();
  const composer = page.locator('[data-route-form="messaging-send"]');
  await expect(composer.locator('input[name="conversationId"]')).toHaveValue(
    roomId,
  );
  await composer.locator('textarea[name="text"]').fill("Draft for the team");
  await expect(
    composer.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await expect(
    composer.getByRole("button", { name: "Attach media", exact: true }),
  ).toBeEnabled();
  await page.locator(".shared-coalition-room-tools--thread > summary").click();
  await expect(
    page.getByRole("button", { name: "Pinned messages", exact: true }),
  ).toBeVisible();
  await page.locator(".shared-coalition-room-tools--thread > summary").click();
  await page.screenshot({
    path: testInfo.outputPath("coalition-room-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator(".shared-coalition-chat__sidebar"),
  ).not.toBeVisible();
  await expect(composer).toBeVisible();
  await expect(composer.locator('textarea[name="text"]')).toHaveValue(
    "Draft for the team",
  );
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    composerBottom: document
      .querySelector('[data-route-form="messaging-send"]')
      .getBoundingClientRect().bottom,
    headerHeight: document
      .querySelector(".shared-messaging-thread-header")
      .getBoundingClientRect().height,
    height: window.innerHeight,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.composerBottom).toBeLessThanOrEqual(layout.height);
  expect(layout.headerHeight).toBeLessThanOrEqual(90);
  await page.screenshot({
    path: testInfo.outputPath("coalition-room-mobile.png"),
    fullPage: true,
  });

  await page.goto(`${BASE_URL}/messages?restore=0`);
  await expect(page.locator(".shared-messaging-workspace")).toBeVisible();
  await expect(page.locator(".shared-coalition-chat")).toHaveCount(0);
  expect(messageWrites).toEqual([]);
  expect(errors).toEqual([]);
});
