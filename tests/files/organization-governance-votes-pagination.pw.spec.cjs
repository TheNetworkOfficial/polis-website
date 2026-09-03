const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const GOVERNANCE_PATH = "/api/organizations/org-1/governance/v2";

function jwt(claims) {
  return `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function seedSession(page) {
  await page.addInitScript(
    ({ session, baseUrl }) => {
      localStorage.setItem(
        "sharedFeedSessionPersisted.v1",
        JSON.stringify(session),
      );
      sessionStorage.setItem("sharedFeedSession.v1", JSON.stringify(session));
      let runtimeConfig = null;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get() {
          return runtimeConfig;
        },
        set(value) {
          runtimeConfig = {
            ...(value || {}),
            apiBaseUrl: baseUrl,
            auth: {
              ...((value && value.auth) || {}),
              region: "us-west-2",
              clientId: "test-cognito-client",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    {
      baseUrl: BASE_URL,
      session: {
        accessToken: jwt({
          sub: "qa-governance-user",
          email: "governance@polis.test",
          scope: "aws.cognito.signin.user.admin",
        }),
        idToken: jwt({
          sub: "qa-governance-user",
          email: "governance@polis.test",
          name: "Governance User",
        }),
        refreshToken: "qa-refresh",
        expiresAt: Date.now() + 3_600_000,
      },
    },
  );
}

function vote(id = "vote-1", overrides = {}) {
  return {
    voteId: id,
    organizationId: "org-1",
    title: `Vote ${id}`,
    question: `Question for ${id}`,
    status: "OPEN",
    version: 7,
    options: [
      { optionId: "yes", label: "Yes" },
      { optionId: "no", label: "No" },
    ],
    rules: {
      ballotMethod: "YES_NO",
      privacyMode: "OPEN_ATTRIBUTED",
      paper: { allowed: true },
    },
    ...overrides,
  };
}

async function routeGovernanceApi(page, votesPage) {
  await seedSession(page);
  await page.route(`${BASE_URL}/api/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/profile/me") {
      return json(route, {
        profile: {
          userId: "qa-governance-user",
          displayName: "Governance User",
          username: "governance-user",
          email: "governance@polis.test",
        },
      });
    }
    if (url.pathname === "/api/files/workspaces")
      return json(route, { workspaces: [] });
    if (url.pathname === GOVERNANCE_PATH)
      return json(route, { policy: { version: 11 }, viewer: { admin: true } });
    if (url.pathname === `${GOVERNANCE_PATH}/vote-presets`)
      return json(route, { items: [] });
    if (
      url.pathname === `${GOVERNANCE_PATH}/votes` &&
      request.method() === "GET"
    ) {
      expect(url.searchParams.get("limit")).toBe("100");
      return votesPage(route, url.searchParams.get("cursor") || "");
    }
    if (url.pathname.startsWith(`${GOVERNANCE_PATH}/votes/`)) {
      return json(route, { vote: vote(url.pathname.split("/").at(-1)) });
    }
    return json(route, {});
  });
}

const loadMore = (page) =>
  page.getByRole("button", { name: "Load more votes", exact: true });

test("votes beyond the first 100 remain discoverable with deduplicated actions", async ({
  page,
}) => {
  const cursors = [];
  await routeGovernanceApi(page, (route, cursor) => {
    cursors.push(cursor);
    return json(
      route,
      cursor
        ? {
            items: [vote("vote-1"), vote("older-vote")],
            nextCursor: null,
          }
        : {
            items: Array.from({ length: 100 }, (_, index) =>
              vote(`vote-${index + 1}`),
            ),
            nextCursor: "opaque.v1.page-2",
          },
    );
  });
  await page.goto(`${BASE_URL}/organizations/org-1/governance`);
  await expect(
    page.getByRole("heading", { name: "Vote vote-100", exact: true }),
  ).toBeVisible();
  await loadMore(page).click();
  const older = page.locator(".shared-organization-governance-vote").filter({
    has: page.getByRole("heading", { name: "Vote older-vote", exact: true }),
  });
  await expect(older).toBeVisible();
  await expect(
    older.getByRole("button", { name: "Paper", exact: true }),
  ).toBeEnabled();
  await expect(
    older.getByRole("button", { name: "Audit", exact: true }),
  ).toBeEnabled();
  await expect(
    older.getByRole("button", { name: "Edit", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Vote vote-1", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(".shared-organization-governance-vote"),
  ).toHaveCount(101);
  await expect(loadMore(page)).toHaveCount(0);
  expect(cursors).toEqual(["", "opaque.v1.page-2"]);
});

for (const routePath of ["", "/paper", "/audit-cases"]) {
  test(`empty or filtered ${routePath || "overview"} picker can reach a later vote`, async ({
    page,
  }) => {
    await routeGovernanceApi(page, (route, cursor) =>
      json(
        route,
        cursor
          ? {
              items: [vote("later-eligible")],
              nextCursor: null,
            }
          : {
              items:
                routePath === "/paper"
                  ? [
                      vote("remote-only", {
                        rules: { paper: { allowed: false } },
                      }),
                    ]
                  : [],
              nextCursor: "later-page",
            },
      ),
    );
    await page.goto(`${BASE_URL}/organizations/org-1/governance${routePath}`);
    await expect(loadMore(page)).toBeVisible();
    await loadMore(page).click();
    await expect(
      page.getByRole("heading", { name: "Vote later-eligible", exact: true }),
    ).toBeVisible();
    await expect(loadMore(page)).toHaveCount(0);
  });
}

for (const initiallyListed of [true, false]) {
  test(`loading more preserves the ${initiallyListed ? "listed" : "directly fetched"} focused vote and version`, async ({
    page,
  }) => {
    await routeGovernanceApi(page, (route, cursor) =>
      json(
        route,
        cursor
          ? {
              items: [
                vote("vote-1", {
                  title: "Changed concurrent vote",
                  version: 99,
                }),
                vote("other"),
              ],
              nextCursor: null,
            }
          : {
              items: [vote(initiallyListed ? "vote-1" : "first")],
              nextCursor: "duplicates",
            },
      ),
    );
    await page.goto(`${BASE_URL}/organizations/org-1/governance/votes/vote-1`);
    await loadMore(page).click();
    await expect(
      page.getByRole("heading", { name: "Vote other", exact: true }),
    ).toBeVisible();
    const focused = page.locator(
      ".shared-organization-governance-vote.is-focused",
    );
    await expect(
      focused.getByRole("heading", { name: "Vote vote-1", exact: true }),
    ).toBeVisible();
    await expect(
      focused.locator(".shared-coalition-governance-meta"),
    ).toContainText("7");
    await expect(
      page.getByRole("heading", { name: "Changed concurrent vote" }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(
      `${BASE_URL}/organizations/org-1/governance/votes/vote-1`,
    );
  });
}

test("a failed vote page is retryable without losing loaded votes", async ({
  page,
}) => {
  let attempts = 0;
  const cursors = [];
  await routeGovernanceApi(page, (route, cursor) => {
    cursors.push(cursor);
    if (!cursor)
      return json(route, { items: [vote()], nextCursor: "retry-page" });
    attempts += 1;
    if (attempts === 1)
      return json(route, { message: "Temporary vote page failure" }, 503);
    return json(route, { items: [vote("retried")], nextCursor: null });
  });
  await page.goto(`${BASE_URL}/organizations/org-1/governance`);
  await loadMore(page).click();
  await expect(page.locator(".shared-page__error")).toContainText(
    "Temporary vote page failure",
  );
  await expect(
    page.getByRole("heading", { name: "Vote vote-1", exact: true }),
  ).toBeVisible();
  await loadMore(page).click();
  await expect(
    page.getByRole("heading", { name: "Vote retried", exact: true }),
  ).toBeVisible();
  expect(cursors).toEqual(["", "retry-page", "retry-page"]);
});

test("repeated vote cursors stop safely with loaded votes retained", async ({
  page,
}) => {
  const cursors = [];
  await routeGovernanceApi(page, (route, cursor) => {
    cursors.push(cursor);
    return json(route, {
      items: [vote(cursor ? "later" : "vote-1")],
      nextCursor: "repeated",
    });
  });
  await page.goto(`${BASE_URL}/organizations/org-1/governance`);
  await loadMore(page).click();
  await expect(
    page.getByRole("heading", { name: "Vote later", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The vote list returned a repeated page cursor. Refresh this page to retry safely.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(loadMore(page)).toHaveCount(0);
  expect(cursors).toEqual(["", "repeated"]);
});

for (const action of ["refresh", "navigate"]) {
  test(`a delayed vote page cannot overwrite a newer ${action}`, async ({
    page,
  }) => {
    let releasePage;
    let markRequested;
    let firstPages = 0;
    const requested = new Promise((resolve) => {
      markRequested = resolve;
    });
    const gate = new Promise((resolve) => {
      releasePage = resolve;
    });
    await routeGovernanceApi(page, async (route, cursor) => {
      if (!cursor) {
        firstPages += 1;
        return json(route, {
          items: [vote(`fresh-${firstPages}`)],
          nextCursor: firstPages === 1 ? "delayed" : null,
        });
      }
      markRequested();
      await gate;
      return json(route, {
        items: [vote("stale")],
        nextCursor: "stale-cursor",
      });
    });
    await page.goto(`${BASE_URL}/organizations/org-1/governance`);
    await loadMore(page).click();
    await requested;
    if (action === "refresh") {
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    } else {
      await page
        .locator(".shared-organization-governance-tabs")
        .getByRole("button", { name: "Paper", exact: true })
        .click();
    }
    await expect(
      page.getByRole("heading", { name: "Vote fresh-2", exact: true }),
    ).toBeVisible();
    const response = page.waitForResponse((value) =>
      value.url().includes("cursor=delayed"),
    );
    releasePage();
    await response;
    await page.waitForTimeout(100);
    await expect(
      page.getByRole("heading", { name: "Vote stale", exact: true }),
    ).toHaveCount(0);
    await expect(loadMore(page)).toHaveCount(0);
    await expect(page).toHaveURL(
      `${BASE_URL}/organizations/org-1/governance${action === "navigate" ? "/paper" : ""}`,
    );
  });
}

test("a foreign organization page is never appended", async ({ page }) => {
  await routeGovernanceApi(page, (route, cursor) =>
    json(
      route,
      cursor
        ? {
            items: [vote("foreign", { organizationId: "org-2" })],
            nextCursor: null,
          }
        : { items: [vote()], nextCursor: "foreign-page" },
    ),
  );
  await page.goto(`${BASE_URL}/organizations/org-1/governance`);
  await loadMore(page).click();
  await expect(
    page.getByText(
      "The vote page belongs to a different organization. Refresh to retry safely.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Vote foreign", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Vote vote-1", exact: true }),
  ).toBeVisible();
});
