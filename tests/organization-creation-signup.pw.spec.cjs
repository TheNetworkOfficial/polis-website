const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9196";
const TOKEN = "browser-fixture-invitation-" + "b".repeat(32);
async function fixture(
  page,
  {
    signedIn = true,
    validationStatus = 200,
    createFailure = false,
    delayUpload = false,
  } = {},
) {
  const writes = [],
    errors = [],
    external = [];
  let redeemed = false;
  let uploadRelease;
  const transfers = [];
  const jwt = `e30.${Buffer.from(JSON.stringify({ sub: "signup-actor", email: "ada@example.test", email_verified: true })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ base, jwt, signedIn }) => {
      if (signedIn)
        sessionStorage.setItem(
          "sharedFeedSession.v1",
          JSON.stringify({
            idToken: jwt,
            accessToken: jwt,
            expiresAt: Date.now() + 3600000,
          }),
        );
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
              clientId: "fixture",
              region: "us-west-2",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { base: BASE, jwt, signedIn },
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) return route.continue();
    if (url.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: "" });
    if (url.hostname === "example.invalid")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>',
      });
    external.push(url.origin);
    return route.abort();
  });
  await page.route(`${BASE}/mock-upload-target`, (route) => {
    transfers.push(route.request().method());
    return route.fulfill({ body: "ok" });
  });
  await page.route(`${BASE}/api/**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET")
      writes.push({ path, body: request.postDataJSON() });
    if (path === "/api/organization-creation-invitations/validate") {
      if (validationStatus !== 200)
        return json(
          { error: "organization_creation_invitation_invalid" },
          validationStatus,
        );
      expect([TOKEN, "new-invitation-" + "z".repeat(40)]).toContain(
        request.postDataJSON().invitationToken,
      );
      expect(Object.keys(request.postDataJSON())).toEqual(["invitationToken"]);
      return json({
        ok: true,
        invitation: {
          recipientEmail: "ada@example.test",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          status: redeemed ? "redeemed" : "pending",
          ...(redeemed ? { redeemedCoalitionId: "created-fixture" } : {}),
        },
      });
    }
    if (path === "/api/coalitions" && request.method() === "POST") {
      if (createFailure) {
        redeemed = true;
        return json({ error: "response_lost_after_commit" }, 503);
      }
      return json({ coalition: { coalitionId: "created-fixture" } }, 201);
    }
    if (path === "/api/uploads/create") {
      if (delayUpload)
        await new Promise((resolve) => {
          uploadRelease = resolve;
        });
      return json({
        uid: "fixture-upload",
        type: "image",
        uploadURL: BASE + "/mock-upload-target",
        publicUrl: "https://example.invalid/late-image.png",
      });
    }
    if (path === "/api/profile/me")
      return json({
        profile: {
          userId: "signup-actor",
          displayName: "Ada",
          username: "ada",
        },
      });
    return json({ items: [], coalitions: [], workspaces: [] });
  });
  return {
    writes,
    errors,
    external,
    transfers,
    releaseUpload: () => uploadRelease?.(),
  };
}
const legal = {
  name: "Fixture county organization",
  description: "Synthetic test organization",
  imageUrl: "https://example.invalid/logo.png",
  countyName: "Cascade County",
  partyLabel: "Democratic",
  partyAbbrev: "DEM",
  legalName: "Fixture committee",
  ein: "123456789",
  addressLine1: "100 Test Street",
  city: "Helena",
  region: "MT",
  postalCode: "59601",
  websiteUrl: "https://example.invalid",
  representativeFirstName: "Ada",
  representativeLastName: "Example",
  representativeTitle: "Treasurer",
  representativeEmail: "ada@example.test",
  representativePhone: "+14065550100",
  authorityName: "Fixture authority",
  registrationId: "fixture-registration",
  filingUrl: "https://example.invalid/filing",
};
async function fill(page) {
  for (const [name, value] of Object.entries(legal))
    await page.locator(`form [name="${name}"]`).fill(value);
  await page.locator('[name="stateId"]').selectOption("MT");
}

test("public canonical and legacy signup block creation while existing organizations stay reachable", async ({
  page,
}) => {
  const h = await fixture(page);
  for (const path of ["/organizations/signup", "/coalitions/start"]) {
    await page.goto(BASE + path);
    await expect(
      page.getByRole("heading", { name: "Invitation required", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create organization", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Your organizations", exact: true })
      .click();
    await expect(page).toHaveURL(BASE + "/coalitions");
    await expect(
      page.getByRole("button", { name: "Start coalition", exact: true }),
    ).toHaveCount(0);
  }
  expect(h.writes).toEqual([]);
  expect(h.errors).toEqual([]);
  expect(h.external).toEqual([]);
});

for (const width of [390, 1280])
  test(`invited county signup at ${width}px validates before form and recovers uncertain commit without another create`, async ({
    page,
  }, testInfo) => {
    const h = await fixture(page, { createFailure: true });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      `${BASE}/organizations/signup?invitationToken=${TOKEN}&orgKind=county_party`,
    );
    await expect(
      page.getByRole("heading", { name: "Organization signup", exact: true }),
    ).toBeVisible();
    expect(page.url()).not.toContain(TOKEN);
    expect(await page.content()).not.toContain(TOKEN);
    expect(h.writes).toHaveLength(1);
    await expect(page.locator('[name="orgKind"]')).toHaveValue("county_party");
    await fill(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`invited-county-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Create organization", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Check organization status",
        exact: true,
      }),
    ).toBeVisible();
    const creation = h.writes.filter(
      (write) => write.path === "/api/coalitions",
    );
    expect(creation).toHaveLength(1);
    expect(creation[0].body.orgKind).toBe("county_party");
    expect(creation[0].body.jurisdiction.countyId).toBe("MT-cascade");
    expect(creation[0].body.legalEntityProfile.committeeClassification).toBe(
      "county_party_committee",
    );
    expect(creation[0].body.invitationToken).toBe(TOKEN);
    expect(creation[0].body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    await page.screenshot({
      path: testInfo.outputPath(`uncertain-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Check invitation", exact: true })
      .click();
    await expect(page).toHaveURL(BASE + "/coalitions/created-fixture");
    expect(
      h.writes.filter((write) => write.path === "/api/coalitions"),
    ).toHaveLength(1);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("polis.organizationSignup.v1"),
      ),
    ).toBeNull();
    expect(h.errors).toEqual([]);
    expect(h.external).toEqual([]);
  });

test("signed-out invitation is scrubbed before its auth return and never creates", async ({
  page,
}) => {
  const h = await fixture(page, { signedIn: false });
  await page.goto(`${BASE}/organizations/signup?invitationToken=${TOKEN}`);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }).first(),
  ).toBeVisible();
  expect(page.url()).not.toContain(TOKEN);
  expect(await page.content()).not.toContain(TOKEN);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("polis.organizationSignup.v1"))
          .invitationToken,
    ),
  ).toBe(TOKEN);
  expect(h.writes).toEqual([]);
  expect(h.errors).toEqual([]);
});

for (const exit of ["new-invitation", "logout"])
  test(`private legal draft and late image never cross ${exit}`, async ({
    page,
  }) => {
    const h = await fixture(page, { delayUpload: true });
    await page.goto(
      `${BASE}/organizations/signup?invitationToken=${TOKEN}&orgKind=county_party`,
    );
    await expect(
      page.getByRole("heading", { name: "Organization signup", exact: true }),
    ).toBeVisible();
    await page
      .locator('form [name="legalName"]')
      .fill("Prior actor private legal name");
    await page.locator('form [name="ein"]').fill("987654321");
    await page.locator('[data-coalition-image-file="start"]').setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect
      .poll(() =>
        h.writes.some((write) => write.path === "/api/uploads/create"),
      )
      .toBe(true);
    if (exit === "new-invitation") {
      await page.evaluate(
        (route) => {
          const button = document.createElement("button");
          button.dataset.action = "navigate";
          button.dataset.route = route;
          document.getElementById("shared-feed-app").append(button);
          button.click();
          button.remove();
        },
        `/organizations/signup?invitationToken=${"new-invitation-" + "z".repeat(40)}&orgKind=county_party`,
      );
      await expect(page.locator('form [name="legalName"]')).toHaveValue("");
      await expect(page.locator('form [name="ein"]')).toHaveValue("");
    } else {
      await page.evaluate(() => {
        const button = document.createElement("button");
        button.dataset.action = "navigate";
        button.dataset.route = "/auth";
        document.getElementById("shared-feed-app").append(button);
        button.click();
        button.remove();
      });
      await page
        .locator(".shared-auth-route-signed-in")
        .getByRole("button", { name: "Log out", exact: true })
        .click();
    }
    h.releaseUpload();
    if (exit === "new-invitation")
      await expect(page.locator('form [name="imageUrl"]')).toHaveValue("");
    else await expect(page.locator('form [name="ein"]')).toHaveCount(0);
    expect(h.transfers).toEqual([]);
    expect(await page.content()).not.toContain(
      "Prior actor private legal name",
    );
    expect(
      h.writes.filter((write) => write.path === "/api/coalitions"),
    ).toHaveLength(0);
    expect(h.errors).toEqual([]);
  });
