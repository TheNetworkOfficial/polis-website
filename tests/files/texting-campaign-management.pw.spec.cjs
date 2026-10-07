const { test, expect } = require("@playwright/test");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");
const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ ok: status < 400, ...body }),
  });
const initial = {
  campaignId: "campaign-one",
  name: "Example campaign",
  status: "active",
  revision: 4,
  budgetMicros: 50000000,
  reservedMicros: 1000000,
  settledMicros: 12000000,
  deliveryNotBeforeMs: Date.parse("2026-01-01T00:00:00Z"),
  deliveryBeforeMs: Date.parse("2099-12-01T18:31:42.123Z"),
  templateText: "Example Civic Team: hello. Reply STOP to opt out.",
  audienceId: "frozen-audience",
  assignedUserIds: [],
  blockedReasons: [],
  canManageLimits: true,
  canManageBudget: true,
  canRecoverQueue: true,
};
async function setup(page) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.fallback()
      : route.abort(),
  );
  const fixture = await mockBook(page);
  await page.route(`**${PROMPT}/workspace`, (route) =>
    json(route, {
      workspace: {
        provider: "prompt",
        scopeKey: "coalition:org-1",
        manualOnly: true,
        status: "configured",
        canSend: true,
        capabilities: {
          createCampaigns: true,
          manageBilling: true,
          manualQueue: true,
          readReporting: true,
        },
      },
    }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one/reporting`, (route) =>
    json(route, {
      report: {
        version: 1,
        campaignId: "campaign-one",
        coverage: "partial",
        unreadReplies: 2,
        counts: {
          accepted: 4,
          sent: 1,
          delivered: 2,
          failed: 1,
          pending: 0,
          needsReview: 0,
          inbound: 3,
          outbound: 4,
        },
      },
    }),
  );
  return fixture;
}
const open = (page) =>
  page.goto(`${BASE}/organizations/org-1/texting/campaigns/campaign-one`);

test("active campaign raises only its limit and preserves its saved message, recipients and precise end", async ({
  page,
}, info) => {
  const fixture = await setup(page),
    writes = [];
  let campaign = { ...initial };
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
    json(route, { campaign }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one/limits`, (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    campaign = { ...campaign, budgetMicros: body.budgetMicros, revision: 5 };
    return json(route, { campaign });
  });
  await open(page);
  await expect(
    page.getByRole("region", { name: "Campaign reporting", exact: true }),
  ).toContainText("Unread to you");
  await page
    .getByRole("button", { name: "Edit campaign limits", exact: true })
    .click();
  await page.getByLabel("Spending limit ($)", { exact: true }).fill("75.00");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: info.outputPath(`limits-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Save campaign limits", exact: true })
    .click();
  await expect(
    page.getByText("Campaign limits saved.", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([{ expectedRevision: 4, budgetMicros: 75000000 }]);
  expect(campaign.deliveryBeforeMs).toBe(initial.deliveryBeforeMs);
  expect(campaign.templateText).toBe(initial.templateText);
  expect(campaign.audienceId).toBe(initial.audienceId);
  expect(fixture.calls.filter((c) => c.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("lost limit response requires a saved-state refresh and never repeats its PATCH", async ({
  page,
}) => {
  await setup(page);
  const writes = [];
  let campaign = { ...initial, status: "paused" };
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
    json(route, { campaign }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one/limits`, (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    campaign = {
      ...campaign,
      deliveryBeforeMs: body.deliveryBeforeMs,
      revision: 5,
    };
    return json(route, { error: "response_unavailable" }, 503);
  });
  await open(page);
  await page
    .getByRole("button", { name: "Edit campaign limits", exact: true })
    .click();
  await page
    .getByLabel("Campaign end", { exact: true })
    .fill("2099-12-02T18:31");
  await page
    .getByRole("button", { name: "Save campaign limits", exact: true })
    .click();
  await expect(
    page.getByText("Check saved limits", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save campaign limits", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Campaign end", { exact: true })).toHaveValue(
    "2099-12-02T18:31",
  );
  await page
    .getByRole("button", { name: "Refresh campaign limits", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit campaign limits", exact: true }),
  ).toBeEnabled();
  expect(writes).toHaveLength(1);
  expect(Object.keys(writes[0]).sort()).toEqual([
    "deliveryBeforeMs",
    "expectedRevision",
  ]);
});

for (const budgetMicros of [5555000, 5556000])
  test(`end-only edit preserves an existing ${budgetMicros} micro-dollar cap`, async ({
    page,
  }) => {
    await setup(page);
    const writes = [];
    let campaign = { ...initial, budgetMicros };
    await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
      json(route, { campaign }),
    );
    await page.route(`**${PROMPT}/campaigns/campaign-one/limits`, (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      campaign = { ...campaign, ...body, revision: 5 };
      return json(route, { campaign });
    });
    await open(page);
    await page
      .getByRole("button", { name: "Edit campaign limits", exact: true })
      .click();
    await page
      .getByLabel("Campaign end", { exact: true })
      .fill("2099-12-02T18:31");
    await page
      .getByRole("button", { name: "Save campaign limits", exact: true })
      .click();
    await expect(
      page.getByText("Campaign limits saved.", { exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]).sort()).toEqual([
      "deliveryBeforeMs",
      "expectedRevision",
    ]);
    expect(campaign.budgetMicros).toBe(budgetMicros);
  });

for (const unknown of [false, true])
  test(`removed volunteer recipient recovery ${unknown ? "holds an uncertain skip across reload" : "skips once with the exact assignment"}`, async ({
    page,
  }, info) => {
    const fixture = await setup(page),
      writes = [];
    let skipped = false;
    const allocationId = "00000000-0000-4000-8000-000000000001";
    await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
      json(route, { campaign: initial }),
    );
    await page.route(
      `**${PROMPT}/campaigns/campaign-one/queue-recovery?*`,
      (route) =>
        json(route, {
          campaignId: "campaign-one",
          campaignRevision: 4,
          allocations: skipped
            ? []
            : [
                {
                  userId: "removed-volunteer",
                  allocationId,
                  state: "held",
                  items: [
                    {
                      itemId: "held-one",
                      state: "held",
                      canSkip: true,
                      preview: {
                        contactDisplayName: "Example Recipient",
                        contactPhone: "+12025550124",
                      },
                    },
                    ...(unknown
                      ? [
                          {
                            itemId: "held-two",
                            state: "held",
                            canSkip: true,
                            preview: {
                              contactDisplayName: "Another Recipient",
                              contactPhone: "+12025550125",
                            },
                          },
                        ]
                      : []),
                  ],
                },
              ],
        }),
    );
    await page.route(
      `**${PROMPT}/campaigns/campaign-one/queue-recovery/held-one/skip`,
      (route) => {
        const body = route.request().postDataJSON();
        writes.push(body);
        skipped = !unknown;
        return json(route, {
          result: {
            actionId: body.actionId,
            itemId: "held-one",
            state: unknown ? "provider_outcome_unknown" : "accepted",
            resendPermitted: false,
          },
        });
      },
    );
    await open(page);
    await page
      .getByRole("button", { name: "Review stranded recipients", exact: true })
      .click();
    await expect(
      page.getByText("Example Recipient", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: info.outputPath(`recovery-${unknown}-mobile.png`),
      fullPage: true,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Skip recipient", exact: true })
      .first()
      .click();
    if (unknown) {
      await expect(
        page
          .getByText("Outcome needs review. Do not repeat this action.", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await expect(
        page
          .getByRole("button", { name: "Skip recipient", exact: true })
          .first(),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("button", { name: "Skip recipient", exact: true })
          .nth(1),
      ).toBeDisabled();
      await page.reload();
      await page
        .getByRole("button", {
          name: "Review stranded recipients",
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("button", { name: "Skip recipient", exact: true })
          .first(),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("button", { name: "Skip recipient", exact: true })
          .nth(1),
      ).toBeDisabled();
    } else
      await expect(
        page.getByText("No stranded recipients on this page.", { exact: true }),
      ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      expectedRevision: 4,
      userId: "removed-volunteer",
      allocationId,
      actionId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
    expect(fixture.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
