const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const GOVERNANCE = "/api/organizations/org-1/governance/v2";

function jwt(claims) {
  return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
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
      let runtimeConfig;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => runtimeConfig,
        set(value) {
          runtimeConfig = {
            ...value,
            apiBaseUrl: baseUrl,
            auth: {
              ...value?.auth,
              region: "us-west-2",
              clientId: "test-client",
            },
          };
        },
      });
    },
    {
      baseUrl: BASE_URL,
      session: {
        accessToken: jwt({
          sub: "qa-governance-member",
          email: "member@example.test",
        }),
        idToken: jwt({
          sub: "qa-governance-member",
          email: "member@example.test",
        }),
        refreshToken: "synthetic-refresh",
        expiresAt: Date.now() + 3_600_000,
      },
    },
  );
}

function vote(method = "STV", status = "PUBLISHED") {
  return {
    voteId: "vote-1",
    organizationId: "org-1",
    question:
      method === "STV" ? "Elect two delegates" : "Approve the operating plan?",
    status,
    version: 7,
    options: [
      { optionId: "alpha", label: "Alpha" },
      { optionId: "beta", label: "Beta" },
      { optionId: "gamma", label: "Gamma" },
    ],
    rules: {
      ballotMethod: method,
      privacyMode: "OPEN_ATTRIBUTED",
      paper: { allowed: false },
    },
  };
}

const rational = (numerator, denominator = 1) => ({
  numerator: String(numerator),
  denominator: String(denominator),
});

// Mirrors the backend GET-results envelope and the Flutter certified-result model.
function certifiedStvResponse() {
  return {
    ok: true,
    voteId: "vote-1",
    question: "Elect two delegates",
    options: vote().options,
    rules: vote().rules,
    result: {
      ballotMethod: "STV",
      privacyMode: "OPEN_ATTRIBUTED",
      signatureStatus: "SIGNED",
      bindingEffect: "INTERNAL_ORGANIZATION_BETA_V1",
      resultHash: "synthetic-certified-result",
      ballotSetRoot: "synthetic-ballot-root",
      stvResultSchemaVersion: "governance_open_stv_result_v3",
      tallyProfile: "OPEN_STV_EXACT_WIG_DROOP_V3",
      passed: true,
      quorumMet: true,
      ballotsCast: 10,
      countStatus: "COMPLETE",
      seats: 2,
      seatsFilled: 2,
      quota: rational(4),
      winnerOptionIds: ["alpha", "beta"],
      conservationVerified: true,
      rounds: [
        {
          round: 1,
          action: "INITIAL_COUNT",
          quota: rational(4),
          tallies: {
            alpha: rational(5),
            beta: rational(3),
            gamma: rational(2),
          },
          newlyElectedOptionIds: ["alpha"],
        },
        {
          round: 2,
          action: "TRANSFER_SURPLUS",
          actingOptionId: "alpha",
          quota: rational(4),
          tallies: {
            alpha: rational(4),
            beta: rational(11, 3),
            gamma: rational(7, 3),
          },
        },
        {
          round: 3,
          action: "ELIMINATE_AND_TRANSFER",
          actingOptionId: "gamma",
          quota: rational(4),
          tallies: {
            alpha: rational(4),
            beta: rational(6),
            gamma: rational(0),
          },
          newlyElectedOptionIds: ["beta"],
        },
      ],
    },
  };
}

async function mockGovernance(
  page,
  {
    manifest = vote(),
    result = certifiedStvResponse(),
    permissions = [],
    attest = (route) => json(route, { status: "PENDING_SECOND_ATTESTATION" }),
  } = {},
) {
  const calls = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Every request stays local; these fixtures never authenticate to a real API.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === BASE_URL
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${BASE_URL}/api/**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({
      method: request.method(),
      path,
      body: request.postDataJSON(),
    });
    if (path === "/api/profile/me") {
      return json(route, {
        profile: { userId: "qa-governance-member", displayName: "Test member" },
      });
    }
    if (path === GOVERNANCE)
      return json(route, { policy: { version: 3 }, viewer: { permissions } });
    if (path === `${GOVERNANCE}/votes`)
      return json(route, { items: [manifest] });
    if (path === `${GOVERNANCE}/votes/vote-1/results`)
      return json(route, result);
    if (path === `${GOVERNANCE}/votes/vote-1/floor-count-attestations`)
      return attest(route);
    return json(route, {});
  });
  await seedSession(page);
  return { calls, errors };
}

async function expectNoHorizontalOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

for (const width of [1280, 390]) {
  for (const method of [
    "YES_NO",
    "AGGREGATE_FLOOR_COUNT",
    "UNANIMOUS_CONSENT",
    "OBSERVED_DIVISION",
  ]) {
    test(`V2 ${method} counts and turnout render at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const manifest = vote(method);
      const result = {
        ok: true,
        voteId: "vote-1",
        result: {
          schemaVersion: "governance_physical_certified_result_payload_v1",
          ballotMethod: method,
          privacyMode: "OPEN_ATTRIBUTED",
          signatureStatus: "SIGNED",
          passed: true,
          quorumMet: true,
          counts: { YES: 6, NO: 2, ABSTAIN: 1 },
          turnout: {
            ballotsCast: 9,
            validNonAbstaining: 8,
            abstentions: 1,
            invalid: 0,
            eligibleAtSeal: 12,
            acknowledgedPresent: 10,
          },
        },
      };
      const { calls, errors } = await mockGovernance(page, {
        manifest,
        result,
      });
      await page.goto(
        `${BASE_URL}/organizations/org-1/governance/votes/vote-1/results`,
      );
      const results = page.locator(".shared-coalition-governance-results");
      await expect(
        results.locator(".shared-coalition-governance-results__top"),
      ).toContainText("Passed");
      await expect(
        results.locator(".shared-coalition-governance-results__top"),
      ).not.toContainText("Pending");
      await expect(
        results
          .locator(".shared-coalition-governance-results__metrics > div")
          .first(),
      ).toContainText("9");
      const bars = results.locator(
        ".shared-coalition-governance-result-bars > div",
      );
      await expect(bars).toHaveCount(3);
      await expect(bars.nth(0).locator("strong")).toHaveText("6");
      await expect(bars.nth(1).locator("strong")).toHaveText("2");
      await expect(bars.nth(2).locator("strong")).toHaveText("1");
      await expectNoHorizontalOverflow(page);
      expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [1280, 390]) {
  test(`certified STV renders winners and exact transfer rounds at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls, errors } = await mockGovernance(page);
    await page.goto(
      `${BASE_URL}/organizations/org-1/governance/votes/vote-1/results`,
    );
    await expect(
      page.getByRole("heading", { name: "Results", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Winners: Alpha, Beta", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(
      page.locator(".shared-coalition-governance-results__top"),
    ).toContainText("Complete");
    await expect(
      page.locator(".shared-coalition-governance-results__top"),
    ).not.toContainText("Pending");
    const rounds = page.locator('[aria-label="STV rounds"]');
    await expect(rounds.getByText("Round 2", { exact: true })).toBeVisible();
    await expect(rounds.getByText("11/3", { exact: true })).toBeVisible();
    await expect(rounds.getByText("7/3", { exact: true })).toBeVisible();
    await expect(
      rounds.getByText("Surplus transferred from: Alpha", { exact: true }),
    ).toBeVisible();
    await expect(
      rounds.getByText("Eliminated: Gamma", { exact: true }),
    ).toBeVisible();
    await expect(
      rounds.getByText("Elected this round: Beta", { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(calls.filter((call) => call.path.endsWith("/results"))).toHaveLength(
      1,
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`certified-stv-${width}.png`),
      fullPage: true,
    });
  });
}

test("unresolved certified STV shows the new-election requirement without announcing winners", async ({
  page,
}) => {
  const result = certifiedStvResponse();
  Object.assign(result.result, {
    countStatus: "INCOMPLETE_UNRESOLVED_MATERIAL_TIE",
    passed: false,
    winnerOptionIds: [],
    provisionallyElectedOptionIds: ["alpha"],
    unresolvedCountOptionIds: ["beta", "gamma"],
    tieStage: "ELIMINATION",
    requiresNewElection: true,
  });
  await mockGovernance(page, { result });
  await page.goto(
    `${BASE_URL}/organizations/org-1/governance/votes/vote-1/results`,
  );
  await expect(
    page.getByText("No winners certified - STV count incomplete", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Provisionally elected: Alpha\. They are not certified winners/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/A full new election is required/)).toBeVisible();
  await expect(page.locator('[aria-label="STV rounds"]')).toHaveCount(0);
  await expect(
    page.getByText("Winners: Alpha, Beta", { exact: true }),
  ).toHaveCount(0);
});

for (const status of ["PENDING_SECOND_ATTESTATION", "MATCHED"]) {
  test(`floor recorder submits versioned independent totals and displays ${status}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { calls, errors } = await mockGovernance(page, {
      manifest: vote("AGGREGATE_FLOOR_COUNT", "OPEN"),
      permissions: ["paper_ballot_record"],
      attest: (route) => json(route, { status }),
    });
    await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
    await expect(
      page.getByRole("heading", { name: "Aggregate floor count", exact: true }),
    ).toBeVisible();
    await page.getByLabel("For", { exact: true }).fill("12");
    await page.getByLabel("Against", { exact: true }).fill("7");
    await page.getByLabel("Abstain", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Submit attestation", exact: true })
      .click();
    await expect
      .poll(() => calls.filter((call) => call.method === "POST").length)
      .toBe(1);
    expect(calls.find((call) => call.method === "POST")).toEqual({
      method: "POST",
      path: `${GOVERNANCE}/votes/vote-1/floor-count-attestations`,
      body: { expectedVersion: 7, totals: { YES: 12, NO: 7, ABSTAIN: 2 } },
    });
    await expect(
      page.getByText(
        status === "MATCHED"
          ? "Floor count matched."
          : "Attestation saved. A matching second count is required.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit attestation", exact: true }),
    ).toBeEnabled();
    expect(calls.some((call) => call.path.endsWith("/paper-roster"))).toBe(
      false,
    );
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`floor-${status.toLowerCase()}.png`),
      fullPage: true,
    });
  });
}

test("floor verify-only member cannot submit a recorder attestation", async ({
  page,
}) => {
  const { calls } = await mockGovernance(page, {
    manifest: vote("AGGREGATE_FLOOR_COUNT", "OPEN"),
    permissions: ["paper_ballot_verify"],
  });
  await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
  await expect(
    page.getByText("Recorder permission required", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit attestation" }),
  ).toHaveCount(0);
  expect(
    calls.some(
      (call) => call.path.endsWith("/paper-roster") || call.method === "POST",
    ),
  ).toBe(false);
});

test("closed floor count disables submission", async ({ page }) => {
  const { calls } = await mockGovernance(page, {
    manifest: vote("AGGREGATE_FLOOR_COUNT", "CLOSED"),
    permissions: ["paper_ballot_record"],
  });
  await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
  await expect(
    page.getByRole("button", { name: "Submit attestation" }),
  ).toBeDisabled();
  expect(calls.some((call) => call.method === "POST")).toBe(false);
});

test("floor submission reports server rejection without claiming acceptance", async ({
  page,
}) => {
  await mockGovernance(page, {
    manifest: vote("AGGREGATE_FLOOR_COUNT", "OPEN"),
    permissions: ["paper_ballot_record"],
    attest: (route) =>
      json(route, { message: "Independent floor counts do not match." }, 409),
  });
  await page.goto(`${BASE_URL}/organizations/org-1/governance/paper/vote-1`);
  await page.getByRole("button", { name: "Submit attestation" }).click();
  await expect(page.locator(".shared-page__error")).toContainText(
    "Independent floor counts do not match.",
  );
  await expect(
    page.getByText("Floor count matched.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Submit attestation" }),
  ).toBeEnabled();
});
