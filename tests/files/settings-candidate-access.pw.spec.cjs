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

function collectPageErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  return { consoleErrors, pageErrors };
}

async function expectNoHorizontalOverflow(page) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(Math.max(box.scrollWidth, box.bodyScrollWidth)).toBeLessThanOrEqual(
    box.clientWidth + 2,
  );
}

async function seedSession(page, now) {
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
          sub: "qa-candidate-access-user",
          email: "candidate@example.test",
          name: "Taylor Example",
          username: "candidate-access-user",
          scope: "aws.cognito.signin.user.admin",
        }),
        idToken: jwt({
          sub: "qa-candidate-access-user",
          email: "candidate@example.test",
          name: "Taylor Example",
          username: "candidate-access-user",
        }),
        refreshToken: "qa-refresh",
        expiresAt: now + 3600000,
      },
    },
  );
}

async function routeCandidateAccessApi(page, captures, options = {}) {
  const postResponses = [...(options.postResponses || [])];
  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/profile/me") {
      return json(route, {
        profile: {
          userId: "qa-candidate-access-user",
          displayName: "Taylor Example",
          username: "candidate-access-user",
          email: "candidate@example.test",
        },
      });
    }

    if (path === "/api/files/workspaces" && request.method() === "GET") {
      return json(route, { workspaces: [] });
    }

    if (path === "/api/candidateApplications/me") {
      return json(route, {});
    }

    if (path === "/api/candidateApplications" && request.method() === "POST") {
      captures.applications.push({
        authorization: request.headers().authorization || "",
        body: JSON.parse(request.postData() || "{}"),
      });
      const response = postResponses.shift() || {
        body: { applicationId: "cand-app-1", status: "pending" },
        status: 200,
      };
      return json(route, response.body, response.status);
    }

    captures.unhandled.push(`${request.method()} ${path}`);
    return json(route, {});
  });
}

async function fillCandidateName(page) {
  await page.getByLabel("First name").fill("Taylor");
  await page.getByLabel("Middle name").fill("Q");
  await page.getByLabel("Last name").fill("Example");
}

async function fillCampaignCommittee(page, ein = "123456789") {
  await page
    .getByLabel("Legal entity name", { exact: true })
    .fill("Example Candidate Committee");
  await page.getByLabel("EIN", { exact: true }).fill(ein);
  await page.getByLabel("Address line 1", { exact: true }).fill("100 Main St");
  await page.getByLabel("Address line 2", { exact: true }).fill("Suite 10");
  await page.getByLabel("City", { exact: true }).fill("Helena");
  await page.getByLabel("State", { exact: true }).fill("MT");
  await page.getByLabel("ZIP code", { exact: true }).fill("59601");
  await page.getByLabel("First name", { exact: true }).fill("Jordan");
  await page.getByLabel("Last name", { exact: true }).fill("Signer");
  await page.getByLabel("Title", { exact: true }).fill("Treasurer");
  await page.getByLabel("Email", { exact: true }).fill("treasurer@example.com");
  await page.getByLabel("Phone", { exact: true }).fill("+14065550100");
  await page
    .getByLabel("Election authority", { exact: true })
    .fill("State Election Office");
  await page.getByLabel("Registration ID", { exact: true }).fill("C-2026-001");
  await page
    .getByLabel("Public filing URL", { exact: true })
    .fill("https://example.com/filings/example");
  await page
    .getByLabel("Public website URL", { exact: true })
    .fill("https://example.com");
}

async function continueToOffice(page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/office$/u);
  await page.getByLabel("Government level").selectOption("State");
  await page.getByLabel("Office").selectOption("Governor");
  await page.locator('input[name="state"]').fill("MT");
}

async function openCandidateApplication(page) {
  await page.goto(`${BASE_URL}/settings/candidate-access/name`);
  await expect(page.getByRole("heading", { name: "Legal name" })).toBeVisible();
  await fillCandidateName(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/legal-entity$/u);
  await fillCampaignCommittee(page);
  await continueToOffice(page);
}

test("candidate access preserves steps, derives the address, and clears EIN after success", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = collectPageErrors(page);
  const captures = {
    applications: [],
    unhandled: [],
  };

  await seedSession(page, Date.now());
  await routeCandidateAccessApi(page, captures);

  await page.setViewportSize({ width: 1366, height: 920 });
  await page.goto(`${BASE_URL}/settings/candidate-access/name`);
  await expect(page.getByRole("heading", { name: "Legal name" })).toBeVisible();

  await fillCandidateName(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/settings\/candidate-access\/legal-entity$/u);
  await expect(
    page.getByRole("heading", { name: "Campaign committee", exact: true }),
  ).toBeVisible();

  await fillCampaignCommittee(page);

  const einHelp = page.getByRole("button", { name: "Help for EIN" });
  await einHelp.click();
  const helpDialog = page.getByRole("dialog", { name: "About EIN" });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog.getByText("What this means")).toBeVisible();
  await expect(helpDialog.getByText("Where to find it")).toBeVisible();
  await expect(helpDialog.getByText("Common confusion")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpDialog).toHaveCount(0);
  await expect(einHelp).toBeFocused();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/name$/u);
  await expect(
    page.getByRole("heading", { name: "Legal name", exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[name="firstName"]')).toHaveValue("Taylor");
  await expect(page.locator('input[name="lastName"]')).toHaveValue("Example");

  await page.getByRole("button", { name: /Campaign committee/u }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/legal-entity$/u);
  await expect(
    page.getByLabel("Legal entity name", { exact: true }),
  ).toHaveValue("Example Candidate Committee");
  await expect(page.getByLabel("EIN", { exact: true })).toHaveValue(
    "123456789",
  );

  await continueToOffice(page);
  await expect(page.locator('[name="campaignAddress"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Submit application" }).click();

  await expect.poll(() => captures.applications.length).toBe(1);
  expect(captures.applications[0].authorization).toMatch(/^Bearer .+/u);
  expect(captures.applications[0].body).toEqual(
    expect.objectContaining({
      fullName: "Taylor Q Example",
      firstName: "Taylor",
      middleName: "Q",
      lastName: "Example",
      campaignAddress: "100 Main St, Suite 10, Helena MT 59601, US",
      level: "state",
      office: "Governor",
      state: "MT",
      legalEntityProfile: {
        legalName: "Example Candidate Committee",
        committeeClassification: "candidate_committee",
        address: {
          line1: "100 Main St",
          line2: "Suite 10",
          city: "Helena",
          region: "MT",
          postalCode: "59601",
          country: "US",
        },
        authorizedRepresentative: {
          firstName: "Jordan",
          lastName: "Signer",
          title: "Treasurer",
          email: "treasurer@example.com",
          phone: "+14065550100",
        },
        electionRegistration: {
          registrationStatus: "registered",
          authorityName: "State Election Office",
          registrationId: "C-2026-001",
          filingUrl: "https://example.com/filings/example",
        },
        websiteUrl: "https://example.com",
        ein: "123456789",
      },
    }),
  );
  await expect(
    page.locator(".shared-settings-return.is-success", {
      hasText: "Application submitted. Status: pending.",
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "output/playwright/settings-candidate-access-desktop.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/legal-entity$/u);
  await expect(page.getByLabel("EIN", { exact: true })).toHaveValue("");
  await expect(page.locator("body")).not.toContainText("123456789");

  expect(captures.unhandled).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test("candidate access deep links and field help remain usable on mobile", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = collectPageErrors(page);
  const captures = {
    applications: [],
    unhandled: [],
  };

  await seedSession(page, Date.now());
  await routeCandidateAccessApi(page, captures);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`${BASE_URL}/settings/candidate-access/legal-entity`);
  await expect(
    page.getByRole("heading", { name: "Campaign committee", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-action="candidate-access-help-open"]'),
  ).toHaveCount(18);
  await page
    .getByRole("button", { name: "Help for public filing URL" })
    .click();
  const helpDialog = page.getByRole("dialog", {
    name: "About Public filing URL",
  });
  await expect(helpDialog).toBeVisible();
  await expect(
    helpDialog.getByText("https://www.fec.gov/data/committee/C00123456/", {
      exact: false,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "output/playwright/settings-candidate-access-mobile-help.png",
    fullPage: true,
  });
  await helpDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(helpDialog).toHaveCount(0);

  await page.goto(`${BASE_URL}/settings/candidate-access/office`);
  await expect(
    page.getByRole("heading", { name: "Office and filing details" }),
  ).toBeVisible();
  await expect(page.locator('[name="campaignAddress"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  expect(captures.applications).toEqual([]);
  expect(captures.unhandled).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test("candidate access retains EIN for retry and clears it after a malformed success payload", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = collectPageErrors(page);
  const captures = {
    applications: [],
    unhandled: [],
  };

  await seedSession(page, Date.now());
  await routeCandidateAccessApi(page, captures, {
    postResponses: [
      { body: { message: "Temporary review service failure." }, status: 503 },
      { body: [], status: 200 },
    ],
  });

  await page.setViewportSize({ width: 1366, height: 920 });
  await openCandidateApplication(page);
  await page.getByRole("button", { name: "Submit application" }).click();

  await expect.poll(() => captures.applications.length).toBe(1);
  await expect(page.locator(".shared-settings-return.is-error")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/legal-entity$/u);
  await expect(page.getByLabel("EIN", { exact: true })).toHaveValue(
    "123456789",
  );

  await continueToOffice(page);
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect.poll(() => captures.applications.length).toBe(2);
  await expect(
    page.locator(".shared-settings-return.is-success", {
      hasText: "Application submitted. Status: pending.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/candidate-access\/legal-entity$/u);
  await expect(page.getByLabel("EIN", { exact: true })).toHaveValue("");
  expect(captures.applications[1].body.legalEntityProfile.ein).toBe(
    "123456789",
  );
  expect(captures.unhandled).toEqual([]);
  expect(
    errors.consoleErrors.filter(
      (message) => !message.includes("503 (Service Unavailable)"),
    ),
  ).toEqual([]);
  expect(
    errors.consoleErrors.some((message) =>
      message.includes("503 (Service Unavailable)"),
    ),
  ).toBe(true);
  expect(errors.pageErrors).toEqual([]);
});
