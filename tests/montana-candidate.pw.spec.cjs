const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const BASE = `http://127.0.0.1:${Number(process.env.POLIS_MT_TEST_PORT || 9196)}`;
const ARTIFACTS = path.resolve(
  __dirname,
  "../output/playwright/montana-signup",
);
const LEGAL_FIELDS = {
  legalEntityLegalName: "Montana browser fixture committee",
  legalEntityEin: "123456789",
  legalEntityAddressLine1: "100 Test Street",
  legalEntityCity: "Helena",
  legalEntityRegion: "MT",
  legalEntityPostalCode: "59601",
  legalEntityRepresentativeFirstName: "Ada",
  legalEntityRepresentativeLastName: "Candidate",
  legalEntityRepresentativeTitle: "Treasurer",
  legalEntityRepresentativeEmail: "candidate@example.invalid",
  legalEntityRepresentativePhone: "+14065550100",
  legalEntityAuthorityName: "Montana",
  legalEntityRegistrationId: "fixture-id",
  legalEntityFilingUrl: "https://example.invalid/filing",
  legalEntityWebsiteUrl: "https://example.invalid/campaign",
};

async function fixture(page, { failFirst = false, delayed = false } = {}) {
  const requests = [],
    errors = [],
    external = [];
  let release;
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "montana-browser-actor", name: "Ada Candidate" })).toString("base64url")}.fixture`;
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
              clientId: "fixture",
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
    if (url.origin === BASE || !url.protocol.startsWith("http"))
      return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  await page.route(`${BASE}/api/**`, async (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (pathname === "/api/profile/me")
      return json({
        profile: {
          userId: "montana-browser-actor",
          displayName: "Ada Candidate",
          username: "ada",
        },
      });
    if (pathname === "/api/candidateApplications/me")
      return json({ error: "not_found" }, 404);
    if (
      pathname === "/api/candidateApplications" &&
      request.method() === "POST"
    ) {
      requests.push(request.postDataJSON());
      if (delayed)
        await new Promise((resolve) => {
          release = resolve;
        });
      if (failFirst && requests.length === 1)
        return json({ error: "fixture_submission_failed" }, 503);
      return json(
        { applicationId: "montana-browser-application", status: "pending" },
        201,
      );
    }
    return json({ items: [], candidates: [], districts: [], workspaces: [] });
  });
  await page.goto(`${BASE}/settings/candidate-access/name`);
  await expect(
    page.getByRole("heading", { name: "Legal name", exact: true }),
  ).toBeVisible();
  await page.locator('input[name="firstName"]').fill("Ada");
  await page.locator('input[name="lastName"]').fill("Candidate");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Campaign committee", exact: true }),
  ).toBeVisible();
  for (const [field, value] of Object.entries(LEGAL_FIELDS))
    await page.locator(`input[name="${field}"]`).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Office and filing details",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Government level", exact: true })
    .selectOption("State");
  await page
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption("MT");
  return { requests, errors, external, release: () => release?.() };
}

test("Montana offices, required PSC district, failure and successful retry work in the full website", async ({
  page,
}) => {
  const capture = await fixture(page, { failFirst: true });
  const office = page.getByRole("combobox", { name: "Office", exact: true });
  await expect(office.locator("option")).toHaveCount(14);
  await expect(office).toContainText("Montana State House");
  await expect(office).toContainText("Montana State Senate");
  await expect(office).toContainText("Montana Public Service Commission");
  await expect(office).toContainText("Clerk of the Supreme Court");
  await expect(office).not.toContainText("Treasurer");
  await office.selectOption("Public Service Commissioner");
  await page.locator('input[name="electionCycle"]').fill("2028");
  const district = page.getByRole("combobox", {
    name: "Public Service Commission district",
    exact: true,
  });
  await expect(district.locator("option")).toHaveCount(6);
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  expect(capture.requests).toHaveLength(0);
  await district.selectOption("5");
  await page
    .locator('input[name="electionCycle"]')
    .fill(String(new Date().getUTCFullYear() + 9));
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect(page.locator(".shared-settings-return.is-error")).toContainText(
    "or leave it blank",
  );
  expect(capture.requests).toHaveLength(0);
  await page.locator('input[name="electionCycle"]').fill("2028");
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect(page.locator(".shared-settings-return.is-error")).toContainText(
    "fixture_submission_failed",
  );
  await expect(district).toHaveValue("5");
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect(
    page.locator(".shared-settings-return.is-success"),
  ).toContainText("Application submitted");
  expect(capture.requests).toHaveLength(2);
  expect(capture.requests[1]).toEqual(capture.requests[0]);
  expect(capture.requests[1]).toMatchObject({
    level: "state",
    state: "MT",
    office: "Public Service Commissioner",
    district: "5",
    electionCycle: "2028",
  });
  expect(capture.requests[1].fecCandidateId).toBeUndefined();
  expect(capture.errors).toEqual([]);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({
    path: path.join(ARTIFACTS, "psc-submitted.png"),
    fullPage: true,
  });
});

test("judicial departments restore across Back and state changes clear district and seat", async ({
  page,
}) => {
  const capture = await fixture(page);
  await page
    .getByRole("combobox", { name: "Office", exact: true })
    .selectOption("District Court Judge");
  await page
    .getByRole("combobox", { name: "Judicial district", exact: true })
    .selectOption("13");
  await page
    .getByRole("combobox", { name: "District Court department", exact: true })
    .selectOption("10");
  await page.locator('input[name="electionCycle"]').fill("2028");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Campaign committee", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Judicial district", exact: true }),
  ).toHaveValue("13");
  await expect(
    page.getByRole("combobox", {
      name: "District Court department",
      exact: true,
    }),
  ).toHaveValue("10");
  await expect(page.locator('input[name="electionCycle"]')).toHaveValue("2028");
  await page.locator('input[name="electionCycle"]').fill("");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('input[name="electionCycle"]')).toHaveValue("");
  await page
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption("WA");
  await expect(
    page.getByRole("combobox", { name: "Office", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Office", exact: true }),
  ).toContainText("Treasurer");
  await expect(page.locator('select[name="seat"]')).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption("MT");
  await page
    .getByRole("combobox", { name: "Office", exact: true })
    .selectOption("Supreme Court Justice");
  await page
    .getByRole("combobox", { name: "Supreme Court justice seat", exact: true })
    .selectOption("6");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", {
      name: "Supreme Court justice seat",
      exact: true,
    }),
  ).toHaveValue("6");
  expect(capture.errors).toEqual([]);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({
    path: path.join(ARTIFACTS, "justice-mobile.png"),
    fullPage: true,
  });
});

test("pending duplicate clicks and logout cannot surface a late application result", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const capture = await fixture(page, { delayed: true });
  await page
    .getByRole("combobox", { name: "Office", exact: true })
    .selectOption("Governor");
  await expect(
    page.getByText(/elected together on a joint ticket/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submitting...", exact: true }),
  ).toBeDisabled();
  expect(capture.requests).toHaveLength(1);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  capture.release();
  await expect(page.locator(".shared-settings-return.is-success")).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Application submitted. Status: pending.", { exact: true }),
  ).toHaveCount(0);
  expect(capture.requests).toHaveLength(1);
  expect(capture.errors).toEqual([]);
});
