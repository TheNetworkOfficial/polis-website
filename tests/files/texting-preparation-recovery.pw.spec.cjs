const { test, expect } = require("@playwright/test");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");

test("held preparation preserves its selection and gives honest actions at desktop and narrow widths", async ({
  page,
}, info) => {
  const fixture = await mockBook(page);
  const calls = [];
  const saved = {
    campaignId: "campaign-one",
    revision: 7,
    name: "Fictional campaign",
    status: "draft",
    templateText: "Example Civic Team: hello. Reply STOP to opt out.",
    budgetMicros: 1000000,
    assignedUserIds: [],
    blockedReasons: ["content_not_prepared"],
    preparation: {
      preparationId: "approved-selection-one",
      status: "needs_attention",
      stage: "provider_transfer",
      selectedContactCount: 420,
      progress: {
        totalContactCount: 420,
        submittedContactCount: 100,
        verifiedContactCount: 0,
      },
      updatedAtMs: 1791288000000,
      errorCode: "prompt_provider_records_not_ready",
      canResume: false,
      automaticResume: false,
      recoveryAction: "operator_review",
    },
  };
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) => {
    calls.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, campaign: saved }),
    });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/campaign-one`);
  const notice = page.getByRole("region", {
    name: "Recipient preparation",
    exact: true,
  });
  await expect(
    notice.getByText("Recipient preparation needs attention", { exact: true }),
  ).toBeVisible();
  await expect(
    notice.getByText(/Polis support must review the saved result/),
  ).toBeVisible();
  await expect(
    notice.getByText("Submitted for preparation: 100 of 420 recipients", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    notice.getByText("Confirmed ready: 0 of 420 recipients", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Prepare selected recipients",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resume saved preparation", exact: true }),
  ).toHaveCount(0);
  await expect(notice).not.toContainText(
    /Prompt|Telnyx|provider_records|resume this approved selection/i,
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 320)
      await page.addStyleTag({ content: "html { font-size: 24px; }" });
    await page.screenshot({
      path: info.outputPath(`preparation-review-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      notice.getByRole("button", {
        name: "Check preparation now",
        exact: true,
      }),
    ).toBeVisible();
  }
  await notice
    .getByRole("button", { name: "Check preparation now", exact: true })
    .click();
  await expect(
    notice.getByRole("button", { name: "Check preparation now", exact: true }),
  ).toBeEnabled();
  await notice
    .getByRole("button", { name: "Check preparation now", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(3);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("a different manager sees who must continue and checking shared progress creates no write", async ({
  page,
}) => {
  const fixture = await mockBook(page);
  const calls = [];
  let complete = false;
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) => {
    calls.push(route.request().method());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        campaign: {
          campaignId: "campaign-one",
          revision: complete ? 8 : 7,
          name: "Fictional campaign",
          status: complete ? "prepared" : "draft",
          templateText: "Example Civic Team: hello. Reply STOP to opt out.",
          assignedUserIds: [],
          blockedReasons: [],
          preparation: {
            preparationId: "approved-selection-one",
            status: complete ? "complete" : "ready_to_finalize",
            stage: "message",
            selectedContactCount: 420,
            canResume: false,
            automaticResume: false,
            recoveryAction: "original_approver",
          },
        },
      }),
    });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/campaign-one`);
  const notice = page.getByRole("region", {
    name: "Recipient preparation",
    exact: true,
  });
  await expect(
    notice.getByText(/person who approved this selection needs to continue/),
  ).toBeVisible();
  await expect(
    notice.getByRole("button", {
      name: "Resume saved preparation",
      exact: true,
    }),
  ).toHaveCount(0);
  complete = true;
  await notice
    .getByRole("button", { name: "Check preparation now", exact: true })
    .click();
  await expect(notice).toHaveCount(0);
  expect(calls.every((method) => method === "GET")).toBe(true);
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("opening a campaign displays setup progress and polls until texting is available", async ({
  page,
}, info) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.fallback()
      : route.abort(),
  );
  const fixture = await mockBook(page);
  const calls = [];
  let complete = false;
  let campaign = {
    campaignId: "campaign-one",
    revision: 7,
    name: "Fictional campaign",
    status: "prepared",
    templateText: "Example Civic Team: hello. Reply STOP to opt out.",
    assignedUserIds: ["volunteer-one"],
    blockedReasons: [],
    canActivate: true,
    canFetchQueue: false,
  };
  await page.route(`**${PROMPT}/workspace`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        workspace: {
          provider: "prompt",
          scopeKey: "coalition:org-1",
          manualOnly: true,
          status: "configured",
          canSend: true,
          capabilities: { createCampaigns: true, manualQueue: true },
        },
      }),
    }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) => {
    calls.push({ method: route.request().method() });
    if (complete)
      campaign = {
        ...campaign,
        revision: 8,
        status: "active",
        preparation: null,
        canFetchQueue: true,
      };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, campaign }),
    });
  });
  await page.route(`**${PROMPT}/campaigns/campaign-one/transition`, (route) => {
    calls.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    campaign = {
      ...campaign,
      status: "activating",
      canActivate: false,
      preparation: {
        preparationId: "approved-activation-one",
        status: "preparing",
        stage: "campaign_activation",
        canResume: false,
        automaticResume: false,
        pollAfterMs: 5000,
        contentPrepared: true,
        selectedContactCount: null,
        progress: null,
        recoveryAction: "none",
      },
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, campaign }),
    });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/campaign-one`);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Open campaign", exact: true })
    .click();
  const notice = page.getByRole("region", {
    name: "Campaign activation",
    exact: true,
  });
  await expect(notice.getByText("Opening campaign…")).toBeVisible();
  await expect(notice).toContainText(
    "Preparing texting access for assigned volunteers",
  );
  await expect(notice).not.toContainText(/recipient|resume|Prompt|Telnyx/i);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start texting", exact: true }),
  ).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: info.outputPath(`campaign-opening-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  complete = true;
  await expect(
    page.getByRole("button", { name: "Start texting", exact: true }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  expect(calls.filter((call) => call.method !== "GET")).toEqual([
    { method: "POST", body: { expectedRevision: 7, action: "activate" } },
  ]);
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
