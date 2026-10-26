const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const COALITION_ID = "coalition-ui-demo";
const COALITION_PATH = `/coalitions/${COALITION_ID}`;
const TEXTING_PATH = `/organizations/${COALITION_ID}/texting`;
const FILES_WORKSPACE_ID = `files:v1:organization:${COALITION_ID}`;

async function mockCoalitionWorkspace(
  page,
  { role = "admin", longMembers = false, multiple = false } = {},
) {
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
  const reads = [];
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
  const organizations = [coalition];
  if (multiple)
    organizations.push({
      ...coalition,
      coalitionId: "another-demo-organization",
      name: "River County Team",
    });

  // Files has its own compiled API origin; keep those requests in this local
  // fixture as well as the shared shell's runtime-configured API requests.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const path = pathname.slice(pathname.indexOf("/api/"));
    if (request.method() === "GET") {
      let credentialVersion = "";
      try {
        const token = (request.headers().authorization || "").replace(
          /^Bearer /u,
          "",
        );
        credentialVersion =
          JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
            .credentialVersion || "";
      } catch {
        // Discovery requests can have no signed-in actor; record no credential.
      }
      reads.push({ path, credentialVersion });
    }
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
    if (path === "/api/me/policy-acceptance")
      return respond({ ok: true, accepted: true });
    if (path === "/api/coalitions")
      return respond({
        items: organizations.map((item) => ({ coalition: item, membership })),
      });
    if (path === "/api/me/organization-workspaces")
      return respond({
        workspaces: organizations.map((item) => ({
          scopeType: "coalition",
          scopeId: item.coalitionId,
          name: item.name,
          isAdmin: admin,
          role,
          permissions: [],
          filesWorkspaceId: `files:v1:organization:${item.coalitionId}`,
          dashboardPreferences: {
            status: "ready",
            revision: 1,
            preference: {
              schemaVersion: 1,
              revision: 1,
              order: [],
              hidden: [],
            },
          },
        })),
      });
    if (path === "/api/files/workspaces")
      return respond({
        workspaces: ["another-demo-organization", COALITION_ID].map((id) => ({
          filesWorkspaceId: `files:v1:organization:${id}`,
          principal: {
            type: "organization",
            sourceType: "organization",
            id,
            displayName:
              organizations.find((item) => item.coalitionId === id)?.name ||
              "Other files workspace",
          },
          entitlement: "organization_files",
          featureFlags: { filesEnabled: true },
          permissions: ["files_view"],
        })),
      });
    const filesOrganization = organizations.find(
      (item) =>
        path === `/api/files/workspaces/organization/${item.coalitionId}`,
    );
    if (filesOrganization)
      return respond({
        workspace: {
          filesWorkspaceId: `files:v1:organization:${filesOrganization.coalitionId}`,
          principal: {
            type: "organization",
            sourceType: "organization",
            id: filesOrganization.coalitionId,
            displayName: filesOrganization.name,
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
    const selectedOrganization = organizations.find(
      (item) => path === `/api/coalitions/${item.coalitionId}`,
    );
    if (selectedOrganization)
      return respond({ coalition: selectedOrganization, membership });
    if (path === `/api/coalitions/${COALITION_ID}/members`)
      return respond({
        members: longMembers
          ? Array.from({ length: 80 }, (_, index) => ({
              userId: `coalition-review-person-${index}`,
              displayName: `Volunteer ${String(index + 1).padStart(2, "0")}`,
              username: `volunteer-${index}`,
              roleKey: "member",
              permissions: [],
            }))
          : [
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
  return { writes, errors, reads };
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
  await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
  await expect(page.locator(".organization-dashboard")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Customize", exact: true }),
  ).toBeEnabled();

  const navigation = page.locator(".coalition-ui-sidebar");
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
  await expect(
    navigation.getByRole("button", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-current", "page");
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
  await page
    .getByRole("button", { name: "Invite person", exact: true })
    .click();
  await expect(
    page.locator('[data-route-form="coalition-invite"] input[name="username"]'),
  ).toBeEnabled();
  await page.keyboard.press("Escape");

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
  await expect(page.locator(".coalition-ui-sidebar")).toBeVisible();
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
  await expect(page.locator(".coalition-ui-brand img")).toBeVisible();
  await expect(page.locator(".coalition-ui-sidebar")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Good conversations start here." }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

for (const role of ["admin", "member"])
  for (const width of [1440, 390]) {
    test(`workspace entry opens the authorized dashboard for ${role} at ${width}px`, async ({
      page,
    }) => {
      const fixture = await mockCoalitionWorkspace(page, { role });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE_URL}/coalitions`);
      await page
        .getByRole("button", { name: "Workspace", exact: true })
        .click();
      await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
      await expect(page.locator(".organization-dashboard")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Customize", exact: true }),
      ).toBeEnabled();
      await expect(page.locator(".coalition-people")).toHaveCount(0);
      const navigation = page.locator(
        width < 700 ? ".coalition-ui-mobile-nav" : ".coalition-ui-sidebar",
      );
      if (width < 700) await navigation.locator("summary").click();
      await expect(
        navigation.getByRole("button", { name: "Home", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await navigation
        .getByRole("button", { name: "People", exact: true })
        .click();
      await expect(page.locator(".coalition-people")).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
      await expect(page.locator(".organization-dashboard")).toBeVisible();
      await page.reload();
      await expect(page.locator(".organization-dashboard")).toBeVisible();
      await expect(page.locator(".coalition-people")).toHaveCount(0);
      expect(fixture.writes).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }

for (const width of [1440, 390]) {
  test(`organization navigation remains reachable at the bottom of a long page at ${width}px`, async ({
    page,
  }, testInfo) => {
    const fixture = await mockCoalitionWorkspace(page, { longMembers: true });
    await page.setViewportSize({ width, height: 700 });
    await page.goto(`${BASE_URL}${COALITION_PATH}/members`);
    await expect(page.locator("[data-coalition-member-card]")).toHaveCount(80);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const navigation = page.locator(
      width < 700 ? ".coalition-ui-mobile-nav" : ".coalition-ui-sidebar",
    );
    await expect(navigation).toBeVisible();
    const geometry = await navigation.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        viewportHeight: innerHeight,
        pageScroll: scrollY,
        ownHeight: element.clientHeight,
        ownContentHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      };
    });
    expect(geometry.pageScroll).toBeGreaterThan(500);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeLessThan(geometry.viewportHeight - 40);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    if (width >= 700) {
      expect(geometry.ownContentHeight).toBeGreaterThan(geometry.ownHeight);
      expect(["auto", "scroll"]).toContain(geometry.overflowY);
    } else await navigation.locator("summary").click();
    const administration = navigation.getByRole("button", {
      name: "Administration",
      exact: true,
    });
    await administration.scrollIntoViewIfNeeded();
    const pagePositionBeforeSwitch = await page.evaluate(() => scrollY);
    expect(pagePositionBeforeSwitch).toBeGreaterThan(500);
    await page.screenshot({
      path: testInfo.outputPath(`navigation-at-page-bottom-${width}.png`),
      animations: "disabled",
    });
    await administration.click();
    await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}/admin/edit`);
    await expect(page.locator(".coalition-ui-heading h1")).toHaveText(
      "Administration",
    );
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

for (const role of ["admin", "member"]) {
  test(`scoped shared tools keep organization navigation until ${role} explicitly exits`, async ({
    page,
  }) => {
    const fixture = await mockCoalitionWorkspace(page, { role });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const routes = [
      "/organizations/coalition-ui-demo/texting",
      "/workspace/coalition/coalition-ui-demo/work/ballot-chaser",
      "/workspace/coalition/coalition-ui-demo/people/contacts",
      "/workspace/coalition/coalition-ui-demo/work/publishing",
      "/workspace/coalition/coalition-ui-demo/more/social-connections",
      "/workspace/coalition/coalition-ui-demo/work/publishing/new",
    ];
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`);
      const sidebar = page.locator(".coalition-ui-sidebar");
      await expect(sidebar).toBeVisible();
      await expect(
        sidebar.locator(".coalition-ui-sidebar__identity"),
      ).toContainText("Civic Action Team");
      await expect(
        sidebar.getByRole("button", { name: "Home", exact: true }),
      ).toHaveAttribute("data-route", COALITION_PATH);
      await page.reload();
      await expect(sidebar).toBeVisible();
      await expect(page.locator(".coalition-ui-brand")).toHaveAttribute(
        "data-route",
        COALITION_PATH,
      );
    }
    await page.locator(".coalition-ui-brand").click();
    await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
    await expect(page.locator(".organization-dashboard")).toBeVisible();
    await page
      .locator(".coalition-ui-sidebar")
      .getByRole("button", { name: "Exit workspace", exact: true })
      .click();
    await expect(page).toHaveURL(`${BASE_URL}/feed`);
    await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("Files preserves the selected organization on internal views, refresh and workspace changes", async ({
  page,
}) => {
  const fixture = await mockCoalitionWorkspace(page, { multiple: true });
  await page.goto(`${BASE_URL}${COALITION_PATH}`);
  await page
    .locator(".coalition-ui-sidebar")
    .getByRole("link", { name: "Files", exact: true })
    .click();
  await expect(page.locator(".files-shell")).toBeVisible();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "Civic Action Team",
  );
  await page
    .locator(".files-sidebar")
    .getByRole("button", { name: "Recent", exact: true })
    .click();
  await expect(page).toHaveURL(/\/files\/recent\?/);
  const query = new URL(page.url()).searchParams;
  expect(query.get("workspace")).toBe(FILES_WORKSPACE_ID);
  expect(query.get("organizationScopeType")).toBe("coalition");
  expect(query.get("organizationScopeId")).toBe(COALITION_ID);
  await page.reload();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "Civic Action Team",
  );
  await page
    .getByRole("combobox", { name: "Files workspace" })
    .selectOption({ label: "River County Team" });
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "River County Team",
  );
  await expect(
    page
      .locator(".coalition-ui-sidebar")
      .getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("data-route", "/coalitions/another-demo-organization");
  await page.goBack();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "Civic Action Team",
  );
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(
    FILES_WORKSPACE_ID,
  );
  await page.goForward();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "River County Team",
  );
  await page.reload();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "River County Team",
  );
  await page
    .locator(".coalition-ui-sidebar")
    .getByRole("button", { name: "Exit workspace", exact: true })
    .click();
  await expect(page).toHaveURL(`${BASE_URL}/feed`);
  await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("standalone Files does not inherit an old organization mode or trust mismatched scope hints", async ({
  page,
}) => {
  const fixture = await mockCoalitionWorkspace(page);
  const files = `${BASE_URL}/files?workspace=${encodeURIComponent(FILES_WORKSPACE_ID)}`;
  await page.goto(
    `${files}&organizationScopeType=coalition&organizationScopeId=${COALITION_ID}`,
  );
  await expect(page.locator(".coalition-ui-sidebar")).toBeVisible();
  await page.goto(files);
  await expect(page.locator(".files-shell")).toBeVisible();
  await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
  await page.goto(
    `${files}&organizationScopeType=coalition&organizationScopeId=another-demo-organization`,
  );
  await expect(page.locator(".files-shell")).toBeVisible();
  await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("same-user credential refresh keeps the authorized organization tabs without leaving Texting", async ({
  page,
}) => {
  const fixture = await mockCoalitionWorkspace(page);
  await page.goto(`${BASE_URL}${TEXTING_PATH}`);
  await expect(page.locator(".texting-workspace")).toBeVisible();
  const people = page
    .locator(".coalition-ui-sidebar")
    .locator(`[data-route="${COALITION_PATH}/members"]`);
  await expect(people).toBeVisible();
  await page.waitForLoadState("networkidle");
  const workspaceReads = () =>
    fixture.reads.filter(
      (item) =>
        item.path.includes("/text-banking/") &&
        item.path.endsWith("/workspace"),
    ).length;
  const previousReads = workspaceReads();
  await page.evaluate(() => {
    const key = "sharedFeedSession.v1";
    const session = JSON.parse(sessionStorage.getItem(key));
    const parts = session.idToken.split(".");
    const claims = JSON.parse(atob(parts[1]));
    claims.credentialVersion = "refreshed-organization-navigation";
    const token = `${parts[0]}.${btoa(JSON.stringify(claims))}.refreshed`;
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...session, idToken: token, accessToken: token }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(workspaceReads).toBeGreaterThan(previousReads);
  await expect
    .poll(() =>
      fixture.reads.some(
        (item) =>
          item.path.includes("/text-banking/") &&
          item.path.endsWith("/workspace") &&
          item.credentialVersion === "refreshed-organization-navigation",
      ),
    )
    .toBe(true);
  await page.waitForLoadState("networkidle");
  await expect(people).toBeVisible();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "Civic Action Team",
  );
  await expect(page).toHaveURL(`${BASE_URL}${TEXTING_PATH}`);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("a transient workspace navigation read can retry without switching to consumer navigation", async ({
  page,
}) => {
  const fixture = await mockCoalitionWorkspace(page);
  let navigationReads = 0;
  await page.route(`**/api/coalitions/${COALITION_ID}`, async (route) => {
    navigationReads++;
    if (navigationReads === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporarily_unavailable" }),
      });
    return route.fallback();
  });
  await page.goto(`${BASE_URL}${TEXTING_PATH}`);
  await expect(page.locator(".coalition-ui-sidebar")).toBeVisible();
  await page
    .getByRole("button", { name: "Retry workspace", exact: true })
    .click();
  await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
    "Civic Action Team",
  );
  await expect(
    page
      .locator(".coalition-ui-sidebar")
      .locator(`[data-route="${COALITION_PATH}/members"]`),
  ).toBeVisible();
  await expect(page.locator(".texting-workspace")).toBeVisible();
  expect(navigationReads).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(`${BASE_URL}${TEXTING_PATH}`);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("public organization metadata without active membership cannot restore private workspace tabs", async ({
  page,
}) => {
  const fixture = await mockCoalitionWorkspace(page);
  await page.route(`**/api/coalitions/${COALITION_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        coalition: { coalitionId: COALITION_ID, name: "Civic Action Team" },
        membership: null,
      }),
    }),
  );
  await page.goto(`${BASE_URL}${TEXTING_PATH}`);
  await expect(
    page.getByRole("button", { name: "Retry workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".coalition-ui-sidebar .shared-coalition-tab"),
  ).toHaveCount(0);
  await expect(page.locator(".texting-workspace")).toHaveCount(0);
  await page
    .locator(".coalition-ui-sidebar")
    .getByRole("button", { name: "Exit workspace", exact: true })
    .click();
  await expect(page).toHaveURL(`${BASE_URL}/feed`);
  await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("workspace root aliases open the dashboard and top actions retain its navigation context", async ({
  page,
}) => {
  const fixture = await mockCoalitionWorkspace(page);
  for (const suffix of ["", "/home", "/dashboard", "/overview"]) {
    await page.goto(`${BASE_URL}/workspace/coalition/${COALITION_ID}${suffix}`);
    await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
    await expect(page.locator(".organization-dashboard")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Customize", exact: true }),
    ).toBeEnabled();
  }
  for (const action of ["Search", "Notifications"]) {
    await page
      .locator(".coalition-ui-topbar")
      .getByRole("button", { name: action, exact: true })
      .click();
    await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
      "Civic Action Team",
    );
    const url = new URL(page.url());
    expect(url.searchParams.get("organizationScopeType")).toBe("coalition");
    expect(url.searchParams.get("organizationScopeId")).toBe(COALITION_ID);
    await page.reload();
    await expect(page.locator(".coalition-ui-sidebar__identity")).toContainText(
      "Civic Action Team",
    );
  }
  await page
    .locator(".coalition-ui-sidebar")
    .getByRole("button", { name: "Exit workspace", exact: true })
    .click();
  await expect(page).toHaveURL(`${BASE_URL}/feed`);
  await expect(page.locator(".coalition-ui-sidebar")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("member access stays read-only and coalition pages fit a mobile viewport", async ({
  page,
}, testInfo) => {
  const { writes, errors } = await mockCoalitionWorkspace(page, {
    role: "member",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}${COALITION_PATH}/members`);
  await expect(page.locator(".coalition-people")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite person", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-route-form="coalition-invite"]'),
  ).toHaveCount(0);
  const member = page.locator("[data-coalition-member-card]").first();
  await member.locator("summary").click();
  await expect(member.locator('select[name="roleKey"]')).toBeDisabled();
  await expect(member.locator('button[type="submit"]')).toHaveCount(0);
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

for (const viewport of [
  { width: 1440, height: 1050 },
  { width: 390, height: 844 },
]) {
  test(`coalition navigation opens the approved People layout from every entry at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60000);
    const { writes, errors } = await mockCoalitionWorkspace(page);
    await page.setViewportSize(viewport);

    const expectCleanPeople = async () => {
      await expect(page.locator(".coalition-ui-heading h1")).toHaveText(
        "People",
      );
      await expect(page.locator(".coalition-people")).toBeVisible();
      await expect(page.locator("[data-coalition-member-card]")).toHaveCount(2);
      await expect(page.locator("[data-people-tab]")).toHaveCount(4);
      await expect(page.locator(".shared-coalition-admin")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Admin center", exact: true }),
      ).toHaveCount(0);
    };
    const navigation = () =>
      page.locator(
        viewport.width < 700
          ? ".coalition-ui-mobile-nav"
          : ".coalition-ui-sidebar",
      );
    const openNavigation = async () => {
      if (
        viewport.width < 700 &&
        (await navigation().getAttribute("open")) === null
      )
        await navigation().locator("summary").click();
      return navigation();
    };

    // Start at the actual coalition card, rather than bypassing its entry route.
    await page.goto(`${BASE_URL}/coalitions`);
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}`);
    await expect(page.locator(".organization-dashboard")).toBeVisible();
    await (await openNavigation())
      .getByRole("button", { name: "People", exact: true })
      .click();
    await expectCleanPeople();
    const approvedTop = await page
      .locator(".coalition-people")
      .evaluate((element) => element.getBoundingClientRect().top);

    // Old bookmarks and the canonical URL must display the same whole page.
    for (const route of ["admin", "members"]) {
      await page.goto(`${BASE_URL}${COALITION_PATH}/${route}`);
      await expectCleanPeople();
      const top = await page
        .locator(".coalition-people")
        .evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(top - approvedTop)).toBeLessThanOrEqual(2);
    }

    await (await openNavigation())
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await (await openNavigation())
      .getByRole("button", { name: "People", exact: true })
      .click();
    await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}/members`);
    await expectCleanPeople();

    await (await openNavigation())
      .getByRole("button", { name: "Administration", exact: true })
      .click();
    await expect(page).toHaveURL(`${BASE_URL}${COALITION_PATH}/admin/edit`);
    await expect(page.locator(".coalition-ui-heading h1")).toHaveText(
      "Administration",
    );
    await expect(
      page.locator('[data-route-form="coalition-profile-edit"]'),
    ).toBeVisible();
    const adminNavigation = await openNavigation();
    await expect(
      adminNavigation.getByRole("button", {
        name: "Administration",
        exact: true,
      }),
    ).toHaveClass(/is-active/);
    await expect(
      adminNavigation.getByRole("button", { name: "People", exact: true }),
    ).not.toHaveClass(/is-active/);
    await adminNavigation
      .getByRole("button", { name: "People", exact: true })
      .click();
    await expectCleanPeople();
    await page.screenshot({
      path: testInfo.outputPath(`people-navigation-${viewport.width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("coalition rooms retain the live composer in a channel workspace without changing private messages", async ({
  page,
}, testInfo) => {
  const { errors } = await mockCoalitionWorkspace(page);
  await page.routeWebSocket("**", (socket) => socket.close());
  const roomId = "field-room-demo";
  const messageWrites = [];
  const proofRequests = [];
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
    if (path === "/api/messaging/bootstrap")
      return respond({
        ok: true,
        config: { capabilities: { rooms: true, deviceRequestProofV1: true } },
        settings: {},
        deviceProofContext: {
          rootPresent: false,
          trustEpoch: 1,
          trustSetVersion: 1,
        },
      });
    // Exercise the production browser's device registration and signing rather
    // than bypassing the proof transport to make the room fixture initialize.
    const headers = request.headers();
    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers["x-messaging-device-proof-version"]).toBe("1");
    expect(headers["x-messaging-device-proof-purpose"]).toBe(
      `${request.method().toLowerCase()}:${path}`,
    );
    expect(headers["x-messaging-device-proof-signature"]).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
    proofRequests.push(path);
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
    .locator(".shared-coalition-room-entry__open")
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
  expect(proofRequests).toContain("/api/messaging/devices/register");
  expect(proofRequests.some((path) => path.endsWith("/server-directory"))).toBe(
    true,
  );
  expect(messageWrites).toEqual([]);
  expect(errors).toEqual([]);
});
