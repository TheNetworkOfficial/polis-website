const { test, expect } = require("@playwright/test");
const { mockBook, BASE } = require("./contact-book-fixture.cjs");
const SETUP =
  "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod/api/texting/setup/coalition/org-1";
const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ ok: status === 200, ...body }),
  });
const saved = {
  setupId: "saved-one",
  campaignId: "campaign-one",
  revision: 3,
  state: "ready",
  canPublish: true,
  draft: {
    name: "Saved reviewed neighbors",
    templateText: "Example Civic Team. Reply STOP.",
  },
  progress: { selected: 50, submitted: 50, verified: 50 },
};

test("real backend publication fixture recovers lost activation through the same fixed handoff", async ({
  page,
}) => {
  const fixture = await mockBook(page);
  const enabled = require("../texting/fixtures/setup-v1/enabled.json");
  const published = require("../texting/fixtures/setup-v1/published.json");
  const complete = require("../texting/fixtures/setup-v1/complete-handoff.json");
  const base = SETUP.replace("org-1", "fictional");
  const writes = [];
  let accepted = false;
  await page.route("**/texting-setup-config.json", (route) =>
    json(route, {
      schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
      enabled: true,
      apiBaseUrl: "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
    }),
  );
  await page.route(`${base}**`, (route) => {
    const request = route.request();
    if (request.method() === "POST")
      writes.push({
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
      });
    return json(
      route,
      request.url() === base ? enabled : accepted ? complete : published,
    );
  });
  const action = published.setup.handoff.action;
  await page.route(`**${action.path}`, (route) => {
    writes.push({ path: action.path, body: route.request().postDataJSON() });
    accepted = true;
    return route.abort("failed");
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(
    `${BASE}/organizations/fictional/texting/setup/${published.setup.setupId}`,
  );
  await page
    .getByRole("button", { name: "Continue opening", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved campaign setup" }),
  ).toContainText("Check the saved result");
  expect(writes).toHaveLength(2);
  expect(writes[0].body).toEqual({
    expectedRevision: published.setup.revision,
  });
  expect(writes[1]).toEqual({ path: action.path, body: action.body });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Start texting", exact: true }),
  ).toHaveAttribute("href", complete.setup.navigationPath);
  expect(writes).toHaveLength(2);
  expect(fixture.errors).toEqual([]);
});

for (const state of ["paused", "unavailable", "unsupported"])
  test(`normal campaign entry distinguishes ${state} without an automatic legacy creation`, async ({
    page,
  }) => {
    const fixture = await mockBook(page),
      calls = [];
    await page.route("**/texting-setup-config.json", (route) =>
      json(route, {
        schema: "POLIS_TEXTING_SETUP_CONFIG_V1",
        enabled: true,
        apiBaseUrl:
          "https://abcdefghij.execute-api.us-west-2.amazonaws.com/prod",
      }),
    );
    await page.route(`${SETUP}**`, (route) => {
      calls.push({
        method: route.request().method(),
        url: route.request().url(),
      });
      if (state === "unavailable")
        return json(route, { error: "setup_unavailable" }, 503);
      if (route.request().url().includes("/drafts/"))
        return json(route, { setup: saved });
      return json(route, {
        setupAvailability: {
          state,
          supportedWorkflowTypes: ["contact_book_single"],
        },
        capabilities: {
          isolatedSetup: true,
          createSetup: false,
          manageBilling: true,
        },
        setups: [saved],
        availableAudiences: [],
        volunteers: [],
      });
    });
    await page.goto(`${BASE}/organizations/org-1/texting/campaigns`);
    await expect(
      page.getByRole("button", { name: "New campaign", exact: true }),
    ).toHaveCount(0);
    if (state === "unsupported") {
      await expect(
        page.getByRole("button", { name: "Other campaign types", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Use the existing campaign workflow", { exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("button", { name: "Check campaign setup", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Other campaign types", exact: true }),
      ).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Saved setups", exact: true }).click();
    if (state === "paused") {
      await expect(
        page.getByText("New campaign setup is paused", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Continue saved setup", exact: true })
        .click();
      await expect(page).toHaveURL(/setup\/saved-one$/);
      await expect(
        page.getByRole("region", { name: "Saved campaign setup" }),
      ).toContainText("Saved reviewed neighbors");
      await expect(
        page.getByRole("button", {
          name: "Review and open campaign",
          exact: true,
        }),
      ).toBeVisible();
    }
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(fixture.errors).toEqual([]);
  });
