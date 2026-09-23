const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const INTAKE_PATH = "/api/text-banking/prompt-intake/coalition%3Aorg-1";

test("registration keeps required steps, secure token entry and website acknowledgment in the redesigned shell", async ({
  page,
}) => {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "registration-admin", email: "admin@example.test" })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ baseUrl, token }) => {
      const session = {
        accessToken: token,
        idToken: token,
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem("sharedFeedSession.v1", JSON.stringify(session));
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

  let saved = null;
  const writes = [];
  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (!path.startsWith(INTAKE_PATH)) return respond({});
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      writes.push({
        method: "PUT",
        body,
        authorization: request.headers().authorization,
      });
      const { campaignVerify, ...packet } = body.packet;
      saved = {
        intakeId: "registration",
        revision: body.expectedRevision + 1,
        status: "ready_for_handoff",
        packet,
        campaignVerify: {
          hasToken: true,
          expiresOn: campaignVerify.expiresOn,
          lastOperationId: campaignVerify.operationId,
          status: "not_submitted",
        },
        canSend: false,
        manualOnly: true,
      };
    } else if (request.method() === "POST" && path.endsWith("/submit")) {
      const body = request.postDataJSON();
      writes.push({
        method: "POST",
        body,
        authorization: request.headers().authorization,
      });
      saved = {
        ...saved,
        revision: saved.revision + 1,
        status: "submitted",
        submittedAt: "2026-09-23T18:00:00.000Z",
      };
    }
    return respond({
      ok: true,
      guidelinesVersion: "polis-10dlc-website-2026-09-17",
      intake: saved,
    });
  });

  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.goto(`${BASE_URL}/organizations/org-1/texting/registration`);
  const logo = page.locator(".pt-brand img");
  await expect(logo).toBeVisible();
  await expect
    .poll(() =>
      logo.evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Start registration", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start registration", exact: true })
    .click();
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await expect(next).toBeDisabled();
  const firstName = page.locator('[data-intake-field="firstName"]');
  await firstName.pressSequentially("Alex", { delay: 20 });
  await expect(firstName).toBeFocused();
  await expect(firstName).toHaveValue("Alex");
  await page.locator('[data-intake-field="lastName"]').fill("Morgan");
  await page.locator('[data-intake-field="email"]').fill("alex@example.org");
  await expect(next).toBeDisabled();
  await page.locator('[data-intake-field="phone"]').fill("2025550100");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Your organization.", exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('[data-intake-field="legalEntityName"]')
    .fill("Civic Action Team");
  const entityType = page.locator('[data-intake-field="legalEntityType"]');
  await entityType.focus();
  await entityType.selectOption("political");
  await expect(entityType).toBeFocused();
  await page.locator('[data-intake-field="taxEin"]').fill("00-0000000");
  await page
    .locator('[data-intake-field="websiteAddress"]')
    .fill("https://example.org");
  await page
    .locator('[data-intake-field="entityStreetAddress"]')
    .fill("123 Example Street");
  await page.locator('[data-intake-field="entityCity"]').fill("Sampletown");
  await page.locator('[data-intake-field="entityState"]').selectOption("CT");
  await page.locator('[data-intake-field="entityZip"]').fill("06000");
  await page
    .locator('[data-intake-field="filingUrl"]')
    .fill("https://example.org/filing");
  const verifyToken = page.locator(
    '[data-intake-field="campaignVerify.token"]',
  );
  await expect(verifyToken).toHaveAttribute("type", "password");
  await verifyToken.fill("fictional-test-authorization-token");
  await expect(next).toBeDisabled();
  await page
    .locator('[data-intake-field="campaignVerify.expiresOn"]')
    .fill("2099-12-31");
  await expect(next).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await next.click();

  await page.setViewportSize({ width: 1360, height: 1000 });
  await page
    .locator('[data-intake-field="useCaseDescription"]')
    .fill("Community updates and invitations.");
  const sample =
    "Civic Action Team: read more at https://example.org. Reply STOP to opt out.";
  await page.locator('[data-intake-field="sampleMessage1"]').fill(sample);
  await page.locator('[data-intake-field="sampleMessage2"]').fill(sample);
  await page.locator('[data-intake-field="areaCode1"]').fill("202");
  await next.click();
  await page
    .locator('[data-intake-field="listSource"]')
    .fill("Authorized voter-file export.");
  await page
    .locator('[data-intake-field="permittedPurpose"]')
    .fill("Permitted political outreach.");
  const submit = page.getByRole("button", {
    name: "Submit application",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await page.locator('[data-intake-field="authorityConfirmed"]').check();
  await submit.click();
  await expect(
    page.getByRole("heading", {
      name: "STOP — Is your website ready?",
      exact: true,
    }),
  ).toBeVisible();
  const guidelines = page.getByRole("link", {
    name: /View website guidelines/,
  });
  await expect(guidelines).toHaveAttribute("href", /\.pdf$/);
  const confirm = page.getByRole("button", {
    name: "Submit for review",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  expect(writes).toEqual([]);
  await page.locator('[data-intake-field="websiteConfirmed"]').check();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "You’re in review.", exact: true }),
  ).toBeVisible();
  expect(writes.map((call) => call.method)).toEqual(["PUT", "POST"]);
  expect(writes[0].body.expectedRevision).toBe(0);
  expect(writes[0].body.packet.campaignVerify.expiresOn).toBe("2099-12-31");
  expect(writes[1].body.expectedRevision).toBe(1);
  expect(writes[1].body.websiteAcknowledgment).toEqual({
    version: "polis-10dlc-website-2026-09-17",
    confirmed: true,
  });
  expect(
    writes.every((call) => call.authorization?.startsWith("Bearer ")),
  ).toBe(true);
  await expect(page.locator(".pt-content")).not.toContainText(
    "fictional-test-authorization-token",
  );
  await expect(page.locator(".pt-content")).toContainText(
    "Messaging stays paused during setup.",
  );
});
