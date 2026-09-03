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

function governanceVote({
  ballotMethod,
  presetId,
  privacyMode = "OPEN_ATTRIBUTED",
  sessionId = "",
}) {
  return {
    voteId: "vote-1",
    organizationId: "org-1",
    title: "Existing Governance vote",
    question: "Preserve this ballot method?",
    description: "Existing description",
    sessionId,
    status: "DRAFT",
    version: 7,
    options: [
      { optionId: "yes", label: "Yes" },
      { optionId: "no", label: "No" },
    ],
    rules: {
      presetId,
      ballotMethod,
      privacyMode,
      participation: {
        remoteEnabled: false,
        sessionRequired: Boolean(sessionId),
      },
      paper: {
        allowed: true,
        evidenceRequired: false,
      },
    },
  };
}

const PRESETS = [
  {
    presetId: "simple_majority",
    label: "Simple majority",
    available: true,
    rules: { ballotMethod: "YES_NO" },
  },
  {
    presetId: "unanimous_consent",
    label: "Unanimous consent",
    available: true,
    rules: { ballotMethod: "UNANIMOUS_CONSENT" },
  },
  {
    presetId: "aggregate_floor_count",
    label: "Aggregate floor count",
    available: true,
    rules: { ballotMethod: "AGGREGATE_FLOOR_COUNT" },
  },
  {
    presetId: "open_irv",
    label: "Open ranked-choice (IRV)",
    available: true,
    rules: { ballotMethod: "IRV" },
  },
  {
    presetId: "open_stv",
    label: "Open single transferable vote",
    available: false,
    unavailableReason: "open_stv_tally_profile_pending_independent_review",
    rules: { ballotMethod: "STV" },
  },
];

async function routeGovernanceApi(page, captures, vote) {
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
      return json(route, { items: [vote] });
    }
    if (
      path === "/api/organizations/org-1/governance/v2/votes" &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData() || "{}");
      captures.creates.push(body);
      return json(route, {
        ok: true,
        vote: {
          ...governanceVote({
            ballotMethod: body.rules?.ballotMethod || "YES_NO",
            presetId: body.presetId || "simple_majority",
            privacyMode: body.rules?.privacyMode || "OPEN_ATTRIBUTED",
            sessionId: body.sessionId || "",
          }),
          voteId: "vote-created",
          question: body.question,
          version: 1,
        },
      });
    }
    if (
      path === "/api/organizations/org-1/governance/v2/vote-presets" &&
      request.method() === "GET"
    ) {
      return json(route, { items: PRESETS });
    }
    if (
      path === "/api/organizations/org-1/governance/v2/votes/vote-1" &&
      request.method() === "PATCH"
    ) {
      captures.updates.push(JSON.parse(request.postData() || "{}"));
      return json(route, { ok: true, vote });
    }

    captures.unhandled.push(`${request.method()} ${path}`);
    return json(route, {});
  });
}

for (const [ballotMethod, presetId] of [
  ["AGGREGATE_FLOOR_COUNT", "aggregate_floor_count"],
  ["UNANIMOUS_CONSENT", "unanimous_consent"],
  ["STV", "open_stv"],
]) {
  test(`editing preserves ${ballotMethod} and omits preset replacement`, async ({
    page,
  }) => {
    const vote = governanceVote({ ballotMethod, presetId });
    const captures = { creates: [], updates: [], unhandled: [] };
    await seedSession(page);
    await routeGovernanceApi(page, captures, vote);

    await page.goto(
      `${BASE_URL}/organizations/org-1/governance/votes/vote-1/edit`,
    );
    await expect(
      page.getByRole("heading", { name: "Edit Governance vote" }),
    ).toBeVisible();

    const methodSelect = page.locator('select[name="ballotMethod"]');
    await expect(methodSelect).toHaveValue(ballotMethod);
    const methodValues = await methodSelect
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value));
    expect(methodValues).toContain("IRV");
    expect(methodValues).not.toContain("OPEN_ATTRIBUTED");
    expect(methodValues).not.toContain("RANKED_CHOICE");
    if (ballotMethod === "STV") {
      expect(methodValues).toContain("STV");
    } else {
      expect(methodValues).not.toContain("STV");
    }

    const presetControl = page
      .getByText("Preset", { exact: true })
      .locator("..")
      .locator("input");
    await expect(presetControl).toBeDisabled();
    await page.locator('input[name="question"]').fill("Updated wording only");
    await page.getByRole("button", { name: "Save vote" }).click();
    await expect.poll(() => captures.updates.length).toBe(1);

    const update = captures.updates[0];
    expect(update).not.toHaveProperty("presetId");
    expect(update.expectedVersion).toBe(7);
    expect(update.question).toBe("Updated wording only");
    expect(update).not.toHaveProperty("options");
    expect(update.rules.ballotMethod).toBe(ballotMethod);
    expect(update.rules.participation).toEqual({ remoteEnabled: false });
    expect(update.rules.paper).toEqual({
      allowed: true,
      evidenceRequired: false,
    });
    expect(update.rules).not.toHaveProperty("remoteEnabled");
    expect(update.rules).not.toHaveProperty("paperAllowed");
  });
}

test("wording-only edit preserves anonymous privacy and option identities", async ({
  page,
}) => {
  const vote = governanceVote({
    ballotMethod: "YES_NO",
    presetId: "simple_majority",
    privacyMode: "ANONYMOUS_UNLINKABLE",
  });
  const captures = { creates: [], updates: [], unhandled: [] };
  await seedSession(page);
  await routeGovernanceApi(page, captures, vote);

  await page.goto(
    `${BASE_URL}/organizations/org-1/governance/votes/vote-1/edit`,
  );
  const privacySelect = page.locator('select[name="privacyMode"]');
  await expect(privacySelect).toHaveValue("ANONYMOUS_UNLINKABLE");
  await expect(
    privacySelect.locator('option[value="ANONYMOUS_UNLINKABLE"]'),
  ).toHaveCount(1);

  await page.locator('input[name="question"]').fill("Anonymous wording update");
  await page.getByRole("button", { name: "Save vote" }).click();
  await expect.poll(() => captures.updates.length).toBe(1);

  const update = captures.updates[0];
  expect(update.rules.privacyMode).toBe("ANONYMOUS_UNLINKABLE");
  expect(update).not.toHaveProperty("options");
});

test("inserting an option reserves every exact-label identity first", async ({
  page,
}) => {
  const vote = governanceVote({
    ballotMethod: "YES_NO",
    presetId: "simple_majority",
  });
  const captures = { creates: [], updates: [], unhandled: [] };
  await seedSession(page);
  await routeGovernanceApi(page, captures, vote);

  await page.goto(
    `${BASE_URL}/organizations/org-1/governance/votes/vote-1/edit`,
  );
  await page.locator('textarea[name="options"]').fill("Maybe\nYes\nNo");
  await page.getByRole("button", { name: "Save vote" }).click();
  await expect.poll(() => captures.updates.length).toBe(1);

  expect(captures.updates[0].options).toEqual([
    { optionId: "option-1", label: "Maybe" },
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ]);
});

test("edit clears description and session with explicit empty fields", async ({
  page,
}) => {
  const vote = governanceVote({
    ballotMethod: "YES_NO",
    presetId: "simple_majority",
    sessionId: "session-1",
  });
  const captures = { creates: [], updates: [], unhandled: [] };
  await seedSession(page);
  await routeGovernanceApi(page, captures, vote);

  await page.goto(
    `${BASE_URL}/organizations/org-1/governance/votes/vote-1/edit`,
  );
  await page.locator('textarea[name="description"]').fill("");
  await page.locator('input[name="sessionId"]').fill("");
  await page.getByRole("button", { name: "Save vote" }).click();
  await expect.poll(() => captures.updates.length).toBe(1);

  const update = captures.updates[0];
  expect(update.description).toBe("");
  expect(update.sessionId).toBe("");
  expect(update).not.toHaveProperty("clearDescription");
  expect(update).not.toHaveProperty("clearSession");
});

test("create uses version zero and the nested Governance rule contract", async ({
  page,
}) => {
  const vote = governanceVote({
    ballotMethod: "YES_NO",
    presetId: "simple_majority",
  });
  const captures = { creates: [], updates: [], unhandled: [] };
  await seedSession(page);
  await routeGovernanceApi(page, captures, vote);

  await page.goto(`${BASE_URL}/organizations/org-1/governance/votes/new`);
  await expect(
    page.getByRole("heading", { name: "Create Governance vote" }),
  ).toBeVisible();
  await page.locator('input[name="question"]').fill("Create contract vote?");
  await page.getByRole("button", { name: "Create vote" }).click();
  await expect.poll(() => captures.creates.length).toBe(1);

  const create = captures.creates[0];
  expect(create.expectedVersion).toBe(0);
  expect(create.presetId).toBe("simple_majority");
  expect(create.rules).toEqual({
    ballotMethod: "YES_NO",
    privacyMode: "OPEN_ATTRIBUTED",
    participation: { remoteEnabled: true },
    paper: { allowed: false, evidenceRequired: false },
  });
});
