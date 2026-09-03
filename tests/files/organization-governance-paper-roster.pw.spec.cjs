const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";

function jwt(claims) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
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
          name: "Governance User",
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

function vote() {
  return {
    voteId: "vote-1",
    organizationId: "org-1",
    title: "Paper ballot review",
    question: "Approve the operating plan?",
    status: "OPEN",
    version: 7,
    options: [
      { optionId: "yes", label: "Yes" },
      { optionId: "no", label: "No" },
    ],
    rules: {
      ballotMethod: "YES_NO",
      privacyMode: "OPEN_ATTRIBUTED",
      paper: { allowed: true, evidenceRequired: false },
    },
  };
}

function rosterMember(canonicalMemberKey, displayName, overrides = {}) {
  return {
    canonicalMemberKey,
    displayName,
    source: "SEALED_ORGANIZATION_ROSTER",
    linkedAccount: true,
    eligibilityStatus: "CURRENTLY_ELIGIBLE",
    attendance: { status: "ACKNOWLEDGED" },
    ballot: { status: "PAPER_PENDING_VERIFICATION" },
    ...overrides,
  };
}

async function routeGovernanceApi(page, rosterPage) {
  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/profile/me") {
      return json(route, {
        profile: {
          userId: "qa-governance-user",
          displayName: "Governance User",
          username: "governance-user",
          email: "governance@polis.test",
        },
      });
    }
    if (path === "/api/files/workspaces" && request.method() === "GET") {
      return json(route, { workspaces: [] });
    }
    if (
      path === "/api/organizations/org-1/governance/v2" &&
      request.method() === "GET"
    ) {
      return json(route, {
        policy: { version: 11 },
        viewer: { admin: true },
      });
    }
    if (
      path === "/api/organizations/org-1/governance/v2/votes" &&
      request.method() === "GET"
    ) {
      return json(route, { items: [vote()] });
    }
    if (
      path === "/api/organizations/org-1/governance/v2/vote-presets" &&
      request.method() === "GET"
    ) {
      return json(route, { items: [] });
    }
    if (
      path ===
        "/api/organizations/org-1/governance/v2/votes/vote-1/paper-roster" &&
      request.method() === "GET"
    ) {
      return rosterPage(route, url.searchParams.get("cursor") || "");
    }
    return json(route, {});
  });
}

function rosterPayload(items, nextCursor) {
  return {
    ok: true,
    voteId: "vote-1",
    voteVersion: 7,
    voteStatus: "OPEN",
    permissions: { canRecord: true, canVerify: true },
    items,
    nextCursor,
  };
}

test("paper roster loads every requested cursor page, deduplicates members, and exposes later actions", async ({
  page,
}) => {
  const requestedCursors = [];
  await seedSession(page);
  await routeGovernanceApi(page, (route, cursor) => {
    requestedCursors.push(cursor);
    if (!cursor) {
      return json(
        route,
        rosterPayload(
          [rosterMember("member-1", "First page member")],
          "paper-page-2",
        ),
      );
    }
    if (cursor === "paper-page-2") {
      return json(
        route,
        rosterPayload(
          [
            rosterMember("member-1", "First page member updated"),
            rosterMember("member-2", "Later verifier", {
              readyForVerification: true,
            }),
          ],
          "paper-page-3",
        ),
      );
    }
    return json(
      route,
      rosterPayload(
        [
          rosterMember("member-3", "Later correction", {
            readyForVoidReview: true,
            ballot: {
              status: "PAPER_VERIFIED",
              void: {
                status: "PENDING_SECOND_APPROVAL",
                voidRequestId: "void-request-3",
              },
            },
          }),
        ],
        null,
      ),
    );
  });

  await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
  await expect(
    page.getByRole("heading", { name: "Paper roster" }),
  ).toBeVisible();
  await expect(
    page.getByText("First page member", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ACKNOWLEDGED", { exact: true })).toBeVisible();
  await expect(page.getByText("[OBJECT OBJECT]", { exact: true })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Load more members" }).click();
  await expect(page.getByText("Later verifier", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
  await expect(
    page.getByText("First page member updated", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("member-1", { exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Load more members" }).click();
  await expect(
    page.getByText("Later correction", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve correction" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reject correction" }),
  ).toBeVisible();
  await expect(page.getByText("void-request-3", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more members" }),
  ).toHaveCount(0);
  expect(requestedCursors).toEqual(["", "paper-page-2", "paper-page-3"]);
});

test("paper roster stops a repeated cursor instead of requesting forever", async ({
  page,
}) => {
  const requestedCursors = [];
  await seedSession(page);
  await routeGovernanceApi(page, (route, cursor) => {
    requestedCursors.push(cursor);
    return json(
      route,
      rosterPayload(
        [
          rosterMember(
            cursor ? "member-2" : "member-1",
            cursor ? "Second member" : "First member",
          ),
        ],
        "repeated-cursor",
      ),
    );
  });

  await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
  await page.getByRole("button", { name: "Load more members" }).click();
  await expect(page.getByText("Second member", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "The paper roster returned a repeated page cursor. Refresh this page to retry safely.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more members" }),
  ).toHaveCount(0);
  expect(requestedCursors).toEqual(["", "repeated-cursor"]);
});

for (const [name, overrides] of [
  ["vote scope", { voteId: "different-vote" }],
  ["vote version", { voteVersion: 8 }],
]) {
  test(`paper roster refuses a later page with a changed ${name}`, async ({
    page,
  }) => {
    await seedSession(page);
    await routeGovernanceApi(page, (route, cursor) =>
      json(
        route,
        cursor
          ? {
              ...rosterPayload(
                [rosterMember("member-2", "Mismatched member")],
                null,
              ),
              ...overrides,
            }
          : rosterPayload(
              [rosterMember("member-1", "First member")],
              "next-page",
            ),
      ),
    );

    await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
    await page.getByRole("button", { name: "Load more members" }).click();
    await expect(
      page.getByText(
        "The paper roster changed while loading. Refresh this page before continuing.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("First member", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Mismatched member", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Load more members" }),
    ).toHaveCount(0);
  });
}

test("late paper roster pages cannot overwrite a different Governance route", async ({
  page,
}) => {
  let releasePage;
  let markRequested;
  const requested = new Promise((resolve) => {
    markRequested = resolve;
  });
  const gate = new Promise((resolve) => {
    releasePage = resolve;
  });
  await seedSession(page);
  await routeGovernanceApi(page, async (route, cursor) => {
    if (!cursor) {
      return json(
        route,
        rosterPayload(
          [rosterMember("member-1", "First member")],
          "delayed-page",
        ),
      );
    }
    markRequested();
    await gate;
    return json(
      route,
      rosterPayload([rosterMember("member-late", "Late member")], null),
    );
  });

  await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
  await page.getByRole("button", { name: "Load more members" }).click();
  await requested;
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page).toHaveURL(`${BASE_URL}/organizations/org-1/governance`);
  await expect(page.getByRole("heading", { name: "Votes" })).toBeVisible();

  releasePage();
  await page.waitForTimeout(100);
  await expect(page.getByText("Late member", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(`${BASE_URL}/organizations/org-1/governance`);
});
