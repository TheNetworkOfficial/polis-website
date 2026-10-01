const { test, expect } = require("@playwright/test");
const { mockBook, BASE, BOOK, PROMPT } = require("./contact-book-fixture.cjs");

test("Contacts navigation remains during a delayed fresh tab authorization and disappears on denial", async ({
  page,
}) => {
  const fixture = await mockBook(page);
  let release,
    requested = false,
    deny = false;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(`**${PROMPT}/workspace`, async (route) => {
    if (deny)
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "contact_access_denied" }),
      });
    requested = true;
    await wait;
    return route.fallback();
  });
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  const nav = page.getByRole("navigation", { name: "Texting", exact: true });
  await expect(
    nav.getByRole("link", { name: "Contacts", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__textingDocumentIdentity = "original";
  });
  await nav.getByRole("link", { name: "Campaigns", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  expect(await page.evaluate(() => window.__textingDocumentIdentity)).toBe(
    "original",
  );
  await expect(
    nav.getByRole("link", { name: "Contacts", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", {
      name: "Make the next connection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Contacts", exact: true }),
  ).toBeVisible();
  deny = true;
  await nav.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(
    page.getByText("Your access has changed.", { exact: false }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Contacts", exact: true }),
  ).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test("review drawer Continue enters message step only after explicit review, without transfer", async ({
  page,
}, info) => {
  const fixture = await mockBook(page);
  await page.goto(`${BASE}/organizations/org-1/texting/contacts`);
  await page
    .getByRole("checkbox", { name: "Select Alex Example", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review selection",
    exact: true,
  });
  const proceed = review.getByRole("button", {
    name: "Continue to write message",
    exact: true,
  });
  await expect(proceed).toBeDisabled();
  await review
    .getByLabel("I reviewed these campaign recipients", { exact: true })
    .check();
  await expect(proceed).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("review-continue-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("review-continue-mobile.png"),
    fullPage: true,
  });
  await proceed.click();
  await expect(review).toHaveCount(0);
  await expect(page.getByLabel("Campaign name", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Back to recipients", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Select Alex Example", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Next: Write message", exact: true }),
  ).toHaveCount(2);
  expect(
    fixture.calls.filter(
      (call) => call.method === "POST" && call.path.startsWith(PROMPT),
    ),
  ).toEqual([]);
  expect(
    fixture.calls.some(
      (call) => call.path.startsWith(BOOK) && call.path.endsWith("/campaign"),
    ),
  ).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("accepted preparation survives reload, polls to completion, and separates image from message readiness", async ({
  page,
}, info) => {
  const fixture = await mockBook(page);
  const calls = [];
  let finishAllowed = false;
  let saved = {
    campaignId: "campaign-one",
    revision: 1,
    name: "Fictional campaign",
    status: "draft",
    mediaId: "image-one",
    templateText: "Example Civic Team: hello. Reply STOP to opt out.",
    budgetMicros: 1000000,
    assignedUserIds: [],
    blockedReasons: ["content_not_prepared", "billing_unfunded"],
    preparation: null,
  };
  await page.route(`**${PROMPT}/media/image-one/content`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        media: {
          mediaId: "image-one",
          providerReady: true,
          state: "provider_verified",
          mimeType: "image/png",
          dataBase64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvV0AAAAASUVORK5CYII=",
        },
      }),
    }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one**`, (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    calls.push({ path, method: request.method(), body });
    if (path.endsWith("/transition")) {
      saved = {
        ...saved,
        revision: 2,
        preparation: {
          preparationId: "accepted-one",
          status: "preparing",
          stage: "provider_transfer",
          canResume: false,
          automaticResume: false,
          pollAfterMs: 2000,
        },
      };
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "prompt_contact_audience_preparing",
        }),
      });
    }
    if (path.endsWith("/preparation/resume")) {
      expect(body).toEqual({
        preparationId: "accepted-one",
        expectedRevision: 2,
      });
      saved = {
        ...saved,
        revision: 3,
        status: "prepared",
        blockedReasons: [],
        preparation: {
          ...saved.preparation,
          status: "complete",
          canResume: false,
          automaticResume: false,
        },
      };
    } else if (finishAllowed && saved.preparation?.status === "preparing") {
      saved = {
        ...saved,
        preparation: {
          ...saved.preparation,
          status: "ready_to_finalize",
          stage: "message",
          canResume: true,
          automaticResume: true,
        },
      };
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, campaign: saved }),
    });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/campaign-one`);
  await expect(page.getByText("Image verified", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Prepare selected recipients", exact: true })
    .click();
  await expect(
    page.getByText("Preparing selected recipients…", { exact: true }),
  ).toBeVisible();
  await page.getByText("What needs attention", { exact: true }).click();
  await expect(
    page.getByText(
      "Message will be checked when recipient preparation finishes",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("billing unfunded", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("preparation-pending-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("preparation-pending-mobile.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByText("Preparing selected recipients…", { exact: true }),
  ).toBeVisible();
  finishAllowed = true;
  await expect(page.getByText("prepared", { exact: true }).first()).toBeVisible(
    {
      timeout: 10000,
    },
  );
  await expect(
    page.getByText("Preparing selected recipients…", { exact: true }),
  ).toHaveCount(0);
  expect(
    calls.filter((call) => call.path.endsWith("/transition")),
  ).toHaveLength(1);
  expect(
    calls.filter((call) => call.path.endsWith("/preparation/resume")),
  ).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
});
